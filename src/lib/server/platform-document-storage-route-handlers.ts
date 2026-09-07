import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fixedRoleCan,
  type FixedRoleCapability,
} from "../fixed-role-policy.ts";
import type { PlatformActorResult } from "../platform-auth.ts";
import {
  ClamdScanError,
  isClamdMalwareScanProof,
  MAX_CLAMD_SCAN_TIMEOUT_MS,
  scanBytesWithClamd,
  type ClamdMalwareScanProof,
} from "./clamd-malware-scanner.ts";
import {
  getPlatformSupabaseBackendConfig,
  type PlatformSupabaseBackendConfig,
} from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  STANDARD_UPLOAD_MAX_BYTES,
  uploadSupabaseStorageObjectWithTus,
} from "./platform-storage-resumable-upload.ts";

const BUCKET_ID = "platform-documents";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const MAX_STUDENT_SCAN_LEASE_MS = 15 * 60 * 1000;
const STUDENT_SCAN_START_SAFETY_MS = MAX_CLAMD_SCAN_TIMEOUT_MS + 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_NAME_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{62}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SCANNER_ENGINE_VERSION_PATTERN = /^[0-9][0-9A-Za-z.+~-]{0,63}$/;
const SCANNER_SIGNATURE_VERSION_PATTERN = /^[1-9][0-9]{0,18}$/;
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

type DocumentOperation = "read" | "write";

export type DocumentStorageRouteActor = Readonly<{
  authUserId: string;
  organizationId: string;
}>;

type DocumentAuthorization =
  | Readonly<{ status: "authorized"; actor: DocumentStorageRouteActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "unavailable"; actor: null }>;

export type PlatformDocumentStorageRouteDependencies = Readonly<{
  authorize(operation: DocumentOperation): Promise<DocumentAuthorization>;
  createUserClient(): Promise<SupabaseClient>;
  createServiceClient(): SupabaseClient;
  backendConfig(): PlatformSupabaseBackendConfig;
  fetch(input: string | URL, init: RequestInit): Promise<Response>;
  scanFile(bytes: Uint8Array): Promise<ClamdMalwareScanProof>;
  supabaseOrigin(): string;
  requestId(): string;
  now(): number;
  scheduleTimeout?(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  clearScheduledTimeout?(timeout: ReturnType<typeof setTimeout>): void;
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

type UploadPreflight = Readonly<{
  studentCaseId: string;
}>;

type StudentScanAdmission = Readonly<{
  id: string;
  requestId: string;
  bodyDeadlineMs: number;
  terminalDocument: Readonly<{
    documentSlotId: string;
    documentVersionId: string;
    versionNumber: number;
    originalFilename: string;
    declaredMimeType: string;
    byteSize: number;
  }> | null;
}>;

type StudentScanClaim = Readonly<{
  admissionId: string;
  requestId: string;
  scanDeadlineMs: number;
}>;

type FinalizedUpload = Readonly<{
  documentVersionId: string;
  documentSlotId: string;
  studentCaseId: string;
  versionNumber: number;
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

type StaffActorResolver = () => Promise<PlatformActorResult>;

type StudentActorResolver = () => Promise<
  | Readonly<{ status: "anonymous"; actor: null }>
  | Readonly<{
      status: "invalid";
      actor: null;
      reason:
        | "supabase_session_invalid"
        | "student_authority_invalid"
        | "student_authority_unavailable";
    }>
  | Readonly<{
      status: "authenticated";
      actor: DocumentStorageRouteActor;
    }>
>;

type UploadResponseAudience = "staff" | "student";

type DownloadPolicy = Readonly<{
  accessPurpose: "staff_document_download" | "student_document_download";
  redirectStatus: 302 | 307;
  noStore: boolean;
}>;

const STAFF_DOWNLOAD_POLICY: DownloadPolicy = Object.freeze({
  accessPurpose: "staff_document_download",
  redirectStatus: 307,
  noStore: false,
});

const STUDENT_DOWNLOAD_POLICY: DownloadPolicy = Object.freeze({
  accessPurpose: "student_document_download",
  redirectStatus: 302,
  noStore: true,
});

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
      "ingress_scan_proof",
      "ingress_scan_result",
      "ingress_scanner_engine",
      "ingress_scanner_engine_version",
      "ingress_scanner_signature_version",
      "ingress_scanner_protocol",
      "ingress_scanned_at",
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
  const ingressScannedAt = timestamp(value.ingress_scanned_at);
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
    || value.ingress_scan_proof !== true
    || value.ingress_scan_result !== "clean"
    || value.ingress_scanner_engine !== "ClamAV"
    || typeof value.ingress_scanner_engine_version !== "string"
    || !SCANNER_ENGINE_VERSION_PATTERN.test(
      value.ingress_scanner_engine_version,
    )
    || typeof value.ingress_scanner_signature_version !== "string"
    || !SCANNER_SIGNATURE_VERSION_PATTERN.test(
      value.ingress_scanner_signature_version,
    )
    || value.ingress_scanner_protocol !== "clamd-zinstream-v1"
    || !ingressScannedAt
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

function normalizeUploadPreflight(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    documentSlotId: string;
    requestId: string;
  }>,
): UploadPreflight | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "organization_id",
      "student_case_id",
      "document_slot_id",
      "request_id",
      "upload_allowed",
      "reservation_replay",
    ])
  ) {
    return null;
  }
  const studentCaseId = uuid(value.student_case_id);
  if (
    value.organization_id !== expected.organizationId
    || value.document_slot_id !== expected.documentSlotId
    || value.request_id !== expected.requestId
    || !studentCaseId
    || value.upload_allowed !== true
    || typeof value.reservation_replay !== "boolean"
  ) {
    return null;
  }
  return Object.freeze({ studentCaseId });
}

