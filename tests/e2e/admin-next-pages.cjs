"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Настоящие страницы потока «admin» («Настройки» по разделам, «Маркетинг», «Финансы», «ИИ-агент» по подразделам) в четырёх режимах
 * переключателя «Новый вид»: администратор с cookie, администратор без cookie, просмотр роли с cookie, сотрудник с cookie. Подменены только
 * границы страницы: актёр, cookie и читатели данных (синтетика `admin-next-fixtures.cjs`); `page.tsx`, его проверки прав и выбор вида — настоящие.
 *
 *   node tests/e2e/admin-next-pages.cjs --json
 *     → stdout: JSON [{ name, html | rejected }] — разметка страницы без оболочки (для tests/ui-next-admin.test.mjs).
 *       Свойства ленивых входов нового вида проверяются на сериализацию (`assertFlightProps`): не сериализуются — бросает.
 *   node tests/e2e/admin-next-pages.cjs --legacy-json
 *     → то же для прежнего вида без cookie (администратор): разметка для сравнения с базовым коммитом байт в байт.
 */
const env = require("./admin-next-env.cjs");
require("./next-dynamic-alias.cjs");
const { renderToStaticMarkup } = require("react-dom/server");
const { assertFlightProps } = require("./flight-props.cjs");
const fx = require("./admin-next-fixtures.cjs");
const aiFx = require("./admin-next-ai-fixtures.cjs");
const { ROOT, join } = env;

const React = require("react");
const { createElement, cloneElement, isValidElement } = React;
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");

const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const withContexts = (node, pathname, search) =>
  createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: pathname },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));

/**
 * Номера запросов (`randomUUID`) в прежних и новых частях выдаёт и страница (один раз), и серверные части во время отрисовки (каждую отдачу):
 * при повторных отдачах `renderSettled` они разошлись бы. Счётчик детерминирован: страница считает от 0, отрисовка каждый раз — от `RENDER_BASE`.
 */
const nodeCrypto = require("node:crypto");
const RENDER_BASE = 1_000_000;
let uuidCounter = 0;
nodeCrypto.randomUUID = () => `00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, "0")}`;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Как `renderSettled`, но счётчик номеров возвращается к началу отрисовки перед каждой отдачей. */
async function settle(node, { attempts = 40, waitMs = 15 } = {}) {
  let previous = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let html = null;
    uuidCounter = RENDER_BASE;
    try { html = renderToStaticMarkup(node); }
    catch (error) { if (!/suspended while responding to synchronous input/u.test(String(error?.message))) throw error; }
    // Пока вход нового вида ждёт свой код, он рисует заглушку (`NextScreenLoading`): это ещё не итог.
    if (html !== null && html === previous && !html.includes('data-slot="next-screen-loading"')) return html;
    previous = html;
    await pause(waitMs);
  }
  throw new Error("разметка не устоялась");
}

let nextCookie = false;
require("next/headers").cookies = async () => ({ get: (name) => (name === "evo_ui" && nextCookie ? { name, value: "next" } : undefined) });

const AsyncFunction = (async () => {}).constructor;
async function resolveServer(node) {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServer));
  if (!isValidElement(node)) return node;
  if (typeof node.type === "function" && node.type instanceof AsyncFunction) return resolveServer(await node.type(node.props));
  const { children } = node.props;
  if (children === undefined) return node;
  const resolved = await resolveServer(children);
  return Array.isArray(resolved) ? cloneElement(node, undefined, ...resolved) : cloneElement(node, undefined, resolved);
}

const MODES = [["admin-cookie", fx.ADMIN, true], ["admin-no-cookie", fx.ADMIN, false], ["preview-cookie", fx.PREVIEW, true], ["staff-cookie", fx.STAFF, true]];
const S = fx.settings;
const ai = aiFx.build();
let who = fx.ADMIN;
const scenario = { providers: "production", wazzup: false, reports: true, finance: "configured", pause: null, autosendOn: true, journal: "named" };

/* ---- подмена читателей ---- */
const guards = require(join(ROOT, "src/lib/platform-guards.ts"));
const settingsSource = require(join(ROOT, "src/lib/v3/settings-source.ts"));
const { settingsIntegrations } = require(join(ROOT, "src/lib/v3/settings-health.ts"));
const telephonyAdmin = require(join(ROOT, "src/lib/server/platform-telephony-admin.ts"));
const reportLinks = require(join(ROOT, "src/lib/v3/report-links-source.ts"));
const staffWorkspace = require(join(ROOT, "src/lib/v3/staff-workspace-source.ts"));
const staffRoles = require(join(ROOT, "src/lib/server/staff-roles-service.ts"));
const deletion = require(join(ROOT, "src/lib/v3/account-deletion-source.ts"));
const salesRegister = require(join(ROOT, "src/lib/v3/sales-register-source.ts"));
const marketingSource = require(join(ROOT, "src/lib/v3/marketing-source.ts"));
const aiSource = require(join(ROOT, "src/lib/v3/ai-agent-source.ts"));
const autosendSource = require(join(ROOT, "src/lib/v3/ai-agent-autosend-source.ts"));
const aiHandlers = require(join(ROOT, "src/lib/server/ai-agent-route-handlers.ts"));
const aiSend = require(join(ROOT, "src/lib/server/ai-agent-send-config.ts"));
const aiAuth = require(join(ROOT, "src/lib/server/ai-agent-internal-auth.ts"));
require(join(ROOT, "src/lib/i18n.ts")).getLocale = async () => "ru";
require(join(ROOT, "src/lib/supabase/config.ts")).getSupabasePublicConfig = () => ({ url: "http://127.0.0.1:9", publishableKey: "synthetic-harness-key" });

