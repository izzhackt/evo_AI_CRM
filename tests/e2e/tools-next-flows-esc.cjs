"use strict";

/**
 * Сценарии `tools-next-static-render.cjs` по независимой проверке сборки 2A (28.10.2026): Esc в поле панели не выбрасывает набранное.
 * Как у боковой панели прежнего вида (`sidePanelEscape`), первая Esc только выводит из поля (панель и текст остаются, фокус на названии
 * панели), вторая закрывает панель. До правки панели «Шаблоны ответов», «Документы» и «Календарь» закрывались первой же Esc, и текст пропадал.
 */

const rowOf = (page, key, text) => (key === "m390"
  ? page.locator("[data-slot=data-table-cards] > li").filter({ hasText: text }).first()
  : page.locator("tbody tr").filter({ hasText: text }).first());
async function clickRow(page, key, row, cell = 1) {
  if (key === "m390") await row.locator("[data-card-open]").click({ position: { x: 6, y: 6 } });
  else await row.locator("td").nth(cell).click();
}
const onTitle = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-slot") === "sheet-title");

/**
 * Набрать `text` в `field`, нажать Esc: панель на месте, введённое остаётся, фокус на названии панели; вторая Esc закрывает панель.
 * `read` возвращает текущее значение поля (поле может пересоздаться, если панель закрылась, — тогда проверка не пройдёт).
 */
async function escKeepsText({ page, report, label, field, text }) {
  const dialog = page.getByRole("dialog");
  await field.fill(text);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const kept = { dialogs: await dialog.count(), value: await field.inputValue().catch(() => null), onTitle: await onTitle(page) };
  report(`${label}: the first Esc in a field only leaves the field (panel stays, typed text stays, focus on the panel title)`, kept.dialogs === 1 && kept.value === text && kept.onTitle, kept);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 2000 }).catch(() => {});
  report(`${label}: the second Esc closes the panel`, kept.dialogs === 1 && (await dialog.count()) === 0, await dialog.count());
}

const escSnippets = {
  name: "esc-snippets",
  async run({ open, report }) {
    for (const key of ["d1280", "m390"]) {
      {
        const { context, page, errors } = await open("snippets", key);
        await clickRow(page, key, rowOf(page, key, "Документы для визы X1"), 1);
        await page.getByRole("dialog").waitFor();
        await escKeepsText({ page, report, label: `snippets ${key} «Текст ответа»`, field: page.getByRole("dialog").getByLabel("Текст ответа"), text: "Правка текста ответа: добавить срок до пятницы" });
        report(`snippets ${key} «Текст ответа»: console clean`, errors.length === 0, errors);
        await context.close();
      }
      {
        const { context, page } = await open("snippets", key);
        await page.getByRole("button", { name: "Новый шаблон", exact: true }).click();
        await page.getByRole("dialog").waitFor();
        await escKeepsText({ page, report, label: `snippets ${key} «Новый шаблон»`, field: page.getByRole("dialog").getByLabel("Название"), text: "Черновик нового шаблона" });
        await context.close();
      }
    }
  },
};

const escDocuments = {
  name: "esc-documents",
  async run({ open, report }) {
    for (const key of ["d1280", "m390"]) {
      for (const [button, field, text] of [["Новая папка", "Название папки", "Черновик папки"], ["Новый файл", "Название файла", "Черновик файла"]]) {
        const { context, page } = await open("documents-folder", key);
        await page.getByRole("button", { name: button, exact: true }).click();
        await page.getByRole("dialog").waitFor();
        await escKeepsText({ page, report, label: `documents ${key} «${button}»`, field: page.getByRole("dialog").getByLabel(field), text });
        await context.close();
      }
      {
        const { context, page } = await open("documents-folder", key);
        await page.getByRole("button", { name: "Управление папкой", exact: true }).click();
        await page.getByRole("dialog").waitFor();
        await escKeepsText({ page, report, label: `documents ${key} «Управление папкой»`, field: page.getByRole("dialog").getByLabel("Новое название"), text: "Новое название папки (черновик)" });
        await context.close();
      }
      {
        const { context, page } = await open("documents-folder", key);
        await clickRow(page, key, rowOf(page, key, "Договор — образец"), 2);
        await page.getByRole("dialog").waitFor();
        await escKeepsText({ page, report, label: `documents ${key} file panel «Название»`, field: page.getByRole("dialog").getByLabel("Название", { exact: true }), text: "Договор — образец (правка)" });
        await context.close();
      }
    }
  },
};

const escCalendar = {
  name: "esc-calendar",
  async run({ open, report }) {
    for (const key of ["d1280", "m390"]) {
      const { context, page } = await open("calendar-panel", key);
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const fields = dialog.locator("[data-testid=v3-calendar-task-panel] :is(textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]))");
      const count = await fields.count();
      report(`calendar ${key}: the task panel has a text field to type into`, count > 0, count);
      if (count > 0) await escKeepsText({ page, report, label: `calendar ${key} task panel`, field: fields.first(), text: "Правка задачи (черновик)" });
      await context.close();
    }
  },
};

module.exports = { flows: [escSnippets, escDocuments, escCalendar] };
