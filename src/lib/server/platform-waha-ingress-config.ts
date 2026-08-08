import "server-only";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const SUPABASE_SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,}$/;
const MIN_WEBHOOK_HMAC_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4096;

export const PLATFORM_WAHA_SESSION_NAME = "evo-inbox" as const;
export const PLATFORM_WAHA_MAX_BODY_BYTES = 512 * 1024;
export const PLATFORM_WAHA_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type PlatformWahaIngressDisabledConfig = Readonly<{
  enabled: false;
}>;

export type PlatformWahaIngressEnabledConfig = Readonly<{
  enabled: true;
  organizationId: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  webhookHmacSecret: string;
  sessionName: typeof PLATFORM_WAHA_SESSION_NAME;
  maxBodyBytes: number;
  maxClockSkewMs: number;
}>;

export type PlatformWahaIngressConfig =
  | PlatformWahaIngressDisabledConfig
  | PlatformWahaIngressEnabledConfig;

export type PlatformWahaIngressConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "missing_organization_id"
  | "invalid_organization_id"
  | "missing_supabase_url"
  | "invalid_supabase_url"
  | "insecure_supabase_url"
  | "missing_supabase_secret_key"
  | "unsafe_supabase_secret_key"
  | "missing_webhook_hmac_secret"
  | "unsafe_webhook_hmac_secret";

export class PlatformWahaIngressConfigurationError extends Error {
  readonly code: PlatformWahaIngressConfigurationErrorCode;

  constructor(code: PlatformWahaIngressConfigurationErrorCode) {
    super("Platform WAHA ingress is not configured.");
    this.name = "PlatformWahaIngressConfigurationError";
    this.code = code;
  }
}

function invalidConfiguration(
  code: PlatformWahaIngressConfigurationErrorCode,
): never {
  throw new PlatformWahaIngressConfigurationError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  const segments = value.split(".");
  if (segments.length !== 3 || segments[1].length === 0) return null;

  try {
    const decoded = Buffer.from(segments[1], "base64url").toString("utf8");
    const payload = JSON.parse(decoded) as unknown;
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function readEnabledFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value === "false") {
    return false;
  }
  if (value === "1" || value === "true") return true;
  return invalidConfiguration("invalid_enabled_flag");
}

function readOrganizationId(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_organization_id");
  }
  if (value !== value.trim() || !UUID_PATTERN.test(value)) {
    return invalidConfiguration("invalid_organization_id");
  }
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) {
    return invalidConfiguration("invalid_organization_id");
  }
  return normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function readSupabaseUrl(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_supabase_url");
  }
  if (value !== value.trim()) {
    return invalidConfiguration("invalid_supabase_url");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidConfiguration("invalid_supabase_url");
  }

  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    return invalidConfiguration("invalid_supabase_url");
  }

  if (parsed.protocol === "https:") return parsed.origin;
  if (
    parsed.protocol === "http:" &&
    process.env.NODE_ENV !== "production" &&
    isLoopbackHostname(parsed.hostname)
  ) {
    return parsed.origin;
  }
  return invalidConfiguration("insecure_supabase_url");
}

function readSupabaseSecretKey(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_supabase_secret_key");
  }
  if (value !== value.trim() || Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) {
    return invalidConfiguration("unsafe_supabase_secret_key");
  }

  if (SUPABASE_SECRET_KEY_PATTERN.test(value)) return value;

  const payload = decodeJwtPayload(value);
  if (payload?.role === "service_role") return value;

  return invalidConfiguration("unsafe_supabase_secret_key");
}

function readWebhookHmacSecret(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_webhook_hmac_secret");
  }
  const byteLength = Buffer.byteLength(value, "utf8");
  if (
    value !== value.trim() ||
    byteLength < MIN_WEBHOOK_HMAC_SECRET_BYTES ||
    byteLength > MAX_SECRET_BYTES
  ) {
    return invalidConfiguration("unsafe_webhook_hmac_secret");
  }
  return value;
}

/**
 * Reads the receive-only ingress configuration lazily. The route stays disabled
 * unless the feature flag is set explicitly; disabled mode does not require or
 * inspect any backend secret.
 */
export function getPlatformWahaIngressConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformWahaIngressConfig {
  if (!readEnabledFlag(environment.EVO_PLATFORM_WAHA_INGRESS_ENABLED)) {
    return Object.freeze({ enabled: false });
  }

  return Object.freeze({
    enabled: true,
    organizationId: readOrganizationId(environment.EVO_PLATFORM_ORGANIZATION_ID),
    supabaseUrl: readSupabaseUrl(environment.NEXT_PUBLIC_SUPABASE_URL),
    supabaseSecretKey: readSupabaseSecretKey(
      environment.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    ),
    webhookHmacSecret: readWebhookHmacSecret(
      environment.EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET,
    ),
    sessionName: PLATFORM_WAHA_SESSION_NAME,
    maxBodyBytes: PLATFORM_WAHA_MAX_BODY_BYTES,
    maxClockSkewMs: PLATFORM_WAHA_MAX_CLOCK_SKEW_MS,
  });
}
