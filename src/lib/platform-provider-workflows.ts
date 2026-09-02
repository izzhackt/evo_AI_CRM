import "server-only";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const KNOWLEDGE_KEY_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/;
const POSITIVE_BIGINT_PATTERN = /^[1-9][0-9]*$/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";

const SAFE_WORKFLOW_ERROR_MESSAGE =
  "Platform provider workflow is unavailable.";

export const PLATFORM_GEMINI_MODEL_REF = "gemini-3.7-flash" as const;
export const PLATFORM_GEMINI_SCHEMA_VERSION = 2 as const;
export const PLATFORM_GEMINI_PROMPT_POLICY_VERSION =
  "u9-gemini-human-review-v1" as const;
export const PLATFORM_WAHA_SESSION_NAME = "crm_primary" as const;
export const PLATFORM_WAHA_BASE_URL = "http://evo-crm-waha:3000" as const;

type PlatformProviderRpcResponse = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type PlatformProviderRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<PlatformProviderRpcResponse>;
  }>;
}>;

export class PlatformProviderWorkflowError extends Error {
  constructor() {
    super(SAFE_WORKFLOW_ERROR_MESSAGE);
    this.name = "PlatformProviderWorkflowError";
  }
}

export type PlatformGeminiProposalOutcome =
  | "proposal_ready"
  | "human_review";

export type PlatformGeminiReviewDecision =
  | "accepted"
  | "edited"
  | "rejected";

export type PlatformGeminiProviderStatus =
  | "in_progress"
  | "requires_action"
  | "completed"
  | "failed"
  | "cancelled"
  | "incomplete"
  | "budget_exceeded"
  | "not_called"
  | "local_error"
  | "configuration_error"
  | "transport_error";

export type PlatformGeminiFailureCode =
  | "configuration_missing"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_authentication_failed"
  | "provider_forbidden"
  | "provider_unavailable"
  | "provider_rejected"
  | "provider_error"
  | "empty_response"
  | "output_truncated"
  | "malformed_response"
  | "malformed_output"
  | "unsupported_language"
  | "invalid_proposal"
  | "missing_evidence"
  | "unsafe_semantics";

export type PlatformGeminiCitation = Readonly<{
  knowledge_key: string;
  knowledge_version: number;
  evidence_ordinal: number;
}>;

export type PlatformGeminiMemoryFactKey =
  | "preferred_country"
  | "preferred_program"
  | "budget_signal"
  | "intake_target"
  | "preferred_language"
  | "urgency"
  | "blockers"
  | "promised_follow_up"
  | "unanswered_questions";

export type PlatformGeminiMemoryChange = Readonly<{
  fact_key: PlatformGeminiMemoryFactKey;
  action: "set" | "clear";
  value: string | null;
  confidence: number;
}>;

export type PlatformGeminiProposalV2 = Readonly<{
  schema_version: typeof PLATFORM_GEMINI_SCHEMA_VERSION;
  language: "ru" | "en";
  intent:
    | "greeting"
    | "admissions_discovery"
    | "program_or_country"
    | "documents"
    | "deadline"
    | "pricing_or_payment"
    | "visa"
    | "scholarship"
    | "complaint"
    | "opt_out"
    | "other";
  confidence: number;
  risk: "low" | "medium" | "high";
  handoff_required: boolean;
  handoff_reasons: readonly string[];
  citations: readonly PlatformGeminiCitation[];
  memory_changes: readonly PlatformGeminiMemoryChange[];
  qualification: Readonly<{
    status: "collecting" | "ready_for_staff_review" | "not_a_fit";
    completeness: number;
    missing_fact_keys: readonly PlatformGeminiMemoryFactKey[];
    notes: string | null;
  }>;
  reply_text: string;
  summary: string;
  next_action: string;
  draft_internal_note: string;
  missing_document_suggestion: string | null;
  deadline_warning: string | null;
  limitations: readonly string[];
  uncertainty: "low" | "medium" | "high";
}>;

export type PlatformGeminiProposalContext = Readonly<{
  conversation: Readonly<{
    conversationId: string;
    studentCaseId: string | null;
    status: "open";
  }>;
  sourceMessage: Readonly<{
    messageId: string;
    direction: "inbound";
    language: "ru" | "en" | "undetermined";
    bodyText: string;
    createdAt: string;
  }>;
  approvedKnowledge: readonly Readonly<{
    sourceRef: Readonly<{
      knowledgeKey: string;
      knowledgeVersion: number;
      evidenceOrdinal: number;
    }>;
    title: string;
    contentText: string;
  }>[];
  allowedCitations: readonly Readonly<{
    knowledgeKey: string;
    knowledgeVersion: number;
    evidenceOrdinal: number;
  }>[];
}>;

export type PlatformGeminiRequestReceipt = Readonly<{
  proposalRequestReceiptId: string;
  requestId: string;
  replayed: boolean;
  completed: boolean;
  outcome: PlatformGeminiProposalOutcome | null;
}>;

export type PlatformGeminiBeginResult = Readonly<{
  proposalRequestId: string;
  replayed: boolean;
  completed: boolean;
  outcome: PlatformGeminiProposalOutcome | null;
  context: PlatformGeminiProposalContext;
}>;

export type PlatformGeminiFinishResult = Readonly<{
  proposalRequestId: string;
  replayed: boolean;
  outcome: PlatformGeminiProposalOutcome;
  failureCode: PlatformGeminiFailureCode | null;
  humanReviewRequired: true;
  autonomousAuthority: false;
  providerProofState: "blocked";
}>;

export type PlatformStaffGeminiProposal = Readonly<{
  proposalRequestId: string;
  sourceMessageId: string;
  outcome: PlatformGeminiProposalOutcome | null;
  failureCode: PlatformGeminiFailureCode | null;
  modelRef: typeof PLATFORM_GEMINI_MODEL_REF;
  schemaVersion: typeof PLATFORM_GEMINI_SCHEMA_VERSION;
  proposal: PlatformGeminiProposalV2 | null;
  requestedAt: string;
  completedAt: string | null;
  humanReviewRequired: true;
  autonomousAuthority: false;
  providerProofState: "blocked";
}>;

export type PlatformGeminiProposalReview = Readonly<{
  reviewId: string;
  proposalRequestId: string;
  decision: PlatformGeminiReviewDecision;
  reviewedPayload: PlatformGeminiProposalV2 | null;
  reviewedPayloadSha256: string | null;
  reason: string | null;
  reviewedByMembershipId: string;
  reviewedByName: string;
  reviewedAt: string;
}>;

export type PlatformGeminiProposalReviewResult =
  PlatformGeminiProposalReview & Readonly<{ replayed: boolean }>;

function unavailable(): never {
  throw new PlatformProviderWorkflowError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    keys.every((key) => expected.includes(key));
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return unavailable();
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? unavailable() : normalized;
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return unavailable();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function requiredTrimmedText(
  value: unknown,
  minLength: number,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < minLength ||
    value.length > maxLength
  ) {
    return unavailable();
  }
  return value;
}

function optionalTrimmedText(
  value: unknown,
  minLength: number,
  maxLength: number,
): string | null {
  return value === null
    ? null
    : requiredTrimmedText(value, minLength, maxLength);
}

function requiredReason(value: unknown): string {
  const reason = requiredTrimmedText(value, 1, 1_000);
  return CONTROL_CHARACTER_PATTERN.test(reason) ? unavailable() : reason;
}

function requiredInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum
    ? value
    : unavailable();
}

function requiredBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : unavailable();
}

function requiredSha256(value: unknown): string {
  return typeof value === "string" && SHA256_PATTERN.test(value)
    ? value
    : unavailable();
}

function requiredPositiveBigint(value: unknown): string {
  const normalized = typeof value === "number"
    ? Number.isSafeInteger(value) && value > 0 ? String(value) : unavailable()
    : value;
  if (
    typeof normalized !== "string" ||
    !POSITIVE_BIGINT_PATTERN.test(normalized) ||
    normalized.length > POSTGRES_BIGINT_MAX.length ||
    (
      normalized.length === POSTGRES_BIGINT_MAX.length &&
      normalized > POSTGRES_BIGINT_MAX
    )
  ) {
    return unavailable();
  }
  return normalized;
}

