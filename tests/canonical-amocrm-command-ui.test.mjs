import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

function source(path) {
  const url = new URL(path, root);
  assert.equal(existsSync(url), true, `${path} must exist`);
  return readFileSync(url, "utf8");
}

test("the active Platform amoCRM command panel remains on Admissions Student 360", () => {
  const studentWorkspace = source(
    "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
  );
  const admissions = source(
    "src/app/(staff)/clients/[id]/PlatformAmoCrmCommandSection.tsx",
  );

  assert.match(admissions, /CanonicalAmoCrmCommandPanel/);
  assert.match(studentWorkspace, /<PlatformAmoCrmCommandSection/);
  assert.ok(
    studentWorkspace.indexOf("<PlatformAdmissionsOperationsPanel") <
      studentWorkspace.indexOf("<PlatformAmoCrmCommandSection"),
    "Supabase Admissions operations must remain ahead of the isolated #549 amoCRM command section",
  );
  assert.match(
    admissions,
    /<CanonicalAmoCrmCommandPanel[\s\S]*providerDispatchedAt: blockingAttempt\.providerDispatchedAt[\s\S]*scope="admissions"[\s\S]*leadId=\{leadId\}[\s\S]*studentCaseId=\{studentCaseId\}/,
  );
  assert.match(admissions, /readPlatformBlockingAmoCrmCommand/);
  assert.match(admissions, /createSupabaseServerClient\(\)/);
  assert.match(studentWorkspace, /organizationId=\{actor\.organizationId\}/);
  assert.match(
    admissions,
    /data-testid="amocrm-case-command-section"/,
  );
  assert.match(admissions, /blockingAttempt=/);
});

test("the canonical Sales detail mounts the same Supabase-backed amoCRM command path", () => {
  const salesWorkspace = source(
    "src/app/(staff)/sales/[id]/SalesLeadWorkspace.tsx",
  );
  const salesSection = source(
    "src/app/(staff)/sales/[id]/PlatformSalesAmoCrmCommandSection.tsx",
  );

  assert.match(salesWorkspace, /<PlatformSalesAmoCrmCommandSection/);
  assert.match(salesWorkspace, /organizationId=\{actor\.organizationId\}/);
  assert.match(salesWorkspace, /authorityRole=\{actor\.authorityRole\}/);
  assert.match(salesWorkspace, /leadId=\{lead\.leadId\}/);
  assert.match(salesWorkspace, /clientId=\{lead\.clientId\}/);
  assert.match(salesSection, /CanonicalAmoCrmCommandPanel/);
  assert.match(salesSection, /readPlatformBlockingAmoCrmCommand/);
  assert.match(salesSection, /createSupabaseServerClient\(\)/);
  assert.match(
    salesSection,
    /workflowScope:\s*"sales_pre_handoff"[\s\S]*workflowLeadId:\s*leadId[\s\S]*studentCaseId:\s*null/,
  );
  assert.match(salesSection, /personId:\s*clientId/);
  assert.match(salesSection, /leadId,/);
  assert.match(
    salesSection,
    /<CanonicalAmoCrmCommandPanel[\s\S]*providerDispatchedAt: blockingAttempt\.providerDispatchedAt[\s\S]*scope="sales"[\s\S]*leadId=\{leadId\}/,
  );
  assert.match(salesSection, /data-testid="sales-amocrm-command-section"/);
  assert.match(salesSection, /data-status="missing-client"/);
  assert.match(
    salesSection,
    /EVO не\s*выполняет запись через старый или запасной путь/,
  );
});

