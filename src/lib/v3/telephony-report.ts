/**
 * «Телефония Beeline KG», срез T10 (docs/EVO_TELEPHONY_PLAN_2026-10-16.md §10, §11, §12;
 * миграция 301): чистый контракт блока «Звонки» в «Отчёте продаж» — без React и без сервера.
 * Его читают серверное чтение, компонент блока и Node-тесты.
 *
 * Что показывать и кому, решает база: `platform.telephony_report_v1(организация, с, по)`
 * отдаёт строки только при включённом `ui_enabled` и праве `telephony.report.read.all`
 * (вся команда) или `…read.own` (одна строка сотрудника), номер клиента — только маской,
 * а счётчики — целыми числами. Сюда приходит ответ базы как есть: любое расхождение формы
 * или арифметики (отвеченных больше, чем звонков; доли не складываются в целое) —
 * `TelephonyReportShapeError`, а экран говорит «не удалось загрузить» вместо того, чтобы
 * нарисовать число наугад («нет чтения — нет числа», как в Э2).
 */

export class TelephonyReportShapeError extends Error {
  constructor() {
    super("Telephony report has an unexpected shape.");
    this.name = "TelephonyReportShapeError";
  }
}

/** Сколько пропущенных без перезвона база кладёт в список (`missedMore` — есть ли ещё). */
export const REPORT_MISSED_LIST_LIMIT = 50;
/** Самый длинный период, который считает база (366 суток включительно, как «Динамика по дням»). */
export const REPORT_MAX_SPAN_DAYS = 366;

export const REPORT_SCOPES = ["all", "own"] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];

export type ReportDirections = Readonly<{ in: number; out: number }>;
export type ReportFirstCall = Readonly<{
  /** Новые лиды периода (кроме прямых студентов и лидов, созданных самим входящим звонком). */
  leads: number;
  /** Лиды, до которых дошёл первый звонок: исходящий набор или принятый входящий. */
  called: number;
  /** Лиды, с которыми разговор состоялся (отвеченный звонок любого направления). */
  reached: number;
  /** Первый звонок уложился в срок, рабочее время. */
  inTime: number;
  /** Опоздали: первый звонок позже срока или лида не звонили, а срок уже вышел. */
  late: number;
  /** Звонка нет, но срок ещё не вышел. */
  pending: number;
  /** Медиана рабочих секунд от создания лида до первого звонка; null — звонков нет. */
  medianCallSeconds: number | null;
  /** Медиана рабочих секунд от создания лида до первого отвеченного звонка; null — отвеченных нет. */
  medianReachSeconds: number | null;
}>;
export type ReportMissed = Readonly<{
  /** Входящие пропущенные с номером, не отвеченные цепочкой связанных звонков. */
  total: number;
  /** Перезвонили в срок. */
  inTime: number;
  /** Перезвонили, но позже срока. */
  late: number;
  /** Срок перезвона ещё не вышел. */
  pending: number;
  /** Срок вышел, отвеченного перезвона нет. */
  without: number;
}>;
export type ReportMetrics = Readonly<{
  calls: ReportDirections;
  answered: ReportDirections;
  /** Секунды разговора из сверки и число отвеченных звонков, у которых время уже известно. */
  talk: Readonly<{ seconds: number; calls: number }>;
  /** Отвеченные звонки с клиентом не из первичного импорта (у них есть кнопка результата) и с проставленным результатом. */
  result: Readonly<{ eligible: number; set: number }>;
  firstCall: ReportFirstCall;
  missed: ReportMissed;
}>;
export type ReportManagerRow = ReportMetrics & Readonly<{ membershipId: string; name: string }>;
export type ReportUnassigned = Readonly<{ firstCall: ReportFirstCall; missed: ReportMissed }>;
export type ReportMissedItem = Readonly<{
  callId: string;
  startedAt: string;
  /** Только маска («+996 ••• 12 46 64»). */
  phone: string;
  leadId: string | null;
  ownerName: string | null;
}>;

