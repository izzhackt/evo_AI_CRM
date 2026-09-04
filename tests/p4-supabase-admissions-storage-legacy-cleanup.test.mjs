import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function path(relativePath) {
  return new URL(`../${relativePath}`, import.meta.url);
}

function source(relativePath) {
  return readFileSync(path(relativePath), "utf8");
}

const REMOVED_RUNTIME_PATHS = [
  "playwright.private-documents.config.ts",
  "src/app/(staff)/clients/[id]/AdmissionsCaseOperationsSection.tsx",
  "src/app/api/v2/documents/route.ts",
  "src/app/api/v2/documents/[documentId]/resubmissions/route.ts",
  "src/components/platform/admissions/CanonicalAdmissionsOperationsPanel.tsx",
  "src/components/platform/admissions/CanonicalAdmissionsTaskPanel.tsx",
  "src/components/platform/documents/CanonicalPrivateDocumentsPanel.tsx",
  "src/db/schema/private-documents.ts",
  "src/lib/server/canonical-admissions-operations-actions.ts",
  "src/lib/server/canonical-admissions-task-actions.ts",
  "src/lib/server/private-document-authorization.ts",
  "src/lib/server/private-document-files.ts",
  "src/lib/server/private-document-multipart.ts",
  "src/lib/server/private-document-repository.ts",
  "src/lib/server/private-document-route-handlers.ts",
];

const ACTIVE_ADMISSIONS_AND_DOCUMENT_PATHS = [
  "src/app/(staff)/applications/page.tsx",
  "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
  "src/app/(staff)/documents/(queue)/page.tsx",
  "src/app/(staff)/finance/page.tsx",
  "src/app/(staff)/tasks/page.tsx",
  "src/app/(staff)/visa/page.tsx",
  "src/app/api/v2/document-slots/[documentSlotId]/versions/route.ts",
  "src/app/api/v2/document-versions/[versionId]/download/route.ts",
  "src/components/v3/calendar/TaskControls.tsx",
  "src/components/v3/profile/ProfileAdmissionsWorkspace.tsx",
  "src/components/v3/profile/ProfileDocumentsClient.tsx",
  "src/lib/platform-admissions-task-actions.ts",
  "src/lib/platform-admissions-workspace.ts",
  "src/lib/platform-private-document-actions.ts",
  "src/lib/platform-private-documents.ts",
  "src/lib/v3/calendar-source.ts",
  "src/lib/v3/profile-source.ts",
  "src/lib/server/platform-document-storage-route-handlers.ts",
];

test("P4 removes every superseded Admissions and local-document runtime file", () => {
  for (const relativePath of REMOVED_RUNTIME_PATHS) {
    assert.equal(
      existsSync(path(relativePath)),
      false,
      `${relativePath} must not survive the proved Supabase replacement`,
    );
  }
});

test("P4 active surfaces have one Supabase authority and no compatibility fallback", () => {
  const activeSource = ACTIVE_ADMISSIONS_AND_DOCUMENT_PATHS
    .map((relativePath) => source(relativePath))
    .join("\n");

  assert.match(activeSource, /createSupabaseServerClient|createPlatformSupabaseServiceClient/);
  assert.match(activeSource, /\.schema\("platform"\)\.rpc\(/);
  assert.match(activeSource, /platform-documents/);
  assert.doesNotMatch(
    activeSource,
    /AdmissionsCaseOperationsSection|CanonicalAdmissions(?:Operations|Task)Panel|CanonicalPrivateDocumentsPanel|canonical-admissions-(?:operations|task)-actions|private-document-(?:authorization|files|multipart|repository|route-handlers)|canonical-crm-repository|EVO_PRIVATE_DOCUMENT_ROOT|\bdrizzle\b|\bsqlite\b|compatib(?:ility|le)/i,
  );
  assert.match(activeSource, /\/v3\/(?:calendar|profile)/);
});

test("P4 package and environment contracts no longer carry local-file dependencies", () => {
  const packageJson = JSON.parse(source("package.json"));
  const dependencyNames = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  assert.equal(dependencyNames.has("busboy"), false);
  assert.equal(dependencyNames.has("@types/busboy"), false);

  assert.doesNotMatch(source(".env.example"), /EVO_PRIVATE_DOCUMENT_ROOT/);
  assert.doesNotMatch(source("scripts/evo-app-env-contract.mjs"), /EVO_PRIVATE_DOCUMENT_ROOT/);
});

test("P4 private Storage is non-public, non-overwriting and fails closed", () => {
  const routeHandler = source(
    "src/lib/server/platform-document-storage-route-handlers.ts",
  );
  const backendConfig = source(
    "src/lib/server/platform-supabase-backend-config.ts",
  );

  assert.match(routeHandler, /const BUCKET_ID = "platform-documents"/);
  assert.match(routeHandler, /upsert:\s*false/);
  assert.match(routeHandler, /p_expires_in_seconds:\s*60/);
  assert.match(routeHandler, /consume_document_download_grant/);
  assert.match(routeHandler, /createSignedUrl\(/);
  assert.match(routeHandler, /errorResponse\(503, "(?:platform|storage)_unavailable"\)/);
  assert.doesNotMatch(routeHandler, /getPublicUrl|publicUrl|public\s*:\s*true/i);

  assert.match(backendConfig, /missing_supabase_url/);
  assert.match(backendConfig, /missing_supabase_secret_key/);
  assert.match(backendConfig, /unsafe_supabase_secret_key/);
  assert.doesNotMatch(backendConfig, /anon|publishable|fallback/i);
});
