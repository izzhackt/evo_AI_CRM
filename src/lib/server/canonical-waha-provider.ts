import "server-only";

import { isIP } from "node:net";

const ALLOWED_WAHA_HOSTNAMES = new Set(["evo-inbox-waha", "evo-v2-waha"]);
const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_API_KEY_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_MESSAGE_ID_BYTES = 1_024;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_UNKNOWN_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const UNKNOWN_ATTEMPT_MESSAGE_LIMIT = 100;
const DIRECT_RECIPIENT_PATTERN = /^[1-9]\d{4,31}@(c\.us|lid)$/u;
const CANONICAL_WAHA_SESSION_PROOFS = new WeakSet<object>();

export const CANONICAL_WAHA_PROVIDER_TIMEOUT_MS = 10_000;

export type CanonicalWahaProviderBlockedReason =
  | "feature_disabled"
  | "provider_not_authorized"
  | "configuration_missing"
  | "configuration_invalid";

type CanonicalWahaMissingConfig = "base_url" | "api_key" | "session_name";

export type CanonicalWahaProviderConfig =
  | Readonly<{
      status: "blocked";
      reason: Exclude<
        CanonicalWahaProviderBlockedReason,
        "configuration_invalid"
      >;
      missing?: readonly CanonicalWahaMissingConfig[];
    }>
  | Readonly<{
      status: "ready";
      baseUrl: string;
      apiKey: string;
      sessionName: string;
      timeoutMs: number;
    }>;

export type CanonicalWahaProviderAvailability =
  | Readonly<{
      status: "blocked";
      reason: CanonicalWahaProviderBlockedReason;
      missing?: readonly CanonicalWahaMissingConfig[];
    }>
  | Readonly<{ status: "configured" }>;

export type CanonicalWahaProviderDependencies = Readonly<{
  fetch?: typeof fetch;
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
}>;

export type CanonicalWahaAck = -1 | 0 | 1 | 2 | 3 | 4;
export type CanonicalWahaAckName =
  | "ERROR"
  | "PENDING"
  | "SERVER"
  | "DEVICE"
  | "READ"
  | "PLAYED";

export type CanonicalWahaMessage = Readonly<{
  id: string;
  timestamp: number;
  recipientId: string;
  fromMe: true;
  source: "api" | "app" | null;
  body: string;
  ack: CanonicalWahaAck;
  ackName: CanonicalWahaAckName;
}>;

export type CanonicalWahaSessionProof = Readonly<{
  status: "working";
  sessionName: string;
  selfRecipientIds: readonly [string, ...string[]];
}>;

export type CanonicalWahaUnknownAttemptLookup = Readonly<{
  recipientId: string;
  expectedText: string;
  windowStartTimestamp: number;
  windowEndTimestamp: number;
  sessionProof?: CanonicalWahaSessionProof;
}>;

export type CanonicalWahaProviderErrorDisposition = "rejected" | "unknown";

export type CanonicalWahaProviderErrorCode =
  | "feature_disabled"
  | "provider_not_authorized"
  | "configuration_missing"
  | "configuration_invalid"
  | "invalid_request"
  | "provider_authentication_failed"
  | "provider_forbidden"
  | "provider_rate_limited"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_network_failure"
  | "provider_unavailable"
  | "provider_malformed_response"
  | "provider_message_not_found"
  | "provider_message_ambiguous"
  | "session_not_working"
  | "message_rejected";

export class CanonicalWahaProviderError extends Error {
  readonly code: CanonicalWahaProviderErrorCode;
  readonly disposition: CanonicalWahaProviderErrorDisposition;
  readonly statusCode: number | null;

  constructor(
    code: CanonicalWahaProviderErrorCode,
    disposition: CanonicalWahaProviderErrorDisposition,
    statusCode: number | null = null,
  ) {
    super("Canonical WAHA provider operation failed.");
    this.name = "CanonicalWahaProviderError";
    this.code = code;
    this.disposition = disposition;
    this.statusCode = statusCode;
  }
}

export type CanonicalWahaProviderConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "invalid_authorization_flag"
  | "invalid_base_url"
  | "unsafe_base_url"
  | "unsafe_api_key"
  | "invalid_session_name";

export class CanonicalWahaProviderConfigurationError extends Error {
  readonly code: CanonicalWahaProviderConfigurationErrorCode;

