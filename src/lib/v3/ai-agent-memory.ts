/**
 * «ИИ-агент» P3 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §9, §12.1, §15 P3):
 * чистый контракт блока «Что ИИ знает о клиенте» в окне ИИ и переключателя
 * «Память о клиенте» в «Расходах» — без React и без сервера. Его читают
 * маршрут CRM, клиентское окно, серверная страница и Node-тесты.
 *
 * Что показывать, решает база (274): `platform.ai_agent_memory_v1` отдаёт
 * включена ли память, записано ли согласие, работает ли она (`active`:
 * включена, согласие есть, организация активна), может ли сотрудник её
 * включить, сколько сообщений в диалоге, пора ли собрать сводку и интерес
 * (`summaryDue`, `interestDue` — только пока память работает), строку памяти
 * (интерес, сводка, сколько сообщений она покрывает, когда обновлена) и
 * карточку лида — ту же, что видит модель (`ai_lead_card`), прочитанную
 * живьём. Чужая форма — ошибка (`AiAgentShapeError`), а не пустой блок.
 * Gemini здесь не вызывается.
 *
 * Сводку и интерес агент собирает только по новому сообщению клиента
 * (опрос `inbound_since_v1` → `memory_due_v1`, 274): поэтому слова — «после
 * следующего сообщения клиента», а не «готовится».
 */
import { LEAD_DIRECTIONS } from "../platform-manual-lead-contract.ts";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "../platform-organization-time.ts";
import { AiAgentShapeError } from "./ai-agent.ts";
import { salesStage } from "./wording.ts";

/** Окно ответа — последние 20 сообщений дословно (§9); сводка нужна только длиннее. */
export const AI_MEMORY_WINDOW = 20;
/** Пределы строки памяти в базе (274): интерес — одна строка ≤ 140, сводка ≤ 1500. */
export const AI_MEMORY_INTEREST_LIMIT = 140;
export const AI_MEMORY_SUMMARY_LIMIT = 1500;
/** Сводка длиннее — свёрнута до шести строк с «Показать всё». */
export const AI_MEMORY_SUMMARY_CLAMP_FROM = 280;

export type AiMemoryLead = Readonly<{
  /** Только первое слово имени (как у модели); похожее на номер — null. */
  name: string | null;
  /** Ключ направления лида (`CN`, `MY`, `EU`, `AE`, `TR`); имя ключа — как в карточке базы. */
  interestDirection: string | null;
  /** Ключ этапа лида (`new`, `qualified`, …). */
  stage: string | null;
}>;

export type AiClientMemory = Readonly<{
  interest: string | null;
  summary: string | null;
  coveredCount: number;
  updatedAt: string | null;
}>;

export type AiMemoryView = Readonly<{
  enabled: boolean;
  consentRecorded: boolean;
  /** Память работает: включена, согласие записано, организация активна (`ai_memory_gate`). */
  active: boolean;
  canManage: boolean;
  messageCount: number;
  /** Сводку пора собрать (> 20 сообщений и ≥ 6 непокрытых за окном, или пересборка); без `active` — false. */
  summaryDue: boolean;
  /** Последнее сообщение клиента ещё не учтено в интересе; без `active` — false. */
  interestDue: boolean;
  memory: AiClientMemory | null;
  lead: AiMemoryLead | null;
}>;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const invalid = (): never => { throw new AiAgentShapeError(); };
/** Пустая строка — «нет»; длинная обрезается до предела базы. */
const optionalText = (value: unknown, max: number): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return invalid();
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/u;

function normalizeLead(value: unknown): AiMemoryLead | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return invalid();
  const name = optionalText(value.name, 80);
  const interestDirection = typeof value.interestDirection === "string" && KEY.test(value.interestDirection) ? value.interestDirection : null;
  const stage = typeof value.stage === "string" && KEY.test(value.stage) ? value.stage : null;
  return Object.freeze({ name: name && !/[0-9@+]/u.test(name) ? name : null, interestDirection, stage });
}

