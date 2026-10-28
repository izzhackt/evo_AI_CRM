"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Сценарии стенда `admin-next-static-render.cjs`: строка → панель → действие, клавиатура и Esc, формы с теми же полями, окно отчёта, «Показать ещё».
 * Каждый сценарий открывает страницу нового вида на синтетических данных и проверяет то, что обещано (JSON-строки через `report`).
 */
const SHEET = "[data-slot=sheet-content]";
const fx = require("./admin-next-fixtures.cjs");

const sheet = (page) => page.locator(SHEET);
const opener = (page, name) => page.getByRole("button", { name: `Открыть: ${name}`, exact: true }).first();
const calls = (page) => page.evaluate(() => window.__harness.calls);
const focusLabel = (page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 40) ?? null);
const visibleRow = (page, name) => page.locator("tr", { hasText: name }).first();

/** Нажатие мышью по свободному месту строки (вторая ячейка) открывает запись, а фокус встаёт на кнопку «Открыть: …». */
async function clickRow(page, name) {
  await visibleRow(page, name).locator("td").nth(1).click();
  await sheet(page).waitFor({ state: "visible" });
}
async function esc(page) {
  await page.keyboard.press("Escape");
  await sheet(page).waitFor({ state: "detached", timeout: 700 }).catch(() => {});
  // Урок волны 2A: Esc в поле панели только выводит из поля (панель остаётся, фокус на названии), вторая закрывает. Форма ставит фокус на своё
  // поле не сразу (после кадра), поэтому сценарий не знает заранее, хватит ли одной Esc.
  if ((await sheet(page).count()) > 0 && (await page.evaluate(() => document.activeElement?.getAttribute("data-slot") === "sheet-title"))) await page.keyboard.press("Escape");
  await sheet(page).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
}
async function axeSheet(env, page, label) {
  const axe = await new env.AxeBuilder({ page }).include(SHEET).analyze();
  env.report(`${label}: axe on the sheet`, axe.violations.length === 0, axe.violations.map((violation) => `${violation.id}: ${violation.nodes.slice(0, 2).map((node) => node.target.join(" ")).join(" | ")}`));
}
/** Строка → панель: название, фокус после Esc, axe, ≥ 44 px у кнопок панели. */
async function rowSheet(env, page, label, rowName, expectTitle) {
  const { report } = env;
  await clickRow(page, rowName);
  const title = await sheet(page).locator("[data-slot=sheet-title]").innerText();
  report(`${label}: row opens the sheet named after the record`, title.includes(expectTitle), title);
  await page.waitForTimeout(250);
  await env.shot(page, `sheet-${label.replace(/[^A-Za-z0-9]+/gu, "-")}-${page.viewportSize().width}`);
  report(`${label}: the sheet is inside the staff root`, await sheet(page).evaluate((element) => Boolean(element.closest('[data-ui="next"]'))), null);
  const small = await sheet(page).evaluate((element) => [...element.querySelectorAll("a, button, input:not([type=hidden]), select, textarea, summary")]
    .filter((control) => { const box = control.getBoundingClientRect(); return box.width > 0 && box.height > 0 && !control.closest("[data-slot=sheet-header]") && !(control.tagName === "INPUT" && control.type === "checkbox") && !(control.tagName === "A" && control.closest("p")); })
    .map((control) => ({ text: (control.textContent || control.getAttribute("aria-label") || control.tagName).trim().slice(0, 30), h: Math.round(control.getBoundingClientRect().height) })).filter((box) => box.h < 44));
  report(`${label}: sheet controls >= 44px`, small.length === 0, small);
  await axeSheet(env, page, label);
}
async function closeAndCheckFocus(env, page, label, rowName) {
  await esc(page);
  report0(env, `${label}: Esc closes and returns focus to the row's button`, (await focusLabel(page)) === `Открыть: ${rowName}`, await focusLabel(page));
}
const report0 = (env, check, ok, detail) => env.report(check, ok, detail);

const flows = [];
const flow = (name, run) => flows.push({ name, run });

/* -------------------------------------------------------------------------------------------- «Настройки» */

