import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getPlatformMessagingBackendConfig,
  PLATFORM_WAHA_SESSION_NAME,
  PlatformMessagingBackendConfigurationError,
  type PlatformMessagingBackendConfig,
} from "./platform-messaging-backend-config.ts";
import { isPlatformWahaIngressEnabled } from "./platform-waha-ingress-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  PlatformWahaProjectorError,
  projectPlatformWahaWorkItem,
} from "./platform-waha-projector.ts";

// A direct GOWS media event carries the message twice (`_data.Message` and
// `_data.RawMessage`, both with the base64 `JPEGThumbnail`) and a quoted media
// message a third time (`replyTo._data`); a link preview or a document preview
// can bring a thumbnail of tens of KiB. 64 KiB could answer such a real customer
// message with 413, and WAHA retries every failed delivery unchanged (axios-retry
// with `retryCondition: () => true`, 15 attempts by default) until it gives up,
// so the message would be lost. 256 KiB keeps about four times that headroom
// and is still a small fixed bound. The stored `raw_payload` is jsonb with no
// size check on it (no CHECK, no length test in the persist routine). The route
// is public at the edge but HMAC-authenticated and inert unless the owner enabled
// it. Source citations: the PR description.
//
// The route is reachable on the public host, so the bound is enforced while the
// body is read, not after it: a declared Content-Length above it is refused
// before a single byte is read, and a body with no (or a false) Content-Length,
// such as a chunked one, is read as a stream and the upload is cancelled as soon
// as it passes the bound. The signature is checked over the raw bytes before
// they are parsed.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_IDENTIFIER_BYTES = 256;
const MIN_WEBHOOK_SECRET_BYTES = 32;
const MAX_WEBHOOK_SECRET_BYTES = 128;
const SHA512_HEX_PATTERN = /^[0-9a-f]{128}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const DIRECT_CHAT_PATTERN =
  /^[1-9][0-9]{6,14}@(c\.us|s\.whatsapp\.net)$/;
// WhatsApp may report a customer by an opaque LID instead of the phone JID
// (https://waha.devlike.pro/docs/how-to/contacts/, LID section). The chat id
// WAHA reports is the one a reply is sent to; the projection keeps it as is.
const DIRECT_LID_PATTERN = /^[1-9][0-9]{4,31}@lid$/;
// Groups, Status (`status@broadcast`), broadcast lists and channels are not
// sales conversations. WAHA documents these chat-id suffixes at
// https://waha.devlike.pro/docs/how-to/receive-messages/ and
// https://waha.devlike.pro/docs/how-to/events/ .
const NON_DIRECT_CHAT_PATTERN = /@(g\.us|broadcast|newsletter)$/i;
// A JID may carry a device suffix (`79990000000:12@s.whatsapp.net`, WAHA's
// `me.jid`, GOWS `_data.Info.Sender`); the chat and the account have none.
const JID_DEVICE_SUFFIX_PATTERN = /:\d+(?=@)/;
const WAHA_ACK_NAMES = new Map<number, string>([
  [-1, "ERROR"],
  [0, "PENDING"],
  [1, "SERVER"],
  [2, "DEVICE"],
  [3, "READ"],
  [4, "PLAYED"],
]);
const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

type RpcClient = Pick<SupabaseClient, "schema">;

export type PlatformWahaWebhookDependencies = Readonly<{
  createServiceClient(config: PlatformMessagingBackendConfig): RpcClient;
}>;

const defaultDependencies: PlatformWahaWebhookDependencies = {
  createServiceClient: createPlatformSupabaseServiceClient,
};

type JsonObject = Record<string, unknown>;

type WahaEventDescriptor = Readonly<{
  eventType: "message.any" | "message.ack" | "session.status";
  payloadId: string;
  providerEventVariantRef: string | null;
  providerRequestId: string;
  occurredAt: string;
  businessKeySha256: string;
  shouldEnqueue: boolean;
  shouldSynchronizeSession: boolean;
}>;

type WahaIgnoredEvent = Readonly<{
  ignored: true;
  reason: "non_direct_chat" | "system_notice" | "own_chat";
}>;

