"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Проверки в Chromium для `card-tabs-next-static-render.cjs --screenshots`: снимки нового вида (1440, 1280, 390) и прежнего («до»),
 * метрики каждой страницы и свои проверки каждой вкладки. Результат — JSON-строки `{ check, ok, detail }`, при нарушении код 1.
 */

const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  d1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};
// Только боковая прокрутка (без снимков): узкие телефоны.
// 768: рядом боковое меню, и карточка уже, чем на телефоне (заголовок с действиями в шапке).
const NARROW = { w768: { viewport: { width: 768, height: 900 }, deviceScaleFactor: 1 }, w360: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }, w320: { viewport: { width: 320, height: 700 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true } };

/** Замеры страницы: боковая прокрутка, заголовок, кнопки ниже 44 px, карточки, вкладки и свои числа вкладки. */
function measure() {
  const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden" && element.checkVisibility(); };
  const main = document.querySelector("main");
  const count = (selector) => main.querySelectorAll(selector).length;
  const text = main.innerText;
  return {
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.__nominalWidth,
    h1: [...document.querySelectorAll("h1")].map((element) => element.textContent.trim()),
    small: [...main.querySelectorAll("button, summary, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select")]
      .filter((element) => visible(element) && !element.matches("[aria-label^=Пояснение]"))
      .map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 30), h: Math.round(element.getBoundingClientRect().height) }))
      .filter((box) => box.h < 44),
    cards: count("[data-slot=card]"),
    // Шапки карточек: заголовок не шире своей клетки и не лежит под «?» или действиями (ошибка 360/320: текст поверх кнопки).
    headers: [...main.querySelectorAll("[data-slot=card-header]")].filter(visible).map((header) => {
      const title = header.querySelector("[data-slot=card-title]");
      if (!title) return null;
      const range = document.createRange();
      range.selectNodeContents(title);
      const lines = [...range.getClientRects()].filter((box) => box.width > 0 && box.height > 0);
      const others = [...header.querySelectorAll("[data-slot=card-action], [aria-label^=Пояснение]")].filter(visible);
      const hit = (box, other) => Math.min(box.right, other.right) - Math.max(box.left, other.left) > 2 && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 2;
      return { title: title.textContent.trim().slice(0, 30), clipped: title.scrollWidth > title.clientWidth + 1, width: Math.round(title.getBoundingClientRect().width),
        overlaps: others.filter((other) => lines.some((box) => hit(box, other.getBoundingClientRect()))).map((other) => other.getAttribute("data-slot") ?? other.getAttribute("aria-label")) };
    }).filter(Boolean),
    nested: [...main.querySelectorAll("[data-slot=card] [data-slot=card]")].length,
    tabs: [...document.querySelectorAll('nav[aria-label="Разделы профиля"] a')].map((element) => ({ text: element.textContent.trim(), current: element.getAttribute("aria-current") === "page" })),
    helpTips: count("[aria-label^=Пояснение]"),
    headings: [...main.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((element) => Number(element.tagName[1])),
    stopReason: (() => {
      const element = main.querySelector("[data-testid=v3-case-money-stop-reason], [data-testid=v3-case-money-stop] span.break-words");
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { width: Math.round(box.width), lines: Math.round(box.height / parseFloat(getComputedStyle(element).lineHeight)) };
    })(),
    // Карточки-раскрытия «Документов» и фильтр в «Чек-листе»: лишних линий и перекоса отступов нет.
    docsFrame: (() => {
      const rule = main.querySelector("[data-testid=v3-documents-checklist] nav ul");
      const gaps = ["document-recognition", "v3-removed-document-history"].map((id) => {
        const inner = main.querySelector("[data-testid=" + id + "]");
        const card = inner?.parentElement;
        const control = inner?.querySelector("button, summary");
        if (!card || !control) return null;
        const outer = card.getBoundingClientRect();
        const box = control.getBoundingClientRect();
        return { id, above: Math.round(box.top - outer.top), below: Math.round(outer.bottom - box.bottom) };
      }).filter(Boolean);
      return { filterRule: rule ? getComputedStyle(rule).borderBottomWidth : null, gaps };
    })(),
    gateFields: [...main.querySelectorAll("[data-testid=v3-lead-gate] input:not([type=hidden]), [data-testid=v3-lead-gate] textarea, [data-testid=v3-lead-gate] select")]
      .filter(visible).map((element) => Math.round(element.getBoundingClientRect().width)),
    exportTitle: (() => {
      const own = main.querySelector('[aria-label="Файлы анкеты"] > h3');
      const other = main.querySelector("[data-testid=v3-anketa-answers] [data-slot=card-title]");
      if (!own || !other) return null;
      const size = (element) => { const style = getComputedStyle(element); return style.fontSize + "/" + style.fontWeight + "/" + style.lineHeight; };
      return { own: size(own), other: size(other) };
    })(),
    facts: [...main.querySelectorAll("[data-slot=key-facts]")].map((block) => block.querySelectorAll("dt").length),
    text,
    docs: { checklist: count("[data-testid=v3-documents-checklist]"), groups: count("[data-testid=v3-documents-group]"), progress: count("[data-testid=v3-documents-checklist] .v3-progress"), filter: count('nav[aria-label="Документы по состоянию"]'), history: count("[data-testid=v3-removed-document-history]") },
    money: { summaryFacts: [...main.querySelectorAll("[data-testid=v3-case-agreement] [data-slot=key-facts] dt")].map((element) => element.textContent.trim()),
      menu: count("[data-testid=v3-case-money-more]"), tranches: count("[data-testid=v3-case-agreement-tranches]"), payments: count("[data-testid=v3-case-agreement-payment]"),
      stop: count("[data-testid=v3-case-money-stop]"), panels: count("[data-money-panel]"), legacyHeader: count("[data-case-money] > header") },
    route: { rows: count("[data-testid=v3-profile-application]"), card: count("[data-testid=v3-profile-admissions-workspace][data-slot=card]"), packets: count("details#partner-packets") },
    history: { events: count("[data-testid=v3-history-list] > li"), overflow: count("[data-testid=v3-history-overflow]"), forbidden: count("[data-testid=v3-history-forbidden]") },
    anketa: { answers: count("[data-testid=v3-anketa-answers]"), fields: count("#student-profile-fields-title"), other: count("[data-testid=v3-anketa-other-open], [data-testid=v3-anketa-other-card]") },
  };
}

