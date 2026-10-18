/**
 * «Телефония Beeline KG», срез T5 (docs/EVO_TELEPHONY_PLAN_2026-10-16.md §9.4, §12;
 * миграция 295): чистый контракт строк звонков в «Ленте» лида и результата звонка
 * одним нажатием — без React и без сервера. Его читают серверная страница,
 * маршрут результата, лента и Node-тесты.
 *
 * Что показывать и что можно нажать, решает база: `platform.telephony_lead_calls_v1`
 * отдаёт строки только при `ui_enabled`, номер клиента — только маской
 * («+996 ••• 12 46 64»), ссылку на запись не отдаёт вовсе (плеер — срез T6), а
 * `resultEditable` — уже сложенное право (`telephony.call.dial`, `dial_enabled`,
 * «свои»/«все», окно времени). Чужая форма ответа — ошибка
 * (`TelephonyShapeError`), а не пустая лента.
 */

/** Сколько звонков лида читает одна страница ленты (в базе — до 100). */
export const LEAD_CALLS_LIMIT = 50;

export class TelephonyShapeError extends Error {
  constructor() {
    super("Telephony lead calls have an unexpected shape.");
    this.name = "TelephonyShapeError";
  }
}

export const LEAD_CALL_DIRECTIONS = ["in", "out"] as const;
export const LEAD_CALL_STATES = ["ringing", "answered", "ended"] as const;
export const LEAD_CALL_OUTCOMES = [
  "answered", "missed", "cancelled", "busy", "unavailable", "not_found", "not_allowed", "no_answer_unknown",
] as const;
export const LEAD_CALL_OUTCOME_SOURCES = ["webhook", "pull"] as const;
export const LEAD_CALL_RECORDINGS = ["none", "available", "unavailable", "expired"] as const;
export const LEAD_CALL_LEG_STATES = ["ringing", "accepted", "completed", "cancelled", "transferred", "missed"] as const;
/** Три нажатия сотрудника; «Недозвон» (`no_answer`) ставит система. */
export const LEAD_CALL_PRESSES = ["reached", "callback", "not_interested"] as const;
export const LEAD_CALL_RESULT_CODES = [...LEAD_CALL_PRESSES, "no_answer"] as const;

export type LeadCallDirection = (typeof LEAD_CALL_DIRECTIONS)[number];
export type LeadCallState = (typeof LEAD_CALL_STATES)[number];
export type LeadCallOutcome = (typeof LEAD_CALL_OUTCOMES)[number];
export type LeadCallOutcomeSource = (typeof LEAD_CALL_OUTCOME_SOURCES)[number];
export type LeadCallRecording = (typeof LEAD_CALL_RECORDINGS)[number];
export type LeadCallLegState = (typeof LEAD_CALL_LEG_STATES)[number];
export type LeadCallPress = (typeof LEAD_CALL_PRESSES)[number];
export type LeadCallResultCode = (typeof LEAD_CALL_RESULT_CODES)[number];

export type LeadCallParticipant = Readonly<{ name: string; state: LeadCallLegState }>;

export type LeadCall = Readonly<{
  callId: string;
  direction: LeadCallDirection;
  state: LeadCallState;
  outcome: LeadCallOutcome | null;
  outcomeSource: LeadCallOutcomeSource | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  /** Время разговора приходит только из сверки: до неё null, в интерфейсе «—». */
  talkSeconds: number | null;
  /** Только маска («+996 ••• 12 46 64»); полного номера здесь нет и быть не может. */
  phone: string | null;
  managerName: string | null;
  participants: readonly LeadCallParticipant[];
  recording: LeadCallRecording;
  resultCode: LeadCallResultCode | null;
  resultAt: string | null;
  resultByName: string | null;
  /** День `YYYY-MM-DD`, выбранный у «Перезвонить»; есть тогда и только тогда, когда resultCode = callback. */
  callbackOn: string | null;
  /** Результат можно поставить или изменить сейчас (решила база). */
  resultEditable: boolean;
}>;