type PersistedEvent = Readonly<{
  id: string;
  deduplicated: boolean;
}>;

class PlatformWahaWebhookRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "PlatformWahaWebhookRequestError";
    this.status = status;
    this.code = code;
  }
}

class PlatformWahaWebhookConfigurationError extends Error {
  constructor() {
    super("Platform WAHA webhook is not configured.");
    this.name = "PlatformWahaWebhookConfigurationError";
  }
}

function reject(status: number, code: string): never {
  throw new PlatformWahaWebhookRequestError(status, code);
}

function json(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function errorResponse(status: number, code: string): Response {
  return json(status, { ok: false, error: code });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectChatId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (DIRECT_CHAT_PATTERN.test(value) || DIRECT_LID_PATTERN.test(value))
  );
}

function isNonDirectChatId(value: unknown): boolean {
  return typeof value === "string" && NON_DIRECT_CHAT_PATTERN.test(value.trim());
}

// GOWS (whatsmeow) puts the message metadata in `_data.Info`: `Chat` (the other
// side of a direct chat in BOTH directions), `Sender`, `IsFromMe`, `PushName`,
// `SenderAlt` / `RecipientAlt`. WEBJS has no `_data.Info`.
function messageInfo(payload: JsonObject): JsonObject | null {
  const data = isObject(payload._data) ? payload._data : null;
  return data !== null && isObject(data.Info) ? data.Info : null;
}

// A direct JID in the one form the CRM compares: device suffix removed,
// `@s.whatsapp.net` written as `@c.us`; null when it is not a direct chat id.
function normalizedDirectJid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const jid = value
    .trim()
    .toLowerCase()
    .replace(JID_DEVICE_SUFFIX_PATTERN, "")
    .replace(/@s\.whatsapp\.net$/, "@c.us");
  return isDirectChatId(jid) ? jid : null;
}

// The session's own account, as the signed envelope and the message itself name
// it: `me.id` (phone), `me.lid`, `me.jid` (with device) and, for a message an
// own device sent, GOWS `_data.Info.Sender`. The own number is never a customer
// and never a customer's phone: WAHA 2026.8.1 mapped the own number to foreign
// LIDs (devlikeapro/waha#2241, guarded in gows-plus v1.0.46).
function ownChatIds(body: JsonObject, payload: JsonObject): ReadonlySet<string> {
  const ids = new Set<string>();
  const me = isObject(body.me) ? body.me : null;
  const info = messageInfo(payload);
  const candidates: unknown[] = [me?.id, me?.lid, me?.jid];
  if (payload.fromMe === true && info?.IsFromMe === true) {
    candidates.push(info.Sender);
  }
  for (const candidate of candidates) {
    const id = normalizedDirectJid(candidate);
    if (id !== null) ids.add(id);
  }
  return ids;
}

// Mirrors the chat-id candidates the projection reads, plus `to`, which carries
// the chat for messages sent from the phone or from the API.
function isNonDirectChatEvent(payload: JsonObject): boolean {
  const data = isObject(payload._data) ? payload._data : null;
  const dataId = data !== null && isObject(data.id) ? data.id : null;
  const info = messageInfo(payload);
  return [
    payload.from,
    payload.to,
    payload.chatId,
    data?.from,
    data?.to,
    dataId?.remote,
    // GOWS: the chat of a message / of a receipt.
    info?.Chat,
    data?.Chat,
  ].some(isNonDirectChatId);
}

// WEBJS reports WhatsApp's own notices through `message.any` with these
// `_data.type` values (whatsapp-web.js MessageTypes): the end-to-end
// encryption banner, notifications and template notifications, broadcast
// notifications, group notifications, protocol messages and revoked-message
// stubs. WAHA 2026.9.2 itself drops the first four before the webhook
// (WhatsappSessionWebJSCore.SYSTEM_NOTIFICATION_TYPES); WAHA 2026.7.1 does not.
// They carry nothing a customer wrote, so they are the only text-less events
// that are ignored. Every other direct event without text or media (a location
// pin, a contact card, a poll, an undecryptable message, ...) is a customer
// message the staff must see: it reaches the projection, which stores the
// generic review notice and a handoff.
const SYSTEM_MESSAGE_TYPES = new Set([
  "e2e_notification",
  "notification",
  "notification_template",
  "broadcast_notification",
  "gp2",
  "protocol",
  "revoked",
]);

