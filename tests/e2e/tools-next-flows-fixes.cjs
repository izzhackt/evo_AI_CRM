"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Сценарии `tools-next-static-render.cjs`, добавленные по независимой проверке потока «tools» (27.10.2026, одиннадцать замечаний).
 * Каждый сценарий воспроизводит замечание на настоящих компонентах нового вида и синтетике; до правки они не проходили.
 * Серверный ответ стенда — вытесняющий (как у Next 16: доходит последняя навигация), задержка задаётся `window.__harness.delay`.
 */

const fx = require("./tools-next-fixtures.cjs");

const calls = (page) => page.evaluate(() => window.__harness.calls);
const pushes = (page) => page.evaluate(() => window.__harness.pushes);
const rowOf = (page, key, text) => (key === "m390"
  ? page.locator("[data-slot=data-table-cards] > li").filter({ hasText: text }).first()
  : page.locator("tbody tr").filter({ hasText: text }).first());
async function clickRow(page, key, row, cell = 1) {
  if (key === "m390") await row.locator("[data-card-open]").click({ position: { x: 6, y: 6 } });
  else await row.locator("td").nth(cell).click();
}
const active = (page) => page.evaluate(() => {
  const element = document.activeElement;
  return { tag: element?.tagName, type: element?.getAttribute("type"), role: element?.getAttribute("role"), aria: element?.getAttribute("aria-current"), name: element?.getAttribute("aria-label"), text: (element?.textContent ?? "").trim().slice(0, 60) };
});

/* 1. Ссылка из «Материалов CRM» на шаблон: `#reply-snippet-<id>` открывает панель этого шаблона, даже со второй страницы таблицы. */
const snippetLink = {
  name: "snippet-link",
  async run({ open, report }) {
    for (const key of ["d1280", "m390"]) {
      const label = `snippets ${key}`;
      const { context, page, errors } = await open("snippets-deep", key);
      const dialog = page.getByRole("dialog");
      const shown = await dialog.waitFor({ timeout: 2500 }).then(() => true, () => false);
      const text = shown ? await dialog.innerText() : "";
      report(`${label}: #reply-snippet-<id> of a snippet beyond the first page opens its panel`, shown && /Итоговое напоминание о подписании/u.test(text), text.slice(0, 80));
      if (shown) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        report(`${label}: the target is not on the first page, and Esc closes the panel without reopening it`, (await dialog.count()) === 0 && (await rowOf(page, key, "Итоговое напоминание").count()) === 0, null);
      }
      report(`${label}: console clean`, errors.length === 0, errors);
      await context.close();
    }
    // Адрес меняется при открытой странице: hashchange открывает панель нужного шаблона; чужой и пустой адрес ничего не открывают.
    const { context, page } = await open("snippets", "d1280");
    await page.evaluate((id) => { window.location.hash = `#reply-snippet-${id}`; }, fx.id("99999999", 3));
    const changed = await page.getByRole("dialog").waitFor({ timeout: 2500 }).then(() => true, () => false);
    report("snippets d1280: hashchange to a snippet opens its panel", changed && /Напоминание о сроке подачи/u.test(await page.getByRole("dialog").innerText()), null);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.location.hash = "#reply-snippet-00000000-0000-4000-8000-000000000000"; });
    await page.waitForTimeout(250);
    report("snippets d1280: an unknown snippet in the address opens nothing", (await page.getByRole("dialog").count()) === 0, null);
    await context.close();
  },
};

/* 2. Календарь: Esc на задаче, которая ещё грузится, не возвращает ранее закрытую задачу. */
const calendarEsc = {
  name: "calendar-esc",
  async run({ open, report }) {
    const chipB = `case:${fx.id("cccccccc", 42)}`;
    for (const key of ["d1280", "m390"]) {
      const label = `calendar ${key}`;
      const { context, page, errors } = await open("calendar-panel", key);
      await page.getByRole("dialog").waitFor();
      await page.evaluate(() => { window.__harness.delay = 700; });
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.locator(`[id="${key === "m390" ? "list-task" : "task"}-${chipB}"]`).click();
      await page.getByRole("dialog").waitFor();
      const loading = await page.getByRole("dialog").innerText();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      const reopened = await page.getByRole("dialog").count();
      const title = reopened ? (await page.getByRole("dialog").innerText()).slice(0, 60) : "";
      report(`${label}: Esc on a task that is still loading closes the panel (the earlier task does not come back)`, reopened === 0 && /Собрать апостиль/u.test(loading), [loading.slice(0, 40), title]);
      await page.waitForTimeout(1000);
      const last = (await pushes(page)).at(-1) ?? "";
      report(`${label}: the panel stays closed after the server answers and the address has no task`, (await page.getByRole("dialog").count()) === 0 && !last.includes("task="), last);
      report(`${label}: console clean`, errors.length === 0, errors);
      await context.close();
    }
  },
};

