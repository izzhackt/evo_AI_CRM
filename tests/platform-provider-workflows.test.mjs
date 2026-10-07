import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_WAHA_BASE_URL,
  PlatformProviderWorkflowError,
  claimManualWhatsAppSendItem,
  finishManualWhatsAppReconciliation,
  finishManualWhatsAppSend,
  getManualWhatsAppReconciliationBoundMessageIds,
  getManualWhatsAppReconciliationContext,
  requestManualWhatsAppReconciliation,
  requestManualWhatsAppSendWithAuthorization,
  resolveManualSendWahaRuntime,
} from "../src/lib/platform-provider-workflows.ts";

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
const SHA256 = "a".repeat(64);

test("the active provider workflow exposes only the connected sales WAHA transport", () => {
  assert.equal(PLATFORM_WAHA_BASE_URL, "http://evo-crm-waha:3000");
});

function recordingClient(responseFor) {
  const calls = [];
  return {
    calls,
    client: {
      schema(schema) {
        calls.push({ kind: "schema", schema });
        return {
          rpc(functionName, args, options) {
            calls.push({ kind: "rpc", functionName, args, options });
            return Promise.resolve(responseFor(functionName, args, options));
          },
        };
      },
    },
  };
}

function staticClient(data, error = null) {
  return recordingClient(() => ({ data, error }));
}

test("provider workflow adapters fail closed without leaking Supabase errors", async () => {
  const sensitiveError = staticClient(null, {
    message: "service role rejected: super-secret-value",
  });

  await assert.rejects(
    resolveManualSendWahaRuntime(sensitiveError.client, ORGANIZATION_ID),
    (error) => {
      assert.equal(error instanceof PlatformProviderWorkflowError, true);
      assert.equal(error.message, "Platform provider workflow is unavailable.");
      assert.doesNotMatch(error.message, /super-secret-value/);
      return true;
    },
  );
});

test("requestManualWhatsAppSendWithAuthorization creates one exact durable send intent", async () => {
  const recorded = staticClient({
    organization_id: ORGANIZATION_ID,
    manual_send_authorization_id: AUTHORIZATION_ID,
    communication_conversation_id: CONVERSATION_ID,
    source_message_id: SOURCE_MESSAGE_ID,
    ai_draft_id: null,
    final_text: "Здравствуйте! Готовы продолжить консультацию?",
    final_text_sha256: SHA256,
    authorized_by_membership_id: MEMBERSHIP_ID,
    state: "manual_send_authorized",
    requested_by_membership_id: MEMBERSHIP_ID,
    work_item_id: WORK_ITEM_ID,
    work_state: "queued",
    queue_message_id: "42",
    business_key_sha256: SHA256,
    waha_readiness: "ready",
    waha_readiness_evidence_kind: "provider_observed",
    waha_readiness_fresh: true,
    waha_readiness_observed_at: REQUESTED_AT,
  });

  const result = await requestManualWhatsAppSendWithAuthorization(
    recorded.client,
    {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      aiDraftId: null,
      finalText: "Здравствуйте! Готовы продолжить консультацию?",
      reason: "Staff confirmed recipient and final text",
      businessKeySha256: SHA256,
      requestId: REQUEST_ID,
    },
  );

  assert.deepEqual(recorded.calls[1], {
    kind: "rpc",
    functionName: "request_manual_whatsapp_send_with_authorization",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
      p_source_message_id: SOURCE_MESSAGE_ID,
      p_ai_draft_id: null,
      p_final_text: "Здравствуйте! Готовы продолжить консультацию?",
      p_reason: "Staff confirmed recipient and final text",
      p_business_key_sha256: SHA256,
      p_request_id: REQUEST_ID,
    },
    options: undefined,
  });
  assert.equal(result.workItemId, WORK_ITEM_ID);
  assert.equal(result.workState, "queued");
  assert.equal(result.wahaReadiness, "ready");
  assert.equal(result.wahaReadinessEvidenceKind, "provider_observed");
});