// GOWS has no `_data.type`; the content is `_data.Message`, the whatsmeow
// `waE2E.Message` as JSON (lowerCamel field names). WAHA already keeps most of
// these out of `message.any` (its GOWS `shouldProcessIncomingMessage` drops a
// protocol, reaction, poll-vote or event-response message and a message that is
// only a sender-key distribution, and routes them to `message.revoked` /
// `message.edited` / `message.reaction`), so this is the second line for a WAHA
// that emits one anyway. A message is a notice only when EVERY top-level key is
// one of these (plus the companion keys below, and at least one non-companion
// key or a sender-key distribution); an empty `Message`, an unknown key or any
// real content key is a customer message and goes to staff review, as for WEBJS.
const GOWS_SYSTEM_MESSAGE_KEYS = new Set([
  "protocolMessage", // revoke (type 0), edit, ephemeral setting, history sync, ...
  "reactionMessage",
  "encReactionMessage",
  "pollUpdateMessage",
  "encEventResponseMessage",
  "keepInChatMessage",
]);
const GOWS_COMPANION_MESSAGE_KEYS = new Set([
  "messageContextInfo",
  "senderKeyDistributionMessage",
  "fastRatchetKeySenderKeyDistributionMessage",
]);
// Pure key material: a message holding only this (and a message context) never
// carries anything a customer wrote (WAHA: "Ignore key distribution messages").
const GOWS_KEY_DISTRIBUTION_KEYS = new Set([
  "senderKeyDistributionMessage",
  "fastRatchetKeySenderKeyDistributionMessage",
]);

// WAHA classifies a GOWS message only after Baileys `normalizeMessageContent`
// (devlikeapro/Baileys fork-master-2026-04-28, src/Utils/messages.ts, the
// package WAHA 2026.9.2 pins) has peeled the "future proof" wrappers off it, up
// to five levels, so a reaction or a protocol message inside a disappearing
// message (`ephemeralMessage`) is dropped like a bare one. The same wrappers,
// the same depth. A level is peeled only when the wrapper is its single content
// key (companion keys aside) and holds an object `message`; a wrapper next to
// other content, an empty wrapper or one with no inner message is not a notice
// and is left for staff review.
const GOWS_WRAPPER_MESSAGE_KEYS = new Set([
  "ephemeralMessage",
  "viewOnceMessage",
  "documentWithCaptionMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "editedMessage",
  "associatedChildMessage",
  "groupStatusMessage",
  "groupStatusMessageV2",
  "lottieStickerMessage",
]);
const GOWS_MAX_WRAPPER_DEPTH = 5;

function peelGowsWrappers(message: JsonObject): JsonObject {
  let current = message;
  for (let depth = 0; depth < GOWS_MAX_WRAPPER_DEPTH; depth += 1) {
    const content = Object.keys(current).filter(
      (key) => !GOWS_COMPANION_MESSAGE_KEYS.has(key),
    );
    if (content.length !== 1 || !GOWS_WRAPPER_MESSAGE_KEYS.has(content[0])) {
      break;
    }
    const wrapper = current[content[0]];
    const inner = isObject(wrapper) ? wrapper.message : null;
    if (!isObject(inner)) break;
    current = inner;
  }
  return current;
}

function isGowsSystemMessage(data: JsonObject | null): boolean {
  const outer = data !== null && isObject(data.Message) ? data.Message : null;
  if (outer === null) return false;
  const message = peelGowsWrappers(outer);
  const all = Object.keys(message);
  const content = all.filter((key) => !GOWS_COMPANION_MESSAGE_KEYS.has(key));
  if (content.length === 0) {
    return all.some((key) => GOWS_KEY_DISTRIBUTION_KEYS.has(key));
  }
  return content.every((key) => GOWS_SYSTEM_MESSAGE_KEYS.has(key));
}

