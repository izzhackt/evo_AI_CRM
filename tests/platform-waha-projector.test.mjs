import assert from "node:assert/strict";
import test from "node:test";

import {
  PlatformWahaProjectorError,
  projectPlatformWahaWorkItem,
} from "../src/lib/server/platform-waha-projector.ts";

const ORGANIZATION_ID = "77100000-0000-4000-8000-000000000001";
const WORK_ITEM_ID = "77100000-0000-4000-8000-000000000201";
const ATTEMPT_ID = "77100000-0000-4000-8000-000000000301";
const SOURCE_EVENT_ID = "77100000-0000-4000-8000-000000000101";
const SALES_MEMBERSHIP_ID = "77100000-0000-4000-8000-000000000401";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

test("projects the exact inbound work item before acknowledging it", async () => {
  const calls = [];
  const client = serviceClient((name) => {
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
          event_type: "message.any",
          queue: "platform_work_v1",
          queue_message_id: 91,
          attempt_number: 1,
          max_attempts: 8,
          lease_expires_at: "2026-09-02T10:00:00Z",
        },
        error: null,
      };
    }
    if (name === "project_claimed_waha_event") {
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          disposition: "succeeded",
          evidence_ref: `waha-inbound-projected:${SOURCE_EVENT_ID}`,
          error_code: null,
        },
        error: null,
      };
    }
    if (name === "finish_waha_webhook_work") {
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
  }, calls);

  const result = await projectPlatformWahaWorkItem({
    client,
    organizationId: ORGANIZATION_ID,
    workItemId: WORK_ITEM_ID,
    environment: {
      EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: SALES_MEMBERSHIP_ID,
    },
  });

  assert.deepEqual(result, {
    workItemId: WORK_ITEM_ID,
    eventType: "message.any",
    disposition: "succeeded",
    state: "succeeded",
    deduplicated: false,
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      "claim_waha_webhook_work_item",
      "project_claimed_waha_event",
      "finish_waha_webhook_work",
    ],
  );
  assert.equal(calls[0].args.p_work_item_id, WORK_ITEM_ID);
  assert.equal(calls[1].args.p_work_item_id, WORK_ITEM_ID);
  assert.equal(calls[2].args.p_work_item_id, WORK_ITEM_ID);
  assert.equal(
    calls[1].args.p_intake_sales_membership_id,
    SALES_MEMBERSHIP_ID,
  );
  assert.equal(calls[2].args.p_outcome, "succeeded");
  assert.equal(calls[2].args.p_retry_delay_seconds, null);
  assert.match(calls[0].args.p_request_id, UUID_PATTERN);
  assert.match(calls[1].args.p_request_id, UUID_PATTERN);
  assert.match(calls[2].args.p_request_id, UUID_PATTERN);
});

test("projects an exact outbound ACK through the ACK observation contract", async () => {
  const calls = [];
  const client = serviceClient((name) => {
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
          queue_message_id: "92",
          attempt_number: 2,
          max_attempts: 8,
          lease_expires_at: "2026-09-02T10:00:00+00:00",
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
  }, calls);

  const result = await projectPlatformWahaWorkItem({
    client,
    organizationId: ORGANIZATION_ID,
    workItemId: WORK_ITEM_ID,
    environment: {
      EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: SALES_MEMBERSHIP_ID,
    },
  });

  assert.deepEqual(result, {
    workItemId: WORK_ITEM_ID,
    eventType: "message.ack",
    disposition: "succeeded",
    state: "succeeded",
    deduplicated: false,
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      "claim_waha_webhook_work_item",
      "project_claimed_waha_observation",
      "finish_waha_event_projection",
    ],
  );
});

test("records a retryable DB disposition and reports that projection is not visible", async () => {
  const calls = [];
  const client = serviceClient((name) => {
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
          queue_message_id: 93,
          attempt_number: 1,
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
          disposition: "retryable_error",
          evidence_ref: `waha-observation:${SOURCE_EVENT_ID}:waha_ack_binding_pending`,
          error_code: "waha_ack_binding_pending",
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
          outcome: "retryable_error",
          state: "retry_wait",
        },
        error: null,
      };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  }, calls);

  await assert.rejects(
    projectPlatformWahaWorkItem({
      client,
      organizationId: ORGANIZATION_ID,
      workItemId: WORK_ITEM_ID,
      environment: {
        EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: SALES_MEMBERSHIP_ID,
      },
    }),
    (error) => {
      assert.ok(error instanceof PlatformWahaProjectorError);
      assert.equal(error.code, "provider_projection_retry_scheduled");
      assert.equal(error.status, 503);
      return true;
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[2].args.p_outcome, "retryable_error");
  assert.equal(calls[2].args.p_error_code, "waha_ack_binding_pending");
  assert.equal(calls[2].args.p_retry_delay_seconds, 30);
});

