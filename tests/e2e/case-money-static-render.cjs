"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в case-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер вкладки «Договор и оплата» дела студента (Э8.3,
 * PLAN_CHANGES 28.09 «Э8: срезы по итоговой критике»).
 *
 * Рендерит НАСТОЯЩУЮ страницу дела — `caseWorkParts` (шапка и действия у
 * заголовка), `Profile` с вкладкой `money` (`Money`, `CaseMoneySection`,
 * `CaseAgreementView`, `ProfileContractWorkspace`, `ProfileFinanceControls`),
 * `PartShell` и `AppShell` — с СИНТЕТИЧЕСКИМИ данными: имена, суммы и файлы
 * выдуманы для проверки вёрстки и не являются записями EVO. Живой Supabase,
 * права и данные этот рендер не проверяет. Три асинхронных чтения заменены
 * синхронно: `CaseAgreementBlock` рисует `CaseAgreementView` с данными
 * сценария (как после чтения 189), `FinanceEntryWorkspace` и команда amoCRM —
 * строкой, что это отдельное чтение.
 *
 *   node tests/e2e/case-money-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — разметка сценариев без оболочки.
 *   node tests/e2e/case-money-static-render.cjs --screenshots [outDir]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900, 1280×800 и 390×844 в outDir (по умолчанию .impeccable/review,
 *       не коммитится), файлы `money-*.png`, и замеры каждого снимка:
 *       прокрутка вбок, видимый текст мельче 12 px, сплошной красный
 *       (rgb(215, 2, 23)), цели нажатия ниже 44 px.
 *
 *     Страница не гидратируется. «⋯» открывается щелчком (popover API
 *     браузера); открытая панель снимается так, как её показывает лист после
 *     выбора пункта «⋯»: у панели снимается `hidden` (состояние клиента).
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

// --- require-hook: .ts/.tsx компилируются TypeScript'ом в CJS ---------------
const compile = (source, fileName) =>
  ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
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

const { caseWorkParts } = require(join(ROOT, "src/components/v3/profile/CaseWorkParts.tsx"));
const { Profile } = require(join(ROOT, "src/components/v3/profile/Profile.tsx"));
const { buildV3ProfileHref } = require(join(ROOT, "src/components/v3/profile/types.ts"));
const queueView = require(join(ROOT, "src/components/v3/students/students-queue-view.ts"));
const agreementModule = require(join(ROOT, "src/components/v3/profile/CaseAgreementBlock.tsx"));
const financeEntryModule = require(join(ROOT, "src/components/v3/profile/FinanceEntryWorkspace.tsx"));
const amoModule = require(join(ROOT, "src/components/v3/profile/ProfileAmoCrmCommandSection.tsx"));

// --- синтетические данные ---------------------------------------------------
// «Сегодня» — среда 23.09.2026 по Бишкеку (как в статическом рендере дела).
const TODAY = "2026-09-23";
const NOW = queueView.bishkekNoon(TODAY);
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const OTHER = "aaaaaaaa-1111-4111-8111-000000000002";
const CASE_ID = "cccccccc-2222-4222-8222-000000000001";
const LEAD_ID = "dddddddd-3333-4333-8333-000000000001";
const NAME = "Айдана Сыдыкова";
const uuid = (prefix, n) => `${prefix}-5555-4555-8555-${String(n).padStart(12, "0")}`;
const RETURN_TO = "/v3/students?view=mine";

const ADMIN = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, displayName: "Администратор (синтетический)", systemRole: "admin",
  platformAccessVersion: 1, assignments: [], permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
};
const CURATOR = {
  ...ADMIN,
  displayName: "Куратор (синтетический)", systemRole: "staff",
  assignments: [{ label: "Сотрудник поступления", scope: { kind: "own" } }],
  permissionKeys: ["case.read.full", "profile.read.full", "case.route.manage", "case.update.append", "document.read.full",
    "task.create", "task.manage", "staff.task.read", "staff.task.create", "finance.stop.create"],
};

