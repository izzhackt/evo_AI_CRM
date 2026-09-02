import "server-only";

import { GoogleGenAI } from "@google/genai";

export type PlatformGeminiSdkResponse = Readonly<{
  text?: unknown;
  responseId?: unknown;
  modelVersion?: unknown;
  usageMetadata?: unknown;
  candidates?: unknown;
}>;

export type PlatformGeminiSdkClient = Readonly<{
  models: Readonly<{
    generateContent(request: Readonly<Record<string, unknown>>): Promise<PlatformGeminiSdkResponse>;
  }>;
}>;

export type PlatformGeminiProviderDependencies = Readonly<{
  createClient(apiKey: string): PlatformGeminiSdkClient;
}>;

export type PlatformGeminiProviderInput = Readonly<{
  model: string;
  prompt: string;
  responseJsonSchema: Readonly<Record<string, unknown>>;
  timeoutMs: number;
  maxOutputTokens: number;
  temperature: number;
}>;

export type PlatformGeminiProviderFailureCode =
  | "configuration_missing"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_authentication_failed"
  | "provider_forbidden"
  | "provider_unavailable"
  | "provider_rejected"
  | "empty_response"
  | "output_truncated"
  | "malformed_response"
  | "invalid_proposal";

export class PlatformGeminiProviderError extends Error {
  readonly code: PlatformGeminiProviderFailureCode;
  readonly providerInteractionRef: string | null;

  constructor(
    code: PlatformGeminiProviderFailureCode,
    providerInteractionRef: string | null = null,
  ) {
    super("Gemini proposal provider request failed.");
    this.name = "PlatformGeminiProviderError";
    this.code = code;
    this.providerInteractionRef = providerInteractionRef;
  }
}

export type PlatformGeminiCitation = Readonly<{
  knowledge_key: string;
  knowledge_version: number;
  evidence_ordinal: number;
}>;

export type PlatformGeminiMemoryChange = Readonly<{
  fact_key:
    | "preferred_country"
    | "preferred_program"
    | "budget_signal"
    | "intake_target"
    | "preferred_language"
    | "urgency"
    | "blockers"
    | "promised_follow_up"
    | "unanswered_questions";
  action: "set" | "clear";
  value: string | null;
  confidence: number;
}>;

export type PlatformGeminiProposalV2 = Readonly<{
  schema_version: 2;
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
    missing_fact_keys: readonly PlatformGeminiMemoryChange["fact_key"][];
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

export type PlatformGeminiProviderResult = Readonly<{
  providerInteractionRef: string;
  providerStatus: "completed";
  responseJson: PlatformGeminiProposalV2;
  evidence: Readonly<{
    responseId: string;
    modelVersion: string | null;
    usage: Readonly<Record<string, number>> | null;
  }>;
}>;

const USAGE_COUNT_KEYS = Object.freeze([
  "cachedContentTokenCount",
  "candidatesTokenCount",
  "promptTokenCount",
  "thoughtsTokenCount",
  "toolUsePromptTokenCount",
  "totalTokenCount",
] as const);

const PROPOSAL_KEYS = Object.freeze([
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
] as const);
const LANGUAGES = new Set(["ru", "en"]);
const INTENTS = new Set([
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
]);
const RISK_LEVELS = new Set(["low", "medium", "high"]);
const HANDOFF_REASONS = new Set([
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
]);
const FACT_KEYS = new Set<PlatformGeminiMemoryChange["fact_key"]>([
  "preferred_country",
  "preferred_program",
  "budget_signal",
  "intake_target",
  "preferred_language",
  "urgency",
  "blockers",
  "promised_follow_up",
  "unanswered_questions",
]);
const QUALIFICATION_STATUSES = new Set([
  "collecting",
  "ready_for_staff_review",
  "not_a_fit",
]);
const KNOWLEDGE_KEY_PATTERN = /^[a-z][a-z0-9_.-]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function isTrimmedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    characterLength(value) >= minimum &&
    characterLength(value) <= maximum
  );
}

function isIntegerBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isOneOf<Value extends string>(
  value: unknown,
  values: ReadonlySet<Value>,
): value is Value {
  return typeof value === "string" && values.has(value as Value);
}

