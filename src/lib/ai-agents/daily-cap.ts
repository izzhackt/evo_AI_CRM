/**
 * «ИИ-агенты»: дневной лимит расхода на запуски по входящему WhatsApp (решение владельца 26.10.2026:
 * «Продажи» остаются в WhatsApp с лимитом $10 в день). Чистый модуль без React, сервера и ввода-вывода:
 * его читают рантайм (`src/lib/server/ai-agents/daily-cap.ts`), страница агента и тесты.
 *
 * Правило. Запуск по событию `whatsapp_inbound` не стартует, пока расход агента за текущие сутки по Бишкеку
 * (с 00:00 `Asia/Bishkek`) вместе с резервом под запуски в работе не достиг лимита. Расход — `cost_cents`
 * запусков агента, начатых сегодня (любой вид: лимит про агента, а не про один вид запуска); резерв — для каждого
 * запуска в работе доля его потолка, которая ещё не потрачена. Запуски по заявке сайта, по расписанию и по
 * поручению этим лимитом НЕ останавливаются: они только входят в расход.
 *
 * Факты о расходе даёт база (`platform.ai_agent_runtime_daily_spend_v1`, миграция 321); решает — этот модуль.
 */

/** Имя переменной окружения с лимитом, USD в день (необязательна). */
export const AI_AGENT_WHATSAPP_DAILY_BUDGET_ENV = "EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD";
/** Лимит по умолчанию, USD в день. */
export const AI_AGENT_WHATSAPP_DAILY_BUDGET_DEFAULT_USD = 10;
/** Код причины в строке запуска и в журнале приложения. */
export const AI_AGENT_DAILY_BUDGET_REACHED_CODE = "daily_budget_reached";
/** Функция схемы `platform` (service_role), миграция 321. */
export const AI_AGENT_DAILY_SPEND_RPC = "ai_agent_runtime_daily_spend_v1";
/** Сутки лимита считаются по Бишкеку (UTC+6 без перехода на летнее время). */
export const AI_AGENT_CAP_TIME_ZONE = "Asia/Bishkek";
/**
 * Запуск в работе дольше этого срока резерва не держит: его закрывает сверка, а зависшая строка не должна
 * запирать WhatsApp на весь день. Его записанный расход в сумму всё равно входит.
 */
export const AI_AGENT_CAP_OPEN_RUN_WINDOW_MINUTES = 60;

const DAILY_BUDGET_FORMAT = /^\d{1,6}(?:\.\d{1,2})?$/u;

/**
 * Лимит из окружения, USD. Пусто, не число, ноль, минус, `1e2`, `Infinity`, больше двух знаков после точки —
 * лимит по умолчанию: «без лимита» этим значением не включается никогда.
 */
export function parseWhatsappDailyBudgetUsd(raw: string | null | undefined): number {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!DAILY_BUDGET_FORMAT.test(text)) return AI_AGENT_WHATSAPP_DAILY_BUDGET_DEFAULT_USD;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : AI_AGENT_WHATSAPP_DAILY_BUDGET_DEFAULT_USD;
}

/** Лимит из окружения, целые центы (всегда больше нуля). */
export function readWhatsappDailyBudgetCents(env: Readonly<Record<string, string | undefined>>): number {
  return Math.max(1, Math.round(parseWhatsappDailyBudgetUsd(env[AI_AGENT_WHATSAPP_DAILY_BUDGET_ENV]) * 100));
}

/* ------------------------------------------------------------- сутки по Бишкеку */

