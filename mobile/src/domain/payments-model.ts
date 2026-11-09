// Подписи и тон начислений: порт paymentStatus/paymentCategory из
// src/components/portal/admission/presentation.ts (веб).
import type { PortalStrings } from "@web/lib/portal/i18n";

import type { PortalTone } from "@/domain/documents-model";
import type { StudentPortalPayment } from "@/domain/portal-source";

type AdmissionStrings = PortalStrings<"admission">;

export function paymentStatusPresentation(payment: StudentPortalPayment, strings: AdmissionStrings): Readonly<{ label: string; tone: PortalTone }> {
  const tone: PortalTone = payment.status === "paid" ? "ok" : payment.overdue || payment.status === "overdue" ? "danger" : payment.status === "partially_paid" ? "warn" : "neutral";
  return { label: strings[`payStatus.${payment.status}`] ?? strings.statusUnavailable, tone };
}

export function paymentCategoryLabel(payment: StudentPortalPayment, strings: AdmissionStrings): string | null {
  return strings[`payCategory.${payment.category}`] ?? null;
}

/** Блок «Как оплатить» показывается только когда у ключа есть текст владельца (#1359). */
export function hasHowToPay(text: string): boolean {
  return text.trim().length > 0;
}
