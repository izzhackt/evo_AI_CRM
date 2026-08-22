import "server-only";

import {
  isSafeWahaProviderId,
  isWahaDirectChatId,
} from "./platform-waha-identifiers.ts";
import { PLATFORM_WAHA_SESSION_NAME } from "./platform-waha-ingress-config.ts";

const MAX_RESPONSE_BYTES = 65_536;
const MAX_TEXT_CHARACTERS = 4_096;
const REQUEST_TIMEOUT_MS = 10_000;
const DETERMINISTIC_REJECTION_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

type FetchImplementation = typeof fetch;

export class PlatformManualSendWahaError extends Error {
  readonly kind: "rejected" | "unknown";
  readonly code: string;

  constructor(kind: "rejected" | "unknown", code: string) {
    super("The private WAHA manual-send boundary did not return a safe result.");
    this.name = "PlatformManualSendWahaError";
    this.kind = kind;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new Error("response_too_large");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("response_too_large");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function providerMessageId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const candidate of [
    value.id,
    value.messageId,
    isRecord(value._data) ? value._data.id : undefined,
  ]) {
    if (isSafeWahaProviderId(candidate)) return candidate;
  }
  return null;
}

function privateBaseUrl(value: string | null): string {
  let url: URL;
  try {
    url = new URL(value?.trim() ?? "");
  } catch {
    throw new PlatformManualSendWahaError("rejected", "provider_not_configured");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "evo-crm-waha" ||
    url.port !== "3000" ||
    url.username ||
    url.password ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new PlatformManualSendWahaError("rejected", "provider_not_configured");
  }
  return url.origin;
}

function apiKey(value: string | null): string {
  const normalized = value?.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") < 16 || /[\r\n]/.test(normalized)) {
    throw new PlatformManualSendWahaError("rejected", "provider_not_configured");
  }
  return normalized;
}

export function createPlatformManualSendWahaClient(
  settings: Readonly<{ baseUrl: string | null; apiKey: string | null }>,
  fetchImpl: FetchImplementation = fetch,
) {
  const baseUrl = privateBaseUrl(settings.baseUrl);
  const headers = Object.freeze({ "X-Api-Key": apiKey(settings.apiKey) });

  return Object.freeze({
    async preflight(input: Readonly<{ session: string }>) {
      if (input.session !== PLATFORM_WAHA_SESSION_NAME) {
        return { ready: false as const, reasonCode: "session_mismatch" };
      }
      let response: Response;
      try {
        response = await fetchImpl(
          `${baseUrl}/api/sessions/${encodeURIComponent(input.session)}`,
          {
            method: "GET",
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        );
      } catch {
        return { ready: false as const, reasonCode: "session_status_uncertain" };
      }
      if (!response.ok) {
        return { ready: false as const, reasonCode: "session_status_uncertain" };
      }
      try {
        const value = await readBoundedJson(response);
        if (!isRecord(value) || value.name !== input.session) {
          return { ready: false as const, reasonCode: "session_status_uncertain" };
        }
        return value.status === "WORKING"
          ? { ready: true as const }
          : { ready: false as const, reasonCode: "session_not_working" };
      } catch {
        return { ready: false as const, reasonCode: "session_status_uncertain" };
      }
    },

    async sendText(input: Readonly<{
      session: string;
      chatId: string;
      replyTo: string;
      text: string;
    }>) {
      if (
        input.session !== PLATFORM_WAHA_SESSION_NAME ||
        !isWahaDirectChatId(input.chatId) ||
        !isSafeWahaProviderId(input.replyTo) ||
        input.text.trim().length === 0 ||
        input.text.length > MAX_TEXT_CHARACTERS
      ) {
        throw new TypeError("Manual-send WAHA input violates the closed contract.");
      }

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/api/sendText`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          body: JSON.stringify({
            session: input.session,
            chatId: input.chatId,
            text: input.text,
          }),
        });
      } catch (error) {
        throw new PlatformManualSendWahaError(
          "unknown",
          error instanceof DOMException && error.name === "TimeoutError"
            ? "provider_timeout"
            : "provider_connection_lost",
        );
      }

      if (!response.ok) {
        throw new PlatformManualSendWahaError(
          DETERMINISTIC_REJECTION_STATUSES.has(response.status)
            ? "rejected"
            : "unknown",
          DETERMINISTIC_REJECTION_STATUSES.has(response.status)
            ? "provider_rejected"
            : "provider_ambiguous_response",
        );
      }
      let value: unknown;
      try {
        value = await readBoundedJson(response);
      } catch {
        throw new PlatformManualSendWahaError("unknown", "provider_malformed_response");
      }
      const id = providerMessageId(value);
      if (id === null) {
        throw new PlatformManualSendWahaError("unknown", "provider_identity_missing");
      }
      return Object.freeze({ providerMessageId: id });
    },
  });
}
