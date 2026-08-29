import "server-only";

import { isIP } from "node:net";

const ALLOWED_WAHA_HOSTNAMES = new Set(["evo-inbox-waha", "evo-v2-waha"]);
const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MIN_API_KEY_BYTES = 16;
const MAX_API_KEY_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 64 * 1024;

export const CANONICAL_WAHA_PREFLIGHT_TIMEOUT_MS = 10_000;

export type CanonicalWahaPreflightBlockedReason =
  | "feature_disabled"
  | "provider_not_authorized"
  | "configuration_missing"
  | "configuration_invalid";

export type CanonicalWahaPreflightBlockedConfig = Readonly<{
  status: "blocked";
  reason: Exclude<
    CanonicalWahaPreflightBlockedReason,
    "configuration_invalid"
  >;
  missing?: readonly ("base_url" | "api_key" | "session_name")[];
}>;

export type CanonicalWahaPreflightReadyConfig = Readonly<{
  status: "ready";
  baseUrl: string;
  apiKey: string;
  sessionName: string;
  timeoutMs: number;
}>;

export type CanonicalWahaPreflightConfig =
  | CanonicalWahaPreflightBlockedConfig
  | CanonicalWahaPreflightReadyConfig;

export type CanonicalWahaPreflightAvailability =
  | Readonly<{
      status: "blocked";
      reason: CanonicalWahaPreflightBlockedReason;
      missing?: readonly ("base_url" | "api_key" | "session_name")[];
    }>
  | Readonly<{ status: "configured"; sessionName: string }>;

export type CanonicalWahaPreflightNotWorkingReason =
  | "provider_unreachable"
  | "provider_rejected"
  | "provider_malformed_response"
  | "session_name_mismatch"
  | "session_not_working";

export type CanonicalWahaPreflightRunResult =
  | Readonly<{
      status: "blocked";
      reason: CanonicalWahaPreflightBlockedReason;
      missing?: readonly ("base_url" | "api_key" | "session_name")[];
    }>
  | Readonly<{
      status: "working";
      sessionName: string;
      checkedAt: string;
    }>
  | Readonly<{
      status: "not-working";
      sessionName: string;
      checkedAt: string;
      reason: CanonicalWahaPreflightNotWorkingReason;
    }>;

export type CanonicalWahaPreflightConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "invalid_authorization_flag"
  | "invalid_base_url"
  | "unsafe_base_url"
  | "unsafe_api_key"
  | "invalid_session_name";

export class CanonicalWahaPreflightConfigurationError extends Error {
  readonly code: CanonicalWahaPreflightConfigurationErrorCode;

  constructor(code: CanonicalWahaPreflightConfigurationErrorCode) {
    super("Canonical WAHA preflight is not configured.");
    this.name = "CanonicalWahaPreflightConfigurationError";
    this.code = code;
  }
}

export type CanonicalWahaPreflightDependencies = Readonly<{
  fetch?: typeof fetch;
  now?: () => Date;
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
}>;

function flag(
  value: string | undefined,
  errorCode:
    | "invalid_enabled_flag"
    | "invalid_authorization_flag",
): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new CanonicalWahaPreflightConfigurationError(errorCode);
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
  const ipCandidate =
    normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1)
      : normalized;
  const ipVersion = isIP(ipCandidate);
  if (ipVersion === 4) return isPrivateIpv4(ipCandidate);
  if (ipVersion === 6) {
    return ipCandidate === "::1" || ipCandidate.startsWith("fc") || ipCandidate.startsWith("fd");
  }
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    ALLOWED_WAHA_HOSTNAMES.has(normalized)
  );
}

function readBaseUrl(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;
  if (value !== value.trim()) {
    throw new CanonicalWahaPreflightConfigurationError("invalid_base_url");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CanonicalWahaPreflightConfigurationError("invalid_base_url");
  }

  if (
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new CanonicalWahaPreflightConfigurationError("unsafe_base_url");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !isPrivateOrInternalHostname(url.hostname)
  ) {
    throw new CanonicalWahaPreflightConfigurationError("unsafe_base_url");
  }
  return url.origin;
}

function readApiKey(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;
  if (
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") < MIN_API_KEY_BYTES ||
    Buffer.byteLength(value, "utf8") > MAX_API_KEY_BYTES ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new CanonicalWahaPreflightConfigurationError("unsafe_api_key");
  }
  return value;
}

function readSessionName(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;
  if (value !== value.trim() || !SESSION_NAME_PATTERN.test(value)) {
    throw new CanonicalWahaPreflightConfigurationError("invalid_session_name");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new Error("provider_response_too_large");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("provider_response_too_large");
  }

  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function checkedAt(now: (() => Date) | undefined): string {
  const value = now ? now() : new Date();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError("Canonical WAHA preflight clock must return a valid Date.");
  }
  return value.toISOString();
}

