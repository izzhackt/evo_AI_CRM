"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в tasks-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер «Студентов» — рабочей очереди дел (25.09.2026,
 * PLAN_CHANGES «Студенты» PR 2) и EVO Docs.
 *
 * Рендерит НАСТОЯЩИЙ экран (`buildStudentsQueueScreen`: вкладки, строка
 * инструментов, таблица по группам срока, «Быстрый просмотр» с редактором
 * шага, «Нагрузка кураторов» с `CuratorCoveragePanel`, EVO Docs) и прежний
 * список для Sales (`StudentsDirectoryFallback`) с СИНТЕТИЧЕСКИМИ данными:
 * имена, числа и дела выдуманы для проверки вёрстки и не являются записями
 * EVO. Числа вкладок, групп и меню считаются здесь из тех же синтетических
 * строк — так, как их считает SQL 241. Живой Supabase, права и данные этот
 * рендер не проверяет.
 *
 *   node tests/e2e/students-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — серверная разметка сценариев без
 *       оболочки (для tests/v3-students-queue-ui.test.mjs).
 *   node tests/e2e/students-static-render.cjs --screenshots [outDir]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900, 1280×800, 1920×1080 и 390×844; по умолчанию outDir —
 *       .impeccable/review (не коммитится). Тело страницы в браузере
 *       отрисовывает сам React — те же компоненты, собранные esbuild:
 *       панель поднимается в модальный режим, «Сохранить» в редакторе
 *       нажимается по-настоящему. Серверное действие шага заменено заглушкой,
 *       которая отвечает конфликтом версии (снимок ничего не сохраняет);
 *       остальные действия отказывают.
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

