import type { PlatformActor } from "./platform-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const TIMESTAMPTZ_PARTS_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_KEY_PATTERN = /^src_[a-f0-9]{32,64}$/;
const SOURCE_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$/;
const TEMPLATE_KEY_PATTERN = /^contract_[a-z][a-z0-9_]{1,55}$/;
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const ITEM_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const COMMERCIAL_FIELD_PATTERN =
  /^handoff\.approved_commercial_fields\.(?:service_package|fee_currency|fee_amount_minor|payment_terms)$/;
const SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;
const MULTILINE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/u;
const HTML_DELIMITER_PATTERN = /[<>]/;
const MAX_WORKSPACE_BYTES = 2_000_000;
const MAX_ARRAY_ROWS = 250;
const MAX_TEMPLATE_TEXT = 20_000;
const MAX_RENDERED_TEXT = 200_000;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform contract workspace is unavailable.";

export const PLATFORM_CONTRACT_ACTOR_ROLES = [
  "admin",
  "sales",
  "admissions",
] as const;
const PLATFORM_CONTRACT_DATABASE_ACTOR_ROLES = [
  "admin",
  "sales",
  "curator",
] as const;
export const PLATFORM_CONTRACT_TEMPLATE_STATUSES = [
  "draft",
  "approved",
  "retired",
] as const;
export const PLATFORM_CONTRACT_ARTIFACT_STATUSES = [
  "draft",
  "approved",
  "rejected",
] as const;
export const PLATFORM_CONTRACT_REVIEW_DECISIONS = [
  "approved",
  "rejected",
] as const;
export const PLATFORM_POST_CONTRACT_ITEM_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "delivered",
] as const;
export const PLATFORM_CONTRACT_MANIFEST_VALUE_TYPES = [
  "text",
  "integer",
  "boolean",
  "date",
  "timestamp",
] as const;
export const PLATFORM_CONTRACT_SOURCE_KINDS = [
  "repository_contract",
  "google_document",
  "google_spreadsheet",
  "google_drive_file",
  "notion_database",
] as const;
export const PLATFORM_CONTRACT_MANIFEST_SOURCE_PATHS = [
  "student_case.student_display_name",
  "student_case.target_country",
  "student_case.target_degree",
  "student_case.program_direction",
  "student_case.intake",
  "student_case.contract_confirmed_at",
  "student_profile.preferred_display_name",
  "student_profile.legal_display_name",
  "student_profile.communication_language",
  "student_profile.date_of_birth",
  "student_profile.citizenship_country",
  "student_profile.residency_country",
  "student_profile.current_education_summary",
  "student_profile.academic_summary",
  "student_profile.language_summary",
  "student_profile.budget_band",
  "country_requirement.target_country",
  "country_requirement.target_degree",
  "country_requirement.program_direction",
  "country_requirement.version",
  "handoff.next_step",
  "handoff.due_at",
  "handoff.responsible_role",
  "handoff.approved_commercial_fields.service_package",
  "handoff.approved_commercial_fields.fee_currency",
  "handoff.approved_commercial_fields.fee_amount_minor",
  "handoff.approved_commercial_fields.payment_terms",
] as const;

export type PlatformContractActorRole =
  (typeof PLATFORM_CONTRACT_ACTOR_ROLES)[number];
export type PlatformContractTemplateStatus =
  (typeof PLATFORM_CONTRACT_TEMPLATE_STATUSES)[number];
export type PlatformContractArtifactStatus =
  (typeof PLATFORM_CONTRACT_ARTIFACT_STATUSES)[number];
export type PlatformContractReviewDecision =
  (typeof PLATFORM_CONTRACT_REVIEW_DECISIONS)[number];
export type PlatformPostContractItemStatus =
  (typeof PLATFORM_POST_CONTRACT_ITEM_STATUSES)[number];
export type PlatformContractManifestValueType =
  (typeof PLATFORM_CONTRACT_MANIFEST_VALUE_TYPES)[number];
export type PlatformContractManifestSourcePath =
  (typeof PLATFORM_CONTRACT_MANIFEST_SOURCE_PATHS)[number];
export type PlatformContractSourceKind =
  (typeof PLATFORM_CONTRACT_SOURCE_KINDS)[number];

export type PlatformContractManifestField = Readonly<{
  fieldKey: string;
  sourcePath: PlatformContractManifestSourcePath;
  valueType: PlatformContractManifestValueType;
  required: boolean;
}>;

export type PlatformPostContractChecklistBlueprintItem = Readonly<{
  itemKey: string;
  label: string;
  ownerRole: "admin" | "admissions";
  nextAction: string;
}>;

export type PlatformContractReviewedSource = Readonly<{
  sourceRegistryId: string;
  sourceKey: string;
  sourceKind: PlatformContractSourceKind;
  sourceUrl: string;
  sourceRevision: string;
  reviewStatus: "reviewed";
  reviewedAt: string;
}>;

export type PlatformContractTemplateVersion = Readonly<{
  contractTemplateVersionId: string;
  organizationId: string;
  templateKey: string;
  title: string;
  version: number;
  status: PlatformContractTemplateStatus;
  sourceRegistryId: string;
  sourceRevision: string;
  fieldManifest: readonly PlatformContractManifestField[];
  templateText: string;
  templateSha256: string;
  postContractChecklistBlueprint: readonly PlatformPostContractChecklistBlueprintItem[];
  blueprintSha256: string;
  createdByMembershipId: string;
  approvedByMembershipId: string | null;
  approvedAt: string | null;
  retiredByMembershipId: string | null;
  retiredAt: string | null;
  createdAt: string;
}>;

export type PlatformContractInputScalar = string | number | boolean | null;

export type PlatformContractInputSnapshot = Readonly<{
  manifestVersion: 1;
  values: Readonly<Record<string, PlatformContractInputScalar>>;
  sources: Readonly<{
    studentCaseId: string;
    studentProfileId: string | null;
    studentProfileRevision: number | null;
    countryRequirementVersionId: string | null;
    countryRequirementVersion: number | null;
    studentCaseOpHandoffId: string | null;
  }>;
}>;

export type PlatformStudentCaseContractDraft = Readonly<{
  studentCaseContractDraftId: string;
  organizationId: string;
  studentCaseId: string;
  contractTemplateVersionId: string;
  version: number;
  status: PlatformContractArtifactStatus;
  inputSnapshot: PlatformContractInputSnapshot;
  inputSha256: string;
  renderedText: string;
  renderedSha256: string;
  createdByMembershipId: string;
  reviewedByMembershipId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}>;