function isSystemNotice(payload: JsonObject): boolean {
  const data = isObject(payload._data) ? payload._data : null;
  return (
    (typeof data?.type === "string" &&
      SYSTEM_MESSAGE_TYPES.has(data.type.trim().toLowerCase())) ||
    isGowsSystemMessage(data)
  );
}

// WAHA reports media as `hasMedia: true` and/or a `media` object; the caption
// travels in `body` (https://waha.devlike.pro/docs/how-to/receive-messages/).
function carriesMedia(payload: JsonObject): boolean {
  return payload.hasMedia === true || isObject(payload.media);
}

function boundedIdentifier(value: unknown, code: string): string {
  if (typeof value !== "string") return reject(400, code);
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized !== value ||
    Buffer.byteLength(normalized, "utf8") > MAX_IDENTIFIER_BYTES ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return reject(400, code);
  }
  return normalized;
}

function readWebhookSecret(environment: NodeJS.ProcessEnv): string {
  const secret = environment.EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET;
  const bytes = secret === undefined ? 0 : Buffer.byteLength(secret, "utf8");
  if (
    secret === undefined ||
    secret !== secret.trim() ||
    bytes < MIN_WEBHOOK_SECRET_BYTES ||
    bytes > MAX_WEBHOOK_SECRET_BYTES ||
    CONTROL_CHARACTER_PATTERN.test(secret)
  ) {
    throw new PlatformWahaWebhookConfigurationError();
  }
  return secret;
}

// True only for a well-formed Content-Length above the bound. A malformed
// value is not trusted either way; the streaming bound still applies.
function declaredLengthExceedsBound(request: Request): boolean {
  const declared = request.headers.get("content-length")?.trim();
  return (
    declared !== undefined &&
    /^[0-9]+$/.test(declared) &&
    Number(declared) > MAX_BODY_BYTES
  );
}

// The raw body, or null once it has passed the bound (the upload is cancelled
// at that point, so an endless or oversized body is never buffered).
async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const rawBody = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return rawBody;
}

