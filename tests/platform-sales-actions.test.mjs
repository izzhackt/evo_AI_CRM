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
  assert.match(actionSource, /await requirePlatformSalesActor\(\)/);
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
