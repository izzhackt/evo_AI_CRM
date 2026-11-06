"use strict";

// Разбор файлов из amoCRM на вкладке «Документы» (миграция 333). Настоящие `documentsView` и `AmoDocumentSorting` рисуются
// статическим рендером с СИНТЕТИЧЕСКИМИ данными: файлы, имена и числа выдуманы, живого Supabase, провайдера и хранилища нет.
//   node tests/e2e/amo-sorting-static-render.cjs --json   → JSON [{ name, html }] для tests/amo-document-sorting.test.mjs
/* eslint-disable @typescript-eslint/no-require-imports */

const { existsSync, readFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
const compile = (source, fileName) => ts.transpileModule(source, { fileName, compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => { module._compile(compile(readFileSync(filename, "utf8"), filename), filename); };
}
Module._extensions[".css"] = (module) => { module.exports = new Proxy({}, { get: (_t, key) => (typeof key === "string" ? key : undefined) }); };
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (request === "server-only") return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    return originalResolve.call(this, base, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");

const { documentsView } = require(join(ROOT, "src/components/staff/profile/DocumentsView.tsx"));
const { AmoDocumentSorting } = require(join(ROOT, "src/components/staff/profile/AmoDocumentSorting.tsx"));
const { amoSortingFiles, sortingMode, sortingRows } = require(join(ROOT, "src/components/staff/profile/amo-sorting-view.ts"));
const { canSortDocuments } = require(join(ROOT, "src/components/staff/profile/amo-sorting-access.ts"));

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const CASE_ID = "cccccccc-2222-4222-8222-000000000001";
const uuid = (prefix, n) => `${prefix}-5555-4555-8555-${String(n).padStart(12, "0")}`;
const ACTOR = (fields) => ({ authUserId: uuid("bbbbbbbb", 1), profileId: uuid("bbbbbbbb", 2), membershipId: uuid("aaaaaaaa", 1), organizationId: ORG,
  displayName: "Синтетический сотрудник", email: "synthetic@example.invalid", platformAccessVersion: 1, assignments: [], ...fields });
const CURATOR = ACTOR({ systemRole: "staff", presentationRole: null, permissionKeys: ["case.read.full", "document.read.full", "document.manage", "document.review", "document.download"] });
const ADMIN = ACTOR({ systemRole: "admin", presentationRole: null, permissionKeys: [] });
const PREVIEW = ACTOR({ systemRole: "admin", presentationRole: "admissions", permissionKeys: [] });
const READER = ACTOR({ systemRole: "staff", presentationRole: null, permissionKeys: ["case.read.full", "document.read.full"] });

function item(n, file, fields = {}) {
  return { id: uuid("88888888", n), name: `Файл amoCRM: ${file}`, groupLabel: "Из amoCRM (не разобрано)", intentKind: "custom", version: 1, status: "submitted",
    uploadRequestId: null, metadataRequestId: null, removalRequestId: null, caseLinkTargets: [], presence: "present",
    currentVersionId: uuid("77777777", n), downloadReady: fields.ready ?? true, currentVersionNumber: 1, currentFilename: file,
    currentVersionCreatedAt: "2026-11-02T10:00:00.000Z", latestReview: null, reviewRequestId: null };
}
const GROUPS = [
  { kind: "active", title: "Из amoCRM (не разобрано)", items: [
    item(1, "00000000-aaaa-4000-8000-000000000001.png"), item(2, "00000000-aaaa-4000-8000-000000000002.png"),
    item(3, "00000000-aaaa-4000-8000-000000000003.jpg"), item(4, "00000000-aaaa-4000-8000-000000000004.png"),
    item(5, "00000000-aaaa-4000-8000-000000000005.pdf"), item(6, "00000000-aaaa-4000-8000-000000000006.png", { ready: false })] },
  // Принятый файл и обычная группа в разбор не попадают.
  { kind: "active", title: "Документы студента", items: [{ ...item(7, "passport.png"), name: "Паспорт", groupLabel: "Документы студента", status: "approved" }] },
];
const suggestion = (n, kind, confidence, status = "suggested") => ({ documentSlotId: uuid("88888888", n), documentVersionId: uuid("77777777", n), status, kind, confidence });
const AI = { aiAllowed: true, items: [suggestion(1, "passport", 0.97), suggestion(2, "attestat", 0.93), suggestion(3, "photo", 0.74),
  suggestion(4, "other", 0.95, "unsure"), suggestion(6, "medical", 0.99)] };
// Студент без согласия: база не отдаёт подсказок вовсе. Даже если бы отдала, вид их не показывает.
const NO_CONSENT = { aiAllowed: false, items: [] };
const NO_CONSENT_LEAK = { aiAllowed: false, items: [suggestion(1, "passport", 0.99)] };

const SCENARIOS = {
  curator_ai: { actor: CURATOR, suggestions: AI, allowed: true },
  admin_ai: { actor: ADMIN, suggestions: AI, allowed: true },
  preview_ai: { actor: PREVIEW, suggestions: AI, allowed: true },
  reader_ai: { actor: READER, suggestions: AI, allowed: true },
  curator_no_consent: { actor: CURATOR, suggestions: NO_CONSENT, allowed: true },
  curator_no_consent_leak: { actor: CURATOR, suggestions: NO_CONSENT_LEAK, allowed: true },
  curator_unavailable: { actor: CURATOR, suggestions: null, allowed: true },
  curator_closed_case: { actor: CURATOR, suggestions: AI, allowed: false },
  none_to_sort: { actor: CURATOR, suggestions: AI, allowed: true, groups: [GROUPS[1]] },
};
const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const withContexts = (node) => createElement(AppRouterContext.Provider, { value: routerStub },
  createElement(PathnameContext.Provider, { value: "/profile" },
    createElement(SearchParamsContext.Provider, { value: new URLSearchParams(`case=${CASE_ID}&tab=documents`) }, node)));

function render(name, nextUi) {
  const scenario = SCENARIOS[name];
  const groups = scenario.groups ?? GROUPS;
  const files = amoSortingFiles(groups);
  const sorting = files.length > 0 ? createElement(AmoDocumentSorting, { studentCaseId: CASE_ID, rows: sortingRows(files, scenario.suggestions),
    mode: sortingMode(scenario.suggestions), canAct: canSortDocuments(scenario.actor, scenario.allowed) }) : null;
  return renderToStaticMarkup(withContexts(documentsView({ groups, uploadAccess: scenario.allowed ? "allowed" : "closed", studentCaseId: CASE_ID, recognition: null,
    filter: "all", tabHref: `/profile?case=${CASE_ID}&tab=documents`, today: "2026-11-06", createRequestId: null, baselineOptions: [],
    baselineOptionsUnavailable: false, baselineTemplatesAbsent: false, baselineChecklistRequestId: null, nextUi, sorting })));
}

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  return [result.css, readFileSync(join(ROOT, "src/app/(staff)/staff.css"), "utf8")].join("\n");
}

if (process.argv.includes("--page")) {
  // Страница для снимков (без гидратации): node amo-sorting-static-render.cjs --page <сценарий> > page.html
  const name = process.argv[process.argv.indexOf("--page") + 1];
  compileCss().then((css) => {
    process.stdout.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="v3-world" data-surface="staff" style="padding:16px;max-width:1100px;margin:0 auto">${render(name, true)}</div></body></html>`);
  });
} else if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(Object.keys(SCENARIOS).flatMap((name) => [
    { name, html: render(name, true) }, { name: `${name}:legacy`, html: render(name, false) }])));
} else {
  console.error("usage: amo-sorting-static-render.cjs --json");
  process.exit(2);
}
