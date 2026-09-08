import type { PillTone } from "@/components/v3/Pill";
import type {
  StudentPortalApplication,
  StudentPortalDocument,
  StudentPortalDocumentAction,
  StudentPortalEvoAction,
  StudentPortalOverview,
  StudentPortalPayment,
  StudentPortalVisa,
} from "@/lib/v3/portal-source";
import {
  allDayDate,
  applicationStatus,
  documentReviewDecision,
  documentSlotStatus,
  paymentObligationCategory,
  paymentObligationStatus,
  studentOperationalStage,
  taskStatus,
  visaStatus,
} from "@/lib/v3/wording";

export type PortalStatusPresentation = Readonly<{
  label: string | null;
  tone: PillTone;
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

export function overviewStage(
  overview: StudentPortalOverview,
): PortalStatusPresentation {
  return {
    label: studentOperationalStage(overview.operationalStage),
    tone: "neutral",
  };
}

export function studentActionDueLabel(
  action: StudentPortalDocumentAction,
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
  const tone: PillTone = document.status === "approved"
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

export function applicationStatusPresentation(
  application: StudentPortalApplication,
): PortalStatusPresentation {
  const tone: PillTone = application.status === "enrolled" || application.status === "offer"
    ? "ok"
    : application.status === "rejected"
      ? "danger"
      : application.status === "submitted" || application.status === "under_review"
        ? "info"
        : "neutral";
  return { label: applicationStatus(application.status), tone };
}

export function visaStatusPresentation(
  visa: StudentPortalVisa,
): PortalStatusPresentation {
  const tone: PillTone = visa.status === "approved"
    ? "ok"
    : visa.status === "rejected"
      ? "danger"
      : visa.status === "submitted" || visa.status === "appointment"
        ? "info"
        : "neutral";
  return { label: visaStatus(visa.status), tone };
}

export function paymentStatus(
  payment: StudentPortalPayment,
): PortalStatusPresentation {
  const tone: PillTone = payment.status === "paid"
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
