import {
  EXPORT_HASH, exportRecord, exportUuid, normalizeDocumentExportWorkspace,
  normalizeStoredDocumentExportReceipt, normalizeDocumentExportWorkspaceV2, normalizeUniversityFormExportWorkspace,
  normalizeApplicationPublishedFormsWorkspace,
} from "./document-export-artifacts.ts";
import {
  DOCUMENT_EXPORT_MAX_BYTES, UNIVERSITY_FORM_EXPORT_MAX_BYTES, DOCUMENT_PACKAGE_MAX_BYTES, type DocumentPackageExportCommand,
  type DocumentExportMode, type DocumentExportReceipt, type DocumentExportWorkspace, type StoredDocumentExportReceipt, type DocumentExportWorkspaceV2,
  type UniversityFormExportCommand, type UniversityFormExportWorkspace, type ApplicationPublishedFormsWorkspace,
} from "./document-export-artifact-contract.ts";

export type DocumentExportCommand = Readonly<{
  mode: DocumentExportMode; expected_workspace_revision: string; request_id: string;
}>;
type Failure = Readonly<{ status: string; uncertain: boolean; artifact: null }>;
export type DocumentExportOutcome = Failure | Readonly<{ status: "received"; uncertain: false; artifact: StoredDocumentExportReceipt }>;
export type DocumentExportWorkspaceOutcome = Readonly<{ status: string; workspace: DocumentExportWorkspace | null }>;
const UNKNOWN: Failure = { status: "export_unavailable", uncertain: true, artifact: null };
const FAILURES: Readonly<Record<string, number>> = {
  invalid_request: 400, authentication_required: 401, forbidden: 403, access_changed: 403,
  source_changed: 409, request_conflict: 409, profile_not_ready: 422,
  form_not_ready: 422,
  package_not_ready: 422, package_too_large: 422, package_storage_not_ready: 503,
  source_unavailable: 409, integrity_failed: 409, template_unavailable: 503,
  export_failed: 503, storage_unavailable: 503, artifact_pending: 409, export_unavailable: 503,
};
const DEFINITE = new Set(["invalid_request", "authentication_required", "forbidden", "access_changed", "source_changed", "request_conflict", "profile_not_ready", "form_not_ready",
  "package_not_ready", "package_too_large", "package_storage_not_ready"]);
const base = (caseId: string) => `/api/v3/student-cases/${exportUuid(caseId)}/document-exports`;

async function bytes(response: Response, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > max)) throw new Error("export_unavailable");
  if (!response.body) throw new Error("export_unavailable");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) throw new Error("export_unavailable");
      parts.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
async function json(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new Error("export_unavailable");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bytes(response, 512 * 1024)));
}
function safeFailure(response: Response, value: unknown): Failure {
  try {
    const row = exportRecord(value, ["error"]);
    if (typeof row.error !== "string" || FAILURES[row.error] !== response.status) return UNKNOWN;
    return { status: row.error, uncertain: !DEFINITE.has(row.error), artifact: null };
  } catch { return UNKNOWN; }
}

export async function readDocumentExportWorkspace(caseId: string, signal?: AbortSignal): Promise<DocumentExportWorkspaceOutcome> {
  try {
    const response = await fetch(base(caseId), { method: "GET", credentials: "same-origin", cache: "no-store", signal });
    const value = await json(response);
    if (response.status !== 200) return { status: safeFailure(response, value).status, workspace: null };
    return { status: "loaded", workspace: normalizeDocumentExportWorkspace(value, exportUuid(caseId)) };
  } catch { return { status: "export_unavailable", workspace: null }; }
}

export async function readDocumentExportHistory(caseId: string, signal?: AbortSignal): Promise<Readonly<{ status: string; workspace: DocumentExportWorkspaceV2 | null }>> {
  try {
    const response = await fetch(`${base(caseId)}?schema_version=2`, { method: "GET", credentials: "same-origin", cache: "no-store", signal });
    const value = await json(response);
    if (response.status !== 200) return { status: safeFailure(response, value).status, workspace: null };
    return { status: "loaded", workspace: normalizeDocumentExportWorkspaceV2(value, exportUuid(caseId)) };
  } catch { return { status: "export_unavailable", workspace: null }; }
}

