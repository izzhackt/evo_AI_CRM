import {
  normalizePublishedUniversityForms, UNIVERSITY_TEMPLATE_MAX_BYTES, UNIVERSITY_TEMPLATE_MIME,
  type UniversityFormPublication, type UniversityFormVersionMetadata, type UniversityTemplateMime,
} from "./university-form-registry.ts";
import type { UniversityTemplateManifest } from "./server/university-template-preflight.ts";

export type { UniversityTemplateManifest };
export const UNIVERSITY_TEMPLATE_INGRESS_STATES = ["prepared", "processing", "sealed", "verified", "failed", "unknown", "cancelled"] as const;
export const UNIVERSITY_TEMPLATE_INGRESS_FAILURES = ["source_mismatch", "malware_detected", "scanner_unavailable", "template_not_eligible",
  "template_runtime_unavailable", "storage_unavailable", "storage_missing", "access_changed", "source_changed", "archived",
  "stale_revision", "expired", "cancelled", "integrity_failed"] as const;
export type UniversityTemplateIngressState = typeof UNIVERSITY_TEMPLATE_INGRESS_STATES[number];
export type UniversityTemplateIngressFailure = typeof UNIVERSITY_TEMPLATE_INGRESS_FAILURES[number];
export type UniversityTemplateIngressReceipt = Readonly<{
  schema_version: 1; ingress_id: string; template_id: string; template_version_id: string; request_id: string;
  revision: number; state: UniversityTemplateIngressState; sha256: string; byte_size: number;
  inspection_receipt_id: string | null; failure_code: UniversityTemplateIngressFailure | null;
  replayed: boolean; can_reconcile: boolean; can_cancel: boolean;
}>;
export type UniversityFormManagerTemplates = Readonly<{
  schema_version: 1; catalog_institution_id: string;
  items: readonly Readonly<{ id: string; title: string; revision: number; archived: boolean; catalog_source_revision: string;
    source_current: boolean; latest_version: UniversityFormVersionMetadata | null; publication: UniversityFormPublication | null }>[];
  next_after_id: string | null;
}>;
export type UniversityTemplateInspectionMetadata = Readonly<{
  schema_version: 1; template_id: string; template_version_id: string; template_sha256: string; mime_type: UniversityTemplateMime;
  template_revision: number; source_current: boolean; inspection: "pending" | "verified"; manifest: UniversityTemplateManifest | null;
  receipt_id: string | null; inspected_at: string | null; ingress: UniversityTemplateIngressReceipt | null;
}>;
export interface UniversityTemplateIngressReadRpcContract {
  staff_university_form_manager_templates: { args: { p_catalog_institution_id: string; p_after_id?: string | null }; result: UniversityFormManagerTemplates };
  staff_university_template_inspection: { args: { p_template_id: string; p_template_version_id: string }; result: UniversityTemplateInspectionMetadata };
}

export class UniversityTemplateIngressContractError extends Error {
  constructor() { super("university_template_invalid_response"); this.name = "UniversityTemplateIngressContractError"; }
}
export function templateIngressInvalid(): never { throw new UniversityTemplateIngressContractError(); }
export function templateIngressRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) return templateIngressInvalid();
  return value as Record<string, unknown>;
}
export function templateIngressUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value)) return templateIngressInvalid();
  return value;
}
export function templateIngressHash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) return templateIngressInvalid();
  return value;
}
export function templateIngressInteger(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return templateIngressInvalid();
  return value;
}
export function templateIngressMime(value: unknown): UniversityTemplateMime {
  if (typeof value !== "string" || !UNIVERSITY_TEMPLATE_MIME.includes(value as UniversityTemplateMime)) return templateIngressInvalid();
  return value as UniversityTemplateMime;
}
function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : templateIngressInvalid(); }
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    || !Number.isFinite(Date.parse(value))) return templateIngressInvalid();
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || [...value].length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return templateIngressInvalid();
  return value;
}
function version(value: unknown, maximumRevision: number): UniversityFormVersionMetadata {
  const v = templateIngressRecord(value, ["id", "number", "revision", "sha256", "byte_size", "mime_type", "created_at", "inspection"]);
  if (v.inspection !== "pending" && v.inspection !== "verified") return templateIngressInvalid();
  return Object.freeze({ id: templateIngressUuid(v.id), number: templateIngressInteger(v.number),
    revision: templateIngressInteger(v.revision, 2, maximumRevision), sha256: templateIngressHash(v.sha256),
    byte_size: templateIngressInteger(v.byte_size, 1, UNIVERSITY_TEMPLATE_MAX_BYTES), mime_type: templateIngressMime(v.mime_type),
    created_at: timestamp(v.created_at), inspection: v.inspection });
}

