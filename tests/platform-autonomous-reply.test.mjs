import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isConnectedPlatformPrivateApi } from "../src/lib/platform-route-contract.ts";
import {
  loadPlatformAutonomousReplyConfig,
  PLATFORM_AUTONOMOUS_REPLY_BUSINESS_END_MINUTE,
  PLATFORM_AUTONOMOUS_REPLY_BUSINESS_START_MINUTE,
  PLATFORM_AUTONOMOUS_REPLY_BUSINESS_TIME_ZONE,
  PLATFORM_AUTONOMOUS_REPLY_CONFIDENCE_MINIMUM,
  PLATFORM_AUTONOMOUS_REPLY_CONSECUTIVE_LIMIT,
  PLATFORM_AUTONOMOUS_REPLY_COOLDOWN_SECONDS,
  PLATFORM_AUTONOMOUS_REPLY_POLICY_VERSION,
  PLATFORM_AUTONOMOUS_REPLY_ROLLING_LIMIT,
  PlatformAutonomousReplyConfigurationError,
} from "../src/lib/server/platform-autonomous-reply-config.ts";
import {
  createPlatformAutonomousReplyWahaClient,
  PlatformAutonomousReplyWahaError,
} from "../src/lib/server/platform-autonomous-reply-waha-client.ts";
import {
  createPlatformAutonomousReplyHandler,
  createPlatformAutonomousReplyRepository,
  PlatformAutonomousReplyRepositoryError,
} from "../src/lib/server/platform-autonomous-reply-processor.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const SUPABASE_SECRET = ["sb", "secret", "synthetic_server_test_key_only"].join("_");
const TRIGGER_SECRET = "synthetic-p5f3-trigger-secret-value-only";
const WAHA_API_KEY = "synthetic-p5f3-waha-api-key-value-only";

function enabledEnvironment(overrides = {}) {
  return {
    EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED: "1",
    EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH: "0",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET,
    EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_BASE_URL:
      "http://evo-inbox-waha:3000",
    EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_API_KEY: WAHA_API_KEY,
    EVO_PLATFORM_AUTONOMOUS_REPLIES_TRIGGER_SECRET: TRIGGER_SECRET,
    ...overrides,
  };
}

function configurationError(environment, code) {
  assert.throws(
    () => loadPlatformAutonomousReplyConfig(environment),
    (error) =>
      error instanceof PlatformAutonomousReplyConfigurationError &&
      error.code === code,
  );
}

test("autonomous replies are disabled by default without reading transport configuration", () => {
  assert.deepEqual(loadPlatformAutonomousReplyConfig({}), { enabled: false });
  assert.deepEqual(
    loadPlatformAutonomousReplyConfig({
      EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED: "0",
      EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_BASE_URL: "https://public.invalid",
    }),
    { enabled: false },
  );
  configurationError(
    { EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED: "yes" },
    "invalid_enabled_flag",
  );
});

test("enabled autonomous replies keep the emergency stop engaged unless explicitly disengaged", () => {
  const config = loadPlatformAutonomousReplyConfig(
    enabledEnvironment({ EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH: undefined }),
  );
  assert.equal(config.enabled, true);
  assert.equal(config.killSwitchEngaged, true);

  const ready = loadPlatformAutonomousReplyConfig(enabledEnvironment());
  assert.equal(ready.enabled, true);
  assert.equal(ready.killSwitchEngaged, false);
  assert.equal(ready.organizationId, ORGANIZATION_ID);
  assert.equal(ready.sessionName, "evo-inbox");
  assert.equal(ready.wahaBaseUrl, "http://evo-inbox-waha:3000");
  assert.equal(ready.wahaApiKey, WAHA_API_KEY);
  assert.equal(ready.triggerSecret, TRIGGER_SECRET);
  assert.equal(ready.policyVersion, "p5f3-v1");
  assert.equal(ready.workerRef, "nextjs:p5f3-autonomous-reply");

  configurationError(
    enabledEnvironment({ EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH: "off" }),
    "invalid_kill_switch_flag",
  );
});

