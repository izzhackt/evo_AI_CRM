import {
  normalizePlatformGeminiProposalPayload,
  PlatformGeminiProposalContractError,
  type PlatformGeminiProposal,
  type PlatformGeminiProposalPayloadV2,
} from "./platform-gemini-proposals.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const REVIEW_ROW_KEYS = [
  "review_id",
  "proposal_request_id",
  "decision",
  "reviewed_payload",
  "reviewed_payload_sha256",
  "reason",
  "reviewed_by_membership_id",
  "reviewed_by_name",
  "reviewed_at",
] as const;

const REVIEW_MUTATION_ROW_KEYS = [...REVIEW_ROW_KEYS, "replayed"] as const;
const EDITABLE_PAYLOAD_KEYS = [
  "replyText",
  "summary",
  "nextAction",
  "draftInternalNote",
  "missingDocumentSuggestion",
  "deadlineWarning",
  "limitations",
  "uncertainty",
] as const;

export const PLATFORM_GEMINI_PROPOSAL_REVIEW_DECISIONS = [
  "accepted",
  "edited",
  "rejected",
] as const;

export type PlatformGeminiProposalReviewDecision =
  (typeof PLATFORM_GEMINI_PROPOSAL_REVIEW_DECISIONS)[number];

export type PlatformGeminiProposalReview = Readonly<{
  reviewId: string;
  proposalRequestId: string;
  decision: PlatformGeminiProposalReviewDecision;
  reviewedPayload: PlatformGeminiProposalPayloadV2 | null;
  reviewedPayloadSha256: string | null;
  reason: string | null;
  reviewedByMembershipId: string;
  reviewedByName: string;
  reviewedAt: string;
  replayed: boolean;
}>;

export type PlatformGeminiProposalReviewForm = Readonly<{
  conversationId: string;
  proposalRequestId: string;
  reviewRequestId: string;
  decision: PlatformGeminiProposalReviewDecision;
  reason: string | null;
  edits?: Readonly<{
    replyText: string;
    summary: string;
    nextAction: string;
    draftInternalNote: string;
    missingDocumentSuggestion: string | null;
    deadlineWarning: string | null;
    limitations: readonly string[];
    uncertainty: "low" | "medium" | "high";
  }>;
}>;

export async function reviewPlatformGeminiProposalWithReconciliation<T>(
  invoke: () => PromiseLike<T>,
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await invoke();
    } catch {
      // A durable review can commit before its transport response is lost.
      // One exact retry lets the review-request receipt reconcile that state.
    }
  }
  return null;
}

export class PlatformGeminiProposalReviewContractError extends Error {
  constructor() {
    super("Platform Gemini proposal review contract is invalid.");
    this.name = "PlatformGeminiProposalReviewContractError";
  }
}

function invalid(): never {
  throw new PlatformGeminiProposalReviewContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !UUID_PATTERN.test(value) ||
    value.toLowerCase() === NIL_UUID
  ) {
    return invalid();
  }
  return value.toLowerCase();
}

function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > maximum
  ) {
    return invalid();
  }
  return value;
}

function optionalText(value: unknown, maximum: number): string | null {
  return value === null ? null : text(value, maximum);
}

function formText(form: FormData, key: string): string | null {
  const values = form.getAll(key);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  return values[0].trim();
}

function boundedFormText(
  form: FormData,
  key: string,
  minimum: number,
  maximum: number,
): string | null {
  const value = formText(form, key);
  if (
    value === null ||
    value.length < minimum ||
    value.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) return null;
  return value;
}

function optionalBoundedFormText(
  form: FormData,
  key: string,
  maximum: number,
): string | null | undefined {
  const value = formText(form, key);
  if (value === null) return undefined;
  if (value === "") return null;
  if (value.length > maximum || CONTROL_CHARACTER_PATTERN.test(value)) {
    return undefined;
  }
  return value;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalid();
  }
  return value;
}