function requiredSafeIdentifier(value: unknown, maximumLength = 512): string {
  const identifier = requiredTrimmedText(value, 1, maximumLength);
  return CONTROL_CHARACTER_PATTERN.test(identifier) ? unavailable() : identifier;
}

function requiredPrintableProviderId(value: unknown): string {
  const identifier = requiredTrimmedText(value, 1, 512);
  return PRINTABLE_ASCII_PATTERN.test(identifier) ? identifier : unavailable();
}

function requiredErrorCode(value: unknown): string {
  const code = requiredTrimmedText(value, 2, 64);
  return ERROR_CODE_PATTERN.test(code) ? code : unavailable();
}

function optionalErrorCode(value: unknown): string | null {
  return value === null ? null : requiredErrorCode(value);
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : unavailable();
}

function exactOneRow(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return unavailable();
  }
  return value[0];
}

async function callRpc(
  client: PlatformProviderRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
  options?: Readonly<{ get?: boolean }>,
): Promise<unknown> {
  try {
    const response = await client.schema("platform").rpc(
      functionName,
      args,
      options,
    );
    if (
      !isRecord(response) ||
      !("data" in response) ||
      !("error" in response) ||
      response.error !== null
    ) {
      return unavailable();
    }
    return response.data;
  } catch {
    return unavailable();
  }
}

const GEMINI_OUTCOMES = Object.freeze([
  "proposal_ready",
  "human_review",
] as const);
const GEMINI_REVIEW_DECISIONS = Object.freeze([
  "accepted",
  "edited",
  "rejected",
] as const);
const GEMINI_PROVIDER_STATUSES = Object.freeze([
  "in_progress",
  "requires_action",
  "completed",
  "failed",
  "cancelled",
  "incomplete",
  "budget_exceeded",
  "not_called",
  "local_error",
  "configuration_error",
  "transport_error",
] as const);
const GEMINI_FAILURE_CODES = Object.freeze([
  "configuration_missing",
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
] as const);
const MEMORY_FACT_KEYS = Object.freeze([
  "preferred_country",
  "preferred_program",
  "budget_signal",
  "intake_target",
  "preferred_language",
  "urgency",
  "blockers",
  "promised_follow_up",
  "unanswered_questions",
] as const);

function optionalGeminiOutcome(value: unknown): PlatformGeminiProposalOutcome | null {
  return value === null ? null : requiredEnum(value, GEMINI_OUTCOMES);
}

function optionalGeminiFailureCode(value: unknown): PlatformGeminiFailureCode | null {
  return value === null ? null : requiredEnum(value, GEMINI_FAILURE_CODES);
}

function normalizeCitation(value: unknown): PlatformGeminiCitation {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "knowledge_key",
      "knowledge_version",
      "evidence_ordinal",
    ])
  ) {
    return unavailable();
  }
  const knowledgeKey = requiredTrimmedText(value.knowledge_key, 1, 200);
  if (!KNOWLEDGE_KEY_PATTERN.test(knowledgeKey)) return unavailable();
  return Object.freeze({
    knowledge_key: knowledgeKey,
    knowledge_version: requiredInteger(value.knowledge_version, 1, 2_147_483_647),
    evidence_ordinal: requiredInteger(value.evidence_ordinal, 1, 2_147_483_647),
  });
}

function normalizeMemoryChange(value: unknown): PlatformGeminiMemoryChange {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["fact_key", "action", "value", "confidence"])
  ) {
    return unavailable();
  }
  const action = requiredEnum(value.action, ["set", "clear"] as const);
  const normalizedValue = optionalTrimmedText(value.value, 1, 1_000);
  if (
    (action === "set" && normalizedValue === null) ||
    (action === "clear" && normalizedValue !== null)
  ) {
    return unavailable();
  }
  return Object.freeze({
    fact_key: requiredEnum(value.fact_key, MEMORY_FACT_KEYS),
    action,
    value: normalizedValue,
    confidence: requiredInteger(value.confidence, 0, 100),
  });
}

function normalizeStringArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) return unavailable();
  const normalized = value.map((item) =>
    requiredTrimmedText(item, 1, maximumItemLength)
  );
  return new Set(normalized).size === normalized.length
    ? Object.freeze(normalized)
    : unavailable();
}

function normalizeGeminiProposal(value: unknown): PlatformGeminiProposalV2 {
  const keys = [
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
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys)) return unavailable();
  if (!isRecord(value.qualification) || !hasExactKeys(value.qualification, [
    "status",
    "completeness",
    "missing_fact_keys",
    "notes",
  ])) {
    return unavailable();
  }
  if (!Array.isArray(value.citations) || value.citations.length > 20) {
    return unavailable();
  }
  if (!Array.isArray(value.memory_changes) || value.memory_changes.length > 20) {
    return unavailable();
  }
  const handoffRequired = requiredBoolean(value.handoff_required);
  const handoffReasons = normalizeStringArray(value.handoff_reasons, 20, 500);
  if (handoffRequired !== (handoffReasons.length > 0)) return unavailable();
  const missingFactKeys = Array.isArray(value.qualification.missing_fact_keys)
    ? value.qualification.missing_fact_keys.map((item) =>
      requiredEnum(item, MEMORY_FACT_KEYS)
    )
    : unavailable();
  if (new Set(missingFactKeys).size !== missingFactKeys.length) return unavailable();
  return Object.freeze({
    schema_version: value.schema_version === PLATFORM_GEMINI_SCHEMA_VERSION
      ? PLATFORM_GEMINI_SCHEMA_VERSION
      : unavailable(),
    language: requiredEnum(value.language, ["ru", "en"] as const),
    intent: requiredEnum(value.intent, [
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
    ] as const),
    confidence: requiredInteger(value.confidence, 0, 100),
    risk: requiredEnum(value.risk, ["low", "medium", "high"] as const),
    handoff_required: handoffRequired,
    handoff_reasons: handoffReasons,
    citations: Object.freeze(value.citations.map(normalizeCitation)),
    memory_changes: Object.freeze(value.memory_changes.map(normalizeMemoryChange)),
    qualification: Object.freeze({
      status: requiredEnum(value.qualification.status, [
        "collecting",
        "ready_for_staff_review",
        "not_a_fit",
      ] as const),
      completeness: requiredInteger(value.qualification.completeness, 0, 100),
      missing_fact_keys: Object.freeze(missingFactKeys),
      notes: optionalTrimmedText(value.qualification.notes, 1, 2_000),
    }),
    reply_text: requiredTrimmedText(value.reply_text, 1, 4_000),
    summary: requiredTrimmedText(value.summary, 1, 2_000),
    next_action: requiredTrimmedText(value.next_action, 1, 1_000),
    draft_internal_note: requiredTrimmedText(value.draft_internal_note, 1, 4_000),
    missing_document_suggestion: optionalTrimmedText(
      value.missing_document_suggestion,
      1,
      1_000,
    ),
    deadline_warning: optionalTrimmedText(value.deadline_warning, 1, 1_000),
    limitations: normalizeStringArray(value.limitations, 20, 500),
    uncertainty: requiredEnum(value.uncertainty, ["low", "medium", "high"] as const),
  });
}

function normalizeSourceRef(value: unknown) {
  const citation = normalizeCitation(value);
  return Object.freeze({
    knowledgeKey: citation.knowledge_key,
    knowledgeVersion: citation.knowledge_version,
    evidenceOrdinal: citation.evidence_ordinal,
  });
}

