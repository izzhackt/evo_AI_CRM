"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Пути «Нового вида» для стенда `students-next-static-render.cjs`, которые независимая проверка потока (27.10.2026) нашла нерабочими
 * (PLAN_CHANGES, «Новый вид»: исправления потока students): «+ Задача» в панели, Esc в панели, стрелки и j/k в списках, фокус после
 * Esc в «Нагрузке кураторов», «Сигналы» на телефоне, шапка карточки «Управления каталогом» на узких экранах, цели 44 px в панелях и
 * дата «Проверено» у давно не проверявшейся карточки. Каждый путь получает `tools` (`open`, `shot`, `report`, …) и печатает проверки.
 */

const { pressRow, pushes, calls } = require("./students-next-journeys.cjs");

const AIDANA = "Айдана Сыдыкова";
const sheet = (page) => page.locator("[data-slot=sheet-content]");

/** Ключи строк с видимой ссылкой `data-queue-open`, в порядке показа. */
const rowKeys = (page) => page.evaluate(() => [...document.querySelectorAll("[data-queue-row] [data-queue-open]")]
  .filter((element) => element.getClientRects().length > 0).map((element) => element.closest("[data-queue-row]").getAttribute("data-queue-row")));
const focusedRow = (page) => page.evaluate(() => document.activeElement?.closest?.("[data-queue-row]")?.getAttribute("data-queue-row") ?? null);
const blur = (page) => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
const insideSheet = (page) => page.evaluate(() => Boolean(document.activeElement?.closest("[data-slot=sheet-content]")));
const onTitle = (page) => page.evaluate(() => Boolean(document.activeElement?.matches("[data-slot=sheet-title]")));
const onSearch = (page) => page.evaluate(() => Boolean(document.activeElement?.matches("[data-queue-search]")));
/** Нажать клавишу и вернуть место строки с фокусом в списке (-1 — фокус не на строке списка). */
async function press(page, key) {
  await page.keyboard.press(key);
  return (await rowKeys(page)).indexOf(await focusedRow(page));
}

/**
 * Цели нажатия меньше 44 px в панели; исключения те же, что у проверки страницы (названия-ссылки накрывают ячейку, «?» растёт
 * псевдоэлементом) и прежние части на CSS-модуле (`.root`, «Скачать файл», «Сохранить решение»): стенд подставляет модулю имена
 * классов без стилей, их 44 px (`min-height` в `ProgramDocuments.module.css`) он не видит.
 */
const smallTargets = (page, scope) => page.evaluate((query) => {
  const root = document.querySelector(query);
  const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden" && element.checkVisibility(); };
  return root ? [...root.querySelectorAll("a, button, input:not([type=checkbox]):not([type=radio]), select, textarea, summary")]
    .filter((element) => visible(element) && !element.matches("[aria-label^=Пояснение], [data-queue-open], [role=switch], [role=checkbox]") && !element.closest(".root"))
    .map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 40), h: Math.round(element.getBoundingClientRect().height) }))
    .filter((box) => box.h < 44) : [{ text: "нет панели", h: 0 }];
}, scope);

/** Сломанный путь не обрывает весь прогон: исключение — проваленная проверка с первой строкой причины, дальше идут остальные. */
async function guarded(report, check, run) {
  try { await run(); } catch (error) { report(check, false, String(error.message).split("\n")[0]); }
}
/** Страница с коротким ожиданием: нерабочий путь падает за секунды, а не за полминуты. */
const quick = (open) => async (...args) => { const opened = await open(...args); opened.page.setDefaultTimeout(8000); return opened; };