function expectations(name, m, key) {
  const wide = key !== "m390";
  const out = [];
  const add = (label, ok, detail) => out.push([label, ok, detail]);
  if (name.startsWith("docs-")) {
    add("checklist card and one card per shown group", m.docs.checklist === 1 && m.docs.groups === ({ "docs-empty": 0, "docs-review": 1 }[name] ?? 2), m.docs);
    // Формат загрузки - за «?» рядом с названием карточки; он нужен, только пока есть что загружать (фильтр «На проверке» таких строк не показывает).
    add("upload format is behind the help tip, not on the screen", !/Загрузка: PDF/u.test(m.text) && (["docs-preview", "docs-review", "docs-empty"].includes(name) || m.helpTips >= 1), { helpTips: m.helpTips });
    if (name !== "docs-empty") add("progress and state filter are on the checklist card", m.docs.progress === 1 && m.docs.filter === 1, m.docs);
    if (name === "docs-all") add("removed-items history is a card-styled disclosure", m.docs.history === 1, m.docs);
    if (name === "docs-preview") add("preview role says documents are read-only", /только для просмотра/u.test(m.text), null);
  }
  if (name.startsWith("money-")) {
    add("summary card: four facts, the menu in its header, no legacy header", JSON.stringify(m.money.summaryFacts) === JSON.stringify(["Стоимость", "Договор", "Оплачено", "Остаток"]) && m.money.menu === 1 && m.money.legacyHeader === 0, m.money);
    add("tranches and payments are sibling cards", m.money.tranches === 1 && m.money.payments === 1, m.money);
    add("closed panels exist and are hidden (opened from the menu)", m.money.panels >= 4, m.money.panels);
    if (name === "money-cross") add("financial stop stays on screen with its reason; currencies are not converted", m.money.stop === 1 && /стоп активен/u.test(m.text) && /без пересчёта валют/u.test(m.text), null);
    if (name === "money-same") add("previous contract versions are a sheet button", /Прежние версии · 1/u.test(m.text) && !/Услуги EVO и другие расходы/u.test(m.text), null);
  }
  if (name.startsWith("route-")) {
    add("universities are one card with the add buttons in its header", name === "route-empty" ? m.route.rows === 0 : m.route.rows === 4, m.route);
    add("the manual-add lead-in is behind the help tip", !/Вуза нет в каталоге\?/u.test(m.text) && m.helpTips >= 1, null);
    if (name === "route-four") add("partner packets disclosure is a card", m.route.packets === 1, m.route);
  }
  if (name.startsWith("anketa-")) {
    if (name === "anketa-full") add("student answers as facts, field review card, other facts behind a button", m.anketa.answers === 1 && m.anketa.fields === 1 && m.anketa.other === 1 && /Отправлено/u.test(m.text), m.anketa);
    if (name === "anketa-simple") add("no profile fields: other facts as a card", m.anketa.fields === 0 && m.anketa.other === 1, m.anketa);
  }
  if (name.startsWith("history-")) {
    if (name === "history-long") add("ten events on the page, the rest behind «Ещё N»", m.history.events === 10 && m.history.overflow === 1 && /Ещё 2/u.test(m.text), m.history);
    if (name === "history-short") add("short journal: no overflow button", m.history.events === 4 && m.history.overflow === 0, m.history);
    if (name === "history-forbidden") add("no access to the journal is said in words", m.history.forbidden === 1 && m.history.events === 0, m.history);
  }
  if (name.startsWith("money-")) {
    // Заголовки листа не перескакивают уровень (включая закрытые панели): панель «⋯» - карточка рядом с «Транши» и «Оплаты и чеки».
    const jumps = m.headings.filter((level, index) => index > 0 && level - m.headings[index - 1] > 1);
    add("heading levels never jump (panels are sibling cards)", jumps.length === 0, m.headings);
  }
  if (name === "money-cross") add("stop reason is not squeezed (at most three lines)", m.stopReason !== null && m.stopReason.lines <= 3, m.stopReason);
  if (name === "docs-all") {
    add("checklist filter keeps no rule of its own above the card border", m.docsFrame.filterRule === "0px", m.docsFrame);
    add("recognition and removed-history cards pad their label evenly", m.docsFrame.gaps.length === 2 && m.docsFrame.gaps.every((gap) => Math.abs(gap.above - gap.below) <= 2), m.docsFrame.gaps);
  }
  if (name === "anketa-full") add("export card title has the card-title size of its neighbours", m.exportTitle !== null && m.exportTitle.own === m.exportTitle.other, m.exportTitle);
  if (name === "lead-money-gate") add("manual-confirmation card on the money tab", /Подтверждение вручную/u.test(m.text), null);
  if (name === "lead-money-gate") add("gate form fields stay at the legacy width cap (768 px)", m.gateFields.length >= 3 && Math.max(...m.gateFields) <= 768, m.gateFields);
  if (name === "lead-closed") add("closed lead: one card with the state, the reason and the reopen command", /Лид закрыт/u.test(m.text) && /Вернуть в работу/u.test(m.text), null);
  void wide;
  return out;
}