function normalizeGeminiContext(value: unknown): PlatformGeminiProposalContext {
  if (!isRecord(value) || !hasExactKeys(value, [
    "conversation",
    "source_message",
    "approved_knowledge",
    "allowed_citations",
  ])) {
    return unavailable();
  }
  if (
    !isRecord(value.conversation) ||
    !hasExactKeys(value.conversation, [
      "conversation_id",
      "student_case_id",
      "status",
    ]) ||
    value.conversation.status !== "open" ||
    !isRecord(value.source_message) ||
    !hasExactKeys(value.source_message, [
      "message_id",
      "direction",
      "language",
      "body_text",
      "created_at",
    ]) ||
    value.source_message.direction !== "inbound" ||
    !Array.isArray(value.approved_knowledge) ||
    value.approved_knowledge.length > 6 ||
    !Array.isArray(value.allowed_citations) ||
    value.allowed_citations.length > 6
  ) {
    return unavailable();
  }
  const allowedCitations = value.allowed_citations.map(normalizeSourceRef);
  const approvedKnowledge = value.approved_knowledge.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, [
      "source_ref",
      "title",
      "content_text",
    ])) {
      return unavailable();
    }
    return Object.freeze({
      sourceRef: normalizeSourceRef(item.source_ref),
      title: requiredTrimmedText(item.title, 1, 500),
      contentText: requiredTrimmedText(item.content_text, 1, 4_000),
    });
  });
  const allowedKeys = new Set(allowedCitations.map((item) =>
    `${item.knowledgeKey}:${item.knowledgeVersion}:${item.evidenceOrdinal}`
  ));
  if (
    approvedKnowledge.some((item) => !allowedKeys.has(
      `${item.sourceRef.knowledgeKey}:${item.sourceRef.knowledgeVersion}:${item.sourceRef.evidenceOrdinal}`,
    )) ||
    allowedKeys.size !== allowedCitations.length ||
    approvedKnowledge.length !== allowedCitations.length
  ) {
    return unavailable();
  }
  return Object.freeze({
    conversation: Object.freeze({
      conversationId: requiredUuid(value.conversation.conversation_id),
      studentCaseId: optionalUuid(value.conversation.student_case_id),
      status: "open" as const,
    }),
    sourceMessage: Object.freeze({
      messageId: requiredUuid(value.source_message.message_id),
      direction: "inbound" as const,
      language: requiredEnum(value.source_message.language, [
        "ru",
        "en",
        "undetermined",
      ] as const),
      bodyText: typeof value.source_message.body_text === "string" &&
          value.source_message.body_text.length <= 4_000
        ? value.source_message.body_text
        : unavailable(),
      createdAt: requiredTimestamp(value.source_message.created_at),
    }),
    approvedKnowledge: Object.freeze(approvedKnowledge),
    allowedCitations: Object.freeze(allowedCitations),
  });
}

function normalizeRequestReceipt(
  value: unknown,
  expectedRequestId: string,
): PlatformGeminiRequestReceipt {
  const row = exactOneRow(value);
  if (!hasExactKeys(row, [
    "proposal_request_receipt_id",
    "request_id",
    "replayed",
    "completed",
    "outcome",
  ])) {
    return unavailable();
  }
  const completed = requiredBoolean(row.completed);
  const outcome = optionalGeminiOutcome(row.outcome);
  if (completed !== (outcome !== null)) return unavailable();
  const requestId = requiredUuid(row.request_id);
  if (requestId !== expectedRequestId) return unavailable();
  return Object.freeze({
    proposalRequestReceiptId: requiredUuid(row.proposal_request_receipt_id),
    requestId,
    replayed: requiredBoolean(row.replayed),
    completed,
    outcome,
  });
}

export async function requestGeminiProposal(
  client: PlatformProviderRpcClient,
  input: Readonly<{
    organizationId: string;
    conversationId: string;
    sourceMessageId: string;
    requestId: string;
    reason: string;
  }>,
): Promise<PlatformGeminiRequestReceipt> {
  const organizationId = requiredUuid(input.organizationId);
  const conversationId = requiredUuid(input.conversationId);
  const sourceMessageId = requiredUuid(input.sourceMessageId);
  const requestId = requiredUuid(input.requestId);
  const data = await callRpc(client, "request_gemini_proposal", {
    p_organization_id: organizationId,
    p_conversation_id: conversationId,
    p_source_message_id: sourceMessageId,
    p_request_id: requestId,
    p_model_ref: PLATFORM_GEMINI_MODEL_REF,
    p_schema_version: PLATFORM_GEMINI_SCHEMA_VERSION,
    p_prompt_policy_version: PLATFORM_GEMINI_PROMPT_POLICY_VERSION,
    p_reason: requiredReason(input.reason),
  });
  return normalizeRequestReceipt(data, requestId);
}

export async function beginGeminiProposal(
  client: PlatformProviderRpcClient,
  input: Readonly<{
    organizationId: string;
    conversationId: string;
    sourceMessageId: string;
    requestId: string;
  }>,
): Promise<PlatformGeminiBeginResult> {
  const organizationId = requiredUuid(input.organizationId);
  const conversationId = requiredUuid(input.conversationId);
  const sourceMessageId = requiredUuid(input.sourceMessageId);
  const requestId = requiredUuid(input.requestId);
  const row = exactOneRow(await callRpc(client, "begin_gemini_proposal", {
    p_organization_id: organizationId,
    p_conversation_id: conversationId,
    p_source_message_id: sourceMessageId,
    p_request_id: requestId,
    p_model_ref: PLATFORM_GEMINI_MODEL_REF,
    p_schema_version: PLATFORM_GEMINI_SCHEMA_VERSION,
    p_prompt_policy_version: PLATFORM_GEMINI_PROMPT_POLICY_VERSION,
  }));
  if (!hasExactKeys(row, [
    "proposal_request_id",
    "replayed",
    "completed",
    "outcome",
    "context",
  ])) {
    return unavailable();
  }
  const completed = requiredBoolean(row.completed);
  const outcome = optionalGeminiOutcome(row.outcome);
  if (completed !== (outcome !== null)) return unavailable();
  const context = normalizeGeminiContext(row.context);
  if (
    context.conversation.conversationId !== conversationId ||
    context.sourceMessage.messageId !== sourceMessageId
  ) {
    return unavailable();
  }
  return Object.freeze({
    proposalRequestId: requiredUuid(row.proposal_request_id),
    replayed: requiredBoolean(row.replayed),
    completed,
    outcome,
    context,
  });
}

function validateFinishGeminiInput(input: Readonly<{
  outcome: PlatformGeminiProposalOutcome;
  failureCode: PlatformGeminiFailureCode | null;
  promptText: string;
  providerInteractionRef: string | null;
  providerStatus: PlatformGeminiProviderStatus;
  responseJson: PlatformGeminiProposalV2 | null;
}>) {
  const outcome = requiredEnum(input.outcome, GEMINI_OUTCOMES);
  const failureCode = optionalGeminiFailureCode(input.failureCode);
  const promptText = requiredTrimmedText(input.promptText, 1, 65_536);
  const providerStatus = requiredEnum(input.providerStatus, GEMINI_PROVIDER_STATUSES);
  const providerInteractionRef = optionalTrimmedText(
    input.providerInteractionRef,
    1,
    255,
  );
  const calledStatuses: readonly PlatformGeminiProviderStatus[] = [
    "in_progress",
    "requires_action",
    "completed",
    "failed",
    "cancelled",
    "incomplete",
    "budget_exceeded",
  ];
  if (calledStatuses.includes(providerStatus) !== (providerInteractionRef !== null)) {
    return unavailable();
  }
  if (
    outcome === "proposal_ready" &&
    (failureCode !== null || providerStatus !== "completed" || input.responseJson === null)
  ) {
    return unavailable();
  }
  if (
    outcome === "human_review" &&
    (failureCode === null || input.responseJson !== null)
  ) {
    return unavailable();
  }
  return Object.freeze({
    outcome,
    failureCode,
    promptText,
    providerInteractionRef,
    providerStatus,
    responseJson: input.responseJson === null
      ? null
      : normalizeGeminiProposal(input.responseJson),
  });
}

