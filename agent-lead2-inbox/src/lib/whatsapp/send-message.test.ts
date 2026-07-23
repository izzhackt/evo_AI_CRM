import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WahaConfigurationError, WahaProviderError } from '@/lib/waha/client';

import {
  sendMessageToConversation,
  type SendMessageDeps,
} from './send-message';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const OPERATOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DRAFT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROVIDER_ID = 'false_14155551212@c.us_AAA';
const wahaApiKeyFixture = ['test', 'api', 'key'].join('-');

type QueryOperation = 'select' | 'insert' | 'update';

interface QueryEvent {
  client: 'user' | 'admin';
  table: string;
  operation: QueryOperation;
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
}

interface TestState {
  conversation: Record<string, unknown> | null;
  parentMessage: Record<string, unknown> | null;
  draft: Record<string, unknown> | null;
  outbox: Map<string, Record<string, unknown>>;
  events: Array<QueryEvent | { client: 'provider'; operation: 'send' }>;
  preinsertError?: unknown;
  claimError?: unknown;
  finalizeError?: unknown;
  terminalUpdateError?: unknown;
  previewError?: unknown;
}

function makeState(overrides: Partial<TestState> = {}): TestState {
  return {
    conversation: {
      id: 'conv-1',
      account_id: 'acct-1',
      contact: {
        id: 'contact-1',
        phone: '+1 (415) 555-1212',
      },
    },
    parentMessage: {
      id: 'parent-1',
      conversation_id: 'conv-1',
      message_id: 'legacy-parent-provider-id',
      waha_message_id: 'waha-parent-provider-id',
    },
    draft: {
      id: DRAFT_ID,
      account_id: 'acct-1',
      conversation_id: 'conv-1',
    },
    outbox: new Map(),
    events: [],
    ...overrides,
  };
}

class FakeQuery {
  private operation: QueryOperation = 'select';
  private payload?: Record<string, unknown>;
  private filters: Record<string, unknown> = {};

  constructor(
    private readonly client: 'user' | 'admin',
    private readonly table: string,
    private readonly state: TestState
  ) {}

  select(columns?: string) {
    void columns;
    return this;
  }

  insert(value: Record<string, unknown>) {
    this.operation = 'insert';
    this.payload = value;
    return this;
  }