test("records a terminal DB disposition and fails the request clearly", async () => {
  const calls = [];
  const client = serviceClient((name) => {
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
          event_type: "message.any",
          queue: "platform_work_v1",
          queue_message_id: 94,
          attempt_number: 8,
          max_attempts: 8,
          lease_expires_at: "2026-09-02T10:00:00Z",
        },
        error: null,
      };
    }
    if (name === "project_claimed_waha_event") {
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          disposition: "terminal_error",
          evidence_ref: `waha-inbound-projected:${SOURCE_EVENT_ID}:invalid_payload`,
          error_code: "invalid_payload",
        },
        error: null,
      };
    }
    if (name === "finish_waha_webhook_work") {
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          outcome: "terminal_error",
          state: "dead_lettered",
        },
        error: null,
      };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  }, calls);

  await assert.rejects(
    projectPlatformWahaWorkItem({
      client,
      organizationId: ORGANIZATION_ID,
      workItemId: WORK_ITEM_ID,
      environment: {
        EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: SALES_MEMBERSHIP_ID,
      },
    }),
    (error) => {
      assert.ok(error instanceof PlatformWahaProjectorError);
      assert.equal(error.code, "provider_projection_rejected");
      assert.equal(error.status, 422);
      return true;
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[2].args.p_outcome, "terminal_error");
  assert.equal(calls[2].args.p_retry_delay_seconds, null);
});

test("accepts an exact completed replay without projecting or finishing twice", async () => {
  const calls = [];
  const client = serviceClient((name) => {
    assert.equal(name, "claim_waha_webhook_work_item");
    return {
      data: {
        claimed: false,
        completed: true,
        requested_work_item_id: WORK_ITEM_ID,
        organization_id: ORGANIZATION_ID,
        work_item_id: WORK_ITEM_ID,
        kind: "provider_webhook_process",
        event_type: "message.any",
        queue: "platform_work_v1",
        state: "succeeded",
      },
      error: null,
    };
  }, calls);

  const result = await projectPlatformWahaWorkItem({
    client,
    organizationId: ORGANIZATION_ID,
    workItemId: WORK_ITEM_ID,
    environment: {
      EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: SALES_MEMBERSHIP_ID,
    },
  });

  assert.deepEqual(result, {
    workItemId: WORK_ITEM_ID,
    eventType: "message.any",
    disposition: "succeeded",
    state: "succeeded",
    deduplicated: true,
  });
  assert.deepEqual(calls.map((call) => call.name), [
    "claim_waha_webhook_work_item",
  ]);
});

test("fails closed when the exact claim returns a different work item", async () => {
  const otherWorkItemId = "77100000-0000-4000-8000-000000000202";
  const calls = [];
  const client = serviceClient(() => ({
    data: {
      claimed: true,
      completed: false,
      requested_work_item_id: WORK_ITEM_ID,
      organization_id: ORGANIZATION_ID,
      work_item_id: otherWorkItemId,
      attempt_id: ATTEMPT_ID,
      source_webhook_event_id: SOURCE_EVENT_ID,
      kind: "provider_webhook_process",
      event_type: "message.any",
      queue: "platform_work_v1",
      queue_message_id: 95,
      attempt_number: 1,
      max_attempts: 8,
      lease_expires_at: "2026-09-02T10:00:00Z",
    },
    error: null,
  }), calls);

  await assert.rejects(
    projectPlatformWahaWorkItem({
      client,
      organizationId: ORGANIZATION_ID,
      workItemId: WORK_ITEM_ID,
      environment: {
        EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: SALES_MEMBERSHIP_ID,
      },
    }),
    (error) => {
      assert.ok(error instanceof PlatformWahaProjectorError);
      assert.equal(error.code, "provider_projection_unavailable");
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("leaves the leased durable item for recovery when projection transport fails", async () => {
  const calls = [];
  const client = serviceClient((name) => {
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
          event_type: "message.any",
          queue: "platform_work_v1",
          queue_message_id: 96,
          attempt_number: 1,
          max_attempts: 8,
          lease_expires_at: "2026-09-02T10:00:00Z",
        },
        error: null,
      };
    }
    assert.equal(name, "project_claimed_waha_event");
    return { data: null, error: { message: "database unavailable" } };
  }, calls);

  await assert.rejects(
    projectPlatformWahaWorkItem({
      client,
      organizationId: ORGANIZATION_ID,
      workItemId: WORK_ITEM_ID,
      environment: {
        EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: SALES_MEMBERSHIP_ID,
      },
    }),
    (error) => {
      assert.ok(error instanceof PlatformWahaProjectorError);
      assert.equal(error.code, "provider_projection_unavailable");
      assert.equal(error.status, 503);
      return true;
    },
  );
  assert.deepEqual(
    calls.map((call) => call.name),
    ["claim_waha_webhook_work_item", "project_claimed_waha_event"],
  );
});
