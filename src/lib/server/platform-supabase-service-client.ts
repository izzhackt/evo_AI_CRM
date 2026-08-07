import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { PlatformWahaIngressEnabledConfig } from "./platform-waha-ingress-config.ts";

/**
 * Creates a backend-only Supabase client. The accepted credential is validated
 * by the ingress config module before it reaches this constructor.
 */
export function createPlatformSupabaseServiceClient(
  config: Pick<
    PlatformWahaIngressEnabledConfig,
    "supabaseUrl" | "supabaseSecretKey"
  >,
): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
