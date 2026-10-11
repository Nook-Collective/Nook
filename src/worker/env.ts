// Bindings and variables the Worker receives. Keep in sync with wrangler.jsonc.
export interface Env {
  APP_NAME: string;
  MAX_PENDING_APPLICATIONS: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string; // secret: never sent to the browser
  DB: D1Database;
}
