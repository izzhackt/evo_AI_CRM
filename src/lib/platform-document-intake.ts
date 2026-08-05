import type { SupabaseClient } from "@supabase/supabase-js";

export const PLATFORM_DOCUMENT_BUCKET = "platform-documents";
export const PLATFORM_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const PLATFORM_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type PlatformDocumentMimeType =
  (typeof PLATFORM_DOCUMENT_MIME_TYPES)[number];

export type PlatformDocumentUploadMetadata = Readonly<{
  organizationId: string;
  documentSlotId: string;
  originalFilename: string;
  declaredMimeType: PlatformDocumentMimeType;
  byteSize: number;
  sha256Hex: string;
  requestId: string;
}>;

export type PlatformDocumentUploadReservation = Readonly<{
  organizationId: string;
  studentCaseId: string;
  documentSlotId: string;
  documentVersionId: string;
  uploadReservationId: string;
  bucketId: typeof PLATFORM_DOCUMENT_BUCKET;
  objectName: string;
  expiresAt: string;
  declaredMimeType: PlatformDocumentMimeType;
  byteSize: number;
  sha256Hex: string;
  storageObjectPresent: boolean;
  documentSlotPublished: boolean;
}>;

export type PlatformDocumentUploadPreparation = Readonly<{
  metadata: PlatformDocumentUploadMetadata;
  bytes: Blob;
}>;

export type PlatformDocumentIntakeErrorCode =
  | "invalid_input"
  | "forbidden"
  | "conflict"
  | "rate_limited"
  | "reservation_expired"
  | "upload_failed"
  | "upload_outcome_unknown"
  | "response_invalid"
  | "unavailable";

export class PlatformDocumentIntakeError extends Error {
  readonly code: PlatformDocumentIntakeErrorCode;
  readonly retryable: boolean;

