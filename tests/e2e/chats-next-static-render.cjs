"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция .ts/.tsx на лету возможна только через require,
// ESM-import здесь не применим по построению (тот же приём, что в conversations-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «WhatsApp» (`/v3/inbox`), «Переписка» (`/v3/messages`) и рамка переписки по делу в «Новом виде» (решение владельца
 * 27.10.2026, поток «chats»). Страницы строят НАСТОЯЩИЕ `inbox/page.tsx` и `messages/page.tsx`: подменены только границы
 * (актёр, чтения, cookie переключателя); движок чатов (`InboxChat`, `CaseChatWorkspace`) настоящий. Люди, номера, дела и
 * сообщения выдуманы (tests/e2e/chats-next-fixtures.cjs). Живой Supabase, WAHA, Wazzup и права сервера этот стенд не
 * проверяет: проверяются выбор вида, вёрстка, адаптив, фокус, доступность и то, что рамка не добавляет отправку.
 *
 *   node tests/e2e/chats-next-static-render.cjs --page-json
 *     → stdout: JSON [{ name, html }] — разметка настоящих страниц в четырёх режимах переключателя (администратор с cookie,
 *       без cookie, просмотр роли с cookie, сотрудник с cookie) и без нового вида вовсе (на базовом коммите все режимы —
 *       прежний вид: так сравнивается «байт в байт»). Для администратора с cookie проверяются свойства ленивого входа.
 *   node tests/e2e/chats-next-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844 и проверки (JSON-строки; при нарушении код 1).
 *       По умолчанию outDir — .impeccable/review (не коммитится).
 */

const { existsSync, readFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
const LOGO_URL = pathToFileURL(join(ROOT, "public/brand/evo-logo.png")).href;

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => { module._compile(compile(readFileSync(filename, "utf8")), filename); };
}
Module._extensions[".png"] = (module) => { module.exports = { src: LOGO_URL, width: 1843, height: 842 }; };
const cssModules = new Map();
Module._extensions[".css"] = (module, filename) => {
  cssModules.set(filename, readFileSync(filename, "utf8"));
  module.exports = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });
};
require("./next-dynamic-alias.cjs");
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

const { createElement: h } = require("react");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { renderSettled } = require("./render-settled.cjs");
const { assertFlightProps } = require("./flight-props.cjs");
const fx = require("./chats-next-fixtures.cjs");

