"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformMessagingActor } from "@/lib/platform-guards";

import { exactActionStringFields } from "./action-form-fields";
import {
  CanonicalCrmRepositoryError,
  reviewCanonicalGeminiProposal,
} from "./canonical-crm-repository";
import { parseCanonicalGeminiReviewForm } from "./canonical-gemini-review-form";
import { requestCanonicalGeminiProposal } from "./canonical-gemini-proposal-service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CanonicalGeminiProposalActionState = Readonly<{
  status: "idle" | "created" | "blocked" | "error" | "invalid";
  reason: string | null;
  proposalId: string | null;
}>;

export type CanonicalGeminiProposalReviewActionState = Readonly<{
  status:
    | "idle"
    | "reviewed"
    | "invalid"
    | "forbidden"
    | "not_available"
    | "already_reviewed"
    | "request_conflict"
    | "error";
  decision: "accepted" | "edited" | "rejected" | null;
  proposalId: string | null;
}>;

const REQUEST_FIELDS = ["conversation_id"] as const;
function normalizedUuid(value: string | undefined): string | null {
  if (value === undefined || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

export async function requestCanonicalGeminiProposalAction(
  _previous: CanonicalGeminiProposalActionState,
  form: FormData,
): Promise<CanonicalGeminiProposalActionState> {
  const actor = await requirePlatformMessagingActor();
  const fields = exactActionStringFields(form, REQUEST_FIELDS);
  const conversationId = normalizedUuid(fields?.get("conversation_id"));
  if (conversationId === null) {
    return Object.freeze({
      status: "invalid",
      reason: "invalid_conversation",
      proposalId: null,
    });
  }

  const result = await requestCanonicalGeminiProposal({
    actorRole: actor.platformRole,
    conversationId,
  });
  if (result.status === "created") {
    revalidatePath(`/whatsapp/${conversationId}`);
    return Object.freeze({
      status: "created",
      reason: null,
      proposalId: result.proposal.proposalId,
    });
  }
  return Object.freeze({
    status: result.status,
    reason: result.reason,
    proposalId: null,
  });
}

function invalidReviewState(): CanonicalGeminiProposalReviewActionState {
  return Object.freeze({
    status: "invalid",
    decision: null,
    proposalId: null,
  });
}

export async function reviewCanonicalGeminiProposalAction(
  _previous: CanonicalGeminiProposalReviewActionState,
  form: FormData,
): Promise<CanonicalGeminiProposalReviewActionState> {
  const actor = await requirePlatformMessagingActor();
  const review = parseCanonicalGeminiReviewForm(form);
  if (review === null) return invalidReviewState();

  const { conversationId, proposalId, requestId, decision } = review;

  try {
    const proposal = await reviewCanonicalGeminiProposal(
      {
        actorRole: actor.platformRole,
        correlationId: requestId,
      },
      {
        conversationId,
        proposalId,
        reviewDecision: decision,
        ...(decision === "edited"
          ? { reviewedText: review.reviewedText }
          : {}),
        ...(decision === "rejected"
          ? { reviewReason: review.reviewReason }
          : {}),
      },
    );
    revalidatePath(`/whatsapp/${conversationId}`);
    return Object.freeze({
      status: "reviewed",
      decision,
      proposalId: proposal.proposalId,
    });
  } catch (error: unknown) {
    if (!(error instanceof CanonicalCrmRepositoryError)) throw error;
    const status = {
      invalid_input: "invalid",
      forbidden: "forbidden",
      not_found: "not_available",
      conflict: "already_reviewed",
      idempotency_conflict: "request_conflict",
      gate_unsatisfied: "invalid",
      unavailable: "error",
    }[error.code] as Exclude<
      CanonicalGeminiProposalReviewActionState["status"],
      "idle" | "reviewed"
    >;
    return Object.freeze({ status, decision, proposalId });
  }
}