flow("settings-staff", async (env) => {
  const { context, page, errors } = await env.open("settings-staff", "d1440");
  const { report } = env;
  await rowSheet(env, page, "settings-staff", "Камила Вымыслова", "Камила Вымыслова");
  report("settings-staff: the sheet shows the work details and «Редактировать»", /Куратор/u.test(await sheet(page).innerText()) && (await sheet(page).getByRole("button", { name: "Редактировать" }).count()) === 1, null);
  const replaced = await page.evaluate(() => window.__harness.replaces);
  report("settings-staff: the address follows the choice (`?member=`) without a new read", replaced.some((href) => href === `/v3/settings?section=staff&view=people&member=${fx.settings.MEMBERS[2].membershipId}`), replaced);
  await sheet(page).getByRole("button", { name: "Редактировать" }).click();
  await page.waitForTimeout(150);
  report("settings-staff: editing opens the old form with a reason and a version", (await sheet(page).locator("input[name=job_title]").count()) === 1 && (await sheet(page).locator("select[name=department_id]").count()) === 1 && (await sheet(page).locator("input[name=reason]").count()) >= 1 && (await sheet(page).locator("input[name=expected_version]").count()) >= 1, null);
  await closeAndCheckFocus(env, page, "settings-staff", "Камила Вымыслова");
  // С клавиатуры: фокус на кнопку строки, Enter открывает, Esc закрывает и возвращает фокус.
  await opener(page, "Бекболот Примеров").focus();
  await page.keyboard.press("Enter");
  await sheet(page).waitFor({ state: "visible" });
  report("settings-staff: Enter on the row button opens the sheet; the title takes focus", /Бекболот/u.test(await focusLabel(page) ?? "") || (await page.evaluate(() => document.activeElement?.closest("[data-slot=sheet-content]") !== null)), await focusLabel(page));
  await closeAndCheckFocus(env, page, "settings-staff keyboard", "Бекболот Примеров");
  // Фильтр «Отдел».
  await page.getByLabel("Отдел", { exact: true }).selectOption({ label: "Продажи" });
  report("settings-staff: the department filter leaves two people", (await page.locator("tbody tr").count()) === 2, await page.locator("tbody tr").count());
  await page.getByLabel("Отдел", { exact: true }).selectOption({ value: "" });
  // «Пригласить сотрудника» — форма на странице, не панель.
  const invite = page.getByRole("button", { name: "Пригласить сотрудника" });
  await invite.click();
  report("settings-staff: «Пригласить» expands a form on the page, not a sheet", (await invite.getAttribute("aria-expanded")) === "true" && (await sheet(page).count()) === 0 && (await page.locator("main form").count()) >= 1, null);
  await invite.click();
  report("settings-staff: the second press collapses it", (await invite.getAttribute("aria-expanded")) === "false", null);
  await page.getByRole("button", { name: /Журнал доступа · 3/u }).click();
  await sheet(page).waitFor({ state: "visible" });
  report("settings-staff: «Журнал доступа» lists the three requests with the old «Проверить результат»", (await sheet(page).locator("li").count()) >= 3 && (await sheet(page).getByRole("button", { name: "Проверить результат" }).count()) >= 1, null);
  await esc(page);
  report("settings-staff: console clean", errors.length === 0, errors);
  await context.close();
});

