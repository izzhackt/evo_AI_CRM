import { createPaymentDetailsSaveHandler } from "../../../../../lib/server/student-payment-receipts-route-handlers.ts";

// «Настройки -> Реквизиты для оплаты» (миграция 358): текст и QR, одни на всех студентов. Только администратор, sameOrigin, не просмотр роли.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createPaymentDetailsSaveHandler();
