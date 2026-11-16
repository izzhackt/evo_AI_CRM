import Link from "next/link";

import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { stepDay, stepLabel, type CalendarView, type Day } from "../types";
import { calendarHref } from "./calendar-next-model";
import { CalendarWeekStrip } from "./CalendarWeekStrip";

/**
 * Переход по периоду «Календаря» справа в ряду вида (15.11.2026, по образцу «Акылмана»): «+» новой задачи на
 * выбранный день и «‹ Сегодня ›» одной группой. Название периода — заголовок страницы. На сегодняшнем дне «Сегодня» стоит на
 * своём месте тихой надписью в рамке и никуда не ведёт — группа не прыгает. Переходы — настоящие ссылки (`?view=&date=`).
 */
export function CalendarPeriodNav({ view, day, today, basePath, create }: Readonly<{
  view: CalendarView; day: Day; today: Day; basePath: string;
  /** «+» — новая задача со сроком на выбранный день (15.11.2026, решение владельца); нет права создавать — кнопки нет. */
  create?: Readonly<{ label: string; onOpen: (trigger: HTMLElement) => void }> | null;
}>) {
  const href = (target: Day) => calendarHref(basePath, view, target);
  return (
    <div className="ms-auto flex shrink-0 items-center gap-1" data-testid="v3-calendar-period-bar">
      {create ? (
        <Button variant="outline" size="icon" aria-label={create.label} title={create.label} aria-haspopup="dialog" data-testid="v3-calendar-create-day"
          onClick={(event) => create.onOpen(event.currentTarget)}>
          <PlusIcon aria-hidden="true" />
        </Button>
      ) : null}
      <Button variant="outline" size="icon" asChild>
        <Link href={href(stepDay(view, day, -1))}>
          <span className="sr-only">{stepLabel(view, -1)}</span>
          <ChevronLeftIcon aria-hidden="true" />
        </Link>
      </Button>
      {day === today
        ? <span className="inline-flex h-11 items-center rounded-ctl border border-border px-4 t-label text-fg-3">Сегодня</span>
        : <Button variant="outline" asChild><Link href={href(today)}>Сегодня</Link></Button>}
      <Button variant="outline" size="icon" asChild>
        <Link href={href(stepDay(view, day, 1))}>
          <span className="sr-only">{stepLabel(view, 1)}</span>
          <ChevronRightIcon aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}

/** Полоска дней недели на телефоне — над сеткой у дня и недели (15.11.2026: дни недели вместо длинного периода). */
export function CalendarPhoneStrip({ view, day, today, basePath }: Readonly<{ view: CalendarView; day: Day; today: Day; basePath: string }>) {
  if (view === "month" || view === "list") return null;
  return <CalendarWeekStrip day={day} today={today} basePath={basePath} className="border-b border-border px-2 py-1.5 md:hidden" />;
}
