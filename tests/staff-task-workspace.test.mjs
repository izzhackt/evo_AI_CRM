import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readStaffTaskWorkspace } from "../src/lib/v3/staff-task-source.ts";

const CASE_ID = "65000000-0000-4000-8000-000000000001";
const MEMBER_ID = "65000000-0000-4000-8000-000000000002";
const actor = Object.freeze({
  authUserId: "65000000-0000-4000-8000-000000000003",
  profileId: "65000000-0000-4000-8000-000000000004",
  membershipId: MEMBER_ID,
  organizationId: "65000000-0000-4000-8000-000000000005",
  displayName: "Test staff", email: "staff@example.test",
  systemRole: "staff", presentationRole: null,
  platformAccessVersion: 1, assignments: [], permissionKeys: [],
});
const options = Object.freeze({
  view: "mine", status: "active", cursor: null, caseCursor: null,
  domain: "case", taskId: null, selectedCaseId: null,
});
const emptyPage = Object.freeze({ rows: [], nextCursor: null });

// These readers replace repository I/O, not the production coordinator or its
// permission decisions. No Auth, SQL or browser authority is claimed here.
function recordingReaders(overrides = {}) {
  const calls = [];
  const results = {
    listStaffParticipants: [], listStaffTaskAssignees: [], listStaffTasks: emptyPage,
    listPlatformAdmissionsTaskQueue: emptyPage, listPlatformStudentCases: emptyPage,
    getPlatformAdmissionsTaskWorkspace: { assignees: [] }, ...overrides,
  };
  const readers = Object.fromEntries(Object.entries(results).map(([name, result]) => [name, async (...args) => {
    calls.push({ name, args });
    if (result instanceof Error) throw result;
    return result;
  }]));
  return { calls, readers };
}

test("case-create-only workspace preserves exact selected-case composer without reading a queue", async () => {
  const creator = { ...actor, permissionKeys: ["case.read.full", "profile.read.full", "task.create"] };
  const recorded = recordingReaders({
    listPlatformStudentCases: { rows: [{ access: "full", studentCase: {
      studentCaseId: CASE_ID, studentDisplayName: "Test student", state: "active",
    } }], nextCursor: null },
    getPlatformAdmissionsTaskWorkspace: { assignees: [{ membershipId: MEMBER_ID, displayName: "Test assignee" }] },
  });
  const workspace = await readStaffTaskWorkspace(creator, { ...options, selectedCaseId: CASE_ID }, recorded);
  assert.deepEqual(recorded.calls, [
    { name: "listPlatformStudentCases", args: [creator, { studentCaseId: CASE_ID, state: "active", pageSize: 1 }] },
    { name: "getPlatformAdmissionsTaskWorkspace", args: [creator, CASE_ID] },
  ]);
  assert.equal(workspace.canReadCases, true);
  assert.equal(workspace.canReadCaseTasks, false);
  assert.equal(workspace.canReadStaffTasks, false);
  assert.deepEqual(workspace.tasks, []);
  assert.deepEqual(workspace.selectedCase, { id: CASE_ID, name: "Test student" });
  assert.deepEqual(workspace.caseAssignees, [{ membershipId: MEMBER_ID, displayName: "Test assignee" }]);
});

test("case-create-only workspace without a selection does not fetch cases or generic assignees", async () => {
  const recorded = recordingReaders();
  const workspace = await readStaffTaskWorkspace({ ...actor, permissionKeys: ["case.read.full", "task.create"] }, options, recorded);
  assert.deepEqual(recorded.calls, []);
  assert.equal(workspace.canReadCases, true);
  assert.equal(workspace.canReadCaseTasks, false);
  assert.equal(workspace.selectedCase, null);
  assert.deepEqual(workspace.caseAssignees, []);
});

test("task.manage alone lists case tasks without requiring case or profile read", async () => {
  const manager = { ...actor, permissionKeys: ["task.manage"] };
  const row = { caseTaskId: "65000000-0000-4000-8000-000000000006", title: "Test task" };
  const recorded = recordingReaders({ listPlatformAdmissionsTaskQueue: { rows: [row], nextCursor: null } });
  const workspace = await readStaffTaskWorkspace(manager, options, recorded);
  assert.deepEqual(recorded.calls, [{ name: "listPlatformAdmissionsTaskQueue", args: [manager, { pageSize: 50, cursor: null }] }]);
  assert.equal(workspace.canReadCaseTasks, true);
  assert.equal(workspace.canReadCases, false);
  assert.deepEqual(workspace.tasks, [{ kind: "case", task: row }]);
});

