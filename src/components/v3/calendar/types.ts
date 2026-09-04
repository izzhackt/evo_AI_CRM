/**
 * Контракт календаря и вся арифметика дат.
 *
 * Файл нарочно без «use client»: по нему считает и страница на сервере (какой
 * отрезок читать из базы), и сетка в браузере (какие клетки рисовать). Один
 * набор правил на обе стороны — иначе сервер прочитал бы одну неделю, а экран
 * нарисовал соседнюю.
 *
 * ДАТА ЗДЕСЬ — СТРОКА «2026-09-03», А НЕ `Date`. Это не упрощение, а защита:
 * `Date` тащит за собой часовой пояс, и у сервера он один, а у браузера
 * другой. Тогда задача со сроком в полночь переезжала бы через сутки прямо
 * при гидрации. Строку же и база отдаёт готовой (`to_char`), и сравнение дат
 * по ней — обычное сравнение строк.
 *
 * Внутренние вычисления идут в UTC (`Date.UTC`, `getUTC*`), поэтому перевод
 * часов летом и зимой на арифметику не влияет: сутки всегда 86 400 000 мс.
 */

export type CalendarView = "day" | "week" | "month";

/** Дата без времени, «2026-09-03». */
export type Day = string;

/**
 * Состояние задачи — ключ `platform.case_tasks.status`, как он лежит в базе.
 *
 * НА ЭКРАН ЭТОТ КЛЮЧ НЕ ПОПАДАЕТ: слово ему даёт `taskStatus()` из
 * `src/lib/v3/wording.ts`, и это единственный словарь. Свои слова здесь
 * заводить нельзя — второй словарь разойдётся с первым, и никто не заметит.
 *
 * Канонические строки всегда сохраняют точный статус из Supabase.
 */
export type TaskState =
  | "open"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";

export type CalendarCaseOption = Readonly<{
  id: string;
  name: string;
}>;

export type CalendarAssigneeOption = Readonly<{
  membershipId: string;
  displayName: string;
}>;

/**
 * Задача приёмной кампании.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: длительности. У задачи один срок, а не начало и
 * конец, поэтому в сетке дня она занимает свой час, а не выдуманный интервал.
 * Нет и исполнителя: задача принадлежит роли приёмной, а роль — не человек,
 * рисовать её аватаром значило бы придумать сотрудника.
 *
 * `student_case_id`, исполнитель, видимость и версия команды остаются в
 * клиентском контракте, потому что они обязательны для точной серверной
 * мутации. На экран UUID и машинные ключи не выводятся.
 */
export type CalendarTask = Readonly<{
  id: string;
  studentCaseId: string;
  taskType: string;
  title: string;
  /** Описание. null — рисовать нечего. */
  details: string | null;
  /** Exact canonical instant submitted unchanged by quick commands. */
  dueAt: string | null;
  /** День срока. */
  day: Day | null;
  /**
   * Минуты от полуночи. null — срок без времени: такая задача встаёт в строку
   * «весь день», а не в час.
   */
  minutes: number | null;
  state: TaskState;
  /** Почему отменена. Бывает только у отменённой. */
  cancelReason: string | null;
  /** Чей это студент. null — не рисуется. */
  person: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  studentVisible: boolean;
  assigneeMembershipId: string;
  assigneeDisplayName: string;
  caseState: "active" | "closed";
  /** Decimal BIGINT returned by Supabase without JavaScript precision loss. */
  version: string;
}>;

export type CalendarTaskRequestIds = Readonly<{
  change: string;
  complete: string;
  cancel: string;
}>;

/* ------------------------------------------------------------------ слова */

const MONTH_NOMINATIVE = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const MONTH_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** Понедельник первый: неделя в календаре начинается с него. */
const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const WEEKDAY_FULL = [
  "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье",
];

/* --------------------------------------------------------------- счётная часть */

const DAY_MS = 86_400_000;
const pad = (value: number) => String(value).padStart(2, "0");

function toMs(day: Day): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

