import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformActor } from "../platform-auth.ts";
import { DOCUMENT_PACKAGE_MAX_BYTES, DOCUMENT_PACKAGE_MIME, type DocumentPackageExportCommand,
  type DocumentPackageExportReceipt } from "../document-export-artifact-contract.ts";
import { exportRecord, exportUuid, normalizeStoredDocumentExportReceipt } from "../document-export-artifacts.ts";
import { buildPartnerPacketZip, type PartnerPacketZipSource } from "./document-package.ts";
import { getPlatformSupabaseBackendConfig, type PlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { STANDARD_UPLOAD_MAX_BYTES, uploadSupabaseStorageObjectWithTus } from "./platform-storage-resumable-upload.ts";
import { awaitUniversityTemplateOperation as awaitStep, universityTemplateSha256 as sha256 } from "./university-template-source-storage.ts";
import { withUniversityTemplateByteOperation, type RetainUniversityTemplateByteWork } from "./university-template-byte-operation.ts";

type Client = Pick<SupabaseClient, "schema">;
type Failure = NonNullable<DocumentPackageExportReceipt["failure_code"]>;
type Input = Readonly<{ session: Client; service: Pick<SupabaseClient, "schema" | "storage">; actor: PlatformActor;
  caseId: string; command: DocumentPackageExportCommand; refreshActor(): Promise<void>; signal: AbortSignal }>;
type Source = PartnerPacketZipSource & Readonly<{ bucket: "platform-documents" | "platform-document-exports"; object: string }>;
export class DocumentPackageExportError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
function fail(code = "integrity_failed", status = 409): never { throw new DocumentPackageExportError(status, code); }
async function rpc(client: Client, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const step = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  const result = await awaitStep(() => client.schema("platform").rpc(name, args).abortSignal(step), step);
  if (!result.error) return result.data;
  const known: Record<string, [number, string]> = { "42501": [403, "access_changed"], "40001": [409, "source_changed"],
    "23505": [409, "request_conflict"], "22023": [400, "invalid_request"],
    "55000": name === "prepare_document_package_export" ? [422, "package_not_ready"] : [409, "artifact_pending"] };
  const [status, code] = known[result.error.code] ?? [503, "export_unavailable"];
  throw new DocumentPackageExportError(status, code);
}
function receipt(raw: unknown, input: Input, initial?: DocumentPackageExportReceipt): DocumentPackageExportReceipt {
  const a = normalizeStoredDocumentExportReceipt(raw, input.caseId, initial?.id);
  if (a.kind !== "package" || a.package.id !== input.command.packet_id || a.mode !== input.command.mode
    || a.workspace_revision !== input.command.expected_workspace_revision) fail();
  if (initial && (a.input_snapshot_sha256 !== initial.input_snapshot_sha256 || a.created_at !== initial.created_at
    || JSON.stringify(a.package) !== JSON.stringify(initial.package))) fail();
  return a;
}
function expiry(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()
    || Date.parse(value) > Date.now() + 600000) fail("storage_unavailable", 503);
  return value;
}
function sources(raw: unknown, input: Input, artifact: DocumentPackageExportReceipt): { items: Source[]; expiresAt: string } {
  const row = exportRecord(raw, ["artifact_id", "packet_id", "workspace_revision", "expires_at", "sources"]);
  if (row.artifact_id !== artifact.id || row.packet_id !== artifact.package.id || row.workspace_revision !== artifact.workspace_revision
    || !Array.isArray(row.sources) || row.sources.length !== artifact.package.item_count) fail();
  const items = row.sources.map((value): Source => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    const kind = (value as Record<string, unknown>).kind;
    const s = exportRecord(value, kind === "original"
      ? ["kind", "id", "slot_id", "filename", "version_no", "sha256", "size_bytes", "mime_type", "bucket_id", "object_name", "review_id"]
      : ["kind", "id", "export_kind", "mode", "application_id", "created_at", "sha256", "size_bytes", "mime_type", "bucket_id", "object_name"]);
    const id = exportUuid(s.id), mime = s.mime_type;
    if (kind !== "original" && kind !== "generated") fail();
    const extension = mime === "application/pdf" ? "pdf" : mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png"
      : mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : fail();
    if (typeof s.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(s.sha256) || typeof s.size_bytes !== "number"
      || !Number.isSafeInteger(s.size_bytes) || s.size_bytes < 1 || s.size_bytes > (kind === "original" ? 26214400 : 20971520)) fail();
    if (kind === "original") {
      exportUuid(s.slot_id); exportUuid(s.review_id);
      if (s.bucket_id !== "platform-documents" || typeof s.object_name !== "string" || !/^[a-f0-9]{2}\/[a-f0-9]{62}$/.test(s.object_name)
        || extension === "docx" || typeof s.filename !== "string"
        || typeof s.version_no !== "string" || !/^[1-9]\d*$/.test(s.version_no)) fail();
    } else if ((s.export_kind !== "student_profile" && s.export_kind !== "university_form") || (s.mode !== "draft" && s.mode !== "final")
      || (artifact.mode === "final" && s.mode !== "final") || (extension !== "docx" && extension !== "pdf")
      || (s.export_kind === "student_profile" && (s.application_id !== null || extension !== "docx" || s.size_bytes > 5242880))
      || (s.export_kind === "university_form" && s.application_id !== artifact.package.application_id)
      || typeof s.created_at !== "string" || !Number.isFinite(Date.parse(s.created_at))
      || s.bucket_id !== "platform-document-exports" || s.object_name !== `${input.actor.organizationId}/${input.caseId}/${id}.${extension}`) fail();
    return { id, kind, sha256: s.sha256, sizeBytes: s.size_bytes, mimeType: mime as string,
      name: kind === "original" ? s.filename as string : `${s.export_kind}.${extension}`, mode: kind === "original" ? null : s.mode as "draft" | "final",
      bucket: s.bucket_id as Source["bucket"], object: s.object_name as string };
  });
  if (new Set(items.map(item => item.id)).size !== items.length || items.reduce((sum, item) => sum + item.sizeBytes, 0) >= DOCUMENT_PACKAGE_MAX_BYTES)
    fail("package_too_large", 422);
  return { items, expiresAt: expiry(row.expires_at) };
}
function credentials(config: PlatformSupabaseBackendConfig): Record<string, string> {
  return { apikey: config.supabaseSecretKey, ...(config.supabaseSecretKey.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${config.supabaseSecretKey}` }) };
}
/** Exact private object only. Bound the stream before allocating a complete blob. */
async function readBytes(bucket: string, object: string, mime: string, size: number, config: PlatformSupabaseBackendConfig,
  signal: AbortSignal, retain: RetainUniversityTemplateByteWork): Promise<Buffer> {
  const step = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  const response = await awaitStep(() => retain(fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${object}`, {
    method: "GET", headers: credentials(config), redirect: "error", cache: "no-store", signal: step,
  })), step);
  const reader = response.body?.getReader();
  try {
    if (!response.ok || !reader) fail("storage_unavailable", 503);
    if (response.headers.get("content-type")?.split(";")[0].trim() !== mime
      || (response.headers.has("content-length") && response.headers.get("content-length") !== String(size))) fail();
    const chunks: Buffer[] = []; let total = 0;
    while (true) {
      const result = await awaitStep(() => retain(reader.read()), step);
      if (result.done) break;
      if (!(result.value instanceof Uint8Array) || result.value.byteLength > size - total || chunks.length >= 4096) fail();
      total += result.value.byteLength; chunks.push(Buffer.from(result.value));
    }
    if (total !== size) fail();
    return Buffer.concat(chunks, total);
  } finally { if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); } }
}
function failureCode(error: unknown, fallback: Failure): Failure {
  return error instanceof DocumentPackageExportError && ["source_changed", "access_changed", "source_unavailable", "integrity_failed",
    "export_failed", "storage_unavailable"].includes(error.code) ? error.code as Failure : fallback;
}

