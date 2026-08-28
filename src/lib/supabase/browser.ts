"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SupabasePublicConfig } from "./config";

const browserClients = new Map<string, Map<string, SupabaseClient>>();

/**
 * Lazily creates one browser client per validated runtime public configuration.
 */
export function createSupabaseBrowserClient({
  url,
  publishableKey,
}: SupabasePublicConfig): SupabaseClient {
  const clientsForUrl = browserClients.get(url);
  const existingClient = clientsForUrl?.get(publishableKey);
  if (existingClient) return existingClient;

  const browserClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  if (clientsForUrl) {
    clientsForUrl.set(publishableKey, browserClient);
  } else {
    browserClients.set(url, new Map([[publishableKey, browserClient]]));
  }
  return browserClient;
}