function normalizeMemory(value: unknown): AiClientMemory | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return invalid();
  const interest = optionalText(value.interest, AI_MEMORY_INTEREST_LIMIT);
  return Object.freeze({
    // Интерес — одна строка (274); перевод строки модели здесь ничего не ломает.
    interest: interest ? interest.replace(/\s+/gu, " ") : null,
    summary: optionalText(value.summary, AI_MEMORY_SUMMARY_LIMIT),
    coveredCount: count(value.coveredCount) ?? 0,
    updatedAt: typeof value.updatedAt === "string" && ISO.test(value.updatedAt) ? value.updatedAt : null,
  });
}

/**
 * Ответ `ai_agent_memory_v1` (274) — и тот же JSON маршрута окна: ключи
 * совпадают с базой, поэтому окно нормализует ответ маршрута той же функцией.
 */
export function normalizeAiMemoryView(value: unknown): AiMemoryView {
  if (!isObject(value) || typeof value.enabled !== "boolean" || typeof value.consentRecorded !== "boolean"
    || typeof value.active !== "boolean" || typeof value.canManage !== "boolean"
    || typeof value.summaryDue !== "boolean" || typeof value.interestDue !== "boolean") return invalid();
  // `active` без включённой памяти и согласия база не отдаёт (274) — такая форма чужая.
  if (value.active && !(value.enabled && value.consentRecorded)) return invalid();
  return Object.freeze({
    enabled: value.enabled,
    consentRecorded: value.consentRecorded,
    active: value.active,
    canManage: value.canManage,
    messageCount: count(value.messageCount) ?? invalid(),
    summaryDue: value.active && value.summaryDue,
    interestDue: value.active && value.interestDue,
    memory: normalizeMemory(value.memory),
    lead: normalizeLead(value.lead),
  });
}

// ------------------------------------------------------------------ copy

export const AI_MEMORY_COPY = Object.freeze({
  title: "Что ИИ знает о клиенте",
  off: "Память о клиенте выключена.",
  enable: "Включить",
  paused: "Память на паузе: без согласия на Gemini сводка и интерес не собираются.",
  pausedInactive: "Память на паузе: сводка и интерес не собираются.",
  short: "ИИ видит всю переписку — сводка не нужна.",
  waiting: "Сводка появится, когда переписка станет длиннее.",
  due: "Сводки пока нет — ИИ соберёт её после следующего сообщения клиента.",
  noInterest: "Интерес появится после следующего сообщения клиента.",
  noLead: "Карточки лида нет.",
  emptyLead: "В карточке лида пусто.",
  failed: "Не удалось загрузить",
  retry: "Повторить",
  unavailable: "Память этого чата недоступна.",
  forget: "Забыть сводку",
  // Строка памяти удаляется целиком (274), новую агент соберёт по следующему сообщению клиента.
  forgetConfirm: "Сводка и интерес удалятся. ИИ соберёт их заново после следующего сообщения клиента.",
  forgotten: "Сводка и интерес удалены.",
  forgetFailed: "Не удалось забыть сводку. Повторите.",
  forgetForbidden: "Нет права забыть сводку в этом чате.",
});

/**
 * Состояние памяти этого диалога (одно на блок): `off` — память выключена;
 * `paused` — включена, но не работает (нет согласия на Gemini), база ничего
 * не отдаёт и не собирает; `short` — переписка не длиннее окна, сводка не
 * нужна; `waiting` — длиннее окна, но за окном меньше шести непокрытых
 * сообщений — сводку собирать рано; `due` — сводку пора собрать, её ещё нет;
 * `ready` — сводка есть.
 */
export type AiMemoryState = "off" | "paused" | "short" | "waiting" | "due" | "ready";

export function aiMemoryState(view: AiMemoryView): AiMemoryState {
  if (!view.enabled) return "off";
  if (!view.active) return "paused";
  if (view.memory?.summary) return "ready";
  if (view.summaryDue) return "due";
  return view.messageCount > AI_MEMORY_WINDOW ? "waiting" : "short";
}

/** Строка «Сводка» без сводки: почему её нет и когда она появится. */
export function aiMemorySummaryState(state: AiMemoryState): string | null {
  return state === "due" ? AI_MEMORY_COPY.due : state === "waiting" ? AI_MEMORY_COPY.waiting
    : state === "short" ? AI_MEMORY_COPY.short : null;
}

