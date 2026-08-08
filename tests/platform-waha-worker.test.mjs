import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  loadPlatformWahaWorkerConfig,
  PlatformWahaWorkerConfigurationError,
} from "../src/lib/server/platform-waha-worker-config.ts";
import {
  createPlatformWahaWorkHandler,
  createPlatformWahaWorkRepository,
} from "../src/lib/server/platform-waha-work-processor.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111112";
const INTAKE_SALES_MEMBERSHIP_ID =
  "22222222-2222-4222-8222-222222222222";
const WORK_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const SOURCE_EVENT_ID = "55555555-5555-4555-8555-555555555555";
const TRIGGER_SECRET = "synthetic-worker-trigger-secret-only";
const TRIGGER_REQUEST_ID = "66666666-6666-4666-8666-666666666661";
const NOW_MS = 1_786_079_400_000;
const SERVICE_SECRET = ["sb", "secret", "synthetic_server_test_key_only"].join("_");
const ENDPOINT_URL =
  "http://localhost/api/internal/platform-messaging/waha/work";

const ENABLED_CONFIG = Object.freeze({
  enabled: true,
  organizationId: ORGANIZATION_ID,
  supabaseUrl: "http://127.0.0.1:54321",
  supabaseSecretKey: SERVICE_SECRET,
  intakeSalesMembershipId: INTAKE_SALES_MEMBERSHIP_ID,
  triggerSecret: TRIGGER_SECRET,
  workerRef: "nextjs:p5b-waha-projection",
  visibilityTimeoutSeconds: 60,
  retryDelaySeconds: 30,
});

function authorizedRequest(options = {}) {
  const headers = new Headers(options.headers);
  const timestamp = String(options.timestamp ?? NOW_MS);
  const requestId = options.requestId ?? TRIGGER_REQUEST_ID;
  headers.set("x-evo-worker-request-id", requestId);
  headers.set("x-evo-worker-timestamp", timestamp);
  headers.set("x-evo-worker-hmac-algorithm", "sha256");
  headers.set(
    "x-evo-worker-hmac",
    createHmac("sha256", options.secret ?? TRIGGER_SECRET)
      .update(`${requestId}.${timestamp}`)
      .digest("hex"),
  );
  return new Request(ENDPOINT_URL, {
    method: "POST",
    headers,
    body: options.body,
  });
}

function claim(overrides = {}) {
  return Object.freeze({
    claimed: true,
    organizationId: ORGANIZATION_ID,
    workItemId: WORK_ITEM_ID,
    attemptId: ATTEMPT_ID,
    sourceWebhookEventId: SOURCE_EVENT_ID,
    queueMessageId: "1",
    attemptNumber: 1,
    maxAttempts: 12,
    leaseExpiresAt: "2026-08-07T04:30:00Z",
    ...overrides,
  });
}

function projection(disposition = "succeeded") {
  return Object.freeze({
    organizationId: ORGANIZATION_ID,
    workItemId: WORK_ITEM_ID,
    attemptId: ATTEMPT_ID,
    disposition,
    evidenceRef: `waha-projection:${SOURCE_EVENT_ID}`,
    errorCode:
      disposition === "succeeded" ? null : `projection_${disposition}`,
  });
}

function memoryRepository(options = {}) {
  const calls = [];
  return {
    calls,
    async claim(input) {
      calls.push(["claim", input]);
      if (options.claimError) throw new Error("synthetic claim failure");
      return options.claimResult ?? claim();
    },
    async project(input) {
      calls.push(["project", input]);
      if (options.projectError) throw new Error("synthetic projection failure");
      return options.projectionResult ?? projection();
    },
    async finish(input) {
      calls.push(["finish", input]);
      if (options.finishError) throw new Error("synthetic finish failure");
      return {
        organizationId: ORGANIZATION_ID,
        workItemId: WORK_ITEM_ID,
        attemptId: ATTEMPT_ID,
        state:
          input.outcome === "succeeded"
            ? "succeeded"
            : input.outcome === "retryable_error"
              ? "retry_wait"
              : "dead_lettered",
        outcome: input.outcome,
      };
    },
  };
}

async function json(response) {
  return response.json();
}

test("worker configuration is disabled by default without reading secrets", () => {
  assert.deepEqual(loadPlatformWahaWorkerConfig({}), { enabled: false });
});

test("worker configuration requires enabled ingress and private worker inputs", () => {
  const base = {
    EVO_PLATFORM_WAHA_WORKER_ENABLED: "1",
    EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SERVICE_SECRET,
    EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET:
      "synthetic-webhook-hmac-secret-only",
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID:
      INTAKE_SALES_MEMBERSHIP_ID,
    EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET: TRIGGER_SECRET,
  };

  assert.deepEqual(loadPlatformWahaWorkerConfig(base), ENABLED_CONFIG);

  for (const [key, code] of [
    [
      "EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID",
      "missing_sales_membership_id",
    ],
    ["EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET", "missing_trigger_secret"],
  ]) {
    const environment = { ...base };
    delete environment[key];
    assert.throws(
      () => loadPlatformWahaWorkerConfig(environment),
      (error) =>
        error instanceof PlatformWahaWorkerConfigurationError &&
        error.code === code,
    );
  }
});

