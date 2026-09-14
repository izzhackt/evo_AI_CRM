import { PROFILE_FIELD_KEYS, normalizeDate, type ProfileFieldKey, type ProfileFieldState } from "./student-profile-fields.ts";
import { normalizeUniversityFormRegistryMappings, type UniversityTemplateMime } from "./university-form-registry.ts";
import type { UniversityFormMappingSnapshot, UniversityFormMappingReviewSnapshot } from "./university-form-fields.ts";

/** Private frozen inputs only. No Auth, receipt lifecycle, document parser or I/O. */
export const UNIVERSITY_FORM_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const UNIVERSITY_FORM_FONT_SHA256 = "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5";
export type FormBinding = Readonly<{
  application_id: string; catalog_institution_id: string; catalog_source_revision: string;
  template_id: string; template_version_id: string; inspection_receipt_id: string;
  mapping_id: string; mapping_sha256: string; review_id: string; validation_day: string;
}>;
export type BoundTemplate = Readonly<{ versionId: string; sha256: string; manifest:
  | Readonly<{ format: "docx"; slots: readonly Readonly<{ id: string; editable: boolean }>[]; pageSizes: readonly [] }>
  | Readonly<{ format: "pdf"; slots: readonly []; pageSizes: readonly Readonly<{ width: number; height: number }>[] }>
}>;
export type FrozenProfile164 = Readonly<{
  student_case_id: string; profile: Readonly<{ id: string; revision: number }>;
  can_initialize: false; can_review: false; can_export: true;
  fields: readonly Readonly<{ field_key: ProfileFieldKey; value: string | null; review_state: ProfileFieldState;
    reviewed_at: string | null; source_document_version_id: string | null; source_page: number | null; proposals: readonly [] }>[];
}>;
export type FormMetadata = Readonly<{
  schema_version: 1; kind: "university_form"; organization_id: string; student_case_id: string;
  form: FormBinding; template: BoundTemplate; mapping: UniversityFormMappingSnapshot; review: UniversityFormMappingReviewSnapshot;
  source_byte_size: number; source_mime_type: UniversityTemplateMime; manifest_sha256: string;
  renderer_version: "evo-university-form-docx-v1" | "evo-university-form-pdf-v1"; font_sha256: string | null;
}>;
export type FormInput = FormMetadata & Readonly<{ mode: "draft" | "final"; frozen_profile: FrozenProfile164 }>;

export function formInputRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || !keys.every(key => Object.hasOwn(value, key))) throw new Error("invalid_form_input");
  return value as Record<string, unknown>;
}
export function formInputUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)) throw new Error("invalid_form_input");
  return value;
}
export function formInputHash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error("invalid_form_input");
  return value;
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error("invalid_form_input");
  return value;
}
function requireInput(condition: unknown): asserts condition { if (!condition) throw new Error("invalid_form_input"); }
function timestamp(value: unknown): string | null {
  if (value === null) return null;
  requireInput(typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)));
  return value;
}
function frozenProfile(value: unknown, caseId: string): FrozenProfile164 {
  const row = formInputRecord(value, ["student_case_id", "profile", "can_initialize", "can_review", "can_export", "fields"]);
  requireInput(formInputUuid(row.student_case_id) === caseId && row.can_initialize === false && row.can_review === false && row.can_export === true);
  const p = formInputRecord(row.profile, ["id", "revision"]), profile = Object.freeze({ id: formInputUuid(p.id), revision: integer(p.revision) });
  requireInput(Array.isArray(row.fields) && row.fields.length === PROFILE_FIELD_KEYS.length);
  const fields = row.fields.map((raw, index) => {
    const f = formInputRecord(raw, ["field_key", "value", "review_state", "reviewed_at", "source_document_version_id", "source_page", "proposals"]);
    const key = PROFILE_FIELD_KEYS[index];
    requireInput(f.field_key === key && (f.review_state === "confirmed" || f.review_state === "conflict" || f.review_state === "needs_review" || f.review_state === "extracted"));
    requireInput(Array.isArray(f.proposals) && f.proposals.length === 0);
    const maximum = key === "nationality" || key === "country_of_residence" ? 120 : key === "date_of_birth" ? 10 : 500;
    requireInput(f.value === null || (typeof f.value === "string" && f.value.trim().length > 0 && [...f.value].length <= maximum));
    const reviewed_at = timestamp(f.reviewed_at), source_document_version_id = f.source_document_version_id === null ? null : formInputUuid(f.source_document_version_id);
    const source_page = f.source_page === null ? null : integer(f.source_page, 10000);
    requireInput((source_page === null || source_document_version_id !== null) && (f.review_state !== "confirmed" || reviewed_at !== null));
    requireInput(f.review_state === "confirmed" || (f.value === null && source_document_version_id === null && source_page === null));
    return Object.freeze({ field_key: key, value: f.value, review_state: f.review_state, reviewed_at, source_document_version_id, source_page, proposals: Object.freeze([]) as readonly [] });
  });
  return Object.freeze({ student_case_id: caseId, profile, can_initialize: false, can_review: false, can_export: true, fields: Object.freeze(fields) });
}