async function run({ all, worldPage, inContexts, fx, renderToStaticMarkup, lazySettled, argv, join, resolve, mkdirSync, pathToFileURL }) {
  const outIndex = argv.indexOf("--screenshots") + 1;
  const outDir = resolve(argv[outIndex] && !argv[outIndex].startsWith("--") ? argv[outIndex] : join(fx.ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const css = await fx.compileCss();
  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  let failed = false;
  const report = (check, ok, detail) => {
    if (!ok) failed = true;
    console.log(JSON.stringify({ check, ok, detail }));
  };
  try {
    for (const scenario of all()) {
      const pathname = "/v3/profile";
      const htmlPath = join(outDir, `tab-next-${scenario.name}.html`);
      fx.writeHtml(htmlPath, scenario.name, css, renderToStaticMarkup(inContexts(worldPage(scenario), pathname, scenario.search)));
      for (const [key, options] of Object.entries({ ...VIEWPORTS, ...NARROW })) {
        const context = await browser.newContext({ ...options, reducedMotion: "reduce" });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await fx.settle(page);
        await page.addStyleTag({ content: fx.STATIC_NAV });
        const label = `${scenario.name} @${key}`;
        report(`${label}: no browser errors`, errors.length === 0, errors);
        await page.evaluate((width) => { window.__nominalWidth = width; }, options.viewport.width);
        const metrics = await page.evaluate(measure);
        report(`${label}: no horizontal scroll`, metrics.overflow <= 0, metrics.overflow);
        report(`${label}: card titles fit their cell and sit clear of the «?» and the actions`, metrics.headers.every((header) => !header.clipped && header.overlaps.length === 0), metrics.headers.filter((header) => header.clipped || header.overlaps.length));
        if (key in NARROW) {
          // Узкие карточки: причина финансового стопа остаётся читаемой (у прежней строки на 320 - четыре строки).
          if (scenario.name === "money-cross") report(`${label}: stop reason is not squeezed (at most three lines)`, metrics.stopReason !== null && metrics.stopReason.lines <= 3, metrics.stopReason);
          await context.close();
          continue;
        }
        await page.screenshot({ path: join(outDir, `tab-next-${scenario.name}-${key}.png`), fullPage: true });
        report(`${label}: one h1 with the name`, metrics.h1.length === 1 && metrics.h1[0] === scenario.title, metrics.h1);
        report(`${label}: buttons >= 44px`, metrics.small.length === 0, metrics.small);
        report(`${label}: cards, none nested`, metrics.cards >= 1 && metrics.nested === 0, { cards: metrics.cards, nested: metrics.nested });
        if (metrics.tabs.length) report(`${label}: tab row marks the current tab`, metrics.tabs.filter((tab) => tab.current).length === 1, metrics.tabs);
        report(`${label}: key facts hold at most 4 data`, metrics.facts.every((count) => count <= 4) || scenario.name.startsWith("anketa-"), metrics.facts);
        for (const [text, ok, detail] of expectations(scenario.name, metrics, key)) report(`${label}: ${text}`, ok, detail);
        if (key !== "d1280") {
          const axe = await new AxeBuilder({ page }).include("main").analyze();
          report(`${label}: axe (page)`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
        }
        await context.close();
      }
    }
    // «До»: прежний вид тех же вкладок - для сравнения снимков.
    for (const scenario of all()) {
      const htmlPath = join(outDir, `tab-before-${scenario.name}.html`);
      fx.writeHtml(htmlPath, scenario.name, css, renderToStaticMarkup(inContexts(worldPage(scenario, true), "/v3/profile", scenario.search)));
      for (const key of ["d1440", "m390"]) {
        const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
        const page = await context.newPage();
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await fx.settle(page);
        await page.addStyleTag({ content: fx.STATIC_NAV });
        await page.screenshot({ path: join(outDir, `tab-before-${scenario.name}-${key}.png`), fullPage: true });
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        report(`before ${scenario.name} @${key}: legacy page rendered`, height > 500, { height });
        await context.close();
      }
    }
    // Клиентские куски: панель «Ещё N», «⋯» листа «Договор и оплата», «+ Документ».
    await require("./card-tabs-client.cjs").runClient({ browser, report, css, outDir, fx, join, pathToFileURL, lazySettled, VIEWPORTS });
  } finally {
    await browser.close();
  }
  if (failed) process.exit(1);
}

module.exports = { run };