export type PlatformPostContractItem = Readonly<{
  postContractItemId: string;
  organizationId: string;
  studentCaseId: string;
  contractTemplateVersionId: string;
  itemKey: string;
  label: string;
  status: PlatformPostContractItemStatus;
  ownerRole: "admin" | "admissions";
  ownerMembershipId: string;
  nextAction: string | null;
  evidenceRef: string | null;
  revision: number;
  createdByMembershipId: string;
  updatedByMembershipId: string;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformPostContractReportItemSnapshot = Readonly<{
  postContractItemId: string;
  itemKey: string;
  label: string;
  status: PlatformPostContractItemStatus;
  ownerRole: "admin" | "admissions";
  ownerMembershipId: string;
  nextAction: string | null;
  evidenceRef: string | null;
  revision: number;
  updatedAt: string;
}>;

export type PlatformPostContractReport = Readonly<{
  postContractReportId: string;
  organizationId: string;
  studentCaseId: string;
  contractTemplateVersionId: string;
  version: number;
  status: PlatformContractArtifactStatus;
  totalItemCount: number;
  deliveredItemCount: number;
  openItemCount: number;
  inProgressItemCount: number;
  blockedItemCount: number;
  itemSnapshot: readonly PlatformPostContractReportItemSnapshot[];
  reportSha256: string;
  createdByMembershipId: string;
  reviewedByMembershipId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}>;

export type PlatformCaseContractWorkspace = Readonly<{
  organizationId: string;
  studentCaseId: string;
  actorRole: PlatformContractActorRole;
  canManageTemplates: boolean;
  canGenerateContract: boolean;
  canReviewContract: boolean;
  canManagePostContract: boolean;
  canReviewReport: boolean;
  reviewedSources: readonly PlatformContractReviewedSource[];
  templates: readonly PlatformContractTemplateVersion[];
  drafts: readonly PlatformStudentCaseContractDraft[];
  items: readonly PlatformPostContractItem[];
  reports: readonly PlatformPostContractReport[];
}>;

export class PlatformContractRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformContractRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformContractRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformContractRepositoryError) throw error;
  throw new PlatformContractRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonByteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    invalidShape();
  }
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) return invalidShape();
  return value as T[number];
}

function requiredUuid(value: unknown): string {
  const parsed = parsePlatformContractUuid(value);
  return parsed ?? invalidShape();
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function positiveInteger(value: unknown, maximum = 1_000_000_000): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    return invalidShape();
  }
  return value;
}

function nonNegativeInteger(value: unknown, maximum = 1_000_000): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    return invalidShape();
  }
  return value;
}

function booleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalidShape();
}

function safeSingleLine(value: unknown, minimum: number, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value.trim() !== value ||
    SINGLE_LINE_CONTROL_PATTERN.test(value) ||
    HTML_DELIMITER_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

function optionalSingleLine(value: unknown, maximum: number): string | null {
  return value === null ? null : safeSingleLine(value, 1, maximum);
}

function safeMultiline(value: unknown, minimum: number, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value.trim() !== value ||
    value.includes("\r") ||
    MULTILINE_CONTROL_PATTERN.test(value) ||
    HTML_DELIMITER_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

function timestamp(value: unknown): string {
  const parts = typeof value === "string" ? TIMESTAMPTZ_PARTS_PATTERN.exec(value) : null;
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !parts ||
    !validCalendarDate(Number(parts[1]), Number(parts[2]), Number(parts[3])) ||
    Number(parts[4]) > 23 ||
    Number(parts[5]) > 59 ||
    Number(parts[6]) > 59 ||
    (parts[7] !== "Z" &&
      (Number(parts[9]) > 14 ||
        Number(parts[10]) > 59 ||
        (Number(parts[9]) === 14 && Number(parts[10]) !== 0))) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function sha256(value: unknown): string {
  return typeof value === "string" && SHA256_PATTERN.test(value)
    ? value
    : invalidShape();
}

function sourceRevision(value: unknown): string {
  return typeof value === "string" && SOURCE_REVISION_PATTERN.test(value)
    ? value
    : invalidShape();
}

function safeSourceUrl(kind: PlatformContractSourceKind, value: unknown): string {
  const sourceUrl = safeSingleLine(value, 1, 512);
  const patterns: Record<PlatformContractSourceKind, RegExp> = {
    repository_contract:
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/commit\/[A-Fa-f0-9]{40}$/,
    google_document:
      /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]{10,200}(?:\/(?:edit|view))?$/,
    google_spreadsheet:
      /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{10,200}(?:\/(?:edit|view))?$/,
    google_drive_file:
      /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,200}(?:\/(?:view|edit))?$/,
    notion_database: /^https:\/\/(?:www\.)?notion\.so\/[A-Fa-f0-9]{32}$/,
  };
  return patterns[kind].test(sourceUrl) ? sourceUrl : invalidShape();
}

function uniqueRows<T>(
  value: unknown,
  normalize: (row: unknown) => T,
  identity: (row: T) => string,
): readonly T[] {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ROWS) return invalidShape();
  const seen = new Set<string>();
  return value.map((row) => {
    const parsed = normalize(row);
    const id = identity(parsed);
    if (seen.has(id)) return invalidShape();
    seen.add(id);
    return parsed;
  });
}

export function parsePlatformContractUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

export function isPlatformContractManifestSourcePath(
  value: unknown,
): value is PlatformContractManifestSourcePath {
  return (
    typeof value === "string" &&
    ((PLATFORM_CONTRACT_MANIFEST_SOURCE_PATHS as readonly string[]).includes(value) ||
      COMMERCIAL_FIELD_PATTERN.test(value))
  );
}

function expectedSourceType(
  sourcePath: PlatformContractManifestSourcePath,
): PlatformContractManifestValueType {
  if (
    sourcePath === "student_case.contract_confirmed_at" ||
    sourcePath === "handoff.due_at"
  ) {
    return "timestamp";
  }
  if (sourcePath === "student_profile.date_of_birth") return "date";
  if (
    sourcePath === "country_requirement.version" ||
    sourcePath === "handoff.approved_commercial_fields.fee_amount_minor"
  ) {
    return "integer";
  }
  return "text";
}

