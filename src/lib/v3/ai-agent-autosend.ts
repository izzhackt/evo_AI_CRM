/**
 * «ИИ-агент → Автоответчик» P4 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §11,
 * §12.1–12.2, §18 Q5–Q9, Q11; ADR 0031): чистый контракт раздела, журнала,
 * утренней сводки и переключателя «Автоответчик в этом чате» — без React и
 * без сервера. Его читают страница, клиентские формы, маршрут чата и тесты.
 *
 * Что можно и что нельзя, решает база (275–277): включает любой сотрудник
 * (Q9), но только с согласием на Gemini (PT412) и правом отвечать в WhatsApp;
 * первое включение — всегда «Проверка без отправки»; «Отвечает» — после трёх
 * ночей проверки и подтверждённой строки о помощнике; паузу снимает только
 * человек. Здесь — форма данных, слова и проверки ввода до записи.
 */
import { PLATFORM_ORGANIZATION_TIMEZONE } from "../platform-organization-time.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CODE = /^[a-z][a-z0-9_]{0,63}$/u;

export class AiAutosendShapeError extends Error {
  constructor() {
    super("ai_agent_shape_invalid");
    this.name = "AiAutosendShapeError";
  }
}
const invalid = (): never => { throw new AiAutosendShapeError(); };
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const int = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
const text = (value: unknown, limit: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
const iso = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const uuid = (value: unknown): string | null => (typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null);

// ------------------------------------------------------------------ settings

export const AI_AUTOSEND_DAYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const);
export type AiAutosendDay = (typeof AI_AUTOSEND_DAYS)[number];
export const AI_AUTOSEND_DAY_LABEL: Readonly<Record<AiAutosendDay, string>> = Object.freeze({
  mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс",
});
export const AI_AUTOSEND_DAY_NAME: Readonly<Record<AiAutosendDay, string>> = Object.freeze({
  mon: "Понедельник", tue: "Вторник", wed: "Среда", thu: "Четверг", fri: "Пятница", sat: "Суббота", sun: "Воскресенье",
});
export const AI_AUTOSEND_LANGUAGES = Object.freeze(["ru", "ky", "en"] as const);
export type AiAutosendLanguage = (typeof AI_AUTOSEND_LANGUAGES)[number];
export const AI_AUTOSEND_LANGUAGE_LABEL: Readonly<Record<AiAutosendLanguage, string>> = Object.freeze({
  ru: "Русский", ky: "Кыргызча", en: "English",
});

/** Пределы базы (275, CHECK): ниже — можно, выше — нельзя. */
export const AI_AUTOSEND_LIMIT_CEILING = Object.freeze({ limitChatHour: 4, limitChatNight: 8, limitNumberHour: 30 });
export const AI_AUTOSEND_DELAY_RANGE = Object.freeze({ min: 30, max: 90 });
export const AI_AUTOSEND_MAX_SPANS = 2;
export const AI_AUTOSEND_MAX_OVERRIDES = 50;
export const AI_AUTOSEND_OVERRIDE_MAX_DAYS = 31;
export const AI_AUTOSEND_MAX_LIVE_TEST = 3;
export const AI_AUTOSEND_SHADOW_NIGHTS_REQUIRED = 3;
export const AI_AUTOSEND_PHRASE_LIMIT = 300;
export const AI_AUTOSEND_DAY_TOKEN = "{day}";

export type AiAutosendSpan = Readonly<{ from: string; to: string }>;
export type AiAutosendSchedule = Readonly<Record<AiAutosendDay, readonly AiAutosendSpan[]>>;
export type AiAutosendOverride = Readonly<{ from: string; to: string; mode: "on" | "off" }>;
export type AiAutosendPhrase = Readonly<{ text: string; confirmed: boolean }>;
export type AiAutosendPhrases = Readonly<Record<AiAutosendLanguage, Readonly<{ tomorrow: AiAutosendPhrase; day: AiAutosendPhrase }>>>;
export type AiAutosendDisclosure = Readonly<Record<AiAutosendLanguage, AiAutosendPhrase>>;

/**
 * Всё, что сотрудник меняет одной кнопкой «Сохранить» — ключи `p_patch` у
 * `ai_agent_autosend_save_v1` и `settings` у `ai_agent_autosend_v1` (277).
 * Часовой пояс в настройках не меняется (CHECK `Asia/Bishkek`).
 */
export type AiAutosendSettings = Readonly<{
  schedule: AiAutosendSchedule;
  dateOverrides: readonly AiAutosendOverride[];
  /** ISO: 1 — понедельник … 7 — воскресенье. */
  workingDays: readonly number[];
  delayMinSeconds: number;
  delayMaxSeconds: number;
  limitChatHour: number;
  limitChatNight: number;
  limitNumberHour: number;
  phrases: AiAutosendPhrases;
  disclosureEnabled: boolean;
  disclosure: AiAutosendDisclosure;
  liveTestConversationIds: readonly string[];
}>;
export const AI_AUTOSEND_LIMIT_KEYS = Object.freeze(["limitChatHour", "limitChatNight", "limitNumberHour"] as const);
export type AiAutosendLimitKey = (typeof AI_AUTOSEND_LIMIT_KEYS)[number];

