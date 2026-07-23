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
import type { CrmSyncStatus, IntegrationStatus } from '@/types';

export interface AmoCrmSyncTarget {
  accountId: string;
  conversationId: string;
  contactId: string;
  phone: string;
  name?: string | null;
}

export interface AmoCrmSyncOutcome {
  status: CrmSyncStatus;
  retryable: boolean;
  error: string | null;
  amoContactId?: string;
  amoLeadId?: string;
  missingFields?: string[];
}

export interface AmoCrmSyncDeps {
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
  persistAmoCrmShadowIdentity?: typeof persistAmoCrmShadowIdentity;
  now?: () => Date;
}

export interface PendingAmoCrmSyncOptions {
  limit?: number;
  includeBlocked?: boolean;
  accountId?: string;
}

export interface PendingAmoCrmSyncResult {
  scanned: number;
  synced: number;
  pending: number;
  notConfigured: number;
  blocked: number;
}

type RequiredSyncDeps = Required<AmoCrmSyncDeps>;

const defaultDeps = {
  loadAmoCrmConfig: loadAmoCrmRuntimeConfig,
  createAmoCrmClient,
  resolveAmoCrmIdentityFromProvider,
  persistAmoCrmShadowIdentity,
  now: () => new Date(),
} satisfies RequiredSyncDeps;

export async function syncAmoCrmConversation(
  db: SupabaseClient,
  target: AmoCrmSyncTarget,
  depsOverride: AmoCrmSyncDeps = {},
): Promise<AmoCrmSyncOutcome> {
  const deps = { ...defaultDeps, ...depsOverride };
  const existing = await loadLocalShadowIdentity(db, target);
  if (existing.amoContactId && existing.amoLeadId) {
    await setLocalCrmSyncState(db, target, {
      status: 'synced',
      error: null,
      now: deps.now(),
    });
    return {
      status: 'synced',
      retryable: false,
      error: null,
      amoContactId: existing.amoContactId,
      amoLeadId: existing.amoLeadId,
    };
  }

  try {
    const runtime = await deps.loadAmoCrmConfig(db, target.accountId);
    const client = deps.createAmoCrmClient(runtime.config);
    const identity = await deps.resolveAmoCrmIdentityFromProvider({
      client,
      phone: target.phone,
      name: target.name,
    });

    await deps.persistAmoCrmShadowIdentity(db, {
      accountId: target.accountId,
      localContactId: target.contactId,
      localConversationId: target.conversationId,
      amoContactId: identity.amoContactId,
      amoLeadId: identity.amoLeadId,
    });
    await setIntegrationState(db, target.accountId, 'configured', null);
    await setLocalCrmSyncState(db, target, {
      status: 'synced',
      error: null,
      now: deps.now(),
    });

    return {
      status: 'synced',
      retryable: false,
      error: null,
      amoContactId: identity.amoContactId,
      amoLeadId: identity.amoLeadId,
    };
  } catch (err) {
    const failure = classifyAmoCrmSyncFailure(err);
    await setIntegrationState(
      db,
      target.accountId,
      failure.integrationStatus,
      failure.error,
    );
    await setLocalCrmSyncState(db, target, {
      status: failure.status,
      error: failure.error,
      now: deps.now(),
    });
    return failure;
  }
}

export async function syncPendingAmoCrmConversations(
  db: SupabaseClient,
  options: PendingAmoCrmSyncOptions = {},
  deps: AmoCrmSyncDeps = {},
): Promise<PendingAmoCrmSyncResult> {
  const limit = clampBatchLimit(options.limit);
  const statuses: CrmSyncStatus[] = options.includeBlocked
    ? ['pending', 'not_configured', 'blocked']
    : ['pending', 'not_configured'];

  let query = db
    .from('conversations')
    .select('id, account_id, contact_id, contact:contacts(id, phone, name)')
    .in('crm_sync_status', statuses)
    .order('crm_sync_attempted_at', {
      ascending: true,
      nullsFirst: true,
    })
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (options.accountId) {
    query = query.eq('account_id', options.accountId);
  }

  const { data, error } = await query;
  if (error) throw new Error('Failed to load pending amoCRM sync rows');

  const rows = (data ?? []) as PendingSyncRow[];
  const result: PendingAmoCrmSyncResult = {
    scanned: rows.length,
    synced: 0,
    pending: 0,
    notConfigured: 0,
    blocked: 0,
  };

  for (const row of rows) {
    const contact = firstContact(row.contact);
    if (!contact?.phone) {
      await setLocalCrmSyncState(
        db,
        {
          accountId: String(row.account_id),
          conversationId: String(row.id),
        },
        {
          status: 'blocked',
          error: 'Local contact phone is missing; cannot sync to amoCRM.',
          now: deps.now?.() ?? new Date(),
        },
      );
      result.blocked += 1;
      continue;
    }

    const outcome = await syncAmoCrmConversation(
      db,
      {
        accountId: String(row.account_id),
        conversationId: String(row.id),
        contactId: String(row.contact_id),
        phone: String(contact.phone),
        name: typeof contact.name === 'string' ? contact.name : null,
      },
      deps,
    );
    incrementResult(result, outcome.status);
  }

  return result;
}

