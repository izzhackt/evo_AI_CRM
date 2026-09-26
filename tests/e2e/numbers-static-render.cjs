"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require (тот же приём, что в
// case-static-render.cjs и boards-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер Э2 «Честные числа» (решения владельца 26.09.2026,
 * миграция 247): НАСТОЯЩИЕ компоненты с СИНТЕТИЧЕСКИМИ данными — имена,
 * числа и записи выдуманы для проверки вёрстки и не являются записями EVO.
 * Живой Supabase и права проверяет supabase/tests/platform_sales_one_truth.sql.
 *
 *  - Lead 360 (`/v3/profile?id=…`): `Profile` с полосой «Передача» —
 *    переданный лид как в production (передан 18.09, запись о продаже в
 *    архиве: предупреждение словами и «Открыть запись»), лид, проданный в
 *    уже открытое дело (208: дата по квитанции; договор и оплата — по записи
 *    отчёта; приём в CRM не отмечается — сказано словами), и лид до передачи
 *    (полоса нейтральна, формы подтверждения спокойные);
 *  - «Отчёт продаж»: настоящий `SalesRegisterView` с подменёнными чтениями —
 *    заголовок «Продажи за сентябрь» по дате продажи и названные расхождения
 *    с таблицей месяца отчёта — ссылками на эти записи; и сама таблица по
 *    ссылке «без даты продажи» (`sale=undated`);
 *  - «Динамика по дням»: настоящие чтения периода и доски с подменёнными
 *    RPC — переданный лид в «Переданы» (а не «Новый») и на доске, и в
 *    когорте периода; кабинет без продажи не передача; «Продажи за период»
 *    по тому же определению, что заголовок отчёта.
 *
 *   node tests/e2e/numbers-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] (для tests/v3-honest-numbers.test.mjs).
 *   node tests/e2e/numbers-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900 и 390×844 (во весь рост) в
 *       outDir (по умолчанию .impeccable/review, не коммитится):
 *       numbers-<сценарий>-<ширина>.png и метрики на каждый снимок.
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

const compile = (source, fileName) =>
  ts.transpileModule(source, {
    fileName,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8"), filename), filename);
  };
}
Module._extensions[".png"] = (module, filename) => {
  module.exports = { src: pathToFileURL(filename).href, width: 1843, height: 842 };
};
Module._extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });
};

// --- синтетические данные ---------------------------------------------------
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const LEAD_ID = "dddddddd-3333-4333-8333-000000000001";
const uuid = (prefix, n) => `${prefix}-5555-4555-8555-${String(n).padStart(12, "0")}`;
const ADMIN = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, displayName: "Администратор (синтетический)", systemRole: "admin",
  platformAccessVersion: 1, assignments: [], permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
};
// «Сегодня» — 26.09.2026 (полоса считает год от текущих часов; даты фикстур в этом году).
const CURATOR_NAME = "Айгерим Условная";

