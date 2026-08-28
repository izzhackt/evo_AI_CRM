import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

function source(path) {
  const url = new URL(path, root);
  assert.equal(existsSync(url), true, `${path} must exist`);
  return readFileSync(url, "utf8");
}

test("Student 360 is the only canonical admissions operations write surface", () => {
  const workspace = source(
    "src/app/(staff)/clients/[id]/CanonicalStudentCaseWorkspace.tsx",
  );
  const panel = source(
    "src/components/platform/admissions/CanonicalAdmissionsOperationsPanel.tsx",
  );

  assert.match(workspace, /getCanonicalAdmissionsOperationsSnapshot/);
  assert.match(workspace, /CanonicalAdmissionsOperationsPanel/);
  assert.match(panel, /data-testid="canonical-admissions-operations"/);
  assert.match(panel, /data-testid="canonical-university-application-create-form"/);
  assert.match(panel, /data-testid="canonical-university-application"/);
  assert.match(panel, /data-application-id=/);
  assert.match(panel, /data-status=/);
  assert.match(panel, /data-testid="canonical-university-application-update-form"/);
  assert.match(panel, /data-testid="canonical-university-application-transition-form"/);
  assert.match(panel, /data-to-status=/);
  assert.match(panel, /data-testid="canonical-visa-milestone"/);
  assert.match(panel, /data-kind=/);
  assert.match(panel, /data-testid="canonical-visa-milestone-transition-form"/);
  assert.match(panel, /data-testid="canonical-finance-stop"/);
  assert.match(panel, /data-is-stopped=/);
  assert.match(panel, /data-version=/);
  assert.match(panel, /data-testid="canonical-finance-stop-assert-form"/);
  assert.match(panel, /data-testid="canonical-finance-stop-release-form"/);
  assert.match(
    panel,
    /const editable = active && \(application\.status === "draft" \|\| application\.status === "submitted"\)/,
  );
  assert.match(panel, /active && milestone\.status !== "completed"/);
  assert.match(panel, /ApplicationItem[\s\S]*active=\{active\}/);
  assert.match(panel, /VisaMilestoneItem[\s\S]*active=\{active\}/);

  for (const locale of ["ru", "ky", "en"]) {
    assert.match(panel, new RegExp(`\\b${locale}: \\{`));
  }
});

test("applications, visa and finance routes are canonical read-only queues", () => {
  const queues = [
    [
      "src/app/(staff)/applications/page.tsx",
      "listCanonicalUniversityApplications",
      "canonical-application-queue",
      "applications",
    ],
    [
      "src/app/(staff)/visa/page.tsx",
      "listCanonicalVisaMilestones",
      "canonical-visa-queue",
      "visa",
    ],
    [
      "src/app/(staff)/finance/page.tsx",
      "listCanonicalFinanceStops",
      "canonical-finance-stop-queue",
      "finance",
    ],
  ];

  for (const [path, repositoryRead, testId, anchor] of queues) {
    const route = source(path);
    assert.match(route, new RegExp(repositoryRead));
    assert.match(route, new RegExp(`data-testid="${testId}"`));
    assert.match(route, new RegExp(`/clients/\\$\\{[^}]+\\}#${anchor}`));
    assert.match(route, /parseCanonicalReadCursor/);
    assert.match(route, /before_at/);
    assert.match(route, /before_id/);
    assert.match(route, /page\.hasNext && page\.nextCursor/);
    assert.match(route, /rel="next"/);
    assert.doesNotMatch(
      route,
      /@\/lib\/(?:actions|queries|platform-(?:admissions|case|catalog|finance))/,
    );
    assert.doesNotMatch(route, /<form|action=|useActionState/);
  }
});

test("superseded route-local workspaces and dynamic detail routes are gone", () => {
  for (const path of [
    "src/app/(staff)/applications/ApplicationsPresenter.tsx",
    "src/app/(staff)/applications/ApplicationsWorkspace.tsx",
    "src/app/(staff)/applications/CatalogImportWorkspace.tsx",
    "src/app/(staff)/applications/ApplicationInstitutionFields.tsx",
    "src/app/(staff)/applications/[id]/page.tsx",
    "src/app/(staff)/applications/[id]/ApplicationWorkspace.tsx",
    "src/app/(staff)/visa/[id]/page.tsx",
    "src/app/(staff)/finance/[id]/page.tsx",
  ]) {
    assert.equal(existsSync(new URL(path, root)), false, path);
  }
});
