import type { SupabaseClient } from '@supabase/supabase-js';

import { integrationsAdminClient } from '@/lib/integrations/admin-client';
import {
  loadWahaRuntimeConfig,
  type WahaRuntimeConfig,
} from '@/lib/waha/config';
import {
  sendWahaText,
  toWahaChatId,
  WahaProviderError,
} from '@/lib/waha/client';
import { isValidE164, normalizePhone } from '@/lib/whatsapp/phone-utils';
import type { CrmSyncStatus } from '@/types';

export const VALID_MESSAGE_TYPES = ['text'] as const;

export type ManualOutboundState =
  'queued' | 'dispatching' | 'accepted' | 'rejected' | 'unknown';

interface SendMessageErrorDetails {
  messageId?: string;
  outboundState?: ManualOutboundState;
  missingFields?: string[];
}

export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  readonly messageId?: string;
  readonly outboundState?: ManualOutboundState;
  readonly missingFields?: string[];

  constructor(
    code: string,
    message: string,
    status: number,
    details: SendMessageErrorDetails = {}
  ) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
    this.messageId = details.messageId;
    this.outboundState = details.outboundState;
    this.missingFields = details.missingFields;
  }
}

export interface SendMessageParams {
  requestId: string;
  operatorId: string;
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
  aiDraftId?: string | null;
}

export interface SendMessageResult {
  messageId: string;
  whatsappMessageId: string;
  wahaMessageStatus: 'accepted' | 'accepted_without_id';
  outboundState: 'accepted';
}

export interface SendMessageDeps {
  integrationsAdminClient?: () => SupabaseClient;
  loadWahaRuntimeConfig?: (
    db: SupabaseClient,
    accountId: string
  ) => Promise<WahaRuntimeConfig>;
  sendWahaText?: typeof sendWahaText;
  now?: () => Date;
  logPreviewFailure?: (details: {
    conversationId: string;
    messageId: string;
  }) => void;
}

const defaultDeps = {
  integrationsAdminClient,
  loadWahaRuntimeConfig,
  sendWahaText,
  now: () => new Date(),
  logPreviewFailure: (details: {
    conversationId: string;
    messageId: string;
  }) => {
    console.error('Accepted WhatsApp message preview update failed', details);
  },
} satisfies Required<SendMessageDeps>;

