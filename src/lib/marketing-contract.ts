/**
 * Ответы admin-чтений раздела «Маркетинг» (миграция 265) и их строгий разбор:
 *
 *  - `platform.marketing_overview_v1` — два блока обзора (когорта заявок и продажи периода),
 *    ручной расход;
 *  - `platform.marketing_leads_v1` — список заявок с именами, страница ≤ 50, курсор `(created_at, id)`;
 *  - ответы `marketing_spend_add_v1` / `marketing_spend_cancel_v1`.
 *
 * Любое расхождение формы — `null`: экран говорит «не удалось загрузить», а не рисует ноль
 * («нет чтения — нет числа»). Деньги — десятичная строка минорных единиц и ISO-валюта, валюты не
 * складываются; счётчики — JSON-числа.
 */
import {
  isIsoTimestamp, isLeadChannel, isLeadChannelBasis, LEAD_CHANNEL_KEYS,
  type LeadChannel, type LeadChannelBasis,
} from "./lead-channel-contract.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINOR = /^(0|[1-9]\d{0,18})$/;
const CURRENCY = /^[A-Z]{3}$/;

type Json = Record<string, unknown>;

function object(value: unknown, keys: readonly string[]): Json | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) return null;
  return value as Json;
}
export function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function minor(value: unknown): string | null {
  return typeof value === "string" && MINOR.test(value) ? value : null;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value : null;
}
function list<T>(value: unknown, parse: (item: unknown) => T | null, max: number): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const parsed: T[] = [];
  for (const item of value) {
    const one = parse(item);
    if (one === null) return null;
    parsed.push(one);
  }
  return parsed;
}

/* ------------------------------------------------------------------ Деньги */

/** Сумма в одной валюте; `count` — сколько лидов или договоров в ней. */
export type MoneyCount = Readonly<{ currency: string; amountMinor: string; count: number }>;
export type MoneyTotal = Readonly<{ currency: string; amountMinor: string }>;

function parseMoneyCount(key: "leads" | "contracts") {
  return (value: unknown): MoneyCount | null => {
    const row = object(value, ["currency", "amount_minor", key]);
    const amount = row && minor(row.amount_minor), n = row && count(row[key]);
    if (!row || amount === null || n === null || typeof row.currency !== "string" || !CURRENCY.test(row.currency)) return null;
    return Object.freeze({ currency: row.currency, amountMinor: amount, count: n });
  };
}
function parseMoneyTotal(value: unknown): MoneyTotal | null {
  const row = object(value, ["currency", "amount_minor"]);
  const amount = row && minor(row.amount_minor);
  if (!row || amount === null || typeof row.currency !== "string" || !CURRENCY.test(row.currency)) return null;
  return Object.freeze({ currency: row.currency, amountMinor: amount });
}

/* ------------------------------------------------------------------ Обзор */

export const MARKETING_SALES_CHANNELS = [...LEAD_CHANNEL_KEYS, "without_lead"] as const;
export type MarketingSalesChannel = (typeof MARKETING_SALES_CHANNELS)[number];

export type CohortBasisCounts = Readonly<Record<LeadChannelBasis, number>>;
export type CohortChannelRow = Readonly<{
  channel: LeadChannel;
  leads: number; qualified: number; handedOff: number; contract: number; contractLinked: number;
  paid: number; paidWithoutAmount: number;
  /** Сколько лидов канала пришло из ИИ-ассистента (только «Сайт и поиск»). */
  aiAssistant: number;
  paidAmounts: readonly MoneyCount[];
  basis: CohortBasisCounts;
}>;
export type CohortTotals = Readonly<{
  leads: number; qualified: number; handedOff: number; contract: number; contractLinked: number; paid: number; paidWithoutAmount: number;
}>;
export type SalesChannelRow = Readonly<{
  channel: MarketingSalesChannel;
  contracts: number; linkedManually: number; amountMissing: number;
  amounts: readonly MoneyCount[];
}>;
export type SpendRow = Readonly<{
  id: string; periodStart: string; periodEnd: string; amountMinor: string; currency: string;
  campaign: string | null; note: string | null; createdAt: string;
}>;