test("claimManualWhatsAppSendItem claims only the requested work item", async () => {
  const recorded = staticClient({
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
    raw_chat_id: "996555000001@c.us",
    raw_reply_to: "false_996555000001@c.us_ABCD1234",
    final_text: "Здравствуйте! Готовы продолжить консультацию?",
    final_text_sha256: SHA256,
    attempt_number: 1,
    max_attempts: 1,
    lease_expires_at: COMPLETED_AT,
    queue_payload_is_pointer_only: true,
  });

  const result = await claimManualWhatsAppSendItem(recorded.client, {
    organizationId: ORGANIZATION_ID,
    workItemId: WORK_ITEM_ID,
    visibilityTimeoutSeconds: 120,
    workerRef: "next-app-manual-send",
    requestId: REQUEST_ID,
  });

  assert.deepEqual(recorded.calls[1], {
    kind: "rpc",
    functionName: "claim_manual_whatsapp_send_item",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_work_item_id: WORK_ITEM_ID,
      p_visibility_timeout_seconds: 120,
      p_worker_ref: "next-app-manual-send",
      p_request_id: REQUEST_ID,
    },
    options: undefined,
  });
  assert.equal(result.claimed, true);
  assert.equal(result.workItemId, WORK_ITEM_ID);
  assert.equal(result.requestedWorkItemId, WORK_ITEM_ID);
  assert.equal(result.wahaSessionName, "crm_primary");
  assert.equal(result.queuePayloadIsPointerOnly, true);
});

test("claimManualWhatsAppSendItem represents an unavailable exact item without falling back", async () => {
  const recorded = staticClient({
    claimed: false,
    queue: "platform_work_v1",
    requested_work_item_id: WORK_ITEM_ID,
  });

  assert.deepEqual(
    await claimManualWhatsAppSendItem(recorded.client, {
      organizationId: ORGANIZATION_ID,
      workItemId: WORK_ITEM_ID,
      visibilityTimeoutSeconds: 120,
      workerRef: "next-app-manual-send",
      requestId: REQUEST_ID,
    }),
    {
      claimed: false,
      queue: "platform_work_v1",
      requestedWorkItemId: WORK_ITEM_ID,
    },
  );
});

test("resolveManualSendWahaRuntime accepts only the one private crm_primary binding", async () => {
  const recorded = staticClient([
    {
      waha_session_name: "crm_primary",
      waha_base_url: "http://evo-crm-waha:3000",
      waha_api_key: "provider-api-key-value",
      binding_version: "3",
    },
  ]);

  const result = await resolveManualSendWahaRuntime(
    recorded.client,
    ORGANIZATION_ID,
  );

  assert.deepEqual(recorded.calls[1], {
    kind: "rpc",
    functionName: "resolve_manual_send_waha_runtime",
    args: { p_organization_id: ORGANIZATION_ID },
    options: undefined,
  });
  assert.deepEqual(result, {
    wahaSessionName: "crm_primary",
    wahaBaseUrl: "http://evo-crm-waha:3000",
    wahaApiKey: "provider-api-key-value",
    bindingVersion: "3",
  });
});

test("finishManualWhatsAppSend records provider acceptance without exposing a retry path", async () => {
  const recorded = staticClient({
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
  });

  const result = await finishManualWhatsAppSend(recorded.client, {
    organizationId: ORGANIZATION_ID,
    workItemId: WORK_ITEM_ID,
    attemptId: ATTEMPT_ID,
    authorizationId: AUTHORIZATION_ID,
    outcome: "succeeded",
    errorCode: null,
    providerMessageId: "false_996555000001@c.us_PROVIDER1",
    providerObservedAt: COMPLETED_AT,
    requestId: COMPLETION_REQUEST_ID,
  });

  assert.equal(recorded.calls[1].functionName, "finish_manual_whatsapp_send");
  assert.deepEqual(result, {
    organizationId: ORGANIZATION_ID,
    workItemId: WORK_ITEM_ID,
    attemptId: ATTEMPT_ID,
    outcome: "succeeded",
    communicationMessageId: OUTBOUND_MESSAGE_ID,
    providerIdentityPrivate: true,
  });
});

