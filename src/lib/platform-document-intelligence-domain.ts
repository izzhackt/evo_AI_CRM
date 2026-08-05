import type {
  PlatformConfirmedStudentDocumentProfileFieldValue,
  PlatformStudentDocumentProfileFieldKey,
  PlatformStudentDocumentProfileFieldValues,
} from "./platform-student-document-profile-domain";

export const PLATFORM_DOCUMENT_EXTRACTION_RUN_STATUSES = [
  "queued",
  "processing",
  "succeeded",
  "failed",
  "superseded",
] as const;

export const PLATFORM_DOCUMENT_EXTRACTED_FACT_STATUSES = [
  "proposed",
  "conflict",
  "confirmed",
  "rejected",
  "superseded",
] as const;

export const PLATFORM_STUDENT_PROFILE_EXPORT_STATUSES = [
  "queued",
  "processing",
  "succeeded",
  "failed",
  "superseded",
] as const;

export const PLATFORM_STUDENT_PROFILE_EXPORT_FORMATS = [
  "docx",
  "pdf",
] as const;

export const PLATFORM_DOCUMENT_DISPLAY_STATES = [
  "missing",
  "received",
  "processing",
  "needs_review",
  "confirmed",
  "failed",
  "not_required",
] as const;

export type PlatformDocumentExtractionRunStatus =
  (typeof PLATFORM_DOCUMENT_EXTRACTION_RUN_STATUSES)[number];
export type PlatformDocumentExtractedFactStatus =
  (typeof PLATFORM_DOCUMENT_EXTRACTED_FACT_STATUSES)[number];
export type PlatformStudentProfileExportStatus =
  (typeof PLATFORM_STUDENT_PROFILE_EXPORT_STATUSES)[number];
export type PlatformStudentProfileExportFormat =
  (typeof PLATFORM_STUDENT_PROFILE_EXPORT_FORMATS)[number];
export type PlatformDocumentDisplayState =
  (typeof PLATFORM_DOCUMENT_DISPLAY_STATES)[number];

export type PlatformDocumentExtractionRun = Readonly<{
  id: string;
  organizationId: string;
  studentCaseId: string;
  documentVersionId: string;
  documentVersionNumber: number;
  requestKey: string;
  extractorPolicyVersion: string;
  modelVersion: string;
  status: PlatformDocumentExtractionRunStatus;
  attempt: number;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureCode: string | null;
  supersededByRunId: string | null;
}>;

export type PlatformDocumentSourceLocator =
  | Readonly<{
      kind: "page";
      pageNumber: number;
      anchor: string;
    }>
  | Readonly<{
      kind: "image";
      imageIndex: number;
      anchor: string;
    }>
  | Readonly<{
      kind: "metadata";
      pointer: string;
    }>;

export type PlatformDocumentExtractedFact<
  K extends PlatformStudentDocumentProfileFieldKey =
    PlatformStudentDocumentProfileFieldKey,
> = K extends PlatformStudentDocumentProfileFieldKey
  ? Readonly<{
      id: string;
      organizationId: string;
      studentCaseId: string;
      extractionRunId: string;
      documentVersionId: string;
      documentVersionNumber: number;
      fieldKey: K;
      candidateValue: PlatformStudentDocumentProfileFieldValues[K];
      normalizedValue: PlatformStudentDocumentProfileFieldValues[K];
      confidence: number;
      sourceLocator: PlatformDocumentSourceLocator;
      extractorPolicyVersion: string;
      modelVersion: string;
      status: PlatformDocumentExtractedFactStatus;
      createdAt: string;
    }>
  : never;

export const PLATFORM_STUDENT_PROFILE_FIELD_DECISION_KINDS = [
  "confirm",
  "reject",
  "manual_edit",
  "supersede",
] as const;

export type PlatformStudentProfileFieldDecisionKind =
  (typeof PLATFORM_STUDENT_PROFILE_FIELD_DECISION_KINDS)[number];

export type PlatformStudentProfileFieldDecision<
  K extends PlatformStudentDocumentProfileFieldKey =
    PlatformStudentDocumentProfileFieldKey,
