import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';

function stringBodyValue(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

function stringArrayBodyValue(
  body: Record<string, unknown>,
  key: string,
): string[] {
  const value = body[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function manualSendErrorResponse(err: unknown): NextResponse {
  if (err && typeof err === 'object' && 'status' in err && 'code' in err) {
    const status = Number((err as { status: unknown }).status);
    const code = String((err as { code: unknown }).code);
    const message =
      err instanceof Error
        ? err.message
        : 'message' in err && typeof (err as { message: unknown }).message === 'string'
          ? (err as { message: string }).message
          : 'Manual WhatsApp send failed';
    const missingFields =
      'missingFields' in err &&
      Array.isArray((err as { missingFields?: unknown }).missingFields)
        ? (err as { missingFields: string[] }).missingFields
        : undefined;

    return NextResponse.json(
      {
        error: message,
        code,
        ...(missingFields ? { missing_fields: missingFields } : {}),
      },
      { status: Number.isFinite(status) ? status : 500 },
    );
  }

  return toErrorResponse(err);
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Invalid JSON', code: 'bad_request' },
        { status: 400 },
      );
    }

    const input = body as Record<string, unknown>;
    const result = await sendMessageToConversation(supabase, accountId, {
      conversationId: stringBodyValue(input, 'conversation_id') ?? '',
      messageType: stringBodyValue(input, 'message_type') ?? '',
      contentText: stringBodyValue(input, 'content_text'),
      mediaUrl: stringBodyValue(input, 'media_url'),
      filename: stringBodyValue(input, 'filename'),
      templateName: stringBodyValue(input, 'template_name'),
      templateLanguage: stringBodyValue(input, 'template_language'),
      templateParams: stringArrayBodyValue(input, 'template_params'),
      templateMessageParams: input.template_message_params,
      replyToMessageId: stringBodyValue(input, 'reply_to_message_id'),
    });

    return NextResponse.json({
      message_id: result.messageId,
      whatsapp_message_id: result.whatsappMessageId,
      waha_message_status: result.wahaMessageStatus,
    });
  } catch (err) {
    return manualSendErrorResponse(err);
  }
}
