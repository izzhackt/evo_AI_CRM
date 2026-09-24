import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
import {
  activeFilters,
  buildFacetGroups,
  coverageDue,
  formatDueOn,
  nextStepOverdue,
  rowProblems,
} from "../src/components/v3/profile/students-facets.ts";
import { resolveStudentsCoverage } from "../src/lib/v3/students-coverage.ts";

/**
 * «Студенты» — фасеты и таблица (решение владельца 24.09.2026). Логика чисел
 * проверяется напрямую, разметка — настоящим рендером дерева компонентов с
 * синтетическими данными (tests/e2e/students-static-render.cjs --json) в
 * отдельном node-процессе без react-server. Это не живая проверка данных.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const surfaces = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/students-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));

const CURATOR = "aaaaaaaa-1111-4111-8111-000000000001";
const params = (patch = {}) => ({ active: Object.keys(patch).length > 0, cursor: null, invalid: false, ...patch });
const SUMMARY = {
  stock: [
    { direction: "CN", active: 12, overdue: 3, awaiting_ack: 1, needs_curator: 0 },
    { direction: "MY", active: 5, overdue: 1, awaiting_ack: 0, needs_curator: 2 },
    { direction: "unknown", active: 1, overdue: 0, awaiting_ack: 0, needs_curator: 0 },
  ],
};
const group = (groups, id) => groups.find((item) => item.id === id);
const counts = (item) => Object.fromEntries(item.items.map((entry) => [entry.key, entry.count]));

test("facets take every number from the summary read and scope attention to the chosen direction", () => {
  const all = buildFacetGroups({ params: params(), docsMode: false, allowAdmissionsFilters: true, summary: SUMMARY, curators: [], workload: null });
  assert.deepEqual(counts(group(all, "direction")), { "": 18, CN: 12, MY: 5, EUROPE: 0, AE: 0, TR: 0, unknown: 1 });
  assert.deepEqual(counts(group(all, "attention")), { overdue: 4, needs_curator: 2, awaiting_ack: 1 });
  // The summary counts only active cases: pending/closed get no number at all.
  assert.deepEqual(counts(group(all, "state")), { active: 18, pending: null, closed: null });

  const china = buildFacetGroups({ params: params({ direction: "CN" }), docsMode: false, allowAdmissionsFilters: true, summary: SUMMARY, curators: [], workload: null });
  assert.deepEqual(counts(group(china, "attention")), { overdue: 3, needs_curator: 0, awaiting_ack: 1 });
  assert.deepEqual(counts(group(china, "state")), { active: 12, pending: null, closed: null });
  // Direction counts stay per direction so the rail keeps its comparison.
  assert.deepEqual(counts(group(china, "direction")), counts(group(all, "direction")));
});

test("no read means no number: facets never invent zeros or labels", () => {
  const groups = buildFacetGroups({ params: params(), docsMode: false, allowAdmissionsFilters: true, summary: null, curators: [{ membershipId: CURATOR, displayName: "Куратор А" }], workload: null });
  for (const item of groups) {
    assert.equal(item.countLabel, null, item.id);
    assert.ok(item.items.every((entry) => entry.count === null), item.id);
  }
  // Sales (no admissions filters) keeps only the status facet.
  const sales = buildFacetGroups({ params: params(), docsMode: false, allowAdmissionsFilters: false, summary: null, curators: [], workload: null });
  assert.deepEqual(sales.map((item) => item.id), ["state"]);
});

test("curator workload comes only from the coverage read and unknown selections are named honestly", () => {
  const workload = [
    { id: CURATOR, name: "Куратор А", active: true, active_case_count: 7, open_task_count: 2, nearest_due: null },
    { id: "aaaaaaaa-1111-4111-8111-000000000004", name: "Куратор Г", active: false, active_case_count: 1, open_task_count: 0, nearest_due: null },
  ];
  const withWorkload = group(buildFacetGroups({ params: params({ curatorMembershipId: CURATOR }), docsMode: false, allowAdmissionsFilters: true, summary: null, curators: [{ membershipId: "aaaaaaaa-1111-4111-8111-000000000002", displayName: "Куратор Б" }], workload }), "curator");
  assert.deepEqual(withWorkload.items.map((entry) => [entry.label, entry.count, entry.note ?? null, entry.selected]), [
    ["Куратор А", 7, null, true], ["Куратор Г", 1, "недоступен", false], ["Куратор Б", null, null, false],
  ]);
  // A second click on the selected curator clears the filter.
  assert.equal(withWorkload.items[0].href, "/v3/profile");
  const unknown = group(buildFacetGroups({ params: params({ curatorMembershipId: CURATOR }), docsMode: false, allowAdmissionsFilters: true, summary: null, curators: [], workload: null }), "curator");
  assert.deepEqual(unknown.items.map((entry) => [entry.label, entry.count]), [["Выбранный куратор", null]]);
});

test("a curator-scoped refusal for a former curator keeps workload counts and names the reason", async () => {
  const FORMER = "aaaaaaaa-1111-4111-8111-000000000005";
  const CASE = "cccccccc-2222-4222-8222-000000000002";
  const admin = { systemRole: "admin", presentationRole: null, permissionKeys: [] };
  const workload = [{ id: CURATOR, name: "Куратор А", active: true, active_case_count: 7, open_task_count: 2, nearest_due: null }];
  const workspace = { organization_id: "eeeeeeee-4444-4444-8444-000000000000", curators: workload, cases: [], next_case_id: null, preview: null };
  // The real reader throws one generic error for every refusal (42501 «Curator
  // unavailable» included); only an unscoped read can say why.
  const reader = (answers) => {
    const calls = [];
    const read = async (_actor, selection) => {
      calls.push(selection);
      const answer = answers[calls.length - 1];
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { calls, read };
  };
  const refused = new Error("Curator coverage is unavailable.");

  // Facet selection of a former curator: scoped read refused, unscoped read has no such curator.
  const former = reader([refused, workspace]);
  assert.deepEqual(await resolveStudentsCoverage(admin, {}, FORMER, former.read), {
    kind: "curator_unavailable", curators: workload, curatorId: FORMER, caseId: null, afterCaseId: null, explicit: false,
  });
  assert.deepEqual(former.calls, [{ curatorId: FORMER, caseId: undefined, afterCaseId: undefined }, {}]);

  // The same for an old coverage bookmark with a case: the section opens with the reason.
  const bookmark = reader([refused, workspace]);
  const fromBookmark = await resolveStudentsCoverage(admin, { coverage_curator: FORMER, coverage_case: CASE }, undefined, bookmark.read);
  assert.equal(fromBookmark.kind, "curator_unavailable");
  assert.equal(fromBookmark.explicit, true);
  assert.equal(fromBookmark.caseId, CASE);

  // The curator is still listed: the refusal had another cause, nothing is invented.
  const other = reader([refused, workspace]);
  assert.deepEqual(await resolveStudentsCoverage(admin, {}, CURATOR, other.read), {
    kind: "unavailable", curatorId: CURATOR, caseId: null, afterCaseId: null, explicit: false,
  });
  // Both reads failing, or an unscoped read failing, stay unavailable without a retry loop.
  const both = reader([refused, refused]);
  assert.equal((await resolveStudentsCoverage(admin, {}, FORMER, both.read)).kind, "unavailable");
  assert.equal(both.calls.length, 2);
  const unscoped = reader([refused]);
  assert.equal((await resolveStudentsCoverage(admin, {}, undefined, unscoped.read)).kind, "unavailable");
  assert.equal(unscoped.calls.length, 1);

  // A successful scoped read is used as is; no second read.
  const ready = reader([workspace]);
  assert.equal((await resolveStudentsCoverage(admin, {}, CURATOR, ready.read)).kind, "ready");
  assert.equal(ready.calls.length, 1);
  // Access and parameter rules are unchanged and never reach the reader.
  const untouched = reader([]);
  assert.deepEqual(await resolveStudentsCoverage({ ...admin, presentationRole: "admissions" }, {}, FORMER, untouched.read), { kind: "hidden" });
  assert.deepEqual(await resolveStudentsCoverage({ systemRole: "staff", presentationRole: null, permissionKeys: [] }, {}, FORMER, untouched.read), { kind: "hidden" });
  assert.deepEqual(await resolveStudentsCoverage(admin, { coverage_case: CASE }, undefined, untouched.read), { kind: "invalid" });
  assert.equal(untouched.calls.length, 0);
});

test("the coverage section states why it cannot cover instead of opening empty", () => {
  const unavailable = surfaces.get("curator-unavailable");
  const section = unavailable.match(/<section id="curator-coverage"[\s\S]*?<\/section>/u)?.[0] ?? "";
  assert.match(section, /<details><summary[^>]*>Замещение куратора<\/summary><div[^>]*><p role="status" class="text-sm text-fg-2">Этот куратор сейчас недоступен для замещения\.<\/p><\/div><\/details>/u);
  assert.doesNotMatch(section, /Нагрузка сейчас недоступна/u);
  // Workload counts stay in the curator facet; the former curator has no number.
  const curatorFacet = unavailable.match(/<section aria-labelledby="students-facet-curator">[\s\S]*?<\/section>/u)?.[0] ?? "";
  for (const count of ["104", "96", "78"]) assert.match(curatorFacet, new RegExp(`<span class="sr-only">в работе: </span>${count}</span>`, "u"), count);
  assert.match(curatorFacet, /aria-current="true"[^>]*><span[^>]*>Выбранный куратор<\/span><span class="sr-only">, снять фильтр<\/span>/u);
  assert.doesNotMatch(unavailable, /Нагрузка кураторов сейчас недоступна/u);

  // A successful read without the selected curator: the same single line, no case picker.
  const missing = surfaces.get("curator-missing");
  assert.match(missing, /<details open=""><summary[^>]*>Замещение куратора<\/summary><div[^>]*><p role="status" class="text-sm text-fg-2">Этот куратор сейчас недоступен для замещения\.<\/p><\/div><\/details>/u);
  assert.doesNotMatch(missing, /Найти студента<\/span><select name="coverage_case"/u);
});

test("facet links keep the URL filter contract, docs section and toggles", () => {
  const groups = buildFacetGroups({ params: params({ direction: "MY", attention: "overdue", query: "Ким" }), docsMode: true, allowAdmissionsFilters: true, summary: SUMMARY, curators: [], workload: null });
  const direction = group(groups, "direction");
  assert.equal(direction.items.find((entry) => entry.key === "MY").selected, true);
  assert.equal(direction.items.find((entry) => entry.key === "").href, "/v3/profile?case_q=%D0%9A%D0%B8%D0%BC&attention=overdue&section=docs");
  const overdue = group(groups, "attention").items.find((entry) => entry.key === "overdue");
  assert.equal(overdue.selected, true);
  assert.equal(overdue.href, "/v3/profile?case_q=%D0%9A%D0%B8%D0%BC&direction=MY&section=docs");
  assert.deepEqual(activeFilters(params({ direction: "MY", attention: "visas", state: "closed" }), false, null).map((filter) => [filter.label, filter.href]), [
    ["Малайзия", "/v3/profile?case_status=closed&attention=visas"],
    // A legacy attention value stays visible (and clearable) with its own label.
    ["Визовые дела", "/v3/profile?case_status=closed&direction=MY"],
    ["Закрыто", "/v3/profile?direction=MY&attention=visas"],
  ]);
});

test("row rules mirror the server: Bishkek overdue next step and worded problem counts", () => {
  const row = { access: "full", state: "active", nextActionDueOn: "2026-09-23", overdueTaskCount: 2, overdueObligationCount: 1, rejectedDocumentCount: 5 };
  assert.equal(nextStepOverdue(row, "2026-09-24"), true);
  assert.equal(nextStepOverdue({ ...row, nextActionDueOn: "2026-09-24" }, "2026-09-24"), false);
  assert.equal(nextStepOverdue({ ...row, state: "closed" }, "2026-09-24"), false);
  assert.deepEqual(rowProblems(row), ["Просрочка: 2 задачи", "Просрочка: 1 оплата", "Исправить: 5 документов"]);
  assert.deepEqual(rowProblems({ ...row, access: "sales_summary" }), []);
});

test("one date format on the page: day.month, a two-digit year only when it differs", () => {
  assert.equal(formatDueOn("2026-09-27", "2026-09-24"), "27.09");
  assert.equal(formatDueOn("2027-01-03", "2026-09-24"), "03.01.27");
  assert.deepEqual(coverageDue({ due_on: "2026-09-25", due_at: null }, "2026-09-24"), { dateTime: "2026-09-25", text: "25.09", timed: false });
  // Timed coverage work is shown in the organisation's Bishkek zone (UTC+6).
  assert.deepEqual(coverageDue({ due_on: null, due_at: "2026-12-31T20:30:00Z" }, "2026-09-24"), { dateTime: "2026-12-31T20:30:00Z", text: "01.01.27 02:30", timed: true });
  assert.equal(coverageDue({ due_on: null, due_at: null }, "2026-09-24"), null);
  assert.equal(coverageDue(null, "2026-09-24"), null);
});

test("the sidebar no longer has a summary item and the old summary address lands on «Студенты»", () => {
  const admin = { systemRole: "admin", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: [] };
  const model = buildV3Navigation(admin, "/v3/profile", new URLSearchParams("section=summary"));
  const labels = model.groups.flatMap((item) => item.links.map((link) => link.label));
  assert.ok(!labels.includes("Сводка по направлениям"));
  assert.equal(model.activeId, "admissions-worklist");
  assert.equal(existsSync(new URL("../src/components/v3/profile/AdmissionsSummaryReport.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/components/v3/profile/AdmissionsSummaryPanel.tsx", import.meta.url)), false);
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.doesNotMatch(page, /section\) === "summary"|expanded=/u);
  // The old #admissions-summary anchor lands on the facet column, not nowhere.
  assert.match(surfaces.get("admin-default"), /<aside id="admissions-summary" aria-label="Фильтры студентов"/u);
});

test("rendered facets show summary numbers and mark only the selected facets with aria-current", () => {
  const html = surfaces.get("admin-default");
  const current = [...html.matchAll(/<a [^>]*aria-current="true"[^>]*>([\s\S]*?)<\/a>/gu)].map((match) => match[1].replace(/<[^>]+>/gu, "|"));
  assert.equal(current.length, 1);
  assert.match(current[0], /Все/u);
  assert.match(html, /class="v3-choice[^"]*"[^>]*>|aria-current="true" class="v3-choice/u);
  for (const count of ["278", "118", "21"]) assert.match(html, new RegExp(`<span class="sr-only">[^<]+: </span>${count}</span>`, "u"), count);
  assert.match(html, /Жибек Саматова<span class="font-normal text-fg-3"> · недоступен<\/span>/u);

  const filtered = surfaces.get("admin-filtered");
  const selected = [...filtered.matchAll(/<a [^>]*aria-current="true"[^>]*>([\s\S]*?)<\/a>/gu)].map((match) => match[1].replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim());
  assert.deepEqual(selected.map((text) => text.split(" ")[0]), ["Китай", "В", "Айгүл"]);
  assert.match(filtered, /aria-label="Убрать фильтр: Китай"/u);
  assert.match(filtered, /data-testid="v3-curator-coverage"/u);
  assert.match(filtered, /<details open="">/u);
  assert.match(filtered, /data-testid="v3-curator-coverage-form"/u);
  // «Отмена» keeps the table on the same curator, like every coverage link.
  assert.match(filtered, new RegExp(`href="/v3/profile\\?curator=${CURATOR}&amp;coverage_curator=${CURATOR}#curator-coverage">Отмена</a>`, "u"));
  // The summary is read with the chosen curator, so «Все» narrows with it.
  assert.match(filtered, /Все<\/span><span class="shrink-0 tabular-nums text-fg-3"><span class="sr-only">в работе: <\/span>104<\/span>/u);
  // Coverage dates use the table's mono day.month format.
  assert.match(filtered, /<dt class="inline">Ближайший срок: <\/dt><dd class="inline text-fg"><time dateTime="2026-09-25" class="whitespace-nowrap font-mono tabular-nums">25\.09<\/time><\/dd>/u);
  assert.match(filtered, /Айгүл Осмонова · <time dateTime="2026-09-20" class="whitespace-nowrap font-mono tabular-nums">20\.09<\/time>/u);
  // Solid red belongs to «Создать задачу» only; disabled is explicit, not dimmed.
  const confirm = filtered.match(/<button type="submit" disabled="" class="([^"]+)">Подтвердить замещение<\/button>/u);
  assert.ok(confirm, "confirm button renders disabled until the form is complete");
  assert.doesNotMatch(confirm[1], /\bbg-accent\b|opacity-/u);
  assert.match(confirm[1], /\bbg-fg\b[\s\S]*disabled:bg-surface-2 disabled:text-fg-3/u);
  assert.doesNotMatch(read("src/components/v3/profile/CuratorCoverageForm.tsx"), /\bbtnCls\b/u);

  const unavailable = surfaces.get("summary-unavailable");
  assert.doesNotMatch(unavailable, /<span class="sr-only">(в работе|дел): <\/span>/u);
  assert.match(unavailable, /Счётчики недоступны, список работает\./u);
  assert.match(unavailable, /Нагрузка кураторов сейчас недоступна\./u);
});

test("the case list is a semantic table with one real link per row", () => {
  const html = surfaces.get("admin-default");
  assert.match(html, /<table role="table"[^>]*data-testid="v3-student-case-table"><caption class="sr-only">Дела студентов: 12 на этой странице<\/caption>/u);
  const headers = [...html.matchAll(/<th scope="col" role="columnheader"[^>]*>([^<]+)<\/th>/gu)].map((match) => match[1]);
  assert.deepEqual(headers, ["Студент", "Этап", "Следующий шаг", "Срок", "Куратор", "Проблемы"]);
  const rows = [...html.matchAll(/<tr role="row" data-testid="v3-student-case-row" data-access="([^"]+)" data-student-case-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gu)];
  assert.equal(rows.length, 12);
  for (const [, access, id, body] of rows) {
    assert.match(body, /^<th scope="row" role="rowheader"/u, id);
    if (access === "full") {
      assert.equal([...body.matchAll(new RegExp(`href="/v3/profile\\?case=${id}&amp;tab=route"`, "gu"))].length, 1, id);
    } else {
      assert.doesNotMatch(body, /href="[^"]*case=/u, id);
      assert.match(body, /href="\/v3\/profile\?id=[^"]+"/u, id);
      assert.match(body, /Только итог передачи/u, id);
    }
  }
  // Overdue is named in words, not only coloured; dates are mono day.month.
  assert.match(html, /<time dateTime="2026-09-20" class="[^"]*font-mono[^"]*tabular-nums[^"]*">20\.09<\/time><span class="[^"]*text-danger">(?:<span class="@3xl:hidden">срок <\/span>)прошёл<\/span>/u);
  assert.match(html, /<time dateTime="2026-09-24" class="font-mono tabular-nums">24\.09<\/time><\/span>/u);
  assert.doesNotMatch(html, /dateTime="2026-09-24"[^>]*>24\.09<\/time><span[^>]*>(?:<span[^>]*>срок <\/span>)?прошёл/u);
  // «Ожидает принятия» stands under the curator the case waits for.
  assert.match(html, /Эрмек Токтосунов<\/span><span aria-hidden="true" class="@3xl:hidden"> · <\/span><span class="font-medium text-warn @3xl:block">Ожидает принятия<\/span>/u);
  assert.match(html, /Нужно назначить куратора/u);
  // A closed case says so once, in the step column; its stage stays.
  assert.match(html, /Поступление завершено[\s\S]*?Дело закрыто/u);
});

test("dense rows: direction folds under the name, fixed vocabulary never hyphenates", () => {
  const table = read("src/components/v3/profile/StudentCaseTable.tsx");
  assert.doesNotMatch(table, /hyphens-auto/u);
  assert.match(table, /@3xl:line-clamp-2" title=\{row\.nextAction\}/u);
  assert.match(table, /@3xl:block @3xl:truncate" title=\{row\.admissionsDisplayName\}/u);
  // Name hit area: 20 px t-item line + 8 px up to the cell edge + 16 px down =
  // 44 px in the table and in the stack, never above the cell (the sticky
  // header and the previous row would take it). Measured in Chromium, see
  // PR #1050 (48 px in the stack before the typeset roles, #1051).
  assert.match(table, /t-item text-fg underline-offset-4 before:absolute before:-inset-x-1 before:-top-2 before:-bottom-4 /u);
  assert.doesNotMatch(table, /before:-inset-y-/u);
  const html = surfaces.get("admin-default");
  // Name and «direction · degree» share the row header; in the stack the stage
  // continues the same text run (aria-hidden: the stage cell stays for readers).
  assert.match(html, /Айдана Сыдыкова<\/span><\/a><span class="block t-meta text-fg-2 @3xl:truncate" title="Китай · Бакалавриат">Китай · Бакалавриат<span aria-hidden="true" class="@3xl:hidden"><span> · <span class="text-fg">Сбор документов<\/span><\/span><\/span><\/span><\/th>/u);
  assert.match(html, /<td role="cell" class="[^"]*@max-3xl:sr-only"><span class="block text-fg">Сбор документов<\/span><\/td>/u);
});

test("EVO Docs keeps its per-row actions in the same table and no summary numbers", () => {
  const html = surfaces.get("docs");
  const headers = [...html.matchAll(/<th scope="col" role="columnheader"[^>]*>([^<]+)<\/th>/gu)].map((match) => match[1]);
  assert.deepEqual(headers, ["Студент", "Куратор", "Документы"]);
  const rows = [...html.matchAll(/data-testid="v3-student-case-row" data-access="([^"]+)" data-student-case-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gu)];
  assert.equal(rows.length, 11, "sales_summary rows stay out of EVO Docs");
  for (const [, access, id, body] of rows) {
    assert.equal(access, "full");
    // Quiet row links (no bordered button): the same style for all three actions.
    assert.match(body, new RegExp(`<a class="inline-flex min-h-11 [^"]*" href="/v3/profile\\?case=${id}&amp;tab=anketa&amp;section=docs">Анкета и формы</a>`, "u"));
    assert.doesNotMatch(body, /class="[^"]*\bborder-control-edge\b[^"]*"[^>]*>(Анкета и формы|Файлы|Пакет ZIP)</u);
    assert.doesNotMatch(body, /Ожидает принятия/u, "EVO Docs shows documents, not work status");
    assert.match(body, new RegExp(`href="/v3/profile\\?case=${id}&amp;tab=documents&amp;section=docs"[^>]*>Файлы</a>`, "u"));
    assert.match(body, new RegExp(`href="/v3/profile\\?case=${id}&amp;tab=route&amp;panel=packets&amp;section=docs#partner-packets"[^>]*>Пакет ZIP</a>`, "u"));
  }
  assert.match(html, /<input type="hidden" name="section" value="docs"\/>/u);
  assert.doesNotMatch(html, /<span class="sr-only">(в работе|дел): <\/span>/u);
  assert.doesNotMatch(html, /data-testid="v3-curator-coverage"/u);
});

test("pagination uses drawn icons, not text glyphs", () => {
  const workspace = read("src/components/v3/profile/StudentsWorkspace.tsx");
  assert.doesNotMatch(workspace, /[←→]/u);
  assert.match(surfaces.get("admin-default"), /rel="next" href="[^"]+">Следующие записи<svg [^>]*aria-hidden="true"/u);
});

test("invalid, empty and Sales states stay honest", () => {
  assert.match(surfaces.get("invalid"), /role="alert" data-testid="v3-student-case-filter-rejected"/u);
  assert.doesNotMatch(surfaces.get("invalid"), /data-testid="v3-student-case-row"/u);
  assert.match(surfaces.get("empty"), /По вашему запросу ничего не найдено\./u);
  const sales = surfaces.get("sales");
  assert.doesNotMatch(sales, /id="students-facet-(direction|attention|curator)"/u);
  assert.match(sales, /id="students-facet-state"/u);
  assert.ok([...sales.matchAll(/data-access="sales_summary"/gu)].length >= 1);
  assert.doesNotMatch(sales, /data-access="full"/u);
});
