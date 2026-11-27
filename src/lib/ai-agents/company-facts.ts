/**
 * «Факты компании» («мозг компании», миграция 381): проверенные факты со сроком годности отдельно от инструкций агентов.
 * Чистый модуль без React, сервера и ввода-вывода: имена RPC, пределы, строгий разбор ответов базы и состояния форм.
 * Слова для людей (темы, аудитория, источник, срок) живут в `src/lib/v3/wording.ts`, здесь их нет.
 *
 * Импорты внутри src/lib — относительные с `.ts`: тесты идут через `node --experimental-strip-types`.
 */

export const COMPANY_FACT_RPC = {
  list: "ai_company_facts_list_v1",
  save: "ai_company_facts_save_v1",
  retire: "ai_company_facts_retire_v1",
} as const;

export const COMPANY_FACT_AUDIENCES = ["client", "internal"] as const;
export type CompanyFactAudience = (typeof COMPANY_FACT_AUDIENCES)[number];
export const COMPANY_FACT_SOURCES = ["owner", "agent_instruction", "kb_node", "catalog_cost", "timeline", "contract"] as const;
export type CompanyFactSource = (typeof COMPANY_FACT_SOURCES)[number];
export const COMPANY_FACT_STATUSES = ["active", "draft", "retired"] as const;
export type CompanyFactStatus = (typeof COMPANY_FACT_STATUSES)[number];
/** Состояние срока: без срока / в порядке / истекает в ближайшие 30 дней / просрочен. */
export const COMPANY_FACT_VALIDITIES = ["unlimited", "ok", "expiring", "expired"] as const;
export type CompanyFactValidity = (typeof COMPANY_FACT_VALIDITIES)[number];

export const COMPANY_FACT_LIMITS = { statementMaxChars: 1500, sourceRefMaxChars: 300, topicMaxChars: 120, listMax: 500 } as const;
/** Дней до конца срока, с которых факт помечается «скоро истечёт». Столько же считает база. */
export const COMPANY_FACT_EXPIRING_DAYS = 30;
export const COMPANY_FACT_TOPIC_PATTERN = /^[a-z0-9]+(\.[a-z0-9_-]+)+$/u;

export const isCompanyFactAudience = (value: unknown): value is CompanyFactAudience =>
  (COMPANY_FACT_AUDIENCES as readonly unknown[]).includes(value);
export const isCompanyFactSource = (value: unknown): value is CompanyFactSource =>
  (COMPANY_FACT_SOURCES as readonly unknown[]).includes(value);

export type CompanyFact = Readonly<{
  id: string;
  topic: string;
  statementRu: string;
  statementKy: string | null;
  statementEn: string | null;
  audience: CompanyFactAudience;
  source: CompanyFactSource;
  sourceRef: string | null;
  /** Дата `YYYY-MM-DD`. */
  verifiedAt: string;
  validUntil: string | null;
  supersedesId: string | null;
  verifiedByName: string | null;
  status: CompanyFactStatus;
  validity: CompanyFactValidity;
  /** Дней до конца срока (отрицательное — просрочен); null — без срока. */
  daysLeft: number | null;
  updatedAt: string;
}>;

export type CompanyFactsData = Readonly<{
  facts: readonly CompanyFact[];
  /** Фактов в базе больше, чем прислано (предел списка). */
  truncated: boolean;
  /** Сегодня по Бишкеку, как считает база. */
  today: string;
  counts: Readonly<{ active: number; expired: number; expiring: number }>;
  canManage: boolean;
}>;

export type CompanyFactsRead =
  | Readonly<{ status: "available"; data: CompanyFactsData }>
  | Readonly<{ status: "not_ready" | "denied" | "unavailable" }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