export type TelephonyReport = Readonly<{
  scope: ReportScope;
  from: string;
  to: string;
  /** Срок первого звонка и перезвона в рабочих минутах (настройка организации). */
  slaMinutes: number;
  team: ReportMetrics | null;
  managers: readonly ReportManagerRow[];
  unassigned: ReportUnassigned | null;
  missedList: readonly ReportMissedItem[];
  missedMore: boolean;
}>;

/**
 * Что знает страница об отчёте по звонкам: `off` — телефония в интерфейсе выключена, нет права или
 * просмотр роли (блок не рисуется вовсе), `ready` — отчёт, `unavailable` — чтение не удалось
 * (блок честно это говорит и не угадывает).
 */
export type TelephonyReportState =
  | Readonly<{ status: "off" }>
  | Readonly<{ status: "ready"; report: TelephonyReport }>
  | Readonly<{ status: "unavailable" }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
/** Маска базы: «+996 ••• 12 46 64» — код страны, три точки, не больше шести цифр парами справа. */
const MASKED_PHONE = /^\+\d{1,3} ••• \d{1,2}(?: \d{2}){0,2}$/u;
const CONTROL = /[\u0000-\u001F\u007F]/u;
const MAX_COUNT = 10_000_000;
const MAX_SECONDS = 4_000_000_000;

const READ_KEYS = ["scope", "from", "to", "slaMinutes", "team", "managers", "unassigned", "missedList", "missedMore"] as const;
const METRIC_KEYS = ["calls", "answered", "talk", "result", "firstCall", "missed"] as const;
const ROW_KEYS = ["membershipId", "name", ...METRIC_KEYS] as const;
const FIRST_KEYS = ["leads", "called", "reached", "inTime", "late", "pending", "medianCallSeconds", "medianReachSeconds"] as const;
const MISSED_KEYS = ["total", "inTime", "late", "pending", "without"] as const;
const UNASSIGNED_KEYS = ["firstCall", "missed"] as const;
const ITEM_KEYS = ["callId", "startedAt", "phone", "leadId", "ownerName"] as const;
const MAX_ROWS = 500;

function fail(): never {
  throw new TelephonyReportShapeError();
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail();
  const object = value as Record<string, unknown>;
  const present = Object.keys(object);
  if (present.length !== keys.length || present.some((key) => !keys.includes(key))) fail();
  return object;
}

function count(value: unknown, max = MAX_COUNT): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) fail();
  return value;
}

function seconds(value: unknown): number {
  return count(value, MAX_SECONDS);
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200 || CONTROL.test(value)) fail();
  return value;
}

function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function day(value: unknown): string {
  if (typeof value !== "string" || !DAY.test(value)) fail();
  const [year, month, date] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) fail();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) fail();
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) fail();
  return value.toLowerCase();
}

function directions(value: unknown): ReportDirections {
  const row = record(value, ["in", "out"]);
  return Object.freeze({ in: count(row.in), out: count(row.out) });
}

function firstCall(value: unknown): ReportFirstCall {
  const row = record(value, FIRST_KEYS);
  const parsed = {
    leads: count(row.leads), called: count(row.called), reached: count(row.reached),
    inTime: count(row.inTime), late: count(row.late), pending: count(row.pending),
    medianCallSeconds: nullable(row.medianCallSeconds, seconds),
    medianReachSeconds: nullable(row.medianReachSeconds, seconds),
  };
  // Каждый новый лид — ровно одно: уложились, опоздали или ещё в сроке. Звонивших не больше, чем лидов, а дозвонившихся
  // (отвеченный звонок — тоже первый звонок) не больше, чем звонивших; медиана есть тогда и только тогда, когда есть из чего её считать.
  if (parsed.inTime + parsed.late + parsed.pending !== parsed.leads) fail();
  if (parsed.called > parsed.leads || parsed.reached > parsed.called) fail();
  if (parsed.inTime > parsed.called) fail();
  if ((parsed.medianCallSeconds === null) !== (parsed.called === 0)) fail();
  if ((parsed.medianReachSeconds === null) !== (parsed.reached === 0)) fail();
  return Object.freeze(parsed);
}

