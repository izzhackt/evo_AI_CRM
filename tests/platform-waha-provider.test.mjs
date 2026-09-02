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
      assert.equal(timeoutMs, 10_000);
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
