/**
 * «Сегодня» (Э3 плана редизайна, 26.09.2026) — одна очередь того, что пора
 * сделать, из существующих чтений: мои задачи, мои студенты (241/242), мои
 * лиды и заявки без ответственного (чтение доски продаж), переписки, ждущие
 * ответа («Сообщения»).
 *
 * Чистая логика без React и без запросов: строки источников, группы по
 * срочности, слияние, числа групп и пустое состояние. По этим функциям рисует
 * страница и проверяет unit-тест.
 *
 * Правило чисел одно: число у группы есть, только когда каждое чтение,
 * которое пишет в эту группу, прочитано целиком и его строки можно считать
 * (`TODAY_UNCOUNTED`). Неполное чтение и ошибка называются словами, а не
 * превращаются в ноль.
 */
import type { PipelineLead } from "../../components/v3/Pipeline.tsx";
import { dayDelta, shiftDay } from "../../components/v3/calendar/types.ts";
import { dueBandLabel, dueBucket, formatQueueDay, queueDayWithWeekday, queueDue } from "../../components/v3/queue/due-bucket.ts";
import { queueHref } from "../../components/v3/queue/queue-url.ts";
import type { PlatformAdmissionsTaskQueueRow } from "../platform-admissions-task-contract.ts";
import type { CaseChatThreadRow } from "../platform-case-chat-contract.ts";
import type { StaffTask } from "../platform-staff-task-contract.ts";
import type { StudentCaseQueueRow } from "../platform-student-case-queue-contract.ts";
import { dayInOrganizationTimezone, platformTaskDeadlineSortTime, projectPlatformTaskDeadline } from "../platform-task-deadline.ts";
import { queueTaskFromCase, queueTaskFromStaff, taskIsOpen, type QueueTask } from "./task-queue.ts";
import { source as sourceWord } from "./wording.ts";

/** Группы очереди в порядке показа: от срочного к ближайшему. */
export const TODAY_BANDS = ["overdue", "today", "waiting", "no_step", "upcoming"] as const;
export type TodayBand = (typeof TODAY_BANDS)[number];

/**
 * Источники. У «Студентов» два чтения 241/242: вид «Мои» (`students`) и вид
 * «Требуют действия» (`handoffs` — ждёт принятия и нужен куратор); у каждого
 * своя полнота, поэтому это два источника.
 */
export const TODAY_SOURCES = ["tasks", "students", "handoffs", "leads", "requests", "chats"] as const;
export type TodaySource = (typeof TODAY_SOURCES)[number];

/** «Ближайшие 14 дней»: срок после сегодняшнего дня и не дальше этого числа дней. */
export const TODAY_HORIZON_DAYS = 14;

/** В какие группы пишет каждый источник: по ним решается, есть ли у группы число. */
export const TODAY_SOURCE_BANDS: Readonly<Record<TodaySource, readonly TodayBand[]>> = {
  tasks: ["overdue", "today", "upcoming"],
  students: ["overdue", "today", "no_step", "upcoming"],
  handoffs: ["waiting"],
  leads: ["overdue", "today", "no_step", "upcoming"],
  requests: ["waiting"],
  chats: ["waiting"],
};

export type TodayWho = Readonly<{ name: string; href: string }>;
export type TodayDue = Readonly<{ dueOn: string | null; dueAt: string | null }>;

export type TodayItem = Readonly<{
  /** Один ключ на строку; у задачи — ключ строки «Задач» (`staff:<id>`, `case:<id>`). */
  key: string;
  source: TodaySource;
  band: TodayBand;
  /** Что сделать. */
  title: string;
  /** Кто: студент или лид; null — рабочая задача без человека. */
  who: TodayWho | null;
  /** Почему строка здесь — слово причины. */
  reason: string;
  /** Срок (правило дня Бишкека); null — у причины нет срока. */
  due: TodayDue | null;
  /** С какого момента ждёт (переписка); null — неизвестно. */
  since: string | null;
  /**
   * Сколько дней ждёт без даты: новая заявка — дни на этапе «Новый» доски
   * (`stageAgeDays`, день Бишкека). Только слово («ждёт 3 дн»), дата не
   * выводится; null — неизвестно.
   */
  waitingDays: number | null;
  /** Существующая панель или страница записи. */
  openHref: string;
  /** Задача рисуется настоящей строкой «Задач» (круг завершения, «Отменить»); иначе null. */
  task: QueueTask | null;
}>;

