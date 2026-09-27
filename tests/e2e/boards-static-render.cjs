"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в students-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Рендер досок «Воронка продаж» и «Воронка поступления» (решение владельца
 * 25.09.2026: на всю ширину, без прокрутки вбок).
 *
 * Рендерит НАСТОЯЩИЕ страницы `src/app/(v3)/v3/pipeline/page.tsx` и
 * `src/app/(v3)/v3/admissions-pipeline/page.tsx` внутри настоящих AppShell и
 * PartShell. Подменены только границы данных и прав (чтения Supabase,
 * серверные действия, проверка сотрудника): вместо них — СИНТЕТИЧЕСКИЕ
 * данные из tests/e2e/boards-fixtures.cjs. Живой Supabase, права, серверные
 * действия и маршрутизатор Next.js этот рендер не проверяет.
 *
 *   node tests/e2e/boards-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — страницы в оболочке (для
 *       tests/v3-boards.test.mjs).
 *   node tests/e2e/boards-static-render.cjs --screenshots [outDir]
 *     → статическая разметка с CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке), снимки Playwright Chromium
 *       1280×800, 1440×900, 1536×864, 1920×1080, 390×844 и 360×800 плюс измерения в
 *       stdout (JSON-строки). Без гидратации: открытое меню открывается
 *       `showPopover()` и ставится той же `placeMenu`, что и в браузере.
 *   node tests/e2e/boards-static-render.cjs --hydrate [outDir]
 *     → та же страница с `renderToString`, а в браузере — гидратация
 *       `hydrateRoot` настоящими клиентскими компонентами (бандл esbuild).
 *       Подменены ещё `next/link` (тонкая ссылка вместо клиента маршрутизатора)
 *       и маршрутизатор: `pushState` обновляет `useSearchParams`, как в
 *       Next.js, `refresh()` заново строит страницу для текущего адреса.
 *       Сценарии: панель лида (открытие карточкой, Escape, возврат фокуса,
 *       сохранение и обновление с `?lead=`), переданный лид при всех этапах
 *       (рейка «Переданы» → карточка → «Все этапы», затем обновление на
 *       1536 px), модальный лист на телефоне, подпись рейки при фокусе
 *       клавиатуры и при наведении мыши (линия иконки и центр пункта, число
 *       мутаций меню, исчезновение подписи после ухода курсора), меню дела
 *       и перетаскивание.
 *
 *   node tests/e2e/boards-static-render.cjs --hydrate-undo [outDir] [--look=next]
 *     → «Отменить» на доске поступления (Э7, миграция 251), гидратация как
 *       у --hydrate: перетаскивание → «Дело «…» перемещено в «…» · Отменить»
 *       → отмена (итог виден в обоих обликах); «⋯ → Переместить в…» → фокус
 *       на «Отменить» → чужое перемещение → карточка ждёт ответа → отказ
 *       «Дело уже переместили — отмена не выполнена. Сейчас дело «…» — в «…».»
 *       одной строкой; срок ~6 с и пауза под указателем; путь только
 *       клавиатурой (кольцо на «Отменить», на карточке, на цели отказа).
 *       1440 и 390, снимки `f2-*.png`; нарушение — код выхода 1. Подменённое
 *       действие ведёт версию положения, как `move_case_pipeline_v2`
 *       (tests/e2e/boards-fixtures.cjs).
 *
 *   node tests/e2e/boards-static-render.cjs --f1 [outDir] [--look=next]
 *     → Э7 «Одна боковая панель везде»: гидратированная «Воронка продаж» с
 *       панелью лида, открытой по адресу (`?lead=`), на 1440×900, 1280×800 и
 *       390×844 — снимки `f1-pipeline[-next]-<ширина>.png` и замеры
 *       `tests/e2e/side-panel-probe.cjs`: ширина — токен общей панели,
 *       рядом с доской от 1280 px, лист ниже; путь Esc → карточка → открыть
 *       карточкой → «Закрыть» → карточка. Нарушение — исключение.
 *
 *   --look=next (с --json, --screenshots, --hydrate, --hydrate-close, --hydrate-undo или --f1) —
 *       новый облик (Э1.1–Э1.3,
 *       предпросмотр Admin): `data-look="next"` на оболочке, страницы читают
 *       облик заглушкой `readLookPreview` — точка фазы у колонок, инициалы,
 *       чипы и срок словом в карточках, дорожка этапа в панели лида. Снимки —
 *       `boards-next-*.png`.
 *
 * По умолчанию outDir — .impeccable/review (не коммитится).
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const nodeCrypto = require("node:crypto");
const { basename, extname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
const FIXTURES = join(__dirname, "boards-fixtures.cjs");
const LOGO = join(ROOT, "public/brand/evo-logo.png");
const HYDRATE = ["--hydrate", "--hydrate-close", "--hydrate-undo", "--f1"].some((flag) => process.argv.includes(flag));
const LOOK_NEXT = process.argv.includes("--look=next");

// --- require-hook: .ts/.tsx компилируются TypeScript'ом в CJS ---------------
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8")), filename);
  };
}
// Статический импорт логотипа: next/image получает объект как от сборщика.
// При гидратации страница открыта по http, и логотип отдаёт тот же сервер.
const logoSrc = () => (HYDRATE ? "/__static/evo-logo.png" : pathToFileURL(LOGO).href);
Module._extensions[".png"] = (module) => {
  module.exports = { src: logoSrc(), width: 1843, height: 842 };
};

const { ACTOR, STUBS, leadId, caseId, selectSalesRows, setSaveSucceeds, syntheticUuids } = require(FIXTURES);

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
  if (request === "server-only") {
    return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
  }
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    }
    return originalResolve.call(this, base, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const { createElement } = require("react");
const { renderToStaticMarkup, renderToString } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");

const routerStub = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {},
};

function withContexts(node, pathname, search) {
  const searchParams = new URLSearchParams(search);
  return createElement(
    AppRouterContext.Provider,
    { value: routerStub },
    createElement(
      PathnameContext.Provider,
      { value: pathname },
      createElement(
        SearchParamsContext.Provider,
        { value: searchParams },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node),
      ),
    ),
  );
}

const PAGES = {
  sales: {
    pathname: "/v3/pipeline", module: "src/app/(v3)/v3/pipeline/page.tsx",
    loading: "src/app/(v3)/v3/pipeline/loading.tsx", title: "Воронка продаж",
  },
  admissions: {
    pathname: "/v3/admissions-pipeline", module: "src/app/(v3)/v3/admissions-pipeline/page.tsx",
    loading: "src/app/(v3)/v3/admissions-pipeline/loading.tsx", title: "Воронка поступления",
  },
};

const SCENARIOS = {
  "sales": { page: "sales", search: "" },
  "sales-panel": { page: "sales", search: `lead=${leadId(5)}` },
  // Лид в самой правой рабочей колонке: панель не должна закрыть его карточку.
  "sales-panel-right": { page: "sales", search: `lead=${leadId(11)}` },
  // Переданный лид при всех этапах («Все этапы» из фокуса «Переданы» или
  // ссылка): рядом с панелью раскрыт «Переданы», рабочие этапы — рейки.
  "sales-panel-handed": { page: "sales", search: `lead=${leadId(13)}` },
  "sales-focus": { page: "sales", search: "stage=qualified" },
  "sales-handed": { page: "sales", search: "stage=handed_off" },
  "sales-mine": { page: "sales", search: "assignment=mine" },
  // «Без действия» нажато: переданный лид без срока приходит в чтении, но
  // число и рабочие колонки — только рабочие этапы.
  "sales-unscheduled": { page: "sales", search: "due=unscheduled" },
  "sales-search": { page: "sales", search: "q=%D0%A2%D0%B8%D0%BC%D1%83%D1%80" },
  "sales-volume": { page: "sales", search: "", rows: "volume" },
  "sales-loading": { page: "sales", search: "", loading: true },
  // «Закрытые лиды» (246): список закрытых с причиной, датой и «Вернуть в работу».
  "sales-closed": { page: "sales", search: "view=closed" },
  "admissions": { page: "admissions", search: "" },
  "admissions-visa": { page: "admissions", search: "tab=visa" },
  // Фильтр «Куратор»: инициалы куратора на карточках не нужны.
  "admissions-curator": { page: "admissions", search: "curator=aaaaaaaa-1111-4111-8111-000000000011" },
  "admissions-loading": { page: "admissions", search: "", loading: true },
};

/**
 * Одна страница в оболочке. `randomUUID()` страницы на время рендера
 * предсказуем (та же последовательность, что в браузере при гидратации).
 */
async function renderPageTree(pageKey, search, { loading = false, rows = "default" } = {}) {
  const { pathname, module, loading: loadingModule } = PAGES[pageKey];
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  selectSalesRows(rows);
  const originalUuid = nodeCrypto.randomUUID;
  nodeCrypto.randomUUID = syntheticUuids();
  try {
    const content = loading
      ? createElement(require(join(ROOT, loadingModule)).default)
      : await require(join(ROOT, module)).default({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) });
    const tree = createElement(
      "div",
      { className: "v3-world", "data-look": LOOK_NEXT ? "next" : undefined },
      createElement(AppShell, { actor: ACTOR, initialNotifications: null, ...(LOOK_NEXT ? { look: "next" } : {}) }, content),
    );
    return withContexts(tree, pathname, search);
  } finally {
    nodeCrypto.randomUUID = originalUuid;
    selectSalesRows("default");
  }
}

