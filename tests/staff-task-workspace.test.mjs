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
// One queue since 25.09.2026: both kinds are read unless `type` narrows it.
const options = Object.freeze({
  view: "mine", state: "open", type: null, due: null, today: "2026-09-24", window: 1, taskId: null, selectedCaseId: null,
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
  assert.deepEqual(workspace.queue, { staff: [], cases: [], complete: true, cutOff: [] });
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
  assert.deepEqual(recorded.calls, [{ name: "listPlatformAdmissionsTaskQueue", args: [manager, { pageSize: 100, cursor: null }] }]);
  assert.equal(workspace.canReadCaseTasks, true);
  assert.equal(workspace.canReadCases, false);
  assert.deepEqual(workspace.queue, { staff: [], cases: [row], complete: true, cutOff: [] });
});

test("a permitted empty case queue remains distinct from an unpermitted queue", async () => {
  const recorded = recordingReaders();
  const workspace = await readStaffTaskWorkspace({ ...actor, permissionKeys: ["task.manage"] }, options, recorded);
  assert.equal(workspace.canReadCaseTasks, true);
  assert.deepEqual(workspace.queue, { staff: [], cases: [], complete: true, cutOff: [] });
  assert.equal(recorded.calls.length, 1);
});

test("staff-create-only workspace loads composer recipients but not the staff list", async () => {
  const creator = { ...actor, permissionKeys: ["staff.task.create"] };
  const recipients = [{ membershipId: MEMBER_ID, displayName: "Test assignee", role: null }];
  const recorded = recordingReaders({ listStaffTaskAssignees: recipients });
  const workspace = await readStaffTaskWorkspace(creator, options, recorded);
  assert.deepEqual(recorded.calls, [
    { name: "listStaffParticipants", args: [creator] },
    { name: "listStaffTaskAssignees", args: [creator, null] },
  ]);
  assert.equal(workspace.canReadStaffTasks, false);
  assert.deepEqual(workspace.queue, { staff: [], cases: [], complete: true, cutOff: [] });
  assert.deepEqual(workspace.assignees, recipients);
});

test("staff.task.read lists staff tasks without loading mutation recipients", async () => {
  const reader = { ...actor, permissionKeys: ["staff.task.read"] };
  const recorded = recordingReaders();
  const workspace = await readStaffTaskWorkspace(reader, options, recorded);
  assert.equal(workspace.canReadStaffTasks, true);
  assert.deepEqual(recorded.calls.map(({ name }) => name), ["listStaffParticipants", "listStaffTasks"]);
  assert.deepEqual(recorded.calls[1].args, [reader, { view: "mine", status: "active", cursor: null }]);
});

test("reading a selected staff task does not require edit-only assignee lookup", async () => {
  const reader = { ...actor, permissionKeys: ["staff.task.read", "staff.task.create"] };
  const selected = { id: "65000000-0000-4000-8000-000000000006", title: "Test staff task" };
  const recorded = recordingReaders({ listStaffTasks: { rows: [selected], nextCursor: null } });
  const workspace = await readStaffTaskWorkspace(reader, { ...options, taskId: selected.id }, recorded);
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
  await assert.rejects(readStaffTaskWorkspace({ ...actor, permissionKeys: ["staff.task.read"] }, options, recorded), error);
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
  const workspace = readFileSync(new URL("../src/components/v3/tasks/TasksWorkspace.tsx", import.meta.url), "utf8");
  // One queue (25.09.2026): either readable kind opens it; no read, no list.
  assert.match(workspace, /const canReadTaskQueue = canReadStaffTasks \|\| canReadCaseTasks;/);
  assert.match(workspace, /!canReadTaskQueue \? <p role="status"/);
  assert.match(workspace, /В вашей роли нет права на просмотр задач\./);
  // The case path of the unified composer keeps the exact gate (explicit
  // about isStaffPreview the way the sibling staffAllowed already was).
  assert.match(page, /caseAllowed: !isStaffPreview\(actor\) && workspace\.canReadCases && staffHasPermission\(actor, "task\.create"\),/);
  assert.match(page, /const staffAllowed = !preview && staffHasPermission\(actor, "staff\.task\.create"\) && !sourceLeadId;/);
});

const page = (rows, nextCursor) => ({ rows, nextCursor });
const caseQueuePage = (rows, nextCursor) => ({ rows, nextCursor, hasNext: nextCursor !== null });

function sequenceReaders(overrides) {
  const calls = [];
  const readers = recordingReaders().readers;
  for (const [name, results] of Object.entries(overrides)) {
    let index = 0;
    readers[name] = async (...args) => { calls.push({ name, args }); return results[Math.min(index++, results.length - 1)]; };
  }
  return { calls, readers };
}