export type MarketingOverview = Readonly<{
  organizationId: string; from: string; to: string;
  cohort: Readonly<{
    total: number; openCount: number;
    /** Сколько лидов когорты по каналу связи (`source_key`). */
    sourceKeys: Readonly<Record<string, number>>;
    repeatSubmissions: number;
    totals: CohortTotals;
    channels: readonly CohortChannelRow[];
  }>;
  sales: Readonly<{
    total: number;
    channels: readonly SalesChannelRow[];
    reconciliation: Readonly<{ byChannelPlusWithoutLead: number; reportSales: number; difference: number; matches: boolean }>;
  }>;
  spend: Readonly<{
    insidePeriod: readonly SpendRow[];
    insideTotals: readonly MoneyTotal[];
    partiallyOverlapping: readonly SpendRow[];
  }>;
}>;

const COHORT_ROW_KEYS = ["channel", "leads", "qualified", "handed_off", "contract", "contract_linked", "paid",
  "paid_without_amount", "paid_amounts", "ai_assistant", "basis"] as const;
const BASIS_KEYS = ["utm", "referrer", "staff", "corrected", "unknown"] as const;

function parseCohortRow(value: unknown): CohortChannelRow | null {
  const row = object(value, COHORT_ROW_KEYS);
  if (!row || !isLeadChannel(row.channel)) return null;
  const n = Object.fromEntries(["leads", "qualified", "handed_off", "contract", "contract_linked", "paid", "paid_without_amount", "ai_assistant"]
    .map((key) => [key, count(row[key])])) as Record<string, number | null>;
  const basisRow = object(row.basis, BASIS_KEYS);
  const paidAmounts = list(row.paid_amounts, parseMoneyCount("leads"), 50);
  if (Object.values(n).some((one) => one === null) || !basisRow || !paidAmounts) return null;
  const basis = Object.fromEntries(BASIS_KEYS.map((key) => [key, count(basisRow[key])])) as Record<string, number | null>;
  if (Object.values(basis).some((one) => one === null)) return null;
  const leads = n.leads!;
  // Инварианты определений: подмножества не больше целого.
  if (n.qualified! > leads || n.handed_off! > n.qualified! || n.contract! > leads || n.contract_linked! > n.contract!
    || n.paid! > leads || n.paid_without_amount! > n.paid! || n.ai_assistant! > leads) return null;
  return Object.freeze({
    channel: row.channel, leads, qualified: n.qualified!, handedOff: n.handed_off!, contract: n.contract!,
    contractLinked: n.contract_linked!, paid: n.paid!, paidWithoutAmount: n.paid_without_amount!,
    aiAssistant: n.ai_assistant!, paidAmounts: Object.freeze(paidAmounts),
    basis: Object.freeze(basis as Record<LeadChannelBasis, number>),
  });
}

function parseSalesRow(value: unknown): SalesChannelRow | null {
  const row = object(value, ["channel", "contracts", "linked_manually", "amount_missing", "amounts"]);
  const contracts = row && count(row.contracts), linked = row && count(row.linked_manually), missing = row && count(row.amount_missing);
  const amounts = row && list(row.amounts, parseMoneyCount("contracts"), 50);
  if (!row || contracts === null || linked === null || missing === null || !amounts
    || typeof row.channel !== "string" || !(MARKETING_SALES_CHANNELS as readonly string[]).includes(row.channel)
    || linked > contracts || missing > contracts) return null;
  return Object.freeze({
    channel: row.channel as MarketingSalesChannel, contracts, linkedManually: linked, amountMissing: missing,
    amounts: Object.freeze(amounts),
  });
}

