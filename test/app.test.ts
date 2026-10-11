import { describe, expect, it } from "vitest";
import { handleRequest, type Deps } from "../src/worker/app";
import type { Env } from "../src/worker/env";
import type { ApiError, HealthResponse, MeResponse, PublicConfig } from "../src/shared/types";
import { brokenDb, fakeDb, makeEnv, makeSigner } from "./helpers";

const signer = await makeSigner();
const otherSigner = await makeSigner(); // a different key pair, for forged tokens
const deps: Deps = { getKeys: () => signer.keys };

function call(env: Env, path: string, init?: RequestInit): Promise<Response> {
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
  it("returns only public values", async () => {
    const res = await call(env, "/api/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicConfig;
    expect(body).toEqual({
      appName: "Test App",
      supabaseUrl: "https://testproject.supabase.co",
      supabasePublishableKey: "sb_publishable_test",
    });
  });

  it("returns 500 when Supabase settings are missing", async () => {
    const res = await call(makeEnv(fakeDb({}), { SUPABASE_URL: "" }), "/api/config");
    expect(res.status).toBe(500);
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
    const db = fakeDb({
      p1: { status: "pending", role: "member" },
      a1: { status: "approved", role: "member" },
      ad1: { status: "approved", role: "admin" },
      r1: { status: "rejected", role: "member" },
      s1: { status: "suspended", role: "member" },
    });
    const dbEnv = makeEnv(db);
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
    const text = await res.text();
    expect(text).not.toContain("database unavailable");
  });

  it("rejects non-GET methods", async () => {
    const res = await call(env, "/api/me", { method: "POST" });
    expect(res.status).toBe(405);
  });
});
