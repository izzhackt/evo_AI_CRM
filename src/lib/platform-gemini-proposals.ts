const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const STAFF_ROW_KEYS = [
  "proposal_request_id",
  "source_message_id",
  "outcome",
  "failure_code",
  "model_ref",
  "schema_version",
  "language",
  "intent",
  "confidence",
  "risk",
  "handoff_required",
  "handoff_reasons",
  "citations",
  "memory_changes",
  "qualification",
  "reply_text",
  "requested_at",
  "completed_at",
  "human_review_required",
  "autonomous_authority",
  "provider_proof_state",
] as const;

const CITATION_KEYS = [
  "knowledge_key",
  "knowledge_version",
  "evidence_ordinal",
] as const;
const MEMORY_CHANGE_KEYS = ["fact_key", "action", "value", "confidence"] as const;
const QUALIFICATION_KEYS = [
  "status",
  "completeness",
  "missing_fact_keys",
  "notes",
] as const;

export const PLATFORM_GEMINI_PROPOSAL_MODEL = "gemini-3.5-flash" as const;
export const PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION = 1 as const;

export const PLATFORM_GEMINI_PROPOSAL_INTENTS = [
  "greeting",
  "admissions_discovery",
  "program_or_country",
  "documents",
  "deadline",
  "pricing_or_payment",
  "visa",
  "scholarship",
  "complaint",
  "opt_out",
  "other",
] as const;
export type PlatformGeminiProposalIntent =
  (typeof PLATFORM_GEMINI_PROPOSAL_INTENTS)[number];

export const PLATFORM_GEMINI_PROPOSAL_RISKS = ["low", "medium", "high"] as const;
export type PlatformGeminiProposalRisk =
  (typeof PLATFORM_GEMINI_PROPOSAL_RISKS)[number];

export const PLATFORM_GEMINI_HANDOFF_REASONS = [
  "unsupported_language",
  "missing_evidence",
  "low_confidence",
  "complaint_or_anger",
  "payment_or_refund_or_price_exception",
  "legal_or_privacy",
  "guarantee_request",
  "opt_out",
  "unsafe_content",
  "ambiguous_request",
  "staff_takeover",
  "media_only",
] as const;
export type PlatformGeminiHandoffReason =
  (typeof PLATFORM_GEMINI_HANDOFF_REASONS)[number];

export const PLATFORM_GEMINI_FAILURE_CODES = [
  "configuration_missing",
  "provider_timeout",
  "provider_rate_limited",
  "provider_authentication_failed",
  "provider_unavailable",
  "provider_rejected",
  "provider_error",
  "empty_response",
  "output_truncated",
  "malformed_response",
  "unsupported_language",
  "invalid_proposal",
  "missing_evidence",
  "unsafe_semantics",
] as const;
export type PlatformGeminiFailureCode =
  (typeof PLATFORM_GEMINI_FAILURE_CODES)[number];

export const PLATFORM_GEMINI_PROPOSAL_FACT_KEYS = [
  "age",
  "english_level",
  "current_education",
  "countries_considered",
  "preferred_country",
  "preferred_program",
  "budget_signal",
  "intake_target",
  "preferred_language",
  "urgency",
  "blockers",
  "promised_follow_up",
  "unanswered_questions",
] as const;
export type PlatformGeminiProposalFactKey =
  (typeof PLATFORM_GEMINI_PROPOSAL_FACT_KEYS)[number];

export const PLATFORM_GEMINI_PROPOSAL_QUALIFICATION_STATES = [
  "collecting",
  "ready_for_staff_review",
  "not_a_fit",
] as const;
export type PlatformGeminiProposalQualificationState =
  (typeof PLATFORM_GEMINI_PROPOSAL_QUALIFICATION_STATES)[number];

export type PlatformGeminiProposalCitation = Readonly<{
  knowledgeKey: string;
  knowledgeVersion: number;
  evidenceOrdinal: number;
}>;

export type PlatformGeminiProposalMemoryChange = Readonly<{
  factKey: PlatformGeminiProposalFactKey;
  action: "set" | "clear";
  value: string | null;
  confidence: number;
}>;

