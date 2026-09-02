import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fixedRoleCanAccessRoute } from "../src/lib/fixed-role-policy.ts";
import { isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const actionSource = read(
  "src/lib/server/canonical-admissions-task-actions.ts",
);
const panelSource = read(
  "src/components/platform/admissions/CanonicalAdmissionsTaskPanel.tsx",
);
const workspaceSource = read(
  "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
);
const operationsSectionSource = read(
  "src/app/(staff)/clients/[id]/AdmissionsCaseOperationsSection.tsx",
);
const queueSource = read("src/app/(staff)/tasks/page.tsx");
const shellSource = read("src/app/(staff)/layout.tsx");
const domainSource = read("src/lib/domain.ts");
const legacyActionSource = read("src/lib/actions.ts");
const legacyAccessSource = read("src/lib/access.ts");
const legacyQuerySource = read("src/lib/queries.ts");
const legacyDatabaseSource = read("src/lib/db.ts");

test("Admissions task actions accept only exact canonical command fields", () => {
  assert.match(actionSource, /exactActionStringFields/);
  assert.match(
    actionSource,
    /const CREATE_TASK_FORM_KEYS = \[\s*"details",\s*"due_at",\s*"request_id",\s*"student_case_id",\s*"title",?\s*\] as const/,
  );
  assert.match(
    actionSource,
    /const TRANSITION_TASK_FORM_KEYS = \[\s*"expected_version",\s*"reason",\s*"request_id",\s*"task_id",\s*"to_status",?\s*\] as const/,
  );
  assert.match(
    actionSource,
    /requirePlatformCapability\("admissions\.write", "\/clients"\)/,
  );
  assert.match(actionSource, /createCanonicalAdmissionsTask\(/);
  assert.match(actionSource, /transitionCanonicalAdmissionsTask\(/);
  assert.match(actionSource, /idempotencyKey: input\.requestId/);
  assert.match(actionSource, /correlationId: input\.requestId/);
  assert.match(actionSource, /idempotency_conflict: "request_conflict"/);
  assert.match(actionSource, /conflict: "stale"/);
  assert.match(actionSource, /randomUUID\(\)/);
  assert.doesNotMatch(
    actionSource,
    /@\/lib\/(?:actions|db|queries)|platform-admissions-case-workspace|supabase|fallback/i,
  );
});

test("Student 360 renders every canonical case task beside the handoff starter set", () => {
  assert.match(workspaceSource, /renderLegacyAdmissionsOperationsSection/);
  assert.match(workspaceSource, /handoff\.starterTasks/);

  assert.match(operationsSectionSource, /listCanonicalAdmissionsTasks\(\{/);
  assert.match(operationsSectionSource, /studentCaseId/);
  assert.match(operationsSectionSource, /pageSize: 50/);
  assert.match(operationsSectionSource, /<CanonicalAdmissionsTaskPanel/);

  for (const testId of [
    "canonical-admissions-task-panel",
    "canonical-admissions-task-create-form",
    "canonical-admissions-task-list",
    "canonical-admissions-task",
    "canonical-admissions-task-complete-form",
    "canonical-admissions-task-cancel-form",
  ]) {
    assert.match(panelSource, new RegExp(`data-testid=["{][^\\n]*${testId}`));
  }
  assert.match(panelSource, /router\.refresh\(\)/);
  assert.match(panelSource, /new Date\(localDueAt\)\.toISOString\(\)/);
  assert.match(panelSource, /name="reason"/);
  assert.match(panelSource, /required/);
  assert.match(panelSource, /ru:\s*\{/);
  assert.match(panelSource, /ky:\s*\{/);
  assert.match(panelSource, /en:\s*\{/);
});

test("the active tasks route is one canonical Admissions queue", () => {
  assert.equal(isConnectedPlatformPage("/tasks"), true);
  assert.equal(isConnectedPlatformPage("/tasks/anything"), false);
  assert.equal(fixedRoleCanAccessRoute("admin", "/tasks"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/tasks"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/tasks"), false);

  assert.match(
    queueSource,
    /requirePlatformCapability\("admissions\.read", "\/tasks"\)/,
  );
  assert.match(queueSource, /listCanonicalAdmissionsTasks\(\{/);
  assert.match(queueSource, /pageSize: 50/);
  assert.match(queueSource, /data-testid="canonical-admissions-task-queue"/);
  assert.match(queueSource, /<CanonicalAdmissionsTaskPanel/);
  assert.doesNotMatch(
    queueSource,
    /@\/lib\/(?:actions|db|queries)|requireStaffRoute|TASK_COLUMNS|TASK_PRIORITIES|listTasksForActor|fallback/i,
  );

  assert.match(shellSource, /new Set\(FIXED_ROLE_ROUTES\)/);
  assert.doesNotMatch(shellSource, /CONNECTED_STAFF_ROUTES/);
  assert.match(
    domainSource,
    /href: APP_ROUTES\.staff\.tasks,[\s\S]*?allowedRoles: \["admin", "admissions"\]/,
  );
});

test("temporary legacy case sections fail locally instead of breaking the whole Student 360 route", () => {
  assert.match(
    workspaceSource,
    /renderLegacyAdmissionsOperationsSection/,
  );
  assert.match(
    workspaceSource,
    /renderLegacyAmoCrmCaseCommandSection/,
  );
  assert.match(
    workspaceSource,
    /Admissions operations stay unavailable for this Supabase case until the[\s\S]*temporary legacy bridge is replaced/,
  );
  assert.match(
    workspaceSource,
    /amoCRM command status is temporarily unavailable for this Supabase case/,
  );
});

test("the active task surfaces have no legacy task fallback", () => {
  const activeTaskSurface = [
    actionSource,
    panelSource,
    workspaceSource,
    operationsSectionSource,
    queueSource,
  ].join("\n");

  assert.doesNotMatch(
    activeTaskSurface,
    /addTaskAction|moveTaskAction|listTasksForActor|TASK_COLUMNS|TASK_PRIORITIES|platform-admissions-case-workspace|create_case_task|update_case_task|fallback/i,
  );
});

test("the superseded active SQLite task contracts are deleted", () => {
  assert.doesNotMatch(
    legacyActionSource,
    /\b(?:addTaskAction|moveTaskAction|completeTaskAction|TASK_COLUMNS|TASK_PRIORITIES)\b/,
  );
  assert.doesNotMatch(
    legacyQuerySource,
    /\b(?:listTasks|listTasksForActor)\b/,
  );
  assert.doesNotMatch(
    legacyDatabaseSource,
    /export const (?:TASK_COLUMNS|TASK_PRIORITIES)\b/,
  );
  assert.doesNotMatch(
    legacyAccessSource,
    /\b(?:write_tasks|canMutateClientlessTask|canReceiveClientlessTask|canReceiveClientTask)\b/,
  );
});
