import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  assertCalendarDatedTaskPageOrder,
  CalendarContractError,
  listCalendarUndatedTaskPage,
  parseCalendarUndatedTaskCursor,
} from "../src/lib/v3/calendar-contract.ts";
import * as calendarContract from "../src/lib/v3/calendar-contract.ts";
import {
  calendarDayList,
  calendarHasDatedTasks,
  calendarPeriodDays,
  calendarTaskIsOpen,
  calendarTasksOfDay,
  calendarUndatedContinuationHref,
  calendarUndatedPageNotice,
  clockLabel,
  gridDays,
  hasCalendarAllDayRow,
  calendarAccessNotice,
  calendarEmptyPeriodLabel,
} from "../src/components/v3/calendar/types.ts";
import { personalCalendarAccess } from "../src/lib/v3/personal-calendar-contract.ts";
import { staffCanAccessRoute } from "../src/lib/platform-access.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ORGANIZATION_ID = "12400000-0000-4000-8000-000000000001";
const TASK_ID = "12400000-0000-4000-8000-000000000101";
const TASK_ID_2 = "12400000-0000-4000-8000-000000000102";
const CASE_ID = "12400000-0000-4000-8000-000000000201";
const SENTINEL = "9999-12-31T00:00:00+00:00";

const actor = Object.freeze({
  authUserId: "12400000-0000-4000-8000-000000000011",
  profileId: "12400000-0000-4000-8000-000000000021",
  membershipId: "12400000-0000-4000-8000-000000000031",
  organizationId: ORGANIZATION_ID,
  displayName: "D2 Admissions",
  email: "d2@example.invalid",
  systemRole: "staff",
  presentationRole: null,
  assignments: [],
  permissionKeys: ["case.read.full", "task.manage", "application.manage"],
  platformAccessVersion: 1,
  platformBundleId: "12400000-0000-4000-8000-000000000041",
  platformBundleVersion: 1,
});

test("calendar undated tasks require task.manage before making any RPC", async () => {
  const calls = [];
  const createOnly = { ...actor, permissionKeys: ["case.read.full", "profile.read.full", "task.create"] };
  await assert.rejects(listCalendarUndatedTaskPage(createOnly, {}, {
    client: { schema: () => ({ rpc: async (...args) => { calls.push(args); return { data: [], error: null }; } }) },
  }), CalendarContractError);
  assert.deepEqual(calls, []);
});

