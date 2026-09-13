import {
  PROFILE_FIELDS, isProfileFieldKey, normalizeDate, normalizeProfileField,
  type ProfileFieldKey, type ProfileFieldsSnapshot,
} from "./student-profile-fields.ts";

/** Pure mapping/field readiness only. Not a template, layout or export authorization. */
export interface UniversityFormSlot {
  readonly id: string;
  readonly text: string;
  readonly context: string;
  readonly kind: "blank" | "label";
  readonly editable: boolean;
  readonly manualReason: string | null;
}
export type UniversityFormFormat = "text" | "DD.MM.YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" | "DD" | "MM" | "YYYY";
export interface UniversityPdfPageSize { readonly width: number; readonly height: number }
/** Points from the visible page's top-left corner; page numbers are one-based. */
export interface UniversityPdfPosition extends UniversityPdfPageSize {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly characterCount?: number;
}
export const UNIVERSITY_FORM_SOURCES = [
  { key: "full_name", keys: ["student_first_name", "student_last_name"] },
  { key: "surname_first_name", keys: ["student_last_name", "student_first_name"] },
  { key: "father_full_name", keys: ["father_first_name", "father_last_name"] },
  { key: "mother_full_name", keys: ["mother_first_name", "mother_last_name"] },
  ...PROFILE_FIELDS.map(field => ({ key: field.key, keys: [field.key] })),
] as const;
export type UniversityFormSourceKey = ProfileFieldKey | "full_name" | "surname_first_name" | "father_full_name" | "mother_full_name";
export interface UniversityFormMapping {
  readonly slotId: string;
  readonly sourceKey: UniversityFormSourceKey | null;
  readonly required: boolean;
  readonly format: UniversityFormFormat;
  readonly manual: boolean;
  readonly position?: UniversityPdfPosition;
}
interface UniversityFormTemplateBase {
  readonly versionId: string;
  readonly sha256: string;
  /** Inspection of these exact template bytes, supplied by the outer trusted boundary. */
  readonly slots: readonly UniversityFormSlot[];
}
export type UniversityFormTemplateSnapshot = UniversityFormTemplateBase & (
  { readonly format?: "docx" } | { readonly format: "pdf"; readonly pageSizes: readonly UniversityPdfPageSize[] }
);
export interface UniversityFormMappingContent {
  readonly versionId: string;
  readonly templateVersionId: string;
  readonly templateSha256: string;
  readonly mappings: readonly UniversityFormMapping[];
}
export interface UniversityFormMappingSnapshot extends UniversityFormMappingContent { readonly sha256: string }
export interface UniversityFormMappingReviewSnapshot {
  readonly versionId: string;
  readonly templateVersionId: string;
  readonly templateSha256: string;
  readonly mappingVersionId: string;
  readonly mappingSha256: string;
  readonly state: "approved" | "rejected";
}
export type UniversityFormValueState = "confirmed" | "confirmed_empty" | "missing" | "unconfirmed" | "conflict" | "invalid" | "manual";
export interface UniversityFormResolvedValue {
  readonly slotId: string;
  readonly sourceKey: UniversityFormSourceKey | null;
  readonly fieldKeys: readonly ProfileFieldKey[];
  readonly required: boolean;
  readonly state: UniversityFormValueState;
  /** Unresolved values are never exposed as render assignments. */
  readonly value: string;
  readonly position?: UniversityPdfPosition;
}
export interface UniversityFormResolution {
  readonly reviewState: "approved" | "rejected";
  readonly templateVersionId: string;
  readonly templateSha256: string;
  readonly mappingVersionId: string;
  readonly mappingSha256: string;
  readonly reviewVersionId: string;
  readonly templateFormat: "docx" | "pdf";
  readonly pageSizes: readonly UniversityPdfPageSize[];
  readonly fieldsReady: boolean;
  readonly values: readonly UniversityFormResolvedValue[];
}
export interface UniversityFormAssignment { readonly slotId: string; readonly value: string }
export class UniversityFormFieldsError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "UniversityFormFieldsError"; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const FORMATS: readonly string[] = ["text", "DD.MM.YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "DD", "MM", "YYYY"];
const DATE_SOURCES = new Set<string>(["date_of_birth", "passport_expiry_date", "desired_start_date"]);
const sources = new Map<string, readonly string[]>(UNIVERSITY_FORM_SOURCES.map(source => [source.key, source.keys]));
const resolutions = new WeakSet<UniversityFormResolution>();
function fail(code: string): never { throw new UniversityFormFieldsError(code); }

function canonicalPosition(position: UniversityPdfPosition): UniversityPdfPosition {
  if (!position || !Number.isInteger(position.page) || ![position.x, position.y, position.width, position.height].every(Number.isFinite)
    || (position.characterCount !== undefined && !Number.isInteger(position.characterCount))) fail("invalid_mapping_snapshot");
  return { page: position.page, x: position.x, y: position.y, width: position.width, height: position.height,
    ...(position.characterCount !== undefined ? { characterCount: position.characterCount } : {}) };
}

function canonicalContent(content: UniversityFormMappingContent): string {
  if (!UUID.test(content.versionId) || !UUID.test(content.templateVersionId) || !HASH.test(content.templateSha256)
    || !Array.isArray(content.mappings) || content.mappings.length > 3000) fail("invalid_mapping_snapshot");
  const seen = new Set<string>();
  const mappings = content.mappings.map(mapping => {
    if (!mapping || !/^(?:p|pdf)-[1-9]\d{0,3}$/u.test(mapping.slotId) || seen.has(mapping.slotId)
      || typeof mapping.required !== "boolean" || typeof mapping.manual !== "boolean" || !FORMATS.includes(mapping.format)
      || (mapping.manual ? mapping.sourceKey !== null || mapping.format !== "text" : !sources.has(mapping.sourceKey ?? ""))
      || (mapping.format !== "text" && !DATE_SOURCES.has(mapping.sourceKey ?? ""))) fail("invalid_mapping_snapshot");
    seen.add(mapping.slotId);
    return { slotId: mapping.slotId, sourceKey: mapping.sourceKey, required: mapping.required, format: mapping.format, manual: mapping.manual,
      ...(mapping.position !== undefined ? { position: canonicalPosition(mapping.position) } : {}) };
  }).sort((left, right) => left.slotId < right.slotId ? -1 : left.slotId > right.slotId ? 1 : 0);
  return JSON.stringify({ versionId: content.versionId, templateVersionId: content.templateVersionId, templateSha256: content.templateSha256, mappings });
}

/** Canonical UTF-8 JSON: fixed property order above, mappings sorted by slot ID. */
export async function computeUniversityFormMappingHash(content: UniversityFormMappingContent): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalContent(content));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function resolveUniversityFormMappings(input: {
  readonly template: UniversityFormTemplateSnapshot;
  readonly mapping: UniversityFormMappingSnapshot;
  readonly review: UniversityFormMappingReviewSnapshot;
  readonly profile: ProfileFieldsSnapshot;
  readonly today: string;
}): Promise<UniversityFormResolution> {
  // Capture once before awaiting: callers cannot swap values while hashing is in flight.
  const { template, mapping, review, profile, today } = structuredClone(input);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(today) || normalizeDate(today) !== today) fail("invalid_validation_day");
  if (!UUID.test(template.versionId) || !HASH.test(template.sha256) || !UUID.test(review.versionId)
    || !HASH.test(mapping.sha256) || !["approved", "rejected"].includes(review.state)
    || mapping.templateVersionId !== template.versionId || mapping.templateSha256 !== template.sha256
    || review.templateVersionId !== template.versionId || review.templateSha256 !== template.sha256
    || review.mappingVersionId !== mapping.versionId || review.mappingSha256 !== mapping.sha256) fail("mapping_review_mismatch");
  if (await computeUniversityFormMappingHash(mapping) !== mapping.sha256) fail("mapping_review_mismatch");
  const templateFormat = template.format ?? "docx";
  if (!["docx", "pdf"].includes(templateFormat)) fail("invalid_template_snapshot");
  const pageSizes = template.format === "pdf" ? template.pageSizes : [];
  if (!Array.isArray(pageSizes) || (templateFormat === "pdf" && (!pageSizes.length || pageSizes.length > 100))
    || pageSizes.some(page => !page || ![page.width, page.height].every(value => Number.isFinite(value) && value >= 72 && value <= 3000))) fail("invalid_template_snapshot");
  if (mapping.mappings.some(item => templateFormat === "pdf" ? !item.position || !item.slotId.startsWith("pdf-") : item.position !== undefined || !item.slotId.startsWith("p-"))) fail("invalid_mapping_snapshot");
  if (!Array.isArray(template.slots) || template.slots.length > 3000) fail("invalid_template_snapshot");
  const slots = new Map<string, UniversityFormSlot>();
  for (const slot of template.slots) {
    if (!slot || !/^(?:p|pdf)-[1-9]\d{0,3}$/u.test(slot.id) || slots.has(slot.id) || typeof slot.editable !== "boolean"
      || !["blank", "label"].includes(slot.kind) || typeof slot.text !== "string" || typeof slot.context !== "string"
      || !(slot.manualReason === null || typeof slot.manualReason === "string")) fail("invalid_template_snapshot");
    slots.set(slot.id, slot);
  }
  const fields = new Map<ProfileFieldKey, ProfileFieldsSnapshot["fields"][number]>();
  if (!Array.isArray(profile.fields)) fail("invalid_profile_snapshot");
  for (const field of profile.fields) {
    if (!field || !isProfileFieldKey(field.key) || fields.has(field.key) || !(field.value === null || typeof field.value === "string")
      || !["confirmed", "conflict", "needs_review", "extracted"].includes(field.state)) fail("invalid_profile_snapshot");
    fields.set(field.key, field);
  }
  const values = mapping.mappings.map((item): UniversityFormResolvedValue => {
    const slot = slots.get(item.slotId);
    if (!slot) fail("mapping_slot_not_found");
    const keys = (sources.get(item.sourceKey ?? "") ?? []) as readonly ProfileFieldKey[];
    const base = { slotId: item.slotId, sourceKey: item.sourceKey, required: item.required, fieldKeys: Object.freeze([...keys]),
      ...(item.position ? { position: Object.freeze(canonicalPosition(item.position)) } : {}) };
    const resolved = (state: UniversityFormValueState, value = ""): UniversityFormResolvedValue => Object.freeze({ ...base, state, value });
    if (item.manual || !slot.editable) return resolved("manual");
    const components = keys.map(key => fields.get(key));
    if (components.some(field => field?.state === "conflict")) return resolved("conflict");
    if (components.some(field => field && field.state !== "confirmed")) return resolved("unconfirmed");
    let normalized;
    try { normalized = keys.map((key, index) => normalizeProfileField(key, components[index]?.value ?? null, { today })); }
    catch { return resolved("invalid"); }
    if (normalized.some(field => !field.valid)) return resolved("invalid");
    if (components.some(field => !field)) return resolved("missing");
    if (normalized.some(field => !field.value)) return resolved("confirmed_empty");
    let value = normalized.map(field => field.value).join(" ");
    if (item.format !== "text") {
      const date = keys.length === 1 && DATE_SOURCES.has(keys[0]) ? normalizeDate(value) : null;
      if (!date) return resolved("invalid");
      const [year, month, day] = date.split("-");
      value = ({ "DD.MM.YYYY": `${day}.${month}.${year}`, "DD/MM/YYYY": `${day}/${month}/${year}`, "YYYY-MM-DD": date, DD: day, MM: month, YYYY: year })[item.format];
    }
    return resolved("confirmed", value);
  });
  const fieldsReady = review.state === "approved" && values.every(value => value.state === "confirmed"
    || (!value.required && ["confirmed_empty", "missing"].includes(value.state)));
  const result: UniversityFormResolution = Object.freeze({ reviewState: review.state, templateVersionId: template.versionId,
    templateSha256: template.sha256, mappingVersionId: mapping.versionId, mappingSha256: mapping.sha256,
    reviewVersionId: review.versionId, templateFormat, pageSizes: Object.freeze(pageSizes.map(page => Object.freeze({ width: page.width, height: page.height }))), fieldsReady, values: Object.freeze(values) });
  resolutions.add(result);
  return result;
}

/** Returns field assignments, not permission to release a document to a user. */
export function getUniversityFormAssignments(resolution: UniversityFormResolution, mode: "draft" | "final"): readonly UniversityFormAssignment[] {
  if (!resolutions.has(resolution) || !["draft", "final"].includes(mode)) fail("invalid_mapping_resolution");
  if (resolution.reviewState !== "approved") fail("mapping_not_approved");
  if (mode === "final" && !resolution.fieldsReady) fail("form_fields_not_ready");
  return Object.freeze(resolution.values.filter(value => value.state === "confirmed")
    .map(value => Object.freeze({ slotId: value.slotId, value: value.value })));
}
