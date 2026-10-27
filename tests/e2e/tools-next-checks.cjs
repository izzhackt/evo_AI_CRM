"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Проверки стенда `tools-next-static-render.cjs`: общие для каждой страницы на 1440, 1280 и 390 (нет боковой прокрутки,
 * цели ≥ 44 px, axe, консоль, один `h1`, одна красная кнопка, шапка по правилам оболочки) и сценарии `tools-next-flows.cjs`
 * (строка → панель → действие, клавиатура и Esc). Каждая проверка — JSON-строка; при нарушении код выхода 1.
 */

const { mkdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

/** Видимые элементы управления страницы меньше 44 px; исключения те же, что у стендов первой волны (см. tasks-next). */
function smallTargets() {
  const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"; };
  const root = document.querySelector("main");
  if (!root) return [];
  return [...root.querySelectorAll("a, button, input:not([type=hidden]), select, textarea, [role=combobox], [role=checkbox], summary")]
    .filter((element) => visible(element)
      // «?» увеличен псевдоэлементом; флажок — зона нажатия 44 px на `after`; накладка карточки и ссылка внутри абзаца — не цели.
      && !element.matches("[aria-label^=Пояснение], [data-card-open], [role=checkbox]")
      && !(element.tagName === "A" && element.parentElement?.tagName === "P")
      && !element.closest("details:not([open]) > :not(summary)"))
    .map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 30), h: Math.round(element.getBoundingClientRect().height), w: Math.round(element.getBoundingClientRect().width) }))
    .filter((box) => box.h < 44);
}

function pageFacts() {
  const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"; };
  const main = [...document.querySelectorAll("main")].find(visible) ?? document.querySelector("main");
  const reds = [...document.querySelectorAll("main a, main button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)" && visible(element)).map((element) => (element.textContent || element.getAttribute("aria-label") || "").trim());
  const probe = document.createElement("div");
  probe.style.paddingTop = "var(--shell-page-top)";
  main.append(probe);
  const expected = getComputedStyle(probe).paddingTop;
  probe.remove();
  return {
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    h1: [...document.querySelectorAll("h1")].filter(visible).map((element) => element.textContent.trim()),
    reds,
    paddingTop: getComputedStyle(main).paddingTop, expected,
    chatPanel: document.querySelector("[data-panel]")?.getAttribute("data-panel") ?? null,
    hasHeaderRule: main.matches(":has(> div:first-child > div:first-child > h1.t-page-title)"),
  };
}

async function main() {
  const { PAGES, VIEWPORTS, buildBundle, compileCss, writePage, ROOT, lazySettled } = require("./tools-next-static-render.cjs");
  const { flows } = require("./tools-next-flows.cjs");
  const args = process.argv.slice(2);
  if (!args.includes("--screenshots")) throw new Error("usage: node tests/e2e/tools-next-static-render.cjs --screenshots [outDir] [--only a,b] [--flows-only]");
  const next = args[args.indexOf("--screenshots") + 1];
  const outDir = resolve(next && !next.startsWith("--") ? next : join(ROOT, ".impeccable/review"));
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  mkdirSync(outDir, { recursive: true });
  await buildBundle(join(outDir, "tools-next-bundle.js"));
  const css = await compileCss();
  const paths = Object.fromEntries(Object.keys(PAGES).map((name) => [name, writePage(outDir, `tools-next-${name}`, css, PAGES[name])]));
  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  let failed = false;
  let count = 0;
  const report = (check, ok, detail) => {
    count += 1;
    if (!ok) failed = true;
    console.log(JSON.stringify({ check, ok, detail }));
  };
  async function open(name, key, reducedMotion = "reduce") {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !/notifications\/state/u.test(message.text())) errors.push(message.text()); });
    await page.goto(pathToFileURL(paths[name]).href, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
    await lazySettled(page);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  }
  const shot = (page, name, options = {}) => page.screenshot({ path: join(outDir, `${name}.png`), ...options });
  const env = { open, report, shot, outDir, pages: PAGES };

  // 1. Каждая страница на трёх ширинах.
  if (!args.includes("--flows-only")) {
    for (const name of Object.keys(PAGES).filter((page) => !only || only.includes(page))) {
      for (const key of Object.keys(VIEWPORTS)) {
        const { context, page, errors } = await open(name, key);
        await shot(page, `${name}-${key}`, { fullPage: true });
        // Снимки «до» — прежний вид на тех же данных: проверок нового вида у них нет.
        if (name.startsWith("legacy-")) {
          report(`${name} ${key}: legacy view renders without console errors`, errors.length === 0, errors);
          await context.close();
          continue;
        }
        const facts = await page.evaluate(pageFacts);
        const label = `${name} ${key}`;
        report(`${label}: no horizontal scroll`, facts.overflow <= 1, facts.overflow);
        const small = await page.evaluate(smallTargets);
        report(`${label}: targets >= 44px`, small.length === 0, small);
        const axe = await new AxeBuilder({ page }).include("main").analyze();
        report(`${label}: axe`, axe.violations.length === 0, axe.violations.map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`));
        const chatInPanel = name.startsWith("chat") && facts.chatPanel === "messages" && key === "m390";
        report(`${label}: one visible h1`, facts.h1.length === 1 || (chatInPanel && facts.h1.length === 0), facts.h1);
        report(`${label}: at most one red button`, facts.reds.length <= 1, facts.reds);
        if (facts.hasHeaderRule) report(`${label}: header matches shell padding`, facts.paddingTop === facts.expected, [facts.paddingTop, facts.expected]);
        report(`${label}: console clean`, errors.length === 0, errors);
        await context.close();
      }
    }
  }

  // 2. Сценарии: строка → панель → действие, клавиатура, Esc.
  for (const flow of flows) {
    if (only && !only.includes(flow.name)) continue;
    await flow.run(env);
  }
  await browser.close();
  console.log(JSON.stringify({ done: true, checks: count, failed }));
  if (failed) process.exitCode = 1;
}

module.exports = { main };
