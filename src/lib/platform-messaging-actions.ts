"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { parsePlatformRouteUuid } from "./platform-communications";
import { requirePlatformMessagingActor } from "./platform-guards";
import {
  derivePlatformBusinessKey,
  derivePlatformSemanticRequestId,
  getPlatformConversationWorkflow,
  normalizePlatformMessageText,
  normalizePlatformMutationReason,
  PlatformMessagingWorkflowError,
  type AuthorizePlatformManualSendInput,
  type PlatformAiDraftLanguage,
  type PlatformAiDraftReviewDecision,
  type PlatformConversationWorkflow,
  type PlatformMessagingMutationResult,
  type PlatformMessagingOperation,
  type RequestPlatformAiDraftInput,
  type ReviewPlatformAiDraftInput,
} from "./platform-messaging-workflow";
import { createSupabaseServerClient } from "./supabase/server";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OUTBOX_STATES = new Set([
  "queued",
  "leased",
  "retry_wait",
  "succeeded",
  "dead_lettered",
  "unknown_manual_review",
  "conflict_manual_review",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalUuid(value: unknown): string | null {
  return parsePlatformRouteUuid(value);
}

function validOutboxPointer(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    canonicalUuid(value.work_item_id) !== null &&
    typeof value.work_state === "string" &&
    OUTBOX_STATES.has(value.work_state) &&
    typeof value.business_key_sha256 === "string" &&
    SHA256_PATTERN.test(value.business_key_sha256)
  );
}

function mutationResult(
  operation: PlatformMessagingOperation,
  status: PlatformMessagingMutationResult["status"],
  workflow: PlatformConversationWorkflow | null = null,
): PlatformMessagingMutationResult {
  return {
    operation,
    status,
    workflow,
    retryable: status === "unavailable" || status === "persisted_not_staged",
  };
}

function invalid(
  operation: PlatformMessagingOperation,
): PlatformMessagingMutationResult {
  return mutationResult(operation, "invalid");
}

function unavailable(
  operation: PlatformMessagingOperation,
): PlatformMessagingMutationResult {
  return mutationResult(operation, "unavailable");
}

function isInputError(error: unknown): boolean {
  return isRecord(error) && error.code === "22023";
}

function revalidateMessagingPaths(conversationId: string): void {
  revalidatePath("/whatsapp");
  revalidatePath(`/whatsapp/${conversationId}`);
}

async function completed(
  operation: PlatformMessagingOperation,
  actor: Awaited<ReturnType<typeof requirePlatformMessagingActor>>,
  conversationId: string,
): Promise<PlatformMessagingMutationResult> {
  try {
    revalidateMessagingPaths(conversationId);
  } catch {
    // Persistence has already committed. A cache invalidation failure must not
    // misreport the durable mutation as failed.
  }

  try {
    const workflow = await getPlatformConversationWorkflow(
      actor,
      conversationId,
    );
    return mutationResult(operation, "completed", workflow);
  } catch {
    return mutationResult(operation, "completed");
  }
}

function normalizeLanguage(value: unknown): PlatformAiDraftLanguage | null {
  return value === "ru" || value === "en" ? value : null;
}

function normalizeDecision(
  value: unknown,
): PlatformAiDraftReviewDecision | null {
  return value === "approved" || value === "rework" || value === "handoff"
    ? value
    : null;
}

function textSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateAiDraftRequestResult(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    conversationId: string;
    sourceMessageId: string;
    knowledgeVersionId: string;
    requestedLanguage: PlatformAiDraftLanguage | null;
  }>,
): boolean {
  if (!validOutboxPointer(value)) return false;
  return (
    canonicalUuid(value.organization_id) === expected.organizationId &&
    canonicalUuid(value.communication_conversation_id) ===
      expected.conversationId &&
    canonicalUuid(value.source_message_id) === expected.sourceMessageId &&
    canonicalUuid(value.selected_knowledge_version_id) ===
      expected.knowledgeVersionId &&
    canonicalUuid(value.ai_draft_request_id) !== null &&
    value.requested_language === expected.requestedLanguage &&
    value.ai_readiness === "ready" &&
    value.ai_readiness_evidence_kind === "provider_observed" &&
    value.ai_readiness_fresh === true
  );
}

function validateReviewResult(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    membershipId: string;
    aiDraftId: string;
    decision: PlatformAiDraftReviewDecision;
    reviewedText: string | null;
  }>,
): boolean {
  if (!isRecord(value)) return false;
  const expectedState =
    expected.decision === "approved"
      ? "ready_for_manual_send"
      : expected.decision === "rework"
        ? "rework_requested"
        : "handed_off";
  const expectedHash =
    expected.reviewedText === null ? null : textSha256(expected.reviewedText);

  return (
    canonicalUuid(value.organization_id) === expected.organizationId &&
    canonicalUuid(value.ai_draft_id) === expected.aiDraftId &&
    canonicalUuid(value.reviewed_by_membership_id) === expected.membershipId &&
    value.review_decision === expected.decision &&
    value.state === expectedState &&
    value.reviewed_text_sha256 === expectedHash
  );
}