function parseSpendRow(value: unknown): SpendRow | null {
  const row = object(value, ["id", "period_start", "period_end", "amount_minor", "currency", "campaign", "note", "created_at"]);
  if (!row || !uuid(row.id) || !isRealIsoDate(row.period_start) || !isRealIsoDate(row.period_end) || row.period_start > row.period_end) return null;
  const amount = minor(row.amount_minor);
  const campaign = row.campaign === null ? null : text(row.campaign, 100), note = row.note === null ? null : text(row.note, 500);
  if (amount === null || amount === "0" || typeof row.currency !== "string" || !CURRENCY.test(row.currency)
    || (row.campaign !== null && campaign === null) || (row.note !== null && note === null) || !isIsoTimestamp(row.created_at)) return null;
  return Object.freeze({
    id: row.id, periodStart: row.period_start, periodEnd: row.period_end, amountMinor: amount,
    currency: row.currency, campaign, note, createdAt: row.created_at,
  });
}

export function parseMarketingOverview(
  value: unknown,
  expected: Readonly<{ organizationId: string; from: string; to: string }>,
): MarketingOverview | null {
  const root = object(value, ["organization_id", "from", "to", "time_zone", "cohort", "sales", "spend"]);
  if (!root || root.organization_id !== expected.organizationId || root.from !== expected.from || root.to !== expected.to
    || root.time_zone !== "Asia/Bishkek") return null;
  const cohort = object(root.cohort, ["total", "open_count", "source_keys", "repeat_submissions", "totals", "channels"]);
  const sales = object(root.sales, ["total", "channels", "reconciliation"]);
  const spend = object(root.spend, ["inside_period", "inside_totals", "partially_overlapping"]);
  if (!cohort || !sales || !spend) return null;

  const total = count(cohort.total), open = count(cohort.open_count), repeat = count(cohort.repeat_submissions);
  if (total === null || open === null || repeat === null || open > total) return null;
  if (typeof cohort.source_keys !== "object" || cohort.source_keys === null || Array.isArray(cohort.source_keys)) return null;
  const sourceKeys: Record<string, number> = {};
  for (const [key, one] of Object.entries(cohort.source_keys)) {
    const n = count(one);
    if (n === null || !/^[a-z][a-z0-9_]{0,63}$/.test(key)) return null;
    sourceKeys[key] = n;
  }
  const totalsRow = object(cohort.totals, ["leads", "qualified", "handed_off", "contract", "contract_linked", "paid", "paid_without_amount"]);
  if (!totalsRow) return null;
  const totals = Object.fromEntries(Object.keys(totalsRow).map((key) => [key, count(totalsRow[key])])) as Record<string, number | null>;
  if (Object.values(totals).some((one) => one === null) || totals.leads !== total) return null;
  const channels = list(cohort.channels, parseCohortRow, 6);
  if (!channels || channels.length !== LEAD_CHANNEL_KEYS.length || channels.some((row, index) => row.channel !== LEAD_CHANNEL_KEYS[index])
    || channels.reduce((sum, row) => sum + row.leads, 0) !== total
    || Object.values(sourceKeys).reduce((sum, n) => sum + n, 0) !== total) return null;

  const salesTotal = count(sales.total);
  const salesChannels = list(sales.channels, parseSalesRow, 7);
  const recon = object(sales.reconciliation, ["by_channel_plus_without_lead", "report_sales", "difference", "matches"]);
  if (salesTotal === null || !salesChannels || salesChannels.length !== MARKETING_SALES_CHANNELS.length
    || salesChannels.some((row, index) => row.channel !== MARKETING_SALES_CHANNELS[index]) || !recon) return null;
  const byChannel = count(recon.by_channel_plus_without_lead), report = count(recon.report_sales);
  if (byChannel === null || report === null || typeof recon.difference !== "number" || !Number.isSafeInteger(recon.difference)
    || recon.difference !== byChannel - report || recon.matches !== (recon.difference === 0)
    || byChannel !== salesChannels.reduce((sum, row) => sum + row.contracts, 0) || byChannel !== salesTotal) return null;

  const inside = list(spend.inside_period, parseSpendRow, 500);
  const partial = list(spend.partially_overlapping, parseSpendRow, 500);
  const insideTotals = list(spend.inside_totals, parseMoneyTotal, 50);
  if (!inside || !partial || !insideTotals) return null;

  return Object.freeze({
    organizationId: expected.organizationId, from: expected.from, to: expected.to,
    cohort: Object.freeze({
      total, openCount: open, sourceKeys: Object.freeze(sourceKeys), repeatSubmissions: repeat,
      totals: Object.freeze({
        leads: totals.leads!, qualified: totals.qualified!, handedOff: totals.handed_off!, contract: totals.contract!,
        contractLinked: totals.contract_linked!, paid: totals.paid!, paidWithoutAmount: totals.paid_without_amount!,
      }),
      channels: Object.freeze(channels),
    }),
    sales: Object.freeze({
      total: salesTotal, channels: Object.freeze(salesChannels),
      reconciliation: Object.freeze({ byChannelPlusWithoutLead: byChannel, reportSales: report, difference: recon.difference, matches: recon.matches as boolean }),
    }),
    spend: Object.freeze({ insidePeriod: Object.freeze(inside), insideTotals: Object.freeze(insideTotals), partiallyOverlapping: Object.freeze(partial) }),
  });
}

