"use client";

import { createContext, useContext } from "react";

import type { DialOptions } from "@/lib/v3/telephony-dial";
import type { QueueTask } from "@/lib/v3/task-queue";

import type { BulkSelection } from "../../queue/Bulk";
import type { RecentCompletion, TaskRowPermissions } from "../TaskQueueRow";

/**
 * Что нужно ячейкам таблицы «Задач» от самой таблицы. Ячейки — компоненты колонок, они не получают свойств от
 * страницы, поэтому общее состояние (завершённые на месте, выбор, права) приходит через контекст, а колонки
 * остаются одними и теми же функциями: состояние ячейки не теряется, когда меняется выбор или список.
 */
export type TaskTableValue = Readonly<{
  nowIso: string;
  /** Вид «Открытые». */
  open: boolean;
  permissions: TaskRowPermissions;
  recent: Readonly<Record<string, RecentCompletion>>;
  selection: BulkSelection | null;
  selectable: ReadonlySet<string>;
  dial: DialOptions | null;
  /** Адрес панели задачи (`?task=`): ссылка названия и открытие строки. */
  panelHref: (task: QueueTask, move?: boolean) => string;
  /** Открыть адрес без прокрутки (круг задачи по студенту открывает панель с полем «Результат»). */
  navigate: (href: string) => void;
  announce: (text: string) => void;
  /** Отказ быстрого действия строки словами — под названием задачи; null снимает. */
  errors: Readonly<Record<string, string>>;
  setError: (key: string, text: string | null) => void;
  onCompleted: (task: QueueTask, completion: RecentCompletion) => void;
}>;

const TaskTableContext = createContext<TaskTableValue | null>(null);

export const TaskTableProvider = TaskTableContext.Provider;

export function useTaskTable(): TaskTableValue {
  const value = useContext(TaskTableContext);
  if (!value) throw new Error("Task table cell rendered outside the table.");
  return value;
}
