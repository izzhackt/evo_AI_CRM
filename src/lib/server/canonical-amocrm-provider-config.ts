import "server-only";

import { isAbsolute, relative, resolve, sep } from "node:path";

const ACCOUNT_DOMAIN_PATTERN =
  /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.(amocrm\.ru|kommo\.com)$/u;
const MIN_CLIENT_ID_BYTES = 8;
const MIN_CLIENT_SECRET_BYTES = 16;
const MAX_CREDENTIAL_BYTES = 4_096;
const MAX_PATH_BYTES = 4_096;
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

export const CANONICAL_AMOCRM_MAX_RESPONSE_BYTES = 256 * 1024;
export const CANONICAL_AMOCRM_REQUEST_INTERVAL_MS = 150;

export type CanonicalAmoCrmMissingConfiguration =
  | "base_url"
  | "client_id"
  | "client_secret"
  | "redirect_uri"
  | "token_file";

export type CanonicalAmoCrmBlockedReason =
  | "feature_disabled"
  | "provider_not_authorized"
  | "configuration_missing"
  | "configuration_invalid";

export type CanonicalAmoCrmProviderConfig =
  | Readonly<{
      status: "blocked";
      reason: Exclude<CanonicalAmoCrmBlockedReason, "configuration_invalid">;
      missing?: readonly CanonicalAmoCrmMissingConfiguration[];
    }>
  | Readonly<{
      status: "ready";
      accountDomain: string;
      accountOrigin: string;
      accountSubdomain: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      tokenFilePath: string;
      timeoutMs: number;
      maxResponseBytes: number;
      requestIntervalMs: number;
    }>;

export type CanonicalAmoCrmConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "invalid_authorization_flag"
  | "invalid_base_url"
  | "invalid_client_id"
  | "invalid_client_secret"
  | "invalid_redirect_uri"
  | "invalid_token_file"
  | "invalid_timeout";

export class CanonicalAmoCrmConfigurationError extends Error {
  readonly code: CanonicalAmoCrmConfigurationErrorCode;

  constructor(code: CanonicalAmoCrmConfigurationErrorCode) {
    super("Canonical amoCRM provider execution is not configured.");
    this.name = "CanonicalAmoCrmConfigurationError";
    this.code = code;
  }
}

function flag(
  value: string | undefined,
  errorCode: "invalid_enabled_flag" | "invalid_authorization_flag",
): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new CanonicalAmoCrmConfigurationError(errorCode);
}

function boundedText(
  value: string,
  minimumBytes: number,
  errorCode: "invalid_client_id" | "invalid_client_secret",
): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    value.trim() !== value ||
    bytes < minimumBytes ||
    bytes > MAX_CREDENTIAL_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new CanonicalAmoCrmConfigurationError(errorCode);
  }
  return value;
}

function account(value: string): Readonly<{
  domain: string;
  origin: string;
  subdomain: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CanonicalAmoCrmConfigurationError("invalid_base_url");
  }

  const match = parsed.hostname.toLowerCase().match(ACCOUNT_DOMAIN_PATTERN);
  if (
    value.trim() !== value ||
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !match
  ) {
    throw new CanonicalAmoCrmConfigurationError("invalid_base_url");
  }

  const domain = parsed.hostname.toLowerCase();
  return Object.freeze({
    domain,
    origin: `https://${domain}`,
    subdomain: match[1],
  });
}

function redirect(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CanonicalAmoCrmConfigurationError("invalid_redirect_uri");
  }

  const isLoopbackHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]");
  if (
    value.trim() !== value ||
    (parsed.protocol !== "https:" && !isLoopbackHttp) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw new CanonicalAmoCrmConfigurationError("invalid_redirect_uri");
  }
  return value;
}

