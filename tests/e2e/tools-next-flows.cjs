"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Сценарии `tools-next-static-render.cjs`: что происходит по нажатию. «Календарь» (карточка → панель задачи, Esc и возврат
 * фокуса, «Без срока», вкладки вида), «Шаблоны ответов» (строка → панель → «Сохранить» / «Архивировать» / «Новый шаблон»),
 * «Документы» (папка, файл, поиск по всем папкам, выбор для выгрузки, создание) и «База знаний» (создание, выбор, «В корзину»,
 * поиск, материал, «Папки» на телефоне), «Командный чат» (каналы, шапка, ошибка). Действия сервера — заглушки, пишущие
 * вызов в `window.__harness.calls`; здесь проверяется, что вызван тот же ключ с теми же полями, а не что записалось в базу.
 */

const fx = require("./tools-next-fixtures.cjs");

const calls = (page) => page.evaluate(() => window.__harness.calls);
const pushes = (page) => page.evaluate(() => window.__harness.pushes);
const rowOf = (page, key, text) => (key === "m390"
  ? page.locator("[data-slot=data-table-cards] > li").filter({ hasText: text }).first()
  : page.locator("tbody tr").filter({ hasText: text }).first());
/** Нажатие в свободное место строки (не на ссылку/кнопку): ячейка таблицы или накладка карточки. */
async function clickRow(page, key, row, cell = 1) {
  if (key === "m390") await row.locator("[data-card-open]").click({ position: { x: 6, y: 6 } });
  else await (cell === -1 ? row.locator("td").last() : row.locator("td").nth(cell)).click();
}
const call = async (page, name) => (await calls(page)).filter((entry) => Array.isArray(entry) && entry[0] === name).at(-1);
const focusedId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName);
async function overlay(page, report, label, selector) {
  const result = await page.evaluate((query) => {
    const element = document.querySelector(query);
    if (!element) return { found: false };
    const background = getComputedStyle(element).backgroundColor;
    return { found: true, insideWorld: Boolean(element.closest('.v3-world[data-ui="next"]')), opaque: !/rgba\(0, 0, 0, 0\)|transparent/u.test(background) };
  }, selector);
  report(`${label}: inside the staff root and opaque`, result.found && result.insideWorld && result.opaque, result);
}

/* ------------------------------------------------------------------------------------------ Календарь */

