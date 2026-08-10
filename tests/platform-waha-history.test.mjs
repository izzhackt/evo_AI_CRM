import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createPlatformWahaHistoryClient,
  PLATFORM_WAHA_HISTORY_MEDIA_MARKER,
  PlatformWahaHistoryProviderError,
} from "../src/lib/server/platform-waha-history-client.ts";
import {
  loadPlatformWahaHistoryConfig,
  PlatformWahaHistoryConfigurationError,
} from "../src/lib/server/platform-waha-history-config.ts";
import {
  createPlatformWahaHistoryHandler,
  createPlatformWahaHistoryRepository,
} from "../src/lib/server/platform-waha-history-processor.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const NOW_MS = 1_786_079_400_000;
const TRIGGER_SECRET = "synthetic-history-trigger-secret-value";
const WAHA_API_KEY = "synthetic-waha-api-key-value-only";
const SUPABASE_SECRET = ["sb", "secret", "synthetic_server_test_key_only"].join("_");
const HISTORY_URL =
  "http://localhost/api/internal/platform-messaging/waha/history";
const CHAT_ID = "996555123456@c.us";
const RAW_MESSAGE_ID = "false_996555123456@c.us_SYNTHETIC";

const ENABLED_CONFIG = Object.freeze({
  enabled: true,
  organizationId: ORGANIZATION_ID,
  supabaseUrl: "http://127.0.0.1:54321",
  supabaseSecretKey: SUPABASE_SECRET,
  sessionName: "evo-inbox",
  intakeSalesMembershipId: MEMBERSHIP_ID,
  wahaBaseUrl: "http://evo-inbox-waha:3000",
  wahaApiKey: WAHA_API_KEY,
  triggerSecret: TRIGGER_SECRET,
  workerRef: "nextjs:p5c-waha-history",
  chatPageLimit: 25,
  messagePageLimit: 50,
  maxProviderPages: 25,
  maxRuntimeMs: 30_000,
  requestTimeoutMs: 5_000,
});

function enabledEnvironment(overrides = {}) {
  return {
    EVO_PLATFORM_WAHA_HISTORY_ENABLED: "true",
    EVO_PLATFORM_WAHA_INGRESS_ENABLED: "false",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET,
    EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET:
      "synthetic-webhook-hmac-secret-value",
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: MEMBERSHIP_ID,
    EVO_PLATFORM_WAHA_HISTORY_BASE_URL: "http://evo-inbox-waha:3000",
    EVO_PLATFORM_WAHA_HISTORY_API_KEY: WAHA_API_KEY,
    EVO_PLATFORM_WAHA_HISTORY_TRIGGER_SECRET: TRIGGER_SECRET,
    ...overrides,
  };
}

function configurationError(environment, code) {
  assert.throws(
    () => loadPlatformWahaHistoryConfig(environment),
    (error) =>
      error instanceof PlatformWahaHistoryConfigurationError &&
      error.code === code,
  );
}

