import type { SupabaseClient } from '@supabase/supabase-js';

import { integrationsAdminClient } from '@/lib/integrations/admin-client';
import { loadWahaRuntimeConfig } from '@/lib/waha/config';
import { sendWahaText } from '@/lib/waha/client';
import { isValidE164, normalizePhone } from '@/lib/whatsapp/phone-utils';

export const VALID_MESSAGE_TYPES = ['text'] as const;

export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateParams?: string[];
  templateMessageParams?: unknown;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  messageId: string;
  whatsappMessageId: string;
}

export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
}): void {
  const { messageType, contentText } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'first_launch_disabled',
      `Unsupported first-launch WAHA message_type "${messageType}"`,
      410,
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400,
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams,
): Promise<SendMessageResult> {
  const { conversationId, messageType, contentText, replyToMessageId } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400,
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl: params.mediaUrl,
    templateName: params.templateName,
  });

  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact as
    | { id: string; phone?: string | null }
    | null
    | undefined;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400,
    );
  }

  const normalizedPhone = normalizePhone(contact.phone);
  if (!isValidE164(normalizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400,
    );
  }

  let replyToInternalId: string | null = null;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400,
      );
    }
    replyToInternalId = String(parent.id);
  }

  let waMessageId = '';
  try {
    const runtime = await loadWahaRuntimeConfig(
      integrationsAdminClient(),
      accountId,
    );
    const result = await sendWahaText(runtime.config, {
      to: normalizedPhone,
      text: contentText!,
    });
    waMessageId = result.whatsappMessageId;
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'waha_error';
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: unknown }).status)
        : 502;
    const message =
      err instanceof Error ? err.message : 'WAHA message send failed';
    throw new SendMessageError(code, message, status);
  }

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: contentText,
      media_url: null,
      template_name: null,
      message_id: waMessageId || null,
      status: 'sent',
      reply_to_message_id: replyToInternalId,
    })
    .select()
    .single();

  if (msgError || !messageRecord) {
    throw new SendMessageError(
      'db_error',
      'Message sent through WAHA but failed to save to DB',
      500,
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return {
    messageId: String(messageRecord.id),
    whatsappMessageId: waMessageId,
  };
}