/** Кто поставил паузу (275): сотрудник, агент (Gemini), CRM (отправка) или база. */
export type AiAutosendPauseKind = "user" | "agent" | "service" | "system";
export type AiAutosendPause = Readonly<{ code: string; byKind: AiAutosendPauseKind; at: string | null; reasonRu: string | null }>;

/** Финальная фраза, если бы клиент написал сейчас (по-русски), — подсказка к настройкам. */
export type AiAutosendFinalPhraseNow = Readonly<{ text: string; callDate: string | null; confirmed: boolean }>;

export type AiAutosendState = Readonly<{
  version: number;
  enabled: boolean;
  shadowMode: boolean;
  settings: AiAutosendSettings;
  timezone: string;
  responsible: Readonly<{ membershipId: string; name: string }> | null;
  enabledAt: string | null;
  pause: AiAutosendPause | null;
  /** Интервал по расписанию сейчас (§11): внутри — до какого времени; вне — когда следующий. */
  window: Readonly<{ inside: boolean; start: string | null; end: string | null; nextStart: string | null }>;
  shadowNights: number;
  shadowNightsRequired: number;
  consentRecorded: boolean;
  /** У смотрящего есть право отвечать в WhatsApp: без него включить нельзя (он станет ответственным). */
  canSend: boolean;
  /** Право ai.agent.manage: настройки, выключатель, режим и пауза. */
  canManage: boolean;
  finalPhraseNow: AiAutosendFinalPhraseNow | null;
  lastSummaryId: string | null;
  /** Имена чатов живого теста — из чтения диалогов CRM (277 отдаёт только id); чужой чат — без имени. */
  liveTestTitles: Readonly<Record<string, string>>;
}>;

function normalizeSpan(raw: unknown): AiAutosendSpan {
  if (!isObject(raw) || typeof raw.from !== "string" || typeof raw.to !== "string" || !TIME.test(raw.from) || !TIME.test(raw.to)) return invalid();
  return Object.freeze({ from: raw.from, to: raw.to });
}
function normalizePhrase(raw: unknown): AiAutosendPhrase {
  if (!isObject(raw) || typeof raw.text !== "string" || typeof raw.confirmed !== "boolean") return invalid();
  return Object.freeze({ text: raw.text.slice(0, AI_AUTOSEND_PHRASE_LIMIT), confirmed: raw.confirmed });
}

export function normalizeAiAutosendSettings(raw: unknown): AiAutosendSettings {
  if (!isObject(raw) || !isObject(raw.schedule) || !Array.isArray(raw.dateOverrides) || !Array.isArray(raw.workingDays)
    || !isObject(raw.phrases) || !isObject(raw.disclosure)) return invalid();
  const schedule = raw.schedule, phrases = raw.phrases, disclosure = raw.disclosure;
  const delayMinSeconds = int(raw.delayMinSeconds, AI_AUTOSEND_DELAY_RANGE.min, AI_AUTOSEND_DELAY_RANGE.max) ?? invalid();
  const delayMaxSeconds = int(raw.delayMaxSeconds, delayMinSeconds, AI_AUTOSEND_DELAY_RANGE.max) ?? invalid();
  return Object.freeze({
    schedule: Object.freeze(Object.fromEntries(AI_AUTOSEND_DAYS.map((day) => {
      const spans = schedule[day] ?? [];
      if (!Array.isArray(spans) || spans.length > AI_AUTOSEND_MAX_SPANS) return invalid();
      return [day, Object.freeze(spans.map(normalizeSpan))];
    })) as Record<AiAutosendDay, readonly AiAutosendSpan[]>),
    dateOverrides: Object.freeze(raw.dateOverrides.slice(0, AI_AUTOSEND_MAX_OVERRIDES).map((item) => {
      if (!isObject(item) || typeof item.from !== "string" || typeof item.to !== "string" || !DATE.test(item.from) || !DATE.test(item.to)
        || (item.mode !== "on" && item.mode !== "off")) return invalid();
      return Object.freeze({ from: item.from, to: item.to, mode: item.mode });
    })),
    workingDays: Object.freeze([...new Set(raw.workingDays.map((day) => int(day, 1, 7) ?? invalid()))].sort((left, right) => left - right)),
    delayMinSeconds,
    delayMaxSeconds,
    limitChatHour: int(raw.limitChatHour, 1, AI_AUTOSEND_LIMIT_CEILING.limitChatHour) ?? invalid(),
    limitChatNight: int(raw.limitChatNight, 1, AI_AUTOSEND_LIMIT_CEILING.limitChatNight) ?? invalid(),
    limitNumberHour: int(raw.limitNumberHour, 1, AI_AUTOSEND_LIMIT_CEILING.limitNumberHour) ?? invalid(),
    phrases: Object.freeze(Object.fromEntries(AI_AUTOSEND_LANGUAGES.map((language) => {
      const pair = phrases[language];
      if (!isObject(pair)) return invalid();
      return [language, Object.freeze({ tomorrow: normalizePhrase(pair.tomorrow), day: normalizePhrase(pair.day) })];
    })) as AiAutosendPhrases),
    disclosureEnabled: raw.disclosureEnabled === true,
    disclosure: Object.freeze(Object.fromEntries(AI_AUTOSEND_LANGUAGES.map((language) => [language, normalizePhrase(disclosure[language])])) as AiAutosendDisclosure),
    liveTestConversationIds: Object.freeze((Array.isArray(raw.liveTestConversationIds) ? raw.liveTestConversationIds : [])
      .slice(0, AI_AUTOSEND_MAX_LIVE_TEST).map((value) => uuid(value) ?? invalid())),
  });
}

