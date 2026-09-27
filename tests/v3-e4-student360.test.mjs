// Э4 (27.09.2026): Student 360 — шапка с дорожкой этапа, факты сбоку, лента событий.
// Синтетические данные: имена, дела и записи выдуманы, записей EVO здесь нет.
// Чистая логика — прямо из модулей; страница — настоящая сборка дела
// (`caseWorkParts` + `Profile`) статическим рендером tests/e2e/case-static-render.cjs
// (один облик staff CRM, Э1.5). Права решает SQL; здесь — подсказки интерфейса и честность вида.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CASE_FACTS_ID,
  CASE_FEED_SHOWN,
  CASE_HEADER_ID,
  CASE_PORTAL_GROUP_ID,
  CASE_SALES_GROUP_ID,
  caseChecklistCounts,
  caseDocumentReviews,
  caseEventLink,
  caseFeed,
  casePrimaryAction,
} from "../src/components/v3/profile/case-work-view.ts";
import { studentsHandoffPending } from "../src/components/v3/students/students-queue-view.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
const render = (...flags) => new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/case-static-render.cjs", import.meta.url)), "--json", ...flags],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
const pages = render();

/** Видно без раскрытия: без закрытых `<details>`, `<dialog>`, `[popover]` (верхний слой) и скрытых `hidden` списков («Показать ещё»). */
function shown(html) {
  let out = html;
  for (const [tag, open] of [["details", /<details(?![^>]*\bopen\b)[^>]*>/u], ["dialog", /<dialog(?![^>]*\bopen\b)[^>]*>/u], ["div", /<div[^>]*\bpopover="auto"[^>]*>/u],
    ["ol", /<ol[^>]*\bhidden=""[^>]*>/u]]) {
    for (let match = open.exec(out); match; match = open.exec(out)) {
      let depth = 0;
      const pattern = new RegExp(`<${tag}\\b|</${tag}>`, "gu");
      pattern.lastIndex = match.index;
      let end = out.length;
      for (let token = pattern.exec(out); token; token = pattern.exec(out)) {
        depth += token[0].startsWith("</") ? -1 : 1;
        if (depth === 0) { end = token.index + token[0].length; break; }
      }
      out = out.slice(0, match.index) + out.slice(end);
    }
  }
  return out;
}
/** Сплошной красный — класс `bg-accent` кнопки (не `bg-accent-weak`, не `hover:`). */
const solidRed = (html) => html.match(/(?<![\w:-])bg-accent(?![\w-])/gu)?.length ?? 0;

// --- чистая логика ------------------------------------------------------------

test("one main action by state: «Принять дело» only while this curator's answer is awaited, never in a role preview", () => {
  assert.equal(casePrimaryAction({ handoffPending: true, preview: false }), "accept");
  assert.equal(casePrimaryAction({ handoffPending: true, preview: true }), null);
  assert.equal(casePrimaryAction({ handoffPending: false, preview: false }), null);
  assert.equal(CASE_PORTAL_GROUP_ID, "portal-access", "the same anchor as Lead 360 and the «⋯» item");
  assert.equal(CASE_SALES_GROUP_ID, "sales-data", "?panel=sales and #sale-conditions keep opening the sales data");
});

const NOTE = (body, createdAt) => ({ body, authorDisplayName: "Сотрудник", createdAt });
const EVENT = (id, transition, targetKind, occurredAt) => ({
  id: `abababab-5555-4555-8555-${String(id).padStart(12, "0")}`, transition, role: "", at: occurredAt ? "x" : null, href: "/v3/profile",
  changedFields: [], targetKind, occurredAt,
});
const REVIEW = (id, name, status, reviewedAt) => ({
  id, name, status, presence: "present", latestReview: { decision: status, reason: null, reviewerMembershipId: "m", reviewerDisplayName: "С", reviewedAt },
});
const DOCS = [
  { kind: "active", title: "Документы", items: [
    REVIEW("d1", "Паспорт", "approved", "2026-09-05T05:00:00.000Z"),
    REVIEW("d2", "Аттестат", "correction_required", "2026-09-20T05:00:00.000Z"),
    { id: "d3", name: "Фото", status: "submitted", presence: "present", latestReview: null },
    { id: "d4", name: "Справка", status: "required", presence: "absent" },
  ] },
  { kind: "removed", title: "Удалённые", items: [{ id: "d5", name: "Старое", removedAt: "2026-09-21T05:00:00.000Z" }] },
];
const CHAT = { kind: "ready", awaitState: "needs_reply", last: { authorName: "Студент", mine: false, text: "Можно в пятницу?", createdAt: "2026-09-22T08:00:00.000Z" } };
const LINKS = { route: "/route", money: "/money", documents: "/documents", messages: "/v3/messages?case=c" };

