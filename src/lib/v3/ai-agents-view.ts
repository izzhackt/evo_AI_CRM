import {
  AI_AGENT_DIGEST_KINDS,
  AI_AGENT_DRAFT_CHANNELS,
  AI_AGENT_DRAFT_STATUSES,
  AI_AGENT_GROUPS,
  AI_AGENT_KEYS,
  AI_AGENT_RUN_STATUSES,
  AI_AGENT_SYNC_STATUSES,
  AI_AGENT_TOOL_LABELS,
  AI_AGENT_TRIGGER_KINDS,
  AI_AGENT_TRIGGER_LABELS,
  AI_AGENT_DIRECTIONS,
  isAiAgentModelId,
  type AiAgentActionRow,
  type AiAgentChartPoint,
  type AiAgentDetail,
  type AiAgentDigestRow,
  type AiAgentDigestsListResult,
  type AiAgentDraftRow,
  type AiAgentDraftStatus,
  type AiAgentDraftsListResult,
  type AiAgentKey,
  type AiAgentListItem,
  type AiAgentRunGetResult,
  type AiAgentRunRow,
  type AiAgentRunStatus,
  type AiAgentRunsListResult,
  type AiAgentStats,
  type AiAgentSyncInfo,
  type AiAgentUiEvent,
  type AiAgentsListResult,
} from "../ai-agents/contract.ts";

/*
 * «ИИ-агенты» (решение владельца 22.10.2026, docs/design/ai-agents/contract.md
 * §D): чистые функции показа — слова, деньги, время, расписание, ряды графиков,
 * безопасный Markdown, разбор ответов RPC сотрудника. Без React, сервера и
 * ввода-вывода: их проверяет tests/ai-agents-ui.test.mjs, а страницы и
 * компоненты только рисуют готовое.
 */

/* ------------------------------------------------------------------ маршруты */

export const AI_AGENT_TABS = [
  { key: "overview", label: "Обзор" },
  { key: "command", label: "Поручить" },
  { key: "runs", label: "Запуски" },
  { key: "drafts", label: "Черновики" },
  { key: "instructions", label: "Инструкция" },
  { key: "settings", label: "Настройки" },
] as const;
export type AiAgentTab = (typeof AI_AGENT_TABS)[number]["key"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isAiAgentUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

type Query = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Единственное значение параметра; повтор или массив — недопустимо (`null`). */
function single(query: Query, name: string): string | undefined | null {
  const value = query[name];
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

export type AiAgentPageRoute = Readonly<{
  tab: AiAgentTab;
  runId: string | null;
  /** Сколько строк «Запусков» показано (шаг «Показать ещё»). */
  runsLimit: number;
  draftsFilter: "pending" | "all";
  /** `?new=1`: «Поручить» открывается пустым разговором и не подхватывает последний за 12 часов. */
  fresh: boolean;
}>;

export const AI_AGENT_RUNS_STEP = 30;
export const AI_AGENT_RUNS_MAX = 120;

/** Разбор `?tab=`, `&run=`, `&limit=`, `&show=`, `&new=`; неизвестное значение — `null` (404), а не молчаливая замена. */
export function parseAiAgentRoute(query: Query): AiAgentPageRoute | null {
  const tab = single(query, "tab");
  const run = single(query, "run");
  const limit = single(query, "limit");
  const show = single(query, "show");
  const fresh = single(query, "new");
  if (tab === null || run === null || limit === null || show === null || fresh === null) return null;
  const known = tab === undefined ? "overview" : AI_AGENT_TABS.find((one) => one.key === tab)?.key;
  if (!known) return null;
  if (run !== undefined && !isAiAgentUuid(run)) return null;
  let runsLimit = AI_AGENT_RUNS_STEP;
  if (limit !== undefined) {
    if (!/^[1-9]\d{0,3}$/u.test(limit)) return null;
    runsLimit = Math.min(AI_AGENT_RUNS_MAX, Math.max(AI_AGENT_RUNS_STEP, Number(limit)));
  }
  if (show !== undefined && show !== "all") return null;
  if (fresh !== undefined && fresh !== "1") return null;
  return { tab: known, runId: run ?? null, runsLimit, draftsFilter: show === "all" ? "all" : "pending", fresh: fresh === "1" };
}

export const AI_AGENTS_HUB_HREF = "/v3/ai-agents";

export function aiAgentHref(
  key: AiAgentKey,
  options: Readonly<{ tab?: AiAgentTab; run?: string | null; limit?: number | null; show?: "all" | null; fresh?: boolean }> = {},
): string {
  const params = new URLSearchParams();
  if (options.tab && options.tab !== "overview") params.set("tab", options.tab);
  if (options.run) params.set("run", options.run);
  if (options.limit && options.limit > AI_AGENT_RUNS_STEP) params.set("limit", String(options.limit));
  if (options.show === "all") params.set("show", "all");
  if (options.fresh) params.set("new", "1");
  const query = params.toString();
  return `${AI_AGENTS_HUB_HREF}/${key}${query ? `?${query}` : ""}`;
}

/* -------------------------------------------------------------- деньги, время */

const NBSP = " ";

/** `1,25 $`; меньше цента, но не ноль — `< 0,01 $`. */
export function formatUsdCents(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return `0,00${NBSP}$`;
  if (cents < 1) return `< 0,01${NBSP}$`;
  return `${(Math.round(cents) / 100).toFixed(2).replace(".", ",")}${NBSP}$`;
}

/** Доллары из настроек (`runBudgetUsd`): `5,00 $`. */
export function formatUsd(value: number): string {
  return formatUsdCents(Math.round(value * 100));
}

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] as const;
const ZONE = "Asia/Bishkek";

function zoned(iso: string): Readonly<{ y: number; mo: number; d: number; h: number; mi: number }> | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(new Date(time));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { y: pick("year"), mo: pick("month"), d: pick("day"), h: pick("hour"), mi: pick("minute") };
}

const two = (value: number) => String(value).padStart(2, "0");

/** «22 окт, 14:05» (Бишкек); другой год — с годом. */
export function formatDateTimeRu(iso: string | null, nowIso?: string): string {
  if (!iso) return "—";
  const at = zoned(iso);
  if (!at) return "—";
  const now = nowIso ? zoned(nowIso) : null;
  const year = now && now.y !== at.y ? ` ${at.y}` : "";
  return `${at.d} ${MONTHS_SHORT[at.mo - 1]}${year}, ${two(at.h)}:${two(at.mi)}`;
}

/** `2026-10-22` → «22 окт»; год — только если он не `thisYear`. */
export function formatDayRu(date: string, thisYear?: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(date);
  if (!match) return date;
  const month = Number(match[2]);
  const year = thisYear !== undefined && Number(match[1]) !== thisYear ? ` ${match[1]}` : "";
  return `${Number(match[3])} ${MONTHS_SHORT[month - 1] ?? ""}${year}`.trim();
}

