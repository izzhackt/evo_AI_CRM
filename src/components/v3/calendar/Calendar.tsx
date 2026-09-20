"use client";

import type { PersonalCalendarCursor } from "@/lib/v3/personal-calendar-contract";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { CalendarReadAccess } from "@/lib/v3/calendar-contract";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";

import { MonthGrid, TaskChip, TimeGrid, statePill, taskStateKey } from "./grids";
import {
  CalendarCreateTaskForm,
  CalendarTaskControls,
} from "./TaskControls";
import {
  type CalendarAssigneeOption,
  type CalendarCaseOption,
  type CalendarTask,
  type CalendarTaskCapabilities,
  type CalendarTaskRequestIds,
  type CalendarView,
  type Day,
  VIEW_TITLES,
  calendarUndatedPageNotice,
  calendarAccessNotice,
  calendarEmptyPeriodLabel,
  calendarCapabilitiesForTask,
  calendarUndatedContinuationHref,
  dayLabel,
  periodLabel,
  stepDay,
  stepLabel,
  timeLabel,
} from "./types";

/**
 * Personal calendar over canonical case and staff tasks. The URL identifies the task inspector; every business
 * mutation crosses the server action boundary.
 */
const GHOST =
  "inline-flex min-h-11 items-center justify-center rounded-ctl px-3 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg";