// Договор и оплата (чтение 189), как его вернул бы readCaseAgreement.
function tranche(n, fields) {
  return { id: uuid("71717171", n), label: fields.label, amountMinor: fields.amount, currency: fields.currency ?? "USD",
    dueOn: fields.dueOn ?? null, totalPaidMinor: fields.paid ?? "0", outstandingMinor: fields.outstanding ?? fields.amount };
}
function payment(n, fields) {
  return { id: uuid("72727272", n), obligationId: uuid("71717171", fields.tranche), amountMinor: fields.amount,
    currency: fields.currency ?? "USD", occurredOn: fields.on, actorDisplayName: fields.by ?? "Айгүл Осмонова",
    eventType: fields.refund ? "refund" : "payment",
    receipts: fields.receipt ? [{ id: uuid("73737373", n), originalFilename: `receipt-${n}.pdf`, uploadedAt: `${fields.on}T06:00:00.000Z` }] : [] };
}
const CONTRACT_FILE = { id: uuid("74747474", 2), originalFilename: "dogovor-sydykova-2026.pdf", uploadedAt: "2026-09-18T10:40:00.000Z", uploadedByDisplayName: "Эрмек Токтосунов" };
const CONTRACT_OLD = { id: uuid("74747474", 1), originalFilename: "dogovor-sydykova-chernovik.pdf", uploadedAt: "2026-08-28T05:10:00.000Z", uploadedByDisplayName: "Эрмек Токтосунов" };
function agreement(fields = {}) {
  return {
    organizationId: ORG, studentCaseId: CASE_ID, costMinor: fields.costMinor === undefined ? "150000" : fields.costMinor,
    costCurrency: fields.costCurrency === undefined ? "USD" : fields.costCurrency,
    contractCurrent: fields.contract ?? null, contractHistory: fields.history ?? [], tranches: fields.tranches ?? [],
    trancheSumMinor: fields.trancheSum ?? "0", costMismatch: fields.costMismatch ?? false, payments: fields.payments ?? [],
    paidMinor: fields.paidMinor ?? "0", remainingMinor: fields.remainingMinor === undefined ? "150000" : fields.remainingMinor,
    currencyMismatch: fields.currencyMismatch ?? false, canWrite: true,
  };
}
const AGREEMENT = {
  // Договора нет, траншей и оплат нет: сводка и одна кнопка «Загрузить договор».
  empty: agreement(),
  // Одна валюта: договор загружен (и прежняя версия), два транша (один оплачен, второй просрочен), оплаты с чеком и без.
  same: agreement({
    contract: CONTRACT_FILE, history: [CONTRACT_OLD], trancheSum: "150000", paidMinor: "60000", remainingMinor: "90000",
    tranches: [tranche(1, { label: "Первый платёж", amount: "60000", dueOn: "2026-09-01", paid: "60000", outstanding: "0" }),
      tranche(2, { label: "Второй платёж — после оффера", amount: "90000", dueOn: "2026-09-20" })],
    payments: [payment(2, { tranche: 1, amount: "20000", on: "2026-09-12" }), payment(1, { tranche: 1, amount: "40000", on: "2026-08-30", receipt: true })],
  }),
  // Разные валюты: стоимость в USD, второй транш в сомах; возврат части оплаты. Ни одна сумма не пересчитывается.
  cross: agreement({
    contract: CONTRACT_FILE, currencyMismatch: true, trancheSum: "5060000", paidMinor: "3060000", remainingMinor: null,
    tranches: [tranche(1, { label: "Услуги EVO — первая часть", amount: "60000", dueOn: "2026-09-01", paid: "60000", outstanding: "0" }),
      tranche(2, { label: "Услуги EVO — вторая часть (сомы)", amount: "5000000", currency: "KGS", dueOn: "2026-10-15", paid: "3000000", outstanding: "2000000" })],
    payments: [payment(3, { tranche: 2, amount: "500000", currency: "KGS", on: "2026-09-21", refund: true }),
      payment(2, { tranche: 2, amount: "3500000", currency: "KGS", on: "2026-09-19", receipt: true }),
      payment(1, { tranche: 1, amount: "60000", on: "2026-08-30", receipt: true })],
  }),
};

