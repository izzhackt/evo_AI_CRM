import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertCalendarDatedTaskPageOrder,
  CalendarContractError,
  listCalendarApplicationDeadlinePage,
  listCalendarUndatedTaskPage,
  normalizeCalendarApplicationDeadlineRow,
  parseCalendarUndatedTaskCursor,
  readNearestCalendarApplicationDeadline,
} from "../src/lib/v3/calendar-contract.ts";
import {
  calendarUndatedContinuationHref,
  hasCalendarAllDayRow,
} from "../src/components/v3/calendar/types.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ORGANIZATION_ID = "12400000-0000-4000-8000-000000000001";
const TASK_ID = "12400000-0000-4000-8000-000000000101";
const TASK_ID_2 = "12400000-0000-4000-8000-000000000102";
const CASE_ID = "12400000-0000-4000-8000-000000000201";
const APPLICATION_ID = "12400000-0000-4000-8000-000000000301";
const APPLICATION_ID_2 = "12400000-0000-4000-8000-000000000302";
const SENTINEL = "9999-12-31T00:00:00+00:00";

const actor = Object.freeze({
  authUserId: "12400000-0000-4000-8000-000000000011",
  profileId: "12400000-0000-4000-8000-000000000021",
  membershipId: "12400000-0000-4000-8000-000000000031",
  organizationId: ORGANIZATION_ID,
  displayName: "D2 Admissions",
  email: "d2@example.invalid",
  platformRole: "admissions",
  authorityRole: "admissions",
  platformAccessVersion: 1,
  platformBundleId: "12400000-0000-4000-8000-000000000041",
  platformBundleVersion: 1,
});

function undatedRow(id) {
  return {
    sort_at: SENTINEL,
    organization_id: ORGANIZATION_ID,
    case_task_id: id,
    version: "1",
    student_case_id: CASE_ID,
    student_display_name: "Алия Садыкова",
    case_state: "active",
    task_type: "follow_up",
    title: "Связаться со студентом",
    status: "open",
    priority: "normal",
    due_at: null,
    due_on: null,
    student_visible: false,
    assignee_membership_id: actor.membershipId,
    assignee_display_name: actor.displayName,
    created_at: "2026-09-07T08:00:00+00:00",
    updated_at: "2026-09-07T08:00:00+00:00",
  };
}

