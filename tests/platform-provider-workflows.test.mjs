import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_GEMINI_MODEL_REF,
  PLATFORM_GEMINI_PROMPT_POLICY_VERSION,
  PLATFORM_GEMINI_SCHEMA_VERSION,
  PlatformProviderWorkflowError,
  beginGeminiProposal,
  claimManualWhatsAppSendItem,
  finishGeminiProposal,
  finishManualWhatsAppReconciliation,
  finishManualWhatsAppSend,
  getManualWhatsAppReconciliationContext,
  listStaffGeminiProposalReviews,
  readStaffGeminiProposal,
  readLatestManualWhatsAppSendAttempt,
  requestGeminiProposal,
  requestManualWhatsAppReconciliation,
  requestManualWhatsAppSendWithAuthorization,
  resolveManualSendWahaRuntime,
  reviewGeminiProposal,
} from "../src/lib/platform-provider-workflows.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const SOURCE_MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "50000000-0000-4000-8000-000000000001";
const PROPOSAL_REQUEST_ID = "60000000-0000-4000-8000-000000000001";
const REVIEW_REQUEST_ID = "70000000-0000-4000-8000-000000000001";
const REVIEW_ID = "80000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "90000000-0000-4000-8000-000000000001";
const AUTHORIZATION_ID = "a0000000-0000-4000-8000-000000000001";
const WORK_ITEM_ID = "b0000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "c0000000-0000-4000-8000-000000000001";
const OUTBOUND_MESSAGE_ID = "d0000000-0000-4000-8000-000000000001";
const RECONCILIATION_REQUEST_ID = "e0000000-0000-4000-8000-000000000001";
const COMPLETION_REQUEST_ID = "f0000000-0000-4000-8000-000000000001";
const REQUESTED_AT = "2026-09-02T12:00:00+00:00";
const COMPLETED_AT = "2026-09-02T12:00:02+00:00";
const REVIEWED_AT = "2026-09-02T12:01:00+00:00";
const SHA256 = "a".repeat(64);

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
    limitations: [],
    uncertainty: "low",
  };
}

function validContext() {
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

function validProposalRow(overrides = {}) {
  const proposal = validProposal();
  return {
    proposal_request_id: PROPOSAL_REQUEST_ID,
    source_message_id: SOURCE_MESSAGE_ID,
    outcome: "proposal_ready",
    failure_code: null,
    model_ref: PLATFORM_GEMINI_MODEL_REF,
    schema_version: PLATFORM_GEMINI_SCHEMA_VERSION,
    language: proposal.language,
    intent: proposal.intent,
    confidence: proposal.confidence,
    risk: proposal.risk,
    handoff_required: proposal.handoff_required,
    handoff_reasons: proposal.handoff_reasons,
    citations: proposal.citations,
    memory_changes: proposal.memory_changes,
    qualification: proposal.qualification,
    reply_text: proposal.reply_text,
    summary: proposal.summary,
    next_action: proposal.next_action,
    draft_internal_note: proposal.draft_internal_note,
    missing_document_suggestion: proposal.missing_document_suggestion,
    deadline_warning: proposal.deadline_warning,
    limitations: proposal.limitations,
    uncertainty: proposal.uncertainty,
    requested_at: REQUESTED_AT,
    completed_at: COMPLETED_AT,
    human_review_required: true,
    autonomous_authority: false,
    provider_proof_state: "blocked",
    ...overrides,
  };
}

test("requestGeminiProposal records the authenticated staff request with the pinned contract", async () => {
  const recorded = staticClient([
    {
      proposal_request_receipt_id: RECEIPT_ID,
      request_id: REQUEST_ID,
      replayed: false,
      completed: false,
      outcome: null,
    },
  ]);

  const result = await requestGeminiProposal(recorded.client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    requestId: REQUEST_ID,
    reason: "Staff requested a reviewed reply proposal",
  });

  assert.deepEqual(recorded.calls, [
    { kind: "schema", schema: "platform" },
    {
      kind: "rpc",
      functionName: "request_gemini_proposal",
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_conversation_id: CONVERSATION_ID,
        p_source_message_id: SOURCE_MESSAGE_ID,
        p_request_id: REQUEST_ID,
        p_model_ref: "gemini-3.7-flash",
        p_schema_version: 2,
        p_prompt_policy_version: "u9-gemini-human-review-v1",
        p_reason: "Staff requested a reviewed reply proposal",
      },
      options: undefined,
    },
  ]);
  assert.deepEqual(result, {
    proposalRequestReceiptId: RECEIPT_ID,
    requestId: REQUEST_ID,
    replayed: false,
    completed: false,
    outcome: null,
  });
});

