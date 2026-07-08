import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WahaConfigurationError,
  WahaProviderError,
} from '@/lib/waha/client';

import {
  sendMessageToConversation,
  type SendMessageDeps,
} from './send-message';

interface QueryCall {
  table: string;
  op: 'select' | 'insert' | 'update';
  selected?: string;
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
}

interface FakeDbState {
  conversation?: Record<string, unknown> | null;
  conversationError?: unknown;
  parentMessage?: Record<string, unknown> | null;
  parentError?: unknown;
  insertError?: unknown;
  updateError?: unknown;
  insertedMessages: Record<string, unknown>[];
  conversationUpdates: Array<{
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
  }>;
  calls: QueryCall[];
}

function makeState(overrides: Partial<FakeDbState> = {}): FakeDbState {
  return {
    conversation: {
      id: 'conv-1',
      account_id: 'acct-1',
      contact: {
        id: 'contact-1',
        phone: '+1 (415) 555-1212',
      },
    },
    parentMessage: null,
    insertedMessages: [],
    conversationUpdates: [],
    calls: [],
    ...overrides,
  };
}

class FakeQuery {
  private op: QueryCall['op'] = 'select';
  private selected?: string;
  private payload?: Record<string, unknown>;
  private filters: Record<string, unknown> = {};

  constructor(
    private readonly table: string,
    private readonly state: FakeDbState,
  ) {}

  select(value?: string) {
    this.selected = value;
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }

  insert(value: Record<string, unknown>) {
    this.op = 'insert';
    this.payload = value;
    return this;
  }

  update(value: Record<string, unknown>) {
    this.op = 'update';
    this.payload = value;
    return this;
  }

  single() {
    return Promise.resolve(this.resolve());
  }

  maybeSingle() {
    return Promise.resolve(this.resolve());
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }

  private resolve(): { data: unknown; error: unknown } {
    this.state.calls.push({
      table: this.table,
      op: this.op,
      selected: this.selected,
      payload: this.payload,
      filters: { ...this.filters },
    });

    if (this.table === 'conversations' && this.op === 'select') {
      return {
        data: this.state.conversation ?? null,
        error: this.state.conversationError ?? null,
      };
    }

    if (this.table === 'messages' && this.op === 'select') {
      const parent = this.state.parentMessage;
      if (
        parent &&
        parent.id === this.filters.id &&
        parent.conversation_id === this.filters.conversation_id
      ) {
        return { data: parent, error: this.state.parentError ?? null };
      }
      return { data: null, error: this.state.parentError ?? null };
    }

    if (this.table === 'messages' && this.op === 'insert') {
      if (this.state.insertError) {
        return { data: null, error: this.state.insertError };
      }
      this.state.insertedMessages.push(this.payload ?? {});
      return {
        data: {
          id: 'message-1',
          ...(this.payload ?? {}),
        },
        error: null,
      };
    }

    if (this.table === 'conversations' && this.op === 'update') {
      this.state.conversationUpdates.push({
        payload: this.payload ?? {},
        filters: { ...this.filters },
      });
      return {
        data: null,
        error: this.state.updateError ?? null,
      };
    }

    throw new Error(`Unhandled fake Supabase query: ${this.table}:${this.op}`);
  }
}

function makeDb(state: FakeDbState): SupabaseClient {
  return {
    from(table: string) {
      return new FakeQuery(table, state);
    },
  } as unknown as SupabaseClient;
}

function makeDeps(overrides: Partial<SendMessageDeps> = {}) {
  const adminClient = { from: vi.fn() } as unknown as SupabaseClient;
  return {
    integrationsAdminClient: vi.fn(() => adminClient),
    loadWahaRuntimeConfig: vi.fn(async () => ({
      settingId: 'waha-setting-1',
      config: {
        baseUrl: 'https://waha.internal',
        sessionName: 'evo-inbox',
        apiKey: 'test-api-key',
      },
      webhookHmacSecret: 'test-hmac',
      publicConfig: {},
    })),
    sendWahaText: vi.fn(async () => ({
      whatsappMessageId: 'false_14155551212@c.us_AAA',
      messageStatus: 'accepted' as const,
      raw: { id: 'false_14155551212@c.us_AAA' },
    })),
    now: () => new Date('2026-07-06T20:00:00.000Z'),
    ...overrides,
  };
}

