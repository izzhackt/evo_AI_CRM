// Э4 (27.09.2026): Student 360 — шапка с дорожкой этапа, факты сбоку, лента событий.
// Синтетические данные: имена, дела и записи выдуманы, записей EVO здесь нет.
// Чистая логика — прямо из модулей; страница — настоящая сборка дела
// (`caseWorkParts` + `Profile`) статическим рендером tests/e2e/case-static-render.cjs
// в обоих обликах. Права решает SQL; здесь — подсказки интерфейса и честность вида.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CASE_FEED_SHOWN,
  CASE_PORTAL_GROUP_ID,
  CASE_SALES_GROUP_ID,
  caseChecklistCounts,
  caseDocumentReviews,
  caseFeed,
  casePrimaryAction,
} from "../src/components/v3/profile/case-work-view.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
const render = (...flags) => new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/case-static-render.cjs", import.meta.url)), "--json", ...flags],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
const current = render();
const next = render("--look=next");

/** Видно без раскрытия: без закрытых `<details>` и без закрытых `<dialog>` и `[popover]` (верхний слой). */
function shown(html) {
  let out = html;
  for (const [tag, open] of [["details", /<details(?![^>]*\bopen\b)[^>]*>/u], ["dialog", /<dialog(?![^>]*\bopen\b)[^>]*>/u], ["div", /<div[^>]*\bpopover="auto"[^>]*>/u]]) {
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
  assert.deepEqual(feed.items[0], { kind: "chat", at: CHAT.last.createdAt, author: "Студент", text: "Можно в пятницу?" });
});

