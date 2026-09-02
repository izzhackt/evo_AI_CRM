import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fixedRoleCan,
  type FixedRoleCapability,
} from "../fixed-role-policy.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const BUCKET_ID = "platform-documents";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_NAME_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{62}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001F\u007F]/;
const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

type DocumentCapability = Extract<
  FixedRoleCapability,
  "documents.read" | "documents.write"
>;

type DocumentAuthorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "unavailable"; actor: null }>;

export type PlatformDocumentStorageRouteDependencies = Readonly<{
  authorize(capability: DocumentCapability): Promise<DocumentAuthorization>;
  createUserClient(): Promise<SupabaseClient>;
  createServiceClient(): SupabaseClient;
  supabaseOrigin(): string;
  requestId(): string;
}>;

type UploadReservation = Readonly<{
  organizationId: string;
  studentCaseId: string;
  documentSlotId: string;
  documentVersionId: string;
  uploadReservationId: string;
  bucketId: typeof BUCKET_ID;
  objectName: string;
  expiresAt: string;
  declaredMimeType: string;
  byteSize: number;
  sha256Hex: string;
  storageObjectPresent: boolean;
  documentSlotPublished: boolean;
}>;

type FinalizedUpload = Readonly<{
  documentVersionId: string;
  documentSlotId: string;
  studentCaseId: string;
  versionNumber: number;
}>;

type ValidationAttestation = Readonly<{
  documentVersionId: string;
}>;

type DownloadGrant = Readonly<{
  id: string;
  expiresAt: string;
}>;

type DownloadConsumption = Readonly<{
  grantId: string;
  bucketId: typeof BUCKET_ID;
  objectName: string;
  maximumLifetimeSeconds: number;
}>;

