"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция .ts/.tsx на лету возможна только через require
// (тот же приём, что в today-static-render.cjs и requests-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Настоящие страницы потока «tools» («Календарь», «База знаний» с разделами «Документы» и «Шаблоны ответов», «Командный чат» и
 * прежние `/v3/documents`, `/v3/reply-snippets`) в четырёх режимах переключателя «Новый вид»: администратор с cookie, администратор
 * без cookie, просмотр роли с cookie, сотрудник с cookie. Подменены только границы страницы: актёр, cookie и читатели данных
 * (синтетика `tools-next-fixtures.cjs`); `page.tsx`, его проверки прав и выбор вида — настоящие. Данные ВЫДУМАНЫ и не являются
 * записями EVO.
 *
 *   node tests/e2e/tools-next-pages.cjs --json
 *     → stdout: JSON [{ name, html | rejected | redirect }] — разметка страницы без оболочки (для tests/ui-next-tools.test.mjs).
 *       Свойства ленивых входов нового вида проверяются на сериализацию (`assertFlightProps`): не сериализуются — бросает.
 *   node tests/e2e/tools-next-pages.cjs --legacy-json
 *     → то же для прежнего вида без cookie (администратор): разметка для сравнения с базовым коммитом байт в байт.
 */

const { existsSync, readFileSync } = require("node:fs");
const Module = require("node:module");
require("./next-dynamic-alias.cjs");
const { renderSettled } = require("./render-settled.cjs");
const { assertFlightProps } = require("./flight-props.cjs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");
const fx = require("./tools-next-fixtures.cjs");

const ROOT = resolve(__dirname, "../..");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => { module._compile(compile(readFileSync(filename, "utf8")), filename); };
}
Module._extensions[".png"] = (module, filename) => { module.exports = { src: pathToFileURL(filename).href, width: 1843, height: 842 }; };
// CSS-модуль: имя класса — ключ.
Module._extensions[".css"] = (module) => {
  const classes = new Proxy({}, { get: (_target, key) => (key === "__esModule" ? true : key === "default" ? classes : typeof key === "string" ? key : undefined) });
  module.exports = classes;
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

const React = require("react");
const { createElement, cloneElement, isValidElement } = React;
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");

const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const withContexts = (node, pathname = "/v3/knowledge", search = "") =>
  createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: pathname },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));

// «Новый вид»: страница спрашивает `isNextUi`; вне запроса `cookies()` не работает, поэтому сценарий задаёт её сам.
let nextCookie = false;
require("next/headers").cookies = async () => ({ get: (name) => (name === "evo_ui" && nextCookie ? { name, value: "next" } : undefined) });

const AsyncFunction = (async () => {}).constructor;
/** Асинхронные серверные компоненты (`KnowledgeDocuments`, `KnowledgeSnippets`) Next читает сам; здесь — их результат в дерево. */
async function resolveServer(node) {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServer));
  if (!isValidElement(node)) return node;
  if (typeof node.type === "function" && node.type instanceof AsyncFunction) return resolveServer(await node.type(node.props));
  const { children } = node.props;
  if (children === undefined) return node;
  const resolved = await resolveServer(children);
  return Array.isArray(resolved) ? cloneElement(node, undefined, ...resolved) : cloneElement(node, undefined, resolved);
}

const MODES = [
  ["admin-cookie", fx.ADMIN, true],
  ["admin-no-cookie", fx.ADMIN, false],
  ["preview-cookie", fx.PREVIEW, true],
  ["staff-cookie", fx.STAFF, true],
];

const guards = require(join(ROOT, "src/lib/platform-guards.ts"));
const calendarSource = require(join(ROOT, "src/lib/v3/calendar-source.ts"));
const knowledgeSource = require(join(ROOT, "src/lib/v3/knowledge-source.ts"));
const snippetsSource = require(join(ROOT, "src/lib/v3/reply-snippets-source.ts"));
const chatSource = require(join(ROOT, "src/lib/v3/team-chat-source.ts"));
const supabaseConfig = require(join(ROOT, "src/lib/supabase/config.ts"));
require(join(ROOT, "src/lib/i18n.ts")).getLocale = async () => "ru";