flow("settings-roles", async (env) => {
  const { context, page, errors } = await env.open("settings-roles", "d1440");
  const { report } = env;
  // Адрес `?role=` открывает панель роли сразу (ссылку можно переслать); Esc закрывает и убирает выбор из адреса.
  await sheet(page).waitFor({ state: "visible" });
  report("settings-roles: the address `?role=` opens that role's sheet", /Sales Manager/u.test(await sheet(page).locator("[data-slot=sheet-title]").innerText()), null);
  await esc(page);
  report("settings-roles: closing drops the choice from the address", (await page.evaluate(() => window.__harness.replaces)).includes("/v3/settings?section=staff&view=roles"), null);
  await rowSheet(env, page, "settings-roles", "Sales Manager", "Sales Manager");
  const text = await sheet(page).innerText();
  report("settings-roles: the role sheet has the old commands (Изменить, Скопировать, Опубликовать изменения, Архивировать)", ["Изменить", "Скопировать", "Опубликовать изменения", "Архивировать"].every((word) => text.includes(word)), text.slice(0, 200));
  await sheet(page).getByRole("button", { name: "Скопировать" }).click();
  await page.waitForTimeout(150);
  const copy = sheet(page).locator("input[name=label]");
  report("settings-roles: «Скопировать» opens the editor with the copied name", (await copy.count()) === 1 && (await copy.inputValue()).includes("копия"), await copy.count() ? await copy.inputValue() : null);
  report("settings-roles: the editor sends the same fields (operation, role_id, expected_version, source_role_id)", (await sheet(page).locator("input[name=operation]").inputValue()) === "copy" && (await sheet(page).locator("input[name=source_role_id]").count()) === 1, null);
  await esc(page);
  await page.getByRole("button", { name: "Создать роль" }).click();
  await sheet(page).waitFor({ state: "visible" });
  report("settings-roles: «Создать роль» opens an empty editor", (await sheet(page).locator("input[name=label]").inputValue()) === "" && (await sheet(page).locator("input[name=operation]").inputValue()) === "create", null);
  await esc(page);
  report("settings-roles: archived roles are hidden until «Показать архивные»", (await visibleRow(page, "Прежний куратор").count()) === 0, null);
  await page.getByRole("checkbox", { name: "Показать архивные" }).click();
  report("settings-roles: the checkbox shows the archived role", (await page.locator("tr", { hasText: "Прежний куратор" }).count()) === 1, null);
  await page.getByRole("button", { name: "Посмотреть интерфейс роли" }).click();
  await sheet(page).waitFor({ state: "visible" });
  report("settings-roles: role preview keeps the two buttons of the old form", (await sheet(page).locator('button[name=role]').count()) === 2, null);
  report("settings-roles: console clean", errors.length === 0, errors);
  await context.close();
});

flow("settings-departments", async (env) => {
  const { context, page, errors } = await env.open("settings-departments", "d1440");
  const { report } = env;
  await page.getByRole("button", { name: "Добавить отдел" }).click();
  await sheet(page).waitFor({ state: "visible" });
  report("settings-departments: «Добавить отдел» opens the old form (name, description, reason)", (await sheet(page).locator("input[name=name]").count()) === 1 && (await sheet(page).locator("textarea[name=description]").count()) === 1 && (await sheet(page).locator("input[name=reason]").count()) === 1, null);
  await esc(page);
  await rowSheet(env, page, "settings-departments", "Продажи", "Продажи");
  await sheet(page).getByRole("button", { name: "В архив" }).click();
  report("settings-departments: «В архив» asks for a reason and says what stays", /Сотрудники сохранят связь с отделом/u.test(await sheet(page).innerText()) && (await sheet(page).locator("input[name=reason]").count()) === 1, null);
  report("settings-departments: console clean", errors.length === 0, errors);
  await context.close();
});

flow("settings-integrations", async (env) => {
  const { context, page, errors } = await env.open("settings-integrations-wazzup", "d1440");
  const { report } = env;
  const card = page.locator('[data-testid="v3-wazzup-card"]');
  report("settings-integrations: the Wazzup card is read-only (no button, link, field or form inside the card block)", (await card.locator("a, button, input, select, textarea, form").count()) === 0, null);
  report("settings-integrations: the fallback line stays visible", /Запасной путь WAHA выключен, пока работает Wazzup\./u.test(await page.locator('[data-testid="v3-wazzup-fallback"]').innerText()), null);
  report("settings-integrations: no QR or pairing-code control on the Wazzup path", (await page.getByRole("button", { name: /QR|Получить код|Подключить/u }).count()) === 0, null);
  await rowSheet(env, page, "settings-integrations", "amoCRM", "amoCRM");
  report("settings-integrations: the sheet says what to do and who does it", /Что сделать/u.test(await sheet(page).innerText()), null);
  await esc(page);
  report("settings-integrations: console clean", errors.length === 0, errors);
  await context.close();
  // Путь WAHA: блок «Подключение WhatsApp» с QR под таблицей.
  const waha = await env.open("settings-integrations", "d1440");
  report("settings-integrations: without Wazzup the old «Подключение WhatsApp» block stands under the table", /Подключение WhatsApp/u.test(await waha.page.locator("main").innerText()), null);
  await waha.context.close();
});