// Финансовый контроль дела (обязательства и стопы) — чтение staff_case_finance_control.
function obligation(n, fields) {
  return { paymentObligationId: uuid("71717171", n), label: fields.label, category: "evo_service_fee", amountMinor: fields.amount,
    currency: "USD", dueAt: fields.dueAt ?? null, totalPaidMinor: fields.paid ?? 0, totalRefundedMinor: 0,
    outstandingMinor: fields.amount - (fields.paid ?? 0), status: fields.status ?? "pending", overdue: fields.overdue ?? false,
    nextAction: fields.nextAction ?? null, paymentConfirmationCount: 0, lastPaymentAt: fields.lastPaymentAt ?? null,
    activeStopFactors: fields.stops ?? [] };
}
const STOP = { stopFactorId: uuid("75757575", 1), version: "1", reason: "Второй платёж просрочен — подачу в вуз не начинаем до оплаты.",
  blockedAction: "application_submission", nextAction: "Связаться с семьёй до 25.09", ownerDisplayName: "Айгүл Осмонова", createdAt: "2026-09-21T05:00:00.000Z" };
function financeControl(stops) {
  return { organizationId: ORG, studentCaseId: CASE_ID, history: [], obligations: [
    obligation(1, { label: "Первый платёж", amount: 60000, paid: 60000, status: "paid", lastPaymentAt: "2026-09-12T08:00:00.000Z" }),
    obligation(2, { label: "Второй платёж — после оффера", amount: 90000, dueAt: "2026-09-20T18:00:00.000Z", overdue: true, status: "overdue",
      stops: stops ? [STOP] : [] }),
  ] };
}

// Раздел договора (BW6): шаблонов нет. У Admin — управление шаблонами, у куратора — нет.
function contractWorkspace(admin, reviewedSource = false) {
  return {
    organizationId: ORG, studentCaseId: CASE_ID, actorRole: admin ? "admin" : "admissions",
    canManageTemplates: admin, canGenerateContract: true, canReviewContract: admin, canManagePostContract: true, canReviewReport: admin,
    reviewedSources: reviewedSource ? [{ sourceRegistryId: uuid("76767676", 1), sourceKey: "contract_evo_standard", sourceKind: "internal_document",
      sourceUrl: "https://example.invalid/contract-template", sourceRevision: "2026-09", reviewStatus: "reviewed", reviewedAt: "2026-09-10T05:00:00.000Z" }] : [],
    templates: [], drafts: [], items: [], reports: [],
  };
}
const HANDOFF = {
  organizationId: ORG, leadId: LEAD_ID, studentCaseId: CASE_ID, caseState: "active", handoffMode: "normal", handoffState: "completed",
  handoffReason: "Договор и первый платёж подтверждены (синтетика).", handoffSource: "canonical_sales", handedOffAt: "2026-08-30T06:00:00.000Z",
  actorMembershipId: OTHER, actorDisplayName: "Эрмек Токтосунов", admissionsOwnerMembershipId: ME, admissionsOwnerDisplayName: "Айгүл Осмонова",
  gateVersion: "4", gateState: "passed", workflowVersion: "5",
  salesContext: { stageKey: "handed_off", sourceKey: "website" }, clientContext: { clientId: uuid("77777777", 1) },
  provenance: [], conversationLinks: [],
  starterTasks: [{ taskId: uuid("78787878", 1), title: "Первый звонок семье", assigneeDisplayName: "Айгүл Осмонова", status: "done" }],
};