function normalizeManifestField(value: unknown): PlatformContractManifestField {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, ["field_key", "source_path", "value_type", "required"]);
  const fieldKey = safeSingleLine(value.field_key, 1, 64);
  if (!FIELD_KEY_PATTERN.test(fieldKey)) return invalidShape();
  if (!isPlatformContractManifestSourcePath(value.source_path)) return invalidShape();
  const sourcePath = value.source_path;
  const valueType = oneOf(value.value_type, PLATFORM_CONTRACT_MANIFEST_VALUE_TYPES);
  if (valueType !== expectedSourceType(sourcePath)) return invalidShape();
  return {
    fieldKey,
    sourcePath,
    valueType,
    required: booleanValue(value.required),
  };
}

export function normalizePlatformContractManifest(
  value: unknown,
): readonly PlatformContractManifestField[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    return invalidShape();
  }
  const seenFields = new Set<string>();
  const seenSources = new Set<string>();
  return value.map((row) => {
    const parsed = normalizeManifestField(row);
    if (seenFields.has(parsed.fieldKey) || seenSources.has(parsed.sourcePath)) {
      return invalidShape();
    }
    seenFields.add(parsed.fieldKey);
    seenSources.add(parsed.sourcePath);
    return parsed;
  });
}

function normalizeBlueprintItem(
  value: unknown,
): PlatformPostContractChecklistBlueprintItem {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, ["item_key", "label", "owner_role", "next_action"]);
  const itemKey = safeSingleLine(value.item_key, 1, 64);
  if (!ITEM_KEY_PATTERN.test(itemKey)) return invalidShape();
  const ownerRole = oneOf(value.owner_role, ["admin", "admissions"] as const);
  return {
    itemKey,
    label: safeSingleLine(value.label, 1, 240),
    ownerRole,
    nextAction: safeSingleLine(value.next_action, 1, 1000),
  };
}

export function normalizePlatformPostContractChecklistBlueprint(
  value: unknown,
): readonly PlatformPostContractChecklistBlueprintItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    return invalidShape();
  }
  const seen = new Set<string>();
  return value.map((row) => {
    const parsed = normalizeBlueprintItem(row);
    if (seen.has(parsed.itemKey)) return invalidShape();
    seen.add(parsed.itemKey);
    return parsed;
  });
}

function normalizedLineInput(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || value.length > maximum) return null;
  const normalized = value.replace(/\r\n/g, "\n");
  if (normalized.includes("\r") || MULTILINE_CONTROL_PATTERN.test(normalized)) {
    return null;
  }
  return normalized.trim();
}

export function parsePlatformContractManifestLines(
  value: unknown,
): readonly PlatformContractManifestField[] | null {
  const input = normalizedLineInput(value, 32_000);
  if (!input) return null;
  const rows = input.split("\n").filter((line) => line.trim().length > 0);
  if (rows.length < 1 || rows.length > 32) return null;
  try {
    return normalizePlatformContractManifest(
      rows.map((line) => {
        const parts = line.split("|").map((part) => part.trim());
        if (parts.length !== 4) return invalidShape();
        if (parts[3] !== "true" && parts[3] !== "false") return invalidShape();
        return {
          field_key: parts[0],
          source_path: parts[1],
          value_type: parts[2],
          required: parts[3] === "true",
        };
      }),
    );
  } catch {
    return null;
  }
}

export function parsePlatformPostContractChecklistLines(
  value: unknown,
): readonly PlatformPostContractChecklistBlueprintItem[] | null {
  const input = normalizedLineInput(value, 48_000);
  if (!input) return null;
  const rows = input.split("\n").filter((line) => line.trim().length > 0);
  if (rows.length < 1 || rows.length > 64) return null;
  try {
    return normalizePlatformPostContractChecklistBlueprint(
      rows.map((line) => {
        const parts = line.split("|").map((part) => part.trim());
        if (parts.length !== 4) return invalidShape();
        return {
          item_key: parts[0],
          label: parts[1],
          owner_role: parts[2],
          next_action: parts[3],
        };
      }),
    );
  } catch {
    return null;
  }
}

export function validatePlatformContractTemplateText(
  value: unknown,
  manifest: readonly PlatformContractManifestField[],
): string | null {
  let templateText: string;
  try {
    const normalizedValue =
      typeof value === "string" ? value.replace(/\r\n/g, "\n") : value;
    templateText = safeMultiline(normalizedValue, 1, MAX_TEMPLATE_TEXT);
  } catch {
    return null;
  }
  const placeholders = [...templateText.matchAll(/\{\{([a-z][a-z0-9_]{1,63})\}\}/g)].map(
    (match) => match[1],
  );
  const stripped = templateText.replace(/\{\{[a-z][a-z0-9_]{1,63}\}\}/g, "");
  if (/[{}]/.test(stripped)) return null;
  const referenced = new Set(placeholders);
  const declared = new Set(manifest.map((field) => field.fieldKey));
  if (
    referenced.size === 0 ||
    placeholders.length !== referenced.size ||
    referenced.size !== declared.size ||
    [...referenced].some((key) => !declared.has(key)) ||
    [...declared].some((key) => !referenced.has(key))
  ) {
    return null;
  }
  return templateText;
}

function normalizeReviewedSource(value: unknown): PlatformContractReviewedSource {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "id",
    "source_key",
    "source_kind",
    "source_url",
    "source_revision",
    "review_status",
    "reviewed_at",
  ]);
  const sourceKind = oneOf(value.source_kind, PLATFORM_CONTRACT_SOURCE_KINDS);
  if (value.review_status !== "reviewed") return invalidShape();
  const sourceKey = safeSingleLine(value.source_key, 1, 68);
  if (!SOURCE_KEY_PATTERN.test(sourceKey)) return invalidShape();
  return {
    sourceRegistryId: requiredUuid(value.id),
    sourceKey,
    sourceKind,
    sourceUrl: safeSourceUrl(sourceKind, value.source_url),
    sourceRevision: sourceRevision(value.source_revision),
    reviewStatus: "reviewed",
    reviewedAt: timestamp(value.reviewed_at),
  };
}

