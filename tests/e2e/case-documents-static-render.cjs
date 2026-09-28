"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require (тот же приём, что в
// case-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Вкладка «Документы» дела (Э8.1, `/v3/profile?case=…&tab=documents`).
 *
 * Страница — НАСТОЯЩАЯ сборка дела (`caseWorkParts`, `Profile` с вкладками,
 * `PartShell`, `AppShell`) с СИНТЕТИЧЕСКИМИ данными: имена, файлы и числа
 * выдуманы для проверки вёрстки и не являются записями EVO. Вкладка на
 * странице асинхронная (`Documents` читает базовые чек-листы), поэтому здесь
 * она рисуется синхронным видом `documentsView` с теми же входами. Живой
 * Supabase, права и хранилище этот рендер не проверяет.
 *
 *   node tests/e2e/case-documents-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — разметка вкладки по сценариям (для
 *       tests/v3-case-documents.test.mjs).
 *   node tests/e2e/case-documents-static-render.cjs --screenshots [outDir]
 *     → страница с оболочкой, CSS из globals.css + v3.css (Tailwind v4, как в
 *       сборке); вкладку поверх статической страницы рисует настоящий React
 *       (бандл esbuild): серверные действия и ответы загрузки — заглушки в
 *       браузере, по сценарию пункта. Снимки Playwright Chromium 1440×900,
 *       1280×800 и 390×844 в outDir (по умолчанию .impeccable/review), файлы
 *       `docs-<сценарий>-<ширина>.png`; для каждого — замеры: горизонтальное
 *       переполнение, текст мельче 12 px, сплошные красные заливки, цели
 *       нажатия ниже 44 px. Проверки поведения печатаются; нарушение — код 1.
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

// Вкладка страницы — async server component; здесь её место занимает тот же синхронный вид.
const documentsModule = require(join(ROOT, "src/components/v3/profile/Documents.tsx"));
const { documentsView } = require(join(ROOT, "src/components/v3/profile/DocumentsView.tsx"));
const { caseWorkParts } = require(join(ROOT, "src/components/v3/profile/CaseWorkParts.tsx"));
const { Profile } = require(join(ROOT, "src/components/v3/profile/Profile.tsx"));
const { buildV3ProfileHref } = require(join(ROOT, "src/components/v3/profile/types.ts"));
const queueView = require(join(ROOT, "src/components/v3/students/students-queue-view.ts"));

// --- синтетические данные ---------------------------------------------------
// «Сегодня» — 28.09.2026 по Бишкеку.
const TODAY = "2026-09-28";
const NOW = queueView.bishkekNoon(TODAY);
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const CASE_ID = "cccccccc-2222-4222-8222-000000000001";
const NAME = "Тестовый Студент";
const RETURN_TO = "/v3/profile?section=docs&view=review";
const uuid = (prefix, n) => `${prefix}-5555-4555-8555-${String(n).padStart(12, "0")}`;

const CURATOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, displayName: "Куратор (синтетический)", systemRole: "staff",
  platformAccessVersion: 1, email: "synthetic@example.invalid", presentationRole: null,
  assignments: [{ label: "Сотрудник поступления", scope: { kind: "own" } }],
  permissionKeys: ["case.read.full", "profile.read.full", "case.route.manage", "case.update.append", "document.read.full",
    "document.upload", "document.manage", "document.review", "document.download", "task.create", "task.manage",
    "staff.task.read", "staff.task.create", "team.chat.admissions"],
};
// Просмотр роли Admin: только чтение — ни загрузки, ни решений, ни правки чек-листа.
const PREVIEW = { ...CURATOR, systemRole: "admin", presentationRole: "admissions", permissionKeys: [] };

const REVIEWER = { reviewerMembershipId: ME, reviewerDisplayName: "Куратор (синтетический)" };
function doc(n, fields) {
  const present = fields.status !== "required";
  const allowed = fields.allowed ?? true;
  return {
    id: uuid("88888888", n), name: fields.name, groupLabel: fields.group ?? "Документы", intentKind: fields.intent ?? "baseline",
    version: fields.version ?? 1, status: fields.status,
    uploadRequestId: allowed ? uuid("12000000", n) : null, metadataRequestId: allowed ? uuid("13000000", n) : null,
    removalRequestId: allowed ? uuid("14000000", n) : null, caseLinkTargets: fields.links ?? [],
    presence: present ? "present" : "absent",
    currentVersionId: present ? uuid("77777777", n) : null,
    downloadReady: present ? fields.ready ?? true : false,
    ...(present ? {
      currentVersionNumber: fields.versionNumber ?? 1, currentFilename: fields.file,
      currentVersionCreatedAt: fields.at,
      latestReview: fields.review ? { decision: fields.status, reason: fields.review.reason ?? null, ...REVIEWER, reviewedAt: fields.review.at } : null,
      reviewRequestId: allowed && fields.status === "submitted" ? uuid("15000000", n) : null,
    } : {}),
  };
}
const APPLICATION_LINK = { kind: "university_application", id: uuid("66666666", 1), label: "Шанхайский университет · 2027 · основной", linked: true, requestId: uuid("16000000", 1) };