function queueRow() {
  const nextAction = "Собрать апостиль на аттестат";
  const dueOn = "2026-09-25";
  return {
    studentCaseId: CASE_ID, studentDisplayName: NAME, state: "active", admissionsDirection: "CN",
    targetCountry: "CN", targetDegree: "Бакалавриат", pipelineStage: "documents", pipelineHidden: false,
    nextAction, nextActionDueOn: dueOn, dueBand: queueView.caseNextActionBand(nextAction, dueOn, NOW), admissionsVersion: "7",
    currentCuratorMembershipId: ME, currentCuratorDisplayName: "Айгүл Осмонова", isMine: true,
    attentionFlags: [], overdueTaskCount: 0, documents: null, updatedAt: "2026-09-22T04:00:00.000000Z", cursor: `due|0|${dueOn}|${CASE_ID}`,
  };
}
const HANDOFF_PENDING = {
  organizationId: ORG, studentCaseId: CASE_ID, assignmentEventId: uuid("55555555", 1), canRespond: true, current: null, requestId: uuid("44444444", 1),
};
const HANDOFF_ACCEPTED = {
  ...HANDOFF_PENDING, canRespond: false,
  current: { acknowledgementId: uuid("33333333", 1), decision: "accepted", clarification: null, agreedContactDate: "2026-09-24", createdAt: "2026-09-21T04:00:00.000Z" },
};

function profile(fields = {}) {
  return {
    leadId: null, person: NAME, email: null, phone: null, student: true, stage: null, caseStatus: "active", source: null,
    qualification: null, arrived: "01.09.2026", nextAction: "Собрать апостиль на аттестат", nextActionAt: null, handoff: null,
    applications: [], visa: [], financeStop: fields.financeStop ?? null, timeline: [],
  };
}

function draft(fields = {}) {
  const admin = fields.admin ?? true;
  return {
    access: { documents: true, finance: true, studentProfile: true, contract: true },
    routeTarget: { leadId: null, studentCaseId: CASE_ID }, responsible: "Айгүл Осмонова", provider: null, person: [], study: [],
    profileFields: null, studentApplication: null, profileFieldSources: [], documents: [], otherFiles: [],
    budget: "1 500 $", currency: "USD", paid: "600 $", remaining: "900 $", paidPercent: 40,
    payments: [
      { name: "Первый платёж", amount: "600 $", state: "paid", at: "2026-09-12T08:00:00.000Z" },
      { name: "Второй платёж — после оффера", amount: "900 $", state: "overdue", at: "2026-09-20T18:00:00.000Z" },
    ],
    admissions: {
      studentCaseId: CASE_ID, caseState: "active", isCabinetCase: false, direction: "CN", applications: [], visa: null,
      finance: financeControl(fields.stop ?? false),
      requestIds: { createApplication: uuid("22222222", 1), applications: {}, applicationDetails: {},
        createStops: { [uuid("71717171", 1)]: uuid("22222222", 2), [uuid("71717171", 2)]: uuid("22222222", 3) },
        resolveStops: { [STOP.stopFactorId]: uuid("22222222", 4) }, partnerDetails: {}, changeStatus: {} },
    },
    contract: { workspace: contractWorkspace(admin, fields.reviewedSource ?? false), handoff: HANDOFF },
    handoffAcknowledgement: fields.handoff ?? HANDOFF_ACCEPTED, salesHandoffAcknowledgement: null,
    saleConditions: null, leadCabinetCase: null, contractSignedAt: null, handedOffBy: { name: "Эрмек Токтосунов", at: "2026-08-30T06:00:00.000Z" },
  };
}

/**
 * Сценарии. `agreement` — что вернуло бы чтение 189; `open` — панель, которую
 * снимок показывает открытой (как после выбора пункта «⋯»).
 */
