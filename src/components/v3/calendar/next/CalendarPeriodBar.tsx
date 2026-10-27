import Link from "next/link";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DueWord } from "@/components/v3/blocks/DueWord";

import { periodLabel, stepDay, stepLabel, type CalendarView, type Day } from "../types";
import { calendarHref } from "./calendar-next-model";

/**
 * Строка периода «Календаря»: стрелки «раньше / позже», «Сегодня» и название периода. Это настоящие ссылки на адрес вида и
 * дня (`?view=&date=`), как и раньше; на сегодняшнем дне «Сегодня» никуда не ведёт и выглядит выключенным.
 */
export function CalendarPeriodBar({ view, day, today, basePath }: Readonly<{ view: CalendarView; day: Day; today: Day; basePath: string }>) {
  const href = (target: Day) => calendarHref(basePath, view, target);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="v3-calendar-period-bar">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" asChild>
          <Link href={href(stepDay(view, day, -1))}>
            <span className="sr-only">{stepLabel(view, -1)}</span>
            <ChevronLeftIcon aria-hidden="true" />
          </Link>
        </Button>
        {day === today ? (
          <Button variant="ghost" disabled aria-disabled="true">Сегодня</Button>
        ) : (
          <Button variant="outline" asChild><Link href={href(today)}>Сегодня</Link></Button>
        )}
        <Button variant="ghost" size="icon" asChild>
          <Link href={href(stepDay(view, day, 1))}>
            <span className="sr-only">{stepLabel(view, 1)}</span>
            <ChevronRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 t-section text-fg" data-calendar-period="">
        <span>{periodLabel(view, day)}</span>
        {/* У дня нет шапки с числом: «сегодня» — слово срока у периода. */}
        {view === "day" && day === today ? <DueWord view={{ text: "сегодня", tone: "today" }} /> : null}
      </p>
    </div>
  );
}