test("document events are review decisions from the documents already read — with the review time, never an upload", () => {
  assert.deepEqual(caseDocumentReviews(DOCS).map(({ key, text: words, at }) => [key, words, at]), [
    ["review:d1", "Паспорт — принят", "2026-09-05T05:00:00.000Z"],
    ["review:d2", "Аттестат — нужно исправить", "2026-09-20T05:00:00.000Z"],
  ]);
  // Числа чек-листа — те же прочитанные пункты: удалённые не считаются.
  assert.deepEqual(caseChecklistCounts(DOCS), { total: 4, submitted: 1, correctionRequired: 1, rejected: 0, approved: 1, missing: 1 });
});

test("the feed merges notes and events newest first; tasks, undated documents and message records stay out", () => {
  const activity = { kind: "ready", olderThan: null, events: [
    EVENT(1, "case.next.action.change", "overview", "2026-09-22T05:00:00.000Z"),
    EVENT(2, "task.create", "task", "2026-09-21T09:00:00.000Z"),
    EVENT(3, "case.handoff.acknowledge", "overview", "2026-09-21T04:00:00.000Z"),
    EVENT(4, "communication.message.record", "conversation", "2026-09-19T12:00:00.000Z"),
    EVENT(5, "communication.conversation.link", "conversation", "2026-09-19T11:00:00.000Z"),
    EVENT(6, "finance.payment.record", "money", "2026-09-18T11:00:00.000Z"),
    EVENT(7, "document.version.review", "documents", null),
    EVENT(8, "unknown.action", "overview", "2026-09-17T11:00:00.000Z"),
  ] };
  const feed = caseFeed({
    notes: [NOTE("Заметка A", "2026-09-21T04:00:00.000Z"), NOTE("Заметка B", "2026-09-10T04:00:00.000Z")],
    firstPage: true, activity, documents: DOCS, handoffAnswer: { decision: "accepted", createdAt: "2026-09-21T04:00:00.000Z" }, chat: CHAT,
    links: LINKS, applications: [],
  });
  assert.equal(feed.eventsUnavailable, false);
  assert.deepEqual(feed.items.map((item) => item.kind === "note" ? `note:${item.note.body}` : item.kind === "event" ? item.text : item.kind), [
    "chat",
    "Следующий шаг изменён",
    // Равное время: заметка раньше события — порядок чтения сохраняется.
    "note:Заметка A",
    "Куратор принял передачу",
    "Аттестат — нужно исправить",
    "Диалог привязан",
    "Платёж записан",
    "note:Заметка B",
    "Паспорт — принят",
  ]);
  assert.deepEqual(feed.items[0], { kind: "chat", at: CHAT.last.createdAt, author: "Студент", text: "Можно в пятницу?", href: LINKS.messages });
});

test("each feed row leads to its object; the application is named only from what was read", () => {
  // Журнал: заявки — «Вузы и программы», деньги — «Договор и оплата», переписка — адрес самого чтения,
  // шаг и состояние — шапка, куратор и передача — «Сведения», само дело — без ссылки.
  const at = "2026-09-25T05:00:00.000Z";
  const link = (transition, targetKind, href = "/v3/profile") => caseEventLink({ transition, targetKind, href }, LINKS);
  assert.equal(link("application.status.change", "overview"), "/route");
  assert.equal(link("finance.payment.record", "money"), "/money");
  assert.equal(link("communication.conversation.link", "conversation", "/v3/inbox?conversation=x"), "/v3/inbox?conversation=x");
  assert.equal(link("case.next.action.change", "overview"), `#${CASE_HEADER_ID}`);
  assert.equal(link("case.lifecycle.change", "overview"), `#${CASE_HEADER_ID}`);
  for (const transition of ["case.curator.set", "case.handoff.acknowledge", "case.handoff.clarification", "case.coverage.start", "lead.admissions.handoff.completed", "case.route.change"]) {
    assert.equal(link(transition, "overview"), `#${CASE_FACTS_ID}`, transition);
  }
  assert.equal(link("case.create", "overview"), null, "the case itself is this page");
  assert.equal(link("visa.status.change", "overview"), null, "no visa card to open since S4");
  assert.equal(caseEventLink({ transition: "finance.payment.record", targetKind: "money", href: "/x" }, { ...LINKS, money: null }), null, "no tab — no link");
  const events = [
    { ...EVENT(1, "application.status.change", "overview", at), targetId: "app-1" },
    { ...EVENT(2, "application.create", "overview", at), targetId: "app-unknown" },
  ];
  const feed = caseFeed({ notes: [], firstPage: true, activity: { kind: "ready", olderThan: null, events }, documents: DOCS,
    handoffAnswer: { decision: "declined", createdAt: "2026-09-24T05:00:00.000Z" }, chat: { kind: "forbidden" }, links: LINKS,
    applications: [{ id: "app-1", title: "Университет · Программа", status: "ready", primary: true, deadlineOn: null }] });
  const rows = feed.items.filter((item) => item.kind === "event").map((item) => [item.text, item.href]);
  assert.deepEqual(rows.slice(0, 3), [
    ["Статус заявки изменён · Университет · Программа", "/route"],
    ["Заявка заведена", "/route"],
    ["Куратор отклонил назначение", `#${CASE_FACTS_ID}`],
  ]);
  assert.ok(rows.slice(3).every(([words, href]) => / — /u.test(words) && href === "/documents"), "document reviews open the documents tab");
});

