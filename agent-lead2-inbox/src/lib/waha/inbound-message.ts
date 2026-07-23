import type { ContentType } from '@/types';

import { extractWahaWebhookSessionName } from './webhook';

export interface WahaInboundMessage {
  sessionName: string;
  messageId: string;
  chatId: string;
  senderPhone: string;
  senderName: string | null;
  contentType: ContentType;
  contentText: string;
  media: WahaInboundMedia | null;
  receivedAt: string;
}

export interface WahaInboundMedia {
  url: string;
  mimetype: string;
  filename: string | null;
}

export type WahaInboundMessageParseResult =
  | { kind: 'message'; message: WahaInboundMessage }
  | { kind: 'ignored'; reason: 'from_me' | 'unsupported_chat' };

export class WahaInboundMessageParseError extends Error {
  readonly code = 'waha_message_malformed';
  readonly status = 400;
  readonly missingFields: string[];

  constructor(missingFields: string[]) {
    super(`WAHA message payload is missing: ${missingFields.join(', ')}`);
    this.name = 'WahaInboundMessageParseError';
    this.missingFields = missingFields;
  }
}

const DIRECT_CHAT_SUFFIX = '@c.us';
const INTERNAL_DIRECT_CHAT_SUFFIX = '@s.whatsapp.net';
const ALLOWED_CONTENT_TYPES = new Set<ContentType>([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
]);

export function parseWahaInboundMessageEvent(
  body: unknown,
): WahaInboundMessageParseResult {
  const root = asRecord(body);
  const sessionName = extractWahaWebhookSessionName(body);
  const payload = asRecord(root?.payload);
  const missingFields: string[] = [];

  if (root?.event !== 'message') missingFields.push('event');
  if (!sessionName) missingFields.push('session');
  if (!payload) missingFields.push('payload');
  if (missingFields.length > 0) {
    throw new WahaInboundMessageParseError(missingFields);
  }

  const messagePayload = payload as Record<string, unknown>;

  if (messagePayload.fromMe === true) {
    return { kind: 'ignored', reason: 'from_me' };
  }

  const messageId = stringValue(messagePayload.id);
  const rawChatId =
    stringValue(messagePayload.from) ||
    stringValue(messagePayload.chatId) ||
    stringValue(asRecord(messagePayload._data)?.from) ||
    stringValue(asRecord(asRecord(messagePayload._data)?.id)?.remote);
  const timestamp = parseWahaTimestamp(messagePayload.timestamp);

  if (!messageId) missingFields.push('id');
  if (!rawChatId) missingFields.push('from');
  if (!timestamp) missingFields.push('timestamp');
  if (missingFields.length > 0) {
    throw new WahaInboundMessageParseError(missingFields);
  }

  const chatId = normalizeDirectChatId(rawChatId);
  if (!chatId) {
    return { kind: 'ignored', reason: 'unsupported_chat' };
  }

  const senderDigits = chatId.slice(0, -DIRECT_CHAT_SUFFIX.length);
  return {
    kind: 'message',
    message: {
      sessionName: sessionName as string,
      messageId,
      chatId,
      senderPhone: `+${senderDigits}`,
      senderName: extractSenderName(messagePayload),
      contentType: inferContentType(messagePayload),
      contentText: extractContentText(messagePayload),
      media: extractInboundMedia(messagePayload),
      receivedAt: timestamp as string,
    },
  };
}

function extractInboundMedia(
  payload: Record<string, unknown>,
): WahaInboundMedia | null {
  if (payload.hasMedia !== true) return null;
  const media = asRecord(payload.media);
  const url = stringValue(media?.url);
  const mimetype = stringValue(media?.mimetype).toLowerCase();
  if (!url || !mimetype) return null;
  return {
    url,
    mimetype,
    filename: stringValue(media?.filename) || null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDirectChatId(value: string): string | null {
  const chatId = value.trim();
  if (!chatId) return null;

  if (/^\d+$/.test(chatId)) return `${chatId}${DIRECT_CHAT_SUFFIX}`;
  if (chatId.endsWith(DIRECT_CHAT_SUFFIX)) {
    const digits = chatId.slice(0, -DIRECT_CHAT_SUFFIX.length);
    return /^\d+$/.test(digits) ? `${digits}${DIRECT_CHAT_SUFFIX}` : null;
  }
  if (chatId.endsWith(INTERNAL_DIRECT_CHAT_SUFFIX)) {
    const digits = chatId.slice(0, -INTERNAL_DIRECT_CHAT_SUFFIX.length);
    return /^\d+$/.test(digits) ? `${digits}${DIRECT_CHAT_SUFFIX}` : null;
  }

  return null;
}

function parseWahaTimestamp(value: unknown): string | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const milliseconds = numeric > 9999999999 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractSenderName(payload: Record<string, unknown>): string | null {
  const data = asRecord(payload._data);
  const sender = asRecord(payload.sender);
  return (
    stringValue(payload.pushName) ||
    stringValue(payload.notifyName) ||
    stringValue(data?.notifyName) ||
    stringValue(data?.pushName) ||
    stringValue(sender?.pushName) ||
    stringValue(sender?.name) ||
    null
  );
}

function extractContentText(payload: Record<string, unknown>): string {
  const text = asRecord(payload.text);
  return (
    stringValue(payload.body) ||
    stringValue(payload.caption) ||
    stringValue(payload.text) ||
    stringValue(text?.body) ||
    ''
  );
}

function inferContentType(payload: Record<string, unknown>): ContentType {
  const type = stringValue(payload.type).toLowerCase();
  if (ALLOWED_CONTENT_TYPES.has(type as ContentType)) {
    return type as ContentType;
  }

  if (payload.hasMedia === true) {
    const media = asRecord(payload.media);
    const mimetype = stringValue(media?.mimetype).toLowerCase();
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype.startsWith('video/')) return 'video';
    return 'document';
  }

  return 'text';
}
