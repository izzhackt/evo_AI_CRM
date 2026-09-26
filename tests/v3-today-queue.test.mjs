import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { salesDynamicsCarry, salesDynamicsHref } from "../src/lib/sales-register-navigation.ts";
import { salesBoardFunnel } from "../src/lib/v3/sales-board-funnel.ts";
import {
  TODAY_BANDS,
  TODAY_UNCOUNTED,
  buildTodayQueue,
  todayChatItems,
  todayDateLabel,
  todayHandoffItems,
  todayLeadItems,
  todayRequestItems,
  todayStudentItems,
  todayTaskItems,
  todayWhen,
} from "../src/lib/v3/today-queue.ts";
import { TodaySourceDenied, readTodayQueue, todayAccess } from "../src/lib/v3/today-source.ts";

/**
 * «Сегодня» (Э3, 26.09.2026): одна очередь из существующих чтений. Логика
 * источников, групп, слияния и прав проверяется напрямую; разметка —
 * настоящим рендером (tests/e2e/today-static-render.cjs --json) в отдельном
 * node-процессе. Это не живая проверка Supabase, прав или данных.
 */

// Суббота 26.09.2026, 10:00 по Бишкеку.
const NOW = new Date("2026-09-26T04:00:00.000Z");
const TODAY = "2026-09-26";
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const OTHER = "aaaaaaaa-1111-4111-8111-000000000002";
const uuid = (prefix, n) => `${prefix}-2222-4222-8222-${String(n).padStart(12, "0")}`;

const staffTask = (n, fields) => ({
  id: uuid("bbbbbbbb", n), organizationId: ORG, creatorMembershipId: ME, creatorDisplayName: "Я",
  assigneeMembershipId: fields.assignee ?? ME, assigneeDisplayName: "Я", title: fields.title ?? `Рабочая ${n}`, description: null,
  status: fields.status ?? "open", priority: "normal", dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null, version: "1",
  sourceMessageId: null, createdAt: "2026-09-20T05:00:00.000Z", updatedAt: "2026-09-20T05:00:00.000Z",
});
const caseTask = (n, fields) => ({
  sortAt: "2026-09-20T00:00:00+06:00", organizationId: ORG, caseTaskId: uuid("cccccccc", n), version: "1",
  studentCaseId: uuid("dddddddd", n), studentDisplayName: `Студент ${n}`, caseState: "active", taskType: "follow_up",
  title: fields.title ?? `По студенту ${n}`, status: fields.status ?? "open", priority: "normal", dueOn: fields.dueOn ?? null,
  dueAt: fields.dueAt ?? null, studentVisible: false, assigneeMembershipId: fields.assignee ?? ME, assigneeDisplayName: "Я",
  createdAt: "2026-09-20T05:00:00.000Z", updatedAt: "2026-09-20T05:00:00.000Z",
});
const caseRow = (n, fields) => {
  const step = fields.step ?? null;
  const due = step ? fields.due ?? null : null;
  return {
    studentCaseId: uuid("dddddddd", n), studentDisplayName: fields.name ?? `Студент ${n}`, state: fields.state ?? "active",
    admissionsDirection: "CN", targetCountry: null, targetDegree: null, pipelineStage: "documents", pipelineHidden: false,
    nextAction: step, nextActionDueOn: due, dueBand: fields.band, admissionsVersion: "1",
    currentCuratorMembershipId: fields.curator === undefined ? ME : fields.curator, currentCuratorDisplayName: null,
    isMine: (fields.curator === undefined ? ME : fields.curator) === ME, attentionFlags: fields.flags ?? [],
    overdueTaskCount: fields.overdueTasks ?? 0, documents: null, updatedAt: "2026-09-20T05:00:00.000000Z",
    cursor: `due|0|2026-09-20|${uuid("dddddddd", n)}`,
  };
};
const lead = (n, fields) => ({
  id: uuid("ffffffff", n), name: fields.name ?? `Лид ${n}`, stageKey: fields.stage ?? "contacting", source: fields.source ?? "website",
  nextAction: fields.action ?? null, nextActionAt: null, due: fields.due ?? "none", stageAgeDays: fields.age === undefined ? 1 : fields.age, latestNote: null, href: "",
  workflow: {
    leadId: uuid("ffffffff", n), currentOwnerMembershipId: fields.owner === undefined ? ME : fields.owner, currentOwnerDisplayName: null,
    stageKey: "contacting", nextActionText: fields.action ?? null, nextActionDueDate: fields.dueDate ?? null, workflowVersion: "1",
  },
});
const thread = (n, fields = {}) => ({
  studentCaseId: uuid("dddddddd", n), studentDisplayName: `Студент ${n}`, lastMessageSnippet: "…", lastMessageAt: fields.at ?? "2026-09-25T12:00:00.000Z",
  lastMessageAuthorMembershipId: OTHER, awaitState: fields.state ?? "needs_reply", unread: true,
});
const read = (source, items, state = "complete") => ({ source, state, items });
const bandOf = (queue, band) => queue.bands.find((entry) => entry.band === band) ?? null;