export function normalizeUniversityFormManagerTemplates(value: unknown, catalogId: string): UniversityFormManagerTemplates {
  const o = templateIngressRecord(value, ["schema_version", "catalog_institution_id", "items", "next_after_id"]);
  if (o.schema_version !== 1 || templateIngressUuid(o.catalog_institution_id) !== templateIngressUuid(catalogId)
    || !Array.isArray(o.items) || o.items.length > 20) return templateIngressInvalid();
  let previous = "";
  const items = o.items.map(raw => {
    const i = templateIngressRecord(raw, ["id", "title", "revision", "archived", "catalog_source_revision", "source_current", "latest_version", "publication"]);
    const id = templateIngressUuid(i.id), title = text(i.title, 200), revision = templateIngressInteger(i.revision);
    if (id <= previous) return templateIngressInvalid(); previous = id;
    const archived = boolean(i.archived), sourceCurrent = boolean(i.source_current);
    if (archived && sourceCurrent) return templateIngressInvalid();
    const publication = i.publication === null ? null : normalizePublishedUniversityForms({ schema_version: 1,
      catalog_institution_id: catalogId, items: [{ id, title, revision, publication: i.publication }], next_after_id: null }).items[0].publication;
    if (publication !== null && !sourceCurrent) return templateIngressInvalid();
    return Object.freeze({ id, title, revision, archived, catalog_source_revision: text(i.catalog_source_revision, 500),
      source_current: sourceCurrent, latest_version: i.latest_version === null ? null : version(i.latest_version, revision), publication });
  });
  const next = o.next_after_id === null ? null : templateIngressUuid(o.next_after_id);
  if (next !== null && (items.length !== 20 || items.at(-1)?.id !== next)) return templateIngressInvalid();
  return Object.freeze({ schema_version: 1, catalog_institution_id: catalogId, items: Object.freeze(items), next_after_id: next });
}

export function normalizeUniversityTemplateIngressReceipt(value: unknown, templateId: string, versionId: string): UniversityTemplateIngressReceipt {
  const o = templateIngressRecord(value, ["schema_version", "ingress_id", "template_id", "template_version_id", "request_id", "revision",
    "state", "sha256", "byte_size", "inspection_receipt_id", "failure_code", "replayed", "can_reconcile", "can_cancel"]);
  if (o.schema_version !== 1 || templateIngressUuid(o.template_id) !== templateIngressUuid(templateId)
    || templateIngressUuid(o.template_version_id) !== templateIngressUuid(versionId)
    || !UNIVERSITY_TEMPLATE_INGRESS_STATES.includes(o.state as UniversityTemplateIngressState)
    || (o.failure_code !== null && !UNIVERSITY_TEMPLATE_INGRESS_FAILURES.includes(o.failure_code as UniversityTemplateIngressFailure))) return templateIngressInvalid();
  const state = o.state as UniversityTemplateIngressState;
  const receipt = o.inspection_receipt_id === null ? null : templateIngressUuid(o.inspection_receipt_id);
  const canReconcile = boolean(o.can_reconcile), canCancel = boolean(o.can_cancel);
  if ((state === "verified") !== (receipt !== null) || (state === "verified" && o.failure_code !== null)
    || (state === "failed" && o.failure_code === null) || (state === "cancelled" && o.failure_code !== "cancelled")
    || (["prepared", "processing", "sealed"].includes(state) && o.failure_code !== null)
    || (canReconcile && !["sealed", "unknown"].includes(state))
    || (canCancel && ["verified", "failed", "cancelled"].includes(state))) return templateIngressInvalid();
  return Object.freeze({ schema_version: 1, ingress_id: templateIngressUuid(o.ingress_id), template_id: templateId,
    template_version_id: versionId, request_id: templateIngressUuid(o.request_id), revision: templateIngressInteger(o.revision),
    state, sha256: templateIngressHash(o.sha256), byte_size: templateIngressInteger(o.byte_size, 1, UNIVERSITY_TEMPLATE_MAX_BYTES),
    inspection_receipt_id: receipt, failure_code: o.failure_code as UniversityTemplateIngressFailure | null,
    replayed: boolean(o.replayed), can_reconcile: canReconcile, can_cancel: canCancel });
}

