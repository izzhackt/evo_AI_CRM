"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";
import type { QueueTask } from "@/lib/v3/task-queue";

import { DueBands } from "../queue/DueBands";
import { queueHref, type QueueParams } from "../queue/queue-url";
import { useQueueKeyboard } from "../queue/useQueueKeyboard";
import { STAFF_ERROR_COPY, staffStatusForm } from "./task-commands";
import { TaskQueueRow, type RecentCompletion, type TaskRowPermissions } from "./TaskQueueRow";

/** Сколько строка держит «Завершено · Отменить» до обновления списка. */
export const TASK_UNDO_MS = 6000;

export type TaskQueueBandData = Readonly<{
  key: string;
  label: string;
  count: number | null;
  danger: boolean;
  rows: readonly QueueTask[];
}>;

type Recent = Readonly<RecentCompletion & { band: string; index: number; label: string; danger: boolean }>;

function withoutKey(recent: Readonly<Record<string, Recent>>, key: string) {
  return Object.fromEntries(Object.entries(recent).filter(([entry]) => entry !== key));
}

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
  const router = useRouter();
  const [recent, setRecent] = useState<Readonly<Record<string, Recent>>>({});
  const [message, setMessage] = useState("");
  const [seenBands, setSeenBands] = useState(bands);
  useQueueKeyboard({ openKey });

  // Истёкшая отмена держит строку «завершённой», пока обновлённый список
  // сервера её не уберёт: без мигания обратно в открытую задачу.
  if (seenBands !== bands) {
    setSeenBands(bands);
    const serverKeys = new Set(bands.flatMap((band) => band.rows.map((row) => row.key)));
    setRecent((current) => Object.fromEntries(Object.entries(current).filter(([key, entry]) => !entry.expired || serverKeys.has(key))));
  }

  useEffect(() => {
    if (!Object.values(recent).some((entry) => !entry.expired)) return;
    const timer = window.setTimeout(() => {
      setRecent((current) => Object.fromEntries(Object.entries(current).map(([key, entry]) => [key, { ...entry, expired: true }])));
      router.refresh();
    }, TASK_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [recent, router]);

  const announce = useCallback((text: string) => setMessage(text), []);

  const undo = useCallback(async (completion: RecentCompletion): Promise<string | null> => {
    try {
      const state = await mutateStaffTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null },
        staffStatusForm({ id: completion.task.id, version: completion.version }, completion.previousStatus),
      );
      if (state.status !== "saved") return STAFF_ERROR_COPY[state.status] ?? "Не удалось отменить. Обновите страницу.";
      setRecent((current) => withoutKey(current, completion.task.key));
      setMessage(`Завершение задачи «${completion.task.title}» отменено.`);
      router.refresh();
      return null;
    } catch {
      return "Не удалось отменить. Обновите страницу.";
    }
  }, [router]);

  // Строка, завершённая за последние секунды, стоит на прежнем месте, даже
  // если обновлённый список сервера её уже не содержит.
  const shown = bands.map((band) => {
    const rows = [...band.rows];
    for (const entry of Object.values(recent)) {
      if (!entry.expired && entry.band === band.key && !rows.some((row) => row.key === entry.task.key)) {
        rows.splice(Math.min(entry.index, rows.length), 0, entry.task);
      }
    }
    return { ...band, rows };
  });
  for (const entry of Object.values(recent)) {
    if (!entry.expired && !shown.some((band) => band.key === entry.band)) {
      shown.push({ key: entry.band, label: entry.label, count: null, danger: entry.danger, rows: [entry.task] });
    }
  }

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
              recent={recent[task.key] ?? null}
              announce={announce}
              onUndo={undo}
              onCompleted={(completion) => setRecent((current) => ({
                ...current,
                [task.key]: { ...completion, band: band.key, index, label: band.label, danger: band.danger, expired: false },
              }))}
            />
          )),
        }))}
      />
    </>
  );
}