  update(value: Record<string, unknown>) {
    this.operation = 'update';
    this.payload = value;
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters[key] = value;
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
      | ((value: {
          data: unknown;
          error: unknown;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }

  private resolve(): { data: unknown; error: unknown } {
    this.state.events.push({
      client: this.client,
      table: this.table,
      operation: this.operation,
      payload: this.payload,
      filters: { ...this.filters },
    });

    if (this.client === 'user') return this.resolveUserQuery();
    return this.resolveAdminQuery();
  }

  private resolveUserQuery(): { data: unknown; error: unknown } {
    if (this.table === 'conversations' && this.operation === 'select') {
      const row = this.state.conversation;
      const matches =
        row &&
        row.id === this.filters.id &&
        row.account_id === this.filters.account_id;
      return { data: matches ? row : null, error: null };
    }

    if (this.table === 'messages' && this.operation === 'select') {
      const row = this.state.parentMessage;
      const matches =
        row &&
        row.id === this.filters.id &&
        row.conversation_id === this.filters.conversation_id;
      return { data: matches ? row : null, error: null };
    }

    if (this.table === 'ai_drafts' && this.operation === 'select') {
      const row = this.state.draft;
      const matches =
        row &&
        row.id === this.filters.id &&
        row.account_id === this.filters.account_id &&
        row.conversation_id === this.filters.conversation_id;
      return { data: matches ? row : null, error: null };
    }

    if (this.table === 'conversations' && this.operation === 'update') {
      return { data: null, error: this.state.previewError ?? null };
    }

    throw new Error(`Unhandled user query: ${this.table}:${this.operation}`);
  }

  private resolveAdminQuery(): { data: unknown; error: unknown } {
    if (this.table !== 'messages') {
      throw new Error(`Unhandled admin query: ${this.table}:${this.operation}`);
    }

    if (this.operation === 'insert') {
      if (this.state.preinsertError) {
        return { data: null, error: this.state.preinsertError };
      }
      const id = String(this.payload?.id ?? '');
      if (this.state.outbox.has(id)) {
        return { data: null, error: { code: '23505' } };
      }
      const row = { ...(this.payload ?? {}) };
      this.state.outbox.set(id, row);
      return { data: row, error: null };
    }

    if (this.operation === 'select') {
      const row = this.state.outbox.get(String(this.filters.id ?? '')) ?? null;
      return { data: row, error: null };
    }

    const id = String(this.filters.id ?? '');
    const current = this.state.outbox.get(id);
    if (
      !current ||
      Object.entries(this.filters).some(
        ([key, value]) => current[key] !== value
      )
    ) {
      return { data: null, error: null };
    }

    const targetState = this.payload?.outbound_state;
    if (targetState === 'dispatching' && this.state.claimError) {
      return { data: null, error: this.state.claimError };
    }
    if (targetState === 'accepted' && this.state.finalizeError) {
      return { data: null, error: this.state.finalizeError };
    }
    if (
      (targetState === 'rejected' || targetState === 'unknown') &&
      this.state.terminalUpdateError
    ) {
      return { data: null, error: this.state.terminalUpdateError };
    }

    const next = { ...current, ...(this.payload ?? {}) };
    this.state.outbox.set(id, next);
    return { data: next, error: null };
  }
}

function makeDb(state: TestState, client: 'user' | 'admin'): SupabaseClient {
  return {
    from(table: string) {
      return new FakeQuery(client, table, state);
    },
  } as unknown as SupabaseClient;
}

function makeDeps(
  state: TestState,
  overrides: Partial<SendMessageDeps> = {}
): Required<SendMessageDeps> {
  const adminDb = makeDb(state, 'admin');
  return {
    integrationsAdminClient: vi.fn(() => adminDb),
    loadWahaRuntimeConfig: vi.fn(async () => ({
      settingId: 'waha-setting-1',
      config: {
        baseUrl: 'https://waha.internal',
        sessionName: 'evo-inbox',
        apiKey: wahaApiKeyFixture,
      },
      webhookHmacSecret: 'test-hmac',
      publicConfig: {},
    })),
    sendWahaText: vi.fn(async () => {
      state.events.push({ client: 'provider', operation: 'send' });
      return {
        whatsappMessageId: PROVIDER_ID,
        messageStatus: 'accepted' as const,
        raw: { id: PROVIDER_ID },
      };
    }),
    now: vi.fn(() => new Date('2026-07-24T01:02:03.000Z')),
    logPreviewFailure: vi.fn(),
    ...overrides,
  };
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST_ID,
    operatorId: OPERATOR_ID,
    conversationId: 'conv-1',
    messageType: 'text',
    contentText: 'Hello from operator',
    replyToMessageId: 'parent-1',
    aiDraftId: DRAFT_ID,
    ...overrides,
  };
}

function existingIntent(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: REQUEST_ID,
    conversation_id: 'conv-1',
    sender_type: 'agent',
    sender_id: OPERATOR_ID,
    content_type: 'text',
    content_text: 'Hello from operator',
    reply_to_message_id: 'parent-1',
    ai_draft_id: DRAFT_ID,
    waha_chat_id: '14155551212@c.us',
    waha_message_id: null,
    waha_message_status: null,
    outbound_state: 'queued',
    outbound_attempt_count: 0,
    status: 'sending',
    ...overrides,
  };
}

describe('sendMessageToConversation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('persists the operator and draft before WAHA, claims once, then accepts the same row', async () => {
    const state = makeState();
    const deps = makeDeps(state);

    const result = await sendMessageToConversation(
      makeDb(state, 'user'),
      'acct-1',
      params(),
      deps
    );

    const row = state.outbox.get(REQUEST_ID);
    expect(row).toMatchObject({
      id: REQUEST_ID,
      conversation_id: 'conv-1',
      sender_type: 'agent',
      sender_id: OPERATOR_ID,
      content_type: 'text',
      content_text: 'Hello from operator',
      reply_to_message_id: 'parent-1',
      ai_draft_id: DRAFT_ID,
      waha_chat_id: '14155551212@c.us',
      waha_session_name: 'evo-inbox',
      outbound_state: 'accepted',
      outbound_attempt_count: 1,
      status: 'sent',
      message_id: PROVIDER_ID,
      waha_message_id: PROVIDER_ID,
      waha_message_status: 'accepted',
      outbound_started_at: '2026-07-24T01:02:03.000Z',
      outbound_completed_at: '2026-07-24T01:02:03.000Z',
    });
    expect(deps.sendWahaText).toHaveBeenCalledWith(
      expect.objectContaining({ sessionName: 'evo-inbox' }),
      {
        to: '14155551212@c.us',
        text: 'Hello from operator',
        replyTo: 'waha-parent-provider-id',
      }
    );

    const insertIndex = state.events.findIndex(
      (event) =>
        'table' in event &&
        event.client === 'admin' &&
        event.table === 'messages' &&
        event.operation === 'insert'
    );
    const providerIndex = state.events.findIndex(
      (event) => event.client === 'provider'
    );
    expect(insertIndex).toBeGreaterThanOrEqual(0);
    expect(providerIndex).toBeGreaterThan(insertIndex);
    expect(result).toEqual({
      messageId: REQUEST_ID,
      whatsappMessageId: PROVIDER_ID,
      wahaMessageStatus: 'accepted',
      outboundState: 'accepted',
    });
  });

  it('returns an already accepted identical request without calling WAHA again', async () => {
    const state = makeState();
    state.outbox.set(
      REQUEST_ID,
      existingIntent({
        outbound_state: 'accepted',
        status: 'sent',
        waha_message_id: PROVIDER_ID,
        waha_message_status: 'accepted',
      })
    );
    const deps = makeDeps(state);

    const result = await sendMessageToConversation(
      makeDb(state, 'user'),
      'acct-1',
      params(),
      deps
    );

    expect(result.outboundState).toBe('accepted');
    expect(result.whatsappMessageId).toBe(PROVIDER_ID);
    expect(deps.loadWahaRuntimeConfig).not.toHaveBeenCalled();
    expect(deps.sendWahaText).not.toHaveBeenCalled();
  });

  it.each([
    ['different content', { content_text: 'Different' }],
    ['different operator', { sender_id: SECOND_REQUEST_ID }],
    ['different draft', { ai_draft_id: SECOND_REQUEST_ID }],
  ])('rejects UUID reuse with %s', async (_label, storedOverride) => {
    const state = makeState();
    state.outbox.set(
      REQUEST_ID,
      existingIntent({
        outbound_state: 'accepted',
        ...storedOverride,
      })
    );
    const deps = makeDeps(state);

    await expect(
      sendMessageToConversation(makeDb(state, 'user'), 'acct-1', params(), deps)
    ).rejects.toMatchObject({
      code: 'idempotency_conflict',
      status: 409,
    });
    expect(deps.sendWahaText).not.toHaveBeenCalled();
  });

  it('atomically claims concurrent identical requests so WAHA is called once', async () => {
    const state = makeState();
    let releaseConfig!: () => void;
    const configGate = new Promise<void>((resolve) => {
      releaseConfig = resolve;
    });
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const baseDeps = makeDeps(state);
    const loadWahaRuntimeConfig = vi.fn(async () => {
      await configGate;
      return {
        settingId: 'waha-setting-1',
        config: {
          baseUrl: 'https://waha.internal',
          sessionName: 'evo-inbox',
          apiKey: wahaApiKeyFixture,
        },
        webhookHmacSecret: 'test-hmac',
        publicConfig: {},
      };
    });
    const sendWahaText = vi.fn(async () => {
      state.events.push({ client: 'provider', operation: 'send' });
      await providerGate;
      return {
        whatsappMessageId: PROVIDER_ID,
        messageStatus: 'accepted' as const,
        raw: { id: PROVIDER_ID },
      };
    });
    const deps = {
      ...baseDeps,
      loadWahaRuntimeConfig,
      sendWahaText,
    };

    const first = sendMessageToConversation(
      makeDb(state, 'user'),
      'acct-1',
      params(),
      deps
    );
    const second = sendMessageToConversation(
      makeDb(state, 'user'),
      'acct-1',
      params(),
      deps
    );
    const settledPromise = Promise.allSettled([first, second]);

    await vi.waitFor(() => {
      expect(loadWahaRuntimeConfig).toHaveBeenCalledTimes(2);
    });
    releaseConfig();
    await vi.waitFor(() => {
      expect(sendWahaText).toHaveBeenCalledTimes(1);
    });
    releaseProvider();

    const settled = await settledPromise;
    expect(sendWahaText).toHaveBeenCalledTimes(1);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1
    );
    const rejected = settled.find((item) => item.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: {
        code: 'outbound_in_progress',
        outboundState: 'dispatching',
      },
    });
    expect(state.outbox.get(REQUEST_ID)?.outbound_state).toBe('accepted');
  });

  it('does not call WAHA when the durable pre-insert fails', async () => {
    const state = makeState({
      preinsertError: { code: 'XX000', message: 'storage unavailable' },
    });
    const deps = makeDeps(state);

    await expect(
      sendMessageToConversation(makeDb(state, 'user'), 'acct-1', params(), deps)
    ).rejects.toMatchObject({
      code: 'db_error',
      status: 500,
    });
    expect(deps.loadWahaRuntimeConfig).not.toHaveBeenCalled();
    expect(deps.sendWahaText).not.toHaveBeenCalled();
    expect(state.outbox.size).toBe(0);
  });

  it('leaves a durable dispatching row and reports uncertainty when success finalization fails', async () => {
    const state = makeState({
      finalizeError: { code: 'XX000', message: 'write unavailable' },
    });
    const deps = makeDeps(state);

    await expect(
      sendMessageToConversation(makeDb(state, 'user'), 'acct-1', params(), deps)
    ).rejects.toMatchObject({
      code: 'outbound_state_unknown',
      status: 502,
      messageId: REQUEST_ID,
      outboundState: 'dispatching',
    });
    expect(deps.sendWahaText).toHaveBeenCalledTimes(1);
    expect(state.outbox.get(REQUEST_ID)).toMatchObject({
      outbound_state: 'dispatching',
      outbound_attempt_count: 1,
      status: 'sending',
    });
  });

  it('records a confirmed provider HTTP rejection without persisting raw provider text', async () => {
    const state = makeState();
    const deps = makeDeps(state, {
      sendWahaText: vi.fn(async () => {
        state.events.push({ client: 'provider', operation: 'send' });
        throw new WahaProviderError('secret upstream response', 422);
      }),
    });

    await expect(
      sendMessageToConversation(makeDb(state, 'user'), 'acct-1', params(), deps)
    ).rejects.toMatchObject({
      code: 'waha_provider_error',
      status: 502,
      outboundState: 'rejected',
    });
    const row = state.outbox.get(REQUEST_ID);
    expect(row).toMatchObject({
      outbound_state: 'rejected',
      status: 'failed',
      outbound_error_code: 'waha_provider_rejected',
      outbound_error: 'WAHA rejected sendText with HTTP 422',
      waha_message_status: 'rejected',
    });
    expect(String(row?.outbound_error)).not.toContain('secret');
  });

  it.each([408, 409, 429, 503])(
    'treats provider HTTP %s as ambiguous because WAHA may have processed it',
    async (providerStatus) => {
      const state = makeState();
      const sendWahaText = vi.fn(async () => {
        state.events.push({ client: 'provider', operation: 'send' });
        throw new WahaProviderError('secret upstream response', providerStatus);
      });
      const deps = makeDeps(state, { sendWahaText });

      await expect(
        sendMessageToConversation(
          makeDb(state, 'user'),
          'acct-1',
          params(),
          deps
        )
      ).rejects.toMatchObject({
        code: 'outbound_state_unknown',
        outboundState: 'unknown',
      });
      expect(sendWahaText).toHaveBeenCalledTimes(1);
      const row = state.outbox.get(REQUEST_ID);
      expect(row).toMatchObject({
        outbound_state: 'unknown',
        status: 'failed',
        outbound_error_code: 'waha_provider_unknown',
        outbound_error: `WAHA returned HTTP ${providerStatus}; send outcome is unknown`,
      });
      expect(String(row?.outbound_error)).not.toContain('secret');
    }
  );

  it('records a transport failure as unknown and never retries WAHA', async () => {
    const state = makeState();
    const sendWahaText = vi.fn(async () => {
      state.events.push({ client: 'provider', operation: 'send' });
      throw new TypeError('socket closed after request write');
    });
    const deps = makeDeps(state, { sendWahaText });

    await expect(
      sendMessageToConversation(makeDb(state, 'user'), 'acct-1', params(), deps)
    ).rejects.toMatchObject({
      code: 'outbound_state_unknown',
      outboundState: 'unknown',
    });
    expect(sendWahaText).toHaveBeenCalledTimes(1);
    expect(state.outbox.get(REQUEST_ID)).toMatchObject({
      outbound_state: 'unknown',
      status: 'failed',
      outbound_error_code: 'waha_transport_unknown',
      outbound_error: 'WAHA send outcome is unknown after a transport failure',
    });

    await expect(
      sendMessageToConversation(makeDb(state, 'user'), 'acct-1', params(), deps)
    ).rejects.toMatchObject({
      code: 'outbound_state_unknown',
      status: 409,
      outboundState: 'unknown',
    });
    expect(sendWahaText).toHaveBeenCalledTimes(1);
  });

  it('keeps a configuration failure queued because no provider attempt occurred', async () => {
    const state = makeState();
    const deps = makeDeps(state, {
      loadWahaRuntimeConfig: vi.fn(async () => {
        throw new WahaConfigurationError(['apiKey']);
      }),
    });

    await expect(
      sendMessageToConversation(makeDb(state, 'user'), 'acct-1', params(), deps)
    ).rejects.toMatchObject({
      code: 'waha_not_configured',
      status: 400,
      messageId: REQUEST_ID,
      outboundState: 'queued',
      missingFields: ['apiKey'],
    });
    expect(state.outbox.get(REQUEST_ID)).toMatchObject({
      outbound_state: 'queued',
      outbound_attempt_count: 0,
    });
    expect(deps.sendWahaText).not.toHaveBeenCalled();
  });

  it('does not expose a cross-account or cross-conversation draft to the outbox', async () => {
    const state = makeState({
      draft: {
        id: DRAFT_ID,
        account_id: 'other-account',
        conversation_id: 'conv-1',
      },
    });
    const deps = makeDeps(state);

    await expect(
      sendMessageToConversation(makeDb(state, 'user'), 'acct-1', params(), deps)
    ).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
    });
    expect(state.outbox.size).toBe(0);
    expect(deps.sendWahaText).not.toHaveBeenCalled();
  });

  it('logs and ignores conversation preview failure after an accepted send', async () => {
    const state = makeState({
      previewError: { code: 'XX000', message: 'preview unavailable' },
    });
    const deps = makeDeps(state);

    const result = await sendMessageToConversation(
      makeDb(state, 'user'),
      'acct-1',
      params(),
      deps
    );

    expect(result.outboundState).toBe('accepted');
    expect(deps.logPreviewFailure).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      messageId: REQUEST_ID,
    });
    expect(state.outbox.get(REQUEST_ID)?.outbound_state).toBe('accepted');
  });

  it('accepts a provider 2xx without an id but still records the terminal state', async () => {
    const state = makeState();
    const deps = makeDeps(state, {
      sendWahaText: vi.fn(async () => ({
        whatsappMessageId: '',
        messageStatus: 'accepted_without_id' as const,
        raw: {},
      })),
    });

    const result = await sendMessageToConversation(
      makeDb(state, 'user'),
      'acct-1',
      params({ requestId: SECOND_REQUEST_ID, aiDraftId: null }),
      deps
    );

    expect(result).toEqual({
      messageId: SECOND_REQUEST_ID,
      whatsappMessageId: '',
      wahaMessageStatus: 'accepted_without_id',
      outboundState: 'accepted',
    });
    expect(state.outbox.get(SECOND_REQUEST_ID)).toMatchObject({
      outbound_state: 'accepted',
      status: 'sent',
      waha_message_id: null,
      waha_message_status: 'accepted_without_id',
    });
  });

  it('rejects a missing or malformed Idempotency-Key before any database or provider work', async () => {
    const state = makeState();
    const deps = makeDeps(state);

    await expect(
      sendMessageToConversation(
        makeDb(state, 'user'),
        'acct-1',
        params({ requestId: 'not-a-uuid' }),
        deps
      )
    ).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
    });
    expect(state.events).toEqual([]);
    expect(deps.sendWahaText).not.toHaveBeenCalled();
  });
});
