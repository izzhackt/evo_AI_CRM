"use client";

import { PanelLeftIcon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";

import { PageShell, SectionTabs, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { DueWord } from "@/components/staff/blocks/DueWord";
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
import { CalendarPeriodNav, CalendarPhoneStrip } from "./CalendarPeriodBar";
import { CalendarAgenda } from "./CalendarAgenda";
import { CalendarSidebar, useCalendarKinds } from "./CalendarSidebar";
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
  // Левая панель (от 78rem, сворачивается) и фильтр задач — `useCalendarKinds` (15.11.2026, по образцу «Акылмана»).
  const { kinds, counts, toggle: toggleKind, period: periodSet, shown, visible } = useCalendarKinds(tasks, view, day, days);
  const [panel, setPanel] = useState(true);
  const shownDays = new Set(days);
  const bounds = calendarHours(visible.filter((task) => task.day !== null && shownDays.has(task.day)));
  // «+» в календаре (15.11.2026): одна форма «Создать задачу» с днём срока того «+», который нажали; фокус после — на тот же «+».
  const [create, setCreate] = useState<Readonly<{ day: string; intent: string; opener: HTMLElement }> | null>(null);
  const createLabel = (value: string) => `Новая задача на ${weekdayShort(value).toLowerCase()} ${formatQueueDay(value, today)}`;
  const createFor = canCreate || canCreateStaff
    ? (value: string) => ({ label: createLabel(value), onOpen: (opener: HTMLElement) => {
      setCreate((previous) => ({ day: value, opener, intent: `${value}:${(previous ? Number(previous.intent.split(":")[1]) : 0) + 1}` }));
    } })
    : null;
  const chip: CalendarCellProps = { today, selectedDay: day, selectedId: sheet.selectedKey, panelId: null, onSelect: (id, from) => sheet.select(id, from), create: createFor };
  const unscheduled = visible.filter((task) => task.day === null);
  const hasDated = calendarHasDatedTasks(view, day, days, visible);
  const emptyPeriod = hasDated ? null : calendarEmptyPeriodLabel(readAccess, view);
  const accessNotice = calendarAccessNotice(readAccess);
  const grid = readAccess.tasks || tasks.length > 0;
  const side = grid && panel;
  const periodTitle = periodLabel(view, day);
  const createDay = `${weekdayShort(day).toLowerCase()} ${formatQueueDay(day, today)}`;
  const restoreFocus = () => {
    const previous = sheet.opener.current;
    (previous?.isConnected && previous.getClientRects().length > 0 ? previous : heading.current)?.focus({ preventScroll: true });
  };
  return (
    // 15.11.2026 (по образцу «Акылмана»): заголовок — сам период («Сентябрь 2026»), у сегодняшнего дня под ним — «сегодня».
    <PageShell
      title={periodTitle}
      helpLabel="Пояснение: Календарь"
      meta={view === "day" && day === today ? <DueWord view={{ text: "сегодня", tone: "today" }} /> : undefined}
      testId="v3-calendar-next"
      width="full"
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
        {/* Ряд вида, как у «Акылмана»: кнопка панели, «День · Неделя · Месяц» слева, «+ ‹ Сегодня ›» справа. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {grid ? (
            <Button variant="ghost" size="icon" className="hidden @[78rem]:inline-flex" aria-expanded={panel} aria-controls="calendar-side"
              aria-label={panel ? "Скрыть панель календаря" : "Показать панель календаря"} title={panel ? "Скрыть панель" : "Показать панель"}
              onClick={() => setPanel((value) => !value)}>
              <PanelLeftIcon aria-hidden="true" />
            </Button>
          ) : null}
          <SectionTabs label="Вид календаря" value={view} tabs={VIEW_TITLES.map((entry) => ({ key: entry.key, label: entry.title, href: href(entry.key, day) }))} />
          <CalendarPeriodNav view={view} day={day} today={today} basePath={basePath} create={grid ? createFor?.(day) ?? null : null} />
        </div>
        {sheet.navigating ? <p role="status" className="t-body-compact text-fg-2">Обновляем календарь…</p> : null}
        {accessNotice ? <p className="t-body-compact text-fg-2" data-testid="v3-calendar-read-access">{accessNotice}</p> : null}
        {/* От 78rem области с открытой панелью: слева мини-месяц с фильтром и «Без срока», справа сетка. Уже — «Без срока» над сеткой. */}
        <div className={`grid min-w-0 gap-4 ${side ? "@[78rem]:grid-cols-[20rem_minmax(0,1fr)] @[78rem]:items-start" : ""}`}>
          {side ? (
            <div id="calendar-side" className="hidden @[78rem]:col-start-1 @[78rem]:row-start-1 @[78rem]:block">
              <CalendarSidebar view={view} day={day} today={today} basePath={basePath} tasks={visible} kinds={kinds} shown={shown}
                counts={counts} onToggle={toggleKind} />
            </div>
          ) : null}
          {readAccess.tasks ? (
            <CalendarUndatedCard unscheduled={unscheduled} chip={chip} continuationPage={undatedContinuationPage} nextHref={undatedNextHref}
              startHref={href(view, day)} targetKey={sheet.shown?.day === null ? sheet.shown.key : null}
              className={side ? "@[78rem]:col-start-1 @[78rem]:row-start-2" : undefined}
              cursorKey={undatedCursor ? JSON.stringify([undatedCursor.sortAt, undatedCursor.kind, undatedCursor.taskId]) : null} />
          ) : null}
          {grid ? (
            <WidgetCard className={`gap-0 overflow-hidden py-0 ${side ? "@[78rem]:col-start-2 @[78rem]:row-span-3 @[78rem]:row-start-1" : ""}`} bodyClassName="px-0">
              <CalendarPhoneStrip view={view} day={day} today={today} basePath={basePath} />
              {emptyPeriod ? <p className="border-b border-border px-4 py-3 t-body-compact text-fg-2" data-calendar-empty-period="">{emptyPeriod}</p> : null}
              {view === "list" ? (
                <CalendarAgenda days={[...periodSet]} tasks={visible} today={today} chip={chip} label={`Задачи по дням, ${periodTitle}`} />
              ) : (
                <>
                  {/* У дня от 64rem справа — его повестка строками, как у «Акылмана». */}
                  <div className={`hidden md:block ${view === "day" ? "@5xl:grid @5xl:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
                    {view === "month"
                      ? <MonthGrid days={days} tasks={visible} anchor={day} hrefForDay={(value) => href("day", value)} label={`Сетка месяца, ${periodTitle}`} chip={chip} />
                      : <TimeGrid days={days} tasks={visible} hours={bounds.hours} anchor={calendarAnchor(view, nowMinutes, bounds)} now={nowMinutes} hrefForDay={(value) => href("day", value)} label={`Сетка периода, ${periodTitle}`} chip={chip} />}
                    {view === "day" ? (
                      <aside aria-label="Задачи дня" className="hidden border-s border-border @5xl:block">
                        <CalendarAgenda days={[day]} tasks={visible} today={today} chip={chip} label={`Задачи дня, ${periodTitle}`} />
                      </aside>
                    ) : null}
                  </div>
                  {hasDated ? <div className="md:hidden"><DayList view={view} days={days} tasks={visible} hrefForDay={(value) => href("day", value)} label={`Задачи по дням, ${periodTitle}`} chip={chip} /></div> : null}
                </>
              )}
            </WidgetCard>
          ) : null}
        </div>
      </div>
      {createFor ? (
        <TaskComposerDialog participants={null} actor={actor} actorMembershipId={actorMembershipId} day={today} defaultDueDay={create?.day ?? day}
          staffAllowed={canCreateStaff} caseAllowed={canCreate} initialCases={cases} casesHaveMore={casesHaveMore}
          hideTrigger openIntent={create?.intent ?? null} onClosed={() => create?.opener.focus()} />
      ) : null}
      <CalendarTaskSheet task={sheet.shown} open={sheet.sheetOpen} confirmed={sheet.confirmed}
        unavailableHref={unavailableTarget && sheet.sheetOpen && sheet.confirmed && !sheet.shown ? unavailableTarget.returnHref : null}
        today={today} day={day} assignees={assignees} actor={actor} capabilities={taskCapabilities} requestIds={taskRequestIds}
        onClose={sheet.close} restoreFocus={restoreFocus} />
    </PageShell>
  );
}
