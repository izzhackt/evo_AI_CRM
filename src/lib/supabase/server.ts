import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getSupabasePublicConfig } from "./config.ts";

export type SupabaseServerContext = Readonly<{
  client: SupabaseClient;
}>;

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const config = getSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. The root proxy refreshes
          // them before protected rendering; Actions and Route Handlers can
          // write them normally.
        }
      },
    },
  });
}

export async function createSupabaseServerContext(): Promise<SupabaseServerContext> {
  return { client: await createSupabaseServerClient() };
}

/**
 * PORT-8a (ADR 0030 «Решение» п. 2): a request-scoped client for the native
 * bearer transport of the two student document route handlers. Every
 * PostgREST call carries the caller's own access token (`auth.uid()` comes
 * from that token), the cookie store is deliberately not connected, and no
 * session is persisted or refreshed. The token itself is verified separately
 * with `auth.getClaims(<jwt>)` before any authority is derived from it.
 */
export function createSupabaseBearerServerClient(
  accessToken: string,
): SupabaseClient {
  const config = getSupabasePublicConfig();
  return createClient(config.url, config.publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