export type PlatformGeminiProposalQualification = Readonly<{
  status: PlatformGeminiProposalQualificationState;
  completeness: number;
  missingFactKeys: readonly PlatformGeminiProposalFactKey[];
  notes: string | null;
}>;

type SharedProposal = Readonly<{
  requestId: string;
  sourceMessageId: string;
  modelRef: typeof PLATFORM_GEMINI_PROPOSAL_MODEL;
  schemaVersion: typeof PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION;
  requestedAt: string;
  humanReviewRequired: true;
  autonomousAuthority: false;
  providerProofState: "blocked";
}>;

export type PlatformGeminiProposal = SharedProposal &
  (
    | Readonly<{
        outcome: "pending";
        completedAt: null;
      }>
    | Readonly<{
        outcome: "human_review";
        failureCode: PlatformGeminiFailureCode;
        completedAt: string;
      }>
    | Readonly<{
        outcome: "proposal_ready";
        failureCode: null;
        language: "ru" | "en";
        intent: PlatformGeminiProposalIntent;
        confidence: number;
        risk: PlatformGeminiProposalRisk;
        handoffRequired: boolean;
        handoffReasons: readonly PlatformGeminiHandoffReason[];
        citations: readonly PlatformGeminiProposalCitation[];
        memoryChanges: readonly PlatformGeminiProposalMemoryChange[];
        qualification: PlatformGeminiProposalQualification;
        replyText: string;
        completedAt: string;
      }>
  );

export class PlatformGeminiProposalContractError extends Error {
  constructor() {
    super("Platform Gemini proposal contract is invalid.");
    this.name = "PlatformGeminiProposalContractError";
  }
}

function invalidShape(): never {
  throw new PlatformGeminiProposalContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalidShape();
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) invalidShape();
  return normalized;
}

function parseTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    invalidShape();
  }
  return value;
}

function parseInteger(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalidShape();
  }
  return value;
}

function parseText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > maximum
  ) {
    invalidShape();
  }
  return value;
}

function parseOptionalText(value: unknown, maximum: number): string | null {
  return value === null ? null : parseText(value, maximum);
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalidShape();
  return value as T;
}

function parseUniqueEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  maximum: number,
): readonly T[] {
  if (!Array.isArray(value) || value.length > maximum) invalidShape();
  const parsed = value.map((item) => parseEnum(item, allowed));
  if (new Set(parsed).size !== parsed.length) invalidShape();
  return parsed;
}

function parseCitations(value: unknown): readonly PlatformGeminiProposalCitation[] {
  if (!Array.isArray(value) || value.length > 6) invalidShape();
  const parsed = value.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, CITATION_KEYS)) invalidShape();
    const knowledgeKey = parseText(item.knowledge_key, 160);
    if (!/^[a-z][a-z0-9_.-]*$/.test(knowledgeKey)) invalidShape();
    return {
      knowledgeKey,
      knowledgeVersion: parseInteger(item.knowledge_version, 1, 2_147_483_647),
      evidenceOrdinal: parseInteger(item.evidence_ordinal, 1, 10),
    } satisfies PlatformGeminiProposalCitation;
  });
  const keys = parsed.map(
    (item) => `${item.knowledgeKey}:${item.knowledgeVersion}:${item.evidenceOrdinal}`,
  );
  if (new Set(keys).size !== keys.length) invalidShape();
  return parsed;
}

function parseMemoryChanges(
  value: unknown,
): readonly PlatformGeminiProposalMemoryChange[] {
  if (
    !Array.isArray(value) ||
    value.length > PLATFORM_GEMINI_PROPOSAL_FACT_KEYS.length
  ) invalidShape();
  const parsed = value.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, MEMORY_CHANGE_KEYS)) invalidShape();
    const action = parseEnum(item.action, ["set", "clear"] as const);
    const parsedValue = parseOptionalText(item.value, 500);
    if ((action === "clear" && parsedValue !== null) || (action === "set" && parsedValue === null)) {
      invalidShape();
    }
    return {
      factKey: parseEnum(item.fact_key, PLATFORM_GEMINI_PROPOSAL_FACT_KEYS),
      action,
      value: parsedValue,
      confidence: parseInteger(item.confidence, 0, 100),
    } satisfies PlatformGeminiProposalMemoryChange;
  });
  if (new Set(parsed.map((item) => item.factKey)).size !== parsed.length) {
    invalidShape();
  }
  return parsed;
}