function parseUniqueStrings(
  value: unknown,
  allowed: ReadonlySet<string> | null,
  minimumItems: number,
  maximumItems: number,
  maximumCharacters: number | null = null,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > maximumItems) {
    return null;
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      (allowed !== null && !allowed.has(item)) ||
      (maximumCharacters !== null && !isTrimmedString(item, 1, maximumCharacters)) ||
      seen.has(item)
    ) {
      return null;
    }
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

function parseCitations(value: unknown): readonly PlatformGeminiCitation[] | null {
  if (!Array.isArray(value) || value.length > 6) return null;
  const seen = new Set<string>();
  const citations: PlatformGeminiCitation[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["knowledge_key", "knowledge_version", "evidence_ordinal"]) ||
      typeof item.knowledge_key !== "string" ||
      !KNOWLEDGE_KEY_PATTERN.test(item.knowledge_key) ||
      !isIntegerBetween(item.knowledge_version, 1, Number.MAX_SAFE_INTEGER) ||
      !isIntegerBetween(item.evidence_ordinal, 1, 10)
    ) {
      return null;
    }
    const identity = `${item.knowledge_key}:${item.knowledge_version}:${item.evidence_ordinal}`;
    if (seen.has(identity)) return null;
    seen.add(identity);
    citations.push(Object.freeze({
      knowledge_key: item.knowledge_key,
      knowledge_version: item.knowledge_version,
      evidence_ordinal: item.evidence_ordinal,
    }));
  }
  return Object.freeze(citations);
}

function parseMemoryChanges(value: unknown): readonly PlatformGeminiMemoryChange[] | null {
  if (!Array.isArray(value) || value.length > 9) return null;
  const seen = new Set<string>();
  const changes: PlatformGeminiMemoryChange[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["fact_key", "action", "value", "confidence"]) ||
      !isOneOf(item.fact_key, FACT_KEYS) ||
      (item.action !== "set" && item.action !== "clear") ||
      !isIntegerBetween(item.confidence, 0, 100) ||
      seen.has(item.fact_key) ||
      (item.action === "set" && !isTrimmedString(item.value, 1, 500)) ||
      (item.action === "clear" && item.value !== null)
    ) {
      return null;
    }
    seen.add(item.fact_key);
    changes.push(Object.freeze({
      fact_key: item.fact_key,
      action: item.action,
      value: item.value as string | null,
      confidence: item.confidence,
    }));
  }
  return Object.freeze(changes);
}

function parseQualification(value: unknown): PlatformGeminiProposalV2["qualification"] | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["status", "completeness", "missing_fact_keys", "notes"]) ||
    !isOneOf(value.status, QUALIFICATION_STATUSES) ||
    !isIntegerBetween(value.completeness, 0, 100) ||
    !(
      value.notes === null ||
      isTrimmedString(value.notes, 1, 1_000)
    )
  ) {
    return null;
  }
  const missingFactKeys = parseUniqueStrings(value.missing_fact_keys, FACT_KEYS, 0, 9);
  if (missingFactKeys === null) return null;
  return Object.freeze({
    status: value.status as PlatformGeminiProposalV2["qualification"]["status"],
    completeness: value.completeness,
    missing_fact_keys:
      missingFactKeys as readonly PlatformGeminiMemoryChange["fact_key"][],
    notes: value.notes,
  });
}

