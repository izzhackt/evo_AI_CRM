import "server-only";

import {
  PLATFORM_GEMINI_HANDOFF_REASONS,
  PLATFORM_GEMINI_PROPOSAL_FACT_KEYS,
  PLATFORM_GEMINI_PROPOSAL_INTENTS,
  PLATFORM_GEMINI_PROPOSAL_QUALIFICATION_STATES,
  PLATFORM_GEMINI_PROPOSAL_RISKS,
  PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION,
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
  schema_version: typeof PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid();
  }
  return value;
}

function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
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

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) return invalid();
  return value as T[number];
}

function uniqueEnums<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  maximum: number,
): readonly T[number][] {
  if (!Array.isArray(value) || value.length > maximum) return invalid();
  const result = value.map((item) => enumValue(item, allowed));
  if (new Set(result).size !== result.length) return invalid();
  return result;
}

function parseCitations(
  value: unknown,
  evidence: readonly PlatformGeminiProposalEvidence[],
): PlatformGeminiProposalPayload["citations"] {
  if (!Array.isArray(value) || value.length > 6) return invalid();
  const allowedEvidence = new Set(
    evidence.map(
      (item) =>
        `${item.knowledge_key}\u0000${item.knowledge_version}\u0000${item.evidence_ordinal}`,
    ),
  );
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || !exactKeys(item, CITATION_KEYS)) return invalid();
    const citation = {
      knowledge_key: text(item.knowledge_key, 160),
      knowledge_version: integer(item.knowledge_version, 1, 2_147_483_647),
      evidence_ordinal: integer(item.evidence_ordinal, 1, 10),
    };
    const key = `${citation.knowledge_key}\u0000${citation.knowledge_version}\u0000${citation.evidence_ordinal}`;
    if (seen.has(key)) return invalid();
    seen.add(key);
    if (!allowedEvidence.has(key)) return invalid("missing_evidence");
    return citation;
  });
}

function parseMemoryChanges(
  value: unknown,
): PlatformGeminiProposalPayload["memory_changes"] {
  if (!Array.isArray(value) || value.length > 9) return invalid();
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || !exactKeys(item, MEMORY_CHANGE_KEYS)) return invalid();
    const action = enumValue(item.action, ["set", "clear"] as const);
    const parsedValue = optionalText(item.value, 500);
    if (
      (action === "set" && parsedValue === null) ||
      (action === "clear" && parsedValue !== null)
    ) {
      return invalid();
    }
    const factKey = enumValue(item.fact_key, PLATFORM_GEMINI_PROPOSAL_FACT_KEYS);
    if (seen.has(factKey)) return invalid();
    seen.add(factKey);
    return {
      fact_key: factKey,
      action,
      value: parsedValue,
      confidence: integer(item.confidence, 0, 100),
    };
  });
}

function parseQualification(
  value: unknown,
): PlatformGeminiProposalPayload["qualification"] {
  if (!isRecord(value) || !exactKeys(value, QUALIFICATION_KEYS)) return invalid();
  return {
    status: enumValue(
      value.status,
      PLATFORM_GEMINI_PROPOSAL_QUALIFICATION_STATES,
    ),
    completeness: integer(value.completeness, 0, 100),
    missing_fact_keys: uniqueEnums(
      value.missing_fact_keys,
      PLATFORM_GEMINI_PROPOSAL_FACT_KEYS,
      9,
    ),
    notes: optionalText(value.notes, 2_000),
  };
}

export const PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [...TOP_LEVEL_KEYS],
  properties: {
    schema_version: { type: "integer", enum: [1] },
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
      maxItems: 9,
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
          maxItems: 9,
          items: {
            type: "string",
            enum: [...PLATFORM_GEMINI_PROPOSAL_FACT_KEYS],
          },
        },
        notes: { type: ["string", "null"] },
      },
    },
    reply_text: { type: "string" },
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
  if (!isRecord(decoded) || !exactKeys(decoded, TOP_LEVEL_KEYS)) return invalid();
  if (decoded.schema_version !== PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION) {
    return invalid();
  }
  if (decoded.language !== "ru" && decoded.language !== "en") {
    return invalid("unsupported_language");
  }
  if (typeof decoded.handoff_required !== "boolean") return invalid();
  const handoffReasons = uniqueEnums(
    decoded.handoff_reasons,
    PLATFORM_GEMINI_HANDOFF_REASONS,
    8,
  );
  if (
    (!decoded.handoff_required && handoffReasons.length !== 0) ||
    (decoded.handoff_required && handoffReasons.length === 0)
  ) {
    return invalid();
  }
  const replyText = text(decoded.reply_text, 2_000);
  if (UNSAFE_EXTERNAL_OUTCOME_PATTERNS.some((pattern) => pattern.test(replyText))) {
    return invalid("unsafe_semantics");
  }

  return {
    schema_version: PLATFORM_GEMINI_PROPOSAL_SCHEMA_VERSION,
    language: decoded.language,
    intent: enumValue(decoded.intent, PLATFORM_GEMINI_PROPOSAL_INTENTS),
    confidence: integer(decoded.confidence, 0, 100),
    risk: enumValue(decoded.risk, PLATFORM_GEMINI_PROPOSAL_RISKS),
    handoff_required: decoded.handoff_required,
    handoff_reasons: handoffReasons,
    citations: parseCitations(decoded.citations, input.evidence),
    memory_changes: parseMemoryChanges(decoded.memory_changes),
    qualification: parseQualification(decoded.qualification),
    reply_text: replyText,
  };
}
