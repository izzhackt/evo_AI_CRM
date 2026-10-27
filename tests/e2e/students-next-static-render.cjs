"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Студенты», EVO Docs и «Университеты» в «Новом виде» (решение владельца 27.10.2026) — клиентская сборка НАСТОЯЩИХ компонентов
 * (`StudentsNextPage`: вкладки, плитки, `DataTable`, фильтры, панель дела, массовый выбор, EVO Docs, «Нагрузка кураторов»;
 * `UniversitiesListNext`, `UniversityDetailNext`, `ManageIndexNext`, `UniversityFrame`) на СИНТЕТИЧЕСКИХ данных
 * (`students-next-fixtures.cjs`): имена, дела, файлы и даты выдуманы и не являются записями EVO. Адрес в стенде — состояние:
 * `router.push` открывает и закрывает панель дела и меняет вид, как это делает сервер (ответ приходит из заготовленных чтений).
 * Серверные действия подменены: шаг дела «сохраняется» и записывается как вызов, остальные честно отказывают. Supabase, права и
 * данные этот стенд не проверяет — проверяются вёрстка, токены, адаптив, клавиатура, доступность и путь «строка → панель → действие».
 *
 *   node tests/e2e/students-next-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844 и проверки (JSON-строки; при нарушении код 1).
 *       По умолчанию outDir — .impeccable/review (не коммитится). Браузеры — PLAYWRIGHT_BROWSERS_PATH.
 */

const { readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { rowA11yProblems } = require("./row-a11y-probe.cjs");
const { lazySettled } = require("./lazy-settled.cjs");
const legacy = require("./students-static-render.cjs");
const { build } = require("./students-next-fixtures.cjs");

const ROOT = legacy.ROOT;
const LOGO_URL = pathToFileURL(join(ROOT, "public/brand/evo-logo.png")).href;
const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 } },
  d1280: { viewport: { width: 1280, height: 800 } },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};

// --- браузерная сборка ------------------------------------------------------------------------------------------
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
    if (/^https?:/.test(href) && !href.startsWith("https://crm.invalid")) return;
    event.preventDefault();
    router.push(href);
  } });
}
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
`;

const CLIENT_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const { Icon } = require("@/components/icons");
const { StudentsNextPage } = require("@/components/v3/students-next/StudentsNextPage");
const { UniversitiesListNext } = require("@/components/v3/universities-next/UniversitiesListNext");
const { UniversityDetailNext } = require("@/components/v3/universities-next/UniversityDetailNext");
const { UniversityFrame } = require("@/components/v3/universities-next/UniversityFrame");
const { UniversityBack } = require("@/components/v3/universities-next/UniversityBack");
const { ManageIndexNext } = require("@/components/v3/universities-next/ManageIndexNext");
const h = React.createElement;
const fx = JSON.parse(document.getElementById("fixture").textContent);
window.__harness = { pushes: [], calls: [], history: [fx.search] };

const thumb = () => h("span", { "aria-hidden": "true", className: "grid size-12 shrink-0 place-items-center rounded-nav border border-border bg-surface-2 text-fg-3" }, h(Icon, { name: "building", size: 20 }));
const photo = () => h("figure", { className: "min-w-0" }, h("div", { className: "flex aspect-[4/3] items-center justify-center rounded-card border border-border bg-surface-2 px-6 text-center t-body-compact text-fg-3" }, "Проверенное фото кампуса пока не добавлено"),
  h("figcaption", { className: "t-meta mt-1.5 text-fg-3" }, "Фото: автор · лицензия · кадрировано"));
const geography = () => h("section", { "aria-label": "Город и стоимость", className: "rounded-card border border-border bg-surface p-5 t-body-compact text-fg-2" }, "Город и стоимость для кабинета студента (прежняя панель)");

function body(search) {
  switch (fx.kind) {
    case "students": return h(StudentsNextPage, { input: fx.inputs[search] ?? fx.inputs[fx.search], manageUniversities: true });
    case "universities": return h(UniversitiesListNext, { ...fx.data, rows: fx.data.rows.map((row) => ({ ...row, thumb: thumb() })) });
    case "university": return h(UniversityDetailNext, { ...fx.data, photo: photo() }, fx.data.canManage ? geography() : null);
    case "manage": return h(UniversityFrame, {
      title: "Управление каталогом", back: h(UniversityBack, { href: "/v3/universities", label: "Все университеты" }),
      actions: h("a", { href: "/v3/universities/manage?new=1", className: "v3-raised inline-flex h-11 items-center justify-center gap-1.5 rounded-ctl border border-accent bg-accent px-4 t-label text-on-accent" }, "Добавить университет"),
    }, h(ManageIndexNext, fx.data));
    default: throw new Error("unknown fixture kind " + fx.kind);
  }
}

function App() {
  const [search, setSearch] = React.useState(fx.search);
  const router = React.useMemo(() => ({
    // Ответ сервера приходит не мгновенно: панель открывается после обращения, а не в тот же такт, что нажатие.
    push(href) {
      window.__harness.pushes.push(href);
      const url = new URL(href, "https://crm.invalid");
      if (url.pathname !== fx.path) return;
      setTimeout(() => { const next = url.search.slice(1); window.__harness.history.push(next); setSearch(next); }, 60);
    },
    replace(href) { window.__harness.pushes.push(href); },
    back() { const { history } = window.__harness; if (history.length > 1) { history.pop(); setSearch(history[history.length - 1]); } },
    refresh() { window.__harness.calls.push("refresh"); }, forward() {}, prefetch() {}, hmrRefresh() {},
  }), []);
  return h(AppRouterContext.Provider, { value: router },
    h(PathnameContext.Provider, { value: fx.path },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
          h("div", { className: "v3-world", "data-surface": "staff", "data-ui": "next" },
            h(AppShell, { actor: fx.actor, initialNotifications: null, nextUi: { enabled: true } }, body(search)))))));
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
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8")].join("\n");
}

async function buildBundle(outFile) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "students-next-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      // Серверные действия: шаг дела «сохраняется» и записывается как вызов, остальные честно отказывают.
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        if (args.path.endsWith("ui-next-actions.ts")) return { contents: "export async function setNextUiAction() {}", loader: "ts" };
        if (args.path.endsWith("platform-case-next-action-actions.ts")) {
          return {
            contents: `export async function saveCaseNextActionAction(previous, form) {
  const fields = Object.fromEntries(form.entries());
  window.__harness.calls.push(["saveCaseNextActionAction", fields]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  return { status: "saved", requestId: previous.requestId, message: null, receipt: { studentCaseId: fields.student_case_id, nextAction: fields.next_action || null,
    nextActionDueOn: fields.next_action_due_on || null, admissionsVersion: String(Number(fields.expected_version) + 1), cleared: !fields.next_action, requestId: fields.request_id } };
}`,
            loader: "js",
          };
        }
        return { contents: names.map((name) => `export async function ${name}() { window.__harness.calls.push([${JSON.stringify(name)}]); throw new Error("students-next harness: server action ${name} is not available"); }`).join("\n"), loader: "ts" };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "students-next-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } }; var __dirname = \"/\";" }, plugins: [plugin], logLevel: "error",
  });
}

function writePage(outDir, name, css, data) {
  const path = join(outDir, `${name}.html`);
  writeFileSync(path, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Студенты, новый вид (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div id="root"></div><script type="application/json" id="fixture">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="students-next-bundle.js"></script></body></html>`);
  return path;
}