export async function readPublishedFormsForApplication(caseId: string, applicationId: string, afterId?: string,
  signal?: AbortSignal): Promise<Readonly<{ status: string; workspace: ApplicationPublishedFormsWorkspace | null }>> {
  try {
    const query = new URLSearchParams({ published_for_application_id: exportUuid(applicationId) });
    if (afterId !== undefined) query.set("after_id", exportUuid(afterId));
    const response = await fetch(`${base(caseId)}?${query}`, { method: "GET", credentials: "same-origin", cache: "no-store", signal });
    const value = await json(response);
    if (response.status !== 200) return { status: safeFailure(response, value).status, workspace: null };
    const workspace = normalizeApplicationPublishedFormsWorkspace(value, exportUuid(caseId), applicationId);
    if (afterId && workspace.forms?.items.some(item => item.id <= afterId)) throw new Error("export_unavailable");
    return { status: "loaded", workspace };
  } catch { return { status: "export_unavailable", workspace: null }; }
}

export async function readUniversityFormExportWorkspace(caseId: string, applicationId: string, mappingId: string,
  signal?: AbortSignal): Promise<Readonly<{ status: string; workspace: UniversityFormExportWorkspace | null }>> {
  try {
    const query = new URLSearchParams({ application_id: exportUuid(applicationId), mapping_id: exportUuid(mappingId) });
    const response = await fetch(`${base(caseId)}?${query}`, { method: "GET", credentials: "same-origin", cache: "no-store", signal });
    const value = await json(response);
    if (response.status !== 200) return { status: safeFailure(response, value).status, workspace: null };
    return { status: "loaded", workspace: normalizeUniversityFormExportWorkspace(value, exportUuid(caseId), applicationId, mappingId) };
  } catch { return { status: "export_unavailable", workspace: null }; }
}

async function commandResponse(response: Response, caseId: string, command?: DocumentExportCommand | UniversityFormExportCommand | DocumentPackageExportCommand, artifactId?: string): Promise<DocumentExportOutcome> {
  const value = await json(response);
  if (value && typeof value === "object" && Object.hasOwn(value, "artifact")) {
    const row = exportRecord(value, ["artifact"]);
    const artifact = normalizeStoredDocumentExportReceipt(row.artifact, exportUuid(caseId), artifactId);
    const expected = artifact.state === "ready" ? 200 : artifact.state === "failed" ? FAILURES[artifact.failure_code!] : 202;
    if (response.status !== expected) return UNKNOWN;
    if (command) {
      if (artifact.mode !== command.mode || artifact.workspace_revision !== command.expected_workspace_revision) return UNKNOWN;
      if ("kind" in command && command.kind === "package") {
        if (artifact.kind !== "package" || artifact.package.id !== command.packet_id) return UNKNOWN;
      } else if ("kind" in command) {
        if (artifact.kind !== "university_form" || artifact.form.application_id !== command.application_id
          || artifact.form.mapping_id !== command.mapping_id) return UNKNOWN;
      } else if (artifact.kind !== "student_profile") return UNKNOWN;
    }
    return { status: "received", uncertain: false, artifact };
  }
  return safeFailure(response, value);
}

/** One explicit immutable packet export; retry retains the same command identity. */
export async function createDocumentPackageExport(caseId: string, command: DocumentPackageExportCommand): Promise<DocumentExportOutcome> {
  try {
    exportUuid(command.request_id); exportUuid(command.packet_id);
    if (command.kind !== "package" || !["draft", "final"].includes(command.mode)
      || !EXPORT_HASH.test(command.expected_workspace_revision)) throw new Error("invalid_request");
    const response = await fetch(base(caseId), { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: command.kind, packet_id: command.packet_id,
        mode: command.mode, expected_workspace_revision: command.expected_workspace_revision, request_id: command.request_id }) });
    return await commandResponse(response, caseId, command);
  } catch { return UNKNOWN; }
}

/** One explicit command. Its caller retains this exact payload if the outcome is unknown. */
export async function createDocumentExport(caseId: string, command: DocumentExportCommand): Promise<DocumentExportOutcome> {
  try {
    exportUuid(command.request_id);
    if (!["draft", "final"].includes(command.mode) || !EXPORT_HASH.test(command.expected_workspace_revision)) throw new Error("invalid_request");
    const response = await fetch(base(caseId), { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: command.mode,
        expected_workspace_revision: command.expected_workspace_revision, request_id: command.request_id }) });
    return await commandResponse(response, caseId, command);
  } catch { return UNKNOWN; }
}