// Три лида Lead 360 — то, что вернуло бы staff_lead_handoff_strip_v1.
const STRIPS = {
  // Как в production 26.09: передан 18.09 через 088, запись о продаже в архиве.
  handed: {
    leadId: LEAD_ID, stage: "handed_off",
    handoff: { completedAt: "2026-09-18T05:00:00.000Z", evidence: "handoff", acceptanceRecordable: true },
    contract: { confirmed: true, confirmedAt: "2026-09-17T05:00:00.000Z" }, firstPayment: { receivedDate: "2026-09-17" },
    report: { status: "available", record: { id: uuid("12341234", 1), reportMonth: "2026-09-01", saleDate: "2026-09-17", archived: true,
      hasContractNumber: true, paid: { minor: 60000, currency: "USD" } } },
    curator: { displayName: CURATOR_NAME, assignedAt: "2026-09-18T05:05:00.000Z" },
    acceptance: { decision: "accepted", at: "2026-09-19T03:30:00.000Z" },
  },
  // Продажа сохранена в отчёте в уже открытое дело (208): дата — по квитанции;
  // строка условий ничего не подтверждает — договор и оплата по записи отчёта
  // (та же запись «Алина Переданная» в «Отчёте продаж»: 22.09, оплачено 600 USD);
  // ответ куратора записать нельзя (182 требует строки 088).
  sold: {
    leadId: LEAD_ID, stage: "handed_off",
    handoff: { completedAt: "2026-09-23T03:00:00.000Z", evidence: "sales_report", acceptanceRecordable: false },
    contract: { confirmed: false, confirmedAt: null }, firstPayment: { receivedDate: null },
    report: { status: "available", record: { id: uuid("56565656", 1), reportMonth: "2026-09-01", saleDate: "2026-09-22", archived: false,
      hasContractNumber: false, paid: { minor: 60000, currency: "USD" } } },
    curator: { displayName: CURATOR_NAME, assignedAt: "2026-09-23T03:00:00.000Z" }, acceptance: null,
  },
  // До передачи: квалифицирован, договора ещё нет.
  working: {
    leadId: LEAD_ID, stage: "qualified", handoff: null,
    contract: { confirmed: false, confirmedAt: null }, firstPayment: { receivedDate: null },
    report: { status: "available", record: null }, curator: null, acceptance: null,
  },
};
const GATE_BLOCKED = {
  organizationId: ORG, leadId: LEAD_ID, gateVersion: "2", gateState: "blocked", contractConfirmed: false,
  contractConfirmedByMembershipId: null, contractConfirmedAt: null, contractEvidenceReference: null, firstPaymentAmount: null,
  firstPaymentCurrency: null, firstPaymentDueDate: null, firstPaymentReceivedDate: null, firstPaymentConfirmedByMembershipId: null,
  firstPaymentConfirmedAt: null, firstPaymentEvidenceReference: null, overrideReason: null, overriddenByMembershipId: null,
  overriddenAt: null, normalHandoffAllowed: false, exceptionalHandoffAllowed: false, canConfirmContract: true,
  canConfirmFirstPayment: true, canOverrideGate: true, updatedAt: "2026-09-20T05:00:00.000Z",
};
const GATE_SATISFIED = {
  ...GATE_BLOCKED, gateVersion: "4", gateState: "satisfied", contractConfirmed: true, contractConfirmedByMembershipId: ME,
  contractConfirmedAt: "2026-09-17T05:00:00.000Z", contractEvidenceReference: "Договор № 0000 (синтетический)",
  firstPaymentAmount: 600, firstPaymentCurrency: "USD", firstPaymentDueDate: "2026-09-20", firstPaymentReceivedDate: "2026-09-17",
  firstPaymentConfirmedByMembershipId: ME, firstPaymentConfirmedAt: "2026-09-17T06:00:00.000Z",
  firstPaymentEvidenceReference: "Платёж 0000 (синтетический)", normalHandoffAllowed: true,
};
const LEAD_SCENARIOS = {
  "lead-handed": { strip: STRIPS.handed, gate: GATE_SATISFIED, stageKey: "new", next: "Передано в поступление" },
  "lead-sold": { strip: STRIPS.sold, gate: { ...GATE_BLOCKED, canConfirmContract: false, canConfirmFirstPayment: false, canOverrideGate: false },
    stageKey: "meeting_completed", next: "Передано в поступление" },
  "lead-working": { strip: STRIPS.working, gate: GATE_BLOCKED, stageKey: "qualified", next: "Отправить договор на подпись" },
};

// «Отчёт продаж», сентябрь 2026: те же записи, что в SQL-наборе 247.
function saleRow(n, fields) {
  return {
    id: uuid("56565656", n), version: 1, reportMonth: fields.month ?? "2026-09-01", signingDate: fields.sale ?? null,
    applicantName: fields.name, phone: "", country: "Малайзия", university: "", program: fields.program ?? "Бакалавриат",
    direction: "Малайзия", intake: "2027", contractNumber: "", managerLabel: "Санжар Эскизов", statusRaw: "",
    ownerMembershipId: ME, serviceCostRaw: "1500", serviceCostMinor: 150000, serviceCostCurrency: "USD", paidRaw: "600",
    paidMinor: 60000, paidCurrency: "USD", needsReview: false, notes: "", archived: false, sourceKey: null,
    sourceKind: fields.pipeline ? "pipeline" : "manual", leadId: fields.pipeline ? LEAD_ID : null, clientId: null,
    sourceSha256: null, sourceSheet: null, sourceRow: null, updatedAt: "2026-09-24T05:00:00.000Z",
  };
}
const REPORT_ROWS = [
  saleRow(1, { name: "Алина Переданная", sale: "2026-09-22", pipeline: true }),
  saleRow(2, { name: "Айжан Примерова", sale: "2026-09-20" }),
  saleRow(3, { name: "Тимур Образцов", sale: "2026-09-14" }),
  saleRow(4, { name: "Бекзат Тестов", sale: "2026-09-05" }),
  saleRow(5, { name: "Данияр Макетов", sale: null }),
  saleRow(6, { name: "Руслан Прототипов", sale: "2026-08-30" }),
];
const WORKSPACE = {
  year: 2026, month: 9, totalCount: REPORT_ROWS.length, rows: REPORT_ROWS, selected: null, offset: 0, hasMore: false,
  totals: [{ currency: "USD", costMinor: 900000, paidMinor: 360000 }], unresolvedCostCount: 0, unresolvedPaidCount: 0,
  targets: [], managerLabels: ["Санжар Эскизов"], ownerOptions: [],
};
const SALES_COUNT = { status: "available", count: { from: "2026-09-01", to: "2026-09-30", sales: 5, undated: 1, otherSaleDate: 1, filedElsewhere: 1 } };