function missed(value: unknown): ReportMissed {
  const row = record(value, MISSED_KEYS);
  const parsed = {
    total: count(row.total), inTime: count(row.inTime), late: count(row.late),
    pending: count(row.pending), without: count(row.without),
  };
  if (parsed.inTime + parsed.late + parsed.pending + parsed.without !== parsed.total) fail();
  return Object.freeze(parsed);
}

function metrics(row: Record<string, unknown>): ReportMetrics {
  const calls = directions(row.calls);
  const answered = directions(row.answered);
  const talkRow = record(row.talk, ["seconds", "calls"]);
  const resultRow = record(row.result, ["eligible", "set"]);
  const talk = Object.freeze({ seconds: seconds(talkRow.seconds), calls: count(talkRow.calls) });
  const result = Object.freeze({ eligible: count(resultRow.eligible), set: count(resultRow.set) });
  // Отвеченных не больше звонков; время известно не у большего числа звонков, чем отвечено;
  // кнопка результата есть не у большего числа звонков, чем отвечено; нажато не больше, чем есть кнопок.
  if (answered.in > calls.in || answered.out > calls.out) fail();
  const answeredAll = answered.in + answered.out;
  if (talk.calls > answeredAll || result.eligible > answeredAll || result.set > result.eligible) fail();
  return Object.freeze({ calls, answered, talk, result, firstCall: firstCall(row.firstCall), missed: missed(row.missed) });
}

function managerRow(value: unknown): ReportManagerRow {
  const row = record(value, ROW_KEYS);
  return Object.freeze({ membershipId: uuid(row.membershipId), name: text(row.name), ...metrics(row) });
}

function item(value: unknown): ReportMissedItem {
  const row = record(value, ITEM_KEYS);
  return Object.freeze({
    callId: uuid(row.callId),
    startedAt: timestamp(row.startedAt),
    // Строка, не похожая на маску, — признак утечки номера: чужая форма, а не «показать как есть».
    phone: (() => {
      if (typeof row.phone !== "string" || !MASKED_PHONE.test(row.phone)) fail();
      return row.phone;
    })(),
    leadId: nullable(row.leadId, uuid),
    ownerName: nullable(row.ownerName, text),
  });
}

/**
 * Ответ `telephony_report_v1`: `{ "enabled": false }` — null (выключено); отчёт — строго проверенный и
 * замороженный; любое другое — `TelephonyReportShapeError`. `expected` — период, который просили: база
 * обязана вернуть именно его.
 */
export function normalizeTelephonyReport(
  value: unknown,
  expected: Readonly<{ from: string; to: string }>,
): TelephonyReport | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 1
      && (value as Record<string, unknown>).enabled === false) return null;
  const read = record(value, ["enabled", ...READ_KEYS]);
  if (read.enabled !== true) fail();
  const scope = (() => {
    if (typeof read.scope !== "string" || !(REPORT_SCOPES as readonly string[]).includes(read.scope)) fail();
    return read.scope as ReportScope;
  })();
  const from = day(read.from);
  const to = day(read.to);
  if (from !== expected.from || to !== expected.to || to < from) fail();
  const slaMinutes = count(read.slaMinutes, 480);
  if (slaMinutes < 1) fail();
  if (typeof read.missedMore !== "boolean" || !Array.isArray(read.managers) || !Array.isArray(read.missedList)) fail();
  if (read.managers.length > MAX_ROWS || read.missedList.length > REPORT_MISSED_LIST_LIMIT) fail();

  const managers = read.managers.map(managerRow);
  if (new Set(managers.map((row) => row.membershipId)).size !== managers.length) fail();
  const list = read.missedList.map(item);
  if (new Set(list.map((entry) => entry.callId)).size !== list.length) fail();

  let team: ReportMetrics | null = null;
  let unassigned: ReportUnassigned | null = null;
  if (scope === "all") {
    const teamRow = record(read.team, METRIC_KEYS);
    team = metrics(teamRow);
    const spare = record(read.unassigned, UNASSIGNED_KEYS);
    unassigned = Object.freeze({ firstCall: firstCall(spare.firstCall), missed: missed(spare.missed) });
  } else {
    // «Свои»: ровно одна строка, ни команды, ни строки без ответственного.
    if (read.team !== null || read.unassigned !== null || managers.length !== 1) fail();
  }
  // Список — это «без перезвона» тех, чьи цифры в ответе: столько, сколько их есть, но не больше предела.
  const without = scope === "all" ? team!.missed.without : managers[0].missed.without;
  if (list.length !== Math.min(REPORT_MISSED_LIST_LIMIT, without) || read.missedMore !== (without > REPORT_MISSED_LIST_LIMIT)) fail();

  return Object.freeze({
    scope, from, to, slaMinutes, team, unassigned,
    managers: Object.freeze(managers), missedList: Object.freeze(list), missedMore: read.missedMore,
  });
}