function toDay(ms: number): Day {
  const at = new Date(ms);
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

export function shiftDay(day: Day, days: number): Day {
  return toDay(toMs(day) + days * DAY_MS);
}

export function dayNumber(day: Day): number {
  return new Date(toMs(day)).getUTCDate();
}

export function monthIndex(day: Day): number {
  return new Date(toMs(day)).getUTCMonth();
}

export function yearOf(day: Day): number {
  return new Date(toMs(day)).getUTCFullYear();
}

/** 0 — понедельник. */
export function weekdayIndex(day: Day): number {
  return (new Date(toMs(day)).getUTCDay() + 6) % 7;
}

export function startOfWeek(day: Day): Day {
  return shiftDay(day, -weekdayIndex(day));
}

export function isSameMonth(a: Day, b: Day): boolean {
  return yearOf(a) === yearOf(b) && monthIndex(a) === monthIndex(b);
}

/* ------------------------------------------------------- разбор адреса */

/**
 * Вид приходит адресом, поэтому его нельзя брать на веру: чужое слово в
 * `?view=` открывает неделю, а не роняет страницу.
 */
export function resolveView(raw: string | undefined): CalendarView {
  return raw === "day" || raw === "month" ? raw : "week";
}

/**
 * Дата тоже приходит адресом. Проверяется не только форма, но и то, что дата
 * существует: «2026-02-31» разбирается в 3 марта и обратно уже не собирается,
 * поэтому такая строка отбрасывается вместе с мусором.
 */
export function resolveDay(raw: string | undefined, fallback: Day): Day {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
  return toDay(toMs(raw)) === raw ? raw : fallback;
}

/* ------------------------------------------------------- отрезок и шаг */

/** Клетки сетки: один день, семь дней недели или всё поле месяца. */
export function gridDays(view: CalendarView, day: Day): readonly Day[] {
  if (view === "day") return [day];
  if (view === "week") {
    const start = startOfWeek(day);
    return Array.from({ length: 7 }, (_, index) => shiftDay(start, index));
  }

  const year = yearOf(day);
  const month = monthIndex(day);
  const first = toDay(Date.UTC(year, month, 1));
  const lead = weekdayIndex(first);
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // Недель ровно столько, сколько нужно этому месяцу: постоянные шесть строк
  // дорисовывали бы пустую неделю следующего месяца.
  const cells = Math.ceil((lead + length) / 7) * 7;
  const start = shiftDay(first, -lead);
  return Array.from({ length: cells }, (_, index) => shiftDay(start, index));
}

/** Предыдущий или следующий период того же вида. */
export function stepDay(view: CalendarView, day: Day, direction: 1 | -1): Day {
  if (view === "day") return shiftDay(day, direction);
  if (view === "week") return shiftDay(day, 7 * direction);

  const target = new Date(Date.UTC(yearOf(day), monthIndex(day) + direction, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth();
  // 31 марта минус месяц — это 28 февраля, а не 3 марта.
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toDay(Date.UTC(year, month, Math.min(dayNumber(day), length)));
}

/* --------------------------------------------------------------- подписи */

export function timeLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

/** «5 задач», «2 задачи», «1 задача» — для текста читалке. */
export function taskCountLabel(count: number): string {
  const tail = count % 10;
  const hundred = count % 100;
  if (tail === 1 && hundred !== 11) return `${count} задача`;
  if (tail >= 2 && tail <= 4 && (hundred < 12 || hundred > 14)) return `${count} задачи`;
  return `${count} задач`;
}

export function weekdayShort(day: Day): string {
  return WEEKDAY_SHORT[weekdayIndex(day)];
}

export function weekdayNames(): readonly string[] {
  return WEEKDAY_SHORT;
}

/** «3 сентября». */
export function dayLabel(day: Day): string {
  return `${dayNumber(day)} ${MONTH_GENITIVE[monthIndex(day)]}`;
}

/** «Четверг, 3 сентября 2026» — для читалки и для подписи дня. */
export function dayFullLabel(day: Day): string {
  return `${WEEKDAY_FULL[weekdayIndex(day)]}, ${dayLabel(day)} ${yearOf(day)}`;
}

/** «Сентябрь 2026». */
export function monthLabel(day: Day): string {
  return `${MONTH_NOMINATIVE[monthIndex(day)]} ${yearOf(day)}`;
}

/** Что за период показан сейчас. */
export function periodLabel(view: CalendarView, day: Day): string {
  if (view === "day") return dayFullLabel(day);
  if (view === "month") return monthLabel(day);

  const from = startOfWeek(day);
  const to = shiftDay(from, 6);
  if (isSameMonth(from, to)) {
    return `${dayNumber(from)} — ${dayNumber(to)} ${MONTH_GENITIVE[monthIndex(to)]} ${yearOf(to)}`;
  }
  if (yearOf(from) === yearOf(to)) {
    return `${dayLabel(from)} — ${dayLabel(to)} ${yearOf(to)}`;
  }
  return `${dayLabel(from)} ${yearOf(from)} — ${dayLabel(to)} ${yearOf(to)}`;
}

/** «Предыдущая неделя» и «Следующий месяц» — для кнопок перемещения. */
export function stepLabel(view: CalendarView, direction: 1 | -1): string {
  const back = direction === -1;
  if (view === "day") return back ? "Предыдущий день" : "Следующий день";
  if (view === "week") return back ? "Предыдущая неделя" : "Следующая неделя";
  return back ? "Предыдущий месяц" : "Следующий месяц";
}

export const VIEW_TITLES: readonly Readonly<{ key: CalendarView; title: string }>[] = [
  { key: "day", title: "День" },
  { key: "week", title: "Неделя" },
  { key: "month", title: "Месяц" },
];
