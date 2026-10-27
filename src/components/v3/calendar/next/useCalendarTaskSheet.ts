"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import type { PersonalCalendarCursor } from "@/lib/v3/personal-calendar-contract";

import { calendarUndatedContinuationHref, type CalendarTask, type CalendarView, type Day } from "../types";

/**
 * Какая задача открыта в панели «Календаря» нового вида. Истина — адрес (`?case=…&task=…` / `?kind=staff&task=…`): страница
 * читает задачу и точные права на неё и присылает `initialTaskKey`. Нажатая карточка открывает панель сразу (скелет под
 * названием), пока сервер отвечает; закрытие тоже сразу, а когда сервер подтвердил, что задачи в адресе нет, отметка «закрыто»
 * снимается — «Назад» браузера открывает панель снова. Фокус возвращается на карточку, откуда панель открыли.
 */
export function useCalendarTaskSheet({ tasks, confirmedKey, view, day, undatedCursor, basePath }: Readonly<{
  tasks: readonly CalendarTask[];
  /** Задача из адреса, которую сервер подтвердил (или назвал недоступной). */
  confirmedKey: string | null;
  view: CalendarView;
  day: Day;
  undatedCursor: PersonalCalendarCursor | null;
  basePath: string;
}>) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [pending, setPending] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  if (pending !== null && pending === confirmedKey) setPending(null);
  if (confirmedKey === null && dismissed !== null && pending === null) setDismissed(null);
  const shownKey = pending ?? confirmedKey;
  const sheetOpen = shownKey !== null && shownKey !== dismissed;
  const confirmed = shownKey !== null && shownKey === confirmedKey;

  const go = (target: CalendarTask | undefined) => {
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

  return {
    navigating,
    sheetOpen,
    confirmed,
    shown: tasks.find((task) => task.key === shownKey) ?? null,
    selectedKey: sheetOpen ? shownKey : null,
    opener,
    select(key: string, from: HTMLElement | null) {
      opener.current = from;
      setDismissed(null);
      if (key !== confirmedKey) setPending(key);
      go(tasks.find((task) => task.key === key));
    },
    close() {
      if (!sheetOpen) return;
      setDismissed(shownKey);
      setPending(null);
      go(undefined);
    },
  };
}