test("the feed is honest about what was not read and where the rest lives", () => {
  const base = { notes: [NOTE("Заметка", "2026-09-10T04:00:00.000Z")], documents: DOCS, handoffAnswer: null, chat: CHAT };
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
  for (const [look, surfaces] of [["current", current], ["next", next]]) {
    const html = surfaces.get("curator-accept");
    assert.equal(solidRed(shown(html)), 1, `${look}: one solid red`);
    assert.match(html, /data-testid="v3-case-actions"><button type="button" aria-haspopup="dialog" class="[^"]*bg-accent[^"]*" data-testid="v3-case-primary">Принять дело<\/button>/u, look);
    const drawer = html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>"));
    assert.match(drawer, /data-testid="v3-case-accept-drawer"/u);
    assert.equal(solidRed(drawer), 0, `${look}: the panel has no second red`);
    for (const field of ["student_case_id", "assignment_event_id", "expected_acknowledgement_id", "request_id", "decision", "agreed_contact_date"]) {
      assert.match(drawer, new RegExp(`name="${field}"`, "u"), `${look}: ${field}`);
    }
    assert.match(drawer, /<input type="hidden" name="decision" value="accepted"\/>/u);
    assert.match(text(drawer), /Принять дело Нужно уточнить Отклонить .*Подтвердить приём Отмена/u);
    assert.equal((drawer.match(/aria-pressed="true"/gu) ?? []).length, 1, "one decision selected");
    assert.match(drawer, /class="v3-raised [^"]*bg-fg [^"]*"[^>]*>Подтвердить приём<\/button>/u, "confirm is the dark neutral button");
  }
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

test("otherwise no solid red: active, closed, needs a curator, Admin, preview", () => {
  for (const [look, surfaces] of [["current", current], ["next", next]]) {
    for (const name of ["curator", "closed", "closed-outcome", "needs-curator", "admin", "admin-declined", "unread", "preview-awaiting", "notes-page"]) {
      assert.equal(solidRed(shown(surfaces.get(name))), 0, `${look} ${name}`);
      assert.doesNotMatch(surfaces.get(name), /data-testid="v3-case-primary"/u, `${look} ${name}`);
    }
  }
});

test("no capability is lost: every action of the case overview is still on the page", () => {
  const curator = current.get("curator");
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
  assert.match(current.get("notes-page"), />К последним<\/a>/u);
  // «⋯»: «Завершить дело…» (246); у Admin — и «Доступ к порталу».
  assert.match(text(curator), /Завершить дело…/u);
  assert.match(text(current.get("admin")), /^Написать Задача по делу Доступ к порталу /u);
  // «Написать» и переписка, документы, заявки, договор — ссылки на свои вкладки.
  const admin = current.get("admin");
  for (const href of ["/v3/messages?case=cccccccc-2222-4222-8222-000000000001", "tab=documents", "tab=route", "tab=money"]) {
    assert.ok(admin.includes(href), href);
  }
  // Ответ на передачу можно изменить; назначение куратора и «Нагрузка кураторов» — у того, кто назначает.
  assert.match(text(curator), /Изменить ответ/u);
  assert.match(text(current.get("needs-curator")), /Назначить куратора/u);
  assert.match(text(current.get("needs-curator")), /Куратор нужен куратор/u);
  assert.match(text(admin), /Нагрузка кураторов/u);
  // Доступ к порталу и данные продажи — прежние формы в свёрнутых группах; закрытое дело — «Вернуть в работу».
  assert.match(admin, /id="portal-access"[\s\S]*?Проверить и подготовить доступ/u);
  assert.match(admin, /id="sales-data"[\s\S]*?id="sale-conditions"/u);
  assert.match(text(current.get("closed-outcome")), /Вернуть в работу/u);
  // Другие вкладки не меняются: адреса проверки выпуска и их testid — прежние.
  const profile = read("src/components/v3/profile/Profile.tsx");
  assert.match(profile, /\{current === "route" \? universityProgramsTab : null\}/u);
  assert.match(read("src/components/v3/profile/UniversityProgramsTab.tsx"), /data-testid="v3-universities-programs"/u);
  assert.match(read("src/components/v3/profile/ProfileContractWorkspace.tsx"), /data-testid="v3-profile-contract-workspace"/u);
});

test("a role preview writes nothing: no answer, no task, no note — the stage and the facts stay", () => {
  const preview = current.get("preview-awaiting");
  assert.doesNotMatch(preview, /v3-case-primary|v3-case-accept-drawer|data-testid="v3-case-task"|name="request_id" value="12121212-5555-4555-8555-000000000014"/u);
  assert.doesNotMatch(preview, />Изменить<\/button>/u);
  assert.match(text(preview), /Этап Документы Что дальше Собрать апостиль на аттестат/u);
  assert.match(text(preview), /Сведения Направление Китай/u);
});

test("the header: stage words in both looks, the track only in the new one; the feed is the page's last part", () => {
  const plain = current.get("curator");
  assert.match(text(plain), /Этап Документы Что дальше/u);
  assert.doesNotMatch(plain, /v3-track/u);
  const track = next.get("curator");
  assert.match(track, /<div class="v3-track" data-track="admissions">/u);
  assert.match(track, /<span class="t-body-compact text-fg">Документы<\/span>/u, "the stage word stays under the track");
  // От 1280 px: работа слева, «Сведения» справа за линией, лента — сразу под работой.
  assert.match(plain, /xl:grid-cols-\[minmax\(0,1fr\)_22rem\] xl:grid-rows-\[auto_1fr\]/u);
  const order = ["v3-case-tasks-part", "v3-case-facts", "v3-case-feed"].map((id) => plain.indexOf(`data-testid="${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "work, facts, feed in reading order");
  // Лента: видны первые строки, остальное — «Показать ещё» (раскрытие браузера).
  const admin = current.get("admin");
  const visibleItems = shown(admin).match(/data-feed="/gu)?.length ?? 0;
  assert.equal(visibleItems, CASE_FEED_SHOWN);
  assert.match(admin, /data-testid="v3-case-feed-more"><summary[^>]*>Показать ещё \d+<\/summary>/u);
  assert.match(text(admin), /Более ранние события журнала дела — во вкладке «История»/u);
});

test("no invented progress: the documents bar is the read checklist, and there is no bar without it", () => {
  const counts = caseChecklistCounts([{ kind: "active", title: "Документы", items: Array.from({ length: 12 }, (_, index) => ({
    status: index < 7 ? "approved" : index < 9 ? "submitted" : index < 10 ? "correction_required" : "required",
  })) }]);
  const bar = next.get("curator").match(/data-progress="(\d+)\/(\d+)"/u);
  assert.ok(bar, "the new look draws the bar from the read counts");
  assert.deepEqual([Number(bar[1]), Number(bar[2])], [counts.approved, counts.total]);
  assert.match(text(next.get("curator")), /Документы 7 из 12 принято 2 на проверке 1 исправить 2 не загружено Документы дела/u);
  // Прежний облик — строка без полосы; нет права на документы — ни полосы, ни числа.
  assert.doesNotMatch(current.get("curator"), /v3-progress/u);
  assert.doesNotMatch(next.get("unread"), /v3-progress|из \d+ принято/u);
  // Оплата — только тому, кому её отдаёт чтение; «Передал» — только у дела из продаж.
  assert.doesNotMatch(text(current.get("curator")), /Оплата /u);
  assert.match(text(current.get("admin")), /Оплата 40% оплачено · остаток 900 \$/u);
  assert.doesNotMatch(text(current.get("unread")), /Передал/u);
});