test("tasks: my open tasks by the Bishkek day rule, within 14 days, nothing else", () => {
  const items = todayTaskItems({
    staff: [
      staffTask(1, { dueOn: "2026-09-24" }),
      staffTask(2, { dueAt: "2026-09-26T03:00:00.000Z" }), // сегодня 09:00 — время уже прошло
      staffTask(3, { dueAt: "2026-09-26T09:00:00.000Z" }),
      staffTask(4, { dueOn: "2026-10-10" }), // ровно 14 дней
      staffTask(5, { dueOn: "2026-10-11" }), // дальше горизонта
      staffTask(6, {}), // без срока
      staffTask(7, { dueOn: TODAY, status: "done" }),
    ],
    cases: [
      caseTask(1, { dueOn: TODAY }),
      caseTask(2, { dueOn: TODAY, assignee: OTHER }),
      caseTask(3, { dueOn: "2026-09-20", status: "cancelled" }),
    ],
    actorMembershipId: ME,
    now: NOW,
  });
  assert.deepEqual(items.map((item) => [item.key.split(":")[0], item.task.title, item.band]), [
    ["staff", "Рабочая 1", "overdue"],
    ["staff", "Рабочая 2", "overdue"],
    ["staff", "Рабочая 3", "today"],
    ["staff", "Рабочая 4", "upcoming"],
    ["case", "По студенту 1", "today"],
  ]);
  const caseItem = items.at(-1);
  assert.equal(caseItem.key, `case:${uuid("cccccccc", 1)}`, "the row key is the «Задачи» row key");
  assert.equal(caseItem.openHref, `/v3/tasks?task=${uuid("cccccccc", 1)}&kind=case&case=${uuid("dddddddd", 1)}`);
  assert.deepEqual(caseItem.who, { name: "Студент 1", href: `/v3/profile?case=${uuid("dddddddd", 1)}&tab=overview` });
  assert.equal(items[0].openHref, `/v3/tasks?task=${uuid("bbbbbbbb", 1)}`);
  assert.equal(items[0].who, null);
  assert.throws(() => todayTaskItems({ staff: [staffTask(1, {}), staffTask(1, {})], cases: [], actorMembershipId: ME, now: NOW }), /duplicate/u);
});

test("students: one row per case in its most urgent band; the step date only for a step reason", () => {
  const items = todayStudentItems([
    caseRow(1, { step: "Апостиль", due: "2026-09-23", band: "overdue" }),
    caseRow(2, { step: "Позвонить", due: TODAY, band: "today" }),
    caseRow(3, { band: "no_step" }),
    caseRow(4, { step: "Пакет", due: "2026-10-02", band: "later" }),
    caseRow(5, { step: "Без даты", band: "undated" }),
    caseRow(6, { step: "Далеко", due: "2026-10-20", band: "later" }),
    caseRow(7, { step: "Решение", due: "2026-09-30", band: "later", flags: ["overdue"] }),
    caseRow(8, { step: "Чужое", due: "2026-09-20", band: "overdue", curator: OTHER }),
    caseRow(9, { step: "Задачи", due: "2026-09-30", band: "later", flags: ["overdue"], overdueTasks: 2 }),
  ], TODAY);
  assert.deepEqual(items.map((item) => [item.title, item.band, item.reason, item.due?.dueOn ?? null]), [
    ["Апостиль", "overdue", "шаг просрочен", "2026-09-23"],
    ["Позвонить", "today", "шаг на сегодня", TODAY],
    ["Задать следующий шаг", "no_step", "шаг не задан", null],
    ["Пакет", "upcoming", "следующий шаг", "2026-10-02"],
    // Просроченный дедлайн (флаг без просроченных задач): дата шага не выдаётся за срок дедлайна.
    ["Решение", "overdue", "дедлайн просрочен", null],
    ["Задачи", "upcoming", "следующий шаг", "2026-09-30"],
  ]);
  assert.equal(items[0].openHref, `/v3/profile?view=mine&open=${uuid("dddddddd", 1)}`);
});

test("handoffs: only my acceptance, and «нужен куратор» only for those who assign curators", () => {
  const rows = [
    caseRow(1, { band: "no_step", state: "pending", flags: ["awaiting_ack"] }),
    caseRow(2, { band: "no_step", state: "pending", flags: ["awaiting_ack"], curator: OTHER }),
    caseRow(3, { band: "no_step", state: "pending", flags: ["needs_curator"], curator: null }),
    caseRow(4, { step: "Чужое", due: "2026-09-20", band: "overdue", flags: ["overdue"], curator: OTHER }),
  ];
  assert.deepEqual(todayHandoffItems(rows, { coverage: false }).map((item) => [item.title, item.reason]), [["Принять дело", "ждёт принятия"]]);
  const coverage = todayHandoffItems(rows, { coverage: true });
  assert.deepEqual(coverage.map((item) => [item.title, item.reason, item.openHref]), [
    ["Принять дело", "ждёт принятия", `/v3/profile?view=needs_action&open=${uuid("dddddddd", 1)}`],
    ["Назначить куратора", "нужен куратор", `/v3/profile?view=needs_curator&open=${uuid("dddddddd", 3)}`],
  ]);
  assert.ok(coverage.every((item) => item.band === "waiting"));
});