function tokenFile(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    value.trim() !== value ||
    bytes < 1 ||
    bytes > MAX_PATH_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new CanonicalAmoCrmConfigurationError("invalid_token_file");
  }
  const resolvedPath = resolve(value);
  const repositoryRelativePath = relative(process.cwd(), resolvedPath);
  const isInsideRepository =
    repositoryRelativePath === "" ||
    (!isAbsolute(repositoryRelativePath) &&
      repositoryRelativePath !== ".." &&
      !repositoryRelativePath.startsWith(`..${sep}`));
  if (isInsideRepository) {
    const ignoredDataRoot = resolve(process.cwd(), "data");
    const dataRelativePath = relative(ignoredDataRoot, resolvedPath);
    const isInsideIgnoredData =
      dataRelativePath !== "" &&
      !isAbsolute(dataRelativePath) &&
      dataRelativePath !== ".." &&
      !dataRelativePath.startsWith(`..${sep}`);
    if (!isInsideIgnoredData) {
      throw new CanonicalAmoCrmConfigurationError("invalid_token_file");
    }
  }
  return resolvedPath;
}

function timeout(value: string | undefined): number {
  const parsed = Number(value ?? String(DEFAULT_TIMEOUT_MS));
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_TIMEOUT_MS ||
    parsed > MAX_TIMEOUT_MS
  ) {
    throw new CanonicalAmoCrmConfigurationError("invalid_timeout");
  }
  return parsed;
}

export function loadCanonicalAmoCrmProviderConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CanonicalAmoCrmProviderConfig {
  if (!flag(environment.EVO_V2_AMOCRM_WRITES_ENABLED, "invalid_enabled_flag")) {
    return Object.freeze({ status: "blocked", reason: "feature_disabled" });
  }
  if (
    !flag(
      environment.EVO_V2_AMOCRM_PROVIDER_AUTHORIZED,
      "invalid_authorization_flag",
    )
  ) {
    return Object.freeze({
      status: "blocked",
      reason: "provider_not_authorized",
    });
  }

  const values = Object.freeze({
    base_url: environment.EVO_V2_AMOCRM_BASE_URL,
    client_id: environment.EVO_V2_AMOCRM_CLIENT_ID,
    client_secret: environment.EVO_V2_AMOCRM_CLIENT_SECRET,
    redirect_uri: environment.EVO_V2_AMOCRM_REDIRECT_URI,
    token_file: environment.EVO_V2_AMOCRM_TOKEN_FILE,
  });
  const missing = (Object.entries(values) as [CanonicalAmoCrmMissingConfiguration, string | undefined][])
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    return Object.freeze({
      status: "blocked",
      reason: "configuration_missing",
      missing: Object.freeze(missing),
    });
  }

  const normalizedAccount = account(values.base_url!);
  return Object.freeze({
    status: "ready",
    accountDomain: normalizedAccount.domain,
    accountOrigin: normalizedAccount.origin,
    accountSubdomain: normalizedAccount.subdomain,
    clientId: boundedText(values.client_id!, MIN_CLIENT_ID_BYTES, "invalid_client_id"),
    clientSecret: boundedText(
      values.client_secret!,
      MIN_CLIENT_SECRET_BYTES,
      "invalid_client_secret",
    ),
    redirectUri: redirect(values.redirect_uri!),
    tokenFilePath: tokenFile(values.token_file!),
    timeoutMs: timeout(environment.EVO_V2_AMOCRM_TIMEOUT_MS),
    maxResponseBytes: CANONICAL_AMOCRM_MAX_RESPONSE_BYTES,
    requestIntervalMs: CANONICAL_AMOCRM_REQUEST_INTERVAL_MS,
  });
}

export type CanonicalAmoCrmProviderAvailability =
  | Readonly<{
      status: "blocked";
      reason: CanonicalAmoCrmBlockedReason;
      missing?: readonly CanonicalAmoCrmMissingConfiguration[];
    }>
  | Readonly<{
      status: "ready";
      accountDomain: string;
    }>;

export function readCanonicalAmoCrmProviderAvailability(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CanonicalAmoCrmProviderAvailability {
  try {
    const config = loadCanonicalAmoCrmProviderConfig(environment);
    if (config.status === "ready") {
      return Object.freeze({
        status: "ready",
        accountDomain: config.accountDomain,
      });
    }
    return config;
  } catch (error) {
    if (error instanceof CanonicalAmoCrmConfigurationError) {
      return Object.freeze({
        status: "blocked",
        reason: "configuration_invalid",
      });
    }
    throw error;
  }
}
