import { universityIntakeId } from "../platform-university-catalog.ts";

export const APPLICATION_REQUIREMENT_KEYS = ["evo.photo.v1", "evo.passport.v1"] as const;
export const APPLICATION_REQUIREMENT_CONFIGURATION_REASONS = [
  "legacy_case_checklist", "legacy_application_links", "legacy_application_configuration",
  "ambiguous_material", "material_association_unavailable", "material_metadata_changed",
] as const;
export const APPLICATION_REQUIREMENT_UNAVAILABLE_REASONS = [
  "slot_missing", "slot_removed", "application_link_missing", "slot_metadata_changed",
  "file_missing", "upload_not_finalized", "integrity_pending", "integrity_failed",
  "malware_pending", "malware_infected", "malware_error",
] as const;
const SLOT_STATUSES = ["required", "submitted", "approved", "correction_required", "rejected"] as const;
const REVIEW_DECISIONS = ["approved", "correction_required", "rejected"] as const;
const ASSOCIATION_REASONS = ["slot_missing", "slot_removed", "application_link_missing", "slot_metadata_changed"] as const;

export type ApplicationRequirementKey = typeof APPLICATION_REQUIREMENT_KEYS[number];
export type ApplicationRequirementConfigurationReason = typeof APPLICATION_REQUIREMENT_CONFIGURATION_REASONS[number];
export type ApplicationRequirementUnavailableReason = typeof APPLICATION_REQUIREMENT_UNAVAILABLE_REASONS[number];
export type ApplicationRequirementSlotStatus = typeof SLOT_STATUSES[number];
export type ApplicationRequirementReviewDecision = typeof REVIEW_DECISIONS[number];
export type ApplicationRequirementsTarget = Readonly<{ studentCaseId: string; applicationId: string }>;

/** Keep this exact intent/request ID until the command's outcome is known. */
export type ApplicationRequirementsIntent = ApplicationRequirementsTarget & Readonly<{ requestId: string }>;
export type ApplicationRequirementBinding = Readonly<{
  requirementItemId: string;
  requirementKey: ApplicationRequirementKey;
  documentSlotId: string;
}>;
type RevisionMetadata = Readonly<{
  revisionId: string;
  revisionVersion: string;
  origin: "evo_starter";
  configurationState: "needs_confirmation";
  initializedAt: string;
}>;

/** Immutable initialization facts. This does not describe current files or links. */
export type ApplicationRequirementsReceipt = ApplicationRequirementsIntent & RevisionMetadata & Readonly<{
  items: readonly ApplicationRequirementBinding[];
}>;
export type ApplicationRequirementItem = ApplicationRequirementBinding & Readonly<{
  position: number;
  required: boolean;
  label: string;
  groupLabel: string;
  instructions: string;
  compatibilityKey: ApplicationRequirementKey;
  slotStatus: ApplicationRequirementSlotStatus | null;
  currentVersionId: string | null;
  currentVersionNo: string | null;
  reviewDecision: ApplicationRequirementReviewDecision | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  technicalAvailability: "available" | "unavailable";
  unavailableReasons: readonly ApplicationRequirementUnavailableReason[];
}>;
type NoRevisionMetadata = Readonly<{
  revisionId: null;
  revisionVersion: null;
  origin: null;
  configurationState: null;
  initializedAt: null;
}>;
/** Current state keeps immutable required items even when their material is unavailable. */
export type ApplicationRequirements = ApplicationRequirementsTarget & (
  | (NoRevisionMetadata & Readonly<{
    state: "uninitialized" | "needs_configuration";
    configurationReasons: readonly ApplicationRequirementConfigurationReason[];
    items: readonly [];
  }>)
  | (RevisionMetadata & Readonly<{
    state: "initialized" | "needs_configuration";
    configurationReasons: readonly ApplicationRequirementConfigurationReason[];
    items: readonly ApplicationRequirementItem[];
  }>)
);
export type ApplicationRequirementsFailure =
  | "invalid" | "forbidden" | "request_conflict" | "case_ineligible"
  | "application_ineligible" | "needs_configuration" | "invariant_conflict" | "unavailable";
export type ApplicationRequirementsActionResult =
  | Readonly<{ ok: true; receipt: ApplicationRequirementsReceipt }>
  | Readonly<{
    ok: false;
    reason: ApplicationRequirementsFailure;
    /** Retained after any uncertain result; never generate a replacement request ID. */
    intent: ApplicationRequirementsIntent | null;
  }>;