export type LeadCallsRead = Readonly<{
  enabled: boolean;
  canSetResult: boolean;
  hasMore: boolean;
  calls: readonly LeadCall[];
}>;

/**
 * Что знает страница о звонках лида: `off` — телефония в интерфейсе выключена
 * (ничего не рисуется), `ready` — строки и признаки, `unavailable` — чтение не
 * удалось (лента честно это говорит и не угадывает).
 */
export type LeadCallsState =
  | Readonly<{ status: "off" }>
  | Readonly<{
      status: "ready";
      canSetResult: boolean;
      hasMore: boolean;
      calls: readonly LeadCall[];
      /**
       * Записи звонков (срез T6): ноги с записью и право слушать, по `callId`. Нет поля — записи
       * не читались (лента как в T5, слова о состоянии без плеера); `null` — чтение не удалось
       * (то же); объект — база ответила, и плеер рисуется там, где она разрешила.
       */
      recordings?: LeadRecordings | null;
    }>
  | Readonly<{ status: "unavailable" }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
/** Маска базы: «+996 ••• 12 46 64» — код страны, три точки, не больше шести цифр парами справа. */
const MASKED_PHONE = /^\+\d{1,3} ••• \d{1,2}(?: \d{2}){0,2}$/u;
const CONTROL = /[\u0000-\u001F\u007F]/u;
const ROW_KEYS = [
  "callId", "direction", "state", "outcome", "outcomeSource", "startedAt", "answeredAt", "endedAt", "talkSeconds", "phone",
  "managerName", "participants", "recording", "resultCode", "resultAt", "resultByName", "callbackOn", "resultEditable",
] as const;
const READ_KEYS = ["enabled", "canSetResult", "hasMore", "calls"] as const;
const MAX_CALLS = 100;
const MAX_PARTICIPANTS = 6;

function fail(): never {
  throw new TelephonyShapeError();
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail();
  const object = value as Record<string, unknown>;
  const present = Object.keys(object);
  if (present.length !== keys.length || present.some((key) => !keys.includes(key))) fail();
  return object;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) fail();
  return value as T;
}

function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) fail();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200 || CONTROL.test(value)) fail();
  return value;
}

/** Календарный день `YYYY-MM-DD` в пределах, которые держит база (2020…2200). */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2020 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function calendarDay(value: unknown): string {
  if (!isCalendarDay(value)) fail();
  return value;
}

function participant(value: unknown): LeadCallParticipant {
  const row = record(value, ["name", "state"]);
  return Object.freeze({ name: text(row.name), state: member(row.state, LEAD_CALL_LEG_STATES) });
}

function call(value: unknown): LeadCall {
  const row = record(value, ROW_KEYS);
  if (typeof row.callId !== "string" || !UUID.test(row.callId)) fail();
  if (typeof row.resultEditable !== "boolean") fail();
  if (!Array.isArray(row.participants) || row.participants.length > MAX_PARTICIPANTS) fail();
  const talkSeconds = nullable(row.talkSeconds, (seconds) => {
    if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 0 || seconds > 86_400) fail();
    return seconds;
  });
  const resultCode = nullable(row.resultCode, (code) => member(code, LEAD_CALL_RESULT_CODES));
  const callbackOn = nullable(row.callbackOn, calendarDay);
  // День у «Перезвонить» есть тогда и только тогда, когда результат — «Перезвонить» (замок базы).
  if ((resultCode === "callback") !== (callbackOn !== null)) fail();
  const resultAt = nullable(row.resultAt, timestamp);
  // Результат без времени невозможен, время без результата — тоже.
  if ((resultCode === null) !== (resultAt === null)) fail();
  const outcome = nullable(row.outcome, (code) => member(code, LEAD_CALL_OUTCOMES));
  const outcomeSource = nullable(row.outcomeSource, (source) => member(source, LEAD_CALL_OUTCOME_SOURCES));
  if ((outcome === null) !== (outcomeSource === null)) fail();
  return Object.freeze({
    callId: row.callId.toLowerCase(),
    direction: member(row.direction, LEAD_CALL_DIRECTIONS),
    state: member(row.state, LEAD_CALL_STATES),
    outcome,
    outcomeSource,
    startedAt: timestamp(row.startedAt),
    answeredAt: nullable(row.answeredAt, timestamp),
    endedAt: nullable(row.endedAt, timestamp),
    talkSeconds,
    // Строка, не похожая на маску, — признак утечки: чужая форма, а не «показать как есть».
    phone: nullable(row.phone, (phone) => {
      if (typeof phone !== "string" || !MASKED_PHONE.test(phone)) fail();
      return phone;
    }),
    managerName: nullable(row.managerName, text),
    participants: Object.freeze(row.participants.map(participant)),
    recording: member(row.recording, LEAD_CALL_RECORDINGS),
    resultCode,
    resultAt,
    resultByName: nullable(row.resultByName, text),
    callbackOn,
    resultEditable: row.resultEditable,
  });
}

