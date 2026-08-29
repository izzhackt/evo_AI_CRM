import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V2-8C removes the superseded Admissions document runtime files", () => {
  for (const path of [
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
    "src/lib/platform-student-profile-actions.ts",
    "tests/e2e/platform-documents-experience.spec.ts",
    "tests/platform-admissions-case-workspace.test.mjs",
  ]) {
    assert.equal(
      existsSync(new URL(`../${path}`, import.meta.url)),
      false,
      `${path} must be removed once the V2-8C replacement is proven`,
    );
  }
});

test("V2-8C keeps one canonical private-document write path with no fallback imports", () => {
  const student360 = source(
    "src/app/(staff)/clients/[id]/CanonicalStudentCaseWorkspace.tsx",
  );
  const privateDocumentsPanel = source(
    "src/components/platform/documents/CanonicalPrivateDocumentsPanel.tsx",
  );
  const documentsQueue = source("src/app/(staff)/documents/(queue)/page.tsx");

  assert.match(student360, /listPrivateDocumentsForCase\(\{/);
  assert.match(student360, /<CanonicalPrivateDocumentsPanel/);
  assert.doesNotMatch(
    student360,
    /StudentWorkspace|StudentWorkspacePresenter|platform-admissions-case-workspace|platform-document-review|@\/lib\/(?:actions|queries|db)|supabase|sqlite|fallback/i,
  );

  assert.match(privateDocumentsPanel, /\/api\/v2\/documents/);
  assert.match(privateDocumentsPanel, /\/api\/v2\/document-versions\//);
  assert.doesNotMatch(
    privateDocumentsPanel,
    /objectKey|StudentWorkspace|platform-document-review|@\/lib\/(?:actions|queries|db)|supabase|sqlite|fallback/i,
  );

  assert.match(documentsQueue, /listPrivateDocuments\(\{/);
  assert.match(documentsQueue, /`\/clients\/\$\{document\.caseId\}#documents`/);
  assert.doesNotMatch(
    documentsQueue,
    /<form|\/documents\/\$\{|DocumentDecisionPanel|DocumentJourney|DocumentSubmitButton|document-copy|@\/lib\/(?:actions|queries|db)|supabase|sqlite|fallback/i,
  );
});

test("V2-8C removes stale document assertions from fixture browser suites", () => {
  for (const path of [
    "tests/e2e/production-smoke.spec.ts",
    "tests/e2e/platform-operations.spec.ts",
  ]) {
    assert.doesNotMatch(
      source(path),
      /["']\/documents["']|Очередь документов|href\^=["']\/documents\//,
      `${path} must not exercise the replaced fixture/SQLite document UI`,
    );
  }
});

test("V2-8C removes the legacy SQLite document authority from active runtime", () => {
  const legacyDocumentPattern =
    /(?:CREATE TABLE IF NOT EXISTS|FROM|JOIN|INSERT INTO|UPDATE|DELETE FROM)\s+documents\b|clientDocuments(?:ForActor)?|documentsInReview|byDocumentStatus/i;

  for (const path of [
    "src/lib/db.ts",
    "src/lib/queries.ts",
    "src/app/(staff)/dashboard/page.tsx",
    "tests/e2e/platform-navigation-dashboard-polish.spec.ts",
    "tests/e2e/production-smoke.spec.ts",
  ]) {
    assert.doesNotMatch(
      source(path),
      legacyDocumentPattern,
      `${path} must not retain a SQLite document read, seed, KPI, or fixture path`,
    );
  }
});

test("V2 real-service proof never terminates an existing development server", () => {
  const harness = source("scripts/test-postgres-v2-foundation.sh");

  assert.match(harness, /assert_next_dev_lock_available/);
  assert.match(harness, /No process was terminated/);
  assert.doesNotMatch(harness, /stop_stale_next_dev_server|kill\s+["']?\$stale_pid/);
});

test("V2 real-service proof waits for the exact database route before browser acceptance", () => {
  const harness = source("scripts/test-postgres-v2-foundation.sh");

  assert.match(harness, /database_status_code=/);
  assert.match(harness, /\/api\/database\/status/);
  assert.match(harness, /database_status_code" == "200".*database_status_code" == "503"/s);
});

test("V2 private document uploads stream to storage without whole-body parsing", () => {
  const route = source("src/lib/server/private-document-route-handlers.ts");
  const multipart = source("src/lib/server/private-document-multipart.ts");
  const files = source("src/lib/server/private-document-files.ts");

  assert.doesNotMatch(route, /readMultipartFormData|\.formData\(|\.arrayBuffer\(/);
  assert.match(multipart, /Busboy/);
  assert.match(multipart, /pipeline\(/);
  assert.doesNotMatch(multipart, /Buffer\.concat|\.formData\(|\.arrayBuffer\(/);
  assert.match(files, /for await \(const value of input\.chunks\)/);
  assert.doesNotMatch(files, /PreparedPrivateDocumentFile|preparedStates/);
});
