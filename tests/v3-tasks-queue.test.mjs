import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { dueBandLabel, dueBucket, nextFriday, queueDue, weekEnd } from "../src/components/v3/queue/due-bucket.ts";
import { nextQueueIndex } from "../src/components/v3/queue/queue-navigation.ts";
import { activeFilterCount, queueHref } from "../src/components/v3/queue/queue-url.ts";
import { caseChangeForm, currentDeadline, dueTomorrow, staffEditForm, staffStatusForm, tomorrowDeadline } from "../src/components/v3/tasks/task-commands.ts";
import { parsePlatformCaseTaskDeadline } from "../src/lib/platform-admissions-task-contract.ts";
import { STAFF_TASK_FORM_FIELDS, parseStaffTaskCommand } from "../src/lib/platform-staff-task-contract.ts";
import { buildTaskQueue, parseTaskQueueFilters, taskQueueParams } from "../src/lib/v3/task-queue.ts";

/**
 * «Задачи» — одна очередь по срокам (решение владельца 25.09.2026) и общие
 * примитивы рабочей очереди. Логика сроков, слияния и адреса проверяется
 * напрямую; разметка — настоящим рендером дерева компонентов с синтетическими
 * задачами (tests/e2e/tasks-static-render.cjs --json) в отдельном
 * node-процессе. Это не живая проверка Supabase, прав или данных.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const surfaces = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/tasks-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));

// Четверг 24.09.2026, 10:00 в Бишкеке (UTC+6).
const NOW = new Date("2026-09-24T04:00:00.000Z");
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const OTHER = "aaaaaaaa-1111-4111-8111-000000000002";
const due = (dueOn, dueAt = null) => ({ dueOn, dueAt });

test("dueBucket groups by the Bishkek day and the exact instant of a timed deadline", () => {
  assert.equal(dueBucket(due("2026-09-23"), NOW), "overdue");
  assert.equal(dueBucket(due("2026-09-24"), NOW), "today");
  // 09:00 Bishkek has already passed at 10:00; 15:00 has not.
  assert.equal(dueBucket(due(null, "2026-09-24T03:00:00.000Z"), NOW), "overdue");
  assert.equal(dueBucket(due(null, "2026-09-24T09:00:00.000Z"), NOW), "today");
  assert.equal(dueBucket(due("2026-09-25"), NOW), "tomorrow");
  assert.equal(dueBucket(due("2026-09-26"), NOW), "week");
  assert.equal(dueBucket(due("2026-09-27"), NOW), "week");
  assert.equal(dueBucket(due("2026-09-28"), NOW), "later");
  assert.equal(dueBucket(due(null), NOW), "none");
  // 18:30 UTC is already 00:30 on the 25th in Bishkek: yesterday's all-day task is overdue.
  const afterMidnight = new Date("2026-09-24T18:30:00.000Z");
  assert.equal(dueBucket(due("2026-09-24"), afterMidnight), "overdue");
  assert.equal(dueBucket(due("2026-09-25"), afterMidnight), "today");
  // A closed task is never overdue.
  assert.equal(dueBucket(due("2026-09-20"), NOW, false), "past");
  assert.equal(weekEnd("2026-09-27"), "2026-09-27");
  assert.equal(weekEnd("2026-09-22"), "2026-09-27");
  assert.deepEqual(["2026-09-24", "2026-09-25", "2026-09-26"].map(nextFriday), ["2026-09-25", "2026-10-02", "2026-10-02"]);
});

test("queue dates are ДД.ММ (+ ЧЧ:ММ) in Bishkek with the overdue word, never colour alone", () => {
  assert.deepEqual(queueDue(due(null, "2026-09-24T09:00:00.000Z"), NOW), { dateTime: "2026-09-24T09:00:00.000Z", text: "24.09 15:00", word: "сегодня", overdue: false });
  assert.deepEqual(queueDue(due("2026-09-20"), NOW), { dateTime: "2026-09-20", text: "20.09", word: "прошёл", overdue: true });
  assert.equal(queueDue(due("2026-09-25"), NOW).word, "завтра");
  assert.equal(queueDue(due("2026-09-27"), NOW).word, "через 3 дн");
  assert.equal(queueDue(due("2027-01-03"), NOW).text, "03.01.27");
  assert.equal(queueDue(due("2026-09-20"), NOW, false).word, null);
  assert.equal(queueDue(due(null), NOW), null);
  assert.equal(dueBandLabel("today", "2026-09-24"), "Сегодня · чт 24.09");
  assert.equal(dueBandLabel("tomorrow", "2026-09-24"), "Завтра · пт 25.09");
});

const staff = (id, fields) => ({
  id, organizationId: "o", creatorMembershipId: fields.creator ?? ME, creatorDisplayName: "Автор",
  assigneeMembershipId: fields.assignee ?? ME, assigneeDisplayName: fields.assignee === OTHER ? "Коллега" : "Я",
  title: fields.title ?? id, description: null, status: fields.status ?? "open", priority: "normal",
  dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, version: "1", sourceMessageId: null,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: fields.updatedAt ?? "2026-09-23T00:00:00Z",
});
const caseTask = (id, fields) => ({
  sortAt: "x", organizationId: "o", caseTaskId: id, version: "1", studentCaseId: `case-${id}`, studentDisplayName: fields.student ?? "Студент",
  caseState: "active", taskType: "follow_up", title: fields.title ?? id, status: fields.status ?? "open", priority: "normal",
  dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, studentVisible: false,
  assigneeMembershipId: fields.assignee ?? ME, assigneeDisplayName: fields.assignee === OTHER ? "Коллега" : "Я",
  createdAt: "2026-09-01T00:00:00Z", updatedAt: fields.updatedAt ?? "2026-09-23T00:00:00Z",
});
const filters = (patch = {}) => ({ view: "mine", state: "open", type: null, due: null, query: "", window: 1, ...patch });

test("both kinds merge into one due-ordered queue, undated last, whatever order the reads returned", () => {
  const queue = buildTaskQueue({
    // The staff list arrives newest-updated first; the queue must not keep that order.
    staff: [staff("s-later", { dueOn: "2026-10-01", updatedAt: "2026-09-24T00:00:00Z" }), staff("s-none", {}), staff("s-old", { dueOn: "2026-09-20" })],
    cases: [caseTask("c-today", { dueAt: "2026-09-24T09:00:00.000Z" }), caseTask("c-none", {}), caseTask("c-tomorrow", { dueOn: "2026-09-25" })],
    filters: filters(), actorMembershipId: ME, now: NOW, complete: true,
  });
  assert.deepEqual(queue.rows.map((row) => row.key), ["staff:s-old", "case:c-today", "case:c-tomorrow", "staff:s-later", "case:c-none", "staff:s-none"]);
  assert.deepEqual(queue.bands.map((band) => [band.bucket, band.rows.length]), [["overdue", 1], ["today", 1], ["tomorrow", 1], ["later", 1], ["none", 2]]);
  assert.deepEqual(queue.counts, { mine: 6, created: null, all: null });
  assert.equal(queue.rows.find((row) => row.kind === "case").studentCaseId, "case-c-today");
});

test("filters apply inside the permitted reads: assignee, state, type, due and search", () => {
  const input = {
    staff: [staff("s1", { dueOn: "2026-09-20" }), staff("s2", { dueOn: "2026-09-24", assignee: OTHER, creator: ME })],
    cases: [caseTask("c1", { dueOn: "2026-09-21", student: "Айдана" }), caseTask("c2", { assignee: OTHER }), caseTask("c3", { status: "done", updatedAt: "2026-09-24T01:00:00Z" })],
    actorMembershipId: ME, now: NOW, complete: true,
  };
  const keys = (patch) => buildTaskQueue({ ...input, filters: filters(patch) }).rows.map((row) => row.key);
  assert.deepEqual(keys({}), ["staff:s1", "case:c1"]);
  assert.deepEqual(keys({ view: "all" }), ["staff:s1", "case:c1", "staff:s2", "case:c2"]);
  // «Поставил я»: the case queue carries no author, so only staff tasks qualify.
  assert.deepEqual(keys({ view: "created" }), ["staff:s1", "staff:s2"]);
  assert.deepEqual(keys({ view: "all", type: "case" }), ["case:c1", "case:c2"]);
  assert.deepEqual(keys({ view: "all", due: "today" }), ["staff:s2"]);
  assert.deepEqual(keys({ view: "all", query: "айдана" }), ["case:c1"]);
  const done = buildTaskQueue({ ...input, filters: filters({ state: "done" }) });
  assert.deepEqual(done.rows.map((row) => row.key), ["case:c3"]);
  assert.deepEqual(done.bands.map((band) => band.bucket), ["past"]);
});

test("numbers exist only for complete reads; «Вся команда» honestly derives the other tabs", () => {
  const input = {
    staff: [staff("s1", {}), staff("s2", { assignee: OTHER, creator: ME }), staff("s3", { creator: OTHER })],
    cases: [caseTask("c1", {}), caseTask("c2", { assignee: OTHER })],
    actorMembershipId: ME, now: NOW,
  };
  assert.deepEqual(buildTaskQueue({ ...input, filters: filters({ view: "all" }), complete: true }).counts, { mine: 3, created: 2, all: 5 });
  assert.deepEqual(buildTaskQueue({ ...input, filters: filters({ view: "created" }), complete: true }).counts, { mine: null, created: 2, all: null });
  const partial = buildTaskQueue({ ...input, filters: filters({ view: "all" }), complete: false });
  assert.deepEqual(partial.counts, { mine: null, created: null, all: null });
  assert.equal(partial.complete, false);
  assert.throws(() => buildTaskQueue({ ...input, staff: [staff("s1", {}), staff("s1", {})], filters: filters(), complete: true }), /duplicate/u);
});

test("filters live in the URL; old addresses keep working and «Вся команда» needs the right", () => {
  const parse = (search, teamView = true) => {
    const params = new URLSearchParams(search);
    return parseTaskQueueFilters((key) => params.get(key) ?? undefined, { teamView });
  };
  assert.deepEqual(parse(""), filters());
  assert.equal(parse("view=all", false).view, "mine");
  assert.equal(parse("view=all").view, "all");
  assert.deepEqual([parse("status=active").state, parse("status=completed").state, parse("status=all").state], ["open", "done", "open"]);
  assert.equal(parse("status=overdue").due, "overdue");
  assert.equal(parse("status=done&due=today").due, null, "closed tasks have no due filter");
  assert.equal(parse("type=case").type, "case");
  assert.equal(parse("type=nonsense").type, null);
  assert.equal(parse(`q=${"я".repeat(300)}`).query.length, 200);
  assert.equal(parse("window=4").window, 4);
  assert.equal(parse("window=3").window, 1);
  assert.deepEqual(taskQueueParams(filters()), { view: null, type: null, status: null, due: null, q: null, window: null });
  assert.deepEqual(taskQueueParams(filters({ view: "all", state: "done", query: "визa", window: 2 })),
    { view: "all", type: null, status: "done", due: null, q: "визa", window: "2" });
  assert.equal(queueHref("/v3/tasks", { view: "all", type: null, q: "" }), "/v3/tasks?view=all");
  assert.equal(queueHref("/v3/tasks", { view: "all", type: "case" }, { type: null, task: "t1" }), "/v3/tasks?view=all&task=t1");
  assert.equal(queueHref("/v3/tasks", {}), "/v3/tasks");
  assert.equal(activeFilterCount(["case", null, "", undefined, "done"]), 2);
});

test("j/k and arrows move from the focused row, else from the selected one, and stop at the ends", () => {
  assert.equal(nextQueueIndex(0, -1, -1, 1), -1);
  assert.equal(nextQueueIndex(5, -1, -1, 1), 0);
  assert.equal(nextQueueIndex(5, -1, -1, -1), 4);
  assert.equal(nextQueueIndex(5, -1, 2, 1), 3);
  assert.equal(nextQueueIndex(5, 4, 2, 1), 4);
  assert.equal(nextQueueIndex(5, 0, 2, -1), 0);
});

test("row commands submit exactly the fields the existing actions accept", () => {
  const status = staffStatusForm({ id: "11111111-1111-4111-8111-111111111111", version: "4" }, "done", "  Отправлено ");
  assert.deepEqual([...status.keys()].sort(), [...STAFF_TASK_FORM_FIELDS].sort());
  const parsed = parseStaffTaskCommand(new Map([...status.entries()].map(([key, value]) => [key, String(value)])));
  assert.equal(parsed.p_operation, "status");
  assert.equal(parsed.p_status, "done");
  assert.equal(parsed.p_completion_note, "Отправлено");
  // Undo reopens with the version the completion returned, to the prior state.
  const reopen = parseStaffTaskCommand(new Map([...staffStatusForm({ id: "11111111-1111-4111-8111-111111111111", version: "5" }, "in_progress").entries()]));
  assert.equal(reopen.p_status, "in_progress");
  assert.equal(reopen.p_expected_version, "5");

  const task = { id: "11111111-1111-4111-8111-111111111111", version: "4", title: "Письмо", description: null, priority: "normal", status: "open",
    assigneeMembershipId: "22222222-2222-4222-8222-222222222222", dueOn: "2026-09-24", dueAt: null };
  const edit = parseStaffTaskCommand(new Map([...staffEditForm(task, { deadline: tomorrowDeadline(task, NOW) }).entries()]));
  assert.equal(edit.p_operation, "edit");
  assert.equal(edit.p_due_on, "2026-09-25");

  const caseForm = caseChangeForm({ ...task, studentCaseId: "33333333-3333-4333-8333-333333333333", studentVisible: false }, { status: "done", reason: " Подано " });
  assert.deepEqual([...caseForm.keys()].sort(), ["assignee_membership_id", "case_task_id", "deadline_kind", "due_at", "due_on", "expected_version",
    "priority", "reason", "request_id", "status", "student_case_id", "student_visible"]);
  assert.equal(caseForm.get("reason"), "Подано");
  assert.equal(caseForm.get("deadline_kind"), "all_day");
});

test("«Перенести на завтра» keeps the task's own time and is hidden when the task is already due tomorrow", () => {
  assert.deepEqual(tomorrowDeadline(due("2026-09-20"), NOW), { deadlineKind: "all_day", dueOn: "2026-09-25", dueAt: "" });
  assert.deepEqual(tomorrowDeadline(due(null), NOW), { deadlineKind: "all_day", dueOn: "2026-09-25", dueAt: "" });
  const timed = tomorrowDeadline(due(null, "2026-09-22T08:30:00.000Z"), NOW);
  assert.deepEqual(timed, { deadlineKind: "timed", dueOn: "", dueAt: "2026-09-25T14:30" });
  assert.equal(parsePlatformCaseTaskDeadline(timed.deadlineKind, timed.dueOn, timed.dueAt).dueAt, "2026-09-25T08:30:00.000Z");
  assert.equal(dueTomorrow(due("2026-09-25"), NOW), true);
  assert.equal(dueTomorrow(due("2026-09-24"), NOW), false);
  assert.deepEqual(currentDeadline(due(null, "2026-09-22T08:30:00.000Z")), { deadlineKind: "timed", dueOn: "", dueAt: "2026-09-22T08:30:00.000Z" });
});

test("view tabs are real links with aria-current and numbers only where the read has them", () => {
  const mine = surfaces.get("mine-default");
  const tabs = mine.slice(mine.indexOf('data-testid="queue-view-tabs"'), mine.indexOf('data-testid="queue-toolbar"'));
  assert.match(tabs, /aria-current="page"[^>]*href="\/v3\/tasks">Мои<span class="tabular-nums text-fg-3">12<\/span>/u);
  assert.match(tabs, /href="\/v3\/tasks\?view=created">Поставил я<\/a>/u, "no read of «Поставил я» — no number");
  assert.match(tabs, /href="\/v3\/tasks\?view=all">Вся команда<\/a>/u);
  const team = surfaces.get("team-panel");
  assert.match(team, /aria-current="page"[^>]*href="\/v3\/tasks\?view=all">Вся команда<span class="tabular-nums text-fg-3">16<\/span>/u);
  assert.match(team, />Поставил я<span class="tabular-nums text-fg-3">7<\/span>/u);
  // An incomplete read shows neither tab nor band numbers, and says so.
  const partial = surfaces.get("incomplete");
  assert.doesNotMatch(partial, /tabular-nums text-fg-3">\d/u);
  assert.doesNotMatch(partial, /· \d+<\/span><\/h2>/u);
  assert.match(partial, /Показаны не все задачи/u);
  assert.match(partial, /href="\/v3\/tasks\?window=2">Показать больше задач/u);
});

test("filters keep the rest of the URL, show the value inside and escape overflow via the popover API", () => {
  const html = surfaces.get("team-case-filter");
  assert.match(html, /Тип: <span class="text-fg">По студентам<\/span>/u);
  assert.match(html, /aria-label="Убрать фильтр: Тип: По студентам"[^>]*href="\/v3\/tasks\?view=all&amp;due=overdue"/u);
  assert.match(html, /aria-current="true"[^>]*href="\/v3\/tasks\?view=all&amp;type=case&amp;due=overdue"><span[^>]*>По студентам/u);
  assert.match(html, /popover="auto"[^>]*class="v3-anchored/u);
  assert.match(html, /<input type="hidden" name="view" value="all"\/><input type="hidden" name="type" value="case"\/><input type="hidden" name="due" value="overdue"\/>/u);
  assert.match(html, />Сбросить<\/a>/u);
  assert.doesNotMatch(surfaces.get("mine-default"), />Сбросить<\/a>/u, "nothing selected — no reset");
  assert.match(read("src/app/(v3)/v3.css"), /\.v3-world \.v3-anchored \{[^}]*position-area: block-end span-inline-end;/u);
});

test("the body groups rows under due bands and completes in the row", () => {
  const html = surfaces.get("mine-default");
  assert.match(html, /<span class="text-danger">Просрочено<\/span><span class="font-normal tabular-nums text-fg-3">· 2<\/span>/u);
  const bands = [...html.matchAll(/<h2 id="queue-band-[a-z]+"[^>]*><span class="text-(?:danger|fg)">([^<]+)</gu)].map((match) => match[1]);
  assert.deepEqual(bands, ["Просрочено", "Сегодня · чт 24.09", "Завтра · пт 25.09", "На этой неделе", "Позже", "Без срока"]);
  // Staff task: one click; case task: the anchored «Результат» window.
  assert.match(html, /<button type="button" aria-label="Завершить: Отправить партнёру пакет по весеннему набору"/u);
  const caseRow = html.slice(html.indexOf('data-queue-row="case:cccccccc-6666-4666-8666-000000000001"'));
  assert.match(caseRow, /popoverTarget="(queue-popover-[^"]+)"[^>]*aria-haspopup="dialog" aria-label="Завершить с результатом: Подтвердить подачу в UCSI"/u);
  assert.match(caseRow, /<label for="[^"]+" id="[^"]+" class="block t-label text-fg-2">Результат<\/label>/u);
  assert.match(caseRow, /<time dateTime="2026-09-20" class="block whitespace-nowrap font-mono tabular-nums text-danger">20\.09<\/time><span class="block t-meta text-danger">прошёл<\/span>/u);
  // The assignee column is hidden in «Мои» and the status word only marks exceptions.
  assert.doesNotMatch(html, /в работе/u);
  assert.match(html, /· заблокирована/u);
  assert.match(html, /data-testid="task-quick-add"[\s\S]*placeholder="Новая задача…"/u);
  assert.doesNotMatch(html, /Сроки указаны по времени Бишкека/u);
  assert.doesNotMatch(html, /\bbg-accent\b/u, "the page itself has no solid red: «Создать задачу» lives in the top bar");
});

test("the right panel pushes the list, marks the row and keeps the list URL", () => {
  const html = surfaces.get("team-panel");
  assert.match(html, /^<div class="xl:grid xl:grid-cols-\[minmax\(0,1fr\)_26rem\] xl:items-start xl:gap-6">/u);
  const row = html.slice(html.indexOf('data-queue-row="case:cccccccc-6666-4666-8666-000000000005"'));
  assert.match(row, /^[^>]*class="[^"]*\bbg-surface-2\b/u);
  assert.match(row, /aria-current="true"[^>]*>Согласовать с семьёй список программ в Польше и Чехии<\/a>/u);
  const panel = html.slice(html.indexOf("<dialog"));
  assert.match(panel, /^<dialog open="" aria-labelledby="([^"]+)" data-testid="queue-detail-panel"/u);
  assert.match(panel, /data-testid="queue-detail-close"[^>]*href="\/v3\/tasks\?view=all"/u);
  assert.match(panel, /<h2 id="[^"]+" tabindex="-1" class="t-record-title/u);
  assert.match(panel, /href="\/v3\/profile\?case=dddddddd-2222-4222-8222-000000000005"[^>]*>Открыть дело<\/a>/u);
  assert.match(panel, />Обсудить<\/a>/u);
  assert.match(panel, /<details class="[^"]*"><summary[^>]*>Перенести или передать/u);
  assert.doesNotMatch(panel, /\bbg-accent\b/u, "«Завершить» is a dark neutral button, not a second red");
});

test("empty, restricted and «Поставил я» states are honest", () => {
  const empty = surfaces.get("empty-today");
  assert.match(empty, /role="status"[^>]*data-testid="queue-empty"><p class="t-item text-fg">На сегодня задач нет<\/p><a[^>]*href="\/v3\/tasks"[^>]*>Показать все открытые<\/a>/u);
  assert.match(surfaces.get("no-queue-access"), /В вашей роли нет права на просмотр задач\. Новую задачу можно создать строкой выше\./u);
  assert.match(surfaces.get("created-view"), /Здесь только рабочие задачи/u);
  assert.match(surfaces.get("done-view"), />Завершённые и отменённые</u);
  assert.match(read("src/app/(v3)/v3/tasks/loading.tsx"), /<QueueSkeleton \/>/u);
});

test("the calendar loses only «Сводка на Главной» and its second red button", () => {
  const page = read("src/app/(v3)/v3/calendar/page.tsx");
  assert.doesNotMatch(page, /Сводка на Главной|href="\/v3\/main"|from "@\/components\/ui"|from "next\/link"/u);
  assert.match(page, /<PartShell title="Календарь">\s*<Calendar/u);
  assert.doesNotMatch(read("src/app/(v3)/v3/calendar/loading.tsx"), /h-16/u);
  const calendar = read("src/components/v3/calendar/Calendar.tsx");
  const button = calendar.slice(calendar.lastIndexOf("<button", calendar.indexOf("Задача по студенту</button>")), calendar.indexOf("Задача по студенту</button>"));
  assert.doesNotMatch(button, /\bbg-accent\b/u);
  assert.match(calendar, /canCreate \? <CalendarCreateTaskForm/u, "creating a case task from the calendar still works");
});
