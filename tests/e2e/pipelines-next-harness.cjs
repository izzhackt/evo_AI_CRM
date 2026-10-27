"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Общая часть клиентского стенда «Нового вида» для досок (`tests/e2e/pipelines-next-static-render.cjs`): СИНТЕТИЧЕСКИЕ данные
 * `boards-fixtures.cjs` (имена и дела выдуманы), НАСТОЯЩИЕ страницы `pipeline/page.tsx` и `admissions-pipeline/page.tsx` в настоящей
 * оболочке, сборка esbuild для браузера с подменой границ данных и прав и маленький http-сервер: сервер рисует страницу
 * (`renderToString`), браузер гидратирует её теми же страницами и компонентами. Живой Supabase, права, серверные действия и
 * маршрутизатор Next.js стенд не проверяет. Cookie `evo_ui=next` и `harness_actor` приносит контекст Chromium: так страница сама
 * решает (`isNextUi`), какой вид рисовать, как в проде.
 */

const { existsSync, readFileSync } = require("node:fs");
const Module = require("node:module");
const nodeCrypto = require("node:crypto");
const { basename, extname, join, resolve } = require("node:path");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
const LOGO = join(ROOT, "public/brand/evo-logo.png");
// Набор данных и страницы — параметры стенда: запускающий скрипт кладёт `globalThis.__harnessConfig = { fixtures, pages, titles }` до
// `require` этого файла (доски — `boards-fixtures.cjs`, «Отчёт продаж» — `sales-report-fixtures.cjs`; require-хуки глобальные, процесс один).
const { fixtures: FIXTURES, pages: PAGES, titles: TITLES } = globalThis.__harnessConfig;

// --- require-hook: .ts/.tsx компилируются TypeScript'ом в CJS (как в boards-static-render.cjs) -----------------------
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    const source = readFileSync(filename, "utf8");
    module._compile(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, filename);
    // Клиентские модули (`"use client"`) помечены: `flight-props-expand.cjs` не выполняет их как серверные.
    if (/^\s*["']use client["']/u.test(source)) for (const value of Object.values(module.exports)) if (typeof value === "function") value.__useClient = true;
  };
}
Module._extensions[".png"] = (module) => { module.exports = { src: "/__static/evo-logo.png", width: 1843, height: 842 }; };
require("./next-dynamic-alias.cjs");
const fixtures = require(FIXTURES);
const { ACTORS, STUBS, selectSalesRows, setActor, setSaveSucceeds, syntheticUuids } = fixtures;

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (typeof request === "string" && Object.hasOwn(STUBS, request)) {
    const filename = join(ROOT, ".stub", `${request.replace(/[^a-z0-9]+/giu, "_")}.js`);
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
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    return originalResolve.call(this, base, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const { createElement } = require("react");
const { renderToString } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");

let currentUi = null;
require("next/headers").cookies = async () => ({
  get: (name) => (name === "evo_ui" && currentUi === "next" ? { name, value: "next" } : undefined),
});

const React = require("react");
/**
 * Серверные (async) компоненты страницы: клиентский `renderToString` их не рисует, поэтому стенд сам «дожидается» их, как это делает
 * сервер Next: вызывает async-функцию с её свойствами и подставляет результат, обходя и свойства-слоты (`dynamics`, `sheet`…).
 */
async function resolveServer(node) {
  if (Array.isArray(node)) return Promise.all(node.map((item) => resolveServer(item)));
  if (node === null || typeof node !== "object" || !node.$$typeof) return node;
  let element = node;
  while (element && typeof element === "object" && element.$$typeof && typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    element = await element.type(element.props);
    if (!element || typeof element !== "object" || !element.$$typeof) return resolveServer(element);
  }
  const props = {};
  for (const [key, value] of Object.entries(element.props ?? {})) props[key] = value && typeof value === "object" && (value.$$typeof || Array.isArray(value)) ? await resolveServer(value) : value;
  // Дети — аргументами, как у JSX: массив в `props.children` потребовал бы ключей.
  const { children, ...rest } = props;
  if (!("children" in props)) return React.cloneElement(element, rest);
  return React.cloneElement(element, rest, ...(Array.isArray(children) ? children : [children]));
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
/**
 * `renderToString`, пока разметка не устоится: ленивые куски нового вида грузятся асинхронно. Предсказуемые `randomUUID()` действуют и при
 * сборке страницы, и при отрисовке (серверные части вроде «Менеджеров в отчёте» берут их прямо в теле компонента).
 */
async function settled(build) {
  let previous = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let html = null;
    const originalUuid = nodeCrypto.randomUUID;
    nodeCrypto.randomUUID = syntheticUuids();
    try { html = renderToString(await build()); } catch (error) { if (!/suspended while responding to synchronous input/u.test(String(error?.message))) throw error; } finally { nodeCrypto.randomUUID = originalUuid; }
    if (html !== null && html === previous) return html;
    previous = html;
    await pause(15);
  }
  throw new Error("страница не устоялась");
}

/** Страница в оболочке для запроса: вид и сотрудника задают cookie (`ui`, `actor`). */
async function renderRequest(pathname, search, { ui, actor, rows }) {
  return settled(async () => {
    setActor(actor);
    selectSalesRows(rows);
    currentUi = ui;
    try {
      const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
      const content = await resolveServer(await require(join(ROOT, PAGES[pathname])).default({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) }));
      const nextRoot = ui === "next" && actor === "admin";
      const params = new URLSearchParams(search);
      return createElement(AppRouterContext.Provider, { value: { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} } },
        createElement(PathnameContext.Provider, { value: pathname },
          createElement(SearchParamsContext.Provider, { value: params },
            createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
              createElement("div", { className: "v3-world", "data-surface": "staff", "data-ui": nextRoot ? "next" : undefined },
                createElement(AppShell, { actor: ACTORS[actor], initialNotifications: null }, content))))));
    } finally {
      setActor("admin");
      selectSalesRows("default");
      currentUi = null;
    }
  });
}

