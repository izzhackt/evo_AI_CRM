// Переписки. Э5 (план редизайна 25.09.2026, запись PLAN_CHANGES 27.09):
// очереди с числами из того же чтения 234, видимый переключатель состояния
// (прежняя команда set_await), шаблоны ответа в поле ответа без отправки и
// следующая переписка в пустой правой части. Решение владельца 27.09.2026
// заменило один пункт «Переписки» с каналами: WhatsApp (`/v3/inbox`) — пункт
// «Продаж», «Переписка со студентами» (`/v3/messages`) — пункт
// «Поступления», у каждой страницы свой h1. Логика — чистые модули; разметка
// — из настоящих страниц через tests/e2e/conversations-static-render.cjs
// --json с синтетическими чтениями (живой Supabase и права сервера не
// проверяются).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  caseChatNextLine, caseChatWaitingWord, composeCaseChatQueue, oldestFirst, readCaseChatQueueWith,
} from "../src/components/v3/case-chat/case-chat-queue.ts";
import {
  insertReplySnippetWithinCodePointLimit, REPLY_MESSAGE_MAX_CODE_POINTS,
} from "../src/components/v3/reply-snippets/insert-reply-snippet.ts";
import {
  CASE_CHAT_BODY_LIMIT, CASE_CHAT_QUEUE_ORDER, caseChatHref, parseCaseChatQueue,
} from "../src/lib/platform-case-chat-contract.ts";
import { staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { decodeStaffNotifications } from "../src/lib/platform-staff-notifications-contract.ts";
import { buildV3Navigation, v3SectionTitle } from "../src/lib/v3/navigation.ts";
import { shellTabLabel, shellTabs } from "../src/lib/v3/shell-tabs.ts";
import { todayChatItems } from "../src/lib/v3/today-queue.ts";
import { staffRoleKeys } from "./e2e/staff-role-templates.cjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const STUDENT = "aaaaaaaa-1111-4111-8111-000000000099";
const READ_AT = "2026-09-27T06:00:00.000Z"; // 12:00 в Бишкеке
const caseId = (n) => `dddddddd-2222-4222-8222-${String(n).padStart(12, "0")}`;
const row = (n, state, at, fields = {}) => ({
  studentCaseId: caseId(n), studentDisplayName: `Студент ${n} (синтетика)`, lastMessageSnippet: at ? "текст" : null,
  lastMessageAt: at, lastMessageAuthorMembershipId: at ? fields.author ?? STUDENT : null, awaitState: state, unread: false,
});
// Страница «Все» как из чтения 234: от новых к старым, без сообщений — в конце.
const ALL = [
  row(1, "needs_reply", "2026-09-27T05:00:00.000Z"),
  row(2, "awaiting_student", "2026-09-26T10:00:00.000Z", { author: ME }),
  row(3, "needs_reply", "2026-09-25T08:00:00.000Z"),
  row(4, "none", "2026-09-20T07:00:00.000Z"),
  row(5, "needs_reply", null),
  row(6, "none", null),
];
const list = (rows, truncated = false) => ({ rows, truncated });
const names = (read) => read.list.rows.map((item) => item.studentCaseId.slice(-1));

// --- числа: только из полного чтения ------------------------------------------

test("counts come from the same read: a complete «Все» page gives both numbers and its queue rows", () => {
  const read = composeCaseChatQueue({ all: list(ALL) }, "needs_reply", READ_AT);
  assert.deepEqual(read.counts, { needs_reply: 3, awaiting_student: 1 });
  // Та же выборка, что у функции с p_await_state: без переписки (none) — не в очереди.
  assert.deepEqual(names(read), ["3", "1", "5"], "oldest first, no messages last");
  assert.equal(read.next.studentCaseId, caseId(3));
  assert.equal(read.readAt, READ_AT);
  assert.deepEqual(names(composeCaseChatQueue({ all: list(ALL) }, "awaiting_student", READ_AT)), ["2"]);
  assert.deepEqual(names(composeCaseChatQueue({ all: list(ALL) }, "all", READ_AT)), ["1", "2", "3", "4", "5", "6"], "«Все» keeps the read order");
});

test("no invented numbers: a truncated read shows no count, and a truncated queue is not re-sorted", () => {
  // «Все» обрезано (больше 200): очереди читаются сами; полная — с числом, обрезанная — без.
  const needsReply = list([row(1, "needs_reply", "2026-09-27T05:00:00.000Z"), row(3, "needs_reply", "2026-09-25T08:00:00.000Z")], true);
  const awaiting = list([row(2, "awaiting_student", "2026-09-26T10:00:00.000Z")]);
  const read = composeCaseChatQueue({ all: list(ALL, true), needsReply, awaitingStudent: awaiting }, "needs_reply", READ_AT);
  assert.deepEqual(read.counts, { needs_reply: null, awaiting_student: 1 });
  assert.equal(read.list, needsReply, "the truncated page stays in read order: its oldest rows were not read");
  assert.equal(read.next, null, "no «next» from an incomplete read");
  assert.equal(caseChatNextLine(read, ME, "").kind, "none", "no «Все ответы даны» without a count");
  // Без чтения очереди числа нет, а список этой очереди не подменяется «Всеми».
  assert.deepEqual(composeCaseChatQueue({ all: list(ALL, true) }, "all", READ_AT).counts, { needs_reply: null, awaiting_student: null });
  assert.throws(() => composeCaseChatQueue({ all: list(ALL, true) }, "needs_reply", READ_AT), /case_chat_queue_read_missing/u);
  // Пустая, но полная очередь — честный ноль.
  assert.deepEqual(composeCaseChatQueue({ all: list([]) }, "needs_reply", READ_AT).counts, { needs_reply: 0, awaiting_student: 0 });
});

test("the queue read asks for «Все» once and for each queue only when «Все» is truncated", async () => {
  const calls = [];
  const reader = (pages) => async (queue) => { calls.push(queue); return pages[queue]; };
  const complete = await readCaseChatQueueWith(reader({ all: list(ALL) }), "needs_reply", () => new Date(READ_AT));
  assert.deepEqual(calls, ["all"]);
  assert.deepEqual(complete.counts, { needs_reply: 3, awaiting_student: 1 });
  calls.length = 0;
  const partial = await readCaseChatQueueWith(reader({
    all: list(ALL, true), needs_reply: list([row(3, "needs_reply", "2026-09-25T08:00:00.000Z")]), awaiting_student: list([], true),
  }), "awaiting_student", () => new Date(READ_AT));
  assert.deepEqual(calls.sort(), ["all", "awaiting_student", "needs_reply"]);
  assert.deepEqual(partial.counts, { needs_reply: 1, awaiting_student: null });
  assert.equal(partial.next.studentCaseId, caseId(3));
  // Сервер — то же чтение 234 с тем же поиском, без нового SQL.
  const source = read("src/lib/v3/case-chat-source.ts");
  assert.match(source, /return readCaseChatQueueWith\(\(filter\) => readStaffCaseChatThreads\(actor, query, filter\), queue\);/u);
  assert.match(source, /rpc\("staff_case_chat_threads_v2"/u);
  assert.match(read("src/lib/platform-case-chat-actions.ts"), /const read = await readStaffCaseChatQueue\(authorization\.actor, query, queue\);\s*return \{ status: "ready", read \};/u);
});

test("oldest first: by last message ascending, no messages last, ties by case id", () => {
  const sorted = oldestFirst([row(2, "needs_reply", null), row(9, "needs_reply", "2026-09-25T08:00:00.000Z"), row(1, "needs_reply", "2026-09-25T08:00:00.000Z"), row(4, "needs_reply", "2026-09-20T00:00:00.000Z")]);
  assert.deepEqual(sorted.map((item) => item.studentCaseId.slice(-1)), ["4", "1", "9", "2"]);
});

test("«ждёт N» counts Bishkek days like «Сегодня», hours only within the same day", () => {
  assert.equal(caseChatWaitingWord("2026-09-25T08:00:00.000Z", READ_AT), "ждёт 2 дн");
  // 26.09 19:30 в Бишкеке → вчера, хотя прошло 16,5 ч.
  assert.equal(caseChatWaitingWord("2026-09-26T13:30:00.000Z", READ_AT), "ждёт 1 дн");
  assert.equal(caseChatWaitingWord("2026-09-27T01:00:00.000Z", READ_AT), "ждёт 5 ч");
  assert.equal(caseChatWaitingWord("2026-09-27T05:20:00.000Z", READ_AT), "ждёт меньше часа");
  assert.equal(caseChatWaitingWord(null, READ_AT), null);
  assert.equal(caseChatWaitingWord("not a date", READ_AT), null);
});

test("the empty pane: next thread with its wait, no wait on one's own last message, «Все ответы даны» only when fully read and unfiltered", () => {
  const read = composeCaseChatQueue({ all: list(ALL) }, "all", READ_AT);
  assert.deepEqual(caseChatNextLine(read, ME, ""), { kind: "next", row: ALL[2], waiting: "ждёт 2 дн" });
  const mine = composeCaseChatQueue({ all: list([row(7, "needs_reply", "2026-09-25T08:00:00.000Z", { author: ME })]) }, "all", READ_AT);
  assert.equal(caseChatNextLine(mine, ME, "").waiting, null, "a manual «Нужен ответ» after my own message is not the student waiting");
  const answered = composeCaseChatQueue({ all: list([row(2, "awaiting_student", "2026-09-26T10:00:00.000Z")]) }, "all", READ_AT);
  assert.equal(caseChatNextLine(answered, ME, "").kind, "all-answered");
  assert.equal(caseChatNextLine(answered, ME, "Студент").kind, "none", "with a search, zero speaks only of the matches");
});

test("the list opens on «Нужен ответ»; «Все» is an explicit ?queue=all and older links keep working", () => {
  assert.equal(parseCaseChatQueue(undefined), "needs_reply");
  assert.deepEqual(CASE_CHAT_QUEUE_ORDER, ["needs_reply", "awaiting_student", "all"]);
  assert.equal(caseChatHref("", "needs_reply"), "/v3/messages");
  assert.equal(caseChatHref("", "all"), "/v3/messages?queue=all");
  assert.equal(caseChatHref("", "awaiting_student", caseId(1)), `/v3/messages?case=${caseId(1)}&queue=awaiting_student`);
  for (const value of ["needs_reply", "awaiting_student", "all"]) assert.equal(parseCaseChatQueue(value), value);
  assert.equal(parseCaseChatQueue("none"), null);
});

// --- меню: два пункта в своих отделах, прежние права страниц -------------------

const preview = (role) => ({ systemRole: "admin", presentationRole: role, platformAccessVersion: 1, assignments: [], permissionKeys: [] });
const staff = (keys) => ({ systemRole: "staff", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: keys });
const menuOf = (actor, href = "/v3/main") => {
  const url = new URL(href, "https://conversations.test");
  const model = buildV3Navigation(actor, url.pathname, url.searchParams);
  const every = [...(model.home ? [model.home] : []), ...model.groups.flatMap((group) => group.links), ...model.common, ...(model.settings ? [model.settings] : [])];
  /** Где стоит пункт: отдел, «Общее» или null — пункта нет. */
  const place = (id) => model.groups.find((group) => group.links.some((link) => link.id === id))?.id
    ?? (model.common.some((link) => link.id === id) ? "common" : null);
  return { model, every, place };
};

test("menu per role: WhatsApp in «Продажи», «Переписка со студентами» in «Поступление», each behind its own route", () => {
  const cases = [
    // [кто, актёр, место WhatsApp, место переписки со студентами]
    ["Admin", preview(null), "sales", "admissions"],
    ["preview: Приёмная", preview("admissions"), null, "admissions"],
    ["preview: Продажи", preview("sales"), "sales", null],
    ["Admissions (173)", staff([...staffRoleKeys("admissions")]), null, "admissions"],
    ["Sales Manager (173)", staff([...staffRoleKeys("sales-manager")]), "sales", null],
    ["case reader without WhatsApp", staff(["case.read.full"]), null, "admissions"],
    // Правило D «Продаж»: без работы продаж WhatsApp не пункт меню, хотя маршрут открыт.
    ["WhatsApp reader without sales work", staff(["communication.read.full"]), null, null],
    ["WhatsApp reader with sales work", staff(["communication.read.full", "lead.sales.workflow.manage"]), "sales", null],
    ["team only", staff(["staff.task.read", "team.chat.general"]), null, null],
    ["no rights", staff([]), null, null],
  ];
  for (const [label, actor, whatsapp, students] of cases) {
    const { every, place } = menuOf(actor);
    assert.equal(place("inbox"), whatsapp, `${label}: WhatsApp`);
    assert.equal(place("messages"), students, `${label}: «Переписка со студентами»`);
    // Пункт есть — его страница открыта той же проверкой маршрута (`requireV3PageActor`).
    if (whatsapp) assert.ok(staffCanAccessRoute(actor, "/v3/inbox"), `${label}: /v3/inbox`);
    if (students) assert.ok(staffCanAccessRoute(actor, "/v3/messages"), `${label}: /v3/messages`);
    const inbox = every.find((link) => link.id === "inbox");
    const messages = every.find((link) => link.id === "messages");
    if (inbox) assert.deepEqual([inbox.label, inbox.href], ["WhatsApp", "/v3/inbox"], label);
    if (messages) assert.deepEqual([messages.label, messages.href], ["Переписка со студентами", "/v3/messages"], label);
    assert.equal(every.some((link) => ["Переписки", "Сообщения"].includes(link.label)), false, `${label}: no retired items`);
  }
  assert.equal(staffCanAccessRoute(staff(["communication.read.full"]), "/v3/inbox"), true, "the route itself is unchanged");
});

test("each page highlights its own item and names its own tab; old addresses and links land on their page", () => {
  for (const [href, id, title] of [
    ["/v3/messages", "messages", "Переписка со студентами"],
    ["/v3/messages?queue=all&case=x", "messages", "Переписка со студентами"],
    ["/v3/inbox", "inbox", "WhatsApp"],
    ["/v3/inbox?waiting=1", "inbox", "WhatsApp"],
  ]) {
    const { model } = menuOf(preview(null), href);
    assert.equal(model.activeId, id, href);
    assert.equal(model.groups.find((group) => group.active)?.id, id === "inbox" ? "sales" : "admissions", href);
    assert.equal(v3SectionTitle(new URL(href, "https://x").pathname), title, href);
  }
  // Э5 своих адресов не добавлял: перенаправлять нечего.
  assert.equal(existsSync(new URL("../src/app/(v3)/v3/conversations", import.meta.url)), false);
  assert.equal(v3SectionTitle("/v3/conversations"), undefined);
  assert.match(read("src/app/(v3)/v3/inbox/page.tsx"), /const allowed = new Set\(\[\s*"q",\s*"waiting",\s*"conversation",/u, "no ?channel= on WhatsApp");
  // «Сегодня» («Ждут ответа») и уведомления о сообщении по делу — на переписку со студентами.
  const [chat] = todayChatItems([{ studentCaseId: caseId(1), studentDisplayName: "Студент (синтетика)", lastMessageSnippet: "текст",
    lastMessageAt: "2026-09-27T05:00:00.000Z", lastMessageAuthorMembershipId: STUDENT, awaitState: "needs_reply", unread: true }]);
  assert.equal(chat.band, "waiting");
  assert.equal(chat.openHref, `/v3/messages?case=${caseId(1)}&queue=needs_reply`);
  assert.match(read("src/lib/v3/today-queue.ts"), /all: \{ label: "Нужен ответ", href: "\/v3\/messages\?queue=needs_reply" \}/u);
  const notification = decodeStaffNotifications({ unread_count: "1", items: [{
    id: caseId(7), kind: "case_message", created_at: "2026-09-27T05:00:00.000Z", read_at: null, student_case_id: caseId(1),
    actor_display_name: null, subject_title: null, student_display_name: null, subject_due_on: null, subject_due_at: null,
  }] });
  assert.equal(notification.items[0].href, `/v3/messages?case=${caseId(1)}`);
  // «Нет доступа» называет разделы словами пунктов.
  const access = read("src/app/(v3)/access-denied/page.tsx");
  assert.match(access, /"\/v3\/inbox": "WhatsApp",/u);
  assert.match(access, /"\/v3\/messages": "Переписка со студентами",/u);
});

test("phone tabs: admissions roles keep «Переписка» (full name «Переписка со студентами»); the sales WhatsApp lives in «Ещё»", () => {
  for (const actor of [preview(null), preview("admissions"), staff([...staffRoleKeys("admissions")])]) {
    const tabs = shellTabs(menuOf(actor).model);
    assert.equal(tabs.kind, "admissions");
    assert.deepEqual(tabs.links.map((link) => link.label), ["Сегодня", "Студенты", "Задачи", "Переписка со студентами"]);
    assert.deepEqual(tabs.links.map((link) => shellTabLabel(link).text), ["Сегодня", "Студенты", "Задачи", "Переписка"]);
    assert.equal(shellTabs(menuOf(actor, "/v3/messages").model).currentInMore, false);
  }
  for (const actor of [preview("sales"), staff([...staffRoleKeys("sales-manager")])]) {
    const tabs = shellTabs(menuOf(actor).model);
    assert.equal(tabs.kind, "sales");
    assert.ok(tabs.links.length <= 4, "four slots plus «Ещё»");
    assert.equal(tabs.links.some((link) => link.id === "inbox"), false, "WhatsApp is not a slot");
    assert.equal(shellTabs(menuOf(actor, "/v3/inbox").model).currentInMore, true, "«Ещё» lights up on WhatsApp");
  }
});

// --- переключатель состояния и шаблоны: прежние команда и данные ---------------

test("the header state control is visible and calls the existing set_await command, never a «⋯» menu", () => {
  const component = read("src/components/v3/case-chat/CaseChatThread.tsx");
  assert.match(component, /const AWAIT_CONTROL_ORDER = \["needs_reply", "awaiting_student", "none"\] as const/u);
  assert.match(component, /role="group" aria-label="Состояние переписки" data-testid="case-chat-await-control"/u);
  assert.match(component, /aria-pressed=\{awaitState === value\} disabled=\{awaitPending\}\s*onClick=\{\(\) => \{ if \(value !== awaitState\) onSetAwait\(value\); \}\}/u);
  assert.match(component, /onSetAwait=\{changeAwait\}/u);
  assert.match(component, /form\.set\("request_id", crypto\.randomUUID\(\)\); form\.set\("case_id", caseId\); form\.set\("state", state\);\s*const result = await setCaseChatAwaitAction\(CASE_CHAT_INITIAL_ACTION, form\);/u);
  assert.doesNotMatch(component, /Ответ не требуется|aria-label="Ещё"/u, "the state menu behind «⋯» is gone");
  const actions = read("src/lib/platform-case-chat-actions.ts");
  assert.match(actions, /runCaseChatCommand\(caseId, requestId, \{ mode: "set_await", state \}\)/u);
  // «Нужен ответ» — предупреждение словом, не красный.
  assert.match(component, /return state === "needs_reply" \? "warn" : "neutral";/u);
  // Запись состояния не выглядит как фильтр очереди: подпись «Состояние» и
  // нажатая часть в тоне самого состояния, а не общим «выбрано» (.v3-choice).
  const header = component.slice(component.indexOf("function ThreadHeader("), component.indexOf("function AttachmentCard("));
  assert.match(header, /<span className="t-label text-fg-3" aria-hidden="true">Состояние<\/span>/u);
  assert.doesNotMatch(header, /v3-choice/u);
  assert.match(header, /data-tone=\{awaitTone\(value\)\}/u);
  assert.match(component, /needs_reply: "aria-pressed:border-warn\/40 aria-pressed:bg-warn-weak aria-pressed:text-warn",/u);
  assert.doesNotMatch(component.slice(component.indexOf("const AWAIT_PRESSED"), component.indexOf("function ThreadHeader(")), /accent|danger/u, "never red");
  assert.match(read("src/lib/v3/wording.ts"), /const CASE_CHAT_AWAIT_CHOICE: Record<string, string> = \{\s*needs_reply: "Нужен ответ",\s*awaiting_student: "Ждём студента",\s*none: "Не требуется",\s*\};/u);
});

test("a template is inserted into the text without sending: the same picker, reader and permission as WhatsApp", () => {
  // Предел переписки по делу — 8000; у WhatsApp остаётся 3000.
  const long = "а".repeat(CASE_CHAT_BODY_LIMIT - 5);
  assert.equal(insertReplySnippetWithinCodePointLimit(long, "12345", long.length, long.length, CASE_CHAT_BODY_LIMIT).accepted, true);
  assert.equal(insertReplySnippetWithinCodePointLimit(long, "123456", long.length, long.length, CASE_CHAT_BODY_LIMIT).accepted, false);
  assert.equal(insertReplySnippetWithinCodePointLimit("", "а".repeat(3001)).accepted, false, `WhatsApp keeps ${REPLY_MESSAGE_MAX_CODE_POINTS}`);
  const inserted = insertReplySnippetWithinCodePointLimit("Здравствуйте! ", "Документы получили.", 14, 14, CASE_CHAT_BODY_LIMIT);
  assert.deepEqual(inserted, { accepted: true, value: "Здравствуйте! Документы получили.", selectionStart: 33, selectionEnd: 33 });

  const component = read("src/components/v3/case-chat/CaseChatThread.tsx");
  const picker = component.slice(component.indexOf("<ReplySnippetPicker"), component.indexOf("/>", component.indexOf("<ReplySnippetPicker")));
  assert.match(picker, /maxCodePoints=\{CASE_CHAT_BODY_LIMIT\}/u);
  assert.match(picker, /onMessageTextChange=\{\(value\) => \{\s*persist\(\{ \.\.\.draft, body: value \}\);\s*document\.getElementById\(picker\.popoverId\)\?\.hidePopover\(\);\s*\}\}/u);
  assert.doesNotMatch(picker, /postCaseChatMessageAction|requestSubmit|submit\(/u, "inserting never sends");
  // «Шаблон» и «/» в пустом поле открывают одно окно в верхнем слое.
  assert.match(component, /popoverTarget=\{picker\.popoverId\}/u);
  assert.match(component, /popover="auto" role="dialog" aria-label="Шаблон ответа"/u);
  assert.match(component, /if \(event\.key !== "\/" \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey \|\| event\.nativeEvent\.isComposing\) return;\s*if \(!canPick \|\| draft\.body !== ""\) return;/u);
  const page = read("src/app/(v3)/v3/messages/page.tsx");
  assert.match(page, /staffCan\(actor, "snippets\.read"\)\s*\? readV3ReplySnippets\(actor\)/u);
  assert.match(read("src/app/(v3)/v3/inbox/page.tsx"), /readV3ReplySnippets\(actor\)/u);
  const shared = read("src/components/v3/reply-snippets/ReplySnippetPicker.tsx");
  assert.match(shared, /maxCodePoints = REPLY_MESSAGE_MAX_CODE_POINTS,/u);
  assert.doesNotMatch(shared, /type="submit"/u);
});

// --- разметка настоящих страниц -------------------------------------------------

const pages = JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/conversations-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
));
const page = (name) => {
  const item = pages.find((entry) => entry.name === name);
  assert.ok(item, name);
  return item.html;
};

test("«Переписка со студентами»: its own h1, no channel tabs, queue segments with counts from the read and «Все» without one", () => {
  const html = page("cabinet");
  assert.equal([...html.matchAll(/<h1\b/gu)].length, 1);
  assert.match(html, /<main aria-label="Переписка со студентами" data-conversations-main=""/u);
  assert.match(html, /<h1 class="t-page-title[^"]*">Переписка со студентами<\/h1>/u);
  // Страница стоит отдельно: ни ряда каналов, ни ссылки на WhatsApp продаж.
  assert.doesNotMatch(html, /Каналы переписки|data-conversation-channels|href="\/v3\/inbox"|Кабинет студента<\/a>/u);
  const queues = html.slice(html.indexOf('data-testid="case-chat-queues"'), html.indexOf("</div>", html.indexOf('data-testid="case-chat-queues"')));
  assert.match(queues, /aria-pressed="true"[^>]*>Нужен ответ<span [^>]*data-queue-count="needs_reply">3<\/span>/u);
  assert.match(queues, /aria-pressed="false"[^>]*>Ждём студента<span [^>]*data-queue-count="awaiting_student">2<\/span>/u);
  assert.match(queues, /aria-pressed="false"[^>]*>Все<\/button>/u);
  assert.doesNotMatch(html, /Выберите переписку слева/u);
  assert.doesNotMatch(html, /text-danger|data-tone="danger"|bg-danger/u, "no red on the list");
});

test("«Все» marks each row's state with its word: «Нужен ответ» as a warning, «Ждём студента» neutral", () => {
  // Состояние словом — чип (Э1.3).
  assert.match(page("all"), /<span class="v3-chip t-caption" data-tone="warn">Нужен ответ<\/span>/u);
  assert.match(page("all"), /<span class="v3-chip t-caption" data-tone="neutral">Ждём студента<\/span>/u);
  // В очереди «Нужен ответ» у всех строк одно состояние — чип не повторяется.
  assert.doesNotMatch(page("cabinet"), />Нужен ответ<\/span>/u);
});

test("the thread header says with whom: name, direction · board stage, «Открыть дело» and the three-way control", () => {
  const current = page("thread");
  assert.match(current, /<h2 class="t-section break-words text-fg @max-2xl:line-clamp-2 @2xl:truncate">Нурай Образцова<\/h2>/u);
  // Этап — чип фазы доски со словом (Э1.4), человек — нейтральные инициалы (Э1.3).
  assert.match(current, /data-testid="case-chat-case-facts"><span>Китай<\/span><span aria-hidden="true" class="text-fg-3">·<\/span><span class="v3-stage" data-phase="admission"><span class="v3-phase-dot" aria-hidden="true"><\/span><span class="min-w-0">Документы<\/span><\/span><\/p>/u);
  assert.match(current, /<span class="v3-initials t-caption" aria-hidden="true">НО<\/span>/u);
  assert.match(current, /href="\/v3\/profile\?case=dddddddd-2222-4222-8222-000000000001"[^>]*>Открыть дело<\/a>/u);
  const control = current.slice(current.indexOf('data-testid="case-chat-await-control"'));
  assert.deepEqual([...control.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)<\/button>/gu)].slice(0, 3).map((match) => `${match[2]}${match[1] === "true" ? "*" : ""}`),
    ["Нужен ответ*", "Ждём студента", "Не требуется"]);
});

test("WhatsApp stands alone: h1 «WhatsApp», the honest «не подключён» state, no channel tabs, for Admin, sales and a curator on an old link", () => {
  for (const name of ["whatsapp", "whatsapp-sales", "whatsapp-admissions"]) {
    const html = page(name);
    assert.equal([...html.matchAll(/<h1\b/gu)].length, 1, name);
    // Не подключён — считать нечего: числа у заголовка нет.
    assert.match(html, /<h1 class="t-page-title flex flex-wrap items-baseline gap-2\.5 text-fg">WhatsApp<\/h1>/u, name);
    assert.match(html, /WhatsApp не подключён к CRM — подключает Администратор/u, name);
    assert.doesNotMatch(html, /Каналы переписки|data-conversation-channels|Кабинет студента|href="\/v3\/messages"/u, name);
  }
  assert.doesNotMatch(page("whatsapp-sales"), /Открыть настройки/u, "connecting stays with the Administrator");
});

test("each page has its own header: the student chat window-high, WhatsApp the shell column's height; no channel tabs anywhere", () => {
  const head = (html) => {
    const start = html.indexOf("<main");
    return html.slice(start, html.indexOf("</h1>", start) + "</h1>".length);
  };
  // Переписка со студентами — на высоту окна (правило 100dvh): поле ответа над панелью вкладок.
  assert.equal(head(page("cabinet")), '<main aria-label="Переписка со студентами" data-conversations-main="" class="mx-auto flex w-full min-h-0 max-w-[1240px] flex-col px-4 pb-4 pt-6 sm:px-6 h-[calc(100dvh-150px)] md:h-[calc(100dvh-64px)]"><div class="flex flex-wrap items-start justify-between gap-4"><div class="min-w-0"><h1 class="t-page-title flex flex-wrap items-baseline gap-2.5 text-fg">Переписка со студентами</h1>');
  // WhatsApp — прежний PartShell `fill`: от 768 px высоту даёт колонка оболочки (`isFillRoute`).
  assert.equal(head(page("whatsapp")), '<main class="mx-auto w-full px-4 sm:px-6 max-w-[1240px] flex flex-col py-6 md:min-h-0 md:flex-1"><div class="flex flex-wrap items-start justify-between gap-4"><div class="min-w-0"><h1 class="t-page-title flex flex-wrap items-baseline gap-2.5 text-fg">WhatsApp</h1>');
  assert.match(read("src/app/(v3)/v3/messages/page.tsx"), /export const metadata = \{ title: "Переписка со студентами" \};\s*const TITLE = "Переписка со студентами";/u);
  assert.match(read("src/app/(v3)/v3/inbox/page.tsx"), /export const metadata = \{ title: "WhatsApp" \};/u);
  assert.match(read("src/app/(v3)/v3/inbox/loading.tsx"), /<PartShell title="WhatsApp" fill>/u);
  assert.doesNotMatch(read("src/app/(v3)/v3/inbox/page.tsx"), /ConversationsMain|conversationChannels/u);
  assert.equal(existsSync(new URL("../src/components/v3/ConversationChannels.tsx", import.meta.url)), false);
  assert.doesNotMatch(read("src/components/v3/ConversationsMain.tsx"), /channels|QueueViewTabs/u);
});

test("a phone thread takes the screen: page title only for screen readers, no channel tabs, «К списку» on the name row", () => {
  const thread = page("thread");
  assert.match(thread, /<div class="flex flex-wrap items-start justify-between gap-4 @max-2xl:sr-only"><div class="min-w-0"><h1 class="t-page-title[^"]*">Переписка со студентами<\/h1>/u);
  assert.match(thread, /<\/h1><\/div><\/div><div class="mt-5 flex min-h-0 flex-1 flex-col @max-2xl:mt-0">/u);
  assert.doesNotMatch(page("cabinet"), /@max-2xl:sr-only|@max-2xl:hidden/u, "the list keeps its title");
  const header = thread.slice(thread.indexOf('data-testid="case-chat-thread-header"'), thread.indexOf('data-testid="case-chat-await-control"'));
  assert.match(header, /<a [^>]*aria-label="К списку"[^>]*>[\s\S]*?<\/a>(?:<span [^>]*>[\s\S]*?<\/span>)?<div class="min-w-0"><h2 /u, "the back link sits in the name row");
  // Узко имя встаёт в две строки, а не обрезается до «Студент …».
  assert.match(header, /<h2 class="[^"]*@max-2xl:line-clamp-2 @2xl:truncate">Нурай Образцова<\/h2>/u);
  // Список на всю ширину телефона — без своей черты справа.
  assert.match(page("cabinet"), /<nav aria-label="Переписки кабинета студента" class="flex w-full flex-col border-border @2xl:w-\[360px\] @2xl:shrink-0 @2xl:border-e">/u);
});

test("the empty default queue fills the right pane with «Все ответы даны», the list says it once in other words", () => {
  const html = page("answered");
  assert.match(html, /data-testid="case-chat-next"><p class="t-body text-fg-3">Все ответы даны<\/p><\/div>/u);
  assert.match(html, /<p role="status" class="text-sm text-fg-3">Нет переписок, ждущих ответа\.<\/p>/u);
  assert.match(html, />Показать все переписки<\/button>/u);
});

test("message actions: an icon from the set on the author · time line, the menu in the top layer, no «⋯» glyph", () => {
  const thread = page("thread");
  assert.doesNotMatch(thread, /⋯/u);
  const triggers = [...thread.matchAll(/<button type="button" id="[^"]+" popoverTarget="([^"]+)"[^>]*aria-label="Действия с сообщением"[^>]*><span [^>]*><svg [^>]*><circle cx="5" cy="12" r="1\.2"\/>/gu)];
  assert.equal(triggers.length, 5, "one per message");
  for (const [, id] of triggers) assert.match(thread, new RegExp(`<div id="${id}" popover="auto" role="group" aria-label="Действия с сообщением"`, "u"));
  const component = read("src/components/v3/case-chat/CaseChatThread.tsx");
  assert.doesNotMatch(component, /<details|<summary/u);
  assert.match(component, /onClick=\{\(\) => \{ document\.getElementById\(menu\.popoverId\)\?\.hidePopover\(\); onReply\(message\); \}\}/u);
});