function normalizeTemplate(
  value: unknown,
  organizationId: string,
): PlatformContractTemplateVersion {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "id",
    "organization_id",
    "template_key",
    "title",
    "version",
    "status",
    "source_registry_id",
    "source_revision",
    "field_manifest",
    "template_text",
    "template_sha256",
    "post_contract_checklist_blueprint",
    "blueprint_sha256",
    "created_by_membership_id",
    "approved_by_membership_id",
    "approved_at",
    "retired_by_membership_id",
    "retired_at",
    "created_at",
  ]);
  if (requiredUuid(value.organization_id) !== organizationId) return invalidShape();
  const templateKey = safeSingleLine(value.template_key, 1, 128);
  if (!TEMPLATE_KEY_PATTERN.test(templateKey)) return invalidShape();
  const status = oneOf(value.status, PLATFORM_CONTRACT_TEMPLATE_STATUSES);
  const fieldManifest = normalizePlatformContractManifest(value.field_manifest);
  const templateText = validatePlatformContractTemplateText(
    value.template_text,
    fieldManifest,
  );
  if (templateText === null) return invalidShape();
  const approvedByMembershipId = optionalUuid(value.approved_by_membership_id);
  const approvedAt = optionalTimestamp(value.approved_at);
  const retiredByMembershipId = optionalUuid(value.retired_by_membership_id);
  const retiredAt = optionalTimestamp(value.retired_at);
  if (
    (status === "draft" &&
      (approvedByMembershipId || approvedAt || retiredByMembershipId || retiredAt)) ||
    (status === "approved" &&
      (!approvedByMembershipId || !approvedAt || retiredByMembershipId || retiredAt)) ||
    (status === "retired" &&
      (!approvedByMembershipId || !approvedAt || !retiredByMembershipId || !retiredAt))
  ) {
    return invalidShape();
  }
  return {
    contractTemplateVersionId: requiredUuid(value.id),
    organizationId,
    templateKey,
    title: safeSingleLine(value.title, 1, 240),
    version: positiveInteger(value.version),
    status,
    sourceRegistryId: requiredUuid(value.source_registry_id),
    sourceRevision: sourceRevision(value.source_revision),
    fieldManifest,
    templateText,
    templateSha256: sha256(value.template_sha256),
    postContractChecklistBlueprint:
      normalizePlatformPostContractChecklistBlueprint(
        value.post_contract_checklist_blueprint,
      ),
    blueprintSha256: sha256(value.blueprint_sha256),
    createdByMembershipId: requiredUuid(value.created_by_membership_id),
    approvedByMembershipId,
    approvedAt,
    retiredByMembershipId,
    retiredAt,
    createdAt: timestamp(value.created_at),
  };
}

function normalizeSnapshotScalar(
  value: unknown,
  field: PlatformContractManifestField,
): PlatformContractInputScalar {
  if (value === null) return field.required ? invalidShape() : null;
  if (field.valueType === "integer") {
    return typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : invalidShape();
  }
  if (field.valueType === "boolean") {
    return typeof value === "boolean" ? value : invalidShape();
  }
  if (typeof value !== "string") return invalidShape();
  if (field.valueType === "date") {
    const [year, month, day] = value.split("-").map(Number);
    return DATE_PATTERN.test(value) && validCalendarDate(year, month, day)
      ? value
      : invalidShape();
  }
  if (field.valueType === "timestamp") return timestamp(value);
  return safeMultiline(value, 1, 4_000);
}

function normalizeInputSnapshot(
  value: unknown,
  template: PlatformContractTemplateVersion,
  studentCaseId: string,
): PlatformContractInputSnapshot {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, ["manifest_version", "values", "sources"]);
  if (value.manifest_version !== 1 || !isRecord(value.values) || !isRecord(value.sources)) {
    return invalidShape();
  }
  requireExactKeys(value.values, template.fieldManifest.map((field) => field.fieldKey));
  const values: Record<string, PlatformContractInputScalar> = {};
  for (const field of template.fieldManifest) {
    values[field.fieldKey] = normalizeSnapshotScalar(value.values[field.fieldKey], field);
  }
  requireExactKeys(value.sources, [
    "student_case_id",
    "student_profile_id",
    "student_profile_revision",
    "country_requirement_version_id",
    "country_requirement_version",
    "student_case_op_handoff_id",
  ]);
  const parsedStudentCaseId = requiredUuid(value.sources.student_case_id);
  if (parsedStudentCaseId !== studentCaseId) return invalidShape();
  const studentProfileId = optionalUuid(value.sources.student_profile_id);
  const studentProfileRevision =
    value.sources.student_profile_revision === null
      ? null
      : positiveInteger(value.sources.student_profile_revision);
  const countryRequirementVersionId = optionalUuid(
    value.sources.country_requirement_version_id,
  );
  const countryRequirementVersion =
    value.sources.country_requirement_version === null
      ? null
      : positiveInteger(value.sources.country_requirement_version);
  if (
    (studentProfileId === null) !== (studentProfileRevision === null) ||
    (countryRequirementVersionId === null) !==
      (countryRequirementVersion === null)
  ) {
    return invalidShape();
  }
  return {
    manifestVersion: 1,
    values,
    sources: {
      studentCaseId: parsedStudentCaseId,
      studentProfileId,
      studentProfileRevision,
      countryRequirementVersionId,
      countryRequirementVersion,
      studentCaseOpHandoffId: optionalUuid(
        value.sources.student_case_op_handoff_id,
      ),
    },
  };
}

function normalizeDraft(
  value: unknown,
  organizationId: string,
  studentCaseId: string,
  templates: ReadonlyMap<string, PlatformContractTemplateVersion>,
): PlatformStudentCaseContractDraft {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "id",
    "organization_id",
    "student_case_id",
    "contract_template_version_id",
    "version",
    "status",
    "input_snapshot",
    "input_sha256",
    "rendered_text",
    "rendered_sha256",
    "created_by_membership_id",
    "reviewed_by_membership_id",
    "reviewed_at",
    "created_at",
  ]);
  if (
    requiredUuid(value.organization_id) !== organizationId ||
    requiredUuid(value.student_case_id) !== studentCaseId
  ) {
    return invalidShape();
  }
  const templateId = requiredUuid(value.contract_template_version_id);
  const template = templates.get(templateId);
  if (!template) return invalidShape();
  const status = oneOf(value.status, PLATFORM_CONTRACT_ARTIFACT_STATUSES);
  const reviewedByMembershipId = optionalUuid(value.reviewed_by_membership_id);
  const reviewedAt = optionalTimestamp(value.reviewed_at);
  if (
    (status === "draft" && (reviewedByMembershipId || reviewedAt)) ||
    (status !== "draft" && (!reviewedByMembershipId || !reviewedAt))
  ) {
    return invalidShape();
  }
  const renderedText = safeMultiline(value.rendered_text, 1, MAX_RENDERED_TEXT);
  if (renderedText.includes("{{") || renderedText.includes("}}")) return invalidShape();
  return {
    studentCaseContractDraftId: requiredUuid(value.id),
    organizationId,
    studentCaseId,
    contractTemplateVersionId: templateId,
    version: positiveInteger(value.version),
    status,
    inputSnapshot: normalizeInputSnapshot(value.input_snapshot, template, studentCaseId),
    inputSha256: sha256(value.input_sha256),
    renderedText,
    renderedSha256: sha256(value.rendered_sha256),
    createdByMembershipId: requiredUuid(value.created_by_membership_id),
    reviewedByMembershipId,
    reviewedAt,
    createdAt: timestamp(value.created_at),
  };
}

