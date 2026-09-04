import type { PlatformActor } from "./platform-auth";

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const PLATFORM_STUDENT_PROFILE_COMMUNICATION_LANGUAGES = [
  "ru",
  "en",
] as const;

export type PlatformStudentProfileCommunicationLanguage =
  (typeof PLATFORM_STUDENT_PROFILE_COMMUNICATION_LANGUAGES)[number];

export const PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS = 12;
export const PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANT_LENGTH = 120;
export const PLATFORM_STUDENT_PROFILE_DECISION_PARTICIPANTS_INPUT_MAX_LENGTH =
  PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS
    * PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANT_LENGTH
  + (PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS - 1) * 2;
export const PLATFORM_STUDENT_PROFILE_DECISION_PARTICIPANTS_INPUT_PATTERN =
  `[^,]+(?:,[^,]+){0,${PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS - 1}}`;

export function isPlatformStudentProfileCommunicationLanguage(
  value: string,
): value is PlatformStudentProfileCommunicationLanguage {
  return (PLATFORM_STUDENT_PROFILE_COMMUNICATION_LANGUAGES as readonly string[])
    .includes(value);
}

export function parsePlatformStudentProfileDecisionParticipants(
  value: string,
): readonly string[] | null {
  const candidate = value.trim();
  if (!candidate) return [];
  const labels = candidate.split(",").map((label) => label.trim());
  if (
    labels.length > PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS
    || labels.some(
      (label) =>
        label.length === 0
        || label.length > PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANT_LENGTH
        || CONTROL_CHARACTER_PATTERN.test(label),
    )
    || new Set(labels.map((label) => label.toLocaleLowerCase("en-US"))).size
      !== labels.length
  ) {
    return null;
  }
  return labels;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const SAFE_REPOSITORY_ERROR_MESSAGE = "Platform student profile data is unavailable.";

export const PLATFORM_PROFILE_CONSENT_STATUSES = [
  "not_recorded",
  "granted",
  "withdrawn",
] as const;

export const PLATFORM_STUDENT_PROFILE_FIELDS = [
  "preferred_display_name",
  "legal_display_name",
  "communication_language",
  "date_of_birth",
  "citizenship_country",
  "residency_country",
  "current_education_summary",
  "academic_summary",
  "language_summary",
  "budget_band",
  "decision_participant_labels",
  "consent_status",
  "consent_evidence_ref",
  "next_step",
] as const;

export type PlatformProfileConsentStatus =
  (typeof PLATFORM_PROFILE_CONSENT_STATUSES)[number];
export type PlatformStudentProfileField =
  (typeof PLATFORM_STUDENT_PROFILE_FIELDS)[number];

export type PlatformStudentProfileSnapshot = Readonly<{
  studentCaseId: string;
  studentProfileId: string;
  profileRevision: number;
  preferredDisplayName: string;
  legalDisplayName: string | null;
  communicationLanguage: PlatformStudentProfileCommunicationLanguage;
  dateOfBirth: string | null;
  citizenshipCountry: string;
  residencyCountry: string;
  currentEducationSummary: string;
  academicSummary: string;
  languageSummary: string;
  budgetBand: string;
  decisionParticipantLabels: readonly string[];
  consentStatus: PlatformProfileConsentStatus;
  consentEvidenceRef: string | null;
  profileNextStep: string;
  appliedCountryRequirementVersionId: string;
  checklistVersion: number;
  requiredProfileFields: readonly PlatformStudentProfileField[];
}>;

export type PlatformCountryRequirementVersion = Readonly<{
  studentCaseId: string;
  countryRequirementVersionId: string;
  targetCountry: string;
  targetDegree: string;
  programDirection: string | null;
  version: number;
  status: "draft" | "approved" | "retired";
  requiredProfileFields: readonly PlatformStudentProfileField[];
  sourceCount: number;
  approvedAt: string | null;
  retiredAt: string | null;
  isApplied: boolean;
  createdAt: string;
}>;

export type PlatformStudentCaseDocument = Readonly<{
  studentCaseId: string;
  documentSlotId: string;
  documentRequirementId: string;
  requirementKey: string;
  requirementLabel: string;
  instructions: string | null;
  checklistVersion: number;
  slotStatus: "required" | "submitted" | "approved" | "correction_required" | "rejected";
  deadline: string | null;
  nextAction: string | null;
  documentVersionId: string | null;
  versionNumber: number | null;
  originalFilename: string | null;
  declaredMimeType: string | null;
  byteSize: number | null;
  submittedAt: string | null;
  reviewDecision: "approved" | "correction_required" | "rejected" | null;
  reworkReason: string | null;
  reviewedAt: string | null;
}>;

export class PlatformStudentProfileRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformStudentProfileRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformStudentProfileRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformStudentProfileRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlatformStudentProfileUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function requiredUuid(value: unknown): string {
  return parsePlatformStudentProfileUuid(value) ?? invalidShape();
}

function optionalUuid(value: unknown): string | null {
  if (value === null) return null;
  return requiredUuid(value);
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximum) return invalidShape();
  const normalized = value.trim();
  return normalized ? normalized : invalidShape();
}

