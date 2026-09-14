import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformActor } from "../platform-auth.ts";
import { staffHasPermission } from "../platform-access.ts";
import { EXPORT_HASH, exportRecord, exportUuid, normalizeStoredDocumentExportReceipt } from "../document-export-artifacts.ts";
import { UNIVERSITY_FORM_EXPORT_MAX_BYTES, type DocumentExportStorageTarget, type UniversityFormExportReceipt, type UniversityFormExportCommand } from "../document-export-artifact-contract.ts";
import { normalizeUniversityFormInput, type FormInput } from "../university-form-export-contract.ts";
import { computePackageGeneratedInputHash } from "../document-package.ts";
import type { FormRenderFailure } from "../university-form-render.ts";
import { renderUniversityForm } from "./university-template-preflight.ts";
import { readUniversityTemplateRuntimeIdentity } from "./university-template-runtime-identity.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { STANDARD_UPLOAD_MAX_BYTES, uploadSupabaseStorageObjectWithTus } from "./platform-storage-resumable-upload.ts";
import { awaitUniversityTemplateOperation, readUniversityTemplateSource, UniversityTemplateSourceError, universityTemplateSha256 } from "./university-template-source-storage.ts";
import { withUniversityTemplateByteOperation, type RetainUniversityTemplateByteWork } from "./university-template-byte-operation.ts";

type RpcClient = Pick<SupabaseClient, "schema">;
type Failure = NonNullable<UniversityFormExportReceipt["failure_code"]>;
export type { UniversityFormExportCommand } from "../document-export-artifact-contract.ts";
export type UniversityFormExportInput = Readonly<{
  session: RpcClient; service: Pick<SupabaseClient, "schema" | "storage">; actor: PlatformActor; caseId: string;
  command: UniversityFormExportCommand; refreshActor(): Promise<void>; signal: AbortSignal;
}>;
export class UniversityFormExportError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

async function rpc(client: RpcClient, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const step = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const result = await awaitUniversityTemplateOperation(() => client.schema("platform").rpc(name, args).abortSignal(step), step);
  if (!result.error) return result.data;
  const known: Record<string, [number, string]> = { "42501": [403, "forbidden"], "40001": [409, "source_changed"],
    "23505": [409, "request_conflict"], "22023": [400, "invalid_request"], "22P02": [400, "invalid_request"], "55000": [422, "form_not_ready"] };
  throw new UniversityFormExportError(...(known[result.error.code] ?? [503, "export_unavailable"]));
}
function receipt(value: unknown, caseId: string, artifactId?: string): UniversityFormExportReceipt {
  const result = normalizeStoredDocumentExportReceipt(value, caseId, artifactId);
  if (result.kind !== "university_form") throw new UniversityFormExportError(503, "export_unavailable");
  return result;
}
function expiry(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()
    || Date.parse(value) > Date.now() + 600_000) throw new UniversityFormExportError(503, "export_failed");
  return value;
}
function sameArtifact(current: UniversityFormExportReceipt, original: UniversityFormExportReceipt): void {
  const keys = ["id", "student_case_id", "student_profile_id", "profile_revision", "workspace_revision", "input_snapshot_sha256",
    "field_reviews_sha256", "mode", "template_sha256", "renderer_version", "mime_type", "generated_input_sha256"] as const;
  if (keys.some(key => current[key] !== original[key]) || JSON.stringify(current.form) !== JSON.stringify(original.form))
    throw new UniversityFormExportError(409, "integrity_failed");
}
function storageTarget(raw: unknown, artifact: UniversityFormExportReceipt, actor: PlatformActor): DocumentExportStorageTarget {
  const row = exportRecord(raw, ["bucket_id", "object_name", "mime_type", "expires_at"]);
  const extension = artifact.mime_type === "application/pdf" ? "pdf" : "docx";
  if (row.bucket_id !== "platform-document-exports" || row.mime_type !== artifact.mime_type
    || row.object_name !== `${actor.organizationId}/${artifact.student_case_id}/${artifact.id}.${extension}`)
    throw new UniversityFormExportError(409, "integrity_failed");
  return { bucket_id: "platform-document-exports", object_name: row.object_name as string, mime_type: artifact.mime_type, expires_at: expiry(row.expires_at) };
}
function verifyOutput(bytes: Uint8Array, artifact: UniversityFormExportReceipt): void {
  if (bytes.byteLength < 1 || bytes.byteLength > UNIVERSITY_FORM_EXPORT_MAX_BYTES || bytes.byteLength !== artifact.output_bytes
    || universityTemplateSha256(bytes) !== artifact.output_sha256) throw new UniversityFormExportError(409, "integrity_failed");
}
const RENDER_FAILURE: Record<FormRenderFailure, Failure> = {
  invalid_input: "integrity_failed", binding_mismatch: "integrity_failed", template_not_eligible: "source_unavailable",
  form_not_ready: "form_not_ready", text_overflow: "form_not_ready", character_unsupported: "form_not_ready",
  shaping_unsupported: "form_not_ready", output_too_large: "export_failed", source_unavailable: "export_failed",
};
function failureCode(error: unknown, fallback: Failure): Failure {
  const code = error instanceof UniversityFormExportError || error instanceof UniversityTemplateSourceError ? error.code : null;
  return ["form_not_ready", "profile_not_ready", "source_changed", "access_changed", "source_unavailable", "template_unavailable",
    "integrity_failed", "export_failed", "storage_unavailable"].includes(code ?? "") ? code as Failure : fallback;
}