function normalizeItemCore(
  value: Record<string, unknown>,
): Omit<PlatformPostContractReportItemSnapshot, "postContractItemId"> & {
  postContractItemId: string;
} {
  const status = oneOf(value.status, PLATFORM_POST_CONTRACT_ITEM_STATUSES);
  const nextAction = optionalSingleLine(value.next_action, 1000);
  const evidenceRef = optionalSingleLine(value.evidence_ref, 512);
  if (
    (status === "delivered" && !evidenceRef) ||
    (status !== "delivered" && !nextAction)
  ) {
    return invalidShape();
  }
  const itemKey = safeSingleLine(value.item_key, 1, 64);
  if (!ITEM_KEY_PATTERN.test(itemKey)) return invalidShape();
  return {
    postContractItemId: requiredUuid(value.id),
    itemKey,
    label: safeSingleLine(value.label, 1, 240),
    status,
    ownerRole: oneOf(value.owner_role, ["admin", "admissions"] as const),
    ownerMembershipId: requiredUuid(value.owner_membership_id),
    nextAction,
    evidenceRef,
    revision: positiveInteger(value.revision),
    updatedAt: timestamp(value.updated_at),
  };
}

function normalizeItem(
  value: unknown,
  organizationId: string,
  studentCaseId: string,
  templates: ReadonlyMap<string, PlatformContractTemplateVersion>,
): PlatformPostContractItem {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "id",
    "organization_id",
    "student_case_id",
    "contract_template_version_id",
    "item_key",
    "label",
    "status",
    "owner_role",
    "owner_membership_id",
    "next_action",
    "evidence_ref",
    "revision",
    "created_by_membership_id",
    "updated_by_membership_id",
    "created_at",
    "updated_at",
  ]);
  if (
    requiredUuid(value.organization_id) !== organizationId ||
    requiredUuid(value.student_case_id) !== studentCaseId
  ) {
    return invalidShape();
  }
  const templateId = requiredUuid(value.contract_template_version_id);
  if (!templates.has(templateId)) return invalidShape();
  const core = normalizeItemCore(value);
  return {
    ...core,
    organizationId,
    studentCaseId,
    contractTemplateVersionId: templateId,
    createdByMembershipId: requiredUuid(value.created_by_membership_id),
    updatedByMembershipId: requiredUuid(value.updated_by_membership_id),
    createdAt: timestamp(value.created_at),
  };
}

function normalizeReportSnapshotItem(
  value: unknown,
): PlatformPostContractReportItemSnapshot {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "id",
    "item_key",
    "label",
    "status",
    "owner_role",
    "owner_membership_id",
    "next_action",
    "evidence_ref",
    "revision",
    "updated_at",
  ]);
  return normalizeItemCore(value);
}

function normalizeReport(
  value: unknown,
  organizationId: string,
  studentCaseId: string,
  templates: ReadonlyMap<string, PlatformContractTemplateVersion>,
  itemTemplateIds: ReadonlyMap<string, string>,
): PlatformPostContractReport {
  if (!isRecord(value)) return invalidShape();
  requireExactKeys(value, [
    "id",
    "organization_id",
    "student_case_id",
    "contract_template_version_id",
    "version",
    "status",
    "total_item_count",
    "delivered_item_count",
    "open_item_count",
    "in_progress_item_count",
    "blocked_item_count",
    "item_snapshot",
    "report_sha256",
    "created_by_membership_id",
    "reviewed_by_membership_id",
    "reviewed_at",
    "created_at",
  ]);
  if (
    requiredUuid(value.organization_id) !== organizationId ||
    requiredUuid(value.student_case_id) !== studentCaseId
  ) {
    return invalidShape();
  }
  const templateId = requiredUuid(value.contract_template_version_id);
  if (!templates.has(templateId)) return invalidShape();
  const status = oneOf(value.status, PLATFORM_CONTRACT_ARTIFACT_STATUSES);
  const reviewedByMembershipId = optionalUuid(value.reviewed_by_membership_id);
  const reviewedAt = optionalTimestamp(value.reviewed_at);
  if (
    (status === "draft" && (reviewedByMembershipId || reviewedAt)) ||
    (status !== "draft" && (!reviewedByMembershipId || !reviewedAt))
  ) {
    return invalidShape();
  }
  const itemSnapshot = uniqueRows(
    value.item_snapshot,
    normalizeReportSnapshotItem,
    (item) => item.postContractItemId,
  );
  if (
    itemSnapshot.some(
      (item) => itemTemplateIds.get(item.postContractItemId) !== templateId,
    )
  ) {
    return invalidShape();
  }
  const totalItemCount = nonNegativeInteger(value.total_item_count);
  const deliveredItemCount = nonNegativeInteger(value.delivered_item_count);
  const openItemCount = nonNegativeInteger(value.open_item_count);
  const inProgressItemCount = nonNegativeInteger(value.in_progress_item_count);
  const blockedItemCount = nonNegativeInteger(value.blocked_item_count);
  if (
    totalItemCount !== itemSnapshot.length ||
    deliveredItemCount + openItemCount + inProgressItemCount + blockedItemCount !==
      totalItemCount ||
    itemSnapshot.filter((item) => item.status === "delivered").length !==
      deliveredItemCount ||
    itemSnapshot.filter((item) => item.status === "open").length !== openItemCount ||
    itemSnapshot.filter((item) => item.status === "in_progress").length !==
      inProgressItemCount ||
    itemSnapshot.filter((item) => item.status === "blocked").length !==
      blockedItemCount
  ) {
    return invalidShape();
  }
  return {
    postContractReportId: requiredUuid(value.id),
    organizationId,
    studentCaseId,
    contractTemplateVersionId: templateId,
    version: positiveInteger(value.version),
    status,
    totalItemCount,
    deliveredItemCount,
    openItemCount,
    inProgressItemCount,
    blockedItemCount,
    itemSnapshot,
    reportSha256: sha256(value.report_sha256),
    createdByMembershipId: requiredUuid(value.created_by_membership_id),
    reviewedByMembershipId,
    reviewedAt,
    createdAt: timestamp(value.created_at),
  };
}