function requiredText(value: unknown, maximum: number): string {
  return optionalText(value, maximum) ?? invalidShape();
}

function integer(value: unknown, minimum: number): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < minimum) return invalidShape();
  return Number(parsed);
}

function optionalInteger(value: unknown, minimum: number): number | null {
  if (value === null) return null;
  return integer(value, minimum);
}

function optionalDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return invalidShape();
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return invalidShape();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function requiredTimestamp(value: unknown): string {
  return optionalTimestamp(value) ?? invalidShape();
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : invalidShape();
}

function textArray(value: unknown, maximumItems: number, maximumItemLength: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) return invalidShape();
  const items = value.map((item) => requiredText(item, maximumItemLength));
  return new Set(items).size === items.length ? items : invalidShape();
}

function profileFields(value: unknown): PlatformStudentProfileField[] {
  if (!Array.isArray(value) || value.length > PLATFORM_STUDENT_PROFILE_FIELDS.length) {
    return invalidShape();
  }
  const fields = value.map((field) =>
    oneOf(field, PLATFORM_STUDENT_PROFILE_FIELDS));
  return new Set(fields).size === fields.length ? fields : invalidShape();
}

function requireProfileReader(actor: PlatformActor): void {
  if (
    actor.platformRole !== "admin" &&
    actor.platformRole !== "sales" &&
    actor.platformRole !== "admissions"
  ) {
    return invalidShape();
  }
  requiredUuid(actor.organizationId);
}

