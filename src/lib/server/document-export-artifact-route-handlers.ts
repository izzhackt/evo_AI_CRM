import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformActor, PlatformActorResult } from "../platform-auth.ts";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import { normalizePlatformStudentProfileFieldsSnapshot } from "../platform-student-profile-fields.ts";
import { getProfileExportValues, ProfileExportNotReadyError } from "../student-profile-fields.ts";
import {
  DOCUMENT_EXPORT_MAX_BYTES, DOCUMENT_EXPORT_MIME, UNIVERSITY_FORM_EXPORT_MAX_BYTES, DOCUMENT_PACKAGE_MAX_BYTES, type DocumentExportFailure,
  type DocumentExportReceipt, type StoredDocumentExportReceipt, type DocumentExportRpcContract, type DocumentExportStorageTarget,
} from "../document-export-artifact-contract.ts";
import {
  EXPORT_HASH, exportRecord, exportUuid, isDocumentExportFailure,
  normalizeDocumentExportReceipt, normalizeDocumentExportWorkspace, normalizeStoredDocumentExportReceipt, normalizeDocumentExportWorkspaceV2,
  normalizeUniversityFormExportWorkspace,
  normalizeApplicationPublishedFormsWorkspace,
} from "../document-export-artifacts.ts";
import { getPlatformPublishedUniversityForms, PlatformUniversityFormError } from "../platform-university-forms.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import { renderStudentProfileTemplate } from "./student-profile-template.ts";
import { produceUniversityFormExport, UniversityFormExportError } from "./university-form-export.ts";
import { produceDocumentPackageExport, DocumentPackageExportError } from "./document-package-export.ts";

