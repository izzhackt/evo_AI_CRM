import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA,
  executePlatformGeminiProposal,
  executePlatformManualWhatsAppReconciliation,
  executePlatformManualWhatsAppSend,
} from "../src/lib/server/platform-provider-orchestrator.ts";
import {
  PlatformGeminiProviderError,
} from "../src/lib/server/platform-gemini-provider.ts";
import {
  PlatformWahaProviderError,
} from "../src/lib/server/platform-waha-provider.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const SOURCE_MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const PROPOSAL_REQUEST_ID = "60000000-0000-4000-8000-000000000001";
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

function validProposal() {
  return {
    schema_version: 2,
    language: "ru",
    intent: "greeting",
    confidence: 91,
    risk: "low",
    handoff_required: false,
    handoff_reasons: [],
    citations: [
      {
        knowledge_key: "evo.services",
        knowledge_version: 3,
        evidence_ordinal: 1,
      },
    ],
    memory_changes: [],
    qualification: {
      status: "collecting",
      completeness: 40,
      missing_fact_keys: ["preferred_country"],
      notes: null,
    },
    reply_text: "Здравствуйте! Чем можем помочь?",
    summary: "Новый вопрос клиента.",
    next_action: "Уточнить страну обучения.",
    draft_internal_note: "Требуется первичная квалификация.",
    missing_document_suggestion: null,
    deadline_warning: null,
    limitations: ["Ответ требует проверки сотрудником."],
    uncertainty: "low",
  };
}

function validGeminiContext() {
  return {
    conversation: {
      conversation_id: CONVERSATION_ID,
      student_case_id: null,
      status: "open",
    },
    source_message: {
      message_id: SOURCE_MESSAGE_ID,
      direction: "inbound",
      language: "ru",
      body_text: "Здравствуйте",
      created_at: REQUESTED_AT,
    },
    approved_knowledge: [
      {
        source_ref: {
          knowledge_key: "evo.services",
          knowledge_version: 3,
          evidence_ordinal: 1,
        },
        title: "EVO services",
        content_text: "EVO helps applicants prepare admissions cases.",
      },
    ],
    allowed_citations: [
      {
        knowledge_key: "evo.services",
        knowledge_version: 3,
        evidence_ordinal: 1,
      },
    ],
  };
}

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
    waha_session_name: "evo-inbox",
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
    waha_session_name: "evo-inbox",
    waha_base_url: "http://evo-crm-waha:3000",
    waha_api_key: "provider-api-key-value",
    binding_version: "3",
  }];
}

test("Gemini structured schema declares every required proposal-v2 field", () => {
  assert.deepEqual(
    Object.keys(PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA.properties).sort(),
    [...PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA.required].sort(),
  );
  assert.equal(
    PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA.properties.reply_text.maxLength,
    2_000,
  );
  assert.equal(
    PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA.properties.citations.maxItems,
    6,
  );
  assert.equal(
    PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA.properties.memory_changes.maxItems,
    9,
  );
  assert.equal(
    PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA.properties.qualification
      .additionalProperties,
    false,
  );
});

test("Gemini execution begins one staff receipt, calls the structured provider once, and finishes advisory-only", async () => {
  const proposal = validProposal();
  const service = recordingRpcClient((functionName) => {
    if (functionName === "begin_gemini_proposal") {
      return {
        data: [{
          proposal_request_id: PROPOSAL_REQUEST_ID,
          replayed: false,
          completed: false,
          outcome: null,
          context: validGeminiContext(),
        }],
        error: null,
      };
    }
    if (functionName === "finish_gemini_proposal") {
      return {
        data: [{
          proposal_request_id: PROPOSAL_REQUEST_ID,
          replayed: false,
          outcome: "proposal_ready",
          failure_code: null,
          human_review_required: true,
          autonomous_authority: false,
          provider_proof_state: "blocked",
        }],
        error: null,
      };
    }
    throw new Error(`unexpected RPC ${functionName}`);
  });
  const providerCalls = [];
  const geminiProvider = {
    async generateStructuredProposal(input) {
      providerCalls.push(input);
      return {
        providerInteractionRef: "gemini-response-1",
        providerStatus: "completed",
        responseJson: proposal,
        evidence: {
          responseId: "gemini-response-1",
          modelVersion: "gemini-3.7-flash-001",
          usage: { totalTokenCount: 120 },
        },
      };
    },
  };

  const result = await executePlatformGeminiProposal(
    service.client,
    {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      requestId: REQUEST_ID,
    },
    { geminiProvider },
  );

  assert.deepEqual(
    service.calls.map(({ functionName }) => functionName),
    ["begin_gemini_proposal", "finish_gemini_proposal"],
  );
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].model, "gemini-3.7-flash");
  assert.equal(providerCalls[0].timeoutMs, 30_000);
  assert.equal(providerCalls[0].maxOutputTokens, 4_096);
  assert.equal(providerCalls[0].temperature, 0.2);
  assert.equal(providerCalls[0].responseJsonSchema.type, "object");
  assert.match(providerCalls[0].prompt, /You prepare one advisory draft/u);
  assert.match(providerCalls[0].prompt, /EVO helps applicants/u);
  assert.equal(Object.hasOwn(providerCalls[0], "tools"), false);
  assert.equal(service.calls[1].args.p_outcome, "proposal_ready");
  assert.equal(service.calls[1].args.p_provider_status, "completed");
  assert.deepEqual(service.calls[1].args.p_response_json, proposal);
  assert.equal(service.calls[1].args.p_prompt_text, providerCalls[0].prompt);
  assert.deepEqual(result, {
    status: "finished",
    result: {
      proposalRequestId: PROPOSAL_REQUEST_ID,
      replayed: false,
      outcome: "proposal_ready",
      failureCode: null,
      humanReviewRequired: true,
      autonomousAuthority: false,
      providerProofState: "blocked",
    },
  });
});