export async function finishGeminiProposal(
  client: PlatformProviderRpcClient,
  input: Readonly<{
    organizationId: string;
    conversationId: string;
    sourceMessageId: string;
    proposalRequestId: string;
    outcome: PlatformGeminiProposalOutcome;
    failureCode: PlatformGeminiFailureCode | null;
    promptText: string;
    providerInteractionRef: string | null;
    providerStatus: PlatformGeminiProviderStatus;
    responseJson: PlatformGeminiProposalV2 | null;
  }>,
): Promise<PlatformGeminiFinishResult> {
  const organizationId = requiredUuid(input.organizationId);
  const conversationId = requiredUuid(input.conversationId);
  const sourceMessageId = requiredUuid(input.sourceMessageId);
  const proposalRequestId = requiredUuid(input.proposalRequestId);
  const validated = validateFinishGeminiInput(input);
  const row = exactOneRow(await callRpc(client, "finish_gemini_proposal", {
    p_organization_id: organizationId,
    p_conversation_id: conversationId,
    p_source_message_id: sourceMessageId,
    p_proposal_request_id: proposalRequestId,
    p_outcome: validated.outcome,
    p_failure_code: validated.failureCode,
    p_prompt_text: validated.promptText,
    p_provider_interaction_ref: validated.providerInteractionRef,
    p_provider_status: validated.providerStatus,
    p_response_json: validated.responseJson,
  }));
  if (!hasExactKeys(row, [
    "proposal_request_id",
    "replayed",
    "outcome",
    "failure_code",
    "human_review_required",
    "autonomous_authority",
    "provider_proof_state",
  ])) {
    return unavailable();
  }
  const resultId = requiredUuid(row.proposal_request_id);
  const outcome = requiredEnum(row.outcome, GEMINI_OUTCOMES);
  const failureCode = optionalGeminiFailureCode(row.failure_code);
  if (
    resultId !== proposalRequestId ||
    outcome !== validated.outcome ||
    failureCode !== validated.failureCode ||
    row.human_review_required !== true ||
    row.autonomous_authority !== false ||
    row.provider_proof_state !== "blocked"
  ) {
    return unavailable();
  }
  return Object.freeze({
    proposalRequestId: resultId,
    replayed: requiredBoolean(row.replayed),
    outcome,
    failureCode,
    humanReviewRequired: true as const,
    autonomousAuthority: false as const,
    providerProofState: "blocked" as const,
  });
}

const STAFF_PROPOSAL_KEYS = Object.freeze([
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
]);

const STAFF_PROPOSAL_PAYLOAD_KEYS = Object.freeze([
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
]);

function normalizeStaffGeminiProposal(row: Record<string, unknown>): PlatformStaffGeminiProposal {
  if (!hasExactKeys(row, STAFF_PROPOSAL_KEYS)) return unavailable();
  const outcome = optionalGeminiOutcome(row.outcome);
  const failureCode = optionalGeminiFailureCode(row.failure_code);
  const completedAt = optionalTimestamp(row.completed_at);
  let proposal: PlatformGeminiProposalV2 | null = null;
  if (outcome === "proposal_ready") {
    proposal = normalizeGeminiProposal(Object.fromEntries([
      ["schema_version", row.schema_version],
      ...STAFF_PROPOSAL_PAYLOAD_KEYS.map((key) => [key, row[key]]),
    ]));
    if (failureCode !== null || completedAt === null) return unavailable();
  } else {
    if (STAFF_PROPOSAL_PAYLOAD_KEYS.some((key) => row[key] !== null)) {
      return unavailable();
    }
    if (
      outcome === null && (failureCode !== null || completedAt !== null) ||
      outcome === "human_review" && (failureCode === null || completedAt === null)
    ) {
      return unavailable();
    }
  }
  if (
    row.model_ref !== PLATFORM_GEMINI_MODEL_REF ||
    row.schema_version !== PLATFORM_GEMINI_SCHEMA_VERSION ||
    row.human_review_required !== true ||
    row.autonomous_authority !== false ||
    row.provider_proof_state !== "blocked"
  ) {
    return unavailable();
  }
  return Object.freeze({
    proposalRequestId: requiredUuid(row.proposal_request_id),
    sourceMessageId: requiredUuid(row.source_message_id),
    outcome,
    failureCode,
    modelRef: PLATFORM_GEMINI_MODEL_REF,
    schemaVersion: PLATFORM_GEMINI_SCHEMA_VERSION,
    proposal,
    requestedAt: requiredTimestamp(row.requested_at),
    completedAt,
    humanReviewRequired: true as const,
    autonomousAuthority: false as const,
    providerProofState: "blocked" as const,
  });
}

export async function readStaffGeminiProposal(
  client: PlatformProviderRpcClient,
  input: Readonly<{ organizationId: string; conversationId: string }>,
): Promise<PlatformStaffGeminiProposal | null> {
  const data = await callRpc(client, "staff_gemini_proposal", {
    p_organization_id: requiredUuid(input.organizationId),
    p_conversation_id: requiredUuid(input.conversationId),
  }, { get: true });
  if (!Array.isArray(data) || data.length > 1) return unavailable();
  if (data.length === 0) return null;
  return isRecord(data[0]) ? normalizeStaffGeminiProposal(data[0]) : unavailable();
}

function normalizeReview(
  value: unknown,
  includeReplay: boolean,
): PlatformGeminiProposalReviewResult | PlatformGeminiProposalReview {
  if (!isRecord(value)) return unavailable();
  const expected = [
    "review_id",
    "proposal_request_id",
    "decision",
    "reviewed_payload",
    "reviewed_payload_sha256",
    "reason",
    "reviewed_by_membership_id",
    "reviewed_by_name",
    "reviewed_at",
    ...(includeReplay ? ["replayed"] : []),
  ];
  if (!hasExactKeys(value, expected)) return unavailable();
  const decision = requiredEnum(value.decision, GEMINI_REVIEW_DECISIONS);
  const reviewedPayload = value.reviewed_payload === null
    ? null
    : normalizeGeminiProposal(value.reviewed_payload);
  const payloadSha256 = value.reviewed_payload_sha256 === null
    ? null
    : requiredSha256(value.reviewed_payload_sha256);
  if (
    (decision === "rejected") !== (reviewedPayload === null) ||
    (reviewedPayload === null) !== (payloadSha256 === null)
  ) {
    return unavailable();
  }
  const base = {
    reviewId: requiredUuid(value.review_id),
    proposalRequestId: requiredUuid(value.proposal_request_id),
    decision,
    reviewedPayload,
    reviewedPayloadSha256: payloadSha256,
    reason: optionalTrimmedText(value.reason, 1, 1_000),
    reviewedByMembershipId: requiredUuid(value.reviewed_by_membership_id),
    reviewedByName: requiredTrimmedText(value.reviewed_by_name, 1, 200),
    reviewedAt: requiredTimestamp(value.reviewed_at),
  };
  return includeReplay
    ? Object.freeze({ ...base, replayed: requiredBoolean(value.replayed) })
    : Object.freeze(base);
}

export async function reviewGeminiProposal(
  client: PlatformProviderRpcClient,
  input: Readonly<{
    organizationId: string;
    conversationId: string;
    proposalRequestId: string;
    reviewRequestId: string;
    decision: PlatformGeminiReviewDecision;
    reviewedPayload: PlatformGeminiProposalV2 | null;
    reason: string | null;
  }>,
): Promise<PlatformGeminiProposalReviewResult> {
  const proposalRequestId = requiredUuid(input.proposalRequestId);
  const decision = requiredEnum(input.decision, GEMINI_REVIEW_DECISIONS);
  const reviewedPayload = input.reviewedPayload === null
    ? null
    : normalizeGeminiProposal(input.reviewedPayload);
  const reason = input.reason === null ? null : requiredReason(input.reason);
  if (
    (decision === "rejected" && (reviewedPayload !== null || reason === null)) ||
    (decision !== "rejected" && reviewedPayload === null)
  ) {
    return unavailable();
  }
  const row = exactOneRow(await callRpc(client, "review_gemini_proposal", {
    p_organization_id: requiredUuid(input.organizationId),
    p_conversation_id: requiredUuid(input.conversationId),
    p_proposal_request_id: proposalRequestId,
    p_review_request_id: requiredUuid(input.reviewRequestId),
    p_decision: decision,
    p_reviewed_payload: reviewedPayload,
    p_reason: reason,
  }));
  const result = normalizeReview(row, true) as PlatformGeminiProposalReviewResult;
  return result.proposalRequestId === proposalRequestId ? result : unavailable();
}

