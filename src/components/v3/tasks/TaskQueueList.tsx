"use client";

import type { DialOptions } from "@/lib/v3/telephony-dial";
import type { QueueTask } from "@/lib/v3/task-queue";

import { UndoToast } from "../blocks/UndoToast";
import { DialListHint } from "../telephony/DialButton";
import { useBulkSelection } from "../queue/Bulk";
import { DueBands } from "../queue/DueBands";
import { queueHref, type QueueParams } from "../queue/queue-url";
import { useQueueKeyboard } from "../queue/useQueueKeyboard";
import { TaskBulkActions } from "./TaskBulkActions";
import { TaskQueueRow, taskBulkSkipReason, taskRowAbilities, type TaskRowPermissions } from "./TaskQueueRow";
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
  leads = null,
  dial = null,
}: Readonly<{
  bands: readonly TaskQueueBandData[];
  open: boolean;
  openKey: string | null;
  listParams: QueueParams;
  showAssignee: boolean;
  nowIso: string;
  permissions: TaskRowPermissions;
  /** Клиенты задач-перезвонов по ключу строки. */
  leads?: Readonly<Record<string, Readonly<{ leadId: string; name: string; href: string }>>> | null;
  /** «Позвонить» у строк с клиентом: решение базы для этого сотрудника; нет — кнопок нет. */
  dial?: DialOptions | null;
}>) {
  const { recent, message, announce, undo, completed, shown, hold } = useRecentCompletions(bands);
  const toasts = useUndoToasts(recent, undo);
  useQueueKeyboard({ openKey });

  // Массовые действия (Э7): выбрать можно задачу, которую сотрудник может завершить (круг строки) или править
  // («⋯» строки), — открытую и не только что завершённую. «Завершить» берёт первые, «Перенести срок» — вторые;
  // остальным выбранным окно называет причину (`skip`). Нет таких задач — нет колонки.
  const now = new Date(nowIso);
  const selectable = new Map<string, QueueTask>();
  const skip = { complete: new Map<string, string>(), edit: new Map<string, string>() };
  for (const task of shown.flatMap((band) => band.rows)) {
    if (recent[task.key]) continue;
    const can = taskRowAbilities(task, permissions, open, now);
    if (!can.edit && !can.complete) continue;
    selectable.set(task.key, task);
    if (!can.complete) skip.complete.set(task.key, taskBulkSkipReason(task, permissions, "complete"));
    if (!can.edit) skip.edit.set(task.key, taskBulkSkipReason(task, permissions, "edit"));
  }
  const selectableKeys = [...selectable.keys()];
  const selection = useBulkSelection(selectableKeys);
  const bulk = selectable.size > 0;

  return (
    <div className="relative">
      <p role="status" aria-live="polite" className="sr-only">{message}</p>
      {/* Одно описание на все кнопки «Позвонить» списка: читалка не повторяет его в каждой строке. */}
      {dial?.status === "ready" && leads && Object.keys(leads).length > 0 ? <DialListHint /> : null}
      {/* «Выбрать» стоит в строке заголовка первой группы, справа: отдельной строки над списком нет. */}
      {bulk ? (
        <button
          type="button"
          data-testid="queue-bulk-pick"
          onClick={() => { if (selection.revealed) selection.clear(); else selection.pick(); }}
          className="absolute end-0 -top-1 z-30 inline-flex min-h-11 items-center px-3 t-label text-fg-2 underline underline-offset-4 hover:text-fg"
        >
          {selection.revealed ? "Отмена" : "Выбрать"}
        </button>
      ) : null}
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
              leadRef={leads?.[task.key] ?? null}
              dial={dial}
              announce={announce}
              onCompleted={(completion) => completed(task, band, index, completion)}
            />
          )),
        }))}
      />
      {bulk ? <TaskBulkActions selection={selection} tasks={selectable} allKeys={selectableKeys} nowIso={nowIso} skip={skip} /> : null}
      {/* «Отменить» строкой в верхнем слое (Э1.3). */}
      <UndoToast items={toasts} onHold={hold} />
    </div>
  );
}
