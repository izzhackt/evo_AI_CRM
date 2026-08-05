import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLATFORM_DOCUMENT_BUCKET,
  PlatformDocumentIntakeError,
  normalizePlatformDocumentUploadMetadata,
  reservePlatformDocumentUpload,
  sha256PlatformDocumentBytes,
  type PlatformDocumentUploadMetadata,
  type PlatformDocumentUploadReservation,
} from "../platform-document-intake.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

type RecordValue = Record<string, unknown>;

export type PlatformDocumentFinalization = Readonly<{
  organizationId: string;
  studentCaseId: string;
  documentSlotId: string;
  documentVersionId: string;
  uploadReservationId: string;
  bucketId: typeof PLATFORM_DOCUMENT_BUCKET;
  objectName: string;
  objectCreatedAt: string;
  finalizedAt: string;
  publishedVersionNo: number;
}>;

export type PlatformDocumentValidationWork = Readonly<{
  organizationId: string;
  workItemId: string;
  documentVersionId: string;
  kind: "document_validation";
  state: string;
  deduplicated: boolean;
}>;

export type PlatformDocumentFinalizedIntake = Readonly<{
  reservation: PlatformDocumentUploadReservation;
  finalization: PlatformDocumentFinalization;
  validationWork: PlatformDocumentValidationWork;
}>;