/** Настоящая дата календаря: «2026-02-30» не проходит (V8 сдвигает её на март, поэтому сверяем круговым преобразованием). */
const date = (value: unknown): value is string => {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length >= 1 && [...value].length <= max && !CONTROL.test(value);
const optionalText = (value: unknown, max: number): value is string | null => value === null || text(value, max);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function parseFact(raw: unknown): CompanyFact | null {
  if (!isRecord(raw)) return null;
  const topic = raw.topic;
  if (!uuid(raw.id) || typeof topic !== "string" || topic.length > COMPANY_FACT_LIMITS.topicMaxChars || !COMPANY_FACT_TOPIC_PATTERN.test(topic)
    || !text(raw.statementRu, COMPANY_FACT_LIMITS.statementMaxChars)
    || !optionalText(raw.statementKy, COMPANY_FACT_LIMITS.statementMaxChars) || !optionalText(raw.statementEn, COMPANY_FACT_LIMITS.statementMaxChars)
    || !isCompanyFactAudience(raw.audience) || !isCompanyFactSource(raw.source) || !optionalText(raw.sourceRef, COMPANY_FACT_LIMITS.sourceRefMaxChars)
    || !date(raw.verifiedAt) || !(raw.validUntil === null || date(raw.validUntil))
    || !(raw.supersedesId === null || uuid(raw.supersedesId))
    || !(raw.verifiedByName === null || text(raw.verifiedByName, 300))
    || !(COMPANY_FACT_STATUSES as readonly unknown[]).includes(raw.status)
    || !(COMPANY_FACT_VALIDITIES as readonly unknown[]).includes(raw.validity)
    || !(raw.daysLeft === null || (typeof raw.daysLeft === "number" && Number.isSafeInteger(raw.daysLeft)))
    || typeof raw.updatedAt !== "string") return null;
  return {
    id: raw.id.toLowerCase(), topic, statementRu: raw.statementRu, statementKy: raw.statementKy, statementEn: raw.statementEn,
    audience: raw.audience, source: raw.source, sourceRef: raw.sourceRef, verifiedAt: raw.verifiedAt, validUntil: raw.validUntil as string | null,
    supersedesId: raw.supersedesId === null ? null : (raw.supersedesId as string).toLowerCase(), verifiedByName: raw.verifiedByName as string | null,
    status: raw.status as CompanyFactStatus, validity: raw.validity as CompanyFactValidity, daysLeft: raw.daysLeft as number | null,
    updatedAt: raw.updatedAt,
  };
}

/** Ответ `ai_company_facts_list_v1`; кривая форма — null (страница скажет «не удалось прочитать»). */
export function parseCompanyFacts(data: unknown): CompanyFactsData | null {
  if (!isRecord(data) || !Array.isArray(data.facts) || data.facts.length > COMPANY_FACT_LIMITS.listMax
    || typeof data.truncated !== "boolean" || !date(data.today) || typeof data.canManage !== "boolean" || !isRecord(data.counts)) return null;
  const counts = data.counts;
  if (!count(counts.active) || !count(counts.expired) || !count(counts.expiring)) return null;
  const facts: CompanyFact[] = [];
  for (const raw of data.facts) {
    const fact = parseFact(raw);
    if (!fact) return null;
    facts.push(fact);
  }
  return { facts, truncated: data.truncated, today: data.today, counts: { active: counts.active, expired: counts.expired, expiring: counts.expiring }, canManage: data.canManage };
}

export type CompanyFactSaveStatus = "saved" | "unchanged" | "retired";
/** Ответ `ai_company_facts_save_v1` / `ai_company_facts_retire_v1`: id факта и итог. */
export function parseCompanyFactSaved(data: unknown): Readonly<{ factId: string; status: CompanyFactSaveStatus }> | null {
  if (!isRecord(data) || !uuid(data.factId) || (data.status !== "saved" && data.status !== "unchanged" && data.status !== "retired")) return null;
  return { factId: data.factId.toLowerCase(), status: data.status };
}

export type CompanyFactFailure =
  | "forbidden" | "invalid" | "verification_required" | "invalid_dates" | "topic_exists" | "stale" | "not_found" | "request_conflict"
  | "not_ready" | "unavailable";

/** Код базы -> понятный итог; текст ошибки несёт слово `company_fact_*`, код SQLSTATE — запасной признак. */
export function mapCompanyFactError(error: Readonly<{ code?: string | null; message?: string | null }> | null | undefined): CompanyFactFailure {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "PGRST202" || code === "42883") return "not_ready";
  const table: readonly (readonly [RegExp, CompanyFactFailure])[] = [
    [/ai_agent_forbidden/u, "forbidden"],
    [/company_fact_verification_required/u, "verification_required"],
    [/company_fact_invalid_dates/u, "invalid_dates"],
    [/company_fact_invalid_patch|company_fact_invalid_filter/u, "invalid"],
    [/company_fact_topic_exists/u, "topic_exists"],
    [/company_fact_request_conflict/u, "request_conflict"],
    [/company_fact_stale/u, "stale"],
    [/company_fact_not_found/u, "not_found"],
  ];
  for (const [pattern, mapped] of table) if (pattern.test(message)) return mapped;
  if (code === "42501") return "forbidden";
  if (code === "P0002") return "not_found";
  if (code === "22023") return "invalid";
  if (code === "23505") return "topic_exists";
  if (code === "40001") return "stale";
  return "unavailable";
}

export type CompanyFactFormState = Readonly<{
  status: "idle" | "saved" | "unchanged" | "retired" | CompanyFactFailure;
  requestId: string;
}>;

export const COMPANY_FACT_FORM_GOOD: ReadonlySet<CompanyFactFormState["status"]> = new Set(["saved", "unchanged", "retired"]);

/** Сегодняшняя дата по Бишкеку (UTC+6, без летнего времени) в виде `YYYY-MM-DD`: форма подсказывает «проверено сегодня». */
export function bishkekToday(now: Date): string {
  return new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** `2026-10-23` -> `23.10.2026` (дата без времени и пояса: сдвигов нет). */
export function companyFactDateLabel(value: string | null): string {
  if (value === null) return "";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}
