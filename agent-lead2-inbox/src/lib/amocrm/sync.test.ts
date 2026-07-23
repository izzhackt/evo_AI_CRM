import { describe, expect, it, vi } from 'vitest';

import type { AmoCrmClient } from './client';
import type { AmoCrmRuntimeConfig } from './config';
import type { PersistAmoCrmShadowInput } from './identity';
import { syncPendingAmoCrmConversations } from './sync';

type Row = Record<string, unknown>;
type TableName = 'contacts' | 'conversations' | 'messages' | 'integration_settings';
type Filter =
  | { op: 'eq'; column: string; value: unknown }
  | { op: 'in'; column: string; value: unknown[] };

class MemoryBuilder {
  private mode: 'select' | 'update' = 'select';
  private filters: Filter[] = [];
  private updateValue: Row | null = null;
  private limitCount: number | null = null;

  constructor(
    private readonly db: MemoryDb,
    private readonly table: TableName,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ op: 'in', column, value });
    return this;
  }

  order() {
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  update(value: Row) {
    this.mode = 'update';
    this.updateValue = value;
    return this;
  }

  async maybeSingle() {
    const result = await this.execute();
    const rows = Array.isArray(result.data) ? result.data : [];
    return { data: rows[0] ?? null, error: result.error };
  }

  then(resolve: (value: { data: Row[] | null; error: Row | null }) => void) {
    this.execute().then(resolve);
  }

  private async execute(): Promise<{ data: Row[] | null; error: Row | null }> {
    if (this.mode === 'update') {
      return this.db.update(this.table, this.filters, this.updateValue ?? {});
    }
    return this.db.select(this.table, this.filters, this.limitCount);
  }
}

class MemoryDb {
  readonly tables: Record<TableName, Row[]> = {
    contacts: [
      {
        id: 'contact-1',
        account_id: 'acct-1',
        phone: '+14155551212',
        name: 'Alice Applicant',
        amo_contact_id: null,
      },
    ],
    conversations: [
      {
        id: 'conversation-1',
        account_id: 'acct-1',
        contact_id: 'contact-1',
        amo_lead_id: null,
        crm_sync_status: 'pending',
      },
    ],
    messages: [
      {
        id: 'message-1',
        conversation_id: 'conversation-1',
        crm_sync_status: 'pending',
      },
    ],
    integration_settings: [
      {
        id: 'amocrm-setting-1',
        account_id: 'acct-1',
        provider: 'amocrm',
        status: 'configured',
        last_error: null,
      },
    ],
  };

  from(table: string) {
    return new MemoryBuilder(this, table as TableName);
  }

  select(table: TableName, filters: Filter[], limit: number | null) {
    let rows = this.tables[table].filter((row) =>
      filters.every((filter) => matchesFilter(row, filter)),
    );
    if (table === 'conversations') {
      rows = rows.map((row) => ({
        ...row,
        contact: this.tables.contacts.find((contact) => contact.id === row.contact_id),
      }));
    }
    return {
      data: limit == null ? rows : rows.slice(0, limit),
      error: null,
    };
  }

  update(table: TableName, filters: Filter[], value: Row) {
    for (const row of this.tables[table]) {
      if (filters.every((filter) => matchesFilter(row, filter))) {
        Object.assign(row, value);
      }
    }
    return { data: null, error: null };
  }
}

function matchesFilter(row: Row, filter: Filter): boolean {
  if (filter.op === 'eq') return row[filter.column] === filter.value;
  return filter.value.includes(row[filter.column]);
}

describe('syncPendingAmoCrmConversations', () => {
  it('resolves pending conversations and persists amoCRM shadow ids', async () => {
    const db = new MemoryDb();
    const persist = vi.fn(async (
      _db: unknown,
      input: PersistAmoCrmShadowInput,
    ) => {
      Object.assign(db.tables.contacts[0], {
        amo_contact_id: input.amoContactId,
        amo_contact_synced_at: '2026-07-08T10:00:00.000Z',
      });
      Object.assign(db.tables.conversations[0], {
        amo_lead_id: input.amoLeadId,
        amo_lead_synced_at: '2026-07-08T10:00:00.000Z',
      });
    });

    const result = await syncPendingAmoCrmConversations(
      db as never,
      { limit: 5, accountId: 'acct-1' },
      {
        loadAmoCrmConfig: vi.fn(async () => ({
          settingId: 'amocrm-setting-1',
          config: { baseUrl: 'https://evo.amocrm.ru', accessToken: 'token' },
          publicConfig: {},
        } satisfies AmoCrmRuntimeConfig)),
        createAmoCrmClient: vi.fn(() => ({}) as AmoCrmClient),
        resolveAmoCrmIdentityFromProvider: vi.fn(async () => ({
          amoContactId: '101',
          amoLeadId: '202',
        })),
        persistAmoCrmShadowIdentity: persist,
        now: () => new Date('2026-07-08T10:01:00.000Z'),
      },
    );

    expect(result).toEqual({
      scanned: 1,
      synced: 1,
      pending: 0,
      notConfigured: 0,
      blocked: 0,
    });
    expect(persist).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        accountId: 'acct-1',
        localContactId: 'contact-1',
        localConversationId: 'conversation-1',
        amoContactId: '101',
        amoLeadId: '202',
      }),
    );
    expect(db.tables.contacts[0]).toMatchObject({ amo_contact_id: '101' });
    expect(db.tables.conversations[0]).toMatchObject({
      amo_lead_id: '202',
      crm_sync_status: 'synced',
      crm_sync_error: null,
    });
    expect(db.tables.messages[0]).toMatchObject({
      crm_sync_status: 'synced',
      crm_sync_error: null,
    });
  });
});