test("the frozen deterministic policy constants match the accepted P5F3 contract", () => {
  assert.equal(PLATFORM_AUTONOMOUS_REPLY_POLICY_VERSION, "p5f3-v1");
  assert.equal(PLATFORM_AUTONOMOUS_REPLY_BUSINESS_TIME_ZONE, "Asia/Bishkek");
  assert.equal(PLATFORM_AUTONOMOUS_REPLY_BUSINESS_START_MINUTE, 9 * 60);
  assert.equal(PLATFORM_AUTONOMOUS_REPLY_BUSINESS_END_MINUTE, 21 * 60);
  assert.equal(PLATFORM_AUTONOMOUS_REPLY_CONFIDENCE_MINIMUM, 85);
  assert.equal(PLATFORM_AUTONOMOUS_REPLY_COOLDOWN_SECONDS, 60);
  assert.equal(PLATFORM_AUTONOMOUS_REPLY_ROLLING_LIMIT, 6);
  assert.equal(PLATFORM_AUTONOMOUS_REPLY_CONSECUTIVE_LIMIT, 3);
});

test("enabled configuration rejects public origins and missing or weak dedicated secrets", () => {
  configurationError(
    enabledEnvironment({
      EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_BASE_URL: "https://example.com",
    }),
    "unsafe_waha_base_url",
  );
  configurationError(
    enabledEnvironment({
      EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_BASE_URL:
        "http://evo-inbox-waha:3000/private",
    }),
    "unsafe_waha_base_url",
  );
  configurationError(
    enabledEnvironment({ EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_API_KEY: "short" }),
    "unsafe_waha_api_key",
  );
  configurationError(
    enabledEnvironment({ EVO_PLATFORM_AUTONOMOUS_REPLIES_TRIGGER_SECRET: "short" }),
    "unsafe_trigger_secret",
  );
  configurationError(
    enabledEnvironment({ EVO_PLATFORM_ORGANIZATION_ID: undefined }),
    "platform_backend_not_configured",
  );
});

test("WAHA preflight requires WORKING with an explicitly inactive reachout timelock", async () => {
  const requests = [];
  const responses = [
    new Response(JSON.stringify({
      name: "evo-inbox",
      status: "WORKING",
      me: {
        id: "996555123456@c.us",
        pushName: "EVO",
        reachoutTimelock: null,
      },
    }), { status: 200 }),
    new Response(JSON.stringify({
      name: "evo-inbox",
      status: "WORKING",
      me: {
        id: "996555123456@c.us",
        reachoutTimelock: {
          enforcementType: "RESTRICT_ALL_COMPANIONS",
          isActive: false,
          timeEnforcementEnds: 1_784_477_333,
        },
      },
    }), { status: 200 }),
    new Response(JSON.stringify({
      name: "evo-inbox",
      status: "WORKING",
      me: {
        id: "996555123456@c.us",
        reachoutTimelock: {
          enforcementType: "RESTRICT_ALL_COMPANIONS",
          isActive: true,
          timeEnforcementEnds: 1_784_477_333,
        },
      },
    }), { status: 200 }),
    new Response(JSON.stringify({
      name: "evo-inbox",
      status: "WORKING",
      me: { id: "996555123456@c.us" },
    }), { status: 200 }),
    new Response(JSON.stringify({
      name: "evo-inbox",
      status: "STARTING",
      me: {
        id: "996555123456@c.us",
        pushName: "EVO",
        reachoutTimelock: null,
      },
    }), { status: 200 }),
    new Response(JSON.stringify({
      name: "other-session",
      status: "WORKING",
      me: { id: "996555123456@c.us", reachoutTimelock: null },
    }), { status: 200 }),
  ];
  const client = createPlatformAutonomousReplyWahaClient(
    loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    async (input, init) => {
      requests.push({ input: String(input), init });
      return responses.shift();
    },
  );

  assert.deepEqual(await client.preflight(), { ready: true });
  assert.deepEqual(await client.preflight(), { ready: true });
  assert.deepEqual(await client.preflight(), {
    ready: false,
    reasonCode: "reachout_timelock_active",
  });
  assert.deepEqual(await client.preflight(), {
    ready: false,
    reasonCode: "session_status_uncertain",
  });
  assert.deepEqual(await client.preflight(), {
    ready: false,
    reasonCode: "session_not_working",
  });
  assert.deepEqual(await client.preflight(), {
    ready: false,
    reasonCode: "session_status_uncertain",
  });
  assert.equal(requests[0].input, "http://evo-inbox-waha:3000/api/sessions/evo-inbox");
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.headers["X-Api-Key"], WAHA_API_KEY);
});