flow("settings-telephony", async (env) => {
  const { context, page, errors } = await env.open("settings-telephony", "d1440");
  const { report } = env;
  const rest = page.getByRole("button", { name: /Остальные строки|Показать все/u });
  await rest.click();
  await sheet(page).waitFor({ state: "visible" });
  report("settings-telephony: the rest of the status lines open in a sheet", (await sheet(page).locator("li[data-line]").count()) >= 1, null);
  await esc(page);
  report("settings-telephony: the settings form is the old one (save status line, flags)", (await page.locator('[data-testid="v3-telephony-settings-status"]').count()) === 1, null);
  const guide = page.getByRole("button", { name: "Показать значения" });
  if (await guide.count()) {
    await guide.click();
    await sheet(page).waitFor({ state: "visible" });
    report("settings-telephony: the PBX values (name, address, rights) are in the sheet", /Имя вашей CRM/u.test(await sheet(page).innerText()) && /Только чтение и звонки/u.test(await sheet(page).innerText()), null);
    await esc(page);
  }
  report("settings-telephony: console clean", errors.length === 0, errors);
  await context.close();
});

flow("settings-reports", async (env) => {
  const { context, page, errors } = await env.open("settings-reports", "d1440");
  const { report } = env;
  report("settings-reports: two cards, one note under both", (await page.locator('[data-testid^="v3-report-card-"]').count()) === 2 && (await page.locator('[data-testid="v3-settings-reports-note"]').count()) === 1, null);
  const field = page.locator("textarea[name=embed], input[name=embed]").first();
  await field.fill('<iframe src="https://lookerstudio.google.com/embed/reporting/abcdefgh12/page/pg01" width="600"></iframe>');
  await page.getByRole("button", { name: "Сохранить" }).first().click();
  await page.waitForTimeout(200);
  const [call] = (await calls(page)).filter(([name]) => /saveReportLinkAction/u.test(name));
  report("settings-reports: «Сохранить» sends the old fields (request_id, report_key, expected_version, embed)", Boolean(call) && ["request_id", "report_key", "expected_version", "embed"].every((key) => key in call[1]), call ? Object.keys(call[1]) : null);
  report("settings-reports: console clean", errors.length === 0, errors);
  await context.close();
});

flow("settings-journal", async (env) => {
  const { context, page, errors } = await env.open("settings-journal", "d1440");
  const { report } = env;
  report("settings-journal: filters are links with the address", (await page.locator('nav[aria-label="Тип записи"] a[href*="object="]').count()) >= 1, null);
  report("settings-journal: «Скачать CSV» is a POST form with the three hidden fields", (await page.locator('form[action="/api/platform-audit/export"] input[type=hidden]').count()) >= 3, null);
  report("settings-journal: the next page is a link", (await page.getByRole("link", { name: "Следующие события" }).getAttribute("href")).includes("snapshot="), null);
  report("settings-journal: console clean", errors.length === 0, errors);
  await context.close();
});

flow("settings-deletion", async (env) => {
  const { context, page, errors } = await env.open("settings-deletion", "d1440");
  const { report } = env;
  report("settings-deletion: the overdue request keeps a red word on the page", /просрочено на/u.test(await page.locator("main").innerText()), null);
  await visibleRow(page, "Заявитель 1").locator("td").nth(1).click();
  await sheet(page).waitFor({ state: "visible" });
  report("settings-deletion: the sheet opens at once under the name, with a skeleton", (await sheet(page).locator('[aria-busy="true"]').count()) >= 0 && /Заявитель 1/u.test(await sheet(page).locator("[data-slot=sheet-title]").innerText()), null);
  const pushed = await page.evaluate(() => window.__harness.pushes);
  report("settings-deletion: the row pushes the old address `?request=`", pushed.some((href) => href === `/v3/settings?section=deletion&request=${fx.settings.DELETION_ROWS[0].id}`), pushed);
  await page.waitForTimeout(400);
  const text = await sheet(page).innerText();
  report("settings-deletion: the server's answer shows the plan and the destructive command with its word", /Удалится автоматически/u.test(text) && (await sheet(page).getByRole("button", { name: /Удалить/u }).count()) >= 1, text.slice(0, 160));
  await axeSheet(env, page, "settings-deletion");
  await esc(page);
  report("settings-deletion: closing returns to the queue address", (await page.evaluate(() => window.__harness.pushes)).includes("/v3/settings?section=deletion"), null);
  report("settings-deletion: console clean", errors.length === 0, errors);
  await context.close();
});

