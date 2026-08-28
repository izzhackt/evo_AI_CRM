import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { PlatformMessagingBackendConfig } from "./platform-messaging-backend-config.ts";

/**
 * Creates a backend-only Supabase client. The accepted credential is validated
 * by the neutral messaging backend config before it reaches this constructor.
 */
export function createPlatformSupabaseServiceClient(
  config: Pick<
    PlatformMessagingBackendConfig,
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
