import { ADMISSIONS_PIPELINE_STAGES, type AdmissionsPipelineStage } from "../platform-admissions-pipeline-contract.ts";
import { isPlatformApplicationCountryCode } from "../platform-application-contract.ts";

/**
 * Дело из «Воронки поступления» (решение владельца 06.11.2026): карточка открывается на вкладке, которая соответствует
 * этапу дела, а «Назад» возвращает на доску в то же состояние (раздел, поиск, страна, куратор, этап на телефоне).
 *
 * Адрес возврата приходит строкой `?returnTo=` и потому проверяется целиком, как у `/pipeline` и `/requests`:
 * только путь доски, только её собственные параметры, каждый не больше одного раза, со значениями, которые доска
 * сама принимает. Чужой путь, чужой параметр или значение — отказ (null), а не переход куда попало.
 */
export const ADMISSIONS_BOARD_PATH = "/admissions-pipeline";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CONTROL = /[\u0000-\u001F\u007F]/u;

const VALID: Readonly<Record<string, (value: string) => boolean>> = Object.freeze({
  tab: (value) => value === "admission" || value === "visa",
  q: (value) => value.length <= 200 && !CONTROL.test(value),
  country: (value) => isPlatformApplicationCountryCode(value),
  curator: (value) => UUID.test(value),
  stage: (value) => (ADMISSIONS_PIPELINE_STAGES as readonly string[]).includes(value),
});

/** Адрес доски из её параметров; пустые значения и чужие ключи не переносятся. */
export function admissionsBoardReturnHref(params: Readonly<Record<string, string | null | undefined>>): string {
  const kept = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Object.hasOwn(VALID, key) && typeof value === "string" && value !== "" && VALID[key](value)) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `${ADMISSIONS_BOARD_PATH}?${query}` : ADMISSIONS_BOARD_PATH;
}

/** Проверенный адрес доски поступления или null. */
export function parseAdmissionsBoardReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1600 || !/^\/admissions-pipeline(?:\?|$)/u.test(value)) return null;
  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.pathname !== ADMISSIONS_BOARD_PATH || url.hash || url.origin !== "https://internal.invalid") return null;
    const seen = new Set<string>();
    for (const [key, raw] of url.searchParams) {
      if (!Object.hasOwn(VALID, key) || seen.has(key) || raw === "" || !VALID[key](raw)) return null;
      seen.add(key);
    }
    const query = url.searchParams.toString();
    return query ? `${ADMISSIONS_BOARD_PATH}?${query}` : ADMISSIONS_BOARD_PATH;
  } catch {
    return null;
  }
}

export type CaseOpenTab = "overview" | "documents" | "route";

/**
 * Вкладка, на которой открывать дело этого этапа: этап «Документы» — «Документы», «Новые» и «Подбор вузов» —
 * «Вузы», остальные — «Обзор». Явный `?tab=` в адресе сильнее: сюда он не доходит.
 */
export function caseOpenTabForStage(stage: AdmissionsPipelineStage | string | null | undefined): CaseOpenTab {
  if (stage === "documents") return "documents";
  if (stage === "new" || stage === "shortlist") return "route";
  return "overview";
}

/** Адрес дела с доски: вкладка по этапу и возврат на доску. */
export function admissionsBoardCaseHref(row: Readonly<{ studentCaseId: string; pipelineStage: string }>, returnTo: string): string {
  const query = new URLSearchParams({ case: row.studentCaseId, tab: caseOpenTabForStage(row.pipelineStage) });
  const board = parseAdmissionsBoardReturnTo(returnTo);
  if (board) query.set("returnTo", board);
  return `/profile?${query.toString()}`;
}
