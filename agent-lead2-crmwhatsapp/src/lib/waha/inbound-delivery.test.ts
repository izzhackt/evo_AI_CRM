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
type TableName = 'integration_settings' | 'conversations' | 'messages';

class MemoryBuilder {
  private mode: 'select' | 'insert' | 'update' = 'select';
  private filters: Array<{ column: string; value: unknown }> = [];
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
    this.filters.push({ column, value });
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
      conversations: seed?.conversations ?? [],
      messages: seed?.messages ?? [],
    };
  }

  from(table: string) {
    if (!['integration_settings', 'conversations', 'messages'].includes(table)) {
      throw new Error(`Unexpected table ${table}`);
    }
    return new MemoryBuilder(this, table as TableName);
  }

  select(table: TableName, filters: Array<{ column: string; value: unknown }>, limit: number | null) {
    const rows = this.tables[table].filter((row) =>
      filters.every((filter) => row[filter.column] === filter.value),
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

  update(table: TableName, filters: Array<{ column: string; value: unknown }>, value: Row) {
    for (const row of this.tables[table]) {
      if (filters.every((filter) => row[filter.column] === filter.value)) {
        Object.assign(row, value);
      }
    }
    return { data: null, error: null };
  }
}

const inboundMessage: WahaInboundMessage = {
  sessionName: 'evo-inbox',
  messageId: 'waha-message-1',
  chatId: '14155551212@c.us',
  senderPhone: '+14155551212',
  senderName: 'Alice Applicant',
  contentType: 'text',
  contentText: 'Hello from WhatsApp',
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
  it('resolves amoCRM identity before creating local inbox state and inserts the inbound message once', async () => {
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
    });
    expect(deps.resolveAmoCrmIdentityFromProvider).toHaveBeenCalledWith({
      client: expect.any(Object),
      phone: '+14155551212',
      name: 'Alice Applicant',
    });
    expect(
      deps.resolveAmoCrmIdentityFromProvider.mock.invocationCallOrder[0],
    ).toBeLessThan(deps.findOrCreateContact.mock.invocationCallOrder[0]);
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
        created_at: '2026-07-06T17:30:00.000Z',
      }),
    ]);
    expect(db.tables.conversations[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      last_message_text: 'Hello from WhatsApp',
      last_message_at: '2026-07-06T17:30:00.000Z',
      unread_count: 1,
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
    });
    expect(deps.loadAmoCrmConfig).not.toHaveBeenCalled();
    expect(db.tables.messages).toHaveLength(1);
  });

  it('fails as not configured and creates no local inbox rows when amoCRM config is missing', async () => {
    const db = new MemoryDb();
    const deps = createDeps({
      loadAmoCrmConfig: vi.fn(async () => {
        throw new AmoCrmConfigurationError(['baseUrl', 'accessToken']);
      }),
    });

    await expect(
      deliverWahaInboundMessage({ db, accountId: 'acct-1', message: inboundMessage }, deps),
    ).rejects.toMatchObject({
      code: 'amocrm_not_configured',
      status: 503,
      integrationStatus: 'not_configured',
      missingFields: ['baseUrl', 'accessToken'],
    } satisfies Partial<WahaInboundDeliveryError>);
    expect(db.tables.conversations).toHaveLength(0);
    expect(db.tables.messages).toHaveLength(0);
    expect(db.tables.integration_settings[0]).toMatchObject({
      status: 'not_configured',
      last_error: 'amoCRM configuration is missing: baseUrl, accessToken',
    });
  });

  it('fails as blocked and creates no local inbox rows when amoCRM provider resolution fails', async () => {
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
    ).rejects.toMatchObject({
      code: 'amocrm_blocked',
      status: 502,
      integrationStatus: 'blocked',
    } satisfies Partial<WahaInboundDeliveryError>);
    expect(deps.findOrCreateContact).not.toHaveBeenCalled();
    expect(db.tables.conversations).toHaveLength(0);
    expect(db.tables.messages).toHaveLength(0);
    expect(db.tables.integration_settings[0]).toMatchObject({
      status: 'blocked',
      last_error: 'amoCRM identity resolution failed',
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
