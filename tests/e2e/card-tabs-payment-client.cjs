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
  return { same: view() };
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
  }
}

module.exports = { runPayment };
