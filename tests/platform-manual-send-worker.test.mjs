import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  loadPlatformManualSendConfig,
  PlatformManualSendConfigurationError,
} from "../src/lib/server/platform-manual-send-config.ts";
import {
  createPlatformManualSendHandler,
  PlatformManualSendRepositoryError,
} from "../src/lib/server/platform-manual-send-processor.ts";
import { createPlatformManualSendWahaClient } from "../src/lib/server/platform-manual-send-waha-client.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const WORK_ITEM_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const AUTHORIZATION_ID = "44444444-4444-4444-8444-444444444444";
const CONVERSATION_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_MESSAGE_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const NOW_MS = 1_787_010_000_000;
const FINAL_TEXT = "Approved non-customer test message";
const FINAL_TEXT_SHA256 = createHash("sha256")
  .update(FINAL_TEXT, "utf8")
  .digest("hex");
const TRIGGER_SECRET = "synthetic-manual-send-trigger-secret-value-only";
const SUPABASE_SECRET = ["sb", "secret", "synthetic_server_test_key_only"].join(
  "_",
);
const MIGRATION_URL = new URL(
  "../supabase/migrations/077_platform_manual_whatsapp_send_worker.sql",
  import.meta.url,
);

function enabledEnvironment(overrides = {}) {
  return {
    EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED: "1",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SUPABASE_SECRET,
    EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET: TRIGGER_SECRET,
    ...overrides,
  };
}

function claimedWork(overrides = {}) {
  return {
    claimed: true,
    organizationId: ORGANIZATION_ID,
    workItemId: WORK_ITEM_ID,
    attemptId: ATTEMPT_ID,
    authorizationId: AUTHORIZATION_ID,
    conversationId: CONVERSATION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    wahaSessionName: "crm_primary",
    chatId: "996700000001@c.us",
    replyTo: "false_996700000001@c.us_AAAAAAAAAAAAAAAAAAAA",
    finalText: FINAL_TEXT,
    finalTextSha256: FINAL_TEXT_SHA256,
    attemptNumber: 1,
    maxAttempts: 1,
    leaseExpiresAt: "2026-08-18T02:00:00.000Z",
    ...overrides,
  };
}

test("manual WAHA send serializes only the exact approved provider fields", async () => {
  const calls = [];
  const client = createPlatformManualSendWahaClient(
    {
      baseUrl: "http://evo-crm-waha:3000",
      apiKey: ["synthetic", "private", "waha", "key"].join("-"),
    },
    async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ id: "false_996700000001@c.us_BBBBBBBBBBBBBBBBBBBB" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  await client.sendText({
    session: "crm_primary",
    chatId: "996700000001@c.us",
    replyTo: "false_996700000001@c.us_AAAAAAAAAAAAAAAAAAAA",
    text: FINAL_TEXT,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://evo-crm-waha:3000/api/sendText");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    session: "crm_primary",
    chatId: "996700000001@c.us",
    text: FINAL_TEXT,
  });
});

function memoryRepository(claimResult = claimedWork()) {
  const calls = [];
  return {
    calls,
    async claim(input) {
      calls.push(["claim", input]);
      return claimResult;
    },
    async finish(input) {
      calls.push(["finish", input]);
      return {
        organizationId: ORGANIZATION_ID,
        workItemId: WORK_ITEM_ID,
        attemptId: ATTEMPT_ID,
        outcome: input.outcome,
        state:
          input.outcome === "succeeded"
            ? "succeeded"
            : "reconciliation_required",
      };
    },
  };
}

function provider(overrides = {}) {
  const calls = [];
  return {
    calls,
    async preflight() {
      calls.push(["preflight"]);
      return { ready: true };
    },
    async sendText(input) {
      calls.push(["sendText", input]);
      return { providerMessageId: "safe-provider-message-id" };
    },
    ...overrides,
  };
}

function signedRequest({ signature = true, body } = {}) {
  const timestamp = String(NOW_MS);
  const headers = {
    "x-evo-manual-send-request-id": REQUEST_ID,
    "x-evo-manual-send-timestamp": timestamp,
    "x-evo-manual-send-hmac-algorithm": "sha256",
    "x-evo-manual-send-hmac": signature
      ? createHmac("sha256", TRIGGER_SECRET)
          .update(`${REQUEST_ID}.${timestamp}`, "utf8")
          .digest("hex")
      : "0".repeat(64),
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://evo-crm-app:3000/api/internal/platform-messaging/manual-send/work", {
    method: "POST",
    headers,
    body,
  });
}

test("manual send execution is disabled by default and enabled config is closed", () => {
  assert.deepEqual(loadPlatformManualSendConfig({}), { enabled: false });
  const config = loadPlatformManualSendConfig(enabledEnvironment());
  assert.equal(config.enabled, true);
  assert.equal(config.organizationId, ORGANIZATION_ID);
  assert.equal(config.visibilityTimeoutSeconds, 60);
  assert.equal(config.maxClockSkewMs, 30_000);

  assert.throws(
    () =>
      loadPlatformManualSendConfig(
        enabledEnvironment({ EVO_PLATFORM_ORGANIZATION_ID: undefined }),
      ),
    (error) =>
      error instanceof PlatformManualSendConfigurationError &&
      error.code === "missing_organization_id",
  );
});

test("manual send route rejects bad HMAC and request bodies before provider or queue work", async () => {
  for (const request of [
    signedRequest({ signature: false }),
    signedRequest({ body: "{}" }),
  ]) {
    const repository = memoryRepository();
    const transport = provider();
    const response = await createPlatformManualSendHandler({
      config: loadPlatformManualSendConfig(enabledEnvironment()),
      repository,
      provider: transport,
      nowMs: () => NOW_MS,
    })(request);
    assert.ok(response.status === 400 || response.status === 401);
    assert.equal(repository.calls.length, 0);
    assert.equal(transport.calls.length, 0);
  }
});

