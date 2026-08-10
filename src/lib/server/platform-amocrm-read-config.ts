import "server-only";

import { normalizePlatformAmoCrmAccountDomain } from "../platform-amocrm-discovery-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const SUPABASE_SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,}$/;
const MIN_TOKEN_BYTES = 16;
const MAX_SECRET_BYTES = 4096;

export const PLATFORM_AMOCRM_READ_TIMEOUT_MS = 10_000;
export const PLATFORM_AMOCRM_READ_MAX_RESPONSE_BYTES = 128 * 1024;
export const PLATFORM_AMOCRM_READ_REQUEST_INTERVAL_MS = 200;

export type PlatformAmoCrmReadDisabledConfig = Readonly<{
  enabled: false;
}>;

export type PlatformAmoCrmReadBackendConfig = Readonly<{
  organizationId: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
}>;

export type PlatformAmoCrmReadEnabledConfig = PlatformAmoCrmReadBackendConfig & Readonly<{
  enabled: true;
  accountDomain: string;
  accountOrigin: string;
  accountSubdomain: string;
  accessToken: string;
  timeoutMs: number;
  maxResponseBytes: number;
  requestIntervalMs: number;
}>;

export type PlatformAmoCrmReadConfig =
  | PlatformAmoCrmReadDisabledConfig
  | PlatformAmoCrmReadEnabledConfig;

export type PlatformAmoCrmReadConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "missing_organization_id"
  | "invalid_organization_id"
  | "missing_supabase_url"
  | "invalid_supabase_url"
  | "insecure_supabase_url"
  | "missing_supabase_secret_key"
  | "unsafe_supabase_secret_key"
  | "missing_account_domain"
  | "invalid_account_domain"
  | "missing_read_token"
  | "unsafe_read_token";

export class PlatformAmoCrmReadConfigurationError extends Error {
  readonly code: PlatformAmoCrmReadConfigurationErrorCode;

  constructor(code: PlatformAmoCrmReadConfigurationErrorCode) {
    super("Platform amoCRM read access is not configured.");
    this.name = "PlatformAmoCrmReadConfigurationError";
    this.code = code;
  }
}

function invalidConfiguration(
  code: PlatformAmoCrmReadConfigurationErrorCode,
): never {
  throw new PlatformAmoCrmReadConfigurationError(code);
}

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  const segments = value.split(".");
  if (segments.length !== 3 || segments[1].length === 0) return null;

  try {
    const decoded = Buffer.from(segments[1], "base64url").toString("utf8");
    const payload = JSON.parse(decoded) as unknown;
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readEnabledFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  return invalidConfiguration("invalid_enabled_flag");
}

function readOrganizationId(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_organization_id");
  }
  if (value !== value.trim()) return invalidConfiguration("invalid_organization_id");
  if (!UUID_PATTERN.test(value)) return invalidConfiguration("invalid_organization_id");
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) return invalidConfiguration("invalid_organization_id");
  return normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function readSupabaseUrl(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_supabase_url");
  }
  if (value !== value.trim()) return invalidConfiguration("invalid_supabase_url");

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

function readAccountDomain(value: string | undefined) {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_account_domain");
  }
  if (value !== value.trim()) return invalidConfiguration("invalid_account_domain");
  try {
    return normalizePlatformAmoCrmAccountDomain(value);
  } catch {
    return invalidConfiguration("invalid_account_domain");
  }
}

function readAccessToken(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_read_token");
  }
  const normalized = value.trim();
  const byteLength = Buffer.byteLength(normalized, "utf8");
  if (
    normalized !== value ||
    byteLength < MIN_TOKEN_BYTES ||
    byteLength > MAX_SECRET_BYTES ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return invalidConfiguration("unsafe_read_token");
  }
  return normalized;
}

export function getPlatformAmoCrmReadBackendConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformAmoCrmReadBackendConfig {
  return Object.freeze({
    organizationId: readOrganizationId(environment.EVO_PLATFORM_ORGANIZATION_ID),
    supabaseUrl: readSupabaseUrl(environment.NEXT_PUBLIC_SUPABASE_URL),
    supabaseSecretKey: readSupabaseSecretKey(
      environment.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    ),
  });
}

export function getPlatformAmoCrmReadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformAmoCrmReadConfig {
  if (!readEnabledFlag(environment.EVO_PLATFORM_AMOCRM_READ_ENABLED)) {
    return Object.freeze({ enabled: false });
  }

  const backend = getPlatformAmoCrmReadBackendConfig(environment);
  const accountDomain = readAccountDomain(environment.EVO_PLATFORM_AMOCRM_ACCOUNT_DOMAIN);
  return Object.freeze({
    ...backend,
    enabled: true,
    accountDomain: accountDomain.domain,
    accountOrigin: accountDomain.origin,
    accountSubdomain: accountDomain.subdomain,
    accessToken: readAccessToken(environment.EVO_PLATFORM_AMOCRM_READ_TOKEN),
    timeoutMs: PLATFORM_AMOCRM_READ_TIMEOUT_MS,
    maxResponseBytes: PLATFORM_AMOCRM_READ_MAX_RESPONSE_BYTES,
    requestIntervalMs: PLATFORM_AMOCRM_READ_REQUEST_INTERVAL_MS,
  });
}