/** Ответ базы → состояние страницы: выключено, готово, чужая форма — недоступно. */
export function telephonyReportState(
  value: unknown,
  expected: Readonly<{ from: string; to: string }>,
): TelephonyReportState {
  try {
    const report = normalizeTelephonyReport(value, expected);
    return report === null ? Object.freeze({ status: "off" }) : Object.freeze({ status: "ready", report });
  } catch {
    return Object.freeze({ status: "unavailable" });
  }
}

// --- Слова ------------------------------------------------------------------

const NB = " ";

/** Целый процент «75 %» или null, если делить не на что (знаменатель 0). Неразрывный пробел перед знаком. */
export function reportPercent(part: number, whole: number): string | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return `${Math.round((part * 100) / whole)}${NB}%`;
}

/**
 * Время разговора или ожидания словами: «45 с», «2 мин 05 с», «2 мин», «1 ч 05 мин». Между числом и
 * единицей — неразрывный пробел: на узком экране «2 мин 05 с» не рвётся посреди.
 */
export function reportDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  if (total < 60) return `${total}${NB}с`;
  if (total < 3600) {
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0 ? `${minutes}${NB}мин` : `${minutes}${NB}мин ${String(rest).padStart(2, "0")}${NB}с`;
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return minutes === 0 ? `${hours}${NB}ч` : `${hours}${NB}ч ${String(minutes).padStart(2, "0")}${NB}мин`;
}

const MOMENT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek", hourCycle: "h23",
});

/** «17.10, 16:00» — время Бишкека. */
export function reportMoment(value: string): string {
  return MOMENT.format(new Date(value)).replace(/\s/gu, " ");
}

/** Склонение: 1 звонок, 2 звонка, 5 звонков. */
export function reportPlural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  const ones = n % 10;
  return tens >= 11 && tens <= 14 ? many : ones === 1 ? one : ones >= 2 && ones <= 4 ? few : many;
}

export type ReportCell = Readonly<{
  /** Подпись ячейки («Звонки»). */
  label: string;
  /** Главное число или слово («ждём», «нет звонков»), когда числа нет. */
  figure: string;
  /** Нет числа: `figure` — слово, и рисуется оно спокойным обычным шрифтом, а не крупной цифрой. */
  quiet: boolean;
  /** Пояснения мелкими строками; пусто — нет. */
  notes: readonly string[];
  /** Что считает ячейка, одной фразой (подсказка при наведении). */
  hint: string;
}>;

/** Слова ячейки «Звонки»: всего и разбивка по направлению. */
export function callsCell(metrics: Pick<ReportMetrics, "calls">): ReportCell {
  const total = metrics.calls.in + metrics.calls.out;
  return {
    label: "Звонки",
    figure: total.toLocaleString("ru-RU"),
    quiet: false,
    notes: total === 0 ? [] : [`${metrics.calls.in.toLocaleString("ru-RU")} входящих · ${metrics.calls.out.toLocaleString("ru-RU")} исходящих`],
    hint: "Все звонки сотрудника за период: входящие и исходящие.",
  };
}

