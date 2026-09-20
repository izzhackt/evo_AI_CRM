/**
 * «Условия продажи» — unified workflow S2 (plan §5, §6): sale conditions live
 * on the lead card. Filling them in never adds a row to the sales report; the
 * report later reads the same fields through this exact shape (read-only
 * preview) and copies them into the register row server-side.
 *
 * Unified workflow S7 (docs/PLAN_CHANGES.md «unified workflow S7») widens the
 * same card-fields store with three more progressive-fill blocks —
 * «Пожелания», «Образование», «Условия» — sharing this one revision-versioned
 * row (migration 184's platform_private.lead_sale_condition_fields()). The
 * save RPC still replaces the WHOLE row on every save (181, unchanged), so
 * every field below round-trips through this same contract regardless of
 * which card block a given save came from — see LeadCardFieldsForm.tsx for
 * how each block submits its own edited slice alongside the other blocks'
 * unedited, current values.
 */
import { SALES_CURRENCIES, parseSalesDate, parseSalesInteger, parseSalesUuid, type SalesCurrency } from "./platform-sales-register-contract";

export const SALE_CONDITION_CURRENCIES = SALES_CURRENCIES;
export type SaleConditionCurrency = SalesCurrency;
export const CONDITIONS_BUDGET_PERIODS = ["year", "program"] as const;
export type ConditionsBudgetPeriod = (typeof CONDITIONS_BUDGET_PERIODS)[number];

export type LinkedSalesRegisterRow = Readonly<{ id: string; reportMonth: string; archived: boolean }>;

export type LeadSaleConditions = Readonly<{
  leadId: string; organizationId: string; revision: number;
  serviceLabel: string; signingDate: string | null;
  serviceCostRaw: string; serviceCostMinor: number | null; serviceCostCurrency: SaleConditionCurrency | null;
  paidRaw: string; paidMinor: number | null; paidCurrency: SaleConditionCurrency | null;
  paymentNote: string;
  /** «Пожелания» (unified workflow S7, plan §5). */
  wishesCountries: string;
  wishesStudyFields: string;
  wishesEducationLevel: string;
  wishesIntakeYear: string;
  wishesIntakeSeason: string;
  wishesUniversities: string;
  /** «Образование» (unified workflow S7, plan §5). */
  educationCurrent: string;
  educationGrade: string;
  educationMarks: string;
  educationEnglish: string;
  educationCertificates: string;
  /** «Условия» (unified workflow S7, plan §5) — distinct from «Условия продажи» above. */
  conditionsBudgetRaw: string; conditionsBudgetMinor: number | null; conditionsBudgetCurrency: SaleConditionCurrency | null;
  conditionsBudgetPeriod: ConditionsBudgetPeriod | null;
  conditionsScholarship: string;
  conditionsNote: string;
  updatedByMembershipId: string | null; updatedAt: string | null;
  linkedSalesRegister: LinkedSalesRegisterRow | null;
}>;

function fail(): never { throw new Error("Sale conditions are unavailable."); }
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
  return typeof value === "string" && [...value].length <= max
    && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) ? value : fail();
}
function num(value: unknown, max = Number.MAX_SAFE_INTEGER): number { return parseSalesInteger(value, max) ?? fail(); }
function uuid(value: unknown): string { return parseSalesUuid(value) ?? fail(); }
function date(value: unknown): string { return parseSalesDate(value) ?? fail(); }
function currency(value: unknown): SaleConditionCurrency {
  return SALE_CONDITION_CURRENCIES.includes(value as SaleConditionCurrency) ? value as SaleConditionCurrency : fail();
}
function budgetPeriod(value: unknown): ConditionsBudgetPeriod | null {
  if (value === "" || value === null) return null;
  return (CONDITIONS_BUDGET_PERIODS as readonly string[]).includes(value as string) ? value as ConditionsBudgetPeriod : fail();
}
function intakeYear(value: unknown): string {
  // Migration 184 normalizes an unfilled year to JSON null.
  if (value === null) return "";
  const text = str(value, 4);
  return text === "" || /^(19|20|21)[0-9]{2}$/.test(text) ? text : fail();
}

