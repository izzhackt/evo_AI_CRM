"use client";

import type { PersonalCalendarCursor } from "@/lib/v3/personal-calendar-contract";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { CalendarReadAccess } from "@/lib/v3/calendar-contract";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";

import { CalendarPanel } from "./CalendarPanel";

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
  unavailableTarget = null,
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
  unavailableTarget?: Readonly<{ key: string; returnHref: string }> | null;
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
  const undatedListId = useId();
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const open = tasks.find((task) => task.key === initialTaskKey) ?? null;
  const openCapabilities = open ? calendarCapabilitiesForTask(open, taskCapabilities) : null;
  const targetKey = initialTaskKey ?? unavailableTarget?.key ?? null;
  const [panel, setPanel] = useState(() => ({
    targetKey, mode: targetKey ? "target" : "closed",
  }));
  if (panel.targetKey !== targetKey) {
    setPanel({ targetKey, mode: targetKey ? "target" : "closed" });
  }
  const canCreate = staffPresentationCan(actor, "admissions.read") &&
    !isStaffPreview(actor) && staffHasPermission(actor, "task.create");
  const createOpen = panel.mode === "create" && canCreate;
  const panelOpen = createOpen || (panel.mode === "target" && targetKey !== null);
  const trigger = useRef<HTMLElement | null>(null);
  const calendarHeading = useRef<HTMLHeadingElement>(null);
  const closing = useRef(false);
  useEffect(() => { closing.current = false; }, [targetKey, panel.mode]);

  const undatedCursorKey = undatedCursor
    ? JSON.stringify([undatedCursor.sortAt, undatedCursor.kind, undatedCursor.taskId])
    : null;
  const undatedTargetKey = open?.day === null ? open.key : null;
  const [undatedDisclosure, setUndatedDisclosure] = useState(() => ({
    cursorKey: undatedCursorKey,
    targetKey: undatedTargetKey,
    expanded: undatedContinuationPage || undatedTargetKey !== null,
  }));
  // A new page or resolved undated target opens the list; the same context
  // must not undo a manual collapse when refreshed server props arrive.
  if (
    undatedDisclosure.cursorKey !== undatedCursorKey ||
    undatedDisclosure.targetKey !== undatedTargetKey
  ) {
    setUndatedDisclosure({
      cursorKey: undatedCursorKey,
      targetKey: undatedTargetKey,
      expanded: undatedDisclosure.cursorKey !== undatedCursorKey ||
        undatedTargetKey !== null || undatedDisclosure.expanded,
    });
  }
  const selectTask = (id: string | null) => {
    if (id !== null) {
      trigger.current = document.getElementById(`task-${id}`);
      closing.current = false;
      setPanel({ targetKey, mode: "target" });
    }
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
  const closePanel = () => {
    if (closing.current || !panelOpen) return;
    closing.current = true;
    setPanel({ targetKey, mode: "closed" });
    if (!createOpen && targetKey !== null) selectTask(null);
  };
  const returnFocus = () => {
    const previous = trigger.current;
    return previous?.isConnected && previous.getClientRects().length > 0 &&
      !previous.closest("dialog") ? previous : calendarHeading.current;
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
    selectedId: panelOpen && !createOpen ? open?.key ?? null : null,
    panelId: panelOpen && !createOpen && open ? panelId : null,
    onSelect: (id: string) => {
      if (initialTaskKey === id && panelOpen && !createOpen) closePanel();
      else selectTask(id);
    },
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
      <h2 ref={calendarHeading} tabIndex={-1} className="sr-only">Расписание</h2>
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
                    className="v3-choice flex min-h-11 items-center rounded-ctl px-3 text-xs text-fg-2 hover:bg-surface-2"
                  >
                    {entry.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {canCreate ? <button type="button" aria-haspopup="dialog" aria-controls={panelId}
          className="min-h-11 rounded-ctl bg-accent px-3 text-sm font-semibold text-on-accent hover:opacity-90"
          onClick={(event) => {
            trigger.current = event.currentTarget;
            closing.current = false;
            setPanel({ targetKey, mode: "create" });
          }}>Задача по студенту</button> : null}
      </div>

      <div className={`grid min-w-0 items-start gap-4 ${panelOpen ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : "grid-cols-1"}`}>
        <div className="min-w-0 space-y-4">
          {accessNotice ? <p className="text-sm text-fg-2" data-testid="v3-calendar-read-access">{accessNotice}</p> : null}

          {tasks.length === 0 &&
          !undatedContinuationPage && emptyPeriodLabel ? (
            <p className="px-1 text-sm text-fg-3">{emptyPeriodLabel}</p>
          ) : null}

          {unscheduled.length > 0 || undatedNotice ? (
            <section
              aria-label="Задачи без срока"
              className="rounded-card border border-border bg-surface p-3"
            >
              <h2 className="t-item text-fg-3">
                <button
                  type="button"
                  aria-expanded={undatedDisclosure.expanded}
                  aria-controls={undatedListId}
                  onClick={() => setUndatedDisclosure((current) => ({
                    ...current,
                    expanded: !current.expanded,
                  }))}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-ctl text-left hover:bg-surface-2 hover:text-fg"
                >
                  <span>Без срока — {undatedCount}</span>
                  <Icon name="chevron-right" size={16} className={`shrink-0 ${undatedDisclosure.expanded ? "rotate-90" : ""}`} />
                </button>
              </h2>
              <div id={undatedListId} hidden={!undatedDisclosure.expanded} className="mt-2">
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
              </div>
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
        <CalendarPanel id={panelId} open={panelOpen}
          contentKey={createOpen ? "create" : targetKey ?? "closed"}
          title={createOpen ? "Задача по студенту" : open?.title ?? "Задача недоступна"}
          create={createOpen} navigationPending={navigating} onRequestClose={closePanel} returnFocus={returnFocus}>
          <div hidden={!createOpen}>
            {canCreate ? <CalendarCreateTaskForm
              cases={cases} casesHaveMore={casesHaveMore} assignees={assignees}
              actorMembershipId={actorMembershipId} actor={actor}
              requestId={createRequestId} day={day} navigationPending={navigating}
            /> : null}
          </div>
          <div hidden={createOpen}>
            {unavailableTarget ? <div className="space-y-3">
              <p role="status" className="text-sm text-fg-2">Эта задача недоступна в вашем личном календаре.</p>
              <Link href={unavailableTarget.returnHref} className="inline-flex min-h-11 items-center text-sm text-brand">Вернуться в календарь</Link>
              <p><Link href="/v3/tasks" className="inline-flex min-h-11 items-center text-sm text-brand">Открыть раздел «Задачи»</Link></p>
            </div> : open ? (
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const key = taskStateKey(open);
                    const display = key ? statePill(key) : null;
                    return display ? <Pill tone={display.tone}>{display.word}</Pill> : null;
                  })()}
                </div>
                <p className="mt-1 text-xs text-fg-2">
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
                  <Link href={`/v3/tasks?type=staff&view=mine&status=all&task=${encodeURIComponent(open.id)}`} className="mt-2 inline-flex min-h-11 items-center text-sm text-brand underline-offset-4 hover:underline">
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
            ) : null}
          </div>
        </CalendarPanel>
      </div>
    </div>
  );
}