test("leads and requests: working stages only, the board's due words, unowned requests", () => {
  const leads = todayLeadItems([
    lead(1, { action: "Перезвонить", due: "overdue", dueDate: "2026-09-24" }),
    lead(2, { action: "Договор", due: "today", dueDate: TODAY }),
    lead(3, {}),
    lead(4, { action: "Без даты" }),
    lead(5, { action: "Встреча", due: "later", dueDate: "2026-10-01" }),
    lead(6, { action: "Далеко", due: "later", dueDate: "2026-10-30" }),
    lead(7, { stage: "handed_off", due: "overdue", dueDate: "2026-09-01", action: "Старое" }),
  ], TODAY);
  assert.deepEqual(leads.map((item) => [item.title, item.band, item.reason]), [
    ["Перезвонить", "overdue", "действие просрочено"],
    ["Договор", "today", "действие на сегодня"],
    ["Назначить следующее действие", "no_step", "действие не назначено"],
    ["Без даты", "no_step", "срок не назначен"],
    ["Встреча", "upcoming", "следующее действие"],
  ]);
  assert.equal(leads[0].openHref, `/v3/pipeline?lead=${uuid("ffffffff", 1)}`);
  assert.equal(leads[0].who.href, `/v3/profile?id=${uuid("ffffffff", 1)}`);
  const requests = todayRequestItems([
    lead(8, { stage: "new", owner: null, source: "website" }),
    lead(9, { stage: "qualified", owner: null, source: "unknown_source" }),
    lead(10, { stage: "new", owner: OTHER }),
    lead(11, { stage: "handed_off", owner: null }),
  ]);
  assert.deepEqual(requests.map((item) => [item.title, item.reason, item.band]), [
    ["Новая заявка", "нет ответственного · сайт", "waiting"],
    // Неизвестный ключ источника не выводится сырым.
    ["Лид без ответственного", "нет ответственного", "waiting"],
  ]);
  // «Когда» у заявки — только слово из дней на этапе «Новый»; даты чтение не даёт, и она не выдумывается.
  assert.deepEqual(requests.map((item) => item.waitingDays), [1, null], "days in «Новый» only: a later stage's age is not time without an owner");
  assert.deepEqual(todayWhen(requests[0], NOW), { dateTime: null, text: null, word: "ждёт 1 дн", overdue: false });
  assert.equal(todayWhen(requests[1], NOW), null);
  const [fresh] = todayRequestItems([lead(12, { stage: "new", owner: null, age: 0 })]);
  assert.equal(todayWhen(fresh, NOW).word, "сегодня");
  assert.equal(todayRequestItems([lead(13, { stage: "new", owner: null, age: null })])[0].waitingDays, null);
});

test("chats: the «Нужен ответ» state of the read, waiting since the last message", () => {
  const items = todayChatItems([thread(1, { at: "2026-09-22T08:30:00.000Z" }), thread(2, { state: "awaiting_student" })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].openHref, `/v3/messages?case=${uuid("dddddddd", 1)}&queue=needs_reply`);
  assert.deepEqual(todayWhen(items[0], NOW), { dateTime: "2026-09-22T08:30:00.000Z", text: "22.09", word: "4 дн назад", overdue: false });
  assert.deepEqual(todayWhen({ due: { dueOn: "2026-09-24", dueAt: null }, since: null }, NOW), { dateTime: "2026-09-24", text: "24.09", word: "прошёл", overdue: true });
  assert.equal(todayWhen({ due: null, since: null }, NOW), null);
});

