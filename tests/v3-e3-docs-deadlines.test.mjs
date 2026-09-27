import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DOCS_PACKAGE_READ_PAGES,
  STUDENTS_DOCS_VIEWS,
  STUDENTS_DOCS_VIEW_LABELS,
  docsPackagesCount,
  docsRowMatches,
  docsTabCounts,
  parseStudentsQueueParams,
  parseStudentsReturnTo,
  readDocsPackagePages,
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
  TODAY_DEADLINE_PAST_DAYS,
  TODAY_DEADLINE_SOON_DAYS,
  TODAY_EMPTY_BANDS,
  buildTodayQueue,
  todayBandsDependingOn,
  todayDeadlineItems,
  todayDeadlineSoon,
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
  assert.deepEqual(tabsOf(more)[3], ["Комплекты", null], "3 pages read and still a next page — no number");
  assert.equal([...more.matchAll(/data-testid="v3-student-package-row"/gu)].length, 60);
  assert.doesNotMatch(more, /<h1[^>]*>EVO Docs<span/u);
  assert.match(more, /Показаны последние 60 комплектов; вся очередь — на доске поступления\.[\s\S]*href="\/v3\/admissions-pipeline\?view=packages"[^>]*>Все комплекты на проверку<\/a>/u);
  // Two pages that end: the whole queue is read — the number shows and no board line.
  const pages = surfaces.get("docs-packages-pages");
  assert.deepEqual(tabsOf(pages)[3], ["Комплекты", "25"]);
  assert.equal([...pages.matchAll(/data-testid="v3-student-package-row"/gu)].length, 25);
  assert.match(pages, /<h1[^>]*>EVO Docs<span[^>]*>25<\/span><\/h1>/u);
  assert.doesNotMatch(pages, /Показаны последние|Все комплекты на проверку/u);
  assert.match(surfaces.get("docs-packages-error"), /data-testid="queue-error"[\s\S]*Не удалось загрузить комплекты на проверку\./u);
  // The page reads the queue with the board's own gate and action.
  const source = read("src/lib/v3/students-queue-source.ts");
  assert.match(source, /if \(isStaffPreview\(actor\) \|\| !staffHasPermission\(actor, "document\.read\.full"\)\) return Object\.freeze\(\{ kind: "hidden" \}\);/u);
  assert.match(source, /const owner = \{ organizationId: actor\.organizationId, membershipId: actor\.membershipId \};\n  return readDocsPackagePages\(\(cursor\) => readStaffApplicationPackageQueueAction\(owner, cursor\)\);/u);
  assert.match(read("src/app/(v3)/v3/profile/page.tsx"), /params\.mode === "docs" \? readDocsPackages\(actor\) : Promise\.resolve\(undefined\)/u);
});

const packageItem = (n) => ({ package: { packageId: `dddddddd-8888-4888-8888-${String(n).padStart(12, "0")}`, submittedAt: `2026-09-${String(27 - (n % 20)).padStart(2, "0")}T00:00:00.000Z`, itemCount: 3 } });
/** Страницы очереди комплектов по 20 из синтетического списка; `fail` — номер страницы (с 0), которая не читается. */
function packageReader(total, { fail = null, reason = "unavailable", throws = false } = {}) {
  const calls = [];
  const all = Array.from({ length: total }, (_, index) => packageItem(index + 1));
  return {
    calls,
    read: async (cursor) => {
      const page = calls.length;
      calls.push(cursor);
      if (page === fail) {
        if (throws) throw new Error("synthetic failure");
        return { ok: false, reason };
      }
      const start = page * 20;
      const items = all.slice(start, start + 20);
      return { ok: true, queue: { items, nextCursor: start + 20 < all.length ? { createdAt: items.at(-1).package.submittedAt, id: items.at(-1).package.packageId } : null } };
    },
  };
}

