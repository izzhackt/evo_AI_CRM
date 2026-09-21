import { universityIntakeId as uuid } from "../platform-university-catalog.ts";
import { APPLICATION_REQUIREMENT_KEYS, type ApplicationRequirementsTarget, type ApplicationRequirementSlotStatus, type ApplicationRequirementReviewDecision } from "./application-requirements.ts";
import { scalarText as v2ScalarText, requirementKey, decimalVersion, calendarDate, timestamp, deadline, parseApplicationRequirementsV2, type ApplicationRequirementDeadline, type ApplicationRequirementsV2 } from "./application-requirements-v2.ts";

export type RequirementsEditorOwner = Readonly<{ organizationId: string; membershipId: string }>;
export type RequirementsEditorScope = RequirementsEditorOwner & ApplicationRequirementsTarget;
type FileReason = "file_missing" | "upload_not_finalized" | "integrity_pending" | "integrity_failed" | "malware_pending" | "malware_infected" | "malware_error";
type Link = Readonly<{ linkId: string; targetKind: "university_application" | "visa_case"; targetId: string }>;
export type ApplicationRequirementsEditorCandidate = Readonly<{
  documentSlotId: string; slotVersion: string; intentKind: "baseline" | "custom";
  sourceRequirement: Readonly<{ requirementId: string; requirementKey: string; checklistVersion: string }> | null;
  rawLabel: string | null; rawGroupLabel: string | null; label: string; groupLabel: string; instructions: string | null;
  slotStatus: ApplicationRequirementSlotStatus; currentVersionId: string | null; currentVersionNo: string | null;
  filename: string | null; reviewDecision: ApplicationRequirementReviewDecision | null; reviewReason: string | null; reviewedAt: string | null;
  technicalAvailability: "available" | "unavailable"; unavailableReasons: readonly FileReason[]; links: readonly Link[];
}>;
type PriorReference = Readonly<{ revisionId: string; revisionVersion: string; requirementItemId: string; requirementKey: string; origin: "evo_starter" | "staff_confirmed"; compatibilityKey: string; typedStarterEligible: boolean }>;
type CountryReference = Readonly<{ manifestId: string; manifestVersion: string; manifestStatus: "approved" | "retired"; requirementId: string; requirementKey: string; requirementStatus: "active" | "retired" }>;
export type ApplicationRequirementsEditorSource = Readonly<{
  sourceKey: string; documentSlotId: string | null; materialState: "selectable" | "removed" | "missing";
  required: boolean | null; label: string | null; groupLabel: string | null; instructions: string | null; legacyException: boolean; mustRetain: boolean;
}> & (
  | Readonly<{ kind: "prior"; reference: PriorReference }>
  | Readonly<{ kind: "country"; reference: CountryReference }>
  | Readonly<{ kind: "link"; reference: Readonly<{ linkId: string }> }>
  | Readonly<{ kind: "application"; reference: Readonly<{ applicationVersion: string }> }>
);
type Binding = Readonly<{ institutionId: string; publicationId: string; publicationVersion: number; programId: string; intakeId: string; institutionName: string; programTitle: string; intakeLabel: string; selectedAt: string; deadlineStateAtSelection: "confirmed" | "needs_confirmation" }>;
type LegacyApplication = Readonly<{ documentsApplicability: null | "needs_confirmation" | "required" | "not_required"; documentsSource: string | null; documentsCheckedOn: string | null; documentSlotIds: readonly string[]; documentExceptionSlotIds: readonly string[]; documentsExceptionReason: string | null; documentsExceptionEvidence: string | null }>;
export type ApplicationRequirementsEditorContext = ApplicationRequirementsTarget & Readonly<{
  protocolVersion: 1; applicationVersion: string; admissionsVersion: string; binding: Binding; requirements: ApplicationRequirementsV2;
  legacyApplication: LegacyApplication; sources: readonly ApplicationRequirementsEditorSource[]; candidates: readonly ApplicationRequirementsEditorCandidate[];
  canSave: boolean; saveBlockReason: null | "permission_required" | "case_inactive" | "portal_inactive" | "application_not_preparation"; contextHash: string;
}>;
type Material = Readonly<{ kind: "existing"; documentSlotId: string; expectedSlotVersion: string; expectedCurrentVersionId: string | null; expectedCurrentVersionNo: string | null }>
  | Readonly<{ kind: "new"; label: string; groupLabel: string }>;
