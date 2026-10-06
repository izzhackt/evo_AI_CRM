import assert from "node:assert/strict";
import test from "node:test";

import {
  PlatformWahaProviderError,
  createPlatformWahaProvider,
} from "../src/lib/server/platform-waha-provider.ts";

const RUNTIME = Object.freeze({
  wahaSessionName: "crm_primary",
  wahaBaseUrl: "http://evo-crm-waha:3000",
  wahaApiKey: "provider-api-key-value",
  bindingVersion: "3",
});
const RECIPIENT = "996555000001@c.us";
const REPLY_TO = "false_996555000001@c.us_SOURCE1";
const PROVIDER_MESSAGE_ID = "false_996555000001@c.us_PROVIDER1";
const TEXT = "Здравствуйте! Готовы продолжить консультацию?";
const PROVIDER_OBSERVED_AT = "2026-09-02T12:00:02.000Z";
const ACK_OBSERVED_AT = "2026-09-02T12:00:03.000Z";

function providerMessage(overrides = {}) {
  return {
    id: PROVIDER_MESSAGE_ID,
    timestamp: Date.parse(PROVIDER_OBSERVED_AT) / 1_000,
    from: "996700000001@c.us",
    to: RECIPIENT,
    fromMe: true,
    source: "api",
    body: TEXT,
    ack: 1,
    ackName: "SERVER",
    ...overrides,
  };
}

test("manual send makes one authenticated WAHA call and returns only sanitized evidence", async () => {
  const calls = [];
  const signal = AbortSignal.abort();
  const provider = createPlatformWahaProvider(RUNTIME, {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(providerMessage()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    createTimeoutSignal(timeoutMs) {
      assert.equal(timeoutMs, 20_000);
      return signal;
    },
    now: () => new Date(ACK_OBSERVED_AT),
  });

  const result = await provider.sendText({
    recipientId: RECIPIENT,
    text: TEXT,
    replyTo: REPLY_TO,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://evo-crm-waha:3000/api/sendText");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.signal, signal);
  assert.equal(calls[0].init.headers["X-Api-Key"], RUNTIME.wahaApiKey);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    session: "crm_primary",
    chatId: RECIPIENT,
    text: TEXT,
    reply_to: REPLY_TO,
    linkPreview: false,
  });
  assert.deepEqual(result, {
    providerMessageId: PROVIDER_MESSAGE_ID,
    providerSource: "api",
    providerObservedAt: PROVIDER_OBSERVED_AT,
    ackState: "server",
    ackObservedAt: ACK_OBSERVED_AT,
  });
  assert.equal(JSON.stringify(result).includes(RUNTIME.wahaApiKey), false);
  assert.equal(Object.hasOwn(result, "recipientId"), false);
});

test("exact reconciliation reads one provider message and never sends", async () => {
  const calls = [];
  const provider = createPlatformWahaProvider(RUNTIME, {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(providerMessage({ ack: 3, ackName: "READ" })), {
        status: 200,
      });
    },
    now: () => new Date(ACK_OBSERVED_AT),
  });

  const result = await provider.getMessage({
    recipientId: RECIPIENT,
    providerMessageId: PROVIDER_MESSAGE_ID,
    expectedText: TEXT,
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "http://evo-crm-waha:3000/api/crm_primary/chats/996555000001%40c.us/messages/false_996555000001%40c.us_PROVIDER1?downloadMedia=false",
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls.some(({ init }) => init.method === "POST"), false);
  assert.deepEqual(result, {
    providerMessageId: PROVIDER_MESSAGE_ID,
    providerSource: "api",
    providerObservedAt: PROVIDER_OBSERVED_AT,
    ackState: "read",
    ackObservedAt: ACK_OBSERVED_AT,
  });
});