function blocked(
  reason: CanonicalWahaPreflightBlockedReason,
  missing?: readonly ("base_url" | "api_key" | "session_name")[],
): CanonicalWahaPreflightRunResult {
  return missing
    ? Object.freeze({ status: "blocked", reason, missing })
    : Object.freeze({ status: "blocked", reason });
}

function notWorking(
  sessionName: string,
  reason: CanonicalWahaPreflightNotWorkingReason,
  now?: () => Date,
): CanonicalWahaPreflightRunResult {
  return Object.freeze({
    status: "not-working",
    sessionName,
    checkedAt: checkedAt(now),
    reason,
  });
}

export function loadCanonicalWahaPreflightConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CanonicalWahaPreflightConfig {
  if (
    !flag(
      environment.EVO_V2_WAHA_PREFLIGHT_ENABLED,
      "invalid_enabled_flag",
    )
  ) {
    return Object.freeze({ status: "blocked", reason: "feature_disabled" });
  }

  if (
    !flag(
      environment.EVO_V2_WAHA_PROVIDER_AUTHORIZED,
      "invalid_authorization_flag",
    )
  ) {
    return Object.freeze({
      status: "blocked",
      reason: "provider_not_authorized",
    });
  }

  const missing: ("base_url" | "api_key" | "session_name")[] = [];
  const baseUrl = readBaseUrl(environment.EVO_V2_WAHA_BASE_URL);
  if (baseUrl === null) missing.push("base_url");
  const apiKey = readApiKey(environment.EVO_V2_WAHA_API_KEY);
  if (apiKey === null) missing.push("api_key");
  const sessionName = readSessionName(environment.EVO_V2_WAHA_SESSION_NAME);
  if (sessionName === null) missing.push("session_name");

  if (baseUrl === null || apiKey === null || sessionName === null) {
    return Object.freeze({
      status: "blocked",
      reason: "configuration_missing",
      missing: Object.freeze(missing),
    });
  }

  return Object.freeze({
    status: "ready",
    baseUrl,
    apiKey,
    sessionName,
    timeoutMs: CANONICAL_WAHA_PREFLIGHT_TIMEOUT_MS,
  });
}

export function readCanonicalWahaPreflightAvailability(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CanonicalWahaPreflightAvailability {
  try {
    const config = loadCanonicalWahaPreflightConfig(environment);
    if (config.status === "ready") {
      return Object.freeze({
        status: "configured",
        sessionName: config.sessionName,
      });
    }
    return config;
  } catch (error) {
    if (error instanceof CanonicalWahaPreflightConfigurationError) {
      return Object.freeze({
        status: "blocked",
        reason: "configuration_invalid",
      });
    }
    throw error;
  }
}

export async function runCanonicalWahaPreflight(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: CanonicalWahaPreflightDependencies = {},
): Promise<CanonicalWahaPreflightRunResult> {
  let config: CanonicalWahaPreflightConfig;
  try {
    config = loadCanonicalWahaPreflightConfig(environment);
  } catch (error) {
    if (error instanceof CanonicalWahaPreflightConfigurationError) {
      return blocked("configuration_invalid");
    }
    throw error;
  }

  if (config.status === "blocked") {
    return blocked(config.reason, config.missing);
  }

  const fetchImpl = dependencies.fetch ?? fetch;
  const createTimeoutSignal =
    dependencies.createTimeoutSignal ??
    ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  const requestUrl = `${config.baseUrl}/api/sessions/${encodeURIComponent(config.sessionName)}`;

  let response: Response;
  try {
    response = await fetchImpl(requestUrl, {
      method: "GET",
      headers: Object.freeze({ "X-Api-Key": config.apiKey }),
      redirect: "error",
      signal: createTimeoutSignal(config.timeoutMs),
    });
  } catch {
    return notWorking(
      config.sessionName,
      "provider_unreachable",
      dependencies.now,
    );
  }

  if (!response.ok) {
    return notWorking(
      config.sessionName,
      "provider_rejected",
      dependencies.now,
    );
  }

  let value: unknown;
  try {
    value = await readBoundedJson(response);
  } catch {
    return notWorking(
      config.sessionName,
      "provider_malformed_response",
      dependencies.now,
    );
  }

  if (!isRecord(value) || typeof value.status !== "string") {
    return notWorking(
      config.sessionName,
      "provider_malformed_response",
      dependencies.now,
    );
  }
  if (value.name !== config.sessionName) {
    return notWorking(
      config.sessionName,
      "session_name_mismatch",
      dependencies.now,
    );
  }
  if (value.status !== "WORKING") {
    return notWorking(
      config.sessionName,
      "session_not_working",
      dependencies.now,
    );
  }

  return Object.freeze({
    status: "working",
    sessionName: config.sessionName,
    checkedAt: checkedAt(dependencies.now),
  });
}
