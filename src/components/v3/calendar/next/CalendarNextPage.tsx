"use client";

import { PlusIcon } from "lucide-react";
import { useRef } from "react";

import { PageShell, SectionTabs, WidgetCard } from "@/components/kit";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import { TaskComposerDialog } from "../../tasks/TaskComposerDialog";
import { TaskComposerContextMark } from "../../tasks/task-composer-context";
import { formatQueueDay } from "../../queue/due-bucket";
import type { Calendar } from "../Calendar";
import { DayList, MonthGrid, TimeGrid, type CalendarCellProps } from "../grids";
import {
  VIEW_TITLES, calendarAccessNotice, calendarEmptyPeriodLabel, calendarHasDatedTasks, periodLabel, weekdayShort,
} from "../types";
import { calendarAnchor, calendarHours, calendarHref } from "./calendar-next-model";
import { CalendarPeriodBar } from "./CalendarPeriodBar";
import { CalendarTaskSheet } from "./CalendarTaskSheet";
import { CalendarUndatedCard } from "./CalendarUndatedCard";
import { useCalendarTaskSheet } from "./useCalendarTaskSheet";

const OWN_CREATE = "inline-flex h-11 shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border border-input bg-surface px-4 t-label text-fg-2 v3-raised hover:bg-surface-2 hover:text-fg [&_svg]:size-[18px]";

/**
 * «Календарь» в новом виде: `PageShell`, вкладки вида (`SectionTabs` — ссылки `?view=`), строка периода, «Без срока» свёрнутой
 * карточкой и сетка (`MonthGrid` / `TimeGrid` / `DayList` прежнего вида: движок сетки не менялся) в `WidgetCard`. Задача
 * открывается в `DetailSheet`. Данные, права, адреса и формы дела те же, что у `Calendar`.
 */
export function CalendarNextPage(props: React.ComponentProps<typeof Calendar>) {
  const { initialTaskKey = null, unavailableTarget = null, taskCapabilities, view, day, today, nowMinutes, days, tasks, readAccess,
    undatedContinuationPage, undatedNextHref, undatedCursor, cases, casesHaveMore, assignees, actorMembershipId, actor, taskRequestIds, basePath } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  const sheet = useCalendarTaskSheet({ tasks, confirmedKey: initialTaskKey ?? unavailableTarget?.key ?? null, view, day, undatedCursor, basePath });
  const canCreate = staffPresentationCan(actor, "admissions.read") && !isStaffPreview(actor) && staffHasPermission(actor, "task.create");
  const canCreateStaff = !isStaffPreview(actor) && staffHasPermission(actor, "staff.task.create");
  const href = (nextView: typeof view, nextDay: string) => calendarHref(basePath, nextView, nextDay);
  const bounds = calendarHours(tasks);
  const chip: CalendarCellProps = { today, selectedDay: day, selectedId: sheet.selectedKey, panelId: null, onSelect: (id, from) => sheet.select(id, from) };
  const unscheduled = tasks.filter((task) => task.day === null);
  const hasDated = calendarHasDatedTasks(view, day, days, tasks);
  const emptyPeriod = hasDated ? null : calendarEmptyPeriodLabel(readAccess, view);
  const accessNotice = calendarAccessNotice(readAccess);
  const periodTitle = periodLabel(view, day);
  const createDay = `${weekdayShort(day).toLowerCase()} ${formatQueueDay(day, today)}`;
  const restoreFocus = () => {
    const previous = sheet.opener.current;
    (previous?.isConnected && previous.getClientRects().length > 0 ? previous : heading.current)?.focus({ preventScroll: true });
  };
  return (
    <PageShell
      title="Календарь"
      testId="v3-calendar-next"
      help={`Задачи по студентам и рабочие задачи — в одном личном календаре. Ссылку на неделю или месяц можно переслать.${canCreate || canCreateStaff ? ` «Создать задачу» ставит срок на выбранный день: ${createDay}.` : ""}`}
      actions={canCreate && !canCreateStaff ? (
        <TaskComposerDialog participants={null} actor={actor} actorMembershipId={actorMembershipId} day={today} defaultDueDay={day}
          staffAllowed={canCreateStaff} caseAllowed={canCreate} initialCases={cases} casesHaveMore={casesHaveMore}
          triggerTestId="v3-calendar-new-task" triggerClassName={OWN_CREATE} triggerChildren={<><PlusIcon aria-hidden="true" />Создать задачу</>} />
      ) : undefined}
    >
      <div data-calendar-root="" data-system-role={actor.systemRole} data-presentation-role={actor.presentationRole ?? "actual"} aria-busy={sheet.navigating} className="grid min-w-0 gap-4">
        <h2 ref={heading} tabIndex={-1} className="sr-only">Расписание</h2>
        <TaskComposerContextMark value={{ dueDay: day, cases, casesHaveMore }} />
        <SectionTabs label="Вид календаря" value={view} tabs={VIEW_TITLES.map((entry) => ({ key: entry.key, label: entry.title, href: href(entry.key, day) }))} />
        <CalendarPeriodBar view={view} day={day} today={today} basePath={basePath} />
        {sheet.navigating ? <p role="status" className="t-body-compact text-fg-2">Обновляем календарь…</p> : null}
        {accessNotice ? <p className="t-body-compact text-fg-2" data-testid="v3-calendar-read-access">{accessNotice}</p> : null}
        {readAccess.tasks ? (
          <CalendarUndatedCard unscheduled={unscheduled} chip={chip} continuationPage={undatedContinuationPage} nextHref={undatedNextHref}
            startHref={href(view, day)} targetKey={sheet.shown?.day === null ? sheet.shown.key : null}
            cursorKey={undatedCursor ? JSON.stringify([undatedCursor.sortAt, undatedCursor.kind, undatedCursor.taskId]) : null} />
        ) : null}
        {readAccess.tasks || tasks.length > 0 ? (
          <WidgetCard className="gap-0 overflow-hidden py-0" bodyClassName="px-0">
            {emptyPeriod ? <p className="border-b border-border px-4 py-3 t-body-compact text-fg-2" data-calendar-empty-period="">{emptyPeriod}</p> : null}
            <div className="hidden md:block">
              {view === "month"
                ? <MonthGrid days={days} tasks={tasks} anchor={day} hrefForDay={(value) => href("day", value)} label={`Сетка месяца, ${periodTitle}`} chip={chip} />
                : <TimeGrid days={days} tasks={tasks} hours={bounds.hours} anchor={calendarAnchor(view, nowMinutes, bounds)} hrefForDay={(value) => href("day", value)} label={`Сетка периода, ${periodTitle}`} chip={chip} />}
            </div>
            {hasDated ? <div className="md:hidden"><DayList view={view} days={days} tasks={tasks} hrefForDay={(value) => href("day", value)} label={`Задачи по дням, ${periodTitle}`} chip={chip} /></div> : null}
          </WidgetCard>
        ) : null}
      </div>
      <CalendarTaskSheet task={sheet.shown} open={sheet.sheetOpen} confirmed={sheet.confirmed}
        unavailableHref={unavailableTarget && sheet.sheetOpen && sheet.confirmed && !sheet.shown ? unavailableTarget.returnHref : null}
        today={today} day={day} assignees={assignees} actor={actor} capabilities={taskCapabilities} requestIds={taskRequestIds}
        onClose={sheet.close} restoreFocus={restoreFocus} />
    </PageShell>
  );
}
