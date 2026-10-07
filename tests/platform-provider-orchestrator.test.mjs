import assert from "node:assert/strict";
import test from "node:test";

import {
  executePlatformManualWhatsAppReconciliation,
  executePlatformManualWhatsAppSend,
} from "../src/lib/server/platform-provider-orchestrator.ts";
import {
  PlatformWahaProviderError,
  createPlatformWahaProvider,
} from "../src/lib/server/platform-waha-provider.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const SOURCE_MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "90000000-0000-4000-8000-000000000001";
const AUTHORIZATION_ID = "a0000000-0000-4000-8000-000000000001";
const WORK_ITEM_ID = "b0000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "c0000000-0000-4000-8000-000000000001";
const OUTBOUND_MESSAGE_ID = "d0000000-0000-4000-8000-000000000001";
const RECONCILIATION_REQUEST_ID = "e0000000-0000-4000-8000-000000000001";
const COMPLETION_REQUEST_ID = "f0000000-0000-4000-8000-000000000001";
const REQUESTED_AT = "2026-09-02T12:00:00+00:00";
const COMPLETED_AT = "2026-09-02T12:00:02+00:00";
const FINAL_TEXT = "Здравствуйте! Готовы продолжить консультацию?";
const SHA256 = "a".repeat(64);
const RECIPIENT = "996555000001@c.us";
const REPLY_TO = "false_996555000001@c.us_SOURCE1";
const PROVIDER_MESSAGE_ID = "false_996555000001@c.us_PROVIDER1";

const OTHER_CRM_PROVIDER_MESSAGE_ID = "true_996555000001@c.us_3EB0OTHERCRMSEND0001";

function recordingRpcClient(responseFor) {
  const calls = [];
  return {
    calls,
    client: {
      schema(schema) {
        assert.equal(schema, "platform");
        return {
          rpc(functionName, args, options) {
            calls.push({ functionName, args, options });
            return Promise.resolve(responseFor(functionName, args));
          },
        };
      },
    },
  };
}

function manualSendAuthorization() {
  return {
    organizationId: ORGANIZATION_ID,
    manualSendAuthorizationId: AUTHORIZATION_ID,
    communicationConversationId: CONVERSATION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    aiDraftId: null,
    finalText: FINAL_TEXT,
    finalTextSha256: SHA256,
    authorizedByMembershipId: MEMBERSHIP_ID,
    state: "manual_send_authorized",
    requestedByMembershipId: MEMBERSHIP_ID,
    workItemId: WORK_ITEM_ID,
    workState: "queued",
    queueMessageId: "42",
    businessKeySha256: SHA256,
    wahaReadiness: "ready",
    wahaReadinessEvidenceKind: "provider_observed",
    wahaReadinessFresh: true,
    wahaReadinessObservedAt: REQUESTED_AT,
  };
}

function claimedManualSendData() {
  return {
    claimed: true,
    organization_id: ORGANIZATION_ID,
    work_item_id: WORK_ITEM_ID,
    requested_work_item_id: WORK_ITEM_ID,
    attempt_id: ATTEMPT_ID,
    kind: "manual_whatsapp_send",
    manual_send_authorization_id: AUTHORIZATION_ID,
    conversation_id: CONVERSATION_ID,
    source_message_id: SOURCE_MESSAGE_ID,
    waha_session_name: "crm_primary",
    raw_chat_id: RECIPIENT,
    raw_reply_to: REPLY_TO,
    final_text: FINAL_TEXT,
    final_text_sha256: SHA256,
    attempt_number: 1,
    max_attempts: 1,
    lease_expires_at: COMPLETED_AT,
    queue_payload_is_pointer_only: true,
  };
}

function wahaRuntimeData() {
  return [{
    waha_session_name: "crm_primary",
    waha_base_url: "http://evo-crm-waha:3000",
    waha_api_key: "provider-api-key-value",
    binding_version: "3",
  }];
}