test("exact reconciliation rejects an app-source record without sending", async () => {
  const calls = [];
  const provider = createPlatformWahaProvider(RUNTIME, {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(providerMessage({ source: "app" })), {
        status: 200,
      });
    },
    now: () => new Date(ACK_OBSERVED_AT),
  });

  await assert.rejects(
    () => provider.getMessage({
      recipientId: RECIPIENT,
      providerMessageId: PROVIDER_MESSAGE_ID,
      expectedText: TEXT,
    }),
    (error) =>
      error instanceof PlatformWahaProviderError &&
      error.code === "provider_malformed_response" &&
      error.disposition === "unknown",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls.some(({ init }) => init.method === "POST"), false);
});

test("unknown-result reconciliation ignores an app-source collision and returns the unique API match", async () => {
  const calls = [];
  const provider = createPlatformWahaProvider(RUNTIME, {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([
        providerMessage({ id: "other-message", body: "Другой текст" }),
        providerMessage({
          id: "false_996555000001@c.us_APP_COLLISION",
          source: "app",
        }),
        providerMessage({ ack: 2, ackName: "DEVICE" }),
      ]), { status: 200 });
    },
    now: () => new Date(ACK_OBSERVED_AT),
  });

  const result = await provider.findUniqueMessage({
    recipientId: RECIPIENT,
    expectedText: TEXT,
    windowStart: "2026-09-02T12:00:00.000Z",
    windowEnd: "2026-09-02T12:00:10.000Z",
  });

  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(
    requestUrl.pathname,
    "/api/crm_primary/chats/996555000001%40c.us/messages",
  );
  assert.deepEqual(Object.fromEntries(requestUrl.searchParams), {
    limit: "100",
    downloadMedia: "false",
    "filter.timestamp.gte": "1788350400",
    "filter.timestamp.lte": "1788350410",
    "filter.fromMe": "true",
  });
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls.some(({ init }) => init.method === "POST"), false);
  assert.deepEqual(result, {
    providerMessageId: PROVIDER_MESSAGE_ID,
    providerSource: "api",
    providerObservedAt: PROVIDER_OBSERVED_AT,
    ackState: "device",
    ackObservedAt: ACK_OBSERVED_AT,
  });
});