const journeys = [
  // «+ Задача» в панели дела: панель закрывается, диалог оболочки открывается над списком, и в нём работают мышь и кнопки.
  async ({ open: openPage, shot, report }) => {
    const open = quick(openPage);
    for (const view of ["d1280", "m390"]) {
      await guarded(report, `queue ${view}: «+ Задача» in the panel`, async () => {
        const label = `queue ${view}`;
        const { context, page, errors } = await open("queue", view);
        await pressRow(page, view, AIDANA);
        await sheet(page).waitFor();
        await page.getByRole("link", { name: "+ Задача", exact: true }).click();
        const composer = page.getByTestId("v3-task-composer-dialog");
        await composer.waitFor();
        await sheet(page).waitFor({ state: "detached" });
        const state = await page.evaluate(() => {
          const dialog = document.querySelector("[data-testid=v3-task-composer-dialog]");
          const hit = (element) => { const box = element.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element; };
          const cancel = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "Отмена");
          return {
            body: getComputedStyle(document.body).pointerEvents, dialog: getComputedStyle(dialog).pointerEvents,
            hidden: Boolean(dialog.closest("[aria-hidden=true],[inert]")), fieldHit: hit(dialog.querySelector("input[name=title]")), cancelHit: hit(cancel), text: dialog.innerText,
          };
        });
        report(`${label}: «+ Задача» closes the panel and opens the shell composer over the list`, await composer.evaluate((element) => element.open), null);
        report(`${label}: the composer takes the pointer and is not hidden from readers`, state.body !== "none" && state.dialog !== "none" && !state.hidden && state.fieldHit && state.cancelHit, { ...state, text: undefined });
        report(`${label}: the composer keeps the case of the panel, fixed`, /Студент: Айдана Сыдыкова/u.test(state.text) && !/Без дела/u.test(state.text), state.text.slice(0, 120));
        await composer.locator("input[name=title]").click();
        await page.keyboard.type("Позвонить маме Айданы");
        await shot(page, `queue-composer-from-panel-${view}`);
        await composer.getByRole("button", { name: "Создать задачу", exact: true }).click();
        await page.waitForFunction(() => window.__harness.calls.some((call) => Array.isArray(call) && call[0] === "createPlatformAdmissionsTaskAction"));
        const created = (await calls(page)).find((call) => Array.isArray(call) && call[0] === "createPlatformAdmissionsTaskAction")[1];
        report(`${label}: «Создать задачу» creates the task for that case with the typed title`, created.student_case_id === "cccccccc-2222-4222-8222-000000000001" && created.title === "Позвонить маме Айданы", created);
        await composer.getByRole("button", { name: "Готово", exact: true }).click();
        await composer.waitFor({ state: "detached" });
        await page.waitForTimeout(150);
        report(`${label}: after the composer closes focus returns to the row link`, await page.evaluate(() => Boolean(document.activeElement?.matches("[data-queue-open]"))), null);
        report(`${label}: no browser errors (composer from the panel)`, errors.length === 0, errors);
        await context.close();
      });
    }
    // «Отмена» тоже нажимается мышью с первого раза.
    await guarded(report, "queue d1280: «Отмена» of the composer closes it at the first click", async () => {
      const { context, page } = await open("queue", "d1280");
      await pressRow(page, "d1280", AIDANA);
      await sheet(page).waitFor();
      await page.getByRole("link", { name: "+ Задача", exact: true }).click();
      await page.getByTestId("v3-task-composer-dialog").getByRole("button", { name: "Отмена", exact: true }).click();
      await page.getByTestId("v3-task-composer-dialog").waitFor({ state: "detached" });
      report("queue d1280: «Отмена» of the composer closes it at the first click", true, null);
      await context.close();
    });
  },

  // Esc в панели: в поле — выйти из поля (текст остаётся), «Завершить дело» закрывается одно, а панель остаётся.
  async ({ open: openPage, report }) => {
    const open = quick(openPage);
    for (const view of ["d1280", "m390"]) {
      await guarded(report, `queue ${view}: Esc in the step field`, async () => {
        const { context, page } = await open("queue", view);
        await pressRow(page, view, AIDANA);
        await sheet(page).waitFor();
        const field = page.getByRole("textbox", { name: "Шаг" });
        await field.fill("Позвонить в посольство");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);
        report(`queue ${view}: the first Esc in the step field only leaves the field, the panel and the typed text stay`,
          (await sheet(page).count()) === 1 && (await onTitle(page)) && (await field.inputValue()) === "Позвонить в посольство" && (await pushes(page)).length === 1, await pushes(page));
        await page.keyboard.press("Escape");
        await sheet(page).waitFor({ state: "detached" });
        report(`queue ${view}: the second Esc closes the panel`, !/open=/u.test((await pushes(page)).at(-1) ?? ""), await pushes(page));
        await context.close();
      });
      await guarded(report, `queue ${view}: Esc in «Завершить дело»`, async () => {
        const { context, page } = await open("queue", view);
        await pressRow(page, view, AIDANA);
        await sheet(page).waitFor();
        await page.getByRole("button", { name: /Завершить дело/u }).click();
        const confirm = page.getByTestId("v3-close-case-dialog");
        await confirm.waitFor();
        await page.keyboard.press("Escape");
        await confirm.waitFor({ state: "detached" });
        await page.waitForTimeout(250);
        report(`queue ${view}: Esc in «Завершить дело» closes only the confirmation`, (await sheet(page).count()) === 1 && (await pushes(page)).length === 1, await pushes(page));
        await context.close();
      });
    }
    await guarded(report, "curators d1280: Esc in the replacement form", async () => {
      const { context, page } = await open("curators", "d1280");
      await pressRow(page, "d1280", "Эрмек Токтосунов", 0);
      await sheet(page).waitFor();
      await page.locator("[data-slot=sheet-content] details:has(select)").evaluate((element) => { element.open = true; });
      await page.locator("[data-slot=sheet-content] select").first().focus();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      report("curators d1280: Esc in a field of the replacement form leaves the field, the panel stays", (await sheet(page).count()) === 1 && (await onTitle(page)), await pushes(page));
      await context.close();
    });
    await guarded(report, "docs-program d1280: Esc in the decision form", async () => {
      const { context, page } = await open("docs-program", "d1280");
      await pressRow(page, "d1280", AIDANA, 1);
      await sheet(page).waitFor();
      await page.locator("details summary").click();
      await page.locator("[data-slot=sheet-content] select").first().focus();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      report("docs-program d1280: Esc in the decision field leaves the field, the panel stays", (await sheet(page).count()) === 1 && (await onTitle(page)), null);
      await page.keyboard.press("Escape");
      await sheet(page).waitFor({ state: "detached" });
      report("docs-program d1280: the second Esc closes the panel", true, null);
      await context.close();
    });
  },

  // Клавиши списка: ↑/↓ и j/k по строкам, «/» — поиск; в «Студентах», в EVO Docs (дела, «Документы программ», «Комплекты») и в «Нагрузке кураторов».
  async ({ open: openPage, report }) => {
    const open = quick(openPage);
    await guarded(report, "queue d1280: list keys", async () => {
      const { context, page } = await open("queue", "d1280");
      await blur(page);
      const walk = [await press(page, "ArrowDown"), await press(page, "ArrowDown"), await press(page, "ArrowDown"), await press(page, "ArrowUp")];
      report("queue d1280: ArrowDown/ArrowUp walk the rows from the page and from a row link", walk.join() === "0,1,2,1", walk);
      await blur(page);
      await page.keyboard.press("/");
      report("queue d1280: «/» focuses the list search", await onSearch(page), null);
      await context.close();
    });
    for (const name of ["docs-review", "docs-all"]) {
      await guarded(report, `${name} d1280: list keys`, async () => {
        const { context, page } = await open(name, "d1280");
        await blur(page);
        const keys = [await press(page, "j"), await press(page, "j"), await press(page, "k"), await press(page, "ArrowDown")];
        report(`${name} d1280: j/k and ArrowDown walk the case rows`, keys.join() === "0,1,0,1", keys);
        await blur(page);
        await page.keyboard.press("/");
        report(`${name} d1280: «/» focuses the case search`, await onSearch(page), null);
        await context.close();
      });
    }
    await guarded(report, "docs-program d1280: list keys", async () => {
      const { context, page } = await open("docs-program", "d1280");
      await blur(page);
      const first = await press(page, "j");
      await page.keyboard.press("Enter");
      await sheet(page).waitFor();
      report("docs-program d1280: j focuses a document row and Enter opens its panel", first === 0 && (await insideSheet(page)), first);
      await page.keyboard.press("j");
      report("docs-program d1280: with the panel open j stays in the panel", await insideSheet(page), null);
      await context.close();
    });
    await guarded(report, "docs-packages d1280: list keys", async () => {
      const { context, page } = await open("docs-packages", "d1280");
      await blur(page);
      const pair = [await press(page, "j"), await press(page, "j")];
      await page.keyboard.press("Enter");
      report("docs-packages d1280: j walks the package rows and Enter opens the preparation", pair.join() === "0,1" && /tab=route.*#preparation-/u.test((await pushes(page)).at(-1) ?? ""), { pair, pushes: await pushes(page) });
      await context.close();
    });
    await guarded(report, "curators d1280: list keys", async () => {
      const { context, page } = await open("curators", "d1280");
      await blur(page);
      const steps = [await press(page, "j"), await press(page, "j"), await press(page, "k"), await press(page, "ArrowDown")];
      report("curators d1280: j/k and ArrowDown walk the curator rows", steps.join() === "0,1,0,1", steps);
      await page.keyboard.press("Enter");
      await sheet(page).waitFor();
      await page.keyboard.press("j");
      report("curators d1280: with the panel open j stays in the panel", await insideSheet(page), null);
      await context.close();
    });
  },

  // «Нагрузка кураторов»: Esc возвращает фокус на ссылку куратора (клавиатура, щелчок по строке, касание карточки).
  async ({ open: openPage, report }) => {
    const open = quick(openPage);
    for (const view of ["d1280", "m390"]) {
      for (const how of ["keyboard", "press"]) {
        await guarded(report, `curators ${view}: Esc returns focus (${how})`, async () => {
          const { context, page } = await open("curators", view);
          const link = page.locator("[data-queue-open]:visible").filter({ hasText: "Эрмек Токтосунов" }).first();
          await link.evaluate((element) => { element.dataset.probe = "1"; });
          if (how === "keyboard") { await link.focus(); await page.keyboard.press("Enter"); } else await pressRow(page, view, "Эрмек Токтосунов", 0);
          await sheet(page).waitFor();
          await page.keyboard.press("Escape");
          await sheet(page).waitFor({ state: "detached" });
          await page.waitForTimeout(150);
          report(`curators ${view}: after Esc focus returns to the same curator link (${how})`, await page.evaluate(() => document.activeElement?.dataset.probe === "1"), await page.evaluate(() => document.activeElement?.tagName));
          await context.close();
        });
      }
    }
  },

  // Телефон: «Сигналы» (просрочки, документы, «нужен ответ») видны в карточках всех видов так же, как в таблице.
  async ({ open: openPage, report }) => {
    const open = quick(openPage);
    const signals = (page, view) => page.evaluate((mode) => {
      const texts = [];
      if (mode === "m390") {
        for (const row of document.querySelectorAll("[data-slot=data-table-cards] dl > div")) {
          if (row.querySelector("dt")?.textContent.trim() === "Сигналы") texts.push(...[...row.querySelectorAll("dd [data-slot=badge]")].map((badge) => badge.textContent.trim()));
        }
      } else {
        const index = [...document.querySelectorAll("thead th")].findIndex((head) => head.textContent.includes("Сигналы"));
        for (const row of document.querySelectorAll("tbody tr")) texts.push(...[...(row.children[index]?.querySelectorAll("[data-slot=badge]") ?? [])].map((badge) => badge.textContent.trim()));
      }
      return texts.sort();
    }, view);
    for (const name of ["queue", "needs-action", "updated", "state-closed", "mine"]) {
      await guarded(report, `${name} m390: signals on the cards`, async () => {
        const wide = await open(name, "d1280");
        const onTable = await signals(wide.page, "d1280");
        await wide.context.close();
        const phone = await open(name, "m390");
        const onCards = await signals(phone.page, "m390");
        await phone.context.close();
        report(`${name} m390: every risk signal of the table is on the phone cards (${onTable.length})`, onTable.length > 0 && onTable.join("|") === onCards.join("|"), { table: onTable, cards: onCards });
      });
    }
  },

  // «Управление каталогом»: заголовок карточки с действием не накрывается кнопкой на узких экранах.
  async ({ open: openPage, report }) => {
    const open = quick(openPage);
    for (const view of ["m390", "m360", "m320", "d1280"]) {
      await guarded(report, `uni-manage ${view}: card header`, async () => {
        const { context, page } = await open("uni-manage", view);
        const box = await page.evaluate(() => {
          const heading = [...document.querySelectorAll("main h2")].find((element) => /Подготовленные сведения/u.test(element.textContent));
          const header = heading.closest("[data-slot=card-header]");
          const card = heading.closest("[data-slot=card]").getBoundingClientRect();
          const action = header.querySelector("[data-slot=card-action] a, [data-slot=card-action] button").getBoundingClientRect();
          const help = header.querySelector("[aria-label^=Пояснение]").getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(heading);
          const words = [...range.getClientRects()].filter((rect) => rect.width > 0);
          const meets = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          return {
            titleUnderAction: words.some((rect) => meets(rect, action)), titleUnderHelp: words.some((rect) => meets(rect, help)),
            clipped: heading.scrollWidth > heading.clientWidth + 1, actionInside: action.left >= card.left && action.right <= card.right,
          };
        });
        report(`uni-manage ${view}: the card title is readable, not under the action or the «?»`, !box.titleUnderAction && !box.titleUnderHelp && !box.clipped && box.actionInside, box);
        await context.close();
      });
    }
  },

  // Цели нажатия в панелях — не меньше 44 px (раньше проверялась только страница под панелью).
  async ({ open: openPage, report }) => {
    const open = quick(openPage);
    for (const view of ["d1280", "m390"]) {
      for (const [name, text, cell, label] of [["queue", AIDANA, 1, "the case panel"], ["curators", "Эрмек Токтосунов", 0, "the curator panel"], ["docs-program", AIDANA, 1, "the document panel"]]) {
        await guarded(report, `${name} ${view}: targets in ${label}`, async () => {
          const { context, page } = await open(name, view);
          await pressRow(page, view, text, view === "m390" ? 0 : cell);
          await sheet(page).waitFor();
          const small = await smallTargets(page, "[data-slot=sheet-content]");
          report(`${name} ${view}: targets in ${label} >= 44px`, small.length === 0, small);
          await context.close();
        });
      }
    }
  },

  // Университеты: у давно не проверявшейся карточки машинная дата — ISO, на экране — день.
  async ({ open: openPage, report }) => {
    const open = quick(openPage);
    await guarded(report, "uni-stale d1280: stale card date", async () => {
      const { context, page } = await open("uni-stale", "d1280");
      const stale = await page.evaluate(() => [...document.querySelectorAll("[data-university-row] time")].map((time) => ({ attr: time.getAttribute("datetime"), text: time.textContent.trim() }))
        .filter((time) => /^\d\d\.\d\d(\.\d\d)?$/u.test(time.text)));
      report("uni-stale d1280: a card checked long ago shows the day, and its machine date is ISO", stale.length > 0 && stale.every((time) => /^\d{4}-\d\d-\d\d$/u.test(time.attr)), stale.slice(0, 3));
      await context.close();
    });
  },
];

module.exports = { journeys };