function normalizeStudentScanAdmission(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    documentSlotId: string;
    requestId: string;
    rpcStartedAtMs: number;
  }>,
): StudentScanAdmission | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "admission_id",
      "organization_id",
      "student_case_id",
      "document_slot_id",
      "request_id",
      "attempt_no",
      "admitted_at",
      "lease_expires_at",
      "request_retry",
      "scan_allowed",
      "terminal_replay",
      "document_version_id",
      "version_no",
      "original_filename",
      "declared_mime_type",
      "byte_size",
    ])
  ) {
    return null;
  }
  const id = uuid(value.admission_id);
  const admittedAtMs = typeof value.admitted_at === "string"
    ? Date.parse(value.admitted_at)
    : Number.NaN;
  const leaseExpiresAtMs = typeof value.lease_expires_at === "string"
    ? Date.parse(value.lease_expires_at)
    : Number.NaN;
  const leaseDurationMs = leaseExpiresAtMs - admittedAtMs;
  if (
    !id
    || value.organization_id !== expected.organizationId
    || !uuid(value.student_case_id)
    || value.document_slot_id !== expected.documentSlotId
    || value.request_id !== expected.requestId
    || !positiveInteger(value.attempt_no)
    || !timestamp(value.admitted_at)
    || !timestamp(value.lease_expires_at)
    || !Number.isFinite(admittedAtMs)
    || !Number.isFinite(leaseExpiresAtMs)
    || !Number.isFinite(expected.rpcStartedAtMs)
    || leaseDurationMs <= 0
    || leaseDurationMs > MAX_STUDENT_SCAN_LEASE_MS
    || typeof value.request_retry !== "boolean"
    || typeof value.terminal_replay !== "boolean"
  ) {
    return null;
  }
  if (value.terminal_replay === false) {
    if (
      value.scan_allowed !== true
      || value.document_version_id !== null
      || value.version_no !== null
      || value.original_filename !== null
      || value.declared_mime_type !== null
      || value.byte_size !== null
    ) {
      return null;
    }
    return Object.freeze({
      id,
      requestId: expected.requestId,
      bodyDeadlineMs: expected.rpcStartedAtMs + leaseDurationMs,
      terminalDocument: null,
    });
  }

  const documentVersionId = uuid(value.document_version_id);
  const versionNumber = positiveInteger(value.version_no);
  const originalFilename = typeof value.original_filename === "string"
    ? safeFilename(value.original_filename)
    : null;
  const byteSize = positiveInteger(value.byte_size);
  if (
    value.scan_allowed !== false
    || value.request_retry !== true
    || !documentVersionId
    || !versionNumber
    || !originalFilename
    || typeof value.declared_mime_type !== "string"
    || !ACCEPTED_MIME_TYPES.has(value.declared_mime_type)
    || !byteSize
    || byteSize > MAX_FILE_BYTES
  ) {
    return null;
  }
  return Object.freeze({
    id,
    requestId: expected.requestId,
    bodyDeadlineMs: expected.rpcStartedAtMs + leaseDurationMs,
    terminalDocument: Object.freeze({
      documentSlotId: expected.documentSlotId,
      documentVersionId,
      versionNumber,
      originalFilename,
      declaredMimeType: value.declared_mime_type,
      byteSize,
    }),
  });
}

