"use strict";

// CJS-скрипт с runtime require-hook'ом: .ts/.tsx компилируются на лету (тот же
// приём, что в conversations-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «ИИ-агент» P2 (план ИИ-агента §7, §8, §12.2): «Информация для агента»
 * (загрузка, статусы, новая версия, просмотр документа), «Лист сверки» и
 * «Лаборатория» на синтетических данных.
 *
 * Страницу строит НАСТОЯЩИЙ `v3/ai-agent/page.tsx` с подменёнными чтениями
 * (`ai-agent-source`); её дерево сериализуется по известным компонентам и
 * гидратируется в браузере теми же компонентами (бандл esbuild). Маршруты CRM
 * (картинки страниц и вырезки, загрузка, `/api/v3/ai-agent/lab*`) отвечает
 * маленький сервер этого скрипта только на 127.0.0.1 (не :3000): картинки —
 * синтетические PNG (sharp из SVG), поток Лаборатории — кадры SSE этой
 * вкладки. Серверные действия отвечают «сохранено» и записываются в
 * `window.__harness.actions`. Документы, числа, вопросы и люди ВЫДУМАНЫ для
 * проверки вёрстки; ни базы, ни агента, ни Gemini, ни Storage здесь нет.
 *
 *   node tests/e2e/ai-agent-p2-static-render.cjs [outDir]
 *     → снимки 1440×900 и 390×844 и проверки JSON-строками; при нарушении —
 *       код выхода 1. По умолчанию outDir — .impeccable/review/ai-agent-p2
 *       (не коммитится); выборка снимков лежит в
 *       docs/design/evo-platform/implementation-screenshots/ai-agent-p2.
 */

const { existsSync, mkdirSync, readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
const LOGO_URL = "/logo.png";

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => module._compile(compile(readFileSync(filename, "utf8")), filename);
}
Module._extensions[".png"] = (module) => { module.exports = { src: LOGO_URL, width: 1843, height: 842 }; };
const cssModules = new Map();
Module._extensions[".css"] = (module, filename) => {
  cssModules.set(filename, readFileSync(filename, "utf8"));
  module.exports = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });
};
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

const { createElement: h, isValidElement, Fragment } = require("react");
const { renderToString } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { staffRoleKeys } = require("./staff-role-templates.cjs");

// --- синтетика ---------------------------------------------------------------------
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const id = (n) => `eeeeeeee-7777-4777-8777-${String(n).padStart(12, "0")}`;
const ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: "aaaaaaaa-1111-4111-8111-000000000001", organizationId: ORG, platformAccessVersion: 1,
  email: "synthetic@example.invalid", displayName: "Менеджер продаж (синтетический)", systemRole: "staff", presentationRole: null,
  assignments: [{ label: "Sales Manager", scope: { kind: "own", key: null, resourceKind: null } }],
  permissionKeys: [...staffRoleKeys("sales-manager"), "ai.agent.use", "ai.agent.manage"],
};
const AI_SECRET = "synthetic-harness-ai-agent-secret-000000000000";

const SCAN = id(301), PRICE = id(302), POLICY = id(303), BOOKLET = id(304), BOOKLET_V2 = id(305), FAQ = id(306), PASSPORT = id(307), LOCKED = id(308), DISCOUNTS = id(309);
const doc = (docId, title, fields = {}) => ({
  id: docId, title, kind: "pdf", audience: "client", autosendAllowed: false, status: "ready", stage: null, progress: 100,
  errorCode: null, source: "upload", sourceRef: {}, editedInLab: false, docVersion: 1, rowVersion: 3, pageCount: 4,
  replacesId: null, supersededById: null, createdAt: "2026-10-06T05:00:00Z", updatedAt: "2026-10-06T06:12:00Z",
  indexedAt: "2026-10-06T05:10:00Z", chunkCount: 18, openReviewCount: 0, ...fields,
});
const DOCUMENTS = { items: [
  doc(BOOKLET_V2, "Буклет EVO 2026", { status: "processing", stage: "ocr", progress: 40, replacesId: BOOKLET, chunkCount: 0, pageCount: 12, updatedAt: "2026-10-06T07:40:00Z" }),
  doc(SCAN, "Прайс 2026 — Малайзия (скан)", { status: "review", openReviewCount: 3, pageCount: 3, chunkCount: 24, docVersion: 2, updatedAt: "2026-10-06T07:31:00Z" }),
  doc(PASSPORT, "scan_0042", { kind: "image", status: "failed", errorCode: "personal_document_suspected", chunkCount: 0, pageCount: 1, updatedAt: "2026-10-06T07:20:00Z" }),
  doc(PRICE, "Прайс 2026 — все страны", { kind: "xlsx", pageCount: 3, chunkCount: 41, updatedAt: "2026-10-06T07:05:00Z" }),
  doc(LOCKED, "Договор-оферта (черновик)", { status: "failed", errorCode: "file_encrypted", chunkCount: 0, pageCount: null, updatedAt: "2026-10-06T06:58:00Z" }),
  doc(FAQ, "Частые вопросы родителей", { kind: "docx", status: "queued", stage: null, progress: 0, chunkCount: 0, pageCount: null, updatedAt: "2026-10-06T06:50:00Z" }),
  doc(POLICY, "Политика возвратов", { kind: "docx", pageCount: 2, chunkCount: 9, editedInLab: true, docVersion: 3, updatedAt: "2026-10-06T06:30:00Z" }),
  doc(BOOKLET, "Буклет EVO 2026", { pageCount: 12, chunkCount: 33, updatedAt: "2026-10-05T12:30:00Z" }),
  doc(DISCOUNTS, "Правила скидок", { kind: "knowledge", source: "seed_kb", sourceRef: { nodeVersion: 2 }, audience: "internal", pageCount: null, chunkCount: 4, updatedAt: "2026-10-05T09:00:00Z" }),
], hasMore: false, canManage: true, isAdmin: false };