test("worker route is fail-closed when disabled or unauthorized", async (t) => {
  await t.test("disabled", async () => {
    const repository = memoryRepository();
    const response = await createPlatformWahaWorkHandler({
      config: { enabled: false },
      repository,
      nowMs: () => NOW_MS,
    })(authorizedRequest());
    assert.equal(response.status, 503);
    assert.deepEqual(await json(response), {
      ok: false,
      error: "worker_disabled",
    });
    assert.equal(repository.calls.length, 0);
  });

  for (const [name, request] of [
    ["missing", new Request(ENDPOINT_URL, { method: "POST" })],
    ["wrong secret", authorizedRequest({ secret: `${TRIGGER_SECRET}x` })],
    ["stale", authorizedRequest({ timestamp: NOW_MS - 5 * 60 * 1000 - 1 })],
  ]) {
    await t.test(name, async () => {
      const repository = memoryRepository();
      const response = await createPlatformWahaWorkHandler({
        config: ENABLED_CONFIG,
        repository,
        nowMs: () => NOW_MS,
      })(request);
      assert.equal(response.status, 401);
      assert.deepEqual(await json(response), {
        ok: false,
        error: "unauthorized",
      });
      assert.equal(repository.calls.length, 0);
    });
  }
});

test("worker rejects request bodies before claiming durable work", async () => {
  const repository = memoryRepository();
  const response = await createPlatformWahaWorkHandler({
    config: ENABLED_CONFIG,
    repository,
    nowMs: () => NOW_MS,
  })(authorizedRequest({ body: "{}" }));
  assert.equal(response.status, 400);
  assert.equal(repository.calls.length, 0);
});

test("worker accepts Next's explicit zero-byte POST representation", async () => {
  const repository = memoryRepository({
    claimResult: { claimed: false, queue: "platform_work_v1" },
  });
  const response = await createPlatformWahaWorkHandler({
    config: ENABLED_CONFIG,
    repository,
    nowMs: () => NOW_MS,
  })(
    authorizedRequest({
      body: "",
      headers: { "content-length": "0" },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true, processed: false });
  assert.deepEqual(repository.calls.map(([name]) => name), ["claim"]);
});

test("worker returns a clean no-work result without projection", async () => {
  const repository = memoryRepository({
    claimResult: { claimed: false, queue: "platform_work_v1" },
  });
  const response = await createPlatformWahaWorkHandler({
    config: ENABLED_CONFIG,
    repository,
    nowMs: () => NOW_MS,
  })(authorizedRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true, processed: false });
  assert.deepEqual(repository.calls.map(([name]) => name), ["claim"]);
});

for (const [disposition, expectedState, expectedDelay] of [
  ["succeeded", "succeeded", null],
  ["retryable_error", "retry_wait", 30],
  ["terminal_error", "dead_lettered", null],
]) {
  test(`worker projects and finishes ${disposition} without a provider call`, async () => {
    const repository = memoryRepository({
      projectionResult: projection(disposition),
    });
    const response = await createPlatformWahaWorkHandler({
      config: ENABLED_CONFIG,
      repository,
      nowMs: () => NOW_MS,
    })(authorizedRequest());

    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), {
      ok: true,
      processed: true,
      disposition,
      state: expectedState,
    });
    assert.deepEqual(repository.calls.map(([name]) => name), [
      "claim",
      "project",
      "finish",
    ]);
    const finishInput = repository.calls[2][1];
    assert.equal(finishInput.outcome, disposition);
    assert.equal(finishInput.retryDelaySeconds, expectedDelay);
    assert.equal(
      finishInput.errorCode,
      disposition === "succeeded" ? null : `projection_${disposition}`,
    );
  });
}

test("cross-organization claims and projection failures are left leased", async (t) => {
  await t.test("organization mismatch", async () => {
    const repository = memoryRepository({
      claimResult: claim({ organizationId: OTHER_ORGANIZATION_ID }),
    });
    const response = await createPlatformWahaWorkHandler({
      config: ENABLED_CONFIG,
      repository,
      nowMs: () => NOW_MS,
    })(authorizedRequest());
    assert.equal(response.status, 503);
    assert.deepEqual(repository.calls.map(([name]) => name), ["claim"]);
  });

  await t.test("projection failure", async () => {
    const repository = memoryRepository({ projectError: true });
    const response = await createPlatformWahaWorkHandler({
      config: ENABLED_CONFIG,
      repository,
      nowMs: () => NOW_MS,
    })(authorizedRequest());
    assert.equal(response.status, 503);
    assert.deepEqual(repository.calls.map(([name]) => name), [
      "claim",
      "project",
    ]);
  });
});