export function parseLeadSaleConditions(raw: unknown, organizationId: string): LeadSaleConditions {
  const r = exact(raw, ["organization_id", "lead_id", "revision", "service_label", "signing_date",
    "service_cost_raw", "service_cost_minor", "service_cost_currency", "paid_raw", "paid_minor", "paid_currency",
    "payment_note",
    "wishes_countries", "wishes_study_fields", "wishes_education_level", "wishes_intake_year",
    "wishes_intake_season", "wishes_universities",
    "education_current", "education_grade", "education_marks", "education_english", "education_certificates",
    "conditions_budget_raw", "conditions_budget_minor", "conditions_budget_currency", "conditions_budget_period",
    "conditions_scholarship", "conditions_note",
    "updated_by_membership_id", "updated_at", "linked_sales_register"]);
  if (r.organization_id !== organizationId) fail();
  const revision = num(r.revision); if (revision < 0) fail();
  const serviceCostMinor = r.service_cost_minor === null ? null : num(r.service_cost_minor, 1_000_000_000_000);
  const serviceCostCurrency = r.service_cost_currency === null ? null : currency(r.service_cost_currency);
  const paidMinor = r.paid_minor === null ? null : num(r.paid_minor, 1_000_000_000_000);
  const paidCurrency = r.paid_currency === null ? null : currency(r.paid_currency);
  if ((serviceCostMinor === null) !== (serviceCostCurrency === null) || (paidMinor === null) !== (paidCurrency === null)) fail();
  const conditionsBudgetMinor = r.conditions_budget_minor === null ? null : num(r.conditions_budget_minor, 1_000_000_000_000);
  const conditionsBudgetCurrency = r.conditions_budget_currency === null ? null : currency(r.conditions_budget_currency);
  if ((conditionsBudgetMinor === null) !== (conditionsBudgetCurrency === null)) fail();
  const linked = r.linked_sales_register === null ? null : (() => {
    const l = exact(r.linked_sales_register, ["id", "report_month", "archived"]);
    if (typeof l.archived !== "boolean") fail();
    return { id: uuid(l.id), reportMonth: date(l.report_month), archived: l.archived as boolean };
  })();
  return {
    leadId: uuid(r.lead_id), organizationId, revision,
    serviceLabel: str(r.service_label, 300), signingDate: r.signing_date === null ? null : date(r.signing_date),
    serviceCostRaw: str(r.service_cost_raw, 300), serviceCostMinor, serviceCostCurrency,
    paidRaw: str(r.paid_raw, 300), paidMinor, paidCurrency,
    paymentNote: str(r.payment_note, 2000),
    wishesCountries: str(r.wishes_countries, 500),
    wishesStudyFields: str(r.wishes_study_fields, 500),
    wishesEducationLevel: str(r.wishes_education_level, 200),
    wishesIntakeYear: intakeYear(r.wishes_intake_year),
    wishesIntakeSeason: str(r.wishes_intake_season, 100),
    wishesUniversities: str(r.wishes_universities, 2000),
    educationCurrent: str(r.education_current, 300),
    educationGrade: str(r.education_grade, 100),
    educationMarks: str(r.education_marks, 300),
    educationEnglish: str(r.education_english, 300),
    educationCertificates: str(r.education_certificates, 2000),
    conditionsBudgetRaw: str(r.conditions_budget_raw, 300), conditionsBudgetMinor, conditionsBudgetCurrency,
    conditionsBudgetPeriod: budgetPeriod(r.conditions_budget_period),
    conditionsScholarship: str(r.conditions_scholarship, 500),
    conditionsNote: str(r.conditions_note, 2000),
    updatedByMembershipId: r.updated_by_membership_id === null ? null : uuid(r.updated_by_membership_id),
    updatedAt: r.updated_at === null ? null : str(r.updated_at, 64),
    linkedSalesRegister: linked,
  };
}
