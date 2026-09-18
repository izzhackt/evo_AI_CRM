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
