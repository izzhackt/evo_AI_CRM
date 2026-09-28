"use client";

import type { PersonalCalendarCursor } from "@/lib/v3/personal-calendar-contract";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Icon } from "@/components/icons";
import { DueWord } from "@/components/v3/blocks/DueWord";
import { Pill } from "@/components/v3/Pill";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { CalendarReadAccess } from "@/lib/v3/calendar-contract";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";

import { formatQueueDay } from "../queue/due-bucket";
import { TaskComposerDialog } from "../tasks/TaskComposerDialog";
import { TaskComposerContextMark } from "../tasks/task-composer-context";
import { CalendarPanel } from "./CalendarPanel";

import { type CalendarCellProps, DayList, MonthGrid, TaskChip, TimeGrid, statePill, taskStateKey } from "./grids";
import { CalendarTaskControls } from "./TaskControls";
import {
  type CalendarAssigneeOption,
  type CalendarCaseOption,
  type CalendarTask,
  type CalendarTaskCapabilities,
  type CalendarTaskRequestIds,
  type CalendarView,
  type Day,
  VIEW_TITLES,
  calendarUndatedOpenCount,
  calendarUndatedPageNotice,
  calendarAccessNotice,
  calendarEmptyPeriodLabel,
  calendarCapabilitiesForTask,
  calendarHasDatedTasks,
  calendarTaskIsOpen,
  calendarUndatedContinuationHref,
  clockLabel,
  periodLabel,
  stepDay,
  stepLabel,
  weekdayShort,
} from "./types";

/**
 * Personal calendar over canonical case and staff tasks. The URL identifies the task inspector; every business
 * mutation crosses the server action boundary.
 */
const GHOST_BASE =
  "inline-flex min-h-11 items-center justify-center rounded-ctl t-label text-fg-2 hover:bg-surface-2 hover:text-fg";