const PAUSE_KINDS: readonly AiAutosendPauseKind[] = ["user", "agent", "service", "system"];

/** Ответ `ai_agent_autosend_v1` (277): `{settings, state, lastSummary, canManage, canSend, version}`. */
export function normalizeAiAutosendState(value: unknown): AiAutosendState {
  if (!isObject(value) || !isObject(value.state) || typeof value.canManage !== "boolean" || typeof value.canSend !== "boolean") return invalid();
  const state = value.state;
  if (typeof state.enabled !== "boolean" || typeof state.shadowMode !== "boolean" || !isObject(state.window)) return invalid();
  const pause = state.paused;
  const window = state.window;
  const responsible = state.responsible;
  const phrase = state.finalPhraseNow;
  const settings = normalizeAiAutosendSettings(value.settings);
  return Object.freeze({
    version: int(value.version, 1, Number.MAX_SAFE_INTEGER) ?? invalid(),
    enabled: state.enabled,
    shadowMode: state.shadowMode,
    settings,
    timezone: isObject(value.settings) ? text(value.settings.timezone, 64) ?? PLATFORM_ORGANIZATION_TIMEZONE : PLATFORM_ORGANIZATION_TIMEZONE,
    responsible: isObject(responsible) && uuid(responsible.membershipId)
      ? Object.freeze({ membershipId: uuid(responsible.membershipId)!, name: text(responsible.name, 200) ?? "сотрудник" })
      : null,
    enabledAt: iso(state.enabledAt),
    pause: isObject(pause) && typeof pause.code === "string" && CODE.test(pause.code)
      ? Object.freeze({
        code: pause.code,
        byKind: PAUSE_KINDS.includes(pause.byKind as AiAutosendPauseKind) ? pause.byKind as AiAutosendPauseKind : "system",
        at: iso(pause.at),
        reasonRu: text(pause.reasonRu, 200),
      })
      : pause === null || pause === undefined ? null : invalid(),
    window: Object.freeze({
      inside: window.inside === true, start: iso(window.intervalStart), end: iso(window.intervalEnd), nextStart: iso(window.nextStart),
    }),
    shadowNights: int(state.shadowNights, 0, 100_000) ?? 0,
    shadowNightsRequired: int(state.shadowNightsRequired, 1, 100) ?? AI_AUTOSEND_SHADOW_NIGHTS_REQUIRED,
    consentRecorded: state.consentRecorded === true,
    canSend: value.canSend,
    canManage: value.canManage,
    finalPhraseNow: isObject(phrase) && text(phrase.text, AI_AUTOSEND_PHRASE_LIMIT)
      ? Object.freeze({
        text: text(phrase.text, AI_AUTOSEND_PHRASE_LIMIT)!,
        callDate: typeof phrase.callDate === "string" && DATE.test(phrase.callDate) ? phrase.callDate : null,
        confirmed: phrase.confirmed === true,
      })
      : null,
    lastSummaryId: isObject(value.lastSummary) ? uuid(value.lastSummary.id) : null,
    liveTestTitles: Object.freeze({}),
  });
}

// ------------------------------------------------------------------ words

export type AiAutosendMode = "off" | "shadow" | "live";
/** Что автоответчик делает сейчас, одним словом для чипа. */
export function aiAutosendMode(state: Pick<AiAutosendState, "enabled" | "shadowMode">): AiAutosendMode {
  if (!state.enabled) return "off";
  return state.shadowMode ? "shadow" : "live";
}
export const AI_AUTOSEND_MODE_LABEL: Readonly<Record<AiAutosendMode, string>> = Object.freeze({
  off: "Выключен", shadow: "Проверка без отправки", live: "Отвечает",
});

/** «1 ночь», «2 ночи», «5 ночей». */
export function nightsWord(count: number): string {
  const mod10 = count % 10, mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ночь`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ночи`;
  return `${count} ночей`;
}

/**
 * Почему «Отвечает» пока нельзя (277 отвечает PT412 на то же): меньше трёх
 * ночей проверки, неподтверждённые русские фразы или строка о помощнике, пауза.
 */