async function getPlatformClient() {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export function normalizePlatformStudentProfileSnapshot(
  value: unknown,
  expectedStudentCaseId?: string,
): PlatformStudentProfileSnapshot {
  if (!isRecord(value)) return invalidShape();
  const studentCaseId = requiredUuid(value.case_id);
  if (expectedStudentCaseId && studentCaseId !== expectedStudentCaseId) return invalidShape();
  const studentProfileId = requiredUuid(value.student_profile_id);
  const profileRevision = integer(value.profile_revision, 1);
  const consentStatus = oneOf(value.consent_status, PLATFORM_PROFILE_CONSENT_STATUSES);
  const consentEvidenceRef = optionalText(value.consent_evidence_ref, 512);
  const appliedCountryRequirementVersionId = requiredUuid(
    value.applied_country_requirement_version_id,
  );
  const checklistVersion = integer(value.checklist_version, 1);
  const requiredProfileFields = profileFields(value.required_profile_fields);
  if (
    (consentStatus === "not_recorded" && consentEvidenceRef !== null) ||
    (consentStatus !== "not_recorded" && consentEvidenceRef === null)
  ) {
    return invalidShape();
  }
  return {
    studentCaseId,
    studentProfileId,
    profileRevision,
    preferredDisplayName: requiredText(value.preferred_display_name, 160),
    legalDisplayName: optionalText(value.legal_display_name, 200),
    communicationLanguage: oneOf(
      value.communication_language,
      PLATFORM_STUDENT_PROFILE_COMMUNICATION_LANGUAGES,
    ),
    dateOfBirth: optionalDate(value.date_of_birth),
    citizenshipCountry: requiredText(value.citizenship_country, 120),
    residencyCountry: requiredText(value.residency_country, 120),
    currentEducationSummary: requiredText(value.current_education_summary, 2000),
    academicSummary: requiredText(value.academic_summary, 2000),
    languageSummary: requiredText(value.language_summary, 2000),
    budgetBand: requiredText(value.budget_band, 120),
    decisionParticipantLabels: textArray(
      value.decision_participant_labels,
      PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS,
      PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANT_LENGTH,
    ),
    consentStatus,
    consentEvidenceRef,
    profileNextStep: requiredText(value.profile_next_step, 1000),
    appliedCountryRequirementVersionId,
    checklistVersion,
    requiredProfileFields,
  };
}

export function normalizePlatformCountryRequirementVersion(
  value: unknown,
  expectedStudentCaseId?: string,
): PlatformCountryRequirementVersion {
  if (!isRecord(value)) return invalidShape();
  const studentCaseId = requiredUuid(value.case_id);
  if (expectedStudentCaseId && studentCaseId !== expectedStudentCaseId) return invalidShape();
  return {
    studentCaseId,
    countryRequirementVersionId: requiredUuid(value.country_requirement_version_id),
    targetCountry: requiredText(value.target_country, 200),
    targetDegree: requiredText(value.target_degree, 200),
    programDirection: optionalText(value.program_direction, 300),
    version: integer(value.version, 1),
    status: oneOf(value.status, ["draft", "approved", "retired"] as const),
    requiredProfileFields: profileFields(value.required_profile_fields),
    sourceCount: integer(value.source_count, 0),
    approvedAt: optionalTimestamp(value.approved_at),
    retiredAt: optionalTimestamp(value.retired_at),
    isApplied: typeof value.is_applied === "boolean" ? value.is_applied : invalidShape(),
    createdAt: requiredTimestamp(value.created_at),
  };
}

export function normalizePlatformStudentCaseDocument(
  value: unknown,
  expectedStudentCaseId?: string,
): PlatformStudentCaseDocument {
  if (!isRecord(value)) return invalidShape();
  const studentCaseId = requiredUuid(value.case_id);
  if (expectedStudentCaseId && studentCaseId !== expectedStudentCaseId) return invalidShape();
  return {
    studentCaseId,
    documentSlotId: requiredUuid(value.document_slot_id),
    documentRequirementId: requiredUuid(value.document_requirement_id),
    requirementKey: requiredText(value.requirement_key, 128),
    requirementLabel: requiredText(value.requirement_label, 300),
    instructions: optionalText(value.instructions, 4000),
    checklistVersion: integer(value.checklist_version, 1),
    slotStatus: oneOf(value.slot_status, [
      "required",
      "submitted",
      "approved",
      "correction_required",
      "rejected",
    ] as const),
    deadline: optionalTimestamp(value.deadline),
    nextAction: optionalText(value.next_action, 2000),
    documentVersionId: optionalUuid(value.document_version_id),
    versionNumber: optionalInteger(value.version_no, 1),
    originalFilename: optionalText(value.original_filename, 512),
    declaredMimeType: optionalText(value.declared_mime_type, 128),
    byteSize: optionalInteger(value.byte_size, 0),
    submittedAt: optionalTimestamp(value.submitted_at),
    reviewDecision: value.review_decision === null
      ? null
      : oneOf(value.review_decision, ["approved", "correction_required", "rejected"] as const),
    reworkReason: optionalText(value.rework_reason, 2000),
    reviewedAt: optionalTimestamp(value.reviewed_at),
  };
}

function normalizeRows<T>(
  value: unknown,
  normalize: (row: unknown) => T,
  key: (row: T) => string,
): readonly T[] {
  if (!Array.isArray(value) || value.length > 500) return invalidShape();
  const rows = value.map(normalize);
  return new Set(rows.map(key)).size === rows.length ? rows : invalidShape();
}

export async function getPlatformStudentProfile(
  actor: PlatformActor,
  studentCaseId: string,
): Promise<PlatformStudentProfileSnapshot | null> {
  try {
    requireProfileReader(actor);
    const parsedStudentCaseId = parsePlatformStudentProfileUuid(studentCaseId);
    if (!parsedStudentCaseId) return null;
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_student_profile_snapshot",
      { p_student_case_id: parsedStudentCaseId },
      { get: true },
    );
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    if (response.data.length === 0) return null;
    if (response.data.length !== 1) return invalidShape();
    return normalizePlatformStudentProfileSnapshot(
      response.data[0],
      parsedStudentCaseId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformStudentCaseDocuments(
  actor: PlatformActor,
  studentCaseId: string,
): Promise<readonly PlatformStudentCaseDocument[]> {
  try {
    requireProfileReader(actor);
    const parsedStudentCaseId = requiredUuid(studentCaseId);
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_student_case_documents",
      { p_student_case_id: parsedStudentCaseId },
      { get: true },
    );
    if (response.error) return invalidShape();
    return normalizeRows(
      response.data,
      (row) => normalizePlatformStudentCaseDocument(row, parsedStudentCaseId),
      (row) => row.documentSlotId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformCountryRequirementVersions(
  actor: PlatformActor,
  studentCaseId: string,
): Promise<readonly PlatformCountryRequirementVersion[]> {
  try {
    requireProfileReader(actor);
    const parsedStudentCaseId = requiredUuid(studentCaseId);
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_country_requirement_versions_for_case",
      { p_student_case_id: parsedStudentCaseId },
      { get: true },
    );
    if (response.error) return invalidShape();
    return normalizeRows(
      response.data,
      (row) => normalizePlatformCountryRequirementVersion(row, parsedStudentCaseId),
      (row) => row.countryRequirementVersionId,
    );
  } catch (error) {
    return failClosed(error);
  }
}
