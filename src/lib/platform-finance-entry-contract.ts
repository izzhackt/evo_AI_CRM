import { parseSalesDate, parseSalesUuid } from "./platform-sales-register-contract.ts";
export type FinanceEntryStatus = "idle" | "saved" | "invalid" | "forbidden" | "request_conflict" | "unavailable";
export type FinanceEntryState = Readonly<{ status: FinanceEntryStatus; requestId: string; resourceId: string | null }>;
export type FinanceObligation = Readonly<{ id: string; label: string; currency: string; amountMinor: string; outstandingMinor: string; dueAt: string }>;
export type FinancePayment = Readonly<{ id: string; obligationId: string; type: "payment" | "refund"; amountMinor: string; currency: string; occurredAt: string; refundableMinor: string }>;
export type FinanceEntryWorkspace = Readonly<{ caseId: string; obligations: readonly FinanceObligation[]; events: readonly FinancePayment[]; canCreate: boolean; canRecord: boolean; canReadEvents: boolean }>;
export type MonthlyPaymentTotal = Readonly<{ currency: string; paymentsMinor: string; refundsMinor: string; netMinor: string; eventCount: string }>;
export function decimalToMinor(value: string): string | null {
  if (!/^\d{1,14}([.,]\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return amount > BigInt(0) && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? amount.toString() : null;
}
export function financeDateTime(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !parseSalesDate(value.slice(0, 10))) return null;
  const hour = Number(value.slice(11, 13)), minute = Number(value.slice(14, 16));
  if (hour > 23 || minute > 59) return null;
  // EVO business wall-clock time; never use the browser's timezone implicitly.
  return new Date(`${value}:00+06:00`).toISOString();
}
export function financeMoney(minor: string, currency: string): string {
  const value = BigInt(minor), negative = value < BigInt(0), absolute = negative ? -value : value;
  return `${negative ? "−" : ""}${new Intl.NumberFormat("ru-RU").format(absolute / BigInt(100))},${(absolute % BigInt(100)).toString().padStart(2, "0")} ${currency}`;
}
function fail(): never { throw new Error("Finance entry is unavailable."); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail(); }
function text(value: unknown, max = 1000): string { return typeof value === "string" && value.length <= max ? value : fail(); }
function id(value: unknown): string { return parseSalesUuid(value) ?? fail(); }
function bool(value: unknown): boolean { return typeof value === "boolean" ? value : fail(); }
function integer(value: unknown, signed = false): string { const result = text(value, 40); return (signed ? /^-?\d+$/ : /^\d+$/).test(result) ? result : fail(); }
function currency(value: unknown): string { const result = text(value, 3); return /^[A-Z]{3}$/.test(result) ? result : fail(); }
function time(value: unknown): string { const result = text(value, 40); return Number.isFinite(Date.parse(result)) ? result : fail(); }
function list(value: unknown, max: number): unknown[] { return Array.isArray(value) && value.length <= max ? value : fail(); }
export function parseFinanceEntryWorkspace(value: unknown, organizationId: string, caseId: string): FinanceEntryWorkspace {
  const r = record(value);
  if (r.organization_id !== organizationId || r.case_id !== caseId) fail();
  const obligations = list(r.obligations, 200).map(value => { const o = record(value); return { id: id(o.id), label: text(o.label), currency: currency(o.currency), amountMinor: integer(o.amount_minor), outstandingMinor: integer(o.outstanding_minor), dueAt: time(o.due_at) }; });
  const ids = new Set(obligations.map(o => o.id));
  if (ids.size !== obligations.length) fail();
  const events: FinancePayment[] = list(r.events, 1000).map(value => { const e = record(value), type = e.type;
    if (type !== "payment" && type !== "refund") fail();
    const obligationId = id(e.obligation_id); if (!ids.has(obligationId)) fail();
    return { id: id(e.id), obligationId, type: type as FinancePayment["type"], amountMinor: integer(e.amount_minor), currency: currency(e.currency), occurredAt: time(e.occurred_at), refundableMinor: integer(e.refundable_minor) };
  });
  if (new Set(events.map(e => e.id)).size !== events.length) fail();
  return { caseId, obligations, events, canCreate: bool(r.can_create), canRecord: bool(r.can_record), canReadEvents: bool(r.can_read_events) };
}
export function parseMonthlyPaymentSummary(value: unknown, organizationId: string, year: number, month: number): readonly MonthlyPaymentTotal[] {
  const r = record(value); if (r.organization_id !== organizationId || r.year !== year || r.month !== month) fail();
  const totals = list(r.totals, 200).map(value => { const t = record(value), paymentsMinor = integer(t.payments_minor), refundsMinor = integer(t.refunds_minor), netMinor = integer(t.net_minor, true);
    if (BigInt(paymentsMinor) - BigInt(refundsMinor) !== BigInt(netMinor)) fail();
    return { currency: currency(t.currency), paymentsMinor, refundsMinor, netMinor, eventCount: integer(t.event_count) };
  });
  if (new Set(totals.map(t => t.currency)).size !== totals.length) fail();
  return totals;
}