export function aiAutosendLiveLock(state: Pick<AiAutosendState, "shadowNights" | "shadowNightsRequired" | "settings" | "pause">): string | null {
  const left = Math.max(0, state.shadowNightsRequired - state.shadowNights);
  if (left > 0) return `Нужно ещё ${nightsWord(left)} проверки`;
  const ru = state.settings.phrases.ru;
  if (!ru.tomorrow.confirmed || !ru.day.confirmed) return "Сначала подтвердите русские финальные фразы";
  if (state.settings.disclosureEnabled && !state.settings.disclosure.ru.confirmed) return "Сначала подтвердите строку о помощнике";
  if (state.pause) return "Сначала снимите паузу";
  return null;
}

/** Причины паузы (275, `pause_code`) словами баннера «Автоответчик на паузе: …». */
export const AI_AUTOSEND_PAUSE_REASON: Readonly<Record<string, string>> = Object.freeze({
  manual: "поставлена вручную",
  provider_down: "WhatsApp не на связи",
  provider_restricted: "WhatsApp ограничил номер (ошибка 463 или 475)",
  send_errors: "три ошибки отправки подряд",
  gemini_error: "три ошибки Gemini подряд",
  gemini_billing: "Gemini не принимает запросы — баланс или доступ",
  server_switch_off: "отправка выключена на сервере",
});
export function aiAutosendPauseReason(pause: AiAutosendPause): string {
  return AI_AUTOSEND_PAUSE_REASON[pause.code] ?? pause.reasonRu?.toLocaleLowerCase("ru") ?? "автоматическая пауза";
}

/** Причины решений и пропусков (275, `ai_autosend_reason_ru`) — для сводки, где база отдаёт коды. */
export const AI_AUTOSEND_REASON_RU: Readonly<Record<string, string>> = Object.freeze({
  disabled: "Автоответчик выключен",
  no_consent: "Нет согласия на передачу текстов в Gemini",
  paused: "Автоответчик на паузе",
  shadow_mode: "Режим «Проверка без отправки»",
  not_sales: "Чат не в очереди продаж",
  conversation_closed: "Чат закрыт",
  not_direct: "Не личный чат WhatsApp продаж",
  not_inbound: "Сообщение не от клиента",
  history_message: "Сообщение из импорта истории",
  not_latest: "Есть более новое сообщение клиента",
  outside_interval: "Вне расписания автоответчика",
  too_old: "Сообщение старше 5 минут",
  excluded: "Автоответчик выключен в этом чате",
  staff_active: "Сотрудник отвечал или был активен в чате последние 15 минут",
  media_only: "В сообщении только медиа",
  handed_off: "Финальная фраза уже сказана в этом интервале",
  limit_chat_hour: "Лимит ответов в чате за час",
  limit_chat_night: "Лимит ответов в чате за ночь",
  limit_number_hour: "Лимит ответов номера за час",
  source_not_allowed: "Источник не разрешён для автоответчика",
  citation_not_offered: "Цитата не из найденных фрагментов",
  open_review: "В источнике есть непроверенные пункты «Листа сверки»",
  number_unsupported: "Число не найдено в источнике",
  stop_word: "Стоп-слово обещаний или оплаты",
  link: "Ссылка в тексте",
  marker: "Пометка источника в тексте",
  too_long: "Текст длиннее 1000 символов",
  empty_text: "Пустой текст",
  phrase_mismatch: "Финальная фраза не совпадает с настройками",
  phrase_unconfirmed: "Фраза или строка-раскрытие на этом языке не подтверждены",
  no_working_day: "Не найден рабочий день для звонка",
  responsible_unavailable: "Ответственный сотрудник не может отправлять в этот чат",
  provider_down: "Сессия WhatsApp не в работе",
  send_expired: "Время отправки прошло",
  expired: "Решение не завершено вовремя",
  gemini_error: "Ошибка Gemini",
  gemini_billing: "Gemini: оплата или доступ",
  blocked: "Gemini отклонил запрос",
  budget: "Исчерпан месячный лимит ИИ",
  server_switch_off: "Отправка выключена на сервере",
});
export function aiAutosendReasonRu(code: string): string {
  return AI_AUTOSEND_REASON_RU[code] ?? code.replaceAll("_", " ");
}

export const AI_AUTOSEND_COPY = Object.freeze({
  title: "Автоответчик",
  pauseBanner: "Автоответчик на паузе",
  resume: "Снять паузу",
  pause: "Поставить на паузу",
  serverOff: "Отправка выключена на сервере",
  serverOffShadow: "Отправка выключена на сервере — «Проверка без отправки» пишет журнал как обычно.",
  serverOffLive: "Отправка выключена на сервере — автоответчик ничего не отправит, пока администратор сервера её не включит.",
  enable: "Включить автоответчик",
  disable: "Выключить автоответчик",
  disableConfirm: "Ответы, которые ждут отправки, отменятся.",
  firstEnable: "Первое включение — «Проверка без отправки»: решения пишутся в журнал, клиентам ничего не уходит.",
  noConsent: "Сначала администратор записывает согласие на Gemini.",
  noSendRight: "Включает сотрудник с правом отвечать в WhatsApp — он становится ответственным.",
  conflict: "Настройки изменились — обновите страницу",
  chatToggle: "Автоответчик в этом чате",
  chip: "Ночью отвечает автоответчик",
  transcript: "Автоответчик",
  check: "Проверить",
  checked: "Проверено",
  nextDay: "след. дня",
  dayOn: "Включён весь день",
  dayOff: "Выключен",
});