async function renderScenario(name) {
  const { page, search, ...options } = SCENARIOS[name];
  return renderToStaticMarkup(await renderPageTree(page, search, options));
}

async function main() {
  if (process.argv.includes("--json")) {
    const out = [];
    for (const name of Object.keys(SCENARIOS)) out.push({ name, html: await renderScenario(name) });
    process.stdout.write(JSON.stringify(out));
  } else if (process.argv.includes("--screenshots")) {
    await screenshots();
  } else if (process.argv.includes("--hydrate-close")) {
    await hydrateClose();
  } else if (process.argv.includes("--hydrate-undo")) {
    await hydrateUndo();
  } else if (process.argv.includes("--f1")) {
    await f1();
  } else if (HYDRATE) {
    await hydrate();
  } else {
    console.error("usage: boards-static-render.cjs --json | --screenshots [outDir] | --hydrate [outDir] | --f1 [outDir]");
    process.exit(2);
  }
}

function outDirArg(flag) {
  const index = process.argv.indexOf(flag) + 1;
  const value = process.argv[index];
  const outDir = resolve(value && !value.startsWith("--") ? value : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  return outDir;
}

/** CSS сборки: шрифты — файлами (статический снимок) или с того же http-сервера. */
async function compileCss(fontBase = null) {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    const base = fontBase ? `${fontBase}/${font}/files` : pathToFileURL(join(dir, "files")).href;
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${base}/`);
  });
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8")].join("\n");
}

/** Та же функция размещения меню, что в TopLayerMenu, для страницы без гидратации. */
function placeMenuSource() {
  const code = ts.transpileModule(readFileSync(join(ROOT, "src/components/v3/board/menu-position.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `(() => { const exports = {}; ${code}; window.__placeMenu = exports.placeMenu; })();`;
}

/**
 * Измерения доски: переполнение, колонки (только дорожки сетки), левый край и
 * верх доски, карточки, панель лида и сплошной красный.
 */
function measure() {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const board = document.querySelector('[role="group"][aria-label="Воронка продаж"], [role="group"][aria-label="Воронка поступления"]');
  const sidebar = document.querySelector('nav[aria-label="Разделы"]');
  const tracks = board
    ? [...board.querySelectorAll('[data-testid$="-column"], [data-testid$="-rail"]')].filter((element) => visible(element)
      && (element.parentElement === board || getComputedStyle(element.parentElement).display === "contents"))
    : [];
  const viewportWidth = document.documentElement.clientWidth;
  const rects = tracks.map((element) => element.getBoundingClientRect());
  const cards = [...document.querySelectorAll('[data-testid="v3-pipeline-card"], [data-testid="v3-admissions-pipeline-card"]')].filter(visible);
  const names = cards.map((card) => card.querySelector("a"));
  const red = [...document.querySelectorAll("a, button")].filter((element) => visible(element)
    && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map((element) => element.textContent.trim());
  const main = [...document.querySelectorAll("main")].find(visible);
  const topBar = main?.parentElement?.previousElementSibling;
  const panel = document.querySelector('[data-testid="v3-pipeline-lead-panel"]');
  const panelRect = panel && visible(panel) ? panel.getBoundingClientRect() : null;
  const selectedCard = panel ? document.querySelector(`[data-testid="v3-pipeline-card"][data-lead-id="${panel.dataset.leadId}"]`) : null;
  const selectedRect = selectedCard && visible(selectedCard) ? selectedCard.getBoundingClientRect() : null;
  const scrollingColumns = board
    ? [...board.querySelectorAll("section > ul")].filter((list) => visible(list) && list.scrollHeight > list.clientHeight + 1).length
    : 0;
  return {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    boardOverflowX: board ? board.scrollWidth - board.clientWidth : null,
    pageOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
    topBarHeight: topBar ? Math.round(topBar.getBoundingClientRect().height) : null,
    mainX: main ? Math.round(main.getBoundingClientRect().left) : null,
    boardX: board ? Math.round(board.getBoundingClientRect().left) : null,
    boardTop: board ? Math.round(board.getBoundingClientRect().top) : null,
    boardRight: board ? Math.round(board.getBoundingClientRect().right) : null,
    columnsVisible: rects.filter((rect) => rect.left >= 0 && rect.right <= viewportWidth + 0.5).length,
    columnsTotal: rects.length,
    columnWidths: rects.map((rect) => Math.round(rect.width)),
    cards: cards.length,
    maxCardHeight: cards.length ? Math.max(...cards.map((card) => Math.round(card.getBoundingClientRect().height))) : null,
    maxCardLines: cards.length ? Math.max(...cards.map((card) => card.querySelectorAll(":scope > p").length)) : null,
    namesCut: names.filter((name) => name && name.scrollWidth > name.clientWidth + 1).map((name) => name.textContent.trim()),
    scrollingColumns,
    panel: panelRect ? {
      x: Math.round(panelRect.left), width: Math.round(panelRect.width), top: Math.round(panelRect.top),
      position: getComputedStyle(panel).position, modal: panel.matches(":modal"),
      coversSelectedCard: selectedRect ? selectedRect.right > panelRect.left && selectedRect.left < panelRect.right
        && selectedRect.bottom > panelRect.top && selectedRect.top < panelRect.bottom : null,
      selectedCardVisible: Boolean(selectedRect),
    } : null,
    solidRed: red,
  };
}

async function screenshots() {
  const outDir = outDirArg("--screenshots");
  const css = await compileCss();
  const VIEWPORTS = {
    "1280": { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    "1440": { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    "1536": { viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1 },
    "1920": { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
    "390": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    "360": { viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  };
  const shots = [
    ["sales", ["1280", "1440", "1920", "390"]],
    ["sales-panel", ["1280", "1440", "1920", "390"]],
    ["sales-panel-right", ["1440"]],
    ["sales-panel-handed", ["1280", "1440", "1536", "1920"]],
    ["sales-focus", ["1440"]],
    ["sales-handed", ["1280"]],
    ["sales-search", ["1440", "390"]],
    ["sales-volume", ["1440"]],
    ["sales-loading", ["1440"]],
    ["sales-closed", ["1440", "390"]],
    ["admissions", ["1280", "1440", "1920", "390", "360"]],
    ["admissions-visa", ["1920"]],
    ["admissions-menu", ["1440", "1280"]],
    ["admissions-loading", ["1440"]],
    ["rail-flyout", ["1280"]],
  ];
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const [shot, sizes] of shots) {
      const scenario = shot === "admissions-menu" ? "admissions" : shot === "rail-flyout" ? "sales" : shot;
      const { page: pageKey } = SCENARIOS[scenario];
      const prefix = LOOK_NEXT ? "boards-next" : "boards";
      const htmlPath = join(outDir, `${prefix}-${scenario}.html`);
      if (!existsSync(htmlPath) || shot === scenario) {
        writeFileSync(htmlPath, [
          "<!DOCTYPE html>",
          '<html lang="ru" data-theme="light" class="h-full antialiased">',
          `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${PAGES[pageKey].title} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
          `<body class="min-h-full">${await renderScenario(scenario)}</body></html>`,
        ].join(""));
      }
      for (const size of sizes) {
        const context = await browser.newContext(VIEWPORTS[size]);
        const page = await context.newPage();
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        if (shot === "admissions-menu" || shot === "rail-flyout") {
          await page.addScriptTag({ content: placeMenuSource() });
          await page.evaluate((kind) => {
            // Без гидратации React: открываем то же меню так, как его открыл бы
            // щелчок по кнопке, и ставим функцией placeMenu из исходников.
            const trigger = kind === "rail-flyout"
              ? document.querySelector('nav[aria-label="Разделы"] button[popovertarget][aria-label="Продажи"]')
              : document.querySelectorAll('[data-testid="v3-admissions-pipeline-card"] button[popovertarget]')[3];
            const menu = document.getElementById(trigger.getAttribute("popovertarget"));
            menu.showPopover();
            trigger.setAttribute("aria-expanded", "true");
            const position = window.__placeMenu(
              trigger.getBoundingClientRect(),
              { width: menu.offsetWidth, height: menu.scrollHeight },
              { width: window.innerWidth, height: window.innerHeight },
              kind === "rail-flyout" ? "right-start" : "bottom-end",
            );
            Object.assign(menu.style, { top: `${position.top}px`, left: `${position.left}px`, maxHeight: `${position.maxHeight}px` });
          }, shot);
        }
        const metrics = await page.evaluate(measure);
        if (shot === "admissions-menu" || shot === "rail-flyout") {
          metrics.menu = await page.evaluate(menuMetrics);
        }
        const file = `${prefix}-${shot}-${size}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: size === "390" || size === "360" });
        process.stdout.write(`${JSON.stringify({ file, ...metrics })}\n`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

function menuMetrics() {
  const menu = document.querySelector("[popover]:popover-open");
  if (!menu) return null;
  const rect = menu.getBoundingClientRect();
  return {
    inTopLayer: menu.matches(":popover-open"),
    rect: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
    clipped: rect.bottom > window.innerHeight || rect.right > window.innerWidth || rect.top < 0 || rect.left < 0,
    items: [...menu.querySelectorAll("button, a")].filter((item) => item.getBoundingClientRect().height > 0).map((item) => item.textContent.trim()),
  };
}

// --- гидратация в браузере ---------------------------------------------------

/**
 * Тонкая замена `next/link`: та же разметка `<a>` без свойств маршрутизатора;
 * обычный щелчок идёт в `router.push` из контекста, а `onClick` компонента
 * с `preventDefault()` (карточка, закрытие панели) оставляет всё ему.
 */
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
module.exports = Link;
module.exports.default = Link;
module.exports.__esModule = true;
`;

/** Браузерная точка входа: то же дерево, что на сервере, и `hydrateRoot`. */
const HYDRATE_ENTRY = `
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
  "/v3/pipeline": () => require("@/app/(v3)/v3/pipeline/page").default,
  "/v3/admissions-pipeline": () => require("@/app/(v3)/v3/admissions-pipeline/page").default,
};
const h = React.createElement;
const IMAGE = { ...imageConfigDefault, unoptimized: true };
// Облик — тот же, что отрисовал сервер (флаг --look=next): иначе React
// пересоберёт дерево на клиенте в текущем облике.
const LOOK_NEXT = ${JSON.stringify(LOOK_NEXT)};
async function renderPage(pathname, search) {
  globalThis.__harnessUuid = fixtures.syntheticUuids();
  return PAGES[pathname]()({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) });
}
function Harness({ initial }) {
  const [view, setView] = React.useState(initial);
  const router = React.useMemo(() => {
    const load = async (href, history_) => {
      const url = new URL(href, location.href);
      if (history_ === "push") history.pushState(null, "", url.pathname + url.search);
      if (history_ === "replace") history.replaceState(null, "", url.pathname + url.search);
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
    return () => {
      window.removeEventListener("harness:pushstate", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const searchParams = React.useMemo(() => new URLSearchParams(view.search), [view.search]);
  return h(AppRouterContext.Provider, { value: router },
    h(PathnameContext.Provider, { value: view.pathname },
      h(SearchParamsContext.Provider, { value: searchParams },
        h(ImageConfigContext.Provider, { value: IMAGE },
          h("div", { className: "v3-world", "data-look": LOOK_NEXT ? "next" : undefined },
            h(AppShell, { actor: fixtures.ACTOR, initialNotifications: null, ...(LOOK_NEXT ? { look: "next" } : {}) }, view.content))))));
}
(async () => {
  window.__harness = { pushes: [], refreshes: [], recoverable: [] };
  // Next.js встраивает history.pushState в свой маршрутизатор: useSearchParams
  // видит новый адрес. Здесь то же самое делает событие для Harness.
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
  // Фильтры esbuild — регулярные выражения Go: без флага `u`.
  const stubPattern = new RegExp(`^(${Object.keys(STUBS).map((key) => key.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")).join("|")})$`);
  const plugin = {
    name: "boards-harness",
    setup(build) {
      build.onResolve({ filter: stubPattern }, (args) => ({ path: args.path, namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
        contents: `module.exports = require(${JSON.stringify(FIXTURES)}).STUBS[${JSON.stringify(args.path)}];`,
        resolveDir: ROOT,
        loader: "js",
      }));
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^node:crypto$/ }, () => ({ path: "uuid", namespace: "uuid" }));
      build.onLoad({ filter: /.*/, namespace: "uuid" }, () => ({
        contents: "module.exports = { randomUUID: () => globalThis.__harnessUuid() };",
        loader: "js",
      }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({
        contents: `module.exports = { src: "/__static/evo-logo.png", width: 1843, height: 842 };`,
        loader: "js",
      }));
      // Модули «use server» (серверные действия без подмены в фикстурах): в
      // браузере — функции, которые честно отказывают.
      build.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^\s*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/gmu)].map((match) => match[1]);
        return {
          contents: names.map((name) => `export async function ${name}() { throw new Error("server action unavailable in harness: ${name}"); }`).join("\n"),
          loader: "js",
        };
      });
    },
  };
  const result = await esbuild.build({
    stdin: { contents: HYDRATE_ENTRY, resolveDir: ROOT, loader: "js", sourcefile: "boards-hydrate-entry.js" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    // `argv` несёт только флаг облика: заглушка `readLookPreview` читает его и в браузере.
    banner: { js: `var process = globalThis.process || { env: { NODE_ENV: "development" }, argv: ${JSON.stringify(LOOK_NEXT ? ["--look=next"] : [])} };` },
    plugins: [plugin],
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

async function startServer(css, bundle) {
  const http = require("node:http");
  const pageKeys = Object.fromEntries(Object.entries(PAGES).map(([key, page]) => [page.pathname, key]));
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/__hydrate.js") {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        response.end(bundle);
        return;
      }
      if (url.pathname === "/__static/evo-logo.png") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(readFileSync(LOGO));
        return;
      }
      const font = url.pathname.match(/^\/__fonts\/(golos-text|jetbrains-mono)\/files\/([\w.-]+)$/u);
      if (font) {
        response.writeHead(200, { "content-type": extname(font[2]) === ".woff2" ? "font/woff2" : "font/woff" });
        response.end(readFileSync(join(ROOT, "node_modules/@fontsource-variable", font[1], "files", basename(font[2]))));
        return;
      }
      const pageKey = pageKeys[url.pathname];
      if (!pageKey) {
        response.writeHead(404);
        response.end();
        return;
      }
      const markup = renderToString(await renderPageTree(pageKey, url.search.slice(1)));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end([
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${PAGES[pageKey].title} — EVO CRM (синтетические данные, гидратация)</title><style>${css}</style><script src="/__hydrate.js" defer></script></head>`,
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

async function hydrate() {
  const outDir = outDirArg("--hydrate");
  setSaveSucceeds(true);
  const [css, bundle] = await Promise.all([compileCss("/__fonts"), bundleHydration()]);
  const { server, origin } = await startServer(css, bundle);
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
  const open = async (viewport, path, mobile = false) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const console_ = [];
    page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") console_.push(message.text()); });
    page.on("pageerror", (error) => console_.push(`pageerror: ${error.message}`));
    await page.goto(`${origin}${path}`, { waitUntil: "load" });
    await page.waitForSelector("html[data-hydrated=true]", { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { context, page, console_ };
  };
  const focusState = (page) => page.evaluate(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName ?? null,
      leadLink: active?.getAttribute("data-lead-link") ?? null,
      inPanel: Boolean(active?.closest('[data-testid="v3-pipeline-lead-panel"]')),
      label: active?.getAttribute("aria-label") ?? active?.textContent?.trim().slice(0, 40) ?? null,
    };
  });
  const cardLink = (page, n) => page.locator(`[data-testid="v3-pipeline-card"][data-lead-id="${leadId(n)}"] a[data-lead-link]`);
  const panel = (page) => page.locator('[data-testid="v3-pipeline-lead-panel"]');

  try {
    // 1. Продажи, 1440: панель встаёт в ряд с доской, Escape, возврат фокуса.
    {
      const { context, page, console_ } = await open({ width: 1440, height: 900 }, "/v3/pipeline");
      await cardLink(page, 11).click();
      await panel(page).waitFor();
      const opened = { url: page.url().replace(origin, ""), focus: await focusState(page), metrics: await page.evaluate(measure) };
      await page.screenshot({ path: join(outDir, "boards-hydrated-panel-right-1440.png") });
      await page.keyboard.press("Escape");
      await panel(page).waitFor({ state: "detached" });
      const closed = { url: page.url().replace(origin, ""), focus: await focusState(page) };
      // Вторая карточка, закрытие крестиком, сохранение решения и обновление.
      await cardLink(page, 5).click();
      await panel(page).waitFor();
      const second = { url: page.url().replace(origin, ""), focus: await focusState(page), metrics: await page.evaluate(measure) };
      await page.screenshot({ path: join(outDir, "boards-hydrated-panel-1440.png") });
      const form = page.getByTestId("v3-pipeline-workflow-form");
      await form.getByTestId("v3-pipeline-next-action").fill("Перезвонить после консультации (синтетика)");
      await form.getByTestId("v3-pipeline-next-action-date").fill("2030-01-15");
      await form.getByTestId("v3-pipeline-submit").click();
      await page.waitForFunction(() => window.__harness.refreshes.length > 0, null, { timeout: 10_000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="v3-pipeline-workflow-form"] input[name="expected_version"]')?.value === "4", null, { timeout: 10_000 });
      const saved = {
        url: page.url().replace(origin, ""),
        refreshes: await page.evaluate(() => window.__harness.refreshes),
        panelStillOpen: await panel(page).isVisible(),
        formVersion: await page.evaluate(() => document.querySelector('[data-testid="v3-pipeline-workflow-form"] input[name="expected_version"]')?.value),
        savedNotices: await panel(page).getByText("Решение сохранено.").count(),
      };
      await page.screenshot({ path: join(outDir, "boards-hydrated-saved-1440.png") });
      await panel(page).getByRole("link", { name: "Закрыть" }).click();
      await panel(page).waitFor({ state: "detached" });
      const closedByButton = { url: page.url().replace(origin, ""), focus: await focusState(page) };
      report({ journey: "sales-panel-1440", opened, closed, second, saved, closedByButton,
        recoverable: await page.evaluate(() => window.__harness.recoverable), console: console_ });
      await context.close();
    }

    // 2. Продажи, 1920: шести колонкам рядом с панелью хватает места.
    {
      const { context, page, console_ } = await open({ width: 1920, height: 1080 }, "/v3/pipeline");
      await cardLink(page, 11).click();
      await panel(page).waitFor();
      report({ journey: "sales-panel-1920", metrics: await page.evaluate(measure), console: console_ });
      await page.screenshot({ path: join(outDir, "boards-hydrated-panel-1920.png") });
      await context.close();
    }

    // 3. Телефон: модальный лист, страница за ним инертна, Escape без фокуса в листе.
    {
      const { context, page, console_ } = await open({ width: 390, height: 844 }, "/v3/pipeline", true);
      await cardLink(page, 1).click();
      await panel(page).waitFor();
      const sheet = await page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="v3-pipeline-lead-panel"]');
        const outside = document.querySelector('[data-testid="v3-pipeline-card"] a[data-lead-link]');
        outside.focus();
        return { modal: dialog.matches(":modal"), outsideFocusable: document.activeElement === outside, position: getComputedStyle(dialog).position };
      });
      const focusOnOpen = await focusState(page);
      await page.screenshot({ path: join(outDir, "boards-hydrated-sheet-390.png") });
      await page.evaluate(() => document.activeElement?.blur());
      const blurred = await focusState(page);
      await page.keyboard.press("Escape");
      await panel(page).waitFor({ state: "detached" });
      const closed = { url: page.url().replace(origin, ""), focus: await focusState(page) };
      // Обновление страницы с ?lead=: серверный <dialog open> становится модальным.
      await page.goto(`${origin}/v3/pipeline?lead=${leadId(5)}`, { waitUntil: "load" });
      await page.waitForSelector("html[data-hydrated=true]");
      await page.waitForTimeout(200);
      const reloaded = await page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="v3-pipeline-lead-panel"]');
        return { modal: dialog?.matches(":modal") ?? null, open: dialog?.open ?? null };
      });
      report({ journey: "sales-sheet-390", sheet, focusOnOpen, blurred, closed, reloaded,
        recoverable: await page.evaluate(() => window.__harness.recoverable), console: console_ });
      await context.close();
    }

    // 4. Рейка меню, 1280: подпись при фокусе клавиатуры.
    {
      const { context, page, console_ } = await open({ width: 1280, height: 800 }, "/v3/pipeline");
      let hint = null;
      const reached = [];
      for (let step = 0; step < 12 && !hint; step += 1) {
        await page.keyboard.press("Tab");
        const state = await page.evaluate(() => {
          const active = document.activeElement;
          const tip = [...document.querySelectorAll('nav[aria-label="Разделы"] span[aria-hidden="true"].fixed')]
            .find((element) => getComputedStyle(element).display !== "none");
          return { active: active?.getAttribute("aria-label") ?? active?.textContent?.trim().slice(0, 30), tip: tip?.textContent ?? null,
            tipRect: tip ? (({ left, top, width, height }) => ({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) }))(tip.getBoundingClientRect()) : null };
        });
        reached.push(state.active);
        if (state.tip && step >= 2) hint = state;
      }
      await page.screenshot({ path: join(outDir, "boards-hydrated-rail-hint-1280.png") });
      report({ journey: "rail-hint-1280", reached, hint, console: console_ });
      await context.close();
    }

    // 4б. Рейка меню, 1280: подпись при наведении мыши на обеих досках.
    // Курсор ставится на линию иконки (точка на контуре SVG) и в центр
    // пункта. Считаем мутации DOM в меню за 1 с наведения: подпись не должна
    // перерисовывать меню по кругу. Затем курсор уходит на доску: подпись
    // должна исчезнуть.
    for (const path of ["/v3/pipeline", "/v3/admissions-pipeline"]) {
      const { context, page, console_ } = await open({ width: 1280, height: 800 }, path);
      const tipText = () => page.evaluate(() => {
        const tip = [...document.querySelectorAll('nav[aria-label="Разделы"] span[aria-hidden="true"].fixed')]
          .find((element) => getComputedStyle(element).display !== "none");
        return tip?.textContent ?? null;
      });
      const countMutations = () => page.evaluate(() => {
        window.__railMutations = 0;
        window.__railObserver?.disconnect();
        window.__railObserver = new MutationObserver((records) => { window.__railMutations += records.length; });
        window.__railObserver.observe(document.querySelector('nav[aria-label="Разделы"]'), { subtree: true, childList: true, attributes: true, characterData: true });
      });
      const mutations = () => page.evaluate(() => window.__railMutations);
      const items = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Разделы"]');
        return [...nav.querySelectorAll("a, button")].filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.right <= 72 && element.querySelector("svg");
        }).map((element) => {
          const svg = element.querySelector("svg");
          let stroke = null;
          for (const shape of svg.querySelectorAll("path, circle, rect, line, polyline")) {
            const length = shape.getTotalLength();
            const matrix = shape.getScreenCTM();
            for (const fraction of [0.5, 0.33, 0.66, 0.2, 0.8]) {
              const point = shape.getPointAtLength(length * fraction);
              const x = point.x * matrix.a + point.y * matrix.c + matrix.e;
              const y = point.x * matrix.b + point.y * matrix.d + matrix.f;
              if (document.elementFromPoint(x, y) === shape) { stroke = { x, y }; break; }
            }
            if (stroke) break;
          }
          const rect = element.getBoundingClientRect();
          const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          const centreHit = document.elementFromPoint(centre.x, centre.y);
          return {
            label: element.getAttribute("aria-label") ?? element.textContent.trim(),
            stroke,
            centre,
            centreOnStroke: centreHit !== svg && svg.contains(centreHit),
          };
        });
      });
      const board = { x: 760, y: 560 };
      const results = [];
      for (const item of items) {
        for (const [mode, point] of [["stroke", item.stroke], ["centre", item.centre]]) {
          if (!point) { results.push({ label: item.label, mode, point: null }); continue; }
          await page.mouse.move(board.x, board.y);
          await page.waitForTimeout(100);
          await countMutations();
          await page.mouse.move(point.x, point.y);
          await page.waitForTimeout(1000);
          const hover = { tip: await tipText(), mutations: await mutations() };
          if (item.label === "Выйти" && mode === "centre") {
            await page.screenshot({ path: join(outDir, `boards-hydrated-rail-hover-${basename(path)}-1280.png`) });
          }
          await countMutations();
          await page.mouse.move(board.x, board.y, { steps: 5 });
          await page.waitForTimeout(1000);
          const left = { tip: await tipText(), mutations: await mutations() };
          if (item.label === "Выйти" && mode === "centre") {
            await page.screenshot({ path: join(outDir, `boards-hydrated-rail-left-${basename(path)}-1280.png`) });
          }
          results.push({ label: item.label, mode, centreOnStroke: item.centreOnStroke, hover, left,
            ok: hover.tip === item.label && hover.mutations < 100 && left.tip === null });
        }
      }
      report({ journey: `rail-hover-${basename(path)}-1280`, items: items.length,
        ok: results.filter((result) => result.ok).length, total: results.length,
        maxHoverMutations: Math.max(...results.map((result) => result.hover?.mutations ?? 0)),
        stuckAfterLeave: results.filter((result) => result.left && result.left.tip !== null).map((result) => `${result.label}/${result.mode}`),
        results, console: console_ });
      await context.close();
    }

    // 5. Поступление, 1440: меню дела щелчком (размещение самого компонента) и перетаскивание.
    {
      const { context, page, console_ } = await open({ width: 1440, height: 900 }, "/v3/admissions-pipeline");
      const trigger = page.locator('[data-testid="v3-admissions-pipeline-card"]').nth(3).getByRole("button", { name: "Действия с делом" });
      await trigger.click();
      await page.waitForSelector("[popover]:popover-open");
      await page.waitForTimeout(100);
      const menu = await page.evaluate(menuMetrics);
      await page.screenshot({ path: join(outDir, "boards-hydrated-menu-1440.png") });
      await page.keyboard.press("Escape");
      const menuClosed = await page.evaluate(() => ({
        open: Boolean(document.querySelector("[popover]:popover-open")),
        focus: document.activeElement?.getAttribute("aria-label") ?? null,
      }));
      // Перетаскивание: карточка из «Новые» в «Документы», снимок над колонкой.
      const source = page.locator('[data-testid="v3-admissions-pipeline-card"]').first();
      const target = page.locator('[data-testid="v3-admissions-pipeline-column"]').nth(2);
      const sourceBox = await source.boundingBox();
      const targetBox = await target.boundingBox();
      await page.mouse.move(sourceBox.x + 40, sourceBox.y + 12);
      await page.mouse.down();
      await page.mouse.move(sourceBox.x + 60, sourceBox.y + 30, { steps: 4 });
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 200, { steps: 12 });
      await page.waitForTimeout(150);
      const over = await page.evaluate(() => {
        const column = document.querySelectorAll('[data-testid="v3-admissions-pipeline-column"]')[2];
        const style = getComputedStyle(column);
        return { outlineStyle: style.outlineStyle, outlineColor: style.outlineColor, background: style.backgroundColor };
      });
      await page.screenshot({ path: join(outDir, "boards-hydrated-drag-1440.png") });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const dropped = await page.evaluate(() => {
        const columns = [...document.querySelectorAll('[data-testid="v3-admissions-pipeline-column"]')];
        return columns.map((column) => [column.querySelector("h2")?.textContent, column.querySelectorAll('[data-testid="v3-admissions-pipeline-card"]').length]);
      });
      report({ journey: "admissions-1440", menu, menuClosed, over, dropped,
        recoverable: await page.evaluate(() => window.__harness.recoverable), console: console_ });
      await context.close();
    }

    // 6. Продажи, 1280: переданный лид при всех этапах. Рейка «Переданы» →
    // карточка → «Все этапы» (ссылка сохраняет `?lead=`): рядом с панелью
    // раскрыт «Переданы», рабочие этапы свёрнуты в рейки, имена не обрезаны.
    // Затем закрытие крестиком и обновление того же адреса на 1536 px.
    {
      const { context, page, console_ } = await open({ width: 1280, height: 800 }, "/v3/pipeline");
      await page.locator('[data-testid="v3-pipeline-rail"][href$="stage=handed_off"]').click();
      await page.waitForURL(/stage=handed_off/u);
      await cardLink(page, 13).first().click();
      await panel(page).waitFor();
      await page.getByRole("link", { name: "Все этапы" }).click();
      await page.waitForURL((url) => !url.search.includes("stage="));
      await page.waitForTimeout(100);
      const allStages = { url: page.url().replace(origin, ""), metrics: await page.evaluate(measure) };
      await page.screenshot({ path: join(outDir, "boards-hydrated-handed-all-1280.png") });
      // Фокус после «Все этапы» на доске, а не в немодальной панели: закрывает крестик.
      await panel(page).getByRole("link", { name: "Закрыть" }).click();
      await panel(page).waitFor({ state: "detached" });
      const closed = { url: page.url().replace(origin, ""), focus: await focusState(page), metrics: await page.evaluate(measure) };
      await page.setViewportSize({ width: 1536, height: 864 });
      await page.goto(`${origin}/v3/pipeline?lead=${leadId(13)}`, { waitUntil: "load" });
      await page.waitForSelector("html[data-hydrated=true]");
      await page.waitForTimeout(200);
      const reloaded1536 = { url: page.url().replace(origin, ""), metrics: await page.evaluate(measure) };
      await page.screenshot({ path: join(outDir, "boards-hydrated-handed-all-1536.png") });
      report({ journey: "sales-handed-all-1280", allStages, closed, reloaded1536,
        recoverable: await page.evaluate(() => window.__harness.recoverable), console: console_ });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

/**
 * «Закрыть лид» (миграция 246) на гидратированной доске:
 *   node tests/e2e/boards-static-render.cjs --hydrate-close [outDir]
 * Панель лида → «⋯» → «Закрыть лид…» → окно (причина, «Другое» с текстом) →
 * подтверждение → лид уходит с доски, строка «Лид «…» закрыт · причина ·
 * дата · Вернуть в работу» → возврат. Переданный лид: пункт недоступен и
 * называет причину. Телефон: окно поверх листа панели. Снимки
 * `close-lead-*.png`; измерения — JSON-строки в stdout. Серверное действие
 * подменено фикстурой (tests/e2e/boards-fixtures.cjs).
 */
/**
 * Э7 «Одна боковая панель везде»: панель лида — общая `SidePanel`. Открыта по
 * адресу (переход из «Сегодня», обновление): фокус на заголовке, рядом с
 * доской от 1280 px шириной токена, ниже — модальный лист; Esc и «Закрыть»
 * возвращают фокус на карточку. Замеры и путь — `side-panel-probe.cjs`.
 */
async function f1() {
  const probe = require("./side-panel-probe.cjs");
  const outDir = outDirArg("--f1");
  setSaveSucceeds(true);
  const [css, bundle] = await Promise.all([compileCss("/__fonts"), bundleHydration()]);
  const { server, origin } = await startServer(css, bundle);
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const look = LOOK_NEXT ? "-next" : "";
  const lead = leadId(5);
  const failures = [];
  try {
    for (const [width, context] of probe.F1_WIDTHS) {
      const browserContext = await browser.newContext(context);
      const page = await browserContext.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(`${origin}/v3/pipeline?lead=${lead}`, { waitUntil: "load" });
      await page.waitForSelector("html[data-hydrated=true]", { timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, `f1-pipeline${look}-${width}.png`) });
      const card = `a[data-lead-link="${lead}"]`;
      const result = await probe.journey(page, {
        selected: `[data-testid="v3-pipeline-card"][aria-current="true"]`,
        returnSelector: card,
        reopen: () => page.locator(card).filter({ visible: true }).first().click(),
      });
      if (errors.length) result.failures.push(`browser errors: ${errors.join(" | ")}`);
      const recoverable = await page.evaluate(() => window.__harness.recoverable);
      if (recoverable.length) result.failures.push(`hydration: ${recoverable.join(" | ")}`);
      probe.report({ screen: "pipeline", look: look || "-current", width, ...result });
      failures.push(...result.failures.map((failure) => `pipeline${look} ${width}: ${failure}`));
      await browserContext.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) throw new Error(`side panel (pipeline): ${failures.length} failed:\n${failures.join("\n")}`);
}

async function hydrateClose() {
  const outDir = outDirArg("--hydrate-close");
  setSaveSucceeds(true);
  const [css, bundle] = await Promise.all([compileCss("/__fonts"), bundleHydration()]);
  const { server, origin } = await startServer(css, bundle);
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
  const open = async (viewport, path, mobile = false) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const console_ = [];
    page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") console_.push(message.text()); });
    page.on("pageerror", (error) => console_.push(`pageerror: ${error.message}`));
    await page.goto(`${origin}${path}`, { waitUntil: "load" });
    await page.waitForSelector("html[data-hydrated=true]", { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { context, page, console_ };
  };
  const cardLink = (page, n) => page.locator(`[data-testid="v3-pipeline-card"][data-lead-id="${leadId(n)}"] a[data-lead-link]`);
  const panel = (page) => page.locator('[data-testid="v3-pipeline-lead-panel"]');
  const dialogMetrics = (page) => page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="v3-close-lead-dialog"]');
    if (!dialog) return null;
    const rect = dialog.getBoundingClientRect();
    const red = [...dialog.querySelectorAll("button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)")
      .map((element) => element.textContent.trim());
    const pageRed = [...document.querySelectorAll("a, button")].filter((element) => !dialog.contains(element) && element.checkVisibility()
      && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map((element) => element.textContent.trim());
    return {
      modal: dialog.matches(":modal"), rect: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      clipped: rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight,
      redInDialog: red, redOutsideDialog: pageRed,
      smallTargets: [...dialog.querySelectorAll("button, input, label")].filter((element) => element.getBoundingClientRect().height < 24).length,
      smallText: [...dialog.querySelectorAll("*")].filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
        && parseFloat(getComputedStyle(element).fontSize) < 12).length,
      focused: document.activeElement ? `${document.activeElement.tagName.toLowerCase()}:${document.activeElement.getAttribute("value") ?? document.activeElement.textContent.trim().slice(0, 30)}` : null,
    };
  });
  try {
    // 1. 1440: панель → «⋯» → окно → «Другое» с текстом → закрыт → возврат.
    {
      const { context, page, console_ } = await open({ width: 1440, height: 900 }, "/v3/pipeline");
      await cardLink(page, 6).click();
      await panel(page).waitFor();
      await panel(page).getByRole("button", { name: "Ещё действия" }).click();
      await page.waitForSelector('[data-testid="v3-lead-actions-menu"]:popover-open');
      const menu = await page.evaluate(menuMetrics);
      await page.screenshot({ path: join(outDir, "close-lead-menu-1440.png") });
      await page.getByRole("button", { name: "Закрыть лид…" }).click();
      await page.getByTestId("v3-close-lead-dialog").waitFor();
      const opened = await dialogMetrics(page);
      // Без выбора причины — ошибка у поля, не запрос.
      await page.getByTestId("v3-close-lead-dialog").getByRole("button", { name: "Закрыть лид" }).click();
      const missingReason = await page.getByTestId("v3-close-lead-dialog").getByRole("alert").textContent();
      await page.getByRole("radio", { name: "Другое", exact: true }).check();
      await page.getByLabel("Что случилось").fill("Семья решила отложить поступление на год");
      const filled = await dialogMetrics(page);
      await page.screenshot({ path: join(outDir, "close-lead-dialog-1440.png") });
      await page.getByTestId("v3-close-lead-dialog").getByRole("button", { name: "Закрыть лид" }).click();
      await page.getByTestId("v3-pipeline-closed-notice").waitFor();
      await page.waitForFunction((id) => !document.querySelector(`[data-testid="v3-pipeline-card"][data-lead-id="${id}"]`), leadId(6));
      const closed = {
        url: page.url().replace(origin, ""),
        notice: (await page.getByTestId("v3-pipeline-closed-notice").textContent()).replace(/\s+/gu, " ").trim(),
        focusInNotice: await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="v3-pipeline-closed-notice"]'))),
        panelOpen: await panel(page).count(),
        cardGone: await cardLink(page, 6).count() === 0,
      };
      await page.screenshot({ path: join(outDir, "close-lead-closed-1440.png") });
      await page.getByTestId("v3-pipeline-closed-notice").getByRole("button", { name: "Вернуть в работу" }).click();
      await cardLink(page, 6).waitFor();
      const reopened = {
        notice: (await page.getByTestId("v3-pipeline-closed-notice").textContent()).replace(/\s+/gu, " ").trim(),
        cardBack: await cardLink(page, 6).count() === 1,
        column: await page.evaluate((id) => document.querySelector(`[data-testid="v3-pipeline-card"][data-lead-id="${id}"]`)
          ?.closest('[data-testid="v3-pipeline-column"]')?.querySelector("h2, h3")?.textContent?.trim() ?? null, leadId(6)),
      };
      await page.screenshot({ path: join(outDir, "close-lead-reopened-1440.png") });
      // Строка живёт до «Скрыть строку» (44 px): после него строки нет, фокус — на первой карточке доски.
      const dismissBox = await page.getByTestId("v3-pipeline-closed-notice-dismiss").boundingBox();
      await page.getByTestId("v3-pipeline-closed-notice-dismiss").click();
      await page.getByTestId("v3-pipeline-closed-notice").waitFor({ state: "detached" });
      const dismissed = {
        target: dismissBox ? `${Math.round(dismissBox.width)}x${Math.round(dismissBox.height)}` : null,
        noticeGone: await page.getByTestId("v3-pipeline-closed-notice").count() === 0,
        focusOnCard: await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="v3-pipeline-card"]'))),
      };
      // Переданный лид — продажа: пункт недоступен и называет причину.
      await page.goto(`${origin}/v3/pipeline?lead=${leadId(13)}`, { waitUntil: "load" });
      await page.waitForSelector("html[data-hydrated=true]");
      await panel(page).getByRole("button", { name: "Ещё действия" }).click();
      await page.waitForSelector('[data-testid="v3-lead-actions-menu"]:popover-open');
      const handed = await page.evaluate(menuMetrics);
      handed.text = (await page.locator('[data-testid="v3-lead-actions-menu"]').textContent()).trim();
      await page.screenshot({ path: join(outDir, "close-lead-handed-1440.png") });
      report({ journey: "close-lead-1440", menu, opened, missingReason, filled, closed, reopened, dismissed, handed,
        recoverable: await page.evaluate(() => window.__harness.recoverable), console: console_ });
      await context.close();
    }
    // 2. Телефон 390: окно поверх модального листа панели.
    {
      const { context, page, console_ } = await open({ width: 390, height: 844 }, "/v3/pipeline", true);
      await cardLink(page, 1).click();
      await panel(page).waitFor();
      await panel(page).getByRole("button", { name: "Ещё действия" }).click();
      await page.waitForSelector('[data-testid="v3-lead-actions-menu"]:popover-open');
      await page.screenshot({ path: join(outDir, "close-lead-menu-390.png") });
      await page.getByRole("button", { name: "Закрыть лид…" }).click();
      await page.getByTestId("v3-close-lead-dialog").waitFor();
      await page.getByRole("radio", { name: "Другое", exact: true }).check();
      await page.getByLabel("Что случилось").fill("Перезвонит сам после экзаменов");
      const dialog = await dialogMetrics(page);
      await page.screenshot({ path: join(outDir, "close-lead-dialog-390.png") });
      await page.getByTestId("v3-close-lead-dialog").getByRole("button", { name: "Закрыть лид" }).click();
      await page.getByTestId("v3-pipeline-closed-notice").waitFor();
      const closed = {
        notice: (await page.getByTestId("v3-pipeline-closed-notice").textContent()).replace(/\s+/gu, " ").trim(),
        overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
      await page.screenshot({ path: join(outDir, "close-lead-closed-390.png") });
      // Клавиатурный фокус на «Вернуть в работу»: рамка не ложится на строку над кнопкой.
      await page.keyboard.press("Tab");
      await page.getByTestId("v3-pipeline-closed-notice").getByRole("button", { name: "Вернуть в работу" }).focus();
      closed.focusRing = await page.evaluate(() => {
        const button = document.activeElement;
        const run = button?.closest('[data-testid="v3-lead-closed-line"]')?.querySelector("p");
        if (!button || !run) return null;
        const style = getComputedStyle(button);
        const ringTop = button.getBoundingClientRect().top - parseFloat(style.outlineOffset) - parseFloat(style.outlineWidth);
        return { visible: button.matches(":focus-visible"), gapToText: Math.round(ringTop - run.getBoundingClientRect().bottom) };
      });
      await page.screenshot({ path: join(outDir, "close-lead-closed-focus-390.png") });
      report({ journey: "close-lead-390", dialog, closed, recoverable: await page.evaluate(() => window.__harness.recoverable), console: console_ });
      await context.close();
    }
    // 3. «Закрытые лиды»: список с причиной и датой, на ноутбуке и телефоне.
    for (const [size, viewport, mobile] of [["1440", { width: 1440, height: 900 }, false], ["390", { width: 390, height: 844 }, true]]) {
      const { context, page, console_ } = await open(viewport, "/v3/pipeline?view=closed", mobile);
      const list = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('[data-testid="v3-closed-leads"] li')].map((row) => row.textContent.replace(/\s+/gu, " ").trim()),
        h1: document.querySelector("main h1")?.textContent?.trim(),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        solidRed: [...document.querySelectorAll("a, button")].filter((element) => element.checkVisibility()
          && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map((element) => element.textContent.trim()),
      }));
      await page.screenshot({ path: join(outDir, `close-lead-list-${size}.png`), fullPage: mobile });
      report({ journey: `close-lead-list-${size}`, list, console: console_ });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

/**
 * «Отменить» на доске поступления (Э7, миграция 251):
 *   node tests/e2e/boards-static-render.cjs --hydrate-undo [outDir] [--look=next]
 * Снимки `f2-<облик>-<шаг>-<ширина>.png`; измерения — JSON-строки в stdout,
 * нарушения — список `failures` и код выхода 1. Путь клавиатуры (`kbd-*`):
 * Tab до «⋯», Enter, Tab до этапа, Enter → кольцо на «Отменить» → Enter →
 * кольцо на вернувшейся карточке → отказ → кольцо на карточке там, где её
 * назвал сервер, или на ссылке «Открыть в «…»» в строке отказа.
 */
async function hydrateUndo() {
  const outDir = outDirArg("--hydrate-undo");
  const lookName = LOOK_NEXT ? "next" : "current";
  const [css, bundle] = await Promise.all([compileCss("/__fonts"), bundleHydration()]);
  const { server, origin } = await startServer(css, bundle);
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const failures = [];
  const check = (ok, label) => { if (!ok) failures.push(`${lookName}: ${label}`); };
  // Подсказка Next.js в режиме разработки о логотипе оболочки (LCP) к доске не относится.
  const pageErrors = (messages) => messages.filter((text) => !/Largest Contentful Paint/u.test(text));
  const report = (entry) => process.stdout.write(`${JSON.stringify({ look: lookName, ...entry })}\n`);
  // Снимок после появления строки (160 мс, v3.css): видно итоговое состояние, а не середину перехода.
  const shot = async (page, name, width) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, `f2-${lookName}-${name}-${width}.png`) });
  };
  const open = async (viewport, mobile = false) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const console_ = [];
    page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") console_.push(message.text()); });
    page.on("pageerror", (error) => console_.push(`pageerror: ${error.message}`));
    await page.goto(`${origin}/v3/admissions-pipeline`, { waitUntil: "load" });
    await page.waitForSelector("html[data-hydrated=true]", { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { context, page, console_ };
  };
  const card = (page, n) => page.locator(`[data-testid="v3-admissions-pipeline-card"][data-student-case-id="${caseId(n)}"]`);
  /** Где «Отменить» и что видит и слышит сотрудник. */
  const state = (page, n) => page.evaluate((id) => {
    const board = document.querySelector('[data-testid="v3-admissions-pipeline-board"]');
    const toast = document.querySelector('[data-testid="v3-undo-toasts"]');
    const toastButton = toast && toast.matches(":popover-open") ? toast.querySelector("[data-undo-row]") : null;
    const button = document.querySelector("[data-board-undo]") ?? toastButton;
    const offerNode = toastButton ? toastButton.closest("li") : button?.closest("[data-board-undo-line]");
    const rect = button?.getBoundingClientRect();
    const active = document.activeElement;
    const cardNode = document.querySelector(`[data-testid="v3-admissions-pipeline-card"][data-student-case-id="${id}"]`);
    const alertNode = board.querySelector("[role=alert]");
    const fonts = offerNode ? [...offerNode.querySelectorAll("*")].filter((element) => [...element.childNodes]
      .some((node) => node.nodeType === 3 && node.textContent.trim())).map((element) => parseFloat(getComputedStyle(element).fontSize)) : [];
    const red = (element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)";
    const activeStyle = active && active !== document.body ? getComputedStyle(active) : null;
    return {
      offer: offerNode ? offerNode.innerText.replace(/\s+/gu, " ").trim() : null,
      inTopLayer: Boolean(toastButton),
      pending: button ? button.disabled : null,
      target: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : null,
      targetHeight: rect ? rect.height : null,
      minFont: fonts.length ? Math.min(...fonts) : null,
      undoRed: button ? red(button) : false,
      solidRed: [...document.querySelectorAll("a, button")].filter((element) => element.checkVisibility() && red(element)).map((element) => element.textContent.trim()),
      status: [...board.querySelectorAll("[role=status]")].map((element) => element.textContent.trim()).filter(Boolean),
      // Слова, которые видно (не только читалке).
      shownStatus: [...board.querySelectorAll("[role=status]")].filter((element) => !element.classList.contains("sr-only")
        && element.checkVisibility() && element.getBoundingClientRect().height > 1).map((element) => element.textContent.trim()).filter(Boolean),
      alert: alertNode ? [...alertNode.querySelectorAll("p")].map((element) => element.textContent.trim()).join(" ") : null,
      alertLinks: alertNode ? [...alertNode.querySelectorAll("a")].map((element) => element.textContent.trim()) : [],
      hintLinks: [...board.querySelectorAll("a")].filter((element) => /^Открыть в «/u.test(element.textContent.trim())).length,
      // Коробки уведомлений над доской: строка отказа и строка уведомлений (если видна).
      noticeBoxes: [...board.children].filter((element) => element.matches("[role=alert], [tabindex='-1']")
        && element.getBoundingClientRect().height > 1).length,
      focus: !active || active === document.body ? "body"
        : active === button ? "undo"
        : active.matches("[role=alert]") ? "alert"
        : active.closest("[role=alert]") && active.matches("a") ? `alert-link:${active.textContent.trim()}`
        : active.closest('[data-testid="v3-admissions-pipeline-card"]') ? `card:${active.closest('[data-testid="v3-admissions-pipeline-card"]').dataset.studentCaseId === id ? "moved" : "other"}`
        : `${active.tagName.toLowerCase()}:${(active.textContent ?? "").trim().slice(0, 30)}`,
      // Кольцо фокуса: видно ли его и чьё оно — токенов (solid) или браузера (auto).
      ring: activeStyle ? {
        visible: active.matches(":focus-visible"),
        style: activeStyle.outlineStyle,
        color: activeStyle.outlineColor,
        width: activeStyle.outlineWidth,
      } : null,
      picker: board.querySelector("select")?.value ?? null,
      column: cardNode?.closest('[data-testid="v3-admissions-pipeline-column"]')?.querySelector("h2")?.textContent.trim() ?? null,
      cardVisible: Boolean(cardNode?.checkVisibility()),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      lastCall: globalThis.__boardsFixture.pipelineCalls.at(-1) ?? null,
    };
  }, caseId(n));
  const undoButton = (page) => (LOOK_NEXT
    ? page.locator('[data-testid="v3-undo-toasts"] [data-undo-row]')
    : page.locator("[data-board-undo]"));
  const waitOffer = (page) => undoButton(page).waitFor({ state: "visible", timeout: 5_000 });
  const noOffer = (page) => undoButton(page).waitFor({ state: "detached", timeout: 5_000 });
  const common = (label, entry) => {
    check(entry.overflow <= 0, `${label}: no horizontal scroll (${entry.overflow})`);
    check(!entry.undoRed, `${label}: «Отменить» is not the page's red`);
    check(entry.noticeBoxes <= 1, `${label}: one notice box per event (${entry.noticeBoxes})`);
    // Кольцо на цели программного фокуса — токены, не браузер.
    check(!entry.ring || entry.ring.style !== "auto", `${label}: no browser default focus ring (${JSON.stringify(entry.ring)})`);
    if (entry.offer) {
      check(entry.targetHeight >= 44, `${label}: «Отменить» target ${entry.target}`);
      check(entry.minFont >= 12, `${label}: offer text ≥ 12px (${entry.minFont})`);
      check(entry.inTopLayer === LOOK_NEXT, `${label}: ${LOOK_NEXT ? "top-layer toast" : "board line"}`);
    }
  };
  /** Кольцо клавиатуры видно и оно токенов доски (solid, 2px). */
  const ringed = (label, entry) => {
    check(entry.ring && entry.ring.visible && entry.ring.style === "solid" && entry.ring.width === "2px",
      `${label}: themed focus ring (${JSON.stringify(entry.ring)})`);
  };
  const drag = async (page, n, columnIndex) => {
    const source = card(page, n);
    const target = page.locator('[data-testid="v3-admissions-pipeline-column"]').nth(columnIndex);
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    await page.mouse.move(sourceBox.x + 40, sourceBox.y + 12);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 60, sourceBox.y + 30, { steps: 4 });
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 200, { steps: 12 });
    await page.mouse.up();
  };
  const menuMove = async (page, n, stageLabel) => {
    await card(page, n).getByRole("button", { name: "Действия с делом" }).click();
    await page.waitForSelector("[popover]:popover-open");
    await page.locator("[popover]:popover-open").getByRole("button", { name: stageLabel, exact: true }).click();
  };
  /** Только клавиатура: Tab до «⋯», Enter, Tab до этапа, Enter. */
  const keyboardMove = async (page, n, stageLabel, label) => {
    await card(page, n).locator("a").first().focus();
    await page.keyboard.press("Tab");
    const trigger = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check(trigger === "Действия с делом", `${label}: Tab reaches «⋯» (${trigger})`);
    await page.keyboard.press("Enter");
    await page.waitForSelector("[popover]:popover-open");
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const text = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      if (text === stageLabel) break;
    }
    const chosen = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    check(chosen === stageLabel, `${label}: Tab reaches «${stageLabel}» in the menu (${chosen})`);
    await page.keyboard.press("Enter");
  };
  const offerFocused = (page) => page.waitForFunction(() => document.activeElement?.matches("[data-board-undo], [data-undo-row]"));
  const movedText = (name, stage) => `Дело «${name}» перемещено в «${stage}».`;
  const undoneText = (name, stage) => `Перемещение отменено: дело «${name}» снова в «${stage}».`;
  const REFUSED = "Дело уже переместили — отмена не выполнена.";
  const cardIn = (page, n, stage) => page.waitForFunction(([id, heading]) => {
    const node = document.querySelector(`[data-testid="v3-admissions-pipeline-card"][data-student-case-id="${id}"]`);
    return node?.checkVisibility() && node.closest('[data-testid="v3-admissions-pipeline-column"]')?.querySelector("h2")?.textContent.trim() === heading;
  }, [caseId(n), stage]);
  try {
    // 1. 1440: перетаскивание → «Отменить» → отмена; меню → фокус → чужое перемещение → отказ; срок и пауза.
    {
      const { context, page, console_ } = await open({ width: 1440, height: 900 });
      await drag(page, 1, 2);
      await waitOffer(page);
      const dragged = await state(page, 1);
      common("drag offer 1440", dragged);
      check(dragged.offer === `${movedText("Айжан Примерова", "Документы")} Отменить`, `drag offer names the case: ${dragged.offer}`);
      check(dragged.column === "Документы", "the dragged card sits in «Документы»");
      check(dragged.focus !== "undo", "a drag does not move focus to «Отменить»");
      check(dragged.status.includes(movedText("Айжан Примерова", "Документы")), "the move is announced politely");
      check(dragged.lastCall && dragged.lastCall.expectedVersion === undefined, "an ordinary move sends no version");
      await shot(page, "drag-offer", 1440);
      await undoButton(page).click();
      await noOffer(page);
      await cardIn(page, 1, "Новые");
      await page.waitForTimeout(100);
      const undone = await state(page, 1);
      common("undone 1440", undone);
      check(undone.column === "Новые", "undo puts the card back in «Новые»");
      check(undone.lastCall.expectedVersion === 2 && undone.lastCall.stage === "new", `undo sends the receipt's version: ${JSON.stringify(undone.lastCall)}`);
      check(undone.shownStatus.includes(undoneText("Айжан Примерова", "Новые")), `the undo result is shown, not only announced (${undone.shownStatus})`);
      check(undone.focus === "card:moved", `focus after undo on the card (${undone.focus})`);
      check(undone.alert === null, "no error after a clean undo");
      await shot(page, "undone", 1440);

      await menuMove(page, 4, "Готовы к подаче");
      await waitOffer(page);
      await offerFocused(page);
      const menu = await state(page, 4);
      common("menu offer 1440", menu);
      check(menu.focus === "undo", `a menu move puts focus on «Отменить» (${menu.focus})`);
      check(menu.offer === `${movedText("Элина Демо", "Готовы к подаче")} Отменить`, `menu offer names the case: ${menu.offer}`);
      await shot(page, "menu-offer", 1440);
      // Другой сотрудник переместил дело, пока строка «Отменить» открыта; ответ сервера — через 700 мс.
      await page.evaluate((id) => globalThis.__boardsFixture.moveElsewhere(id, "awaiting_decision"), caseId(4));
      await page.evaluate(() => { globalThis.__boardsFixture.delayMs = 700; });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
      const waiting = await state(page, 4);
      check(waiting.column === "Готовы к подаче", `the card waits for the server, no jump back (${waiting.column})`);
      check(waiting.pending === true, "«Отменить» carries the wait (disabled)");
      await page.getByRole("alert").waitFor();
      await page.evaluate(() => { globalThis.__boardsFixture.delayMs = 0; });
      await page.waitForTimeout(150);
      const conflict = await state(page, 4);
      common("conflict 1440", conflict);
      check(conflict.alert === `${REFUSED} Сейчас дело «Элина Демо» — в «Ожидаем решения».`, `conflict line names where the case is: ${conflict.alert}`);
      check(conflict.column === "Ожидаем решения", `the card sits where the server says (${conflict.column})`);
      check(conflict.offer === null, "the refused undo leaves no «Отменить»");
      check(conflict.shownStatus.length === 0, `one line for the event, no second notice (${conflict.shownStatus})`);
      check(!conflict.status.some((text) => text.includes("отменено")), "no success claimed");
      check(conflict.lastCall.expectedVersion === 2, "the undo carried the version of the own move");
      check(conflict.focus === "card:moved", `focus on the card where the server put it (${conflict.focus})`);
      await shot(page, "conflict", 1440);

      // Срок: без указателя строка уходит за ~6 с; под указателем стоит.
      await drag(page, 5, 1);
      await waitOffer(page);
      await page.mouse.move(1300, 60); // вне строки «Отменить» в обоих обликах
      const offeredAt = Date.now();
      await noOffer(page).catch(() => {});
      await page.waitForFunction(() => !document.querySelector("[data-board-undo]")
        && !document.querySelector('[data-testid="v3-undo-toasts"]:popover-open [data-undo-row]'), null, { timeout: 9_000 });
      const expiredAfter = Date.now() - offeredAt;
      check(expiredAfter >= 5_000 && expiredAfter <= 8_000, `the offer expires after ~6 s (${expiredAfter} ms)`);
      await drag(page, 6, 1);
      await waitOffer(page);
      const box = await undoButton(page).boundingBox();
      await page.mouse.move(box.x - 12 > 0 ? box.x - 12 : box.x + 4, box.y + box.height / 2);
      await page.waitForTimeout(7_500);
      const held = await state(page, 6);
      check(held.offer !== null, "the offer stays while the pointer is on it");
      await shot(page, "held", 1440);
      await page.mouse.move(1300, 60); // вне строки «Отменить» в обоих обликах
      await page.waitForFunction(() => !document.querySelector("[data-board-undo]")
        && !document.querySelector('[data-testid="v3-undo-toasts"]:popover-open [data-undo-row]'), null, { timeout: 9_000 });
      report({ journey: "undo-1440", dragged, undone, menu, waiting: { column: waiting.column, pending: waiting.pending }, conflict, expiredAfter, held: { offer: held.offer },
        recoverable: await page.evaluate(() => window.__harness.recoverable), console: console_ });
      check(pageErrors(console_).length === 0, `console clean at 1440: ${pageErrors(console_).join(" | ")}`);
      await context.close();
    }
    // 2. Телефон 390: только меню; отмена после смены этапа в выборе, затем отказ после чужого перемещения в другой раздел.
    {
      const { context, page, console_ } = await open({ width: 390, height: 844 }, true);
      await menuMove(page, 1, "Документы");
      await waitOffer(page);
      await offerFocused(page);
      const offer = await state(page, 1);
      common("menu offer 390", offer);
      check(offer.focus === "undo", `focus on «Отменить» at 390 (${offer.focus})`);
      check(!offer.cardVisible, "the moved card left the shown stage");
      check(offer.offer === `${movedText("Айжан Примерова", "Документы")} Отменить`, `the offer names the case at 390: ${offer.offer}`);
      await shot(page, "menu-offer", 390);
      // Сотрудник открыл «Документы», чтобы увидеть карточку, и отменил оттуда.
      await page.locator('[data-testid="v3-admissions-pipeline-board"] select').selectOption("documents");
      await card(page, 1).waitFor({ state: "visible" });
      await undoButton(page).click();
      await noOffer(page);
      await cardIn(page, 1, "Новые");
      await page.waitForTimeout(100);
      const undone = await state(page, 1);
      common("undone 390", undone);
      check(undone.cardVisible && undone.column === "Новые", "the card is back in the shown stage");
      check(undone.picker === "new", `the picker follows the card back to «Новые» (${undone.picker})`);
      check(undone.focus === "card:moved", `focus on the card at 390 (${undone.focus})`);
      check(undone.shownStatus.includes(undoneText("Айжан Примерова", "Новые")), `the undo result is shown at 390 (${undone.shownStatus})`);
      await shot(page, "undone", 390);
      await menuMove(page, 1, "Документы");
      await waitOffer(page);
      await page.evaluate((id) => globalThis.__boardsFixture.moveElsewhere(id, "visa"), caseId(1));
      await undoButton(page).click();
      await page.getByRole("alert").waitFor();
      await page.waitForTimeout(150);
      const conflict = await state(page, 1);
      common("conflict 390", conflict);
      check(conflict.alert === `${REFUSED} Сейчас дело «Айжан Примерова» — в «Оформление визы».`, `conflict line at 390: ${conflict.alert}`);
      check(conflict.column === null, "the case is on the other tab now");
      check(conflict.alertLinks.length === 1 && conflict.alertLinks[0] === "Открыть в «Виза и выезд»", `the link sits in the conflict line (${conflict.alertLinks})`);
      check(conflict.hintLinks === 1, `one link, no second notice box (${conflict.hintLinks})`);
      check(conflict.shownStatus.length === 0, `no second notice at 390 (${conflict.shownStatus})`);
      check(conflict.focus === "alert-link:Открыть в «Виза и выезд»", `focus on the inline link at 390 (${conflict.focus})`);
      await shot(page, "conflict", 390);
      report({ journey: "undo-390", offer, undone, conflict, recoverable: await page.evaluate(() => window.__harness.recoverable), console: console_ });
      check(pageErrors(console_).length === 0, `console clean at 390: ${pageErrors(console_).join(" | ")}`);
      await context.close();
    }
    // 3. Только клавиатура, 1440 и 390: кольцо на «Отменить», на вернувшейся карточке и на цели после отказа.
    for (const { width, height, mobile, n, name, from, to, elsewhere, expect } of [
      { width: 1440, height: 900, mobile: false, n: 5, name: "Бекзат Тестов", from: "Документы", to: "Готовы к подаче",
        elsewhere: "awaiting_decision", expect: { focus: "card:moved", column: "Ожидаем решения", where: "Сейчас дело «Бекзат Тестов» — в «Ожидаем решения»." } },
      { width: 390, height: 844, mobile: true, n: 2, name: "Тимур Образцов", from: "Новые", to: "Документы",
        elsewhere: "visa", expect: { focus: "alert-link:Открыть в «Виза и выезд»", column: null, where: "Сейчас дело «Тимур Образцов» — в «Оформление визы»." } },
    ]) {
      const { context, page, console_ } = await open({ width, height }, mobile);
      await keyboardMove(page, n, to, `kbd ${width}`);
      await waitOffer(page);
      await offerFocused(page);
      const offer = await state(page, n);
      common(`kbd offer ${width}`, offer);
      check(offer.focus === "undo", `kbd ${width}: focus on «Отменить» (${offer.focus})`);
      ringed(`kbd offer ${width}`, offer);
      check(offer.offer === `${movedText(name, to)} Отменить`, `kbd ${width}: offer ${offer.offer}`);
      await shot(page, "kbd-offer", width);
      await page.keyboard.press("Enter");
      await noOffer(page);
      await cardIn(page, n, from);
      await page.waitForTimeout(100);
      const undone = await state(page, n);
      common(`kbd undone ${width}`, undone);
      check(undone.focus === "card:moved", `kbd ${width}: focus on the returned card (${undone.focus})`);
      ringed(`kbd undone ${width}`, undone);
      check(undone.shownStatus.includes(undoneText(name, from)), `kbd ${width}: undo result shown (${undone.shownStatus})`);
      await shot(page, "kbd-undone", width);
      await keyboardMove(page, n, to, `kbd again ${width}`);
      await waitOffer(page);
      await offerFocused(page);
      await page.evaluate(([id, stage]) => globalThis.__boardsFixture.moveElsewhere(id, stage), [caseId(n), elsewhere]);
      await page.keyboard.press("Enter");
      await page.getByRole("alert").waitFor();
      await page.waitForTimeout(150);
      const conflict = await state(page, n);
      common(`kbd conflict ${width}`, conflict);
      check(conflict.alert === `${REFUSED} ${expect.where}`, `kbd ${width}: conflict line ${conflict.alert}`);
      check(conflict.column === expect.column, `kbd ${width}: card where the server says (${conflict.column})`);
      check(conflict.focus === expect.focus, `kbd ${width}: focus after the conflict (${conflict.focus})`);
      ringed(`kbd conflict ${width}`, conflict);
      await shot(page, "kbd-conflict", width);
      report({ journey: `keyboard-${width}`, offer: { focus: offer.focus, ring: offer.ring }, undone: { focus: undone.focus, ring: undone.ring },
        conflict: { focus: conflict.focus, ring: conflict.ring, alert: conflict.alert }, console: console_ });
      check(pageErrors(console_).length === 0, `console clean kbd ${width}: ${pageErrors(console_).join(" | ")}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  report({ failures });
  if (failures.length) throw new Error(`hydrate-undo: ${failures.length} failure(s)`);
}

// Вызов в конце файла: константы бандла гидратации объявлены выше.
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