test("«Комплекты» reads up to 3 pages: the number after a complete multi-page read, none while a next page remains", async () => {
  assert.equal(DOCS_PACKAGE_READ_PAGES, 3);
  // 45 packages: three pages, the last without a next page — the whole queue, a number, oldest rows included.
  const whole = packageReader(45);
  const complete = await readDocsPackagePages(whole.read);
  assert.equal(whole.calls.length, 3);
  assert.equal(whole.calls[0], null, "the first page has no cursor");
  assert.deepEqual(whole.calls[1], { createdAt: packageItem(20).package.submittedAt, id: packageItem(20).package.packageId });
  assert.equal(complete.kind, "ready");
  assert.equal(complete.queue.items.length, 45);
  assert.equal(complete.queue.nextCursor, null);
  assert.equal(docsPackagesCount(complete), 45);
  // 61 packages: three pages and a next one — the read stops, the number stays hidden.
  const longer = packageReader(61);
  const partial = await readDocsPackagePages(longer.read);
  assert.equal(longer.calls.length, 3, "never more than 3 pages");
  assert.equal(partial.queue.items.length, 60);
  assert.notEqual(partial.queue.nextCursor, null);
  assert.equal(docsPackagesCount(partial), null);
  // A single short page ends the read at once.
  const short = packageReader(7);
  assert.equal(docsPackagesCount(await readDocsPackagePages(short.read)), 7);
  assert.equal(short.calls.length, 1);
  // The first page refused or failed: its own state, never an empty queue.
  assert.deepEqual(await readDocsPackagePages(packageReader(45, { fail: 0, reason: "forbidden" }).read), { kind: "denied" });
  assert.deepEqual(await readDocsPackagePages(packageReader(45, { fail: 0 }).read), { kind: "error" });
  assert.deepEqual(await readDocsPackagePages(packageReader(45, { fail: 0, throws: true }).read), { kind: "error" });
  // A later page fails: the read part is shown without a number; the board line names the rest.
  const broken = await readDocsPackagePages(packageReader(45, { fail: 1 }).read);
  assert.equal(broken.kind, "ready");
  assert.equal(broken.queue.items.length, 20);
  assert.notEqual(broken.queue.nextCursor, null);
  assert.equal(docsPackagesCount(broken), null);
  // A package repeated on the next page is shown once.
  let turn = 0;
  const repeated = await readDocsPackagePages(async () => {
    turn += 1;
    return turn === 1
      ? { ok: true, queue: { items: [packageItem(1), packageItem(2)], nextCursor: { createdAt: packageItem(2).package.submittedAt, id: packageItem(2).package.packageId } } }
      : { ok: true, queue: { items: [packageItem(2), packageItem(3)], nextCursor: null } };
  });
  assert.deepEqual(repeated.queue.items.map((item) => item.package.packageId), [1, 2, 3].map((n) => packageItem(n).package.packageId));
});

test("package row: on a narrow row the student heads it; the university and program read as ordinary text", () => {
  const html = surfaces.get("docs-packages");
  const rows = [...html.matchAll(/data-testid="v3-student-package-row"[\s\S]*?<\/tr>/gu)].map((match) => match[0]);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.match(row, /<span class="block truncate t-item text-fg" title="[^"]+">/u, "the student name is the row head");
    // Regular weight in the stack; the semibold weight only in the wide table's own column.
    assert.match(row, /<span class="line-clamp-2 break-words t-body-compact text-fg @min-\[48rem\]\/packages:font-semibold" title="[^"]+">/u);
    assert.doesNotMatch(row, /line-clamp-2 break-words t-item/u);
  }
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
    programName: fields.program ?? "", status: kind === "application" ? fields.status ?? "preparation" : null, deadline: fields.day,
  };
};
const readOf = (source, items, state = "complete") => ({ source, state, items });
const bandOf = (queue, band) => queue.bands.find((entry) => entry.band === band) ?? null;