> = K extends PlatformStudentDocumentProfileFieldKey
  ? Readonly<{
      id: string;
      organizationId: string;
      studentCaseId: string;
      fieldKey: K;
      kind: PlatformStudentProfileFieldDecisionKind;
      factId: string | null;
      beforeValue: PlatformStudentDocumentProfileFieldValues[K] | null;
      afterValue: PlatformStudentDocumentProfileFieldValues[K] | null;
      beforeFieldRevision: number | null;
      afterFieldRevision: number | null;
      beforeProfileRevision: number;
      afterProfileRevision: number;
      actorMembershipId: string;
      reason: string;
      requestId: string;
      decidedAt: string;
    }>
  : never;

export type PlatformStudentProfileExportManifestEntry = Readonly<{
  fieldKey: PlatformStudentDocumentProfileFieldKey;
  fieldRevision: number;
}>;

export type PlatformStudentProfileExport = Readonly<{
  id: string;
  organizationId: string;
  studentCaseId: string;
  profileRevision: number;
  templateVersion: string;
  templateSha256: string;
  inputManifest: readonly PlatformStudentProfileExportManifestEntry[];
  format: PlatformStudentProfileExportFormat;
  status: PlatformStudentProfileExportStatus;
  outputObjectPath: string | null;
  outputSha256: string | null;
  failureCode: string | null;
  supersededByExportId: string | null;
  requestedByMembershipId: string;
  requestId: string;
  createdAt: string;
  completedAt: string | null;
}>;

const EXTRACTION_RUN_TRANSITIONS: Readonly<
  Record<PlatformDocumentExtractionRunStatus, readonly PlatformDocumentExtractionRunStatus[]>
> = {
  queued: ["processing", "failed", "superseded"],
  processing: ["succeeded", "failed", "superseded"],
  succeeded: ["superseded"],
  failed: ["superseded"],
  superseded: [],
};

const EXTRACTED_FACT_TRANSITIONS: Readonly<
  Record<PlatformDocumentExtractedFactStatus, readonly PlatformDocumentExtractedFactStatus[]>
> = {
  proposed: ["conflict", "confirmed", "rejected", "superseded"],
  conflict: ["confirmed", "rejected", "superseded"],
  confirmed: ["superseded"],
  rejected: ["superseded"],
  superseded: [],
};

const PROFILE_EXPORT_TRANSITIONS: Readonly<
  Record<PlatformStudentProfileExportStatus, readonly PlatformStudentProfileExportStatus[]>
> = {
  queued: ["processing", "failed", "superseded"],
  processing: ["succeeded", "failed", "superseded"],
  succeeded: ["superseded"],
  failed: ["superseded"],
  superseded: [],
};

export function isPlatformDocumentExtractionRunTransitionAllowed(
  from: PlatformDocumentExtractionRunStatus,
  to: PlatformDocumentExtractionRunStatus,
): boolean {
  return EXTRACTION_RUN_TRANSITIONS[from].includes(to);
}

export function isPlatformDocumentExtractedFactTransitionAllowed(
  from: PlatformDocumentExtractedFactStatus,
  to: PlatformDocumentExtractedFactStatus,
): boolean {
  return EXTRACTED_FACT_TRANSITIONS[from].includes(to);
}

export function isPlatformStudentProfileExportTransitionAllowed(
  from: PlatformStudentProfileExportStatus,
  to: PlatformStudentProfileExportStatus,
): boolean {
  return PROFILE_EXPORT_TRANSITIONS[from].includes(to);
}

export const PLATFORM_CHINA_DOCUMENT_REQUIREMENTS = [
  { key: "passport", label: "Passport", applicabilityRule: "always" },
  { key: "china_visa_photos", label: "China visa photos", applicabilityRule: "always" },
  { key: "medical_certificate", label: "Medical certificate", applicabilityRule: "always" },
  {
    key: "diploma_certificate_or_grade_report",
    label: "Diploma/certificate or current grade report",
    applicabilityRule: "always",
  },
  {
    key: "current_study_certificate",
    label: "Current-study certificate",
    applicabilityRule: "always",
  },
  {
    key: "criminal_record_certificate",
    label: "Criminal record certificate",
    applicabilityRule: "always",
  },
  {
    key: "two_teacher_recommendations_en",
    label: "Two teacher recommendations in English",
    applicabilityRule: "always",
  },
  {
    key: "motivation_letter_or_study_plan_en",
    label: "Motivation letter/study plan in English",
    applicabilityRule: "always",
  },
  { key: "video_resume", label: "Video resume", applicabilityRule: "always" },
  {
    key: "bank_balance_certificate",
    label: "Bank balance certificate",
    applicabilityRule: "always",
  },
  {
    key: "notarized_parental_travel_consent",
    label: "Notarized parental travel consent",
    applicabilityRule: "minor_only",
  },
  {
    key: "original_birth_certificate",
    label: "Original birth certificate",
    applicabilityRule: "minor_only",
  },
  {
    key: "application_form_after_contract_payment",
    label: "Application Form after contract/payment",
    applicabilityRule: "after_contract_payment",
  },
  {
    key: "both_parents_passports",
    label: "Both parents' passports",
    applicabilityRule: "always",
  },
] as const;

