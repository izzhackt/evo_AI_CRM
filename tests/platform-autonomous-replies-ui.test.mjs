import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  buildPlatformAutonomousReplyStateRpcArgs,
  buildPlatformAutonomyControlRpcArgs,
  normalizePlatformAutonomousReplyState,
  PlatformAutonomousReplyContractError,
} from "../src/lib/platform-autonomous-replies.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {};" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  PLATFORM_AUTONOMOUS_REPLY_STAFF_RPC,
  PLATFORM_AUTONOMY_CONTROL_RPC,
  PlatformAutonomousReplyRepositoryError,
  readPlatformAutonomousReplyState,
  setPlatformAutonomyControl,
} = await import(
  "../src/lib/server/platform-autonomous-replies-repository.ts"
);

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_ID = "44444444-4444-4444-8444-444444444444";
const INTENT_ID = "55555555-5555-4555-8555-555555555555";
const MESSAGE_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";

function actor(overrides = {}) {
  return {
    authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    organizationId: ORGANIZATION_ID,
    displayName: "Operator",
    platformRole: "sales",
    platformAccessVersion: 7,
    role: "sales",
    ...overrides,
  };
}

function stateRow(overrides = {}) {
  return {
    control_state: "enabled",
    control_version: "3",
    control_reason: "staff_enabled_after_review",
    control_recorded_at: "2026-08-11T04:00:00.000Z",
    decision_state: "queued",
    decision_reason_code: null,
    policy_version: "p5f3-v1",
    proposal_request_id: PROPOSAL_ID,
    source_message_id: SOURCE_ID,
    intent_id: INTENT_ID,
    intent_state: "accepted",
    attempt_outcome: "accepted",
    communication_message_id: MESSAGE_ID,
    ack_name: "SERVER",
    decided_at: "2026-08-11T04:01:00.000Z",
    attempted_at: "2026-08-11T04:01:03.000Z",
    autonomous_authority: true,
    ...overrides,
  };
}

function controlResult(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    conversation_id: CONVERSATION_ID,
    control_version: "4",
    control_state: "paused",
    control_reason: "staff_manual_takeover",
    control_recorded_at: "2026-08-11T04:02:00.000Z",
    autonomous_authority: false,
    ...overrides,
  };
}

function rpcClient(responses, calls) {
  return {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args, options) {
          calls.push({ name, args, options });
          return responses.shift();
        },
      };
    },
  };
}

test("normalizes only the exact safe P5F3 staff state", () => {
  assert.deepEqual(normalizePlatformAutonomousReplyState(stateRow()), {
    controlState: "enabled",
    controlVersion: "3",
    controlReason: "staff_enabled_after_review",
    controlRecordedAt: "2026-08-11T04:00:00.000Z",
    decisionState: "queued",
    decisionReasonCode: null,
    policyVersion: "p5f3-v1",
    proposalRequestId: PROPOSAL_ID,
    sourceMessageId: SOURCE_ID,
    intentId: INTENT_ID,
    intentState: "accepted",
    attemptOutcome: "accepted",
    communicationMessageId: MESSAGE_ID,
    ackName: "SERVER",
    decidedAt: "2026-08-11T04:01:00.000Z",
    attemptedAt: "2026-08-11T04:01:03.000Z",
    autonomousAuthority: true,
  });

  const defaultRow = normalizePlatformAutonomousReplyState(
    stateRow({
      control_state: "paused",
      control_version: 0,
      control_reason: "no_control_event",
      control_recorded_at: null,
      decision_state: null,
      policy_version: null,
      proposal_request_id: null,
      source_message_id: null,
      intent_id: null,
      intent_state: null,
      attempt_outcome: null,
      communication_message_id: null,
      ack_name: null,
      decided_at: null,
      attempted_at: null,
      autonomous_authority: false,
    }),
  );
  assert.equal(defaultRow.controlVersion, "0");
  assert.equal(defaultRow.intentState, null);
});

