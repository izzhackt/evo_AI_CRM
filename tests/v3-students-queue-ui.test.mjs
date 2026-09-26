import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  bishkekNoon,
  caseNextActionBand,
  docsRowMatches,
  docsTabCounts,
  nextStepAccess,
  parseStudentsQueueParams,
  parseStudentsReturnTo,
  studentsBands,
  studentsCaseHref,
  studentsDocsCell,
  studentsDocumentsLine,
  studentsListHref,
  studentsQueueHref,
  studentsQueueTabs,
  studentsEffectiveSort,
  studentsHandoffPending,
  studentsQueueRequest,
  studentsRowSignals,
  studentsStepView,
  studentsUpdatedDay,
} from "../src/components/v3/students/students-queue-view.ts";
import { coverageDue, coverageHref, formatDueOn } from "../src/components/v3/profile/students-coverage-view.ts";
import { dueBucket, weekEnd } from "../src/components/v3/queue/due-bucket.ts";
import { shiftDay } from "../src/components/v3/calendar/types.ts";
import { parseCaseNextActionInput } from "../src/lib/platform-student-case-queue-contract.ts";
import { resolveStudentsCoverage } from "../src/lib/v3/students-coverage.ts";
import * as editor from "../src/components/v3/students/next-step-input.ts";