function authorizedRequest(options = {}) {
  const requestId = options.requestId ?? REQUEST_ID;
  const timestamp = String(options.timestamp ?? NOW_MS);
  const headers = new Headers(options.headers);
  headers.set("x-evo-history-request-id", requestId);
  headers.set("x-evo-history-timestamp", timestamp);
  headers.set("x-evo-history-hmac-algorithm", "sha256");
  headers.set(
    "x-evo-history-hmac",
    createHmac("sha256", options.signingKey ?? TRIGGER_SECRET)
      .update(`${requestId}.${timestamp}`)
      .digest("hex"),
  );
  return new Request(HISTORY_URL, {
    method: options.method ?? "POST",
    headers,
    body: options.body,
  });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function historyMessage(overrides = {}) {
  return Object.freeze({
    rawMessageId: RAW_MESSAGE_ID,
    direction: "inbound",
    occurredAt: "2026-08-09T10:00:00.000Z",
    bodyText: "Здравствуйте",
    hasMedia: false,
    ...overrides,
  });
}

function memoryRepository(options = {}) {
  const calls = [];
  let total = 0;
  return {
    calls,
    async begin(input) {
      calls.push(["begin", input]);
      if (options.beginError) throw new Error("synthetic");
      return Object.freeze({
        organizationId: ORGANIZATION_ID,
        runId: RUN_ID,
        state: "running",
        chatOffset: options.chatOffset ?? 0,
        messageOffset: options.messageOffset ?? 0,
      });
    },
    async projectPage(input) {
      calls.push(["projectPage", input]);
      if (options.projectError) throw new Error("synthetic");
      total += input.messages.length;
      return Object.freeze({
        organizationId: ORGANIZATION_ID,
        runId: RUN_ID,
        state: "running",
        projectedCount: input.messages.length,
        chatOffset: input.nextChatOffset,
        messageOffset: input.nextMessageOffset,
      });
    },
    async finish(input) {
      calls.push(["finish", input]);
      if (options.finishError) throw new Error("synthetic");
      const lastProject = calls.findLast(([name]) => name === "projectPage");
      return Object.freeze({
        organizationId: ORGANIZATION_ID,
        runId: RUN_ID,
        state: input.outcome,
        projectedCount: total,
        chatOffset: lastProject?.[1].nextChatOffset ?? options.chatOffset ?? 0,
        messageOffset: lastProject?.[1].nextMessageOffset ?? options.messageOffset ?? 0,
      });
    },
  };
}

test("history config is disabled by default without reading provider secrets", () => {
  assert.deepEqual(loadPlatformWahaHistoryConfig({}), { enabled: false });
});

test("history config derives exact tenant/session and accepts only safe provider origins", () => {
  const config = loadPlatformWahaHistoryConfig(enabledEnvironment());
  assert.equal(config.enabled, true);
  assert.equal(config.organizationId, ORGANIZATION_ID);
  assert.equal(config.sessionName, "evo-inbox");
  assert.equal(config.wahaBaseUrl, "http://evo-inbox-waha:3000");

  for (const url of [
    "https://waha.internal",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://10.0.0.5:3000",
    "http://172.16.0.5:3000",
    "http://192.168.1.5:3000",
    "http://waha.internal:3000",
  ]) {
    assert.equal(
      loadPlatformWahaHistoryConfig(
        enabledEnvironment({ EVO_PLATFORM_WAHA_HISTORY_BASE_URL: url }),
      ).enabled,
      true,
    );
  }
});

test("history config fails closed for unsafe flags, tenant, UUID, URL and secrets", () => {
  configurationError(
    enabledEnvironment({ EVO_PLATFORM_WAHA_HISTORY_ENABLED: "yes" }),
    "invalid_enabled_flag",
  );
  assert.equal(
    loadPlatformWahaHistoryConfig(
      enabledEnvironment({ EVO_PLATFORM_WAHA_INGRESS_ENABLED: "false" }),
    ).enabled,
    true,
  );
  configurationError(
    enabledEnvironment({
      EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID:
        "00000000-0000-0000-0000-000000000000",
    }),
    "invalid_sales_membership_id",
  );
  for (const url of [
    "http://example.com:3000",
    "https://example.com:3000",
    "https://169.254.169.254/latest",
    "ftp://waha.internal",
    "https://user:password@waha.example",
    "https://waha.example/api",
    "https://waha.example?key=value",
    "https://waha.example#fragment",
    "http://169.254.169.254/latest",
    "http://0.0.0.0:3000",
  ]) {
    configurationError(
      enabledEnvironment({ EVO_PLATFORM_WAHA_HISTORY_BASE_URL: url }),
      "unsafe_waha_base_url",
    );
  }
  configurationError(
    enabledEnvironment({ EVO_PLATFORM_WAHA_HISTORY_API_KEY: "short" }),
    "unsafe_waha_api_key",
  );
  configurationError(
    enabledEnvironment({ EVO_PLATFORM_WAHA_HISTORY_TRIGGER_SECRET: " short" }),
    "unsafe_trigger_secret",
  );
});

test("WAHA preflight accepts nested WEBJS and explicit NOWEB store only", async () => {
  for (const session of [
    {
      name: "evo-inbox",
      status: "WORKING",
      engine: { engine: "WEBJS" },
      config: {},
    },
    {
      name: "evo-inbox",
      status: "WORKING",
      engine: { engine: "NOWEB" },
      config: { noweb: { store: { enabled: true } } },
    },
  ]) {
    const client = createPlatformWahaHistoryClient(ENABLED_CONFIG, {
      fetch: async () => jsonResponse(session),
    });
    assert.equal((await client.preflight()).engine, session.engine.engine);
  }

  for (const session of [
    { name: "other", status: "WORKING", engine: { engine: "WEBJS" } },
    { name: "evo-inbox", status: "FAILED", engine: { engine: "WEBJS" } },
    { name: "evo-inbox", status: "WORKING", engine: "WEBJS" },
    { name: "evo-inbox", status: "WORKING", engine: { engine: "WPP" } },
    {
      name: "evo-inbox",
      status: "WORKING",
      engine: { engine: "NOWEB" },
      config: { noweb: { store: { enabled: false } } },
    },
  ]) {
    const client = createPlatformWahaHistoryClient(ENABLED_CONFIG, {
      fetch: async () => jsonResponse(session),
    });
    await assert.rejects(
      () => client.preflight(),
      PlatformWahaHistoryProviderError,
    );
  }
});

test("WAHA client uses GET-only paginated direct-chat history and no media download", async () => {
  const requests = [];
  const client = createPlatformWahaHistoryClient(ENABLED_CONFIG, {
    async fetch(url, init) {
      requests.push([String(url), init]);
      const pathname = new URL(url).pathname;
      if (pathname.endsWith("/chats")) {
        return jsonResponse([
          { id: "996555123456@c.us" },
          { id: "120000000000@g.us" },
          { id: "status@broadcast" },
          { id: "12345@newsletter" },
        ]);
      }
      return jsonResponse([
        {
          id: RAW_MESSAGE_ID,
          timestamp: 1_786_079_400,
          fromMe: false,
          body: "Здравствуйте",
          hasMedia: false,
        },
        {
          id: "true_996555123456@c.us_SYNTHETIC2",
          timestamp: 1_786_079_401,
          fromMe: true,
          body: "",
          hasMedia: true,
        },
      ]);
    },
  });

  const chats = await client.listChats({ offset: 25, limit: 25 });
  assert.deepEqual(chats.chats, [
    { rawChatId: CHAT_ID, sourceOffset: 25 },
  ]);
  const messages = await client.listMessages({
    rawChatId: CHAT_ID,
    offset: 50,
    limit: 50,
  });
  assert.deepEqual(
    messages.messages.map(({ direction, bodyText, hasMedia }) => ({
      direction,
      bodyText,
      hasMedia,
    })),
    [
      { direction: "inbound", bodyText: "Здравствуйте", hasMedia: false },
      {
        direction: "outbound",
        bodyText: PLATFORM_WAHA_HISTORY_MEDIA_MARKER,
        hasMedia: true,
      },
    ],
  );
  assert.match(requests[0][0], /limit=25&offset=25&sortBy=id&sortOrder=asc$/);
  assert.match(requests[1][0], /limit=50&offset=50&downloadMedia=false$/);
  for (const [url, init] of requests) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers["X-Api-Key"], WAHA_API_KEY);
    assert.doesNotMatch(url, /send|read|restart|logout/i);
  }
});

