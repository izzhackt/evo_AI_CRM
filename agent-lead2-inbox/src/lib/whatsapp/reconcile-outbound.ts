import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadWahaRuntimeConfig,
  type WahaRuntimeConfig,
} from '@/lib/waha/config';
import { getWahaMessageById } from '@/lib/waha/client';
import { recordWahaMessageAck } from '@/lib/waha/webhook';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

interface ReconcileRow {
  id: string;
  waha_session_name: string | null;
  waha_message_id: string | null;
  waha_chat_id: string | null;
  outbound_state: string | null;
  conversations:
    { account_id?: unknown } | Array<{ account_id?: unknown }> | null;
}

export interface ReconcileWahaOutboundOptions {
  limit?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  loadRuntimeConfig?: (
    db: SupabaseClient,
    accountId: string
  ) => Promise<WahaRuntimeConfig>;
}

export interface ReconcileWahaOutboundResult {
  scanned: number;
  reconciled: number;
  unresolved: number;
  failed: number;
}

/**
 * Resolve existing provider ids with WAHA's read-only message lookup.
 *
 * This function never dispatches or retries a WhatsApp message. Rows without
 * both stable provider identifiers stay unresolved for operator review.
 */
export async function reconcileWahaOutbound(
  db: SupabaseClient,
  options: ReconcileWahaOutboundOptions = {}
): Promise<ReconcileWahaOutboundResult> {
  const limit = boundedLimit(options.limit);
  const { data, error } = await db
    .from('messages')
    .select(
      'id, waha_session_name, waha_message_id, waha_chat_id, outbound_state, conversations!inner(account_id)'
    )
    .in('outbound_state', ['accepted', 'unknown'])
    .not('waha_message_id', 'is', null)
    .not('waha_chat_id', 'is', null)
    .or('waha_ack.is.null,waha_ack.lt.3')
    .order('outbound_started_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    throw new Error('Failed to load outbound WAHA reconciliation rows');
  }

  const rows = (data ?? []) as unknown as ReconcileRow[];
  const result: ReconcileWahaOutboundResult = {
    scanned: rows.length,
    reconciled: 0,
    unresolved: 0,
    failed: 0,
  };
  const configLoader = options.loadRuntimeConfig ?? loadWahaRuntimeConfig;
  const configByAccount = new Map<string, Promise<WahaRuntimeConfig>>();

  for (const row of rows) {
    const accountId = rowAccountId(row);
    const sessionName = stringValue(row.waha_session_name);
    const providerMessageId = stringValue(row.waha_message_id);
    const chatId = stringValue(row.waha_chat_id);
    if (!accountId || !sessionName || !providerMessageId || !chatId) {
      result.unresolved += 1;
      continue;
    }

    try {
      let configPromise = configByAccount.get(accountId);
      if (!configPromise) {
        configPromise = configLoader(db, accountId);
        configByAccount.set(accountId, configPromise);
      }
      const runtime = await configPromise;
      if (runtime.config.sessionName !== sessionName) {
        result.unresolved += 1;
        continue;
      }

      const providerMessage = await getWahaMessageById(
        runtime.config,
        { chatId, messageId: providerMessageId },
        options.fetchImpl
      );
      if (
        !providerMessage ||
        providerMessage.ack === null ||
        providerMessage.ackName === null
      ) {
        result.unresolved += 1;
        continue;
      }

      const recorded = await recordWahaMessageAck(
        db,
        accountId,
        {
          providerEventId: null,
          sessionName,
          messageId: providerMessageId,
          chatId,
          ack: providerMessage.ack,
          ackName: providerMessage.ackName,
          occurredAt: (options.now ?? (() => new Date()))().toISOString(),
        },
        'reconciliation'
      );
      if (recorded) {
        result.reconciled += 1;
      } else {
        result.unresolved += 1;
      }
    } catch {
      // Keep the durable row untouched. A failed read cannot establish whether
      // the original provider operation succeeded and must never trigger send.
      result.failed += 1;
    }
  }

  return result;
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value ?? DEFAULT_LIMIT)));
}

function rowAccountId(row: ReconcileRow): string | null {
  const relation = Array.isArray(row.conversations)
    ? row.conversations[0]
    : row.conversations;
  return stringValue(relation?.account_id);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