const calendar = {
  name: "calendar",
  async run({ open, report, shot }) {
    const caseKey = `case:${fx.id("cccccccc", 41)}`;
    const staffKey = `staff:${fx.id("ffffffff", 41)}`;
    for (const key of ["d1280", "m390"]) {
      const label = `calendar ${key}`;
      const { context, page, errors } = await open("calendar-week", key);
      const prefix = key === "m390" ? "list-task" : "task";
      const tabs = await page.getByRole("link", { name: "Неделя", exact: true }).getAttribute("aria-current");
      report(`${label}: current view tab is a link with aria-current`, tabs === "page", tabs);
      await page.getByRole("link", { name: "Месяц", exact: true }).click();
      report(`${label}: view tab goes to the same address as before`, (await pushes(page)).at(-1) === "/v3/calendar?view=month&date=2026-09-26", await pushes(page));
      // Карточка → панель задачи (адрес с делом и задачей), сразу со скелетом, потом формы дела.
      const reopened = await open("calendar-week", key);
      const p = reopened.page;
      await p.locator(`[id="${prefix}-${caseKey}"]`).click();
      await p.getByRole("dialog").waitFor();
      report(`${label}: chip opens the task panel by address`, (await pushes(p)).at(-1)?.includes(`task=${fx.id("cccccccc", 41)}`) === true && (await pushes(p)).at(-1)?.includes(`case=${fx.id("dddddddd", 41)}`) === true, await pushes(p));
      await overlay(p, report, `${label}: task sheet`, "[data-slot=sheet-content]");
      await p.getByRole("button", { name: "Завершить", exact: true }).waitFor();
      const text = await p.getByRole("dialog").innerText();
      report(`${label}: panel shows due, assignee, details, case controls and the case link`, /Срок/u.test(text) && /Исполнитель/u.test(text) && /Подтвердить время/u.test(text) && /Изменить задачу/u.test(text) && await p.getByRole("link", { name: "Открыть дело" }).isVisible(), text.slice(0, 160));
      await shot(p, `calendar-sheet-${key}`);
      await p.keyboard.press("Escape");
      await p.waitForTimeout(120);
      report(`${label}: Esc closes the panel and returns focus to the chip`, (await p.getByRole("dialog").count()) === 0 && await focusedId(p) === `${prefix}-${caseKey}`, await focusedId(p));
      report(`${label}: closing goes back to the period address`, !(await pushes(p)).at(-1)?.includes("task="), await pushes(p));
      // Рабочая задача: без форм дела, ссылка «Открыть задачу».
      const staffChip = p.locator(`[id="${prefix}-${staffKey}"]`);
      await staffChip.click();
      await p.getByRole("dialog").waitFor();
      const staffLink = await p.getByRole("link", { name: "Открыть задачу" }).getAttribute("href");
      report(`${label}: a staff task has no case forms and links to «Задачи»`, (await p.getByRole("button", { name: "Завершить", exact: true }).count()) === 0 && staffLink?.startsWith("/v3/tasks?type=staff") === true, staffLink);
      await p.keyboard.press("Escape");
      // «Без срока»: свёрнуто, раскрывается, карточка открывает панель.
      const toggle = p.getByRole("button", { name: /Показать|Свернуть/u }).first();
      report(`${label}: «Без срока» starts collapsed`, await toggle.getAttribute("aria-expanded") === "false", null);
      await toggle.click();
      const undated = p.locator(`[id="task-case:${fx.id("cccccccc", 44)}"]`);
      report(`${label}: «Без срока» lists its tasks when opened`, await undated.isVisible(), null);
      await undated.click();
      await p.getByRole("dialog").waitFor();
      report(`${label}: an undated task opens in the same panel`, /Без срока/u.test(await p.getByRole("dialog").innerText()), null);
      report(`${label}: console clean`, errors.length + reopened.errors.length === 0, [...errors, ...reopened.errors]);
      await reopened.context.close();
      await context.close();
    }
    // День на сегодняшнем дне: «Сегодня» выключено, «сегодня» названо у периода.
    const { context, page } = await open("calendar-day", "d1280");
    const todayDisabled = await page.getByRole("button", { name: "Сегодня", exact: true }).isDisabled();
    report("calendar-day: «Сегодня» is disabled on today and the period says «сегодня»", todayDisabled && /сегодня/u.test(await page.locator("[data-calendar-period]").innerText()), null);
    await context.close();
    // Без доступа и пустая неделя говорят прежними словами.
    for (const [name, pattern] of [["calendar-denied", /Нет доступа к личному списку задач\./u], ["calendar-empty", /На этой неделе задач со сроком нет\./u]]) {
      const opened = await open(name, "d1280");
      report(`${name}: the notice stays on screen`, pattern.test(await opened.page.locator("main").innerText()), null);
      await opened.context.close();
    }
  },
};

/* ------------------------------------------------------------------------------------- Шаблоны ответов */