test("WAHA sendText sends one exact private reply_to payload and exposes only its validated id", async () => {
  const requests = [];
  const client = createPlatformAutonomousReplyWahaClient(
    loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(
        JSON.stringify({
          id: "true_996555123456@c.us_SYNTHETIC_OUTBOUND",
          privateNoise: "must-not-be-returned",
        }),
        { status: 201 },
      );
    },
  );

  assert.deepEqual(
    await client.sendText({
      chatId: "996555123456@c.us",
      replyTo: "false_996555123456@c.us_SYNTHETIC_INBOUND",
      text: "Здравствуйте! Чем могу помочь?",
    }),
    { providerMessageId: "true_996555123456@c.us_SYNTHETIC_OUTBOUND" },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, "http://evo-inbox-waha:3000/api/sendText");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.redirect, "error");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    session: "evo-inbox",
    chatId: "996555123456@c.us",
    text: "Здравствуйте! Чем могу помочь?",
    reply_to: "false_996555123456@c.us_SYNTHETIC_INBOUND",
  });
});

test("WAHA rejection is distinct from an ambiguous result and neither is retryable", async () => {
  const rejected = createPlatformAutonomousReplyWahaClient(
    loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    async () => new Response('{"message":"bad request"}', { status: 400 }),
  );
  await assert.rejects(
    rejected.sendText({
      chatId: "996555123456@c.us",
      replyTo: "false_996555123456@c.us_SYNTHETIC_INBOUND",
      text: "Здравствуйте!",
    }),
    (error) =>
      error instanceof PlatformAutonomousReplyWahaError &&
      error.kind === "rejected" &&
      error.code === "provider_rejected" &&
      error.retryable === false,
  );

  const ambiguous = createPlatformAutonomousReplyWahaClient(
    loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    async () => {
      throw new TypeError("synthetic connection loss");
    },
  );
  await assert.rejects(
    ambiguous.sendText({
      chatId: "996555123456@c.us",
      replyTo: "false_996555123456@c.us_SYNTHETIC_INBOUND",
      text: "Здравствуйте!",
    }),
    (error) =>
      error instanceof PlatformAutonomousReplyWahaError &&
      error.kind === "unknown" &&
      error.code === "provider_connection_lost" &&
      error.retryable === false,
  );

  const malformed = createPlatformAutonomousReplyWahaClient(
    loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    async () => new Response("not-json", { status: 201 }),
  );
  await assert.rejects(
    malformed.sendText({
      chatId: "996555123456@c.us",
      replyTo: "false_996555123456@c.us_SYNTHETIC_INBOUND",
      text: "Здравствуйте!",
    }),
    (error) =>
      error instanceof PlatformAutonomousReplyWahaError &&
      error.kind === "unknown" &&
      error.code === "provider_malformed_response" &&
      error.retryable === false,
  );

  const acceptedWithoutIdentity = createPlatformAutonomousReplyWahaClient(
    loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    async () => new Response('{"status":"accepted"}', { status: 201 }),
  );
  await assert.rejects(
    acceptedWithoutIdentity.sendText({
      chatId: "996555123456@c.us",
      replyTo: "false_996555123456@c.us_SYNTHETIC_INBOUND",
      text: "Здравствуйте!",
    }),
    (error) =>
      error instanceof PlatformAutonomousReplyWahaError &&
      error.kind === "unknown" &&
      error.code === "provider_ambiguous_response" &&
      error.retryable === false,
  );

  const ambiguousServerFailure = createPlatformAutonomousReplyWahaClient(
    loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    async () => new Response('{"message":"internal failure"}', { status: 503 }),
  );
  await assert.rejects(
    ambiguousServerFailure.sendText({
      chatId: "996555123456@c.us",
      replyTo: "false_996555123456@c.us_SYNTHETIC_INBOUND",
      text: "Здравствуйте!",
    }),
    (error) =>
      error instanceof PlatformAutonomousReplyWahaError &&
      error.kind === "unknown" &&
      error.code === "provider_ambiguous_response" &&
      error.retryable === false,
  );
});

