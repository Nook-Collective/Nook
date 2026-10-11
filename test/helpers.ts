import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
} from "jose";
import type { Env } from "../src/worker/env";

export const SUPABASE_URL = "https://testproject.supabase.co";
export const ISSUER = `${SUPABASE_URL}/auth/v1`;

export interface SignOptions {
  sub?: string | null; // null = leave the claim out
  role?: string;
  issuer?: string;
  expiresAt?: number | null; // epoch seconds; null = leave the claim out
}

export interface TestSigner {
  keys: JWTVerifyGetKey; // public keys, as the Worker would fetch them
  sign(options?: SignOptions): Promise<string>;
}

// Makes a fresh key pair so tests never need the network or real secrets.
export async function makeSigner(): Promise<TestSigner> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });

  async function sign(options: SignOptions = {}): Promise<string> {
    const jwt = new SignJWT({ role: options.role ?? "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(options.issuer ?? ISSUER)
      .setIssuedAt();
    if (options.sub !== null) jwt.setSubject(options.sub ?? "user-1");
    if (options.expiresAt !== null) {
      jwt.setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1000) + 300);
    }
    return jwt.sign(privateKey);
  }

  return { keys, sign };
}

export interface FakeRow {
  status: string;
  role: string;
  displayName?: string;
  note?: string;
}

// A tiny stand-in for D1 that understands only the queries the Worker runs.
// It copies the SQL's rules in plain code, so these tests check the Worker's
// logic. The SQL itself is checked against a real database by hand (see README).
export function createFakeDb(initial: Record<string, FakeRow> = {}, calls: unknown[][] = []) {
  const rows = new Map<string, FakeRow>(Object.entries(initial));
  // `calls` collects every set of bound values, in order.

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          calls.push(values);
          return {
            async first() {
              if (!sql.includes("SELECT status, role")) throw new Error(`unexpected query: ${sql}`);
              return rows.get(String(values[0])) ?? null;
            },
            async run() {
              if (!sql.includes("INSERT INTO members")) throw new Error(`unexpected query: ${sql}`);
              const [userId, displayName, note, maxPending] = values as [string, string, string, number];
              const pending = [...rows.values()].filter((r) => r.status === "pending").length;
              if (rows.has(userId) || pending >= maxPending) return { meta: { changes: 0 } };
              rows.set(userId, { status: "pending", role: "member", displayName, note });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, rows, calls };
}

export function fakeDb(initial: Record<string, FakeRow> = {}, calls: unknown[][] = []): D1Database {
  return createFakeDb(initial, calls).db;
}

export function brokenDb(): D1Database {
  return {
    prepare() {
      throw new Error("database unavailable");
    },
  } as unknown as D1Database;
}

export function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    APP_NAME: "Test App",
    MAX_PENDING_APPLICATIONS: "50",
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    TURNSTILE_SITE_KEY: "test-site-key",
    TURNSTILE_SECRET_KEY: "test-secret-key",
    DB: db,
    ...overrides,
  };
}
