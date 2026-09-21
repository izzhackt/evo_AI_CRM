import { decodeReceiptUploadTarget, decodeReceiptDownloadTarget, receiptTargetErrorStatus } from "../payment-receipt-target.ts";
import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  ClamdScanError,
  isClamdMalwareScanProof,
  scanBytesWithClamd,
} from "./clamd-malware-scanner.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

/**
 * Upload/download route handlers for the «Договор и оплата» block's contract
 * and receipt files (188_platform_case_agreement). Deliberately NOT built on
 * top of createPlatformDocumentUploadHandler/createPlatformDocumentDownloadHandler
 * (platform-document-storage-route-handlers.ts): that pipeline is hard-wired
 * to platform.document_slots (a slot reservation, a student-audience scan
 * lease, a preflight RPC, a Storage-reservation RPC — none of which exist for
 * these two new, simpler, staff-only tables) and its own authorization
 * factory hard-codes the `documents.write` fixed-role capability, which the
 * Sales role does not hold and must not need to hold here (this feature's
 * write door is the resource-scoped `case.update.append` check already
 * proven by `platform.staff_case_agreement_v1`'s `can_write` field — reused
 * below instead of inventing a second capability check). What IS reused
 * unchanged: the bucket, the 25MB/pdf/jpeg/png limits, sha256 hashing and the
 * ClamAV scan helpers (`scanBytesWithClamd`/`ClamdScanError`/
 * `isClamdMalwareScanProof`), and the service-role-gated metadata-RPC
 * finalize step — the same shape platform.record_document_version_metadata
 * uses.
 *
 * Deliberate simplification vs. the document pipeline (documented, not an
 * oversight): no resumable/TUS transport (25MB fits an ordinary upload), no
 * separate "reserve" RPC before the bytes land in Storage (the metadata RPC
 * is the only durable record, so a client that disconnects mid-upload simply
 * leaves an orphaned, unreferenced Storage object — acceptable for this
 * feature's lower risk profile: internal staff-only file access, not a
 * public or student-facing surface), and downloads use a direct
 * authorize-then-sign call instead of the document pipeline's persistent
 * grant/consume audit-trail RPC pair — same core security property (a
 * short-lived, authorization-checked signed URL), less ceremony.
 */

const BUCKET_ID = "platform-documents";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === "00000000-0000-0000-0000-000000000000"
    ? null
    : normalized;
}

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: code }, { status });
}

/** Cheap magic-byte check — not exported by the document pipeline, so
 * re-derived here rather than trusting the client-declared MIME type alone. */
function matchesSignature(declaredMimeType: string, bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  if (declaredMimeType === "application/pdf") {
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
      bytes[3] === 0x46;
  }
  if (declaredMimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (declaredMimeType === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47;
  }
  return false;
}

async function readValidatedUpload(
  request: Request,
): Promise<
  | Readonly<{
      status: "ok";
      bytes: Uint8Array;
      declaredMimeType: string;
      originalFilename: string;
      sha256Hex: string;
    }>
  | Readonly<{ status: "error"; response: Response }>
> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES + 1024 * 1024) {
    return { status: "error", response: errorResponse(413, "file_too_large") };
  }
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data")) {
    return { status: "error", response: errorResponse(415, "multipart_required") };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { status: "error", response: errorResponse(400, "invalid_multipart") };
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return { status: "error", response: errorResponse(400, "invalid_upload") };
  }
  const declaredMimeType = file.type.toLowerCase();
  if (!ACCEPTED_MIME_TYPES.has(declaredMimeType)) {
    return { status: "error", response: errorResponse(415, "unsupported_mime_type") };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES) {
    return { status: "error", response: errorResponse(413, "file_too_large") };
  }
  if (!matchesSignature(declaredMimeType, bytes)) {
    return { status: "error", response: errorResponse(400, "file_signature_mismatch") };
  }
  const originalFilename = typeof file.name === "string" && file.name.trim() !== ""
    ? file.name.slice(0, 500)
    : "file";
  const sha256Hex = createHash("sha256").update(bytes).digest("hex");
  if (!SHA256_PATTERN.test(sha256Hex)) {
    return { status: "error", response: errorResponse(503, "storage_unavailable") };
  }
  return { status: "ok", bytes, declaredMimeType, originalFilename, sha256Hex };
}

async function scanOrRespond(
  bytes: Uint8Array,
  expectedSha256Hex: string,
): Promise<Readonly<{ status: "ok" }> | Readonly<{ status: "error"; response: Response }>> {
  try {
    const proof = await scanBytesWithClamd(bytes);
    if (!isClamdMalwareScanProof(proof, expectedSha256Hex)) {
      return { status: "error", response: errorResponse(503, "malware_scan_unconfirmed") };
    }
    return { status: "ok" };
  } catch (error) {
    if (error instanceof ClamdScanError && error.code === "infected") {
      return { status: "error", response: errorResponse(422, "malware_detected") };
    }
    return { status: "error", response: errorResponse(503, "malware_scanner_unavailable") };
  }
}

