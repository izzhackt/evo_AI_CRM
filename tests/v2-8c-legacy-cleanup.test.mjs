import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function path(relativePath) {
  return new URL(`../${relativePath}`, import.meta.url);
}

function source(relativePath) {
  return readFileSync(path(relativePath), "utf8");
}

test("the earlier V2-8C document screens remain retired", () => {
  for (const relativePath of [
    "src/app/(staff)/clients/[id]/StudentWorkspace.tsx",
    "src/app/(staff)/clients/[id]/StudentWorkspacePresenter.tsx",
    "src/app/(staff)/documents/[id]/page.tsx",
    "src/app/(staff)/documents/actions.ts",
    "src/components/platform/documents/DocumentDecisionPanel.tsx",
    "src/components/platform/documents/DocumentJourney.tsx",
    "src/components/platform/documents/DocumentSubmitButton.tsx",
    "src/components/platform/documents/document-copy.ts",
    "src/lib/platform-admissions-case-workspace.ts",
    "src/lib/platform-admissions-case-workspace-actions.ts",
    "src/lib/platform-document-review.ts",
    "src/lib/platform-document-review-actions.ts",
    "tests/e2e/platform-documents-experience.spec.ts",
    "tests/platform-admissions-case-workspace.test.mjs",
  ]) {
    assert.equal(
      existsSync(path(relativePath)),
      false,
      `${relativePath} must remain removed`,
    );
  }
});

test("the V3 case profile owns the single current Supabase document workspace", () => {
  const student360 = source(
    "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
  );
  const panel = source(
    "src/components/v3/profile/ProfileDocumentsClient.tsx",
  );
  const queue = source("src/app/(staff)/documents/(queue)/page.tsx");

  assert.doesNotMatch(student360, /getPlatformCaseDocumentWorkspace|PlatformPrivateDocumentsPanel/);
  assert.match(panel, /\/api\/v2\/document-slots\/\$\{item\.id\}\/versions/);
  assert.match(panel, /\/api\/v2\/document-versions\/\$\{item\.currentVersionId\}\/download/);
  assert.match(queue, /listPlatformDocumentQueue\(actor\)/);
  assert.match(queue, /`\/v3\/profile\?case=\$\{row\.studentCaseId\}&tab=documents`/);
  assert.doesNotMatch(
    `${student360}\n${panel}\n${queue}`,
    /StudentWorkspace|from\s+["']@\/lib\/platform-document-review|private-document-repository|canonical-crm-repository|@\/lib\/(?:actions|queries|db)|drizzle|sqlite|fallback/i,
  );
});

test("active frontend fixtures do not reintroduce SQLite document authority", () => {
  const legacyDocumentPattern =
    /\b(?:listDocumentsForActor|getDocumentById|documents\.(?:filter|find)|SEED_DOCUMENTS)\b/;
  for (const relativePath of [
    "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
    "src/app/(staff)/documents/(queue)/page.tsx",
    "tests/e2e/role-preview.spec.ts",
    "tests/e2e/real-user-journeys.spec.ts",
  ]) {
    if (!existsSync(path(relativePath))) continue;
    assert.doesNotMatch(source(relativePath), legacyDocumentPattern, relativePath);
  }
});

test("real-service proof never terminates an existing development server", () => {
  const harness = source("scripts/test-postgres-v2-foundation.sh");
  assert.match(harness, /assert_next_dev_lock_available/);
  assert.match(harness, /No process was terminated/);
  assert.doesNotMatch(harness, /stop_stale_next_dev_server|kill\s+["']?\$stale_pid/);
});
