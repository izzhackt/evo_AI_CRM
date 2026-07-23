import type { SupabaseClient } from '@supabase/supabase-js';

import { createAmoCrmClient, type AmoCrmClient } from '@/lib/amocrm/client';
import {
  loadAmoCrmRuntimeConfig,
  type AmoCrmRuntimeConfig,
} from '@/lib/amocrm/config';
import {
  persistAmoCrmShadowIdentity,
  resolveAmoCrmIdentityFromProvider,
  type AmoCrmIdentity,
} from '@/lib/amocrm/identity';
import {
  syncAmoCrmConversation,
  type AmoCrmSyncOutcome,
} from '@/lib/amocrm/sync';
import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import type { CrmSyncStatus, IntegrationStatus } from '@/types';

import type { WahaInboundMessage } from './inbound-message';

interface InboundDb {
  from(table: string): unknown;
}

export interface WahaInboundDeliveryResult {
  status: 'received' | 'duplicate';
  conversationId: string;
  messageId: string;
  crmSyncStatus: CrmSyncStatus;
  crmSyncError?: string | null;
  crmSyncRetryable?: boolean;
  missingFields?: string[];
}

export interface WahaInboundDeliveryDeps {
  loadAmoCrmConfig?: (
    db: SupabaseClient,
    accountId: string,
  ) => Promise<AmoCrmRuntimeConfig>;
  createAmoCrmClient?: (config: AmoCrmRuntimeConfig['config']) => AmoCrmClient;
  resolveAmoCrmIdentityFromProvider?: (input: {
    client: AmoCrmClient;
    phone: string;
    name?: string | null;
  }) => Promise<AmoCrmIdentity>;
  resolveAuditUserId?: (db: SupabaseClient, accountId: string) => Promise<string>;
  findOrCreateContact?: typeof findOrCreateContact;
  persistAmoCrmShadowIdentity?: typeof persistAmoCrmShadowIdentity;
  now?: () => Date;
}

export class WahaInboundDeliveryError extends Error {
  readonly code: string;
  readonly status: number;
  readonly integrationStatus?: IntegrationStatus;
  readonly missingFields?: string[];

  constructor(input: {
    code: string;
    message: string;
    status: number;
    integrationStatus?: IntegrationStatus;
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

interface ConversationShadow {
  id: string;
  unreadCount: number;
}

interface ExistingWahaMessage {
  messageId: string;
  conversationId: string;
  crmSyncStatus: CrmSyncStatus;
  crmSyncError: string | null;
}

const defaultDeps = {
  loadAmoCrmConfig: loadAmoCrmRuntimeConfig,
  createAmoCrmClient,
  resolveAmoCrmIdentityFromProvider,
  resolveAuditUserId,
  findOrCreateContact,
  persistAmoCrmShadowIdentity,
  now: () => new Date(),
} satisfies Required<WahaInboundDeliveryDeps>;

export async function deliverWahaInboundMessage(
  input: {
    db: InboundDb;
    accountId: string;
    message: WahaInboundMessage;
  },
  deps: WahaInboundDeliveryDeps = {},
): Promise<WahaInboundDeliveryResult> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const db = input.db as SupabaseClient;
  const duplicate = await findExistingWahaMessage(db, input.message);
  if (duplicate) {
    return {
      status: 'duplicate',
      conversationId: duplicate.conversationId,
      messageId: duplicate.messageId,
      crmSyncStatus: duplicate.crmSyncStatus,
      crmSyncError: duplicate.crmSyncError,
    };
  }

  const auditUserId = await resolveAuditUserOrThrow(
    db,
    input.accountId,
    resolvedDeps,
  );
  const contact = await createContactOrThrow(
    db,
    input.accountId,
    auditUserId,
    input.message,
    resolvedDeps,
  );
  const conversation = await findOrCreateConversation(
    db,
    input.accountId,
    auditUserId,
    contact.id,
  );

  const inserted = await insertInboundMessage(
    db,
    conversation.id,
    contact.id,
    input.message,
  );
  if (inserted.duplicate) {
    return {
      status: 'duplicate',
      conversationId: inserted.conversationId,
      messageId: inserted.messageId,
      crmSyncStatus: inserted.crmSyncStatus,
      crmSyncError: inserted.crmSyncError,
    };
  }

  await updateConversationPreview(
    db,
    input.accountId,
    conversation,
    input.message,
    resolvedDeps.now(),
  );

  const syncOutcome = await syncAfterLocalSave(
    db,
    input,
    contact.id,
    conversation.id,
    resolvedDeps,
  );

  return {
    status: 'received',
    conversationId: conversation.id,
    messageId: inserted.messageId,
    crmSyncStatus: syncOutcome.status,
    crmSyncError: syncOutcome.error,
    crmSyncRetryable: syncOutcome.retryable,
    missingFields: syncOutcome.missingFields,
  };
}

async function syncAfterLocalSave(
  db: SupabaseClient,
  input: {
    accountId: string;
    message: WahaInboundMessage;
  },
  contactId: string,
  conversationId: string,
  deps: Required<WahaInboundDeliveryDeps>,
): Promise<AmoCrmSyncOutcome> {
  try {
    return await syncAmoCrmConversation(db, {
      accountId: input.accountId,
      conversationId,
      contactId,
      phone: input.message.senderPhone,
      name: input.message.senderName,
    }, {
      loadAmoCrmConfig: deps.loadAmoCrmConfig,
      createAmoCrmClient: deps.createAmoCrmClient,
      resolveAmoCrmIdentityFromProvider: deps.resolveAmoCrmIdentityFromProvider,
      persistAmoCrmShadowIdentity: deps.persistAmoCrmShadowIdentity,
      now: deps.now,
    });
  } catch (err) {
    void err;
    return {
      status: 'pending',
      retryable: true,
      error: 'amoCRM sync did not complete after the message was saved locally.',
    };
  }
}

async function resolveAuditUserOrThrow(
  db: SupabaseClient,
  accountId: string,
  deps: Required<WahaInboundDeliveryDeps>,
): Promise<string> {
  try {
    return await deps.resolveAuditUserId(db, accountId);
  } catch (err) {
    throw toSupabaseError('Failed to resolve account audit user', err);
  }
}

async function createContactOrThrow(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  message: WahaInboundMessage,
  deps: Required<WahaInboundDeliveryDeps>,
): Promise<{ id: string; created: boolean }> {
  try {
    return await deps.findOrCreateContact(db, accountId, auditUserId, {
      phone: message.senderPhone,
      name: message.senderName ?? message.senderPhone,
    });
  } catch (err) {
    throw toSupabaseError('Failed to resolve local contact shadow', err);
  }
}

async function findExistingWahaMessage(
  db: SupabaseClient,
  message: WahaInboundMessage,
): Promise<ExistingWahaMessage | null> {
  const { data, error } = await db
    .from('messages')
    .select('id, conversation_id, crm_sync_status, crm_sync_error')
    .eq('waha_session_name', message.sessionName)
    .eq('waha_message_id', message.messageId)
    .maybeSingle();

  if (error) {
    throw toSupabaseError('Failed to check existing WAHA message', error);
  }
  if (!data?.id || !data?.conversation_id) return null;
  return {
    messageId: String(data.id),
    conversationId: String(data.conversation_id),
    crmSyncStatus: toCrmSyncStatus(data.crm_sync_status),
    crmSyncError: typeof data.crm_sync_error === 'string' ? data.crm_sync_error : null,
  };
}

async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
): Promise<ConversationShadow> {
  const { data: existing, error: findError } = await db
    .from('conversations')
    .select('id, unread_count')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (findError) {
    throw toSupabaseError('Failed to load local conversation shadow', findError);
  }
  if (existing?.id) {
    return {
      id: String(existing.id),
      unreadCount: toUnreadCount(existing.unread_count),
    };
  }

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      contact_id: contactId,
      status: 'open',
    })
    .select('id, unread_count')
    .single();

  if (createError || !created?.id) {
    throw toSupabaseError('Failed to create local conversation shadow', createError);
  }

  return {
    id: String(created.id),
    unreadCount: toUnreadCount(created.unread_count),
  };
}