// --- require-hook: .ts/.tsx компилируются TypeScript'ом в CJS ---------------
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8")), filename);
  };
}
// Статический импорт логотипа: next/image получает объект как от сборщика.
Module._extensions[".png"] = (module, filename) => {
  module.exports = { src: pathToFileURL(filename).href, width: 1843, height: 842 };
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (request === "server-only") {
    return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
  }
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    }
    return originalResolve.call(this, base, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");

const { buildStudentsQueueScreen } = require(join(ROOT, "src/components/v3/students/StudentsQueueScreen.tsx"));
const { StudentsDirectoryFallback } = require(join(ROOT, "src/components/v3/students/StudentsDirectoryFallback.tsx"));
const view = require(join(ROOT, "src/components/v3/students/students-queue-view.ts"));

// --- синтетические данные ---------------------------------------------------
// «Сегодня» — среда 23.09.2026 по Бишкеку: видны «Сегодня», «На этой неделе»
// (чт–вс) и быстрый вариант «Пт 25.09» в редакторе.
const TODAY = "2026-09-23";
const NOW = view.bishkekNoon(TODAY);
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const CURATOR_B = "aaaaaaaa-1111-4111-8111-000000000002";
const CURATOR_C = "aaaaaaaa-1111-4111-8111-000000000003";
const CURATOR_D = "aaaaaaaa-1111-4111-8111-000000000004";
const NAMES = { [ME]: "Айгүл Осмонова", [CURATOR_B]: "Эрмек Токтосунов", [CURATOR_C]: "Гульнара Асанова", [CURATOR_D]: "Жибек Саматова" };
const caseId = (n) => `cccccccc-2222-4222-8222-${String(n).padStart(12, "0")}`;
const docs = (total, approved, submitted = 0, correctionRequired = 0, rejected = 0) => ({
  total, approved, submitted, correctionRequired, rejected, missing: total - approved - submitted - correctionRequired - rejected,
});

function row(n, fields) {
  const curator = fields.curator === undefined ? ME : fields.curator;
  const nextAction = fields.step ?? null;
  const nextActionDueOn = nextAction ? fields.due ?? null : null;
  const dueBand = view.caseNextActionBand(nextAction, nextActionDueOn, NOW);
  const sortRank = nextAction === null ? 2 : nextActionDueOn === null ? 1 : 0;
  return {
    studentCaseId: caseId(n),
    studentDisplayName: fields.name,
    state: fields.state ?? "active",
    admissionsDirection: fields.direction ?? null,
    targetCountry: fields.country ?? null,
    targetDegree: fields.degree ?? null,
    pipelineStage: fields.stage ?? "new",
    pipelineHidden: false,
    nextAction,
    nextActionDueOn,
    dueBand,
    admissionsVersion: String(fields.version ?? 3),
    currentCuratorMembershipId: curator,
    currentCuratorDisplayName: curator ? NAMES[curator] : null,
    isMine: curator === ME,
    attentionFlags: fields.flags ?? [],
    overdueTaskCount: fields.overdueTasks ?? 0,
    documents: fields.documents === undefined ? docs(10, 6, 1, 0, 0) : fields.documents,
    updatedAt: fields.updatedAt ?? `2026-09-2${n % 3}T0${n % 9}:00:00.000000Z`,
    cursor: `due|${sortRank}|${nextActionDueOn ?? "infinity"}|${caseId(n)}`,
  };
}

const ROWS = [
  row(1, { name: "Айдана Сыдыкова", direction: "CN", degree: "Бакалавриат", stage: "documents", step: "Собрать апостиль на аттестат", due: "2026-09-20", overdueTasks: 2, flags: ["overdue"], documents: docs(12, 7, 2, 1, 0) }),
  row(2, { name: "Тимур Абдылдаев", direction: "MY", degree: "Магистратура", stage: "ready_to_submit", step: "Подтвердить подачу в UCSI", due: "2026-09-22", curator: CURATOR_B, flags: ["overdue"] }),
  row(3, { name: "Нурсултан Бекмурзаевич Джумабаев-Осмоналиев", direction: "EUROPE", degree: "Бакалавриат", stage: "shortlist", step: "Согласовать с семьёй список программ в Польше и Чехии, включая стоимость обучения, общежитие и сроки подачи", due: TODAY, curator: CURATOR_B, flags: ["awaiting_ack"] }),
  row(4, { name: "Мээрим Жолдошева", direction: "CN", degree: "Магистратура", stage: "visa", step: "Записать на визу X1", due: TODAY, documents: docs(9, 7, 0, 0, 1) }),
  row(5, { name: "Санжар Алиев", direction: "CN", degree: "Языковые курсы", stage: "documents", step: "Перевести паспорт и заверить у нотариуса", due: "2026-09-24", curator: CURATOR_C, documents: docs(11, 5, 0, 2, 0) }),
  row(6, { name: "Камила Усенова", direction: "EUROPE", degree: "Магистратура", stage: "ready_to_submit", step: "Отправить пакет партнёру", due: "2026-09-26", flags: ["awaiting_partner"] }),
  // Просроченный дедлайн заявки при шаге «позже»: флаг overdue без просроченных задач.
  row(7, { name: "Азамат Исаков", direction: "TR", degree: "Бакалавриат", stage: "awaiting_decision", step: "Дождаться решения Bilkent", due: "2026-10-15", curator: CURATOR_C, flags: ["overdue"] }),
  row(8, { name: "Руслан Турдубаев", direction: "AE", degree: "Бакалавриат", stage: "predeparture", step: "Встретить в аэропорту Дубая", due: "2026-10-02" }),
  row(9, { name: "Элиза Каримова", direction: "AE", degree: "Foundation", stage: "new", state: "pending", curator: null, flags: ["needs_curator"], documents: docs(0, 0) }),
  row(10, { name: "Данияр Мамытов", country: "Южная Корея", stage: "new", step: "Первичная консультация с семьёй", curator: CURATOR_C }),
  row(11, { name: "Алина Ким", direction: "MY", degree: "Бакалавриат", stage: "confirmed" }),
  row(12, { name: "Бакыт Орозбеков", direction: "CN", degree: "Бакалавриат", stage: "confirmed", step: "Оплатить депозит за общежитие", due: "2026-10-07", curator: CURATOR_B, documents: null }),
  row(13, { name: "Айжан Токтогулова", direction: "MY", degree: "Foundation", stage: "documents", step: "Загрузить справку о несудимости", due: "2026-09-19", curator: CURATOR_C, overdueTasks: 1, flags: ["overdue"] }),
  row(14, { name: "Эмир Сатыбалдиев", direction: "TR", degree: "Магистратура", stage: "shortlist", curator: CURATOR_B, flags: ["awaiting_ack"] }),
  row(15, { name: "Жанара Мукашева", direction: "EUROPE", degree: "Бакалавриат", stage: "awaiting_decision", step: "Позвонить в приёмную комиссию Карлова университета", due: "2026-09-25" }),
  row(16, { name: "Максат Нурланов", direction: "CN", degree: "Бакалавриат", stage: "visa", step: "Получить JW202", due: "2026-10-20", curator: CURATOR_C }),
  row(17, { name: "Асель Бакирова", direction: "AE", degree: "Магистратура", stage: "documents", step: "Уточнить у семьи список документов", documents: docs(8, 2, 3, 0, 0) }),
  row(18, { name: "Бекзат Шаршенов", stage: "new", state: "pending", curator: null, flags: ["needs_curator"], documents: docs(0, 0) }),
  row(19, { name: "Гүлзат Алымбекова", direction: "MY", degree: "Бакалавриат", stage: "ready_to_submit", step: "Проверить мотивационное письмо", due: TODAY, curator: CURATOR_C, documents: docs(10, 7, 3, 0, 0) }),
  row(20, { name: "Ильяс Жумалиев", direction: "CN", degree: "Магистратура", stage: "documents", step: "Подготовить перевод диплома", due: "2026-09-21", flags: ["overdue"], documents: docs(12, 8, 0, 1, 1) }),
  row(21, { name: "Нурай Касымова", direction: "EUROPE", degree: "Бакалавриат", stage: "predeparture", step: "Купить билет до Праги", due: "2026-10-01", curator: CURATOR_B }),
  row(22, { name: "Темирлан Осмонов", direction: "TR", degree: "Foundation", stage: "confirmed", curator: CURATOR_C }),
];

const BAND_ORDER = ["overdue", "today", "this_week", "later", "undated", "no_step"];
const inView = (r, v) => v === "mine" ? r.state === "active" && r.isMine
  : v === "needs_action" ? r.attentionFlags.some((flag) => ["overdue", "awaiting_ack", "needs_curator"].includes(flag))
  : v === "active" ? r.state === "active"
  : v === "needs_curator" ? r.attentionFlags.includes("needs_curator")
  : v === "closed" ? r.state === "closed" : false;
/** Порядок 241 по сроку: ранг (дата · без даты · без шага), день, id. */
const byDue = (a, b) => (a.cursor < b.cursor ? -1 : a.cursor > b.cursor ? 1 : 0);
const CLOSED_COUNT = 14;

/** Числа чтения 241 для вида и фильтров — посчитаны по тем же синтетическим строкам. */
function countsFor(viewKey, filters = {}) {
  const match = (r, skip) => (skip === "direction" || !filters.direction || (r.admissionsDirection ?? "unknown") === filters.direction)
    && (skip === "curator" || !filters.curator || r.currentCuratorMembershipId === filters.curator)
    && (skip === "stage" || !filters.stage || r.pipelineStage === filters.stage);
  const views = Object.fromEntries(["mine", "needs_action", "active", "needs_curator", "closed"].map((v) => [v, v === "closed" ? CLOSED_COUNT : ROWS.filter((r) => match(r) && inView(r, v)).length]));
  const shown = ROWS.filter((r) => match(r) && inView(r, viewKey));
  const group = (skip, key) => {
    const counts = new Map();
    for (const r of ROWS.filter((item) => match(item, skip) && inView(item, viewKey))) {
      const value = key(r);
      if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  };
  return {
    view: viewKey,
    today: TODAY,
    total: shown.length,
    views,
    bands: Object.fromEntries(BAND_ORDER.map((band) => [band, shown.filter((r) => r.dueBand === band).length])),
    directions: [...group("direction", (r) => r.admissionsDirection ?? "unknown")].map(([direction, count]) => ({ direction, count })),
    curators: [...group("curator", (r) => r.currentCuratorMembershipId)]
      .map(([membershipId, count]) => ({ membershipId, displayName: NAMES[membershipId], isMe: membershipId === ME, count }))
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.displayName.localeCompare(b.displayName, "ru")),
    stages: [...group("stage", (r) => r.pipelineStage)].map(([pipelineStage, count]) => ({ pipelineStage, count })),
  };
}

function pageFor(viewKey, sort = "due", filters = {}) {
  const rows = ROWS.filter((r) => inView(r, viewKey)
    && (!filters.direction || (r.admissionsDirection ?? "unknown") === filters.direction)
    && (!filters.curator || r.currentCuratorMembershipId === filters.curator));
  const sorted = sort === "due" ? [...rows].sort(byDue)
    : [...rows].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((r) => ({ ...r, cursor: `updated|${r.updatedAt}|${r.studentCaseId}` }));
  return { view: viewKey, sort, today: TODAY, rows: sorted, nextCursor: null };
}

const TASKS = {
  kind: "ready",
  tasks: [
    { id: "ffffffff-5555-4555-8555-000000000001", title: "Созвониться с семьёй о бюджете", status: "open", dueOn: "2026-09-22", dueAt: null, assigneeDisplayName: NAMES[CURATOR_B] },
    { id: "ffffffff-5555-4555-8555-000000000002", title: "Собрать ссылки на программы Праги и Брно", status: "in_progress", dueOn: null, dueAt: "2026-09-24T08:00:00.000Z", assigneeDisplayName: NAMES[CURATOR_B] },
    { id: "ffffffff-5555-4555-8555-000000000003", title: "Проверить сроки подачи в Варшаве", status: "blocked", dueOn: "2026-09-29", dueAt: null, assigneeDisplayName: NAMES[ME] },
  ],
};

const EDITOR = {
  admin: { admin: true, preview: false, routeManage: true, broadScope: true },
  curator: { admin: false, preview: false, routeManage: true, broadScope: false },
  // Руководитель поступления: не Admin, но назначает и замещает кураторов (`case.curator.assign`).
  manager: { admin: false, preview: false, routeManage: true, broadScope: true },
  preview: { admin: false, preview: true, routeManage: true, broadScope: true },
};

/** Кто открывает очередь — как `studentsQueueActor` страницы. */
const QUEUE_ACTOR = {
  admin: { admin: true, coverage: true },
  curator: { admin: false, coverage: false },
  manager: { admin: false, coverage: true },
  preview: { admin: false, coverage: false },
};

const COVERAGE_CURATORS = [
  { id: ME, name: NAMES[ME], active: true, active_case_count: 104, open_task_count: 37, nearest_due: { due_on: "2026-09-24", due_at: null } },
  { id: CURATOR_B, name: NAMES[CURATOR_B], active: true, active_case_count: 96, open_task_count: 29, nearest_due: { due_on: null, due_at: "2026-09-25T09:30:00Z" } },
  { id: CURATOR_C, name: NAMES[CURATOR_C], active: true, active_case_count: 78, open_task_count: 22, nearest_due: null },
  { id: CURATOR_D, name: NAMES[CURATOR_D], active: false, active_case_count: 3, open_task_count: 4, nearest_due: { due_on: "2026-09-29", due_at: null } },
];

function coverage(selection = {}) {
  return {
    kind: "ready", curatorId: null, caseId: null, afterCaseId: null, explicit: false, ...selection,
    workspace: {
      organization_id: "eeeeeeee-4444-4444-8444-000000000000",
      curators: COVERAGE_CURATORS,
      cases: selection.curatorId ? [{ id: caseId(2), name: "Тимур Абдылдаев" }, { id: caseId(12), name: "Бакыт Орозбеков" }] : [],
      next_case_id: null,
      preview: selection.caseId ? {
        id: caseId(2), name: "Тимур Абдылдаев", owner_id: CURATOR_B, scope_version: "7", conflicts: [], coverage: null,
        tasks: [
          { id: "ffffffff-6666-4666-8666-000000000001", version: "3", title: "Подтвердить подачу в UCSI", status: "open", due_on: "2026-09-22", due_at: null, assignee_id: CURATOR_B, assignee_name: NAMES[CURATOR_B], tracked: true, required: true, can_transfer: true, return_assignee_id: null, return_assignee_name: null, conflict: null },
        ],
      } : null,
    },
  };
}

/** Сценарий: адрес страницы → разбор тем же `parseStudentsQueueParams`, чтения — синтетика. */
function scenario(search, { actor = "admin", docsMode = false, read, openTasks = null, coverageRead = null, invalid = false } = {}) {
  const query = Object.fromEntries(new URLSearchParams(search));
  const parse = view.parseStudentsQueueParams(query, docsMode ? "docs" : "queue", QUEUE_ACTOR[actor]);
  if (parse.kind === "redirect") throw new Error(`scenario ${search} redirects to ${parse.href}`);
  const params = parse.params;
  const countsView = view.studentsCountsView(params);
  const filters = { direction: params.direction, curator: params.curator, stage: params.stage };
  const input = {
    params,
    invalid: invalid || parse.kind === "invalid",
    read: read ?? {
      page: params.view === "curators" ? null : docsMode ? pageFor("active", "updated", filters) : pageFor(params.view, params.sort, filters),
      counts: countsFor(countsView, filters),
      forbidden: false,
    },
    actor: QUEUE_ACTOR[actor],
    openTasks,
    coverage: coverageRead,
    today: TODAY,
    curatorNames: actor === "admin" ? Object.entries(NAMES).map(([membershipId, displayName]) => ({ membershipId, displayName })) : [],
    editor: EDITOR[actor],
    recordScopes: [],
    createTask: actor !== "preview",
    requestIds: { nextStep: "99999999-6666-4666-8666-000000000001", coverage: "99999999-6666-4666-8666-000000000002" },
  };
  return { kind: "queue", search, docsMode, input, actor };
}

const SALES_DIRECTORY = {
  hasNext: false,
  nextCursor: null,
  rows: [
    { access: "sales_summary", admissionsDisplayName: NAMES[ME], leadId: "dddddddd-3333-4333-8333-000000000001", operationalStage: null, overdueObligationCount: null, overdueTaskCount: null, rejectedDocumentCount: null, responsibleSalesDisplayName: null, state: "active", studentCaseId: caseId(1), studentDisplayName: "Айдана Сыдыкова", targetCountry: "Китай", targetDegree: "Бакалавриат", updatedAt: "2026-09-22T10:00:00Z", attentionFlags: [] },
    { access: "sales_summary", admissionsDisplayName: NAMES[CURATOR_B], leadId: "dddddddd-3333-4333-8333-000000000002", operationalStage: null, overdueObligationCount: null, overdueTaskCount: null, rejectedDocumentCount: null, responsibleSalesDisplayName: null, state: "closed", studentCaseId: caseId(2), studentDisplayName: "Тимур Абдылдаев", targetCountry: "Малайзия", targetDegree: "Магистратура", updatedAt: "2026-09-20T10:00:00Z", attentionFlags: [] },
  ],
};

const OPEN_CASE = caseId(3);
const OTHER_CASE = caseId(5);
const SCENARIOS = {
  "admin-active": scenario("view=active"),
  "admin-default": scenario(""),
  "curator-mine": scenario("", { actor: "curator" }),
  "admin-panel": scenario(`view=active&open=${OPEN_CASE}`, { openTasks: TASKS }),
  "curator-panel-other": scenario(`view=active&open=${OTHER_CASE}`, { actor: "curator", openTasks: { kind: "unavailable" } }),
  "preview-panel": scenario(`open=${caseId(4)}`, { actor: "preview", openTasks: TASKS }),
  "panel-missing": scenario(`view=active&open=${caseId(99)}`, { openTasks: { kind: "unavailable" } }),
  "admin-filtered": scenario(`view=active&direction=CN&curator=${ME}&stage=documents`),
  "admin-updated": scenario("view=active&sort=updated"),
  "counts-unavailable": (() => {
    const base = scenario("view=active");
    return { ...base, input: { ...base.input, read: { ...base.input.read, counts: null } } };
  })(),
  "page-error": (() => {
    const base = scenario("view=active");
    return { ...base, input: { ...base.input, read: { page: null, counts: base.input.read.counts, forbidden: false } } };
  })(),
  "page-and-counts-error": (() => {
    const base = scenario("view=active");
    return { ...base, input: { ...base.input, read: { page: null, counts: null, forbidden: false } } };
  })(),
  forbidden: (() => {
    const base = scenario("view=active");
    return { ...base, input: { ...base.input, read: { page: null, counts: null, forbidden: true } } };
  })(),
  "manager-default": scenario("", { actor: "manager" }),
  "manager-curators": scenario("view=curators", { actor: "manager", coverageRead: coverage() }),
  // Синтетика закрытых дел: строки «в работе» со сроками всех групп, закрытые.
  closed: (() => {
    const base = scenario("view=closed");
    const rows = pageFor("active", "due").rows.map((row) => ({ ...row, state: "closed" }));
    return { ...base, input: { ...base.input, read: { ...base.input.read, page: { ...base.input.read.page, rows } } } };
  })(),
  "docs-no-access": (() => {
    const base = scenario("section=docs", { docsMode: true });
    const rows = base.input.read.page.rows.map((row) => ({ ...row, documents: null }));
    return { ...base, input: { ...base.input, read: { ...base.input.read, page: { ...base.input.read.page, rows } } } };
  })(),
  "docs-incomplete-empty": (() => {
    const base = scenario("section=docs", { docsMode: true });
    const rows = base.input.read.page.rows.filter((row) => !row.documents || row.documents.submitted === 0);
    return { ...base, input: { ...base.input, read: { ...base.input.read, page: { ...base.input.read.page, rows, nextCursor: rows.at(-1).cursor } } } };
  })(),
  "empty-mine": (() => {
    const base = scenario("", { actor: "curator" });
    return { ...base, input: { ...base.input, read: { page: { ...base.input.read.page, rows: [] }, counts: { ...base.input.read.counts, total: 0, views: { ...base.input.read.counts.views, mine: 0 }, bands: Object.fromEntries(BAND_ORDER.map((band) => [band, 0])) } } } };
  })(),
  invalid: scenario("view=active", { invalid: true }),
  "docs-review": scenario("section=docs", { docsMode: true }),
  "docs-all": scenario("section=docs&view=all", { docsMode: true }),
  "docs-fix": scenario("section=docs&view=fix", { docsMode: true }),
  "docs-incomplete": (() => {
    const base = scenario("section=docs", { docsMode: true });
    return { ...base, input: { ...base.input, read: { ...base.input.read, page: { ...base.input.read.page, nextCursor: base.input.read.page.rows.at(-1).cursor } } } };
  })(),
  curators: scenario(`view=curators&coverage_curator=${CURATOR_B}&coverage_case=${caseId(2)}`, { coverageRead: coverage({ curatorId: CURATOR_B, caseId: caseId(2), explicit: true }) }),
  "curators-plain": scenario("view=curators", { coverageRead: coverage() }),
  "curators-unavailable": scenario("view=curators", { coverageRead: { kind: "unavailable", curatorId: null, caseId: null, afterCaseId: null, explicit: false } }),
  sales: { kind: "sales", search: "", docsMode: false, directory: SALES_DIRECTORY, params: { active: false, cursor: null, invalid: false } },
};

// --- рендер ------------------------------------------------------------------
const routerStub = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {},
};