export type TodaySourceRead =
  | Readonly<{ source: TodaySource; state: "complete" | "partial"; items: readonly TodayItem[] }>
  /**
   * `denied` — сервер отказал в чтении этой роли; `preview` — просмотр роли,
   * которому проекция не отдаёт записи. Такой источник не её: чисел он не гасит.
   */
  | Readonly<{ source: TodaySource; state: "error" | "denied" | "preview" }>;

export type TodayBandView = Readonly<{
  band: TodayBand;
  label: string;
  /** Число строк — только когда все чтения, пишущие в группу, полные и считаемые; иначе null. */
  count: number | null;
  danger: boolean;
  /** Почему у группы нет числа, хотя чтения полные (см. `TODAY_UNCOUNTED`); иначе null. */
  note: string | null;
  items: readonly TodayItem[];
}>;

export type TodayNotice = Readonly<{
  source: TodaySource;
  kind: "error" | "partial" | "denied" | "preview";
  text: string;
  link: Readonly<{ label: string; href: string }> | null;
}>;

export type TodayQueue = Readonly<{
  today: string;
  /** Только непустые группы, в порядке `TODAY_BANDS`. */
  bands: readonly TodayBandView[];
  notices: readonly TodayNotice[];
  /** Хотя бы один источник относится к этой роли. */
  applicable: boolean;
  /** Все источники роли прочитаны целиком. */
  complete: boolean;
  /** В группах действия («Просрочено» — «Без следующего шага») строк нет. */
  actionEmpty: boolean;
  /** Ближайший срок из «Ближайших 14 дней»: «чт» и «02.10»; null — сроков нет. */
  nearest: Readonly<{ day: string; weekday: string; date: string }> | null;
}>;

const TODAY_PATH = "/v3/main";

/**
 * Источники, чьи строки есть, а число — нет, даже при полном чтении. Переписки:
 * разбор 26.09 нашёл, что ответ сотрудника не снимает «Нужен ответ»
 * (`191_platform_case_chat.sql`, состояние треда сохраняется), поэтому часть
 * строк может быть уже отвечена. Пока сервер не исправлен, число группы с
 * такими строками было бы завышенным — его нет, а группа говорит почему.
 */
export const TODAY_UNCOUNTED: Readonly<Partial<Record<TodaySource, string>>> = {
  chats: "Без числа: часть переписок «Нужен ответ» может быть уже отвечена.",
};

/** Слова источника в уведомлениях: ошибка, неполное чтение и где смотреть всё. */
type SourceCopy = Readonly<{ error: string; partial: string; denied: string; preview: string; all: Readonly<{ label: string; href: string }> }>;