/** Retrying an uncertain form export must reuse this exact request, never create a new artifact. */
export async function createUniversityFormExport(caseId: string, command: UniversityFormExportCommand): Promise<DocumentExportOutcome> {
  try {
    exportUuid(command.request_id); exportUuid(command.application_id); exportUuid(command.mapping_id);
    if (command.kind !== "university_form" || !["draft", "final"].includes(command.mode)
      || !EXPORT_HASH.test(command.expected_workspace_revision)) throw new Error("invalid_request");
    const response = await fetch(base(caseId), { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: command.kind, application_id: command.application_id,
        mapping_id: command.mapping_id, mode: command.mode, expected_workspace_revision: command.expected_workspace_revision,
        request_id: command.request_id }) });
    return await commandResponse(response, caseId, command);
  } catch { return UNKNOWN; }
}

/** Reconciliation checks a known saved artifact; it never calls the renderer. */
export async function reconcileDocumentExport(caseId: string, artifactId: string, requestId: string): Promise<DocumentExportOutcome> {
  try {
    const id = exportUuid(artifactId);
    const response = await fetch(`${base(caseId)}/${id}/reconcile`, { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ request_id: exportUuid(requestId) }) });
    return await commandResponse(response, caseId, undefined, id);
  } catch { return UNKNOWN; }
}

/** Download only saved, hash-verified bytes. No generation request is made here. */
export async function downloadDocumentExport(caseId: string, input: StoredDocumentExportReceipt): Promise<string> {
  try {
    const artifact = normalizeStoredDocumentExportReceipt(input, exportUuid(caseId));
    if (artifact.state !== "ready" || !artifact.can_download) return "forbidden";
    const response = await fetch(`${base(caseId)}/${artifact.id}/download`, { method: "GET", credentials: "same-origin", cache: "no-store" });
    if (response.status !== 200) return safeFailure(response, await json(response)).status;
    if (response.headers.get("content-type")?.split(";", 1)[0].trim() !== artifact.mime_type) return "integrity_failed";
    const data = await bytes(response, artifact.kind === "package" ? DOCUMENT_PACKAGE_MAX_BYTES : artifact.kind === "university_form" ? UNIVERSITY_FORM_EXPORT_MAX_BYTES : DOCUMENT_EXPORT_MAX_BYTES);
    if (data.byteLength !== artifact.output_bytes) return "integrity_failed";
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== artifact.output_sha256) return "integrity_failed";
    const url = URL.createObjectURL(new Blob([data], { type: artifact.mime_type }));
    let link: HTMLAnchorElement | null = null;
    try {
      link = document.createElement("a"); link.href = url;
      const name = artifact.kind === "package" ? "EVO-Documents" : artifact.kind === "university_form" ? "EVO-University-Form" : "EVO-Student-Profile";
      const extension = artifact.kind === "package" ? "zip" : artifact.mime_type === "application/pdf" ? "pdf" : "docx";
      link.download = `${name}${artifact.mode === "draft" ? "-Draft" : ""}.${extension}`;
      document.body.appendChild(link); link.click();
    } finally { link?.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    return "downloaded";
  } catch { return "export_unavailable"; }
}

export function documentExportWorkspaceMatches(workspace: DocumentExportWorkspace | DocumentExportWorkspaceV2 | null, caseId: string, profile: { id: string; revision: number }): boolean {
  return Boolean(workspace?.can_export && workspace.student_case_id === caseId && workspace.profile?.id === profile.id
    && workspace.profile.revision === profile.revision && workspace.workspace_revision);
}

export function updateDocumentExportHistory(workspace: DocumentExportWorkspaceV2, artifact: StoredDocumentExportReceipt): DocumentExportWorkspaceV2;
export function updateDocumentExportHistory(workspace: DocumentExportWorkspace, artifact: DocumentExportReceipt): DocumentExportWorkspace;
export function updateDocumentExportHistory(workspace: DocumentExportWorkspace | DocumentExportWorkspaceV2,
  artifact: StoredDocumentExportReceipt): DocumentExportWorkspace | DocumentExportWorkspaceV2 {
  if (artifact.student_case_id !== workspace.student_case_id) return workspace;
  if (workspace.schema_version === 1) {
    if (artifact.kind !== "student_profile") return workspace;
    return { ...workspace, artifacts: [artifact, ...workspace.artifacts.filter(row => row.id !== artifact.id)]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id)) };
  }
  return { ...workspace, artifacts: [artifact, ...workspace.artifacts.filter(row => row.id !== artifact.id)]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id)) };
}