test("deadline rows: application deadlines from today − 7 to today + 14, with university, student and the day", () => {
  assert.equal(TODAY_DEADLINE_PAST_DAYS, 7);
  const items = todayDeadlineItems([
    deadline(1, { day: TODAY, university: "Университет Примера", program: "Foundation in Business", student: "Алина Образцова" }),
    deadline(2, { day: "2026-10-11" }), // ровно 14 дней
    deadline(3, { day: "2026-10-12" }), // дальше горизонта
    deadline(4, { day: "2026-09-26", status: "ready" }), // вчера, заявление не подано — «прошёл», в группе
    deadline(5, { day: "2026-09-30", kind: "passport_expiry" }), // срок паспорта — не срок вуза
    deadline(6, { day: "2026-10-01", kind: "offer" }), // ответ на оффер — не срок подачи
    deadline(7, { day: "2026-10-02" }), // без программы
    deadline(8, { day: "2026-09-20" }), // ровно 7 дней назад — ещё в группе
    deadline(9, { day: "2026-09-19" }), // 8 дней назад — за окном
    deadline(10, { day: "2026-09-24", status: "submitted" }), // прошёл, но заявление подано — не работа по сроку
  ], TODAY);
  assert.deepEqual(items.map((item) => [item.title, item.due.dueOn]), [
    ["Университет Примера", TODAY], ["Университет 2", "2026-10-11"], ["Университет 4", "2026-09-26"], ["Университет 7", "2026-10-02"], ["Университет 8", "2026-09-20"],
  ]);
  assert.deepEqual(todayWhen(items[2], NOW), { dateTime: "2026-09-26", text: "26.09", word: "прошёл", overdue: true }, "a passed deadline says so in red");
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
  assert.equal(TODAY_EMPTY_BANDS.deadlines.note, "Записанных сроков подачи на ближайшие 14 дней и прошедших без подачи за 7 дней нет.");
  // Empty complete read beside other bands: the band stays, without a number, in words.
  const step = { key: "task:1", source: "tasks", band: "upcoming", title: "Шаг", who: null, reason: "шаг", due: { dueOn: "2026-10-01", dueAt: null }, since: null, waitingDays: null, openHref: "/v3/tasks", task: null };
  const beside = buildTodayQueue([readOf("tasks", [step]), readOf("deadlines", [])], NOW);
  assert.deepEqual(beside.bands.map((band) => band.band), ["deadlines", "upcoming"]);
  assert.deepEqual(bandOf(beside, "deadlines"), { band: "deadlines", label: "Сроки вузов · 14 дней", count: null, danger: false, note: TODAY_EMPTY_BANDS.deadlines.note, items: [] });
  assert.equal(beside.emptyNote, null);
  const busy = buildTodayQueue([readOf("tasks", [{ ...step, band: "overdue", due: { dueOn: "2026-09-25", dueAt: null } }]), readOf("deadlines", [])], NOW);
  assert.deepEqual(busy.bands.map((band) => band.band), ["overdue", "deadlines"], "work of the day keeps the empty band beside it");
  assert.equal(busy.emptyNote, null);
  // Empty day and an empty complete read: one empty state — the sentence goes under «На сегодня всё», no lone band.
  const empty = buildTodayQueue([readOf("deadlines", [])], NOW);
  assert.deepEqual(empty.bands, []);
  assert.equal(empty.emptyNote, TODAY_EMPTY_BANDS.deadlines.note);
  assert.equal(empty.actionEmpty, true);
  assert.equal(empty.complete, true);
  // The same with a partial other read: the sentence joins «В прочитанной части…» — the deadline read itself is complete.
  const partialDay = buildTodayQueue([readOf("tasks", [], "partial"), readOf("deadlines", [])], NOW);
  assert.deepEqual(partialDay.bands, []);
  assert.equal(partialDay.complete, false);
  assert.equal(partialDay.emptyNote, TODAY_EMPTY_BANDS.deadlines.note);
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
  assert.equal(buildTodayQueue([readOf("tasks", [])], NOW).emptyNote, null);
  for (const state of ["error", "denied", "preview"]) assert.equal(buildTodayQueue([{ source: "deadlines", state }], NOW).emptyNote, null, state);
  assert.equal(buildTodayQueue([readOf("deadlines", [], "partial")], NOW).emptyNote, null, "an empty partial read claims nothing");
});

