import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fixedRoleCan,
  type FixedRoleCapability,
} from "../fixed-role-policy.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import {
  PLATFORM_COMPANY_FILE_MIME_TYPES,
  type PlatformCompanyFileMimeType,
} from "../platform-company-files.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const BUCKET_ID = "platform-company-files";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_NAME_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{62}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const POSITIVE_BIGINT_PATTERN = /^[1-9]\d*$/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const ACCEPTED_MIME_TYPES = new Set<string>(PLATFORM_COMPANY_FILE_MIME_TYPES);
const MIME_EXTENSIONS: Readonly<Record<PlatformCompanyFileMimeType, readonly string[]>> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "application/msword": ["doc"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.ms-powerpoint": ["ppt"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "docx",
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    "xlsx",
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    "pptx",
  ],
};

type DocumentCapability = Extract<
  FixedRoleCapability,
  "documents.read" | "documents.write"
>;

type CompanyFileAuthorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "unavailable"; actor: null }>;

export type PlatformCompanyFileStorageRouteDependencies = Readonly<{
  authorize(capability: DocumentCapability): Promise<CompanyFileAuthorization>;
  createUserClient(): Promise<SupabaseClient>;
  createServiceClient(): SupabaseClient;
  supabaseOrigin(): string;
  requestId(): string;
}>;

type UploadReservation = Readonly<{
  organizationId: string;
  companyFileId: string;
  companyFileVersionId: string;
  versionNumber: string;
  uploadReservationId: string;
  bucketId: typeof BUCKET_ID;
  objectName: string;
  expiresAt: string;
  declaredMimeType: PlatformCompanyFileMimeType;
  byteSize: number;
  sha256Hex: string;
  storageObjectPresent: boolean;
  fileVersionPublished: boolean;
}>;

type FinalizedUpload = Readonly<{
  companyFileId: string;
  companyFileVersionId: string;
  versionNumber: string;
  fileVersion: string;
}>;

type DownloadGrant = Readonly<{
  id: string;
  expiresAt: string;
}>;

type DownloadConsumption = Readonly<{
  consumptionId: string;
  companyFileVersionId: string;
  bucketId: typeof BUCKET_ID;
  objectName: string;
  signingExpiresInSeconds: number;
  signingExpiresAt: string;
  consumedAt: string;
}>;

type RouteContext<Params extends Record<string, string>> = Readonly<{
  params: Promise<Params>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && TIMESTAMPTZ_PATTERN.test(value)
    ? value
    : null;
}

function positiveBigint(value: unknown): string | null {
  return typeof value === "string" && POSITIVE_BIGINT_PATTERN.test(value)
    ? value
    : null;
}

function positiveSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? value as number
    : null;
}