type Provenance = Readonly<{ kind: "typed_starter" | "country_manifest" | "application_details" | "staff_entry"; sourceKey: string | null; basis: string }>;
export type ApplicationRequirementsEditorItem = Readonly<{ requirementKey: string; required: boolean; label: string; groupLabel: string; instructions: string; deadline: ApplicationRequirementDeadline | null; material: Material; provenance: Provenance }>;
export type ApplicationRequirementsEditorSourceDecision = Readonly<{ sourceKey: string; disposition: "included" | "excluded"; requirementKey: string | null; reason: string | null }>;
export type ApplicationRequirementsEditorPayload = Readonly<{ expectedContextHash: string; expectedApplicationVersion: string; expectedRevisionId: string | null; expectedRevisionVersion: string | null; changeReason: string; items: readonly ApplicationRequirementsEditorItem[]; sourceDecisions: readonly ApplicationRequirementsEditorSourceDecision[] }>;
export type ApplicationRequirementsEditorIntent = ApplicationRequirementsTarget & Readonly<{ requestId: string; payload: ApplicationRequirementsEditorPayload }>;
export type ApplicationRequirementsEditorReceipt = ApplicationRequirementsTarget & Readonly<{ protocolVersion: 1; requestId: string; revisionId: string; revisionVersion: string; previousRevisionId: string | null; savedAt: string; items: readonly Readonly<{ requirementItemId: string; requirementKey: string; documentSlotId: string; position: number }>[] }>;
export type ApplicationRequirementsEditorFailure = "invalid" | "forbidden" | "request_conflict" | "stale_context" | "case_ineligible" | "application_ineligible" | "legacy_configuration_conflict" | "editor_limit" | "unavailable";
export type ApplicationRequirementsEditorResult = Readonly<{ ok: true; receipt: ApplicationRequirementsEditorReceipt }> | Readonly<{ ok: false; reason: ApplicationRequirementsEditorFailure; resolution: "retain" | "not_written" }>;