const snippets = {
  name: "snippets",
  async run({ open, report, shot }) {
    for (const key of ["d1280", "m390"]) {
      const label = `snippets ${key}`;
      const { context, page, errors } = await open("snippets", key);
      const row = rowOf(page, key, "Документы для визы X1");
      await clickRow(page, key, row, 1);
      await page.getByRole("dialog").waitFor();
      await overlay(page, report, `${label}: sheet`, "[data-slot=sheet-content]");
      await shot(page, `snippets-sheet-${key}`);
      await page.getByRole("dialog").getByLabel("Название", { exact: true }).fill("Документы для визы X1 (новое)");
      await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
      await page.getByText("Сохранено.").waitFor();
      const saved = await call(page, "updatePlatformReplySnippetAction");
      report(`${label}: «Сохранить» calls the same action with version and request id`, saved?.[1]?.expected_version === "2" && saved[1].reply_snippet_id === fx.id("99999999", 2) && saved[1].request_id === fx.id("88888888", 2) && saved[1].title === "Документы для визы X1 (новое)" && saved[1].audience === "all", saved);
      // Архив спрашивает сначала.
      await page.getByRole("dialog").getByRole("button", { name: "Архивировать", exact: true }).click();
      report(`${label}: archive asks first and has not called the action`, await page.getByText("Архивировать шаблон?").isVisible() && !(await call(page, "archivePlatformReplySnippetAction")), null);
      await page.getByRole("dialog").getByRole("button", { name: "Архивировать", exact: true }).last().click();
      await page.waitForTimeout(100);
      const archived = await call(page, "archivePlatformReplySnippetAction");
      report(`${label}: confirmed archive sends version and its own request id`, archived?.[1]?.request_id === fx.id("77777777", 2) && archived[1].expected_version === "2", archived);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      report(`${label}: Esc closes the sheet and returns focus to the row`, (await page.getByRole("dialog").count()) === 0 && /Открыть: Документы для визы X1/u.test(await focusedId(page)), await focusedId(page));
      // Новый шаблон — единственная красная кнопка, создаёт тем же действием.
      const create = page.getByRole("button", { name: "Новый шаблон", exact: true });
      const color = await create.evaluate((element) => getComputedStyle(element).backgroundColor);
      report(`${label}: «Новый шаблон» is the one red button`, color === "rgb(215, 2, 23)", color);
      await create.click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("dialog").getByLabel("Название", { exact: true }).fill("Тестовый шаблон");
      await page.getByRole("dialog").getByLabel("Текст ответа", { exact: true }).fill("Текст тестового шаблона.");
      await page.getByRole("dialog").getByRole("button", { name: "Создать шаблон", exact: true }).click();
      await page.getByText("Сохранено.").waitFor();
      const created = await call(page, "createPlatformReplySnippetAction");
      report(`${label}: «Создать шаблон» sends the page request id and the three fields`, created?.[1]?.request_id === fx.id("66666666", 3) && created[1].title === "Тестовый шаблон" && created[1].body === "Текст тестового шаблона." && ["sales", "admissions", "all"].includes(created[1].audience), created);
      report(`${label}: console clean`, errors.length === 0, errors);
      await context.close();
    }
    // Роль без права управлять: текст виден, форм и красной кнопки нет.
    const readonly = await open("snippets-readonly", "d1280");
    await clickRow(readonly.page, "d1280", rowOf(readonly.page, "d1280", "Первый ответ"), 1);
    await readonly.page.getByRole("dialog").waitFor();
    const dialog = await readonly.page.getByRole("dialog").innerText();
    report("snippets-readonly: the text is shown and there is no form or «Новый шаблон»", /Здравствуйте! Спасибо/u.test(dialog) && (await readonly.page.getByRole("button", { name: "Сохранить" }).count()) === 0 && (await readonly.page.getByRole("button", { name: "Новый шаблон" }).count()) === 0 && !/Автор:/u.test(dialog), dialog.slice(0, 120));
    await readonly.context.close();
    const empty = await open("snippets-empty", "d1280");
    report("snippets-empty: says so in words", /Шаблонов пока нет/u.test(await empty.page.locator("main").innerText()), null);
    await empty.context.close();
  },
};

/* ---------------------------------------------------------------------------------------------- Документы */

