import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
import {
  activeFilters,
  buildFacetGroups,
  nextStepOverdue,
  rowProblems,
} from "../src/components/v3/profile/students-facets.ts";

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

  const unavailable = surfaces.get("summary-unavailable");
  assert.doesNotMatch(unavailable, /<span class="sr-only">(в работе|дел): <\/span>/u);
  assert.match(unavailable, /Счётчики недоступны, список работает\./u);
  assert.match(unavailable, /Нагрузка кураторов сейчас недоступна\./u);
});

test("the case list is a semantic table with one real link per row", () => {
  const html = surfaces.get("admin-default");
  assert.match(html, /<table role="table"[^>]*data-testid="v3-student-case-table"><caption class="sr-only">Дела студентов: 12 на этой странице<\/caption>/u);
  const headers = [...html.matchAll(/<th scope="col" role="columnheader"[^>]*>([^<]+)<\/th>/gu)].map((match) => match[1]);
  assert.deepEqual(headers, ["Студент", "Направление", "Этап", "Следующий шаг", "Куратор", "Проблемы"]);
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
  // Overdue is named in words, not only coloured.
  assert.match(html, /Срок прошёл <time dateTime="2026-09-20"/u);
  assert.doesNotMatch(html, /Срок прошёл <time dateTime="2026-09-24"/u);
  assert.match(html, /Ожидает принятия/u);
  assert.match(html, /Нужно назначить куратора/u);
});

test("EVO Docs keeps its per-row actions in the same table and no summary numbers", () => {
  const html = surfaces.get("docs");
  const headers = [...html.matchAll(/<th scope="col" role="columnheader"[^>]*>([^<]+)<\/th>/gu)].map((match) => match[1]);
  assert.deepEqual(headers, ["Студент", "Направление", "Куратор", "Документы"]);
  const rows = [...html.matchAll(/data-testid="v3-student-case-row" data-access="([^"]+)" data-student-case-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gu)];
  assert.equal(rows.length, 11, "sales_summary rows stay out of EVO Docs");
  for (const [, access, id, body] of rows) {
    assert.equal(access, "full");
    assert.match(body, new RegExp(`href="/v3/profile\\?case=${id}&amp;tab=anketa&amp;section=docs"[^>]*>Анкета и формы</a>`, "u"));
    assert.match(body, new RegExp(`href="/v3/profile\\?case=${id}&amp;tab=documents&amp;section=docs"[^>]*>Файлы</a>`, "u"));
    assert.match(body, new RegExp(`href="/v3/profile\\?case=${id}&amp;tab=route&amp;panel=packets&amp;section=docs#partner-packets"[^>]*>Пакет ZIP</a>`, "u"));
  }
  assert.match(html, /<input type="hidden" name="section" value="docs"\/>/u);
  assert.doesNotMatch(html, /<span class="sr-only">(в работе|дел): <\/span>/u);
  assert.doesNotMatch(html, /data-testid="v3-curator-coverage"/u);
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