function verifySignature(request: Request, rawBody: Uint8Array, secret: string) {
  const algorithm = request.headers.get("x-webhook-hmac-algorithm");
  const supplied = request.headers
    .get("x-webhook-hmac")
    ?.replace(/^sha512=/i, "")
    .trim();
  if (algorithm?.toLowerCase() !== "sha512" || !supplied) {
    return reject(401, "invalid_signature");
  }
  if (!SHA512_HEX_PATTERN.test(supplied)) {
    return reject(401, "invalid_signature");
  }

  const expected = createHmac("sha512", secret).update(rawBody).digest();
  const provided = Buffer.from(supplied, "hex");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return reject(401, "invalid_signature");
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseOccurredAt(value: unknown): string | null {
  let milliseconds: number;
  if (typeof value === "number" && Number.isFinite(value)) {
    milliseconds = value < 100_000_000_000 ? value * 1_000 : value;
  } else if (typeof value === "string" && value.trim() === value) {
    const numeric = Number(value);
    milliseconds = Number.isFinite(numeric)
      ? numeric < 100_000_000_000
        ? numeric * 1_000
        : numeric
      : Date.parse(value);
  } else {
    return null;
  }
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function providerRequestId(body: JsonObject): string {
  if (typeof body.id === "string") {
    return boundedIdentifier(body.id, "invalid_provider_request_id");
  }
  return `local-waha-delivery:${randomUUID()}`;
}

// The one customer chat of a message the sales team sent from the phone or the
// app. Engines differ in where they put it: WEBJS `to` (`from` is the own
// number); GOWS `to` is null for a direct chat and `from` is the chat in BOTH
// directions, with `_data.Info.Chat` the same chat as a raw JID. So: `to` when it
// is a direct JID, else `_data.Info.Chat`, else `from`, and `from` only when the
// own number is known (the signed envelope's `me`), to be sure it is not the own
// number. The own number is never a customer: a note to self or a peer message
// resolves to nothing.
function phoneSentCustomerChat(
  payload: JsonObject,
  own: ReadonlySet<string>,
): string | null {
  const candidates: unknown[] = [payload.to, messageInfo(payload)?.Chat];
  if (own.size > 0) candidates.push(payload.from);
  for (const candidate of candidates) {
    if (!isDirectChatId(candidate)) continue;
    const chat = normalizedDirectJid(candidate);
    return chat !== null && !own.has(chat) ? chat : null;
  }
  return null;
}

// A message the sales team sent from the phone or the WhatsApp app: WAHA marks
// its origin `source: "app"` (the CRM's own API sends are `api`). Only such a
// message to one direct chat, with text or media, is projected into the
// conversation; the CRM's own sends and everything else stay evidence only.
function isPhoneSentDirectMessage(
  payload: JsonObject,
  own: ReadonlySet<string>,
): boolean {
  if (payload.fromMe !== true) return false;
  if (
    typeof payload.source !== "string" ||
    payload.source.trim().toLowerCase() !== "app"
  ) {
    return false;
  }
  const hasText =
    typeof payload.body === "string" && payload.body.trim().length > 0;
  return (
    phoneSentCustomerChat(payload, own) !== null &&
    (hasText || carriesMedia(payload))
  );
}

function parseMessageAny(
  body: JsonObject,
  payload: JsonObject,
  requestId: string,
): WahaEventDescriptor | WahaIgnoredEvent {
  if (isNonDirectChatEvent(payload)) {
    return { ignored: true, reason: "non_direct_chat" };
  }
  const own = ownChatIds(body, payload);
  const payloadId = boundedIdentifier(payload.id, "invalid_message_id");
  if (typeof payload.fromMe !== "boolean") {
    return reject(400, "invalid_message_direction");
  }
  if (payload.fromMe === false) {
    const from = boundedIdentifier(payload.from, "invalid_message_sender");
    if (!isDirectChatId(from)) {
      return reject(400, "invalid_message_sender");
    }
    // The own number is never a customer (WAHA and whatsmeow report an own
    // message as `fromMe`, so this is a safeguard, not a path seen so far).
    if (own.has(normalizedDirectJid(from) ?? "")) {
      return { ignored: true, reason: "own_chat" };
    }
    const hasText =
      typeof payload.body === "string" && payload.body.trim().length > 0;
    if (hasText && (payload.body as string).length > 4_000) {
      return reject(400, "invalid_message_body");
    }
    // A message without text (media, a location pin, a contact card, ...) must
    // still reach the projection, which stores a typed media marker or the
    // generic staff-review notice with a handoff; nothing is downloaded. Only
    // WhatsApp's own notices are ignored.
    if (!hasText && !carriesMedia(payload) && isSystemNotice(payload)) {
      return { ignored: true, reason: "system_notice" };
    }
  }
  const occurredAt = parseOccurredAt(body.timestamp ?? payload.timestamp);
  if (occurredAt === null) return reject(400, "invalid_event_timestamp");

  return {
    eventType: "message.any",
    payloadId,
    providerEventVariantRef: null,
    providerRequestId: requestId,
    occurredAt,
    businessKeySha256: sha256(
      `waha:${PLATFORM_WAHA_SESSION_NAME}:message:${payloadId}`,
    ),
    shouldEnqueue:
      payload.fromMe === false || isPhoneSentDirectMessage(payload, own),
    shouldSynchronizeSession: false,
  };
}

// The chat an acknowledgement is about, as the engines report it: WEBJS `to` is
// the customer (`from` is the own number whatever the chat), GOWS has `to` null
// and the chat in `_data.Chat` (a receipt) or `_data.Info.Chat`, and both build
// the message id as `<fromMe>_<chat>_<ID>`. `from` is deliberately not read: it
// is the own number in every WEBJS acknowledgement. Null when nothing names a
// direct chat.
const ACK_MESSAGE_ID_CHAT_PATTERN = /^(?:true|false)_([^_]+)_/;

function ackChat(payload: JsonObject): string | null {
  const data = isObject(payload._data) ? payload._data : null;
  const fromMessageId =
    typeof payload.id === "string"
      ? ACK_MESSAGE_ID_CHAT_PATTERN.exec(payload.id)?.[1]
      : undefined;
  const candidates: unknown[] = [
    payload.to,
    data?.Chat,
    messageInfo(payload)?.Chat,
    fromMessageId,
  ];
  for (const candidate of candidates) {
    const chat = normalizedDirectJid(candidate);
    if (chat !== null) return chat;
  }
  return null;
}

function parseMessageAck(
  body: JsonObject,
  payload: JsonObject,
  requestId: string,
  rawPayloadSha256: string,
): WahaEventDescriptor | WahaIgnoredEvent {
  if (isNonDirectChatEvent(payload)) {
    return { ignored: true, reason: "non_direct_chat" };
  }
  const rawMessageId = boundedIdentifier(payload.id, "invalid_message_id");
  if (payload.fromMe !== true) {
    return reject(400, "invalid_ack_direction");
  }
  if (!Number.isInteger(payload.ack)) return reject(400, "invalid_ack");
  const expectedName = WAHA_ACK_NAMES.get(payload.ack as number);
  if (
    expectedName === undefined ||
    payload.ackName !== expectedName
  ) {
    return reject(400, "invalid_ack");
  }
  const providerTimestamp = body.timestamp ?? payload.timestamp;
  const parsedOccurredAt = parseOccurredAt(providerTimestamp);
  const occurredAt = parsedOccurredAt ?? new Date().toISOString();
  const payloadId =
    parsedOccurredAt === null
      ? `local-message-ack-delivery:${rawPayloadSha256}:${sha256(requestId)}`
      : rawMessageId;
  // An acknowledgement of a message in the own chat (a note to self) belongs to
  // a message that is never projected; enqueued, it would only be retried as
  // `waha_ack_binding_pending`. Nothing to observe, nothing to retry.
  const chat = ackChat(payload);
  if (chat !== null && ownChatIds(body, payload).has(chat)) {
    return { ignored: true, reason: "own_chat" };
  }
  const variant = expectedName.toLowerCase();

  return {
    eventType: "message.ack",
    payloadId,
    providerEventVariantRef: variant,
    providerRequestId: requestId,
    occurredAt,
    businessKeySha256: sha256(
      `waha:${PLATFORM_WAHA_SESSION_NAME}:message.ack:${rawMessageId}:${variant}:${parsedOccurredAt ?? rawPayloadSha256}`,
    ),
    shouldEnqueue: true,
    shouldSynchronizeSession: false,
  };
}

function parseSessionStatus(
  body: JsonObject,
  payload: JsonObject,
  requestId: string,
  rawPayloadSha256: string,
): WahaEventDescriptor {
  if (payload.name !== PLATFORM_WAHA_SESSION_NAME) {
    return reject(403, "invalid_session");
  }
  const status = boundedIdentifier(payload.status, "invalid_session_status");
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(status)) {
    return reject(400, "invalid_session_status");
  }
  const parsedOccurredAt = parseOccurredAt(body.timestamp);
  const occurredAt = parsedOccurredAt ?? new Date().toISOString();
  const payloadId =
    typeof body.id === "string"
      ? boundedIdentifier(body.id, "invalid_provider_request_id")
      : `local-session-status-delivery:${rawPayloadSha256}:${sha256(requestId)}`;

  return {
    eventType: "session.status",
    payloadId,
    providerEventVariantRef: null,
    providerRequestId: requestId,
    occurredAt,
    businessKeySha256: sha256(
      `waha:${PLATFORM_WAHA_SESSION_NAME}:session.status:${typeof body.id === "string" ? body.id : rawPayloadSha256}`,
    ),
    shouldEnqueue: false,
    shouldSynchronizeSession: true,
  };
}

function parseEvent(
  body: JsonObject,
  rawPayloadSha256: string,
): WahaEventDescriptor | WahaIgnoredEvent | null {
  if (body.session !== PLATFORM_WAHA_SESSION_NAME) {
    return reject(403, "invalid_session");
  }
  if (typeof body.event !== "string") return reject(400, "invalid_event");
  if (!isObject(body.payload)) return reject(400, "invalid_payload");
  const requestId = providerRequestId(body);

  if (body.event === "message.any") {
    return parseMessageAny(body, body.payload, requestId);
  }
  if (body.event === "message.ack") {
    return parseMessageAck(
      body,
      body.payload,
      requestId,
      rawPayloadSha256,
    );
  }
  if (body.event === "session.status") {
    return parseSessionStatus(
      body,
      body.payload,
      requestId,
      rawPayloadSha256,
    );
  }
  return null;
}

function normalizePersistedEvent(value: unknown): PersistedEvent {
  if (!isObject(value)) return reject(503, "provider_evidence_unavailable");
  const id = value.provider_webhook_event_id;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    return reject(503, "provider_evidence_unavailable");
  }
  if (typeof value.deduplicated !== "boolean") {
    return reject(503, "provider_evidence_unavailable");
  }
  return { id: id.toLowerCase(), deduplicated: value.deduplicated };
}

