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
const studentHandoffBoundarySource = readFileSync(
  new URL("../src/lib/platform-student-handoff.ts", import.meta.url),
  "utf8",
);
const studentHandoffActionSource = readFileSync(
  new URL("../src/lib/platform-student-handoff-actions.ts", import.meta.url),
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
    "../src/components/platform/sales/PlatformSalesGateCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const handoffCardSource = readFileSync(
  new URL(
    "../src/components/platform/sales/PlatformSalesHandoffCard.tsx",
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
  new URL("../src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx", import.meta.url),
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
  studentHandoffBoundarySource,
  studentHandoffActionSource,
  gateCardSource,
  handoffCardSource,
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
  assert.match(
    leadWorkspaceSource,
    /getPlatformLeadAdmissionsGate\(actor, id\)/,
  );
  assert.match(
    leadWorkspaceSource,
    /getPlatformLeadAdmissionsHandoff\(actor, id\)/,
  );
  assert.doesNotMatch(
    leadWorkspaceSource,
    /canonical-crm-repository|getCanonicalLeadSnapshot|getCanonicalLeadGateSnapshot|listCanonicalLeadConversations/,
  );
  assert.match(leadWorkspaceSource, /data-testid="canonical-sales-lead-workspace"/);
  assert.match(leadWorkspaceSource, /listPlatformSalesOwnerOptions\(actor, \{ pageSize: 100 \}\)/);
  assert.match(leadWorkspaceSource, /<PlatformSalesWorkflowForm/);
  assert.match(leadWorkspaceSource, /<PlatformSalesGateCard/);
  assert.match(leadWorkspaceSource, /<PlatformSalesHandoffCard/);
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

test("sales gate and handoff use one authenticated Supabase command path", () => {
  assert.match(studentHandoffActionSource, /requirePlatformSalesActor\(\)/);
  assert.match(
    studentHandoffBoundarySource,
    /staff_lead_admissions_gate/,
  );
  assert.match(
    studentHandoffBoundarySource,
    /mutate_lead_admissions_gate/,
  );
  assert.match(
    studentHandoffBoundarySource,
    /staff_lead_admissions_handoff/,
  );
  assert.match(
    studentHandoffBoundarySource,
    /handoff_lead_to_admissions/,
  );
  assert.doesNotMatch(
    `${studentHandoffBoundarySource}\n${studentHandoffActionSource}\n${gateCardSource}\n${handoffCardSource}`,
    /canonical-crm-repository|drizzle|service[_-]?role|fallback/i,
  );
  assert.match(gateCardSource, /data-testid="platform-sales-gate-card"/);
  assert.match(gateCardSource, /platform-gate-contract-form/);
  assert.match(gateCardSource, /platform-gate-payment-form/);
  assert.match(gateCardSource, /name="expected_gate_version"/);
  assert.match(gateCardSource, /name="action"/);
  assert.match(gateCardSource, /name="evidence_reference"/);
  assert.match(gateCardSource, /name="amount"/);
  assert.match(gateCardSource, /name="currency"/);
  assert.match(gateCardSource, /name="due_date"/);
  assert.match(gateCardSource, /name="received_date"/);
  assert.match(gateCardSource, /router\.refresh\(\)/);

  assert.match(handoffCardSource, /data-testid="platform-sales-handoff-card"/);
  assert.match(handoffCardSource, /data-testid="platform-handoff-form"/);
  assert.match(handoffCardSource, /data-testid="platform-handoff-result"/);
  assert.match(handoffCardSource, /name="expected_gate_version"/);
  assert.match(handoffCardSource, /name="admissions_owner_membership_id"/);
  assert.match(handoffCardSource, /name="handoff_mode"/);
  assert.match(handoffCardSource, /name="reason"/);
  assert.doesNotMatch(handoffCardSource, /admissions_owner_role/);
  assert.doesNotMatch(
    `${leadWorkspaceSource}\n${gateCardSource}\n${handoffCardSource}`,
    /CanonicalSalesGateCard|CanonicalSalesHandoffCard|canonical-sales-(?:gate|handoff)-actions/,
  );
});

test("clients detail mounts the single Supabase Student 360 workspace", () => {
  assert.match(clientsDetailRouteSource, /StudentCaseWorkspace/);
  assert.doesNotMatch(
    clientsDetailRouteSource,
    /CanonicalStudentCaseWorkspace|ClientPageContent|await import/,
  );
  assert.match(clientsDetailWorkspaceSource, /getPlatformStudentCaseView\(actor, id\)/);
  assert.match(clientsDetailWorkspaceSource, /getPlatformStudentCaseHandoffContext\(actor, id\)/);
  assert.match(clientsDetailWorkspaceSource, /getPlatformStudentProfile\(actor, id\)/);
  assert.match(clientsDetailWorkspaceSource, /getPlatformCaseContractWorkspace\(actor, id\)/);
  assert.match(clientsDetailWorkspaceSource, /data-testid="platform-student-case-workspace"/);
  assert.match(clientsDetailWorkspaceSource, /data-testid="platform-student-handoff-context"/);
  assert.match(clientsDetailWorkspaceSource, /data-testid="platform-student-profile"/);
  assert.doesNotMatch(
    `${clientsDetailRouteSource}\n${clientsDetailWorkspaceSource}`,
    /canonical-crm-repository|private-document-repository/,
  );
});
