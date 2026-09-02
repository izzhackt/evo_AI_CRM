import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fixedRoleCanAccessRoute } from "../src/lib/fixed-role-policy.ts";
import { isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const actionSource = read("src/lib/platform-admissions-task-actions.ts");
const repositorySource = read("src/lib/platform-admissions-workspace.ts");
const taskContractSource = read("src/lib/platform-admissions-task-contract.ts");
const panelSource = read(
  "src/components/platform/admissions/PlatformAdmissionsTaskPanel.tsx",
);
const workspaceSource = read(
  "src/app/(staff)/clients/[id]/StudentCaseWorkspace.tsx",
);
const queueSource = read("src/app/(staff)/tasks/page.tsx");
const shellSource = read("src/app/(staff)/layout.tsx");
const domainSource = read("src/lib/domain.ts");

test("Admissions task commands validate exact fields and write only through Supabase RPCs", () => {
  assert.match(actionSource, /hasExactFields\(form/);
  for (const field of [
    "student_case_id",
    "task_type",
    "title",
    "assignee_membership_id",
    "priority",
    "due_at",
    "status",
    "student_visible",
    "request_id",
    "return_to_case",
    "case_task_id",
  ]) {
    assert.match(actionSource, new RegExp(`"${field}"`), field);
  }
  assert.match(actionSource, /requirePlatformCapability\(\s*"admissions\.write"/);
  assert.match(actionSource, /createSupabaseServerClient\(\)/);
  assert.match(actionSource, /\.schema\("platform"\)\.rpc\("create_case_task"/);
  assert.match(actionSource, /\.schema\("platform"\)\.rpc\("change_case_task"/);
  assert.match(actionSource, /p_request_id:\s*requestId/);
  assert.match(actionSource, /task_retry_request_id/);
  assert.match(actionSource, /task_retry_operation/);
  assert.doesNotMatch(
    actionSource,
    /canonical-admissions|canonical-crm-repository|@\/lib\/(?:actions|db|queries)|drizzle|sqlite|fallback/i,
  );
});

test("Student 360 and the task queue use the same Supabase task workspace", () => {
  assert.match(workspaceSource, /getPlatformAdmissionsTaskWorkspace\(actor, id\)/);
  assert.match(workspaceSource, /<PlatformAdmissionsTaskPanel/);
  assert.match(queueSource, /listPlatformAdmissionsTaskQueue\(actor/);
  assert.match(queueSource, /<PlatformAdmissionsTaskPanel/);

  for (const testId of [
    "platform-admissions-task-panel",
    "platform-admissions-task-create-form",
    "platform-admissions-task-list",
    "platform-admissions-task",
    "platform-admissions-task-change-form",
  ]) {
    assert.match(panelSource, new RegExp(`data-testid=["{][^\\n]*${testId}`));
  }

  assert.match(repositorySource, /staff_student_case_task_workspace/);
  assert.match(repositorySource, /staff_case_task_queue/);
  assert.match(repositorySource, /createSupabaseServerClient\(\)/);
  assert.doesNotMatch(
    `${repositorySource}\n${workspaceSource}\n${queueSource}\n${panelSource}`,
    /canonical-admissions|AdmissionsCaseOperationsSection|canonical-crm-repository|drizzle|sqlite|fallback/i,
  );
});

test("the client task panel imports only the client-safe task contract", () => {
  assert.match(panelSource, /@\/lib\/platform-admissions-task-contract/);
  assert.doesNotMatch(panelSource, /@\/lib\/platform-admissions-workspace/);
  assert.match(taskContractSource, /PLATFORM_CASE_TASK_STATUSES/);
  assert.match(taskContractSource, /PLATFORM_CASE_TASK_PRIORITIES/);
  assert.doesNotMatch(
    taskContractSource,
    /next\/headers|supabase\/server|createSupabaseServerClient/,
  );
});

test("Admissions and Admin can open tasks while Sales fails closed", () => {
  assert.equal(isConnectedPlatformPage("/tasks"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/tasks"), true);
  assert.equal(fixedRoleCanAccessRoute("admin", "/tasks"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/tasks"), false);
  assert.match(queueSource, /requirePlatformCapability\("admissions\.read", "\/tasks"\)/);
  assert.match(queueSource, /data-testid="platform-admissions-task-queue"/);
  assert.doesNotMatch(shellSource, /CONNECTED_STAFF_ROUTES/);
  assert.match(
    domainSource,
    /href: APP_ROUTES\.staff\.tasks,[\s\S]*?allowedRoles: \["admin", "admissions"\]/,
  );
});

test("task adapters fail closed on malformed database rows and RPC errors", () => {
  assert.match(repositorySource, /function invalidShape\(\): never/);
  assert.match(repositorySource, /throw new PlatformAdmissionsWorkspaceRepositoryError\(\)/);
  assert.match(repositorySource, /function failClosed\(error: unknown\): never/);
  assert.match(repositorySource, /if \(response\.error\) return invalidShape\(\)/);
  assert.match(repositorySource, /return failClosed\(error\)/);
  assert.doesNotMatch(repositorySource, /return\s+(?:\[\]|null).*fallback/i);
});