  constructor(code: CanonicalWahaProviderConfigurationErrorCode) {
    super("Canonical WAHA provider is not configured.");
    this.name = "CanonicalWahaProviderConfigurationError";
    this.code = code;
  }
}

function flag(
  value: string | undefined,
  errorCode: "invalid_enabled_flag" | "invalid_authorization_flag",
): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new CanonicalWahaProviderConfigurationError(errorCode);
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
    return (
      ipCandidate === "::1" ||
      ipCandidate.startsWith("fc") ||
      ipCandidate.startsWith("fd")
    );
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
    throw new CanonicalWahaProviderConfigurationError("invalid_base_url");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CanonicalWahaProviderConfigurationError("invalid_base_url");
  }

  if (
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new CanonicalWahaProviderConfigurationError("unsafe_base_url");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !isPrivateOrInternalHostname(url.hostname)
  ) {
    throw new CanonicalWahaProviderConfigurationError("unsafe_base_url");
  }
  return url.origin;
}

function readApiKey(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;
  const byteLength = Buffer.byteLength(value, "utf8");
  if (
    value !== value.trim() ||
    byteLength < 1 ||
    byteLength > MAX_API_KEY_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new CanonicalWahaProviderConfigurationError("unsafe_api_key");
  }
  return value;
}

function readSessionName(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;
  if (value !== value.trim() || !SESSION_NAME_PATTERN.test(value)) {
    throw new CanonicalWahaProviderConfigurationError("invalid_session_name");
  }
  return value;
}

export function loadCanonicalWahaProviderConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CanonicalWahaProviderConfig {
  if (!flag(environment.EVO_V2_WAHA_ENABLED, "invalid_enabled_flag")) {
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

  const missing: CanonicalWahaMissingConfig[] = [];
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
    timeoutMs: CANONICAL_WAHA_PROVIDER_TIMEOUT_MS,
  });
}

