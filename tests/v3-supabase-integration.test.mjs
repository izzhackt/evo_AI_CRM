import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 server adapters use the canonical Supabase runtime only", () => {
  const adapterDirectory = new URL("../src/lib/v3/", import.meta.url);
  const typescriptFiles = readdirSync(adapterDirectory)
    .filter((name) => name.endsWith(".ts"))
    .sort();
  assert.deepEqual(typescriptFiles, [
    "account-deletion-source.ts", // удаление аккаунта по запросу (279, 07.10.2026)
    "admissions-source.ts",
    // «ИИ-агент» P1–P4 (06–07.10.2026): RPC «ИИ-агента» от имени сотрудника; P1–P3
    // не внесли свои файлы сюда, P4 вносит все вместе со своими.
    "ai-agent-autosend-source.ts",
    "ai-agent-autosend.ts",
    "ai-agent-knowledge.ts",
    "ai-agent-memory.ts",
    "ai-agent-source.ts",
    "ai-agent.ts",
    "board-layout.ts", // #1053 (25.09.2026)
    "calendar-contract.ts",
    "calendar-source.ts",
    "case-access-contract.ts",
    "case-agreement-source.ts",
    "case-chat-source.ts",
    "case-operations-source.ts",
    "case-work-source.ts",
    "command-palette-actions.ts", // #1085 (27.09.2026)
    "command-palette.ts", // #1085 (27.09.2026)
    "current-sales-funnel-source.ts",
    "finance-entry-source.ts",
    "funnel-source.ts",
    "inbox-access.ts", // WhatsApp for every employee (06.10.2026): pure page decisions, no Supabase
    "inbox-href.ts",
    "inbox-media.ts",
    "inbox-profile-link.ts",
    "inbox-source.ts",
    "knowledge-library-source.ts", // #906 (20.09.2026)
    "knowledge-source.ts",
    "knowledge-surface.ts",
    "lead-cabinet-source.ts",
    "lead-channel-source.ts", // «Маркетинг» М1 (06.10.2026)
    "lead-sale-conditions-source.ts",
    "manual-lead-source.ts",
    "marketing-source.ts", // «Маркетинг» М1 (06.10.2026)
    "navigation.ts",
    // operations-source.ts retired by #1067 (26.09.2026): replaced by
    // today-source.ts / today-queue.ts / sales-dynamics-source.ts /
    // sales-board-funnel.ts below.
    "period.ts",
    "personal-calendar-contract.ts", // #963 (21.09.2026)
    "pipeline-return.ts", // #1064 (26.09.2026)
    "pipeline-source.ts",
    "portal-source.ts",
    "profile-activity-source.ts",
    "profile-route-load.ts",
    "profile-source.ts",
    "reply-snippets-source.ts",
    "requests-queue-source.ts",
    "requests-source.ts",
    "requests-view.ts",
    "sales-board-funnel.ts", // #1067 (26.09.2026)
    "sales-dynamics-source.ts", // #1067 (26.09.2026)
    "sales-handoff-source.ts",
    "sales-numbers-source.ts",
    "sales-register-source.ts",
    "sales-stage.ts",
    "settings-health.ts", // #1064 (26.09.2026)
    "settings-journal-contract.ts",
    "settings-source.ts",
    "shell-tabs.ts", // #1068 (26.09.2026)
    "staff-catalog-preparation-actions.ts", // #967 (21.09.2026)
    "staff-invitation-access.ts",
    "staff-notification-actions.ts",
    "staff-notification-source.ts",
    "staff-requirements-editor-actions.ts", // #988 (21.09.2026)
    "staff-roles-contract.ts",
    "staff-task-source.ts",
    "staff-workspace-contract.ts",
    "staff-workspace-source.ts",
    "stages.ts", // #1070 (27.09.2026)
    "student-application-source.ts",
    "student-assessment-source.ts",
    "students-coverage-source.ts", // #1050 (24.09.2026)
    "students-coverage.ts", // #1050 (24.09.2026)
    "students-queue-source.ts",
    "task-case-actions.ts",
    "task-composer-actions.ts", // #1085 (27.09.2026)
    "task-queue.ts",
    "team-chat-source.ts",
    "today-queue.ts", // #1067 (26.09.2026)
    "today-source.ts", // #1067 (26.09.2026)
    "university-form-source.ts",
    "university-source.ts",
    "university-view.ts",
    "website-lead-source.ts",
    "whatsapp-chat.ts", // «Продажи → WhatsApp» как чат (06.10.2026): pure chat logic, no Supabase
    "whatsapp-contact-source.ts", // WhatsApp name and number (278, 07.10.2026)
    "whatsapp-contact.ts", // WhatsApp name and number (278, 07.10.2026): pure title logic, no Supabase
    "wording.ts",
  ]);

  const adapterFiles = typescriptFiles.filter((name) =>
    name.endsWith("-source.ts"),
  );
  assert.deepEqual(adapterFiles, [
    "account-deletion-source.ts", // удаление аккаунта по запросу (279, 07.10.2026)
    "admissions-source.ts",
    "ai-agent-autosend-source.ts", // «ИИ-агент» P4 (07.10.2026)
    "ai-agent-source.ts", // «ИИ-агент» P1 (06.10.2026)
    "calendar-source.ts",
    "case-agreement-source.ts",
    "case-chat-source.ts",
    "case-operations-source.ts",
    "case-work-source.ts",
    "current-sales-funnel-source.ts",
    "finance-entry-source.ts",
    "funnel-source.ts",
    "inbox-source.ts",
    "knowledge-library-source.ts", // #906 (20.09.2026)
    "knowledge-source.ts",
    "lead-cabinet-source.ts",
    "lead-channel-source.ts", // «Маркетинг» М1 (06.10.2026)
    "lead-sale-conditions-source.ts",
    "manual-lead-source.ts",
    "marketing-source.ts", // «Маркетинг» М1 (06.10.2026)
    // operations-source.ts retired by #1067 (26.09.2026): see the file
    // inventory above.
    "pipeline-source.ts",
    "portal-source.ts",
    "profile-activity-source.ts",
    "profile-source.ts",
    "reply-snippets-source.ts",
    "requests-queue-source.ts",
    "requests-source.ts",
    // requests-view.ts is excluded here on purpose: it does not end in
    // "-source.ts" (see the filter above), same as university-view.ts.
    // Its earlier presence in this list (#1084/#1092) was a copy-paste bug —
    // it never matched the filtered `adapterFiles` and always failed this
    // assertion regardless of any inventory drift.
    "sales-dynamics-source.ts", // #1067 (26.09.2026)
    "sales-handoff-source.ts",
    "sales-numbers-source.ts",
    "sales-register-source.ts",
    "settings-source.ts",
    "staff-notification-source.ts",
    "staff-task-source.ts",
    "staff-workspace-source.ts",
    "student-application-source.ts",
    "student-assessment-source.ts",
    "students-coverage-source.ts", // #1050 (24.09.2026)
    "students-queue-source.ts",
    "team-chat-source.ts",
    "today-source.ts", // #1067 (26.09.2026)
    "university-form-source.ts",
    "university-source.ts",
    "website-lead-source.ts",
    "whatsapp-contact-source.ts", // WhatsApp name and number (278, 07.10.2026)
  ]);

  const adapterSources = adapterFiles
    .map((name) => readFileSync(new URL(name, adapterDirectory), "utf8"))
    .join("\n");

  assert.doesNotMatch(adapterSources, /@\/lib\/server\/database/);
  for (const name of adapterFiles) {
    const adapter = readFileSync(new URL(name, adapterDirectory), "utf8");
    assert.deepEqual([...new Set(adapter.match(/\bevo_[a-z0-9_]+\b/g) ?? [])].sort(), name === "portal-source.ts" ? [
      "evo_action_due_at", "evo_action_due_on", "evo_action_status", "evo_action_task_id", "evo_action_title",
    ] : [], `${name} contains unexpected legacy names`);
    assert.doesNotMatch(adapter, /\.(?:from|rpc)\s*\(\s*["'`]evo_/);
  }
  assert.doesNotMatch(adapterSources, /better-sqlite3|drizzle-orm/i);
  assert.match(adapterSources, /listPlatformSalesLeads/);
  assert.match(adapterSources, /listPlatformConversations/);
  assert.match(adapterSources, /listPlatformAdmissionsTaskQueue/);
  assert.match(adapterSources, /listPlatformDocumentQueue/);
  assert.match(adapterSources, /getPlatformCompanyFileWorkspace/);
});

test("V3 has Supabase staff auth and no sample business-data path", () => {
  const layout = source("src/app/(v3)/layout.tsx");
  const profilePage = source("src/app/(v3)/v3/profile/page.tsx");
  const knowledgePage = source("src/app/(v3)/v3/knowledge/page.tsx");
  // #906 (2e72d5ad0, 20.09.2026) rebuilt "/v3/knowledge" around the Admin
  // library and removed the FileManager-based student documents view from
  // page.tsx; #915 (1635d01ef) brought it back as KnowledgeDocuments.tsx
  // (extracted from the documents page), truncation notice included.
  const knowledgeDocuments = source("src/components/v3/knowledge/KnowledgeDocuments.tsx");

  assert.match(layout, /requirePlatformStaffActor/);
  assert.doesNotMatch(profilePage, /PROFILE_SAMPLE|\.\/sample/);
  assert.doesNotMatch(knowledgePage, /COMPANY_FILES|Требования к нострификации/);
  assert.match(
    knowledgePage,
    /requireV3PageActor\("\/v3\/knowledge"\)/,
  );
  // The notice's own data-testid ("v3-knowledge-student-documents-limited")
  // was dropped in that move and is not referenced by any other test or e2e
  // spec (grepped repo-wide); the safety invariant it guarded — a truncated
  // student-documents list must say so, never pretend to be complete — is
  // still enforced here by the same studentDocuments.complete flag and a
  // role="alert" notice with the same warning text.
  assert.match(knowledgePage, /<KnowledgeDocuments actor=\{actor\} embedded \/>/);
  assert.match(
    knowledgeDocuments,
    /\{!studentDocuments\.complete && <p role="alert">Откройте документы нужного клиента в его карточке: общий список не помещается на этом экране\.<\/p>\}/,
  );
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

  assert.match(pipelinePage, /requireV3PageActor\("\/v3\/pipeline"\)/);
  assert.match(pipeline, /<PipelineDecisionForm/);
  assert.match(
    pipeline,
    /key=\{`\$\{lead\.workflow\.leadId\}:\$\{lead\.workflow\.workflowVersion\}`\}/,
  );
  assert.match(pipelinePage, /readPipelineWorkspace\(actor, filters\)/);
  assert.match(source("src/lib/v3/pipeline-source.ts"), /readPlatformSalesPipeline/);
  assert.match(pipelinePage, /ownerOptions=\{ownerRows\}/);
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
  assert.match(profilePage, /actor=\{actor\}/);
  assert.match(profilePage, /requestIds=\{requestIds\}/);
  assert.match(profile, /<Overview[\s\S]*sales=\{sales\}/);
  assert.match(tabs, /<ProfileSalesTransition/);
  assert.match(profileSource, /getPlatformLeadAdmissionsGate/);
  assert.match(profileSource, /getPlatformLeadAdmissionsHandoff/);
  assert.match(transition, /mutatePlatformLeadAdmissionsGateAction/);
  assert.match(transition, /name="expected_gate_version"/);
  assert.match(transition, /data-testid="v3-sales-transition"/);
  // Unified workflow S2: the card-side «Передача в Admissions» handoff form
  // is retired; the only curator handoff trigger left is a saved Sales
  // report. LeadSaleConditions replaces it on the lead card Overview.
  assert.doesNotMatch(transition, /handoffPlatformLeadToAdmissionsAction/);
  assert.doesNotMatch(transition, /data-testid="v3-sales-handoff"/);
  assert.doesNotMatch(
    transition,
    /href=\{`\/v3\/profile\?case=\$\{caseId\}&tab=overview`\}/,
  );
  assert.doesNotMatch(transition, /href=\{`\/clients\/\$\{caseId\}`\}/);
  assert.match(profileSource, /readLeadSaleConditions/);
  assert.match(tabs, /<LeadSaleConditions/);
  assert.match(
    source("src/components/v3/profile/LeadSaleConditions.tsx"),
    /saveLeadSaleConditionsGroupAction/,
  );

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

test("V3 mutations use server-backed authorities rather than browser-only state", () => {
  const pipeline = source("src/components/v3/Pipeline.tsx");
  const calendar = source("src/components/v3/calendar/Calendar.tsx");
  const fileManager = source("src/components/v3/FileManager.tsx");
  const documents = source("src/components/v3/profile/Documents.tsx");

  assert.doesNotMatch(pipeline, /setMoved|\bmoved\b/);
  assert.doesNotMatch(calendar, /\bADDED\b|\bHIDDEN\b|local-/);
  assert.match(fileManager, /createPlatformCompanyFileFolderAction/);
  assert.match(fileManager, /createPlatformCompanyFileAction/);
  assert.match(fileManager, /\/api\/v3\/company-files\//);
  assert.match(fileManager, /status === "saved" \|\| status === "stale"/);
  assert.match(fileManager, /key=\{createFolderRequestId\}/);
  assert.match(fileManager, /key=\{`\$\{file\.id\}:\$\{file\.version/);
  assert.doesNotMatch(fileManager, /URL\.createObjectURL|setFolders|setDocs|bulk-delete/);
  assert.doesNotMatch(documents, /type="file"|URL\.createObjectURL|useState|onRemove|onRename/);
});

test("V3 custom funnel ranges retain the leading partial bucket", () => {
  const funnel = source("src/lib/v3/funnel-source.ts");

  assert.match(funnel, /Math\.ceil\(days \/ step\)/);
  assert.match(funnel, /const from = period\.from/);
  assert.doesNotMatch(funnel, /Math\.floor\(days \/ step\)/);
});

test("V3 funnel counts proven qualification for the same lead-creation cohort", () => {
  const funnel = source("src/lib/v3/funnel-source.ts");
  const wording = source("src/lib/v3/wording.ts");

  assert.match(funnel, /async function readAllProvenStageEntries/);
  assert.match(funnel, /pageSize: STAGE_ENTRY_PAGE_SIZE/);
  assert.match(funnel, /cursor = page\.nextCursor/);
  assert.match(funnel, /seenCursors\.has\(cursorKey\)/);
  assert.match(funnel, /const cohort = creationCohort\(leadRows, period\)/);
  assert.match(funnel, /!cohortLeadIds\.has\(entry\.leadId\)/);
  assert.match(funnel, /seenLeadStages\.has\(identity\)/);
  assert.match(funnel, /entry\.stageKey === "qualified"/);
  assert.match(funnel, /qualified: qualifiedLeadIds\.has\(row\.leadId\)/);
  assert.match(funnel, /FUNNEL_STEP\.qualified/);
  assert.match(funnel, /qualified\[row\.hour\] \+= 1/);
  assert.match(funnel, /qualified\[bucket\] \+= 1/);
  assert.match(wording, /qualified: "Квалифицированы"/);
  assert.doesNotMatch(funnel, /entry\.enteredAt|entry\.enteredOn/);
  assert.doesNotMatch(funnel, /row\.updatedAt/);
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

test("V3 style proof checks served and applied current-page CSS in dev and production", () => {
  const styles = source("scripts/v3-gate/assert-styled.mjs");
  const gate = source("scripts/v3-gate/gate.mjs");
  assert.match(styles, /page\.locator\('link\[rel="stylesheet"\]\[href\]'\)/u);
  assert.match(styles, /url\.origin === origin/u);
  assert.match(styles, /url\.pathname\.startsWith\("\/_next\/static\/"\)/u);
  assert.match(styles, /fetch\(url, \{ redirect: "error" \}\)/u);
  assert.match(styles, /assert\.equal\(res\.status, 200/u);
  assert.match(styles, /"text\/css", "stylesheet response is not CSS"/u);
  assert.match(styles, /assert\.ok\(size > 0/u);
  assert.match(styles, /link\.sheet\.cssRules\.length > 0/u);
  assert.match(styles, /assert\.equal\(applied\.margin, "0px"/u);
  assert.match(styles, /"rgb\(243, 243, 243\)"/u);
  assert.match(styles, /applied\.world\.colorScheme, "light"/u);
  assert.match(styles, /applied\.world\.accent, "#d70217"/u);
  assert.match(styles, /document\.fonts\.check\('16px "Golos Text Variable"'\)/u);
  assert.match(styles, /image\.complete && image\.naturalWidth > 0/u);
  assert.doesNotMatch(styles, /bytes\s*[<>]|100_000|full sheet|base\}\/login/u);
  assert.match(gate, /await assertStyled\(page, base, \{ v3: true \}\)/u);
});
