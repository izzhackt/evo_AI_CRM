import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DUE_BUCKETS, dueBandLabel, dueBucket, dueFilterDays, nextFriday, queueDue, weekEnd } from "../src/components/v3/queue/due-bucket.ts";
import { nextQueueIndex, queueFocusAfterRemoval, rowNeedsReveal } from "../src/components/v3/queue/queue-navigation.ts";
import { shortPersonName } from "../src/components/v3/queue/person-name.ts";
import { activeFilterCount, queueHref } from "../src/components/v3/queue/queue-url.ts";
import { caseChangeForm, currentDeadline, dueTomorrow, staffEditForm, staffStatusForm, tomorrowDeadline } from "../src/components/v3/tasks/task-commands.ts";
import { parsePlatformCaseTaskDeadline } from "../src/lib/platform-admissions-task-contract.ts";
import { STAFF_TASK_FORM_FIELDS, parseStaffTaskCommand } from "../src/lib/platform-staff-task-contract.ts";
import { buildTaskQueue, parseTaskQueueFilters, taskQueueNarrowing, taskQueueParams } from "../src/lib/v3/task-queue.ts";

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

test("the server day bounds of a «Срок» group always contain the group, by the Bishkek day", () => {
  const shift = (day, delta) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
  // Every weekday of one week at 10:00, plus Sunday 23:50 and Monday 00:10 in Bishkek.
  const moments = [...Array.from({ length: 7 }, (_, index) => `${shift("2026-09-21", index)}T10:00:00+06:00`),
    "2026-09-27T23:50:00+06:00", "2026-09-28T00:10:00+06:00", "2026-12-31T12:00:00+06:00"];
  for (const moment of moments) {
    const now = new Date(moment);
    const today = moment.slice(0, 10);
    const tasks = Array.from({ length: 20 }, (_, index) => shift(today, index - 5)).flatMap((day) => [
      { day, task: due(day) },
      { day, task: due(null, new Date(`${day}T00:30:00+06:00`).toISOString()) },
      { day, task: due(null, new Date(`${day}T23:30:00+06:00`).toISOString()) },
    ]);
    for (const bucket of DUE_BUCKETS) {
      const days = dueFilterDays(bucket, today);
      if (bucket === "none") { assert.equal(days, null, "undated tasks have no day to bound"); continue; }
      if (days.from && days.to) assert.ok(days.from <= days.to, `${moment} ${bucket}: the server rejects reversed bounds`);
      for (const { day, task } of tasks.filter(({ task }) => dueBucket(task, now) === bucket)) {
        assert.ok((days.from === null || day >= days.from) && (days.to === null || day <= days.to), `${moment} ${bucket} ${JSON.stringify(task)}`);
      }
    }
  }
  assert.deepEqual(dueFilterDays("today", "2026-09-24"), { from: "2026-09-24", to: "2026-09-24" });
  assert.deepEqual(dueFilterDays("overdue", "2026-09-24"), { from: null, to: "2026-09-24" }, "a timed task earlier today is overdue");
  assert.deepEqual(dueFilterDays("later", "2026-09-27"), { from: "2026-09-28", to: null });
});

test("at the read limit the screen offers only what shrinks the server read that was cut off", () => {
  assert.deepEqual(taskQueueNarrowing(filters({ view: "all" }), ["staff", "case"]),
    { label: "Показать мои задачи на сегодня", overrides: { view: null, due: "today" } });
  assert.deepEqual(taskQueueNarrowing(filters({ view: "all" }), ["staff"]), { label: "Показать только мои задачи", overrides: { view: null } });
  assert.deepEqual(taskQueueNarrowing(filters(), ["case"]), { label: "Показать задачи на сегодня", overrides: { due: "today" } });
  // «Мои» does not shrink the case read (its assignee is filtered in the app);
  // search, «Просрочено» and «Без срока» do not shrink it either.
  assert.equal(taskQueueNarrowing(filters({ view: "all" }), ["case"])?.overrides.view, undefined);
  assert.equal(taskQueueNarrowing(filters(), ["staff"]), null);
  assert.equal(taskQueueNarrowing(filters({ query: "виза" }), ["staff"]), null);
  assert.equal(taskQueueNarrowing(filters({ due: "overdue" }), ["case"]), null);
  assert.equal(taskQueueNarrowing(filters({ due: "none" }), ["case"]), null);
  assert.equal(taskQueueNarrowing(filters({ state: "done" }), ["case"]), null, "closed tasks have no due filter");
  assert.equal(taskQueueNarrowing(filters({ view: "all" }), []), null);
});