test("beginGeminiProposal returns only a validated private provider context", async () => {
  const context = validContext();
  const recorded = staticClient([
    {
      proposal_request_id: PROPOSAL_REQUEST_ID,
      replayed: false,
      completed: false,
      outcome: null,
      context,
    },
  ]);

  const result = await beginGeminiProposal(recorded.client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    requestId: REQUEST_ID,
  });

  assert.deepEqual(recorded.calls[1], {
    kind: "rpc",
    functionName: "begin_gemini_proposal",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
      p_source_message_id: SOURCE_MESSAGE_ID,
      p_request_id: REQUEST_ID,
      p_model_ref: PLATFORM_GEMINI_MODEL_REF,
      p_schema_version: PLATFORM_GEMINI_SCHEMA_VERSION,
      p_prompt_policy_version: PLATFORM_GEMINI_PROMPT_POLICY_VERSION,
    },
    options: undefined,
  });
  assert.deepEqual(result.context, {
    conversation: {
      conversationId: CONVERSATION_ID,
      studentCaseId: null,
      status: "open",
    },
    sourceMessage: {
      messageId: SOURCE_MESSAGE_ID,
      direction: "inbound",
      language: "ru",
      bodyText: "Здравствуйте",
      createdAt: REQUESTED_AT,
    },
    approvedKnowledge: [
      {
        sourceRef: {
          knowledgeKey: "evo.services",
          knowledgeVersion: 3,
          evidenceOrdinal: 1,
        },
        title: "EVO services",
        contentText: "EVO helps applicants prepare admissions cases.",
      },
    ],
    allowedCitations: [
      {
        knowledgeKey: "evo.services",
        knowledgeVersion: 3,
        evidenceOrdinal: 1,
      },
    ],
  });
});

test("finishGeminiProposal stores a proposal-only result and preserves the no-autonomy invariant", async () => {
  const recorded = staticClient([
    {
      proposal_request_id: PROPOSAL_REQUEST_ID,
      replayed: false,
      outcome: "proposal_ready",
      failure_code: null,
      human_review_required: true,
      autonomous_authority: false,
      provider_proof_state: "blocked",
    },
  ]);

  const result = await finishGeminiProposal(recorded.client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    proposalRequestId: PROPOSAL_REQUEST_ID,
    outcome: "proposal_ready",
    failureCode: null,
    promptText: "Generate one human-reviewed proposal.",
    providerInteractionRef: "gemini-response-1",
    providerStatus: "completed",
    responseJson: validProposal(),
  });

  assert.equal(recorded.calls[1].functionName, "finish_gemini_proposal");
  assert.deepEqual(result, {
    proposalRequestId: PROPOSAL_REQUEST_ID,
    replayed: false,
    outcome: "proposal_ready",
    failureCode: null,
    humanReviewRequired: true,
    autonomousAuthority: false,
    providerProofState: "blocked",
  });
});

test("readStaffGeminiProposal converts the flattened RLS projection into one typed proposal", async () => {
  const recorded = staticClient([validProposalRow()]);

  const result = await readStaffGeminiProposal(recorded.client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
  });

  assert.deepEqual(recorded.calls[1], {
    kind: "rpc",
    functionName: "staff_gemini_proposal",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
    },
    options: { get: true },
  });
  assert.deepEqual(result, {
    proposalRequestId: PROPOSAL_REQUEST_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    outcome: "proposal_ready",
    failureCode: null,
    modelRef: "gemini-3.7-flash",
    schemaVersion: 2,
    proposal: validProposal(),
    requestedAt: REQUESTED_AT,
    completedAt: COMPLETED_AT,
    humanReviewRequired: true,
    autonomousAuthority: false,
    providerProofState: "blocked",
  });
});

test("readStaffGeminiProposal returns null when no staff-bound proposal exists", async () => {
  const empty = staticClient([]);

  assert.equal(
    await readStaffGeminiProposal(empty.client, {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
    }),
    null,
  );
});

