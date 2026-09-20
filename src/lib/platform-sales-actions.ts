"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformMutationCapability } from "./platform-guards";
import {
  mutatePlatformSalesLeadWorkflow,
  parsePlatformSalesStage,
  parsePlatformSalesUuid,
  PlatformSalesWorkflowMutationError,
  type PlatformSalesStage,
  type PlatformSalesWorkflowMutationInput,
} from "./platform-sales";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";
import {
  CONDITIONS_BUDGET_PERIODS,
  SALE_CONDITION_CURRENCIES,
  type ConditionsBudgetPeriod,
  type SaleConditionCurrency,
} from "./lead-sale-conditions-contract";
import { parseSalesDate, parseSalesInteger } from "./platform-sales-register-contract";

const REQUEST_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const WORKFLOW_FORM_FIELDS = [
  "lead_id",
  "expected_version",
  "request_id",
  "stage_key",
  "current_owner_membership_id",
  "next_action_text",
  "next_action_due_date",
  "clear_next_action",
  "reason",
] as const;

export type PlatformSalesWorkflowActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "unavailable";

export type PlatformSalesWorkflowActionState = Readonly<{
  status: PlatformSalesWorkflowActionStatus;
  requestId: string;
  version: string | null;
  changedAt: string | null;
}>;