test("the staff list is read page by page until its cursor ends, then the queue is complete", async () => {
  const reader = { ...actor, permissionKeys: ["staff.task.read"] };
  const cursor = { updatedAt: "2026-09-24T04:00:00Z", id: "65000000-0000-4000-8000-000000000010" };
  const recorded = sequenceReaders({ listStaffTasks: [page([{ id: "a" }], cursor), page([{ id: "b" }], null)] });
  const workspace = await readStaffTaskWorkspace(reader, { ...options, state: "done" }, recorded);
  assert.deepEqual(recorded.calls.filter(({ name }) => name === "listStaffTasks").map(({ args }) => args[1]), [
    { view: "mine", status: "completed", cursor: null },
    { view: "mine", status: "completed", cursor },
  ]);
  assert.deepEqual(workspace.queue, { staff: [{ id: "a" }, { id: "b" }], cases: [], complete: true, cutOff: [] });
});

test("a read that hits its page limit is reported incomplete instead of pretending to be whole", async () => {
  const reader = { ...actor, permissionKeys: ["staff.task.read", "task.manage"] };
  const staffCursor = { updatedAt: "2026-09-24T04:00:00Z", id: "65000000-0000-4000-8000-000000000011" };
  const caseCursor = { sortAt: "2026-09-24T04:00:00Z", caseTaskId: "65000000-0000-4000-8000-000000000012" };
  const recorded = sequenceReaders({
    listStaffTasks: [page([{ id: "s" }], staffCursor)],
    listPlatformAdmissionsTaskQueue: [caseQueuePage([{ caseTaskId: "c" }], caseCursor)],
  });
  const workspace = await readStaffTaskWorkspace(reader, options, recorded);
  assert.equal(recorded.calls.filter(({ name }) => name === "listStaffTasks").length, 4);
  assert.equal(recorded.calls.filter(({ name }) => name === "listPlatformAdmissionsTaskQueue").length, 3);
  assert.equal(workspace.queue.complete, false);
  // The screen offers only what shrinks the read that was actually cut off.
  assert.deepEqual(workspace.queue.cutOff, ["staff", "case"]);
  // «Показать больше задач» widens the same read, it does not change its order.
  const wider = sequenceReaders({
    listStaffTasks: [page([{ id: "s" }], staffCursor)],
    listPlatformAdmissionsTaskQueue: [caseQueuePage([{ caseTaskId: "c" }], caseCursor)],
  });
  await readStaffTaskWorkspace(reader, { ...options, window: 2 }, wider);
  assert.equal(wider.calls.filter(({ name }) => name === "listStaffTasks").length, 8);
  assert.equal(wider.calls.filter(({ name }) => name === "listPlatformAdmissionsTaskQueue").length, 6);
});

test("the type filter skips the other read; «Поставил я» never reads case tasks and says so", async () => {
  const reader = { ...actor, permissionKeys: ["staff.task.read", "task.manage"] };
  const onlyCase = recordingReaders();
  await readStaffTaskWorkspace(reader, { ...options, type: "case" }, onlyCase);
  assert.deepEqual(onlyCase.calls.map(({ name }) => name), ["listStaffParticipants", "listPlatformAdmissionsTaskQueue"]);
  const onlyStaff = recordingReaders();
  await readStaffTaskWorkspace(reader, { ...options, type: "staff" }, onlyStaff);
  assert.deepEqual(onlyStaff.calls.map(({ name }) => name), ["listStaffParticipants", "listStaffTasks"]);
  const created = recordingReaders();
  const workspace = await readStaffTaskWorkspace(reader, { ...options, view: "created" }, created);
  assert.deepEqual(created.calls.map(({ name }) => name), ["listStaffParticipants", "listStaffTasks"]);
  assert.equal(workspace.createdExcludesCases, true);
  assert.equal((await readStaffTaskWorkspace({ ...actor, permissionKeys: ["staff.task.read"] }, { ...options, view: "created" }, recordingReaders())).createdExcludesCases, false);
});

const scoped = (kind) => ({ id: "a", roleId: "r", label: "Роль", bundleId: "b", bundleVersion: 1, scope: { kind, key: null, resourceKind: null } });

test("«Вся команда» is offered to Admin, task.manage holders and department heads, never to a Sales preview", async () => {
  for (const [override, expected] of [
    [{ systemRole: "admin" }, true],
    [{ systemRole: "admin", presentationRole: "admissions" }, true],
    [{ systemRole: "admin", presentationRole: "sales" }, false],
    [{ permissionKeys: ["task.manage"] }, true],
    [{ permissionKeys: ["staff.task.read", "staff.task.create"] }, false],
    // Own scope plus the organization-wide common role: nothing beyond «Мои» and «Поставил я».
    [{ permissionKeys: ["staff.task.read"], assignments: [scoped("own"), scoped("organization")] }, false],
    [{ permissionKeys: ["staff.task.read"], assignments: [scoped("department")] }, true],
    [{ permissionKeys: ["staff.task.create"], assignments: [scoped("department")] }, false],
  ]) {
    const workspace = await readStaffTaskWorkspace({ ...actor, ...override }, options, recordingReaders());
    assert.equal(workspace.teamView, expected, JSON.stringify(override));
  }
});

