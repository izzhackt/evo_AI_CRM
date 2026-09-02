import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
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
