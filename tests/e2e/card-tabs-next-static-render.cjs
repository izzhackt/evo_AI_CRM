"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Новый вид», поток «card-tabs»: вкладки карточки лида и дела (`/v3/profile?case=…&tab=…`, `?id=…&tab=…`) кроме «Обзора»:
 * «Документы», «Договор и оплата», «Вузы и программы», «Анкета», «История» и закрытый лид. НАСТОЯЩАЯ сборка страницы
 * (`Profile` с `nextUi`, `ProfileNextShell`, `AppShell` с переключателем) на СИНТЕТИЧЕСКИХ данных (`card-tabs-fixtures.cjs`):
 * имена и суммы выдуманы для проверки вёрстки. Живой Supabase и права не проверяются; чтения страницы здесь заменены данными
 * сценария (асинхронные вкладки - тем же синхронным видом: `documentsView`, `AgreementNextView`, `AnketaOtherFacts`).
 *
 *   node tests/e2e/card-tabs-next-static-render.cjs --json
 *     → stdout: JSON [{ name, html, legacy }] — разметка вкладки в новом виде (`html`) и в прежнем (`legacy`, тот же `Profile`
 *       без `nextUi`) без оболочки; для tests/ui-next-card-tabs.test.mjs.
 *   node tests/e2e/card-tabs-next-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900, 1280×800, 390×844 (во весь рост) нового вида и 1440/390 прежнего («до») и проверки
 *       (JSON-строки, при нарушении код 1): нет боковой прокрутки на 1440/1280/390/360/320, один `h1` с именем, кнопки ≥ 44 px,
 *       карточки без вложенных, axe, ряд вкладок и свои проверки каждой вкладки; затем клиентская сборка: панель «Ещё N»
 *       истории, «⋯» листа «Договор и оплата» (панели, якорь, фокус) и «+ Документ». По умолчанию outDir — .impeccable/review.
 */

const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { lazySettled } = require("./lazy-settled.cjs");

const fx = require("./card-tabs-fixtures.cjs");
const leads = require("./numbers-static-render.cjs");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const { ROOT, ORG, uuid, CASE_ID, LEAD_ID, ADMIN, TODAY } = fx;
const src = (path) => require(join(ROOT, "src", path));
// Тот же стенд гоняют на базовом коммите для сравнения прежнего вида: новых файлов вкладок там нет.
const optional = (path) => { try { return src(path); } catch { return null; } };
const h = createElement;
const PREVIEW = { ...ADMIN, presentationRole: "admissions", permissionKeys: [] };

// --- замена асинхронных чтений синхронным видом того же экрана ------------------------------
let current = null;
const documentsModule = src("components/v3/profile/Documents.tsx");
const { documentsView } = src("components/v3/profile/DocumentsView.tsx");
documentsModule.Documents = (props) => documentsView({
  groups: props.groups, uploadAccess: props.uploadAccess, studentCaseId: props.studentCaseId, recognition: props.recognition, filter: props.filter ?? "all",
  tabHref: props.tabHref, today: TODAY, createRequestId: props.uploadAccess === "allowed" ? uuid("17000000", 1) : null,
  baselineOptions: props.uploadAccess === "allowed" && current.baseline === "options" ? [{ countryRequirementVersionId: uuid("18000000", 1), label: "CN · bachelor · версия 3 — 7 документов" }] : [],
  baselineOptionsUnavailable: false, baselineTemplatesAbsent: props.uploadAccess === "allowed" && current.baseline === "absent",
  baselineChecklistRequestId: props.uploadAccess === "allowed" && current.baseline === "options" ? uuid("19000000", 1) : null, nextUi: props.nextUi,
});
const agreementModule = src("components/v3/profile/CaseAgreementBlock.tsx");
agreementModule.CaseAgreementBlock = (props) => h(agreementModule.CaseAgreementView, { agreement: current.agreement, canWrite: true, today: TODAY,
  saleConditionsHref: props.saleConditionsHref, financeStop: props.financeStop, stopsPanel: props.stopsPanel });