guards.requireV3PageActor = async () => who;
settingsSource.readAuditExportEnabled = () => true;
settingsSource.readGateFacts = async () => S.GATES;
settingsSource.readIntegrations = async (_actor, now) => settingsIntegrations(S.PROVIDERS[scenario.providers], now);
settingsSource.readJournal = async () => ({ entries: scenario.journal === "unnamed" ? S.JOURNAL_UNNAMED : S.JOURNAL_EVENTS, cursorHonored: true, status: "ready" });
settingsSource.readJournalFacets = async () => S.JOURNAL_FACETS;
settingsSource.readPlatformFact = async () => "не проверялось";
settingsSource.readWhatsAppConnection = async () => (scenario.wazzup ? { status: null, wazzup: { transport: S.WAZZUP_TRANSPORT, intakeEnabled: true } } : { status: "SCAN_QR_CODE" });
telephonyAdmin.readTelephonyAdmin = async () => S.telephonyRead();
reportLinks.readReportLink = async (_actor, key) => (key === "finance" && scenario.finance === "denied" ? { status: "denied" } : S.REPORT_LINK(key, key === "finance" ? scenario.finance === "configured" : scenario.reports));
staffWorkspace.readStaffWorkspace = async () => S.STAFF_DATA;
staffRoles.readStaffRoles = async () => S.ROLE_WORKSPACE;
deletion.readAccountDeletionQueue = async () => ({ status: "ready", rows: S.DELETION_ROWS });
deletion.readAccountDeletionDetail = async (_actor, requestId) => {
  const row = [S.DELETION_DETAIL_AUTO, S.DELETION_DETAIL_MANUAL].find((item) => item.id === requestId);
  return row ? { status: "ready", detail: row } : { status: "not_found" };
};
deletion.readOpenAccountDeletionCount = async () => ({ open: 2, overdue: 1 });
salesRegister.readSalesRegisterManagement = async () => ({ status: "ready", data: { canImport: true } });
marketingSource.readMarketingOverview = async () => ({ status: "available", overview: fx.marketing.OVERVIEW });
marketingSource.readMarketingLeads = async () => ({ status: "available", page: fx.marketing.LEADS_PAGE });
marketingSource.readMarketingRecent = async () => ({ leads: 5, spendRows: 1 });
aiSource.readAiSettings = async () => ({ status: "available", data: ai.settings });
aiSource.readAiDocuments = async () => ai.documents;
aiSource.readAiDocumentDetail = async () => ({ status: "available", data: ai.detail });
aiSource.readAiDocumentPage = async () => ({ status: "available", data: ai.page });
aiSource.readAiReview = async () => ai.review;
aiSource.readAiLab = async () => ({ status: "available", data: ai.lab });
aiSource.readAiExamples = async () => ai.examples;
aiSource.readAiRules = async () => ai.rules;
aiSource.readAiSpend = async () => ai.spend;
autosendSource.readAiAutosend = async () => ai.autosend(scenario.pause ? { paused: scenario.pause } : {});
autosendSource.readAiAutosendJournal = async () => ai.journal;
autosendSource.readAiAutosendSummary = async () => ai.summary;
aiHandlers.readAiAgentStatus = async () => ({ state: "ready", keyAccepted: true, model: "gemini-3.8-flash", block: null });
aiSend.aiAutosendServerState = () => (scenario.autosendOn ? "on" : "off");
aiAuth.aiAgentFeatureOn = () => true;