function normalizeStudentScanClaim(
  value: unknown,
  expected: Readonly<{
    admissionId: string;
    organizationId: string;
    requestId: string;
    rpcStartedAtMs: number;
  }>,
): StudentScanClaim | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "admission_id",
      "organization_id",
      "request_id",
      "scan_claimed_at",
      "claim_checked_at",
      "scan_lease_expires_at",
      "scan_claim_replay",
      "scan_allowed",
    ])
  ) {
    return null;
  }
  const scanClaimedAtMs = typeof value.scan_claimed_at === "string"
    ? Date.parse(value.scan_claimed_at)
    : Number.NaN;
  const scanLeaseExpiresAtMs = typeof value.scan_lease_expires_at === "string"
    ? Date.parse(value.scan_lease_expires_at)
    : Number.NaN;
  const claimCheckedAtMs = typeof value.claim_checked_at === "string"
    ? Date.parse(value.claim_checked_at)
    : Number.NaN;
  const remainingLeaseMs = scanLeaseExpiresAtMs - claimCheckedAtMs;
  if (
    value.admission_id !== expected.admissionId
    || value.organization_id !== expected.organizationId
    || value.request_id !== expected.requestId
    || !timestamp(value.scan_claimed_at)
    || !timestamp(value.claim_checked_at)
    || !timestamp(value.scan_lease_expires_at)
    || !Number.isFinite(expected.rpcStartedAtMs)
    || !Number.isFinite(scanClaimedAtMs)
    || !Number.isFinite(claimCheckedAtMs)
    || !Number.isFinite(scanLeaseExpiresAtMs)
    || claimCheckedAtMs < scanClaimedAtMs
    || remainingLeaseMs <= 0
    || remainingLeaseMs > MAX_STUDENT_SCAN_LEASE_MS
    || typeof value.scan_claim_replay !== "boolean"
    || value.scan_allowed !== true
  ) {
    return null;
  }
  return Object.freeze({
    admissionId: expected.admissionId,
    requestId: expected.requestId,
    scanDeadlineMs: expected.rpcStartedAtMs + remainingLeaseMs,
  });
}

function validStudentScanCompletion(
  value: unknown,
  expected: Readonly<{
    admissionId: string;
    organizationId: string;
    requestId: string;
    outcome: "completed" | "rejected" | "failed";
  }>,
): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      "admission_id",
      "organization_id",
      "request_id",
      "released_at",
      "release_outcome",
    ])
    && value.admission_id === expected.admissionId
    && value.organization_id === expected.organizationId
    && value.request_id === expected.requestId
    && timestamp(value.released_at) !== null
    && value.release_outcome === expected.outcome;
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
      "integrity_status",
      "malware_status",
      "validation_source",
      "evidence_ref",
      "validation_updated_at",
      "malware_scan_attestation_id",
      "storage_binding_id",
      "upload_finalization_id",
      "scanner_engine",
      "scanner_engine_version",
      "scanner_signature_version",
      "scanner_protocol",
      "scanned_sha256_hex",
      "scanned_at",
      "scanner_proof",
      "finalization_request_id",
      "scan_proof_request_id",
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
    || value.integrity_status !== "verified"
    || value.malware_status !== "clean"
    || value.validation_source !== "clamav-clamd-zinstream"
    || value.evidence_ref !== `sha256:${reservation.sha256Hex}`
    || !timestamp(value.validation_updated_at)
    || !uuid(value.malware_scan_attestation_id)
    || !uuid(value.storage_binding_id)
    || !uuid(value.upload_finalization_id)
    || value.scanner_engine !== "ClamAV"
    || typeof value.scanner_engine_version !== "string"
    || !SCANNER_ENGINE_VERSION_PATTERN.test(value.scanner_engine_version)
    || typeof value.scanner_signature_version !== "string"
    || !SCANNER_SIGNATURE_VERSION_PATTERN.test(
      value.scanner_signature_version,
    )
    || value.scanner_protocol !== "clamd-zinstream-v1"
    || value.scanned_sha256_hex !== reservation.sha256Hex
    || !timestamp(value.scanned_at)
    || value.scanner_proof !== true
    || !uuid(value.finalization_request_id)
    || !uuid(value.scan_proof_request_id)
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

async function readExactStoredDocument(
  serviceClient: SupabaseClient,
  reservation: UploadReservation,
): Promise<
  | Readonly<{ status: "ok"; bytes: Uint8Array }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "mismatch" }>
