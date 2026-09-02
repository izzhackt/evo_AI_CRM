import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  createPlatformWahaProjectionRecoveryHandler,
  loadPlatformWahaProjectionRecoveryConfig,
} from "../src/lib/server/platform-waha-projection-recovery.ts";

const ORGANIZATION_ID = "77200000-0000-4000-8000-000000000001";
const WORK_ITEM_ID = "77200000-0000-4000-8000-000000000201";
const ATTEMPT_ID = "77200000-0000-4000-8000-000000000301";
const SOURCE_EVENT_ID = "77200000-0000-4000-8000-000000000101";
const SALES_MEMBERSHIP_ID = "77200000-0000-4000-8000-000000000401";
const REQUEST_ID = "77200000-0000-4000-8000-000000000501";
const NOW_MS = 1_788_333_600_000;
const TRIGGER_SECRET = "p5b-recovery-trigger-secret-32-bytes-minimum";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function enabledConfig() {
  return Object.freeze({
    enabled: true,
    organizationId: ORGANIZATION_ID,
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseSecretKey: "sb_secret_local-p5b-recovery-tests",
    triggerSecret: TRIGGER_SECRET,
    intakeSalesMembershipId: SALES_MEMBERSHIP_ID,
    maxClockSkewMs: 5 * 60 * 1000,
  });
}

function signedRequest(
  requestId = REQUEST_ID,
  overrides = {},
  body = undefined,
) {
  const timestamp = String(NOW_MS);
  const signature = createHmac("sha256", TRIGGER_SECRET)
    .update(`${requestId}.${timestamp}`, "utf8")
    .digest("hex");
  return new Request(
    "http://localhost/api/internal/platform-messaging/waha/work",
    {
      method: "POST",
      headers: {
        "x-evo-worker-request-id": requestId,
        "x-evo-worker-timestamp": timestamp,
        "x-evo-worker-hmac-algorithm": "sha256",
        "x-evo-worker-hmac": signature,
        ...overrides,
      },
      body,
    },
  );
}

function serviceClient(responder, calls) {
  return {
    schema(name) {
      assert.equal(name, "platform");
      return {
        async rpc(rpcName, args) {
          calls.push({ name: rpcName, args });
          return responder(rpcName, args);
        },
      };
    },
  };
}

test("recovery configuration is disabled by default and validates every secret", () => {
  assert.deepEqual(loadPlatformWahaProjectionRecoveryConfig({}), {
    enabled: false,
  });
  assert.throws(
    () =>
      loadPlatformWahaProjectionRecoveryConfig({
        EVO_PLATFORM_WAHA_WORKER_ENABLED: "1",
        EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        EVO_PLATFORM_SUPABASE_SECRET_KEY:
          "sb_secret_local-p5b-recovery-tests",
        EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: SALES_MEMBERSHIP_ID,
        EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET: "too-short",
      }),
    /not configured/i,
  );
});

test("the recovery route is bodyless, HMAC authenticated, and fail closed", async () => {
  const disabled = createPlatformWahaProjectionRecoveryHandler({
    config: { enabled: false },
  });
  assert.equal((await disabled(signedRequest())).status, 503);

  const calls = [];
  const handler = createPlatformWahaProjectionRecoveryHandler({
    config: enabledConfig(),
    nowMs: () => NOW_MS,
    client: serviceClient(() => {
      throw new Error("database must not run");
    }, calls),
  });
  assert.equal(
    (
      await handler(
        new Request(
          "http://localhost/api/internal/platform-messaging/waha/work",
          { method: "POST" },
        ),
      )
    ).status,
    401,
  );
  assert.equal(
    (await handler(signedRequest(REQUEST_ID, {}, "not-bodyless"))).status,
    400,
  );
  assert.equal(
    (
      await handler(
        signedRequest(REQUEST_ID, {
          "x-evo-worker-hmac-algorithm": "sha512",
        }),
      )
    ).status,
    401,
  );
  assert.equal(calls.length, 0);
});

test("a scheduler invocation reports an empty due lane without claiming work", async () => {
  const calls = [];
  const handler = createPlatformWahaProjectionRecoveryHandler({
    config: enabledConfig(),
    nowMs: () => NOW_MS,
    client: serviceClient((name) => {
      assert.equal(name, "next_recoverable_waha_webhook_work_item");
      return {
        data: {
          found: false,
          organization_id: ORGANIZATION_ID,
          queue: "platform_work_v1",
        },
        error: null,
      };
    }, calls),
  });

  const response = await handler(signedRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    processed: false,
    requestId: REQUEST_ID,
  });
  assert.deepEqual(calls.map((call) => call.name), [
    "next_recoverable_waha_webhook_work_item",
  ]);
});

