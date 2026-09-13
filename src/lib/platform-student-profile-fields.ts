import "server-only";

import { staffHasPermission } from "./platform-access.ts";
import type { PlatformActor } from "./platform-auth.ts";
import { exactActionStringFields } from "./server/action-form-fields.ts";
import {
  PROFILE_FIELD_KEYS,
  isProfileFieldKey,
  type ProfileFieldKey,
  type ProfileFieldState,
  type ProfileFieldValue,
} from "./student-profile-fields.ts";

export type PlatformProfileFieldProposal = Readonly<{
  id: string;
  value: string;
  sourceDocumentVersionId: string | null;
  sourcePage: number | null;
  sourceSnippet: string | null;
  confidence: number | null;
  createdAt: string;
  status: "pending" | "accepted" | "rejected";
}>;

export type PlatformReviewedProfileField = ProfileFieldValue & Readonly<{
  reviewedAt: string | null;
  sourceDocumentVersionId: string | null;
  sourcePage: number | null;
  proposals: readonly PlatformProfileFieldProposal[];
}>;

export type PlatformStudentProfileFieldsSnapshot = Readonly<{
  studentCaseId: string;
  profile: Readonly<{ id: string; revision: number }> | null;
  canInitialize: boolean;
  canReview: boolean;
  canExport: boolean;
  fields: readonly PlatformReviewedProfileField[];
}>;

export type PlatformStudentProfileFieldOutcome =
  | "saved" | "invalid" | "forbidden" | "stale"
  | "request_conflict" | "source_unavailable" | "unavailable";

export type PlatformStudentProfileFieldActionState = Readonly<{
  status: "idle" | PlatformStudentProfileFieldOutcome;
  requestId: string;
  studentProfileId: string | null;
  profileRevision: number | null;
}>;

export class PlatformStudentProfileFieldsError extends Error {
  readonly outcome: "forbidden" | "unavailable";

