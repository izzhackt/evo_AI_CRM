import {
  DOCUMENT_EXPORT_MAX_BYTES, DOCUMENT_EXPORT_MIME, DOCUMENT_EXPORT_RENDERER_VERSION,
  DOCUMENT_EXPORT_TEMPLATE_SHA256,
  DOCUMENT_PACKAGE_MAX_BYTES, DOCUMENT_PACKAGE_MIME, type DocumentPackageExportReceipt,
  UNIVERSITY_FORM_EXPORT_MAX_BYTES, type DocumentExportFailure, type DocumentExportReceipt, type DocumentExportWorkspace,
  type StoredDocumentExportReceipt, type UniversityFormExportReceipt, type UniversityFormRendererProof, type DocumentExportWorkspaceV2,
  type UniversityFormExportWorkspace, type ApplicationPublishedFormsWorkspace,
} from "./document-export-artifact-contract.ts";
import { normalizeUniversityFormBinding, UNIVERSITY_FORM_FONT_SHA256 } from "./university-form-export-contract.ts";
import { normalizePublishedUniversityForms } from "./university-form-registry.ts";

export const EXPORT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const EXPORT_HASH = /^[0-9a-f]{64}$/;
const FAILURES: readonly DocumentExportFailure[] = ["profile_not_ready", "source_changed", "access_changed", "source_unavailable",
  "template_unavailable", "integrity_failed", "export_failed", "storage_unavailable"];

export function exportRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) throw new Error("export_unavailable");
  return value as Record<string, unknown>;
}
export function exportUuid(value: unknown): string {
  if (typeof value !== "string" || !EXPORT_UUID.test(value)) throw new Error("export_unavailable");
  return value.toLowerCase();
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !EXPORT_HASH.test(value)) throw new Error("export_unavailable");
  return value;
}
function positive(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) throw new Error("export_unavailable");
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("export_unavailable");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("export_unavailable");
  return value;
}
export function isDocumentExportFailure(value: unknown): value is DocumentExportFailure {
  return typeof value === "string" && FAILURES.includes(value as DocumentExportFailure);
}

/** Fail closed on unknown fields: no service token, object key or frozen values reach the browser. */
const RECEIPT_KEYS = ["id", "student_case_id", "student_profile_id", "profile_revision", "workspace_revision",
    "input_snapshot_sha256", "field_reviews_sha256", "kind", "mode", "state", "template_sha256", "renderer_version",
    "created_at", "ready_at", "output_sha256", "output_bytes", "mime_type", "receipt_id", "failure_code", "historical", "can_download"];
type ReceiptFields = Omit<DocumentExportReceipt, "kind" | "renderer_version" | "mime_type" | "failure_code"> & {
  failure_code: DocumentExportFailure | "form_not_ready" | null;
};
function receiptFields(row: Record<string, unknown>, caseId: string, maximum: number, artifactId?: string): ReceiptFields {
  const id = exportUuid(row.id);
  if (exportUuid(row.student_case_id) !== caseId || (artifactId !== undefined && id !== artifactId)
    || (row.mode !== "draft" && row.mode !== "final")
    || !["pending", "stored_unverified", "ready", "unknown", "failed"].includes(String(row.state))
    || (row.failure_code !== null && !isDocumentExportFailure(row.failure_code)
      && !(row.kind === "university_form" && row.failure_code === "form_not_ready"))) throw new Error("export_unavailable");
  const receipt: ReceiptFields = {
    id, student_case_id: caseId, student_profile_id: exportUuid(row.student_profile_id), profile_revision: positive(row.profile_revision),
    workspace_revision: hash(row.workspace_revision), input_snapshot_sha256: hash(row.input_snapshot_sha256),
    field_reviews_sha256: hash(row.field_reviews_sha256), mode: row.mode,
    state: row.state as DocumentExportReceipt["state"], template_sha256: hash(row.template_sha256), created_at: timestamp(row.created_at),
    ready_at: row.ready_at === null ? null : timestamp(row.ready_at), output_sha256: row.output_sha256 === null ? null : hash(row.output_sha256),
    output_bytes: row.output_bytes === null ? null : positive(row.output_bytes, maximum),
    receipt_id: row.receipt_id === null ? null : exportUuid(row.receipt_id),
    failure_code: row.failure_code as ReceiptFields["failure_code"], historical: bool(row.historical), can_download: bool(row.can_download),
  };
  if ((receipt.output_sha256 === null) !== (receipt.output_bytes === null)
    || (receipt.state === "ready" && (!receipt.output_sha256 || !receipt.receipt_id || !receipt.ready_at || receipt.failure_code !== null))
    || (receipt.state !== "ready" && (receipt.can_download || receipt.ready_at !== null))
    || (receipt.state === "failed" && receipt.failure_code === null)) throw new Error("export_unavailable");
  return receipt;
}

