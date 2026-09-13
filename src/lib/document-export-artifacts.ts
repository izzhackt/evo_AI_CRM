import {
  DOCUMENT_EXPORT_MAX_BYTES, DOCUMENT_EXPORT_MIME, DOCUMENT_EXPORT_RENDERER_VERSION,
  DOCUMENT_EXPORT_TEMPLATE_SHA256,
  type DocumentExportFailure, type DocumentExportReceipt, type DocumentExportWorkspace,
} from "./document-export-artifact-contract.ts";

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
export function normalizeDocumentExportReceipt(value: unknown, caseId: string, artifactId?: string): DocumentExportReceipt {
  const row = exportRecord(value, ["id", "student_case_id", "student_profile_id", "profile_revision", "workspace_revision",
    "input_snapshot_sha256", "field_reviews_sha256", "kind", "mode", "state", "template_sha256", "renderer_version",
    "created_at", "ready_at", "output_sha256", "output_bytes", "mime_type", "receipt_id", "failure_code", "historical", "can_download"]);
  const id = exportUuid(row.id);
  if (exportUuid(row.student_case_id) !== caseId || (artifactId !== undefined && id !== artifactId)
    || row.kind !== "student_profile" || (row.mode !== "draft" && row.mode !== "final")
    || !["pending", "stored_unverified", "ready", "unknown", "failed"].includes(String(row.state))
    || row.template_sha256 !== DOCUMENT_EXPORT_TEMPLATE_SHA256 || row.renderer_version !== DOCUMENT_EXPORT_RENDERER_VERSION
    || row.mime_type !== DOCUMENT_EXPORT_MIME
    || (row.failure_code !== null && !isDocumentExportFailure(row.failure_code))) throw new Error("export_unavailable");
  const receipt: DocumentExportReceipt = {
    id, student_case_id: caseId, student_profile_id: exportUuid(row.student_profile_id), profile_revision: positive(row.profile_revision),
    workspace_revision: hash(row.workspace_revision), input_snapshot_sha256: hash(row.input_snapshot_sha256),
    field_reviews_sha256: hash(row.field_reviews_sha256), kind: "student_profile", mode: row.mode,
    state: row.state as DocumentExportReceipt["state"], template_sha256: DOCUMENT_EXPORT_TEMPLATE_SHA256,
    renderer_version: DOCUMENT_EXPORT_RENDERER_VERSION, created_at: timestamp(row.created_at),
    ready_at: row.ready_at === null ? null : timestamp(row.ready_at), output_sha256: row.output_sha256 === null ? null : hash(row.output_sha256),
    output_bytes: row.output_bytes === null ? null : positive(row.output_bytes, DOCUMENT_EXPORT_MAX_BYTES), mime_type: DOCUMENT_EXPORT_MIME,
    receipt_id: row.receipt_id === null ? null : exportUuid(row.receipt_id),
    failure_code: row.failure_code as DocumentExportFailure | null, historical: bool(row.historical), can_download: bool(row.can_download),
  };
  if ((receipt.output_sha256 === null) !== (receipt.output_bytes === null)
    || (receipt.state === "ready" && (!receipt.output_sha256 || !receipt.receipt_id || !receipt.ready_at || receipt.failure_code !== null))
    || (receipt.state !== "ready" && (receipt.can_download || receipt.ready_at !== null))
    || (receipt.state === "failed" && receipt.failure_code === null)) throw new Error("export_unavailable");
  return receipt;
}

export function normalizeDocumentExportWorkspace(value: unknown, caseId: string): DocumentExportWorkspace {
  const row = exportRecord(value, ["schema_version", "student_case_id", "profile", "workspace_revision", "can_export", "artifacts"]);
  if (row.schema_version !== 1 || exportUuid(row.student_case_id) !== caseId || !Array.isArray(row.artifacts)) throw new Error("export_unavailable");
  const rawProfile = row.profile === null ? null : exportRecord(row.profile, ["id", "revision"]);
  const profile = rawProfile === null ? null : { id: exportUuid(rawProfile.id), revision: positive(rawProfile.revision) };
  const workspaceRevision = row.workspace_revision === null ? null : hash(row.workspace_revision);
  const canExport = bool(row.can_export);
  if ((profile === null) !== (workspaceRevision === null) || (!profile && canExport)) throw new Error("export_unavailable");
  const artifacts = row.artifacts.map(value => normalizeDocumentExportReceipt(value, caseId));
  if (new Set(artifacts.map(artifact => artifact.id)).size !== artifacts.length) throw new Error("export_unavailable");
  return { schema_version: 1, student_case_id: caseId, profile, workspace_revision: workspaceRevision, can_export: canExport, artifacts };
}
