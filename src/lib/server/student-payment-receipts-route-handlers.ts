import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { receiptAmountToMinor } from "../portal/payment-center.ts";
import {
  BUCKET_ID,
  errorResponse,
  readValidatedUpload,
  scanOrRespond,
  uuid,
} from "./platform-case-agreement-storage-route-handlers.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

/**
 * «Чеки от студента» и «Реквизиты для оплаты» (миграция 358): маршруты загрузки файлов.
 *  - `POST /api/portal/payment-receipts` - студент прикладывает чек (фото или PDF) к платежу или без платежа. Сессия (cookie) или
 *    Bearer приложения; вся проверка принадлежности - в базе (`student_payment_receipt_target_v1`), файл проходит ту же проверку
 *    размера, сигнатуры и ClamAV, что чеки сотрудников; метаданные пишет служебная команда с проверкой на повтор.
 *  - `GET /api/v2/student-payment-receipts/{id}/download` - сотрудник открывает чек студента (право читает база).
 *  - `POST /api/v3/settings/payment-details` / `GET .../qr` - администратор сохраняет реквизиты (текст и QR) и смотрит QR.
 * Деньги здесь не двигаются: чек остаётся «на проверке» до решения сотрудника.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;
const QR_MAX_BYTES = 5 * 1024 * 1024;
const QR_MIME = new Set(["image/jpeg", "image/png"]);

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const host = request.headers.get("host")?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
    return origin === parsed.origin && !!host && !host.includes(",") && !/\s/u.test(host)
      && parsed.host === host.toLowerCase()
      && (forwardedProto === undefined || /^(?:http|https)$/u.test(forwardedProto))
      && parsed.protocol === (forwardedProto ? `${forwardedProto}:` : new URL(request.url).protocol);
  } catch {
    return false;
  }
}

/** Имя файла идёт на страницу студента и в журнал: управляющие знаки долой, длина - по символам (не по байтам), пустое - «file». */
export function cleanReceiptFilename(name: string): string {
  const clean = Array.from(name.replace(/[\u0000-\u001F\u007F]/g, "").trim()).slice(0, 255).join("").trim();
  return clean === "" ? "file" : clean;
}

/** Текст реквизитов: управляющие знаки кроме перевода строки, возврата каретки и табуляции убираются (страница студента их не примет). */
export function cleanPaymentDetailsText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bishkek" });
}

function isoDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

function rpcFailure(error: { code?: string; message?: string }): Response {
  const message = typeof error.message === "string" ? error.message : "";
  if (error.code === "42501") return errorResponse(403, "receipt_forbidden");
  if (error.code === "23505") return errorResponse(409, message === "receipt_duplicate" ? "receipt_duplicate" : "request_conflict");
  if (error.code === "22023") {
    if (message === "receipt_too_many") return errorResponse(429, "receipt_too_many");
    const known = ["receipt_currency_mismatch", "receipt_invalid_date", "receipt_invalid"].find((code) => message === code);
    return errorResponse(400, known ?? "receipt_invalid");
  }
  return errorResponse(503, "receipt_unavailable");
}

type ActorOutcome = Readonly<{ status: string; reason?: string }>;

export type StudentPaymentReceiptUploadDependencies = Readonly<{
  resolveBearerActor: (accessToken: string) => Promise<ActorOutcome>;
  createBearerClient: (accessToken: string) => Promise<SupabaseClient> | SupabaseClient;
  createCookieClient: () => Promise<SupabaseClient>;
  resolveCookieActor: () => Promise<ActorOutcome>;
  createServiceClient: () => SupabaseClient;
}>;