const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const withContexts = (node, pathname, search) => h(AppRouterContext.Provider, { value: routerStub },
  h(PathnameContext.Provider, { value: pathname }, h(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
    h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));

// Cookie «Нового вида»: страница спрашивает `isNextUi`; вне запроса `cookies()` не работает, поэтому сценарий задаёт её сам.
let nextCookie = false;
require("next/headers").cookies = async () => ({ get: (name) => (name === "evo_ui" && nextCookie ? { name, value: "next" } : undefined) });

// --- настоящие страницы с подменёнными чтениями --------------------------------------------------------------------
function stubShared(actor) {
  require(join(ROOT, "src/lib/platform-guards.ts")).requireV3PageActor = async () => actor;
  require(join(ROOT, "src/lib/supabase/config.ts")).getSupabasePublicConfig = () => ({ url: "http://127.0.0.1:9", publishableKey: "synthetic-harness-key" });
  require(join(ROOT, "src/lib/i18n.ts")).getLocale = async () => "ru";
  require(join(ROOT, "src/lib/v3/reply-snippets-source.ts")).readV3ReplySnippets = async () => fx.SNIPPETS;
}
function stubInbox(actor, scenario) {
  stubShared(actor);
  require(join(ROOT, "src/lib/v3/inbox-source.ts")).readInbox = async () => ({ view: scenario.inbox });
  require(join(ROOT, "src/lib/v3/inbox-media.ts")).readV3InboxMediaAttachmentContext = async () => null;
  require(join(ROOT, "src/lib/v3/telephony-dial-source.ts")).readDialOptions = async () => ({ status: "ready", mapped: true });
}
function stubMessages(actor, scenario) {
  stubShared(actor);
  const { readCaseChatQueueWith } = require(join(ROOT, "src/components/v3/case-chat/case-chat-queue.ts"));
  const chat = require(join(ROOT, "src/lib/v3/case-chat-source.ts"));
  chat.readStaffCaseChatQueue = async (_actor, query, queue) => {
    if (scenario.failure) throw new chat.CaseChatReadError(scenario.failure);
    return readCaseChatQueueWith(async (filter) => {
      const needle = (query ?? "").trim().toLocaleLowerCase("ru");
      const found = scenario.rows.filter((item) => (!needle || item.studentDisplayName.toLocaleLowerCase("ru").includes(needle)) && (filter === "all" || item.awaitState === filter));
      return { rows: found, truncated: false };
    }, queue, () => new Date(fx.READ_AT));
  };
  chat.readCaseChatPage = async () => fx.threadPage();
  require(join(ROOT, "src/lib/v3/case-work-source.ts")).readCaseQueueRow = async (_actor, target) => target.studentCaseId === fx.QUEUE_ROW.studentCaseId ? fx.QUEUE_ROW : null;
  require(join(ROOT, "src/lib/platform-admissions.ts")).getPlatformStudentCaseView = async (_actor, id) => ({
    access: "full", studentCase: { studentDisplayName: scenario.rows.find((item) => item.studentCaseId === id)?.studentDisplayName ?? "Студент", state: "active" },
  });
}
const PAGES = {
  inbox: { file: "src/app/(v3)/v3/inbox/page.tsx", pathname: "/v3/inbox", scenarios: fx.INBOX_SCENARIOS, stub: stubInbox },
  messages: { file: "src/app/(v3)/v3/messages/page.tsx", pathname: "/v3/messages", scenarios: fx.MESSAGES_SCENARIOS, stub: stubMessages },
};
async function buildPage(kind, name, actor) {
  const page = PAGES[kind];
  const scenario = page.scenarios[name];
  page.stub(actor, scenario);
  const { default: Page } = require(join(ROOT, page.file));
  const element = await Page({ searchParams: Promise.resolve(scenario.search) });
  return { element, scenario, search: new URLSearchParams(scenario.search).toString(), pathname: page.pathname };
}

const JSON_PAGES = [["inbox", "chat"], ["inbox", "not-connected"], ["inbox", "wazzup-read-only"], ["inbox", "list"], ["inbox", "empty"], ["inbox", "empty-filtered"], ["messages", "thread"], ["messages", "cabinet"], ["messages", "failure"]];
const MODES = [
  ["admin-cookie", fx.ACTORS.admin, true], ["admin-no-cookie", fx.ACTORS.admin, false],
  ["preview-cookie", fx.ACTORS.preview, true], ["preview-no-cookie", fx.ACTORS.preview, false],
  ["sales-cookie", fx.ACTORS.sales, true], ["sales-no-cookie", fx.ACTORS.sales, false],
];
async function pageJson() {
  const out = [];
  try {
    for (const [kind, name] of JSON_PAGES) {
      for (const [mode, actor, cookie] of MODES) {
        nextCookie = cookie;
        const { element, search, pathname } = await buildPage(kind, name, actor);
        // Администратору с cookie страница отдаёт ленивый вход: его свойства пересекают границу сервер → клиент.
        if (cookie && actor.systemRole === "admin" && !actor.presentationRole) assertFlightProps(element.props, `${kind}:${name}`);
        out.push({ name: `${kind}:${name}:${mode}`, html: await renderSettled(withContexts(element, pathname, search)) });
      }
    }
  } finally {
    nextCookie = false;
  }
  process.stdout.write(JSON.stringify(out));
}

// --- Chromium: настоящие компоненты нового вида в оболочке ---------------------------------------------------------
const LINK_SHIM = `
const React = require("react");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const ONLY = new Set(["prefetch", "scroll", "replace", "shallow", "locale", "passHref", "legacyBehavior", "onNavigate", "as", "unstable_dynamicOnHover"]);
function Link(props) {
  const router = React.useContext(AppRouterContext);
  const rest = {};
  for (const [key, value] of Object.entries(props)) if (!ONLY.has(key) && key !== "href" && key !== "onClick") rest[key] = value;
  const href = String(props.href);
  return React.createElement("a", { ...rest, href, onClick(event) {
    if (props.onClick) props.onClick(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    router.push(href);
  } });
}
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
`;
const FIXTURE_ID = "chats-next-fixture";
const CLIENT_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const { InboxNextPage } = require("@/components/v3/inbox-next/InboxNextPage");
const { CaseChatNextPage } = require("@/components/v3/case-chat-next/CaseChatNextPage");
const { CaseChatNextFailure } = require("@/components/v3/case-chat-next/CaseChatNextFailure");
const h = React.createElement;
const fixture = JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
window.__harness = { pushes: [], actions: [], errors: [], refreshes: 0, urls: [] };
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("/api/v3/inbox/pulse")) return new Response(JSON.stringify({ list: null, chat: null }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("/api/v3/inbox/conversations/")) return new Response(JSON.stringify({ messages: [], hasOlder: false }), { status: 200, headers: { "Content-Type": "application/json" } });
  return originalFetch(input, init);
};
const router = {
  push: (href) => { window.__harness.pushes.push(href); }, replace: (href) => { window.__harness.pushes.push(href); },
  refresh() { window.__harness.refreshes += 1; }, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
};
function App() {
  // Как у Next: replaceState меняет useSearchParams; файл открыт по file://, поэтому настоящий вызов может отказать.
  const [search, setSearch] = React.useState(fixture.search);
  React.useEffect(() => {
    const original = window.history.replaceState.bind(window.history);
    window.history.replaceState = (state, unused, url) => {
      window.__harness.urls.push(String(url));
      try { original(state, unused, url); } catch { /* file:// */ }
      setSearch(new URL(String(url), "https://crm.invalid").search.slice(1));
    };
    return () => { window.history.replaceState = original; };
  }, []);
  const props = fixture.props;
  const body = fixture.kind === "inbox" ? h(InboxNextPage, props)
    : fixture.kind === "messages-failure" ? h(CaseChatNextFailure, props)
    : h(CaseChatNextPage, props);
  return h(AppRouterContext.Provider, { value: router },
    h(PathnameContext.Provider, { value: fixture.pathname },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
          h("div", { className: "v3-world", "data-surface": "staff", "data-ui": "next" },
            h(AppShell, { actor: fixture.actor, initialNotifications: null, nextUi: { enabled: true } }, body))))));
}
createRoot(document.getElementById("root")).render(h(App));
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "true"; }));
`;

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${pathToFileURL(join(dir, "files")).href}/`);
  });
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8"), readFileSync(join(ROOT, "src/app/(v3)/ai-agent.css"), "utf8"), ...cssModules.values()].join("\n");
}

