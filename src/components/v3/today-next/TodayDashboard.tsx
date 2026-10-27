"use client";

import { useMemo, useState } from "react";

import type { DialOptions } from "@/lib/v3/telephony-dial";
import type { TodayBandView, TodayItem } from "@/lib/v3/today-queue";

import { UndoToast } from "../blocks/UndoToast";
import { focusQueueRow, useQueueKeyboard } from "../queue/useQueueKeyboard";
import type { TaskRowPermissions } from "../tasks/TaskQueueRow";
import { useRecentCompletions, useUndoToasts, type CompletionBand } from "../tasks/useRecentCompletions";
import { DialListHint } from "../telephony/DialButton";
import { sharedReason } from "../today/TodayQueueList";
import { TodayBandWidget, widgetVisibleCount } from "./TodayBandWidget";

/**
 * Виджеты групп «Сегодня». Жизненный цикл тот же, что у прежнего списка (`TodayQueueList`): одна ссылка на группы,
 * пока сервер не прислал новые; завершение задачи на месте с «Отменить» на 6 секунд в верхнем слое (`UndoToast`);
 * клавиатура очереди (↑/↓, j/k, Enter). Отличие одно — группы стоят карточками в сетке, а не одной лентой.
 */
export function TodayDashboard({
  bands,
  nowIso,
  permissions,
  dial = null,
  taskLeads = null,
}: Readonly<{
  bands: readonly TodayBandView[];
  /** Момент чтения сервера: одинаковые сроки при рендере и гидрации. */
  nowIso: string;
  permissions: TaskRowPermissions;
  dial?: DialOptions | null;
  taskLeads?: Readonly<Record<string, Readonly<{ leadId: string; name: string; href: string }>>> | null;
}>) {
  const completionBands = useMemo<readonly CompletionBand<TodayItem>[]>(() => bands.map((band) => ({
    key: band.band, label: band.label, count: band.count, danger: band.danger, rows: band.items,
  })), [bands]);
  const { recent, message, announce, undo, completed, shown, hold } = useRecentCompletions(completionBands);
  const toasts = useUndoToasts(recent, undo);
  const notes = useMemo(() => new Map(bands.map((band) => [band.band as string, band.note ?? sharedReason(band)])), [bands]);
  const hoisted = useMemo(() => new Set(bands.filter((band) => sharedReason(band) !== null).map((band) => band.band as string)), [bands]);
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  useQueueKeyboard({ openKey: null });

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{message}</p>
      {/* Одно описание на все кнопки «Позвонить» страницы: читалка не повторяет его в каждой строке. */}
      {dial?.status === "ready" ? <DialListHint /> : null}
      <div className="@container min-w-0" data-today-queue="">
        {/* Область клавиатуры очереди — вся сетка, как у прежней ленты: ↑/↓ работают и с «Показать ещё», и со строки. */}
        <div data-queue-list="" className="grid items-start gap-4 @min-[56rem]:grid-cols-2">
          {shown.map((band) => {
            const open = expanded.includes(band.key);
            return (
              <TodayBandWidget
                key={band.key}
                band={band}
                note={notes.get(band.key) ?? null}
                hoisted={hoisted.has(band.key)}
                expanded={open}
                onToggle={(button) => {
                  setExpanded((current) => open ? current.filter((key) => key !== band.key) : [...current, band.key]);
                  // Свёрнутый список короче: кнопка уезжает вверх, и окно не должно остаться ниже конца страницы.
                  if (open) requestAnimationFrame(() => button.scrollIntoView({ block: "nearest" }));
                  // Раскрытый: клавиатура продолжает с первой открывшейся строки, а не с начала страницы.
                  if (!open) requestAnimationFrame(() => focusQueueRow(band.rows[widgetVisibleCount(band.rows.length, false)].key));
                }}
                nowIso={nowIso}
                permissions={permissions}
                dial={dial}
                taskLeads={taskLeads}
                recent={recent}
                announce={announce}
                onCompleted={(item, index, completion) => completed(item, band, index, completion)}
              />
            );
          })}
        </div>
      </div>
      <UndoToast items={toasts} onHold={hold} />
    </>
  );
}