function taskIdAt(index) {
  return `12400000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function applicationRow(id = APPLICATION_ID, deadline = "2026-09-10") {
  return {
    application_id: id,
    student_case_id: CASE_ID,
    student_display_name: "Алия Садыкова",
    university_name: "University of Example",
    program_name: "Computer Science",
    application_status: "preparation",
    deadline,
  };
}

function rpcClient(resolver) {
  return {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(name, args, options) {
          assert.deepEqual(options, { get: true });
          return resolver(name, args);
        },
      };
    },
  };
}

test("D2 undated projection is bounded and advances the canonical sentinel cursor", async () => {
  let call;
  const page = await listCalendarUndatedTaskPage(
    actor,
    { pageSize: 1 },
    {
      client: rpcClient((name, args) => {
        call = { name, args };
        return { data: [undatedRow(TASK_ID), undatedRow(TASK_ID_2)], error: null };
      }),
    },
  );

  assert.deepEqual(call, {
    name: "staff_case_task_undated_page",
    args: { p_limit: 2 },
  });
  assert.deepEqual(page.rows.map((row) => row.caseTaskId), [TASK_ID]);
  assert.deepEqual(page.nextCursor, { sortAt: SENTINEL, caseTaskId: TASK_ID });
  assert.deepEqual(parseCalendarUndatedTaskCursor(SENTINEL, TASK_ID), {
    sortAt: SENTINEL,
    caseTaskId: TASK_ID,
  });
  assert.equal(
    parseCalendarUndatedTaskCursor("2026-09-07T08:00:00+00:00", TASK_ID),
    null,
  );
});

test("D2 default undated page is hard capped at 100 rows with continuation", async () => {
  let call;
  const page = await listCalendarUndatedTaskPage(
    actor,
    {},
    {
      client: rpcClient((name, args) => {
        call = { name, args };
        return {
          data: Array.from({ length: 101 }, (_, index) => undatedRow(taskIdAt(index + 1))),
          error: null,
        };
      }),
    },
  );

  assert.deepEqual(call, {
    name: "staff_case_task_undated_page",
    args: { p_limit: 101 },
  });
  assert.equal(page.rows.length, 100);
  assert.deepEqual(page.nextCursor, {
    sortAt: SENTINEL,
    caseTaskId: taskIdAt(100),
  });
});

test("D2 deadline projection sends range and (deadline, application_id) cursor", async () => {
  let call;
  const page = await listCalendarApplicationDeadlinePage(
    actor,
    {
      pageSize: 1,
      from: "2026-09-01",
      to: "2026-09-30",
      cursor: { deadline: "2026-09-09", applicationId: APPLICATION_ID },
    },
    {
      client: rpcClient((name, args) => {
        call = { name, args };
        return {
          data: [
            applicationRow(APPLICATION_ID, "2026-09-10"),
            applicationRow(APPLICATION_ID_2, "2026-09-11"),
          ],
          error: null,
        };
      }),
    },
  );

  assert.deepEqual(call, {
    name: "staff_application_deadline_page",
    args: {
      p_limit: 2,
      p_due_from: "2026-09-01",
      p_due_to: "2026-09-30",
      p_after_deadline: "2026-09-09",
      p_after_application_id: APPLICATION_ID,
    },
  });
  assert.deepEqual(page.rows.map((row) => row.applicationId), [APPLICATION_ID]);
  assert.deepEqual(page.nextCursor, {
    deadline: "2026-09-10",
    applicationId: APPLICATION_ID,
  });
});

test("D2 application row is an exact discriminated read contract", () => {
  assert.deepEqual(normalizeCalendarApplicationDeadlineRow(applicationRow()), {
    applicationId: APPLICATION_ID,
    studentCaseId: CASE_ID,
    studentDisplayName: "Алия Садыкова",
    universityName: "University of Example",
    programName: "Computer Science",
    status: "preparation",
    deadline: "2026-09-10",
  });
  assert.throws(
    () => normalizeCalendarApplicationDeadlineRow({ ...applicationRow(), inferred: true }),
    CalendarContractError,
  );
  assert.throws(
    () => normalizeCalendarApplicationDeadlineRow({ ...applicationRow(), deadline: null }),
    CalendarContractError,
  );
});

test("D2 dated page ordering fails closed across rows and the supplied cursor", () => {
  const first = { sortAt: "2026-09-10T03:00:00+00:00", caseTaskId: TASK_ID };
  const second = { sortAt: "2026-09-10T03:00:00Z", caseTaskId: TASK_ID_2 };

  assert.doesNotThrow(() => assertCalendarDatedTaskPageOrder([first, second], null));
  assert.throws(
    () => assertCalendarDatedTaskPageOrder([second, first], null),
    CalendarContractError,
  );
  assert.throws(
    () => assertCalendarDatedTaskPageOrder(
      [first],
      { sortAt: second.sortAt, caseTaskId: second.caseTaskId },
    ),
    CalendarContractError,
  );
});

test("D2 global nearest deadline is a separate one-row projection", async () => {
  let call;
  const deadline = await readNearestCalendarApplicationDeadline(actor, {
    client: rpcClient((name, args) => {
      call = { name, args };
      return { data: [applicationRow()], error: null };
    }),
  });
  assert.deepEqual(call, { name: "staff_nearest_application_deadline", args: {} });
  assert.equal(deadline?.applicationId, APPLICATION_ID);
});

test("D2 calendar exhausts bounded ranges but reads only one undated page", () => {
  const adapter = source("src/lib/v3/calendar-source.ts");
  assert.match(adapter, /dueFrom: from,[\s\S]*dueTo: to/u);
  assert.match(adapter, /do \{[\s\S]*listPlatformAdmissionsTaskQueue[\s\S]*\} while \(datedCursor !== null\)/u);
  assert.match(adapter, /const undatedPage = await listCalendarUndatedTaskPage/u);
  assert.doesNotMatch(adapter, /while \(undatedCursor !== null\)/u);
  assert.match(adapter, /undatedNextCursor: undatedPage\.nextCursor/u);
  assert.match(adapter, /do \{[\s\S]*listCalendarApplicationDeadlinePage[\s\S]*\} while \(cursor !== null\)/u);
  assert.doesNotMatch(adapter, /tasksTruncatedAfter|periodComplete|truncatedAfter/u);
});

test("D2 undated continuation is URL-backed and never silently claims completeness", () => {
  const page = source("src/app/(v3)/v3/calendar/page.tsx");
  const calendar = source("src/components/v3/calendar/Calendar.tsx");
  const href = calendarUndatedContinuationHref("/v3/calendar", "week", "2026-09-10", {
    sortAt: SENTINEL,
    caseTaskId: TASK_ID,
  });

  assert.equal(
    href,
    "/v3/calendar?view=week&date=2026-09-10&undated_after_sort_at=9999-12-31T00%3A00%3A00%2B00%3A00&undated_after_case_task_id=12400000-0000-4000-8000-000000000101",
  );
  assert.match(page, /undatedCursorFromParams[\s\S]*parseCalendarUndatedTaskCursor/u);
  assert.match(page, /undatedNextHref=\{workspace\.undatedNextCursor/u);
  assert.match(calendar, /Показаны не все задачи без срока/u);
  assert.match(calendar, /Показать следующие/u);
  assert.doesNotMatch(calendar, /Все задачи без срока показаны/u);
});

test("application deadlines are read-only calendar items linked to exact Admissions case", () => {
  const component = source("src/components/v3/calendar/ApplicationDeadline.tsx");
  const calendar = source("src/components/v3/calendar/Calendar.tsx");
  assert.match(component, /kind: "application_deadline"|CalendarApplicationDeadline/u);
  assert.match(component, /\/v3\/profile\?case=.*&tab=overview#applications/u);
  assert.doesNotMatch(component, /TaskControls|complete|cancel|changePlatform/u);
  assert.match(calendar, /NearestApplicationDeadline/u);
  assert.match(calendar, /Без срока/u);
  assert.doesNotMatch(calendar, /прочитан.*не до конца|tasksTruncatedAfter/u);
});

test("day and week grids keep the all-day row for deadlines without all-day tasks", () => {
  const grids = source("src/components/v3/calendar/grids.tsx");
  const deadline = {
    kind: "application_deadline",
    id: APPLICATION_ID,
    studentCaseId: CASE_ID,
    studentDisplayName: "Алия Садыкова",
    universityName: "University of Example",
    programName: "Computer Science",
    status: "preparation",
    day: "2026-09-10",
  };

  assert.equal(hasCalendarAllDayRow([], [deadline]), true);
  assert.equal(hasCalendarAllDayRow([], []), false);
  assert.match(grids, /hasCalendarAllDayRow\(allDay, deadlines\)/u);
});

test("nearest deadline wording covers overdue, today, future and empty", () => {
  const component = source("src/components/v3/calendar/ApplicationDeadline.tsx");
  assert.match(component, /Просрочено \$\{Math\.abs\(delta\)\} дн/u);
  assert.match(component, /return "Сегодня"/u);
  assert.match(component, /До дедлайна \$\{delta\} дн/u);
  assert.match(component, /Активных дедлайнов нет\./u);
});
