const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const MEMORY_ROW_KEYS = [
  "conversation_id",
  "memory_version",
  "memory_short_summary",
  "memory_long_summary",
  "memory_source_message_id",
  "facts",
  "qualification_version",
  "qualification_status",
  "qualification_completeness",
  "qualification_missing_fact_keys",
  "qualification_notes",
  "qualification_source_message_id",
  "control_version",
  "control_state",
  "control_reason",
  "latest_retrieval_request_id",
  "latest_retrieval_outcome",
  "latest_retrieval_created_at",
  "autonomous_authority",
] as const;
const FACT_ROW_KEYS = [
  "fact_key",
  "status",
  "value",
  "version",
  "source_message_id",
  "created_at",
] as const;
const CAPABILITY_ROW_KEYS = [
  "embedding_model",
  "embedding_dimensions",
  "provider_ingestion_enabled",
  "semantic_retrieval_enabled",
  "lexical_preview_enabled",
  "lexical_preview_degraded",
  "autonomous_authority",
  "provider_proof_state",
] as const;
const EVIDENCE_ROW_KEYS = [
  "retrieval_request_id",
  "source_message_id",
  "retrieval_mode",
  "retrieval_outcome",
  "degraded",
  "provider_proof_state",
  "autonomous_authority",
  "knowledge_key",
  "knowledge_version",
  "knowledge_title",
  "evidence_ordinal",
  "created_at",
] as const;

export const PLATFORM_AI_FACT_KEYS = [
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
export type PlatformAiFactKey = (typeof PLATFORM_AI_FACT_KEYS)[number];

export const PLATFORM_AI_LIST_FACT_KEYS = [
  "blockers",
  "unanswered_questions",
] as const;
export type PlatformAiListFactKey =
  (typeof PLATFORM_AI_LIST_FACT_KEYS)[number];

export const PLATFORM_AI_QUALIFICATION_STATES = [
  "collecting",
  "ready_for_staff_review",
  "staff_confirmed",
  "not_a_fit",
] as const;
export type PlatformAiQualificationState =
  (typeof PLATFORM_AI_QUALIFICATION_STATES)[number];

export const PLATFORM_AI_CONTROL_STATES = [
  "paused",
  "staff_takeover",
  "staff_only",
] as const;
export type PlatformAiControlState =
  (typeof PLATFORM_AI_CONTROL_STATES)[number];

export type PlatformAiFact = Readonly<{
  key: PlatformAiFactKey;
  status: "active" | "retracted";
  value: string | readonly string[] | null;
  version: string;
  sourceMessageId: string;
  createdAt: string;
}>;

export type PlatformConversationAiMemory = Readonly<{
  conversationId: string;
  memory: Readonly<{
    version: string;
    shortSummary: string | null;
    longSummary: string | null;
    sourceMessageId: string | null;
  }>;
  facts: readonly PlatformAiFact[];
  qualification: Readonly<{
    version: string;
    status: PlatformAiQualificationState;
    completeness: number;
    missingFactKeys: readonly PlatformAiFactKey[];
    notes: string | null;
    sourceMessageId: string | null;
  }>;
  control: Readonly<{
    version: string;
    state: PlatformAiControlState;
    reason: string;
  }>;
  latestRetrieval: Readonly<{
    requestId: string;
    outcome: "completed" | "no_match";
    createdAt: string;
  }> | null;
  autonomousAuthority: false;
}>;

export type PlatformAiRetrievalCapabilities = Readonly<{
  embeddingModel: "gemini-embedding-2";
  embeddingDimensions: 1536;
  providerIngestionEnabled: false;
  semanticRetrievalEnabled: false;
  lexicalPreviewEnabled: true;
  lexicalPreviewDegraded: true;
  autonomousAuthority: false;
  providerProofState: "blocked";
}>;

export type PlatformAiRetrievalEvidenceItem = Readonly<{
  knowledgeKey: string;
  knowledgeVersion: string;
  knowledgeTitle: string;
  ordinal: number;
}>;

export type PlatformAiRetrievalEvidence = Readonly<{
  requestId: string;
  sourceMessageId: string;
  mode: "lexical_preview";
  outcome: "completed" | "no_match";
  degraded: true;
  providerProofState: "blocked";
  autonomousAuthority: false;
  createdAt: string;
  items: readonly PlatformAiRetrievalEvidenceItem[];
}>;

export class PlatformAiMemoryContractError extends Error {
  constructor() {
    super("Platform AI memory contract is invalid.");
    this.name = "PlatformAiMemoryContractError";
  }
}

function invalidShape(): never {
  throw new PlatformAiMemoryContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalidShape();
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) invalidShape();
  return normalized;
}