export function parsePlatformGeminiProposalV2(
  value: unknown,
): PlatformGeminiProposalV2 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PROPOSAL_KEYS) ||
    value.schema_version !== 2 ||
    !isOneOf(value.language, LANGUAGES) ||
    !isOneOf(value.intent, INTENTS) ||
    !isIntegerBetween(value.confidence, 0, 100) ||
    !isOneOf(value.risk, RISK_LEVELS) ||
    typeof value.handoff_required !== "boolean" ||
    !isTrimmedString(value.reply_text, 1, 2_000) ||
    !isTrimmedString(value.summary, 1, 2_000) ||
    !isTrimmedString(value.next_action, 1, 1_000) ||
    !isTrimmedString(value.draft_internal_note, 1, 4_000) ||
    !(value.missing_document_suggestion === null ||
      isTrimmedString(value.missing_document_suggestion, 1, 1_000)) ||
    !(value.deadline_warning === null || isTrimmedString(value.deadline_warning, 1, 1_000)) ||
    !isOneOf(value.uncertainty, RISK_LEVELS)
  ) {
    throw new PlatformGeminiProviderError("invalid_proposal");
  }

  const handoffReasons = parseUniqueStrings(value.handoff_reasons, HANDOFF_REASONS, 0, 8);
  const citations = parseCitations(value.citations);
  const memoryChanges = parseMemoryChanges(value.memory_changes);
  const qualification = parseQualification(value.qualification);
  const limitations = parseUniqueStrings(value.limitations, null, 1, 8, 500);
  if (
    handoffReasons === null ||
    citations === null ||
    memoryChanges === null ||
    qualification === null ||
    limitations === null ||
    (value.handoff_required && handoffReasons.length === 0) ||
    (!value.handoff_required && handoffReasons.length !== 0)
  ) {
    throw new PlatformGeminiProviderError("invalid_proposal");
  }

  return Object.freeze({
    schema_version: 2,
    language: value.language as PlatformGeminiProposalV2["language"],
    intent: value.intent as PlatformGeminiProposalV2["intent"],
    confidence: value.confidence,
    risk: value.risk as PlatformGeminiProposalV2["risk"],
    handoff_required: value.handoff_required,
    handoff_reasons: handoffReasons,
    citations,
    memory_changes: memoryChanges,
    qualification,
    reply_text: value.reply_text,
    summary: value.summary,
    next_action: value.next_action,
    draft_internal_note: value.draft_internal_note,
    missing_document_suggestion: value.missing_document_suggestion,
    deadline_warning: value.deadline_warning,
    limitations,
    uncertainty: value.uncertainty as PlatformGeminiProposalV2["uncertainty"],
  });
}

function defaultCreateClient(apiKey: string): PlatformGeminiSdkClient {
  return new GoogleGenAI({ apiKey }) as unknown as PlatformGeminiSdkClient;
}

function parseReference(value: unknown): string | null {
  return isTrimmedString(value, 1, 255) ? value : null;
}

function parseUsageEvidence(
  value: unknown,
  providerInteractionRef: string,
): Readonly<Record<string, number>> | null {
  if (value === undefined) return null;
  if (!isRecord(value)) {
    throw new PlatformGeminiProviderError(
      "malformed_response",
      providerInteractionRef,
    );
  }
  const usage: Record<string, number> = {};
  for (const key of USAGE_COUNT_KEYS) {
    const count = value[key];
    if (count === undefined) continue;
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new PlatformGeminiProviderError(
        "malformed_response",
        providerInteractionRef,
      );
    }
    usage[key] = count as number;
  }
  return Object.freeze(usage);
}

function providerHttpStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  for (const value of [error.status, error.statusCode]) {
    if (Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599) {
      return value as number;
    }
  }
  return null;
}

function mapProviderFailure(error: unknown): PlatformGeminiProviderError {
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /(?:abort|timeout)/iu.test(error.name))
  ) {
    return new PlatformGeminiProviderError("provider_timeout");
  }
  const status = providerHttpStatus(error);
  if (status === 408) return new PlatformGeminiProviderError("provider_timeout");
  if (status === 401) return new PlatformGeminiProviderError("provider_authentication_failed");
  if (status === 403) return new PlatformGeminiProviderError("provider_forbidden");
  if (status === 429) return new PlatformGeminiProviderError("provider_rate_limited");
  if (status !== null && status >= 500) {
    return new PlatformGeminiProviderError("provider_unavailable");
  }
  if (status !== null && status >= 400) {
    return new PlatformGeminiProviderError("provider_rejected");
  }
  return new PlatformGeminiProviderError("provider_unavailable");
}

