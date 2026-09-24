"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в students-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер досок «Воронка продаж» и «Воронка поступления»
 * (решение владельца 25.09.2026: на всю ширину, без прокрутки вбок).
 *
 * Рендерит НАСТОЯЩИЕ страницы `src/app/(v3)/v3/pipeline/page.tsx` и
 * `src/app/(v3)/v3/admissions-pipeline/page.tsx` внутри настоящих AppShell и
 * PartShell. Подменены только границы данных и прав (чтения Supabase,
 * серверные действия, проверка сотрудника): вместо них — СИНТЕТИЧЕСКИЕ
 * данные. Имена, числа и дела выдуманы для проверки вёрстки и не являются
 * записями EVO. Живой Supabase, права и данные этот рендер не проверяет, а
 * статическая разметка не гидратируется: открытое меню в снимке открывается
 * `showPopover()` и ставится той же `placeMenu`, что и в браузере.
 *
 *   node tests/e2e/boards-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — страницы в оболочке (для
 *       tests/v3-boards.test.mjs).
 *   node tests/e2e/boards-static-render.cjs --screenshots [outDir]
 *     → HTML с CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке), снимки Playwright Chromium
 *       1280×800, 1440×900, 1920×1080 и 390×844, открытая панель лида и
 *       открытое меню дела, плюс измерения в stdout (JSON-строки).
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

// --- синтетические данные ---------------------------------------------------
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: "bbbbbbbb-7777-4777-8777-000000000003", organizationId: ORG,
  displayName: "Администратор (синтетический)", systemRole: "admin", platformAccessVersion: 1, assignments: [],
  permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
};
const OWNER_A = "aaaaaaaa-1111-4111-8111-000000000001";
const OWNER_B = "aaaaaaaa-1111-4111-8111-000000000002";
const OWNERS = [
  { membershipId: OWNER_A, displayLabel: "Менеджер Первый" },
  { membershipId: OWNER_B, displayLabel: "Менеджер Второй" },
];
const leadId = (n) => `dddddddd-3333-4333-8333-${String(n).padStart(12, "0")}`;
const caseId = (n) => `cccccccc-2222-4222-8222-${String(n).padStart(12, "0")}`;

// Даты считаются от сегодняшнего дня в Бишкеке, как на сервере.
const DAY = 86_400_000;
const bishkekDate = (offsetDays) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(Date.now() + offsetDays * DAY));
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

function lead(n, fields) {
  const { owner = OWNER_A, ...rest } = fields;
  const ownerRow = OWNERS.find((row) => row.membershipId === owner);
  return {
    organizationId: ORG, leadId: leadId(n), clientId: null, clientDisplayName: null, clientEmail: null, clientPhone: null,
    currentOwnerMembershipId: ownerRow ? owner : null, currentOwnerDisplayName: ownerRow?.displayLabel ?? null,
    stageKey: "new", sourceKey: "website", lifecycleState: "open", nextActionText: null, nextActionDueDate: null,
    workflowVersion: "3", isConnected: false, openDuplicateCandidateCount: 0, linkedStudentCaseCount: 0,
    linkedConversationCount: 0, createdAt: ago(20), updatedAt: ago(1), stageEnteredAt: ago(2), latestNote: null,
    ...rest,
  };
}

