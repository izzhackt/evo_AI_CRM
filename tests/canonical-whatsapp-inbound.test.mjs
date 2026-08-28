import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  createCanonicalWhatsAppInboundHandler,
} from "../src/lib/server/canonical-whatsapp-inbound.ts";
import { CanonicalCrmRepositoryError } from "../src/lib/server/canonical-crm-repository.ts";

const TEST_HMAC_MATERIAL = "local-v2-hmac-material-for-tests";
const NOW_SECONDS = 1_788_000_000;
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";

function payload(overrides = {}) {
  return {
    event: "message.received",
    senderPhone: "+996555123456",
    externalConversationId: "wa-conversation-42",
    externalMessageId: "wa-message-99",
    text: "Need help with my application",
    occurredAt: "2026-08-28T15:20:30.000Z",
    ...overrides,
  };
}

function signature(timestamp, rawBody, secret = TEST_HMAC_MATERIAL) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

function signedRequest(value = payload(), options = {}) {
  const rawBody = options.rawBody ?? JSON.stringify(value);
  const timestamp = String(options.timestamp ?? NOW_SECONDS);
  const headers = new Headers({
    "content-type": options.contentType ?? "application/json",
    "x-evo-v2-timestamp": timestamp,
    "x-evo-v2-signature":
      options.signature ?? signature(timestamp, rawBody, options.secret),
  });
  for (const [name, headerValue] of Object.entries(options.headers ?? {})) {
    if (headerValue === null) headers.delete(name);
    else headers.set(name, headerValue);
  }
  return new Request("http://local.test/api/v2/whatsapp/inbound", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function signedByteRequest(rawBody) {
  const timestamp = String(NOW_SECONDS);
  const requestSignature = createHmac("sha256", TEST_HMAC_MATERIAL)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest("hex");
  return new Request("http://local.test/api/v2/whatsapp/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-evo-v2-timestamp": timestamp,
      "x-evo-v2-signature": requestSignature,
    },
    body: rawBody,
  });
}

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    values: {
      getSecret: () => TEST_HMAC_MATERIAL,
      now: () => NOW_SECONDS * 1_000,
      createPersonLead: async (input) => {
        calls.push(["createPersonLead", input]);
        return {
          leadId: LEAD_ID,
          personId: "44444444-4444-4444-8444-444444444444",
        };
      },
      appendInboundMessage: async (input) => {
        calls.push(["appendInboundMessage", input]);
        return {
          leadId: LEAD_ID,
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
        };
      },
      ...overrides,
    },
  };
}

async function responseJson(response) {
  return response.json();
}

test("a valid signed event enters the canonical Sales workflow with stable identities", async () => {
  const repository = dependencies();
  const handler = createCanonicalWhatsAppInboundHandler(repository.values);

  const response = await handler(signedRequest());

  assert.equal(response.status, 202);
  assert.deepEqual(await responseJson(response), {
    ok: true,
    leadId: LEAD_ID,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
  });
  assert.deepEqual(repository.calls, [
    [
      "createPersonLead",
      {
        actorRole: "sales",
        idempotencyKey:
          "wa-lead:b743ee3356eb69a37d48ea48491c1298650dc5cd1862c2100f8394b2a9f881d4",
        correlationId:
          "wa:d41a6a6cc8f9ceed18b2e87d8c9169d9669e99824de5cd8a780826d766f45b4b",
        displayName: "WhatsApp ••••3456",
        phone: "+996555123456",
        source: "whatsapp",
      },
    ],
    [
      "appendInboundMessage",
      {
        actorRole: "sales",
        idempotencyKey:
          "wa-msg:d41a6a6cc8f9ceed18b2e87d8c9169d9669e99824de5cd8a780826d766f45b4b",
        correlationId:
          "wa:d41a6a6cc8f9ceed18b2e87d8c9169d9669e99824de5cd8a780826d766f45b4b",
        leadId: LEAD_ID,
        channel: "whatsapp",
        externalConversationId: "wa-conversation-42",
        externalMessageId: "wa-message-99",
        body: "Need help with my application",
        occurredAt: "2026-08-28T15:20:30.000Z",
      },
    ],
  ]);
});

