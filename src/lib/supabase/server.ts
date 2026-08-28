import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "./config";

export type SupabaseServerContext = Readonly<{
  client: SupabaseClient;
}>;

function createAnonymousSupabaseClient(): SupabaseClient {
  const config = getSupabasePublicConfig();
  return createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

/**
 * Temporary anonymous client for Supabase-backed business repositories that
 * expire in #429. It deliberately has no cookie/session storage and cannot be
 * used as a V2 access authority.
 */
export async function createSupabaseServerContext(): Promise<SupabaseServerContext> {
  return { client: createAnonymousSupabaseClient() };
}

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  return createAnonymousSupabaseClient();
}