export type PlatformDocumentSignedDownload = Readonly<{
  documentVersionId: string;
  grantId: string;
  consumptionId: string;
  expiresAt: string;
  signedUrl: string;
}>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function serviceFailure(
  message: string,
  error?: unknown,
): PlatformDocumentIntakeError {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (code === "42501") {
    return new PlatformDocumentIntakeError("forbidden", message, false);
  }
  if (code === "23505" || code === "40001" || code === "PT409") {
    return new PlatformDocumentIntakeError(
      "conflict",
      "The document changed concurrently. Refresh and try again.",
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
  return new PlatformDocumentIntakeError("unavailable", message, true);
}

function requireUuid(value: string, label: string): string {
  if (!isUuid(value)) {
    throw new PlatformDocumentIntakeError(
      "invalid_input",
      `${label} is invalid.`,
      false,
    );
  }
  return value.toLowerCase();
}

function parseFinalization(value: unknown): PlatformDocumentFinalization {
  if (
    !isRecord(value) ||
    !isUuid(value.organization_id) ||
    !isUuid(value.student_case_id) ||
    !isUuid(value.document_slot_id) ||
    !isUuid(value.document_version_id) ||
    !isUuid(value.upload_reservation_id) ||
    value.bucket_id !== PLATFORM_DOCUMENT_BUCKET ||
    typeof value.object_name !== "string" ||
    !/^[0-9a-f]{2}\/[0-9a-f]{62}$/.test(value.object_name) ||
    !isTimestamp(value.object_created_at) ||
    !isTimestamp(value.finalized_at) ||
    typeof value.published_version_no !== "number" ||
    !Number.isSafeInteger(value.published_version_no) ||
    value.published_version_no < 1 ||
    value.document_slot_published !== true
  ) {
    throw new PlatformDocumentIntakeError(
      "response_invalid",
      "The finalization receipt is invalid.",
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
    objectCreatedAt: value.object_created_at,
    finalizedAt: value.finalized_at,
    publishedVersionNo: value.published_version_no,
  });
}

function parseValidationWork(value: unknown): PlatformDocumentValidationWork {
  if (
    !isRecord(value) ||
    !isUuid(value.organization_id) ||
    !isUuid(value.work_item_id) ||
    !isUuid(value.source_document_version_id) ||
    value.kind !== "document_validation" ||
    typeof value.state !== "string" ||
    typeof value.deduplicated !== "boolean"
  ) {
    throw new PlatformDocumentIntakeError(
      "response_invalid",
      "The validation work receipt is invalid.",
      true,
    );
  }
  return Object.freeze({
    organizationId: value.organization_id,
    workItemId: value.work_item_id,
    documentVersionId: value.source_document_version_id,
    kind: value.kind,
    state: value.state,
    deduplicated: value.deduplicated,
  });
}

async function validationBusinessKey(
  metadata: PlatformDocumentUploadMetadata,
  documentVersionId: string,
): Promise<string> {
  const canonical = [
    "evo-document-validation-v1",
    metadata.organizationId,
    documentVersionId,
    metadata.sha256Hex,
  ].join(":");
  return sha256PlatformDocumentBytes(new TextEncoder().encode(canonical));
}

export async function finalizeAndQueuePlatformDocumentUpload(input: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  metadata: PlatformDocumentUploadMetadata;
  uploadReservationId: string;
  finalizeRequestId: string;
  enqueueRequestId: string;
  maxAttempts?: number;
}): Promise<PlatformDocumentFinalizedIntake> {
  const metadata = normalizePlatformDocumentUploadMetadata(input.metadata);
  const uploadReservationId = requireUuid(
    input.uploadReservationId,
    "Upload reservation",
  );
  const finalizeRequestId = requireUuid(input.finalizeRequestId, "Finalization request");
  const enqueueRequestId = requireUuid(input.enqueueRequestId, "Queue request");
  const maxAttempts = input.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new PlatformDocumentIntakeError(
      "invalid_input",
      "The validation retry budget is invalid.",
      false,
    );
  }

  // Replaying the original authenticated reservation proves that the current
  // caller owns this exact capability before the service client is used.
  const reservation = await reservePlatformDocumentUpload(
    input.userClient,
    metadata,
  );
  if (reservation.uploadReservationId !== uploadReservationId) {
    throw new PlatformDocumentIntakeError(
      "forbidden",
      "This upload reservation is unavailable for the current account.",
      false,
    );
  }
  if (!reservation.storageObjectPresent && !reservation.documentSlotPublished) {
    throw new PlatformDocumentIntakeError(
      "conflict",
      "The reserved private object has not finished uploading.",
      true,
    );
  }

  const finalized = await input.serviceClient
    .schema("platform")
    .rpc("finalize_document_upload", {
      p_organization_id: metadata.organizationId,
      p_upload_reservation_id: uploadReservationId,
      p_request_id: finalizeRequestId,
    });
  if (finalized.error) {
    throw serviceFailure("The uploaded document could not be finalized.", finalized.error);
  }
  const finalization = parseFinalization(finalized.data);
  if (
    finalization.organizationId !== metadata.organizationId ||
    finalization.documentSlotId !== metadata.documentSlotId ||
    finalization.documentVersionId !== reservation.documentVersionId ||
    finalization.uploadReservationId !== reservation.uploadReservationId ||
    finalization.bucketId !== reservation.bucketId ||
    finalization.objectName !== reservation.objectName
  ) {
    throw new PlatformDocumentIntakeError(
      "response_invalid",
      "The finalization receipt does not match the reservation.",
      true,
    );
  }

  const queued = await input.serviceClient
    .schema("platform")
    .rpc("enqueue_document_validation_work", {
      p_organization_id: metadata.organizationId,
      p_document_version_id: finalization.documentVersionId,
      p_business_key_sha256: await validationBusinessKey(
        metadata,
        finalization.documentVersionId,
      ),
      p_max_attempts: maxAttempts,
      p_request_id: enqueueRequestId,
    });
  if (queued.error) {
    // Finalization is intentionally not rolled back. Repeating this operation
    // safely replays finalization and enqueues the same business key.
    throw serviceFailure(
      "The document is stored but validation could not be queued. Retry safely.",
      queued.error,
    );
  }
  const validationWork = parseValidationWork(queued.data);
  if (
    validationWork.organizationId !== metadata.organizationId ||
    validationWork.documentVersionId !== finalization.documentVersionId
  ) {
    throw new PlatformDocumentIntakeError(
      "response_invalid",
      "The validation receipt does not match the finalized document.",
      true,
    );
  }

  return Object.freeze({ reservation, finalization, validationWork });
}

function boundedPurpose(value: string): string {
  const purpose = value.trim();
  if (
    purpose.length < 1 ||
    purpose.length > 255 ||
    new TextEncoder().encode(purpose).byteLength > 1024 ||
    CONTROL_CHARACTER_PATTERN.test(purpose)
  ) {
    throw new PlatformDocumentIntakeError(
      "invalid_input",
      "A bounded download purpose is required.",
      false,
    );
  }
  return purpose;
}

