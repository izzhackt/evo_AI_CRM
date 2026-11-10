import { createStudentPaymentReceiptUploadHandler } from "../../../../lib/server/student-payment-receipts-route-handlers.ts";

// «Чеки от студента» (миграция 358): студент прикладывает чек (фото или PDF), сессия или Bearer приложения. Чек остаётся «на проверке».
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createStudentPaymentReceiptUploadHandler();
