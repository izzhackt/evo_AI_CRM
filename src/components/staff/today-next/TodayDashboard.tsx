"use client";

import { useMemo, useState } from "react";

import type { DialOptions } from "@/lib/v3/telephony-dial";
import type { TodayBandView, TodayItem, TodaySectionView } from "@/lib/v3/today-queue";

import { UndoToast } from "../blocks/UndoToast";
import { focusQueueRow, useQueueKeyboard } from "../queue/useQueueKeyboard";
import type { TaskRowPermissions } from "../tasks/TaskQueueRow";
import { useRecentCompletions, useUndoToasts, type CompletionBand } from "../tasks/useRecentCompletions";
import { DialListHint } from "../telephony/DialButton";
import { sharedReason } from "../today/TodayQueueList";
import { TodayBandWidget, widgetVisibleCount } from "./TodayBandWidget";
import { TodayTiles } from "./TodayTiles";

type Props = Readonly<{
  /** Разделы очереди; без заголовков (`headed` ложь) страница выглядит как прежняя единая сетка. */
  sections: readonly TodaySectionView[];
  headed: boolean;
  /** Плитки раздела нужны, когда групп несколько и день не пуст с названным сроком. */
  tiles: (section: TodaySectionView) => boolean;
  /** Момент чтения сервера: одинаковые сроки при рендере и гидрации. */
  nowIso: string;
  permissions: TaskRowPermissions;
  dial?: DialOptions | null;
  taskLeads?: Readonly<Record<string, Readonly<{ leadId: string; name: string; href: string }>>> | null;
}>;

type Entry = Readonly<{ key: string; name: string; section: TodaySectionView; view: TodayBandView }>;

/**
 * Виджеты групп «Сегодня» по разделам. Жизненный цикл тот же, что у прежнего списка: одна ссылка на группы, пока сервер не
 * прислал новые; завершение задачи на месте с «Отменить» на 6 секунд (`UndoToast`); клавиатура очереди (↑/↓, j/k, Enter)
 * работает по всем разделам. Ключ группы несёт раздел только при заголовках: у одного раздела адреса прежние.
 */
export function TodayDashboard({ sections, headed, tiles, nowIso, permissions, dial = null, taskLeads = null }: Props) {
  const entries = useMemo<readonly Entry[]>(() => sections.flatMap((section) => section.queue.bands.map((view) => ({
    key: headed ? `${section.section}-${view.band}` : view.band, name: view.band as string, section, view,
  }))), [sections, headed]);
  const completionBands = useMemo<readonly CompletionBand<TodayItem>[]>(() => entries.map((entry) => ({
    key: entry.key, label: entry.view.label, count: entry.view.count, danger: entry.view.danger, rows: entry.view.items,
  })), [entries]);
  const { recent, message, announce, undo, completed, shown, hold } = useRecentCompletions(completionBands);
  const toasts = useUndoToasts(recent, undo);
  const byKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  useQueueKeyboard({ openKey: null });

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{message}</p>
      {/* Одно описание на все кнопки «Позвонить» страницы: читалка не повторяет его в каждой строке. */}
      {dial?.status === "ready" ? <DialListHint /> : null}
      <div className="@container min-w-0 space-y-8" data-today-queue="">
        {sections.map((section) => {
          const own = shown.filter((band) => byKey.get(band.key)?.section === section);
          const heading = `today-section-${section.section}`;
          return (
            <section key={section.section} aria-labelledby={headed ? heading : undefined} data-today-section={section.section} className="space-y-4">
              {headed ? <h2 id={heading} className="border-b border-border pb-2 t-record-title text-fg">{section.title}</h2> : null}
              {tiles(section) ? <TodayTiles bands={section.queue.bands} idPrefix={headed ? `${section.section}-` : ""} label={headed ? `Числа: ${section.title}` : undefined} /> : null}
              {/* Область клавиатуры очереди — вся сетка раздела: ↑/↓ работают и с «Показать ещё», и со строки. */}
              <div data-queue-list="" className="grid items-start gap-4 @min-[56rem]:grid-cols-2">
                {own.map((band) => {
                  const entry = byKey.get(band.key);
                  if (!entry) return null;
                  const open = expanded.includes(band.key);
                  return (
                    <TodayBandWidget
                      key={band.key}
                      band={band}
                      bandName={entry.name}
                      headingLevel={headed ? 3 : 2}
                      note={entry.view.note ?? sharedReason(entry.view)}
                      hoisted={sharedReason(entry.view) !== null}
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
            </section>
          );
        })}
      </div>
      <UndoToast items={toasts} onHold={hold} />
    </>
  );
}
