import {
  EXPORT_HASH, exportRecord, exportUuid, normalizeDocumentExportReceipt, normalizeDocumentExportWorkspace,
} from "./document-export-artifacts.ts";
import {
  DOCUMENT_EXPORT_MAX_BYTES, DOCUMENT_EXPORT_MIME,
  type DocumentExportMode, type DocumentExportReceipt, type DocumentExportWorkspace,
} from "./document-export-artifact-contract.ts";

export type DocumentExportCommand = Readonly<{
  mode: DocumentExportMode; expected_workspace_revision: string; request_id: string;
}>;
type Failure = Readonly<{ status: string; uncertain: boolean; artifact: null }>;
export type DocumentExportOutcome = Failure | Readonly<{ status: "received"; uncertain: false; artifact: DocumentExportReceipt }>;
export type DocumentExportWorkspaceOutcome = Readonly<{ status: string; workspace: DocumentExportWorkspace | null }>;
const UNKNOWN: Failure = { status: "export_unavailable", uncertain: true, artifact: null };
const FAILURES: Readonly<Record<string, number>> = {
  invalid_request: 400, authentication_required: 401, forbidden: 403, access_changed: 403,
  source_changed: 409, request_conflict: 409, profile_not_ready: 422,
  source_unavailable: 409, integrity_failed: 409, template_unavailable: 503,
  export_failed: 503, storage_unavailable: 503, artifact_pending: 409, export_unavailable: 503,
};
const DEFINITE = new Set(["invalid_request", "authentication_required", "forbidden", "access_changed", "source_changed", "request_conflict", "profile_not_ready"]);
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

async function commandResponse(response: Response, caseId: string, command?: DocumentExportCommand, artifactId?: string): Promise<DocumentExportOutcome> {
  const value = await json(response);
  if (value && typeof value === "object" && Object.hasOwn(value, "artifact")) {
    const row = exportRecord(value, ["artifact"]);
    const artifact = normalizeDocumentExportReceipt(row.artifact, exportUuid(caseId), artifactId);
    const expected = artifact.state === "ready" ? 200 : artifact.state === "failed" ? FAILURES[artifact.failure_code!] : 202;
    if (response.status !== expected || (command && (artifact.mode !== command.mode || artifact.workspace_revision !== command.expected_workspace_revision))) return UNKNOWN;
    return { status: "received", uncertain: false, artifact };
  }
  return safeFailure(response, value);
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
export async function downloadDocumentExport(caseId: string, input: DocumentExportReceipt): Promise<string> {
  try {
    const artifact = normalizeDocumentExportReceipt(input, exportUuid(caseId));
    if (artifact.state !== "ready" || !artifact.can_download) return "forbidden";
    const response = await fetch(`${base(caseId)}/${artifact.id}/download`, { method: "GET", credentials: "same-origin", cache: "no-store" });
    if (response.status !== 200) return safeFailure(response, await json(response)).status;
    if (response.headers.get("content-type")?.split(";", 1)[0].trim() !== DOCUMENT_EXPORT_MIME) return "integrity_failed";
    const data = await bytes(response, DOCUMENT_EXPORT_MAX_BYTES);
    if (data.byteLength !== artifact.output_bytes) return "integrity_failed";
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== artifact.output_sha256) return "integrity_failed";
    const url = URL.createObjectURL(new Blob([data], { type: DOCUMENT_EXPORT_MIME }));
    let link: HTMLAnchorElement | null = null;
    try {
      link = document.createElement("a"); link.href = url;
      link.download = artifact.mode === "draft" ? "EVO-Student-Profile-Draft.docx" : "EVO-Student-Profile.docx";
      document.body.appendChild(link); link.click();
    } finally { link?.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    return "downloaded";
  } catch { return "export_unavailable"; }
}

export function documentExportWorkspaceMatches(workspace: DocumentExportWorkspace | null, caseId: string, profile: { id: string; revision: number }): boolean {
  return Boolean(workspace?.can_export && workspace.student_case_id === caseId && workspace.profile?.id === profile.id
    && workspace.profile.revision === profile.revision && workspace.workspace_revision);
}

export function updateDocumentExportHistory(workspace: DocumentExportWorkspace, artifact: DocumentExportReceipt): DocumentExportWorkspace {
  if (artifact.student_case_id !== workspace.student_case_id) return workspace;
  return { ...workspace, artifacts: [artifact, ...workspace.artifacts.filter(row => row.id !== artifact.id)]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id)) };
}
