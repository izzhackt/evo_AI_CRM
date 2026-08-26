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
  "summary",
  "next_action",
  "draft_internal_note",
  "missing_document_suggestion",
  "deadline_warning",
  "limitations",
  "uncertainty",
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
const CITATION_CAMEL_KEYS = [
  "knowledgeKey",
  "knowledgeVersion",
  "evidenceOrdinal",
] as const;
const MEMORY_CHANGE_KEYS = ["fact_key", "action", "value", "confidence"] as const;
const MEMORY_CHANGE_CAMEL_KEYS = ["factKey", "action", "value", "confidence"] as const;
const QUALIFICATION_KEYS = [
  "status",
  "completeness",
  "missing_fact_keys",
  "notes",
] as const;
const QUALIFICATION_CAMEL_KEYS = [
  "status",
  "completeness",
  "missingFactKeys",
  "notes",
] as const;

export const PLATFORM_GEMINI_PROPOSAL_MODEL = "gemini-3.5-flash" as const;
export const PLATFORM_GEMINI_PROPOSAL_CURRENT_MODEL = "gemini-3.7-flash" as const;
export const PLATFORM_GEMINI_PROPOSAL_SUPPORTED_MODELS = [
  PLATFORM_GEMINI_PROPOSAL_MODEL,
  PLATFORM_GEMINI_PROPOSAL_CURRENT_MODEL,
] as const;
export type PlatformGeminiProposalModelRef =
  (typeof PLATFORM_GEMINI_PROPOSAL_SUPPORTED_MODELS)[number];
export const PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION = 2 as const;
export const PLATFORM_GEMINI_PROPOSAL_SUPPORTED_SCHEMA_VERSIONS = [
  PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION,
  PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION,
] as const;
export type PlatformGeminiProposalSchemaVersion =
  (typeof PLATFORM_GEMINI_PROPOSAL_SUPPORTED_SCHEMA_VERSIONS)[number];

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
export const PLATFORM_GEMINI_PROPOSAL_UNCERTAINTY = [
  "low",
  "medium",
  "high",
] as const;
export type PlatformGeminiProposalUncertainty =
  (typeof PLATFORM_GEMINI_PROPOSAL_UNCERTAINTY)[number];

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
  "privacy_not_approved",
  "provider_timeout",
  "provider_rate_limited",
  "provider_authentication_failed",
  "provider_forbidden",
  "provider_unavailable",
  "provider_rejected",
  "provider_error",
  "empty_response",
  "output_truncated",
  "malformed_response",
  "malformed_output",
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

export type PlatformGeminiProposalPayloadV2 = Readonly<{
  schemaVersion: PlatformGeminiProposalSchemaVersion;
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
  summary: string | null;
  nextAction: string | null;
  draftInternalNote: string | null;
  missingDocumentSuggestion: string | null;
  deadlineWarning: string | null;
  limitations: readonly string[];
  uncertainty: PlatformGeminiProposalUncertainty | null;
}>;

