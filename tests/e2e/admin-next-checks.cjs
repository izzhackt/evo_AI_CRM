"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Проверки стенда `admin-next-static-render.cjs`: общие для каждой страницы на 1440, 1280 и 390 (нет боковой прокрутки, цели ≥ 44 px, axe, консоль,
 * один `h1`, не больше одной красной кнопки, шапка по правилам оболочки), короткие на 1024, 360 и 320 (боковая прокрутка, цели, консоль) и сценарии
 * `admin-next-flows.cjs` (строка → панель → действие, клавиатура и Esc). Каждая проверка — JSON-строка; при нарушении код выхода 1.
 *
 * «Нет боковой прокрутки» меряется не по `innerWidth`: у телефонного контекста (`isMobile`) Chromium растягивает окно раскладки до ширины
 * содержимого, и `scrollWidth - innerWidth` всегда 0; а `overflow-x: clip` у `html` и `body` не даёт странице прокручиваться, но обрезает
 * содержимое, и пользователь не может до него добраться. Поэтому смотрим ширину видимой области (`clientWidth`) и содержимое самой страницы
 * (`main`): оно не должно быть шире области.
 */
const { mkdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { blankBandBelowRoot, clippedTables, headerWrapViolations } = require("./layout-probes.cjs");

/** Видимые элементы управления страницы меньше 44 px; исключения те же, что у стендов первой волны. */
function smallTargets() {
  const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"; };
  const root = document.querySelector("main");
  if (!root) return [];
  return [...root.querySelectorAll("a, button, input:not([type=hidden]), select, textarea, [role=combobox], [role=checkbox], summary")]
    .filter((element) => visible(element)
      && !element.matches("[aria-label^=Пояснение], [data-card-open], [role=checkbox]")
      && !(element.tagName === "A" && element.parentElement?.tagName === "P")
      && !(element.tagName === "A" && element.closest("td, dd, li, span, h2, h3"))
      // Флажок или переключатель внутри подписи высотой от 44 px: цель нажатия — подпись (сам флажок 16–20 px или скрыт для глаз).
      && !(element.tagName === "INPUT" && /^(?:checkbox|radio)$/u.test(element.type) && (element.closest("label")?.getBoundingClientRect().height ?? 0) >= 44)
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
  const doc = document.documentElement;
  return {
    overflow: doc.scrollWidth - doc.clientWidth,
    bodyOverflow: document.body.scrollWidth - doc.clientWidth,
    mainOverflow: main.scrollWidth - main.clientWidth,
    h1: [...document.querySelectorAll("h1")].filter(visible).map((element) => element.textContent.trim()),
    reds, paddingTop: getComputedStyle(main).paddingTop, expected,
    hasHeaderRule: main.matches(":has(> div:first-child > div:first-child > h1.t-page-title)"),
  };
}

async function main() {
  const { VIEWPORTS, LITE, buildBundle, buildPages, compileCss, writePage, ROOT, lazySettled } = require("./admin-next-static-render.cjs");
  const flows = require("./admin-next-flows.cjs").flows;
  const args = process.argv.slice(2);
  if (!args.includes("--screenshots")) throw new Error("usage: node tests/e2e/admin-next-static-render.cjs --screenshots [outDir] [--only a,b] [--flows-only]");
  const next = args[args.indexOf("--screenshots") + 1];
  const outDir = resolve(next && !next.startsWith("--") ? next : join(ROOT, ".impeccable/review"));
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  mkdirSync(outDir, { recursive: true });
  const PAGES = await buildPages();
  await buildBundle(join(outDir, "admin-next-bundle.js"));
  const css = await compileCss();
  const paths = Object.fromEntries(Object.keys(PAGES).map((name) => [name, writePage(outDir, name, css, PAGES[name])]));
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
  async function open(name, key, options = {}) {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce", ...(options.context ?? {}) });
    // Стенд не ходит в сеть: окно отчёта Looker Studio отвечает заглушка (адрес окна записан в `window.__harness.frames`), остальные http(s) запросы отклоняются.
    context.__frames = [];
    await context.route(/^https?:/u, (route) => {
      const url = route.request().url();
      if (url.startsWith("https://lookerstudio.google.com/embed/")) {
        context.__frames.push(url);
        return route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Синтетический отчёт</title></head><body><main><p>Синтетическое окно отчёта: Google здесь не вызывается.</p></main></body></html>' });
      }
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !/notifications\/state|Failed to load resource/u.test(message.text())) errors.push(message.text()); });
    await page.goto(pathToFileURL(paths[name]).href, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
    await lazySettled(page);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  }
  const shot = (page, name, options = {}) => page.screenshot({ path: join(outDir, `${name}.png`), ...options });
  const env = { open, report, shot, outDir, pages: PAGES, AxeBuilder };

  // 1. Каждая страница на трёх ширинах; «до» — на 1440 и 390.
  if (!args.includes("--flows-only")) {
    for (const name of Object.keys(PAGES).filter((page) => !only || only.includes(page))) {
      for (const key of Object.keys(VIEWPORTS)) {
        const legacy = name.startsWith("legacy-");
        if (legacy && (key === "d1280" || LITE.has(key))) continue;
        const { context, page, errors } = await open(name, key);
        await shot(page, `${name}-${key}`, { fullPage: true });
        if (legacy) {
          report(`${name} ${key}: legacy view renders without console errors`, errors.length === 0, errors);
          await context.close();
          continue;
        }
        const facts = await page.evaluate(pageFacts);
        const label = `${name} ${key}`;
        report(`${label}: no horizontal scroll`, facts.overflow <= 1, facts.overflow);
        report(`${label}: the page content is not wider than the screen (nothing clipped)`, facts.mainOverflow <= 1 && facts.bodyOverflow <= 1, [facts.mainOverflow, facts.bodyOverflow]);
        const small = await page.evaluate(smallTargets);
        report(`${label}: targets >= 44px`, small.length === 0, small);
        // Уроки волны 2A: пустая полоса под страницей (`sr-only` без позиционированного предка), шапка карточки, режущая короткое действие,
        // и таблица, которую режет край карточки или окна.
        const band = await page.evaluate(blankBandBelowRoot, "#root");
        report(`${label}: no blank band below the page`, band.ok, band);
        const wrapped = await page.evaluate(headerWrapViolations);
        report(`${label}: card headers keep short actions beside the title`, wrapped.length === 0, wrapped);
        const clipped = await page.evaluate(clippedTables);
        report(`${label}: no table is clipped by its card or the screen`, clipped.length === 0, clipped);
        if (LITE.has(key)) {
          report(`${label}: console clean`, errors.length === 0, errors);
          await context.close();
          continue;
        }
        const axe = await new AxeBuilder({ page }).include("main").exclude("iframe").analyze();
        report(`${label}: axe`, axe.violations.length === 0, axe.violations.map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`));
        report(`${label}: one visible h1`, facts.h1.length === 1, facts.h1);
        report(`${label}: at most one red button`, facts.reds.length <= 1, facts.reds);
        if (facts.hasHeaderRule && facts.h1.length > 0) report(`${label}: header matches shell padding`, facts.paddingTop === facts.expected, [facts.paddingTop, facts.expected]);
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
