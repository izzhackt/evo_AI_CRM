"use strict";

/**
 * Сценарии стенда `admin-next-static-render.cjs` по уроку волны 2A (независимая проверка сборки 2A, 28.10.2026): Esc в поле панели не выбрасывает набранное.
 * Как у боковой панели прежнего вида (`sidePanelEscape`), первая Esc только выводит из поля (панель и текст остаются, фокус на названии панели,
 * вопроса нет); вторая закрывает панель, а у панелей с формами под охраной (`SheetGuard`) сперва спрашивает «Есть несохранённые изменения…»:
 * «нет» оставляет панель и текст, «да» закрывает. Панели без охраны (фильтры, исправление пункта сверки) вторая Esc закрывает сразу.
 * Без `sheetEscape` Radix закрывал панель первой же Esc, и набранное пропадало.
 */
module.exports = function register({ flow: addFlow, sheet }) {
  const flow = (name, run) => addFlow(name, async (env) => {
    try { await run(env); } catch (error) { env.report(`${name}: the scenario ran to the end`, false, String(error?.message ?? error).split("\n")[0]); }
  });
  const CLOSE_CONFIRM = "Есть несохранённые изменения. Закрыть без сохранения?";
  const answers = (page) => {
    const state = { messages: [], accept: false };
    page.on("dialog", async (dialog) => { state.messages.push(dialog.message()); await (state.accept ? dialog.accept() : dialog.dismiss()); });
    return state;
  };
  const onTitle = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-slot") === "sheet-title");
  const openRow = async (page, key, text) => {
    if (key === "m390") await page.locator("[data-slot=data-table-cards] > li").filter({ hasText: text }).first().locator("[data-card-open]").click({ position: { x: 6, y: 6 } });
    else await page.locator("tbody tr").filter({ hasText: text }).first().locator("td").nth(1).click();
    await sheet(page).waitFor({ state: "visible" });
  };

  /**
   * Набрать `text` в `field`, нажать Esc: панель на месте, введённое остаётся, фокус на названии, вопроса нет. Вторая Esc: у панели под охраной
   * (`guarded`) — вопрос, «нет» оставляет панель и текст, «да» закрывает; без охраны закрывает сразу.
   */
  async function escKeepsText({ page, report, label, field, text, guarded, asked }) {
    await field.fill(text);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const kept = { sheets: await sheet(page).count(), value: await field.inputValue().catch(() => null), onTitle: await onTitle(page), asked: asked.messages.length };
    report(`${label}: the first Esc in a field only leaves the field (panel stays, typed text stays, focus on the title, no question)`, kept.sheets === 1 && kept.value === text && kept.onTitle && kept.asked === 0, kept);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    if (guarded) {
      const stays = { sheets: await sheet(page).count(), value: await field.inputValue().catch(() => null), question: asked.messages.at(-1) };
      report(`${label}: the second Esc asks about unsaved changes and «нет» keeps the panel and the text`, stays.sheets === 1 && stays.value === text && stays.question === CLOSE_CONFIRM, stays);
      asked.accept = true;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      asked.accept = false;
    }
    report(`${label}: the panel closes at the end`, (await sheet(page).count()) === 0, await sheet(page).count());
  }

  /**
   * «Запросы на удаление» (независимая проверка сборки 2B, 28.10.2026): ручной запрос с отключённым входом, «Отметить выполненным» → заметка
   * «Что сделано» и слово. В прежнем виде эта форма стоит на странице, и набранное не терялось; в панели Esc и щелчок мимо закрывали её без вопроса.
   */
  const NOTE = "Дело, документы и чаты удалены, вход отключён";
  const note = (page) => sheet(page).locator('[data-testid="v3-deletion-note"]');
  async function typedManualDone(env, key) {
    const { context, page, errors } = await env.open("settings-deletion", key);
    const asked = answers(page);
    await openRow(page, key, "Студентка Вымышленная");
    await sheet(page).locator('[data-testid="v3-deletion-manual-start"]').click();
    return { context, page, errors, asked };
  }
  const pushes = (page) => page.evaluate(() => window.__harness.pushes);

  flow("click-outside-deletion d1280", async (env) => {
    const { context, page, asked } = await typedManualDone(env, "d1280");
    await note(page).fill(NOTE);
    await sheet(page).locator('[data-testid="v3-deletion-done-word"]').fill("выполнено");
    await page.mouse.click(20, 450);
    await page.waitForTimeout(300);
    const kept = { sheets: await sheet(page).count(), value: await note(page).inputValue().catch(() => null), question: asked.messages };
    env.report("deletion d1280: a click beside the panel asks about unsaved changes and «нет» keeps the panel and the note", kept.sheets === 1 && kept.value === NOTE && kept.question.length === 1 && kept.question[0] === CLOSE_CONFIRM, kept);
    asked.accept = true;
    await page.mouse.click(20, 450);
    await page.waitForTimeout(300);
    asked.accept = false;
    env.report("deletion d1280: «да» closes the panel and returns to the queue address", (await sheet(page).count()) === 0 && (await pushes(page)).at(-1) === "/v3/settings?section=deletion", await pushes(page));
    await context.close();
  });
  flow("click-outside-deletion-automatic d1280", async (env) => {
    // «Удалить навсегда» необратимо: слово «удалить» в поле тоже не пропадает от щелчка мимо, и команда при этом не уходит.
    const { context, page } = await env.open("settings-deletion", "d1280");
    const asked = answers(page);
    await openRow(page, "d1280", "Заявитель 1");
    await sheet(page).locator('[data-testid="v3-deletion-start"]').click();
    await sheet(page).locator('[data-testid="v3-deletion-word"]').fill("удалить");
    await page.mouse.click(20, 450);
    await page.waitForTimeout(300);
    const kept = { sheets: await sheet(page).count(), value: await sheet(page).locator('[data-testid="v3-deletion-word"]').inputValue().catch(() => null), question: asked.messages, calls: await page.evaluate(() => window.__harness.calls) };
    env.report("deletion d1280 (automatic): a click beside the panel asks and «нет» keeps the panel, the word and sends nothing", kept.sheets === 1 && kept.value === "удалить" && kept.question.length === 1 && kept.question[0] === CLOSE_CONFIRM && kept.calls.length === 0, kept);
    await context.close();
  });
  flow("deletion-nothing-typed d1280", async (env) => {
    const { context, page, asked } = await typedManualDone(env, "d1280");
    await page.mouse.click(20, 450);
    await page.waitForTimeout(300);
    env.report("deletion d1280: an opened but untouched form does not ask", (await sheet(page).count()) === 0 && asked.messages.length === 0, { sheets: await sheet(page).count(), asked: asked.messages });
    await context.close();
  });
  flow("deletion-cancelled d1280", async (env) => {
    const { context, page, asked } = await typedManualDone(env, "d1280");
    await note(page).fill(NOTE);
    await sheet(page).getByRole("button", { name: "Отмена", exact: true }).click();
    await page.mouse.click(20, 450);
    await page.waitForTimeout(300);
    env.report("deletion d1280: after «Отмена» in the form there is nothing to lose and the panel closes without a question", (await sheet(page).count()) === 0 && asked.messages.length === 0, { sheets: await sheet(page).count(), asked: asked.messages });
    await context.close();
  });

  for (const key of ["d1280", "m390"]) {
    flow(`esc-deletion ${key}`, async (env) => {
      const { context, page, asked } = await typedManualDone(env, key);
      await escKeepsText({ page, report: env.report, label: `deletion ${key} «Что сделано»`, field: note(page), text: NOTE, guarded: true, asked });
      await context.close();
    });
    flow(`esc-departments ${key}`, async (env) => {
      const { context, page, errors } = await env.open("settings-departments", key);
      const asked = answers(page);
      await page.getByRole("button", { name: "Добавить отдел" }).click();
      await sheet(page).waitFor({ state: "visible" });
      await escKeepsText({ page, report: env.report, label: `departments ${key} «Добавить отдел»`, field: sheet(page).locator("input[name=name]"), text: "Черновик нового отдела", guarded: true, asked });
      env.report(`departments ${key}: console clean`, errors.length === 0, errors);
      await context.close();
    });
    flow(`esc-roles ${key}`, async (env) => {
      const { context, page } = await env.open("settings-roles-list", key);
      const asked = answers(page);
      await page.getByRole("button", { name: "Создать роль" }).click();
      await sheet(page).waitFor({ state: "visible" });
      await escKeepsText({ page, report: env.report, label: `roles ${key} «Создать роль»`, field: sheet(page).locator("input[name=label]"), text: "Черновик новой роли", guarded: true, asked });
      await context.close();
    });
    flow(`esc-staff ${key}`, async (env) => {
      const { context, page } = await env.open("settings-staff", key);
      const asked = answers(page);
      await openRow(page, key, "Эльмира Формова");
      await sheet(page).getByRole("button", { name: "Редактировать" }).click();
      await escKeepsText({ page, report: env.report, label: `staff ${key} «Редактировать»`, field: sheet(page).locator("input[name=job_title]"), text: "Старший куратор (черновик)", guarded: true, asked });
      await context.close();
    });
    flow(`esc-spend ${key}`, async (env) => {
      const { context, page } = await env.open("marketing-overview", key);
      const asked = answers(page);
      await page.getByRole("button", { name: "Добавить расход" }).click();
      await sheet(page).waitFor({ state: "visible" });
      await escKeepsText({ page, report: env.report, label: `marketing ${key} «Добавить расход»`, field: sheet(page).locator("input[name=amount]"), text: "123.45", guarded: true, asked });
      await context.close();
    });
    flow(`esc-lead-filters ${key}`, async (env) => {
      const { context, page } = await env.open("marketing-leads", key);
      const asked = answers(page);
      await page.getByRole("button", { name: /^Фильтры/u }).click();
      await sheet(page).waitFor({ state: "visible" });
      await escKeepsText({ page, report: env.report, label: `marketing-leads ${key} «Фильтры»`, field: sheet(page).locator("input[name=campaign]"), text: "кампания-черновик", guarded: false, asked });
      await context.close();
    });
    flow(`esc-ai-review ${key}`, async (env) => {
      const { context, page } = await env.open("ai-review", key);
      const asked = answers(page);
      await openRow(page, key, "Прайс 2026 — Малайзия (скан)");
      await sheet(page).getByRole("button", { name: "Исправить", exact: true }).click();
      await escKeepsText({ page, report: env.report, label: `ai-review ${key} «Исправить»`, field: sheet(page).locator("input[name=value]:not([type=hidden])"), text: "1 250", guarded: false, asked });
      await context.close();
    });
  }
};