  constructor(
    code: PlatformDocumentIntakeErrorCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "PlatformDocumentIntakeError";
    this.code = code;
    this.retryable = retryable;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OBJECT_NAME_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{62}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isMimeType(value: unknown): value is PlatformDocumentMimeType {
  return (
    typeof value === "string" &&
    (PLATFORM_DOCUMENT_MIME_TYPES as readonly string[]).includes(value)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function normalizeFilename(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 255 ||
    new TextEncoder().encode(normalized).byteLength > 1024 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new PlatformDocumentIntakeError(
      "invalid_input",
      "Choose a file with a valid bounded filename.",
      false,
    );
  }
  return normalized;
}

function normalizeMimeType(value: string): PlatformDocumentMimeType {
  const normalized = value.trim().toLowerCase();
  if (!isMimeType(normalized)) {
    throw new PlatformDocumentIntakeError(
      "invalid_input",
      "Only PDF, JPEG, and PNG files are supported.",
      false,
    );
  }
  return normalized;
}

export function normalizePlatformDocumentUploadMetadata(
  input: PlatformDocumentUploadMetadata,
): PlatformDocumentUploadMetadata {
  if (
    !isUuid(input.organizationId) ||
    !isUuid(input.documentSlotId) ||
    !isUuid(input.requestId) ||
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > PLATFORM_DOCUMENT_MAX_BYTES ||
    !isSha256(input.sha256Hex.toLowerCase())
  ) {
    throw new PlatformDocumentIntakeError(
      "invalid_input",
      "Complete bounded upload metadata is required.",
      false,
    );
  }

  return Object.freeze({
    organizationId: input.organizationId.toLowerCase(),
    documentSlotId: input.documentSlotId.toLowerCase(),
    originalFilename: normalizeFilename(input.originalFilename),
    declaredMimeType: normalizeMimeType(input.declaredMimeType),
    byteSize: input.byteSize,
    sha256Hex: input.sha256Hex.toLowerCase(),
    requestId: input.requestId.toLowerCase(),
  });
}

export async function sha256PlatformDocumentBytes(
  bytes: Blob | ArrayBuffer | Uint8Array,
): Promise<string> {
  let buffer: ArrayBuffer;
  if (bytes instanceof Blob) {
    if (bytes.size < 1 || bytes.size > PLATFORM_DOCUMENT_MAX_BYTES) {
      throw new PlatformDocumentIntakeError(
        "invalid_input",
        "The file must be between 1 byte and 25 MiB.",
        false,
      );
    }
    buffer = await bytes.arrayBuffer();
  } else if (bytes instanceof Uint8Array) {
    if (bytes.byteLength < 1 || bytes.byteLength > PLATFORM_DOCUMENT_MAX_BYTES) {
      throw new PlatformDocumentIntakeError(
        "invalid_input",
        "The file must be between 1 byte and 25 MiB.",
        false,
      );
    }
    buffer = bytes.slice().buffer;
  } else {
    if (bytes.byteLength < 1 || bytes.byteLength > PLATFORM_DOCUMENT_MAX_BYTES) {
      throw new PlatformDocumentIntakeError(
        "invalid_input",
        "The file must be between 1 byte and 25 MiB.",
        false,
      );
    }
    buffer = bytes.slice(0);
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function preparePlatformDocumentUpload(input: {
  organizationId: string;
  documentSlotId: string;
  originalFilename: string;
  declaredMimeType: string;
  requestId: string;
  bytes: Blob;
}): Promise<PlatformDocumentUploadPreparation> {
  const byteSize = input.bytes.size;
  const sha256Hex = await sha256PlatformDocumentBytes(input.bytes);
  const metadata = normalizePlatformDocumentUploadMetadata({
    organizationId: input.organizationId,
    documentSlotId: input.documentSlotId,
    originalFilename: input.originalFilename,
    declaredMimeType: normalizeMimeType(input.declaredMimeType),
    byteSize,
    sha256Hex,
    requestId: input.requestId,
  });

  if (input.bytes.type && normalizeMimeType(input.bytes.type) !== metadata.declaredMimeType) {
    throw new PlatformDocumentIntakeError(
      "invalid_input",
      "The selected file type changed before upload.",
      false,
    );
  }

  return Object.freeze({ metadata, bytes: input.bytes });
}

function rpcError(error: unknown): PlatformDocumentIntakeError {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (code === "42501") {
    return new PlatformDocumentIntakeError(
      "forbidden",
      "This document is unavailable for the current account.",
      false,
    );
  }
  if (code === "PT409" || code === "23505" || code === "40001") {
    return new PlatformDocumentIntakeError(
      "conflict",
      "The document changed concurrently. Refresh and try again.",
      true,
    );
  }
  if (code === "PT429") {
    return new PlatformDocumentIntakeError(
      "rate_limited",
      "Too many document requests. Wait before trying again.",
      true,
    );
  }
  if (code === "22023") {
    return new PlatformDocumentIntakeError(
      "invalid_input",
      "The document request is invalid.",
      false,
    );
  }
  return new PlatformDocumentIntakeError(
    "unavailable",
    "The private document service is unavailable.",
    true,
  );
}

export function parsePlatformDocumentUploadReservation(
  value: unknown,
): PlatformDocumentUploadReservation {
  if (!isRecord(value)) {
    throw new PlatformDocumentIntakeError(
      "response_invalid",
      "The upload reservation response is invalid.",
      true,
    );
  }

  const byteSize = value.byte_size;
  if (
    !isUuid(value.organization_id) ||
    !isUuid(value.student_case_id) ||
    !isUuid(value.document_slot_id) ||
    !isUuid(value.document_version_id) ||
    !isUuid(value.upload_reservation_id) ||
    value.bucket_id !== PLATFORM_DOCUMENT_BUCKET ||
    typeof value.object_name !== "string" ||
    !OBJECT_NAME_PATTERN.test(value.object_name) ||
    !isIsoTimestamp(value.expires_at) ||
    !isMimeType(value.declared_mime_type) ||
    typeof byteSize !== "number" ||
    !Number.isSafeInteger(byteSize) ||
    byteSize < 1 ||
    byteSize > PLATFORM_DOCUMENT_MAX_BYTES ||
    !isSha256(value.sha256_hex) ||
    typeof value.storage_object_present !== "boolean" ||
    typeof value.document_slot_published !== "boolean"
  ) {
    throw new PlatformDocumentIntakeError(
      "response_invalid",
      "The upload reservation response is invalid.",
      true,
    );
  }

  return Object.freeze({
    organizationId: value.organization_id,
    studentCaseId: value.student_case_id,
    documentSlotId: value.document_slot_id,
    documentVersionId: value.document_version_id,
    uploadReservationId: value.upload_reservation_id,
    bucketId: value.bucket_id,
    objectName: value.object_name,
    expiresAt: value.expires_at,
    declaredMimeType: value.declared_mime_type,
    byteSize,
    sha256Hex: value.sha256_hex,
    storageObjectPresent: value.storage_object_present,
    documentSlotPublished: value.document_slot_published,
  });
}

export async function reservePlatformDocumentUpload(
  client: SupabaseClient,
  input: PlatformDocumentUploadMetadata,
): Promise<PlatformDocumentUploadReservation> {
  const metadata = normalizePlatformDocumentUploadMetadata(input);
  const response = await client.schema("platform").rpc("reserve_document_upload", {
    p_organization_id: metadata.organizationId,
    p_document_slot_id: metadata.documentSlotId,
    p_original_filename: metadata.originalFilename,
    p_declared_mime_type: metadata.declaredMimeType,
    p_byte_size: metadata.byteSize,
    p_sha256_hex: metadata.sha256Hex,
    p_request_id: metadata.requestId,
  });

  if (response.error) throw rpcError(response.error);
  const reservation = parsePlatformDocumentUploadReservation(response.data);
  if (
    reservation.organizationId !== metadata.organizationId ||
    reservation.documentSlotId !== metadata.documentSlotId ||
    reservation.declaredMimeType !== metadata.declaredMimeType ||
    reservation.byteSize !== metadata.byteSize ||
    reservation.sha256Hex !== metadata.sha256Hex
  ) {
    throw new PlatformDocumentIntakeError(
      "response_invalid",
      "The upload reservation does not match the requested file.",
      true,
    );
  }
  return reservation;
}

export async function uploadReservedPlatformDocument(
  client: SupabaseClient,
  reservation: PlatformDocumentUploadReservation,
  bytes: Blob,
): Promise<void> {
  if (reservation.documentSlotPublished || reservation.storageObjectPresent) {
    return;
  }
  if (Date.parse(reservation.expiresAt) <= Date.now()) {
    throw new PlatformDocumentIntakeError(
      "reservation_expired",
      "The upload reservation expired. Reserve the file again.",
      true,
    );
  }
  if (
    bytes.size !== reservation.byteSize ||
    (bytes.type && normalizeMimeType(bytes.type) !== reservation.declaredMimeType) ||
    (await sha256PlatformDocumentBytes(bytes)) !== reservation.sha256Hex
  ) {
    throw new PlatformDocumentIntakeError(
      "invalid_input",
      "The selected file no longer matches its reservation.",
      false,
    );
  }

  const response = await client.storage
    .from(reservation.bucketId)
    .upload(reservation.objectName, bytes, {
      cacheControl: "0",
      contentType: reservation.declaredMimeType,
      upsert: false,
    });
  if (response.error) {
    throw new PlatformDocumentIntakeError(
      "upload_outcome_unknown",
      "The upload result is uncertain. Reconcile the reservation before retrying.",
      true,
    );
  }
  if (
    !response.data ||
    typeof response.data.path !== "string" ||
    response.data.path !== reservation.objectName
  ) {
    throw new PlatformDocumentIntakeError(
      "upload_failed",
      "Private Storage returned an invalid upload receipt.",
      true,
    );
  }
}

export function isPlatformDocumentIntakeError(
  error: unknown,
): error is PlatformDocumentIntakeError {
  return error instanceof PlatformDocumentIntakeError;
}
