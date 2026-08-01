"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformClientsActor } from "./platform-guards";
import {
  PLATFORM_PROFILE_CONSENT_STATUSES,
  parsePlatformStudentProfileUuid,
  type PlatformProfileConsentStatus,
} from "./platform-student-profile";
import { createSupabaseServerClient } from "./supabase/server";

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

type StudentProfileMutation = Readonly<{
  studentCaseId: string;
  expectedRevision: number;
  preferredDisplayName: string;
  legalDisplayName: string | null;
  dateOfBirth: string | null;
  communicationLanguage: "ru" | "en" | null;
  citizenship: string;
  residency: string;
  currentEducationSummary: string;
  academicSummary: string;
  languageSummary: string;
  budgetBand: string;
  decisionLabels: readonly string[];
  consentStatus: PlatformProfileConsentStatus;
  consentEvidenceRef: string | null;
  nextStep: string;
  reason: string;
  requestId: string;
}>;

type CountryRequirementApplyMutation = Readonly<{
  studentCaseId: string;
  countryRequirementVersionId: string;
  reason: string;
  requestId: string;
}>;

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function boundedText(
  form: FormData,
  key: string,
  minimum: number,
  maximum: number,
): string | null {
  const candidate = value(form, key);
  if (
    candidate.length < minimum ||
    candidate.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function optionalBoundedText(
  form: FormData,
  key: string,
  maximum: number,
): string | null | undefined {
  const candidate = value(form, key);
  if (!candidate) return null;
  if (candidate.length > maximum || CONTROL_CHARACTER_PATTERN.test(candidate)) {
    return undefined;
  }
  return candidate;
}

function nonNegativeInteger(raw: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function optionalDate(form: FormData, key: string): string | null | undefined {
  const candidate = value(form, key);
  if (!candidate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  if (
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getTime() > todayUtc
  ) {
    return undefined;
  }
  return candidate;
}

function decisionLabels(form: FormData): readonly string[] | null {
  const candidate = value(form, "decision_participant_labels");
  if (!candidate) return [];
  const labels = candidate.split(",").map((label) => label.trim());
  if (
    labels.length > 20 ||
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 120 ||
        CONTROL_CHARACTER_PATTERN.test(label),
    ) ||
    new Set(labels.map((label) => label.toLocaleLowerCase("en-US"))).size !== labels.length
  ) {
    return null;
  }
  return labels;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
}

function validSha256(candidate: unknown): boolean {
  return typeof candidate === "string" && SHA256_PATTERN.test(candidate);
}

function validUpdatedFieldNames(candidate: unknown): boolean {
  return Array.isArray(candidate)
    && candidate.length <= 16
    && candidate.every(
      (field) => typeof field === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(field),
    )
    && new Set(candidate).size === candidate.length;
}

function parseStudentProfileForm(form: FormData): StudentProfileMutation | null {
  const studentCaseId = parsePlatformStudentProfileUuid(value(form, "student_case_id"));
  const expectedRevision = nonNegativeInteger(value(form, "expected_revision"));
  const requestId = parsePlatformStudentProfileUuid(value(form, "request_id"));
  const preferredDisplayName = boundedText(form, "preferred_display_name", 1, 160);
  const legalDisplayName = optionalBoundedText(form, "legal_display_name", 200);
  const dateOfBirth = optionalDate(form, "date_of_birth");
  const rawLanguage = value(form, "communication_language");
  const communicationLanguage = rawLanguage === "ru" || rawLanguage === "en"
    ? rawLanguage
    : null;
  const citizenship = boundedText(form, "citizenship_country", 1, 120);
  const residency = boundedText(form, "residency_country", 1, 120);
  const currentEducationSummary = boundedText(
    form,
    "current_education_summary",
    1,
    2000,
  );
  const academicSummary = boundedText(form, "academic_summary", 1, 2000);
  const languageSummary = boundedText(form, "language_summary", 1, 2000);
  const budgetBand = boundedText(form, "budget_band", 1, 120);
  const parsedDecisionLabels = decisionLabels(form);
  const rawConsentStatus = value(form, "consent_status");
  const consentStatus = (PLATFORM_PROFILE_CONSENT_STATUSES as readonly string[])
    .includes(rawConsentStatus)
    ? (rawConsentStatus as PlatformProfileConsentStatus)
    : null;
  const consentEvidenceRef = optionalBoundedText(form, "consent_evidence_ref", 512);
  const nextStep = boundedText(form, "profile_next_step", 1, 1000);
  const reason = boundedText(form, "reason", 3, 500);

  if (
    !studentCaseId ||
    expectedRevision === null ||
    !requestId ||
    !preferredDisplayName ||
    legalDisplayName === undefined ||
    dateOfBirth === undefined ||
    !communicationLanguage ||
    !citizenship ||
    !residency ||
    !currentEducationSummary ||
    !academicSummary ||
    !languageSummary ||
    !budgetBand ||
    parsedDecisionLabels === null ||
    !consentStatus ||
    consentEvidenceRef === undefined ||
    !nextStep ||
    !reason ||
    (consentStatus === "not_recorded" && consentEvidenceRef !== null) ||
    (consentStatus !== "not_recorded" && consentEvidenceRef === null)
  ) {
    return null;
  }

  return {
    studentCaseId,
    expectedRevision,
    preferredDisplayName,
    legalDisplayName,
    dateOfBirth,
    communicationLanguage,
    citizenship,
    residency,
    currentEducationSummary,
    academicSummary,
    languageSummary,
    budgetBand,
    decisionLabels: parsedDecisionLabels,
    consentStatus,
    consentEvidenceRef,
    nextStep,
    reason,
    requestId,
  };
}

function parseCountryRequirementApplyForm(
  form: FormData,
): CountryRequirementApplyMutation | null {
  const studentCaseId = parsePlatformStudentProfileUuid(value(form, "student_case_id"));
  const countryRequirementVersionId = parsePlatformStudentProfileUuid(
    value(form, "country_requirement_version_id"),
  );
  const requestId = parsePlatformStudentProfileUuid(value(form, "request_id"));
  const reason = boundedText(form, "reason", 3, 500);
  return studentCaseId && countryRequirementVersionId && requestId && reason
    ? { studentCaseId, countryRequirementVersionId, requestId, reason }
    : null;
}

function mutationRedirect(
  studentCaseId: string | null,
  outcome: "saved" | "invalid" | "unavailable",
  requestId?: string,
): never {
  const target = studentCaseId ? `/clients/${studentCaseId}` : "/clients";
  const params = new URLSearchParams({ result: outcome });
  if (requestId && outcome !== "saved") params.set("retry_request_id", requestId);
  redirect(`${target}?${params.toString()}`);
}

export async function updatePlatformStudentProfileAction(form: FormData): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const parsed = parseStudentProfileForm(form);
  if (!parsed) {
    mutationRedirect(
      parsePlatformStudentProfileUuid(value(form, "student_case_id")),
      "invalid",
      parsePlatformStudentProfileUuid(value(form, "request_id")) ?? undefined,
    );
  }

  let response: { data: unknown; error: unknown };
  try {
    const client = await createSupabaseServerClient();
    response = await client.schema("platform").rpc("upsert_student_profile", {
      p_organization_id: actor.organizationId,
      p_student_case_id: parsed.studentCaseId,
      p_expected_revision: parsed.expectedRevision,
      p_preferred_display_name: parsed.preferredDisplayName,
      p_legal_display_name: parsed.legalDisplayName,
      p_date_of_birth: parsed.dateOfBirth,
      p_communication_language: parsed.communicationLanguage,
      p_citizenship_country: parsed.citizenship,
      p_residency_country: parsed.residency,
      p_current_education_summary: parsed.currentEducationSummary,
      p_academic_summary: parsed.academicSummary,
      p_language_summary: parsed.languageSummary,
      p_budget_band: parsed.budgetBand,
      p_decision_participant_labels: parsed.decisionLabels,
      p_consent_status: parsed.consentStatus,
      p_consent_evidence_ref: parsed.consentEvidenceRef,
      p_next_step: parsed.nextStep,
      p_reason: parsed.reason,
      p_request_id: parsed.requestId,
    });
  } catch {
    mutationRedirect(parsed.studentCaseId, "unavailable", parsed.requestId);
  }

  if (
    response.error ||
    !isRecord(response.data) ||
    response.data.organization_id !== actor.organizationId ||
    response.data.student_case_id !== parsed.studentCaseId ||
    !parsePlatformStudentProfileUuid(response.data.student_profile_id) ||
    !parsePlatformStudentProfileUuid(
      response.data.applied_country_requirement_version_id,
    ) ||
    nonNegativeInteger(String(response.data.revision ?? "")) !== parsed.expectedRevision + 1 ||
    !validUpdatedFieldNames(response.data.updated_field_names) ||
    !validSha256(response.data.input_sha256)
  ) {
    mutationRedirect(parsed.studentCaseId, "unavailable", parsed.requestId);
  }

  revalidatePath(`/clients/${parsed.studentCaseId}`);
  revalidatePath("/portal");
  mutationRedirect(parsed.studentCaseId, "saved");
}

export async function applyPlatformCountryRequirementVersionAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const parsed = parseCountryRequirementApplyForm(form);
  if (!parsed || actor.platformRole !== "admin") {
    mutationRedirect(
      parsePlatformStudentProfileUuid(value(form, "student_case_id")),
      "invalid",
      parsePlatformStudentProfileUuid(value(form, "request_id")) ?? undefined,
    );
  }

  let response: { data: unknown; error: unknown };
  try {
    const client = await createSupabaseServerClient();
    response = await client.schema("platform").rpc("apply_country_requirement_version", {
      p_organization_id: actor.organizationId,
      p_student_case_id: parsed.studentCaseId,
      p_country_requirement_version_id: parsed.countryRequirementVersionId,
      p_reason: parsed.reason,
      p_request_id: parsed.requestId,
    });
  } catch {
    mutationRedirect(parsed.studentCaseId, "unavailable", parsed.requestId);
  }

  if (
    response.error ||
    !isRecord(response.data) ||
    response.data.organization_id !== actor.organizationId ||
    response.data.student_case_id !== parsed.studentCaseId ||
    response.data.country_requirement_version_id !== parsed.countryRequirementVersionId ||
    nonNegativeInteger(String(response.data.document_slot_count ?? "")) === null ||
    nonNegativeInteger(String(response.data.version ?? "")) === null ||
    !validSha256(response.data.input_sha256)
  ) {
    mutationRedirect(parsed.studentCaseId, "unavailable", parsed.requestId);
  }

  revalidatePath(`/clients/${parsed.studentCaseId}`);
  revalidatePath("/portal");
  mutationRedirect(parsed.studentCaseId, "saved");
}
