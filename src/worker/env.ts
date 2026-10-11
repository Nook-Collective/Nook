// Bindings and variables the Worker receives. Keep in sync with wrangler.jsonc.
export interface Env {
  APP_NAME: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  DB: D1Database;
}
