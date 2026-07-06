import type { SupabaseClient } from '@supabase/supabase-js';

import {
  AmoCrmConfigurationError,
  AmoCrmProviderError,
  createAmoCrmClient,
  type AmoCrmClient,
} from '@/lib/amocrm/client';
import {
  loadAmoCrmRuntimeConfig,
  type AmoCrmRuntimeConfig,
} from '@/lib/amocrm/config';
import {
  persistAmoCrmShadowIdentity,
  resolveAmoCrmIdentityFromProvider,
  type AmoCrmIdentity,
} from '@/lib/amocrm/identity';
import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import type { IntegrationStatus } from '@/types';

import type { WahaInboundMessage } from './inbound-message';

interface InboundDb {
  from(table: string): unknown;
}

export interface WahaInboundDeliveryResult {
  status: 'received' | 'duplicate';
  conversationId: string;
  messageId: string;
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
    };
  }

  const amoConfig = await loadAmoConfigOrThrow(
    db,
    input.accountId,
    resolvedDeps,
  );
  const amoIdentity = await resolveRemoteAmoIdentityOrThrow(
    db,
    input.accountId,
    input.message,
    amoConfig,
    resolvedDeps,
  );

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

  await persistShadowOrThrow(db, {
    accountId: input.accountId,
    localContactId: contact.id,
    localConversationId: conversation.id,
    amoContactId: amoIdentity.amoContactId,
    amoLeadId: amoIdentity.amoLeadId,
    deps: resolvedDeps,
  });

  const duplicateAfterShadow = await findExistingWahaMessage(db, input.message);
  if (duplicateAfterShadow) {
    return {
      status: 'duplicate',
      conversationId: duplicateAfterShadow.conversationId,
      messageId: duplicateAfterShadow.messageId,
    };
  }

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
    };
  }

  await updateConversationPreview(
    db,
    input.accountId,
    conversation,
    input.message,
    resolvedDeps.now(),
  );
  await setIntegrationState(db, input.accountId, 'configured', null);

  return {
    status: 'received',
    conversationId: conversation.id,
    messageId: inserted.messageId,
  };
}

async function loadAmoConfigOrThrow(
  db: SupabaseClient,
  accountId: string,
  deps: Required<WahaInboundDeliveryDeps>,
): Promise<AmoCrmRuntimeConfig> {
  try {
    return await deps.loadAmoCrmConfig(db, accountId);
  } catch (err) {
    if (err instanceof AmoCrmConfigurationError) {
      await setIntegrationState(db, accountId, 'not_configured', err.message);
      throw new WahaInboundDeliveryError({
        code: 'amocrm_not_configured',
        message: err.message,
        status: 503,
        integrationStatus: 'not_configured',
        missingFields: err.missingFields,
      });
    }
    throw toSupabaseError('Failed to load amoCRM integration configuration', err);
  }
}

async function resolveRemoteAmoIdentityOrThrow(
  db: SupabaseClient,
  accountId: string,
  message: WahaInboundMessage,
  amoConfig: AmoCrmRuntimeConfig,
  deps: Required<WahaInboundDeliveryDeps>,
): Promise<AmoCrmIdentity> {
  try {
    return await deps.resolveAmoCrmIdentityFromProvider({
      client: deps.createAmoCrmClient(amoConfig.config),
      phone: message.senderPhone,
      name: message.senderName,
    });
  } catch (err) {
    if (err instanceof AmoCrmConfigurationError) {
      await setIntegrationState(db, accountId, 'not_configured', err.message);
      throw new WahaInboundDeliveryError({
        code: 'amocrm_not_configured',
        message: err.message,
        status: 503,
        integrationStatus: 'not_configured',
        missingFields: err.missingFields,
      });
    }

    const messageText =
      err instanceof AmoCrmProviderError
        ? 'amoCRM identity resolution failed'
        : 'amoCRM identity resolution failed';
    await setIntegrationState(db, accountId, 'blocked', messageText);
    throw new WahaInboundDeliveryError({
      code: 'amocrm_blocked',
      message: messageText,
      status: 502,
      integrationStatus: 'blocked',
    });
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

async function persistShadowOrThrow(
  db: SupabaseClient,
  input: {
    accountId: string;
    localContactId: string;
    localConversationId: string;
    amoContactId: string;
    amoLeadId: string;
    deps: Required<WahaInboundDeliveryDeps>;
  },
): Promise<void> {
  try {
    await input.deps.persistAmoCrmShadowIdentity(db, {
      accountId: input.accountId,
      localContactId: input.localContactId,
      localConversationId: input.localConversationId,
      amoContactId: input.amoContactId,
      amoLeadId: input.amoLeadId,
    });
  } catch (err) {
    throw toSupabaseError('Failed to persist amoCRM shadow identity', err);
  }
}

async function findExistingWahaMessage(
  db: SupabaseClient,
  message: WahaInboundMessage,
): Promise<{ messageId: string; conversationId: string } | null> {
  const { data, error } = await db
    .from('messages')
    .select('id, conversation_id')
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
): Promise<{ messageId: string; conversationId: string; duplicate: boolean }> {
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

async function setIntegrationState(
  db: SupabaseClient,
  accountId: string,
  status: IntegrationStatus,
  lastError: string | null,
): Promise<void> {
  const result = await db
    .from('integration_settings')
    .update({
      status,
      last_checked_at: new Date().toISOString(),
      last_error: lastError,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('provider', 'amocrm');

  if (hasSupabaseError(result)) {
    throw toSupabaseError('Failed to update amoCRM integration state', result.error);
  }
}

function toUnreadCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