async function buildBundle(outFile) {
  const esbuild = require("esbuild");
  // Серверные действия чатов отвечают синтетикой этой вкладки: ничего не отправляется и не пишется.
  const caseChatStub = `
import { composeCaseChatQueue } from "@/components/v3/case-chat/case-chat-queue";
const fixture = () => JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
let store = null;
const rows = () => (store ??= fixture().rows.map((item) => ({ ...item })));
const threadStates = new Map();
export async function readCaseChatPageAction(caseId) {
  const page = fixture().props.initialPage;
  const state = threadStates.get(caseId);
  return { status: "ready", page: state ? { ...page, thread: { ...page.thread, awaitState: state } } : page };
}
export async function loadStaffCaseChatThreadsAction(query, queue) {
  window.__harness.actions.push("load:" + queue + ":" + (query || ""));
  const needle = (query || "").trim().toLocaleLowerCase("ru");
  const found = rows().filter((item) => !needle || item.studentDisplayName.toLocaleLowerCase("ru").includes(needle));
  return { status: "ready", read: composeCaseChatQueue({ all: { rows: found, truncated: false } }, queue, fixture().readAt) };
}
export async function markCaseChatReadAction() { return { status: "saved", requestId: null }; }
export async function postCaseChatMessageAction() { window.__harness.actions.push("post"); return { status: "unavailable", requestId: null }; }
export async function setCaseChatAwaitAction(_previous, form) {
  const caseId = form.get("case_id");
  const state = form.get("state");
  window.__harness.actions.push("await:" + state + ":" + caseId);
  const target = rows().find((item) => item.studentCaseId === caseId);
  if (target) target.awaitState = state;
  threadStates.set(caseId, state);
  return { status: "saved", requestId: form.get("request_id") };
}`;
  const whatsappStub = `
export async function sendPlatformWhatsAppMessageAction(input) { window.__harness.actions.push("send:" + input.requestId); return { status: "unavailable", workItemId: null, attemptId: null, messageId: null }; }
export async function reconcilePlatformWhatsAppSendAction(input) { window.__harness.actions.push("check:" + input.attemptId); return { status: "readback_failed" }; }`;
  const plugin = {
    name: "chats-next-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        if (args.path.endsWith("platform-case-chat-actions.ts")) return { contents: caseChatStub, loader: "ts", resolveDir: ROOT };
        if (args.path.endsWith("platform-provider-actions.ts")) return { contents: whatsappStub, loader: "ts", resolveDir: ROOT };
        if (args.path.endsWith("ui-next-actions.ts")) return { contents: "export async function setNextUiAction() {}", loader: "ts" };
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return { contents: names.map((name) => `export async function ${name}() { window.__harness.errors.push("server action ${name}"); throw new Error("chats-next harness: server action ${name} is not available"); }`).join("\n"), loader: "ts" };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "chats-next-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic", tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } }; var __dirname = \"/\";" }, plugins: [plugin], logLevel: "error",
  });
}

