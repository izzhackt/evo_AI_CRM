/**
 * Презентационные помощники «Моего поступления» (PORT-5d, дизайн-контракт §7).
 * Перенос src/components/v3/portal/presentation.ts в портальный мир Атласа:
 * логика и данные НЕ меняются — только дом компонентов. Доменные статусы
 * читаются из src/lib/v3/wording.ts через этот файл (разрешённое исключение
 * дизайн-контракта: «доменные статусы через локализуемый портальный слой»).
 */
import type {
  StudentPortalDocument,
  StudentPortalDocumentAction,
  StudentPortalEvoAction,
  StudentPortalNotification,
  StudentPortalPayment,
} from "@/lib/v3/portal-source";
import {
  allDayDate,
  documentReviewDecision,
  documentSlotStatus,
  paymentObligationCategory,
  paymentObligationStatus,
  taskStatus,
} from "@/lib/v3/wording";

/** Тональности статус-пилюли Атласа (соответствуют прежним PillTone). */
export type PortalStatusTone = "neutral" | "info" | "ok" | "warn" | "danger";

export type PortalStatusPresentation = Readonly<{
  label: string | null;
  tone: PortalStatusTone;
}>;

const BISHKEK_DATE_TIME = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Bishkek",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatPortalTimestamp(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? BISHKEK_DATE_TIME.format(date) : null;
}

export function formatPortalMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function documentProgress(documents: readonly Pick<StudentPortalDocument, "status">[]) {
  return {
    approved: documents.filter((document) => document.status === "approved").length,
    inReview: documents.filter((document) => document.status === "submitted").length,
    corrections: documents.filter((document) => document.status === "correction_required" || document.status === "rejected").length,
    missing: documents.filter((document) => document.status === "required").length,
  };
}

export function studentActionDueLabel(
  action: Pick<StudentPortalDocumentAction, "dueAt">,
): string | null {
  return formatPortalTimestamp(action.dueAt);
}

export function evoActionDueLabel(action: StudentPortalEvoAction): string | null {
  return action.dueOn !== null
    ? allDayDate(action.dueOn)
    : formatPortalTimestamp(action.dueAt);
}

export function evoActionStatus(
  action: StudentPortalEvoAction,
): PortalStatusPresentation {
  return {
    label: taskStatus(action.status),
    tone: action.status === "blocked"
      ? "warn"
      : action.status === "in_progress"
        ? "info"
        : "neutral",
  };
}

export function documentStatus(
  document: StudentPortalDocument,
): PortalStatusPresentation {
  const tone: PortalStatusTone = document.status === "approved"
    ? "ok"
    : document.status === "correction_required"
      ? "warn"
      : document.status === "rejected"
        ? "danger"
        : document.status === "submitted"
          ? "info"
          : "neutral";
  return { label: documentSlotStatus(document.status), tone };
}

export function documentReviewLabel(
  document: StudentPortalDocument,
): string | null {
  return documentReviewDecision(document.reviewDecision);
}

export function paymentStatus(
  payment: StudentPortalPayment,
): PortalStatusPresentation {
  const tone: PortalStatusTone = payment.status === "paid"
    ? "ok"
    : payment.overdue || payment.status === "overdue"
      ? "danger"
      : payment.status === "partially_paid"
        ? "warn"
        : "neutral";
  return { label: paymentObligationStatus(payment.status), tone };
}

export function paymentCategory(payment: StudentPortalPayment): string | null {
  return paymentObligationCategory(payment.category);
}

export type PortalNotificationTarget = Readonly<{ href: string; label: string }>;

/**
 * One deep link per notification, derived from the durable `category` (and
 * `case_help_answer`, the one event code with its own detail route). The
 * `application`/`visa` categories the retired «Заявки и виза» screen used
 * (S5) never existed in any emitted notification, and every other unknown
 * or new category prefix falls through to the overview rather than a dead
 * end (`/portal/applications` itself now only redirects there too).
 */
export function portalNotificationTarget(
  notification: Pick<StudentPortalNotification, "notificationId" | "category" | "eventCode">,
): PortalNotificationTarget {
  if (notification.eventCode === "case_help_answer") {
    return {
      href: `/portal/notifications/${notification.notificationId}`,
      label: "Прочитать ответ куратора",
    };
  }
  if (notification.category.startsWith("document")) {
    return { href: "/portal/documents", label: "Открыть документы" };
  }
  if (notification.category.startsWith("payment")) {
    return { href: "/portal/payments", label: "Открыть оплату" };
  }
  return { href: "/portal", label: "Открыть поступление" };
}