export async function produceDocumentPackageExport(input: Input): Promise<DocumentPackageExportReceipt> {
  try { return await withUniversityTemplateByteOperation(retain => produce(input, retain)); }
  catch (error) { if (error instanceof DocumentPackageExportError) throw error; throw new DocumentPackageExportError(503, "export_unavailable"); }
}
async function produce(input: Input, retain: RetainUniversityTemplateByteWork): Promise<DocumentPackageExportReceipt> {
  const { actor, command, service } = input;
  const config = getPlatformSupabaseBackendConfig();
  // Capacity is an explicit product requirement, never silently lowered or paid-upgraded.
  const capacity = await awaitStep(() => retain(service.storage.getBucket("platform-document-exports")), input.signal);
  if (capacity.error || capacity.data?.public !== false || capacity.data.file_size_limit !== DOCUMENT_PACKAGE_MAX_BYTES
    || !capacity.data.allowed_mime_types?.includes(DOCUMENT_PACKAGE_MIME)) fail("package_storage_not_ready", 503);
  await input.refreshActor();
  const prepared = exportRecord(await rpc(input.session, "prepare_document_package_export", { p_student_case_id: input.caseId,
    p_packet_id: command.packet_id, p_mode: command.mode, p_expected_workspace_revision: command.expected_workspace_revision,
    p_request_id: command.request_id }, input.signal), ["schema_version", "preparation_id", "artifact"]);
  if (prepared.schema_version !== 1) fail();
  const original = receipt(prepared.artifact, input);
  const begun = exportRecord(await rpc(service, "begin_document_export", { p_preparation_id: exportUuid(prepared.preparation_id),
    p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId }, input.signal), ["artifact", "created", "claim_token"]);
  let artifact = receipt(begun.artifact, input, original);
  if (begun.created === false) { if (begun.claim_token !== null) fail(); return artifact; }
  if (begun.created !== true || artifact.state !== "pending" || artifact.output_sha256 !== null) fail();
  const claim = exportUuid(begun.claim_token);
  let signal = input.signal;
  const settle = async (outcome: "ready" | "failed" | "unknown", code: Failure | null, observed: Buffer | null) => {
    const result = receipt(await rpc(service, "complete_document_export", { p_artifact_id: artifact.id, p_claim_token: claim,
      p_outcome: outcome, p_failure_code: code, p_observed_sha256: observed ? sha256(observed) : null,
      p_observed_bytes: observed?.length ?? null }, signal), input, original);
    if ((outcome === "ready" && result.state !== "ready" && result.state !== "failed")
      || (outcome === "failed" && result.state !== "failed") || (outcome === "unknown" && result.state !== "unknown" && result.state !== "failed")
      || (artifact.output_sha256 !== null && (result.output_sha256 !== artifact.output_sha256 || result.output_bytes !== artifact.output_bytes))) fail();
    return result;
  };
  const refreshSources = async () => {
    await awaitStep(() => input.refreshActor(), signal);
    return sources(await rpc(service, "read_document_package_export_sources", { p_artifact_id: artifact.id, p_claim_token: claim,
      p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId }, signal), input, artifact);
  };
  let bytes: Buffer;
  try {
    const snapshot = await refreshSources();
    signal = AbortSignal.any([input.signal, AbortSignal.timeout(Date.parse(snapshot.expiresAt) - Date.now())]);
    const buffers = [];
    for (const source of snapshot.items) {
      const current = await refreshSources();
      if (JSON.stringify(current.items) !== JSON.stringify(snapshot.items)) fail("source_changed");
      const data = await readBytes(source.bucket, source.object, source.mimeType, source.sizeBytes, config, signal, retain);
      if (sha256(data) !== source.sha256) fail();
      buffers.push({ itemId: source.id, bytes: data });
    }
    bytes = buildPartnerPacketZip({ packetId: artifact.package.id, caseId: input.caseId, inputSha256: artifact.input_snapshot_sha256,
      mode: artifact.mode, sources: snapshot.items.map(source => ({ id: source.id, kind: source.kind, sha256: source.sha256,
        sizeBytes: source.sizeBytes, mimeType: source.mimeType, name: source.name, mode: source.mode })) }, buffers).bytes;
    await refreshSources();
  } catch (error) { return settle("failed", failureCode(error, "export_failed"), null); }
  const sealed = exportRecord(await rpc(service, "seal_document_export_output", { p_artifact_id: artifact.id, p_claim_token: claim,
    p_output_sha256: sha256(bytes), p_output_bytes: bytes.length, p_renderer_proof: null }, signal), ["artifact", "storage"]);
  artifact = receipt(sealed.artifact, input, original);
  if (artifact.state === "failed") return artifact;
  if (artifact.output_sha256 !== sha256(bytes) || artifact.output_bytes !== bytes.length) fail();
  const storage = exportRecord(sealed.storage, ["bucket_id", "object_name", "mime_type", "expires_at"]);
  const object = `${actor.organizationId}/${input.caseId}/${artifact.id}.zip`;
  if (storage.bucket_id !== "platform-document-exports" || storage.object_name !== object || storage.mime_type !== DOCUMENT_PACKAGE_MIME) fail();
  let observed: Buffer;
  try {
    const expiresAt = expiry(storage.expires_at); await input.refreshActor();
    if (bytes.length > STANDARD_UPLOAD_MAX_BYTES) {
      const uploaded = await awaitStep(() => retain(uploadSupabaseStorageObjectWithTus(bytes, { bucketId: "platform-document-exports", objectName: object,
        expiresAt }, DOCUMENT_PACKAGE_MIME, { backendConfig: () => config, now: Date.now, fetch: async (url, init) => {
          const step = AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]);
          const headers = new Headers(init.headers); headers.set("x-upsert", "false");
          const response = await awaitStep(() => retain(fetch(url, { ...init, headers, signal: step })), step);
          if (response.body) await retain(response.body.cancel()); return response;
        } })), signal);
      if (!uploaded) fail("storage_unavailable", 503);
    } else {
      const uploaded = await awaitStep(() => retain(service.storage.from("platform-document-exports").upload(object, bytes,
        { contentType: DOCUMENT_PACKAGE_MIME, upsert: false, cacheControl: "0" })), signal);
      if (uploaded.error) fail("storage_unavailable", 503);
    }
    expiry(expiresAt); await input.refreshActor();
    observed = await readBytes("platform-document-exports", object, DOCUMENT_PACKAGE_MIME, bytes.length, config, signal, retain);
    if (sha256(observed) !== artifact.output_sha256) fail();
    await input.refreshActor();
  } catch (error) { const code = failureCode(error, "storage_unavailable"); return settle(code === "storage_unavailable" ? "unknown" : "failed", code, null); }
  return settle("ready", null, observed);
}