function boundedOptionalText(
  value: string | undefined,
  maximumLength: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function validDate(value: string): string | null {
  if (!DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function validVersion(value: string | undefined): string | null {
  if (
    value === undefined ||
    !/^[1-9]\d*$/.test(value) ||
    value.length > POSTGRES_BIGINT_MAX.length ||
    (value.length === POSTGRES_BIGINT_MAX.length &&
      value > POSTGRES_BIGINT_MAX)
  ) {
    return null;
  }
  return value;
}

function parseInput(form: FormData): PlatformSalesWorkflowMutationInput | null {
  const fields = exactActionStringFields(form, WORKFLOW_FORM_FIELDS);
  if (!fields) return null;

  const leadId = parsePlatformSalesUuid(fields.get("lead_id"));
  const expectedWorkflowVersion = validVersion(fields.get("expected_version"));
  const requestIdValue = fields.get("request_id");
  const requestId =
    requestIdValue && REQUEST_UUID_PATTERN.test(requestIdValue)
      ? requestIdValue.toLowerCase()
      : null;
  const stageKey = parsePlatformSalesStage(fields.get("stage_key"));
  const ownerValue = fields.get("current_owner_membership_id")?.trim();
  const ownerMembershipId = ownerValue
    ? parsePlatformSalesUuid(ownerValue)
    : null;
  const nextActionText = boundedOptionalText(
    fields.get("next_action_text"),
    500,
  );
  const nextActionDateValue = fields.get("next_action_due_date")?.trim();
  const nextActionDueDate = nextActionDateValue
    ? validDate(nextActionDateValue)
    : null;
  const clearValue = fields.get("clear_next_action");
  const clearNextAction = clearValue === "true"
    ? true
    : clearValue === "false"
      ? false
      : null;
  const reason = boundedOptionalText(fields.get("reason"), 500);

  if (
    !leadId ||
    !expectedWorkflowVersion ||
    !requestId ||
    !stageKey ||
    (ownerValue !== "" && !ownerMembershipId) ||
    nextActionText === undefined ||
    (nextActionDateValue !== "" && !nextActionDueDate) ||
    clearNextAction === null ||
    reason === undefined ||
    (clearNextAction &&
      (nextActionText !== null || nextActionDueDate !== null)) ||
    (!clearNextAction &&
      (nextActionText === null || nextActionDueDate === null))
  ) {
    return null;
  }

  return Object.freeze({
    leadId,
    expectedWorkflowVersion,
    requestId,
    stageKey: stageKey as PlatformSalesStage,
    ownerMembershipId,
    nextActionText,
    nextActionDueDate,
    clearNextAction,
    reason,
  });
}

function submittedRequestId(form: FormData): string | null {
  const directValues = form.getAll("request_id");
  const envelopeValues = form.getAll("_1_request_id");
  const values = directValues.length > 0 ? directValues : envelopeValues;
  const value = values.length === 1 ? values[0] : null;
  return typeof value === "string" && REQUEST_UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function failureState(
  form: FormData,
  status: Exclude<PlatformSalesWorkflowActionStatus, "idle" | "saved">,
  verifiedRequestId?: string,
): PlatformSalesWorkflowActionState {
  const requestId = verifiedRequestId ?? submittedRequestId(form);
  return Object.freeze({
    status,
    requestId:
      status === "request_conflict" ? randomUUID() : (requestId ?? randomUUID()),
    version: null,
    changedAt: null,
  });
}

export async function updatePlatformSalesWorkflowAction(
  _previous: PlatformSalesWorkflowActionState,
  form: FormData,
): Promise<PlatformSalesWorkflowActionState> {
  const actor = await requirePlatformMutationCapability("sales.write", "/v3/pipeline");
  const input = parseInput(form);
  if (!input) return failureState(form, "invalid");

  try {
    const receipt = await mutatePlatformSalesLeadWorkflow(actor, input);
    revalidatePath("/v3/pipeline");
    revalidatePath(`/v3/profile?id=${receipt.leadId}`);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      version: receipt.workflowVersion,
      changedAt: receipt.changedAt,
    });
  } catch (error) {
    if (error instanceof PlatformSalesWorkflowMutationError) {
      return failureState(form, error.reason, input.requestId);
    }
    return failureState(form, "unavailable", input.requestId);
  }
}

/**
 * «Условия продажи» (unified workflow S2, plan §5/§6): the lead-card block.
 * Saving it never adds a row to the sales report — only the report's own
 * «Сохранить» does that, reading these exact fields back through
 * platform.create_sales_report_handoff.
 */
const SALE_CONDITIONS_FORM_FIELDS = [
  "lead_id",
  "expected_revision",
  "request_id",
  "service_label",
  "signing_date",
  "service_cost_raw",
  "service_cost_minor",
  "service_cost_currency",
  "paid_raw",
  "paid_minor",
  "paid_currency",
  "payment_note",
  // «Пожелания» / «Образование» / «Условия» (unified workflow S7, plan §5):
  // the row is one revision-versioned whole (181's save RPC still replaces it
  // whole, unchanged), so every progressive-fill block submits the FULL key
  // set — see LeadCardFieldsForm.tsx.
  "wishes_countries",
  "wishes_study_fields",
  "wishes_education_level",
  "wishes_intake_year",
  "wishes_intake_season",
  "wishes_universities",
  "education_current",
  "education_grade",
  "education_marks",
  "education_english",
  "education_certificates",
  "conditions_budget_raw",
  "conditions_budget_minor",
  "conditions_budget_currency",
  "conditions_budget_period",
  "conditions_scholarship",
  "conditions_note",
] as const;

/** Plain bounded text keys (own max length), shared by the four card blocks. */
const SALE_CONDITIONS_TEXT_FIELD_LIMITS: Readonly<Record<string, number>> = {
  service_label: 300,
  payment_note: 2000,
  wishes_countries: 500,
  wishes_study_fields: 500,
  wishes_education_level: 200,
  wishes_intake_season: 100,
  wishes_universities: 2000,
  education_current: 300,
  education_grade: 100,
  education_marks: 300,
  education_english: 300,
  education_certificates: 2000,
  conditions_scholarship: 500,
  conditions_note: 2000,
};
const SALE_CONDITIONS_MONEY_PAIR_PREFIXES = ["service_cost", "paid", "conditions_budget"] as const;

export type SaveLeadSaleConditionsActionState = Readonly<{
  status: PlatformSalesWorkflowActionStatus;
  requestId: string;
  leadId: string | null;
  revision: string | null;
}>;

function saleConditionsOutcome(
  form: FormData,
  status: PlatformSalesWorkflowActionStatus,
  revision?: string,
): SaveLeadSaleConditionsActionState {
  const requestIdValue = form.get("request_id");
  const leadIdValue = form.get("lead_id");
  return Object.freeze({
    status,
    requestId: status === "saved" || status === "request_conflict"
      ? randomUUID()
      : (typeof requestIdValue === "string" && REQUEST_UUID_PATTERN.test(requestIdValue)
        ? requestIdValue.toLowerCase()
        : randomUUID()),
    leadId: typeof leadIdValue === "string" ? parsePlatformSalesUuid(leadIdValue) : null,
    revision: revision ?? null,
  });
}

export async function saveLeadSaleConditionsAction(
  _previous: SaveLeadSaleConditionsActionState,
  form: FormData,
): Promise<SaveLeadSaleConditionsActionState> {
  const actor = await requirePlatformMutationCapability("sales.write", "/v3/profile");
  const fields = exactActionStringFields(form, SALE_CONDITIONS_FORM_FIELDS);
  if (!fields) return saleConditionsOutcome(form, "invalid");
  const leadId = parsePlatformSalesUuid(fields.get("lead_id"));
  const requestIdValue = fields.get("request_id") ?? "";
  const requestId = REQUEST_UUID_PATTERN.test(requestIdValue) ? requestIdValue.toLowerCase() : null;
  const revision = parseSalesInteger(fields.get("expected_revision"));
  if (!leadId || !requestId || revision === null) return saleConditionsOutcome(form, "invalid");

  const signingDateRaw = fields.get("signing_date") ?? "";
  const serviceCostRaw = fields.get("service_cost_raw") ?? "";
  const paidRaw = fields.get("paid_raw") ?? "";
  const conditionsBudgetRaw = fields.get("conditions_budget_raw") ?? "";
  const wishesIntakeYear = fields.get("wishes_intake_year") ?? "";
  const conditionsBudgetPeriod = fields.get("conditions_budget_period") ?? "";
  if (
    serviceCostRaw.length > 300 ||
    paidRaw.length > 300 ||
    conditionsBudgetRaw.length > 300 ||
    (signingDateRaw !== "" && !parseSalesDate(signingDateRaw)) ||
    (wishesIntakeYear !== "" && !/^(19|20|21)[0-9]{2}$/.test(wishesIntakeYear)) ||
    (conditionsBudgetPeriod !== "" && !CONDITIONS_BUDGET_PERIODS.includes(conditionsBudgetPeriod as ConditionsBudgetPeriod))
  ) {
    return saleConditionsOutcome(form, "invalid");
  }
  const payload: Record<string, string | number | null> = {
    signing_date: signingDateRaw === "" ? null : signingDateRaw,
    service_cost_raw: serviceCostRaw,
    paid_raw: paidRaw,
    conditions_budget_raw: conditionsBudgetRaw,
    wishes_intake_year: wishesIntakeYear,
    conditions_budget_period: conditionsBudgetPeriod,
  };
  for (const [key, max] of Object.entries(SALE_CONDITIONS_TEXT_FIELD_LIMITS)) {
    const value = fields.get(key) ?? "";
    if (value.length > max) return saleConditionsOutcome(form, "invalid");
    payload[key] = value;
  }
  for (const prefix of SALE_CONDITIONS_MONEY_PAIR_PREFIXES) {
    const minorValue = fields.get(`${prefix}_minor`) ?? "";
    const amount = minorValue === "" ? null : parseSalesInteger(minorValue, 1_000_000_000_000);
    const currencyValue = fields.get(`${prefix}_currency`) || null;
    if (
      (minorValue !== "" && amount === null) ||
      (amount === null) !== (currencyValue === null) ||
      (currencyValue !== null && !SALE_CONDITION_CURRENCIES.includes(currencyValue as SaleConditionCurrency))
    ) {
      return saleConditionsOutcome(form, "invalid");
    }
    payload[`${prefix}_minor`] = amount;
    payload[`${prefix}_currency`] = currencyValue;
  }

  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("save_lead_sale_conditions_v1", {
      p_organization_id: actor.organizationId,
      p_request_id: requestId,
      p_lead_id: leadId,
      p_expected_revision: revision,
      p_fields: payload,
    });
    if (error) {
      if (error.code === "42501") return saleConditionsOutcome(form, "forbidden");
      if (error.code === "PT409") return saleConditionsOutcome(form, "stale");
      if ((error.code === "22023" || error.code === "23505") && /request_id/.test(error.message)) {
        return saleConditionsOutcome(form, "request_conflict");
      }
      return saleConditionsOutcome(form, error.code === "22023" ? "invalid" : "unavailable");
    }
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      data.organization_id !== actor.organizationId ||
      data.lead_id !== leadId ||
      parseSalesInteger(data.revision) !== revision + 1
    ) {
      return saleConditionsOutcome(form, "unavailable");
    }
    revalidatePath(`/v3/profile?id=${leadId}`);
    return saleConditionsOutcome(form, "saved", data.revision as string);
  } catch {
    return saleConditionsOutcome(form, "unavailable");
  }
}

