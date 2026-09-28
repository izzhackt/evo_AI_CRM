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

import type { CalendarReadAccess } from "../../../lib/v3/calendar-contract.ts";

export function calendarAccessNotice(access: CalendarReadAccess): string | null {
  return access.tasks ? null : "Нет доступа к личному списку задач.";
}

export type CalendarView = "day" | "week" | "month";

/**
 * Строка пустого периода (Э8.8): говорит о задачах СО СРОКОМ в показанном
 * периоде и не зависит от «Без срока» — прежде её прятала любая задача без
 * срока, и пустая неделя стояла одиннадцатью пустыми часами без слов.
 */
export function calendarEmptyPeriodLabel(access: CalendarReadAccess, view: CalendarView): string | null {
  if (!access.tasks) return null;
  if (view === "day") return "В этот день задач со сроком нет.";
  if (view === "month") return "В этом месяце задач со сроком нет.";
  return "На этой неделе задач со сроком нет.";
}

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

/** Exact target capabilities, never inferred from the actor's union of grants. */
export type CalendarTaskCapabilities = Readonly<{
  taskId: string;
  studentCaseId: string;
  canAssign: boolean;
  canChangeVisibility: boolean;
  canReadCase: boolean;
}>;

export function calendarCapabilitiesForTask(
  task: Pick<CalendarTask, "id" | "studentCaseId">,
  capabilities: CalendarTaskCapabilities | null,
): CalendarTaskCapabilities | null {
  return capabilities?.taskId === task.id && capabilities.studentCaseId === task.studentCaseId
    ? capabilities : null;
}

/**
 * Назначенная сотруднику задача из дела или рабочего раздела «Задачи».
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: длительности. У задачи один срок, а не начало и
 * конец, поэтому в сетке дня она занимает свой час, а не выдуманный интервал.
 *
 * `student_case_id`, исполнитель, видимость и версия команды остаются в
 * клиентском контракте, потому что они обязательны для точной серверной
 * мутации. На экран UUID и машинные ключи не выводятся.
 */
type CalendarTaskFields = Readonly<{
  id: string;
  key: string;
  title: string;
  /** Описание. null — рисовать нечего. */
  details: string | null;
  /** Exact canonical all-day date submitted unchanged by quick commands. */
  dueOn: Day | null;
  /** Exact canonical instant submitted unchanged by quick commands. */
  dueAt: string | null;
  /** День срока. */
  day: Day | null;
  /**
   * Минуты от полуночи. null вместе с непустым `day` означает срок на весь
   * день; null вместе с пустым `day` означает отсутствие срока.
   */
  minutes: number | null;
  /** Server-derived against one request clock and the Bishkek calendar. */
  overdue: boolean;
  state: TaskState;
  /** Почему отменена. Бывает только у отменённой. */
  cancelReason: string | null;
  /** Чей это студент. null — не рисуется. */
  person: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  assigneeMembershipId: string;
  assigneeDisplayName: string;
  /** Decimal BIGINT returned by Supabase without JavaScript precision loss. */
  version: string;
}>;

export type CalendarCaseTask = CalendarTaskFields & Readonly<{
  kind: "case";
  studentCaseId: string;
  taskType: string;
  studentVisible: boolean;
  caseState: "active" | "closed";
}>;

export type CalendarStaffTask = CalendarTaskFields & Readonly<{
  kind: "staff";
  studentCaseId?: never;
  taskType?: never;
  studentVisible?: never;
  caseState?: never;
}>;

export type CalendarTask = CalendarCaseTask | CalendarStaffTask;

/**
 * Строка «весь день» у дня и недели есть, только когда в периоде есть задача
 * со сроком без времени. Сроков подачи в вузы в календаре нет (решение
 * владельца 28.09: они только в «Университетах»).
 */
export function hasCalendarAllDayRow(allDayTasks: readonly CalendarTask[]): boolean {
  return allDayTasks.length > 0;
}

/** Открыта ли задача: выполненные и отменённые работой не считаются. */
export function calendarTaskIsOpen(task: Pick<CalendarTask, "state">): boolean {
  return task.state !== "done" && task.state !== "cancelled";
}

/**
 * Дни, о которых говорит строка пустого периода: у месяца — дни самого
 * месяца (хвосты соседних месяцев в сетке — чужие), у дня и недели — все
 * клетки. Задача, открытая адресом из другого периода, сюда не входит.
 */
export function calendarPeriodDays(view: CalendarView, anchor: Day, days: readonly Day[]): readonly Day[] {
  return view === "month" ? days.filter((day) => isSameMonth(day, anchor)) : days;
}

/** Есть ли в показанном периоде хоть одна задача со сроком. */
export function calendarHasDatedTasks(
  view: CalendarView,
  anchor: Day,
  days: readonly Day[],
  tasks: readonly Pick<CalendarTask, "day">[],
): boolean {
  const period = new Set(calendarPeriodDays(view, anchor, days));
  return tasks.some((task) => task.day !== null && period.has(task.day));
}