/** Ответ `telephony_lead_calls_v1`; чужая форма — `TelephonyShapeError`. */
export function normalizeLeadCallsRead(value: unknown): LeadCallsRead {
  const read = record(value, READ_KEYS);
  if (typeof read.enabled !== "boolean" || typeof read.canSetResult !== "boolean" || typeof read.hasMore !== "boolean") fail();
  if (!Array.isArray(read.calls) || read.calls.length > MAX_CALLS) fail();
  const calls = read.calls.map(call);
  // Выключенная телефония ничего не несёт; нажать нечего, если ни одна строка не редактируется.
  if (!read.enabled && (read.canSetResult || read.hasMore || calls.length > 0)) fail();
  if (!read.canSetResult && calls.some((row) => row.resultEditable)) fail();
  return Object.freeze({ enabled: read.enabled, canSetResult: read.canSetResult, hasMore: read.hasMore, calls: Object.freeze(calls) });
}

/** Ответ базы → состояние страницы: выключено, готово, чужая форма — недоступно. */
export function leadCallsState(value: unknown): LeadCallsState {
  try {
    const read = normalizeLeadCallsRead(value);
    return read.enabled
      ? Object.freeze({ status: "ready", canSetResult: read.canSetResult, hasMore: read.hasMore, calls: read.calls })
      : Object.freeze({ status: "off" });
  } catch {
    return Object.freeze({ status: "unavailable" });
  }
}

/**
 * Окно звонков страницы заметок: заметки читаются страницами по 50, и звонки идут
 * в окне своей страницы, а не все сразу, иначе старые звонки встали бы выше
 * старых заметок. Первая страница — от самой старой её заметки и новее; следующие —
 * между своей самой старой заметкой и границей предыдущей страницы. Границы — как
 * пришли из базы (микросекунды не округляются): `since` включительно, `until`
 * исключая.
 */
export function leadCallsWindow(
  notes: Readonly<{ rows: readonly Readonly<{ createdAt: string }>[]; hasNext: boolean }>,
  cursor: Readonly<{ createdAt: string }> | null,
): Readonly<{ since: string | null; until: string | null }> {
  const oldest = notes.rows.length > 0 ? notes.rows[notes.rows.length - 1].createdAt : null;
  return Object.freeze({ since: notes.hasNext ? oldest : null, until: cursor?.createdAt ?? null });
}

// --- Записи звонков (срез T6) -------------------------------------------------

/**
 * Записи звонков лида («Телефония Beeline KG», срез T6; миграция 297,
 * `platform.telephony_lead_recordings_v1`): у каких звонков есть записи, какие у них ноги
 * (идентификатор и состояние) и может ли ЭТОТ сотрудник слушать. Ссылки на запись здесь нет и
 * быть не может: звук идёт только через `GET /api/v3/telephony/recordings/<legId>`, а право
 * слушать повторяют выдача и погашение в базе при каждом обращении.
 */