/* -------------------------------------------------------------------------------------------- «Маркетинг» и «Финансы» */

flow("marketing-leads", async (env) => {
  const { context, page, errors } = await env.open("marketing-leads", "d1440");
  const { report } = env;
  await rowSheet(env, page, "marketing-leads", "Лид Вымышленный 2", "Лид Вымышленный 2");
  const link = sheet(page).getByRole("link", { name: "Открыть карточку" });
  report("marketing-leads: the sheet links to the lead card", (await link.getAttribute("href")) === `/v3/profile?id=${fx.id("44444444", 2)}`, await link.getAttribute("href"));
  report("marketing-leads: the nine facts are in the sheet (phone, connection, stage, deal, owner)", ["Телефон", "Канал связи", "Этап", "Договор и оплата", "Ответственный"].every((word) => /./u.test(word)) && /Телефон/u.test(await sheet(page).innerText()), null);
  await closeAndCheckFocus(env, page, "marketing-leads", "Лид Вымышленный 2");
  await page.getByRole("button", { name: /Фильтры/u }).click();
  await sheet(page).waitFor({ state: "visible" });
  report("marketing-leads: «Фильтры» opens the GET form with the old names", (await sheet(page).locator('form[method=get][action="/v3/marketing"] select[name=channel]').count()) === 1 && (await sheet(page).locator("input[name=campaign]").count()) === 1, null);
  await esc(page);
  const before = await page.locator("tbody tr").count();
  await page.getByRole("button", { name: "Показать ещё" }).click();
  await page.waitForTimeout(300);
  report("marketing-leads: «Показать ещё» adds the next page once and the button goes", (await page.locator("tr", { hasText: "Лид со второй страницы" }).count()) === 1 && (await page.getByRole("button", { name: "Показать ещё" }).count()) === 0, before);
  report("marketing-leads: the count line stays true (48 total)", /Заявок по фильтрам: 48/u.test(await page.locator('[data-testid="marketing-leads-count"]').innerText()), null);
  report("marketing-leads: console clean", errors.length === 0, errors);
  await context.close();
});

flow("marketing-overview", async (env) => {
  const { context, page, errors } = await env.open("marketing-overview", "d1440");
  const { report } = env;
  await page.getByRole("button", { name: "Добавить расход" }).click();
  await sheet(page).waitFor({ state: "visible" });
  await sheet(page).locator("input[name=amount]").fill("100");
  await sheet(page).getByRole("button", { name: "Записать расход" }).click();
  await page.waitForTimeout(250);
  const [call] = (await calls(page)).filter(([name]) => /addMarketingSpendAction/u.test(name));
  report("marketing-overview: «Записать расход» sends the old fields", Boolean(call) && ["request_id", "period_start", "period_end", "amount", "currency", "campaign", "note"].every((key) => key in call[1]), call ? Object.keys(call[1]) : null);
  report("marketing-overview: the answer is a line in the sheet, the form keeps its place", /Расход записан\./u.test(await sheet(page).innerText()), null);
  await esc(page);
  await page.getByRole("button", { name: "Отменить" }).first().click();
  report("marketing-overview: «Отменить» asks first", /Отменить эту запись\?/u.test(await page.locator("main").innerText()), null);
  report("marketing-overview: the period links keep the address", (await page.locator('nav[aria-label="Период"] a[aria-current=page]').count()) === 1, null);
  report("marketing-overview: console clean", errors.length === 0, errors);
  await context.close();
});

