import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 server adapters use the canonical Supabase runtime only", () => {
  const adapterDirectory = new URL("../src/lib/v3/", import.meta.url);
  const adapterSources = readdirSync(adapterDirectory)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(new URL(name, adapterDirectory), "utf8"))
    .join("\n");

  assert.doesNotMatch(adapterSources, /@\/lib\/server\/database/);
  assert.doesNotMatch(adapterSources, /\bevo_[a-z0-9_]+\b/);
  assert.doesNotMatch(adapterSources, /better-sqlite3|drizzle-orm/i);
  assert.match(adapterSources, /listPlatformSalesLeads/);
  assert.match(adapterSources, /listPlatformConversations/);
  assert.match(adapterSources, /listPlatformAdmissionsTaskQueue/);
  assert.match(adapterSources, /listPlatformDocumentQueue/);
});

test("V3 has Supabase staff auth and no sample business-data path", () => {
  const layout = source("src/app/(v3)/layout.tsx");
  const profilePage = source("src/app/(v3)/v3/profile/page.tsx");
  const knowledgePage = source("src/app/(v3)/v3/knowledge/page.tsx");

  assert.match(layout, /requirePlatformStaffActor/);
  assert.doesNotMatch(profilePage, /PROFILE_SAMPLE|\.\/sample/);
  assert.doesNotMatch(knowledgePage, /COMPANY_FILES|Требования к нострификации/);
  assert.equal(
    existsSync(new URL("../src/app/(v3)/v3/profile/sample.ts", import.meta.url)),
    false,
  );
  assert.equal(
    existsSync(new URL("../scripts/v3-gate/seed.sql", import.meta.url)),
    false,
  );
});

test("V3 owns the only Sales decision, gate and handoff interface", () => {
  const pipelinePage = source("src/app/(v3)/v3/pipeline/page.tsx");
  const pipeline = source("src/components/v3/Pipeline.tsx");
  const decision = source("src/components/v3/PipelineDecisionForm.tsx");
  const profilePage = source("src/app/(v3)/v3/profile/page.tsx");
  const profile = source("src/components/v3/profile/Profile.tsx");
  const tabs = source("src/components/v3/profile/tabs.tsx");
  const transition = source(
    "src/components/v3/profile/ProfileSalesTransition.tsx",
  );
  const profileSource = source("src/lib/v3/profile-source.ts");

  assert.match(pipelinePage, /requirePlatformSalesActor/);
  assert.match(pipeline, /<PipelineDecisionForm/);
  assert.match(
    pipeline,
    /key=\{`\$\{lead\.workflow\.leadId\}:\$\{lead\.workflow\.workflowVersion\}`\}/,
  );
  assert.match(pipelinePage, /readPipelineOwnerOptions\(actor\)/);
  assert.match(pipelinePage, /ownerOptions=\{ownerOptions\.rows\}/);
  assert.match(decision, /updatePlatformSalesWorkflowAction/);
  for (const field of [
    "lead_id",
    "expected_version",
    "request_id",
    "stage_key",
    "current_owner_membership_id",
    "clear_next_action",
    "next_action_text",
    "next_action_due_date",
    "reason",
  ]) {
    assert.match(decision, new RegExp(`name="${field}"`));
  }
  for (const testId of [
    "v3-pipeline-workflow-form",
    "v3-pipeline-decision",
    "v3-pipeline-stage",
    "v3-pipeline-next-action",
    "v3-pipeline-next-action-date",
    "v3-pipeline-reason",
    "v3-pipeline-submit",
    "v3-pipeline-workflow-status",
  ]) {
    assert.match(decision, new RegExp(`data-testid="${testId}"`));
  }

  assert.match(profilePage, /sales=\{view\.sales\}/);
  assert.match(profilePage, /actorRole=\{actor\.authorityRole\}/);
  assert.match(profilePage, /requestIds=\{requestIds\}/);
  assert.match(profile, /<Overview[\s\S]*sales=\{sales\}/);
  assert.match(tabs, /<ProfileSalesTransition/);
  assert.match(profileSource, /getPlatformLeadAdmissionsGate/);
  assert.match(profileSource, /getPlatformLeadAdmissionsHandoff/);
  assert.match(transition, /mutatePlatformLeadAdmissionsGateAction/);
  assert.match(transition, /handoffPlatformLeadToAdmissionsAction/);
  assert.match(transition, /name="expected_gate_version"/);
  assert.match(transition, /data-testid="v3-sales-transition"/);
  assert.match(transition, /data-testid="v3-sales-handoff"/);
  assert.match(transition, /caseHref=\{caseHref\}/);

  for (const path of [
    "src/app/(staff)/sales/[id]/page.tsx",
    "src/app/(staff)/sales/[id]/SalesLeadWorkspace.tsx",
    "src/app/(staff)/sales/[id]/PlatformSalesAmoCrmCommandSection.tsx",
    "src/app/(staff)/sales/[id]/conversations/[conversationId]/page.tsx",
    "src/components/platform/sales/PlatformSalesWorkflowForm.tsx",
    "src/components/platform/sales/PlatformSalesGateCard.tsx",
    "src/components/platform/sales/PlatformSalesHandoffCard.tsx",
  ]) {
    assert.equal(
      existsSync(new URL(`../${path}`, import.meta.url)),
      false,
      `${path} must be deleted after V3 replacement`,
    );
  }
});