const SALES_ROWS = [
  lead(1, { clientDisplayName: "Айжан Примерова", stageKey: "new", nextActionText: "Позвонить и уточнить страну", nextActionDueDate: bishkekDate(-2), stageEnteredAt: ago(4) }),
  lead(2, { clientDisplayName: "Тимур Образцов", stageKey: "new", nextActionText: "Отправить подборку программ", nextActionDueDate: bishkekDate(0), stageEnteredAt: ago(1), owner: OWNER_B }),
  lead(3, { clientDisplayName: "Абитуриент с очень длинным двойным именем Нурсултан-Бекмурза Тестов", stageKey: "new", stageEnteredAt: ago(0), owner: null }),
  lead(4, { clientEmail: "parent@example.invalid", stageKey: "contacting", nextActionText: "Написать в WhatsApp после 18:00", nextActionDueDate: bishkekDate(3), stageEnteredAt: ago(6) }),
  lead(5, { clientDisplayName: "Элина Демо", stageKey: "contacting", nextActionText: "Повторный звонок родителям", nextActionDueDate: bishkekDate(-5), stageEnteredAt: ago(12), owner: OWNER_B,
    latestNote: { id: "ffffffff-5555-4555-8555-000000000001", body: "Родители просят сравнить Малайзию и Китай по стоимости. Перезвонить после консультации.", authorDisplayName: "Менеджер Второй", createdAt: ago(1) } }),
  lead(6, { clientDisplayName: "Бекзат Тестов", stageKey: "qualified", nextActionText: "Подготовить договор", nextActionDueDate: bishkekDate(1), stageEnteredAt: ago(3) }),
  lead(7, { clientDisplayName: "Айгерим Условная", stageKey: "qualified", nextActionText: "Дождаться первой оплаты", nextActionDueDate: bishkekDate(0), stageEnteredAt: ago(9) }),
  lead(8, { clientDisplayName: "Данияр Макетов", stageKey: "meeting_scheduled", nextActionText: "Встреча в офисе, взять аттестат", nextActionDueDate: bishkekDate(2), stageEnteredAt: ago(2), owner: OWNER_B }),
  lead(9, { clientDisplayName: "Камила Черновик", stageKey: "meeting_completed", nextActionText: "Отправить итоги встречи", nextActionDueDate: bishkekDate(-1), stageEnteredAt: ago(5) }),
  lead(10, { clientPhone: "+996 000 000 010", stageKey: "meeting_completed", stageEnteredAt: ago(15), owner: null }),
  lead(11, { clientDisplayName: "Руслан Прототипов", stageKey: "potential", nextActionText: "Согласовать дату подписания договора с семьёй", nextActionDueDate: bishkekDate(7), stageEnteredAt: ago(21) }),
  lead(12, { clientDisplayName: "Санжар Эскизов", stageKey: "potential", nextActionText: "Прислать реквизиты для оплаты", nextActionDueDate: bishkekDate(0), stageEnteredAt: ago(8), owner: OWNER_B }),
  // Переданные (производная колонка по доказательству передачи).
  lead(13, { clientDisplayName: "Алина Переданная", stageKey: "qualified", stageEnteredAt: ago(30) }),
  lead(14, { clientDisplayName: "Мээрим Выпускница", stageKey: "qualified", nextActionText: "Передать куратору пакет", nextActionDueDate: bishkekDate(-3), stageEnteredAt: ago(40), owner: OWNER_B }),
];
const HANDED = new Set([leadId(13), leadId(14)]);

const CURATOR_A = "aaaaaaaa-1111-4111-8111-000000000011";
const CURATOR_B = "aaaaaaaa-1111-4111-8111-000000000012";
function row(n, fields) {
  return {
    studentCaseId: caseId(n), studentDisplayName: "", targetCountry: null, primaryInstitutionName: null,
    currentCuratorMembershipId: CURATOR_A, currentCuratorDisplayName: "Куратор Один", pipelineStage: "new",
    awaitingAck: false, overdue: false, needsReply: false, ...fields,
  };
}
const CURATOR_TWO = { currentCuratorMembershipId: CURATOR_B, currentCuratorDisplayName: "Куратор Два" };
const ADMISSIONS_ROWS = [
  row(1, { studentDisplayName: "Айжан Примерова", targetCountry: "CN", primaryInstitutionName: "Пекинский университет языка и культуры", pipelineStage: "new", awaitingAck: true }),
  row(2, { studentDisplayName: "Тимур Образцов", targetCountry: "MY", pipelineStage: "new", ...CURATOR_TWO }),
  row(3, { studentDisplayName: "Нурсултан-Бекмурза Тестов с длинным именем", targetCountry: "CN", primaryInstitutionName: "Шанхайский университет", pipelineStage: "shortlist", overdue: true }),
  row(4, { studentDisplayName: "Элина Демо", targetCountry: "AE", pipelineStage: "documents", needsReply: true, ...CURATOR_TWO }),
  row(5, { studentDisplayName: "Бекзат Тестов", targetCountry: "TR", primaryInstitutionName: "Bilkent University", pipelineStage: "documents" }),
  row(6, { studentDisplayName: "Айгерим Условная", targetCountry: "MY", primaryInstitutionName: "UCSI University", pipelineStage: "ready_to_submit", overdue: true, needsReply: true }),
  row(7, { studentDisplayName: "Данияр Макетов", targetCountry: "CN", pipelineStage: "awaiting_decision" }),
  row(8, { studentDisplayName: "Камила Черновик", targetCountry: "CN", primaryInstitutionName: "Уханьский университет", pipelineStage: "confirmed", ...CURATOR_TWO }),
  row(9, { studentDisplayName: "Руслан Прототипов", targetCountry: "MY", pipelineStage: "visa", overdue: true }),
  row(10, { studentDisplayName: "Санжар Эскизов", targetCountry: "CN", pipelineStage: "visa", awaitingAck: true }),
  row(11, { studentDisplayName: "Мээрим Выпускница", targetCountry: "AE", pipelineStage: "predeparture" }),
  row(12, { studentDisplayName: "Алина Переданная", targetCountry: "TR", pipelineStage: "arrived", ...CURATOR_TWO }),
];

