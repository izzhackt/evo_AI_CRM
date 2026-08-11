import "server-only";

import type { PlatformAutonomousReplyEnabledConfig } from "./platform-autonomous-reply-config.ts";
import {
  isSafeWahaProviderId,
  isWahaDirectChatId,
} from "./platform-waha-identifiers.ts";

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REPLY_TEXT_CHARACTERS = 4_096;
const DETERMINISTIC_REJECTION_STATUSES = new Set([
  400,
  401,
  403,
  404,
  405,
  409,
  413,
  415,
  422,
  429,
]);

type FetchImplementation = typeof fetch;

export type PlatformAutonomousReplyPreflightResult =
  | Readonly<{ ready: true }>
  | Readonly<{
      ready: false;
      reasonCode:
        | "session_not_working"
        | "reachout_timelock_active"
        | "session_status_uncertain";
    }>;

export type PlatformAutonomousReplyWahaErrorCode =
  | "provider_rejected"
  | "provider_timeout"
  | "provider_connection_lost"
  | "provider_malformed_response"
  | "provider_ambiguous_response";

export class PlatformAutonomousReplyWahaError extends Error {
  readonly kind: "rejected" | "unknown";
  readonly code: PlatformAutonomousReplyWahaErrorCode;
  readonly retryable = false as const;

  constructor(
    kind: "rejected" | "unknown",
    code: PlatformAutonomousReplyWahaErrorCode,
  ) {
    super("The private WAHA request did not produce a safe accepted result.");
    this.name = "PlatformAutonomousReplyWahaError";
    this.kind = kind;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > MAX_RESPONSE_BYTES) {
      throw new Error("provider_response_too_large");
    }
  }

  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("provider_response_too_large");
  }
  return JSON.parse(body) as unknown;
}

function readProviderMessageId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const candidates = [
    value.id,
    value.messageId,
    isRecord(value._data) ? value._data.id : undefined,
  ];
  for (const candidate of candidates) {
    if (isSafeWahaProviderId(candidate)) {
      return candidate;
    }
  }
  return null;
}

function validateSendInput(input: Readonly<{
  chatId: string;
  replyTo: string;
  text: string;
}>): void {
  if (!isWahaDirectChatId(input.chatId)) {
    throw new TypeError("A direct WAHA chat id is required.");
  }
  if (!isSafeWahaProviderId(input.replyTo)) {
    throw new TypeError("A safe WAHA reply target is required.");
  }
  if (
    input.text.trim().length === 0 ||
    input.text.length > MAX_REPLY_TEXT_CHARACTERS
  ) {
    throw new TypeError("A bounded non-empty reply is required.");
  }
}

export function createPlatformAutonomousReplyWahaClient(
  config: PlatformAutonomousReplyEnabledConfig,
  fetchImpl: FetchImplementation = fetch,
) {
  const headers = Object.freeze({
    "X-Api-Key": config.wahaApiKey,
  });

  return Object.freeze({
    async preflight(): Promise<PlatformAutonomousReplyPreflightResult> {
      let response: Response;
      try {
        response = await fetchImpl(
          `${config.wahaBaseUrl}/api/sessions/${encodeURIComponent(config.sessionName)}`,
          {
            method: "GET",
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(config.requestTimeoutMs),
          },
        );
      } catch {
        return { ready: false, reasonCode: "session_status_uncertain" };
      }

      if (!response.ok) {
        return { ready: false, reasonCode: "session_status_uncertain" };
      }

      let value: unknown;
      try {
        value = await readBoundedJson(response);
      } catch {
        return { ready: false, reasonCode: "session_status_uncertain" };
      }
      if (
        !isRecord(value) ||
        value.name !== config.sessionName ||
        !isRecord(value.me) ||
        !isWahaDirectChatId(value.me.id)
      ) {
        return { ready: false, reasonCode: "session_status_uncertain" };
      }
      if (value.status !== "WORKING") {
        return { ready: false, reasonCode: "session_not_working" };
      }
      const reachoutTimelock = value.me.reachoutTimelock;
      if (reachoutTimelock === null) {
        return { ready: true };
      }
      if (!isRecord(reachoutTimelock)) {
        return { ready: false, reasonCode: "session_status_uncertain" };
      }
      if (reachoutTimelock.isActive === true) {
        return { ready: false, reasonCode: "reachout_timelock_active" };
      }
      if (reachoutTimelock.isActive !== false) {
        return { ready: false, reasonCode: "session_status_uncertain" };
      }
      return { ready: true };
    },

    async sendText(input: Readonly<{
      chatId: string;
      replyTo: string;
      text: string;
    }>): Promise<Readonly<{ providerMessageId: string }>> {
      validateSendInput(input);

      let response: Response;
      try {
        response = await fetchImpl(`${config.wahaBaseUrl}/api/sendText`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(config.requestTimeoutMs),
          body: JSON.stringify({
            session: config.sessionName,
            chatId: input.chatId,
            text: input.text,
            reply_to: input.replyTo,
          }),
        });
      } catch (error) {
        throw new PlatformAutonomousReplyWahaError(
          "unknown",
          error instanceof DOMException && error.name === "TimeoutError"
            ? "provider_timeout"
            : "provider_connection_lost",
        );
      }

      if (!response.ok) {
        if (DETERMINISTIC_REJECTION_STATUSES.has(response.status)) {
          throw new PlatformAutonomousReplyWahaError(
            "rejected",
            "provider_rejected",
          );
        }
        throw new PlatformAutonomousReplyWahaError(
          "unknown",
          "provider_ambiguous_response",
        );
      }

      let value: unknown;
      try {
        value = await readBoundedJson(response);
      } catch {
        throw new PlatformAutonomousReplyWahaError(
          "unknown",
          "provider_malformed_response",
        );
      }
      const providerMessageId = readProviderMessageId(value);
      if (providerMessageId === null) {
        throw new PlatformAutonomousReplyWahaError(
          "unknown",
          "provider_ambiguous_response",
        );
      }
      return { providerMessageId };
    },
  });
}
