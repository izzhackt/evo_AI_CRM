"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Синтетические данные «Студентов» и «Университетов» для «Нового вида»: очередь, панели и нагрузка — те же сценарии, что у
 * прежнего вида (`students-static-render.cjs`), а каталог — проверенные шаблоны карточек репозитория (публичные сведения о
 * вузах), пропущенные через настоящие серверные модели (`university-list-model`, `university-detail-model`,
 * `manage-index-model`). Имена, числа и дела выдуманы для проверки вёрстки и не являются записями EVO. Живой Supabase и
 * права этот модуль не проверяет.
 *
 *   node tests/e2e/students-next-fixtures.cjs --json     → stdout: JSON всех сценариев (для tests/ui-next-students.test.mjs).
 *   require("./students-next-fixtures.cjs").build()       → те же сценарии объектами (для tests/e2e/students-next-static-render.cjs).
 */

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Модуль прежнего стенда ставит require-hook для .ts/.tsx и подмену `@/`; он же отдаёт синтетику очереди.
const legacy = require("./students-static-render.cjs");
const { ROOT, TODAY, SCENARIOS, scenario, TASKS, caseId } = legacy;
// Читатель университетов определяет адрес фото по адресу проекта; синтетическому рендеру нужен только допустимый.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://supabase.evoadmissions.com";
const src = (path) => require(join(ROOT, "src", path));

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const uuid = (prefix, n) => `${prefix}-${String(n).padStart(12, "0")}`;

// --- Студенты: сценарии с адресами, на которые страница может перейти ---------------------------------------------
function queueInputs(search, options = {}) {
  const base = scenario(search, options);
  const inputs = { [search]: base.input };
  for (const row of (base.input.read.page?.rows ?? []).slice(0, 8)) {
    const open = `${search}${search ? "&" : ""}open=${row.studentCaseId}`;
    inputs[open] = scenario(open, { ...options, openTasks: row.studentCaseId === caseId(3) || row.studentCaseId === caseId(1) ? TASKS : { kind: "ready", tasks: [] } }).input;
  }
  return { search, actor: options.actor ?? "admin", inputs };
}

function students() {
  const handoff = SCENARIOS["panel-accept"].input.handoff;
  const closure = SCENARIOS["panel-close"].input.closure;
  const queue = queueInputs("view=active");
  queue.inputs[`view=active&open=${caseId(3)}`] = SCENARIOS["panel-accept"].input;
  queue.inputs[`view=active&open=${caseId(1)}`] = { ...SCENARIOS["panel-close"].input, params: scenario(`view=active&open=${caseId(1)}`).input.params, closure: { ...closure, studentCaseId: caseId(1) }, openTasks: TASKS, handoff: null };
  return {
    queue: { ...queue, handoff, closure },
    mine: queueInputs("", { actor: "curator" }),
    needsAction: queueInputs(""),
    sortedUpdated: queueInputs("view=active&sort=updated"),
    curators: { search: "view=curators", actor: "admin", inputs: { "view=curators": SCENARIOS["curators-plain"].input, [`view=curators&coverage_curator=${legacy.CURATOR_B}`]: scenario(`view=curators&coverage_curator=${legacy.CURATOR_B}`, { coverageRead: legacy.coverage({ curatorId: legacy.CURATOR_B, explicit: true }) }).input } },
    states: Object.fromEntries(["counts-unavailable", "page-error", "page-and-counts-error", "forbidden", "empty-mine", "invalid", "closed", "pending", "admin-bare"].map((name) => [name, { search: SCENARIOS[name].search, actor: SCENARIOS[name].actor, inputs: { [SCENARIOS[name].search]: SCENARIOS[name].input } }])),
  };
}

