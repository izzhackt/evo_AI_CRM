// Подписи и тон начислений и записей истории: порт paymentStatus/paymentCategory из
// src/components/portal/admission/presentation.ts (веб) и PaymentsView.tsx.
import type { PaymentEntry, PaymentDue } from "@web/lib/portal/payment-center";
import type { PortalStrings } from "@web/lib/portal/i18n";

import type { PortalTone } from "@/domain/documents-model";

type AdmissionStrings = PortalStrings<"admission">;
type DueStatusInput = Pick<PaymentDue, "status" | "overdue" | "category">;

export function paymentStatusPresentation(payment: Pick<DueStatusInput, "status" | "overdue">, strings: AdmissionStrings): Readonly<{ label: string; tone: PortalTone }> {
  const tone: PortalTone = payment.status === "paid" ? "ok" : payment.overdue || payment.status === "overdue" ? "danger" : payment.status === "partially_paid" ? "warn" : "neutral";
  return { label: strings[`payStatus.${payment.status}`] ?? strings.statusUnavailable, tone };
}

export function paymentCategoryLabel(payment: Pick<DueStatusInput, "category">, strings: AdmissionStrings): string | null {
  return strings[`payCategory.${payment.category}`] ?? null;
}

/** Статус записи истории: принято - ok, на проверке - info, отклонено - danger. */
export function entryStatusPresentation(entry: Pick<PaymentEntry, "status">, strings: AdmissionStrings): Readonly<{ label: string; tone: PortalTone }> {
  if (entry.status === "accepted") return { label: strings.receiptStatusAccepted, tone: "ok" };
  if (entry.status === "rejected") return { label: strings.receiptStatusRejected, tone: "danger" };
  return { label: strings.receiptStatusReview, tone: "info" };
}

/** Вид записи: возврат, оплата или чек. */
export function entryKindLabel(entry: Pick<PaymentEntry, "kind">, strings: AdmissionStrings): string {
  return entry.kind === "refund" ? strings.receiptKindRefund : entry.kind === "payment" ? strings.receiptKindPayment : strings.receiptKindReceipt;
}

/** `YYYY-MM-DD` -> `дд.мм.гггг` (день по Бишкеку приходит готовым, часовой пояс не применяется). */
export function formatEntryDay(day: string): string {
  const [year, month, date] = day.split("-");
  return year && month && date ? `${date}.${month}.${year}` : day;
}
