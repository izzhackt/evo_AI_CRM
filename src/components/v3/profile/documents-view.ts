/**
 * Вкладка «Документы» дела (Э8.1, PLAN_CHANGES 28.09): чистая логика без
 * React. Фильтр по состоянию и его числа — из того же прочитанного чек-листа
 * и тем же подсчётом, что «Быстрый просмотр» и EVO Docs (`caseChecklistCounts`,
 * `docsRowMatches`): «На проверке» — `submitted`, «Исправить» — «нужно
 * исправить» и «отклонён», «Не загружено» — остальное без решения, «Принято» —
 * `approved`. Нет чтения — нет числа: вкладка без чек-листа чисел не рисует.
 */
import type { PlatformDocumentSlotStatus } from "../../../lib/platform-private-documents.ts";
import type { StudentCaseChecklistCounts } from "../../../lib/platform-student-case-queue-contract.ts";
import { documentSlotStatus } from "../../../lib/v3/wording.ts";
import type { StatusChipTone } from "../blocks/StatusChip.tsx";
import type { QueueTab } from "../queue/QueueViewTabs.tsx";
import type { ActiveDocumentGroup } from "./document-types.ts";

export const DOCUMENT_STATE_FILTERS = ["all", "review", "fix", "missing", "accepted"] as const;
export type DocumentStateFilter = (typeof DOCUMENT_STATE_FILTERS)[number];

/** Параметр адреса фильтра; «Все» — без параметра. */
export const DOCUMENT_STATE_PARAM = "doc_state";

const FILTER_LABEL: Readonly<Record<DocumentStateFilter, string>> = {
  all: "Все",
  review: "На проверке",
  fix: "Исправить",
  missing: "Не загружено",
  accepted: "Принято",
};

/** Значение из адреса; чужое слово — «Все», а не ошибка страницы. */
export function parseDocumentStateFilter(value: string | null | undefined): DocumentStateFilter {
  const found = DOCUMENT_STATE_FILTERS.find((filter) => filter === value);
  return found ?? "all";
}

/** Состояние пункта чек-листа для фильтра — тем же разбиением, что `caseChecklistCounts`. */
export function documentStateOf(status: PlatformDocumentSlotStatus): Exclude<DocumentStateFilter, "all"> {
  if (status === "submitted") return "review";
  if (status === "correction_required" || status === "rejected") return "fix";
  if (status === "approved") return "accepted";
  return "missing";
}

export function documentStateCount(counts: StudentCaseChecklistCounts, filter: DocumentStateFilter): number {
  switch (filter) {
    case "all":
      return counts.total;
    case "review":
      return counts.submitted;
    case "fix":
      return counts.correctionRequired + counts.rejected;
    case "missing":
      return counts.missing;
    case "accepted":
      return counts.approved;
  }
}

/**
 * Адрес вкладки с фильтром. База — `hrefFor("documents")` страницы, поэтому
 * `section=docs` (EVO Docs) и `returnTo` остаются в адресе.
 */
export function documentStateHref(tabHref: string, filter: DocumentStateFilter): string {
  const url = new URL(tabHref, "https://evo.invalid");
  if (filter === "all") url.searchParams.delete(DOCUMENT_STATE_PARAM);
  else url.searchParams.set(DOCUMENT_STATE_PARAM, filter);
  return `${url.pathname}?${url.searchParams}${url.hash}`;
}

export function documentStateTabs(
  counts: StudentCaseChecklistCounts,
  current: DocumentStateFilter,
  tabHref: string,
): readonly QueueTab[] {
  return Object.freeze(DOCUMENT_STATE_FILTERS.map((key) => Object.freeze({
    key,
    label: FILTER_LABEL[key],
    href: documentStateHref(tabHref, key),
    count: documentStateCount(counts, key),
    current: key === current,
  })));
}

/** Группы с пунктами выбранного состояния; пустые группы не рисуются. */
export function filterDocumentGroups(
  groups: readonly ActiveDocumentGroup[],
  filter: DocumentStateFilter,
): readonly ActiveDocumentGroup[] {
  if (filter === "all") return groups;
  return Object.freeze(groups
    .map((group) => Object.freeze({ ...group, items: group.items.filter((item) => documentStateOf(item.status) === filter) }))
    .filter((group) => group.items.length > 0));
}

/** Пусто после фильтра — это не «чек-лист пуст»: называется выбранное состояние. */
export function documentFilterEmptyText(filter: Exclude<DocumentStateFilter, "all">): string {
  return `Документов в состоянии «${FILTER_LABEL[filter]}» нет.`;
}

/**
 * Одно слово состояния строки (тот же словарь, что у кабинета студента) и
 * тон чипа: «На проверке» — очередь сотрудника, «Нужно исправить» и
 * «Отклонён» — очередь студента (предупреждение, не красный), «Принят» — готово.
 */
export function documentStatusChip(
  status: PlatformDocumentSlotStatus,
): Readonly<{ label: string; tone: StatusChipTone }> | null {
  const label = documentSlotStatus(status);
  if (!label) return null;
  const tone: StatusChipTone = status === "approved" ? "ok"
    : status === "submitted" ? "info"
      : status === "correction_required" || status === "rejected" ? "warn"
        : "neutral";
  return Object.freeze({ label, tone });
}