  constructor(outcome: "forbidden" | "unavailable" = "unavailable") {
    super("Student profile fields are unavailable");
    this.name = "PlatformStudentProfileFieldsError";
    this.outcome = outcome;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const HASH = /^[0-9a-f]{64}$/;
const STATES: readonly ProfileFieldState[] = ["extracted", "needs_review", "conflict", "confirmed"];

function fail(): never { throw new PlatformStudentProfileFieldsError(); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length
    || !keys.every(key => Object.hasOwn(value, key))) return fail();
  return value;
}
function uuid(value: unknown): string {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : fail();
}
function nullableUuid(value: unknown): string | null { return value === null ? null : uuid(value); }
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail();
}
function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : fail(); }
function text(value: unknown, max: number): string {
  // PostgreSQL char_length counts Unicode code points, not UTF-16 code units.
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= max ? value : fail();
}
function timestamp(value: unknown): string {
  return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value)) ? value : fail();
}
function source(row: Record<string, unknown>) {
  const sourceDocumentVersionId = nullableUuid(row.source_document_version_id);
  const sourcePage = row.source_page === null ? null : integer(row.source_page, 1, 10000);
  if (sourcePage !== null && sourceDocumentVersionId === null) return fail();
  return { sourceDocumentVersionId, sourcePage };
}
function proposal(value: unknown): PlatformProfileFieldProposal {
  const row = exact(value, ["id", "value", "source_document_version_id", "source_page", "source_snippet", "confidence", "created_at", "status"]);
  const provenance = source(row);
  const sourceSnippet = row.source_snippet;
  if (sourceSnippet !== null && (typeof sourceSnippet !== "string" || sourceSnippet.length === 0
    || [...sourceSnippet].length > 2000)) return fail();
  if (sourceSnippet !== null && provenance.sourceDocumentVersionId === null) return fail();
  const confidence = row.confidence;
  if (confidence !== null && (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) return fail();
  if (row.status !== "pending" && row.status !== "accepted" && row.status !== "rejected") return fail();
  return {
    id: uuid(row.id), value: text(row.value, 4096), ...provenance, sourceSnippet,
    confidence, createdAt: timestamp(row.created_at), status: row.status,
  };
}

/** Preserve database values verbatim: review/readiness, not this DTO, validates facts. */
export function normalizePlatformStudentProfileFieldsSnapshot(
  value: unknown,
  expectedStudentCaseId?: string,
): PlatformStudentProfileFieldsSnapshot {
  const row = exact(value, ["student_case_id", "profile", "can_initialize", "can_review", "can_export", "fields"]);
  const studentCaseId = uuid(row.student_case_id);
  if (expectedStudentCaseId !== undefined && studentCaseId !== uuid(expectedStudentCaseId)) return fail();
  const profileRow = row.profile === null ? null : exact(row.profile, ["id", "revision"]);
  const profile = profileRow === null ? null : { id: uuid(profileRow.id), revision: integer(profileRow.revision, 1) };
  const canInitialize = boolean(row.can_initialize);
  const canReview = boolean(row.can_review);
  const canExport = boolean(row.can_export);
  if ((profile === null && (canReview || canExport)) || (profile !== null && canInitialize)) return fail();
  if (!Array.isArray(row.fields) || row.fields.length !== PROFILE_FIELD_KEYS.length) return fail();
  const proposalIds = new Set<string>();
  const fields = row.fields.map((value, index): PlatformReviewedProfileField => {
    const field = exact(value, ["field_key", "value", "review_state", "reviewed_at", "source_document_version_id", "source_page", "proposals"]);
    if (!isProfileFieldKey(field.field_key) || field.field_key !== PROFILE_FIELD_KEYS[index]) return fail();
    const key = field.field_key;
    const maximum = key === "nationality" || key === "country_of_residence" ? 120 : key === "date_of_birth" ? 10 : 500;
    const currentValue = field.value === null ? null : text(field.value, maximum);
    if (!STATES.includes(field.review_state as ProfileFieldState)) return fail();
    const state = field.review_state as ProfileFieldState;
    const reviewedAt = field.reviewed_at === null ? null : timestamp(field.reviewed_at);
    if (state === "confirmed" && reviewedAt === null) return fail();
    const provenance = source(field);
    if (!Array.isArray(field.proposals)) return fail();
    const proposals = field.proposals.map(proposal);
    for (const candidate of proposals) {
      if (proposalIds.has(candidate.id)) return fail();
      proposalIds.add(candidate.id);
    }
    if (profile === null && (currentValue !== null || state !== "needs_review" || reviewedAt !== null
      || provenance.sourceDocumentVersionId !== null || proposals.length > 0)) return fail();
    return { key, value: currentValue, state, reviewedAt, ...provenance, proposals };
  });
  return { studentCaseId, profile, canInitialize, canReview, canExport, fields };
}

/** The session-bound RPC rechecks current case-scoped authority; no read creates a profile. */
export async function getPlatformStudentProfileFields(
  actor: PlatformActor,
  studentCaseId: string,
): Promise<PlatformStudentProfileFieldsSnapshot> {
  try {
    if (!staffHasPermission(actor, "profile.read.full")) throw new PlatformStudentProfileFieldsError("forbidden");
    uuid(actor.organizationId);
    const caseId = uuid(studentCaseId);
    const { createSupabaseServerClient } = await import("./supabase/server.ts");
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("staff_student_profile_fields", { p_student_case_id: caseId }, { get: true });
    if (response.error) throw new PlatformStudentProfileFieldsError(response.error.code === "42501" ? "forbidden" : "unavailable");
    return normalizePlatformStudentProfileFieldsSnapshot(response.data, caseId);
  } catch (error) {
    if (error instanceof PlatformStudentProfileFieldsError) throw error;
    return fail();
  }
}

type ProfileCommandBase = Readonly<{ studentCaseId: string; expectedRevision: number; reason: string; requestId: string }>;
export type PlatformStartStudentProfileCommand = ProfileCommandBase;
export type PlatformReviewStudentProfileFieldCommand = ProfileCommandBase & Readonly<{
  fieldKey: ProfileFieldKey;
  decision: "confirm" | "clear" | "reject_proposal";
  value: string | null;
  proposalId: string | null;
  sourceVersionId: string | null;
  sourcePage: number | null;
}>;

function commandBase(fields: Map<string, string>, revisionKey: string, start: boolean): ProfileCommandBase {
  const revisionText = fields.get(revisionKey) ?? "";
  if (!/^(0|[1-9]\d*)$/.test(revisionText)) return fail();
  const expectedRevision = integer(Number(revisionText), start ? 0 : 1, start ? 0 : Number.MAX_SAFE_INTEGER - 1);
  const rawReason = fields.get("reason") ?? "";
  if (rawReason.length > 500 || /\p{Cc}/u.test(rawReason)) return fail();
  return {
    studentCaseId: uuid(fields.get("student_case_id")), requestId: uuid(fields.get("request_id")),
    expectedRevision, reason: text(rawReason.trim(), 500),
  };
}

export function parsePlatformStartStudentProfileCommand(form: FormData): PlatformStartStudentProfileCommand | null {
  try {
    const fields = exactActionStringFields(form, ["student_case_id", "expected_profile_revision", "reason", "request_id"]);
    return fields ? commandBase(fields, "expected_profile_revision", true) : null;
  } catch { return null; }
}

export function parsePlatformReviewStudentProfileFieldCommand(form: FormData): PlatformReviewStudentProfileFieldCommand | null {
  try {
    const fields = exactActionStringFields(form, ["student_case_id", "field_key", "decision", "value", "proposal_id", "source_version_id", "source_page", "expected_revision", "reason", "request_id"]);
    if (!fields) return null;
    const base = commandBase(fields, "expected_revision", false);
    const fieldKey = fields.get("field_key");
    const decision = fields.get("decision");
    if (!isProfileFieldKey(fieldKey) || (decision !== "confirm" && decision !== "clear" && decision !== "reject_proposal")) return null;
    const rawValue = fields.get("value") ?? "";
    const value = rawValue === "" ? null : text(rawValue, 4096);
    const optionalId = (key: string) => fields.get(key) === "" ? null : uuid(fields.get(key));
    const proposalId = optionalId("proposal_id");
    const sourceVersionId = optionalId("source_version_id");
    const page = fields.get("source_page") ?? "";
    if (page !== "" && !/^[1-9]\d{0,4}$/.test(page)) return null;
    const sourcePage = page === "" ? null : integer(Number(page), 1, 10000);
    if ((sourcePage !== null && sourceVersionId === null)
      || (proposalId !== null && (sourceVersionId !== null || sourcePage !== null))
      || (decision === "confirm" && value === null && proposalId === null)
      || (decision === "clear" && (value !== null || proposalId !== null || sourceVersionId !== null || sourcePage !== null))
      || (decision === "reject_proposal" && (proposalId === null || value !== null || sourceVersionId !== null || sourcePage !== null))) return null;
    return { ...base, fieldKey, decision, value, proposalId, sourceVersionId, sourcePage };
  } catch { return null; }
}

export function platformStudentProfileFieldErrorOutcome(error: unknown): Exclude<PlatformStudentProfileFieldOutcome, "saved"> {
  if (!record(error)) return "unavailable";
  if (error.code === "40001") return "stale";
  if (error.code === "42501") return "forbidden";
  if (error.code === "22023") {
    return typeof error.message === "string" && /request_id .* was already used for another mutation/.test(error.message)
      ? "request_conflict" : "invalid";
  }
  if (error.code === "P0001" && error.message === "Profile field source document is unavailable") return "source_unavailable";
  return "unavailable";
}

export type PlatformStudentProfileFieldReceipt = Readonly<{ studentProfileId: string; profileRevision: number }>;

export function normalizePlatformStudentProfileStartReceipt(
  value: unknown, organizationId: string, command: PlatformStartStudentProfileCommand,
): PlatformStudentProfileFieldReceipt | null {
  try {
    const row = exact(value, ["id", "student_profile_id", "organization_id", "student_case_id", "revision", "applied_country_requirement_version_id", "updated_field_names", "input_sha256"]);
    if (row.organization_id !== organizationId || row.student_case_id !== command.studentCaseId
      || row.id !== row.student_profile_id || row.revision !== 1 || command.expectedRevision !== 0
      || !Array.isArray(row.updated_field_names) || row.updated_field_names.length !== 0
      || typeof row.input_sha256 !== "string" || !HASH.test(row.input_sha256)) return null;
    nullableUuid(row.applied_country_requirement_version_id);
    return { studentProfileId: uuid(row.student_profile_id), profileRevision: 1 };
  } catch { return null; }
}

export function normalizePlatformStudentProfileFieldReviewReceipt(
  value: unknown, organizationId: string, command: PlatformReviewStudentProfileFieldCommand,
): PlatformStudentProfileFieldReceipt | null {
  try {
    const row = exact(value, ["organization_id", "student_case_id", "student_profile_id", "profile_revision", "field_key", "decision", "review_id", "request_id", "input_sha256"]);
    if (row.organization_id !== organizationId || row.student_case_id !== command.studentCaseId
      || row.field_key !== command.fieldKey || row.decision !== command.decision || row.request_id !== command.requestId
      || row.profile_revision !== command.expectedRevision + 1
      || typeof row.input_sha256 !== "string" || !HASH.test(row.input_sha256)) return null;
    uuid(row.review_id);
    return { studentProfileId: uuid(row.student_profile_id), profileRevision: integer(row.profile_revision, 2) };
  } catch { return null; }
}
