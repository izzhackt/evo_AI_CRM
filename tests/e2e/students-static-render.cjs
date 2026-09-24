"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в portal-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер «Студентов» (фасеты и таблица, 24.09.2026).
 *
 * Рендерит НАСТОЯЩЕЕ дерево компонентов (StudentsWorkspace, StudentCaseTable,
 * CuratorCoveragePanel, CuratorCoverageForm; для снимков — ещё AppShell и
 * PartShell) с СИНТЕТИЧЕСКИМИ данными: имена, числа и дела выдуманы для
 * проверки вёрстки и не являются записями EVO. Живой Supabase, права и
 * данные этот рендер не проверяет.
 *
 *   node tests/e2e/students-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — разметка сценариев без оболочки
 *       (для tests/v3-students-facets.test.mjs).
 *   node tests/e2e/students-static-render.cjs --screenshots [outDir]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900 и 390×844 во весь рост (плюс 1280×800, фильтры и EVO Docs).
 *       По умолчанию outDir — .impeccable/review (не коммитится).
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

const { StudentsWorkspace } = require(join(ROOT, "src/components/v3/profile/StudentsWorkspace.tsx"));

// --- синтетические данные ---------------------------------------------------
const TODAY = "2026-09-24";
const CURATOR_A = "aaaaaaaa-1111-4111-8111-000000000001";
const CURATOR_B = "aaaaaaaa-1111-4111-8111-000000000002";
const CURATOR_C = "aaaaaaaa-1111-4111-8111-000000000003";
const CURATOR_D = "aaaaaaaa-1111-4111-8111-000000000004";
const caseId = (n) => `cccccccc-2222-4222-8222-${String(n).padStart(12, "0")}`;

function fullRow(n, fields) {
  return {
    access: "full",
    admissionsDisplayName: null,
    leadId: null,
    operationalStage: null,
    overdueObligationCount: 0,
    overdueTaskCount: 0,
    rejectedDocumentCount: 0,
    responsibleSalesDisplayName: null,
    state: "active",
    studentCaseId: caseId(n),
    studentDisplayName: "",
    targetCountry: null,
    targetDegree: null,
    updatedAt: "2026-09-23T10:00:00Z",
    admissionsDirection: null,
    nextAction: null,
    nextActionDueOn: null,
    attentionFlags: [],
    ...fields,
  };
}