test("WAHA client rejects malformed and ambiguous provider payloads", async () => {
  for (const payload of [
    { messages: [] },
    [{ id: CHAT_ID }, { id: 123 }],
    [{ id: "bad id" }],
  ]) {
    const client = createPlatformWahaHistoryClient(ENABLED_CONFIG, {
      fetch: async () => jsonResponse(payload),
    });
    await assert.rejects(
      () => client.listChats({ offset: 0, limit: 25 }),
      PlatformWahaHistoryProviderError,
    );
  }

  for (const payload of [
    [{ id: RAW_MESSAGE_ID, timestamp: 1_786_079_400, body: "x" }],
    [{ id: RAW_MESSAGE_ID, timestamp: "bad", fromMe: false, body: "x" }],
    [
      { id: RAW_MESSAGE_ID, timestamp: 1_786_079_400, fromMe: false, body: "x" },
      { id: RAW_MESSAGE_ID, timestamp: 1_786_079_401, fromMe: true, body: "y" },
    ],
    [
      {
        id: RAW_MESSAGE_ID,
        timestamp: 1_786_079_400,
        fromMe: false,
        body: "  ",
        hasMedia: false,
      },
    ],
  ]) {
    const client = createPlatformWahaHistoryClient(ENABLED_CONFIG, {
      fetch: async () => jsonResponse(payload),
    });
    await assert.rejects(
      () => client.listMessages({ rawChatId: CHAT_ID, offset: 0, limit: 50 }),
      PlatformWahaHistoryProviderError,
    );
  }
});

