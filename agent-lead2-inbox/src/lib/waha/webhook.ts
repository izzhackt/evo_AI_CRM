import { createHmac, timingSafeEqual } from 'node:crypto';

import type { IntegrationStatus, WahaAckName } from '@/types';
import { parseWahaMessageAck } from './client';

export interface WahaSessionStatusEvent {
  sessionName: string;
  status: string;
}

export interface WahaWebhookConfig {
  url: string;
  events: ['message', 'message.ack', 'session.status'];
  hmac: { key: string };
}

export interface WahaMessageAckEvent {
  providerEventId: string | null;
  sessionName: string;
  messageId: string;
  chatId: string | null;
  ack: number;
  ackName: WahaAckName;
  occurredAt: string;
}

export type WahaAckSource = 'webhook' | 'reconciliation';

export function extractWahaWebhookSessionName(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  const sessionName = typeof obj.session === 'string' ? obj.session.trim() : '';
  return sessionName || null;
}

export function signWahaWebhookBody(rawBody: string, secret: string): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

export function verifyWahaWebhookSignature(input: {
  rawBody: string;
  secret: string;
  signature?: string | null;
  algorithm?: string | null;
}): boolean {
  if (!input.signature || !input.secret) return false;
  if ((input.algorithm ?? '').toLowerCase() !== 'sha512') return false;

  const expected = signWahaWebhookBody(input.rawBody, input.secret);
  const provided = input.signature.replace(/^sha512=/i, '').trim();

  try {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(provided, 'hex');
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}

export function extractWahaSessionStatusEvent(
  body: unknown
): WahaSessionStatusEvent | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  if (obj.event !== 'session.status') return null;

  const payload =
    obj.payload && typeof obj.payload === 'object'
      ? (obj.payload as Record<string, unknown>)
      : {};
  const status =
    typeof payload.status === 'string'
      ? payload.status
      : typeof obj.status === 'string'
        ? obj.status
        : null;
  const sessionName = extractWahaWebhookSessionName(body);

  if (!sessionName || !status) return null;
  return { sessionName, status: status.toUpperCase() };
}

export function extractWahaMessageAckEvent(
  body: unknown
): WahaMessageAckEvent | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  if (obj.event !== 'message.ack') return null;

  const payload =
    obj.payload && typeof obj.payload === 'object'
      ? (obj.payload as Record<string, unknown>)
      : {};
  const sessionName = extractWahaWebhookSessionName(body);
  const messageId = typeof payload.id === 'string' ? payload.id.trim() : '';
  const providerEventId =
    typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : null;
  const chatId =
    typeof payload.from === 'string' && payload.from.trim()
      ? payload.from.trim()
      : typeof payload.to === 'string' && payload.to.trim()
        ? payload.to.trim()
        : null;
  const ack = parseWahaMessageAck(payload);
  const occurredAt = parseWahaEventTimestamp(obj.timestamp);

  if (
    !sessionName ||
    !messageId ||
    ack.ack === null ||
    ack.ackName === null ||
    !occurredAt
  ) {
    return null;
  }

  return {
    providerEventId,
    sessionName,
    messageId,
    chatId,
    ack: ack.ack,
    ackName: ack.ackName,
    occurredAt,
  };
}

export function mapWahaStatusToIntegrationState(status: string): {
  status: IntegrationStatus;
  lastError: string | null;
} {
  const normalized = status.toUpperCase();
  if (normalized === 'WORKING') {
    return { status: 'configured', lastError: null };
  }
  return {
    status: 'blocked',
    lastError: `WAHA session status is ${normalized}`,
  };
}

export function buildWahaSessionWebhook(
  url: string,
  options: { hmacSecret: string }
): WahaWebhookConfig {
  return {
    url,
    events: ['message', 'message.ack', 'session.status'],
    hmac: { key: options.hmacSecret },
  };
}

interface WahaAckDb {
  rpc(
    functionName: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function recordWahaMessageAck(
  db: WahaAckDb,
  accountId: string,
  event: WahaMessageAckEvent,
  source: WahaAckSource
): Promise<boolean> {
  const { data, error } = await db.rpc('record_waha_message_ack', {
    p_account_id: accountId,
    p_session_name: event.sessionName,
    p_waha_message_id: event.messageId,
    p_ack: event.ack,
    p_ack_name: event.ackName,
    p_ack_at: event.occurredAt,
    p_source: source,
    p_provider_event_id: event.providerEventId,
  });

  if (error) {
    throw new Error('Failed to record WAHA acknowledgement');
  }
  return data === true;
}

interface WahaStatusDb {
  from(table: string): {
    update(value: Record<string, unknown>): {
      eq(column: string, value: unknown): unknown;
    };
  };
}

export async function updateWahaSessionStatus(
  db: WahaStatusDb,
  settingId: string,
  event: WahaSessionStatusEvent
): Promise<void> {
  const state = mapWahaStatusToIntegrationState(event.status);
  const result = await db
    .from('integration_settings')
    .update({
      status: state.status,
      last_checked_at: new Date().toISOString(),
      last_error: state.lastError,
    })
    .eq('id', settingId);

  if (hasSupabaseError(result)) {
    throw new Error('Failed to update WAHA integration status');
  }
}

function hasSupabaseError(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in value &&
    (value as { error: unknown }).error != null
  );
}

function parseWahaEventTimestamp(value: unknown): string | null {
  let milliseconds: number;
  if (typeof value === 'number' && Number.isFinite(value)) {
    milliseconds = value < 100_000_000_000 ? value * 1000 : value;
  } else if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    milliseconds = Number.isFinite(numeric)
      ? numeric < 100_000_000_000
        ? numeric * 1000
        : numeric
      : Date.parse(value);
  } else {
    return null;
  }

  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