const TRIGGER_REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const NOW_MS = 1_800_000_000_000;

function signedTriggerRequest(overrides = {}) {
  const timestamp = String(NOW_MS);
  const signature = createHmac("sha256", TRIGGER_SECRET)
    .update(`${TRIGGER_REQUEST_ID}.${timestamp}`, "utf8")
    .digest("hex");
  return new Request("http://localhost/internal", {
    method: "POST",
    headers: {
      "content-length": "0",
      "x-evo-autonomous-reply-request-id": TRIGGER_REQUEST_ID,
      "x-evo-autonomous-reply-timestamp": timestamp,
      "x-evo-autonomous-reply-hmac-algorithm": "sha256",
      "x-evo-autonomous-reply-hmac": signature,
      ...overrides,
    },
  });
}

function claimedReply() {
  return Object.freeze({
    state: "claimed",
    organizationId: ORGANIZATION_ID,
    conversationId: "22222222-2222-4222-8222-222222222222",
    proposalRequestId: "33333333-3333-4333-8333-333333333333",
    sourceMessageId: "44444444-4444-4444-8444-444444444444",
    intentId: "55555555-5555-4555-8555-555555555555",
    attemptId: "66666666-6666-4666-8666-666666666666",
    rawChatId: "996555123456@c.us",
    rawReplyTo: "false_996555123456@c.us_SYNTHETIC_INBOUND",
    replyText: "Здравствуйте! Чем могу помочь?",
    leaseExpiresAt: "2027-01-15T08:01:00.000Z",
    leaseExpiresAtMs: NOW_MS + 60_000,
  });
}

