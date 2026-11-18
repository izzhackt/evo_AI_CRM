// Подписи и тон начислений и записей истории: порт paymentStatus/paymentCategory из
// src/components/portal/admission/presentation.ts (веб) и PaymentsView.tsx.
import type { PaymentEntry, PaymentDue } from "@web/lib/portal/payment-center";
import { amountCopyValue, amountToPayMinor, nextUnpaidTranche, type HowToPayAmount } from "@web/lib/portal/how-to-pay";
import type { PortalStrings } from "@web/lib/portal/i18n";

import type { PortalTone } from "@/domain/documents-model";
import { formatPortalDeadline, formatPortalMoney } from "@/domain/presentation";

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

/**
 * Строка «Сумма к оплате» в «Как оплатить»: ближайший неоплаченный транш, остаток минус чеки на проверке
 * (веб: PaymentsView.tsx, #1476). Платить нечего - `null`, строки суммы нет.
 */
export function howToPayAmount(dues: readonly PaymentDue[]): HowToPayAmount | null {
  const next = nextUnpaidTranche(dues);
  if (!next) return null;
  const toPay = amountToPayMinor(next);
  return {
    display: formatPortalMoney(toPay, next.currency),
    dueOn: next.dueAt ? formatPortalDeadline(next.dueAt) : null,
    copyValue: amountCopyValue(toPay),
    overdue: next.overdue,
  };
}

/**
 * У принятой оплаты без файла студент прикладывает файл как доказательство (миграция 360, веб: payment-rows.ts, #1458).
 * Новой оплаты нет, итоги и статус не меняются, куратор ничего не проверяет.
 */
export function canAttachProof(entry: Pick<PaymentEntry, "kind" | "status" | "fileId">, canUpload: boolean): boolean {
  return canUpload && entry.kind === "payment" && entry.status === "accepted" && entry.fileId === null;
}