function providerInputIsValid(input: PlatformGeminiProviderInput): boolean {
  if (
    !isTrimmedString(input.model, 1, 255) ||
    !isTrimmedString(input.prompt, 1, 65_536) ||
    !isRecord(input.responseJsonSchema) ||
    !isIntegerBetween(input.timeoutMs, 1, 120_000) ||
    !isIntegerBetween(input.maxOutputTokens, 1, 65_536) ||
    !Number.isFinite(input.temperature) ||
    input.temperature < 0 ||
    input.temperature > 2
  ) {
    return false;
  }
  try {
    const encodedSchema = JSON.stringify(input.responseJsonSchema);
    return isTrimmedString(encodedSchema, 2, 32_768);
  } catch {
    return false;
  }
}

export function createPlatformGeminiProvider(
  apiKey: string,
  dependencies: PlatformGeminiProviderDependencies = Object.freeze({
    createClient: defaultCreateClient,
  }),
) {
  if (!isTrimmedString(apiKey, 16, 4_096)) {
    throw new PlatformGeminiProviderError("configuration_missing");
  }
  const client = dependencies.createClient(apiKey);

  return Object.freeze({
    async generateStructuredProposal(
      input: PlatformGeminiProviderInput,
    ): Promise<PlatformGeminiProviderResult> {
      if (!providerInputIsValid(input)) {
        throw new PlatformGeminiProviderError("configuration_missing");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const response = await client.models.generateContent({
          model: input.model,
          contents: input.prompt,
          config: {
            abortSignal: controller.signal,
            candidateCount: 1,
            maxOutputTokens: input.maxOutputTokens,
            temperature: input.temperature,
            responseMimeType: "application/json",
            responseJsonSchema: input.responseJsonSchema,
            httpOptions: {
              timeout: input.timeoutMs,
              retryOptions: { attempts: 1 },
            },
          },
        });
        const providerInteractionRef = parseReference(response.responseId);
        if (providerInteractionRef === null) {
          throw new PlatformGeminiProviderError("malformed_response");
        }
        const modelVersion =
          response.modelVersion === undefined
            ? null
            : parseReference(response.modelVersion);
        if (response.modelVersion !== undefined && modelVersion === null) {
          throw new PlatformGeminiProviderError(
            "malformed_response",
            providerInteractionRef,
          );
        }
        const usage = parseUsageEvidence(
          response.usageMetadata,
          providerInteractionRef,
        );
        if (
          Array.isArray(response.candidates) &&
          response.candidates.some(
            (candidate) =>
              isRecord(candidate) && candidate.finishReason === "MAX_TOKENS",
          )
        ) {
          throw new PlatformGeminiProviderError(
            "output_truncated",
            providerInteractionRef,
          );
        }
        if (
          Array.isArray(response.candidates) &&
          response.candidates.some(
            (candidate) =>
              isRecord(candidate) &&
              typeof candidate.finishReason === "string" &&
              candidate.finishReason !== "STOP",
          )
        ) {
          throw new PlatformGeminiProviderError(
            "provider_rejected",
            providerInteractionRef,
          );
        }
        if (typeof response.text !== "string" || response.text.trim().length === 0) {
          throw new PlatformGeminiProviderError(
            "empty_response",
            providerInteractionRef,
          );
        }
        if (characterLength(response.text) > 32_768) {
          throw new PlatformGeminiProviderError(
            "malformed_response",
            providerInteractionRef,
          );
        }
        let responseJson: PlatformGeminiProposalV2;
        try {
          responseJson = parsePlatformGeminiProposalV2(
            JSON.parse(response.text as string) as unknown,
          );
        } catch (error) {
          if (error instanceof PlatformGeminiProviderError) {
            throw new PlatformGeminiProviderError(
              error.code,
              providerInteractionRef,
            );
          }
          throw new PlatformGeminiProviderError(
            "malformed_response",
            providerInteractionRef,
          );
        }
        return Object.freeze({
          providerInteractionRef,
          providerStatus: "completed" as const,
          responseJson,
          evidence: Object.freeze({
            responseId: providerInteractionRef,
            modelVersion,
            usage,
          }),
        });
      } catch (error) {
        if (error instanceof PlatformGeminiProviderError) throw error;
        throw mapProviderFailure(error);
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