export const LEAD_RECORDING_LEG_STATES = ["available", "unavailable", "expired"] as const;
export type LeadRecordingLegState = (typeof LEAD_RECORDING_LEG_STATES)[number];
export type LeadRecordingLeg = Readonly<{ legId: string; state: LeadRecordingLegState }>;
export type LeadCallRecordings = Readonly<{ canListen: boolean; legs: readonly LeadRecordingLeg[] }>;
export type LeadRecordings = Readonly<Record<string, LeadCallRecordings>>;

const RECORDINGS_KEYS = ["enabled", "calls"] as const;
const RECORDINGS_CALL_KEYS = ["callId", "canListen", "legs"] as const;
const RECORDINGS_LEG_KEYS = ["legId", "state"] as const;

/**
 * Ответ `telephony_lead_recordings_v1` по запрошенным звонкам: `enabled = false` (флаг
 * выключили между двумя чтениями) — null; чужая форма, чужой звонок, повтор звонка, пустые ноги —
 * `TelephonyShapeError`.
 */
export function normalizeLeadRecordingsRead(value: unknown, requested: readonly string[]): LeadRecordings | null {
  const read = record(value, RECORDINGS_KEYS);
  if (typeof read.enabled !== "boolean" || !Array.isArray(read.calls)) fail();
  if (!read.enabled) {
    if (read.calls.length > 0) fail();
    return null;
  }
  if (read.calls.length > MAX_CALLS) fail();
  const wanted = new Set(requested.map((id) => id.toLowerCase()));
  const calls: Record<string, LeadCallRecordings> = {};
  for (const entry of read.calls) {
    const row = record(entry, RECORDINGS_CALL_KEYS);
    if (typeof row.callId !== "string" || !UUID.test(row.callId) || typeof row.canListen !== "boolean") fail();
    const callId = row.callId.toLowerCase();
    if (!wanted.has(callId) || Object.hasOwn(calls, callId)) fail();
    if (!Array.isArray(row.legs) || row.legs.length < 1 || row.legs.length > MAX_PARTICIPANTS) fail();
    const seen = new Set<string>();
    const legs = row.legs.map((item): LeadRecordingLeg => {
      const leg = record(item, RECORDINGS_LEG_KEYS);
      if (typeof leg.legId !== "string" || !UUID.test(leg.legId)) fail();
      const legId = leg.legId.toLowerCase();
      if (seen.has(legId)) fail();
      seen.add(legId);
      return Object.freeze({ legId, state: member(leg.state, LEAD_RECORDING_LEG_STATES) });
    });
    calls[callId] = Object.freeze({ canListen: row.canListen, legs: Object.freeze(legs) });
  }
  return Object.freeze(calls);
}

/** Ответ базы → записи звонков страницы; чужая форма и выключенный флаг — null (лента без плеера). */
export function leadRecordingsState(value: unknown, requested: readonly string[]): LeadRecordings | null {
  try {
    return normalizeLeadRecordingsRead(value, requested);
  } catch {
    return null;
  }
}

export type CallRecordingItem =
  | Readonly<{ kind: "player"; legId: string; label: string }>
  | Readonly<{ kind: "text"; text: string }>;

/**
 * Записи одного звонка словами: у доступной записи, которую сотрудник вправе слушать, — «Слушать»
 * с контекстом звонка («Слушать · Менеджер Первый, 2 мин 20 с»: кто говорил и сколько); у звонка из нескольких
 * ног с записями — «Слушать запись 1 из 2», «Слушать запись 2 из 2» (какая нога чья, база не говорит,
 * поэтому имени в подписи нет); у доступной, которую он слушать не вправе, — «Запись доступна
 * руководителю»; у «временно недоступной» и «удалённой по сроку» — слова состояния. Ничего не
 * выдумывается: нет записи — нет строки.
 */
