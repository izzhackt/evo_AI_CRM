import {
  PLATFORM_APPLICATION_STATUSES,
  isPlatformApplicationCountryCode,
  type PlatformApplicationDegree,
  type PlatformApplicationStatus,
} from "../platform-application-contract.ts";
import {
  UNIVERSITY_LEVELS,
  parseUniversityContent,
  universityIntakeId,
  universityUuid,
  type UniversityContent,
  type UniversityLevel,
} from "../platform-university-catalog.ts";

/** Keep this intent unchanged until the server confirms the result. */
export type CatalogPreparationIntent = Readonly<{
  studentCaseId: string;
  institutionId: string;
  programId: string;
  intakeId: string;
  publicationVersion: number;
  requestId: string;
}>;

export type CatalogPreparationBinding = Readonly<{
  applicationId: string;
  studentCaseId: string;
  institutionId: string;
  programId: string;
  intakeId: string;
  publicationId: string;
  publicationVersion: number;
  catalogLevel: UniversityLevel;
  applicationDegree: PlatformApplicationDegree;
  selectedAt: string;
  deadlineStateAtSelection: "confirmed" | "needs_confirmation";
}>;

/** An immutable command receipt, not the application's current status. */
export type CatalogPreparationReceipt = CatalogPreparationBinding & Readonly<{
  requestId: string;
}>;

export type CatalogPreparation = CatalogPreparationBinding & Readonly<{
  applicationStatus: PlatformApplicationStatus;
  applicationVersion: string;
  content: UniversityContent;
}>;

export type CatalogPreparationFailure =
  | "invalid" | "forbidden" | "request_conflict" | "case_ineligible"
  | "stale_publication" | "program_unavailable" | "intake_unavailable"
  | "intake_identity_required" | "unsupported_country" | "intake_closed"
  | "intake_expired" | "unavailable";

export type CatalogPreparationActionResult =
  | Readonly<{ ok: true; receipt: CatalogPreparationReceipt }>
  | Readonly<{ ok: false; reason: CatalogPreparationFailure }>;

/** Unknown transport/provider failures remain uncertain; callers retain the exact intent. */
export function catalogPreparationFailure(error: Readonly<{ code?: string; message?: string }>): CatalogPreparationFailure {
  if (error.code === "42501") return "forbidden";
  if (error.code === "22023") {
    if (error.message === "catalog_preparation_request_conflict") return "request_conflict";
    if (error.message === "catalog_preparation_invalid_intent") return "invalid";
  }
  if (error.code === "PT409") {
    const reasons = [
      "case_ineligible", "stale_publication", "program_unavailable",
      "intake_unavailable", "intake_identity_required", "unsupported_country",
      "intake_closed", "intake_expired",
    ] as const;
    for (const reason of reasons) {
      if (error.message === `catalog_preparation_${reason}`) return reason;
    }
  }
  return "unavailable";
}

const INTENT_KEYS = [
  "studentCaseId", "institutionId", "programId", "intakeId",
  "publicationVersion", "requestId",
] as const;
const BINDING_KEYS = [
  "applicationId", "studentCaseId", "institutionId", "programId", "intakeId",
  "publicationId", "publicationVersion", "catalogLevel", "applicationDegree",
  "selectedAt", "deadlineStateAtSelection",
] as const;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function exact(row: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && universityUuid(value) !== null && value === value.toLowerCase();
}

function publicationVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= 1 && value <= 9007199254740990;
}

function programId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value);
}

function applicationVersion(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/u.test(value)
    && (value.length < POSTGRES_BIGINT_MAX.length || value <= POSTGRES_BIGINT_MAX);
}

/** Explicit vocabulary adapter; the original catalog level remains available. */
export function catalogApplicationDegree(level: UniversityLevel): PlatformApplicationDegree {
  return level === "doctorate" ? "phd" : level;
}

export function parseCatalogPreparationIntent(value: unknown): CatalogPreparationIntent | null {
  const row = record(value);
  if (!row || !exact(row, INTENT_KEYS) || !uuid(row.studentCaseId)
    || !uuid(row.institutionId) || !programId(row.programId)
    || !universityIntakeId(row.intakeId) || !publicationVersion(row.publicationVersion)
    || !uuid(row.requestId)) return null;
  return {
    studentCaseId: row.studentCaseId, institutionId: row.institutionId,
    programId: row.programId, intakeId: row.intakeId,
    publicationVersion: row.publicationVersion, requestId: row.requestId,
  };
}

