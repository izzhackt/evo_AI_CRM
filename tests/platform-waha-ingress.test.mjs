import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getPlatformWahaIngressConfig,
  PlatformWahaIngressConfigurationError,
} from "../src/lib/server/platform-waha-ingress-config.ts";
import {
  createPlatformWahaIngressHandler,
  createPlatformWahaIngressRepository,
  PlatformWahaIngressRepositoryError,
} from "../src/lib/server/platform-waha-ingress-repository.ts";
import {
  parsePlatformWahaWebhookEvent,
  platformWahaVerificationHeaders,
} from "../src/lib/server/platform-waha-webhook.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PROVIDER_EVENT_ID = "22222222-2222-4222-8222-222222222222";
const WORK_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const NOW_MS = 1_785_991_509_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const WEBHOOK_SECRET = "synthetic-waha-hmac-secret-for-tests-only";
const SERVICE_SECRET = ["sb", "secret", "synthetic_server_test_key_only"].join("_");
const ENDPOINT_URL = "http://localhost/api/internal/platform-messaging/waha/events";
const ENV_KEYS = [
  "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
  "EVO_PLATFORM_ORGANIZATION_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "EVO_PLATFORM_SUPABASE_SECRET_KEY",
  "EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET",
];

const ENABLED_CONFIG = Object.freeze({
  enabled: true,
  organizationId: ORGANIZATION_ID,
  supabaseUrl: "http://127.0.0.1:54321",
  supabaseSecretKey: SERVICE_SECRET,
  webhookHmacSecret: WEBHOOK_SECRET,
  sessionName: "evo-inbox",
  maxBodyBytes: 512 * 1024,
  maxClockSkewMs: MAX_CLOCK_SKEW_MS,
});

function rawJson(value) {
  return JSON.stringify(value);
}

function messageEvent(overrides = {}) {
  return {
    event: "message.any",
    session: "evo-inbox",
    timestamp: NOW_MS,
    payload: {
      id: "wamid.synthetic-message-001",
      from: "synthetic-chat@c.us",
      body: "Synthetic test message",
    },
    ...overrides,
  };
}

function sessionEvent(overrides = {}) {
  return {
    event: "session.status",
    id: "synthetic-session-status-001",
    session: "evo-inbox",
    timestamp: NOW_MS,
    payload: { status: "WORKING" },
    ...overrides,
  };
}

function sign(rawBody, hmacMaterial = WEBHOOK_SECRET) {
  return createHmac("sha512", hmacMaterial).update(rawBody).digest("hex");
}

function webhookRequest(rawBody, options = {}) {
  const body = typeof rawBody === "string" || rawBody instanceof Uint8Array
    ? rawBody
    : rawJson(rawBody);
  const timestamp = options.timestamp ?? NOW_MS;
  const headers = new Headers({
    "content-type": "application/json",
    "x-webhook-request-id": options.requestId ?? "provider-request-001",
    "x-webhook-timestamp": String(timestamp),
    "x-webhook-hmac-algorithm": options.algorithm ?? "sha512",
    "x-webhook-hmac": options.signature ?? sign(body, options.hmacMaterial),
  });

  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === null) headers.delete(name);
    else headers.set(name, String(value));
  }

  return new Request(ENDPOINT_URL, { method: "POST", headers, body });
}

function internalRequestIdGenerator() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `44444444-4444-4444-8444-${String(sequence).padStart(12, "0")}`;
  };
}

function eventBusinessKey(input) {
  return [
    input.organizationId,
    input.sessionName,
    input.payloadId,
    input.eventType,
    input.providerEventVariantRef ?? "",
  ].join(":");
}

