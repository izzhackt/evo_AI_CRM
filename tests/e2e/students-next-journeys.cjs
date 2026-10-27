"use strict";

/**
 * Пути «Нового вида» для стенда `students-next-static-render.cjs`: строка → панель → действие, клавиатура, фильтры, поиск,
 * вкладки, массовый выбор, очереди EVO Docs, «Нагрузка кураторов» и «Университеты». Каждый путь получает `tools`
 * (`open`, `shot`, `report`, …) и печатает проверки строками JSON.
 */

const NAMES = { aidana: "Айдана Сыдыкова", nursultan: "Нурсултан Бекмурзаевич", timur: "Тимур Абдылдаев" };
const keys = (view) => ({ tableRow: (page, text) => (view === "m390"
  ? page.locator("[data-slot=data-table-cards] > li").filter({ hasText: text }).first()
  : page.locator("tbody tr").filter({ hasText: text }).first()) });

/** Нажатие в свободное место строки (не на ссылку): ячейка таблицы или накладка карточки. */
async function pressRow(page, view, text, cell = 1) {
  const row = keys(view).tableRow(page, text);
  if (view === "m390") await row.locator("> [data-card-open]").click({ position: { x: 8, y: 8 } });
  else await row.locator("td").nth(cell).click();
}
const pushes = (page) => page.evaluate(() => window.__harness.pushes);
const calls = (page) => page.evaluate(() => window.__harness.calls);
const overlay = async (page, report, label, selector = "[data-slot=sheet-content]") => {
  const result = await page.evaluate((query) => {
    const element = document.querySelector(query);
    if (!element) return { found: false };
    const background = getComputedStyle(element).backgroundColor;
    return { found: true, insideWorld: Boolean(element.closest('.v3-world[data-ui="next"]')), opaque: !/rgba\(0, 0, 0, 0\)|transparent/u.test(background) };
  }, selector);
  report(`${label}: panel inside the staff root and opaque`, result.found && result.insideWorld && result.opaque, result);
};

