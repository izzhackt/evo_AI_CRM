import type { TaskQueue, TaskQueueFilters, TaskQueueKind } from "@/lib/v3/task-queue";
import { taskQueueNarrowing, taskQueueParams, TASK_QUEUE_WINDOWS } from "@/lib/v3/task-queue";

import { dueBandLabel } from "../../queue/due-bucket";
import { queueHref } from "../../queue/queue-url";
import { taskQueueEmptyState } from "../TasksWorkspace";
import type { TaskBand } from "./task-table-model";

export type TaskListAction = Readonly<{ label: string; href: string }>;

/**
 * Что список «Задач» знает о себе помимо строк: адреса вида и фильтров, группы по сроку, пустое состояние и
 * «Показать больше» при неполном чтении. Те же правила, что у прежнего `TasksWorkspace`: неполное чтение не даёт
 * права сказать «задач нет» и скрывает числа; пустой список называет, что именно пусто, и предлагает одно действие.
 */
export function taskListView(filters: TaskQueueFilters, queue: TaskQueue, cutOff: readonly TaskQueueKind[], day: string) {
  const listParams = taskQueueParams(filters);
  const listHref = (overrides: Record<string, string | null> = {}) => queueHref("/v3/tasks", listParams, overrides);
  const nextWindow = TASK_QUEUE_WINDOWS.find((value) => value > filters.window);
  const narrowing = taskQueueNarrowing(filters, cutOff);
  // Неполное чтение: прочитать больше, а у предела — уже, если есть чем.
  const readNext: TaskListAction | null = queue.complete ? null
    : nextWindow ? { label: "Показать больше задач", href: listHref({ window: String(nextWindow) }) }
    : narrowing ? { label: narrowing.label, href: listHref(narrowing.overrides) }
    : null;
  const bands: TaskBand[] = queue.bands.map((band) => ({
    key: band.bucket,
    label: band.bucket === "past" ? "Завершённые и отменённые" : dueBandLabel(band.bucket, day),
    count: queue.complete ? band.rows.length : null,
    danger: band.bucket === "overdue",
    rows: band.rows,
  }));
  return {
    listParams,
    listHref,
    readNext,
    bands,
    empty: taskQueueEmptyState(filters, listHref, { complete: queue.complete, next: readNext }),
  };
}