export function createStudentPaymentReceiptUploadHandler(overrides?: Partial<StudentPaymentReceiptUploadDependencies>) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const { studentPortalDocumentRouteTransport } = await import("./platform-document-storage-route-handlers.ts");
      const transport = studentPortalDocumentRouteTransport(request);
      if (transport.transport === "invalid_bearer") return errorResponse(401, "unauthorized");
      let userClient: SupabaseClient;
      if (transport.transport === "bearer") {
        const resolve: StudentPaymentReceiptUploadDependencies["resolveBearerActor"] = overrides?.resolveBearerActor ?? (async (token: string) => {
          const { resolveStudentPortalBearerActor } = await import("../student-portal-auth.ts");
          return resolveStudentPortalBearerActor(token);
        });
        const actor = await resolve(transport.accessToken);
        if (actor.status !== "authenticated") {
          if (actor.reason === "student_authority_unavailable") return errorResponse(503, "receipt_unavailable");
          return actor.reason === "student_authority_invalid" ? errorResponse(403, "receipt_forbidden") : errorResponse(401, "unauthorized");
        }
        userClient = await (overrides?.createBearerClient ?? (async (token: string) => {
          const { createSupabaseBearerServerClient } = await import("../supabase/server.ts");
          return createSupabaseBearerServerClient(token);
        }))(transport.accessToken);
      } else {
        // Браузер: cookie-сессия требует тот же Origin (защита от подделки запроса); приложение (Bearer) Origin не шлёт.
        if (!sameOrigin(request)) return errorResponse(403, "receipt_forbidden");
        const resolve: StudentPaymentReceiptUploadDependencies["resolveCookieActor"] = overrides?.resolveCookieActor ?? (async () => {
          const { resolveStudentPortalActor } = await import("../student-portal-auth.ts");
          return resolveStudentPortalActor();
        });
        const actor = await resolve();
        if (actor.status !== "authenticated") {
          return actor.status === "anonymous" ? errorResponse(401, "authentication_required")
            : actor.reason === "student_authority_unavailable" ? errorResponse(503, "receipt_unavailable") : errorResponse(403, "receipt_forbidden");
        }
        userClient = await (overrides?.createCookieClient ?? (async () => {
          const { createSupabaseServerClient } = await import("../supabase/server.ts");
          return createSupabaseServerClient();
        }))();
      }

      const upload = await readValidatedUpload(request);
      if (upload.status === "error") return upload.response;

      const rawDue = upload.form.get("payment_obligation_id");
      const dueText = typeof rawDue === "string" ? rawDue.trim() : "";
      const obligationId = dueText === "" ? null : uuid(dueText);
      if (dueText !== "" && !obligationId) return errorResponse(400, "invalid_fields");
      const amountText = upload.form.get("amount");
      const amountMinor = typeof amountText === "string" ? receiptAmountToMinor(amountText) : null;
      const currencyText = upload.form.get("currency");
      const currency = typeof currencyText === "string" ? currencyText.trim().toUpperCase() : "";
      const paidOn = isoDay(upload.form.get("paid_on"));
      if (!amountMinor || !/^[A-Z]{3}$/.test(currency) || !paidOn) return errorResponse(400, "invalid_fields");
      if (Date.parse(`${paidOn}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`) > 86_400_000) return errorResponse(400, "receipt_invalid_date");
      const keyHeader = request.headers.get("Idempotency-Key");
      const requestId = keyHeader === null ? randomUUID() : uuid(keyHeader);
      if (!requestId) return errorResponse(400, "invalid_fields");

      const target = await userClient.schema("platform").rpc("student_payment_receipt_target_v1", { p_payment_obligation_id: obligationId });
      if (target.error) return rpcFailure(target.error);
      const row = target.data as Record<string, unknown> | null;
      const organizationId = row ? uuid(row.organization_id) : null;
      const studentCaseId = row ? uuid(row.student_case_id) : null;
      const studentMembershipId = row ? uuid(row.student_membership_id) : null;
      if (!organizationId || !studentCaseId || !studentMembershipId) return errorResponse(503, "receipt_unavailable");

      const scan = await scanOrRespond(upload.bytes, upload.sha256Hex);
      if (scan.status === "error") return scan.response;

      const objectName = `payment-receipts/${organizationId}/${studentCaseId}/${randomUUID()}`;
      const service = (overrides?.createServiceClient ?? (() => createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig())))();
      const stored = await service.storage.from(BUCKET_ID).upload(objectName, upload.bytes, { contentType: upload.declaredMimeType, upsert: false });
      if (stored.error) return errorResponse(503, "receipt_unavailable");
      const recorded = await service.schema("platform").rpc("record_student_payment_receipt_v1", {
        p_organization_id: organizationId,
        p_student_membership_id: studentMembershipId,
        p_student_case_id: studentCaseId,
        p_payment_obligation_id: obligationId,
        p_amount_minor: amountMinor,
        p_currency: currency,
        p_paid_on: paidOn,
        p_original_filename: cleanReceiptFilename(upload.originalFilename),
        p_declared_mime_type: upload.declaredMimeType,
        p_byte_size: upload.bytes.byteLength,
        p_sha256_hex: upload.sha256Hex,
        p_storage_object_name: objectName,
        p_request_id: requestId,
      });
      if (recorded.error) {
        await service.storage.from(BUCKET_ID).remove([objectName]);
        return rpcFailure(recorded.error);
      }
      const result = recorded.data as Record<string, unknown> | null;
      if (!result || typeof result.receipt_id !== "string") {
        await service.storage.from(BUCKET_ID).remove([objectName]);
        return errorResponse(503, "receipt_unavailable");
      }
      // Повтор того же запроса вернул уже записанный чек: свежий объект не нужен.
      if (result.replayed === true) await service.storage.from(BUCKET_ID).remove([objectName]);
      return Response.json({ receipt_id: result.receipt_id, status: result.status }, { status: result.replayed === true ? 200 : 201, headers: NO_STORE });
    } catch {
      return errorResponse(503, "receipt_unavailable");
    }
  };
}

