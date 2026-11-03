import { todayForTimeline } from "./country-timeline.ts";

/**
 * «Ближайшие даты» на «Главной» (03.11.2026, по образцу кабинета
 * пользователя): неделя от сегодняшнего дня Бишкека и список датированных
 * пунктов из того, что «Главная» уже читает, — сроки дел студента и ближайшие
 * дедлайн или старт избранных вузов. Своих чтений и выдуманных дат нет.
 */
export type HomeDateItem = Readonly<{ day: string; title: string; href: string }>;

const DAY_MS = 86_400_000;

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** День Бишкека (YYYY-MM-DD) для момента ISO. */
export function bishkekDay(iso: string): string {
  return todayForTimeline(new Date(iso));
}

/** `count` дней подряд, начиная с `today` (YYYY-MM-DD). */
export function homeWeek(today: string, count = 7): string[] {
  const start = dayNumber(today);
  return Array.from({ length: count }, (_, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10));
}

/** Пункты от сегодня до `horizonDays` вперёд, по дате, не больше `limit`. */
export function upcomingHomeDates(
  items: readonly HomeDateItem[],
  today: string,
  horizonDays = 60,
  limit = 5,
): HomeDateItem[] {
  const from = dayNumber(today);
  const to = from + horizonDays * DAY_MS;
  return items
    .filter((item) => {
      const at = dayNumber(item.day);
      return Number.isFinite(at) && at >= from && at <= to;
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title))
    .slice(0, limit);
}
