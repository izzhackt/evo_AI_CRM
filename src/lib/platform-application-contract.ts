export const PLATFORM_APPLICATION_STATUSES = [
  "preparation",
  "ready",
  "submitted",
  "under_review",
  "offer",
  "rejected",
  "enrolled",
  "withdrawn",
  "closed",
] as const;

export type PlatformApplicationStatus =
  (typeof PLATFORM_APPLICATION_STATUSES)[number];

export const PLATFORM_APPLICATION_EVIDENCE_STATUSES = new Set<
  PlatformApplicationStatus
>(["submitted", "under_review", "offer", "rejected", "enrolled"]);

/**
 * The six destination countries the business works with, as ISO-3166-1
 * alpha-2 codes. Staff forms offer these as new choices; a well-formed stored
 * code outside this list remains visible and preservable during an edit.
 */
export const PLATFORM_APPLICATION_COUNTRIES = [
  "CN",
  "MY",
  "AE",
  "TR",
  "IT",
  "CZ",
] as const;

export type PlatformApplicationCountry =
  (typeof PLATFORM_APPLICATION_COUNTRIES)[number];

/**
 * Canonical machine degree keys of a university application. The schema
 * intentionally keeps the column as free TEXT (the same shape as
 * `student_cases.target_degree`); this list is the one product dictionary,
 * translated for humans only in `src/lib/v3/wording.ts`.
 */
export const PLATFORM_APPLICATION_DEGREES = [
  "foundation",
  "language",
  "bachelor",
  "master",
  "phd",
] as const;

export type PlatformApplicationDegree =
  (typeof PLATFORM_APPLICATION_DEGREES)[number];

const PLATFORM_APPLICATION_COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const PLATFORM_APPLICATION_DEGREE_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

/** True only for a well-formed ISO-3166-1 alpha-2 country code. */
export function isPlatformApplicationCountryCode(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    PLATFORM_APPLICATION_COUNTRY_CODE_PATTERN.test(value);
}

/** Mirrors the nullable degree column's non-null database CHECK. */
export function isPlatformApplicationDegreeValue(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    value !== "" &&
    !value.startsWith(" ") &&
    !value.endsWith(" ") &&
    Array.from(value).length <= 160 &&
    !PLATFORM_APPLICATION_DEGREE_CONTROL_PATTERN.test(value);
}

/**
 * Parses the nullable country select of a staff form. Empty means "no
 * country"; anything outside the fixed business list is malformed.
 */
export function parsePlatformApplicationCountryInput(
  value: unknown,
): PlatformApplicationCountry | null | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "") return null;
  return (PLATFORM_APPLICATION_COUNTRIES as readonly string[]).includes(value)
    ? (value as PlatformApplicationCountry)
    : undefined;
}

/**
 * Parses the nullable degree select of a staff form. Empty means "no
 * degree"; anything outside the canonical dictionary is malformed.
 */
export function parsePlatformApplicationDegreeInput(
  value: unknown,
): PlatformApplicationDegree | null | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "") return null;
  return (PLATFORM_APPLICATION_DEGREES as readonly string[]).includes(value)
    ? (value as PlatformApplicationDegree)
    : undefined;
}

/**
 * Returns the country choices for an edit form. A valid non-canonical value is
 * included only when it is already stored, so an unrelated edit cannot erase
 * it while the product still offers only the canonical list as new choices.
 */
export function platformApplicationCountryEditOptions(
  currentValue: string | null,
): readonly string[] {
  if (
    currentValue !== null &&
    isPlatformApplicationCountryCode(currentValue) &&
    !(PLATFORM_APPLICATION_COUNTRIES as readonly string[]).includes(currentValue)
  ) {
    return Object.freeze([...PLATFORM_APPLICATION_COUNTRIES, currentValue]);
  }
  return PLATFORM_APPLICATION_COUNTRIES;
}

/** Degree counterpart of {@link platformApplicationCountryEditOptions}. */
export function platformApplicationDegreeEditOptions(
  currentValue: string | null,
): readonly string[] {
  if (
    currentValue !== null &&
    isPlatformApplicationDegreeValue(currentValue) &&
    !(PLATFORM_APPLICATION_DEGREES as readonly string[]).includes(currentValue)
  ) {
    return Object.freeze([...PLATFORM_APPLICATION_DEGREES, currentValue]);
  }
  return PLATFORM_APPLICATION_DEGREES;
}