test("bands follow urgency; one case from two reads is one row in its most urgent band", () => {
  const mine = todayStudentItems([caseRow(1, { step: "Апостиль", due: "2026-09-23", band: "overdue" })], TODAY);
  const handoffs = todayHandoffItems([caseRow(1, { band: "no_step", flags: ["awaiting_ack"] })], { coverage: false });
  const queue = buildTodayQueue([
    read("students", mine),
    read("handoffs", handoffs),
    read("chats", todayChatItems([thread(5, { at: "2026-09-25T00:00:00.000Z" }), thread(6, { at: "2026-09-20T00:00:00.000Z" })])),
    read("leads", todayLeadItems([lead(1, {}), lead(2, { action: "Встреча", due: "later", dueDate: "2026-09-29" })], TODAY)),
  ], NOW);
  assert.deepEqual(queue.bands.map((band) => band.band), ["overdue", "waiting", "no_step", "upcoming"]);
  assert.deepEqual(TODAY_BANDS, ["overdue", "today", "waiting", "no_step", "upcoming"]);
  const overdue = bandOf(queue, "overdue");
  assert.equal(overdue.items.length, 1);
  assert.equal(overdue.items[0].reason, "шаг просрочен · ждёт принятия");
  assert.equal(bandOf(queue, "overdue").label, "Просрочено");
  assert.equal(bandOf(queue, "overdue").danger, true);
  // Ждущие дольше всех — первыми.
  assert.deepEqual(bandOf(queue, "waiting").items.map((item) => item.key), [`chat:${uuid("dddddddd", 6)}`, `chat:${uuid("dddddddd", 5)}`]);
  // Заявка встаёт по дню прихода среди переписок: 3 дня назад — после сообщения 20.09, раньше вчерашней заявки и сообщения 25.09.
  const mixed = buildTodayQueue([
    read("chats", todayChatItems([thread(5, { at: "2026-09-25T00:00:00.000Z" }), thread(6, { at: "2026-09-20T00:00:00.000Z" })])),
    read("requests", todayRequestItems([lead(20, { stage: "new", owner: null, age: 1 }), lead(21, { stage: "new", owner: null, age: 3 })])),
  ], NOW);
  assert.deepEqual(bandOf(mixed, "waiting").items.map((item) => item.key), [
    `chat:${uuid("dddddddd", 6)}`, `lead:${uuid("ffffffff", 21)}`, `lead:${uuid("ffffffff", 20)}`, `chat:${uuid("dddddddd", 5)}`,
  ]);
  assert.equal(bandOf(queue, "upcoming").label, "Ближайшие 14 дней");
  assert.equal(buildTodayQueue([read("tasks", [])], NOW).bands.length, 0, "empty bands are not drawn");
  assert.throws(() => buildTodayQueue([read("tasks", []), read("tasks", [])], NOW), /twice/u);
});

test("no invented numbers: a band counts only when every read writing into it is complete", () => {
  const tasks = todayTaskItems({ staff: [staffTask(1, { dueOn: "2026-09-24" }), staffTask(2, { dueOn: TODAY })], cases: [], actorMembershipId: ME, now: NOW });
  const chats = todayChatItems([thread(1)]);
  const requests = todayRequestItems([lead(1, { stage: "new", owner: null })]);
  const complete = buildTodayQueue([read("tasks", tasks), read("requests", requests)], NOW);
  assert.deepEqual(complete.bands.map((band) => [band.band, band.count, band.note]), [["overdue", 1, null], ["today", 1, null], ["waiting", 1, null]]);
  assert.equal(bandOf(complete, "today").label, "Сегодня · сб 26.09");
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.notices, []);

  // Неполные задачи гасят числа только своих групп; «Ждут ответа» остаётся с числом.
  const partial = buildTodayQueue([read("tasks", tasks, "partial"), read("requests", requests)], NOW);
  assert.deepEqual(partial.bands.map((band) => [band.band, band.count]), [["overdue", null], ["today", null], ["waiting", 1]]);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.notices, [{
    source: "tasks", kind: "partial", text: "Задачи прочитаны не полностью: показана прочитанная часть, числа скрыты.",
    link: { label: "Все задачи", href: "/v3/tasks" },
  }]);

  // Ошибка источника — на месте и с «Повторить»; строки остальных источников остаются.
  const failed = buildTodayQueue([{ source: "tasks", state: "error" }, read("students", todayStudentItems([caseRow(1, { step: "Шаг", due: TODAY, band: "today" })], TODAY)), read("requests", requests)], NOW);
  assert.deepEqual(failed.bands.map((band) => [band.band, band.count, band.items.length]), [["today", null, 1], ["waiting", 1, 1]]);
  assert.deepEqual(failed.notices[0], { source: "tasks", kind: "error", text: "Задачи не загрузились.", link: { label: "Повторить", href: "/v3/main" } });
  assert.equal(failed.applicable, true);

  // «Нужен ответ» не снимается ответом сотрудника (разбор 26.09): число группы с перепиской было бы
  // завышенным — его нет и при полном чтении, а группа говорит почему. Строки остаются.
  const withChats = buildTodayQueue([read("tasks", tasks), read("requests", requests), read("chats", chats)], NOW);
  assert.deepEqual(bandOf(withChats, "waiting").count, null);
  assert.equal(bandOf(withChats, "waiting").items.length, 2);
  assert.equal(bandOf(withChats, "waiting").note, "Без числа: часть переписок «Нужен ответ» может быть уже отвечена.");
  assert.equal(bandOf(withChats, "waiting").note, TODAY_UNCOUNTED.chats);
  assert.equal(bandOf(withChats, "overdue").count, 1, "other bands keep their numbers");
  assert.equal(withChats.complete, true, "rows are all read: «На сегодня всё» is not blocked by the missing number");
  // Неполное чтение уже названо над очередью: у группы без числа своей строки нет.
  const partialChats = buildTodayQueue([read("chats", chats, "partial")], NOW);
  assert.deepEqual([bandOf(partialChats, "waiting").count, bandOf(partialChats, "waiting").note], [null, null]);
  // Пустые переписки число не гасят.
  assert.equal(bandOf(buildTodayQueue([read("requests", requests), read("chats", [])], NOW), "waiting").count, 1);
});

