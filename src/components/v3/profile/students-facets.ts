import type { AdmissionsAttention, AdmissionsDirection, AdmissionsSummary } from "@/lib/platform-admissions-playbook-contract";
import type { CoverageCurator, CoverageDeadline, CoverageWorkspace } from "@/lib/platform-case-coverage-contract";
import type { PlatformStudentCaseState } from "@/lib/platform-admissions";
import type { V3ProfileCaseDirectoryParams, V3ProfileCaseDirectoryRow } from "@/lib/v3/profile-source";
import { admissionsDirectoryHref, ATTENTION_LABELS, DIRECTION_LABELS } from "./admissions-view.ts";

/**
 * «Студенты» — фасеты и таблица (решение владельца 24.09.2026, PLAN_CHANGES).
 *
 * Чистая логика колонки фасетов и строк таблицы: без запросов и без React,
 * чтобы числа можно было проверить отдельно. Правило одно — число берётся
 * только из существующего чтения (`admissions_direction_summary_v1`,
 * `read_curator_coverage_workspace`). Нет чтения или оно не удалось — нет
 * числа, а не ноль.
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
  | (StudentsCoverageSelection & Readonly<{ kind: "ready"; workspace: CoverageWorkspace }>);

export type StudentsSummary = AdmissionsSummary | "unavailable" | null;

export type FacetItem = Readonly<{
  key: string;
  label: string;
  href: string;
  selected: boolean;
  /** null — числа для этого пункта нет в чтении; показывать нечего. */
  count: number | null;
  /** Короткое уточнение рядом с названием («недоступен»). */
  note?: string;
}>;

export type FacetGroup = Readonly<{
  id: "direction" | "attention" | "state" | "curator";
  title: string;
  /** Что означает число в этой группе; null — чисел в группе нет. */
  countLabel: string | null;
  /** Повторный клик по выбранному пункту снимает фильтр. */
  toggles: boolean;
  items: readonly FacetItem[];
}>;

export type ActiveFilter = Readonly<{ key: string; label: string; href: string }>;

type CuratorOption = Readonly<{ membershipId: string; displayName: string }>;

const DIRECTION_ORDER = ["CN", "MY", "EUROPE", "AE", "TR", "unknown"] as const satisfies readonly (AdmissionsDirection | "unknown")[];

/** Три флага, которые сводка считает (миграция 183). Остальные — только чипом. */
const ATTENTION_FACETS = ["overdue", "needs_curator", "awaiting_ack"] as const satisfies readonly AdmissionsAttention[];

export const ATTENTION_FACET_LABELS: Readonly<Record<(typeof ATTENTION_FACETS)[number], string>> = {
  overdue: "Просрочено",
  needs_curator: ATTENTION_LABELS.needs_curator,
  awaiting_ack: ATTENTION_LABELS.awaiting_ack,
};

export const STATE_LABELS: Readonly<Record<PlatformStudentCaseState, string>> = {
  active: "В работе",
  pending: "Ожидает начала",
  closed: "Закрыто",
};
const STATE_ORDER = ["active", "pending", "closed"] as const satisfies readonly PlatformStudentCaseState[];

function attentionLabel(value: AdmissionsAttention): string {
  return (ATTENTION_FACET_LABELS as Partial<Record<AdmissionsAttention, string>>)[value] ?? ATTENTION_LABELS[value];
}

function hrefWith(params: V3ProfileCaseDirectoryParams, docsMode: boolean, patch: Partial<V3ProfileCaseDirectoryParams>): string {
  return admissionsDirectoryHref({ ...params, ...patch, cursor: null }, undefined, docsMode);
}

export function bucketCount(
  summary: AdmissionsSummary | null,
  key: "active" | "overdue" | "awaiting_ack" | "needs_curator",
  direction?: AdmissionsDirection | "unknown",
): number | null {
  if (!summary) return null;
  return summary.stock
    .filter((row) => direction === undefined || row.direction === direction)
    .reduce((sum, row) => sum + row[key], 0);
}

