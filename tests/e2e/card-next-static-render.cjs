"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Новый вид»: карточка лида (`/v3/profile?id=…`) и дела студента (`/v3/profile?case=…`) — НАСТОЯЩАЯ сборка
 * страницы (`caseWorkParts`/`leadWorkParts` → `caseNextParts`/`leadNextParts`, `ProfileNextShell`, `Profile` с
 * `nextUi`, `AppShell` с включённым переключателем) на СИНТЕТИЧЕСКИХ данных тех же сценариев, что у прежнего вида
 * (`case-static-render.cjs`, `numbers-static-render.cjs`): имена и числа выдуманы для проверки вёрстки. Живой
 * Supabase и права не проверяются; чтений у страницы здесь нет.
 *
 *   node tests/e2e/card-next-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — разметка рамки страницы и профиля без оболочки
 *       (для tests/ui-next-card.test.mjs).
 *   node tests/e2e/card-next-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844 (во весь рост) и проверки (JSON-строки, при
 *       нарушении код 1): нет горизонтальной прокрутки, один `h1` с именем, нажимаемые кнопки ≥ 44 px, axe без
 *       нарушений на странице; в клиентской сборке — «Ещё N» ленты открывает панель внутри корня staff CRM с
 *       непрозрачной подложкой, Esc закрывает, фокус возвращается на кнопку. По умолчанию outDir —
 *       .impeccable/review (не коммитится).
 */

const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { lazySettled } = require("./lazy-settled.cjs");

// Модули-сценарии ставят require-hook для .ts/.tsx и подмену `@/`; они же отдают синтетику дела и лида.
const cases = require("./case-static-render.cjs");
const leads = require("./numbers-static-render.cjs");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const ROOT = cases.ROOT;
const { ORG, uuid } = cases;
const src = (path) => require(join(ROOT, "src", path));

// Дело «admin» с настоящей панелью «Обращения студента» (в сценариях прежнего вида её чтение пусто): одно ждёт ответа, одно закрыто.
const CASE_SCENARIOS = ["admin", "admin-help", "curator-accept", "needs-curator", "closed-outcome", "assign-only", "direct-case", "unread", "fresh"];
const HELP_PAGE = {
  caseId: cases.CASE_ID, nextCursor: null,
  items: [
    { id: "a1", subject: "Не загружается скан паспорта", body: "Синтетическое обращение для проверки вёрстки.", answer: null, status: "open", version: "1", createdAt: "2026-09-24T09:00:00.000Z", answeredAt: null },
    { id: "a2", subject: "Вопрос про сроки", body: "Синтетическое обращение.", answer: "Синтетический ответ.", status: "answered", version: "2", createdAt: "2026-09-20T09:00:00.000Z", answeredAt: "2026-09-21T09:00:00.000Z" },
  ],
};
// Лид с длинной лентой: больше пяти строк — «Ещё N» панелью.
const NOTE_TEXTS = ["Созвонились: семья выбирает между двумя странами.", "Отправили список программ на почту.", "Родители просят перезвонить после работы.",
  "Уточнили бюджет: до 8 000 USD в год.", "Назначили консультацию на среду.", "Пришла заявка с сайта, перезвонить вечером."];
leads.E4_LEADS["many"] = { ...leads.E4_LEADS.potential,
  notes: NOTE_TEXTS.map((body, index) => ({ body, authorDisplayName: "Санжар Эскизов", createdAt: `2026-09-${String(24 - index).padStart(2, "0")}T09:40:00.000Z` })) };
const LEAD_SCENARIOS = [["early", {}], ["potential", {}], ["handed", {}], ["many", {}], ["early", { calls: { status: "unavailable" } }], ["early", { next: null, due: null }],
  ["early", { dial: { status: "ready", mapped: true } }]];
const leadKey = ([name, extra]) => `lead-${name}${extra.calls ? "-calls-unavailable" : extra.next === null ? "-no-step" : extra.dial ? "-dial" : ""}`;

const EMPTY_IDS = Object.fromEntries(["contract", "firstPayment", "override", "handoff", "platformAccess", "saleConditions", "prepareLeadCabinet", "wishesCard", "educationCard", "conditionsCard"].map((key) => [key, ""]));