/**
 * Parses a details-edit country against the authoritative stored value. New
 * values must be canonical; a non-canonical value is accepted only unchanged.
 */
export function parsePlatformApplicationCountryDetailsInput(
  value: unknown,
  currentValue: string | null,
): string | null | undefined {
  const canonical = parsePlatformApplicationCountryInput(value);
  if (canonical !== undefined) return canonical;
  return isPlatformApplicationCountryCode(value) && value === currentValue
    ? value
    : undefined;
}

/** Degree counterpart of {@link parsePlatformApplicationCountryDetailsInput}. */
export function parsePlatformApplicationDegreeDetailsInput(
  value: unknown,
  currentValue: string | null,
): string | null | undefined {
  const canonical = parsePlatformApplicationDegreeInput(value);
  if (canonical !== undefined) return canonical;
  return isPlatformApplicationDegreeValue(value) && value === currentValue
    ? value
    : undefined;
}

const PLATFORM_APPLICATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORM_APPLICATION_NIL_UUID = "00000000-0000-0000-0000-000000000000";
const PLATFORM_APPLICATION_BIGINT_MAX = "9223372036854775807";
const PLATFORM_APPLICATION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PLATFORM_APPLICATION_TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function platformApplicationUuid(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !PLATFORM_APPLICATION_UUID_PATTERN.test(value)
  ) {
    return null;
  }
  const normalized = value.toLowerCase();
  return normalized === PLATFORM_APPLICATION_NIL_UUID ? null : normalized;
}

/** True only for a real proleptic-Gregorian `YYYY-MM-DD` calendar date. */
export function isPlatformApplicationCalendarDate(
  value: unknown,
): value is string {
  if (
    typeof value !== "string" ||
    !PLATFORM_APPLICATION_DATE_PATTERN.test(value)
  ) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= daysInMonth[month - 1];
}

/** Native checkbox contract: omitted/empty is false and exact `on` is true. */
export function parsePlatformApplicationPrimaryCheckbox(
  value: unknown,
): boolean | null {
  if (value === "on") return true;
  if (value === "") return false;
  return null;
}

/** Parses the nullable university-owned all-day deadline from a staff form. */
export function parsePlatformApplicationDeadlineInput(
  value: unknown,
): string | null | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "") return null;
  return isPlatformApplicationCalendarDate(value) ? value : undefined;
}

export type PlatformApplicationSwitchMetadata = Readonly<{
  demotedPrimaryApplicationId: string | null;
  demotedPrimaryApplicationVersion: string | null;
}>;

function positiveApplicationBigint(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const normalized = value.replace(/^0+(?=\d)/, "");
  if (
    normalized === "0" ||
    normalized.length > PLATFORM_APPLICATION_BIGINT_MAX.length ||
    (normalized.length === PLATFORM_APPLICATION_BIGINT_MAX.length &&
      normalized > PLATFORM_APPLICATION_BIGINT_MAX)
  ) {
    return null;
  }
  return normalized;
}

/**
 * Verifies the stable receipt metadata emitted when selecting a new primary
 * application atomically demotes a sibling. `undefined` means the provider
 * response is malformed; an object with two null fields is a valid no-switch
 * receipt.
 */