test("a university deadline today or passed without submission is work of the day; later ones are the horizon and feed «Ближайший срок»", () => {
  const today = buildTodayQueue([readOf("deadlines", todayDeadlineItems([deadline(1, { day: TODAY })], TODAY))], NOW);
  assert.equal(today.actionEmpty, false, "«На сегодня всё» is never said over a deadline due today");
  // Passed yesterday and still «готово»: shown at the top of the band and it blocks «На сегодня всё».
  const passed = buildTodayQueue([readOf("deadlines", todayDeadlineItems([
    deadline(2, { day: "2026-10-03" }), deadline(1, { day: "2026-09-26", status: "ready" }),
  ], TODAY))], NOW);
  assert.equal(passed.actionEmpty, false, "«На сегодня всё» is never said over a missed deadline");
  assert.deepEqual(bandOf(passed, "deadlines").items.map((item) => item.due.dueOn), ["2026-09-26", "2026-10-03"], "the passed one first");
  assert.equal(bandOf(passed, "deadlines").count, 2);
  assert.equal(bandOf(passed, "deadlines").danger, false, "the band title stays neutral: red is the row's «прошёл»");
  assert.equal(bandOf(passed, "overdue"), null, "the deadline stays in its own band");
  // A submitted application's passed deadline stays out (145 carries none; the rows guard it too).
  const submitted = buildTodayQueue([readOf("deadlines", todayDeadlineItems([deadline(1, { day: "2026-09-26", status: "submitted" })], TODAY))], NOW);
  assert.equal(submitted.actionEmpty, true);
  assert.equal(submitted.emptyNote, TODAY_EMPTY_BANDS.deadlines.note);
  const later = buildTodayQueue([
    readOf("deadlines", todayDeadlineItems([deadline(1, { day: "2026-10-03" })], TODAY)),
    readOf("leads", todayLeadItems([], TODAY)),
  ], NOW);
  assert.equal(later.actionEmpty, true);
  assert.deepEqual(later.nearest, { day: "2026-10-03", weekday: "сб", date: "03.10" });
});