export type PlatformChinaDocumentRequirementKey =
  (typeof PLATFORM_CHINA_DOCUMENT_REQUIREMENTS)[number]["key"];

export type PlatformDocumentRequirementApplicability =
  | Readonly<{
      state: "required";
      reason: "unconditional" | "applicant_is_minor" | "contract_payment_complete";
    }>
  | Readonly<{
      state: "not_required";
      reason: "applicant_is_adult" | "contract_payment_incomplete";
    }>
  | Readonly<{
      state: "pending_information";
      reason:
        | "date_of_birth_missing"
        | "date_of_birth_invalid"
        | "as_of_date_invalid";
    }>;

function parseIsoDateParts(
  value: string,
): Readonly<{ year: number; month: number; day: number }> | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
    ? { year, month, day }
    : null;
}

export function derivePlatformDocumentRequirementApplicability(
  requirementKey: PlatformChinaDocumentRequirementKey,
  dateOfBirth: string | null,
  asOfDate: string | null,
  contractPaymentComplete: boolean | null = null,
): PlatformDocumentRequirementApplicability {
  const requirement = PLATFORM_CHINA_DOCUMENT_REQUIREMENTS.find(
    (candidate) => candidate.key === requirementKey,
  );
  if (!requirement || requirement.applicabilityRule === "always") {
    return { state: "required", reason: "unconditional" };
  }
  if (requirement.applicabilityRule === "after_contract_payment") {
    return contractPaymentComplete === true
      ? { state: "required", reason: "contract_payment_complete" }
      : { state: "not_required", reason: "contract_payment_incomplete" };
  }

  if (dateOfBirth === null) {
    return { state: "pending_information", reason: "date_of_birth_missing" };
  }
  const birth = parseIsoDateParts(dateOfBirth);
  if (!birth) {
    return { state: "pending_information", reason: "date_of_birth_invalid" };
  }
  const asOf = asOfDate === null ? null : parseIsoDateParts(asOfDate);
  if (!asOf) {
    return { state: "pending_information", reason: "as_of_date_invalid" };
  }

  let age = asOf.year - birth.year;
  if (
    asOf.month < birth.month
    || (asOf.month === birth.month && asOf.day < birth.day)
  ) {
    age -= 1;
  }
  if (age < 0 || age > 120) {
    return { state: "pending_information", reason: "date_of_birth_invalid" };
  }
  return age < 18
    ? { state: "required", reason: "applicant_is_minor" }
    : { state: "not_required", reason: "applicant_is_adult" };
}

export type PlatformDocumentValidationState =
  | "not_started"
  | "queued"
  | "processing"
  | "clean"
  | "failed";

export type PlatformDocumentExtractionState =
  | "not_required"
  | "not_started"
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "superseded";

export type PlatformDocumentHumanReviewState =
  | "not_required"
  | "pending"
  | "approved"
  | "correction_required"
  | "rejected";

export type PlatformDocumentDisplayEvidence = Readonly<{
  applicability: "required" | "not_required" | "pending_information";
  hasCurrentVersion: boolean;
  immutableBytesFinalized: boolean;
  validationState: PlatformDocumentValidationState;
  extractionState: PlatformDocumentExtractionState;
  humanReviewState: PlatformDocumentHumanReviewState;
  candidateStatuses: readonly PlatformDocumentExtractedFactStatus[];
  validationLeaseActive: boolean;
  extractionLeaseActive: boolean;
  deterministicChecksPassed: boolean;
  requiredHumanDecisionsPassed: boolean;
}>;

