import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionSource = readFileSync(
  new URL("../src/lib/platform-sales-actions.ts", import.meta.url),
  "utf8",
);

test("platform Sales workflow action keeps the exact reviewed form boundary", () => {
  for (const field of [
    "lead_id",
    "expected_version",
    "request_id",
    "stage_key",
    "current_owner_membership_id",
    "next_action_text",
    "next_action_due_date",
    "clear_next_action",
    "reason",
  ]) {
    assert.match(actionSource, new RegExp(`"${field}"`));
  }
  assert.match(actionSource, /exactActionStringFields\(form, WORKFLOW_FORM_FIELDS\)/);
  assert.match(actionSource, /REQUEST_UUID_PATTERN/);
  assert.match(actionSource, /POSTGRES_BIGINT_MAX/);
  assert.match(actionSource, /clearValue === "true"/);
  assert.match(actionSource, /clearValue === "false"/);
});

test("platform Sales workflow action is staff-bound and revalidates only verified success", () => {
  assert.match(actionSource, /await requirePlatformMutationCapability\("sales\.write", "\/v3\/pipeline"\)/);
  assert.match(
    actionSource,
    /const receipt = await mutatePlatformSalesLeadWorkflow\(actor, input\);[\s\S]*revalidatePath\("\/v3\/pipeline"\);[\s\S]*revalidatePath\(`\/v3\/profile\?id=\$\{receipt\.leadId\}`\)/,
  );
  assert.doesNotMatch(actionSource, /revalidatePath\("\/sales"\)/);
  assert.doesNotMatch(
    actionSource,
    /revalidatePath\(`\/sales\/\$\{receipt\.leadId\}`\)/,
  );
  assert.doesNotMatch(actionSource, /revalidatePath\("\/v3\/profile"\)/);
  assert.match(actionSource, /error instanceof PlatformSalesWorkflowMutationError/);
  assert.match(actionSource, /failureState\(form, error\.reason, input\.requestId\)/);
  assert.doesNotMatch(
    actionSource,
    /DATABASE_URL|service[_-]?role|Drizzle|canonical-crm-repository|fallback/i,
  );
});

test("platform Sales workflow action exposes only safe UI statuses and rotates request conflicts", () => {
  for (const status of [
    "idle",
    "saved",
    "invalid",
    "forbidden",
    "stale",
    "request_conflict",
    "unavailable",
  ]) {
    assert.match(actionSource, new RegExp(`\\| "${status}"|=\\n  \\| "${status}"`));
  }
  assert.match(
    actionSource,
    /status === "request_conflict" \? randomUUID\(\) : \(requestId \?\? randomUUID\(\)\)/,
  );
  assert.match(actionSource, /status: "saved" as const,[\s\S]*requestId: randomUUID\(\)/);
  assert.match(actionSource, /version: receipt\.workflowVersion/);
  assert.match(actionSource, /changedAt: receipt\.changedAt/);
});

// Unified workflow S2 (plan §5/§6): «Условия продажи» lives on the lead
// card. Saving it never adds a sales-report row — only
// platform.create_sales_report_handoff (the report's own «Сохранить») does.
test("saveLeadSaleConditionsAction keeps the exact reviewed card-block form boundary", () => {
  for (const field of [
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
  ]) {
    assert.match(actionSource, new RegExp(`"${field}"`));
  }
  assert.match(actionSource, /exactActionStringFields\(form, SALE_CONDITIONS_FORM_FIELDS\)/);
  assert.match(actionSource, /await requirePlatformMutationCapability\("sales\.write", "\/v3\/profile"\)/);
});

test("saveLeadSaleConditionsAction is staff-bound, validates money pairs and revalidates only the exact lead route on success", () => {
  assert.match(
    actionSource,
    /const \{ data, error \} = await client\.schema\("platform"\)\.rpc\("save_lead_sale_conditions_v1", \{[\s\S]*p_organization_id: actor\.organizationId,[\s\S]*p_request_id: requestId,[\s\S]*p_lead_id: leadId,[\s\S]*p_expected_revision: revision,[\s\S]*p_fields: payload,/,
  );
  assert.match(
    actionSource,
    /\(amount === null\) !== \(currencyValue === null\)/,
  );
  assert.match(actionSource, /revalidatePath\(`\/v3\/profile\?id=\$\{leadId\}`\)/);
  assert.doesNotMatch(actionSource, /revalidatePath\("\/v3\/profile"\)/);
  assert.match(actionSource, /error\.code === "PT409"\) return saleConditionsOutcome\(form, "stale"\)/);
  assert.match(
    actionSource,
    /\(error\.code === "22023" \|\| error\.code === "23505"\) && \/request_id\/\.test\(error\.message\)\) \{\s*return saleConditionsOutcome\(form, "request_conflict"\);/,
  );
});

// Unified workflow S7 (plan §5): «Пожелания» / «Образование» / «Условия»
// share the SAME row/RPC as «Условия продажи» above — the allowlist widens,
// the action itself (gate, RPC name, replay/error mapping) stays identical.
test("saveLeadSaleConditionsAction's form boundary widens to the three new S7 card-block key families", () => {
  for (const field of [
    "wishes_countries", "wishes_study_fields", "wishes_education_level", "wishes_intake_year",
    "wishes_intake_season", "wishes_universities",
    "education_current", "education_grade", "education_marks", "education_english", "education_certificates",
    "conditions_budget_raw", "conditions_budget_minor", "conditions_budget_currency", "conditions_budget_period",
    "conditions_scholarship", "conditions_note",
  ]) {
    assert.match(actionSource, new RegExp(`"${field}"`), `${field} missing from SALE_CONDITIONS_FORM_FIELDS`);
  }
  assert.match(actionSource, /SALE_CONDITIONS_MONEY_PAIR_PREFIXES = \["service_cost", "paid", "conditions_budget"\]/);
  assert.match(actionSource, /wishesIntakeYear !== "" && !\/\^\(19\|20\|21\)\[0-9\]\{2\}\$\/\.test\(wishesIntakeYear\)/);
  assert.match(
    actionSource,
    /conditionsBudgetPeriod !== "" && !CONDITIONS_BUDGET_PERIODS\.includes\(conditionsBudgetPeriod as ConditionsBudgetPeriod\)/,
  );
});

// Unified workflow S7 (plan §4): «Подготовить кабинет» only prepares the
// case — invite dispatch stays the existing admin-gated 126 flow.
test("prepareLeadCabinetAction keeps a narrow form boundary and calls prepare_lead_cabinet_v1 exactly", () => {
  assert.match(actionSource, /const PREPARE_LEAD_CABINET_FORM_FIELDS = \["lead_id", "request_id"\]/);
  assert.match(actionSource, /exactActionStringFields\(form, PREPARE_LEAD_CABINET_FORM_FIELDS\)/);
  assert.match(actionSource, /await requirePlatformMutationCapability\("sales\.write", "\/v3\/profile"\)/);
  assert.match(
    actionSource,
    /await client\.schema\("platform"\)\.rpc\("prepare_lead_cabinet_v1", \{\s*p_organization_id: actor\.organizationId,\s*p_request_id: requestId,\s*p_lead_id: leadId,/,
  );
  assert.match(actionSource, /error\.code === "PT409"\) return prepareLeadCabinetOutcome\(form, "conflict"\)/);
  assert.match(actionSource, /error\.code === "42501"\) return prepareLeadCabinetOutcome\(form, "forbidden"\)/);
  assert.match(actionSource, /revalidatePath\(`\/v3\/profile\?id=\$\{leadId\}`\)/);
});
