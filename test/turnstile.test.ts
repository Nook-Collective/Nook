import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "../src/worker/turnstile";

function fakeFetch(response: Response | Error) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return response;
  });
}

function asFetch(fn: ReturnType<typeof fakeFetch>): typeof fetch {
  return fn as unknown as typeof fetch;
}

describe("verifyTurnstile", () => {
  it("returns ok when Cloudflare says success", async () => {
    const fn = fakeFetch(new Response(JSON.stringify({ success: true })));
    await expect(verifyTurnstile("secret", "token", null, asFetch(fn))).resolves.toBe("ok");
  });

  it("returns failed when Cloudflare says the token is not valid", async () => {
    const fn = fakeFetch(new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] })));
    await expect(verifyTurnstile("secret", "token", null, asFetch(fn))).resolves.toBe("failed");
  });

  it("returns failed unless success is exactly true", async () => {
    const fn = fakeFetch(new Response(JSON.stringify({ success: "true" })));
    await expect(verifyTurnstile("secret", "token", null, asFetch(fn))).resolves.toBe("failed");
  });

  it("returns unavailable on an HTTP error, a network error, or unreadable output", async () => {
    const httpError = fakeFetch(new Response("oops", { status: 500 }));
    await expect(verifyTurnstile("s", "t", null, asFetch(httpError))).resolves.toBe("unavailable");
    const networkError = fakeFetch(new Error("network down"));
    await expect(verifyTurnstile("s", "t", null, asFetch(networkError))).resolves.toBe("unavailable");
    const garbage = fakeFetch(new Response("not json"));
    await expect(verifyTurnstile("s", "t", null, asFetch(garbage))).resolves.toBe("unavailable");
  });

  it("sends the secret, token, and client address by POST to Cloudflare", async () => {
    const fn = fakeFetch(new Response(JSON.stringify({ success: true })));
    await verifyTurnstile("my-secret", "my-token", "203.0.113.9", asFetch(fn));
    const [url, init] = fn.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init?.method).toBe("POST");
    const body = init?.body as URLSearchParams;
    expect(body.get("secret")).toBe("my-secret");
    expect(body.get("response")).toBe("my-token");
    expect(body.get("remoteip")).toBe("203.0.113.9");
  });

  it("leaves out the client address when it is unknown", async () => {
    const fn = fakeFetch(new Response(JSON.stringify({ success: true })));
    await verifyTurnstile("s", "t", null, asFetch(fn));
    const body = fn.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.has("remoteip")).toBe(false);
  });
});