test("queue dates are ДД.ММ (+ ЧЧ:ММ) in Bishkek with the overdue word, never colour alone", () => {
  assert.deepEqual(queueDue(due(null, "2026-09-24T09:00:00.000Z"), NOW), { dateTime: "2026-09-24T09:00:00.000Z", text: "24.09 15:00", word: "сегодня", caption: null, overdue: false });
  assert.deepEqual(queueDue(due("2026-09-20"), NOW), { dateTime: "2026-09-20", text: "20.09", word: "прошёл", caption: null, overdue: true });
  assert.equal(queueDue(due("2026-09-25"), NOW).word, "завтра");
  assert.equal(queueDue(due("2026-09-27"), NOW).word, "через 3 дн");
  assert.equal(queueDue(due("2027-01-03"), NOW).text, "03.01.27");
  // A closed task has no relative word; its bare date is labelled «срок» so it is not read as the completion day.
  assert.deepEqual(queueDue(due("2026-09-20"), NOW, false), { dateTime: "2026-09-20", text: "20.09", word: null, caption: "срок", overdue: false });
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

test("focus leaving with a completed row moves to the next remaining row, else the previous", () => {
  const keys = ["a", "b", "c", "d"];
  assert.equal(queueFocusAfterRemoval(keys, "b", new Set(["b"])), "c");
  assert.equal(queueFocusAfterRemoval(keys, "b", new Set(["b", "c"])), "d");
  assert.equal(queueFocusAfterRemoval(keys, "d", new Set(["d"])), "c");
  assert.equal(queueFocusAfterRemoval(keys, "b", new Set(keys)), null);
  assert.equal(queueFocusAfterRemoval(keys, "x", new Set(["x"])), null);
  // The in-place completion lifecycle is shared by «Задачи» and «Сегодня» (useRecentCompletions).
  const list = read("src/components/v3/tasks/useRecentCompletions.ts");
  assert.match(read("src/components/v3/tasks/TaskQueueList.tsx"), /useRecentCompletions\(bands\)/u);
  // Each completion keeps its own deadline: a refresh or another completion does not extend it.
  assert.match(list, /const expiresAt = Date\.now\(\) \+ TASK_UNDO_MS;/u);
  assert.match(list, /Math\.max\(0, Math\.min\(\.\.\.live\.map\(\(entry\) => entry\.expiresAt\)\) - Date\.now\(\)\)/u);
  assert.match(list, /keepFocusInList\(new Set\(Object\.keys\(recent\)\)/u);
  assert.match(read("src/components/v3/tasks/TaskQueueRow.tsx"), /<button id=\{undoId\} type="button" data-queue-undo=""/u);
});

test("menus close on a choice, popovers carry a role, and a fast double press sends one command", () => {
  const menu = read("src/components/v3/queue/FilterMenu.tsx");
  assert.match(menu, /onClick=\{\(\) => document\.getElementById\(popoverId\)\?\.hidePopover\(\)\}/u);
  assert.match(menu, /popover="auto"\s+style=\{popoverStyle\}\s+role="group"/u);
  assert.match(read("src/components/v3/queue/QueueKeyboardHelp.tsx"), /popover="auto"\s+style=\{popoverStyle\}\s+role="dialog"/u);
  const row = read("src/components/v3/tasks/TaskQueueRow.tsx");
  assert.match(row, /popover="auto" style=\{menu\.popoverStyle\} role="group"/u);
  assert.match(row, /<Link href=\{moveHref\} scroll=\{false\} onClick=\{\(\) => document\.getElementById\(menu\.popoverId\)\?\.hidePopover\(\)\}/u);
  // `pending` changes only after a render; the lock is synchronous.
  assert.equal(row.match(/if \(busy\.current\) return;\s+busy\.current = true;/gu)?.length, 3, "complete, postpone and undo");
  assert.match(read("src/components/v3/queue/QueueFieldPopover.tsx"), /if \(busy\.current\) return;[\s\S]*busy\.current = true;[\s\S]*await onSubmit\(value\)/u);
});

test("a deep-linked selected row is scrolled into view only when it is hidden", () => {
  // Below the fold, or under the sticky band header: reveal.
  assert.equal(rowNeedsReveal({ top: 1040, bottom: 1093 }, 900), true);
  assert.equal(rowNeedsReveal({ top: 20, bottom: 73 }, 900), true);
  // Fully visible: a click on the row never moves the list.
  assert.equal(rowNeedsReveal({ top: 460, bottom: 513 }, 900), false);
  assert.equal(rowNeedsReveal({ top: 48, bottom: 900 }, 900), false);
  const hook = read("src/components/v3/queue/useQueueKeyboard.ts");
  assert.match(hook, /if \(openKey !== null\) \{\s*revealQueueRow\(openKey\);/u);
  assert.match(hook, /rowNeedsReveal\(row\.getBoundingClientRect\(\), window\.innerHeight\)[\s\S]*row\.scrollIntoView\(\{ block: "center" \}\)/u);
});

test("a folded assignee is marked «исп.» and shortened, never read as the student or the source", () => {
  assert.equal(shortPersonName("Айгүл Осмонова"), "Айгүл О.");
  assert.equal(shortPersonName("  Эрмек   Токтосунов "), "Эрмек Т.");
  assert.equal(shortPersonName("Мадина"), "Мадина");
  assert.equal(shortPersonName("Администратор (синтетический)"), "Администратор (синтетический)");
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

test("a partial read never says there are no tasks: only the read part is empty", () => {
  // Review 25.09: the case queue arrives by due date without a state filter, so
  // past and closed tasks can fill the limit before today's are read.
  for (const [name, more] of [
    ["incomplete-empty", "/v3/tasks?window=2"],
    ["incomplete-empty-today", "/v3/tasks?due=today&amp;window=2"],
    ["incomplete-empty-search", "/v3/tasks?q=%D1%81%D1%82%D1%83%D0%B4%D0%B5%D0%BD%D1%82&amp;window=2"],
  ]) {
    const html = surfaces.get(name);
    assert.match(html, new RegExp(`data-testid="queue-empty"><p class="t-item text-fg">В прочитанной части списка ничего не найдено</p><a[^>]*href="${more.replaceAll("?", "\\?")}"[^>]*>Показать больше задач</a>`, "u"), name);
    assert.doesNotMatch(html, /Открытых задач нет|На сегодня задач нет|>Ничего не найдено<|Сузьте/u, name);
    assert.doesNotMatch(html, /Показаны не все задачи/u, `${name}: one message, not two`);
    assert.doesNotMatch(html, /tabular-nums text-fg-3">\d/u, `${name}: no numbers`);
  }
  // At the limit: only a lever that shrinks the cut-off server read, or nothing.
  assert.match(surfaces.get("incomplete-limit"), /Показаны не все задачи[^<]*<a[^>]*href="\/v3\/tasks\?due=today&amp;window=4">Показать мои задачи на сегодня<\/a>/u);
  const mineLimit = surfaces.get("incomplete-limit-mine");
  assert.match(mineLimit, /Показаны не все задачи: список больше, чем читается за один раз, и числа скрыты\.<\/p>/u);
  assert.doesNotMatch(mineLimit, /Сузьте|Показать больше задач/u);
  assert.match(surfaces.get("incomplete-limit-empty"),
    /В прочитанной части списка ничего не найдено<\/p><a[^>]*href="\/v3\/tasks\?due=today&amp;q=%D1%81%D1%82%D1%83%D0%B4%D0%B5%D0%BD%D1%82&amp;window=4"[^>]*>Показать задачи на сегодня<\/a>/u);
  // A complete read keeps its exact empty words.
  assert.match(surfaces.get("empty-today"), />На сегодня задач нет</u);
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
  assert.match(html, /<button id="[^"]+" type="button" aria-label="Завершить: Отправить партнёру пакет по весеннему набору"/u);
  const caseRow = html.slice(html.indexOf('data-queue-row="case:cccccccc-6666-4666-8666-000000000001"'));
  assert.match(caseRow, /popoverTarget="(queue-popover-[^"]+)"[^>]*aria-haspopup="dialog" aria-label="Завершить с результатом: Подтвердить подачу в UCSI"/u);
  assert.match(caseRow, /<label for="[^"]+" id="[^"]+" class="block t-label text-fg-2">Результат<\/label>/u);
  assert.match(caseRow, /<time dateTime="2026-09-20" class="block font-mono tabular-nums text-danger">20\.09<\/time><span class="flex min-h-6 items-center t-meta text-danger">прошёл<\/span>/u);
  // The assignee column is hidden in «Мои» and the status word only marks exceptions.
  assert.doesNotMatch(html, /в работе/u);
  assert.match(html, /· заблокирована/u);
  assert.match(html, /data-testid="task-quick-add"[\s\S]*placeholder="Новая задача…"/u);
  assert.doesNotMatch(html, /Сроки указаны по времени Бишкека/u);
  assert.doesNotMatch(html, /\bbg-accent\b/u, "the page itself has no solid red: «Создать задачу» lives in the top bar");
});

test("«Срок» is its own column right before the title, not at the far edge", () => {
  const mine = surfaces.get("mine-default");
  const row = mine.slice(mine.indexOf('data-queue-row="case:cccccccc-6666-4666-8666-000000000001"'));
  assert.match(row, /^[^>]*class="relative grid grid-cols-\[2\.75rem_minmax\(0,1fr\)_2\.75rem\] [^"]*@min-\[32rem\]:grid-cols-\[2\.75rem_7rem_minmax\(0,1fr\)_2\.75rem\] hover:bg-surface/u);
  // DOM order = visual order: circle, date column, then the title link.
  assert.match(row, /^[^>]*><div class="flex">[\s\S]*?<\/div><p class="hidden self-start pt-1 t-body-compact @min-\[32rem\]:block"><time [^>]*>20\.09<\/time>[\s\S]*?<\/p><div class="min-w-0 py-0\.5"><a data-queue-open=""/u);
  // The narrow meta line leads with the same date.
  assert.match(row, /<p class="flex min-h-6 min-w-0 items-center[^"]*"><span class="shrink-0 @min-\[32rem\]:hidden"><span class="text-danger"><time dateTime="2026-09-20" class="font-mono tabular-nums">20\.09<\/time> прошёл<\/span> ·<\/span>/u);
  const team = surfaces.get("team-view");
  assert.match(team, /@3xl:grid-cols-\[2\.75rem_7rem_minmax\(0,1fr\)_minmax\(0,11rem\)_2\.75rem\]/u);
});

test("the assignee is marked wherever it has no column of its own", () => {
  const team = surfaces.get("team-view");
  const row = team.slice(team.indexOf('data-queue-row="case:cccccccc-6666-4666-8666-000000000001"'), team.indexOf('data-queue-row="staff:bbbbbbbb-5555-4555-8555-000000000007"'));
  // 32–48rem (panel open beside the list): «исп.» and a short name inside the meta line.
  assert.match(row, /<span class="hidden min-w-0 shrink-\[0\.5\] truncate @min-\[32rem\]:inline @3xl:hidden" title="Исполнитель: Айгүл Осмонова">· <span aria-hidden="true">исп\. Айгүл О\.<\/span><span class="sr-only">исполнитель Айгүл Осмонова<\/span><\/span>/u);
  // Phone: its own line with the full name.
  assert.match(row, /<p class="truncate pb-1 t-meta text-fg-2 @min-\[32rem\]:hidden" title="Исполнитель: Айгүл Осмонова"><span aria-hidden="true">исп\.<\/span><span class="sr-only">исполнитель<\/span> Айгүл Осмонова<\/p>/u);
  // ≥48rem: its own column.
  assert.match(row, /<p class="hidden truncate t-body-compact text-fg-2 @3xl:block" title="Айгүл Осмонова">Айгүл Осмонова<\/p>/u);
  // «Мои» shows no assignee at all.
  assert.doesNotMatch(surfaces.get("mine-default"), /исп\./u);
});

test("the student name links to the case only for a mouse on a wide screen", () => {
  const row = surfaces.get("mine-default");
  const caseRow = row.slice(row.indexOf('data-queue-row="case:cccccccc-6666-4666-8666-000000000001"'));
  assert.match(caseRow, /<a title="Тимур Абдылдаев" class="relative z-10 hidden h-6 min-w-0 items-center [^"]*md:pointer-fine:flex" href="\/v3\/profile\?case=dddddddd-2222-4222-8222-000000000001">/u);
  assert.match(caseRow, /<span class="min-w-0 truncate md:pointer-fine:hidden">Тимур Абдылдаев<\/span>/u);
  // Everywhere else the whole row opens the task; the panel carries «Открыть дело».
  assert.match(surfaces.get("team-panel"), />Открыть дело<\/a>/u);
});

test("closed tasks label their bare date as «срок»", () => {
  const done = surfaces.get("done-view");
  assert.match(done, /<time dateTime="2026-09-19" class="block font-mono tabular-nums text-fg">19\.09<\/time><span class="flex min-h-6 items-center t-meta text-fg-3">срок<\/span>/u);
  assert.match(done, /<span class="shrink-0 @min-\[32rem\]:hidden"><span>срок <time dateTime="2026-09-19" class="font-mono tabular-nums">19\.09<\/time><\/span> ·<\/span>/u);
  assert.doesNotMatch(done, /прошёл/u, "a closed task is never overdue");
});

test("the composer's optional sections use the drawn chevron, not the browser marker", () => {
  const summaries = [...surfaces.get("composer").matchAll(/<summary class="([^"]+)">([^<]+)<svg[^>]*class="([^"]+)"/gu)];
  assert.deepEqual(summaries.map((match) => match[2]), ["Студент/дело · необязательно", "Описание и приоритет"]);
  for (const [, summaryClass, , iconClass] of summaries) {
    assert.match(summaryClass, /\blist-none\b/u);
    assert.match(summaryClass, /\[&amp;::-webkit-details-marker\]:hidden/u);
    assert.match(summaryClass, /\bt-label\b/u);
    assert.doesNotMatch(summaryClass, /\btext-sm\b/u);
    assert.match(iconClass, /group-open:rotate-180/u);
  }
  assert.match(surfaces.get("composer"), /<details class="group"><summary/u);
  // The panel's «Перенести или передать» chevron turns too: `group` sits on <details>.
  assert.match(surfaces.get("team-panel"), /<details class="group border-t border-border pt-2"><summary/u);
});

test("the staff panel reads Описание, then Результаты, then the folded move form", () => {
  const panel = surfaces.get("team-panel-staff").slice(surfaces.get("team-panel-staff").indexOf("<dialog"));
  const order = ["aria-label=\"Описание\"", "aria-label=\"Результаты\"", ">Перенести или передать"].map((marker) => panel.indexOf(marker));
  assert.ok(order.every((index) => index > 0), "every section is present");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(panel, /Первый вариант отправлен руководителю/u);
  const list = surfaces.get("team-panel-staff");
  assert.match(list.slice(list.indexOf('data-queue-row="staff:bbbbbbbb-5555-4555-8555-000000000002"')), /^[^>]*class="[^"]*\bbg-surface-2\b/u);
});

test("the loading skeleton keeps the date column before the title", () => {
  const skeleton = read("src/components/v3/queue/QueueStates.tsx");
  assert.match(skeleton, /<span className="hidden w-28 shrink-0 sm:block"><SkeletonBlock className="h-3\.5 w-12 rounded-nav" \/><\/span>\s*<div className="min-w-0 flex-1 space-y-1\.5">/u);
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
  assert.match(panel, /<h2 id="[^"]+" tabindex="-1" data-queue-heading="" class="t-record-title/u);
  // The script-focused heading names the record for a screen reader without a red focus frame.
  assert.match(read("src/app/(v3)/v3.css"), /\.v3-world \[data-queue-heading\]:focus-visible \{\s*outline: none;/u);
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
  assert.match(surfaces.get("done-view"), /<span class="sr-only">выполнена<\/span>/u, "the check mark is announced, not only drawn");
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