// Страницы Chromium: настоящая страница в режиме «администратор с cookie» даёт свойства входа; вход — `fixture.kind`.
async function pageFixtures() {
  const out = {};
  nextCookie = true;
  try {
    for (const name of Object.keys(fx.INBOX_SCENARIOS)) {
      const { element, scenario, search } = await buildPage("inbox", name, fx.ACTORS.admin);
      out[`inbox-${name}`] = { kind: "inbox", title: "WhatsApp", pathname: "/v3/inbox", search, props: element.props, rows: [], readAt: fx.READ_AT, scenario };
    }
    for (const name of Object.keys(fx.MESSAGES_SCENARIOS)) {
      const { element, scenario, search } = await buildPage("messages", name, fx.ACTORS.admin);
      const failed = Boolean(scenario.failure);
      out[`messages-${name}`] = { kind: failed ? "messages-failure" : "messages", title: "Переписка", pathname: "/v3/messages", search, props: element.props, rows: scenario.rows, readAt: fx.READ_AT, scenario };
    }
  } finally {
    nextCookie = false;
  }
  return out;
}

const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 } },
  d1280: { viewport: { width: 1280, height: 800 } },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};
const NARROW = { m360: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, m320: { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } };

module.exports = { VIEWPORTS, NARROW, FIXTURE_ID, compileCss, buildBundle, pageFixtures, fx };

if (require.main === module) {
  const mode = process.argv.includes("--page-json") ? "page-json" : process.argv.includes("--screenshots") ? "screenshots" : null;
  if (mode === "page-json") pageJson().catch((error) => { console.error(error); process.exit(1); });
  else if (mode === "screenshots") require("./chats-next-checks.cjs").run(module.exports).catch((error) => { console.error(error); process.exit(1); });
  else { console.error("usage: chats-next-static-render.cjs --page-json | --screenshots [outDir]"); process.exit(2); }
}