test("denied and preview sources name themselves without hiding the numbers the role can read", () => {
  const queue = buildTodayQueue([
    read("tasks", todayTaskItems({ staff: [staffTask(1, { dueOn: TODAY })], cases: [], actorMembershipId: ME, now: NOW })),
    { source: "students", state: "denied" },
    { source: "leads", state: "preview" },
    { source: "requests", state: "preview" },
  ], NOW);
  assert.equal(bandOf(queue, "today").count, 1);
  assert.equal(queue.complete, true);
  assert.deepEqual(queue.notices.map((notice) => [notice.source, notice.kind, notice.text, notice.link]), [
    ["students", "denied", "Очередь студентов недоступна вашей роли.", null],
    // Лиды и заявки — одно чтение доски: при просмотре роли одна строка.
    ["leads", "preview", "При просмотре роли лиды и заявки не показываются.", null],
  ]);
  const none = buildTodayQueue([{ source: "leads", state: "preview" }, { source: "requests", state: "preview" }], NOW);
  assert.equal(none.applicable, false);
});

test("«На сегодня всё» only after complete reads; the nearest due date comes from the next 14 days", () => {
  const upcoming = todayLeadItems([lead(1, { action: "Встреча", due: "later", dueDate: "2026-10-01" }), lead(2, { action: "Позже", due: "later", dueDate: "2026-10-05" })], TODAY);
  const done = buildTodayQueue([read("tasks", []), read("leads", upcoming)], NOW);
  assert.equal(done.actionEmpty, true);
  assert.equal(done.complete, true);
  assert.deepEqual(done.nearest, { day: "2026-10-01", weekday: "чт", date: "01.10" });
  assert.equal(bandOf(done, "upcoming").count, 2);
  const nothing = buildTodayQueue([read("tasks", [])], NOW);
  assert.equal(nothing.actionEmpty, true);
  assert.equal(nothing.nearest, null);
  // Пустое неполное чтение — не «всё»: экран говорит о прочитанной части.
  const unknown = buildTodayQueue([read("tasks", [], "partial")], NOW);
  assert.equal(unknown.actionEmpty, true);
  assert.equal(unknown.complete, false);
});

const actor = (fields) => ({
  authUserId: ME, profileId: ME, membershipId: ME, organizationId: ORG, displayName: "Сотрудник", platformAccessVersion: 1,
  email: "synthetic@example.invalid", presentationRole: null, systemRole: "staff", assignments: [], permissionKeys: [], ...fields,
});
const ADMISSIONS = ["case.read.full", "profile.read.full", "task.manage", "task.create", "staff.task.read", "staff.task.complete"];
const SALES = ["lead.read", "lead.sales.workflow.manage", "sales.register.read", "case.read.summary", "staff.task.read"];

test("role scoping: each role reads only its own sources", () => {
  assert.deepEqual(todayAccess(actor({ systemRole: "admin" })), {
    sources: ["tasks", "students", "handoffs", "leads", "requests", "chats"], coverage: true, preview: false,
  });
  assert.deepEqual(todayAccess(actor({ permissionKeys: ADMISSIONS })), {
    sources: ["tasks", "students", "handoffs", "chats"], coverage: false, preview: false,
  });
  assert.equal(todayAccess(actor({ permissionKeys: [...ADMISSIONS, "case.curator.assign"] })).coverage, true);
  assert.deepEqual(todayAccess(actor({ permissionKeys: SALES })), { sources: ["tasks", "leads", "requests"], coverage: false, preview: false });
  assert.deepEqual(todayAccess(actor({ permissionKeys: ["sales.register.read"] })).sources, [], "report-only role has no queue");
  // Просмотр роли «Продажи» у Admin: права роли, а не Admin; назначение кураторов не показывается.
  assert.deepEqual(todayAccess(actor({ systemRole: "admin", presentationRole: "sales" })), {
    sources: ["tasks", "leads", "requests"], coverage: false, preview: true,
  });
  assert.deepEqual(todayAccess(actor({ systemRole: "admin", presentationRole: "admissions" })).sources, ["tasks", "students", "handoffs", "chats"]);
});

function fakeReaders(overrides = {}) {
  const calls = [];
  return {
    calls,
    readers: {
      async listStaffTasks(_actor, options) { calls.push(["staff", options]); return { rows: [staffTask(1, { dueOn: TODAY })], nextCursor: null }; },
      async listCaseTasks(_actor, options) { calls.push(["case", options]); return { rows: [], nextCursor: null }; },
      async readStudentCaseQueue(_actor, request) {
        calls.push(["students", request]);
        return { view: request.view, sort: "due", today: TODAY, rows: [], nextCursor: null };
      },
      async readLeads(_actor, assignment) { calls.push(["leads", assignment]); return { leads: [], truncated: false }; },
      async readChats() { calls.push(["chats"]); return { rows: [], truncated: false }; },
      ...overrides,
    },
  };
}

