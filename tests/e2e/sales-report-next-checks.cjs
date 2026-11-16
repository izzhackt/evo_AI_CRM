"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Проверки «Отчёта продаж» нового вида в Chromium (зовёт `sales-report-next-static-render.cjs --screenshots`): страница на трёх ширинах,
 * панель записи (адрес, фокус, Esc, форма «Исправить запись»), «Убрать» / «Вернуть», фильтры, новая продажа, «Менеджеры в отчёте»,
 * «Перенос данных», план месяца, другие миры (сотрудник, просмотр роли).
 */

const { join } = require("node:path");
const { headerWrapViolations } = require("./layout-probes.cjs");

const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 } },
  d1280: { viewport: { width: 1280, height: 800 } },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  m360: { viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  m320: { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  // Окно уже ноутбука при открытом боковом меню (260 px): карточкам остаётся 420–750 px.
  t768: { viewport: { width: 768, height: 900 } },
  t820: { viewport: { width: 820, height: 900 } },
  t900: { viewport: { width: 900, height: 900 } },
  t1100: { viewport: { width: 1100, height: 900 } },
  // Сразу за 64rem ширины таблицы (меню открыто): «Страна» раскрывается в «Страну и программу».
  d1340: { viewport: { width: 1340, height: 900 } },
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

  async function open(path, key, { actor = "admin" } = {}) {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
    await context.addCookies([{ name: "harness_actor", value: actor, url: origin }]);
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
    // 1. Страница на трёх ширинах.
    for (const key of ["d1440", "d1280", "m390"]) {
      const { context, page, errors } = await open(`/finance?${SEARCH}`, key);
      const name = `report ${key}`;
      await shot(page, `report-${key}`, { fullPage: true });
      report(`${name}: new view (data-ui=next, kit table)`, await page.evaluate(() => Boolean(document.querySelector('.v3-world[data-ui="next"] [data-testid="v3-sales-report"] [data-slot="data-table"]'))), null);
      report(`${name}: hydrated without recoverable errors`, (await page.evaluate(() => window.__harness.recoverable)).length === 0, await page.evaluate(() => window.__harness.recoverable));
      report(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
      report(`${name}: one h1`, await page.evaluate(() => [...document.querySelectorAll("h1")].filter((h) => h.getClientRects().length).map((h) => h.textContent.trim()).join("|") === "Финансы"), null);
      const targets = await small(page, "[data-testid=v3-sales-report]");
      report(`${name}: targets >= 44px`, targets.length === 0, targets);
      const axe = await axeOf(page, "[data-testid=v3-sales-report]");
      report(`${name}: axe`, axe.length === 0, axe);
      const red = await page.evaluate(() => [...document.querySelectorAll("[data-testid=v3-sales-report] a, [data-testid=v3-sales-report] button")].filter((e) => getComputedStyle(e).backgroundColor === "rgb(215, 2, 23)" && e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()));
      report(`${name}: one red button (Добавить продажу)`, red.length === 1 && red[0] === "Добавить продажу", red);
      // «Суммы»: основа сумм и правила — за «?», на виду — строка отказа и что не вошло (15.11.2026, решение упростить отчёт).
      const moneyText = (await page.getByTestId("sales-money-summary").innerText()).replace(/\s+/gu, " ");
      report(`${name}: money card keeps the refusal and «не вошли» visible, the basis and rules are not on the card`,
        /Отказ — 1 запись/u.test(moneyText) && /Не вошли: без стоимости — 1 запись, оплата не указана — 1 запись\./u.test(moneyText) && !/Суммы по 7|Остаток не считается|Валюты не пересчитываются/u.test(moneyText), moneyText);
      await page.getByRole("button", { name: "Пояснение: Суммы" }).click();
      const moneyHelp = page.getByRole("dialog", { name: "Пояснение: Суммы" });
      const helpText = (await moneyHelp.innerText()).replace(/\s+/gu, " ");
      report(`${name}: «?» of Суммы tells the basis and the rules`, /Суммы по 7 записям месяца отчёта, из них 1 без даты продажи\. Остаток не считается, если оплата в другой валюте и нет суммы в валюте договора\. Валюты не пересчитываются; это записи отчёта, не поступления за месяц\./u.test(helpText), helpText);
      if (key !== "d1280") await shot(page, `report-money-help-${key}`);
      await page.keyboard.press("Escape");
      report(`${name}: Escape closes the «?» of Суммы`, !(await moneyHelp.isVisible()), null);
      const facts = await page.evaluate(() => ({
        headline: document.querySelector('[data-testid="v3-sales-headline"]')?.getAttribute("data-sales"),
        tiles: document.querySelectorAll('[data-testid="v3-sales-summary"] [data-sales-cell]').length,
        money: Boolean(document.querySelector('[data-testid="sales-money-table"]')), withdrawn: Boolean(document.querySelector('[data-testid="sales-withdrawn-summary"]')),
        rows: [...document.querySelectorAll("[data-slot=data-table] tbody tr, [data-slot=data-table-cards] > li")].filter((e) => e.getClientRects().length).length,
        cash: Boolean(document.querySelector('[data-testid="sales-cash-totals"]')), dynamics: Boolean(document.querySelector("#sales-dynamics")),
      }));
      report(`${name}: headline number, plan tile, money table, refusal line, rows, cash, dynamics`, facts.headline === "6" && facts.tiles === 2 && facts.money && facts.withdrawn && facts.rows === 8 && facts.cash && facts.dynamics, facts);
      report(`${name}: console clean`, errors.length === 0, errors);
      await context.close();
    }

    // 1b. Суммы и поступления на 1440, 1280, 390, 360 и 320: страница не шире окна; на широком экране — таблица целиком (стопки нет); на узком (карточка уже 34rem) —
    // стопка «валюта: подпись — число», таблица скрыта. Ни одно число не обрезано краем карточки (раньше последний столбец, «Итого» и «Остаток», прятался за
    // прокруткой без подсказки), а числа стопки те же, что в таблице.
    for (const key of ["d1440", "d1280", "m390", "m360", "m320"]) {
      const { context, page, errors } = await open(`/finance?${SEARCH}`, key);
      const name = `report ${key}`;
      const width = VIEWPORTS[key].viewport.width;
      const phone = width < 600;
      const fit = await page.evaluate((pairs) => {
        const out = { page: [document.documentElement.scrollWidth, window.innerWidth], blocks: [] };
        for (const [tableId, stackId] of pairs) {
          const table = document.querySelector(`[data-testid="${tableId}"]`);
          const region = table.parentElement;
          const list = document.querySelector(`[data-testid="${stackId}"]`);
          if (!list) { out.blocks.push({ tableId, missingStack: true }); continue; }
          const card = table.closest('[data-slot="card"]');
          const cardBox = card.getBoundingClientRect();
          const tableShown = getComputedStyle(region).display !== "none" && region.getClientRects().length > 0;
          const listShown = getComputedStyle(list).display !== "none" && list.getClientRects().length > 0;
          const shown = tableShown ? region : list;
          const edge = shown.getBoundingClientRect();
          const rows = [...table.querySelectorAll("tbody tr")].map((row) => [...row.cells].slice(1).map((cell) => cell.textContent.trim()).filter(Boolean));
          const blocks = [...list.querySelectorAll(":scope > li")].map((li) => [...li.querySelectorAll("dd")].map((dd) => dd.textContent.trim()).filter(Boolean));
          const clipped = tableShown ? Math.max(0, region.scrollWidth - region.clientWidth) : [...list.querySelectorAll("dd, dt, p")].filter((node) => node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().right > cardBox.right - 1).length;
          out.blocks.push({ tableId, tableShown, listShown, insideCard: Math.round(edge.right - cardBox.right), clipped, textOverflow: Math.max(0, ...[...card.querySelectorAll("p")].map((node) => Math.round(node.getBoundingClientRect().right - cardBox.right))),
            same: JSON.stringify(rows) === JSON.stringify(blocks), rows: rows.length, blockCount: blocks.length, regionFocusable: region.tabIndex === 0 && region.getAttribute("role") === "region" });
        }
        return out;
      }, [["sales-money-table", "sales-money-stack"], ["sales-cash-totals", "sales-cash-stack"]]);
      report(`${name}: page is not wider than the window (layout viewport stays ${width})`, fit.page[0] <= fit.page[1] + 1 && fit.page[1] <= width, fit.page);
      report(`${name}: money and cash show ${phone ? "a stack by currency (table hidden)" : "the whole table (stack hidden)"}, nothing cut by the card edge, the same numbers either way`,
        fit.blocks.every((one) => one.tableShown === !phone && one.listShown === phone && one.insideCard <= 1 && one.clipped === 0 && one.textOverflow <= 1 && one.same && one.rows > 0 && one.rows === one.blockCount && one.regionFocusable), fit.blocks);
      await shot(page, `report-${key}-fit`, { fullPage: true });
      // Шапки карточек: короткое действие стоит рядом с заголовком, пока им вместе хватает места.
      const wrapped = await page.evaluate(headerWrapViolations);
      report(`${name}: card headers keep a short action beside the title`, wrapped.length === 0, wrapped);
      // Сводка: «Продажи» и «План» — в одной строке с линией между ними; «Изменить план» в той же карточке; ни одна подпись не шире карточки.
      const summary = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="v3-sales-summary"]');
        const box = card.getBoundingClientRect();
        const cells = [...card.querySelectorAll("[data-sales-cell]")].map((cell) => cell.getBoundingClientRect());
        const button = [...card.querySelectorAll("button")].find((one) => one.textContent.trim() === "Изменить план");
        return { cells: cells.length, oneRow: cells.every((cell) => Math.abs(cell.top - cells[0].top) < 1), inside: [...card.querySelectorAll("p, button")].every((node) => node.getBoundingClientRect().right <= box.right + 1),
          button: Boolean(button), narrowest: Math.round(Math.min(...cells.map((cell) => cell.width))) };
      });
      report(`${name}: summary — «Продажи» and «План» side by side, «Изменить план» in the same card, nothing past its edge`, summary.cells === 2 && summary.oneRow && summary.inside && summary.button && summary.narrowest >= 120, summary);
      const axe = await axeOf(page, "[data-testid=v3-sales-report]");
      report(`${name}: axe (scrollable regions are focusable)`, axe.length === 0, axe);
      report(`${name}: console clean`, errors.length === 0, errors);
      await context.close();
    }

    // 1d. Средняя ширина (768–1100, меню открыто): кнопки плана не ложатся на числа сводки, «Сумма» менеджеров видна без прокрутки вбок.
    // Продажник — обе кнопки плана («Изменить план» и «Перенос данных»), администратор — одна.
    for (const key of ["t768", "t820", "t900", "t1100"]) {
      for (const actor of ["admin", "staff"]) {
        const { context, page } = await open(`/finance?${SEARCH}`, key, { actor });
        const fit = await page.evaluate(() => {
          const card = document.querySelector('[data-testid="v3-sales-summary"]');
          const box = (node) => node.getBoundingClientRect();
          const meets = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          const texts = [...card.querySelectorAll("[data-sales-cell] p")].map(box);
          const buttons = [...card.querySelectorAll("a, button")].map(box);
          const region = document.querySelector('[data-testid="sales-manager-summary"]');
          return { overlaps: texts.filter((text) => buttons.some((button) => meets(text, button))).length, buttons: buttons.length,
            inside: [...card.querySelectorAll("p, a, button")].every((node) => box(node).right <= box(card).right + 1),
            managersScroll: region ? region.scrollWidth - region.clientWidth : null, page: document.documentElement.scrollWidth - window.innerWidth };
        });
        report(`report ${key} ${actor}: summary buttons never cover the numbers; managers table fits its card; no page scroll`,
          fit.buttons > 0 && fit.overlaps === 0 && fit.inside && (fit.managersScroll === null || fit.managersScroll <= 1) && fit.page <= 0, fit);
        if (actor === "staff") await shot(page, `report-${key}-staff-summary`, { clip: { x: 0, y: 0, width: VIEWPORTS[key].viewport.width, height: 700 } });
        await context.close();
      }
    }

    // 1e. Выбраны фильтры (чипы на странице): поле поиска не сжимается до значка и не уходит под кнопку «Фильтры» — чипы переносятся строкой ниже.
    for (const key of ["m320", "m390", "t768", "t900"]) {
      const { context, page } = await open(`/finance?${SEARCH}&manager=${encodeURIComponent("айдана макетова")}&review=true&q=${encodeURIComponent("Айжан")}`, key);
      const bar = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-testid="sales-report-toolbar"]');
        const input = toolbar.querySelector('input[name="q"]').getBoundingClientRect();
        const button = toolbar.querySelector('[data-testid="list-filters"]').getBoundingClientRect();
        const chips = [...toolbar.querySelectorAll('[data-testid="list-filter-applied"]')].map((chip) => chip.getBoundingClientRect());
        const apart = (a, b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
        return { search: Math.round(input.width), chips: chips.length, clear: apart(input, button) && chips.every((chip) => apart(input, chip) && apart(button, chip)),
          page: document.documentElement.scrollWidth - window.innerWidth };
      });
      report(`report toolbar ${key} with filters: the search keeps its width (≥ 200 px), chips wrap below, nothing overlaps`, bar.search >= 200 && bar.chips === 2 && bar.clear && bar.page <= 0, bar);
      await context.close();
    }

    // 1f. Таблица записей (15.11.2026, решение упростить отчёт): одиннадцать полей владельца — восемью колонками, родственные одной ячейкой двумя строками.
    // «Страна» есть на любой ширине (и сортирует, как раньше); таблица от 64rem — колонка раскрывается в «Страну и программу» с университетом
    // и интейком; статус оплаты — под «Оплачено». От 1100 px окна таблица целиком, без прокрутки вбок, и сразу за 64rem (1340) тоже; от 68rem
    // заголовки в одну строку, уже — «Дата / подписания» двумя; имя и заметки переносятся, а не обрезаются; суммы не обрезаны и стоят на одной
    // линии; «Страна» сортирует по стране, затем по программе. «Менеджер» — от 60rem, как раньше. Телефон — прежняя карточка.
    const TABLE_HEADERS = {
      d1440: ["ФИО студента", "Страна и программа", "Стоимость", "Дата подписания", "Оплачено", "Долг", "Менеджер", "Действие"],
      d1340: ["ФИО студента", "Страна и программа", "Стоимость", "Дата подписания", "Оплачено", "Долг", "Менеджер", "Действие"],
      d1280: ["ФИО студента", "Страна", "Стоимость", "Дата подписания", "Оплачено", "Долг", "Менеджер", "Действие"],
      t1100: ["ФИО студента", "Страна", "Стоимость", "Дата подписания", "Оплачено", "Долг", "Действие"],
      t900: ["ФИО студента", "Страна", "Стоимость", "Дата подписания", "Оплачено", "Долг", "Действие"],
    };
    for (const key of ["d1440", "d1340", "d1280", "t1100", "t900", "m390"]) {
      const { context, page } = await open(`/finance?${SEARCH}`, key);
      const wide = key === "d1440" || key === "d1340";
      const table = await page.evaluate(() => {
        const shown = (node) => Boolean(node) && node.getClientRects().length > 0 && getComputedStyle(node).display !== "none";
        const cut = (node) => node.scrollWidth > node.clientWidth + 1;
        const region = document.querySelector('[data-slot="data-table"] [role="region"]');
        const visible = (node) => (shown(node) ? node.innerText.replace(/\s+/gu, " ").trim() : null);
        if (!shown(region)) {
          const card = [...document.querySelectorAll("[data-slot=data-table-cards] > li")].find((li) => li.textContent.includes("Алина Переданная"));
          return { phone: true, labels: [...card.querySelectorAll("dt")].map((dt) => dt.textContent.trim()), status: visible(card.querySelector("[data-sale-status]")) };
        }
        const headers = [...region.querySelectorAll("thead th")].filter(shown);
        const first = [...region.querySelectorAll("tbody tr")].find((row) => row.textContent.includes("Алина Переданная"));
        // Строк в заголовке — по строкам его текста (высота ячейки не растёт: две строки помещаются в 44 px кнопки).
        const lines = (th) => {
          const tops = new Set();
          const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim() || !shown(node.parentElement)) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
          }
          return tops.size;
        };
        const money = [...first.querySelectorAll("td")].filter((td) => td.classList.contains("text-right")).map((td) => {
          const span = [...td.querySelectorAll("span")].find((one) => shown(one) && one.classList.contains("whitespace-nowrap"));
          return span ? Math.round(span.getBoundingClientRect().top) : null;
        });
        return {
          overflow: region.scrollWidth - region.clientWidth,
          headers: headers.map((th) => th.innerText.replace(/\s+/gu, " ").trim()),
          twoLineHeaders: headers.filter((th) => lines(th) > 1).map((th) => th.innerText.replace(/\s+/gu, " ").trim()),
          cutText: [...region.querySelectorAll("tbody td span")].filter((span) => shown(span) && !span.classList.contains("sr-only") && cut(span)).map((span) => span.textContent.trim().slice(0, 30)),
          place: visible(first.querySelector("[data-sale-place]")), status: visible(first.querySelector("[data-sale-status]")),
          moneyTops: money,
        };
      });
      if (table.phone) {
        report(`report ${key}: the phone card is unchanged (cost, paid, debt; no payment status line)`, JSON.stringify(table.labels) === JSON.stringify(["Стоимость", "Оплачено", "Долг"]) && table.status === null, table);
      } else {
        const headers = TABLE_HEADERS[key];
        const twoLine = key === "d1440" ? [] : ["Дата подписания"];
        report(`report ${key}: the table has ${headers.length} columns${key === "t900" ? "" : " and no sideways scroll"}; ${twoLine.length ? "only «Дата подписания» is two lines" : "headers are one line"}; names, notes and sums are not cut; the three sums of a row stand on one line`,
          JSON.stringify(table.headers) === JSON.stringify(headers) && (key === "t900" || table.overflow <= 1) && table.cutText.length === 0 && JSON.stringify(table.twoLineHeaders) === JSON.stringify(twoLine)
            && table.moneyTops.length === 3 && new Set(table.moneyTops).size === 1, table);
        report(`report ${key}: ${wide ? "every owner field is on screen — university and intake under «Страна и программа»" : "the country column shows the country (program, university, intake — in the record panel, as before)"}, the payment status under «Оплачено»`,
          (wide ? /^Малайзия · Бакалавриат UCSI University · интейк 2027$/u.test((table.place ?? "").replace(/(Страна|Программа|Университет): /gu, ""))
            : table.place === "Малайзия") && /Частично оплачено/u.test(table.status ?? ""), table);
      }
      await page.locator('[data-slot="data-table"]').screenshot({ path: join(outDir, `report-table-${key}.png`) });
      if (wide) {
        // Читалка: имя ячейки из дерева доступности самого Chrome (CDP; ariaSnapshot Playwright считает имя по-своему и склейки не видит) —
        // поля через пробел, «UCSI University интейк 2027», а не «Universityинтейк».
        const cdp = await context.newCDPSession(page);
        await cdp.send("Accessibility.enable");
        const { nodes } = await cdp.send("Accessibility.getFullAXTree");
        const spoken = nodes.filter((node) => ["cell", "gridcell"].includes(node.role?.value) && /UCSI/u.test(node.name?.value ?? "")).map((node) => node.name.value);
        report(`report ${key}: a screen reader hears the merged fields apart (Страна: Малайзия Программа: Бакалавриат Университет: UCSI University интейк 2027)`,
          spoken.length === 1 && spoken[0] === "Страна: Малайзия Программа: Бакалавриат Университет: UCSI University интейк 2027", spoken);
      }
      if (key === "d1440" || key === "t1100") {
        // «Страна» сортирует по стране, затем по программе (как прежняя колонка): первым — Китай.
        await page.locator("[data-slot=data-table] thead button").filter({ hasText: "Страна" }).first().click();
        const sorted = await page.evaluate(() => ({ order: [...document.querySelectorAll("[data-slot=data-table] tbody tr")].map((row) => (row.querySelector("[data-sale-place]")?.innerText ?? "").replace(/(Страна|Программа|Университет):\s*/gu, "").trim().split(/\s/u)[0]),
          aria: [...document.querySelectorAll("[data-slot=data-table] thead th")].find((th) => /Страна/u.test(th.innerText))?.getAttribute("aria-sort") }));
        report(`report ${key}: «Страна» sorts by country (Китай first, then the Малайзия rows)`, sorted.aria === "ascending" && sorted.order[0] === "Китай" && sorted.order.slice(1).every((one) => one === "Малайзия"), sorted);
      }
      await context.close();
    }

    // 1c. Поле поиска: «Имя, телефон, договор» не обрезано, строка фильтров занимает всю строку инструментов таблицы; план месяца числом не повторяется.
    for (const key of ["d1440", "d1280", "m390"]) {
      const { context, page } = await open(`/finance?${SEARCH}`, key);
      const width = await page.evaluate(() => {
        const input = document.querySelector('[data-testid="sales-report-toolbar"] input[type="search"]');
        return { input: Math.round(input.getBoundingClientRect().width), toolbar: Math.round(input.closest('[data-testid="sales-report-toolbar"]').getBoundingClientRect().width), clipped: input.scrollWidth > input.clientWidth };
      });
      if (key === "d1440") {
        const plan = await page.evaluate(() => ({ tile: Boolean([...document.querySelectorAll('[data-testid="v3-sales-summary"] [data-sales-cell]')].find((cell) => /План\s*35/u.test(cell.textContent))),
          sentence: /План на месяц: 35/u.test(document.body.innerText), card: Boolean([...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "План месяца")) }));
        report("report plan: the number stands in the summary once; no separate «План месяца» card at the bottom", plan.tile && !plan.card && !plan.sentence, plan);
      }
      await context.close();
      report(`report toolbar ${key}: the search field is not cut (placeholder «Имя, телефон, договор»), toolbar fills its row`, width.input >= 280 && !width.clipped, width);
    }

    // 2. Панель записи: строка → панель (адрес ?record=, фокус на названии) → Esc → фокус на строке; «Исправить запись» открывает форму.
    for (const key of ["d1440", "m390"]) {
      const { context, page, errors } = await open(`/finance?${SEARCH}`, key);
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
      // У записи без связанного лида в панели нет действий внизу: пустой подвал с рамкой не рисуется.
      report(`${name}: a record without a linked lead has no empty footer strip`, (await dialog.locator('[data-slot="sheet-footer"]').count()) === 0, await dialog.locator('[data-slot="sheet-footer"]').count());
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
      // Ждём саму форму записи: у скрытых окон «Убрать» (в строках и в панели) тоже `role="dialog"` и форма, поэтому ожидание по `[role="dialog"] form`
      // кончалось ещё до щелчка, а снимок показывал просмотр записи, а не форму.
      await page.waitForSelector('[data-slot="sheet-content"] [data-testid="sales-register-form"]', { timeout: 10_000 });
      const applicant = dialog.getByLabel("Заявитель");
      report(`${name}: «Исправить запись» opens the edit form (field «Заявитель» filled) in the same panel (?edit=true), the record view is gone`,
        url(page).includes("edit=true") && (await dialog.getByTestId("sales-register-form").count()) === 1 && (await dialog.getByTestId("sales-record-preview").count()) === 0
        && (await applicant.inputValue()) === "Айжан Примерова", url(page));
      report(`${name}: the edit form has no empty footer strip either`, (await dialog.locator('[data-slot="sheet-footer"]').count()) === 0, await dialog.locator('[data-slot="sheet-footer"]').count());
      await shot(page, `report-sheet-edit-${key}`);
      // Esc в поле формы записи: первая только выводит из поля (панель, ?record=…&edit=true и набранное остаются), вторая закрывает панель.
      const draft = "Айжан Примерова-Исправленная";
      await applicant.fill(draft);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      const kept = await page.evaluate(() => ({ dialogs: document.querySelectorAll('[data-slot="sheet-content"]').length, url: location.search, onTitle: document.activeElement?.getAttribute("data-slot") === "sheet-title" }));
      const keptValue = await applicant.inputValue().catch(() => null);
      report(`${name}: the first Esc in «Заявитель» only leaves the field (panel, ?record=&edit=true and the typed text stay, focus on the title)`,
        kept.dialogs === 1 && kept.url.includes(`record=${rowId(2)}`) && kept.url.includes("edit=true") && keptValue === draft && kept.onTitle, { ...kept, value: keptValue });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[data-slot="sheet-content"]'), null, { timeout: 5000 }).catch(() => {});
      report(`${name}: the second Esc closes the panel and drops ?record= and edit=true`, kept.dialogs === 1 && !/record=|edit=/u.test(url(page)), url(page));
      report(`${name}: console clean`, errors.length === 0, errors);
      await context.close();
    }

    // 2b. Запись со связанным лидом: действие «Открыть карточку клиента» стоит в подвале панели (подвал есть, когда есть что в нём показать).
    {
      const { context, page, errors } = await open(`/finance?${SEARCH}`, "d1440");
      await rowOf(page, "d1440", "Данияр Макетов").click({ position: { x: 20, y: 8 } });
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await page.waitForSelector('[data-testid="sales-record-preview"]');
      const footer = await dialog.locator('[data-slot="sheet-footer"]').allTextContents();
      report("report sheet: a record with a linked lead keeps its footer with the action «Открыть карточку клиента»", footer.length === 1 && /Открыть карточку клиента/u.test(footer[0]), footer);
      report("report sheet with lead: console clean", errors.length === 0, errors);
      await context.close();
    }

    // 3. «Убрать» / «Вернуть» в строке: прежняя кнопка и действие, строка получает слово отказа.
    {
      const { context, page, errors } = await open(`/finance?${SEARCH}`, "d1440");
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
      // Все фильтры — на панели за кнопкой «Фильтры» рядом с поиском (15.11.2026, решение упростить отчёт), как у списков; выбранное — чипы с крестиком.
      const { context, page, errors } = await open(`/finance?${SEARCH}`, "d1440");
      const panel = page.getByRole("dialog", { name: "Фильтры" });
      const sections = await page.evaluate(() => [...document.querySelectorAll('[data-testid="sales-report-toolbar"] button, [data-testid="sales-report-toolbar"] a')].map((e) => e.textContent.trim()));
      report("report filters: one «Фильтры» button next to the search instead of a row of filter buttons", sections.length === 1 && sections[0] === "Фильтры", sections);
      await page.getByRole("button", { name: /^Фильтры/u }).click();
      const titles = await panel.locator("details > summary > span:first-child").allInnerTexts();
      report("report filters: the panel has «Менеджер», «Направление», «Сверка», «Записи»", titles.join("|") === "Менеджер|Направление|Сверка|Записи", titles);
      const manager = panel.getByTestId("list-filter-manager");
      await manager.locator("summary").click();
      await manager.getByRole("link", { name: /Айдана Макетова/u }).click();
      await page.waitForFunction(() => location.search.includes("manager=") && [...document.querySelectorAll("[data-slot=data-table] tbody tr")].filter((e) => e.getClientRects().length).length === 2, null, { timeout: 10_000 });
      const filtered = await page.evaluate(() => ({ url: location.search, rows: [...document.querySelectorAll("[data-slot=data-table] tbody tr")].filter((e) => e.getClientRects().length).length }));
      report("report filters: choosing a manager keeps the period and narrows the rows (same URL parameters)", filtered.url.includes("manager=") && filtered.url.includes("month=9") && filtered.rows === 2, filtered);
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
      const chip = page.getByRole("link", { name: "Убрать фильтр: Менеджер: Айдана Макетова" });
      report("report filters: the chosen manager stays visible on the page as a chip", await chip.isVisible(), null);
      await shot(page, "report-filter-d1440", { fullPage: true });
      await chip.click();
      await page.waitForFunction(() => !location.search.includes("manager="), null, { timeout: 10_000 });
      await page.getByRole("button", { name: /^Фильтры/u }).click();
      const review = panel.getByTestId("list-filter-review");
      await review.locator("summary").click();
      const reviewItems = (await review.getByRole("link").allInnerTexts()).map((item) => item.replace(/\s+/gu, " ").trim());
      report("report filters: «Сверка» keeps the «Нужно уточнить» count from the read", reviewItems.join("|") === "Все|Нужно уточнить 5|Сверено", reviewItems);
      await review.getByRole("link", { name: /Нужно уточнить/u }).click();
      await page.waitForFunction(() => location.search.includes("review=true"), null, { timeout: 10_000 });
      await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=data-table] tbody tr")].filter((e) => e.getClientRects().length).length === 5, null, { timeout: 10_000 });
      report("report filters: «Нужно уточнить» writes review=true and shows only flagged rows", true, url(page));
      await shot(page, "report-filter-panel-d1440");
      report("report filters: console clean", errors.length === 0, errors);
      await context.close();
    }

    // 5. Новая продажа, «Менеджеры в отчёте», «Перенос данных», план месяца, пустой результат, архив, срез.
    {
      const { context, page } = await open(`/finance?${SEARCH}&new=true`, "d1440");
      report("report new sale: the same form (its own heading and «← К отчёту») in a card of the new view", await page.evaluate(() => Boolean(document.querySelector('.v3-world[data-ui="next"] [data-testid="v3-sales-new"] form')) && document.querySelectorAll("h1").length === 1), null);
      report("report new sale: axe", (await axeOf(page, "[data-testid=v3-sales-new]")).length === 0, await axeOf(page, "[data-testid=v3-sales-new]"));
      await shot(page, "report-new-d1440");
      await context.close();
    }
    for (const [name, query, title, scope] of [["managers", `${SEARCH}&mode=managers`, "Менеджеры в отчёте", "sales-managers"], ["import", `${SEARCH}&mode=import`, "Перенос данных отчёта", "v3-sales-frame"]]) {
      for (const key of ["d1440", "m390"]) {
        const { context, page, errors } = await open(`/finance?${query}`, key);
        const frame = await page.evaluate((id) => ({ h1: document.querySelector("main h1")?.textContent?.trim(), back: Boolean(document.querySelector('main a[href^="/finance?tab=sales"]')), body: Boolean(document.querySelector(`[data-testid="${id}"]`)) || Boolean(document.querySelector("main form")),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }), scope);
        report(`report ${name} ${key}: new frame, back to the report, body, no horizontal scroll`, frame.h1 === title && frame.back && frame.body && frame.overflow <= 0, frame);
        report(`report ${name} ${key}: axe`, (await axeOf(page, "[data-testid=v3-sales-frame]")).length === 0, await axeOf(page, "[data-testid=v3-sales-frame]"));
        await shot(page, `report-${name}-${key}`, { fullPage: true });
        report(`report ${name} ${key}: console clean`, errors.length === 0, errors);
        await context.close();
      }
    }
    {
      const { context, page, errors } = await open(`/finance?${SEARCH}`, "d1440");
      await page.getByRole("button", { name: "Изменить план" }).click();
      await page.getByRole("dialog").waitFor();
      report("report plan: «Изменить план» opens the old form in a panel", (await page.getByRole("dialog").locator("form").count()) > 0, null);
      await shot(page, "report-plan-d1440");
      // Esc в поле плана: первая только выводит из поля (панель и набранное остаются), вторая закрывает панель.
      const planField = page.getByRole("dialog").locator("form input:not([type=hidden]):not([type=checkbox]):not([type=radio])").first();
      await planField.fill("41");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      const planKept = { dialogs: await page.getByRole("dialog").count(), value: await planField.inputValue().catch(() => null), onTitle: await page.evaluate(() => document.activeElement?.getAttribute("data-slot") === "sheet-title") };
      report("report plan: the first Esc in the plan field only leaves the field (panel and typed value stay, focus on the title)", planKept.dialogs === 1 && planKept.value === "41" && planKept.onTitle, planKept);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      report("report plan: the second Esc closes the panel", planKept.dialogs === 1 && (await page.getByRole("dialog").count()) === 0, null);
      await context.close();
      const empty = await open(`/finance?${SEARCH}&q=нет-такого-имени`, "d1440");
      report("report empty: no rows says so and offers «Сбросить фильтры»", /По выбранным фильтрам записей не найдено\./u.test(await empty.page.locator("main").textContent()) && (await empty.page.getByRole("link", { name: "Сбросить фильтры" }).count()) > 0, null);
      await empty.context.close();
      const archive = await open(`/finance?${SEARCH}&archived=true`, "d1440");
      report("report archive: a sentence instead of sums, no «Остаток» column", /Архивные записи не входят в рабочие итоги/u.test(await archive.page.locator("main").textContent()) && (await archive.page.getByRole("columnheader", { name: /Остаток/u }).count()) === 0, null);
      await shot(archive.page, "report-archive-d1440");
      await archive.context.close();
      const slice = await open(`/finance?${SEARCH}&sale=undated`, "d1440");
      report("report slice: «без даты продажи» shows the slice sentence with a way back", /Записи без даты продажи/u.test(await slice.page.locator("main").textContent()) && (await slice.page.getByRole("link", { name: "Все записи периода" }).count()) > 0, null);
      await slice.context.close();
      report("report plan/empty/archive/slice: console clean", errors.length === 0, errors);
    }

    // 6. Другие миры: сотрудник видит тот же новый вид (корень с data-ui, таблица набора) и ровно одну вкладку «Отчёт продаж»;
    //    просмотр роли — «Нет доступа» (решение владельца 06.11.2026): ни таблицы, ни вкладок.
    for (const [label, options] of [["staff", { actor: "staff" }], ["preview", { actor: "preview" }]]) {
      const { context, page } = await open(`/finance?${SEARCH}`, "d1440", options);
      const world = await page.evaluate(() => ({
        nextRoot: Boolean(document.querySelector('.v3-world[data-ui="next"]')), table: Boolean(document.querySelector('[data-slot="data-table"]')),
        denied: Boolean(document.querySelector('[data-testid="v3-finance-denied"]')),
        tabs: [...document.querySelectorAll('[data-testid="queue-view-tabs"] a')].map((link) => link.textContent.trim()),
      }));
      const expected = label === "staff" ? world.nextRoot && world.table && !world.denied && world.tabs.join() === "Отчёт продаж" : world.nextRoot && !world.table && world.denied && world.tabs.length === 0;
      report(`${label}: ${label === "staff" ? "new view root, kit table and the single tab «Отчёт продаж»" : "«Нет доступа»: no table and no tabs"}`, expected, world);
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
