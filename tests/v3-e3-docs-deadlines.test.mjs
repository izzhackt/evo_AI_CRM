import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DOCS_PACKAGE_READ_PAGES,
  DOCS_WAIT_WARN_DAYS,
  STUDENTS_DOCS_VIEWS,
  STUDENTS_DOCS_VIEW_LABELS,
  docsAutoView,
  docsInitialView,
  docsNextNonEmpty,
  docsOldestFirst,
  docsPackagesCount,
  docsQueueCount,
  docsRowMatches,
  docsTabCounts,
  docsWaiting,
  parseStudentsQueueParams,
  parseStudentsReturnTo,
  readDocsPackagePages,
  readDocsProgramPages,
  studentsDocsCell,
  studentsDocsTabs,
  studentsQueueHref,
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
 * вузов на 14 дней. Э8.5 (28.09.2026): EVO Docs — один центр проверки
 * документов («Документы дела · Документы программ · Комплекты · Исправить ·
 * Не хватает · Все», вкладка по умолчанию — первая непустая, «ждёт N дн»). Логика вкладок, чисел, группы и прав проверяется
 * напрямую; разметка — настоящим рендером (tests/e2e/e3d-static-render.cjs
 * --json) в отдельном node-процессе. Права самого чтения сроков
 * в обе стороны — набор supabase/tests/platform_today_university_deadlines.sql
 * на реальном Postgres (scripts/test-postgres-authorization.sh). Это не живая
 * проверка Supabase, прав или данных.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const surfaces = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/e3d-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
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

