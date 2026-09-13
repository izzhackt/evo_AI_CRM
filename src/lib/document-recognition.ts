import { PROFILE_FIELDS, PROFILE_FIELD_BY_KEY, PROFILE_FIELD_KEYS, isProfileFieldKey, type ProfileFieldKey } from "./student-profile-fields.ts";

// Pure shared contract only: no authorization, I/O, provider dispatch or profile writes.
export const DOCUMENT_RECOGNITION_LIMITS = Object.freeze({
  maxSourceBytes: 25 * 1024 * 1024, maxPdfPages: 20, maxCandidates: 61,
  maxSnippetCodePoints: 240, maxWarnings: 16, maxWarningCodePoints: 240,
  maxResultBytes: 256 * 1024, maxOutputTokens: 6000,
});
export const DOCUMENT_RECOGNITION_STATES = Object.freeze([
  "queued", "preflight", "uploading", "file_processing", "generating", "result_saved", "review_ready",
  "failed", "upload_unknown", "generation_unknown", "publication_blocked", "cancelled",
] as const);
export const DOCUMENT_RECOGNITION_CLEANUP_STATES = Object.freeze([
  "not_uploaded", "pending", "deleting", "confirmed_absent", "unknown",
] as const);
export const DOCUMENT_RECOGNITION_REQUEST_ERROR_CODES = Object.freeze([
  "invalid_request", "unavailable", "profile_changed", "request_conflict", "equivalent_job_active",
  "document_not_eligible", "profile_not_started", "budget_exhausted", "provider_not_configured",
] as const);
export const DOCUMENT_RECOGNITION_FAILURE_CODES = Object.freeze([
  "document_not_eligible", "profile_not_started", "provider_not_configured", "budget_exhausted",
  "access_revoked", "source_changed", "source_unavailable", "provider_rejected", "provider_unavailable",
  "invalid_result", "upload_unknown", "generation_unknown", "publication_blocked", "cancelled",
] as const);
export type DocumentRecognitionState = (typeof DOCUMENT_RECOGNITION_STATES)[number];
export type DocumentRecognitionCleanupState = (typeof DOCUMENT_RECOGNITION_CLEANUP_STATES)[number];
export type DocumentRecognitionFailureCode = (typeof DOCUMENT_RECOGNITION_FAILURE_CODES)[number];
export type DocumentRecognitionRequestErrorCode = (typeof DOCUMENT_RECOGNITION_REQUEST_ERROR_CODES)[number];
type ValidationCode = "invalid_request" | "invalid_job" | "invalid_result" | "invalid_fingerprint";
export class DocumentRecognitionValidationError extends Error {
  readonly code: ValidationCode;
  constructor(code: ValidationCode) {
    super("Invalid document recognition data");
    this.name = "DocumentRecognitionValidationError";
    this.code = code;
  }
}