const SCENARIOS = {
  // Куратор принимает переданное дело: договора нет — одна кнопка «Загрузить договор»;
  // единственный сплошной красный на странице — «Принять дело» у заголовка.
  "curator-no-contract": { actor: CURATOR, profile: profile(), draft: draft({ admin: false, handoff: HANDOFF_PENDING }), agreement: AGREEMENT.empty },
  // Admin: договор загружен, одна валюта, остаток; все пять пунктов «⋯».
  "admin-same-currency": { actor: ADMIN, profile: profile(), draft: draft(), agreement: AGREEMENT.same },
  // Разные валюты стоимости и траншей: оплачено и остаток — по каждой валюте, без пересчёта.
  "admin-cross-currency": { actor: ADMIN, profile: profile(), draft: draft(), agreement: AGREEMENT.cross },
  // Финансовый стоп: строка сводки с чипом (без боковой полосы), «Стопы» открывает панель.
  "admin-stop": { actor: ADMIN, profile: profile({ financeStop: STOP.reason }), draft: draft({ stop: true }), agreement: AGREEMENT.same },
  // Предупреждение о шаблоне — тому, кто смотрит: куратор — кто добавляет; Admin — что сделать самому.
  "curator-template": { actor: CURATOR, profile: profile(), draft: draft({ admin: false }), agreement: AGREEMENT.same, open: "money-contract" },
  "admin-template": { actor: ADMIN, profile: profile(), draft: draft(), agreement: AGREEMENT.same, open: "money-contract" },
  "admin-template-source": { actor: ADMIN, profile: profile(), draft: draft({ reviewedSource: true }), agreement: AGREEMENT.same, open: "money-contract" },
};

let current = null;
// Асинхронные чтения — синхронно, данными сценария (чтение 189 и две панели «⋯»).
agreementModule.CaseAgreementBlock = function CaseAgreementBlockStatic(props) {
  return createElement(agreementModule.CaseAgreementView, {
    agreement: current.agreement, canWrite: true, today: TODAY,
    saleConditionsHref: props.saleConditionsHref, financeStop: props.financeStop, stopsPanel: props.stopsPanel,
  });
};
financeEntryModule.FinanceEntryWorkspace = function FinanceEntryWorkspaceStatic() {
  return createElement("p", { className: "py-2 t-body-compact text-fg-2" }, "Формы операций — отдельное чтение; в статическом рендере не читаются.");
};
amoModule.ProfileAmoCrmCommandSection = function AmoStatic() {
  return createElement("p", { className: "py-2 t-body-compact text-fg-2" }, "Команда amoCRM — отдельное чтение; в статическом рендере не читается.");
};

const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const SEARCH = `case=${CASE_ID}&tab=money&returnTo=${encodeURIComponent(RETURN_TO)}`;

function withContexts(node) {
  return createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: "/v3/profile" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(SEARCH) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}

function caseBody(name) {
  const item = SCENARIOS[name];
  current = item;
  const hrefFor = (tab) => `${buildV3ProfileHref({ leadId: null, studentCaseId: CASE_ID }, tab)}&returnTo=${encodeURIComponent(RETURN_TO)}`;
  const preview = item.actor.systemRole === "admin" && item.actor.presentationRole !== null;
  const editor = { admin: item.actor.systemRole === "admin" && !preview, preview, routeManage: true, broadScope: false };
  const row = queueRow();
  const parts = caseWorkParts({
    actor: item.actor, profile: item.profile, draft: item.draft, sales: null,
    work: { row, tasks: { kind: "ready", tasks: [], assignees: [] }, chat: { kind: "forbidden" }, activity: { kind: "ready", olderThan: null, events: [] },
      needsCurator: false, deletionRequested: false, today: TODAY, nowIso: NOW.toISOString() },
    stepAccess: queueView.nextStepAccess(editor, row, []),
    requestIds: { contract: "", firstPayment: "", override: "", handoff: "", platformAccess: "", saleConditions: "", prepareLeadCabinet: "",
      wishesCard: "", educationCard: "", conditionsCard: "", step: uuid("12121212", 1), assignCurator: uuid("12121212", 2), portal: uuid("12121212", 3), note: uuid("12121212", 4) },
    notes: { subject: { leadId: null, studentCaseId: CASE_ID }, rows: [] }, notesOlderHref: null, notesLatestHref: null,
    curators: [], curatorsAvailable: true, hrefFor, salesDataOpen: false, help: null, closure: null,
  });
  return { actions: parts.actions, body: createElement(Profile, {
    profile: item.profile, draft: item.draft, sales: null, actor: item.actor, organizationId: ORG,
    studentPortalCurators: [], studentPortalCuratorsAvailable: true,
    requestIds: { contract: "", firstPayment: "", override: "", handoff: "", platformAccess: "", saleConditions: "", prepareLeadCabinet: "", wishesCard: "", educationCard: "", conditionsCard: "" },
    noteRequestId: uuid("12121212", 5), notes: { subject: { leadId: null, studentCaseId: CASE_ID }, rows: [] }, notesOlderHref: null, notesLatestHref: null,
    tab: "money", hrefFor, caseHeader: parts.header, caseOverview: parts.overview,
  }) };
}

