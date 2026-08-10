import "server-only";

import { isIP } from "node:net";

import {
  getPlatformWahaBackendConfig,
  PlatformWahaIngressConfigurationError,
  type PlatformWahaBackendConfig,
} from "./platform-waha-ingress-config.ts";

const INTERNAL_HOST_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:internal|local|localhost))?$/i;
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4096;

export const PLATFORM_WAHA_MEDIA_WORKER_REF =
  "nextjs:p5d-waha-media" as const;
export const PLATFORM_WAHA_MEDIA_BUCKET =
  "platform-whatsapp-media" as const;
export const PLATFORM_WAHA_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const PLATFORM_WAHA_MEDIA_METADATA_MAX_BYTES = 256 * 1024;
export const PLATFORM_WAHA_MEDIA_REQUEST_TIMEOUT_MS = 15_000;
export const PLATFORM_WAHA_MEDIA_VISIBILITY_TIMEOUT_SECONDS = 120;
export const PLATFORM_WAHA_MEDIA_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type PlatformWahaMediaDisabledConfig = Readonly<{
  enabled: false;
}>;

export type PlatformWahaMediaEnabledConfig = PlatformWahaBackendConfig &
  Readonly<{
    enabled: true;
    wahaBaseUrl: string;
    wahaApiKey: string;
    triggerSecret: string;
    workerRef: typeof PLATFORM_WAHA_MEDIA_WORKER_REF;
    bucket: typeof PLATFORM_WAHA_MEDIA_BUCKET;
    maxBytes: number;
    metadataMaxBytes: number;
    requestTimeoutMs: number;
    visibilityTimeoutSeconds: number;
    maxClockSkewMs: number;
  }>;

export type PlatformWahaMediaConfig =
  | PlatformWahaMediaDisabledConfig
  | PlatformWahaMediaEnabledConfig;

export type PlatformWahaMediaConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "platform_backend_not_configured"
  | "missing_waha_base_url"
  | "invalid_waha_base_url"
  | "unsafe_waha_base_url"
  | "missing_waha_api_key"
  | "unsafe_waha_api_key"
  | "missing_trigger_secret"
  | "unsafe_trigger_secret";

export class PlatformWahaMediaConfigurationError extends Error {
  readonly code: PlatformWahaMediaConfigurationErrorCode;

  constructor(code: PlatformWahaMediaConfigurationErrorCode) {
    super("Platform WAHA private media archive is not configured.");
    this.name = "PlatformWahaMediaConfigurationError";
    this.code = code;
  }
}

function invalidConfiguration(
  code: PlatformWahaMediaConfigurationErrorCode,
): never {
  throw new PlatformWahaMediaConfigurationError(code);
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
      return invalidConfiguration("platform_backend_not_configured");
    }
    throw error;
  }
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
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd")
    );
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
  if (
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") < MIN_SECRET_BYTES ||
    Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return invalidConfiguration(unsafeCode);
  }
  return value;
}

/**
 * Loads a separate, disabled-by-default media capability. It deliberately
 * reuses only the generic Platform Supabase backend identity; WAHA transport
 * and trigger credentials are not shared with ingress, history, or sending.
 */
export function loadPlatformWahaMediaConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformWahaMediaConfig {
  if (!readEnabledFlag(environment.EVO_PLATFORM_WAHA_MEDIA_ENABLED)) {
    return Object.freeze({ enabled: false });
  }

  const backend = requirePlatformBackend(environment);
  return Object.freeze({
    ...backend,
    enabled: true,
    wahaBaseUrl: readWahaBaseUrl(
      environment.EVO_PLATFORM_WAHA_MEDIA_BASE_URL,
    ),
    wahaApiKey: readSecret(
      environment.EVO_PLATFORM_WAHA_MEDIA_API_KEY,
      "missing_waha_api_key",
      "unsafe_waha_api_key",
    ),
    triggerSecret: readSecret(
      environment.EVO_PLATFORM_WAHA_MEDIA_TRIGGER_SECRET,
      "missing_trigger_secret",
      "unsafe_trigger_secret",
    ),
    workerRef: PLATFORM_WAHA_MEDIA_WORKER_REF,
    bucket: PLATFORM_WAHA_MEDIA_BUCKET,
    maxBytes: PLATFORM_WAHA_MEDIA_MAX_BYTES,
    metadataMaxBytes: PLATFORM_WAHA_MEDIA_METADATA_MAX_BYTES,
    requestTimeoutMs: PLATFORM_WAHA_MEDIA_REQUEST_TIMEOUT_MS,
    visibilityTimeoutSeconds: PLATFORM_WAHA_MEDIA_VISIBILITY_TIMEOUT_SECONDS,
    maxClockSkewMs: PLATFORM_WAHA_MEDIA_MAX_CLOCK_SKEW_MS,
  });
}