function parseBinding(row: Record<string, unknown>): CatalogPreparationBinding | null {
  if (!uuid(row.applicationId) || !uuid(row.studentCaseId) || !uuid(row.institutionId)
    || !programId(row.programId) || !universityIntakeId(row.intakeId)
    || !uuid(row.publicationId) || !publicationVersion(row.publicationVersion)
    || !UNIVERSITY_LEVELS.includes(row.catalogLevel as UniversityLevel)
    || row.applicationDegree !== catalogApplicationDegree(row.catalogLevel as UniversityLevel)
    || typeof row.selectedAt !== "string" || !TIMESTAMP.test(row.selectedAt)
    || !Number.isFinite(Date.parse(row.selectedAt))
    || (row.deadlineStateAtSelection !== "confirmed" && row.deadlineStateAtSelection !== "needs_confirmation")) return null;
  return {
    applicationId: row.applicationId, studentCaseId: row.studentCaseId,
    institutionId: row.institutionId, programId: row.programId, intakeId: row.intakeId,
    publicationId: row.publicationId, publicationVersion: row.publicationVersion,
    catalogLevel: row.catalogLevel as UniversityLevel,
    applicationDegree: row.applicationDegree as PlatformApplicationDegree,
    selectedAt: row.selectedAt, deadlineStateAtSelection: row.deadlineStateAtSelection,
  };
}

export function parseCatalogPreparationReceipt(
  value: unknown,
  intent: CatalogPreparationIntent,
): CatalogPreparationReceipt | null {
  const row = record(value);
  if (!row || !exact(row, [...BINDING_KEYS, "requestId"])) return null;
  const binding = parseBinding(row);
  if (!binding || row.requestId !== intent.requestId
    || binding.studentCaseId !== intent.studentCaseId || binding.institutionId !== intent.institutionId
    || binding.programId !== intent.programId || binding.intakeId !== intent.intakeId) return null;
  // A new request for an existing selection returns its original publication.
  // Comparing it with intent.publicationVersion would misreport a saved choice.
  return { ...binding, requestId: intent.requestId };
}

/** Fail as a whole on malformed, duplicate or wrong-case rows; never fake an empty list. */
export function parseCatalogPreparations(
  value: unknown,
  studentCaseId: string,
): readonly CatalogPreparation[] | null {
  if (!uuid(studentCaseId) || !Array.isArray(value)) return null;
  const result: CatalogPreparation[] = [];
  const applicationIds = new Set<string>();
  const selections = new Set<string>();
  for (const item of value) {
    const row = record(item);
    if (!row || !exact(row, [...BINDING_KEYS, "applicationStatus", "applicationVersion", "content"])) return null;
    const binding = parseBinding(row);
    const content = parseUniversityContent(row.content);
    if (!binding || binding.studentCaseId !== studentCaseId || !content
      || !isPlatformApplicationCountryCode(content.country)
      || !PLATFORM_APPLICATION_STATUSES.includes(row.applicationStatus as PlatformApplicationStatus)
      || !applicationVersion(row.applicationVersion)) return null;
    const program = content.programs.find((entry) => entry.id === binding.programId);
    if (!program || program.level !== binding.catalogLevel
      || !program.intakes.some((intake) => intake.id === binding.intakeId)) return null;
    const selectionKey = `${binding.institutionId}:${binding.programId}:${binding.intakeId}`;
    if (applicationIds.has(binding.applicationId) || selections.has(selectionKey)) return null;
    applicationIds.add(binding.applicationId);
    selections.add(selectionKey);
    result.push({
      ...binding, applicationStatus: row.applicationStatus as PlatformApplicationStatus,
      applicationVersion: row.applicationVersion, content,
    });
  }
  return result;
}

export function catalogPreparationRpcArgs(intent: CatalogPreparationIntent) {
  return {
    p_student_case_id: intent.studentCaseId,
    p_catalog_institution_id: intent.institutionId,
    p_program_id: intent.programId,
    p_intake_id: intent.intakeId,
    p_publication_version: intent.publicationVersion,
    p_request_id: intent.requestId,
  };
}