export function Calendar({
  initialTaskKey = null,
  taskCapabilities,
  view,
  day,
  today,
  nowMinutes,
  days,
  tasks,
  readAccess,
  undatedContinuationPage,
  undatedNextHref,
  undatedCount,
  undatedCursor,
  cases,
  casesHaveMore,
  assignees,
  actorMembershipId,
    actor,
  createRequestId,
  taskRequestIds,
  basePath,
}: {
  initialTaskKey?: string | null;
  taskCapabilities: CalendarTaskCapabilities | null;
  view: CalendarView;
  day: Day;
  today: Day;
  /** Минуты от полуночи сейчас — по часам организации, как и сроки задач. */
  nowMinutes: number;
  days: readonly Day[];
  tasks: readonly CalendarTask[];
  readAccess: CalendarReadAccess;
  undatedContinuationPage: boolean;
  undatedNextHref: string | null;
  undatedCount: number;
  undatedCursor: PersonalCalendarCursor | null;
  cases: readonly CalendarCaseOption[];
  casesHaveMore: boolean;
  assignees: readonly CalendarAssigneeOption[];
  actorMembershipId: string;
  actor: ActivePlatformActor;
  createRequestId: string;
  taskRequestIds: Readonly<Record<string, CalendarTaskRequestIds>>;
  basePath: string;
}) {
  const panelId = useId();
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const open = tasks.find((task) => task.key === initialTaskKey) ?? null;
  const openCapabilities = open ? calendarCapabilitiesForTask(open, taskCapabilities) : null;
  const selectTask = (id: string | null) => {
    const target = tasks.find((task) => task.key === id);
    const params = undatedCursor
      ? new URLSearchParams(calendarUndatedContinuationHref(basePath, view, day, undatedCursor).split("?")[1])
      : new URLSearchParams({ view, date: day });
    if (target) {
      if (target.kind === "case") params.set("case", target.studentCaseId);
      else params.set("kind", "staff");
      params.set("task", target.id);
    }
    startNavigation(() => router.push(`${basePath}?${params}`, { scroll: false }));
  };

  const timed = tasks.flatMap((task) => (task.minutes === null ? [] : [task.minutes]));
  const first = Math.floor(Math.min(8 * 60, ...timed) / 60) * 60;
  const last = Math.min(
    24 * 60,
    Math.ceil(Math.max(19 * 60, ...timed.map((minute) => minute + 60)) / 60) * 60,
  );
  const hours: number[] = [];
  for (let minute = first; minute < last; minute += 60) hours.push(minute);

  // День при открытии прокручен к текущему часу организации, а не к началу
  // суток и не к первой задаче. Час зажат в границы нарисованной сетки:
  // раньше первой строки и позже последней прокручивать некуда.
  const anchorMinute = view === "day"
    ? Math.min(Math.max(Math.floor(nowMinutes / 60) * 60, first), last - 60)
    : null;

  const href = (nextView: CalendarView, nextDay: Day) =>
    `${basePath}?view=${nextView}&date=${nextDay}`;
  const chip = {
    today,
    selectedId: open?.key ?? null,
    panelId: open ? panelId : null,
    onSelect: (id: string) => selectTask(initialTaskKey === id ? null : id),
  };
  const unscheduled = tasks.filter((task) => task.day === null);
  const undatedNotice = readAccess.tasks ? calendarUndatedPageNotice(
    undatedContinuationPage,
    undatedNextHref !== null,
    unscheduled.length,
  ) : null;
  const accessNotice = calendarAccessNotice(readAccess);
  const emptyPeriodLabel = calendarEmptyPeriodLabel(readAccess);

  return (
    <div
      className="flex flex-col gap-4"
      data-system-role={actor.systemRole}
      data-presentation-role={actor.presentationRole ?? "actual"}
      aria-busy={navigating}
    >
      {navigating ? <p role="status" className="text-sm text-fg-2">Обновляем календарь…</p> : null}
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

      {staffPresentationCan(actor, "admissions.read") ? <CalendarCreateTaskForm
        key={createRequestId}
        cases={cases}
        casesHaveMore={casesHaveMore}
        assignees={assignees}
        actorMembershipId={actorMembershipId}
        actor={actor}
        requestId={createRequestId}
        day={day}
      /> : null}

      {accessNotice ? <p className="text-sm text-fg-2" data-testid="v3-calendar-read-access">{accessNotice}</p> : null}

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
              {open.kind === "case" && openCapabilities?.canReadCase ? <Link
                href={`/v3/profile?case=${encodeURIComponent(open.studentCaseId)}`}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline"
              >
                Открыть раздел «Студенты»
              </Link> : null}
              {open.kind === "staff" ? (
                <Link href={`/v3/tasks?domain=staff&view=mine&status=all&task=${encodeURIComponent(open.id)}`} className="mt-2 inline-flex text-sm text-brand underline-offset-4 hover:underline">
                  Открыть задачу и действия
                </Link>
              ) : null}
              {open.details ? <p className="mt-3 text-sm leading-6 text-fg">{open.details}</p> : null}
              {open.cancelReason ? (
                <p className="mt-2 text-sm text-fg-2">Причина: {open.cancelReason}</p>
              ) : null}
              {open.kind === "case" && openCapabilities && taskRequestIds[open.key] &&
              open.caseState === "active" &&
              open.state !== "done" &&
              open.state !== "cancelled" &&
              (!isStaffPreview(actor) && staffHasPermission(actor, "task.manage")) ? (
                <CalendarTaskControls
                  key={open.id}
                  task={open}
                  day={day}
                  assignees={assignees}
                  actor={actor}
                  capabilities={openCapabilities}
                  requestIds={taskRequestIds[open.key]}
                />
              ) : null}
            </div>
            <button
              type="button"
              className={`${GHOST} w-11 px-0`}
              onClick={() => {
                const id = open.key;
                selectTask(null);
                requestAnimationFrame(() => document.getElementById(`task-${id}`)?.focus());
              }}
            >
              <span className="sr-only">Закрыть подробности</span>
              <Icon name="x" size={16} />
            </button>
          </div>
        </aside>
      ) : null}

      {tasks.length === 0 &&
      !undatedContinuationPage && emptyPeriodLabel ? (
        <p className="px-1 text-sm text-fg-3">{emptyPeriodLabel}</p>
      ) : null}

      {unscheduled.length > 0 || undatedNotice ? (
        <section
          aria-label="Задачи без срока"
          className="rounded-card border border-border bg-surface p-3"
        >
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">
            Без срока — {undatedCount}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {unscheduled.map((task) => (
              <TaskChip
                key={task.key}
                task={task}
                today={today}
                selected={task.key === chip.selectedId}
                panelId={chip.panelId}
                onSelect={() => chip.onSelect(task.key)}
              />
            ))}
          </div>
          {undatedNotice ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-sm text-fg-3">{undatedNotice}</p>
              <div className="flex flex-wrap items-center gap-2">
                {undatedContinuationPage ? (
                  <Link href={href(view, day)} className={GHOST}>
                    К началу списка
                  </Link>
                ) : null}
                {undatedNextHref ? (
                  <Link href={undatedNextHref} className={GHOST}>
                    Показать следующие
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {readAccess.tasks || tasks.length > 0 ? <section className="min-w-0 overflow-hidden rounded-card border border-border bg-surface">
        {view === "month" ? (
          <MonthGrid
            days={days}
            tasks={tasks}
            deadlines={[]}
            anchor={day}
            hrefForDay={(value) => href("day", value)}
            label={`Сетка месяца, ${periodLabel(view, day)}`}
            chip={chip}
          />
        ) : (
          <TimeGrid
            days={days}
            tasks={tasks}
            deadlines={[]}
            hours={hours}
            anchor={anchorMinute}
            hrefForDay={(value) => href("day", value)}
            label={`Сетка периода, ${periodLabel(view, day)}`}
            chip={chip}
          />
        )}
      </section> : null}
    </div>
  );
}