const ROWS = [
  fullRow(1, { studentDisplayName: "Айдана Сыдыкова", admissionsDirection: "CN", targetDegree: "Бакалавриат", operationalStage: "documents", nextAction: "Собрать апостиль на аттестат", nextActionDueOn: "2026-09-27", admissionsDisplayName: "Айгүл Осмонова", responsibleSalesDisplayName: "Бекзат Абдыкалыков" }),
  fullRow(2, { studentDisplayName: "Тимур Абдылдаев", admissionsDirection: "MY", targetDegree: "Магистратура", operationalStage: "applications", nextAction: "Подтвердить подачу в UCSI", nextActionDueOn: "2026-09-20", overdueTaskCount: 2, attentionFlags: ["overdue"], admissionsDisplayName: "Айгүл Осмонова", responsibleSalesDisplayName: "Бекзат Абдыкалыков" }),
  fullRow(3, { studentDisplayName: "Нурсултан Бекмурзаевич Джумабаев-Осмоналиев", admissionsDirection: "EUROPE", targetDegree: "Бакалавриат", operationalStage: "profile_and_route", nextAction: "Согласовать с семьёй список программ в Польше и Чехии", nextActionDueOn: "2026-10-03", attentionFlags: ["awaiting_ack"], admissionsDisplayName: "Эрмек Токтосунов", responsibleSalesDisplayName: "Алтынай Мамбетова" }),
  fullRow(4, { studentDisplayName: "Элиза Каримова", admissionsDirection: "AE", targetDegree: "Foundation", state: "pending", attentionFlags: ["needs_curator"], responsibleSalesDisplayName: "Алтынай Мамбетова" }),
  fullRow(5, { studentDisplayName: "Азамат Исаков", admissionsDirection: "TR", targetDegree: "Бакалавриат", operationalStage: "decisions", nextAction: "Дождаться решения Bilkent", nextActionDueOn: "2026-10-15", overdueObligationCount: 1, attentionFlags: ["overdue"], admissionsDisplayName: "Эрмек Токтосунов" }),
  fullRow(6, { studentDisplayName: "Мээрим Жолдошева", admissionsDirection: "CN", targetDegree: "Магистратура", operationalStage: "visa_and_predeparture", nextAction: "Записать на визу X1", nextActionDueOn: TODAY, rejectedDocumentCount: 1, admissionsDisplayName: "Айгүл Осмонова" }),
  fullRow(7, { studentDisplayName: "Данияр Мамытов", operationalStage: "intake", nextAction: "Первичная консультация с семьёй", admissionsDisplayName: "Гульнара Асанова" }),
  fullRow(8, { studentDisplayName: "Алина Ким", admissionsDirection: "MY", targetDegree: "Бакалавриат", state: "closed", operationalStage: "completed", admissionsDisplayName: "Гульнара Асанова" }),
  {
    access: "sales_summary", admissionsDisplayName: "Айгүл Осмонова", leadId: "dddddddd-3333-4333-8333-000000000009",
    operationalStage: null, overdueObligationCount: null, overdueTaskCount: null, rejectedDocumentCount: null,
    responsibleSalesDisplayName: null, state: "active", studentCaseId: caseId(9), studentDisplayName: "Бакыт Орозбеков",
    targetCountry: "Китай", targetDegree: "Бакалавриат", updatedAt: "2026-09-22T10:00:00Z", attentionFlags: [],
  },
  fullRow(10, { studentDisplayName: "Санжар Алиев", admissionsDirection: "CN", targetDegree: "Языковые курсы", operationalStage: "documents", nextAction: "Перевести паспорт и заверить у нотариуса", nextActionDueOn: "2026-09-22", overdueTaskCount: 1, rejectedDocumentCount: 2, attentionFlags: ["overdue"], admissionsDisplayName: "Гульнара Асанова", responsibleSalesDisplayName: "Бекзат Абдыкалыков" }),
  fullRow(11, { studentDisplayName: "Камила Усенова", admissionsDirection: "EUROPE", targetDegree: "Магистратура", operationalStage: "applications", nextAction: "Отправить пакет партнёру", nextActionDueOn: "2026-09-30", attentionFlags: ["awaiting_ack"], admissionsDisplayName: "Эрмек Токтосунов" }),
  fullRow(12, { studentDisplayName: "Руслан Турдубаев", admissionsDirection: "AE", targetDegree: "Бакалавриат", operationalStage: "arrival_and_adaptation", nextAction: "Встретить в аэропорту Дубая", nextActionDueOn: "2026-10-02", admissionsDisplayName: "Гульнара Асанова" }),
];

const SUMMARY = {
  stock: [
    { direction: "AE", active: 22, overdue: 1, awaiting_ack: 0, needs_curator: 1 },
    { direction: "CN", active: 118, overdue: 9, awaiting_ack: 2, needs_curator: 1 },
    { direction: "EUROPE", active: 41, overdue: 3, awaiting_ack: 2, needs_curator: 0 },
    { direction: "MY", active: 74, overdue: 6, awaiting_ack: 1, needs_curator: 0 },
    { direction: "TR", active: 17, overdue: 2, awaiting_ack: 0, needs_curator: 0 },
    { direction: "unknown", active: 6, overdue: 0, awaiting_ack: 0, needs_curator: 0 },
  ],
};

const CURATOR_OPTIONS = [
  { membershipId: CURATOR_A, displayName: "Айгүл Осмонова" },
  { membershipId: CURATOR_B, displayName: "Эрмек Токтосунов" },
  { membershipId: CURATOR_C, displayName: "Гульнара Асанова" },
];

