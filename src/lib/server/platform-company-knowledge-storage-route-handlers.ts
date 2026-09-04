import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fixedRoleCan, type FixedRoleCapability } from "../fixed-role-policy.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const BUCKET_ID = "platform-knowledge-files";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_NAME_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{62}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const ACCEPTED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

type DocumentCapability = Extract<FixedRoleCapability, "documents.read" | "documents.write">;
type Authorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "unavailable"; actor: null }>;
export type PlatformCompanyKnowledgeStorageRouteDependencies = Readonly<{
  authorize(capability: DocumentCapability): Promise<Authorization>;
  createUserClient(): Promise<SupabaseClient>;
  createServiceClient(): SupabaseClient;
  supabaseOrigin(): string;
  randomUuid(): string;
}>;
type RouteContext<P extends Record<string, string>> = Readonly<{ params: Promise<P> }>;
type Upload = Readonly<{
  file: File;
  folderId: string | null;
  suppliedFileId: string | null;
  expectedVersion: number | null;
  requestId: string;
}>;
type UploadReservation = Readonly<{
  organizationId: string;
  reservationId: string;
  fileId: string;
  folderId: string | null;
  fileName: string;
  expectedVersion: number | null;
  bucketId: typeof BUCKET_ID;
  objectName: string;
  contentType: string;
  byteSize: number;
  sha256Hex: string;
  expiresAt: string;
}>;
type FinalizedUpload = Readonly<{
  fileId: string;
  fileVersionId: string;
  version: number;
  fileVersionNumber: number;
}>;
type DownloadGrant = Readonly<{
  organizationId: string;
  grantId: string;
  fileId: string;
  fileVersionId: string;
  bucketId: typeof BUCKET_ID;
  objectName: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256Hex: string;
  expiresAt: string;
  createdAt: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === "00000000-0000-0000-0000-000000000000" ? null : normalized;
}
function optionalUuid(value: FormDataEntryValue | null): string | null | undefined {
  return value === "" ? null : (uuid(value) ?? undefined);
}
function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}
function safeFilename(value: string): string | null {
  return value.length >= 1 && value.length <= 255 && value === value.trim()
      && !CONTROL_CHARACTER_PATTERN.test(value)
      && !value.includes("/") && !value.includes("\\")
    ? value : null;
}
function exactUploadForm(form: FormData): Upload | null {
  const keys = [...form.keys()].sort();
  if (keys.length !== 5 || keys.join("|") !== "expected_version|file|file_id|folder_id|request_id") return null;
  const file = form.get("file");
  const folderId = optionalUuid(form.get("folder_id"));
  const suppliedFileId = optionalUuid(form.get("file_id"));
  const rawExpectedVersion = form.get("expected_version");
  const expectedVersion = rawExpectedVersion === "" ? null
    : typeof rawExpectedVersion === "string" && /^[1-9]\d*$/.test(rawExpectedVersion)
      ? positiveInteger(Number(rawExpectedVersion)) : null;
  const requestId = uuid(form.get("request_id"));
  if (!(file instanceof File) || folderId === undefined || suppliedFileId === undefined
    || !requestId || !safeFilename(file.name) || file.size < 1 || file.size > MAX_FILE_BYTES
    || !ACCEPTED_MIME_TYPES.has(file.type)
    || (suppliedFileId === null) !== (expectedVersion === null)
    || (rawExpectedVersion !== "" && expectedVersion === null)) return null;
  return Object.freeze({ file, folderId, suppliedFileId, expectedVersion, requestId });
}
function matchesDeclaredFileSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "application/pdf") {
    return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50
      && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return contentType === "image/png" && bytes.length >= 8 && bytes[0] === 0x89
    && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function normalizeReservation(
  value: unknown,
  expected: Omit<UploadReservation, "reservationId" | "bucketId" | "objectName" | "expiresAt">,
): UploadReservation | null {
  if (!isRecord(value) || !exact(value, [
    "organization_id", "reservation_id", "file_id", "folder_id", "file_name",
    "expected_version", "bucket_id", "object_name", "content_type", "byte_size",
    "sha256_hex", "expires_at", "created_at",
  ])) return null;
  const reservationId = uuid(value.reservation_id);
  const folderId = value.folder_id === null ? null : uuid(value.folder_id);
  const expiresAt = timestamp(value.expires_at);
  if (value.organization_id !== expected.organizationId || !reservationId
    || value.file_id !== expected.fileId || folderId !== expected.folderId
    || value.file_name !== expected.fileName || value.expected_version !== expected.expectedVersion
    || value.bucket_id !== BUCKET_ID || typeof value.object_name !== "string"
    || !OBJECT_NAME_PATTERN.test(value.object_name) || value.content_type !== expected.contentType
    || value.byte_size !== expected.byteSize || value.sha256_hex !== expected.sha256Hex
    || !expiresAt || !timestamp(value.created_at)) return null;
  return Object.freeze({ ...expected, reservationId, bucketId: BUCKET_ID, objectName: value.object_name, expiresAt });
}
function normalizeFinalization(value: unknown, r: UploadReservation): FinalizedUpload | null {
  if (!isRecord(value) || !exact(value, [
    "organization_id", "reservation_id", "file_id", "folder_id", "file_name",
    "version", "file_version_id", "file_version_no", "bucket_id", "object_name",
    "content_type", "byte_size", "sha256_hex", "finalized_at",
  ])) return null;
  const version = positiveInteger(value.version);
  const fileVersionNumber = positiveInteger(value.file_version_no);
  const fileVersionId = uuid(value.file_version_id);
  const expectedVersion = r.expectedVersion === null ? 1 : r.expectedVersion + 1;
  if (value.organization_id !== r.organizationId || value.reservation_id !== r.reservationId
    || value.file_id !== r.fileId || value.folder_id !== r.folderId || value.file_name !== r.fileName
    || version !== expectedVersion || !fileVersionId || !fileVersionNumber
    || value.bucket_id !== r.bucketId || value.object_name !== r.objectName
    || value.content_type !== r.contentType || value.byte_size !== r.byteSize
    || value.sha256_hex !== r.sha256Hex || !timestamp(value.finalized_at)) return null;
  return Object.freeze({ fileId: r.fileId, fileVersionId, version, fileVersionNumber });
}
const GRANT_KEYS = [
  "organization_id", "grant_id", "file_id", "file_version_id", "bucket_id", "object_name",
  "file_name", "content_type", "byte_size", "sha256_hex", "expires_at", "created_at",
] as const;
function normalizeGrant(value: unknown, organizationId: string, fileVersionId: string): DownloadGrant | null {
  if (!isRecord(value) || !exact(value, GRANT_KEYS)) return null;
  const grantId = uuid(value.grant_id);
  const fileId = uuid(value.file_id);
  const expiresAt = timestamp(value.expires_at);
  const createdAt = timestamp(value.created_at);
  if (value.organization_id !== organizationId || !grantId || !fileId
    || value.file_version_id !== fileVersionId || value.bucket_id !== BUCKET_ID
    || typeof value.object_name !== "string" || !OBJECT_NAME_PATTERN.test(value.object_name)
    || typeof value.file_name !== "string" || !safeFilename(value.file_name)
    || !ACCEPTED_MIME_TYPES.has(String(value.content_type)) || !positiveInteger(value.byte_size)
    || typeof value.sha256_hex !== "string" || !SHA256_PATTERN.test(value.sha256_hex)
    || !expiresAt || !createdAt) return null;
  return Object.freeze({
    organizationId, grantId, fileId, fileVersionId, bucketId: BUCKET_ID,
    objectName: value.object_name, fileName: value.file_name, contentType: String(value.content_type),
    byteSize: Number(value.byte_size), sha256Hex: value.sha256_hex, expiresAt, createdAt,
  });
}
function normalizeConsumption(value: unknown, grant: DownloadGrant): DownloadGrant | null {
  const consumptionKeys = [
    ...GRANT_KEYS.filter((key) => key !== "created_at"),
    "consumed_at",
  ];
  if (!isRecord(value) || !exact(value, consumptionKeys)) return null;
  const { consumed_at: consumedAt, ...grantValue } = value;
  if (!timestamp(consumedAt)) return null;
  const normalized = normalizeGrant(
    { ...grantValue, created_at: grant.createdAt },
    grant.organizationId,
    grant.fileVersionId,
  );
  if (!normalized || normalized.grantId !== grant.grantId || normalized.fileId !== grant.fileId
    || normalized.objectName !== grant.objectName || normalized.fileName !== grant.fileName
    || normalized.contentType !== grant.contentType || normalized.byteSize !== grant.byteSize
    || normalized.sha256Hex !== grant.sha256Hex || normalized.expiresAt !== grant.expiresAt
    || normalized.createdAt !== grant.createdAt) return null;
  return normalized;
}

async function defaultAuthorize(capability: DocumentCapability): Promise<Authorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  if (!fixedRoleCan(result.actor.authorityRole, capability)) return { status: "forbidden", actor: null };
  return { status: "authorized", actor: result.actor };
}
const defaultDependencies: PlatformCompanyKnowledgeStorageRouteDependencies = {
  authorize: defaultAuthorize,
  createUserClient: async () => {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    return createSupabaseServerClient();
  },
  createServiceClient: () => createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
  supabaseOrigin: () => new URL(getPlatformSupabaseBackendConfig().supabaseUrl).origin,
  randomUuid: randomUUID,
};
function errorResponse(status: number, code: string): Response {
  return Response.json({ error: code }, { status });
}
function authorizationResponse(status: Authorization["status"]): Response {
  if (status === "anonymous") return errorResponse(401, "authentication_required");
  if (status === "forbidden") return errorResponse(403, "forbidden");
  return errorResponse(503, "platform_unavailable");
}
function rpcUploadError(error: unknown): Response {
  if (!isRecord(error)) return errorResponse(503, "storage_unavailable");
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  if (code === "42501") return errorResponse(403, "upload_not_authorized");
  if (code === "PT409" && /version_conflict/i.test(message)) return errorResponse(409, "stale_version");
  if (code === "23505" && /request/i.test(message)) return errorResponse(409, "request_conflict");
  if (code === "22023") return errorResponse(400, "invalid_upload");
  return errorResponse(503, "storage_unavailable");
}
function rpcIsPermissionDenied(error: unknown): boolean {
  return isRecord(error) && error.code === "42501";
}
function safeSignedUrl(value: unknown, origin: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.origin === origin
        && parsed.pathname.startsWith(`/storage/v1/object/sign/${BUCKET_ID}/`)
        && parsed.searchParams.get("token")
      ? parsed.toString() : null;
  } catch { return null; }
}
async function readBoundedMultipartForm(request: Request, contentType: string): Promise<
  | Readonly<{ status: "ok"; form: FormData }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "too_large" }>
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
  } catch { return { status: "invalid" }; }
  finally { reader.releaseLock(); }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { status: "ok", form: await new Response(body, { headers: { "content-type": contentType } }).formData() };
  } catch { return { status: "invalid" }; }
}