export function parsePlatformApplicationSwitchMetadata(
  value: unknown,
  targetApplicationId: string,
): PlatformApplicationSwitchMetadata | undefined {
  const normalizedTargetApplicationId = platformApplicationUuid(
    targetApplicationId,
  );
  if (
    normalizedTargetApplicationId === null ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const demotedId = record.demoted_primary_application_id;
  const demotedVersion = record.demoted_primary_application_version;
  if (demotedId === null && demotedVersion === null) {
    return Object.freeze({
      demotedPrimaryApplicationId: null,
      demotedPrimaryApplicationVersion: null,
    });
  }
  const normalizedDemotedId = platformApplicationUuid(demotedId);
  if (
    normalizedDemotedId === null ||
    normalizedDemotedId === normalizedTargetApplicationId
  ) {
    return undefined;
  }
  const normalizedVersion = positiveApplicationBigint(demotedVersion);
  if (normalizedVersion === null) return undefined;
  return Object.freeze({
    demotedPrimaryApplicationId: normalizedDemotedId,
    demotedPrimaryApplicationVersion: normalizedVersion,
  });
}

export type PlatformApplicationDetailsReceiptExpectation = Readonly<{
  organizationId: string;
  universityApplicationId: string;
  isPrimary: boolean;
  universityDeadlineOn: string | null;
  country: string | null;
  degree: string | null;
  requestId: string;
  expectedVersion: string;
}>;

export type PlatformApplicationDetailsReceipt = Readonly<{
  studentCaseId: string;
  version: string;
}>;

/**
 * Verifies the complete details-command echo and returns the database-owned
 * case id used for revalidation. The browser never supplies case authority.
 */
export function parsePlatformApplicationDetailsReceipt(
  value: unknown,
  expected: PlatformApplicationDetailsReceiptExpectation,
): PlatformApplicationDetailsReceipt | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const organizationId = platformApplicationUuid(expected.organizationId);
  const universityApplicationId = platformApplicationUuid(
    expected.universityApplicationId,
  );
  const requestId = platformApplicationUuid(expected.requestId);
  const expectedVersion = positiveApplicationBigint(expected.expectedVersion);
  const deadlineIsValid = expected.universityDeadlineOn === null ||
    isPlatformApplicationCalendarDate(expected.universityDeadlineOn);
  const countryIsValid = expected.country === null ||
    isPlatformApplicationCountryCode(expected.country);
  const degreeIsValid = expected.degree === null ||
    isPlatformApplicationDegreeValue(expected.degree);
  if (
    organizationId === null ||
    universityApplicationId === null ||
    requestId === null ||
    expectedVersion === null ||
    typeof expected.isPrimary !== "boolean" ||
    !deadlineIsValid ||
    !countryIsValid ||
    !degreeIsValid
  ) {
    return undefined;
  }

  const studentCaseId = platformApplicationUuid(record.student_case_id);
  const nextVersion = positiveApplicationBigint(record.version);
  const changedAt = record.changed_at;
  const switchMetadata = parsePlatformApplicationSwitchMetadata(
    record,
    universityApplicationId,
  );
  if (
    platformApplicationUuid(record.organization_id) !== organizationId ||
    platformApplicationUuid(record.university_application_id) !==
      universityApplicationId ||
    studentCaseId === null ||
    record.is_primary !== expected.isPrimary ||
    record.university_deadline_on !== expected.universityDeadlineOn ||
    record.country !== expected.country ||
    record.degree !== expected.degree ||
    platformApplicationUuid(record.request_id) !== requestId ||
    record.expected_version !== expectedVersion ||
    nextVersion === null ||
    BigInt(nextVersion) !== BigInt(expectedVersion) + BigInt(1) ||
    typeof changedAt !== "string" ||
    !PLATFORM_APPLICATION_TIMESTAMPTZ_PATTERN.test(changedAt) ||
    !isPlatformApplicationCalendarDate(changedAt.slice(0, 10)) ||
    !Number.isFinite(Date.parse(changedAt)) ||
    switchMetadata === undefined ||
    (!expected.isPrimary &&
      switchMetadata.demotedPrimaryApplicationId !== null)
  ) {
    return undefined;
  }
  return Object.freeze({ studentCaseId, version: nextVersion });
}

export type PlatformApplicationQueueRow = Readonly<{
  organizationId: string;
  universityApplicationId: string;
  version: string;
  studentCaseId: string;
  studentDisplayName: string;
  targetCountry: string | null;
  targetDegree: string | null;
  programDirection: string | null;
  intake: string | null;
  institutionName: string;
  programName: string;
  isPrimary: boolean;
  universityDeadlineOn: string | null;
  country: string | null;
  degree: string | null;
  status: PlatformApplicationStatus;
  latestEvidenceReference: string | null;
  createdAt: string;
  updatedAt: string;
  responsibleSalesDisplayName: string;
  currentCuratorDisplayName: string | null;
  documentCount: number;
  openDocumentCount: number;
  taskCount: number;
  openTaskCount: number;
  paymentObligationCount: number;
  outstandingPaymentObligationCount: number;
}>;
