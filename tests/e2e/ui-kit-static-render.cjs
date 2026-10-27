"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Новый вид»: набор виджетов (`/v3/ui-kit`) и переключатель в оболочке — клиентская сборка настоящих
 * компонентов на СИНТЕТИЧЕСКИХ данных (имена, заявки и сотрудник выдуманы). Серверные действия подменены
 * записью вызова, Supabase и маршрутизатор Next.js не проверяются: проверяется вёрстка, токены, адаптив,
 * клавиатура и доступность виджетов.
 *
 *   node tests/e2e/ui-kit-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900, 1280×800, 390×844 (страница набора; панель записи; «?»; окно;
 *       меню; выбор; пустой поиск; загрузка; переключатель выкл/вкл) и проверки (JSON-строки, при нарушении
 *       код 1): нет ошибок консоли, нет горизонтальной прокрутки, нажимаемые ≥ 44 px, axe без нарушений;
 *       фокус возвращается на строку/карточку после панели; ссылка и кнопка в ячейке карточки не открывают запись;
 *       рейка досок (/v3/pipeline, 1280): «Набор виджетов» не в порядке Tab невидимым; шапка стоит на глубине h1 прежней.
 *       По умолчанию outDir — .impeccable/review (не коммитится).
 */

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "../..");
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
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (props.onNavigate) props.onNavigate({ preventDefault() {} });
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
const { UiKit } = require("@/components/v3/ui-kit/UiKit");
const h = React.createElement;
const fixture = JSON.parse(document.getElementById("fixture").textContent);
window.__harness = { pushes: [], toggles: [] };
const router = { push: (href) => window.__harness.pushes.push(href), replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {} };
createRoot(document.getElementById("root")).render(
  h(AppRouterContext.Provider, { value: router },
    h(PathnameContext.Provider, { value: fixture.pathname },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
          h("div", { className: "v3-world", "data-surface": "staff", "data-ui": fixture.nextUi && fixture.nextUi.enabled ? "next" : undefined },
            h(AppShell, { actor: fixture.actor, initialNotifications: null, nextUi: fixture.nextUi },
              fixture.kit ? h(UiKit, { tab: "overview" }) : h("main", { className: "p-6" }, h("h1", { className: "t-page-title" }, "Сегодня")))))))));
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "true"; }));
`;

const ADMIN = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: "aaaaaaaa-1111-4111-8111-000000000001", organizationId: "eeeeeeee-4444-4444-8444-000000000000",
  platformAccessVersion: 1, email: "synthetic@example.invalid", assignments: [], permissionKeys: [],
  displayName: "Администратор Синтетический", systemRole: "admin", presentationRole: null,
};

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
    name: "ui-kit-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      // Серверные действия: переключатель записывает вызов, остальные честно отказывают.
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        if (args.path.endsWith("ui-next-actions.ts")) return { contents: "export async function setNextUiAction(enabled, returnTo) { window.__harness.toggles.push([enabled, returnTo]); }", loader: "ts" };
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return { contents: names.map((name) => `export async function ${name}() { throw new Error("ui-kit harness: server action ${name} is not available"); }`).join("\n"), loader: "ts" };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "ui-kit-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } }; var __dirname = \"/\";" }, plugins: [plugin], logLevel: "error",
  });
}

function writePage(outDir, name, css, fixture) {
  const path = join(outDir, `${name}.html`);
  writeFileSync(path, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Набор виджетов (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div id="root"></div><script type="application/json" id="fixture">${JSON.stringify(fixture)}</script><script src="ui-kit-bundle.js"></script></body></html>`);
  return path;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--screenshots")) throw new Error("usage: node tests/e2e/ui-kit-static-render.cjs --screenshots [outDir]");
  const outDir = resolve(args[args.indexOf("--screenshots") + 1] && !args[args.indexOf("--screenshots") + 1].startsWith("--") ? args[args.indexOf("--screenshots") + 1] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  await buildBundle(join(outDir, "ui-kit-bundle.js"));
  const css = await compileCss();
  const pages = {
    kit: writePage(outDir, "ui-kit", css, { actor: ADMIN, pathname: "/v3/ui-kit", search: "tab=overview", nextUi: { enabled: true }, kit: true }),
    off: writePage(outDir, "ui-kit-shell-off", css, { actor: ADMIN, pathname: "/v3/main", search: "", nextUi: { enabled: false }, kit: false }),
    rail: writePage(outDir, "ui-kit-shell-rail", css, { actor: ADMIN, pathname: "/v3/pipeline", search: "", nextUi: { enabled: true }, kit: false }),
    staff: writePage(outDir, "ui-kit-shell-staff", css, { actor: { ...ADMIN, systemRole: "staff", displayName: "Сотрудник Синтетический" }, pathname: "/v3/main", search: "", nextUi: null, kit: false }),
  };
  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  const results = [];
  let failed = false;
  const report = (check, ok, detail) => {
    results.push({ check, ok, detail });
    if (!ok) failed = true;
    console.log(JSON.stringify({ check, ok, detail }));
  };

  async function open(htmlPath, key, reducedMotion = "reduce") {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !/notifications\/state/u.test(message.text())) errors.push(message.text()); });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  }
  // Окна, панели и меню должны рисоваться внутри корня staff CRM (токены) и иметь непрозрачную подложку.
  const overlayOk = (page, selector) => page.evaluate((query) => {
    const element = document.querySelector(query);
    if (!element) return { found: false };
    const background = getComputedStyle(element).backgroundColor;
    return { found: true, insideWorld: Boolean(element.closest('.v3-world[data-ui="next"]')), background, opaque: !/rgba\(0, 0, 0, 0\)|transparent/u.test(background) };
  }, selector);
  const expectOverlay = async (page, key, name, selector) => {
    const result = await overlayOk(page, selector);
    report(`${key}: ${name} inside world and opaque`, result.found && result.insideWorld && result.opaque, result);
  };
  const shot = (page, name, options = {}) => page.screenshot({ path: join(outDir, `${name}.png`), ...options });

  for (const key of ["d1440", "d1280", "m390"]) {
    const { context, page, errors } = await open(pages.kit, key);
    await shot(page, `kit-${key}`, { fullPage: true });
    report(`${key}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
    const small = await page.evaluate(() => {
      const visible = (element) => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== "hidden"; };
      // Значок «?», флажок и переключатель увеличивают зону нажатия псевдоэлементом `after` на 44 px.
      return [...document.querySelectorAll("[data-testid=v3-ui-kit] a, [data-testid=v3-ui-kit] button, [data-testid=v3-ui-kit] input:not([type=checkbox]), [data-testid=v3-ui-kit] [role=combobox]")]
        .filter((element) => visible(element) && !element.matches("[aria-label^=Пояснение], [role=switch], [role=checkbox]"))
        .map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 30), h: Math.round(element.getBoundingClientRect().height), w: Math.round(element.getBoundingClientRect().width) }))
        .filter((box) => box.h < 44);
    });
    report(`${key}: targets >= 44px`, small.length === 0, small);
    // Оболочка (меню, строка логотипа на телефоне) — прежняя и не часть набора: проверяется страница набора.
    const axe = await new AxeBuilder({ page }).include("[data-testid=v3-ui-kit]").analyze();
    report(`${key}: axe (kit page)`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
    report(`${key}: console clean`, errors.length === 0, errors);
    // Шапка нового вида стоит на глубине прежней (корень > div > h1): правила оболочки в v3.css находят её и дают тот же верхний отступ.
    const top = await page.evaluate(() => {
      const main = document.querySelector("[data-testid=v3-ui-kit]");
      const probe = document.createElement("div");
      probe.style.paddingTop = "var(--shell-page-top)";
      main.append(probe);
      const expected = getComputedStyle(probe).paddingTop;
      probe.remove();
      return { matches: main.matches(":has(> div:first-child > div:first-child > h1.t-page-title)"), paddingTop: getComputedStyle(main).paddingTop, expected };
    });
    report(`${key}: page header matches shell rules (top offset)`, top.matches && top.paddingTop === top.expected, top);
    // Плитка: промежуток между подписью, числом и пояснением 4 px (gap-1 плитки не перебивается промежутком Card).
    const tileGaps = await page.evaluate(() => [...document.querySelectorAll("[data-slot=stat-tile] [data-slot=card]")].map((element) => getComputedStyle(element).rowGap));
    report(`${key}: stat tile gap is 4px`, tileGaps.length >= 4 && tileGaps.every((gap) => gap === "4px"), tileGaps);
    // «?» названы по хозяину: на странице нет одинаковых «Пояснение».
    const helpNames = await page.evaluate(() => [...document.querySelectorAll("[data-testid=v3-ui-kit] button[aria-label^=Пояснение]")].map((element) => element.getAttribute("aria-label")));
    report(`${key}: help buttons named by owner`, helpNames.length >= 5 && helpNames.every((name) => name.startsWith("Пояснение: ")) && new Set(helpNames).size === helpNames.length, helpNames);
    await context.close();
  }

  // Взаимодействия: панель записи, «?», окно, меню, выбор, пустой поиск, загрузка — на 1280 и 390.
  for (const key of ["d1280", "m390"]) {
    const { context, page, errors } = await open(pages.kit, key);
    const table = page.locator("[data-slot=data-table]");
    await table.scrollIntoViewIfNeeded();
    // Строка таблицы (1280) и кнопка карточки (390) открывают панель; на нажатие в «пустое» место, не на ссылку или кнопку ячейки.
    const opener = key === "d1280" ? page.getByRole("row").nth(1) : page.locator("[data-slot=data-table-cards] > li > button").first();
    if (key === "d1280") await opener.locator("td").nth(2).click(); else await opener.click({ position: { x: 8, y: 8 } });
    await page.getByRole("dialog").waitFor();
    await expectOverlay(page, key, "sheet", "[data-slot=sheet-content]");
    await shot(page, `sheet-${key}`);
    report(`${key}: sheet focus inside`, await page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest("[role=dialog]"))), null);
    const sheetWidth = Math.round((await page.locator("[data-slot=sheet-content]").boundingBox()).width);
    report(`${key}: sheet width`, sheetWidth === (key === "d1280" ? 512 : 390), sheetWidth);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    report(`${key}: sheet closed by Esc`, true, null);
    report(`${key}: focus returns to the ${key === "d1280" ? "row" : "card"} after Esc`, await opener.evaluate((element) => element === document.activeElement), await page.evaluate(() => document.activeElement && document.activeElement.tagName));
    if (key === "d1280") {
      await opener.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "Закрыть" }).first().click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      report(`${key}: focus returns to the row after Enter + close button`, await opener.evaluate((element) => element === document.activeElement), await page.evaluate(() => document.activeElement && document.activeElement.tagName));
    } else {
      // Ссылка и кнопка внутри карточки действуют сами и не открывают запись (раньше карточка-кнопка вызывала оба действия).
      const card = page.locator("[data-slot=data-table-cards] > li").nth(1);
      await card.getByRole("link").click();
      const hash = await page.evaluate(() => location.hash);
      report(`${key}: card link follows, row not opened`, hash === "#sample-2" && (await page.getByRole("dialog").count()) === 0, hash);
      await card.getByRole("button", { name: "Взять" }).click();
      report(`${key}: card action runs, row not opened`, (await card.getByRole("button", { name: "Взять" }).count()) === 0 && (await card.getByText("Взята").count()) === 1 && (await page.getByRole("dialog").count()) === 0, null);
    }
    await page.getByRole("button", { name: /^Пояснение: / }).first().click();
    const helpDialog = page.getByRole("dialog", { name: /^Пояснение: / });
    await helpDialog.waitFor();
    const described = await helpDialog.evaluate((element) => {
      const target = document.getElementById(element.getAttribute("aria-describedby") || "");
      return { text: target ? target.textContent.trim().length : 0, inside: Boolean(target && element.contains(target)) };
    });
    report(`${key}: help popover text is its description`, described.text > 0 && described.inside, described);
    await expectOverlay(page, key, "help popover", "[data-slot=popover-content]");
    await shot(page, `helptip-${key}`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Окно" }).click();
    await page.getByRole("dialog").waitFor();
    await expectOverlay(page, key, "dialog", "[data-slot=dialog-content]");
    await shot(page, `dialog-${key}`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Меню" }).click();
    await page.getByRole("menu").waitFor();
    await expectOverlay(page, key, "menu", "[data-slot=dropdown-menu-content]");
    await shot(page, `menu-${key}`);
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "Этап" }).click();
    await page.getByRole("listbox").waitFor();
    await expectOverlay(page, key, "select", "[data-slot=select-content]");
    await shot(page, `select-${key}`);
    await page.keyboard.press("Escape");
    if (key === "d1280") {
      const row = page.getByRole("row").nth(1);
      await row.getByRole("button", { name: "Взять" }).click();
      report(`${key}: row action runs, row not opened`, (await row.getByText("Взята").count()) === 1 && (await page.getByRole("dialog").count()) === 0, null);
      // Таблица на деле: сортировка по заголовку, страницы, видимость колонок, общий поиск.
      const firstName = () => table.locator("tbody tr").first().locator("td").first().textContent();
      await table.getByRole("button", { name: /Имя/u }).click();
      await table.getByRole("button", { name: /Имя/u }).click();
      report(`${key}: sort by header (desc)`, (await table.locator("th[aria-sort=descending]").count()) === 1 && /27$/u.test((await firstName()).trim()), await firstName());
      await table.getByRole("button", { name: "Следующая страница" }).click();
      report(`${key}: next page`, (await table.locator("[data-slot=data-table-pagination] p").textContent()).trim() === "11–20 из 27", await table.locator("[data-slot=data-table-pagination] p").textContent());
      await table.getByRole("button", { name: "Колонки" }).click();
      await page.getByRole("menuitemcheckbox", { name: "Источник" }).click();
      await page.keyboard.press("Escape");
      report(`${key}: column hidden`, (await table.getByRole("button", { name: /Источник/u }).count()) === 0 && (await table.getByRole("button", { name: /Этап/u }).count()) === 1, null);
      await table.getByRole("searchbox").fill("Синтетический 2");
      const filtered = (await table.locator("tbody tr td:first-child").allTextContents()).map((text) => text.trim());
      report(`${key}: global search`, filtered.length > 0 && filtered.every((text) => text.includes("Синтетический 2")) && (await table.locator("[data-slot=data-table-pagination] p").count()) <= 1, filtered.length);
      await table.getByRole("searchbox").fill("");
    }
    await table.getByRole("searchbox").fill("нетакогоимени");
    await shot(page, `empty-search-${key}`);
    report(`${key}: empty search offers reset`, await table.getByRole("button", { name: "Сбросить поиск" }).isVisible(), null);
    await table.getByRole("button", { name: "Сбросить поиск" }).click();
    await page.getByRole("button", { name: "Загрузка" }).click();
    await shot(page, `loading-${key}`);
    report(`${key}: interactions console clean`, errors.length === 0, errors);
    await context.close();
  }

  // Панель закрывается 200 мс: за это время заголовок и данные записи остаются (не «Заявка» и не пустое тело).
  {
    const { context, page } = await open(pages.kit, "d1280", "no-preference");
    await page.locator("[data-slot=data-table]").scrollIntoViewIfNeeded();
    await page.getByRole("row").nth(1).locator("td").nth(2).click();
    await page.getByRole("dialog").waitFor();
    const samples = await page.evaluate(async () => {
      const taken = [];
      const sample = () => {
        const panel = document.querySelector("[data-slot=sheet-content]");
        if (panel) taken.push([panel.querySelector("[data-slot=sheet-title]").textContent, Boolean(panel.querySelector("[data-slot=key-facts]")), panel.getAttribute("data-state")]);
      };
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      for (let i = 0; i < 12; i += 1) { sample(); await new Promise((done) => setTimeout(done, 25)); }
      return taken;
    });
    const closing = samples.filter((sampleRow) => sampleRow[2] === "closed");
    report("d1280: sheet keeps the record while closing", closing.length > 0 && closing.every(([title, facts]) => title === "Тест Синтетический 1" && facts), samples);
    await context.close();
  }

  // Рейка досок (/v3/pipeline, 768–1535 px): «Набор виджетов» не остаётся невидимой ссылкой в порядке Tab.
  {
    const { context, page } = await open(pages.rail, "d1280");
    const rail = await page.evaluate(() => {
      const nav = document.querySelector("[data-shell-account]");
      const box = (element) => { const rect = element.getBoundingClientRect(); return { w: Math.round(rect.width), h: Math.round(rect.height) }; };
      const tabbable = [...nav.querySelectorAll("a[href], button:not([disabled]), [role=switch]")].filter((element) => getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
      return { switchShown: Boolean(nav.querySelector("[role=switch]")), kitLinks: tabbable.filter((element) => /ui-kit/u.test(element.getAttribute("href") || "")).length, small: tabbable.map((element) => ({ label: (element.getAttribute("aria-label") || element.textContent || element.tagName).trim().slice(0, 24), ...box(element) })).filter((item) => item.w < 40 || item.h < 40) };
    });
    report("d1280 rail: switch visible, no invisible tabbable in account area", rail.switchShown && rail.kitLinks === 0 && rail.small.length === 0, rail);
    const seen = [];
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press("Tab");
      seen.push(await page.evaluate(() => { const element = document.activeElement; const rect = element.getBoundingClientRect(); return { tag: element.tagName, label: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 24), w: Math.round(rect.width), h: Math.round(rect.height) }; }));
    }
    report("d1280 rail: every Tab stop has a visible box", seen.every((stop) => stop.w >= 8 && stop.h >= 8), seen.filter((stop) => stop.w < 8 || stop.h < 8));
    await shot(page, "toggle-rail-d1280", { clip: { x: 0, y: 560, width: 120, height: 240 } });
    await context.close();
  }

  // Переключатель: администратор видит строку, сотрудник — нет; нажатие записывает вызов с адресом возврата.
  for (const key of ["d1440", "m390"]) {
    const off = await open(pages.off, key);
    if (key === "m390") await off.page.getByRole("button", { name: /Ещё/u }).click();
    await shot(off.page, `toggle-off-${key}`);
    const toggle = off.page.getByRole("switch", { name: "Новый вид" });
    report(`${key}: admin sees switch (off)`, (await toggle.getAttribute("aria-checked")) === "false", null);
    await toggle.click();
    report(`${key}: click calls action`, JSON.stringify(await off.page.evaluate(() => window.__harness.toggles)) === JSON.stringify([[true, "/v3/main"]]), await off.page.evaluate(() => window.__harness.toggles));
    await off.context.close();
    const staff = await open(pages.staff, key);
    if (key === "m390") await staff.page.getByRole("button", { name: /Ещё/u }).click();
    report(`${key}: staff has no switch`, (await staff.page.getByRole("switch", { name: "Новый вид" }).count()) === 0, null);

    await staff.context.close();
  }
  const on = await open(pages.kit, "d1440");
  await shot(on.page, "toggle-on-d1440", { clip: { x: 0, y: 500, width: 280, height: 400 } });
  report("d1440: switch on + kit link", (await on.page.getByRole("switch", { name: "Новый вид" }).getAttribute("aria-checked")) === "true" && (await on.page.getByRole("link", { name: "Набор виджетов" }).count()) === 1, null);
  await on.context.close();

  await browser.close();
  writeFileSync(join(outDir, "ui-kit-checks.json"), JSON.stringify(results, null, 2));
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