function withContexts(node, pathname, search) {
  const searchParams = new URLSearchParams(search);
  return createElement(
    AppRouterContext.Provider,
    { value: routerStub },
    createElement(
      PathnameContext.Provider,
      { value: pathname },
      createElement(
        SearchParamsContext.Provider,
        { value: searchParams },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node),
      ),
    ),
  );
}

function screen(name) {
  const item = SCENARIOS[name];
  if (item.kind === "sales") {
    return { count: null, content: createElement(StudentsDirectoryFallback, { directory: item.directory, params: item.params, docsMode: false }) };
  }
  return buildStudentsQueueScreen(item.input);
}

function renderWorkspace(name) {
  return renderToStaticMarkup(withContexts(screen(name).content, "/v3/profile", SCENARIOS[name].search));
}

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${pathToFileURL(join(dir, "files")).href}/`);
  });
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8")].join("\n");
}

const ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: "eeeeeeee-4444-4444-8444-000000000000",
  displayName: "Администратор (синтетический)", systemRole: "admin", platformAccessVersion: 1, assignments: [],
  permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
};
/** Сотрудник поступления для сценариев куратора: подвал оболочки называет ту же роль, что и экран. */
const CURATOR_ACTOR = {
  ...ACTOR,
  displayName: "Куратор (синтетический)", systemRole: "staff",
  assignments: [{ label: "Сотрудник поступления" }],
  permissionKeys: ["case.read.full", "profile.read.full", "case.route.manage", "document.read.full", "task.create", "staff.task.read", "staff.task.create", "team.chat.admissions"],
};

/** Контейнер тела: браузерная сборка отрисовывает в нём тот же экран заново. */
const CLIENT_ROOT_ID = "students-client-root";
const FIXTURE_ID = "students-client-fixture";

function renderPage(name) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const item = SCENARIOS[name];
  const built = screen(name);
  const action = item.docsMode
    ? createElement("a", { href: "/v3/universities", className: "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg" }, "Университеты и бланки")
    : undefined;
  const page = createElement(
    "div",
    { className: "v3-world" },
    createElement(
      AppShell,
      { actor: item.actor === "curator" ? CURATOR_ACTOR : ACTOR, initialNotifications: null },
      createElement(PartShell, { title: item.docsMode ? "EVO Docs" : "Студенты", count: built.count, action, dense: item.kind !== "sales" },
        createElement("div", { id: CLIENT_ROOT_ID }, built.content)),
    ),
  );
  return renderToStaticMarkup(withContexts(page, "/v3/profile", item.search));
}

function clientFixture(name) {
  return JSON.stringify({ name, item: SCENARIOS[name] }).replaceAll("<", "\\u003c");
}

// --- браузерная сборка тела ---------------------------------------------------
const CLIENT_ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { buildStudentsQueueScreen } from "../../src/components/v3/students/StudentsQueueScreen";
import { StudentsDirectoryFallback } from "../../src/components/v3/students/StudentsDirectoryFallback";

const fixture = JSON.parse(document.getElementById("${FIXTURE_ID}").textContent);
const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const item = fixture.item;
const content = item.kind === "sales"
  ? createElement(StudentsDirectoryFallback, { directory: item.directory, params: item.params, docsMode: false })
  : buildStudentsQueueScreen(item.input).content;
createRoot(document.getElementById("${CLIENT_ROOT_ID}")).render(
  createElement(AppRouterContext.Provider, { value: router },
    createElement(PathnameContext.Provider, { value: "/v3/profile" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(item.search) }, content))),
);
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.clientRendered = "1"; }));
`;