export function createStaffStudentReceiptDownloadHandler() {
  return async function GET(_request: Request, context: { params: Promise<{ receiptId: string }> }): Promise<Response> {
    try {
      const { resolvePlatformActor } = await import("../platform-auth.ts");
      const actorResult = await resolvePlatformActor();
      if (actorResult.status !== "authenticated") return errorResponse(actorResult.status === "anonymous" ? 401 : 503, "unavailable");
      const receiptId = uuid((await context.params).receiptId);
      if (!receiptId) return errorResponse(400, "invalid_request");
      const { createSupabaseServerClient } = await import("../supabase/server.ts");
      const userClient = await createSupabaseServerClient();
      const target = await userClient.schema("platform").rpc("staff_student_receipt_download_target_v1", { p_receipt_id: receiptId });
      if (target.error) return errorResponse(target.error.code === "42501" ? 403 : 503, "receipt_forbidden");
      const row = target.data as Record<string, unknown> | null;
      const name = row && typeof row.storage_object_name === "string" ? row.storage_object_name : "";
      const prefix = `payment-receipts/${actorResult.actor.organizationId}/`;
      if (!row || row.receipt_id !== receiptId || !name.startsWith(prefix) || name.length > 512) return errorResponse(503, "receipt_unavailable");
      const service = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
      const signed = await service.storage.from(BUCKET_ID).createSignedUrl(name, 60, { download: true });
      if (signed.error) return errorResponse(503, "storage_signing_unavailable");
      return new Response(null, { status: 307, headers: { ...NO_STORE, Location: signed.data.signedUrl } });
    } catch {
      return errorResponse(503, "receipt_unavailable");
    }
  };
}

type AdminGate = Readonly<{ organizationId: string; membershipId: string; userClient: SupabaseClient }>;

async function resolveAdmin(request: Request, requireOrigin: boolean): Promise<AdminGate | Response> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const actorResult = await resolvePlatformActor();
  if (actorResult.status !== "authenticated") return errorResponse(actorResult.status === "anonymous" ? 401 : 503, "unavailable");
  if (requireOrigin && !sameOrigin(request)) return errorResponse(403, "payment_details_forbidden");
  const { isStaffPreview } = await import("../platform-access.ts");
  if (isStaffPreview(actorResult.actor)) return errorResponse(403, "payment_details_forbidden");
  const { createSupabaseServerClient } = await import("../supabase/server.ts");
  const userClient = await createSupabaseServerClient();
  // Только системный администратор: база отвечает 42501 всем остальным.
  const gate = await userClient.schema("platform").rpc("staff_payment_details_v1");
  if (gate.error) return errorResponse(gate.error.code === "42501" ? 403 : 503, "payment_details_forbidden");
  return { organizationId: actorResult.actor.organizationId, membershipId: actorResult.actor.membershipId, userClient };
}

