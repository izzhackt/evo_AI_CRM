import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_WAHA_PROVIDER_TIMEOUT_MS,
  CanonicalWahaProviderConfigurationError,
  CanonicalWahaProviderError,
  getCanonicalWahaMessage,
  loadCanonicalWahaProviderConfig,
  probeCanonicalWahaSession,
  readCanonicalWahaProviderAvailability,
  sendCanonicalWahaText,
} from "../src/lib/server/canonical-waha-provider.ts";

const WAHA_API_KEY = "technical-waha-key-not-a-real-secret";

function configuredEnvironment(overrides = {}) {
  return {
    EVO_V2_WAHA_ENABLED: "1",
    EVO_V2_WAHA_PROVIDER_AUTHORIZED: "1",
    EVO_V2_WAHA_BASE_URL: "http://evo-inbox-waha:3000",
    EVO_V2_WAHA_API_KEY: WAHA_API_KEY,
    EVO_V2_WAHA_SESSION_NAME: "evo-inbox",
    ...overrides,
  };
}

function expectConfigurationError(environment, code) {
  assert.throws(
    () => loadCanonicalWahaProviderConfig(environment),
    (error) =>
      error instanceof CanonicalWahaProviderConfigurationError &&
      error.code === code,
  );
}

test("WAHA provider has one fail-closed server configuration and no preflight flag alias", () => {
  assert.deepEqual(readCanonicalWahaProviderAvailability({}), {
    status: "blocked",
    reason: "feature_disabled",
  });

  assert.deepEqual(
    readCanonicalWahaProviderAvailability({
      ...configuredEnvironment(),
      EVO_V2_WAHA_ENABLED: undefined,
      EVO_V2_WAHA_PREFLIGHT_ENABLED: "1",
    }),
    { status: "blocked", reason: "feature_disabled" },
  );

  assert.deepEqual(
    readCanonicalWahaProviderAvailability(
      configuredEnvironment({ EVO_V2_WAHA_PROVIDER_AUTHORIZED: "0" }),
    ),
    { status: "blocked", reason: "provider_not_authorized" },
  );

  const availability = readCanonicalWahaProviderAvailability(
    configuredEnvironment(),
  );
  assert.deepEqual(availability, {
    status: "configured",
  });
  assert.equal(JSON.stringify(availability).includes(WAHA_API_KEY), false);

  const ready = loadCanonicalWahaProviderConfig(configuredEnvironment());
  assert.equal(ready.status, "ready");
  assert.equal(ready.baseUrl, "http://evo-inbox-waha:3000");
  assert.equal(ready.sessionName, "evo-inbox");
  assert.equal(ready.timeoutMs, CANONICAL_WAHA_PROVIDER_TIMEOUT_MS);

  expectConfigurationError(
    configuredEnvironment({ EVO_V2_WAHA_ENABLED: "true" }),
    "invalid_enabled_flag",
  );
  expectConfigurationError(
    configuredEnvironment({ EVO_V2_WAHA_PROVIDER_AUTHORIZED: "yes" }),
    "invalid_authorization_flag",
  );
});

test("WAHA provider accepts only private/internal origins and bounded server secrets", () => {
  assert.deepEqual(
    readCanonicalWahaProviderAvailability({
      EVO_V2_WAHA_ENABLED: "1",
      EVO_V2_WAHA_PROVIDER_AUTHORIZED: "1",
    }),
    {
      status: "blocked",
      reason: "configuration_missing",
      missing: ["base_url", "api_key", "session_name"],
    },
  );

  for (const baseUrl of [
    "http://evo-inbox-waha:3000",
    "https://evo-v2-waha:443",
    "http://localhost:3000",
    "http://api.localhost:3000",
    "http://127.0.0.1:3000",
    "http://10.20.30.40:3000",
    "http://172.16.2.3:3000",
    "http://192.168.1.25:3000",
    "http://[::1]:3000",
    "http://[fd12:3456:789a::1]:3000",
  ]) {
    const config = loadCanonicalWahaProviderConfig(
      configuredEnvironment({ EVO_V2_WAHA_BASE_URL: baseUrl }),
    );
    assert.equal(config.status, "ready", baseUrl);
  }

  for (const [overrides, code] of [
    [{ EVO_V2_WAHA_BASE_URL: "https://example.com" }, "unsafe_base_url"],
    [{ EVO_V2_WAHA_BASE_URL: "http://waha:3000" }, "unsafe_base_url"],
    [
      { EVO_V2_WAHA_BASE_URL: "http://evo-inbox-waha:3000/private" },
      "unsafe_base_url",
    ],
    [
      { EVO_V2_WAHA_BASE_URL: "http://user:pass@evo-inbox-waha:3000" },
      "unsafe_base_url",
    ],
    [{ EVO_V2_WAHA_API_KEY: ` ${WAHA_API_KEY}` }, "unsafe_api_key"],
    [{ EVO_V2_WAHA_API_KEY: "\u0000short" }, "unsafe_api_key"],
    [{ EVO_V2_WAHA_SESSION_NAME: "evo inbox" }, "invalid_session_name"],
  ]) {
    expectConfigurationError(configuredEnvironment(overrides), code);
  }

  const shortKey = loadCanonicalWahaProviderConfig(
    configuredEnvironment({ EVO_V2_WAHA_API_KEY: "waha-key" }),
  );
  assert.equal(shortKey.status, "ready");
  assert.equal(shortKey.apiKey, "waha-key");
});

