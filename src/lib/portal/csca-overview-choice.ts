/**
 * Выбор зрителя «обзор CSCA открыт или свёрнут» (контракт CSCA §19). Живёт в
 * cookie этого устройства, как тема и язык: страница /portal/csca читает её
 * на сервере и сразу рисует лист в нужном состоянии, без скачка после
 * гидратации (review раунда 1, F1). Только удобство, без данных студента;
 * путь `/portal`, 1 год, SameSite=Lax. Модуль клиент-безопасный.
 */
export type CscaOverviewChoice = "open" | "closed";

export const CSCA_OVERVIEW_COOKIE = "csca_overview";
export const CSCA_OVERVIEW_COOKIE_PATH = "/portal";
export const CSCA_OVERVIEW_COOKIE_MAX_AGE = 31_536_000;

/** Только точные "open" и "closed"; всё остальное значит «выбора нет». */
export function parseCscaOverviewChoice(value: string | null | undefined): CscaOverviewChoice | null {
  return value === "open" || value === "closed" ? value : null;
}

/** Без выбора новичок видит обзор открытым, тот, кто уже занимается, свёрнутым. */
export function cscaOverviewOpen(choice: CscaOverviewChoice | null, started: boolean): boolean {
  return choice === null ? !started : choice === "open";
}
