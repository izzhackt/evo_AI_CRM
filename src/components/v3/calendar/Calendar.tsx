"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";

import { MonthGrid, TimeGrid, statePill, taskStateKey } from "./grids";
import {
  type CalendarTask,
  type CalendarView,
  type Day,
  VIEW_TITLES,
  dayLabel,
  periodLabel,
  stepDay,
  stepLabel,
  timeLabel,
} from "./types";

/**
 * Read-only calendar over canonical Admissions tasks.
 *
 * Issue #597 owns create/close/cancel actions. Until those server actions are
 * connected, the calendar permits navigation and inspection only; it never
 * creates or hides business records in browser memory.
 */
const GHOST =
  "inline-flex min-h-11 items-center justify-center rounded-ctl px-3 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg";

export function Calendar({
  view,
  day,
  today,
  days,
  tasks,
  basePath,
}: {
  view: CalendarView;
  day: Day;
  today: Day;
  days: readonly Day[];
  tasks: readonly CalendarTask[];
  basePath: string;
}) {
  const panelId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const open = tasks.find((task) => task.id === selected) ?? null;

  const timed = tasks.flatMap((task) => (task.minutes === null ? [] : [task.minutes]));
  const first = Math.floor(Math.min(8 * 60, ...timed) / 60) * 60;
  const last = Math.min(
    24 * 60,
    Math.ceil(Math.max(19 * 60, ...timed.map((minute) => minute + 60)) / 60) * 60,
  );
  const hours: number[] = [];
  for (let minute = first; minute < last; minute += 60) hours.push(minute);

  const href = (nextView: CalendarView, nextDay: Day) =>
    `${basePath}?view=${nextView}&date=${nextDay}`;
  const chip = {
    today,
    selectedId: open?.id ?? null,
    panelId: open ? panelId : null,
    onSelect: (id: string) => setSelected((current) => (current === id ? null : id)),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-border bg-surface p-2">
        <div className="flex shrink-0 items-center gap-1">
          <Link href={href(view, stepDay(view, day, -1))} className={`${GHOST} w-11 px-0`}>
            <span className="sr-only">{stepLabel(view, -1)}</span>
            <Icon name="chevron-right" size={16} className="rotate-180" />
          </Link>
          <Link href={href(view, today)} className={GHOST}>
            Сегодня
          </Link>
          <Link href={href(view, stepDay(view, day, 1))} className={`${GHOST} w-11 px-0`}>
            <span className="sr-only">{stepLabel(view, 1)}</span>
            <Icon name="chevron-right" size={16} />
          </Link>
        </div>

        <p className="min-w-0 flex-1 basis-40 text-sm font-semibold text-fg">
          {periodLabel(view, day)}
        </p>

        <nav aria-label="Вид календаря" className="shrink-0">
          <ul className="flex items-center gap-1">
            {VIEW_TITLES.map((entry) => {
              const active = entry.key === view;
              return (
                <li key={entry.key}>
                  <Link
                    href={href(entry.key, day)}
                    aria-current={active ? "true" : undefined}
                    className={`flex min-h-11 items-center rounded-ctl px-3 text-xs ${
                      active
                        ? "bg-accent font-semibold text-on-accent"
                        : "text-fg-2 hover:bg-surface-2"
                    }`}
                  >
                    {entry.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {open ? (
        <aside
          id={panelId}
          aria-label={`Задача: ${open.title}`}
          className="rounded-card border border-border bg-surface p-4"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-fg">{open.title}</h2>
                {(() => {
                  const key = taskStateKey(open, today);
                  const display = key ? statePill(key) : null;
                  return display ? <Pill tone={display.tone}>{display.word}</Pill> : null;
                })()}
              </div>
              <p className="mt-1 text-sm text-fg-2">
                {dayLabel(open.day)}
                {open.minutes === null ? " · весь день" : ` · ${timeLabel(open.minutes)}`}
                {open.person ? ` · ${open.person}` : ""}
              </p>
              {open.details ? <p className="mt-3 text-sm leading-6 text-fg">{open.details}</p> : null}
              {open.cancelReason ? (
                <p className="mt-2 text-sm text-fg-2">Причина: {open.cancelReason}</p>
              ) : null}
            </div>
            <button
              type="button"
              className={`${GHOST} w-11 px-0`}
              onClick={() => {
                const id = open.id;
                setSelected(null);
                requestAnimationFrame(() => document.getElementById(`task-${id}`)?.focus());
              }}
            >
              <span className="sr-only">Закрыть подробности</span>
              <Icon name="x" size={16} />
            </button>
          </div>
        </aside>
      ) : null}

      {tasks.length === 0 ? (
        <p className="px-1 text-sm text-fg-3">На этот период задач нет.</p>
      ) : null}

      <section className="min-w-0 overflow-hidden rounded-card border border-border bg-surface">
        {view === "month" ? (
          <MonthGrid
            days={days}
            tasks={tasks}
            anchor={day}
            hrefForDay={(value) => href("day", value)}
            label={`Сетка месяца, ${periodLabel(view, day)}`}
            chip={chip}
          />
        ) : (
          <TimeGrid
            days={days}
            tasks={tasks}
            hours={hours}
            hrefForDay={(value) => href("day", value)}
            label={`Сетка периода, ${periodLabel(view, day)}`}
            chip={chip}
          />
        )}
      </section>
    </div>
  );
}