test("the feed is honest about what was not read and where the rest lives", () => {
  const base = { notes: [NOTE("Заметка", "2026-09-10T04:00:00.000Z")], documents: DOCS, handoffAnswer: null, chat: CHAT, links: LINKS, applications: [] };
  // Журнал не прочитан: заметки, решения по документам и переписка остаются, пробел назван.
  const unread = caseFeed({ ...base, firstPage: true, activity: { kind: "unavailable" } });
  assert.equal(unread.eventsUnavailable, true);
  assert.deepEqual(unread.items.map((item) => item.kind), ["chat", "event", "note", "event"]);
  // Более ранняя страница заметок — только заметки (события — на первой странице).
  const older = caseFeed({ ...base, firstPage: false, activity: { kind: "not_read" } });
  assert.equal(older.eventsUnavailable, false);
  assert.deepEqual(older.items.map((item) => item.kind), ["note"]);
  // Журнал длиннее страницы: строка среза на его границе, более ранние заметки — ниже неё.
  const cut = caseFeed({ ...base, notes: [NOTE("Старая заметка", "2026-08-01T04:00:00.000Z")], documents: null, chat: { kind: "forbidden" }, firstPage: true,
    activity: { kind: "ready", olderThan: "2026-09-01T00:00:00.000Z", events: [EVENT(1, "case.create", "overview", "2026-09-02T00:00:00.000Z")] } });
  assert.deepEqual(cut.items.map((item) => item.kind), ["event", "older", "note"]);
  // Отказа куратора нет в журнале 132 — он берётся из снимка «Приёма дела»; принятие не дублируется.
  const declined = caseFeed({ ...base, documents: null, firstPage: true, activity: { kind: "ready", olderThan: null, events: [] },
    handoffAnswer: { decision: "declined", createdAt: "2026-09-21T04:00:00.000Z" } });
  assert.ok(declined.items.some((item) => item.kind === "event" && item.text === "Куратор отклонил назначение"));
  const accepted = caseFeed({ ...base, documents: null, firstPage: true, activity: { kind: "ready", olderThan: null, events: [] },
    handoffAnswer: { decision: "accepted", createdAt: "2026-09-21T04:00:00.000Z" } });
  assert.ok(!accepted.items.some((item) => item.kind === "event"), "the answer snapshot adds only a decline");
  // Нет права на документы — событий документов нет.
  assert.ok(!caseFeed({ ...base, documents: null, firstPage: true, activity: { kind: "unavailable" } }).items.some((item) => item.kind === "event"));
});

// --- чтения ------------------------------------------------------------------