/** Рамка страницы и профиль — как в `page.tsx` для карточки в «Новом виде». */
function pageBody({ title, backHref, backLabel, next, profile, draft, sales, actor, notes, hrefFor, requestIds = EMPTY_IDS }) {
  const { Profile } = src("components/v3/profile/Profile.tsx");
  const { ProfileNextShell } = src("components/v3/profile/next/ProfileNextShell.tsx");
  const { Icon } = src("components/icons.tsx");
  const back = createElement("a", { href: backHref, className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    createElement(Icon, { name: "arrow-left", size: 16 }), backLabel);
  const profileElement = createElement(Profile, {
    profile, draft, sales, actor, organizationId: ORG, studentPortalCurators: [], studentPortalCuratorsAvailable: true, requestIds,
    noteRequestId: uuid("12121212", 15), notes, notesOlderHref: null, notesLatestHref: null, tab: "overview", hrefFor,
    caseHeader: next.header, caseOverview: next.overview, nextUi: true,
  });
  return createElement(ProfileNextShell, { title, actions: next.actions, back }, createElement("div", { className: "space-y-4" }, profileElement));
}

/** Тот же профиль в прежнем виде (`PartShell` + `Profile` без `nextUi`) — снимок «до» рядом со снимком «после». */
function legacyBody({ title, backHref, backLabel, parts, profile, draft, sales, actor, notes, hrefFor, requestIds = EMPTY_IDS }) {
  const { Profile } = src("components/v3/profile/Profile.tsx");
  const { PartShell } = src("components/v3/PartShell.tsx");
  const { Icon } = src("components/icons.tsx");
  const back = createElement("a", { href: backHref, className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    createElement(Icon, { name: "arrow-left", size: 16 }), backLabel);
  const profileElement = createElement(Profile, {
    profile, draft, sales, actor, organizationId: ORG, studentPortalCurators: [], studentPortalCuratorsAvailable: true, requestIds,
    noteRequestId: uuid("12121212", 15), notes, notesOlderHref: null, notesLatestHref: null, tab: "overview", hrefFor,
    caseHeader: parts.header, caseOverview: parts.overview,
  });
  return createElement(PartShell, { title, count: null, dense: true, back, action: parts.actions }, createElement("div", { className: "space-y-6" }, profileElement));
}

function caseScenario(name) {
  const withHelp = name === "admin-help";
  const { item, parts, hrefFor } = cases.buildParts(withHelp ? "admin" : name);
  const { caseNextParts } = src("components/v3/profile/next/CaseNext.tsx");
  if (withHelp) {
    // Настоящая страница подгружает карточку лениво (`CaseHelpCard`); статический рендер берёт её саму.
    const { CaseHelpCardImpl } = src("components/v3/profile/next/CaseHelpCardImpl.tsx");
    parts.next = { ...parts.next, overview: { ...parts.next.overview, help: createElement(CaseHelpCardImpl, { initialPage: HELP_PAGE }) } };
  }
  const next = caseNextParts(parts.next, parts.actions);
  return { name: `case-${name}`, actor: item.actor, pathname: "/v3/profile", search: `case=${cases.CASE_ID}&tab=overview`, title: cases.NAME,
    body: pageBody({ title: cases.NAME, backHref: cases.RETURN_TO, backLabel: "Студенты", next, profile: item.profile, draft: item.draft,
      sales: item.sales, actor: item.actor, notes: item.notes ?? cases.NOTES, hrefFor }),
    before: () => legacyBody({ title: cases.NAME, backHref: cases.RETURN_TO, backLabel: "Студенты", parts, profile: item.profile, draft: item.draft,
      sales: item.sales, actor: item.actor, notes: item.notes ?? cases.NOTES, hrefFor }) };
}

function leadScenario([name, extra]) {
  const built = leads.leadBuild(name, extra);
  const { leadNextParts } = src("components/v3/profile/next/LeadNext.tsx");
  const next = leadNextParts(built.parts.next);
  return { name: leadKey([name, extra]), actor: leads.ADMIN, pathname: "/v3/profile", search: `id=${leads.LEAD_ID}&tab=overview`, title: built.profile.person,
    body: pageBody({ title: built.profile.person, backHref: "/v3/pipeline", backLabel: "Воронка продаж", next, profile: built.profile, draft: built.draft,
      sales: built.sales, actor: leads.ADMIN, notes: built.notes, hrefFor: built.hrefFor, requestIds: built.requestIds }),
    before: () => legacyBody({ title: built.profile.person, backHref: "/v3/pipeline", backLabel: "Воронка продаж", parts: built.parts, profile: built.profile, draft: built.draft,
      sales: built.sales, actor: leads.ADMIN, notes: built.notes, hrefFor: built.hrefFor, requestIds: built.requestIds }) };
}

const BEFORE = ["case-admin", "case-curator-accept", "lead-potential", "lead-many"];
const scenarios = () => [...CASE_SCENARIOS.map(caseScenario), ...LEAD_SCENARIOS.map((entry) => leadScenario(entry))];
const inContexts = (node, pathname, search) => leads.withContexts(node, pathname, search);

function worldPage(scenario, before = false) {
  const { AppShell } = src("components/v3/AppShell.tsx");
  // «До»: тот же корень без `data-ui` и без переключателя — как у сотрудника и у администратора с выключенным видом.
  if (before) return createElement("div", { className: "v3-world", "data-surface": "staff" },
    createElement(AppShell, { actor: scenario.actor, initialNotifications: null }, scenario.before()));
  return createElement("div", { className: "v3-world", "data-surface": "staff", "data-ui": "next" },
    createElement(AppShell, { actor: scenario.actor, initialNotifications: null, nextUi: { enabled: true } }, scenario.body));
}

// --- клиентская сборка «Ещё N» ленты -------------------------------------------------------------------
const OVERFLOW_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { FeedCard } = require("@/components/v3/profile/next/FeedCard");
const { FeedNote, FeedEvent } = require("@/components/v3/profile/FeedRow");
const h = React.createElement;
const rows = Array.from({ length: 8 }, (_, index) => index % 2 === 0
  ? h(FeedNote, { key: index, body: "Синтетическая заметка " + (index + 1), author: "Менеджер Синтетический", at: "2026-09-2" + index + "T09:00:00.000Z", label: "2" + index + ".09" })
  : h(FeedEvent, { key: index, text: "Синтетическое событие " + (index + 1), at: "2026-09-2" + index + "T09:00:00.000Z", label: "2" + index + ".09", href: "#case-facts" }));
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {} };
createRoot(document.getElementById("root")).render(
  h(AppRouterContext.Provider, { value: router },
    h("div", { className: "v3-world", "data-surface": "staff", "data-ui": "next" },
      h("main", { className: "mx-auto max-w-[760px] p-6" }, h("section", { id: "case-facts" }, "Сведения (цель ссылок в ленте)"), h("div", { style: { height: "1400px" } }),
        h(FeedCard, { testId: "feed", listTestId: "feed-items", rows, empty: "Пусто" }), h("div", { style: { height: "600px" } })))));
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "true"; }));
`;

const LINK_SHIM = `
const React = require("react");
function Link(props) {
  const rest = {};
  for (const [key, value] of Object.entries(props)) if (!["prefetch", "scroll", "replace", "shallow", "passHref", "legacyBehavior", "onNavigate"].includes(key)) rest[key] = value;
  return React.createElement("a", rest);
}
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
`;

async function buildOverflowBundle(outFile) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "card-next-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
    },
  };
  await esbuild.build({
    stdin: { contents: OVERFLOW_ENTRY, resolveDir: ROOT, sourcefile: "card-next-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } }; var __dirname = \"/\";" }, plugins: [plugin], logLevel: "error",
  });
}

const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  d1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const css = await cases.compileCss();
  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  let failed = false;
  const report = (check, ok, detail) => {
    if (!ok) failed = true;
    console.log(JSON.stringify({ check, ok, detail }));
  };

  try {
    for (const scenario of scenarios()) {
      const htmlPath = join(outDir, `card-next-${scenario.name}.html`);
      cases.writeHtml(htmlPath, scenario.name, css, renderToStaticMarkup(inContexts(worldPage(scenario), scenario.pathname, scenario.search)));
      for (const [key, options] of Object.entries(VIEWPORTS)) {
        const context = await browser.newContext({ ...options, reducedMotion: "reduce" });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await cases.settle(page);
        await page.addStyleTag({ content: cases.STATIC_NAV });
        await page.screenshot({ path: join(outDir, `card-next-${scenario.name}-${key}.png`), fullPage: true });
        const label = `${scenario.name} @${key}`;
        report(`${label}: no browser errors`, errors.length === 0, errors);
        // В режиме телефона Chrome расширяет окно под содержимое: ширина считается от номинальной, а не от `clientWidth`.
        await page.evaluate((width) => { window.__nominalWidth = width; }, options.viewport.width);
        const metrics = await page.evaluate(() => {
          const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden" && element.checkVisibility(); };
          const main = document.querySelector("main");
          return {
            overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.__nominalWidth,
            h1: [...document.querySelectorAll("h1")].map((element) => element.textContent.trim()),
            // Кнопки и раскрытия виджетов — 44 px; значок «?» и ссылки в строках ленты (24 px, WCAG 2.5.8) — исключения.
            small: [...main.querySelectorAll("button, summary, input:not([type=hidden]):not([type=checkbox]), select")]
              .filter((element) => visible(element) && !element.matches("[aria-label^=Пояснение]"))
              .map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 30), h: Math.round(element.getBoundingClientRect().height) }))
              .filter((box) => box.h < 44),
            cards: document.querySelectorAll("[data-slot=card]").length,
            nestedCards: [...document.querySelectorAll("[data-slot=card] [data-slot=card]")].length,
            tabs: [...document.querySelectorAll('nav[aria-label="Разделы профиля"] a')].map((element) => element.textContent.trim()),
            summary: Boolean(document.querySelector("[data-testid=v3-case-summary], [data-testid=v3-lead-summary]")),
            // Ряд вкладок профиля принимает фокус сам: на него возвращается фокус после ответа на передачу.
            tabNav: (() => {
              const nav = document.querySelector('nav[aria-label="Разделы профиля"]');
              if (!nav) return null;
              nav.focus();
              return { tabIndex: nav.getAttribute("tabindex"), strip: nav.hasAttribute("data-tab-strip"), takesFocus: document.activeElement === nav };
            })(),
            // «Передача» в боковой карточке: полоса в одну колонку, ячейки не налезают друг на друга и не выходят за себя.
            handoff: (() => {
              const strip = document.querySelector("[data-testid=v3-lead-handoff] [data-testid=v3-handoff-strip]");
              if (!strip) return null;
              const items = [...strip.querySelectorAll("[data-handoff-item]")];
              const boxes = items.map((element) => element.getBoundingClientRect());
              const overlap = boxes.some((a, index) => boxes.slice(index + 1).some((b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
              return { columns: getComputedStyle(strip).gridTemplateColumns.split(" ").length, overlap, spill: items.filter((element) => element.scrollWidth > element.clientWidth + 1).length };
            })(),
            // Значения сводки стоят на одной линии с соседними в своей строке (44 px цели не сдвигают текст).
            factSpread: (() => {
              const summary = document.querySelector("[data-testid=v3-case-summary], [data-testid=v3-lead-summary]");
              const textTop = (element) => {
                const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                  if (!node.textContent.trim()) continue;
                  const range = document.createRange();
                  range.selectNodeContents(node);
                  return range.getBoundingClientRect().top;
                }
                return null;
              };
              const rows = new Map();
              for (const dd of summary?.querySelectorAll("[data-slot=key-facts] dd") ?? []) {
                const top = textTop(dd);
                if (top === null) continue;
                const row = Math.round(dd.previousElementSibling.getBoundingClientRect().top);
                rows.set(row, [...(rows.get(row) ?? []), top]);
              }
              return Math.max(0, ...[...rows.values()].map((tops) => Math.max(...tops) - Math.min(...tops)));
            })(),
            // Шапка дела в сводке без своих линий поперёк (вторая линия рядом с линией карточки).
            headerRules: (() => {
              const header = document.querySelector("[data-testid=v3-case-header]");
              if (!header) return null;
              const width = header.getBoundingClientRect().width;
              return [...header.querySelectorAll("*")].filter((element) => {
                const style = getComputedStyle(element);
                return (style.borderBottomWidth !== "0px" || style.borderTopWidth !== "0px") && element.getBoundingClientRect().width >= width * 0.9;
              }).length;
            })(),
            // «Обращения студента» - карточка с заголовком того же размера, что у соседних («Задачи»).
            helpTitle: (() => {
              const card = document.querySelector("[data-testid=v3-case-help], [data-testid=v3-case-help-forbidden]");
              if (!card) return null;
              const title = card.querySelector("h2");
              const sibling = document.querySelector("[data-testid=v3-case-tasks-part] h2");
              return { text: title?.textContent.trim().slice(0, 20), size: title && getComputedStyle(title).fontSize, sibling: sibling && getComputedStyle(sibling).fontSize };
            })(),
          };
        });
        report(`${label}: no horizontal scroll`, metrics.overflow <= 0, metrics.overflow);
        report(`${label}: one h1 with the name`, metrics.h1.length === 1 && metrics.h1[0] === scenario.title, metrics.h1);
        report(`${label}: buttons >= 44px`, metrics.small.length === 0, metrics.small);
        report(`${label}: summary card, widgets, no nested cards`, metrics.summary && metrics.cards >= 4 && metrics.nestedCards === 0, { cards: metrics.cards, nested: metrics.nestedCards });
        report(`${label}: tab row is links`, metrics.tabs.length >= 2 && metrics.tabs[0] === "Обзор", metrics.tabs);
        if (metrics.tabNav) report(`${label}: profile tabs row is focusable (tabindex 0, data-tab-strip, takes focus)`, metrics.tabNav.tabIndex === "0" && metrics.tabNav.strip && metrics.tabNav.takesFocus, metrics.tabNav);
        if (key === "d1440" && metrics.tabs.length >= 2) {
          await page.locator('nav[aria-label="Разделы профиля"] a').first().focus();
          await page.keyboard.press("Tab");
          const ring = await page.evaluate(() => ({ offset: getComputedStyle(document.activeElement).outlineOffset, visible: document.activeElement.matches(":focus-visible") }));
          report(`${label}: tab focus ring is drawn inside the tab`, ring.visible && ring.offset === "-2px", ring);
        }
        if (metrics.handoff) report(`${label}: handoff strip is one column, cells do not overlap or spill`, metrics.handoff.columns === 1 && !metrics.handoff.overlap && metrics.handoff.spill === 0, metrics.handoff);
        report(`${label}: summary values share one text line (spread <= 3px)`, metrics.factSpread <= 3, Math.round(metrics.factSpread * 10) / 10);
        if (metrics.headerRules !== null) report(`${label}: summary header has no rule of its own`, metrics.headerRules === 0, metrics.headerRules);
        if (metrics.helpTitle) report(`${label}: student requests card has a title as large as its siblings`, metrics.helpTitle.text.startsWith("Обращения студента") && metrics.helpTitle.size === metrics.helpTitle.sibling, metrics.helpTitle);
        if (key !== "d1280") {
          const axe = await new AxeBuilder({ page }).include("main").analyze();
          report(`${label}: axe (page)`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
        }
        await context.close();
      }
    }

    // «До»: прежний вид тех же сценариев — для сравнения снимков.
    for (const scenario of scenarios().filter((entry) => BEFORE.includes(entry.name))) {
      const htmlPath = join(outDir, `card-before-${scenario.name}.html`);
      cases.writeHtml(htmlPath, scenario.name, css, renderToStaticMarkup(inContexts(worldPage(scenario, true), scenario.pathname, scenario.search)));
      for (const key of ["d1440", "m390"]) {
        const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
        const page = await context.newPage();
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await cases.settle(page);
        await page.addStyleTag({ content: cases.STATIC_NAV });
        await page.screenshot({ path: join(outDir, `card-before-${scenario.name}-${key}.png`), fullPage: true });
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        report(`before ${scenario.name} @${key}: legacy page rendered`, height > 500, { height });
        await context.close();
      }
    }

    // Клиентская сборка «Ещё N»: панель, фокус, Esc.
    await buildOverflowBundle(join(outDir, "card-next-bundle.js"));
    const bundlePath = join(outDir, "card-next-overflow.html");
    writeFileSync(bundlePath, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Лента (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div id="root"></div><script src="card-next-bundle.js"></script></body></html>`);
    for (const key of ["d1280", "m390"]) {
      const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(pathToFileURL(bundlePath).href, { waitUntil: "load" });
      await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
      await lazySettled(page);
      const shown = await page.locator("[data-testid=feed-items] > li").count();
      const trigger = page.getByTestId("v3-feed-overflow");
      report(`overflow @${key}: five rows on the page, button says how many are left`, shown === 5 && (await trigger.textContent()) === "Ещё 3", { shown });
      await trigger.click();
      await page.getByRole("dialog").waitFor();
      const sheet = await page.evaluate(() => {
        const element = document.querySelector("[data-slot=sheet-content]");
        const background = getComputedStyle(element).backgroundColor;
        return { insideWorld: Boolean(element.closest('.v3-world[data-ui="next"]')), opaque: !/rgba\(0, 0, 0, 0\)|transparent/u.test(background),
          rows: element.querySelectorAll("[data-testid=v3-feed-overflow-items] > li").length, focusInside: Boolean(document.activeElement?.closest("[role=dialog]")) };
      });
      report(`overflow @${key}: panel inside the staff root, opaque, three rows, focus inside`, sheet.insideWorld && sheet.opaque && sheet.rows === 3 && sheet.focusInside, sheet);
      await page.screenshot({ path: join(outDir, `card-next-overflow-${key}.png`) });
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.waitForTimeout(80); // Radix возвращает фокус отложенным вызовом уже после снятия панели
      report(`overflow @${key}: Esc closes, focus returns to the button`, await trigger.evaluate((element) => element === document.activeElement), null);
      // Ссылка строки на место этой же страницы закрывает панель, и страница остаётся у цели (фокус не тянет её назад к кнопке).
      await trigger.click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("dialog").locator('a[href="#case-facts"]').first().click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.waitForTimeout(150);
      const jump = await page.evaluate(() => ({
        hash: location.hash, dialogs: document.querySelectorAll("[role=dialog]").length, top: Math.round(document.getElementById("case-facts").getBoundingClientRect().top),
        hidden: Boolean(document.querySelector("main")?.closest("[aria-hidden=true],[inert]")),
      }));
      report(`overflow @${key}: a same-page link closes the panel and the page stays at its target`, jump.hash === "#case-facts" && jump.dialogs === 0 && !jump.hidden && jump.top >= -2 && jump.top < 200, jump);
      report(`overflow @${key}: no browser errors`, errors.length === 0, errors);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (failed) process.exit(1);
}

// «Сведения» лида с тремя исходами чтения «Интересует» (само чтение — отдельный серверный компонент, здесь его результат).
function interestWidgets() {
  const built = leads.leadBuild("potential", {});
  const { LeadSideFacts } = src("components/v3/profile/next/LeadSideFacts.tsx");
  const source = { ...built.parts.next, facts: { ...built.parts.next.facts, hasInterest: true } };
  return [["value", { status: "value", direction: "Малайзия" }], ["error", { status: "error" }], ["none", { status: "none" }]].map(([key, interest]) => ({
    name: `widget-interest-${key}`,
    html: renderToStaticMarkup(inContexts(createElement(LeadSideFacts, { source, interest }), "/v3/profile", `id=${leads.LEAD_ID}`)),
  }));
}

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify([
    ...scenarios().map((scenario) => ({ name: scenario.name, html: renderToStaticMarkup(inContexts(scenario.body, scenario.pathname, scenario.search)) })),
    ...interestWidgets(),
  ]));
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: card-next-static-render.cjs --json | --screenshots [outDir]");
  process.exit(2);
}