test("WAHA failures are classified without retries or sensitive error text", async (t) => {
  const cases = [
    {
      name: "explicit 400 rejection",
      response: new Response("recipient rejected", { status: 400 }),
      code: "provider_rejected",
      disposition: "failed",
      statusCode: 400,
    },
    {
      name: "authentication rejection",
      response: new Response("bad key", { status: 401 }),
      code: "provider_authentication_failed",
      disposition: "failed",
      statusCode: 401,
    },
    {
      name: "rate-limit rejection",
      response: new Response("slow down", { status: 429 }),
      code: "provider_rate_limited",
      disposition: "failed",
      statusCode: 429,
    },
    {
      name: "ambiguous HTTP timeout",
      response: new Response("timed out", { status: 408 }),
      code: "provider_timeout",
      disposition: "unknown",
      statusCode: 408,
    },
    {
      name: "ambiguous provider outage",
      response: new Response("upstream down", { status: 503 }),
      code: "provider_unavailable",
      disposition: "unknown",
      statusCode: 503,
    },
  ];

  for (const sample of cases) {
    await t.test(sample.name, async () => {
      let calls = 0;
      const provider = createPlatformWahaProvider(RUNTIME, {
        fetch: async () => {
          calls += 1;
          return sample.response;
        },
      });
      await assert.rejects(
        () => provider.sendText({ recipientId: RECIPIENT, text: TEXT, replyTo: REPLY_TO }),
        (error) => {
          assert.equal(error instanceof PlatformWahaProviderError, true);
          assert.equal(error.code, sample.code);
          assert.equal(error.disposition, sample.disposition);
          assert.equal(error.statusCode, sample.statusCode);
          assert.equal(error.message.includes(RUNTIME.wahaApiKey), false);
          assert.equal(error.message.includes(RECIPIENT), false);
          return true;
        },
      );
      assert.equal(calls, 1);
    });
  }

  await t.test("ambiguous network failure", async () => {
    let calls = 0;
    const provider = createPlatformWahaProvider(RUNTIME, {
      fetch: async () => {
        calls += 1;
        throw new Error(`${RUNTIME.wahaApiKey}:${RECIPIENT}`);
      },
    });
    await assert.rejects(
      () => provider.sendText({ recipientId: RECIPIENT, text: TEXT, replyTo: REPLY_TO }),
      (error) => {
        assert.equal(error.code, "provider_network_failure");
        assert.equal(error.disposition, "unknown");
        assert.equal(error.message.includes(RUNTIME.wahaApiKey), false);
        assert.equal(error.message.includes(RECIPIENT), false);
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  await t.test("ambiguous abort", async () => {
    let calls = 0;
    const provider = createPlatformWahaProvider(RUNTIME, {
      fetch: async () => {
        calls += 1;
        throw new DOMException("timed out", "TimeoutError");
      },
    });
    await assert.rejects(
      () => provider.sendText({ recipientId: RECIPIENT, text: TEXT, replyTo: REPLY_TO }),
      (error) =>
        error instanceof PlatformWahaProviderError &&
        error.code === "provider_timeout" &&
        error.disposition === "unknown",
    );
    assert.equal(calls, 1);
  });
});

test("malformed send success is unknown and never exposes a fake provider acceptance", async () => {
  let calls = 0;
  const provider = createPlatformWahaProvider(RUNTIME, {
    fetch: async () => {
      calls += 1;
      return new Response(JSON.stringify(providerMessage({ body: "wrong text" })), {
        status: 200,
      });
    },
  });

  await assert.rejects(
    () => provider.sendText({ recipientId: RECIPIENT, text: TEXT, replyTo: REPLY_TO }),
    (error) =>
      error instanceof PlatformWahaProviderError &&
      error.code === "provider_malformed_response" &&
      error.disposition === "unknown",
  );
  assert.equal(calls, 1);
});

test("provider evidence with an observation timestamp before the message fails closed", async () => {
  const provider = createPlatformWahaProvider(RUNTIME, {
    fetch: async () => new Response(JSON.stringify(providerMessage()), { status: 200 }),
    now: () => new Date("2026-09-02T12:00:01.000Z"),
  });

  await assert.rejects(
    () => provider.sendText({ recipientId: RECIPIENT, text: TEXT, replyTo: REPLY_TO }),
    (error) =>
      error instanceof PlatformWahaProviderError &&
      error.code === "provider_malformed_response" &&
      error.disposition === "unknown",
  );
});

test("bounded lookup distinguishes zero matches from ambiguous matches", async (t) => {
  await t.test("app, missing, and unknown sources are zero API matches", async () => {
    const methods = [];
    const provider = createPlatformWahaProvider(RUNTIME, {
      fetch: async (_url, init) => {
        methods.push(init.method);
        return new Response(JSON.stringify([
          providerMessage({ id: "app-source", source: "app" }),
          providerMessage({ id: "missing-source", source: undefined }),
          providerMessage({ id: "unknown-source", source: "web" }),
        ]), { status: 200 });
      },
    });
    const result = await provider.findUniqueMessage({
      recipientId: RECIPIENT,
      expectedText: TEXT,
      windowStart: "2026-09-02T12:00:00.000Z",
      windowEnd: "2026-09-02T12:00:10.000Z",
    });
    assert.equal(result, null);
    assert.deepEqual(methods, ["GET"]);
  });

  await t.test("multiple exact matches", async () => {
    let calls = 0;
    const provider = createPlatformWahaProvider(RUNTIME, {
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify([
          providerMessage(),
          providerMessage({ id: "false_996555000001@c.us_PROVIDER2" }),
        ]), { status: 200 });
      },
    });
    await assert.rejects(
      () => provider.findUniqueMessage({
        recipientId: RECIPIENT,
        expectedText: TEXT,
        windowStart: "2026-09-02T12:00:00.000Z",
        windowEnd: "2026-09-02T12:00:10.000Z",
      }),
      (error) =>
        error instanceof PlatformWahaProviderError &&
        error.code === "provider_message_ambiguous" &&
        error.disposition === "unknown",
    );
    assert.equal(calls, 1);
  });
});

test("invalid Vault runtime fails before HTTP and does not echo the key", async () => {
  let calls = 0;
  const unsafeKey = "unsafe\nprovider-api-key";
  assert.throws(
    () => createPlatformWahaProvider(
      { ...RUNTIME, wahaApiKey: unsafeKey },
      {
        fetch: async () => {
          calls += 1;
          return new Response("{}");
        },
      },
    ),
    (error) => {
      assert.equal(error.code, "configuration_invalid");
      assert.equal(error.disposition, "failed");
      assert.equal(error.message.includes(unsafeKey), false);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("a reply to a conversation bound on a LID chat goes to that LID chat, and its acknowledgement reads back from it", async () => {
  const LID_RECIPIENT = "123456789012345@lid";
  const LID_REPLY_TO = "false_123456789012345@lid_SOURCE1";
  const LID_MESSAGE_ID = "false_123456789012345@lid_PROVIDER1";
  const calls = [];
  const provider = createPlatformWahaProvider(RUNTIME, {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify(
          providerMessage({ id: LID_MESSAGE_ID, to: LID_RECIPIENT }),
        ),
        { status: 200 },
      );
    },
    now: () => new Date(ACK_OBSERVED_AT),
  });

  const sent = await provider.sendText({
    recipientId: LID_RECIPIENT,
    text: TEXT,
    replyTo: LID_REPLY_TO,
  });
  assert.equal(sent.providerMessageId, LID_MESSAGE_ID);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    session: "crm_primary",
    chatId: LID_RECIPIENT,
    text: TEXT,
    reply_to: LID_REPLY_TO,
    linkPreview: false,
  });

  await provider.getMessage({
    recipientId: LID_RECIPIENT,
    providerMessageId: LID_MESSAGE_ID,
    expectedText: TEXT,
  });
  assert.match(
    calls[1].url,
    /\/api\/crm_primary\/chats\/123456789012345%40lid\/messages\//u,
  );
});

// WAHA 2026.9.2 on the GOWS engine (gows-plus v1.0.48). Synthetic ids only.
const GOWS_LID_RECIPIENT = "123456789012345@lid";
const GOWS_MESSAGE_KEY = "3EB0A1B2C3D4E5F60718";
const GOWS_MESSAGE_ID = `true_${GOWS_LID_RECIPIENT}_${GOWS_MESSAGE_KEY}`;
const GOWS_OWN_DEVICE = "996700000001:7@s.whatsapp.net";

// POST /api/sendText on GOWS: session.gows.core.ts messageResponse() answers
// only { id: `true_${toCusFormat(chat)}_${Info.ID}`, _data }, where _data is the
// GOWS events.Message JSON the send also emits as its message.any echo.
function gowsSendResponse({
  recipient = GOWS_LID_RECIPIENT,
  chat = recipient,
  key = GOWS_MESSAGE_KEY,
  text = TEXT,
  timestamp = "2026-09-02T12:00:02Z",
  info = {},
  message,
  ...overrides
} = {}) {
  const content = message ?? {
    extendedTextMessage: { text, contextInfo: { stanzaID: "SOURCE1" } },
  };
  return {
    id: `true_${recipient}_${key}`,
    _data: {
      Info: {
        Chat: chat,
        Sender: GOWS_OWN_DEVICE,
        IsFromMe: true,
        IsGroup: false,
        ID: key,
        Timestamp: timestamp,
        ServerID: 101,
        ...info,
      },
      Message: content,
      RawMessage: content,
    },
    ...overrides,
  };
}

// GOWS toWAMessage() for an own direct-chat message, as both the message.any
// echo and GET /api/{session}/chats/{chatId}/messages carry it: the chat is in
// `from` and `to` is null (getFromToParticipant).
function gowsWaMessage(overrides = {}) {
  return {
    id: GOWS_MESSAGE_ID,
    timestamp: Date.parse(PROVIDER_OBSERVED_AT) / 1_000,
    from: GOWS_LID_RECIPIENT,
    fromMe: true,
    source: "api",
    body: TEXT,
    to: null,
    participant: null,
    hasMedia: false,
    media: null,
    ack: 2,
    ackName: "DEVICE",
    replyTo: null,
    _data: {
      Info: {
        Chat: GOWS_LID_RECIPIENT,
        ID: GOWS_MESSAGE_KEY,
        IsFromMe: true,
        IsGroup: false,
      },
    },
    ...overrides,
  };
}

function gowsProvider(body, calls = [], nowValue = ACK_OBSERVED_AT) {
  return createPlatformWahaProvider(RUNTIME, {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status: 200 });
    },
    now: () => new Date(nowValue),
  });
}

