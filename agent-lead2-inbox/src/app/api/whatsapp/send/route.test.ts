import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireRole } from '@/lib/auth/account';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';

import { POST } from './route';

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
      },
    ),
  ),
}));

vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: vi.fn(),
}));

function request(body: unknown): Request {
  return new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/whatsapp/send', () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockResolvedValue({
      supabase: { from: vi.fn() },
      userId: 'user-1',
      accountId: 'acct-1',
      role: 'agent',
      account: { id: 'acct-1', name: 'EVO' },
    } as never);
    vi.mocked(sendMessageToConversation).mockReset();
  });

  it('sends an operator-approved manual text reply through the WAHA service', async () => {
    vi.mocked(sendMessageToConversation).mockResolvedValue({
      messageId: 'message-1',
      whatsappMessageId: 'false_14155551212@c.us_AAA',
      wahaMessageStatus: 'accepted',
    });

    const response = await POST(
      request({
        conversation_id: 'conv-1',
        message_type: 'text',
        content_text: 'Hello',
        reply_to_message_id: 'parent-1',
      }),
    );
    const json = await response.json();

    expect(requireRole).toHaveBeenCalledWith('agent');
    expect(sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      {
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
      },
    );
    expect(response.status).toBe(200);
    expect(json).toEqual({
      message_id: 'message-1',
      whatsapp_message_id: 'false_14155551212@c.us_AAA',
      waha_message_status: 'accepted',
    });
  });

  it('returns explicit manual-send errors from the service', async () => {
    vi.mocked(sendMessageToConversation).mockRejectedValue({
      code: 'waha_not_configured',
      message: 'WAHA configuration is missing: apiKey',
      status: 400,
      missingFields: ['apiKey'],
    });

    const response = await POST(
      request({
        conversation_id: 'conv-1',
        message_type: 'text',
        content_text: 'Hello',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: 'WAHA configuration is missing: apiKey',
      code: 'waha_not_configured',
      missing_fields: ['apiKey'],
    });
  });

  it('returns bad_request for invalid JSON before calling the service', async () => {
    const response = await POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        body: '{',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: 'Invalid JSON',
      code: 'bad_request',
    });
    expect(sendMessageToConversation).not.toHaveBeenCalled();
  });
});