test("a university deadline today or within 2 days is a warning word; later ones are neutral, passed ones red", () => {
  assert.equal(TODAY_DEADLINE_SOON_DAYS, 2);
  const [passed, today, one, two, three] = todayDeadlineItems([
    deadline(1, { day: "2026-09-26" }), deadline(2, { day: TODAY }), deadline(3, { day: "2026-09-28" }),
    deadline(4, { day: "2026-09-29" }), deadline(5, { day: "2026-09-30" }),
  ], TODAY);
  assert.deepEqual([passed, today, one, two, three].map((item) => todayDeadlineSoon(item, NOW)), [false, true, true, true, false]);
  assert.equal(todayWhen(passed, NOW).overdue, true, "passed is red, not a warning");
  // Only the deadlines band carries this tone: an own step due tomorrow does not.
  assert.equal(todayDeadlineSoon({ band: "upcoming", due: { dueOn: "2026-09-28", dueAt: null } }, NOW), false);
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
  assert.deepEqual(complete.calls, [{ from: "2026-09-20", to: "2026-10-11", cursor: null }], "from today − 7: a missed deadline stays visible");

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
    assert.deepEqual(headers, ["Просрочено · 1", "Сегодня · вс 27.09 · 1", "Сроки вузов · 14 дней · 5", "Ближайшие 14 дней · 1"], look);
    const band = html.slice(html.indexOf('id="today-band-deadlines"'), html.indexOf('id="today-band-upcoming"'));
    const rows = [...band.matchAll(/<li data-queue-row="deadline:[^"]+" data-today-source="deadlines"[\s\S]*?<\/li>/gu)].map((match) => match[0]);
    assert.equal(rows.length, 5, `${look}: the passport date is not a university deadline`);
    // A missed deadline of an unsubmitted application: first, red date and «прошёл», on both widths.
    assert.match(rows[0], /<time dateTime="2026-09-24" class="block font-mono tabular-nums text-danger">24\.09<\/time><span class="flex min-h-6 items-center t-meta text-danger">прошёл<\/span>/u);
    assert.match(rows[0], /<span class="[^"]*@min-\[32rem\]:hidden text-danger"><time dateTime="2026-09-24" class="font-mono tabular-nums">24\.09<\/time><span>прошёл<\/span><\/span>/u);
    // Due today and in 2 days: the word is a warning; the date stays ordinary.
    assert.match(rows[1], /<time dateTime="2026-09-27" class="block font-mono tabular-nums text-fg">27\.09<\/time><span class="flex min-h-6 items-center t-meta text-warn">сегодня<\/span>/u);
    assert.match(rows[1], /<p title="Университет Примера" class="[^"]*t-item[^"]*">Университет Примера<\/p>/u);
    assert.match(rows[1], /href="\/v3\/profile\?case=cccccccc-3333-4333-8333-000000000001&amp;tab=overview"[^>]*><span class="truncate">Алина Образцова<\/span><\/a>/u);
    assert.match(rows[1], /data-today-reason="">срок подачи<\/span><span [^>]*data-today-reason="">Foundation in Business<\/span>/u);
    assert.match(rows[1], /aria-label="Открыть: Университет Примера — Алина Образцова"[^>]*href="\/v3\/profile\?case=cccccccc-3333-4333-8333-000000000001&amp;tab=route#applications"/u);
    // On a narrow row the word stays (the band title does not name the day), in the same warning tone.
    assert.match(rows[2], /<span class="[^"]*@min-\[32rem\]:hidden[^"]*"><time dateTime="2026-09-29" class="font-mono tabular-nums">29\.09<\/time><span class="text-warn">через 2 дн<\/span><\/span>/u);
    assert.match(rows[2], /<span class="flex min-h-6 items-center t-meta text-warn">через 2 дн<\/span>/u);
    for (const row of rows.slice(3)) {
      assert.match(row, /<span class="flex min-h-6 items-center t-meta text-fg-3">через \d+ дн<\/span>/u, `${look}: later deadlines stay neutral`);
      assert.doesNotMatch(row, /text-warn|text-danger/u);
    }
    assert.doesNotMatch(rows.slice(1).join(""), /text-danger/u, `${look}: red only on the missed deadline`);
    assert.doesNotMatch(band, /bg-accent/u, `${look}: no solid red`);
  }
  // Empty day, empty complete read: one empty state, the sentence under «На сегодня всё», no lone band.
  const empty = surfaces.get("today-deadlines-empty");
  assert.match(text(empty), /На сегодня всё Записанных сроков подачи на ближайшие 14 дней и прошедших без подачи за 7 дней нет\. Открыть студентов/u);
  assert.match(empty, /data-testid="queue-empty"[^>]*><p class="t-item text-fg">На сегодня всё<\/p><p class="t-body-compact text-fg-2" data-today-empty-note="">Записанных сроков/u);
  assert.doesNotMatch(empty, /today-band-deadlines|<h2/u, "no second empty block below");
  // Beside other bands, the empty band keeps its own words, without «0».
  const beside = surfaces.get("today-deadlines-empty-queue");
  const besideHeaders = [...beside.matchAll(/<h2 id="today-band-[a-z_]+"[^>]*>([\s\S]*?)<\/h2>/gu)].map((match) => text(match[1]));
  assert.deepEqual(besideHeaders, ["Просрочено · 1", "Сегодня · вс 27.09 · 1", "Сроки вузов · 14 дней", "Ближайшие 14 дней · 1"]);
  assert.match(beside, /Сроки вузов · 14 дней<\/span><\/h2><p class="[^"]*t-meta[^"]*">Записанных сроков подачи на ближайшие 14 дней и прошедших без подачи за 7 дней нет\.<\/p><ul><\/ul>/u);
  assert.doesNotMatch(beside, /data-today-empty-note|На сегодня всё/u);
  const partial = surfaces.get("today-deadlines-partial");
  assert.match(partial, /data-today-notice="partial" data-today-source="deadlines"[^>]*><span class="text-fg-2">Сроки вузов прочитаны не полностью: показана прочитанная часть, число скрыто\.<\/span><\/p>/u);
  assert.match(text(partial), /Сроки вузов · 14 дней 24\.09/u, "rows without a number");
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
    /t3d_band\(\) = pg_temp\.t3d_ids\(801, 803, 809, 810, 813\)/u,
    /pg_temp\.t3d_today\(\) - 7, pg_temp\.t3d_today\(\) \+ 14/u,
    /a deadline passed without submission stays in the band for 7 days/u,
    /a submitted application''s passed deadline stays out/u,
    /a deadline passed before the window stays out/u,
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
