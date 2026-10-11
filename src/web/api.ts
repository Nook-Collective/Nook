import type { ApplyRequest, MeResponse, PublicConfig } from "../shared/types";

export class UnauthorizedError extends Error {}

// An error response from the server, with a message that is safe to show.
export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function fetchConfig(): Promise<PublicConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return (await res.json()) as PublicConfig;
}

export async function fetchMe(accessToken: string): Promise<MeResponse> {
  const res = await fetch("/api/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new UnauthorizedError("Sign-in not accepted");
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return (await res.json()) as MeResponse;
}

export async function submitApplication(accessToken: string, body: ApplyRequest): Promise<MeResponse> {
  const res = await fetch("/api/apply", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return (await res.json()) as MeResponse;
  if (res.status === 401) throw new UnauthorizedError("Sign-in not accepted");

  let message = "Could not submit your application. Try again.";
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data.error === "string") message = data.error;
  } catch {
    // Keep the generic message.
  }
  throw new ApiRequestError(message, res.status);
}