function parseQualification(value: unknown): PlatformGeminiProposalQualification {
  if (!isRecord(value) || !hasExactKeys(value, QUALIFICATION_KEYS)) invalidShape();
  return {
    status: parseEnum(
      value.status,
      PLATFORM_GEMINI_PROPOSAL_QUALIFICATION_STATES,
    ),
    completeness: parseInteger(value.completeness, 0, 100),
    missingFactKeys: parseUniqueEnumArray(
      value.missing_fact_keys,
      PLATFORM_GEMINI_PROPOSAL_FACT_KEYS,
      9,
    ),
    notes: parseOptionalText(value.notes, 1_000),
  };
}

function requireNullResultFields(value: Record<string, unknown>) {
  for (const key of [
    "language",
    "intent",
    "confidence",
    "risk",
    "handoff_required",
    "handoff_reasons",
    "citations",
    "memory_changes",
    "qualification",
    "reply_text",
  ]) {
    if (value[key] !== null) invalidShape();
  }
}

export function normalizePlatformGeminiProposal(
  value: unknown,
): PlatformGeminiProposal {
  if (!isRecord(value) || !hasExactKeys(value, STAFF_ROW_KEYS)) invalidShape();
  if (
    value.model_ref !== PLATFORM_GEMINI_PROPOSAL_MODEL ||
    value.schema_version !== PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION ||
    value.human_review_required !== true ||
    value.autonomous_authority !== false ||
    value.provider_proof_state !== "blocked"
  ) {
    invalidShape();
  }

  const shared = {
    requestId: parseUuid(value.proposal_request_id),
    sourceMessageId: parseUuid(value.source_message_id),
    modelRef: PLATFORM_GEMINI_PROPOSAL_MODEL,
    schemaVersion: PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION,
    requestedAt: parseTimestamp(value.requested_at),
    humanReviewRequired: true,
    autonomousAuthority: false,
    providerProofState: "blocked",
  } satisfies SharedProposal;

  if (value.outcome === null) {
    if (value.failure_code !== null || value.completed_at !== null) invalidShape();
    requireNullResultFields(value);
    return { ...shared, outcome: "pending", completedAt: null };
  }

  const outcome = parseEnum(value.outcome, ["proposal_ready", "human_review"] as const);
  const completedAt = parseTimestamp(value.completed_at);

  if (outcome === "human_review") {
    requireNullResultFields(value);
    return {
      ...shared,
      outcome,
      failureCode: parseEnum(value.failure_code, PLATFORM_GEMINI_FAILURE_CODES),
      completedAt,
    };
  }

  if (value.failure_code !== null) invalidShape();
  const handoffRequired = value.handoff_required;
  if (typeof handoffRequired !== "boolean") invalidShape();
  const handoffReasons = parseUniqueEnumArray(
    value.handoff_reasons,
    PLATFORM_GEMINI_HANDOFF_REASONS,
    8,
  );
  if (!handoffRequired && handoffReasons.length !== 0) invalidShape();

  return {
    ...shared,
    outcome,
    failureCode: null,
    language: parseEnum(value.language, ["ru", "en"] as const),
    intent: parseEnum(value.intent, PLATFORM_GEMINI_PROPOSAL_INTENTS),
    confidence: parseInteger(value.confidence, 0, 100),
    risk: parseEnum(value.risk, PLATFORM_GEMINI_PROPOSAL_RISKS),
    handoffRequired,
    handoffReasons,
    citations: parseCitations(value.citations),
    memoryChanges: parseMemoryChanges(value.memory_changes),
    qualification: parseQualification(value.qualification),
    replyText: parseText(value.reply_text, 2_000),
    completedAt,
  };
}

export function buildPlatformGeminiStaffReadRpcArgs(input: {
  organizationId: string;
  conversationId: string;
}) {
  return {
    p_organization_id: parseUuid(input.organizationId),
    p_conversation_id: parseUuid(input.conversationId),
  };
}
