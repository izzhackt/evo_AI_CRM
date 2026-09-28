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

/**
 * Э3 (27.09.2026): EVO Docs «Не хватает · Комплекты». Э8.5 (28.09.2026): EVO
 * Docs — один центр проверки документов («Документы дела · Документы
 * программ · Комплекты · Исправить · Не хватает · Все», вкладка по умолчанию
 * — первая непустая, «ждёт N дн»). Логика вкладок, чисел, группы и прав
 * проверяется напрямую; разметка — настоящим рендером
 * (tests/e2e/e3d-static-render.cjs --json) в отдельном node-процессе.
 * Сроки вузов ушли из «Сегодня» решением владельца 28.09 (PLAN_CHANGES «Э8:
 * ответы владельца на открытые вопросы»): чтение 145
 * (`admissions_deadline_page_v1`) и его код в приложении убраны; сама
 * функция базы и её проверка авторизации в обе стороны
 * (supabase/tests/platform_today_university_deadlines.sql на реальном
 * Postgres, scripts/test-postgres-authorization.sh) остаются в базе
 * неиспользуемыми — тест ниже проверяет только их сохранность. Это не живая
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
