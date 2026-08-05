const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSPORT_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,23}$/;
const PERSON_NAME_PATTERN = /^[\p{L}\p{M} '\u2019-]+$/u;

export const PLATFORM_STUDENT_DOCUMENT_PROFILE_CATEGORIES = [
  "identity",
  "personal",
  "language",
  "education",
  "study",
  "father",
  "mother",
  "emergency",
  "visa",
  "health",
  "referral",
  "acknowledgement",
  "preferences",
  "decision",
  "consent",
  "workflow",
] as const;

export type PlatformStudentDocumentProfileCategory =
  (typeof PLATFORM_STUDENT_DOCUMENT_PROFILE_CATEGORIES)[number];

export const PLATFORM_STUDENT_DOCUMENT_PROFILE_VALUE_KINDS = [
  "name",
  "text",
  "email",
  "phone",
  "date",
  "country_code",
  "passport_number",
  "communication_language",
  "language_level",
  "education_history",
  "year",
  "money",
  "boolean",
  "text_array",
  "consent_status",
] as const;

export type PlatformStudentDocumentProfileValueKind =
  (typeof PLATFORM_STUDENT_DOCUMENT_PROFILE_VALUE_KINDS)[number];

export type PlatformStudentEducationHistoryEntry = Readonly<{
  school_name: string;
  country_city: string;
  year_from: number;
  year_to: number;
  degree_certificate: string;
}>;

export type PlatformStudentAnnualBudget = Readonly<{
  amount: number;
  currency: string;
}>;

export interface PlatformStudentDocumentProfileFieldValues {
  "identity.preferred_display_name": string;
  "identity.legal_display_name": string;
  "preferences.communication_language": "ru" | "en";
  "personal.date_of_birth": string;
  "personal.citizenship_country": string;
  "personal.residency_country": string;
  "education.current_summary": string;
  "education.academic_summary": string;
  "language.summary": string;
  "study.budget_band": string;
  "decision.participant_labels": readonly string[];
  "consent.status": "not_recorded" | "granted" | "withdrawn";
  "consent.evidence_ref": string;
  "workflow.next_step": string;
  "personal.first_name": string;
  "personal.last_name": string;
  "personal.passport_number": string;
  "personal.passport_expiry_date": string;
  "personal.permanent_address": string;
  "personal.mobile_phone": string;
  "personal.messaging_contact": string;
  "personal.student_email": string;
  "personal.chinese_level": string;
  "personal.english_level": string;
  "education.history": readonly PlatformStudentEducationHistoryEntry[];
  "education.current_study_status": string;
  "education.expected_graduation_year": number;
  "education.extracurricular_achievements": string;
  "study.desired_country": string;
  "study.desired_university": string;
  "study.field_major": string;
  "study.program_level": string;
  "study.desired_start_date": string;
  "study.budget_per_year": PlatformStudentAnnualBudget;
  "study.scholarship_interest": boolean;
  "study.field_choice_reason": string;
  "father.first_name": string;
  "father.last_name": string;
  "father.employer": string;
  "father.job_title": string;
  "father.mobile_phone": string;
  "father.work_email": string;
  "father.personal_email": string;
  "mother.first_name": string;
  "mother.last_name": string;
  "mother.employer": string;
  "mother.job_title": string;
  "mother.mobile_phone": string;
  "mother.work_email": string;
  "mother.personal_email": string;
  "emergency.contact_name": string;
  "emergency.relationship": string;
  "emergency.phone_or_email": string;
  "visa.previous_refusal": boolean;
  "visa.refusal_country": string;
  "health.chronic_or_allergies": boolean;
  "health.details": string;
  "referral.source": string;
  "acknowledgement.student_signature": boolean;
  "acknowledgement.student_signature_date": string;
  "acknowledgement.parent_signature": boolean;
  "acknowledgement.parent_signature_date": string;
}

export type PlatformStudentDocumentProfileFieldKey =
  keyof PlatformStudentDocumentProfileFieldValues;

export type PlatformStudentDocumentProfileFieldDefinition = Readonly<{
  key: PlatformStudentDocumentProfileFieldKey;
  category: PlatformStudentDocumentProfileCategory;
  valueKind: PlatformStudentDocumentProfileValueKind;
  sensitive: boolean;
  maximumLength?: number;
}>;

const field = (
  key: PlatformStudentDocumentProfileFieldKey,
  category: PlatformStudentDocumentProfileCategory,
  valueKind: PlatformStudentDocumentProfileValueKind,
  sensitive: boolean,
  maximumLength?: number,
): PlatformStudentDocumentProfileFieldDefinition => ({
  key,
  category,
  valueKind,
  sensitive,
  ...(maximumLength === undefined ? {} : { maximumLength }),
});

export const PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_CATALOG = [
  field("identity.preferred_display_name", "identity", "name", false, 160),
  field("identity.legal_display_name", "identity", "name", true, 200),
  field(
    "preferences.communication_language",
    "preferences",
    "communication_language",
    false,
  ),
  field("personal.date_of_birth", "personal", "date", true),
  field("personal.citizenship_country", "personal", "country_code", true),
  field("personal.residency_country", "personal", "country_code", true),
  field("education.current_summary", "education", "text", true, 2_000),
  field("education.academic_summary", "education", "text", true, 2_000),
  field("language.summary", "language", "text", true, 2_000),
  field("study.budget_band", "study", "text", true, 120),
  field("decision.participant_labels", "decision", "text_array", true),
  field("consent.status", "consent", "consent_status", true),
  field("consent.evidence_ref", "consent", "text", true, 512),
  field("workflow.next_step", "workflow", "text", true, 1_000),
  field("personal.first_name", "personal", "name", true, 100),
  field("personal.last_name", "personal", "name", true, 100),
  field("personal.passport_number", "personal", "passport_number", true),
  field("personal.passport_expiry_date", "personal", "date", true),
  field("personal.permanent_address", "personal", "text", true, 500),
  field("personal.mobile_phone", "personal", "phone", true),
  field("personal.messaging_contact", "personal", "text", true, 160),
  field("personal.student_email", "personal", "email", true),
  field("personal.chinese_level", "personal", "language_level", true, 120),
  field("personal.english_level", "personal", "language_level", true, 120),
  field("education.history", "education", "education_history", true),
  field("education.current_study_status", "education", "text", true, 300),
  field("education.expected_graduation_year", "education", "year", true),
  field("education.extracurricular_achievements", "education", "text", true, 1_200),
  field("study.desired_country", "study", "country_code", false),
  field("study.desired_university", "study", "text", false, 300),
  field("study.field_major", "study", "text", false, 300),
  field("study.program_level", "study", "text", false, 160),
  field("study.desired_start_date", "study", "date", false),
  field("study.budget_per_year", "study", "money", true),
  field("study.scholarship_interest", "study", "boolean", false),
  field("study.field_choice_reason", "study", "text", false, 1_200),
  field("father.first_name", "father", "name", true, 100),
  field("father.last_name", "father", "name", true, 100),
  field("father.employer", "father", "text", true, 300),
  field("father.job_title", "father", "text", true, 200),
  field("father.mobile_phone", "father", "phone", true),
  field("father.work_email", "father", "email", true),
  field("father.personal_email", "father", "email", true),
  field("mother.first_name", "mother", "name", true, 100),
  field("mother.last_name", "mother", "name", true, 100),
  field("mother.employer", "mother", "text", true, 300),
  field("mother.job_title", "mother", "text", true, 200),
  field("mother.mobile_phone", "mother", "phone", true),
  field("mother.work_email", "mother", "email", true),
  field("mother.personal_email", "mother", "email", true),
  field("emergency.contact_name", "emergency", "name", true, 200),
  field("emergency.relationship", "emergency", "text", true, 120),
  field("emergency.phone_or_email", "emergency", "text", true, 320),
  field("visa.previous_refusal", "visa", "boolean", true),
  field("visa.refusal_country", "visa", "country_code", true),
  field("health.chronic_or_allergies", "health", "boolean", true),
  field("health.details", "health", "text", true, 1_200),
  field("referral.source", "referral", "text", false, 500),
  field("acknowledgement.student_signature", "acknowledgement", "boolean", true),
  field("acknowledgement.student_signature_date", "acknowledgement", "date", true),
  field("acknowledgement.parent_signature", "acknowledgement", "boolean", true),
  field("acknowledgement.parent_signature_date", "acknowledgement", "date", true),
] as const satisfies readonly PlatformStudentDocumentProfileFieldDefinition[];

const FIELD_DEFINITION_BY_KEY = new Map<
  PlatformStudentDocumentProfileFieldKey,
  PlatformStudentDocumentProfileFieldDefinition
>(PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_CATALOG.map((definition) => [
  definition.key,
  definition,
]));

export const PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_KEYS =
  PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_CATALOG.map(
    (definition) => definition.key,
  ) as readonly PlatformStudentDocumentProfileFieldKey[];

export type PlatformStudentDocumentProfileFieldIssueCode =
  | "invalid_type"
  | "invalid_format"
  | "invalid_range"
  | "too_long"
  | "missing_dependent_field"
  | "unexpected_dependent_field"
  | "inconsistent_date"
  | "duplicate_field"
  | "mixed_profile_revision"
  | "projection_too_long";

export type PlatformStudentDocumentProfileFieldIssue = Readonly<{
  fieldKey: PlatformStudentDocumentProfileFieldKey;
  code: PlatformStudentDocumentProfileFieldIssueCode;
}>;

export type PlatformStudentDocumentProfileNormalizationResult<
  K extends PlatformStudentDocumentProfileFieldKey,
> =
  | Readonly<{
      ok: true;
      value: PlatformStudentDocumentProfileFieldValues[K];
    }>
  | Readonly<{
      ok: false;
      issues: readonly PlatformStudentDocumentProfileFieldIssue[];
    }>;

function issue<K extends PlatformStudentDocumentProfileFieldKey>(
  fieldKey: K,
  code: PlatformStudentDocumentProfileFieldIssueCode,
): PlatformStudentDocumentProfileNormalizationResult<K> {
  return { ok: false, issues: [{ fieldKey, code }] };
}

function normalizeText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTER_PATTERN.test(value)) {
    return null;
  }
  const normalized = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > maximumLength) return null;
  return normalized;
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900
    && year <= 2099
    && candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
    ? value
    : null;
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTER_PATTERN.test(value)) {
    return null;
  }
  const trimmed = value.trim();
  const hasInternationalPrefix = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${hasInternationalPrefix ? "+" : ""}${digits}`;
}

function normalizeEducationHistory(
  value: unknown,
): readonly PlatformStudentEducationHistoryEntry[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    return null;
  }

  const entries: PlatformStudentEducationHistoryEntry[] = [];
  for (const rawEntry of value) {
    if (
      typeof rawEntry !== "object"
      || rawEntry === null
      || Array.isArray(rawEntry)
    ) {
      return null;
    }
    const entry = rawEntry as Record<string, unknown>;
    const schoolName = normalizeText(entry.school_name, 240);
    const countryCity = normalizeText(entry.country_city, 240);
    const yearFrom = entry.year_from;
    const yearTo = entry.year_to;
    const degreeCertificate = normalizeText(entry.degree_certificate, 240);

    if (
      !schoolName
      || !countryCity
      || !Number.isInteger(yearFrom)
      || !Number.isInteger(yearTo)
      || (yearFrom as number) < 1900
      || (yearFrom as number) > 2099
      || (yearTo as number) < (yearFrom as number)
      || (yearTo as number) > 2099
      || !degreeCertificate
    ) {
      return null;
    }

    entries.push({
      school_name: schoolName,
      country_city: countryCity,
      year_from: yearFrom as number,
      year_to: yearTo as number,
      degree_certificate: degreeCertificate,
    });
  }
  return entries;
}

function normalizeMoney(value: unknown): PlatformStudentAnnualBudget | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const money = value as Record<string, unknown>;
  if (
    typeof money.amount !== "number"
    || !Number.isFinite(money.amount)
    || money.amount < 0
    || money.amount > 999_999_999_999.99
    || Math.round(money.amount * 100) !== money.amount * 100
    || typeof money.currency !== "string"
    || !/^[A-Z]{3}$/.test(money.currency)
  ) {
    return null;
  }
  return {
    amount: money.amount,
    currency: money.currency,
  };
}

function normalizeTextArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const normalized = value.map((item) => normalizeText(item, 120));
  if (normalized.some((item) => item === null)) return null;
  const items = normalized as string[];
  return new Set(items.map((item) => item.toLocaleLowerCase("en-US"))).size
    === items.length
    ? items
    : null;
}

export function normalizePlatformStudentDocumentProfileField<
  K extends PlatformStudentDocumentProfileFieldKey,
>(
  fieldKey: K,
  value: unknown,
): PlatformStudentDocumentProfileNormalizationResult<K> {
  const definition = FIELD_DEFINITION_BY_KEY.get(fieldKey);
  if (!definition) return issue(fieldKey, "invalid_format");

  let normalized: unknown = null;
  switch (definition.valueKind) {
    case "name": {
      normalized = normalizeText(value, definition.maximumLength ?? 200);
      if (typeof normalized === "string" && !PERSON_NAME_PATTERN.test(normalized)) {
        normalized = null;
      }
      break;
    }
    case "text":
    case "language_level":
      normalized = normalizeText(value, definition.maximumLength ?? 2_000);
      break;
    case "email": {
      const email = normalizeText(value, 254)?.toLocaleLowerCase("en-US") ?? null;
      normalized = email && EMAIL_PATTERN.test(email) ? email : null;
      break;
    }
    case "phone":
      normalized = normalizePhone(value);
      break;
    case "date":
      normalized = parseIsoDate(value);
      break;
    case "country_code": {
      const countryCode = typeof value === "string"
        ? value.trim().toUpperCase()
        : "";
      normalized = ISO_COUNTRY_CODE_PATTERN.test(countryCode)
        ? countryCode
        : null;
      break;
    }
    case "passport_number": {
      const passportNumber = typeof value === "string"
        ? value.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "")
        : "";
      normalized = PASSPORT_NUMBER_PATTERN.test(passportNumber)
        ? passportNumber
        : null;
      break;
    }
    case "communication_language":
      normalized = value === "ru" || value === "en" ? value : null;
      break;
    case "education_history":
      normalized = normalizeEducationHistory(value);
      break;
    case "year":
      normalized = Number.isInteger(value) && (value as number) >= 1900
        && (value as number) <= 2099
        ? value
        : null;
      break;
    case "money":
      normalized = normalizeMoney(value);
      break;
    case "boolean":
      normalized = typeof value === "boolean" ? value : null;
      break;
    case "text_array":
      normalized = normalizeTextArray(value);
      break;
    case "consent_status":
      normalized = value === "not_recorded"
        || value === "granted"
        || value === "withdrawn"
        ? value
        : null;
      break;
  }

  if (normalized === null) {
    return issue(
      fieldKey,
      typeof value === "string" || typeof value === "object"
        ? "invalid_format"
        : "invalid_type",
    );
  }
  return {
    ok: true,
    value: normalized as PlatformStudentDocumentProfileFieldValues[K],
  };
}

export type PlatformNormalizedStudentDocumentProfile = Readonly<
  Partial<PlatformStudentDocumentProfileFieldValues>
>;

export function validatePlatformStudentDocumentProfileConsistency(
  profile: PlatformNormalizedStudentDocumentProfile,
): readonly PlatformStudentDocumentProfileFieldIssue[] {
  const issues: PlatformStudentDocumentProfileFieldIssue[] = [];
  const dependent = (
    flagKey:
      | "visa.previous_refusal"
      | "health.chronic_or_allergies"
      | "acknowledgement.student_signature"
      | "acknowledgement.parent_signature",
    detailKey:
      | "visa.refusal_country"
      | "health.details"
      | "acknowledgement.student_signature_date"
      | "acknowledgement.parent_signature_date",
  ) => {
    const flag = profile[flagKey];
    const detail = profile[detailKey];
    if (flag === true && detail === undefined) {
      issues.push({ fieldKey: detailKey, code: "missing_dependent_field" });
    }
    if (flag === false && detail !== undefined) {
      issues.push({ fieldKey: detailKey, code: "unexpected_dependent_field" });
    }
  };

  dependent("visa.previous_refusal", "visa.refusal_country");
  dependent("health.chronic_or_allergies", "health.details");
  dependent(
    "acknowledgement.student_signature",
    "acknowledgement.student_signature_date",
  );
  dependent(
    "acknowledgement.parent_signature",
    "acknowledgement.parent_signature_date",
  );

  if (
    profile["consent.status"] === "not_recorded"
    && profile["consent.evidence_ref"] !== undefined
  ) {
    issues.push({
      fieldKey: "consent.evidence_ref",
      code: "unexpected_dependent_field",
    });
  }
  if (
    (profile["consent.status"] === "granted"
      || profile["consent.status"] === "withdrawn")
    && profile["consent.evidence_ref"] === undefined
  ) {
    issues.push({
      fieldKey: "consent.evidence_ref",
      code: "missing_dependent_field",
    });
  }

  if (
    profile["personal.date_of_birth"] !== undefined
    && profile["personal.passport_expiry_date"] !== undefined
    && profile["personal.passport_expiry_date"]
      <= profile["personal.date_of_birth"]
  ) {
    issues.push({
      fieldKey: "personal.passport_expiry_date",
      code: "inconsistent_date",
    });
  }
  return issues;
}

export type PlatformStudentDocumentFieldProvenance =
  | Readonly<{
      kind: "manual";
      decisionId: string;
    }>
  | Readonly<{
      kind: "extracted_fact";
      decisionId: string;
      factId: string;
      documentVersionId: string;
      documentVersionNumber: number;
    }>;

export type PlatformConfirmedStudentDocumentProfileFieldValue<
  K extends PlatformStudentDocumentProfileFieldKey =
    PlatformStudentDocumentProfileFieldKey,
> = K extends PlatformStudentDocumentProfileFieldKey
  ? Readonly<{
      fieldKey: K;
      value: PlatformStudentDocumentProfileFieldValues[K];
      fieldRevision: number;
      profileRevision: number;
      confirmedAt: string;
      provenance: PlatformStudentDocumentFieldProvenance;
    }>
  : never;

export type PlatformCanonicalStudentProfileProjection = Readonly<{
  preferredDisplayName?: string;
  legalDisplayName?: string;
  communicationLanguage?: "ru" | "en";
  dateOfBirth?: string;
  citizenshipCountry?: string;
  residencyCountry?: string;
  currentEducationSummary?: string;
  academicSummary?: string;
  languageSummary?: string;
  budgetBand?: string;
  decisionParticipantLabels?: readonly string[];
  consentStatus?: "not_recorded" | "granted" | "withdrawn";
  consentEvidenceRef?: string;
  nextStep?: string;
}>;

export type PlatformCanonicalStudentProfileProjectionResult =
  | Readonly<{
      ok: true;
      profileRevision: number;
      projection: PlatformCanonicalStudentProfileProjection;
    }>
  | Readonly<{
      ok: false;
      issues: readonly PlatformStudentDocumentProfileFieldIssue[];
    }>;

function formatEducationHistory(
  history: readonly PlatformStudentEducationHistoryEntry[],
): string {
  return history.map((entry) => {
    return `${entry.school_name} (${entry.country_city}; ${entry.year_from}-${entry.year_to}, ${entry.degree_certificate})`;
  }).join("; ");
}

function formatBudget(budget: PlatformStudentAnnualBudget): string {
  return `${budget.currency} ${budget.amount.toFixed(2)} per year`;
}

export function projectConfirmedFieldsToCanonicalStudentProfile(
  confirmedFields: readonly PlatformConfirmedStudentDocumentProfileFieldValue[],
  profileRevision: number,
): PlatformCanonicalStudentProfileProjectionResult {
  const values: Partial<PlatformStudentDocumentProfileFieldValues> = {};
  const seen = new Set<PlatformStudentDocumentProfileFieldKey>();
  const issues: PlatformStudentDocumentProfileFieldIssue[] = [];

  for (const confirmedField of confirmedFields) {
    if (seen.has(confirmedField.fieldKey)) {
      issues.push({
        fieldKey: confirmedField.fieldKey,
        code: "duplicate_field",
      });
      continue;
    }
    seen.add(confirmedField.fieldKey);
    if (confirmedField.profileRevision !== profileRevision) {
      issues.push({
        fieldKey: confirmedField.fieldKey,
        code: "mixed_profile_revision",
      });
      continue;
    }
    Object.assign(values, {
      [confirmedField.fieldKey]: confirmedField.value,
    });
  }

  if (issues.length > 0) return { ok: false, issues };

  const projection: {
    preferredDisplayName?: string;
    legalDisplayName?: string;
    communicationLanguage?: "ru" | "en";
    dateOfBirth?: string;
    citizenshipCountry?: string;
    residencyCountry?: string;
    currentEducationSummary?: string;
    academicSummary?: string;
    languageSummary?: string;
    budgetBand?: string;
    decisionParticipantLabels?: readonly string[];
    consentStatus?: "not_recorded" | "granted" | "withdrawn";
    consentEvidenceRef?: string;
    nextStep?: string;
  } = {};

  const derivedLegalName = values["personal.first_name"]
    && values["personal.last_name"]
    ? `${values["personal.first_name"]} ${values["personal.last_name"]}`
    : undefined;
  const preferredDisplayName = values["identity.preferred_display_name"]
    ?? values["personal.first_name"];
  if (preferredDisplayName) {
    projection.preferredDisplayName = preferredDisplayName;
  }
  const legalDisplayName = values["identity.legal_display_name"]
    ?? derivedLegalName;
  if (legalDisplayName) projection.legalDisplayName = legalDisplayName;
  if (values["preferences.communication_language"]) {
    projection.communicationLanguage =
      values["preferences.communication_language"];
  }
  if (values["personal.date_of_birth"]) {
    projection.dateOfBirth = values["personal.date_of_birth"];
  }
  if (values["personal.citizenship_country"]) {
    projection.citizenshipCountry = values["personal.citizenship_country"];
  }
  if (values["personal.residency_country"]) {
    projection.residencyCountry = values["personal.residency_country"];
  }

  const educationSummaryParts = [
    values["education.current_study_status"],
    values["education.history"]
      ? formatEducationHistory(values["education.history"])
      : undefined,
  ].filter((part): part is string => Boolean(part));
  if (values["education.current_summary"]) {
    projection.currentEducationSummary = values["education.current_summary"];
  } else if (educationSummaryParts.length > 0) {
    projection.currentEducationSummary = educationSummaryParts.join("; ");
  }

  const academicSummaryParts = [
    values["education.history"]
      ? formatEducationHistory(values["education.history"])
      : undefined,
    values["education.extracurricular_achievements"],
  ].filter((part): part is string => Boolean(part));
  if (values["education.academic_summary"]) {
    projection.academicSummary = values["education.academic_summary"];
  } else if (academicSummaryParts.length > 0) {
    projection.academicSummary = academicSummaryParts.join("; ");
  }

  const languageSummaryParts = [
    values["personal.chinese_level"]
      ? `Chinese: ${values["personal.chinese_level"]}`
      : undefined,
    values["personal.english_level"]
      ? `English: ${values["personal.english_level"]}`
      : undefined,
  ].filter((part): part is string => Boolean(part));
  if (values["language.summary"]) {
    projection.languageSummary = values["language.summary"];
  } else if (languageSummaryParts.length > 0) {
    projection.languageSummary = languageSummaryParts.join("; ");
  }
  if (values["study.budget_band"]) {
    projection.budgetBand = values["study.budget_band"];
  } else if (values["study.budget_per_year"]) {
    projection.budgetBand = formatBudget(values["study.budget_per_year"]);
  }
  if (values["decision.participant_labels"]) {
    projection.decisionParticipantLabels =
      values["decision.participant_labels"];
  }
  if (values["consent.status"]) {
    projection.consentStatus = values["consent.status"];
  }
  if (values["consent.evidence_ref"]) {
    projection.consentEvidenceRef = values["consent.evidence_ref"];
  }
  if (values["workflow.next_step"]) {
    projection.nextStep = values["workflow.next_step"];
  }

  for (const [key, value] of Object.entries(projection)) {
    const maximum = key === "preferredDisplayName" ? 160
      : key === "legalDisplayName" ? 200
      : key === "budgetBand" ? 120
      : 2_000;
    if (typeof value === "string" && value.length > maximum) {
      const fieldKey = key === "currentEducationSummary"
        ? "education.current_summary"
        : key === "academicSummary"
          ? "education.academic_summary"
          : key === "languageSummary"
            ? "language.summary"
            : key === "budgetBand"
              ? "study.budget_band"
              : "identity.preferred_display_name";
      issues.push({ fieldKey, code: "projection_too_long" });
    }
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, profileRevision, projection };
}