function curatorEntries(curators: readonly CuratorOption[], workload: readonly CoverageCurator[] | null) {
  const entries: { id: string; name: string; count: number | null; note?: string }[] = (workload ?? []).map((curator) => ({
    id: curator.id,
    name: curator.name,
    count: curator.active_case_count,
    note: curator.active ? undefined : "недоступен",
  }));
  for (const option of curators) {
    if (!entries.some((entry) => entry.id === option.membershipId)) {
      entries.push({ id: option.membershipId, name: option.displayName, count: null });
    }
  }
  return entries;
}

export function curatorName(
  id: string | null | undefined,
  curators: readonly CuratorOption[],
  workload: readonly CoverageCurator[] | null,
): string | null {
  if (!id) return null;
  return workload?.find((curator) => curator.id === id)?.name
    ?? curators.find((curator) => curator.membershipId === id)?.displayName
    ?? null;
}

export function buildFacetGroups(input: Readonly<{
  params: V3ProfileCaseDirectoryParams;
  docsMode: boolean;
  allowAdmissionsFilters: boolean;
  summary: AdmissionsSummary | null;
  curators: readonly CuratorOption[];
  workload: readonly CoverageCurator[] | null;
}>): readonly FacetGroup[] {
  const { params, docsMode, summary } = input;
  const groups: FacetGroup[] = [];
  if (input.allowAdmissionsFilters) {
    groups.push({
      id: "direction",
      title: "Направление",
      countLabel: summary ? "в работе" : null,
      toggles: false,
      items: [
        {
          key: "",
          label: "Все",
          href: hrefWith(params, docsMode, { direction: undefined }),
          selected: params.direction === undefined,
          count: bucketCount(summary, "active"),
        },
        ...DIRECTION_ORDER.map((direction) => ({
          key: direction,
          label: DIRECTION_LABELS[direction],
          href: hrefWith(params, docsMode, { direction }),
          selected: params.direction === direction,
          count: bucketCount(summary, "active", direction),
        })),
      ],
    });
    groups.push({
      id: "attention",
      title: "Требует внимания",
      countLabel: summary ? "дел" : null,
      toggles: true,
      items: ATTENTION_FACETS.map((attention) => ({
        key: attention,
        label: ATTENTION_FACET_LABELS[attention],
        href: hrefWith(params, docsMode, { attention: params.attention === attention ? undefined : attention }),
        selected: params.attention === attention,
        count: bucketCount(summary, attention, params.direction),
      })),
    });
  }
  groups.push({
    id: "state",
    title: "Статус",
    countLabel: null,
    toggles: true,
    items: STATE_ORDER.map((state) => ({
      key: state,
      label: STATE_LABELS[state],
      href: hrefWith(params, docsMode, { state: params.state === state ? undefined : state }),
      selected: params.state === state,
      // Сводка считает только дела в работе; для остальных статусов числа нет.
      count: state === "active" ? bucketCount(summary, "active", params.direction) : null,
    })),
  });
  if (input.allowAdmissionsFilters) {
    const entries = curatorEntries(input.curators, input.workload);
    const selected = params.curatorMembershipId;
    if (selected && !entries.some((entry) => entry.id === selected)) {
      entries.unshift({ id: selected, name: "Выбранный куратор", count: null });
    }
    if (entries.length > 0) {
      groups.push({
        id: "curator",
        title: "Куратор",
        countLabel: entries.some((entry) => entry.count !== null) ? "в работе" : null,
        toggles: true,
        items: entries.map((entry) => ({
          key: entry.id,
          label: entry.name,
          note: entry.note,
          href: hrefWith(params, docsMode, { curatorMembershipId: selected === entry.id ? undefined : entry.id }),
          selected: selected === entry.id,
          count: entry.count,
        })),
      });
    }
  }
  return groups;
}