const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const FAILURE_STATUS: Record<DocumentExportFailure | "form_not_ready", number> = {
  form_not_ready: 422,
  profile_not_ready: 422, source_changed: 409, access_changed: 403, source_unavailable: 409,
  template_unavailable: 503, integrity_failed: 409, export_failed: 503, storage_unavailable: 503,
};
type RpcClient = Pick<SupabaseClient, "schema">;
type ServiceClient = Pick<SupabaseClient, "schema" | "storage">;
type Context = { params: Promise<{ studentCaseId: string; artifactId?: string }> };
type Command = { mode: "draft" | "final"; expected_workspace_revision: string; request_id: string };
export type DocumentExportDependencies = Readonly<{
  loadActor(): Promise<PlatformActorResult>;
  createSessionClient(): Promise<RpcClient>;
  createServiceClient(): ServiceClient;
  readTemplate(): Promise<Buffer>;
  render: typeof renderStudentProfileTemplate;
  requestId(): string;
}>;
const DEFAULTS: DocumentExportDependencies = {
  loadActor: async () => (await import("../platform-auth.ts")).resolvePlatformActor(),
  createSessionClient: async () => (await import("../supabase/server.ts")).createSupabaseServerClient(),
  createServiceClient: () => createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
  readTemplate: () => readFile(path.join(process.cwd(), "assets/templates/student-profile.docx")),
  render: renderStudentProfileTemplate, requestId: randomUUID,
};
class ExportError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
function responseError(status: number, error: string): Response { return Response.json({ error }, { status, headers: HEADERS }); }
function failure(error: unknown): Response {
  if (error instanceof PlatformUniversityFormError)
    return error.code === "forbidden" ? responseError(403, "forbidden") : responseError(503, "export_unavailable");
  return error instanceof ExportError || error instanceof UniversityFormExportError || error instanceof DocumentPackageExportError
    ? responseError(error.status, error.code) : responseError(503, "export_unavailable");
}
function denyActor(result: PlatformActorResult): PlatformActor {
  if (result.status === "anonymous") throw new ExportError(401, "authentication_required");
  if (result.status !== "authenticated") throw new ExportError(503, "export_unavailable");
  if (isStaffPreview(result.actor) || !staffHasPermission(result.actor, "document.download")) throw new ExportError(403, "forbidden");
  return result.actor;
}
async function refreshActor(deps: DocumentExportDependencies, initial: PlatformActor): Promise<void> {
  let actor: PlatformActor;
  try { actor = denyActor(await deps.loadActor()); }
  catch (error) {
    if (error instanceof ExportError && (error.status === 401 || error.status === 403)) throw new ExportError(403, "access_changed");
    throw error;
  }
  if (actor.authUserId !== initial.authUserId || actor.membershipId !== initial.membershipId
    || actor.organizationId !== initial.organizationId) throw new ExportError(403, "access_changed");
}
function sameOrigin(request: Request): boolean {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin === "null") return false;
    const parsed = new URL(origin);
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const protocol = request.headers.get("x-forwarded-proto")?.trim() ?? new URL(request.url).protocol.slice(0, -1);
    return ["http", "https"].includes(protocol) && parsed.origin === origin && parsed.host === host
      && parsed.protocol === `${protocol}:`;
  } catch { return false; }
}
async function body(request: Request, keys: readonly string[] | ((value: unknown) => readonly string[])): Promise<Record<string, unknown>> {
  if (!sameOrigin(request)) throw new ExportError(403, "forbidden");
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "") || !request.body)
    throw new ExportError(400, "invalid_request");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 1024)) throw new ExportError(400, "invalid_request");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); throw new Error("oversize"); }
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return exportRecord(value, typeof keys === "function" ? keys(value) : keys);
  } catch { throw new ExportError(400, "invalid_request"); }
  finally { reader.releaseLock(); }
}
async function rpc<N extends keyof DocumentExportRpcContract>(client: RpcClient, name: N, args: DocumentExportRpcContract[N]["args"]): Promise<unknown> {
  const result = await client.schema("platform").rpc(name, args);
  if (result.error) {
    const codes: Record<string, [number, string]> = { "42501": [403, "forbidden"], "40001": [409, "source_changed"],
      "23505": [409, "request_conflict"], "22023": [400, "invalid_request"], "55000": [409, "artifact_pending"] };
    const [status, code] = codes[result.error.code] ?? [503, "export_unavailable"];
    throw new ExportError(status, code);
  }
  return result.data;
}
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function receiptResponse(artifact: StoredDocumentExportReceipt): Response {
  return Response.json({ artifact }, { status: artifact.state === "ready" ? 200 : artifact.state === "failed"
    ? FAILURE_STATUS[artifact.failure_code!] : 202, headers: HEADERS });
}
function target(value: unknown, actor: PlatformActor, caseId: string, artifactId: string,
  artifact?: StoredDocumentExportReceipt): DocumentExportStorageTarget {
  const row = exportRecord(value, ["bucket_id", "object_name", "mime_type", "expires_at"]);
  const mime = artifact?.mime_type ?? DOCUMENT_EXPORT_MIME, extension = mime === "application/zip" ? "zip" : mime === "application/pdf" ? "pdf" : "docx";
  if (row.bucket_id !== "platform-document-exports" || row.mime_type !== mime
    || row.object_name !== `${actor.organizationId}/${caseId}/${artifactId}.${extension}`
    || typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at))
    || Date.parse(row.expires_at) <= Date.now()) throw new ExportError(503, "export_unavailable");
  return row as DocumentExportStorageTarget;
}
async function readStored(client: ServiceClient, storage: DocumentExportStorageTarget,
  artifact?: StoredDocumentExportReceipt): Promise<Buffer> {
  if (Date.parse(storage.expires_at) <= Date.now()) throw new ExportError(503, "storage_unavailable");
  const result = await client.storage.from(storage.bucket_id).download(storage.object_name);
  if (result.error || !result.data) throw new ExportError(503, "storage_unavailable");
  const maximum = artifact?.kind === "package" ? DOCUMENT_PACKAGE_MAX_BYTES
    : artifact?.kind === "university_form" ? UNIVERSITY_FORM_EXPORT_MAX_BYTES : DOCUMENT_EXPORT_MAX_BYTES;
  if (result.data.size < 1 || result.data.size > maximum) throw new ExportError(409, "integrity_failed");
  return Buffer.from(await result.data.arrayBuffer());
}
function verify(bytes: Buffer, artifact: StoredDocumentExportReceipt): void {
  if (bytes.byteLength !== artifact.output_bytes || digest(bytes) !== artifact.output_sha256) throw new ExportError(409, "integrity_failed");
}