function parseOptionalUuid(value: unknown): string | null {
  return value === null ? null : parseUuid(value);
}

function parseVersion(value: unknown, allowZero = true): string {
  let normalized: string;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    normalized = String(value);
  } else if (typeof value === "string" && UNSIGNED_INTEGER_PATTERN.test(value)) {
    normalized = value;
  } else {
    return invalidShape();
  }
  if ((!allowZero && normalized === "0") || BigInt(normalized) > MAX_POSTGRES_BIGINT) {
    return invalidShape();
  }
  return normalized;
}

function parseTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function parseText(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value !== value.trim()) invalidShape();
  if (value.length < 1 || value.length > maxLength) invalidShape();
  return value;
}

function parseOptionalText(value: unknown, maxLength: number): string | null {
  return value === null ? null : parseText(value, maxLength);
}

function isFactKey(value: unknown): value is PlatformAiFactKey {
  return (
    typeof value === "string" &&
    (PLATFORM_AI_FACT_KEYS as readonly string[]).includes(value)
  );
}

function isListFactKey(value: PlatformAiFactKey): value is PlatformAiListFactKey {
  return (PLATFORM_AI_LIST_FACT_KEYS as readonly string[]).includes(value);
}

function parseFactList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    return invalidShape();
  }
  const parsed = value.map((item) => parseText(item, 500));
  if (new Set(parsed).size !== parsed.length) invalidShape();
  if (JSON.stringify(parsed).length > 10_000) invalidShape();
  return parsed;
}

function parseFactRow(value: unknown): PlatformAiFact {
  if (!isRecord(value) || !hasExactKeys(value, FACT_ROW_KEYS)) invalidShape();
  if (!isFactKey(value.fact_key)) invalidShape();
  if (value.status !== "active" && value.status !== "retracted") invalidShape();

  let factValue: PlatformAiFact["value"];
  if (value.status === "retracted") {
    if (value.value !== null) invalidShape();
    factValue = null;
  } else if (isListFactKey(value.fact_key)) {
    factValue = parseFactList(value.value);
  } else {
    factValue = parseText(value.value, 500);
  }

  return {
    key: value.fact_key,
    status: value.status,
    value: factValue,
    version: parseVersion(value.version, false),
    sourceMessageId: parseUuid(value.source_message_id),
    createdAt: parseTimestamp(value.created_at),
  };
}

function parseFactKeyList(value: unknown): readonly PlatformAiFactKey[] {
  if (!Array.isArray(value) || value.length > PLATFORM_AI_FACT_KEYS.length) {
    return invalidShape();
  }
  if (!value.every(isFactKey)) invalidShape();
  if (new Set(value).size !== value.length) invalidShape();
  return value;
}

function parseRetrievalOutcome(value: unknown): "completed" | "no_match" {
  if (value !== "completed" && value !== "no_match") invalidShape();
  return value;
}