// Доска продаж: четыре открытых лида, один из них передан (его stage_key — всё ещё 'new').
function boardRow(n, stageKey, name) {
  return {
    organizationId: ORG, leadId: uuid("dddddddd", n), clientId: uuid("cccccccc", n), clientDisplayName: name, clientEmail: null, clientPhone: null,
    currentOwnerMembershipId: ME, currentOwnerDisplayName: "Санжар Эскизов", stageKey, sourceKey: "website", lifecycleState: "open",
    nextActionText: "Позвонить", nextActionDueDate: "2026-09-27", workflowVersion: "1", isConnected: false, openDuplicateCandidateCount: 0,
    linkedStudentCaseCount: n === 1 || n === 2 ? 1 : 0, linkedConversationCount: 0, createdAt: "2026-09-05T05:00:00.000Z",
    updatedAt: "2026-09-24T05:00:00.000Z", stageEnteredAt: "2026-09-20T05:00:00.000Z", latestNote: null,
  };
}
const BOARD_ROWS = [boardRow(1, "new", "Алина Переданная"), boardRow(2, "qualified", "Айжан Примерова"),
  boardRow(3, "new", "Тимур Образцов"), boardRow(4, "contacting", "Бекзат Тестов")];
const HANDED = new Set([uuid("dddddddd", 1)]);

const STUBS = {
  "@/lib/v3/sales-register-source": {
    // Срез «без даты продажи» — как read_sales_register_v3 с p_sale_slice => 'undated'.
    readSalesRegisterWorkspace: async (_actor, selection) => {
      if (!selection.saleSlice) return WORKSPACE;
      if (selection.saleSlice !== "undated") throw new Error(`harness: slice ${selection.saleSlice} is not modelled`);
      const rows = REPORT_ROWS.filter((row) => row.signingDate === null);
      return { ...WORKSPACE, rows, totalCount: rows.length, totals: [{ currency: "USD", costMinor: 150000, paidMinor: 60000 }] };
    },
    readSalesRegisterIntakeOptions: async () => null,
    readSalesRegisterWriteAccess: async () => "allowed",
    readSalesRegisterDirections: async () => ["Малайзия"],
    readSalesRegisterManagement: async () => ({ status: "denied" }),
  },
  "@/lib/v3/finance-entry-source": { readMonthlyPaymentSummary: async () => ({ status: "not_allowed" }) },
  "@/lib/v3/sales-numbers-source": { readSalesCount: async () => SALES_COUNT, readLeadHandoffStrip: async () => ({ status: "unavailable" }) },
  "@/lib/platform-sales-stage-entries": {
    // Доказанный вход в «Квалифицирован» у лида 2 (он и на доске «Квалифицирован»);
    // у переданного лида 1 (stage_key 'new', как в production) входа нет — он
    // квалифицирован передачей.
    listPlatformSalesStageEntries: async () => ({ rows: [{ organizationId: ORG, leadId: uuid("dddddddd", 2), stageKey: "qualified",
      enteredAt: "2026-09-10T05:00:00.000Z", enteredOn: "2026-09-10", requestId: uuid("14141414", 1) }], hasNext: false, nextCursor: null }),
    PlatformSalesStageEntryError: class PlatformSalesStageEntryError extends Error {},
  },
  "@/lib/platform-sales": {
    listPlatformSalesLeads: async () => ({ rows: BOARD_ROWS, hasNext: false, nextCursor: null }),
    listPlatformSalesOwnerOptions: async () => ({ rows: [], hasNext: false, nextCursor: null }),
    readPlatformSalesPipeline: async (actor, readers) => ({ board: await readers.board(actor), ownerOptions: null, canCreateLead: true }),
    PlatformSalesRepositoryError: class PlatformSalesRepositoryError extends Error {},
  },
  "@/lib/v3/sales-handoff-source": { readCompletedSalesHandoffs: async () => HANDED },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (typeof request === "string" && Object.hasOwn(STUBS, request)) {
    const filename = join(ROOT, ".stub-numbers", `${request.replace(/[^a-z0-9]+/giu, "_")}.js`);
    if (!Module._cache[filename]) {
      const stub = new Module(filename);
      stub.filename = filename;
      stub.exports = STUBS[request];
      stub.loaded = true;
      Module._cache[filename] = stub;
    }
    return filename;
  }
  if (request === "server-only") return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
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

const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
function withContexts(node, pathname, search) {
  return createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: pathname },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}