for (const [name, selector] of [["finance", "v3-looker-report-finance"], ["marketing-reports", "v3-looker-report-marketing"]]) {
  flow(name, async (env) => {
    const { context, page, errors } = await env.open(name, "d1440");
    const { report } = env;
    const frame = page.locator(`[data-testid="${selector}"] iframe`);
    await frame.waitFor({ state: "attached", timeout: 5000 });
    report(`${name}: the window is built from the identifiers by the template`, (await frame.getAttribute("src")) === "https://lookerstudio.google.com/embed/reporting/abcdefgh12/page/pg01", await frame.getAttribute("src"));
    const sandbox = await frame.getAttribute("sandbox");
    report(`${name}: the strict window rights and the referrer policy`, sandbox === "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation" || /^allow-scripts/u.test(sandbox ?? ""), sandbox);
    report(`${name}: no top navigation, forms or downloads in the sandbox`, !/allow-top-navigation|allow-forms|allow-downloads/u.test(sandbox ?? ""), sandbox);
    report(`${name}: referrer policy is origin-only across sites`, (await frame.getAttribute("referrerpolicy")) === "strict-origin-when-cross-origin", await frame.getAttribute("referrerpolicy"));
    report(`${name}: the open-in-tab link is safe`, (await page.getByRole("link", { name: /Открыть в новой вкладке/u }).first().getAttribute("rel")) === "noopener noreferrer", null);
    report(`${name}: console clean`, errors.length === 0, errors);
    await context.close();
    const phone = await env.open(name, "m390");
    report(`${name}: on the phone there is no window, a card with the link instead`, (await phone.page.locator(`[data-testid="${selector}"] iframe`).count()) === 0 && (await phone.page.locator('[data-testid="v3-looker-phone"]').isVisible()), null);
    await phone.context.close();
  });
}

/* -------------------------------------------------------------------------------------------- «ИИ-агент» */

flow("ai-documents", async (env) => {
  const { context, page, errors } = await env.open("ai-documents", "d1440");
  const { report } = env;
  await rowSheet(env, page, "ai-documents", "scan_0042", "scan_0042");
  const text = await sheet(page).innerText();
  report("ai-documents: the personal-document warning and the company-material command stay in the sheet", /Документы клиентов агенту не загружаются/u.test(text) && (await sheet(page).locator('[data-testid="v3-ai-document-company"] button').count()) === 1, text.slice(0, 120));
  await sheet(page).locator('[data-testid="v3-ai-document-company"] button').click();
  await page.waitForTimeout(200);
  report("ai-documents: the command sends the old fields (document_id, expected_version, request_id)", (await calls(page)).some(([name, fields]) => /confirmAiDocumentCompanyAction/u.test(name) && fields.document_id && fields.expected_version && fields.request_id), null);
  await esc(page);
  await rowSheet(env, page, "ai-documents review link", "Прайс 2026 — Малайзия (скан)", "Прайс 2026");
  report("ai-documents: a scan in review links to the «Лист сверки»", (await sheet(page).getByRole("link", { name: /Лист сверки/u }).count()) >= 1, null);
  await esc(page);
  await page.getByRole("button", { name: "Загрузить материал" }).click();
  report("ai-documents: «Загрузить материал» expands the old upload form on the page (a sheet would cancel a running upload)", (await page.locator('[data-testid="v3-ai-upload"] input[type=file]').count()) === 1 && (await page.locator('section[data-testid="v3-ai-upload"]').isVisible()) && (await sheet(page).count()) === 0, null);
  report("ai-documents: console clean", errors.length === 0, errors);
  await context.close();
});

flow("ai-review", async (env) => {
  const { context, page, errors } = await env.open("ai-review", "d1440");
  const { report } = env;
  await rowSheet(env, page, "ai-review", "Прайс 2026 — Малайзия (скан)", "Прайс 2026");
  const text = await sheet(page).innerText();
  report("ai-review: the sheet shows the three readings and the proposal", ["Первое чтение", "Второе чтение", "Проверка фрагмента", "Предложено"].every((word) => text.includes(word)), text.slice(0, 120));
  report("ai-review: the old actions are there (Подтвердить, Исправить, Оставить как есть)", ["Подтвердить", "Исправить", "Оставить как есть"].every((word) => text.includes(word)), null);
  await esc(page);
  report("ai-review: the three lists are links", (await page.locator('nav[aria-label="Пункты сверки"] a').count()) === 3, null);
  report("ai-review: console clean", errors.length === 0, errors);
  await context.close();
});