test("a GOWS sendText answer to a LID chat is accepted with the id its message.any echo carries", async () => {
  const calls = [];
  const provider = gowsProvider(gowsSendResponse(), calls);

  const sent = await provider.sendText({
    recipientId: GOWS_LID_RECIPIENT,
    text: TEXT,
    replyTo: "false_123456789012345@lid_SOURCE1",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).chatId, GOWS_LID_RECIPIENT);
  assert.deepEqual(sent, {
    providerMessageId: GOWS_MESSAGE_ID,
    providerSource: "api",
    providerObservedAt: PROVIDER_OBSERVED_AT,
    ackState: "server",
    ackObservedAt: ACK_OBSERVED_AT,
  });
  // The echo's payload.id is `true_<from>_<Info.ID>`; the binding stores the
  // same id, so the echo and later ACKs resolve to the CRM's own message.
  const echo = gowsWaMessage();
  assert.equal(echo.id, `true_${echo.from}_${echo._data.Info.ID}`);
  assert.equal(sent.providerMessageId, echo.id);
});

test("a GOWS sendText answer to a phone chat maps the engine JID back to the c.us id", async () => {
  const provider = gowsProvider(
    gowsSendResponse({
      recipient: RECIPIENT,
      chat: "996555000001@s.whatsapp.net",
    }),
  );
  const sent = await provider.sendText({
    recipientId: RECIPIENT,
    text: TEXT,
    replyTo: REPLY_TO,
  });
  assert.equal(sent.providerMessageId, `true_${RECIPIENT}_${GOWS_MESSAGE_KEY}`);
});