test("a new scheduler request recovers retry_wait through the canonical projector without a provider call", async () => {
  const calls = [];
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider access is forbidden");
  };

  try {
    const handler = createPlatformWahaProjectionRecoveryHandler({
      config: enabledConfig(),
      nowMs: () => NOW_MS,
      client: serviceClient((name) => {
        if (name === "next_recoverable_waha_webhook_work_item") {
          return {
            data: {
              found: true,
              organization_id: ORGANIZATION_ID,
              work_item_id: WORK_ITEM_ID,
              kind: "provider_webhook_process",
              event_type: "message.ack",
              state: "retry_wait",
              queue: "platform_work_v1",
              queue_message_id: 101,
            },
            error: null,
          };
        }
        if (name === "claim_waha_webhook_work_item") {
          return {
            data: {
              claimed: true,
              completed: false,
              requested_work_item_id: WORK_ITEM_ID,
              organization_id: ORGANIZATION_ID,
              work_item_id: WORK_ITEM_ID,
              attempt_id: ATTEMPT_ID,
              source_webhook_event_id: SOURCE_EVENT_ID,
              kind: "provider_webhook_process",
              event_type: "message.ack",
              queue: "platform_work_v1",
              queue_message_id: 101,
              attempt_number: 2,
              max_attempts: 8,
              lease_expires_at: "2026-09-02T10:00:00Z",
            },
            error: null,
          };
        }
        if (name === "project_claimed_waha_observation") {
          return {
            data: {
              organization_id: ORGANIZATION_ID,
              work_item_id: WORK_ITEM_ID,
              attempt_id: ATTEMPT_ID,
              disposition: "succeeded",
              evidence_ref: `waha-observation:${SOURCE_EVENT_ID}:message-ack`,
              error_code: null,
            },
            error: null,
          };
        }
        if (name === "finish_waha_event_projection") {
          return {
            data: {
              organization_id: ORGANIZATION_ID,
              work_item_id: WORK_ITEM_ID,
              attempt_id: ATTEMPT_ID,
              outcome: "succeeded",
              state: "succeeded",
            },
            error: null,
          };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      }, calls),
    });

    const response = await handler(signedRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      processed: true,
      requestId: REQUEST_ID,
      workItemId: WORK_ITEM_ID,
      eventType: "message.ack",
      state: "succeeded",
      deduplicated: false,
    });
    assert.deepEqual(calls.map((call) => call.name), [
      "next_recoverable_waha_webhook_work_item",
      "claim_waha_webhook_work_item",
      "project_claimed_waha_observation",
      "finish_waha_event_projection",
    ]);
    assert.equal(calls[0].args.p_organization_id, ORGANIZATION_ID);
    assert.equal(calls[1].args.p_work_item_id, WORK_ITEM_ID);
    assert.equal(
      calls[2].args.p_intake_sales_membership_id,
      SALES_MEMBERSHIP_ID,
    );
    assert.equal(providerCalls, 0);
    const operationRequestIds = calls.slice(1).map(
      (call) => call.args.p_request_id,
    );
    assert.equal(new Set(operationRequestIds).size, 3);
    for (const requestId of operationRequestIds) {
      assert.match(requestId, UUID_PATTERN);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a dead-letter race stays a 422 terminal result and never projects again", async () => {
  const calls = [];
  const handler = createPlatformWahaProjectionRecoveryHandler({
    config: enabledConfig(),
    nowMs: () => NOW_MS,
    client: serviceClient((name) => {
      if (name === "next_recoverable_waha_webhook_work_item") {
        return {
          data: {
            found: true,
            organization_id: ORGANIZATION_ID,
            work_item_id: WORK_ITEM_ID,
            kind: "provider_webhook_process",
            event_type: "message.ack",
            state: "retry_wait",
            queue: "platform_work_v1",
            queue_message_id: 102,
          },
          error: null,
        };
      }
      assert.equal(name, "claim_waha_webhook_work_item");
      return {
        data: {
          claimed: false,
          completed: true,
          terminal: true,
          requested_work_item_id: WORK_ITEM_ID,
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          kind: "provider_webhook_process",
          event_type: "message.ack",
          queue: "platform_work_v1",
          state: "dead_lettered",
          outcome: "retryable_error",
          error_code: "waha_ack_binding_pending",
          evidence_ref: `waha-observation:${SOURCE_EVENT_ID}:binding-pending`,
          automatic_retry_allowed: false,
        },
        error: null,
      };
    }, calls),
  });

  const response = await handler(signedRequest());
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "provider_projection_rejected",
  });
  assert.deepEqual(calls.map((call) => call.name), [
    "next_recoverable_waha_webhook_work_item",
    "claim_waha_webhook_work_item",
  ]);
});