test("reads are reused: the History journal, the handoff context already read, no new SQL", () => {
  const source = read("src/lib/v3/case-work-source.ts");
  assert.match(source, /import \{ readProfileActivity \} from "\.\/profile-activity-source";/u);
  assert.match(source, /const page = await readProfileActivity\(actor, target\.studentCaseId, null\);/u);
  assert.match(source, /\} catch \{\n\s+return Object\.freeze\(\{ kind: "unavailable" \}\);/u, "a failed journal read is «недоступно», not a broken page");
  assert.match(source, /options\.overview && options\.feed \? readCaseActivity\(actor, target\) : ACTIVITY_NOT_READ,/u);
  assert.doesNotMatch(source, /\.rpc\(/u, "no direct RPC in the case work source");
  const activity = read("src/lib/v3/profile-activity-source.ts");
  assert.match(activity, /rpc\("staff_student_case_activity"/u, "the same 132/241 read as the «История» tab");
  assert.match(activity, /targetKind: kind as NonNullable<ProfileEvent\["targetKind"\]>,\n\s+occurredAt: timestamp as string \| null,/u);
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /readCaseWork\(actor, caseTarget, \{ overview: tab === "overview", feed: tab === "overview" && noteCursor === null \}\)/u);
  const profile = read("src/lib/v3/profile-source.ts");
  assert.match(profile, /getPlatformStudentCaseHandoffContext\(actor, studentCaseId\),/u, "the handoff context is read as before");
  assert.match(profile, /handedOffBy: data\.handoff \? \{ name: data\.handoff\.actorDisplayName, at: data\.handoff\.handedOffAt \} : null,/u);
});

// --- страница ------------------------------------------------------------------

test("awaiting acceptance: the one solid red is «Принять дело» at the name; its panel is the same answer form, confirmed in dark", () => {
  const html = pages.get("curator-accept");
  assert.equal(solidRed(shown(html)), 1, "one solid red");
  assert.match(html, /data-testid="v3-case-actions"><button type="button" aria-haspopup="dialog" class="[^"]*bg-accent[^"]*" data-testid="v3-case-primary">Принять дело<\/button>/u);
  const drawer = html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>"));
  assert.match(drawer, /data-testid="v3-case-accept-drawer"/u);
  assert.equal(solidRed(drawer), 0, "the panel has no second red");
  for (const field of ["student_case_id", "assignment_event_id", "expected_acknowledgement_id", "request_id", "decision", "agreed_contact_date"]) {
    assert.match(drawer, new RegExp(`name="${field}"`, "u"), field);
  }
  assert.match(drawer, /<input type="hidden" name="decision" value="accepted"\/>/u);
  assert.match(text(drawer), /Принять дело Нужно уточнить Отклонить .*Подтвердить приём Отмена/u);
  assert.equal((drawer.match(/aria-pressed="true"/gu) ?? []).length, 1, "one decision selected");
  assert.match(drawer, /class="v3-raised [^"]*bg-fg [^"]*"[^>]*>Подтвердить приём<\/button>/u, "confirm is the dark neutral button");
  // Панель — модальный <dialog>: фон недоступен, Esc закрывает, фокус возвращается на кнопку.
  const drawerSource = read("src/components/v3/profile/CaseAcceptDrawer.tsx");
  assert.match(drawerSource, /dialog\.showModal\(\);/u);
  assert.match(drawerSource, /dialog\.addEventListener\("close", onClose\);/u);
  assert.match(drawerSource, /if \(triggerRef\.current\?\.isConnected\) triggerRef\.current\.focus\(\);/u);
  assert.match(drawerSource, /document\.getElementById\("case-tasks-title"\)/u, "focus does not fall to the page when the button goes away");
  // Та же форма и то же действие, что у карточки «Приём дела» и «Быстрого просмотра».
  const form = read("src/components/v3/profile/ProfileSalesTransition.tsx");
  assert.match(form, /const \[state, action, pending\] = useActionState<HandoffResponseActionState, FormData>\(\n\s+async \(previous, formData\) => \{\n\s+const next = await respondToHandoffAction\(previous, formData\);/u);
});

test("otherwise no red action: active, closed, needs a curator, Admin, preview — «сегодня» is the one other solid red", () => {
  for (const name of ["curator", "closed", "closed-outcome", "needs-curator", "admin", "admin-declined", "unread", "preview-awaiting", "notes-page", "fresh"]) {
    assert.equal(solidRed(shown(pages.get(name))), 0, name);
    assert.doesNotMatch(pages.get(name), /data-testid="v3-case-primary"/u, name);
  }
  // Что видит пользователь (review 27.09): у задачи со сроком «сегодня» слово срока —
  // маленькая сплошная красная заливка (DueWord, правило плана: красный — главное действие и «сегодня»).
  // Это не действие и оно есть только в строках «Задач».
  const active = pages.get("curator");
  const tasksPart = active.slice(active.indexOf('data-testid="v3-case-tasks-part"'), active.indexOf('data-testid="v3-case-facts"'));
  const today = (html) => html.match(/class="v3-due t-caption" data-due="today"/gu)?.length ?? 0;
  assert.ok(today(tasksPart) > 0, "the task due today shows «сегодня»");
  assert.equal(today(active), today(tasksPart), "no «сегодня» fill outside the task rows");
  assert.match(read("src/components/v3/blocks/DueWord.tsx"), /«сегодня» — маленькая красная заливка с белым текстом \(правило плана:\n \* сплошной красный — главное действие и «сегодня»\)/u);
  assert.match(read("DESIGN.md"), /единственная другая сплошная\s+красная заливка — слово срока «сегодня»/u, "the docs name the exception");
});

test("no capability is lost: every action of the case overview is still on the page", () => {
  const curator = pages.get("curator");
  // Шаг: тот же редактор #1059 в окне у «Изменить».
  assert.match(curator, /data-testid="v3-case-next-step"[\s\S]*?>Изменить<\/button>/u);
  assert.match(curator, /data-testid="v3-next-step-editor"/u);
  // Задачи: строки «Задач» с выполнением на месте; новая задача — тот же диалог Э7 с делом.
  assert.match(curator, /aria-label="Завершить с результатом: Проверить перевод аттестата у нотариуса"/u);
  assert.match(curator, /data-testid="v3-case-task"[^>]*>[\s\S]*?Задача по делу/u);
  assert.match(read("src/components/v3/profile/CaseWorkParts.tsx"), /<TaskComposerDialog\n\s+participants=\{\[\]\} actorMembershipId=\{actor\.membershipId\} actor=\{actor\} day=\{work\.today\}\n\s+staffAllowed=\{false\} caseAllowed\n\s+initialCase=\{\{ id: caseId, name: profile\.person \}\}/u);
  // Заметка: то же действие, субъект и ключ запроса; прежняя страница заметок — «К последним».
  assert.match(curator, /<input type="hidden" name="student_case_id" value="cccccccc-2222-4222-8222-000000000001"\/><input type="hidden" name="request_id" value="12121212-5555-4555-8555-000000000014"\/>/u);
  assert.match(read("src/components/v3/profile/LeadNoteComposer.tsx"), /useActionState\(createCaseNoteAction,/u);
  assert.match(pages.get("notes-page"), />К последним<\/a>/u);
  // «⋯»: «Завершить дело…» (246); у Admin — и «Доступ к порталу».
  assert.match(text(curator), /Завершить дело…/u);
  assert.match(text(pages.get("admin")), /^Написать Задача по делу Доступ к порталу /u);
  // «Написать» и переписка, документы, заявки, договор — ссылки на свои вкладки.
  const admin = pages.get("admin");
  for (const href of ["/v3/messages?case=cccccccc-2222-4222-8222-000000000001", "tab=documents", "tab=route", "tab=money"]) {
    assert.ok(admin.includes(href), href);
  }
  // Ответ на передачу можно изменить; назначение куратора и «Нагрузка кураторов» — у того, кто назначает.
  assert.match(text(curator), /Изменить ответ/u);
  assert.match(text(pages.get("needs-curator")), /Назначить куратора/u);
  assert.match(text(pages.get("needs-curator")), /Куратор нужен куратор/u);
  assert.match(text(admin), /Нагрузка кураторов/u);
  // Доступ к порталу и данные продажи — прежние формы в свёрнутых группах; закрытое дело — «Вернуть в работу».
  assert.match(admin, /id="portal-access"[\s\S]*?Проверить и подготовить доступ/u);
  assert.match(admin, /id="sales-data"[\s\S]*?id="sale-conditions"/u);
  assert.match(text(pages.get("closed-outcome")), /Вернуть в работу/u);
  // Другие вкладки не меняются: адреса проверки выпуска и их testid — прежние.
  const profile = read("src/components/v3/profile/Profile.tsx");
  assert.match(profile, /\{current === "route" \? universityProgramsTab : null\}/u);
  assert.match(read("src/components/v3/profile/UniversityProgramsTab.tsx"), /data-testid="v3-universities-programs"/u);
  assert.match(read("src/components/v3/profile/ProfileContractWorkspace.tsx"), /data-testid="v3-profile-contract-workspace"/u);
});

test("a role preview writes nothing: no answer, no task, no note — the stage and the facts stay", () => {
  const preview = pages.get("preview-awaiting");
  assert.doesNotMatch(preview, /v3-case-primary|v3-case-accept-drawer|data-testid="v3-case-task"|name="request_id" value="12121212-5555-4555-8555-000000000014"/u);
  assert.doesNotMatch(preview, />Изменить<\/button>/u);
  assert.match(text(preview), /Этап .*?Документы Поступление Что дальше Собрать апостиль на аттестат/u);
  assert.match(text(preview), /Сведения Направление Китай/u);
});

test("the header: the stage track with the board's stage word; the feed is the page's last part", () => {
  const plain = pages.get("curator");
  assert.match(plain, /<div class="v3-track" data-track="admissions">/u);
  assert.match(plain, /<span class="t-body-compact text-fg">Документы<\/span>/u, "the stage word stays under the track");
  // От 1280 px: работа слева, «Сведения» справа за линией, лента — сразу под работой.
  assert.match(plain, /xl:grid-cols-\[minmax\(0,1fr\)_22rem\] xl:grid-rows-\[auto_1fr\]/u);
  const order = ["v3-case-tasks-part", "v3-case-facts", "v3-case-feed"].map((id) => plain.indexOf(`data-testid="${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "work, facts, feed in reading order");
  // Лента: видны первые строки, остальное — скрытым списком под «Показать ещё»; первая скрытая строка —
  // цель фокуса (`tabindex="-1"`), кнопка уходит (FeedMore, проверка в браузере — `case-static-render.cjs --drawer`).
  const admin = pages.get("admin");
  const visibleItems = shown(admin).match(/data-feed="/gu)?.length ?? 0;
  assert.equal(visibleItems, CASE_FEED_SHOWN);
  const more = admin.match(/data-testid="v3-case-feed-more"><ol start="(\d+)" hidden="" class="[^"]*">(<li [^>]*>)[\s\S]*?<\/ol><button type="button" class="[^"]*">Показать ещё (\d+)<\/button>/u);
  assert.ok(more, "hidden rest and the button");
  assert.equal(Number(more[1]), CASE_FEED_SHOWN + 1);
  assert.match(more[2], /tabindex="-1"/iu, "the first hidden row takes the focus");
  assert.equal((admin.match(/data-feed="[a-z]+" tabindex="-1"/giu) ?? []).length, 1, "only that row");
  assert.doesNotMatch(admin, /group-open\/more:hidden/u, "no summary that hides itself while focused");
  assert.match(text(admin), /Более ранние события журнала дела — во вкладке «История»/u);
});

test("«Показать ещё» keeps the keyboard in place: tasks and feed move focus to the first revealed row", () => {
  const feedMore = read("src/components/v3/profile/FeedMore.tsx");
  assert.match(feedMore, /<ol ref=\{listRef\} start=\{start\} hidden=\{!open\}/u);
  assert.match(feedMore, /onClick=\{\(\) => \{ moveFocus\.current = true; setOpen\(true\); \}\}/u);
  assert.match(feedMore, /listRef\.current\?\.querySelector<HTMLElement>\(':scope > \[tabindex="-1"\]'\)\?\.focus\(\);/u);
  const tasks = read("src/components/v3/profile/CaseTaskList.tsx");
  assert.match(tasks, /onClick=\{\(\) => \{ revealFrom\.current = shown\.length; setAll\(true\); \}\}/u);
  assert.match(tasks, /row\?\.querySelector<HTMLElement>\("\[data-queue-open\]"\)\?\.focus\(\);/u);
  // Браузер с настоящим React проверяет то же с клавиатуры (Enter) и видимую рамку фокуса.
  const harness = read("tests/e2e/case-static-render.cjs");
  assert.match(harness, /tasks «Показать ещё» moves focus to the first revealed task/u);
  assert.match(harness, /feed «Показать ещё» reveals the rows and moves focus to the first one/u);
});

test("feed rows lead to their objects on the page: tabs keep the way back, the step and the curator are anchors here", () => {
  const admin = pages.get("admin");
  const row = (words) => admin.match(new RegExp(`<li class="[^"]*" data-feed="(?:event|chat)">(?:(?!</li>).)*?${words}(?:(?!</li>).)*?</li>`, "u"))?.[0] ?? "";
  const back = "&amp;returnTo=%2Fv3%2Fprofile%3Fview%3Dmine";
  assert.match(row("Статус заявки изменён · Чжэцзянский университет · Компьютерные науки"), new RegExp(`href="/v3/profile\\?case=cccccccc-2222-4222-8222-000000000001&amp;tab=route${back.replaceAll("?", "\\?")}"`, "u"));
  assert.match(row("Заявка заведена · Шанхайский университет · Международная торговля"), /tab=route/u);
  assert.match(row("План обучения — нужно исправить"), /tab=documents&amp;returnTo=/u);
  assert.match(row("Следующий шаг изменён"), /href="#case-header"/u);
  assert.match(row("Куратор принял передачу"), /href="#case-facts"/u);
  assert.match(row("Дело передано в сопровождение"), /href="#case-facts"/u);
  assert.match(row("Переписка</a> · Вы"), /href="\/v3\/messages\?case=cccccccc-2222-4222-8222-000000000001"/u);
  // Само дело — это страница: «Дело заведено» без ссылки. Якоря существуют.
  assert.doesNotMatch(row("Дело заведено"), /<a /u);
  assert.match(admin, /<section id="case-header" /u);
  assert.match(admin, /<aside id="case-facts" /u);
  assert.match(text(pages.get("closed-outcome")), /Состояние дела изменено/u);
  assert.match(pages.get("closed-outcome"), /href="#case-header">Состояние дела изменено<\/a>/u, "the closing event points at the closed line in the header");
  // Объект назван только из прочитанного: id заявки — из того же ответа журнала.
  assert.match(read("src/lib/v3/profile-activity-source.ts"), /occurredAt: timestamp as string \| null,\n\s+targetId,/u);
});

test("one gutter, one text edge: Lead 360 and Student 360 draw feed rows with the same shared markup", () => {
  for (const file of ["src/components/v3/profile/CaseOverview.tsx", "src/components/v3/profile/LeadWorkParts.tsx"]) {
    const source = read(file);
    assert.match(source, /from "\.\/FeedRow";/u, file);
    assert.doesNotMatch(source, /data-feed=/u, `${file}: no own row markup`);
  }
  const rows = read("src/components/v3/profile/FeedRow.tsx");
  assert.match(rows, /className=\{`flex \$\{link \? "h-6" : "h-\[1lh\]"\} w-4 shrink-0 items-center justify-center \$\{type\}`\}/u);
  const html = pages.get("admin");
  const items = html.match(/<li class="[^"]*" data-feed="(?:note|event|chat)"[^>]*>/gu) ?? [];
  assert.ok(items.length > CASE_FEED_SHOWN);
  // Каждая строка: метка в колонке 16 px, затем текст — один край для заметок, событий и переписки.
  const marked = html.match(/data-feed="(?:note|event|chat)"[^>]*><span aria-hidden="true" class="flex (?:h-\[1lh\]|h-6) w-4 shrink-0 items-center justify-center t-body(?:-compact)?"><svg width="10" height="10"/gu) ?? [];
  assert.equal(marked.length, items.length, "every row starts with the same mark");
  assert.match(html, /<li class="py-2\.5 ps-6 t-body-compact text-fg-2" data-feed="older"/u, "the pointer line starts at the same text edge");
});

test("landmarks are named apart: the header region and the facts column", () => {
  const html = pages.get("curator");
  assert.match(html, /<section id="case-header" class="[^"]*" data-testid="v3-case-header" aria-label="Этап и следующий шаг">/u);
  assert.match(html, /<aside id="case-facts" aria-labelledby="case-facts-title"[^>]*>[\s\S]*?<h2 id="case-facts-title" class="t-section text-fg">Сведения<\/h2>/u);
  assert.doesNotMatch(html, /aria-label="Сведения дела"/u);
});

test("the accept panel decides with context: who handed off and when, direction, step, the current answer — nothing new read", () => {
  const html = pages.get("curator-accept");
  const drawer = html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>"));
  const context = drawer.indexOf('data-testid="v3-case-accept-context"');
  assert.ok(context > 0 && context < drawer.indexOf('aria-label="Решение"'), "context above the choices");
  assert.match(text(drawer), /Передал Эрмек Токтосунов · 30\.08 12:00 Направление Китай Что дальше Собрать апостиль на аттестат Текущий ответ Ожидает ответа куратора/u);
  // Продажу куратору не читают — её в панели нет; ответ не повторяется ниже выбора.
  assert.doesNotMatch(text(drawer), /Продажа/u);
  assert.equal((text(drawer).match(/Ожидает ответа куратора/gu) ?? []).length, 1);
  const parts = read("src/components/v3/profile/CaseWorkParts.tsx");
  assert.match(parts, /handedOffBy: draft\.handedOffBy \? \{ \.\.\.draft\.handedOffBy, label: caseMomentLabel\(draft\.handedOffBy\.at, work\.today\) \} : null,/u);
  assert.match(parts, /sale: salesVisible && sales \? \{ manager: sales\.lead\.currentOwnerDisplayName, nextAction: sales\.lead\.nextActionText \} : null,/u);
});

test("«Нужно уточнить» keeps the panel open; «Отклонить» ends the assignment and the panel goes with it", () => {
  // Review 27.09 (голова 5e0d0e95): после «Нужно уточнить» дело в работе у того же куратора и ждёт приёма —
  // панель остаётся открытой, иначе «Ответ сохранён.» оставался в закрытом окне.
  // Review 27.09 (голова 82d023c9): «Отклонить» снимает назначение (182/249): чтение 130 после отказа не
  // отдаёт ни назначения, ни ответа, и ответить нельзя — главного действия и панели больше нет. Любой
  // записанный ответ отмечается, чтобы фокус с исчезнувшей кнопки ушёл на «Задачи», а не на страницу.
  // Само поведение проверяет `case-static-render.cjs --drawer` в браузере (уточнение и приём; отказ).
  const afterDecline = { assignmentEventId: null, canRespond: false, current: null };
  assert.equal(studentsHandoffPending(afterDecline), false);
  assert.equal(casePrimaryAction({ handoffPending: studentsHandoffPending(afterDecline), preview: false }), null);
  const drawerSource = read("src/components/v3/profile/CaseAcceptDrawer.tsx");
  assert.match(drawerSource, /onSaved=\{\(decision\) => \{\n(?:\s+\/\/[^\n]*\n)*\s+answered\.current = true;\n\s+if \(decision === "accepted"\) close\(\);\n\s+\}\}/u,
    "every saved answer is marked; only acceptance closes the panel");
  assert.doesNotMatch(drawerSource, /if \(decision !== "accepted"\) return;/u);
  assert.match(drawerSource, /useEffect\(\(\) => \(\) => \{\n\s+if \(!answered\.current\) return;[\s\S]{0,200}document\.getElementById\("case-tasks-title"\)/u,
    "a vanished button hands focus to «Задачи»");
  const form = read("src/components/v3/profile/ProfileSalesTransition.tsx");
  assert.match(form, /if \(!inDrawer \|\| !saved\) return;[\s\S]{0,200}querySelector<HTMLElement>\('\[aria-pressed="true"\]'\)\?\.focus\(\);/u,
    "after the save focus goes back to the chosen decision, not the page");
  const html = pages.get("curator-clarified");
  // Дело всё ещё ждёт приёма: одна красная кнопка — «Принять дело».
  assert.equal(solidRed(shown(html)), 1, "one solid red");
  assert.match(html, /data-testid="v3-case-primary">Принять дело<\/button>/u);
  const drawer = html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>"));
  assert.match(text(drawer), /Текущий ответ Нужно уточнение от Sales Уточните, оплачен ли перевод аттестата\./u, "the panel's current answer");
  // Ответ виден и без панели — в «Сведениях»; изменить его — в панели, второй формы на странице нет.
  const page = shown(html);
  const facts = page.slice(page.indexOf('data-testid="v3-case-facts"'));
  assert.match(text(facts), /Приём дела Нужно уточнение от Sales Уточните, оплачен ли перевод аттестата\./u, "the answer in «Сведения»");
  assert.doesNotMatch(text(html), /Изменить ответ/u);
  assert.equal((html.match(/name="assignment_event_id"/gu) ?? []).length, 1, "one answer form");
  // Ждёт ответа и ответа ещё нет — «Приёма дела» в «Сведениях» нет: главное действие у заголовка.
  assert.doesNotMatch(text(shown(pages.get("curator-accept"))), /Приём дела/u);
});

test("the feed names what it could not read and says when there is nothing yet", () => {
  assert.match(text(pages.get("unread")), /Лента .*События журнала дела сейчас не прочитаны\. Обновите страницу, чтобы повторить\./u);
  assert.match(text(pages.get("fresh")), /Лента Новая заметка Добавить заметку Заметок и событий пока нет\./u);
  assert.doesNotMatch(pages.get("fresh"), /data-testid="v3-case-feed-items"/u);
  // Просмотр роли: заметку не пишут — поля нет, лента читается.
  const preview = pages.get("preview-awaiting");
  assert.doesNotMatch(preview, /data-testid="v3-lead-note-composer"/u);
  assert.match(preview, /data-testid="v3-case-feed-items"/u);
});

test("no invented progress: the documents bar is the read checklist, and there is no bar without it", () => {
  const counts = caseChecklistCounts([{ kind: "active", title: "Документы", items: Array.from({ length: 12 }, (_, index) => ({
    status: index < 7 ? "approved" : index < 9 ? "submitted" : index < 10 ? "correction_required" : "required",
  })) }]);
  const bar = pages.get("curator").match(/data-progress="(\d+)\/(\d+)"/u);
  assert.ok(bar, "the bar is drawn from the read counts");
  assert.deepEqual([Number(bar[1]), Number(bar[2])], [counts.approved, counts.total]);
  assert.match(text(pages.get("curator")), /Документы 7 из 12 принято 2 на проверке 1 исправить 2 не загружено Документы дела/u);
  // Нет права на документы — ни полосы, ни числа.
  assert.doesNotMatch(pages.get("unread"), /v3-progress|из \d+ принято/u);
  // Оплата — только тому, кому её отдаёт чтение; «Передал» — только у дела из продаж.
  assert.doesNotMatch(text(pages.get("curator")), /Оплата /u);
  assert.match(text(pages.get("admin")), /Оплата 40% оплачено · остаток 900 \$/u);
  assert.doesNotMatch(text(pages.get("unread")), /Передал/u);
});