test("manual WhatsApp authorization claims its exact work item, resolves Vault runtime, sends once, and finishes", async () => {
  const service = recordingRpcClient((functionName) => {
    if (functionName === "claim_manual_whatsapp_send_item") {
      return {
        data: {
          claimed: true,
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          requested_work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          kind: "manual_whatsapp_send",
          manual_send_authorization_id: AUTHORIZATION_ID,
          conversation_id: CONVERSATION_ID,
          source_message_id: SOURCE_MESSAGE_ID,
          waha_session_name: "crm_primary",
          raw_chat_id: RECIPIENT,
          raw_reply_to: REPLY_TO,
          final_text: FINAL_TEXT,
          final_text_sha256: SHA256,
          attempt_number: 1,
          max_attempts: 1,
          lease_expires_at: COMPLETED_AT,
          queue_payload_is_pointer_only: true,
        },
        error: null,
      };
    }
    if (functionName === "resolve_manual_send_waha_runtime") {
      return {
        data: [{
          waha_session_name: "crm_primary",
          waha_base_url: "http://evo-crm-waha:3000",
          waha_api_key: "provider-api-key-value",
          binding_version: "3",
        }],
        error: null,
      };
    }
    if (functionName === "finish_manual_whatsapp_send") {
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          kind: "manual_whatsapp_send",
          state: "succeeded",
          outcome: "succeeded",
          queue_message_id: "42",
          active_message_archived: true,
          automatic_retry_allowed: false,
          communication_message_id: OUTBOUND_MESSAGE_ID,
          provider_identity_private: true,
        },
        error: null,
      };
    }
    throw new Error(`unexpected RPC ${functionName}`);
  });
  const createdRuntimes = [];
  const sendInputs = [];

  const result = await executePlatformManualWhatsAppSend(
    service.client,
    {
      authorization: manualSendAuthorization(),
      visibilityTimeoutSeconds: 120,
      workerRef: "next-app-manual-send",
      claimRequestId: REQUEST_ID,
      completionRequestId: COMPLETION_REQUEST_ID,
    },
    {
      createWahaProvider(runtime) {
        createdRuntimes.push(runtime);
        return {
          async sendText(input) {
            sendInputs.push(input);
            return {
              providerMessageId: PROVIDER_MESSAGE_ID,
              providerSource: "api",
              providerObservedAt: COMPLETED_AT,
              ackState: "server",
              ackObservedAt: COMPLETED_AT,
            };
          },
          async getMessage() {
            throw new Error("send flow must not read back");
          },
          async findUniqueMessage() {
            throw new Error("send flow must not search");
          },
        };
      },
    },
  );

  assert.deepEqual(
    service.calls.map(({ functionName }) => functionName),
    [
      "claim_manual_whatsapp_send_item",
      "resolve_manual_send_waha_runtime",
      "finish_manual_whatsapp_send",
    ],
  );
  assert.equal(
    service.calls[0].args.p_work_item_id,
    manualSendAuthorization().workItemId,
  );
  assert.equal(createdRuntimes.length, 1);
  assert.equal(createdRuntimes[0].wahaSessionName, "crm_primary");
  assert.equal(sendInputs.length, 1);
  assert.deepEqual(sendInputs[0], {
    recipientId: RECIPIENT,
    text: FINAL_TEXT,
    replyTo: REPLY_TO,
  });
  assert.equal(service.calls[2].args.p_outcome, "succeeded");
  assert.equal(service.calls[2].args.p_provider_message_id, PROVIDER_MESSAGE_ID);
  assert.deepEqual(result, {
    status: "finished",
    result: {
      organizationId: ORGANIZATION_ID,
      workItemId: WORK_ITEM_ID,
      attemptId: ATTEMPT_ID,
      outcome: "succeeded",
      communicationMessageId: OUTBOUND_MESSAGE_ID,
      providerIdentityPrivate: true,
    },
  });
  assert.equal(Object.hasOwn(result, "recipientId"), false);
});