/** «только что», «5 мин назад», «2 ч назад», «вчера», «3 дн. назад», дальше — дата. */
export function relativeTimeRu(iso: string | null, nowIso: string): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return "—";
  const seconds = Math.round((now - then) / 1000);
  if (seconds < -300) return formatDateTimeRu(iso, nowIso);
  if (seconds < 45) return "только что";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн. назад`;
  return formatDateTimeRu(iso, nowIso);
}

/** «2 мин 14 с», «45 с», «1 ч 05 мин»; нет данных — «—». */
export function durationWords(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole} с`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes} мин ${two(whole % 60)} с`;
  return `${Math.floor(minutes / 60)} ч ${two(minutes % 60)} мин`;
}

/* ------------------------------------------------------------------ расписание */

export type ScheduleKind = "none" | "daily" | "weekdays" | "weekly";
export type SchedulePlan = Readonly<{ kind: ScheduleKind; time: string; weekday: number }>;

const EVERY_WEEKDAY = ["Каждое воскресенье", "Каждый понедельник", "Каждый вторник", "Каждую среду", "Каждый четверг", "Каждую пятницу", "Каждую субботу"] as const;
export const SCHEDULE_WEEKDAY_OPTIONS = [
  { value: 1, label: "Понедельник" }, { value: 2, label: "Вторник" }, { value: 3, label: "Среда" },
  { value: 4, label: "Четверг" }, { value: 5, label: "Пятница" }, { value: 6, label: "Суббота" }, { value: 0, label: "Воскресенье" },
] as const;

const TIMEZONE_NAMES: Readonly<Record<string, string>> = {
  "Asia/Bishkek": "Бишкек",
  "Asia/Almaty": "Алматы",
  "Asia/Dubai": "Дубай",
  "Asia/Kuala_Lumpur": "Куала-Лумпур",
  "Asia/Shanghai": "Шанхай",
  "Europe/Istanbul": "Стамбул",
  "Europe/Moscow": "Москва",
  UTC: "UTC",
};
export const SCHEDULE_TIMEZONES = Object.keys(TIMEZONE_NAMES);
export const timezoneLabel = (tz: string): string => TIMEZONE_NAMES[tz] ?? tz;

/** То же правило, что `ai_agents_cron_ok` в базе: пять полей из `0-9 * / , -`. */
export function isValidCron(value: string): boolean {
  const fields = value.trim().split(/\s+/u);
  return fields.length === 5 && fields.every((field) => /^[0-9*/,-]+$/u.test(field));
}

/** Простой план расписания из cron; всё, что не укладывается в четыре вида, — `"custom"`. */
export function parseCronPlan(cron: string | null): SchedulePlan | "custom" {
  if (cron === null || cron.trim() === "") return { kind: "none", time: "09:00", weekday: 1 };
  const fields = cron.trim().split(/\s+/u);
  if (fields.length !== 5) return "custom";
  const [minute, hour, dom, month, dow] = fields;
  if (!/^\d{1,2}$/u.test(minute) || !/^\d{1,2}$/u.test(hour) || dom !== "*" || month !== "*") return "custom";
  const m = Number(minute);
  const h = Number(hour);
  if (m > 59 || h > 23) return "custom";
  const time = `${two(h)}:${two(m)}`;
  if (dow === "*") return { kind: "daily", time, weekday: 1 };
  if (dow === "1-5") return { kind: "weekdays", time, weekday: 1 };
  if (/^[0-7]$/u.test(dow)) return { kind: "weekly", time, weekday: Number(dow) % 7 };
  return "custom";
}

export function cronFromPlan(plan: SchedulePlan): string | null {
  if (plan.kind === "none") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(plan.time);
  if (!match) return null;
  const head = `${Number(match[2])} ${Number(match[1])} * *`;
  return plan.kind === "daily" ? `${head} *` : plan.kind === "weekdays" ? `${head} 1-5` : `${head} ${plan.weekday % 7}`;
}

/** «Каждый понедельник в 09:00, Бишкек»; нет расписания — «Без расписания». */
export function describeSchedule(cron: string | null, tz: string): string {
  const plan = parseCronPlan(cron);
  if (plan !== "custom" && plan.kind === "none") return "Без расписания";
  const zone = timezoneLabel(tz);
  if (plan === "custom") return `По расписанию «${cron}», ${zone}`;
  const when = plan.kind === "daily" ? "Каждый день" : plan.kind === "weekdays" ? "По будням" : EVERY_WEEKDAY[plan.weekday];
  return `${when} в ${plan.time}, ${zone}`;
}

/* ------------------------------------------------------------ состояние агента */

export type AiAgentChipTone = "neutral" | "ok" | "warn" | "danger" | "info";
export type AiAgentStateChip = Readonly<{ label: string; tone: AiAgentChipTone }>;

/** Одно слово состояния агента — на карточке хаба и в шапке страницы. */
export function aiAgentStateChip(input: Readonly<{
  enabled: boolean;
  hasInstructions: boolean;
  syncStatus: AiAgentSyncInfo["status"];
  needsSync: boolean;
}>): AiAgentStateChip {
  if (!input.hasInstructions) return { label: "Инструкции пока нет", tone: "neutral" };
  if (!input.enabled) return { label: "Выключен", tone: "neutral" };
  if (input.syncStatus === "error") return { label: "Ошибка синхронизации", tone: "danger" };
  if (input.syncStatus !== "ok" || input.needsSync) return { label: "Нужна синхронизация", tone: "warn" };
  return { label: "Включён", tone: "ok" };
}

/** Следующий шаг до первого поручения: написать инструкцию → включить → синхронизировать (включение отправляет в Claude само). */
export type AiAgentSetupStep = "instructions" | "enable" | "sync";

/**
 * Какой шаг осталось сделать системному администратору, чтобы агент заработал; `null` — шагов нет
 * (агент готов или причина не в настройке агента: ключ Claude, просмотр роли, ограничение Директора,
 * не администратор). Первый несделанный шаг — единственное действие в запертом «Поручить» и на «Обзоре».
 */
export function aiAgentNextStep(input: Readonly<{
  canEdit: boolean;
  runtimeConfigured: boolean;
  preview: boolean;
  hasInstructions: boolean;
  enabled: boolean;
  synced: boolean;
}>): AiAgentSetupStep | null {
  if (!input.canEdit || input.preview || !input.runtimeConfigured) return null;
  if (!input.hasInstructions) return "instructions";
  if (!input.enabled) return "enable";
  if (!input.synced) return "sync";
  return null;
}

/**
 * Агента можно запускать («Поручить», события): синхронизация прошла или у агента осталась рабочая
 * настройка в Claude, хотя последняя синхронизация не удалась или не завершилась (миграция 318, ревью #1290).
 * Зеркало `platform_private.ai_agent_claude_usable`; решает всё равно база, это только вид интерфейса.
 */
export function aiAgentIsRunnable(sync: AiAgentSyncInfo): boolean {
  if (sync.status === "ok") return true;
  if (sync.status === "never") return false;
  return sync.claudeAgentId !== null && sync.agentVersion !== null && sync.environmentId !== null && sync.vaultId !== null;
}

/** Строка о незавершённой или неудавшейся синхронизации у включённого агента; null — нечего сказать. */
export function aiAgentSyncProblemText(sync: AiAgentSyncInfo): string | null {
  if (sync.status !== "error" && sync.status !== "pending") return null;
  const runnable = aiAgentIsRunnable(sync);
  const version = sync.agentVersion !== null ? ` (версия ${sync.agentVersion})` : "";
  if (sync.status === "error") {
    const head = `Синхронизация с Claude не удалась${sync.error ? `: ${sync.error}` : ""}.`;
    return runnable
      ? `${head} Агент продолжает работать по прежней настройке${version}. Повторите синхронизацию.`
      : `${head} Агент не запустится, пока синхронизация не пройдёт.`;
  }
  return runnable
    ? `Синхронизация с Claude не завершена. Агент работает по прежней настройке${version}; повторите синхронизацию, если она сейчас не идёт.`
    : "Синхронизация с Claude не завершена, агент пока не запустится. Повторите синхронизацию, если она сейчас не идёт.";
}

/** Хеш настроек, отправленных в Claude, не совпал с текущим: изменения «не отправлены». */
export function aiAgentNeedsSync(syncStatus: AiAgentSyncInfo["status"], storedHash: string | null, currentHash: string | null): boolean {
  return syncStatus === "ok" && storedHash !== null && currentHash !== null && storedHash !== currentHash;
}

/** Тон чипа статуса запуска: красный только у ошибки, жёлтый — «нужно внимание». */
export function runStatusTone(status: AiAgentRunRow["status"]): AiAgentChipTone {
  switch (status) {
    case "completed": return "ok";
    case "failed": return "danger";
    case "starting":
    case "running": return "info";
    case "budget_reached":
    case "needs_attention": return "warn";
    default: return "neutral";
  }
}

export function successShare(stats: Pick<AiAgentStats, "runs7d" | "failed7d">): number | null {
  if (stats.runs7d <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(((stats.runs7d - stats.failed7d) / stats.runs7d) * 100)));
}

export const pluralRu = (count: number, forms: readonly [string, string, string]): string => {
  const n = Math.abs(count) % 100;
  const last = n % 10;
  return n > 10 && n < 20 ? forms[2] : last === 1 ? forms[0] : last >= 2 && last <= 4 ? forms[1] : forms[2];
};

/* ----------------------------------------------------------------- графики */

export type ChartBarRow = Readonly<{ date: string; label: string; value: number; failed: number }>;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Ряд по дням без дыр: дни, которых нет в ответе, — нули (честная ось, а не
 * склейка соседей). Не больше `limit` последних дней.
 */
export function chartBarRows(
  points: readonly AiAgentChartPoint[],
  field: "count" | "costCents",
  limit = 30,
): readonly ChartBarRow[] {
  const sorted = [...points].filter((point) => /^\d{4}-\d{2}-\d{2}$/u.test(point.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];
  const byDate = new Map(sorted.map((point) => [point.date, point]));
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const rows: ChartBarRow[] = [];
  for (let date = first, guard = 0; date <= last && guard < 400; date = addDays(date, 1), guard += 1) {
    const point = byDate.get(date);
    rows.push({
      date,
      label: formatDayRu(date),
      value: field === "count" ? point?.count ?? 0 : point?.costCents ?? 0,
      failed: field === "count" ? Math.min(point?.failed ?? 0, point?.count ?? 0) : 0,
    });
  }
  return rows.slice(-limit);
}

/** Верх оси: чётный, чтобы середина была целой (0, N/2, N). */
export function chartAxisTop(max: number): number {
  const safe = Math.max(1, Math.ceil(max));
  if (safe <= 10) return Math.ceil(safe / 2) * 2;
  const step = 10 ** Math.floor(Math.log10(safe));
  return Math.ceil(safe / step) * step;
}

export type ChartHorizontalRow = Readonly<{ tool: string; label: string; count: number }>;

/** Горизонтальные столбики «что делает агент»: русские названия инструментов, по убыванию. */
export function chartToolRows(items: readonly Readonly<{ tool: string; count: number }>[], limit = 12): readonly ChartHorizontalRow[] {
  return [...items]
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))
    .slice(0, limit)
    .map((item) => ({ tool: item.tool, label: AI_AGENT_TOOL_LABELS[item.tool] ?? item.tool, count: item.count }));
}

/** Три подписи оси дат: первая, средняя и последняя (на узком экране — две). */
export function chartDateTicks(rows: readonly ChartBarRow[]): readonly Readonly<{ index: number; label: string }>[] {
  if (rows.length === 0) return [];
  const last = rows.length - 1;
  const picks = rows.length >= 10 ? [0, Math.floor(last / 2), last] : rows.length > 1 ? [0, last] : [0];
  return picks.map((index) => ({ index, label: rows[index].label }));
}

/* ---------------------------------------------------------- метрики отчёта */

export type DigestKpi = Readonly<{ label: string; value: string; unit: string | null }>;
export type DigestSeries = Readonly<{ label: string; ticks: readonly string[]; values: readonly number[] }>;
export type DigestMetrics = Readonly<{ kpis: readonly DigestKpi[]; series: readonly DigestSeries[] }>;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Форма `{kpis:[{label,value,unit?}], series:[{label, points:[{x,y}]}]}` проверяется при показе: лишнее и кривое отбрасывается. */
export function parseDigestMetrics(metrics: Readonly<Record<string, unknown>> | null): DigestMetrics {
  const kpis: DigestKpi[] = [];
  const series: DigestSeries[] = [];
  if (!metrics) return { kpis, series };
  if (Array.isArray(metrics.kpis)) {
    for (const item of metrics.kpis.slice(0, 8)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const value = typeof row.value === "number" && Number.isFinite(row.value)
        ? row.value.toLocaleString("ru-RU") : typeof row.value === "string" ? row.value.trim() : "";
      if (typeof row.label !== "string" || !row.label.trim() || !value) continue;
      kpis.push({ label: clip(row.label.trim(), 60), value: clip(value, 24), unit: typeof row.unit === "string" && row.unit.trim() ? clip(row.unit.trim(), 12) : null });
    }
  }
  if (Array.isArray(metrics.series)) {
    for (const item of metrics.series.slice(0, 3)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.label !== "string" || !row.label.trim() || !Array.isArray(row.points)) continue;
      const ticks: string[] = [];
      const values: number[] = [];
      for (const point of row.points.slice(0, 60)) {
        if (!point || typeof point !== "object") continue;
        const { x, y } = point as Record<string, unknown>;
        if (typeof y !== "number" || !Number.isFinite(y) || (typeof x !== "string" && typeof x !== "number")) continue;
        ticks.push(typeof x === "string" && /^\d{4}-\d{2}-\d{2}/u.test(x) ? formatDayRu(x) : clip(String(x), 12));
        values.push(y);
      }
      if (values.length >= 2) series.push({ label: clip(row.label.trim(), 40), ticks, values });
    }
  }
  return { kpis, series };
}

/* --------------------------------------------------------- безопасный Markdown */

export type MdInline =
  | Readonly<{ t: "text"; text: string }>
  | Readonly<{ t: "strong" | "em"; children: readonly MdInline[] }>
  | Readonly<{ t: "code"; text: string }>
  | Readonly<{ t: "link"; href: string; children: readonly MdInline[] }>;
export type MdBlock =
  | Readonly<{ t: "heading"; level: 2 | 3 | 4; children: readonly MdInline[] }>
  | Readonly<{ t: "paragraph"; children: readonly MdInline[] }>
  | Readonly<{ t: "list"; ordered: boolean; items: readonly (readonly MdInline[])[] }>
  | Readonly<{ t: "quote"; children: readonly MdInline[] }>
  | Readonly<{ t: "code"; text: string }>
  | Readonly<{ t: "rule" }>
  | Readonly<{ t: "table"; head: readonly (readonly MdInline[])[]; rows: readonly (readonly (readonly MdInline[])[])[] }>;

const SAFE_LINK = /^https?:\/\/[^\s<>"']+$/iu;

/** Строчная разметка: **жирный**, *курсив*, `код`, [текст](https://…). Другие ссылки и HTML — обычным текстом. */
export function parseMarkdownInline(source: string, depth = 0): readonly MdInline[] {
  const out: MdInline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ t: "text", text }); text = ""; } };
  for (let i = 0; i < source.length;) {
    const rest = source.slice(i);
    let match: RegExpExecArray | null;
    if ((match = /^`([^`\n]+)`/u.exec(rest))) { flush(); out.push({ t: "code", text: match[1] }); i += match[0].length; continue; }
    if (depth < 3 && (match = /^\*\*([^\n]+?)\*\*/u.exec(rest))) { flush(); out.push({ t: "strong", children: parseMarkdownInline(match[1], depth + 1) }); i += match[0].length; continue; }
    if (depth < 3 && (match = /^(?:\*([^*\s][^*\n]*?)\*|_([^_\s][^_\n]*?)_)(?![\p{L}\p{N}])/u.exec(rest))) {
      flush(); out.push({ t: "em", children: parseMarkdownInline(match[1] ?? match[2], depth + 1) }); i += match[0].length; continue;
    }
    if (depth < 3 && (match = /^\[([^\]\n]+)\]\(([^)\s]+)\)/u.exec(rest))) {
      if (SAFE_LINK.test(match[2])) { flush(); out.push({ t: "link", href: match[2], children: parseMarkdownInline(match[1], depth + 1) }); }
      else text += match[1];
      i += match[0].length; continue;
    }
    text += source[i];
    i += 1;
  }
  flush();
  return out;
}

