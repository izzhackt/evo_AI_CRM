/**
 * Меню фильтров «Задач» в «Новом виде»: те же «Срок», «Тип», «Состояние», те же значения и те же адреса, что у
 * прежней строки инструментов (`TasksWorkspace`). Фильтр по-прежнему живёт в адресе и отбирается сервером внутри
 * разрешённого чтения; здесь только перечень пунктов-ссылок, чтобы клиентская панель не получала функцию с сервера.
 */
import { activeFilterCount, queueHref } from "../../queue/queue-url.ts";
import { DUE_BUCKETS, DUE_FILTER_LABELS } from "../../queue/due-bucket.ts";
import { taskQueueParams, type TaskQueueFilters } from "../../../../lib/v3/task-queue.ts";

export type TaskFilterOption = Readonly<{ key: string; label: string; href: string; selected: boolean }>;
export type TaskFilterMenu = Readonly<{
  key: "due" | "type" | "state";
  label: string;
  /** Выбранное значение, если оно не по умолчанию. */
  valueLabel: string | null;
  options: readonly TaskFilterOption[];
}>;

export type TaskFilterBarData = Readonly<{
  menus: readonly TaskFilterMenu[];
  /** Поиск из адреса (`?q=`): ссылка «убрать» вместо второго поля поиска. */
  query: Readonly<{ text: string; clearHref: string }> | null;
  /** «Сбросить»: когда выбран хоть один фильтр (в прежнем виде у одного фильтра был свой «×», здесь его нет). */
  resetHref: string | null;
}>;

export function taskFilterBar(
  filters: TaskQueueFilters,
  access: Readonly<{ canReadStaffTasks: boolean; canReadCaseTasks: boolean }>,
): TaskFilterBarData {
  const href = (overrides: Record<string, string | null> = {}) => queueHref("/v3/tasks", taskQueueParams(filters), overrides);
  const menus: TaskFilterMenu[] = [];
  if (filters.state === "open") {
    menus.push({
      key: "due", label: "Срок", valueLabel: filters.due ? DUE_FILTER_LABELS[filters.due] : null,
      options: [{ key: "all", label: "Любой срок", href: href({ due: null }), selected: filters.due === null },
        ...DUE_BUCKETS.map((bucket) => ({ key: bucket, label: DUE_FILTER_LABELS[bucket], href: href({ due: bucket }), selected: filters.due === bucket }))],
    });
  }
  if (access.canReadStaffTasks && access.canReadCaseTasks) {
    menus.push({
      key: "type", label: "Тип", valueLabel: filters.type === "case" ? "По студентам" : filters.type === "staff" ? "Рабочие" : null,
      options: [
        { key: "all", label: "Все", href: href({ type: null }), selected: filters.type === null },
        { key: "case", label: "По студентам", href: href({ type: "case" }), selected: filters.type === "case" },
        { key: "staff", label: "Рабочие", href: href({ type: "staff" }), selected: filters.type === "staff" },
      ],
    });
  }
  menus.push({
    key: "state", label: "Состояние", valueLabel: filters.state === "done" ? "Завершённые" : "Открытые",
    options: [
      { key: "open", label: "Открытые", href: href({ status: null }), selected: filters.state === "open" },
      { key: "done", label: "Завершённые", href: href({ status: "done", due: null }), selected: filters.state === "done" },
    ],
  });
  const active = activeFilterCount([filters.type, filters.due, filters.query, filters.state === "done" ? "done" : null]);
  return {
    menus,
    query: filters.query ? { text: filters.query, clearHref: href({ q: null }) } : null,
    resetHref: active > 0 ? href({ type: null, due: null, q: null, status: null, window: null }) : null,
  };
}