test("task-only staff reads the actual bounded undated RPC without a case read grant", async () => {
  const calls = [];
  const result = await listCalendarUndatedTaskPage({ ...actor, permissionKeys: ["task.manage"] }, {}, {
    client: { schema: () => ({ rpc: async (...args) => { calls.push(args); return { data: [], error: null }; } }) },
  });
  assert.deepEqual(result, { rows: [], nextCursor: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "staff_case_task_undated_page");
});

// Кто что видит в личном календаре — вместо таблицы веток прежнего
// координатора (Э8.8 убрал сроки вузов): задачи по студентам — `task.manage`,
// а в просмотре роли — ещё и `admissions.read` этой роли; рабочие задачи —
// `staff.task.read` (у администратора — всегда).
for (const [name, changes, expected] of [
  ["Admin", { systemRole: "admin", permissionKeys: [] }, { caseTasks: true, staffTasks: true }],
  ["Admin Admissions preview", { systemRole: "admin", presentationRole: "admissions", permissionKeys: [] }, { caseTasks: true, staffTasks: true }],
  ["Admin Sales preview", { systemRole: "admin", presentationRole: "sales", permissionKeys: [] }, { caseTasks: false, staffTasks: true }],
  ["task.manage with case read", { permissionKeys: ["case.read.full", "task.manage"] }, { caseTasks: true, staffTasks: false }],
  ["task.manage without case read", { permissionKeys: ["task.manage"] }, { caseTasks: true, staffTasks: false }],
  ["staff tasks only", { permissionKeys: ["staff.task.read"] }, { caseTasks: false, staffTasks: true }],
  ["create-only", { permissionKeys: ["case.read.full", "profile.read.full", "task.create"] }, { caseTasks: false, staffTasks: false }],
  ["deadline reader", { permissionKeys: ["case.read.full", "application.manage"] }, { caseTasks: false, staffTasks: false }],
]) {
  test(`personal calendar access: ${name}`, () => {
    const access = personalCalendarAccess({ ...actor, ...changes });
    assert.deepEqual({ ...access }, { ...expected, tasks: expected.caseTasks || expected.staffTasks });
    assert.ok(Object.isFrozen(access));
  });
}

test("Admin Sales preview never reaches the calendar: the route is closed before any task read", () => {
  const salesPreview = { ...actor, systemRole: "admin", presentationRole: "sales", permissionKeys: [] };
  assert.equal(staffCanAccessRoute(salesPreview, "/v3/calendar"), false);
  assert.equal(staffCanAccessRoute({ ...salesPreview, presentationRole: "admissions" }, "/v3/calendar"), true);
});

test("personal calendar distinguishes denied access from an empty task period", () => {
  assert.equal(calendarAccessNotice({ tasks: false }), "Нет доступа к личному списку задач.");
  assert.equal(calendarEmptyPeriodLabel({ tasks: false }, "week"), null);
  assert.equal(calendarAccessNotice({ tasks: true }), null);
  // Э8.8: строка говорит о задачах со сроком в показанном периоде — своими словами для вида.
  assert.equal(calendarEmptyPeriodLabel({ tasks: true }, "week"), "На этой неделе задач со сроком нет.");
  assert.equal(calendarEmptyPeriodLabel({ tasks: true }, "day"), "В этот день задач со сроком нет.");
  assert.equal(calendarEmptyPeriodLabel({ tasks: true }, "month"), "В этом месяце задач со сроком нет.");
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

test("D2 undated sentinel equality preserves PostgreSQL microseconds", async () => {
  const exactWithFraction = "9999-12-31T00:00:00.000000+00:00";
  const laterByOneMicrosecond = "9999-12-31T00:00:00.000001+00:00";

  assert.deepEqual(parseCalendarUndatedTaskCursor(exactWithFraction, TASK_ID), {
    sortAt: exactWithFraction,
    caseTaskId: TASK_ID,
  });
  assert.equal(
    parseCalendarUndatedTaskCursor(laterByOneMicrosecond, TASK_ID),
    null,
  );
  await assert.rejects(
    listCalendarUndatedTaskPage(
      actor,
      {},
      {
        client: rpcClient(() => ({
          data: [{ ...undatedRow(TASK_ID), sort_at: laterByOneMicrosecond }],
          error: null,
        })),
      },
    ),
    CalendarContractError,
  );
});

test("D2 dated page ordering fails closed across rows and the supplied cursor", () => {
  const first = { sortAt: "2026-09-10T03:00:00+00:00", caseTaskId: TASK_ID };
  const second = { sortAt: "2026-09-10T03:00:00Z", caseTaskId: TASK_ID_2 };
  const earlierMicrosecond = {
    sortAt: "2026-09-10T03:00:00.000100+00:00",
    caseTaskId: TASK_ID_2,
  };
  const laterMicrosecond = {
    sortAt: "2026-09-10T03:00:00.000900+00:00",
    caseTaskId: TASK_ID,
  };

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
  assert.throws(
    () => assertCalendarDatedTaskPageOrder([earlierMicrosecond], laterMicrosecond),
    CalendarContractError,
  );
  assert.doesNotThrow(
    () => assertCalendarDatedTaskPageOrder([laterMicrosecond], earlierMicrosecond),
  );
});

test("D2 calendar exhausts bounded ranges but reads only one undated page", () => {
  const adapter = source("src/lib/v3/calendar-source.ts");
  assert.match(adapter, /mode: "dated", from, to/u);
  assert.match(adapter, /do \{[\s\S]*readPersonalCalendarPage[\s\S]*\} while \(datedCursor !== null\)/u);
  assert.match(adapter, /const undated = await readPersonalCalendarPage/u);
  assert.doesNotMatch(adapter, /while \(undatedCursor !== null\)/u);
  assert.match(adapter, /undatedNextCursor: undated\.nextCursor/u);
  assert.doesNotMatch(adapter, /listCalendarApplicationDeadlinePage/u);
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
  assert.match(page, /undatedCursorFromParams[\s\S]*parsePersonalCalendarCursor/u);
  assert.match(page, /undatedNextHref=\{workspace\.undatedNextCursor/u);
  assert.match(page, /undatedContinuationPage=\{workspace\.access\.tasks && undatedCursor !== null\}/u);
  assert.equal(calendarUndatedPageNotice(false, false, 12), null);
  assert.match(calendarUndatedPageNotice(false, true, 100) ?? "", /не все/u);
  assert.match(calendarUndatedPageNotice(true, true, 100) ?? "", /предыдущие и следующие/u);
  assert.match(calendarUndatedPageNotice(true, false, 7) ?? "", /предыдущие задачи/u);
  assert.match(calendar, /calendarUndatedPageNotice/u);
  assert.match(calendar, /Показать следующие/u);
  assert.match(calendar, /К началу списка/u);
  // Э8.8: «Без срока» — только при открытой задаче без срока или странице очереди.
  assert.match(calendar, /const undatedShown = unscheduled\.some\(calendarTaskIsOpen\) \|\| undatedNotice !== null;/u);
  assert.match(calendar, /\{undatedShown \? \(/u);
  assert.doesNotMatch(calendar, /Все задачи без срока показаны/u);
});

test("the calendar carries no university deadlines, and «Сегодня» dropped its deadline group too (owner 28.09)", () => {
  assert.equal(existsSync(new URL("../src/components/v3/calendar/ApplicationDeadline.tsx", import.meta.url)), false);
  const calendarFiles = ["Calendar.tsx", "grids.tsx", "types.ts"].map((name) => source(`src/components/v3/calendar/${name}`)).join("\n");
  assert.doesNotMatch(calendarFiles, /ApplicationDeadline|application_deadline|deadlines=|deadlines\.filter|applicationDeadlines/u);
  assert.doesNotMatch(source("src/lib/v3/calendar-source.ts"), /DeadlinePage|readNearestCalendarApplicationDeadline/u);
  // Читатели только для тестов ушли вместе со сроками календаря.
  assert.equal("readCalendarWorkspaceBranches" in calendarContract, false);
  assert.equal("readNearestCalendarApplicationDeadline" in calendarContract, false);
  assert.doesNotMatch(source("src/lib/v3/personal-calendar-contract.ts"), /applicationDeadlines/u);
  // «Сегодня · Сроки вузов» ушло решением владельца 28.09: контракт больше не читается ни оттуда, ни отсюда.
  assert.equal("listCalendarApplicationDeadlinePage" in calendarContract, false);
  assert.equal("normalizeCalendarApplicationDeadlineRow" in calendarContract, false);
  assert.equal("CalendarContractDeniedError" in calendarContract, false);
  assert.doesNotMatch(source("src/lib/v3/today-source.ts"), /listCalendarApplicationDeadlinePage|readDeadlines|TODAY_DEADLINE/u);
  assert.doesNotMatch(source("src/lib/v3/today-queue.ts"), /"deadlines"|todayDeadlineItems|TODAY_DEADLINE/u);
  assert.match(source("src/components/v3/calendar/Calendar.tsx"), /Без срока/u);
});

test("the all-day row appears only with an all-day task", () => {
  const grids = source("src/components/v3/calendar/grids.tsx");
  assert.equal(hasCalendarAllDayRow([]), false);
  assert.equal(hasCalendarAllDayRow([{ day: "2026-09-10", minutes: null }]), true);
  assert.match(grids, /hasCalendarAllDayRow\(allDay\)/u);
});

const day = (key, fields) => ({ key, day: fields.day ?? null, minutes: fields.minutes ?? null, state: fields.state ?? "open" });

test("Э8.8: the empty-period line counts dated tasks of the shown period only", () => {
  const week = gridDays("week", "2026-09-26");
  const month = gridDays("month", "2026-09-26");
  const undated = [day("a", {}), day("b", { state: "done" })];
  assert.equal(calendarHasDatedTasks("week", "2026-09-26", week, undated), false, "undated tasks do not hide the line");
  assert.equal(calendarHasDatedTasks("week", "2026-09-26", week, [...undated, day("c", { day: "2026-09-25" })]), true);
  assert.equal(calendarHasDatedTasks("week", "2026-09-26", week, [day("t", { day: "2026-10-10" })]), false, "a URL target from another period is not in this week");
  // Хвост соседнего месяца в сетке — не этот месяц.
  assert.ok(month.includes("2026-10-01"));
  assert.equal(calendarHasDatedTasks("month", "2026-09-26", month, [day("n", { day: "2026-10-01" })]), false);
  assert.equal(calendarPeriodDays("month", "2026-09-26", month).length, 30);
  assert.equal(calendarTaskIsOpen({ state: "done" }), false);
  assert.equal(calendarTaskIsOpen({ state: "cancelled" }), false);
  assert.equal(calendarTaskIsOpen({ state: "blocked" }), true);
});

test("Э8.8: the phone day list groups days with tasks and folds empty runs, keeping today and the selected day", () => {
  const week = gridDays("week", "2026-09-26");
  const tasks = [
    day("late", { day: "2026-09-22", minutes: 900 }),
    day("allday", { day: "2026-09-22" }),
    day("early", { day: "2026-09-22", minutes: 540 }),
    day("fri", { day: "2026-09-25", minutes: 600 }),
  ];
  assert.deepEqual(calendarTasksOfDay(tasks, "2026-09-22").map((task) => task.key), ["allday", "early", "late"]);
  const entries = calendarDayList(week, tasks, ["2026-09-24", "2026-09-26"]);
  assert.deepEqual(entries.map((entry) => entry.kind === "day" ? `${entry.day}:${entry.tasks.length}` : `${entry.from}..${entry.to}`), [
    "2026-09-21..2026-09-21",
    "2026-09-22:3",
    "2026-09-23..2026-09-23",
    "2026-09-24:0",
    "2026-09-25:1",
    "2026-09-26:0",
    "2026-09-27..2026-09-27",
  ]);
  const quiet = calendarDayList(gridDays("week", "2026-10-01"), [day("x", { day: "2026-09-29" })], []);
  assert.deepEqual(quiet.map((entry) => entry.kind === "day" ? entry.day : `${entry.from}..${entry.to}`), [
    "2026-09-28..2026-09-28", "2026-09-29", "2026-09-30..2026-10-04",
  ]);
  assert.equal(clockLabel(9 * 60 + 5), "09:05");
  assert.equal(clockLabel(14 * 60 + 30), "14:30");
});

test("Э8.8: calendar markup — one sheet, staff type roles, 44 px day links, neutral hover and selected day", () => {
  const calendar = source("src/components/v3/calendar/Calendar.tsx");
  const grids = source("src/components/v3/calendar/grids.tsx");
  // Строка периода, пустой период, «Без срока» и сетка — один белый лист.
  assert.equal([...calendar.matchAll(/rounded-card border border-border bg-surface/gu)].length, 1);
  assert.match(calendar, /<p className="flex flex-wrap items-center gap-x-2 t-section text-fg" data-calendar-period="">\s*<span>\{periodTitle\}<\/span>/u);
  // У дня нет шапки с числом: сегодняшний день назван словом срока у периода.
  assert.match(calendar, /\{view === "day" && day === today \? <DueWord view=\{\{ text: "сегодня", tone: "today" \}\} \/> : null\}/u);
  // Телефон: период первым, под ним одной строкой стрелки с «Сегодня» и вид; от 768 px — стрелки, период, вид.
  assert.match(calendar, /<div className="min-w-0 basis-full px-2 md:order-2 md:flex-1 md:basis-40 md:px-0">/u);
  assert.match(calendar, /<div className="flex shrink-0 items-center md:order-1 md:gap-1">/u);
  assert.match(calendar, /<nav aria-label="Вид календаря" className="ml-auto shrink-0 md:order-3">/u);
  assert.match(calendar, /v3-choice flex min-h-11 min-w-11 items-center justify-center rounded-ctl px-1\.5 t-label text-fg-2 hover:bg-surface-2 md:px-3/u);
  // Пустой период — по задачам со сроком, строка не прячется из-за «Без срока».
  assert.match(calendar, /const emptyPeriodLabel = hasDated \? null : calendarEmptyPeriodLabel\(readAccess, view\);/u);
  // Ссылки панели: `text-brand` без токена заменены подчёркнутым тёмным акцентом.
  assert.doesNotMatch(calendar + grids, /text-brand|\btext-(?:xs|sm)\b|hover:border-accent/u);
  assert.match(calendar, /const PANEL_LINK =\s*"inline-flex min-h-11 items-center t-label text-accent-text underline underline-offset-4/u);
  // Управление задачей в той же панели — роли `t-*`; «Изменить задачу» — такая же подчёркнутая тёмная ссылка, не красный текст.
  const controls = source("src/components/v3/calendar/TaskControls.tsx");
  assert.doesNotMatch(controls, /\btext-(?:xs|sm)\b|\bfont-semibold\b|\btext-accent(?![-\w])/u);
  assert.match(controls, /<summary className="min-h-11 cursor-pointer py-3 t-label text-accent-text underline underline-offset-4 hover:text-fg">\s*Изменить задачу/u);
  // Дни — ссылки 44 px, «сегодня» — заливка 24 px внутри; выбранный день — нейтральный «выбрано».
  assert.match(grids, /\$\{selected \? "v3-choice " : ""\}inline-flex min-h-11 min-w-11 items-center justify-center/u);
  assert.match(grids, /t-item grid h-6 min-w-6 place-items-center rounded-nav px-1 tabular-nums/u);
  assert.match(grids, /aria-current=\{isToday \? "date" : selected \? "true" : undefined\}/u);
  assert.match(grids, /selected=\{day === chip\.selectedDay\}/u);
  assert.match(calendar, /selectedDay: day,/u);
  assert.match(calendar, /Срок новой задачи — /u);
  // «ещё N» — 44 px; карточка задачи — нейтральное наведение.
  assert.match(grids, /t-label inline-flex min-h-11 items-center rounded-nav px-1\.5 text-fg-2 underline/u);
  assert.match(grids, /v3-choice flex min-h-11 w-full flex-col items-start gap-0\.5 rounded-nav border border-control-edge bg-surface-2 px-2 py-1 text-start hover:bg-surface-3"/u);
  // Телефон: сетки от 768 px, ниже — список по дням с датами JetBrains Mono.
  assert.match(calendar, /<div className="hidden border-t border-border md:block">/u);
  assert.match(calendar, /<div className="border-t border-border md:hidden">\s*<DayList/u);
  assert.match(grids, /idPrefix="list-task"/u);
  assert.match(grids, /<span className="font-mono">\{formatQueueDay\(day, today\)\}<\/span>/u);
  assert.match(grids, /<span>— задач нет<\/span>/u);
});