export function createPlatformCompanyKnowledgeUploadHandler(
  dependencies: PlatformCompanyKnowledgeStorageRouteDependencies = defaultDependencies,
) {
  return async function POST(request: Request): Promise<Response> {
    const authorization = await dependencies.authorize("documents.write");
    if (authorization.status !== "authorized") return authorizationResponse(authorization.status);
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) return errorResponse(413, "file_too_large");
    const contentType = request.headers.get("content-type");
    if (!contentType?.startsWith("multipart/form-data;")) return errorResponse(415, "multipart_required");
    const multipart = await readBoundedMultipartForm(request, contentType);
    if (multipart.status === "too_large") return errorResponse(413, "file_too_large");
    if (multipart.status === "invalid") return errorResponse(400, "invalid_multipart");
    const upload = exactUploadForm(multipart.form);
    if (!upload) return errorResponse(400, "invalid_upload");
    const bytes = new Uint8Array(await upload.file.arrayBuffer());
    if (!matchesDeclaredFileSignature(upload.file.type, bytes)) return errorResponse(400, "file_signature_mismatch");
    const sha256Hex = createHash("sha256").update(bytes).digest("hex");
    const fileId = upload.suppliedFileId ?? uuid(dependencies.randomUuid());
    if (!fileId || !SHA256_PATTERN.test(sha256Hex)) return errorResponse(503, "storage_unavailable");
    try {
      const userClient = await dependencies.createUserClient();
      const reservationResponse = await userClient.schema("platform").rpc(
        "reserve_company_knowledge_file_upload",
        {
          p_folder_id: upload.folderId, p_file_id: fileId, p_file_name: upload.file.name,
          p_content_type: upload.file.type, p_byte_size: bytes.byteLength, p_sha256: sha256Hex,
          p_request_id: upload.requestId, p_expected_version: upload.expectedVersion,
        },
      );
      if (reservationResponse.error) return rpcUploadError(reservationResponse.error);
      const reservation = normalizeReservation(reservationResponse.data, {
        organizationId: authorization.actor.organizationId, fileId, folderId: upload.folderId,
        fileName: upload.file.name, expectedVersion: upload.expectedVersion,
        contentType: upload.file.type, byteSize: bytes.byteLength, sha256Hex,
      });
      if (!reservation) return errorResponse(503, "storage_unavailable");
      const serviceClient = dependencies.createServiceClient();
      const storageResponse = await serviceClient.storage.from(BUCKET_ID).upload(
        reservation.objectName, bytes,
        {
          contentType: upload.file.type,
          cacheControl: "0",
          upsert: false,
          metadata: { sha256: reservation.sha256Hex },
        },
      );
      const storageDisagrees = !storageResponse.error
        && (!storageResponse.data || storageResponse.data.path !== reservation.objectName);
      const finalizationResponse = await serviceClient.schema("platform").rpc(
        "finalize_company_knowledge_file_upload", { p_reservation_id: reservation.reservationId },
      );
      if (finalizationResponse.error) {
        return errorResponse(503, storageResponse.error
          ? "storage_upload_unconfirmed" : "storage_finalization_unconfirmed");
      }
      const finalized = normalizeFinalization(finalizationResponse.data, reservation);
      if (!finalized || storageDisagrees) return errorResponse(503, "storage_identity_mismatch");
      return Response.json({ file: {
        fileId: finalized.fileId, fileVersionId: finalized.fileVersionId,
        version: finalized.version, fileVersionNumber: finalized.fileVersionNumber,
        name: reservation.fileName, contentType: reservation.contentType,
        byteSize: reservation.byteSize, sha256Hex: reservation.sha256Hex,
      } }, { status: 201 });
    } catch { return errorResponse(503, "storage_unavailable"); }
  };
}