test("EVO Docs: one review centre — «Документы дела · Документы программ · Комплекты · Исправить · Не хватает · Все»", () => {
  assert.deepEqual(STUDENTS_DOCS_VIEWS, ["review", "program", "packages", "fix", "missing", "all"]);
  assert.deepEqual(STUDENTS_DOCS_VIEWS.map((view) => STUDENTS_DOCS_VIEW_LABELS[view]),
    ["Документы дела", "Документы программ", "Комплекты", "Исправить", "Не хватает", "Все"]);
  assert.deepEqual(tabsOf(surfaces.get("docs-review")),
    [["Документы дела", "2"], ["Документы программ", "4"], ["Комплекты", "3"], ["Исправить", "2"], ["Не хватает", "5"], ["Все", "7"]]);
  // Each view is an address of its own: the page opens it and the case returns to it.
  for (const view of ["missing", "packages", "program"]) {
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
  assert.deepEqual(docsTabCounts(rows, true, { views: { active: 5 } }), { review: 0, program: null, packages: null, fix: 1, missing: 2, all: 5 });
  // A next page exists (or a later page is shown): the review tabs have no number — never a guessed one.
  assert.deepEqual(docsTabCounts(rows, false, { views: { active: 250 } }), { review: null, program: null, packages: null, fix: null, missing: null, all: 250 });
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
  // Numbers live on the tabs (Э8.5): the page heading carries none.
  assert.match(html, /<h1[^>]*>EVO Docs<\/h1>/u, "no number at the heading");
  const empty = surfaces.get("docs-missing-empty");
  assert.match(text(empty), /Незагруженных документов по чек-листам нет\. Документы программ: 4/u, "the empty tab names the next non-empty one");
  assert.deepEqual(tabsOf(empty)[4], ["Не хватает", "0"], "a complete read with nothing missing is a true zero");
});

test("«Комплекты» reuses the board's queue: number only without a next page, one row action into the case", () => {
  const item = { package: { itemCount: 3 } };
  assert.equal(docsPackagesCount(ready([item, item])), 2);
  assert.equal(docsPackagesCount(ready([item], { createdAt: "2026-09-20T00:00:00.000Z", id: "x" })), null, "a longer queue has no number");
  for (const kind of ["hidden", "denied", "error"]) assert.equal(docsPackagesCount({ kind }), null, kind);
  // Not readable by this account (no document.read.full, or role preview): no queue tabs, as on the board.
  const params = parseStudentsQueueParams({ section: "docs" }, "docs", { admin: true, coverage: true }).params;
  const counts = { review: 1, program: null, packages: null, fix: 0, missing: 2, all: 3 };
  assert.deepEqual(studentsDocsTabs(params, counts, { program: false, packages: false }).map((tab) => tab.key), ["review", "fix", "missing", "all"]);
  assert.deepEqual(studentsDocsTabs(params, counts, { program: true, packages: true }).map((tab) => tab.key), ["review", "program", "packages", "fix", "missing", "all"]);
  assert.deepEqual(tabsOf(surfaces.get("docs-no-packages")).map(([label]) => label), ["Документы дела", "Исправить", "Не хватает", "Все"]);

  const html = surfaces.get("docs-packages");
  // The same state for every row is said once above the table, not in each row; a complete read waits oldest first.
  assert.match(html, /Отправлены на проверку EVO, решения ещё нет\. Порядок: сначала дольше всех ждущие/u);
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
    assert.match(body, /<time dateTime="[^"]+" class="font-mono tabular-nums text-fg">\d\d\.\d\d<\/time><span class="text-fg-3"> · <\/span><span class="[^"]+">(?:сегодня|ждёт\u00a0\d+\u00a0дн)<\/span>/u);
  }
  // Oldest first: 22.09 (5 days, warn), 25.09 (2 days, warn), 27.09 (today).
  assert.deepEqual(rows.map(([, caseId]) => caseId.slice(-2)), ["03", "05", "01"]);
  assert.match(html, /<span class="font-medium text-warn">ждёт\u00a05\u00a0дн<\/span>/u, "a two-day wait and longer is a warning");
  assert.match(html, /<span class="text-fg-2">сегодня<\/span>/u);
  assert.match(html, /<span class="font-medium text-warn">Прежняя редакция требований<\/span>/u, "an old-requirements package is flagged");
  assert.doesNotMatch(html, /v3-progress/u, "no «N из M» bar: the queue does not read accepted documents");
  assert.match(html, /<h1[^>]*>EVO Docs<\/h1>/u, "numbers live on the tabs");

  const more = surfaces.get("docs-packages-more");
  assert.deepEqual(tabsOf(more)[2], ["Комплекты", null], "3 pages read and still a next page — no number");
  assert.equal([...more.matchAll(/data-testid="v3-student-package-row"/gu)].length, 60);
  // Oldest items may be missing from a partial read: server order, said honestly; no board link any more.
  assert.match(more, /Порядок: сначала недавно отправленные — прочитана не вся очередь/u);
  assert.match(more, /Показаны последние 60 комплектов: очередь длиннее\. Проверенные уходят из очереди — после них здесь появятся следующие\./u);
  assert.doesNotMatch(more, /admissions-pipeline/u);
  // Two pages that end: the whole queue is read — the number shows and no rest line.
  const pages = surfaces.get("docs-packages-pages");
  assert.deepEqual(tabsOf(pages)[2], ["Комплекты", "25"]);
  assert.equal([...pages.matchAll(/data-testid="v3-student-package-row"/gu)].length, 25);
  assert.doesNotMatch(pages, /Показаны последние/u);
  assert.match(surfaces.get("docs-packages-error"), /data-testid="queue-error"[\s\S]*Не удалось загрузить комплекты на проверку\./u);
  // The page reads the queue with the board's own gate and action.
  const source = read("src/lib/v3/students-queue-source.ts");
  assert.match(source, /return !isStaffPreview\(actor\) && staffHasPermission\(actor, "document\.read\.full"\);/u);
  assert.equal([...source.matchAll(/if \(!readsDocumentQueues\(actor\)\) return Object\.freeze\(\{ kind: "hidden" \}\);/gu)].length, 2, "both queues, one gate");
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

// --- Э8.5: один центр проверки документов ------------------------------------

test("Э8.5: without a view EVO Docs opens the first tab with work; unknown numbers fall back to «Документы дела»", () => {
  const shown = { program: true, packages: true };
  const counts = (fields) => ({ review: 0, program: 0, packages: 0, fix: 0, missing: 0, all: 2, ...fields });
  assert.equal(docsAutoView(counts({ missing: 1 }), shown), "missing", "production 28.09: only «Не хватает» has work");
  assert.equal(docsAutoView(counts({ program: 3, missing: 1 }), shown), "program");
  assert.equal(docsAutoView(counts({ review: null, program: null, packages: null, fix: null, missing: null }), shown), "review", "no known number — no guess");
  assert.equal(docsAutoView(counts({}), shown), "review", "«Все» is not work and is never chosen by itself");
  assert.equal(docsAutoView(counts({ program: 3 }), { program: false, packages: true }), "review", "an unread queue is never chosen");
  // The address without a view stays «first non-empty»; every tab link writes its view.
  const auto = parseStudentsQueueParams({ section: "docs" }, "docs", { admin: true, coverage: true }).params;
  assert.equal(auto.autoView, true);
  assert.equal(studentsQueueHref(auto), "/v3/profile?section=docs");
  assert.equal(studentsQueueHref(auto, { view: "review" }), "/v3/profile?section=docs&view=review");
  const chosen = parseStudentsQueueParams({ section: "docs", view: "review" }, "docs", { admin: true, coverage: true }).params;
  assert.equal(chosen.autoView, false);
  assert.equal(studentsQueueHref(chosen), "/v3/profile?section=docs&view=review", "the first tab is written too");
  // «Студенты» keep omitting their role default.
  assert.equal(studentsQueueHref(parseStudentsQueueParams({}, "queue", { admin: true, coverage: true }).params), "/v3/profile");

  const html = surfaces.get("docs-auto-missing");
  assert.equal(tabsOf(html).find(([label]) => label === "Не хватает")?.[1], "1");
  assert.match(html, /aria-current="page"[^>]*href="\/v3\/profile\?section=docs&amp;view=missing">Не хватает/u, "the chosen tab is current");
  assert.equal([...html.matchAll(/data-testid="v3-student-case-row"/gu)].length, 1);
  // The case entry returns to the tab that was open, not to «first non-empty» again.
  assert.match(html, /returnTo=%2Fv3%2Fprofile%3Fsection%3Ddocs%26view%3Dmissing/u);
  for (const [label, view] of [["Документы дела", "review"], ["Документы программ", "program"], ["Комплекты", "packages"], ["Все", "all"]]) {
    assert.match(html, new RegExp(`href="/v3/profile\\?section=docs&amp;view=${view}">${label}`, "u"), view);
  }
});

test("Э8.5: a search never leaves «Документы дела» for a queue tab it does not narrow", () => {
  const shown = { program: true, packages: true };
  const counts = { review: 0, program: 4, packages: 3, fix: 0, missing: 1, all: 1 };
  const parse = (search) => parseStudentsQueueParams(search, "docs", { admin: true, coverage: true }).params;
  // Queue numbers ignore the case search: without a filter they still choose the tab, with one they do not.
  assert.equal(docsInitialView(parse({ section: "docs" }), counts, shown), "program");
  for (const search of [{ q: "x" }, { direction: "MY" }, { curator: "aaaaaaaa-1111-4111-8111-000000000001" }]) {
    const params = parse({ section: "docs", ...search });
    assert.equal(params.autoView, true, JSON.stringify(search));
    assert.equal(docsInitialView(params, counts, shown), "review", JSON.stringify(search));
  }

  // The search form on every EVO Docs tab keeps its tab — «Документы дела» included.
  const formOf = (html) => html.match(/<form[^>]*action="\/v3\/profile"[\s\S]*?<\/form>/u)?.[0] ?? "";
  for (const [name, view] of [["docs-review", "review"], ["docs-review-empty", "review"], ["docs-missing", "missing"], ["docs-search", "review"]]) {
    assert.match(formOf(surfaces.get(name)), new RegExp(`<input type="hidden" name="view" value="${view}"/>`, "u"), name);
  }
  // An address with a search and no view (bookmarked before this fix) stays on «Документы дела».
  const search = surfaces.get("docs-search");
  assert.match(search, /aria-current="page"[^>]*href="\/v3\/profile\?section=docs&amp;view=review&amp;q=[^"]+">Документы дела/u);
  assert.doesNotMatch(search, /data-testid="v3-program-document-row"/u);
  // Its empty line names the next case tab the search narrows, not the queue it ignores.
  assert.match(text(search), /Проверять нечего\. Исправить: 1/u);
  assert.match(search, /data-testid="queue-empty">[\s\S]*?href="\/v3\/profile\?section=docs&amp;view=fix&amp;q=[^"]+"/u);
});

test("Э8.5: an empty tab is one line naming the next non-empty tab", () => {
  const shown = { program: true, packages: true };
  const counts = { review: 0, program: 0, packages: 2, fix: 0, missing: 1, all: 3 };
  assert.deepEqual(docsNextNonEmpty("review", counts, shown), { view: "packages", label: "Комплекты", count: 2 });
  assert.deepEqual(docsNextNonEmpty("packages", counts, shown), { view: "missing", label: "Не хватает", count: 1 });
  assert.deepEqual(docsNextNonEmpty("missing", counts, shown), { view: "packages", label: "Комплекты", count: 2 }, "round the row");
  assert.equal(docsNextNonEmpty("review", { ...counts, packages: null, missing: 0 }, shown), null, "unknown is not «non-empty»");
  assert.equal(docsNextNonEmpty("review", counts, { program: true, packages: false }).view, "missing", "an unread queue is skipped");

  const empty = surfaces.get("docs-review-empty");
  assert.match(empty, /data-testid="queue-empty"><p class="t-item text-fg">Проверять нечего\.<\/p><a class="[^"]*" href="\/v3\/profile\?section=docs&amp;view=missing"><span>Не хватает: <span class="tabular-nums">1<\/span><\/span><svg/u);
  assert.match(empty, /class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-border py-12 text-center" data-testid="queue-empty"/u, "one line, wrapping whole on a phone");
  const program = surfaces.get("docs-program-empty");
  assert.match(text(program), /Проверять нечего\. Комплекты: 3/u);
  assert.doesNotMatch(program, /data-testid="v3-program-document-row"/u);
});

test("Э8.5: «Документы программ» is the board's program queue with the decision in the row", () => {
  const html = surfaces.get("docs-program");
  assert.equal([...html.matchAll(/data-testid="v3-program-document-row"/gu)].length, 4);
  // Oldest first within the complete read: 21.09 (6 days), 23.09, 26.09, 27.09 (today).
  assert.deepEqual([...html.matchAll(/data-testid="v3-program-document-row" data-student-case-id="[^"]*(\d\d)"/gu)].map((match) => match[1]), ["02", "03", "05", "01"]);
  assert.match(html, /Отправлены на проверку EVO, решения ещё нет\. Порядок: сначала дольше всех ждущие/u);
  assert.match(html, /<time dateTime="2026-09-21T08:00:00.000Z" class="font-mono tabular-nums text-fg">21\.09<\/time><span class="text-fg-3"> · <\/span><span class="font-medium text-warn">ждёт 6 дн<\/span>/u);
  assert.match(html, /<span class="text-fg-2">ждёт 1 дн<\/span>/u, "a one-day wait is not a warning");
  assert.match(html, /<span class="font-medium text-warn">Прежнее требование<\/span>/u);
  assert.match(html, /<span title="15\.10\.2026" class="whitespace-nowrap">срок <time dateTime="2026-10-15" class="font-mono tabular-nums">15\.10<\/time><\/span>/u, "«срок» never parts from its date");
  // Five cells per row, five column headers: the decision below the document has its own (screen-reader) header.
  assert.match(html, /<span role="columnheader" class="sr-only">Решение<\/span>/u);
  assert.equal([...html.match(/data-testid="v3-program-document-table"[\s\S]*?<\/div><\/div>/u)[0].matchAll(/role="columnheader"/gu)].length, 5);
  // The file and the inline decision are the same components the board queue used.
  assert.equal([...html.matchAll(/<button type="button" class="secondary"[^>]*>Скачать файл<\/button>/gu)].length, 4);
  assert.equal([...html.matchAll(/<summary class="summary">Решение по отправленной версии<\/summary>/gu)].length, 4);
  assert.match(html, /Файл проходит проверку безопасности\./u, "an unavailable file says why");
  for (const [, caseId] of [...html.matchAll(/data-testid="v3-program-document-row" data-student-case-id="([^"]+)"/gu)]) {
    assert.match(html, new RegExp(`href="/v3/profile\\?case=${caseId}&amp;tab=route&amp;section=docs&amp;returnTo=%2Fv3%2Fprofile%3Fsection%3Ddocs%26view%3Dprogram#preparation-[0-9a-f-]{36}">Открыть программу`, "u"));
  }
  // «Сохранить решение» and the recovery retries are confirmations: dark neutral, not the page's solid red.
  // The variables reach descendants too — the recovery section carries its own module `.root`.
  const table = read("src/components/v3/students/StudentsProgramDocsTable.tsx");
  const css = read("src/app/(v3)/v3.css");
  assert.match(css, /\.v3-world\[data-surface="staff"\] :is\(\[data-docs-neutral\], \[data-docs-neutral\] \*\) \{\n  --doc-accent: var\(--text\);\n  --doc-on-accent: var\(--surface\);\n\}/u);
  assert.equal([...html.matchAll(/data-docs-decision="" data-docs-neutral=""/gu)].length, 4);
  assert.doesNotMatch(table, /--doc-accent/u, "one place for the neutral confirmation");
  assert.match(table, /<ProgramDocumentReview scope=\{scope\} submission=\{item\.submission\} strings=\{strings\} canReview=\{canReview\} onSaved=\{\(\) => router\.refresh\(\)\} \/>/u);
  const recovery = read("src/components/v3/students/DocsQueueRecovery.tsx");
  assert.match(recovery, /listApplicationDocumentPendingScopes\(owner, "review"\)/u, "the owner-wide pending-review recovery moved with the queue");
  assert.match(recovery, /return <div data-docs-neutral="">\{scopes\.map\(\(scope\) => <ProgramDocumentRecovery /u);
  assert.match(recovery, /return <div data-docs-neutral="" className=\{`\$\{styles\.root\} t-body-compact`\}><PackageQueueRecovery /u);
  // The recovery stands above the queue in both branches — also when the queue is empty (the last decision's lost reply).
  const screen = read("src/components/v3/students/StudentsQueueScreen.tsx");
  assert.match(screen, /<ProgramDocsRecovery owner=\{review\.owner\} visibleSubmissions=\{items\.map\(\(item\) => item\.submission\.submissionId\)\} \/>\n    \{items\.length === 0 \? empty : <>/u);
  assert.doesNotMatch(table, /<ProgramDocsRecovery|import \{ ProgramDocsRecovery/u, "the table no longer carries the recovery");
  assert.match(read("src/app/(v3)/v3/profile/page.tsx"), /canReview: !isStaffPreview\(actor\) && staffHasPermission\(actor, "document\.review"\),/u);
  assert.match(css, /\.v3-world\[data-surface="staff"\] \[data-docs-decision\] details \{/u);
  // Reasons for an unavailable file sit right under «Скачать файл», without the module list's 16px padding.
  assert.match(css, /\.v3-world\[data-surface="staff"\] \[data-docs-file\] li \{\n  padding-block: 0;/u);
  assert.equal([...html.matchAll(/role="cell" data-docs-file=""/gu)].length, 4);

  const more = surfaces.get("docs-program-more");
  assert.deepEqual(tabsOf(more)[1], ["Документы программ", null], "3 pages and a next one: no number");
  assert.equal([...more.matchAll(/data-testid="v3-program-document-row"/gu)].length, 60);
  assert.match(more, /Порядок: сначала недавно отправленные — прочитана не вся очередь/u);
  assert.match(more, /Показаны последние 60 документов: очередь длиннее\./u);
  assert.match(surfaces.get("docs-program-error"), /data-testid="queue-error"[\s\S]*Не удалось загрузить документы программ на проверку\./u);
});

test("Э8.5: program pages are read like packages — up to 3, each submission once", async () => {
  const item = (n, at) => ({ submission: { submissionId: `s-${n}`, submittedAt: at } });
  let turn = 0;
  const read3 = await readDocsProgramPages(async (cursor) => {
    turn += 1;
    assert.equal(cursor === null, turn === 1);
    return { ok: true, queue: { items: [item(turn, "2026-09-2" + turn + "T00:00:00Z"), item(turn + 10, "2026-09-2" + turn + "T00:00:00Z")], nextCursor: { createdAt: "x", id: `s-${turn}` } } };
  });
  assert.equal(turn, 3);
  assert.equal(read3.queue.items.length, 6);
  assert.equal(docsQueueCount(read3), null);
  assert.deepEqual(await readDocsProgramPages(async () => ({ ok: false, reason: "forbidden" })), { kind: "denied" });
  assert.equal(DOCS_PACKAGE_READ_PAGES, 3);
});

test("Э8.5: «ждёт N дн» from the latest upload by the Bishkek day; oldest first only within a complete read", () => {
  assert.equal(DOCS_WAIT_WARN_DAYS, 2);
  // 27.09 00:30 Bishkek is 26.09 18:30 UTC: already «today» in Bishkek.
  assert.deepEqual(docsWaiting("2026-09-26T18:30:00.000Z", "2026-09-27"), { dateTime: "2026-09-26T18:30:00.000Z", day: "27.09", word: "сегодня", warn: false });
  assert.equal(docsWaiting("2026-09-26T09:00:00.000Z", "2026-09-27").word, "ждёт 1 дн");
  assert.deepEqual(docsWaiting("2026-09-25T09:00:00.000Z", "2026-09-27"), { dateTime: "2026-09-25T09:00:00.000Z", day: "25.09", word: "ждёт 2 дн", warn: true });
  assert.equal(docsWaiting("2025-12-30T09:00:00.000Z", "2026-01-02").day, "30.12.25", "another year shows «.ГГ»");
  assert.equal(docsWaiting(null, "2026-09-27"), null);
  assert.equal(docsWaiting(undefined, "2026-09-27"), null, "a read before 252 has no wait");
  const items = [{ id: "b", at: "2026-09-25T00:00:00Z" }, { id: "a", at: "2026-09-20T00:00:00Z" }, { id: "c", at: "2026-09-25T00:00:00Z" }];
  const at = (item) => item.at;
  const id = (item) => item.id;
  assert.deepEqual(docsOldestFirst(items, at, id, true).items.map(id), ["a", "b", "c"]);
  assert.equal(docsOldestFirst(items, at, id, true).oldestFirst, true);
  assert.deepEqual(docsOldestFirst(items, at, id, false), { items, oldestFirst: false }, "a partial read keeps server order");
  assert.deepEqual(docsOldestFirst([...items, { id: "d" }], at, id, true).oldestFirst, false, "a row without a wait keeps server order");

  // «Документы дела»: the case waiting 7 days comes first; its word is a warning, the one-day wait is not.
  const review = surfaces.get("docs-review");
  const order = [...review.matchAll(/data-testid="v3-student-case-row" data-access="full" data-student-case-id="[^"]*(\d\d)"/gu)].map((match) => match[1]);
  assert.deepEqual(order, ["05", "01"], "oldest wait first, not the recently changed case");
  assert.match(review, /Порядок: сначала дольше всех ждущие проверки/u);
  assert.match(review, /3 на проверке<\/span><\/span><span class="font-normal text-fg-3"> · <\/span><time dateTime="2026-09-20T04:10:00.000000Z" title="Загружен 20\.09" class="font-medium text-warn">ждёт 7 дн<\/time>/u);
  assert.match(review, /title="Загружен 26\.09" class="font-normal text-fg-2">ждёт 1 дн<\/time>/u);
  assert.match(review, /<h1[^>]*>EVO Docs<\/h1>/u);
  // Other tabs keep the case order and say so; no wait words there.
  const missing = surfaces.get("docs-missing");
  assert.match(missing, /Порядок: сначала недавно изменённые дела<\/p>/u);
  assert.doesNotMatch(missing, /ждёт/u);
});

test("Э8.5: the board hands its review queues to EVO Docs", () => {
  const page = read("src/app/(v3)/v3/admissions-pipeline/page.tsx");
  assert.match(page, /documents: "\/v3\/profile\?section=docs&view=program",\n  packages: "\/v3\/profile\?section=docs&view=packages",/u);
  assert.match(page, /if \(view !== undefined && view !== "documents" && view !== "packages"\) notFound\(\);\n  \/\/ [^\n]*\n  if \(view !== undefined\) redirect\(EVO_DOCS_QUEUE_HREF\[view\]\);/u);
  assert.match(page, /href=\{EVO_DOCS_QUEUE_HREF\.documents\}>\n\s+Документы на проверку/u);
  assert.match(page, /href=\{EVO_DOCS_QUEUE_HREF\.packages\}>\n\s+Комплекты на проверку/u);
  assert.doesNotMatch(page, /\bPackageQueue\b|ProgramDocumentQueue|Разделы поступления|viewHref/u, "no board subpages");
  for (const gone of ["src/components/v3/admissions/ProgramDocumentQueue.tsx", "src/components/portal/applicationPackages/PackageQueue.tsx"]) {
    assert.throws(() => read(gone), /ENOENT/u, gone);
  }
  assert.doesNotMatch(read("src/components/v3/students/StudentsQueueScreen.tsx"), /PACKAGES_QUEUE_HREF|admissions-pipeline/u);
});

test("EVO Docs: «N из M принято» is a bar only from read checklist numbers", () => {
  const html = surfaces.get("docs-missing");
  assert.match(html, /9 из 12 принято/u);
  const bars = [...html.matchAll(/<span class="v3-progress" data-progress="(\d+)\/(\d+)"><span class="t-body-compact text-fg">(\d+) из (\d+) принято<\/span>/gu)];
  assert.equal(bars.length, 5);
  for (const [, done, total, label, labelTotal] of bars) {
    assert.equal(done, label);
    assert.equal(total, labelTotal);
  }
  // No numbers (an empty checklist): the summary line in words, no bar.
  const all = surfaces.get("docs-all");
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
  const html = surfaces.get("today-deadlines");
  const headers = [...html.matchAll(/<h2 id="today-band-[a-z_]+"[^>]*>([\s\S]*?)<\/h2>/gu)].map((match) => text(match[1]));
  assert.deepEqual(headers, ["Просрочено · 1", "Сегодня · вс 27.09 · 1", "Сроки вузов · 14 дней · 5", "Ближайшие 14 дней · 1"]);
  const band = html.slice(html.indexOf('id="today-band-deadlines"'), html.indexOf('id="today-band-upcoming"'));
  const rows = [...band.matchAll(/<li data-queue-row="deadline:[^"]+" data-today-source="deadlines"[\s\S]*?<\/li>/gu)].map((match) => match[0]);
  assert.equal(rows.length, 5, "the passport date is not a university deadline");
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
    assert.match(row, /<span class="flex min-h-6 items-center t-meta text-fg-3">через \d+ дн<\/span>/u, "later deadlines stay neutral");
    assert.doesNotMatch(row, /text-warn|text-danger/u);
  }
  assert.doesNotMatch(rows.slice(1).join(""), /text-danger/u, "red only on the missed deadline");
  assert.doesNotMatch(band, /bg-accent/u, "no solid red");
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