export type DocumentRecognitionRequest = Readonly<{
  source_version_id: string; expected_profile_revision: number; request_id: string; retry_of_job_id: string | null;
}>;
export type DocumentRecognitionReceipt = Readonly<{ job_id: string; state: DocumentRecognitionState; replayed: boolean }>;
export type DocumentRecognitionJob = Readonly<{
  job_id: string; source_version_id: string; state: DocumentRecognitionState;
  cleanup_state: DocumentRecognitionCleanupState; proposal_count: number;
  failure_code: DocumentRecognitionFailureCode | null; updated_at: string;
}>;
export type DocumentRecognitionCandidate = Readonly<{
  key: ProfileFieldKey; value: string; source_page: number | null;
  source_snippet: string | null; confidence: number | null;
}>;
export type DocumentRecognitionResult = Readonly<{
  candidates: readonly DocumentRecognitionCandidate[]; warnings: readonly string[];
}>;
export type DocumentRecognitionSource = Readonly<{
  mime_type: "application/pdf" | "image/jpeg" | "image/png"; page_count: number;
}>;
export type DocumentRecognitionFingerprintInput = Readonly<{
  organization_id: string; student_case_id: string; student_profile_id: string;
  source_document_slot_id: string; source_version_id: string;
  source_sha256: string; source_bytes: number; source_mime: DocumentRecognitionSource["mime_type"]; source_pages: number;
  actor_auth_user_id: string; actor_membership_id: string;
  purpose: "student_profile"; extraction_mode: "student_profile_fields";
  registry_version: string; schema_version: number; prompt_policy_version: string;
  config_version: string; provider_project_id: string; model: string;
  expected_profile_revision: number; retry_of_job_id: string | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
const FINGERPRINT_KEYS = [
  "organization_id", "student_case_id", "student_profile_id", "source_document_slot_id", "source_version_id",
  "source_sha256", "source_bytes", "source_mime", "source_pages", "actor_auth_user_id", "actor_membership_id",
  "purpose", "extraction_mode", "registry_version", "schema_version", "prompt_policy_version", "config_version",
  "provider_project_id", "model", "expected_profile_revision", "retry_of_job_id",
] as const;

function fail(code: ValidationCode): never { throw new DocumentRecognitionValidationError(code); }
function exact(value: unknown, keys: readonly string[], code: ValidationCode): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail(code);
  const found = Reflect.ownKeys(value);
  if (found.length !== keys.length || found.some(key => typeof key !== "string" || !keys.includes(key))) return fail(code);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return fail(code);
  }
  return value as Record<string, unknown>;
}
function uuid(value: unknown, code: ValidationCode): string {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : fail(code);
}
function integer(value: unknown, min: number, max: number, code: ValidationCode): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail(code);
}
function oneOf<const Values extends readonly string[]>(value: unknown, values: Values, code: ValidationCode): Values[number] {
  return typeof value === "string" && values.includes(value) ? value as Values[number] : fail(code);
}
function boundedText(value: unknown, max: number, code: ValidationCode): string {
  if (typeof value !== "string" || value.length > max * 2) return fail(code);
  const characters = [...value];
  if (characters.length > max || characters.some(character => {
    const point = character.codePointAt(0)!;
    return point === 0 || (point >= 0xd800 && point <= 0xdfff);
  })) return fail(code);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fail(code);
}
function token(value: unknown, code: ValidationCode): string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) ? value : fail(code);
}
function sourceContext(value: unknown, code: ValidationCode): DocumentRecognitionSource {
  const row = exact(value, ["mime_type", "page_count"], code);
  const mime = oneOf(row.mime_type, MIME_TYPES, code);
  return Object.freeze({ mime_type: mime, page_count: integer(row.page_count, 1,
    mime === "application/pdf" ? DOCUMENT_RECOGNITION_LIMITS.maxPdfPages : 1, code) });
}
function timestamp(value: unknown, code: ValidationCode): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !Number.isFinite(Date.parse(value))) return fail(code);
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10) ? value : fail(code);
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// The compact provider schema gives common bounds; the authoritative normalizer
// below also checks each field's smaller registry limit and the actual page count.
export const DOCUMENT_RECOGNITION_RESULT_SCHEMA = deepFreeze({
  type: "object", additionalProperties: false, required: ["candidates", "warnings"],
  properties: {
    candidates: {
      type: "array", maxItems: DOCUMENT_RECOGNITION_LIMITS.maxCandidates,
      items: {
        type: "object", additionalProperties: false,
        required: ["key", "value", "source_page", "source_snippet", "confidence"],
        properties: {
          key: { type: "string", enum: [...PROFILE_FIELD_KEYS] },
          value: { type: "string", minLength: 1, maxLength: Math.max(...PROFILE_FIELDS.map(field => field.maxLength)) },
          source_page: { type: ["integer", "null"], minimum: 1, maximum: DOCUMENT_RECOGNITION_LIMITS.maxPdfPages },
          source_snippet: { type: ["string", "null"], minLength: 1, maxLength: DOCUMENT_RECOGNITION_LIMITS.maxSnippetCodePoints },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        },
      },
    },
    warnings: { type: "array", maxItems: DOCUMENT_RECOGNITION_LIMITS.maxWarnings,
      items: { type: "string", minLength: 1, maxLength: DOCUMENT_RECOGNITION_LIMITS.maxWarningCodePoints } },
  },
} as const);

export function normalizeDocumentRecognitionRequest(value: unknown): DocumentRecognitionRequest {
  const code = "invalid_request";
  const row = exact(value, ["source_version_id", "expected_profile_revision", "request_id", "retry_of_job_id"], code);
  return Object.freeze({ source_version_id: uuid(row.source_version_id, code),
    expected_profile_revision: integer(row.expected_profile_revision, 1, Number.MAX_SAFE_INTEGER, code),
    request_id: uuid(row.request_id, code), retry_of_job_id: row.retry_of_job_id === null ? null : uuid(row.retry_of_job_id, code) });
}
export function normalizeDocumentRecognitionReceipt(value: unknown): DocumentRecognitionReceipt {
  const code = "invalid_job";
  const row = exact(value, ["job_id", "state", "replayed"], code);
  if (typeof row.replayed !== "boolean") return fail(code);
  return Object.freeze({ job_id: uuid(row.job_id, code), state: oneOf(row.state, DOCUMENT_RECOGNITION_STATES, code), replayed: row.replayed });
}
export function normalizeDocumentRecognitionJob(value: unknown): DocumentRecognitionJob {
  const code = "invalid_job";
  const row = exact(value, ["job_id", "source_version_id", "state", "cleanup_state", "proposal_count", "failure_code", "updated_at"], code);
  return Object.freeze({ job_id: uuid(row.job_id, code), source_version_id: uuid(row.source_version_id, code),
    state: oneOf(row.state, DOCUMENT_RECOGNITION_STATES, code), cleanup_state: oneOf(row.cleanup_state, DOCUMENT_RECOGNITION_CLEANUP_STATES, code),
    proposal_count: integer(row.proposal_count, 0, DOCUMENT_RECOGNITION_LIMITS.maxCandidates, code),
    failure_code: row.failure_code === null ? null : oneOf(row.failure_code, DOCUMENT_RECOGNITION_FAILURE_CODES, code),
    updated_at: timestamp(row.updated_at, code) });
}

