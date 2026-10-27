"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Синтетические данные «Студентов», EVO Docs и «Университетов» для «Нового вида»: очередь, панели и нагрузка — те же сценарии,
 * что у прежнего вида (`students-static-render.cjs`), плюс очереди «Документы программ» и «Комплекты», а каталог — проверенные
 * шаблоны карточек репозитория (публичные сведения о вузах), пропущенные через настоящие серверные модели
 * (`university-list-model`, `university-detail-model`, `manage-index-model`). Имена, числа, дела и файлы выдуманы для проверки
 * вёрстки и не являются записями EVO. Живой Supabase и права этот модуль не проверяет.
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
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://iosckaqtovbbnssqcpde.supabase.co";
const src = (path) => require(join(ROOT, "src", path));

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const uuid = (prefix, n) => `${prefix}-${String(n).padStart(12, "0")}`;

// --- EVO Docs: очереди программ и комплектов -------------------------------------------------------------------
const FILE = (n, name, available = true) => ({
  originalFilename: name, declaredMimeType: "application/pdf", byteSize: "245760", sha256Hex: "a".repeat(64),
  documentVersionId: uuid("dddddddd-8888-4888-8888", n), versionNo: "1", finalizedAt: "2026-09-21T08:00:00.000Z",
  technicalAvailability: available ? "available" : "unavailable", unavailableReasons: available ? [] : ["malware_pending"],
});
const programItem = (n, fields) => ({
  studentCaseId: caseId(fields.caseN), applicationId: uuid("aaaaaaaa-8888-4888-8888", n),
  studentDisplayName: fields.student, universityTitle: fields.university, programTitle: fields.program, requirementLabel: fields.label,
  deadline: fields.deadline ?? null, isCurrentRequirement: fields.current ?? true,
  submission: {
    submissionId: uuid("bbbbbbbb-8888-4888-8888", n), requirementsRevisionId: uuid("cccccccc-8888-4888-8888", n),
    requirementItemId: uuid("eeeeeeee-8888-4888-8888", n), documentSlotId: uuid("ffffffff-8888-4888-8888", n),
    submittedAt: fields.submittedAt, file: FILE(n, fields.file, fields.available ?? true), review: null,
  },
});
const PROGRAM_ITEMS = [
  programItem(1, { caseN: 1, student: "Айдана Сыдыкова", university: "Universiti Teknologi Malaysia", program: "Бакалавриат, информатика", label: "Аттестат с приложением", submittedAt: "2026-09-18T05:00:00.000Z", file: "attestat-sydykova.pdf", deadline: { date: "2026-10-05", time: "23:59", timezone: "Asia/Kuala_Lumpur" } }),
  programItem(2, { caseN: 4, student: "Мээрим Жолдошева", university: "Beijing Institute of Technology", program: "Магистратура, машиностроение", label: "Паспорт", submittedAt: "2026-09-22T05:00:00.000Z", file: "pasport-zholdosheva.pdf", current: false }),
  programItem(3, { caseN: 5, student: "Санжар Алиев", university: "Taylor's University", program: "Foundation", label: "Справка о состоянии здоровья", submittedAt: "2026-09-23T04:00:00.000Z", file: "spravka-aliev-s-dlinnym-imenem-fayla-dlya-proverki-obrezki.pdf", available: false }),
];
const PACKAGE_ITEMS = [
  { studentCaseId: caseId(2), applicationId: uuid("aaaaaaaa-9999-4999-8999", 1), studentDisplayName: "Тимур Абдылдаев",
    program: { institutionId: uuid("11111111-9999-4999-8999", 1), publicationId: uuid("22222222-9999-4999-8999", 1), programId: uuid("33333333-9999-4999-8999", 1), intakeId: uuid("44444444-9999-4999-8999", 1), universityTitle: "UCSI University", programTitle: "Магистратура, бизнес-аналитика", intakeLabel: "Январь 2027" },
    package: { packageId: uuid("55555555-9999-4999-8999", 1), requirementsRevisionId: uuid("66666666-9999-4999-8999", 1), requirementsRevisionVersion: "3", origin: "staff_confirmed", configurationState: "confirmed", packageVersion: "2", previousPackageId: null, compositionSha256: "b".repeat(64), submittedAt: "2026-09-19T05:00:00.000Z", itemCount: 7, isCurrentRequirements: true, latestReview: null } },
  { studentCaseId: caseId(6), applicationId: uuid("aaaaaaaa-9999-4999-8999", 2), studentDisplayName: "Камила Усенова",
    program: { institutionId: uuid("11111111-9999-4999-8999", 2), publicationId: uuid("22222222-9999-4999-8999", 2), programId: uuid("33333333-9999-4999-8999", 2), intakeId: uuid("44444444-9999-4999-8999", 2), universityTitle: "Charles University", programTitle: "Бакалавриат, экономика", intakeLabel: "Сентябрь 2027" },
    package: { packageId: uuid("55555555-9999-4999-8999", 2), requirementsRevisionId: uuid("66666666-9999-4999-8999", 2), requirementsRevisionVersion: "2", origin: "evo_starter", configurationState: "needs_confirmation", packageVersion: "1", previousPackageId: null, compositionSha256: "c".repeat(64), submittedAt: "2026-09-23T05:00:00.000Z", itemCount: 1, isCurrentRequirements: false, latestReview: null } },
];
const ready = (items, nextCursor = null) => ({ kind: "ready", queue: { items, nextCursor } });
const OWNER = { organizationId: ORG, membershipId: legacy.ME };
const REVIEW = { owner: OWNER, canReview: true };