export function documentExportMethodNotAllowed(allow = "GET, POST"): Response {
  return new Response(null, { status: 405, headers: { ...HEADERS, allow } });
}

export function createDocumentExportHandlers(deps: DocumentExportDependencies = DEFAULTS) {
  async function GET(request: Request, context: Context): Promise<Response> {
    if (request.method !== "GET") return documentExportMethodNotAllowed();
    try {
      const actor = denyActor(await deps.loadActor());
      const caseId = exportUuid((await context.params).studentCaseId);
      const query = new URL(request.url).searchParams;
      if (query.has("published_for_application_id")) {
        if ([...query.keys()].some(key => !["published_for_application_id", "after_id"].includes(key))
          || query.getAll("published_for_application_id").length !== 1 || query.getAll("after_id").length > 1)
          throw new ExportError(400, "invalid_request");
        let applicationId: string, afterId: string | null;
        try { applicationId = exportUuid(query.get("published_for_application_id"));
          afterId = query.has("after_id") ? exportUuid(query.get("after_id")) : null; }
        catch { throw new ExportError(400, "invalid_request"); }
        const session = await deps.createSessionClient();
        const { data, error } = await session.schema("platform").from("university_applications")
          .select("id,catalog_institution_id").eq("organization_id", actor.organizationId)
          .eq("student_case_id", caseId).eq("id", applicationId).maybeSingle();
        if (error) throw new ExportError(error.code === "42501" ? 403 : 503, error.code === "42501" ? "forbidden" : "export_unavailable");
        if (!data) throw new ExportError(403, "forbidden");
        const application = exportRecord(data, ["id", "catalog_institution_id"]);
        if (exportUuid(application.id) !== applicationId) throw new ExportError(503, "export_unavailable");
        const catalog = application.catalog_institution_id === null ? null : exportUuid(application.catalog_institution_id);
        const forms = catalog === null ? null : await getPlatformPublishedUniversityForms(session,
          { p_catalog_institution_id: catalog, p_after_id: afterId });
        const workspace = normalizeApplicationPublishedFormsWorkspace({ schema_version: 1, student_case_id: caseId,
          application_id: applicationId, catalog_institution_id: catalog, forms }, caseId, applicationId);
        return Response.json(workspace, { headers: HEADERS });
      }
      if (query.has("application_id") || query.has("mapping_id")) {
        if ([...query.keys()].length !== 2 || query.getAll("application_id").length !== 1 || query.getAll("mapping_id").length !== 1)
          throw new ExportError(400, "invalid_request");
        let applicationId: string, mappingId: string;
        try { applicationId = exportUuid(query.get("application_id")); mappingId = exportUuid(query.get("mapping_id")); }
        catch { throw new ExportError(400, "invalid_request"); }
        const data = await rpc(await deps.createSessionClient(), "staff_university_form_export_workspace", {
          p_student_case_id: caseId, p_application_id: applicationId, p_mapping_id: mappingId,
        });
        return Response.json(normalizeUniversityFormExportWorkspace(data, caseId, applicationId, mappingId), { headers: HEADERS });
      }
      if ([...query.keys()].some(key => key !== "schema_version") || query.getAll("schema_version").length > 1
        || (query.has("schema_version") && !["1", "2"].includes(query.get("schema_version")!))) throw new ExportError(400, "invalid_request");
      const v2 = query.get("schema_version") === "2";
      const data = await rpc(await deps.createSessionClient(), v2 ? "staff_document_export_workspace_v2" : "staff_document_export_workspace", { p_student_case_id: caseId });
      return Response.json(v2 ? normalizeDocumentExportWorkspaceV2(data, caseId) : normalizeDocumentExportWorkspace(data, caseId), { headers: HEADERS });
    } catch (error) { return failure(error); }
  }
  async function POST(request: Request, context: Context): Promise<Response> {
    if (request.method !== "POST") return documentExportMethodNotAllowed();
    let actor: PlatformActor; let caseId: string; let command: Command;
    let client: ServiceClient; let artifact: DocumentExportReceipt; let claim: string; let frozen: unknown;
    try {
      actor = denyActor(await deps.loadActor()); caseId = exportUuid((await context.params).studentCaseId);
      const raw = await body(request, value => value && typeof value === "object" && "kind" in value && value.kind === "university_form"
        ? ["kind", "application_id", "mapping_id", "mode", "expected_workspace_revision", "request_id"]
        : value && typeof value === "object" && "kind" in value && value.kind === "package"
          ? ["kind", "packet_id", "mode", "expected_workspace_revision", "request_id"]
        : ["mode", "expected_workspace_revision", "request_id"]);
      if ((raw.mode !== "draft" && raw.mode !== "final") || typeof raw.expected_workspace_revision !== "string"
        || !EXPORT_HASH.test(raw.expected_workspace_revision)) throw new ExportError(400, "invalid_request");
      let requestId: string;
      try { requestId = exportUuid(raw.request_id); } catch { throw new ExportError(400, "invalid_request"); }
      command = { mode: raw.mode, expected_workspace_revision: raw.expected_workspace_revision, request_id: requestId };
      if (raw.kind === "package") {
        let packetId: string;
        try { packetId = exportUuid(raw.packet_id); } catch { throw new ExportError(400, "invalid_request"); }
        const initialActor = actor;
        return receiptResponse(await produceDocumentPackageExport({ actor, caseId, session: await deps.createSessionClient(),
          service: deps.createServiceClient(), signal: request.signal, command: { ...command, kind: "package", packet_id: packetId },
          refreshActor: () => refreshActor(deps, initialActor) }));
      }
      if (!staffHasPermission(actor, "profile.read.full")) throw new ExportError(403, "forbidden");
      if (raw.kind === "university_form") {
        let applicationId: string, mappingId: string;
        try { applicationId = exportUuid(raw.application_id); mappingId = exportUuid(raw.mapping_id); }
        catch { throw new ExportError(400, "invalid_request"); }
        const initialActor = actor;
        const result = await produceUniversityFormExport({ actor, caseId,
          session: await deps.createSessionClient(), service: deps.createServiceClient(), signal: request.signal,
          command: { ...command, kind: "university_form", application_id: applicationId, mapping_id: mappingId },
          refreshActor: () => refreshActor(deps, initialActor),
        });
        return receiptResponse(result);
      }
      const prepared = exportRecord(await rpc(await deps.createSessionClient(), "prepare_document_export", {
        p_student_case_id: caseId, p_mode: command.mode, p_expected_workspace_revision: command.expected_workspace_revision,
        p_request_id: command.request_id,
      }), ["schema_version", "preparation_id", "artifact", "frozen_profile"]);
      if (prepared.schema_version !== 1) throw new Error("export_unavailable");
      artifact = normalizeDocumentExportReceipt(prepared.artifact, caseId);
      if (artifact.workspace_revision !== command.expected_workspace_revision || artifact.mode !== command.mode) throw new Error("export_unavailable");
      frozen = prepared.frozen_profile;
      client = deps.createServiceClient();
      const begun = exportRecord(await rpc(client, "begin_document_export", {
        p_preparation_id: exportUuid(prepared.preparation_id), p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId,
      }), ["artifact", "created", "claim_token"]);
      artifact = normalizeDocumentExportReceipt(begun.artifact, caseId, artifact.id);
      if (typeof begun.created !== "boolean") throw new Error("export_unavailable");
      if (!begun.created) {
        if (begun.claim_token !== null) throw new Error("export_unavailable");
        return receiptResponse(artifact);
      }
      if (artifact.state !== "pending") throw new Error("export_unavailable");
      claim = exportUuid(begun.claim_token);
    } catch (error) { return failure(error); }

    async function complete(outcome: "ready" | "failed" | "unknown", code: DocumentExportFailure | null, bytes: Buffer | null): Promise<DocumentExportReceipt> {
      return normalizeDocumentExportReceipt(await rpc(client, "complete_document_export", {
        p_artifact_id: artifact.id, p_claim_token: claim, p_outcome: outcome, p_failure_code: code,
        p_observed_sha256: bytes ? digest(bytes) : null, p_observed_bytes: bytes?.byteLength ?? null,
      }), caseId, artifact.id);
    }
    let bytes: Buffer;
    try {
      const snapshot = normalizePlatformStudentProfileFieldsSnapshot(frozen, caseId);
      if (!snapshot.canExport || snapshot.profile?.id !== artifact.student_profile_id
        || snapshot.profile.revision !== artifact.profile_revision) throw new ExportError(409, "source_changed");
      const values = getProfileExportValues(snapshot, command.mode);
      let template: Buffer;
      try { template = await deps.readTemplate(); } catch { throw new ExportError(503, "template_unavailable"); }
      bytes = deps.render(template, values, command.mode);
      if (!Buffer.isBuffer(bytes) || bytes.byteLength < 1 || bytes.byteLength > DOCUMENT_EXPORT_MAX_BYTES) throw new Error("export_failed");
      await refreshActor(deps, actor);
    } catch (error) {
      const code = error instanceof ProfileExportNotReadyError ? "profile_not_ready"
        : error instanceof ExportError && isDocumentExportFailure(error.code) ? error.code : "export_failed";
      try { return receiptResponse(await complete("failed", code, null)); } catch (completionError) { return failure(completionError); }
    }
    // Seal durably BEFORE crossing the Storage boundary. An ambiguous seal does
    // not authorize upload; later recovery can inspect only this exact artifact.
    let storage: DocumentExportStorageTarget;
    try {
      const sealed = exportRecord(await rpc(client, "seal_document_export_output", {
        p_artifact_id: artifact.id, p_claim_token: claim, p_output_sha256: digest(bytes), p_output_bytes: bytes.byteLength,
      }), ["artifact", "storage"]);
      artifact = normalizeDocumentExportReceipt(sealed.artifact, caseId, artifact.id);
      if (artifact.state === "failed") return receiptResponse(artifact);
      verify(bytes, artifact);
      storage = target(sealed.storage, actor, caseId, artifact.id);
    } catch (error) { return failure(error); }
    let observed: Buffer;
    try {
      const uploaded = await client.storage.from(storage.bucket_id).upload(storage.object_name, bytes, { contentType: DOCUMENT_EXPORT_MIME, upsert: false });
      if (uploaded.error) throw new ExportError(503, "storage_unavailable");
      observed = await readStored(client, storage); verify(observed, artifact);
      await refreshActor(deps, actor);
    } catch (error) {
      const code = error instanceof ExportError && isDocumentExportFailure(error.code) ? error.code : "storage_unavailable";
      const outcome = code === "integrity_failed" || code === "access_changed" ? "failed" : "unknown";
      try { return receiptResponse(await complete(outcome, code, null)); } catch (completionError) { return failure(completionError); }
    }
    // A timeout here may have committed ready. Do not issue a second completion
    // with changed input; the original request's history/replay recovers the fact.
    try {
      const completed = await complete("ready", null, observed);
      if (completed.state !== "ready" && completed.state !== "failed") throw new Error("export_unavailable");
      return receiptResponse(completed);
    } catch (error) { return failure(error); }
  }
  return { GET, POST };
}

