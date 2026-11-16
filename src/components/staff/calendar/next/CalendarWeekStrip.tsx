import Link from "next/link";

import { dayFullLabel, dayNumber, gridDays, weekdayShort, type Day } from "../types";
import { calendarHref } from "./calendar-next-model";

/**
 * Полоска дней недели на телефоне (15.11.2026: дни недели вместо длинного периода): «Пн 21 · Вт 22 · …» под строкой
 * месяца — как в календарях телефона. День — ссылка 44 px на этот день (`?view=day&date=`); сегодня — красная заливка числа, как
 * везде в «Календаре»; выбранный день — общий нейтральный «выбрано». Читалка слышит полную дату, «сегодня» и «выбранный день».
 */
export function CalendarWeekStrip({ day, today, basePath, className }: Readonly<{ day: Day; today: Day; basePath: string; className?: string }>) {
  return (
    <nav aria-label="Дни недели" className={`grid grid-cols-7 gap-1 ${className ?? ""}`} data-testid="v3-calendar-week-strip">
      {gridDays("week", day).map((one) => {
        const isToday = one === today;
        const selected = one === day;
        return (
          <Link
            key={one}
            href={calendarHref(basePath, "day", one)}
            aria-current={isToday ? "date" : selected ? "true" : undefined}
            className={`${selected ? "v3-choice " : ""}flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-nav py-1 hover:bg-surface-2`}
          >
            <span aria-hidden="true" className="t-caption text-fg-3">{weekdayShort(one)}</span>
            <span aria-hidden="true" className={`t-item grid h-7 min-w-7 place-items-center rounded-nav px-1 tabular-nums ${isToday ? "bg-accent text-on-accent" : "text-fg"}`}>
              {dayNumber(one)}
            </span>
            <span className="sr-only">{`${dayFullLabel(one)}${isToday ? ", сегодня" : ""}${selected ? ", выбранный день" : ""}`}</span>
          </Link>
        );
      })}
    </nav>
  );
}