function docsInput(search, extra = {}) {
  const base = scenario(search, { docsMode: true });
  return { ...base.input, packages: ready(PACKAGE_ITEMS), program: ready(PROGRAM_ITEMS), documentReview: REVIEW, ...extra };
}

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
    docs: {
      review: { search: "section=docs", actor: "admin", inputs: { "section=docs": docsInput("section=docs") } },
      all: { search: "section=docs&view=all", actor: "admin", inputs: { "section=docs&view=all": docsInput("section=docs&view=all") } },
      fix: { search: "section=docs&view=fix", actor: "admin", inputs: { "section=docs&view=fix": docsInput("section=docs&view=fix") } },
      program: { search: "section=docs&view=program", actor: "admin", inputs: { "section=docs&view=program": docsInput("section=docs&view=program") } },
      packages: { search: "section=docs&view=packages", actor: "admin", inputs: { "section=docs&view=packages": docsInput("section=docs&view=packages") } },
      incomplete: { search: "section=docs&view=review", actor: "admin", inputs: { "section=docs&view=review": (() => {
        const input = docsInput("section=docs&view=review", { program: ready(PROGRAM_ITEMS, "next") });
        return { ...input, read: { ...input.read, page: { ...input.read.page, nextCursor: input.read.page.rows.at(-1).cursor } } };
      })() } },
      noAccess: { search: "section=docs", actor: "admin", inputs: { "section=docs": SCENARIOS["docs-no-access"].input } },
      programError: { search: "section=docs&view=program", actor: "admin", inputs: { "section=docs&view=program": docsInput("section=docs&view=program", { program: { kind: "error" } }) } },
      packagesEmpty: { search: "section=docs&view=packages", actor: "admin", inputs: { "section=docs&view=packages": docsInput("section=docs&view=packages", { packages: ready([]) }) } },
    },
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
  const list = src("components/v3/universities-next/university-list-model.tsx");
  const detail = src("components/v3/universities-next/university-detail-model.ts");
  const manage = src("components/v3/universities-next/manage-index-model.ts");
  const { universityCountry } = src("components/v3/universities/UniversityCatalogue.tsx");
  const all = catalogue();
  const published = all.map(({ id, version, publishedAt, content }) => ({ id, version, publishedAt, content }));
  const today = "2026-09-27";
  const page = (items, filters, offset = 0) => view.catalogueSortedPage(view.sortCatalogueRows(items, filters.level, NOW), offset);
  const countries = [...new Set(published.map((item) => item.content.country))].sort();
  const props = (items, filters, offset = 0) => {
    const filtered = list.universityListProps(page(items, filters, offset), { query: "", country: "", level: "", offset, ...filters }, countries, true, today);
    return { ...filtered, rows: filtered.rows.map((row) => ({ ...row, thumb: null })) };
  };
  const byName = (key) => published.find((item) => all.find((entry) => entry.key === key)?.id === item.id) ?? published[0];
  const detailOf = (item, canManage = true) => ({
    id: item.id, name: item.content.name, place: detail.universityPlaceText(item.content, universityCountry(item.content.country)),
    programs: detail.universityPrograms(item.content, NOW), overview: item.content.overview, websiteUrl: item.content.websiteUrl, sourceUrl: item.content.sourceUrl,
    verified: detail.universityVerified(item.content, NOW), canManage,
    manage: canManage ? { formsHref: `/v3/universities/${item.id}/forms`, editHref: `/v3/universities/manage?edit=${item.id}` } : null,
  });
  const drafts = published.slice(0, 3).map((item, index) => ({ id: uuid("dddddddd-7777-4777-8777", index + 1), baseVersion: index + 1, content: item.content }));
  return {
    list: props(published, { query: "", country: "", level: "", offset: 0 }),
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
