import type { JWTVerifyGetKey } from "jose";
import type { ApiError, HealthResponse, MeResponse, PublicConfig } from "../shared/types";
import { bearerToken, issuerFor, remoteKeysFor, verifyAccessToken } from "./auth";
import type { Env } from "./env";
import { getMember } from "./members";

// Things tests replace so they do not need the network.
export interface Deps {
  getKeys(env: Env): JWTVerifyGetKey;
}

export const defaultDeps: Deps = {
  getKeys: (env) => remoteKeysFor(env.SUPABASE_URL),
};

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

function unauthorized(): Response {
  return json({ error: "Unauthorized" } satisfies ApiError, 401, { "WWW-Authenticate": "Bearer" });
}

function onlyGet(request: Request, handler: () => Response | Promise<Response>): Response | Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" } satisfies ApiError, 405, { Allow: "GET" });
  }
  return handler();
}

function isConfigured(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

function notConfigured(): Response {
  console.error("SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set");
  return json({ error: "Server is not configured" } satisfies ApiError, 500);
}

function health(env: Env): Response {
  const body: HealthResponse = { ok: true, app: env.APP_NAME, time: new Date().toISOString() };
  return json(body);
}

function config(env: Env): Response {
  if (!isConfigured(env)) return notConfigured();
  const body: PublicConfig = {
    appName: env.APP_NAME,
    supabaseUrl: env.SUPABASE_URL,
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY,
  };
  return json(body);
}

// Who am I, and what is the state of my account? Reveals only the caller's own state.
async function me(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (!isConfigured(env)) return notConfigured();

  const token = bearerToken(request);
  if (!token) return unauthorized();

  let userId: string;
  try {
    const user = await verifyAccessToken(token, deps.getKeys(env), issuerFor(env.SUPABASE_URL));
    userId = user.userId;
  } catch {
    return unauthorized();
  }

  const member = await getMember(env.DB, userId);
  const body: MeResponse = member
    ? { state: member.status, role: member.role }
    : { state: "none", role: null };
  return json(body);
}

async function route(request: Request, env: Env, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  switch (pathname) {
    case "/api/health":
      return onlyGet(request, () => health(env));
    case "/api/config":
      return onlyGet(request, () => config(env));
    case "/api/me":
      return onlyGet(request, () => me(request, env, deps));
    default:
      return json({ error: "Not found" } satisfies ApiError, 404);
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
    return json({ error: "Internal error" } satisfies ApiError, 500);
  }
}
