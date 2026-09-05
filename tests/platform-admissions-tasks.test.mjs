import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { fixedRoleCanAccessRoute } from "../src/lib/fixed-role-policy.ts";
import {
  parsePlatformCaseTaskDeadline,
  platformCaseTaskDeadlineMatchesRow,
} from "../src/lib/platform-admissions-task-contract.ts";
import { isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";
import {
  platformTaskDeadlineSortTime,
  projectPlatformTaskDeadline,
} from "../src/lib/platform-task-deadline.ts";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const actionSource = read("src/lib/platform-admissions-task-actions.ts");
const repositorySource = read("src/lib/platform-admissions-workspace.ts");
const taskContractSource = read("src/lib/platform-admissions-task-contract.ts");
const calendarSource = read("src/components/v3/calendar/Calendar.tsx");
const controlsSource = read("src/components/v3/calendar/TaskControls.tsx");
const adapterSource = read("src/lib/v3/calendar-source.ts");

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
    "deadline_kind",
    "due_on",
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
  assert.match(actionSource, /p_due_on:\s*deadline\.dueOn/);
  assert.match(actionSource, /p_due_at:\s*deadline\.dueAt/);
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

test("task deadline form contract enforces exactly one canonical deadline", () => {
  assert.deepEqual(parsePlatformCaseTaskDeadline("none", "", ""), {
    kind: "none",
    dueOn: null,
    dueAt: null,
  });
  assert.deepEqual(parsePlatformCaseTaskDeadline("all_day", "2026-09-04", ""), {
    kind: "all_day",
    dueOn: "2026-09-04",
    dueAt: null,
  });
  assert.deepEqual(
    parsePlatformCaseTaskDeadline("timed", "", "2026-09-04T09:30"),
    { kind: "timed", dueOn: null, dueAt: "2026-09-04T03:30:00.000Z" },
  );
  assert.deepEqual(
    parsePlatformCaseTaskDeadline(
      "timed",
      "",
      "2026-09-04T09:30:45.123456+06:00",
    ),
    {
      kind: "timed",
      dueOn: null,
      dueAt: "2026-09-04T09:30:45.123456+06:00",
    },
  );
  assert.equal(
    parsePlatformCaseTaskDeadline("all_day", "2026-09-04", "2026-09-04T09:30"),
    null,
  );
  assert.equal(parsePlatformCaseTaskDeadline("all_day", "2026-02-30", ""), null);
  assert.equal(parsePlatformCaseTaskDeadline("none", "2026-09-04", ""), null);

  const timed = parsePlatformCaseTaskDeadline("timed", "", "2026-09-04T09:30");
  assert.ok(timed);
  assert.equal(
    platformCaseTaskDeadlineMatchesRow(null, "2026-09-04T03:30:00Z", timed),
    true,
  );
  assert.equal(
    platformCaseTaskDeadlineMatchesRow("2026-09-04", "2026-09-04T03:30:00Z", timed),
    false,
  );
});

test("calendar placement keeps all-day, timed and unscheduled distinct", () => {
  assert.deepEqual(
    projectPlatformTaskDeadline("2026-09-04", null, new Date("2026-09-04T12:00:00Z")),
    { day: "2026-09-04", minutes: null, overdue: false },
  );
  assert.deepEqual(
    projectPlatformTaskDeadline("2026-09-04", null, new Date("2026-09-04T18:00:00Z")),
    { day: "2026-09-04", minutes: null, overdue: true },
  );
  assert.deepEqual(
    projectPlatformTaskDeadline(null, "2026-09-03T18:15:00Z", new Date("2026-09-03T18:16:00Z")),
    { day: "2026-09-04", minutes: 15, overdue: true },
  );
  assert.deepEqual(
    projectPlatformTaskDeadline(null, null, new Date("2026-09-04T12:00:00Z")),
    { day: null, minutes: null, overdue: false },
  );
  assert.equal(
    platformTaskDeadlineSortTime("2026-09-04", null),
    Date.parse("2026-09-03T18:00:00Z"),
  );
  assert.equal(
    platformTaskDeadlineSortTime(null, "2026-09-03T18:15:00Z"),
    Date.parse("2026-09-03T18:15:00Z"),
  );
  assert.equal(
    platformTaskDeadlineSortTime(null, null),
    Date.parse("9999-12-31T00:00:00Z"),
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
  assert.match(
    controlsSource,
    /task\?\.dueAt \?\? defaults\.dueAt/,
    "unchanged timed edits must submit the exact canonical timestamp",
  );
  assert.match(
    controlsSource,
    /value=\{displayDueAt\}[\s\S]*?data-testid="v3-calendar-timed-deadline-input"[\s\S]*?setDisplayDueAt\(event\.target\.value\)[\s\S]*?setSubmittedDueAt\(event\.target\.value\)[\s\S]*?name="due_at" value=\{submittedDueAt\}/,
    "only an explicit deadline edit may replace the canonical timestamp",
  );
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
  assert.match(repositorySource, /dueOn:\s*task\.dueOn/);
  assert.match(repositorySource, /if \(dueOn !== null && dueAt !== null\) return invalidShape\(\)/);
  assert.match(repositorySource, /platformTaskDeadlineSortTime\(task\.dueOn, task\.dueAt\)/);
  assert.doesNotMatch(repositorySource, /Date\.parse\(sortAt\) !== Date\.parse\(task\.updatedAt\)/);
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

test("Admissions and Admin can open the V3 calendar while Sales fails closed", () => {
  assert.equal(isConnectedPlatformPage("/v3/calendar"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/calendar"), true);
  assert.equal(fixedRoleCanAccessRoute("admin", "/v3/calendar"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/calendar"), false);
});