test("history handler is disabled and HMAC-authenticated before provider work", async () => {
  let calls = 0;
  const client = { preflight: async () => { calls += 1; } };
  const disabled = await createPlatformWahaHistoryHandler({
    config: { enabled: false },
    client,
  })(authorizedRequest());
  assert.equal(disabled.status, 503);
  assert.deepEqual(await disabled.json(), { ok: false, error: "history_disabled" });

  for (const request of [
    authorizedRequest({ signingKey: "wrong-history-trigger-key-value" }),
    authorizedRequest({ timestamp: NOW_MS - 5 * 60 * 1000 - 1 }),
    new Request(HISTORY_URL, { method: "POST" }),
  ]) {
    const response = await createPlatformWahaHistoryHandler({
      config: ENABLED_CONFIG,
      client,
      nowMs: () => NOW_MS,
    })(request);
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
});

test("history handler paginates both directions and returns no raw provider identifiers", async () => {
  const chatOffsets = [];
  const messageOffsets = [];
  const repository = memoryRepository();
  const client = {
    async preflight() {
      return { name: "evo-inbox", status: "WORKING", engine: "WEBJS" };
    },
    async listChats(input) {
      chatOffsets.push(input.offset);
      if (input.offset === 25) {
        return { chats: [], receivedCount: 0, hasMore: false };
      }
      assert.equal(input.offset, 0);
      return {
        chats: [{ rawChatId: CHAT_ID, sourceOffset: 0 }],
        receivedCount: 1,
        hasMore: true,
      };
    },
    async listMessages(input) {
      messageOffsets.push(input.offset);
      if (input.offset === 0) {
        return {
          messages: [
            historyMessage(),
            historyMessage({
              rawMessageId: "true_996555123456@c.us_SYNTHETIC2",
              direction: "outbound",
            }),
          ],
          receivedCount: 2,
          hasMore: true,
        };
      }
      if (input.offset === 100) {
        return { messages: [], receivedCount: 0, hasMore: false };
      }
      return {
        messages: [
          historyMessage({ rawMessageId: "false_996555123456@c.us_SYNTHETIC3" }),
        ],
        receivedCount: 1,
        hasMore: true,
      };
    },
  };
  const response = await createPlatformWahaHistoryHandler({
    config: ENABLED_CONFIG,
    client,
    repository,
    nowMs: () => NOW_MS,
  })(authorizedRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(chatOffsets, [0, 25]);
  assert.deepEqual(messageOffsets, [0, 50, 100]);
  const responseText = await response.text();
  assert.deepEqual(JSON.parse(responseText), {
    ok: true,
    state: "completed",
    projected: 3,
  });
  assert.doesNotMatch(responseText, /996555|SYNTHETIC|@c\.us/);
  const projects = repository.calls.filter(([name]) => name === "projectPage");
  assert.deepEqual(
    projects.map(([, input]) => [
      input.nextChatOffset,
      input.nextMessageOffset,
      input.messages.map((message) => message.direction),
    ]),
    [
      [0, 50, ["inbound", "outbound"]],
      [0, 100, ["inbound"]],
      [1, 0, []],
      [25, 0, []],
    ],
  );
});

test("history handler resumes the durable message offset returned by begin", async () => {
  const repository = memoryRepository({ messageOffset: 50 });
  const chatOffsets = [];
  const offsets = [];
  const response = await createPlatformWahaHistoryHandler({
    config: ENABLED_CONFIG,
    repository,
    nowMs: () => NOW_MS,
    client: {
      async preflight() {
        return { name: "evo-inbox", status: "WORKING", engine: "WEBJS" };
      },
      async listChats(input) {
        chatOffsets.push(input.offset);
        if (input.offset === 25) {
          return { chats: [], receivedCount: 0, hasMore: false };
        }
        return {
          chats: [{ rawChatId: CHAT_ID, sourceOffset: 0 }],
          receivedCount: 1,
          hasMore: true,
        };
      },
      async listMessages(input) {
        offsets.push(input.offset);
        return { messages: [], receivedCount: 0, hasMore: false };
      },
    },
  })(authorizedRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(chatOffsets, [0, 25]);
  assert.deepEqual(offsets, [50]);
  assert.equal(repository.calls.at(-1)[1].outcome, "completed");
});

test("history handler checkpoints rejected-only chat pages without retaining raw IDs", async () => {
  const repository = memoryRepository();
  let page = 0;
  const response = await createPlatformWahaHistoryHandler({
    config: ENABLED_CONFIG,
    repository,
    nowMs: () => NOW_MS,
    client: {
      async preflight() {
        return { name: "evo-inbox", status: "WORKING", engine: "WEBJS" };
      },
      async listChats() {
        page += 1;
        return page === 1
          ? { chats: [], receivedCount: 3, hasMore: true }
          : { chats: [], receivedCount: 0, hasMore: false };
      },
      async listMessages() {
        throw new Error("must not fetch rejected chat history");
      },
    },
  })(authorizedRequest());
  assert.equal(response.status, 200);
  const project = repository.calls.find(([name]) => name === "projectPage")[1];
  assert.equal(project.rawChatId, null);
  assert.deepEqual(project.messages, []);
  assert.equal(project.nextChatOffset, 25);
});

test("history handler pauses at its provider-page budget", async () => {
  const repository = memoryRepository();
  const response = await createPlatformWahaHistoryHandler({
    config: { ...ENABLED_CONFIG, maxProviderPages: 2 },
    repository,
    nowMs: () => NOW_MS,
    client: {
      async preflight() {
        return { name: "evo-inbox", status: "WORKING", engine: "WEBJS" };
      },
      async listChats() {
        return {
          chats: [{ rawChatId: CHAT_ID, sourceOffset: 0 }],
          receivedCount: 1,
          hasMore: true,
        };
      },
      async listMessages() {
        throw new Error("budget must stop before message fetch");
      },
    },
  })(authorizedRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, "paused");
  assert.deepEqual(repository.calls.map(([name]) => name), ["begin", "finish"]);
});

test("provider or repository failure leaves the durable run unfinished and resumable", async () => {
  for (const scenario of ["provider", "repository"]) {
    const repository = memoryRepository({ projectError: scenario === "repository" });
    const response = await createPlatformWahaHistoryHandler({
      config: ENABLED_CONFIG,
      repository,
      nowMs: () => NOW_MS,
      client: {
        async preflight() {
          return { name: "evo-inbox", status: "WORKING", engine: "WEBJS" };
        },
        async listChats() {
          if (scenario === "provider") throw new Error("synthetic");
          return {
            chats: [{ rawChatId: CHAT_ID, sourceOffset: 0 }],
            receivedCount: 1,
            hasMore: false,
          };
        },
        async listMessages() {
          return {
            messages: [historyMessage()],
            receivedCount: 1,
            hasMore: false,
          };
        },
      },
    })(authorizedRequest());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "history_unavailable",
    });
    assert.equal(repository.calls.some(([name]) => name === "finish"), false);
  }
});

test("history handler rejects bodies and non-POST methods before provider work", async () => {
  let calls = 0;
  const client = { preflight: async () => { calls += 1; } };
  for (const request of [
    authorizedRequest({ body: "{}" }),
    authorizedRequest({ method: "PUT" }),
  ]) {
    const response = await createPlatformWahaHistoryHandler({
      config: ENABLED_CONFIG,
      client,
      nowMs: () => NOW_MS,
    })(request);
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});

test("Supabase repository uses only the three history RPCs and private raw payload", async () => {
  const calls = [];
  const client = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, parameters) {
          calls.push([name, parameters]);
          if (name === "begin_waha_history_reconciliation") {
            return {
              error: null,
              data: {
                organization_id: ORGANIZATION_ID,
                run_id: RUN_ID,
                state: "running",
                chat_offset: 0,
                message_offset: 0,
              },
            };
          }
          if (name === "project_waha_history_page") {
            return {
              error: null,
              data: {
                organization_id: ORGANIZATION_ID,
                run_id: RUN_ID,
                state: "running",
                projected_count: 1,
                chat_offset: 1,
                message_offset: 0,
              },
            };
          }
          return {
            error: null,
            data: {
              organization_id: ORGANIZATION_ID,
              run_id: RUN_ID,
              state: "completed",
              projected_count: 1,
              chat_offset: 1,
              message_offset: 0,
            },
          };
        },
      };
    },
  };
  const repository = createPlatformWahaHistoryRepository(client);
  await repository.begin({
    organizationId: ORGANIZATION_ID,
    sessionName: "evo-inbox",
    engine: "WEBJS",
    intakeSalesMembershipId: MEMBERSHIP_ID,
    requestId: REQUEST_ID,
  });
  await repository.projectPage({
    organizationId: ORGANIZATION_ID,
    runId: RUN_ID,
    sessionName: "evo-inbox",
    rawChatId: CHAT_ID,
    messages: [historyMessage()],
    nextChatOffset: 1,
    nextMessageOffset: 0,
    requestId: REQUEST_ID,
  });
  await repository.finish({
    organizationId: ORGANIZATION_ID,
    runId: RUN_ID,
    outcome: "completed",
    requestId: REQUEST_ID,
  });
  assert.deepEqual(calls.map(([name]) => name), [
    "begin_waha_history_reconciliation",
    "project_waha_history_page",
    "finish_waha_history_reconciliation",
  ]);
  assert.deepEqual(calls[1][1].p_messages, [
    {
      raw_message_id: RAW_MESSAGE_ID,
      direction: "inbound",
      occurred_at: "2026-08-09T10:00:00.000Z",
      body_text: "Здравствуйте",
      has_media: false,
    },
  ]);
});

