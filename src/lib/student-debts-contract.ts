import { parseSalesUuid } from "./platform-sales-register-contract.ts";

/**
 * «Долги студентов» (миграция 332, `platform.student_debts_v1`): строка — одно дело в одной валюте; стоимость договора, оплачено
 * (платежи минус возвраты) и долг в минимальных единицах валюты как хранятся, без пересчёта. Разбор строгий: ответ другой формы —
 * ошибка, а не пустая таблица.
 */
export type StudentDebtRow = Readonly<{
  caseId: string; studentName: string; country: string; direction: string | null; curator: string | null;
  currency: string; costMinor: number; paidMinor: number; debtMinor: number;
}>;
export type StudentDebtTotal = Readonly<{ currency: string; costMinor: number; paidMinor: number; debtMinor: number; caseCount: number }>;
export type StudentDebts = Readonly<{ rows: readonly StudentDebtRow[]; totals: readonly StudentDebtTotal[]; caseRowCount: number; truncated: boolean }>;
export type StudentDebtsRead =
  | Readonly<{ status: "available"; debts: StudentDebts }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "unavailable" }>;

function fail(): never { throw new Error("Student debts are unavailable."); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))) fail();
  return record;
}
const text = (value: unknown, max = 500): string => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : fail();
const optional = (value: unknown): string | null => value === null ? null : text(value);
const money = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const currency = (value: unknown): string => typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : fail();

export function parseStudentDebts(raw: unknown, organizationId: string): StudentDebts {
  const r = exact(raw, ["schema_version", "organization_id", "rows", "totals", "case_row_count", "truncated"]);
  if (r.schema_version !== 1 || r.organization_id !== organizationId || typeof r.truncated !== "boolean") fail();
  if (!Array.isArray(r.rows) || r.rows.length > 500 || !Array.isArray(r.totals) || r.totals.length > 20) fail();
  const rows = r.rows.map((item) => {
    const row = exact(item, ["case_id", "student_name", "country", "direction", "curator", "currency", "cost_minor", "paid_minor", "debt_minor"]);
    const caseId = parseSalesUuid(row.case_id) ?? fail();
    const costMinor = money(row.cost_minor); const paidMinor = money(row.paid_minor); const debtMinor = money(row.debt_minor);
    if (debtMinor <= 0 || costMinor - paidMinor !== debtMinor) fail();
    return Object.freeze({ caseId, studentName: text(row.student_name), country: text(row.country), direction: optional(row.direction), curator: optional(row.curator),
      currency: currency(row.currency), costMinor, paidMinor, debtMinor });
  });
  const totals = r.totals.map((item) => {
    const total = exact(item, ["currency", "cost_minor", "paid_minor", "debt_minor", "case_count"]);
    return Object.freeze({ currency: currency(total.currency), costMinor: money(total.cost_minor), paidMinor: money(total.paid_minor),
      debtMinor: money(total.debt_minor), caseCount: money(total.case_count) });
  });
  if (new Set(totals.map((total) => total.currency)).size !== totals.length) fail();
  const caseRowCount = money(r.case_row_count);
  if (caseRowCount < rows.length || r.truncated !== (caseRowCount > rows.length)) fail();
  return Object.freeze({ rows: Object.freeze(rows), totals: Object.freeze(totals), caseRowCount, truncated: r.truncated });
}