/** Пауза словами: нет согласия — так и сказано; иначе (организация не активна) — без причины. */
export function aiMemoryPausedText(view: AiMemoryView): string {
  return view.consentRecorded ? AI_MEMORY_COPY.pausedInactive : AI_MEMORY_COPY.paused;
}

/** Вторая строка свёрнутого блока: интерес или короткое состояние. */
export function aiMemoryHint(view: AiMemoryView): string {
  const state = aiMemoryState(view);
  if (state === "off") return "Память выключена";
  if (state === "paused") return "Память на паузе";
  if (view.memory?.interest) return view.memory.interest;
  return state === "due" ? "Сводки пока нет" : state === "waiting" ? "Сводка пока не нужна"
    : state === "short" ? "Вся переписка на виду у ИИ" : "Интереса пока нет";
}

/** «Айгуль · Малайзия · Квалифицирован»: только то, что есть в карточке. */
export function aiLeadLine(lead: AiMemoryLead | null): string {
  if (!lead) return AI_MEMORY_COPY.noLead;
  const direction = lead.interestDirection ? (LEAD_DIRECTIONS as Readonly<Record<string, string>>)[lead.interestDirection] ?? null : null;
  const parts = [lead.name, direction, salesStage(lead.stage)].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(" · ") : AI_MEMORY_COPY.emptyLead;
}

/** «по 1 сообщению», «по 3 сообщениям», «по 25 сообщениям». */
export function aiMessagesDative(value: number): string {
  const mod10 = value % 10, mod100 = value % 100;
  return `${value} ${mod10 === 1 && mod100 !== 11 ? "сообщению" : "сообщениям"}`;
}

const TIME = new Intl.DateTimeFormat("ru-RU", { timeZone: PLATFORM_ORGANIZATION_TIMEZONE, hour: "2-digit", minute: "2-digit" });
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: PLATFORM_ORGANIZATION_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", { timeZone: PLATFORM_ORGANIZATION_TIMEZONE, day: "numeric", month: "long" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("ru-RU", { timeZone: PLATFORM_ORGANIZATION_TIMEZONE, day: "numeric", month: "long", year: "numeric" });

/** «14:20», «вчера в 14:20», «5 октября в 14:20» — по Бишкеку (год — если не текущий). */
export function aiMemoryUpdated(iso: string, now: Date = new Date()): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = DAY_KEY.format(date), today = DAY_KEY.format(now);
  const time = TIME.format(date);
  if (day === today) return time;
  if (day === DAY_KEY.format(new Date(now.getTime() - 86_400_000))) return `вчера в ${time}`;
  const label = day.slice(0, 4) === today.slice(0, 4) ? DAY_MONTH.format(date) : DAY_MONTH_YEAR.format(date).replace(/\s?г\.$/u, "");
  return `${label} в ${time}`;
}

/** «Сводка по 25 сообщениям · обновлена 14:20». */
export function aiMemoryMeta(memory: AiClientMemory, now: Date = new Date()): string | null {
  if (!memory.summary) return null;
  const updated = memory.updatedAt ? aiMemoryUpdated(memory.updatedAt, now) : null;
  const covered = memory.coveredCount > 0 ? `Сводка по ${aiMessagesDative(memory.coveredCount)}` : "Сводка";
  return updated ? `${covered} · обновлена ${updated}` : covered;
}

/** Куда ведёт «Включить» из окна: блок «Память о клиенте» в «Расходах». */
export const AI_MEMORY_SETTINGS_HREF = "/v3/ai-agent?section=spend#ai-memory";

// ------------------------------------------------------------------ section

/** Переключатель в «Агенте и лимите» (§12.2): слова и подсказки. */
export const AI_MEMORY_SETTINGS_COPY = Object.freeze({
  title: "Память о клиенте",
  on: "включена",
  off: "выключена",
  // Неразрывный пробел перед тире: «— нет.» не уходит в начало строки.
  about: "Сводка длинных переписок и интерес клиента. Тексты уходят в Gemini, фото и файлы\u00A0— нет.",
  enable: "Включить память",
  disable: "Выключить память",
  disableConfirm: "Сводки всех клиентов удалятся.",
  disableSubmit: "Выключить и удалить сводки",
  noConsent: "Сначала администратор записывает согласие на Gemini.",
  enabled: "Память включена.",
  disabled: "Память выключена, сводки удалены.",
});