// --- браузерная сборка ---------------------------------------------------------------------------------------------
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
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target) return;
    event.preventDefault();
    router.push(href);
  } });
}
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
`;

const HYDRATE_ENTRY = () => `
const fixtures = require(${JSON.stringify(FIXTURES)});
fixtures.setSaveSucceeds(true);
const React = require("react");
const { hydrateRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const PAGES = {
${Object.entries(PAGES).map(([path, file]) => `  ${JSON.stringify(path)}: () => require(${JSON.stringify("@/" + file.replace(/^src\//u, "").replace(/\.tsx$/u, ""))}).default,`).join("\n")}
};
${resolveServer.toString()}
const h = React.createElement;
const IMAGE = { ...imageConfigDefault, unoptimized: true };
const cookie = (name) => document.cookie.split("; ").find((one) => one.startsWith(name + "="))?.slice(name.length + 1) ?? null;
async function renderPage(pathname, search) {
  globalThis.__harnessUuid = fixtures.syntheticUuids();
  globalThis.__harnessUi = cookie("evo_ui");
  fixtures.setActor(cookie("harness_actor") ?? "admin");
  fixtures.selectSalesRows(cookie("harness_rows") ?? "default");
  return resolveServer(await PAGES[pathname]()({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) }));
}
function Harness({ initial }) {
  const [view, setView] = React.useState(initial);
  const router = React.useMemo(() => {
    const load = async (href, mode) => {
      const url = new URL(href, location.href);
      if (mode === "push") history.pushState(null, "", url.pathname + url.search);
      if (mode === "replace") history.replaceState(null, "", url.pathname + url.search);
      const content = await renderPage(url.pathname, url.search);
      React.startTransition(() => setView({ pathname: url.pathname, search: url.search.slice(1), content }));
    };
    return {
      push: (href) => { window.__harness.pushes.push(href); void load(href, "push"); },
      replace: (href) => { void load(href, "replace"); },
      refresh: () => { window.__harness.refreshes.push(location.pathname + location.search); void load(location.pathname + location.search, null); },
      back: () => history.back(), forward: () => history.forward(), prefetch() {}, hmrRefresh() {},
    };
  }, []);
  React.useEffect(() => {
    const sync = () => setView((current) => ({ ...current, search: location.search.slice(1) }));
    window.addEventListener("harness:pushstate", sync);
    window.addEventListener("popstate", sync);
    document.documentElement.dataset.hydrated = "true";
    return () => { window.removeEventListener("harness:pushstate", sync); window.removeEventListener("popstate", sync); };
  }, []);
  const searchParams = React.useMemo(() => new URLSearchParams(view.search), [view.search]);
  const actor = cookie("harness_actor") ?? "admin";
  const nextRoot = cookie("evo_ui") === "next" && actor === "admin";
  return h(AppRouterContext.Provider, { value: router },
    h(PathnameContext.Provider, { value: view.pathname },
      h(SearchParamsContext.Provider, { value: searchParams },
        h(ImageConfigContext.Provider, { value: IMAGE },
          h("div", { className: "v3-world", "data-surface": "staff", "data-ui": nextRoot ? "next" : undefined },
            h(AppShell, { actor: fixtures.ACTORS[actor], initialNotifications: null }, view.content))))));
}
(async () => {
  window.__harness = { pushes: [], refreshes: [], recoverable: [] };
  const pushState = history.pushState.bind(history);
  history.pushState = (...args) => { pushState(...args); window.dispatchEvent(new Event("harness:pushstate")); };
  const initial = { pathname: location.pathname, search: location.search.slice(1), content: await renderPage(location.pathname, location.search) };
  hydrateRoot(document.getElementById("root"), h(Harness, { initial }), {
    onRecoverableError: (error) => window.__harness.recoverable.push(String((error && error.message) || error)),
  });
})();
`;

async function bundleHydration() {
  const esbuild = require("esbuild");
  const stubPattern = new RegExp(`^(${Object.keys(STUBS).map((key) => key.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")).join("|")})$`);
  const plugin = {
    name: "pipelines-next-harness",
    setup(build) {
      build.onResolve({ filter: stubPattern }, (args) => ({ path: args.path, namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
        contents: `module.exports = require(${JSON.stringify(FIXTURES)}).STUBS[${JSON.stringify(args.path)}];`, resolveDir: ROOT, loader: "js",
      }));
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^node:crypto$/ }, () => ({ path: "uuid", namespace: "uuid" }));
      build.onLoad({ filter: /.*/, namespace: "uuid" }, () => ({ contents: "module.exports = { randomUUID: () => globalThis.__harnessUuid() };", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      // `next/dynamic` — версия для App Router (как в сборке Next); `next/headers` — cookie «Нового вида» из document.cookie.
      build.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: require.resolve("next/dist/shared/lib/app-dynamic") }));
      build.onResolve({ filter: /^next\/headers$/ }, () => ({ path: "headers", namespace: "headers" }));
      build.onLoad({ filter: /.*/, namespace: "headers" }, () => ({
        contents: `module.exports = { cookies: async () => ({ get: (name) => (name === "evo_ui" && globalThis.__harnessUi === "next" ? { name, value: "next" } : undefined) }) };`,
        loader: "js",
      }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: "/__static/evo-logo.png", width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^\s*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/gmu)].map((match) => match[1]);
        return { contents: names.map((name) => `export async function ${name}() { throw new Error("server action unavailable in harness: ${name}"); }`).join("\n"), loader: "js" };
      });
    },
  };
  const result = await esbuild.build({
    stdin: { contents: HYDRATE_ENTRY(), resolveDir: ROOT, loader: "js", sourcefile: "pipelines-next-entry.js" },
    bundle: true, write: false, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: `var process = globalThis.process || { env: { NODE_ENV: "development" } };` },
    plugins: [plugin], logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

/** CSS сборки (Tailwind v4 как в сборке) + v3.css; шрифты — с того же сервера. */
async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => readFileSync(join(ROOT, "node_modules/@fontsource-variable", font, "wght.css"), "utf8").replaceAll("url(./files/", `url(/__fonts/${font}/files/`));
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8")].join("\n");
}