export async function listStaffGeminiProposalReviews(
  client: PlatformProviderRpcClient,
  input: Readonly<{
    organizationId: string;
    conversationId: string;
    limit?: number;
  }>,
): Promise<readonly PlatformGeminiProposalReview[]> {
  const limit = requiredInteger(input.limit ?? 20, 1, 100);
  const data = await callRpc(client, "staff_gemini_proposal_reviews", {
    p_organization_id: requiredUuid(input.organizationId),
    p_conversation_id: requiredUuid(input.conversationId),
    p_limit: limit,
  }, { get: true });
  if (!Array.isArray(data) || data.length > limit) return unavailable();
  return Object.freeze(data.map((row) => normalizeReview(row, false)));
}

export type PlatformManualWhatsAppSendRequest = Readonly<{
  organizationId: string;
  conversationId: string;
  sourceMessageId: string;
  aiDraftId: string | null;
  finalText: string;
  reason: string;
  businessKeySha256: string;
  requestId: string;
}>;

export type PlatformManualWhatsAppSendAuthorization = Readonly<{
  organizationId: string;
  manualSendAuthorizationId: string;
  communicationConversationId: string;
  sourceMessageId: string;
  aiDraftId: string | null;
  finalText: string;
  finalTextSha256: string;
  authorizedByMembershipId: string;
  state: "manual_send_authorized";
  requestedByMembershipId: string;
  workItemId: string;
  workState: "queued";
  queueMessageId: string;
  businessKeySha256: string;
  wahaReadiness: "ready";
  wahaReadinessEvidenceKind: "provider_observed";
  wahaReadinessFresh: true;
  wahaReadinessObservedAt: string;
}>;

const MANUAL_SEND_AUTHORIZATION_KEYS = Object.freeze([
  "organization_id",
  "manual_send_authorization_id",
  "communication_conversation_id",
  "source_message_id",
  "ai_draft_id",
  "final_text",
  "final_text_sha256",
  "authorized_by_membership_id",
  "state",
  "requested_by_membership_id",
  "work_item_id",
  "work_state",
  "queue_message_id",
  "business_key_sha256",
  "waha_readiness",
  "waha_readiness_evidence_kind",
  "waha_readiness_fresh",
  "waha_readiness_observed_at",
] as const);

export async function requestManualWhatsAppSendWithAuthorization(
  client: PlatformProviderRpcClient,
  input: PlatformManualWhatsAppSendRequest,
): Promise<PlatformManualWhatsAppSendAuthorization> {
  const organizationId = requiredUuid(input.organizationId);
  const conversationId = requiredUuid(input.conversationId);
  const sourceMessageId = requiredUuid(input.sourceMessageId);
  const aiDraftId = optionalUuid(input.aiDraftId);
  const finalText = requiredTrimmedText(input.finalText, 1, 16_000);
  const businessKeySha256 = requiredSha256(input.businessKeySha256);
  const row = await callRpc(
    client,
    "request_manual_whatsapp_send_with_authorization",
    {
      p_organization_id: organizationId,
      p_conversation_id: conversationId,
      p_source_message_id: sourceMessageId,
      p_ai_draft_id: aiDraftId,
      p_final_text: finalText,
      p_reason: requiredReason(input.reason),
      p_business_key_sha256: businessKeySha256,
      p_request_id: requiredUuid(input.requestId),
    },
  );
  if (!isRecord(row) || !hasExactKeys(row, MANUAL_SEND_AUTHORIZATION_KEYS)) {
    return unavailable();
  }

  const result: PlatformManualWhatsAppSendAuthorization = Object.freeze({
    organizationId: requiredUuid(row.organization_id),
    manualSendAuthorizationId: requiredUuid(
      row.manual_send_authorization_id,
    ),
    communicationConversationId: requiredUuid(
      row.communication_conversation_id,
    ),
    sourceMessageId: requiredUuid(row.source_message_id),
    aiDraftId: optionalUuid(row.ai_draft_id),
    finalText: requiredTrimmedText(row.final_text, 1, 16_000),
    finalTextSha256: requiredSha256(row.final_text_sha256),
    authorizedByMembershipId: requiredUuid(
      row.authorized_by_membership_id,
    ),
    state: requiredEnum(row.state, ["manual_send_authorized"] as const),
    requestedByMembershipId: requiredUuid(
      row.requested_by_membership_id,
    ),
    workItemId: requiredUuid(row.work_item_id),
    workState: requiredEnum(row.work_state, ["queued"] as const),
    queueMessageId: requiredPositiveBigint(row.queue_message_id),
    businessKeySha256: requiredSha256(row.business_key_sha256),
    wahaReadiness: requiredEnum(row.waha_readiness, ["ready"] as const),
    wahaReadinessEvidenceKind: requiredEnum(
      row.waha_readiness_evidence_kind,
      ["provider_observed"] as const,
    ),
    wahaReadinessFresh: requiredBoolean(row.waha_readiness_fresh) as true,
    wahaReadinessObservedAt: requiredTimestamp(
      row.waha_readiness_observed_at,
    ),
  });

  if (
    result.organizationId !== organizationId ||
    result.communicationConversationId !== conversationId ||
    result.sourceMessageId !== sourceMessageId ||
    result.aiDraftId !== aiDraftId ||
    result.finalText !== finalText ||
    result.authorizedByMembershipId !== result.requestedByMembershipId ||
    result.businessKeySha256 !== businessKeySha256 ||
    result.wahaReadinessFresh !== true
  ) {
    return unavailable();
  }
  return result;
}

export type PlatformManualWhatsAppClaimRequest = Readonly<{
  organizationId: string;
  workItemId: string;
  visibilityTimeoutSeconds: number;
  workerRef: string;
  requestId: string;
}>;

export type PlatformManualWhatsAppUnavailableClaim = Readonly<{
  claimed: false;
  queue: "platform_work_v1";
  requestedWorkItemId: string;
}>;

export type PlatformManualWhatsAppClaimedItem = Readonly<{
  claimed: true;
  organizationId: string;
  workItemId: string;
  requestedWorkItemId: string;
  attemptId: string;
  kind: "manual_whatsapp_send";
  manualSendAuthorizationId: string;
  conversationId: string;
  sourceMessageId: string;
  wahaSessionName: typeof PLATFORM_WAHA_SESSION_NAME;
  rawChatId: string;
  rawReplyTo: string;
  finalText: string;
  finalTextSha256: string;
  attemptNumber: 1;
  maxAttempts: 1;
  leaseExpiresAt: string;
  queuePayloadIsPointerOnly: true;
}>;

export type PlatformManualWhatsAppClaimResult =
  | PlatformManualWhatsAppUnavailableClaim
  | PlatformManualWhatsAppClaimedItem;

const MANUAL_SEND_UNAVAILABLE_CLAIM_KEYS = Object.freeze([
  "claimed",
  "queue",
  "requested_work_item_id",
] as const);

const MANUAL_SEND_CLAIMED_ITEM_KEYS = Object.freeze([
  "claimed",
  "organization_id",
  "work_item_id",
  "requested_work_item_id",
  "attempt_id",
  "kind",
  "manual_send_authorization_id",
  "conversation_id",
  "source_message_id",
  "waha_session_name",
  "raw_chat_id",
  "raw_reply_to",
  "final_text",
  "final_text_sha256",
  "attempt_number",
  "max_attempts",
  "lease_expires_at",
  "queue_payload_is_pointer_only",
] as const);