/** Слова ячейки «Отвечено»: доля и «N из M» по направлениям. */
export function answeredCell(metrics: Pick<ReportMetrics, "calls" | "answered">): ReportCell {
  const total = metrics.calls.in + metrics.calls.out;
  const done = metrics.answered.in + metrics.answered.out;
  const notes: string[] = [];
  if (metrics.calls.in > 0) notes.push(`входящие ${metrics.answered.in} из ${metrics.calls.in}`);
  if (metrics.calls.out > 0) notes.push(`исходящие ${metrics.answered.out} из ${metrics.calls.out}`);
  const percent = reportPercent(done, total);
  return {
    label: "Отвечено",
    figure: percent ?? "нет звонков",
    quiet: percent === null,
    notes,
    hint: "Доля звонков, на которые ответили или дозвонились.",
  };
}

/** Слова ячейки «Время разговора»: сумма и среднее; пока сверка не принесла времени — словами, а не нулём. */
export function talkCell(metrics: Pick<ReportMetrics, "answered" | "talk">): ReportCell {
  const done = metrics.answered.in + metrics.answered.out;
  const notes: string[] = [];
  if (metrics.talk.calls > 0) notes.push(`в среднем ${reportDuration(Math.round(metrics.talk.seconds / metrics.talk.calls))}`);
  const unknown = done - metrics.talk.calls;
  if (unknown > 0) notes.push(`время ещё не пришло: ${unknown.toLocaleString("ru-RU")} ${reportPlural(unknown, "звонок", "звонка", "звонков")}`);
  const known = metrics.talk.calls > 0;
  return {
    label: "Время разговора",
    figure: known ? reportDuration(metrics.talk.seconds) : done > 0 ? "уточняется" : "нет разговоров",
    quiet: !known,
    notes,
    hint: "Сумма времени разговоров. Время приходит из сверки с ВАТС, поэтому у свежих звонков его ещё нет.",
  };
}

/** Слова ячейки «До первого звонка»: медиана рабочего времени и сколько новых лидов уложились в срок. */
export function firstCallCell(first: ReportFirstCall, slaMinutes: number): ReportCell {
  const notes: string[] = [];
  const decided = first.inTime + first.late;
  if (first.leads > 0) {
    notes.push(`новых лидов: ${first.leads.toLocaleString("ru-RU")}`);
    if (decided > 0) notes.push(`в срок ${slaMinutes}${NB}мин: ${first.inTime} из ${decided}`);
    if (first.pending > 0) notes.push(`срок ещё не вышел: ${first.pending}`);
    if (first.medianReachSeconds !== null) notes.push(`до разговора ${reportDuration(first.medianReachSeconds)}`);
  }
  const figure = first.medianCallSeconds !== null ? reportDuration(first.medianCallSeconds)
    : first.leads === 0 ? "нет новых лидов"
      : first.pending > 0 && first.pending === first.leads ? "ждём"
        : "не звонили";
  return {
    label: "До первого звонка",
    figure,
    quiet: first.medianCallSeconds === null,
    notes,
    hint: `Медиана рабочего времени от создания лида до первого звонка. Срок — ${slaMinutes} мин рабочего времени; «ждём» — срок у лидов ещё не вышел.`,
  };
}

/**
 * Слова ячейки «Пропущенные без перезвона»: число и из скольких пропущенных оно получилось. Ноль без
 * пояснения рядом с «пропущено входящих: 5» читался как противоречие: «из 5 пропущенных» говорит, что
 * остальные перезвонили или ещё ждут.
 */