function createMemoryRepository() {
  const calls = [];
  const requestIds = new Map();
  const businessEvents = new Map();
  const enqueuedBusinessKeys = new Set();
  let eventSequence = 0;
  let workSequence = 0;

  return {
    calls,
    async persistVerifiedEvent(input) {
      calls.push({ kind: "persist", input });

      const existingForRequest = requestIds.get(input.providerRequestId);
      const businessKey = eventBusinessKey(input);
      const existingForBusiness = businessEvents.get(businessKey);
      const existing = existingForRequest ?? existingForBusiness;
      if (existing) {
        requestIds.set(input.providerRequestId, existing);
        return { providerWebhookEventId: existing, deduplicated: true };
      }

      eventSequence += 1;
      const providerWebhookEventId = `55555555-5555-4555-8555-${String(eventSequence).padStart(12, "0")}`;
      requestIds.set(input.providerRequestId, providerWebhookEventId);
      businessEvents.set(businessKey, providerWebhookEventId);
      return { providerWebhookEventId, deduplicated: false };
    },
    async enqueueVerifiedEvent(input) {
      calls.push({ kind: "enqueue", input });
      const deduplicated = enqueuedBusinessKeys.has(input.businessKeySha256);
      enqueuedBusinessKeys.add(input.businessKeySha256);
      workSequence += 1;
      return {
        workItemId: `66666666-6666-4666-8666-${String(workSequence).padStart(12, "0")}`,
        deduplicated,
      };
    },
  };
}

function handlerFor(repository, overrides = {}) {
  return createPlatformWahaIngressHandler({
    config: ENABLED_CONFIG,
    repository,
    now: () => NOW_MS,
    generateRequestId: internalRequestIdGenerator(),
    ...overrides,
  });
}

async function json(response) {
  return response.json();
}

async function withEnvironment(values, callback) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) process.env[key] = value;
    }
    return await callback();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("ingress is fail-closed when disabled or incompletely configured", async (t) => {
  await t.test("explicitly disabled ingress returns 503 before repository access", async () => {
    const repository = createMemoryRepository();
    const handler = createPlatformWahaIngressHandler({
      config: { enabled: false },
      repository,
    });

    const response = await handler(webhookRequest(messageEvent()));
    assert.equal(response.status, 503);
    assert.deepEqual(await json(response), { ok: false, error: "ingress_disabled" });
    assert.equal(repository.calls.length, 0);
  });

  await t.test("enabled flag with missing server configuration returns generic 503", async () => {
    await withEnvironment(
      { EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1" },
      async () => {
        const response = await createPlatformWahaIngressHandler()(
          webhookRequest(messageEvent()),
        );
        assert.equal(response.status, 503);
        assert.deepEqual(await json(response), { ok: false, error: "not_configured" });
      },
    );
  });
});

test("authentication rejects missing, malformed, stale and invalid headers", async (t) => {
  const cases = [
    ["missing request id", { headers: { "x-webhook-request-id": null } }],
    ["request id containing whitespace", { requestId: "provider request" }],
    ["missing timestamp", { headers: { "x-webhook-timestamp": null } }],
    ["non-millisecond timestamp", { timestamp: 123_456_789_012 }],
    ["stale timestamp", { timestamp: NOW_MS - MAX_CLOCK_SKEW_MS - 1 }],
    ["future timestamp outside skew", { timestamp: NOW_MS + MAX_CLOCK_SKEW_MS + 1 }],
    ["missing algorithm", { headers: { "x-webhook-hmac-algorithm": null } }],
    ["wrong algorithm casing", { algorithm: "SHA512" }],
    ["missing signature", { headers: { "x-webhook-hmac": null } }],
    ["malformed signature", { signature: "not-hex" }],
    ["wrong signature", { hmacMaterial: "synthetic-wrong-secret" }],
  ];

  for (const [name, options] of cases) {
    await t.test(name, async () => {
      const repository = createMemoryRepository();
      const response = await handlerFor(repository)(
        webhookRequest(messageEvent(), options),
      );
      assert.equal(response.status, 403);
      assert.deepEqual(await json(response), { ok: false, error: "invalid_signature" });
      assert.equal(repository.calls.length, 0);
    });
  }
});

test("body and event parsing rejects empty, malformed and unbounded shapes", async (t) => {
  const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
  const cases = [
    ["empty body", ""],
    ["malformed JSON", "{not-json"],
    ["JSON array", rawJson([])],
    ["invalid UTF-8", invalidUtf8],
    ["missing event", rawJson({ ...messageEvent(), event: undefined })],
    ["invalid event name", rawJson({ ...messageEvent(), event: "Message.Any" })],
    ["missing provider timestamp", rawJson({ ...messageEvent(), timestamp: undefined })],
    ["invalid provider timestamp", rawJson({ ...messageEvent(), timestamp: -1 })],
    [
      "message without payload id",
      rawJson({ ...messageEvent(), payload: { body: "Synthetic only" } }),
    ],
    [
      "session event without top-level id",
      rawJson({ ...sessionEvent(), id: undefined }),
    ],
  ];

  for (const [name, rawBody] of cases) {
    await t.test(name, async () => {
      const repository = createMemoryRepository();
      const response = await handlerFor(repository)(webhookRequest(rawBody));
      assert.equal(response.status, 400);
      assert.deepEqual(await json(response), { ok: false, error: "invalid_payload" });
      assert.equal(repository.calls.length, 0);
    });
  }
});

test("only the exact evo-inbox session is accepted", async (t) => {
  for (const session of ["EVO-INBOX", "evo-inbox ", "crm_primary", ""]) {
    await t.test(JSON.stringify(session), async () => {
      const repository = createMemoryRepository();
      const response = await handlerFor(repository)(
        webhookRequest(messageEvent({ session })),
      );
      assert.equal(response.status, 403);
      assert.deepEqual(await json(response), { ok: false, error: "invalid_session" });
      assert.equal(repository.calls.length, 0);
    });
  }

  await t.test("evo-inbox succeeds", async () => {
    const repository = createMemoryRepository();
    const response = await handlerFor(repository)(webhookRequest(messageEvent()));
    assert.equal(response.status, 202);
    assert.equal(repository.calls[0].input.sessionName, "evo-inbox");
  });
});

test("declared and streamed oversized bodies are rejected before persistence", async (t) => {
  await t.test("declared content length", async () => {
    const repository = createMemoryRepository();
    const handler = handlerFor(repository, {
      config: { ...ENABLED_CONFIG, maxBodyBytes: 128 },
    });
    const request = webhookRequest(messageEvent(), {
      headers: { "content-length": "129" },
    });
    const response = await handler(request);
    assert.equal(response.status, 413);
    assert.deepEqual(await json(response), { ok: false, error: "payload_too_large" });
    assert.equal(repository.calls.length, 0);
  });

  await t.test("streamed bytes without a content-length header", async () => {
    const repository = createMemoryRepository();
    const handler = handlerFor(repository, {
      config: { ...ENABLED_CONFIG, maxBodyBytes: 8 },
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.enqueue(new TextEncoder().encode("67890"));
        controller.close();
      },
    });
    const request = new Request(ENDPOINT_URL, {
      method: "POST",
      headers: {
        "x-webhook-request-id": "provider-request-stream",
        "x-webhook-timestamp": String(NOW_MS),
        "x-webhook-hmac-algorithm": "sha512",
        "x-webhook-hmac": "0".repeat(128),
      },
      body: stream,
      duplex: "half",
    });
    const response = await handler(request);
    assert.equal(response.status, 413);
    assert.deepEqual(await json(response), { ok: false, error: "payload_too_large" });
    assert.equal(repository.calls.length, 0);
  });
});

