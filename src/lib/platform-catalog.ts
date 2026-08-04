import type { PlatformActor } from "./platform-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$/;
const SOURCE_RECORD_KEY_PATTERN = /^rec_[a-f0-9]{32,64}$/;
const SAFE_REPOSITORY_ERROR_MESSAGE = "Platform catalog data is unavailable.";

export const PLATFORM_CATALOG_INSTITUTION_KINDS = [
  "university",
  "college",
] as const;
export const PLATFORM_CATALOG_IMPORT_STATUSES = [
  "staging",
  "validated",
  "approved",
  "rejected",
] as const;
export const PLATFORM_CATALOG_VALIDATION_STATUSES = [
  "pending",
  "valid",
  "invalid",
] as const;
export const PLATFORM_CATALOG_SOURCE_KINDS = [
  "google_spreadsheet",
  "google_drive_file",
  "notion_database",
] as const;
export const PLATFORM_CATALOG_SOURCE_REVIEW_STATUSES = [
  "pending",
  "reviewed",
  "rejected",
  "retired",
] as const;
export const PLATFORM_CATALOG_VALIDATION_ERRORS = [
  "institution_name_invalid",
  "country_code_invalid",
  "duplicate_in_batch",
  "source_record_already_approved",
  "institution_already_approved",
] as const;

export type PlatformCatalogInstitutionKind =
  (typeof PLATFORM_CATALOG_INSTITUTION_KINDS)[number];
export type PlatformCatalogImportStatus =
  (typeof PLATFORM_CATALOG_IMPORT_STATUSES)[number];
export type PlatformCatalogValidationStatus =
  (typeof PLATFORM_CATALOG_VALIDATION_STATUSES)[number];
export type PlatformCatalogSourceKind =
  (typeof PLATFORM_CATALOG_SOURCE_KINDS)[number];
export type PlatformCatalogSourceReviewStatus =
  (typeof PLATFORM_CATALOG_SOURCE_REVIEW_STATUSES)[number];
export type PlatformCatalogValidationError =
  (typeof PLATFORM_CATALOG_VALIDATION_ERRORS)[number];

export type PlatformCatalogInstitution = Readonly<{
  organizationId: string;
  catalogInstitutionId: string;
  institutionKind: PlatformCatalogInstitutionKind;
  institutionName: string;
  countryCode: string;
  city: string | null;
  sourceRegistryId: string;
  sourceRevision: string;
  importBatchId: string;
  approvedAt: string;
}>;

export type PlatformCatalogSource = Readonly<{
  organizationId: string;
  sourceRegistryId: string;
  sourceKind: PlatformCatalogSourceKind;
  sourceUrl: string;
  sourceRevision: string | null;
  reviewStatus: PlatformCatalogSourceReviewStatus;
  createdAt: string;
  reviewedAt: string | null;
}>;

export type PlatformCatalogImportBatch = Readonly<{
  organizationId: string;
  catalogImportBatchId: string;
  sourceRegistryId: string;
  sourceKind: PlatformCatalogSourceKind;
  sourceUrl: string;
  sourceRevision: string;
  institutionKind: PlatformCatalogInstitutionKind;
  status: PlatformCatalogImportStatus;
  candidateCount: number;
  validCandidateCount: number;
  invalidCandidateCount: number;
  createdAt: string;
  validatedAt: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
}>;

export type PlatformCatalogImportCandidate = Readonly<{
  organizationId: string;
  catalogImportCandidateId: string;
  catalogImportBatchId: string;
  sourceRecordKey: string;
  institutionName: string;
  countryCode: string;
  city: string | null;
  validationStatus: PlatformCatalogValidationStatus;
  validationErrors: readonly PlatformCatalogValidationError[];
  catalogInstitutionId: string | null;
  createdAt: string;
}>;

export class PlatformCatalogRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformCatalogRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformCatalogRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformCatalogRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidShape();
  }
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalidShape() : normalized;
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function requiredText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return invalidShape();
  }
  return normalized;
}

function optionalText(value: unknown, maxLength: number): string | null {
  return value === null ? null : requiredText(value, maxLength);
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return invalidShape();
  }
  return value as T[number];
}

function nonNegativeCount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : invalidShape();
}

function safeSourceUrl(value: unknown): string {
  const normalized = requiredText(value, 512);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return invalidShape();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    ![
      "docs.google.com",
      "drive.google.com",
      "notion.so",
      "www.notion.so",
      "github.com",
    ].includes(parsed.hostname)
  ) {
    return invalidShape();
  }
  return normalized;
}

function validationErrors(value: unknown): readonly PlatformCatalogValidationError[] {
  if (!Array.isArray(value) || value.length > PLATFORM_CATALOG_VALIDATION_ERRORS.length) {
    return invalidShape();
  }
  const seen = new Set<string>();
  return value.map((item) => {
    const normalized = oneOf(item, PLATFORM_CATALOG_VALIDATION_ERRORS);
    if (seen.has(normalized)) return invalidShape();
    seen.add(normalized);
    return normalized;
  });
}