test("provider readiness is proven before the durable claim", async () => {
  const repository = memoryRepository();
  const transport = provider({
    async preflight() {
      this.calls.push(["preflight"]);
      return { ready: false, reasonCode: "session_not_working" };
    },
  });
  const response = await createPlatformManualSendHandler({
    config: loadPlatformManualSendConfig(enabledEnvironment()),
    repository,
    provider: transport,
    nowMs: () => NOW_MS,
  })(signedRequest());
  assert.equal(response.status, 503);
  assert.deepEqual(repository.calls, []);
});

test("an empty manual lane performs no send", async () => {
  const repository = memoryRepository({ claimed: false, queue: "platform_work_v1" });
  const transport = provider();
  const response = await createPlatformManualSendHandler({
    config: loadPlatformManualSendConfig(enabledEnvironment()),
    repository,
    provider: transport,
    nowMs: () => NOW_MS,
  })(signedRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, processed: false });
  assert.deepEqual(transport.calls.map(([name]) => name), ["preflight"]);
});

test("one authorized manual item sends once and records provider acknowledgement", async () => {
  const repository = memoryRepository();
  const transport = provider();
  const response = await createPlatformManualSendHandler({
    config: loadPlatformManualSendConfig(enabledEnvironment()),
    repository,
    provider: transport,
    nowMs: () => NOW_MS,
    nowIso: () => "2026-08-18T01:30:00.000Z",
  })(signedRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    processed: true,
    state: "succeeded",
  });
  assert.deepEqual(transport.calls.at(-1), [
    "sendText",
    {
      session: "crm_primary",
      chatId: "996700000001@c.us",
      replyTo: "false_996700000001@c.us_AAAAAAAAAAAAAAAAAAAA",
      text: FINAL_TEXT,
    },
  ]);
  assert.equal(repository.calls.at(-1)[0], "finish");
  assert.equal(repository.calls.at(-1)[1].outcome, "succeeded");
  assert.equal(
    repository.calls.at(-1)[1].providerMessageId,
    "safe-provider-message-id",
  );
});

test("invalid claim identity fails before send and leaves the lease for reconciliation", async () => {
  const repository = memoryRepository(
    claimedWork({ finalTextSha256: "0".repeat(64) }),
  );
  const transport = provider();
  const response = await createPlatformManualSendHandler({
    config: loadPlatformManualSendConfig(enabledEnvironment()),
    repository,
    provider: transport,
    nowMs: () => NOW_MS,
  })(signedRequest());
  assert.equal(response.status, 503);
  assert.deepEqual(transport.calls.map(([name]) => name), ["preflight"]);
  assert.equal(repository.calls.filter(([name]) => name === "finish").length, 0);
});

test("provider rejection is terminal and ambiguous delivery is never retried", async () => {
  for (const [kind, expectedOutcome] of [
    ["rejected", "terminal_error"],
    ["unknown", "unknown_result"],
  ]) {
    const repository = memoryRepository();
    const transport = provider({
      async sendText(input) {
        this.calls.push(["sendText", input]);
        const error = new Error("safe provider failure");
        error.kind = kind;
        error.code = kind === "rejected" ? "provider_rejected" : "provider_timeout";
        throw error;
      },
    });
    const response = await createPlatformManualSendHandler({
      config: loadPlatformManualSendConfig(enabledEnvironment()),
      repository,
      provider: transport,
      nowMs: () => NOW_MS,
    })(signedRequest());
    assert.equal(response.status, 200);
    assert.equal(repository.calls.at(-1)[1].outcome, expectedOutcome);
    assert.equal(transport.calls.filter(([name]) => name === "sendText").length, 1);
  }
});

test("repository programming errors never trigger a second provider call", async () => {
  const repository = memoryRepository();
  repository.finish = async () => {
    throw new PlatformManualSendRepositoryError();
  };
  const transport = provider();
  const response = await createPlatformManualSendHandler({
    config: loadPlatformManualSendConfig(enabledEnvironment()),
    repository,
    provider: transport,
    nowMs: () => NOW_MS,
  })(signedRequest());
  assert.equal(response.status, 503);
  assert.equal(transport.calls.filter(([name]) => name === "sendText").length, 1);
});

test("migration closes the manual-send lane and preserves provider identity privately", async () => {
  const migration = await readFile(MIGRATION_URL, "utf8");

  assert.match(migration, /CREATE OR REPLACE FUNCTION platform\.claim_manual_whatsapp_send\(/);
  assert.match(
    migration,
    /p2g_replay_request\([\s\S]*IF replayed IS NOT NULL THEN[\s\S]*'claimed', FALSE[\s\S]*'queue', 'platform_work_v1'/,
  );
  assert.match(migration, /item\.kind = 'manual_whatsapp_send'/);
  assert.match(migration, /p2g_open_unknown_review/);
  assert.match(migration, /CREATE TABLE platform_private\.manual_send_provider_bindings/);
  assert.match(migration, /message_identity_source = 'private_manual_send_binding'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION platform\.finish_manual_whatsapp_send\(/);
  assert.match(migration, /platform\.finish_durable_work\(/);
  assert.match(migration, /REVOKE ALL ON FUNCTION platform\.claim_manual_whatsapp_send/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION platform\.finish_manual_whatsapp_send[\s\S]*service_role/,
  );
});