/* 3. «Выбрать все» есть на любой ширине (на телефоне — над карточками), «Тип» виден, столбец выбора узкий и одной ширины. */
const selection = {
  name: "selection",
  async run({ open, report }) {
    const rows = [["knowledge-folder", "Выбрать показанные материалы", 5], ["documents-folder", "Выбрать документы на экране", 2]];
    for (const [name, label, expected] of rows) {
      for (const key of ["d1280", "m390"]) {
        const { context, page, errors } = await open(name, key);
        const box = page.getByRole("checkbox", { name: label });
        report(`${name} ${key}: exactly one visible «${label}»`, (await box.count()) === 1, await box.count());
        if ((await box.count()) === 1) {
          await box.click({ force: true });
          const picked = name === "knowledge-folder" ? await page.getByTestId("knowledge-selection").innerText().catch(() => "") : await page.getByText(/Выбрано: \d+/u).first().innerText().catch(() => "");
          report(`${name} ${key}: it selects every shown row (${expected})`, new RegExp(`Выбрано: ${expected}\\b`, "u").test(picked), picked);
          await box.click({ force: true });
          await page.waitForTimeout(100);
          report(`${name} ${key}: pressed again it clears the selection`, (await page.getByText(/Выбрано: \d+/u).count()) === 0, null);
          if (key === "m390") {
            const target = await box.evaluate((element) => element.closest("label")?.getBoundingClientRect().height ?? 0);
            report(`${name} ${key}: the phone select-all has a 44 px target with a visible label`, target >= 44, target);
          }
        }
        report(`${name} ${key}: console clean`, errors.length === 0, errors);
        await context.close();
      }
    }
    for (const [name, key] of [["knowledge-folder", "d1440"], ["knowledge-folder", "d1280"], ["knowledge-root", "d1280"]]) {
      const { context, page } = await open(name, key);
      // `innerText` скрытого элемента равен его тексту: берём только то, что на экране.
      const heads = await page.locator("thead th:visible").allInnerTexts();
      const kinds = await page.locator("tbody tr").first().locator("td:visible").allInnerTexts();
      report(`${name} ${key}: the «Тип» column is shown and says what each record is`, heads.some((head) => head.trim() === "Тип") && kinds.some((cell) => /Папка|Страница|Файл|Доступ/u.test(cell)), [heads, kinds]);
      await context.close();
    }
    const widths = [];
    for (const [name, key] of [["knowledge-clients", "d1440"], ["knowledge-root", "d1440"], ["documents-folder", "d1440"], ["knowledge-folder", "d1440"], ["documents-folder", "d1280"], ["knowledge-folder", "d1280"]]) {
      const { context, page } = await open(name, key);
      widths.push([`${name} ${key}`, await page.locator("thead th:has([role=checkbox])").first().evaluate((element) => Math.round(element.getBoundingClientRect().width))]);
      await context.close();
    }
    const spread = Math.max(...widths.map((row) => row[1])) - Math.min(...widths.map((row) => row[1]));
    report("select column keeps one narrow width on every screen (no dead gap)", Math.max(...widths.map((row) => row[1])) <= 44 && spread <= 4, widths);
    // Корень «Документов» — одни папки: выбирать и скачивать нечего, поэтому ни отключённого флажка, ни пустой колонки «Скачать».
    for (const key of ["d1440", "d1280"]) {
      const { context, page } = await open("documents", key);
      const heads = await page.locator("thead th:visible").allInnerTexts();
      const disabled = await page.locator("thead [role=checkbox]").count();
      report(`documents ${key}: the root of folders has neither a select-all nor an empty download column`, disabled === 0 && JSON.stringify(heads.map((head) => head.trim())) === JSON.stringify(["Документ", "Размер"]), [heads, disabled]);
      await context.close();
    }
  },
};

