import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  AmoCrmConfigurationError,
  AmoCrmProviderError,
  type AmoCrmClient,
} from '@/lib/amocrm/client';
import type { AmoCrmRuntimeConfig } from '@/lib/amocrm/config';
import type { WahaInboundMessage } from './inbound-message';
import {
  WahaInboundDeliveryError,
  deliverWahaInboundMessage,
  type WahaInboundDeliveryDeps,
} from './inbound-delivery';

type Row = Record<string, unknown>;
type TableName = 'contacts' | 'integration_settings' | 'conversations' | 'messages';
type Filter =
  | { op: 'eq'; column: string; value: unknown }
  | { op: 'neq'; column: string; value: unknown }
  | { op: 'in'; column: string; value: unknown[] };

class MemoryBuilder {
  private mode: 'select' | 'insert' | 'update' = 'select';
  private filters: Filter[] = [];
  private insertValue: Row | null = null;
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

  neq(column: string, value: unknown) {
    this.filters.push({ op: 'neq', column, value });
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

  insert(value: Row) {
    this.mode = 'insert';
    this.insertValue = value;
    return this;
  }

  update(value: Row) {
    this.mode = 'update';
    this.updateValue = value;
    return this;
  }

  async maybeSingle() {
    const result = await this.execute();
    if (result.error) return result;
    const rows = Array.isArray(result.data) ? result.data : [];
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const result = await this.execute();
    if (result.error) return result;
    const rows = Array.isArray(result.data) ? result.data : [];
    return { data: rows[0] ?? null, error: null };
  }

  then(resolve: (value: { data: Row[] | null; error: Row | null }) => void) {
    this.execute().then(resolve);
  }

  private async execute(): Promise<{ data: Row[] | null; error: Row | null }> {
    if (this.mode === 'insert') {
      return this.db.insert(this.table, this.insertValue ?? {});
    }
    if (this.mode === 'update') {
      return this.db.update(this.table, this.filters, this.updateValue ?? {});
    }
    return this.db.select(this.table, this.filters, this.limitCount);
  }
}

class MemoryDb {
  readonly tables: Record<TableName, Row[]>;
  failInsertTable: TableName | null = null;

  constructor(seed?: Partial<Record<TableName, Row[]>>) {
    this.tables = {
      integration_settings: seed?.integration_settings ?? [
        {
          id: 'amocrm-setting-1',
          account_id: 'acct-1',
          provider: 'amocrm',
          status: 'configured',
          last_error: null,
        },
      ],
      contacts: seed?.contacts ?? [
        {
          id: 'contact-1',
          account_id: 'acct-1',
          phone: '+14155551212',
          name: 'Alice Applicant',
          amo_contact_id: null,
        },
      ],
      conversations: seed?.conversations ?? [],
      messages: seed?.messages ?? [],
    };
  }

  from(table: string) {
    if (!['contacts', 'integration_settings', 'conversations', 'messages'].includes(table)) {
      throw new Error(`Unexpected table ${table}`);
    }
    return new MemoryBuilder(this, table as TableName);
  }

  select(table: TableName, filters: Filter[], limit: number | null) {
    const rows = this.tables[table].filter((row) =>
      filters.every((filter) => matchesFilter(row, filter)),
    );
    return {
      data: limit == null ? rows : rows.slice(0, limit),
      error: null,
    };
  }