const CRM_SYNC_STATUSES = new Set<CrmSyncStatus>([
  'pending',
  'synced',
  'not_configured',
  'blocked',
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONFIRMED_PROVIDER_REJECTION_STATUSES = new Set([
  400, 401, 403, 404, 405, 415, 422,
]);

const OUTBOX_SELECT = [
  'id',
  'conversation_id',
  'sender_id',
  'content_type',
  'content_text',
  'reply_to_message_id',
  'ai_draft_id',
  'waha_chat_id',
  'waha_message_id',
  'waha_message_status',
  'outbound_state',
].join(', ');

interface OutboxRow {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content_type: string;
  content_text: string | null;
  reply_to_message_id: string | null;
  ai_draft_id: string | null;
  waha_chat_id: string | null;
  waha_message_id: string | null;
  waha_message_status: string | null;
  outbound_state: ManualOutboundState | null;
}

export function validateSendMessageParams(params: {
  requestId: string;
  operatorId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
}): void {
  const { requestId, operatorId, messageType, contentText } = params;

  if (!UUID_PATTERN.test(requestId)) {
    throw new SendMessageError(
      'bad_request',
      'Idempotency-Key must be a valid UUID',
      400
    );
  }

  if (!operatorId) {
    throw new SendMessageError(
      'bad_request',
      'Authenticated operator is required',
      400
    );
  }

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'first_launch_disabled',
      `Unsupported first-launch WAHA message_type "${messageType}"`,
      410
    );
  }

  if (messageType === 'text' && !contentText?.trim()) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams,
  deps: SendMessageDeps = {}
): Promise<SendMessageResult> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const {
    requestId,
    operatorId,
    conversationId,
    messageType,
    contentText,
    replyToMessageId,
    aiDraftId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    requestId,
    operatorId,
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
    { id: string; phone?: string | null } | null | undefined;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const wahaRecipient = resolveWahaRecipient(contact.phone);
  if (!wahaRecipient) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
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
        400
      );
    }
    replyToInternalId = String(parent.id);
    replyToProviderId = providerMessageId(parent);
  }

  let validatedDraftId: string | null = null;
  if (aiDraftId) {
    const { data: draft, error: draftError } = await db
      .from('ai_drafts')
      .select('id, account_id, conversation_id')
      .eq('id', aiDraftId)
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (draftError || !draft) {
      throw new SendMessageError(
        'bad_request',
        'ai_draft_id not found in this account and conversation',
        400
      );
    }
    validatedDraftId = String(draft.id);
  }

  const adminDb = resolvedDeps.integrationsAdminClient();
  const intent = {
    id: requestId,
    conversation_id: conversationId,
    sender_type: 'agent',
    sender_id: operatorId,
    content_type: 'text',
    content_text: contentText!,
    media_url: null,
    template_name: null,
    message_id: null,
    waha_session_name: null,
    waha_message_id: null,
    waha_message_status: null,
    ...crmSyncFields,
    status: 'sending',
    reply_to_message_id: replyToInternalId,
    ai_draft_id: validatedDraftId,
    outbound_state: 'queued',
    outbound_attempt_count: 0,
    outbound_error_code: null,
    outbound_error: null,
    outbound_started_at: null,
    outbound_completed_at: null,
    waha_chat_id: wahaRecipient,
  };

  let insertResult: { data: unknown; error: unknown };
  try {
    insertResult = await adminDb
      .from('messages')
      .insert(intent)
      .select(OUTBOX_SELECT)
      .single();
  } catch {
    throw new SendMessageError(
      'db_error',
      'Failed to persist the WhatsApp send intent',
      500
    );
  }

  let outbox = toOutboxRow(insertResult.data);
  if (insertResult.error || !outbox) {
    if (!isUniqueViolation(insertResult.error)) {
      throw new SendMessageError(
        'db_error',
        'Failed to persist the WhatsApp send intent',
        500
      );
    }

    outbox = await loadExistingOutbox(adminDb, requestId);
    assertMatchingIntent(outbox, {
      requestId,
      operatorId,
      conversationId,
      contentText: contentText!,
      replyToMessageId: replyToInternalId,
      aiDraftId: validatedDraftId,
      wahaChatId: wahaRecipient,
    });

    const duplicateResult = resolveExistingOutbox(outbox);
    if (duplicateResult) return duplicateResult;
  }

  let runtime: WahaRuntimeConfig;
  try {
    runtime = await resolvedDeps.loadWahaRuntimeConfig(adminDb, accountId);
  } catch (err) {
    throw preservePreDispatchError(err, requestId);
  }

  const startedAt = resolvedDeps.now().toISOString();
  let claimResult: { data: unknown; error: unknown };
  try {
    claimResult = await adminDb
      .from('messages')
      .update({
        outbound_state: 'dispatching',
        outbound_attempt_count: 1,
        outbound_started_at: startedAt,
        waha_session_name: runtime.config.sessionName,
      })
      .eq('id', requestId)
      .eq('outbound_state', 'queued')
      .select(OUTBOX_SELECT)
      .maybeSingle();
  } catch {
    throw new SendMessageError(
      'db_error',
      'Failed to claim the persisted WhatsApp send intent',
      500,
      { messageId: requestId, outboundState: 'queued' }
    );
  }

  if (claimResult.error) {
    throw new SendMessageError(
      'db_error',
      'Failed to claim the persisted WhatsApp send intent',
      500,
      { messageId: requestId, outboundState: 'queued' }
    );
  }

  const claimed = toOutboxRow(claimResult.data);
  if (!claimed) {
    const current = await loadExistingOutbox(adminDb, requestId);
    assertMatchingIntent(current, {
      requestId,
      operatorId,
      conversationId,
      contentText: contentText!,
      replyToMessageId: replyToInternalId,
      aiDraftId: validatedDraftId,
      wahaChatId: wahaRecipient,
    });
    const concurrentResult = resolveExistingOutbox(current);
    if (concurrentResult) return concurrentResult;
    throw stateConflict(current);
  }

  let providerResult: Awaited<ReturnType<typeof sendWahaText>>;
  try {
    providerResult = await resolvedDeps.sendWahaText(runtime.config, {
      to: wahaRecipient,
      text: contentText!,
      replyTo: replyToProviderId,
    });
  } catch (err) {
    if (
      err instanceof WahaProviderError &&
      CONFIRMED_PROVIDER_REJECTION_STATUSES.has(err.status)
    ) {
      const completedAt = resolvedDeps.now().toISOString();
      const persisted = await persistTerminalState(
        adminDb,
        requestId,
        {
          outbound_state: 'rejected',
          status: 'failed',
          outbound_error_code: 'waha_provider_rejected',
          outbound_error: `WAHA rejected sendText with HTTP ${err.status}`,
          outbound_completed_at: completedAt,
          waha_message_status: 'rejected',
        },
        'rejected'
      );
      if (!persisted) {
        throw unknownOutcomeError(requestId, 'dispatching');
      }
      throw new SendMessageError(
        err.code,
        `WAHA rejected the message with HTTP ${err.status}`,
        502,
        { messageId: requestId, outboundState: 'rejected' }
      );
    }

    const completedAt = resolvedDeps.now().toISOString();
    const ambiguousProviderResponse = err instanceof WahaProviderError;
    const persisted = await persistTerminalState(
      adminDb,
      requestId,
      {
        outbound_state: 'unknown',
        status: 'failed',
        outbound_error_code: ambiguousProviderResponse
          ? 'waha_provider_unknown'
          : 'waha_transport_unknown',
        outbound_error: ambiguousProviderResponse
          ? `WAHA returned HTTP ${err.status}; send outcome is unknown`
          : 'WAHA send outcome is unknown after a transport failure',
        outbound_completed_at: completedAt,
        waha_message_status: 'unknown',
      },
      'unknown'
    );
    throw unknownOutcomeError(requestId, persisted ? 'unknown' : 'dispatching');
  }

  const completedAt = resolvedDeps.now().toISOString();
  const providerMessageIdValue = providerResult.whatsappMessageId || null;
  let finalizeResult: { data: unknown; error: unknown };
  try {
    finalizeResult = await adminDb
      .from('messages')
      .update({
        message_id: providerMessageIdValue,
        waha_message_id: providerMessageIdValue,
        waha_message_status: providerResult.messageStatus,
        outbound_state: 'accepted',
        status: 'sent',
        outbound_error_code: null,
        outbound_error: null,
        outbound_completed_at: completedAt,
      })
      .eq('id', requestId)
      .eq('outbound_state', 'dispatching')
      .select(OUTBOX_SELECT)
      .maybeSingle();
  } catch {
    throw unknownOutcomeError(requestId, 'dispatching');
  }

  const accepted = toOutboxRow(finalizeResult.data);
  if (finalizeResult.error || !accepted) {
    throw unknownOutcomeError(requestId, 'dispatching');
  }

  const previewAt = resolvedDeps.now().toISOString();
  let previewFailed = false;
  try {
    const previewResult = await db
      .from('conversations')
      .update({
        last_message_text: contentText,
        last_message_at: previewAt,
        updated_at: previewAt,
      })
      .eq('id', conversationId)
      .eq('account_id', accountId);
    previewFailed = hasSupabaseError(previewResult);
  } catch {
    previewFailed = true;
  }

  if (previewFailed) {
    resolvedDeps.logPreviewFailure({
      conversationId,
      messageId: requestId,
    });
  }

  return acceptedResult(accepted);
}