test("an unknown WhatsApp result is finished once and replay cannot send a second message", async () => {
  let claimCalls = 0;
  const service = recordingRpcClient((functionName) => {
    if (functionName === "claim_manual_whatsapp_send_item") {
      claimCalls += 1;
      if (claimCalls > 1) {
        return {
          data: {
            claimed: false,
            queue: "platform_work_v1",
            requested_work_item_id: WORK_ITEM_ID,
          },
          error: null,
        };
      }
      return {
        data: {
          claimed: true,
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          requested_work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          kind: "manual_whatsapp_send",
          manual_send_authorization_id: AUTHORIZATION_ID,
          conversation_id: CONVERSATION_ID,
          source_message_id: SOURCE_MESSAGE_ID,
          waha_session_name: "crm_primary",
          raw_chat_id: RECIPIENT,
          raw_reply_to: REPLY_TO,
          final_text: FINAL_TEXT,
          final_text_sha256: SHA256,
          attempt_number: 1,
          max_attempts: 1,
          lease_expires_at: COMPLETED_AT,
          queue_payload_is_pointer_only: true,
        },
        error: null,
      };
    }
    if (functionName === "resolve_manual_send_waha_runtime") {
      return {
        data: [{
          waha_session_name: "crm_primary",
          waha_base_url: "http://evo-crm-waha:3000",
          waha_api_key: "provider-api-key-value",
          binding_version: "3",
        }],
        error: null,
      };
    }
    return {
      data: {
        organization_id: ORGANIZATION_ID,
        work_item_id: WORK_ITEM_ID,
        attempt_id: ATTEMPT_ID,
        outcome: "unknown_result",
        automatic_retry_allowed: false,
        communication_message_id: null,
        provider_identity_private: true,
      },
      error: null,
    };
  });
  let sends = 0;
  const dependencies = {
    createWahaProvider() {
      return {
        async sendText() {
          sends += 1;
          throw new PlatformWahaProviderError("provider_timeout", "unknown");
        },
        async getMessage() {
          throw new Error("must not read");
        },
        async findUniqueMessage() {
          throw new Error("must not search");
        },
      };
    },
  };

  const first = await executePlatformManualWhatsAppSend(
    service.client,
    {
      authorization: manualSendAuthorization(),
      visibilityTimeoutSeconds: 120,
      workerRef: "next-app-manual-send",
      claimRequestId: REQUEST_ID,
      completionRequestId: COMPLETION_REQUEST_ID,
    },
    dependencies,
  );
  const second = await executePlatformManualWhatsAppSend(
    service.client,
    {
      authorization: manualSendAuthorization(),
      visibilityTimeoutSeconds: 120,
      workerRef: "next-app-manual-send",
      claimRequestId: "70000000-0000-4000-8000-000000000001",
      completionRequestId: "80000000-0000-4000-8000-000000000001",
    },
    dependencies,
  );

  assert.equal(sends, 1);
  const finishCall = service.calls.find(
    ({ functionName }) => functionName === "finish_manual_whatsapp_send",
  );
  assert.equal(finishCall.args.p_outcome, "unknown_result");
  assert.equal(finishCall.args.p_error_code, "provider_timeout");
  assert.equal(finishCall.args.p_provider_message_id, null);
  assert.equal(finishCall.args.p_provider_observed_at, null);
  assert.equal(first.result.outcome, "unknown_result");
  assert.deepEqual(second, { status: "not_claimed", workItemId: WORK_ITEM_ID });
  assert.equal(
    service.calls.filter(
      ({ functionName }) => functionName === "resolve_manual_send_waha_runtime",
    ).length,
    1,
  );
});

test("an explicit WAHA rejection is durably failed after one send and is never retried", async () => {
  const service = recordingRpcClient((functionName) => {
    if (functionName === "claim_manual_whatsapp_send_item") {
      return { data: claimedManualSendData(), error: null };
    }
    if (functionName === "resolve_manual_send_waha_runtime") {
      return { data: wahaRuntimeData(), error: null };
    }
    return {
      data: {
        organization_id: ORGANIZATION_ID,
        work_item_id: WORK_ITEM_ID,
        attempt_id: ATTEMPT_ID,
        outcome: "terminal_error",
        automatic_retry_allowed: false,
        communication_message_id: null,
        provider_identity_private: true,
      },
      error: null,
    };
  });
  let sends = 0;

  const result = await executePlatformManualWhatsAppSend(
    service.client,
    {
      authorization: manualSendAuthorization(),
      visibilityTimeoutSeconds: 120,
      workerRef: "next-app-manual-send",
      claimRequestId: REQUEST_ID,
      completionRequestId: COMPLETION_REQUEST_ID,
    },
    {
      createWahaProvider() {
        return {
          async sendText() {
            sends += 1;
            throw new PlatformWahaProviderError(
              "provider_rejected",
              "failed",
              400,
            );
          },
          async getMessage() {
            throw new Error("must not read");
          },
          async findUniqueMessage() {
            throw new Error("must not search");
          },
        };
      },
    },
  );

  assert.equal(sends, 1);
  const finishCall = service.calls.at(-1);
  assert.equal(finishCall.functionName, "finish_manual_whatsapp_send");
  assert.equal(finishCall.args.p_outcome, "terminal_error");
  assert.equal(finishCall.args.p_error_code, "provider_rejected");
  assert.equal(finishCall.args.p_provider_message_id, null);
  assert.equal(result.result.outcome, "terminal_error");
});