test("missing, malformed, mismatched or stale authentication is rejected before canonical writes", async (t) => {
  const cases = [
    [
      "missing timestamp",
      { headers: { "x-evo-v2-timestamp": null } },
    ],
    [
      "missing signature",
      { headers: { "x-evo-v2-signature": null } },
    ],
    ["non-decimal timestamp", { timestamp: "now" }],
    ["uppercase hex signature", { signature: "A".repeat(64) }],
    ["wrong signature", { signature: "0".repeat(64) }],
    ["stale timestamp", { timestamp: NOW_SECONDS - 301 }],
    ["future timestamp", { timestamp: NOW_SECONDS + 301 }],
  ];

  for (const [name, options] of cases) {
    await t.test(name, async () => {
      const repository = dependencies();
      const handler = createCanonicalWhatsAppInboundHandler(repository.values);

      const response = await handler(signedRequest(payload(), options));

      assert.equal(response.status, 403);
      assert.deepEqual(await responseJson(response), {
        ok: false,
        error: "forbidden",
      });
      assert.deepEqual(repository.calls, []);
    });
  }
});

test("the route fails closed when its private server secret is absent", async () => {
  const repository = dependencies({ getSecret: () => "   " });
  const handler = createCanonicalWhatsAppInboundHandler(repository.values);

  const response = await handler(signedRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(await responseJson(response), {
    ok: false,
    error: "inbound_unavailable",
  });
  assert.deepEqual(repository.calls, []);
});

test("only application/json bodies enter the signed inbound boundary", async (t) => {
  for (const contentType of [
    "text/plain",
    "application/problem+json",
    "application/octet-stream",
  ]) {
    await t.test(contentType, async () => {
      const repository = dependencies();
      const handler = createCanonicalWhatsAppInboundHandler(repository.values);

      const response = await handler(signedRequest(payload(), { contentType }));

      assert.equal(response.status, 415);
      assert.deepEqual(await responseJson(response), {
        ok: false,
        error: "unsupported_media_type",
      });
      assert.deepEqual(repository.calls, []);
    });
  }

  const repository = dependencies();
  const accepted = await createCanonicalWhatsAppInboundHandler(repository.values)(
    signedRequest(payload(), { contentType: "application/json; charset=utf-8" }),
  );
  assert.equal(accepted.status, 202);
});

test("a request body larger than 64 KiB is rejected before authentication or writes", async () => {
  const repository = dependencies();
  const handler = createCanonicalWhatsAppInboundHandler(repository.values);
  const rawBody = "x".repeat(64 * 1024 + 1);

  const response = await handler(signedRequest(undefined, { rawBody }));

  assert.equal(response.status, 413);
  assert.deepEqual(await responseJson(response), {
    ok: false,
    error: "payload_too_large",
  });
  assert.deepEqual(repository.calls, []);
});

test("malformed or non-canonical event payloads are rejected before canonical writes", async (t) => {
  const invalidCases = [
    ["empty body", undefined, { rawBody: "" }],
    ["malformed JSON", undefined, { rawBody: "{not-json" }],
    ["array", []],
    ["unknown field", { ...payload(), providerName: "untrusted" }],
    ["missing field", { ...payload(), text: undefined }],
    ["wrong event", payload({ event: "message.sent" })],
    ["non-E.164 phone", payload({ senderPhone: "996 555 123456" })],
    ["country code starts with zero", payload({ senderPhone: "+01234567" })],
    ["phone too short", payload({ senderPhone: "+123456" })],
    ["empty conversation id", payload({ externalConversationId: "   " })],
    [
      "controlled message id",
      payload({ externalMessageId: "message\u0000id" }),
    ],
    [
      "unbounded conversation id",
      payload({ externalConversationId: "c".repeat(256) }),
    ],
    ["blank text", payload({ text: " \r\n " })],
    ["non-UTC timestamp", payload({ occurredAt: "2026-08-28T19:20:30+04:00" })],
    ["impossible timestamp", payload({ occurredAt: "2026-02-30T15:20:30Z" })],
  ];

  for (const [name, value, options = {}] of invalidCases) {
    await t.test(name, async () => {
      const repository = dependencies();
      const handler = createCanonicalWhatsAppInboundHandler(repository.values);

      const response = await handler(signedRequest(value, options));

      assert.equal(response.status, 400);
      assert.deepEqual(await responseJson(response), {
        ok: false,
        error: "invalid_request",
      });
      assert.deepEqual(repository.calls, []);
    });
  }
});

test("signed bytes that are not valid UTF-8 JSON are rejected before canonical writes", async () => {
  const repository = dependencies();
  const handler = createCanonicalWhatsAppInboundHandler(repository.values);

  const response = await handler(
    signedByteRequest(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await responseJson(response), {
    ok: false,
    error: "invalid_request",
  });
  assert.deepEqual(repository.calls, []);
});

test("accepted payload text and identifiers are normalized before canonical commands", async () => {
  const repository = dependencies();
  const handler = createCanonicalWhatsAppInboundHandler(repository.values);
  const response = await handler(
    signedRequest(
      payload({
        externalConversationId: "  wa-conversation-42  ",
        externalMessageId: "  wa-message-99  ",
        text: "  First line\r\nSecond line  ",
        occurredAt: "2026-08-28T15:20:30Z",
      }),
    ),
  );

  assert.equal(response.status, 202);
  const [, messageInput] = repository.calls[1];
  assert.equal(messageInput.externalConversationId, "wa-conversation-42");
  assert.equal(messageInput.externalMessageId, "wa-message-99");
  assert.equal(messageInput.body, "First line\nSecond line");
  assert.equal(messageInput.occurredAt, "2026-08-28T15:20:30.000Z");
});

test("exact delivery retries keep the same canonical command identities and response IDs", async () => {
  const repository = dependencies();
  const handler = createCanonicalWhatsAppInboundHandler(repository.values);

  const first = await handler(signedRequest());
  const replay = await handler(signedRequest());

  assert.equal(first.status, 202);
  assert.equal(replay.status, 202);
  assert.deepEqual(await responseJson(first), await responseJson(replay));
  assert.equal(repository.calls.length, 4);
  assert.deepEqual(repository.calls[0][1], repository.calls[2][1]);
  assert.deepEqual(repository.calls[1][1], repository.calls[3][1]);
});

test("changed content under the same provider message identity returns a safe conflict", async () => {
  let acceptedBody = null;
  const repository = dependencies({
    appendInboundMessage: async (input) => {
      if (acceptedBody === null) acceptedBody = input.body;
      else if (acceptedBody !== input.body) {
        throw new CanonicalCrmRepositoryError("idempotency_conflict");
      }
      return {
        leadId: LEAD_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
      };
    },
  });
  const handler = createCanonicalWhatsAppInboundHandler(repository.values);
  assert.equal((await handler(signedRequest())).status, 202);

  const response = await handler(
    signedRequest(payload({ text: "Changed content" })),
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await responseJson(response), {
    ok: false,
    error: "conflict",
  });
});

test("canonical and unexpected failures map to stable non-sensitive responses", async (t) => {
  const cases = [
    [
      "invalid canonical input",
      new CanonicalCrmRepositoryError("invalid_input"),
      400,
      "invalid_request",
    ],
    [
      "canonical conflict",
      new CanonicalCrmRepositoryError("conflict"),
      409,
      "conflict",
    ],
    [
      "missing canonical object",
      new CanonicalCrmRepositoryError("not_found"),
      409,
      "conflict",
    ],
    [
      "database unavailable",
      new CanonicalCrmRepositoryError("unavailable"),
      503,
      "inbound_unavailable",
    ],
    [
      "unexpected failure",
      new Error(`${TEST_HMAC_MATERIAL} Need help with my application`),
      500,
      "internal_error",
    ],
  ];

  for (const [name, failure, status, errorCode] of cases) {
    await t.test(name, async () => {
      const repository = dependencies({
        createPersonLead: async () => {
          throw failure;
        },
      });
      const response = await createCanonicalWhatsAppInboundHandler(
        repository.values,
      )(signedRequest());
      const serialized = await response.text();

      assert.equal(response.status, status);
      assert.deepEqual(JSON.parse(serialized), {
        ok: false,
        error: errorCode,
      });
      assert.equal(serialized.includes(TEST_HMAC_MATERIAL), false);
      assert.equal(serialized.includes("Need help with my application"), false);
    });
  }
});