test("canonical WAHA event types retain distinct identities and normalize provider fields", async (t) => {
  const cases = [
    {
      event: messageEvent({ event: "message.any" }),
      eventType: "message.any",
      payloadId: "wamid.synthetic-message-001",
      variant: null,
    },
    {
      event: messageEvent({
        event: "message.ack",
        payload: { id: "wamid.synthetic-ack-001", ackName: "DEVICE" },
      }),
      eventType: "message.ack",
      payloadId: "wamid.synthetic-ack-001",
      variant: "device",
    },
    {
      event: sessionEvent(),
      eventType: "session.status",
      payloadId: "synthetic-session-status-001",
      variant: null,
    },
  ];

  for (const expected of cases) {
    await t.test(expected.eventType, async () => {
      const repository = createMemoryRepository();
      const response = await handlerFor(repository)(webhookRequest(expected.event));
      assert.equal(response.status, 202);
      assert.deepEqual(await json(response), {
        ok: true,
        persisted: true,
        persistDeduplicated: false,
        enqueued: true,
        enqueueDeduplicated: false,
      });

      const persisted = repository.calls[0].input;
      assert.equal(persisted.eventType, expected.eventType);
      assert.equal(persisted.payloadId, expected.payloadId);
      assert.equal(persisted.providerEventVariantRef, expected.variant);
      assert.equal(persisted.providerOccurredAt, new Date(NOW_MS).toISOString());
      assert.deepEqual(persisted.rawPayload, expected.event);
    });
  }
});