test("the readback exclusion list: the chat's other CRM sends' provider ids, bounded and unique, fail closed", async () => {
  const ids = ["true_996555000001@c.us_AAAAAAAAAAAAAAAAAAAA", "true_996555000001@c.us_BBBBBBBBBBBBBBBBBBBB"];
  const recorded = staticClient(ids);
  assert.deepEqual(
    await getManualWhatsAppReconciliationBoundMessageIds(recorded.client, RECONCILIATION_REQUEST_ID),
    ids,
  );
  assert.equal(recorded.calls[1].functionName, "manual_whatsapp_reconciliation_bound_message_ids");
  assert.deepEqual(recorded.calls[1].args, { p_reconciliation_request_id: RECONCILIATION_REQUEST_ID });
  assert.deepEqual(await getManualWhatsAppReconciliationBoundMessageIds(staticClient([]).client, RECONCILIATION_REQUEST_ID), []);
  for (const bad of [null, {}, [ids[0], ids[0]], ["has\ncontrol"], [42], Array.from({ length: 201 }, (_, index) => `id-${index}`)]) {
    await assert.rejects(
      getManualWhatsAppReconciliationBoundMessageIds(staticClient(bad).client, RECONCILIATION_REQUEST_ID),
      PlatformProviderWorkflowError,
      JSON.stringify(bad).slice(0, 60),
    );
  }
  await assert.rejects(
    getManualWhatsAppReconciliationBoundMessageIds(staticClient(null, { code: "42501" }).client, RECONCILIATION_REQUEST_ID),
    PlatformProviderWorkflowError,
  );
});

test("manual WhatsApp reconciliation uses authenticated request plus service-only exact readback", async () => {
  const context = {
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
    raw_chat_id: "996555000001@c.us",
    final_text: "Здравствуйте! Готовы продолжить консультацию?",
    final_text_sha256: SHA256,
    expected_provider_message_id: null,
    provider_window_start: REQUESTED_AT,
    provider_window_end: COMPLETED_AT,
    completed: false,
  };
  const recorded = recordingClient((functionName) => {
    if (functionName === "request_manual_whatsapp_reconciliation") {
      return {
        data: [{
          reconciliation_request_id: RECONCILIATION_REQUEST_ID,
          reconciliation_kind: "unknown_recovery",
          replayed: false,
        }],
        error: null,
      };
    }
    if (functionName === "manual_whatsapp_reconciliation_context") {
      return { data: context, error: null };
    }
    return {
      data: {
        reconciliation_request_id: RECONCILIATION_REQUEST_ID,
        organization_id: ORGANIZATION_ID,
        conversation_id: CONVERSATION_ID,
        attempt_id: ATTEMPT_ID,
        outcome: "message_confirmed",
        communication_message_id: OUTBOUND_MESSAGE_ID,
        ack_name: "SERVER",
        reconciliation_required: false,
        replayed: false,
      },
      error: null,
    };
  });

  const request = await requestManualWhatsAppReconciliation(recorded.client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    attemptId: ATTEMPT_ID,
    requestId: REQUEST_ID,
    reason: "Staff requested exact WAHA readback",
  });
  const readback = await getManualWhatsAppReconciliationContext(
    recorded.client,
    RECONCILIATION_REQUEST_ID,
  );
  const finished = await finishManualWhatsAppReconciliation(recorded.client, {
    reconciliationRequestId: RECONCILIATION_REQUEST_ID,
    wahaSessionName: "crm_primary",
    rawChatId: "996555000001@c.us",
    finalTextSha256: SHA256,
    matchCount: 1,
    providerMessageId: "false_996555000001@c.us_PROVIDER1",
    providerSource: "api",
    ackState: "server",
    providerObservedAt: COMPLETED_AT,
    ackObservedAt: COMPLETED_AT,
    completionRequestId: COMPLETION_REQUEST_ID,
  });

  assert.deepEqual(recorded.calls[1], {
    kind: "rpc",
    functionName: "request_manual_whatsapp_reconciliation",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
      p_attempt_id: ATTEMPT_ID,
      p_request_id: REQUEST_ID,
      p_reason: "Staff requested exact WAHA readback",
    },
    options: undefined,
  });
  assert.deepEqual(recorded.calls[3], {
    kind: "rpc",
    functionName: "manual_whatsapp_reconciliation_context",
    args: { p_reconciliation_request_id: RECONCILIATION_REQUEST_ID },
    options: undefined,
  });
  assert.deepEqual(recorded.calls[5], {
    kind: "rpc",
    functionName: "finish_manual_whatsapp_reconciliation",
    args: {
      p_reconciliation_request_id: RECONCILIATION_REQUEST_ID,
      p_waha_session_name: "crm_primary",
      p_raw_chat_id: "996555000001@c.us",
      p_final_text_sha256: SHA256,
      p_match_count: 1,
      p_provider_message_id: "false_996555000001@c.us_PROVIDER1",
      p_provider_source: "api",
      p_ack_state: "server",
      p_provider_observed_at: COMPLETED_AT,
      p_ack_observed_at: COMPLETED_AT,
      p_completion_request_id: COMPLETION_REQUEST_ID,
    },
    options: undefined,
  });
  assert.deepEqual(request, {
    reconciliationRequestId: RECONCILIATION_REQUEST_ID,
    reconciliationKind: "unknown_recovery",
    replayed: false,
  });
  assert.equal(readback.rawChatId, "996555000001@c.us");
  assert.equal(readback.completed, false);
  assert.equal(finished.outcome, "message_confirmed");
  assert.equal(finished.reconciliationRequired, false);
});