async function resolveWritableCaseActor(organizationId: string, studentCaseId: string) {
  const { createSupabaseServerClient } = await import("../supabase/server.ts");
  const userClient = await createSupabaseServerClient();
  const { data, error } = await userClient.schema("platform").rpc(
    "staff_case_agreement_v1",
    { p_student_case_id: studentCaseId },
  );
  if (
    error || !data || typeof data !== "object" || Array.isArray(data) ||
    (data as Record<string, unknown>).organization_id !== organizationId ||
    (data as Record<string, unknown>).can_write !== true
  ) {
    return null;
  }
  return userClient;
}

export function createCaseContractFileUploadHandler() {
  return async function POST(
    request: Request,
    context: { params: Promise<{ studentCaseId: string }> },
  ): Promise<Response> {
    const { resolvePlatformActor } = await import("../platform-auth.ts");
    const actorResult = await resolvePlatformActor();
    if (actorResult.status !== "authenticated") {
      return errorResponse(actorResult.status === "anonymous" ? 401 : 503, "unavailable");
    }
    const studentCaseId = uuid((await context.params).studentCaseId);
    if (!studentCaseId) return errorResponse(400, "invalid_student_case");
    if (!await resolveWritableCaseActor(actorResult.actor.organizationId, studentCaseId)) {
      return errorResponse(403, "case_agreement_forbidden");
    }

    const upload = await readValidatedUpload(request);
    if (upload.status === "error") return upload.response;
    const scan = await scanOrRespond(upload.bytes, upload.sha256Hex);
    if (scan.status === "error") return scan.response;

    const objectName =
      `case-contracts/${actorResult.actor.organizationId}/${studentCaseId}/${randomUUID()}`;
    const serviceClient = createPlatformSupabaseServiceClient(
      getPlatformSupabaseBackendConfig(),
    );
    const uploadResponse = await serviceClient.storage.from(BUCKET_ID).upload(
      objectName,
      upload.bytes,
      { contentType: upload.declaredMimeType, upsert: false },
    );
    if (uploadResponse.error) return errorResponse(503, "storage_unavailable");

    const metadataResponse = await serviceClient.schema("platform").rpc(
      "record_case_contract_file_metadata",
      {
        p_organization_id: actorResult.actor.organizationId,
        p_student_case_id: studentCaseId,
        p_uploaded_by_membership_id: actorResult.actor.membershipId,
        p_original_filename: upload.originalFilename,
        p_declared_mime_type: upload.declaredMimeType,
        p_byte_size: upload.bytes.byteLength,
        p_sha256_hex: upload.sha256Hex,
        p_storage_object_name: objectName,
        p_request_id: randomUUID(),
      },
    );
    if (metadataResponse.error) {
      await serviceClient.storage.from(BUCKET_ID).remove([objectName]);
      return errorResponse(503, "storage_unavailable");
    }
    return Response.json(metadataResponse.data, { status: 201 });
  };
}

export function createPaymentReceiptFileUploadHandler() {
  return async function POST(
    request: Request,
    context: { params: Promise<{ paymentEventId: string }> },
  ): Promise<Response> {
    try {
    const { resolvePlatformActor } = await import("../platform-auth.ts");
    const actorResult = await resolvePlatformActor();
    if (actorResult.status !== "authenticated") {
      return errorResponse(actorResult.status === "anonymous" ? 401 : 503, "unavailable");
    }
    const paymentEventId = uuid((await context.params).paymentEventId);
    if (!paymentEventId) return errorResponse(400, "invalid_payment_event");

    const serviceClient = createPlatformSupabaseServiceClient(
      getPlatformSupabaseBackendConfig(),
    );
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    const userClient = await createSupabaseServerClient();
    const targetResponse = await userClient.schema("platform").rpc(
      "staff_payment_receipt_upload_target_v1", { p_payment_event_id: paymentEventId },
    );
    if (targetResponse.error) return errorResponse(receiptTargetErrorStatus(targetResponse.error),
      targetResponse.error.code === "42501" ? "case_agreement_forbidden" : "receipt_target_unavailable");
    const target = decodeReceiptUploadTarget(targetResponse.data, actorResult.actor.organizationId, paymentEventId);
    if (!target) return errorResponse(503, "receipt_target_unavailable");
    const studentCaseId = target.studentCaseId;

    const upload = await readValidatedUpload(request);
    if (upload.status === "error") return upload.response;
    const scan = await scanOrRespond(upload.bytes, upload.sha256Hex);
    if (scan.status === "error") return scan.response;

    const objectName =
      `payment-receipts/${actorResult.actor.organizationId}/${studentCaseId}/${randomUUID()}`;
    const uploadResponse = await serviceClient.storage.from(BUCKET_ID).upload(
      objectName,
      upload.bytes,
      { contentType: upload.declaredMimeType, upsert: false },
    );
    if (uploadResponse.error) return errorResponse(503, "storage_unavailable");

    const metadataResponse = await serviceClient.schema("platform").rpc(
      "record_payment_receipt_file_metadata",
      {
        p_organization_id: actorResult.actor.organizationId,
        p_payment_event_id: paymentEventId,
        p_uploaded_by_membership_id: actorResult.actor.membershipId,
        p_original_filename: upload.originalFilename,
        p_declared_mime_type: upload.declaredMimeType,
        p_byte_size: upload.bytes.byteLength,
        p_sha256_hex: upload.sha256Hex,
        p_storage_object_name: objectName,
        p_request_id: randomUUID(),
      },
    );
    if (metadataResponse.error) {
      await serviceClient.storage.from(BUCKET_ID).remove([objectName]);
      return errorResponse(receiptTargetErrorStatus(metadataResponse.error),
        metadataResponse.error.code === "42501" ? "case_agreement_forbidden" : "storage_unavailable");
    }
    return Response.json(metadataResponse.data, { status: 201 });
    } catch {
      return errorResponse(503, "receipt_unavailable");
    }
  };
}