test("message alias and message.any persist and enqueue one canonical work item", async (t) => {
  for (const order of [
    ["message", "message.any"],
    ["message.any", "message"],
  ]) {
    await t.test(order.join(" then "), async () => {
      const repository = createMemoryRepository();
      const handler = handlerFor(repository);

      for (const [index, eventType] of order.entries()) {
        const event = messageEvent({ event: eventType });
        const response = await handler(
          webhookRequest(event, {
            requestId: `synthetic-alias-${index + 1}`,
          }),
        );
        assert.equal(response.status, 202);

        if (eventType === "message") {
          assert.deepEqual(await json(response), {
            ok: true,
            persisted: true,
            persistDeduplicated: false,
            enqueued: false,
            enqueueDeduplicated: null,
            ignoredReason: "message_alias_use_message_any",
          });
        } else {
          assert.deepEqual(await json(response), {
            ok: true,
            persisted: true,
            persistDeduplicated: false,
            enqueued: true,
            enqueueDeduplicated: false,
          });
        }
      }

      assert.equal(
        repository.calls.filter((call) => call.kind === "persist").length,
        2,
      );
      assert.equal(
        repository.calls.filter((call) => call.kind === "enqueue").length,
        1,
      );
      const persists = repository.calls.filter((call) => call.kind === "persist");
      assert.deepEqual(
        persists.map((call) => call.input.eventType),
        order,
      );
      assert.ok(
        persists.every(
          (call) => call.input.payloadId === "wamid.synthetic-message-001",
        ),
      );

      const canonicalPersistIndex = order.indexOf("message.any") + 1;
      const canonicalProviderEventId =
        `55555555-5555-4555-8555-${String(canonicalPersistIndex).padStart(12, "0")}`;
      const [enqueue] = repository.calls.filter((call) => call.kind === "enqueue");
      assert.equal(enqueue.input.providerWebhookEventId, canonicalProviderEventId);
    });
  }
});

test("message-only delivery persists raw evidence without enqueueing business work", async () => {
  const repository = createMemoryRepository();
  const response = await handlerFor(repository)(
    webhookRequest(messageEvent({ event: "message" }), {
      requestId: "synthetic-message-only",
    }),
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), {
    ok: true,
    persisted: true,
    persistDeduplicated: false,
    enqueued: false,
    enqueueDeduplicated: null,
    ignoredReason: "message_alias_use_message_any",
  });

  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].kind, "persist");
  assert.equal(repository.calls[0].input.eventType, "message");
  assert.equal(
    repository.calls[0].input.payloadId,
    "wamid.synthetic-message-001",
  );
});

test("message-only redelivery deduplicates raw evidence and never enqueues", async () => {
  const repository = createMemoryRepository();
  const handler = handlerFor(repository);
  const event = messageEvent({ event: "message" });

  const first = await handler(
    webhookRequest(event, { requestId: "synthetic-message-redelivery-a" }),
  );
  const second = await handler(
    webhookRequest(event, { requestId: "synthetic-message-redelivery-b" }),
  );

  assert.deepEqual(await json(first), {
    ok: true,
    persisted: true,
    persistDeduplicated: false,
    enqueued: false,
    enqueueDeduplicated: null,
    ignoredReason: "message_alias_use_message_any",
  });
  assert.deepEqual(await json(second), {
    ok: true,
    persisted: true,
    persistDeduplicated: true,
    enqueued: false,
    enqueueDeduplicated: null,
    ignoredReason: "message_alias_use_message_any",
  });

  assert.equal(
    repository.calls.filter((call) => call.kind === "persist").length,
    2,
  );
  assert.equal(
    repository.calls.filter((call) => call.kind === "enqueue").length,
    0,
  );
});

