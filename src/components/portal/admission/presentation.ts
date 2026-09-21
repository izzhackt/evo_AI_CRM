/**
 * Презентационные помощники «Моего поступления» (PORT-5d → PORT-6a,
 * дизайн-контракт §7). Доменные статусы больше не читаются из staff-словаря
 * src/lib/v3/wording.ts напрямую: они живут в портальном неймспейсе
 * `admission` (src/lib/portal/i18n.ts, RU-значения байт-в-байт равны
 * staff-словарю — закреплено в tests/portal-i18n.test.mjs) и потому
 * локализуемы на KY. Из wording.ts остаётся только allDayDate — чистое
 * форматирование даты, не словарь.
 */
import type {
  StudentPortalDocument,
  StudentPortalDocumentAction,
  StudentPortalEvoAction,
  StudentPortalNotification,
  StudentPortalPayment,
} from "@/lib/v3/portal-source";
import type { PortalStrings } from "@/lib/portal/i18n";
import { allDayDate } from "@/lib/v3/wording";

type AdmissionStrings = PortalStrings<"admission">;

/**
 * Честный lookup доменного значения: неожиданный runtime-ключ — это
 * «статус недоступен», не пустота и не исключение (прежняя семантика
 * lookup() из wording.ts).
 */
function domainLabel(
  strings: AdmissionStrings,
  prefix: "docStatus" | "reviewDecision" | "payStatus" | "payCategory" | "taskStatus",
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const key = `${prefix}.${value}`;
  return Object.hasOwn(strings, key)
    ? (strings as Readonly<Record<string, string>>)[key]
    : null;
}

/** Тональности статус-пилюли Атласа (соответствуют прежним PillTone). */
export type PortalStatusTone = "neutral" | "info" | "ok" | "warn" | "danger";

export type PortalStatusPresentation = Readonly<{
  label: string;
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
  strings: AdmissionStrings,
): PortalStatusPresentation {
  return {
    label: domainLabel(strings, "taskStatus", action.status) ?? strings.statusUnavailable,
    tone: action.status === "blocked"
      ? "warn"
      : action.status === "in_progress"
        ? "info"
        : "neutral",
  };
}

export function documentStatus(
  document: StudentPortalDocument,
  strings: AdmissionStrings,
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
  return {
    label: domainLabel(strings, "docStatus", document.status) ?? strings.statusUnavailable,
    tone,
  };
}

export function documentReviewLabel(
  document: StudentPortalDocument,
  strings: AdmissionStrings,
): string | null {
  return domainLabel(strings, "reviewDecision", document.reviewDecision);
}

export function paymentStatus(
  payment: StudentPortalPayment,
  strings: AdmissionStrings,
): PortalStatusPresentation {
  const tone: PortalStatusTone = payment.status === "paid"
    ? "ok"
    : payment.overdue || payment.status === "overdue"
      ? "danger"
      : payment.status === "partially_paid"
        ? "warn"
        : "neutral";
  return {
    label: domainLabel(strings, "payStatus", payment.status) ?? strings.statusUnavailable,
    tone,
  };
}

export function paymentCategory(
  payment: StudentPortalPayment,
  strings: AdmissionStrings,
): string | null {
  return domainLabel(strings, "payCategory", payment.category);
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
  strings: AdmissionStrings,
): PortalNotificationTarget {
  if (notification.eventCode === "application_document_review") {
    return { href: `/portal/document-notifications/${notification.notificationId}`, label: strings.targetProgramDocument };
  }
  if (notification.eventCode === "case_help_answer") {
    return {
      href: `/portal/notifications/${notification.notificationId}`,
      label: strings.targetReply,
    };
  }
  if (notification.category.startsWith("document")) {
    return { href: "/portal/documents", label: strings.targetDocuments };
  }
  if (notification.category.startsWith("payment")) {
    return { href: "/portal/payments", label: strings.targetPayments };
  }
  return { href: "/portal", label: strings.targetOverview };
}
