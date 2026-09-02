"use server";

import { createHash, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  parsePlatformGeminiRequestForm,
  parsePlatformGeminiReviewForm,
  parsePlatformWhatsAppReconcileForm,
  parsePlatformWhatsAppSendForm,
} from "./platform-provider-action-contract";
import {
  readStaffGeminiProposal,
  requestGeminiProposal,
  requestManualWhatsAppSendWithAuthorization,
  reviewGeminiProposal,
  type PlatformGeminiFailureCode,
  type PlatformGeminiProposalV2,
  type PlatformGeminiReviewDecision,
} from "./platform-provider-workflows";
import {
  requirePlatformMessagingActor,
  requirePlatformMessagingSendActor,
} from "./platform-guards";
import { createPlatformGeminiProvider } from "./server/platform-gemini-provider";
import {
  executePlatformGeminiProposal,
  executePlatformManualWhatsAppReconciliation,
  executePlatformManualWhatsAppSend,
} from "./server/platform-provider-orchestrator";
import { getPlatformSupabaseBackendConfig } from "./server/platform-supabase-backend-config";
import { createPlatformSupabaseServiceClient } from "./server/platform-supabase-service-client";
import { createSupabaseServerClient } from "./supabase/server";

const GEMINI_API_KEY_PATTERN = /^[A-Za-z0-9_-]{16,4096}$/;
const MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS = 120;
const MANUAL_SEND_WORKER_REF = "next-app-manual-send";

export type PlatformGeminiRequestActionState = Readonly<{
  status:
    | "idle"
    | "proposal_ready"
    | "human_review"
    | "in_progress"
    | "blocked"
    | "invalid"
    | "unavailable";
  failureCode: PlatformGeminiFailureCode | "configuration_missing" | null;
}>;

export type PlatformGeminiReviewActionState = Readonly<{
  status: "idle" | "reviewed" | "invalid" | "unavailable";
  decision: PlatformGeminiReviewDecision | null;
}>;

export type PlatformWhatsAppSendActionState = Readonly<{
  status:
    | "idle"
    | "succeeded"
    | "unknown_result"
    | "terminal_error"
    | "not_claimed"
    | "invalid"
    | "unavailable";
}>;

export type PlatformWhatsAppReconcileActionState = Readonly<{
  status:
    | "idle"
    | "reconciled"
    | "still_unknown"
    | "already_completed"
    | "readback_failed"
    | "invalid"
    | "unavailable";
}>;

function revalidateConversationPath(conversationId: string): void {
  try {
    revalidatePath(`/whatsapp/${conversationId}`);
  } catch {
    // The provider result is already durable. A cache failure must not make a
    // safely idempotent action look as though it can be repeated.
  }
}

function readGeminiApiKey(): string | null {
  const geminiApiKey = process.env.EVO_PLATFORM_GEMINI_API_KEY;
  return geminiApiKey && GEMINI_API_KEY_PATTERN.test(geminiApiKey)
    ? geminiApiKey
    : null;
}

function createServiceClient() {
  return createPlatformSupabaseServiceClient(
    getPlatformSupabaseBackendConfig(),
  );
}

function manualSendBusinessKey(
  organizationId: string,
  conversationId: string,
  sourceMessageId: string,
): string {
  const immutableCycle = JSON.stringify([
    "evo-platform-work-v1",
    "manual_whatsapp_send",
    organizationId,
    conversationId,
    sourceMessageId,
    "staff-authored",
  ]);
  return createHash("sha256").update(immutableCycle, "utf8").digest("hex");
}

export async function requestPlatformGeminiProposalAction(
  _previous: PlatformGeminiRequestActionState,
  form: FormData,
): Promise<PlatformGeminiRequestActionState> {
  const actor = await requirePlatformMessagingActor();
  const input = parsePlatformGeminiRequestForm(form);
  if (input === null) {
    return Object.freeze({ status: "invalid", failureCode: null });
  }

  const geminiApiKey = readGeminiApiKey();
  if (geminiApiKey === null) {
    return Object.freeze({
      status: "blocked",
      failureCode: "configuration_missing",
    });
  }

  try {
    const staffClient = await createSupabaseServerClient();
    const serviceClient = createServiceClient();
    const geminiProvider = createPlatformGeminiProvider(geminiApiKey);

    await requestGeminiProposal(staffClient, {
      organizationId: actor.organizationId,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      requestId: input.requestId,
      reason: "staff_requested_advisory_draft",
    });
    const execution = await executePlatformGeminiProposal(
      serviceClient,
      {
        organizationId: actor.organizationId,
        conversationId: input.conversationId,
        sourceMessageId: input.sourceMessageId,
        requestId: input.requestId,
      },
      { geminiProvider },
    );

    revalidateConversationPath(input.conversationId);
    if (execution.status === "in_progress") {
      return Object.freeze({ status: "in_progress", failureCode: null });
    }
    const outcome = execution.status === "finished"
      ? execution.result.outcome
      : execution.outcome;
    const failureCode = execution.status === "finished"
      ? execution.result.failureCode
      : null;
    return Object.freeze({ status: outcome, failureCode });
  } catch {
    return Object.freeze({ status: "unavailable", failureCode: null });
  }
}