export function normalizePlatformCaseContractWorkspace(
  value: unknown,
  expected?: Readonly<{
    organizationId?: string;
    studentCaseId?: string;
    actorRole?: PlatformContractActorRole;
  }>,
): PlatformCaseContractWorkspace {
  if (!isRecord(value) || jsonByteSize(value) > MAX_WORKSPACE_BYTES) {
    return invalidShape();
  }
  requireExactKeys(value, [
    "organization_id",
    "student_case_id",
    "actor_role",
    "can_manage_templates",
    "can_generate_contract",
    "can_review_contract",
    "can_manage_post_contract",
    "can_review_report",
    "reviewed_sources",
    "templates",
    "drafts",
    "items",
    "reports",
  ]);
  const organizationId = requiredUuid(value.organization_id);
  const studentCaseId = requiredUuid(value.student_case_id);
  const databaseActorRole = oneOf(
    value.actor_role,
    PLATFORM_CONTRACT_DATABASE_ACTOR_ROLES,
  );
  const actorRole: PlatformContractActorRole =
    databaseActorRole === "curator" ? "admissions" : databaseActorRole;
  if (
    (expected?.organizationId && organizationId !== expected.organizationId) ||
    (expected?.studentCaseId && studentCaseId !== expected.studentCaseId) ||
    (expected?.actorRole && actorRole !== expected.actorRole)
  ) {
    return invalidShape();
  }
  const reviewedSources = uniqueRows(
    value.reviewed_sources,
    normalizeReviewedSource,
    (source) => source.sourceRegistryId,
  );
  const templates = uniqueRows(
    value.templates,
    (row) => normalizeTemplate(row, organizationId),
    (template) => template.contractTemplateVersionId,
  );
  const templateMap = new Map(
    templates.map((template) => [template.contractTemplateVersionId, template]),
  );
  const drafts = uniqueRows(
    value.drafts,
    (row) => normalizeDraft(row, organizationId, studentCaseId, templateMap),
    (draft) => draft.studentCaseContractDraftId,
  );
  const items = uniqueRows(
    value.items,
    (row) => normalizeItem(row, organizationId, studentCaseId, templateMap),
    (item) => item.postContractItemId,
  );
  const itemTemplateIds = new Map(
    items.map((item) => [item.postContractItemId, item.contractTemplateVersionId]),
  );
  const reports = uniqueRows(
    value.reports,
    (row) =>
      normalizeReport(
        row,
        organizationId,
        studentCaseId,
        templateMap,
        itemTemplateIds,
      ),
    (report) => report.postContractReportId,
  );
  const canManageTemplates = booleanValue(value.can_manage_templates);
  const canGenerateContract = booleanValue(value.can_generate_contract);
  const canReviewContract = booleanValue(value.can_review_contract);
  const canManagePostContract = booleanValue(value.can_manage_post_contract);
  const canReviewReport = booleanValue(value.can_review_report);
  if (
    (canManageTemplates && actorRole !== "admin") ||
    (canManagePostContract && actorRole === "sales") ||
    (canReviewReport && actorRole === "sales")
  ) {
    return invalidShape();
  }
  return {
    organizationId,
    studentCaseId,
    actorRole,
    canManageTemplates,
    canGenerateContract,
    canReviewContract,
    canManagePostContract,
    canReviewReport,
    reviewedSources,
    templates,
    drafts,
    items,
    reports,
  };
}

function requireWorkspaceActor(actor: PlatformActor): Readonly<{
  organizationId: string;
  actorRole: PlatformContractActorRole;
}> {
  if (!PLATFORM_CONTRACT_ACTOR_ROLES.includes(actor.platformRole as PlatformContractActorRole)) {
    return invalidShape();
  }
  return {
    organizationId: requiredUuid(actor.organizationId),
    actorRole: actor.platformRole as PlatformContractActorRole,
  };
}

async function getPlatformClient() {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export async function getPlatformCaseContractWorkspace(
  actor: PlatformActor,
  studentCaseId: string,
): Promise<PlatformCaseContractWorkspace | null> {
  try {
    const authority = requireWorkspaceActor(actor);
    const parsedStudentCaseId = parsePlatformContractUuid(studentCaseId);
    if (!parsedStudentCaseId) return null;
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_case_contract_workspace",
      {
        p_organization_id: authority.organizationId,
        p_student_case_id: parsedStudentCaseId,
      },
    );
    if (response.error || response.data === null) return invalidShape();
    return normalizePlatformCaseContractWorkspace(response.data, {
      organizationId: authority.organizationId,
      studentCaseId: parsedStudentCaseId,
      actorRole: authority.actorRole,
    });
  } catch (error) {
    return failClosed(error);
  }
}

function singleFormValue(form: FormData, key: string): string | undefined {
  const values = form.getAll(key);
  if (values.length > 1) return undefined;
  if (values.length === 0) return "";
  return typeof values[0] === "string" ? values[0].trim() : undefined;
}

function formHasOnly(form: FormData, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  // Next.js Server Actions add transport metadata with this reserved prefix:
  // https://nextjs.org/docs/app/guides/forms#how-it-works
  return [...form.keys()].every(
    (key) => key.startsWith("$ACTION_") || allowedSet.has(key),
  );
}

function formText(
  form: FormData,
  key: string,
  minimum: number,
  maximum: number,
): string | null {
  const value = singleFormValue(form, key);
  if (value === undefined) return null;
  try {
    return safeSingleLine(value, minimum, maximum);
  } catch {
    return null;
  }
}

function optionalFormText(
  form: FormData,
  key: string,
  maximum: number,
): string | null | undefined {
  const value = singleFormValue(form, key);
  if (value === undefined) return undefined;
  if (!value) return null;
  return formText(form, key, 1, maximum) ?? undefined;
}

function formUuid(form: FormData, key: string): string | null {
  const value = singleFormValue(form, key);
  return value === undefined ? null : parsePlatformContractUuid(value);
}

function formRequestId(form: FormData, generatedRequestId?: string): string | null {
  const supplied = singleFormValue(form, "request_id");
  if (supplied === undefined) return null;
  if (supplied) return parsePlatformContractUuid(supplied);
  return parsePlatformContractUuid(generatedRequestId);
}