const SLOT_STATUSES = ["required", "submitted", "approved", "correction_required", "rejected"] as const;
const REVIEWS = ["approved", "correction_required", "rejected"] as const;
const FILE_REASONS = ["file_missing", "upload_not_finalized", "integrity_pending", "integrity_failed", "malware_pending", "malware_infected", "malware_error"] as const;
// PostgreSQL JSONB cannot represent U+0000. Keep the existing v2 read validator unchanged.
function scalarText(value: unknown, maximum = Infinity): value is string { return v2ScalarText(value, maximum) && !value.includes("\u0000"); }
function row(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function member<T extends string>(value: unknown, values: readonly T[]): value is T { return typeof value === "string" && values.includes(value as T); }
function nullable<T>(value: unknown, valid: (value: unknown) => value is T): value is T | null { return value === null || valid(value); }
function textOrNull(value: unknown, maximum = Infinity): value is string | null { return value === null || scalarText(value, maximum); }
function hash(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/u.exec(value)?.[0] === value; }
function sourceKey(value: unknown): value is string { return typeof value === "string" && /^(prior|country|link|application):/u.test(value) && uuid(value.slice(value.indexOf(":") + 1)); }
// Historical 043 keys have a grammar but no v2 item-key length limit.
function legacyRequirementKey(value: unknown): value is string { return scalarText(value) && /^[a-z][a-z0-9_.-]*$/u.exec(value)?.[0] === value; }
function ordered<T>(values: readonly T[], key: (value: T) => string): boolean { return values.every((value, index) => index === 0 || key(values[index - 1]) < key(value)); }
function unique<T>(values: readonly T[], key: (value: T) => string): boolean { return new Set(values.map(key)).size === values.length; }
function list<T>(value: unknown, maximum: number, parse: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const result: T[] = [];
  for (const entry of value) { const item = parse(entry); if (item === null) return null; result.push(item); }
  return result;
}
function uuidList(value: unknown): string[] | null { const values = list(value, 50, value => uuid(value) ? value : null); return values && ordered(values, value => value) ? values : null; }
function versionPair(id: unknown, version: unknown) { return (id === null && version === null) || (uuid(id) && decimalVersion(version)); }
/** Closed payload has only strings, booleans, null, arrays and objects. PostgreSQL
 * jsonb::text separates entries with ', ' and keys/values with ': '. Key order
 * does not affect the UTF-8 byte count. String escaping matches JSON.stringify. */
function jsonbText(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") { if (value.includes("\u0000")) throw new Error("Unrepresentable JSONB string"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
  const object = row(value);
  if (object) return `{${Object.keys(object).map(key => `${JSON.stringify(key)}: ${jsonbText(object[key])}`).join(", ")}}`;
  throw new Error("Unsupported payload value");
}

function parseBinding(value: unknown): Binding | null {
  const r = row(value);
  if (!r || !exact(r, ["institutionId", "publicationId", "publicationVersion", "programId", "intakeId", "institutionName", "programTitle", "intakeLabel", "selectedAt", "deadlineStateAtSelection"])
    || !uuid(r.institutionId) || !uuid(r.publicationId) || !uuid(r.intakeId) || typeof r.publicationVersion !== "number" || !Number.isSafeInteger(r.publicationVersion) || r.publicationVersion < 1 || r.publicationVersion > 9007199254740990
    || typeof r.programId !== "string" || r.programId.length > 64 || /^[a-z0-9][a-z0-9-]*$/u.exec(r.programId)?.[0] !== r.programId
    || !scalarText(r.institutionName) || !scalarText(r.programTitle) || !scalarText(r.intakeLabel) || !timestamp(r.selectedAt) || !member(r.deadlineStateAtSelection, ["confirmed", "needs_confirmation"])) return null;
  return r as unknown as Binding;
}
function parseLegacy(value: unknown): LegacyApplication | null {
  const r = row(value);
  if (!r || !exact(r, ["documentsApplicability", "documentsSource", "documentsCheckedOn", "documentSlotIds", "documentExceptionSlotIds", "documentsExceptionReason", "documentsExceptionEvidence"])
    || (r.documentsApplicability !== null && !member(r.documentsApplicability, ["needs_confirmation", "required", "not_required"]))
    || !textOrNull(r.documentsSource, 2000) || !nullable(r.documentsCheckedOn, calendarDate) || !textOrNull(r.documentsExceptionReason, 2000) || !textOrNull(r.documentsExceptionEvidence, 2000)) return null;
  const ids = uuidList(r.documentSlotIds), exceptions = uuidList(r.documentExceptionSlotIds);
  if (!ids || !exceptions || exceptions.some(id => !ids.includes(id))) return null;
  return { ...r, documentSlotIds: ids, documentExceptionSlotIds: exceptions } as unknown as LegacyApplication;
}
function parseCandidate(value: unknown): ApplicationRequirementsEditorCandidate | null {
  const r = row(value);
  if (!r || !exact(r, ["documentSlotId", "slotVersion", "intentKind", "sourceRequirement", "rawLabel", "rawGroupLabel", "label", "groupLabel", "instructions", "slotStatus", "currentVersionId", "currentVersionNo", "filename", "reviewDecision", "reviewReason", "reviewedAt", "technicalAvailability", "unavailableReasons", "links"])
    || !uuid(r.documentSlotId) || !decimalVersion(r.slotVersion) || !member(r.intentKind, ["baseline", "custom"]) || !textOrNull(r.rawLabel) || !textOrNull(r.rawGroupLabel)
    || !scalarText(r.label) || !scalarText(r.groupLabel) || !textOrNull(r.instructions) || !member(r.slotStatus, SLOT_STATUSES)
    || !versionPair(r.currentVersionId, r.currentVersionNo) || !textOrNull(r.filename) || !nullable(r.reviewDecision, value => member(value, REVIEWS)) || !textOrNull(r.reviewReason) || !nullable(r.reviewedAt, timestamp)
    || (r.reviewDecision === null) !== (r.reviewedAt === null) || ((r.reviewDecision === null || r.reviewDecision === "approved") && r.reviewReason !== null)
    || !member(r.technicalAvailability, ["available", "unavailable"])) return null;
  const requirement = row(r.sourceRequirement);
  if (r.intentKind === "baseline") {
    if (!requirement || !exact(requirement, ["requirementId", "requirementKey", "checklistVersion"]) || !uuid(requirement.requirementId) || !legacyRequirementKey(requirement.requirementKey) || !decimalVersion(requirement.checklistVersion)) return null;
  } else if (r.sourceRequirement !== null || !scalarText(r.rawLabel) || !scalarText(r.rawGroupLabel) || r.instructions !== null) return null;
  if ((r.rawLabel !== null && r.label !== r.rawLabel) || (r.rawGroupLabel !== null && r.groupLabel !== r.rawGroupLabel)) return null;
  const reasons = list(r.unavailableReasons, FILE_REASONS.length, entry => member(entry, FILE_REASONS) ? entry : null);
  const links = list(r.links, Number.MAX_SAFE_INTEGER, entry => {
    const l = row(entry);
    return l && exact(l, ["linkId", "targetKind", "targetId"]) && uuid(l.linkId) && uuid(l.targetId) && member(l.targetKind, ["university_application", "visa_case"]) ? l as unknown as Link : null;
  });
  if (!reasons || !unique(reasons, value => value) || !links || !ordered(links, l => `${l.targetKind}:${l.targetId}:${l.linkId}`) || !unique(links, l => l.linkId) || !unique(links, l => `${l.targetKind}:${l.targetId}`)
    || (r.technicalAvailability === "available") !== (reasons.length === 0)
    || reasons.filter(reason => reason.startsWith("integrity_")).length > 1 || reasons.filter(reason => reason.startsWith("malware_")).length > 1) return null;
  if (r.currentVersionId === null) {
    if (r.filename !== null || r.reviewDecision !== null || reasons.length !== 1 || reasons[0] !== "file_missing") return null;
  } else if (r.filename === null || reasons.includes("file_missing")) return null;
  return { ...r, unavailableReasons: reasons, links } as unknown as ApplicationRequirementsEditorCandidate;
}
function parseSource(value: unknown): ApplicationRequirementsEditorSource | null {
  const r = row(value);
  if (!r || !exact(r, ["sourceKey", "kind", "documentSlotId", "materialState", "required", "label", "groupLabel", "instructions", "reference", "legacyException", "mustRetain"])
    || !sourceKey(r.sourceKey) || !member(r.kind, ["prior", "country", "link", "application"]) || !nullable(r.documentSlotId, uuid)
    || !member(r.materialState, ["selectable", "removed", "missing"]) || (r.required !== null && typeof r.required !== "boolean")
    || !textOrNull(r.label) || !textOrNull(r.groupLabel) || !textOrNull(r.instructions) || typeof r.legacyException !== "boolean" || typeof r.mustRetain !== "boolean") return null;
  const ref = row(r.reference);
  if (!ref || (r.materialState !== "missing" && r.documentSlotId === null) || (r.kind !== "application" && (r.legacyException || r.mustRetain))) return null;
  if (r.kind === "prior") {
    if (!exact(ref, ["revisionId", "revisionVersion", "requirementItemId", "requirementKey", "origin", "compatibilityKey", "typedStarterEligible"])
      || !uuid(ref.revisionId) || !decimalVersion(ref.revisionVersion) || !uuid(ref.requirementItemId) || !requirementKey(ref.requirementKey) || !requirementKey(ref.compatibilityKey)
      || !member(ref.origin, ["evo_starter", "staff_confirmed"]) || typeof ref.typedStarterEligible !== "boolean" || r.sourceKey !== `prior:${ref.requirementItemId}` || typeof r.required !== "boolean"
      || !scalarText(r.label) || !scalarText(r.groupLabel) || !scalarText(r.instructions) || !uuid(r.documentSlotId)
      || (ref.typedStarterEligible && (!member(ref.requirementKey, APPLICATION_REQUIREMENT_KEYS) || ref.compatibilityKey !== ref.requirementKey))) return null;
  } else if (r.kind === "country") {
    if (!exact(ref, ["manifestId", "manifestVersion", "manifestStatus", "requirementId", "requirementKey", "requirementStatus"]) || !uuid(ref.manifestId) || !decimalVersion(ref.manifestVersion)
      || !member(ref.manifestStatus, ["approved", "retired"]) || !uuid(ref.requirementId) || !legacyRequirementKey(ref.requirementKey) || !member(ref.requirementStatus, ["active", "retired"])
      || r.sourceKey !== `country:${ref.requirementId}` || r.required !== null || !scalarText(r.label) || !scalarText(r.groupLabel) || !scalarText(r.instructions)) return null;
  } else {
    if (!uuid(r.documentSlotId) || r.sourceKey !== `${r.kind}:${r.documentSlotId}` || (r.materialState === "missing" && (r.label !== null || r.groupLabel !== null || r.instructions !== null))
      || (r.materialState !== "missing" && (!scalarText(r.label) || !scalarText(r.groupLabel)))) return null;
    if (r.kind === "link") { if (!exact(ref, ["linkId"]) || !uuid(ref.linkId) || r.required !== null) return null; }
    else if (!exact(ref, ["applicationVersion"]) || !decimalVersion(ref.applicationVersion)) return null;
  }
  return r as unknown as ApplicationRequirementsEditorSource;
}

/** Closed projection plus cross-object correlations; the server remains the inventory authority. */
export function parseApplicationRequirementsEditorContext(value: unknown, studentCaseId: string, applicationId: string): ApplicationRequirementsEditorContext | null {
  const r = row(value);
  if (!r || !exact(r, ["protocolVersion", "studentCaseId", "applicationId", "applicationVersion", "admissionsVersion", "binding", "requirements", "legacyApplication", "sources", "candidates", "canSave", "saveBlockReason", "contextHash"])
    || r.protocolVersion !== 1 || !uuid(studentCaseId) || !uuid(applicationId) || r.studentCaseId !== studentCaseId || r.applicationId !== applicationId || !decimalVersion(r.applicationVersion)
    || (r.admissionsVersion !== "0" && !decimalVersion(r.admissionsVersion)) || typeof r.canSave !== "boolean" || (r.saveBlockReason !== null && !member(r.saveBlockReason, ["permission_required", "case_inactive", "portal_inactive", "application_not_preparation"]))
    || r.canSave !== (r.saveBlockReason === null) || !hash(r.contextHash)) return null;
  const binding = parseBinding(r.binding), requirements = parseApplicationRequirementsV2(r.requirements, studentCaseId, applicationId), legacy = parseLegacy(r.legacyApplication);
  const candidates = list(r.candidates, 1000, parseCandidate), sources = list(r.sources, 2000, parseSource);
  if (!binding || !requirements || requirements.items.length > 100 || !legacy || !candidates || !sources || !ordered(candidates, c => c.documentSlotId) || !ordered(sources, s => s.sourceKey)) return null;
  if (!unique(candidates.flatMap(c => c.links), l => l.linkId) || !unique(candidates.flatMap(c => c.sourceRequirement ? [c.sourceRequirement] : []), r => r.requirementId)) return null;
  const candidateById = new Map(candidates.map(c => [c.documentSlotId, c])), sourceByKey = new Map(sources.map(s => [s.sourceKey, s]));
  const priorSources = sources.filter(s => s.kind === "prior"), appSources = sources.filter(s => s.kind === "application");
  if (priorSources.length !== requirements.items.length || appSources.length !== legacy.documentSlotIds.length) return null;
  let manifest: string | null = null;
  for (const s of sources) {
    const c = s.documentSlotId === null ? undefined : candidateById.get(s.documentSlotId);
    if ((s.materialState === "selectable") !== Boolean(c)) return null;
    if (s.kind === "prior") {
      const item = requirements.items.find(item => item.requirementItemId === s.reference.requirementItemId);
      if (!item || s.reference.revisionId !== requirements.revisionId || s.reference.revisionVersion !== requirements.revisionVersion || s.reference.origin !== requirements.origin
        || s.reference.requirementKey !== item.requirementKey || s.reference.compatibilityKey !== item.compatibilityKey || s.documentSlotId !== item.documentSlotId
        || s.required !== item.required || s.label !== item.label || s.groupLabel !== item.groupLabel || s.instructions !== item.instructions) return null;
    } else if (s.kind === "country") {
      const identity = `${s.reference.manifestId}:${s.reference.manifestVersion}:${s.reference.manifestStatus}`;
      if ((manifest !== null && manifest !== identity) || (c && (c.sourceRequirement?.requirementId !== s.reference.requirementId || c.sourceRequirement.checklistVersion !== s.reference.manifestVersion || c.sourceRequirement.requirementKey !== s.reference.requirementKey))) return null;
      manifest = identity;
    } else if (s.kind === "application") {
      const required = legacy.documentsApplicability === "required" ? true : legacy.documentsApplicability === "not_required" ? false : null;
      if (!legacy.documentSlotIds.includes(s.documentSlotId!) || s.reference.applicationVersion !== r.applicationVersion || s.required !== required || s.mustRetain !== (required === true) || s.legacyException !== legacy.documentExceptionSlotIds.includes(s.documentSlotId!)) return null;
    } else if (c && !c.links.some(l => l.linkId === s.reference.linkId && l.targetKind === "university_application" && l.targetId === applicationId)) return null;
    if (c && (s.kind === "link" || s.kind === "application") && (s.label !== c.label || s.groupLabel !== c.groupLabel || s.instructions !== c.instructions)) return null;
  }
  for (const c of candidates) for (const l of c.links) if (l.targetKind === "university_application" && l.targetId === applicationId) {
    const s = sourceByKey.get(`link:${c.documentSlotId}`);
    if (!s || s.kind !== "link" || s.reference.linkId !== l.linkId) return null;
  }
  for (const item of requirements.items) {
    // Masked mappings remain masked; never reconstruct their file/review through candidates.
    if (item.unavailableReasons.some(reason => ["slot_missing", "slot_removed", "application_link_missing", "slot_metadata_changed"].includes(reason))) continue;
    const c = candidateById.get(item.documentSlotId);
    if (!c || !c.links.some(l => l.targetKind === "university_application" && l.targetId === applicationId)
      || item.slotStatus !== c.slotStatus || item.currentVersionId !== c.currentVersionId || item.currentVersionNo !== c.currentVersionNo || item.reviewDecision !== c.reviewDecision
      || item.reviewReason !== c.reviewReason || item.reviewedAt !== c.reviewedAt || item.technicalAvailability !== c.technicalAvailability
      || [...item.unavailableReasons].sort().join() !== [...c.unavailableReasons].sort().join()) return null;
  }
  return { ...r, binding, requirements, legacyApplication: legacy, candidates, sources } as unknown as ApplicationRequirementsEditorContext;
}

function parseItem(value: unknown): ApplicationRequirementsEditorItem | null {
  const r = row(value);
  if (!r || !exact(r, ["requirementKey", "required", "label", "groupLabel", "instructions", "deadline", "material", "provenance"]) || !requirementKey(r.requirementKey)
    || typeof r.required !== "boolean" || !scalarText(r.label, 500) || !scalarText(r.groupLabel, 200) || !scalarText(r.instructions, 4000)) return null;
  const d = r.deadline === null ? null : deadline(r.deadline), m = row(r.material), p = row(r.provenance);
  if ((r.deadline !== null && !d) || !m || !p) return null;
  if (m.kind === "existing") {
    if (!exact(m, ["kind", "documentSlotId", "expectedSlotVersion", "expectedCurrentVersionId", "expectedCurrentVersionNo"]) || !uuid(m.documentSlotId) || !decimalVersion(m.expectedSlotVersion) || !versionPair(m.expectedCurrentVersionId, m.expectedCurrentVersionNo)) return null;
  } else if (m.kind !== "new" || !exact(m, ["kind", "label", "groupLabel"]) || !scalarText(m.label, 500) || !scalarText(m.groupLabel, 200)
    || /\p{Cc}/u.test(m.label) || /\p{Cc}/u.test(m.groupLabel)) return null;
  if (!exact(p, ["kind", "sourceKey", "basis"]) || !member(p.kind, ["typed_starter", "country_manifest", "application_details", "staff_entry"]) || !scalarText(p.basis, 2000)) return null;
  if (p.kind === "staff_entry") { if (p.sourceKey !== null) return null; }
  else if (!sourceKey(p.sourceKey) || !p.sourceKey.startsWith(p.kind === "typed_starter" ? "prior:" : p.kind === "country_manifest" ? "country:" : "application:") || m.kind !== "existing") return null;
  return { ...r, deadline: d } as ApplicationRequirementsEditorItem;
}
function parseDecision(value: unknown): ApplicationRequirementsEditorSourceDecision | null {
  const r = row(value);
  if (!r || !exact(r, ["sourceKey", "disposition", "requirementKey", "reason"]) || !sourceKey(r.sourceKey) || !textOrNull(r.reason, 2000)) return null;
  if (r.disposition === "included") { if (!requirementKey(r.requirementKey)) return null; }
  else if (r.disposition !== "excluded" || r.requirementKey !== null || !scalarText(r.reason, 2000)) return null;
  return r as unknown as ApplicationRequirementsEditorSourceDecision;
}
export function parseApplicationRequirementsEditorPayload(value: unknown): ApplicationRequirementsEditorPayload | null {
  const r = row(value);
  if (!r || !exact(r, ["expectedContextHash", "expectedApplicationVersion", "expectedRevisionId", "expectedRevisionVersion", "changeReason", "items", "sourceDecisions"])
    || !hash(r.expectedContextHash) || !decimalVersion(r.expectedApplicationVersion) || !versionPair(r.expectedRevisionId, r.expectedRevisionVersion) || !scalarText(r.changeReason, 2000)) return null;
  const items = list(r.items, 100, parseItem), decisions = list(r.sourceDecisions, 2000, parseDecision);
  if (!items?.length || !decisions || !unique(items, i => i.requirementKey) || !unique(decisions, d => d.sourceKey)) return null;
  const existing = items.filter(i => i.material.kind === "existing");
  if (!unique(existing, i => i.material.kind === "existing" ? i.material.documentSlotId : "")) return null;
  for (const d of decisions) if (d.disposition === "included" && !items.some(i => i.requirementKey === d.requirementKey)) return null;
  for (const item of items) if (item.provenance.sourceKey !== null && !decisions.some(d => d.sourceKey === item.provenance.sourceKey && d.disposition === "included" && d.requirementKey === item.requirementKey)) return null;
  const result = { expectedContextHash: r.expectedContextHash, expectedApplicationVersion: r.expectedApplicationVersion, expectedRevisionId: r.expectedRevisionId, expectedRevisionVersion: r.expectedRevisionVersion, changeReason: r.changeReason, items, sourceDecisions: decisions } as ApplicationRequirementsEditorPayload;
  try { if (new TextEncoder().encode(jsonbText(result)).length > 1024 * 1024) return null; } catch { return null; }
  return result;
}
export function parseApplicationRequirementsEditorIntent(value: unknown): ApplicationRequirementsEditorIntent | null {
  const r = row(value);
  if (!r || !exact(r, ["studentCaseId", "applicationId", "requestId", "payload"]) || !uuid(r.studentCaseId) || !uuid(r.applicationId) || !uuid(r.requestId)) return null;
  const payload = parseApplicationRequirementsEditorPayload(r.payload);
  return payload ? { studentCaseId: r.studentCaseId, applicationId: r.applicationId, requestId: r.requestId, payload } : null;
}
export function parseApplicationRequirementsEditorReceipt(value: unknown, intent: ApplicationRequirementsEditorIntent): ApplicationRequirementsEditorReceipt | null {
  const r = row(value);
  if (!r || !exact(r, ["protocolVersion", "requestId", "studentCaseId", "applicationId", "revisionId", "revisionVersion", "previousRevisionId", "savedAt", "items"])
    || r.protocolVersion !== 1 || r.requestId !== intent.requestId || r.studentCaseId !== intent.studentCaseId || r.applicationId !== intent.applicationId || !uuid(r.revisionId) || !decimalVersion(r.revisionVersion)
    || r.previousRevisionId !== intent.payload.expectedRevisionId || r.revisionId === r.previousRevisionId || !timestamp(r.savedAt)
    || BigInt(r.revisionVersion) !== BigInt(intent.payload.expectedRevisionVersion ?? "0") + BigInt(1)) return null;
  const items = list(r.items, 100, entry => {
    const i = row(entry);
    return i && exact(i, ["requirementItemId", "requirementKey", "documentSlotId", "position"]) && uuid(i.requirementItemId) && requirementKey(i.requirementKey) && uuid(i.documentSlotId) && typeof i.position === "number" ? i as unknown as ApplicationRequirementsEditorReceipt["items"][number] : null;
  });
  if (!items || items.length !== intent.payload.items.length || !unique(items, i => i.requirementItemId) || !unique(items, i => i.documentSlotId)) return null;
  if (items.some((item, index) => item.position !== index + 1 || item.requirementKey !== intent.payload.items[index].requirementKey || (intent.payload.items[index].material.kind === "existing" && item.documentSlotId !== (intent.payload.items[index].material as Extract<Material, { kind: "existing" }>).documentSlotId))) return null;
  return { ...r, items } as unknown as ApplicationRequirementsEditorReceipt;
}
export function applicationRequirementsEditorRpcArgs(intent: ApplicationRequirementsEditorIntent) {
  return { p_student_case_id: intent.studentCaseId, p_application_id: intent.applicationId, p_request_id: intent.requestId, p_payload: intent.payload };
}
export function applicationRequirementsEditorFailure(error: Readonly<{ code?: string; message?: string }>): ApplicationRequirementsEditorFailure {
  const failures: Readonly<Record<string, readonly [string, ApplicationRequirementsEditorFailure]>> = {
    application_requirements_invalid_intent: ["22023", "invalid"], application_requirements_unavailable: ["42501", "forbidden"],
    application_requirements_request_conflict: ["22023", "request_conflict"], application_requirements_stale_context: ["PT409", "stale_context"],
    application_requirements_case_ineligible: ["PT409", "case_ineligible"], application_requirements_application_ineligible: ["PT409", "application_ineligible"],
    application_requirements_legacy_configuration_conflict: ["PT409", "legacy_configuration_conflict"], application_requirements_editor_limit: ["PT413", "editor_limit"],
  };
  const match = error.message && Object.hasOwn(failures, error.message) ? failures[error.message] : undefined;
  return match && error.code === match[0] ? match[1] : "unavailable";
}