async function loadExistingOutbox(
  adminDb: SupabaseClient,
  requestId: string
): Promise<OutboxRow> {
  let result: { data: unknown; error: unknown };
  try {
    result = await adminDb
      .from('messages')
      .select(OUTBOX_SELECT)
      .eq('id', requestId)
      .maybeSingle();
  } catch {
    throw new SendMessageError(
      'db_error',
      'Failed to load the existing WhatsApp send intent',
      500
    );
  }
  const { data, error } = result;
  const outbox = toOutboxRow(data);
  if (error || !outbox) {
    throw new SendMessageError(
      'db_error',
      'Failed to load the existing WhatsApp send intent',
      500
    );
  }
  return outbox;
}

function assertMatchingIntent(
  row: OutboxRow,
  expected: {
    requestId: string;
    operatorId: string;
    conversationId: string;
    contentText: string;
    replyToMessageId: string | null;
    aiDraftId: string | null;
    wahaChatId: string;
  }
): void {
  if (
    row.id !== expected.requestId ||
    row.conversation_id !== expected.conversationId ||
    row.sender_id !== expected.operatorId ||
    row.content_type !== 'text' ||
    row.content_text !== expected.contentText ||
    nullishString(row.reply_to_message_id) !== expected.replyToMessageId ||
    nullishString(row.ai_draft_id) !== expected.aiDraftId ||
    nullishString(row.waha_chat_id) !== expected.wahaChatId
  ) {
    throw new SendMessageError(
      'idempotency_conflict',
      'Idempotency-Key was already used for a different send intent',
      409
    );
  }
}