describe('sendMessageToConversation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends manual text through WAHA and persists the outbound message after acceptance', async () => {
    const state = makeState();
    const db = makeDb(state);
    const deps = makeDeps();

    const result = await sendMessageToConversation(
      db,
      'acct-1',
      {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'Hello from operator',
      },
      deps,
    );

    expect(deps.loadWahaRuntimeConfig).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
    );
    expect(deps.sendWahaText).toHaveBeenCalledWith(
      {
        baseUrl: 'https://waha.internal',
        sessionName: 'evo-inbox',
        apiKey: 'test-api-key',
      },
      {
        to: '14155551212',
        text: 'Hello from operator',
        replyTo: null,
      },
    );
    expect(state.insertedMessages).toEqual([
      expect.objectContaining({
        conversation_id: 'conv-1',
        sender_type: 'agent',
        content_type: 'text',
        content_text: 'Hello from operator',
        message_id: 'false_14155551212@c.us_AAA',
        waha_session_name: 'evo-inbox',
        waha_message_id: 'false_14155551212@c.us_AAA',
        waha_message_status: 'accepted',
        status: 'sent',
      }),
    ]);
    expect(state.conversationUpdates).toEqual([
      {
        payload: {
          last_message_text: 'Hello from operator',
          last_message_at: '2026-07-06T20:00:00.000Z',
          updated_at: '2026-07-06T20:00:00.000Z',
        },
        filters: { id: 'conv-1', account_id: 'acct-1' },
      },
    ]);
    expect(result).toEqual({
      messageId: 'message-1',
      whatsappMessageId: 'false_14155551212@c.us_AAA',
      wahaMessageStatus: 'accepted',
    });
  });

  it('inherits the conversation CRM sync state on outbound messages', async () => {
    const state = makeState({
      conversation: {
        id: 'conv-1',
        account_id: 'acct-1',
        amo_lead_id: 'amo-lead-1',
        crm_sync_status: 'synced',
        crm_sync_error: 'stale error from before sync',
        crm_sync_attempted_at: '2026-07-06T19:00:00.000Z',
        contact: {
          id: 'contact-1',
          phone: '+1 (415) 555-1212',
        },
      },
    });
    const deps = makeDeps();

    await sendMessageToConversation(
      makeDb(state),
      'acct-1',
      {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'Synced reply',
      },
      deps,
    );

    expect(state.insertedMessages[0]).toEqual(
      expect.objectContaining({
        conversation_id: 'conv-1',
        content_text: 'Synced reply',
        crm_sync_status: 'synced',
        crm_sync_error: null,
        crm_sync_attempted_at: '2026-07-06T19:00:00.000Z',
      }),
    );
  });

  it('normalizes internal WhatsApp ids to direct WAHA @c.us chat ids', async () => {
    const state = makeState({
      conversation: {
        id: 'conv-1',
        account_id: 'acct-1',
        contact: {
          id: 'contact-1',
          phone: '14155551212@s.whatsapp.net',
        },
      },
    });
    const deps = makeDeps();

    await sendMessageToConversation(
      makeDb(state),
      'acct-1',
      {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'Hello',
      },
      deps,
    );

    expect(deps.sendWahaText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: '14155551212@c.us' }),
    );
  });

  it('passes WAHA reply_to only when the reply target belongs to the conversation and has a provider id', async () => {
    const state = makeState({
      parentMessage: {
        id: 'parent-1',
        conversation_id: 'conv-1',
        message_id: 'legacy-meta-id',
        waha_message_id: 'false_14155551212@c.us_PARENT',
      },
    });
    const deps = makeDeps();

    await sendMessageToConversation(
      makeDb(state),
      'acct-1',
      {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'Replying',
        replyToMessageId: 'parent-1',
      },
      deps,
    );

    expect(deps.sendWahaText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        replyTo: 'false_14155551212@c.us_PARENT',
      }),
    );
    expect(state.insertedMessages[0]).toMatchObject({
      reply_to_message_id: 'parent-1',
    });
  });

  it('rejects a reply target outside the conversation before calling WAHA', async () => {
    const state = makeState({
      parentMessage: {
        id: 'parent-1',
        conversation_id: 'other-conv',
        waha_message_id: 'false_14155551212@c.us_PARENT',
      },
    });
    const deps = makeDeps();

    await expect(
      sendMessageToConversation(
        makeDb(state),
        'acct-1',
        {
          conversationId: 'conv-1',
          messageType: 'text',
          contentText: 'Replying',
          replyToMessageId: 'parent-1',
        },
        deps,
      ),
    ).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
    });
    expect(deps.sendWahaText).not.toHaveBeenCalled();
    expect(state.insertedMessages).toEqual([]);
  });

  it('returns missing WAHA config explicitly and does not persist a message', async () => {
    const state = makeState();
    const deps = makeDeps({
      loadWahaRuntimeConfig: vi.fn(async () => {
        throw new WahaConfigurationError(['baseUrl', 'apiKey']);
      }),
    });

    await expect(
      sendMessageToConversation(
        makeDb(state),
        'acct-1',
        {
          conversationId: 'conv-1',
          messageType: 'text',
          contentText: 'Hello',
        },
        deps,
      ),
    ).rejects.toMatchObject({
      code: 'waha_not_configured',
      status: 400,
    });
    expect(state.insertedMessages).toEqual([]);
    expect(state.conversationUpdates).toEqual([]);
  });

  it('returns WAHA provider failures explicitly and does not persist a message', async () => {
    const state = makeState();
    const deps = makeDeps({
      sendWahaText: vi.fn(async () => {
        throw new WahaProviderError('WAHA sendText failed with 503', 503);
      }),
    });

    await expect(
      sendMessageToConversation(
        makeDb(state),
        'acct-1',
        {
          conversationId: 'conv-1',
          messageType: 'text',
          contentText: 'Hello',
        },
        deps,
      ),
    ).rejects.toMatchObject({
      code: 'waha_provider_error',
      status: 503,
    });
    expect(state.insertedMessages).toEqual([]);
    expect(state.conversationUpdates).toEqual([]);
  });

  it('surfaces DB insert failure after WAHA acceptance without updating the preview', async () => {
    const state = makeState({
      insertError: { message: 'insert failed' },
    });
    const deps = makeDeps();

    await expect(
      sendMessageToConversation(
        makeDb(state),
        'acct-1',
        {
          conversationId: 'conv-1',
          messageType: 'text',
          contentText: 'Hello',
        },
        deps,
      ),
    ).rejects.toMatchObject({
      code: 'db_error',
      status: 500,
      message: 'Message sent through WAHA but failed to save to DB',
    });
    expect(deps.sendWahaText).toHaveBeenCalledTimes(1);
    expect(state.insertedMessages).toEqual([]);
    expect(state.conversationUpdates).toEqual([]);
  });

  it('persists accepted-without-id provider status without inventing a WAHA id', async () => {
    const state = makeState();
    const deps = makeDeps({
      sendWahaText: vi.fn(async () => ({
        whatsappMessageId: '',
        messageStatus: 'accepted_without_id' as const,
        raw: { ok: true },
      })),
    });

    const result = await sendMessageToConversation(
      makeDb(state),
      'acct-1',
      {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'Hello',
      },
      deps,
    );

    expect(state.insertedMessages[0]).toMatchObject({
      message_id: null,
      waha_message_id: null,
      waha_message_status: 'accepted_without_id',
      status: 'sent',
    });
    expect(result).toMatchObject({
      whatsappMessageId: '',
      wahaMessageStatus: 'accepted_without_id',
    });
  });

  it('reports conversation preview update failure explicitly', async () => {
    const state = makeState({
      updateError: { message: 'update failed' },
    });
    const deps = makeDeps();

    await expect(
      sendMessageToConversation(
        makeDb(state),
        'acct-1',
        {
          conversationId: 'conv-1',
          messageType: 'text',
          contentText: 'Hello',
        },
        deps,
      ),
    ).rejects.toMatchObject({
      code: 'db_error',
      status: 500,
      message: 'Message sent and saved, but failed to update conversation preview',
    });
    expect(state.insertedMessages).toHaveLength(1);
  });
});
