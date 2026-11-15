"use client";

import { CircleAlertIcon, CircleCheckIcon, CircleIcon, CircleXIcon, HourglassIcon } from "lucide-react";

import { Pill } from "@/components/staff/Pill";
import { taskPriorityMark } from "@/lib/v3/wording";

import { taskPill, taskStateKey, type CalendarCellProps } from "../grids";
import { calendarTaskIsOpen, calendarTasksOfDay, clockLabel, dayDelta, dayFullLabel, type CalendarTask, type Day } from "../types";

/** «сегодня», «завтра», «вчера», «через 3 дн», «2 дн назад» — где день от сегодняшнего. */
function relativeDay(day: Day, today: Day): string {
  const delta = dayDelta(today, day);
  if (delta === 0) return "сегодня";
  if (delta === 1) return "завтра";
  if (delta === -1) return "вчера";
  return delta > 1 ? `через ${delta} дн` : `${-delta} дн назад`;
}

/** Строка задачи: время, значок состояния, задача и чей студент, справа — состояние словом. Открывает ту же панель задачи. */
function AgendaRow({ task, chip }: Readonly<{ task: CalendarTask; chip: CalendarCellProps }>) {
  const overdue = taskStateKey(task) === "overdue";
  const urgent = !overdue && calendarTaskIsOpen(task) ? taskPriorityMark(task.priority) : null;
  const pill = overdue ? null : taskPill(task);
  const quiet = task.state === "done" || task.state === "cancelled";
  const Mark = overdue ? CircleAlertIcon : task.state === "done" ? CircleCheckIcon : task.state === "cancelled" ? CircleXIcon : task.state === "blocked" ? HourglassIcon : CircleIcon;
  const selected = task.key === chip.selectedId;
  return (
    <li>
      <button type="button" id={`agenda-task-${task.key}`} aria-expanded={selected} onClick={(event) => chip.onSelect(task.key, event.currentTarget)}
        className="v3-choice grid min-h-11 w-full grid-cols-[4.5rem_auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-nav px-2 py-2 text-start hover:bg-surface-2">
        <span className="pt-0.5 t-meta font-mono text-fg-3">{task.minutes === null ? "весь день" : `до ${clockLabel(task.minutes)}`}</span>
        <Mark aria-hidden="true" className={`mt-0.5 size-4 ${overdue ? "text-danger" : urgent ? "text-warn" : "text-fg-3"}`} />
        <span className="grid min-w-0">
          <span className={`t-item break-words ${quiet ? "text-fg-3" : "text-fg"} ${task.state === "done" ? "line-through" : ""}`}>{task.title}</span>
          {task.person ? <span className="truncate t-meta text-fg-3">{task.person}</span> : null}
        </span>
        <span className="flex flex-wrap justify-end gap-1">
          {overdue ? <Pill tone="danger">просрочена</Pill> : null}
          {urgent ? <Pill tone="warn">{urgent}</Pill> : null}
          {pill ? <Pill tone={pill.tone}>{pill.word}</Pill> : null}
        </span>
      </button>
    </li>
  );
}

/**
 * «Список» и повестка дня (15.11.2026, по образцу «Акылмана»): дни с задачами по порядку — «Понедельник, 21 сентября ·
 * через 3 дн», под днём его задачи строками. Сегодняшний день назван тёмным, как и другие, и словом «сегодня». Пустых дней нет.
 */
export function CalendarAgenda({ days, tasks, today, chip, label }: Readonly<{
  days: readonly Day[]; tasks: readonly CalendarTask[]; today: Day; chip: CalendarCellProps; label: string;
}>) {
  const groups = days.map((day) => ({ day, items: calendarTasksOfDay(tasks, day) })).filter((group) => group.items.length > 0);
  if (groups.length === 0) return null;
  return (
    <ol aria-label={label} className="divide-y divide-border" data-calendar-agenda="">
      {groups.map(({ day, items }) => (
        <li key={day}>
          <h3 className="flex flex-wrap items-baseline gap-x-2 px-4 pb-1 pt-3 t-item text-fg">
            {dayFullLabel(day).replace(/ \d{4}$/u, "")}
            <span className="t-meta font-normal text-fg-3">{relativeDay(day, today)}</span>
          </h3>
          <ul className="grid gap-0.5 px-2 pb-2">{items.map((task) => <AgendaRow key={task.key} task={task} chip={chip} />)}</ul>
        </li>
      ))}
    </ol>
  );
}
