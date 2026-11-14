import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BUCKET_ID,
  errorResponse,
  readValidatedUpload,
  scanOrRespond,
  uuid,
} from "./platform-case-agreement-storage-route-handlers.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import { cleanReceiptFilename, sameOrigin } from "./student-payment-receipts-route-handlers.ts";

/**
 * «Чек студента к уже принятой оплате» (миграция 360): `POST /api/portal/payment-proofs`.
 * Студент прикладывает файл (фото или PDF) к оплате, которую сотрудник уже записал и принял без файла. Только доказательство: новой
 * оплаты нет, итоги и статус не меняются, куратор ничего не проверяет. Файл ложится туда же, куда ложатся чеки сотрудников
 * (`payment_receipt_files`, объект `payment-receipts/<организация>/<дело>/…`), поэтому строка оплаты в CRM показывает ссылку сама.
 * Сессия (cookie, тот же Origin) или Bearer приложения. Вся проверка принадлежности - в базе (`student_payment_proof_target_v1` до
 * загрузки, `record_student_payment_proof_v1` под блокировкой дела после); файл проходит ту же проверку размера, сигнатуры и ClamAV,
 * что чеки 358. Повтор безопасен по `Idempotency-Key`: повтор уже записанного запроса база узнаёт ещё на проверке перед загрузкой и
 * отвечает прежним результатом (200), ничего не сканируя и не загружая; тот же ключ с другим файлом - 409 `request_conflict`.
 * Текст ошибок базы наружу не выходит: только коды.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

type ActorOutcome = Readonly<{ status: string; reason?: string }>;

export type StudentPaymentProofUploadDependencies = Readonly<{
  resolveBearerActor: (accessToken: string) => Promise<ActorOutcome>;
  createBearerClient: (accessToken: string) => Promise<SupabaseClient> | SupabaseClient;
  createCookieClient: () => Promise<SupabaseClient>;
  resolveCookieActor: () => Promise<ActorOutcome>;
  createServiceClient: () => SupabaseClient;
}>;

/** Ошибка базы -> код ответа. «Файл уже есть» - 409 `proof_exists`: страница после него показывает уже приложенный файл. */
function proofFailure(error: { code?: string; message?: string }): Response {
  const message = typeof error.message === "string" ? error.message : "";
  if (error.code === "42501") return errorResponse(403, "receipt_forbidden");
  if (error.code === "23505") return errorResponse(409, message === "proof_exists" ? "proof_exists" : "request_conflict");
  if (error.code === "22023") return errorResponse(400, "receipt_invalid");
  return errorResponse(503, "receipt_unavailable");
}

export function createStudentPaymentProofUploadHandler(overrides?: Partial<StudentPaymentProofUploadDependencies>) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const { studentPortalDocumentRouteTransport } = await import("./platform-document-storage-route-handlers.ts");
      const transport = studentPortalDocumentRouteTransport(request);
      if (transport.transport === "invalid_bearer") return errorResponse(401, "unauthorized");
      let userClient: SupabaseClient;
      if (transport.transport === "bearer") {
        const resolve: StudentPaymentProofUploadDependencies["resolveBearerActor"] = overrides?.resolveBearerActor ?? (async (token: string) => {
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
        const resolve: StudentPaymentProofUploadDependencies["resolveCookieActor"] = overrides?.resolveCookieActor ?? (async () => {
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

      const rawEvent = upload.form.get("payment_event_id");
      const paymentEventId = typeof rawEvent === "string" ? uuid(rawEvent.trim()) : null;
      if (!paymentEventId) return errorResponse(400, "invalid_fields");
      const keyHeader = request.headers.get("Idempotency-Key");
      const requestId = keyHeader === null ? randomUUID() : uuid(keyHeader);
      if (!requestId) return errorResponse(400, "invalid_fields");

      // Принадлежность и «файла ещё нет» проверяет база до того, как хоть один байт попадёт в Storage.
      const target = await userClient.schema("platform").rpc("student_payment_proof_target_v1", {
        p_payment_event_id: paymentEventId,
        p_request_id: requestId,
        p_sha256_hex: upload.sha256Hex,
      });
      if (target.error) return proofFailure(target.error);
      const row = target.data as Record<string, unknown> | null;
      const organizationId = row ? uuid(row.organization_id) : null;
      const studentCaseId = row ? uuid(row.student_case_id) : null;
      const studentMembershipId = row ? uuid(row.student_membership_id) : null;
      if (!organizationId || !studentCaseId || !studentMembershipId || !row || row.payment_event_id !== paymentEventId) {
        return errorResponse(503, "receipt_unavailable");
      }
      // Тот же запрос уже записан (повтор после потерянного ответа): прежний результат, байты не сканируются и не загружаются.
      if (row.replay !== undefined) {
        const earlier = row.replay as Record<string, unknown> | null;
        const earlierId = earlier ? uuid(earlier.payment_receipt_file_id) : null;
        if (!earlier || !earlierId || typeof earlier.original_filename !== "string") return errorResponse(503, "receipt_unavailable");
        return Response.json({ payment_receipt_file_id: earlierId, original_filename: earlier.original_filename }, { status: 200, headers: NO_STORE });
      }

      const scan = await scanOrRespond(upload.bytes, upload.sha256Hex);
      if (scan.status === "error") return scan.response;

      const objectName = `payment-receipts/${organizationId}/${studentCaseId}/${randomUUID()}`;
      const service = (overrides?.createServiceClient ?? (() => createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig())))();
      const stored = await service.storage.from(BUCKET_ID).upload(objectName, upload.bytes, { contentType: upload.declaredMimeType, upsert: false });
      if (stored.error) return errorResponse(503, "receipt_unavailable");
      const recorded = await service.schema("platform").rpc("record_student_payment_proof_v1", {
        p_organization_id: organizationId,
        p_student_membership_id: studentMembershipId,
        p_payment_event_id: paymentEventId,
        p_original_filename: cleanReceiptFilename(upload.originalFilename),
        p_declared_mime_type: upload.declaredMimeType,
        p_byte_size: upload.bytes.byteLength,
        p_sha256_hex: upload.sha256Hex,
        p_storage_object_name: objectName,
        p_request_id: requestId,
      });
      if (recorded.error) {
        await service.storage.from(BUCKET_ID).remove([objectName]);
        return proofFailure(recorded.error);
      }
      const result = recorded.data as Record<string, unknown> | null;
      const fileId = result ? uuid(result.payment_receipt_file_id) : null;
      if (!result || !fileId || typeof result.original_filename !== "string") {
        await service.storage.from(BUCKET_ID).remove([objectName]);
        return errorResponse(503, "receipt_unavailable");
      }
      // Повтор того же запроса вернул уже записанный файл: свежий объект не нужен.
      if (result.replayed === true) await service.storage.from(BUCKET_ID).remove([objectName]);
      return Response.json(
        { payment_receipt_file_id: fileId, original_filename: result.original_filename },
        { status: result.replayed === true ? 200 : 201, headers: NO_STORE },
      );
    } catch {
      return errorResponse(503, "receipt_unavailable");
    }
  };
}