function shell(actor, title, body) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  return createElement("div", { className: "v3-world" },
    createElement(AppShell, { actor, initialNotifications: null }, title === null ? body : createElement(PartShell, { title, count: null }, body)));
}

// --- Lead 360 ----------------------------------------------------------------
function leadPage(name) {
  const scenario = LEAD_SCENARIOS[name];
  const { Profile } = require(join(ROOT, "src/components/v3/profile/Profile.tsx"));
  const { buildV3ProfileHref } = require(join(ROOT, "src/components/v3/profile/types.ts"));
  const hrefFor = (tab) => buildV3ProfileHref({ leadId: LEAD_ID, studentCaseId: null }, tab);
  const profile = {
    leadId: LEAD_ID, person: "Алина Переданная", email: "lead@example.invalid", phone: "+996 000 000 002", student: scenario.strip.handoff !== null,
    stage: scenario.stageKey, caseStatus: null, source: "website", qualification: null, arrived: "05.09.2026", nextAction: scenario.next,
    nextActionAt: null, handoff: null, applications: [], visa: [], financeStop: null, timeline: [],
  };
  const draft = {
    access: { documents: false, finance: false, studentProfile: false, contract: false },
    routeTarget: { leadId: LEAD_ID, studentCaseId: null }, responsible: "Санжар Эскизов", provider: null, person: [], study: [],
    profileFields: null, studentApplication: null, profileFieldSources: [], documents: [], otherFiles: [], budget: null, currency: null,
    payments: [], paid: null, remaining: null, paidPercent: null, admissions: null, contract: null, handoffAcknowledgement: null,
    salesHandoffAcknowledgement: null, saleConditions: null, leadCabinetCase: null, contractSignedAt: null,
  };
  const sales = {
    lead: { leadId: LEAD_ID, currentOwnerMembershipId: ME, currentOwnerDisplayName: "Санжар Эскизов", stageKey: scenario.stageKey,
      nextActionText: scenario.next, nextActionDueDate: null, workflowVersion: "5" },
    gate: scenario.gate, handoff: { caseId: null, canOpenCase: false },
    strip: { status: "available", strip: scenario.strip }, linkedConversations: [],
  };
  const requestIds = Object.fromEntries(["contract", "firstPayment", "override", "handoff", "platformAccess", "saleConditions",
    "prepareLeadCabinet", "wishesCard", "educationCard", "conditionsCard"].map((key, index) => [key, uuid("13131313", index + 1)]));
  const body = createElement(Profile, {
    profile, draft, sales, actor: ADMIN, organizationId: ORG, studentPortalCurators: [], studentPortalCuratorsAvailable: true,
    requestIds, noteRequestId: uuid("13131313", 20), notes: { subject: { leadId: LEAD_ID, studentCaseId: null }, rows: [] },
    notesOlderHref: null, notesLatestHref: null, tab: "overview", hrefFor,
  });
  return renderToStaticMarkup(withContexts(shell(ADMIN, "Профиль", createElement("div", { className: "space-y-6" }, body)),
    "/v3/profile", `id=${LEAD_ID}&tab=overview`));
}

// --- «Отчёт продаж» ------------------------------------------------------------
async function reportPage(extra = {}) {
  const { SalesRegisterView } = require(join(ROOT, "src/components/v3/SalesRegisterView.tsx"));
  const query = { view: "sales", year: "2026", month: "9", ...extra };
  const element = await SalesRegisterView({ actor: ADMIN, query });
  return renderToStaticMarkup(withContexts(shell(ADMIN, null, element), "/v3/main", new URLSearchParams(query).toString()));
}

