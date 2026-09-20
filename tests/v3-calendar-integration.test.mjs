import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  dayDelta,
  taskDeadlineInputDefaults,
  calendarCapabilitiesForTask,
  calendarUndatedContinuationHref,
} from "../src/components/v3/calendar/types.ts";

import { comparePersonalCalendarCursor, parsePersonalCalendarCursor, parsePersonalCalendarPage, PersonalCalendarReadError } from "../src/lib/v3/personal-calendar-contract.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = source("src/app/(v3)/v3/calendar/page.tsx");
const calendar = source("src/components/v3/calendar/Calendar.tsx");
const controls = source("src/components/v3/calendar/TaskControls.tsx");
const grids = source("src/components/v3/calendar/grids.tsx");
const types = source("src/components/v3/calendar/types.ts");
const adapter = source("src/lib/v3/calendar-source.ts");
const personal = source("src/lib/v3/personal-calendar-contract.ts");

test("deadline-kind conversion preserves the task day instead of the period anchor", () => {
  assert.deepEqual(
    taskDeadlineInputDefaults(
      { day: "2026-09-04", minutes: 9 * 60 + 30 },
      "2026-09-01",
    ),
    { dueOn: "2026-09-04", dueAt: "2026-09-04T09:30" },
  );
  assert.deepEqual(
    taskDeadlineInputDefaults(
      { day: "2026-09-04", minutes: null },
      "2026-09-01",
    ),
    { dueOn: "2026-09-04", dueAt: "2026-09-04T09:00" },
  );
  assert.deepEqual(
    taskDeadlineInputDefaults(
      { day: null, minutes: null },
      "2026-09-01",
    ),
    { dueOn: "2026-09-01", dueAt: "2026-09-01T09:00" },
  );
  assert.match(controls, /taskDeadlineInputDefaults\(task, day\)/);
  assert.match(controls, /useState\(defaults\.dueOn\)/);
  assert.match(controls, /value=\{dueOn\}/);
  assert.match(controls, /value=\{displayDueAt\}/);
});

test("deadline day deltas stay date-only across month and year boundaries", () => {
  assert.equal(dayDelta("2026-09-07", "2026-09-07"), 0);
  assert.equal(dayDelta("2026-09-07", "2026-09-10"), 3);
  assert.equal(dayDelta("2027-01-01", "2026-12-30"), -2);
});