export function createDocumentExportDownloadHandler(deps: DocumentExportDependencies = DEFAULTS) {
  return async function GET(request: Request, context: Context): Promise<Response> {
    if (request.method !== "GET") return documentExportMethodNotAllowed("GET");
    try {
      const actor = denyActor(await deps.loadActor());
      const params = await context.params; const caseId = exportUuid(params.studentCaseId); const id = exportUuid(params.artifactId);
      const grant = exportRecord(await rpc(await deps.createSessionClient(), "grant_document_export_download", {
        p_artifact_id: id, p_request_id: deps.requestId(),
      }), ["grant_id", "artifact_id", "expires_at", "consumed"]);
      if (grant.artifact_id !== id || grant.consumed !== false || typeof grant.expires_at !== "string"
        || !Number.isFinite(Date.parse(grant.expires_at)) || Date.parse(grant.expires_at) <= Date.now()) throw new Error("export_unavailable");
      const grantId = exportUuid(grant.grant_id); const client = deps.createServiceClient();
      const consumed = exportRecord(await rpc(client, "consume_document_export_download", {
        p_grant_id: grantId, p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId,
      }), ["grant_id", "artifact", "storage"]);
      if (consumed.grant_id !== grantId) throw new Error("export_unavailable");
      const artifact = normalizeStoredDocumentExportReceipt(consumed.artifact, caseId, id);
      if (artifact.state !== "ready") throw new ExportError(409, "artifact_pending");
      const storage = target(consumed.storage, actor, caseId, id, artifact);
      let bytes: Buffer | null = null; let readError: unknown;
      try { bytes = await readStored(client, storage, artifact); verify(bytes, artifact); }
      catch (error) { readError = error; }
      await refreshActor(deps, actor);
      const completed = exportRecord(await rpc(client, "complete_document_export_download", {
        p_grant_id: grantId, p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId,
        p_observed_sha256: bytes ? digest(bytes) : null, p_observed_bytes: bytes?.byteLength ?? null,
      }), ["grant_id", "artifact_id", "verified", "failure_code"]);
      if (completed.grant_id !== grantId || completed.artifact_id !== id || completed.verified !== true || completed.failure_code !== null)
        throw new ExportError(403, "download_unavailable");
      if (readError || !bytes) throw readError ?? new ExportError(503, "storage_unavailable");
      const name = artifact.kind === "package" ? "EVO-Documents" : artifact.kind === "university_form" ? "EVO-University-Form" : "EVO-Student-Profile";
      const extension = artifact.mime_type === "application/zip" ? "zip" : artifact.mime_type === "application/pdf" ? "pdf" : "docx";
      return new Response(new Uint8Array(bytes), { headers: { ...HEADERS, "content-type": artifact.mime_type,
        "content-length": String(bytes.byteLength), "content-disposition": `attachment; filename="${name}-${artifact.mode}.${extension}"` } });
    } catch (error) { return failure(error); }
  };
}

