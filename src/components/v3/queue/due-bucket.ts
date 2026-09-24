/**
 * Сроки рабочей очереди (грамматика «Задач», затем «Студентов»): группа по
 * сроку, короткая дата и слово рядом с ней.
 *
 * Правило дня — то же, что у сервера и календаря: день срока считается в
 * часовом поясе организации (Бишкек), задача со временем просрочена, когда её
 * момент уже прошёл, задача на весь день — когда её день раньше сегодняшнего
 * (`projectPlatformTaskDeadline`). Файл без «use client» и без React: по нему
 * группирует и сервер, и строка в браузере, и unit-тест.
 */
import { dayInOrganizationTimezone, projectPlatformTaskDeadline } from "../../../lib/platform-task-deadline.ts";
import { dayDelta, shiftDay, weekdayIndex } from "../calendar/types.ts";

/** Группы открытой очереди в порядке показа; `past` — только у закрытых задач. */
export const DUE_BUCKETS = ["overdue", "today", "tomorrow", "week", "later", "none"] as const;
export type DueFilter = (typeof DUE_BUCKETS)[number];
export type DueBucket = DueFilter | "past";

export type DueInput = Readonly<{ dueOn: string | null; dueAt: string | null }>;

const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;

/** Последний день (воскресенье) недели, в которую входит `day`; неделя с понедельника. */
export function weekEnd(day: string): string {
  return shiftDay(day, 6 - weekdayIndex(day));
}

/** Ближайшая пятница после сегодняшнего дня (в пятницу — следующая). */
export function nextFriday(today: string): string {
  const index = weekdayIndex(today);
  return shiftDay(today, index < 4 ? 4 - index : 11 - index);
}

/**
 * Группа задачи. Открытая задача с прошедшим сроком — «overdue» (и сегодняшняя
 * со временем, которое уже прошло). У закрытой задачи просрочки нет: её
 * прошедший день — «past».
 */
export function dueBucket(task: DueInput, now: Date, open = true): DueBucket {
  const deadline = projectPlatformTaskDeadline(task.dueOn, task.dueAt, now);
  if (deadline.day === null) return "none";
  const today = dayInOrganizationTimezone(now);
  if (open && deadline.overdue) return "overdue";
  if (deadline.day < today) return open ? "overdue" : "past";
  if (deadline.day === today) return "today";
  if (deadline.day === shiftDay(today, 1)) return "tomorrow";
  return deadline.day <= weekEnd(today) ? "week" : "later";
}

/** «25.09»; год двумя цифрами — только если он не текущий: «03.01.27». */
export function formatQueueDay(day: string, today: string): string {
  const [year, month, date] = day.split("-");
  return year === today.slice(0, 4) ? `${date}.${month}` : `${date}.${month}.${year.slice(2)}`;
}

/** «чт 25.09» — для заголовков групп «Сегодня» и «Завтра». */
export function queueDayWithWeekday(day: string, today: string): string {
  return `${WEEKDAY_SHORT[weekdayIndex(day)]} ${formatQueueDay(day, today)}`;
}

export type QueueDue = Readonly<{
  /** Значение для `<time dateTime>`: день или точный момент срока. */
  dateTime: string;
  /** «25.09» или «25.09 14:00» — по Бишкеку. */
  text: string;
  /** «прошёл», «сегодня», «завтра», «через 3 дн»; null — слово не нужно. */
  word: string | null;
  /**
   * Подпись даты у закрытой задачи — «срок»: в списке завершённых голая дата
   * читается как день завершения, а его чтение не отдаёт. У открытой — null.
   */
  caption: string | null;
  overdue: boolean;
}>;

/** Срок строки очереди: моноширинная дата и слово по правилу дня Бишкека. */
export function queueDue(task: DueInput, now: Date, open = true): QueueDue | null {
  const deadline = projectPlatformTaskDeadline(task.dueOn, task.dueAt, now);
  if (deadline.day === null) return null;
  const today = dayInOrganizationTimezone(now);
  const time = deadline.minutes === null ? ""
    : ` ${String(Math.floor(deadline.minutes / 60)).padStart(2, "0")}:${String(deadline.minutes % 60).padStart(2, "0")}`;
  const overdue = open && (deadline.overdue || deadline.day < today);
  const distance = dayDelta(today, deadline.day);
  const word = !open ? null
    : overdue ? "прошёл"
    : distance === 0 ? "сегодня"
    : distance === 1 ? "завтра"
    : `через ${distance} дн`;
  return Object.freeze({
    dateTime: task.dueAt ?? deadline.day,
    text: `${formatQueueDay(deadline.day, today)}${time}`,
    word,
    caption: open ? null : "срок",
    overdue,
  });
}

/** Заголовок группы: «Просрочено», «Сегодня · чт 25.09», «Завтра · пт 26.09»… */
export function dueBandLabel(bucket: DueBucket, today: string): string {
  switch (bucket) {
    case "overdue": return "Просрочено";
    case "today": return `Сегодня · ${queueDayWithWeekday(today, today)}`;
    case "tomorrow": return `Завтра · ${queueDayWithWeekday(shiftDay(today, 1), today)}`;
    case "week": return "На этой неделе";
    case "later": return "Позже";
    case "none": return "Без срока";
    case "past": return "Раньше";
  }
}

/** Подписи фильтра «Срок» — те же слова, что у групп, без дат. */
export const DUE_FILTER_LABELS: Readonly<Record<DueFilter, string>> = {
  overdue: "Просрочено",
  today: "Сегодня",
  tomorrow: "Завтра",
  week: "На этой неделе",
  later: "Позже",
  none: "Без срока",
};

export function parseDueFilter(value: string | undefined): DueFilter | null {
  return DUE_BUCKETS.find((bucket) => bucket === value) ?? null;
}