function decision(value: unknown): PlatformGeminiProposalReviewDecision {
  if (
    typeof value !== "string" ||
    !PLATFORM_GEMINI_PROPOSAL_REVIEW_DECISIONS.includes(
      value as PlatformGeminiProposalReviewDecision,
    )
  ) {
    return invalid();
  }
  return value as PlatformGeminiProposalReviewDecision;
}

function payload(value: unknown): PlatformGeminiProposalPayloadV2 {
  try {
    const normalized = normalizePlatformGeminiProposalPayload(value);
    if (normalized.schemaVersion !== 2) return invalid();
    return normalized;
  } catch (error) {
    if (error instanceof PlatformGeminiProposalContractError) return invalid();
    throw error;
  }
}

export function normalizePlatformGeminiProposalReview(
  value: unknown,
  options: Readonly<{ mutation?: boolean }> = {},
): PlatformGeminiProposalReview {
  if (!isRecord(value)) return invalid();
  const mutation = options.mutation === true;
  if (!hasExactKeys(value, mutation ? REVIEW_MUTATION_ROW_KEYS : REVIEW_ROW_KEYS)) {
    return invalid();
  }

  const parsedDecision = decision(value.decision);
  const parsedReason = optionalText(value.reason, 1_000);
  const replayed = mutation ? value.replayed : false;
  if (typeof replayed !== "boolean") return invalid();

  let reviewedPayload: PlatformGeminiProposalPayloadV2 | null = null;
  let reviewedPayloadSha256: string | null = null;
  if (parsedDecision === "rejected") {
    if (
      value.reviewed_payload !== null ||
      value.reviewed_payload_sha256 !== null ||
      parsedReason === null
    ) {
      return invalid();
    }
  } else {
    reviewedPayload = payload(value.reviewed_payload);
    if (
      typeof value.reviewed_payload_sha256 !== "string" ||
      !SHA256_PATTERN.test(value.reviewed_payload_sha256)
    ) {
      return invalid();
    }
    reviewedPayloadSha256 = value.reviewed_payload_sha256;
  }

  return Object.freeze({
    reviewId: uuid(value.review_id),
    proposalRequestId: uuid(value.proposal_request_id),
    decision: parsedDecision,
    reviewedPayload,
    reviewedPayloadSha256,
    reason: parsedReason,
    reviewedByMembershipId: uuid(value.reviewed_by_membership_id),
    reviewedByName: text(value.reviewed_by_name, 200),
    reviewedAt: timestamp(value.reviewed_at),
    replayed,
  });
}

export function normalizePlatformGeminiProposalReviewHistory(
  value: unknown,
  limit = 20,
): readonly PlatformGeminiProposalReview[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return invalid();
  if (!Array.isArray(value) || value.length > limit) return invalid();

  const reviews = value.map((item) => normalizePlatformGeminiProposalReview(item));
  const reviewIds = new Set<string>();
  const proposalIds = new Set<string>();
  for (let index = 0; index < reviews.length; index += 1) {
    const review = reviews[index];
    if (!review || reviewIds.has(review.reviewId) || proposalIds.has(review.proposalRequestId)) {
      return invalid();
    }
    reviewIds.add(review.reviewId);
    proposalIds.add(review.proposalRequestId);
    const previous = reviews[index - 1];
    if (
      previous &&
      (Date.parse(previous.reviewedAt) < Date.parse(review.reviewedAt) ||
        (previous.reviewedAt === review.reviewedAt &&
          previous.reviewId.localeCompare(review.reviewId) < 0))
    ) {
      return invalid();
    }
  }
  return Object.freeze(reviews);
}

