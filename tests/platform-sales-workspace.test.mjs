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
  new URL("../src/lib/server/canonical-sales-workflow-actions.ts", import.meta.url),
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
    "../src/components/platform/sales/CanonicalSalesWorkflowForm.tsx",
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
const conversationsSource = readFileSync(
  new URL(
    "../src/components/platform/sales/CanonicalSalesConversations.tsx",
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

test("sales has one direct workspace route with server authorization", () => {
  assert.match(routeSource, /import \{ SalesWorkspace \}/);
  assert.match(routeSource, /<SalesWorkspace searchParams=\{searchParams\}/);
  assert.match(workspaceSource, /requirePlatformSalesActor\(\)/);
  assert.match(workspaceSource, /canonical-crm-repository/);
  assert.match(workspaceSource, /parseCanonicalReadCursor/);
  assert.match(workspaceSource, /listCanonicalSalesLeads/);
  assert.doesNotMatch(
    `${routeSource}\n${workspaceSource}`,
    /FixtureSales|ConnectedCanonicalSales|isUiContractFixtureMode|better-sqlite3|listPlatformSalesIntake|listPlatformSalesLeads|listPlatformSalesOwnerOptions|SalesLeadWorkflowForm|SalesOwnerSearchField/,
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
    /getCanonicalLeadSnapshot\(\{\s*actorRole: actor\.authorityRole,\s*leadId: id,?\s*\}\)/,
  );
  assert.doesNotMatch(
    leadWorkspaceSource,
    /getPlatformCanonicalLead|PlatformCanonicalRecordsRepositoryError/,
  );
  assert.match(leadWorkspaceSource, /data-testid="canonical-sales-lead-workspace"/);
  assert.match(leadWorkspaceSource, /CanonicalSalesWorkflowForm/);
  assert.match(leadWorkspaceSource, /CanonicalSalesGateCard/);
  assert.match(leadWorkspaceSource, /CanonicalSalesHandoffCard/);
  assert.match(leadWorkspaceSource, /listCanonicalLeadConversations\(/);
  assert.match(leadWorkspaceSource, /CanonicalSalesConversationList/);
  assert.doesNotMatch(
    leadWorkspaceSource,
    /getPlatformSalesLeadDetail|SalesLeadWorkflowDetail|SalesAdmissionsGateCard|SalesAdmissionsHandoffCard|platform-sales-intake|platform-communications|platform-admissions-gate|platform-admissions-handoff/,
  );
});

test("sales lead detail links only its canonical PostgreSQL conversations", () => {
  assert.match(conversationsSource, /data-testid="canonical-sales-conversations"/);
  assert.match(conversationsSource, /data-testid="canonical-sales-conversation-link"/);
  assert.match(conversationsSource, /data-conversation-id=\{conversation\.conversationId\}/);
  assert.match(
    conversationsSource,
    /href=\{`\/sales\/\$\{leadId\}\/conversations\/\$\{conversation\.conversationId\}`\}/,
  );
  assert.doesNotMatch(conversationsSource, /Supabase|amoCRM|manual-send|Gemini/i);
});

test("nested Sales transcript is canonical, bounded, and strictly read-only", () => {
  assert.match(transcriptRouteSource, /requirePlatformSalesActor\(\)/);
  assert.match(transcriptRouteSource, /parseCanonicalMessageCursor\(/);
  assert.match(transcriptRouteSource, /getCanonicalLeadConversationThread\(/);
  assert.match(transcriptRouteSource, /pageSize:\s*50/);
  assert.match(transcriptRouteSource, /CanonicalSalesConversationTranscript/);
  assert.doesNotMatch(
    transcriptRouteSource,
    /platform-sales-intake|platform-communications|getPlatformConversationThread|isPlatformLeadConversationLinked/,
  );
  assert.match(conversationsSource, /data-testid="canonical-sales-transcript"/);
  assert.match(conversationsSource, /data-testid="canonical-sales-message"/);
  assert.match(conversationsSource, /data-message-id=\{message\.messageId\}/);
  assert.match(
    conversationsSource,
    /data-testid="canonical-whatsapp-provider-blocked"/,
  );
  assert.match(
    conversationsSource,
    /data-testid="canonical-records-unavailable"/,
  );
  assert.doesNotMatch(
    conversationsSource,
    /<form|<button|PlatformConversationView|PlatformGemini|PlatformAutonomous|PlatformAmoCrm|messaging-actions|amocrm|realtime/i,
  );
});

test("sales workspace links canonical UUID records and owns workflow actions", () => {
  assert.match(workspaceSource, /href=\{`\/sales\/\$\{lead\.leadId\}`\}/);
  assert.match(workspaceSource, /data-testid="canonical-lead-row"/);
  assert.match(workspaceSource, /data-record-version=\{lead\.version\}/);
  assert.match(workspaceSource, /PostgreSQL V2/);
  assert.doesNotMatch(workspaceSource, /sales-inbound-blocked|Этот PR|\bU2\b|supabase/i);
  assert.match(workspaceSource, /canonical-records-unavailable/);
});

test("sales workflow writes only through the canonical PostgreSQL command", () => {
  assert.match(workflowActionSource, /requirePlatformSalesActor\(\)/);
  assert.match(workflowActionSource, /updateCanonicalSalesLeadWorkflow\(/);
  assert.match(workflowActionSource, /revalidatePath\("\/sales"\)/);
  assert.doesNotMatch(
    `${workflowActionSource}\n${workflowFormSource}`,
    /supabase|platform-sales-workflow|mutatePlatformSalesLeadWorkflow|fallback/i,
  );
  assert.match(workflowFormSource, /name="expected_version"/);
  assert.match(workflowFormSource, /name="qualification_summary"/);
  assert.match(workflowFormSource, /name="next_action"/);
  assert.match(workflowFormSource, /name="next_action_at"/);
  assert.match(workflowFormSource, /candidate !== "handed_off"/);
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