test("WAHA provider probes the exact configured session and requires WORKING", async () => {
  const requests = [];
  const timeoutSignals = [];

  const result = await probeCanonicalWahaSession(configuredEnvironment(), {
    createTimeoutSignal(timeoutMs) {
      timeoutSignals.push(timeoutMs);
      return new AbortController().signal;
    },
    fetch: async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(
        JSON.stringify({ name: "evo-inbox", status: "WORKING" }),
        { status: 200 },
      );
    },
  });

  assert.deepEqual(result, {
    status: "working",
    sessionName: "evo-inbox",
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].input,
    "http://evo-inbox-waha:3000/api/sessions/evo-inbox",
  );
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.headers.Accept, "application/json");
  assert.equal(requests[0].init.headers["X-Api-Key"], WAHA_API_KEY);
  assert.deepEqual(timeoutSignals, [CANONICAL_WAHA_PROVIDER_TIMEOUT_MS]);
  assert.equal(JSON.stringify(result).includes(WAHA_API_KEY), false);
});

test("WAHA provider sends exact reviewed text through official sendText and normalizes its ACK", async () => {
  const requests = [];
  const recipientId = "971501234567@c.us";
  const text = "Здравствуйте! Ваш документ принят.";
  const replyTo =
    "false_971501234567@c.us_11111111111111111111111111111111";
  const providerMessageId =
    "true_971501234567@c.us_22222222222222222222222222222222";

  const result = await sendCanonicalWahaText(
    { recipientId, text, replyTo },
    configuredEnvironment(),
    {
      fetch: async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(
          JSON.stringify({
            id: providerMessageId,
            timestamp: 1787994000,
            from: "971500000000@c.us",
            to: recipientId,
            fromMe: true,
            source: "api",
            body: text,
            ack: 1,
            ackName: "SERVER",
          }),
          { status: 201 },
        );
      },
    },
  );

  assert.deepEqual(result, {
    id: providerMessageId,
    timestamp: 1787994000,
    recipientId,
    fromMe: true,
    source: "api",
    body: text,
    ack: 1,
    ackName: "SERVER",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, "http://evo-inbox-waha:3000/api/sendText");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.headers.Accept, "application/json");
  assert.equal(requests[0].init.headers["Content-Type"], "application/json");
  assert.equal(requests[0].init.headers["X-Api-Key"], WAHA_API_KEY);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    session: "evo-inbox",
    chatId: recipientId,
    text,
    reply_to: replyTo,
  });
  assert.equal(JSON.stringify(result).includes(WAHA_API_KEY), false);
});

test("WAHA provider reconciles one exact message without downloading media", async () => {
  const requests = [];
  const recipientId = "971501234567@lid";
  const text = "Проверенное сообщение";
  const providerMessageId =
    "true_971501234567@lid_33333333333333333333333333333333";

  const result = await getCanonicalWahaMessage(
    { recipientId, providerMessageId, expectedText: text },
    configuredEnvironment({ EVO_V2_WAHA_SESSION_NAME: "session:alpha" }),
    {
      fetch: async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(
          JSON.stringify({
            id: providerMessageId,
            timestamp: 1787994012.5,
            from: "971500000000@c.us",
            to: recipientId,
            fromMe: true,
            body: text,
            ack: 3,
            ackName: "READ",
          }),
          { status: 200 },
        );
      },
    },
  );

  assert.deepEqual(result, {
    id: providerMessageId,
    timestamp: 1787994012.5,
    recipientId,
    fromMe: true,
    source: null,
    body: text,
    ack: 3,
    ackName: "READ",
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].input,
    `http://evo-inbox-waha:3000/api/session%3Aalpha/chats/971501234567%40lid/messages/${encodeURIComponent(providerMessageId)}?downloadMedia=false`,
  );
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.headers.Accept, "application/json");
  assert.equal(requests[0].init.headers["X-Api-Key"], WAHA_API_KEY);
});

