"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Новый вид», поток «admin» (решение владельца 27.10.2026): «Настройки», «Маркетинг», «Финансы» и «ИИ-агент» — клиентская сборка НАСТОЯЩИХ
 * компонентов нового вида в настоящей оболочке (`AppShell`) на свойствах, которые отдаёт НАСТОЯЩАЯ страница на СИНТЕТИЧЕСКИХ данных
 * (`admin-next-fixtures.cjs`): люди, заявки, расходы и материалы выдуманы и не являются записями EVO. Серверные действия подменены (вызов и поля
 * формы пишутся в `window.__harness.calls`). Supabase, права и данные этот стенд не проверяет — проверяются вёрстка, токены, адаптив, клавиатура,
 * доступность и путь «строка → панель → действие».
 *
 *   node tests/e2e/admin-next-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844 и проверки (JSON-строки; при нарушении код 1); «до» — прежний вид на тех же данных
 *       (`legacy-*`). По умолчанию outDir — .impeccable/review (не коммитится). `--only a,b` — только эти страницы; `--flows-only` — только сценарии.
 */
const { readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { ROOT } = require("./admin-next-env.cjs");
const { lazySettled } = require("./lazy-settled.cjs");
const { CLIENT_ENTRY } = require("./admin-next-entry.cjs");
const fx = require("./admin-next-fixtures.cjs");

const LOGO_URL = pathToFileURL(join(ROOT, "public/brand/evo-logo.png")).href;
const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 } },
  d1280: { viewport: { width: 1280, height: 800 } },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};

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
const SUPABASE_SHIM = `export function createBrowserClient() { return { auth: { async getSession() { return { data: { session: null }, error: null }; } }, realtime: { async setAuth() {} }, channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; }, async removeChannel() {} }; }`;

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${pathToFileURL(join(dir, "files")).href}/`);
  });
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8"), readFileSync(join(ROOT, "src/app/(v3)/ai-agent.css"), "utf8")].join("\n");
}

async function buildBundle(outFile) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "admin-next-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /^@supabase\/ssr$/ }, () => ({ path: "supabase-ssr", namespace: "supabase" }));
      build.onLoad({ filter: /.*/, namespace: "supabase" }, () => ({ contents: SUPABASE_SHIM, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        if (args.path.endsWith("ui-next-actions.ts")) return { contents: "export async function setNextUiAction() {}", loader: "ts" };
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        // Действия «сохраняют»: вызов и поля формы записаны, состояние возвращается как у настоящего (status: saved). «Показать ещё» отвечает готовой страницей.
        return {
          contents: names.map((name) => `export async function ${name}(state, form) {
  const fields = form && typeof form.entries === "function" ? Object.fromEntries([...form.entries()].map(([key, value]) => [key, typeof value === "string" ? value : "[file]"])) : null;
  window.__harness.calls.push([${JSON.stringify(name)}, fields || state]);
  if (/^loadMore/u.test(${JSON.stringify(name)})) return { status: "available", page: { rows: window.__harness.moreRows || [], nextCursor: null, total: 48, hasMore: false } };
  if (/^(search|read)/u.test(${JSON.stringify(name)})) return { status: "ready", rows: [] };
  return { ...(state || {}), status: "saved", requestId: (fields && fields.request_id) || "static" };
}`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "admin-next-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } }; var __dirname = \"/\";" }, plugins: [plugin], logLevel: "error",
  });
}

/* --------------------------------------------------------------- страницы стенда */

const SCREEN_OF = { settings: "settings", marketing: "marketing", finance: "finance", "ai-agent": "ai" };
const PATH_OF = (route) => `/v3/${route}`;

/** Страницы: имя → данные для браузера. `legacy-*` — прежний вид (разметка сервера) для снимков «до». */
async function buildPages() {
  const { capture, SCREENS } = require("./admin-next-pages.cjs");
  const { next, legacy } = await capture();
  const mark = (name) => name.replace(/^ai-/u, "ai-");
  const pages = {};
  // Ответ сервера на нажатие строки «Запросов на удаление»: страница с открытым запросом (и возврат к очереди).
  const deletionOpen = next.get("settings-deletion-detail");
  const deletionList = next.get("settings-deletion");
  const routes = {
    "settings-deletion": { [`/v3/settings?section=deletion&request=${fx.settings.DELETION_ROWS[0].id}`]: deletionOpen, "/v3/settings?section=deletion": deletionList },
  };
  for (const [name, route] of SCREENS.map((entry) => [entry[0], entry[1]])) {
    const entry = next.get(name);
    pages[mark(name)] = {
      screen: SCREEN_OF[route], props: entry.props, search: entry.search, pathname: PATH_OF(route), org: fx.ORG, me: fx.ME, actor: fx.ADMIN,
      routes: routes[name] ?? {}, legacyHtml: null,
      moreRows: name === "marketing-leads" ? [{ ...fx.marketing.LEADS_PAGE.rows[0], leadId: fx.id("44444444", 90), name: "Лид со второй страницы" }] : undefined,
    };
    pages[`legacy-${mark(name)}`] = { ...pages[mark(name)], legacyHtml: legacy.get(name) };
  }
  return pages;
}

function writePage(outDir, name, css, data) {
  const path = join(outDir, `admin-next-${name}.html`);
  writeFileSync(path, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Администрирование, новый вид (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div id="root"></div><script type="application/json" id="fixture">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="admin-next-bundle.js"></script></body></html>`);
  return path;
}

module.exports = { VIEWPORTS, buildBundle, buildPages, compileCss, writePage, ROOT, lazySettled, fx };

if (require.main === module) require("./admin-next-checks.cjs").main().catch((error) => { console.error(error); process.exit(1); });