test("message acknowledgement states are exact and unknown values remain explicit", async (t) => {
  for (const ackName of ["ERROR", "PENDING", "SERVER", "DEVICE", "READ", "PLAYED"]) {
    await t.test(ackName, async () => {
      const event = messageEvent({
        event: "message.ack",
        payload: { id: `wamid.synthetic-${ackName.toLowerCase()}`, ackName },
      });
      const normalized = parsePlatformWahaWebhookEvent(
        new TextEncoder().encode(rawJson(event)),
        "evo-inbox",
      );
      assert.equal(normalized.providerEventVariantRef, ackName.toLowerCase());
      assert.equal(normalized.processable, true);
    });
  }

  for (const ackName of ["device", "UNKNOWN", "", undefined, 3]) {
    await t.test(`unknown ${JSON.stringify(ackName)}`, () => {
      const normalized = parsePlatformWahaWebhookEvent(
        new TextEncoder().encode(
          rawJson({
            ...messageEvent(),
            event: "message.ack",
            payload: { id: "wamid.synthetic-unknown-ack", ackName },
          }),
        ),
        "evo-inbox",
      );
      assert.equal(normalized.providerEventVariantRef, "unknown");
    });
  }
});

test("unknown signed events are persisted as raw evidence but never enqueued", async () => {
  const repository = createMemoryRepository();
  const handler = handlerFor(repository);
  const event = {
    event: "future.receipt",
    id: "synthetic-future-event-001",
    session: "evo-inbox",
    timestamp: NOW_MS,
    payload: { opaque: true },
  };

  const response = await handler(webhookRequest(event));
  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), {
    ok: true,
    persisted: true,
    persistDeduplicated: false,
    enqueued: false,
    enqueueDeduplicated: null,
  });
  assert.deepEqual(repository.calls.map((call) => call.kind), ["persist"]);
  assert.equal(repository.calls[0].input.eventType, "future.receipt");
  assert.deepEqual(repository.calls[0].input.rawPayload, event);
});

test("persistence completes before pointer-only enqueue", async () => {
  const sequence = [];
  const repository = {
    async persistVerifiedEvent() {
      sequence.push("persist:start");
      await Promise.resolve();
      sequence.push("persist:complete");
      return { providerWebhookEventId: PROVIDER_EVENT_ID, deduplicated: false };
    },
    async enqueueVerifiedEvent(input) {
      sequence.push("enqueue");
      assert.deepEqual(Object.keys(input).sort(), [
        "businessKeySha256",
        "organizationId",
        "providerWebhookEventId",
        "requestId",
      ]);
      assert.equal(input.organizationId, ORGANIZATION_ID);
      assert.equal(input.providerWebhookEventId, PROVIDER_EVENT_ID);
      assert.match(input.businessKeySha256, /^[0-9a-f]{64}$/);
      assert.equal("rawPayload" in input, false);
      assert.equal("providerRequestId" in input, false);
      assert.equal("supabaseSecretKey" in input, false);
      return { workItemId: WORK_ITEM_ID, deduplicated: false };
    },
  };

  const response = await handlerFor(repository)(webhookRequest(messageEvent()));
  assert.equal(response.status, 202);
  assert.deepEqual(sequence, ["persist:start", "persist:complete", "enqueue"]);
});

test("same request id and a fresh request id for the same business event deduplicate", async () => {
  const repository = createMemoryRepository();
  const handler = handlerFor(repository);
  const rawBody = rawJson(messageEvent());

  const first = await handler(webhookRequest(rawBody, { requestId: "provider-request-a" }));
  assert.equal(first.status, 202);
  assert.equal((await json(first)).persistDeduplicated, false);

  const requestReplay = await handler(
    webhookRequest(rawBody, { requestId: "provider-request-a" }),
  );
  assert.equal(requestReplay.status, 202);
  assert.deepEqual(await json(requestReplay), {
    ok: true,
    persisted: true,
    persistDeduplicated: true,
    enqueued: true,
    enqueueDeduplicated: true,
  });

  const businessReplay = await handler(
    webhookRequest(rawBody, { requestId: "provider-request-b" }),
  );
  assert.equal(businessReplay.status, 202);
  assert.deepEqual(await json(businessReplay), {
    ok: true,
    persisted: true,
    persistDeduplicated: true,
    enqueued: true,
    enqueueDeduplicated: true,
  });

  const persists = repository.calls.filter((call) => call.kind === "persist");
  assert.equal(persists.length, 3);
  assert.deepEqual(
    persists.map((call) => call.input.providerRequestId),
    ["provider-request-a", "provider-request-a", "provider-request-b"],
  );
});