export function missedCell(missedBlock: ReportMissed): ReportCell {
  const notes: string[] = [];
  if (missedBlock.total > 0) {
    notes.push(`из ${missedBlock.total.toLocaleString("ru-RU")} пропущенных входящих`);
    if (missedBlock.inTime > 0) notes.push(`перезвонили в срок: ${missedBlock.inTime}`);
    if (missedBlock.late > 0) notes.push(`перезвонили позже срока: ${missedBlock.late}`);
    if (missedBlock.pending > 0) notes.push(`срок ещё не вышел: ${missedBlock.pending}`);
  }
  return {
    label: "Пропущенные без перезвона",
    figure: missedBlock.without.toLocaleString("ru-RU"),
    quiet: false,
    notes,
    hint: "Входящие без ответа, на которые до конца срока никто не перезвонил по этому номеру.",
  };
}

/** Слова ячейки «Результат проставлен»: доля отвеченных звонков, у которых нажат результат. */
export function resultCell(result: ReportMetrics["result"]): ReportCell {
  const percent = reportPercent(result.set, result.eligible);
  return {
    label: "Результат проставлен",
    figure: percent ?? "нет отвеченных",
    quiet: percent === null,
    notes: result.eligible > 0 ? [`${result.set} из ${result.eligible} отвеченных`] : [],
    hint: "Доля отвеченных звонков, у которых сотрудник отметил итог.",
  };
}

/** Шесть ячеек строки менеджера или команды, в порядке отчёта. */
export function reportCells(metrics: ReportMetrics, slaMinutes: number): readonly ReportCell[] {
  return [
    callsCell(metrics),
    answeredCell(metrics),
    talkCell(metrics),
    firstCallCell(metrics.firstCall, slaMinutes),
    missedCell(metrics.missed),
    resultCell(metrics.result),
  ];
}

/** Ячейки, которые телефон показывает сразу (индексы `reportCells`): «Звонки», «Отвечено», «Пропущенные без перезвона». Остальные — за «Все показатели». */
export const REPORT_PHONE_CELLS = [0, 1, 4] as const;

/** Две ячейки строки «Без ответственного»: у неё нет звонков сотрудника, только лиды и пропущенные. */
export function unassignedCells(row: ReportUnassigned, slaMinutes: number): readonly ReportCell[] {
  return [firstCallCell(row.firstCall, slaMinutes), missedCell(row.missed)];
}

/** Сотрудник без единого звонка, нового лида и пропущенного за период: его строка из нулей сворачивается в «Без звонков: …». */
export function reportRowIsIdle(row: ReportMetrics): boolean {
  return row.calls.in + row.calls.out === 0 && row.firstCall.leads === 0 && row.missed.total === 0;
}

/**
 * Итог блока одной строкой для свёрнутого заголовка: «16 звонков · отвечено 63 % · без перезвона: 0». Команда
 * у руководителя, свои цифры у менеджера. Нечего сказать — «звонков за период нет».
 */
export function reportSummary(report: TelephonyReport): string {
  const row = report.team ?? report.managers[0] ?? null;
  if (row === null) return "звонков за период нет";
  const total = row.calls.in + row.calls.out;
  if (total === 0 && row.missed.total === 0) return "звонков за период нет";
  const parts = [`${total.toLocaleString("ru-RU")} ${reportPlural(total, "звонок", "звонка", "звонков")}`];
  const percent = reportPercent(row.answered.in + row.answered.out, total);
  if (percent !== null) parts.push(`отвечено ${percent}`);
  parts.push(`без перезвона: ${row.missed.without.toLocaleString("ru-RU")}`);
  return parts.join(" · ");
}

/** Отчёт по звонкам без единого звонка, лида и пропущенного за период: честная пустота вместо таблицы нулей. */
export function reportIsEmpty(report: TelephonyReport): boolean {
  const empty = (metrics: ReportMetrics) =>
    metrics.calls.in + metrics.calls.out === 0 && metrics.firstCall.leads === 0 && metrics.missed.total === 0;
  if (report.team !== null) return empty(report.team);
  return report.managers.every(empty);
}
