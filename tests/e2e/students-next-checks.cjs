"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/** Проверки и снимки стенда `students-next-static-render.cjs` (Chromium: 1440, 1280, 390; axe, 44 px, фокус, Esc, строки открывают запись). */

const { mkdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const harness = require("./students-next-static-render.cjs");
const { journeys } = require("./students-next-journeys.cjs");
const { journeys: fixes } = require("./students-next-fixes-journeys.cjs");

const MAINS = { students: "v3-students-next", universities: "v3-universities-next", university: "v3-university-next", manage: "v3-universities-next" };
// Страницы, у которых проверяются все три ширины; остальные — 1440 и 390.
const ALL_WIDTHS = new Set(["queue", "mine", "docs-review", "docs-program", "docs-packages", "curators", "uni-list", "uni-detail", "uni-manage"]);

async function run() {
  const args = process.argv.slice(2);
  if (!args.includes("--screenshots")) throw new Error("usage: node tests/e2e/students-next-static-render.cjs --screenshots [outDir]");
  const next = args[args.indexOf("--screenshots") + 1];
  const outDir = resolve(next && !next.startsWith("--") ? next : join(harness.ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  await harness.buildBundle(join(outDir, "students-next-bundle.js"));
  const css = await harness.compileCss();
  const pages = harness.pagesOf(harness.build());
  const files = Object.fromEntries(Object.entries(pages).map(([name, data]) => [name, harness.writePage(outDir, `students-next-${name}`, css, data)]));
  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  let failed = false;
  let total = 0;
  const report = (check, ok, detail) => {
    total += 1;
    if (!ok) failed = true;
    console.log(JSON.stringify({ check, ok, detail }));
  };
  async function open(name, key, reducedMotion = "reduce") {
    const context = await browser.newContext({ ...harness.VIEWPORTS[key], reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !/notifications\/state/u.test(message.text())) errors.push(message.text()); });
    await page.goto(pathToFileURL(files[name]).href, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
    await harness.lazySettled(page);
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  }
  const shot = (page, name, options = {}) => page.screenshot({ path: join(outDir, `${name}.png`), ...options });
  const tools = { open, shot, report, outDir, pages, AxeBuilder, harness };

  // 1. Каждая страница на своих ширинах: без горизонтальной прокрутки, один h1, цели ≥ 44 px, axe, шапка по правилам оболочки.
  for (const [name, data] of Object.entries(pages)) {
    const testId = MAINS[data.kind];
    for (const key of ALL_WIDTHS.has(name) ? ["d1440", "d1280", "m390"] : ["d1440", "m390"]) {
      const { context, page, errors } = await open(name, key);
      await shot(page, `${name}-${key}`, { fullPage: true });
      if (key === "d1440") await shot(page, `${name}-${key}-first`);
      const label = `${name} ${key}`;
      const metrics = await page.evaluate((id) => {
        const main = document.querySelector(`[data-testid=${id}]`);
        const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden" && element.checkVisibility(); };
        const probe = document.createElement("div");
        probe.style.paddingTop = "var(--shell-page-top)";
        main?.append(probe);
        const expected = getComputedStyle(probe).paddingTop;
        probe.remove();
        const small = main ? [...main.querySelectorAll("a, button, input:not([type=checkbox]), [role=combobox], summary")]
          // Названия-ссылки накрывают всю ячейку (`before:inset-0`), «?» увеличивает зону псевдоэлементом, ссылки в тексте — как в прежнем виде.
          .filter((element) => visible(element) && !element.matches("[aria-label^=Пояснение], [data-queue-open], [role=switch], [role=checkbox], [data-photo-credit] a") && !element.closest("[data-slot=data-table-cards] dl"))
          .map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 30), h: Math.round(element.getBoundingClientRect().height) }))
          .filter((box) => box.h < 44) : [];
        const cards = [...document.querySelectorAll("[data-slot=data-table-cards] > li")].filter((card) => card.getClientRects().length > 0);
        const region = [...document.querySelectorAll("[role=region][aria-label]")].find((element) => element.getClientRects().length > 0);
        return {
          found: Boolean(main), overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
          h1: [...document.querySelectorAll("h1")].map((element) => element.textContent.trim()),
          small, header: main && main.firstElementChild?.tagName !== "A" ? { matches: main.matches(":has(> div:first-child > div:first-child > h1.t-page-title)"), paddingTop: getComputedStyle(main).paddingTop, expected } : null,
          wideCards: cards.filter((card) => card.getBoundingClientRect().right > window.innerWidth - 8).length,
          tableOverflow: region ? region.scrollWidth - region.clientWidth : 0,
          reds: [...document.querySelectorAll("a, button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)" && element.getBoundingClientRect().width > 0).map((element) => element.textContent.trim()),
        };
      }, testId);
      report(`${label}: page root present`, metrics.found, testId);
      report(`${label}: no horizontal scroll`, metrics.overflow <= 0, metrics.overflow);
      report(`${label}: one h1`, metrics.h1.length === 1 && metrics.h1[0].length > 0, metrics.h1);
      report(`${label}: targets >= 44px`, metrics.small.length === 0, metrics.small);
      report(`${label}: cards inside the viewport, table without horizontal scroll`, metrics.wideCards === 0 && metrics.tableOverflow <= 0, { wide: metrics.wideCards, table: metrics.tableOverflow });
      if (metrics.header) report(`${label}: header matches shell rules`, metrics.header.matches && metrics.header.paddingTop === metrics.header.expected, metrics.header);
      report(`${label}: at most one red button`, metrics.reds.length <= 1, metrics.reds);
      if (key !== "d1280") {
        const axe = await new AxeBuilder({ page }).include(`[data-testid=${testId}]`).analyze();
        report(`${label}: axe`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
      }
      report(`${label}: console clean`, errors.length === 0, errors);
      await context.close();
    }
  }

  // 2. Пути: строка → панель → действие, клавиатура, фильтры, вкладки, очереди EVO Docs.
  for (const journey of [...journeys, ...fixes]) await journey(tools);

  await browser.close();
  console.log(JSON.stringify({ summary: { checks: total, failed } }));
  if (failed) process.exit(1);
}

module.exports = { run };
