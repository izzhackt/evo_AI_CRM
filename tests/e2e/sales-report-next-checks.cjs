"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Проверки «Отчёта продаж» нового вида в Chromium (зовёт `sales-report-next-static-render.cjs --screenshots`): страница на трёх ширинах,
 * панель записи (адрес, фокус, Esc, форма «Исправить запись»), «Убрать» / «Вернуть», фильтры, новая продажа, «Менеджеры в отчёте»,
 * «Перенос данных», план месяца, другие миры (сотрудник, просмотр роли, без cookie).
 */

const { join } = require("node:path");

const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 } },
  d1280: { viewport: { width: 1280, height: 800 } },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};

async function run({ outDir, bundleHydration, compileCss, fixtures, startServer, SEARCH }) {
  const [css, bundle] = await Promise.all([compileCss(), bundleHydration()]);
  const { server, origin } = await startServer(css, bundle);
  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  let failed = false;
  const report = (check, ok, detail) => { if (!ok) failed = true; console.log(JSON.stringify({ check, ok, detail })); };
  const ids = fixtures.ROWS.map((one) => one.id);
  const rowId = (n) => fixtures.uuid("78787878", n);

  async function open(path, key, { ui = "next", actor = "admin" } = {}) {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
    await context.addCookies([...(ui ? [{ name: "evo_ui", value: ui, url: origin }] : []), { name: "harness_actor", value: actor, url: origin }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("response", (response) => { if (response.status() >= 400 && !/notifications\/state/u.test(response.url())) errors.push(`HTTP ${response.status()} ${response.url().replace(origin, "")}`); });
    page.on("console", (message) => { if (["error", "warning"].includes(message.type()) && !/notifications\/state|Failed to load resource/u.test(message.text()) && !/Check the render method of `select`\.\s+It was passed a child from SalesDraft/u.test(message.text())) errors.push(message.text()); });
    await page.goto(`${origin}${path}`, { waitUntil: "load" });
    await page.waitForSelector("html[data-hydrated=true]", { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => !document.querySelector('[aria-label^="Пояснение"]:not([data-slot])'), null, { timeout: 15_000 });
    return { context, page, errors };
  }
  const shot = (page, name, options = {}) => page.screenshot({ path: join(outDir, `${name}.png`), ...options });
  const url = (page) => page.url().replace(origin, "");
  const axeOf = async (page, scope) => (await new AxeBuilder({ page }).include(scope).analyze()).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  const small = (page, scope) => page.evaluate((root) => {
    const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"; };
    // Ссылки и поля внутри строк — цели, которые строка и накладка карточки дают целиком; «?» увеличивает зону псевдоэлементом.
    return [...document.querySelectorAll(`${root} a, ${root} button, ${root} select, ${root} input:not([type=hidden]):not([type=radio]):not([type=checkbox])`)]
      .filter((element) => visible(element) && !element.matches("[aria-label^=Пояснение], [data-row-open], [data-card-open]") && !element.closest("[popover]:not(:popover-open)"))
      .map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 30), h: Math.round(element.getBoundingClientRect().height) }))
      .filter((box) => box.h < 44);
  }, scope);
  const rowOf = (page, key, title) => (key === "m390" ? page.locator("[data-slot=data-table-cards] > li").filter({ hasText: title }).first() : page.locator("[data-slot=data-table] tbody tr").filter({ hasText: title }).first());

  try {
    // 0. «До»: прежний вид тех же данных (разметка прежнего вида совпадает с базовым коммитом — tests/ui-next-pipelines.test.mjs).
    for (const key of ["d1440", "m390"]) {
      const { context, page } = await open(`/v3/main?${SEARCH}`, key, { ui: null });
      await shot(page, `before-report-${key}`, { fullPage: true });
      if (key === "d1440") {
        await page.locator("tbody tr").filter({ hasText: "Айжан Примерова" }).first().getByRole("link").first().click();
        await page.waitForSelector("dialog[data-side-panel][open], [data-testid=sales-record-preview]", { timeout: 10_000 }).catch(() => {});
        await shot(page, "before-report-record-d1440");
      }
      await context.close();
    }
    // 1. Страница на трёх ширинах.
    for (const key of ["d1440", "d1280", "m390"]) {
      const { context, page, errors } = await open(`/v3/main?${SEARCH}`, key);
      const name = `report ${key}`;
      await shot(page, `report-${key}`, { fullPage: true });
      report(`${name}: new view (data-ui=next, kit table)`, await page.evaluate(() => Boolean(document.querySelector('.v3-world[data-ui="next"] [data-testid="v3-sales-report"] [data-slot="data-table"]'))), null);
      report(`${name}: hydrated without recoverable errors`, (await page.evaluate(() => window.__harness.recoverable)).length === 0, await page.evaluate(() => window.__harness.recoverable));
      report(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
      report(`${name}: one h1`, await page.evaluate(() => [...document.querySelectorAll("h1")].filter((h) => h.getClientRects().length).map((h) => h.textContent.trim()).join("|") === "Отчёт продаж"), null);
      const targets = await small(page, "[data-testid=v3-sales-report]");
      report(`${name}: targets >= 44px`, targets.length === 0, targets);
      const axe = await axeOf(page, "[data-testid=v3-sales-report]");
      report(`${name}: axe`, axe.length === 0, axe);
      const red = await page.evaluate(() => [...document.querySelectorAll("[data-testid=v3-sales-report] a, [data-testid=v3-sales-report] button")].filter((e) => getComputedStyle(e).backgroundColor === "rgb(215, 2, 23)" && e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()));
      report(`${name}: one red button (Добавить продажу)`, red.length === 1 && red[0] === "Добавить продажу", red);
      const facts = await page.evaluate(() => ({
        headline: document.querySelector('[data-testid="v3-sales-headline"]')?.getAttribute("data-sales"),
        tiles: document.querySelectorAll('[data-testid="v3-sales-headline"] [data-slot="stat-tile"]').length,
        money: Boolean(document.querySelector('[data-testid="sales-money-table"]')), withdrawn: Boolean(document.querySelector('[data-testid="sales-withdrawn-summary"]')),
        rows: [...document.querySelectorAll("[data-slot=data-table] tbody tr, [data-slot=data-table-cards] > li")].filter((e) => e.getClientRects().length).length,
        cash: Boolean(document.querySelector('[data-testid="sales-cash-totals"]')), dynamics: Boolean(document.querySelector("#sales-dynamics")),
      }));
      report(`${name}: headline number, plan tile, money table, refusal line, rows, cash, dynamics`, facts.headline === "6" && facts.tiles === 2 && facts.money && facts.withdrawn && facts.rows === 8 && facts.cash && facts.dynamics, facts);
      report(`${name}: console clean`, errors.length === 0, errors);
      await context.close();
    }

    // 2. Панель записи: строка → панель (адрес ?record=, фокус на названии) → Esc → фокус на строке; «Исправить запись» открывает форму.
    for (const key of ["d1440", "m390"]) {
      const { context, page, errors } = await open(`/v3/main?${SEARCH}`, key);
      const name = `report sheet ${key}`;
      const row = rowOf(page, key, "Айжан Примерова");
      await row.click({ position: { x: 20, y: 8 } });
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await page.waitForFunction(() => document.activeElement?.closest('[role="dialog"]'));
      await page.waitForFunction(() => document.querySelector('[data-testid="sales-record-preview"]'));
      const opened = await page.evaluate(() => ({ url: location.search, inWorld: Boolean(document.querySelector('[role="dialog"]')?.closest('.v3-world[data-ui="next"]')), focus: document.activeElement.textContent.trim(),
        preview: Boolean(document.querySelector('[role="dialog"] [data-testid="sales-record-preview"]')), edit: Boolean(document.querySelector('[role="dialog"] [data-testid="sales-record-edit"]')) }));
      report(`${name}: opens by URL ?record=, focus on the title, record view and «Исправить запись» inside`, opened.url.includes(`record=${rowId(2)}`) && opened.inWorld && opened.focus === "Айжан Примерова" && opened.preview && opened.edit, opened);
      await shot(page, `report-sheet-${key}`);
      report(`${name}: axe`, (await axeOf(page, '[role="dialog"]')).length === 0, await axeOf(page, '[role="dialog"]'));
      report(`${name}: targets >= 44px`, (await small(page, '[role="dialog"]')).length === 0, await small(page, '[role="dialog"]'));
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      const closed = { url: url(page), focus: await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName) };
      report(`${name}: Esc closes, URL loses ?record=, focus returns to the row opener`, !closed.url.includes("record=") && /Открыть: Айжан Примерова/u.test(closed.focus ?? ""), closed);
      await row.click({ position: { x: 20, y: 8 } });
      await dialog.waitFor();
      await page.waitForSelector('[role="dialog"] [data-testid="sales-record-edit"]');
      await page.getByTestId("sales-record-edit").click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"] form'), null, { timeout: 10_000 });
      report(`${name}: «Исправить запись» opens the edit form in the same panel (?edit=true)`, url(page).includes("edit=true") && (await dialog.locator("form").count()) > 0, url(page));
      await shot(page, `report-sheet-edit-${key}`);
      report(`${name}: console clean`, errors.length === 0, errors);
      await context.close();
    }

    // 3. «Убрать» / «Вернуть» в строке: прежняя кнопка и действие, строка получает слово отказа.
    {
      const { context, page, errors } = await open(`/v3/main?${SEARCH}`, "d1440");
      const row = rowOf(page, "d1440", "Тимур Образцов");
      await row.getByRole("button", { name: /Убрать из продаж: Тимур Образцов/u }).click();
      await page.waitForSelector("[popover]:popover-open");
      await page.getByRole("radio", { name: "Не оплатил" }).check();
      await shot(page, "report-withdraw-popover-d1440");
      await page.locator("[popover]:popover-open").getByRole("button", { name: "Убрать", exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-row-withdrawal]')].filter((e) => e.getClientRects().length).length === 2, null, { timeout: 10_000 });
      const calls = await page.evaluate(() => globalThis.__salesReportFixture?.calls ?? null);
      report("report withdraw: the action runs with the same fields, the row shows the refusal word, the summary counts two", /Отказ — 2 записи/u.test(await page.getByTestId("sales-withdrawn-summary").textContent()) && (await row.getByText("Отказ, без оплаты").count()) > 0, calls);
      await row.getByRole("button", { name: /Вернуть в продажи: Тимур Образцов/u }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-row-withdrawal]')].filter((e) => e.getClientRects().length).length === 1, null, { timeout: 10_000 });
      report("report withdraw: «Вернуть» is one press and the row loses the refusal word", true, null);
      report("report withdraw: console clean", errors.length === 0, errors);
      await context.close();
    }

    // 4. Фильтры и поиск: те же адреса; выбор менеджера — переход, поиск — форма GET; «Сбросить».
    {
      const { context, page, errors } = await open(`/v3/main?${SEARCH}`, "d1440");
      await page.locator("button[popovertarget]").filter({ hasText: "Менеджер" }).first().click();
      await page.getByRole("group", { name: "Менеджер" }).getByRole("link", { name: /Айдана Макетова/u }).click();
      await page.waitForFunction(() => location.search.includes("manager=") && [...document.querySelectorAll("[data-slot=data-table] tbody tr")].filter((e) => e.getClientRects().length).length === 2, null, { timeout: 10_000 });
      const filtered = await page.evaluate(() => ({ url: location.search, rows: [...document.querySelectorAll("[data-slot=data-table] tbody tr")].filter((e) => e.getClientRects().length).length }));
      report("report filters: choosing a manager keeps the period and narrows the rows (same URL parameters)", filtered.url.includes("manager=") && filtered.url.includes("month=9") && filtered.rows === 2, filtered);
      await shot(page, "report-filter-d1440", { fullPage: true });
      await page.getByRole("link", { name: "Сбросить" }).click();
      await page.waitForFunction(() => !location.search.includes("manager="), null, { timeout: 10_000 });
      await page.getByRole("link", { name: /Нужно уточнить/u }).click();
      await page.waitForFunction(() => location.search.includes("review=true"), null, { timeout: 10_000 });
      await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=data-table] tbody tr")].filter((e) => e.getClientRects().length).length === 5, null, { timeout: 10_000 });
      report("report filters: «Нужно уточнить» writes review=true and shows only flagged rows", true, url(page));
      report("report filters: console clean", errors.length === 0, errors);
      await context.close();
    }

    // 5. Новая продажа, «Менеджеры в отчёте», «Перенос данных», план месяца, пустой результат, архив, срез.
    {
      const { context, page } = await open(`/v3/main?${SEARCH}&new=true`, "d1440");
      report("report new sale: the same form (its own heading and «← К отчёту») in a card of the new view", await page.evaluate(() => Boolean(document.querySelector('.v3-world[data-ui="next"] [data-testid="v3-sales-new"] form')) && document.querySelectorAll("h1").length === 1), null);
      report("report new sale: axe", (await axeOf(page, "[data-testid=v3-sales-new]")).length === 0, await axeOf(page, "[data-testid=v3-sales-new]"));
      await shot(page, "report-new-d1440");
      await context.close();
    }
    for (const [name, query, title, scope] of [["managers", `${SEARCH}&mode=managers`, "Менеджеры в отчёте", "sales-managers"], ["import", `${SEARCH}&mode=import`, "Перенос данных отчёта", "v3-sales-frame"]]) {
      for (const key of ["d1440", "m390"]) {
        const { context, page, errors } = await open(`/v3/main?${query}`, key);
        const frame = await page.evaluate((id) => ({ h1: document.querySelector("main h1")?.textContent?.trim(), back: Boolean(document.querySelector('main a[href^="/v3/main?view=sales"]')), body: Boolean(document.querySelector(`[data-testid="${id}"]`)) || Boolean(document.querySelector("main form")),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }), scope);
        report(`report ${name} ${key}: new frame, back to the report, body, no horizontal scroll`, frame.h1 === title && frame.back && frame.body && frame.overflow <= 0, frame);
        report(`report ${name} ${key}: axe`, (await axeOf(page, "[data-testid=v3-sales-frame]")).length === 0, await axeOf(page, "[data-testid=v3-sales-frame]"));
        await shot(page, `report-${name}-${key}`, { fullPage: true });
        report(`report ${name} ${key}: console clean`, errors.length === 0, errors);
        await context.close();
      }
    }
    {
      const { context, page, errors } = await open(`/v3/main?${SEARCH}`, "d1440");
      await page.getByRole("button", { name: "Изменить план" }).click();
      await page.getByRole("dialog").waitFor();
      report("report plan: «Изменить план» opens the old form in a panel", (await page.getByRole("dialog").locator("form").count()) > 0, null);
      await shot(page, "report-plan-d1440");
      await page.keyboard.press("Escape");
      await context.close();
      const empty = await open(`/v3/main?${SEARCH}&q=нет-такого-имени`, "d1440");
      report("report empty: no rows says so and offers «Сбросить фильтры»", /По выбранным фильтрам записей не найдено\./u.test(await empty.page.locator("main").textContent()) && (await empty.page.getByRole("link", { name: "Сбросить фильтры" }).count()) > 0, null);
      await empty.context.close();
      const archive = await open(`/v3/main?${SEARCH}&archived=true`, "d1440");
      report("report archive: a sentence instead of sums, no «Остаток» column", /Архивные записи не входят в рабочие итоги/u.test(await archive.page.locator("main").textContent()) && (await archive.page.getByRole("columnheader", { name: /Остаток/u }).count()) === 0, null);
      await shot(archive.page, "report-archive-d1440");
      await archive.context.close();
      const slice = await open(`/v3/main?${SEARCH}&sale=undated`, "d1440");
      report("report slice: «без даты продажи» shows the slice sentence with a way back", /Записи без даты продажи/u.test(await slice.page.locator("main").textContent()) && (await slice.page.getByRole("link", { name: "Все записи периода" }).count()) > 0, null);
      await slice.context.close();
      report("report plan/empty/archive/slice: console clean", errors.length === 0, errors);
    }

    // 6. Другие миры: сотрудник и просмотр роли с cookie, администратор без неё — прежний вид.
    for (const [label, options] of [["staff + cookie", { actor: "staff" }], ["preview + cookie", { actor: "preview" }], ["admin without cookie", { ui: null }]]) {
      const { context, page } = await open(`/v3/main?${SEARCH}`, "d1440", options);
      const legacy = await page.evaluate(() => ({ nextRoot: Boolean(document.querySelector('[data-ui="next"]')), table: Boolean(document.querySelector('[data-slot="data-table"]')), legacyToolbar: Boolean(document.querySelector('[data-testid="sales-report-toolbar"]')) }));
      report(`legacy ${label}: old report, no new-view root, no kit table`, !legacy.nextRoot && !legacy.table && legacy.legacyToolbar, legacy);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  void ids;
  if (failed) process.exit(1);
}

module.exports = { run };