const page = (path) => require(join(ROOT, "src/app", "(v3)", "v3", path, "page.tsx")).default;
const MEMBER = fx.settings.MEMBERS[2].membershipId;
const PAUSE = { code: "provider_down", byKind: "service", at: "2026-10-27T08:00:00Z", reasonRu: "Сессия WhatsApp не в работе" };
/** [имя, маршрут, параметры адреса, сценарий]. */
const SCREENS = [
  ["settings-staff", "settings", {}, {}],
  ["settings-staff-member", "settings", { section: "staff", view: "people", member: MEMBER }, {}],
  ["settings-roles", "settings", { section: "staff", view: "roles", role: S.ROLES[1].id }, {}],
  ["settings-roles-list", "settings", { section: "staff", view: "roles" }, {}],
  ["settings-departments", "settings", { section: "staff", view: "departments" }, {}],
  ["settings-integrations", "settings", { section: "integrations" }, { providers: "blocked" }],
  ["settings-integrations-wazzup", "settings", { section: "integrations" }, { providers: "wazzup", wazzup: true }],
  ["settings-telephony", "settings", { section: "telephony" }, {}],
  ["settings-reports", "settings", { section: "reports" }, { finance: "empty" }],
  ["settings-journal", "settings", { section: "journal" }, {}],
  ["settings-journal-unnamed", "settings", { section: "journal" }, { journal: "unnamed" }],
  ["settings-deletion", "settings", { section: "deletion" }, {}],
  ["settings-deletion-detail", "settings", { section: "deletion", request: S.DELETION_ROWS[0].id }, {}],
  ["settings-documents", "settings", { section: "documents" }, {}],
  ["settings-platform", "settings", { section: "platform" }, {}],
  ["marketing-overview", "marketing", {}, {}],
  ["marketing-leads", "marketing", { view: "leads" }, {}],
  ["marketing-reports", "marketing", { view: "reports" }, {}],
  ["finance", "finance", {}, { finance: "configured" }],
  ["finance-empty", "finance", {}, { finance: "empty" }],
  ["finance-denied", "finance", {}, { finance: "denied" }],
  ["ai-documents", "ai-agent", {}, {}],
  ["ai-viewer", "ai-agent", { document: aiFx.SCAN, page: "2" }, {}],
  ["ai-review", "ai-agent", { section: "review" }, {}],
  ["ai-lab", "ai-agent", { section: "lab" }, {}],
  ["ai-rules", "ai-agent", { section: "rules" }, {}],
  ["ai-spend", "ai-agent", { section: "spend" }, {}],
  ["ai-autosend", "ai-agent", { section: "autosend" }, { pause: PAUSE, autosendOn: false }],
  ["ai-autosend-journal", "ai-agent", { section: "autosend", view: "journal" }, {}],
  ["ai-autosend-summary", "ai-agent", { section: "autosend", view: "summary" }, {}],
  ["ai-documents-paused", "ai-agent", {}, { pause: PAUSE }],
];
const DEFAULTS = { providers: "production", wazzup: false, reports: true, finance: "configured", pause: null, autosendOn: true, journal: "named" };
const pathOf = (route) => `/v3/${route}`;

async function renderAll(modes) {
  const out = [];
  await env.withFixedDate(async () => {
    try {
      for (const [mode, actor, cookie] of modes) {
        nextCookie = cookie;
        who = actor;
        for (const [name, route, query, over] of SCREENS) {
          Object.assign(scenario, DEFAULTS, over);
          const label = `${name}:${mode}`;
          uuidCounter = 0;
          try {
            const element = await page(route)({ searchParams: Promise.resolve(query) });
            const resolved = await resolveServer(element);
            if (cookie && actor.systemRole === "admin" && !actor.presentationRole) assertFlightProps(resolved.props, `${label}: ленивый вход`);
            out.push({ name: label, html: await settle(withContexts(resolved, pathOf(route), new URLSearchParams(query).toString())) });
          } catch (error) {
            const text = String(error?.digest ?? error?.message ?? error);
            if (/NEXT_REDIRECT/u.test(text)) out.push({ name: label, redirect: text.split(";")[2] ?? text });
            else if (/Marketing(?:Forbidden)?|forbidden|marketing_forbidden/iu.test(`${error?.name} ${text}`)) out.push({ name: label, rejected: "marketing_forbidden" });
            else throw new Error(`${label}: ${error?.stack ?? error}`);
          }
        }
      }
    } finally {
      nextCookie = false;
    }
  });
  return out;
}

/**
 * Свойства, которые страница отдаёт ленивому входу нового вида (администратор с cookie): их же берёт стенд Chromium, чтобы рисовать настоящие
 * компоненты на настоящих данных страницы. Ключ — имя экрана; `legacy` — разметка прежнего вида (администратор без cookie) для снимков «до».
 */
async function capture() {
  const next = new Map();
  const legacy = new Map();
  await env.withFixedDate(async () => {
    nextCookie = true;
    who = fx.ADMIN;
    for (const [name, route, query, over] of SCREENS) {
      Object.assign(scenario, DEFAULTS, over);
      uuidCounter = 0;
      const element = await page(route)({ searchParams: Promise.resolve(query) });
      const resolved = await resolveServer(element);
      assertFlightProps(resolved.props, `${name}: ленивый вход`);
      next.set(name, { route, props: JSON.parse(JSON.stringify(resolved.props)), search: new URLSearchParams(query).toString() });
    }
    nextCookie = false;
    for (const [name, route, query, over] of SCREENS) {
      Object.assign(scenario, DEFAULTS, over);
      uuidCounter = 0;
      const element = await page(route)({ searchParams: Promise.resolve(query) });
      legacy.set(name, await settle(withContexts(await resolveServer(element), pathOf(route), new URLSearchParams(query).toString())));
    }
  });
  return { next, legacy };
}

module.exports = { SCREENS, MODES, renderAll, capture };

if (require.main === module) {
  (async () => {
    if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(await renderAll(MODES)));
    else if (process.argv.includes("--legacy-json")) process.stdout.write(JSON.stringify(await renderAll([MODES[1], MODES[3]])));
    else throw new Error("usage: node tests/e2e/admin-next-pages.cjs --json | --legacy-json");
  })().catch((error) => { console.error(error); process.exit(1); });
}
