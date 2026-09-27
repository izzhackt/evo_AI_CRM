"use client";

import type { QueueTask } from "@/lib/v3/task-queue";

import { UndoToast } from "../blocks/UndoToast";
import { BulkPickToggle, useBulkSelection } from "../queue/Bulk";
import { DueBands } from "../queue/DueBands";
import { queueHref, type QueueParams } from "../queue/queue-url";
import { useQueueKeyboard } from "../queue/useQueueKeyboard";
import { TaskBulkActions } from "./TaskBulkActions";
import { TaskQueueRow, taskRowAbilities, type TaskRowPermissions } from "./TaskQueueRow";
import { useRecentCompletions, useUndoToasts } from "./useRecentCompletions";

export type TaskQueueBandData = Readonly<{
  key: string;
  label: string;
  count: number | null;
  danger: boolean;
  rows: readonly QueueTask[];
}>;

export function taskPanelHref(listParams: QueueParams, task: QueueTask, move = false): string {
  const target = task.kind === "staff"
    ? { task: task.id }
    : { task: task.id, kind: "case", case: task.studentCaseId };
  return queueHref("/v3/tasks", listParams, { ...target, ...(move ? { move: "1" } : {}) });
}

/**
 * Тело «Задач»: группы по сроку, строки с выполнением на месте и клавиатура
 * очереди. Недавно завершённая рабочая задача остаётся на своём месте около
 * 6 секунд с «Отменить» — даже если список за это время обновился — и только
 * потом исчезает вместе с обновлением.
 */
export function TaskQueueList({
  bands,
  open,
  openKey,
  listParams,
  showAssignee,
  nowIso,
  permissions,
}: Readonly<{
  bands: readonly TaskQueueBandData[];
  open: boolean;
  openKey: string | null;
  listParams: QueueParams;
  showAssignee: boolean;
  nowIso: string;
  permissions: TaskRowPermissions;
}>) {
  const { recent, message, announce, undo, completed, shown, hold } = useRecentCompletions(bands);
  const toasts = useUndoToasts(recent, undo);
  useQueueKeyboard({ openKey });

  // Массовые действия (Э7): выбрать можно задачи, которые сотрудник может
  // править, — открытые и не только что завершённые. Нет таких — нет колонки.
  const now = new Date(nowIso);
  const selectable = new Map(shown.flatMap((band) => band.rows)
    .filter((task) => !recent[task.key] && taskRowAbilities(task, permissions, open, now).edit)
    .map((task) => [task.key, task] as const));
  const selectableKeys = [...selectable.keys()];
  const selection = useBulkSelection(selectableKeys);
  const bulk = selectable.size > 0;

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{message}</p>
      {bulk ? <BulkPickToggle selection={selection} /> : null}
      <DueBands
        bands={shown.map((band) => ({
          key: band.key,
          label: band.label,
          count: band.count,
          danger: band.danger,
          rows: band.rows.map((task, index) => (
            <TaskQueueRow
              key={task.key}
              task={task}
              href={taskPanelHref(listParams, task)}
              moveHref={taskPanelHref(listParams, task, true)}
              selected={task.key === openKey}
              open={open}
              showAssignee={showAssignee}
              nowIso={nowIso}
              permissions={permissions}
              select={bulk ? { available: selectable.has(task.key), checked: selection.has(task.key), onToggle: () => selection.toggle(task.key), revealed: selection.revealed } : null}
              recent={recent[task.key] ?? null}
              announce={announce}
              onCompleted={(completion) => completed(task, band, index, completion)}
            />
          )),
        }))}
      />
      {bulk ? <TaskBulkActions selection={selection} tasks={selectable} allKeys={selectableKeys} nowIso={nowIso} /> : null}
      {/* «Отменить» строкой в верхнем слое (Э1.3). */}
      <UndoToast items={toasts} onHold={hold} />
    </>
  );
}