function reviewedProposalPayload(
  proposal: PlatformGeminiProposalV2,
  decision: PlatformGeminiReviewDecision,
  editedReplyText: string | null,
): PlatformGeminiProposalV2 | null {
  if (decision === "rejected") return null;
  if (decision === "accepted") return proposal;
  if (editedReplyText === null) return null;
  return Object.freeze({
    ...proposal,
    reply_text: editedReplyText,
  });
}

export async function reviewPlatformGeminiProposalAction(
  _previous: PlatformGeminiReviewActionState,
  form: FormData,
): Promise<PlatformGeminiReviewActionState> {
  const actor = await requirePlatformMessagingActor();
  const input = parsePlatformGeminiReviewForm(form);
  if (input === null) {
    return Object.freeze({ status: "invalid", decision: null });
  }

  try {
    const staffClient = await createSupabaseServerClient();
    const proposal = await readStaffGeminiProposal(staffClient, {
      organizationId: actor.organizationId,
      conversationId: input.conversationId,
    });
    if (
      proposal === null ||
      proposal.proposalRequestId !== input.proposalRequestId ||
      proposal.proposal === null ||
      proposal.outcome !== "proposal_ready"
    ) {
      return Object.freeze({ status: "invalid", decision: input.decision });
    }

    const reviewedPayload = reviewedProposalPayload(
      proposal.proposal,
      input.decision,
      input.editedReplyText,
    );
    if (input.decision !== "rejected" && reviewedPayload === null) {
      return Object.freeze({ status: "invalid", decision: input.decision });
    }
    await reviewGeminiProposal(staffClient, {
      organizationId: actor.organizationId,
      conversationId: input.conversationId,
      proposalRequestId: input.proposalRequestId,
      reviewRequestId: input.reviewRequestId,
      decision: input.decision,
      reviewedPayload,
      reason: input.reason,
    });
    revalidateConversationPath(input.conversationId);
    return Object.freeze({ status: "reviewed", decision: input.decision });
  } catch {
    return Object.freeze({ status: "unavailable", decision: input.decision });
  }
}

export async function sendPlatformWhatsAppMessageAction(
  _previous: PlatformWhatsAppSendActionState,
  form: FormData,
): Promise<PlatformWhatsAppSendActionState> {
  const actor = await requirePlatformMessagingSendActor();
  const input = parsePlatformWhatsAppSendForm(form);
  if (input === null) return Object.freeze({ status: "invalid" });

  try {
    const staffClient = await createSupabaseServerClient();
    const serviceClient = createServiceClient();
    const authorization = await requestManualWhatsAppSendWithAuthorization(
      staffClient,
      {
        organizationId: actor.organizationId,
        conversationId: input.conversationId,
        sourceMessageId: input.sourceMessageId,
        aiDraftId: null,
        finalText: input.messageText,
        reason: "staff_confirmed_manual_send",
        businessKeySha256: manualSendBusinessKey(
          actor.organizationId,
          input.conversationId,
          input.sourceMessageId,
        ),
        requestId: input.requestId,
      },
    );
    const execution = await executePlatformManualWhatsAppSend(
      serviceClient,
      {
        authorization,
        visibilityTimeoutSeconds: MANUAL_SEND_VISIBILITY_TIMEOUT_SECONDS,
        workerRef: MANUAL_SEND_WORKER_REF,
        claimRequestId: randomUUID(),
        completionRequestId: randomUUID(),
      },
    );
    revalidateConversationPath(input.conversationId);
    return Object.freeze({
      status: execution.status === "finished"
        ? execution.result.outcome
        : "not_claimed",
    });
  } catch {
    return Object.freeze({ status: "unavailable" });
  }
}

export async function reconcilePlatformWhatsAppSendAction(
  _previous: PlatformWhatsAppReconcileActionState,
  form: FormData,
): Promise<PlatformWhatsAppReconcileActionState> {
  const actor = await requirePlatformMessagingSendActor();
  const input = parsePlatformWhatsAppReconcileForm(form);
  if (input === null) return Object.freeze({ status: "invalid" });

  try {
    const staffClient = await createSupabaseServerClient();
    const serviceClient = createServiceClient();
    const execution = await executePlatformManualWhatsAppReconciliation(
      staffClient,
      serviceClient,
      {
        organizationId: actor.organizationId,
        conversationId: input.conversationId,
        attemptId: input.attemptId,
        requestId: input.requestId,
        reason: "staff_requested_exact_waha_readback",
        completionRequestId: randomUUID(),
      },
    );
    revalidateConversationPath(input.conversationId);
    if (execution.status === "already_completed") {
      return Object.freeze({ status: "already_completed" });
    }
    if (execution.status === "readback_failed") {
      return Object.freeze({ status: "readback_failed" });
    }
    return Object.freeze({
      status: execution.result.reconciliationRequired
        ? "still_unknown"
        : "reconciled",
    });
  } catch {
    return Object.freeze({ status: "unavailable" });
  }
}
