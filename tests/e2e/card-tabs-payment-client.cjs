"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Клиентская часть карточки «Оплата» (`card-tabs-next-static-render.cjs --screenshots`): настоящие `AgreementNextView`, `PaymentDesk` и
 * `PaymentTable` в Chromium без сервера Next, на синтетических данных. Серверные действия записывают, с чем их вызвали (`window.__calls`), и
 * отвечают «сохранено» или «недоступно»; `fetch` (чек к оплате) - записанная заглушка. Проверяется то, что делает сам вид: какие поля
 * и значения уходят в действия, что открывается и где стоит фокус.
 */

const { writeFileSync } = require("node:fs");
const { buildBundle, WRAP } = require("./card-tabs-client.cjs");

const ENTRY = `${WRAP}
const { CaseMoneySection } = require("@/components/staff/profile/CaseMoney");
const { AgreementNextView } = require("@/components/staff/profile/next/tabs/MoneyAgreementNext");
const data = window.__DATA;
mount(h(CaseMoneySection, { nextUi: true, panels: data.panels, contractCaseId: "case-1" }, h(AgreementNextView, data.view)));
`;

/** До загрузки страницы: действия отвечают по `window.__mode`, `fetch` только записывается. */
function installStubs() {
  window.__fetches = [];
  window.__mode = "unavailable";
  window.fetch = async (url, init) => {
    window.__fetches.push({ url: String(url), method: init && init.method });
    return new Response("{}", { status: 201 });
  };
  window.__actionResult = (_name, previous) => (window.__mode === "saved"
    ? { status: "saved", requestId: previous.requestId, resourceId: "72727272-7272-4272-8272-727272727299", message: null }
    : { status: window.__mode, requestId: previous.requestId, resourceId: null, message: null });
}

function scenarios(fx) {
  const same = fx.AGREEMENTS.same;
  const view = (over = {}) => ({ agreement: same, canWrite: true, today: fx.TODAY, pendingReceipts: [], studentReceipts: [], saleConditionsHref: null, financeStop: null, stopsPanel: false, ...over });
  // Два ещё не оплаченных платежа: у каждого своё «⋯».
  const unpaid = (n, label, amount, dueOn) => ({ id: fx.uuid("71717171", n), label, amountMinor: amount, currency: "USD", dueOn, totalPaidMinor: "0", outstandingMinor: amount });
  const open2 = { ...same, tranches: [unpaid(1, "Первый платёж", "60000", "2026-09-01"), unpaid(2, "Второй платёж — после оффера", "90000", "2026-09-20")], payments: [], paidMinor: "0", remainingMinor: "150000", trancheSumMinor: "150000" };
  // Длинная таблица: платёж, который отмечают, далеко внизу.
  const many = Array.from({ length: 14 }, (_, index) => ({ id: fx.uuid("72727272", 100 + index), obligationId: same.tranches[0].id, amountMinor: "1000", currency: "USD",
    occurredOn: `2026-08-${String(10 + index).padStart(2, "0")}`, actorDisplayName: "Айгүл Осмонова", eventType: "payment", receipts: [] }));
  return { same: view(), open2: view({ agreement: open2 }), long: view({ agreement: { ...same, payments: [...same.payments, ...many] } }) };
}

const field = (call, name) => call.entries.find(([key]) => key === name)?.[1];