export async function resetAmoCrmSyncAfterConfigChange(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<void> {
  const timestamp = now.toISOString();
  const { data: rows, error: selectError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .in('crm_sync_status', ['not_configured', 'blocked']);

  if (selectError) {
    throw new Error('Failed to load conversations for amoCRM sync reset');
  }

  const conversationIds = (rows ?? [])
    .map((row) => textOrNull((row as Record<string, unknown>).id))
    .filter((id): id is string => id != null);
  if (conversationIds.length === 0) return;

  const value = {
    crm_sync_status: 'pending' satisfies CrmSyncStatus,
    crm_sync_error: null,
    updated_at: timestamp,
  };

  const conversationsResult = await db
    .from('conversations')
    .update(value)
    .eq('account_id', accountId)
    .in('id', conversationIds);

  if (hasSupabaseError(conversationsResult)) {
    throw new Error('Failed to reset conversation amoCRM sync status');
  }

  const messagesResult = await db
    .from('messages')
    .update({
      crm_sync_status: 'pending',
      crm_sync_error: null,
    })
    .in('conversation_id', conversationIds)
    .in('crm_sync_status', ['not_configured', 'blocked']);

  if (hasSupabaseError(messagesResult)) {
    throw new Error('Failed to reset message amoCRM sync status');
  }
}

export function classifyAmoCrmSyncFailure(err: unknown): AmoCrmSyncOutcome & {
  integrationStatus: IntegrationStatus;
} {
  if (err instanceof AmoCrmConfigurationError) {
    return {
      status: 'not_configured',
      retryable: true,
      error: err.message,
      missingFields: err.missingFields,
      integrationStatus: 'not_configured',
    };
  }

  if (err instanceof AmoCrmProviderError) {
    if (isNonRetryableProviderStatus(err.status)) {
      return {
        status: 'blocked',
        retryable: false,
        error: `amoCRM rejected identity sync with HTTP ${err.status}. Check the token, account URL, pipeline, status, or permissions.`,
        integrationStatus: 'blocked',
      };
    }
    return {
      status: 'pending',
      retryable: true,
      error: `amoCRM identity sync is pending after provider HTTP ${err.status}.`,
      integrationStatus: 'configured',
    };
  }

  return {
    status: 'pending',
    retryable: true,
    error: 'amoCRM identity sync is pending after a local processing error.',
    integrationStatus: 'configured',
  };
}

interface PendingSyncRow {
  id: unknown;
  account_id: unknown;
  contact_id: unknown;
  contact?: PendingSyncContact | PendingSyncContact[] | null;
}

interface PendingSyncContact {
  id?: unknown;
  phone?: unknown;
  name?: unknown;
}

async function loadLocalShadowIdentity(
  db: SupabaseClient,
  target: AmoCrmSyncTarget,
): Promise<{ amoContactId: string | null; amoLeadId: string | null }> {
  const [contactResult, conversationResult] = await Promise.all([
    db
      .from('contacts')
      .select('amo_contact_id')
      .eq('id', target.contactId)
      .eq('account_id', target.accountId)
      .maybeSingle(),
    db
      .from('conversations')
      .select('amo_lead_id')
      .eq('id', target.conversationId)
      .eq('account_id', target.accountId)
      .maybeSingle(),
  ]);

  if (contactResult.error || conversationResult.error) {
    throw new Error('Failed to load local amoCRM shadow identity');
  }

  return {
    amoContactId: textOrNull(contactResult.data?.amo_contact_id),
    amoLeadId: textOrNull(conversationResult.data?.amo_lead_id),
  };
}

async function setLocalCrmSyncState(
  db: SupabaseClient,
  target: Pick<AmoCrmSyncTarget, 'accountId' | 'conversationId'>,
  input: {
    status: CrmSyncStatus;
    error: string | null;
    now: Date;
  },
): Promise<void> {
  const now = input.now.toISOString();
  const value = {
    crm_sync_status: input.status,
    crm_sync_error: input.error,
    crm_sync_attempted_at: now,
  };

  const conversationResult = await db
    .from('conversations')
    .update({
      ...value,
      updated_at: now,
    })
    .eq('id', target.conversationId)
    .eq('account_id', target.accountId);

  if (hasSupabaseError(conversationResult)) {
    throw new Error('Failed to update conversation CRM sync status');
  }

  let messageQuery = db
    .from('messages')
    .update(value)
    .eq('conversation_id', target.conversationId);

  if (input.status !== 'synced') {
    messageQuery = messageQuery.neq('crm_sync_status', 'synced');
  }

  const messageResult = await messageQuery;
  if (hasSupabaseError(messageResult)) {
    throw new Error('Failed to update message CRM sync status');
  }
}

async function setIntegrationState(
  db: SupabaseClient,
  accountId: string,
  status: IntegrationStatus,
  lastError: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const result = await db
    .from('integration_settings')
    .update({
      status,
      last_checked_at: now,
      last_error: lastError,
      updated_at: now,
    })
    .eq('account_id', accountId)
    .eq('provider', 'amocrm');

  if (hasSupabaseError(result)) {
    throw new Error('Failed to update amoCRM integration state');
  }
}

function isNonRetryableProviderStatus(status: number): boolean {
  return [400, 401, 403, 404, 422].includes(status);
}

function clampBatchLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

function firstContact(
  value: PendingSyncContact | PendingSyncContact[] | null | undefined,
): PendingSyncContact | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function incrementResult(result: PendingAmoCrmSyncResult, status: CrmSyncStatus) {
  if (status === 'synced') result.synced += 1;
  else if (status === 'pending') result.pending += 1;
  else if (status === 'not_configured') result.notConfigured += 1;
  else result.blocked += 1;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasSupabaseError(value: unknown): value is { error: unknown } {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in value &&
    (value as { error: unknown }).error != null
  );
}