/** Календарный день по Бишкеку, `YYYY-MM-DD`: тот же день, что `(момент AT TIME ZONE 'Asia/Bishkek')::DATE` в базе. */
export function bishkekDay(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AI_AGENT_CAP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Ключ единственной строки «лимит исчерпан» на агента и сутки: повтор в тот же день ничего не добавляет. */
export function dailyCapRecordKey(nowMs: number): string {
  return `wacap:${bishkekDay(nowMs)}`;
}

/* --------------------------------------------------------------------- деньги */

/** `$10`, `$7,50`, `$0,35` — как в тексте владельца: целое без копеек, дробное с запятой. */
export function formatCapUsd(cents: number): string {
  const safe = Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
  return safe % 100 === 0 ? `$${safe / 100}` : `$${(safe / 100).toFixed(2).replace(".", ",")}`;
}

/** Слова строки запуска и журнала, когда лимит исчерпан. */
export function dailyCapReachedMessage(capCents: number): string {
  return `Дневной лимит ${formatCapUsd(capCents)} на WhatsApp исчерпан — до завтра агент не запускается`;
}

/** Значение строки в настройках агента: `$10 в день, сегодня потрачено $1,25`. */
export function dailyCapValue(capCents: number, spentToday: number): string {
  return `${formatCapUsd(capCents)} в день, сегодня потрачено ${formatCapUsd(spentToday)}`;
}

/** Строка в настройках агента: `Лимит на WhatsApp: $10 в день, сегодня потрачено $1,25`. */
export function dailyCapLine(capCents: number, spentToday: number): string {
  return `Лимит на WhatsApp: ${dailyCapValue(capCents, spentToday)}`;
}

/** Расход агента за сегодняшние сутки по Бишкеку из ряда «расход по дням» страницы агента; нет точки — 0. */
export function spentTodayCents(
  spendPerDay: readonly Readonly<{ date: string; costCents?: number }>[],
  nowMs: number,
): number {
  const today = bishkekDay(nowMs);
  const point = spendPerDay.find((entry) => entry.date === today);
  const value = point?.costCents;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/* -------------------------------------------------------------------- решение */

export type DailySpendOpenRun = Readonly<{ costCents: number }>;
export type DailySpendFacts = Readonly<{
  /** Сутки по Бишкеку, `YYYY-MM-DD` (по часам, которые приложение передало базе). */
  day: string;
  /** Записанный расход (центы) запусков агента, начатых за эти сутки, в любом статусе. */
  spentCents: number;
  /** Запуски агента в работе, начатые не раньше окна резерва; расход — записанный на сейчас. */
  open: readonly DailySpendOpenRun[];
}>;

const finiteNonNegative = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Ответ базы → факты; любая другая форма — null (решать нечем, запуск не стартует). */
export function parseDailySpendFacts(data: unknown): DailySpendFacts | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const spent = finiteNonNegative(record.spentCents);
  if (spent === null || typeof record.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(record.day)) return null;
  if (!Array.isArray(record.open)) return null;
  const open: DailySpendOpenRun[] = [];
  for (const item of record.open) {
    const cost = typeof item === "object" && item !== null ? finiteNonNegative((item as Record<string, unknown>).costCents) : null;
    if (cost === null) return null;
    open.push({ costCents: cost });
  }
  return { day: record.day, spentCents: spent, open };
}

export type DailyCapReason = "daily_budget_reached" | "daily_budget_reserved";
export type DailyCapDecision = Readonly<{
  blocked: boolean;
  /** `daily_budget_reached` — записанный расход дошёл до лимита; `daily_budget_reserved` — до лимита дошёл только с резервом. */
  reason: DailyCapReason | null;
  capCents: number;
  spentCents: number;
  reservedCents: number;
  usedCents: number;
}>;

/**
 * Решение «запускать ли». Остановка при `расход + резерв >= лимит`: ровно $10,00 уже остановка, $9,99 — нет.
 * Резерв запуска в работе — его потолок за вычетом уже записанного расхода; потолок 0 («без потолка») резервирует
 * весь остаток лимита. Худший перерасход — один запуск, начатый на $9,99: он может истратить свой потолок.
 */
export function evaluateWhatsappDailyCap(input: Readonly<{
  capCents: number;
  /** Потолок одного запуска агента, USD (`run_budget_usd`); 0 или меньше — без потолка. */
  runBudgetUsd: number;
  facts: DailySpendFacts;
}>): DailyCapDecision {
  const capCents = Math.max(1, Math.round(input.capCents));
  const runBudgetCents = Number.isFinite(input.runBudgetUsd) && input.runBudgetUsd > 0 ? Math.round(input.runBudgetUsd * 100) : 0;
  const ceilingCents = runBudgetCents > 0 ? runBudgetCents : capCents;
  const spentCents = Math.max(0, Math.round(input.facts.spentCents));
  const reservedCents = input.facts.open.reduce((sum, run) => sum + Math.max(0, ceilingCents - Math.round(run.costCents)), 0);
  const usedCents = spentCents + reservedCents;
  const blocked = usedCents >= capCents;
  return {
    blocked,
    reason: !blocked ? null : spentCents >= capCents ? "daily_budget_reached" : "daily_budget_reserved",
    capCents,
    spentCents,
    reservedCents,
    usedCents,
  };
}
