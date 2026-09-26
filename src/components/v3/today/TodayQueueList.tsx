"use client";

import { useMemo } from "react";

import type { TodayBandView, TodayItem } from "@/lib/v3/today-queue";

import { DueBands } from "../queue/DueBands";
import { useQueueKeyboard } from "../queue/useQueueKeyboard";
import { taskPanelHref } from "../tasks/TaskQueueList";
import { TaskQueueRow, type TaskRowPermissions } from "../tasks/TaskQueueRow";
import { useRecentCompletions, type CompletionBand } from "../tasks/useRecentCompletions";
import { TodayRow } from "./TodayRow";

/**
 * Тело «Сегодня»: группы по срочности (`DueBands`), в них строки всех
 * источников. Задача — настоящая строка «Задач»: круг завершения, 6 секунд
 * «Отменить» и «⋯» — те же команды и тот же жизненный цикл
 * (`useRecentCompletions`). Остальные строки — `TodayRow` с «Открыть».
 * Клавиатура очереди (↑/↓, j/k, Enter) — та же.
 */
export function TodayQueueList({
  bands,
  nowIso,
  permissions,
}: Readonly<{
  bands: readonly TodayBandView[];
  /** Момент чтения сервера: одинаковые сроки при рендере и гидрации. */
  nowIso: string;
  permissions: TaskRowPermissions;
}>) {
  // Одна ссылка на группы, пока сервер не прислал новые: иначе завершения сбрасывались бы каждый рендер.
  const completionBands = useMemo<readonly CompletionBand<TodayItem>[]>(() => bands.map((band) => ({
    key: band.band, label: band.label, count: band.count, danger: band.danger, rows: band.items,
  })), [bands]);
  const { recent, message, announce, undo, completed, shown } = useRecentCompletions(completionBands);
  const notes = useMemo(() => new Map(bands.map((band) => [band.band as string, band.note])), [bands]);
  useQueueKeyboard({ openKey: null });

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{message}</p>
      <DueBands
        idPrefix="today-band"
        bands={shown.map((band) => ({
          key: band.key,
          label: band.label,
          count: band.count,
          danger: band.danger,
          note: notes.get(band.key) ?? null,
          rows: band.rows.map((item, index) => item.task ? (
            <TaskQueueRow
              key={item.key}
              task={item.task}
              href={taskPanelHref({}, item.task)}
              moveHref={taskPanelHref({}, item.task, true)}
              selected={false}
              open
              showAssignee={false}
              nowIso={nowIso}
              permissions={permissions}
              recent={recent[item.key] ?? null}
              announce={announce}
              onUndo={undo}
              onCompleted={(completion) => completed(item, band, index, completion)}
            />
          ) : <TodayRow key={item.key} item={item} nowIso={nowIso} />),
        }))}
      />
    </>
  );
}
