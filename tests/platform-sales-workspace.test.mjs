import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  new URL("../src/app/(staff)/sales/SalesPageContent.tsx", import.meta.url),
  "utf8",
);
const workspaceSource = readFileSync(
  new URL("../src/app/(staff)/sales/SalesWorkspace.tsx", import.meta.url),
  "utf8",
);
const detailRouteSource = readFileSync(
  new URL("../src/app/(staff)/sales/[id]/page.tsx", import.meta.url),
  "utf8",
);
const leadWorkspaceSource = readFileSync(
  new URL("../src/app/(staff)/sales/[id]/SalesLeadWorkspace.tsx", import.meta.url),
  "utf8",
);
const workflowActionSource = readFileSync(
  new URL("../src/lib/platform-sales-actions.ts", import.meta.url),
  "utf8",
);
const gateActionSource = readFileSync(
  new URL("../src/lib/server/canonical-sales-gate-actions.ts", import.meta.url),
  "utf8",
);
const handoffActionSource = readFileSync(
  new URL("../src/lib/server/canonical-sales-handoff-actions.ts", import.meta.url),
  "utf8",
);
const workflowFormSource = readFileSync(
  new URL(
    "../src/components/platform/sales/PlatformSalesWorkflowForm.tsx",
    import.meta.url,
  ),
  "utf8",
);
const gateCardSource = readFileSync(
  new URL(
    "../src/components/platform/sales/CanonicalSalesGateCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const handoffCardSource = readFileSync(
  new URL(
    "../src/components/platform/sales/CanonicalSalesHandoffCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const transcriptRouteSource = readFileSync(
  new URL(
    "../src/app/(staff)/sales/[id]/conversations/[conversationId]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const platformSalesRepositorySource = readFileSync(
  new URL("../src/lib/platform-sales.ts", import.meta.url),
  "utf8",
);
const conversationsSource = readFileSync(
  new URL(
    "../src/components/platform/sales/CanonicalSalesConversations.tsx",
    import.meta.url,
  ),
  "utf8",
);
const leadDetailSource = readFileSync(
  new URL(
    "../src/components/platform/core/CanonicalLeadDetail.tsx",
    import.meta.url,
  ),
  "utf8",
);
const clientsDetailRouteSource = readFileSync(
  new URL("../src/app/(staff)/clients/[id]/page.tsx", import.meta.url),
  "utf8",
);
const clientsDetailWorkspaceSource = readFileSync(
  new URL("../src/app/(staff)/clients/[id]/CanonicalStudentCaseWorkspace.tsx", import.meta.url),
  "utf8",
);

const activeSalesReadSources = [
  routeSource,
  workspaceSource,
  detailRouteSource,
  leadWorkspaceSource,
  leadDetailSource,
  workflowActionSource,
  workflowFormSource,
  transcriptRouteSource,
  conversationsSource,
].join("\n");

const activeDrizzleSalesReadImport =
  /from\s+["'](?:@\/db(?:\/[^"']*)?|@\/lib\/(?:db|server\/(?:canonical-crm-repository|database))|better-sqlite3|drizzle-orm(?:\/[^"']*)?)["']/;
const retiredSalesReadPanel =
  /CanonicalAmoCrmCommandPanel|CanonicalSalesGateCard|CanonicalSalesHandoffCard|CanonicalSalesWorkflowForm|SalesLeadWorkflowForm|SalesOwnerSearchField|readBlockingCanonicalAmoCrmCommand/;

test("sales has one direct workspace route with server authorization", () => {
  assert.match(routeSource, /import \{ SalesWorkspace \}/);
  assert.match(routeSource, /<SalesWorkspace searchParams=\{searchParams\}/);
  assert.match(workspaceSource, /requirePlatformSalesActor\(\)/);
  assert.match(workspaceSource, /@\/lib\/platform-sales/);
  assert.match(workspaceSource, /parsePlatformSalesCursor/);
  assert.match(workspaceSource, /listPlatformSalesLeads\(actor,/);
  assert.doesNotMatch(
    `${routeSource}\n${workspaceSource}`,
    /FixtureSales|ConnectedCanonicalSales|isUiContractFixtureMode|better-sqlite3|canonical-crm-repository|listCanonicalSalesLeads|SalesLeadWorkflowForm|SalesOwnerSearchField/,
  );
});

test("active Sales UI has no Drizzle imports or retired write panels", () => {
  assert.match(leadDetailSource, /PlatformSalesLeadDetail/);
  assert.match(conversationsSource, /PlatformSalesLinkedConversation/);
  assert.doesNotMatch(activeSalesReadSources, activeDrizzleSalesReadImport);
  assert.doesNotMatch(
    activeSalesReadSources,
    /getCanonicalLeadConversationThread|getCanonicalLeadGateSnapshot|getCanonicalLeadSnapshot|listCanonicalLeadConversations|listCanonicalSalesLeads|parseCanonicalMessageCursor|parseCanonicalReadCursor/,
  );
  assert.doesNotMatch(activeSalesReadSources, retiredSalesReadPanel);
  assert.doesNotMatch(
    activeSalesReadSources,
    /actorRole:\s*actor\.(?:authorityRole|presentationRole)/,
  );
});

test("sales lead detail has no alternate fixture or legacy screen", () => {
  assert.match(detailRouteSource, /SalesLeadWorkspace/);
  assert.doesNotMatch(
    detailRouteSource,
    /FixtureLead|ConnectedCanonicalLead|isUiContractFixtureMode|await import/,
  );
  assert.match(
    leadWorkspaceSource,
    /getPlatformSalesLead\(actor, id\)/,
  );
  assert.doesNotMatch(
    leadWorkspaceSource,
    /canonical-crm-repository|getCanonicalLeadSnapshot|getCanonicalLeadGateSnapshot|listCanonicalLeadConversations/,
  );
  assert.match(leadWorkspaceSource, /data-testid="canonical-sales-lead-workspace"/);
  assert.match(leadWorkspaceSource, /listPlatformSalesOwnerOptions\(actor, \{ pageSize: 100 \}\)/);
  assert.match(leadWorkspaceSource, /<PlatformSalesWorkflowForm/);
  assert.match(leadWorkspaceSource, /requestId=\{randomUUID\(\)\}/);
  assert.match(leadWorkspaceSource, /CanonicalSalesConversationList/);
  assert.doesNotMatch(
    leadWorkspaceSource,
    /CanonicalSalesWorkflowForm|CanonicalSalesGateCard|CanonicalSalesHandoffCard|CanonicalAmoCrmCommandPanel|readBlockingCanonicalAmoCrmCommand/,
  );
});

test("sales lead detail links only its canonical Supabase conversations", () => {
  assert.match(conversationsSource, /data-testid="canonical-sales-conversations"/);
  assert.match(conversationsSource, /data-testid="canonical-sales-conversation-link"/);
  assert.match(conversationsSource, /data-conversation-id=\{conversation\.conversationId\}/);
  assert.match(
    conversationsSource,
    /href=\{`\/sales\/\$\{leadId\}\/conversations\/\$\{conversation\.conversationId\}`\}/,
  );
  assert.match(conversationsSource, /Supabase Platform/);
  assert.doesNotMatch(conversationsSource, /local database|amoCRM|manual-send|Gemini/i);
});

test("nested Sales transcript is canonical, bounded, and strictly read-only", () => {
  assert.match(transcriptRouteSource, /requirePlatformSalesActor\(\)/);
  assert.match(transcriptRouteSource, /parsePlatformConversationCursor\(/);
  assert.match(
    transcriptRouteSource,
    /isPlatformLeadConversationLinked\(\s*actor,\s*leadId,\s*normalizedConversationId,?\s*\)/,
  );
  assert.match(transcriptRouteSource, /getPlatformConversationThread\(actor,/);
  assert.match(transcriptRouteSource, /pageSize:\s*50/);
  assert.match(transcriptRouteSource, /CanonicalSalesConversationTranscript/);
  assert.doesNotMatch(
    transcriptRouteSource,
    /canonical-crm-repository|getCanonicalLeadConversationThread|parseCanonicalMessageCursor/,
  );
  assert.doesNotMatch(
    transcriptRouteSource,
    /getPlatformSalesLead|linkedConversations/,
    "an older valid link outside the bounded lead-detail projection must remain reachable",
  );
  assert.match(conversationsSource, /data-testid="canonical-sales-transcript"/);
  assert.match(conversationsSource, /data-testid="canonical-sales-message"/);
  assert.match(conversationsSource, /data-message-id=\{message\.id\}/);
  assert.match(
    conversationsSource,
    /data-testid="canonical-records-unavailable"/,
  );
  assert.doesNotMatch(
    conversationsSource,
    /<form|<button|PlatformConversationView|PlatformGemini|PlatformAutonomous|PlatformAmoCrm|messaging-actions|amocrm|realtime/i,
  );
});

test("Sales exact-link authorization stays cookie-bound without an elevated fallback", () => {
  assert.match(
    platformSalesRepositorySource,
    /await import\("\.\/supabase\/server"\)/,
  );
  assert.match(platformSalesRepositorySource, /createSupabaseServerClient\(\)/);
  assert.match(
    platformSalesRepositorySource,
    /"staff_canonical_lead_conversation_link"/,
  );
  assert.doesNotMatch(
    platformSalesRepositorySource,
    /service[_-]?role|createSupabaseAdminClient|fallback/i,
  );
});

test("sales workspace links canonical Supabase UUID records", () => {
  assert.match(workspaceSource, /href=\{`\/sales\/\$\{lead\.leadId\}`\}/);
  assert.match(workspaceSource, /data-testid="canonical-lead-row"/);
  assert.match(workspaceSource, /data-workflow-version=\{lead\.workflowVersion\}/);
  assert.match(workspaceSource, /Supabase Platform/);
  assert.doesNotMatch(workspaceSource, /PostgreSQL V2|sales-inbound-blocked|Этот PR|\bU2\b/);
  assert.match(workspaceSource, /canonical-records-unavailable/);
});

test("sales workflow writes only through the authenticated Supabase command", () => {
  assert.match(workflowActionSource, /requirePlatformSalesActor\(\)/);
  assert.match(workflowActionSource, /mutatePlatformSalesLeadWorkflow\(actor, input\)/);
  assert.match(workflowActionSource, /revalidatePath\("\/sales"\)/);
  assert.doesNotMatch(
    `${workflowActionSource}\n${workflowFormSource}`,
    /canonical-sales-workflow|updateCanonicalSalesLeadWorkflow|drizzle|fallback/i,
  );
  assert.match(workflowFormSource, /name="expected_version"/);
  assert.match(workflowFormSource, /name="stage_key"/);
  assert.match(workflowFormSource, /name="current_owner_membership_id"/);
  assert.match(workflowFormSource, /name="clear_next_action"/);
  assert.match(workflowFormSource, /name=\{clearNextAction \? undefined : "next_action_text"\}/);
  assert.match(workflowFormSource, /name=\{clearNextAction \? undefined : "next_action_due_date"\}/);
  assert.match(workflowFormSource, /name="reason"/);
  assert.match(workflowFormSource, /PLATFORM_SALES_STAGES\.map/);
  assert.match(workflowFormSource, /lead\.workflowVersion/);
  assert.match(workflowFormSource, /result\.requestId/);
  assert.match(workflowFormSource, /router\.refresh\(\)/);
});

test("Sales workflow UI exposes one localized, accessible outcome contract", () => {
  for (const testId of [
    "platform-sales-workflow-form",
    "platform-sales-stage",
    "platform-sales-owner",
    "platform-sales-next-action-text",
    "platform-sales-next-action-due-date",
    "platform-sales-clear-next-action",
    "platform-sales-reason",
    "platform-sales-submit",
    "platform-sales-action-status",
  ]) {
    assert.match(workflowFormSource, new RegExp(`data-testid="${testId}"`));
  }
  assert.match(workflowFormSource, /aria-live="polite"/);
  assert.match(workflowFormSource, /required=\{reasonRequired\}/);
  assert.match(workflowFormSource, /ownerOptionsHaveMore/);
  assert.equal(
    workflowFormSource.match(/title: "/g)?.length,
    3,
    "the workflow form must provide RU, KY and EN copy",
  );
  assert.doesNotMatch(
    workflowFormSource,
    /CanonicalSalesGateCard|CanonicalSalesHandoffCard|CanonicalAmoCrmCommandPanel|qualification_summary|handoff_ready|handed_off/,
  );
});

test("sales gate and handoff write only through canonical PostgreSQL commands", () => {
  assert.match(gateActionSource, /requirePlatformSalesActor\(\)/);
  assert.match(gateActionSource, /recordCanonicalSalesGateEvidence\(/);
  assert.match(gateActionSource, /revalidatePath\("\/sales"\)/);
  assert.doesNotMatch(
    `${gateActionSource}\n${gateCardSource}`,
    /supabase|platform-admissions-gate|mutatePlatformAdmissionsGate|fallback/i,
  );
  assert.match(gateCardSource, /name="evidence_type"/);
  assert.match(gateCardSource, /name="decision"/);
  assert.match(gateCardSource, /name="occurred_at"/);
  assert.match(gateCardSource, /name="evidence_reference"/);
  assert.match(gateCardSource, /name="amount_minor"/);
  assert.match(gateCardSource, /name="currency"/);
  assert.match(gateCardSource, /router\.refresh\(\)/);

  assert.match(handoffActionSource, /requirePlatformSalesActor\(\)/);
  assert.match(handoffActionSource, /handoffCanonicalLeadToAdmissions\(/);
  assert.match(handoffActionSource, /revalidatePath\("\/clients"\)/);
  assert.doesNotMatch(
    `${handoffActionSource}\n${handoffCardSource}`,
    /supabase|platform-admissions-handoff|mutatePlatformAdmissionsHandoff|fallback/i,
  );
  assert.match(handoffCardSource, /name="expected_version"/);
  assert.doesNotMatch(handoffCardSource, /admissions_owner_role/);
  assert.match(handoffCardSource, /name="is_override"/);
  assert.match(handoffCardSource, /name="override_reason"/);
});

test("clients detail is the minimal canonical post-handoff view", () => {
  assert.match(clientsDetailRouteSource, /CanonicalStudentCaseWorkspace/);
  assert.doesNotMatch(
    clientsDetailRouteSource,
    /StudentWorkspace|ClientPageContent|await import/,
  );
  assert.match(
    clientsDetailWorkspaceSource,
    /getCanonicalStudentCaseSnapshot\(\{\s*actorRole: actor\.authorityRole,\s*studentCaseId: id,?\s*\}\)/,
  );
  assert.match(clientsDetailWorkspaceSource, /data-testid="canonical-student-case-workspace"/);
  assert.match(clientsDetailWorkspaceSource, /data-testid="canonical-student-case-handoff"/);
  assert.match(
    clientsDetailWorkspaceSource,
    /data-testid="canonical-handoff-override-reason"/,
  );
  assert.match(
    clientsDetailWorkspaceSource,
    /data-testid="canonical-admissions-starter-task"/,
  );
  assert.doesNotMatch(
    clientsDetailWorkspaceSource,
    /getPlatformStudentCaseView|getPlatformAdmissionsCaseWorkspace|getPlatformStudentCaseAdmissionsHandoff|platform-admissions|platform-contract|platform-finance|platform-pilot/i,
  );
});