test("Gemini timeout is recorded for human review after one provider call with no retry", async () => {
  const service = recordingRpcClient((functionName) => {
    if (functionName === "begin_gemini_proposal") {
      return {
        data: [{
          proposal_request_id: PROPOSAL_REQUEST_ID,
          replayed: false,
          completed: false,
          outcome: null,
          context: validGeminiContext(),
        }],
        error: null,
      };
    }
    return {
      data: [{
        proposal_request_id: PROPOSAL_REQUEST_ID,
        replayed: false,
        outcome: "human_review",
        failure_code: "provider_timeout",
        human_review_required: true,
        autonomous_authority: false,
        provider_proof_state: "blocked",
      }],
      error: null,
    };
  });
  let providerCalls = 0;

  const result = await executePlatformGeminiProposal(
    service.client,
    {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      requestId: REQUEST_ID,
    },
    {
      geminiProvider: {
        async generateStructuredProposal() {
          providerCalls += 1;
          throw new PlatformGeminiProviderError("provider_timeout");
        },
      },
    },
  );

  assert.equal(providerCalls, 1);
  assert.deepEqual(
    service.calls.map(({ functionName }) => functionName),
    ["begin_gemini_proposal", "finish_gemini_proposal"],
  );
  assert.equal(service.calls[1].args.p_outcome, "human_review");
  assert.equal(service.calls[1].args.p_failure_code, "provider_timeout");
  assert.equal(service.calls[1].args.p_provider_interaction_ref, null);
  assert.equal(service.calls[1].args.p_provider_status, "transport_error");
  assert.equal(service.calls[1].args.p_response_json, null);
  assert.equal(result.status, "finished");
  assert.equal(result.result.outcome, "human_review");
  assert.equal(result.result.failureCode, "provider_timeout");
});

test("an incomplete Gemini request replay never calls the provider or finish again", async () => {
  const service = recordingRpcClient(() => ({
    data: [{
      proposal_request_id: PROPOSAL_REQUEST_ID,
      replayed: true,
      completed: false,
      outcome: null,
      context: validGeminiContext(),
    }],
    error: null,
  }));
  let providerCalls = 0;

  const result = await executePlatformGeminiProposal(
    service.client,
    {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      requestId: REQUEST_ID,
    },
    {
      geminiProvider: {
        async generateStructuredProposal() {
          providerCalls += 1;
          throw new Error("must not run");
        },
      },
    },
  );

  assert.equal(providerCalls, 0);
  assert.deepEqual(
    service.calls.map(({ functionName }) => functionName),
    ["begin_gemini_proposal"],
  );
  assert.deepEqual(result, {
    status: "in_progress",
    proposalRequestId: PROPOSAL_REQUEST_ID,
  });
});

test("an unknown Gemini provider failure is durably recorded without leaking its message", async () => {
  const service = recordingRpcClient((functionName) => {
    if (functionName === "begin_gemini_proposal") {
      return {
        data: [{
          proposal_request_id: PROPOSAL_REQUEST_ID,
          replayed: false,
          completed: false,
          outcome: null,
          context: validGeminiContext(),
        }],
        error: null,
      };
    }
    return {
      data: [{
        proposal_request_id: PROPOSAL_REQUEST_ID,
        replayed: false,
        outcome: "human_review",
        failure_code: "provider_error",
        human_review_required: true,
        autonomous_authority: false,
        provider_proof_state: "blocked",
      }],
      error: null,
    };
  });
  let providerCalls = 0;

  const result = await executePlatformGeminiProposal(
    service.client,
    {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      requestId: REQUEST_ID,
    },
    {
      geminiProvider: {
        async generateStructuredProposal() {
          providerCalls += 1;
          throw new Error("raw upstream secret or customer detail");
        },
      },
    },
  );

  assert.equal(providerCalls, 1);
  assert.equal(service.calls[1].args.p_failure_code, "provider_error");
  assert.equal(service.calls[1].args.p_provider_status, "local_error");
  assert.equal(JSON.stringify(result).includes("raw upstream"), false);
});

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
          waha_session_name: "evo-inbox",
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
          waha_session_name: "evo-inbox",
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
  assert.equal(createdRuntimes[0].wahaSessionName, "evo-inbox");
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
          waha_session_name: "evo-inbox",
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
          waha_session_name: "evo-inbox",
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
          waha_session_name: "evo-inbox",
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
    if (functionName === "resolve_manual_send_waha_runtime") {
      return {
        data: [{
          waha_session_name: "evo-inbox",
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
    "provider_bounded_readback",
    "finish_manual_whatsapp_reconciliation",
  ]);
  assert.equal(service.calls[2].args.p_reconciliation_request_id, RECONCILIATION_REQUEST_ID);
  assert.equal(service.calls[2].args.p_raw_chat_id, RECIPIENT);
  assert.equal(service.calls[2].args.p_match_count, 1);
  assert.equal(service.calls[2].args.p_provider_message_id, PROVIDER_MESSAGE_ID);
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
          waha_session_name: "evo-inbox",
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
