"use client";

import { useState } from "react";

import type { QueueTask } from "@/lib/v3/task-queue";

import { isNextLook, type V3Look } from "../blocks/look";
import { UndoToast } from "../blocks/UndoToast";
import { useBulkSelection } from "../queue/Bulk";
import { DueBands } from "../queue/DueBands";
import { queueHref, type QueueParams } from "../queue/queue-url";
import { useQueueKeyboard } from "../queue/useQueueKeyboard";
import { TaskBulkActions } from "./TaskBulkActions";
import { TaskQueueRow, taskRowAbilities, type TaskRowPermissions } from "./TaskQueueRow";
import { useRecentCompletions } from "./useRecentCompletions";

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
  look,
}: Readonly<{
  bands: readonly TaskQueueBandData[];
  open: boolean;
  openKey: string | null;
  listParams: QueueParams;
  showAssignee: boolean;
  nowIso: string;
  permissions: TaskRowPermissions;
  /** Новый облик (Э1.3): блоки строки и «Отменить» строкой в верхнем слое. */
  look?: V3Look;
}>) {
  const { recent, message, announce, undo, completed, shown, hold } = useRecentCompletions(bands);
  // «Отменить» нового облика: ответ сервера ждут и ошибку показывают в строке
  // UndoToast. Состояние принадлежит одному завершению (`completedAt`): при
  // новом завершении той же задачи прежняя ошибка не всплывает.
  const [undoState, setUndoState] = useState<Readonly<Record<string, Readonly<{ completedAt: number; pending: boolean; error: string | null }>>>>({});
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

  const toasts = isNextLook(look) ? Object.values(recent).filter((entry) => !entry.expired).map((entry) => {
    const key = entry.task.key;
    const { completedAt } = entry;
    const state = undoState[key]?.completedAt === completedAt ? undoState[key] : undefined;
    return {
      key,
      message: `Задача «${entry.task.title}» завершена.`,
      pending: state?.pending ?? false,
      error: state?.error ?? null,
      focus: true,
      onUndo: () => {
        if (state?.pending) return;
        setUndoState((current) => ({ ...current, [key]: { completedAt, pending: true, error: null } }));
        void undo(entry).then((failure) => {
          setUndoState((current) => ({ ...current, [key]: { completedAt, pending: false, error: failure } }));
          // Задача снова открыта: фокус — на её круг выполнения, как после отмены в строке.
          if (!failure) {
            requestAnimationFrame(() => document.querySelector<HTMLElement>(
              `[data-queue-row="${CSS.escape(key)}"] button[aria-label^="Завершить"]`)?.focus());
          }
        });
      },
    };
  }) : null;

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{message}</p>
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
              look={look}
              select={bulk ? { available: selectable.has(task.key), checked: selection.has(task.key), onToggle: () => selection.toggle(task.key) } : null}
              recent={recent[task.key] ?? null}
              announce={announce}
              onUndo={undo}
              onCompleted={(completion) => completed(task, band, index, completion)}
            />
          )),
        }))}
      />
      {bulk ? <TaskBulkActions selection={selection} tasks={selectable} allKeys={selectableKeys} nowIso={nowIso} /> : null}
      {/* Последним: место прочих детей и их `useId` — как в прежнем облике. */}
      {toasts ? <UndoToast items={toasts} onHold={hold} /> : null}
    </>
  );
}
