import type { CalendarTask, CalendarView, Day } from "../types";

/**
 * Часы сетки «Календаря»: с 8:00 до 19:00, шире — если у задач срок раньше или позже. Те же правила, что у прежнего вида
 * (`Calendar.tsx`): задача лежит в клетке своего часа, у неё нет длительности.
 */
export function calendarHours(tasks: readonly CalendarTask[]): Readonly<{ hours: readonly number[]; first: number; last: number }> {
  const timed = tasks.flatMap((task) => (task.minutes === null ? [] : [task.minutes]));
  const first = Math.floor(Math.min(8 * 60, ...timed) / 60) * 60;
  const last = Math.min(24 * 60, Math.ceil(Math.max(19 * 60, ...timed.map((minute) => minute + 60)) / 60) * 60);
  const hours: number[] = [];
  for (let minute = first; minute < last; minute += 60) hours.push(minute);
  return { hours, first, last };
}

/** День при открытии прокручен к текущему часу организации, зажатому в границы сетки; у недели и месяца прокрутки нет. */
export function calendarAnchor(view: CalendarView, nowMinutes: number, bounds: Readonly<{ first: number; last: number }>): number | null {
  return view === "day" ? Math.min(Math.max(Math.floor(nowMinutes / 60) * 60, bounds.first), bounds.last - 60) : null;
}

/** Адрес вида и дня: период живёт в адресе, страницу можно переслать, «Назад» возвращает на прежнюю неделю. */
export function calendarHref(basePath: string, view: CalendarView, day: Day): string {
  return `${basePath}?view=${view}&date=${day}`;
}