test("WAHA provider accepts only the six documented numeric and named ACK pairs", async () => {
  const ackPairs = [
    [-1, "ERROR"],
    [0, "PENDING"],
    [1, "SERVER"],
    [2, "DEVICE"],
    [3, "READ"],
    [4, "PLAYED"],
  ];

  for (const [ack, ackName] of ackPairs) {
    const result = await sendCanonicalWahaText(
      { recipientId: "971501234567@c.us", text: "Reviewed" },
      configuredEnvironment(),
      {
        fetch: async () =>
          new Response(
            JSON.stringify({
              id: `true_971501234567@c.us_${ackName}`,
              timestamp: 1787994000,
              from: "971500000000@c.us",
              to: "971501234567@c.us",
              fromMe: true,
              source: "api",
              body: "Reviewed",
              ack,
              ackName,
            }),
            { status: 200 },
          ),
      },
    );
    assert.equal(result.ack, ack);
    assert.equal(result.ackName, ackName);
  }
});

test("explicit WAHA 4xx responses are typed as rejected without leaking provider text", async () => {
  const cases = [
    [401, "provider_authentication_failed"],
    [403, "provider_forbidden"],
    [429, "provider_rate_limited"],
    [422, "provider_rejected"],
  ];

  for (const [statusCode, code] of cases) {
    await assert.rejects(
      () =>
        sendCanonicalWahaText(
          {
            recipientId: "971501234567@c.us",
            text: "Final reviewed text",
          },
          configuredEnvironment(),
          {
            fetch: async () =>
              new Response(`secret provider detail ${WAHA_API_KEY}`, {
                status: statusCode,
              }),
          },
        ),
      (error) => {
        assert.equal(error instanceof CanonicalWahaProviderError, true);
        assert.equal(error.code, code);
        assert.equal(error.disposition, "rejected");
        assert.equal(error.statusCode, statusCode);
        assert.equal(error.message.includes(WAHA_API_KEY), false);
        assert.equal(error.message.includes("secret provider detail"), false);
        assert.equal(JSON.stringify(error).includes(WAHA_API_KEY), false);
        return true;
      },
      String(statusCode),
    );
  }
});

test("ambiguous WAHA outcomes are typed unknown and never expose raw failures", async () => {
  const cases = [
    [
      "timeout",
      async () => {
        throw new DOMException(`timeout ${WAHA_API_KEY}`, "TimeoutError");
      },
      "provider_timeout",
      null,
    ],
    [
      "network",
      async () => {
        throw new Error(`socket ${WAHA_API_KEY}`);
      },
      "provider_network_failure",
      null,
    ],
    [
      "server",
      async () =>
        new Response(`server ${WAHA_API_KEY}`, {
          status: 503,
        }),
      "provider_unavailable",
      503,
    ],
    [
      "malformed",
      async () => new Response(`{"secret":"${WAHA_API_KEY}"`, { status: 200 }),
      "provider_malformed_response",
      null,
    ],
    [
      "oversized",
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(64 * 1024 + 1) },
        }),
      "provider_malformed_response",
      null,
    ],
  ];

  for (const [label, fetchImpl, code, statusCode] of cases) {
    let requests = 0;
    await assert.rejects(
      () =>
        sendCanonicalWahaText(
          {
            recipientId: "971501234567@c.us",
            text: "Final reviewed text",
          },
          configuredEnvironment(),
          {
            fetch: async (...args) => {
              requests += 1;
              return fetchImpl(...args);
            },
          },
        ),
      (error) => {
        assert.equal(error instanceof CanonicalWahaProviderError, true, label);
        assert.equal(error.code, code, label);
        assert.equal(error.disposition, "unknown", label);
        assert.equal(error.statusCode, statusCode, label);
        assert.equal(error.message.includes(WAHA_API_KEY), false, label);
        assert.equal(JSON.stringify(error).includes(WAHA_API_KEY), false, label);
        return true;
      },
      label,
    );
    assert.equal(requests, 1, label);
  }
});

test("WAHA rejects malformed outbound identity, content, source, timestamp, or ACK pairs", async () => {
  const recipientId = "971501234567@c.us";
  const text = "Final reviewed text";
  const valid = {
    id: "true_971501234567@c.us_44444444444444444444444444444444",
    timestamp: 1787994024,
    from: "971500000000@c.us",
    to: recipientId,
    fromMe: true,
    source: "api",
    body: text,
    ack: 2,
    ackName: "DEVICE",
  };
  const malformed = [
    { ...valid, id: "" },
    { ...valid, timestamp: null },
    { ...valid, from: "" },
    { ...valid, to: "971501234568@c.us" },
    { ...valid, fromMe: false },
    { ...valid, source: "app" },
    { ...valid, body: "different text" },
    { ...valid, ack: 2, ackName: "READ" },
    { ...valid, ack: 5, ackName: "UNKNOWN" },
  ];

  for (const responseValue of malformed) {
    await assert.rejects(
      () =>
        sendCanonicalWahaText(
          { recipientId, text },
          configuredEnvironment(),
          {
            fetch: async () =>
              new Response(JSON.stringify(responseValue), { status: 200 }),
          },
        ),
      (error) =>
        error instanceof CanonicalWahaProviderError &&
        error.code === "provider_malformed_response" &&
        error.disposition === "unknown",
    );
  }
});