const documents = {
  name: "documents",
  async run({ open, report, shot }) {
    for (const key of ["d1280", "m390"]) {
      const label = `documents ${key}`;
      const { context, page, errors } = await open("documents", key);
      // Корень: «Компания» и «Студенты»; папка открывается нажатием, путь появляется.
      await clickRow(page, key, rowOf(page, key, "Компания"), 1);
      await page.getByRole("navigation", { name: "Путь к папке" }).waitFor();
      report(`${label}: a folder row opens the folder and shows the path`, /Документы\s*Компания/u.test((await page.getByRole("navigation", { name: "Путь к папке" }).innerText()).replace(/\s+/gu, " ")) && await rowOf(page, key, "Бланки договоров").isVisible(), null);
      // Поиск идёт по файлам всех папок, под названием — папка.
      await page.getByRole("searchbox", { name: "Поиск документов" }).fill("Аттестат");
      const found = rowOf(page, key, "Аттестат — скан.pdf");
      report(`${label}: search finds a file in another folder and names the folder`, await found.isVisible() && /Айдана Сыдыкова/u.test(await found.innerText()), null);
      await page.getByRole("searchbox", { name: "Поиск документов" }).fill("");
      // Файл компании: панель с четырьмя действиями.
      await clickRow(page, key, rowOf(page, key, "Бланки договоров"), 1);
      await clickRow(page, key, rowOf(page, key, "Договор — образец"), 2);
      await page.getByRole("dialog").waitFor();
      await overlay(page, report, `${label}: file sheet`, "[data-slot=sheet-content]");
      const sheetText = await page.getByRole("dialog").innerText();
      report(`${label}: file panel offers replace, rename, move, delete and download`, /Заменить файл/u.test(sheetText) && /Название/u.test(sheetText) && /Переместить в/u.test(sheetText) && /Удалить файл/u.test(sheetText) && await page.getByRole("link", { name: "Скачать", exact: true }).isVisible(), sheetText.slice(0, 200));
      await shot(page, `documents-sheet-${key}`);
      await page.getByRole("dialog").getByLabel("Название", { exact: true }).fill("Договор — новая редакция.pdf");
      await page.getByRole("dialog").getByRole("button", { name: "Переименовать", exact: true }).click();
      await page.getByText("Изменение сохранено.").first().waitFor();
      const renamed = await call(page, "renamePlatformCompanyFileAction");
      report(`${label}: rename calls the same action with file id, version, request id and name`, renamed?.[1]?.company_file_id === fx.id("50000000", 2) && renamed[1].expected_version === "1" && renamed[1].request_id === fx.id("41000000", 2) && renamed[1].display_name === "Договор — новая редакция.pdf", renamed);
      await page.getByRole("dialog").getByRole("button", { name: "Удалить файл", exact: true }).click();
      report(`${label}: delete asks first and has not called the action`, await page.getByText(/Удалить «Договор — образец.pdf»\?/u).isVisible() && !(await call(page, "archivePlatformCompanyFileAction")), null);
      await page.getByRole("dialog").getByRole("button", { name: "Да, удалить", exact: true }).click();
      await page.waitForTimeout(100);
      const archived = await call(page, "archivePlatformCompanyFileAction");
      report(`${label}: confirmed delete sends version and its own request id`, archived?.[1]?.request_id === fx.id("43000000", 2) && archived[1].company_file_id === fx.id("50000000", 2), archived);
      await page.keyboard.press("Escape");
      // Выбор для выгрузки.
      await page.getByRole("checkbox", { name: /Выбрать Дополнительное соглашение/u }).last().click({ force: true });
      report(`${label}: choosing a document shows «Выбрано» and the export button`, await page.getByText("Выбрано: 1").isVisible() && await page.getByRole("button", { name: "Выгрузить выбранные документы" }).isVisible(), null);
      // Создать файл и папку в открытой папке.
      await page.getByRole("button", { name: "Новый файл", exact: true }).click();
      await page.getByRole("dialog").getByLabel("Название файла").fill("Новый бланк.docx");
      await page.getByRole("dialog").getByRole("button", { name: "Создать", exact: true }).click();
      await page.getByText("Изменение сохранено.").first().waitFor();
      const createdFile = await call(page, "createPlatformCompanyFileAction");
      report(`${label}: «Новый файл» sends the folder id, request id and name`, createdFile?.[1]?.request_id === fx.id("66666666", 2) && createdFile[1].display_name === "Новый бланк.docx" && createdFile[1].folder_id === fx.id("60000000", 1), createdFile);
      report(`${label}: console clean`, errors.length === 0, errors);
      await context.close();
    }
    const readonly = await open("documents-readonly", "d1280");
    const text = await readonly.page.locator("main").innerText();
    report("documents-readonly: no create or manage buttons", !/Новый файл|Новая папка|Управление папкой/u.test(text), null);
    await readonly.context.close();
  },
};