export async function claimManualWhatsAppSendItem(
  client: PlatformProviderRpcClient,
  input: PlatformManualWhatsAppClaimRequest,
): Promise<PlatformManualWhatsAppClaimResult> {
  const organizationId = requiredUuid(input.organizationId);
  const workItemId = requiredUuid(input.workItemId);
  const data = await callRpc(client, "claim_manual_whatsapp_send_item", {
    p_organization_id: organizationId,
    p_work_item_id: workItemId,
    p_visibility_timeout_seconds: requiredInteger(
      input.visibilityTimeoutSeconds,
      1,
      3_600,
    ),
    p_worker_ref: requiredSafeIdentifier(input.workerRef, 160),
    p_request_id: requiredUuid(input.requestId),
  });
  if (!isRecord(data)) return unavailable();

  if (data.claimed === false) {
    if (!hasExactKeys(data, MANUAL_SEND_UNAVAILABLE_CLAIM_KEYS)) {
      return unavailable();
    }
    const result: PlatformManualWhatsAppUnavailableClaim = Object.freeze({
      claimed: false,
      queue: requiredEnum(data.queue, ["platform_work_v1"] as const),
      requestedWorkItemId: requiredUuid(data.requested_work_item_id),
    });
    return result.requestedWorkItemId === workItemId ? result : unavailable();
  }

  if (
    data.claimed !== true ||
    !hasExactKeys(data, MANUAL_SEND_CLAIMED_ITEM_KEYS)
  ) {
    return unavailable();
  }
  const result: PlatformManualWhatsAppClaimedItem = Object.freeze({
    claimed: true,
    organizationId: requiredUuid(data.organization_id),
    workItemId: requiredUuid(data.work_item_id),
    requestedWorkItemId: requiredUuid(data.requested_work_item_id),
    attemptId: requiredUuid(data.attempt_id),
    kind: requiredEnum(data.kind, ["manual_whatsapp_send"] as const),
    manualSendAuthorizationId: requiredUuid(
      data.manual_send_authorization_id,
    ),
    conversationId: requiredUuid(data.conversation_id),
    sourceMessageId: requiredUuid(data.source_message_id),
    wahaSessionName: requiredEnum(data.waha_session_name, [
      PLATFORM_WAHA_SESSION_NAME,
    ] as const),
    rawChatId: requiredSafeIdentifier(data.raw_chat_id),
    rawReplyTo: requiredPrintableProviderId(data.raw_reply_to),
    finalText: requiredTrimmedText(data.final_text, 1, 16_000),
    finalTextSha256: requiredSha256(data.final_text_sha256),
    attemptNumber: requiredInteger(data.attempt_number, 1, 1) as 1,
    maxAttempts: requiredInteger(data.max_attempts, 1, 1) as 1,
    leaseExpiresAt: requiredTimestamp(data.lease_expires_at),
    queuePayloadIsPointerOnly: requiredBoolean(
      data.queue_payload_is_pointer_only,
    ) as true,
  });
  return result.organizationId === organizationId &&
      result.workItemId === workItemId &&
      result.requestedWorkItemId === workItemId &&
      result.queuePayloadIsPointerOnly === true
    ? result
    : unavailable();
}

export type PlatformManualSendWahaRuntime = Readonly<{
  wahaSessionName: typeof PLATFORM_WAHA_SESSION_NAME;
  wahaBaseUrl: typeof PLATFORM_WAHA_BASE_URL;
  wahaApiKey: string;
  bindingVersion: string;
}>;

const MANUAL_SEND_WAHA_RUNTIME_KEYS = Object.freeze([
  "waha_session_name",
  "waha_base_url",
  "waha_api_key",
  "binding_version",
] as const);

export async function resolveManualSendWahaRuntime(
  client: PlatformProviderRpcClient,
  organizationId: string,
): Promise<PlatformManualSendWahaRuntime> {
  const row = exactOneRow(await callRpc(
    client,
    "resolve_manual_send_waha_runtime",
    { p_organization_id: requiredUuid(organizationId) },
  ));
  if (!hasExactKeys(row, MANUAL_SEND_WAHA_RUNTIME_KEYS)) {
    return unavailable();
  }
  const wahaApiKey = requiredTrimmedText(row.waha_api_key, 16, 4_096);
  if (/[\r\n]/.test(wahaApiKey)) return unavailable();
  return Object.freeze({
    wahaSessionName: requiredEnum(row.waha_session_name, [
      PLATFORM_WAHA_SESSION_NAME,
    ] as const),
    wahaBaseUrl: requiredEnum(row.waha_base_url, [
      PLATFORM_WAHA_BASE_URL,
    ] as const),
    wahaApiKey,
    bindingVersion: requiredPositiveBigint(row.binding_version),
  });
}

export type PlatformManualWhatsAppSendOutcome =
  | "succeeded"
  | "terminal_error"
  | "unknown_result";

export type PlatformManualWhatsAppFinishRequest = Readonly<{
  organizationId: string;
  workItemId: string;
  attemptId: string;
  authorizationId: string;
  outcome: PlatformManualWhatsAppSendOutcome;
  errorCode: string | null;
  providerMessageId: string | null;
  providerObservedAt: string | null;
  requestId: string;
}>;

export type PlatformManualWhatsAppFinishResult = Readonly<{
  organizationId: string;
  workItemId: string;
  attemptId: string;
  outcome: PlatformManualWhatsAppSendOutcome;
  communicationMessageId: string | null;
  providerIdentityPrivate: true;
}>;

const MANUAL_SEND_OUTCOMES = Object.freeze([
  "succeeded",
  "terminal_error",
  "unknown_result",
] as const);

export async function finishManualWhatsAppSend(
  client: PlatformProviderRpcClient,
  input: PlatformManualWhatsAppFinishRequest,
): Promise<PlatformManualWhatsAppFinishResult> {
  const organizationId = requiredUuid(input.organizationId);
  const workItemId = requiredUuid(input.workItemId);
  const attemptId = requiredUuid(input.attemptId);
  const outcome = requiredEnum(input.outcome, MANUAL_SEND_OUTCOMES);
  const errorCode = input.errorCode === null
    ? null
    : requiredErrorCode(input.errorCode);
  const providerMessageId = input.providerMessageId === null
    ? null
    : requiredPrintableProviderId(input.providerMessageId);
  const providerObservedAt = optionalTimestamp(input.providerObservedAt);
  if (
    (outcome === "succeeded" &&
      (errorCode !== null ||
        providerMessageId === null ||
        providerObservedAt === null)) ||
    (outcome !== "succeeded" &&
      (errorCode === null ||
        providerMessageId !== null ||
        providerObservedAt !== null))
  ) {
    return unavailable();
  }

  const data = await callRpc(client, "finish_manual_whatsapp_send", {
    p_organization_id: organizationId,
    p_work_item_id: workItemId,
    p_attempt_id: attemptId,
    p_authorization_id: requiredUuid(input.authorizationId),
    p_outcome: outcome,
    p_error_code: errorCode,
    p_provider_message_id: providerMessageId,
    p_provider_observed_at: providerObservedAt,
    p_request_id: requiredUuid(input.requestId),
  });
  if (!isRecord(data)) return unavailable();

  const result: PlatformManualWhatsAppFinishResult = Object.freeze({
    organizationId: requiredUuid(data.organization_id),
    workItemId: requiredUuid(data.work_item_id),
    attemptId: requiredUuid(data.attempt_id),
    outcome: requiredEnum(data.outcome, MANUAL_SEND_OUTCOMES),
    communicationMessageId: optionalUuid(data.communication_message_id),
    providerIdentityPrivate: requiredBoolean(
      data.provider_identity_private,
    ) as true,
  });
  if (
    result.organizationId !== organizationId ||
    result.workItemId !== workItemId ||
    result.attemptId !== attemptId ||
    result.outcome !== outcome ||
    result.providerIdentityPrivate !== true ||
    (outcome === "succeeded") !==
      (result.communicationMessageId !== null) ||
    data.automatic_retry_allowed !== false
  ) {
    return unavailable();
  }
  return result;
}

export type PlatformManualWhatsAppAttemptStatus =
  | "prepared"
  | "accepted"
  | "unknown"
  | "rejected";

export type PlatformWhatsAppProviderSource = "api" | "app";

export type PlatformWhatsAppAckName =
  | "ERROR"
  | "PENDING"
  | "SERVER"
  | "DEVICE"
  | "READ"
  | "PLAYED"
  | "UNKNOWN";

export type PlatformManualWhatsAppReconciliationKind =
  | "unknown_recovery"
  | "ack_refresh";

