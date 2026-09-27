import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  STUDENTS_DOCS_VIEWS,
  STUDENTS_DOCS_VIEW_LABELS,
  docsPackagesCount,
  docsRowMatches,
  docsTabCounts,
  parseStudentsQueueParams,
  parseStudentsReturnTo,
  studentsDocsCell,
  studentsDocsTabs,
} from "../src/components/v3/students/students-queue-view.ts";
import {
  CalendarContractDeniedError,
  CalendarContractError,
  listCalendarApplicationDeadlinePage,
  normalizeCalendarApplicationDeadlineRow,
} from "../src/lib/v3/calendar-contract.ts";
import {
  TODAY_BANDS,
  TODAY_EMPTY_BANDS,
  buildTodayQueue,
  todayBandsDependingOn,
  todayDeadlineItems,
  todayLeadItems,
  todayWhen,
} from "../src/lib/v3/today-queue.ts";
import { TODAY_DEADLINE_READ_PAGES, TodaySourceDenied, readTodayQueue, todayAccess } from "../src/lib/v3/today-source.ts";
import roleTemplates from "./e2e/staff-role-templates.cjs";

/**
 * Э3 (27.09.2026): EVO Docs «Не хватает · Комплекты» и «Сегодня» со сроками
 * вузов на 14 дней. Логика вкладок, чисел, группы и прав проверяется
 * напрямую; разметка — настоящим рендером (tests/e2e/e3d-static-render.cjs
 * --json, оба облика) в отдельном node-процессе. Права самого чтения сроков
 * в обе стороны — набор supabase/tests/platform_today_university_deadlines.sql
 * на реальном Postgres (scripts/test-postgres-authorization.sh). Это не живая
 * проверка Supabase, прав или данных.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const render = (look) => new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/e3d-static-render.cjs", import.meta.url)), "--json", ...(look ? [`--look=${look}`] : [])],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
const surfaces = render(null);
const next = render("next");
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
const tabsOf = (html) => {
  const nav = html.match(/<nav id="admissions-summary"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  return [...nav.matchAll(/<a [^>]*>([^<]+)(?:<span class="tabular-nums text-fg-3">(\d+)<\/span>)?<\/a>/gu)].map((match) => [match[1], match[2] ?? null]);
};

// --- EVO Docs ------------------------------------------------------------

const docs = (total, approved, submitted = 0, correctionRequired = 0, rejected = 0) => ({
  total, approved, submitted, correctionRequired, rejected, missing: total - approved - submitted - correctionRequired - rejected,
});
const ready = (items, nextCursor = null) => ({ kind: "ready", queue: { items, nextCursor } });

test("EVO Docs: one review queue — «На проверку · Исправить · Не хватает · Комплекты · Все»", () => {
  assert.deepEqual(STUDENTS_DOCS_VIEWS, ["review", "fix", "missing", "packages", "all"]);
  assert.deepEqual(STUDENTS_DOCS_VIEWS.map((view) => STUDENTS_DOCS_VIEW_LABELS[view]), ["На проверку", "Исправить", "Не хватает", "Комплекты", "Все"]);
  assert.deepEqual(tabsOf(surfaces.get("docs-review")), [["На проверку", "2"], ["Исправить", "2"], ["Не хватает", "5"], ["Комплекты", "3"], ["Все", "7"]]);
  // Both new views are addresses of their own: the page opens them and the case returns to them.
  for (const view of ["missing", "packages"]) {
    const parse = parseStudentsQueueParams({ section: "docs", view }, "docs", { admin: false, coverage: false });
    assert.equal(parse.kind, "ok", view);
    assert.equal(parse.params.view, view);
    assert.equal(parseStudentsReturnTo(`/v3/profile?section=docs&view=${view}`), `/v3/profile?section=docs&view=${view}`);
  }
});

test("«Не хватает» counts checklist slots without an uploaded document — only from a complete read", () => {
  const rows = [
    { documents: docs(10, 4) }, // 6 не загружено
    { documents: docs(9, 6, 0, 0, 1) }, // 2 не загружено, 1 отклонён
    { documents: docs(11, 11) }, // всё принято
    { documents: docs(0, 0) }, // чек-лист не собран: требований нет — не «не хватает»
    { documents: null }, // нет права читать документы
  ];
  assert.deepEqual(rows.map((row) => docsRowMatches("missing", row)), [true, true, false, false, false]);
  assert.equal(docsRowMatches("packages", rows[0]), false, "packages never select cases");
  assert.deepEqual(docsTabCounts(rows, true, { views: { active: 5 } }), { review: 0, fix: 1, missing: 2, packages: null, all: 5 });
  // A next page exists (or a later page is shown): the review tabs have no number — never a guessed one.
  assert.deepEqual(docsTabCounts(rows, false, { views: { active: 250 } }), { review: null, fix: null, missing: null, packages: null, all: 250 });
  // No readable documents at all: no number instead of «0».
  assert.equal(docsTabCounts([{ documents: null }], true, null).missing, null);
  // The tab's number leads the documents cell in the ordinary colour.
  const cell = studentsDocsCell("missing", docs(12, 7, 2, 1, 0));
  assert.deepEqual(cell.lead.map((part) => [part.text, part.tone]), [["2\u00a0не\u00a0загружено", "default"]]);
  assert.deepEqual(cell.rest.map((part) => part.text), ["7 из 12 принято", "2\u00a0на проверке", "1\u00a0исправить"]);
  // Rendered: five cases lack documents, each row leads with its number.
  const html = surfaces.get("docs-missing");
  const rendered = [...html.matchAll(/data-testid="v3-student-case-row"[\s\S]*?<\/tr>/gu)].map((match) => match[0]);
  assert.equal(rendered.length, 5);
  assert.ok(rendered.every((row) => /<span class="block t-item"><span><span class="inline-block font-medium text-fg">\d+\u00a0не\u00a0загружено<\/span>/u.test(row)));
  assert.match(html, /<h1[^>]*>EVO Docs<span[^>]*>5<\/span><\/h1>/u, "the header number is the tab's number");
  const empty = surfaces.get("docs-missing-empty");
  assert.match(text(empty), /Незагруженных документов по чек-листам нет/u);
  assert.deepEqual(tabsOf(empty)[2], ["Не хватает", "0"], "a complete read with nothing missing is a true zero");
});

test("«Комплекты» reuses the board's queue: number only without a next page, one row action into the case", () => {
  const item = { package: { itemCount: 3 } };
  assert.equal(docsPackagesCount(ready([item, item])), 2);
  assert.equal(docsPackagesCount(ready([item], { createdAt: "2026-09-20T00:00:00.000Z", id: "x" })), null, "a longer queue has no number");
  for (const kind of ["hidden", "denied", "error"]) assert.equal(docsPackagesCount({ kind }), null, kind);
  // Not readable by this account (no document.read.full, or role preview): no tab, as on the board.
  const params = parseStudentsQueueParams({ section: "docs" }, "docs", { admin: true, coverage: true }).params;
  const counts = { review: 1, fix: 0, missing: 2, packages: null, all: 3 };
  assert.deepEqual(studentsDocsTabs(params, counts, { packages: false }).map((tab) => tab.key), ["review", "fix", "missing", "all"]);
  assert.deepEqual(studentsDocsTabs(params, counts, { packages: true }).map((tab) => tab.key), ["review", "fix", "missing", "packages", "all"]);
  assert.deepEqual(tabsOf(surfaces.get("docs-no-packages")).map(([label]) => label), ["На проверку", "Исправить", "Не хватает", "Все"]);

  const html = surfaces.get("docs-packages");
  // The same state for every row is said once above the table, not in each row.
  assert.match(html, /Отправлены на проверку EVO, решения ещё нет\. Порядок: сначала недавно отправленные/u);
  assert.doesNotMatch(html, /data-testid="v3-student-package-row"[\s\S]*Отправлен на проверку EVO/u);
  // Case filters do not apply to packages: no toolbar on this tab.
  assert.doesNotMatch(html, /Студент или страна|>Направление<|>Куратор</u);
  const rows = [...html.matchAll(/<tr role="row" data-queue-row="[^"]+" data-testid="v3-student-package-row" data-student-case-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gu)];
  assert.equal(rows.length, 3);
  for (const [, caseId, body] of rows) {
    assert.equal([...body.matchAll(/data-queue-open=""/gu)].length, 1, caseId);
    // «Открыть документы» — the program preparation of the case, where the package is reviewed; back to this tab.
    assert.match(body, new RegExp(`href="/v3/profile\\?case=${caseId}&amp;tab=route&amp;section=docs&amp;returnTo=%2Fv3%2Fprofile%3Fsection%3Ddocs%26view%3Dpackages#preparation-[0-9a-f-]{36}">Открыть документы`, "u"));
    assert.match(body, /\d+\u00a0документ(?:а|ов)?<span class="text-fg-3"> · <\/span>Набор: /u);
    assert.match(body, /<time dateTime="[^"]+" class="font-mono tabular-nums text-fg">\d\d\.\d\d<\/time>/u);
  }
  assert.match(html, /<span class="font-medium text-warn">Прежняя редакция требований<\/span>/u, "an old-requirements package is flagged");
  assert.doesNotMatch(html, /v3-progress/u, "no «N из M» bar: the queue does not read accepted documents");
  assert.match(html, /<h1[^>]*>EVO Docs<span[^>]*>3<\/span><\/h1>/u);

  const more = surfaces.get("docs-packages-more");
  assert.deepEqual(tabsOf(more)[3], ["Комплекты", null], "20 rows and a next page — no number");
  assert.doesNotMatch(more, /<h1[^>]*>EVO Docs<span/u);
  assert.match(more, /Показаны последние 20 комплектов; вся очередь — на доске поступления\.[\s\S]*href="\/v3\/admissions-pipeline\?view=packages"[^>]*>Все комплекты на проверку<\/a>/u);
  assert.match(surfaces.get("docs-packages-error"), /data-testid="queue-error"[\s\S]*Не удалось загрузить комплекты на проверку\./u);
  // The page reads the queue with the board's own gate and action.
  const source = read("src/lib/v3/students-queue-source.ts");
  assert.match(source, /if \(isStaffPreview\(actor\) \|\| !staffHasPermission\(actor, "document\.read\.full"\)\) return Object\.freeze\(\{ kind: "hidden" \}\);/u);
  assert.match(source, /readStaffApplicationPackageQueueAction\(\{ organizationId: actor\.organizationId, membershipId: actor\.membershipId \}\)/u);
  assert.match(read("src/app/(v3)/v3/profile/page.tsx"), /params\.mode === "docs" \? readDocsPackages\(actor\) : Promise\.resolve\(undefined\)/u);
});

test("EVO Docs, new look: «N из M принято» is a bar only from read checklist numbers; the current look keeps its line", () => {
  const current = surfaces.get("docs-missing");
  assert.doesNotMatch(current, /v3-progress/u, "the current look is unchanged: no bar");
  assert.match(current, /9 из 12 принято/u);
  const html = next.get("docs-missing");
  const bars = [...html.matchAll(/<span class="v3-progress" data-progress="(\d+)\/(\d+)"><span class="t-body-compact text-fg">(\d+) из (\d+) принято<\/span>/gu)];
  assert.equal(bars.length, 5);
  for (const [, done, total, label, labelTotal] of bars) {
    assert.equal(done, label);
    assert.equal(total, labelTotal);
  }
  // No numbers (an empty checklist): the previous line, no bar.
  const all = next.get("docs-all");
  assert.match(all, /Чек-лист не собран/u);
  assert.doesNotMatch(all, /data-progress="0\/0"/u);
  assert.equal([...all.matchAll(/class="v3-progress"/gu)].length, 6, "six of seven cases have a checklist");
});

// --- «Сегодня»: сроки вузов ----------------------------------------------

// Воскресенье 27.09.2026, 10:00 по Бишкеку.
const NOW = new Date("2026-09-27T04:00:00.000Z");
const TODAY = "2026-09-27";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const caseId = (n) => `dddddddd-2222-4222-8222-${String(n).padStart(12, "0")}`;
const deadline = (n, fields) => {
  const applicationId = `eeeeeeee-7777-4777-8777-${String(n).padStart(12, "0")}`;
  const kind = fields.kind ?? "application";
  return {
    sourceKey: `${kind === "application" ? "application" : "visa"}:${applicationId}:${kind}`, deadlineKind: kind, applicationId,
    studentCaseId: caseId(fields.caseNo ?? n), studentDisplayName: fields.student ?? `Студент ${n}`, universityName: fields.university ?? `Университет ${n}`,
    programName: fields.program ?? "", status: kind === "application" ? "preparation" : null, deadline: fields.day,
  };
};
const readOf = (source, items, state = "complete") => ({ source, state, items });
const bandOf = (queue, band) => queue.bands.find((entry) => entry.band === band) ?? null;

test("deadline rows: application deadlines from today to today + 14, with university, student and the day", () => {
  const items = todayDeadlineItems([
    deadline(1, { day: TODAY, university: "Университет Примера", program: "Foundation in Business", student: "Алина Образцова" }),
    deadline(2, { day: "2026-10-11" }), // ровно 14 дней
    deadline(3, { day: "2026-10-12" }), // дальше горизонта
    deadline(4, { day: "2026-09-26" }), // вчера — это «Просрочен дедлайн» студента, не группа сроков
    deadline(5, { day: "2026-09-30", kind: "passport_expiry" }), // срок паспорта — не срок вуза
    deadline(6, { day: "2026-10-01", kind: "offer" }), // ответ на оффер — не срок подачи
    deadline(7, { day: "2026-10-02" }), // без программы
  ], TODAY);
  assert.deepEqual(items.map((item) => [item.title, item.due.dueOn]), [["Университет Примера", TODAY], ["Университет 2", "2026-10-11"], ["Университет 7", "2026-10-02"]]);
  const first = items[0];
  assert.equal(first.key, `deadline:application:${"eeeeeeee-7777-4777-8777-000000000001"}:application`);
  assert.equal(first.band, "deadlines");
  assert.equal(first.reason, "срок подачи · Foundation in Business");
  assert.equal(items[2].reason, "срок подачи", "no program — no empty part");
  assert.deepEqual(first.who, { name: "Алина Образцова", href: `/v3/profile?case=${caseId(1)}&tab=overview` });
  assert.equal(first.openHref, `/v3/profile?case=${caseId(1)}&tab=route#applications`);
  assert.deepEqual(todayWhen(first, NOW), { dateTime: TODAY, text: "27.09", word: "сегодня", overdue: false });
  assert.equal(todayWhen(items[1], NOW).word, "через 14 дн");
  assert.throws(() => todayDeadlineItems([deadline(1, { day: TODAY }), deadline(1, { day: TODAY })], TODAY), /duplicate deadline/u);
});

test("the «Сроки вузов · 14 дней» band: its own read decides its number, and an empty complete read says so", () => {
  assert.deepEqual(TODAY_BANDS, ["overdue", "today", "waiting", "no_step", "deadlines", "upcoming"]);
  assert.deepEqual(todayBandsDependingOn("deadlines"), ["deadlines"], "no other read touches the deadlines band");
  const rows = todayDeadlineItems([deadline(1, { day: TODAY }), deadline(2, { day: "2026-10-01" })], TODAY);
  const complete = buildTodayQueue([readOf("deadlines", rows)], NOW);
  assert.deepEqual(bandOf(complete, "deadlines"), {
    band: "deadlines", label: "Сроки вузов · 14 дней", count: 2, danger: false, note: null, items: bandOf(complete, "deadlines").items,
  });
  // Partial: rows are shown, the number is not; the notice names it and links nowhere (no list of all deadlines).
  const partial = buildTodayQueue([readOf("deadlines", rows, "partial")], NOW);
  assert.equal(bandOf(partial, "deadlines").count, null);
  assert.deepEqual(partial.notices, [{ source: "deadlines", kind: "partial", text: "Сроки вузов прочитаны не полностью: показана прочитанная часть, число скрыто.", link: null }]);
  // Empty complete read: the band stays, without a number, in words.
  const empty = buildTodayQueue([readOf("deadlines", [])], NOW);
  assert.deepEqual(empty.bands, [{ band: "deadlines", label: "Сроки вузов · 14 дней", count: null, danger: false, note: TODAY_EMPTY_BANDS.deadlines.note, items: [] }]);
  assert.equal(TODAY_EMPTY_BANDS.deadlines.note, "Записанных сроков подачи на ближайшие 14 дней нет.");
  // Empty partial, failed, denied or preview read: no band — nothing is claimed about deadlines.
  for (const state of ["partial"]) assert.equal(bandOf(buildTodayQueue([readOf("deadlines", [], state)], NOW), "deadlines"), null, state);
  for (const state of ["error", "denied", "preview"]) {
    const queue = buildTodayQueue([{ source: "deadlines", state }], NOW);
    assert.equal(bandOf(queue, "deadlines"), null, state);
    assert.equal(queue.notices[0].source, "deadlines");
  }
  assert.deepEqual(buildTodayQueue([{ source: "deadlines", state: "error" }], NOW).notices[0], {
    source: "deadlines", kind: "error", text: "Сроки вузов не загрузились.", link: { label: "Повторить", href: "/v3/main" },
  });
  // Without the source (a role it does not belong to) there is no band at all.
  assert.equal(bandOf(buildTodayQueue([readOf("tasks", [])], NOW), "deadlines"), null);
});

test("a university deadline today is work of the day; later ones are the horizon and feed «Ближайший срок»", () => {
  const today = buildTodayQueue([readOf("deadlines", todayDeadlineItems([deadline(1, { day: TODAY })], TODAY))], NOW);
  assert.equal(today.actionEmpty, false, "«На сегодня всё» is never said over a deadline due today");
  const later = buildTodayQueue([
    readOf("deadlines", todayDeadlineItems([deadline(1, { day: "2026-10-03" })], TODAY)),
    readOf("leads", todayLeadItems([], TODAY)),
  ], NOW);
  assert.equal(later.actionEmpty, true);
  assert.deepEqual(later.nearest, { day: "2026-10-03", weekday: "сб", date: "03.10" });
});

const actor = (fields) => ({
  authUserId: ME, profileId: ME, membershipId: ME, organizationId: ORG, displayName: "Сотрудник", platformAccessVersion: 1,
  email: "synthetic@example.invalid", presentationRole: null, systemRole: "staff", assignments: [], permissionKeys: [], ...fields,
});

test("who reads deadlines: case readers who manage applications — the read's own gate; no widening", () => {
  const has = (fields) => todayAccess(actor(fields)).sources.includes("deadlines");
  assert.equal(has({ systemRole: "admin" }), true);
  assert.equal(has({ permissionKeys: roleTemplates.staffRoleKeys("admissions") }), true);
  assert.equal(has({ permissionKeys: roleTemplates.staffRoleKeys("admissions-manager") }), true);
  assert.equal(has({ permissionKeys: roleTemplates.staffRoleKeys("sales") }), false);
  assert.equal(has({ permissionKeys: roleTemplates.staffRoleKeys("sales-manager") }), false);
  // Reading cases alone is not the right to this read (145 gates on application.manage) — and the reverse.
  assert.equal(has({ permissionKeys: ["case.read.full", "profile.read.full"] }), false);
  assert.equal(has({ permissionKeys: ["application.manage"] }), false);
  assert.equal(has({ permissionKeys: ["case.read.full", "application.manage"] }), true);
  assert.equal(has({ systemRole: "admin", presentationRole: "sales" }), false);
  assert.equal(has({ systemRole: "admin", presentationRole: "admissions" }), true, "the preview names the source, it does not read it");
});

function readers(overrides = {}) {
  const calls = [];
  return {
    calls,
    readers: {
      async listStaffTasks() { return { rows: [], nextCursor: null }; },
      async listCaseTasks() { return { rows: [], nextCursor: null }; },
      async readStudentCaseQueue(_actor, request) { return { view: request.view, sort: "due", today: TODAY, rows: [], nextCursor: null }; },
      async readLeads() { return { leads: [], truncated: false }; },
      async readChats() { return { rows: [], truncated: false }; },
      async readDeadlines(_actor, options) { calls.push(options); return { rows: [deadline(1, { day: TODAY })], nextCursor: null }; },
      ...overrides,
    },
  };
}

test("readTodayQueue: the deadline window, the 3-page limit, a server refusal and the role preview", async () => {
  const curator = actor({ permissionKeys: roleTemplates.staffRoleKeys("admissions") });
  const complete = readers();
  const { reads } = await readTodayQueue(curator, { now: NOW, readers: complete.readers });
  assert.deepEqual(reads.find((entry) => entry.source === "deadlines").state, "complete");
  assert.deepEqual(complete.calls, [{ from: TODAY, to: "2026-10-11", cursor: null }]);

  let pages = 0;
  const endless = readers({
    async readDeadlines(_actor, options) {
      pages += 1;
      return { rows: [deadline(pages, { day: TODAY })], nextCursor: { deadline: TODAY, sourceKey: `application:${options.cursor?.sourceKey ?? "x"}` } };
    },
  });
  const partial = (await readTodayQueue(curator, { now: NOW, readers: endless.readers })).reads.find((entry) => entry.source === "deadlines");
  assert.equal(pages, TODAY_DEADLINE_READ_PAGES);
  assert.equal(partial.state, "partial");
  assert.equal(partial.items.length, 3);

  const denied = readers({ async readDeadlines() { throw new TodaySourceDenied(); } });
  assert.equal((await readTodayQueue(curator, { now: NOW, readers: denied.readers })).reads.find((entry) => entry.source === "deadlines").state, "denied");
  const failed = readers({ async readDeadlines() { throw new Error("offline"); } });
  assert.equal((await readTodayQueue(curator, { now: NOW, readers: failed.readers })).reads.find((entry) => entry.source === "deadlines").state, "error");

  // The role preview: the read would answer with the Admin's scope — it is not made.
  const preview = readers();
  const shown = await readTodayQueue(actor({ systemRole: "admin", presentationRole: "admissions" }), { now: NOW, readers: preview.readers });
  assert.equal(shown.reads.find((entry) => entry.source === "deadlines").state, "preview");
  assert.deepEqual(preview.calls, []);
  // Sales never reads deadlines.
  const sales = readers();
  await readTodayQueue(actor({ permissionKeys: roleTemplates.staffRoleKeys("sales-manager") }), { now: NOW, readers: sales.readers });
  assert.deepEqual(sales.calls, []);
  // Production: the existing 145 read through the calendar adapter; its 42501 is a refusal, not an error.
  const source = read("src/lib/v3/today-source.ts");
  assert.match(source, /calendar\.listCalendarApplicationDeadlinePage\(actor, \{ \.\.\.options, pageSize: TODAY_DEADLINE_PAGE_SIZE \}\)/u);
  assert.match(source, /if \(error instanceof calendar\.CalendarContractDeniedError\) throw new TodaySourceDenied\(\);/u);
});

test("calendar adapter: an application without a program is a row, and a 42501 is a refusal", async () => {
  const row = {
    source_key: "application:12400000-0000-4000-8000-000000000301:application", deadline_kind: "application",
    application_id: "12400000-0000-4000-8000-000000000301", student_case_id: "12400000-0000-4000-8000-000000000201",
    student_display_name: "Синтетический студент", university_name: "Университет Примера", program_name: null,
    application_status: "ready", deadline: "2026-10-01",
  };
  assert.equal(normalizeCalendarApplicationDeadlineRow(row).programName, "", "NULL program since 190 — not a failed read");
  assert.throws(() => normalizeCalendarApplicationDeadlineRow({ ...row, program_name: 7 }), CalendarContractError);
  const curator = actor({ permissionKeys: ["case.read.full", "application.manage"] });
  const client = (response) => ({ schema: () => ({ rpc: async () => response }) });
  const deniedCall = listCalendarApplicationDeadlinePage(curator, { from: TODAY, to: "2026-10-11" }, { client: client({ data: null, error: { code: "42501", message: "Admissions runtime authority is required" } }) });
  await assert.rejects(deniedCall, CalendarContractDeniedError);
  await assert.rejects(
    listCalendarApplicationDeadlinePage(curator, { from: TODAY, to: "2026-10-11" }, { client: client({ data: null, error: { code: "57014" } }) }),
    (error) => error instanceof CalendarContractError && !(error instanceof CalendarContractDeniedError),
  );
  const page = await listCalendarApplicationDeadlinePage(curator, { from: TODAY, to: "2026-10-11" }, { client: client({ data: [row], error: null }) });
  assert.equal(page.rows[0].programName, "");
});

test("static render: the deadlines band in «Сегодня» — mono date and word, university, student link, empty and failed states", () => {
  for (const [look, html] of [["current", surfaces.get("today-deadlines")], ["next", next.get("today-deadlines")]]) {
    const headers = [...html.matchAll(/<h2 id="today-band-[a-z_]+"[^>]*>([\s\S]*?)<\/h2>/gu)].map((match) => text(match[1]));
    assert.deepEqual(headers, ["Просрочено · 1", "Сегодня · вс 27.09 · 1", "Сроки вузов · 14 дней · 4", "Ближайшие 14 дней · 1"], look);
    const band = html.slice(html.indexOf('id="today-band-deadlines"'), html.indexOf('id="today-band-upcoming"'));
    const rows = [...band.matchAll(/<li data-queue-row="deadline:[^"]+" data-today-source="deadlines"[\s\S]*?<\/li>/gu)].map((match) => match[0]);
    assert.equal(rows.length, 4, `${look}: the passport date is not a university deadline`);
    assert.match(rows[0], /<time dateTime="2026-09-27" class="block font-mono tabular-nums text-fg">27\.09<\/time><span class="flex min-h-6 items-center t-meta text-fg-3">сегодня<\/span>/u);
    assert.match(rows[0], /<p title="Университет Примера" class="[^"]*t-item[^"]*">Университет Примера<\/p>/u);
    assert.match(rows[0], /href="\/v3\/profile\?case=cccccccc-3333-4333-8333-000000000001&amp;tab=overview"[^>]*><span class="truncate">Алина Образцова<\/span><\/a>/u);
    assert.match(rows[0], /data-today-reason="">срок подачи<\/span><span [^>]*data-today-reason="">Foundation in Business<\/span>/u);
    assert.match(rows[0], /aria-label="Открыть: Университет Примера — Алина Образцова"[^>]*href="\/v3\/profile\?case=cccccccc-3333-4333-8333-000000000001&amp;tab=route#applications"/u);
    // On a narrow row the word stays: the band title does not name the day.
    assert.match(rows[1], /<span class="[^"]*@min-\[32rem\]:hidden[^"]*"><time dateTime="2026-09-29" class="font-mono tabular-nums">29\.09<\/time><span>через 2 дн<\/span><\/span>/u);
    assert.doesNotMatch(band, /text-danger|bg-accent/u, `${look}: nothing red in a band of future deadlines`);
  }
  const empty = surfaces.get("today-deadlines-empty");
  assert.match(text(empty), /На сегодня всё Открыть студентов Сроки вузов · 14 дней Записанных сроков подачи на ближайшие 14 дней нет\./u);
  assert.doesNotMatch(empty, /today-band-deadlines[^>]*>[\s\S]*?· 0/u, "an empty band says it in words, not «0»");
  const partial = surfaces.get("today-deadlines-partial");
  assert.match(partial, /data-today-notice="partial" data-today-source="deadlines"[^>]*><span class="text-fg-2">Сроки вузов прочитаны не полностью: показана прочитанная часть, число скрыто\.<\/span><\/p>/u);
  assert.match(text(partial), /Сроки вузов · 14 дней 27\.09/u, "rows without a number");
  const failed = surfaces.get("today-deadlines-error");
  assert.match(failed, /data-today-notice="error" data-today-source="deadlines"[^>]*><span class="text-danger">Сроки вузов не загрузились\.<\/span><a [^>]*href="\/v3\/main"[^>]*>Повторить<\/a>/u);
  assert.doesNotMatch(failed, /today-band-deadlines|Записанных сроков/u, "a failed read claims nothing");
  assert.match(text(failed), /Просрочено · 1/u, "the rest of the queue stays");
});

test("real-Postgres suite: the deadline read's authorization both ways runs on the latest chain", () => {
  const script = read("scripts/test-postgres-authorization.sh");
  const suite = read("supabase/tests/platform_today_university_deadlines.sql");
  const loopEnd = script.indexOf("find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort\n)");
  const run = script.indexOf("-f /workspace/supabase/tests/platform_today_university_deadlines.sql");
  const policies = script.indexOf("-f /workspace/supabase/tests/authorization_policies.sql");
  assert.ok(loopEnd > 0 && run > loopEnd && run < policies, "after every migration, before the policy inventory");
  for (const proof of [
    /Admissions A resolves with platform_role NULL/u,
    /t3d_band\(\) = pg_temp\.t3d_ids\(801, 803, 809\)/u,
    /Admissions B reads only the own case 502/u,
    /the Admissions Manager reads the active cases curated in its department/u,
    /the Admin reads every active case; closed 504 and pending 506 never appear/u,
    /the Sales Manager \(no application\.manage\) is refused/u,
    /a member with case\.read\.full but without application\.manage is refused/u,
    /the Student is refused, even for the own case 505/u,
    /an authenticated user without membership is refused/u,
    /an anonymous caller is refused/u,
    /an application without a program is a row with a NULL program/u,
    /a submitted application no longer carries the application deadline/u,
    /SECURITY DEFINER, empty search_path, EXECUTE for authenticated only/u,
  ]) assert.match(suite, proof);
  assert.match(suite, /^BEGIN;$/mu);
  assert.match(suite, /^ROLLBACK;\s*$/mu);
  assert.doesNotMatch(suite, /@(?!example\.invalid)[a-z0-9.-]+\.[a-z]{2,}/iu, "synthetic addresses only");
});