/** Страницы стенда: имя → { kind, path, search, actor, ...данные }. */
function pagesOf(fixtures) {
  const { students, universities } = fixtures;
  const actorOf = (name) => (name === "curator" ? legacy.CURATOR_ACTOR : legacy.ACTOR);
  const queue = (entry) => ({ kind: "students", path: "/v3/profile", search: entry.search, inputs: entry.inputs, actor: actorOf(entry.actor) });
  const uni = (kind, data, path = "/v3/universities") => ({ kind, path, search: "", data, actor: legacy.ACTOR });
  return {
    queue: queue(students.queue),
    mine: queue(students.mine),
    "needs-action": queue(students.needsAction),
    updated: queue(students.sortedUpdated),
    curators: queue(students.curators),
    ...Object.fromEntries(Object.entries(students.states).map(([name, entry]) => [`state-${name}`, queue(entry)])),
    ...Object.fromEntries(Object.entries(students.docs).map(([name, entry]) => [`docs-${name}`, queue(entry)])),
    "uni-list": uni("universities", universities.list),
    "uni-filtered": uni("universities", universities.filtered),
    "uni-empty": uni("universities", universities.empty),
    "uni-paged": uni("universities", universities.withPaging),
    "uni-detail": uni("university", universities.detail, `/v3/universities/${universities.detail.id}`),
    "uni-detail-plain": uni("university", universities.detailUnconfirmed, `/v3/universities/${universities.detailUnconfirmed.id}`),
    "uni-manage": uni("manage", universities.manage, "/v3/universities/manage"),
    "uni-manage-search": uni("manage", universities.manageSearch, "/v3/universities/manage"),
    "uni-manage-error": uni("manage", universities.manageError, "/v3/universities/manage"),
  };
}

module.exports = { pagesOf, compileCss, buildBundle, writePage, VIEWPORTS, ROOT, rowA11yProblems, lazySettled, build };

if (require.main === module) {
  require("./students-next-checks.cjs").run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
