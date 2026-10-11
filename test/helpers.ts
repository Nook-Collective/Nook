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

interface FakeRow {
  status: string;
  role: string;
}

// A tiny stand-in for D1 that supports only the one query the Worker runs.
// It records the bound values so tests can check they were parameters.
export function fakeDb(rows: Record<string, FakeRow>, calls: unknown[][] = []): D1Database {
  return {
    prepare(_sql: string) {
      return {
        bind(...values: unknown[]) {
          calls.push(values);
          return {
            async first() {
              return rows[String(values[0])] ?? null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
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
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    DB: db,
    ...overrides,
  };
}
