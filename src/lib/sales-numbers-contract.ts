/**
 * Ответы двух чтений Э2 «Честные числа» (миграция 247) и их строгий разбор:
 *
 *  - `platform.staff_sales_count_v1` — одно определение «Продажи»: записи
 *    «Отчёта продаж» не в архиве с датой продажи в периоде;
 *  - `platform.staff_lead_handoff_strip_v1` — полоса «Передача» в Lead 360.
 *
 * Любое расхождение формы — `null`: экран говорит «не удалось загрузить», а
 * не рисует ноль или галочку наугад («нет чтения — нет числа»).
 */
import { isResolvedSalesStage, type ResolvedSalesStage } from "./v3/sales-stage.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const COUNT = /^(0|[1-9]\d{0,9})$/;

type Json = Record<string, unknown>;

function object(value: unknown, keys: readonly string[]): Json | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) return null;
  return value as Json;
}

function realDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function count(value: unknown): number | null {
  if (typeof value !== "string" || !COUNT.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/* ---------------------------------------------------------------- Продажи */

export type SalesCount = Readonly<{
  from: string;
  to: string;
  /** Записи не в архиве с датой продажи в периоде — это и есть «Продажи». */
  sales: number;
  /** Записи месяцев отчёта этого периода без даты продажи: в «Продажи» не входят. */
  undated: number;
  /** Записи месяцев отчёта этого периода с датой продажи вне периода. */
  otherSaleDate: number;
  /** Продажи периода, записанные в другой месяц отчёта. */
  filedElsewhere: number;
}>;

export type SalesCountRead =
  | Readonly<{ status: "available"; count: SalesCount }>
  /** Роль не читает отчёт продаж: числа нет, и это не сбой. */
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "unavailable" }>;

export function parseSalesCount(
  value: unknown,
  expected: Readonly<{ organizationId: string; from: string; to: string }>,
): SalesCount | null {
  const row = object(value, ["organization_id", "from", "to", "sales", "undated", "other_sale_date", "filed_elsewhere"]);
  if (!row || row.organization_id !== expected.organizationId || row.from !== expected.from || row.to !== expected.to) return null;
  const sales = count(row.sales);
  const undated = count(row.undated);
  const otherSaleDate = count(row.other_sale_date);
  const filedElsewhere = count(row.filed_elsewhere);
  if (sales === null || undated === null || otherSaleDate === null || filedElsewhere === null || filedElsewhere > sales) return null;
  return Object.freeze({ from: expected.from, to: expected.to, sales, undated, otherSaleDate, filedElsewhere });
}

/* --------------------------------------------------------------- Передача */

export type HandoffDecisionWord = "accepted" | "clarification_requested" | "declined";

export type LeadHandoffStrip = Readonly<{
  leadId: string;
  /** Этап по одному правилу доски (`sales_lead_stage`). */
  stage: ResolvedSalesStage;
  /** Завершённая передача: когда и чем доказана (088 или квитанция отчёта 208). */
  handoff: Readonly<{ completedAt: string; evidence: "handoff" | "sales_report" }> | null;
  contract: Readonly<{ confirmed: boolean; confirmedAt: string | null }>;
  firstPayment: Readonly<{ receivedDate: string | null }>;
  /** `denied` — роль не читает отчёт продаж: пункта в полосе нет. */
  report:
    | Readonly<{ status: "denied" }>
    | Readonly<{
        status: "available";
        record: Readonly<{ id: string; reportMonth: string; saleDate: string | null; archived: boolean }> | null;
      }>;
  /** Текущий куратор дела этой передачи и когда его назначили. */
  curator: Readonly<{ displayName: string; assignedAt: string | null }> | null;
  /** Последний ответ этого куратора на это назначение. */
  acceptance: Readonly<{ decision: HandoffDecisionWord; at: string }> | null;
}>;

export type LeadHandoffStripRead =
  | Readonly<{ status: "available"; strip: LeadHandoffStrip }>
  | Readonly<{ status: "unavailable" }>;

function parseHandoff(value: unknown): LeadHandoffStrip["handoff"] | undefined {
  if (value === null) return null;
  const row = object(value, ["completed_at", "evidence"]);
  if (!row || !timestamp(row.completed_at) || (row.evidence !== "handoff" && row.evidence !== "sales_report")) return undefined;
  return Object.freeze({ completedAt: row.completed_at, evidence: row.evidence });
}

function parseReport(value: unknown): LeadHandoffStrip["report"] | undefined {
  const row = object(value, ["status", "record"]);
  if (!row) return undefined;
  if (row.status === "denied") return row.record === null ? Object.freeze({ status: "denied" as const }) : undefined;
  if (row.status !== "available") return undefined;
  if (row.record === null) return Object.freeze({ status: "available" as const, record: null });
  const record = object(row.record, ["id", "report_month", "sale_date", "archived"]);
  if (!record || typeof record.id !== "string" || !UUID.test(record.id) || !realDate(record.report_month)
    || record.report_month.slice(8) !== "01" || (record.sale_date !== null && !realDate(record.sale_date))
    || typeof record.archived !== "boolean") return undefined;
  return Object.freeze({
    status: "available" as const,
    record: Object.freeze({
      id: record.id.toLowerCase(), reportMonth: record.report_month,
      saleDate: record.sale_date as string | null, archived: record.archived,
    }),
  });
}

function parseCurator(value: unknown): LeadHandoffStrip["curator"] | undefined {
  if (value === null) return null;
  const row = object(value, ["display_name", "assigned_at"]);
  if (!row || typeof row.display_name !== "string" || row.display_name.trim() === ""
    || (row.assigned_at !== null && !timestamp(row.assigned_at))) return undefined;
  return Object.freeze({ displayName: row.display_name.trim(), assignedAt: row.assigned_at as string | null });
}

function parseAcceptance(value: unknown): LeadHandoffStrip["acceptance"] | undefined {
  if (value === null) return null;
  const row = object(value, ["decision", "at"]);
  if (!row || (row.decision !== "accepted" && row.decision !== "clarification_requested" && row.decision !== "declined")
    || !timestamp(row.at)) return undefined;
  return Object.freeze({ decision: row.decision, at: row.at });
}

export function parseLeadHandoffStrip(
  value: unknown,
  expected: Readonly<{ organizationId: string; leadId: string }>,
): LeadHandoffStrip | null {
  const row = object(value, ["organization_id", "lead_id", "stage", "handoff", "contract", "first_payment", "report", "curator", "acceptance"]);
  if (!row || row.organization_id !== expected.organizationId || typeof row.lead_id !== "string"
    || row.lead_id.toLowerCase() !== expected.leadId.toLowerCase() || !isResolvedSalesStage(row.stage)) return null;
  const handoff = parseHandoff(row.handoff);
  const contract = object(row.contract, ["confirmed", "confirmed_at"]);
  const payment = object(row.first_payment, ["received_date"]);
  const report = parseReport(row.report);
  const curator = parseCurator(row.curator);
  const acceptance = parseAcceptance(row.acceptance);
  if (handoff === undefined || report === undefined || curator === undefined || acceptance === undefined
    || !contract || typeof contract.confirmed !== "boolean"
    || (contract.confirmed ? !timestamp(contract.confirmed_at) : contract.confirmed_at !== null)
    || !payment || (payment.received_date !== null && !realDate(payment.received_date))) return null;
  // Стадия и передача — одно правило: «Переданы» ровно тогда, когда передача
  // доказана (закрытый лид — отдельно, его передача остаётся фактом).
  if ((row.stage === "handed_off") !== (handoff !== null) && row.stage !== "closed") return null;
  // Куратор и ответ бывают только у дела передачи.
  if (handoff === null && (curator !== null || acceptance !== null)) return null;
  if (curator === null && acceptance !== null) return null;
  return Object.freeze({
    leadId: expected.leadId,
    stage: row.stage,
    handoff,
    contract: Object.freeze({ confirmed: contract.confirmed, confirmedAt: contract.confirmed_at as string | null }),
    firstPayment: Object.freeze({ receivedDate: payment.received_date as string | null }),
    report,
    curator,
    acceptance,
  });
}
