import type { MeResponse, PublicConfig } from "../shared/types";

export class UnauthorizedError extends Error {}

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
