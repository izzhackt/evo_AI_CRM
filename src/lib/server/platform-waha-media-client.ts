import "server-only";

import type { PlatformWahaMediaEnabledConfig } from "./platform-waha-media-config.ts";
import {
  isSafeWahaProviderId,
  isWahaDirectChatId,
} from "./platform-waha-identifiers.ts";

const SAFE_PROVIDER_FILENAME_MAX_BYTES = 1024;

export type PlatformWahaMediaErrorDisposition =
  | "retryable_error"
  | "terminal_error";

export type PlatformWahaMediaErrorCode =
  | "provider_message_unavailable"
  | "provider_media_unavailable"
  | "provider_response_invalid"
  | "provider_identity_mismatch"
  | "unsafe_media_url"
  | "media_too_large"
  | "media_empty";

export class PlatformWahaMediaProviderError extends Error {
  readonly disposition: PlatformWahaMediaErrorDisposition;
  readonly code: PlatformWahaMediaErrorCode;

  constructor(
    disposition: PlatformWahaMediaErrorDisposition,
    code: PlatformWahaMediaErrorCode,
  ) {
    super("Platform WAHA private media could not be archived.");
    this.name = "PlatformWahaMediaProviderError";
    this.disposition = disposition;
    this.code = code;
  }
}

export type PlatformWahaMediaSource = Readonly<{
  url: URL;
  providerFileName: string | null;
}>;

export type PlatformWahaMediaDownload = Readonly<{
  bytes: Uint8Array;
  providerFileName: string | null;
}>;

export type PlatformWahaMediaProvider = Readonly<{
  download(input: Readonly<{
    rawChatId: string;
    rawMessageId: string;
    direction: "inbound" | "outbound";
  }>): Promise<PlatformWahaMediaDownload>;
}>;

export type PlatformWahaMediaClientDependencies = Readonly<{
  fetch?: typeof fetch;
}>;