test("manual WhatsApp reconciliation performs bounded readback only and finishes the exact staff request", async () => {
  const events = [];
  const staff = recordingRpcClient((functionName) => {
    events.push(functionName);
    return {
      data: [{
        reconciliation_request_id: RECONCILIATION_REQUEST_ID,
        reconciliation_kind: "unknown_recovery",
        replayed: false,
      }],
      error: null,
    };
  });
  const service = recordingRpcClient((functionName) => {
    events.push(functionName);
    if (functionName === "manual_whatsapp_reconciliation_context") {
      return {
        data: {
          reconciliation_request_id: RECONCILIATION_REQUEST_ID,
          request_id: REQUEST_ID,
          organization_id: ORGANIZATION_ID,
          conversation_id: CONVERSATION_ID,
          source_message_id: SOURCE_MESSAGE_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          manual_send_authorization_id: AUTHORIZATION_ID,
          reconciliation_kind: "unknown_recovery",
          waha_session_name: "crm_primary",
          raw_chat_id: RECIPIENT,
          final_text: FINAL_TEXT,
          final_text_sha256: SHA256,
          expected_provider_message_id: null,
          provider_window_start: REQUESTED_AT,
          provider_window_end: COMPLETED_AT,
          completed: false,
        },
        error: null,
      };
    }
    if (functionName === "manual_whatsapp_reconciliation_bound_message_ids") {
      return { data: [OTHER_CRM_PROVIDER_MESSAGE_ID], error: null };
    }
    if (functionName === "resolve_manual_send_waha_runtime") {
      return {
        data: [{
          waha_session_name: "crm_primary",
          waha_base_url: "http://evo-crm-waha:3000",
          waha_api_key: "provider-api-key-value",
          binding_version: "3",
        }],
        error: null,
      };
    }
    return {
      data: {
        reconciliation_request_id: RECONCILIATION_REQUEST_ID,
        organization_id: ORGANIZATION_ID,
        conversation_id: CONVERSATION_ID,
        attempt_id: ATTEMPT_ID,
        outcome: "message_confirmed",
        communication_message_id: OUTBOUND_MESSAGE_ID,
        ack_name: "DEVICE",
        reconciliation_required: false,
        replayed: false,
      },
      error: null,
    };
  });
  let sends = 0;
  let lookups = 0;

  const result = await executePlatformManualWhatsAppReconciliation(
    staff.client,
    service.client,
    {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      attemptId: ATTEMPT_ID,
      requestId: REQUEST_ID,
      reason: "Staff requested exact WAHA readback",
      completionRequestId: COMPLETION_REQUEST_ID,
    },
    {
      createWahaProvider() {
        return {
          async sendText() {
            sends += 1;
            throw new Error("reconciliation must never send");
          },
          async getMessage() {
            throw new Error("unknown recovery must use bounded lookup");
          },
          async findUniqueMessage(input) {
            events.push("provider_bounded_readback");
            lookups += 1;
            assert.deepEqual(input, {
              recipientId: RECIPIENT,
              expectedText: FINAL_TEXT,
              windowStart: REQUESTED_AT,
              windowEnd: COMPLETED_AT,
              // Another CRM send of the chat is never this attempt's message (266).
              excludeProviderMessageIds: [OTHER_CRM_PROVIDER_MESSAGE_ID],
            });
            return {
              providerMessageId: PROVIDER_MESSAGE_ID,
              providerSource: "api",
              providerObservedAt: COMPLETED_AT,
              ackState: "device",
              ackObservedAt: COMPLETED_AT,
            };
          },
        };
      },
    },
  );

  assert.equal(sends, 0);
  assert.equal(lookups, 1);
  assert.deepEqual(events, [
    "request_manual_whatsapp_reconciliation",
    "manual_whatsapp_reconciliation_context",
    "resolve_manual_send_waha_runtime",
    "manual_whatsapp_reconciliation_bound_message_ids",
    "provider_bounded_readback",
    "finish_manual_whatsapp_reconciliation",
  ]);
  assert.deepEqual(service.calls[2].args, { p_reconciliation_request_id: RECONCILIATION_REQUEST_ID });
  assert.equal(service.calls[3].args.p_reconciliation_request_id, RECONCILIATION_REQUEST_ID);
  assert.equal(service.calls[3].args.p_raw_chat_id, RECIPIENT);
  assert.equal(service.calls[3].args.p_match_count, 1);
  assert.equal(service.calls[3].args.p_provider_message_id, PROVIDER_MESSAGE_ID);
  assert.deepEqual(result, {
    status: "finished",
    result: {
      reconciliationRequestId: RECONCILIATION_REQUEST_ID,
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      attemptId: ATTEMPT_ID,
      outcome: "message_confirmed",
      communicationMessageId: OUTBOUND_MESSAGE_ID,
      ackName: "DEVICE",
      reconciliationRequired: false,
      replayed: false,
    },
  });
  assert.equal(Object.hasOwn(result, "rawChatId"), false);
});