test("verification metadata and evidence remain stable without copying volatile headers or secrets", async () => {
  const repository = createMemoryRepository();
  const handler = handlerFor(repository);
  const rawBody = rawJson(messageEvent());
  const firstSignature = sign(rawBody);

  await handler(
    webhookRequest(rawBody, {
      requestId: "provider-request-stable-a",
      timestamp: NOW_MS - 1_000,
      signature: firstSignature,
    }),
  );
  await handler(
    webhookRequest(rawBody, {
      requestId: "provider-request-stable-b",
      timestamp: NOW_MS + 1_000,
      signature: firstSignature,
    }),
  );

  const persists = repository.calls.filter((call) => call.kind === "persist");
  assert.equal(persists.length, 2);
  const first = persists[0].input;
  const second = persists[1].input;
  assert.deepEqual(first.verificationHeaders, platformWahaVerificationHeaders());
  assert.deepEqual(second.verificationHeaders, first.verificationHeaders);
  assert.equal(second.verificationEvidenceRef, first.verificationEvidenceRef);
  assert.match(first.verificationEvidenceRef, /^waha-raw-sha256:[0-9a-f]{64}$/);

  const stableEvidence = JSON.stringify({
    verificationHeaders: first.verificationHeaders,
    verificationEvidenceRef: first.verificationEvidenceRef,
  });
  for (const volatileOrSecret of [
    "provider-request-stable-a",
    "provider-request-stable-b",
    String(NOW_MS - 1_000),
    String(NOW_MS + 1_000),
    firstSignature,
    WEBHOOK_SECRET,
    SERVICE_SECRET,
  ]) {
    assert.equal(stableEvidence.includes(volatileOrSecret), false);
  }
});

test("Supabase adapter enqueues only a work pointer and validates the RPC proof", async () => {
  const calls = [];
  const client = {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(functionName, args) {
          calls.push({ functionName, args });
          if (functionName === "persist_provider_webhook_event") {
            return {
              data: {
                provider_webhook_event_id: PROVIDER_EVENT_ID,
                organization_id: ORGANIZATION_ID,
                provider: "waha",
                provider_account_ref: "waha:evo-inbox",
                provider_conversation_ref: null,
                provider_event_variant_ref: null,
                observed_provider_request_id: "provider-request-adapter",
                waha_session_name: "evo-inbox",
                payload_id: "wamid.synthetic-adapter-001",
                event_type: "message.any",
                provider_occurred_at: new Date(NOW_MS).toISOString(),
                verification_status: "verified",
                verification_evidence_ref: `waha-raw-sha256:${"a".repeat(64)}`,
                payload_sha256: "a".repeat(64),
                persisted_before_processing: true,
                deduplicated: false,
              },
              error: null,
            };
          }
          assert.equal(functionName, "enqueue_verified_webhook_work");
          return {
            data: {
              work_item_id: WORK_ITEM_ID,
              organization_id: ORGANIZATION_ID,
              kind: "provider_webhook_process",
              source_webhook_event_id: PROVIDER_EVENT_ID,
              business_key_sha256: "b".repeat(64),
              max_attempts: 8,
              queue_payload_is_pointer_only: true,
              deduplicated: false,
            },
            error: null,
          };
        },
      };
    },
  };
  const repository = createPlatformWahaIngressRepository(client);
  await repository.persistVerifiedEvent({
    organizationId: ORGANIZATION_ID,
    providerRequestId: "provider-request-adapter",
    sessionName: "evo-inbox",
    payloadId: "wamid.synthetic-adapter-001",
    eventType: "message.any",
    providerOccurredAt: new Date(NOW_MS).toISOString(),
    providerEventVariantRef: null,
    rawPayload: messageEvent(),
    verificationHeaders: platformWahaVerificationHeaders(),
    verificationEvidenceRef: `waha-raw-sha256:${"a".repeat(64)}`,
    payloadSha256: "a".repeat(64),
    requestId: "77777777-7777-4777-8777-777777777777",
  });
  await repository.enqueueVerifiedEvent({
    organizationId: ORGANIZATION_ID,
    providerWebhookEventId: PROVIDER_EVENT_ID,
    businessKeySha256: "b".repeat(64),
    requestId: "88888888-8888-4888-8888-888888888888",
  });

  assert.equal(calls.length, 2);
  const queueCall = calls[1];
  assert.equal(queueCall.functionName, "enqueue_verified_webhook_work");
  assert.deepEqual(Object.keys(queueCall.args).sort(), [
    "p_business_key_sha256",
    "p_max_attempts",
    "p_organization_id",
    "p_request_id",
    "p_source_webhook_event_id",
  ]);
  assert.equal(queueCall.args.p_source_webhook_event_id, PROVIDER_EVENT_ID);
  assert.equal(queueCall.args.p_max_attempts, 8);
  assert.equal("p_raw_payload" in queueCall.args, false);
  assert.equal("p_provider_request_id" in queueCall.args, false);
});

