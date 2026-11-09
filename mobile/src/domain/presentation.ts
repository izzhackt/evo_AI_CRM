// Подписи и форматы «Главной» и «Поступления»: порт чистых частей
// src/components/portal/admission/presentation.ts и OverviewView.tsx (веб).
// Веб-файлы нельзя импортировать: они тянут алиас `@/` веба и React DOM.
import type { PortalStrings } from "@web/lib/portal/i18n";

import type { StudentPortalAction, StudentPortalEvoAction, StudentPortalNotification } from "@/domain/portal-source";

type AdmissionStrings = PortalStrings<"admission">;

const BISHKEK_DATE = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Bishkek",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const BISHKEK_DATE_TIME = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Bishkek",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Срок для студента: только дата по Бишкеку. */
export function formatPortalDeadline(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? BISHKEK_DATE.format(date) : null;
}

export function formatPortalTimestamp(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? BISHKEK_DATE_TIME.format(date) : null;
}

/** Целые суммы без «,00»; сомы словом «сом» (одинаково для RU и KY), как в вебе. */
export function formatPortalMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  const minimumFractionDigits = Number.isInteger(major) ? 0 : 2;
  if (currency === "KGS") {
    return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits, maximumFractionDigits: 2 }).format(major)} сом`;
  }
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    minimumFractionDigits,
    maximumFractionDigits: 2,
  }).format(major);
}

export function studentActionDueLabel(action: Pick<StudentPortalAction, "dueAt">): string | null {
  return formatPortalDeadline(action.dueAt);
}

/** «Загрузите документ: Паспорт», «Оплата: Первый взнос» (HomeCase.actionTitle). */
export function actionTitle(action: StudentPortalAction, strings: AdmissionStrings): string {
  const verb = action.kind === "payment" ? strings.actionPayment : action.kind === "upload_document" ? strings.actionUpload : strings.actionReplace;
  return `${verb}: ${action.label}`;
}

/** Куда ведёт действие: вкладка приложения. Якорь слота документа поймёт M2. */
export type ActionTarget = Readonly<{ route: "/documents" | "/payments"; slotId: string | null }>;

export function actionTarget(action: StudentPortalAction): ActionTarget {
  return action.kind === "payment" ? { route: "/payments", slotId: null } : { route: "/documents", slotId: action.documentSlotId };
}

// ---- этапы дела (OverviewView.tsx, PORT-8c) ------------------------------------

const STAGE_KEYS = [
  "contract_confirmed",
  "admissions_handoff",
  "intake",
  "profile_and_route",
  "documents",
  "applications",
  "decisions",
  "visa_and_predeparture",
  "arrival_and_adaptation",
  "completed",
  "closed",
] as const;

/** Порядок этапов дела для дорожки; «closed» не шаг пути. */
export const ADMISSION_STAGE_PATH = STAGE_KEYS.filter((key) => key !== "closed");
export type AdmissionStageKey = (typeof ADMISSION_STAGE_PATH)[number];

export function stageLabel(stage: string, strings: AdmissionStrings): string | null {
  const normalized = stage.trim();
  if (!normalized) return null;
  const known = STAGE_KEYS.find((key) => key === normalized);
  return known ? strings[`stage.${known}`] : strings.stageCustom;
}

/** Индекс этапа на дорожке; -1: нестандартный этап или `closed`. */
export function stageIndex(stage: string | null): number {
  if (!stage) return -1;
  return ADMISSION_STAGE_PATH.findIndex((key) => key === stage.trim());
}

// ---- уведомления ----------------------------------------------------------------

export function portalNotificationText(
  notification: Pick<StudentPortalNotification, "eventCode" | "subjectLabel" | "detail">,
  strings: AdmissionStrings,
): Readonly<{ title: string; detail: string | null }> {
  // Сообщение команды хранится по-русски, на экран идёт на языке студента.
  if (notification.eventCode === "case_chat_message") {
    return { title: strings.caseChatNotificationTitle, detail: strings.caseChatNotificationDetail };
  }
  return { title: notification.subjectLabel, detail: notification.detail };
}

export type NotificationRoute = "/documents" | "/payments" | "/messages/chat" | "/messages/updates" | "/overview";

/**
 * Цель уведомления по `category` и `eventCode` (portalNotificationTarget, веб). Сообщение
 * команды ведёт в чат. Ответ куратора и проверка пакета или документа вуза показываются
 * в ленте «Что нового» развёрнутым текстом уведомления (отдельные страницы разбора
 * веба в приложении пока не нужны). Любая новая категория ведёт в «Поступление».
 */
export function notificationRoute(notification: Pick<StudentPortalNotification, "category" | "eventCode">): NotificationRoute {
  if (notification.eventCode === "case_chat_message") return "/messages/chat";
  if (
    notification.eventCode === "application_package_review" ||
    notification.eventCode === "application_document_review" ||
    notification.eventCode === "case_help_answer"
  ) {
    return "/messages/updates";
  }
  if (notification.category.startsWith("document")) return "/documents";
  if (notification.category.startsWith("payment")) return "/payments";
  return "/overview";
}

/** Подпись ссылки уведомления (portalNotificationTarget.label, веб); `null`, когда ссылки нет. */
export function notificationTargetLabel(notification: Pick<StudentPortalNotification, "category" | "eventCode">, strings: AdmissionStrings): string | null {
  switch (notificationRoute(notification)) {
    case "/messages/chat":
      return strings.targetMessages;
    case "/messages/updates":
      return null;
    case "/documents":
      return strings.targetDocuments;
    case "/payments":
      return strings.targetPayments;
    default:
      return strings.targetOverview;
  }
}

export type EvoActionTone = "neutral" | "info" | "warn";

export function evoActionTone(action: StudentPortalEvoAction): EvoActionTone {
  return action.status === "blocked" ? "warn" : action.status === "in_progress" ? "info" : "neutral";
}

/** «2026-11-20» -> «20.11.2026» (allDayDate, веб). */
export function allDayDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return match ? `${match[3]}.${match[2]}.${match[1]}` : null;
}

export function evoActionDueLabel(action: StudentPortalEvoAction): string | null {
  return action.dueOn !== null ? allDayDate(action.dueOn) : formatPortalDeadline(action.dueAt);
}

export function evoActionStatusLabel(action: StudentPortalEvoAction, strings: AdmissionStrings): string {
  const key = `taskStatus.${action.status}` as const;
  return Object.hasOwn(strings, key) ? strings[key] : strings.statusUnavailable;
}

// ---- ссылки веба -> маршруты приложения ----------------------------------------

export type LinkTarget = Readonly<{ kind: "route"; route: string }> | Readonly<{ kind: "external"; url: string }>;

/**
 * Ссылки контента ведут на страницы веба (`/portal/csca`) или на внешние сайты. В
 * приложении `/portal/<раздел>` становится вкладкой `/<раздел>`, `/portal` пустой
 * путь: «Поступление». Внешние адреса открывает браузер. Прочее (неизвестный
 * относительный адрес) в приложение не ведёт: `null`.
 */
export function linkTarget(href: string): LinkTarget | null {
  if (/^https:\/\//i.test(href)) return { kind: "external", url: href };
  if (href === "/portal") return { kind: "route", route: "/overview" };
  const match = /^\/portal\/([a-z-]+)(?:[/?#].*)?$/.exec(href);
  if (!match) return null;
  return { kind: "route", route: `/${match[1]}` };
}