test("readTodayQueue: existing reads with their own limits, each failing on its own", async () => {
  const admin = actor({ systemRole: "admin" });
  const studentRequests = [];
  const { readers, calls } = fakeReaders({
    async readChats() { throw new Error("offline"); },
    async readStudentCaseQueue(_actor, request) {
      studentRequests.push(request);
      if (request.view === "needs_action") throw new TodaySourceDenied();
      return { view: request.view, sort: "due", today: TODAY, rows: [], nextCursor: "due|0|2026-09-26|x" };
    },
  });
  const { reads } = await readTodayQueue(admin, { now: NOW, readers });
  assert.deepEqual(reads.map((entry) => [entry.source, entry.state]), [
    ["tasks", "complete"], ["students", "partial"], ["handoffs", "denied"], ["leads", "complete"], ["requests", "complete"], ["chats", "error"],
  ]);
  assert.deepEqual(calls.find(([kind]) => kind === "staff")[1], { view: "mine", status: "active", cursor: null });
  assert.deepEqual(calls.find(([kind]) => kind === "case")[1], { pageSize: 100, cursor: null, dueTo: "2026-10-10" });
  assert.deepEqual(calls.filter(([kind]) => kind === "leads").map(([, assignment]) => assignment).sort(), ["mine", "unassigned"]);
  assert.deepEqual(studentRequests.map((request) => request.view).sort(), ["mine", "needs_action"]);
  assert.ok(studentRequests.every((request) => request.sort === "due" && request.pageSize === 100));

  // Предел страниц — неполное чтение, а не тихо обрезанный список.
  let staffPages = 0;
  const endless = fakeReaders({ async listStaffTasks() { staffPages += 1; return { rows: [], nextCursor: { updatedAt: "2026-09-20T00:00:00.000Z", id: ME } }; } });
  const sales = await readTodayQueue(actor({ permissionKeys: SALES }), { now: NOW, readers: endless.readers });
  assert.deepEqual(sales.reads.map((entry) => [entry.source, entry.state]), [["tasks", "partial"], ["leads", "complete"], ["requests", "complete"]]);
  assert.equal(staffPages, 4, "the same 4-page limit as «Задачи»");
  assert.ok(!endless.calls.some(([kind]) => ["case", "students", "chats"].includes(kind)), "no read outside the role");

  // Просмотр роли: доска продаж не читается, её проекция просмотру отказывает.
  const preview = fakeReaders();
  const shown = await readTodayQueue(actor({ systemRole: "admin", presentationRole: "sales" }), { now: NOW, readers: preview.readers });
  assert.deepEqual(shown.reads.map((entry) => [entry.source, entry.state]), [["tasks", "complete"], ["leads", "preview"], ["requests", "preview"]]);
  assert.ok(!preview.calls.some(([kind]) => kind === "leads"));
});

test("the report funnel uses the board definition: a handed-off lead is «Переданы», never «Новый»", () => {
  const stages = [
    { key: "new", title: "Новый", gate: false, terminal: false },
    { key: "contacting", title: "Контакт", gate: false, terminal: false },
    { key: "handed_off", title: "Переданы", gate: false, terminal: true },
  ];
  const funnel = salesBoardFunnel({ leads: [{ stageKey: "handed_off" }, { stageKey: "contacting" }], truncated: false }, stages);
  assert.deepEqual(funnel, {
    status: "available", working: 1,
    stages: [{ key: "new", name: "Новый", value: 0 }, { key: "contacting", name: "Контакт", value: 1 }, { key: "handed_off", name: "Переданы", value: 1 }],
  });
  assert.deepEqual(salesBoardFunnel({ leads: [{ stageKey: "new" }], truncated: true }, stages), { status: "truncated" });
  assert.throws(() => salesBoardFunnel({ leads: [{ stageKey: "lost" }], truncated: false }, stages), /outside its stages/u);
});

test("«Динамика по дням» links keep the report period and filters and return to the section", () => {
  const query = { view: "sales", year: "2026", month: "9", q: "Анна", manager: "Иван & Co", record: "x", returnTo: "https://untrusted.invalid/" };
  assert.deepEqual(salesDynamicsCarry(query), { view: "sales", year: "2026", month: "9", q: "Анна", manager: "Иван & Co" });
  const week = new URL(salesDynamicsHref(query, { key: "week" }), "https://crm.test");
  assert.equal(week.pathname, "/v3/main");
  assert.equal(week.hash, "#sales-dynamics");
  assert.deepEqual(Object.fromEntries(week.searchParams), { view: "sales", year: "2026", month: "9", q: "Анна", manager: "Иван & Co", period: "week" });
  const custom = new URL(salesDynamicsHref({}, { key: "custom", from: "2026-09-01", to: "2026-09-10" }), "https://crm.test");
  assert.deepEqual(Object.fromEntries(custom.searchParams), { view: "sales", period: "custom", from: "2026-09-01", to: "2026-09-10" });
});