const queueItems = (count) => Array.from({ length: count }, (_, index) => ({ id: `q-${index}` }));

// --- подмена границ данных и прав --------------------------------------------
const STUBS = {
  "@/lib/platform-guards": {
    requireV3PageActor: async () => ACTOR,
    requirePlatformStaffActor: async () => ACTOR,
  },
  "@/lib/platform-sales": {
    // Поиск RPC здесь — подстрока по имени, контакту и действию: достаточно,
    // чтобы показать доску с пустыми этапами.
    listPlatformSalesLeads: async (actor, options = {}) => ({
      rows: options.query
        ? SALES_ROWS.filter((row) => [row.clientDisplayName, row.clientEmail, row.clientPhone, row.nextActionText]
          .some((value) => value?.toLocaleLowerCase("ru-RU").includes(options.query.toLocaleLowerCase("ru-RU"))))
        : SALES_ROWS,
      hasNext: false,
      nextCursor: null,
    }),
    listPlatformSalesOwnerOptions: async () => ({ rows: OWNERS, hasNext: false, nextCursor: null }),
    // Та же форма, что у настоящего координатора: чтение доски и сотрудников.
    readPlatformSalesPipeline: async (actor, readers) => ({
      board: await readers.board(actor), ownerOptions: await readers.owners(actor), canCreateLead: true,
    }),
  },
  "@/lib/v3/sales-handoff-source": { readCompletedSalesHandoffs: async () => HANDED },
  "@/lib/platform-sales-actions": { updatePlatformSalesWorkflowAction: async (state) => state },
  "@/lib/platform-manual-lead-actions": { createManualLeadAction: async (state) => state },
  "@/lib/platform-admissions-pipeline": {
    readAdmissionsPipelineBoard: async () => ({ rows: ADMISSIONS_ROWS, truncated: false }),
  },
  "@/lib/platform-admissions-pipeline-actions": { moveCasePipelineAction: async () => ({ status: "saved" }) },
  "@/lib/portal/application-documents-actions": {
    readStaffApplicationDocumentSubmissionQueueAction: async () => ({ ok: true, page: { protocolVersion: 1, items: queueItems(20), nextCursor: { sortAt: "2026-09-20T10:00:00Z", id: "x" } } }),
  },
  "@/lib/portal/application-packages-actions": {
    readStaffApplicationPackageQueueAction: async () => ({ ok: true, queue: { protocolVersion: 1, items: queueItems(3), nextCursor: null } }),
  },
  "@/lib/server/student-portal-curator-options": {
    listStudentPortalActiveCurators: async () => [
      { membershipId: CURATOR_A, displayName: "Куратор Один" },
      { membershipId: CURATOR_B, displayName: "Куратор Два" },
    ],
  },
  // Очереди документов рендерятся только в своих видах, не на доске.
  "@/components/portal/applicationPackages/PackageQueue": { PackageQueue: () => null },
  "@/components/v3/admissions/ProgramDocumentQueue": { ProgramDocumentQueue: () => null },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (typeof request === "string" && Object.hasOwn(STUBS, request)) {
    const filename = join(ROOT, ".stub", `${request.replace(/[^a-z0-9]+/giu, "_")}.js`);
    if (!Module._cache[filename]) {
      const stub = new Module(filename);
      stub.filename = filename;
      stub.exports = STUBS[request];
      stub.loaded = true;
      Module._cache[filename] = stub;
    }
    return filename;
  }
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

const PAGES = {
  sales: { pathname: "/v3/pipeline", module: "src/app/(v3)/v3/pipeline/page.tsx", title: "Воронка продаж" },
  admissions: { pathname: "/v3/admissions-pipeline", module: "src/app/(v3)/v3/admissions-pipeline/page.tsx", title: "Воронка поступления" },
};

const SCENARIOS = {
  "sales": { page: "sales", search: "" },
  "sales-panel": { page: "sales", search: `lead=${leadId(5)}` },
  "sales-focus": { page: "sales", search: "stage=qualified" },
  "sales-handed": { page: "sales", search: "stage=handed_off" },
  "sales-mine": { page: "sales", search: "assignment=mine" },
  "sales-search": { page: "sales", search: "q=%D0%A2%D0%B8%D0%BC%D1%83%D1%80" },
  "admissions": { page: "admissions", search: "" },
  "admissions-visa": { page: "admissions", search: "tab=visa" },
};

async function renderScenario(name) {
  const { page, search } = SCENARIOS[name];
  const { pathname, module } = PAGES[page];
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const Page = require(join(ROOT, module)).default;
  const content = await Page({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) });
  const tree = createElement(
    "div",
    { className: "v3-world" },
    createElement(AppShell, { actor: ACTOR, initialNotifications: null }, content),
  );
  return renderToStaticMarkup(withContexts(tree, pathname, search));
}