/**
 * «Студенты» — рабочая очередь дел (PLAN_CHANGES «Студенты» PR 2, 25.09.2026).
 * Логика адресов, групп, прав редактора и чисел проверяется напрямую,
 * разметка — настоящим рендером экрана с синтетическими делами
 * (tests/e2e/students-static-render.cjs --json) в отдельном node-процессе без
 * react-server. Это не живая проверка данных: права и числа решает SQL 241.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const surfaces = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/students-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));

const ADMIN = { admin: true, coverage: true };
const CURATOR = { admin: false, coverage: false };
const MANAGER = { admin: false, coverage: true };
const MEMBER = "aaaaaaaa-1111-4111-8111-000000000001";
const CASE = "cccccccc-2222-4222-8222-000000000003";
const parse = (query, actor = ADMIN, mode = "queue") => parseStudentsQueueParams(query, mode, actor);
const ok = (query, actor = ADMIN, mode = "queue") => {
  const result = parse(query, actor, mode);
  assert.equal(result.kind, "ok", JSON.stringify(query));
  return result.params;
};
const texts = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();

test("the default view follows the role: «Мои» for Admissions, «Требуют действия» for Admin", () => {
  assert.equal(ok({}).view, "needs_action");
  assert.equal(ok({}, CURATOR).view, "mine");
  assert.equal(ok({ section: "docs" }, ADMIN, "docs").view, "review");
  // Default views are not written into the address.
  assert.equal(studentsQueueHref(ok({})), "/v3/profile");
  assert.equal(studentsQueueHref(ok({}, CURATOR)), "/v3/profile");
  assert.equal(studentsQueueHref(ok({}, ADMIN), { view: "mine" }), "/v3/profile?view=mine");
});

test("old facet and summary addresses map onto the new views and redirect", () => {
  const redirect = (query, actor = ADMIN, mode = "queue") => {
    const result = parse(query, actor, mode);
    assert.equal(result.kind, "redirect", JSON.stringify(query));
    return result.href;
  };
  // The former summary is this page; #admissions-summary lands on the view tabs.
  assert.equal(redirect({ section: "summary" }), "/v3/profile");
  assert.equal(redirect({ section: "summary", period: "month" }, CURATOR), "/v3/profile");
  // case_q → q, case_status → view, direction/curator keep their names.
  assert.equal(redirect({ case_q: "Ким", case_status: "closed", direction: "CN" }), "/v3/profile?view=closed&q=%D0%9A%D0%B8%D0%BC&direction=CN");
  assert.equal(redirect({ case_status: "active", curator: MEMBER }), `/v3/profile?view=active&curator=${MEMBER}`);
  assert.equal(redirect({ case_status: "pending" }, CURATOR), "/v3/profile?view=pending");
  // Attention wins over status; «Ждут куратора» is an Admin view.
  assert.equal(redirect({ attention: "overdue", case_status: "closed" }), "/v3/profile");
  assert.equal(redirect({ attention: "awaiting_ack" }, CURATOR), "/v3/profile?view=needs_action");
  assert.equal(redirect({ attention: "needs_curator" }), "/v3/profile?view=needs_curator");
  assert.equal(redirect({ attention: "needs_curator" }, CURATOR), "/v3/profile?view=needs_action");
  // Legacy attention values without a 241 view open their superset.
  assert.equal(redirect({ attention: "visas" }), "/v3/profile?view=active");
  // An old 078 cursor does not fit the new order: the list starts over.
  assert.equal(redirect({ case_before_at: "2026-09-18T00:00:00Z", case_before_id: CASE, case_status: "active" }), "/v3/profile?view=active");
  // EVO Docs shows no work statuses: they are dropped.
  assert.equal(redirect({ section: "docs", attention: "overdue", case_q: "Ким" }, ADMIN, "docs"), "/v3/profile?section=docs&q=%D0%9A%D0%B8%D0%BC");
  // A case number is a case: 241 search does not match ids, so it opens the case overview.
  assert.equal(redirect({ q: CASE.toUpperCase() }), `/v3/profile?case=${CASE}&tab=overview`);
  assert.equal(redirect({ case_q: CASE }, CURATOR), `/v3/profile?case=${CASE}&tab=overview`);
  assert.equal(redirect({ q: CASE }, ADMIN, "docs"), `/v3/profile?case=${CASE}&tab=documents&section=docs`);
});

test("coverage links open «Нагрузка кураторов» for Admin; the facet curator sync is dropped", () => {
  const params = ok({ curator: MEMBER, coverage_curator: MEMBER, coverage_case: CASE });
  assert.equal(params.view, "curators");
  assert.equal(params.curator, null);
  assert.deepEqual(params.coverage, { coverage_curator: MEMBER, coverage_case: CASE });
  assert.equal(studentsQueueHref(params), `/v3/profile?view=curators&coverage_curator=${MEMBER}&coverage_case=${CASE}`);
  assert.equal(coverageHref(MEMBER, CASE), `/v3/profile?view=curators&coverage_curator=${MEMBER}&coverage_case=${CASE}#curator-coverage`);
  // Not Admin: coverage parameters are ignored, the queue opens as usual.
  assert.equal(ok({ coverage_curator: MEMBER }, CURATOR).view, "mine");
  // The coverage form keeps landing on this view after a confirmed receipt.
  assert.match(read("src/components/v3/profile/CuratorCoverageForm.tsx"), /new URLSearchParams\(\{ view: "curators", coverage_curator: destination, coverage_case: reviewed\.id \}\)/u);
});

test("unparseable addresses are refused honestly, never guessed", () => {
  for (const query of [
    { case_status: "archived" }, { attention: "urgent" }, { direction: "XX" }, { curator: "not-a-uuid" },
    { stage: "unknown" }, { sort: "name" }, { cursor: "due|0|2026-09-01|garbage" }, { open: "nope" },
    { view: ["mine", "active"] }, { q: "a\u0007b" }, { q: "x".repeat(201) },
  ]) {
    assert.equal(parse(query).kind, "invalid", JSON.stringify(query));
  }
  // Admin views are not reachable by address for other roles.
  assert.equal(parse({ view: "needs_curator" }, CURATOR).kind, "invalid");
  assert.equal(parse({ view: "curators" }, CURATOR).kind, "invalid");
  assert.equal(parse({ view: "review" }).kind, "invalid");
  assert.equal(parse({ view: "mine" }, ADMIN, "docs").kind, "invalid");
  const html = surfaces.get("invalid");
  assert.match(html, /role="alert" data-testid="v3-student-case-filter-rejected"/u);
  assert.match(html, /Не удалось применить фильтры\./u);
  assert.doesNotMatch(html, /data-testid="v3-student-case-row"/u);
});

test("the address keeps view, filters, page and the open row; returnTo accepts only queue keys", () => {
  const params = ok({ view: "active", q: "Ким", direction: "MY", curator: MEMBER, stage: "documents", sort: "updated", open: CASE });
  const href = studentsQueueHref(params);
  assert.equal(href, `/v3/profile?view=active&q=%D0%9A%D0%B8%D0%BC&direction=MY&curator=${MEMBER}&stage=documents&sort=updated&open=${CASE}`);
  const again = ok(Object.fromEntries(new URL(href, "https://x.invalid").searchParams));
  assert.deepEqual(again, params);
  // Tabs and filters start the list over and close the row.
  assert.equal(studentsListHref(params, { view: "closed" }), `/v3/profile?view=closed&q=%D0%9A%D0%B8%D0%BC&direction=MY&curator=${MEMBER}&stage=documents&sort=updated`);
  assert.equal(parseStudentsReturnTo(href), href);
  assert.equal(parseStudentsReturnTo("/v3/profile?section=docs&view=fix"), "/v3/profile?section=docs&view=fix");
  for (const bad of ["/v3/profile?evil=1", "/v3/requests?source=all", "https://evil.example/v3/profile", "/v3/profile?view=active#x",
    "/v3/profile?view=active&view=closed", "/v3/profile?section=summary", "/v3/profile?stage=nope", 42]) {
    assert.equal(parseStudentsReturnTo(bad), null, String(bad));
  }
  // Entry links open «Обзор» (EVO Docs — «Документы»), never «Вузы и программы».
  assert.equal(studentsCaseHref(CASE, { returnTo: href }), `/v3/profile?case=${CASE}&tab=overview&returnTo=${encodeURIComponent(href)}`);
  assert.equal(studentsCaseHref(CASE, { docs: true }), `/v3/profile?case=${CASE}&tab=documents&section=docs`);
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /const studentsReturnTo = requestsReturnTo \? null : parseStudentsReturnTo\(singleSearchParam\(params\.returnTo\)\);/u);
  assert.match(page, /const directoryHref = studentsReturnTo \?\? withDocsSection\("\/v3\/profile", docsMode\);/u);
  assert.match(page, /\{requestsReturnTo \? "К списку заявок" : pipelineBackHref \? "К воронке продаж" : docsMode \? "К списку EVO Docs" : "К списку студентов"\}/u);
});

test("due bands mirror case_next_action_band (241) on top of dueBucket, Sunday included", () => {
  const sql = read("supabase/migrations/241_platform_case_next_action_queue.sql");
  assert.match(sql, /WHEN p_due_on <= p_today \+ \(7 - EXTRACT\(ISODOW FROM p_today\)::INTEGER\) THEN 'this_week'/u);
  // The SQL rule, restated: no step; no date; overdue; today; until ISO Sunday; later.
  const sqlBand = (step, due, today) => !step ? "no_step" : !due ? "undated" : due < today ? "overdue" : due === today ? "today"
    : due <= weekEnd(today) ? "this_week" : "later";
  for (let offset = 0; offset < 14; offset += 1) {
    const today = shiftDay("2026-09-21", offset); // Monday 21.09 … Sunday 04.10
    const now = bishkekNoon(today);
    for (let delta = -3; delta <= 10; delta += 1) {
      const due = shiftDay(today, delta);
      assert.equal(caseNextActionBand("Шаг", due, now), sqlBand("Шаг", due, today), `${today} → ${due}`);
    }
    assert.equal(caseNextActionBand("Шаг", null, now), "undated");
    assert.equal(caseNextActionBand(null, null, now), "no_step");
  }
  // On Sunday tomorrow is next week: dueBucket says «Завтра», the queue says «Позже».
  assert.equal(dueBucket({ dueOn: "2026-09-28", dueAt: null }, bishkekNoon("2026-09-27")), "tomorrow");
  assert.equal(caseNextActionBand("Шаг", "2026-09-28", bishkekNoon("2026-09-27")), "later");
});

test("bands keep the SQL order, show only this page's non-empty groups and never invent a count", () => {
  const rows = ["later", "overdue", "no_step", "today", "overdue"].map((dueBand, index) => ({ dueBand, id: index }));
  const counts = { bands: { overdue: 7, today: 1, this_week: 0, later: 30, undated: 2, no_step: 9 } };
  const bands = studentsBands(rows, "due", "2026-09-23", counts);
  assert.deepEqual(bands.map((band) => [band.key, band.label, band.count, band.tone, band.rows.length]), [
    ["overdue", "Просрочено", 7, "danger", 2],
    ["today", "Сегодня · ср 23.09", 1, "default", 1],
    ["later", "Позже", 30, "default", 1],
    ["no_step", "Без следующего шага", 9, "warn", 1],
  ]);
  assert.ok(studentsBands(rows, "due", "2026-09-23", null).every((band) => band.count === null));
  // Sorted by update: one list without due groups.
  assert.deepEqual(studentsBands(rows, "updated", "2026-09-23", counts).map((band) => [band.key, band.label, band.count]), [["all", null, null]]);
  const html = surfaces.get("admin-active");
  assert.deepEqual([...html.matchAll(/<th role="rowheader" scope="rowgroup" colSpan="7" id="students-band-([a-z_]+)"[^>]*>([\s\S]*?)<\/th>/gu)].map((match) => [match[1], texts(match[2])]), [
    ["overdue", "Просрочено · 4"],
    ["today", "Сегодня · ср 23.09 · 3"],
    ["this_week", "На этой неделе · 3"],
    ["later", "Позже · 5"],
    ["undated", "Без срока · 2"],
    ["no_step", "Без следующего шага · 3 — откройте строку и добавьте шаг"],
  ]);
  assert.match(html, /<span class="text-danger">Просрочено<\/span>/u, "overdue is a word, coloured");
  assert.match(html, /<span class="text-warn">Без следующего шага<\/span>/u);
  assert.doesNotMatch(surfaces.get("admin-updated"), /students-band-/u);
});

test("counts come only from the counts read: tabs, bands, menus and the header go blank without it", () => {
  const params = ok({});
  const tabs = studentsQueueTabs(params, null, ADMIN);
  assert.deepEqual(tabs.map((tab) => [tab.label, tab.count]), [
    ["Мои", null], ["Требуют действия", null], ["Все в работе", null], ["Ожидает начала", null], ["Ждут куратора", null], ["Закрытые", null], ["Нагрузка кураторов", null],
  ]);
  assert.deepEqual(studentsQueueTabs(params, null, CURATOR).map((tab) => tab.key), ["mine", "needs_action", "active", "pending", "closed"]);
  const html = surfaces.get("counts-unavailable");
  assert.match(html, /Счётчики недоступны, список работает\. <a[^>]*href="\/v3\/profile\?view=active"[^>]*>Повторить<\/a>/u);
  const nav = html.match(/<nav id="admissions-summary"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  assert.doesNotMatch(nav, /tabular-nums/u, "no number on any tab");
  assert.doesNotMatch(html, /<span class="font-normal tabular-nums text-fg-3">·/u, "no number on any band");
  // With the read, every tab number is the number of rows its click shows.
  const counted = surfaces.get("admin-active").match(/<nav id="admissions-summary"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  assert.deepEqual([...counted.matchAll(/<a [^>]*>([^<]+)(?:<span class="tabular-nums text-fg-3">(\d+)<\/span>)?<\/a>/gu)].map((match) => [match[1], match[2] ?? null]), [
    ["Мои", "8"], ["Требуют действия", "9"], ["Все в работе", "20"], ["Ожидает начала", "2"], ["Ждут куратора", "2"], ["Закрытые", "14"], ["Нагрузка кураторов", null],
  ]);
  // EVO Docs: review/fix tabs are filtered inside the read, so their numbers need a complete read.
  const rows = [{ documents: { submitted: 2, correctionRequired: 0, rejected: 0 } }, { documents: { submitted: 0, correctionRequired: 1, rejected: 1 } }, { documents: null }];
  assert.deepEqual(docsTabCounts(rows, true, null), { review: 1, fix: 1, all: 3 });
  assert.deepEqual(docsTabCounts(rows, false, null), { review: null, fix: null, all: null });
  assert.deepEqual(docsTabCounts(rows, false, { views: { active: 57 } }), { review: null, fix: null, all: 57 });
  assert.equal(docsRowMatches("review", rows[2]), false, "no document read, no document tab");
  assert.equal(docsRowMatches("all", rows[2]), true);
  const incomplete = surfaces.get("docs-incomplete");
  const docsNav = incomplete.match(/<nav id="admissions-summary"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  assert.deepEqual([...docsNav.matchAll(/<a [^>]*>([^<]+)(?:<span class="tabular-nums text-fg-3">(\d+)<\/span>)?<\/a>/gu)].map((match) => [match[1], match[2] ?? null]), [
    ["На проверку", null], ["Исправить", null], ["Все", "20"],
  ]);
  assert.match(incomplete, /Проверены первые 20 дел в работе; числа вкладок — после полного чтения\./u);
});

test("view tabs are real links with exactly one aria-current page and the old summary anchor", () => {
  for (const [name, current] of [["admin-active", "Все в работе"], ["admin-default", "Требуют действия"], ["curator-mine", "Мои"], ["curators", "Нагрузка кураторов"], ["docs-review", "На проверку"]]) {
    const html = surfaces.get(name);
    const nav = html.match(/<nav id="admissions-summary" aria-label="Виды списка студентов"[\s\S]*?<\/nav>/u)?.[0];
    assert.ok(nav, name);
    const selected = [...nav.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]+)/gu)].map((match) => match[1]);
    assert.deepEqual(selected, [current], name);
    assert.match(nav, /class="v3-choice /u);
  }
  assert.doesNotMatch(surfaces.get("curator-mine"), />Ждут куратора<|>Нагрузка кураторов</u);
});

test("the queue is one semantic table: caption, column headers, a row header per row, labelled bands", () => {
  const html = surfaces.get("admin-active");
  assert.match(html, /<table role="table" class="block w-full" data-testid="v3-student-case-table"><caption class="sr-only">Все в работе: 20 на этой странице<\/caption>/u);
  const headers = [...html.matchAll(/<th role="columnheader" scope="col"[^>]*>([\s\S]*?)<\/th>/gu)].map((match) => texts(match[1]));
  assert.deepEqual(headers, ["Студент", "Следующий шаг", "Срок", "Этап", "Куратор", "Сигналы", "Дело"]);
  for (const band of html.matchAll(/<tbody role="rowgroup" aria-labelledby="(students-band-[a-z_]+)"/gu)) {
    assert.match(html, new RegExp(`id="${band[1]}"`, "u"));
  }
  const rows = [...html.matchAll(/<tr role="row" data-queue-row="([^"]+)" data-testid="v3-student-case-row"[^>]*>([\s\S]*?)<\/tr>/gu)];
  assert.equal(rows.length, 20);
  for (const [, id, body] of rows) {
    assert.match(body, /^<th role="rowheader" scope="row"/u, id);
    // The whole row opens «Быстрый просмотр»; the second link opens the case overview.
    assert.match(body, new RegExp(`<a data-queue-open=""[^>]*href="/v3/profile\\?view=active&amp;open=${id}"`, "u"), id);
    assert.match(body, new RegExp(`<a data-queue-full=""[^>]*href="/v3/profile\\?case=${id}&amp;tab=overview&amp;returnTo=%2Fv3%2Fprofile%3Fview%3Dactive%26open%3D${id}"`, "u"), id);
    assert.doesNotMatch(body, /tab=route/u, id);
  }
  // Stage uses the words of «Воронка поступления»; dates are mono with a word.
  assert.match(html, />Готовы к подаче</u);
  assert.doesNotMatch(html, /Индивидуальный этап сопровождения/u);
  assert.match(html, /<time dateTime="2026-09-19" class="font-mono tabular-nums [^"]*text-danger">19\.09<\/time><span class="[^"]*text-danger">прошёл<\/span>/u);
  assert.match(html, /<time dateTime="2026-09-24" class="font-mono tabular-nums [^"]*text-fg">24\.09<\/time><span class="[^"]*text-fg-3">завтра<\/span>/u);
  assert.match(html, /<span class="t-meta text-fg-3[^"]*">без срока<\/span>/u);
  // Awaiting acceptance under the curator; a case without one says it needs one.
  assert.match(html, /<span class="font-medium text-warn @min-\[36rem\]\/students:block">ждёт принятия<\/span>/u);
  // «Требуют действия» holds the pending cases that need one.
  assert.match(surfaces.get("admin-default"), /<span class="font-medium text-danger">нужен куратор<\/span>/u);
  // Signals are words from the row.
  assert.match(html, /2\u00a0задачи просрочены/u);
  assert.match(html, /2\u00a0документа исправить/u);
  assert.match(html, /Просрочен дедлайн/u);
  assert.match(html, /Ждём партнёра/u);
  // Signals are never cut: no clamp or ellipsis on the signals cell; each signal wraps whole.
  const source = read("src/components/v3/students/StudentsQueueTable.tsx");
  const signalsCell = source.match(/function SignalsCell[\s\S]*?\n\}\n/u)?.[0] ?? "";
  assert.ok(signalsCell, "SignalsCell");
  assert.doesNotMatch(signalsCell, /line-clamp|truncate|text-ellipsis/u);
  assert.match(signalsCell, /className=\{`inline-block max-w-full font-medium \$\{TONE\[signal\.tone\]\}`\}/u);
  // Rows settle at 44 px when the step fits one line: 4 px per cell from 60rem, the hairline is an inset shadow.
  assert.match(source, /const CELL = "min-w-0 px-3 @min-\[36rem\]\/students:px-2 @min-\[60rem\]\/students:py-1";/u);
  assert.match(source, /shadow-\[inset_0_-1px_0_var\(--border\)\][^`]*@min-\[60rem\]\/students:py-0/u);
  // The column header keeps the rows' tracks and gaps and stays visible beside the panel (from 30rem).
  assert.match(source, /const HEAD_GRID = `grid grid-cols-\[minmax\(0,1fr\)_auto\] gap-x-3 \$\{MID_COLUMNS\} \$\{WIDE_COLUMNS\}`;/u);
  assert.match(html, /<thead role="rowgroup" class="sr-only @min-\[30rem\]\/students:not-sr-only/u);
});

test("«Мои» has no curator column: its exceptions become signals, and the update sort shows its key", () => {
  const mine = surfaces.get("curator-mine");
  const headers = [...mine.matchAll(/<th role="columnheader" scope="col"[^>]*>([\s\S]*?)<\/th>/gu)].map((match) => texts(match[1]));
  assert.deepEqual(headers, ["Студент", "Следующий шаг", "Срок", "Этап", "Сигналы", "Дело"]);
  assert.doesNotMatch(mine, />Вы</u, "no «Вы» on every row");
  const base = { overdueTaskCount: 0, documents: null, attentionFlags: [], dueBand: "later", isMine: true, currentCuratorMembershipId: MEMBER, currentCuratorDisplayName: "Имя Фамилия" };
  assert.deepEqual(studentsRowSignals({ ...base, attentionFlags: ["awaiting_ack"] }), [], "with the column the words stay in it");
  assert.deepEqual(studentsRowSignals({ ...base, attentionFlags: ["awaiting_ack"] }, { curatorWords: true }).map((signal) => [signal.text, signal.tone]), [["ждёт принятия", "warn"]]);
  assert.deepEqual(studentsRowSignals({ ...base, isMine: false }, { curatorWords: true }).map((signal) => signal.text), ["куратор:\u00a0Имя Ф."]);
  assert.deepEqual(studentsRowSignals({ ...base, currentCuratorMembershipId: null, isMine: false, attentionFlags: ["needs_curator"] }, { curatorWords: true }).map((signal) => [signal.text, signal.tone]), [["нужен куратор", "danger"]]);
  // Sorted by update there are no due bands: the overdue step is a word and the row shows «обн. ДД.ММ».
  assert.deepEqual(studentsRowSignals({ ...base, dueBand: "overdue" }, { overdueStep: true }).map((signal) => signal.text), ["Шаг просрочен"]);
  assert.deepEqual(studentsUpdatedDay("2026-09-22T20:30:00Z", "2026-09-23"), { dateTime: "2026-09-22T20:30:00Z", text: "23.09" }, "the Bishkek day");
  assert.equal(studentsUpdatedDay("not a date", "2026-09-23"), null);
  const updated = surfaces.get("admin-updated");
  assert.match(updated, /обн\. <time dateTime="[^"]+" class="font-mono tabular-nums">\d\d\.\d\d<\/time>/u);
  assert.match(updated, />Шаг просрочен</u);
  assert.doesNotMatch(surfaces.get("admin-active"), /обн\. <time/u, "the due sort keeps the due word");
});

test("row signals and the documents line are words from the row, never guesses", () => {
  const base = { overdueTaskCount: 0, documents: null, attentionFlags: [], dueBand: "later" };
  assert.deepEqual(studentsRowSignals(base), []);
  assert.deepEqual(studentsRowSignals({ ...base, overdueTaskCount: 5, attentionFlags: ["overdue"] }).map((signal) => signal.text), ["5\u00a0задач просрочено"]);
  // The overdue flag without overdue tasks or an overdue step is a deadline (application/visa).
  assert.deepEqual(studentsRowSignals({ ...base, attentionFlags: ["overdue"] }).map((signal) => signal.text), ["Просрочен дедлайн"]);
  assert.deepEqual(studentsRowSignals({ ...base, attentionFlags: ["overdue"], dueBand: "overdue" }), []);
  const documents = { total: 12, approved: 7, submitted: 2, correctionRequired: 1, rejected: 1, missing: 1 };
  // «На проверке» is the reviewer's work: in the documents line, not in the row signals.
  assert.deepEqual(studentsRowSignals({ ...base, documents }).map((signal) => [signal.text, signal.tone]), [
    ["1\u00a0документ исправить", "warn"], ["1\u00a0документ отклонён", "warn"],
  ]);
  assert.deepEqual(studentsRowSignals({ ...base, documents: { ...documents, correctionRequired: 0, rejected: 0 } }), []);
  assert.deepEqual(studentsDocumentsLine(documents), {
    summary: "7 из 12 принято",
    parts: [
      { key: "review", tone: "muted", text: "2\u00a0на проверке" },
      { key: "fix", tone: "warn", text: "1\u00a0исправить" },
      { key: "rejected", tone: "warn", text: "1\u00a0отклонён" },
      { key: "missing", tone: "muted", text: "1\u00a0не\u00a0загружено" },
    ],
  });
  assert.equal(studentsDocumentsLine(null), null, "no document read — no document numbers");
  assert.deepEqual(studentsDocumentsLine({ ...documents, total: 0, approved: 0, submitted: 0, correctionRequired: 0, rejected: 0, missing: 0 }), { summary: "Чек-лист не собран", parts: [] });
});

test("the next-step editor is shown only where the RPC may allow it; others read it", () => {
  const row = { state: "active", isMine: false, studentCaseId: CASE };
  const staff = { admin: false, preview: false, routeManage: true, broadScope: false };
  assert.deepEqual(nextStepAccess({ ...staff, admin: true }, row), { kind: "edit" });
  assert.deepEqual(nextStepAccess(staff, { ...row, isMine: true }), { kind: "edit" });
  assert.deepEqual(nextStepAccess({ ...staff, broadScope: true }, row), { kind: "edit" });
  assert.deepEqual(nextStepAccess(staff, row, [CASE]), { kind: "edit" });
  assert.deepEqual(nextStepAccess(staff, row), { kind: "read_only", reason: null });
  assert.deepEqual(nextStepAccess({ ...staff, routeManage: false }, { ...row, isMine: true }), { kind: "read_only", reason: null });
  assert.deepEqual(nextStepAccess({ ...staff, admin: true, preview: true }, row), { kind: "read_only", reason: "В просмотре интерфейса роли шаг не меняется." });
  assert.deepEqual(nextStepAccess({ ...staff, admin: true }, { ...row, state: "closed" }), { kind: "read_only", reason: "Дело закрыто: шаг не меняется." });
  assert.deepEqual(nextStepAccess({ ...staff, admin: true }, { ...row, state: "pending" }), { kind: "read_only", reason: "Шаг задаётся только делу в работе." });
  // Rendered: Admin gets the editor; the role preview reads the step with the reason.
  const panel = surfaces.get("admin-panel").slice(surfaces.get("admin-panel").indexOf("<dialog"));
  assert.match(panel, /data-testid="v3-next-step-editor"/u);
  const preview = surfaces.get("preview-panel").slice(surfaces.get("preview-panel").indexOf("<dialog"));
  assert.doesNotMatch(preview, /data-testid="v3-next-step-editor"/u);
  assert.match(preview, /Записать на визу X1 · <time dateTime="2026-09-23" class="font-mono tabular-nums ">23\.09<\/time><span class="text-fg-2"> сегодня<\/span>/u);
  assert.match(preview, /В просмотре интерфейса роли шаг не меняется\./u);
  // Another curator's case: read-only without an invented reason; tasks unavailable, not «нет задач».
  const other = surfaces.get("curator-panel-other").slice(surfaces.get("curator-panel-other").indexOf("<dialog"));
  assert.doesNotMatch(other, /data-testid="v3-next-step-editor"/u);
  assert.match(other, /Задачи сейчас недоступны\./u);
  assert.doesNotMatch(other, /Открытых задач нет/u);
});

test("the editor validates like the SQL and submits exactly the action's fields", () => {
  const source = read("src/components/v3/students/NextStepEditor.tsx");
  const action = read("src/lib/platform-case-next-action-actions.ts");
  const actionFields = action.match(/const CASE_NEXT_ACTION_FIELDS = \[([\s\S]*?)\] as const;/u)?.[1].match(/"([a-z_]+)"/gu).map((field) => field.slice(1, -1));
  assert.deepEqual([...editor.NEXT_STEP_FORM_FIELDS], actionFields);
  const form = editor.nextStepForm({ studentCaseId: CASE, nextAction: "Старый", nextActionDueOn: null, admissionsVersion: "7" }, "Новый шаг", "2026-09-25", "5b0d7c0e-2d4f-4c1a-9a7e-3f2b1c0d9e8f");
  assert.deepEqual([...form.keys()], actionFields);
  // The expected version is the version of the read row; the request id comes from the action state.
  assert.equal(form.get("expected_version"), "7");
  assert.equal(form.get("next_action"), "Новый шаг");
  assert.equal(form.get("next_action_due_on"), "2026-09-25");
  assert.match(source, /setRequestId\(state\.requestId\);/u);
  assert.match(source, /if \(busy\.current\) return;\s+busy\.current = true;/u);
  // «Сохранено» only from the receipt. A version conflict makes «Обновить» the dark primary and locks
  // «Сохранить» and «Снять шаг» until the case is re-read; the typed text stays and says so.
  assert.match(source, /if \(state\.status === "saved" && state\.receipt\)/u);
  assert.match(source, /const locked = Boolean\(server\?\.stale\) && \(!refreshed \|\| refreshing\);/u);
  assert.match(source, /\{locked \? \(\s*<button type="button" onClick=\{refresh\} className=\{QUEUE_CONFIRM\}>Обновить<\/button>\s*\) : null\}/u);
  assert.match(source, /<button type="submit" disabled=\{pending \|\| !dirty \|\| locked\} className=\{locked \? QUEUE_SECONDARY : QUEUE_CONFIRM\}>/u);
  assert.match(source, /disabled=\{pending \|\| locked\} onClick=\{\(\) => void send\("", ""\)\}/u);
  assert.match(source, /\{server\.stale && text\.trim\(\) \? <span className="text-fg"> Ваш текст остался в поле\.<\/span> : null\}/u);
  assert.match(source, /startRefresh\(\(\) => router\.refresh\(\)\);/u);
  // Input errors sit directly under their own field and are wired to it.
  assert.match(source, /aria-invalid=\{stepError \? true : undefined\}\s+aria-describedby=\{stepError \? stepErrorId : undefined\}\s+className=\{STEP_FIELD\}\s+\/>\s+\{stepError \? <p id=\{stepErrorId\} role="alert"/u);
  assert.match(source, /aria-invalid=\{dateError \? true : undefined\}\s+aria-describedby=\{dateError \? dateErrorId : undefined\}/u);
  // The step field never collapses below three lines; the five due choices are one 44 px button group.
  assert.match(source, /const STEP_FIELD = "mt-1 block min-h-24 /u);
  assert.match(source, /const SEGMENT = "v3-choice relative -ms-px inline-flex min-h-11 min-w-0 flex-auto /u);
  assert.match(source, /<div className="mt-1 flex">\s+\{chips\.map/u);
  assert.match(read("src/lib/v3/wording.ts"), /stale: "Шаг уже изменили: другой сотрудник, другая вкладка или правка дела\. Обновите\.",/u);
  {
    assert.equal(editor.nextStepInputError("", "today", "", true), "Напишите шаг или нажмите «Снять шаг»: срок без шага не сохраняется.");
    assert.equal(editor.nextStepInputError("  ", "friday", "", false), "Напишите шаг: срок без шага не сохраняется.");
    assert.equal(editor.nextStepInputError("Шаг", "date", "", false), "Выберите дату или другой срок.");
    assert.equal(editor.nextStepInputError("Шаг", "none", "", false), null);
    assert.equal(editor.nextStepInputError("", "none", "", true), null, "blank step without a date clears it");
    assert.equal(editor.nextStepChoiceFor(null, false, "2026-09-23"), "today");
    assert.equal(editor.nextStepChoiceFor(null, true, "2026-09-23"), "none");
    assert.equal(editor.nextStepChoiceFor("2026-09-24", true, "2026-09-23"), "tomorrow");
    assert.equal(editor.nextStepChoiceFor("2026-09-25", true, "2026-09-23"), "friday");
    assert.equal(editor.nextStepChoiceFor("2026-11-02", true, "2026-09-23"), "date");
    assert.equal(editor.nextStepDueFor("friday", "", "2026-09-23"), "2026-09-25");
    assert.equal(editor.nextStepDueFor("none", "2026-09-30", "2026-09-23"), "");
    assert.equal(editor.oneLineStep("Позвонить\nсемье\r\nзавтра утром"), "Позвонить семье завтра утром");
  }
  // The server contract agrees with the editor's one-line rule.
  assert.equal(parseCaseNextActionInput("Позвонить семье", "2026-09-25")?.nextAction, "Позвонить семье");
  assert.equal(parseCaseNextActionInput("", "2026-09-25"), null);
  assert.equal(parseCaseNextActionInput("a\nb", ""), null);
});

test("«Быстрый просмотр» is the queue panel: record heading, the case with returnTo, tasks and documents", () => {
  const html = surfaces.get("admin-panel");
  // The head (tabs, toolbar) spans the full width above the grid, so opening the panel
  // neither wraps it nor moves the first row; list and panel share the grid from 1280 px.
  assert.match(html, /^<div class="min-w-0 space-y-2" data-testid="v3-student-case-directory"><div class="space-y-1\.5" data-testid="v3-students-queue-head">/u);
  const grid = html.indexOf('<div class="xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start xl:gap-6">');
  assert.ok(grid > html.indexOf('data-testid="queue-toolbar"'), "the grid starts below the toolbar");
  assert.ok(html.indexOf("<dialog") > grid);
  const row = html.slice(html.indexOf(`data-queue-row="${CASE}"`));
  assert.match(row, /^[^>]*class="[^"]*\bbg-surface-2\b/u);
  assert.match(row, /aria-current="true"/u);
  const panel = html.slice(html.indexOf("<dialog"));
  assert.match(panel, /^<dialog open="" aria-labelledby="([^"]+)" data-testid="queue-detail-panel"/u);
  assert.match(panel, /data-testid="queue-detail-close"[^>]*href="\/v3\/profile\?view=active"/u);
  assert.match(panel, /<h2 id="[^"]+" tabindex="-1" data-queue-heading="" class="t-record-title[^"]*">Нурсултан Бекмурзаевич Джумабаев-Осмоналиев<\/h2>/u);
  assert.match(panel, new RegExp(`href="/v3/profile\\?case=${CASE}&amp;tab=overview&amp;returnTo=%2Fv3%2Fprofile%3Fview%3Dactive%26open%3D${CASE}">Открыть дело</a>`, "u"));
  assert.match(panel, /<dt class="t-caption text-fg-2">Этап<\/dt><dd[^>]*>Подбор вузов<\/dd>/u);
  // Quick due choices: «Пт 25.09» appears because Friday is not tomorrow.
  assert.deepEqual([...panel.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>([^<]+)<\/button>/gu)].map((match) => [match[2], match[1]]), [
    ["Сегодня", "true"], ["Завтра", "false"], ["Пт 25.09", "false"], ["Дата…", "false"], ["Без срока", "false"],
  ]);
  assert.match(panel, /<button type="submit" disabled="" class="[^"]*\bbg-fg\b[^"]*">Сохранить<\/button>/u, "nothing to save yet; confirm is dark neutral");
  assert.doesNotMatch(panel, /\bbg-accent\b/u, "no second solid red in the panel");
  assert.match(panel, /href="\/v3\/tasks\?create=case&amp;case=cccccccc-2222-4222-8222-000000000003"[^>]*>\+ Задача<\/a>/u);
  assert.match(panel, /href="\/v3\/tasks\?task=ffffffff-5555-4555-8555-000000000001&amp;kind=case&amp;case=cccccccc-2222-4222-8222-000000000003"/u);
  assert.match(panel, /<span class="text-warn"> · заблокирована<\/span>/u);
  assert.match(panel, /Документы<\/h3><p class="t-body-compact text-fg">6 из 10 принято/u);
  // A row that is not on this page is said plainly, with the case link.
  const missing = surfaces.get("panel-missing").slice(surfaces.get("panel-missing").indexOf("<dialog"));
  assert.match(missing, /Дела нет на этой странице списка/u);
  assert.match(missing, /href="\/v3\/profile\?case=cccccccc-2222-4222-8222-000000000099&amp;tab=overview&amp;returnTo=%2Fv3%2Fprofile%3Fview%3Dactive">Открыть дело<\/a>/u);
});

test("toolbar: search «/», filters with counts inside menus, sort visible, «Сбросить» only when set", () => {
  const html = surfaces.get("admin-active");
  const toolbar = html.match(/<div role="group" aria-label="Поиск и фильтры"[\s\S]*?data-testid="queue-toolbar">[\s\S]*?<\/div><\/div>/u)?.[0] ?? html;
  assert.match(toolbar, /<input type="hidden" name="view" value="active"\/>/u);
  assert.match(toolbar, /<input data-queue-search="" type="search"[^>]*name="q"/u);
  for (const label of ["Направление", "Куратор", "Этап"]) assert.match(html, new RegExp(`<span>${label}</span>`, "u"), label);
  assert.match(html, /Сортировка: <span class="text-fg">по сроку<\/span>/u);
  assert.doesNotMatch(html, />Сбросить</u);
  // Direction counts come from the counts read; an absent direction is 0 only because the read succeeded.
  const directions = html.match(/role="group" aria-label="Направление"[\s\S]*?<\/ul>/u)?.[0] ?? "";
  assert.match(directions, /Китай<\/span><span class="shrink-0 tabular-nums text-fg-3">6<\/span>/u);
  assert.match(directions, /Не указано<\/span><span class="shrink-0 tabular-nums text-fg-3">1<\/span>/u);
  const curators = html.match(/role="group" aria-label="Куратор"[\s\S]*?<\/ul>/u)?.[0] ?? "";
  assert.deepEqual([...curators.matchAll(/<span class="min-w-0 flex-1">([^<]+)<\/span>/gu)].map((match) => match[1]), ["Все кураторы", "Я", "Гульнара Асанова", "Жибек Саматова", "Эрмек Токтосунов"]);
  const filtered = surfaces.get("admin-filtered");
  assert.match(filtered, /Направление: <span class="text-fg">Китай<\/span>/u);
  assert.match(filtered, /Куратор: <span class="text-fg">Я<\/span>/u);
  assert.match(filtered, /Этап: <span class="text-fg">Документы<\/span>/u);
  assert.match(filtered, /aria-label="Убрать фильтр: Направление: Китай"/u);
  assert.match(filtered, /href="\/v3\/profile\?view=active"[^>]*>\s*Сбросить/u);
  // One row: search shrinks to 12rem before filters wrap; «?» sits at the end of the first line, never alone.
  const toolbarSource = read("src/components/v3/queue/QueueToolbar.tsx");
  assert.match(toolbarSource, /<div role="group" aria-label="Поиск и фильтры" className="flex items-start gap-2" data-testid="queue-toolbar">\s+<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">/u);
  assert.match(toolbarSource, /className="min-w-48 flex-1 basis-48 md:max-w-sm"/u);
  assert.match(toolbarSource, /<\/QueueFilterDisclosure>\s+<\/div>\s+<QueueKeyboardHelp extra=\{keys\} \/>/u);
  // The view tabs never wrap: they scroll inside their own row, the current tab is brought into view, edges fade.
  const tabs = read("src/components/v3/queue/QueueViewTabs.tsx");
  assert.match(tabs, /<ul className="flex min-w-max items-center gap-1 border-b border-border pb-2">/u);
  assert.doesNotMatch(tabs, /flex-wrap/u);
  const strip = read("src/components/v3/queue/QueueTabStrip.tsx");
  assert.match(strip, /querySelector<HTMLElement>\('\[aria-current="page"\]'\)/u);
  assert.match(strip, /data-fade-end=\{edges\.end \? "" : undefined\}/u);
  assert.match(read("src/app/(v3)/v3.css"), /\.v3-world \.v3-tab-strip\[data-fade-end\] \{\s+mask-image:/u);
  // The page-specific key lives in «?», not as permanent text.
  assert.match(html, /<kbd[^>]*>Shift<\/kbd><kbd[^>]*>Enter<\/kbd><\/dt><dd class="t-body-compact text-fg-2">открыть дело<\/dd>/u);
  assert.match(read("src/components/v3/queue/useQueueKeyboard.ts"), /if \(event\.key === "Enter" && event\.shiftKey\) \{[\s\S]*querySelector<HTMLElement>\(QUEUE_FULL_SELECTOR\)[\s\S]*full\.click\(\);/u);
});

test("empty, error and loading states are honest", () => {
  const empty = surfaces.get("empty-mine");
  assert.match(empty, /data-testid="queue-empty"><p class="t-item text-fg">Активных дел у вас нет<\/p><a[^>]*href="\/v3\/profile\?view=active"[^>]*>Все в работе · 20<\/a>/u);
  const error = surfaces.get("page-error");
  assert.match(error, /data-testid="queue-error"><p class="t-item text-danger">Не удалось загрузить список студентов\.<\/p><a[^>]*href="\/v3\/profile\?view=active"[^>]*>Повторить<\/a>/u);
  // The tabs keep their counts when only the list read failed.
  assert.match(error, />Все в работе<span class="tabular-nums text-fg-3">20<\/span>/u);
  assert.match(surfaces.get("curators-unavailable"), /Нагрузка сейчас недоступна\. Это не означает, что дел или задач нет\./u);
  const loading = read("src/app/(v3)/v3/profile/loading.tsx");
  assert.match(loading, /<QueueSkeleton label="Загружаем список студентов…" leading=\{false\} \/>/u);
});

test("EVO Docs is a document review queue without work statuses", () => {
  const html = surfaces.get("docs-review");
  const headers = [...html.matchAll(/<th role="columnheader" scope="col"[^>]*>([\s\S]*?)<\/th>/gu)].map((match) => texts(match[1]));
  assert.deepEqual(headers, ["Студент", "Документы", "Куратор", "Действие", "Ещё"]);
  for (const word of ["Этап", "Сортировка", "Сигналы", "ждёт принятия", "Следующий шаг", "Просрочено"]) assert.doesNotMatch(html, new RegExp(word, "u"), word);
  assert.doesNotMatch(html, />Сбросить</u, "the fixed docs order is not a chosen filter");
  const rows = [...html.matchAll(/<tr role="row" data-queue-row="([^"]+)" data-testid="v3-student-case-row"[^>]*>([\s\S]*?)<\/tr>/gu)];
  assert.ok(rows.length > 0);
  for (const [, id, body] of rows) {
    assert.match(body, /^<th role="rowheader" scope="row"/u, id);
    // One row action; its hit area is the row. The former actions stay in «⋯».
    assert.equal([...body.matchAll(/data-queue-open=""/gu)].length, 1, id);
    assert.match(body, new RegExp(`<a data-queue-open=""[^>]*href="/v3/profile\\?case=${id}&amp;tab=documents&amp;section=docs&amp;returnTo=%2Fv3%2Fprofile%3Fsection%3Ddocs">Открыть документы`, "u"), id);
    assert.match(body, /aria-label="Ещё по документам: [^"]+"/u, id);
    assert.match(body, /на проверке/u, id);
  }
  // The docs menu keeps «Анкета и формы» and «Пакет ZIP» at their former destinations.
  const menu = read("src/components/v3/students/StudentsDocsTable.tsx");
  assert.match(menu, /anketaHref=\{studentsCaseHref\(row\.studentCaseId, \{ docs: true, tab: "anketa", returnTo \}\)\}/u);
  assert.match(menu, /packetHref=\{`\$\{studentsCaseHref\(row\.studentCaseId, \{ docs: true, tab: "route", returnTo \}\)\}&panel=packets#partner-packets`\}/u);
  assert.match(surfaces.get("docs-all"), /Нет доступа к документам/u);
  // The row action looks like a link: text and arrow, underlined on row hover and on focus, one line.
  assert.match(menu, /className="inline-flex min-h-11 items-center gap-1\.5 whitespace-nowrap t-label text-fg underline-offset-4 before:absolute before:inset-0 before:content-\[''\] group-hover:underline focus-visible:underline"/u);
  assert.match(html, /Порядок: сначала недавно изменённые дела/u, "the order is said, not implied");
  // The documents cell leads with the number that defines the tab.
  const documents = { total: 12, approved: 7, submitted: 2, correctionRequired: 1, rejected: 1, missing: 1 };
  assert.deepEqual(studentsDocsCell("review", documents).lead.map((part) => part.text), ["2\u00a0на проверке"]);
  assert.deepEqual(studentsDocsCell("review", documents).rest.map((part) => part.text), ["7 из 12 принято", "1\u00a0исправить", "1\u00a0отклонён", "1\u00a0не\u00a0загружено"]);
  assert.deepEqual(studentsDocsCell("fix", documents).lead.map((part) => [part.text, part.tone]), [["1\u00a0исправить", "warn"], ["1\u00a0отклонён", "warn"]]);
  assert.deepEqual(studentsDocsCell("all", documents).lead.map((part) => part.text), ["7 из 12 принято"]);
  assert.equal(studentsDocsCell("review", null), null);
  assert.match(surfaces.get("docs-fix"), /<span class="block t-item"><span><span class="inline-block font-medium text-warn">\d\u00a0(?:исправить|отклонён)/u);
  const tabs = html.match(/<nav id="admissions-summary"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  assert.deepEqual([...tabs.matchAll(/<a [^>]*>([^<]+)/gu)].map((match) => match[1]), ["На проверку", "Исправить", "Все"]);
});

test("«Нагрузка кураторов» keeps the coverage read, form and permissions as an Admin view", () => {
  const html = surfaces.get("curators");
  const headers = [...html.matchAll(/<th role="columnheader" scope="col"[^>]*>([^<]+)<\/th>/gu)].map((match) => match[1]);
  assert.deepEqual(headers, ["Куратор", "Активных дел", "Открытых задач", "Ближайший срок"]);
  assert.match(html, /<a data-queue-open="" aria-current="true"[^>]*href="\/v3\/profile\?view=curators&amp;coverage_curator=aaaaaaaa-1111-4111-8111-000000000002#curator-coverage">Эрмек Токтосунов<\/a>/u);
  assert.match(html, /недоступен для нового назначения/u);
  const panel = html.slice(html.indexOf("<dialog"));
  assert.match(panel, /aria-labelledby="curator-coverage-title" data-testid="queue-detail-panel"/u);
  assert.match(panel, /data-testid="queue-detail-close"[^>]*href="\/v3\/profile\?view=curators"/u);
  assert.match(panel, /<h2 id="curator-coverage-title" tabindex="-1" data-queue-heading=""/u);
  assert.match(panel, /data-testid="v3-curator-coverage-form"/u);
  assert.match(panel, /<input type="hidden" name="view" value="curators"\/>/u);
  // «Отмена» stays on this view, on the case owner.
  assert.match(panel, /href="\/v3\/profile\?view=curators&amp;coverage_curator=aaaaaaaa-1111-4111-8111-000000000002#curator-coverage">Отмена<\/a>/u);
  // No solid red: confirmation is dark neutral; disabled is explicit, not dimmed.
  const confirm = panel.match(/<button type="submit" disabled="" class="([^"]+)">Подтвердить замещение<\/button>/u);
  assert.ok(confirm);
  assert.doesNotMatch(confirm[1], /\bbg-accent\b|opacity-/u);
  // Coverage dates use the queue's mono day.month format.
  assert.match(html, /<time dateTime="2026-09-25T09:30:00Z" class="whitespace-nowrap font-mono tabular-nums">25\.09 15:30<\/time> · Бишкек/u);
  assert.doesNotMatch(html, /data-testid="v3-student-case-row"/u);
});

test("a curator-scoped refusal for a former curator keeps workload counts and names the reason", async () => {
  const FORMER = "aaaaaaaa-1111-4111-8111-000000000005";
  const admin = { systemRole: "admin", presentationRole: null, permissionKeys: [] };
  const workload = [{ id: MEMBER, name: "Куратор А", active: true, active_case_count: 7, open_task_count: 2, nearest_due: null }];
  const workspace = { organization_id: "eeeeeeee-4444-4444-8444-000000000000", curators: workload, cases: [], next_case_id: null, preview: null };
  const reader = (answers) => {
    const calls = [];
    const readWorkspace = async (_actor, selection) => {
      calls.push(selection);
      const answer = answers[calls.length - 1];
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { calls, read: readWorkspace };
  };
  const refused = new Error("Curator coverage is unavailable.");
  const bookmark = reader([refused, workspace]);
  const fromBookmark = await resolveStudentsCoverage(admin, { coverage_curator: FORMER, coverage_case: CASE }, undefined, bookmark.read);
  assert.equal(fromBookmark.kind, "curator_unavailable");
  assert.equal(fromBookmark.explicit, true);
  assert.equal(fromBookmark.caseId, CASE);
  const other = reader([refused, workspace]);
  assert.equal((await resolveStudentsCoverage(admin, { coverage_curator: MEMBER }, undefined, other.read)).kind, "unavailable");
  const untouched = reader([]);
  assert.deepEqual(await resolveStudentsCoverage({ ...admin, presentationRole: "admissions" }, {}, undefined, untouched.read), { kind: "hidden" });
  assert.deepEqual(await resolveStudentsCoverage({ systemRole: "staff", presentationRole: null, permissionKeys: [] }, {}, undefined, untouched.read), { kind: "hidden" });
  assert.deepEqual(await resolveStudentsCoverage(admin, { coverage_case: CASE }, undefined, untouched.read), { kind: "invalid" });
  assert.equal(untouched.calls.length, 0);
});

test("one date format: day.month, a two-digit year only when it differs", () => {
  assert.equal(formatDueOn("2026-09-27", "2026-09-24"), "27.09");
  assert.equal(formatDueOn("2027-01-03", "2026-09-24"), "03.01.27");
  assert.deepEqual(coverageDue({ due_on: null, due_at: "2026-12-31T20:30:00Z" }, "2026-09-24"), { dateTime: "2026-12-31T20:30:00Z", text: "01.01.27 02:30", timed: true });
  assert.equal(coverageDue(null, "2026-09-24"), null);
});

test("Sales keeps the 078 list with the limited handoff summary", () => {
  const sales = surfaces.get("sales");
  assert.doesNotMatch(sales, /id="admissions-summary"/u, "no queue views for Sales");
  assert.ok([...sales.matchAll(/data-access="sales_summary"/gu)].length >= 1);
  assert.doesNotMatch(sales, /data-access="full"/u);
  assert.doesNotMatch(sales, /href="[^"]*case=/u);
  assert.match(sales, /href="\/v3\/profile\?id=dddddddd-3333-4333-8333-000000000001"/u);
  assert.match(sales, /итог передачи/u);
  assert.match(sales, /name="case_q"/u);
});

test("the facet rail is gone and the page reads no summary for it", () => {
  for (const path of ["StudentsWorkspace.tsx", "StudentsFacetDisclosure.tsx", "StudentCaseTable.tsx", "students-facets.ts"]) {
    assert.equal(existsSync(new URL(`../src/components/v3/profile/${path}`, import.meta.url)), false, path);
  }
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.doesNotMatch(page, /readAdmissionsSummary|StudentsWorkspace|students-facets/u);
  for (const name of ["admin-active", "curator-mine", "docs-review"]) {
    assert.doesNotMatch(surfaces.get(name), /aria-label="Фильтры студентов"|students-facet-/u, name);
  }
  // The queue has no main action of its own: nothing here is solid red.
  for (const file of ["StudentsQueueTable.tsx", "StudentsQueueHead.tsx", "StudentQuickView.tsx", "NextStepEditor.tsx", "StudentsDocsTable.tsx", "CuratorWorkloadView.tsx", "StudentsDirectoryFallback.tsx", "StudentsQueueScreen.tsx"]) {
    assert.doesNotMatch(read(`src/components/v3/students/${file}`), /\bbg-accent\b|\bopacity-/u, file);
  }
});

// --- Исправления по независимому review #1056 (25.09) ------------------------

test("curator assignment views follow case.curator.assign, not the Admin role", () => {
  const params = ok({});
  assert.deepEqual(studentsQueueTabs(params, null, MANAGER).map((tab) => tab.key),
    ["mine", "needs_action", "active", "pending", "needs_curator", "closed", "curators"], "a manager with case.curator.assign sees both views");
  assert.deepEqual(studentsQueueTabs(params, null, CURATOR).map((tab) => tab.key), ["mine", "needs_action", "active", "pending", "closed"]);
  assert.equal(parse({ view: "curators" }, MANAGER).kind, "ok");
  assert.equal(parse({ view: "curators" }, CURATOR).kind, "invalid");
  // The coverage form returns to `view=curators`; old links open the same view.
  assert.equal(parse({ coverage_curator: MEMBER }, MANAGER).params.view, "curators");
  assert.equal(parse({ attention: "needs_curator" }, MANAGER).kind, "redirect");
  assert.match(parse({ attention: "needs_curator" }, MANAGER).href, /view=needs_curator/u);
  assert.doesNotMatch(parse({ attention: "needs_curator" }, CURATOR).href, /view=needs_curator/u);
  // The default view stays by role: a manager works from «Мои» like any curator.
  assert.equal(parse({}, MANAGER).params.defaultView, "mine");
  const manager = surfaces.get("manager-default");
  assert.match(manager, /aria-label="Куратор[^"]*"/u, "«Куратор ▾» for a manager");
  assert.match(surfaces.get("manager-curators"), /data-testid="v3-curator-workload/u);
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /coverage: !preview && staffHasPermission\(actor, "case\.curator\.assign"\)/u);
});

test("Enter never saves an unchanged or locked step, and a due without text is not a change", () => {
  const source = read("src/components/v3/students/NextStepEditor.tsx");
  const submit = source.slice(source.indexOf("function submit("), source.indexOf("function refresh("));
  assert.match(submit, /if \(!dirty \|\| locked\) return;/u, "requestSubmit() bypasses the disabled button");
  assert.equal(editor.nextStepDirty("", "2026-09-25", { text: "", due: "" }), false, "«Сегодня» on an empty field is not a change");
  assert.equal(editor.nextStepDirty("Позвонить", "2026-09-25", { text: "", due: "" }), true);
  assert.equal(editor.nextStepDirty(" Позвонить ", "2026-09-25", { text: "Позвонить", due: "2026-09-25" }), false);
  assert.equal(editor.nextStepDirty("Позвонить", "", { text: "Позвонить", due: "2026-09-25" }), true);
  assert.equal(editor.nextStepDirty("", "", { text: "Позвонить", due: "" }), true, "clearing an existing step is a change");
  // After the answer — and after «Обновить» — focus goes back to the step field instead of <body>,
  // but never away from where the person moved it while waiting.
  const refresh = source.slice(source.indexOf("function refresh("), source.indexOf("const friday"));
  assert.match(submit + refresh, /restoreFocus\.current = Boolean\(formRef\.current\?\.contains\(document\.activeElement\)\)/u);
  assert.match(refresh, /restoreFocus\.current = Boolean\(formRef\.current\?\.contains\(document\.activeElement\)\)/u, "«Обновить» disappears after the reread");
  assert.match(source, /if \(pending \|\| refreshing \|\| !restoreFocus\.current\) return;[\s\S]*active === document\.body \|\| formRef\.current\?\.contains\(active\)\) fieldRef\.current\?\.focus\(\);[\s\S]*\}, \[pending, refreshing\]\);/u);
});

test("a queue read the server refuses is an honest dead end, not a retry loop", () => {
  const html = surfaces.get("forbidden");
  assert.match(html, /Список студентов для вашей учётной записи недоступен\./u);
  assert.doesNotMatch(html, />Повторить</u);
  assert.doesNotMatch(html, /Не удалось загрузить список/u);
  assert.doesNotMatch(html, /id="admissions-summary"|name="q"/u, "no tabs or filters that cannot open anything");
  // 241 refuses a frozen legacy role that «Сотрудники» cannot change — no false remedy there.
  assert.doesNotMatch(html, /Сотрудник/u);
  // The coverage read does not go through 241: whoever may assign curators keeps «Нагрузка кураторов».
  assert.match(html, /href="\/v3\/profile\?view=curators">Открыть «Нагрузку кураторов»</u);
  const docs = surfaces.get("forbidden-docs");
  assert.match(docs, /Очередь EVO Docs для вашей учётной записи недоступна\./u);
  assert.doesNotMatch(docs, /Список студентов|Нагрузку кураторов/u, "EVO Docs names itself; no coverage link without the right");
  const lib = read("src/lib/platform-student-case-queue.ts");
  assert.match(lib, /if \(response\.error\?\.code === "42501"\) throw new StudentCaseQueueForbiddenError\(\);/u);
  assert.match(read("src/lib/v3/students-queue-source.ts"), /forbidden = error instanceof StudentCaseQueueForbiddenError;/u);
});

test("when the list itself failed, the counts note does not claim the list works", () => {
  const html = surfaces.get("page-and-counts-error");
  assert.match(html, /Не удалось загрузить список студентов\./u);
  assert.doesNotMatch(html, /Счётчики недоступны, список работает/u);
  assert.match(surfaces.get("counts-unavailable"), /Счётчики недоступны, список работает/u, "still shown when only counts failed");
});

test("EVO Docs does not say «нет» from a partial read or without document access", () => {
  const partial = surfaces.get("docs-incomplete-empty");
  assert.match(partial, /В прочитанной части списка ничего не найдено/u);
  assert.doesNotMatch(partial, /Документов на проверку нет/u);
  assert.match(partial, /Проверить следующие 100/u);
  assert.match(partial, /Проверены первые \d+ (дело|дела|дел) в работе/u);
  assert.doesNotMatch(partial, /первые [234] дел /u, "Russian plural: 4 дела, not 4 дел");
  const noAccess = surfaces.get("docs-no-access");
  assert.match(noAccess, /Нет доступа к документам дел — откройте «Все»/u);
  assert.doesNotMatch(noAccess, /Документов на проверку нет/u);
  // No readable documents: the review tabs and the header have no number, not «0».
  assert.match(noAccess, /href="\/v3\/profile\?section=docs">На проверку<\/a>/u);
  assert.match(noAccess, /href="\/v3\/profile\?section=docs&amp;view=fix">Исправить<\/a>/u);
  const blind = [{ documents: null }, { documents: null }];
  assert.deepEqual(docsTabCounts(blind, true, { views: { active: 2 } }), { review: null, fix: null, all: 2 });
  assert.deepEqual(docsTabCounts([], true, null), { review: 0, fix: 0, all: 0 }, "no cases at all is a true zero");
});

test("«Закрытые» has no due groups and no add-a-step hint", () => {
  const closed = surfaces.get("closed");
  assert.ok([...closed.matchAll(/data-queue-row=/gu)].length >= 5, "closed rows are rendered");
  assert.doesNotMatch(closed, /students-band-/u);
  assert.doesNotMatch(closed, /добавьте шаг/u);
  // Without steps in work the order is by update: the key is shown, there is no sort choice, an old step is not «просрочен».
  assert.match(texts(closed), /обн\. \d\d\.\d\d/u);
  assert.doesNotMatch(closed, /Сортировка/u);
  assert.doesNotMatch(closed, /Шаг просрочен/u);
  for (const view of ["closed", "pending"]) {
    assert.equal(studentsQueueRequest(ok({ view })).sort, "updated", view);
    assert.equal(studentsQueueRequest(ok({ view, sort: "due" })).sort, "updated", `${view}: a carried due sort is not applied`);
    assert.equal(parse({ view, cursor: `due|1|2026-09-20|${CASE}` }).kind, "invalid", `${view}: a due cursor cannot page an update order`);
    assert.equal(parse({ view, cursor: `updated|2026-09-20T10:00:00.000000Z|${CASE}` }).kind, "ok", view);
  }
  assert.equal(studentsQueueRequest(ok({ view: "active" })).sort, "due");
  assert.equal(studentsQueueRequest(ok({ view: "active", sort: "updated" })).sort, "updated");
  assert.equal(studentsEffectiveSort("mine", "due"), "due");
  assert.doesNotMatch(surfaces.get("pending"), /Сортировка/u);
  assert.equal(studentsStepView("closed"), false);
  assert.equal(studentsStepView("active"), true);
  const rows = [{ dueBand: "overdue" }, { dueBand: "no_step" }];
  assert.deepEqual(studentsBands(rows, "due", "2026-09-23", null, false).map((band) => band.key), ["all"]);
});

test("stage keys never reach the screen and the summary read is gone with its last reader", () => {
  for (const file of ["StudentsQueueTable.tsx", "StudentQuickView.tsx", "StudentsQueueHead.tsx"]) {
    assert.doesNotMatch(read(`src/components/v3/students/${file}`), /admissionsPipelineStage\([^)]*\) \?\? /u, file);
  }
  const source = read("src/lib/v3/admissions-source.ts");
  assert.doesNotMatch(source, /readAdmissionsSummary|normalizeAdmissionsSummary|admissions_direction_summary_v1/u);
  assert.doesNotMatch(read("src/lib/platform-admissions-playbook-contract.ts"), /AdmissionsSummary/u);
});

test("«Ожидает начала» is a queue view: pending cases, no due groups, legacy links land on it", () => {
  const params = ok({});
  assert.deepEqual(studentsQueueTabs(params, null, CURATOR).map((tab) => [tab.key, tab.label]).find(([key]) => key === "pending"), ["pending", "Ожидает начала"]);
  assert.equal(parse({ view: "pending" }, CURATOR).kind, "ok");
  const legacy = parse({ case_status: "pending" }, ADMIN);
  assert.equal(legacy.kind, "redirect");
  assert.equal(legacy.href, "/v3/profile?view=pending");
  assert.equal(studentsStepView("pending"), false, "the step is set only on a case in work");
  const html = surfaces.get("pending");
  assert.ok([...html.matchAll(/data-queue-row=/gu)].length >= 1, "pending rows are rendered");
  assert.doesNotMatch(html, /students-band-/u, "no due groups for cases that are not in work");
  assert.doesNotMatch(html, /добавьте шаг/u);
  // A declined case keeps its saved step (182): its date is shown, but it is not «просрочен».
  assert.match(texts(html), /Созвониться о старте занятий 18\.09/u);
  assert.doesNotMatch(html, /Шаг просрочен|прошёл/u);
  // Nor in its quick view, where the step is read-only (overdue open tasks keep their own word).
  const panel = surfaces.get("pending-panel");
  assert.match(texts(panel), /Созвониться о старте занятий · 18\.09 Шаг задаётся только делу в работе/u);
  assert.doesNotMatch(panel, /<time[^>]*text-danger[^>]*>18\.09/u);
});

test("«Принять дело» in the panel reuses the case card, only for the curator who can answer", () => {
  const accept = surfaces.get("panel-accept");
  const block = accept.match(/<div class="mt-4" data-testid="v3-students-panel-handoff">[\s\S]*$/u)?.[0] ?? "";
  assert.match(block, /data-testid="v3-handoff-acknowledgement"/u, "the same «Приём дела» part as in the case card");
  assert.match(block, />Принять дело</u);
  assert.doesNotMatch(surfaces.get("admin-panel"), /v3-students-panel-handoff/u, "no block without a snapshot the curator can answer");
  const source = read("src/lib/v3/students-queue-source.ts");
  assert.match(source, /return studentsHandoffPending\(snapshot\) \? Object\.freeze\(\{ \.\.\.snapshot, requestId: randomUUID\(\) \}\) : null;/u);
  // Only while the case waits for acceptance — the same rule as the awaiting_ack signal (182).
  const snapshot = { canRespond: true, assignmentEventId: "abababab-7777-4777-8777-000000000001", current: null };
  const answer = (decision) => ({ acknowledgementId: "acacacac-7777-4777-8777-000000000002", decision, clarification: null, agreedContactDate: null, createdAt: "2026-09-22T08:00:00.000Z" });
  assert.equal(studentsHandoffPending(snapshot), true, "no answer yet");
  assert.equal(studentsHandoffPending({ ...snapshot, current: answer("clarification_requested") }), true, "a clarification is not an acceptance");
  assert.equal(studentsHandoffPending({ ...snapshot, current: answer("accepted") }), false, "an accepted case is not asked again in the queue");
  assert.equal(studentsHandoffPending({ ...snapshot, canRespond: false }), false, "only the curator who can answer");
  assert.equal(studentsHandoffPending({ ...snapshot, assignmentEventId: null }), false, "nothing to answer without an assignment");
  const clarification = surfaces.get("panel-clarification");
  assert.match(clarification, /Уточните, кто из родителей подписывает договор\./u, "the open clarification is shown");
  assert.match(clarification, /data-testid="v3-students-panel-handoff"[\s\S]*>Принять дело</u);
  // After «Принять дело» the re-read snapshot no longer waits for an answer and the block goes:
  // the panel names the saved result and moves focus off the vanished button.
  const card = read("src/components/v3/profile/ProfileSalesTransition.tsx");
  assert.match(card, /const next = await respondToHandoffAction\(previous, formData\);\s*if \(next\.status === "saved"\) onSaved\?\.\(formData\.get\("decision"\) as HandoffDecision\);/u);
  const panel = read("src/components/v3/students/StudentQuickView.tsx");
  assert.match(panel, /onSaved=\{\(decision\) => setAnswered\(decision === "clarification_requested" \? null : decision\)\}/u);
  assert.match(panel, /\) : answered \? \(\s*<p role="status"[\s\S]*?\{answered === "accepted" \? "Дело принято\." : "Назначение отклонено\. Дело снова ждёт куратора\."\}/u,
    "said only after the server's receipt; a decline returns the case to pending without a curator (182)");
  // The panel row may be the one read before the answer (the case left the view): no stale «ждёт принятия» or curator.
  assert.match(panel, /const awaiting = !answered && row\.attentionFlags\.includes\("awaiting_ack"\);/u);
  assert.match(panel, /\{answered === "declined" \? <span className="font-medium text-danger">нужен куратор<\/span>/u, "the same words as the list row");
  assert.match(panel, /if \(!answered \|\| handoff\) return;[\s\S]*active === document\.body\) headingRef\.current\?\.focus\(\);/u);
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /params\.open && !isStaffPreview\(actor\) \? readStudentsHandoff\(actor, params\.open\)/u, "one read per open panel, never in role preview");
});