/**
 * Серверные действия и server-only в браузере не нужны. Заглушка действия
 * «Следующего шага» отвечает конфликтом версии (текст — из того же
 * wording.ts): снимок показывает честную ошибку и ничего не сохраняет.
 */
const browserStubs = {
  name: "students-static-render-stubs",
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    build.onLoad({ filter: /\.module\.css$/ }, () => ({
      contents: "export default new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : undefined) });",
      loader: "js",
    }));
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
    build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
      if (args.path.endsWith("platform-case-next-action-actions.ts")) {
        return {
          contents: `import { caseNextActionOutcome } from ${JSON.stringify(join(ROOT, "src/lib/v3/wording.ts"))};
export async function saveCaseNextActionAction(previous) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { status: "stale", requestId: previous.requestId, message: caseNextActionOutcome("stale"), receipt: null };
}`,
          loader: "ts",
        };
      }
      const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
      return {
        contents: names.map((name) => `export async function ${name}() { throw new Error("static render: server action ${name} is not available"); }`).join("\n"),
        loader: "ts",
      };
    });
  },
};

async function buildClientBundle(outFile) {
  const esbuild = require("esbuild");
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: __dirname, sourcefile: "students-client-entry.js", loader: "js" },
    bundle: true,
    outfile: outFile,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "var process = globalThis.process || { env: {} };" },
    plugins: [browserStubs],
    logLevel: "error",
  });
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const bundleName = "students-client.js";
  await buildClientBundle(join(outDir, bundleName));
  const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
  const WIDE = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
  const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  // [сценарий, [снимок, контекст, во весь рост, действие]]
  const pages = [
    ["admin-active", [
      ["students-1440.png", DESKTOP, false, null],
      ["students-1440-full.png", DESKTOP, true, null],
      ["students-1280.png", LAPTOP, false, null],
      ["students-1920.png", WIDE, false, null],
      ["students-390.png", PHONE, false, null],
      ["students-390-full.png", PHONE, true, null],
      ["students-390-filters.png", PHONE, false, "filters"],
      ["students-direction-menu-1440.png", DESKTOP, false, "direction"],
    ]],
    ["admin-default", [["students-admin-default-1440.png", DESKTOP, false, null]]],
    ["curator-mine", [
      ["students-curator-mine-1440.png", DESKTOP, false, null],
      ["students-curator-mine-1280.png", LAPTOP, false, null],
      ["students-focus-1440.png", DESKTOP, false, "focus"],
    ]],
    ["admin-panel", [
      ["students-panel-1440.png", DESKTOP, false, null],
      ["students-panel-1280.png", LAPTOP, false, null],
      ["students-panel-1920.png", WIDE, false, null],
      ["students-panel-390.png", PHONE, false, null],
      ["students-panel-validation-1440.png", DESKTOP, false, "validation"],
      ["students-panel-conflict-1440.png", DESKTOP, false, "conflict"],
      ["students-panel-conflict-390.png", PHONE, false, "conflict"],
      ["students-panel-date-1440.png", DESKTOP, false, "date"],
    ]],
    ["preview-panel", [["students-panel-readonly-1440.png", DESKTOP, false, null]]],
    ["admin-updated", [["students-sort-updated-1440.png", DESKTOP, false, null]]],
    ["counts-unavailable", [["students-counts-unavailable-1440.png", DESKTOP, false, null]]],
    ["page-error", [["students-error-1440.png", DESKTOP, false, null]]],
    ["empty-mine", [["students-empty-mine-1440.png", DESKTOP, false, null]]],
    ["curators", [
      ["students-curators-1440.png", DESKTOP, false, null],
      ["students-curators-390.png", PHONE, false, null],
    ]],
    ["curators-plain", [["students-curators-plain-1440.png", DESKTOP, false, null]]],
    ["docs-review", [
      ["students-docs-1440.png", DESKTOP, false, null],
      ["students-docs-390.png", PHONE, false, null],
      ["students-docs-menu-1440.png", DESKTOP, false, "docs-menu"],
    ]],
    ["docs-fix", [["students-docs-fix-1440.png", DESKTOP, false, null]]],
    ["docs-incomplete", [["students-docs-incomplete-1440.png", DESKTOP, false, null]]],
    ["sales", [["students-sales-1440.png", DESKTOP, false, null]]],
    // Исправления по независимому review #1056.
    ["forbidden", [
      ["students-forbidden-1440.png", DESKTOP, false, null],
      ["students-forbidden-390.png", PHONE, false, null],
    ]],
    ["page-and-counts-error", [["students-page-and-counts-error-1440.png", DESKTOP, false, null]]],
    ["manager-default", [["students-manager-default-1440.png", DESKTOP, false, null]]],
    ["manager-curators", [["students-manager-curators-1440.png", DESKTOP, false, null]]],
    ["closed", [["students-closed-1440.png", DESKTOP, false, null]]],
    ["docs-no-access", [["students-docs-no-access-1440.png", DESKTOP, false, null]]],
    ["docs-incomplete-empty", [
      ["students-docs-incomplete-empty-1440.png", DESKTOP, false, null],
      ["students-docs-incomplete-empty-390.png", PHONE, false, null],
    ]],
  ];
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const [name, shots] of pages) {
      const htmlPath = join(outDir, `students-${name}.html`);
      writeFileSync(htmlPath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${SCENARIOS[name].docsMode ? "EVO Docs" : "Студенты"} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        `<body class="min-h-full">${renderPage(name)}<script type="application/json" id="${FIXTURE_ID}">${clientFixture(name)}</script><script src="${bundleName}"></script></body></html>`,
      ].join(""));
      for (const [file, context, fullPage, step] of shots) {
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector("html[data-client-rendered]", { state: "attached", timeout: 10_000 });
        const editor = '[data-testid="v3-next-step-editor"]';
        if (step === "filters") await page.click('[data-testid="queue-toolbar"] button[aria-controls]');
        if (step === "direction") await page.click('[data-testid="queue-toolbar"] button:has-text("Направление")');
        if (step === "docs-menu") await page.click('[data-queue-row] button[aria-label^="Ещё по документам"]');
        if (step === "validation") {
          // Пустой шаг со сроком «Сегодня»: честная ошибка до отправки.
          await page.fill(`${editor} textarea`, "");
          await page.click(`${editor} button[type="submit"]`);
        }
        if (step === "conflict") {
          // Правка шага → «Сохранить» → заглушка отвечает конфликтом версии.
          await page.fill(`${editor} textarea`, "Отправить семье сравнение программ Праги и Варшавы");
          await page.click(`${editor} button:has-text("Завтра")`);
          await page.click(`${editor} button[type="submit"]`);
          await page.waitForSelector(`${editor} [role="alert"]`);
        }
        if (step === "date") await page.click(`${editor} button:has-text("Дата…")`);
        // Клавиатура: ↓ со страницы переводит фокус на первую строку — видна рамка фокуса.
        if (step === "focus") { await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); }
        if (step) await page.waitForTimeout(400);
        if (errors.length) throw new Error(`${file}: browser errors:\n${errors.join("\n")}`);
        const metrics = await page.evaluate(() => {
          const rows = [...document.querySelectorAll("[data-queue-row]")];
          const panel = document.querySelector('[data-testid="queue-detail-panel"]');
          const head = document.querySelector('[data-testid="v3-students-queue-head"]');
          const strip = document.querySelector('[data-testid="queue-view-tabs"]');
          const current = strip?.querySelector('[aria-current="page"]');
          const toolbar = document.querySelector('[data-testid="queue-toolbar"]');
          const chips = [...document.querySelectorAll('[data-testid="v3-next-step-editor"] fieldset button')].map((chip) => Math.round(chip.getBoundingClientRect().top));
          const stripBox = strip?.getBoundingClientRect();
          const currentBox = current?.getBoundingClientRect();
          return {
            headBottom: head ? Math.round(head.getBoundingClientRect().bottom + window.scrollY) : null,
            toolbarHeight: toolbar ? Math.round(toolbar.getBoundingClientRect().height) : null,
            tabsScroll: strip ? strip.scrollWidth > strip.clientWidth : null,
            activeTabVisible: stripBox && currentBox ? currentBox.left >= stripBox.left - 1 && currentBox.right <= stripBox.right + 1 : null,
            firstRowTop: rows[0] ? Math.round(rows[0].getBoundingClientRect().top + window.scrollY) : null,
            chipRows: chips.length ? new Set(chips).size : null,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            rowsInViewport: rows.filter((row) => {
              const box = row.getBoundingClientRect();
              return box.bottom <= window.innerHeight && box.top >= 0 && box.height > 0;
            }).length,
            rowHeight: Math.round(rows[0]?.getBoundingClientRect().height ?? 0),
            panelModal: panel ? panel.matches(":modal") : null,
            solidRed: [...document.querySelectorAll("a, button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)"
              && element.getBoundingClientRect().width > 0).length,
            smallTargets: [...document.querySelectorAll("main a, main button")].filter((element) => {
              const box = element.getBoundingClientRect();
              return box.width > 0 && box.height > 0 && box.height < 24;
            }).length,
          };
        });
        await page.screenshot({ path: join(outDir, file), fullPage });
        const facts = Object.entries(metrics).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join(" ");
        process.stdout.write(`${file}: ${name} ${facts}\n`);
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }
}

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(Object.keys(SCENARIOS).map((name) => ({ name, html: renderWorkspace(name) }))));
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: students-static-render.cjs --json | --screenshots [outDir]");
  process.exit(2);
}
