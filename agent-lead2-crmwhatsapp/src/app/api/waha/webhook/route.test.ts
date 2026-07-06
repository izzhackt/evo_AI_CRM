import { describe, expect, it, vi } from 'vitest';

import { signWahaWebhookBody } from '@/lib/waha/webhook';

vi.mock('@/lib/integrations/admin-client', () => ({
  integrationsAdminClient: () => ({}),
}));

vi.mock('@/lib/waha/config', () => ({
  findWahaWebhookCandidates: vi.fn(async () => [
    { settingId: 'setting-1', webhookHmacSecret: 'secret' },
  ]),
}));

import { POST } from './route';

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

  it('accepts signed unsupported WAHA events as ignored', async () => {
    const messageBody = JSON.stringify({
      event: 'message',
      session: 'evo-inbox',
      payload: { id: 'message-1' },
    });

    const response = await POST(
      request(messageBody, {
        'X-Webhook-Hmac': signWahaWebhookBody(messageBody, 'secret'),
        'X-Webhook-Hmac-Algorithm': 'sha512',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(202);
    expect(json).toEqual({ status: 'ignored' });
  });
});
