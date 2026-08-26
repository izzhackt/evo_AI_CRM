import "server-only";

import {
  PLATFORM_GEMINI_HANDOFF_REASONS,
  PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION,
  PLATFORM_GEMINI_PROPOSAL_FACT_KEYS,
  PLATFORM_GEMINI_PROPOSAL_INTENTS,
  PLATFORM_GEMINI_PROPOSAL_QUALIFICATION_STATES,
  PLATFORM_GEMINI_PROPOSAL_RISKS,
  PLATFORM_GEMINI_PROPOSAL_UNCERTAINTY,
  normalizePlatformGeminiProposalPayload,
  type PlatformGeminiProposalSchemaVersion,
  type PlatformGeminiProposalUncertainty,
  type PlatformGeminiFailureCode,
  type PlatformGeminiHandoffReason,
  type PlatformGeminiProposalFactKey,
  type PlatformGeminiProposalIntent,
  type PlatformGeminiProposalQualificationState,
  type PlatformGeminiProposalRisk,
} from "../platform-gemini-proposals.ts";

const TOP_LEVEL_KEYS = [
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
] as const;
const V2_OPTIONAL_KEYS = [
  "summary",
  "next_action",
  "draft_internal_note",
  "missing_document_suggestion",
  "deadline_warning",
  "limitations",
  "uncertainty",
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

const UNSAFE_EXTERNAL_OUTCOME_PATTERNS = [
  /\b(?:we\s+)?guarantee(?:d|s|ing)?\b.{0,80}\b(?:admission|scholarship|visa)\b/iu,
  /\b100\s*%\b.{0,80}\b(?:admission|scholarship|visa)\b/iu,
  /\b(?:admission|scholarship|visa)\b.{0,80}\b(?:is|are|will\s+be)\s+guaranteed\b/iu,
  /гарант(?:ируем|ирует|ирован|ирована|ировано|ированы).{0,80}(?:поступлен|стипенди|виз)/iu,
  /100\s*%.{0,80}(?:поступлен|стипенди|виз)/iu,
] as const;

export type PlatformGeminiProposalEvidence = Readonly<{
  knowledge_key: string;
  knowledge_version: number;
  evidence_ordinal: number;
  content_text?: string;
}>;

export type PlatformGeminiProposalPayload = Readonly<{
  schema_version: PlatformGeminiProposalSchemaVersion;
  language: "ru" | "en";
  intent: PlatformGeminiProposalIntent;
  confidence: number;
  risk: PlatformGeminiProposalRisk;
  handoff_required: boolean;
  handoff_reasons: readonly PlatformGeminiHandoffReason[];
  citations: readonly Readonly<{
    knowledge_key: string;
    knowledge_version: number;
    evidence_ordinal: number;
  }>[];
  memory_changes: readonly Readonly<{
    fact_key: PlatformGeminiProposalFactKey;
    action: "set" | "clear";
    value: string | null;
    confidence: number;
  }>[];
  qualification: Readonly<{
    status: PlatformGeminiProposalQualificationState;
    completeness: number;
    missing_fact_keys: readonly PlatformGeminiProposalFactKey[];
    notes: string | null;
  }>;
  reply_text: string;
  summary: string | null;
  next_action: string | null;
  draft_internal_note: string | null;
  missing_document_suggestion: string | null;
  deadline_warning: string | null;
  limitations: readonly string[];
  uncertainty: PlatformGeminiProposalUncertainty | null;
}>;

export class PlatformGeminiProposalValidationError extends Error {
  readonly code: Extract<
    PlatformGeminiFailureCode,
    | "empty_response"
    | "malformed_response"
    | "unsupported_language"
    | "invalid_proposal"
    | "missing_evidence"
    | "unsafe_semantics"
  >;

  constructor(code: PlatformGeminiProposalValidationError["code"]) {
    super("Gemini proposal output is not acceptable.");
    this.name = "PlatformGeminiProposalValidationError";
    this.code = code;
  }
}

function invalid(
  code: PlatformGeminiProposalValidationError["code"] = "invalid_proposal",
): never {
  throw new PlatformGeminiProposalValidationError(code);
}

export const PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [...TOP_LEVEL_KEYS, ...V2_OPTIONAL_KEYS],
  properties: {
    schema_version: {
      type: "integer",
      enum: [PLATFORM_GEMINI_PROPOSAL_CURRENT_SCHEMA_VERSION],
    },
    language: { type: "string", enum: ["ru", "en"] },
    intent: { type: "string", enum: [...PLATFORM_GEMINI_PROPOSAL_INTENTS] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    risk: { type: "string", enum: [...PLATFORM_GEMINI_PROPOSAL_RISKS] },
    handoff_required: { type: "boolean" },
    handoff_reasons: {
      type: "array",
      maxItems: 8,
      items: { type: "string", enum: [...PLATFORM_GEMINI_HANDOFF_REASONS] },
    },
    citations: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [...CITATION_KEYS],
        properties: {
          knowledge_key: { type: "string" },
          knowledge_version: { type: "integer", minimum: 1 },
          evidence_ordinal: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
    },
    memory_changes: {
      type: "array",
      maxItems: PLATFORM_GEMINI_PROPOSAL_FACT_KEYS.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: [...MEMORY_CHANGE_KEYS],
        properties: {
          fact_key: {
            type: "string",
            enum: [...PLATFORM_GEMINI_PROPOSAL_FACT_KEYS],
          },
          action: { type: "string", enum: ["set", "clear"] },
          value: { type: ["string", "null"] },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
    qualification: {
      type: "object",
      additionalProperties: false,
      required: [...QUALIFICATION_KEYS],
      properties: {
        status: {
          type: "string",
          enum: [...PLATFORM_GEMINI_PROPOSAL_QUALIFICATION_STATES],
        },
        completeness: { type: "integer", minimum: 0, maximum: 100 },
        missing_fact_keys: {
          type: "array",
          maxItems: PLATFORM_GEMINI_PROPOSAL_FACT_KEYS.length,
          items: {
            type: "string",
            enum: [...PLATFORM_GEMINI_PROPOSAL_FACT_KEYS],
          },
        },
        notes: { type: ["string", "null"] },
      },
    },
    reply_text: { type: "string" },
    summary: { type: "string", maxLength: 2000 },
    next_action: { type: "string", maxLength: 1000 },
    draft_internal_note: { type: "string", maxLength: 4000 },
    missing_document_suggestion: { type: ["string", "null"], maxLength: 1000 },
    deadline_warning: { type: ["string", "null"], maxLength: 1000 },
    limitations: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", maxLength: 500 },
      uniqueItems: true,
    },
    uncertainty: {
      type: "string",
      enum: [...PLATFORM_GEMINI_PROPOSAL_UNCERTAINTY],
    },
  },
} as const);

export function parsePlatformGeminiProposal(
  outputText: string,
  input: Readonly<{ evidence: readonly PlatformGeminiProposalEvidence[] }>,
): PlatformGeminiProposalPayload {
  if (typeof outputText !== "string" || outputText.trim().length === 0) {
    return invalid("empty_response");
  }
  if (outputText.length > 32_768) return invalid("invalid_proposal");

  let decoded: unknown;
  try {
    decoded = JSON.parse(outputText);
  } catch {
    return invalid("malformed_response");
  }
  const normalized = normalizePlatformGeminiProposalPayload(
    decoded,
    input.evidence.map((item) => ({
      knowledgeKey: item.knowledge_key,
      knowledgeVersion: item.knowledge_version,
      evidenceOrdinal: item.evidence_ordinal,
    })),
  );
  const replyText = normalized.replyText;
  if (UNSAFE_EXTERNAL_OUTCOME_PATTERNS.some((pattern) => pattern.test(replyText))) {
    return invalid("unsafe_semantics");
  }

  return {
    schema_version: normalized.schemaVersion,
    language: normalized.language,
    intent: normalized.intent,
    confidence: normalized.confidence,
    risk: normalized.risk,
    handoff_required: normalized.handoffRequired,
    handoff_reasons: normalized.handoffReasons,
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
      missing_fact_keys: normalized.qualification.missingFactKeys,
      notes: normalized.qualification.notes,
    },
    reply_text: replyText,
    summary: normalized.summary,
    next_action: normalized.nextAction,
    draft_internal_note: normalized.draftInternalNote,
    missing_document_suggestion: normalized.missingDocumentSuggestion,
    deadline_warning: normalized.deadlineWarning,
    limitations: normalized.limitations,
    uncertainty: normalized.uncertainty,
  };
}
