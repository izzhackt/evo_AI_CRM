import type { Locale } from "../i18n-data.ts";
import type { CatalogPreparation } from "./catalog-preparations.ts";
import { todayForTimeline } from "./country-timeline.ts";
import { formatPortalString, type PortalStrings } from "./i18n.ts";

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

/** Короткий месяц даты YYYY-MM-DD: «сент.», «окт.» (плитка «Ближайших дат» и отсчёт в шапке). */
export function homeMonthShort(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", { month: "short", timeZone: "UTC" })
    .format(new Date(`${day}T12:00:00Z`));
}

/**
 * Дата строкой «25 сент.», «31 мая» — для текста, где число стоит рядом с месяцем (отсчёт в шапке, отметки анкеты,
 * время событий). В плитке календаря месяц стоит отдельно — там `homeMonthShort` («май»).
 */
export function homeDayMonth(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${day}T12:00:00Z`));
}

/** Сколько дней от `today` до `day` (оба YYYY-MM-DD): 0 — сегодня, 1 — завтра. */
export function homeDaysUntil(day: string, today: string): number {
  return Math.round((dayNumber(day) - dayNumber(today)) / DAY_MS);
}

/**
 * Срок словом: «сегодня», «завтра», «через 5 дней», «просрочено на 3 дня» (18.11.2026: строки «Ближайших дат» и дела
 * «Что сделать сейчас»). Русские формы числа — Intl.PluralRules, у кыргызского одна форма.
 */
export function homeDaysLabel(days: number, locale: Locale, strings: PortalStrings<"home">): string {
  if (days === 0) return strings.dateToday;
  if (days === 1) return strings.dateTomorrow;
  const count = Math.abs(days);
  const form = new Intl.PluralRules(locale === "ky" ? "ky" : "ru").select(count);
  const key = days < 0
    ? (form === "one" ? "dateOverdue.one" : form === "few" ? "dateOverdue.few" : "dateOverdue.many")
    : (form === "one" ? "dateIn.one" : form === "few" ? "dateIn.few" : "dateIn.many");
  return formatPortalString(strings[key], { count: String(count) });
}

/**
 * Сроки своих программ (18.11.2026): программа, которую куратор открыл в «Мои программы», с её набором — последний день
 * подачи, а без него начало учёбы. Только пока по программе готовят документы (заявка не подана), только у набора,
 * который открыт или объявлен, и только если срок при выборе подтверждён (10.11: «уточнить с куратором» датой не
 * считается). `institutionId` — чтобы общая строка того же вуза из избранного не повторяла программу.
 */
export function preparationHomeDates(
  items: readonly CatalogPreparation[],
  today: string,
  strings: PortalStrings<"home">,
): (HomeDateItem & Readonly<{ institutionId: string }>)[] {
  return items.flatMap((item) => {
    if (item.applicationStatus !== "preparation" && item.applicationStatus !== "ready") return [];
    if (item.deadlineStateAtSelection !== "confirmed") return [];
    const program = item.content.programs.find((candidate) => candidate.id === item.programId);
    const intake = program?.intakes.find((candidate) => candidate.id === item.intakeId);
    if (!program || !intake || (intake.status !== "open" && intake.status !== "announced")) return [];
    const names = { program: program.title, university: item.content.name };
    const href = `/portal/preparations/${item.applicationId}`;
    if (intake.applicationDeadline && intake.applicationDeadline >= today) {
      return [{ day: intake.applicationDeadline, title: formatPortalString(strings.dateProgramDeadline, names), href, institutionId: item.institutionId }];
    }
    if (intake.startDate && intake.startDate >= today) {
      return [{ day: intake.startDate, title: formatPortalString(strings.dateProgramStart, names), href, institutionId: item.institutionId }];
    }
    return [];
  });
}

/** Первый пункт позже окна «Ближайших дат»: его показывают строкой «Дальше», когда в окне пусто. */
export function laterHomeDate(items: readonly HomeDateItem[], today: string, horizonDays = 60): HomeDateItem | null {
  const to = dayNumber(today) + horizonDays * DAY_MS;
  return [...items]
    .filter((item) => dayNumber(item.day) > to)
    .sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title))[0] ?? null;
}

const BISHKEK_TIME = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", hour: "2-digit", minute: "2-digit" });

/**
 * Когда пришло событие, словом (18.11.2026, «Что нового»): «сегодня, 14:00», «вчера, 16:30», «3 дня назад», а старше
 * недели — «16 сент.» (другой год — с годом). Дни — по календарю Бишкека.
 */
export function homeTimeLabel(iso: string, now: Date, locale: Locale, strings: PortalStrings<"home">): string | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.valueOf())) return null;
  const day = bishkekDay(iso);
  const ago = -homeDaysUntil(day, todayForTimeline(now));
  const time = BISHKEK_TIME.format(at);
  if (ago <= 0) return formatPortalString(strings.timeToday, { time });
  if (ago === 1) return formatPortalString(strings.timeYesterday, { time });
  if (ago < 7) {
    const form = new Intl.PluralRules(locale === "ky" ? "ky" : "ru").select(ago);
    const key = form === "one" ? "timeDaysAgo.one" : form === "few" ? "timeDaysAgo.few" : "timeDaysAgo.many";
    return formatPortalString(strings[key], { count: String(ago) });
  }
  const short = homeDayMonth(day, locale);
  return day.slice(0, 4) === todayForTimeline(now).slice(0, 4) ? short : `${short} ${day.slice(0, 4)}`;
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