function validateManualSendResult(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    conversationId: string;
    membershipId: string;
    sourceMessageId: string;
    aiDraftId: string | null;
    businessKeySha256: string;
  }>,
): boolean {
  if (!validOutboxPointer(value)) return false;
  const actualAiDraftId =
    value.ai_draft_id === null ? null : canonicalUuid(value.ai_draft_id);
  return (
    (value.ai_draft_id === null || actualAiDraftId !== null) &&
    canonicalUuid(value.organization_id) === expected.organizationId &&
    canonicalUuid(value.communication_conversation_id) ===
      expected.conversationId &&
    canonicalUuid(value.source_message_id) === expected.sourceMessageId &&
    actualAiDraftId === expected.aiDraftId &&
    canonicalUuid(value.manual_send_authorization_id) !== null &&
    canonicalUuid(value.authorized_by_membership_id) ===
      expected.membershipId &&
    value.state === "manual_send_authorized" &&
    value.business_key_sha256 === expected.businessKeySha256 &&
    value.waha_readiness === "ready" &&
    value.waha_readiness_evidence_kind === "provider_observed" &&
    value.waha_readiness_fresh === true
  );
}

export async function requestPlatformAiDraftAction(
  input: RequestPlatformAiDraftInput,
): Promise<PlatformMessagingMutationResult> {
  const operation = "request_ai_draft";
  const actor = await requirePlatformMessagingActor();
  if (!isRecord(input)) return invalid(operation);

  const organizationId = canonicalUuid(actor.organizationId);
  const membershipId = canonicalUuid(actor.membershipId);
  const conversationId = canonicalUuid(input.conversationId);
  const sourceMessageId = canonicalUuid(input.sourceMessageId);
  const knowledgeVersionId = canonicalUuid(input.knowledgeVersionId);
  const requestedLanguage =
    input.requestedLanguage === null
      ? null
      : normalizeLanguage(input.requestedLanguage);
  const reason = normalizePlatformMutationReason(input.reason);
  if (
    organizationId === null ||
    membershipId === null ||
    conversationId === null ||
    sourceMessageId === null ||
    knowledgeVersionId === null ||
    (input.requestedLanguage !== null && requestedLanguage === null) ||
    reason === null
  ) {
    return invalid(operation);
  }

  let workflow: PlatformConversationWorkflow | null;
  try {
    workflow = await getPlatformConversationWorkflow(actor, conversationId);
  } catch {
    return unavailable(operation);
  }
  // Mutable state is deliberately left to the atomic RPC. That RPC replays a
  // committed request ID before it rechecks latest-inbound state, so a
  // lost-response retry must not be rejected by stale local preflight here.
  if (workflow === null) {
    return invalid(operation);
  }

  const requestId = derivePlatformSemanticRequestId(
    operation,
    organizationId,
    [
      membershipId,
      conversationId,
      sourceMessageId,
      knowledgeVersionId,
      requestedLanguage ?? "auto",
      reason,
    ],
  );

  try {
    const client = await createSupabaseServerClient();
    const response = await client
      .schema("platform")
      .rpc("request_ai_draft_with_knowledge", {
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
        p_source_message_id: sourceMessageId,
        p_requested_language: requestedLanguage,
        p_selected_knowledge_version_id: knowledgeVersionId,
        p_reason: reason,
        p_request_id: requestId,
      });

    if (response.error) {
      return isInputError(response.error)
        ? invalid(operation)
        : unavailable(operation);
    }
    if (
      !validateAiDraftRequestResult(response.data, {
        organizationId,
        conversationId,
        sourceMessageId,
        knowledgeVersionId,
        requestedLanguage,
      })
    ) {
      return unavailable(operation);
    }

    return completed(operation, actor, conversationId);
  } catch (error) {
    if (error instanceof PlatformMessagingWorkflowError) {
      return unavailable(operation);
    }
    return unavailable(operation);
  }
}