// Страница скана: строки прайса и их рамки (доли страницы 1000×1300).
const PAGE_W = 1000, PAGE_H = 1300;
const ROWS = [
  ["Компьютерные науки, бакалавриат", "1 250,00 $", "01.09.2027"],
  ["Бизнес и менеджмент, бакалавриат", "1 180,00 $", "01.09.2027"],
  ["Инженерия, бакалавриат", "1 390,00 $", "15.09.2027"],
  ["Медицина, специалитет", "4 750,00 $", "01.09.2027"],
  ["Подготовительный английский", "640,00 $", "15.07.2027"],
  ["MBA, магистратура", "2 900,00 $", "01.02.2028"],
];
const rowTop = (index) => 360 + index * 70;
const PAGE_DETAIL = {
  document: DOCUMENTS.items[1], canManage: true,
  pages: [
    { pageNo: 1, method: "ocr", hasImage: true, openReviewCount: 0 },
    { pageNo: 2, method: "ocr", hasImage: true, openReviewCount: 2 },
    { pageNo: 3, method: "ocr", hasImage: true, openReviewCount: 1 },
  ],
};
// Форма `ai_agent_document_page_v1` (271); `content` у фрагмента — см. PR (просьба к 271).
const PAGE_2 = {
  documentId: SCAN, docVersion: 2, pageNo: 2, pageCount: 3,
  page: { sheetName: null, method: "ocr", confidence: 0.91, width: PAGE_W, height: PAGE_H, imagePath: `${ORG}/${SCAN}/pages/2.png`,
    textMd: ROWS.map((row) => `| ${row.join(" | ")} |`).join("\n"), lines: null },
  chunks: [
    { chunkId: 701, position: 3, sectionPath: "Прайс 2026 › Малайзия › Бакалавриат", unverified: true,
      content: "| Программа | Цена в год | Начало |\n| Компьютерные науки, бакалавриат | 1 250,00 $ | 01.09.2027 |\n| Бизнес и менеджмент, бакалавриат | 1 180,00 $ | 01.09.2027 |\n| Инженерия, бакалавриат | 1 390,00 $ | 15.09.2027 |",
      boxes: [[0.08, 0.235, 0.92, 0.42]] },
    { chunkId: 702, position: 4, sectionPath: "Прайс 2026 › Малайзия › Медицина и магистратура", unverified: false,
      content: "| Медицина, специалитет | 4 750,00 $ | 01.09.2027 |\n| Подготовительный английский | 640,00 $ | 15.07.2027 |\n| MBA, магистратура | 2 900,00 $ | 01.02.2028 |",
      boxes: [[0.08, 0.45, 0.92, 0.635]] },
    { chunkId: 703, position: 5, sectionPath: "Прайс 2026 › Условия оплаты", unverified: false,
      content: "Оплата за первый семестр — до начала обучения. Регистрационный сбор не возвращается. Цены действуют для набора 2027–2028 учебного года.",
      boxes: [[0.08, 0.7, 0.92, 0.82]] },
  ],
  reviewItems: [
    { id: id(601), status: "open", proposed: "1 250,00 $", bbox: [0.6, (rowTop(0) - 30) / PAGE_H, 0.78, (rowTop(0) + 14) / PAGE_H] },
    { id: id(602), status: "open", proposed: "1 390,00 $", bbox: [0.6, (rowTop(2) - 30) / PAGE_H, 0.78, (rowTop(2) + 14) / PAGE_H] },
  ],
};
const review = (n, fields) => ({
  id: id(600 + n), documentId: SCAN, documentTitle: "Прайс 2026 — Малайзия (скан)", documentVersion: 2, pageNo: 2, kind: "number", status: "open",
  createdAt: `2026-10-06T07:3${n}:00Z`, contextLabel: null, errorCode: null, resolution: null, resolvedAt: null, resolvedByName: null, hasCrop: true, ...fields,
});
const REVIEW = { canManage: true, hasMore: false, counts: { open: 3, applying: 1 }, items: [
  review(1, { contextLabel: "строка «Компьютерные науки, бакалавриат»", proposed: "1 250,00 $",
    candidates: { tesseract: "1 280,00 $", vision: "1 250,00 $", arbiter: "1 250,00 $", arbiterModel: "gemini-3.1-pro-preview" } }),
  review(2, { contextLabel: "строка «Инженерия, бакалавриат»", proposed: "1 390,00 $", errorCode: "anchor_ambiguous",
    candidates: { tesseract: "1 890,00 $", vision: "1 390,00 $", arbiter: null, arbiterModel: null } }),
  review(3, { pageNo: 3, contextLabel: "срок оплаты", proposed: null, kind: "text",
    candidates: { tesseract: "15.O8.2027", vision: "15.08.2027", arbiter: "15.06.2027", arbiterModel: "gemini-3.8-flash" } }),
  review(4, { status: "applying", contextLabel: "строка «MBA, магистратура»", proposed: "2 900,00 $", value: "2 900,00 $",
    candidates: { tesseract: "2 600,00 $", vision: "2 900,00 $", arbiter: "2 900,00 $", arbiterModel: "gemini-3.1-pro-preview" } }),
] };
const REVIEW_RESOLVED = { canManage: true, hasMore: false, counts: { open: 3, applying: 1 }, items: [
  review(5, { status: "resolved", resolution: "corrected", value: "640,00 $", proposed: "650,00 $", contextLabel: "строка «Подготовительный английский»",
    resolvedAt: "2026-10-06T06:58:00Z", resolvedByName: "Менеджер продаж (синтетический)",
    candidates: { tesseract: "640,00 $", vision: "650,00 $", arbiter: "650,00 $", arbiterModel: "gemini-3.1-pro-preview" } }),
] };