test("a permitted empty case queue remains distinct from an unpermitted queue", async () => {
  const recorded = recordingReaders();
  const workspace = await readStaffTaskWorkspace({ ...actor, permissionKeys: ["task.manage"] }, options, recorded);
  assert.equal(workspace.canReadCaseTasks, true);
  assert.deepEqual(workspace.tasks, []);
  assert.equal(recorded.calls.length, 1);
});

test("staff-create-only workspace loads composer recipients but not the staff list", async () => {
  const creator = { ...actor, permissionKeys: ["staff.task.create"] };
  const recipients = [{ membershipId: MEMBER_ID, displayName: "Test assignee", role: null }];
  const recorded = recordingReaders({ listStaffTaskAssignees: recipients });
  const workspace = await readStaffTaskWorkspace(creator, { ...options, domain: "staff" }, recorded);
  assert.deepEqual(recorded.calls, [
    { name: "listStaffParticipants", args: [creator] },
    { name: "listStaffTaskAssignees", args: [creator, null] },
  ]);
  assert.equal(workspace.canReadStaffTasks, false);
  assert.deepEqual(workspace.tasks, []);
  assert.deepEqual(workspace.assignees, recipients);
});

test("staff.task.read lists staff tasks without loading mutation recipients", async () => {
  const reader = { ...actor, permissionKeys: ["staff.task.read"] };
  const recorded = recordingReaders();
  const workspace = await readStaffTaskWorkspace(reader, { ...options, domain: "staff" }, recorded);
  assert.equal(workspace.canReadStaffTasks, true);
  assert.deepEqual(recorded.calls.map(({ name }) => name), ["listStaffParticipants", "listStaffTasks"]);
});

test("reading a selected staff task does not require edit-only assignee lookup", async () => {
  const reader = { ...actor, permissionKeys: ["staff.task.read", "staff.task.create"] };
  const selected = { id: "65000000-0000-4000-8000-000000000006", title: "Test staff task" };
  const recorded = recordingReaders({ listStaffTasks: { rows: [selected], nextCursor: null } });
  const workspace = await readStaffTaskWorkspace(reader, { ...options, domain: "staff", taskId: selected.id }, recorded);
  assert.equal(workspace.selectedTask, selected);
  assert.equal(recorded.calls.some(({ name }) => name === "listStaffTaskAssignees"), false);
  assert.deepEqual(recorded.calls.filter(({ name }) => name === "listStaffTasks").at(-1)?.args,
    [reader, { view: "all", status: "all", taskId: selected.id }]);
});

test("an allowed queue reader error propagates instead of becoming an empty queue", async () => {
  const error = new Error("Task queue unavailable");
  const recorded = recordingReaders({ listPlatformAdmissionsTaskQueue: error });
  await assert.rejects(readStaffTaskWorkspace({ ...actor, permissionKeys: ["case.read.full", "task.manage"] }, options, recorded), error);
});

test("an allowed staff list error also remains unavailable, not empty", async () => {
  const error = new Error("Staff task list unavailable");
  const recorded = recordingReaders({ listStaffTasks: error });
  await assert.rejects(readStaffTaskWorkspace({ ...actor, permissionKeys: ["staff.task.read"] }, { ...options, domain: "staff" }, recorded), error);
});

test("Admin actual and admissions preview retain case queue; Sales preview does not request it", async () => {
  for (const [presentationRole, permitted] of [[null, true], ["admissions", true], ["sales", false]]) {
    const recorded = recordingReaders();
    const workspace = await readStaffTaskWorkspace({ ...actor, systemRole: "admin", presentationRole }, options, recorded);
    assert.equal(workspace.canReadCaseTasks, permitted);
    assert.equal(recorded.calls.some(({ name }) => name === "listPlatformAdmissionsTaskQueue"), permitted);
  }
});

test("tasks page wires explicit queue availability separately from the case composer", () => {
  const page = readFileSync(new URL("../src/app/(v3)/v3/tasks/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const canReadTaskQueue = domain === "staff" \? workspace\.canReadStaffTasks : workspace\.canReadCaseTasks/);
  assert.match(page, /!canReadTaskQueue \? <p role="status"/);
  assert.match(page, /В вашей роли нет права на просмотр/);
  assert.match(page, /canCreateCase=\{workspace\.canReadCases && staffHasPermission\(actor, "task\.create"\)\}/);
});
