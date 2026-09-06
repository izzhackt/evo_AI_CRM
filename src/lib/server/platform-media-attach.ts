import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  ClamdScanError,
  isClamdMalwareScanProof,
  scanBytesWithClamd,
  type ClamdMalwareScanProof,
} from "./clamd-malware-scanner.ts";
import {
  getPlatformSupabaseBackendConfig,
  type PlatformSupabaseBackendConfig,
} from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

/**
 * Server-only bridge from one archived WhatsApp media object to one canonical
 * private case-document version. The authenticated browser call creates only
 * an intent; service credentials, bytes, Storage paths and scan receipts stay
 * behind this boundary.
 */

const MEDIA_BUCKET_ID = "platform-whatsapp-media";
const DOCUMENT_BUCKET_ID = "platform-documents";
export const STANDARD_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const TUS_VERSION = "1.0.0";
const TUS_REQUEST_TIMEOUT_MS = 60_000;
const MAX_TUS_RECOVERY_ATTEMPTS = 3;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_NAME_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{62}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1F\x7F]/;
const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

export type PlatformMediaAttachDependencies = Readonly<{
  createUserClient(): Promise<SupabaseClient>;
  createServiceClient(): SupabaseClient;
  backendConfig(): PlatformSupabaseBackendConfig;
  fetch(input: string | URL, init: RequestInit): Promise<Response>;
  scanFile(bytes: Uint8Array): Promise<ClamdMalwareScanProof>;
  requestId(): string;
  now(): number;
}>;

export type PlatformMediaAttachActor = Pick<
  ActivePlatformActor,
  "organizationId" | "authUserId"
>;

export type PlatformMediaAttachInput = Readonly<{
  conversationId: string;
  communicationMediaId: string;
  studentCaseId: string;
  documentSlotId: string;
  requestId: string;
}>;

export type PlatformMediaAttachFailureCode =
  | "invalid"
  | "forbidden"
  | "unsupported_media"
  | "request_conflict"
  | "upload_in_progress"
  | "rate_limited"
  | "malware_detected"
  | "unavailable";

export type PlatformMediaAttachResult =
  | Readonly<{
      status: "attached";
      studentCaseId: string;
      documentSlotId: string;
      documentVersionId: string;
      versionNumber: number;
      originalFilename: string;
      declaredMimeType: string;
      byteSize: number;
      sha256Hex: string;
    }>
  | Readonly<{ status: "failed"; code: PlatformMediaAttachFailureCode }>;

type AttachIntent = Readonly<{
  attachmentIntentId: string;
  mediaMimeType: string;
  mediaFileName: string;
  mediaFileSizeBytes: number;
  mediaSha256Hex: string;
}>;

type MediaObjectTarget = Readonly<{
  bucketId: typeof MEDIA_BUCKET_ID;
  objectName: string;
}>;

type UploadReservation = Readonly<{
  organizationId: string;
  studentCaseId: string;
  documentSlotId: string;
  documentVersionId: string;
  versionNumber: number;
  uploadReservationId: string;
  storageBindingId: string;
  bucketId: typeof DOCUMENT_BUCKET_ID;
  objectName: string;
  expiresAt: string;
  storageObjectPresent: boolean;
}>;