const INTENT_KEYS = ["studentCaseId", "applicationId", "requestId"] as const;
const REVISION_KEYS = ["revisionId", "revisionVersion", "origin", "configurationState", "initializedAt"] as const;
const BINDING_KEYS = ["requirementItemId", "requirementKey", "documentSlotId"] as const;
const ITEM_KEYS = [
  ...BINDING_KEYS, "position", "required", "label", "groupLabel", "instructions", "compatibilityKey",
  "slotStatus", "currentVersionId", "currentVersionNo", "reviewDecision", "reviewReason", "reviewedAt",
  "technicalAvailability", "unavailableReasons",
] as const;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function exact(row: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));
}
function member<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}
function reasons<T extends string>(value: unknown, values: readonly T[]): readonly T[] | null {
  if (!Array.isArray(value) || ![...value].every((reason) => member(reason, values))
    || new Set(value).size !== value.length) return null;
  return [...value];
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function decimalVersion(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/u.exec(value)?.[0] === value
    && (value.length < POSTGRES_BIGINT_MAX.length || value <= POSTGRES_BIGINT_MAX);
}
function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = TIMESTAMP.exec(value);
  if (!match || match[0] !== value || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = match.slice(1, 4).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function parseApplicationRequirementsTarget(value: unknown): ApplicationRequirementsTarget | null {
  const row = record(value);
  return row && exact(row, ["studentCaseId", "applicationId"])
    && universityIntakeId(row.studentCaseId) && universityIntakeId(row.applicationId)
    ? { studentCaseId: row.studentCaseId, applicationId: row.applicationId } : null;
}
export function parseApplicationRequirementsIntent(value: unknown): ApplicationRequirementsIntent | null {
  const row = record(value);
  if (!row || !exact(row, INTENT_KEYS) || !universityIntakeId(row.studentCaseId)
    || !universityIntakeId(row.applicationId) || !universityIntakeId(row.requestId)) return null;
  return { studentCaseId: row.studentCaseId, applicationId: row.applicationId, requestId: row.requestId };
}
function revision(row: Record<string, unknown>): RevisionMetadata | null {
  if (!universityIntakeId(row.revisionId) || !decimalVersion(row.revisionVersion)
    || row.origin !== "evo_starter" || row.configurationState !== "needs_confirmation"
    || !timestamp(row.initializedAt)) return null;
  return {
    revisionId: row.revisionId, revisionVersion: row.revisionVersion, origin: row.origin,
    configurationState: row.configurationState, initializedAt: row.initializedAt,
  };
}
function binding(row: Record<string, unknown>, index: number): ApplicationRequirementBinding | null {
  const expectedKey = APPLICATION_REQUIREMENT_KEYS[index];
  if (!expectedKey || row.requirementKey !== expectedKey || !universityIntakeId(row.requirementItemId)
    || !universityIntakeId(row.documentSlotId)) return null;
  return { requirementItemId: row.requirementItemId, requirementKey: expectedKey, documentSlotId: row.documentSlotId };
}
function uniqueBindings(items: readonly ApplicationRequirementBinding[]): boolean {
  return new Set(items.map((item) => item.requirementItemId)).size === items.length
    && new Set(items.map((item) => item.requirementKey)).size === items.length
    && new Set(items.map((item) => item.documentSlotId)).size === items.length;
}

export function parseApplicationRequirementsReceipt(
  value: unknown,
  intent: ApplicationRequirementsIntent,
): ApplicationRequirementsReceipt | null {
  const expected = parseApplicationRequirementsIntent(intent);
  const row = record(value);
  if (!expected || !row || !exact(row, [...INTENT_KEYS, ...REVISION_KEYS, "items"])
    || row.studentCaseId !== expected.studentCaseId || row.applicationId !== expected.applicationId
    || row.requestId !== expected.requestId || !Array.isArray(row.items)
    || row.items.length !== APPLICATION_REQUIREMENT_KEYS.length) return null;
  const metadata = revision(row);
  if (!metadata) return null;
  const items: ApplicationRequirementBinding[] = [];
  for (const [index, value] of row.items.entries()) {
    const itemRow = record(value);
    const item = itemRow && exact(itemRow, BINDING_KEYS) && binding(itemRow, index);
    if (!item) return null;
    items.push(item);
  }
  return uniqueBindings(items) ? { ...expected, ...metadata, items } : null;
}

function parseItem(value: unknown, index: number): ApplicationRequirementItem | null {
  const row = record(value);
  if (!row || !exact(row, ITEM_KEYS)) return null;
  const item = binding(row, index);
  const unavailableReasons = reasons(row.unavailableReasons, APPLICATION_REQUIREMENT_UNAVAILABLE_REASONS);
  if (!item || !unavailableReasons || row.position !== index + 1 || row.required !== true
    || !text(row.label) || !text(row.groupLabel) || !text(row.instructions)
    || row.compatibilityKey !== item.requirementKey
    || (row.slotStatus !== null && !member(row.slotStatus, SLOT_STATUSES))
    || (row.currentVersionId !== null && !universityIntakeId(row.currentVersionId))
    || (row.currentVersionNo !== null && !decimalVersion(row.currentVersionNo))
    || ((row.currentVersionId === null) !== (row.currentVersionNo === null))
    || (row.reviewDecision !== null && !member(row.reviewDecision, REVIEW_DECISIONS))
    || (row.reviewReason !== null && !text(row.reviewReason))
    || (row.reviewedAt !== null && !timestamp(row.reviewedAt))
    || ((row.reviewDecision === null) !== (row.reviewedAt === null))
    || ((row.reviewDecision === null || row.reviewDecision === "approved") && row.reviewReason !== null)
    || (row.technicalAvailability !== "available" && row.technicalAvailability !== "unavailable")) return null;
  const unavailableAssociation = unavailableReasons.some((reason) => member(reason, ASSOCIATION_REASONS));
  if (unavailableAssociation) {
    if (row.slotStatus !== null || row.currentVersionId !== null || row.reviewDecision !== null
      || unavailableReasons.some((reason) => !member(reason, ASSOCIATION_REASONS))) return null;
  } else {
    if (row.slotStatus === null) return null;
    if (row.currentVersionId === null) {
      if (row.reviewDecision !== null || unavailableReasons.length !== 1 || unavailableReasons[0] !== "file_missing") return null;
    } else if (unavailableReasons.includes("file_missing")) return null;
  }
  if ((row.technicalAvailability === "available") !== (unavailableReasons.length === 0)
    || (row.technicalAvailability === "available" && row.currentVersionId === null)) return null;
  // Mutually exclusive scanner/integrity states cannot describe the same file.
  if (unavailableReasons.filter((reason) => reason.startsWith("integrity_")).length > 1
    || unavailableReasons.filter((reason) => reason.startsWith("malware_")).length > 1) return null;
  return {
    ...item, position: row.position, required: row.required, label: row.label, groupLabel: row.groupLabel,
    instructions: row.instructions, compatibilityKey: item.requirementKey,
    slotStatus: row.slotStatus, currentVersionId: row.currentVersionId, currentVersionNo: row.currentVersionNo,
    reviewDecision: row.reviewDecision, reviewReason: row.reviewReason, reviewedAt: row.reviewedAt,
    technicalAvailability: row.technicalAvailability, unavailableReasons,
  };
}

export function parseApplicationRequirements(
  value: unknown,
  studentCaseId: string,
  applicationId: string,
): ApplicationRequirements | null {
  const target = parseApplicationRequirementsTarget({ studentCaseId, applicationId });
  const row = record(value);
  if (!target || !row || !exact(row, ["studentCaseId", "applicationId", "state", ...REVISION_KEYS, "configurationReasons", "items"])
    || row.studentCaseId !== target.studentCaseId || row.applicationId !== target.applicationId
    || !Array.isArray(row.items)) return null;
  const configurationReasons = reasons(row.configurationReasons, APPLICATION_REQUIREMENT_CONFIGURATION_REASONS);
  if (!configurationReasons) return null;
  if (row.revisionId === null) {
    if (!REVISION_KEYS.every((key) => row[key] === null) || row.items.length !== 0
      || (row.state !== "uninitialized" && row.state !== "needs_configuration")
      || ((row.state === "uninitialized") !== (configurationReasons.length === 0))) return null;
    return {
      ...target, state: row.state, revisionId: null, revisionVersion: null, origin: null,
      configurationState: null, initializedAt: null, configurationReasons, items: [],
    };
  }
  const metadata = revision(row);
  if (!metadata || (row.state !== "initialized" && row.state !== "needs_configuration")
    || row.items.length !== APPLICATION_REQUIREMENT_KEYS.length) return null;
  const items: ApplicationRequirementItem[] = [];
  const derivedReasons = new Set<ApplicationRequirementConfigurationReason>();
  for (const [index, value] of row.items.entries()) {
    const item = parseItem(value, index);
    if (!item) return null;
    items.push(item);
    for (const reason of item.unavailableReasons) {
      if (reason === "slot_metadata_changed") derivedReasons.add("material_metadata_changed");
      else if (member(reason, ASSOCIATION_REASONS)) derivedReasons.add("material_association_unavailable");
    }
  }
  if (!uniqueBindings(items) || configurationReasons.length !== derivedReasons.size
    || configurationReasons.some((reason) => !derivedReasons.has(reason))
    || ((row.state === "initialized") !== (configurationReasons.length === 0))) return null;
  return { ...target, ...metadata, state: row.state, configurationReasons, items };
}

/** Unknown transport errors remain uncertain, without a fabricated receipt. */
export function applicationRequirementsFailure(error: Readonly<{ code?: string; message?: string }>): ApplicationRequirementsFailure {
  if (error.code === "42501") return "forbidden";
  if (error.code === "22023") {
    if (error.message === "application_requirements_invalid_intent") return "invalid";
    if (error.message === "application_requirements_request_conflict") return "request_conflict";
  }
  if (error.code === "PT409") {
    for (const reason of ["case_ineligible", "application_ineligible", "needs_configuration"] as const) {
      if (error.message === `application_requirements_${reason}`) return reason;
    }
  }
  if (error.code === "55000" && error.message === "application_requirements_invariant_conflict") return "invariant_conflict";
  return "unavailable";
}
export function applicationRequirementsRpcArgs(intent: ApplicationRequirementsIntent) {
  return { p_student_case_id: intent.studentCaseId, p_application_id: intent.applicationId, p_request_id: intent.requestId };
}