/* ---------------------------------------------------------------------------------------------- База знаний */

const knowledge = {
  name: "knowledge",
  async run({ open, report, shot }) {
    for (const key of ["d1280", "m390"]) {
      const label = `knowledge ${key}`;
      const { context, page, errors } = await open("knowledge-folder", key);
      const links = await page.getByRole("navigation", { name: "Материалы, документы, шаблоны ответов" }).getByRole("link").evaluateAll((els) => els.map((el) => [el.textContent.trim(), el.getAttribute("href"), el.getAttribute("aria-current")]));
      report(`${label}: section tabs are links to the same addresses`, JSON.stringify(links.slice(0, 3)) === JSON.stringify([["Материалы", "/v3/knowledge", "page"], ["Документы", "/v3/knowledge?section=documents", null], ["Шаблоны ответов", "/v3/knowledge?section=snippets", null]]), links);
      await page.getByRole("button", { name: /Показать ещё/u }).count();
      report(`${label}: the list is the server's rows`, (await (key === "m390" ? page.locator("[data-slot=data-table-cards] > li") : page.locator("tbody tr")).count()) === 5, null);
      // Окна из меню: Esc закрывает окно, фокус возвращается на кнопку меню, откуда его открыли.
      await page.getByTestId("knowledge-create-menu").click();
      await page.getByRole("menuitem", { name: "Папку" }).click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      report(`${label}: Esc closes the create dialog and returns focus to «Создать»`, (await page.getByRole("dialog").count()) === 0 && await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "knowledge-create-menu", await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
      await page.getByTestId("knowledge-more-menu").click();
      await page.getByRole("menuitem", { name: "Выгрузить всю базу" }).click();
      await page.locator("dialog[open]").waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      report(`${label}: Esc closes the export window and returns focus to «⋯»`, await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "knowledge-more-menu", await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
      // Создать → папка.
      await page.getByTestId("knowledge-create-menu").click();
      const items = await page.getByRole("menuitem").allInnerTexts();
      report(`${label}: the create menu offers folder, page and upload`, ["Папку", "Страницу", "Загрузить файлы"].every((word) => items.some((item) => item.includes(word))), items);
      await page.getByRole("menuitem", { name: "Папку" }).click();
      await page.getByRole("dialog").waitFor();
      await overlay(page, report, `${label}: create dialog`, "[data-slot=dialog-content]");
      await page.getByRole("dialog").getByLabel("Название").fill("Новая тестовая папка");
      await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
      await page.waitForTimeout(150);
      const create = (await calls(page)).filter((entry) => entry[0] === "knowledge-command").at(-1);
      report(`${label}: «Сохранить» sends the create command for the open folder`, create?.[1]?.op === "create" && create[1].kind === "folder" && create[1].title === "Новая тестовая папка" && typeof create[1].parentId === "string", create);
      // Выбор → «В корзину» с «Отменить».
      await page.getByRole("checkbox", { name: /Выбрать: Анкета университета/u }).last().click({ force: true });
      await page.getByTestId("knowledge-selection").waitFor();
      report(`${label}: choosing a row shows the selection bar`, /Выбрано: 1/u.test(await page.getByTestId("knowledge-selection").innerText()), null);
      await page.getByRole("button", { name: "В корзину", exact: true }).click();
      await page.getByText("Перемещено в корзину").waitFor();
      const trash = (await calls(page)).filter((entry) => entry[0] === "knowledge-command" && entry[1].op === "trash").at(-1);
      report(`${label}: «В корзину» sends trash with the item version and offers «Отменить»`, typeof trash?.[1]?.id === "string" && trash[1].expectedVersion === 3 && await page.getByRole("button", { name: "Отменить", exact: true }).isVisible(), trash);
      // Поиск идёт на сервер.
      await page.getByRole("searchbox", { name: "Поиск по базе знаний" }).fill("Чек");
      await page.waitForTimeout(500);
      const requests = await page.evaluate(() => window.__harness.requests);
      report(`${label}: search asks the server (not only the loaded rows)`, requests.some((request) => /mode=search/u.test(request) && /search=%D0%A7%D0%B5%D0%BA/u.test(request)), requests.slice(-3));
      await page.getByRole("searchbox", { name: "Поиск по базе знаний" }).fill("");
      // Строка открывает материал (адрес `item=`).
      await page.waitForTimeout(300);
      const first = rowOf(page, key, "Как готовить мотивационное письмо");
      await clickRow(page, key, first, -1);
      report(`${label}: a row opens the material by address`, (await pushes(page)).at(-1)?.includes("item=") === true, await pushes(page));
      report(`${label}: console clean`, errors.length === 0, errors);
      await context.close();
    }
    // Телефон: «Папки» — панель с деревом внутри корня staff CRM.
    const phone = await open("knowledge-folder", "m390");
    await phone.page.getByTestId("knowledge-tree-open").click();
    await phone.page.getByRole("dialog").waitFor();
    await overlay(phone.page, report, "knowledge m390: folders sheet", "[data-slot=sheet-content]");
    report("knowledge m390: the folders sheet holds the tree without the section links", await phone.page.getByRole("dialog").getByTestId("knowledge-tree").isVisible() && (await phone.page.getByRole("dialog").getByText("Файлы и шаблоны").count()) === 0, null);
    await shot(phone.page, "knowledge-folders-m390");
    await phone.page.keyboard.press("Escape");
    report("knowledge m390: Esc closes it and focus returns to «Папки»", (await phone.page.getByRole("dialog").count()) === 0 && await focusedId(phone.page) === "knowledge-tree-open" || /Папки/u.test(await phone.page.evaluate(() => document.activeElement?.textContent ?? "")), null);
    await phone.context.close();
    // Материал открыт: редактор в новой рамке.
    const item = await open("knowledge-item", "d1280");
    await item.page.getByText("Как готовить мотивационное письмо").first().waitFor();
    report("knowledge-item: the page editor opens inside the new frame", await item.page.getByTestId("knowledge-library").isVisible(), null);
    await shot(item.page, "knowledge-item-d1280");
    await item.context.close();
    const loading = await open("knowledge-loading", "d1280");
    report("knowledge-loading: the table shows its skeleton while rows load", await loading.page.locator("[aria-busy=true]").count() > 0, null);
    await loading.context.close();
  },
};

/* ---------------------------------------------------------------------------------------- Командный чат */

const chat = {
  name: "chat",
  async run({ open, report, shot }) {
    const wide = await open("chat", "d1280");
    const facts = await wide.page.evaluate(() => ({ nav: Boolean(document.querySelector('nav[aria-label="Каналы команды"]')), composer: Boolean(document.querySelector("textarea")), h1s: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()), main: document.querySelector("main")?.getAttribute("aria-label") }));
    report("chat d1280: one «Командный чат» h1 from the page header, channels and composer are there", JSON.stringify(facts.h1s) === JSON.stringify(["Командный чат"]) && facts.nav && facts.composer && facts.main === "Командный чат", facts);
    await wide.page.locator("textarea").fill("Проверка отправки");
    const reds = await wide.page.evaluate(() => [...document.querySelectorAll("main button")].filter((b) => getComputedStyle(b).backgroundColor === "rgb(215, 2, 23)" && b.getBoundingClientRect().width > 0).length);
    report("chat d1280: with text typed the send button is the one red button", reds === 1, reds);
    const card = await wide.page.evaluate(() => {
      const workspace = document.querySelector("[data-frame=card]");
      const box = workspace?.parentElement?.getBoundingClientRect();
      return workspace ? { height: Math.round(box.height), bottom: Math.round(box.bottom), window: window.innerHeight } : null;
    });
    report("chat d1280: the chat fills the window under the header (card ends inside the window)", card !== null && card.height > 400 && card.bottom <= card.window, card);
    report("chat d1280: console clean", wide.errors.length === 0, wide.errors);
    await wide.context.close();
    // Содержимое чата не уходит за рамку страницы: рамка режет лишнее (`overflow-hidden`), поэтому боковая прокрутка этого не покажет.
    for (const [name, key] of [["chat", "d1280"], ["chat", "m390"], ["chat-channels", "m390"], ["chat-channels", "d1440"]]) {
      const view = await open(name, key);
      const clipped = await view.page.evaluate(() => {
        const workspace = document.querySelector("[data-frame=card]");
        const frame = workspace.parentElement.getBoundingClientRect();
        const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
        return [...workspace.querySelectorAll("a, button, textarea, time, h2")].filter(visible).filter((element) => element.getBoundingClientRect().right > frame.right + 1).map((element) => (element.textContent || element.tagName).trim().slice(0, 30));
      });
      report(`${name} ${key}: nothing of the chat is clipped by the frame`, clipped.length === 0, clipped);
      await view.context.close();
    }
    const phone = await open("chat-channels", "m390");
    const before = await phone.page.evaluate(() => [...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().width > 0).map((h) => h.textContent.trim()));
    report("chat m390: the channel list shows the page header", before.length === 1 && before[0] === "Командный чат", before);
    // Открытый канал показывает переписку без шапки страницы (как прежний заголовок, стоявший в списке каналов).
    await phone.page.getByRole("link", { name: /Общий/u }).first().click();
    await phone.page.waitForTimeout(100);
    const inChannel = await phone.page.evaluate(() => ({ panel: document.querySelector("[data-panel]")?.getAttribute("data-panel"), h1: [...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().width > 0).length }));
    report("chat m390: opening the channel hides the page header and shows the conversation", inChannel.panel === "messages" && inChannel.h1 === 0, inChannel);
    await shot(phone.page, "chat-conversation-m390");
    await phone.page.getByRole("button", { name: "К каналам" }).click();
    const back = await phone.page.evaluate(() => [...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().width > 0).length);
    report("chat m390: «К каналам» brings the header back", back === 1, back);
    // Другой канал — ссылка на тот же адрес, что раньше.
    await phone.page.getByRole("link", { name: /Продажи/u }).first().click();
    report("chat m390: another channel is a link to the same address", (await pushes(phone.page)).at(-1) === "/v3/team-chat?channel=sales", await pushes(phone.page));
    await phone.context.close();
    const failure = await open("chat-failure", "d1280");
    const alert = await failure.page.getByRole("alert").innerText();
    const retry = await failure.page.getByRole("link", { name: "Обновить канал" }).getAttribute("href");
    report("chat-failure: the reason stays on screen with the same retry link", /Не удалось загрузить канал/u.test(alert) && retry === "/v3/team-chat?channel=general", [alert, retry]);
    await shot(failure.page, "chat-failure-d1280");
    await failure.context.close();
  },
};

module.exports = { flows: [calendar, snippets, documents, knowledge, chat] };