test("blocked configuration and invalid direct-send inputs fail as typed rejections before fetch", async () => {
  const cases = [
    [{}, { recipientId: "971501234567@c.us", text: "Reviewed" }, "feature_disabled"],
    [
      { EVO_V2_WAHA_ENABLED: "1", EVO_V2_WAHA_PROVIDER_AUTHORIZED: "0" },
      { recipientId: "971501234567@c.us", text: "Reviewed" },
      "provider_not_authorized",
    ],
    [
      { EVO_V2_WAHA_ENABLED: "1", EVO_V2_WAHA_PROVIDER_AUTHORIZED: "1" },
      { recipientId: "971501234567@c.us", text: "Reviewed" },
      "configuration_missing",
    ],
    [
      configuredEnvironment({ EVO_V2_WAHA_BASE_URL: "https://example.com" }),
      { recipientId: "971501234567@c.us", text: "Reviewed" },
      "configuration_invalid",
    ],
    [
      configuredEnvironment(),
      { recipientId: "120363123456@g.us", text: "Reviewed" },
      "invalid_request",
    ],
  ];

  for (const [environment, input, code] of cases) {
    let requests = 0;
    await assert.rejects(
      () =>
        sendCanonicalWahaText(input, environment, {
          fetch: async () => {
            requests += 1;
            throw new Error("must not fetch");
          },
        }),
      (error) =>
        error instanceof CanonicalWahaProviderError &&
        error.code === code &&
        error.disposition === "rejected",
      code,
    );
    assert.equal(requests, 0, code);
  }
});

test("WAHA session probe distinguishes explicit non-WORKING from ambiguous failures", async () => {
  const cases = [
    [
      "not-working",
      async () =>
        new Response(
          JSON.stringify({ name: "evo-inbox", status: "STARTING" }),
          { status: 200 },
        ),
      "session_not_working",
      "rejected",
    ],
    [
      "wrong-session",
      async () =>
        new Response(
          JSON.stringify({ name: "other-session", status: "WORKING" }),
          { status: 200 },
        ),
      "provider_malformed_response",
      "unknown",
    ],
    [
      "authentication",
      async () => new Response("not exposed", { status: 401 }),
      "provider_authentication_failed",
      "rejected",
    ],
    [
      "timeout",
      async () => {
        throw new DOMException("not exposed", "TimeoutError");
      },
      "provider_timeout",
      "unknown",
    ],
  ];

  for (const [label, fetchImpl, code, disposition] of cases) {
    await assert.rejects(
      () =>
        probeCanonicalWahaSession(configuredEnvironment(), {
          fetch: fetchImpl,
        }),
      (error) =>
        error instanceof CanonicalWahaProviderError &&
        error.code === code &&
        error.disposition === disposition,
      label,
    );
  }
});

test("WAHA reconciliation preserves rejected versus unknown outcome semantics", async () => {
  const recipientId = "971501234567@c.us";
  const providerMessageId =
    "true_971501234567@c.us_55555555555555555555555555555555";
  const input = {
    recipientId,
    providerMessageId,
    expectedText: "Final reviewed text",
  };
  const cases = [
    [
      "missing",
      async () => new Response("not exposed", { status: 404 }),
      "provider_rejected",
      "rejected",
    ],
    [
      "network",
      async () => {
        throw new Error("not exposed");
      },
      "provider_network_failure",
      "unknown",
    ],
    [
      "identity-mismatch",
      async () =>
        new Response(
          JSON.stringify({
            id: "true_971501234567@c.us_DIFFERENT",
            timestamp: 1787994036,
            from: "971500000000@c.us",
            to: recipientId,
            fromMe: true,
            source: "api",
            body: input.expectedText,
            ack: 1,
            ackName: "SERVER",
          }),
          { status: 200 },
        ),
      "provider_malformed_response",
      "unknown",
    ],
  ];

  for (const [label, fetchImpl, code, disposition] of cases) {
    await assert.rejects(
      () =>
        getCanonicalWahaMessage(input, configuredEnvironment(), {
          fetch: fetchImpl,
        }),
      (error) =>
        error instanceof CanonicalWahaProviderError &&
        error.code === code &&
        error.disposition === disposition,
      label,
    );
  }
});