test("a GOWS sendText answer without _data falls back to the observation time", async () => {
  const provider = gowsProvider({ id: GOWS_MESSAGE_ID, _data: null });
  const sent = await provider.sendText({
    recipientId: GOWS_LID_RECIPIENT,
    text: TEXT,
    replyTo: "false_123456789012345@lid_SOURCE1",
  });
  assert.deepEqual(sent, {
    providerMessageId: GOWS_MESSAGE_ID,
    providerSource: "api",
    providerObservedAt: ACK_OBSERVED_AT,
    ackState: "server",
    ackObservedAt: ACK_OBSERVED_AT,
  });
});

test("a contradictory GOWS sendText answer stays unknown after its single call", async (t) => {
  const cases = [
    ["missing id", { ...gowsSendResponse(), id: undefined }],
    ["id names another chat", gowsSendResponse({ recipient: "123456789012399@lid" })],
    ["id is not an own message", { ...gowsSendResponse(), id: `false_${GOWS_LID_RECIPIENT}_${GOWS_MESSAGE_KEY}` }],
    ["group-style id with a participant", gowsSendResponse({ key: `${GOWS_MESSAGE_KEY}_${GOWS_LID_RECIPIENT}` })],
    ["Info.ID differs from the id", gowsSendResponse({ info: { ID: "3EB0FFFFFFFFFFFFFFFF" } })],
    ["Info is not from me", gowsSendResponse({ info: { IsFromMe: false } })],
    ["Info is a group", gowsSendResponse({ info: { IsGroup: true } })],
    ["sent text differs", gowsSendResponse({ text: "Другой текст" })],
    ["message has no text", gowsSendResponse({ message: { imageMessage: { caption: TEXT } } })],
    ["_data is not an object", { id: GOWS_MESSAGE_ID, _data: "raw" }],
    ["timestamp is unreadable", gowsSendResponse({ timestamp: "not-a-time" })],
    ["timestamp is after the observation", gowsSendResponse({ timestamp: "2026-09-02T12:00:09Z" })],
  ];
  for (const [name, body] of cases) {
    await t.test(name, async () => {
      const calls = [];
      const provider = gowsProvider(body, calls);
      await assert.rejects(
        () => provider.sendText({
          recipientId: GOWS_LID_RECIPIENT,
          text: TEXT,
          replyTo: "false_123456789012345@lid_SOURCE1",
        }),
        (error) =>
          error instanceof PlatformWahaProviderError &&
          error.code === "provider_malformed_response" &&
          error.disposition === "unknown",
      );
      assert.equal(calls.length, 1);
    });
  }
});