function normalizeRows<T>(
  value: unknown,
  normalize: (row: unknown) => T,
  key: (row: T) => string,
): readonly T[] {
  if (!Array.isArray(value) || value.length > 10_000) return invalidShape();
  const seen = new Set<string>();
  return value.map((raw) => {
    const row = normalize(raw);
    const id = key(row);
    if (seen.has(id)) return invalidShape();
    seen.add(id);
    return row;
  });
}

function requireCatalogReader(actor: PlatformActor): string {
  if (
    actor.platformRole !== "admin" &&
    actor.platformRole !== "sales" &&
    actor.platformRole !== "curator"
  ) {
    return invalidShape();
  }
  return requiredUuid(actor.organizationId);
}

function requireCatalogAdmin(actor: PlatformActor): string {
  if (actor.platformRole !== "admin") return invalidShape();
  return requiredUuid(actor.organizationId);
}

async function getPlatformClient() {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export function normalizePlatformCatalogInstitution(
  value: unknown,
  expectedOrganizationId?: string,
): PlatformCatalogInstitution {
  if (!isRecord(value)) return invalidShape();
  const organizationId = requiredUuid(value.organization_id);
  if (expectedOrganizationId && organizationId !== expectedOrganizationId) {
    return invalidShape();
  }
  const countryCode = requiredText(value.country_code, 2);
  const sourceRevision = requiredText(value.source_revision, 128);
  if (!/^[A-Z]{2}$/.test(countryCode) || !SOURCE_REVISION_PATTERN.test(sourceRevision)) {
    return invalidShape();
  }
  return {
    organizationId,
    catalogInstitutionId: requiredUuid(value.catalog_institution_id),
    institutionKind: oneOf(value.institution_kind, PLATFORM_CATALOG_INSTITUTION_KINDS),
    institutionName: requiredText(value.institution_name, 300),
    countryCode,
    city: optionalText(value.city, 200),
    sourceRegistryId: requiredUuid(value.source_registry_id),
    sourceRevision,
    importBatchId: requiredUuid(value.import_batch_id),
    approvedAt: requiredTimestamp(value.approved_at),
  };
}

export function normalizePlatformCatalogSource(
  value: unknown,
  expectedOrganizationId?: string,
): PlatformCatalogSource {
  if (!isRecord(value)) return invalidShape();
  const organizationId = requiredUuid(value.organization_id);
  if (expectedOrganizationId && organizationId !== expectedOrganizationId) {
    return invalidShape();
  }
  const sourceRevision = optionalText(value.source_revision, 128);
  if (sourceRevision !== null && !SOURCE_REVISION_PATTERN.test(sourceRevision)) {
    return invalidShape();
  }
  const reviewStatus = oneOf(
    value.review_status,
    PLATFORM_CATALOG_SOURCE_REVIEW_STATUSES,
  );
  const reviewedAt = optionalTimestamp(value.reviewed_at);
  if ((reviewStatus === "pending") !== (reviewedAt === null)) {
    return invalidShape();
  }
  return {
    organizationId,
    sourceRegistryId: requiredUuid(value.source_registry_id),
    sourceKind: oneOf(value.source_kind, PLATFORM_CATALOG_SOURCE_KINDS),
    sourceUrl: safeSourceUrl(value.source_url),
    sourceRevision,
    reviewStatus,
    createdAt: requiredTimestamp(value.created_at),
    reviewedAt,
  };
}

export function normalizePlatformCatalogImportBatch(
  value: unknown,
  expectedOrganizationId?: string,
): PlatformCatalogImportBatch {
  if (!isRecord(value)) return invalidShape();
  const organizationId = requiredUuid(value.organization_id);
  if (expectedOrganizationId && organizationId !== expectedOrganizationId) {
    return invalidShape();
  }
  const sourceRevision = requiredText(value.source_revision, 128);
  if (!SOURCE_REVISION_PATTERN.test(sourceRevision)) return invalidShape();
  const candidateCount = nonNegativeCount(value.candidate_count);
  const validCandidateCount = nonNegativeCount(value.valid_candidate_count);
  const invalidCandidateCount = nonNegativeCount(value.invalid_candidate_count);
  const status = oneOf(value.status, PLATFORM_CATALOG_IMPORT_STATUSES);
  if (validCandidateCount + invalidCandidateCount > candidateCount) {
    return invalidShape();
  }
  if (
    (status !== "staging" &&
      status !== "rejected" &&
      validCandidateCount + invalidCandidateCount !== candidateCount) ||
    (status === "approved" && invalidCandidateCount !== 0)
  ) {
    return invalidShape();
  }
  return {
    organizationId,
    catalogImportBatchId: requiredUuid(value.catalog_import_batch_id),
    sourceRegistryId: requiredUuid(value.source_registry_id),
    sourceKind: oneOf(value.source_kind, PLATFORM_CATALOG_SOURCE_KINDS),
    sourceUrl: safeSourceUrl(value.source_url),
    sourceRevision,
    institutionKind: oneOf(value.institution_kind, PLATFORM_CATALOG_INSTITUTION_KINDS),
    status,
    candidateCount,
    validCandidateCount,
    invalidCandidateCount,
    createdAt: requiredTimestamp(value.created_at),
    validatedAt: optionalTimestamp(value.validated_at),
    reviewedAt: optionalTimestamp(value.reviewed_at),
    reviewReason: optionalText(value.review_reason, 500),
  };
}

export function normalizePlatformCatalogImportCandidate(
  value: unknown,
  expectedOrganizationId?: string,
  expectedBatchId?: string,
): PlatformCatalogImportCandidate {
  if (!isRecord(value)) return invalidShape();
  const organizationId = requiredUuid(value.organization_id);
  const catalogImportBatchId = requiredUuid(value.catalog_import_batch_id);
  if (
    (expectedOrganizationId && organizationId !== expectedOrganizationId) ||
    (expectedBatchId && catalogImportBatchId !== expectedBatchId)
  ) {
    return invalidShape();
  }
  const sourceRecordKey = requiredText(value.source_record_key, 68);
  if (!SOURCE_RECORD_KEY_PATTERN.test(sourceRecordKey)) return invalidShape();
  const validationStatus = oneOf(
    value.validation_status,
    PLATFORM_CATALOG_VALIDATION_STATUSES,
  );
  const errors = validationErrors(value.validation_errors);
  if ((validationStatus === "invalid") !== (errors.length > 0)) {
    return invalidShape();
  }
  const institutionName =
    typeof value.institution_name === "string" &&
    value.institution_name.length <= 300 &&
    !CONTROL_CHARACTER_PATTERN.test(value.institution_name)
      ? value.institution_name.trim()
      : invalidShape();
  const countryCode =
    typeof value.country_code === "string" && value.country_code.length <= 8
      ? value.country_code.trim()
      : invalidShape();
  const catalogInstitutionId = optionalUuid(value.catalog_institution_id);
  if (
    (validationStatus === "valid" &&
      (institutionName.length === 0 || !/^[A-Z]{2}$/.test(countryCode))) ||
    (catalogInstitutionId !== null && validationStatus !== "valid")
  ) {
    return invalidShape();
  }
  return {
    organizationId,
    catalogImportCandidateId: requiredUuid(value.catalog_import_candidate_id),
    catalogImportBatchId,
    sourceRecordKey,
    institutionName,
    countryCode,
    city: optionalText(value.city, 200),
    validationStatus,
    validationErrors: errors,
    catalogInstitutionId,
    createdAt: requiredTimestamp(value.created_at),
  };
}

export async function listPlatformCatalogInstitutions(
  actor: PlatformActor,
): Promise<readonly PlatformCatalogInstitution[]> {
  try {
    const organizationId = requireCatalogReader(actor);
    const client = await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc("staff_catalog_institutions", undefined, { get: true });
    if (response.error) return invalidShape();
    return normalizeRows(
      response.data,
      (row) => normalizePlatformCatalogInstitution(row, organizationId),
      (row) => row.catalogInstitutionId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformCatalogSources(
  actor: PlatformActor,
): Promise<readonly PlatformCatalogSource[]> {
  try {
    const organizationId = requireCatalogAdmin(actor);
    const client = await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc("admin_catalog_sources", undefined, { get: true });
    if (response.error) return invalidShape();
    return normalizeRows(
      response.data,
      (row) => normalizePlatformCatalogSource(row, organizationId),
      (row) => row.sourceRegistryId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformCatalogImportBatches(
  actor: PlatformActor,
): Promise<readonly PlatformCatalogImportBatch[]> {
  try {
    const organizationId = requireCatalogAdmin(actor);
    const client = await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc("admin_catalog_import_batches", undefined, { get: true });
    if (response.error) return invalidShape();
    return normalizeRows(
      response.data,
      (row) => normalizePlatformCatalogImportBatch(row, organizationId),
      (row) => row.catalogImportBatchId,
    );
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformCatalogImportCandidates(
  actor: PlatformActor,
  catalogImportBatchId: string,
): Promise<readonly PlatformCatalogImportCandidate[]> {
  try {
    const organizationId = requireCatalogAdmin(actor);
    const batchId = requiredUuid(catalogImportBatchId);
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "admin_catalog_import_candidates",
      { p_catalog_import_batch_id: batchId },
      { get: true },
    );
    if (response.error) return invalidShape();
    return normalizeRows(
      response.data,
      (row) =>
        normalizePlatformCatalogImportCandidate(row, organizationId, batchId),
      (row) => row.catalogImportCandidateId,
    );
  } catch (error) {
    return failClosed(error);
  }
}