export function createPaymentDetailsSaveHandler() {
  return async function POST(request: Request): Promise<Response> {
    try {
      const admin = await resolveAdmin(request, true);
      if (admin instanceof Response) return admin;
      if (!(request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) return errorResponse(415, "multipart_required");
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return errorResponse(400, "invalid_multipart");
      }
      const body = form.get("text");
      const mode = form.get("qr_mode");
      const key = form.get("request_id");
      const requestId = typeof key === "string" ? uuid(key) : randomUUID();
      const cleanBody = typeof body === "string" ? cleanPaymentDetailsText(body) : null;
      if (cleanBody === null || cleanBody.length > 4000 || typeof mode !== "string" || !["keep", "replace", "remove"].includes(mode) || !requestId) {
        return errorResponse(400, "payment_details_invalid");
      }
      let qr: { bytes: Uint8Array; mime: string; name: string; sha: string; size: number } | null = null;
      if (mode === "replace") {
        const file = form.get("file");
        if (!(file instanceof File)) return errorResponse(400, "payment_details_invalid");
        const mime = file.type.toLowerCase();
        if (!QR_MIME.has(mime)) return errorResponse(415, "unsupported_mime_type");
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength < 8 || bytes.byteLength > QR_MAX_BYTES) return errorResponse(413, "file_too_large");
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        if ((mime === "image/png" && !isPng) || (mime === "image/jpeg" && !isJpeg)) return errorResponse(400, "file_signature_mismatch");
        const { createHash } = await import("node:crypto");
        const sha = createHash("sha256").update(bytes).digest("hex");
        const scan = await scanOrRespond(bytes, sha);
        if (scan.status === "error") return scan.response;
        qr = { bytes, mime, name: (file.name || "qr").slice(0, 255), sha, size: bytes.byteLength };
      }
      const service = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
      const objectName = qr ? `payment-details/${admin.organizationId}/${randomUUID()}` : null;
      if (qr && objectName) {
        const stored = await service.storage.from(BUCKET_ID).upload(objectName, qr.bytes, { contentType: qr.mime, upsert: false });
        if (stored.error) return errorResponse(503, "storage_unavailable");
      }
      const saved = await service.schema("platform").rpc("record_payment_details_v1", {
        p_organization_id: admin.organizationId,
        p_membership_id: admin.membershipId,
        p_details_text: cleanBody,
        p_qr_mode: mode,
        p_qr_original_filename: qr?.name ?? null,
        p_qr_mime_type: qr?.mime ?? null,
        p_qr_byte_size: qr?.size ?? null,
        p_qr_sha256_hex: qr?.sha ?? null,
        p_qr_storage_object_name: objectName,
        p_request_id: requestId,
      });
      if (saved.error) {
        if (objectName) await service.storage.from(BUCKET_ID).remove([objectName]);
        return errorResponse(saved.error.code === "42501" ? 403 : saved.error.code === "22023" ? 400 : 503,
          saved.error.code === "42501" ? "payment_details_forbidden" : saved.error.code === "22023" ? "payment_details_invalid" : "payment_details_unavailable");
      }
      const result = saved.data as Record<string, unknown> | null;
      if (objectName && result?.replayed === true) await service.storage.from(BUCKET_ID).remove([objectName]);
      return Response.json({ version_no: result?.version_no ?? null }, { status: 200, headers: NO_STORE });
    } catch {
      return errorResponse(503, "payment_details_unavailable");
    }
  };
}

export function createPaymentDetailsQrHandler() {
  return async function GET(request: Request): Promise<Response> {
    try {
      const admin = await resolveAdmin(request, false);
      if (admin instanceof Response) return admin;
      const current = await admin.userClient.schema("platform").rpc("staff_payment_details_v1");
      const qrId = current.data && typeof current.data === "object" ? uuid((current.data as Record<string, unknown>).qr_id) : null;
      if (!qrId) return errorResponse(404, "payment_details_not_found");
      const target = await admin.userClient.schema("platform").rpc("staff_payment_details_qr_target_v1", { p_version_id: qrId });
      if (target.error) return errorResponse(target.error.code === "42501" ? 403 : 503, "payment_details_forbidden");
      const name = (target.data as Record<string, unknown> | null)?.storage_object_name;
      if (typeof name !== "string" || !name.startsWith(`payment-details/${admin.organizationId}/`)) return errorResponse(503, "payment_details_unavailable");
      const service = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
      const signed = await service.storage.from(BUCKET_ID).createSignedUrl(name, 60);
      if (signed.error) return errorResponse(503, "storage_signing_unavailable");
      return new Response(null, { status: 307, headers: { ...NO_STORE, Location: signed.data.signedUrl } });
    } catch {
      return errorResponse(503, "payment_details_unavailable");
    }
  };
}