test("V3 read surfaces cannot imitate durable business mutations in browser state", () => {
  const pipeline = source("src/components/v3/Pipeline.tsx");
  const calendar = source("src/components/v3/calendar/Calendar.tsx");
  const fileManager = source("src/components/v3/FileManager.tsx");
  const documents = source("src/components/v3/profile/Documents.tsx");

  assert.doesNotMatch(pipeline, /setMoved|\bmoved\b/);
  assert.doesNotMatch(calendar, /\bADDED\b|\bHIDDEN\b|local-/);
  assert.doesNotMatch(fileManager, /type="file"|URL\.createObjectURL|setFolders|setDocs|bulk-delete/);
  assert.doesNotMatch(documents, /type="file"|URL\.createObjectURL|useState|onRemove|onRename/);
});

test("V3 custom funnel ranges retain the leading partial bucket", () => {
  const funnel = source("src/lib/v3/funnel-source.ts");

  assert.match(funnel, /Math\.ceil\(days \/ step\)/);
  assert.match(funnel, /const from = period\.from/);
  assert.doesNotMatch(funnel, /Math\.floor\(days \/ step\)/);
});

test("V3 document dates use the organization timezone", () => {
  const knowledge = source("src/lib/v3/knowledge-source.ts");

  assert.match(knowledge, /import \{ ORG_TIMEZONE \} from "@\/lib\/v3\/period"/);
  assert.match(knowledge, /timeZone: ORG_TIMEZONE/);
});

test("V3 pipeline links and document table remain keyboard-operable", () => {
  const pipeline = source("src/components/v3/Pipeline.tsx");
  const fileManager = source("src/components/v3/FileManager.tsx");

  assert.match(pipeline, /className="flex min-h-6 items-center/);
  assert.match(fileManager, /aria-label="Таблица документов"/);
  assert.match(fileManager, /tabIndex=\{0\}/);
});

test("ordinary real foundation proof runs the fail-closed V3 browser gate", () => {
  const gate = source("scripts/v3-gate/gate.mjs");
  const foundation = source("scripts/test-postgres-v2-foundation.sh");
  const manifest = JSON.parse(source("package.json"));

  assert.match(gate, /EVO_STAFF_AUTH_ADMIN_EMAIL/);
  assert.match(gate, /EVO_STAFF_AUTH_ADMIN_PASSWORD/);
  assert.match(gate, /#staff-email/);
  assert.match(gate, /#staff-password/);
  assert.match(gate, /process\.exitCode = 1/);
  assert.doesNotMatch(gate, /EVO_DEV_GATE|#gate-identifier|#gate-secret/);
  assert.match(foundation, /v3_browser_gate/);
  assert.match(foundation, /scripts\/v3-gate\/gate\.mjs/);
  assert.equal(manifest.scripts["test:v3:gate"], "node scripts/v3-gate/gate.mjs");
});