  insert(table: TableName, value: Row) {
    if (this.failInsertTable === table) {
      return { data: null, error: { message: `${table} insert failed` } };
    }
    if (
      table === 'messages' &&
      value.waha_session_name &&
      value.waha_message_id &&
      this.tables.messages.some(
        (row) =>
          row.waha_session_name === value.waha_session_name &&
          row.waha_message_id === value.waha_message_id,
      )
    ) {
      return { data: null, error: { code: '23505', message: 'duplicate waha id' } };
    }

    const row = {
      id: `${table}-${this.tables[table].length + 1}`,
      ...value,
    };
    this.tables[table].push(row);
    return { data: [row], error: null };
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
  if (filter.op === 'neq') return row[filter.column] !== filter.value;
  return filter.value.includes(row[filter.column]);
}

const inboundMessage: WahaInboundMessage = {
  sessionName: 'evo-inbox',
  messageId: 'waha-message-1',
  chatId: '14155551212@c.us',
  senderPhone: '+14155551212',
  senderName: 'Alice Applicant',
  contentType: 'text',
  contentText: 'Hello from WhatsApp',
  media: null,
  receivedAt: '2026-07-06T17:30:00.000Z',
};

type TestDeps = WahaInboundDeliveryDeps & {
  loadAmoCrmConfig: Mock;
  resolveAmoCrmIdentityFromProvider: Mock;
  findOrCreateContact: Mock;
  persistAmoCrmShadowIdentity: Mock;
};

function createDeps(
  overrides: Partial<WahaInboundDeliveryDeps> = {},
): TestDeps {
  const base = {
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
    resolveAuditUserId: vi.fn(async () => 'owner-user-1'),
    findOrCreateContact: vi.fn(async () => ({
      id: 'contact-1',
      created: true,
    })),
    persistAmoCrmShadowIdentity: vi.fn(async () => undefined),
    now: () => new Date('2026-07-06T17:31:00.000Z'),
  };
  return { ...base, ...overrides } as TestDeps;
}

describe('deliverWahaInboundMessage', () => {
  it('saves local inbox state before resolving amoCRM identity and inserts the inbound message once', async () => {
    const db = new MemoryDb();
    const deps = createDeps();

    const result = await deliverWahaInboundMessage(
      { db, accountId: 'acct-1', message: inboundMessage },
      deps,
    );

    expect(result).toEqual({
      status: 'received',
      conversationId: 'conversations-1',
      messageId: 'messages-1',
      crmSyncStatus: 'synced',
      crmSyncError: null,
      crmSyncRetryable: false,
      missingFields: undefined,
    });
    expect(deps.resolveAmoCrmIdentityFromProvider).toHaveBeenCalledWith({
      client: expect.any(Object),
      phone: '+14155551212',
      name: 'Alice Applicant',
    });
    expect(
      deps.findOrCreateContact.mock.invocationCallOrder[0],
    ).toBeLessThan(deps.resolveAmoCrmIdentityFromProvider.mock.invocationCallOrder[0]);
    expect(deps.persistAmoCrmShadowIdentity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        accountId: 'acct-1',
        localContactId: 'contact-1',
        localConversationId: 'conversations-1',
        amoContactId: '101',
        amoLeadId: '202',
      }),
    );
    expect(db.tables.messages).toEqual([
      expect.objectContaining({
        id: 'messages-1',
        conversation_id: 'conversations-1',
        sender_type: 'customer',
        sender_id: 'contact-1',
        content_type: 'text',
        content_text: 'Hello from WhatsApp',
        message_id: 'waha-message-1',
        waha_session_name: 'evo-inbox',
        waha_message_id: 'waha-message-1',
        status: 'delivered',
        crm_sync_status: 'synced',
        created_at: '2026-07-06T17:30:00.000Z',
      }),
    ]);
    expect(db.tables.conversations[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      last_message_text: 'Hello from WhatsApp',
      last_message_at: '2026-07-06T17:30:00.000Z',
      unread_count: 1,
      crm_sync_status: 'synced',
    });
  });

  it('returns duplicate without provider calls when the WAHA message was already stored', async () => {
    const db = new MemoryDb({
      messages: [
        {
          id: 'messages-existing',
          conversation_id: 'conversation-existing',
          waha_session_name: 'evo-inbox',
          waha_message_id: 'waha-message-1',
        },
      ],
    });
    const deps = createDeps();

    await expect(
      deliverWahaInboundMessage({ db, accountId: 'acct-1', message: inboundMessage }, deps),
    ).resolves.toEqual({
      status: 'duplicate',
      conversationId: 'conversation-existing',
      messageId: 'messages-existing',
      crmSyncStatus: 'pending',
      crmSyncError: null,
    });
    expect(deps.loadAmoCrmConfig).not.toHaveBeenCalled();
    expect(db.tables.messages).toHaveLength(1);
  });

