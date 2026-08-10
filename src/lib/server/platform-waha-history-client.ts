import "server-only";

import type { PlatformWahaHistoryEnabledConfig } from "./platform-waha-history-config.ts";
import {
  isSafeWahaProviderId,
  isWahaDirectChatId,
} from "./platform-waha-identifiers.ts";

const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_BODY_BYTES = 64 * 1024;
const MAX_UNIX_TIMESTAMP_SECONDS = 4_102_444_800;

export const PLATFORM_WAHA_HISTORY_MEDIA_MARKER =
  "[Медиа из истории — вложение ожидает безопасного архивирования]" as const;

export type PlatformWahaHistoryEngine = "NOWEB" | "GOWS" | "WEBJS";

export type PlatformWahaHistorySession = Readonly<{
  name: "evo-inbox";
  status: "WORKING";
  engine: PlatformWahaHistoryEngine;
}>;

export type PlatformWahaHistoryChat = Readonly<{
  rawChatId: string;
  sourceOffset: number;
}>;

export type PlatformWahaHistoryMessage = Readonly<{
  rawMessageId: string;
  direction: "inbound" | "outbound";
  occurredAt: string;
  bodyText: string;
  hasMedia: boolean;
}>;

export type PlatformWahaHistoryChatPage = Readonly<{
  chats: readonly PlatformWahaHistoryChat[];
  receivedCount: number;
  hasMore: boolean;
}>;

export type PlatformWahaHistoryMessagePage = Readonly<{
  messages: readonly PlatformWahaHistoryMessage[];
  receivedCount: number;
  hasMore: boolean;
}>;

export type PlatformWahaHistoryClient = Readonly<{
  preflight(): Promise<PlatformWahaHistorySession>;
  listChats(input: Readonly<{ offset: number; limit: number }>): Promise<PlatformWahaHistoryChatPage>;
  listMessages(input: Readonly<{
    rawChatId: string;
    offset: number;
    limit: number;
  }>): Promise<PlatformWahaHistoryMessagePage>;
}>;

export type PlatformWahaHistoryClientDependencies = Readonly<{
  fetch?: typeof fetch;
}>;

export class PlatformWahaHistoryProviderError extends Error {
  constructor() {
    super("WAHA history is unavailable.");
    this.name = "PlatformWahaHistoryProviderError";
  }
}

function providerError(): never {
  throw new PlatformWahaHistoryProviderError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function safeProviderId(value: unknown): string {
  if (!isSafeWahaProviderId(value)) {
    return providerError();
  }
  return value;
}

function normalizeBody(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_MESSAGE_BODY_BYTES) {
    return providerError();
  }
  return value.trim();
}

function normalizeMessage(value: unknown): PlatformWahaHistoryMessage {
  if (!isRecord(value)) return providerError();
  const rawMessageId = safeProviderId(value.id);
  if (
    !Number.isSafeInteger(value.timestamp) ||
    (value.timestamp as number) <= 0 ||
    (value.timestamp as number) > MAX_UNIX_TIMESTAMP_SECONDS ||
    typeof value.fromMe !== "boolean" ||
    (value.hasMedia !== undefined && typeof value.hasMedia !== "boolean")
  ) {
    return providerError();
  }

  const hasMedia = value.hasMedia === true;
  const body = normalizeBody(value.body);
  if (body.length === 0 && !hasMedia) return providerError();

  return Object.freeze({
    rawMessageId,
    direction: value.fromMe ? "outbound" : "inbound",
    occurredAt: new Date((value.timestamp as number) * 1000).toISOString(),
    bodyText: body.length > 0 ? body : PLATFORM_WAHA_HISTORY_MEDIA_MARKER,
    hasMedia,
  });
}

function normalizeSession(
  value: unknown,
  sessionName: "evo-inbox",
): PlatformWahaHistorySession {
  if (
    !isRecord(value) ||
    value.name !== sessionName ||
    value.status !== "WORKING" ||
    !isRecord(value.engine)
  ) {
    return providerError();
  }
  const engine = value.engine.engine;
  if (engine !== "NOWEB" && engine !== "GOWS" && engine !== "WEBJS") {
    return providerError();
  }
  if (engine === "NOWEB") {
    if (
      !isRecord(value.config) ||
      !isRecord(value.config.noweb) ||
      !isRecord(value.config.noweb.store) ||
      value.config.noweb.store.enabled !== true
    ) {
      return providerError();
    }
  }
  return Object.freeze({ name: sessionName, status: "WORKING", engine });
}