test("«Срок» bounds the case read by the Bishkek day; the staff read and «Без срока» stay unbounded", async () => {
  const reader = { ...actor, permissionKeys: ["staff.task.read", "task.manage"] };
  const caseArgs = async (patch) => {
    const recorded = recordingReaders();
    await readStaffTaskWorkspace(reader, { ...options, ...patch }, recorded);
    return {
      cases: recorded.calls.filter(({ name }) => name === "listPlatformAdmissionsTaskQueue").map(({ args }) => args[1]),
      staff: recorded.calls.filter(({ name }) => name === "listStaffTasks").map(({ args }) => args[1]),
    };
  };
  // Thursday 24.09.2026: past and closed case tasks no longer fill the limit before today's.
  const today = await caseArgs({ due: "today" });
  assert.deepEqual(today.cases, [{ pageSize: 100, cursor: null, dueFrom: "2026-09-24", dueTo: "2026-09-24" }]);
  assert.deepEqual(today.staff, [{ view: "mine", status: "active", cursor: null }], "the staff list has no day bounds");
  assert.deepEqual((await caseArgs({ due: "overdue" })).cases, [{ pageSize: 100, cursor: null, dueTo: "2026-09-24" }]);
  assert.deepEqual((await caseArgs({ due: "tomorrow" })).cases, [{ pageSize: 100, cursor: null, dueFrom: "2026-09-25", dueTo: "2026-09-25" }]);
  assert.deepEqual((await caseArgs({ due: "week" })).cases, [{ pageSize: 100, cursor: null, dueFrom: "2026-09-24", dueTo: "2026-09-27" }]);
  assert.deepEqual((await caseArgs({ due: "later" })).cases, [{ pageSize: 100, cursor: null, dueFrom: "2026-09-28" }]);
  assert.deepEqual((await caseArgs({ due: "none" })).cases, [{ pageSize: 100, cursor: null }]);
  assert.deepEqual((await caseArgs({ due: null })).cases, [{ pageSize: 100, cursor: null }]);
  // Closed tasks have no due filter, whatever the options say.
  assert.deepEqual((await caseArgs({ state: "done", due: "today" })).cases, [{ pageSize: 100, cursor: null }]);
  // The bounds travel with every page of the same read.
  const caseCursor = { sortAt: "2026-09-24T04:00:00Z", caseTaskId: "65000000-0000-4000-8000-000000000013" };
  const paged = sequenceReaders({ listPlatformAdmissionsTaskQueue: [caseQueuePage([{ caseTaskId: "c1" }], caseCursor), caseQueuePage([{ caseTaskId: "c2" }], null)] });
  const workspace = await readStaffTaskWorkspace(reader, { ...options, type: "case", due: "today" }, paged);
  assert.deepEqual(paged.calls.map(({ args }) => args[1]), [
    { pageSize: 100, cursor: null, dueFrom: "2026-09-24", dueTo: "2026-09-24" },
    { pageSize: 100, cursor: caseCursor, dueFrom: "2026-09-24", dueTo: "2026-09-24" },
  ]);
  assert.deepEqual(workspace.queue, { staff: [], cases: [{ caseTaskId: "c1" }, { caseTaskId: "c2" }], complete: true, cutOff: [] });
});

test("only the read that hit its limit is reported as cut off", async () => {
  const reader = { ...actor, permissionKeys: ["staff.task.read", "task.manage"] };
  const caseCursor = { sortAt: "2026-09-24T04:00:00Z", caseTaskId: "65000000-0000-4000-8000-000000000014" };
  const recorded = sequenceReaders({ listPlatformAdmissionsTaskQueue: [caseQueuePage([{ caseTaskId: "c" }], caseCursor)] });
  const workspace = await readStaffTaskWorkspace(reader, options, recorded);
  assert.equal(workspace.queue.complete, false);
  assert.deepEqual(workspace.queue.cutOff, ["case"]);
});

test("the tasks page sends «Срок» and today's Bishkek day to the read and passes the cut-off to the screen", () => {
  const page = readFileSync(new URL("../src/app/(v3)/v3/tasks/page.tsx", import.meta.url), "utf8");
  assert.match(page, /type: filters\.type, due: filters\.due, today: day, window: filters\.window,/u);
  assert.match(page, /const day = dayInOrganizationTimezone\(now\);/u);
  assert.match(page, /cutOff=\{workspace\.queue\.cutOff\}/u);
});