export function serializePlatformGeminiProposalPayload(
  value: unknown,
): Readonly<Record<string, unknown>> {
  const normalized = payload(value);
  return Object.freeze({
    schema_version: normalized.schemaVersion,
    language: normalized.language,
    intent: normalized.intent,
    confidence: normalized.confidence,
    risk: normalized.risk,
    handoff_required: normalized.handoffRequired,
    handoff_reasons: [...normalized.handoffReasons],
    citations: normalized.citations.map((citation) => ({
      knowledge_key: citation.knowledgeKey,
      knowledge_version: citation.knowledgeVersion,
      evidence_ordinal: citation.evidenceOrdinal,
    })),
    memory_changes: normalized.memoryChanges.map((change) => ({
      fact_key: change.factKey,
      action: change.action,
      value: change.value,
      confidence: change.confidence,
    })),
    qualification: {
      status: normalized.qualification.status,
      completeness: normalized.qualification.completeness,
      missing_fact_keys: [...normalized.qualification.missingFactKeys],
      notes: normalized.qualification.notes,
    },
    reply_text: normalized.replyText,
    summary: normalized.summary,
    next_action: normalized.nextAction,
    draft_internal_note: normalized.draftInternalNote,
    missing_document_suggestion: normalized.missingDocumentSuggestion,
    deadline_warning: normalized.deadlineWarning,
    limitations: [...normalized.limitations],
    uncertainty: normalized.uncertainty,
  });
}

export function buildPlatformGeminiReviewPayload(
  proposal: PlatformGeminiProposal,
  edits?: Readonly<{
    replyText: string;
    summary: string;
    nextAction: string;
    draftInternalNote: string;
    missingDocumentSuggestion: string | null;
    deadlineWarning: string | null;
    limitations: readonly string[];
    uncertainty: "low" | "medium" | "high";
  }>,
): Readonly<Record<string, unknown>> {
  if (
    !isRecord(proposal) ||
    proposal.outcome !== "proposal_ready" ||
    proposal.schemaVersion !== 2
  ) {
    return invalid();
  }
  if (edits !== undefined && (!isRecord(edits) || !hasExactKeys(edits, EDITABLE_PAYLOAD_KEYS))) {
    return invalid();
  }

  return serializePlatformGeminiProposalPayload({
    schemaVersion: proposal.schemaVersion,
    language: proposal.language,
    intent: proposal.intent,
    confidence: proposal.confidence,
    risk: proposal.risk,
    handoffRequired: proposal.handoffRequired,
    handoffReasons: proposal.handoffReasons,
    citations: proposal.citations,
    memoryChanges: proposal.memoryChanges,
    qualification: proposal.qualification,
    replyText: edits?.replyText ?? proposal.replyText,
    summary: edits?.summary ?? proposal.summary,
    nextAction: edits?.nextAction ?? proposal.nextAction,
    draftInternalNote: edits?.draftInternalNote ?? proposal.draftInternalNote,
    missingDocumentSuggestion:
      edits === undefined
        ? proposal.missingDocumentSuggestion
        : edits.missingDocumentSuggestion,
    deadlineWarning:
      edits === undefined ? proposal.deadlineWarning : edits.deadlineWarning,
    limitations: edits?.limitations ?? proposal.limitations,
    uncertainty: edits?.uncertainty ?? proposal.uncertainty,
  });
}

export function buildPlatformGeminiReviewReadRpcArgs(input: {
  organizationId: string;
  conversationId: string;
  limit?: number;
}) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return invalid();
  return {
    p_organization_id: uuid(input.organizationId),
    p_conversation_id: uuid(input.conversationId),
    p_limit: limit,
  };
}