export async function reviewPlatformAiDraftAction(
  input: ReviewPlatformAiDraftInput,
): Promise<PlatformMessagingMutationResult> {
  const operation = "review_ai_draft";
  const actor = await requirePlatformMessagingActor();
  if (!isRecord(input)) return invalid(operation);

  const organizationId = canonicalUuid(actor.organizationId);
  const membershipId = canonicalUuid(actor.membershipId);
  const conversationId = canonicalUuid(input.conversationId);
  const aiDraftId = canonicalUuid(input.aiDraftId);
  const decision = normalizeDecision(input.decision);
  const reason = normalizePlatformMutationReason(input.reason);
  const reviewedText =
    decision === "approved"
      ? normalizePlatformMessageText(input.reviewedText)
      : null;
  if (
    organizationId === null ||
    membershipId === null ||
    conversationId === null ||
    aiDraftId === null ||
    decision === null ||
    reason === null ||
    (decision === "approved" && reviewedText === null) ||
    (decision !== "approved" &&
      input.reviewedText !== undefined &&
      input.reviewedText !== null)
  ) {
    return invalid(operation);
  }

  let workflow: PlatformConversationWorkflow | null;
  try {
    workflow = await getPlatformConversationWorkflow(actor, conversationId);
  } catch {
    return unavailable(operation);
  }
  // Keep the identity check, but let the idempotent RPC decide whether this is
  // a first review or an exact replay after the state already advanced.
  if (workflow === null || workflow.draft?.aiDraftId !== aiDraftId) {
    return invalid(operation);
  }

  const requestId = derivePlatformSemanticRequestId(
    operation,
    organizationId,
    [
      membershipId,
      conversationId,
      aiDraftId,
      decision,
      reviewedText ?? "",
      reason,
    ],
  );

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("review_ai_draft", {
      p_organization_id: organizationId,
      p_ai_draft_id: aiDraftId,
      p_decision: decision,
      p_reviewed_text: reviewedText,
      p_reason: reason,
      p_request_id: requestId,
    });

    if (response.error) {
      return isInputError(response.error)
        ? invalid(operation)
        : unavailable(operation);
    }
    if (
      !validateReviewResult(response.data, {
        organizationId,
        membershipId,
        aiDraftId,
        decision,
        reviewedText,
      })
    ) {
      return unavailable(operation);
    }

    return completed(operation, actor, conversationId);
  } catch {
    return unavailable(operation);
  }
}

export async function authorizePlatformManualSendAction(
  input: AuthorizePlatformManualSendInput,
): Promise<PlatformMessagingMutationResult> {
  const operation = "authorize_manual_send";
  const actor = await requirePlatformMessagingActor();
  if (!isRecord(input)) return invalid(operation);

  const organizationId = canonicalUuid(actor.organizationId);
  const membershipId = canonicalUuid(actor.membershipId);
  const conversationId = canonicalUuid(input.conversationId);
  const sourceMessageId = canonicalUuid(input.sourceMessageId);
  const aiDraftId =
    input.aiDraftId === null ? null : canonicalUuid(input.aiDraftId);
  const finalText = normalizePlatformMessageText(input.finalText);
  const reason = normalizePlatformMutationReason(input.reason);
  if (
    organizationId === null ||
    membershipId === null ||
    conversationId === null ||
    sourceMessageId === null ||
    (input.aiDraftId !== null && aiDraftId === null) ||
    finalText === null ||
    reason === null
  ) {
    return invalid(operation);
  }

  let workflow: PlatformConversationWorkflow | null;
  try {
    workflow = await getPlatformConversationWorkflow(actor, conversationId);
  } catch {
    return unavailable(operation);
  }
  // The RPC replays an exact request before checking the advanced draft state;
  // pre-rejecting on that state would break recovery after a lost response.
  if (
    workflow === null ||
    workflow.latestInbound?.id !== sourceMessageId ||
    (aiDraftId !== null && workflow.draft?.aiDraftId !== aiDraftId)
  ) {
    return invalid(operation);
  }

  const businessKeySha256 = derivePlatformBusinessKey([
    "manual_whatsapp_send",
    organizationId,
    conversationId,
    sourceMessageId,
    aiDraftId ?? "staff-authored",
  ]);
  const requestId = derivePlatformSemanticRequestId(
    operation,
    organizationId,
    [
      membershipId,
      conversationId,
      sourceMessageId,
      aiDraftId ?? "staff-authored",
      finalText,
      reason,
    ],
  );

  try {
    const client = await createSupabaseServerClient();
    const response = await client
      .schema("platform")
      .rpc("request_manual_whatsapp_send_with_authorization", {
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
        p_source_message_id: sourceMessageId,
        p_ai_draft_id: aiDraftId,
        p_final_text: finalText,
        p_reason: reason,
        p_business_key_sha256: businessKeySha256,
        p_request_id: requestId,
      });

    if (response.error) {
      return isInputError(response.error)
        ? invalid(operation)
        : unavailable(operation);
    }
    if (
      !validateManualSendResult(response.data, {
        organizationId,
        conversationId,
        membershipId,
        sourceMessageId,
        aiDraftId,
        businessKeySha256,
      })
    ) {
      return unavailable(operation);
    }

    return completed(operation, actor, conversationId);
  } catch {
    return unavailable(operation);
  }
}