function providerError(
  disposition: PlatformWahaMediaErrorDisposition,
  code: PlatformWahaMediaErrorCode,
): never {
  throw new PlatformWahaMediaProviderError(disposition, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRawIdentity(
  rawChatId: string,
  rawMessageId: string,
  direction: "inbound" | "outbound",
): void {
  if (
    !isWahaDirectChatId(rawChatId) ||
    !isSafeWahaProviderId(rawMessageId) ||
    (direction !== "inbound" && direction !== "outbound")
  ) {
    return providerError("terminal_error", "provider_identity_mismatch");
  }
}

function parseContentLength(
  response: Response,
  maxBytes: number,
): number | null {
  const header = response.headers.get("content-length");
  if (header === null) return null;
  if (!/^\d+$/.test(header)) {
    return providerError("terminal_error", "provider_response_invalid");
  }
  const length = Number(header);
  if (!Number.isSafeInteger(length)) {
    return providerError("terminal_error", "provider_response_invalid");
  }
  if (length > maxBytes) {
    return providerError("terminal_error", "media_too_large");
  }
  return length;
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  parseContentLength(response, maxBytes);
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return providerError("terminal_error", "media_too_large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const bytes = await readBoundedBytes(response, maxBytes);
  if (bytes.byteLength === 0) {
    return providerError("terminal_error", "provider_response_invalid");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return providerError("terminal_error", "provider_response_invalid");
  }
}

function normalizeProviderFileName(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") > SAFE_PROVIDER_FILENAME_MAX_BYTES ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return providerError("terminal_error", "provider_response_invalid");
  }
  return value;
}

/**
 * Accepts only the configured private WAHA origin and its documented temporary
 * file namespace. The API key therefore never follows a redirect or reaches a
 * URL supplied by a customer/provider payload on another origin.
 */
export function requirePrivateWahaMediaUrl(
  mediaUrl: string,
  wahaBaseUrl: string,
): URL {
  let media: URL;
  let base: URL;
  try {
    media = new URL(mediaUrl);
    base = new URL(wahaBaseUrl);
  } catch {
    return providerError("terminal_error", "unsafe_media_url");
  }
  if (
    media.origin !== base.origin ||
    media.username !== "" ||
    media.password !== "" ||
    media.hash !== "" ||
    !media.pathname.startsWith("/api/files/") ||
    media.pathname === "/api/files/"
  ) {
    return providerError("terminal_error", "unsafe_media_url");
  }
  return media;
}

function parseMessageSource(
  value: unknown,
  input: Readonly<{
    sessionName: "evo-inbox";
    rawChatId: string;
    rawMessageId: string;
    direction: "inbound" | "outbound";
    wahaBaseUrl: string;
  }>,
): PlatformWahaMediaSource {
  if (!isRecord(value)) {
    return providerError("terminal_error", "provider_response_invalid");
  }
  if (
    value.session !== input.sessionName ||
    value.id !== input.rawMessageId ||
    value.hasMedia !== true
  ) {
    return providerError("terminal_error", "provider_identity_mismatch");
  }
  if (input.direction === "inbound") {
    if (
      value.from !== input.rawChatId ||
      value.fromMe !== false ||
      (typeof value.source === "string" &&
        value.source.trim().toLowerCase() === "api")
    ) {
      return providerError("terminal_error", "provider_identity_mismatch");
    }
  } else if (value.to !== input.rawChatId || value.fromMe !== true) {
    return providerError("terminal_error", "provider_identity_mismatch");
  }

  const media = value.media;
  if (!isRecord(media)) {
    return providerError("retryable_error", "provider_media_unavailable");
  }
  if (
    typeof media.error === "string" &&
    media.error.trim().length > 0
  ) {
    return providerError("retryable_error", "provider_media_unavailable");
  }
  if (typeof media.url !== "string" || media.url.length === 0) {
    return providerError("retryable_error", "provider_media_unavailable");
  }

  return Object.freeze({
    url: requirePrivateWahaMediaUrl(media.url, input.wahaBaseUrl),
    providerFileName: normalizeProviderFileName(media.filename),
  });
}

async function safeFetch(
  request: typeof fetch,
  url: string | URL,
  init: RequestInit,
  errorCode: "provider_message_unavailable" | "provider_media_unavailable",
): Promise<Response> {
  try {
    return await request(url, init);
  } catch {
    return providerError("retryable_error", errorCode);
  }
}

export function createPlatformWahaMediaProvider(
  config: PlatformWahaMediaEnabledConfig,
  dependencies: PlatformWahaMediaClientDependencies = {},
): PlatformWahaMediaProvider {
  const request = dependencies.fetch ?? fetch;
  const commonHeaders = Object.freeze({
    Accept: "application/json",
    "X-Api-Key": config.wahaApiKey,
  });

  return Object.freeze({
    async download(input) {
      validateRawIdentity(input.rawChatId, input.rawMessageId, input.direction);
      const messageUrl = new URL(
        `/api/${encodeURIComponent(config.sessionName)}/chats/${encodeURIComponent(input.rawChatId)}/messages/${encodeURIComponent(input.rawMessageId)}`,
        config.wahaBaseUrl,
      );
      messageUrl.searchParams.set("downloadMedia", "true");

      const lookup = await safeFetch(
        request,
        messageUrl,
        {
          method: "GET",
          headers: commonHeaders,
          redirect: "error",
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        },
        "provider_message_unavailable",
      );
      if (!lookup.ok || lookup.redirected) {
        return providerError("retryable_error", "provider_message_unavailable");
      }
      const source = parseMessageSource(
        await readBoundedJson(lookup, config.metadataMaxBytes),
        {
          sessionName: config.sessionName,
          rawChatId: input.rawChatId,
          rawMessageId: input.rawMessageId,
          direction: input.direction,
          wahaBaseUrl: config.wahaBaseUrl,
        },
      );

      const media = await safeFetch(
        request,
        source.url,
        {
          method: "GET",
          headers: {
            Accept: "application/octet-stream",
            "X-Api-Key": config.wahaApiKey,
          },
          redirect: "error",
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        },
        "provider_media_unavailable",
      );
      if (!media.ok || media.redirected) {
        return providerError("retryable_error", "provider_media_unavailable");
      }
      const bytes = await readBoundedBytes(media, config.maxBytes);
      if (bytes.byteLength === 0) {
        return providerError("terminal_error", "media_empty");
      }
      return Object.freeze({
        bytes,
        providerFileName: source.providerFileName,
      });
    },
  });
}