export function normalizeDocumentExportReceipt(value: unknown, caseId: string, artifactId?: string): DocumentExportReceipt {
  const row = exportRecord(value, RECEIPT_KEYS);
  if (row.kind !== "student_profile" || row.template_sha256 !== DOCUMENT_EXPORT_TEMPLATE_SHA256
    || row.renderer_version !== DOCUMENT_EXPORT_RENDERER_VERSION || row.mime_type !== DOCUMENT_EXPORT_MIME) throw new Error("export_unavailable");
  const fields = receiptFields(row, caseId, DOCUMENT_EXPORT_MAX_BYTES, artifactId);
  if (fields.failure_code === "form_not_ready") throw new Error("export_unavailable");
  return { ...fields, failure_code: fields.failure_code, kind: "student_profile",
    renderer_version: DOCUMENT_EXPORT_RENDERER_VERSION, mime_type: DOCUMENT_EXPORT_MIME };
}

/** Public history contains provenance only, never frozen profile values or Storage paths. */
export function normalizeStoredDocumentExportReceipt(value: unknown, caseId: string, artifactId?: string): StoredDocumentExportReceipt {
  if (value && typeof value === "object" && "kind" in value && value.kind === "package")
    return normalizeDocumentPackageExportReceipt(value, caseId, artifactId);
  if (value && typeof value === "object" && "kind" in value && value.kind === "student_profile")
    return normalizeDocumentExportReceipt(value, caseId, artifactId);
  const row = exportRecord(value, [...RECEIPT_KEYS, "form", "generated_input_sha256", "renderer_proof"]);
  if (row.kind !== "university_form" || (row.mime_type !== DOCUMENT_EXPORT_MIME && row.mime_type !== "application/pdf")) throw new Error("export_unavailable");
  const renderer = row.mime_type === "application/pdf" ? "evo-university-form-pdf-v1" : "evo-university-form-docx-v1";
  if (row.renderer_version !== renderer) throw new Error("export_unavailable");
  const fields = receiptFields(row, caseId, UNIVERSITY_FORM_EXPORT_MAX_BYTES, artifactId);
  let proof: UniversityFormRendererProof | null = null;
  if (row.renderer_proof !== null) {
    const p = exportRecord(row.renderer_proof, ["image_id", "release_revision", "font_sha256"]);
    if (typeof p.image_id !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(p.image_id)
      || typeof p.release_revision !== "string" || !/^[a-f0-9]{40}$/u.test(p.release_revision)
      || p.font_sha256 !== (row.mime_type === "application/pdf" ? UNIVERSITY_FORM_FONT_SHA256 : null)) throw new Error("export_unavailable");
    proof = { image_id: p.image_id, release_revision: p.release_revision, font_sha256: p.font_sha256 as string | null };
  }
  if ((fields.output_sha256 === null) !== (proof === null)) throw new Error("export_unavailable");
  return { ...fields, kind: "university_form", mime_type: row.mime_type, renderer_version: renderer,
    form: normalizeUniversityFormBinding(row.form), generated_input_sha256: hash(row.generated_input_sha256), renderer_proof: proof } satisfies UniversityFormExportReceipt;
}

export function normalizeDocumentPackageExportReceipt(value: unknown, caseId: string, artifactId?: string): DocumentPackageExportReceipt {
  const row = exportRecord(value, [...RECEIPT_KEYS, "package"]);
  const binding = exportRecord(row.package, ["id", "application_id", "item_count"]);
  const id = exportUuid(row.id);
  if (row.kind !== "package" || row.mime_type !== DOCUMENT_PACKAGE_MIME || row.renderer_version !== "evo-partner-packet-zip-v1"
    || row.student_profile_id !== null || row.profile_revision !== null || row.field_reviews_sha256 !== null || row.template_sha256 !== null
    || exportUuid(row.student_case_id) !== caseId || (artifactId !== undefined && id !== artifactId)
    || (row.mode !== "draft" && row.mode !== "final") || typeof row.state !== "string" || !["pending", "stored_unverified", "ready", "unknown", "failed"].includes(row.state)
    || (row.failure_code !== null && !isDocumentExportFailure(row.failure_code))) throw new Error("export_unavailable");
  const receipt: DocumentPackageExportReceipt = {
    id, student_case_id: caseId, student_profile_id: null, profile_revision: null, field_reviews_sha256: null, template_sha256: null,
    kind: "package", mime_type: DOCUMENT_PACKAGE_MIME, renderer_version: "evo-partner-packet-zip-v1", mode: row.mode,
    workspace_revision: hash(row.workspace_revision), input_snapshot_sha256: hash(row.input_snapshot_sha256),
    state: row.state as DocumentPackageExportReceipt["state"], created_at: timestamp(row.created_at),
    ready_at: row.ready_at === null ? null : timestamp(row.ready_at), output_sha256: row.output_sha256 === null ? null : hash(row.output_sha256),
    output_bytes: row.output_bytes === null ? null : positive(row.output_bytes, DOCUMENT_PACKAGE_MAX_BYTES),
    receipt_id: row.receipt_id === null ? null : exportUuid(row.receipt_id), failure_code: row.failure_code as DocumentExportFailure | null,
    historical: bool(row.historical), can_download: bool(row.can_download),
    package: { id: exportUuid(binding.id), application_id: exportUuid(binding.application_id), item_count: positive(binding.item_count, 50) },
  };
  if ((receipt.output_sha256 === null) !== (receipt.output_bytes === null)
    || (receipt.state === "ready" && (!receipt.output_sha256 || !receipt.receipt_id || !receipt.ready_at || receipt.failure_code !== null))
    || (receipt.state !== "ready" && (receipt.can_download || receipt.ready_at !== null || receipt.receipt_id !== null))
    || ((receipt.state === "failed" || receipt.state === "unknown") !== (receipt.failure_code !== null))) throw new Error("export_unavailable");
  return receipt;
}