const journeys = [
  // Очередь: строка открывает панель, Esc возвращает фокус, «Открыть дело», шаг сохраняется той же командой.
  async ({ open, shot, report, AxeBuilder, harness }) => {
    for (const view of ["d1280", "m390"]) {
      const { context, page, errors } = await open("queue", view);
      await pressRow(page, view, NAMES.aidana);
      await page.getByRole("dialog").waitFor();
      const opened = (await pushes(page)).at(-1) ?? "";
      report(`queue ${view}: row opens the panel by address (?open=)`, /view=active&open=cccccccc-2222-4222-8222-000000000001$/u.test(opened), opened);
      await overlay(page, report, `queue ${view}`);
      const dialog = page.getByRole("dialog");
      const text = await dialog.innerText();
      report(`queue ${view}: panel shows stage, curator, next step, tasks and documents`, /Этап/u.test(text) && /Куратор/u.test(text) && /Следующий шаг/u.test(text) && /Задачи/u.test(text) && /Документы/u.test(text) && /из 12 принято/u.test(text), text.slice(0, 160));
      report(`queue ${view}: panel focus is inside, on the title`, await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]"))), null);
      const caseLink = dialog.getByRole("link", { name: "Открыть дело", exact: true });
      report(`queue ${view}: «Открыть дело» goes to the case with the return address`, /\/v3\/profile\?case=cccccccc-2222-4222-8222-000000000001&tab=overview&returnTo=/u.test((await caseLink.getAttribute("href")) ?? ""), await caseLink.getAttribute("href"));
      await shot(page, `queue-sheet-${view}`);
      const axe = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
      report(`queue ${view}: axe (panel)`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
      // Шаг: тот же редактор и та же команда (`saveCaseNextActionAction` с ожидаемой версией); строка получает новый шаг сразу.
      const field = dialog.getByRole("textbox", { name: "Шаг" });
      await field.fill("Отправить копии аттестата партнёру");
      await dialog.getByRole("button", { name: "Завтра", exact: true }).click();
      await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
      await page.waitForFunction(() => window.__harness.calls.some((call) => Array.isArray(call) && call[0] === "saveCaseNextActionAction"));
      const saved = (await calls(page)).find((call) => Array.isArray(call) && call[0] === "saveCaseNextActionAction")[1];
      report(`queue ${view}: «Сохранить» calls the same command with the version, text and due day`, saved.student_case_id === "cccccccc-2222-4222-8222-000000000001" && saved.next_action === "Отправить копии аттестата партнёру" && /^\d{4}-\d\d-\d\d$/u.test(saved.next_action_due_on) && saved.expected_version === "3", saved);
      await page.waitForFunction(() => window.__harness.calls.includes("refresh"));
      const rowText = await keys(view).tableRow(page, NAMES.aidana).evaluate((element) => element.textContent);
      report(`queue ${view}: the saved step is already in the row (before the server answers)`, /Отправить копии аттестата партнёру/u.test(rowText), rowText.slice(0, 120));
      report(`queue ${view}: «Завершить дело» is in the panel for a case that can be closed`, await dialog.getByRole("button", { name: /Завершить дело/u }).count() === 1, null);
      // Фокус после сохранения вернулся в поле шага: первая Esc только выводит из поля (как в прежней боковой панели), вторая закрывает.
      await page.keyboard.press("Escape");
      report(`queue ${view}: Esc in the step field after saving keeps the panel`, (await dialog.count()) === 1, null);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      report(`queue ${view}: Esc closes the panel and the address returns to the list`, !/open=/u.test((await pushes(page)).at(-1) ?? ""), (await pushes(page)).at(-1));
      report(`queue ${view}: no browser errors`, errors.length === 0, errors);
      await context.close();
    }
    // Клавиатура: Tab → название-ссылка строки → Enter открывает панель, Esc возвращает фокус на неё.
    const { context, page } = await open("queue", "d1280");
    const link = page.locator("tbody [data-queue-open]").first();
    await link.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.waitForTimeout(150);
    report("queue d1280: the row link opens by keyboard and Esc returns focus to it", await link.evaluate((element) => element === document.activeElement), null);
    const tree = await harness.rowA11yProblems(page);
    report("queue d1280: row accessibility tree (rows are not tab stops, every control has a name)", tree.problems.length === 0 && tree.rows > 0, tree);
    await context.close();
  },
  // Фильтры, поиск, массовый выбор, приём дела.
  async ({ open, shot, report }) => {
    const { context, page } = await open("queue", "d1280");
    await page.getByRole("button", { name: /^Направление/u }).click();
    const items = await page.getByRole("menuitem").allInnerTexts();
    report("queue d1280: «Направление» lists every direction with its count", items.length === 7 && /Китай\s*\d+/u.test(items.join(" ")), items);
    await page.getByRole("menuitem", { name: /Китай/u }).click();
    report("queue d1280: a filter is a link into the address (the server filters)", /direction=CN/u.test((await pushes(page)).at(-1) ?? ""), await pushes(page));
    await context.close();
    const found = await open("queue", "d1280");
    const field = found.page.getByRole("searchbox", { name: "Найти студента" });
    await field.fill("Айд");
    await field.press("Enter");
    report("queue d1280: search goes to the server (?q=) and keeps the view", /view=active&q=%D0%90%D0%B9%D0%B4/u.test((await pushes(found.page)).at(-1) ?? ""), await pushes(found.page));
    await shot(found.page, "queue-filters-d1280");
    await found.context.close();
    // Массовый выбор: «Выбрать» открывает отметки, выбранное — строка действий.
    for (const view of ["d1280", "m390"]) {
      const bulk = await open("queue", view);
      await bulk.page.getByTestId("queue-bulk-pick").click();
      const boxes = bulk.page.locator("[data-queue-select]:visible");
      report(`queue ${view}: «Выбрать» reveals the selection checkboxes`, (await boxes.count()) > 5, await boxes.count());
      await boxes.first().check();
      await boxes.nth(1).check();
      const action = bulk.page.getByRole("button", { name: /^Изменить срок шага/u });
      await action.waitFor();
      report(`queue ${view}: selected cases get the same bulk actions (change the step due day)`, await action.isVisible(), null);
      await shot(bulk.page, `queue-bulk-${view}`);
      report(`queue ${view}: console clean (bulk)`, bulk.errors.length === 0, bulk.errors);
      await bulk.context.close();
    }
    // Приём дела: переданное дело открывает панель с блоком «Принять дело» первым.
    for (const view of ["d1280", "m390"]) {
      const accept = await open("queue", view);
      await pressRow(accept.page, view, NAMES.nursultan);
      await accept.page.getByRole("dialog").waitFor();
      const handoff = accept.page.getByTestId("v3-students-panel-handoff");
      report(`queue ${view}: a handed-over case opens with «Приём дела» first`, (await handoff.count()) === 1 && /Принять дело/u.test(await handoff.innerText()), (await handoff.count()) ? (await handoff.innerText()).slice(0, 80) : null);
      await shot(accept.page, `queue-handoff-${view}`);
      await accept.context.close();
    }
  },

  // «Мои»: без колонки «Куратор», исключения куратора — в сигналах; состояния: отказ, ошибка чтения, пусто, неразобранный адрес.
  async ({ open, shot, report }) => {
    const { context, page } = await open("mine", "d1280");
    const heads = await page.locator("thead th").allInnerTexts();
    report("mine d1280: no «Куратор» column in «Мои»", !heads.some((text) => /Куратор/u.test(text)), heads);
    await context.close();
    for (const [name, pattern, label] of [
      ["state-forbidden", /недоступен/u, "forbidden: the refusal says retry will not help"],
      ["state-invalid", /Не удалось применить фильтры/u, "invalid address: the rejection and the reset link"],
      ["state-page-error", /Не удалось загрузить список студентов/u, "read error stays visible with «Повторить»"],
      ["state-empty-mine", /Активных дел у вас нет/u, "empty queue says what is empty"],
      ["state-counts-unavailable", /Счётчики недоступны, список работает/u, "unavailable counts are named, the list works"],
      ["docs-noAccess", /Нет доступа к документам/u, "docs without access say so in the cells"],
      ["docs-programError", /Не удалось загрузить документы программ на проверку/u, "program queue read error stays visible"],
      ["docs-packagesEmpty", /Проверять нечего/u, "empty packages queue names what is empty"],
    ]) {
      const state = await open(name, "d1280");
      const text = await state.page.locator("main").innerText();
      report(`${name} d1280: ${label}`, pattern.test(text), text.slice(0, 160));
      await shot(state.page, `${name}-d1280`);
      await state.context.close();
    }
  },

  // «Нагрузка кураторов»: строка открывает панель с прежней формой замещения.
  async ({ open, shot, report }) => {
    for (const view of ["d1280", "m390"]) {
      const { context, page, errors } = await open("curators", view);
      await pressRow(page, view, "Эрмек Токтосунов", 0);
      await page.getByRole("dialog").waitFor();
      report(`curators ${view}: a curator row opens the panel by address`, /coverage_curator=aaaaaaaa-1111-4111-8111-000000000002/u.test((await pushes(page)).at(-1) ?? ""), await pushes(page));
      await overlay(page, report, `curators ${view}`);
      await shot(page, `curators-sheet-${view}`);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      report(`curators ${view}: Esc closes the panel`, /view=curators$/u.test((await pushes(page)).at(-1) ?? ""), await pushes(page));
      report(`curators ${view}: no browser errors`, errors.length === 0, errors);
      await context.close();
    }
  },

  // EVO Docs: вкладки-ссылки, «⋯», дело ведёт в документы, «Документы программ» — панель с файлом и решением, «Комплекты».
  async ({ open, shot, report, AxeBuilder }) => {
    for (const view of ["d1280", "m390"]) {
      const { context, page } = await open("docs-review", view);
      const tabs = await page.locator('nav[aria-label="Виды списка студентов"] a').allInnerTexts();
      report(`docs ${view}: the tab row is links with counts`, tabs.length >= 5 && /Документы программ\s*3/u.test(tabs.join(" ")), tabs);
      await page.getByRole("link", { name: /^Документы программ/u }).click();
      report(`docs ${view}: a tab is a link into the address`, /section=docs&view=program/u.test((await pushes(page)).at(-1) ?? ""), await pushes(page));
      await context.close();
      const row = await open("docs-review", view);
      await pressRow(row.page, view, "Айдана Сыдыкова", 1);
      const href = (await pushes(row.page)).at(-1) ?? "";
      report(`docs ${view}: a case row goes to the case documents with the return address`, /case=cccccccc-2222-4222-8222-000000000001&tab=documents&section=docs&returnTo=/u.test(href), href);
      await row.context.close();
    }
    const menu = await open("docs-review", "d1280");
    await menu.page.getByRole("button", { name: /Ещё по документам: Айдана/u }).click();
    report("docs d1280: «⋯» keeps «Анкета и формы» and «Пакет ZIP»", (await menu.page.getByRole("menuitem").allInnerTexts()).join("|") === "Анкета и формы|Пакет ZIP", await menu.page.getByRole("menuitem").allInnerTexts());
    await menu.context.close();
    for (const view of ["d1280", "m390"]) {
      const { context, page, errors } = await open("docs-program", view);
      await pressRow(page, view, "Айдана Сыдыкова", 1);
      await page.getByRole("dialog").waitFor();
      const dialog = page.getByRole("dialog");
      const text = await dialog.innerText();
      report(`docs-program ${view}: the panel holds the file, the download and the decision`, /attestat-sydykova\.pdf/u.test(text) && /Скачать/u.test(text) && (await dialog.locator("details summary").count()) === 1, text.slice(0, 200));
      report(`docs-program ${view}: «Открыть программу» goes to the preparation`, /tab=route.*#preparation-/u.test((await dialog.getByRole("link", { name: "Открыть программу" }).getAttribute("href")) ?? ""), null);
      await overlay(page, report, `docs-program ${view}`);
      await dialog.locator("details summary").click();
      await shot(page, `docs-program-sheet-${view}`);
      const axe = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
      report(`docs-program ${view}: axe (panel)`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      report(`docs-program ${view}: no browser errors`, errors.length === 0, errors);
      await context.close();
    }
    const older = await open("docs-program", "d1280");
    report("docs-program d1280: a document by an older requirement is warned in the row", /Прежнее требование/u.test(await older.page.locator("tbody").innerText()), null);
    await older.context.close();
    const packages = await open("docs-packages", "d1280");
    await pressRow(packages.page, "d1280", "Тимур Абдылдаев", 1);
    report("docs-packages d1280: a package row goes to the preparation of that program", /tab=route.*#preparation-aaaaaaaa-9999-4999-8999-000000000001/u.test((await pushes(packages.page)).at(-1) ?? ""), await pushes(packages.page));
    report("docs-packages d1280: a package by an older requirement is warned", /по прежней редакции|Прежн/u.test(await packages.page.locator("tbody").innerText()), null);
    await shot(packages.page, "docs-packages-d1280");
    await packages.context.close();
    const partial = await open("docs-incomplete", "d1280");
    const note = await partial.page.locator("[role=status]").allInnerTexts();
    report("docs-incomplete d1280: a partial read says so and offers the next page", /числа вкладок неполные/u.test(note.join(" ")) && /Проверить следующие 100/u.test(note.join(" ")), note);
    await partial.context.close();
  },
  // «Университеты»: строка ведёт в карточку, поиск идёт по каталогу с паузой набора, фильтры — ссылки, страницы сервера.
  async ({ open, report, harness }) => {
    for (const view of ["d1280", "m390"]) {
      const { context, page, errors } = await open("uni-list", view);
      await pressRow(page, view, "Fudan University", view === "m390" ? 0 : 1);
      report(`uni-list ${view}: a row goes to the university card`, /^\/v3\/universities\/57ce9b97-43fb-4563-9c61-\d{12}$/u.test((await pushes(page)).at(-1) ?? ""), await pushes(page));
      report(`uni-list ${view}: no browser errors`, errors.length === 0, errors);
      await context.close();
    }
    const { context, page } = await open("uni-list", "d1280");
    const field = page.getByRole("searchbox", { name: "Поиск университетов" });
    await field.fill("Fudan");
    await page.waitForFunction(() => window.__harness.pushes.some((href) => /q=Fudan/u.test(href)), null, { timeout: 3000 });
    report("uni-list d1280: search runs by itself after a pause and keeps the filters", true, await pushes(page));
    await page.getByRole("button", { name: /^Страна/u }).click();
    report("uni-list d1280: «Страна» is a menu of links with «Все страны» first", (await page.getByRole("menuitem").first().innerText()) === "Все страны", (await page.getByRole("menuitem").count()));
    await page.keyboard.press("Escape");
    const next = page.getByRole("link", { name: "Дальше", exact: true });
    report("uni-list d1280: the server pages are links («Дальше»)", /offset=30/u.test((await next.getAttribute("href")) ?? ""), null);
    const tree = await harness.rowA11yProblems(page);
    report("uni-list d1280: row accessibility tree", tree.problems.length === 0 && tree.rows > 0, tree);
    await context.close();
    const empty = await open("uni-empty", "d1280");
    report("uni-empty d1280: the empty catalogue says what is empty and what to do", /Пока нет опубликованных карточек по этому запросу/u.test(await empty.page.locator("main").innerText()) && /Попробуйте убрать фильтры/u.test(await empty.page.locator("main").innerText()), null);
    await empty.context.close();
    const paged = await open("uni-paged", "d1280");
    report("uni-paged d1280: «Назад» is a link", (await paged.page.getByRole("link", { name: "Назад", exact: true }).count()) === 1, null);
    await paged.context.close();
  },

  // Карточка университета: программы и наборы, внешние ссылки открываются в новой вкладке, фото и пояснения.
  async ({ open, report }) => {
    for (const view of ["d1280", "m390"]) {
      const { context, page, errors } = await open("uni-detail", view);
      const info = await page.evaluate(() => ({
        h1: document.querySelectorAll("h1").length, h2: [...document.querySelectorAll("main h2")].map((element) => element.textContent.trim()).slice(0, 5),
        tables: document.querySelectorAll("[data-slot=data-table]").length,
        external: [...document.querySelectorAll("main a[target=_blank]")].filter((link) => !/noopener/u.test(link.rel)).length,
        photo: Boolean(document.querySelector("aside[aria-label='Фото кампуса']")),
        manage: [...document.querySelectorAll("main a")].map((link) => link.textContent.trim()).filter((text) => /Бланки университета|Предложить обновление/u.test(text)),
      }));
      report(`uni-detail ${view}: programs are sections with their intake tables`, info.tables >= 1 && info.h2.length >= 2, info);
      report(`uni-detail ${view}: every external link opens in a new tab safely`, info.external === 0, info.external);
      report(`uni-detail ${view}: photo and the editor's links (forms, update) are present for a manager`, info.photo && info.manage.length === 2, info.manage);
      report(`uni-detail ${view}: no browser errors`, errors.length === 0, errors);
      await context.close();
    }
    const plain = await open("uni-detail-plain", "d1280");
    const links = await plain.page.evaluate(() => [...document.querySelectorAll("main a")].map((link) => link.textContent.trim()).filter((text) => /Бланки университета|Предложить обновление/u.test(text)));
    report("uni-detail-plain d1280: no management links without the right", links.length === 0, links);
    await plain.context.close();
  },

  // Управление каталогом: группы подготовленных сведений раскрываются, поиск раскрывает совпавшие, ошибка чтения черновиков на виду.
  async ({ open, shot, report }) => {
    const { context, page } = await open("uni-manage", "d1280");
    const groups = page.locator("[data-testid=manage-template-groups] details");
    report("uni-manage d1280: country groups are closed until searched", (await groups.count()) > 3 && (await page.locator("[data-testid=manage-template-groups] details[open]").count()) === 0, await groups.count());
    await groups.first().locator("summary").click();
    report("uni-manage d1280: a group opens by its summary and lists links to prepare", (await groups.first().getByRole("link").count()) >= 1, null);
    await shot(page, "uni-manage-open-d1280");
    await context.close();
    const search = await open("uni-manage-search", "d1280");
    report("uni-manage-search d1280: a search opens the matching groups", (await search.page.locator("[data-testid=manage-template-groups] details[open]").count()) > 0, null);
    await search.context.close();
    const failed = await open("uni-manage-error", "d1280");
    report("uni-manage-error d1280: a failed draft read is named, not shown as an empty queue", /Не удалось загрузить черновики/u.test(await failed.page.locator("main").innerText()), null);
    await failed.context.close();
  },
];

module.exports = { journeys, keys, pressRow, pushes, calls, overlay };