const SOURCE_COPY: Readonly<Record<TodaySource, SourceCopy>> = {
  tasks: {
    error: "Задачи не загрузились.",
    partial: "Задачи прочитаны не полностью: показана прочитанная часть, числа скрыты.",
    denied: "Задачи недоступны вашей роли.",
    preview: "При просмотре роли задачи не показываются.",
    all: { label: "Все задачи", href: "/v3/tasks" },
  },
  students: {
    error: "Студенты не загрузились.",
    partial: "Студенты прочитаны не полностью: показана прочитанная часть, числа скрыты.",
    denied: "Очередь студентов недоступна вашей роли.",
    preview: "При просмотре роли студенты не показываются.",
    all: { label: "Мои студенты", href: "/v3/profile?view=mine" },
  },
  handoffs: {
    error: "Дела, ждущие принятия, не загрузились.",
    partial: "Дела, требующие действия, прочитаны не полностью: показана прочитанная часть, числа скрыты.",
    denied: "Очередь студентов недоступна вашей роли.",
    preview: "При просмотре роли дела не показываются.",
    all: { label: "Требуют действия", href: "/v3/profile?view=needs_action" },
  },
  leads: {
    error: "Лиды не загрузились.",
    partial: "Лиды прочитаны не полностью: показана прочитанная часть, числа скрыты.",
    denied: "Лиды недоступны вашей роли.",
    preview: "При просмотре роли лиды и заявки не показываются.",
    all: { label: "Мои лиды", href: "/v3/pipeline?assignment=mine" },
  },
  requests: {
    error: "Заявки без ответственного не загрузились.",
    partial: "Заявки без ответственного прочитаны не полностью: показана прочитанная часть, числа скрыты.",
    denied: "Заявки недоступны вашей роли.",
    preview: "При просмотре роли заявки не показываются.",
    all: { label: "Без ответственного", href: "/v3/pipeline?assignment=unassigned" },
  },
  chats: {
    error: "Сообщения не загрузились.",
    partial: "Переписки прочитаны не полностью: показана прочитанная часть, числа скрыты.",
    denied: "Сообщения недоступны вашей роли.",
    preview: "При просмотре роли переписки не показываются.",
    all: { label: "Нужен ответ", href: "/v3/messages?queue=needs_reply" },
  },
};

const SOURCE_ORDER: Readonly<Record<TodaySource, number>> = Object.fromEntries(TODAY_SOURCES.map((source, index) => [source, index])) as Record<TodaySource, number>;
const BAND_ORDER: Readonly<Record<TodayBand, number>> = Object.fromEntries(TODAY_BANDS.map((band, index) => [band, index])) as Record<TodayBand, number>;

function horizonDay(today: string): string {
  return shiftDay(today, TODAY_HORIZON_DAYS);
}

function studentHref(studentCaseId: string): string {
  return queueHref("/v3/profile", { case: studentCaseId, tab: "overview" });
}

// --- Источники -----------------------------------------------------------

/**
 * Мои открытые задачи: рабочие (чтение уже только «Мои») и по студентам,
 * назначенные мне. «Просрочено», «Сегодня» и «Ближайшие 14 дней» — по
 * общему правилу дня Бишкека (`dueBucket`); задачи без срока и дальше
 * горизонта — в «Задачах», не здесь. Повтор задачи в чтении — данные не
 * сходятся: источник отказывает целиком, как «Задачи».
 */
export function todayTaskItems(input: Readonly<{
  staff: readonly StaffTask[];
  cases: readonly PlatformAdmissionsTaskQueueRow[];
  actorMembershipId: string;
  now: Date;
}>): readonly TodayItem[] {
  const today = dayInOrganizationTimezone(input.now);
  const horizon = horizonDay(today);
  const seen = new Set<string>();
  const items: TodayItem[] = [];
  for (const task of [...input.staff.map(queueTaskFromStaff), ...input.cases.map(queueTaskFromCase)]) {
    if (seen.has(task.key)) throw new Error("Today queue received a duplicate task.");
    seen.add(task.key);
    if (!taskIsOpen(task.status) || task.assigneeMembershipId !== input.actorMembershipId) continue;
    const bucket = dueBucket(task, input.now, true);
    const day = projectPlatformTaskDeadline(task.dueOn, task.dueAt, input.now).day;
    const band: TodayBand | null = bucket === "overdue" ? "overdue"
      : bucket === "today" ? "today"
      : bucket === "none" || day === null || day > horizon ? null
      : "upcoming";
    if (band === null) continue;
    items.push(Object.freeze({
      key: task.key,
      source: "tasks",
      band,
      title: task.title,
      who: task.kind === "case" && task.studentCaseId && task.studentDisplayName
        ? { name: task.studentDisplayName, href: studentHref(task.studentCaseId) } : null,
      reason: task.kind === "case" ? "задача по студенту" : "рабочая задача",
      due: { dueOn: task.dueOn, dueAt: task.dueAt },
      since: null,
      waitingDays: null,
      openHref: task.kind === "staff"
        ? queueHref("/v3/tasks", {}, { task: task.id })
        : queueHref("/v3/tasks", {}, { task: task.id, kind: "case", case: task.studentCaseId }),
      task,
    }));
  }
  return Object.freeze(items);
}

