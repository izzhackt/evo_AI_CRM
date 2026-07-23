import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireRole } from '@/lib/auth/account';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';

import { POST } from './route';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OPERATOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DRAFT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(),
  toErrorResponse: vi.fn((err: unknown) =>
    NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized' },
      {
        status:
          err && typeof err === 'object' && 'status' in err
            ? Number((err as { status: unknown }).status)
            : 500,
      }
    )
  ),
}));

vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: vi.fn(),
}));

function request(
  body: unknown,
  idempotencyKey: string | null = REQUEST_ID
): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  return new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/whatsapp/send', () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockResolvedValue({
      supabase: { from: vi.fn() },
      userId: OPERATOR_ID,
      accountId: 'acct-1',
      role: 'agent',
      account: { id: 'acct-1', name: 'EVO' },
    } as never);
    vi.mocked(sendMessageToConversation).mockReset();
  });

  it('passes the authenticated operator, request UUID, and optional draft to the durable send service', async () => {
    vi.mocked(sendMessageToConversation).mockResolvedValue({
      messageId: REQUEST_ID,
      whatsappMessageId: 'false_14155551212@c.us_AAA',
      wahaMessageStatus: 'accepted',
      outboundState: 'accepted',
    });

    const response = await POST(
      request({
        conversation_id: 'conv-1',
        message_type: 'text',
        content_text: 'Hello',
        reply_to_message_id: 'parent-1',
        ai_draft_id: DRAFT_ID,
      })
    );
    const json = await response.json();

    expect(requireRole).toHaveBeenCalledWith('agent');
    expect(sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      {
        requestId: REQUEST_ID,
        operatorId: OPERATOR_ID,
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'Hello',
        mediaUrl: null,
        filename: null,
        templateName: null,
        templateLanguage: null,
        templateParams: [],
        templateMessageParams: undefined,
        replyToMessageId: 'parent-1',
        aiDraftId: DRAFT_ID,
      }
    );
    expect(response.status).toBe(200);
    expect(json).toEqual({
      message_id: REQUEST_ID,
      whatsapp_message_id: 'false_14155551212@c.us_AAA',
      waha_message_status: 'accepted',
      outbound_state: 'accepted',
    });
  });

  it('passes a missing Idempotency-Key as an empty value for service validation', async () => {
    vi.mocked(sendMessageToConversation).mockRejectedValue({
      code: 'bad_request',
      message: 'Idempotency-Key must be a valid UUID',
      status: 400,
    });

    const response = await POST(
      request(
        {
          conversation_id: 'conv-1',
          message_type: 'text',
          content_text: 'Hello',
        },
        null
      )
    );

    expect(sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        requestId: '',
        operatorId: OPERATOR_ID,
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Idempotency-Key must be a valid UUID',
      code: 'bad_request',
    });
  });

  it('returns actionable durable-state details for an uncertain send', async () => {
    vi.mocked(sendMessageToConversation).mockRejectedValue({
      code: 'outbound_state_unknown',
      message: 'WhatsApp send outcome is uncertain; do not retry this request',
      status: 502,
      messageId: REQUEST_ID,
      outboundState: 'dispatching',
    });

    const response = await POST(
      request({
        conversation_id: 'conv-1',
        message_type: 'text',
        content_text: 'Hello',
      })
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'WhatsApp send outcome is uncertain; do not retry this request',
      code: 'outbound_state_unknown',
      message_id: REQUEST_ID,
      outbound_state: 'dispatching',
    });
  });

  it('preserves explicit configuration fields without exposing secret values', async () => {
    vi.mocked(sendMessageToConversation).mockRejectedValue({
      code: 'waha_not_configured',
      message: 'WAHA configuration is missing: apiKey',
      status: 400,
      messageId: REQUEST_ID,
      outboundState: 'queued',
      missingFields: ['apiKey'],
    });

    const response = await POST(
      request({
        conversation_id: 'conv-1',
        message_type: 'text',
        content_text: 'Hello',
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'WAHA configuration is missing: apiKey',
      code: 'waha_not_configured',
      message_id: REQUEST_ID,
      outbound_state: 'queued',
      missing_fields: ['apiKey'],
    });
  });

  it('returns bad_request for invalid JSON before calling the service', async () => {
    const response = await POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Idempotency-Key': REQUEST_ID },
        body: '{',
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid JSON',
      code: 'bad_request',
    });
    expect(sendMessageToConversation).not.toHaveBeenCalled();
  });
});
