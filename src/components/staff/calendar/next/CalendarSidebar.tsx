import Link from "next/link";
import { useState } from "react";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

import {
  calendarPeriodDays, calendarTaskIsOpen, dayDelta, dayFullLabel, dayNumber, gridDays, isSameMonth, monthLabel, stepDay, stepLabel, weekdayNames,
  type CalendarTask, type CalendarView, type Day,
} from "../types";
import { calendarHref } from "./calendar-next-model";

export type CalendarKind = CalendarTask["kind"];
const KIND_TITLES: Readonly<Record<CalendarKind, string>> = { case: "По студентам", staff: "Рабочие" };

/**
 * Какие задачи показывать (15.11.2026, по образцу «Акылмана»): виды — те, что пришли в чтении месяца (один вид — переключать нечего);
 * спрятанный вид пропадает везде — в сетке, списке, «Без срока» и точках мини-месяца. Число — задачи вида в показанных днях.
 */
export function useCalendarKinds(tasks: readonly CalendarTask[], view: CalendarView, day: Day, days: readonly Day[]) {
  const [hidden, setHidden] = useState<ReadonlySet<CalendarKind>>(() => new Set());
  const kinds = (["case", "staff"] as const).filter((kind) => tasks.some((task) => task.kind === kind));
  const period = new Set(calendarPeriodDays(view, day, days));
  const counts = { case: 0, staff: 0 };
  for (const task of tasks) if (task.day !== null && period.has(task.day)) counts[task.kind] += 1;
  const toggle = (kind: CalendarKind) => setHidden((previous) => {
    const next = new Set(previous);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    return next;
  });
  return {
    kinds, counts, toggle, period,
    shown: new Set(kinds.filter((kind) => !hidden.has(kind))) as ReadonlySet<CalendarKind>,
    visible: tasks.filter((task) => !hidden.has(task.kind)),
  };
}

/** Точка дня в мини-месяце: есть просроченная — красная, срок в ближайшие 7 дней — тёмно-жёлтая, остальные открытые — серая. */
function dotOf(day: Day, today: Day, tasks: readonly CalendarTask[]): Readonly<{ className: string; said: string }> | null {
  const open = tasks.filter((task) => task.day === day && calendarTaskIsOpen(task));
  if (open.length === 0) return null;
  if (open.some((task) => task.overdue)) return { className: "bg-danger", said: "есть просроченные задачи" };
  const ahead = dayDelta(today, day);
  return ahead >= 0 && ahead <= 7 ? { className: "bg-warn", said: "задачи в ближайшие 7 дней" } : { className: "bg-fg-3", said: "есть задачи" };
}

/**
 * Левая панель «Календаря» (15.11.2026, по образцу «Акылмана»): мини-месяц выбранного дня — дни-ссылки 44 px, сегодня
 * красное, выбранный день — нейтральное «выбрано», точка — у дня с открытыми задачами (цвет по сроку, слово — для читалки), — и
 * какие задачи показывать: по студентам, рабочие (у кого читаются обе). Данные — те же, что у сетки: страница читает весь месяц.
 */
export function CalendarSidebar({ view, day, today, basePath, tasks, kinds, shown, counts, onToggle }: Readonly<{
  view: CalendarView; day: Day; today: Day; basePath: string; tasks: readonly CalendarTask[];
  /** Какие задачи читаются; один вид — переключать нечего, раздела нет. */
  kinds: readonly CalendarKind[];
  shown: ReadonlySet<CalendarKind>;
  counts: Readonly<Record<CalendarKind, number>>;
  onToggle: (kind: CalendarKind) => void;
}>) {
  const href = (target: Day) => calendarHref(basePath, view, target);
  return (
    <section aria-label="Мини-календарь и фильтр задач" className="grid gap-4 rounded-card border border-border bg-surface p-3" data-testid="v3-calendar-sidebar">
      <nav aria-label="Мини-календарь">
        <div className="flex items-center justify-between gap-2 ps-1">
          <p className="t-item text-fg">{monthLabel(day)}</p>
          <span className="flex">
            <Button variant="ghost" size="icon" asChild>
              <Link href={href(stepDay("month", day, -1))}><span className="sr-only">{stepLabel("month", -1)}</span><ChevronLeftIcon aria-hidden="true" /></Link>
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <Link href={href(stepDay("month", day, 1))}><span className="sr-only">{stepLabel("month", 1)}</span><ChevronRightIcon aria-hidden="true" /></Link>
            </Button>
          </span>
        </div>
        <div className="grid grid-cols-7" aria-hidden="true">
          {weekdayNames().map((name) => <span key={name} className="py-1 text-center t-caption text-fg-3">{name}</span>)}
        </div>
        <ul className="grid grid-cols-7">
          {gridDays("month", day).map((one) => {
            const isToday = one === today;
            const selected = one === day;
            const dot = dotOf(one, today, tasks);
            return (
              <li key={one}>
                <Link href={href(one)} aria-current={isToday ? "date" : selected ? "true" : undefined}
                  className={`${selected ? "v3-choice " : ""}relative grid min-h-11 place-items-center rounded-nav hover:bg-surface-2`}>
                  <span aria-hidden="true" className={`grid size-7 place-items-center rounded-full t-body-compact tabular-nums ${
                    isToday ? "bg-accent text-on-accent" : isSameMonth(one, day) ? "text-fg" : "text-fg-3"}`}>{dayNumber(one)}</span>
                  {dot ? <span aria-hidden="true" className={`absolute bottom-1 size-1 rounded-full ${dot.className}`} /> : null}
                  <span className="sr-only">{`${dayFullLabel(one)}${isToday ? ", сегодня" : ""}${selected ? ", выбранный день" : ""}${dot ? `, ${dot.said}` : ""}`}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {kinds.length > 1 ? (
        <fieldset className="grid gap-1 border-t border-border pt-3">
          <legend className="sr-only">Какие задачи показывать</legend>
          <p aria-hidden="true" className="ps-1 t-caption text-fg-3">Задачи</p>
          {kinds.map((kind) => (
            <label key={kind} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-nav px-1 t-body-compact text-fg hover:bg-surface-2">
              <Checkbox checked={shown.has(kind)} onCheckedChange={() => onToggle(kind)} data-calendar-kind={kind} />
              <span className="min-w-0 flex-1">{KIND_TITLES[kind]}</span>
              <span className="tabular-nums text-fg-3">{counts[kind]}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </section>
  );
}
