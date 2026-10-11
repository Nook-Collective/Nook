import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { AuthError, bearerToken, issuerFor, verifyAccessToken } from "../src/worker/auth";
import { ISSUER, makeSigner } from "./helpers";

const signer = await makeSigner();

describe("issuerFor", () => {
  it("adds /auth/v1 and ignores trailing slashes", () => {
    expect(issuerFor("https://abc.supabase.co")).toBe("https://abc.supabase.co/auth/v1");
    expect(issuerFor("https://abc.supabase.co/")).toBe("https://abc.supabase.co/auth/v1");
  });
});

describe("bearerToken", () => {
  const req = (value?: string) =>
    new Request("http://localhost/", value ? { headers: { Authorization: value } } : undefined);

  it("extracts a bearer token", () => {
    expect(bearerToken(req("Bearer abc.def.ghi"))).toBe("abc.def.ghi");
  });

  it("returns null when missing or malformed", () => {
    expect(bearerToken(req())).toBeNull();
    expect(bearerToken(req("Basic abc"))).toBeNull();
    expect(bearerToken(req("Bearer"))).toBeNull();
    expect(bearerToken(req("Bearer a b"))).toBeNull();
  });

  it("returns null for oversized tokens", () => {
    expect(bearerToken(req(`Bearer ${"a".repeat(5000)}`))).toBeNull();
  });
});

describe("verifyAccessToken", () => {
  it("accepts a valid token and returns the user ID", async () => {
    const token = await signer.sign({ sub: "user-42" });
    await expect(verifyAccessToken(token, signer.keys, ISSUER)).resolves.toEqual({ userId: "user-42" });
  });

  it("rejects a token without a subject", async () => {
    const token = await signer.sign({ sub: null });
    await expect(verifyAccessToken(token, signer.keys, ISSUER)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a token without an expiry", async () => {
    const token = await signer.sign({ expiresAt: null });
    await expect(verifyAccessToken(token, signer.keys, ISSUER)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a token signed with a shared secret (HS256)", async () => {
    const token = await new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISSUER)
      .setSubject("user-1")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .sign(new TextEncoder().encode("a-shared-secret-of-some-length-1234"));
    await expect(verifyAccessToken(token, signer.keys, ISSUER)).rejects.toBeInstanceOf(AuthError);
  });
});