export function createDocumentExportReconcileHandler(deps: DocumentExportDependencies = DEFAULTS) {
  return async function POST(request: Request, context: Context): Promise<Response> {
    if (request.method !== "POST") return documentExportMethodNotAllowed("POST");
    try {
      const actor = denyActor(await deps.loadActor()); const params = await context.params;
      const caseId = exportUuid(params.studentCaseId); const id = exportUuid(params.artifactId);
      const command = await body(request, ["request_id"]); const requestId = exportUuid(command.request_id);
      const session = await deps.createSessionClient();
      const workspace = normalizeDocumentExportWorkspaceV2(await rpc(session, "staff_document_export_workspace_v2", { p_student_case_id: caseId }), caseId);
      const existing = workspace.artifacts.find(artifact => artifact.id === id);
      if (!existing) throw new ExportError(403, "forbidden");
      if (existing.state === "ready" || existing.state === "failed") return receiptResponse(existing);
      const client = deps.createServiceClient();
      const inspected = exportRecord(await rpc(client, "inspect_document_export_reconciliation", {
        p_artifact_id: id, p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId,
      }), ["artifact", "storage"]);
      const artifact = normalizeStoredDocumentExportReceipt(inspected.artifact, caseId, id);
      if (artifact.state === "ready" || artifact.state === "failed") return receiptResponse(artifact);
      const storage = inspected.storage === null ? null : target(inspected.storage, actor, caseId, id, artifact);
      let observed: Buffer | null = null; let code: "source_unavailable" | "storage_unavailable" | "integrity_failed" | null = null;
      try {
        if (storage) { observed = await readStored(client, storage, artifact); verify(observed, artifact); }
        else code = "source_unavailable";
      }
      catch (error) { code = error instanceof ExportError && error.code === "integrity_failed" ? "integrity_failed" : "storage_unavailable"; }
      await refreshActor(deps, actor);
      const completed = normalizeStoredDocumentExportReceipt(await rpc(client, "reconcile_document_export", {
        p_artifact_id: id, p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId,
        p_request_id: requestId, p_observed_sha256: observed && code === null ? digest(observed) : null,
        p_observed_bytes: code === null ? observed?.byteLength ?? null : null,
        p_failure_code: code,
      }), caseId, id);
      return receiptResponse(completed);
    } catch (error) { return failure(error); }
  };
}