function checklist(allowed = true) {
  return [
    { kind: "active", title: "Документы", items: [
      doc(1, { allowed, name: "Паспорт", status: "approved", file: "passport-scan.pdf", at: "2026-09-18T10:58:00.000Z",
        review: { at: "2026-09-19T04:10:00.000Z" } }),
      doc(2, { allowed, name: "Аттестат", status: "submitted", file: "attestat-s-prilozheniem-v2.pdf", versionNumber: 2, at: "2026-09-27T05:10:00.000Z" }),
      doc(3, { allowed, name: "Перевод аттестата", status: "submitted", ready: false, file: "perevod-attestata.pdf", at: "2026-09-28T03:40:00.000Z" }),
      doc(4, { allowed, name: "Фото 3×4", status: "correction_required", file: "foto.jpg", at: "2026-09-20T08:15:00.000Z",
        review: { reason: "Нужен светлый фон, без очков.", at: "2026-09-21T06:00:00.000Z" } }),
      doc(5, { allowed, name: "Мотивационное письмо", status: "rejected",
        file: "motivatsionnoe-pismo-dlya-postupleniya-na-programmu-mezhdunarodnaya-torgovlya-final-versiya-3.pdf",
        at: "2026-09-22T11:30:00.000Z", review: { reason: "Письмо написано для другого вуза — нужен текст для этой программы.", at: "2026-09-23T05:00:00.000Z" } }),
      doc(6, { allowed, name: "Медицинская справка", status: "required" }),
      doc(7, { allowed, name: "Справка о несудимости", status: "required" }),
    ] },
    { kind: "active", title: "Дополнительные документы", items: [
      doc(8, { allowed, name: "Выписка из банка", group: "Дополнительные документы", intent: "custom", status: "required", links: [APPLICATION_LINK] }),
      doc(9, { allowed, name: "Сертификат IELTS", group: "Дополнительные документы", intent: "custom", status: "approved",
        file: "ielts-6-5.pdf", at: "2025-12-03T08:00:00.000Z", review: { at: "2025-12-04T08:00:00.000Z" } }),
    ] },
    { kind: "removed", title: "Документы", items: [
      { id: uuid("88888888", 20), name: "Справка с места работы родителей", groupLabel: "Документы", intentKind: "custom",
        removedAt: "2026-09-24T09:00:00.000Z", removalReason: "Удаление пункта из активного чек-листа сотрудником",
        versions: [{ id: uuid("77777777", 20), versionNumber: 1, filename: "spravka-roditeli.pdf", submittedBy: "Куратор (синтетический)",
          submittedAt: "2026-09-15T07:30:00.000Z", downloadReady: true }] },
    ] },
  ];
}

const HANDOFF_PENDING = {
  organizationId: ORG, studentCaseId: CASE_ID, assignmentEventId: uuid("55555555", 1), canRespond: true, current: null,
  requestId: uuid("44444444", 1),
};
const HANDOFF_ACCEPTED = {
  ...HANDOFF_PENDING, canRespond: false,
  current: { acknowledgementId: uuid("33333333", 1), decision: "accepted", clarification: null, agreedContactDate: null, createdAt: "2026-09-21T04:00:00.000Z" },
};

function queueRow(flags) {
  return {
    studentCaseId: CASE_ID, studentDisplayName: NAME, state: "active", admissionsDirection: "CN",
    targetCountry: "CN", targetDegree: "Бакалавриат", pipelineStage: "documents", pipelineHidden: false,
    nextAction: "Собрать документы для подачи", nextActionDueOn: "2026-10-02",
    dueBand: queueView.caseNextActionBand("Собрать документы для подачи", "2026-10-02", NOW), admissionsVersion: "7",
    currentCuratorMembershipId: ME, currentCuratorDisplayName: "Куратор (синтетический)", isMine: true,
    attentionFlags: flags, overdueTaskCount: 0, documents: null,
    updatedAt: "2026-09-27T04:00:00.000000Z", cursor: `due|0|2026-10-02|${CASE_ID}`,
  };
}