async function persistEvent(
  client: RpcClient,
  config: PlatformMessagingBackendConfig,
  body: JsonObject,
  descriptor: WahaEventDescriptor,
  rawPayloadSha256: string,
): Promise<PersistedEvent> {
  let result;
  try {
    result = await client.schema("platform").rpc("persist_provider_webhook_event", {
      p_organization_id: config.organizationId,
      p_provider: "waha",
      p_provider_account_ref: `waha:${PLATFORM_WAHA_SESSION_NAME}`,
      p_provider_conversation_ref: null,
      p_provider_event_variant_ref: descriptor.providerEventVariantRef,
      p_provider_request_id: descriptor.providerRequestId,
      p_waha_session_name: PLATFORM_WAHA_SESSION_NAME,
      p_payload_id: descriptor.payloadId,
      p_event_type: descriptor.eventType,
      p_provider_occurred_at: descriptor.occurredAt,
      p_verification_status: "verified",
      p_raw_payload: body,
      p_verification_headers: {
        hmac_algorithm: "sha512",
        hmac_verified: true,
        request_id_present: !descriptor.providerRequestId.startsWith(
          "local-waha-delivery:",
        ),
        timestamp_freshness_verified: false,
      },
      p_verification_evidence_ref: `waha-raw-sha256:${rawPayloadSha256}`,
      p_payload_sha256: rawPayloadSha256,
      p_request_id: randomUUID(),
    });
  } catch {
    return reject(503, "provider_evidence_unavailable");
  }
  const { data, error } = result;
  if (error) return reject(503, "provider_evidence_unavailable");
  return normalizePersistedEvent(data);
}

