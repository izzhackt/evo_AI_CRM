"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  buildPlatformGeminiReviewPayload,
  parsePlatformGeminiProposalReviewForm,
  reviewPlatformGeminiProposalWithReconciliation,
} from "./platform-gemini-proposal-reviews";
import { requirePlatformMessagingActor } from "./platform-guards";
import { reviewPlatformGeminiProposal } from "./server/platform-gemini-proposal-reviews-repository";
import { readPlatformGeminiProposal } from "./server/platform-gemini-proposals-repository";

type ReviewMutationOutcome = "saved" | "invalid" | "unavailable";

function reviewRedirect(
  conversationId: string | null,
  outcome: ReviewMutationOutcome,
): never {
  const params = new URLSearchParams({ u9_result: outcome });
  const target = conversationId
    ? `/whatsapp/${conversationId}?${params.toString()}#gemini-review`
    : `/whatsapp?${params.toString()}`;
  redirect(target);
}

export async function reviewPlatformGeminiProposalAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformMessagingActor();
  const input = parsePlatformGeminiProposalReviewForm(form);
  if (!input) reviewRedirect(null, "invalid");

  let proposal;
  try {
    proposal = await readPlatformGeminiProposal(actor, input.conversationId);
  } catch {
    reviewRedirect(input.conversationId, "unavailable");
  }
  if (
    proposal === null ||
    proposal.requestId !== input.proposalRequestId ||
    proposal.outcome !== "proposal_ready" ||
    proposal.schemaVersion !== 2
  ) {
    reviewRedirect(input.conversationId, "invalid");
  }

  let reviewedPayload: Readonly<Record<string, unknown>> | null;
  try {
    reviewedPayload = input.decision === "rejected"
      ? null
      : buildPlatformGeminiReviewPayload(
          proposal,
          input.decision === "edited" ? input.edits : undefined,
        );
  } catch {
    reviewRedirect(input.conversationId, "invalid");
  }

  try {
    const review = await reviewPlatformGeminiProposalWithReconciliation(() =>
      reviewPlatformGeminiProposal(actor, {
        conversationId: input.conversationId,
        proposalRequestId: input.proposalRequestId,
        reviewRequestId: input.reviewRequestId,
        decision: input.decision,
        reviewedPayload,
        reason: input.reason,
      }),
    );
    if (review === null) reviewRedirect(input.conversationId, "unavailable");
  } catch {
    reviewRedirect(input.conversationId, "unavailable");
  }

  try {
    revalidatePath(`/whatsapp/${input.conversationId}`);
    revalidatePath("/whatsapp");
  } catch {
    // The durable review is already committed. Cache invalidation must not
    // turn a successful, idempotent decision into a reported failure.
  }
  reviewRedirect(input.conversationId, "saved");
}