function profile() {
  return {
    leadId: null, person: NAME, email: null, phone: null, student: true, stage: null, caseStatus: "active", source: null,
    qualification: null, arrived: "01.09.2026", nextAction: "Собрать документы для подачи", nextActionAt: null, handoff: null,
    applications: [], visa: [], financeStop: null, timeline: [],
  };
}

function draft(fields) {
  return {
    access: { documents: true, finance: false, studentProfile: true, contract: false },
    routeTarget: { leadId: null, studentCaseId: CASE_ID }, responsible: "Куратор (синтетический)", provider: null, person: [], study: [],
    profileFields: null, studentApplication: null, profileFieldSources: [], documents: fields.documents,
    otherFiles: [], budget: null, currency: null, payments: [], paid: null, remaining: null, paidPercent: null,
    admissions: {
      studentCaseId: CASE_ID, caseState: "active", isCabinetCase: false, direction: "CN", applications: [], visa: null, finance: null,
      requestIds: { createApplication: uuid("22222222", 1), applications: {}, applicationDetails: {}, createStops: {}, resolveStops: {}, partnerDetails: {}, changeStatus: {} },
    },
    contract: null, handoffAcknowledgement: fields.handoff, salesHandoffAcknowledgement: null,
    saleConditions: null, leadCabinetCase: null, contractSignedAt: null, handedOffBy: null,
  };
}

function work(flags) {
  return {
    row: queueRow(flags), tasks: { kind: "ready", tasks: [], assignees: [] }, chat: { kind: "ready", awaitState: "none", last: null },
    activity: { kind: "ready", olderThan: null, events: [] }, needsCurator: false, deletionRequested: false, today: TODAY, nowIso: NOW.toISOString(),
  };
}

/**
 * Сценарии вкладки. `filter` — `doc_state` адреса; `baseline` — чтение базовых
 * чек-листов (`Documents`): `options` — есть версия для применения, `absent` —
 * чтение пустое и шаблон не применён, `none` — нечего показывать (шаблон уже
 * применён или нет права).
 */
const SCENARIOS = {
  // Куратор, дело ждёт его ответа: единственный сплошной красный — «Принять дело» в шапке.
  "all": { actor: CURATOR, handoff: HANDOFF_PENDING, flags: ["awaiting_ack"], documents: checklist(), filter: "all", baseline: "none" },
  // Тот же чек-лист с фильтром «На проверке».
  "review": { actor: CURATOR, handoff: HANDOFF_ACCEPTED, flags: [], documents: checklist(), filter: "review", baseline: "none" },
  // Фильтр без строк: одно пустое состояние со ссылкой «Показать все».
  "filter-empty": { actor: CURATOR, handoff: HANDOFF_ACCEPTED, flags: [], filter: "accepted", baseline: "absent",
    documents: [{ kind: "active", title: "Документы", items: [doc(6, { name: "Медицинская справка", status: "required" })] }] },
  // Пустой чек-лист: без чисел, формы «+ Документ» открыты сразу, базовый чек-лист можно применить.
  "empty": { actor: CURATOR, handoff: HANDOFF_ACCEPTED, flags: [], documents: [], filter: "all", baseline: "options" },
  // Просмотр роли: только чтение.
  "preview": { actor: PREVIEW, handoff: HANDOFF_ACCEPTED, flags: [], documents: checklist(false), filter: "all", baseline: "none" },
};

function hrefFor(tab) {
  return `${buildV3ProfileHref({ leadId: null, studentCaseId: CASE_ID }, tab)}&section=docs&returnTo=${encodeURIComponent(RETURN_TO)}`;
}

/** Входы `documentsView` — как их собирает `Documents` из чтения и прав (Profile.tsx). */
function tabInput(name) {
  const scenario = SCENARIOS[name];
  const preview = scenario.actor.presentationRole !== null;
  const uploadAccess = preview ? "forbidden" : "allowed";
  const allowed = uploadAccess === "allowed";
  return {
    groups: scenario.documents, uploadAccess, studentCaseId: CASE_ID,
    recognition: preview ? null : { studentCaseId: CASE_ID, profileRevision: null, canEnqueue: false, reviewHref: hrefFor("anketa") },
    filter: scenario.filter, tabHref: hrefFor("documents"), today: TODAY,
    createRequestId: allowed ? uuid("17000000", 1) : null,
    baselineOptions: allowed && scenario.baseline === "options"
      ? [{ countryRequirementVersionId: uuid("18000000", 1), label: "CN · bachelor · версия 3 — 7 документов" }] : [],
    baselineOptionsUnavailable: false,
    baselineTemplatesAbsent: allowed && scenario.baseline === "absent",
    baselineChecklistRequestId: allowed && scenario.baseline === "options" ? uuid("19000000", 1) : null,
  };
}

