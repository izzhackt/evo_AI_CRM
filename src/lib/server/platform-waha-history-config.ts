import "server-only";

import { isIP } from "node:net";

import {
  getPlatformWahaBackendConfig,
  PlatformWahaIngressConfigurationError,
  type PlatformWahaBackendConfig,
} from "./platform-waha-ingress-config.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const INTERNAL_HOST_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:internal|local|localhost))?$/i;
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4096;

export const PLATFORM_WAHA_HISTORY_WORKER_REF =
  "nextjs:p5c-waha-history" as const;
export const PLATFORM_WAHA_HISTORY_CHAT_PAGE_LIMIT = 25;
export const PLATFORM_WAHA_HISTORY_MESSAGE_PAGE_LIMIT = 50;
export const PLATFORM_WAHA_HISTORY_MAX_PROVIDER_PAGES = 25;
export const PLATFORM_WAHA_HISTORY_MAX_RUNTIME_MS = 30_000;
export const PLATFORM_WAHA_HISTORY_REQUEST_TIMEOUT_MS = 5_000;

export type PlatformWahaHistoryDisabledConfig = Readonly<{
  enabled: false;
}>;

export type PlatformWahaHistoryEnabledConfig = Readonly<{
  enabled: true;
  organizationId: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  sessionName: "evo-inbox";
  intakeSalesMembershipId: string;
  wahaBaseUrl: string;
  wahaApiKey: string;
  triggerSecret: string;
  workerRef: typeof PLATFORM_WAHA_HISTORY_WORKER_REF;
  chatPageLimit: number;
  messagePageLimit: number;
  maxProviderPages: number;
  maxRuntimeMs: number;
  requestTimeoutMs: number;
}>;

export type PlatformWahaHistoryConfig =
  | PlatformWahaHistoryDisabledConfig
  | PlatformWahaHistoryEnabledConfig;

export type PlatformWahaHistoryConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "ingress_not_configured"
  | "missing_sales_membership_id"
  | "invalid_sales_membership_id"
  | "missing_waha_base_url"
  | "invalid_waha_base_url"
  | "unsafe_waha_base_url"
  | "missing_waha_api_key"
  | "unsafe_waha_api_key"
  | "missing_trigger_secret"
  | "unsafe_trigger_secret";

export class PlatformWahaHistoryConfigurationError extends Error {
  readonly code: PlatformWahaHistoryConfigurationErrorCode;

  constructor(code: PlatformWahaHistoryConfigurationErrorCode) {
    super("Platform WAHA history reconciliation is not configured.");
    this.name = "PlatformWahaHistoryConfigurationError";
    this.code = code;
  }
}

function invalidConfiguration(
  code: PlatformWahaHistoryConfigurationErrorCode,
): never {
  throw new PlatformWahaHistoryConfigurationError(code);
}

function readEnabledFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value === "false") {
    return false;
  }
  if (value === "1" || value === "true") return true;
  return invalidConfiguration("invalid_enabled_flag");
}

function requirePlatformBackend(
  environment: NodeJS.ProcessEnv,
): PlatformWahaBackendConfig {
  try {
    return getPlatformWahaBackendConfig(environment);
  } catch (error) {
    if (error instanceof PlatformWahaIngressConfigurationError) {
      return invalidConfiguration("ingress_not_configured");
    }
    throw error;
  }
}

function readMembershipId(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_sales_membership_id");
  }
  if (value !== value.trim() || !UUID_PATTERN.test(value)) {
    return invalidConfiguration("invalid_sales_membership_id");
  }
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) {
    return invalidConfiguration("invalid_sales_membership_id");
  }
  return normalized;
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) {
    return false;
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isPrivateOrInternalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) {
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd");
  }
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    INTERNAL_HOST_PATTERN.test(normalized)
  );
}

function readWahaBaseUrl(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_waha_base_url");
  }
  if (value !== value.trim()) {
    return invalidConfiguration("invalid_waha_base_url");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidConfiguration("invalid_waha_base_url");
  }

  if (
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return invalidConfiguration("unsafe_waha_base_url");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !isPrivateOrInternalHostname(url.hostname)
  ) {
    return invalidConfiguration("unsafe_waha_base_url");
  }
  return url.origin;
}

function readSecret(
  value: string | undefined,
  missingCode: "missing_waha_api_key" | "missing_trigger_secret",
  unsafeCode: "unsafe_waha_api_key" | "unsafe_trigger_secret",
): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration(missingCode);
  }
  if (value !== value.trim()) return invalidConfiguration(unsafeCode);
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength < MIN_SECRET_BYTES || byteLength > MAX_SECRET_BYTES) {
    return invalidConfiguration(unsafeCode);
  }
  return value;
}

export function loadPlatformWahaHistoryConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformWahaHistoryConfig {
  if (!readEnabledFlag(environment.EVO_PLATFORM_WAHA_HISTORY_ENABLED)) {
    return Object.freeze({ enabled: false });
  }

  const backend = requirePlatformBackend(environment);
  return Object.freeze({
    enabled: true,
    organizationId: backend.organizationId,
    supabaseUrl: backend.supabaseUrl,
    supabaseSecretKey: backend.supabaseSecretKey,
    sessionName: backend.sessionName,
    intakeSalesMembershipId: readMembershipId(
      environment.EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID,
    ),
    wahaBaseUrl: readWahaBaseUrl(environment.EVO_PLATFORM_WAHA_HISTORY_BASE_URL),
    wahaApiKey: readSecret(
      environment.EVO_PLATFORM_WAHA_HISTORY_API_KEY,
      "missing_waha_api_key",
      "unsafe_waha_api_key",
    ),
    triggerSecret: readSecret(
      environment.EVO_PLATFORM_WAHA_HISTORY_TRIGGER_SECRET,
      "missing_trigger_secret",
      "unsafe_trigger_secret",
    ),
    workerRef: PLATFORM_WAHA_HISTORY_WORKER_REF,
    chatPageLimit: PLATFORM_WAHA_HISTORY_CHAT_PAGE_LIMIT,
    messagePageLimit: PLATFORM_WAHA_HISTORY_MESSAGE_PAGE_LIMIT,
    maxProviderPages: PLATFORM_WAHA_HISTORY_MAX_PROVIDER_PAGES,
    maxRuntimeMs: PLATFORM_WAHA_HISTORY_MAX_RUNTIME_MS,
    requestTimeoutMs: PLATFORM_WAHA_HISTORY_REQUEST_TIMEOUT_MS,
  });
}