const GHOST = `${GHOST_BASE} px-3`;
/** Ссылка в панели задачи: тёмный акцентный текст всегда подчёркнут (DESIGN.md). */
const PANEL_LINK =
  "inline-flex min-h-11 items-center t-label text-accent-text underline underline-offset-4 hover:text-fg";

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
  undatedCursor,
  cases,
  casesHaveMore,
  assignees,
  actorMembershipId,
  actor,
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
  undatedCursor: PersonalCalendarCursor | null;
  cases: readonly CalendarCaseOption[];
  casesHaveMore: boolean;
  assignees: readonly CalendarAssigneeOption[];
  actorMembershipId: string;
  actor: ActivePlatformActor;
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
  // Э7: одна форма создания задачи — `TaskComposerDialog`, как у всех входов.
  // Задача по студенту — те же условия, что у прежней формы календаря;
  // рабочая — у кого `staff.task.create`. У того же права — «Создать задачу»
  // оболочки: она открывает этот диалог с выбранным днём, своей кнопки у
  // календаря тогда нет (одна кнопка на экран).
  const canCreate = staffPresentationCan(actor, "admissions.read") &&
    !isStaffPreview(actor) && staffHasPermission(actor, "task.create");
  const canCreateStaff = !isStaffPreview(actor) && staffHasPermission(actor, "staff.task.create");
  const panelOpen = panel.mode === "target" && targetKey !== null;
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
  const selectTask = (id: string | null, from: HTMLElement | null = null) => {
    if (id !== null) {
      trigger.current = from ?? document.getElementById(`task-${id}`);
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
    if (targetKey !== null) selectTask(null);
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
  const chip: CalendarCellProps = {
    today,
    selectedDay: day,
    selectedId: panelOpen ? open?.key ?? null : null,
    panelId: panelOpen && open ? panelId : null,
    onSelect: (id, from) => {
      if (initialTaskKey === id && panelOpen) closePanel();
      else selectTask(id, from);
    },
  };
  const unscheduled = tasks.filter((task) => task.day === null);
  const undatedNotice = readAccess.tasks ? calendarUndatedPageNotice(
    undatedContinuationPage,
    undatedNextHref !== null,
    unscheduled.length,
  ) : null;
  const undatedOpen = calendarUndatedOpenCount(unscheduled, undatedContinuationPage, undatedNextHref !== null);
  // «Без срока» — только когда есть открытая задача без срока (или страница
  // очереди без срока): выполненные и отменённые работой не считаются, и
  // «Без срока — 0» с одной зачёркнутой строкой больше не показывается.
  const undatedShown = unscheduled.some(calendarTaskIsOpen) || undatedNotice !== null;
  const accessNotice = calendarAccessNotice(readAccess);
  // Пустой период — по задачам СО СРОКОМ в показанных днях, без оглядки на
  // «Без срока»: прочитанный отрезок полный (чтение идёт до конца страниц).
  const hasDated = calendarHasDatedTasks(view, day, days, tasks);
  const emptyPeriodLabel = hasDated ? null : calendarEmptyPeriodLabel(readAccess, view);
  const periodTitle = periodLabel(view, day);

  return (
    <div
      className="flex flex-col gap-4"
      data-calendar-root=""
      data-system-role={actor.systemRole}
      data-presentation-role={actor.presentationRole ?? "actual"}
      aria-busy={navigating}
    >
      <h2 ref={calendarHeading} tabIndex={-1} className="sr-only">Расписание</h2>
      {navigating ? <p role="status" className="t-body-compact text-fg-2">Обновляем календарь…</p> : null}

      <div className={`grid min-w-0 items-start gap-4 ${panelOpen ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : "grid-cols-1"}`}>
        {/* Один белый лист (Э8.8): строка периода, пустой период, «Без
            срока» и сетка лежат на одной поверхности, а не отдельными
            карточками на столе. */}
        <div className="min-w-0 overflow-hidden rounded-card border border-border bg-surface" data-calendar-sheet="">
          {/* Строка периода. На телефоне (<768 px) сначала период, под ним
              одной строкой стрелки с «Сегодня» и «День · Неделя · Месяц»
              (поля уже, чтобы строка поместилась от 375 px); от 768 px —
              прежний порядок: стрелки, период, вид. */}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 py-2 pl-1 pr-2 md:gap-x-3 md:gap-y-2 md:p-2">
            <div className="min-w-0 basis-full px-2 md:order-2 md:flex-1 md:basis-40 md:px-0">
              <p className="flex flex-wrap items-center gap-x-2 t-section text-fg" data-calendar-period="">
                <span>{periodTitle}</span>
                {/* У дня нет шапки с числом: «сегодня» — слово срока у периода. */}
                {view === "day" && day === today ? <DueWord view={{ text: "сегодня", tone: "today" }} /> : null}
              </p>
              {/* На какой день «Создать задачу» поставит срок: у недели и
                  месяца это выбранный день адреса (он же отмечен нейтрально в
                  сетке); у дня его называет сама строка периода. */}
              {(canCreate || canCreateStaff) && view !== "day" ? (
                <p className="t-meta text-fg-2" data-calendar-create-day="">
                  Срок новой задачи — {weekdayShort(day).toLowerCase()}{" "}
                  <span className="font-mono">{formatQueueDay(day, today)}</span>
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center md:order-1 md:gap-1">
              <Link href={href(view, stepDay(view, day, -1))} className={`${GHOST_BASE} w-11`}>
                <span className="sr-only">{stepLabel(view, -1)}</span>
                <Icon name="chevron-right" size={16} className="rotate-180" />
              </Link>
              <Link href={href(view, today)} className={`${GHOST_BASE} px-1.5 md:px-3`}>
                Сегодня
              </Link>
              <Link href={href(view, stepDay(view, day, 1))} className={`${GHOST_BASE} w-11`}>
                <span className="sr-only">{stepLabel(view, 1)}</span>
                <Icon name="chevron-right" size={16} />
              </Link>
            </div>

            <nav aria-label="Вид календаря" className="ml-auto shrink-0 md:order-3">
              <ul className="flex items-center md:gap-1">
                {VIEW_TITLES.map((entry) => {
                  const active = entry.key === view;
                  return (
                    <li key={entry.key}>
                      <Link
                        href={href(entry.key, day)}
                        aria-current={active ? "true" : undefined}
                        className="v3-choice flex min-h-11 min-w-11 items-center justify-center rounded-ctl px-1.5 t-label text-fg-2 hover:bg-surface-2 md:px-3"
                      >
                        {entry.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            {/* Э7: «Создать задачу» оболочки открывает тот же диалог «Новая задача»
                со сроком на выбранный день и с уже прочитанными делами
                (`TaskComposerContextMark`) — второй кнопки на экране нет. Своя
                кнопка календаря — только у того, у кого кнопки оболочки нет
                (задачи по студентам без `staff.task.create`); тихая: сплошной
                красный на странице один (решение владельца 25.09). */}
            <TaskComposerContextMark value={{ dueDay: day, cases, casesHaveMore }} />
            {canCreate && !canCreateStaff ? <TaskComposerDialog
              participants={null} actor={actor} actorMembershipId={actorMembershipId}
              day={today} defaultDueDay={day}
              staffAllowed={canCreateStaff} caseAllowed={canCreate}
              initialCases={cases} casesHaveMore={casesHaveMore}
              triggerTestId="v3-calendar-new-task"
              triggerClassName="ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg md:order-4 md:ml-0"
              triggerChildren={<><Icon name="plus" size={16} />Создать задачу</>}
            /> : null}
          </div>

          {accessNotice ? (
            <p className="border-t border-border px-3 py-3 t-body-compact text-fg-2" data-testid="v3-calendar-read-access">{accessNotice}</p>
          ) : null}

          {emptyPeriodLabel ? (
            <p className="border-t border-border px-3 py-3 t-body-compact text-fg-2" data-calendar-empty-period="">{emptyPeriodLabel}</p>
          ) : null}

          {undatedShown ? (
            <section aria-label="Задачи без срока" className="border-t border-border px-2 py-1">
              <h2 className="t-item text-fg">
                <button
                  type="button"
                  aria-expanded={undatedDisclosure.expanded}
                  aria-controls={undatedListId}
                  onClick={() => setUndatedDisclosure((current) => ({
                    ...current,
                    expanded: !current.expanded,
                  }))}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-ctl px-1 text-left hover:bg-surface-2"
                >
                  <span>{undatedOpen === null ? "Без срока" : `Без срока — ${undatedOpen}`}</span>
                  <Icon name="chevron-right" size={16} className={`shrink-0 text-fg-2 ${undatedDisclosure.expanded ? "rotate-90" : ""}`} />
                </button>
              </h2>
              <div id={undatedListId} hidden={!undatedDisclosure.expanded} className="px-1 pb-2 pt-1">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {unscheduled.map((task) => (
                    <TaskChip
                      key={task.key}
                      task={task}
                      selected={task.key === chip.selectedId}
                      panelId={chip.panelId}
                      onSelect={(from) => chip.onSelect(task.key, from)}
                    />
                  ))}
                </div>
                {undatedNotice ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                    <p className="t-meta text-fg-2">{undatedNotice}</p>
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

          {readAccess.tasks || tasks.length > 0 ? <>
            {/* От 768 px — сетки; на телефоне неделя и месяц не помещаются, и
                каждый вид — список по дням (Э8.8). Оба дерева в разметке,
                виден одно — по ширине окна, поэтому `?view=` работает везде. */}
            <div className="hidden border-t border-border md:block">
              {view === "month" ? (
                <MonthGrid
                  days={days}
                  tasks={tasks}
                  anchor={day}
                  hrefForDay={(value) => href("day", value)}
                  label={`Сетка месяца, ${periodTitle}`}
                  chip={chip}
                />
              ) : (
                <TimeGrid
                  days={days}
                  tasks={tasks}
                  hours={hours}
                  anchor={anchorMinute}
                  hrefForDay={(value) => href("day", value)}
                  label={`Сетка периода, ${periodTitle}`}
                  chip={chip}
                />
              )}
            </div>
            {hasDated ? (
              <div className="border-t border-border md:hidden">
                <DayList
                  view={view}
                  days={days}
                  tasks={tasks}
                  hrefForDay={(value) => href("day", value)}
                  label={`Задачи по дням, ${periodTitle}`}
                  chip={chip}
                />
              </div>
            ) : null}
          </> : null}
        </div>
        <CalendarPanel id={panelId} open={panelOpen}
          contentKey={targetKey ?? "closed"}
          title={open?.title ?? "Задача недоступна"}
          navigationPending={navigating} onRequestClose={closePanel} returnFocus={returnFocus}>
          <div>
            {unavailableTarget ? <div className="space-y-3">
              <p role="status" className="t-body-compact text-fg-2">Эта задача недоступна в вашем личном календаре.</p>
              <Link href={unavailableTarget.returnHref} className={PANEL_LINK}>Вернуться в календарь</Link>
              <p><Link href="/v3/tasks" className={PANEL_LINK}>Открыть раздел «Задачи»</Link></p>
            </div> : open ? (
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const key = taskStateKey(open);
                    const display = key ? statePill(key) : null;
                    return display ? <Pill tone={display.tone}>{display.word}</Pill> : null;
                  })()}
                </div>
                {/* Срок — «ДД.ММ ЧЧ:ММ» по Бишкеку JetBrains Mono (год — только не текущий). */}
                <p className="mt-1 t-meta text-fg-2">
                  {open.day === null ? "Без срока" : (
                    <span className="font-mono">
                      {formatQueueDay(open.day, today)}
                      {open.minutes === null ? "" : ` ${clockLabel(open.minutes)}`}
                    </span>
                  )}
                  {open.day !== null && open.minutes === null ? " · весь день" : ""}
                  {open.person ? ` · ${open.person}` : ""}
                </p>
                <p className="mt-1 t-meta text-fg-3">
                  Ответственный: <span className="text-fg-2">{open.assigneeDisplayName}</span>
                </p>
                {open.kind === "case" && openCapabilities?.canReadCase ? <Link
                  href={`/v3/profile?case=${encodeURIComponent(open.studentCaseId)}`}
                  className={`mt-2 ${PANEL_LINK}`}
                >
                  Открыть раздел «Студенты»
                </Link> : null}
                {open.kind === "staff" ? (
                  <Link href={`/v3/tasks?type=staff&view=mine&status=all&task=${encodeURIComponent(open.id)}`} className={`mt-2 ${PANEL_LINK}`}>
                    Открыть задачу и действия
                  </Link>
                ) : null}
                {open.details ? <p className="mt-3 t-body-compact text-fg">{open.details}</p> : null}
                {open.cancelReason ? (
                  <p className="mt-2 t-body-compact text-fg-2">Причина: {open.cancelReason}</p>
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