export function normalizePlatformConversationAiMemory(
  value: unknown,
): PlatformConversationAiMemory {
  if (!isRecord(value) || !hasExactKeys(value, MEMORY_ROW_KEYS)) invalidShape();

  const memoryVersion = parseVersion(value.memory_version);
  const memorySourceMessageId = parseOptionalUuid(value.memory_source_message_id);
  const shortSummary = parseOptionalText(value.memory_short_summary, 1_000);
  const longSummary = parseOptionalText(value.memory_long_summary, 6_000);
  if (
    (memoryVersion === "0" &&
      (shortSummary !== null || longSummary !== null || memorySourceMessageId !== null)) ||
    (memoryVersion !== "0" &&
      (shortSummary === null || longSummary === null || memorySourceMessageId === null))
  ) {
    invalidShape();
  }

  if (!Array.isArray(value.facts) || value.facts.length > PLATFORM_AI_FACT_KEYS.length) {
    invalidShape();
  }
  const facts = value.facts.map(parseFactRow);
  if (new Set(facts.map((fact) => fact.key)).size !== facts.length) invalidShape();
  let previousFactIndex = -1;
  for (const fact of facts) {
    const factIndex = PLATFORM_AI_FACT_KEYS.indexOf(fact.key);
    if (factIndex <= previousFactIndex) invalidShape();
    previousFactIndex = factIndex;
  }

  if (
    typeof value.qualification_status !== "string" ||
    !(PLATFORM_AI_QUALIFICATION_STATES as readonly string[]).includes(
      value.qualification_status,
    )
  ) {
    invalidShape();
  }
  const qualificationStatus =
    value.qualification_status as PlatformAiQualificationState;
  if (
    typeof value.qualification_completeness !== "number" ||
    !Number.isInteger(value.qualification_completeness) ||
    value.qualification_completeness < 0 ||
    value.qualification_completeness > 100
  ) {
    invalidShape();
  }
  const missingFactKeys = parseFactKeyList(
    value.qualification_missing_fact_keys,
  );
  if (
    qualificationStatus === "staff_confirmed" &&
    (value.qualification_completeness !== 100 || missingFactKeys.length !== 0)
  ) {
    invalidShape();
  }
  const qualificationVersion = parseVersion(value.qualification_version);
  const qualificationSourceMessageId = parseOptionalUuid(
    value.qualification_source_message_id,
  );
  if (
    (qualificationVersion === "0" && qualificationSourceMessageId !== null) ||
    (qualificationVersion !== "0" && qualificationSourceMessageId === null)
  ) {
    invalidShape();
  }

  if (
    typeof value.control_state !== "string" ||
    !(PLATFORM_AI_CONTROL_STATES as readonly string[]).includes(value.control_state)
  ) {
    invalidShape();
  }
  const controlVersion = parseVersion(value.control_version);
  const controlReason = parseText(value.control_reason, 500);
  if (value.autonomous_authority !== false) invalidShape();

  const retrievalValues = [
    value.latest_retrieval_request_id,
    value.latest_retrieval_outcome,
    value.latest_retrieval_created_at,
  ];
  const retrievalIsNull = retrievalValues.every((item) => item === null);
  if (!retrievalIsNull && retrievalValues.some((item) => item === null)) {
    invalidShape();
  }

  return {
    conversationId: parseUuid(value.conversation_id),
    memory: {
      version: memoryVersion,
      shortSummary,
      longSummary,
      sourceMessageId: memorySourceMessageId,
    },
    facts,
    qualification: {
      version: qualificationVersion,
      status: qualificationStatus,
      completeness: value.qualification_completeness,
      missingFactKeys,
      notes: parseOptionalText(value.qualification_notes, 2_000),
      sourceMessageId: qualificationSourceMessageId,
    },
    control: {
      version: controlVersion,
      state: value.control_state as PlatformAiControlState,
      reason: controlReason,
    },
    latestRetrieval: retrievalIsNull
      ? null
      : {
          requestId: parseUuid(value.latest_retrieval_request_id),
          outcome: parseRetrievalOutcome(value.latest_retrieval_outcome),
          createdAt: parseTimestamp(value.latest_retrieval_created_at),
        },
    autonomousAuthority: false,
  };
}

export function normalizePlatformAiRetrievalCapabilities(
  value: unknown,
): PlatformAiRetrievalCapabilities {
  if (!isRecord(value) || !hasExactKeys(value, CAPABILITY_ROW_KEYS)) invalidShape();
  if (
    value.embedding_model !== "gemini-embedding-2" ||
    value.embedding_dimensions !== 1536 ||
    value.provider_ingestion_enabled !== false ||
    value.semantic_retrieval_enabled !== false ||
    value.lexical_preview_enabled !== true ||
    value.lexical_preview_degraded !== true ||
    value.autonomous_authority !== false ||
    value.provider_proof_state !== "blocked"
  ) {
    invalidShape();
  }
  return {
    embeddingModel: "gemini-embedding-2",
    embeddingDimensions: 1536,
    providerIngestionEnabled: false,
    semanticRetrievalEnabled: false,
    lexicalPreviewEnabled: true,
    lexicalPreviewDegraded: true,
    autonomousAuthority: false,
    providerProofState: "blocked",
  };
}

