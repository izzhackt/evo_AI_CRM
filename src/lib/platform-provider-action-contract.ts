import "server-only";

/**
 * Exact staff intent of the «Продажи → WhatsApp» chat (owner decision
 * 06.10.2026, migration 266). The browser names only the chat, the customer
 * message the reply answers, its own idempotency key and the final text; it
 * never names a recipient, session or provider id. Anything else — an extra
 * key, a non-UUID, the nil UUID, text with control characters or over the
 * limit — is refused before the database is asked.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
// Line feeds are message content; every other control character is refused.
const UNSAFE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0009\u000b-\u001f\u007f]/;
export const PLATFORM_WHATSAPP_TEXT_LIMIT = 3_000;

const SEND_KEYS = Object.freeze(["conversationId", "sourceMessageId", "requestId", "text"]);
const RECONCILE_KEYS = Object.freeze(["conversationId", "attemptId", "requestId"]);

export type PlatformWhatsAppChatSendInput = Readonly<{
  conversationId: string;
  sourceMessageId: string;
  requestId: string;
  text: string;
}>;

export type PlatformWhatsAppChatReconcileInput = Readonly<{
  conversationId: string;
  attemptId: string;
  requestId: string;
}>;

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(record, key)) ? record : null;
}

function normalizedUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function exactMessageText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const length = Array.from(value).length;
  if (
    value !== value.trim() ||
    length < 1 ||
    length > PLATFORM_WHATSAPP_TEXT_LIMIT ||
    UNSAFE_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }
  return value;
}

export function parsePlatformWhatsAppChatSendInput(
  value: unknown,
): PlatformWhatsAppChatSendInput | null {
  const record = exactRecord(value, SEND_KEYS);
  if (record === null) return null;
  const conversationId = normalizedUuid(record.conversationId);
  const sourceMessageId = normalizedUuid(record.sourceMessageId);
  const requestId = normalizedUuid(record.requestId);
  const text = exactMessageText(record.text);
  if (conversationId === null || sourceMessageId === null || requestId === null || text === null) {
    return null;
  }
  return Object.freeze({ conversationId, sourceMessageId, requestId, text });
}

export function parsePlatformWhatsAppChatReconcileInput(
  value: unknown,
): PlatformWhatsAppChatReconcileInput | null {
  const record = exactRecord(value, RECONCILE_KEYS);
  if (record === null) return null;
  const conversationId = normalizedUuid(record.conversationId);
  const attemptId = normalizedUuid(record.attemptId);
  const requestId = normalizedUuid(record.requestId);
  if (conversationId === null || attemptId === null || requestId === null) return null;
  return Object.freeze({ conversationId, attemptId, requestId });
}
