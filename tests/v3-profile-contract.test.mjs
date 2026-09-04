import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 Student 360 owns the complete canonical BW6 workspace", () => {
  const page = source("src/app/(v3)/v3/profile/page.tsx");
  const profile = source("src/components/v3/profile/Profile.tsx");
  const types = source("src/components/v3/profile/types.ts");
  const adapter = source("src/lib/v3/profile-source.ts");
  const bridge = source("src/components/v3/profile/ProfileContractWorkspace.tsx");
  const workspace = source("src/components/v3/profile/ContractDraftReportWorkspace.tsx");

  assert.match(types, /\{ key: "contract", title: "Договор" \}/u);
  assert.match(
    types,
    /tab\.key === "documents" \|\| tab\.key === "contract"[\s\S]*student && actorRole !== "sales"/u,
  );
  assert.match(profile, /current === "contract" && draft\.contract/u);
  assert.match(profile, /<ProfileContractWorkspace/u);
  assert.match(page, /PLATFORM_CONTRACT_MUTATION_OUTCOMES/u);
  assert.match(page, /PLATFORM_CONTRACT_RETRY_OPERATIONS/u);
  assert.match(page, /parseContractRetry\(params, contractResult\)/u);

  assert.match(adapter, /getPlatformCaseContractWorkspace\(actor, studentCaseId\)/u);
  assert.match(adapter, /getPlatformStudentCaseHandoffContext\(actor, studentCaseId\)/u);
  assert.match(adapter, /contract\.studentCaseId !== studentCaseId/u);
  assert.match(adapter, /handoff\.studentCaseId !== studentCaseId/u);
  assert.match(adapter, /contract\.organizationId !== actor\.organizationId/u);
  assert.match(adapter, /handoff\.organizationId !== actor\.organizationId/u);
  assert.match(adapter, /fullCase\.handoff\.leadId !== lead\.leadId/u);
  assert.match(adapter, /contract: null/u);

  for (const action of [
    "createPlatformContractTemplateVersionAction",
    "approvePlatformContractTemplateVersionAction",
    "retirePlatformContractTemplateVersionAction",
    "generatePlatformStudentCaseContractDraftAction",
    "reviewPlatformStudentCaseContractDraftAction",
    "seedPlatformPostContractItemsAction",
    "updatePlatformPostContractItemAction",
    "generatePlatformPostContractReportAction",
    "reviewPlatformPostContractReportAction",
  ]) {
    assert.match(bridge, new RegExp(action));
  }
  for (const artifactList of [
    "workspace.templates",
    "workspace.drafts",
    "workspace.items",
    "workspace.reports",
  ]) {
    assert.match(workspace, new RegExp(artifactList.replace(".", "\\.")));
  }
  assert.match(workspace, /result=|RESULT_COPY|result \?/u);
  assert.match(bridge, /buildRequestIdFactory\(retry\)/u);
  assert.match(bridge, /return retry\.requestId/u);
  assert.doesNotMatch(page + profile + adapter + bridge, /\/clients\//u);
});

test("V3 contract context preserves handoff override and fail-closed amoCRM state", () => {
  const bridge = source("src/components/v3/profile/ProfileContractWorkspace.tsx");
  const amocrm = source("src/components/v3/profile/ProfileAmoCrmCommandSection.tsx");

  assert.match(bridge, /data-testid="canonical-student-case-handoff"/u);
  assert.match(bridge, /data-testid=\{exceptional \? "canonical-handoff-override-reason"/u);
  assert.match(bridge, /handoff\.handoffMode === "exceptional_override"/u);
  assert.match(bridge, /handoff\.starterTasks\.map/u);
  assert.match(bridge, /snapshot\.workspace\.studentCaseId !== snapshot\.handoff\.studentCaseId/u);
  assert.match(bridge, /if \(presentationRole === "sales"\) return null/u);

  assert.match(amocrm, /readCanonicalAmoCrmCommandAvailability/u);
  assert.match(amocrm, /readPlatformBlockingAmoCrmCommand/u);
  assert.match(amocrm, /workflowScope: "admissions_post_handoff"/u);
  assert.match(amocrm, /actorRole: authorityRole/u);
  assert.match(amocrm, /status: blockingAttempt\.status as "prepared" \| "unknown"/u);
  assert.match(amocrm, /PlatformAmoCrmCommandRpcError/u);
  assert.match(amocrm, /старый или запасной путь/u);
  assert.doesNotMatch(amocrm, /better-sqlite3|drizzle-orm|\/clients\//iu);
  assert.doesNotMatch(amocrm, /from\s+["'][^"']*legacy[^"']*["']/iu);
});