function manifestToRpc(manifest: readonly PlatformContractManifestField[]) {
  return manifest.map((field) => ({
    field_key: field.fieldKey,
    source_path: field.sourcePath,
    value_type: field.valueType,
    required: field.required,
  }));
}

function blueprintToRpc(
  blueprint: readonly PlatformPostContractChecklistBlueprintItem[],
) {
  return blueprint.map((item) => ({
    item_key: item.itemKey,
    label: item.label,
    owner_role: item.ownerRole,
    next_action: item.nextAction,
  }));
}

export type PlatformCreateContractTemplateMutation = Readonly<{
  studentCaseId: string;
  templateKey: string;
  title: string;
  sourceRegistryId: string;
  fieldManifest: readonly PlatformContractManifestField[];
  templateText: string;
  checklistBlueprint: readonly PlatformPostContractChecklistBlueprintItem[];
  reason: string;
  requestId: string;
}>;

export function parsePlatformCreateContractTemplateForm(
  form: FormData,
  generatedRequestId?: string,
): PlatformCreateContractTemplateMutation | null {
  const keys = [
    "student_case_id",
    "template_key",
    "title",
    "source_registry_id",
    "manifest_lines",
    "template_text",
    "checklist_lines",
    "reason",
    "request_id",
  ];
  if (!formHasOnly(form, keys)) return null;
  const studentCaseId = formUuid(form, "student_case_id");
  const templateKey = formText(form, "template_key", 10, 64);
  const title = formText(form, "title", 1, 240);
  const sourceRegistryId = formUuid(form, "source_registry_id");
  const manifestValue = singleFormValue(form, "manifest_lines");
  const fieldManifest = parsePlatformContractManifestLines(manifestValue);
  const templateValue = singleFormValue(form, "template_text");
  const templateText = fieldManifest
    ? validatePlatformContractTemplateText(templateValue, fieldManifest)
    : null;
  const checklistValue = singleFormValue(form, "checklist_lines");
  const checklistBlueprint = parsePlatformPostContractChecklistLines(checklistValue);
  const reason = formText(form, "reason", 3, 500);
  const requestId = formRequestId(form, generatedRequestId);
  if (
    !studentCaseId ||
    !templateKey ||
    !TEMPLATE_KEY_PATTERN.test(templateKey) ||
    !title ||
    !sourceRegistryId ||
    !fieldManifest ||
    !templateText ||
    !checklistBlueprint ||
    !reason ||
    !requestId
  ) {
    return null;
  }
  return {
    studentCaseId,
    templateKey,
    title,
    sourceRegistryId,
    fieldManifest,
    templateText,
    checklistBlueprint,
    reason,
    requestId,
  };
}

type PlatformEntityMutation = Readonly<{
  studentCaseId: string;
  reason: string;
  requestId: string;
}>;

function parseEntityForm(
  form: FormData,
  entityKey: string | null,
  generatedRequestId?: string,
): (PlatformEntityMutation & Readonly<{ entityId?: string }>) | null {
  const allowed = ["student_case_id", "reason", "request_id"];
  if (entityKey) allowed.push(entityKey);
  if (!formHasOnly(form, allowed)) return null;
  const studentCaseId = formUuid(form, "student_case_id");
  const reason = formText(form, "reason", 3, 500);
  const requestId = formRequestId(form, generatedRequestId);
  const entityId = entityKey ? formUuid(form, entityKey) : undefined;
  if (!studentCaseId || !reason || !requestId || (entityKey && !entityId)) return null;
  return { studentCaseId, reason, requestId, ...(entityId ? { entityId } : {}) };
}

export type PlatformTemplateLifecycleMutation = PlatformEntityMutation &
  Readonly<{ contractTemplateVersionId: string }>;
export type PlatformGenerateContractDraftMutation = PlatformTemplateLifecycleMutation;
export type PlatformSeedPostContractItemsMutation = PlatformTemplateLifecycleMutation;

export function parsePlatformTemplateLifecycleForm(
  form: FormData,
  generatedRequestId?: string,
): PlatformTemplateLifecycleMutation | null {
  const parsed = parseEntityForm(
    form,
    "contract_template_version_id",
    generatedRequestId,
  );
  if (!parsed?.entityId) return null;
  return {
    studentCaseId: parsed.studentCaseId,
    contractTemplateVersionId: parsed.entityId,
    reason: parsed.reason,
    requestId: parsed.requestId,
  };
}

export type PlatformReviewContractDraftMutation = PlatformEntityMutation &
  Readonly<{
    studentCaseContractDraftId: string;
    decision: PlatformContractReviewDecision;
  }>;

export function parsePlatformReviewContractDraftForm(
  form: FormData,
  generatedRequestId?: string,
): PlatformReviewContractDraftMutation | null {
  const allowed = [
    "student_case_id",
    "student_case_contract_draft_id",
    "decision",
    "reason",
    "request_id",
  ];
  if (!formHasOnly(form, allowed)) return null;
  const studentCaseId = formUuid(form, "student_case_id");
  const studentCaseContractDraftId = formUuid(
    form,
    "student_case_contract_draft_id",
  );
  const decisionValue = singleFormValue(form, "decision");
  const decision = PLATFORM_CONTRACT_REVIEW_DECISIONS.includes(
    decisionValue as PlatformContractReviewDecision,
  )
    ? (decisionValue as PlatformContractReviewDecision)
    : null;
  const reason = formText(form, "reason", 3, 500);
  const requestId = formRequestId(form, generatedRequestId);
  return studentCaseId && studentCaseContractDraftId && decision && reason && requestId
    ? { studentCaseId, studentCaseContractDraftId, decision, reason, requestId }
    : null;
}

export type PlatformUpdatePostContractItemMutation = PlatformEntityMutation &
  Readonly<{
    postContractItemId: string;
    expectedRevision: number;
    status: PlatformPostContractItemStatus;
    ownerMembershipId: string;
    nextAction: string | null;
    evidenceRef: string | null;
  }>;