export type PlatformManualWhatsAppReconciliationOutcome =
  | "message_confirmed"
  | "message_not_found"
  | "delivery_refreshed";

export type PlatformManualWhatsAppSendAttempt = Readonly<{
  attemptId: string;
  workItemId: string;
  conversationId: string;
  manualSendAuthorizationId: string;
  finalText: string;
  authorizedByMembershipId: string;
  authorizedByName: string;
  status: PlatformManualWhatsAppAttemptStatus;
  reconciliationRequired: boolean;
  providerSource: PlatformWhatsAppProviderSource | null;
  ackName: PlatformWhatsAppAckName | null;
  providerObservedAt: string | null;
  ackObservedAt: string | null;
  failureCode: string | null;
  attemptNumber: 1;
  authorizedAt: string;
  claimedAt: string;
  settledAt: string | null;
  lastReconciledAt: string | null;
  latestReconciliationKind: PlatformManualWhatsAppReconciliationKind | null;
  latestReconciliationOutcome:
    | PlatformManualWhatsAppReconciliationOutcome
    | null;
}>;

const MANUAL_SEND_ATTEMPT_KEYS = Object.freeze([
  "attempt_id",
  "work_item_id",
  "conversation_id",
  "manual_send_authorization_id",
  "final_text",
  "authorized_by_membership_id",
  "authorized_by_name",
  "status",
  "reconciliation_required",
  "provider_source",
  "ack_name",
  "provider_observed_at",
  "ack_observed_at",
  "failure_code",
  "attempt_number",
  "authorized_at",
  "claimed_at",
  "settled_at",
  "last_reconciled_at",
  "latest_reconciliation_kind",
  "latest_reconciliation_outcome",
] as const);

const MANUAL_SEND_ATTEMPT_STATUSES = Object.freeze([
  "prepared",
  "accepted",
  "unknown",
  "rejected",
] as const);
const PROVIDER_SOURCES = Object.freeze(["api", "app"] as const);
const WAHA_ACK_NAMES = Object.freeze([
  "ERROR",
  "PENDING",
  "SERVER",
  "DEVICE",
  "READ",
  "PLAYED",
  "UNKNOWN",
] as const);
const RECONCILIATION_KINDS = Object.freeze([
  "unknown_recovery",
  "ack_refresh",
] as const);
const RECONCILIATION_OUTCOMES = Object.freeze([
  "message_confirmed",
  "message_not_found",
  "delivery_refreshed",
] as const);

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return value === null ? null : requiredEnum(value, allowed);
}

function normalizeManualSendAttempt(
  value: unknown,
): PlatformManualWhatsAppSendAttempt {
  if (!isRecord(value) || !hasExactKeys(value, MANUAL_SEND_ATTEMPT_KEYS)) {
    return unavailable();
  }
  const result: PlatformManualWhatsAppSendAttempt = Object.freeze({
    attemptId: requiredUuid(value.attempt_id),
    workItemId: requiredUuid(value.work_item_id),
    conversationId: requiredUuid(value.conversation_id),
    manualSendAuthorizationId: requiredUuid(
      value.manual_send_authorization_id,
    ),
    finalText: requiredTrimmedText(value.final_text, 1, 16_000),
    authorizedByMembershipId: requiredUuid(
      value.authorized_by_membership_id,
    ),
    authorizedByName: requiredTrimmedText(value.authorized_by_name, 1, 200),
    status: requiredEnum(value.status, MANUAL_SEND_ATTEMPT_STATUSES),
    reconciliationRequired: requiredBoolean(value.reconciliation_required),
    providerSource: optionalEnum(value.provider_source, PROVIDER_SOURCES),
    ackName: optionalEnum(value.ack_name, WAHA_ACK_NAMES),
    providerObservedAt: optionalTimestamp(value.provider_observed_at),
    ackObservedAt: optionalTimestamp(value.ack_observed_at),
    failureCode: optionalErrorCode(value.failure_code),
    attemptNumber: requiredInteger(value.attempt_number, 1, 1) as 1,
    authorizedAt: requiredTimestamp(value.authorized_at),
    claimedAt: requiredTimestamp(value.claimed_at),
    settledAt: optionalTimestamp(value.settled_at),
    lastReconciledAt: optionalTimestamp(value.last_reconciled_at),
    latestReconciliationKind: optionalEnum(
      value.latest_reconciliation_kind,
      RECONCILIATION_KINDS,
    ),
    latestReconciliationOutcome: optionalEnum(
      value.latest_reconciliation_outcome,
      RECONCILIATION_OUTCOMES,
    ),
  });
  if (
    result.reconciliationRequired !== (result.status === "unknown") ||
    (result.ackName === null) !== (result.ackObservedAt === null) ||
    (result.latestReconciliationKind === null) !==
      (result.latestReconciliationOutcome === null) ||
    (result.latestReconciliationKind === null) !==
      (result.lastReconciledAt === null)
  ) {
    return unavailable();
  }
  return result;
}

export async function readLatestManualWhatsAppSendAttempt(
  client: PlatformProviderRpcClient,
  input: Readonly<{ organizationId: string; conversationId: string }>,
): Promise<PlatformManualWhatsAppSendAttempt | null> {
  const conversationId = requiredUuid(input.conversationId);
  const data = await callRpc(
    client,
    "staff_latest_manual_whatsapp_send_attempt",
    {
      p_organization_id: requiredUuid(input.organizationId),
      p_conversation_id: conversationId,
    },
    { get: true },
  );
  if (!Array.isArray(data) || data.length > 1) return unavailable();
  if (data.length === 0) return null;
  const result = normalizeManualSendAttempt(data[0]);
  return result.conversationId === conversationId ? result : unavailable();
}

export type PlatformManualWhatsAppReconciliationRequest = Readonly<{
  organizationId: string;
  conversationId: string;
  attemptId: string;
  requestId: string;
  reason: string;
}>;

export type PlatformManualWhatsAppReconciliationReceipt = Readonly<{
  reconciliationRequestId: string;
  reconciliationKind: PlatformManualWhatsAppReconciliationKind;
  replayed: boolean;
}>;

const RECONCILIATION_RECEIPT_KEYS = Object.freeze([
  "reconciliation_request_id",
  "reconciliation_kind",
  "replayed",
] as const);

export async function requestManualWhatsAppReconciliation(
  client: PlatformProviderRpcClient,
  input: PlatformManualWhatsAppReconciliationRequest,
): Promise<PlatformManualWhatsAppReconciliationReceipt> {
  const row = exactOneRow(await callRpc(
    client,
    "request_manual_whatsapp_reconciliation",
    {
      p_organization_id: requiredUuid(input.organizationId),
      p_conversation_id: requiredUuid(input.conversationId),
      p_attempt_id: requiredUuid(input.attemptId),
      p_request_id: requiredUuid(input.requestId),
      p_reason: requiredReason(input.reason),
    },
  ));
  if (!hasExactKeys(row, RECONCILIATION_RECEIPT_KEYS)) {
    return unavailable();
  }
  return Object.freeze({
    reconciliationRequestId: requiredUuid(row.reconciliation_request_id),
    reconciliationKind: requiredEnum(
      row.reconciliation_kind,
      RECONCILIATION_KINDS,
    ),
    replayed: requiredBoolean(row.replayed),
  });
}

export type PlatformManualWhatsAppReconciliationContext = Readonly<{
  reconciliationRequestId: string;
  requestId: string;
  organizationId: string;
  conversationId: string;
  sourceMessageId: string;
  workItemId: string;
  attemptId: string;
  manualSendAuthorizationId: string;
  reconciliationKind: PlatformManualWhatsAppReconciliationKind;
  wahaSessionName: typeof PLATFORM_WAHA_SESSION_NAME;
  rawChatId: string;
  finalText: string;
  finalTextSha256: string;
  expectedProviderMessageId: string | null;
  providerWindowStart: string;
  providerWindowEnd: string;
  completed: boolean;
}>;