export type MarketingOverviewRead =
  | Readonly<{ status: "available"; overview: MarketingOverview }>
  /** Не настоящий администратор или просмотр роли: числа нет, и это не сбой. */
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "unavailable" }>;

/* ------------------------------------------------------------------ Заявки */

export const MARKETING_STAGES = ["new", "contacting", "qualified", "meeting_scheduled", "meeting_completed", "potential", "handed_off", "closed"] as const;
export type MarketingStage = (typeof MARKETING_STAGES)[number];
const LIFECYCLES = ["open", "converted", "disqualified", "archived"] as const;
export type MarketingLifecycle = (typeof LIFECYCLES)[number];
export const PAID_SOURCES = ["case", "gate", "report"] as const;
export type MarketingPaidSource = (typeof PAID_SOURCES)[number];

export type MarketingLeadRow = Readonly<{
  leadId: string; name: string | null; phone: string | null; createdAt: string; sourceKey: string;
  channel: LeadChannel; basis: LeadChannelBasis; corrected: boolean; aiAssistant: boolean;
  campaign: string | null; landingPath: string | null;
  stage: MarketingStage; lifecycleState: MarketingLifecycle;
  contractSignedOn: string | null; contractLinkedManually: boolean;
  paid: Readonly<{ amountMinor: string | null; currency: string | null; source: MarketingPaidSource }> | null;
  owner: Readonly<{ membershipId: string; name: string }> | null;
}>;
export type MarketingCursor = Readonly<{ createdAt: string; id: string }>;
export type MarketingLeadsPage = Readonly<{
  organizationId: string; from: string; to: string;
  total: number; hasMore: boolean; nextCursor: MarketingCursor | null;
  rows: readonly MarketingLeadRow[];
}>;

const LEAD_ROW_KEYS = ["lead_id", "name", "phone", "created_at", "source_key", "channel", "basis", "corrected", "ai_assistant",
  "campaign", "landing_path", "stage", "lifecycle_state", "contract_signed_on", "contract_linked_manually", "paid", "owner"] as const;