export function parsePlatformGeminiProposalReviewForm(
  form: FormData,
): PlatformGeminiProposalReviewForm | null {
  const rawKeys = [...form.keys()].filter((key) => !key.startsWith("$ACTION_"));
  const rawDecision = formText(form, "decision");
  if (rawDecision === null) return null;
  let parsedDecision: PlatformGeminiProposalReviewDecision;
  try {
    parsedDecision = decision(rawDecision);
  } catch {
    return null;
  }

  const baseKeys = [
    "conversation_id",
    "proposal_request_id",
    "review_request_id",
    "decision",
    "reason",
  ];
  const expectedKeys = parsedDecision === "edited"
    ? [
        ...baseKeys,
        "reply_text",
        "summary",
        "next_action",
        "draft_internal_note",
        "missing_document_suggestion",
        "deadline_warning",
        "limitations",
        "uncertainty",
      ]
    : baseKeys;
  if (
    rawKeys.length !== expectedKeys.length ||
    new Set(rawKeys).size !== rawKeys.length ||
    !expectedKeys.every((key) => rawKeys.includes(key))
  ) return null;

  let conversationId: string;
  let proposalRequestId: string;
  let reviewRequestId: string;
  try {
    conversationId = uuid(formText(form, "conversation_id"));
    proposalRequestId = uuid(formText(form, "proposal_request_id"));
    reviewRequestId = uuid(formText(form, "review_request_id"));
  } catch {
    return null;
  }
  const reason = optionalBoundedFormText(form, "reason", 1_000);
  if (reason === undefined || (parsedDecision === "rejected" && reason === null)) {
    return null;
  }

  if (parsedDecision !== "edited") {
    return {
      conversationId,
      proposalRequestId,
      reviewRequestId,
      decision: parsedDecision,
      reason,
      edits: undefined,
    };
  }

  const replyText = boundedFormText(form, "reply_text", 1, 2_000);
  const summary = boundedFormText(form, "summary", 1, 2_000);
  const nextAction = boundedFormText(form, "next_action", 1, 1_000);
  const draftInternalNote = boundedFormText(
    form,
    "draft_internal_note",
    1,
    4_000,
  );
  const missingDocumentSuggestion = optionalBoundedFormText(
    form,
    "missing_document_suggestion",
    1_000,
  );
  const deadlineWarning = optionalBoundedFormText(
    form,
    "deadline_warning",
    1_000,
  );
  const limitationsText = formText(form, "limitations");
  const uncertainty = formText(form, "uncertainty");
  const limitations = limitationsText?.split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    !replyText ||
    !summary ||
    !nextAction ||
    !draftInternalNote ||
    missingDocumentSuggestion === undefined ||
    deadlineWarning === undefined ||
    !limitations ||
    limitations.length < 1 ||
    limitations.length > 8 ||
    new Set(limitations).size !== limitations.length ||
    limitations.some(
      (item) => item.length > 500 || CONTROL_CHARACTER_PATTERN.test(item),
    ) ||
    (uncertainty !== "low" &&
      uncertainty !== "medium" &&
      uncertainty !== "high")
  ) return null;

  return {
    conversationId,
    proposalRequestId,
    reviewRequestId,
    decision: parsedDecision,
    reason,
    edits: {
      replyText,
      summary,
      nextAction,
      draftInternalNote,
      missingDocumentSuggestion,
      deadlineWarning,
      limitations,
      uncertainty,
    },
  };
}

export function buildPlatformGeminiReviewMutationRpcArgs(input: {
  organizationId: string;
  conversationId: string;
  proposalRequestId: string;
  reviewRequestId: string;
  decision: PlatformGeminiProposalReviewDecision;
  reviewedPayload: unknown;
  reason: string | null;
}) {
  const parsedDecision = decision(input.decision);
  const parsedReason = optionalText(input.reason, 1_000);
  let reviewedPayload: Readonly<Record<string, unknown>> | null;
  if (parsedDecision === "rejected") {
    if (input.reviewedPayload !== null || parsedReason === null) return invalid();
    reviewedPayload = null;
  } else {
    reviewedPayload = serializePlatformGeminiProposalPayload(input.reviewedPayload);
  }

  return {
    p_organization_id: uuid(input.organizationId),
    p_conversation_id: uuid(input.conversationId),
    p_proposal_request_id: uuid(input.proposalRequestId),
    p_review_request_id: uuid(input.reviewRequestId),
    p_decision: parsedDecision,
    p_reviewed_payload: reviewedPayload,
    p_reason: parsedReason,
  };
}
