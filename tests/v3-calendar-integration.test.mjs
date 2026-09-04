import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { taskDeadlineInputDefaults } from "../src/components/v3/calendar/types.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = source("src/app/(v3)/v3/calendar/page.tsx");
const calendar = source("src/components/v3/calendar/Calendar.tsx");
const controls = source("src/components/v3/calendar/TaskControls.tsx");
const grids = source("src/components/v3/calendar/grids.tsx");
const types = source("src/components/v3/calendar/types.ts");
const adapter = source("src/lib/v3/calendar-source.ts");

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
  assert.match(controls, /defaultValue=\{defaults\.dueOn\}/);
  assert.match(controls, /defaultValue=\{defaults\.dueAt\}/);
});

test("V3 calendar reads one bounded canonical workspace without a second data path", () => {
  assert.match(page, /requirePlatformAdmissionsActor/);
  assert.match(page, /readCalendarWorkspace/);
  assert.match(adapter, /listPlatformAdmissionsTaskQueue/);
  assert.match(adapter, /listPlatformStudentCases/);
  assert.match(adapter, /getPlatformAdmissionsTaskWorkspace/);
  assert.match(adapter, /const QUEUE_PAGE_SIZE = 100/);
  assert.match(adapter, /const CASE_PAGE_SIZE = 100/);
  assert.match(adapter, /if \(queue\.hasNext\)[\s\S]*throw new Error/);
  assert.match(adapter, /hasNext: page\.hasNext/);
  assert.match(adapter, /casesHaveMore:\s*cases\.hasNext/);
  assert.match(page, /casesHaveMore=\{workspace\.casesHaveMore\}/);
  assert.match(controls, /Показаны первые 100 активных Student 360/);
  assert.equal(
    [...adapter.matchAll(/await getPlatformAdmissionsTaskWorkspace\(/g)].length,
    1,
  );
  assert.equal([...adapter.matchAll(/await listPlatformStudentCases\(/g)].length, 1);
  assert.doesNotMatch(
    adapter,
    /better-sqlite3|drizzle|@\/lib\/server\/database|\bevo_[a-z0-9_]+\b/i,
  );
  assert.doesNotMatch(adapter, /PlatformAdmissionsCursor|for \(;;\)|TASK_STATE/);
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
  assert.doesNotMatch(controls, /return_to_case|name="reason"/);
});

test("V3 calendar denies a Sales preview before reading Admissions data", () => {
  assert.match(
    page,
    /actor\.presentationRole !== "admin"[\s\S]*actor\.presentationRole !== "admissions"[\s\S]*redirect\("\/access-denied\?from=%2Fv3%2Fcalendar"\)[\s\S]*readCalendarWorkspace/,
  );
  assert.doesNotMatch(
    page,
    /throw new Error\("Admissions calendar resolved a non-Admissions staff role\."\)/,
  );
});

test("V3 calendar writes are role-scoped and remain keyboard-operable", () => {
  assert.match(
    calendar,
    /presentationRole === "admin"[\s\S]*presentationRole === "admissions"/,
  );
  assert.match(calendar, /open\.assigneeMembershipId === actorMembershipId/);
  assert.match(calendar, /CalendarTaskControls/);
  assert.match(controls, /presentationRole !== "admin" && presentationRole !== "admissions"/);
  assert.match(controls, /assignee\.membershipId === actorMembershipId/);
  assert.match(adapter, /filter\(\(assignee\) => assignee\.role !== "sales"\)/);
  assert.match(controls, /state\.status === "saved" \|\| state\.status === "stale"/);
  assert.match(grids, /<button[\s\S]*id=\{`task-\$\{task\.id\}`\}/);
  assert.doesNotMatch(calendar, /\bADDED\b|\bHIDDEN\b|local-/);
  assert.match(calendar, /\/v3\/profile\?case=/);
});

test("V3 calendar preserves canonical task states and undated tasks", () => {
  assert.match(adapter, /projectPlatformTaskDeadline\(row\.dueOn, row\.dueAt, now\)/);
  assert.match(adapter, /day !== null && \(day < from \|\| day > to\)/);
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
