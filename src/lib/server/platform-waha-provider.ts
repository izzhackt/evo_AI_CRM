import "server-only";

import {
  PLATFORM_WAHA_BASE_URL,
  PLATFORM_WAHA_SESSION_NAME,
  type PlatformManualSendWahaRuntime,
  type PlatformWhatsAppAckState,
  type PlatformWhatsAppProviderSource,
} from "../platform-provider-workflows.ts";

const DIRECT_RECIPIENT_PATTERN = /^[1-9]\d{4,31}@(c\.us|lid)$/u;
const PRINTABLE_PROVIDER_ID_PATTERN = /^[\x20-\x7e]+$/u;
const MAX_API_KEY_BYTES = 4_096;
const MAX_MESSAGE_ID_BYTES = 512;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const MAX_TEXT_BYTES = 64 * 1_024;
const MAX_LOOKUP_WINDOW_SECONDS = 30 * 60;
const LOOKUP_MESSAGE_LIMIT = 100;

export const PLATFORM_WAHA_PROVIDER_TIMEOUT_MS = 10_000;

export type PlatformWahaProviderErrorDisposition = "failed" | "unknown";

export type PlatformWahaProviderErrorCode =
  | "configuration_invalid"
  | "invalid_request"
  | "message_rejected"
  | "provider_authentication_failed"
  | "provider_forbidden"
  | "provider_rate_limited"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_network_failure"
  | "provider_unavailable"
  | "provider_malformed_response"
  | "provider_message_ambiguous";

export class PlatformWahaProviderError extends Error {
  readonly code: PlatformWahaProviderErrorCode;
  readonly disposition: PlatformWahaProviderErrorDisposition;
  readonly statusCode: number | null;

  constructor(
    code: PlatformWahaProviderErrorCode,
    disposition: PlatformWahaProviderErrorDisposition,
    statusCode: number | null = null,
  ) {
    super("WAHA provider operation failed.");
    this.name = "PlatformWahaProviderError";
    this.code = code;
    this.disposition = disposition;
    this.statusCode = statusCode;
  }
}

export type PlatformWahaProviderMessage = Readonly<{
  providerMessageId: string;
  providerSource: PlatformWhatsAppProviderSource;
  providerObservedAt: string;
  ackState: PlatformWhatsAppAckState;
  ackObservedAt: string;
}>;

export type PlatformWahaProviderDependencies = Readonly<{
  fetch?: typeof fetch;
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
  now?: () => Date;
}>;

export type PlatformWahaProvider = Readonly<{
  sendText(input: Readonly<{
    recipientId: string;
    text: string;
    replyTo: string;
  }>): Promise<PlatformWahaProviderMessage>;
  getMessage(input: Readonly<{
    recipientId: string;
    providerMessageId: string;
    expectedText: string;
  }>): Promise<PlatformWahaProviderMessage>;
  findUniqueMessage(input: Readonly<{
    recipientId: string;
    expectedText: string;
    windowStart: string;
    windowEnd: string;
  }>): Promise<PlatformWahaProviderMessage | null>;
}>;

const ACK_STATES = Object.freeze({
  [-1]: "error",
  0: "pending",
  1: "server",
  2: "device",
  3: "read",
  4: "played",
} satisfies Record<-1 | 0 | 1 | 2 | 3 | 4, PlatformWhatsAppAckState>);

const ACK_NAMES = Object.freeze({
  [-1]: "ERROR",
  0: "PENDING",
  1: "SERVER",
  2: "DEVICE",
  3: "READ",
  4: "PLAYED",
} as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectRecipient(value: unknown): value is string {
  return typeof value === "string" && DIRECT_RECIPIENT_PATTERN.test(value);
}

function isBoundedProviderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    Buffer.byteLength(value, "utf8") >= 1 &&
    Buffer.byteLength(value, "utf8") <= MAX_MESSAGE_ID_BYTES &&
    PRINTABLE_PROVIDER_ID_PATTERN.test(value)
  );
}

function isValidText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_TEXT_BYTES &&
    !/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}

function requireRuntime(
  runtime: PlatformManualSendWahaRuntime,
): PlatformManualSendWahaRuntime {
  if (
    runtime.wahaSessionName !== PLATFORM_WAHA_SESSION_NAME ||
    runtime.wahaBaseUrl !== PLATFORM_WAHA_BASE_URL ||
    typeof runtime.wahaApiKey !== "string" ||
    runtime.wahaApiKey !== runtime.wahaApiKey.trim() ||
    Buffer.byteLength(runtime.wahaApiKey, "utf8") < 16 ||
    Buffer.byteLength(runtime.wahaApiKey, "utf8") > MAX_API_KEY_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(runtime.wahaApiKey) ||
    typeof runtime.bindingVersion !== "string" ||
    !/^[1-9]\d*$/u.test(runtime.bindingVersion)
  ) {
    throw new PlatformWahaProviderError("configuration_invalid", "failed");
  }
  return runtime;
}