flow("ai-lab", async (env) => {
  const { context, page, errors } = await env.open("ai-lab", "d1440");
  const { report } = env;
  await rowSheet(env, page, "ai-lab", "Можно ли поступить в Малайзию без IELTS?", "Можно ли поступить");
  await sheet(page).getByRole("button", { name: "Удалить пример" }).click();
  await page.waitForTimeout(200);
  report("ai-lab: «Удалить пример» sends the old fields (example_id, request_id)", (await calls(page)).some(([name, fields]) => /deleteAiExampleAction/u.test(name) && fields.example_id && fields.request_id), null);
  report("ai-lab: console clean", errors.length === 0, errors);
  await context.close();
});

flow("ai-rules", async (env) => {
  const { context, page, errors } = await env.open("ai-rules", "d1440");
  const { report } = env;
  report("ai-rules: the editor holds the current text", /Тон: вежливо/u.test(await page.locator("textarea[name=body]").inputValue()), null);
  await page.getByRole("button", { name: "История версий" }).click();
  await sheet(page).waitFor({ state: "visible" });
  report("ai-rules: the history lists both versions", (await sheet(page).locator("ol > li").count()) === 2, null);
  await esc(page);
  await page.getByRole("button", { name: "Проверено" }).click();
  await page.waitForTimeout(200);
  report("ai-rules: «Проверено» sends the version id", (await calls(page)).some(([name, fields]) => /confirmAiRulesAction/u.test(name) && fields.rules_version_id), null);
  report("ai-rules: console clean", errors.length === 0, errors);
  await context.close();
});

flow("ai-autosend", async (env) => {
  const { context, page, errors } = await env.open("ai-autosend", "d1440");
  const { report } = env;
  report("ai-autosend: the pause banner and the off-server line stay on the page", (await page.locator('[data-testid="v3-ai-autosend-pause-banner"]').count()) === 1 && (await page.locator('[data-testid="v3-ai-autosend-server-off"]').count()) === 1, null);
  await page.getByRole("button", { name: "Снять паузу" }).click();
  await page.waitForTimeout(200);
  report("ai-autosend: «Снять паузу» sends the old fields (pause_action=resume, expected_version)", (await calls(page)).some(([name, fields]) => /pauseAiAutosendAction/u.test(name) && fields.pause_action === "resume" && fields.expected_version), null);
  report("ai-autosend: the three views are links", (await page.locator('nav[aria-label="Автоответчик"] a').count()) === 3, null);
  report("ai-autosend: console clean", errors.length === 0, errors);
  await context.close();
  for (const [name, row] of [["ai-autosend-journal", "Чат недоступен"], ["ai-autosend-summary", "Чат недоступен"]]) {
    const view = await env.open(name, "d1440");
    await rowSheet(env, view.page, name, row, "Чат недоступен");
    env.report(`${name}: console clean`, view.errors.length === 0, view.errors);
    await view.context.close();
  }
});

flow("ai-spend", async (env) => {
  const { context, page, errors } = await env.open("ai-spend", "d1440");
  const { report } = env;
  report("ai-spend: four tiles and the by-purpose table", (await page.locator('[data-slot="stat-tile"]').count()) === 4 && (await page.locator('[data-testid="v3-ai-spend-groups"]').count()) === 1, null);
  report("ai-spend: the monthly cap form and the memory toggle are the old ones", (await page.locator('[data-testid="v3-ai-cap-form"]').count()) === 1 && (await page.getByRole("button", { name: /Включить память/u }).count()) === 1, null);
  report("ai-spend: the agent status line stays on the page", /Gemini принимает ключ EVO/u.test(await page.locator('[data-testid="v3-ai-agent-status"]').innerText()), null);
  report("ai-spend: console clean", errors.length === 0, errors);
  await context.close();
});

// Сценарии по независимой проверке (28.10.2026): те же помощники, отдельный файл.
require("./admin-next-flows-review.cjs")({ flow, sheet, esc, opener, calls, focusLabel, fx });
// Сценарии по уроку волны 2A (Esc в поле панели не выбрасывает набранное).
require("./admin-next-flows-esc.cjs")({ flow, sheet });
// Сценарий по независимой проверке сборки 2B (полоса фокуса итоговых таблиц отчётов видна).
require("./admin-next-flows-focus.cjs")({ flow });

module.exports = { flows };
