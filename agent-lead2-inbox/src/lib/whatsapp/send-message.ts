import type { SupabaseClient } from '@supabase/supabase-js';

import { integrationsAdminClient } from '@/lib/integrations/admin-client';
import {
  loadWahaRuntimeConfig,
  type WahaRuntimeConfig,
} from '@/lib/waha/config';
import { sendWahaText, toWahaChatId } from '@/lib/waha/client';
import { isValidE164, normalizePhone } from '@/lib/whatsapp/phone-utils';
import type { CrmSyncStatus } from '@/types';

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
  wahaMessageStatus: 'accepted' | 'accepted_without_id';
}

export interface SendMessageDeps {
  integrationsAdminClient?: () => SupabaseClient;
  loadWahaRuntimeConfig?: (
    db: SupabaseClient,
    accountId: string,
  ) => Promise<WahaRuntimeConfig>;
  sendWahaText?: typeof sendWahaText;
  now?: () => Date;
}

const defaultDeps = {
  integrationsAdminClient,
  loadWahaRuntimeConfig,
  sendWahaText,
  now: () => new Date(),
} satisfies Required<SendMessageDeps>;

const CRM_SYNC_STATUSES = new Set<CrmSyncStatus>([
  'pending',
  'synced',
  'not_configured',
  'blocked',
]);

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
  deps: SendMessageDeps = {},
): Promise<SendMessageResult> {
  const resolvedDeps = { ...defaultDeps, ...deps };
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
  const crmSyncFields = messageCrmSyncFields(conversation);

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

  const wahaRecipient = resolveWahaRecipient(contact.phone);
  if (!wahaRecipient) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400,
    );
  }

  let replyToInternalId: string | null = null;
  let replyToProviderId: string | null = null;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('id, conversation_id, message_id, waha_message_id')
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
    replyToProviderId = providerMessageId(parent);
  }

  let waMessageId = '';
  let waMessageStatus: 'accepted' | 'accepted_without_id' = 'accepted_without_id';
  let waSessionName = '';
  try {
    const runtime = await resolvedDeps.loadWahaRuntimeConfig(
      resolvedDeps.integrationsAdminClient(),
      accountId,
    );
    const result = await resolvedDeps.sendWahaText(runtime.config, {
      to: wahaRecipient,
      text: contentText!,
      replyTo: replyToProviderId,
    });
    waMessageId = result.whatsappMessageId;
    waMessageStatus = result.messageStatus;
    waSessionName = runtime.config.sessionName;
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
      waha_session_name: waSessionName || null,
      waha_message_id: waMessageId || null,
      waha_message_status: waMessageStatus,
      ...crmSyncFields,
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

  const now = resolvedDeps.now().toISOString();
  const updateResult = await db
    .from('conversations')
    .update({
      last_message_text: contentText,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', conversationId)
    .eq('account_id', accountId);

  if (hasSupabaseError(updateResult)) {
    throw new SendMessageError(
      'db_error',
      'Message sent and saved, but failed to update conversation preview',
      500,
    );
  }

  return {
    messageId: String(messageRecord.id),
    whatsappMessageId: waMessageId,
    wahaMessageStatus: waMessageStatus,
  };
}

function resolveWahaRecipient(value: string): string | null {
  const raw = value.trim();
  if (raw.includes('@')) {
    try {
      return toWahaChatId(raw);
    } catch {
      return null;
    }
  }

  const normalizedPhone = normalizePhone(raw);
  return isValidE164(normalizedPhone) ? normalizedPhone : null;
}

function messageCrmSyncFields(conversation: unknown): {
  crm_sync_status: CrmSyncStatus;
  crm_sync_error: string | null;
  crm_sync_attempted_at: string | null;
} {
  const row =
    conversation && typeof conversation === 'object'
      ? (conversation as Record<string, unknown>)
      : {};
  const status = toCrmSyncStatus(row.crm_sync_status, row.amo_lead_id);
  return {
    crm_sync_status: status,
    crm_sync_error: status === 'synced' ? null : textOrNull(row.crm_sync_error),
    crm_sync_attempted_at: textOrNull(row.crm_sync_attempted_at),
  };
}

function toCrmSyncStatus(value: unknown, amoLeadId: unknown): CrmSyncStatus {
  if (typeof value === 'string' && CRM_SYNC_STATUSES.has(value as CrmSyncStatus)) {
    return value as CrmSyncStatus;
  }
  return textOrNull(amoLeadId) ? 'synced' : 'pending';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function providerMessageId(parent: unknown): string | null {
  if (!parent || typeof parent !== 'object') return null;
  const row = parent as Record<string, unknown>;
  if (typeof row.waha_message_id === 'string' && row.waha_message_id.trim()) {
    return row.waha_message_id.trim();
  }
  if (typeof row.message_id === 'string' && row.message_id.trim()) {
    return row.message_id.trim();
  }
  return null;
}

function hasSupabaseError(value: unknown): value is { error: unknown } {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in value &&
    (value as { error: unknown }).error != null
  );
}