/**
 * Мои дела (вид «Мои» чтения 241): «Следующий шаг» по группе, которую
 * посчитал SQL (`dueBand` от дня Бишкека `today` чтения), и просроченный
 * дедлайн по флагу внимания — то же правило, что у сигнала «Просрочен
 * дедлайн» в «Студентах». Одна строка на дело, в самой срочной группе.
 * Шаг без срока — в «Студентах», не здесь.
 */
export function todayStudentItems(rows: readonly StudentCaseQueueRow[], today: string): readonly TodayItem[] {
  const horizon = horizonDay(today);
  const items: TodayItem[] = [];
  for (const row of rows) {
    if (row.state !== "active" || !row.isMine) continue;
    // `step` — причина со сроком шага: только у неё колонка «Когда» показывает дату шага.
    const found: { band: TodayBand; reason: string; step: boolean }[] = [];
    if (row.dueBand === "overdue") found.push({ band: "overdue", reason: "шаг просрочен", step: true });
    else if (row.dueBand === "today") found.push({ band: "today", reason: "шаг на сегодня", step: true });
    else if (row.dueBand === "no_step") found.push({ band: "no_step", reason: "шаг не задан", step: false });
    else if ((row.dueBand === "this_week" || row.dueBand === "later") && row.nextActionDueOn !== null && row.nextActionDueOn <= horizon) {
      found.push({ band: "upcoming", reason: "следующий шаг", step: true });
    }
    // Дату дедлайна чтение не отдаёт: строка без срока, причина — словом.
    if (row.attentionFlags.includes("overdue") && row.overdueTaskCount === 0 && row.dueBand !== "overdue") {
      found.push({ band: "overdue", reason: "дедлайн просрочен", step: false });
    }
    if (found.length === 0) continue;
    found.sort((left, right) => BAND_ORDER[left.band] - BAND_ORDER[right.band]);
    items.push(Object.freeze({
      key: `student:${row.studentCaseId}`,
      source: "students",
      band: found[0].band,
      title: row.nextAction ?? "Задать следующий шаг",
      who: { name: row.studentDisplayName, href: studentHref(row.studentCaseId) },
      // «следующий шаг» — не причина рядом с другой: остаётся, только когда он один.
      reason: found.filter((entry, index) => index === 0 || entry.band !== "upcoming").map((entry) => entry.reason).join(" · "),
      due: found[0].step && row.nextActionDueOn ? { dueOn: row.nextActionDueOn, dueAt: null } : null,
      since: null,
      waitingDays: null,
      openHref: queueHref("/v3/profile", { view: "mine", open: row.studentCaseId }),
      task: null,
    }));
  }
  return Object.freeze(items);
}

/**
 * Вид «Требуют действия» (241/242): моё дело, ждущее принятия, и — только
 * тем, кто назначает кураторов (`coverage`), — дело без куратора. Чужие
 * просрочки этого вида — работа их кураторов, не «Сегодня» смотрящего.
 */
export function todayHandoffItems(rows: readonly StudentCaseQueueRow[], options: Readonly<{ coverage: boolean }>): readonly TodayItem[] {
  const items: TodayItem[] = [];
  for (const row of rows) {
    const who = { name: row.studentDisplayName, href: studentHref(row.studentCaseId) };
    if (row.attentionFlags.includes("awaiting_ack") && row.isMine) {
      items.push(Object.freeze({
        key: `student:${row.studentCaseId}`, source: "handoffs", band: "waiting", title: "Принять дело", who,
        reason: "ждёт принятия", due: null, since: null, waitingDays: null, task: null,
        openHref: queueHref("/v3/profile", { view: "needs_action", open: row.studentCaseId }),
      }));
    } else if (row.attentionFlags.includes("needs_curator") && options.coverage) {
      items.push(Object.freeze({
        key: `student:${row.studentCaseId}`, source: "handoffs", band: "waiting", title: "Назначить куратора", who,
        reason: "нужен куратор", due: null, since: null, waitingDays: null, task: null,
        openHref: queueHref("/v3/profile", { view: "needs_curator", open: row.studentCaseId }),
      }));
    }
  }
  return Object.freeze(items);
}

