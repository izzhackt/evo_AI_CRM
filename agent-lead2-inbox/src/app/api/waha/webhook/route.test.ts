import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signWahaWebhookBody } from '@/lib/waha/webhook';

vi.mock('@/lib/integrations/admin-client', () => ({
  IntegrationsAdminConfigurationError: class IntegrationsAdminConfigurationError extends Error {
    readonly code = 'supabase_not_configured';
    readonly status = 503;
    readonly missingFields: string[];

    constructor(missingFields: string[]) {
      super(`Supabase service configuration is missing: ${missingFields.join(', ')}`);
      this.name = 'IntegrationsAdminConfigurationError';
      this.missingFields = missingFields;
    }
  },
  integrationsAdminClient: () => ({}),
}));

vi.mock('@/lib/waha/config', () => ({
  findWahaWebhookCandidates: vi.fn(async () => [
    {
      settingId: 'setting-1',
      accountId: 'acct-1',
      webhookHmacSecret: 'secret',
    },
  ]),
}));

vi.mock('@/lib/waha/inbound-delivery', () => {
  class WahaInboundDeliveryError extends Error {
    readonly code: string;
    readonly status: number;
    readonly integrationStatus?: string;
    readonly missingFields?: string[];

    constructor(input: {
      code: string;
      message: string;
      status: number;
      integrationStatus?: string;
      missingFields?: string[];
    }) {
      super(input.message);
      this.name = 'WahaInboundDeliveryError';
      this.code = input.code;
      this.status = input.status;
      this.integrationStatus = input.integrationStatus;
      this.missingFields = input.missingFields;
    }
  }

  return {
    WahaInboundDeliveryError,
    deliverWahaInboundMessage: vi.fn(async () => ({
      status: 'received',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      crmSyncStatus: 'synced',
      crmSyncError: null,
      crmSyncRetryable: false,
    })),
  };
});

import { deliverWahaInboundMessage } from '@/lib/waha/inbound-delivery';
import { POST } from './route';

beforeEach(() => {
  vi.mocked(deliverWahaInboundMessage).mockReset();
  vi.mocked(deliverWahaInboundMessage).mockResolvedValue({
    status: 'received',
    conversationId: 'conversation-1',
    messageId: 'message-1',
    crmSyncStatus: 'synced',
    crmSyncError: null,
    crmSyncRetryable: false,
  });
});

function request(rawBody: string, headers?: Record<string, string>): Request {
  return new Request('https://inbox.example.com/api/waha/webhook', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

describe('POST /api/waha/webhook', () => {
  const rawBody = JSON.stringify({
    event: 'session.status',
    session: 'evo-inbox',
    payload: { status: 'WORKING' },
  });

  it('rejects unsigned session.status webhooks before mutation', async () => {
    const response = await POST(request(rawBody));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: 'Invalid signature' });
  });

  it('rejects invalid-HMAC session.status webhooks before mutation', async () => {
    const response = await POST(
      request(rawBody, {
        'X-Webhook-Hmac': signWahaWebhookBody(rawBody, 'wrong-secret'),
        'X-Webhook-Hmac-Algorithm': 'sha512',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: 'Invalid signature' });
  });

  it('rejects unsigned non-status WAHA webhooks before ignoring them', async () => {
    const messageBody = JSON.stringify({
      event: 'message',
      session: 'evo-inbox',
      payload: { id: 'message-1' },
    });

    const response = await POST(request(messageBody));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: 'Invalid signature' });
  });

  it('delivers signed inbound message events after HMAC verification', async () => {
    const messageBody = JSON.stringify({
      event: 'message',
      session: 'evo-inbox',
      payload: {
        id: 'message-1',
        timestamp: 1700000000,
        from: '14155551212@c.us',
        body: 'Hello',
      },
    });

    const response = await POST(
      request(messageBody, {
        'X-Webhook-Hmac': signWahaWebhookBody(messageBody, 'secret'),
        'X-Webhook-Hmac-Algorithm': 'sha512',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      status: 'received',
      conversation_id: 'conversation-1',
      message_id: 'message-1',
      crm_sync_status: 'synced',
      crm_sync_error: null,
      crm_sync_retryable: false,
    });
    expect(deliverWahaInboundMessage).toHaveBeenCalledWith({
      db: {},
      accountId: 'acct-1',
      message: expect.objectContaining({
        messageId: 'message-1',
        senderPhone: '+14155551212',
        contentText: 'Hello',
      }),
    });
  });

  it('rejects malformed signed message events without delivery', async () => {
    const messageBody = JSON.stringify({
      event: 'message',
      session: 'evo-inbox',
      payload: {
        timestamp: 1700000000,
        from: '14155551212@c.us',
        body: 'Missing id',
      },
    });

    const response = await POST(
      request(messageBody, {
        'X-Webhook-Hmac': signWahaWebhookBody(messageBody, 'secret'),
        'X-Webhook-Hmac-Algorithm': 'sha512',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: 'waha_message_malformed',
      missing_fields: ['id'],
    });
  });

  it('accepts inbound messages after local save when amoCRM is not configured', async () => {
    vi.mocked(deliverWahaInboundMessage).mockResolvedValueOnce({
      status: 'received',
      conversationId: 'conversation-1',
      messageId: 'message-2',
      crmSyncStatus: 'not_configured',
      crmSyncError: 'amoCRM configuration is missing: baseUrl',
      crmSyncRetryable: true,
      missingFields: ['baseUrl'],
    });
    const messageBody = JSON.stringify({
      event: 'message',
      session: 'evo-inbox',
      payload: {
        id: 'message-2',
        timestamp: 1700000000,
        from: '14155551212@c.us',
        body: 'Hello',
      },
    });

    const response = await POST(
      request(messageBody, {
        'X-Webhook-Hmac': signWahaWebhookBody(messageBody, 'secret'),
        'X-Webhook-Hmac-Algorithm': 'sha512',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      status: 'received',
      conversation_id: 'conversation-1',
      message_id: 'message-2',
      crm_sync_status: 'not_configured',
      crm_sync_error: 'amoCRM configuration is missing: baseUrl',
      crm_sync_retryable: true,
      missing_fields: ['baseUrl'],
    });
  });

  it('accepts signed unsupported WAHA events as ignored', async () => {
    const eventBody = JSON.stringify({
      event: 'message.ack',
      session: 'evo-inbox',
      payload: { id: 'message-1' },
    });

    const response = await POST(
      request(eventBody, {
        'X-Webhook-Hmac': signWahaWebhookBody(eventBody, 'secret'),
        'X-Webhook-Hmac-Algorithm': 'sha512',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json).toEqual({ status: 'ignored' });
  });
});