test("a signed trigger replay uses the same database idempotency keys", async () => {
  const repository = memoryRepository();
  const handler = createPlatformWahaWorkHandler({
    config: ENABLED_CONFIG,
    repository,
    nowMs: () => NOW_MS,
  });

  for (let index = 0; index < 2; index += 1) {
    const response = await handler(authorizedRequest());
    assert.equal(response.status, 200);
  }

  const first = repository.calls.slice(0, 3).map(([, input]) => input.requestId);
  const second = repository.calls.slice(3, 6).map(([, input]) => input.requestId);
  assert.deepEqual(second, first);
  assert.equal(first[0], TRIGGER_REQUEST_ID);
  assert.equal(new Set(first).size, 3);
});

test("repository rejects a generic queue claim from another work lane", async () => {
  const client = {
    schema(name) {
      assert.equal(name, "platform");
      return {
        async rpc(functionName) {
          assert.equal(functionName, "claim_waha_webhook_work");
          return {
            error: null,
            data: {
              claimed: true,
              organization_id: ORGANIZATION_ID,
              work_item_id: WORK_ITEM_ID,
              attempt_id: ATTEMPT_ID,
              kind: "manual_whatsapp_send",
              queue: "platform_work_v1",
              queue_message_id: 1,
              attempt_number: 1,
              max_attempts: 12,
              lease_expires_at: "2026-08-07T04:30:00Z",
              source_webhook_event_id: SOURCE_EVENT_ID,
            },
          };
        },
      };
    },
  };

  await assert.rejects(() =>
    createPlatformWahaWorkRepository(client).claim({
      organizationId: ORGANIZATION_ID,
      visibilityTimeoutSeconds: 60,
      workerRef: "nextjs:p5b-waha-projection",
      requestId: "66666666-6666-4666-8666-666666666661",
    }),
  );
});

test("repository finishes through the tenant-bound WAHA wrapper", async () => {
  const calls = [];
  const client = {
    schema(name) {
      assert.equal(name, "platform");
      return {
        async rpc(functionName, args) {
          calls.push({ functionName, args });
          return {
            error: null,
            data: {
              organization_id: ORGANIZATION_ID,
              work_item_id: WORK_ITEM_ID,
              attempt_id: ATTEMPT_ID,
              state: "dead_lettered",
              outcome: "terminal_error",
            },
          };
        },
      };
    },
  };

  await createPlatformWahaWorkRepository(client).finish({
    organizationId: ORGANIZATION_ID,
    workItemId: WORK_ITEM_ID,
    attemptId: ATTEMPT_ID,
    outcome: "terminal_error",
    errorCode: "waha_inbound_body_required",
    evidenceRef: `waha-projection:${SOURCE_EVENT_ID}`,
    retryDelaySeconds: null,
    requestId: "66666666-6666-4666-8666-666666666662",
  });

  assert.deepEqual(calls, [
    {
      functionName: "finish_waha_webhook_work",
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_work_item_id: WORK_ITEM_ID,
        p_attempt_id: ATTEMPT_ID,
        p_outcome: "terminal_error",
        p_error_code: "waha_inbound_body_required",
        p_evidence_ref: `waha-projection:${SOURCE_EVENT_ID}`,
        p_retry_delay_seconds: null,
        p_request_id: "66666666-6666-4666-8666-666666666662",
      },
    },
  ]);
});

test("repository rejects a finish response without its tenant envelope", async () => {
  const client = {
    schema() {
      return {
        async rpc() {
          return {
            error: null,
            data: {
              work_item_id: WORK_ITEM_ID,
              attempt_id: ATTEMPT_ID,
              state: "dead_lettered",
              outcome: "terminal_error",
            },
          };
        },
      };
    },
  };

  await assert.rejects(() =>
    createPlatformWahaWorkRepository(client).finish({
      organizationId: ORGANIZATION_ID,
      workItemId: WORK_ITEM_ID,
      attemptId: ATTEMPT_ID,
      outcome: "terminal_error",
      errorCode: "waha_inbound_body_required",
      evidenceRef: `waha-projection:${SOURCE_EVENT_ID}`,
      retryDelaySeconds: null,
      requestId: "66666666-6666-4666-8666-666666666663",
    }),
  );
});

test("P5B worker stays receive-side and has no provider or legacy fallback", async () => {
  const paths = [
    "src/lib/server/platform-waha-worker-config.ts",
    "src/lib/server/platform-waha-work-processor.ts",
    "src/app/api/internal/platform-messaging/waha/work/route.ts",
  ];
  const source = (
    await Promise.all(paths.map((path) => readFile(path, "utf8")))
  ).join("\n");

  for (const forbidden of [
    "/api/sendText",
    "sendSeen",
    "amocrm",
    "kommo",
    "sqlite",
    "lead-agent",
    "auto-reply",
  ]) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});