test("the page date names the Bishkek day in words", () => {
  assert.equal(todayDateLabel("2026-09-26"), "Суббота, 26 сентября");
  assert.equal(todayDateLabel("2026-10-01"), "Четверг, 1 октября");
});

const surfaces = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/today-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");

test("static render: the page root, the dated heading and one queue for Admin", () => {
  const html = surfaces.get("admin");
  assert.match(html, /^<main data-testid="v3-operational-dashboard"/u);
  assert.equal(html.match(/<h1\b/gu)?.length, 1);
  assert.match(html, /<h1 class="t-page-title[^"]*">Сегодня<\/h1><p class="t-meta mt-1 text-fg-3"><time dateTime="2026-09-26">Суббота, 26 сентября<\/time><\/p>/u);
  assert.doesNotMatch(html, /Главная|Рабочий обзор|Лиды за период|data-dashboard-card/u);
  const headers = [...html.matchAll(/<h2 id="today-band-[a-z_]+"[^>]*>(.*?)<\/h2>/gu)].map((match) => text(match[1]).trim());
  assert.deepEqual(headers, ["Просрочено · 5", "Сегодня · сб 26.09 · 4", "Ждут ответа", "Без следующего шага · 2", "Ближайшие 14 дней · 4"]);
  assert.match(html, /<\/h2><p class="[^"]*t-meta[^"]*">Без числа: часть переписок «Нужен ответ» может быть уже отвечена\.<\/p>/u);
  // Две доски: на телефоне короткие имена в строке заголовка, шире — полные; видимое слово и есть имя ссылки.
  assert.match(html, /aria-label="Доски"[\s\S]*href="\/v3\/pipeline"[^>]*><span class="sm:hidden">Продажи<\/span><span class="hidden sm:inline">Воронка продаж<\/span><\/a>[\s\S]*href="\/v3\/admissions-pipeline"[^>]*><span class="sm:hidden">Поступление<\/span><span class="hidden sm:inline">Воронка поступления<\/span><\/a>/u);
  // Красный — у просроченного срока, не у причины: причина всегда обычным текстом.
  const reasons = [...html.matchAll(/<span class="([^"]*)" data-today-reason="">([^<]*)<\/span>/gu)];
  assert.ok(reasons.length >= 10);
  assert.ok(reasons.every(([, cls]) => !/text-danger/u.test(cls)), "no reason is red");
  assert.ok(reasons.some(([, , word]) => word === "действие просрочено"));
  // Заявка: «ждёт 3 дн» — слово без даты; пришедшая сегодня — «сегодня».
  assert.match(html, /<span class="block text-fg-2">ждёт 3 дн<\/span>/u);
  // Строки «Сегодня» и задач — рамка фокуса всей строки.
  assert.equal(html.match(/<li data-queue-row="[^"]+" data-today-source="[^"]+" class="v3-queue-row /gu)?.length, html.match(/data-today-source="[a-z]+" class="/gu)?.length);
  // Составная причина — по части на слово: переносится целиком, без обрывка.
  assert.match(html, /data-today-reason="">нет ответственного<\/span><span [^>]*data-today-reason="">WhatsApp<\/span>/u);
  assert.match(html, /<li data-queue-row="staff:[^"]+" data-kind="staff" class="v3-queue-row /u);
  // Задача — настоящая строка «Задач»: круг завершения на месте.
  assert.match(html, /data-queue-row="staff:[^"]+" data-kind="staff"[\s\S]*?aria-label="Завершить: Отправить партнёру пакет по весеннему набору"/u);
  assert.match(html, /aria-label="Завершить с результатом: Записать на визу X1"/u);
  // Остальные строки — «Открыть» в существующую панель, покрывающее строку.
  assert.match(html, /<a data-queue-open="" aria-label="Открыть: Перезвонить после консультации"[^>]*href="\/v3\/pipeline\?lead=ffffffff-3333-4333-8333-000000000001"/u);
  assert.match(html, /<a data-queue-open="" aria-label="Открыть: Назначить куратора"[^>]*href="\/v3\/profile\?view=needs_curator&amp;open=dddddddd-2222-4222-8222-000000000012"/u);
  assert.match(html, /<a data-queue-open="" aria-label="Открыть: Ответить в переписке"[^>]*href="\/v3\/messages\?case=dddddddd-2222-4222-8222-000000000014&amp;queue=needs_reply"/u);
  // Срок — JetBrains Mono «ДД.ММ» и слово; «Переданы» и чужие дела в очередь не попадают.
  assert.match(html, /<time dateTime="2026-09-23" class="block font-mono tabular-nums text-danger">23\.09<\/time>/u);
  assert.doesNotMatch(html, /Нурлан Переданов|Кирилл Чужой|Проверить сроки подачи в Варшаве/u);
  // Сплошного красного на странице нет: главное действие — сама очередь.
  assert.doesNotMatch(html, /\bbg-accent\b/u);
});