function resolveExistingOutbox(row: OutboxRow): SendMessageResult | null {
  if (row.outbound_state === 'accepted') {
    return acceptedResult(row);
  }
  if (row.outbound_state === 'queued') {
    return null;
  }
  throw stateConflict(row);
}

function stateConflict(row: OutboxRow): SendMessageError {
  if (row.outbound_state === 'unknown') {
    return unknownOutcomeError(row.id, 'unknown', 409);
  }
  if (row.outbound_state === 'rejected') {
    return new SendMessageError(
      'outbound_rejected',
      'This WhatsApp send was already rejected and will not be retried',
      409,
      { messageId: row.id, outboundState: 'rejected' }
    );
  }
  return new SendMessageError(
    'outbound_in_progress',
    'This WhatsApp send is already in progress and must not be retried',
    409,
    { messageId: row.id, outboundState: 'dispatching' }
  );
}

function acceptedResult(row: OutboxRow): SendMessageResult {
  const whatsappMessageId = nullishString(row.waha_message_id) ?? '';
  const wahaMessageStatus =
    row.waha_message_status === 'accepted_without_id'
      ? 'accepted_without_id'
      : whatsappMessageId
        ? 'accepted'
        : 'accepted_without_id';
  return {
    messageId: row.id,
    whatsappMessageId,
    wahaMessageStatus,
    outboundState: 'accepted',
  };
}

async function persistTerminalState(
  adminDb: SupabaseClient,
  requestId: string,
  payload: Record<string, unknown>,
  expectedState: 'rejected' | 'unknown'
): Promise<boolean> {
  let result: { data: unknown; error: unknown };
  try {
    result = await adminDb
      .from('messages')
      .update(payload)
      .eq('id', requestId)
      .eq('outbound_state', 'dispatching')
      .select('id, outbound_state')
      .maybeSingle();
  } catch {
    return false;
  }
  const { data, error } = result;
  if (error || !data || typeof data !== 'object') return false;
  return (data as Record<string, unknown>).outbound_state === expectedState;
}

function preservePreDispatchError(
  err: unknown,
  requestId: string
): SendMessageError {
  if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
    const code = String((err as { code: unknown }).code);
    const status = Number((err as { status: unknown }).status);
    const missingFields =
      'missingFields' in err &&
      Array.isArray((err as { missingFields?: unknown }).missingFields)
        ? (err as { missingFields: string[] }).missingFields
        : undefined;
    return new SendMessageError(
      code,
      err instanceof Error ? err.message : 'WhatsApp configuration failed',
      Number.isFinite(status) ? status : 500,
      {
        messageId: requestId,
        outboundState: 'queued',
        missingFields,
      }
    );
  }
  return new SendMessageError(
    'waha_configuration_error',
    err instanceof Error ? err.message : 'WhatsApp configuration failed',
    500,
    { messageId: requestId, outboundState: 'queued' }
  );
}

function unknownOutcomeError(
  requestId: string,
  outboundState: 'dispatching' | 'unknown',
  status = 502
): SendMessageError {
  return new SendMessageError(
    'outbound_state_unknown',
    'WhatsApp send outcome is uncertain; do not retry this request',
    status,
    { messageId: requestId, outboundState }
  );
}

function toOutboxRow(value: unknown): OutboxRow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    typeof row.conversation_id !== 'string' ||
    typeof row.content_type !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: nullishString(row.sender_id),
    content_type: row.content_type,
    content_text:
      typeof row.content_text === 'string' ? row.content_text : null,
    reply_to_message_id: nullishString(row.reply_to_message_id),
    ai_draft_id: nullishString(row.ai_draft_id),
    waha_chat_id: nullishString(row.waha_chat_id),
    waha_message_id: nullishString(row.waha_message_id),
    waha_message_status: nullishString(row.waha_message_status),
    outbound_state: isManualOutboundState(row.outbound_state)
      ? row.outbound_state
      : null,
  };
}

function isManualOutboundState(value: unknown): value is ManualOutboundState {
  return (
    value === 'queued' ||
    value === 'dispatching' ||
    value === 'accepted' ||
    value === 'rejected' ||
    value === 'unknown'
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    String((error as { code: unknown }).code) === '23505'
  );
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
  return isValidE164(normalizedPhone) ? toWahaChatId(normalizedPhone) : null;
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
  if (
    typeof value === 'string' &&
    CRM_SYNC_STATUSES.has(value as CrmSyncStatus)
  ) {
    return value as CrmSyncStatus;
  }
  return textOrNull(amoLeadId) ? 'synced' : 'pending';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullishString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
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