test("V3 calendar exhausts selected ranges and bounds undated history", () => {
  assert.match(page, /requireV3PageActor\("\/v3\/calendar"\)/);
  assert.match(page, /readCalendarWorkspace/);
  assert.match(adapter, /readPersonalCalendarPage/);
  assert.match(adapter, /listPlatformStudentCases/);
  assert.match(adapter, /getPlatformAdmissionsTaskTarget/);
  assert.match(adapter, /const QUEUE_PAGE_SIZE = 100/);
  assert.match(adapter, /const CASE_PAGE_SIZE = 100/);
  assert.match(adapter, /mode: "dated", from, to/u);
  assert.match(adapter, /while \(datedCursor !== null\)/u);
  assert.doesNotMatch(adapter, /while \(undatedCursor !== null\)/u);
  assert.match(adapter, /undatedNextCursor: undated\.nextCursor/u);
  assert.doesNotMatch(adapter, /truncatedAfter|periodComplete/u);
  assert.match(adapter, /hasNext: page\.hasNext/);
  assert.match(adapter, /casesHaveMore:\s*cases\?\.hasNext/);
  assert.match(page, /casesHaveMore=\{workspace\.casesHaveMore\}/);
  assert.match(page, /undatedNextHref=\{workspace\.undatedNextCursor/u);
  assert.match(page, /undatedContinuationPage=\{workspace\.access\.tasks && undatedCursor !== null\}/u);
  assert.match(controls, /TaskCasePicker/);
  assert.match(source("src/components/v3/tasks/TaskCasePicker.tsx"), /searchTaskCasesAction/);
  assert.match(source("src/lib/v3/task-case-actions.ts"), /cursor/);
  assert.equal(
    [...adapter.matchAll(/await getPlatformAdmissionsTaskTarget\(/g)].length,
    1,
    "only the exact edit target is read on the server; creation resolves its own case",
  );
  assert.equal([...adapter.matchAll(/await listPlatformStudentCases\(/g)].length, 1);
  assert.match(adapter, /assignees: target\?\.assignees \?\? \[\]/);
  assert.doesNotMatch(
    adapter,
    /better-sqlite3|drizzle|@\/lib\/server\/database|\bevo_[a-z0-9_]+\b/i,
  );
  assert.doesNotMatch(adapter, /PlatformAdmissionsCursor|for \(;;\)|TASK_STATE/);
});

test("personal calendar gates each permitted task branch and keeps creation separate", () => {
  assert.match(adapter, /const access = personalCalendarAccess\(actor\)/);
  assert.match(adapter, /access\.tasks \? readCalendarTasks\(actor, from, to, undatedCursor\) : null/);
  assert.match(adapter, /staffPresentationCan\(actor, "admissions\.read"\) \? readActiveCases/);
  assert.doesNotMatch(adapter, /readCalendarApplicationDeadlines|readNearestCalendarApplicationDeadline/);
  assert.match(page, /readAccess=\{workspace\.access\}/);
  assert.doesNotMatch(calendar, /NearestApplicationDeadline|readAccess\.applicationDeadlines/);
  assert.match(calendar, /calendarAccessNotice\(readAccess\)/);
  assert.match(calendar, /calendarEmptyPeriodLabel\(readAccess\)/);
  assert.match(calendar, /<CalendarCreateTaskForm/);
  assert.match(controls, /isStaffPreview\(actor\) \|\| !staffHasPermission\(actor, "task\.create"\)/);
  assert.match(adapter, /task\.key !== target\.task\.key/);
});

test("case task candidates follow exact selection and block submission until checked", () => {
  const picker = source("src/components/v3/tasks/TaskCasePicker.tsx");
  const action = source("src/lib/v3/task-case-actions.ts");
  assert.match(picker, /onCaseChange\?\.\(nextCaseId\)/);
  assert.match(picker, /onCaseChange\?\.\(event\.target\.value\)/);
  assert.match(action, /getPlatformAdmissionsTaskWorkspace\(actor, caseId\)/);
  assert.match(action, /status: "unavailable"/);
  assert.match(controls, /candidateState\.caseId === activeCaseId/);
  assert.match(controls, /if \(!cancelled\) setCandidateState/);
  assert.match(controls, /locked \|\| !candidateReady \|\| !eligibleAssignee/);
  assert.match(controls, /staffHasPermission\(actor, "task\.create"\)/);
});

test("V3 calendar create, change, complete and cancel use versioned server actions", () => {
  assert.match(controls, /useActionState\(\s*createPlatformAdmissionsTaskAction/);
  assert.match(controls, /useActionState\(\s*changePlatformAdmissionsTaskAction/);
  for (const field of [
    "student_case_id",
    "task_type",
    "title",
    "assignee_membership_id",
    "priority",
    "deadline_kind",
    "due_on",
    "due_at",
    "status",
    "student_visible",
    "expected_version",
    "request_id",
  ]) {
    assert.match(controls, new RegExp(`name="${field}"`));
  }
  assert.equal(
    [...controls.matchAll(/name="case_task_id"/g)].length,
    2,
    "only forms changing an existing task identify a task",
  );
  assert.match(controls, /name="expected_version" value="0"/);
  assert.doesNotMatch(controls, /state\.caseTaskId \?\? caseTaskId/);
  assert.match(controls, /name="expected_version" value=\{task\.version\}/);
  assert.match(controls, /status="done"/);
  assert.match(controls, /status="cancelled"/);
  assert.match(controls, /taskStatus\(status\)/);
  assert.match(controls, /data-testid="v3-calendar-task-change-form"/);
  assert.match(controls, /data-testid=\{`v3-calendar-task-\$\{status\}-form`\}/);
  assert.match(controls, /<select name="priority"/);
  assert.match(controls, /<select name="student_visible"/);
  assert.match(controls, /<select[\s\S]*name="deadline_kind"/);
  assert.match(controls, /<option value="none">Без срока<\/option>/);
  assert.match(controls, /<option value="all_day">Весь день<\/option>/);
  assert.match(controls, /<option value="timed">Точное время<\/option>/);
  assert.match(types, /version: string/);
  assert.match(types, /change: string/);
  assert.match(types, /complete: string/);
  assert.match(types, /cancel: string/);
  assert.ok([...page.matchAll(/randomUUID\(\)/g)].length >= 4);
  assert.doesNotMatch(controls, /return_to_case/);
  assert.match(controls, /name="reason" value=\{reason\}/);
});

test("calendar targets enforce personal scope while shared Tasks retains its reader", () => {
  assert.match(page, /kind === "case" && !caseId/);
  assert.match(page, /kind === "staff" && caseParam !== undefined/);
  assert.match(page, /await readPersonalCalendarTaskTarget\(actor, caseId, taskId, kind\)/);
  assert.match(page, /initialTaskKey=\{target\?\.task\.key \?\? null\}/);
  assert.match(adapter, /getPlatformAdmissionsTaskTarget\(actor, studentCaseId, taskId\)/);
  const sharedTarget = adapter.slice(adapter.indexOf("export async function readCalendarTaskTarget"), adapter.indexOf("export type CalendarTaskTarget"));
  assert.doesNotMatch(sharedTarget, /readPersonalCalendarTarget|catch|return null/);
  assert.match(source("src/app/(v3)/v3/tasks/page.tsx"), /readCalendarTaskTarget/);
  assert.match(page, /taskCapabilities=\{target\?\.capabilities \?\? null\}/);
  assert.match(adapter, /task\.key !== target\.task\.key/);
  assert.match(calendar, /tasks\.find\(\(task\) => task\.key === initialTaskKey\)/);
  assert.match(calendar, /params\.set\("case", target\.studentCaseId\)/);
  assert.match(calendar, /params\.set\("kind", "staff"\)/);
  assert.match(calendar, /params\.set\("task", target\.id\)/);
});

test("selected task controls and case navigation use only matching scoped target capabilities", () => {
  const task = { id: "task-a", studentCaseId: "case-a" };
  const permissions = { taskId: "task-a", studentCaseId: "case-a", canAssign: false, canChangeVisibility: false, canReadCase: false };
  assert.equal(calendarCapabilitiesForTask(task, permissions), permissions);
  for (const invalid of [null, { ...permissions, taskId: "task-b" }, { ...permissions, studentCaseId: "case-b" }])
    assert.equal(calendarCapabilitiesForTask(task, invalid), null);
  const changeForm = controls.slice(controls.indexOf("function CalendarChangeTaskForm"), controls.indexOf("export function CalendarTaskControls"));
  assert.match(changeForm, /!isStaffPreview\(actor\) && capabilities\.canAssign/);
  assert.match(changeForm, /!isStaffPreview\(actor\) && capabilities\.canChangeVisibility/);
  assert.doesNotMatch(changeForm, /staffHasPermission\(actor, "task\.(assign|visibility\.manage)"\)/);
  assert.match(calendar, /openCapabilities\?\.canReadCase \? <Link/);
  assert.match(calendar, /openCapabilities && taskRequestIds\[open\.key\]/);
  assert.match(calendar, /staffPresentationCan\(actor, "admissions\.read"\) \? <CalendarCreateTaskForm/);
});

test("V3 calendar resolves the page actor before reading Admissions data", () => {
  assert.match(
    page,
    /requireV3PageActor\("\/v3\/calendar"\)[\s\S]*readCalendarWorkspace/,
  );
  assert.doesNotMatch(
    page,
    /throw new Error\("Admissions calendar resolved a non-Admissions staff role\."\)/,
  );
});

test("V3 calendar writes use live permission hints and remain keyboard-operable", () => {
  assert.match(
    calendar,
    /!isStaffPreview\(actor\) && staffHasPermission\(actor, "task\.manage"\)/,
  );
  assert.match(calendar, /CalendarTaskControls/);
  assert.match(controls, /isStaffPreview\(actor\) \|\| !staffHasPermission\(actor, "task\.create"\)/);
  assert.match(controls, /assignee\.membershipId === actorMembershipId/);
  assert.doesNotMatch(adapter, /assignee\.role !== "sales"/);
  assert.match(controls, /staffHasPermission\(actor, "task\.assign"\)/);
  assert.match(controls, /staffHasPermission\(actor, "task\.visibility\.manage"\)/);
  assert.match(controls, /state\.status === "saved" \|\| state\.status === "stale"/);
  assert.match(grids, /<button[\s\S]*id=\{`task-\$\{task\.key\}`\}/);
  assert.doesNotMatch(calendar, /\bADDED\b|\bHIDDEN\b|local-/);
  assert.match(calendar, /\/v3\/profile\?case=/);
});

test("V3 calendar preserves canonical task states and undated tasks", () => {
  assert.match(personal, /projectPlatformTaskDeadline\(dueOn, dueAt, now\)/);
  assert.match(personal, /parsed\.task\.day < options\.from \|\| parsed\.task\.day > options\.to/u);
  assert.match(adapter, /state: row\.status/);
  assert.match(adapter, /version: row\.version/);
  assert.match(calendar, /tasks\.filter\(\(task\) => task\.day === null\)/);
  assert.match(grids, /task\.day === null[\s\S]*?"без срока"/);
  assert.match(grids, /blocked: "warn"/);
  assert.match(grids, /done: "ok"/);
  assert.match(grids, /task\.state === "in_progress"/);
});

test("V3 calendar keeps exactly one active task-control component", () => {
  assert.equal(
    existsSync(
      new URL(
        "../src/components/v3/calendar/TaskActions.tsx",
        import.meta.url,
      ),
    ),
    false,
  );
  assert.match(calendar, /\.\/TaskControls/);
});

test("V3 stale task edits retain their draft and explicitly rebase before retry", () => {
  assert.match(calendar, /key=\{open\.id\}/);
  assert.doesNotMatch(calendar, /key=\{`\$\{open\.id\}:\$\{open\.version\}`\}/);
  assert.match(page, /key=\{target \? target\.task\.key : `\$\{view\}:\$\{day\}`\}/);
  assert.match(calendar, /params\.set\("case", target\.studentCaseId\)/);
  assert.match(calendar, /params\.set\("task", target\.id\)/);
  assert.match(controls, /const \[expectedVersion, setExpectedVersion\] = useState\(task\.version\)/);
  assert.match(controls, /name="expected_version" value=\{expectedVersion\}/);
  assert.match(controls, /state\.status === "stale" && !staleAcknowledged/);
  assert.match(controls, /disabled=\{task\.version === expectedVersion\}/);
  assert.match(controls, /setExpectedVersion\(task\.version\); setStaleAcknowledged\(true\)/);
  assert.match(controls, /Ваши поля сохранены в форме/);
});

// Parser/order inputs only; these tests do not represent database task records.
const taskId = "12400000-0000-4000-8000-000000000101";
const sentinel = "9999-12-31T00:00:00+00:00";

test("personal calendar cursors reject incomplete or mixed-domain input", () => {
  for (const args of [
    [sentinel, undefined, taskId], [sentinel, "other", taskId], [sentinel, "staff", undefined],
    ["not-a-date", "case", taskId], [sentinel, "case", "invalid-id"],
  ]) assert.equal(parsePersonalCalendarCursor(...args), null);
  assert.equal(parsePersonalCalendarCursor("2026-09-21T00:00:00Z", "case", taskId, true), null);
  assert.equal(parsePersonalCalendarCursor("9999-12-31T00:00:00.000001Z", "case", taskId, true), null);
});

test("calendar ordering preserves microseconds and canonical offset equivalence", () => {
  const first = { sortAt: "2026-09-21T00:00:00.000001Z", kind: "case", taskId };
  const second = { ...first, sortAt: "2026-09-21T00:00:00.000002Z" };
  assert.equal(comparePersonalCalendarCursor(first, second), -1);
  assert.equal(comparePersonalCalendarCursor(second, first), 1);
  assert.equal(comparePersonalCalendarCursor(first, { ...first, sortAt: "2026-09-21T06:00:00.000001+06:00" }), 0);
});

test("equal UUIDs in separate task domains have distinct stable cursor positions", () => {
  const first = { sortAt: sentinel, kind: "case", taskId };
  const second = { ...first, kind: "staff" };
  assert.equal(comparePersonalCalendarCursor(first, second), -1);
  assert.equal(comparePersonalCalendarCursor(second, first), 1);
});

test("mixed-domain continuation round trips its full tuple and keeps period", () => {
  for (const kind of ["case", "staff"]) {
    const cursor = { sortAt: sentinel, kind, taskId };
    const url = new URL(calendarUndatedContinuationHref("/v3/calendar", "week", "2026-09-21", cursor), "http://localhost");
    assert.equal(url.searchParams.get("view"), "week");
    assert.equal(url.searchParams.get("date"), "2026-09-21");
    assert.deepEqual(parsePersonalCalendarCursor(url.searchParams.get("undated_after_sort_at"), url.searchParams.get("undated_after_kind"), url.searchParams.get("undated_after_task_id"), true), cursor);
    assert.equal(url.searchParams.has("undated_after_case_task_id"), false);
  }
});

test("legacy case-only continuation remains readable without guessing a staff domain", () => {
  const url = new URL(calendarUndatedContinuationHref("/v3/calendar", "month", "2026-09-21", { sortAt: sentinel, caseTaskId: taskId }), "http://localhost");
  assert.deepEqual(parsePersonalCalendarCursor(url.searchParams.get("undated_after_sort_at"), "case", url.searchParams.get("undated_after_case_task_id"), true), { sortAt: sentinel, kind: "case", taskId });
});

test("page envelope cannot claim invalid totals or continuation without a row", () => {
  for (const value of [
    { rows: [], total_count: -1, next_cursor: null },
    { rows: [], total_count: Number.MAX_SAFE_INTEGER + 1, next_cursor: null },
    { rows: [], total_count: 1, next_cursor: { sort_at: sentinel, kind: "case", task_id: taskId } },
    { rows: [], total_count: 0, next_cursor: null, hidden_extra: true },
  ]) assert.throws(() => parsePersonalCalendarPage(value, {}, { mode: "undated" }), PersonalCalendarReadError);
});