const splitRow = (line: string): string[] => line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cell.trim());
const isTableRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/u.test(line) && line.includes("-");

/** Блоки: заголовки, абзацы, списки, цитата, код, линия, таблица. Любой HTML остаётся текстом: React его не исполнит. */
export function parseMarkdown(source: string): readonly MdBlock[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ t: "paragraph", children: parseMarkdownInline(paragraph.join(" ")) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    if (/^\s*```/u.test(line)) {
      flushParagraph();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/u.test(lines[i])) { code.push(lines[i]); i += 1; }
      blocks.push({ t: "code", text: code.join("\n") });
      continue;
    }
    if (line.trim() === "") { flushParagraph(); continue; }
    if ((match = /^(#{1,4})\s+(.+?)\s*#*\s*$/u.exec(line))) {
      flushParagraph();
      blocks.push({ t: "heading", level: Math.min(4, Math.max(2, match[1].length + 1)) as 2 | 3 | 4, children: parseMarkdownInline(match[2]) });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/u.test(line)) { flushParagraph(); blocks.push({ t: "rule" }); continue; }
    if (line.includes("|") && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      flushParagraph();
      const head = splitRow(line).map((cell) => parseMarkdownInline(cell));
      const rows: (readonly MdInline[])[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]).map((cell) => parseMarkdownInline(cell)));
        i += 1;
      }
      i -= 1;
      blocks.push({ t: "table", head, rows });
      continue;
    }
    if ((match = /^\s*(?:([-*+])|(\d{1,3})[.)])\s+(.+)$/u.exec(line))) {
      flushParagraph();
      const ordered = match[2] !== undefined;
      const items: (readonly MdInline[])[] = [parseMarkdownInline(match[3])];
      while (i + 1 < lines.length) {
        const next = /^\s*(?:([-*+])|(\d{1,3})[.)])\s+(.+)$/u.exec(lines[i + 1]);
        if (!next || (next[2] !== undefined) !== ordered) break;
        items.push(parseMarkdownInline(next[3]));
        i += 1;
      }
      blocks.push({ t: "list", ordered, items });
      continue;
    }
    if ((match = /^>\s?(.*)$/u.exec(line))) {
      flushParagraph();
      const quote = [match[1]];
      while (i + 1 < lines.length && /^>\s?/u.test(lines[i + 1])) { i += 1; quote.push(lines[i].replace(/^>\s?/u, "")); }
      blocks.push({ t: "quote", children: parseMarkdownInline(quote.join(" ")) });
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

/* ------------------------------------------------------------ хроника агента */

const TOOL_PROGRESS: Readonly<Record<string, string>> = {
  search_clients: "Ищет клиента",
  get_client_card: "Открывает карточку клиента",
  list_leads: "Смотрит лиды",
  get_lead: "Читает лид",
  list_student_cases: "Смотрит дела студентов",
  get_case: "Читает дело студента",
  get_document_file: "Открывает документ студента",
  list_conversations: "Смотрит чаты WhatsApp",
  get_conversation: "Читает переписку WhatsApp",
  get_case_chat: "Читает чат со студентом",
  sales_report: "Считает отчёт продаж",
  payments_summary: "Смотрит платежи",
  funnel_stats: "Считает воронку",
  list_tasks: "Смотрит задачи",
  search_catalog: "Ищет в каталоге университетов",
  search_knowledge: "Ищет в базе знаний",
  recent_calls: "Смотрит звонки",
  list_staff: "Смотрит сотрудников",
  get_my_settings: "Читает свои настройки",
  create_task: "Создаёт задачу",
  add_note: "Добавляет заметку",
  send_message: "Пишет клиенту",
  post_digest: "Публикует отчёт",
  notify_staff: "Уведомляет сотрудников",
};

export const toolProgressWord = (tool: string): string => TOOL_PROGRESS[tool] ?? AI_AGENT_TOOL_LABELS[tool] ?? "Работает с инструментом";

export type ChatItem =
  | Readonly<{ id: string; at: string; kind: "user" | "agent"; text: string }>
  | Readonly<{ id: string; at: string; kind: "tool"; tool: string; word: string; label: string; argsSummary: string; builtin: boolean; state: "running" | "ok" | "error"; preview: string }>
  | Readonly<{ id: string; at: string; kind: "status"; text: string; tone: "neutral" | "ok" | "warn" }>
  | Readonly<{ id: string; at: string; kind: "error"; code: string; text: string }>;

const STOP_REASON_WORDS: Readonly<Record<string, string>> = {
  end_turn: "Готово",
  budget_reached: "Остановлен по лимиту расходов",
  requires_action: "Нужно внимание сотрудника",
};

/**
 * События сессии → строки хроники: результат инструмента склеивается со своим
 * вызовом (по порядку для одного инструмента), статусы — одной строкой слова,
 * расход (`usage`) в хронику не попадает — он в шапке запуска.
 */
export function buildChatItems(events: readonly AiAgentUiEvent[]): readonly ChatItem[] {
  const items: ChatItem[] = [];
  const open = new Map<string, number[]>();
  for (const event of events) {
    switch (event.kind) {
      case "user":
      case "agent":
        items.push({ id: event.id, at: event.at, kind: event.kind, text: event.text });
        break;
      case "tool_call": {
        open.set(event.tool, [...(open.get(event.tool) ?? []), items.length]);
        items.push({
          id: event.id, at: event.at, kind: "tool", tool: event.tool, word: event.builtin ? event.label : toolProgressWord(event.tool),
          label: event.label, argsSummary: event.argsSummary, builtin: event.builtin, state: "running", preview: "",
        });
        break;
      }
      case "tool_result": {
        const queue = open.get(event.tool) ?? open.get("инструмент") ?? [];
        const index = queue.shift();
        const prior = index === undefined ? undefined : items[index];
        if (prior && prior.kind === "tool") {
          items[index as number] = { ...prior, state: event.ok ? "ok" : "error", preview: event.preview };
        } else {
          items.push({
            id: event.id, at: event.at, kind: "tool", tool: event.tool, word: toolProgressWord(event.tool), label: AI_AGENT_TOOL_LABELS[event.tool] ?? event.tool,
            argsSummary: "", builtin: false, state: event.ok ? "ok" : "error", preview: event.preview,
          });
        }
        break;
      }
      case "status": {
        const text = event.status === "running" ? "Агент работает…"
          : event.status === "rescheduled" ? "Повторная попытка…"
            : event.status === "terminated" ? "Сеанс завершён"
              : STOP_REASON_WORDS[event.stopReason ?? "end_turn"] ?? "Агент закончил";
        const tone = event.status === "idle" && event.stopReason === "end_turn" ? "ok" : event.status === "idle" ? "warn" : "neutral";
        const prior = items[items.length - 1];
        if (!(prior && prior.kind === "status" && prior.text === text)) items.push({ id: event.id, at: event.at, kind: "status", text, tone });
        break;
      }
      case "error":
        items.push({ id: event.id, at: event.at, kind: "error", code: event.code, text: runErrorWords(event.code, event.message) });
        break;
      default:
        break;
    }
  }
  return items;
}

/** Агент ещё работает над поручением (`starting`/`running`); остальные статусы — разговор закончен или остановлен. */
export const aiAgentRunIsActive = (status: AiAgentRunStatus): boolean => status === "starting" || status === "running";

/**
 * Каким вкладка «Поручить» открывается на запуске, который она восстанавливает
 * (перезагрузка страницы посреди разговора или после него). Строится из строки
 * запуска в базе CRM, без Claude: серверная разметка сразу говорит правду —
 * идёт ли работа, какое было поручение, каков итог, — и не ждёт ни JS, ни
 * первого опроса. `seed` — заготовка хроники (поручение, итог, ошибка); как
 * только опрос принесёт настоящие события из Claude (с вызовами инструментов),
 * заготовка уступает им место. Переписка в базе не хранится: берутся только
 * `promptPreview` и `summary`, которые «Запуски» показывают и без того.
 */
export type AiAgentConsoleRestore = Readonly<{
  status: AiAgentRunStatus;
  working: boolean;
  seed: readonly AiAgentUiEvent[];
}>;

export function aiAgentConsoleRestore(
  run: Pick<AiAgentRunRow, "id" | "status" | "startedAt" | "endedAt" | "promptPreview" | "summary" | "errorCode" | "errorMessage">,
): AiAgentConsoleRestore {
  const working = aiAgentRunIsActive(run.status);
  const seed: AiAgentUiEvent[] = [];
  const prompt = run.promptPreview?.trim();
  if (prompt) seed.push({ id: `restore:${run.id}:user`, at: run.startedAt, kind: "user", text: prompt });
  if (!working) {
    const at = run.endedAt ?? run.startedAt;
    const answer = run.summary?.trim();
    if (answer) seed.push({ id: `restore:${run.id}:agent`, at, kind: "agent", text: answer });
    if (run.status === "failed") seed.push({ id: `restore:${run.id}:error`, at, kind: "error", code: run.errorCode ?? "failed", message: run.errorMessage ?? "" });
  }
  return { status: run.status, working, seed };
}

/* ------------------------------------- «Поручить»: разговоры, ход работы, ответы агента */

/**
 * Страница читает последние запуски агента (RPC без изменений, потолок 100) и
 * оставляет из них собственные `command`-разговоры сотрудника: так «Мои
 * разговоры» обходятся без новой выборки в базе. Запуски по расписанию, по
 * заявкам и чужие поручения остаются во вкладке «Запуски».
 */
export const AI_AGENT_CONVERSATIONS_READ = 60;
export const AI_AGENT_CONVERSATIONS_MAX = 20;

/** Поля запуска, которых хватает списку разговоров, восстановлению и строке итога под ответом. */
export type AiAgentConversationRow = Pick<
  AiAgentRunRow,
  "id" | "status" | "startedAt" | "endedAt" | "durationSeconds" | "promptPreview" | "summary" | "errorCode" | "errorMessage" | "costCents" | "actionsCount" | "sendAuthority"
>;

const byStartedDesc = (a: Pick<AiAgentRunRow, "startedAt">, b: Pick<AiAgentRunRow, "startedAt">) => Date.parse(b.startedAt) - Date.parse(a.startedAt);

/** Только поля разговора: сессия Claude, токены и имя в разметку клиента не уходят. */
export const toConversationRow = (run: AiAgentConversationRow): AiAgentConversationRow => ({
  id: run.id, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt, durationSeconds: run.durationSeconds,
  promptPreview: run.promptPreview, summary: run.summary, errorCode: run.errorCode, errorMessage: run.errorMessage,
  costCents: run.costCents, actionsCount: run.actionsCount, sendAuthority: run.sendAuthority,
});

/** Свои поручения сотрудника этому агенту: тот же признак, что у восстановления («command» и его имя), новые выше. */
export function ownCommandRuns(runs: readonly AiAgentRunRow[], displayName: string, limit = AI_AGENT_CONVERSATIONS_MAX): readonly AiAgentConversationRow[] {
  if (!displayName.trim()) return [];
  return runs
    .filter((run) => run.triggerKind === "command" && run.startedByName === displayName)
    .sort(byStartedDesc)
    .slice(0, limit)
    .map(toConversationRow);
}

/** То, что опрос узнаёт о разговоре по ходу работы; остальное в строке списка не меняется. */
export type AiAgentConversationPatch = Pick<AiAgentConversationRow, "status" | "endedAt" | "durationSeconds" | "summary" | "errorCode" | "errorMessage" | "costCents" | "actionsCount" | "sendAuthority">;

export const conversationPatch = (run: AiAgentConversationRow): AiAgentConversationPatch => ({
  status: run.status, endedAt: run.endedAt, durationSeconds: run.durationSeconds, summary: run.summary, errorCode: run.errorCode,
  errorMessage: run.errorMessage, costCents: run.costCents, actionsCount: run.actionsCount, sendAuthority: run.sendAuthority,
});

export function conversationPatchChanged(previous: AiAgentConversationPatch | undefined, next: AiAgentConversationPatch): boolean {
  if (!previous) return true;
  return (Object.keys(next) as (keyof AiAgentConversationPatch)[]).some((field) => previous[field] !== next[field]);
}

/**
 * Список «Мои разговоры»: строки сервера, разговор, начатый в этой вкладке и ещё не
 * дошедший до сервера (он выше всех: он заведомо новее), и то, что опрос
 * узнал после чтения страницы. Закончившийся по данным сервера разговор не
 * «оживает» устаревшей строкой опроса: вкладка могла уйти с него раньше, чем
 * опрос увидел конец. Исключение — открытый сейчас разговор (`liveId`): его
 * опрос идёт прямо сейчас, и продолжение закончившегося разговора («Идёт») в строке
 * сервера, прочитанной до него, не отражено.
 */
export function mergeConversations(
  server: readonly AiAgentConversationRow[],
  local: Readonly<Record<string, AiAgentConversationRow>>,
  patches: Readonly<Record<string, AiAgentConversationPatch>>,
  limit = AI_AGENT_CONVERSATIONS_MAX,
  liveId: string | null = null,
): readonly AiAgentConversationRow[] {
  const known = new Set(server.map((row) => row.id));
  const apply = (row: AiAgentConversationRow, authoritative: boolean): AiAgentConversationRow => {
    const patch = patches[row.id];
    if (!patch) return row;
    if (authoritative && !aiAgentRunIsActive(row.status) && aiAgentRunIsActive(patch.status)) return row;
    return { ...row, ...patch };
  };
  const fresh = Object.values(local).filter((row) => !known.has(row.id)).sort(byStartedDesc).map((row) => apply(row, false));
  const rows = [...server].sort(byStartedDesc).map((row) => apply(row, row.id !== liveId));
  return [...fresh, ...rows].slice(0, limit);
}

/** «Сегодня 10:42», «Вчера 18:05», «21 окт 09:10» (Бишкек); другой год — с годом. */
export function conversationTimeRu(iso: string, nowIso: string): string {
  const at = zoned(iso);
  if (!at) return "—";
  const clock = `${two(at.h)}:${two(at.mi)}`;
  const now = zoned(nowIso);
  if (!now) return formatDateTimeRu(iso);
  const days = Math.round((Date.UTC(now.y, now.mo - 1, now.d) - Date.UTC(at.y, at.mo - 1, at.d)) / 86_400_000);
  if (days === 0) return `Сегодня ${clock}`;
  if (days === 1) return `Вчера ${clock}`;
  return `${at.d} ${MONTHS_SHORT[at.mo - 1]}${now.y !== at.y ? ` ${at.y}` : ""} ${clock}`;
}

export type ConversationStatusWord = Readonly<{ word: string; tone: "working" | "danger" | "warn" | "neutral" }>;

/** Слово состояния разговора в списке; обычный «Готово» не подписывается — тишина значит «всё хорошо». */
export function conversationStatusWord(status: AiAgentRunStatus): ConversationStatusWord | null {
  switch (status) {
    case "starting":
    case "running": return { word: "Идёт", tone: "working" };
    case "failed": return { word: "Ошибка", tone: "danger" };
    case "interrupted": return { word: "Остановлен", tone: "neutral" };
    case "budget_reached": return { word: "Лимит", tone: "warn" };
    case "needs_attention": return { word: "Нужно внимание", tone: "warn" };
    default: return null;
  }
}

export const conversationPrompt = (row: Pick<AiAgentConversationRow, "promptPreview">): string => row.promptPreview?.trim() || "Разговор без текста";

export const lowerFirst = (value: string): string => (value ? value.charAt(0).toLowerCase() + value.slice(1) : value);

export type ToolChatItem = Extract<ChatItem, { kind: "tool" }>;
export type ChatBlock =
  | Exclude<ChatItem, { kind: "tool" }>
  | Readonly<{ id: string; at: string; kind: "steps"; steps: readonly ToolChatItem[] }>;

/**
 * Подряд идущие вызовы инструментов — один блок «Ход работы»: переписка
 * читается как реплики, а не как лента вызовов. Блок получает id первого
 * вызова, поэтому растущая группа остаётся тем же элементом (раскрытие не слетает).
 */
export function groupChatItems(items: readonly ChatItem[]): readonly ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let steps: ToolChatItem[] | null = null;
  for (const item of items) {
    if (item.kind !== "tool") { steps = null; blocks.push(item); continue; }
    if (!steps) {
      steps = [];
      blocks.push({ id: item.id, at: item.at, kind: "steps", steps });
    }
    steps.push(item);
  }
  return blocks;
}

/**
 * Строка свёрнутого блока: «Ход работы · 5 шагов» или, пока он идёт, «Ход работы · шаг 3 · ищет клиента…»;
 * ошибки — отдельным словом. Вызов без ответа у закончившегося запуска (работа прервана) «идущим» не считается.
 */
export function stepsSummary(steps: readonly ToolChatItem[], working = true): Readonly<{ title: string; errors: string | null; running: boolean }> {
  const lastRunning = working ? steps.findLastIndex((step) => step.state === "running") : -1;
  const failed = steps.filter((step) => step.state === "error").length;
  const title = lastRunning >= 0
    ? `Ход работы · шаг ${lastRunning + 1} · ${lowerFirst(steps[lastRunning].word)}…`
    : `Ход работы · ${steps.length} ${pluralRu(steps.length, ["шаг", "шага", "шагов"])}`;
  return { title, errors: failed > 0 ? `${failed} ${pluralRu(failed, ["ошибка", "ошибки", "ошибок"])}` : null, running: lastRunning >= 0 };
}

/**
 * Слово инструмента, который выполняется сейчас (последний из идущих); null — агент думает.
 * Ищется только в последнем обороте (после сообщения сотрудника): вызов без ответа из
 * прерванного раньше оборота «идущим» не считается.
 */
export function runningToolWord(items: readonly ChatItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "user") return null;
    if (item.kind === "tool" && item.state === "running") return item.word;
  }
  return null;
}

/** «0:12», «3:05», «1:02:03». */
export function elapsedClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours}:${two(minutes)}:${two(total % 60)}` : `${minutes}:${two(total % 60)}`;
}

/** «12 с · 0,11 $ · 5 шагов» под последним ответом закончившегося запуска; чего нет в строке запуска, того нет и в строке. */
export function answerRunMeta(
  run: Pick<AiAgentConversationRow, "startedAt" | "endedAt" | "durationSeconds" | "costCents" | "actionsCount">,
  toolSteps: number,
): string {
  const seconds = run.durationSeconds
    ?? (run.endedAt ? Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000)) : null);
  const parts: string[] = [];
  if (seconds !== null && Number.isFinite(seconds)) parts.push(durationWords(seconds));
  if (run.costCents > 0) parts.push(formatUsdCents(run.costCents));
  const steps = toolSteps > 0 ? toolSteps : run.actionsCount;
  if (steps > 0) parts.push(`${steps} ${pluralRu(steps, ["шаг", "шага", "шагов"])}`);
  return parts.join(" · ");
}

