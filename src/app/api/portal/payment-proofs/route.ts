import { createStudentPaymentProofUploadHandler } from "../../../../lib/server/student-payment-proof-route-handlers.ts";

// «Чек студента к уже принятой оплате» (миграция 360): студент прикладывает файл к принятой оплате, сессия или Bearer приложения.
// Только доказательство: деньги и статус оплаты не меняются.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createStudentPaymentProofUploadHandler();