const SOURCES = [
  { n: 1, chunk_id: 701, document_id: SCAN, title: "Прайс 2026 — Малайзия (скан)", audience: "client", page_from: 2, page_to: 2, sheet_name: null,
    section_path: "Прайс 2026 › Малайзия › Бакалавриат", live: true, missing: false, unverified: true, unverified_values: ["1 250,00 $"],
    quote: "Компьютерные науки, бакалавриат — 1 250,00 $ в год, начало 01.09.2027." },
  { n: 2, chunk_id: 702, document_id: PRICE, title: "Прайс 2026 — все страны", audience: "client", page_from: null, page_to: null, sheet_name: "Малайзия",
    section_path: "Малайзия › Языковые требования", live: true, missing: false, unverified: false, unverified_values: [],
    quote: "Без IELTS — через подготовительный английский (один семестр, 640,00 $)." },
];
const REPLY = "Бакалавриат по компьютерным наукам в Малайзии стоит 1 250 $ в год, обучение начинается 1 сентября 2027 года. Без IELTS можно: сначала семестр подготовительного английского за 640 $.";
const ANSWER = {
  reply: REPLY, reason: "Цена и дата — из скана прайса (стр. 2), про английский — из листа «Малайзия» общего прайса.",
  question: "", language: "ru", warnings: [],
  citations: [{ n: 1, chunk_id: 701 }, { n: 2, chunk_id: 702 }],
  reply_citations: [{ n: 1, start: 0, end: Array.from(REPLY.split(".")[0] + ".").length }, { n: 2, start: 0, end: Array.from(REPLY).length }],
  sources: SOURCES,
};
const QUESTION = "Сколько стоит бакалавриат по компьютерным наукам в Малайзии и можно ли без IELTS?";
const FINDING = "Цена устарела: с набора 2027 года бакалавриат стоит 1 300 $.";
const PROPOSAL = {
  id: id(801), kind: "document", status: "proposed", createdAt: "2026-10-06T07:45:00Z", expiresAt: "2026-10-06T09:45:00Z",
  documentId: SCAN, documentTitle: "Прайс 2026 — Малайзия (скан)", docVersion: 2, rulesVersionId: null, title: null,
  proposalSha256: "a".repeat(64),
  before: "| Компьютерные науки, бакалавриат | 1 250,00 $ | 01.09.2027 |",
  after: "| Компьютерные науки, бакалавриат | 1 300,00 $ | 01.09.2027 |",
  answer: "Бакалавриат по компьютерным наукам в Малайзии стоит 1 300 $ в год, обучение начинается 1 сентября 2027 года. Без IELTS можно: сначала семестр подготовительного английского за 640 $.",
  question: QUESTION, finding: FINDING, why: "В прайсе стоит прежняя цена набора 2026 года; правка меняет одну строку таблицы.",
  audience: "client", sources: [SCAN],
};
const labState = (session, proposal = null) => ({ canManage: true, session, proposal });
const SESSION = { revision: 2, updatedAt: "2026-10-06T07:44:00Z", expiresAt: "2026-10-06T09:44:00Z", payload: { question: QUESTION, answer: ANSWER, finding: "" } };
const EXAMPLES = { canManage: true, hasMore: false, items: [
  { id: id(901), question: "Можно ли поступить в Малайзию без IELTS?", answer: "Да: сначала семестр подготовительного английского (640 $), затем бакалавриат.",
    confirmedAt: "2026-10-05T11:00:00Z", confirmedByName: "Куратор (синтетический)", valid: true,
    stale: { legacy: false, rules: false, model: false, documents: [] } },
  { id: id(902), question: "Сколько стоит медицина в Малайзии?", answer: "Специалитет по медицине — 4 750 $ в год.",
    confirmedAt: "2026-10-04T15:20:00Z", confirmedByName: "Менеджер продаж (синтетический)", valid: false,
    stale: { legacy: false, rules: false, model: false, documents: [SCAN] } },
] };
const SETTINGS = {
  version: 7, models: { answer: "gemini-3.8-flash", fast: "gemini-3.5-flash-lite", embedding: "gemini-embedding-2" }, unpricedModels: [],
  monthlyCapUsd: 50, ratePerMemberMinute: 20,
  consent: { recorded: true, at: "2026-10-06T04:30:00Z", byName: "Администратор (синтетический)", textVersion: "gemini-v1-2026-10-06" },
  canManage: true, isAdmin: false,
};

// --- страница с подменёнными чтениями ------------------------------------------------
const { normalizeAiDocuments, normalizeAiSettings } = require(join(ROOT, "src/lib/v3/ai-agent.ts"));
const knowledge = require(join(ROOT, "src/lib/v3/ai-agent-knowledge.ts"));
const ok = (data) => ({ status: "available", data });

function stubReads(scenario) {
  require(join(ROOT, "src/lib/platform-guards.ts")).requireV3PageActor = async () => ACTOR;
  require(join(ROOT, "src/lib/supabase/config.ts")).getSupabasePublicConfig = () => ({ url: "http://127.0.0.1:9", publishableKey: "synthetic-harness-key" });
  require(join(ROOT, "src/lib/i18n.ts")).getLocale = async () => "ru";
  const source = require(join(ROOT, "src/lib/v3/ai-agent-source.ts"));
  source.readAiSettings = async () => ok(normalizeAiSettings(SETTINGS));
  source.readAiDocuments = async () => ok(normalizeAiDocuments(scenario.documents ?? DOCUMENTS));
  source.readAiDocumentDetail = async () => ok(knowledge.normalizeAiDocumentDetail(scenario.detail ?? PAGE_DETAIL));
  source.readAiDocumentPage = async () => ok(knowledge.normalizeAiDocumentPage(scenario.page ?? PAGE_2));
  source.readAiReview = async (_actor, input) => ok(knowledge.normalizeAiReviewList(input.limit === 1 ? REVIEW
    : input.filter !== "open" ? REVIEW_RESOLVED : scenario.review ?? REVIEW));
  source.readAiLab = async () => ok(knowledge.normalizeAiLabState(scenario.lab ?? labState(null)));
  source.readAiExamples = async () => ok(knowledge.normalizeAiExamples(EXAMPLES));
  require(join(ROOT, "src/lib/server/ai-agent-route-handlers.ts")).readAiAgentStatus = async () => ({ state: "ready", keyAccepted: true, model: "gemini-3.8-flash", block: null });
}