// --- «Динамика по дням»: когорта, «Продажи» периода и воронка по доске ----------
// Настоящие чтения периода и доски (`readSalesDynamics` → `readPeriodDashboard`,
// `readPipelineLeads`, `salesBoardFunnel`) поверх подменённых RPC: переданный
// лид (его stage_key — 'new') — «Переданы» и на доске, и в когорте; кабинет без
// продажи (лид 2) — не передача.
async function funnelPage() {
  const { readSalesDynamics } = require(join(ROOT, "src/lib/v3/sales-dynamics-source.ts"));
  const { SalesDynamics } = require(join(ROOT, "src/components/v3/SalesDynamics.tsx"));
  const { salesDynamicsCarry, salesDynamicsHref } = require(join(ROOT, "src/lib/sales-register-navigation.ts"));
  const period = { key: "custom", from: "2026-09-01", to: "2026-09-26", today: "2026-09-26" };
  const query = { view: "sales", period: "custom", from: period.from, to: period.to };
  const read = await readSalesDynamics(ADMIN, period);
  const periods = [["today", "Сегодня"], ["yesterday", "Вчера"], ["week", "Неделя"], ["month", "Месяц"], ["custom", "Период"]];
  const body = createElement(SalesDynamics, {
    id: "sales-dynamics", open: true,
    choices: periods.map(([key, title]) => ({ key, title, href: salesDynamicsHref(query, key === "custom" ? period : { key }), active: key === "custom" })),
    range: { from: period.from, to: period.to, max: period.today }, periodText: "1 сен — 26 сен",
    formAction: "/v3/main#sales-dynamics", carry: salesDynamicsCarry(query), retryHref: salesDynamicsHref(query, period), read,
  });
  return renderToStaticMarkup(withContexts(shell(ADMIN, "Отчёт продаж", body), "/v3/main", "view=sales&period=custom"));
}

async function renderAll() {
  const out = [];
  for (const name of Object.keys(LEAD_SCENARIOS)) out.push({ name, html: leadPage(name) });
  out.push({ name: "report", html: await reportPage() });
  out.push({ name: "report-undated", html: await reportPage({ sale: "undated" }) });
  out.push({ name: "funnel", html: await funnelPage() });
  return out;
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

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const SIZES = {
    1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  };
  try {
    for (const { name, html } of await renderAll()) {
      const htmlPath = join(outDir, `numbers-${name}.html`);
      writeFileSync(htmlPath, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Э2 — ${name} (синтетические данные)</title><style>${css}</style></head><body class="min-h-full">${html}</body></html>`);
      for (const width of ["1440", "390"]) {
        const context = await browser.newContext(SIZES[width]);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].map((image) => image.decode().catch(() => null)));
        });
        const target = name.startsWith("lead") ? '[data-testid="v3-lead-stage"]' : name.startsWith("report") ? "main h1" : "#sales-dynamics";
        // Lead 360 — во весь рост с шапкой профиля: этап, полоса и заметки на одном снимке.
        const fullPage = name.startsWith("lead");
        if (!fullPage) await page.evaluate((selector) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`no ${selector}`);
          window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 96), behavior: "instant" });
        }, target);
        if (errors.length) throw new Error(`${name}: browser errors:\n${errors.join("\n")}`);
        const metrics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          solidRed: [...document.querySelectorAll("main a, main button")].filter((element) => element.checkVisibility()
            && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
          smallText: [...document.querySelectorAll("main *")].filter((element) => element.checkVisibility()
            && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
            && parseFloat(getComputedStyle(element).fontSize) < 12).length,
          smallTargets: [...document.querySelectorAll("main a, main button, main summary")].filter((element) =>
            element.checkVisibility() && element.getBoundingClientRect().height < 24).length,
          stripItems: document.querySelectorAll("[data-handoff-item]").length,
          warnings: document.querySelectorAll('[data-testid="v3-handoff-warnings"] li').length,
          headline: document.querySelector('[data-testid="v3-sales-headline"]')?.textContent?.replace(/\s+/gu, " ").trim() ?? null,
        }));
        const file = `numbers-${name}-${width}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage });
        process.stdout.write(`${file}: ${Object.entries(metrics).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join(" ")}\n`);
        if (name === "funnel") {
          // Второй экран: «Продажи за период» и «Сейчас на доске».
          await page.evaluate(() => {
            const element = document.querySelector("[data-period-sales]");
            window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 24), behavior: "instant" });
          });
          await page.screenshot({ path: join(outDir, `numbers-funnel-board-${width}.png`) });
          process.stdout.write(`numbers-funnel-board-${width}.png\n`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

if (process.argv.includes("--json")) {
  renderAll().then((pages) => process.stdout.write(JSON.stringify(pages))).catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: numbers-static-render.cjs --json | --screenshots [outDir]");
  process.exit(2);
}