async function signAndRedirect(
  organizationId: string,
  studentCaseId: string,
  table: "case_contract_files" | "payment_receipt_files",
  fileId: string,
): Promise<Response> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const actorResult = await resolvePlatformActor();
  if (actorResult.status !== "authenticated") {
    return errorResponse(actorResult.status === "anonymous" ? 401 : 503, "unavailable");
  }
  if (actorResult.actor.organizationId !== organizationId) {
    return errorResponse(403, "case_agreement_forbidden");
  }
  const { createSupabaseServerClient } = await import("../supabase/server.ts");
  const userClient = await createSupabaseServerClient();
  const readResponse = await userClient.schema("platform").rpc(
    "staff_case_agreement_v1",
    { p_student_case_id: studentCaseId },
  );
  if (readResponse.error) return errorResponse(403, "case_agreement_forbidden");

  const serviceClient = createPlatformSupabaseServiceClient(
    getPlatformSupabaseBackendConfig(),
  );
  const fileLookup = await serviceClient.schema("platform")
    .from(table)
    .select("storage_object_name, student_case_id")
    .eq("organization_id", organizationId)
    .eq("id", fileId)
    .maybeSingle();
  if (
    fileLookup.error || !fileLookup.data ||
    fileLookup.data.student_case_id !== studentCaseId
  ) {
    return errorResponse(404, "file_not_found");
  }
  const signedResponse = await serviceClient.storage.from(BUCKET_ID).createSignedUrl(
    fileLookup.data.storage_object_name as string,
    60,
    { download: true },
  );
  if (signedResponse.error) return errorResponse(503, "storage_signing_unavailable");
  return Response.redirect(signedResponse.data.signedUrl, 307);
}

export function createCaseContractFileDownloadHandler() {
  return async function GET(
    _request: Request,
    context: { params: Promise<{ studentCaseId: string; fileId: string }> },
  ): Promise<Response> {
    const { resolvePlatformActor } = await import("../platform-auth.ts");
    const actorResult = await resolvePlatformActor();
    if (actorResult.status !== "authenticated") {
      return errorResponse(actorResult.status === "anonymous" ? 401 : 503, "unavailable");
    }
    const params = await context.params;
    const studentCaseId = uuid(params.studentCaseId);
    const fileId = uuid(params.fileId);
    if (!studentCaseId || !fileId) return errorResponse(400, "invalid_request");
    return signAndRedirect(
      actorResult.actor.organizationId,
      studentCaseId,
      "case_contract_files",
      fileId,
    );
  };
}

export function createPaymentReceiptFileDownloadHandler() {
  return async function GET(
    _request: Request,
    context: { params: Promise<{ studentCaseId: string; fileId: string }> },
  ): Promise<Response> {
    try {
    const { resolvePlatformActor } = await import("../platform-auth.ts");
    const actorResult = await resolvePlatformActor();
    if (actorResult.status !== "authenticated") {
      return errorResponse(actorResult.status === "anonymous" ? 401 : 503, "unavailable");
    }
    const params = await context.params;
    const studentCaseId = uuid(params.studentCaseId);
    const fileId = uuid(params.fileId);
    if (!studentCaseId || !fileId) return errorResponse(400, "invalid_request");
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    const userClient = await createSupabaseServerClient();
    const targetResponse = await userClient.schema("platform").rpc(
      "staff_payment_receipt_download_target_v1", { p_student_case_id: studentCaseId, p_file_id: fileId },
    );
    if (targetResponse.error) return errorResponse(receiptTargetErrorStatus(targetResponse.error),
      targetResponse.error.code === "42501" ? "case_agreement_forbidden" : "receipt_target_unavailable");
    const target = decodeReceiptDownloadTarget(targetResponse.data, actorResult.actor.organizationId, studentCaseId, fileId);
    if (!target) return errorResponse(503, "receipt_target_unavailable");
    const serviceClient = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
    const signedResponse = await serviceClient.storage.from(BUCKET_ID).createSignedUrl(target.storageObjectName, 60, { download: true });
    if (signedResponse.error) return errorResponse(503, "storage_signing_unavailable");
    return Response.redirect(signedResponse.data.signedUrl, 307);
    } catch {
      return errorResponse(503, "receipt_unavailable");
    }
  };
}