test("reviewGeminiProposal and review history expose human decisions without send authority", async () => {
  const proposal = validProposal();
  const reviewRow = {
    review_id: REVIEW_ID,
    proposal_request_id: PROPOSAL_REQUEST_ID,
    decision: "accepted",
    reviewed_payload: proposal,
    reviewed_payload_sha256: SHA256,
    reason: "Staff verified the recipient and final text",
    reviewed_by_membership_id: MEMBERSHIP_ID,
    reviewed_by_name: "Admissions Manager",
    reviewed_at: REVIEWED_AT,
  };
  const recorded = recordingClient((functionName) => ({
    data: functionName === "review_gemini_proposal"
      ? [{ ...reviewRow, replayed: false }]
      : [reviewRow],
    error: null,
  }));

  const review = await reviewGeminiProposal(recorded.client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    proposalRequestId: PROPOSAL_REQUEST_ID,
    reviewRequestId: REVIEW_REQUEST_ID,
    decision: "accepted",
    reviewedPayload: proposal,
    reason: "Staff verified the recipient and final text",
  });
  const history = await listStaffGeminiProposalReviews(recorded.client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    limit: 10,
  });

  assert.equal(recorded.calls[1].functionName, "review_gemini_proposal");
  assert.equal(recorded.calls[3].functionName, "staff_gemini_proposal_reviews");
  assert.equal(review.replayed, false);
  assert.equal(review.decision, "accepted");
  assert.deepEqual(history, [
    {
      reviewId: REVIEW_ID,
      proposalRequestId: PROPOSAL_REQUEST_ID,
      decision: "accepted",
      reviewedPayload: proposal,
      reviewedPayloadSha256: SHA256,
      reason: "Staff verified the recipient and final text",
      reviewedByMembershipId: MEMBERSHIP_ID,
      reviewedByName: "Admissions Manager",
      reviewedAt: REVIEWED_AT,
    },
  ]);
});

test("Gemini adapters fail closed without leaking Supabase errors", async () => {
  const sensitiveError = staticClient(null, {
    message: "service role rejected: super-secret-value",
  });

  await assert.rejects(
    requestGeminiProposal(sensitiveError.client, {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      requestId: REQUEST_ID,
      reason: "Staff requested a reviewed reply proposal",
    }),
    (error) => {
      assert.equal(error instanceof PlatformProviderWorkflowError, true);
      assert.equal(error.message, "Platform provider workflow is unavailable.");
      assert.doesNotMatch(error.message, /super-secret-value/);
      return true;
    },
  );
});

test("Gemini adapters reject malformed and non-exact RPC results", async (t) => {
  const cases = [
    ["non-array", null],
    ["duplicate", [validProposalRow(), validProposalRow()]],
    ["wrong security invariant", [validProposalRow({ autonomous_authority: true })]],
    ["malformed proposal", [validProposalRow({ citations: "not-an-array" })]],
  ];

  for (const [name, data] of cases) {
    await t.test(name, async () => {
      const malformed = staticClient(data);
      await assert.rejects(
        readStaffGeminiProposal(malformed.client, {
          organizationId: ORGANIZATION_ID,
          conversationId: CONVERSATION_ID,
        }),
        PlatformProviderWorkflowError,
      );
    });
  }
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
    waha_session_name: "evo-inbox",
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
  assert.equal(result.wahaSessionName, "evo-inbox");
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

test("resolveManualSendWahaRuntime accepts only the one private evo-inbox binding", async () => {
  const recorded = staticClient([
    {
      waha_session_name: "evo-inbox",
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
    wahaSessionName: "evo-inbox",
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

test("readLatestManualWhatsAppSendAttempt exposes staff-safe delivery and reconciliation state", async () => {
  const recorded = staticClient([
    {
      attempt_id: ATTEMPT_ID,
      work_item_id: WORK_ITEM_ID,
      conversation_id: CONVERSATION_ID,
      manual_send_authorization_id: AUTHORIZATION_ID,
      final_text: "Здравствуйте! Готовы продолжить консультацию?",
      authorized_by_membership_id: MEMBERSHIP_ID,
      authorized_by_name: "Admissions Manager",
      status: "accepted",
      reconciliation_required: false,
      provider_source: "api",
      ack_name: "SERVER",
      provider_observed_at: COMPLETED_AT,
      ack_observed_at: COMPLETED_AT,
      failure_code: null,
      attempt_number: 1,
      authorized_at: REQUESTED_AT,
      claimed_at: REQUESTED_AT,
      settled_at: COMPLETED_AT,
      last_reconciled_at: null,
      latest_reconciliation_kind: null,
      latest_reconciliation_outcome: null,
    },
  ]);

  const result = await readLatestManualWhatsAppSendAttempt(recorded.client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
  });

  assert.equal(recorded.calls[1].functionName, "staff_latest_manual_whatsapp_send_attempt");
  assert.equal(recorded.calls[1].options.get, true);
  assert.equal(result.status, "accepted");
  assert.equal(result.ackName, "SERVER");
  assert.equal(result.reconciliationRequired, false);
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
    waha_session_name: "evo-inbox",
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
    wahaSessionName: "evo-inbox",
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
      p_waha_session_name: "evo-inbox",
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
          waha_session_name: "evo-inbox",
          waha_base_url: "http://evo-crm-waha:3000",
          waha_api_key: "provider-api-key-value",
          binding_version: "3",
        },
        {
          waha_session_name: "evo-inbox",
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
        wahaSessionName: "evo-inbox",
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
      waha_session_name: "evo-inbox",
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