function responseError(statusCode: number): PlatformWahaProviderError {
  if (statusCode === 408) {
    return new PlatformWahaProviderError(
      "provider_timeout",
      "unknown",
      statusCode,
    );
  }
  if (statusCode === 401) {
    return new PlatformWahaProviderError(
      "provider_authentication_failed",
      "failed",
      statusCode,
    );
  }
  if (statusCode === 403) {
    return new PlatformWahaProviderError(
      "provider_forbidden",
      "failed",
      statusCode,
    );
  }
  if (statusCode === 429) {
    return new PlatformWahaProviderError(
      "provider_rate_limited",
      "failed",
      statusCode,
    );
  }
  if (statusCode >= 400 && statusCode < 500) {
    return new PlatformWahaProviderError(
      "provider_rejected",
      "failed",
      statusCode,
    );
  }
  return new PlatformWahaProviderError(
    "provider_unavailable",
    "unknown",
    statusCode,
  );
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new Error("invalid response");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("invalid response");
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function normalizeMessage(
  value: unknown,
  expected: Readonly<{
    recipientId: string;
    text: string;
    source?: PlatformWhatsAppProviderSource;
    providerMessageId?: string;
  }>,
  ackObservedAt: Date,
): PlatformWahaProviderMessage {
  if (
    !isRecord(value) ||
    !isBoundedProviderId(value.id) ||
    (expected.providerMessageId !== undefined &&
      value.id !== expected.providerMessageId) ||
    !Number.isSafeInteger(value.timestamp) ||
    (value.timestamp as number) <= 0 ||
    !isDirectRecipient(value.from) ||
    value.to !== expected.recipientId ||
    value.fromMe !== true ||
    (value.source !== "api" && value.source !== "app") ||
    (expected.source !== undefined && value.source !== expected.source) ||
    value.body !== expected.text ||
    !(
      value.ack === -1 ||
      value.ack === 0 ||
      value.ack === 1 ||
      value.ack === 2 ||
      value.ack === 3 ||
      value.ack === 4
    ) ||
    value.ackName !== ACK_NAMES[value.ack] ||
    !(ackObservedAt instanceof Date) ||
    !Number.isFinite(ackObservedAt.getTime())
  ) {
    throw new PlatformWahaProviderError(
      "provider_malformed_response",
      "unknown",
    );
  }

  const providerObservedAt = new Date((value.timestamp as number) * 1_000);
  if (
    !Number.isFinite(providerObservedAt.getTime()) ||
    ackObservedAt.getTime() < providerObservedAt.getTime()
  ) {
    throw new PlatformWahaProviderError(
      "provider_malformed_response",
      "unknown",
    );
  }

  return Object.freeze({
    providerMessageId: value.id,
    providerSource: value.source,
    providerObservedAt: providerObservedAt.toISOString(),
    ackState: ACK_STATES[value.ack],
    ackObservedAt: ackObservedAt.toISOString(),
  });
}

export function createPlatformWahaProvider(
  runtimeInput: PlatformManualSendWahaRuntime,
  dependencies: PlatformWahaProviderDependencies = {},
): PlatformWahaProvider {
  const runtime = requireRuntime(runtimeInput);
  const fetchImpl = dependencies.fetch ?? fetch;
  const createTimeoutSignal =
    dependencies.createTimeoutSignal ??
    ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  const now = dependencies.now ?? (() => new Date());

  async function request(input: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(input, {
        ...init,
        redirect: "error",
        signal: createTimeoutSignal(PLATFORM_WAHA_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PlatformWahaProviderError(
        isTimeoutError(error)
          ? "provider_timeout"
          : "provider_network_failure",
        "unknown",
      );
    }
    if (!response.ok) throw responseError(response.status);
    try {
      return await readBoundedJson(response);
    } catch {
      throw new PlatformWahaProviderError(
        "provider_malformed_response",
        "unknown",
      );
    }
  }

  return Object.freeze({
    async sendText(input): Promise<PlatformWahaProviderMessage> {
      if (
        !isDirectRecipient(input.recipientId) ||
        !isValidText(input.text) ||
        !isBoundedProviderId(input.replyTo)
      ) {
        throw new PlatformWahaProviderError("invalid_request", "failed");
      }

      const response = await request(`${runtime.wahaBaseUrl}/api/sendText`, {
        method: "POST",
        headers: Object.freeze({
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Api-Key": runtime.wahaApiKey,
        }),
        body: JSON.stringify({
          session: runtime.wahaSessionName,
          chatId: input.recipientId,
          text: input.text,
          reply_to: input.replyTo,
        }),
      });
      const message = normalizeMessage(
        response,
        {
          recipientId: input.recipientId,
          text: input.text,
          source: "api",
        },
        now(),
      );
      if (message.ackState === "error") {
        throw new PlatformWahaProviderError("message_rejected", "failed");
      }
      return message;
    },

    async getMessage(input): Promise<PlatformWahaProviderMessage> {
      if (
        !isDirectRecipient(input.recipientId) ||
        !isBoundedProviderId(input.providerMessageId) ||
        !isValidText(input.expectedText)
      ) {
        throw new PlatformWahaProviderError("invalid_request", "failed");
      }

      const requestUrl =
        `${runtime.wahaBaseUrl}/api/${encodeURIComponent(runtime.wahaSessionName)}` +
        `/chats/${encodeURIComponent(input.recipientId)}` +
        `/messages/${encodeURIComponent(input.providerMessageId)}` +
        "?downloadMedia=false";
      const response = await request(requestUrl, {
        method: "GET",
        headers: Object.freeze({
          Accept: "application/json",
          "X-Api-Key": runtime.wahaApiKey,
        }),
      });
      return normalizeMessage(
        response,
        {
          recipientId: input.recipientId,
          text: input.expectedText,
          source: "api",
          providerMessageId: input.providerMessageId,
        },
        now(),
      );
    },

    async findUniqueMessage(
      input,
    ): Promise<PlatformWahaProviderMessage | null> {
      const windowStartMs = Date.parse(input.windowStart);
      const windowEndMs = Date.parse(input.windowEnd);
      if (
        !isDirectRecipient(input.recipientId) ||
        !isValidText(input.expectedText) ||
        !Number.isFinite(windowStartMs) ||
        windowStartMs <= 0 ||
        !Number.isFinite(windowEndMs) ||
        windowEndMs < windowStartMs ||
        windowEndMs - windowStartMs > MAX_LOOKUP_WINDOW_SECONDS * 1_000
      ) {
        throw new PlatformWahaProviderError("invalid_request", "failed");
      }

      const windowStartTimestamp = Math.floor(windowStartMs / 1_000);
      const windowEndTimestamp = Math.ceil(windowEndMs / 1_000);
      const query = new URLSearchParams({
        limit: String(LOOKUP_MESSAGE_LIMIT),
        downloadMedia: "false",
        "filter.timestamp.gte": String(windowStartTimestamp),
        "filter.timestamp.lte": String(windowEndTimestamp),
        "filter.fromMe": "true",
      });
      const requestUrl =
        `${runtime.wahaBaseUrl}/api/${encodeURIComponent(runtime.wahaSessionName)}` +
        `/chats/${encodeURIComponent(input.recipientId)}/messages?${query.toString()}`;
      const response = await request(requestUrl, {
        method: "GET",
        headers: Object.freeze({
          Accept: "application/json",
          "X-Api-Key": runtime.wahaApiKey,
        }),
      });
      if (!Array.isArray(response) || response.length > LOOKUP_MESSAGE_LIMIT) {
        throw new PlatformWahaProviderError(
          "provider_malformed_response",
          "unknown",
        );
      }

      const ackObservedAt = now();
      const matches = new Map<string, PlatformWahaProviderMessage>();
      for (const candidate of response) {
        if (
          !isRecord(candidate) ||
          !Number.isSafeInteger(candidate.timestamp) ||
          (candidate.timestamp as number) <= 0 ||
          typeof candidate.fromMe !== "boolean"
        ) {
          throw new PlatformWahaProviderError(
            "provider_malformed_response",
            "unknown",
          );
        }
        if (
          candidate.fromMe !== true ||
          candidate.source !== "api" ||
          candidate.to !== input.recipientId ||
          candidate.body !== input.expectedText ||
          (candidate.timestamp as number) < windowStartTimestamp ||
          (candidate.timestamp as number) > windowEndTimestamp
        ) {
          continue;
        }
        const message = normalizeMessage(
          candidate,
          {
            recipientId: input.recipientId,
            text: input.expectedText,
          },
          ackObservedAt,
        );
        matches.set(message.providerMessageId, message);
      }

      if (matches.size === 0) return null;
      if (matches.size > 1) {
        throw new PlatformWahaProviderError(
          "provider_message_ambiguous",
          "unknown",
        );
      }
      return matches.values().next().value ?? null;
    },
  });
}
