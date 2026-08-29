import "server-only";

const MIN_API_KEY_BYTES = 16;
const MAX_API_KEY_BYTES = 4_096;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

export type CanonicalGeminiProposalBlockedReason =
  | "feature_disabled"
  | "provider_not_authorized"
  | "configuration_missing"
  | "configuration_invalid";

export type CanonicalGeminiProposalBlockedConfig = Readonly<{
  status: "blocked";
  reason: Exclude<
    CanonicalGeminiProposalBlockedReason,
    "configuration_invalid"
  >;
  missing?: readonly ("api_key" | "model")[];
}>;

export type CanonicalGeminiProposalReadyConfig = Readonly<{
  status: "ready";
  apiKey: string;
  model: string;
  timeoutMs: number;
}>;

export type CanonicalGeminiProposalConfig =
  | CanonicalGeminiProposalBlockedConfig
  | CanonicalGeminiProposalReadyConfig;

export type CanonicalGeminiProposalConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "invalid_authorization_flag"
  | "invalid_timeout";

export class CanonicalGeminiProposalConfigurationError extends Error {
  readonly code: CanonicalGeminiProposalConfigurationErrorCode;

  constructor(code: CanonicalGeminiProposalConfigurationErrorCode) {
    super("Canonical Gemini proposal execution is not configured.");
    this.name = "CanonicalGeminiProposalConfigurationError";
    this.code = code;
  }
}

function flag(
  value: string | undefined,
  errorCode:
    | "invalid_enabled_flag"
    | "invalid_authorization_flag",
): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new CanonicalGeminiProposalConfigurationError(errorCode);
}

function validApiKey(value: string | undefined): value is string {
  if (!value || value.trim() !== value) return false;
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= MIN_API_KEY_BYTES && bytes <= MAX_API_KEY_BYTES;
}

function validModel(value: string | undefined): value is string {
  return typeof value === "string" && MODEL_PATTERN.test(value);
}

function timeout(value: string | undefined): number {
  const parsed = Number(value ?? String(DEFAULT_TIMEOUT_MS));
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_TIMEOUT_MS ||
    parsed > MAX_TIMEOUT_MS
  ) {
    throw new CanonicalGeminiProposalConfigurationError("invalid_timeout");
  }
  return parsed;
}

export function loadCanonicalGeminiProposalConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CanonicalGeminiProposalConfig {
  if (
    !flag(
      environment.EVO_V2_GEMINI_PROPOSALS_ENABLED,
      "invalid_enabled_flag",
    )
  ) {
    return Object.freeze({ status: "blocked", reason: "feature_disabled" });
  }
  if (
    !flag(
      environment.EVO_V2_GEMINI_PROVIDER_AUTHORIZED,
      "invalid_authorization_flag",
    )
  ) {
    return Object.freeze({
      status: "blocked",
      reason: "provider_not_authorized",
    });
  }

  const missing: ("api_key" | "model")[] = [];
  if (!validApiKey(environment.EVO_V2_GEMINI_API_KEY)) missing.push("api_key");
  if (!validModel(environment.EVO_V2_GEMINI_MODEL)) missing.push("model");
  if (missing.length > 0) {
    return Object.freeze({
      status: "blocked",
      reason: "configuration_missing",
      missing: Object.freeze(missing),
    });
  }

  return Object.freeze({
    status: "ready",
    apiKey: environment.EVO_V2_GEMINI_API_KEY!,
    model: environment.EVO_V2_GEMINI_MODEL!,
    timeoutMs: timeout(environment.EVO_V2_GEMINI_TIMEOUT_MS),
  });
}

export type CanonicalGeminiProposalAvailability =
  | Readonly<{
      status: "blocked";
      reason: CanonicalGeminiProposalBlockedReason;
      missing?: readonly ("api_key" | "model")[];
    }>
  | Readonly<{ status: "ready"; model: string }>;

export function readCanonicalGeminiProposalAvailability(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CanonicalGeminiProposalAvailability {
  try {
    const config = loadCanonicalGeminiProposalConfig(environment);
    if (config.status === "ready") {
      return Object.freeze({ status: "ready", model: config.model });
    }
    return config;
  } catch (error) {
    if (error instanceof CanonicalGeminiProposalConfigurationError) {
      return Object.freeze({
        status: "blocked",
        reason: "configuration_invalid",
      });
    }
    throw error;
  }
}