/**
 * Мои лиды из чтения доски продаж: только рабочие этапы (переданный лид —
 * колонка «Переданы», его работа закончена). Срок следующего действия — то
 * же слово доски: «Просрочено», «Сегодня», «Без действия» (срок не
 * назначен), позже — «Ближайшие 14 дней».
 */
export function todayLeadItems(leads: readonly PipelineLead[], today: string): readonly TodayItem[] {
  const horizon = horizonDay(today);
  const items: TodayItem[] = [];
  for (const lead of leads) {
    if (lead.stageKey === "handed_off") continue;
    const dueOn = lead.workflow.nextActionDueDate;
    const band: TodayBand | null = lead.due === "overdue" ? "overdue"
      : lead.due === "today" ? "today"
      : lead.due === "none" ? "no_step"
      : dueOn !== null && dueOn <= horizon ? "upcoming" : null;
    if (band === null) continue;
    items.push(Object.freeze({
      key: `lead:${lead.id}`,
      source: "leads",
      band,
      title: lead.nextAction ?? "Назначить следующее действие",
      who: { name: lead.name, href: queueHref("/v3/profile", { id: lead.id }) },
      reason: band === "overdue" ? "действие просрочено"
        : band === "today" ? "действие на сегодня"
        : band === "no_step" ? lead.nextAction ? "срок не назначен" : "действие не назначено"
        : "следующее действие",
      due: dueOn ? { dueOn, dueAt: null } : null,
      since: null,
      waitingDays: null,
      openHref: queueHref("/v3/pipeline", { lead: lead.id }),
      task: null,
    }));
  }
  return Object.freeze(items);
}

/**
 * Заявки без ответственного — чтение доски продаж `assignment=unassigned`:
 * у RPC «Заявок» поля ответственного нет. Только рабочие этапы. Сколько
 * ждёт — только у новой заявки: дни на этапе «Новый» и есть дни с прихода.
 * У лида дальше по воронке дни этапа — не время без ответственного, поэтому
 * слова срока у него нет.
 */
export function todayRequestItems(leads: readonly PipelineLead[]): readonly TodayItem[] {
  const items: TodayItem[] = [];
  for (const lead of leads) {
    if (lead.stageKey === "handed_off" || lead.workflow.currentOwnerMembershipId !== null) continue;
    const from = sourceWord(lead.source);
    items.push(Object.freeze({
      key: `lead:${lead.id}`,
      source: "requests",
      band: "waiting",
      title: lead.stageKey === "new" ? "Новая заявка" : "Лид без ответственного",
      who: { name: lead.name, href: queueHref("/v3/profile", { id: lead.id }) },
      reason: from ? `нет ответственного · ${from}` : "нет ответственного",
      due: null,
      since: null,
      waitingDays: lead.stageKey === "new" ? lead.stageAgeDays : null,
      openHref: queueHref("/v3/pipeline", { lead: lead.id }),
      task: null,
    }));
  }
  return Object.freeze(items);
}

/**
 * Переписки «Нужен ответ» — то же определение, что у вкладки «Сообщений»:
 * состояние треда из чтения, без своих догадок по автору последнего
 * сообщения.
 */
export function todayChatItems(rows: readonly CaseChatThreadRow[]): readonly TodayItem[] {
  return Object.freeze(rows.filter((row) => row.awaitState === "needs_reply").map((row) => Object.freeze({
    key: `chat:${row.studentCaseId}`,
    source: "chats" as const,
    band: "waiting" as const,
    title: "Ответить в переписке",
    who: { name: row.studentDisplayName, href: studentHref(row.studentCaseId) },
    reason: "нужен ответ",
    due: null,
    since: row.lastMessageAt,
    waitingDays: null,
    openHref: queueHref("/v3/messages", { case: row.studentCaseId, queue: "needs_reply" }),
    task: null,
  })));
}