test("manual WhatsApp adapters reject mismatched exact-item and malformed safety results", async (t) => {
  const cases = [
    [
      "claim returns another item",
      claimManualWhatsAppSendItem,
      {
        organizationId: ORGANIZATION_ID,
        workItemId: WORK_ITEM_ID,
        visibilityTimeoutSeconds: 120,
        workerRef: "next-app-manual-send",
        requestId: REQUEST_ID,
      },
      {
        claimed: false,
        queue: "platform_work_v1",
        requested_work_item_id: ATTEMPT_ID,
      },
    ],
    [
      "runtime has a second row",
      resolveManualSendWahaRuntime,
      ORGANIZATION_ID,
      [
        {
          waha_session_name: "crm_primary",
          waha_base_url: "http://evo-crm-waha:3000",
          waha_api_key: "provider-api-key-value",
          binding_version: "3",
        },
        {
          waha_session_name: "crm_primary",
          waha_base_url: "http://evo-crm-waha:3000",
          waha_api_key: "another-provider-key",
          binding_version: "4",
        },
      ],
    ],
    [
      "finish claims an automatic retry remains",
      finishManualWhatsAppSend,
      {
        organizationId: ORGANIZATION_ID,
        workItemId: WORK_ITEM_ID,
        attemptId: ATTEMPT_ID,
        authorizationId: AUTHORIZATION_ID,
        outcome: "succeeded",
        errorCode: null,
        providerMessageId: "false_996555000001@c.us_PROVIDER1",
        providerObservedAt: COMPLETED_AT,
        requestId: COMPLETION_REQUEST_ID,
      },
      {
        organization_id: ORGANIZATION_ID,
        work_item_id: WORK_ITEM_ID,
        attempt_id: ATTEMPT_ID,
        outcome: "succeeded",
        communication_message_id: OUTBOUND_MESSAGE_ID,
        provider_identity_private: true,
        automatic_retry_allowed: true,
      },
    ],
    [
      "reconciliation reports no match for a matched provider message",
      finishManualWhatsAppReconciliation,
      {
        reconciliationRequestId: RECONCILIATION_REQUEST_ID,
        wahaSessionName: "crm_primary",
        rawChatId: "996555000001@c.us",
        finalTextSha256: SHA256,
        matchCount: 1,
        providerMessageId: "false_996555000001@c.us_PROVIDER1",
        providerSource: "api",
        ackState: "server",
        providerObservedAt: COMPLETED_AT,
        ackObservedAt: COMPLETED_AT,
        completionRequestId: COMPLETION_REQUEST_ID,
      },
      {
        reconciliation_request_id: RECONCILIATION_REQUEST_ID,
        organization_id: ORGANIZATION_ID,
        conversation_id: CONVERSATION_ID,
        attempt_id: ATTEMPT_ID,
        outcome: "message_not_found",
        communication_message_id: null,
        ack_name: null,
        reconciliation_required: true,
        replayed: false,
      },
    ],
  ];

  for (const [name, operation, input, data] of cases) {
    await t.test(name, async () => {
      const malformed = staticClient(data);
      await assert.rejects(
        operation(malformed.client, input),
        PlatformProviderWorkflowError,
      );
    });
  }
});

test("manual WhatsApp adapters reject a malformed SDK response envelope", async () => {
  const malformed = recordingClient(() => ({
    data: [{
      waha_session_name: "crm_primary",
      waha_base_url: "http://evo-crm-waha:3000",
      waha_api_key: "provider-api-key-value",
      binding_version: "3",
    }],
  }));

  await assert.rejects(
    resolveManualSendWahaRuntime(malformed.client, ORGANIZATION_ID),
    PlatformProviderWorkflowError,
  );
});
