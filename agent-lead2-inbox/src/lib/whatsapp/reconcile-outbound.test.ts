import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { reconcileWahaOutbound } from './reconcile-outbound';

const apiKeyFixture = ['test', 'api', 'key'].join('-');

function makeDb(rows: unknown[]) {
  const calls: unknown[] = [];
  const query = {
    select(value: string) {
      calls.push(['select', value]);
      return query;
    },
    in(column: string, values: unknown[]) {
      calls.push(['in', column, values]);
      return query;
    },
    not(column: string, operator: string, value: unknown) {
      calls.push(['not', column, operator, value]);
      return query;
    },
    or(value: string) {
      calls.push(['or', value]);
      return query;
    },
    order(column: string, options: unknown) {
      calls.push(['order', column, options]);
      return query;
    },
    limit(value: number) {
      calls.push(['limit', value]);
      return Promise.resolve({ data: rows, error: null });
    },
  };
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const db = {
    from(table: string) {
      calls.push(['from', table]);
      return query;
    },
    rpc,
  } as unknown as SupabaseClient;
  return { db, calls, rpc };
}

const row = {
  id: 'message-local-1',
  waha_session_name: 'evo-inbox',
  waha_message_id: 'true_14155551212@c.us_AAA',
  waha_chat_id: '14155551212@c.us',
  outbound_state: 'accepted',
  conversations: { account_id: 'account-1' },
};

describe('reconcileWahaOutbound', () => {
  it('performs only a bounded read lookup and records the observed ack', async () => {
    const { db, calls, rpc } = makeDb([row]);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: row.waha_message_id,
            ack: 3,
            ackName: 'READ',
          }),
          { status: 200 }
        )
    );

    const result = await reconcileWahaOutbound(db, {
      limit: 5,
      fetchImpl: fetchMock,
      now: () => new Date('2026-07-24T00:00:00.000Z'),
      loadRuntimeConfig: vi.fn(async () => ({
        settingId: 'setting-1',
        config: {
          baseUrl: 'http://evo-inbox-waha:3000',
          sessionName: 'evo-inbox',
          apiKey: apiKeyFixture,
        },
        webhookHmacSecret: 'unused-in-reconciliation',
        publicConfig: {},
      })),
    });

    expect(result).toEqual({
      scanned: 1,
      reconciled: 1,
      unresolved: 0,
      failed: 0,
    });
    expect(calls).toContainEqual(['limit', 5]);
    expect(calls).toContainEqual([
      'in',
      'outbound_state',
      ['accepted', 'unknown'],
    ]);
    expect(calls).toContainEqual(['not', 'waha_message_id', 'is', null]);
    expect(calls).toContainEqual(['not', 'waha_chat_id', 'is', null]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/evo-inbox/chats/14155551212%40c.us/messages/'
      ),
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/sendText'),
      expect.anything()
    );
    expect(rpc).toHaveBeenCalledWith('record_waha_message_ack', {
      p_account_id: 'account-1',
      p_session_name: 'evo-inbox',
      p_waha_message_id: row.waha_message_id,
      p_ack: 3,
      p_ack_name: 'READ',
      p_ack_at: '2026-07-24T00:00:00.000Z',
      p_source: 'reconciliation',
      p_provider_event_id: null,
    });
  });

  it('leaves unsupported provider lookups unresolved and never sends', async () => {
    const { db, rpc } = makeDb([row]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 501 }));

    const result = await reconcileWahaOutbound(db, {
      fetchImpl: fetchMock,
      loadRuntimeConfig: vi.fn(async () => ({
        settingId: 'setting-1',
        config: {
          baseUrl: 'http://evo-inbox-waha:3000',
          sessionName: 'evo-inbox',
          apiKey: apiKeyFixture,
        },
        webhookHmacSecret: 'unused-in-reconciliation',
        publicConfig: {},
      })),
    });

    expect(result).toMatchObject({ scanned: 1, unresolved: 1, reconciled: 0 });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/sendText'),
      expect.anything()
    );
  });

  it('does not query a session that differs from the account configuration', async () => {
    const { db, rpc } = makeDb([row]);
    const fetchMock = vi.fn();

    const result = await reconcileWahaOutbound(db, {
      fetchImpl: fetchMock,
      loadRuntimeConfig: vi.fn(async () => ({
        settingId: 'setting-1',
        config: {
          baseUrl: 'http://evo-inbox-waha:3000',
          sessionName: 'different-session',
          apiKey: apiKeyFixture,
        },
        webhookHmacSecret: 'unused-in-reconciliation',
        publicConfig: {},
      })),
    });

    expect(result).toMatchObject({ scanned: 1, unresolved: 1, reconciled: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