function workspaceFields(value: unknown, caseId: string, version: 1 | 2) {
  const row = exportRecord(value, ["schema_version", "student_case_id", "profile", "workspace_revision", "can_export", "artifacts"]);
  if (row.schema_version !== version || exportUuid(row.student_case_id) !== caseId || !Array.isArray(row.artifacts)) throw new Error("export_unavailable");
  const rawProfile = row.profile === null ? null : exportRecord(row.profile, ["id", "revision"]);
  const profile = rawProfile === null ? null : { id: exportUuid(rawProfile.id), revision: positive(rawProfile.revision) };
  const workspaceRevision = row.workspace_revision === null ? null : hash(row.workspace_revision);
  const canExport = bool(row.can_export);
  if ((profile === null) !== (workspaceRevision === null) || (!profile && canExport)) throw new Error("export_unavailable");
  return { student_case_id: caseId, profile, workspace_revision: workspaceRevision, can_export: canExport, artifacts: row.artifacts };
}
export function normalizeDocumentExportWorkspace(value: unknown, caseId: string): DocumentExportWorkspace {
  const fields = workspaceFields(value, caseId, 1);
  const artifacts = fields.artifacts.map(value => normalizeDocumentExportReceipt(value, caseId));
  if (new Set(artifacts.map(artifact => artifact.id)).size !== artifacts.length) throw new Error("export_unavailable");
  return { ...fields, schema_version: 1, artifacts };
}
export function normalizeDocumentExportWorkspaceV2(value: unknown, caseId: string): DocumentExportWorkspaceV2 {
  const fields = workspaceFields(value, caseId, 2);
  const artifacts = fields.artifacts.map(value => normalizeStoredDocumentExportReceipt(value, caseId));
  if (new Set(artifacts.map(artifact => artifact.id)).size !== artifacts.length) throw new Error("export_unavailable");
  return { ...fields, schema_version: 2, artifacts };
}

export function normalizeUniversityFormExportWorkspace(value: unknown, caseId: string, applicationId: string, mappingId: string): UniversityFormExportWorkspace {
  const row = exportRecord(value, ["schema_version", "student_case_id", "application_id", "catalog_institution_id", "profile",
    "selection", "workspace_revision", "can_export", "unavailable_reason"]);
  if (row.schema_version !== 1 || exportUuid(row.student_case_id) !== caseId || exportUuid(row.application_id) !== applicationId)
    throw new Error("export_unavailable");
  const catalog = exportUuid(row.catalog_institution_id);
  const rawProfile = row.profile === null ? null : exportRecord(row.profile, ["id", "revision"]);
  const profile = rawProfile ? { id: exportUuid(rawProfile.id), revision: positive(rawProfile.revision) } : null;
  const selection = row.selection === null ? null : normalizeUniversityFormBinding(row.selection);
  if (selection && (selection.application_id !== applicationId || selection.mapping_id !== mappingId || selection.catalog_institution_id !== catalog))
    throw new Error("export_unavailable");
  const revision = row.workspace_revision === null ? null : hash(row.workspace_revision), canExport = bool(row.can_export);
  const unavailable = selection === null ? "mapping_not_current" : profile === null ? "profile_missing" : null;
  if (row.unavailable_reason !== unavailable || canExport !== (unavailable === null) || (revision !== null) !== canExport) throw new Error("export_unavailable");
  return { schema_version: 1, student_case_id: caseId, application_id: applicationId, catalog_institution_id: catalog,
    profile, selection, workspace_revision: revision, can_export: canExport, unavailable_reason: unavailable };
}

export function normalizeApplicationPublishedFormsWorkspace(value: unknown, caseId: string, applicationId: string): ApplicationPublishedFormsWorkspace {
  const row = exportRecord(value, ["schema_version", "student_case_id", "application_id", "catalog_institution_id", "forms"]);
  if (row.schema_version !== 1 || exportUuid(row.student_case_id) !== caseId || exportUuid(row.application_id) !== applicationId)
    throw new Error("export_unavailable");
  const catalog = row.catalog_institution_id === null ? null : exportUuid(row.catalog_institution_id);
  const forms = row.forms === null ? null : normalizePublishedUniversityForms(row.forms);
  if ((catalog === null) !== (forms === null) || (forms && forms.catalog_institution_id !== catalog)) throw new Error("export_unavailable");
  return { schema_version: 1, student_case_id: caseId, application_id: applicationId, catalog_institution_id: catalog, forms };
}