const RECONCILIATION_CONTEXT_KEYS = Object.freeze([
  "reconciliation_request_id",
  "request_id",
  "organization_id",
  "conversation_id",
  "source_message_id",
  "work_item_id",
  "attempt_id",
  "manual_send_authorization_id",
  "reconciliation_kind",
  "waha_session_name",
  "raw_chat_id",
  "final_text",
  "final_text_sha256",
  "expected_provider_message_id",
  "provider_window_start",
  "provider_window_end",
  "completed",
] as const);

export async function getManualWhatsAppReconciliationContext(
  client: PlatformProviderRpcClient,
  reconciliationRequestId: string,
): Promise<PlatformManualWhatsAppReconciliationContext> {
  const expectedRequestId = requiredUuid(reconciliationRequestId);
  const data = await callRpc(
    client,
    "manual_whatsapp_reconciliation_context",
    { p_reconciliation_request_id: expectedRequestId },
  );
  if (!isRecord(data) || !hasExactKeys(data, RECONCILIATION_CONTEXT_KEYS)) {
    return unavailable();
  }
  const kind = requiredEnum(data.reconciliation_kind, RECONCILIATION_KINDS);
  const expectedProviderMessageId = data.expected_provider_message_id === null
    ? null
    : requiredPrintableProviderId(data.expected_provider_message_id);
  const providerWindowStart = requiredTimestamp(data.provider_window_start);
  const providerWindowEnd = requiredTimestamp(data.provider_window_end);
  const result: PlatformManualWhatsAppReconciliationContext = Object.freeze({
    reconciliationRequestId: requiredUuid(data.reconciliation_request_id),
    requestId: requiredUuid(data.request_id),
    organizationId: requiredUuid(data.organization_id),
    conversationId: requiredUuid(data.conversation_id),
    sourceMessageId: requiredUuid(data.source_message_id),
    workItemId: requiredUuid(data.work_item_id),
    attemptId: requiredUuid(data.attempt_id),
    manualSendAuthorizationId: requiredUuid(
      data.manual_send_authorization_id,
    ),
    reconciliationKind: kind,
    wahaSessionName: requiredEnum(data.waha_session_name, [
      PLATFORM_WAHA_SESSION_NAME,
    ] as const),
    rawChatId: requiredSafeIdentifier(data.raw_chat_id),
    finalText: requiredTrimmedText(data.final_text, 1, 16_000),
    finalTextSha256: requiredSha256(data.final_text_sha256),
    expectedProviderMessageId,
    providerWindowStart,
    providerWindowEnd,
    completed: requiredBoolean(data.completed),
  });
  if (
    result.reconciliationRequestId !== expectedRequestId ||
    (kind === "unknown_recovery") !==
      (expectedProviderMessageId === null) ||
    Date.parse(providerWindowStart) > Date.parse(providerWindowEnd)
  ) {
    return unavailable();
  }
  return result;
}

export type PlatformWhatsAppAckState =
  | "error"
  | "pending"
  | "server"
  | "device"
  | "read"
  | "played"
  | "unknown";

type PlatformManualWhatsAppReconciliationFinishCommon = Readonly<{
  reconciliationRequestId: string;
  wahaSessionName: typeof PLATFORM_WAHA_SESSION_NAME;
  rawChatId: string;
  finalTextSha256: string;
  completionRequestId: string;
}>;

export type PlatformManualWhatsAppReconciliationFinishRequest =
  PlatformManualWhatsAppReconciliationFinishCommon & (
    | Readonly<{
      matchCount: 0;
      providerMessageId: null;
      providerSource: null;
      ackState: null;
      providerObservedAt: null;
      ackObservedAt: null;
    }>
    | Readonly<{
      matchCount: 1;
      providerMessageId: string;
      providerSource: PlatformWhatsAppProviderSource;
      ackState: PlatformWhatsAppAckState;
      providerObservedAt: string;
      ackObservedAt: string;
    }>
  );

export type PlatformManualWhatsAppReconciliationFinishResult = Readonly<{
  reconciliationRequestId: string;
  organizationId: string;
  conversationId: string;
  attemptId: string;
  outcome: PlatformManualWhatsAppReconciliationOutcome;
  communicationMessageId: string | null;
  ackName: PlatformWhatsAppAckName | null;
  reconciliationRequired: boolean;
  replayed: boolean;
}>;

const WAHA_ACK_STATES = Object.freeze([
  "error",
  "pending",
  "server",
  "device",
  "read",
  "played",
  "unknown",
] as const);

const RECONCILIATION_FINISH_RESULT_KEYS = Object.freeze([
  "reconciliation_request_id",
  "organization_id",
  "conversation_id",
  "attempt_id",
  "outcome",
  "communication_message_id",
  "ack_name",
  "reconciliation_required",
  "replayed",
] as const);

export async function finishManualWhatsAppReconciliation(
  client: PlatformProviderRpcClient,
  input: PlatformManualWhatsAppReconciliationFinishRequest,
): Promise<PlatformManualWhatsAppReconciliationFinishResult> {
  const reconciliationRequestId = requiredUuid(
    input.reconciliationRequestId,
  );
  const matchCount = requiredInteger(input.matchCount, 0, 1) as 0 | 1;
  const providerMessageId = input.providerMessageId === null
    ? null
    : requiredPrintableProviderId(input.providerMessageId);
  const providerSource = optionalEnum(input.providerSource, PROVIDER_SOURCES);
  const ackState = optionalEnum(input.ackState, WAHA_ACK_STATES);
  const providerObservedAt = optionalTimestamp(input.providerObservedAt);
  const ackObservedAt = optionalTimestamp(input.ackObservedAt);
  if (
    (matchCount === 0 &&
      (providerMessageId !== null ||
        providerSource !== null ||
        ackState !== null ||
        providerObservedAt !== null ||
        ackObservedAt !== null)) ||
    (matchCount === 1 &&
      (providerMessageId === null ||
        providerSource === null ||
        ackState === null ||
        providerObservedAt === null ||
        ackObservedAt === null ||
        Date.parse(ackObservedAt) < Date.parse(providerObservedAt)))
  ) {
    return unavailable();
  }

  const data = await callRpc(
    client,
    "finish_manual_whatsapp_reconciliation",
    {
      p_reconciliation_request_id: reconciliationRequestId,
      p_waha_session_name: requiredEnum(input.wahaSessionName, [
        PLATFORM_WAHA_SESSION_NAME,
      ] as const),
      p_raw_chat_id: requiredSafeIdentifier(input.rawChatId),
      p_final_text_sha256: requiredSha256(input.finalTextSha256),
      p_match_count: matchCount,
      p_provider_message_id: providerMessageId,
      p_provider_source: providerSource,
      p_ack_state: ackState,
      p_provider_observed_at: providerObservedAt,
      p_ack_observed_at: ackObservedAt,
      p_completion_request_id: requiredUuid(input.completionRequestId),
    },
  );
  if (
    !isRecord(data) ||
    !hasExactKeys(data, RECONCILIATION_FINISH_RESULT_KEYS)
  ) {
    return unavailable();
  }
  const result: PlatformManualWhatsAppReconciliationFinishResult =
    Object.freeze({
      reconciliationRequestId: requiredUuid(
        data.reconciliation_request_id,
      ),
      organizationId: requiredUuid(data.organization_id),
      conversationId: requiredUuid(data.conversation_id),
      attemptId: requiredUuid(data.attempt_id),
      outcome: requiredEnum(data.outcome, RECONCILIATION_OUTCOMES),
      communicationMessageId: optionalUuid(data.communication_message_id),
      ackName: optionalEnum(data.ack_name, WAHA_ACK_NAMES),
      reconciliationRequired: requiredBoolean(
        data.reconciliation_required,
      ),
      replayed: requiredBoolean(data.replayed),
    });
  const foundMessage = result.outcome !== "message_not_found";
  if (
    result.reconciliationRequestId !== reconciliationRequestId ||
    result.reconciliationRequired !== !foundMessage ||
    foundMessage !== (result.communicationMessageId !== null) ||
    foundMessage !== (result.ackName !== null) ||
    (matchCount === 0) !== (result.outcome === "message_not_found")
  ) {
    return unavailable();
  }
  return result;
}
