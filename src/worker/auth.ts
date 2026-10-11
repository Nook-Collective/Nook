import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

// Supabase Auth proves who a person is. This file checks that proof. It does
// NOT decide what the person may do: that comes from our own database.

export interface VerifiedUser {
  userId: string;
}

export class AuthError extends Error {}

// Only asymmetric algorithms. This blocks tokens signed with a shared secret
// or with the "none" algorithm.
const ALLOWED_ALGORITHMS = ["ES256", "RS256"];
const MAX_TOKEN_LENGTH = 4096;

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

export function issuerFor(supabaseUrl: string): string {
  return `${trimSlashes(supabaseUrl)}/auth/v1`;
}

// Fetching the public keys is cached for the life of the Worker instance.
const remoteKeySets = new Map<string, JWTVerifyGetKey>();

export function remoteKeysFor(supabaseUrl: string): JWTVerifyGetKey {
  const base = trimSlashes(supabaseUrl);
  let keys = remoteKeySets.get(base);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
    remoteKeySets.set(base, keys);
  }
  return keys;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const token = match?.[1];
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

// Throws AuthError for anything wrong with the token. The caller must not
// reveal the reason to the client.
export async function verifyAccessToken(
  token: string,
  keys: JWTVerifyGetKey,
  issuer: string,
): Promise<VerifiedUser> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      algorithms: ALLOWED_ALGORITHMS,
      requiredClaims: ["exp", "sub"],
    });
    // Tokens made with the public "anon" key have a different role.
    if (payload.role !== "authenticated") throw new AuthError("wrong role");
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new AuthError("missing subject");
    }
    return { userId: payload.sub };
  } catch {
    throw new AuthError("invalid token");
  }
}