test("rejects private, malformed, or unsupported staff-state fields", () => {
  for (const invalid of [
    { ...stateRow(), waha_message_id: "phone-bearing-id" },
    stateRow({ intent_state: "delivered" }),
    stateRow({ ack_name: "UNKNOWN" }),
    stateRow({ decision_reason_code: "provider_response_body" }),
    stateRow({ proposal_request_id: "not-a-uuid" }),
    stateRow({ control_version: -1 }),
  ]) {
    assert.throws(
      () => normalizePlatformAutonomousReplyState(invalid),
      PlatformAutonomousReplyContractError,
    );
  }
});

test("builds exact organization-bound read and versioned control RPC arguments", () => {
  assert.deepEqual(
    buildPlatformAutonomousReplyStateRpcArgs({
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
    }),
    {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
    },
  );
  assert.deepEqual(
    buildPlatformAutonomyControlRpcArgs({
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      expectedVersion: "3",
      state: "staff_takeover",
      reason: "staff_requested_manual_control",
      requestId: REQUEST_ID,
    }),
    {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
      p_expected_version: "3",
      p_state: "staff_takeover",
      p_reason: "staff_requested_manual_control",
      p_request_id: REQUEST_ID,
    },
  );
  assert.throws(
    () =>
      buildPlatformAutonomyControlRpcArgs({
        organizationId: ORGANIZATION_ID,
        conversationId: CONVERSATION_ID,
        expectedVersion: "3",
        state: "opted_out",
        reason: "invalid_staff_override",
        requestId: REQUEST_ID,
      }),
    PlatformAutonomousReplyContractError,
  );
});

test("repository performs one safe GET read and accepts zero or one row", async () => {
  const calls = [];
  const client = rpcClient(
    [
      { data: [stateRow()], error: null },
      { data: [], error: null },
    ],
    calls,
  );
  const first = await readPlatformAutonomousReplyState(actor(), CONVERSATION_ID, {
    client,
  });
  const second = await readPlatformAutonomousReplyState(actor(), CONVERSATION_ID, {
    client,
  });
  assert.equal(first?.intentState, "accepted");
  assert.equal(second, null);
  assert.deepEqual(calls, [
    {
      name: PLATFORM_AUTONOMOUS_REPLY_STAFF_RPC,
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_conversation_id: CONVERSATION_ID,
      },
      options: { get: true },
    },
    {
      name: PLATFORM_AUTONOMOUS_REPLY_STAFF_RPC,
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_conversation_id: CONVERSATION_ID,
      },
      options: { get: true },
    },
  ]);
});

test("repository fails closed on excess rows, RPC errors, and private DTO drift", async () => {
  for (const response of [
    { data: [stateRow(), stateRow()], error: null },
    { data: [stateRow({ raw_provider_id: "private" })], error: null },
    { data: null, error: { message: "denied" } },
  ]) {
    await assert.rejects(
      readPlatformAutonomousReplyState(actor(), CONVERSATION_ID, {
        client: rpcClient([response], []),
      }),
      (error) =>
        error instanceof PlatformAutonomousReplyRepositoryError ||
        error instanceof PlatformAutonomousReplyContractError,
    );
  }
});

test("control mutation binds the actor organization and validates the safe result", async () => {
  const calls = [];
  const result = await setPlatformAutonomyControl(
    actor(),
    {
      conversationId: CONVERSATION_ID,
      expectedVersion: "3",
      state: "paused",
      reason: "staff_manual_takeover",
      requestId: REQUEST_ID,
    },
    { client: rpcClient([{ data: controlResult(), error: null }], calls) },
  );
  assert.equal(result.controlState, "paused");
  assert.deepEqual(calls, [
    {
      name: PLATFORM_AUTONOMY_CONTROL_RPC,
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_conversation_id: CONVERSATION_ID,
        p_expected_version: "3",
        p_state: "paused",
        p_reason: "staff_manual_takeover",
        p_request_id: REQUEST_ID,
      },
      options: undefined,
    },
  ]);

  await assert.rejects(
    setPlatformAutonomyControl(
      actor(),
      {
        conversationId: CONVERSATION_ID,
        expectedVersion: "3",
        state: "paused",
        reason: "staff_manual_takeover",
        requestId: REQUEST_ID,
      },
      {
        client: rpcClient(
          [{ data: controlResult({ conversation_id: SOURCE_ID }), error: null }],
          [],
        ),
      },
    ),
    PlatformAutonomousReplyRepositoryError,
  );
});