type CompletionReceipt = Readonly<{
  documentVersionId: string;
  versionNumber: number;
  uploadFinalizationId: string;
  malwareScanAttestationId: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function uuid(value: unknown): string | null {
  return typeof value === "string"
    && value === value.toLowerCase()
    && UUID_PATTERN.test(value)
    ? value
    : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return value;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function safeFilename(value: unknown): string | null {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 255
    || value !== value.trim()
    || CONTROL_CHARACTER_PATTERN.test(value)
    || value.includes("/")
    || value.includes("\\")
  ) {
    return null;
  }
  return value;
}

function matchesDeclaredFileSignature(
  mimeType: string,
  bytes: Uint8Array,
): boolean {
  if (mimeType === "application/pdf") {
    return bytes.length >= 5
      && bytes[0] === 0x25
      && bytes[1] === 0x50
      && bytes[2] === 0x44
      && bytes[3] === 0x46
      && bytes[4] === 0x2d;
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
  }
  return mimeType === "image/png"
    && bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function rpcErrorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function rpcErrorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === "string"
    ? error.message
    : "";
}

function failure(code: PlatformMediaAttachFailureCode): PlatformMediaAttachResult {
  return Object.freeze({ status: "failed" as const, code });
}

function reserveIntentFailure(error: unknown): PlatformMediaAttachResult {
  const code = rpcErrorCode(error);
  if (code === "42501") return failure("forbidden");
  if (code === "23505") return failure("request_conflict");
  if (code === "22023") {
    return /cannot be attached/i.test(rpcErrorMessage(error))
      ? failure("unsupported_media")
      : failure("invalid");
  }
  return failure("unavailable");
}

function uploadMutationFailure(error: unknown): PlatformMediaAttachResult {
  const code = rpcErrorCode(error);
  if (code === "42501") return failure("forbidden");
  if (code === "PT409") return failure("upload_in_progress");
  if (code === "PT429") return failure("rate_limited");
  if (code === "23505") return failure("request_conflict");
  if (code === "22023") return failure("invalid");
  return failure("unavailable");
}

function normalizeAttachIntent(
  value: unknown,
  actor: PlatformMediaAttachActor,
  input: PlatformMediaAttachInput,
): AttachIntent | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "organization_id",
      "conversation_id",
      "communication_media_id",
      "student_case_id",
      "document_slot_id",
      "request_id",
      "attachment_intent_id",
      "media_mime_type",
      "media_file_name",
      "media_file_size_bytes",
      "media_sha256_hex",
      "slot_status",
    ])
  ) {
    return null;
  }
  const attachmentIntentId = uuid(value.attachment_intent_id);
  const mediaFileName = safeFilename(value.media_file_name);
  const mediaFileSizeBytes = positiveInteger(value.media_file_size_bytes);
  if (
    !attachmentIntentId
    || value.organization_id !== actor.organizationId
    || value.conversation_id !== input.conversationId
    || value.communication_media_id !== input.communicationMediaId
    || value.student_case_id !== input.studentCaseId
    || value.document_slot_id !== input.documentSlotId
    || value.request_id !== input.requestId
    || typeof value.media_mime_type !== "string"
    || !ACCEPTED_MIME_TYPES.has(value.media_mime_type)
    || !mediaFileName
    || !mediaFileSizeBytes
    || mediaFileSizeBytes > MAX_FILE_BYTES
    || typeof value.media_sha256_hex !== "string"
    || !SHA256_PATTERN.test(value.media_sha256_hex)
    || typeof value.slot_status !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    attachmentIntentId,
    mediaMimeType: value.media_mime_type,
    mediaFileName,
    mediaFileSizeBytes,
    mediaSha256Hex: value.media_sha256_hex,
  });
}

function normalizeMediaGrant(value: unknown): string | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "media_download_grant_id",
      "expires_at",
      "signed_url",
      "storage_api_service_sign_required",
    ])
  ) {
    return null;
  }
  const grantId = uuid(value.media_download_grant_id);
  return grantId
    && timestamp(value.expires_at)
    && value.signed_url === null
    && value.storage_api_service_sign_required === true
    ? grantId
    : null;
}