export function callRecordingItems(
  recordings: LeadCallRecordings,
  context: Readonly<{ who?: string | null; talk?: string | null }> = {},
): readonly CallRecordingItem[] {
  const many = recordings.legs.length > 1;
  const about = [context.who, context.talk].filter((part): part is string => Boolean(part)).join(", ");
  return recordings.legs.map((leg, index): CallRecordingItem => {
    const name = many ? `Запись ${index + 1}` : "Запись";
    if (leg.state === "available") {
      return recordings.canListen
        ? {
            kind: "player",
            legId: leg.legId,
            label: many ? `Слушать запись ${index + 1} из ${recordings.legs.length}` : about ? `Слушать · ${about}` : "Слушать",
          }
        : { kind: "text", text: `${name} доступна руководителю` };
    }
    return { kind: "text", text: leg.state === "unavailable" ? `${name} временно недоступна` : `${name} удалена по сроку хранения` };
  });
}

// --- Слова ------------------------------------------------------------------

/** «Входящий звонок» / «Исходящий звонок». */
export function callTitle(call: Pick<LeadCall, "direction">): string {
  return call.direction === "in" ? "Входящий звонок" : "Исходящий звонок";
}

/**
 * Исход звонка одной строкой для очереди «Заявки → Звонки»: у входящего «Пропущен», «Без ответа»,
 * «Ответил Менеджер Первый · 1 мин 35 с»; у исходящего — со стороны сотрудника: «Дозвонились · 1 мин 35 с»,
 * «Не ответили», «Занято». Тот же словарь, что у строки ленты (`callOutcomeText`); время разговора —
 * только когда сверка его принесла. Исходящий отвеченный не «ответил менеджер»: менеджер сам звонил.
 */
