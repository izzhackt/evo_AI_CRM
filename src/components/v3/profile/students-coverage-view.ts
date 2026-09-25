import type { CoverageCurator, CoverageDeadline, CoverageWorkspace } from "@/lib/platform-case-coverage-contract";

/**
 * «Нагрузка кураторов» — вид «Студентов» для Admin (PLAN_CHANGES
 * «Студенты» PR 2): то же чтение `read_curator_coverage_workspace` и те же
 * параметры `coverage_*`, что у прежней панели замещения. Чистая логика без
 * запросов и без React. Нет чтения — нет числа, а не ноль.
 */

export type StudentsCoverageSelection = Readonly<{
  curatorId: string | null;
  caseId: string | null;
  afterCaseId: string | null;
  /** Адрес пришёл с параметрами замещения: раздел раскрыт. */
  explicit: boolean;
}>;

export type StudentsCoverage =
  | Readonly<{ kind: "hidden" }>
  | Readonly<{ kind: "invalid" }>
  | (StudentsCoverageSelection & Readonly<{ kind: "unavailable" }>)
  /**
   * Чтение по выбранному куратору отказано, потому что он больше не куратор
   * (старая закладка, смена роли), а общее чтение нагрузки удалось и его в
   * списке нет. Нагрузка остальных остаётся; замещать некого.
   */
  | (StudentsCoverageSelection & Readonly<{ kind: "curator_unavailable"; curators: readonly CoverageCurator[] }>)
  | (StudentsCoverageSelection & Readonly<{ kind: "ready"; workspace: CoverageWorkspace }>);

/** Нагрузка кураторов из чтения замещения; null — чтения нет, чисел нет. */
export function coverageWorkload(coverage: StudentsCoverage): readonly CoverageCurator[] | null {
  return coverage.kind === "ready" ? coverage.workspace.curators
    : coverage.kind === "curator_unavailable" ? coverage.curators
    : null;
}

/** Адрес «Нагрузки кураторов» с выбранным куратором (и делом) для замещения. */
export function coverageHref(curatorId: string, caseId?: string, afterCaseId?: string): string {
  const query = new URLSearchParams({ view: "curators", coverage_curator: curatorId });
  if (caseId) query.set("coverage_case", caseId);
  if (afterCaseId) query.set("coverage_after", afterCaseId);
  return `/v3/profile?${query.toString()}#curator-coverage`;
}

/** Вид «Нагрузка кураторов» без выбранного куратора. */
export const COVERAGE_VIEW_HREF = "/v3/profile?view=curators";

/**
 * Один формат даты на странице: «27.09»; год — двумя цифрами и только если он
 * не совпадает с сегодняшним (YYYY-MM-DD в Бишкеке): «03.01.27».
 */
export function formatDueOn(value: string, today: string): string {
  const [year, month, day] = value.split("-");
  return year === today.slice(0, 4) ? `${day}.${month}` : `${day}.${month}.${year.slice(2)}`;
}

const BISHKEK_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/**
 * Срок из чтения замещения тем же форматом, что в очереди. Дата остаётся
 * датой; у срока со временем — день и время по Бишкеку. Нет срока — null.
 */
export function coverageDue(value: CoverageDeadline | null, today: string): Readonly<{ dateTime: string; text: string; timed: boolean }> | null {
  if (value?.due_on) return { dateTime: value.due_on, text: formatDueOn(value.due_on, today), timed: false };
  if (!value?.due_at) return null;
  const parts = Object.fromEntries(BISHKEK_PARTS.formatToParts(new Date(value.due_at)).map((part) => [part.type, part.value]));
  return { dateTime: value.due_at, text: `${formatDueOn(`${parts.year}-${parts.month}-${parts.day}`, today)} ${parts.hour}:${parts.minute}`, timed: true };
}