/**
 * «Подготовить кабинет» (unified workflow S7, plan §4): for a lead with no
 * linked case and no account yet (site/WhatsApp leads never filled the
 * platform анкета), prepares the SAME pending, curator-less, portal-ready
 * cabinet the анкета-approval path opens (migration 184's
 * platform.prepare_lead_cabinet_v1). This action only prepares the case —
 * it never dispatches an invite; that stays the existing admin-gated
 * StudentPortalAccessCard flow from a real case page (see migration 184's
 * own header for why that flow does not yet fit a cabinet-prepared case).
 */
const PREPARE_LEAD_CABINET_FORM_FIELDS = ["lead_id", "request_id"] as const;

export type PrepareLeadCabinetActionState = Readonly<{
  status: "idle" | "saved" | "invalid" | "forbidden" | "conflict" | "unavailable";
  requestId: string;
  leadId: string | null;
  studentCaseId: string | null;
}>;

function prepareLeadCabinetOutcome(
  form: FormData,
  status: PrepareLeadCabinetActionState["status"],
  studentCaseId: string | null = null,
): PrepareLeadCabinetActionState {
  const requestIdValue = form.get("request_id");
  const leadIdValue = form.get("lead_id");
  return Object.freeze({
    status,
    requestId: status === "saved" || status === "conflict"
      ? randomUUID()
      : (typeof requestIdValue === "string" && REQUEST_UUID_PATTERN.test(requestIdValue)
        ? requestIdValue.toLowerCase()
        : randomUUID()),
    leadId: typeof leadIdValue === "string" ? parsePlatformSalesUuid(leadIdValue) : null,
    studentCaseId,
  });
}