export async function createPlatformDocumentSignedDownload(input: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  organizationId: string;
  documentVersionId: string;
  accessPurpose: string;
  expiresInSeconds?: number;
  grantRequestId: string;
  consumeRequestId: string;
}): Promise<PlatformDocumentSignedDownload> {
  const organizationId = requireUuid(input.organizationId, "Organization");
  const documentVersionId = requireUuid(input.documentVersionId, "Document version");
  const grantRequestId = requireUuid(input.grantRequestId, "Download grant request");
  const consumeRequestId = requireUuid(
    input.consumeRequestId,
    "Download consumption request",
  );
  const expiresInSeconds = input.expiresInSeconds ?? 45;
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > 60
  ) {
    throw new PlatformDocumentIntakeError(
      "invalid_input",
      "Download lifetime must be between 1 and 60 seconds.",
      false,
    );
  }

  const granted = await input.userClient
    .schema("platform")
    .rpc("grant_document_download", {
      p_organization_id: organizationId,
      p_document_version_id: documentVersionId,
      p_access_purpose: boundedPurpose(input.accessPurpose),
      p_expires_in_seconds: expiresInSeconds,
      p_request_id: grantRequestId,
    });
  if (granted.error) {
    throw serviceFailure("The document download is unavailable.", granted.error);
  }
  if (
    !isRecord(granted.data) ||
    !isUuid(granted.data.document_download_grant_id) ||
    !isTimestamp(granted.data.expires_at) ||
    granted.data.signed_url !== null ||
    granted.data.storage_api_service_sign_required !== true
  ) {
    throw new PlatformDocumentIntakeError(
      "response_invalid",
      "The download grant response is invalid.",
      true,
    );
  }

  const consumed = await input.serviceClient
    .schema("platform")
    .rpc("consume_document_download_grant", {
      p_document_download_grant_id: granted.data.document_download_grant_id,
      p_request_id: consumeRequestId,
    });
  if (consumed.error) {
    throw serviceFailure("The document download grant could not be consumed.", consumed.error);
  }
  if (
    !isRecord(consumed.data) ||
    consumed.data.organization_id !== organizationId ||
    consumed.data.document_version_id !== documentVersionId ||
    consumed.data.document_download_grant_id !==
      granted.data.document_download_grant_id ||
    !isUuid(consumed.data.document_download_consumption_id) ||
    consumed.data.bucket_id !== PLATFORM_DOCUMENT_BUCKET ||
    typeof consumed.data.object_name !== "string" ||
    !/^[0-9a-f]{2}\/[0-9a-f]{62}$/.test(consumed.data.object_name) ||
    typeof consumed.data.max_signed_url_expires_in_seconds !== "number" ||
    !Number.isInteger(consumed.data.max_signed_url_expires_in_seconds) ||
    consumed.data.max_signed_url_expires_in_seconds < 1 ||
    consumed.data.max_signed_url_expires_in_seconds > 60 ||
    !isTimestamp(consumed.data.grant_expires_at)
  ) {
    throw new PlatformDocumentIntakeError(
      "response_invalid",
      "The download consumption response is invalid.",
      true,
    );
  }

  const signed = await input.serviceClient.storage
    .from(consumed.data.bucket_id)
    .createSignedUrl(
      consumed.data.object_name,
      consumed.data.max_signed_url_expires_in_seconds,
    );
  if (signed.error || !signed.data || typeof signed.data.signedUrl !== "string") {
    throw serviceFailure("The private download URL could not be signed.", signed.error);
  }
  if (
    signed.data.signedUrl.length > 4096 ||
    CONTROL_CHARACTER_PATTERN.test(signed.data.signedUrl)
  ) {
    throw new PlatformDocumentIntakeError(
      "response_invalid",
      "The signed download response is invalid.",
      true,
    );
  }

  return Object.freeze({
    documentVersionId,
    grantId: granted.data.document_download_grant_id,
    consumptionId: consumed.data.document_download_consumption_id,
    expiresAt: consumed.data.grant_expires_at,
    signedUrl: signed.data.signedUrl,
  });
}