function normalizeChats(
  value: unknown,
  limit: number,
  offset: number,
): PlatformWahaHistoryChatPage {
  if (!Array.isArray(value) || value.length > limit) return providerError();
  const chats: PlatformWahaHistoryChat[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return providerError();
    const rawChatId = safeProviderId(item.id);
    if (isWahaDirectChatId(rawChatId)) {
      chats.push(Object.freeze({ rawChatId, sourceOffset: offset + index }));
    }
  }
  return Object.freeze({
    chats: Object.freeze(chats),
    receivedCount: value.length,
    // WAHA can return a short, non-empty page before a later offset. Only an
    // empty response proves exhaustion; the processor advances by the
    // requested limit after every non-empty page.
    hasMore: value.length > 0,
  });
}

function normalizeMessages(value: unknown, limit: number): PlatformWahaHistoryMessagePage {
  if (!Array.isArray(value) || value.length > limit) return providerError();
  const messages: PlatformWahaHistoryMessage[] = [];
  const messageIds = new Set<string>();
  for (const item of value) {
    const message = normalizeMessage(item);
    if (messageIds.has(message.rawMessageId)) return providerError();
    messageIds.add(message.rawMessageId);
    messages.push(message);
  }
  return Object.freeze({
    messages: Object.freeze(messages),
    receivedCount: value.length,
    hasMore: value.length > 0,
  });
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok || response.type === "opaqueredirect") return providerError();
  const contentType = response.headers.get("content-type");
  if (contentType === null || !contentType.toLowerCase().includes("application/json")) {
    return providerError();
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_PROVIDER_RESPONSE_BYTES)
  ) {
    return providerError();
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_PROVIDER_RESPONSE_BYTES) {
    return providerError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return providerError();
  }
}

export function createPlatformWahaHistoryClient(
  config: Pick<
    PlatformWahaHistoryEnabledConfig,
    "wahaBaseUrl" | "wahaApiKey" | "sessionName" | "requestTimeoutMs"
  >,
  dependencies: PlatformWahaHistoryClientDependencies = {},
): PlatformWahaHistoryClient {
  const request = dependencies.fetch ?? fetch;

  async function get(path: string, query?: URLSearchParams): Promise<unknown> {
    const url = new URL(path, `${config.wahaBaseUrl}/`);
    if (query !== undefined) url.search = query.toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await request(url, {
        method: "GET",
        headers: Object.freeze({
          Accept: "application/json",
          "X-Api-Key": config.wahaApiKey,
        }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      return await responseJson(response);
    } catch (error) {
      if (error instanceof PlatformWahaHistoryProviderError) throw error;
      return providerError();
    } finally {
      clearTimeout(timeout);
    }
  }

  return Object.freeze({
    async preflight() {
      const value = await get(
        `api/sessions/${encodeURIComponent(config.sessionName)}`,
      );
      return normalizeSession(value, config.sessionName);
    },

    async listChats(input) {
      if (!nonNegativeInteger(input.offset) || !positiveInteger(input.limit)) {
        return providerError();
      }
      const query = new URLSearchParams({
        limit: String(input.limit),
        offset: String(input.offset),
        sortBy: "id",
        sortOrder: "asc",
      });
      return normalizeChats(
        await get(`api/${encodeURIComponent(config.sessionName)}/chats`, query),
        input.limit,
        input.offset,
      );
    },

    async listMessages(input) {
      if (
        !isWahaDirectChatId(input.rawChatId) ||
        !nonNegativeInteger(input.offset) ||
        !positiveInteger(input.limit)
      ) {
        return providerError();
      }
      const query = new URLSearchParams({
        limit: String(input.limit),
        offset: String(input.offset),
        downloadMedia: "false",
      });
      return normalizeMessages(
        await get(
          `api/${encodeURIComponent(config.sessionName)}/chats/${encodeURIComponent(input.rawChatId)}/messages`,
          query,
        ),
        input.limit,
      );
    },
  });
}