test("history transport source contains no WAHA write endpoint or write method", async () => {
  const [clientSource, routeSource, proxySource] = await Promise.all([
    readFile("src/lib/server/platform-waha-history-client.ts", "utf8"),
    readFile(
      "src/app/api/internal/platform-messaging/waha/history/route.ts",
      "utf8",
    ),
    readFile("src/proxy.ts", "utf8"),
  ]);
  assert.doesNotMatch(clientSource, /\/send|\/read|\/restart|\/logout|\/stop|\/start/i);
  assert.doesNotMatch(clientSource, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  assert.match(routeSource, /export const POST = createPlatformWahaHistoryHandler\(\)/);
  assert.doesNotMatch(routeSource, /export const (?:PUT|PATCH|DELETE)/);
  assert.match(
    proxySource,
    /\/api\/internal\/platform-messaging\/waha\/history/,
  );
});

test("history audit actions satisfy the Platform dotted-action contract", async () => {
  const migrationSource = await readFile(
    "supabase/migrations/061_platform_waha_history_reconciliation.sql",
    "utf8",
  );
  for (const action of ["begin", "project", "complete", "pause"]) {
    assert.match(
      migrationSource,
      new RegExp(`'communication\\.waha\\.history\\.${action}'`),
    );
  }
  assert.doesNotMatch(
    migrationSource,
    /'communication\.waha\.history\.[^']*_[^']*'/,
  );
});

test("the isolated browser build admits the P5C partition", async () => {
  const [nextConfigSource, resetHarnessSource] = await Promise.all([
    readFile("next.config.ts", "utf8"),
    readFile("scripts/test-supabase-local-reset.sh", "utf8"),
  ]);
  assert.match(
    nextConfigSource,
    /new Set\(\[\s*"provider",\s*"p5b",\s*"p5c",\s*"p5d",\s*"p5e",\s*"p5f1",\s*"remaining",?\s*\]\)/,
  );
  assert.match(
    resetHarnessSource,
    /provider\|p5b\|p5c\|p5d\|p5e\|p5f1\|remaining/,
  );
});