async function insertInboundMessage(
  db: SupabaseClient,
  conversationId: string,
  contactId: string,
  message: WahaInboundMessage,
): Promise<ExistingWahaMessage & { duplicate: boolean }> {
  const { data, error } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'customer',
      sender_id: contactId,
      content_type: message.contentType,
      content_text: message.contentText,
      message_id: message.messageId,
      waha_session_name: message.sessionName,
      waha_message_id: message.messageId,
      status: 'delivered',
      created_at: message.receivedAt,
    })
    .select('id')
    .single();

  if (isUniqueViolation(error)) {
    const existing = await findExistingWahaMessage(db, message);
    if (existing) return { ...existing, duplicate: true };
  }
  if (error || !data?.id) {
    throw toSupabaseError('Failed to insert inbound WAHA message', error);
  }

  return {
    messageId: String(data.id),
    conversationId,
    crmSyncStatus: 'pending',
    crmSyncError: null,
    duplicate: false,
  };
}

async function updateConversationPreview(
  db: SupabaseClient,
  accountId: string,
  conversation: ConversationShadow,
  message: WahaInboundMessage,
  now: Date,
): Promise<void> {
  const preview = message.contentText || `[${message.contentType}]`;
  const result = await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: message.receivedAt,
      unread_count: conversation.unreadCount + 1,
      updated_at: now.toISOString(),
    })
    .eq('id', conversation.id)
    .eq('account_id', accountId);

  if (hasSupabaseError(result)) {
    throw toSupabaseError('Failed to update conversation preview', result.error);
  }
}

function toUnreadCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toCrmSyncStatus(value: unknown): CrmSyncStatus {
  return value === 'synced' ||
    value === 'not_configured' ||
    value === 'blocked' ||
    value === 'pending'
    ? value
    : 'pending';
}

function hasSupabaseError(value: unknown): value is { error: unknown } {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in value &&
    (value as { error: unknown }).error != null
  );
}

function toSupabaseError(message: string, cause: unknown): WahaInboundDeliveryError {
  void cause;
  return new WahaInboundDeliveryError({
    code: 'supabase_error',
    message,
    status: 500,
    integrationStatus: 'blocked',
  });
}