type RouteContext<Params extends Record<string, string>> = Readonly<{
  params: Promise<Params>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === "00000000-0000-0000-0000-000000000000"
    ? null
    : normalized;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
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

function derivedRequestId(requestId: string, operation: string): string {
  const bytes = createHash("sha256")
    .update(`evo-platform-document:${operation}:${requestId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

function normalizeReservation(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    documentSlotId: string;
    mimeType: string;
    byteSize: number;
    sha256Hex: string;
  }>,
): UploadReservation | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "organization_id",
      "student_case_id",
      "document_slot_id",
      "document_version_id",
      "upload_reservation_id",
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

  const organizationId = uuid(value.organization_id);
  const studentCaseId = uuid(value.student_case_id);
  const documentSlotId = uuid(value.document_slot_id);
  const documentVersionId = uuid(value.document_version_id);
  const uploadReservationId = uuid(value.upload_reservation_id);
  const expiresAt = timestamp(value.expires_at);
  const byteSize = positiveInteger(value.byte_size);
  if (
    organizationId !== expected.organizationId
    || documentSlotId !== expected.documentSlotId
    || !studentCaseId
    || !documentVersionId
    || !uploadReservationId
    || value.bucket_id !== BUCKET_ID
    || typeof value.object_name !== "string"
    || !OBJECT_NAME_PATTERN.test(value.object_name)
    || !expiresAt
    || value.declared_mime_type !== expected.mimeType
    || byteSize !== expected.byteSize
    || value.sha256_hex !== expected.sha256Hex
    || typeof value.storage_object_present !== "boolean"
    || typeof value.document_slot_published !== "boolean"
  ) {
    return null;
  }

  return Object.freeze({
    organizationId,
    studentCaseId,
    documentSlotId,
    documentVersionId,
    uploadReservationId,
    bucketId: BUCKET_ID,
    objectName: value.object_name,
    expiresAt,
    declaredMimeType: expected.mimeType,
    byteSize,
    sha256Hex: expected.sha256Hex,
    storageObjectPresent: value.storage_object_present,
    documentSlotPublished: value.document_slot_published,
  });
}

function normalizeFinalizedUpload(
  value: unknown,
  reservation: UploadReservation,
): FinalizedUpload | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "organization_id",
      "student_case_id",
      "document_slot_id",
      "document_version_id",
      "upload_reservation_id",
      "bucket_id",
      "object_name",
      "object_created_at",
      "finalized_at",
      "published_slot_status",
      "published_version_no",
      "document_slot_published",
    ])
  ) {
    return null;
  }

  const versionNumber = positiveInteger(value.published_version_no);
  if (
    value.organization_id !== reservation.organizationId
    || value.student_case_id !== reservation.studentCaseId
    || value.document_slot_id !== reservation.documentSlotId
    || value.document_version_id !== reservation.documentVersionId
    || value.upload_reservation_id !== reservation.uploadReservationId
    || value.bucket_id !== reservation.bucketId
    || value.object_name !== reservation.objectName
    || !timestamp(value.object_created_at)
    || !timestamp(value.finalized_at)
    || value.published_slot_status !== "submitted"
    || !versionNumber
    || value.document_slot_published !== true
  ) {
    return null;
  }

  return Object.freeze({
    documentVersionId: reservation.documentVersionId,
    documentSlotId: reservation.documentSlotId,
    studentCaseId: reservation.studentCaseId,
    versionNumber,
  });
}

function normalizeValidationAttestation(
  value: unknown,
  reservation: UploadReservation,
): ValidationAttestation | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "organization_id",
      "document_version_id",
      "document_slot_id",
      "student_case_id",
      "integrity_status",
      "malware_status",
      "validation_source",
      "evidence_ref",
      "validation_updated_at",
      "scanner_proof",
    ])
  ) {
    return null;
  }
  if (
    value.organization_id !== reservation.organizationId
    || value.document_version_id !== reservation.documentVersionId
    || value.document_slot_id !== reservation.documentSlotId
    || value.student_case_id !== reservation.studentCaseId
    || value.integrity_status !== "verified"
    || value.malware_status !== "clean"
    || value.validation_source !== "evo-v2-basic-file-validation-no-scanner"
    || value.evidence_ref !== `sha256:${reservation.sha256Hex}`
    || !timestamp(value.validation_updated_at)
    || value.scanner_proof !== false
  ) {
    return null;
  }
  return Object.freeze({ documentVersionId: reservation.documentVersionId });
}

function normalizeDownloadGrant(value: unknown): DownloadGrant | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "document_download_grant_id",
      "expires_at",
      "signed_url",
      "storage_api_service_sign_required",
    ])
  ) {
    return null;
  }
  const id = uuid(value.document_download_grant_id);
  const expiresAt = timestamp(value.expires_at);
  if (
    !id
    || !expiresAt
    || value.signed_url !== null
    || value.storage_api_service_sign_required !== true
  ) {
    return null;
  }
  return Object.freeze({ id, expiresAt });
}

function normalizeDownloadConsumption(
  value: unknown,
  expectedGrantId: string,
): DownloadConsumption | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "organization_id",
      "student_case_id",
      "document_slot_id",
      "document_version_id",
      "document_download_grant_id",
      "document_download_consumption_id",
      "document_access_event_id",
      "bucket_id",
      "object_name",
      "max_signed_url_expires_in_seconds",
      "grant_expires_at",
      "signed_url",
      "storage_api_service_sign_required",
    ])
  ) {
    return null;
  }
  const grantId = uuid(value.document_download_grant_id);
  const maximumLifetimeSeconds = positiveInteger(
    value.max_signed_url_expires_in_seconds,
  );
  if (
    grantId !== expectedGrantId
    || !uuid(value.organization_id)
    || !uuid(value.student_case_id)
    || !uuid(value.document_slot_id)
    || !uuid(value.document_version_id)
    || !uuid(value.document_download_consumption_id)
    || !uuid(value.document_access_event_id)
    || value.bucket_id !== BUCKET_ID
    || typeof value.object_name !== "string"
    || !OBJECT_NAME_PATTERN.test(value.object_name)
    || !maximumLifetimeSeconds
    || maximumLifetimeSeconds > 60
    || !timestamp(value.grant_expires_at)
    || value.signed_url !== null
    || value.storage_api_service_sign_required !== true
  ) {
    return null;
  }
  return Object.freeze({
    grantId,
    bucketId: BUCKET_ID,
    objectName: value.object_name,
    maximumLifetimeSeconds,
  });
}

async function defaultAuthorize(
  capability: DocumentCapability,
): Promise<DocumentAuthorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") {
    return { status: "anonymous", actor: null };
  }
  if (result.status === "invalid") {
    return { status: "unavailable", actor: null };
  }
  if (!fixedRoleCan(result.actor.authorityRole, capability)) {
    return { status: "forbidden", actor: null };
  }
  return { status: "authorized", actor: result.actor };
}

const defaultDependencies: PlatformDocumentStorageRouteDependencies = {
  authorize: defaultAuthorize,
  createUserClient: async () => {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    return createSupabaseServerClient();
  },
  createServiceClient: () =>
    createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
  supabaseOrigin: () =>
    new URL(getPlatformSupabaseBackendConfig().supabaseUrl).origin,
  requestId: randomUUID,
};

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: code }, { status });
}

function authorizationResponse(status: DocumentAuthorization["status"]): Response {
  if (status === "anonymous") return errorResponse(401, "authentication_required");
  if (status === "forbidden") return errorResponse(403, "forbidden");
  return errorResponse(503, "platform_unavailable");
}

function safeFilename(value: string): string | null {
  if (
    value.length < 1
    || value.length > 512
    || value !== value.trim()
    || CONTROL_CHARACTER_PATTERN.test(value)
    || value.includes("/")
    || value.includes("\\")
  ) {
    return null;
  }
  return value;
}

function exactUploadForm(form: FormData): Readonly<{
  file: File;
  requestId: string;
}> | null {
  const keys = [...form.keys()].sort();
  if (keys.length !== 2 || keys[0] !== "file" || keys[1] !== "request_id") {
    return null;
  }
  const file = form.get("file");
  const requestId = uuid(form.get("request_id"));
  if (
    !(file instanceof File)
    || !requestId
    || !safeFilename(file.name)
    || file.size < 1
    || file.size > MAX_FILE_BYTES
    || !ACCEPTED_MIME_TYPES.has(file.type)
  ) {
    return null;
  }
  return Object.freeze({ file, requestId });
}

function safeSignedUrl(value: unknown, supabaseOrigin: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.origin !== supabaseOrigin
      || !parsed.pathname.startsWith(
        `/storage/v1/object/sign/${BUCKET_ID}/`,
      )
      || !parsed.searchParams.get("token")
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function createPlatformDocumentUploadHandler(
  dependencies: PlatformDocumentStorageRouteDependencies = defaultDependencies,
) {
  return async function POST(
    request: Request,
    context: RouteContext<{ documentSlotId: string }>,
  ): Promise<Response> {
    const authorization = await dependencies.authorize("documents.write");
    if (authorization.status !== "authorized") {
      return authorizationResponse(authorization.status);
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
      return errorResponse(413, "file_too_large");
    }
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) {
      return errorResponse(415, "multipart_required");
    }

    const documentSlotId = uuid((await context.params).documentSlotId);
    if (!documentSlotId) return errorResponse(400, "invalid_document_slot");

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse(400, "invalid_multipart");
    }
    const upload = exactUploadForm(form);
    if (!upload) return errorResponse(400, "invalid_upload");

    const bytes = new Uint8Array(await upload.file.arrayBuffer());
    if (!matchesDeclaredFileSignature(upload.file.type, bytes)) {
      return errorResponse(400, "file_signature_mismatch");
    }
    const sha256Hex = createHash("sha256").update(bytes).digest("hex");
    if (!SHA256_PATTERN.test(sha256Hex)) {
      return errorResponse(503, "storage_unavailable");
    }

    try {
      const userClient = await dependencies.createUserClient();
      const reservationResponse = await userClient.schema("platform").rpc(
        "reserve_document_upload",
        {
          p_organization_id: authorization.actor.organizationId,
          p_document_slot_id: documentSlotId,
          p_original_filename: upload.file.name,
          p_declared_mime_type: upload.file.type,
          p_byte_size: bytes.byteLength,
          p_sha256_hex: sha256Hex,
          p_request_id: upload.requestId,
        },
      );
      if (reservationResponse.error) {
        return errorResponse(403, "upload_not_authorized");
      }
      const reservation = normalizeReservation(reservationResponse.data, {
        organizationId: authorization.actor.organizationId,
        documentSlotId,
        mimeType: upload.file.type,
        byteSize: bytes.byteLength,
        sha256Hex,
      });
      if (!reservation) return errorResponse(503, "storage_unavailable");

      if (!reservation.storageObjectPresent) {
        const storageResponse = await userClient.storage
          .from(BUCKET_ID)
          .upload(reservation.objectName, bytes, {
            contentType: upload.file.type,
            cacheControl: "0",
            upsert: false,
          });
        if (storageResponse.error) {
          return errorResponse(503, "storage_upload_unconfirmed");
        }
      }

      const serviceClient = dependencies.createServiceClient();
      const finalizationResponse = await serviceClient.schema("platform").rpc(
        "finalize_document_upload",
        {
          p_organization_id: authorization.actor.organizationId,
          p_upload_reservation_id: reservation.uploadReservationId,
          p_request_id: derivedRequestId(upload.requestId, "finalize"),
        },
      );
      if (finalizationResponse.error) {
        return errorResponse(503, "storage_finalization_unconfirmed");
      }
      const finalized = normalizeFinalizedUpload(
        finalizationResponse.data,
        reservation,
      );
      if (!finalized) return errorResponse(503, "storage_unavailable");

      const attestationResponse = await serviceClient.schema("platform").rpc(
        "attest_document_validation",
        {
          p_organization_id: authorization.actor.organizationId,
          p_document_version_id: reservation.documentVersionId,
          p_integrity_status: "verified",
          p_malware_status: "clean",
          p_validation_source: "evo-v2-basic-file-validation-no-scanner",
          p_evidence_ref: `sha256:${sha256Hex}`,
          p_request_id: derivedRequestId(upload.requestId, "attest"),
        },
      );
      if (attestationResponse.error) {
        return errorResponse(503, "storage_validation_unconfirmed");
      }
      const attestation = normalizeValidationAttestation(
        attestationResponse.data,
        reservation,
      );
      if (!attestation) return errorResponse(503, "storage_unavailable");

      return Response.json(
        {
          document: {
            studentCaseId: finalized.studentCaseId,
            documentSlotId: finalized.documentSlotId,
            documentVersionId: finalized.documentVersionId,
            versionNumber: finalized.versionNumber,
            originalFilename: upload.file.name,
            declaredMimeType: upload.file.type,
            byteSize: bytes.byteLength,
            sha256Hex,
          },
        },
        { status: 201 },
      );
    } catch {
      return errorResponse(503, "storage_unavailable");
    }
  };
}

export function createPlatformDocumentDownloadHandler(
  dependencies: PlatformDocumentStorageRouteDependencies = defaultDependencies,
) {
  return async function GET(
    _request: Request,
    context: RouteContext<{ versionId: string }>,
  ): Promise<Response> {
    const authorization = await dependencies.authorize("documents.read");
    if (authorization.status !== "authorized") {
      return authorizationResponse(authorization.status);
    }
    const versionId = uuid((await context.params).versionId);
    if (!versionId) return errorResponse(400, "invalid_document_version");

    try {
      const userClient = await dependencies.createUserClient();
      const grantResponse = await userClient.schema("platform").rpc(
        "grant_document_download",
        {
          p_organization_id: authorization.actor.organizationId,
          p_document_version_id: versionId,
          p_access_purpose: "staff_document_download",
          p_expires_in_seconds: 60,
          p_request_id: dependencies.requestId(),
        },
      );
      if (grantResponse.error) {
        return errorResponse(403, "download_not_authorized");
      }
      const grant = normalizeDownloadGrant(grantResponse.data);
      if (!grant) return errorResponse(503, "storage_unavailable");

      const serviceClient = dependencies.createServiceClient();
      const consumptionResponse = await serviceClient.schema("platform").rpc(
        "consume_document_download_grant",
        {
          p_document_download_grant_id: grant.id,
          p_request_id: dependencies.requestId(),
        },
      );
      if (consumptionResponse.error) {
        return errorResponse(403, "download_grant_invalid");
      }
      const consumption = normalizeDownloadConsumption(
        consumptionResponse.data,
        grant.id,
      );
      if (!consumption) return errorResponse(503, "storage_unavailable");

      const signedResponse = await serviceClient.storage
        .from(consumption.bucketId)
        .createSignedUrl(
          consumption.objectName,
          consumption.maximumLifetimeSeconds,
          { download: true },
        );
      if (signedResponse.error) {
        return errorResponse(503, "storage_signing_unavailable");
      }
      const signedUrl = safeSignedUrl(
        signedResponse.data.signedUrl,
        dependencies.supabaseOrigin(),
      );
      if (!signedUrl) return errorResponse(503, "storage_unavailable");
      return Response.redirect(signedUrl, 307);
    } catch {
      return errorResponse(503, "storage_unavailable");
    }
  };
}