const nextAgreement = optional("components/v3/profile/next/tabs/MoneyAgreementNext.tsx");
if (nextAgreement) {
  nextAgreement.CaseAgreementNext = (props) => h(nextAgreement.AgreementNextView, { agreement: current.agreement, canWrite: true, today: TODAY,
    saleConditionsHref: props.saleConditionsHref, financeStop: props.financeStop, stopsPanel: props.stopsPanel });
}
const note = (text) => () => h("p", { className: "py-2 t-body-compact text-fg-2" }, text);
src("components/v3/profile/FinanceEntryWorkspace.tsx").FinanceEntryWorkspace = note("Формы операций — отдельное чтение; в статическом рендере не читаются.");
src("components/v3/profile/ProfileAmoCrmCommandSection.tsx").ProfileAmoCrmCommandSection = note("Команда amoCRM — отдельное чтение; в статическом рендере не читается.");
src("components/v3/profile/LeadInterestSummary.tsx").LeadInterestSummary = () => h("p", { className: "px-4 py-3 text-sm text-fg-2" }, "Интересующее направление: ", h("span", { className: "text-fg" }, "Малайзия"));
const otherFacts = optional("components/v3/profile/next/tabs/AnketaOtherFacts.tsx");
if (otherFacts) otherFacts.AnketaOtherFactsLoader = (props) => h(otherFacts.AnketaOtherFacts, { ...props, interest: { status: "value", direction: "Малайзия" } });
// Вкладка «Вузы и программы» страницы - async; здесь тот же синхронный вид с данными сценария.
const programsModule = src("components/v3/profile/UniversityProgramsTab.tsx");
programsModule.UniversityProgramsTab = (props) => h(programsModule.UniversityProgramsView, { ...props, partnerDetails: current.applications ? [] : fx.ROUTE.partner,
  preparations: { status: "ready", value: current.applications ? [] : fx.ROUTE.preparations }, packets: fx.ROUTE.packets, nowIso: new Date(`${TODAY}T08:00:00.000Z`).toISOString() });

// --- сценарии ---------------------------------------------------------------------------------
const EMPTY_IDS = Object.fromEntries(["contract", "firstPayment", "override", "handoff", "platformAccess", "saleConditions", "prepareLeadCabinet", "wishesCard", "educationCard", "conditionsCard"].map((key) => [key, ""]));
const forApplications = (applications, base) => Object.fromEntries(applications.map((row, n) => [row.universityApplicationId, uuid(base, n + 1)]));

/** Что менять в данных дела для вкладки: каждая функция получает прежние `profile` и `draft` сценария «admin». */
const TABS = {
  documents: (state) => ({ draft: { ...state.draft, documents: state.docs ?? fx.docChecklist(true) } }),
  money: (state) => ({
    profile: { ...state.profile, financeStop: state.stop ? fx.STOP.reason : null },
    draft: { ...state.draft, access: { ...state.draft.access, finance: true, contract: true }, contract: { workspace: fx.contractWorkspace(true), handoff: fx.HANDOFF_CTX },
      admissions: { ...state.draft.admissions, finance: fx.financeControl(state.stop) }, budget: "1 500 $", paid: "600 $", remaining: "900 $",
      payments: [{ name: "Первый платёж", amount: "600 $", state: "paid", at: "2026-09-12T08:00:00.000Z" }, { name: "Второй платёж — после оффера", amount: "900 $", state: "overdue", at: "2026-09-20T18:00:00.000Z" }] },
  }),
  route: (state) => {
    const applications = state.applications ?? fx.ROUTE.applications;
    const ids = state.draft.admissions.requestIds;
    return { draft: { ...state.draft, admissions: { ...state.draft.admissions, applications, requestIds: { ...ids, applications: forApplications(applications, "23232323"),
      applicationDetails: forApplications(applications, "24242424"), partnerDetails: forApplications(applications, "25252525"), changeStatus: forApplications(applications, "26262626") } } } };
  },
  anketa: (state) => ({
    profile: { ...state.profile, qualification: state.simple ? "Квалифицирован: 11 класс, IELTS 6.0, Малайзия, осень 2027." : null },
    draft: { ...state.draft, studentApplication: state.simple ? null : fx.STUDENT_APPLICATION, profileFields: state.simple ? null : fx.profileFields(),
      person: [{ label: "Дата рождения", value: "12.04.2008" }, { label: "Гражданство", value: "Кыргызстан" }], study: [{ label: "Направление", value: "Информатика и IT" }, { label: "Бюджет", value: "5–10 тыс. $ в год" }] },
  }),
  history: (state) => ({
    profile: { ...state.profile, source: "website", arrived: "01.09.2026", handoff: { at: "30.08 06:00", contract: true, payment: true, override: false },
      timeline: state.timeline ?? fx.TIMELINE, timelineForbidden: Boolean(state.forbidden),
      timelineOlderHref: state.timeline === undefined && !state.forbidden ? `/v3/profile?case=${CASE_ID}&tab=history&activity_before_at=2026-08-28T09%3A00%3A00.000Z&activity_before_id=x` : null },
  }),
};

