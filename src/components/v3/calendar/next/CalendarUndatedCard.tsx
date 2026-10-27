"use client";

import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";

import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { TaskChip, type CalendarCellProps } from "../grids";
import { calendarTaskIsOpen, calendarUndatedOpenCount, calendarUndatedPageNotice, type CalendarTask } from "../types";

/** Нужен ли раздел: есть открытая задача без срока или это страница очереди без срока (выполненные и отменённые не считаются). */
export function undatedShown(unscheduled: readonly CalendarTask[], notice: string | null): boolean {
  return unscheduled.some(calendarTaskIsOpen) || notice !== null;
}

/**
 * «Без срока»: свёрнутая карточка над сеткой. Раскрывается сама на странице очереди без срока и когда в панели открыта задача
 * без срока; ручное сворачивание новая выдача сервера не отменяет. Следующая страница очереди — ссылки под списком.
 */
export function CalendarUndatedCard({ unscheduled, chip, continuationPage, nextHref, startHref, targetKey, cursorKey }: Readonly<{
  unscheduled: readonly CalendarTask[];
  chip: CalendarCellProps;
  continuationPage: boolean;
  nextHref: string | null;
  startHref: string;
  /** Открытая задача без срока — список раскрыт. */
  targetKey: string | null;
  cursorKey: string | null;
}>) {
  const listId = useId();
  const [state, setState] = useState(() => ({ cursorKey, targetKey, expanded: continuationPage || targetKey !== null }));
  if (state.cursorKey !== cursorKey || state.targetKey !== targetKey) {
    setState({ cursorKey, targetKey, expanded: state.cursorKey !== cursorKey || targetKey !== null || state.expanded });
  }
  const notice = calendarUndatedPageNotice(continuationPage, nextHref !== null, unscheduled.length);
  if (!undatedShown(unscheduled, notice)) return null;
  const open = calendarUndatedOpenCount(unscheduled, continuationPage, nextHref !== null);
  return (
    <WidgetCard
      size="sm"
      title={open === null ? "Без срока" : `Без срока — ${open}`}
      actions={(
        <Button variant="ghost" aria-expanded={state.expanded} aria-controls={state.expanded ? listId : undefined} onClick={() => setState((current) => ({ ...current, expanded: !current.expanded }))}>
          {state.expanded ? "Свернуть" : "Показать"}
          <ChevronDownIcon aria-hidden="true" className={state.expanded ? "rotate-180" : ""} />
        </Button>
      )}
    >
      {state.expanded ? <div id={listId} className="grid gap-2">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {unscheduled.map((task) => (
            <TaskChip key={task.key} task={task} selected={task.key === chip.selectedId} panelId={chip.panelId} onSelect={(from) => chip.onSelect(task.key, from)} />
          ))}
        </div>
        {notice ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="t-meta text-fg-2">{notice}</p>
            <div className="flex flex-wrap items-center gap-2">
              {continuationPage ? <Button variant="ghost" asChild><Link href={startHref}>К началу списка</Link></Button> : null}
              {nextHref ? <Button variant="ghost" asChild><Link href={nextHref}>Показать следующие</Link></Button> : null}
            </div>
          </div>
        ) : null}
      </div> : undefined}
    </WidgetCard>
  );
}