export function readCanonicalWahaProviderAvailability(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CanonicalWahaProviderAvailability {
  try {
    const config = loadCanonicalWahaProviderConfig(environment);
    if (config.status === "ready") {
      return Object.freeze({ status: "configured" });
    }
    return config;
  } catch (error) {
    if (error instanceof CanonicalWahaProviderConfigurationError) {
      return Object.freeze({
        status: "blocked",
        reason: "configuration_invalid",
      });
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ACK_NAMES = Object.freeze({
  [-1]: "ERROR",
  0: "PENDING",
  1: "SERVER",
  2: "DEVICE",
  3: "READ",
  4: "PLAYED",
} satisfies Record<CanonicalWahaAck, CanonicalWahaAckName>);

function boundedString(
  value: unknown,
  maxBytes: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value === value.trim() &&
    Buffer.byteLength(value, "utf8") <= maxBytes &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function directRecipient(value: unknown): value is string {
  return typeof value === "string" && DIRECT_RECIPIENT_PATTERN.test(value);
}

function isCanonicalSessionProof(
  value: unknown,
  sessionName: string,
): value is CanonicalWahaSessionProof {
  if (
    !isRecord(value) ||
    !CANONICAL_WAHA_SESSION_PROOFS.has(value) ||
    value.status !== "working" ||
    value.sessionName !== sessionName ||
    !Array.isArray(value.selfRecipientIds) ||
    value.selfRecipientIds.length < 1 ||
    value.selfRecipientIds.length > 2 ||
    value.selfRecipientIds.some((candidate) => !directRecipient(candidate)) ||
    new Set(value.selfRecipientIds).size !== value.selfRecipientIds.length
  ) {
    return false;
  }
  return true;
}

function isSessionProofForRecipient(
  value: unknown,
  sessionName: string,
  recipientId: string,
): value is CanonicalWahaSessionProof {
  return (
    isCanonicalSessionProof(value, sessionName) &&
    value.selfRecipientIds.includes(recipientId)
  );
}

function requireOptionalSessionProof(
  value: CanonicalWahaSessionProof | undefined,
  sessionName: string,
): void {
  if (value !== undefined && !isCanonicalSessionProof(value, sessionName)) {
    throw new CanonicalWahaProviderError("invalid_request", "rejected");
  }
}

function validatedRequestText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_TEXT_BYTES &&
    !/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}

function unknownAttemptLookupRecipientIds(
  recipientId: string,
  sessionName: string,
  sessionProof: CanonicalWahaSessionProof | undefined,
): readonly [string, ...string[]] {
  if (
    sessionProof !== undefined &&
    isSessionProofForRecipient(sessionProof, sessionName, recipientId)
  ) {
    return sessionProof.selfRecipientIds;
  }
  return [recipientId];
}

function normalizeMessage(
  value: unknown,
  expected: Readonly<{
    recipientId: string;
    text: string;
    providerMessageId?: string;
    sessionName: string;
    sessionProof?: CanonicalWahaSessionProof;
  }>,
): CanonicalWahaMessage {
  if (
    !isRecord(value) ||
    !boundedString(value.id, MAX_MESSAGE_ID_BYTES) ||
    (expected.providerMessageId !== undefined &&
      value.id !== expected.providerMessageId) ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp) ||
    value.timestamp <= 0 ||
    !directRecipient(value.from) ||
    !directRecipient(value.to) ||
    !(
      value.to === expected.recipientId ||
      (expected.sessionProof !== undefined &&
        isSessionProofForRecipient(
          expected.sessionProof,
          expected.sessionName,
          expected.recipientId,
        ) &&
        expected.sessionProof.selfRecipientIds.includes(value.to))
    ) ||
    value.fromMe !== true ||
    (value.source !== undefined &&
      value.source !== "api" &&
      value.source !== "app") ||
    value.body !== expected.text ||
    !(
      value.ack === -1 ||
      value.ack === 0 ||
      value.ack === 1 ||
      value.ack === 2 ||
      value.ack === 3 ||
      value.ack === 4
    ) ||
    value.ackName !== ACK_NAMES[value.ack]
  ) {
    throw new CanonicalWahaProviderError(
      "provider_malformed_response",
      "unknown",
    );
  }

  return Object.freeze({
    id: value.id,
    timestamp: value.timestamp,
    recipientId: expected.recipientId,
    fromMe: true,
    source:
      value.source === "api" || value.source === "app" ? value.source : null,
    body: expected.text,
    ack: value.ack,
    ackName: ACK_NAMES[value.ack],
  });
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new Error("Canonical WAHA provider response is invalid.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Canonical WAHA provider response is invalid.");
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function requireReadyConfig(
  environment: Readonly<Record<string, string | undefined>>,
) {
  let config: CanonicalWahaProviderConfig;
  try {
    config = loadCanonicalWahaProviderConfig(environment);
  } catch (error) {
    if (error instanceof CanonicalWahaProviderConfigurationError) {
      throw new CanonicalWahaProviderError(
        "configuration_invalid",
        "rejected",
      );
    }
    throw error;
  }
  if (config.status !== "ready") {
    throw new CanonicalWahaProviderError(config.reason, "rejected");
  }
  return config;
}

function responseError(statusCode: number): CanonicalWahaProviderError {
  if (statusCode === 401) {
    return new CanonicalWahaProviderError(
      "provider_authentication_failed",
      "rejected",
      statusCode,
    );
  }
  if (statusCode === 403) {
    return new CanonicalWahaProviderError(
      "provider_forbidden",
      "rejected",
      statusCode,
    );
  }
  if (statusCode === 429) {
    return new CanonicalWahaProviderError(
      "provider_rate_limited",
      "rejected",
      statusCode,
    );
  }
  if (statusCode >= 400 && statusCode < 500) {
    return new CanonicalWahaProviderError(
      "provider_rejected",
      "rejected",
      statusCode,
    );
  }
  return new CanonicalWahaProviderError(
    "provider_unavailable",
    "unknown",
    statusCode,
  );
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

async function providerFetch(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch (error) {
    throw new CanonicalWahaProviderError(
      isTimeoutError(error) ? "provider_timeout" : "provider_network_failure",
      "unknown",
    );
  }
}

async function providerJson(response: Response): Promise<unknown> {
  try {
    return await readBoundedJson(response);
  } catch {
    throw new CanonicalWahaProviderError(
      "provider_malformed_response",
      "unknown",
    );
  }
}

export async function probeCanonicalWahaSession(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: CanonicalWahaProviderDependencies = {},
): Promise<CanonicalWahaSessionProof> {
  const config = requireReadyConfig(environment);
  const fetchImpl = dependencies.fetch ?? fetch;
  const createTimeoutSignal =
    dependencies.createTimeoutSignal ??
    ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  const response = await providerFetch(
    fetchImpl,
    `${config.baseUrl}/api/sessions/${encodeURIComponent(config.sessionName)}`,
    {
      method: "GET",
      headers: Object.freeze({
        Accept: "application/json",
        "X-Api-Key": config.apiKey,
      }),
      redirect: "error",
      signal: createTimeoutSignal(config.timeoutMs),
    },
  );
  if (!response.ok) {
    throw responseError(response.status);
  }
  const value = await providerJson(response);
  if (
    !isRecord(value) ||
    value.name !== config.sessionName ||
    typeof value.status !== "string" ||
    !isRecord(value.me) ||
    !directRecipient(value.me.id) ||
    (value.me.lid !== undefined && !directRecipient(value.me.lid)) ||
    value.me.lid === value.me.id
  ) {
    throw new CanonicalWahaProviderError(
      "provider_malformed_response",
      "unknown",
    );
  }
  if (value.status !== "WORKING") {
    throw new CanonicalWahaProviderError("session_not_working", "rejected");
  }
  const selfRecipientIds = Object.freeze(
    value.me.lid === undefined ? [value.me.id] : [value.me.id, value.me.lid],
  ) as readonly [string, ...string[]];
  const proof = Object.freeze({
    status: "working",
    sessionName: config.sessionName,
    selfRecipientIds,
  });
  CANONICAL_WAHA_SESSION_PROOFS.add(proof);
  return proof;
}

export async function sendCanonicalWahaText(
  input: Readonly<{
    recipientId: string;
    text: string;
    replyTo?: string;
    sessionProof?: CanonicalWahaSessionProof;
  }>,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: CanonicalWahaProviderDependencies = {},
): Promise<CanonicalWahaMessage> {
  if (
    !directRecipient(input.recipientId) ||
    !validatedRequestText(input.text) ||
    (input.replyTo !== undefined &&
      !boundedString(input.replyTo, MAX_MESSAGE_ID_BYTES))
  ) {
    throw new CanonicalWahaProviderError("invalid_request", "rejected");
  }

  const config = requireReadyConfig(environment);
  requireOptionalSessionProof(
    input.sessionProof,
    config.sessionName,
  );
  const fetchImpl = dependencies.fetch ?? fetch;
  const createTimeoutSignal =
    dependencies.createTimeoutSignal ??
    ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  const body = {
    session: config.sessionName,
    chatId: input.recipientId,
    text: input.text,
    ...(input.replyTo === undefined ? {} : { reply_to: input.replyTo }),
  };
  const response = await providerFetch(fetchImpl, `${config.baseUrl}/api/sendText`, {
    method: "POST",
    headers: Object.freeze({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Api-Key": config.apiKey,
    }),
    body: JSON.stringify(body),
    redirect: "error",
    signal: createTimeoutSignal(config.timeoutMs),
  });
  if (!response.ok) {
    throw responseError(response.status);
  }
  return normalizeMessage(await providerJson(response), {
    recipientId: input.recipientId,
    text: input.text,
    sessionName: config.sessionName,
    sessionProof: input.sessionProof,
  });
}

export async function getCanonicalWahaMessage(
  input: Readonly<{
    recipientId: string;
    providerMessageId: string;
    expectedText: string;
    sessionProof?: CanonicalWahaSessionProof;
  }>,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: CanonicalWahaProviderDependencies = {},
): Promise<CanonicalWahaMessage> {
  if (
    !directRecipient(input.recipientId) ||
    !boundedString(input.providerMessageId, MAX_MESSAGE_ID_BYTES) ||
    !validatedRequestText(input.expectedText)
  ) {
    throw new CanonicalWahaProviderError("invalid_request", "rejected");
  }

  const config = requireReadyConfig(environment);
  requireOptionalSessionProof(
    input.sessionProof,
    config.sessionName,
  );
  const fetchImpl = dependencies.fetch ?? fetch;
  const createTimeoutSignal =
    dependencies.createTimeoutSignal ??
    ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  const requestUrl =
    `${config.baseUrl}/api/${encodeURIComponent(config.sessionName)}` +
    `/chats/${encodeURIComponent(input.recipientId)}` +
    `/messages/${encodeURIComponent(input.providerMessageId)}` +
    "?downloadMedia=false";
  const response = await providerFetch(fetchImpl, requestUrl, {
    method: "GET",
    headers: Object.freeze({
      Accept: "application/json",
      "X-Api-Key": config.apiKey,
    }),
    redirect: "error",
    signal: createTimeoutSignal(config.timeoutMs),
  });
  if (!response.ok) {
    throw responseError(response.status);
  }
  return normalizeMessage(await providerJson(response), {
    recipientId: input.recipientId,
    text: input.expectedText,
    providerMessageId: input.providerMessageId,
    sessionName: config.sessionName,
    sessionProof: input.sessionProof,
  });
}

export async function findUniqueCanonicalWahaMessage(
  input: CanonicalWahaUnknownAttemptLookup,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: CanonicalWahaProviderDependencies = {},
): Promise<CanonicalWahaMessage> {
  if (
    !directRecipient(input.recipientId) ||
    !validatedRequestText(input.expectedText) ||
    !Number.isFinite(input.windowStartTimestamp) ||
    input.windowStartTimestamp <= 0 ||
    !Number.isFinite(input.windowEndTimestamp) ||
    input.windowEndTimestamp < input.windowStartTimestamp ||
    input.windowEndTimestamp - input.windowStartTimestamp >
      MAX_UNKNOWN_ATTEMPT_WINDOW_SECONDS
  ) {
    throw new CanonicalWahaProviderError("invalid_request", "rejected");
  }

  const config = requireReadyConfig(environment);
  requireOptionalSessionProof(
    input.sessionProof,
    config.sessionName,
  );
  const fetchImpl = dependencies.fetch ?? fetch;
  const createTimeoutSignal =
    dependencies.createTimeoutSignal ??
    ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  const matches = new Map<string, CanonicalWahaMessage>();
  const lookupRecipientIds = unknownAttemptLookupRecipientIds(
    input.recipientId,
    config.sessionName,
    input.sessionProof,
  );
  for (const lookupRecipientId of lookupRecipientIds) {
    const query = new URLSearchParams({
      limit: String(UNKNOWN_ATTEMPT_MESSAGE_LIMIT),
      downloadMedia: "false",
      "filter.timestamp.gte": String(input.windowStartTimestamp),
      "filter.timestamp.lte": String(input.windowEndTimestamp),
      "filter.fromMe": "true",
    });
    const requestUrl =
      `${config.baseUrl}/api/${encodeURIComponent(config.sessionName)}` +
      `/chats/${encodeURIComponent(lookupRecipientId)}/messages` +
      `?${query.toString()}`;
    const response = await providerFetch(fetchImpl, requestUrl, {
      method: "GET",
      headers: Object.freeze({
        Accept: "application/json",
        "X-Api-Key": config.apiKey,
      }),
      redirect: "error",
      signal: createTimeoutSignal(config.timeoutMs),
    });
    if (!response.ok) {
      throw responseError(response.status);
    }
    const value = await providerJson(response);
    if (!Array.isArray(value) || value.length > UNKNOWN_ATTEMPT_MESSAGE_LIMIT) {
      throw new CanonicalWahaProviderError(
        "provider_malformed_response",
        "unknown",
      );
    }

    for (const candidate of value) {
      if (
        !isRecord(candidate) ||
        typeof candidate.timestamp !== "number" ||
        !Number.isFinite(candidate.timestamp) ||
        candidate.timestamp < input.windowStartTimestamp ||
        candidate.timestamp > input.windowEndTimestamp
      ) {
        continue;
      }
      try {
        const message = normalizeMessage(candidate, {
          recipientId: input.recipientId,
          text: input.expectedText,
          sessionName: config.sessionName,
          sessionProof: input.sessionProof,
        });
        matches.set(message.id, message);
      } catch (error) {
        if (
          !(error instanceof CanonicalWahaProviderError) ||
          error.code !== "provider_malformed_response"
        ) {
          throw error;
        }
      }
    }
  }

  const uniqueMatches = [...matches.values()];

  if (uniqueMatches.length === 0) {
    throw new CanonicalWahaProviderError(
      "provider_message_not_found",
      "unknown",
    );
  }
  if (uniqueMatches.length > 1) {
    throw new CanonicalWahaProviderError(
      "provider_message_ambiguous",
      "unknown",
    );
  }
  return uniqueMatches[0];
}
