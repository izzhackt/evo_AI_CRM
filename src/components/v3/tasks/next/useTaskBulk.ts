"use client";

import type { QueueTask } from "@/lib/v3/task-queue";

import { useBulkSelection } from "../../queue/Bulk";
import { taskBulkSkipReason, taskRowAbilities, type RecentCompletion, type TaskRowPermissions } from "../TaskQueueRow";

/**
 * Массовые действия (Э7) в таблице: выбрать можно задачу, которую сотрудник может завершить (круг строки) или
 * править («⋯»), — открытую и не только что завершённую. «Завершить» берёт первые, «Перенести срок» — вторые;
 * остальным выбранным окно называет причину (`skip`). Нет таких задач — нет и «Выбрать». Права и команды те же,
 * что у списка прежнего вида (`taskRowAbilities`, `TaskBulkActions`).
 */
export function useTaskBulk(
  tasks: readonly QueueTask[],
  recent: Readonly<Record<string, RecentCompletion>>,
  permissions: TaskRowPermissions,
  open: boolean,
  now: Date,
) {
  const selectable = new Map<string, QueueTask>();
  const skip = { complete: new Map<string, string>(), edit: new Map<string, string>() };
  for (const task of tasks) {
    if (recent[task.key]) continue;
    const can = taskRowAbilities(task, permissions, open, now);
    if (!can.edit && !can.complete) continue;
    selectable.set(task.key, task);
    if (!can.complete) skip.complete.set(task.key, taskBulkSkipReason(task, permissions, "complete"));
    if (!can.edit) skip.edit.set(task.key, taskBulkSkipReason(task, permissions, "edit"));
  }
  const keys = [...selectable.keys()];
  const selection = useBulkSelection(keys);
  return { selection, selectable, skip, keys, any: selectable.size > 0 };
}