function normalizeMediaConsumption(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    grantId: string;
    mediaId: string;
    mimeType: string;
  }>,
): MediaObjectTarget | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "organization_id",
      "media_download_grant_id",
      "media_id",
      "bucket_id",
      "object_name",
      "max_signed_url_expires_in_seconds",
      "mime_type",
      "file_name",
      "signed_url",
    ])
  ) {
    return null;
  }
  if (
    value.organization_id !== expected.organizationId
    || uuid(value.media_download_grant_id) !== expected.grantId
    || value.media_id !== expected.mediaId
    || value.bucket_id !== MEDIA_BUCKET_ID
    || typeof value.object_name !== "string"
    || !OBJECT_NAME_PATTERN.test(value.object_name)
    || !positiveInteger(value.max_signed_url_expires_in_seconds)
    || value.mime_type !== expected.mimeType
    || value.signed_url !== null
  ) {
    return null;
  }
  return Object.freeze({
    bucketId: MEDIA_BUCKET_ID,
    objectName: value.object_name,
  });
}

function normalizeUploadReservation(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    attachmentIntentId: string;
    studentCaseId: string;
    documentSlotId: string;
    mimeType: string;
    byteSize: number;
    sha256Hex: string;
  }>,
): UploadReservation | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "attachment_intent_id",
      "organization_id",
      "student_case_id",
      "document_slot_id",
      "document_version_id",
      "version_number",
      "upload_reservation_id",
      "storage_binding_id",
      "bucket_id",
      "object_name",
      "expires_at",
      "declared_mime_type",
      "byte_size",
      "sha256_hex",
      "storage_object_present",
      "document_slot_published",
    ])
  ) {
    return null;
  }

  const studentCaseId = uuid(value.student_case_id);
  const documentVersionId = uuid(value.document_version_id);
  const uploadReservationId = uuid(value.upload_reservation_id);
  const storageBindingId = uuid(value.storage_binding_id);
  const versionNumber = positiveInteger(value.version_number);
  const expiresAt = timestamp(value.expires_at);
  if (
    value.attachment_intent_id !== expected.attachmentIntentId
    || value.organization_id !== expected.organizationId
    || studentCaseId !== expected.studentCaseId
    || value.document_slot_id !== expected.documentSlotId
    || !documentVersionId
    || !uploadReservationId
    || !storageBindingId
    || !versionNumber
    || value.bucket_id !== DOCUMENT_BUCKET_ID
    || typeof value.object_name !== "string"
    || !OBJECT_NAME_PATTERN.test(value.object_name)
    || !expiresAt
    || value.declared_mime_type !== expected.mimeType
    || positiveInteger(value.byte_size) !== expected.byteSize
    || value.sha256_hex !== expected.sha256Hex
    || typeof value.storage_object_present !== "boolean"
    || value.document_slot_published !== false
  ) {
    return null;
  }

  return Object.freeze({
    organizationId: expected.organizationId,
    studentCaseId,
    documentSlotId: expected.documentSlotId,
    documentVersionId,
    versionNumber,
    uploadReservationId,
    storageBindingId,
    bucketId: DOCUMENT_BUCKET_ID,
    objectName: value.object_name,
    expiresAt,
    storageObjectPresent: value.storage_object_present,
  });
}

function normalizeCompletionReceipt(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    attachmentIntentId: string;
    conversationId: string;
    communicationMediaId: string;
    studentCaseId: string;
    documentSlotId: string;
    documentVersionId: string;
    uploadReservationId: string;
    sha256Hex: string;
  }>,
): CompletionReceipt | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "organization_id",
      "attachment_intent_id",
      "attachment_completion_id",
      "conversation_id",
      "communication_media_id",
      "student_case_id",
      "document_slot_id",
      "document_version_id",
      "version_number",
      "upload_reservation_id",
      "upload_finalization_id",
      "malware_scan_attestation_id",
      "sha256_hex",
      "completed_at",
      "request_id",
    ])
  ) {
    return null;
  }
  const versionNumber = positiveInteger(value.version_number);
  const uploadFinalizationId = uuid(value.upload_finalization_id);
  const malwareScanAttestationId = uuid(value.malware_scan_attestation_id);
  if (
    value.organization_id !== expected.organizationId
    || value.attachment_intent_id !== expected.attachmentIntentId
    || !uuid(value.attachment_completion_id)
    || value.conversation_id !== expected.conversationId
    || value.communication_media_id !== expected.communicationMediaId
    || value.student_case_id !== expected.studentCaseId
    || value.document_slot_id !== expected.documentSlotId
    || value.document_version_id !== expected.documentVersionId
    || !versionNumber
    || value.upload_reservation_id !== expected.uploadReservationId
    || !uploadFinalizationId
    || !malwareScanAttestationId
    || value.sha256_hex !== expected.sha256Hex
    || !timestamp(value.completed_at)
    || !uuid(value.request_id)
  ) {
    return null;
  }
  return Object.freeze({
    documentVersionId: expected.documentVersionId,
    versionNumber,
    uploadFinalizationId,
    malwareScanAttestationId,
  });
}

