import "server-only";

import { exactActionStringFields } from "./action-form-fields.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REVIEW_FIELDS = [
  "conversation_id",
  "proposal_id",
  "decision",
  "reviewed_text",
  "review_reason",
  "review_request_id",
] as const;

export type CanonicalGeminiReviewForm = Readonly<
  {
    conversationId: string;
    proposalId: string;
    requestId: string;
  } & (
    | { decision: "accepted" }
    | { decision: "edited"; reviewedText: string }
    | { decision: "rejected"; reviewReason: string }
  )
>;

function normalizedUuid(value: string | undefined): string | null {
  if (value === undefined || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

/**
 * Parses the exact browser form contract before any review command runs.
 * Unknown, duplicate, missing, or decision-incompatible fields fail closed.
 */
export function parseCanonicalGeminiReviewForm(
  form: FormData,
): CanonicalGeminiReviewForm | null {
  const fields = exactActionStringFields(form, REVIEW_FIELDS);
  if (fields === null) return null;

  const conversationId = normalizedUuid(fields.get("conversation_id"));
  const proposalId = normalizedUuid(fields.get("proposal_id"));
  const requestId = normalizedUuid(fields.get("review_request_id"));
  const decision = fields.get("decision");
  const reviewedText = fields.get("reviewed_text");
  const reviewReason = fields.get("review_reason");
  if (
    conversationId === null ||
    proposalId === null ||
    requestId === null ||
    reviewedText === undefined ||
    reviewReason === undefined
  ) {
    return null;
  }

  if (
    decision === "accepted" &&
    reviewedText.length === 0 &&
    reviewReason.length === 0
  ) {
    return Object.freeze({ conversationId, proposalId, requestId, decision });
  }
  if (
    decision === "edited" &&
    reviewedText.trim().length > 0 &&
    reviewReason.length === 0
  ) {
    return Object.freeze({
      conversationId,
      proposalId,
      requestId,
      decision,
      reviewedText,
    });
  }
  if (
    decision === "rejected" &&
    reviewedText.length === 0 &&
    reviewReason.trim().length > 0
  ) {
    return Object.freeze({
      conversationId,
      proposalId,
      requestId,
      decision,
      reviewReason,
    });
  }
  return null;
}