> {
  const downloaded = await serviceClient.storage
    .from(BUCKET_ID)
    .download(reservation.objectName);
  if (downloaded.error || !downloaded.data) {
    return { status: "unavailable" };
  }
  if (
    downloaded.data.size !== reservation.byteSize
    || downloaded.data.size < 1
    || downloaded.data.size > MAX_FILE_BYTES
    || downloaded.data.type.toLowerCase() !== reservation.declaredMimeType
  ) {
    return { status: "mismatch" };
  }

  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const sha256Hex = createHash("sha256").update(bytes).digest("hex");
  if (
    bytes.byteLength !== reservation.byteSize
    || sha256Hex !== reservation.sha256Hex
    || !matchesDeclaredFileSignature(reservation.declaredMimeType, bytes)
  ) {
    return { status: "mismatch" };
  }
  return { status: "ok", bytes };
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
  expected: Readonly<{
    grantId: string;
    organizationId: string;
    documentVersionId: string;
  }>,
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
    grantId !== expected.grantId
    || value.organization_id !== expected.organizationId
    || !uuid(value.student_case_id)
    || !uuid(value.document_slot_id)
    || value.document_version_id !== expected.documentVersionId
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

export function createStaffDocumentAuthorizationFactory(
  resolveActor: StaffActorResolver = async () => {
    const { resolvePlatformActor } = await import("../platform-auth.ts");
    return resolvePlatformActor();
  },
) {
  return async function authorizeStaffDocument(
    operation: DocumentOperation,
  ): Promise<DocumentAuthorization> {
    const result = await resolveActor();
    if (result.status === "anonymous") {
      return { status: "anonymous", actor: null };
    }
    if (result.status === "invalid") {
      return { status: "unavailable", actor: null };
    }
    const capability: DocumentCapability = operation === "read"
      ? "documents.read"
      : "documents.write";
    if (!fixedRoleCan(result.actor.authorityRole, capability)) {
      return { status: "forbidden", actor: null };
    }
    return {
      status: "authorized",
      actor: {
        authUserId: result.actor.authUserId,
        organizationId: result.actor.organizationId,
      },
    };
  };
}

export function createStudentDocumentAuthorizationFactory(
  resolveActor: StudentActorResolver = async () => {
    const { resolveStudentPortalActor } = await import(
      "../student-portal-auth.ts"
    );
    return resolveStudentPortalActor();
  },
) {
  return async function authorizeStudentDocument(): Promise<DocumentAuthorization> {
    const result = await resolveActor();
    if (result.status === "anonymous") {
      return { status: "anonymous", actor: null };
    }
    if (result.status === "invalid") {
      return result.reason === "student_authority_unavailable"
        ? { status: "unavailable", actor: null }
        : { status: "anonymous", actor: null };
    }
    return {
      status: "authorized",
      actor: {
        authUserId: result.actor.authUserId,
        organizationId: result.actor.organizationId,
      },
    };
  };
}

function createDefaultDependencies(
  authorize: PlatformDocumentStorageRouteDependencies["authorize"],
): PlatformDocumentStorageRouteDependencies {
  return {
    authorize,
    createUserClient: async () => {
      const { createSupabaseServerClient } = await import("../supabase/server.ts");
      return createSupabaseServerClient();
    },
    createServiceClient: () =>
      createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
    backendConfig: getPlatformSupabaseBackendConfig,
    fetch: (input, init) => fetch(input, init),
    scanFile: scanBytesWithClamd,
    supabaseOrigin: () =>
      new URL(getPlatformSupabaseBackendConfig().supabaseUrl).origin,
    requestId: randomUUID,
    now: Date.now,
  };
}

const defaultStaffDependencies = createDefaultDependencies(
  createStaffDocumentAuthorizationFactory(),
);

const defaultStudentDependencies = createDefaultDependencies(
  createStudentDocumentAuthorizationFactory(),
);

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: code }, { status });
}

function rpcErrorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function preflightErrorResponse(error: unknown): Response {
  const code = rpcErrorCode(error);
  if (code === "42501") return errorResponse(403, "upload_not_authorized");
  if (code === "22023") return errorResponse(400, "invalid_upload");
  if (code === "PT409") return errorResponse(409, "upload_in_progress");
  if (code === "PT429") return errorResponse(429, "upload_rate_limited");
  if (code === "23505") return errorResponse(409, "request_conflict");
  return errorResponse(503, "upload_preflight_unavailable");
}

function reservationErrorResponse(error: unknown): Response {
  const code = rpcErrorCode(error);
  if (code === "42501") return errorResponse(403, "upload_not_authorized");
  if (code === "22023") return errorResponse(400, "invalid_upload");
  if (code === "PT409") return errorResponse(409, "upload_in_progress");
  if (code === "PT429") return errorResponse(429, "upload_rate_limited");
  if (code === "23505") return errorResponse(409, "request_conflict");
  return errorResponse(503, "storage_reservation_unconfirmed");
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

function exactUploadForm(
  form: FormData,
  responseAudience: UploadResponseAudience,
): Readonly<{
  file: File;
  requestId: string | null;
}> | null {
  const keys = [...form.keys()].sort();
  const expectedKeys = responseAudience === "student"
    ? ["file"]
    : ["file", "request_id"];
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return null;
  }
  const file = form.get("file");
  const requestId = responseAudience === "student"
    ? null
    : uuid(form.get("request_id"));
  if (
    !(file instanceof File)
    || (responseAudience === "staff" && !requestId)
    || !safeFilename(file.name)
    || file.size < 1
    || file.size > MAX_FILE_BYTES
    || !ACCEPTED_MIME_TYPES.has(file.type)
  ) {
    return null;
  }
  return Object.freeze({ file, requestId });
}