export async function prepareLeadCabinetAction(
  _previous: PrepareLeadCabinetActionState,
  form: FormData,
): Promise<PrepareLeadCabinetActionState> {
  const actor = await requirePlatformMutationCapability("sales.write", "/v3/profile");
  const fields = exactActionStringFields(form, PREPARE_LEAD_CABINET_FORM_FIELDS);
  if (!fields) return prepareLeadCabinetOutcome(form, "invalid");
  const leadId = parsePlatformSalesUuid(fields.get("lead_id"));
  const requestIdValue = fields.get("request_id") ?? "";
  const requestId = REQUEST_UUID_PATTERN.test(requestIdValue) ? requestIdValue.toLowerCase() : null;
  if (!leadId || !requestId) return prepareLeadCabinetOutcome(form, "invalid");

  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("prepare_lead_cabinet_v1", {
      p_organization_id: actor.organizationId,
      p_request_id: requestId,
      p_lead_id: leadId,
    });
    if (error) {
      if (error.code === "42501") return prepareLeadCabinetOutcome(form, "forbidden");
      if (error.code === "PT409") return prepareLeadCabinetOutcome(form, "conflict");
      return prepareLeadCabinetOutcome(form, error.code === "22023" ? "invalid" : "unavailable");
    }
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      data.organization_id !== actor.organizationId ||
      data.lead_id !== leadId ||
      typeof data.student_case_id !== "string"
    ) {
      return prepareLeadCabinetOutcome(form, "unavailable");
    }
    revalidatePath(`/v3/profile?id=${leadId}`);
    return prepareLeadCabinetOutcome(form, "saved", data.student_case_id);
  } catch {
    return prepareLeadCabinetOutcome(form, "unavailable");
  }
}