const TAB_ROOT = "case-documents-root";
// Вид вкладки вместо async `Documents` (входы — из сценария текущего рендера).
let currentScenario = "all";
documentsModule.Documents = () => createElement("div", { id: TAB_ROOT }, documentsView(tabInput(currentScenario)));

function buildPage(name) {
  const scenario = SCENARIOS[name];
  const caseDraft = draft({ documents: scenario.documents, handoff: scenario.handoff });
  const preview = scenario.actor.presentationRole !== null;
  const editor = { admin: false, preview, routeManage: true, broadScope: false };
  const caseWork = work(scenario.flags);
  const parts = caseWorkParts({
    actor: scenario.actor, profile: profile(), draft: caseDraft, sales: null, work: caseWork,
    stepAccess: queueView.nextStepAccess(editor, caseWork.row, []),
    requestIds: {
      contract: uuid("12121212", 1), firstPayment: uuid("12121212", 2), override: uuid("12121212", 3), handoff: uuid("12121212", 4),
      platformAccess: uuid("12121212", 5), saleConditions: uuid("12121212", 6), prepareLeadCabinet: uuid("12121212", 7),
      wishesCard: uuid("12121212", 8), educationCard: uuid("12121212", 9), conditionsCard: uuid("12121212", 10),
      step: uuid("12121212", 11), assignCurator: uuid("12121212", 12), portal: uuid("12121212", 13), note: uuid("12121212", 14),
    },
    notes: { subject: { leadId: null, studentCaseId: CASE_ID }, rows: [] }, notesOlderHref: null, notesLatestHref: null,
    curators: [], curatorsAvailable: true, hrefFor, salesDataOpen: false, help: null, closure: null,
  });
  currentScenario = name;
  const body = createElement(Profile, {
    profile: profile(), draft: caseDraft, sales: null, actor: scenario.actor, organizationId: ORG,
    studentPortalCurators: [], studentPortalCuratorsAvailable: true,
    requestIds: { contract: "", firstPayment: "", override: "", handoff: "", platformAccess: "", saleConditions: "", prepareLeadCabinet: "", wishesCard: "", educationCard: "", conditionsCard: "" },
    noteRequestId: uuid("12121212", 15), notes: { subject: { leadId: null, studentCaseId: CASE_ID }, rows: [] },
    notesOlderHref: null, notesLatestHref: null, tab: "documents", hrefFor, documentsFilter: scenario.filter,
    caseHeader: parts.header, caseOverview: parts.overview,
  });
  return { actions: parts.actions, body };
}

const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
function withContexts(node, search) {
  return createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: "/v3/profile" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}
const searchOf = (name) => `case=${CASE_ID}&tab=documents&section=docs${SCENARIOS[name].filter === "all" ? "" : `&doc_state=${SCENARIOS[name].filter}`}`;

/** Разметка только вкладки (SSR, до гидратации) — для unit-теста. */
function renderTab(name) {
  currentScenario = name;
  return renderToStaticMarkup(withContexts(documentsView(tabInput(name)), searchOf(name)));
}