test("ACK reconciliation reads only the exact provider message id and never searches or sends", async () => {
  const staff = recordingRpcClient(() => ({
    data: [{
      reconciliation_request_id: RECONCILIATION_REQUEST_ID,
      reconciliation_kind: "ack_refresh",
      replayed: false,
    }],
    error: null,
  }));
  const service = recordingRpcClient((functionName) => {
    if (functionName === "manual_whatsapp_reconciliation_context") {
      return {
        data: {
          reconciliation_request_id: RECONCILIATION_REQUEST_ID,
          request_id: REQUEST_ID,
          organization_id: ORGANIZATION_ID,
          conversation_id: CONVERSATION_ID,
          source_message_id: SOURCE_MESSAGE_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          manual_send_authorization_id: AUTHORIZATION_ID,
          reconciliation_kind: "ack_refresh",
          waha_session_name: "crm_primary",
          raw_chat_id: RECIPIENT,
          final_text: FINAL_TEXT,
          final_text_sha256: SHA256,
          expected_provider_message_id: PROVIDER_MESSAGE_ID,
          provider_window_start: REQUESTED_AT,
          provider_window_end: COMPLETED_AT,
          completed: false,
        },
        error: null,
      };
    }
    if (functionName === "resolve_manual_send_waha_runtime") {
      return { data: wahaRuntimeData(), error: null };
    }
    return {
      data: {
        reconciliation_request_id: RECONCILIATION_REQUEST_ID,
        organization_id: ORGANIZATION_ID,
        conversation_id: CONVERSATION_ID,
        attempt_id: ATTEMPT_ID,
        outcome: "delivery_refreshed",
        communication_message_id: OUTBOUND_MESSAGE_ID,
        ack_name: "READ",
        reconciliation_required: false,
        replayed: false,
      },
      error: null,
    };
  });
  let sends = 0;
  let exactReads = 0;
  let searches = 0;

  const result = await executePlatformManualWhatsAppReconciliation(
    staff.client,
    service.client,
    {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      attemptId: ATTEMPT_ID,
      requestId: REQUEST_ID,
      reason: "Staff refreshed delivery status",
      completionRequestId: COMPLETION_REQUEST_ID,
    },
    {
      createWahaProvider() {
        return {
          async sendText() {
            sends += 1;
            throw new Error("must not send");
          },
          async getMessage(input) {
            exactReads += 1;
            assert.deepEqual(input, {
              recipientId: RECIPIENT,
              providerMessageId: PROVIDER_MESSAGE_ID,
              expectedText: FINAL_TEXT,
            });
            return {
              providerMessageId: PROVIDER_MESSAGE_ID,
              providerSource: "api",
              providerObservedAt: COMPLETED_AT,
              ackState: "read",
              ackObservedAt: COMPLETED_AT,
            };
          },
          async findUniqueMessage() {
            searches += 1;
            throw new Error("must not search");
          },
        };
      },
    },
  );

  assert.equal(sends, 0);
  assert.equal(exactReads, 1);
  assert.equal(searches, 0);
  assert.equal(service.calls.at(-1).args.p_provider_message_id, PROVIDER_MESSAGE_ID);
  assert.equal(service.calls.at(-1).args.p_ack_state, "read");
  assert.equal(result.result.outcome, "delivery_refreshed");
});