export function createPlatformCompanyKnowledgeDownloadHandler(
  dependencies: PlatformCompanyKnowledgeStorageRouteDependencies = defaultDependencies,
) {
  return async function GET(
    _request: Request,
    context: RouteContext<{ fileVersionId: string }>,
  ): Promise<Response> {
    const authorization = await dependencies.authorize("documents.read");
    if (authorization.status !== "authorized") return authorizationResponse(authorization.status);
    const fileVersionId = uuid((await context.params).fileVersionId);
    const requestId = uuid(dependencies.randomUuid());
    if (!fileVersionId) return errorResponse(400, "invalid_file_version");
    if (!requestId) return errorResponse(503, "storage_unavailable");
    try {
      const userClient = await dependencies.createUserClient();
      const grantResponse = await userClient.schema("platform").rpc(
        "grant_company_knowledge_file_download",
        { p_file_version_id: fileVersionId, p_request_id: requestId },
      );
      if (grantResponse.error) {
        return rpcIsPermissionDenied(grantResponse.error)
          ? errorResponse(403, "download_not_authorized")
          : errorResponse(503, "storage_unavailable");
      }
      const grant = normalizeGrant(grantResponse.data, authorization.actor.organizationId, fileVersionId);
      if (!grant) return errorResponse(503, "storage_unavailable");
      const serviceClient = dependencies.createServiceClient();
      const consumptionResponse = await serviceClient.schema("platform").rpc(
        "consume_company_knowledge_file_download_grant", { p_grant_id: grant.grantId },
      );
      if (consumptionResponse.error) {
        return rpcIsPermissionDenied(consumptionResponse.error)
          ? errorResponse(403, "download_grant_invalid")
          : errorResponse(503, "storage_unavailable");
      }
      const consumption = normalizeConsumption(consumptionResponse.data, grant);
      if (!consumption) return errorResponse(503, "storage_unavailable");
      const remainingSeconds = Math.ceil((Date.parse(consumption.expiresAt) - Date.now()) / 1000);
      if (!Number.isSafeInteger(remainingSeconds) || remainingSeconds < 1) return errorResponse(403, "download_grant_expired");
      const signedResponse = await serviceClient.storage.from(BUCKET_ID).createSignedUrl(
        consumption.objectName, Math.min(60, remainingSeconds), { download: consumption.fileName },
      );
      if (signedResponse.error) return errorResponse(503, "storage_signing_unavailable");
      const signedUrl = safeSignedUrl(signedResponse.data.signedUrl, dependencies.supabaseOrigin());
      return signedUrl ? Response.redirect(signedUrl, 307) : errorResponse(503, "storage_unavailable");
    } catch { return errorResponse(503, "storage_unavailable"); }
  };
}