export function parsePlatformUpdatePostContractItemForm(
  form: FormData,
  generatedRequestId?: string,
): PlatformUpdatePostContractItemMutation | null {
  const allowed = [
    "student_case_id",
    "post_contract_item_id",
    "expected_revision",
    "status",
    "owner_membership_id",
    "next_action",
    "evidence_ref",
    "reason",
    "request_id",
  ];
  if (!formHasOnly(form, allowed)) return null;
  const studentCaseId = formUuid(form, "student_case_id");
  const postContractItemId = formUuid(form, "post_contract_item_id");
  const expectedRevisionValue = singleFormValue(form, "expected_revision");
  const expectedRevision =
    expectedRevisionValue && /^[1-9]\d{0,8}$/.test(expectedRevisionValue)
      ? Number(expectedRevisionValue)
      : null;
  const statusValue = singleFormValue(form, "status");
  const status = PLATFORM_POST_CONTRACT_ITEM_STATUSES.includes(
    statusValue as PlatformPostContractItemStatus,
  )
    ? (statusValue as PlatformPostContractItemStatus)
    : null;
  const ownerMembershipId = formUuid(form, "owner_membership_id");
  const nextAction = optionalFormText(form, "next_action", 1000);
  const evidenceRef = optionalFormText(form, "evidence_ref", 512);
  const reason = formText(form, "reason", 3, 500);
  const requestId = formRequestId(form, generatedRequestId);
  if (
    !studentCaseId ||
    !postContractItemId ||
    !expectedRevision ||
    !status ||
    !ownerMembershipId ||
    nextAction === undefined ||
    evidenceRef === undefined ||
    !reason ||
    !requestId ||
    (status === "delivered" && !evidenceRef) ||
    (status !== "delivered" && !nextAction)
  ) {
    return null;
  }
  return {
    studentCaseId,
    postContractItemId,
    expectedRevision,
    status,
    ownerMembershipId,
    nextAction,
    evidenceRef,
    reason,
    requestId,
  };
}

export type PlatformGeneratePostContractReportMutation = PlatformTemplateLifecycleMutation;

export function parsePlatformGeneratePostContractReportForm(
  form: FormData,
  generatedRequestId?: string,
): PlatformGeneratePostContractReportMutation | null {
  return parsePlatformTemplateLifecycleForm(form, generatedRequestId);
}

export type PlatformReviewPostContractReportMutation = PlatformEntityMutation &
  Readonly<{
    postContractReportId: string;
    decision: PlatformContractReviewDecision;
  }>;

export function parsePlatformReviewPostContractReportForm(
  form: FormData,
  generatedRequestId?: string,
): PlatformReviewPostContractReportMutation | null {
  const allowed = [
    "student_case_id",
    "post_contract_report_id",
    "decision",
    "reason",
    "request_id",
  ];
  if (!formHasOnly(form, allowed)) return null;
  const studentCaseId = formUuid(form, "student_case_id");
  const postContractReportId = formUuid(form, "post_contract_report_id");
  const decisionValue = singleFormValue(form, "decision");
  const decision = PLATFORM_CONTRACT_REVIEW_DECISIONS.includes(
    decisionValue as PlatformContractReviewDecision,
  )
    ? (decisionValue as PlatformContractReviewDecision)
    : null;
  const reason = formText(form, "reason", 3, 500);
  const requestId = formRequestId(form, generatedRequestId);
  return studentCaseId && postContractReportId && decision && reason && requestId
    ? { studentCaseId, postContractReportId, decision, reason, requestId }
    : null;
}

export function buildPlatformCreateContractTemplateRpcArgs(
  organizationId: string,
  input: PlatformCreateContractTemplateMutation,
) {
  return {
    p_organization_id: requiredUuid(organizationId),
    p_template_key: input.templateKey,
    p_title: input.title,
    p_source_registry_id: input.sourceRegistryId,
    p_field_manifest: manifestToRpc(input.fieldManifest),
    p_template_text: input.templateText,
    p_post_contract_checklist_blueprint: blueprintToRpc(input.checklistBlueprint),
    p_reason: input.reason,
    p_request_id: input.requestId,
  } as const;
}

export const PLATFORM_CONTRACT_RETRY_OPERATIONS = [
  "create_template",
  "approve_template",
  "retire_template",
  "generate_draft",
  "review_draft",
  "seed_items",
  "update_item",
  "generate_report",
  "review_report",
] as const;
export type PlatformContractRetryOperation =
  (typeof PLATFORM_CONTRACT_RETRY_OPERATIONS)[number];
export const PLATFORM_CONTRACT_MUTATION_OUTCOMES = [
  "template_created",
  "template_approved",
  "template_retired",
  "draft_generated",
  "draft_approved",
  "draft_rejected",
  "items_seeded",
  "item_updated",
  "report_generated",
  "report_approved",
  "report_rejected",
  "invalid",
  "unavailable",
  "not_allowed",
] as const;
export type PlatformContractMutationOutcome =
  (typeof PLATFORM_CONTRACT_MUTATION_OUTCOMES)[number];

export function buildPlatformContractRedirectTarget(
  studentCaseId: string | null,
  outcome: PlatformContractMutationOutcome,
  retry?: Readonly<{
    requestId: string;
    operation: PlatformContractRetryOperation;
    subjectId?: string;
  }>,
): string {
  const parsedCaseId = parsePlatformContractUuid(studentCaseId);
  const target = parsedCaseId ? `/clients/${parsedCaseId}` : "/clients";
  const safeOutcome = PLATFORM_CONTRACT_MUTATION_OUTCOMES.includes(outcome)
    ? outcome
    : "unavailable";
  const params = new URLSearchParams({ bw6_result: safeOutcome });
  if (retry && (safeOutcome === "invalid" || safeOutcome === "unavailable")) {
    const requestId = parsePlatformContractUuid(retry.requestId);
    const operation = PLATFORM_CONTRACT_RETRY_OPERATIONS.includes(retry.operation)
      ? retry.operation
      : null;
    const subjectId = retry.subjectId
      ? parsePlatformContractUuid(retry.subjectId)
      : null;
    if (requestId && operation && (!retry.subjectId || subjectId)) {
      params.set("bw6_retry_request_id", requestId);
      params.set("bw6_retry_operation", operation);
      if (subjectId) params.set("bw6_subject_id", subjectId);
    }
  }
  return `${target}?${params.toString()}#contract-workflow`;
}

export type PlatformContractMutationResponse = Readonly<
  Record<string, unknown>
>;

export function requirePlatformContractMutationResponse(
  value: unknown,
  exactKeys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value) || jsonByteSize(value) > 32_000) return invalidShape();
  requireExactKeys(value, exactKeys);
  return value;
}

export const platformContractResponseValidators = {
  requiredUuid,
  positiveInteger,
  nonNegativeInteger,
  sha256,
  safeSingleLine,
} as const;
