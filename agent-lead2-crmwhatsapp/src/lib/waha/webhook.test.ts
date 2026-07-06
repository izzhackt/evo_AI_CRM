import { describe, expect, it } from 'vitest';

import {
  buildWahaSessionWebhook,
  extractWahaSessionStatusEvent,
  extractWahaWebhookSessionName,
  mapWahaStatusToIntegrationState,
  signWahaWebhookBody,
  updateWahaSessionStatus,
  verifyWahaWebhookSignature,
} from './webhook';

describe('WAHA webhook boundary', () => {
  it('verifies WAHA sha512 HMAC over the raw request body', () => {
    const rawBody = JSON.stringify({
      event: 'session.status',
      session: 'evo-inbox',
      payload: { status: 'WORKING' },
    });
    const signature = signWahaWebhookBody(rawBody, 'webhook-secret');

    expect(
      verifyWahaWebhookSignature({
        rawBody,
        secret: 'webhook-secret',
        signature,
        algorithm: 'sha512',
      }),
    ).toBe(true);
    expect(
      verifyWahaWebhookSignature({
        rawBody,
        secret: 'webhook-secret',
        signature: undefined,
        algorithm: 'sha512',
      }),
    ).toBe(false);
    expect(
      verifyWahaWebhookSignature({
        rawBody,
        secret: 'webhook-secret',
        signature: 'not-valid',
        algorithm: 'sha512',
      }),
    ).toBe(false);
  });

  it('extracts session.status events and maps them to integration state', () => {
    const event = extractWahaSessionStatusEvent({
      event: 'session.status',
      session: 'evo-inbox',
      payload: { status: 'WORKING' },
    });

    expect(event).toEqual({ sessionName: 'evo-inbox', status: 'WORKING' });
    expect(mapWahaStatusToIntegrationState('WORKING')).toEqual({
      status: 'configured',
      lastError: null,
    });
    expect(mapWahaStatusToIntegrationState('FAILED')).toEqual({
      status: 'blocked',
      lastError: 'WAHA session status is FAILED',
    });
  });

  it('extracts the WAHA session name before event-specific handling', () => {
    expect(
      extractWahaWebhookSessionName({
        event: 'message',
        session: ' evo-inbox ',
        payload: { id: 'message-1' },
      }),
    ).toBe('evo-inbox');
    expect(extractWahaWebhookSessionName({ event: 'message' })).toBeNull();
  });

  it('builds a WAHA session webhook config with HMAC and session.status', () => {
    expect(
      buildWahaSessionWebhook('https://inbox.example.com/api/waha/webhook', {
        hmacSecret: 'secret',
      }),
    ).toEqual({
      url: 'https://inbox.example.com/api/waha/webhook',
      events: ['message', 'session.status'],
      hmac: { key: 'secret' },
    });
  });

  it('updates integration_settings idempotently for status events', async () => {
    const calls: unknown[] = [];
    const builder = {
      update(value: unknown) {
        calls.push(['update', value]);
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push(['eq', column, value]);
        return Promise.resolve({ error: null });
      },
    };
    const db = {
      from(table: string) {
        calls.push(['from', table]);
        return builder;
      },
    };

    await updateWahaSessionStatus(db, 'setting-1', {
      sessionName: 'evo-inbox',
      status: 'WORKING',
    });

    expect(calls).toContainEqual(['from', 'integration_settings']);
    expect(calls).toContainEqual(['eq', 'id', 'setting-1']);
    expect(calls[1]).toEqual([
      'update',
      expect.objectContaining({
        status: 'configured',
        last_error: null,
      }),
    ]);
  });
});