/** «→ 09:00 след. дня» у интервала через полночь (275: from ≥ to); иначе пусто. */
export function aiAutosendOvernight(span: AiAutosendSpan): string | null {
  return span.from >= span.to ? `→ ${span.to} ${AI_AUTOSEND_COPY.nextDay}` : null;
}

const TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", { timeZone: PLATFORM_ORGANIZATION_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAY_TIME = new Intl.DateTimeFormat("ru-RU", { timeZone: PLATFORM_ORGANIZATION_TIMEZONE, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAY_LONG = new Intl.DateTimeFormat("ru-RU", { timeZone: PLATFORM_ORGANIZATION_TIMEZONE, weekday: "short", day: "numeric", month: "long" });
const DATE_ONLY = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long" });

export function aiAutosendTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : TIME_FORMAT.format(date);
}
export function aiAutosendDayTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : DAY_TIME.format(date);
}
/** «пн, 6 октября» — ночь сводки по дате её начала. */
export function aiAutosendNight(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : DAY_LONG.format(date);
}
/** «12 октября» для даты без времени. */
export function aiAutosendDate(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return DATE.test(day) && !Number.isNaN(date.getTime()) ? DATE_ONLY.format(date) : day;
}

/** Строка под заголовком: что идёт сейчас по расписанию. */
export function aiAutosendWindowLine(state: Pick<AiAutosendState, "window">): string {
  const { inside, end, nextStart } = state.window;
  if (inside && end) return `Сейчас интервал автоответчика — до ${aiAutosendDayTime(end)}`;
  if (!inside && nextStart) return `Следующий интервал — с ${aiAutosendDayTime(nextStart)}`;
  return "По расписанию интервалов нет";
}

// ------------------------------------------------------------------ checks

const DIGIT = /\d/u;
// Как ai_autosend_phrase_text_ok (275): ссылки, точка перед 2–4 латинскими буквами, скобки.
const LINK = /(?:https?:|www\.|\.[a-z]{2,4}(?:[^a-z]|$))/iu;
const BRACKETS = /[[\]<>]/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
export const AI_AUTOSEND_DISCLOSURE_LIMIT = 200;

export type AiAutosendIssue = Readonly<{ field: string; message: string }>;

function phraseIssues(field: string, raw: string, limit: number, day: boolean | null): AiAutosendIssue[] {
  const issues: AiAutosendIssue[] = [];
  const body = raw.trim();
  if (!body) return [{ field, message: "Строка не может быть пустой." }];
  if (Array.from(body).length > limit) issues.push({ field, message: `Не длиннее ${limit} знаков.` });
  if (CONTROL.test(body)) issues.push({ field, message: "Одной строкой, без переносов." });
  if (DIGIT.test(body)) issues.push({ field, message: "Без цифр: день подставляется сам." });
  if (LINK.test(body)) issues.push({ field, message: "Без ссылок и адресов." });
  if (BRACKETS.test(body)) issues.push({ field, message: "Без скобок [ ] и < >." });
  const tokens = body.split(AI_AUTOSEND_DAY_TOKEN).length - 1;
  const strayBraces = /[{}]/u.test(body.replaceAll(AI_AUTOSEND_DAY_TOKEN, ""));
  if (day === true && (tokens !== 1 || strayBraces)) issues.push({ field, message: "Ровно одно {day} — на его место встанет день." });
  if (day !== true && (tokens > 0 || strayBraces)) issues.push({ field, message: "{day} — только во второй фразе." });
  return issues;
}