/** Proposed facts only: no profile input, auto-confirmation, deduplication or date interpretation. */
export function normalizeDocumentRecognitionResult(value: unknown, source: unknown): DocumentRecognitionResult {
  const code = "invalid_result";
  const context = sourceContext(source, code);
  const row = exact(value, ["candidates", "warnings"], code);
  if (!Array.isArray(row.candidates) || row.candidates.length > DOCUMENT_RECOGNITION_LIMITS.maxCandidates
    || !Array.isArray(row.warnings) || row.warnings.length > DOCUMENT_RECOGNITION_LIMITS.maxWarnings) return fail(code);
  const candidates = Array.from(row.candidates, (item): DocumentRecognitionCandidate => {
    const candidate = exact(item, ["key", "value", "source_page", "source_snippet", "confidence"], code);
    if (!isProfileFieldKey(candidate.key)) return fail(code);
    const confidence = candidate.confidence;
    if (confidence !== null && (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) return fail(code);
    return Object.freeze({ key: candidate.key,
      value: boundedText(candidate.value, PROFILE_FIELD_BY_KEY.get(candidate.key)!.maxLength, code),
      source_page: candidate.source_page === null ? null : integer(candidate.source_page, 1, context.page_count, code),
      source_snippet: candidate.source_snippet === null ? null : boundedText(candidate.source_snippet, DOCUMENT_RECOGNITION_LIMITS.maxSnippetCodePoints, code),
      confidence });
  });
  const warnings = Array.from(row.warnings, item => boundedText(item, DOCUMENT_RECOGNITION_LIMITS.maxWarningCodePoints, code));
  const result = Object.freeze({ candidates: Object.freeze(candidates), warnings: Object.freeze(warnings) });
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > DOCUMENT_RECOGNITION_LIMITS.maxResultBytes) return fail(code);
  return result;
}
export function parseDocumentRecognitionResultJson(value: unknown, source: unknown): DocumentRecognitionResult {
  if (typeof value !== "string" || value.length > DOCUMENT_RECOGNITION_LIMITS.maxResultBytes
    || new TextEncoder().encode(value).byteLength > DOCUMENT_RECOGNITION_LIMITS.maxResultBytes) return fail("invalid_result");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return fail("invalid_result"); }
  return normalizeDocumentRecognitionResult(parsed, source);
}

/** Flat, versioned canonical JSON. Future SQL must reproduce this exact encoding. */
export function canonicalDocumentRecognitionFingerprint(value: unknown): string {
  const code = "invalid_fingerprint";
  const row = exact(value, FINGERPRINT_KEYS, code);
  const source = sourceContext({ mime_type: row.source_mime, page_count: row.source_pages }, code);
  if (typeof row.source_sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(row.source_sha256)
    || row.purpose !== "student_profile" || row.extraction_mode !== "student_profile_fields"
    || typeof row.model !== "string" || !/^gemini-[a-z0-9][a-z0-9.-]{0,100}$/.test(row.model)
    || /(?:^|-)latest(?:-|$)/.test(row.model)) return fail(code);
  const normalized: DocumentRecognitionFingerprintInput & { fingerprint_version: string } = {
    fingerprint_version: "evo-document-recognition-request-v1",
    organization_id: uuid(row.organization_id, code), student_case_id: uuid(row.student_case_id, code),
    student_profile_id: uuid(row.student_profile_id, code), source_document_slot_id: uuid(row.source_document_slot_id, code),
    source_version_id: uuid(row.source_version_id, code), source_sha256: row.source_sha256.toLowerCase(),
    source_bytes: integer(row.source_bytes, 1, DOCUMENT_RECOGNITION_LIMITS.maxSourceBytes, code),
    source_mime: source.mime_type, source_pages: source.page_count,
    actor_auth_user_id: uuid(row.actor_auth_user_id, code), actor_membership_id: uuid(row.actor_membership_id, code),
    purpose: "student_profile", extraction_mode: "student_profile_fields",
    registry_version: token(row.registry_version, code), schema_version: integer(row.schema_version, 1, Number.MAX_SAFE_INTEGER, code),
    prompt_policy_version: token(row.prompt_policy_version, code), config_version: token(row.config_version, code),
    provider_project_id: token(row.provider_project_id, code), model: row.model,
    expected_profile_revision: integer(row.expected_profile_revision, 1, Number.MAX_SAFE_INTEGER, code),
    retry_of_job_id: row.retry_of_job_id === null ? null : uuid(row.retry_of_job_id, code),
  };
  return JSON.stringify(Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)));
}
async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function documentRecognitionFingerprint(value: unknown): Promise<string> {
  return sha256(canonicalDocumentRecognitionFingerprint(value));
}
/** Separate from the request fingerprint; only the bounded result bytes are hashed. */
export function documentRecognitionResultSha256(value: unknown, source: unknown): Promise<string> {
  return sha256(JSON.stringify(normalizeDocumentRecognitionResult(value, source)));
}