function renderWorkspace(name) {
  const { actions, body } = caseBody(name);
  return renderToStaticMarkup(withContexts(createElement("div", null, actions, body)));
}

function renderPage(name) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const { Icon } = require(join(ROOT, "src/components/icons.tsx"));
  const back = createElement("a", { href: RETURN_TO, className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    createElement(Icon, { name: "arrow-left", size: 16 }), "Студенты");
  const { actions, body } = caseBody(name);
  const page = createElement("div", { className: "v3-world", "data-surface": "staff" },
    createElement(AppShell, { actor: SCENARIOS[name].actor, initialNotifications: null },
      createElement(PartShell, { title: NAME, count: null, dense: true, back, action: actions }, createElement("div", { className: "space-y-6" }, body))));
  return renderToStaticMarkup(withContexts(page));
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

function writeHtml(path, css, markup) {
  writeFileSync(path, [
    "<!DOCTYPE html>",
    '<html lang="ru" data-theme="light" class="h-full antialiased">',
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Дело студента — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
    `<body class="min-h-full">${markup}</body></html>`,
  ].join(""));
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  const broken = await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [...document.images].filter((image) => image.checkVisibility());
    await Promise.all(images.map((image) => image.decode().catch(() => null)));
    return images.filter((image) => !(image.complete && image.naturalWidth > 0)).map((image) => image.alt || image.src);
  });
  if (broken.length) throw new Error(`images not loaded: ${broken.join(", ")}`);
}

/**
 * Замеры снимка в видимой области вкладки и шапки дела: прокрутка вбок,
 * текст мельче 12 px, сплошной красный фон, цели нажатия ниже 44 px (ссылки,
 * кнопки, раскрытия и подписи-кнопки скрытых полей файла).
 */