/** Проверка до записи — те же правила, что CHECK базы (275); база всё равно решает сама. */
export function aiAutosendSettingsIssues(settings: AiAutosendSettings): readonly AiAutosendIssue[] {
  const issues: AiAutosendIssue[] = [];
  for (const day of AI_AUTOSEND_DAYS) {
    const spans = settings.schedule[day];
    if (spans.length > AI_AUTOSEND_MAX_SPANS) issues.push({ field: `schedule.${day}`, message: "Не больше двух интервалов в день." });
    spans.forEach((span, index) => {
      if (!TIME.test(span.from) || !TIME.test(span.to)) issues.push({ field: `schedule.${day}.${index}`, message: "Время — ЧЧ:ММ." });
    });
  }
  if (settings.dateOverrides.length > AI_AUTOSEND_MAX_OVERRIDES) issues.push({ field: "dateOverrides", message: "Не больше 50 интервалов дат." });
  settings.dateOverrides.forEach((item, index) => {
    const from = Date.parse(`${item.from}T00:00:00Z`), to = Date.parse(`${item.to}T00:00:00Z`);
    if (!DATE.test(item.from) || !DATE.test(item.to) || !Number.isFinite(from) || !Number.isFinite(to)) {
      issues.push({ field: `dateOverrides.${index}`, message: "Укажите обе даты." });
    } else if (to < from) {
      issues.push({ field: `dateOverrides.${index}`, message: "Конец раньше начала." });
    } else if ((to - from) / 86_400_000 + 1 > AI_AUTOSEND_OVERRIDE_MAX_DAYS) {
      issues.push({ field: `dateOverrides.${index}`, message: "Не длиннее 31 дня." });
    }
  });
  if (settings.workingDays.length === 0) issues.push({ field: "workingDays", message: "Нужен хотя бы один рабочий день." });
  const { min, max } = AI_AUTOSEND_DELAY_RANGE;
  if (!(Number.isSafeInteger(settings.delayMinSeconds) && Number.isSafeInteger(settings.delayMaxSeconds)
    && settings.delayMinSeconds >= min && settings.delayMinSeconds <= settings.delayMaxSeconds && settings.delayMaxSeconds <= max)) {
    issues.push({ field: "delay", message: `От ${min} до ${max} с, «от» не больше «до».` });
  }
  for (const key of AI_AUTOSEND_LIMIT_KEYS) {
    const value = settings[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > AI_AUTOSEND_LIMIT_CEILING[key]) {
      issues.push({ field: key, message: `От 1 до ${AI_AUTOSEND_LIMIT_CEILING[key]}.` });
    }
  }
  for (const language of AI_AUTOSEND_LANGUAGES) {
    issues.push(...phraseIssues(`phrases.${language}.tomorrow`, settings.phrases[language].tomorrow.text, AI_AUTOSEND_PHRASE_LIMIT, false));
    issues.push(...phraseIssues(`phrases.${language}.day`, settings.phrases[language].day.text, AI_AUTOSEND_PHRASE_LIMIT, true));
    issues.push(...phraseIssues(`disclosure.${language}`, settings.disclosure[language].text, AI_AUTOSEND_DISCLOSURE_LIMIT, null));
  }
  if (settings.liveTestConversationIds.length > AI_AUTOSEND_MAX_LIVE_TEST) issues.push({ field: "liveTest", message: "Не больше трёх чатов." });
  return Object.freeze(issues);
}

