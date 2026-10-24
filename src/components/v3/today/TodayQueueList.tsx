"use client";

import { useMemo, useState } from "react";

import type { DialOptions } from "@/lib/v3/telephony-dial";
import { todayVisibleCount, type TodayBandView, type TodayItem } from "@/lib/v3/today-queue";

import { UndoToast } from "../blocks/UndoToast";
import { DueBands } from "../queue/DueBands";
import { QUEUE_QUIET_LINK } from "../queue/QueueStates";
import { focusQueueRow, useQueueKeyboard } from "../queue/useQueueKeyboard";
import { taskPanelHref } from "../tasks/TaskQueueList";
import { TaskQueueRow, type TaskRowPermissions } from "../tasks/TaskQueueRow";
import { useRecentCompletions, useUndoToasts, type CompletionBand } from "../tasks/useRecentCompletions";
import { TodayRow } from "./TodayRow";

/** Минимум строк, при которых причина группы «Ждут ответа» выносится под заголовок. */
const SHARED_REASON_ROWS = 4;

/**
 * Одна причина у всех строк группы «Ждут ответа» («нет ответственного ·
 * звонок») стоит один раз под заголовком, а не на каждой из десятков строк.
 * Только там, где причина говорит больше заголовка (у «Просрочено» слово
 * «шаг просрочен» повторило бы его), и только у чистых групп без задач; у
 * группы со своей строкой-пояснением (переписки) — не трогаем.
 */
function sharedReason(band: TodayBandView): string | null {
  if (band.band !== "waiting" || band.note !== null || band.items.length < SHARED_REASON_ROWS) return null;
  const reason = band.items[0].reason;
  if (!reason || band.items.some((item) => item.task || item.reason !== reason)) return null;
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

/**
 * Тело «Сегодня»: группы по срочности (`DueBands`), в них строки всех
 * источников. Длинная группа показывает первые `TODAY_WINDOW` строк, остальные —
 * за «Показать ещё N» (число в заголовке остаётся полным): страница с «Сегодня»
 * в названии не должна открываться стеной из сотни одинаковых строк. Задача — настоящая строка «Задач»: круг завершения, 6 секунд
 * «Отменить» строкой в верхнем слое (UndoToast) и «⋯» — те же команды и тот
 * же жизненный цикл (`useRecentCompletions`, `useUndoToasts`). Остальные
 * строки — `TodayRow` с «Открыть». Клавиатура очереди (↑/↓, j/k, Enter) — та же.
 */
export function TodayQueueList({
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
  /** «Позвонить» (Телефония, T7): у строк лидов и заявок, когда база открыла набор. */
  dial?: DialOptions | null;
  /** Лид рабочей задачи по ключу строки (телефония): имя клиента вместо «Рабочая». */
  taskLeads?: Readonly<Record<string, Readonly<{ name: string; href: string }>>> | null;
}>) {
  // Одна ссылка на группы, пока сервер не прислал новые: иначе завершения сбрасывались бы каждый рендер.
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
      <DueBands
        idPrefix="today-band"
        bands={shown.map((band) => {
          const open = expanded.includes(band.key);
          const visible = todayVisibleCount(band.rows.length, open);
          const hiddenFrom = todayVisibleCount(band.rows.length, false);
          const hidden = band.rows.length - hiddenFrom;
          return {
            key: band.key,
            label: band.label,
            count: band.count,
            danger: band.danger,
            note: notes.get(band.key) ?? null,
            rows: band.rows.slice(0, visible).map((item, index) => item.task ? (
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
                leadRef={taskLeads?.[item.key] ?? null}
                announce={announce}
                onCompleted={(completion) => completed(item, band, index, completion)}
              />
            ) : <TodayRow key={item.key} item={item} nowIso={nowIso} dial={dial} hideReason={hoisted.has(band.key)} />),
            after: hidden > 0 ? (
              <div className="border-b border-border ps-3">
                <button
                  type="button"
                  data-today-more={band.key}
                  onClick={(event) => {
                    const button = event.currentTarget;
                    setExpanded((current) => open ? current.filter((key) => key !== band.key) : [...current, band.key]);
                    // Свёрнутый список короче: кнопка уезжает вверх, и окно не должно остаться ниже конца страницы.
                    if (open) requestAnimationFrame(() => button.scrollIntoView({ block: "nearest" }));
                    // Раскрытый: клавиатура продолжает с первой открывшейся строки, а не с начала страницы.
                    if (!open) requestAnimationFrame(() => focusQueueRow(band.rows[hiddenFrom].key));
                  }}
                  className={QUEUE_QUIET_LINK}
                >
                  {open ? "Свернуть" : `Показать ещё ${hidden}`}
                </button>
              </div>
            ) : null,
          };
        })}
      />
      <UndoToast items={toasts} onHold={hold} />
    </>
  );
}