/** Existing167 lifecycle plus the ported renderer. No values/paths escape in the result. */
export async function produceUniversityFormExport(input: UniversityFormExportInput): Promise<UniversityFormExportReceipt> {
  try { return await withUniversityTemplateByteOperation(retain => produce(input, retain)); }
  catch (error) {
    if (error instanceof UniversityFormExportError) throw error;
    throw new UniversityFormExportError(503, "export_unavailable");
  }
}
async function produce(input: UniversityFormExportInput, retain: RetainUniversityTemplateByteWork): Promise<UniversityFormExportReceipt> {
  const { session, service, actor, command } = input;
  if (("presentationRole" in actor && actor.presentationRole !== null) || !staffHasPermission(actor, "profile.read.full") || !staffHasPermission(actor, "document.download")
    || !staffHasPermission(actor, "catalog.read")) throw new UniversityFormExportError(403, "forbidden");
  let caseId: string;
  try {
    caseId = exportUuid(input.caseId); exportUuid(command.application_id); exportUuid(command.mapping_id); exportUuid(command.request_id);
    if (command.kind !== "university_form" || !["draft", "final"].includes(command.mode) || !EXPORT_HASH.test(command.expected_workspace_revision)) throw new Error();
  } catch { throw new UniversityFormExportError(400, "invalid_request"); }
  const config = getPlatformSupabaseBackendConfig();
  const prepared = exportRecord(await rpc(session, "prepare_university_form_export", {
    p_student_case_id: caseId, p_application_id: command.application_id, p_mapping_id: command.mapping_id,
    p_mode: command.mode, p_expected_workspace_revision: command.expected_workspace_revision, p_request_id: command.request_id,
  }, input.signal), ["schema_version", "preparation_id", "artifact", "frozen_form"]);
  const original = receipt(prepared.artifact, caseId), preparationId = exportUuid(prepared.preparation_id);
  if (prepared.schema_version !== 1 || original.workspace_revision !== command.expected_workspace_revision || original.mode !== command.mode
    || original.form.application_id !== command.application_id || original.form.mapping_id !== command.mapping_id)
    throw new UniversityFormExportError(409, "integrity_failed");
  const begun = exportRecord(await rpc(service, "begin_document_export", { p_preparation_id: preparationId,
    p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId }, input.signal), ["artifact", "created", "claim_token", "template_source"]);
  let artifact = receipt(begun.artifact, caseId, original.id); sameArtifact(artifact, original);
  if (begun.created === false) {
    if (begun.claim_token !== null || begun.template_source !== null) throw new UniversityFormExportError(503, "export_unavailable");
    return artifact;
  }
  if (begun.created !== true || artifact.state !== "pending" || artifact.output_sha256 !== null) throw new UniversityFormExportError(503, "export_unavailable");
  const claim = exportUuid(begun.claim_token);
  let signal = input.signal;
  const settle = async (outcome: "ready" | "failed" | "unknown", code: Failure | null, bytes: Uint8Array | null) => {
    const result = receipt(await rpc(service, "complete_document_export", { p_artifact_id: artifact.id, p_claim_token: claim,
      p_outcome: outcome, p_failure_code: code, p_observed_sha256: bytes ? universityTemplateSha256(bytes) : null,
      p_observed_bytes: bytes?.byteLength ?? null }, signal), caseId, artifact.id);
    sameArtifact(result, original);
    if ((outcome === "ready" && result.state !== "ready" && result.state !== "failed")
      || (outcome === "failed" && result.state !== "failed") || (outcome === "unknown" && result.state !== "unknown" && result.state !== "failed")
      || (artifact.output_sha256 !== null && (result.output_sha256 !== artifact.output_sha256 || result.output_bytes !== artifact.output_bytes
        || JSON.stringify(result.renderer_proof) !== JSON.stringify(artifact.renderer_proof))))
      throw new UniversityFormExportError(409, "integrity_failed");
    return result;
  };
  const refresh = async () => {
    try { await awaitUniversityTemplateOperation(() => input.refreshActor(), signal); }
    catch (error) {
      const changed = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        && ["forbidden", "access_changed", "authentication_required"].includes(error.code);
      throw new UniversityFormExportError(changed ? 403 : 503, changed ? "access_changed" : "export_unavailable");
    }
  };
  let form: FormInput, bytes: Uint8Array, proof: NonNullable<UniversityFormExportReceipt["renderer_proof"]>;
  try {
    try { form = normalizeUniversityFormInput(prepared.frozen_form); }
    catch { throw new UniversityFormExportError(409, "integrity_failed"); }
    if (form.organization_id !== actor.organizationId || form.student_case_id !== caseId || form.mode !== artifact.mode
      || JSON.stringify(form.form) !== JSON.stringify(artifact.form) || form.template.sha256 !== artifact.template_sha256
      || form.renderer_version !== artifact.renderer_version || form.source_mime_type !== artifact.mime_type
      || form.frozen_profile.profile.id !== artifact.student_profile_id || form.frozen_profile.profile.revision !== artifact.profile_revision)
      throw new UniversityFormExportError(409, "integrity_failed");
    const generated = await computePackageGeneratedInputHash({ kind: "university_form", organizationId: actor.organizationId, studentCaseId: caseId,
      profileId: artifact.student_profile_id, profileRevision: artifact.profile_revision, fieldReviewsSha256: artifact.field_reviews_sha256,
      templateSha256: artifact.template_sha256, applicationId: artifact.form.application_id, catalogInstitutionId: artifact.form.catalog_institution_id,
      templateVersionId: artifact.form.template_version_id, mappingVersionId: artifact.form.mapping_id, mappingSha256: artifact.form.mapping_sha256,
      mappingReviewVersionId: artifact.form.review_id });
    if (generated !== artifact.generated_input_sha256) throw new UniversityFormExportError(409, "integrity_failed");
    const source = exportRecord(begun.template_source, ["bucket_id", "object_name", "mime_type", "sha256", "byte_size", "inspection_receipt_id", "manifest_sha256", "expires_at"]);
    const extension = form.source_mime_type === "application/pdf" ? "pdf" : "docx";
    if (source.bucket_id !== "platform-document-templates" || source.object_name !== `${actor.organizationId}/${form.form.template_id}/${form.template.versionId}.${extension}`
      || source.mime_type !== form.source_mime_type || source.sha256 !== form.template.sha256 || source.byte_size !== form.source_byte_size
      || source.inspection_receipt_id !== form.form.inspection_receipt_id || source.manifest_sha256 !== form.manifest_sha256)
      throw new UniversityFormExportError(409, "integrity_failed");
    signal = AbortSignal.any([input.signal, AbortSignal.timeout(Date.parse(expiry(source.expires_at)) - Date.now())]);
    const identity = readUniversityTemplateRuntimeIdentity();
    await refresh();
    const sourceBytes = await readUniversityTemplateSource({ bucket_id: "platform-document-templates", object_name: source.object_name as string,
      mime_type: form.source_mime_type, byte_size: form.source_byte_size }, config, AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    (url, init) => retain(fetch(url, init)));
    if (!sourceBytes) throw new UniversityFormExportError(409, "source_unavailable");
    if (universityTemplateSha256(sourceBytes) !== form.template.sha256) throw new UniversityFormExportError(409, "integrity_failed");
    await refresh();
    const rendered = await awaitUniversityTemplateOperation(() => retain(renderUniversityForm({ bytes: sourceBytes, formInput: form,
      binding: { artifactId: artifact.id, preparationId, inputSnapshotSha256: artifact.input_snapshot_sha256,
        generatedInputSha256: artifact.generated_input_sha256, fieldReviewsSha256: artifact.field_reviews_sha256 } }, { signal })), signal);
    if (rendered.status !== "rendered") throw new UniversityFormExportError(422, RENDER_FAILURE[rendered.code]);
    const after = readUniversityTemplateRuntimeIdentity();
    if (after.imageId !== identity.imageId || after.revision !== identity.revision) throw new UniversityFormExportError(503, "export_failed");
    bytes = rendered.bytes;
    if (bytes.byteLength !== rendered.metadata.outputByteLength || universityTemplateSha256(bytes) !== rendered.metadata.outputSha256)
      throw new UniversityFormExportError(409, "integrity_failed");
    proof = { image_id: identity.imageId, release_revision: identity.revision, font_sha256: rendered.metadata.fontSha256 };
    await refresh();
  } catch (error) { return settle("failed", failureCode(error, "export_failed"), null); }
  // Ambiguous seal never permits upload; only later explicit reconciliation may recover it.
  const sealed = exportRecord(await rpc(service, "seal_document_export_output", { p_artifact_id: artifact.id, p_claim_token: claim,
    p_output_sha256: universityTemplateSha256(bytes), p_output_bytes: bytes.byteLength, p_renderer_proof: proof }, signal), ["artifact", "storage"]);
  artifact = receipt(sealed.artifact, caseId, original.id); sameArtifact(artifact, original);
  if (artifact.state === "failed") return artifact;
  verifyOutput(bytes, artifact);
  if (JSON.stringify(artifact.renderer_proof) !== JSON.stringify(proof)) throw new UniversityFormExportError(409, "integrity_failed");
  const storage = storageTarget(sealed.storage, artifact, actor);
  let observed: Uint8Array;
  try {
    await refresh(); expiry(storage.expires_at);
    if (bytes.byteLength > STANDARD_UPLOAD_MAX_BYTES) {
      const uploaded = await awaitUniversityTemplateOperation(() => retain(uploadSupabaseStorageObjectWithTus(bytes, {
        bucketId: storage.bucket_id, objectName: storage.object_name, expiresAt: storage.expires_at,
      }, artifact.mime_type, { backendConfig: () => config, now: Date.now, fetch: async (url, init) => {
        const step = AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]);
        const headers = new Headers(init.headers); headers.set("x-upsert", "false");
        const response = await awaitUniversityTemplateOperation(() => retain(fetch(url, { ...init, headers, signal: step })), step);
        if (response.body) await retain(response.body.cancel());
        return response;
      } })), signal);
      if (!uploaded) throw new UniversityFormExportError(503, "storage_unavailable");
    } else {
      const uploaded = await awaitUniversityTemplateOperation(() => retain(service.storage.from(storage.bucket_id).upload(storage.object_name, bytes,
        { contentType: artifact.mime_type, upsert: false, cacheControl: "0" })), signal);
      if (uploaded.error) throw new UniversityFormExportError(503, "storage_unavailable");
    }
    expiry(storage.expires_at);
    const downloaded = await awaitUniversityTemplateOperation(() => retain(service.storage.from(storage.bucket_id).download(storage.object_name)), signal);
    if (downloaded.error || !downloaded.data) throw new UniversityFormExportError(503, "storage_unavailable");
    if (downloaded.data.type !== artifact.mime_type || downloaded.data.size !== artifact.output_bytes
      || downloaded.data.size > UNIVERSITY_FORM_EXPORT_MAX_BYTES) throw new UniversityFormExportError(409, "integrity_failed");
    observed = new Uint8Array(await awaitUniversityTemplateOperation(() => retain(downloaded.data.arrayBuffer()), signal));
    verifyOutput(observed, artifact); await refresh();
  } catch (error) {
    const code = failureCode(error, "storage_unavailable");
    return settle(code === "storage_unavailable" ? "unknown" : "failed", code, null);
  }
  // Do not replace an ambiguous ready completion with a different failure input.
  return settle("ready", null, observed);
}