const CASE_DEFS = [
  { name: "docs-all", tab: "documents", baseline: "none" },
  { name: "docs-review", tab: "documents", filter: "review", baseline: "none" },
  { name: "docs-empty", tab: "documents", docs: [], baseline: "options" },
  { name: "docs-preview", tab: "documents", actor: PREVIEW, docs: fx.docChecklist(false) },
  { name: "money-same", tab: "money", agreement: fx.AGREEMENTS.same },
  { name: "money-cross", tab: "money", agreement: fx.AGREEMENTS.cross, stop: true },
  { name: "money-empty", tab: "money", agreement: fx.AGREEMENTS.empty },
  { name: "route-four", tab: "route" },
  { name: "route-empty", tab: "route", applications: [] },
  { name: "anketa-full", tab: "anketa" },
  { name: "anketa-simple", tab: "anketa", simple: true },
  { name: "history-long", tab: "history" },
  { name: "history-short", tab: "history", timeline: fx.TIMELINE.slice(0, 4) },
  { name: "history-forbidden", tab: "history", timeline: [], forbidden: true },
];

function caseScenario(def) {
  const admin = fx.SCENARIOS.admin;
  const actor = def.actor ?? admin.actor;
  const patch = TABS[def.tab]({ ...def, profile: admin.profile, draft: admin.draft, actor });
  // Шапка карточки считается из тех же данных вкладки (числа документов и оплаты в сводке сходятся с вкладкой).
  fx.SCENARIOS[`tab-${def.name}`] = { ...admin, actor, profile: patch.profile ?? admin.profile, draft: patch.draft ?? admin.draft };
  const { item, parts, hrefFor } = fx.buildParts(`tab-${def.name}`);
  const { caseNextParts } = src("components/v3/profile/next/CaseNext.tsx");
  const profile = item.profile;
  const draft = item.draft;
  const props = { profile, draft, sales: item.sales, actor, organizationId: ORG, studentPortalCurators: [], studentPortalCuratorsAvailable: true, requestIds: EMPTY_IDS,
    noteRequestId: uuid("12121212", 15), notes: item.notes ?? fx.NOTES, notesOlderHref: null, notesLatestHref: null, tab: def.tab, hrefFor, documentsFilter: def.filter ?? "all" };
  const routeTab = (nextUi) => def.tab === "route" ? { universityProgramsTab: h(src("components/v3/profile/UniversityProgramsTab.tsx").UniversityProgramsView, {
    actor, draft, routeHref: hrefFor("route"), partnerDetails: def.applications ? [] : fx.ROUTE.partner, preparations: { status: "ready", value: def.applications ? [] : fx.ROUTE.preparations },
    packets: fx.ROUTE.packets, nowIso: new Date(`${TODAY}T08:00:00.000Z`).toISOString(), nextUi }) } : {};
  return { name: def.name, def: { ...def, agreement: def.agreement ?? null }, actor, title: fx.NAME, back: ["/v3/profile?view=mine", "Студенты"],
    search: `case=${CASE_ID}&tab=${def.tab}${def.filter ? `&doc_state=${def.filter}` : ""}`, next: caseNextParts(parts.next, parts.actions), legacy: parts,
    nextProps: () => ({ ...props, ...routeTab(true), nextUi: true }), legacyProps: () => ({ ...props, ...routeTab(false) }) };
}

function leadScenario(name, built, tab, title) {
  const { leadNextParts } = src("components/v3/profile/next/LeadNext.tsx");
  const props = { profile: built.profile, draft: built.draft, sales: built.sales, actor: leads.ADMIN, organizationId: ORG, studentPortalCurators: [], studentPortalCuratorsAvailable: true,
    requestIds: built.requestIds, noteRequestId: uuid("13131313", 20), notes: built.notes, notesOlderHref: null, notesLatestHref: null, tab, hrefFor: built.hrefFor };
  return { name, def: { tab, lead: true, agreement: null }, actor: leads.ADMIN, title, back: ["/v3/pipeline", "Воронка продаж"], search: `id=${LEAD_ID}&tab=${tab}`,
    next: leadNextParts(built.parts.next), legacy: built.parts, nextProps: () => ({ ...props, nextUi: true }), legacyProps: () => props };
}

function leadScenarios() {
  const gate = leads.leadBuild("early", {});
  gate.draft = { ...gate.draft };
  const anketa = leads.leadBuild("potential", {});
  anketa.profile = { ...anketa.profile, qualification: "Квалифицирован: 11 класс, IELTS 6.0, Малайзия, осень 2027." };
  return [leadScenario("lead-money-gate", gate, "money", gate.profile.person), leadScenario("lead-anketa", anketa, "anketa", anketa.profile.person)];
}

const scenarios = () => [...CASE_DEFS.map(caseScenario), ...leadScenarios()];

// --- рендер -----------------------------------------------------------------------------------
const inContexts = (node, pathname, search) => leads.withContexts(node, pathname, search);

