/** The sales report is a reporting snapshot, never payment evidence. */
export const SALES_CURRENCIES = ["USD", "EUR", "KGS"] as const;
export type SalesCurrency = (typeof SALES_CURRENCIES)[number];
export type SalesRegisterRow = Readonly<{
  id: string; version: number; reportMonth: string; signingDate: string | null;
  applicantName: string; phone: string; country: string; university: string;
  program: string; direction: string; intake: string; contractNumber: string;
  managerLabel: string; statusRaw: string; ownerMembershipId: string | null;
  serviceCostRaw: string; serviceCostMinor: number | null; serviceCostCurrency: SalesCurrency | null;
  paidRaw: string; paidMinor: number | null; paidCurrency: SalesCurrency | null;
  needsReview: boolean; notes: string; archived: boolean; sourceKey: string | null;
  sourceKind: "manual" | "import" | "pipeline"; leadId: string | null; clientId: string | null;
  sourceSha256: string | null; sourceSheet: string | null; sourceRow: number | null; updatedAt: string;
}>;
export type SalesRegisterTarget = Readonly<{
  id: string; version: number; reportMonth: string; managerLabel: string | null; targetCount: number;
}>;
export type SalesRegisterWorkspace = Readonly<{
  year: number; month: number | null; totalCount: number; rows: readonly SalesRegisterRow[];
  selected: SalesRegisterRow | null; offset: number; hasMore: boolean;
  totals: readonly Readonly<{ currency: SalesCurrency; costMinor: number; paidMinor: number }>[];
  unresolvedCostCount: number; unresolvedPaidCount: number;
  targets: readonly SalesRegisterTarget[]; managerLabels: readonly string[];
  ownerOptions: readonly Readonly<{ id: string; label: string }>[];
}>;

export function parseSalesUuid(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}
export function parseSalesDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= "2100-12-31" ? value : null;
}
export function parseSalesInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
}
function fail(): never { throw new Error("Sales register is unavailable."); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = record(value);
  if (Object.keys(result).length !== keys.length || Object.keys(result).some(key => !keys.includes(key))) fail();
  return result;
}
function str(value: unknown, max = 2000): string {
  return typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : fail();
}
function num(value: unknown, max = Number.MAX_SAFE_INTEGER): number { return parseSalesInteger(value, max) ?? fail(); }
function uuid(value: unknown): string { return parseSalesUuid(value) ?? fail(); }
function date(value: unknown): string { return parseSalesDate(value) ?? fail(); }
function monthDate(value: unknown): string { const result = date(value); return result.endsWith("-01") ? result : fail(); }
function bool(value: unknown): boolean { return typeof value === "boolean" ? value : fail(); }
function currency(value: unknown): SalesCurrency {
  return SALES_CURRENCIES.includes(value as SalesCurrency) ? value as SalesCurrency : fail();
}
function array(value: unknown, max: number): unknown[] { return Array.isArray(value) && value.length <= max ? value : fail(); }

