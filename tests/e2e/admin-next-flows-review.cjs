"use strict";

/**
 * Сценарии стенда `admin-next-static-render.cjs` по независимой проверке (28.10.2026): то, что она нашла, проверяется здесь на настоящих компонентах
 * в Chromium. Одноразовый пароль и неизвестный итог переживают переключение форм доступа; панели с незавершённым запросом не закрываются, а с
 * несохранённой правкой спрашивают; «Открыть роль» открывает роль; копия роли не уводит фокус из панели; загрузка не обрывается сворачиванием;
 * журнал листается и без названных событий; ошибка применения исправления видна в списке; длинные кнопки переносятся; риск «Интеграций» на виду;
 * таблица «Заявок» без лишних колонок. Каждая проверка — JSON-строка через `report`.
 */
module.exports = function register({ flow: addFlow, sheet, esc, opener, calls, focusLabel, fx }) {
  // Сбой сценария (не нашлась кнопка, вышло время) — это проверка, которая не прошла, а не обрыв всего прогона: остальные сценарии идут дальше.
  const flow = (name, run) => addFlow(name, async (env) => {
    try { await run(env); } catch (error) { env.report(`${name}: the scenario ran to the end`, false, String(error?.message ?? error).split("\n")[0]); }
  });
  const CLOSE_CONFIRM = "Есть несохранённые изменения. Закрыть без сохранения?";
  const SHOWN_ONCE = "Synthetic-OTP-1234";
  const answers = (page) => {
    const state = { messages: [], accept: false };
    page.on("dialog", async (dialog) => { state.messages.push(dialog.message()); await (state.accept ? dialog.accept() : dialog.dismiss()); });
    return state;
  };
  // Урок волны 2A: первая Esc в поле панели только выводит из поля (фокус на названии, вопроса нет); вторая закрывает, а над правкой — спрашивает.
  const escTwice = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(250); await page.keyboard.press("Escape"); await page.waitForTimeout(300); };
  const inSheet = (page) => page.evaluate(() => document.activeElement?.closest("[data-slot=sheet-content]") !== null && document.activeElement !== document.body);
  const toggle = (page, title) => page.locator("button[aria-expanded]", { hasText: title }).first();
  const accountForm = (page) => page.locator("form:has(input[name=operation][value=password])");
  const inviteForm = (page) => page.locator("form:has(input[name=operation][value=invite])");

  /** Заполняет форму «Создать аккаунт» / «Пригласить» без рабочих прав и отправляет. */
  async function submitAccess(form, mode, who) {
    await form.locator("input[name=display_name]").fill(who);
    await form.locator("input[name=email]").fill("synthetic.person@example.test");
    await form.getByText("Создать вход без доступа").click();
    if (mode === "invite") await form.locator("input[name=reason]").fill("Новый куратор, согласовано");
    await form.locator("input[name=recipient_confirmed]").check();
    await form.locator("input[name=rights_confirmed]").check();
    await form.locator("button[type=submit]").click();
  }

  flow("staff-access-kept", async (env) => {
    const { context, page, errors } = await env.open("settings-staff", "d1440");
    const { report } = env;
    report("staff-access-kept: both forms are on the page from the start, hidden", (await accountForm(page).count()) === 1 && (await inviteForm(page).count()) === 1 && (await accountForm(page).isHidden()) && (await inviteForm(page).isHidden()), null);
    await toggle(page, "Создать аккаунт").click();
    report("staff-access-kept: «Создать аккаунт» shows its form and hides the other", (await accountForm(page).isVisible()) && (await inviteForm(page).isHidden()), null);
    await page.evaluate((password) => { window.__harness.results = { staffAuthAction: (_state, fields) => ({ status: "success", message: "Аккаунт создан.", requestId: fields.request_id, oneTimePassword: password }) }; }, SHOWN_ONCE);
    await submitAccess(accountForm(page), "password", "Синтетический Сотрудник");
    await page.waitForTimeout(300);
    const password = page.locator(`input[value="${SHOWN_ONCE}"]`);
    report("staff-access-kept: the one-time password is shown after «Создать аккаунт»", (await password.count()) === 1 && (await password.isVisible()), null);
    await toggle(page, "Пригласить сотрудника").click();
    await toggle(page, "Создать аккаунт").click();
    report("staff-access-kept: one click on the neighbouring button and back does not lose the password", (await password.count()) === 1 && (await password.isVisible()), await password.count());
    await toggle(page, "Создать аккаунт").click();
    await toggle(page, "Создать аккаунт").click();
    report("staff-access-kept: pressing the same toggle twice does not lose it either", (await password.count()) === 1 && (await password.isVisible()), await password.count());
    // «Закрыть» возвращает фокус на кнопку, что открыла форму, а не на страницу.
    await page.getByRole("button", { name: "Закрыть", exact: true }).focus();
    await page.keyboard.press("Enter");
    report("staff-access-kept: «Закрыть» collapses the form", (await toggle(page, "Создать аккаунт").getAttribute("aria-expanded")) === "false" && (await accountForm(page).isHidden()), null);
    report("staff-access-kept: after «Закрыть» focus returns to the button that opened the form (not the page)", (await focusLabel(page)) === "Создать аккаунт", await focusLabel(page));
    await toggle(page, "Пригласить сотрудника").click();
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    report("staff-access-kept: the same after a mouse click, for «Пригласить сотрудника»", (await focusLabel(page)) === "Пригласить сотрудника", await focusLabel(page));
    // Неизвестный итог: тот же запрос уходит с тем же request_id после переключения форм.
    await page.evaluate(() => { window.__harness.results = { staffAuthAction: (_state, fields) => ({ status: "error", outcome: "unknown", requestId: fields.request_id, message: "Ответ не получен. Проверьте тот же запрос." }) }; });
    await toggle(page, "Пригласить сотрудника").click();
    await submitAccess(inviteForm(page), "invite", "Приглашённый Куратор");
    await page.waitForTimeout(300);
    const again = page.getByRole("button", { name: "Проверить тот же запрос" });
    report("staff-access-kept: an unknown outcome offers «Проверить тот же запрос»", (await again.count()) === 1, await again.count());
    await toggle(page, "Создать аккаунт").click();
    await toggle(page, "Пригласить сотрудника").click();
    report("staff-access-kept: the unknown-outcome request survives switching forms", (await again.count()) === 1 && (await again.isEnabled()), await again.count());
    await again.click();
    await page.waitForTimeout(300);
    const sent = (await calls(page)).filter(([name, fields]) => name === "staffAuthAction" && fields && fields.operation === "invite");
    report("staff-access-kept: the retry resends the same request_id", sent.length === 2 && sent[0][1].request_id === sent[1][1].request_id && Boolean(sent[0][1].request_id), sent.map(([, fields]) => fields.request_id));
    report("staff-access-kept: console clean", errors.length === 0, errors);
    await context.close();
  });

  flow("staff-sheets-guarded", async (env) => {
    const { context, page, errors } = await env.open("settings-staff", "d1440");
    const { report } = env;
    const asked = answers(page);
    // Журнал доступа: проверка с неизвестным итогом держит панель.
    await page.evaluate(() => { window.__harness.results = { staffAuthAction: (_state, fields) => ({ status: "error", outcome: "unknown", requestId: fields.request_id, message: "Ответ не получен. Проверьте этот запрос ещё раз." }) }; });
    await page.getByRole("button", { name: /Журнал доступа · 3/u }).click();
    await sheet(page).waitFor({ state: "visible" });
    await sheet(page).getByRole("button", { name: "Проверить результат" }).first().click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    report("staff-sheets-guarded: «Журнал доступа» with an unknown outcome does not close on Esc", (await sheet(page).count()) === 1, await sheet(page).count());
    report("staff-sheets-guarded: and says why", /панель не закрывается/u.test(await sheet(page).innerText()), null);
    await page.evaluate(() => { window.__harness.results = { staffAuthAction: (_state, fields) => ({ status: "success", message: "Результат проверен.", requestId: fields.request_id }) }; });
    await sheet(page).getByRole("button", { name: "Проверить результат" }).first().click();
    await page.waitForTimeout(300);
    await esc(page);
    report("staff-sheets-guarded: once the result is checked the panel closes", (await sheet(page).count()) === 0, await sheet(page).count());
    // Сотрудник: блокировка доступа с неизвестным итогом держит панель.
    await page.evaluate(() => { window.__harness.results = { staffMemberAction: (_state, fields) => ({ status: "error", outcome: "unknown", requestId: fields.request_id, message: "Ответ не получен. Проверьте сохранение." }) }; });
    await page.locator("tr", { hasText: "Камила Вымыслова" }).first().locator("td").nth(1).click();
    await sheet(page).waitFor({ state: "visible" });
    await sheet(page).getByRole("button", { name: "Доступ", exact: true }).click();
    await sheet(page).locator("form:has(input[name=operation][value=status]) input[name=reason]").fill("Проверка стенда");
    await sheet(page).getByRole("button", { name: "Заблокировать доступ" }).click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    report("staff-sheets-guarded: a member sheet with an unknown outcome does not close on Esc", (await sheet(page).count()) === 1 && (await sheet(page).getByRole("button", { name: "Проверить сохранение" }).count()) === 1, await sheet(page).count());
    report("staff-sheets-guarded: no confirm was shown for a locked panel", asked.messages.length === 0, asked.messages);
    await page.reload();
    await page.waitForSelector("html[data-ready=true]", { state: "attached" });
    // Правка в панели сотрудника: Esc спрашивает; «нет» оставляет панель с введённым.
    await page.locator("tr", { hasText: "Эльмира Формова" }).first().locator("td").nth(1).click();
    await sheet(page).waitFor({ state: "visible" });
    await sheet(page).getByRole("button", { name: "Редактировать" }).click();
    await esc(page);
    report("staff-sheets-guarded: an opened but untouched editor closes without a question", (await sheet(page).count()) === 0 && asked.messages.length === 0, asked.messages);
    await page.locator("tr", { hasText: "Эльмира Формова" }).first().locator("td").nth(1).click();
    await sheet(page).waitFor({ state: "visible" });
    await sheet(page).getByRole("button", { name: "Редактировать" }).click();
    await sheet(page).locator("input[name=job_title]").fill("Старший куратор");
    await escTwice(page);
    report("staff-sheets-guarded: Esc over a typed edit asks first, and «нет» keeps the sheet and the text", asked.messages.at(-1) === CLOSE_CONFIRM && (await sheet(page).count()) === 1 && (await sheet(page).locator("input[name=job_title]").inputValue()) === "Старший куратор", asked.messages);
    asked.accept = true;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    report("staff-sheets-guarded: «да» closes", (await sheet(page).count()) === 0, null);
    report("staff-sheets-guarded: console clean", errors.length === 0, errors);
    await context.close();
  });

  flow("roles-sheets", async (env) => {
    const { context, page, errors } = await env.open("settings-roles-list", "d1440");
    const { report } = env;
    const asked = answers(page);
    // «Открыть роль» после создания: страница приходит с `?role=`, и панель роли открывается.
    await page.getByRole("button", { name: "Создать роль" }).click();
    await sheet(page).waitFor({ state: "visible" });
    await page.evaluate((roleId) => { window.__harness.results = { staffRolesAction: (_state, fields) => ({ status: "success", message: "Черновик роли сохранён.", roleId, requestId: fields.request_id }) }; }, fx.settings.ROLES[1].id);
    await sheet(page).locator("input[name=label]").fill("Синтетическая роль");
    await sheet(page).locator("input[name=reason]").fill("Проверка стенда");
    await sheet(page).getByRole("button", { name: "Сохранить черновик" }).click();
    await page.waitForTimeout(300);
    await sheet(page).getByRole("link", { name: "Открыть роль" }).click();
    await page.waitForTimeout(500);
    report("roles-sheets: «Открыть роль» opens the role's sheet", (await sheet(page).count()) === 1 && /Sales Manager/u.test(await sheet(page).locator("[data-slot=sheet-title]").innerText()), await sheet(page).count());
    await esc(page);
    // Копия роли: тот же панель, фокус внутри, Esc возвращает фокус на строку.
    await opener(page, "Admissions").focus();
    await page.keyboard.press("Enter");
    await sheet(page).waitFor({ state: "visible" });
    await sheet(page).getByRole("button", { name: "Скопировать" }).click();
    await page.waitForTimeout(700);
    report("roles-sheets: «Скопировать» keeps keyboard focus inside the panel, on the copy form", (await inSheet(page)) && (await page.evaluate(() => document.activeElement?.getAttribute("name"))) === "label", await focusLabel(page));
    report("roles-sheets: only one panel is open", (await sheet(page).count()) === 1 && /копия/u.test(await sheet(page).locator("input[name=label]").inputValue()), await sheet(page).count());
    await page.keyboard.press("Tab");
    report("roles-sheets: Tab stays inside the panel", await inSheet(page), await focusLabel(page));
    await esc(page);
    report("roles-sheets: an untouched copy closes without a question and returns focus to the row's button", asked.messages.length === 0 && (await focusLabel(page)) === "Открыть: Admissions", [asked.messages, await focusLabel(page)]);
    // Правка роли и новая роль: Esc и щелчок мимо спрашивают.
    await page.locator("tr", { hasText: "Sales Manager" }).first().locator("td").nth(1).click();
    await sheet(page).waitFor({ state: "visible" });
    await sheet(page).getByRole("button", { name: "Изменить", exact: true }).click();
    await sheet(page).locator("textarea[name=description]").fill("ЧЕРНОВИК описания");
    await escTwice(page);
    report("roles-sheets: Esc over a typed role edit asks first; «нет» keeps the draft", asked.messages.at(-1) === CLOSE_CONFIRM && (await sheet(page).count()) === 1 && (await sheet(page).locator("textarea[name=description]").inputValue()) === "ЧЕРНОВИК описания", asked.messages);
    await page.mouse.click(8, 8);
    await page.waitForTimeout(300);
    report("roles-sheets: a click outside asks the same and keeps the sheet", asked.messages.length === 2 && (await sheet(page).count()) === 1, asked.messages);
    asked.accept = true;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    report("roles-sheets: «да» closes", (await sheet(page).count()) === 0, null);
    asked.accept = false;
    await page.getByRole("button", { name: "Создать роль" }).click();
    await sheet(page).waitFor({ state: "visible" });
    await sheet(page).locator("input[name=label]").fill("Черновик новой роли");
    await escTwice(page);
    report("roles-sheets: a typed new role is not dropped silently either", asked.messages.length === 4 && (await sheet(page).count()) === 1, asked.messages);
    report("roles-sheets: console clean", errors.length === 0, errors);
    await context.close();
  });

  flow("marketing-spend-guard", async (env) => {
    const { context, page, errors } = await env.open("marketing-overview", "d1440");
    const { report } = env;
    const asked = answers(page);
    await page.getByRole("button", { name: "Добавить расход" }).click();
    await sheet(page).waitFor({ state: "visible" });
    await esc(page);
    report("marketing-spend-guard: an untouched «Добавить расход» closes without a question", (await sheet(page).count()) === 0 && asked.messages.length === 0, asked.messages);
    await page.getByRole("button", { name: "Добавить расход" }).click();
    await sheet(page).waitFor({ state: "visible" });
    await sheet(page).locator("input[name=amount]").fill("100");
    await escTwice(page);
    report("marketing-spend-guard: Esc over a typed amount asks first; «нет» keeps the sheet and the amount", asked.messages.at(-1) === CLOSE_CONFIRM && (await sheet(page).count()) === 1 && (await sheet(page).locator("input[name=amount]").inputValue()) === "100", asked.messages);
    await sheet(page).getByRole("button", { name: "Записать расход" }).click();
    await page.waitForTimeout(300);
    await esc(page);
    report("marketing-spend-guard: after «Записать расход» the sheet closes without a question", (await sheet(page).count()) === 0 && asked.messages.length === 1, asked.messages);
    report("marketing-spend-guard: console clean", errors.length === 0, errors);
    await context.close();
  });

  flow("ai-upload-kept", async (env) => {
    const { context, page, errors } = await env.open("ai-documents", "d1440");
    const { report } = env;
    // Передача идёт «вручную»: XHR подменён, запрос не завершается, обрыв считается.
    await page.evaluate(() => {
      window.__xhr = { opened: 0, aborted: 0 };
      window.XMLHttpRequest = class {
        constructor() { this.upload = {}; this.status = 0; this.response = null; }
        open() { window.__xhr.opened += 1; }
        send() { setTimeout(() => this.upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 }), 0); }
        abort() { window.__xhr.aborted += 1; }
      };
    });
    const toggleButton = page.getByRole("button", { name: "Загрузить материал", exact: true }).first();
    await toggleButton.click();
    await page.locator('[data-testid="v3-ai-upload-input"]').setInputFiles({ name: "price-2026.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic") });
    await page.locator('[data-testid="v3-ai-upload-client"]').check();
    await page.locator('[data-testid="v3-ai-upload-company"]').check();
    await page.locator('[data-testid="v3-ai-upload-submit"]').click();
    await page.waitForTimeout(300);
    report("ai-upload-kept: the percent shows while the upload runs", /Загружаем… 40%/u.test(await page.locator('[data-testid="v3-ai-upload-submit"]').innerText()), null);
    await toggleButton.click();
    await page.waitForTimeout(200);
    report("ai-upload-kept: collapsing the panel during the upload does not abort it", (await page.evaluate(() => window.__xhr.aborted)) === 0, await page.evaluate(() => window.__xhr));
    report("ai-upload-kept: the panel is collapsed", (await toggleButton.getAttribute("aria-expanded")) === "false" && (await page.locator('[data-testid="v3-ai-upload-submit"]').isHidden()), null);
    await toggleButton.click();
    report("ai-upload-kept: opening it again shows the same upload, not an empty form", /Загружаем… 40%/u.test(await page.locator('[data-testid="v3-ai-upload-submit"]').innerText()), null);
    report("ai-upload-kept: console clean", errors.length === 0, errors);
    await context.close();
  });

  flow("journal-unnamed", async (env) => {
    const { context, page, errors } = await env.open("settings-journal-unnamed", "d1440");
    const { report } = env;
    report("journal-unnamed: events without a name are counted", /2 события без названия/u.test(await page.locator("main").innerText()), null);
    const next = page.getByRole("link", { name: "Следующие события" });
    report("journal-unnamed: «Следующие события» still leads on when no event on the page has a name", (await next.count()) === 1 && (await next.getAttribute("href"))?.includes("snapshot="), await next.count());
    report("journal-unnamed: console clean", errors.length === 0, errors);
    await context.close();
  });

  flow("ai-review-error", async (env) => {
    const { context, page, errors } = await env.open("ai-review", "d1440");
    const { report } = env;
    const failed = page.locator("tr", { hasText: "Инженерия" }).first();
    const fine = page.locator("tr", { hasText: "Компьютерные науки" }).first();
    report("ai-review-error: an open item whose correction failed says so in the list", /Исправление не применилось/u.test(await failed.innerText()), await failed.innerText());
    report("ai-review-error: an item without an error does not", !/не применилось/u.test(await fine.innerText()), null);
    report("ai-review-error: the full sentence is still in the sheet", await (async () => { await failed.locator("td").nth(1).click(); await sheet(page).waitFor({ state: "visible" }); return /число встречается в тексте не один раз/u.test(await sheet(page).innerText()); })(), null);
    await esc(page);
    const phone = await env.open("ai-review", "m390");
    report("ai-review-error: and on the phone", /Исправление не применилось/u.test(await phone.page.locator("main").innerText()), null);
    await phone.context.close();
    report("ai-review-error: console clean", errors.length === 0, errors);
    await context.close();
  });

  flow("ai-narrow-buttons", async (env) => {
    const { report } = env;
    for (const key of ["m390", "m360", "m320"]) {
      const { context, page, errors } = await env.open("ai-spend", key);
      await page.locator('[data-testid="v3-ai-consent-revoke"] summary').click();
      await page.waitForTimeout(150);
      const box = await page.evaluate(() => {
        const right = (selector) => document.querySelector(selector)?.getBoundingClientRect().right ?? null;
        const doc = document.documentElement;
        return { card: right('[data-testid="v3-ai-settings"]'), button: right('[data-testid="v3-ai-consent-revoke"] button[type=submit]'), width: doc.clientWidth, main: document.querySelector("main").scrollWidth - document.querySelector("main").clientWidth };
      });
      report(`ai-narrow-buttons ${key}: the open «Отозвать согласие» fits the card and the screen`, box.card <= box.width && box.button <= box.width && box.main <= 1, box);
      report(`ai-narrow-buttons ${key}: the revoke label (the risk wording) is whole on the button`, /Отозвать — ИИ перестанет готовить ответы/u.test(await page.locator('[data-testid="v3-ai-consent-revoke"] button[type=submit]').innerText()), null);
      report(`ai-narrow-buttons ${key}: console clean`, errors.length === 0, errors);
      await context.close();
    }
    for (const key of ["m360", "m320"]) {
      const { context, page, errors } = await env.open("ai-documents", key);
      await page.getByRole("button", { name: /Открыть: scan_0042/u }).first().click();
      await sheet(page).waitFor({ state: "visible" });
      await page.waitForTimeout(250);
      const over = await sheet(page).evaluate((panel) => {
        const limit = panel.getBoundingClientRect().right;
        const clipped = [...panel.querySelectorAll("button, p, a")].filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.right > limit + 1; }).map((element) => (element.textContent || "").trim().slice(0, 40));
        const viewport = panel.querySelector("[data-slot=scroll-area-viewport]");
        return { clipped, scroll: viewport ? viewport.scrollWidth - viewport.clientWidth : 0 };
      });
      report(`ai-narrow-buttons ${key}: the document panel's commands and warning fit the panel`, over.clipped.length === 0 && over.scroll <= 1, over);
      report(`ai-narrow-buttons ${key}: console clean`, errors.length === 0, errors);
      await context.close();
    }
  });

  flow("integrations-risk-visible", async (env) => {
    const { report } = env;
    for (const key of ["d1440", "d1280"]) {
      const { context, page, errors } = await env.open("settings-integrations", key);
      for (const words of [/Синхронизация с amoCRM не выполняется/u, /Входящие WhatsApp не приходят/u]) {
        const found = page.getByText(words).first();
        report(`integrations-risk-visible ${key}: «${words.source.slice(0, 30)}…» is on the screen`, (await found.count()) > 0 && (await found.isVisible()), null);
      }
      report(`integrations-risk-visible ${key}: the «Что не работает» header is visible`, await page.getByRole("columnheader", { name: "Что не работает" }).isVisible().catch(() => false), null);
      report(`integrations-risk-visible ${key}: console clean`, errors.length === 0, errors);
      await context.close();
    }
  });

  flow("leads-table-lean", async (env) => {
    const { report } = env;
    for (const key of ["d1440", "d1280"]) {
      const { context, page, errors } = await env.open("marketing-leads", key);
      const facts = await page.evaluate(() => {
        const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
        const headers = [...document.querySelectorAll("thead th")].filter(visible).map((element) => element.textContent.trim());
        const name = [...document.querySelectorAll("tbody tr td span")].find((element) => /Лид Вымышленный 1$/u.test(element.textContent.trim()) && visible(element));
        const lineHeight = name ? parseFloat(getComputedStyle(name).lineHeight) : 0;
        return { headers, lines: name ? Math.round(name.getBoundingClientRect().height / lineHeight) : null, row: name ? Math.round(name.closest("tr").getBoundingClientRect().height) : null };
      });
      report(`leads-table-lean ${key}: at most five columns (name + four facts); the rest is in the sheet`, facts.headers.length <= 5 && !facts.headers.includes("Телефон") && !facts.headers.includes("Кампания"), facts.headers);
      report(`leads-table-lean ${key}: the lead's name takes at most two lines and the row stays low`, facts.lines !== null && facts.lines <= 2 && facts.row <= 90, facts);
      report(`leads-table-lean ${key}: console clean`, errors.length === 0, errors);
      await context.close();
    }
  });

  flow("settings-fits-narrow", async (env) => {
    const { report } = env;
    for (const key of ["d1024", "m390", "m360", "m320"]) {
      const { context, page, errors } = await env.open("settings-staff", key);
      const facts = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const log = [...document.querySelectorAll("button")].find((element) => /Журнал доступа/u.test(element.textContent));
        const create = [...document.querySelectorAll("button")].find((element) => /Создать аккаунт/u.test(element.textContent) && element.hasAttribute("aria-expanded"));
        const values = [...document.querySelectorAll("tbody tr, [data-card-open]")].slice(0, 2).map((row) => row.getBoundingClientRect().right);
        return { width, log: log?.getBoundingClientRect().right ?? null, create: create?.getBoundingClientRect().right ?? null, rows: values };
      });
      report(`settings-fits-narrow ${key}: «Журнал доступа», «Создать аккаунт» and the rows are inside the screen`, facts.log <= facts.width && facts.create <= facts.width && facts.rows.every((right) => right <= facts.width + 1), facts);
      report(`settings-fits-narrow ${key}: console clean`, errors.length === 0, errors);
      await context.close();
    }
  });
};
