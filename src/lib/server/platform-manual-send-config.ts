import "server-only";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const MIN_SECRET_BYTES = 32;

export const PLATFORM_MANUAL_SEND_WORKER_REF =
  "evo-crm-manual-send-worker-v1" as const;
export const PLATFORM_MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS = 60 as const;
export const PLATFORM_MANUAL_SEND_MAX_CLOCK_SKEW_MS = 30_000 as const;

export type PlatformManualSendDisabledConfig = Readonly<{ enabled: false }>;

export type PlatformManualSendEnabledConfig = Readonly<{
  enabled: true;
  organizationId: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  triggerSecret: string;
  workerRef: typeof PLATFORM_MANUAL_SEND_WORKER_REF;
  visibilityTimeoutSeconds: typeof PLATFORM_MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS;
  maxClockSkewMs: typeof PLATFORM_MANUAL_SEND_MAX_CLOCK_SKEW_MS;
}>;

export type PlatformManualSendConfig =
  | PlatformManualSendDisabledConfig
  | PlatformManualSendEnabledConfig;

export class PlatformManualSendConfigurationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Platform manual-send execution is not configured safely.");
    this.name = "PlatformManualSendConfigurationError";
    this.code = code;
  }
}

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function readEnabled(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "" || value === "0") return false;
  if (value === "1") return true;
  throw new PlatformManualSendConfigurationError("invalid_enabled_flag");
}

function readOrganizationId(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === undefined ||
    normalized === NIL_UUID ||
    !UUID_PATTERN.test(normalized)
  ) {
    throw new PlatformManualSendConfigurationError("missing_organization_id");
  }
  return normalized;
}

function readSupabaseUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value?.trim() ?? "");
  } catch {
    throw new PlatformManualSendConfigurationError("missing_supabase_url");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password) {
    throw new PlatformManualSendConfigurationError("unsafe_supabase_url");
  }
  return url.toString().replace(/\/$/, "");
}

function readSupabaseSecret(value: string | undefined): string {
  const normalized = value?.trim();
  if (
    normalized === undefined ||
    !normalized.startsWith("sb_secret_") ||
    bytes(normalized) < MIN_SECRET_BYTES ||
    /\s/.test(normalized)
  ) {
    throw new PlatformManualSendConfigurationError("missing_supabase_secret_key");
  }
  return normalized;
}

function readTriggerSecret(value: string | undefined): string {
  const normalized = value?.trim();
  if (
    normalized === undefined ||
    bytes(normalized) < MIN_SECRET_BYTES ||
    bytes(normalized) > 512 ||
    /[\r\n]/.test(normalized)
  ) {
    throw new PlatformManualSendConfigurationError("missing_trigger_secret");
  }
  return normalized;
}

export function loadPlatformManualSendConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformManualSendConfig {
  if (!readEnabled(environment.EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED)) {
    return Object.freeze({ enabled: false });
  }
  return Object.freeze({
    enabled: true,
    organizationId: readOrganizationId(environment.EVO_PLATFORM_ORGANIZATION_ID),
    supabaseUrl: readSupabaseUrl(environment.NEXT_PUBLIC_SUPABASE_URL),
    supabaseSecretKey: readSupabaseSecret(
      environment.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    ),
    triggerSecret: readTriggerSecret(
      environment.EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET,
    ),
    workerRef: PLATFORM_MANUAL_SEND_WORKER_REF,
    visibilityTimeoutSeconds: PLATFORM_MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS,
    maxClockSkewMs: PLATFORM_MANUAL_SEND_MAX_CLOCK_SKEW_MS,
  });
}