async function enqueueEvent(
  client: RpcClient,
  config: PlatformMessagingBackendConfig,
  persisted: PersistedEvent,
  descriptor: WahaEventDescriptor,
): Promise<string> {
  let result;
  try {
    result = await client.schema("platform").rpc("enqueue_verified_webhook_work", {
      p_organization_id: config.organizationId,
      p_source_webhook_event_id: persisted.id,
      p_business_key_sha256: descriptor.businessKeySha256,
      p_max_attempts: 8,
      p_request_id: randomUUID(),
    });
  } catch {
    return reject(503, "provider_queue_unavailable");
  }
  const { data, error } = result;
  if (
    error ||
    !isObject(data) ||
    typeof data.work_item_id !== "string" ||
    data.work_item_id !== data.work_item_id.trim() ||
    !UUID_PATTERN.test(data.work_item_id)
  ) {
    return reject(503, "provider_queue_unavailable");
  }
  return data.work_item_id.toLowerCase();
}

async function synchronizeSession(
  client: RpcClient,
  config: PlatformMessagingBackendConfig,
  persisted: PersistedEvent,
) {
  let result;
  try {
    result = await client.schema("platform").rpc("sync_lead_agent_session_status", {
      p_organization_id: config.organizationId,
      p_provider_webhook_event_id: persisted.id,
      p_request_id: randomUUID(),
    });
  } catch {
    return reject(503, "session_sync_unavailable");
  }
  const { data, error } = result;
  if (
    error ||
    !isObject(data) ||
    data.waha_session_name !== PLATFORM_WAHA_SESSION_NAME ||
    typeof data.status !== "string"
  ) {
    return reject(503, "session_sync_unavailable");
  }
}

