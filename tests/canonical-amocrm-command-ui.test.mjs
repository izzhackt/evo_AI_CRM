import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

function source(path) {
  const url = new URL(path, root);
  assert.equal(existsSync(url), true, `${path} must exist`);
  return readFileSync(url, "utf8");
}

test("the active canonical amoCRM command panel remains on Admissions Student 360", () => {
  const studentWorkspace = source(
    "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
  );
  const admissions = source(
    "src/app/(staff)/clients/[id]/AmoCrmCaseCommandSection.tsx",
  );

  assert.match(admissions, /CanonicalAmoCrmCommandPanel/);
  assert.match(studentWorkspace, /<AmoCrmCaseCommandSection/);
  assert.ok(
    studentWorkspace.indexOf("<PlatformAdmissionsOperationsPanel") <
      studentWorkspace.indexOf("<AmoCrmCaseCommandSection"),
    "Supabase Admissions operations must remain ahead of the isolated #549 amoCRM command section",
  );
  assert.match(
    admissions,
    /<CanonicalAmoCrmCommandPanel[\s\S]*scope="admissions"[\s\S]*leadId=\{leadId\}[\s\S]*studentCaseId=\{studentCaseId\}/,
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
  assert.match(panel, /resolveCanonicalAmoCrmCommandPanelState/);
  assert.match(panel, /persistedBlockingState/);
  assert.match(panel, /activeUnknownState/);
  assert.match(panel, /attemptId: blockingAttempt\.attemptId/);
  assert.match(panel, /const flowBlocked = panelState\.flowBlocked/);
  assert.match(panel, /name="note_text"/);
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

  assert.match(actions, /exactActionStringFields/);
  assert.match(actions, /requirePlatformSalesActor/);
  assert.match(actions, /requirePlatformAdmissionsActor/);
  assert.match(actions, /executeCanonicalAmoCrmSalesSync/);
  assert.match(actions, /executeCanonicalAmoCrmAdmissionsSync/);
  assert.match(actions, /reconcileCanonicalAmoCrmSyncAttempt/);
  assert.match(actions, /revalidatePath\(`\/sales\/\$\{leadId\}`\)/);
  assert.match(
    actions,
    /revalidatePath\(`\/clients\/\$\{studentCaseId\}`\)/,
  );
  assert.doesNotMatch(
    actions,
    /supabase|sqlite|EVO_AGENT_|legacy|fallback|@\/lib\/amocrm/i,
  );
});
