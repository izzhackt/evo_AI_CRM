import { createHmac, timingSafeEqual } from 'node:crypto';

import type { IntegrationStatus } from '@/types';

export interface WahaSessionStatusEvent {
  sessionName: string;
  status: string;
}

export interface WahaWebhookConfig {
  url: string;
  events: ['message', 'session.status'];
  hmac: { key: string };
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
  body: unknown,
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
  const sessionName = typeof obj.session === 'string' ? obj.session : null;

  if (!sessionName || !status) return null;
  return { sessionName, status: status.toUpperCase() };
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
  options: { hmacSecret: string },
): WahaWebhookConfig {
  return {
    url,
    events: ['message', 'session.status'],
    hmac: { key: options.hmacSecret },
  };
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
  event: WahaSessionStatusEvent,
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