const cookieOf = (request, name) => (request.headers.cookie ?? "").split("; ").find((one) => one.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;

async function startServer(css, bundle) {
  const http = require("node:http");
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      if (url.pathname === "/__hydrate.js") { response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }); response.end(bundle); return; }
      if (url.pathname === "/__static/evo-logo.png") { response.writeHead(200, { "content-type": "image/png" }); response.end(readFileSync(LOGO)); return; }
      const font = url.pathname.match(/^\/__fonts\/(golos-text|jetbrains-mono)\/files\/([\w.-]+)$/u);
      if (font) {
        response.writeHead(200, { "content-type": extname(font[2]) === ".woff2" ? "font/woff2" : "font/woff" });
        response.end(readFileSync(join(ROOT, "node_modules/@fontsource-variable", font[1], "files", basename(font[2]))));
        return;
      }
      if (!Object.hasOwn(PAGES, url.pathname)) { response.writeHead(404); response.end(); return; }
      const ui = cookieOf(request, "evo_ui") === "next" ? "next" : null;
      const actor = cookieOf(request, "harness_actor") ?? "admin";
      const rows = cookieOf(request, "harness_rows") ?? "default";
      const markup = await renderRequest(url.pathname, url.search.slice(1), { ui, actor, rows });
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end([
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${TITLES[url.pathname]} — EVO CRM (синтетические данные)</title><style>${css}</style><script src="/__hydrate.js" defer></script></head>`,
        `<body class="min-h-full"><div id="root">${markup}</div></body></html>`,
      ].join(""));
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error && error.stack ? error.stack : error));
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { ROOT, bundleHydration, compileCss, fixtures, renderRequest, resolveServer, setSaveSucceeds, startServer };