// Компоненты, которые страница кладёт в дерево; по имени их собирает и браузер.
const COMPONENT_FILES = {
  PartShell: "src/components/v3/PartShell.tsx",
  AiAgentNav: "src/components/v3/ai-agent/AiAgentViews.tsx",
  AiAgentNotice: "src/components/v3/ai-agent/AiAgentViews.tsx",
  AiDocumentsView: "src/components/v3/ai-agent/AiAgentViews.tsx",
  AiUnavailable: "src/components/v3/ai-agent/AiAgentViews.tsx",
  AiDocumentViewer: "src/components/v3/ai-agent/AiDocumentViewer.tsx",
  AiReviewSheet: "src/components/v3/ai-agent/AiReviewSheet.tsx",
  AiLaboratory: "src/components/v3/ai-agent/AiLaboratory.tsx",
  AiExamplesList: "src/components/v3/ai-agent/AiExamplesList.tsx",
};
const serverComponents = () => Object.fromEntries(Object.entries(COMPONENT_FILES).map(([name, file]) => [name, require(join(ROOT, file))[name]]));

function serialize(node, names) {
  if (node === null || node === undefined || typeof node === "boolean") return null;
  if (typeof node === "string" || typeof node === "number") return node;
  if (Array.isArray(node)) return node.map((child) => serialize(child, names));
  if (!isValidElement(node)) throw new Error("harness: unexpected node");
  const { children, ...props } = node.props;
  for (const [key, value] of Object.entries(props)) if (typeof value === "function") throw new Error(`harness: function prop ${key}`);
  const kids = children === undefined ? undefined : serialize(children, names);
  if (typeof node.type === "string") return { tag: node.type, key: node.key, props, children: kids };
  if (node.type === Fragment) return { tag: "#fragment", key: node.key, props: {}, children: kids };
  const name = names.get(node.type);
  if (!name) throw new Error(`harness: unknown component ${node.type?.name}`);
  return { component: name, key: node.key, props, children: kids };
}
function deserialize(node, components) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((child) => deserialize(child, components));
  const children = node.children === undefined ? undefined : deserialize(node.children, components);
  const type = node.component ? components[node.component] : node.tag === "#fragment" ? Fragment : node.tag;
  const props = { ...node.props, key: node.key ?? undefined };
  return children === undefined ? h(type, props) : Array.isArray(children) ? h(type, props, ...children) : h(type, props, children);
}

async function buildPageTree(scenario) {
  process.env.EVO_AI_AGENT_INTERNAL_SECRET = scenario.featureOff ? "" : AI_SECRET;
  stubReads(scenario);
  const { default: Page } = require(join(ROOT, "src/app/(v3)/v3/ai-agent/page.tsx"));
  const element = await Page({ searchParams: Promise.resolve(scenario.search) });
  const components = serverComponents();
  const names = new Map(Object.entries(components).map(([name, fn]) => [fn, name]));
  return serialize(element, names);
}

function withContexts(node, pathname, search) {
  const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
  return h(AppRouterContext.Provider, { value: router },
    h(PathnameContext.Provider, { value: pathname },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}
function shell(content, search) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  return withContexts(h("div", { className: "v3-world", "data-surface": "staff" }, h(AppShell, { actor: ACTOR, initialNotifications: null }, content)),
    "/v3/ai-agent", search);
}

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(/fonts/${font}/`);
  });
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8"), ...cssModules.values()].join("\n");
}

// --- браузерная сборка --------------------------------------------------------------
const FIXTURE_ID = "ai-agent-p2-fixture";
const LINK_SHIM = `
const React = require("react");
const ONLY = new Set(["prefetch", "scroll", "replace", "shallow", "locale", "passHref", "legacyBehavior", "onNavigate", "as", "unstable_dynamicOnHover"]);
function Link(props) {
  const rest = {};
  for (const [key, value] of Object.entries(props)) if (!ONLY.has(key) && key !== "href") rest[key] = value;
  return React.createElement("a", { ...rest, href: String(props.href), onClick(event) { if (props.onClick) props.onClick(event); event.preventDefault(); window.__harness.pushes.push(String(props.href)); } });
}
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
`;
const CLIENT_ENTRY = `
const React = require("react");
const { hydrateRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const components = {
  PartShell: require("@/components/v3/PartShell").PartShell,
  ...(() => { const views = require("@/components/v3/ai-agent/AiAgentViews"); return { AiAgentNav: views.AiAgentNav, AiAgentNotice: views.AiAgentNotice, AiDocumentsView: views.AiDocumentsView, AiUnavailable: views.AiUnavailable }; })(),
  AiDocumentViewer: require("@/components/v3/ai-agent/AiDocumentViewer").AiDocumentViewer,
  AiReviewSheet: require("@/components/v3/ai-agent/AiReviewSheet").AiReviewSheet,
  AiLaboratory: require("@/components/v3/ai-agent/AiLaboratory").AiLaboratory,
  AiExamplesList: require("@/components/v3/ai-agent/AiExamplesList").AiExamplesList,
};
const h = React.createElement;
const Fragment = React.Fragment;
${deserialize.toString()}
const fixture = JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
window.__harness = { pushes: [], refreshes: 0, actions: [], recoverable: [], errors: [] };
const router = { push: (href) => window.__harness.pushes.push(href), replace: (href) => window.__harness.pushes.push(href),
  refresh() { window.__harness.refreshes += 1; }, back() {}, forward() {}, prefetch() {}, hmrRefresh() {} };
const tree = h(AppRouterContext.Provider, { value: router },
  h(PathnameContext.Provider, { value: "/v3/ai-agent" },
    h(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) },
      h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
        h("div", { className: "v3-world", "data-surface": "staff" },
          h(AppShell, { actor: fixture.actor, initialNotifications: null }, deserialize(fixture.page, components)))))));