test("GOWS readback finds the unknown send by its chat-in-from record and never sends", async () => {
  const calls = [];
  const provider = gowsProvider([
    gowsWaMessage({
      id: `true_${GOWS_LID_RECIPIENT}_3EB0APPSOURCE0000001`,
      source: "app",
    }),
    gowsWaMessage({
      id: `true_${GOWS_LID_RECIPIENT}_3EB0OTHERTEXT0000001`,
      body: "Другой текст",
    }),
    gowsWaMessage(),
  ], calls);

  const found = await provider.findUniqueMessage({
    recipientId: GOWS_LID_RECIPIENT,
    expectedText: TEXT,
    windowStart: "2026-09-02T12:00:00.000Z",
    windowEnd: "2026-09-02T12:00:10.000Z",
  });

  assert.deepEqual(calls.map(({ init }) => init.method), ["GET"]);
  assert.deepEqual(found, {
    providerMessageId: GOWS_MESSAGE_ID,
    providerSource: "api",
    providerObservedAt: PROVIDER_OBSERVED_AT,
    ackState: "device",
    ackObservedAt: ACK_OBSERVED_AT,
  });
});

test("GOWS readback ignores a chat-in-from record whose id names another chat", async () => {
  const provider = gowsProvider([
    gowsWaMessage({ id: `true_123456789012399@lid_${GOWS_MESSAGE_KEY}` }),
    gowsWaMessage({ from: "123456789012399@lid" }),
  ]);
  const found = await provider.findUniqueMessage({
    recipientId: GOWS_LID_RECIPIENT,
    expectedText: TEXT,
    windowStart: "2026-09-02T12:00:00.000Z",
    windowEnd: "2026-09-02T12:00:10.000Z",
  });
  assert.equal(found, null);
});

test("GOWS ACK readback reads the exact chat-in-from record", async () => {
  const calls = [];
  const provider = gowsProvider(gowsWaMessage({ ack: 3, ackName: "READ" }), calls);
  const read = await provider.getMessage({
    recipientId: GOWS_LID_RECIPIENT,
    providerMessageId: GOWS_MESSAGE_ID,
    expectedText: TEXT,
  });
  assert.deepEqual(calls.map(({ init }) => init.method), ["GET"]);
  assert.equal(read.providerMessageId, GOWS_MESSAGE_ID);
  assert.equal(read.ackState, "read");

  await assert.rejects(
    () => gowsProvider(gowsWaMessage({ from: "123456789012399@lid" })).getMessage({
      recipientId: GOWS_LID_RECIPIENT,
      providerMessageId: GOWS_MESSAGE_ID,
      expectedText: TEXT,
    }),
    (error) =>
      error instanceof PlatformWahaProviderError &&
      error.code === "provider_malformed_response",
  );
});

