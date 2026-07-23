import { describe, expect, it, vi } from 'vitest';

import {
  buildWahaSessionWebhook,
  extractWahaMessageAckEvent,
  extractWahaSessionStatusEvent,
  extractWahaWebhookSessionName,
  mapWahaStatusToIntegrationState,
  recordWahaMessageAck,
  signWahaWebhookBody,
  updateWahaSessionStatus,
  verifyWahaWebhookSignature,
} from './webhook';

const webhookSecretFixture = ['webhook', 'fixture'].join('-');

describe('WAHA webhook boundary', () => {
  it('verifies WAHA sha512 HMAC over the raw request body', () => {
    const rawBody = JSON.stringify({
      event: 'session.status',
      session: 'evo-inbox',
      payload: { status: 'WORKING' },
    });
    const signature = signWahaWebhookBody(rawBody, webhookSecretFixture);

    expect(
      verifyWahaWebhookSignature({
        rawBody,
        secret: webhookSecretFixture,
        signature,
        algorithm: 'sha512',
      })
    ).toBe(true);
    expect(
      verifyWahaWebhookSignature({
        rawBody,
        secret: webhookSecretFixture,
        signature: undefined,
        algorithm: 'sha512',
      })
    ).toBe(false);
    expect(
      verifyWahaWebhookSignature({
        rawBody,
        secret: webhookSecretFixture,
        signature: 'not-valid',
        algorithm: 'sha512',
      })
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
      })
    ).toBe('evo-inbox');
    expect(extractWahaWebhookSessionName({ event: 'message' })).toBeNull();
  });

  it('builds a signed WAHA session webhook config with acknowledgement events', () => {
    expect(
      buildWahaSessionWebhook('https://inbox.example.com/api/waha/webhook', {
        hmacSecret: 'secret',
      })
    ).toEqual({
      url: 'https://inbox.example.com/api/waha/webhook',
      events: ['message', 'message.ack', 'session.status'],
      hmac: { key: 'secret' },
    });
  });

  it('parses the documented message.ack envelope into canonical evidence', () => {
    expect(
      extractWahaMessageAckEvent({
        id: 'evt-ack-1',
        event: 'message.ack',
        session: 'evo-inbox',
        timestamp: 1_727_745_026_123,
        payload: {
          id: 'true_14155551212@c.us_AAA',
          from: '14155551212@c.us',
          fromMe: true,
          ack: 3,
          ackName: 'read',
        },
      })
    ).toEqual({
      providerEventId: 'evt-ack-1',
      sessionName: 'evo-inbox',
      messageId: 'true_14155551212@c.us_AAA',
      chatId: '14155551212@c.us',
      ack: 3,
      ackName: 'READ',
      occurredAt: '2024-10-01T01:10:26.123Z',
    });

    expect(
      extractWahaMessageAckEvent({
        event: 'message.ack',
        session: 'evo-inbox',
        payload: { id: 'message-1', ack: 2, ackName: 'READ' },
      })
    ).toBeNull();
  });

  it('records ack evidence only through the scoped database RPC', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const event = {
      providerEventId: 'evt-ack-1',
      sessionName: 'evo-inbox',
      messageId: 'true_14155551212@c.us_AAA',
      chatId: '14155551212@c.us',
      ack: 2 as const,
      ackName: 'DEVICE' as const,
      occurredAt: '2024-10-01T00:30:26.123Z',
    };

    await expect(
      recordWahaMessageAck({ rpc }, 'account-1', event, 'webhook')
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('record_waha_message_ack', {
      p_account_id: 'account-1',
      p_session_name: 'evo-inbox',
      p_waha_message_id: 'true_14155551212@c.us_AAA',
      p_ack: 2,
      p_ack_name: 'DEVICE',
      p_ack_at: '2024-10-01T00:30:26.123Z',
      p_source: 'webhook',
      p_provider_event_id: 'evt-ack-1',
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
