import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  hasSupabaseAuthCookie,
  isSupabaseAuthCookieName,
} from "./auth-cookies";
import { getSupabasePublicConfig, type SupabasePublicConfig } from "./config";

export type SupabaseServerContext = Readonly<{
  client: SupabaseClient;
  authCookiePresent: boolean;
}>;

/**
 * Removes every Supabase auth-token cookie scoped to this application origin.
 * This is the fail-closed fallback when the Auth service cannot complete a
 * local sign-out request. PKCE verifier and unrelated application cookies are
 * deliberately left untouched.
 */
export async function clearSupabaseAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (isSupabaseAuthCookieName(name)) cookieStore.delete(name);
  }
}

function createClient(
  config: SupabasePublicConfig,
  cookieMethods: CookieMethodsServer,
): SupabaseClient {
  return createServerClient(config.url, config.publishableKey, {
    cookies: cookieMethods,
  });
}

/**
 * Lower-level constructor for proxy/route code that owns both the incoming
 * cookie reader and outgoing response cookie writer.
 */
export function createSupabaseServerClientFromCookies(
  cookieMethods: CookieMethodsServer,
): SupabaseClient {
  return createClient(getSupabasePublicConfig(), cookieMethods);
}

function isReadOnlyServerComponentCookieError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ReadonlyRequestCookiesError" ||
      error.message.includes("Cookies can only be modified"))
  );
}

/**
 * Creates a fresh request-scoped server client. Next.js 16 cookies are
 * asynchronous, so callers must await this function.
 */
export async function createSupabaseServerContext(): Promise<SupabaseServerContext> {
  const config = getSupabasePublicConfig();
  const cookieStore = await cookies();
  const requestCookies = cookieStore.getAll();

  const client = createClient(config, {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch (error) {
        // Server Components may read but cannot write cookies. Proxy/route
        // code must use createSupabaseServerClientFromCookies so refreshes are
        // written to the response. Unexpected write failures still propagate.
        if (!isReadOnlyServerComponentCookieError(error)) throw error;
      }
    },
  });

  return {
    client,
    authCookiePresent: hasSupabaseAuthCookie(requestCookies, config.url),
  };
}

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  return (await createSupabaseServerContext()).client;
}