const GOWS_LID_REPLY_TO = `false_${GOWS_LID_RECIPIENT}_SOURCE1`;

function rejectsAsUnknownMalformed(promise) {
  return assert.rejects(
    promise,
    (error) =>
      error instanceof PlatformWahaProviderError &&
      error.code === "provider_malformed_response" &&
      error.disposition === "unknown",
  );
}

test("sendText asks WAHA for no link preview, so a reply with a URL never waits on the linked page", async () => {
  const calls = [];
  const text = "Анкета и список документов: https://evoadmissions.com/apply?ref=crm";
  const provider = gowsProvider(gowsSendResponse({ text }), calls);

  const sent = await provider.sendText({
    recipientId: GOWS_LID_RECIPIENT,
    text,
    replyTo: GOWS_LID_REPLY_TO,
  });

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.linkPreview, false);
  assert.equal(Object.hasOwn(body, "linkPreviewHighQuality"), false);
  assert.equal(sent.providerMessageId, GOWS_MESSAGE_ID);
});

test("sendText waits up to the send ceiling and read-only lookups keep the shorter one", async () => {
  const timeouts = [];
  const bodies = [gowsSendResponse(), gowsWaMessage(), [gowsWaMessage()]];
  const provider = createPlatformWahaProvider(RUNTIME, {
    fetch: async () => new Response(JSON.stringify(bodies.shift()), { status: 200 }),
    createTimeoutSignal(timeoutMs) {
      timeouts.push(timeoutMs);
      return new AbortController().signal;
    },
    now: () => new Date(ACK_OBSERVED_AT),
  });

  await provider.sendText({
    recipientId: GOWS_LID_RECIPIENT,
    text: TEXT,
    replyTo: GOWS_LID_REPLY_TO,
  });
  await provider.getMessage({
    recipientId: GOWS_LID_RECIPIENT,
    providerMessageId: GOWS_MESSAGE_ID,
    expectedText: TEXT,
  });
  await provider.findUniqueMessage({
    recipientId: GOWS_LID_RECIPIENT,
    expectedText: TEXT,
    windowStart: "2026-09-02T12:00:00.000Z",
    windowEnd: "2026-09-02T12:00:10.000Z",
  });

  assert.deepEqual(timeouts, [20_000, 10_000, 10_000]);
});

test("a sendText that outlives the send ceiling stays unknown after its single call", async () => {
  let calls = 0;
  const provider = createPlatformWahaProvider(RUNTIME, {
    fetch: async () => {
      calls += 1;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    },
    now: () => new Date(ACK_OBSERVED_AT),
  });
  await assert.rejects(
    () => provider.sendText({
      recipientId: GOWS_LID_RECIPIENT,
      text: TEXT,
      replyTo: GOWS_LID_REPLY_TO,
    }),
    (error) =>
      error instanceof PlatformWahaProviderError &&
      error.code === "provider_timeout" &&
      error.disposition === "unknown",
  );
  assert.equal(calls, 1);
});

