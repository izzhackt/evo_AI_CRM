"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Воронка продаж» и «Воронка поступления» в «Новом виде» (решение владельца 27.10.2026) в Chromium: НАСТОЯЩИЕ страницы
 * `/v3/pipeline` и `/v3/admissions-pipeline` в настоящей оболочке на СИНТЕТИЧЕСКИХ данных (`boards-fixtures.cjs`: имена и дела
 * выдуманы). Страница сама решает по cookie, какой вид рисовать (`isNextUi`); сервер стенда рисует разметку, браузер гидратирует её
 * теми же страницами. Серверные действия подменены; Supabase, права и маршрутизатор Next.js стенд не проверяет — проверяются
 * вёрстка, токены, адаптив, клавиатура, доступность и пути «карточка → панель → действие», «перетаскивание → Отменить».
 *
 *   node tests/e2e/pipelines-next-static-render.cjs --screenshots [outDir]
 *     → снимки на 1440×900, 1280×800 и 390×844 и проверки (JSON-строки; при нарушении код 1). По умолчанию outDir —
 *       .impeccable/review (не коммитится). Нужен Chromium: PLAYWRIGHT_BROWSERS_PATH=<папка с браузерами>.
 */

const { mkdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
globalThis.__harnessConfig = {
  fixtures: join(__dirname, "boards-fixtures.cjs"),
  pages: { "/v3/pipeline": "src/app/(v3)/v3/pipeline/page.tsx", "/v3/admissions-pipeline": "src/app/(v3)/v3/admissions-pipeline/page.tsx" },
  titles: { "/v3/pipeline": "Воронка продаж", "/v3/admissions-pipeline": "Воронка поступления" },
};
const { bundleHydration, compileCss, fixtures, startServer } = require("./pipelines-next-harness.cjs");
const { leadId } = fixtures;

const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 } },
  d1280: { viewport: { width: 1280, height: 800 } },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};
const caseOf = (n) => `cccccccc-2222-4222-8222-${String(n).padStart(12, "0")}`;