test("static render: admissions and sales see only their own sources", () => {
  const admissions = surfaces.get("admissions");
  assert.doesNotMatch(admissions, /data-today-source="(?:leads|requests)"|Воронка продаж/u);
  assert.match(admissions, /data-today-source="chats"/u);
  assert.match(admissions, /Принять дело/u);
  assert.doesNotMatch(admissions, /Назначить куратора/u, "no curator assignment without case.curator.assign");
  const sales = surfaces.get("sales");
  assert.doesNotMatch(sales, /data-today-source="(?:students|handoffs|chats)"|Воронка поступления|Записать на визу X1/u);
  assert.match(sales, /Новая заявка/u);
  assert.match(sales, /data-today-reason="">нет ответственного<\/span><span [^>]*data-today-reason="">WhatsApp<\/span>/u);
});

test("static render: a failed source is named in place and only its bands lose their numbers", () => {
  const html = surfaces.get("partial");
  assert.match(html, /<div role="alert"[^>]*data-testid="today-notices"/u);
  assert.match(html, /data-today-notice="error" data-today-source="tasks"[^>]*><span class="text-danger">Задачи не загрузились\.<\/span><a [^>]*href="\/v3\/main"[^>]*>Повторить<\/a>/u);
  assert.match(html, /data-today-notice="partial" data-today-source="students"[\s\S]*?href="\/v3\/profile\?view=mine"[^>]*>Мои студенты<\/a>/u);
  const headers = [...html.matchAll(/<h2 id="today-band-[a-z_]+"[^>]*>(.*?)<\/h2>/gu)].map((match) => text(match[1]).trim());
  assert.deepEqual(headers, ["Просрочено", "Сегодня · сб 26.09", "Ждут ответа · 1", "Без следующего шага"]);
  assert.doesNotMatch(html, /На сегодня всё/u);
});

test("static render: an empty day says so only after complete reads, with the nearest date or the role's action", () => {
  const sales = surfaces.get("empty");
  assert.match(text(sales), /На сегодня всё Ближайший срок — чт 01\.10/u);
  assert.match(sales, /<time dateTime="2026-10-01" class="font-mono tabular-nums">01\.10<\/time>/u);
  assert.match(text(sales), /Ближайшие 14 дней · 1/u);
  const admissions = surfaces.get("empty-admissions");
  assert.match(admissions, /data-testid="queue-empty"[\s\S]*На сегодня всё[\s\S]*href="\/v3\/profile"[^>]*>Открыть студентов<\/a>/u);
  assert.doesNotMatch(admissions, /<h2 id="today-band-/u);
});

test("report: the period cohort and the board never share a bare «Переданы»", () => {
  const html = surfaces.get("report-dynamics");
  const board = html.indexOf('aria-labelledby="sales-dynamics-board"');
  assert.ok(board > 0, "the board funnel is its own section");
  const period = html.slice(html.indexOf('aria-labelledby="sales-dynamics-period"'), board);
  const current = html.slice(board);
  // Когорта периода — слова со словом области; «Переданы» без него — только колонка доски.
  assert.match(text(period), /Пришло лидов 12 Из них квалифицированы 5 Из них переданы 2/u);
  assert.doesNotMatch(period, />Переданы</u);
  assert.match(current, /<h3 id="sales-dynamics-board"[^>]*>Сейчас на доске<\/h3>/u);
  assert.equal(current.match(/>Переданы</gu)?.length, 1);
  // Легенда и подпись графика — те же слова когорты.
  assert.match(period, /Из них переданы<\/li>/u);
  assert.doesNotMatch(period, /Переданы: /u);
});

test("report: charts and funnel are ink; red stays with the page action", () => {
  const html = surfaces.get("report-dynamics");
  const dynamics = html.slice(html.indexOf('<details id="sales-dynamics"'));
  assert.doesNotMatch(dynamics, /var\(--accent\)|\bbg-accent\b|evo-trend-area|linearGradient/u);
  assert.match(dynamics, /preserveAspectRatio="none"/u);
  assert.ok((dynamics.match(/vector-effect="non-scaling-stroke"/gu)?.length ?? 0) >= 3, "lines keep their width at any chart width");
  // Выбранный период — общий «выбрано», а не свой красный.
  assert.match(dynamics, /aria-current="page" class="v3-choice [^"]*"[^>]*>Неделя<\/a>/u);
  // Записи отчёта — выше раздела; без выбранного периода раздел свёрнут.
  const collapsed = surfaces.get("report-collapsed");
  assert.ok(collapsed.indexOf('aria-label="Записи продаж"') < collapsed.indexOf('<details id="sales-dynamics"'));
  assert.match(collapsed, /<details id="sales-dynamics" class=/u);
  assert.match(html, /<details id="sales-dynamics" open="" class=/u);
});