test("a GOWS sendText answer for a maximum-length reply is accepted although _data carries it twice", async () => {
  // Worst ordinary escaping: every character is a quote, so each JSON copy of
  // the 64 KiB text is 128 KiB. The quoted source message is copied twice too.
  const text = '"'.repeat(64 * 1_024);
  const quoted = { conversation: "Здравствуйте, расскажите про поступление. ".repeat(400) };
  const content = {
    extendedTextMessage: {
      text,
      contextInfo: { stanzaID: "SOURCE1", quotedMessage: quoted },
    },
  };
  const body = gowsSendResponse({ text, message: content });
  const encoded = JSON.stringify(body);
  assert.ok(Buffer.byteLength(encoded, "utf8") > 256 * 1_024);
  assert.ok(Buffer.byteLength(encoded, "utf8") < 1_024 * 1_024);

  const calls = [];
  const provider = createPlatformWahaProvider(RUNTIME, {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(encoded, {
        status: 200,
        headers: { "content-length": String(Buffer.byteLength(encoded, "utf8")) },
      });
    },
    now: () => new Date(ACK_OBSERVED_AT),
  });
  const sent = await provider.sendText({
    recipientId: GOWS_LID_RECIPIENT,
    text,
    replyTo: GOWS_LID_REPLY_TO,
  });
  assert.equal(calls.length, 1);
  assert.equal(sent.providerMessageId, GOWS_MESSAGE_ID);
  assert.equal(sent.ackState, "server");
});

test("a WAHA answer above the 1 MiB bound stays unknown, with or without a content-length", async (t) => {
  const oversized = JSON.stringify({
    ...gowsSendResponse(),
    padding: "x".repeat(1_024 * 1_024),
  });
  const cases = [
    ["declared length above the bound", () => new Response("{}", {
      status: 200,
      headers: { "content-length": String(1_024 * 1_024 + 1) },
    })],
    ["undeclared body above the bound", () => new Response(oversized, { status: 200 })],
  ];
  for (const [name, respond] of cases) {
    await t.test(name, async () => {
      let calls = 0;
      const provider = createPlatformWahaProvider(RUNTIME, {
        fetch: async () => {
          calls += 1;
          return respond();
        },
        now: () => new Date(ACK_OBSERVED_AT),
      });
      await rejectsAsUnknownMalformed(provider.sendText({
        recipientId: GOWS_LID_RECIPIENT,
        text: TEXT,
        replyTo: GOWS_LID_REPLY_TO,
      }));
      assert.equal(calls, 1);
    });
  }
});

test("a GOWS sendText answer is accepted when Info.Chat is the recipient in engine JID form", async (t) => {
  const cases = [
    ["LID chat", GOWS_LID_RECIPIENT, GOWS_LID_RECIPIENT],
    ["LID chat with a device", GOWS_LID_RECIPIENT, "123456789012345:12@lid"],
    ["phone chat", RECIPIENT, "996555000001@s.whatsapp.net"],
    ["phone chat with a device", RECIPIENT, "996555000001:3@s.whatsapp.net"],
    ["phone chat in API form", RECIPIENT, RECIPIENT],
  ];
  for (const [name, recipient, chat] of cases) {
    await t.test(name, async () => {
      const provider = gowsProvider(gowsSendResponse({ recipient, chat }));
      const sent = await provider.sendText({
        recipientId: recipient,
        text: TEXT,
        replyTo: `false_${recipient}_SOURCE1`,
      });
      assert.equal(sent.providerMessageId, `true_${recipient}_${GOWS_MESSAGE_KEY}`);
    });
  }
});

test("a GOWS sendText answer whose Info.Chat names another chat stays unknown", async (t) => {
  const cases = [
    ["another LID chat", "123456789012399@lid"],
    ["the same digits on the phone server", "123456789012345@s.whatsapp.net"],
    ["a group", "120363000000000001@g.us"],
    ["a broadcast", "status@broadcast"],
    ["an empty JID", ""],
    ["a non-string JID", 123456789012345],
    ["no Chat at all", undefined],
  ];
  for (const [name, chat] of cases) {
    await t.test(name, async () => {
      const calls = [];
      const body = gowsSendResponse();
      if (chat === undefined) delete body._data.Info.Chat;
      else body._data.Info.Chat = chat;
      const provider = gowsProvider(body, calls);
      await rejectsAsUnknownMalformed(provider.sendText({
        recipientId: GOWS_LID_RECIPIENT,
        text: TEXT,
        replyTo: GOWS_LID_REPLY_TO,
      }));
      assert.equal(calls.length, 1);
    });
  }
});