// WAHA 2026.9.2 GOWS shapes (synthetic ids). sendText answers only { id, _data };
// the message.any echo and GET chat messages carry the chat in `from`, `to: null`.
const GOWS_LID_RECIPIENT = "123456789012345@lid";
const GOWS_MESSAGE_KEY = "3EB0A1B2C3D4E5F60718";
const GOWS_ECHO_ID = `true_${GOWS_LID_RECIPIENT}_${GOWS_MESSAGE_KEY}`;
const GOWS_SENT_AT = "2026-09-02T12:00:01.000Z";

function realGowsProvider(fetchCalls, body) {
  return (runtime) =>
    createPlatformWahaProvider(runtime, {
      fetch: async (url, init) => {
        fetchCalls.push({ url, init });
        return new Response(JSON.stringify(body), { status: 200 });
      },
      now: () => new Date(COMPLETED_AT),
    });
}

test("a GOWS sendText answer finishes the manual send as accepted under the id its echo carries", async () => {
  const service = recordingRpcClient((functionName) => {
    if (functionName === "claim_manual_whatsapp_send_item") {
      return {
        data: {
          ...claimedManualSendData(),
          raw_chat_id: GOWS_LID_RECIPIENT,
          raw_reply_to: `false_${GOWS_LID_RECIPIENT}_SOURCE1`,
        },
        error: null,
      };
    }
    if (functionName === "resolve_manual_send_waha_runtime") {
      return { data: wahaRuntimeData(), error: null };
    }
    return {
      data: {
        organization_id: ORGANIZATION_ID,
        work_item_id: WORK_ITEM_ID,
        attempt_id: ATTEMPT_ID,
        kind: "manual_whatsapp_send",
        state: "succeeded",
        outcome: "succeeded",
        queue_message_id: "42",
        active_message_archived: true,
        automatic_retry_allowed: false,
        communication_message_id: OUTBOUND_MESSAGE_ID,
        provider_identity_private: true,
      },
      error: null,
    };
  });
  const fetchCalls = [];

  const result = await executePlatformManualWhatsAppSend(
    service.client,
    {
      authorization: manualSendAuthorization(),
      visibilityTimeoutSeconds: 120,
      workerRef: "next-app-manual-send",
      claimRequestId: REQUEST_ID,
      completionRequestId: COMPLETION_REQUEST_ID,
    },
    {
      createWahaProvider: realGowsProvider(fetchCalls, {
        id: GOWS_ECHO_ID,
        _data: {
          Info: {
            Chat: GOWS_LID_RECIPIENT,
            Sender: "996700000001:7@s.whatsapp.net",
            IsFromMe: true,
            IsGroup: false,
            ID: GOWS_MESSAGE_KEY,
            Timestamp: "2026-09-02T12:00:01Z",
          },
          Message: { extendedTextMessage: { text: FINAL_TEXT } },
        },
      }),
    },
  );

  assert.deepEqual(fetchCalls.map(({ init }) => init.method), ["POST"]);
  const finishCall = service.calls.find(
    ({ functionName }) => functionName === "finish_manual_whatsapp_send",
  );
  assert.equal(finishCall.args.p_outcome, "succeeded");
  assert.equal(finishCall.args.p_error_code, null);
  assert.equal(finishCall.args.p_provider_message_id, GOWS_ECHO_ID);
  assert.equal(finishCall.args.p_provider_observed_at, GOWS_SENT_AT);
  assert.equal(result.result.outcome, "succeeded");
  assert.equal(result.result.communicationMessageId, OUTBOUND_MESSAGE_ID);
});

