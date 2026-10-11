import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublicConfig } from "../shared/types";

let client: SupabaseClient | undefined;

// One shared client. It stores the signed-in session in this browser.
export function getSupabase(config: PublicConfig): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { flowType: "pkce" },
    });
  }
  return client;
}
