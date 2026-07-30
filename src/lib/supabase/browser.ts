"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./config";

let browserClient: SupabaseClient | undefined;

/**
 * Lazily creates one browser client for the current page lifetime.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const config = getSupabasePublicConfig();
  browserClient = createBrowserClient(config.url, config.publishableKey);
  return browserClient;
}
