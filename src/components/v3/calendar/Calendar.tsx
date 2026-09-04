"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";
import type { FixedRole } from "@/lib/fixed-role-policy";

import { MonthGrid, TaskChip, TimeGrid, statePill, taskStateKey } from "./grids";
import {
  CalendarCreateTaskForm,
  CalendarTaskControls,
} from "./TaskControls";
import {
  type CalendarAssigneeOption,
  type CalendarCaseOption,
  type CalendarTask,
  type CalendarTaskRequestIds,
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
 * Calendar over canonical Admissions tasks. Browser state controls only the
 * open inspector; every business mutation crosses the server action boundary.
 */
const GHOST =
  "inline-flex min-h-11 items-center justify-center rounded-ctl px-3 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg";

export function Calendar({
  view,
  day,
  today,
  days,
  tasks,
  cases,
  casesHaveMore,
  assignees,
  actorMembershipId,
  authorityRole,
  presentationRole,
  createRequestId,
  taskRequestIds,
  basePath,
}: {
  view: CalendarView;
  day: Day;
  today: Day;
  days: readonly Day[];
  tasks: readonly CalendarTask[];
  cases: readonly CalendarCaseOption[];
  casesHaveMore: boolean;
  assignees: readonly CalendarAssigneeOption[];
  actorMembershipId: string;
  authorityRole: FixedRole;
  presentationRole: FixedRole;
  createRequestId: string;
  taskRequestIds: Readonly<Record<string, CalendarTaskRequestIds>>;
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
  const unscheduled = tasks.filter((task) => task.day === null);

  return (
    <div
      className="flex flex-col gap-4"
      data-authority-role={authorityRole}
      data-presentation-role={presentationRole}
    >
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

      <CalendarCreateTaskForm
        key={createRequestId}
        cases={cases}
        casesHaveMore={casesHaveMore}
        assignees={assignees}
        actorMembershipId={actorMembershipId}
        presentationRole={presentationRole}
        requestId={createRequestId}
        day={day}
      />

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
                  const key = taskStateKey(open);
                  const display = key ? statePill(key) : null;
                  return display ? <Pill tone={display.tone}>{display.word}</Pill> : null;
                })()}
              </div>
              <p className="mt-1 text-sm text-fg-2">
                {open.day === null ? "Без срока" : dayLabel(open.day)}
                {open.day !== null
                  ? open.minutes === null
                    ? " · весь день"
                    : ` · ${timeLabel(open.minutes)}`
                  : ""}
                {open.person ? ` · ${open.person}` : ""}
              </p>
              <p className="mt-1 text-xs text-fg-3">
                Ответственный: <span className="text-fg-2">{open.assigneeDisplayName}</span>
              </p>
              <Link
                href={`/v3/profile?case=${encodeURIComponent(open.studentCaseId)}`}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline"
              >
                Открыть Student 360
              </Link>
              {open.details ? <p className="mt-3 text-sm leading-6 text-fg">{open.details}</p> : null}
              {open.cancelReason ? (
                <p className="mt-2 text-sm text-fg-2">Причина: {open.cancelReason}</p>
              ) : null}
              {taskRequestIds[open.id] &&
              open.caseState === "active" &&
              open.state !== "done" &&
              open.state !== "cancelled" &&
              (presentationRole === "admin" ||
                (presentationRole === "admissions" &&
                  open.assigneeMembershipId === actorMembershipId)) ? (
                <CalendarTaskControls
                  key={`${open.id}:${open.version}`}
                  task={open}
                  day={day}
                  assignees={assignees}
                  presentationRole={presentationRole}
                  requestIds={taskRequestIds[open.id]}
                />
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

      {unscheduled.length > 0 ? (
        <section
          aria-label="Задачи без срока"
          className="rounded-card border border-border bg-surface p-3"
        >
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">
            Без срока
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {unscheduled.map((task) => (
              <TaskChip
                key={task.id}
                task={task}
                today={today}
                selected={task.id === chip.selectedId}
                panelId={chip.panelId}
                onSelect={() => chip.onSelect(task.id)}
              />
            ))}
          </div>
        </section>
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