export function derivePlatformDocumentDisplayState(
  evidence: PlatformDocumentDisplayEvidence,
): PlatformDocumentDisplayState {
  if (evidence.applicability === "not_required") return "not_required";
  if (evidence.applicability === "pending_information") return "needs_review";
  if (!evidence.hasCurrentVersion) return "missing";
  if (!evidence.immutableBytesFinalized) return "failed";
  if (
    evidence.validationState === "failed"
    || evidence.extractionState === "failed"
    || evidence.humanReviewState === "correction_required"
    || evidence.humanReviewState === "rejected"
  ) {
    return "failed";
  }
  if (
    (evidence.validationState === "processing" && evidence.validationLeaseActive)
    || (evidence.extractionState === "processing" && evidence.extractionLeaseActive)
  ) {
    return "processing";
  }
  if (evidence.validationState !== "clean") return "received";
  if (
    evidence.extractionState !== "not_required"
    && evidence.extractionState !== "succeeded"
  ) {
    return "received";
  }
  if (
    evidence.candidateStatuses.some(
      (status) => status === "proposed" || status === "conflict",
    )
    || evidence.humanReviewState === "pending"
    || !evidence.requiredHumanDecisionsPassed
  ) {
    return "needs_review";
  }
  return evidence.deterministicChecksPassed ? "confirmed" : "needs_review";
}

export type PlatformStudentProfileMutationGuardReason =
  | "invalid_revision"
  | "stale_profile_revision"
  | "stale_field_revision"
  | "candidate_not_actionable"
  | "stale_document_version"
  | "newer_confirmed_source";

export type PlatformStudentProfileMutationGuardResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reason: PlatformStudentProfileMutationGuardReason;
    }>;

export function guardPlatformStudentProfileMutationRevisions(input: Readonly<{
  expectedProfileRevision: number;
  currentProfileRevision: number;
  expectedFieldRevision: number | null;
  currentFieldRevision: number | null;
}>): PlatformStudentProfileMutationGuardResult {
  if (
    !Number.isInteger(input.expectedProfileRevision)
    || !Number.isInteger(input.currentProfileRevision)
    || input.expectedProfileRevision < 1
    || input.currentProfileRevision < 1
    || (input.expectedFieldRevision !== null
      && (!Number.isInteger(input.expectedFieldRevision)
        || input.expectedFieldRevision < 1))
    || (input.currentFieldRevision !== null
      && (!Number.isInteger(input.currentFieldRevision)
        || input.currentFieldRevision < 1))
  ) {
    return { ok: false, reason: "invalid_revision" };
  }
  if (input.expectedProfileRevision !== input.currentProfileRevision) {
    return { ok: false, reason: "stale_profile_revision" };
  }
  if (input.expectedFieldRevision !== input.currentFieldRevision) {
    return { ok: false, reason: "stale_field_revision" };
  }
  return { ok: true };
}

export function guardPlatformExtractedFactDecision<
  K extends PlatformStudentDocumentProfileFieldKey,
>(input: Readonly<{
  action: "confirm" | "reject";
  fact: PlatformDocumentExtractedFact<K>;
  expectedProfileRevision: number;
  currentProfileRevision: number;
  expectedFieldRevision: number | null;
  currentFieldValue: PlatformConfirmedStudentDocumentProfileFieldValue<K> | null;
  currentDocumentVersionId: string;
  currentDocumentVersionNumber: number;
}>): PlatformStudentProfileMutationGuardResult {
  const revisionGuard = guardPlatformStudentProfileMutationRevisions({
    expectedProfileRevision: input.expectedProfileRevision,
    currentProfileRevision: input.currentProfileRevision,
    expectedFieldRevision: input.expectedFieldRevision,
    currentFieldRevision: input.currentFieldValue?.fieldRevision ?? null,
  });
  if (!revisionGuard.ok) return revisionGuard;

  if (input.fact.status !== "proposed" && input.fact.status !== "conflict") {
    return { ok: false, reason: "candidate_not_actionable" };
  }
  if (
    input.fact.documentVersionId !== input.currentDocumentVersionId
    || input.fact.documentVersionNumber !== input.currentDocumentVersionNumber
  ) {
    return { ok: false, reason: "stale_document_version" };
  }
  if (
    input.currentFieldValue?.provenance.kind === "extracted_fact"
    && (
      input.currentFieldValue.provenance.documentVersionId
        !== input.fact.documentVersionId
      || input.currentFieldValue.provenance.documentVersionNumber
        > input.fact.documentVersionNumber
    )
  ) {
    return { ok: false, reason: "newer_confirmed_source" };
  }
  return { ok: true };
}