calendarSource.readToday = async () => fx.TODAY;
calendarSource.readNowMinutes = async () => 600;
calendarSource.readCalendarWorkspace = async () => ({
  access: { caseTasks: true, staffTasks: true, tasks: true }, tasks: fx.WEEK, undatedNextCursor: null, cases: fx.CASE_OPTIONS, casesHaveMore: false, assignees: [],
});
calendarSource.readPersonalCalendarTaskTarget = async () => { throw new Error("harness: no task target"); };
knowledgeSource.readCompanyKnowledge = async () => ({
  folders: fx.FOLDERS.filter((folder) => folder.kind === "company").map((folder) => ({ id: folder.id, parentId: folder.parentId === "company" ? null : folder.parentId, name: folder.name, version: folder.version })),
  files: fx.FILES.filter((file) => file.kind === "company").map((file) => ({ id: file.id, folderId: file.folderId === "company" ? null : file.folderId, name: file.name, version: file.version, currentVersionId: file.currentVersionId, size: file.size, addedAt: file.addedAt })),
});
knowledgeSource.readKnowledgeStudents = async () => [{ id: fx.id("dddddddd", 41), name: "Айдана Сыдыкова" }];
knowledgeSource.readKnowledgeDocuments = async () => ({
  documents: fx.FILES.filter((file) => file.kind === "student").map((file) => ({ versionId: file.currentVersionId, caseId: fx.id("dddddddd", 41), name: file.name, size: file.size, addedAt: file.addedAt })), complete: true,
});
snippetsSource.readV3ReplySnippets = async () => fx.SNIPPETS.map((item) => item.snippet);
supabaseConfig.getSupabasePublicConfig = () => ({ url: "http://127.0.0.1:9", publishableKey: "synthetic-harness-key" });
let chatFails = false;
chatSource.readV3TeamChatFeed = async () => {
  if (chatFails) throw new Error("synthetic read failure");
  return { page: fx.CHAT.page, channels: fx.CHAT.channels, participants: fx.CHAT.participants };
};

const page = (path) => require(join(ROOT, "src/app", "(v3)", "v3", path, "page.tsx")).default;
const SCREENS = [
  ["calendar", "calendar", {}, "/v3/calendar", "view=week&date=2026-09-26"],
  ["knowledge-library", "knowledge", {}, "/v3/knowledge", "area=internal"],
  ["knowledge-documents", "knowledge", { section: "documents" }, "/v3/knowledge", "section=documents"],
  ["knowledge-snippets", "knowledge", { section: "snippets" }, "/v3/knowledge", "section=snippets"],
  ["team-chat", "team-chat", { channel: "general" }, "/v3/team-chat", "channel=general"],
  ["team-chat-failure", "team-chat", { channel: "general" }, "/v3/team-chat", "channel=general", true],
  ["documents-page", "documents", {}, "/v3/documents", ""],
  ["reply-snippets-page", "reply-snippets", {}, "/v3/reply-snippets", ""],
];

async function renderAll(modes) {
  const RealDate = Date;
  const NOW = new RealDate(fx.NOW).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(NOW); }
    static now() { return NOW; }
  };
  const out = [];
  try {
    for (const [mode, who, cookie] of modes) {
      nextCookie = cookie;
      guards.requireV3PageActor = async () => who;
      for (const [name, route, query, pathname, search, fails] of SCREENS) {
        chatFails = Boolean(fails);
        const label = `${name}:${mode}`;
        try {
          const element = await page(route)({ searchParams: Promise.resolve(query) });
          const resolved = await resolveServer(element);
          if (cookie && who.systemRole === "admin" && !who.presentationRole) assertFlightProps(resolved.props, `${label}: ленивый вход`);
          out.push({ name: label, html: await renderSettled(withContexts(resolved, pathname, search)) });
        } catch (error) {
          const text = String(error?.digest ?? error?.message ?? error);
          if (/NEXT_REDIRECT/u.test(text)) out.push({ name: label, redirect: text.split(";")[2] ?? text });
          else if (/knowledge_forbidden/u.test(text)) out.push({ name: label, rejected: "knowledge_forbidden" });
          else throw error;
        }
      }
    }
  } finally {
    globalThis.Date = RealDate;
    nextCookie = false;
  }
  return out;
}

(async () => {
  if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(await renderAll(MODES)));
  else if (process.argv.includes("--legacy-json")) process.stdout.write(JSON.stringify(await renderAll([MODES[1], MODES[3]])));
  else throw new Error("usage: node tests/e2e/tools-next-pages.cjs --json | --legacy-json");
})().catch((error) => { console.error(error); process.exit(1); });
