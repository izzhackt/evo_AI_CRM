import {
  computeUniversityFormMappingHash, UNIVERSITY_FORM_SOURCES,
  type UniversityFormMapping, type UniversityFormMappingContent,
} from "./university-form-fields.ts";

/** Registry metadata, not a byte scan, rendering or export authorization. */
export const UNIVERSITY_TEMPLATE_MAX_BYTES = 20 * 1024 * 1024;
export const UNIVERSITY_TEMPLATE_MIME = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
export type UniversityTemplateMime = typeof UNIVERSITY_TEMPLATE_MIME[number];
export type UniversityFormRegistryCommand = "create" | "reserve_version" | "save_mapping" | "review_mapping" | "publish" | "archive";
export interface UniversityFormCommandReceipt {
  readonly schema_version: 1; readonly template_id: string; readonly target_id: string;
  readonly revision: number; readonly outcome: UniversityFormRegistryCommand; readonly replayed: boolean;
}
export interface UniversityFormVersionMetadata {
  readonly id: string; readonly number: number; readonly revision: number; readonly sha256: string;
  readonly byte_size: number; readonly mime_type: UniversityTemplateMime; readonly created_at: string;
  readonly inspection: "pending" | "verified";
}
export interface UniversityFormPublication {
  readonly template_version_id: string; readonly template_sha256: string; readonly mapping_id: string;
  readonly mapping_sha256: string; readonly review_id: string; readonly reviewer_membership_id: string;
  readonly reviewed_at: string;
}
export interface UniversityFormMappingMetadata {
  readonly id: string; readonly template_version_id: string; readonly template_sha256: string;
  readonly sha256: string; readonly revision: number; readonly mappings: readonly UniversityFormMapping[]; readonly created_at: string;
  readonly review: Readonly<{ id: string; decision: "approved" | "rejected"; reviewer_membership_id: string; reviewed_at: string; revision: number }> | null;
}
export interface UniversityFormWorkspace {
  readonly schema_version: 1;
  readonly template: Readonly<{ id: string; organization_id: string; catalog_institution_id: string; catalog_source_revision: string;
    title: string; revision: number; archived: boolean }>;
  readonly can_manage: boolean; readonly publication: UniversityFormPublication | null;
  readonly selected_version: UniversityFormVersionMetadata | null;
  readonly versions: readonly UniversityFormVersionMetadata[];
  readonly mappings: readonly UniversityFormMappingMetadata[];
  readonly next_version_before: number | null; readonly next_mapping_before: number | null;
}
export interface PublishedUniversityForms {
  readonly schema_version: 1; readonly catalog_institution_id: string;
  readonly items: readonly Readonly<{ id: string; title: string; revision: number; publication: UniversityFormPublication }>[];
  readonly next_after_id: string | null;
}
type CommandArgs = Readonly<{ p_organization_id: string; p_template_id: string; p_expected_revision: number; p_reason: string; p_request_id: string }>;
export interface UniversityFormRegistryRpcContract {
  create_university_form_template: { args: CommandArgs & { p_catalog_institution_id: string; p_title: string }; result: UniversityFormCommandReceipt };
  reserve_university_form_version: { args: CommandArgs & { p_sha256: string; p_byte_size: number; p_mime_type: UniversityTemplateMime;
    p_source_reference: string; p_source_date: string }; result: UniversityFormCommandReceipt };
  save_university_form_mapping: { args: CommandArgs & { p_mapping_id: string; p_template_version_id: string; p_template_sha256: string;
    p_mappings: readonly UniversityFormMapping[] }; result: UniversityFormCommandReceipt };
  review_university_form_mapping: { args: CommandArgs & { p_mapping_id: string; p_mapping_sha256: string; p_decision: "approved" | "rejected" }; result: UniversityFormCommandReceipt };
  publish_university_form_template: { args: CommandArgs & { p_mapping_id: string; p_mapping_sha256: string; p_review_id: string }; result: UniversityFormCommandReceipt };
  archive_university_form_template: { args: CommandArgs; result: UniversityFormCommandReceipt };
  staff_university_form_workspace: { args: { p_template_id: string; p_version_id?: string | null; p_before_version?: number | null; p_before_mapping?: number | null }; result: UniversityFormWorkspace };
  staff_published_university_forms: { args: { p_catalog_institution_id: string; p_after_id?: string | null }; result: PublishedUniversityForms };
}
export class UniversityFormRegistryError extends Error {
  readonly code = "university_form_invalid_response";
  constructor() { super("university_form_invalid_response"); this.name = "UniversityFormRegistryError"; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const SOURCES = new Set<string>(UNIVERSITY_FORM_SOURCES.map(source => source.key));
const FORMATS = ["text", "DD.MM.YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "DD", "MM", "YYYY"];
function fail(): never { throw new UniversityFormRegistryError(); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) fail();
  return record;
}
function text(value: unknown, max: number): string {
  // PostgreSQL char_length counts Unicode code points, not UTF-16 code units.
  if (typeof value !== "string" || !value.trim() || [...value].length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail();
  return value;
}
function uuid(value: unknown): string { const result = text(value, 36); if (!UUID.test(result)) fail(); return result; }
function hash(value: unknown): string { const result = text(value, 64); if (!SHA.test(result)) fail(); return result; }
function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(); return value;
}
function boolean(value: unknown): boolean { if (typeof value !== "boolean") fail(); return value; }
function timestamp(value: unknown): string {
  const result = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(result) || !Number.isFinite(Date.parse(result))) fail();
  return result;
}
function list(value: unknown, max = 20): unknown[] { if (!Array.isArray(value) || value.length > max) fail(); return value; }
function cursor(value: unknown): number | null { return value === null ? null : integer(value); }
function mime(value: unknown): UniversityTemplateMime {
  if (!UNIVERSITY_TEMPLATE_MIME.includes(value as UniversityTemplateMime)) fail(); return value as UniversityTemplateMime;
}
function decimal(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max
    || Number(value.toFixed(3)) !== value) fail();
  return value;
}
/** Exact D4 registry bounds, compatible with the existing mapping resolver hash. */
export function normalizeUniversityFormRegistryMappings(value: unknown, type: UniversityTemplateMime): readonly UniversityFormMapping[] {
  const pdf = mime(type) === "application/pdf";
  const values = list(value, pdf ? 500 : 3000);
  if (!values.length || new TextEncoder().encode(JSON.stringify(value)).byteLength > 1048576) fail();
  const seen = new Set<string>();
  return Object.freeze(values.map(raw => {
    const item = object(raw, ["slotId", "sourceKey", "required", "format", "manual", ...(pdf ? ["position"] : [])]);
    const slotId = text(item.slotId, 9), required = boolean(item.required), manual = boolean(item.manual);
    if (!(pdf ? /^pdf-[1-9]\d{0,3}$/u : /^p-[1-9]\d{0,3}$/u).test(slotId) || seen.has(slotId)) fail();
    seen.add(slotId);
    const format = text(item.format, 10);
    if (!FORMATS.includes(format)) fail();
    const sourceKey = item.sourceKey === null ? null : text(item.sourceKey, 80);
    if (manual ? sourceKey !== null || format !== "text" : sourceKey === null || !SOURCES.has(sourceKey)) fail();
    if (format !== "text" && !["date_of_birth", "passport_expiry_date", "desired_start_date"].includes(sourceKey ?? "")) fail();
    let position;
    if (pdf) {
      const rawPosition = item.position;
      if (!rawPosition || typeof rawPosition !== "object") fail();
      const hasCount = Object.hasOwn(rawPosition, "characterCount");
      const p = object(rawPosition, ["page", "x", "y", "width", "height", ...(hasCount ? ["characterCount"] : [])]);
      position = { page: integer(p.page, 1, 100), x: decimal(p.x, 0, 3000), y: decimal(p.y, 0, 3000),
        width: decimal(p.width, 12, 3000), height: decimal(p.height, 12, 3000),
        ...(hasCount ? { characterCount: integer(p.characterCount, 1, 120) } : {}) };
      if (hasCount && position.width / position.characterCount! < 5) fail();
    }
    return Object.freeze({ slotId, sourceKey, required, manual, format, ...(position ? { position: Object.freeze(position) } : {}) }) as UniversityFormMapping;
  }).sort((a, b) => a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
}
export function normalizeUniversityFormCommandReceipt(value: unknown): UniversityFormCommandReceipt {
  const o = object(value, ["schema_version", "template_id", "target_id", "revision", "outcome", "replayed"]);
  if (o.schema_version !== 1 || !["create", "reserve_version", "save_mapping", "review_mapping", "publish", "archive"].includes(String(o.outcome))) fail();
  return Object.freeze({ schema_version: 1, template_id: uuid(o.template_id), target_id: uuid(o.target_id), revision: integer(o.revision),
    outcome: o.outcome as UniversityFormRegistryCommand, replayed: boolean(o.replayed) });
}
function publication(value: unknown): UniversityFormPublication {
  const o = object(value, ["template_version_id", "template_sha256", "mapping_id", "mapping_sha256", "review_id", "reviewer_membership_id", "reviewed_at"]);
  return Object.freeze({ template_version_id: uuid(o.template_version_id), template_sha256: hash(o.template_sha256), mapping_id: uuid(o.mapping_id),
    mapping_sha256: hash(o.mapping_sha256), review_id: uuid(o.review_id), reviewer_membership_id: uuid(o.reviewer_membership_id), reviewed_at: timestamp(o.reviewed_at) });
}
function version(value: unknown): UniversityFormVersionMetadata {
  const o = object(value, ["id", "number", "revision", "sha256", "byte_size", "mime_type", "created_at", "inspection"]);
  if (o.inspection !== "pending" && o.inspection !== "verified") fail();
  return Object.freeze({ id: uuid(o.id), number: integer(o.number, 1, 2147483647), revision: integer(o.revision, 2), sha256: hash(o.sha256),
    byte_size: integer(o.byte_size, 1, UNIVERSITY_TEMPLATE_MAX_BYTES), mime_type: mime(o.mime_type), created_at: timestamp(o.created_at), inspection: o.inspection });
}
/** Captures once before hashing; no mutable input may replace the reviewed content. */
export async function normalizeUniversityFormWorkspace(value: unknown): Promise<UniversityFormWorkspace> {
  const o = object(structuredClone(value), ["schema_version", "template", "can_manage", "publication", "selected_version", "versions", "mappings", "next_version_before", "next_mapping_before"]);
  if (o.schema_version !== 1) fail();
  const t = object(o.template, ["id", "organization_id", "catalog_institution_id", "catalog_source_revision", "title", "revision", "archived"]);
  const sourceRevision = text(t.catalog_source_revision, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$/u.test(sourceRevision)) fail();
  const template = Object.freeze({ id: uuid(t.id), organization_id: uuid(t.organization_id), catalog_institution_id: uuid(t.catalog_institution_id),
    catalog_source_revision: sourceRevision, title: text(t.title, 200), revision: integer(t.revision), archived: boolean(t.archived) });
  const can_manage = boolean(o.can_manage), published = o.publication === null ? null : publication(o.publication);
  if (template.archived && (can_manage || published)) fail();
  const selected = o.selected_version === null ? null : version(o.selected_version);
  const versions = list(o.versions).map(version);
  const seen = new Set<string>();
  let previous = Number.MAX_SAFE_INTEGER;
  for (const row of versions) {
    if (seen.has(row.id) || row.revision >= previous || row.revision > template.revision) fail();
    seen.add(row.id); previous = row.revision;
  }
  const mappings: UniversityFormMappingMetadata[] = [];
  seen.clear(); previous = Number.MAX_SAFE_INTEGER;
  for (const raw of list(o.mappings)) {
    if (!selected) fail();
    const m = object(raw, ["id", "template_version_id", "template_sha256", "sha256", "revision", "mappings", "created_at", "review"]);
    const id = uuid(m.id), revision = integer(m.revision, 2), templateId = uuid(m.template_version_id), templateHash = hash(m.template_sha256), sha256 = hash(m.sha256);
    if (templateId !== selected.id || templateHash !== selected.sha256 || revision > template.revision || revision >= previous || seen.has(id)) fail();
    seen.add(id); previous = revision;
    const content: UniversityFormMappingContent = { versionId: id, templateVersionId: templateId, templateSha256: templateHash,
      mappings: normalizeUniversityFormRegistryMappings(m.mappings, selected.mime_type) };
    if (await computeUniversityFormMappingHash(content) !== sha256) fail();
    let review = null;
    if (m.review !== null) {
      const r = object(m.review, ["id", "decision", "reviewer_membership_id", "reviewed_at", "revision"]);
      if (r.decision !== "approved" && r.decision !== "rejected") fail();
      review = Object.freeze({ id: uuid(r.id), decision: r.decision, reviewer_membership_id: uuid(r.reviewer_membership_id),
        reviewed_at: timestamp(r.reviewed_at), revision: integer(r.revision, revision + 1, template.revision) });
    }
    mappings.push(Object.freeze({ id, template_version_id: templateId, template_sha256: templateHash, sha256, revision,
      mappings: content.mappings, created_at: timestamp(m.created_at), review }));
  }
  const nextVersion = cursor(o.next_version_before), nextMapping = cursor(o.next_mapping_before);
  if (nextVersion !== null && (versions.length !== 20 || nextVersion !== versions.at(-1)?.revision)) fail();
  if (nextMapping !== null && (mappings.length !== 20 || nextMapping !== mappings.at(-1)?.revision)) fail();
  if (selected && selected.revision > template.revision) fail();
  if (published && selected?.id === published.template_version_id && (selected.sha256 !== published.template_sha256 || selected.inspection !== "verified")) fail();
  const publishedMapping = published ? mappings.find(m => m.id === published.mapping_id) : undefined;
  if (publishedMapping && (publishedMapping.sha256 !== published!.mapping_sha256 || publishedMapping.review?.id !== published!.review_id
    || publishedMapping.review.decision !== "approved" || publishedMapping.review.reviewer_membership_id !== published!.reviewer_membership_id)) fail();
  return Object.freeze({ schema_version: 1, template, can_manage, publication: published, selected_version: selected,
    versions: Object.freeze(versions), mappings: Object.freeze(mappings), next_version_before: nextVersion, next_mapping_before: nextMapping });
}
export function normalizePublishedUniversityForms(value: unknown): PublishedUniversityForms {
  const o = object(value, ["schema_version", "catalog_institution_id", "items", "next_after_id"]);
  if (o.schema_version !== 1) fail();
  let previous = "";
  const items = list(o.items).map(raw => {
    const i = object(raw, ["id", "title", "revision", "publication"]), id = uuid(i.id);
    if (id <= previous) fail(); previous = id;
    return Object.freeze({ id, title: text(i.title, 200), revision: integer(i.revision), publication: publication(i.publication) });
  });
  const next = o.next_after_id === null ? null : uuid(o.next_after_id);
  if (next !== null && (items.length !== 20 || items.at(-1)?.id !== next)) fail();
  return Object.freeze({ schema_version: 1, catalog_institution_id: uuid(o.catalog_institution_id), items: Object.freeze(items), next_after_id: next });
}