test("the panel exposes exact inputs, honest states, per-step evidence, and explicit unknown reconciliation", () => {
  const panel = source(
    "src/components/platform/amocrm/CanonicalAmoCrmCommandPanel.tsx",
  );

  for (const locale of ["ru", "ky", "en"]) {
    assert.match(panel, new RegExp(`\\b${locale}: \\{`));
  }
  assert.match(panel, /data-testid="canonical-amocrm-command-panel"/);
  assert.match(panel, /data-testid="canonical-amocrm-provider-availability"/);
  assert.match(panel, /data-testid="canonical-amocrm-sync-form"/);
  assert.match(panel, /data-testid="canonical-amocrm-command-state"/);
  assert.match(panel, /data-testid="canonical-amocrm-command-step"/);
  assert.match(panel, /data-testid="canonical-amocrm-terminal-attempt-id"/);
  assert.match(panel, /data-testid="canonical-amocrm-reconcile"/);
  assert.match(panel, /data-testid="canonical-amocrm-release-prepared"/);
  assert.match(panel, /resolveCanonicalAmoCrmCommandPanelState/);
  assert.match(panel, /persistedBlockingState/);
  assert.match(panel, /activeUnknownState/);
  assert.match(panel, /attemptId: blockingAttempt\.attemptId/);
  assert.match(panel, /const flowBlocked = panelState\.flowBlocked/);
  assert.match(
    panel,
    /blockingAttempt\?\.status === "prepared"[\s\S]*blockingAttempt\.providerDispatchedAt === null/,
  );
  assert.match(panel, /<form action=\{releaseAction\}>/);
  assert.match(panel, /disabled=\{releasing\}/);
  assert.match(panel, /operator_released_before_dispatch/);
  assert.match(panel, /name="note_text"/);
  assert.match(panel, /name="task_text"/);
  assert.match(panel, /name="task_complete_till"/);
  assert.match(panel, /type="datetime-local"/);
  assert.match(panel, /max=\{AMOCRM_TASK_DEADLINE_LOCAL_SAFE_MAX\}/);
  assert.match(panel, /unix > AMOCRM_TASK_COMPLETE_TILL_MAX/);
  assert.match(panel, /maxLength=\{1000\}/);
  assert.match(panel, /required/);
  assert.match(panel, /disabled=\{!ready \|\| syncing \|\| flowBlocked\}/);

  for (const status of [
    "accepted",
    "rejected",
    "unknown",
    "blocked",
    "error",
    "request_conflict",
  ]) {
    assert.match(panel, new RegExp(`\\b${status}:`));
  }

  assert.doesNotMatch(panel, /\{(?:sync|reconcile)State\.reason\}/);
  assert.doesNotMatch(panel, /providerRequest|providerResponse|rawBody|accessToken|refreshToken/);
});

test("server actions use only canonical V2 seams and exact FormData extraction", () => {
  const actions = source(
    "src/lib/server/canonical-amocrm-command-actions.ts",
  );

  assert.match(actions, /parsePlatformAmoCrmSalesSyncForm/);
  assert.match(actions, /parsePlatformAmoCrmAdmissionsSyncForm/);
  assert.match(actions, /parsePlatformAmoCrmReconcileForm/);
  assert.match(actions, /requirePlatformSalesActor/);
  assert.match(actions, /requirePlatformAdmissionsActor/);
  assert.match(actions, /executePlatformAmoCrmSalesSync/);
  assert.match(actions, /executePlatformAmoCrmAdmissionsSync/);
  assert.match(actions, /reconcilePlatformAmoCrmSyncAttempt/);
  assert.match(actions, /releasePlatformAmoCrmPreparedAttempt/);
  assert.match(actions, /revalidatePath\(`\/sales\/\$\{leadId\}`\)/);
  assert.match(
    actions,
    /revalidatePath\(`\/clients\/\$\{studentCaseId\}`\)/,
  );
  assert.doesNotMatch(
    actions,
    /sqlite|EVO_AGENT_|legacy|fallback|@\/lib\/amocrm/i,
  );
});

test("the real local PostgreSQL harness proves the canonical amoCRM panel in Chromium", () => {
  const harness = source("scripts/test-postgres-v2-foundation.sh");

  assert.match(harness, /canonical_amocrm_command_browser_assert\(\)/);
  assert.match(harness, /EVO_EXPECT_AMOCRM_BROWSER_MODE="provider-not-authorized"/);
  assert.match(harness, /EVO_SUPABASE_SALES_PROOF_LEAD_ID="\$supabase_sales_lead_id"/);
  assert.match(harness, /EVO_CANONICAL_STUDENT_CASE_ID="\$student_case_id"/);
  assert.match(harness, /tests\/e2e\/canonical-amocrm-command\.spec\.ts/);
  assert.match(
    harness,
    /verify_p4_admissions_storage_acceptance[\s\S]*canonical_amocrm_command_browser_assert/,
  );
});
