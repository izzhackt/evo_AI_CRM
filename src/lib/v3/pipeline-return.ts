import { PLATFORM_SALES_STAGES } from "../platform-sales-contract.ts";

/**
 * Возврат из карточки лида на «Воронку продаж» в то же состояние доски:
 * поиск, фокус этапа, срок, ответственный, раскрытые «Переданы» и открытая
 * панель лида (аудит 26.09: «Открыть карточку лида» вела назад «К списку
 * студентов»). Адрес приходит строкой `?returnTo=` и потому проверяется
 * целиком: только путь доски и только её собственные параметры, каждый не
 * больше одного раза, со значениями, которые доска сама принимает.
 */
export const PIPELINE_PATH = "/v3/pipeline";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CONTROL = /[\u0000-\u001F\u007F]/u;
const CLOSED_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const STAGES: ReadonlySet<string> = new Set([...PLATFORM_SALES_STAGES, "handed_off", "all"]);

const VALID: Readonly<Record<string, (value: string) => boolean>> = Object.freeze({
  q: (value) => value.length <= 200 && !CONTROL.test(value),
  stage: (value) => STAGES.has(value),
  due: (value) => ["all", "overdue", "today", "unscheduled"].includes(value),
  assignment: (value) => ["all", "mine", "unassigned"].includes(value),
  owner: (value) => UUID.test(value),
  handed: (value) => value === "all",
  lead: (value) => UUID.test(value),
  // «Закрытые лиды» (246): вид и курсор его страниц.
  view: (value) => value === "closed",
  cursor: (value) => CLOSED_CURSOR.test(value),
});

/** Адрес доски из её текущих параметров; чужие параметры не переносятся. */
export function pipelineReturnHref(search: Readonly<{ toString(): string }> | null | undefined): string {
  const current = new URLSearchParams(search?.toString() ?? "");
  const kept = new URLSearchParams();
  for (const [key, value] of current) {
    if (Object.hasOwn(VALID, key) && !kept.has(key) && value !== "" && VALID[key](value)) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `${PIPELINE_PATH}?${query}` : PIPELINE_PATH;
}

/** Ссылка на карточку лида с возвратом на доску. */
export function withPipelineReturn(href: string, returnTo: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`;
}

/** Проверенный адрес доски или null: чужой путь, параметр или значение — отказ. */
export function parsePipelineReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1600 || !/^\/v3\/pipeline(?:\?|$)/u.test(value)) return null;
  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.pathname !== PIPELINE_PATH || url.hash || url.origin !== "https://internal.invalid") return null;
    const seen = new Set<string>();
    for (const [key, raw] of url.searchParams) {
      if (!Object.hasOwn(VALID, key) || seen.has(key) || raw === "" || !VALID[key](raw)) return null;
      seen.add(key);
    }
    const query = url.searchParams.toString();
    return query ? `${PIPELINE_PATH}?${query}` : PIPELINE_PATH;
  } catch {
    return null;
  }
}

/** Проверенный адрес возврата ведёт на «Закрытые лиды» (`?view=closed`, 246). */
export function isClosedLeadsReturn(returnTo: string): boolean {
  return new URL(returnTo, "https://internal.invalid").searchParams.get("view") === "closed";
}
