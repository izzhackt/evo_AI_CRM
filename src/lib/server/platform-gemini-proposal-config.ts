import "server-only";

import {
  PLATFORM_GEMINI_PROPOSAL_MODEL,
  PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION,
  type PlatformGeminiFailureCode,
} from "../platform-gemini-proposals.ts";

const SUPABASE_SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,}$/;
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4096;
const MIN_API_KEY_BYTES = 16;
const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

export { PLATFORM_GEMINI_PROPOSAL_MODEL };

export const PLATFORM_GEMINI_PROPOSAL_PROMPT_POLICY_VERSION =
  "p5f2-gemini-proposal-v1" as const;
export const PLATFORM_GEMINI_PROPOSAL_MAX_OUTPUT_TOKENS = 2_048;
export const PLATFORM_GEMINI_PROPOSAL_MAX_REQUEST_BODY_BYTES = 4_096;

export type PlatformGeminiProposalDisabledConfig = Readonly<{
  enabled: false;
}>;

type ProviderUnavailable = Readonly<{
  ready: false;
  failureCode: Extract<PlatformGeminiFailureCode, "configuration_missing">;
}>;

type ProviderReady = Readonly<{
  ready: true;
  apiKey: string;
}>;

export type PlatformGeminiProposalEnabledConfig = Readonly<{
  enabled: true;
  supabaseUrl: string;
  supabaseSecretKey: string;
  hmacSecret: string;
  modelRef: typeof PLATFORM_GEMINI_PROPOSAL_MODEL;
  schemaVersion: typeof PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION;
  promptPolicyVersion: typeof PLATFORM_GEMINI_PROPOSAL_PROMPT_POLICY_VERSION;
  timeoutMs: number;
  maxOutputTokens: typeof PLATFORM_GEMINI_PROPOSAL_MAX_OUTPUT_TOKENS;
  maxRequestBodyBytes: typeof PLATFORM_GEMINI_PROPOSAL_MAX_REQUEST_BODY_BYTES;
  provider: ProviderReady | ProviderUnavailable;
}>;

export type PlatformGeminiProposalConfig =
  | PlatformGeminiProposalDisabledConfig
  | PlatformGeminiProposalEnabledConfig;

export type PlatformGeminiProposalConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "missing_supabase_url"
  | "invalid_supabase_url"
  | "insecure_supabase_url"
  | "missing_supabase_secret_key"
  | "invalid_supabase_secret_key"
  | "missing_hmac_secret"
  | "unsafe_hmac_secret";

export class PlatformGeminiProposalConfigurationError extends Error {
  readonly code: PlatformGeminiProposalConfigurationErrorCode;

  constructor(code: PlatformGeminiProposalConfigurationErrorCode) {
    super("Platform Gemini proposal execution is not configured.");
    this.name = "PlatformGeminiProposalConfigurationError";
    this.code = code;
  }
}

function fail(code: PlatformGeminiProposalConfigurationErrorCode): never {
  throw new PlatformGeminiProposalConfigurationError(code);
}

function readEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  return fail("invalid_enabled_flag");
}

function readSupabaseUrl(value: string | undefined): string {
  if (!value) return fail("missing_supabase_url");
  if (value.trim() !== value) return fail("invalid_supabase_url");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("invalid_supabase_url");
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    return fail("invalid_supabase_url");
  }
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !isLocalHttp) {
    return fail("insecure_supabase_url");
  }
  return url.origin;
}

function readSupabaseSecret(value: string | undefined): string {
  if (!value) return fail("missing_supabase_secret_key");
  if (value.trim() !== value || !SUPABASE_SECRET_KEY_PATTERN.test(value)) {
    return fail("invalid_supabase_secret_key");
  }
  return value;
}

function readHmacSecret(value: string | undefined): string {
  if (!value) return fail("missing_hmac_secret");
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    value.trim() !== value ||
    bytes < MIN_SECRET_BYTES ||
    bytes > MAX_SECRET_BYTES
  ) {
    return fail("unsafe_hmac_secret");
  }
  return value;
}

function readProvider(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<{
  provider: ProviderReady | ProviderUnavailable;
  timeoutMs: number;
}> {
  const configuredModel = environment.EVO_PLATFORM_GEMINI_PROPOSAL_MODEL;
  const apiKey = environment.EVO_PLATFORM_GEMINI_API_KEY;
  const timeoutValue =
    environment.EVO_PLATFORM_GEMINI_PROPOSAL_TIMEOUT_MS ??
    String(DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number(timeoutValue);
  const apiKeyBytes = apiKey ? Buffer.byteLength(apiKey, "utf8") : 0;
  const validApiKey =
    typeof apiKey === "string" &&
    apiKey.trim() === apiKey &&
    /^[\x21-\x7e]+$/.test(apiKey) &&
    apiKeyBytes >= MIN_API_KEY_BYTES &&
    apiKeyBytes <= MAX_SECRET_BYTES;
  const validTimeout =
    /^\d+$/.test(timeoutValue) &&
    Number.isSafeInteger(timeoutMs) &&
    timeoutMs >= MIN_TIMEOUT_MS &&
    timeoutMs <= MAX_TIMEOUT_MS;

  if (
    configuredModel !== PLATFORM_GEMINI_PROPOSAL_MODEL ||
    !validApiKey ||
    !validTimeout
  ) {
    return {
      provider: Object.freeze({
        ready: false,
        failureCode: "configuration_missing",
      }),
      timeoutMs: validTimeout ? timeoutMs : DEFAULT_TIMEOUT_MS,
    };
  }
  return {
    provider: Object.freeze({ ready: true, apiKey }),
    timeoutMs,
  };
}

export function loadPlatformGeminiProposalConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PlatformGeminiProposalConfig {
  if (!readEnabled(environment.EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED)) {
    return Object.freeze({ enabled: false });
  }

  const provider = readProvider(environment);
  return Object.freeze({
    enabled: true,
    supabaseUrl: readSupabaseUrl(environment.NEXT_PUBLIC_SUPABASE_URL),
    supabaseSecretKey: readSupabaseSecret(
      environment.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    ),
    hmacSecret: readHmacSecret(
      environment.EVO_PLATFORM_GEMINI_PROPOSAL_HMAC_SECRET,
    ),
    modelRef: PLATFORM_GEMINI_PROPOSAL_MODEL,
    schemaVersion: PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION,
    promptPolicyVersion: PLATFORM_GEMINI_PROPOSAL_PROMPT_POLICY_VERSION,
    timeoutMs: provider.timeoutMs,
    maxOutputTokens: PLATFORM_GEMINI_PROPOSAL_MAX_OUTPUT_TOKENS,
    maxRequestBodyBytes: PLATFORM_GEMINI_PROPOSAL_MAX_REQUEST_BODY_BYTES,
    provider: provider.provider,
  });
}
