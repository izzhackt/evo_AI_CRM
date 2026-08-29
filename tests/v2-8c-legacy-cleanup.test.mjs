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