test("the private trigger fails closed before claiming when disabled, stopped, malformed or unsigned", async () => {
  let claims = 0;
  const repository = {
    async claim() {
      claims += 1;
      return { state: "empty" };
    },
    async finish() {
      assert.fail("finish must not run");
    },
  };

  const disabled = createPlatformAutonomousReplyHandler({
    config: { enabled: false },
    repository,
    nowMs: () => NOW_MS,
  });
  assert.equal((await disabled(signedTriggerRequest())).status, 503);

  const stopped = createPlatformAutonomousReplyHandler({
    config: loadPlatformAutonomousReplyConfig(
      enabledEnvironment({ EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH: "1" }),
    ),
    repository,
    nowMs: () => NOW_MS,
  });
  assert.equal((await stopped(signedTriggerRequest())).status, 503);

  const enabled = createPlatformAutonomousReplyHandler({
    config: loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    repository,
    nowMs: () => NOW_MS,
  });
  assert.equal(
    (await enabled(signedTriggerRequest({ "x-evo-autonomous-reply-hmac": "0".repeat(64) }))).status,
    401,
  );
  assert.equal(
    (await enabled(new Request("http://localhost/internal", { method: "GET" }))).status,
    401,
  );
  const staleTimestamp = String(NOW_MS - 5 * 60 * 1000 - 1);
  const staleSignature = createHmac("sha256", TRIGGER_SECRET)
    .update(`${TRIGGER_REQUEST_ID}.${staleTimestamp}`, "utf8")
    .digest("hex");
  assert.equal(
    (
      await enabled(
        signedTriggerRequest({
          "x-evo-autonomous-reply-timestamp": staleTimestamp,
          "x-evo-autonomous-reply-hmac": staleSignature,
        }),
      )
    ).status,
    401,
  );
  const bodyRequest = signedTriggerRequest();
  const bodyHeaders = new Headers(bodyRequest.headers);
  bodyHeaders.delete("content-length");
  assert.equal(
    (
      await enabled(
        new Request("http://localhost/internal", {
          method: "POST",
          headers: bodyHeaders,
          body: "{}",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await enabled(
        new Request("http://localhost/internal", {
          method: "POST",
          headers: bodyRequest.headers,
          body: "{}",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await enabled(
        new Request("http://localhost/internal", {
          method: "POST",
          headers: bodyHeaders,
          body: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          duplex: "half",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await enabled(
        new Request("http://localhost/internal", {
          method: "POST",
          headers: {
            ...Object.fromEntries(bodyRequest.headers),
            "content-length": "1",
          },
          body: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          duplex: "half",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await enabled(
        new Request("http://localhost/internal", {
          method: "POST",
          headers: {
            ...Object.fromEntries(bodyRequest.headers),
            "transfer-encoding": "chunked",
          },
          body: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          duplex: "half",
        }),
      )
    ).status,
    400,
  );
  assert.equal(claims, 0);
});

test("the private trigger accepts the runtime zero-length stream representation", async () => {
  let claims = 0;
  const handler = createPlatformAutonomousReplyHandler({
    config: loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    repository: {
      async claim() {
        claims += 1;
        return { state: "empty" };
      },
      async finish() {
        assert.fail("finish must not run");
      },
    },
    nowMs: () => NOW_MS,
  });
  const signed = signedTriggerRequest();
  const runtimeRequest = new Request(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    duplex: "half",
  });
  assert.notEqual(runtimeRequest.body, null);

  const response = await handler(runtimeRequest);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, state: "empty" });
  assert.equal(claims, 1);
});

test("empty and policy-blocked claims never contact WAHA", async () => {
  const provider = {
    async preflight() {
      assert.fail("preflight must not run");
    },
    async sendText() {
      assert.fail("send must not run");
    },
  };
  for (const claim of [
    { state: "empty" },
    { state: "blocked", reasonCode: "autonomy_paused" },
  ]) {
    const handler = createPlatformAutonomousReplyHandler({
      config: loadPlatformAutonomousReplyConfig(enabledEnvironment()),
      repository: {
        async claim() {
          return claim;
        },
        async finish() {
          assert.fail("finish must not run");
        },
      },
      provider,
      nowMs: () => NOW_MS,
    });
    const response = await handler(signedTriggerRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, state: claim.state });
  }
});

test("a current preflight block is durably finished without sending", async () => {
  const finishes = [];
  const handler = createPlatformAutonomousReplyHandler({
    config: loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    repository: {
      async claim() {
        return claimedReply();
      },
      async finish(input) {
        finishes.push(input);
        return {
          organizationId: input.organizationId,
          intentId: input.intentId,
          attemptId: input.attemptId,
          conversationId: claimedReply().conversationId,
          sourceMessageId: claimedReply().sourceMessageId,
          outcome: input.outcome,
          communicationMessageId: null,
        };
      },
    },
    provider: {
      async preflight() {
        return { ready: false, reasonCode: "session_not_working" };
      },
      async sendText() {
        assert.fail("send must not run");
      },
    },
    nowMs: () => NOW_MS,
  });

  const response = await handler(signedTriggerRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    state: "blocked",
    intentId: claimedReply().intentId,
  });
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].outcome, "blocked");
  assert.equal(finishes[0].errorCode, "provider_preflight_failed");
  assert.equal(finishes[0].providerMessageId, null);
});

test("one claimed reply is sent once and only a safe accepted receipt is returned", async () => {
  const calls = [];
  const finishes = [];
  const handler = createPlatformAutonomousReplyHandler({
    config: loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    repository: {
      async claim(input) {
        calls.push(["claim", input]);
        return claimedReply();
      },
      async finish(input) {
        finishes.push(input);
        return {
          organizationId: input.organizationId,
          intentId: input.intentId,
          attemptId: input.attemptId,
          conversationId: claimedReply().conversationId,
          sourceMessageId: claimedReply().sourceMessageId,
          outcome: input.outcome,
          communicationMessageId: "88888888-8888-4888-8888-888888888888",
        };
      },
    },
    provider: {
      async preflight() {
        calls.push(["preflight"]);
        return { ready: true };
      },
      async sendText(input) {
        calls.push(["send", input]);
        return {
          providerMessageId: "true_996555123456@c.us_SYNTHETIC_OUTBOUND",
        };
      },
    },
    nowMs: () => NOW_MS,
  });

  const response = await handler(signedTriggerRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: true,
    state: "accepted",
    intentId: claimedReply().intentId,
    communicationMessageId: "88888888-8888-4888-8888-888888888888",
  });
  assert.equal(JSON.stringify(body).includes("996555"), false);
  assert.deepEqual(calls.map(([name]) => name), ["claim", "preflight", "send"]);
  assert.deepEqual(calls[2][1], {
    chatId: claimedReply().rawChatId,
    replyTo: claimedReply().rawReplyTo,
    text: claimedReply().replyText,
  });
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].outcome, "accepted");
  assert.equal(
    finishes[0].providerMessageId,
    "true_996555123456@c.us_SYNTHETIC_OUTBOUND",
  );
});

test("a replay-denied claimed receipt cannot call WAHA a second time", async () => {
  let claimCalls = 0;
  let sends = 0;
  const handler = createPlatformAutonomousReplyHandler({
    config: loadPlatformAutonomousReplyConfig(enabledEnvironment()),
    repository: {
      async claim() {
        claimCalls += 1;
        if (claimCalls > 1) {
          throw new PlatformAutonomousReplyRepositoryError();
        }
        return claimedReply();
      },
      async finish(input) {
        return {
          organizationId: input.organizationId,
          intentId: input.intentId,
          attemptId: input.attemptId,
          conversationId: claimedReply().conversationId,
          sourceMessageId: claimedReply().sourceMessageId,
          outcome: input.outcome,
          communicationMessageId:
            "88888888-8888-4888-8888-888888888888",
        };
      },
    },
    provider: {
      async preflight() {
        return { ready: true };
      },
      async sendText() {
        sends += 1;
        return {
          providerMessageId: "true_996555123456@c.us_SYNTHETIC_OUTBOUND",
        };
      },
    },
    nowMs: () => NOW_MS,
  });

  assert.equal((await handler(signedTriggerRequest())).status, 200);
  assert.equal((await handler(signedTriggerRequest())).status, 503);
  assert.equal(claimCalls, 2);
  assert.equal(sends, 1);
});

test("rejected and ambiguous sends are each persisted once and never retried", async () => {
  for (const [error, outcome] of [
    [
      new PlatformAutonomousReplyWahaError("rejected", "provider_rejected"),
      "rejected",
    ],
    [
      new PlatformAutonomousReplyWahaError(
        "unknown",
        "provider_connection_lost",
      ),
      "unknown",
    ],
  ]) {
    let sends = 0;
    const finishes = [];
    const handler = createPlatformAutonomousReplyHandler({
      config: loadPlatformAutonomousReplyConfig(enabledEnvironment()),
      repository: {
        async claim() {
          return claimedReply();
        },
        async finish(input) {
          finishes.push(input);
          return {
            organizationId: input.organizationId,
            intentId: input.intentId,
            attemptId: input.attemptId,
            conversationId: claimedReply().conversationId,
            sourceMessageId: claimedReply().sourceMessageId,
            outcome: input.outcome,
            communicationMessageId: null,
          };
        },
      },
      provider: {
        async preflight() {
          return { ready: true };
        },
        async sendText() {
          sends += 1;
          throw error;
        },
      },
      nowMs: () => NOW_MS,
    });

    const response = await handler(signedTriggerRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      state: outcome,
      intentId: claimedReply().intentId,
    });
    assert.equal(sends, 1);
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].outcome, outcome);
    assert.equal(finishes[0].errorCode, error.code);
    assert.equal(finishes[0].providerMessageId, null);
  }
});