function derivedRequestId(requestId: string, operation: string): string {
  const bytes = createHash("sha256")
    .update(`evo-platform-company-file:${operation}:${requestId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeFilename(value: string): string | null {
  if (
    value.length < 1 || value.length > 255 ||
    new TextEncoder().encode(value).byteLength > 1_024 ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value) || value.includes("/") ||
    value.includes("\\")
  ) {
    return null;
  }
  return value;
}

function fileExtension(value: string): string | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  return value.slice(separator + 1).toLowerCase();
}

function matchesDeclaredFileSignature(
  mimeType: PlatformCompanyFileMimeType,
  filename: string,
  bytes: Uint8Array,
): boolean {
  const extension = fileExtension(filename);
  if (!extension || !MIME_EXTENSIONS[mimeType].includes(extension)) return false;
  if (mimeType === "application/pdf") {
    return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 &&
      bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
      bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d &&
      bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    if (bytes.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  }
  if (
    mimeType === "application/msword" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.ms-powerpoint"
  ) {
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    return bytes.length >= ole.length && ole.every((byte, index) =>
      bytes[index] === byte
    );
  }
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    bytes[2] === 0x03 && bytes[3] === 0x04;
}

function normalizeReservation(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    companyFileId: string;
    mimeType: PlatformCompanyFileMimeType;
    byteSize: number;
    sha256Hex: string;
  }>,
): UploadReservation | null {
  if (!isRecord(value) || !exactKeys(value, [
    "organization_id",
    "company_file_id",
    "company_file_version_id",
    "version_no",
    "upload_reservation_id",
    "bucket_id",
    "object_name",
    "expires_at",
    "declared_mime_type",
    "byte_size",
    "sha256_hex",
    "storage_object_present",
    "file_version_published",
  ])) return null;

  const organizationId = uuid(value.organization_id);
  const companyFileId = uuid(value.company_file_id);
  const companyFileVersionId = uuid(value.company_file_version_id);
  const versionNumber = positiveBigint(value.version_no);
  const uploadReservationId = uuid(value.upload_reservation_id);
  const expiresAt = timestamp(value.expires_at);
  const byteSize = positiveSafeInteger(value.byte_size);
  if (
    organizationId !== expected.organizationId ||
    companyFileId !== expected.companyFileId || !companyFileVersionId ||
    !versionNumber || !uploadReservationId || value.bucket_id !== BUCKET_ID ||
    typeof value.object_name !== "string" ||
    !OBJECT_NAME_PATTERN.test(value.object_name) || !expiresAt ||
    value.declared_mime_type !== expected.mimeType ||
    byteSize !== expected.byteSize || value.sha256_hex !== expected.sha256Hex ||
    typeof value.storage_object_present !== "boolean" ||
    typeof value.file_version_published !== "boolean" ||
    (value.file_version_published && !value.storage_object_present)
  ) return null;

  return Object.freeze({
    organizationId,
    companyFileId,
    companyFileVersionId,
    versionNumber,
    uploadReservationId,
    bucketId: BUCKET_ID,
    objectName: value.object_name,
    expiresAt,
    declaredMimeType: expected.mimeType,
    byteSize,
    sha256Hex: expected.sha256Hex,
    storageObjectPresent: value.storage_object_present,
    fileVersionPublished: value.file_version_published,
  });
}

function normalizeFinalizedUpload(
  value: unknown,
  reservation: UploadReservation,
  expectedFileVersion: string,
): FinalizedUpload | null {
  if (!isRecord(value) || !exactKeys(value, [
    "organization_id",
    "company_file_id",
    "company_file_version_id",
    "version_no",
    "upload_finalization_id",
    "bucket_id",
    "object_name",
    "finalized_at",
    "file_version",
    "current_version_id",
  ])) return null;
  const fileVersion = positiveBigint(value.file_version);
  if (
    uuid(value.organization_id) !== reservation.organizationId ||
    uuid(value.company_file_id) !== reservation.companyFileId ||
    uuid(value.company_file_version_id) !== reservation.companyFileVersionId ||
    positiveBigint(value.version_no) !== reservation.versionNumber ||
    !uuid(value.upload_finalization_id) || value.bucket_id !== BUCKET_ID ||
    value.object_name !== reservation.objectName || !timestamp(value.finalized_at) ||
    !fileVersion ||
    BigInt(fileVersion) !== BigInt(expectedFileVersion) + BigInt(1) ||
    uuid(value.current_version_id) !== reservation.companyFileVersionId
  ) return null;
  return Object.freeze({
    companyFileId: reservation.companyFileId,
    companyFileVersionId: reservation.companyFileVersionId,
    versionNumber: reservation.versionNumber,
    fileVersion,
  });
}

function normalizeDownloadGrant(value: unknown): DownloadGrant | null {
  if (!isRecord(value) || !exactKeys(value, [
    "company_file_download_grant_id",
    "expires_at",
    "signed_url",
    "storage_api_service_sign_required",
  ])) return null;
  const id = uuid(value.company_file_download_grant_id);
  const expiresAt = timestamp(value.expires_at);
  if (
    !id || !expiresAt || value.signed_url !== null ||
    value.storage_api_service_sign_required !== true
  ) return null;
  return Object.freeze({ id, expiresAt });
}

function normalizeDownloadConsumption(
  value: unknown,
  expectedCompanyFileVersionId: string,
): DownloadConsumption | null {
  if (!isRecord(value) || !exactKeys(value, [
    "company_file_download_consumption_id",
    "company_file_version_id",
    "bucket_id",
    "object_name",
    "signing_expires_in_seconds",
    "signing_expires_at",
    "consumed_at",
  ])) return null;
  const consumptionId = uuid(value.company_file_download_consumption_id);
  const companyFileVersionId = uuid(value.company_file_version_id);
  const signingExpiresInSeconds = positiveSafeInteger(
    value.signing_expires_in_seconds,
  );
  const signingExpiresAt = timestamp(value.signing_expires_at);
  const consumedAt = timestamp(value.consumed_at);
  if (
    !consumptionId || companyFileVersionId !== expectedCompanyFileVersionId ||
    value.bucket_id !== BUCKET_ID || typeof value.object_name !== "string" ||
    !OBJECT_NAME_PATTERN.test(value.object_name) ||
    !signingExpiresInSeconds || signingExpiresInSeconds > 60 ||
    !signingExpiresAt || !consumedAt
  ) return null;
  return Object.freeze({
    consumptionId,
    companyFileVersionId,
    bucketId: BUCKET_ID,
    objectName: value.object_name,
    signingExpiresInSeconds,
    signingExpiresAt,
    consumedAt,
  });
}

async function defaultAuthorize(
  capability: DocumentCapability,
): Promise<CompanyFileAuthorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  if (!fixedRoleCan(result.actor.authorityRole, capability)) {
    return { status: "forbidden", actor: null };
  }
  return { status: "authorized", actor: result.actor };
}

const defaultDependencies: PlatformCompanyFileStorageRouteDependencies = {
  authorize: defaultAuthorize,
  createUserClient: async () => {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    return createSupabaseServerClient();
  },
  createServiceClient: () =>
    createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
  supabaseOrigin: () => new URL(getPlatformSupabaseBackendConfig().supabaseUrl).origin,
  requestId: randomUUID,
};

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: code }, { status });
}

function rpcErrorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function reservationErrorResponse(error: unknown): Response {
  const code = rpcErrorCode(error);
  if (code === "40001") return errorResponse(409, "stale_company_file");
  if (code === "PT409") return errorResponse(409, "upload_in_progress");
  if (code === "23505") return errorResponse(409, "request_conflict");
  if (code === "22023") return errorResponse(400, "invalid_upload");
  if (code === "42501") return errorResponse(403, "upload_not_authorized");
  return errorResponse(503, "storage_reservation_unconfirmed");
}

function authorizationResponse(status: CompanyFileAuthorization["status"]): Response {
  if (status === "anonymous") return errorResponse(401, "authentication_required");
  if (status === "forbidden") return errorResponse(403, "forbidden");
  return errorResponse(503, "platform_unavailable");
}

function exactUploadForm(form: FormData): Readonly<{
  file: File;
  expectedFileVersion: string;
  requestId: string;
}> | null {
  const keys = [...form.keys()].sort();
  if (
    keys.length !== 3 || keys[0] !== "expected_file_version" ||
    keys[1] !== "file" || keys[2] !== "request_id"
  ) return null;
  const file = form.get("file");
  const expectedFileVersion = positiveBigint(form.get("expected_file_version"));
  const requestId = uuid(form.get("request_id"));
  if (
    !(file instanceof File) || !expectedFileVersion || !requestId ||
    !safeFilename(file.name) || file.size < 1 || file.size > MAX_FILE_BYTES ||
    !ACCEPTED_MIME_TYPES.has(file.type)
  ) return null;
  return Object.freeze({ file, expectedFileVersion, requestId });
}

function safeSignedUrl(value: unknown, supabaseOrigin: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== supabaseOrigin ||
      !url.pathname.startsWith(`/storage/v1/object/sign/${BUCKET_ID}/`) ||
      !url.searchParams.get("token")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function readBoundedMultipartForm(
  request: Request,
  contentType: string,
): Promise<
  | Readonly<{ status: "ok"; form: FormData }>
  | Readonly<{ status: "invalid" | "too_large" }>
> {
  if (!request.body) return { status: "invalid" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
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

export function createPlatformCompanyFileUploadHandler(
  dependencies: PlatformCompanyFileStorageRouteDependencies = defaultDependencies,
) {
  return async function POST(
    request: Request,
    context: RouteContext<{ companyFileId: string }>,
  ): Promise<Response> {
    const authorization = await dependencies.authorize("documents.write");
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
    const companyFileId = uuid((await context.params).companyFileId);
    if (!companyFileId) return errorResponse(400, "invalid_company_file");
    const multipart = await readBoundedMultipartForm(request, contentType);
    if (multipart.status === "too_large") return errorResponse(413, "file_too_large");
    if (multipart.status !== "ok") return errorResponse(400, "invalid_multipart");
    const upload = exactUploadForm(multipart.form);
    if (!upload) return errorResponse(400, "invalid_upload");

    const bytes = new Uint8Array(await upload.file.arrayBuffer());
    const mimeType = upload.file.type as PlatformCompanyFileMimeType;
    if (!matchesDeclaredFileSignature(mimeType, upload.file.name, bytes)) {
      return errorResponse(400, "file_signature_mismatch");
    }
    const sha256Hex = createHash("sha256").update(bytes).digest("hex");
    if (!SHA256_PATTERN.test(sha256Hex)) {
      return errorResponse(503, "storage_unavailable");
    }

    try {
      const userClient = await dependencies.createUserClient();
      const reservationResponse = await userClient.schema("platform").rpc(
        "reserve_company_file_upload",
        {
          p_organization_id: authorization.actor.organizationId,
          p_company_file_id: companyFileId,
          p_expected_file_version: upload.expectedFileVersion,
          p_original_filename: upload.file.name,
          p_declared_mime_type: mimeType,
          p_byte_size: bytes.byteLength,
          p_sha256_hex: sha256Hex,
          p_request_id: upload.requestId,
        },
      );
      if (reservationResponse.error) {
        return reservationErrorResponse(reservationResponse.error);
      }
      const reservation = normalizeReservation(reservationResponse.data, {
        organizationId: authorization.actor.organizationId,
        companyFileId,
        mimeType,
        byteSize: bytes.byteLength,
        sha256Hex,
      });
      if (!reservation) return errorResponse(503, "storage_unavailable");

      if (!reservation.storageObjectPresent) {
        const storageResponse = await userClient.storage.from(BUCKET_ID).upload(
          reservation.objectName,
          bytes,
          { contentType: mimeType, cacheControl: "0", upsert: false },
        );
        if (storageResponse.error) {
          return errorResponse(503, "storage_upload_unconfirmed");
        }
      }

      const serviceClient = dependencies.createServiceClient();
      const finalizationResponse = await serviceClient.schema("platform").rpc(
        "finalize_company_file_upload",
        {
          p_organization_id: authorization.actor.organizationId,
          p_upload_reservation_id: reservation.uploadReservationId,
          p_request_id: derivedRequestId(upload.requestId, "finalize"),
        },
      );
      if (finalizationResponse.error) {
        if (rpcErrorCode(finalizationResponse.error) === "40001") {
          return errorResponse(409, "stale_company_file");
        }
        return errorResponse(503, "storage_finalization_unconfirmed");
      }
      const finalized = normalizeFinalizedUpload(
        finalizationResponse.data,
        reservation,
        upload.expectedFileVersion,
      );
      if (!finalized) return errorResponse(503, "storage_unavailable");

      return Response.json({
        companyFile: {
          companyFileId: finalized.companyFileId,
          companyFileVersionId: finalized.companyFileVersionId,
          versionNumber: finalized.versionNumber,
          fileVersion: finalized.fileVersion,
          originalFilename: upload.file.name,
          declaredMimeType: mimeType,
          byteSize: bytes.byteLength,
          sha256Hex,
        },
      }, { status: 201 });
    } catch {
      return errorResponse(503, "storage_unavailable");
    }
  };
}

export function createPlatformCompanyFileDownloadHandler(
  dependencies: PlatformCompanyFileStorageRouteDependencies = defaultDependencies,
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
    if (!versionId) return errorResponse(400, "invalid_company_file_version");
    try {
      const userClient = await dependencies.createUserClient();
      const grantResponse = await userClient.schema("platform").rpc(
        "grant_company_file_download",
        {
          p_organization_id: authorization.actor.organizationId,
          p_company_file_version_id: versionId,
          p_access_purpose: "staff_company_file_download",
          p_expires_in_seconds: 60,
          p_request_id: dependencies.requestId(),
        },
      );
      if (grantResponse.error) return errorResponse(403, "download_not_authorized");
      const grant = normalizeDownloadGrant(grantResponse.data);
      if (!grant) return errorResponse(503, "storage_unavailable");

      const serviceClient = dependencies.createServiceClient();
      const consumptionResponse = await serviceClient.schema("platform").rpc(
        "consume_company_file_download_grant",
        {
          p_organization_id: authorization.actor.organizationId,
          p_company_file_download_grant_id: grant.id,
          p_request_id: dependencies.requestId(),
        },
      );
      if (consumptionResponse.error) {
        return errorResponse(403, "download_grant_invalid");
      }
      const consumption = normalizeDownloadConsumption(
        consumptionResponse.data,
        versionId,
      );
      if (!consumption) return errorResponse(503, "storage_unavailable");

      const signedResponse = await serviceClient.storage
        .from(consumption.bucketId)
        .createSignedUrl(
          consumption.objectName,
          consumption.signingExpiresInSeconds,
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
