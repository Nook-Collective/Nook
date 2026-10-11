import { describe, expect, it, vi } from "vitest";
import { handleRequest, type Deps } from "../src/worker/app";
import type { Env } from "../src/worker/env";
import type { TurnstileResult } from "../src/worker/turnstile";
import type { ApiError, HealthResponse, MeResponse, PublicConfig } from "../src/shared/types";
import { brokenDb, createFakeDb, fakeDb, makeEnv, makeSigner } from "./helpers";

const signer = await makeSigner();
const otherSigner = await makeSigner(); // a different key pair, for forged tokens

// Deps whose Turnstile check returns a fixed answer and records how it was called.
function makeDeps(answer: TurnstileResult = "ok") {
  const verifyTurnstile = vi.fn(
    async (_env: Env, _token: string, _ip: string | null): Promise<TurnstileResult> => answer,
  );
  const deps: Deps = { getKeys: () => signer.keys, verifyTurnstile };
  return { deps, verifyTurnstile };
}

function call(env: Env, path: string, init?: RequestInit, deps: Deps = makeDeps().deps): Promise<Response> {
  return handleRequest(new Request(`http://localhost${path}`, init), env, deps);
}

function withToken(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

const env = makeEnv(fakeDb({}));

describe("GET /api/health", () => {
  it("returns ok, the app name, and an ISO timestamp", async () => {
    const res = await call(env, "/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthResponse;
    expect(body.ok).toBe(true);
    expect(body.app).toBe("Test App");
    expect(new Date(body.time).toISOString()).toBe(body.time);
  });

  it("sends JSON and safety headers", async () => {
    const res = await call(env, "/api/health");
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects non-GET methods with 405 and an Allow header", async () => {
    const res = await call(env, "/api/health", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
  });
});

describe("unknown API paths", () => {
  it("returns a JSON 404", async () => {
    const res = await call(env, "/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiError).error).toBe("Not found");
  });
});

describe("GET /api/config", () => {
  it("returns only public values and never the Turnstile secret", async () => {
    const res = await call(env, "/api/config");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text) as PublicConfig).toEqual({
      appName: "Test App",
      supabaseUrl: "https://testproject.supabase.co",
      supabasePublishableKey: "sb_publishable_test",
      turnstileSiteKey: "test-site-key",
    });
    expect(text).not.toContain("test-secret-key");
  });

  it("returns 500 when a setting is missing", async () => {
    const noSupabase = await call(makeEnv(fakeDb({}), { SUPABASE_URL: "" }), "/api/config");
    expect(noSupabase.status).toBe(500);
    const noSiteKey = await call(makeEnv(fakeDb({}), { TURNSTILE_SITE_KEY: "" }), "/api/config");
    expect(noSiteKey.status).toBe(500);
  });
});

describe("GET /api/me", () => {
  it("rejects a request with no token", async () => {
    const res = await call(env, "/api/me");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("rejects a garbage token", async () => {
    const res = await call(env, "/api/me", withToken("not-a-token"));
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with a different key", async () => {
    const forged = await otherSigner.sign();
    const res = await call(env, "/api/me", withToken(forged));
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const expired = await signer.sign({ expiresAt: Math.floor(Date.now() / 1000) - 60 });
    const res = await call(env, "/api/me", withToken(expired));
    expect(res.status).toBe(401);
  });

  it("rejects a token from the wrong issuer", async () => {
    const token = await signer.sign({ issuer: "https://evil.example/auth/v1" });
    const res = await call(env, "/api/me", withToken(token));
    expect(res.status).toBe(401);
  });

  it("rejects a token that is not for a signed-in user", async () => {
    const token = await signer.sign({ role: "anon" });
    const res = await call(env, "/api/me", withToken(token));
    expect(res.status).toBe(401);
  });

  it("reports 'none' for a signed-in person who has not applied", async () => {
    const token = await signer.sign({ sub: "new-person" });
    const res = await call(env, "/api/me", withToken(token));
    expect(res.status).toBe(200);
    expect((await res.json()) as MeResponse).toEqual({ state: "none", role: null });
  });

  it("reports each account status and role from the database", async () => {
    const dbEnv = makeEnv(
      fakeDb({
        p1: { status: "pending", role: "member" },
        a1: { status: "approved", role: "member" },
        ad1: { status: "approved", role: "admin" },
        r1: { status: "rejected", role: "member" },
        s1: { status: "suspended", role: "member" },
      }),
    );
    const expected: Record<string, MeResponse> = {
      p1: { state: "pending", role: "member" },
      a1: { state: "approved", role: "member" },
      ad1: { state: "approved", role: "admin" },
      r1: { state: "rejected", role: "member" },
      s1: { state: "suspended", role: "member" },
    };
    for (const [sub, want] of Object.entries(expected)) {
      const res = await call(dbEnv, "/api/me", withToken(await signer.sign({ sub })));
      expect(res.status).toBe(200);
      expect((await res.json()) as MeResponse).toEqual(want);
    }
  });

  it("passes the user ID to the database as a bound parameter", async () => {
    const calls: unknown[][] = [];
    const dbEnv = makeEnv(fakeDb({}, calls));
    const sub = "x'; DROP TABLE members; --";
    await call(dbEnv, "/api/me", withToken(await signer.sign({ sub })));
    expect(calls).toEqual([[sub]]);
  });

  it("fails closed with a generic 500 when the database is unavailable", async () => {
    const res = await call(makeEnv(brokenDb()), "/api/me", withToken(await signer.sign()));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("database unavailable");
  });

  it("rejects non-GET methods", async () => {
    const res = await call(env, "/api/me", { method: "POST" });
    expect(res.status).toBe(405);
  });
});

describe("POST /api/apply", () => {
  const goodBody = { displayName: "  Sam  ", note: "Friend of Alex", turnstileToken: "widget-token" };

  async function post(
    testEnv: Env,
    deps: Deps,
    options: { body?: unknown; raw?: string; token?: string | null; contentType?: string | null } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { "CF-Connecting-IP": "203.0.113.9" };
    const token = options.token === undefined ? await signer.sign({ sub: "applicant" }) : options.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.contentType !== null) headers["Content-Type"] = options.contentType ?? "application/json";
    return call(
      testEnv,
      "/api/apply",
      { method: "POST", headers, body: options.raw ?? JSON.stringify(options.body ?? goodBody) },
      deps,
    );
  }

  it("creates a pending application and stores the cleaned-up values", async () => {
    const { db, rows } = createFakeDb();
    const { deps, verifyTurnstile } = makeDeps("ok");
    const res = await post(makeEnv(db), deps);
    expect(res.status).toBe(201);
    expect((await res.json()) as MeResponse).toEqual({ state: "pending", role: "member" });
    expect(rows.get("applicant")).toEqual({
      status: "pending",
      role: "member",
      displayName: "Sam",
      note: "Friend of Alex",
    });
    expect(verifyTurnstile).toHaveBeenCalledTimes(1);
    expect(verifyTurnstile.mock.calls[0]?.slice(1)).toEqual(["widget-token", "203.0.113.9"]);
  });

  it("rejects requests without a valid sign-in, before doing anything else", async () => {
    const { db, rows } = createFakeDb();
    const { deps, verifyTurnstile } = makeDeps();
    const none = await post(makeEnv(db), deps, { token: null });
    expect(none.status).toBe(401);
    const forged = await post(makeEnv(db), deps, { token: await otherSigner.sign() });
    expect(forged.status).toBe(401);
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it("rejects a body that is not JSON content", async () => {
    const { db } = createFakeDb();
    const { deps } = makeDeps();
    const wrongType = await post(makeEnv(db), deps, { contentType: "text/plain" });
    expect(wrongType.status).toBe(415);
    const missingType = await post(makeEnv(db), deps, { contentType: null });
    expect(missingType.status).toBe(415);
    const broken = await post(makeEnv(db), deps, { raw: "{not json" });
    expect(broken.status).toBe(400);
  });

  it("rejects an oversized body", async () => {
    const { db } = createFakeDb();
    const { deps, verifyTurnstile } = makeDeps();
    const huge = { ...goodBody, note: "a".repeat(20000) };
    const res = await post(makeEnv(db), deps, { body: huge });
    expect(res.status).toBe(413);
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });

  it("rejects invalid fields without calling Cloudflare or touching the database", async () => {
    const { db, rows } = createFakeDb();
    const { deps, verifyTurnstile } = makeDeps();
    const res = await post(makeEnv(db), deps, { body: { ...goodBody, displayName: "   " } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).error).toBe("Enter a name.");
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it("returns 409 for someone who already applied, without calling Cloudflare", async () => {
    const { db, rows } = createFakeDb({ applicant: { status: "rejected", role: "member" } });
    const { deps, verifyTurnstile } = makeDeps();
    const res = await post(makeEnv(db), deps);
    expect(res.status).toBe(409);
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(rows.get("applicant")?.status).toBe("rejected");
  });

  it("refuses when the verification check fails, and stores nothing", async () => {
    const { db, rows } = createFakeDb();
    const res = await post(makeEnv(db), makeDeps("failed").deps);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).error).toContain("Verification failed");
    expect(rows.size).toBe(0);
  });

  it("refuses with 503 when Cloudflare cannot be reached, and stores nothing", async () => {
    const { db, rows } = createFakeDb();
    const res = await post(makeEnv(db), makeDeps("unavailable").deps);
    expect(res.status).toBe(503);
    expect(rows.size).toBe(0);
  });

  it("closes applications when the waiting list is full", async () => {
    const { db, rows } = createFakeDb({ someone: { status: "pending", role: "member" } });
    const res = await post(makeEnv(db, { MAX_PENDING_APPLICATIONS: "1" }), makeDeps().deps);
    expect(res.status).toBe(503);
    expect(((await res.json()) as ApiError).error).toContain("temporarily closed");
    expect(rows.has("applicant")).toBe(false);
  });

  it("closes applications when the limit setting is not a whole number", async () => {
    const { db, rows } = createFakeDb();
    const res = await post(makeEnv(db, { MAX_PENDING_APPLICATIONS: "lots" }), makeDeps().deps);
    expect(res.status).toBe(503);
    expect(rows.size).toBe(0);
  });

  it("returns 500 when the Turnstile secret is not set", async () => {
    const { db } = createFakeDb();
    const res = await post(makeEnv(db, { TURNSTILE_SECRET_KEY: "" }), makeDeps().deps);
    expect(res.status).toBe(500);
  });

  it("only accepts POST", async () => {
    const res = await call(env, "/api/apply");
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});
