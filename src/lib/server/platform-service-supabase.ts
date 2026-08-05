import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class PlatformServiceSupabaseConfigError extends Error {
  readonly code = "platform_service_supabase_config_invalid";

  constructor() {
    super("Platform service Supabase configuration is invalid");
    this.name = "PlatformServiceSupabaseConfigError";
  }
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY",
): string {
  const value = environment[name];
  if (!value || value !== value.trim() || /[\r\n\0]/u.test(value)) {
    throw new PlatformServiceSupabaseConfigError();
  }
  return value;
}

function parseSupabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PlatformServiceSupabaseConfigError();
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname.replace(/\/+$/u, "") !== ""
  ) {
    throw new PlatformServiceSupabaseConfigError();
  }

  return parsed.toString().replace(/\/$/u, "");
}

export function createPlatformServiceSupabaseClient(
  environment: NodeJS.ProcessEnv = process.env,
): SupabaseClient {
  const supabaseUrl = parseSupabaseUrl(
    requiredEnvironmentValue(environment, "NEXT_PUBLIC_SUPABASE_URL"),
  );
  const serviceRoleKey = requiredEnvironmentValue(
    environment,
    "SUPABASE_SERVICE_ROLE_KEY",
  );

  if (
    serviceRoleKey.length < 32 ||
    serviceRoleKey === environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    serviceRoleKey === environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    throw new PlatformServiceSupabaseConfigError();
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        "X-Client-Info": "evo-platform-service-worker",
      },
    },
  });
}
