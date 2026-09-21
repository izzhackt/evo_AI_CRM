import { universityIntakeId } from "../platform-university-catalog.ts";
import {
  APPLICATION_REQUIREMENT_KEYS,
  APPLICATION_REQUIREMENT_CONFIGURATION_REASONS,
  APPLICATION_REQUIREMENT_UNAVAILABLE_REASONS,
  parseApplicationRequirementsTarget,
  type ApplicationRequirementConfigurationReason,
  type ApplicationRequirementItem,
  type ApplicationRequirementsTarget,
} from "./application-requirements.ts";

export type ApplicationRequirementDeadline = Readonly<{
  date: string;
  time: string | null;
  timezone: string | null;
  sourceUrl: string | null;
  verifiedOn: string;
}>;
export type ApplicationRequirementItemV2 = Omit<ApplicationRequirementItem, "requirementKey" | "compatibilityKey"> & Readonly<{
  requirementKey: string;
  compatibilityKey: string;
  deadline: ApplicationRequirementDeadline | null;
  reviewScope: "document_version";
  definitionImpact: "changed" | null;
}>;
type RevisionMetadata = Readonly<{
  revisionId: string;
  revisionVersion: string;
  initializedAt: string;
}> & (
  | Readonly<{ origin: "evo_starter"; configurationState: "needs_confirmation" }>
  | Readonly<{ origin: "staff_confirmed"; configurationState: "confirmed" }>
);
export type ApplicationRequirementsV2 = ApplicationRequirementsTarget & Readonly<{ protocolVersion: 2 }> & (
  | Readonly<{
    state: "uninitialized" | "needs_configuration";
    revisionId: null; revisionVersion: null; initializedAt: null; origin: null; configurationState: null;
    configurationReasons: readonly ApplicationRequirementConfigurationReason[];
    items: readonly [];
  }>
  | (RevisionMetadata & Readonly<{
    state: "initialized" | "needs_configuration";
    configurationReasons: readonly ApplicationRequirementConfigurationReason[];
    items: readonly ApplicationRequirementItemV2[];
  }>)
);

const REVISION_KEYS = ["revisionId", "revisionVersion", "origin", "configurationState", "initializedAt"] as const;
const ITEM_KEYS = [
  "requirementItemId", "requirementKey", "documentSlotId", "position", "required", "label", "groupLabel",
  "instructions", "compatibilityKey", "slotStatus", "currentVersionId", "currentVersionNo", "reviewDecision",
  "reviewReason", "reviewedAt", "technicalAvailability", "unavailableReasons", "deadline", "reviewScope", "definitionImpact",
] as const;
const SLOT_STATUSES = ["required", "submitted", "approved", "correction_required", "rejected"] as const;
const REVIEW_DECISIONS = ["approved", "correction_required", "rejected"] as const;
const ASSOCIATION_REASONS = ["slot_missing", "slot_removed", "application_link_missing", "slot_metadata_changed"] as const;
const BIGINT_MAX = "9223372036854775807";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exact(row: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));
}
function member<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}
function reasonList<T extends string>(value: unknown, values: readonly T[]): readonly T[] | null {
  return Array.isArray(value) && [...value].every((item) => member(item, values)) && new Set(value).size === value.length ? [...value] : null;
}
function scalarText(value: unknown, maximum = Number.POSITIVE_INFINITY): value is string {
  if (typeof value !== "string" || value.replace(/^[\p{White_Space}\uFEFF]+|[\p{White_Space}\uFEFF]+$/gu, "").length === 0) return false;
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if ((codePoint >= 0xd800 && codePoint <= 0xdfff) || ++length > maximum) return false;
  }
  return true;
}
function requirementKey(value: unknown): value is string {
  return scalarText(value, 100) && /^[a-z][a-z0-9_.-]*$/u.exec(value)?.[0] === value;
}
function decimalVersion(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/u.exec(value)?.[0] === value
    && (value.length < BIGINT_MAX.length || value <= BIGINT_MAX);
}
function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || /^\d{4}-\d{2}-\d{2}$/u.exec(value)?.[0] !== value) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(value)?.[0] === value
    && calendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
function timezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 100 || /[^\x21-\x7e]/u.test(value)
    || /^(?:posix|right)\//iu.test(value)
    || (value !== "UTC" && value !== "GMT" && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/u.exec(value)?.[0] !== value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
/** Display-only public provenance. This never fetches a URL or infers a source. */
function publicSourceUrl(value: unknown): value is string {
  if (!scalarText(value, 1000) || !value.startsWith("https://")
    || /[\p{White_Space}\uFEFF\u0000-\u001f\u007f\\#]/u.test(value)) return false;
  const authority = value.slice(8).split(/[/?]/u, 1)[0];
  if (/[^\x00-\x7f]/u.test(authority)
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(authority)
    || /\.(?:localhost|local|internal|test|invalid|example)$/i.test(authority)) return false;
  const query = value.indexOf("?");
  if (query !== -1 && value.slice(query + 1).split("&").some((part) => {
    const key = part.split("=", 1)[0].replace(/\+/gu, " ");
    return key.includes("%") || /token|secret|password|auth|api.?key/i.test(key);
  })) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}
function deadline(value: unknown): ApplicationRequirementDeadline | null {
  const row = record(value);
  if (!row || !exact(row, ["date", "time", "timezone", "sourceUrl", "verifiedOn"])
    || !calendarDate(row.date) || !calendarDate(row.verifiedOn)
    || (row.time !== null && (typeof row.time !== "string" || /^(?:[01]\d|2[0-3]):[0-5]\d$/u.exec(row.time)?.[0] !== row.time))
    || (row.timezone !== null && !timezone(row.timezone)) || (row.time !== null && row.timezone === null)
    || (row.sourceUrl !== null && !publicSourceUrl(row.sourceUrl))) return null;
  return { date: row.date, time: row.time, timezone: row.timezone, sourceUrl: row.sourceUrl, verifiedOn: row.verifiedOn };
}
function revision(row: Record<string, unknown>): RevisionMetadata | null {
  if (!universityIntakeId(row.revisionId) || !decimalVersion(row.revisionVersion) || !timestamp(row.initializedAt)) return null;
  const identity = { revisionId: row.revisionId, revisionVersion: row.revisionVersion, initializedAt: row.initializedAt };
  if (row.origin === "evo_starter" && row.configurationState === "needs_confirmation") return { ...identity, origin: row.origin, configurationState: row.configurationState };
  if (row.origin === "staff_confirmed" && row.configurationState === "confirmed") return { ...identity, origin: row.origin, configurationState: row.configurationState };
  return null;
}
function item(value: unknown, index: number, starter: boolean): ApplicationRequirementItemV2 | null {
  const row = record(value);
  if (!row || !exact(row, ITEM_KEYS)) return null;
  const unavailableReasons = reasonList(row.unavailableReasons, APPLICATION_REQUIREMENT_UNAVAILABLE_REASONS);
  const materialDeadline = row.deadline === null ? null : deadline(row.deadline);
  if (!unavailableReasons || !universityIntakeId(row.requirementItemId) || !universityIntakeId(row.documentSlotId)
    || !requirementKey(row.requirementKey) || !requirementKey(row.compatibilityKey)
    || row.position !== index + 1 || typeof row.required !== "boolean"
    || !scalarText(row.label, 500) || !scalarText(row.groupLabel, 200) || !scalarText(row.instructions, 4000)
    || (starter && (row.requirementKey !== APPLICATION_REQUIREMENT_KEYS[index] || row.required !== true || row.compatibilityKey !== row.requirementKey))
    || (row.deadline !== null && materialDeadline === null) || row.reviewScope !== "document_version"
    || (row.definitionImpact !== null && row.definitionImpact !== "changed")
    || (row.slotStatus !== null && !member(row.slotStatus, SLOT_STATUSES))
    || (row.currentVersionId !== null && !universityIntakeId(row.currentVersionId))
    || (row.currentVersionNo !== null && !decimalVersion(row.currentVersionNo))
    || ((row.currentVersionId === null) !== (row.currentVersionNo === null))
    || (row.reviewDecision !== null && !member(row.reviewDecision, REVIEW_DECISIONS))
    || (row.reviewReason !== null && !scalarText(row.reviewReason))
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
    || (row.technicalAvailability === "available" && row.currentVersionId === null)
    || unavailableReasons.filter((reason) => reason.startsWith("integrity_")).length > 1
    || unavailableReasons.filter((reason) => reason.startsWith("malware_")).length > 1) return null;
  return {
    requirementItemId: row.requirementItemId, requirementKey: row.requirementKey, documentSlotId: row.documentSlotId,
    position: row.position, required: row.required, label: row.label, groupLabel: row.groupLabel, instructions: row.instructions,
    compatibilityKey: row.compatibilityKey, slotStatus: row.slotStatus, currentVersionId: row.currentVersionId,
    currentVersionNo: row.currentVersionNo, reviewDecision: row.reviewDecision, reviewReason: row.reviewReason, reviewedAt: row.reviewedAt,
    technicalAvailability: row.technicalAvailability, unavailableReasons, deadline: materialDeadline,
    reviewScope: row.reviewScope, definitionImpact: row.definitionImpact,
  };
}

/** Strict read-only v2 protocol; v1 initialization and receipt parsing stay independent. */
export function parseApplicationRequirementsV2(value: unknown, studentCaseId: string, applicationId: string): ApplicationRequirementsV2 | null {
  const target = parseApplicationRequirementsTarget({ studentCaseId, applicationId });
  const row = record(value);
  if (!target || !row || !exact(row, ["protocolVersion", "studentCaseId", "applicationId", "state", ...REVISION_KEYS, "configurationReasons", "items"])
    || row.protocolVersion !== 2 || row.studentCaseId !== target.studentCaseId || row.applicationId !== target.applicationId || !Array.isArray(row.items)) return null;
  const configurationReasons = reasonList(row.configurationReasons, APPLICATION_REQUIREMENT_CONFIGURATION_REASONS);
  if (!configurationReasons) return null;
  if (row.revisionId === null) {
    if (!REVISION_KEYS.every((key) => row[key] === null) || row.items.length !== 0
      || (row.state !== "uninitialized" && row.state !== "needs_configuration")
      || ((row.state === "uninitialized") !== (configurationReasons.length === 0))) return null;
    return { protocolVersion: 2, ...target, state: row.state, revisionId: null, revisionVersion: null, origin: null, configurationState: null, initializedAt: null, configurationReasons, items: [] };
  }
  const metadata = revision(row);
  if (!metadata || (row.state !== "initialized" && row.state !== "needs_configuration") || row.items.length === 0
    || (metadata.origin === "evo_starter" && row.items.length !== APPLICATION_REQUIREMENT_KEYS.length)) return null;
  const items: ApplicationRequirementItemV2[] = [];
  const derivedReasons = new Set<ApplicationRequirementConfigurationReason>();
  const itemIds = new Set<string>();
  const keys = new Set<string>();
  const slotIds = new Set<string>();
  for (const [index, value] of row.items.entries()) {
    const parsed = item(value, index, metadata.origin === "evo_starter");
    if (!parsed || itemIds.has(parsed.requirementItemId) || keys.has(parsed.requirementKey) || slotIds.has(parsed.documentSlotId)) return null;
    itemIds.add(parsed.requirementItemId); keys.add(parsed.requirementKey); slotIds.add(parsed.documentSlotId);
    items.push(parsed);
    for (const reason of parsed.unavailableReasons) {
      if (reason === "slot_metadata_changed") derivedReasons.add("material_metadata_changed");
      else if (member(reason, ASSOCIATION_REASONS)) derivedReasons.add("material_association_unavailable");
    }
  }
  if (configurationReasons.length !== derivedReasons.size || configurationReasons.some((reason) => !derivedReasons.has(reason))
    || ((row.state === "initialized") !== (configurationReasons.length === 0))) return null;
  return { protocolVersion: 2, ...target, ...metadata, state: row.state, configurationReasons, items };
}
