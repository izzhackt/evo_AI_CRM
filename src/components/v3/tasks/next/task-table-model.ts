/**
 * Строки таблицы «Задач» в «Новом виде». Чистые значения без React и сервера: очередь уже собрана
 * `buildTaskQueue` (права, фильтры и порядок остаются прежними), здесь она только раскладывается по строкам
 * таблицы. Общий поиск таблицы ищет по `search`, сортировка по сроку — по `dueSort`.
 */
import { platformTaskDeadlineSortTime } from "../../../../lib/platform-task-deadline.ts";
import type { QueueTask } from "../../../../lib/v3/task-queue.ts";

export type TaskLead = Readonly<{ leadId: string; name: string; href: string }>;

/** Группа очереди с задачами: та же форма, что у `TaskQueueList` (`useRecentCompletions` держит завершённую строку на месте). */
export type TaskBand = Readonly<{ key: string; label: string; count: number | null; danger: boolean; rows: readonly QueueTask[] }>;

export type TaskRow = Readonly<{
  key: string;
  task: QueueTask;
  lead: TaskLead | null;
  /** Момент срока для сортировки; без срока — в конце. */
  dueSort: number;
  /** Что ищет общий поиск: название, студент, клиент, исполнитель. */
  search: string;
}>;

export function taskRows(bands: readonly TaskBand[], leads: Readonly<Record<string, TaskLead>> | null): TaskRow[] {
  return bands.flatMap((band) => band.rows.map((task): TaskRow => {
    const lead = leads?.[task.key] ?? null;
    return {
      key: task.key,
      task,
      lead,
      dueSort: platformTaskDeadlineSortTime(task.dueOn, task.dueAt),
      search: [task.title, task.studentDisplayName, lead?.name, task.assigneeDisplayName].filter(Boolean).join(" "),
    };
  }));
}

/** Те же строки (по ключу и версии), в том же порядке: таблица тогда не получает нового массива и не сбрасывает страницу. */
export function sameTaskRows(left: readonly TaskRow[], right: readonly TaskRow[]): boolean {
  return left.length === right.length && left.every((row, index) => {
    const other = right[index];
    return row.key === other.key && row.task.version === other.task.version && row.lead?.leadId === other.lead?.leadId;
  });
}

/** Слово состояния — только исключение: заблокирована, отменена; выполненная — в открытом виде. */
export function exceptionWord(task: Pick<QueueTask, "status">, open: boolean): "blocked" | "cancelled" | "done" | null {
  if (task.status === "blocked" || task.status === "cancelled" || (open && task.status === "done")) return task.status;
  return null;
}