export function parseSalesRegisterRow(raw: unknown): SalesRegisterRow {
  const r = exact(raw, ["id", "version", "report_month", "signing_date", "applicant_name", "phone", "country", "university", "program", "direction", "intake",
    "contract_number", "manager_label", "status_raw", "owner_membership_id", "service_cost_raw", "service_cost_minor", "service_cost_currency", "paid_raw", "paid_minor",
    "paid_currency", "needs_review", "notes", "archived", "source_kind", "lead_id", "client_id", "source_key", "source_sha256", "source_sheet", "source_row", "updated_at"]);
  const serviceCostMinor = r.service_cost_minor === null ? null : num(r.service_cost_minor, 1_000_000_000_000);
  const serviceCostCurrency = r.service_cost_currency === null ? null : currency(r.service_cost_currency);
  const paidMinor = r.paid_minor === null ? null : num(r.paid_minor, 1_000_000_000_000);
  const paidCurrency = r.paid_currency === null ? null : currency(r.paid_currency);
  if ((serviceCostMinor === null) !== (serviceCostCurrency === null) || (paidMinor === null) !== (paidCurrency === null)) fail();
  const version = num(r.version); if (version < 1) fail();
  const updatedAt = str(r.updated_at, 64); if (!Number.isFinite(Date.parse(updatedAt))) fail();
  const sourceKey = r.source_key === null ? null : str(r.source_key, 400);
  const sourceSha256 = r.source_sha256 === null ? null : str(r.source_sha256, 64);
  const sourceSheet = r.source_sheet === null ? null : str(r.source_sheet, 150);
  const sourceRow = r.source_row === null ? null : num(r.source_row, 100000);
  if (sourceKey !== null && (!sourceKey || !sourceSha256 || !/^[a-f0-9]{64}$/.test(sourceSha256) || !sourceSheet || !sourceRow)) fail();
  if (sourceKey === null && (sourceSha256 !== null || sourceSheet !== null || sourceRow !== null)) fail();
  const sourceKind = r.source_kind; if (sourceKind !== "manual" && sourceKind !== "import" && sourceKind !== "pipeline") fail();
  const leadId = r.lead_id === null ? null : uuid(r.lead_id);
  const clientId = r.client_id === null ? null : uuid(r.client_id);
  if (sourceKind === "pipeline" ? leadId === null || clientId === null : leadId !== null || clientId !== null) fail();
  if ((sourceKind === "import") !== (sourceKey !== null) || !str(r.applicant_name, 300).trim()) fail();
  return {
    id: uuid(r.id), version, reportMonth: monthDate(r.report_month), signingDate: r.signing_date === null ? null : date(r.signing_date),
    applicantName: str(r.applicant_name, 300), phone: str(r.phone, 100), country: str(r.country, 200), university: str(r.university, 500),
    program: str(r.program, 500), direction: str(r.direction, 500), intake: str(r.intake, 200), contractNumber: str(r.contract_number, 200),
    managerLabel: str(r.manager_label, 300), statusRaw: str(r.status_raw), ownerMembershipId: r.owner_membership_id === null ? null : uuid(r.owner_membership_id),
    serviceCostRaw: str(r.service_cost_raw), serviceCostMinor, serviceCostCurrency,
    paidRaw: str(r.paid_raw), paidMinor, paidCurrency, needsReview: bool(r.needs_review), notes: str(r.notes),
    archived: bool(r.archived), sourceKind, leadId, clientId, sourceKey, sourceSha256, sourceSheet, sourceRow, updatedAt,
  };
}
export function parseSalesRegisterWorkspace(raw: unknown, organizationId: string): SalesRegisterWorkspace {
  const r = exact(raw, ["organization_id", "year", "month", "total_count", "rows", "selected", "offset", "has_more", "totals", "unresolved_cost_count", "unresolved_paid_count", "targets", "manager_labels", "owner_options"]);
  if (r.organization_id !== organizationId) fail();
  const year = num(r.year, 2100); if (year < 1900) fail();
  const month = r.month === null ? null : num(r.month, 12); if (month === 0) fail();
  const rows = array(r.rows, 50).map(parseSalesRegisterRow);
  if (new Set(rows.map(row => row.id)).size !== rows.length) fail();
  const totals = array(r.totals, 3).map(value => { const t = exact(value, ["currency", "cost_minor", "paid_minor"]); return { currency: currency(t.currency), costMinor: num(t.cost_minor), paidMinor: num(t.paid_minor) }; });
  if (new Set(totals.map(t => t.currency)).size !== totals.length) fail();
  return { year, month, totalCount: num(r.total_count), rows, selected: r.selected === null ? null : parseSalesRegisterRow(r.selected),
    offset: num(r.offset, 1000000), hasMore: bool(r.has_more), totals,
    unresolvedCostCount: num(r.unresolved_cost_count), unresolvedPaidCount: num(r.unresolved_paid_count),
    targets: array(r.targets, 1200).map(value => { const t = exact(value, ["id", "version", "report_month", "manager_label", "target_count"]); const version = num(t.version); if (!version) fail();
      return { id: uuid(t.id), version, reportMonth: monthDate(t.report_month), managerLabel: t.manager_label === null ? null : str(t.manager_label, 300), targetCount: num(t.target_count, 1000000) }; }),
    managerLabels: array(r.manager_labels, 1000).map(value => str(value, 300)),
    ownerOptions: array(r.owner_options, 1000).map(value => { const owner = exact(value, ["id", "label"]); return { id: uuid(owner.id), label: str(owner.label, 300) }; }),
  };
}
