import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const removedRuntimeFiles = [
  "src/app/(staff)/clients/[id]/CanonicalStudentCaseWorkspace.tsx",
  "src/components/platform/sales/CanonicalSalesGateCard.tsx",
  "src/components/platform/sales/CanonicalSalesHandoffCard.tsx",
  "src/lib/server/canonical-sales-gate-actions.ts",
  "src/lib/server/canonical-sales-handoff-actions.ts",
  "tests/canonical-crm-postgres.test.mjs",
];

test("P3 deletes the replaced Drizzle gate, handoff and Student 360 runtime", () => {
  for (const path of removedRuntimeFiles) {
    assert.equal(
      existsSync(new URL(`../${path}`, import.meta.url)),
      false,
      `${path} must not remain after the Supabase replacement is proven`,
    );
  }
});

test("P3 active routes have one Supabase authority and no legacy fallback import", () => {
  const activeSources = [
    source("src/app/(staff)/sales/[id]/SalesLeadWorkspace.tsx"),
    source("src/app/(staff)/clients/[id]/page.tsx"),
    source("src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx"),
    source("src/components/platform/sales/PlatformSalesGateCard.tsx"),
    source("src/components/platform/sales/PlatformSalesHandoffCard.tsx"),
    source("src/lib/platform-student-handoff.ts"),
    source("src/lib/platform-student-handoff-actions.ts"),
  ].join("\n");

  assert.match(activeSources, /staff_lead_admissions_gate/);
  assert.match(activeSources, /handoff_lead_to_admissions/);
  assert.match(activeSources, /staff_student_case_handoff_context/);
  assert.doesNotMatch(
    activeSources,
    /CanonicalStudentCaseWorkspace|CanonicalSalesGateCard|CanonicalSalesHandoffCard|canonical-sales-(?:gate|handoff)-actions|canonical-crm-repository|staff_student_case_read_snapshot|drizzle|service[_-]?role|fallback/i,
  );
});

test("P4 retires the Admissions wrapper and leaves only the Platform amoCRM section", () => {
  const studentWorkspace = source(
    "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
  );
  const amocrmWrapper = source(
    "src/app/(staff)/clients/[id]/PlatformAmoCrmCommandSection.tsx",
  );

  assert.equal(
    existsSync(
      new URL(
        "../src/app/(staff)/clients/[id]/AdmissionsCaseOperationsSection.tsx",
        import.meta.url,
      ),
    ),
    false,
  );
  assert.match(studentWorkspace, /<PlatformAdmissionsTaskPanel/);
  assert.match(studentWorkspace, /<PlatformAdmissionsOperationsPanel/);
  assert.match(studentWorkspace, /<PlatformPrivateDocumentsPanel/);
  assert.equal(
    existsSync(
      new URL(
        "../src/app/(staff)/clients/[id]/AmoCrmCaseCommandSection.tsx",
        import.meta.url,
      ),
    ),
    false,
  );
  assert.match(studentWorkspace, /<PlatformAmoCrmCommandSection/);
  assert.doesNotMatch(studentWorkspace, /canonical-crm-repository|private-document-repository/);
  assert.match(amocrmWrapper, /canonical-amocrm-command/);
  assert.doesNotMatch(
    amocrmWrapper,
    /getCanonicalLeadGateSnapshot|recordCanonicalSalesGateEvidence|handoffCanonicalLeadToAdmissions|getCanonicalStudentCaseSnapshot/,
  );
});

test("P3 local browser gate no longer prepares or runs the old amoCRM handoff fixture", () => {
  const harness = source("scripts/test-postgres-v2-foundation.sh");

  assert.doesNotMatch(harness, /amocrm_command_browser_assert/);
  assert.doesNotMatch(harness, /seed-canonical-amocrm-browser-blocker/);
  assert.doesNotMatch(harness, /tests\/e2e\/canonical-amocrm-command\.spec\.ts/);
  assert.doesNotMatch(harness, /updateCanonicalSalesLeadWorkflow/);
  assert.doesNotMatch(harness, /private_document_browser_assert/);
  assert.doesNotMatch(harness, /tests\/canonical-crm-postgres\.test\.mjs/);
  assert.match(harness, /supabase_staff_auth_browser_assert configured/);
});