type SharedProposal = Readonly<{
  requestId: string;
  sourceMessageId: string;
  modelRef: PlatformGeminiProposalModelRef;
  schemaVersion: PlatformGeminiProposalSchemaVersion;
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
        summary: string | null;
        nextAction: string | null;
        draftInternalNote: string | null;
        missingDocumentSuggestion: string | null;
        deadlineWarning: string | null;
        limitations: readonly string[];
        uncertainty: PlatformGeminiProposalUncertainty | null;
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
    if (
      !isRecord(item) ||
      (!hasExactKeys(item, CITATION_KEYS) &&
        !hasExactKeys(item, CITATION_CAMEL_KEYS))
    ) invalidShape();
    const knowledgeKey = parseText(
      payloadValue(item, "knowledge_key", "knowledgeKey"),
      160,
    );
    if (!/^[a-z][a-z0-9_.-]*$/.test(knowledgeKey)) invalidShape();
    return {
      knowledgeKey,
      knowledgeVersion: parseInteger(
        payloadValue(item, "knowledge_version", "knowledgeVersion"),
        1,
        2_147_483_647,
      ),
      evidenceOrdinal: parseInteger(
        payloadValue(item, "evidence_ordinal", "evidenceOrdinal"),
        1,
        10,
      ),
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
    if (
      !isRecord(item) ||
      (!hasExactKeys(item, MEMORY_CHANGE_KEYS) &&
        !hasExactKeys(item, MEMORY_CHANGE_CAMEL_KEYS))
    ) invalidShape();
    const action = parseEnum(item.action, ["set", "clear"] as const);
    const parsedValue = parseOptionalText(item.value, 500);
    if ((action === "clear" && parsedValue !== null) || (action === "set" && parsedValue === null)) {
      invalidShape();
    }
    return {
      factKey: parseEnum(
        payloadValue(item, "fact_key", "factKey"),
        PLATFORM_GEMINI_PROPOSAL_FACT_KEYS,
      ),
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
  if (
    !isRecord(value) ||
    (!hasExactKeys(value, QUALIFICATION_KEYS) &&
      !hasExactKeys(value, QUALIFICATION_CAMEL_KEYS))
  ) invalidShape();
  return {
    status: parseEnum(
      value.status,
      PLATFORM_GEMINI_PROPOSAL_QUALIFICATION_STATES,
    ),
    completeness: parseInteger(value.completeness, 0, 100),
    missingFactKeys: parseUniqueEnumArray(
      payloadValue(value, "missing_fact_keys", "missingFactKeys"),
      PLATFORM_GEMINI_PROPOSAL_FACT_KEYS,
      9,
    ),
    notes: parseOptionalText(value.notes, 1_000),
  };
}

function parsePayloadCitations(
  value: unknown,
  expectedEvidence?: readonly PlatformGeminiProposalCitation[],
): readonly PlatformGeminiProposalCitation[] {
  const citations = parseCitations(value);
  if (!expectedEvidence) return citations;
  const allowed = new Set(
    expectedEvidence.map(
      (item) =>
        `${item.knowledgeKey}:${item.knowledgeVersion}:${item.evidenceOrdinal}`,
    ),
  );
  for (const item of citations) {
    const key = `${item.knowledgeKey}:${item.knowledgeVersion}:${item.evidenceOrdinal}`;
    if (!allowed.has(key)) invalidShape();
  }
  return citations;
}

function payloadValue(
  value: Record<string, unknown>,
  snakeKey: string,
  camelKey: string,
): unknown {
  return snakeKey in value ? value[snakeKey] : value[camelKey];
}

function hasPayloadKeys(
  value: Record<string, unknown>,
  keys: readonly { snake: string; camel: string }[],
): boolean {
  const actual = Object.keys(value).sort();
  const snake = keys.map((key) => key.snake).sort();
  const camel = keys.map((key) => key.camel).sort();
  return (
    (actual.length === snake.length &&
      actual.every((key, index) => key === snake[index])) ||
    (actual.length === camel.length &&
      actual.every((key, index) => key === camel[index]))
  );
}

function parseOptionalUniqueTextArray(
  value: unknown,
  maximum: number,
  textMaximum: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    invalidShape();
  }
  const parsed = value.map((item) => parseText(item, textMaximum));
  if (new Set(parsed).size !== parsed.length) invalidShape();
  return parsed;
}

const V1_PAYLOAD_KEYS = [
  { snake: "schema_version", camel: "schemaVersion" },
  { snake: "language", camel: "language" },
  { snake: "intent", camel: "intent" },
  { snake: "confidence", camel: "confidence" },
  { snake: "risk", camel: "risk" },
  { snake: "handoff_required", camel: "handoffRequired" },
  { snake: "handoff_reasons", camel: "handoffReasons" },
  { snake: "citations", camel: "citations" },
  { snake: "memory_changes", camel: "memoryChanges" },
  { snake: "qualification", camel: "qualification" },
  { snake: "reply_text", camel: "replyText" },
] as const;

const V2_PAYLOAD_KEYS = [
  ...V1_PAYLOAD_KEYS,
  { snake: "summary", camel: "summary" },
  { snake: "next_action", camel: "nextAction" },
  { snake: "draft_internal_note", camel: "draftInternalNote" },
  {
    snake: "missing_document_suggestion",
    camel: "missingDocumentSuggestion",
  },
  { snake: "deadline_warning", camel: "deadlineWarning" },
  { snake: "limitations", camel: "limitations" },
  { snake: "uncertainty", camel: "uncertainty" },
] as const;

export function normalizePlatformGeminiProposalPayload(
  value: unknown,
  expectedEvidence?: readonly PlatformGeminiProposalCitation[],
): PlatformGeminiProposalPayloadV2 {
  if (!isRecord(value)) invalidShape();
  const schemaVersion = parseInteger(
    payloadValue(value, "schema_version", "schemaVersion"),
    1,
    2,
  ) as PlatformGeminiProposalSchemaVersion;
  const keys =
    schemaVersion === PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION
      ? V2_PAYLOAD_KEYS
      : V1_PAYLOAD_KEYS;
  if (!hasPayloadKeys(value, keys)) invalidShape();

  const handoffRequired = payloadValue(
    value,
    "handoff_required",
    "handoffRequired",
  );
  if (typeof handoffRequired !== "boolean") invalidShape();
  const handoffReasons = parseUniqueEnumArray(
    payloadValue(value, "handoff_reasons", "handoffReasons"),
    PLATFORM_GEMINI_HANDOFF_REASONS,
    8,
  );
  if ((!handoffRequired && handoffReasons.length !== 0) ||
    (handoffRequired && handoffReasons.length === 0)) {
    invalidShape();
  }

  return Object.freeze({
    schemaVersion,
    language: parseEnum(payloadValue(value, "language", "language"), ["ru", "en"] as const),
    intent: parseEnum(
      payloadValue(value, "intent", "intent"),
      PLATFORM_GEMINI_PROPOSAL_INTENTS,
    ),
    confidence: parseInteger(
      payloadValue(value, "confidence", "confidence"),
      0,
      100,
    ),
    risk: parseEnum(
      payloadValue(value, "risk", "risk"),
      PLATFORM_GEMINI_PROPOSAL_RISKS,
    ),
    handoffRequired,
    handoffReasons,
    citations: parsePayloadCitations(
      payloadValue(value, "citations", "citations"),
      expectedEvidence,
    ),
    memoryChanges: parseMemoryChanges(
      payloadValue(value, "memory_changes", "memoryChanges"),
    ),
    qualification: parseQualification(
      payloadValue(value, "qualification", "qualification"),
    ),
    replyText: parseText(payloadValue(value, "reply_text", "replyText"), 2_000),
    summary:
      schemaVersion === PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION
        ? parseText(payloadValue(value, "summary", "summary"), 2_000)
        : null,
    nextAction:
      schemaVersion === PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION
        ? parseText(payloadValue(value, "next_action", "nextAction"), 1_000)
        : null,
    draftInternalNote:
      schemaVersion === PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION
        ? parseText(
            payloadValue(value, "draft_internal_note", "draftInternalNote"),
            4_000,
          )
        : null,
    missingDocumentSuggestion:
      schemaVersion === PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION
        ? parseOptionalText(
            payloadValue(
              value,
              "missing_document_suggestion",
              "missingDocumentSuggestion",
            ),
            1_000,
          )
        : null,
    deadlineWarning:
      schemaVersion === PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION
        ? parseOptionalText(
            payloadValue(value, "deadline_warning", "deadlineWarning"),
            1_000,
          )
        : null,
    limitations:
      schemaVersion === PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION
        ? parseOptionalUniqueTextArray(
            payloadValue(value, "limitations", "limitations"),
            8,
            500,
          )
        : Object.freeze([]),
    uncertainty:
      schemaVersion === PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION
        ? parseEnum(
            payloadValue(value, "uncertainty", "uncertainty"),
            PLATFORM_GEMINI_PROPOSAL_UNCERTAINTY,
          )
        : null,
  });
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
    "summary",
    "next_action",
    "draft_internal_note",
    "missing_document_suggestion",
    "deadline_warning",
    "limitations",
    "uncertainty",
  ]) {
    if (value[key] !== null) invalidShape();
  }
}