/* 4. Автор шаблона виден в панели у того, кто управляет (в том числе когда колонка «Автор» скрыта по ширине). */
const author = {
  name: "snippet-author",
  async run({ open, report }) {
    for (const key of ["d1280", "m390"]) {
      const { context, page } = await open("snippets", key);
      await clickRow(page, key, rowOf(page, key, "Документы для визы X1"), 1);
      await page.getByRole("dialog").waitFor();
      const editable = await page.getByRole("dialog").innerText();
      report(`snippets ${key}: the panel of an editable snippet names its author`, /Автор: Айгерим Макетова/u.test(editable) && /Сохранить/u.test(editable), editable.slice(0, 120));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      await clickRow(page, key, rowOf(page, key, "Стоимость обучения"), 1);
      await page.getByRole("dialog").waitFor();
      report(`snippets ${key}: the panel of a read-only snippet still names its author`, /Автор: Тимур Образцов/u.test(await page.getByRole("dialog").innerText()), null);
      await context.close();
    }
  },
};

/* 5. Фокус: открытие подпапки и путь, вопрос перед удалением/архивом в панели. */
const focus = {
  name: "focus",
  async run({ open, report }) {
    for (const key of ["d1440", "m390"]) {
      const label = `documents ${key}`;
      const { context, page } = await open("documents-folder", key);
      await page.getByRole("button", { name: "Открыть: Договоры 2026" }).focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(80);
      const row = await active(page);
      report(`${label}: opening a subfolder moves focus to the current crumb, not to <body>`, row.aria === "page" && row.text === "Договоры 2026", row);
      const crumbs = page.getByRole("navigation", { name: "Путь к папке" });
      await crumbs.getByRole("button", { name: "Компания", exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(80);
      const crumb = await active(page);
      report(`${label}: pressing a crumb keeps focus on the path (the new current crumb)`, crumb.aria === "page" && crumb.text === "Компания", crumb);
      await crumbs.getByRole("button", { name: "Документы", exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(80);
      const root = await active(page);
      // Таблица на телефоне скрыта: там фокус встаёт на первую карточку списка.
      report(`${label}: going to the root puts focus in the list (the table, on a phone its first card)`, key === "m390" ? root.tag === "BUTTON" && /^Открыть: /u.test(root.name ?? "") : root.role === "region" && root.name === "Таблица документов", root);
      await context.close();
    }
    const documents = await open("documents-folder", "d1440");
    const p = documents.page;
    await clickRow(p, "d1440", rowOf(p, "d1440", "Договор — образец"), 2);
    await p.getByRole("dialog").waitFor();
    await p.getByRole("dialog").getByRole("button", { name: "Удалить файл", exact: true }).focus();
    await p.keyboard.press("Enter");
    const confirm = await active(p);
    const described = await p.evaluate(() => { const id = document.activeElement?.getAttribute("aria-describedby"); return id ? document.getElementById(id)?.textContent ?? "" : ""; });
    report("documents d1440: «Удалить файл» puts focus on «Да, удалить», which is described by the question", confirm.tag === "BUTTON" && /Да, удалить/u.test(confirm.text) && /Удалить «Договор — образец\.pdf»\?/u.test(described), [confirm, described]);
    await p.keyboard.press("Tab");
    await p.keyboard.press("Enter");
    const back = await active(p);
    report("documents d1440: «Отмена» returns focus to «Удалить файл»", back.tag === "BUTTON" && back.text === "Удалить файл", back);
    await documents.context.close();
    const snippets = await open("snippets", "d1280");
    const s = snippets.page;
    await clickRow(s, "d1280", rowOf(s, "d1280", "Документы для визы X1"), 1);
    await s.getByRole("dialog").waitFor();
    await s.getByRole("dialog").getByRole("button", { name: "Архивировать", exact: true }).focus();
    await s.keyboard.press("Enter");
    const ask = await active(s);
    report("snippets d1280: «Архивировать» puts focus on the confirming «Архивировать»", ask.tag === "BUTTON" && ask.type === "submit" && ask.text === "Архивировать", ask);
    await s.keyboard.press("Tab");
    await s.keyboard.press("Enter");
    const cancelled = await active(s);
    report("snippets d1280: «Отмена» returns focus to the first «Архивировать»", cancelled.tag === "BUTTON" && cancelled.type === "button" && cancelled.text === "Архивировать", cancelled);
    await snippets.context.close();
  },
};

/* 6. «Новая папка» / «Новый файл»: после сохранения страница читает заново, панель закрывается, а не остаётся с пустой формой. */
const createSheets = {
  name: "create-sheets",
  async run({ open, report }) {
    for (const key of ["d1280", "m390"]) {
      for (const [button, field, action] of [["Новая папка", "Название папки", "createPlatformCompanyFileFolderAction"], ["Новый файл", "Название файла", "createPlatformCompanyFileAction"]]) {
        const { context, page, errors } = await open("documents-refresh", key);
        await page.getByRole("button", { name: button, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        await dialog.getByLabel(field).fill("Проверка");
        await dialog.getByRole("button", { name: "Создать", exact: true }).click();
        const closed = await dialog.waitFor({ state: "detached", timeout: 2000 }).then(() => true, () => false);
        const sent = (await calls(page)).some((entry) => Array.isArray(entry) && entry[0] === action);
        report(`documents ${key}: «${button}» sends the command and the panel closes once the page is refreshed`, sent && closed, { sent, closed });
        report(`documents ${key}: «${button}» console clean`, errors.length === 0, errors);
        await context.close();
      }
    }
  },
};

/* 7. Подписи: число записей папки стоит под её названием, а не в колонке «Размер»; размер в панели файла студента один раз. */
const copy = {
  name: "copy",
  async run({ open, report }) {
    for (const key of ["d1280", "m390"]) {
      const { context, page } = await open("documents", key);
      const folderRow = rowOf(page, key, "Компания");
      const row = await folderRow.innerText();
      // Таблица: колонка «Размер» у папки пуста; карточка телефона: нет строки «Размер — N записей».
      const sizeColumn = key === "m390" ? -1 : (await page.locator("thead th:visible").allInnerTexts()).findIndex((head) => head.trim() === "Размер");
      const sizeCell = key === "m390" ? "" : sizeColumn < 0 ? "no «Размер» column" : (await folderRow.locator("td:visible").nth(sizeColumn).innerText()).trim();
      report(`documents ${key}: a folder row says its record count once under the name and has no «Размер» for it`, /\d+ (запись|записи|записей)/u.test(row) && !/Размер/u.test(row) && (row.match(/\d+ (запись|записи|записей)/gu) ?? []).length === 1 && sizeCell === "", [row, sizeCell]);
      await context.close();
      const student = await open("documents-student", key);
      await clickRow(student.page, key, rowOf(student.page, key, "Аттестат — скан.pdf"), 2);
      await student.page.getByRole("dialog").waitFor();
      const text = await student.page.getByRole("dialog").innerText();
      report(`documents ${key}: the panel of a student file shows its size once`, (text.match(/2,1 МБ/gu) ?? []).length === 1 && !/Размер:/u.test(text), text);
      await student.context.close();
    }
  },
};

/* 8. Телефон: открытая переписка занимает всё место между верхней панелью и вкладками; список каналов остаётся в рамке. */
const chatPhone = {
  name: "chat-phone",
  async run({ open, report }) {
    const measure = (page) => page.evaluate(() => {
      const card = document.querySelector("[data-frame=card]").parentElement;
      const frame = card.getBoundingClientRect();
      return { radius: getComputedStyle(card).borderTopLeftRadius, border: getComputedStyle(card).borderTopWidth, top: Math.round(frame.top), mainTop: Math.round(document.querySelector("main").getBoundingClientRect().top), left: Math.round(frame.left), right: Math.round(frame.right), width: window.innerWidth, panel: document.querySelector("[data-panel]")?.getAttribute("data-panel") };
    });
    const { context, page } = await open("chat-channels", "m390");
    const list = await measure(page);
    report("chat m390: the channel list keeps its card frame", list.left === 16 && list.right === list.width - 16 && list.top > list.mainTop && list.radius === "10px", list);
    await page.getByRole("link", { name: /Общий/u }).first().click();
    await page.waitForTimeout(150);
    const chat = await measure(page);
    report("chat m390: the open conversation starts right under the top bar and spans the window (no blank band, no inset frame)", chat.panel === "messages" && chat.top === chat.mainTop && chat.left === 0 && chat.right === chat.width && chat.radius === "0px" && chat.border === "0px", chat);
    await context.close();
    const wide = await open("chat", "d1280");
    const desktop = await measure(wide.page);
    report("chat d1280: the card frame stays on the desktop", desktop.left > 0 && desktop.top > desktop.mainTop, desktop);
    await wide.context.close();
  },
};

module.exports = { flows: [snippetLink, calendarEsc, selection, author, focus, createSheets, copy, chatPhone] };