test("the service repository binds exact RPC arguments and rejects extra or private result keys", async () => {
  const calls = [];
  const client = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args) {
          calls.push({ name, args });
          if (name === "claim_autonomous_reply") {
            return {
              error: null,
              data: {
                state: "claimed",
                decision_id: "99999999-9999-4999-8999-999999999999",
                intent_id: claimedReply().intentId,
                attempt_id: claimedReply().attemptId,
                conversation_id: claimedReply().conversationId,
                source_message_id: claimedReply().sourceMessageId,
                proposal_request_id: claimedReply().proposalRequestId,
                policy_version: "p5f3-v1",
                lease_expires_at: claimedReply().leaseExpiresAt,
                waha_session_name: "evo-inbox",
                reply_text: claimedReply().replyText,
                raw_chat_id: claimedReply().rawChatId,
                raw_reply_to: claimedReply().rawReplyTo,
              },
            };
          }
          return {
            error: null,
            data: {
              state: "accepted",
              intent_id: claimedReply().intentId,
              attempt_id: claimedReply().attemptId,
              conversation_id: claimedReply().conversationId,
              source_message_id: claimedReply().sourceMessageId,
              communication_message_id:
                "88888888-8888-4888-8888-888888888888",
              ack_name: null,
            },
          };
        },
      };
    },
  };
  const repository = createPlatformAutonomousReplyRepository(client);
  const claim = await repository.claim({
    organizationId: ORGANIZATION_ID,
    workerRef: "nextjs:p5f3-autonomous-reply",
    visibilityTimeoutSeconds: 120,
    policyVersion: "p5f3-v1",
    requestId: TRIGGER_REQUEST_ID,
  });
  assert.equal(claim.state, "claimed");
  assert.equal(claim.rawChatId, claimedReply().rawChatId);
  assert.deepEqual(calls[0], {
    name: "claim_autonomous_reply",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_worker_ref: "nextjs:p5f3-autonomous-reply",
      p_visibility_timeout_seconds: 120,
      p_policy_version: "p5f3-v1",
      p_request_id: TRIGGER_REQUEST_ID,
    },
  });

  const finish = await repository.finish({
    organizationId: ORGANIZATION_ID,
    intentId: claimedReply().intentId,
    attemptId: claimedReply().attemptId,
    outcome: "accepted",
    errorCode: null,
    providerMessageId: "true_996555123456@c.us_SYNTHETIC_OUTBOUND",
    providerObservedAt: "2027-01-15T08:00:00.000Z",
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.equal(finish.outcome, "accepted");
  assert.deepEqual(calls[1], {
    name: "finish_autonomous_reply",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_intent_id: claimedReply().intentId,
      p_attempt_id: claimedReply().attemptId,
      p_outcome: "accepted",
      p_error_code: null,
      p_provider_message_id:
        "true_996555123456@c.us_SYNTHETIC_OUTBOUND",
      p_provider_observed_at: "2027-01-15T08:00:00.000Z",
      p_request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  });

  const poisoned = createPlatformAutonomousReplyRepository({
    schema() {
      return {
        async rpc() {
          return {
            error: null,
            data: {
              state: "empty",
              policy_version: "p5f3-v1",
              raw_chat_id: "996555123456@c.us",
            },
          };
        },
      };
    },
  });
  await assert.rejects(
    poisoned.claim({
      organizationId: ORGANIZATION_ID,
      workerRef: "nextjs:p5f3-autonomous-reply",
      visibilityTimeoutSeconds: 120,
      policyVersion: "p5f3-v1",
      requestId: TRIGGER_REQUEST_ID,
    }),
    PlatformAutonomousReplyRepositoryError,
  );
});

test("the exact private route is wired through the proxy and safe environment example", async () => {
  const [route, proxy, environment] = await Promise.all([
    readFile(
      "src/app/api/internal/platform-messaging/waha/autonomous-reply/route.ts",
      "utf8",
    ),
    readFile("src/proxy.ts", "utf8"),
    readFile(".env.example", "utf8"),
  ]);
  assert.match(route, /createPlatformAutonomousReplyHandler/);
  assert.equal(
    isConnectedPlatformPrivateApi(
      "/api/internal/platform-messaging/waha/autonomous-reply",
    ),
    true,
  );
  assert.equal(
    isConnectedPlatformPrivateApi(
      "/api/internal/platform-messaging/waha/autonomous-reply/extra",
    ),
    false,
  );
  assert.match(proxy, /isConnectedPlatformPrivateApi\(path\)/);
  assert.match(environment, /EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED=0/);
  assert.match(environment, /EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1/);
  assert.doesNotMatch(environment, /NEXT_PUBLIC_.*AUTONOMOUS/i);
});