// --- Очередь -------------------------------------------------------------

function dueSortTime(item: TodayItem): number {
  return item.due ? platformTaskDeadlineSortTime(item.due.dueOn, item.due.dueAt) : Number.POSITIVE_INFINITY;
}

/**
 * С какого момента ждёт: момент последнего сообщения или начало дня Бишкека,
 * с которого заявка на этапе «Новый». Неизвестно — в конце.
 */
function waitSortTime(item: TodayItem, today: string): number {
  if (item.since) {
    const time = Date.parse(item.since);
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  }
  if (item.waitingDays !== null) return platformTaskDeadlineSortTime(shiftDay(today, -item.waitingDays), null);
  return Number.POSITIVE_INFINITY;
}

/**
 * Внутри группы: по сроку, у ждущих — дольше всех ждущие первыми; без
 * момента — в конце. Затем по источнику и названию.
 */
function compareItems(left: TodayItem, right: TodayItem, today: string): number {
  const [a, b] = left.band === "waiting" ? [waitSortTime(left, today), waitSortTime(right, today)] : [dueSortTime(left), dueSortTime(right)];
  if (a !== b) return a < b ? -1 : 1;
  if (left.source !== right.source) return SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source];
  const title = left.title.localeCompare(right.title, "ru");
  if (title !== 0) return title;
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

/**
 * Одно дело из двух чтений (шаг из «Моих» и «ждёт принятия» из «Требуют
 * действия») — одна строка в самой срочной группе, причины через «·».
 */
function mergeItems(items: readonly TodayItem[]): readonly TodayItem[] {
  const byKey = new Map<string, TodayItem>();
  for (const item of items) {
    const current = byKey.get(item.key);
    if (!current) {
      byKey.set(item.key, item);
      continue;
    }
    const [kept, other] = BAND_ORDER[item.band] < BAND_ORDER[current.band] ? [item, current] : [current, item];
    const reasons = [...new Set([...kept.reason.split(" · "), ...other.reason.split(" · ")])];
    byKey.set(item.key, Object.freeze({ ...kept, reason: reasons.join(" · ") }));
  }
  return [...byKey.values()];
}

export function todayBandLabel(band: TodayBand, today: string): string {
  switch (band) {
    case "overdue": return dueBandLabel("overdue", today);
    case "today": return dueBandLabel("today", today);
    case "waiting": return "Ждут ответа";
    case "no_step": return "Без следующего шага";
    case "upcoming": return `Ближайшие ${TODAY_HORIZON_DAYS} дней`;
  }
}

function noticeFor(read: TodaySourceRead): TodayNotice | null {
  const copy = SOURCE_COPY[read.source];
  if (read.state === "error") return { source: read.source, kind: "error", text: copy.error, link: { label: "Повторить", href: TODAY_PATH } };
  if (read.state === "partial") return { source: read.source, kind: "partial", text: copy.partial, link: copy.all };
  if (read.state === "denied") return { source: read.source, kind: "denied", text: copy.denied, link: null };
  // Лиды и заявки — одно чтение доски: при просмотре роли о них одна строка.
  if (read.state === "preview") return read.source === "requests" ? null : { source: read.source, kind: "preview", text: copy.preview, link: null };
  return null;
}

/**
 * Слияние чтений в одну очередь. `reads` — только источники этой роли; у
 * источника, который к роли не относится, записи нет. Отказ сервера
 * (`denied`) и просмотр роли (`preview`) числа не гасят: этих записей роль
 * и не видит.
 */