export function callRequestOutcome(call: LeadCall): string {
  if (call.outcome === "answered") {
    const who = call.direction === "out" ? "Дозвонились" : call.managerName ? `Ответил ${call.managerName}` : "Разговор";
    // «·» с неразрывными пробелами по обе стороны: на узкой строке он не остаётся висеть в конце или в начале строки.
    return call.talkSeconds === null ? who : `${who}\u00A0·\u00A0${callDuration(call.talkSeconds)}`;
  }
  const word = callOutcomeText(call);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/**
 * Время разговора словами: «45 с», «2 мин 05 с», «2 мин», «1 ч 05 мин». Между числом
 * и единицей — неразрывный пробел: на узком экране «2 мин 05 с» не рвётся посреди.
 */
export function callDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const NB = "\u00A0";
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

/**
 * Итог звонка словами. Без итога: ждёт ответа («идёт вызов») или разговор идёт.
 * Исход из сверки (`outcomeSource = pull`) неточный — слова об этом не врут:
 * «без ответа» вместо «пропущен»/«занято».
 */
export function callOutcomeText(call: Pick<LeadCall, "direction" | "state" | "outcome" | "outcomeSource">): string {
  if (call.outcome === null) return call.state === "answered" ? "идёт разговор" : "идёт вызов";
  if (call.outcomeSource === "pull" && call.outcome !== "answered") return "без ответа";
  switch (call.outcome) {
    case "answered": return "разговор";
    case "missed": return call.direction === "in" ? "пропущен" : "не ответили";
    case "cancelled": return "отменён";
    case "busy": return "занято";
    case "unavailable": return "недоступен";
    case "not_found": return "номер не найден";
    case "not_allowed": return "направление закрыто";
    case "no_answer_unknown": return "без ответа";
  }
}

/** Слова, пока сверка не принесла время разговора: не ноль и не длительность вебхука с ожиданием. */
export const CALL_TALK_PENDING = "время уточняется";

/**
 * Время разговора у отвеченного звонка: «2 мин 05 с», а пока сверка его не
 * принесла, — «время уточняется». У неотвеченного — null.
 */
export function callTalkText(call: Pick<LeadCall, "outcome" | "talkSeconds">): string | null {
  if (call.outcome !== "answered") return null;
  return call.talkSeconds === null ? CALL_TALK_PENDING : callDuration(call.talkSeconds);
}

/** Запись — только состояние словами (так лента выглядит, пока записи не прочитаны; плеер — `callRecordingItems`). */
export function callRecordingText(recording: LeadCallRecording): string | null {
  switch (recording) {
    case "available": return "Есть запись";
    case "unavailable": return "Запись временно недоступна";
    case "expired": return "Запись удалена по сроку хранения";
    case "none": return null;
  }
}

/** Кто говорил (ответил) или, если никто, кого вызывали; null — сказать нечего. */
export function callPeopleText(call: Pick<LeadCall, "managerName" | "participants" | "outcome">): string | null {
  if (call.managerName) return call.managerName;
  if (call.outcome === "answered") return null;
  const names = [...new Set(call.participants.map((item) => item.name))];
  return names.length > 0 ? `вызывали: ${names.join(", ")}` : null;
}

/**
 * Три нажатия. «Дозвонился» верно только для звонка, который набрали мы; клиент, позвонивший
 * сам, — «Поговорили». «Перезвонить» без дня — «Перезвонить позже», с днём — «Перезвонить 19.10».
 */
export const CALL_PRESS_WORDS: Readonly<Record<LeadCallPress, string>> = Object.freeze({
  reached: "Дозвонился",
  callback: "Перезвонить позже",
  not_interested: "Не интересно",
});

/** Слова трёх нажатий для звонка этого направления (без направления — как у исходящего). */
export function callPressWords(direction: LeadCallDirection | null = null): Readonly<Record<LeadCallPress, string>> {
  return direction === "in" ? Object.freeze({ ...CALL_PRESS_WORDS, reached: "Поговорили" }) : CALL_PRESS_WORDS;
}

/**
 * Результат словами: «Дозвонился» / «Поговорили», «Перезвонить 18.10», «Не интересно», «Недозвон».
 * День формирует вызывающий (`leadDay` ленты); null — результата нет.
 */
export function callResultText(
  call: Pick<LeadCall, "resultCode" | "callbackOn"> & Partial<Pick<LeadCall, "direction">>,
  formatDay: (day: string) => string,
): string | null {
  const words = callPressWords(call.direction ?? null);
  switch (call.resultCode) {
    case null: return null;
    case "reached": return words.reached;
    case "callback": return call.callbackOn ? `Перезвонить ${formatDay(call.callbackOn)}` : words.callback;
    case "not_interested": return words.not_interested;
    case "no_answer": return "Недозвон";
  }
}

/**
 * «Последний контакт»: отвеченный звонок — контакт; входящий, на который не
 * ответили, — обращение клиента; исходящий без ответа и звонок, который ещё идёт,
 * контактом не считаются. null — звонок не в счёт.
 */
export function callContact(call: Pick<LeadCall, "direction" | "outcome" | "startedAt">): Readonly<{ at: string; what: "звонок" | "пропущенный звонок" }> | null {
  if (call.outcome === "answered") return { at: call.startedAt, what: "звонок" };
  if (call.direction === "in" && call.outcome !== null) return { at: call.startedAt, what: "пропущенный звонок" };
  return null;
}

/** День `YYYY-MM-DD` плюс `n` суток (календарная арифметика, без часовых поясов). */
export function addDaysToDay(day: string, n: number): string {
  if (!isCalendarDay(day)) throw new Error("Telephony calendar received an invalid day.");
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + n)).toISOString().slice(0, 10);
}

/** Границы дня «Перезвонить»: сегодня … сегодня + 365 (те же, что у базы), по умолчанию — завтра. */
export function callbackDayBounds(today: string): Readonly<{ min: string; max: string; fallback: string }> {
  return Object.freeze({ min: today, max: addDaysToDay(today, 365), fallback: addDaysToDay(today, 1) });
}