const COVERAGE_CURATORS = [
  { id: CURATOR_A, name: "Айгүл Осмонова", active: true, active_case_count: 104, open_task_count: 37, nearest_due: { due_on: "2026-09-25", due_at: null } },
  { id: CURATOR_B, name: "Эрмек Токтосунов", active: true, active_case_count: 96, open_task_count: 29, nearest_due: { due_on: "2026-09-26", due_at: null } },
  { id: CURATOR_C, name: "Гульнара Асанова", active: true, active_case_count: 78, open_task_count: 22, nearest_due: null },
  { id: CURATOR_D, name: "Жибек Саматова", active: false, active_case_count: 3, open_task_count: 4, nearest_due: { due_on: "2026-09-29", due_at: null } },
];

function params(patch = {}) {
  const base = { active: false, cursor: null, invalid: false };
  const next = { ...base, ...patch };
  next.active = ["query", "state", "direction", "curatorMembershipId", "attention"].some((key) => next[key] !== undefined) || next.cursor !== null;
  return next;
}

const directory = (rows, hasNext = true) => ({
  hasNext,
  nextCursor: hasNext ? { sortAt: "2026-09-20T10:00:00.000Z", id: caseId(99) } : null,
  rows,
});

const readyCoverage = (selection = {}) => ({
  kind: "ready",
  curatorId: null,
  caseId: null,
  afterCaseId: null,
  explicit: false,
  ...selection,
  workspace: {
    organization_id: "eeeeeeee-4444-4444-8444-000000000000",
    curators: COVERAGE_CURATORS,
    cases: selection.curatorId ? [{ id: caseId(2), name: "Тимур Абдылдаев" }, { id: caseId(6), name: "Мээрим Жолдошева" }, { id: caseId(1), name: "Айдана Сыдыкова" }] : [],
    next_case_id: null,
    preview: selection.caseId ? {
      id: caseId(2), name: "Тимур Абдылдаев", owner_id: CURATOR_A, scope_version: "7", conflicts: [], coverage: null,
      tasks: [
        { id: "ffffffff-5555-4555-8555-000000000001", version: "3", title: "Подтвердить подачу в UCSI", status: "open", due_on: "2026-09-20", due_at: null, assignee_id: CURATOR_A, assignee_name: "Айгүл Осмонова", tracked: true, required: true, can_transfer: true, return_assignee_id: null, return_assignee_name: null, conflict: null },
        { id: "ffffffff-5555-4555-8555-000000000002", version: "1", title: "Проверить перевод диплома", status: "in_progress", due_on: "2026-09-28", due_at: null, assignee_id: CURATOR_A, assignee_name: "Айгүл Осмонова", tracked: true, required: false, can_transfer: true, return_assignee_id: null, return_assignee_name: null, conflict: null },
      ],
    } : null,
  },
});

const base = {
  directory: directory(ROWS),
  params: params(),
  docsMode: false,
  allowAdmissionsFilters: true,
  summary: SUMMARY,
  curators: CURATOR_OPTIONS,
  coverage: readyCoverage(),
  today: TODAY,
  coverageRequestId: "99999999-6666-4666-8666-000000000001",
};