export function activeFilters(
  params: V3ProfileCaseDirectoryParams,
  docsMode: boolean,
  selectedCuratorName: string | null,
): readonly ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  if (params.query) filters.push({ key: "query", label: `Поиск: «${params.query}»`, href: hrefWith(params, docsMode, { query: undefined }) });
  if (params.direction) filters.push({ key: "direction", label: DIRECTION_LABELS[params.direction], href: hrefWith(params, docsMode, { direction: undefined }) });
  if (params.attention) filters.push({ key: "attention", label: attentionLabel(params.attention), href: hrefWith(params, docsMode, { attention: undefined }) });
  if (params.state) filters.push({ key: "state", label: STATE_LABELS[params.state], href: hrefWith(params, docsMode, { state: undefined }) });
  if (params.curatorMembershipId) {
    filters.push({ key: "curator", label: `Куратор: ${selectedCuratorName ?? "выбранный"}`, href: hrefWith(params, docsMode, { curatorMembershipId: undefined }) });
  }
  return filters;
}

/** Тот же признак, что у `admissions_attention_flags`: срок шага раньше сегодняшнего дня в Бишкеке. */
export function nextStepOverdue(row: V3ProfileCaseDirectoryRow, today: string): boolean {
  return row.state === "active" && Boolean(row.nextActionDueOn) && row.nextActionDueOn! < today;
}

/**
 * Один формат даты на странице: «27.09»; год — двумя цифрами и только если он
 * не совпадает с сегодняшним (YYYY-MM-DD в Бишкеке): «03.01.27». Так дата
 * помещается в узкую колонку «Срок» без переноса.
 */
export function formatDueOn(value: string, today: string): string {
  const [year, month, day] = value.split("-");
  return year === today.slice(0, 4) ? `${day}.${month}` : `${day}.${month}.${year.slice(2)}`;
}

const BISHKEK_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/**
 * Срок из чтения замещения тем же форматом, что в таблице. Дата остаётся
 * датой; у срока со временем — день и время по Бишкеку. Нет срока — null.
 */
export function coverageDue(value: CoverageDeadline | null, today: string): Readonly<{ dateTime: string; text: string; timed: boolean }> | null {
  if (value?.due_on) return { dateTime: value.due_on, text: formatDueOn(value.due_on, today), timed: false };
  if (!value?.due_at) return null;
  const parts = Object.fromEntries(BISHKEK_PARTS.formatToParts(new Date(value.due_at)).map((part) => [part.type, part.value]));
  return { dateTime: value.due_at, text: `${formatDueOn(`${parts.year}-${parts.month}-${parts.day}`, today)} ${parts.hour}:${parts.minute}`, timed: true };
}

/**
 * S3 (plan §7): ожидающее дело с продажей после отклонённого назначения —
 * отдельное состояние «Нужно назначить куратора», а не «Ожидает начала».
 */
export function rowState(row: V3ProfileCaseDirectoryRow): Readonly<{ label: string; tone: "danger" | "muted" | "default" }> {
  if (row.state === "pending" && row.attentionFlags.includes("needs_curator")) {
    return { label: ATTENTION_LABELS.needs_curator, tone: "danger" };
  }
  return { label: STATE_LABELS[row.state], tone: row.state === "closed" ? "muted" : "default" };
}

/** 1 задача, 2 задачи, 5 задач. */
export function russianPlural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}

/** Проблемы строки — число и слово, коротко, чтобы узкая колонка не рвала слова. */
export function rowProblems(row: V3ProfileCaseDirectoryRow): readonly string[] {
  if (row.access !== "full") return [];
  const tasks = row.overdueTaskCount ?? 0;
  const payments = row.overdueObligationCount ?? 0;
  const documents = row.rejectedDocumentCount ?? 0;
  return [
    // Неразрывный пробел: число не отрывается от своего слова при переносе.
    tasks ? `Просрочка: ${tasks}\u00a0${russianPlural(tasks, "задача", "задачи", "задач")}` : null,
    payments ? `Просрочка: ${payments}\u00a0${russianPlural(payments, "оплата", "оплаты", "оплат")}` : null,
    documents ? `Исправить: ${documents}\u00a0${russianPlural(documents, "документ", "документа", "документов")}` : null,
  ].filter((value): value is string => value !== null);
}

export function rowDirection(row: V3ProfileCaseDirectoryRow): string {
  return row.admissionsDirection ? DIRECTION_LABELS[row.admissionsDirection] : row.targetCountry ?? "Не указано";
}
