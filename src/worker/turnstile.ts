// Server-side check of a Turnstile token. The browser widget alone proves
// nothing, because tokens can be forged: this call to Cloudflare is the check.
// A token works once and expires after about five minutes.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// ok          = Cloudflare accepted the token.
// failed      = Cloudflare rejected it (bad, expired, or already used).
// unavailable = we could not get an answer. Treated as "no", never as "yes".
export type TurnstileResult = "ok" | "failed" | "unavailable";

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<TurnstileResult> {
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetchFn(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return "unavailable";
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? "ok" : "failed";
  } catch {
    return "unavailable";
  }
}