function renderPage(name) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const { Icon } = require(join(ROOT, "src/components/icons.tsx"));
  const back = createElement("a", { href: RETURN_TO, className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    createElement(Icon, { name: "arrow-left", size: 16 }), "EVO Docs");
  const { actions, body } = buildPage(name);
  const page = createElement("div", { className: "v3-world", "data-surface": "staff" },
    createElement(AppShell, { actor: SCENARIOS[name].actor, initialNotifications: null },
      createElement(PartShell, { title: NAME, count: null, dense: true, back, action: actions }, createElement("div", { className: "space-y-6" }, body))));
  return renderToStaticMarkup(withContexts(page, searchOf(name)));
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

// --- вкладка на настоящем React в браузере --------------------------------------
// Серверные действия — заглушки: решение по документу записывается и отвечает
// «сохранено» (или ответом из `__docs.reviewPlan` по пункту); команды чек-листа
// возвращают прежнее состояние. Загрузка — заглушка `fetch`: ответ по плану
// пункта (синтетика), запрос записывается. Перечтение страницы по умолчанию
// данных не меняет; с `__docs.applyDecisions` сохранённое решение переводит
// пункт в новое состояние без ключа решения — как настоящее перечтение.
const CLIENT_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { documentsView } = require("@/components/v3/profile/DocumentsView");
const h = React.createElement;
const fixture = JSON.parse(document.getElementById("docs-fixture").textContent);
window.__docs = { uploads: [], reviews: [], refreshes: 0, reviewPlan: {}, applyDecisions: false };
let input = fixture.input;
function applyDecisions() {
  const decided = new Map(window.__docs.reviews.filter((entry) => entry.outcome === "saved").map((entry) => [entry.document_slot_id, entry]));
  input = { ...input, groups: input.groups.map((group) => group.kind !== "active" ? group : { ...group, items: group.items.map((item) => {
    const entry = decided.get(item.id);
    return entry ? { ...item, status: entry.decision, reviewRequestId: null, latestReview: { decision: entry.decision, reason: entry.reason || null,
      reviewerMembershipId: "aaaaaaaa-1111-4111-8111-000000000001", reviewerDisplayName: "Куратор (синтетический)", reviewedAt: "2026-09-28T06:00:00.000Z" } } : item;
  }) }) };
}
const router = {
  refresh() {
    window.__docs.refreshes += 1;
    if (window.__docs.applyDecisions) { applyDecisions(); render(); }
  },
  push() {}, replace() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
};
window.fetch = async (url, init) => {
  const path = String(url);
  const upload = /\\/api\\/v2\\/document-slots\\/([^/]+)\\/versions$/.exec(path);
  if (upload) {
    const slot = upload[1];
    const body = init.body;
    window.__docs.uploads.push({ slot, keys: [...body.keys()].sort(), name: body.get("file").name, requestId: body.get("request_id") });
    const plan = fixture.uploadPlan[slot] ?? { status: 201 };
    await new Promise((done) => setTimeout(done, plan.delay ?? 300));
    if (plan.status === 201) {
      return new Response(JSON.stringify({ document: { documentSlotId: slot, documentVersionId: "99999999-5555-4555-8555-000000000001", versionNumber: 1 } }), { status: 201 });
    }
    return new Response(JSON.stringify({ error: plan.code }), { status: plan.status });
  }
  if (/document-recognition-jobs/.test(path)) return new Response(JSON.stringify({ jobs: [], next_cursor: null }), { status: 200 });
  throw new TypeError("offline harness: " + path);
};
const root = createRoot(document.getElementById("${TAB_ROOT}"));
function render() {
  root.render(
    h(AppRouterContext.Provider, { value: router },
      h(PathnameContext.Provider, { value: "/v3/profile" },
        h(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) }, documentsView(input)))));
}
render();
`;

async function bundleClient(outDir) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "documents-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_t, key) => key });", loader: "js" }));
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return {
          contents: names.map((name) => name === "reviewPlatformDocumentAction"
            ? `export async function ${name}(form) { const entry = Object.fromEntries(form.entries()); window.__docs.reviews.push(entry); await new Promise((done) => setTimeout(done, 200)); entry.outcome = window.__docs.reviewPlan[entry.document_slot_id] ?? "saved"; return entry.outcome; }`
            : `export async function ${name}(previous) { return previous; }`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  const bundle = join(outDir, "docs-client.js");
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "docs-entry.js", loader: "js" },
    bundle: true, outfile: bundle, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("production") },
    banner: { js: "var process = globalThis.process || { env: {} };" }, plugins: [plugin], logLevel: "error",
  });
  return bundle;
}

// Планы ответов загрузки по пунктам (сценарий «all»): успех с задержкой, 413, 503.
const UPLOAD_PLAN = {
  [uuid("88888888", 6)]: { status: 201, delay: 1500 },
  [uuid("88888888", 7)]: { status: 413, code: "file_too_large" },
  [uuid("88888888", 8)]: { status: 503, code: "storage_unavailable" },
  [uuid("88888888", 4)]: { status: 422, code: "malware_detected" },
};

function writeHtml(path, css, markup, fixture) {
  writeFileSync(path, [
    "<!DOCTYPE html>",
    '<html lang="ru" data-theme="light" class="h-full antialiased">',
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Дело студента — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
    `<body class="min-h-full">${markup}<script type="application/json" id="docs-fixture">${JSON.stringify(fixture).replaceAll("<", "\\u003c")}</script>`,
    '<script src="docs-client.js"></script></body></html>',
  ].join(""));
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [...document.images].filter((image) => image.checkVisibility());
    await Promise.all(images.map((image) => image.decode().catch(() => null)));
  });
}

/** Замеры страницы: переполнение, мелкий текст, сплошные красные, цели нажатия (во вкладке). */
function measure(page) {
  return page.evaluate((rootId) => {
    const root = document.getElementById(rootId);
    const visible = (element) => {
      if (!element.checkVisibility()) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    };
    const RED = "rgb(215, 2, 23)";
    const reds = [...document.querySelectorAll("body *")].filter((element) => visible(element) && getComputedStyle(element).backgroundColor === RED);
    const smallText = [...document.querySelectorAll("body *")].filter((element) => visible(element)
      && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
      && parseFloat(getComputedStyle(element).fontSize) < 12);
    const targets = root ? [...root.querySelectorAll("a[href], button, select, textarea, input:not([type=hidden]):not(.sr-only), label:has(> input[type=file])")]
      .filter((element) => visible(element)) : [];
    const small = targets.filter((element) => {
      if (element.matches('input[type="checkbox"]')) return false; // флажок — внутри своей строки-подписи 44 px
      return element.getBoundingClientRect().height < 44;
    });
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      smallText: smallText.map((element) => element.textContent.trim().slice(0, 20)),
      solidRed: reds.map((element) => `${element.tagName.toLowerCase()}:${element.textContent.trim().slice(0, 20)}`),
      smallTargets: small.map((element) => `${element.tagName.toLowerCase()}:${(element.getAttribute("aria-label") ?? element.textContent).trim().slice(0, 24)}:${Math.round(element.getBoundingClientRect().height)}`),
      targets: targets.length,
    };
  }, TAB_ROOT);
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  await bundleClient(outDir);
  const css = await compileCss();
  const pages = {};
  for (const name of Object.keys(SCENARIOS)) {
    const htmlPath = join(outDir, `docs-${name}.html`);
    writeHtml(htmlPath, css, renderPage(name), { input: tabInput(name), search: searchOf(name), uploadPlan: UPLOAD_PLAN });
    pages[name] = htmlPath;
  }
  const SIZES = {
    1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  };
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const failures = [];
  const check = (ok, what) => { process.stdout.write(`${ok ? "ok" : "FAIL"} — ${what}\n`); if (!ok) failures.push(what); };
  const open = async (name, width) => {
    const context = await browser.newContext(SIZES[width]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(pages[name]).href, { waitUntil: "load" });
    await page.locator(`#${TAB_ROOT} [data-testid="v3-case-documents"]`).waitFor();
    // Гидратация вкладки: поле файла и «+ Документ» доступны только после неё.
    await page.waitForFunction((rootId) => {
      const toggle = document.querySelector(`#${rootId} [data-testid="v3-document-add-toggle"]`);
      return !toggle || !toggle.disabled;
    }, TAB_ROOT);
    await settle(page);
    return { context, page, errors };
  };
  // Во весь рост меню разделов (липкое, высотой в экран) — обычная колонка во всю высоту.
  const STATIC_NAV = 'nav[aria-label="Разделы"] { position: static !important; height: auto !important; }';
  const shot = async (page, file, { full = false, at = null } = {}) => {
    if (full) {
      await page.addStyleTag({ content: STATIC_NAV });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    } else if (at) {
      await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 16), behavior: "instant" });
      }, at);
    }
    await page.waitForTimeout(150);
    const metrics = await measure(page);
    await page.screenshot({ path: join(outDir, file), fullPage: full });
    process.stdout.write(`${file}: overflow=${metrics.overflow} smallText=${metrics.smallText.length}${metrics.smallText.length ? `[${metrics.smallText.join("|")}]` : ""} `
      + `solidRed=${metrics.solidRed.length}[${metrics.solidRed.join("|")}] smallTargets=${metrics.smallTargets.length}${metrics.smallTargets.length ? `[${metrics.smallTargets.join("|")}]` : ""} targets=${metrics.targets}\n`);
    return metrics;
  };
  const row = (page, n) => page.locator(`#document-${uuid("88888888", n)}`);
  try {
    for (const width of [1440, 1280, 390]) {
      // Все состояния: вид экрана у вкладки и во весь рост.
      {
        const { context, page, errors } = await open("all", width);
        const top = await shot(page, `docs-all-${width}.png`, { at: "#case-documents-title" });
        check(top.overflow === 0, `${width} all: no horizontal overflow`);
        check(top.smallText.length === 0, `${width} all: no text below 12px`);
        check(top.solidRed.length <= 1, `${width} all: at most one solid red (${top.solidRed.join("|") || "none"})`);
        check(top.smallTargets.length === 0, `${width} all: tap targets ≥ 44px (${top.smallTargets.join("|") || "all"})`);
        const full = await shot(page, `docs-all-${width}-full.png`, { full: true });
        check(full.solidRed.length === 1 && full.solidRed[0].includes("Принять дело"), `${width} all: the one solid red is «Принять дело» (${full.solidRed.join("|")})`);
        check(full.smallTargets.length === 0, `${width} all full: tap targets ≥ 44px (${full.smallTargets.join("|") || "all"})`);
        check(errors.length === 0, `${width} all: no browser errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
        await context.close();
      }
      for (const name of ["review", "filter-empty", "empty", "preview"]) {
        const { context, page, errors } = await open(name, width);
        const metrics = await shot(page, `docs-${name}-${width}.png`, { at: "#case-documents-title" });
        check(metrics.overflow === 0 && metrics.smallText.length === 0 && metrics.smallTargets.length === 0,
          `${width} ${name}: no overflow, no text < 12px, tap targets ≥ 44px`);
        check(metrics.solidRed.length === 0, `${width} ${name}: no solid red (${metrics.solidRed.join("|") || "none"})`);
        check(errors.length === 0, `${width} ${name}: no browser errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
        await context.close();
      }
    }

    // Действия строки и загрузка — на настоящем React (1440 и 390).
    for (const width of [1440, 390]) {
      const { context, page, errors } = await open("all", width);
      // «⋯» строки «Аттестат»: редкие действия.
      await row(page, 2).getByTestId("v3-document-menu").click();
      const menuItems = await row(page, 2).locator("[popover] :is(a,button)").allTextContents();
      check(JSON.stringify(menuItems) === JSON.stringify(["Скачать", "Заменить файл", "Изменить пункт", "Убрать из чек-листа…", "Распознавание"]),
        `${width}: «⋯» lists the rare actions (${menuItems.join(", ")})`);
      await shot(page, `docs-menu-${width}.png`, { at: `#document-${uuid("88888888", 2)}` });
      await page.keyboard.press("Escape");
      // «Вернуть…»: причина для студента, два решения; «Принять» — тёмная, не красная.
      const approveBg = await row(page, 2).getByTestId("v3-document-approve").evaluate((element) => getComputedStyle(element).backgroundColor);
      check(approveBg !== "rgb(215, 2, 23)", `${width}: «Принять» is dark neutral (${approveBg})`);
      await row(page, 2).getByTestId("v3-document-return").click();
      await row(page, 2).getByRole("textbox", { name: "Что нужно исправить" }).fill("Нужна страница с печатью школы.");
      await shot(page, `docs-return-${width}.png`, { at: `#document-${uuid("88888888", 2)}` });
      await row(page, 2).getByRole("button", { name: "Вернуть на исправление", exact: true }).click();
      await page.waitForFunction(() => window.__docs.reviews.length === 1);
      await row(page, 2).getByText("Решение сохранено. Данные документа обновляются.").waitFor();
      const review = await page.evaluate(() => window.__docs.reviews[0]);
      check(await row(page, 2).getByTestId("v3-document-panel").count() === 0, `${width}: a saved decision closes the panel`);
      check(review.decision === "correction_required" && review.reason === "Нужна страница с печатью школы." && review.request_id === uuid("15000000", 2),
        `${width}: «Вернуть на исправление» sends the existing review command with the reason (${review.decision})`);
      // «Принять» одним нажатием у другой строки нельзя: файл «Перевода аттестата» ещё проверяется.
      check(await row(page, 3).getByTestId("v3-document-approve").isDisabled(), `${width}: «Принять» waits for the file check`);
      // «+ Документ» раскрывает формы.
      await page.getByTestId("v3-document-add-toggle").click();
      check(await page.getByTestId("v3-document-checklist-create").isVisible(), `${width}: «+ Документ» reveals the create form`);
      await shot(page, `docs-add-${width}.png`, { at: "#case-documents-title" });
      await page.getByTestId("v3-document-add-toggle").click();
      // Загрузка: HEIC — отказ до отправки; PDF — сразу после выбора, «Загружаем…», затем «загружен».
      const input = (n) => row(page, n).locator('input[name="file"]');
      await input(6).setInputFiles({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: Buffer.from("synthetic") });
      const heic = await row(page, 6).getByTestId("v3-document-upload-status").textContent();
      check(/HEIC/.test(heic) && (await page.evaluate(() => window.__docs.uploads.length)) === 0, `${width}: HEIC is refused before sending (${heic})`);
      await input(6).setInputFiles({ name: "med-spravka.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 synthetic") });
      await row(page, 6).getByText("Загружаем…").waitFor();
      await shot(page, `docs-upload-busy-${width}.png`, { at: `#document-${uuid("88888888", 6)}` });
      await row(page, 6).locator('[data-testid="v3-document-upload-status"][data-outcome="saved"]').waitFor();
      const sent = await page.evaluate(() => window.__docs.uploads[0]);
      check(JSON.stringify(sent.keys) === JSON.stringify(["file", "request_id"]) && sent.requestId === uuid("12000000", 6),
        `${width}: the upload starts on file choice with exactly file + request_id (${sent.keys.join(",")})`);
      check(await page.evaluate(() => window.__docs.refreshes) >= 1, `${width}: a confirmed upload refreshes the page`);
      // 413 и 503: свои слова; у 503 — «Повторить».
      await input(7).setInputFiles({ name: "spravka.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 synthetic") });
      await row(page, 7).locator('[data-testid="v3-document-upload-status"][data-outcome="invalid"]').waitFor();
      await input(8).setInputFiles({ name: "vypiska.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 synthetic") });
      await row(page, 8).locator('[data-testid="v3-document-upload-status"][data-outcome="unavailable"]').waitFor();
      const words = [await row(page, 7).getByTestId("v3-document-upload-status").textContent(), await row(page, 8).getByTestId("v3-document-upload-status").textContent()];
      check(/25 МБ/.test(words[0]) && /Не удалось загрузить/.test(words[1]) && await row(page, 8).getByRole("button", { name: "Повторить", exact: true }).isVisible(),
        `${width}: 413 and 503 get their own words, 503 offers «Повторить» (${words.join(" / ")})`);
      await shot(page, `docs-upload-${width}.png`, { at: `#document-${uuid("88888888", 6)}` });
      check(errors.length === 0, `${width}: no browser errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
      await context.close();
    }

    // Перечтение после решения (1440): строка берёт новое состояние, под фильтром — уходит и называет, куда.
    {
      const { context, page, errors } = await open("all", 1440);
      // «Принять» и «Вернуть…» стоят на одном месте и у строки, чей файл ещё проверяется (место «Просмотреть» держится).
      const x = async (n, id) => Math.round((await row(page, n).getByTestId(id).boundingBox()).x);
      check(await x(2, "v3-document-approve") === await x(3, "v3-document-approve") && await x(2, "v3-document-return") === await x(3, "v3-document-return"),
        "1440: «Принять»/«Вернуть…» keep their x without «Просмотреть»");
      await page.evaluate(() => { window.__docs.applyDecisions = true; });
      await row(page, 2).getByTestId("v3-document-approve").click();
      await page.locator(`#document-${uuid("88888888", 2)}[data-document-status="approved"]`).waitFor();
      check(await row(page, 2).getByTestId("v3-document-approve").count() === 0 && await row(page, 2).getByText(/Решение сохранено/).count() === 0,
        "1440: after the re-read the decided row shows its new state, no decision buttons and no «сохранено»");
      check(errors.length === 0, `1440 re-read: no browser errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
      await context.close();
    }
    {
      const { context, page, errors } = await open("review", 1440);
      await page.evaluate(() => { window.__docs.applyDecisions = true; });
      await row(page, 2).getByTestId("v3-document-approve").click();
      await page.getByTestId("v3-document-moved").waitFor();
      const moved = await page.getByTestId("v3-document-moved").textContent();
      check(moved === "Документ «Аттестат» перенесён в «Принято»." && await row(page, 2).count() === 0,
        `1440 review: the decided row leaves the filter and one quiet line says where (${moved})`);
      await shot(page, "docs-moved-1440.png", { at: "#case-documents-title" });
      check(errors.length === 0, `1440 moved: no browser errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
      await context.close();
    }
    {
      // Отказ сервера в данных «Принять» — не просьба о причине.
      const { context, page, errors } = await open("all", 1440);
      await page.evaluate((slot) => { window.__docs.reviewPlan[slot] = "invalid"; }, uuid("88888888", 2));
      await row(page, 2).getByTestId("v3-document-approve").click();
      await row(page, 2).getByText("Решение не принято сервером. Обновите страницу.").waitFor();
      check(await row(page, 2).getByText(/Укажите причину/).count() === 0 && await row(page, 2).getByRole("button", { name: "Обновить страницу", exact: true }).isVisible(),
        "1440: an invalid «Принять» asks to refresh, not for a reason");
      check(errors.length === 0, `1440 invalid: no browser errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    process.stdout.write(`${failures.length} check(s) failed\n`);
    process.exit(1);
  }
}

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(Object.keys(SCENARIOS).map((name) => ({ name, html: renderTab(name) }))));
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: case-documents-static-render.cjs --json | --screenshots [outDir]");
  process.exit(2);
}