export function normalizePlatformAiRetrievalEvidence(
  value: unknown,
): PlatformAiRetrievalEvidence {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) invalidShape();

  const parsed = value.map((row) => {
    if (!isRecord(row) || !hasExactKeys(row, EVIDENCE_ROW_KEYS)) invalidShape();
    if (
      row.retrieval_mode !== "lexical_preview" ||
      row.degraded !== true ||
      row.provider_proof_state !== "blocked" ||
      row.autonomous_authority !== false
    ) {
      invalidShape();
    }
    const outcome = parseRetrievalOutcome(row.retrieval_outcome);
    const common = {
      requestId: parseUuid(row.retrieval_request_id),
      sourceMessageId: parseUuid(row.source_message_id),
      outcome,
      createdAt: parseTimestamp(row.created_at),
    };
    if (outcome === "no_match") {
      if (
        row.knowledge_key !== null ||
        row.knowledge_version !== null ||
        row.knowledge_title !== null ||
        row.evidence_ordinal !== null
      ) {
        invalidShape();
      }
      return { common, item: null };
    }
    if (
      typeof row.evidence_ordinal !== "number" ||
      !Number.isInteger(row.evidence_ordinal) ||
      row.evidence_ordinal < 1 ||
      row.evidence_ordinal > 10
    ) {
      invalidShape();
    }
    return {
      common,
      item: {
        knowledgeKey: parseText(row.knowledge_key, 160),
        knowledgeVersion: parseVersion(row.knowledge_version, false),
        knowledgeTitle: parseText(row.knowledge_title, 255),
        ordinal: row.evidence_ordinal,
      } satisfies PlatformAiRetrievalEvidenceItem,
    };
  });

  const first = parsed[0].common;
  if (
    parsed.some(
      ({ common }) =>
        common.requestId !== first.requestId ||
        common.sourceMessageId !== first.sourceMessageId ||
        common.outcome !== first.outcome ||
        common.createdAt !== first.createdAt,
    )
  ) {
    invalidShape();
  }
  const items = parsed.flatMap(({ item }) => (item === null ? [] : [item]));
  if (
    (first.outcome === "completed" && items.length !== parsed.length) ||
    (first.outcome === "no_match" && (parsed.length !== 1 || items.length !== 0)) ||
    new Set(items.map((item) => item.ordinal)).size !== items.length
  ) {
    invalidShape();
  }

  return {
    requestId: first.requestId,
    sourceMessageId: first.sourceMessageId,
    mode: "lexical_preview",
    outcome: first.outcome,
    degraded: true,
    providerProofState: "blocked",
    autonomousAuthority: false,
    createdAt: first.createdAt,
    items: items.sort((left, right) => left.ordinal - right.ordinal),
  };
}

export function parsePlatformAiFactValue(
  key: PlatformAiFactKey,
  value: unknown,
): string | readonly string[] | null {
  if (typeof value !== "string") return null;
  if (isListFactKey(key)) {
    const entries = value
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    try {
      return parseFactList(entries);
    } catch {
      return null;
    }
  }
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 500 ? normalized : null;
}

type SharedMutationInput = Readonly<{
  organizationId: string;
  conversationId: string;
  requestId: string;
}>;

function rpcShared(input: SharedMutationInput) {
  return {
    p_organization_id: parseUuid(input.organizationId),
    p_conversation_id: parseUuid(input.conversationId),
    p_request_id: parseUuid(input.requestId),
  };
}

function inputText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") invalidShape();
  return parseText(value.trim(), maxLength);
}

export type PlatformAiMemoryMutationInput = SharedMutationInput &
  Readonly<{
    expectedVersion: string;
    shortSummary: string;
    longSummary: string;
    sourceMessageId: string;
    reason: string;
  }>;