async function runPayment({ browser, report, css, outDir, fx, join, pathToFileURL, VIEWPORTS }) {
  await buildBundle(ENTRY, join(outDir, "card-tabs-payment.js"), fx.ROOT, join, { stubReaders: true });
  const files = {};
  for (const [name, view] of Object.entries(scenarios(fx))) {
    files[name] = join(outDir, `card-tabs-payment-${name}.html`);
    writeFileSync(files[name], `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${name} (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div id="root"></div><script>window.__DATA = ${JSON.stringify({ panels: [], view })};</script><script src="card-tabs-payment.js"></script></body></html>`);
  }
  const open = async (name, key) => {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(installStubs);
    await page.goto(pathToFileURL(files[name]).href, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  };
  const calls = (page) => page.evaluate(() => window.__calls || []);
  const rowMenus = (page) => page.getByRole("button", { name: /^Действия со строкой/u });
  // Меню закрывается за долю секунды (выход Radix); следующее действие - когда оно ушло и страница снова принимает щелчки.
  const settled = (page) => page.waitForFunction(() => !document.querySelector("[role=menu]") && document.body.style.pointerEvents !== "none");
  // Открыть меню и дать ему встать на место: щелчок мимо в первые миллисекунды после открытия Radix не считает (человек так быстро не щёлкает).
  const showMenu = async (page, which) => { await rowMenus(page)[which]().click(); await page.getByRole("menu").waitFor(); await page.waitForTimeout(150); };
  const focused = (page) => page.evaluate(() => { const element = document.activeElement; return element ? { name: element.getAttribute("name"), label: element.getAttribute("aria-label"), value: element.value ?? null } : null; });
  const waitCalls = (page, count) => page.waitForFunction((n) => (window.__calls || []).length >= n, count, { timeout: 8000 });

  for (const key of ["d1280", "m390"]) {
    const label = `payment client @${key}`;
    // «Запланирован»: срок не подставляется - с одной суммой уходит пустой `due_on` (как на main), а не «сегодня».
    {
      const { context, page, errors } = await open("same", key);
      await page.getByTestId("v3-case-payment-add").click();
      const slot = page.getByTestId("v3-case-agreement-payment");
      await slot.getByRole("radio", { name: "Запланирован" }).click();
      await slot.locator("input[name=amount]").fill("1000");
      await page.evaluate(() => { window.__mode = "saved"; });
      await slot.getByRole("button", { name: "Сохранить", exact: true }).click();
      await waitCalls(page, 1);
      const [call] = await calls(page);
      const keys = call.entries.map(([name]) => name).sort().join(",");
      report(`${label}: «Запланирован» with only an amount posts an empty due_on`, call.action === "saveCaseTrancheAction" && field(call, "due_on") === ""
        && field(call, "amount") === "1000" && field(call, "archive") === "false" && field(call, "payment_obligation_id") === ""
        && keys === "amount,archive,currency,due_on,label,payment_obligation_id,request_id,student_case_id", call);
      // «Уже оплачен»: день оплаты - сегодня (день из `at`).
      await slot.getByRole("radio", { name: "Уже оплачен" }).click();
      await slot.locator("input[name=amount]").fill("500");
      await page.evaluate(() => { window.__mode = "saved"; });
      await slot.getByRole("button", { name: "Сохранить", exact: true }).click();
      await waitCalls(page, 2);
      const paid = (await calls(page))[1];
      report(`${label}: «Уже оплачен» still starts on today`, paid.action === "recordCasePaymentAction" && (field(paid, "at") ?? "").startsWith(`${fx.TODAY}T`), paid);
      report(`${label}: payment form has no browser errors`, errors.length === 0, errors);
      await context.close();
    }
    // «Уже оплачен»: под платежом сказано, сколько по нему осталось, - до отказа сервера за переплату.
    {
      const { context, page } = await open("same", key);
      await page.getByTestId("v3-case-payment-add").click();
      const slot = page.getByTestId("v3-case-agreement-payment");
      const remaining = async () => ((await slot.innerText()).match(/Осталось: ([^\n]+)/u)?.[1] ?? "").replace(/\s+/gu, " ").trim();
      const byDefault = await remaining();
      await slot.locator("select").selectOption({ index: 0 });
      const paidUp = await remaining();
      await page.getByRole("button", { name: "Отметить оплату" }).click();
      const fromRow = await remaining();
      report(`${label}: «Осталось: X» is shown for the chosen payment (default, fully paid, and from a row)`, byDefault === "900 USD" && paidUp === "0 USD" && fromRow === "900 USD", { byDefault, paidUp, fromRow });
      await context.close();
    }

    // Меню строки («⋯», Radix): Esc и щелчок мимо закрывают, открыто одно меню; фокус после Esc - на «⋯».
    {
      const { context, page, errors } = await open("open2", key);
      const menus = () => page.getByRole("menu").count();
      await showMenu(page, "first");
      const opened = await menus();
      await page.keyboard.press("Escape");
      await settled(page);
      const afterEsc = await menus();
      const back = await focused(page);
      await showMenu(page, "first");
      await page.mouse.click(2, 2);
      await settled(page);
      const afterOutside = await menus();
      await showMenu(page, "first");
      // Пока меню открыто, остальное скрыто от читалки (aria-hidden): место другой «⋯» берём по CSS, а не по роли.
      const box = await page.locator("button[aria-label^='Действия со строкой']").last().boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await settled(page);
      const stacked = await menus();
      report(`${label}: row «⋯» menu closes on Esc (focus back on «⋯») and on an outside click; never two open`, opened === 1 && afterEsc === 0 && /^Действия со строкой/u.test(back?.label ?? "") && afterOutside === 0 && stacked <= 1,
        { opened, afterEsc, back, afterOutside, stacked });
      report(`${label}: row menu has no browser errors`, errors.length === 0, errors);
      await context.close();
    }
    // «Отметить оплаченным» с клавиатуры: форма открыта, поле суммы в фокусе (с остатком по платежу).
    {
      const { context, page } = await open("open2", key);
      await rowMenus(page).first().focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "Отметить оплаченным" }).waitFor();
      await page.keyboard.press("Enter");
      await page.getByTestId("v3-case-agreement-payment").locator("form").waitFor();
      const field = await focused(page);
      report(`${label}: «Отметить оплаченным» by keyboard opens the form with the focus in the amount (outstanding prefilled)`, field?.name === "amount" && field.value === "600", field);
      await context.close();
    }
    // Далеко внизу длинной таблицы: форма, которая открылась после «Отметить оплаченным», на экране и в ней фокус.
    {
      const { context, page } = await open("long", key);
      await rowMenus(page).first().scrollIntoViewIfNeeded();
      await rowMenus(page).first().click();
      await page.getByRole("menuitem", { name: "Отметить оплаченным" }).click();
      const slot = page.getByTestId("v3-case-agreement-payment");
      await slot.locator("form").waitFor();
      await page.waitForTimeout(150);
      const where = await page.evaluate(() => {
        const input = document.querySelector("[data-testid=v3-case-agreement-payment] input[name=amount]");
        const rect = input.getBoundingClientRect();
        return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), viewport: window.innerHeight, focused: document.activeElement === input, scrollY: Math.round(window.scrollY) };
      });
      report(`${label}: after «Отметить оплаченным» in a long table the amount field is on screen and focused`, where.focused && where.top >= 0 && where.bottom <= where.viewport, where);
      await context.close();
    }
    // «Изменить» из меню: правка открывается в строке, фокус - в её первом поле.
    {
      const { context, page } = await open("open2", key);
      await rowMenus(page).last().click();
      await page.getByRole("menuitem", { name: "Изменить", exact: true }).click();
      const row = page.locator("[data-testid=v3-case-agreement-tranches] li").last();
      await row.locator("form").waitFor();
      const field = await focused(page);
      report(`${label}: «Изменить» from the menu opens the editor in the row and focuses its first field`, field?.name === "label" && (await row.getByRole("button", { name: "Отмена" }).count()) === 1, field);
      await context.close();
    }
  }
}

module.exports = { runPayment };