function body(scenario, legacy = false) {
  current = scenario.def;
  const { Profile } = src("components/v3/profile/Profile.tsx");
  const { ProfileNextShell } = src("components/v3/profile/next/ProfileNextShell.tsx");
  const { PartShell } = src("components/v3/PartShell.tsx");
  const { Icon } = src("components/icons.tsx");
  const back = h("a", { href: scenario.back[0], className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    h(Icon, { name: "arrow-left", size: 16 }), scenario.back[1]);
  if (legacy) {
    const profile = h(Profile, { ...scenario.legacyProps(), caseHeader: scenario.legacy.header, caseOverview: scenario.legacy.overview });
    return h(PartShell, { title: scenario.title, count: null, dense: true, back, action: scenario.legacy.actions }, h("div", { className: "space-y-6" }, profile));
  }
  const profile = h(Profile, { ...scenario.nextProps(), caseHeader: scenario.next.header, caseOverview: scenario.next.overview });
  return h(ProfileNextShell, { title: scenario.title, actions: scenario.next.actions, back }, h("div", { className: "space-y-4" }, profile));
}

function closedScenario() {
  const { ProfileNextShell } = src("components/v3/profile/next/ProfileNextShell.tsx");
  const { PartShell } = src("components/v3/PartShell.tsx");
  const { Icon } = src("components/icons.tsx");
  const { ClosedLeadNext } = optional("components/v3/profile/next/tabs/ClosedLeadNext.tsx") ?? {};
  const { ClosedLeadView } = src("components/v3/closure/ClosedLeadView.tsx");
  const back = h("a", { href: "/v3/pipeline", className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2" }, h(Icon, { name: "arrow-left", size: 16 }), "Воронка продаж");
  const row = fx.CLOSED_LEAD;
  return { name: "lead-closed", actor: leads.ADMIN, title: row.name, search: `id=${LEAD_ID}`, def: { tab: "closed", agreement: null }, closed: row,
    html: () => h(ProfileNextShell, { title: row.name, back }, h("div", { className: "space-y-4" }, h(ClosedLeadNext, { row, readOnly: false }))),
    legacyHtml: () => h(PartShell, { title: row.name, count: null, dense: true, back }, h("div", { className: "space-y-6" }, h(ClosedLeadView, { row, readOnly: false }))) };
}

function worldPage(scenario, legacy = false) {
  const { AppShell } = src("components/v3/AppShell.tsx");
  const node = scenario.html ? (legacy ? scenario.legacyHtml() : scenario.html()) : body(scenario, legacy);
  if (legacy) return h("div", { className: "v3-world", "data-surface": "staff" }, h(AppShell, { actor: scenario.actor, initialNotifications: null }, node));
  return h("div", { className: "v3-world", "data-surface": "staff", "data-ui": "next" }, h(AppShell, { actor: scenario.actor, initialNotifications: null, nextUi: { enabled: true } }, node));
}

const all = () => [...scenarios(), closedScenario()];

if (process.argv.includes("--json-legacy")) {
  // Только прежний вид тех же сценариев (без `nextUi`): байт в байт сравнивается с базовым коммитом.
  process.stdout.write(JSON.stringify(all().map((scenario) => ({ name: scenario.name,
    html: renderToStaticMarkup(inContexts(scenario.html ? scenario.legacyHtml() : body(scenario, true), "/v3/profile", scenario.search)) }))));
} else if (process.argv.includes("--page-json")) {
  require("./card-tabs-page.cjs").pageHtml({ fx, leads, scenarios: all(), prepare: (scenario) => { current = scenario.def; } })
    .then((pages) => process.stdout.write(JSON.stringify(pages)))
    .catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(all().map((scenario) => {
    const pathname = "/v3/profile";
    const render = (legacy) => {
      try {
        return renderToStaticMarkup(inContexts(scenario.html ? (legacy ? scenario.legacyHtml() : scenario.html()) : body(scenario, legacy), pathname, scenario.search));
      } catch (error) {
        throw new Error(`${scenario.name} (${legacy ? "прежний" : "новый"} вид): ${error.message}`, { cause: error });
      }
    };
    return { name: scenario.name, html: render(false), legacy: render(true) };
  })));
} else if (process.argv.includes("--screenshots")) {
  require("./card-tabs-next-checks.cjs").run({ all, worldPage, inContexts, fx, leads, src, renderToStaticMarkup, lazySettled, argv: process.argv, join, resolve, mkdirSync, writeFileSync, pathToFileURL })
    .catch((error) => { console.error(error); process.exit(1); });
} else {
  console.error("usage: card-tabs-next-static-render.cjs --json | --screenshots [outDir]");
  process.exit(2);
}