/** Задачи дня по порядку: сначала «весь день», затем по времени. */
export function calendarTasksOfDay<T extends Pick<CalendarTask, "day" | "minutes">>(
  tasks: readonly T[],
  day: Day,
): readonly T[] {
  return tasks
    .filter((task) => task.day === day)
    .map((task, index) => ({ task, index }))
    .sort((left, right) =>
      (left.task.minutes ?? -1) - (right.task.minutes ?? -1) || left.index - right.index)
    .map(({ task }) => task);
}

export type CalendarDayListEntry<T> =
  | Readonly<{ kind: "day"; day: Day; tasks: readonly T[] }>
  | Readonly<{ kind: "empty"; from: Day; to: Day }>;

/**
 * Телефон (<768 px, Э8.8): неделя и месяц — список по дням. День с задачами —
 * своя группа; подряд идущие пустые дни сворачиваются в одну строку «с — по,
 * задач нет». Сегодня и выбранный день (на него «Создать задачу» ставит срок)
 * пустую полосу разрывают: их видно своей строкой.
 */
export function calendarDayList<T extends Pick<CalendarTask, "day" | "minutes">>(
  days: readonly Day[],
  tasks: readonly T[],
  pinned: readonly Day[],
): readonly CalendarDayListEntry<T>[] {
  const entries: CalendarDayListEntry<T>[] = [];
  let run: { from: Day; to: Day } | null = null;
  const flush = () => {
    if (run) entries.push(Object.freeze({ kind: "empty", ...run }));
    run = null;
  };
  for (const day of days) {
    const dayTasks = calendarTasksOfDay(tasks, day);
    if (dayTasks.length > 0 || pinned.includes(day)) {
      flush();
      entries.push(Object.freeze({ kind: "day", day, tasks: dayTasks }));
    } else if (run) {
      run.to = day;
    } else {
      run = { from: day, to: day };
    }
  }
  flush();
  return Object.freeze(entries);
}

export type CalendarTaskDeadlineInputDefaults = Readonly<{
  dueOn: Day;
  dueAt: string;
}>;

/**
 * Preserve the task's own calendar day when the editor changes deadline kind.
 * The visible period anchor is only a fallback for new or unscheduled tasks.
 */
export function taskDeadlineInputDefaults(
  task: Pick<CalendarTask, "day" | "minutes"> | undefined,
  fallbackDay: Day,
): CalendarTaskDeadlineInputDefaults {
  const deadlineDay = task?.day ?? fallbackDay;
  const dueAt = task?.day !== null && task?.day !== undefined && task.minutes !== null
    ? `${task.day}T${String(Math.floor(task.minutes / 60)).padStart(2, "0")}:${String(task.minutes % 60).padStart(2, "0")}`
    : `${deadlineDay}T09:00`;

  return Object.freeze({ dueOn: deadlineDay, dueAt });
}

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
const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
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

/** Signed whole calendar-day distance with no browser/server timezone drift. */
export function dayDelta(from: Day, to: Day): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
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

export function calendarUndatedContinuationHref(
  basePath: string,
  view: CalendarView,
  day: Day,
  cursor: Readonly<{ sortAt: string; caseTaskId: string }> | Readonly<{ sortAt: string; kind: "case" | "staff"; taskId: string }>,
): string {
  const params = new URLSearchParams({
    view,
    date: day,
    undated_after_sort_at: cursor.sortAt,
    ...("kind" in cursor
      ? { undated_after_kind: cursor.kind, undated_after_task_id: cursor.taskId }
      : { undated_after_case_task_id: cursor.caseTaskId }),
  });
  return `${basePath}?${params.toString()}`;
}

export function calendarUndatedPageNotice(
  continuationPage: boolean,
  hasNextPage: boolean,
  visibleCount: number,
): string | null {
  if (continuationPage && hasNextPage) {
    return `Показана текущая страница (${visibleCount}): предыдущие и следующие задачи без срока находятся на других страницах.`;
  }
  if (continuationPage) {
    return `Показана последняя страница (${visibleCount}): предыдущие задачи без срока не показаны.`;
  }
  if (hasNextPage) {
    return `Показаны не все задачи без срока: на этой странице ${visibleCount}.`;
  }
  return null;
}

/**
 * Число в «Без срока — N»: открытые задачи без срока. Выполненные и
 * отменённые остаются в списке (зачёркнутыми), но работой не считаются —
 * прежде число брало `total_count` чтения, где они есть (аудит 26.09).
 * Точно число известно, только когда весь список без срока прочитан на этой
 * странице; есть продолжение — «N+» (нижняя граница, как «20+» у очередей),
 * а на странице продолжения или без открытых задач при продолжении — без
 * числа: нет чтения — нет числа.
 */
export function calendarUndatedOpenCount(
  tasks: readonly Pick<CalendarTask, "day" | "state">[],
  continuationPage: boolean,
  hasNextPage: boolean,
): string | null {
  if (continuationPage) return null;
  const open = tasks.filter((task) => task.day === null && task.state !== "done" && task.state !== "cancelled").length;
  if (!hasNextPage) return String(open);
  return open > 0 ? `${open}+` : null;
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

/** «09:30» — время срока в календаре, «ЧЧ:ММ» по Бишкеку (DESIGN.md). */
export function clockLabel(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
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