export function normalizeUniversityFormBinding(value: unknown): FormBinding {
  const f = formInputRecord(value, ["application_id", "catalog_institution_id", "catalog_source_revision", "template_id", "template_version_id",
    "inspection_receipt_id", "mapping_id", "mapping_sha256", "review_id", "validation_day"]);
  requireInput(typeof f.catalog_source_revision === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$/u.test(f.catalog_source_revision));
  requireInput(typeof f.validation_day === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(f.validation_day) && normalizeDate(f.validation_day) === f.validation_day);
  return Object.freeze({ application_id: formInputUuid(f.application_id), catalog_institution_id: formInputUuid(f.catalog_institution_id),
    catalog_source_revision: f.catalog_source_revision, template_id: formInputUuid(f.template_id), template_version_id: formInputUuid(f.template_version_id),
    inspection_receipt_id: formInputUuid(f.inspection_receipt_id), mapping_id: formInputUuid(f.mapping_id), mapping_sha256: formInputHash(f.mapping_sha256),
    review_id: formInputUuid(f.review_id), validation_day: f.validation_day });
}

/** Closed immutable projection; logical bw1/mapping hashes are not claimed recomputed here. */
export function normalizeUniversityFormInput(value: unknown): FormInput {
  const row = formInputRecord(value, ["schema_version", "kind", "organization_id", "student_case_id", "form", "template", "mapping", "review",
    "source_byte_size", "source_mime_type", "manifest_sha256", "renderer_version", "font_sha256", "mode", "frozen_profile"]);
  requireInput(row.schema_version === 1 && row.kind === "university_form" && (row.mode === "draft" || row.mode === "final"));
  const organization_id = formInputUuid(row.organization_id), student_case_id = formInputUuid(row.student_case_id);
  const form = normalizeUniversityFormBinding(row.form);
  requireInput(row.source_mime_type === UNIVERSITY_FORM_DOCX_MIME || row.source_mime_type === "application/pdf");
  const mime = row.source_mime_type, pdf = mime === "application/pdf";
  requireInput(row.renderer_version === (pdf ? "evo-university-form-pdf-v1" : "evo-university-form-docx-v1")
    && row.font_sha256 === (pdf ? UNIVERSITY_FORM_FONT_SHA256 : null));
  const t = formInputRecord(row.template, ["versionId", "sha256", "manifest"]), sha256 = formInputHash(t.sha256);
  requireInput(formInputUuid(t.versionId) === form.template_version_id);
  const m = formInputRecord(t.manifest, ["format", "slots", "pageSizes"]);
  requireInput(m.format === (pdf ? "pdf" : "docx") && Array.isArray(m.slots) && Array.isArray(m.pageSizes));
  let manifest: BoundTemplate["manifest"];
  if (pdf) {
    requireInput(m.slots.length === 0 && m.pageSizes.length > 0 && m.pageSizes.length <= 100);
    const pageSizes = m.pageSizes.map(raw => {
      const p = formInputRecord(raw, ["width", "height"]);
      requireInput(typeof p.width === "number" && typeof p.height === "number" && Number.isFinite(p.width) && Number.isFinite(p.height)
        && p.width >= 72 && p.width <= 3000 && p.height >= 72 && p.height <= 3000);
      return Object.freeze({ width: p.width, height: p.height });
    });
    manifest = Object.freeze({ format: "pdf", slots: Object.freeze([]) as readonly [], pageSizes: Object.freeze(pageSizes) });
  } else {
    requireInput(m.pageSizes.length === 0 && m.slots.length > 0 && m.slots.length <= 3000);
    const slots = m.slots.map((raw, index) => {
      const s = formInputRecord(raw, ["id", "editable"]);
      requireInput(s.id === `p-${index + 1}` && typeof s.editable === "boolean");
      return Object.freeze({ id: s.id as string, editable: s.editable });
    });
    manifest = Object.freeze({ format: "docx", slots: Object.freeze(slots), pageSizes: Object.freeze([]) as readonly [] });
  }
  const template = Object.freeze({ versionId: form.template_version_id, sha256, manifest });
  const mappingRow = formInputRecord(row.mapping, ["versionId", "templateVersionId", "templateSha256", "mappings", "sha256"]);
  requireInput(mappingRow.versionId === form.mapping_id && mappingRow.templateVersionId === template.versionId
    && mappingRow.templateSha256 === sha256 && mappingRow.sha256 === form.mapping_sha256);
  const mapping: UniversityFormMappingSnapshot = Object.freeze({ versionId: form.mapping_id, templateVersionId: template.versionId,
    templateSha256: sha256, sha256: form.mapping_sha256, mappings: normalizeUniversityFormRegistryMappings(mappingRow.mappings, mime) });
  const r = formInputRecord(row.review, ["versionId", "templateVersionId", "templateSha256", "mappingVersionId", "mappingSha256", "state"]);
  requireInput(r.versionId === form.review_id && r.templateVersionId === template.versionId && r.templateSha256 === sha256
    && r.mappingVersionId === mapping.versionId && r.mappingSha256 === mapping.sha256 && r.state === "approved");
  const review: UniversityFormMappingReviewSnapshot = Object.freeze({ versionId: form.review_id, templateVersionId: template.versionId,
    templateSha256: sha256, mappingVersionId: mapping.versionId, mappingSha256: mapping.sha256, state: "approved" });
  return Object.freeze({ schema_version: 1, kind: "university_form", organization_id, student_case_id, form, template, mapping, review,
    source_byte_size: integer(row.source_byte_size, 20 * 1024 * 1024), source_mime_type: mime, manifest_sha256: formInputHash(row.manifest_sha256),
    renderer_version: pdf ? "evo-university-form-pdf-v1" : "evo-university-form-docx-v1", font_sha256: pdf ? UNIVERSITY_FORM_FONT_SHA256 : null,
    mode: row.mode, frozen_profile: frozenProfile(row.frozen_profile, student_case_id) });
}