test("a GOWS unknown send is recovered by readback alone with the echo's provider id, never with another CRM send's", async () => {
  const staff = recordingRpcClient(() => ({
    data: [{
      reconciliation_request_id: RECONCILIATION_REQUEST_ID,
      reconciliation_kind: "unknown_recovery",
      replayed: false,
    }],
    error: null,
  }));
  const service = recordingRpcClient((functionName) => {
    if (functionName === "manual_whatsapp_reconciliation_context") {
      return {
        data: {
          reconciliation_request_id: RECONCILIATION_REQUEST_ID,
          request_id: REQUEST_ID,
          organization_id: ORGANIZATION_ID,
          conversation_id: CONVERSATION_ID,
          source_message_id: SOURCE_MESSAGE_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          manual_send_authorization_id: AUTHORIZATION_ID,
          reconciliation_kind: "unknown_recovery",
          waha_session_name: "crm_primary",
          raw_chat_id: GOWS_LID_RECIPIENT,
          final_text: FINAL_TEXT,
          final_text_sha256: SHA256,
          expected_provider_message_id: null,
          provider_window_start: REQUESTED_AT,
          provider_window_end: COMPLETED_AT,
          completed: false,
        },
        error: null,
      };
    }
    if (functionName === "resolve_manual_send_waha_runtime") {
      return { data: wahaRuntimeData(), error: null };
    }
    if (functionName === "manual_whatsapp_reconciliation_bound_message_ids") {
      return { data: [EARLIER_CRM_SEND_ID], error: null };
    }
    return {
      data: {
        reconciliation_request_id: RECONCILIATION_REQUEST_ID,
        organization_id: ORGANIZATION_ID,
        conversation_id: CONVERSATION_ID,
        attempt_id: ATTEMPT_ID,
        outcome: "message_confirmed",
        communication_message_id: OUTBOUND_MESSAGE_ID,
        ack_name: "DEVICE",
        reconciliation_required: false,
        replayed: false,
      },
      error: null,
    };
  });
  const fetchCalls = [];
  const EARLIER_CRM_SEND_ID = `true_${GOWS_LID_RECIPIENT}_3EB0EARLIERCRMSEND01`;
  const gowsRecord = {
    id: GOWS_ECHO_ID,
    timestamp: Date.parse(GOWS_SENT_AT) / 1_000,
    from: GOWS_LID_RECIPIENT,
    fromMe: true,
    source: "api",
    body: FINAL_TEXT,
    to: null,
    participant: null,
    ack: 2,
    ackName: "DEVICE",
  };

  const result = await executePlatformManualWhatsAppReconciliation(
    staff.client,
    service.client,
    {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      attemptId: ATTEMPT_ID,
      requestId: REQUEST_ID,
      reason: "Staff requested exact WAHA readback",
      completionRequestId: COMPLETION_REQUEST_ID,
    },
    {
      createWahaProvider: realGowsProvider(fetchCalls, [
        { ...gowsRecord, id: `true_${GOWS_LID_RECIPIENT}_3EB0APPSOURCE0000001`, source: "app" },
        // The same text sent from the CRM a minute earlier and already bound:
        // without the exclusion the readback would be ambiguous (266).
        { ...gowsRecord, id: EARLIER_CRM_SEND_ID, timestamp: gowsRecord.timestamp - 60 },
        gowsRecord,
      ]),
    },
  );

  assert.deepEqual(fetchCalls.map(({ init }) => init.method), ["GET"]);
  const finishCall = service.calls.find(
    ({ functionName }) => functionName === "finish_manual_whatsapp_reconciliation",
  );
  assert.equal(finishCall.args.p_match_count, 1);
  assert.equal(finishCall.args.p_raw_chat_id, GOWS_LID_RECIPIENT);
  assert.equal(finishCall.args.p_provider_message_id, GOWS_ECHO_ID);
  assert.equal(finishCall.args.p_provider_source, "api");
  assert.equal(finishCall.args.p_ack_state, "device");
  assert.equal(finishCall.args.p_provider_observed_at, GOWS_SENT_AT);
  assert.equal(result.status, "finished");
  assert.equal(result.result.outcome, "message_confirmed");
});