const filteredRows = ROWS.filter((row) => row.admissionsDirection === "CN" && row.admissionsDisplayName === "Айгүл Осмонова");
const SCENARIOS = {
  "admin-default": { ...base },
  "admin-filtered": {
    ...base,
    directory: directory(filteredRows, false),
    params: params({ direction: "CN", curatorMembershipId: CURATOR_A, state: "active" }),
    coverage: readyCoverage({ curatorId: CURATOR_A, caseId: caseId(2), explicit: true }),
  },
  "summary-unavailable": { ...base, summary: "unavailable", coverage: { kind: "unavailable", curatorId: null, caseId: null, afterCaseId: null, explicit: false } },
  "curator-role": { ...base, curators: [], coverage: { kind: "hidden" }, params: params({ attention: "overdue" }) },
  sales: {
    ...base,
    directory: directory(ROWS.filter((row) => row.access === "sales_summary").concat(ROWS.slice(0, 2).map((row) => ({
      ...row, access: "sales_summary", operationalStage: null, overdueObligationCount: null, overdueTaskCount: null,
      rejectedDocumentCount: null, responsibleSalesDisplayName: null, attentionFlags: [], admissionsDirection: undefined,
      nextAction: undefined, nextActionDueOn: undefined, targetCountry: row.admissionsDirection === "CN" ? "Китай" : "Малайзия",
      leadId: `dddddddd-3333-4333-8333-00000000000${row.studentCaseId.slice(-1)}`,
    }))), false),
    allowAdmissionsFilters: false,
    summary: null,
    curators: [],
    coverage: { kind: "hidden" },
  },
  docs: { ...base, docsMode: true, summary: null, coverage: { kind: "hidden" } },
  invalid: { ...base, directory: directory([], false), params: { active: true, cursor: null, invalid: true }, summary: null },
  empty: { ...base, directory: directory([], false), params: params({ query: "Несуществующее имя" }) },
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

function renderWorkspace(name) {
  return renderToStaticMarkup(withContexts(createElement(StudentsWorkspace, SCENARIOS[name]), "/v3/profile", ""));
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

function renderPage(name, search) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const scenario = SCENARIOS[name];
  const actor = {
    authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
    membershipId: "bbbbbbbb-7777-4777-8777-000000000003", organizationId: "eeeeeeee-4444-4444-8444-000000000000",
    displayName: "Администратор (синтетический)", systemRole: "admin", platformAccessVersion: 1, assignments: [],
    permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
  };
  const page = createElement(
    "div",
    { className: "v3-world" },
    createElement(
      AppShell,
      { actor, initialNotifications: null },
      createElement(PartShell, { title: scenario.docsMode ? "EVO Docs" : "Студенты" }, createElement(StudentsWorkspace, scenario)),
    ),
  );
  return renderToStaticMarkup(withContexts(page, "/v3/profile", search));
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const css = await compileCss();
  const pages = [
    ["admin-default", "", [["desktop.png", "desktop"], ["mobile.png", "mobile"], ["mobile-filters-open.png", "mobile-open"], ["desktop-1280.png", "desktop-1280"]]],
    ["admin-filtered", `direction=CN&curator=${CURATOR_A}&case_status=active&coverage_curator=${CURATOR_A}&coverage_case=${caseId(2)}`, [["desktop-filtered.png", "desktop"], ["mobile-filtered.png", "mobile"]]],
    ["docs", "section=docs", [["desktop-docs.png", "desktop"]]],
  ];
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const [name, search, shots] of pages) {
      const htmlPath = join(outDir, `students-${name}.html`);
      writeFileSync(htmlPath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${SCENARIOS[name].docsMode ? "EVO Docs" : "Студенты"} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        `<body class="min-h-full">${renderPage(name, search)}</body></html>`,
      ].join(""));
      for (const [file, mode] of shots) {
        const context = await browser.newContext(mode.startsWith("mobile")
          ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
          : { viewport: mode === "desktop-1280" ? { width: 1280, height: 800 } : { width: 1440, height: 900 }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        if (mode === "mobile-open") {
          // Нет гидрации в статическом HTML: повторяем то, что рисует
          // StudentsFacetDisclosure при open=true (aria-expanded и класс).
          await page.evaluate(() => {
            const button = document.querySelector('aside button[aria-controls]');
            button.setAttribute("aria-expanded", "true");
            const content = document.getElementById(button.getAttribute("aria-controls"));
            content.className = "mt-4";
          });
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        await page.screenshot({ path: join(outDir, file), fullPage: true });
        process.stdout.write(`${file}: ${name} ${mode} horizontal-overflow=${overflow}px\n`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