  it('saves local inbox rows as not configured when amoCRM config is missing', async () => {
    const db = new MemoryDb();
    const deps = createDeps({
      loadAmoCrmConfig: vi.fn(async () => {
        throw new AmoCrmConfigurationError(['baseUrl', 'accessToken']);
      }),
    });

    await expect(
      deliverWahaInboundMessage({ db, accountId: 'acct-1', message: inboundMessage }, deps),
    ).resolves.toMatchObject({
      status: 'received',
      conversationId: 'conversations-1',
      messageId: 'messages-1',
      crmSyncStatus: 'not_configured',
      crmSyncRetryable: true,
      missingFields: ['baseUrl', 'accessToken'],
    });
    expect(db.tables.conversations).toHaveLength(1);
    expect(db.tables.messages).toHaveLength(1);
    expect(db.tables.conversations[0]).toMatchObject({
      crm_sync_status: 'not_configured',
      crm_sync_error: 'amoCRM configuration is missing: baseUrl, accessToken',
    });
    expect(db.tables.messages[0]).toMatchObject({
      crm_sync_status: 'not_configured',
      crm_sync_error: 'amoCRM configuration is missing: baseUrl, accessToken',
    });
    expect(db.tables.integration_settings[0]).toMatchObject({
      status: 'not_configured',
      last_error: 'amoCRM configuration is missing: baseUrl, accessToken',
    });
  });

  it('keeps local inbox rows pending when amoCRM provider is temporarily unavailable', async () => {
    const db = new MemoryDb();
    const deps = createDeps({
      resolveAmoCrmIdentityFromProvider: vi.fn(async () => {
        throw new AmoCrmProviderError('amoCRM API failed with 503', 503, {
          title: 'provider down',
        });
      }),
    });

    await expect(
      deliverWahaInboundMessage({ db, accountId: 'acct-1', message: inboundMessage }, deps),
    ).resolves.toMatchObject({
      status: 'received',
      conversationId: 'conversations-1',
      messageId: 'messages-1',
      crmSyncStatus: 'pending',
      crmSyncRetryable: true,
    });
    expect(db.tables.conversations).toHaveLength(1);
    expect(db.tables.messages).toHaveLength(1);
    expect(db.tables.conversations[0]).toMatchObject({
      crm_sync_status: 'pending',
      crm_sync_error: 'amoCRM identity sync is pending after provider HTTP 503.',
    });
    expect(db.tables.messages[0]).toMatchObject({
      crm_sync_status: 'pending',
      crm_sync_error: 'amoCRM identity sync is pending after provider HTTP 503.',
    });
    expect(db.tables.integration_settings[0]).toMatchObject({
      status: 'configured',
      last_error: 'amoCRM identity sync is pending after provider HTTP 503.',
    });
  });

  it('saves local inbox rows as blocked when amoCRM rejects the token', async () => {
    const db = new MemoryDb();
    const deps = createDeps({
      resolveAmoCrmIdentityFromProvider: vi.fn(async () => {
        throw new AmoCrmProviderError('amoCRM API failed with 401', 401, {
          title: 'unauthorized',
        });
      }),
    });

    await expect(
      deliverWahaInboundMessage({ db, accountId: 'acct-1', message: inboundMessage }, deps),
    ).resolves.toMatchObject({
      status: 'received',
      conversationId: 'conversations-1',
      messageId: 'messages-1',
      crmSyncStatus: 'blocked',
      crmSyncRetryable: false,
    });
    expect(db.tables.conversations).toHaveLength(1);
    expect(db.tables.messages).toHaveLength(1);
    expect(db.tables.conversations[0]).toMatchObject({
      crm_sync_status: 'blocked',
      crm_sync_error:
        'amoCRM rejected identity sync with HTTP 401. Check the token, account URL, pipeline, status, or permissions.',
    });
    expect(db.tables.integration_settings[0]).toMatchObject({
      status: 'blocked',
      last_error:
        'amoCRM rejected identity sync with HTTP 401. Check the token, account URL, pipeline, status, or permissions.',
    });
  });

  it('fails clearly on Supabase message insert failure', async () => {
    const db = new MemoryDb();
    db.failInsertTable = 'messages';
    const deps = createDeps();

    await expect(
      deliverWahaInboundMessage({ db, accountId: 'acct-1', message: inboundMessage }, deps),
    ).rejects.toMatchObject({
      code: 'supabase_error',
      status: 500,
    } satisfies Partial<WahaInboundDeliveryError>);
    expect(db.tables.messages).toHaveLength(0);
  });
});