export function normalizePlatformGeminiProposal(
  value: unknown,
): PlatformGeminiProposal {
  if (!isRecord(value) || !hasExactKeys(value, STAFF_ROW_KEYS)) invalidShape();
  const modelRef = parseEnum(
    value.model_ref,
    PLATFORM_GEMINI_PROPOSAL_SUPPORTED_MODELS,
  );
  const schemaVersion = parseInteger(
    value.schema_version,
    1,
    2,
  ) as PlatformGeminiProposalSchemaVersion;
  if (
    (schemaVersion === PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION &&
      modelRef !== PLATFORM_GEMINI_PROPOSAL_MODEL) ||
    (schemaVersion === PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION &&
      modelRef !== PLATFORM_GEMINI_PROPOSAL_CURRENT_MODEL)
  ) {
    invalidShape();
  }
  if (
    value.human_review_required !== true ||
    value.autonomous_authority !== false ||
    value.provider_proof_state !== "blocked"
  ) {
    invalidShape();
  }

  const shared = {
    requestId: parseUuid(value.proposal_request_id),
    sourceMessageId: parseUuid(value.source_message_id),
    modelRef,
    schemaVersion,
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
  const v2Fields = [
    "summary",
    "next_action",
    "draft_internal_note",
    "missing_document_suggestion",
    "deadline_warning",
    "limitations",
    "uncertainty",
  ] as const;
  if (
    schemaVersion === PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION &&
    v2Fields.some((key) => value[key] !== null)
  ) {
    invalidShape();
  }
  const payload = normalizePlatformGeminiProposalPayload({
    schema_version: schemaVersion,
    language: value.language,
    intent: value.intent,
    confidence: value.confidence,
    risk: value.risk,
    handoff_required: value.handoff_required,
    handoff_reasons: value.handoff_reasons,
    citations: value.citations,
    memory_changes: value.memory_changes,
    qualification: value.qualification,
    reply_text: value.reply_text,
    ...(schemaVersion === PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION
      ? {
          summary: value.summary,
          next_action: value.next_action,
          draft_internal_note: value.draft_internal_note,
          missing_document_suggestion: value.missing_document_suggestion,
          deadline_warning: value.deadline_warning,
          limitations: value.limitations,
          uncertainty: value.uncertainty,
        }
      : {}),
  });

  return {
    ...shared,
    outcome,
    failureCode: null,
    language: payload.language,
    intent: payload.intent,
    confidence: payload.confidence,
    risk: payload.risk,
    handoffRequired: payload.handoffRequired,
    handoffReasons: payload.handoffReasons,
    citations: payload.citations,
    memoryChanges: payload.memoryChanges,
    qualification: payload.qualification,
    replyText: payload.replyText,
    summary: payload.summary,
    nextAction: payload.nextAction,
    draftInternalNote: payload.draftInternalNote,
    missingDocumentSuggestion: payload.missingDocumentSuggestion,
    deadlineWarning: payload.deadlineWarning,
    limitations: payload.limitations,
    uncertainty: payload.uncertainty,
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
