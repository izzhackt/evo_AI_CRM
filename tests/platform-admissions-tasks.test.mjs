import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { fixedRoleCanAccessRoute } from "../src/lib/fixed-role-policy.ts";
import { isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const actionSource = read("src/lib/platform-admissions-task-actions.ts");
const repositorySource = read("src/lib/platform-admissions-workspace.ts");
const taskContractSource = read("src/lib/platform-admissions-task-contract.ts");
const calendarSource = read("src/components/v3/calendar/Calendar.tsx");
const controlsSource = read("src/components/v3/calendar/TaskControls.tsx");
const adapterSource = read("src/lib/v3/calendar-source.ts");
const queueSource = read("src/app/(staff)/tasks/page.tsx");
const workspaceSource = read(
  "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
);
const shellSource = read("src/app/(staff)/layout.tsx");
const domainSource = read("src/lib/domain.ts");

test("Admissions task commands are exact, versioned Supabase actions", () => {
  assert.match(actionSource, /exactActionStringFields\(form, CREATE_TASK_FIELDS\)/);
  assert.match(actionSource, /exactActionStringFields\(form, CHANGE_TASK_FIELDS\)/);
  for (const field of [
    "student_case_id",
    "case_task_id",
    "task_type",
    "title",
    "assignee_membership_id",
    "priority",
    "due_at",
    "status",
    "student_visible",
    "expected_version",
    "request_id",
  ]) {
    assert.match(actionSource, new RegExp(`"${field}"`), field);
  }
  assert.match(actionSource, /fixedRoleCan\(actor\.authorityRole, "admissions\.write"\)/);
  assert.match(actionSource, /\.schema\("platform"\)\.rpc\("create_case_task"/);
  assert.match(actionSource, /\.schema\("platform"\)\.rpc\("change_case_task"/);
  assert.match(actionSource, /p_case_task_id:\s*caseTaskId/);
  assert.match(actionSource, /p_expected_version:\s*expectedVersion/);
  assert.match(actionSource, /p_request_id:\s*requestId/);
  assert.match(actionSource, /expectedVersion !== "0"/);
  assert.match(actionSource, /message === "case_task_version_conflict"/);
  assert.match(actionSource, /"expected_version", "version", "changed_at"/);
  assert.match(actionSource, /status === "request_conflict"[\s\S]*?randomUUID\(\)/);
  assert.doesNotMatch(
    actionSource,
    /status === "stale"\s*\|\|\s*status === "request_conflict"/,
  );
  assert.doesNotMatch(actionSource, /redirect\(|return_to_case|task_retry_/);
  assert.doesNotMatch(
    actionSource,
    /canonical-admissions|canonical-crm-repository|@\/lib\/(?:actions|db|queries)|drizzle|sqlite|fallback/i,
  );
});

test("V3 calendar is the only active task mutation surface", () => {
  assert.equal(
    existsSync(
      new URL(
        "../src/components/platform/admissions/PlatformAdmissionsTaskPanel.tsx",
        import.meta.url,
      ),
    ),
    false,
  );
  assert.equal(
    existsSync(
      new URL("../src/components/v3/calendar/TaskActions.tsx", import.meta.url),
    ),
    false,
  );
  assert.match(calendarSource, /\.\/TaskControls/);
  assert.match(queueSource, /redirect\("\/v3\/calendar"\)/);
  assert.doesNotMatch(workspaceSource, /PlatformAdmissionsTaskPanel/);
  assert.match(
    controlsSource,
    /useActionState\(\s*createPlatformAdmissionsTaskAction/,
  );
  assert.match(
    controlsSource,
    /useActionState\(\s*changePlatformAdmissionsTaskAction/,
  );
});

test("task reads expose exact versions and bounded case choices", () => {
  assert.match(repositorySource, /staff_student_case_task_workspace/);
  assert.match(repositorySource, /staff_case_task_queue/);
  assert.match(repositorySource, /version:\s*positiveBigint\(row\.version\)/);
  assert.match(taskContractSource, /version: string/);
  assert.match(adapterSource, /listPlatformAdmissionsTaskQueue/);
  assert.match(adapterSource, /listPlatformStudentCases/);
  assert.match(adapterSource, /getPlatformAdmissionsTaskWorkspace/);
  assert.match(adapterSource, /const QUEUE_PAGE_SIZE = 100/);
  assert.match(adapterSource, /const CASE_PAGE_SIZE = 100/);
  assert.match(adapterSource, /casesHaveMore:\s*cases\.hasNext/);
  assert.match(controlsSource, /Показаны первые 100 активных Student 360/);
  assert.doesNotMatch(
    `${repositorySource}\n${adapterSource}`,
    /canonical-admissions|canonical-crm-repository|drizzle|sqlite|fallback/i,
  );
});

test("task adapters fail closed on malformed database rows and RPC errors", () => {
  assert.match(repositorySource, /function invalidShape\(\): never/);
  assert.match(
    repositorySource,
    /throw new PlatformAdmissionsWorkspaceRepositoryError\(\)/,
  );
  assert.match(repositorySource, /function failClosed\(error: unknown\): never/);
  assert.match(repositorySource, /if \(response\.error\) return invalidShape\(\)/);
  assert.match(repositorySource, /return failClosed\(error\)/);
  assert.doesNotMatch(repositorySource, /return\s+(?:\[\]|null).*fallback/i);
});

test("Admissions and Admin can open tasks while Sales fails closed", () => {
  assert.equal(isConnectedPlatformPage("/tasks"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/tasks"), true);
  assert.equal(fixedRoleCanAccessRoute("admin", "/tasks"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/tasks"), false);
  assert.doesNotMatch(shellSource, /CONNECTED_STAFF_ROUTES/);
  assert.match(
    domainSource,
    /href: APP_ROUTES\.staff\.tasks,[\s\S]*?allowedRoles: \["admin", "admissions"\]/,
  );
});