async function main() {
  const index = process.argv.indexOf("--screenshots");
  if (index < 0) { console.error("usage: pipelines-next-static-render.cjs --screenshots [outDir]"); process.exit(2); }
  const outDir = resolve(process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[index + 1] : join(__dirname, "../../.impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const [css, bundle] = await Promise.all([compileCss(), bundleHydration()]);
  const { server, origin } = await startServer(css, bundle);
  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  let failed = false;
  const report = (check, ok, detail) => {
    if (!ok) failed = true;
    console.log(JSON.stringify({ check, ok, detail }));
  };

  /** Страница под cookie: вид («Новый вид») и сотрудник (администратор, сотрудник, просмотр роли). */
  async function open(path, key, { ui = "next", actor = "admin", rows = "default" } = {}) {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
    await context.addCookies([
      ...(ui ? [{ name: "evo_ui", value: ui, url: origin }] : []),
      { name: "harness_actor", value: actor, url: origin },
      { name: "harness_rows", value: rows, url: origin },
    ]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("response", (response) => { if (response.status() >= 400 && !/notifications\/state/u.test(response.url())) errors.push(`HTTP ${response.status()} ${response.url().replace(origin, "")}`); });
    page.on("console", (message) => { if (["error", "warning"].includes(message.type()) && !/notifications\/state|Failed to load resource/u.test(message.text())) errors.push(message.text()); });
    await page.goto(`${origin}${path}`, { waitUntil: "load" });
    await page.waitForSelector("html[data-hydrated=true]", { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    // Ленивые куски нового вида (`Radix`, подсказки): ждём, пока заглушки «?» заменятся настоящими кнопками.
    await page.waitForFunction(() => !document.querySelector('[aria-label^="Пояснение"]:not([data-slot])'), null, { timeout: 15_000 });
    return { context, page, errors };
  }
  const shot = (page, name, options = {}) => page.screenshot({ path: join(outDir, `${name}.png`), ...options });
  const url = (page) => page.url().replace(origin, "");
  const focusInfo = (page) => page.evaluate(() => {
    const active = document.activeElement;
    return { tag: active?.tagName ?? null, leadLink: active?.getAttribute("data-lead-link") ?? null, label: active?.getAttribute("aria-label") ?? active?.textContent?.trim().slice(0, 40) ?? null,
      inDialog: Boolean(active?.closest('[role="dialog"]')), tab: active?.getAttribute("aria-current") === "page" };
  });
  const smallTargets = (page, scope) => page.evaluate((root) => {
    const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"; };
    // Имя в карточке — ссылка, растянутая на всю карточку (`after:inset-0`): целью служит карточка, её размер проверяется отдельно.
    return [...document.querySelectorAll(`${root} a, ${root} button, ${root} select, ${root} input:not([type=hidden]):not([type=radio]):not([type=checkbox])`)]
      .filter((element) => visible(element) && !element.matches("[aria-label^=Пояснение], [data-lead-link], [data-testid=v3-admissions-pipeline-card] > p a") && !element.closest("[data-testid=v3-pipeline-card], [data-testid=v3-admissions-pipeline-card]") || element.matches("[data-testid=v3-admissions-pipeline-card] button"))
      .filter((element) => visible(element))
      .map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 30), h: Math.round(element.getBoundingClientRect().height), w: Math.round(element.getBoundingClientRect().width) }))
      .filter((box) => box.h < 44 || box.w < 44 && !box.text);
  }, scope);
  const axeOf = async (page, scope) => {
    const axe = await new AxeBuilder({ page }).include(scope).analyze();
    return axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  };
  const cards = (page, testId) => page.locator(`[data-testid="${testId}"]`).filter({ visible: true });

  try {
    // 0. «До»: прежний вид тех же данных (разметка прежнего вида совпадает с базовым коммитом — tests/ui-next-pipelines.test.mjs).
    for (const key of ["d1440", "m390"]) {
      for (const [path, name] of [["/v3/pipeline", "pipeline"], ["/v3/admissions-pipeline", "admissions"], ["/v3/pipeline?view=closed", "pipeline-closed"]]) {
        const { context, page } = await open(path, key, { ui: null });
        await shot(page, `before-${name}-${key}`, { fullPage: true });
        if (name === "pipeline" && key === "d1440") {
          await page.locator(`[data-testid="v3-pipeline-card"][data-lead-id="${leadId(5)}"] a[data-lead-link]`).click();
          await page.waitForSelector('[data-testid="v3-pipeline-lead-panel"]');
          await shot(page, "before-pipeline-panel-d1440");
        }
        await context.close();
      }
    }
    // ===================================================================================================== ПРОДАЖИ
    // 1. Страница на трёх ширинах: гидратация без расхождений, консоль, нет боковой прокрутки, цели ≥ 44 px, axe, одна красная кнопка.
    for (const key of ["d1440", "d1280", "m390"]) {
      const { context, page, errors } = await open("/v3/pipeline", key);
      const name = `sales ${key}`;
      await shot(page, `pipeline-${key}`, { fullPage: true });
      report(`${name}: new view (data-ui=next, kit cards)`, await page.evaluate(() => Boolean(document.querySelector('.v3-world[data-ui="next"] [data-testid="v3-pipeline"] [data-slot="card"]'))), null);
      report(`${name}: hydrated without recoverable errors`, (await page.evaluate(() => window.__harness.recoverable)).length === 0, await page.evaluate(() => window.__harness.recoverable));
      report(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
      report(`${name}: one h1`, await page.evaluate(() => [...document.querySelectorAll("h1")].filter((h) => h.getClientRects().length).map((h) => h.textContent.trim()).join("|").startsWith("Воронка продаж")), null);
      report(`${name}: targets >= 44px`, (await smallTargets(page, "[data-testid=v3-pipeline]")).length === 0, await smallTargets(page, "[data-testid=v3-pipeline]"));
      const cardBoxes = await page.evaluate(() => [...document.querySelectorAll('[data-testid="v3-pipeline-card"]')].filter((c) => c.getClientRects().length).map((c) => Math.round(c.getBoundingClientRect().height)));
      report(`${name}: cards are >= 44px tall (whole card is the target)`, cardBoxes.length > 0 && cardBoxes.every((h) => h >= 44), cardBoxes);
      const axe = await axeOf(page, "[data-testid=v3-pipeline]");
      report(`${name}: axe`, axe.length === 0, axe);
      const red = await page.evaluate(() => [...document.querySelectorAll("[data-testid=v3-pipeline] a, [data-testid=v3-pipeline] button")].filter((e) => getComputedStyle(e).backgroundColor === "rgb(215, 2, 23)" && e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()));
      report(`${name}: one red button`, red.length === 1 && red[0] === "Добавить лида", red);
      const columns = await page.evaluate(() => {
        const list = [...document.querySelectorAll('[data-testid="v3-pipeline-column"]')].filter((c) => c.getClientRects().length);
        const tops = new Set(list.map((c) => Math.round(c.getBoundingClientRect().top)));
        return { count: list.length, rows: tops.size, widths: list.map((c) => Math.round(c.getBoundingClientRect().width)) };
      });
      report(`${name}: six stage columns, ${key === "m390" ? "stacked" : "one row"}`, columns.count === 6 && (key === "m390" ? columns.rows === 6 : columns.rows === 1), columns);
      report(`${name}: console clean`, errors.length === 0, errors);
      await context.close();
    }

    // 2. Панель лида: карточка → панель (адрес `?lead=`, фокус на названии, внутри корня нового вида) → Esc → фокус на карточке.
    for (const key of ["d1440", "m390"]) {
      const { context, page, errors } = await open("/v3/pipeline", key);
      const name = `sales sheet ${key}`;
      const link = page.locator(`[data-testid="v3-pipeline-card"][data-lead-id="${leadId(5)}"] a[data-lead-link]`);
      await link.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await page.waitForFunction(() => document.activeElement?.closest('[role="dialog"]'));
      const opened = await page.evaluate(() => {
        const dialogEl = document.querySelector('[role="dialog"]');
        return { url: location.pathname + location.search, inWorld: Boolean(dialogEl.closest('.v3-world[data-ui="next"]')), focus: document.activeElement.textContent.trim(),
          form: Boolean(dialogEl.querySelector('[data-testid="v3-pipeline-workflow-form"]')), current: document.querySelector('[data-testid="v3-pipeline-card"][aria-current="true"]')?.getAttribute("data-lead-id") ?? null };
      });
      report(`${name}: opens by URL ?lead=, focus on the title, inside the new-view root, form inside`, opened.url.includes(`lead=${leadId(5)}`) && opened.inWorld && opened.focus === "Элина Демо" && opened.form && opened.current === leadId(5), opened);
      await shot(page, `pipeline-sheet-${key}`);
      report(`${name}: axe`, (await axeOf(page, '[role="dialog"]')).length === 0, await axeOf(page, '[role="dialog"]'));
      report(`${name}: targets >= 44px`, (await smallTargets(page, '[role="dialog"]')).length === 0, await smallTargets(page, '[role="dialog"]'));
      report(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), null);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      const closed = { url: url(page), focus: await focusInfo(page) };
      report(`${name}: Esc closes, URL loses ?lead=, focus returns to the card`, !closed.url.includes("lead=") && closed.focus.leadLink === leadId(5), closed);
      // Сохранение решения: прежняя форма и команда, итог остаётся в панели после обновления доски.
      await link.click();
      await dialog.waitFor();
      const form = page.getByTestId("v3-pipeline-workflow-form");
      await form.getByTestId("v3-pipeline-next-action").fill("Перезвонить после консультации (синтетика)");
      await form.getByTestId("v3-pipeline-next-action-date").fill("2030-01-15");
      await form.getByTestId("v3-pipeline-submit").click();
      await page.waitForFunction(() => window.__harness.refreshes.length > 0, null, { timeout: 10_000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="v3-pipeline-workflow-form"] input[name="expected_version"]')?.value === "4", null, { timeout: 10_000 });
      const saved = { refreshes: await page.evaluate(() => window.__harness.refreshes), open: await dialog.isVisible(), notices: await dialog.getByText("Решение сохранено.").count() };
      report(`${name}: save keeps the panel open, one «Решение сохранено.», board refreshed`, saved.open && saved.notices === 1 && saved.refreshes.length === 1, saved);
      await shot(page, `pipeline-sheet-saved-${key}`);
      await page.keyboard.press("Escape");
      report(`${name}: console clean`, errors.length === 0, errors);
      await context.close();
    }

    // 3. «Закрыть лид»: «⋯» в подвале панели → окно → строка над доской → «Вернуть в работу» → «Скрыть».
    {
      const { context, page, errors } = await open("/v3/pipeline", "d1440");
      await page.locator(`[data-testid="v3-pipeline-card"][data-lead-id="${leadId(6)}"] a[data-lead-link]`).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Ещё действия" }).click();
      await page.waitForSelector('[data-testid="v3-lead-actions-menu"]:popover-open');
      await page.getByRole("button", { name: "Закрыть лид…" }).click();
      await page.getByTestId("v3-close-lead-dialog").waitFor();
      await page.getByRole("radio", { name: "Другое", exact: true }).check();
      await page.getByLabel("Что случилось").fill("Семья решила отложить поступление на год");
      await shot(page, "pipeline-close-dialog-d1440");
      await page.getByTestId("v3-close-lead-dialog").getByRole("button", { name: "Закрыть лид" }).click();
      await page.getByTestId("v3-pipeline-closed-notice").waitFor();
      await page.waitForFunction((id) => !document.querySelector(`[data-testid="v3-pipeline-card"][data-lead-id="${id}"]`), leadId(6));
      const closed = await page.evaluate(() => ({ url: location.pathname + location.search, focusInNotice: Boolean(document.activeElement?.closest('[data-testid="v3-pipeline-closed-notice"]')),
        notice: document.querySelector('[data-testid="v3-pipeline-closed-notice"]').textContent.replace(/\s+/gu, " ").trim(), dialogs: document.querySelectorAll('[role="dialog"]').length }));
      report("sales close: lead leaves the board, notice takes focus, panel gone", !closed.url.includes("lead=") && closed.focusInNotice && /Лид «Бекзат Тестов»/u.test(closed.notice) && closed.dialogs === 0, closed);
      await shot(page, "pipeline-closed-notice-d1440");
      await page.getByTestId("v3-pipeline-closed-notice").getByRole("button", { name: "Вернуть в работу" }).click();
      await page.locator(`[data-testid="v3-pipeline-card"][data-lead-id="${leadId(6)}"]`).waitFor();
      report("sales close: «Вернуть в работу» puts the card back and says so", /снова в работе/u.test(await page.getByTestId("v3-pipeline-closed-notice").textContent()), null);
      await page.getByTestId("v3-pipeline-closed-notice-dismiss").click();
      report("sales close: «Скрыть» removes the notice, focus goes to a card", await page.evaluate(() => !document.querySelector('[data-testid="v3-pipeline-closed-notice"]') && Boolean(document.activeElement?.closest('[data-testid="v3-pipeline-card"]'))), await focusInfo(page));
      // Переданный лид — продажа: закрыть нельзя, причина названа; формы решения нет.
      await page.goto(`${origin}/v3/pipeline?lead=${leadId(13)}`, { waitUntil: "load" });
      await page.waitForSelector("html[data-hydrated=true]");
      await page.getByRole("dialog").waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "Ещё действия" }).click();
      await page.waitForSelector('[data-testid="v3-lead-actions-menu"]:popover-open');
      const handed = await page.evaluate(() => ({ menu: document.querySelector('[data-testid="v3-lead-actions-menu"]').textContent.replace(/\s+/gu, " ").trim(), form: Boolean(document.querySelector('[data-testid="v3-pipeline-workflow-form"]')) }));
      report("sales close: a handed-off lead is not closable and says why; no decision form", /Закрыть лид/u.test(handed.menu) && handed.menu.length > 20 && !handed.form, handed);
      report("sales close: console clean", errors.length === 0, errors);
      await context.close();
    }

    // 4. Вкладки этапов: фокус на этапе → одна колонка сеткой; «Переданы»; «Все этапы».
    {
      const { context, page, errors } = await open("/v3/pipeline", "d1440");
      const tab = (label) => page.locator('nav[aria-label="Этапы воронки"]').getByRole("link", { name: label });
      await tab(/^Квалифицирован/u).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="v3-pipeline-board"]')?.getAttribute("data-focus") === "qualified");
      const focus = await page.evaluate(() => ({ url: location.search, columns: document.querySelectorAll('[data-testid="v3-pipeline-column"]').length, current: document.querySelector('nav[aria-label="Этапы воронки"] a[aria-current="page"]')?.textContent.trim() }));
      report("sales tabs: a stage tab shows that stage only and marks itself current", focus.url === "?stage=qualified" && focus.columns === 1 && /^Квалифицирован/u.test(focus.current), focus);
      await shot(page, "pipeline-focus-d1440");
      await tab(/^Переданы/u).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="v3-pipeline-board"]')?.getAttribute("data-focus") === "handed_off");
      report("sales tabs: «Переданы» shows the handed-off column", await page.locator('[data-testid="v3-pipeline-card"]').count() === 2, null);
      await tab(/^Все этапы/u).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="v3-pipeline-board"]')?.getAttribute("data-focus") === "all");
      report("sales tabs: «Все этапы» returns the six columns", await page.locator('[data-testid="v3-pipeline-column"]').count() === 6, null);
      report("sales tabs: console clean", errors.length === 0, errors);
      await context.close();
    }

    // 5. Большая колонка и закрытые лиды.
    {
      const { context, page } = await open("/v3/pipeline", "d1440", { rows: "volume" });
      await shot(page, "pipeline-volume-d1440", { fullPage: true });
      report("sales volume: 34 cards in a column, no horizontal scroll", await page.evaluate(() => document.querySelectorAll('[data-testid="v3-pipeline-column"][data-stage="new"] [data-testid="v3-pipeline-card"]').length === 34 && document.documentElement.scrollWidth <= window.innerWidth + 1), null);
      await context.close();
    }
    for (const key of ["d1440", "m390"]) {
      const { context, page, errors } = await open("/v3/pipeline?view=closed", key);
      const closedPage = await page.evaluate(() => ({ h1: document.querySelector("main h1")?.textContent?.trim(), rows: document.querySelectorAll('[data-testid="v3-closed-leads"] li').length,
        back: Boolean(document.querySelector('main a[href="/v3/pipeline"]')), kit: Boolean(document.querySelector('.v3-world[data-ui="next"] [data-testid="v3-pipeline-closed"]')) }));
      report(`sales closed ${key}: new frame, list rows, back link`, closedPage.kit && closedPage.rows === 3 && closedPage.back && /^Закрытые/u.test(closedPage.h1), closedPage);
      report(`sales closed ${key}: axe`, (await axeOf(page, "[data-testid=v3-pipeline-closed]")).length === 0, await axeOf(page, "[data-testid=v3-pipeline-closed]"));
      report(`sales closed ${key}: targets >= 44px`, (await smallTargets(page, "[data-testid=v3-pipeline-closed]")).length === 0, await smallTargets(page, "[data-testid=v3-pipeline-closed]"));
      await shot(page, `pipeline-closed-${key}`, { fullPage: true });
      report(`sales closed ${key}: console clean`, errors.length === 0, errors);
      await context.close();
    }

    // 6. Другие миры: сотрудник и просмотр роли с cookie, администратор без неё — прежний вид (колонки прежней доски, корень без data-ui).
    for (const [label, options] of [["staff + cookie", { actor: "staff" }], ["preview + cookie", { actor: "preview" }], ["admin without cookie", { ui: null }]]) {
      for (const path of ["/v3/pipeline", "/v3/admissions-pipeline"]) {
        const { context, page } = await open(path, "d1440", options);
        const legacy = await page.evaluate(() => ({ nextRoot: Boolean(document.querySelector('[data-ui="next"]')), nextCards: document.querySelectorAll("[data-slot=card]").length,
          columns: document.querySelectorAll('[data-testid$="-column"]').length }));
        report(`legacy ${label} ${path}: old view, no new-view root, no kit cards`, !legacy.nextRoot && legacy.nextCards === 0 && legacy.columns > 0, legacy);
        await context.close();
      }
    }

    // ================================================================================================= ПОСТУПЛЕНИЕ
    // 7. Страница на трёх ширинах.
    for (const key of ["d1440", "d1280", "m390"]) {
      const { context, page, errors } = await open("/v3/admissions-pipeline", key);
      const name = `admissions ${key}`;
      await shot(page, `admissions-${key}`, { fullPage: true });
      report(`${name}: new view (data-ui=next, kit cards)`, await page.evaluate(() => Boolean(document.querySelector('.v3-world[data-ui="next"] [data-testid="v3-admissions-pipeline"] [data-slot="card"]'))), null);
      report(`${name}: hydrated without recoverable errors`, (await page.evaluate(() => window.__harness.recoverable)).length === 0, await page.evaluate(() => window.__harness.recoverable));
      report(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
      report(`${name}: one h1`, await page.evaluate(() => [...document.querySelectorAll("h1")].filter((h) => h.getClientRects().length).map((h) => h.textContent.trim()).join("|").startsWith("Воронка поступления")), null);
      const small = await smallTargets(page, "[data-testid=v3-admissions-pipeline]");
      report(`${name}: targets >= 44px`, small.length === 0, small);
      const cardBoxes = await page.evaluate(() => [...document.querySelectorAll('[data-testid="v3-admissions-pipeline-card"]')].filter((c) => c.getClientRects().length).map((c) => Math.round(c.getBoundingClientRect().height)));
      report(`${name}: cards are >= 44px tall`, cardBoxes.length > 0 && cardBoxes.every((h) => h >= 44), cardBoxes);
      const axe = await axeOf(page, "[data-testid=v3-admissions-pipeline]");
      report(`${name}: axe`, axe.length === 0, axe);
      const red = await page.evaluate(() => [...document.querySelectorAll("[data-testid=v3-admissions-pipeline] a, [data-testid=v3-admissions-pipeline] button")].filter((e) => getComputedStyle(e).backgroundColor === "rgb(215, 2, 23)" && e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()));
      report(`${name}: one red button`, red.length === 1, red);
      const columns = await page.evaluate(() => {
        const list = [...document.querySelectorAll('[data-testid="v3-admissions-pipeline-column"]')].filter((c) => c.getClientRects().length);
        return { visible: list.length, rows: new Set(list.map((c) => Math.round(c.getBoundingClientRect().top))).size, widths: list.map((c) => Math.round(c.getBoundingClientRect().width)),
          select: Boolean([...document.querySelectorAll("select")].find((e) => e.getClientRects().length && e.closest("label")?.textContent.startsWith("Этап"))) };
      });
      report(`${name}: ${key === "m390" ? "one stage and the «Этап» select" : "five stage columns in one row, no select"}`, key === "m390" ? columns.visible === 1 && columns.select : columns.visible === 5 && columns.rows === 1 && !columns.select, columns);
      report(`${name}: console clean`, errors.length === 0, errors);
      await context.close();
    }

    // 8. Перетаскивание (мышь, `@dnd-kit/core`) → перемещение → «Отменить» строкой в верхнем слое → итог отмены.
    {
      const { context, page, errors } = await open("/v3/admissions-pipeline", "d1440");
      const cardOf = (n) => page.locator(`[data-testid="v3-admissions-pipeline-card"][data-student-case-id="${caseOf(n)}"]`);
      const stageOf = (n) => page.evaluate((id) => document.querySelector(`[data-student-case-id="${id}"]`)?.closest('[data-testid="v3-admissions-pipeline-column"]')?.getAttribute("data-stage") ?? null, caseOf(n));
      const calls = () => page.evaluate(() => globalThis.__boardsFixture.pipelineCalls.length);
      const column = page.locator('[data-testid="v3-admissions-pipeline-column"][data-stage="shortlist"]');
      const from = await cardOf(1).boundingBox();
      const to = await column.boundingBox();
      await page.mouse.move(from.x + 40, from.y + 20);
      await page.mouse.down();
      await page.mouse.move(from.x + 60, from.y + 40, { steps: 4 });
      await page.mouse.move(to.x + to.width / 2, to.y + 140, { steps: 14 });
      const during = await page.evaluate(() => ({ overlay: Boolean(document.querySelector('[data-testid="v3-admissions-pipeline-card"][style*="opacity"], [data-testid="v3-admissions-pipeline-card"].opacity-40')), dashed: getComputedStyle(document.querySelector('[data-testid="v3-admissions-pipeline-column"][data-stage="shortlist"]')).outlineStyle }));
      await shot(page, "admissions-drag-d1440");
      await page.mouse.up();
      await page.waitForFunction((id) => document.querySelector(`[data-student-case-id="${id}"]`)?.closest('[data-testid="v3-admissions-pipeline-column"]')?.getAttribute("data-stage") === "shortlist", caseOf(1), { timeout: 10_000 });
      report("admissions drag: dropping on a column highlights it while over and moves the case with the same server action", during.dashed === "dashed" && await calls() === 1, { during, stage: await stageOf(1), calls: await page.evaluate(() => globalThis.__boardsFixture.pipelineCalls) });
      const toast = page.locator('[data-testid="v3-undo-toasts"]');
      await toast.waitFor();
      report("admissions drag: «Отменить» row names the move", /Дело «Айжан Примерова» перемещено/u.test(await toast.textContent()), await toast.textContent());
      await shot(page, "admissions-undo-d1440");
      await toast.getByRole("button", { name: /Отменить/u }).click();
      await page.waitForFunction((id) => document.querySelector(`[data-student-case-id="${id}"]`)?.closest('[data-testid="v3-admissions-pipeline-column"]')?.getAttribute("data-stage") === "new", caseOf(1), { timeout: 10_000 });
      report("admissions drag: «Отменить» returns the case and says so", /Перемещение отменено/u.test(await page.locator('[data-testid="v3-admissions-pipeline-board"]').textContent()), null);
      // Нажатие по имени не начинает перетаскивание: ссылка ведёт в дело.
      const href = await cardOf(2).locator("a").first().getAttribute("href");
      report("admissions drag: the name link still opens the case (click is not a drag)", href === `/v3/profile?case=${caseOf(2)}&tab=route`, href);
      report("admissions drag: console clean", errors.length === 0, errors);
      await context.close();
    }

    // 9. Клавиатура: «⋯» → «Переместить в…» → фокус на «Отменить» → Enter → фокус на вернувшейся карточке; «Убрать из воронки» → «Вернуть».
    {
      const { context, page, errors } = await open("/v3/admissions-pipeline", "d1440");
      const trigger = page.locator(`[data-student-case-id="${caseOf(2)}"] button[popovertarget]`);
      await trigger.focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector('[data-testid="v3-admissions-pipeline-move"]:popover-open');
      await page.keyboard.press("Tab");
      const first = await page.evaluate(() => document.activeElement.textContent.trim());
      await page.keyboard.press("Enter");
      await page.getByTestId("v3-undo-toasts").waitFor();
      const undoFocus = await page.evaluate(() => ({ inToast: Boolean(document.activeElement?.closest('[data-testid="v3-undo-toasts"]')), label: document.activeElement?.textContent?.trim() }));
      report("admissions keyboard: ⋯ → first stage moves the case and focus lands on «Отменить»", undoFocus.inToast && /Отменить/u.test(undoFocus.label) && await page.evaluate(() => globalThis.__boardsFixture.pipelineCalls.length) === 1, { first, undoFocus });
      await page.keyboard.press("Enter");
      await page.waitForFunction((id) => document.querySelector(`[data-student-case-id="${id}"]`)?.closest('[data-testid="v3-admissions-pipeline-column"]')?.getAttribute("data-stage") === "new", caseOf(2));
      await page.waitForFunction((id) => document.activeElement?.closest(`[data-student-case-id="${id}"]`), caseOf(2), { timeout: 5_000 });
      report("admissions keyboard: undo puts the case back and focus on its card", true, null);
      // Убрать из воронки: подтверждение внутри меню, итог строкой, «Вернуть в воронку».
      const trigger3 = page.locator(`[data-student-case-id="${caseOf(3)}"] button[popovertarget]`);
      await trigger3.click();
      await page.waitForSelector('[data-testid="v3-admissions-pipeline-move"]:popover-open');
      await page.getByRole("button", { name: "Убрать из воронки" }).click();
      await shot(page, "admissions-menu-remove-d1440");
      await page.locator('[data-testid="v3-admissions-pipeline-move"]:popover-open').getByRole("button", { name: "Убрать", exact: true }).click();
      await page.waitForFunction((id) => !document.querySelector(`[data-student-case-id="${id}"]`), caseOf(3));
      const removed = page.getByRole("button", { name: "Вернуть в воронку" });
      await removed.waitFor();
      report("admissions remove: case leaves the board, notice with «Вернуть в воронку»", /убрано из воронки/u.test(await page.locator('[data-testid="v3-admissions-pipeline-board"]').textContent()), null);
      await removed.click();
      await page.locator(`[data-student-case-id="${caseOf(3)}"]`).waitFor();
      report("admissions remove: «Вернуть в воронку» puts the card back", /снова в воронке/u.test(await page.locator('[data-testid="v3-admissions-pipeline-board"]').textContent()), null);
      report("admissions keyboard: console clean", errors.length === 0, errors);
      await context.close();
    }

    // 10. Телефон: этап выбирается списком (адрес `?stage=`), перемещение — через «⋯», карточка уходит из видимого этапа.
    {
      const { context, page, errors } = await open("/v3/admissions-pipeline", "m390");
      const select = page.locator("label", { hasText: /^Этап/u }).locator("select");
      const options = await select.locator("option").allTextContents();
      await select.selectOption({ label: options[2] });
      await page.waitForFunction(() => location.search.includes("stage="));
      const stage = await page.evaluate(() => ({ url: location.search, visible: [...document.querySelectorAll('[data-testid="v3-admissions-pipeline-column"]')].filter((c) => c.getClientRects().length).map((c) => c.getAttribute("data-stage")), cards: [...document.querySelectorAll('[data-testid="v3-admissions-pipeline-card"]')].filter((c) => c.getClientRects().length).length }));
      report("admissions phone: «Этап» select shows one stage and writes ?stage= to the URL", options.length === 5 && stage.visible.length === 1 && stage.url.includes("stage=documents") && stage.cards === 2, { options, stage });
      await shot(page, "admissions-stage-m390", { fullPage: true });
      const menu = page.locator('[data-testid="v3-admissions-pipeline-card"]').filter({ visible: true }).first().locator("button[popovertarget]");
      await menu.click();
      await page.waitForSelector('[data-testid="v3-admissions-pipeline-move"]:popover-open');
      await shot(page, "admissions-menu-m390");
      const items = page.locator('[data-testid="v3-admissions-pipeline-move"]:popover-open button');
      const sizes = await items.evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length).map((node) => Math.round(node.getBoundingClientRect().height)));
      report("admissions phone: visible menu items are >= 44px", sizes.length >= 5 && sizes.every((h) => h >= 44), sizes);
      await items.first().click();
      await page.getByTestId("v3-undo-toasts").waitFor();
      report("admissions phone: the moved card leaves the visible stage, the row names it", await page.locator('[data-testid="v3-admissions-pipeline-card"]').filter({ visible: true }).count() === 1 && /перемещено в/u.test(await page.getByTestId("v3-undo-toasts").textContent()), null);
      report("admissions phone: console clean", errors.length === 0, errors);
      await context.close();
    }
    void leadId; void caseOf; void shot; void url; void focusInfo; void cards;
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