export function normalizeUniversityTemplateManifest(value: unknown, mime: UniversityTemplateMime): UniversityTemplateManifest {
  const o = templateIngressRecord(value, ["format", "slots", "pageSizes"]), pdf = mime === "application/pdf";
  if (o.format !== (pdf ? "pdf" : "docx") || !Array.isArray(o.slots) || !Array.isArray(o.pageSizes)
    || o.slots.length > 3000 || o.pageSizes.length > 100
    || (pdf ? o.slots.length !== 0 || o.pageSizes.length === 0 : o.slots.length === 0 || o.pageSizes.length !== 0)) return templateIngressInvalid();
  const slots = o.slots.map((raw, index) => {
    const slot = templateIngressRecord(raw, ["id", "editable"]);
    if (slot.id !== `p-${index + 1}`) return templateIngressInvalid();
    return Object.freeze({ id: slot.id as string, editable: boolean(slot.editable) });
  });
  const pageSizes = o.pageSizes.map(raw => {
    const p = templateIngressRecord(raw, ["width", "height"]);
    if (typeof p.width !== "number" || typeof p.height !== "number" || !Number.isFinite(p.width) || !Number.isFinite(p.height)
      || p.width < 72 || p.width > 3000 || p.height < 72 || p.height > 3000) return templateIngressInvalid();
    return Object.freeze({ width: p.width, height: p.height });
  });
  return Object.freeze({ format: pdf ? "pdf" : "docx", slots: Object.freeze(slots), pageSizes: Object.freeze(pageSizes) });
}

export function normalizeUniversityTemplateInspectionMetadata(value: unknown, templateId: string, versionId: string): UniversityTemplateInspectionMetadata {
  const o = templateIngressRecord(value, ["schema_version", "template_id", "template_version_id", "template_sha256", "mime_type",
    "template_revision", "source_current", "inspection", "manifest", "receipt_id", "inspected_at", "ingress"]);
  if (o.schema_version !== 1 || templateIngressUuid(o.template_id) !== templateIngressUuid(templateId)
    || templateIngressUuid(o.template_version_id) !== templateIngressUuid(versionId)
    || (o.inspection !== "pending" && o.inspection !== "verified")) return templateIngressInvalid();
  const mime = templateIngressMime(o.mime_type), sha = templateIngressHash(o.template_sha256), revision = templateIngressInteger(o.template_revision);
  const verified = o.inspection === "verified";
  if (verified ? o.manifest === null || o.receipt_id === null || o.inspected_at === null
    : o.manifest !== null || o.receipt_id !== null || o.inspected_at !== null) return templateIngressInvalid();
  const receipt = o.receipt_id === null ? null : templateIngressUuid(o.receipt_id);
  const ingress = o.ingress === null ? null : normalizeUniversityTemplateIngressReceipt(o.ingress, templateId, versionId);
  if (ingress && (ingress.sha256 !== sha || ingress.revision > revision || (ingress.state === "verified") !== verified
    || ingress.inspection_receipt_id !== receipt)) return templateIngressInvalid();
  return Object.freeze({ schema_version: 1, template_id: templateId, template_version_id: versionId, template_sha256: sha,
    mime_type: mime, template_revision: revision, source_current: boolean(o.source_current), inspection: o.inspection,
    manifest: verified ? normalizeUniversityTemplateManifest(o.manifest, mime) : null, receipt_id: receipt,
    inspected_at: o.inspected_at === null ? null : timestamp(o.inspected_at), ingress });
}