async function main() {
  if (process.argv.includes("--json")) {
    const out = [];
    for (const name of Object.keys(SCENARIOS)) out.push({ name, html: await renderScenario(name) });
    process.stdout.write(JSON.stringify(out));
  } else if (process.argv.includes("--screenshots")) {
    await screenshots();
  } else {
    console.error("usage: boards-static-render.cjs --json | --screenshots [outDir]");
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

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

/** Та же функция размещения меню, что в TopLayerMenu, для страницы без гидратации. */
function placeMenuSource() {
  const code = ts.transpileModule(readFileSync(join(ROOT, "src/components/v3/board/menu-position.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `(() => { const exports = {}; ${code}; window.__placeMenu = exports.placeMenu; })();`;
}

/** Измерения доски: переполнение, колонки, левый край и верх доски, ширина меню. */
function measure() {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const board = document.querySelector('[role="group"][aria-label="Воронка продаж"], [role="group"][aria-label="Воронка поступления"]');
  const sidebar = document.querySelector('nav[aria-label="Разделы"]');
  const columns = board
    ? [...board.querySelectorAll('[data-testid$="-column"], [data-testid$="-rail"]')].filter(visible)
    : [];
  const viewportWidth = document.documentElement.clientWidth;
  const rects = columns.map((element) => element.getBoundingClientRect());
  const cards = [...document.querySelectorAll('[data-testid="v3-pipeline-card"], [data-testid="v3-admissions-pipeline-card"]')].filter(visible);
  const red = [...document.querySelectorAll("a, button")].filter((element) => visible(element)
    && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map((element) => element.textContent.trim());
  const main = [...document.querySelectorAll("main")].find(visible);
  return {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    boardOverflowX: board ? board.scrollWidth - board.clientWidth : null,
    pageOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
    mainX: main ? Math.round(main.getBoundingClientRect().left) : null,
    boardX: board ? Math.round(board.getBoundingClientRect().left) : null,
    boardTop: board ? Math.round(board.getBoundingClientRect().top) : null,
    boardRight: board ? Math.round(board.getBoundingClientRect().right) : null,
    columnsVisible: rects.filter((rect) => rect.left >= 0 && rect.right <= viewportWidth + 0.5).length,
    columnsTotal: rects.length,
    columnWidths: rects.map((rect) => Math.round(rect.width)),
    maxCardHeight: cards.length ? Math.max(...cards.map((card) => Math.round(card.getBoundingClientRect().height))) : null,
    solidRed: red,
  };
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const css = await compileCss();
  const VIEWPORTS = {
    "1280": { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    "1440": { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    "1920": { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
    "390": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  };
  const shots = [
    ["sales", ["1280", "1440", "1920", "390"]],
    ["sales-panel", ["1440", "390"]],
    ["sales-focus", ["1440"]],
    ["sales-handed", ["1280"]],
    ["sales-search", ["390"]],
    ["admissions", ["1280", "1440", "1920", "390"]],
    ["admissions-visa", ["1920"]],
    ["admissions-menu", ["1440", "1280"]],
    ["rail-flyout", ["1280"]],
  ];
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const [shot, sizes] of shots) {
      const scenario = shot === "admissions-menu" ? "admissions" : shot === "rail-flyout" ? "sales" : shot;
      const { page: pageKey } = SCENARIOS[scenario];
      const htmlPath = join(outDir, `boards-${scenario}.html`);
      if (!existsSync(htmlPath) || shot === scenario) {
        writeFileSync(htmlPath, [
          "<!DOCTYPE html>",
          '<html lang="ru" data-theme="light" class="h-full antialiased">',
          `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${PAGES[pageKey].title} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
          `<body class="min-h-full">${await renderScenario(scenario)}</body></html>`,
        ].join(""));
      }
      for (const size of sizes) {
        const context = await browser.newContext(VIEWPORTS[size]);
        const page = await context.newPage();
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        if (shot === "admissions-menu" || shot === "rail-flyout") {
          await page.addScriptTag({ content: placeMenuSource() });
          await page.evaluate((kind) => {
            // Без гидратации React: открываем то же меню так, как его открыл бы
            // щелчок по кнопке, и ставим функцией placeMenu из исходников.
            const trigger = kind === "rail-flyout"
              ? document.querySelector('nav[aria-label="Разделы"] button[popovertarget][aria-label="Продажи"]')
              : document.querySelectorAll('[data-testid="v3-admissions-pipeline-card"] button[popovertarget]')[3];
            const menu = document.getElementById(trigger.getAttribute("popovertarget"));
            menu.showPopover();
            trigger.setAttribute("aria-expanded", "true");
            const position = window.__placeMenu(
              trigger.getBoundingClientRect(),
              { width: menu.offsetWidth, height: menu.scrollHeight },
              { width: window.innerWidth, height: window.innerHeight },
              kind === "rail-flyout" ? "right-start" : "bottom-end",
            );
            Object.assign(menu.style, { top: `${position.top}px`, left: `${position.left}px`, maxHeight: `${position.maxHeight}px` });
          }, shot);
        }
        const metrics = await page.evaluate(measure);
        if (shot === "admissions-menu" || shot === "rail-flyout") {
          metrics.menu = await page.evaluate(() => {
            const menu = document.querySelector("[popover]:popover-open");
            const rect = menu.getBoundingClientRect();
            const column = menu.closest("section");
            return {
              inTopLayer: menu.matches(":popover-open"),
              rect: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
              clipped: rect.bottom > window.innerHeight || rect.right > window.innerWidth || rect.top < 0 || rect.left < 0,
              scrollHeight: menu.scrollHeight,
              clientHeight: menu.clientHeight,
              insideColumnBox: column ? column.getBoundingClientRect().bottom : null,
              items: [...menu.querySelectorAll("button, a")].filter((item) => item.getBoundingClientRect().height > 0).map((item) => item.textContent.trim()),
            };
          });
        }
        const file = `boards-${shot}-${size}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: size === "390" });
        process.stdout.write(`${JSON.stringify({ file, ...metrics })}\n`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