function measure() {
  const root = document.querySelector("main") ?? document.body;
  const visible = (element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const described = (element) => (element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 48);
  const scope = [root, ...document.querySelectorAll(":popover-open")];
  const all = scope.flatMap((node) => [...node.querySelectorAll("*")]);
  const small = all.filter((element) => visible(element)
    && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
    && parseFloat(getComputedStyle(element).fontSize) < 12).map(described);
  const red = [...document.querySelectorAll("*")].filter((element) => visible(element)
    && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map(described);
  const targets = all.filter((element) => element.matches("a[href], button, summary, label:has(> input[type=file])") && visible(element)
    && !element.closest("[data-shell-nav], nav[aria-label='Разделы']"));
  const short = (element) => element.getBoundingClientRect().height < 44;
  const label = (element) => `${described(element)} (${Math.round(element.getBoundingClientRect().height)}px)`;
  // Полоса вкладок дела (40 px) — не этот срез: её высоту меняет Э8.4 (PLAN_CHANGES 28.09). Считается отдельно.
  const tabStrip = (element) => Boolean(element.closest("[data-tab-strip]"));
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    smallText: small,
    solidRed: red,
    smallTargets: targets.filter((element) => short(element) && !tabStrip(element)).map(label),
    tabStripShort: targets.filter((element) => short(element) && tabStrip(element)).length,
  };
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
  const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const SIZES = { 1440: DESKTOP, 1280: LAPTOP, 390: PHONE };
  // `ширина[-full]`; `do: "menu"` — открыть «⋯»; `open` сценария — открытая панель, прокрученная к себе.
  const shot = (suffix, extra = {}) => {
    const [width, full] = suffix.replace(/^[a-z-]+-(?=\d)/u, "").split("-");
    return { suffix, context: SIZES[width], full: full === "full", ...extra };
  };
  const plain = ["1440", "1440-full", "1280", "390", "390-full"].map((suffix) => shot(suffix));
  const PAGES = [
    ["curator-no-contract", [...plain, shot("menu-1440", { do: "menu" }), shot("menu-390", { do: "menu" })]],
    ["admin-same-currency", [...plain, shot("menu-1440", { do: "menu" }), shot("menu-390", { do: "menu" }),
      shot("obligations-1440", { panel: "money-obligations" }), shot("service-1440-full", { panel: "money-service" })]],
    ["admin-cross-currency", plain],
    ["admin-stop", [...plain, shot("stops-1440", { panel: "money-stops" }), shot("stops-390-full", { panel: "money-stops" })]],
    ["curator-template", ["1440", "1280", "390"].map((suffix) => shot(suffix))],
    ["admin-template", ["1440", "1280", "390"].map((suffix) => shot(suffix))],
    ["admin-template-source", ["1440", "390"].map((suffix) => shot(suffix))],
  ];
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const [name, shots] of PAGES) {
      const htmlPath = join(outDir, `money-${name}.html`);
      writeHtml(htmlPath, css, renderPage(name));
      for (const { suffix, context, full, do: action, panel } of shots) {
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await settle(page);
        const open = panel ?? SCENARIOS[name].open ?? null;
        if (open) {
          // Состояние листа после выбора пункта «⋯»: панель видна, лист прокручен к ней.
          await page.evaluate((id) => {
            const target = document.getElementById(id);
            if (!target) throw new Error(`no panel ${id}`);
            target.hidden = false;
            window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - 16), behavior: "instant" });
          }, open);
        } else {
          await page.evaluate(() => {
            const sheet = document.querySelector("[data-case-money]");
            if (!sheet) throw new Error("no money sheet");
            if (innerWidth < 768) window.scrollTo({ top: Math.max(0, sheet.getBoundingClientRect().top + window.scrollY - 72), behavior: "instant" });
          });
        }
        if (action === "menu") await page.click('[data-testid="v3-case-money-more"]');
        const metrics = await page.evaluate(measure);
        const file = `money-${name}-${suffix}.png`;
        // Во весь рост меню разделов (липкое, высотой в экран) — обычная колонка, как в case-static-render.
        if (full) await page.addStyleTag({ content: 'nav[aria-label="Разделы"] { position: static !important; height: auto !important; }' });
        await page.screenshot({ path: join(outDir, file), fullPage: full });
        if (errors.length) throw new Error(`${file}: browser errors: ${errors.join("; ")}`);
        report.push({ file, ...metrics });
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(outDir, "money-metrics.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const row of report) {
    process.stdout.write(`${row.file}: overflow ${row.overflow}px · text<12px ${row.smallText.length} · solid red ${row.solidRed.length}${row.solidRed.length ? ` (${row.solidRed.join(" | ")})` : ""} · targets<44px ${row.smallTargets.length}${row.smallTargets.length ? ` (${row.smallTargets.join(" | ")})` : ""} · tab strip <44px ${row.tabStripShort} (Э8.4)\n`);
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
  console.error("usage: case-money-static-render.cjs --json | --screenshots [outDir]");
  process.exit(2);
}