export function createPlatformWahaWebhookHandler(
  dependencies: PlatformWahaWebhookDependencies = defaultDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    // The ingress is inert unless the owner switched it on with exactly "1":
    // refused before the body is read, the signature checked, the secret or
    // the backend configuration touched, or any Supabase call made, so a
    // present secret alone never opens the route. 503 is the same answer every
    // other "not configured" state gives.
    if (!isPlatformWahaIngressEnabled()) {
      return errorResponse(503, "waha_webhook_unavailable");
    }

    try {
      // Cheapest refusals first: a declared size above the bound is answered
      // before the body is touched, and an unconfigured route before anything
      // is buffered.
      if (declaredLengthExceedsBound(request)) {
        return errorResponse(413, "payload_too_large");
      }
      const config = getPlatformMessagingBackendConfig();
      const secret = readWebhookSecret(process.env);

      const rawBody = await readBoundedBody(request);
      if (rawBody === null) return errorResponse(413, "payload_too_large");
      if (rawBody.byteLength === 0) return errorResponse(400, "invalid_json");

      // Authenticate the raw bytes before they are parsed: an unsigned or wrongly
      // signed body never reaches JSON.parse.
      verifySignature(request, rawBody, secret);
      let body: unknown;
      try {
        body = JSON.parse(Buffer.from(rawBody).toString("utf8"));
      } catch {
        return errorResponse(400, "invalid_json");
      }
      if (!isObject(body)) return errorResponse(400, "invalid_json");

      const rawPayloadSha256 = sha256(rawBody);
      const descriptor = parseEvent(body, rawPayloadSha256);
      if (descriptor === null) {
        return json(202, { ok: true, status: "ignored" });
      }
      // Answer 200, never 4xx: this is not a failure and must not be retried.
      if ("ignored" in descriptor) {
        return json(200, {
          ok: true,
          status: "ignored",
          reason: descriptor.reason,
        });
      }

      const client = dependencies.createServiceClient(config);
      const persisted = await persistEvent(
        client,
        config,
        body,
        descriptor,
        rawPayloadSha256,
      );
      if (descriptor.shouldSynchronizeSession) {
        await synchronizeSession(client, config, persisted);
        return json(200, {
          ok: true,
          status: "synchronized",
          eventType: descriptor.eventType,
          deduplicated: persisted.deduplicated,
        });
      }
      if (!descriptor.shouldEnqueue) {
        return json(202, {
          ok: true,
          status: "observed",
          eventType: descriptor.eventType,
          deduplicated: persisted.deduplicated,
        });
      }
      const workItemId = await enqueueEvent(
        client,
        config,
        persisted,
        descriptor,
      );
      const projection = await projectPlatformWahaWorkItem({
        client,
        organizationId: config.organizationId,
        workItemId,
      });
      return json(200, {
        ok: true,
        status: "projected",
        eventType: descriptor.eventType,
        deduplicated: persisted.deduplicated || projection.deduplicated,
      });
    } catch (error) {
      if (error instanceof PlatformWahaWebhookRequestError) {
        return errorResponse(error.status, error.code);
      }
      if (error instanceof PlatformMessagingBackendConfigurationError) {
        return errorResponse(503, "waha_webhook_unavailable");
      }
      if (error instanceof PlatformWahaWebhookConfigurationError) {
        return errorResponse(503, "waha_webhook_unavailable");
      }
      if (error instanceof PlatformWahaProjectorError) {
        return errorResponse(error.status, error.code);
      }
      return errorResponse(500, "internal_error");
    }
  };
}