function parseLeadRow(value: unknown): MarketingLeadRow | null {
  const row = object(value, LEAD_ROW_KEYS);
  if (!row || !uuid(row.lead_id) || !isIsoTimestamp(row.created_at) || typeof row.source_key !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(row.source_key)
    || !isLeadChannel(row.channel) || !isLeadChannelBasis(row.basis) || typeof row.corrected !== "boolean" || typeof row.ai_assistant !== "boolean"
    || row.corrected !== (row.basis === "corrected")
    || !(MARKETING_STAGES as readonly string[]).includes(row.stage as string) || !(LIFECYCLES as readonly string[]).includes(row.lifecycle_state as string)
    || (row.contract_signed_on !== null && !isRealIsoDate(row.contract_signed_on)) || typeof row.contract_linked_manually !== "boolean"
    || (row.contract_linked_manually && row.contract_signed_on === null)) return null;
  const name = row.name === null ? null : text(row.name, 300), phone = row.phone === null ? null : text(row.phone, 80);
  const campaign = row.campaign === null ? null : text(row.campaign, 100), landing = row.landing_path === null ? null : text(row.landing_path, 200);
  if ((row.name !== null && name === null) || (row.phone !== null && phone === null)
    || (row.campaign !== null && campaign === null) || (row.landing_path !== null && landing === null)) return null;
  let paid: MarketingLeadRow["paid"] = null;
  if (row.paid !== null) {
    const p = object(row.paid, ["amount_minor", "currency", "source"]);
    if (!p || !(PAID_SOURCES as readonly string[]).includes(p.source as string)) return null;
    const amount = p.amount_minor === null ? null : minor(p.amount_minor);
    const currency = p.currency === null ? null : typeof p.currency === "string" && CURRENCY.test(p.currency) ? p.currency : undefined;
    if ((p.amount_minor !== null && amount === null) || currency === undefined) return null;
    paid = Object.freeze({ amountMinor: amount, currency, source: p.source as MarketingPaidSource });
  }
  let owner: MarketingLeadRow["owner"] = null;
  if (row.owner !== null) {
    const o = object(row.owner, ["membership_id", "name"]);
    const ownerName = o && text(o.name, 300);
    if (!o || !uuid(o.membership_id) || ownerName === null) return null;
    owner = Object.freeze({ membershipId: o.membership_id, name: ownerName });
  }
  return Object.freeze({
    leadId: row.lead_id, name, phone, createdAt: row.created_at, sourceKey: row.source_key,
    channel: row.channel, basis: row.basis, corrected: row.corrected, aiAssistant: row.ai_assistant,
    campaign, landingPath: landing, stage: row.stage as MarketingStage, lifecycleState: row.lifecycle_state as MarketingLifecycle,
    contractSignedOn: row.contract_signed_on, contractLinkedManually: row.contract_linked_manually, paid, owner,
  });
}

export function parseMarketingLeads(
  value: unknown,
  expected: Readonly<{ organizationId: string; from: string; to: string; limit: number }>,
): MarketingLeadsPage | null {
  const root = object(value, ["organization_id", "from", "to", "total", "has_more", "next_cursor", "rows"]);
  if (!root || root.organization_id !== expected.organizationId || root.from !== expected.from || root.to !== expected.to
    || typeof root.has_more !== "boolean") return null;
  const total = count(root.total), rows = list(root.rows, parseLeadRow, expected.limit);
  if (total === null || !rows || rows.length > total) return null;
  let nextCursor: MarketingCursor | null = null;
  if (root.next_cursor !== null) {
    const c = object(root.next_cursor, ["created_at", "id"]);
    if (!c || !isIsoTimestamp(c.created_at) || !uuid(c.id)) return null;
    nextCursor = Object.freeze({ createdAt: c.created_at, id: c.id });
  }
  // Курсор есть ровно тогда, когда есть продолжение, и указывает на последнюю показанную строку.
  const last = rows.at(-1);
  if ((root.has_more) !== (nextCursor !== null) || (nextCursor && (!last || last.leadId !== nextCursor.id))) return null;
  return Object.freeze({
    organizationId: expected.organizationId, from: expected.from, to: expected.to,
    total, hasMore: root.has_more, nextCursor, rows: Object.freeze(rows),
  });
}

export type MarketingLeadsRead =
  | Readonly<{ status: "available"; page: MarketingLeadsPage }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "unavailable" }>;