export function buildPlatformAiMemoryRpcArgs(input: PlatformAiMemoryMutationInput) {
  return {
    ...rpcShared(input),
    p_expected_version: parseVersion(input.expectedVersion),
    p_short_summary: inputText(input.shortSummary, 1_000),
    p_long_summary: inputText(input.longSummary, 6_000),
    p_source_message_id: parseUuid(input.sourceMessageId),
    p_reason: inputText(input.reason, 500),
  };
}

export type PlatformAiFactMutationInput = SharedMutationInput &
  Readonly<{
    key: PlatformAiFactKey;
    expectedVersion: string;
    status: "active" | "retracted";
    value: string | readonly string[] | null;
    sourceMessageId: string;
    reason: string;
  }>;

export function buildPlatformAiFactRpcArgs(input: PlatformAiFactMutationInput) {
  if (!isFactKey(input.key)) invalidShape();
  if (input.status !== "active" && input.status !== "retracted") invalidShape();
  let value: PlatformAiFactMutationInput["value"];
  if (input.status === "retracted") {
    if (input.value !== null) invalidShape();
    value = null;
  } else if (isListFactKey(input.key)) {
    value = parseFactList(input.value);
  } else {
    value = parseText(input.value, 500);
  }
  return {
    ...rpcShared(input),
    p_fact_key: input.key,
    p_expected_version: parseVersion(input.expectedVersion),
    p_status: input.status,
    p_value: value,
    p_source_message_id: parseUuid(input.sourceMessageId),
    p_reason: inputText(input.reason, 500),
  };
}

export type PlatformAiQualificationMutationInput = SharedMutationInput &
  Readonly<{
    expectedVersion: string;
    status: PlatformAiQualificationState;
    completeness: number;
    missingFactKeys: readonly PlatformAiFactKey[];
    notes: string | null;
    sourceMessageId: string;
    reason: string;
  }>;

export function buildPlatformAiQualificationRpcArgs(
  input: PlatformAiQualificationMutationInput,
) {
  if (!(PLATFORM_AI_QUALIFICATION_STATES as readonly string[]).includes(input.status)) {
    invalidShape();
  }
  if (
    !Number.isInteger(input.completeness) ||
    input.completeness < 0 ||
    input.completeness > 100
  ) {
    invalidShape();
  }
  const missingFactKeys = parseFactKeyList(input.missingFactKeys);
  if (
    input.status === "staff_confirmed" &&
    (input.completeness !== 100 || missingFactKeys.length !== 0)
  ) {
    invalidShape();
  }
  return {
    ...rpcShared(input),
    p_expected_version: parseVersion(input.expectedVersion),
    p_status: input.status,
    p_completeness: input.completeness,
    p_missing_fact_keys: [...missingFactKeys],
    p_notes: input.notes === null ? null : inputText(input.notes, 2_000),
    p_source_message_id: parseUuid(input.sourceMessageId),
    p_reason: inputText(input.reason, 500),
  };
}

export type PlatformAiControlMutationInput = SharedMutationInput &
  Readonly<{
    expectedVersion: string;
    state: PlatformAiControlState;
    reason: string;
  }>;

export function buildPlatformAiControlRpcArgs(input: PlatformAiControlMutationInput) {
  if (!(PLATFORM_AI_CONTROL_STATES as readonly string[]).includes(input.state)) {
    invalidShape();
  }
  return {
    ...rpcShared(input),
    p_expected_version: parseVersion(input.expectedVersion),
    p_state: input.state,
    p_reason: inputText(input.reason, 500),
  };
}

export type PlatformAiLexicalPreviewInput = SharedMutationInput &
  Readonly<{
    sourceMessageId: string;
    limit: number;
    reason: string;
  }>;

export function buildPlatformAiLexicalPreviewRpcArgs(
  input: PlatformAiLexicalPreviewInput,
) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) {
    invalidShape();
  }
  return {
    ...rpcShared(input),
    p_source_message_ref: parseUuid(input.sourceMessageId),
    p_limit: input.limit,
    p_reason: inputText(input.reason, 500),
  };
}
