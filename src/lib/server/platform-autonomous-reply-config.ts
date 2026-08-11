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

export const PLATFORM_AUTONOMOUS_REPLY_POLICY_VERSION = "p5f3-v1" as const;
export const PLATFORM_AUTONOMOUS_REPLY_WORKER_REF =
  "nextjs:p5f3-autonomous-reply" as const;
export const PLATFORM_AUTONOMOUS_REPLY_BUSINESS_TIME_ZONE =
  "Asia/Bishkek" as const;
export const PLATFORM_AUTONOMOUS_REPLY_BUSINESS_START_MINUTE = 9 * 60;
export const PLATFORM_AUTONOMOUS_REPLY_BUSINESS_END_MINUTE = 21 * 60;
export const PLATFORM_AUTONOMOUS_REPLY_CONFIDENCE_MINIMUM = 85;
export const PLATFORM_AUTONOMOUS_REPLY_COOLDOWN_SECONDS = 60;
export const PLATFORM_AUTONOMOUS_REPLY_ROLLING_LIMIT = 6;
export const PLATFORM_AUTONOMOUS_REPLY_CONSECUTIVE_LIMIT = 3;
export const PLATFORM_AUTONOMOUS_REPLY_REQUEST_TIMEOUT_MS = 5_000;
export const PLATFORM_AUTONOMOUS_REPLY_VISIBILITY_TIMEOUT_SECONDS = 120;
export const PLATFORM_AUTONOMOUS_REPLY_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type PlatformAutonomousReplyDisabledConfig = Readonly<{
  enabled: false;
}>;

export type PlatformAutonomousReplyEnabledConfig = PlatformWahaBackendConfig &
  Readonly<{
    enabled: true;
    killSwitchEngaged: boolean;
    wahaBaseUrl: string;
    wahaApiKey: string;
    triggerSecret: string;
    workerRef: typeof PLATFORM_AUTONOMOUS_REPLY_WORKER_REF;
    policyVersion: typeof PLATFORM_AUTONOMOUS_REPLY_POLICY_VERSION;
    businessTimeZone: typeof PLATFORM_AUTONOMOUS_REPLY_BUSINESS_TIME_ZONE;
    businessStartMinute: number;
    businessEndMinute: number;
    confidenceMinimum: number;
    cooldownSeconds: number;
    rollingLimit: number;
    consecutiveLimit: number;
    requestTimeoutMs: number;
    visibilityTimeoutSeconds: number;
    maxClockSkewMs: number;
  }>;

export type PlatformAutonomousReplyConfig =
  | PlatformAutonomousReplyDisabledConfig
  | PlatformAutonomousReplyEnabledConfig;

export type PlatformAutonomousReplyConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "invalid_kill_switch_flag"
  | "platform_backend_not_configured"
  | "missing_waha_base_url"
  | "invalid_waha_base_url"
  | "unsafe_waha_base_url"
  | "missing_waha_api_key"
  | "unsafe_waha_api_key"
  | "missing_trigger_secret"
  | "unsafe_trigger_secret";

export class PlatformAutonomousReplyConfigurationError extends Error {
  readonly code: PlatformAutonomousReplyConfigurationErrorCode;

  constructor(code: PlatformAutonomousReplyConfigurationErrorCode) {
    super("Platform autonomous inbound replies are not configured.");
    this.name = "PlatformAutonomousReplyConfigurationError";
    this.code = code;
  }
}

function invalidConfiguration(
  code: PlatformAutonomousReplyConfigurationErrorCode,
): never {
  throw new PlatformAutonomousReplyConfigurationError(code);
}

function readEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value === "false") {
    return false;
  }
  if (value === "1" || value === "true") return true;
  return invalidConfiguration("invalid_enabled_flag");
}

function readKillSwitch(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "1" || value === "true") {
    return true;
  }
  if (value === "0" || value === "false") return false;
  return invalidConfiguration("invalid_kill_switch_flag");
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
    (url.protocol !== "http:" && url.protocol !== "https:") ||
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

export function loadPlatformAutonomousReplyConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformAutonomousReplyConfig {
  if (!readEnabled(environment.EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED)) {
    return Object.freeze({ enabled: false });
  }

  const backend = requirePlatformBackend(environment);
  return Object.freeze({
    ...backend,
    enabled: true,
    killSwitchEngaged: readKillSwitch(
      environment.EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH,
    ),
    wahaBaseUrl: readWahaBaseUrl(
      environment.EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_BASE_URL,
    ),
    wahaApiKey: readSecret(
      environment.EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_API_KEY,
      "missing_waha_api_key",
      "unsafe_waha_api_key",
    ),
    triggerSecret: readSecret(
      environment.EVO_PLATFORM_AUTONOMOUS_REPLIES_TRIGGER_SECRET,
      "missing_trigger_secret",
      "unsafe_trigger_secret",
    ),
    workerRef: PLATFORM_AUTONOMOUS_REPLY_WORKER_REF,
    policyVersion: PLATFORM_AUTONOMOUS_REPLY_POLICY_VERSION,
    businessTimeZone: PLATFORM_AUTONOMOUS_REPLY_BUSINESS_TIME_ZONE,
    businessStartMinute: PLATFORM_AUTONOMOUS_REPLY_BUSINESS_START_MINUTE,
    businessEndMinute: PLATFORM_AUTONOMOUS_REPLY_BUSINESS_END_MINUTE,
    confidenceMinimum: PLATFORM_AUTONOMOUS_REPLY_CONFIDENCE_MINIMUM,
    cooldownSeconds: PLATFORM_AUTONOMOUS_REPLY_COOLDOWN_SECONDS,
    rollingLimit: PLATFORM_AUTONOMOUS_REPLY_ROLLING_LIMIT,
    consecutiveLimit: PLATFORM_AUTONOMOUS_REPLY_CONSECUTIVE_LIMIT,
    requestTimeoutMs: PLATFORM_AUTONOMOUS_REPLY_REQUEST_TIMEOUT_MS,
    visibilityTimeoutSeconds:
      PLATFORM_AUTONOMOUS_REPLY_VISIBILITY_TIMEOUT_SECONDS,
    maxClockSkewMs: PLATFORM_AUTONOMOUS_REPLY_MAX_CLOCK_SKEW_MS,
  });
}