/** Фильтры списка: только ключи и даты, ни имён, ни телефонов (в адресе и в вызове). */
export type MarketingLeadFilters = Readonly<{
  channel: LeadChannel | null;
  campaign: string | null;
  stage: MarketingStage | null;
  hasContract: boolean | null;
  unknownOnly: boolean;
  noOwner: boolean;
}>;
export const NO_MARKETING_FILTERS: MarketingLeadFilters = Object.freeze({
  channel: null, campaign: null, stage: null, hasContract: null, unknownOnly: false, noOwner: false,
});

type Params = Readonly<Record<string, string | readonly string[] | undefined>>;
function single(params: Params, key: string): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}
/** Разбор адреса: неизвестное значение — «нет фильтра», а не ошибка и не расширение запроса. */
export function parseMarketingLeadFilters(params: Params): MarketingLeadFilters {
  const channel = single(params, "channel"), stage = single(params, "stage"), campaign = single(params, "campaign")?.trim() ?? "";
  const contract = single(params, "contract");
  return Object.freeze({
    channel: isLeadChannel(channel) ? channel : null,
    campaign: campaign && campaign.length <= 100 && !/[\u0000-\u001f\u007f]/.test(campaign) ? campaign : null,
    stage: (MARKETING_STAGES as readonly string[]).includes(stage ?? "") ? (stage as MarketingStage) : null,
    hasContract: contract === "yes" ? true : contract === "no" ? false : null,
    unknownOnly: single(params, "unknown") === "1",
    noOwner: single(params, "no_owner") === "1",
  });
}
/** Параметры адреса для фильтров (только непустые). */
export function marketingLeadFilterParams(filters: MarketingLeadFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.channel) out.channel = filters.channel;
  if (filters.campaign) out.campaign = filters.campaign;
  if (filters.stage) out.stage = filters.stage;
  if (filters.hasContract !== null) out.contract = filters.hasContract ? "yes" : "no";
  if (filters.unknownOnly) out.unknown = "1";
  if (filters.noOwner) out.no_owner = "1";
  return out;
}

/* ------------------------------------------------------------------ Расход */

export type SpendWriteResult =
  | Readonly<{ status: "saved"; spend: SpendRow }>
  | Readonly<{ status: "invalid" | "forbidden" | "request_conflict" | "not_found" | "already_cancelled" | "unavailable" }>;

/** Ответ `marketing_spend_add_v1`: те же поля строки расхода плюс `status`/`request_id`. */
export function parseSpendSaved(value: unknown, requestId: string): SpendRow | null {
  const row = object(value, ["status", "spend_id", "request_id", "period_start", "period_end", "amount_minor", "currency", "campaign", "note", "created_at"]);
  if (!row || row.status !== "saved" || row.request_id !== requestId) return null;
  return parseSpendRow({
    id: row.spend_id, period_start: row.period_start, period_end: row.period_end, amount_minor: row.amount_minor,
    currency: row.currency, campaign: row.campaign, note: row.note, created_at: row.created_at,
  });
}
/** Ответ `marketing_spend_cancel_v1`. */
export function parseSpendCancelled(value: unknown, requestId: string, spendId: string): boolean {
  const row = object(value, ["status", "spend_id", "cancel_id", "request_id", "created_at"]);
  return row !== null && row.status === "cancelled" && row.spend_id === spendId && row.request_id === requestId
    && uuid(row.cancel_id) && isIsoTimestamp(row.created_at);
}

export const SPEND_CURRENCIES = ["USD", "KGS", "EUR"] as const;
export type SpendCurrency = (typeof SPEND_CURRENCIES)[number];

/** Состояния форм расхода. */
export type SpendFormState = Readonly<{
  status: "idle" | "saved" | "invalid" | "forbidden" | "request_conflict" | "unavailable";
  requestId: string;
}>;
export type SpendCancelState = Readonly<{
  status: "idle" | "cancelled" | "invalid" | "forbidden" | "request_conflict" | "not_found" | "already_cancelled" | "unavailable";
  requestId: string;
}>;