async function readExactMediaObject(
  serviceClient: SupabaseClient,
  target: MediaObjectTarget,
  expected: Readonly<{ byteSize: number; mimeType: string }>,
): Promise<Uint8Array | null> {
  const downloaded = await serviceClient.storage
    .from(target.bucketId)
    .download(target.objectName);
  if (downloaded.error || !downloaded.data) return null;
  if (
    downloaded.data.size !== expected.byteSize
    || downloaded.data.size < 1
    || downloaded.data.size > MAX_FILE_BYTES
  ) {
    return null;
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  return bytes.byteLength === expected.byteSize
    && matchesDeclaredFileSignature(expected.mimeType, bytes)
    ? bytes
    : null;
}

async function readExactStoredDocument(
  serviceClient: SupabaseClient,
  reservation: UploadReservation,
  expected: Readonly<{ byteSize: number; mimeType: string; sha256Hex: string }>,
): Promise<Uint8Array | null> {
  const downloaded = await serviceClient.storage
    .from(reservation.bucketId)
    .download(reservation.objectName);
  if (downloaded.error || !downloaded.data) return null;
  if (
    downloaded.data.size !== expected.byteSize
    || downloaded.data.type.toLowerCase() !== expected.mimeType
  ) {
    return null;
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const sha256Hex = createHash("sha256").update(bytes).digest("hex");
  return bytes.byteLength === expected.byteSize
    && sha256Hex === expected.sha256Hex
    && matchesDeclaredFileSignature(expected.mimeType, bytes)
    ? bytes
    : null;
}

function tusEndpoint(supabaseUrl: string): URL {
  const base = new URL(supabaseUrl);
  const managedSuffix = ".supabase.co";
  if (
    base.protocol === "https:"
    && base.hostname.endsWith(managedSuffix)
    && base.hostname.length > managedSuffix.length
  ) {
    const projectRef = base.hostname.slice(0, -managedSuffix.length);
    return new URL(
      `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`,
    );
  }
  return new URL("/storage/v1/upload/resumable", base);
}

function tusAuthHeaders(secretKey: string): Readonly<Record<string, string>> {
  const headers: Record<string, string> = { apikey: secretKey };
  if (!secretKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${secretKey}`;
  }
  return headers;
}

function tusMetadata(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value, "utf8").toString("base64")}`)
    .join(",");
}

function exactTusUploadUrl(endpoint: URL, location: string | null): URL | null {
  if (!location) return null;
  let resolved: URL;
  try {
    resolved = new URL(location, endpoint);
  } catch {
    return null;
  }
  const expectedPrefix = endpoint.pathname.endsWith("/")
    ? endpoint.pathname
    : `${endpoint.pathname}/`;
  return resolved.origin === endpoint.origin
    && resolved.pathname.startsWith(expectedPrefix)
    && !resolved.username
    && !resolved.password
    && !resolved.search
    && !resolved.hash
    ? resolved
    : null;
}

function exactOffset(value: string | null, maximum: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= maximum
    ? offset
    : null;
}

function beforeExpiry(expiresAt: string, now: number): boolean {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && now < expiry;
}

/**
 * Minimal server-side TUS client following Supabase's current upload contract:
 * https://supabase.com/docs/guides/storage/uploads/resumable-uploads
 * Standard uploads remain limited to the documented 6 MiB boundary:
 * https://supabase.com/docs/guides/storage/uploads/standard-uploads
 */
async function uploadWithTus(
  bytes: Uint8Array,
  reservation: UploadReservation,
  mimeType: string,
  dependencies: PlatformMediaAttachDependencies,
): Promise<boolean> {
  const config = dependencies.backendConfig();
  const endpoint = tusEndpoint(config.supabaseUrl);
  const authHeaders = tusAuthHeaders(config.supabaseSecretKey);
  if (!beforeExpiry(reservation.expiresAt, dependencies.now())) return false;

  let creation: Response;
  try {
    creation = await dependencies.fetch(endpoint, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Tus-Resumable": TUS_VERSION,
        "Upload-Length": String(bytes.byteLength),
        "Upload-Metadata": tusMetadata({
          bucketName: reservation.bucketId,
          objectName: reservation.objectName,
          contentType: mimeType,
          cacheControl: "0",
        }),
      },
      redirect: "error",
      signal: AbortSignal.timeout(TUS_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return false;
  }
  if (creation.status !== 201) return false;
  const uploadUrl = exactTusUploadUrl(endpoint, creation.headers.get("location"));
  if (!uploadUrl) return false;

  let offset = 0;
  let recoveryAttempts = 0;
  while (offset < bytes.byteLength) {
    if (!beforeExpiry(reservation.expiresAt, dependencies.now())) return false;
    const chunkEnd = Math.min(offset + TUS_CHUNK_BYTES, bytes.byteLength);
    const chunk = bytes.slice(offset, chunkEnd);
    try {
      const response = await dependencies.fetch(uploadUrl, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Tus-Resumable": TUS_VERSION,
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(offset),
        },
        body: chunk,
        redirect: "error",
        signal: AbortSignal.timeout(TUS_REQUEST_TIMEOUT_MS),
      });
      const nextOffset = exactOffset(
        response.headers.get("upload-offset"),
        bytes.byteLength,
      );
      if (response.status === 204 && nextOffset === chunkEnd) {
        offset = nextOffset;
        recoveryAttempts = 0;
        continue;
      }
      if (response.status < 500 && response.status !== 409) return false;
    } catch {
      // A timeout may hide a committed PATCH. HEAD reconciles the one upload
      // URL; a second URL is never created for the immutable reservation path.
    }

    recoveryAttempts += 1;
    if (recoveryAttempts > MAX_TUS_RECOVERY_ATTEMPTS) return false;
    if (!beforeExpiry(reservation.expiresAt, dependencies.now())) return false;
    try {
      const head = await dependencies.fetch(uploadUrl, {
        method: "HEAD",
        headers: {
          ...authHeaders,
          "Tus-Resumable": TUS_VERSION,
        },
        redirect: "error",
        signal: AbortSignal.timeout(TUS_REQUEST_TIMEOUT_MS),
      });
      if (head.status !== 200 && head.status !== 204) return false;
      const serverOffset = exactOffset(
        head.headers.get("upload-offset"),
        bytes.byteLength,
      );
      if (
        serverOffset === null
        || serverOffset < offset
        || serverOffset > chunkEnd
      ) {
        return false;
      }
      offset = serverOffset;
    } catch {
      if (recoveryAttempts >= MAX_TUS_RECOVERY_ATTEMPTS) return false;
    }
  }
  return true;
}

async function writeReservedDocument(
  serviceClient: SupabaseClient,
  reservation: UploadReservation,
  bytes: Uint8Array,
  mimeType: string,
  dependencies: PlatformMediaAttachDependencies,
): Promise<void> {
  if (reservation.storageObjectPresent) return;
  if (!beforeExpiry(reservation.expiresAt, dependencies.now())) return;

  if (bytes.byteLength <= STANDARD_UPLOAD_MAX_BYTES) {
    await serviceClient.storage
      .from(reservation.bucketId)
      .upload(reservation.objectName, bytes, {
        contentType: mimeType,
        cacheControl: "0",
        upsert: false,
      });
    return;
  }
  await uploadWithTus(bytes, reservation, mimeType, dependencies);
}

const defaultDependencies: PlatformMediaAttachDependencies = {
  createUserClient: async () => {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    return createSupabaseServerClient();
  },
  createServiceClient: () =>
    createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
  backendConfig: getPlatformSupabaseBackendConfig,
  fetch: (input, init) => fetch(input, init),
  scanFile: scanBytesWithClamd,
  requestId: randomUUID,
  now: Date.now,
};

export async function attachPlatformMessageMediaToCase(
  actor: PlatformMediaAttachActor,
  input: PlatformMediaAttachInput,
  dependencies: PlatformMediaAttachDependencies = defaultDependencies,
): Promise<PlatformMediaAttachResult> {
  if (
    uuid(actor.organizationId) !== actor.organizationId
    || uuid(actor.authUserId) !== actor.authUserId
    || uuid(input.conversationId) !== input.conversationId
    || uuid(input.communicationMediaId) !== input.communicationMediaId
    || uuid(input.studentCaseId) !== input.studentCaseId
    || uuid(input.documentSlotId) !== input.documentSlotId
    || uuid(input.requestId) !== input.requestId
  ) {
    return failure("invalid");
  }

  try {
    const userClient = await dependencies.createUserClient();
    const intentResponse = await userClient.schema("platform").rpc(
      "reserve_message_media_attachment",
      {
        p_conversation_id: input.conversationId,
        p_communication_media_id: input.communicationMediaId,
        p_student_case_id: input.studentCaseId,
        p_document_slot_id: input.documentSlotId,
        p_request_id: input.requestId,
      },
    );
    if (intentResponse.error) {
      return reserveIntentFailure(intentResponse.error);
    }
    const intent = normalizeAttachIntent(intentResponse.data, actor, input);
    if (!intent) return failure("unavailable");

    // A consumed media grant is never reused. The durable intent and the two
    // intent-owned upload request IDs still make the mutation chain replayable.
    const grantResponse = await userClient.schema("platform").rpc(
      "grant_communication_media_download",
      {
        p_organization_id: actor.organizationId,
        p_media_id: input.communicationMediaId,
        p_request_id: dependencies.requestId(),
      },
    );
    if (grantResponse.error) {
      return rpcErrorCode(grantResponse.error) === "42501"
        ? failure("forbidden")
        : failure("unavailable");
    }
    const grantId = normalizeMediaGrant(grantResponse.data);
    if (!grantId) return failure("unavailable");

    const serviceClient = dependencies.createServiceClient();
    const consumptionResponse = await serviceClient.schema("platform").rpc(
      "consume_communication_media_download_grant",
      {
        p_media_download_grant_id: grantId,
        p_request_id: dependencies.requestId(),
      },
    );
    if (consumptionResponse.error) return failure("unavailable");
    const mediaTarget = normalizeMediaConsumption(consumptionResponse.data, {
      organizationId: actor.organizationId,
      grantId,
      mediaId: input.communicationMediaId,
      mimeType: intent.mediaMimeType,
    });
    if (!mediaTarget) return failure("unavailable");

    const bytes = await readExactMediaObject(serviceClient, mediaTarget, {
      byteSize: intent.mediaFileSizeBytes,
      mimeType: intent.mediaMimeType,
    });
    if (!bytes) return failure("unavailable");
    const sha256Hex = createHash("sha256").update(bytes).digest("hex");
    if (sha256Hex !== intent.mediaSha256Hex) return failure("unavailable");

    let ingressScanProof: ClamdMalwareScanProof;
    try {
      ingressScanProof = await dependencies.scanFile(bytes);
    } catch (error) {
      if (error instanceof ClamdScanError && error.code === "infected") {
        return failure("malware_detected");
      }
      return failure("unavailable");
    }
    if (!isClamdMalwareScanProof(ingressScanProof, sha256Hex)) {
      return failure("unavailable");
    }

    const reservationResponse = await serviceClient.schema("platform").rpc(
      "reserve_message_media_attachment_upload",
      {
        p_attachment_intent_id: intent.attachmentIntentId,
        p_scan_result: "clean",
        p_scanner_engine: ingressScanProof.engine,
        p_scanner_engine_version: ingressScanProof.engineVersion,
        p_scanner_signature_version: ingressScanProof.signatureVersion,
        p_scanner_protocol: ingressScanProof.protocol,
        p_scanned_at: ingressScanProof.scannedAt,
      },
    );
    if (reservationResponse.error) {
      return uploadMutationFailure(reservationResponse.error);
    }
    const reservation = normalizeUploadReservation(reservationResponse.data, {
      organizationId: actor.organizationId,
      attachmentIntentId: intent.attachmentIntentId,
      studentCaseId: input.studentCaseId,
      documentSlotId: input.documentSlotId,
      mimeType: intent.mediaMimeType,
      byteSize: bytes.byteLength,
      sha256Hex,
    });
    if (!reservation) return failure("unavailable");

    await writeReservedDocument(
      serviceClient,
      reservation,
      bytes,
      intent.mediaMimeType,
      dependencies,
    );
    const storedBytes = await readExactStoredDocument(
      serviceClient,
      reservation,
      {
        byteSize: bytes.byteLength,
        mimeType: intent.mediaMimeType,
        sha256Hex,
      },
    );
    if (!storedBytes) return failure("unavailable");
    if (!beforeExpiry(reservation.expiresAt, dependencies.now())) {
      return failure("unavailable");
    }

    let storedScanProof: ClamdMalwareScanProof;
    try {
      storedScanProof = await dependencies.scanFile(storedBytes);
    } catch (error) {
      if (error instanceof ClamdScanError && error.code === "infected") {
        return failure("malware_detected");
      }
      return failure("unavailable");
    }
    if (!isClamdMalwareScanProof(storedScanProof, sha256Hex)) {
      return failure("unavailable");
    }

    const completionResponse = await serviceClient.schema("platform").rpc(
      "complete_message_media_attachment",
      {
        p_attachment_intent_id: intent.attachmentIntentId,
        p_upload_reservation_id: reservation.uploadReservationId,
        p_scanner_engine: storedScanProof.engine,
        p_scanner_engine_version: storedScanProof.engineVersion,
        p_scanner_signature_version: storedScanProof.signatureVersion,
        p_scanner_protocol: storedScanProof.protocol,
        p_scanned_at: storedScanProof.scannedAt,
      },
    );
    if (completionResponse.error) {
      return uploadMutationFailure(completionResponse.error);
    }
    const completion = normalizeCompletionReceipt(completionResponse.data, {
      organizationId: actor.organizationId,
      attachmentIntentId: intent.attachmentIntentId,
      conversationId: input.conversationId,
      communicationMediaId: input.communicationMediaId,
      studentCaseId: input.studentCaseId,
      documentSlotId: input.documentSlotId,
      documentVersionId: reservation.documentVersionId,
      uploadReservationId: reservation.uploadReservationId,
      sha256Hex,
    });
    if (!completion) return failure("unavailable");

    return Object.freeze({
      status: "attached" as const,
      studentCaseId: reservation.studentCaseId,
      documentSlotId: reservation.documentSlotId,
      documentVersionId: completion.documentVersionId,
      versionNumber: completion.versionNumber,
      originalFilename: intent.mediaFileName,
      declaredMimeType: intent.mediaMimeType,
      byteSize: bytes.byteLength,
      sha256Hex,
    });
  } catch {
    return failure("unavailable");
  }
}
