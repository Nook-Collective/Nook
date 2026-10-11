import type { JWTVerifyGetKey } from "jose";
import type { ApiError, HealthResponse, MeResponse, PublicConfig } from "../shared/types";
import { bearerToken, issuerFor, remoteKeysFor, verifyAccessToken } from "./auth";
import { readLimitedText } from "./body";
import type { Env } from "./env";
import { createApplication, getMember } from "./members";
import { verifyTurnstile, type TurnstileResult } from "./turnstile";
import { parseApplication } from "./validate";

// Things tests replace so they do not need the network.
export interface Deps {
  getKeys(env: Env): JWTVerifyGetKey;
  verifyTurnstile(env: Env, token: string, remoteIp: string | null): Promise<TurnstileResult>;
}

export const defaultDeps: Deps = {
  getKeys: (env) => remoteKeysFor(env.SUPABASE_URL),
  verifyTurnstile: (env, token, remoteIp) => verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, remoteIp),
};

const MAX_BODY_BYTES = 8 * 1024;

// Headers for API responses. Static files get theirs from public/_headers,
// which does not apply to responses our Worker creates.
const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...API_HEADERS, ...extra },
  });
}

function fail(status: number, error: string): Response {
  return json({ error } satisfies ApiError, status);
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" } satisfies ApiError, 401, { "WWW-Authenticate": "Bearer" });
}

function onlyMethod(
  request: Request,
  method: "GET" | "POST",
  handler: () => Response | Promise<Response>,
): Response | Promise<Response> {
  if (request.method !== method) {
    return json({ error: "Method not allowed" } satisfies ApiError, 405, { Allow: method });
  }
  return handler();
}

function hasSupabaseSettings(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

function notConfigured(): Response {
  console.error("A required setting is missing. Check .dev.vars (local) or the deployed settings.");
  return fail(500, "Server is not configured");
}

// Fails closed: a missing or invalid limit means "no applications", not "unlimited".
function maxPending(env: Env): number {
  const value = Number(env.MAX_PENDING_APPLICATIONS);
  if (Number.isInteger(value) && value >= 0) return value;
  console.error("MAX_PENDING_APPLICATIONS is not a whole number; refusing new applications");
  return 0;
}

// Checks the caller's Supabase token. Returns their user ID, or a Response to send back.
async function authenticate(request: Request, env: Env, deps: Deps): Promise<string | Response> {
  const token = bearerToken(request);
  if (!token) return unauthorized();
  try {
    const user = await verifyAccessToken(token, deps.getKeys(env), issuerFor(env.SUPABASE_URL));
    return user.userId;
  } catch {
    return unauthorized();
  }
}

function health(env: Env): Response {
  const body: HealthResponse = { ok: true, app: env.APP_NAME, time: new Date().toISOString() };
  return json(body);
}

function config(env: Env): Response {
  if (!hasSupabaseSettings(env) || !env.TURNSTILE_SITE_KEY) return notConfigured();
  const body: PublicConfig = {
    appName: env.APP_NAME,
    supabaseUrl: env.SUPABASE_URL,
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
  };
  return json(body);
}

// Who am I, and what is the state of my account? Reveals only the caller's own state.
async function me(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (!hasSupabaseSettings(env)) return notConfigured();

  const auth = await authenticate(request, env, deps);
  if (auth instanceof Response) return auth;

  const member = await getMember(env.DB, auth);
  const body: MeResponse = member
    ? { state: member.status, role: member.role }
    : { state: "none", role: null };
  return json(body);
}

// Submit an application. The order is deliberate: cheap local checks first,
// the outside call to Cloudflare only for a valid, first-time application.
async function apply(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (!hasSupabaseSettings(env) || !env.TURNSTILE_SECRET_KEY) return notConfigured();

  const auth = await authenticate(request, env, deps);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return fail(415, "Content-Type must be application/json.");
  }

  let raw: unknown;
  try {
    const text = await readLimitedText(request, MAX_BODY_BYTES);
    if (text === null) return fail(413, "Request is too large.");
    raw = JSON.parse(text);
  } catch {
    return fail(400, "Invalid request body.");
  }

  const parsed = parseApplication(raw);
  if (!parsed.ok) return fail(400, parsed.error);
  const { displayName, note, turnstileToken } = parsed.value;

  if (await getMember(env.DB, userId)) return fail(409, "You have already applied.");

  const check = await deps.verifyTurnstile(env, turnstileToken, request.headers.get("CF-Connecting-IP"));
  if (check === "unavailable") return fail(503, "Verification is unavailable right now. Try again shortly.");
  if (check === "failed") return fail(400, "Verification failed. Please try again.");

  const created = await createApplication(env.DB, userId, { displayName, note }, maxPending(env));
  if (created) {
    const body: MeResponse = { state: "pending", role: "member" };
    return json(body, 201);
  }

  // Nothing was added: this person applied in the meantime, or the waiting list is full.
  if (await getMember(env.DB, userId)) return fail(409, "You have already applied.");
  return fail(503, "Applications are temporarily closed. Please try again later.");
}

async function route(request: Request, env: Env, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  switch (pathname) {
    case "/api/health":
      return onlyMethod(request, "GET", () => health(env));
    case "/api/config":
      return onlyMethod(request, "GET", () => config(env));
    case "/api/me":
      return onlyMethod(request, "GET", () => me(request, env, deps));
    case "/api/apply":
      return onlyMethod(request, "POST", () => apply(request, env, deps));
    default:
      return fail(404, "Not found");
  }
}

// All API routing lives here. It is a plain function so tests can call it
// directly without starting the Workers runtime. Any unexpected failure
// (for example the database being unavailable) returns a generic 500 and
// never grants access.
export async function handleRequest(
  request: Request,
  env: Env,
  deps: Deps = defaultDeps,
): Promise<Response> {
  try {
    return await route(request, env, deps);
  } catch (err) {
    console.error("Unhandled error", err);
    return fail(500, "Internal error");
  }
}
