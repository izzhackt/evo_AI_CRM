import { isLookerPageId, isLookerReportId } from "./looker-report-link.ts";

/**
 * Ответы `platform.organization_report_link_v1` / `_save_v1` (миграция 323) и состояние формы «Настройки → Отчёты».
 * Файл чистый: форму ответа сверяют тесты, а страница не показывает ничего, что не прошло этот разбор. Ни имени того,
 * кто менял, ни адреса в ответе нет — только ключ, идентификаторы, версия и время.
 */

export const REPORT_KEYS = ["marketing", "finance"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
export const isReportKey = (value: unknown): value is ReportKey => value === "marketing" || value === "finance";

export const REPORT_TITLE: Readonly<Record<ReportKey, string>> = { marketing: "Маркетинг", finance: "Финансы" };
/** Куда ведёт «Открыть раздел» после сохранения. */
export const REPORT_SECTION_HREF: Readonly<Record<ReportKey, string>> = { marketing: "/v3/marketing?view=reports", finance: "/v3/finance" };

export type ReportLink = Readonly<{
  reportKey: ReportKey;
  configured: boolean;
  reportId: string | null;
  pageId: string | null;
  /** 0 — строки ещё не было. */
  version: number;
  updatedAt: string | null;
}>;

/** `denied` — отказ роли (42501); `unavailable` — сбой чтения или ответ не той формы. Нуля наугад нет. */
export type ReportLinkRead =
  | Readonly<{ status: "available"; link: ReportLink }>
  | Readonly<{ status: "denied" | "unavailable" }>;

const READ_KEYS = ["configured", "organizationId", "pageId", "reportId", "reportKey", "schemaVersion", "updatedAt", "version"];
const SAVE_KEYS = [...READ_KEYS, "replayed", "status"].sort();

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
};
const isTimestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function linkFrom(value: Record<string, unknown>, expected: Readonly<{ organizationId: string; reportKey: ReportKey }>): ReportLink | null {
  const { configured, reportId, pageId, version, updatedAt } = value;
  if (value.schemaVersion !== 1 || value.organizationId !== expected.organizationId || value.reportKey !== expected.reportKey) return null;
  if (typeof configured !== "boolean" || typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return null;
  if (reportId !== null && !isLookerReportId(reportId)) return null;
  if (pageId !== null && !isLookerPageId(pageId)) return null;
  // «Подключён» значит «есть отчёт»; страница бывает только у отчёта; версия 0 — строки не было, ни времени, ни отчёта.
  if (configured !== (reportId !== null) || (pageId !== null && reportId === null)) return null;
  if (updatedAt !== null && !isTimestamp(updatedAt)) return null;
  if ((version === 0) !== (updatedAt === null) || (version === 0 && configured)) return null;
  return { reportKey: expected.reportKey, configured, reportId: reportId as string | null, pageId: pageId as string | null, version, updatedAt: updatedAt as string | null };
}

/** Строгий разбор чтения. `null` — ответ не той формы, не той организации или не того отчёта. */
export function parseReportLink(data: unknown, expected: Readonly<{ organizationId: string; reportKey: ReportKey }>): ReportLink | null {
  return isRecord(data) && hasExactKeys(data, READ_KEYS) ? linkFrom(data, expected) : null;
}

export type ReportLinkSaved = Readonly<{ status: "saved" | "unchanged"; replayed: boolean; link: ReportLink }>;

/** Строгий разбор квитанции правки. `unchanged` не двигает версию; `replayed` — повтор того же запроса. */
export function parseReportLinkSaved(data: unknown, expected: Readonly<{ organizationId: string; reportKey: ReportKey }>): ReportLinkSaved | null {
  if (!isRecord(data) || !hasExactKeys(data, SAVE_KEYS)) return null;
  if ((data.status !== "saved" && data.status !== "unchanged") || typeof data.replayed !== "boolean") return null;
  const link = linkFrom(data, expected);
  return link ? { status: data.status, replayed: data.replayed, link } : null;
}

export type ReportLinkSaveResult =
  | Readonly<{ status: "saved" | "unchanged"; link: ReportLink }>
  | Readonly<{ status: "forbidden" | "invalid" | "version_conflict" | "request_conflict" | "unavailable" }>;

/** Состояние формы «Настройки → Отчёты» (`useActionState`). `removed` — отчёт убран. */
export type ReportLinkFormState = Readonly<{
  status:
    | "idle" | "saved" | "unchanged" | "removed"
    | "not_looker" | "share_link" | "invalid"
    | "forbidden" | "version_conflict" | "request_conflict" | "unavailable";
  requestId: string;
}>;

/** Слова результата. Отказ разбора ссылки несёт собственный текст (`LOOKER_EMBED_ERROR_TEXT`). */
export const REPORT_FORM_MESSAGE: Readonly<Record<ReportLinkFormState["status"], string>> = {
  idle: "",
  saved: "Сохранено.",
  unchanged: "Ссылка та же, ничего не изменилось.",
  removed: "Отчёт убран.",
  not_looker: "Нужна ссылка Looker Studio (lookerstudio.google.com).",
  share_link: "Это обычная ссылка на отчёт, её нельзя встроить. В Looker Studio откройте «Файл → Встроить отчёт», включите встраивание и скопируйте код.",
  invalid: "Не удалось разобрать ссылку. Скопируйте код встраивания ещё раз.",
  forbidden: "Нет права менять ссылки на отчёты. Обновите страницу.",
  version_conflict: "Ссылку только что изменил другой администратор. Обновите страницу.",
  request_conflict: "Этот запрос уже отправлен с другими данными. Обновите страницу.",
  unavailable: "Результат пока неизвестен. Введённое осталось в поле; безопасно повторите, не меняя его.",
};