// --- Университеты --------------------------------------------------------------------------------------------------
const NOW = new Date("2026-09-27T04:00:00.000Z");
function catalogue() {
  return ["china", "malaysia", "europe", "turkey", "international", "other"]
    .flatMap((name) => JSON.parse(readFileSync(join(ROOT, `src/lib/server/university-catalog-reviewed-${name}.json`), "utf8")))
    .map((entry, index) => ({ id: uuid("57ce9b97-43fb-4563-9c61", index + 1), version: 1, publishedAt: "2026-09-10T00:00:00+00:00", content: entry.content, key: entry.key }));
}

function universities() {
  const view = src("lib/v3/university-view.ts");
  const list = src("components/staff/universities-next/university-list-model.tsx");
  const detail = src("components/staff/universities-next/university-detail-model.ts");
  const manage = src("components/staff/universities-next/manage-index-model.ts");
  const { universityCountry } = src("components/staff/universities/UniversityCatalogue.tsx");
  const all = catalogue();
  const published = all.map(({ id, version, publishedAt, content }) => ({ id, version, publishedAt, content }));
  const today = "2026-09-27";
  const page = (items, filters, offset = 0) => view.catalogueSortedPage(view.sortCatalogueRows(items, filters.level, NOW), offset);
  const countries = [...new Set(published.map((item) => item.content.country))].sort();
  const props = (items, filters, offset = 0, day = today) => {
    const filtered = list.universityListProps(page(items, filters, offset), { query: "", country: "", level: "", offset, ...filters }, countries, true, day);
    return { ...filtered, rows: filtered.rows.map((row) => ({ ...row, thumb: null })) };
  };
  const byName = (key) => published.find((item) => all.find((entry) => entry.key === key)?.id === item.id) ?? published[0];
  const detailOf = (item, canManage = true) => ({
    id: item.id, name: item.content.name, place: detail.universityPlaceText(item.content, universityCountry(item.content.country)),
    programs: detail.universityPrograms(item.content, NOW), overview: item.content.overview, websiteUrl: item.content.websiteUrl, sourceUrl: item.content.sourceUrl,
    verified: detail.universityVerified(item.content, NOW), canManage,
    manage: canManage ? { formsHref: `/universities/${item.id}/forms`, editHref: `/universities/manage?edit=${item.id}` } : null,
  });
  const drafts = published.slice(0, 3).map((item, index) => ({ id: uuid("dddddddd-7777-4777-8777", index + 1), baseVersion: index + 1, content: item.content }));
  return {
    list: props(published, { query: "", country: "", level: "", offset: 0 }),
    // Через 56 дней после проверки карточки (10.09) все они «давно не проверялись».
    stale: props(published, { query: "", country: "", level: "", offset: 0 }, 0, "2026-11-05"),
    filtered: props(published.filter((item) => item.content.country === "MY"), { query: "", country: "MY", level: "bachelor", offset: 0 }),
    empty: props([], { query: "zzz", country: "", level: "", offset: 0 }),
    withPaging: (() => { const bundle = props(published, { query: "", country: "", level: "", offset: 30 }, 30); return bundle; })(),
    detail: detailOf(byName("utm")),
    detailUnconfirmed: detailOf(byName("apu"), false),
    manage: manage.manageIndexProps({ index: { q: "", cursor: null }, page: { items: drafts, nextCursor: JSON.stringify({ q: "", createdAt: "2026-09-20T10:00:00.123456Z", id: uuid("dddddddd-7777-4777-8777", 3) }) }, templates: all, countryLabel: universityCountry }),
    manageSearch: manage.manageIndexProps({ index: { q: "univ", cursor: null }, page: { items: [], nextCursor: null }, templates: all, countryLabel: universityCountry }),
    manageError: manage.manageIndexProps({ index: { q: "", cursor: null }, page: null, templates: all.slice(0, 4), countryLabel: universityCountry }),
  };
}

const build = () => ({ students: students(), universities: universities() });

if (require.main === module && process.argv.includes("--json")) process.stdout.write(JSON.stringify(build()));
else module.exports = { build, ROOT, TODAY, ORG };