export function buildTodayQueue(reads: readonly TodaySourceRead[], now: Date): TodayQueue {
  const today = dayInOrganizationTimezone(now);
  const sources = new Set(reads.map((read) => read.source));
  if (sources.size !== reads.length) throw new Error("Today queue received a source twice.");
  const items = mergeItems(reads.flatMap((read) => read.state === "complete" || read.state === "partial" ? read.items : []));
  const blocking = reads.filter((read) => read.state === "error" || read.state === "partial");
  const bands: TodayBandView[] = [];
  for (const band of TODAY_BANDS) {
    const rows = items.filter((item) => item.band === band).sort((left, right) => compareItems(left, right, today));
    if (rows.length === 0) continue;
    const known = !blocking.some((read) => TODAY_SOURCE_BANDS[read.source].includes(band));
    // Число, которое чтение даёт завышенным, не показывается и при полном чтении.
    const uncounted = [...new Set(rows.map((item) => TODAY_UNCOUNTED[item.source]).filter((note): note is string => Boolean(note)))];
    bands.push(Object.freeze({
      band,
      label: todayBandLabel(band, today),
      count: known && uncounted.length === 0 ? rows.length : null,
      danger: band === "overdue",
      // Неполное чтение уже названо над очередью; своя строка — только у полной группы без числа.
      note: known && uncounted.length ? uncounted.join(" ") : null,
      items: Object.freeze(rows),
    }));
  }
  const upcomingDays = items
    .filter((item) => item.band === "upcoming" && item.due)
    .map((item) => projectPlatformTaskDeadline(item.due!.dueOn, item.due!.dueAt, now).day)
    .filter((day): day is string => day !== null && day > today)
    .sort();
  const nearestDay = upcomingDays[0] ?? null;
  return Object.freeze({
    today,
    bands: Object.freeze(bands),
    notices: Object.freeze(reads.map(noticeFor).filter((notice): notice is TodayNotice => notice !== null)),
    applicable: reads.some((read) => read.state !== "denied" && read.state !== "preview"),
    complete: blocking.length === 0,
    actionEmpty: !items.some((item) => item.band !== "upcoming"),
    nearest: nearestDay ? {
      day: nearestDay,
      weekday: queueDayWithWeekday(nearestDay, today).split(" ")[0],
      date: formatQueueDay(nearestDay, today),
    } : null,
  });
}

// --- Слова строки и шапки ------------------------------------------------

export type TodayWhen = Readonly<{
  /** Значение для `<time dateTime>`; null — даты нет, только слово. */
  dateTime: string | null;
  /** «25.09» или «25.09 14:00» — по Бишкеку; null — даты нет, только слово. */
  text: string | null;
  /** «прошёл», «сегодня», «через 3 дн», «вчера», «2 дн назад», «ждёт 3 дн»; null — без слова. */
  word: string | null;
  overdue: boolean;
}>;

/**
 * Когда: срок строки (то же слово, что у «Задач»), у ждущей переписки —
 * день последнего сообщения и сколько дней прошло, у новой заявки — только
 * слово «ждёт N дн» («сегодня» — пришла сегодня): даты чтение не даёт.
 */
export function todayWhen(item: Pick<TodayItem, "due" | "since"> & Partial<Pick<TodayItem, "waitingDays">>, now: Date): TodayWhen | null {
  if (item.due) {
    const due = queueDue(item.due, now, true);
    return due ? Object.freeze({ dateTime: due.dateTime, text: due.text, word: due.word, overdue: due.overdue }) : null;
  }
  if (item.since) {
    const moment = new Date(item.since);
    if (!Number.isFinite(moment.getTime())) return null;
    const today = dayInOrganizationTimezone(now);
    const day = dayInOrganizationTimezone(moment);
    const ago = dayDelta(day, today);
    return Object.freeze({
      dateTime: item.since,
      text: formatQueueDay(day, today),
      word: ago <= 0 ? "сегодня" : ago === 1 ? "вчера" : `${ago} дн назад`,
      overdue: false,
    });
  }
  const days = item.waitingDays ?? null;
  if (days !== null && Number.isSafeInteger(days) && days >= 0) {
    return Object.freeze({ dateTime: null, text: null, word: days === 0 ? "сегодня" : `ждёт ${days} дн`, overdue: false });
  }
  return null;
}

const DATE_LABEL = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** «Суббота, 26 сентября» — день Бишкека под заголовком «Сегодня». */
export function todayDateLabel(day: string): string {
  const text = DATE_LABEL.format(new Date(`${day}T12:00:00Z`));
  return text.charAt(0).toLocaleUpperCase("ru") + text.slice(1);
}
