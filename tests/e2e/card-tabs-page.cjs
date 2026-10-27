"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * НАСТОЯЩАЯ страница `/v3/profile` (`src/app/(v3)/v3/profile/page.tsx`) для вкладок «Нового вида» в четырёх режимах переключателя:
 * администратор с cookie `evo_ui=next`, администратор без cookie, сотрудник с cookie, администратор в просмотре роли с cookie.
 * Границы сервера (вход, cookie, чтения источников) заменены данными сценария; всё остальное - настоящий код страницы, `isNextUi`,
 * `caseWorkParts`/`caseNextParts`, `Profile`, вкладки. Асинхронные вкладки (`Documents`, `UniversityProgramsTab`, `CaseAgreement*`) заменены тем же
 * синхронным видом, что в `card-tabs-next-static-render.cjs`: статический рендер React не ждёт async-компоненты.
 *
 *   node tests/e2e/card-tabs-next-static-render.cjs --page-json
 *     → stdout: JSON [{ name, html }] - имя `<сценарий>:<режим>`.
 * Тот же прогон на базовом коммите (там нет нового вида, а режим «администратор без cookie» - единственный прежний вид) даёт
 * разметку, с которой сравнивается прежний вид страницы.
 */

const Module = require("node:module");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const MODES = [
  ["admin-cookie", "admin", "next"],
  ["admin-no-cookie", "admin", undefined],
  ["staff-cookie", "staff", "next"],
  ["preview-cookie", "preview", "next"],
];

async function pageHtml({ fx, leads, scenarios, prepare }) {
  const cases = fx;
  const state = { who: null, cookie: undefined, item: null, closed: null };
  const stub = (spec, exports, merge = false) => {
    const file = Module._resolveFilename(spec, module);
    const real = merge ? require(file) : {};
    require.cache[file] = { id: file, filename: file, loaded: true, exports: { ...real, ...exports }, children: [], paths: [] };
  };
  const nothing = () => null;
  stub("next/headers", { cookies: async () => ({ get: (name) => (name === "evo_ui" && state.cookie !== undefined ? { name, value: state.cookie } : undefined) }) });
  stub("@/lib/platform-guards", { requireV3PageActor: async () => state.who, requirePlatformStaffActor: async () => state.who });
  stub("@/lib/v3/profile-source", {
    readProfileTarget: async () => state.closed ? null : ({ profile: state.item.profile, details: state.item.draft, sales: state.item.sales,
      notes: { subject: { leadId: null, studentCaseId: cases.CASE_ID }, page: { rows: [], nextCursor: null } } }),
    readV3ProfileCaseDirectory: async () => null,
  }, true);
  stub("@/lib/v3/case-work-source", { readCaseWork: async () => state.item.work });
  stub("@/lib/platform-closure", { readCaseClosure: async () => null, readClosedLeads: async () => ({ rows: state.closed ? [state.closed] : [], nextCursor: null }) }, true);
  stub("@/lib/server/student-portal-curator-options", { listStudentPortalActiveCurators: async () => [] }, true);
  stub("@/lib/v3/pipeline-source", { readPipelineOwnerOptions: async () => null, readPipelineStages: () => [] }, true);
  stub("@/lib/v3/telephony-lead-calls-source", { readLeadCalls: async () => null }, true);
  stub("@/lib/v3/telephony-dial-source", { readDialOptions: async () => ({ status: "off" }) }, true);
  stub("@/lib/server/platform-staff-task-repository", { readLeadTaskLinks: async () => ({ rows: [], truncated: false }) }, true);
  for (const [spec, name] of [["@/components/v3/profile/ParentPhoneLookalikes", "ParentPhoneLookalikes"], ["@/components/v3/profile/CaseHelpWorkspace", "CaseHelpWorkspace"],
    ["@/components/v3/profile/next/CaseHelpCardWorkspace", "CaseHelpCardWorkspace"], ["@/components/v3/profile/LeadChannelFact", "LeadChannelFact"],
    ["@/components/v3/profile/LeadInterestFact", "LeadInterestFact"], ["@/components/v3/profile/WebsiteLeadSubmissions", "WebsiteLeadSubmissions"]]) stub(spec, { [name]: nothing }, true);
  stub("@/components/v3/students/StudentsQueueScreen", { buildStudentsQueueScreen: async () => ({ content: null, count: null }) }, true);
  const page = require(Module._resolveFilename("@/app/(v3)/v3/profile/page", module)).default;

  const actors = { admin: cases.ADMIN, staff: { ...cases.CURATOR, permissionKeys: [...cases.CURATOR.permissionKeys, "document.upload", "document.manage"] }, preview: { ...cases.ADMIN, presentationRole: "admissions", permissionKeys: [] } };
  const out = [];
  for (const scenario of scenarios) {
    const registered = cases.SCENARIOS[`tab-${scenario.name}`];
    if (!registered && !scenario.closed) continue; // карточки лидов страница собирает из чтений воронки - здесь только дела и закрытый лид
    for (const [mode, who, cookie] of MODES) {
      prepare(scenario);
      state.who = actors[who];
      state.cookie = cookie;
      state.closed = scenario.closed ?? null;
      state.item = registered ? { ...registered, actor: actors[who] } : null;
      const params = scenario.closed ? { id: cases.LEAD_ID } : { case: cases.CASE_ID, tab: scenario.def.tab, ...(scenario.def.filter ? { doc_state: scenario.def.filter } : {}) };
      const element = await page({ searchParams: Promise.resolve(params) });
      // Страница выдаёт случайные ключи запросов форм (`randomUUID`): в разметке они заменены, остальное сравнивается как есть.
      const html = renderToStaticMarkup(leads.withContexts(element, "/v3/profile", new URLSearchParams(params).toString()));
      out.push({ name: `${scenario.name}:${mode}`, html: html.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu, "UUID") });
    }
  }
  return out;
}

module.exports = { pageHtml, MODES, renderToStaticMarkup, h };