/** Ссылка на чат из «Продажи → WhatsApp» (или его id) → id диалога; иначе null. */
export function aiAutosendConversationFromLink(value: string): string | null {
  const trimmed = value.trim();
  if (UUID.test(trimmed)) return trimmed.toLowerCase();
  try {
    const url = new URL(trimmed, "https://internal.invalid");
    if (url.pathname !== "/v3/inbox") return null;
    const id = url.searchParams.get("conversation");
    return id && UUID.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ journal

export const AI_AUTOSEND_STATUSES = Object.freeze([
  "considering", "scheduled", "authorized", "sent", "failed", "unknown", "skipped", "shadow", "cancelled",
] as const);
export type AiAutosendStatus = (typeof AI_AUTOSEND_STATUSES)[number];
export const AI_AUTOSEND_STATUS_LABEL: Readonly<Record<AiAutosendStatus, string>> = Object.freeze({
  considering: "Рассматривается",
  scheduled: "Ждёт отправки",
  authorized: "Отправляется",
  sent: "Отправлено",
  failed: "Не отправлено",
  unknown: "Итог неизвестен",
  skipped: "Пропущено",
  shadow: "Отправил бы",
  cancelled: "Отменено",
});
export const AI_AUTOSEND_STATUS_TONE: Readonly<Record<AiAutosendStatus, "neutral" | "ok" | "warn" | "danger" | "info">> = Object.freeze({
  considering: "neutral", scheduled: "info", authorized: "info", sent: "ok", failed: "danger", unknown: "warn",
  skipped: "neutral", shadow: "info", cancelled: "neutral",
});
/** Фильтры журнала — настоящие ссылки `?status=`; у базы (277) фильтр — один статус. */
export const AI_AUTOSEND_JOURNAL_FILTERS = Object.freeze([
  { key: "all", label: "Все" },
  { key: "sent", label: "Отправлено" },
  { key: "shadow", label: "Отправил бы" },
  { key: "skipped", label: "Пропущено" },
  { key: "failed", label: "Не отправлено" },
] as const);
export type AiAutosendJournalFilter = (typeof AI_AUTOSEND_JOURNAL_FILTERS)[number]["key"];

/** Код исхода отправки (CRM, `ai_autosend_record_v1`) словами журнала. */
export const AI_AUTOSEND_OUTCOME_RU: Readonly<Record<string, string>> = Object.freeze({
  provider_restricted: "WhatsApp ограничил номер (463 или 475)",
  not_claimed: "Отправку не взяли — впереди в чате была другая",
  provider_rejected: "WhatsApp отклонил сообщение",
  message_rejected: "WhatsApp отклонил сообщение",
  provider_timeout: "WhatsApp не ответил вовремя — итог проверяется",
  provider_unavailable: "WhatsApp недоступен",
  send_failed: "Не отправлено",
  send_unknown: "Итог отправки неизвестен",
});

export type AiAutosendJournalRow = Readonly<{
  id: string;
  /** Когда решение записано. */
  at: string;
  conversationId: string;
  /** Имя чата — из чтения диалога CRM; null — чат смотрящему не виден. */
  conversationTitle: string | null;
  status: AiAutosendStatus;
  mode: "live" | "shadow" | "live_test";
  kind: "answer" | "final_phrase" | null;
  reasonRu: string | null;
  outcomeCode: string | null;
  language: AiAutosendLanguage | null;
  /** Текст ответа — только если смотрящий может читать этот чат (277: иначе `textHidden`). */
  text: string | null;
  textHidden: boolean;
  callDate: string | null;
}>;

export type AiAutosendJournal = Readonly<{
  items: readonly AiAutosendJournalRow[];
  next: Readonly<{ beforeCreatedAt: string; beforeId: string }> | null;
}>;

/** Ответ `ai_agent_autosend_log_v1` (277): `{items, next}`. */
export function normalizeAiAutosendJournal(value: unknown): AiAutosendJournal {
  if (!isObject(value) || !Array.isArray(value.items)) return invalid();
  const next = value.next;
  return Object.freeze({
    items: Object.freeze(value.items.map((raw) => {
      if (!isObject(raw) || !uuid(raw.id) || !uuid(raw.conversationId) || !iso(raw.createdAt)
        || !(AI_AUTOSEND_STATUSES as readonly string[]).includes(String(raw.status))) return invalid();
      const body = typeof raw.text === "string" && raw.text.trim() ? raw.text.slice(0, 1000) : null;
      return Object.freeze({
        id: uuid(raw.id)!,
        at: iso(raw.createdAt)!,
        conversationId: uuid(raw.conversationId)!,
        conversationTitle: null,
        status: raw.status as AiAutosendStatus,
        mode: raw.mode === "live" || raw.mode === "live_test" ? raw.mode : "shadow",
        kind: raw.kind === "answer" || raw.kind === "final_phrase" ? raw.kind : null,
        reasonRu: text(raw.reasonRu, 300),
        outcomeCode: typeof raw.outcomeCode === "string" && CODE.test(raw.outcomeCode) ? raw.outcomeCode : null,
        language: (AI_AUTOSEND_LANGUAGES as readonly string[]).includes(String(raw.language)) ? raw.language as AiAutosendLanguage : null,
        text: body,
        textHidden: raw.textHidden === true && body === null,
        callDate: typeof raw.callDate === "string" && DATE.test(raw.callDate) ? raw.callDate : null,
      });
    })),
    next: isObject(next) && iso(next.beforeCreatedAt) && uuid(next.beforeId)
      ? Object.freeze({ beforeCreatedAt: iso(next.beforeCreatedAt)!, beforeId: uuid(next.beforeId)! })
      : null,
  });
}

/** Строка причины у решения журнала: причина базы или исход отправки. */
export function aiAutosendJournalReason(row: Pick<AiAutosendJournalRow, "reasonRu" | "outcomeCode" | "status">): string | null {
  if (row.reasonRu) return row.reasonRu;
  if (row.outcomeCode && (row.status === "failed" || row.status === "unknown")) {
    return AI_AUTOSEND_OUTCOME_RU[row.outcomeCode] ?? (row.status === "failed" ? "Не отправлено" : "Итог отправки неизвестен");
  }
  return null;
}

// ------------------------------------------------------------------ summary

/** Ответы квалификации (§11) в сводке — ключи базы (275) и подписи. */
export const AI_AUTOSEND_QUALIFICATION = Object.freeze([
  ["country", "Страна"], ["level", "Уровень"], ["timing", "Сроки"], ["budget", "Бюджет"],
  ["grade_or_age", "Класс или возраст"], ["city", "Город"], ["call_time", "Удобное время звонка"],
] as const);
export type AiAutosendQualificationKey = (typeof AI_AUTOSEND_QUALIFICATION)[number][0];

export type AiAutosendSummaryItem = Readonly<{
  /** null — чат смотрящему не виден (277 отдаёт `hidden` без id, имени и квалификации). */
  conversationId: string | null;
  conversationTitle: string | null;
  hidden: boolean;
  considered: number;
  answered: number;
  finalPhrase: boolean;
  reasons: readonly Readonly<{ ru: string; count: number }>[];
  /** День звонка из финальной фразы (YYYY-MM-DD) и задача «Позвонить клиенту». */
  callDate: string | null;
  taskId: string | null;
  taskSkipped: boolean;
  qualification: Readonly<Partial<Record<AiAutosendQualificationKey, string>>>;
}>;

export type AiAutosendSummary = Readonly<{
  id: string;
  intervalStart: string;
  intervalEnd: string;
  /** Ночь проверки: ни одного решения живого режима. */
  shadow: boolean;
  ready: boolean;
  counts: Readonly<{ conversations: number; considered: number; answered: number; finalPhrases: number }>;
  items: readonly AiAutosendSummaryItem[];
}>;

export type AiAutosendSummaryRead = Readonly<{ summary: AiAutosendSummary | null; shadowNights: number }>;

const count = (value: unknown) => int(value, 0, 1_000_000) ?? 0;

/** Ответ `ai_agent_autosend_summary_v1` (277): `{summary, shadowNights}`; сводки ещё нет — `summary: null`. */
export function normalizeAiAutosendSummary(value: unknown): AiAutosendSummaryRead {
  if (!isObject(value)) return invalid();
  const raw = value.summary;
  const shadowNights = count(value.shadowNights);
  if (raw === null || raw === undefined) return Object.freeze({ summary: null, shadowNights });
  if (!isObject(raw) || !uuid(raw.id) || !iso(raw.intervalStart) || !iso(raw.intervalEnd) || !Array.isArray(raw.items)) return invalid();
  const counts = isObject(raw.counts) ? raw.counts : {};
  return Object.freeze({
    shadowNights,
    summary: Object.freeze({
      id: uuid(raw.id)!,
      intervalStart: iso(raw.intervalStart)!,
      intervalEnd: iso(raw.intervalEnd)!,
      shadow: raw.shadowNight === true,
      ready: raw.status === "ready",
      counts: Object.freeze({
        conversations: count(counts.conversations), considered: count(counts.considered),
        answered: count(counts.answered), finalPhrases: count(counts.finalPhrases),
      }),
      items: Object.freeze(raw.items.map((item) => {
        if (!isObject(item)) return invalid();
        const hidden = item.hidden === true;
        const qualification = !hidden && isObject(item.qualification) ? item.qualification : {};
        const reasons = isObject(item.reasons) ? item.reasons : {};
        return Object.freeze({
          conversationId: hidden ? null : uuid(item.conversationId) ?? invalid(),
          conversationTitle: null,
          hidden,
          considered: count(item.considered),
          answered: count(item.answered),
          finalPhrase: item.finalPhrase === true,
          reasons: Object.freeze(Object.entries(reasons).flatMap(([code, n]) => {
            const times = int(n, 1, 1_000_000);
            return CODE.test(code) && times ? [Object.freeze({ ru: aiAutosendReasonRu(code), count: times })] : [];
          }).sort((left, right) => right.count - left.count)),
          callDate: !hidden && typeof item.callDate === "string" && DATE.test(item.callDate) ? item.callDate : null,
          taskId: hidden ? null : uuid(item.taskId),
          taskSkipped: !hidden && item.taskSkipped === true,
          qualification: Object.freeze(Object.fromEntries(AI_AUTOSEND_QUALIFICATION.flatMap(([key]) => {
            const answer = text(qualification[key], 140);
            return answer ? [[key, answer]] : [];
          }))),
        });
      })),
    }),
  });
}

// ------------------------------------------------------------------ chat

/** Состояние чата для окна ИИ и шапки (`GET …/conversations/[id]/autosend`, 277 `ai_agent_autosend_conversation_v1`). */
export type AiAutosendChat = Readonly<{
  enabled: boolean;
  mode: AiAutosendMode;
  paused: boolean;
  excluded: boolean;
  /** Чат в списке живого теста: в «Проверке без отправки» отвечает по-настоящему. */
  liveTest: boolean;
  /** Финальная фраза в этом интервале уже сказана — до утра чат молчит. */
  handedOff: boolean;
}>;

export function normalizeAiAutosendChat(value: unknown): AiAutosendChat {
  if (!isObject(value) || typeof value.enabled !== "boolean" || typeof value.excluded !== "boolean"
    || (value.mode !== "live" && value.mode !== "shadow" && value.mode !== "live_test")) return invalid();
  const mode: AiAutosendMode = !value.enabled ? "off" : value.mode === "live" ? "live" : "shadow";
  return Object.freeze({
    enabled: value.enabled,
    mode,
    paused: value.paused === true,
    excluded: value.excluded,
    liveTest: value.mode === "live_test",
    handedOff: value.handedOff === true,
  });
}

/** Ответит ли автоответчик в этом чате ночью по-настоящему (для чипа в шапке). */
export function aiAutosendAnswersHere(chat: AiAutosendChat, serverOn: boolean): boolean {
  return serverOn && chat.enabled && !chat.paused && !chat.excluded && (chat.mode === "live" || chat.liveTest);
}

/** Строка под переключателем «Автоответчик в этом чате». */
export function aiAutosendChatLine(chat: AiAutosendChat, serverOn: boolean): string {
  if (chat.excluded) return "Чат исключён — автоответчик сюда не пишет.";
  if (chat.paused) return "Автоответчик на паузе.";
  if (chat.mode === "shadow" && !chat.liveTest) return "Проверка без отправки — клиенту ничего не уходит.";
  if (!serverOn) return "Отправка выключена на сервере.";
  if (chat.handedOff) return "Финальная фраза сказана — до утра молчит.";
  return chat.liveTest ? "Живой тест: ночью отвечает по-настоящему." : "Ночью отвечает по расписанию.";
}
