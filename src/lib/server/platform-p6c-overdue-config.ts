import "server-only";

const SUPABASE_SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,}$/;
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4096;

export const PLATFORM_P6C_OVERDUE_WORKER_ID =
  "nextjs:p6c-portal-overdue" as const;
export const PLATFORM_P6C_OVERDUE_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type PlatformP6COverdueDisabledConfig = Readonly<{ enabled: false }>;

export type PlatformP6COverdueEnabledConfig = Readonly<{
  enabled: true;
  supabaseUrl: string;
  supabaseSecretKey: string;
  triggerSecret: string;
  workerId: typeof PLATFORM_P6C_OVERDUE_WORKER_ID;
  maxClockSkewMs: number;
}>;

export type PlatformP6COverdueConfig =
  | PlatformP6COverdueDisabledConfig
  | PlatformP6COverdueEnabledConfig;

export type PlatformP6COverdueConfigurationErrorCode =
  | "missing_supabase_url"
  | "invalid_supabase_url"
  | "insecure_supabase_url"
  | "missing_supabase_secret_key"
  | "unsafe_supabase_secret_key"
  | "missing_trigger_secret"
  | "unsafe_trigger_secret";

export class PlatformP6COverdueConfigurationError extends Error {
  readonly code: PlatformP6COverdueConfigurationErrorCode;

  constructor(code: PlatformP6COverdueConfigurationErrorCode) {
    super("Platform P6C overdue notifications are not configured.");
    this.name = "PlatformP6COverdueConfigurationError";
    this.code = code;
  }
}

function invalidConfiguration(
  code: PlatformP6COverdueConfigurationErrorCode,
): never {
  throw new PlatformP6COverdueConfigurationError(code);
}

function readSupabaseUrl(value: string | undefined): string {
  if (!value) return invalidConfiguration("missing_supabase_url");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidConfiguration("invalid_supabase_url");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    return invalidConfiguration("invalid_supabase_url");
  }
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      isLoopback &&
      process.env.NODE_ENV !== "production"
    )
  ) {
    return invalidConfiguration("insecure_supabase_url");
  }
  return url.origin;
}

function readSupabaseSecretKey(value: string | undefined): string {
  if (!value) return invalidConfiguration("missing_supabase_secret_key");
  if (
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES
  ) {
    return invalidConfiguration("unsafe_supabase_secret_key");
  }
  if (SUPABASE_SECRET_KEY_PATTERN.test(value)) return value;

  const segments = value.split(".");
  if (segments.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(segments[1], "base64url").toString("utf8"),
      ) as { role?: unknown };
      if (payload.role === "service_role") return value;
    } catch {
      // Fall through to the single safe configuration error.
    }
  }
  return invalidConfiguration("unsafe_supabase_secret_key");
}

function readTriggerSecret(value: string | undefined): string {
  if (!value) return invalidConfiguration("missing_trigger_secret");
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    value.trim() !== value ||
    !/^[\x21-\x7e]+$/.test(value) ||
    bytes < MIN_SECRET_BYTES ||
    bytes > MAX_SECRET_BYTES
  ) {
    return invalidConfiguration("unsafe_trigger_secret");
  }
  return value;
}

export function isPlatformP6COverdueNotificationsEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED === "1";
}

export function loadPlatformP6COverdueConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformP6COverdueConfig {
  if (!isPlatformP6COverdueNotificationsEnabled(environment)) {
    return Object.freeze({ enabled: false });
  }

  return Object.freeze({
    enabled: true,
    supabaseUrl: readSupabaseUrl(environment.NEXT_PUBLIC_SUPABASE_URL),
    supabaseSecretKey: readSupabaseSecretKey(
      environment.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    ),
    triggerSecret: readTriggerSecret(
      environment.EVO_PLATFORM_P6C_OVERDUE_TRIGGER_SECRET,
    ),
    workerId: PLATFORM_P6C_OVERDUE_WORKER_ID,
    maxClockSkewMs: PLATFORM_P6C_OVERDUE_MAX_CLOCK_SKEW_MS,
  });
}