test("browser and anon credentials fail closed without exposing credential values", async (t) => {
  const unsafeKeys = [
    ["sb", "publishable", "synthetic_browser_key"].join("_"),
    ["sb", "anon", "synthetic_browser_key"].join("_"),
    `synthetic.${Buffer.from(rawJson({ role: "anon" })).toString("base64url")}.signature`,
  ];

  for (const unsafeKey of unsafeKeys) {
    await t.test(unsafeKey.split("_").slice(0, 2).join("_"), async () => {
      await withEnvironment(
        {
          EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1",
          EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
          NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.invalid",
          EVO_PLATFORM_SUPABASE_SECRET_KEY: unsafeKey,
          EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: WEBHOOK_SECRET,
        },
        async () => {
          assert.throws(
            () => getPlatformWahaIngressConfig(),
            (error) => {
              assert.equal(error instanceof PlatformWahaIngressConfigurationError, true);
              assert.equal(error.code, "unsafe_supabase_secret_key");
              assert.equal(error.message.includes(unsafeKey), false);
              return true;
            },
          );

          const response = await createPlatformWahaIngressHandler()(
            webhookRequest(messageEvent()),
          );
          const body = JSON.stringify(await json(response));
          assert.equal(response.status, 503);
          assert.equal(body.includes(unsafeKey), false);
          assert.equal(body.includes(WEBHOOK_SECRET), false);
        },
      );
    });
  }
});

test("canonical and alias persistence failures stay fail-closed and redact details", async (t) => {
  const repository = {
    async persistVerifiedEvent() {
      throw new Error(`provider failed with ${SERVICE_SECRET} and ${WEBHOOK_SECRET}`);
    },
    async enqueueVerifiedEvent() {
      throw new PlatformWahaIngressRepositoryError();
    },
  };
  for (const eventType of ["message.any", "message"]) {
    await t.test(eventType, async () => {
      const response = await handlerFor(repository)(
        webhookRequest(messageEvent({ event: eventType })),
      );
      const responseBody = JSON.stringify(await json(response));
      assert.equal(response.status, 503);
      assert.equal(responseBody.includes(SERVICE_SECRET), false);
      assert.equal(responseBody.includes(WEBHOOK_SECRET), false);
      assert.deepEqual(JSON.parse(responseBody), {
        ok: false,
        error: "temporarily_unavailable",
      });
    });
  }
});

test("receive-only implementation has no send, SQLite, amoCRM or silent provider fallback", async () => {
  const paths = [
    "../src/lib/server/platform-waha-ingress-config.ts",
    "../src/lib/server/platform-waha-webhook.ts",
    "../src/lib/server/platform-waha-ingress-repository.ts",
    "../src/lib/server/platform-supabase-service-client.ts",
    "../src/app/api/internal/platform-messaging/waha/events/route.ts",
  ];
  const source = (
    await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")))
  ).join("\n");

  for (const forbidden of [
    /\/api\/send(?:Text|Seen|Message)?/i,
    /\bfetch\s*\(/,
    /\baxios\b/i,
    /better-sqlite3|\bsqlite\b/i,
    /\bprisma\b/i,
    /\bamocrm\b|\bkommo\b/i,
    /lead-agent/i,
    /provider[_ -]?fallback|silent[_ -]?fallback/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