/**
 * Название задачи из ответа агента: первая содержательная строка без разметки
 * (заголовок, список, цитата, ссылка, выделение, кодовые блоки и линии
 * пропускаются), не длиннее `max` знаков. Пусто — в ответе нет текста.
 */
export function answerTaskTitle(markdown: string, max = 120): string {
  let fenced = false;
  for (const raw of markdown.split(/\r?\n/u)) {
    const line = raw.trim();
    if (/^(```|~~~)/u.test(line)) { fenced = !fenced; continue; }
    if (fenced || !line) continue;
    if (/^([-*_]\s*){3,}$/u.test(line) || (/^[\s|:-]+$/u.test(line) && line.includes("-"))) continue;
    const plain = line
      .replace(/^#{1,6}\s+/u, "")
      .replace(/^>\s?/u, "")
      .replace(/^(?:[-*+]|\d{1,3}[.)])\s+/u, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/\*\*(.+?)\*\*|__(.+?)__/gu, "$1$2")
      .replace(/\*(.+?)\*|(?<![\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])/gu, "$1$2")
      .replace(/`([^`]*)`/gu, "$1")
      .replace(/\|/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (plain) return clip(plain, max);
  }
  return "";
}

/**
 * Однострочный текст из Markdown для списков: заголовки, списки, цитаты, выделение,
 * ссылки и кодовые блоки теряют разметку, строка таблицы читается «Ячейка · Ячейка»,
 * линейки и разделители таблиц пропускаются. Пусто — в тексте нет слов.
 */
export function plainPreview(markdown: string | null | undefined, max = 200): string {
  if (!markdown) return "";
  const parts: string[] = [];
  let fenced = false;
  for (const raw of markdown.split(/\r?\n/u)) {
    const line = raw.trim();
    if (/^(```|~~~)/u.test(line)) { fenced = !fenced; continue; }
    if (fenced || !line) continue;
    if (/^([-*_]\s*){3,}$/u.test(line) || (/^[\s|:-]+$/u.test(line) && line.includes("-"))) continue;
    let text = line;
    if (text.startsWith("|")) text = text.replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim()).filter(Boolean).join(" · ");
    const plain = text
      .replace(/^#{1,6}\s+/u, "")
      .replace(/^>\s?/u, "")
      .replace(/^(?:[-*+]|\d{1,3}[.)])\s+/u, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/\*\*(.+?)\*\*|__(.+?)__/gu, "$1$2")
      .replace(/\*(.+?)\*|(?<![\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])/gu, "$1$2")
      .replace(/`([^`]*)`/gu, "$1")
      .replace(/\s+/gu, " ")
      .trim();
    if (plain) parts.push(plain);
    if (parts.join(" ").length > max) break;
  }
  return clip(parts.join(" "), max);
}

/** Роль агента без состояния: в сиде есть хвост «: инструкции пока нет, агент выключен» — состояние показывают чипы, а не описание. */
export const aiAgentRoleLine = (roleLine: string): string => roleLine.replace(/:\s*инструкции пока нет, агент выключен\.?$/iu, "");

/** Кто запустил: своё поручение — «Вы», чужое — имя, остальное — повод запуска («По расписанию», «Новая заявка с сайта»). */
export function runOriginLabel(run: Pick<AiAgentRunRow, "triggerKind" | "startedByName">, viewerName?: string | null): string {
  if (run.triggerKind !== "command") return AI_AGENT_TRIGGER_LABELS[run.triggerKind];
  if (!run.startedByName) return "Сотрудник";
  return viewerName && run.startedByName === viewerName ? "Вы" : run.startedByName;
}

/** Время в ряду действий запуска: в тот же день, что и начало, — только «12:35», иначе дата и время. */
export function formatClockRu(iso: string | null, referenceIso: string): string {
  const at = iso ? zoned(iso) : null;
  const ref = zoned(referenceIso);
  if (!at) return "—";
  if (ref && ref.y === at.y && ref.mo === at.mo && ref.d === at.d) return `${two(at.h)}:${two(at.mi)}`;
  return formatDateTimeRu(iso);
}

/** Слова для кодов ошибок инструментов (`error_code` в журнале действий): без `not_found` и `invalid_arguments` на экране. */
export const AI_AGENT_TOOL_ERROR_WORDS: Readonly<Record<string, string>> = {
  invalid_arguments: "неверные данные",
  not_found: "не найдено",
  forbidden: "нет доступа",
  agent_disabled: "агент выключен",
  rate_limited: "лимит запросов",
  conflict: "данные изменились",
  whatsapp_unavailable: "WhatsApp не подключён",
  conversation_moved_on: "клиент написал ещё",
  conversation_closed: "диалог закрыт",
  target_not_found: "адресат не найден",
  text_invalid: "неверный текст",
  no_inbound_message: "нет входящего сообщения",
  too_large: "слишком большой ответ",
  unavailable: "сервис недоступен",
  internal_error: "внутренняя ошибка",
};
export const toolErrorWords = (code: string): string => AI_AGENT_TOOL_ERROR_WORDS[code] ?? "ошибка";

/** Запрос действия для людей: служебный `dedupe_key` (ключ защиты от повтора) не показывается. */
export function actionArgsWords(summary: string | null | undefined): string {
  if (!summary) return "";
  return summary.split(/;\s*/u).filter((part) => part && !/^dedupe_key=/u.test(part)).join("; ");
}

/** Готовые первые поручения во вкладке «Поручить»: подставляются в поле, отправляет сотрудник. */
export const AI_AGENT_STARTERS: Readonly<Record<AiAgentKey, readonly string[]>> = {
  director: [
    "Подготовь недельный отчёт за прошлую неделю",
    "Сколько заявок пришло за последние 7 дней и откуда?",
  ],
  sales: [
    "Покажи неотвеченные чаты WhatsApp и подготовь ответы",
    "Разбери новые заявки с сайта за сегодня",
  ],
  "curator-cn": ["У каких студентов просрочены документы или задачи?"],
  "curator-my": ["У каких студентов просрочены документы или задачи?"],
  "curator-eu": ["У каких студентов просрочены документы или задачи?"],
  "curator-ae": ["У каких студентов просрочены документы или задачи?"],
  "curator-tr": ["У каких студентов просрочены документы или задачи?"],
};

/* ----------------------------------------------------------------- слова ошибок */

const RUN_ERROR_WORDS: Readonly<Record<string, string>> = {
  mcp_auth_failed: "Токен доступа агента к CRM не принят — администратору нужно обновить токен в настройках агента.",
  mcp_authentication_failed_error: "Токен доступа агента к CRM не принят — администратору нужно обновить токен в настройках агента.",
  mcp_unreachable: "Агент не смог достучаться до CRM — проверьте адрес MCP и IP-фильтр.",
  mcp_connection_failed_error: "Агент не смог достучаться до CRM — проверьте адрес MCP и IP-фильтр.",
  start_lost: "Запуск не получил подтверждения от Claude — сессия могла начаться. Проверьте, не работает ли агент, прежде чем повторять поручение.",
  create_unconfirmed: "Claude не подтвердил создание сессии — она могла запуститься. Проверьте, не работает ли агент, прежде чем повторять поручение.",
  session_unlinked: "Сессия Claude создана, но запуск не записан в CRM. Приложение остановило сессию; не остановилась — остановите её в Console Claude.",
  deployment_paused: "Расписание агента стоит на паузе в Claude. Устраните причину и нажмите «Синхронизировать с Claude» на странице агента.",
  terminated: "Сеанс Claude завершился с ошибкой.",
  budget: "Запуск остановлен по лимиту расходов.",
  budget_reached: "Запуск остановлен по лимиту расходов.",
  rate_limited: "Claude временно ограничил число запросов.",
  anthropic_error: "Claude ответил ошибкой.",
  api_key_missing: "Ключ Claude API не задан в CRM.",
  interrupted: "Запуск остановлен сотрудником.",
};

/** Коды, у которых текст из строки запуска точнее общего слова (приложение пишет его само, без данных клиентов). */
const RUN_ERROR_MESSAGE_FIRST: ReadonlySet<string> = new Set(["session_unlinked", "deployment_paused"]);

/**
 * Сбои с неизвестным исходом: сессия в Claude могла начаться (ответ на создание потерян, запуск не записан, связь
 * оборвалась при старте). Повтор одним нажатием здесь не предлагаем — сначала проверить, не работает ли агент.
 */
export const AI_AGENT_AMBIGUOUS_RUN_ERRORS: ReadonlySet<string> = new Set(["start_lost", "create_unconfirmed", "session_unlinked"]);

export function runErrorWords(code: string | null, message?: string | null): string {
  const own = message?.trim();
  if (code && own && RUN_ERROR_MESSAGE_FIRST.has(code)) return clip(own, 300);
  if (code && RUN_ERROR_WORDS[code]) return RUN_ERROR_WORDS[code];
  const detail = message?.trim();
  return detail ? `Ошибка запуска: ${clip(detail, 200)}` : "Запуск завершился ошибкой.";
}

/** Русские фразы для результата действия; коды — в «подробностях», а не в тексте. */
export const AI_AGENTS_ERROR_COPY: Readonly<Record<string, string>> = {
  forbidden: "Нет права на это действие.",
  preview_read_only: "В просмотре роли действия отключены.",
  api_key_missing: "Ключ Claude API не задан в CRM — его добавляет администратор.",
  agent_disabled: "Агент выключен — включите его в настройках.",
  agent_not_synced: "Агент ещё не синхронизирован с Claude — администратор нажимает «Синхронизировать с Claude» в настройках.",
  run_in_progress: "Агент уже работает над поручением — дождитесь конца.",
  invalid_input: "Проверьте данные и повторите.",
  invalid_patch: "Проверьте значения настроек и повторите.",
  duplicate: "Это поручение уже отправлено.",
  anthropic_error: "Claude ответил ошибкой — попробуйте позже.",
  rate_limited: "Claude временно ограничил запросы — повторите через минуту.",
  unavailable: "Результат пока неизвестен — безопасно повторите.",
  session_unlinked: "Сессия Claude создана, но запуск не записан в CRM. Проверьте раздел «Запуски» и повторите поручение.",
  create_unconfirmed: "Claude не подтвердил создание сессии — она могла запуститься. Проверьте раздел «Запуски» и повторите позже.",
  instructions_empty: "Инструкции пока нет — напишите её во вкладке «Инструкция».",
  not_pending: "Черновик уже обработан или устарел.",
  version_conflict: "Настройки уже изменились — обновите страницу.",
  request_conflict: "Запрос уже выполнен с другими данными — обновите страницу.",
  not_found: "Не найдено.",
  conflict: "Данные уже изменились — обновите страницу.",
  not_ready: "Раздел готовится: база ещё не обновлена.",
};

export const aiAgentsErrorCopy = (code: string | null | undefined): string => (code && AI_AGENTS_ERROR_COPY[code]) || AI_AGENTS_ERROR_COPY.unavailable;

/** Сообщение исключения базы (`ai_agent_forbidden`, `agent_disabled`…) → код действия. */
export function mapAiAgentsDbError(error: Readonly<{ code?: string | null; message?: string | null }> | null | undefined): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "PGRST202" || code === "42883" || /ai_agents_[a-z_]+_v1|ai_agent_[a-z_]+_v1/u.test(message) && /could not find the function|does not exist/iu.test(message)) return "not_ready";
  const table: readonly (readonly [RegExp, string])[] = [
    [/ai_agent_forbidden/u, "forbidden"],
    [/ai_agent_version_conflict/u, "version_conflict"],
    [/ai_agent_request_conflict/u, "request_conflict"],
    [/ai_agent_not_found/u, "not_found"],
    [/ai_agent_invalid_patch/u, "invalid_patch"],
    [/ai_agent_draft_not_pending/u, "not_pending"],
    [/agent_not_synced/u, "agent_not_synced"],
    [/agent_disabled/u, "agent_disabled"],
    [/run_in_progress/u, "run_in_progress"],
  ];
  for (const [pattern, mapped] of table) if (pattern.test(message)) return mapped;
  if (code === "42501") return "forbidden";
  if (code === "P0002") return "not_found";
  if (code === "40001") return "version_conflict";
  return "unavailable";
}

export type AiAgentsActionState = Readonly<{
  status: "idle" | "saved" | "failed";
  code: string | null;
  message: string | null;
  requestId: string | null;
  runId?: string | null;
  warnings?: readonly string[];
  /** Итог решения по черновику: статус после попытки отправки и слово причины. */
  draftStatus?: AiAgentDraftStatus;
  failureCode?: string | null;
}>;
export const AI_AGENTS_IDLE: AiAgentsActionState = { status: "idle", code: null, message: null, requestId: null };

/* ----------------------------------------------------------- черновики (слова) */

export function draftStatusWords(draft: Pick<AiAgentDraftRow, "status" | "failureCode" | "sentByAgent">): Readonly<{ label: string; tone: AiAgentChipTone; note: string | null }> {
  const failure = draft.failureCode ? (AI_AGENTS_DRAFT_FAILURE_WORDS[draft.failureCode] ?? null) : null;
  switch (draft.status) {
    case "pending":
      return { label: "Ждёт решения", tone: "warn", note: failure ? `Остаётся в очереди: ${failure}` : null };
    case "approved":
    case "sending":
      return { label: "Отправляется", tone: "info", note: null };
    case "sent":
      return { label: "Отправлен", tone: "ok", note: draft.sentByAgent ? "Агент отправил сам (Авто)" : null };
    case "discarded":
      return { label: "Отклонён", tone: "neutral", note: null };
    case "failed":
      return { label: "Не отправлен", tone: "danger", note: failure ? `Не отправлено: ${failure}` : "Не отправлено" };
    case "expired":
      return { label: "Устарел", tone: "neutral", note: "Срок черновика вышел" };
  }
}

/** Слова для `failure_code` (дубль `AI_AGENT_DRAFT_FAILURE_LABELS` с нижним регистром, чтобы фраза читалась в середине предложения). */
export const AI_AGENTS_DRAFT_FAILURE_WORDS: Readonly<Record<string, string>> = {
  whatsapp_unavailable: "WhatsApp сейчас не подключён",
  conversation_moved_on: "клиент написал ещё — ответ устарел",
  conversation_closed: "диалог закрыт",
  target_not_found: "адресат не найден",
  rate_limited: "достигнут лимит отправки",
  staff_active: "в чате уже отвечает сотрудник",
  unknown_result: "итог отправки неизвестен — проверьте чат",
  provider_error: "ошибка WhatsApp",
  sender_unavailable: "отправитель не может писать в этот чат",
};

export function draftTargetHref(draft: Pick<AiAgentDraftRow, "channel" | "conversationId" | "studentCaseId">): string | null {
  if (draft.channel === "whatsapp" && draft.conversationId && isAiAgentUuid(draft.conversationId)) return `/v3/inbox?conversation=${draft.conversationId}`;
  if (draft.channel === "portal" && draft.studentCaseId && isAiAgentUuid(draft.studentCaseId)) return `/v3/messages?case=${draft.studentCaseId}`;
  return null;
}

/* ------------------------------------------------------- разбор ответов RPC */

export class AiAgentsShapeError extends Error {
  constructor(path: string) {
    super(`ai_agents_shape:${path}`);
    this.name = "AiAgentsShapeError";
  }
}

const bad = (path: string): never => { throw new AiAgentsShapeError(path); };
const rec = (value: unknown, path: string): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : bad(path);
const arr = (value: unknown, path: string): unknown[] => (Array.isArray(value) ? value : bad(path));
const str = (value: unknown, path: string): string => (typeof value === "string" ? value : bad(path));
const strN = (value: unknown, path: string): string | null => (value === null || value === undefined ? null : str(value, path));
const num = (value: unknown, path: string): number =>
  typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : bad(path);
const numN = (value: unknown, path: string): number | null => (value === null || value === undefined ? null : num(value, path));
const bool = (value: unknown, path: string): boolean => (typeof value === "boolean" ? value : bad(path));
function oneOf<T extends string>(value: unknown, list: readonly T[], path: string): T {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? value as T : bad(path);
}

function parseSync(raw: unknown, path: string): AiAgentSyncInfo {
  const row = rec(raw, path);
  return {
    status: oneOf(row.status, AI_AGENT_SYNC_STATUSES, `${path}.status`),
    error: strN(row.error, `${path}.error`),
    syncedAt: strN(row.syncedAt, `${path}.syncedAt`),
    agentVersion: numN(row.agentVersion, `${path}.agentVersion`),
    claudeAgentId: strN(row.claudeAgentId, `${path}.claudeAgentId`),
    environmentId: strN(row.environmentId, `${path}.environmentId`),
    vaultId: strN(row.vaultId, `${path}.vaultId`),
    deploymentId: strN(row.deploymentId, `${path}.deploymentId`),
    configHash: strN(row.configHash, `${path}.configHash`),
    mcpUrl: strN(row.mcpUrl, `${path}.mcpUrl`),
    tokenFingerprint: strN(row.tokenFingerprint, `${path}.tokenFingerprint`),
    tokenRotatedAt: strN(row.tokenRotatedAt, `${path}.tokenRotatedAt`),
  };
}

function parseStats(raw: unknown, path: string): AiAgentStats {
  const row = rec(raw, path);
  const perDay = arr(row.runsPerDay14 ?? [], `${path}.runsPerDay14`).map((value, index) => num(value, `${path}.runsPerDay14[${index}]`));
  const fitted = perDay.length >= 14 ? perDay.slice(-14) : [...new Array<number>(14 - perDay.length).fill(0), ...perDay];
  return {
    runs7d: num(row.runs7d, `${path}.runs7d`),
    runsRunning: num(row.runsRunning ?? 0, `${path}.runsRunning`),
    failed7d: num(row.failed7d ?? 0, `${path}.failed7d`),
    actions7d: num(row.actions7d ?? 0, `${path}.actions7d`),
    costCents7d: num(row.costCents7d ?? 0, `${path}.costCents7d`),
    draftsPending: num(row.draftsPending ?? 0, `${path}.draftsPending`),
    lastRunAt: strN(row.lastRunAt, `${path}.lastRunAt`),
    lastRunStatus: row.lastRunStatus === null || row.lastRunStatus === undefined ? null : oneOf(row.lastRunStatus, AI_AGENT_RUN_STATUSES, `${path}.lastRunStatus`),
    lastDigestAt: strN(row.lastDigestAt, `${path}.lastDigestAt`),
    runsPerDay14: fitted,
  };
}

function parseListItemRow(row: Record<string, unknown>, path: string): AiAgentListItem {
  const model = row.model;
  return {
    key: oneOf(row.key, AI_AGENT_KEYS, `${path}.key`),
    groupKey: oneOf(row.groupKey, AI_AGENT_GROUPS, `${path}.groupKey`),
    sortOrder: num(row.sortOrder, `${path}.sortOrder`),
    title: str(row.title, `${path}.title`),
    roleLine: str(row.roleLine ?? "", `${path}.roleLine`),
    direction: row.direction === null || row.direction === undefined ? null : oneOf(row.direction, AI_AGENT_DIRECTIONS, `${path}.direction`),
    enabled: bool(row.enabled, `${path}.enabled`),
    autoSend: bool(row.autoSend, `${path}.autoSend`),
    model: isAiAgentModelId(model) ? model : bad(`${path}.model`),
    scheduleCron: strN(row.scheduleCron, `${path}.scheduleCron`),
    scheduleTz: str(row.scheduleTz, `${path}.scheduleTz`),
    hasInstructionsOverride: bool(row.hasInstructionsOverride ?? false, `${path}.hasInstructionsOverride`),
    sync: parseSync(row.sync, `${path}.sync`),
    stats: parseStats(row.stats, `${path}.stats`),
  };
}

export function parseAiAgentsList(raw: unknown): AiAgentsListResult {
  const row = rec(raw, "list");
  const org = rec(row.org ?? {}, "list.org");
  const summary = rec(row.summary ?? {}, "list.summary");
  return {
    agents: arr(row.agents, "list.agents").map((item, index) => parseListItemRow(rec(item, `list.agents[${index}]`), `list.agents[${index}]`)),
    org: { responsibleMembershipId: strN(org.responsibleMembershipId, "list.org.id"), responsibleName: strN(org.responsibleName, "list.org.name") },
    summary: {
      enabled: num(summary.enabled ?? 0, "list.summary.enabled"),
      runs7d: num(summary.runs7d ?? 0, "list.summary.runs7d"),
      costCents7d: num(summary.costCents7d ?? 0, "list.summary.costCents7d"),
      draftsPending: num(summary.draftsPending ?? 0, "list.summary.draftsPending"),
    },
    canManage: bool(row.canManage, "list.canManage"),
    isAdmin: bool(row.isAdmin, "list.isAdmin"),
    now: str(row.now, "list.now"),
  };
}

function parsePoints(raw: unknown, path: string): readonly AiAgentChartPoint[] {
  return arr(raw ?? [], path).map((item, index) => {
    const row = rec(item, `${path}[${index}]`);
    return {
      date: str(row.date, `${path}[${index}].date`),
      count: num(row.count ?? 0, `${path}[${index}].count`),
      failed: row.failed === undefined || row.failed === null ? undefined : num(row.failed, `${path}[${index}].failed`),
      costCents: row.costCents === undefined || row.costCents === null ? undefined : num(row.costCents, `${path}[${index}].costCents`),
    };
  });
}

function parseDigestRow(raw: unknown, path: string): AiAgentDigestRow {
  const row = rec(raw, path);
  const metrics = row.metrics === null || row.metrics === undefined ? null : rec(row.metrics, `${path}.metrics`);
  return {
    id: str(row.id, `${path}.id`),
    agentKey: oneOf(row.agentKey, AI_AGENT_KEYS, `${path}.agentKey`),
    runId: strN(row.runId, `${path}.runId`),
    kind: oneOf(row.kind, AI_AGENT_DIGEST_KINDS, `${path}.kind`),
    title: str(row.title, `${path}.title`),
    bodyMd: str(row.bodyMd, `${path}.bodyMd`),
    metrics,
    periodFrom: strN(row.periodFrom, `${path}.periodFrom`),
    periodTo: strN(row.periodTo, `${path}.periodTo`),
    createdAt: str(row.createdAt, `${path}.createdAt`),
  };
}

export function parseAiAgentDetail(raw: unknown): AiAgentDetail {
  const row = rec(raw, "detail");
  const base = parseListItemRow(row, "detail");
  const charts = rec(row.charts ?? {}, "detail.charts");
  return {
    ...base,
    instructionsOverride: strN(row.instructionsOverride, "detail.instructionsOverride"),
    schedulePromptOverride: strN(row.schedulePromptOverride, "detail.schedulePromptOverride"),
    triggerWebsiteLead: bool(row.triggerWebsiteLead ?? false, "detail.triggerWebsiteLead"),
    triggerWhatsappInbound: bool(row.triggerWhatsappInbound ?? false, "detail.triggerWhatsappInbound"),
    runBudgetUsd: num(row.runBudgetUsd ?? 0, "detail.runBudgetUsd"),
    configVersion: num(row.configVersion, "detail.configVersion"),
    charts: {
      runsPerDay: parsePoints(charts.runsPerDay, "detail.charts.runsPerDay"),
      spendPerDay: parsePoints(charts.spendPerDay, "detail.charts.spendPerDay"),
      actionsByTool: arr(charts.actionsByTool ?? [], "detail.charts.actionsByTool").map((item, index) => {
        const one = rec(item, `detail.charts.actionsByTool[${index}]`);
        return { tool: str(one.tool, "tool"), count: num(one.count, "count") };
      }),
    },
    lastDigest: row.lastDigest === null || row.lastDigest === undefined ? null : parseDigestRow(row.lastDigest, "detail.lastDigest"),
  };
}

function parseRunRow(raw: unknown, path: string): AiAgentRunRow {
  const row = rec(raw, path);
  return {
    id: str(row.id, `${path}.id`),
    agentKey: oneOf(row.agentKey, AI_AGENT_KEYS, `${path}.agentKey`),
    status: oneOf(row.status, AI_AGENT_RUN_STATUSES, `${path}.status`),
    triggerKind: oneOf(row.triggerKind, AI_AGENT_TRIGGER_KINDS, `${path}.triggerKind`),
    startedAt: str(row.startedAt, `${path}.startedAt`),
    endedAt: strN(row.endedAt, `${path}.endedAt`),
    durationSeconds: numN(row.durationSeconds, `${path}.durationSeconds`),
    promptPreview: strN(row.promptPreview, `${path}.promptPreview`),
    summary: strN(row.summary, `${path}.summary`),
    errorCode: strN(row.errorCode, `${path}.errorCode`),
    errorMessage: strN(row.errorMessage, `${path}.errorMessage`),
    model: strN(row.model, `${path}.model`),
    agentVersion: numN(row.agentVersion, `${path}.agentVersion`),
    sessionId: strN(row.sessionId, `${path}.sessionId`),
    inputTokens: num(row.inputTokens ?? 0, `${path}.inputTokens`),
    outputTokens: num(row.outputTokens ?? 0, `${path}.outputTokens`),
    cacheReadTokens: num(row.cacheReadTokens ?? 0, `${path}.cacheReadTokens`),
    costCents: num(row.costCents ?? 0, `${path}.costCents`),
    sendAuthority: bool(row.sendAuthority ?? false, `${path}.sendAuthority`),
    startedByName: strN(row.startedByName, `${path}.startedByName`),
    actionsCount: num(row.actionsCount ?? 0, `${path}.actionsCount`),
    draftsCount: num(row.draftsCount ?? 0, `${path}.draftsCount`),
  };
}

function parseActionRow(raw: unknown, path: string): AiAgentActionRow {
  const row = rec(raw, path);
  return {
    id: String(row.id ?? bad(`${path}.id`)),
    agentKey: oneOf(row.agentKey, AI_AGENT_KEYS, `${path}.agentKey`),
    runId: strN(row.runId, `${path}.runId`),
    tool: str(row.tool, `${path}.tool`),
    argsSummary: str(row.argsSummary ?? "", `${path}.argsSummary`),
    resultStatus: oneOf(row.resultStatus, ["ok", "error", "denied"] as const, `${path}.resultStatus`),
    errorCode: strN(row.errorCode, `${path}.errorCode`),
    durationMs: numN(row.durationMs, `${path}.durationMs`),
    at: str(row.at, `${path}.at`),
  };
}

function parseDraftRow(raw: unknown, path: string): AiAgentDraftRow {
  const row = rec(raw, path);
  const source = row.sourceMessage === null || row.sourceMessage === undefined ? null : rec(row.sourceMessage, `${path}.sourceMessage`);
  return {
    id: str(row.id, `${path}.id`),
    agentKey: oneOf(row.agentKey, AI_AGENT_KEYS, `${path}.agentKey`),
    runId: strN(row.runId, `${path}.runId`),
    channel: oneOf(row.channel, AI_AGENT_DRAFT_CHANNELS, `${path}.channel`),
    status: oneOf(row.status, AI_AGENT_DRAFT_STATUSES, `${path}.status`),
    text: str(row.text, `${path}.text`),
    editedText: strN(row.editedText, `${path}.editedText`),
    targetLabel: strN(row.targetLabel, `${path}.targetLabel`),
    conversationId: strN(row.conversationId, `${path}.conversationId`),
    studentCaseId: strN(row.studentCaseId, `${path}.studentCaseId`),
    leadId: strN(row.leadId, `${path}.leadId`),
    reason: strN(row.reason, `${path}.reason`),
    failureCode: strN(row.failureCode, `${path}.failureCode`),
    sourceMessage: source ? { text: str(source.text, `${path}.sourceMessage.text`), at: str(source.at, `${path}.sourceMessage.at`) } : null,
    createdAt: str(row.createdAt, `${path}.createdAt`),
    expiresAt: str(row.expiresAt, `${path}.expiresAt`),
    decidedByName: strN(row.decidedByName, `${path}.decidedByName`),
    decidedAt: strN(row.decidedAt, `${path}.decidedAt`),
    sentAt: strN(row.sentAt, `${path}.sentAt`),
    sentByAgent: bool(row.sentByAgent ?? false, `${path}.sentByAgent`),
  };
}

export function parseAiAgentRuns(raw: unknown): AiAgentRunsListResult {
  const row = rec(raw, "runs");
  return { runs: arr(row.runs, "runs.runs").map((item, index) => parseRunRow(item, `runs.runs[${index}]`)), hasMore: bool(row.hasMore ?? false, "runs.hasMore") };
}

export function parseAiAgentRun(raw: unknown): AiAgentRunGetResult {
  const row = rec(raw, "run");
  return {
    run: parseRunRow(row.run, "run.run"),
    actions: arr(row.actions ?? [], "run.actions").map((item, index) => parseActionRow(item, `run.actions[${index}]`)),
    drafts: arr(row.drafts ?? [], "run.drafts").map((item, index) => parseDraftRow(item, `run.drafts[${index}]`)),
  };
}

export function parseAiAgentDrafts(raw: unknown): AiAgentDraftsListResult {
  const row = rec(raw, "drafts");
  const counts = rec(row.counts ?? {}, "drafts.counts");
  return {
    drafts: arr(row.drafts, "drafts.drafts").map((item, index) => parseDraftRow(item, `drafts.drafts[${index}]`)),
    counts: Object.fromEntries(AI_AGENT_DRAFT_STATUSES.map((status) => [status, num(counts[status] ?? 0, `drafts.counts.${status}`)])) as Record<AiAgentDraftStatus, number>,
  };
}

export function parseAiAgentDigests(raw: unknown): AiAgentDigestsListResult {
  const row = rec(raw, "digests");
  return { digests: arr(row.digests, "digests.digests").map((item, index) => parseDigestRow(item, `digests.digests[${index}]`)) };
}