hydrateRoot(document.getElementById("root"), tree, { onRecoverableError: (error) => window.__harness.recoverable.push(String((error && error.message) || error)) });
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.hydrated = "true"; }));
`;
// Серверные действия раздела: «сохранено» без базы (запись — в __harness.actions).
const ACTION_STUB = (names) => names.map((name) => `export async function ${name}(previous, form) {
  window.__harness.actions.push(${JSON.stringify(name)} + ":" + (form && form.get ? [...form.entries()].filter(([key]) => key !== "request_id").map(([key, value]) => key + "=" + value).join("&") : ""));
  await new Promise((resolve) => setTimeout(resolve, 250));
  return { status: "saved", requestId: form && form.get ? form.get("request_id") : null };
}`).join("\n");

async function buildClientBundle(outFile) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "ai-agent-p2-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        if (args.path.endsWith("platform-ai-agent-actions.ts")) return { contents: ACTION_STUB(names), loader: "ts" };
        return { contents: names.map((name) => `export async function ${name}() { window.__harness.errors.push("server action ${name}"); throw new Error("harness"); }`).join("\n"), loader: "ts" };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "ai-agent-p2-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } };" },
    plugins: [plugin], logLevel: "error",
  });
}

// --- синтетические картинки ------------------------------------------------------------
const sharp = require("sharp");
const escapeXml = (text) => text.replace(/[<>&]/gu, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char]);
async function pageImage(pageNo) {
  const rows = ROWS.map(([name, price, start], index) => `
    <text x="90" y="${rowTop(index)}" font-size="26" fill="#1d1d1b">${escapeXml(name)}</text>
    <text x="610" y="${rowTop(index)}" font-size="26" fill="#1d1d1b">${escapeXml(price)}</text>
    <text x="800" y="${rowTop(index)}" font-size="26" fill="#1d1d1b">${start}</text>
    <line x1="80" x2="920" y1="${rowTop(index) + 22}" y2="${rowTop(index) + 22}" stroke="#bdbab2" stroke-width="1.5"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" font-family="Times New Roman, serif">
    <rect width="100%" height="100%" fill="#fbfaf6"/>
    <text x="80" y="140" font-size="44" font-weight="bold" fill="#1d1d1b">EVO · Прайс 2026 — Малайзия</text>
    <text x="80" y="190" font-size="22" fill="#55524c">Синтетический документ для проверки вёрстки · стр. ${pageNo}</text>
    <text x="90" y="290" font-size="22" font-weight="bold" fill="#55524c">Программа</text>
    <text x="610" y="290" font-size="22" font-weight="bold" fill="#55524c">Цена в год</text>
    <text x="800" y="290" font-size="22" font-weight="bold" fill="#55524c">Начало</text>
    <line x1="80" x2="920" y1="310" y2="310" stroke="#55524c" stroke-width="2"/>
    ${rows}
    <text x="90" y="${rowTop(6) + 60}" font-size="22" fill="#1d1d1b">Оплата за первый семестр — до начала обучения.</text>
    <text x="90" y="${rowTop(6) + 96}" font-size="22" fill="#1d1d1b">Регистрационный сбор не возвращается.</text>
    <text x="90" y="${rowTop(6) + 132}" font-size="22" fill="#1d1d1b">Цены действуют для набора 2027–2028 учебного года.</text>
  </svg>`;
  return sharp(Buffer.from(svg)).rotate(0.4, { background: "#f4f2ec" }).resize(PAGE_W, PAGE_H, { fit: "fill" }).blur(0.6).png().toBuffer();
}
async function cropImage(text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="64"><rect width="100%" height="100%" fill="#fbfaf6"/>
    <text x="14" y="44" font-size="34" font-family="Times New Roman, serif" fill="#1d1d1b">${escapeXml(text)}</text></svg>`;
  return sharp(Buffer.from(svg)).blur(0.9).png().toBuffer();
}

// --- сервер вкладки (только 127.0.0.1) ----------------------------------------------
function startServer(files, behaviour) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    try {
      if (files.has(url.pathname)) {
        const [type, body] = files.get(url.pathname);
        response.writeHead(200, { "Content-Type": type });
        response.end(body);
        return;
      }
      if (url.pathname.startsWith("/fonts/")) {
        const [, , font, file] = url.pathname.split("/");
        response.writeHead(200, { "Content-Type": "font/woff2" });
        response.end(readFileSync(join(ROOT, "node_modules/@fontsource-variable", font, "files", file)));
        return;
      }
      if (url.pathname === LOGO_URL) {
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(readFileSync(join(ROOT, "public/brand/evo-logo.png")));
        return;
      }
      const pageMatch = /^\/api\/v3\/ai-agent\/documents\/[0-9a-f-]{36}\/pages\/(\d+)\/image$/u.exec(url.pathname);
      if (pageMatch) {
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(await pageImage(Number(pageMatch[1])));
        return;
      }
      const cropMatch = /^\/api\/v3\/ai-agent\/documents\/[0-9a-f-]{36}\/crops\/([0-9a-f-]{36})$/u.exec(url.pathname);
      if (cropMatch) {
        const item = [...REVIEW.items, ...REVIEW_RESOLVED.items].find((candidate) => candidate.id === cropMatch[1]);
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(await cropImage(item?.candidates.tesseract ?? "—"));
        return;
      }
      await behaviour(url, request, response);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  return new Promise((resolveServer) => server.listen(0, "127.0.0.1", () => resolveServer(server)));
}
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// --- сценарии -------------------------------------------------------------------------
const SCENARIOS = {
  documents: { search: {} },
  replace: { search: { replace: PRICE } },
  // Новая версия уже обрабатывается — вторую не начать (271: replacement_pending).
  "replace-pending": { search: { replace: BOOKLET } },
  "documents-empty": { search: {}, documents: { items: [], hasMore: false, canManage: true, isAdmin: false } },
  viewer: { search: { document: SCAN, page: "2" } },
  review: { search: { section: "review" } },
  "review-resolved": { search: { section: "review", status: "resolved" } },
  "review-done": { search: { section: "review" }, review: { items: [], hasMore: false, counts: { open: 0, applying: 0 }, canManage: true } },
  lab: { search: { section: "lab" } },
};
const VIEWPORTS = {
  "1440": { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  "390": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

function metrics() {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  };
  const main = [...document.querySelectorAll("main")].find(visible);
  const inMain = main ? [...main.querySelectorAll("*")].filter(visible) : [];
  const texts = inMain.filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()));
  const targets = main ? [...main.querySelectorAll("a, button, select, input:not([type=hidden]), textarea, summary")]
    .filter((element) => visible(element) && !element.matches(".v3-ai-mark, .sr-only") && !element.closest(".sr-only")
      && !(element.matches("a") && element.closest("p, li") && getComputedStyle(element).display === "inline")) : [];
  return {
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    textUnder12: texts.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12).map((element) => element.textContent.trim().slice(0, 24)),
    smallTargets: targets.filter((element) => element.getBoundingClientRect().height < 44 && element.type !== "checkbox" && element.type !== "radio")
      .map((element) => element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 30)),
    solidRed: [...document.querySelectorAll("main a, main button")].filter((element) => visible(element) && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
    brokenImages: [...document.querySelectorAll("main img")].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.getAttribute("src")),
    h1: [...document.querySelectorAll("h1")].filter(visible).map((element) => element.textContent.trim()),
  };
}

