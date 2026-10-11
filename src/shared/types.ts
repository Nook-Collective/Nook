// Types shared by the Worker and the web app.

export interface HealthResponse {
  ok: true;
  app: string;
  time: string; // ISO 8601
}

export interface ApiError {
  error: string;
}

export type MemberStatus = "pending" | "approved" | "rejected" | "suspended";
export type MemberRole = "member" | "admin";

// "none" means signed in but has not applied (no row in the members table).
export type AccountState = MemberStatus | "none";

// Values the browser needs before sign-in. All of them are safe to be public.
export interface PublicConfig {
  appName: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  turnstileSiteKey: string;
}

export interface MeResponse {
  state: AccountState;
  role: MemberRole | null;
}

export interface ApplyRequest {
  displayName: string;
  note: string;
  turnstileToken: string;
}
