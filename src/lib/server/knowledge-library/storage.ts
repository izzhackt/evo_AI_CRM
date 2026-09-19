import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { type KnowledgeBlob, KNOWLEDGE_PART_SIZE } from "@/lib/knowledge-library-contract";
import { KnowledgeError, checkedBlob, knowledgeRpcError, readKnowledgeBlob, requireKnowledgeAdmin, runKnowledgeCommand } from "@/lib/v3/knowledge-library-source";
import { createPlatformSupabaseServiceClient } from "@/lib/server/platform-supabase-service-client";
import { getPlatformSupabaseBackendConfig } from "@/lib/server/platform-supabase-backend-config";
import { scanBytesWithClamd } from "@/lib/server/clamd-malware-scanner";

export const KNOWLEDGE_BUCKET = "platform-knowledge-library";
function service() { return createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()); }
export function knowledgeObjectPath(blob: KnowledgeBlob, index: number) {
  return `${blob.organization_id}/${blob.area}/${blob.id}/${String(index).padStart(8, "0")}`;
}
function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
async function readPart(blob: KnowledgeBlob, index: number): Promise<Uint8Array> {
  const { data, error } = await service().storage.from(KNOWLEDGE_BUCKET).download(knowledgeObjectPath(blob, index));
  if (error || !data) throw new KnowledgeError("knowledge_storage_unavailable");
  const bytes = new Uint8Array(await data.arrayBuffer());
  const expected = blob.parts?.find((p) => p.part_index === index);
  if (!expected || bytes.length !== expected.byte_size || sha256(bytes) !== expected.sha256) {
    throw new KnowledgeError("knowledge_integrity_failed", 409);
  }
  return bytes;
}
export async function uploadKnowledgePart(actor: ActivePlatformActor, blobId: string, index: number, bytes: Uint8Array) {
  return persistPart(actor, blobId, index, bytes, false);
}
async function persistPart(actor: ActivePlatformActor, blobId: string, index: number, bytes: Uint8Array, sealed: boolean) {
  requireKnowledgeAdmin(actor);
  const blob = await readKnowledgeBlob(actor, blobId);
  if (blob.area === "secrets" && !sealed) throw new KnowledgeError("knowledge_encrypted_operation_required", 400);
  const count = Math.ceil(blob.byte_size / KNOWLEDGE_PART_SIZE);
  const size = Math.min(KNOWLEDGE_PART_SIZE, blob.byte_size - index * KNOWLEDGE_PART_SIZE);
  if (!Number.isSafeInteger(index) || index < 0 || index >= count || bytes.length !== size) throw new KnowledgeError("knowledge_part_invalid", 400);
  const digest = sha256(bytes);
  const existing = blob.parts?.find((p) => p.part_index === index);
  if (existing) {
    if (existing.sha256 !== digest || existing.byte_size !== bytes.length) throw new KnowledgeError("knowledge_part_conflict", 409);
    await readPart(blob, index);
    return { part: index, verified: true };
  }
  if (blob.state !== "uploading") throw new KnowledgeError("knowledge_blob_immutable", 409);
  const client = service();
  const path = knowledgeObjectPath(blob, index);
  const { error } = await client.storage.from(KNOWLEDGE_BUCKET).upload(path, bytes, { contentType: "application/octet-stream", upsert: false });
  // A interrupted upload may have stored the object before its receipt. Never overwrite it.
  if (error && !["409", "400"].includes(String(error.statusCode))) throw new KnowledgeError("knowledge_storage_unavailable");
  const { data: stored, error: readError } = await client.storage.from(KNOWLEDGE_BUCKET).download(path);
  if (readError || !stored) throw new KnowledgeError("knowledge_storage_unavailable");
  const readback = new Uint8Array(await stored.arrayBuffer());
  if (readback.length !== bytes.length || sha256(readback) !== digest) throw new KnowledgeError("knowledge_integrity_failed", 409);
  const { error: commitError } = await client.schema("platform").rpc("kb_storage_verified_v1", {
    p_organization_id: actor.organizationId, p_blob_id: blob.id, p_part_index: index,
    p_sha256: digest, p_byte_size: bytes.length, p_complete: false,
  });
  if (commitError) knowledgeRpcError(commitError);
  return { part: index, verified: true };
}
export async function completeKnowledgeBlob(actor: ActivePlatformActor, blobId: string): Promise<KnowledgeBlob> {
  requireKnowledgeAdmin(actor);
  const blob = await readKnowledgeBlob(actor, blobId);
  if (blob.state === "ready") return blob;
  if (blob.area === "secrets") throw new KnowledgeError("knowledge_encrypted_operation_required", 400);
  const count = Math.ceil(blob.byte_size / KNOWLEDGE_PART_SIZE);
  if (blob.parts?.length !== count) throw new KnowledgeError("knowledge_blob_not_ready", 409);
  const digest = createHash("sha256");
  let size = 0;
  const scan = blob.area !== "raw" && blob.byte_size <= 25 * 1024 * 1024 && blob.byte_size > 0;
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < count; index++) {
    const bytes = await readPart(blob, index);
    size += bytes.length;
    digest.update(bytes);
    if (scan) chunks.push(bytes);
  }
  const fullSha = digest.digest("hex");
  if (size !== blob.byte_size || fullSha !== blob.sha256) throw new KnowledgeError("knowledge_integrity_failed", 409);
  if (scan) {
    const proof = await scanBytesWithClamd(Buffer.concat(chunks));
    if (proof.sha256Hex !== fullSha) throw new KnowledgeError("knowledge_integrity_failed", 409);
  }
  const { data, error } = await service().schema("platform").rpc("kb_storage_verified_v1", {
    p_organization_id: actor.organizationId, p_blob_id: blob.id, p_part_index: null,
    p_sha256: fullSha, p_byte_size: size, p_complete: true, p_scan_status: scan ? "clean" : "opaque",
  });
  if (error) knowledgeRpcError(error);
  return checkedBlob(data, actor.organizationId);
}
/** O(8 MiB) memory; invalid parts abort the response, never become a successful download. */
export async function* knowledgeBlobBytes(blob: KnowledgeBlob): AsyncGenerator<Uint8Array> {
  if (blob.state !== "ready") throw new KnowledgeError("knowledge_blob_not_ready", 409);
  const digest = createHash("sha256");
  let size = 0;
  const count = Math.ceil(blob.byte_size / KNOWLEDGE_PART_SIZE);
  if (blob.parts?.length !== count) throw new KnowledgeError("knowledge_integrity_failed", 409);
  for (let index = 0; index < count; index++) {
    const bytes = await readPart(blob, index);
    digest.update(bytes); size += bytes.length;
    yield bytes;
  }
  if (size !== blob.byte_size || digest.digest("hex") !== blob.sha256) throw new KnowledgeError("knowledge_integrity_failed", 409);
}
export function knowledgeBlobStream(blob: KnowledgeBlob): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(knowledgeBlobBytes(blob))) as ReadableStream<Uint8Array>;
}

/** Only called after SOPS authentication and envelope validation by the protected importer. */
export async function persistKnowledgeCiphertext(actor: ActivePlatformActor, ciphertext: Buffer) {
  requireKnowledgeAdmin(actor);
  const hash = sha256(ciphertext);
  const reservation = await runKnowledgeCommand(actor, randomUUID(), { op: "reserve_blob", area: "secrets", sha256: hash, byteSize: ciphertext.length });
  const blob = checkedBlob(reservation, actor.organizationId);
  for (let offset = 0, index = 0; offset < ciphertext.length; offset += KNOWLEDGE_PART_SIZE, index++) {
    await persistPart(actor, blob.id, index, ciphertext.subarray(offset, offset + KNOWLEDGE_PART_SIZE), true);
  }
  const result = await service().schema("platform").rpc("kb_storage_verified_v1", {
    p_organization_id: actor.organizationId, p_blob_id: blob.id, p_part_index: null,
    p_sha256: hash, p_byte_size: ciphertext.length, p_complete: true, p_scan_status: "opaque",
  });
  if (result.error) knowledgeRpcError(result.error);
  return checkedBlob(result.data, actor.organizationId);
}