async function main() {
  const outIndex = 2;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--")
    ? process.argv[outIndex] : join(ROOT, ".impeccable/review/ai-agent-p2"));
  mkdirSync(outDir, { recursive: true });
  const css = await compileCss();
  const workDir = join(require("node:os").tmpdir(), "evo-ai-agent-p2-render");
  mkdirSync(workDir, { recursive: true });
  const bundlePath = join(workDir, "bundle.js");
  await buildClientBundle(bundlePath);
  const files = new Map([["/bundle.js", ["text/javascript; charset=utf-8", readFileSync(bundlePath)]]]);
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const page = await buildPageTree(scenario);
    const search = new URLSearchParams(scenario.search).toString();
    const components = serverComponents();
    const markup = renderToString(shell(deserialize(page, components), search));
    const data = JSON.stringify({ page, search, actor: ACTOR }).replaceAll("<", "\\u003c");
    files.set(`/${name}.html`, ["text/html; charset=utf-8", [
      "<!DOCTYPE html>",
      '<html lang="ru" data-theme="light" class="h-full antialiased">',
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>ИИ-агент — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
      `<body class="min-h-full"><div id="root">${markup}</div><script type="application/json" id="${FIXTURE_ID}">${data}</script><script src="/bundle.js"></script></body></html>`,
    ].join("")]);
  }

  // Ответы «агента» и маршрута загрузки — по очереди, как их задаёт сценарий.
  const queue = { lab: [], ask: [], critique: [], apply: [], upload: [] };
  const server = await startServer(files, async (url, request, response) => {
    const take = (list, fallback) => (list.length > 0 ? list.shift() : fallback);
    if (url.pathname === "/api/v3/ai-agent/lab" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ state: knowledge.normalizeAiLabState(take(queue.lab, labState(null))), featureOn: true }));
      return;
    }
    if (url.pathname === "/api/v3/ai-agent/lab/ask" || url.pathname === "/api/v3/ai-agent/lab/critique") {
      const frames = take(url.pathname.endsWith("ask") ? queue.ask : queue.critique, []);
      response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" });
      for (const [delay, event, data] of frames) {
        await wait(delay);
        response.write(frame(event, data));
      }
      response.end();
      return;
    }
    if (url.pathname === "/api/v3/ai-agent/lab/apply") {
      const [status, body] = take(queue.apply, [200, { status: "applied", kind: "document", documentId: SCAN }]);
      await wait(400);
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
      return;
    }
    if (url.pathname === "/api/v3/ai-agent/documents" && request.method === "POST") {
      for await (const chunk of request) void chunk;
      const [status, body] = take(queue.upload, [201, { documentId: id(999), document: null }]);
      await wait(300);
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end("{}");
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const open = async (name, viewportKey) => {
    const context = await browser.newContext({ ...VIEWPORTS[viewportKey], colorScheme: "light", locale: "ru-RU", timezoneId: "Asia/Bishkek" });
    const session = await context.newPage();
    const errors = [];
    session.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    session.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await session.goto(`${base}/${name}.html`, { waitUntil: "load" });
    await session.evaluate(() => document.fonts.ready);
    await session.waitForSelector("html[data-hydrated=true]", { state: "attached", timeout: 15_000 });
    await session.waitForTimeout(300);
    return { context, page: session, errors, name, viewportKey };
  };
  const close = async (session) => {
    const harness = await session.page.evaluate(() => window.__harness);
    const problems = [...session.errors.filter((message) => !/Failed to load resource/u.test(message)),
      ...harness.recoverable.map((message) => `recoverable: ${message}`), ...harness.errors];
    check(problems.length === 0, `${session.name}-${session.viewportKey}: browser errors: ${problems.join(" | ")}`);
    await session.context.close();
    return harness;
  };
  const shot = async (session, file, { fullPage = false } = {}) => {
    await session.page.waitForTimeout(150);
    await session.page.screenshot({ path: join(outDir, `${file}-${session.viewportKey}.png`), fullPage });
    const measured = await session.page.evaluate(metrics);
    report({ file: `${file}-${session.viewportKey}`, ...measured });
    check(measured.overflowX === 0, `${file}-${session.viewportKey}: horizontal overflow ${measured.overflowX}px`);
    check(measured.textUnder12.length === 0, `${file}-${session.viewportKey}: texts under 12px ${measured.textUnder12.join(", ")}`);
    check(measured.smallTargets.length === 0, `${file}-${session.viewportKey}: targets under 44px: ${measured.smallTargets.join(", ")}`);
    check(measured.solidRed <= 1, `${file}-${session.viewportKey}: ${measured.solidRed} solid red controls`);
    check(measured.brokenImages.length === 0, `${file}-${session.viewportKey}: broken images ${measured.brokenImages.join(", ")}`);
    check(measured.h1.length === 1 && measured.h1[0] === "ИИ-агент", `${file}-${session.viewportKey}: h1 ${measured.h1.join(" | ")}`);
    return measured;
  };
  const text = (session, selector) => session.page.locator(selector).first().innerText();

  try {
    for (const viewportKey of Object.keys(VIEWPORTS)) {
      // Информация для агента: статусы, новая версия под прежней, документ клиента.
      let session = await open("documents", viewportKey);
      await shot(session, "documents", { fullPage: true });
      const statuses = await session.page.locator('[data-testid="v3-ai-document"]').evaluateAll((rows) => rows.map((row) => row.dataset.status));
      check(statuses.length === 8, `documents: 8 rows (the new version is nested), got ${statuses.length}`);
      check((await text(session, '[data-testid="v3-ai-document-successor"]')).includes("Новая версия обрабатывается — пока ищется прежняя."), "documents: successor line");
      check((await session.page.getByText("Похоже на документ клиента — не загружается").count()) === 1, "documents: personal document status");
      check((await session.page.getByText("Ошибка — файл защищён паролем").count()) === 1, "documents: Russian error");
      check((await session.page.getByText("Нужна сверка · 3").count()) === 1, "documents: review count");
      check((await session.page.getByText("Обработка · распознавание 40%").count()) === 1, "documents: processing stage");
      // «⋯» строки: редкие команды раскрываются под строкой; Esc возвращает фокус.
      const more = session.page.getByRole("button", { name: "Ещё действия: Прайс 2026 — все страны" });
      await more.click();
      check((await session.page.getByRole("link", { name: "Загрузить новую версию" }).count()) === 1, "documents: «⋯» opens «Загрузить новую версию»");
      await shot(session, "documents-menu");
      await session.page.keyboard.press("Tab");
      await session.page.keyboard.press("Escape");
      check(await more.evaluate((element) => element === document.activeElement && element.getAttribute("aria-expanded") === "false"), "documents: Esc closes «⋯» and returns focus");
      // Клавиатура: Tab доходит до выбора файла, рамка — у всей зоны.
      await session.page.locator('[data-testid="v3-ai-upload-input"]').focus();
      check(await session.page.locator(".v3-ai-drop").evaluate((element) => getComputedStyle(element).outlineStyle === "solid"), "upload: focus ring on the drop zone");
      // Выбран файл: название, аудитория, отметки; без отметки — подсказка, а не отправка.
      await session.page.locator('[data-testid="v3-ai-upload-input"]').setInputFiles({
        name: "Прайс_2027_Малайзия.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.alloc(48_213, 1),
      });
      // aria-disabled: кнопка в фокусе и нажимается — вместо отправки подсказка.
      await session.page.locator('[data-testid="v3-ai-upload-submit"]').click({ force: true });
      check((await session.page.locator('[data-testid="v3-ai-upload"] [role="alert"]').innerText()).includes("материал компании"), "upload: company material is required");
      await session.page.locator('[data-testid="v3-ai-upload-company"]').check();
      await session.page.locator('[data-testid="v3-ai-upload-client"]').check();
      await session.page.locator('[data-testid="v3-ai-upload"]').scrollIntoViewIfNeeded();
      await shot(session, "upload-filled");
      queue.upload.push([422, { error: { code: "malware_detected" } }]);
      await session.page.locator('[data-testid="v3-ai-upload-submit"]').click();
      await session.page.waitForSelector('[data-testid="v3-ai-upload-status"] [data-code="malware_detected"]');
      check((await text(session, '[data-testid="v3-ai-upload-status"]')).includes("Файл не прошёл проверку на вирусы."), "upload: virus copy");
      await shot(session, "upload-virus");
      queue.upload.push([201, { documentId: id(999), document: null }]);
      await session.page.locator('[data-testid="v3-ai-upload-input"]').setInputFiles({
        name: "Политика возвратов 2027.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.alloc(9_100, 1),
      });
      await session.page.locator('[data-testid="v3-ai-upload-company"]').check();
      await session.page.locator('[data-testid="v3-ai-upload-client"]').check();
      await session.page.locator('[data-testid="v3-ai-upload-submit"]').click();
      await session.page.waitForSelector('[data-testid="v3-ai-upload-status"] [role="status"]');
      await shot(session, "upload-done");
      const harness = await close(session);
      check(harness.refreshes === 1, `upload: the list is re-read after success (${harness.refreshes})`);

      session = await open("replace", viewportKey);
      check((await text(session, '[data-testid="v3-ai-upload"] h2')).includes("Новая версия «Прайс 2026 — все страны»"), "replace: heading");
      check((await session.page.locator('[data-testid="v3-ai-upload"] input[type=radio]').count()) === 0, "replace: no audience choice");
      await shot(session, "replace");
      await close(session);

      if (viewportKey === "1440") {
        session = await open("replace-pending", viewportKey);
        check((await session.page.getByText("Новую версию этого документа загрузить нельзя").count()) === 1, "replace-pending: honest refusal");
        check((await text(session, '[data-testid="v3-ai-upload"] h2')).includes("Загрузить материал"), "replace-pending: the ordinary upload stays");
        await close(session);
        session = await open("documents-empty", viewportKey);
        await shot(session, "documents-empty");
        await close(session);
      }

      // Просмотр документа: картинка страницы, рамки, «не проверено», фрагменты.
      session = await open("viewer", viewportKey);
      await session.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="v3-ai-page-image"] img')].every((image) => image.complete && image.naturalWidth > 0));
      await shot(session, "viewer", { fullPage: viewportKey === "390" });
      await session.page.locator(".v3-ai-chunk").first().click();
      check((await session.page.locator(".v3-ai-box[data-active]").count()) === 1, "viewer: the fragment highlights its box");
      check((await session.page.locator(".v3-ai-box[data-review]").count()) === 2, "viewer: two unverified numbers on the page");
      await shot(session, "viewer-highlight", { fullPage: viewportKey === "390" });
      await close(session);

      // «Лист сверки»: прочтения, вырезки, «Исправить», «Исправление применяется…».
      session = await open("review", viewportKey);
      // Вырезки грузятся лениво; для снимка всей страницы — сразу.
      await session.page.evaluate(() => { for (const image of document.querySelectorAll(".v3-ai-crop img")) image.loading = "eager"; });
      await session.page.waitForFunction(() => [...document.querySelectorAll(".v3-ai-crop img")].every((image) => image.complete && image.naturalWidth > 0));
      await shot(session, "review", { fullPage: true });
      check((await session.page.locator('[data-testid="v3-ai-review-applying"]').count()) === 1, "review: applying state");
      check((await session.page.getByText("число встречается в тексте не один раз").count()) === 1, "review: anchor error");
      await session.page.getByRole("button", { name: "Исправить" }).first().click();
      check(await session.page.locator('[data-testid="v3-ai-review-value"]').evaluate((element) => element === document.activeElement), "review: focus moves to the value");
      await session.page.locator('[data-testid="v3-ai-review-value"]').fill("1 300,00 $");
      await shot(session, "review-correct");
      await session.page.getByRole("button", { name: "Сохранить исправление" }).click();
      await session.page.waitForSelector('[data-testid="v3-ai-review-actions"] [role="status"]');
      const reviewHarness = await close(session);
      check(reviewHarness.actions.some((entry) => entry.startsWith("resolveAiReviewItemAction:") && entry.includes("review_action=correct") && entry.includes("value=1 300,00 $")),
        `review: correct → action ${reviewHarness.actions.join(" | ")}`);
      if (viewportKey === "1440") {
        for (const name of ["review-resolved", "review-done"]) {
          session = await open(name, viewportKey);
          await shot(session, name);
          await close(session);
        }
      }

      // «Лаборатория»: вопрос → поток → ответ с источниками → «Что не так?» → правка → «Применить».
      queue.ask.push([[50, "status", { stage: "searching" }], [700, "sources", { count: 2 }], [50, "status", { stage: "writing" }],
        ...Array.from({ length: 6 }, (_unused, index) => [140, "delta", { text: Array.from(REPLY).slice(index * 32, index * 32 + 32).join("") }]),
        [150, "final", { answer: {} }]]);
      queue.lab.push(labState(SESSION));
      queue.critique.push([[50, "status", { stage: "reviewing" }], [600, "delta", { text: "В прайсе цена набора 2026 года." }], [300, "final", { proposal: { id: PROPOSAL.id } }]]);
      queue.lab.push(labState({ ...SESSION, payload: { ...SESSION.payload, finding: FINDING } }, PROPOSAL));
      session = await open("lab", viewportKey);
      await shot(session, "lab-empty", { fullPage: viewportKey === "390" });
      await session.page.locator('[data-testid="v3-ai-lab-question-input"]').fill(QUESTION);
      await session.page.locator('[data-testid="v3-ai-lab-ask"]').click();
      await session.page.waitForSelector('[data-testid="v3-ai-preview"]');
      await shot(session, "lab-streaming");
      await session.page.waitForSelector('[data-testid="v3-ai-lab-answer"]');
      check(await session.page.waitForFunction(() => document.activeElement?.dataset.testid === "v3-ai-lab-finding", null, { timeout: 2000 })
        .then(() => true, () => false), "lab: focus moves to «Что не так?»");
      await shot(session, "lab-answer", { fullPage: true });
      await session.page.locator('[data-testid="v3-ai-lab-finding"]').fill(FINDING);
      await session.page.locator('[data-testid="v3-ai-lab-critique"]').click();
      await session.page.waitForSelector('[data-testid="v3-ai-lab-proposal"]');
      await session.page.locator('[data-testid="v3-ai-lab-proposal"]').scrollIntoViewIfNeeded();
      await shot(session, "lab-proposal");
      await shot(session, "lab-proposal-full", { fullPage: true });
      queue.apply.push([409, { error: { code: "lab_changed" } }]);
      queue.lab.push(labState({ ...SESSION, payload: { ...SESSION.payload, finding: FINDING } }, { ...PROPOSAL, status: "conflict" }));
      await session.page.locator('[data-testid="v3-ai-lab-apply"]').click();
      await session.page.waitForSelector('[data-testid="v3-ai-lab-error"][data-code="lab_changed"]');
      check((await text(session, '[data-testid="v3-ai-lab-error"]')).includes("Знания или предложение изменились. Спросите заново."), "lab: conflict copy");
      await shot(session, "lab-conflict");
      await close(session);

      // Повтор до «Применить» с успехом.
      queue.lab.length = 0;
      queue.ask.push([[50, "status", { stage: "searching" }], [200, "delta", { text: REPLY }], [100, "final", { answer: {} }]]);
      queue.lab.push(labState(SESSION));
      queue.critique.push([[50, "status", { stage: "reviewing" }], [200, "final", { proposal: { id: PROPOSAL.id } }]]);
      queue.lab.push(labState({ ...SESSION, payload: { ...SESSION.payload, finding: FINDING } }, PROPOSAL));
      queue.apply.push([200, { status: "applied", kind: "document", documentId: SCAN }]);
      session = await open("lab", viewportKey);
      await session.page.locator('[data-testid="v3-ai-lab-question-input"]').fill(QUESTION);
      await session.page.keyboard.press("Control+Enter");
      await session.page.waitForSelector('[data-testid="v3-ai-lab-answer"]');
      await session.page.locator('[data-testid="v3-ai-lab-finding"]').fill(FINDING);
      await session.page.keyboard.press("Control+Enter");
      await session.page.waitForSelector('[data-testid="v3-ai-lab-proposal"]');
      await session.page.locator('[data-testid="v3-ai-lab-apply"]').click();
      await session.page.waitForSelector('[data-testid="v3-ai-lab-applied"]');
      await session.page.locator('[data-testid="v3-ai-lab-applied"]').scrollIntoViewIfNeeded();
      await shot(session, "lab-applied");
      await session.page.getByRole("button", { name: "Новая проверка" }).last().click();
      await session.page.waitForFunction(() => document.querySelector('[data-testid="v3-ai-lab-question-input"]') === document.activeElement);
      const labHarness = await close(session);
      check(labHarness.actions.some((entry) => entry.startsWith("discardAiLabAction")), `lab: «Новая проверка» discards (${labHarness.actions.join(" | ")})`);
      check(labHarness.refreshes === 1, "lab: the section is re-read after «Применить»");
    }
  } finally {
    await browser.close();
    server.close();
  }
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  if (failures.length > 0) process.exitCode = 1;
  else process.stdout.write(`${JSON.stringify({ ok: true, outDir })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