export function selectPrivateDocumentUploadTransport(
  byteLength: number,
): "standard" | "resumable" | null {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) return null;
  if (byteLength <= STANDARD_UPLOAD_MAX_BYTES) return "standard";
  return byteLength <= MAX_FILE_BYTES ? "resumable" : null;
}

function safeSignedUrl(
  value: unknown,
  supabaseOrigin: string,
  expectedObjectName: string,
): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    const expectedPath = `/storage/v1/object/sign/${BUCKET_ID}/${expectedObjectName}`;
    if (
      parsed.origin !== supabaseOrigin
      || parsed.pathname !== expectedPath
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.hash !== ""
      || !parsed.searchParams.get("token")
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function readBoundedMultipartForm(
  request: Request,
  contentType: string,
  lease?: Readonly<{
    expiresAtMs: number;
    now: () => number;
    scheduleTimeout?: PlatformDocumentStorageRouteDependencies["scheduleTimeout"];
    clearScheduledTimeout?: PlatformDocumentStorageRouteDependencies["clearScheduledTimeout"];
  }>,
): Promise<
  | Readonly<{ status: "ok"; form: FormData }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "too_large" }>
  | Readonly<{ status: "lease_expired" }>
> {
  if (!request.body) return { status: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const remainingMs = lease ? lease.expiresAtMs - lease.now() : null;
      if (remainingMs !== null && remainingMs <= 0) {
        await reader.cancel("scan_admission_lease_expired").catch(() => undefined);
        return { status: "lease_expired" };
      }

      let timeout: ReturnType<typeof setTimeout> | null = null;
      let readResult: ReadableStreamReadResult<Uint8Array> | "lease_expired";
      try {
        readResult = await (remainingMs === null
          ? reader.read()
          : Promise.race([
              reader.read(),
              new Promise<"lease_expired">((resolve) => {
                timeout = (lease?.scheduleTimeout ?? setTimeout)(
                  () => resolve("lease_expired"),
                  remainingMs,
                );
              }),
            ]));
      } finally {
        if (timeout) {
          if (lease?.clearScheduledTimeout) {
            lease.clearScheduledTimeout(timeout);
          } else {
            clearTimeout(timeout);
          }
        }
      }
      if (readResult === "lease_expired") {
        await reader.cancel("scan_admission_lease_expired").catch(() => undefined);
        return { status: "lease_expired" };
      }
      const { done, value } = readResult;
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_MULTIPART_BYTES) {
        await reader.cancel("multipart_too_large").catch(() => undefined);
        return { status: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { status: "invalid" };
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const form = await new Response(body, {
      headers: { "content-type": contentType },
    }).formData();
    return { status: "ok", form };
  } catch {
    return { status: "invalid" };
  }
}

async function completeStudentScanAdmission(
  dependencies: PlatformDocumentStorageRouteDependencies,
  actor: DocumentStorageRouteActor,
  admission: StudentScanAdmission,
  operation: () => Promise<Response>,
): Promise<Response> {
  let operationResponse: Response | null = null;
  try {
    operationResponse = await operation();
  } catch {
    operationResponse = errorResponse(503, "storage_unavailable");
  }

  const outcome = operationResponse.status >= 200 && operationResponse.status < 300
    ? "completed"
    : operationResponse.status >= 400 && operationResponse.status < 500
      ? "rejected"
      : "failed";
  try {
    const serviceClient = dependencies.createServiceClient();
    const completionResponse = await serviceClient.schema("platform").rpc(
      "complete_student_document_upload_scan_admission",
      {
        p_organization_id: actor.organizationId,
        p_actor_auth_user_id: actor.authUserId,
        p_admission_id: admission.id,
        p_request_id: admission.requestId,
        p_outcome: outcome,
      },
    );
    if (
      completionResponse.error
      || !validStudentScanCompletion(completionResponse.data, {
        admissionId: admission.id,
        organizationId: actor.organizationId,
        requestId: admission.requestId,
        outcome,
      })
    ) {
      return errorResponse(503, "scan_admission_completion_unconfirmed");
    }
  } catch {
    return errorResponse(503, "scan_admission_completion_unavailable");
  }

  return operationResponse;
}

function createDocumentUploadHandler(
  dependencies: PlatformDocumentStorageRouteDependencies,
  responseAudience: UploadResponseAudience,
) {
  return async function POST(
    request: Request,
    context: RouteContext<{ documentSlotId: string }>,
  ): Promise<Response> {
    const authorization = await dependencies.authorize("write");
    if (authorization.status !== "authorized") {
      return authorizationResponse(authorization.status);
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
      return errorResponse(413, "file_too_large");
    }
    const contentType = request.headers.get("content-type");
    if (!contentType?.startsWith("multipart/form-data;")) {
      return errorResponse(415, "multipart_required");
    }

    const documentSlotId = uuid((await context.params).documentSlotId);
    if (!documentSlotId) return errorResponse(400, "invalid_document_slot");

    const studentRequestId = responseAudience === "student"
      ? uuid(request.headers.get("idempotency-key"))
      : null;
    if (responseAudience === "student" && !studentRequestId) {
      return errorResponse(400, "invalid_idempotency_key");
    }

    let admittedUserClient: SupabaseClient | null = null;
    let studentAdmission: StudentScanAdmission | null = null;
    if (responseAudience === "student" && studentRequestId) {
      try {
        const admissionStartedAtMs = dependencies.now();
        admittedUserClient = await dependencies.createUserClient();
        const admissionResponse = await admittedUserClient.schema("platform").rpc(
          "admit_student_document_upload_scan",
          {
            p_organization_id: authorization.actor.organizationId,
            p_document_slot_id: documentSlotId,
            p_request_id: studentRequestId,
          },
        );
        if (admissionResponse.error) {
          return preflightErrorResponse(admissionResponse.error);
        }
        studentAdmission = normalizeStudentScanAdmission(
          admissionResponse.data,
          {
            organizationId: authorization.actor.organizationId,
            documentSlotId,
            requestId: studentRequestId,
            rpcStartedAtMs: admissionStartedAtMs,
          },
        );
        if (!studentAdmission) {
          return errorResponse(503, "scan_admission_unconfirmed");
        }
        if (studentAdmission.terminalDocument) {
          return Response.json(
            { document: studentAdmission.terminalDocument },
            { status: 201 },
          );
        }
      } catch {
        return errorResponse(503, "scan_admission_unavailable");
      }
    }

    const processUpload = async (): Promise<Response> => {

    const multipart = await readBoundedMultipartForm(
      request,
      contentType,
      studentAdmission
          ? {
            expiresAtMs: studentAdmission.bodyDeadlineMs,
            now: dependencies.now,
            ...(dependencies.scheduleTimeout
              ? { scheduleTimeout: dependencies.scheduleTimeout }
              : {}),
            ...(dependencies.clearScheduledTimeout
              ? { clearScheduledTimeout: dependencies.clearScheduledTimeout }
              : {}),
          }
        : undefined,
    );
    if (multipart.status === "lease_expired") {
      return errorResponse(409, "scan_admission_expired");
    }
    if (multipart.status === "too_large") {
      return errorResponse(413, "file_too_large");
    }
    if (multipart.status === "invalid") {
      return errorResponse(400, "invalid_multipart");
    }
    const upload = exactUploadForm(multipart.form, responseAudience);
    if (!upload) return errorResponse(400, "invalid_upload");

    const bytes = new Uint8Array(await upload.file.arrayBuffer());
    const uploadTransport = selectPrivateDocumentUploadTransport(bytes.byteLength);
    if (!uploadTransport) return errorResponse(413, "file_too_large");
    if (!matchesDeclaredFileSignature(upload.file.type, bytes)) {
      return errorResponse(400, "file_signature_mismatch");
    }
    const sha256Hex = createHash("sha256").update(bytes).digest("hex");
    if (!SHA256_PATTERN.test(sha256Hex)) {
      return errorResponse(503, "storage_unavailable");
    }
    const uploadRequestId = upload.requestId
      ?? studentRequestId
      ?? uuid(dependencies.requestId());
    if (!uploadRequestId) return errorResponse(503, "storage_unavailable");

    let userClient: SupabaseClient;
    try {
      userClient = admittedUserClient ?? await dependencies.createUserClient();
      const preflightResponse = await userClient.schema("platform").rpc(
        "preflight_document_upload",
        {
          p_organization_id: authorization.actor.organizationId,
          p_document_slot_id: documentSlotId,
          p_original_filename: upload.file.name,
          p_declared_mime_type: upload.file.type,
          p_byte_size: bytes.byteLength,
          p_sha256_hex: sha256Hex,
          p_request_id: uploadRequestId,
        },
      );
      if (preflightResponse.error) {
        return preflightErrorResponse(preflightResponse.error);
      }
    if (!normalizeUploadPreflight(preflightResponse.data, {
        organizationId: authorization.actor.organizationId,
        documentSlotId,
        requestId: uploadRequestId,
      })) {
        return errorResponse(503, "upload_preflight_unconfirmed");
      }
    } catch {
      return errorResponse(503, "upload_preflight_unavailable");
    }

    if (
      studentAdmission
      && dependencies.now() >= studentAdmission.bodyDeadlineMs
    ) {
      return errorResponse(409, "scan_admission_expired");
    }

    let claimedServiceClient: SupabaseClient | null = null;
    let studentScanClaim: StudentScanClaim | null = null;
    if (studentAdmission) {
      try {
        const claimStartedAtMs = dependencies.now();
        claimedServiceClient = dependencies.createServiceClient();
        const claimResponse = await claimedServiceClient.schema("platform").rpc(
          "claim_student_document_upload_scan",
          {
            p_organization_id: authorization.actor.organizationId,
            p_actor_auth_user_id: authorization.actor.authUserId,
            p_admission_id: studentAdmission.id,
            p_request_id: studentAdmission.requestId,
          },
        );
        if (claimResponse.error) {
          return preflightErrorResponse(claimResponse.error);
        }
        studentScanClaim = normalizeStudentScanClaim(
          claimResponse.data,
          {
            admissionId: studentAdmission.id,
            organizationId: authorization.actor.organizationId,
            requestId: studentAdmission.requestId,
            rpcStartedAtMs: claimStartedAtMs,
          },
        );
        if (!studentScanClaim) {
          return errorResponse(503, "scan_claim_unconfirmed");
        }
        if (
          studentScanClaim.scanDeadlineMs - dependencies.now()
          <= STUDENT_SCAN_START_SAFETY_MS
        ) {
          return errorResponse(409, "scan_claim_expired");
        }
      } catch {
        return errorResponse(503, "scan_claim_unavailable");
      }
    }

    let requestScanProof: ClamdMalwareScanProof;
    try {
      requestScanProof = await dependencies.scanFile(bytes);
    } catch (error) {
      if (error instanceof ClamdScanError && error.code === "infected") {
        return errorResponse(422, "malware_detected");
      }
      return errorResponse(503, "malware_scanner_unavailable");
    }
    if (!isClamdMalwareScanProof(requestScanProof, sha256Hex)) {
      return errorResponse(503, "malware_scan_unconfirmed");
    }

    try {
      const serviceClient = claimedServiceClient
        ?? dependencies.createServiceClient();
      const reservationResponse = await serviceClient.schema("platform").rpc(
        "reserve_document_upload_after_ingress_scan",
        {
          p_organization_id: authorization.actor.organizationId,
          p_actor_auth_user_id: authorization.actor.authUserId,
          p_document_slot_id: documentSlotId,
          p_original_filename: upload.file.name,
          p_declared_mime_type: upload.file.type,
          p_byte_size: bytes.byteLength,
          p_sha256_hex: sha256Hex,
          p_scan_result: "clean",
          p_scanner_engine: requestScanProof.engine,
          p_scanner_engine_version: requestScanProof.engineVersion,
          p_scanner_signature_version: requestScanProof.signatureVersion,
          p_scanner_protocol: requestScanProof.protocol,
          p_scanned_at: requestScanProof.scannedAt,
          p_request_id: uploadRequestId,
        },
      );
      if (reservationResponse.error) {
        return reservationErrorResponse(reservationResponse.error);
      }
      const reservation = normalizeReservation(reservationResponse.data, {
        organizationId: authorization.actor.organizationId,
        documentSlotId,
        mimeType: upload.file.type,
        byteSize: bytes.byteLength,
        sha256Hex,
      });
      if (!reservation) return errorResponse(503, "storage_unavailable");

      if (!reservation.storageObjectPresent && uploadTransport === "standard") {
        const storageResponse = await serviceClient.storage.from(BUCKET_ID).upload(
          reservation.objectName,
          bytes,
          {
            contentType: upload.file.type,
            cacheControl: "0",
            upsert: false,
          },
        );
        if (storageResponse.error) {
          return errorResponse(503, "storage_upload_unconfirmed");
        }
      }
      if (!reservation.storageObjectPresent && uploadTransport === "resumable") {
        await uploadSupabaseStorageObjectWithTus(
          bytes,
          reservation,
          upload.file.type,
          dependencies,
        );
      }

      const storedObject = await readExactStoredDocument(
        serviceClient,
        reservation,
      );
      if (storedObject.status === "unavailable") {
        return errorResponse(503, "storage_readback_unconfirmed");
      }
      if (storedObject.status === "mismatch") {
        return errorResponse(503, "storage_object_mismatch");
      }

      if (
        studentScanClaim
        && studentScanClaim.scanDeadlineMs - dependencies.now()
          <= STUDENT_SCAN_START_SAFETY_MS
      ) {
        return errorResponse(409, "scan_claim_expired");
      }

      let scanProof: ClamdMalwareScanProof;
      try {
        scanProof = await dependencies.scanFile(storedObject.bytes);
      } catch (error) {
        if (error instanceof ClamdScanError && error.code === "infected") {
          return errorResponse(422, "malware_detected");
        }
        return errorResponse(503, "malware_scanner_unavailable");
      }
      if (!isClamdMalwareScanProof(scanProof, reservation.sha256Hex)) {
        return errorResponse(503, "malware_scan_unconfirmed");
      }

      const finalizationResponse = await serviceClient.schema("platform").rpc(
        "finalize_document_upload_with_scan",
        {
          p_organization_id: authorization.actor.organizationId,
          p_upload_reservation_id: reservation.uploadReservationId,
          p_scanner_engine: scanProof.engine,
          p_scanner_engine_version: scanProof.engineVersion,
          p_scanner_signature_version: scanProof.signatureVersion,
          p_scanner_protocol: scanProof.protocol,
          p_scanned_sha256_hex: scanProof.sha256Hex,
          p_scanned_at: scanProof.scannedAt,
          p_request_id: derivedRequestId(uploadRequestId, "finalize"),
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

      const document = responseAudience === "staff"
        ? {
            studentCaseId: finalized.studentCaseId,
            documentSlotId: finalized.documentSlotId,
            documentVersionId: finalized.documentVersionId,
            versionNumber: finalized.versionNumber,
            originalFilename: upload.file.name,
            declaredMimeType: upload.file.type,
            byteSize: bytes.byteLength,
            sha256Hex,
          }
        : {
            documentSlotId: finalized.documentSlotId,
            documentVersionId: finalized.documentVersionId,
            versionNumber: finalized.versionNumber,
            originalFilename: upload.file.name,
            declaredMimeType: upload.file.type,
            byteSize: bytes.byteLength,
          };

      return Response.json({ document }, { status: 201 });
    } catch {
      return errorResponse(503, "storage_unavailable");
    }
    };

    return studentAdmission
      ? completeStudentScanAdmission(
          dependencies,
          authorization.actor,
          studentAdmission,
          processUpload,
        )
      : processUpload();
  };
}

export function createPlatformDocumentUploadHandler(
  dependencies: PlatformDocumentStorageRouteDependencies = defaultStaffDependencies,
) {
  return createDocumentUploadHandler(dependencies, "staff");
}

export function createStudentPortalDocumentUploadHandler(
  dependencies: PlatformDocumentStorageRouteDependencies = defaultStudentDependencies,
) {
  return createDocumentUploadHandler(dependencies, "student");
}

function createDocumentDownloadHandler(
  dependencies: PlatformDocumentStorageRouteDependencies,
  policy: DownloadPolicy,
) {
  return async function GET(
    _request: Request,
    context: RouteContext<{ versionId: string }>,
  ): Promise<Response> {
    const authorization = await dependencies.authorize("read");
    if (authorization.status !== "authorized") {
      return authorizationResponse(authorization.status);
    }
    const versionId = uuid((await context.params).versionId);
    if (!versionId) return errorResponse(400, "invalid_document_version");

    try {
      const userClient = await dependencies.createUserClient();
      const grantRequestId = dependencies.requestId();
      const grantResponse = policy.accessPurpose === "student_document_download"
        ? await userClient.schema("platform").rpc(
            "grant_student_portal_document_download",
            {
              p_organization_id: authorization.actor.organizationId,
              p_document_version_id: versionId,
              p_request_id: grantRequestId,
            },
          )
        : await userClient.schema("platform").rpc(
            "grant_document_download",
            {
              p_organization_id: authorization.actor.organizationId,
              p_document_version_id: versionId,
              p_access_purpose: policy.accessPurpose,
              p_expires_in_seconds: 60,
              p_request_id: grantRequestId,
            },
          );
      if (grantResponse.error) {
        return errorResponse(403, "download_not_authorized");
      }
      const grant = normalizeDownloadGrant(grantResponse.data);
      if (!grant) return errorResponse(503, "storage_unavailable");

      const serviceClient = dependencies.createServiceClient();
      const consumptionRpc = policy.accessPurpose === "student_document_download"
        ? "consume_student_portal_document_download_grant"
        : "consume_document_download_grant";
      const consumptionResponse = await serviceClient.schema("platform").rpc(
        consumptionRpc,
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
        {
          grantId: grant.id,
          organizationId: authorization.actor.organizationId,
          documentVersionId: versionId,
        },
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
        consumption.objectName,
      );
      if (!signedUrl) return errorResponse(503, "storage_unavailable");
      if (policy.noStore) {
        return new Response(null, {
          status: policy.redirectStatus,
          headers: {
            "Cache-Control": "no-store",
            Location: signedUrl,
          },
        });
      }
      return Response.redirect(signedUrl, policy.redirectStatus);
    } catch {
      return errorResponse(503, "storage_unavailable");
    }
  };
}

export function createPlatformDocumentDownloadHandler(
  dependencies: PlatformDocumentStorageRouteDependencies = defaultStaffDependencies,
) {
  return createDocumentDownloadHandler(dependencies, STAFF_DOWNLOAD_POLICY);
}

export function createStudentPortalDocumentDownloadHandler(
  dependencies: PlatformDocumentStorageRouteDependencies = defaultStudentDependencies,
) {
  return createDocumentDownloadHandler(dependencies, STUDENT_DOWNLOAD_POLICY);
}
