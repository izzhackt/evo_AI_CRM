import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CASE_MONEY_PANEL,
  caseContractTemplateNote,
  caseMoneySummary,
  caseTrancheState,
  moneyDay,
  moneyMomentDay,
} from "../src/components/v3/profile/case-money-view.ts";

/**
 * Вкладка «Договор и оплата» (Э8.3, PLAN_CHANGES 28.09 «Э8: срезы по
 * итоговой критике»). Расчёты сводки — напрямую, разметка — настоящей
 * сборкой страницы дела с синтетическими данными
 * (tests/e2e/case-money-static-render.cjs --json) в отдельном процессе.
 * Это не живая проверка данных: права и суммы решает SQL (чтение 189).
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pages = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/case-money-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((page) => [page.name, page.html]));
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
/** Суммы `financeMoney` разделяют разряды неразрывным пробелом: в ожиданиях — обычный. */
const plainSummary = (agreementValue) => JSON.parse(JSON.stringify(caseMoneySummary(agreementValue)).replace(/[\u00a0\u202f]/gu, " "));
/** Сплошной красный класс кнопки (`bg-accent`), без `hover:bg-accent-2`. */
const SOLID_RED = /(?<![\w:-])bg-accent(?![\w-])/gu;

/** Лист «Договор и оплата» целиком (от его `<section>` до закрывающего тега). */
function sheet(html) {
  const start = html.indexOf("<section", html.lastIndexOf("<", html.indexOf("data-case-money")) - 1);
  const open = html.lastIndexOf("<section", html.indexOf("data-case-money"));
  let depth = 0;
  const pattern = /<section\b|<\/section>/gu;
  pattern.lastIndex = open;
  for (let token = pattern.exec(html); token; token = pattern.exec(html)) {
    depth += token[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(open, token.index + token[0].length);
  }
  assert.fail(`money sheet is not closed (${start})`);
}

/** То, что видно без «⋯»: панели (`<section … hidden="">`) и закрытые `<details>` вырезаются. */
function visible(html) {
  let out = html;
  for (const [tag, open] of [["section", /<section[^>]*\bhidden=""[^>]*>/u], ["details", /<details(?![^>]*\sopen="")[^>]*>/u], ["div", /<div[^>]*\bpopover="auto"[^>]*>/u]]) {
    for (let match = open.exec(out); match; match = open.exec(out)) {
      let depth = 0;
      const pattern = new RegExp(`<${tag}\\b|</${tag}>`, "gu");
      pattern.lastIndex = match.index;
      let end = out.length;
      for (let token = pattern.exec(out); token; token = pattern.exec(out)) {
        depth += token[0].startsWith("</") ? -1 : 1;
        if (depth === 0) { end = token.index + token[0].length; break; }
      }
      out = out.slice(0, match.index) + out.slice(end);
    }
  }
  return out;
}

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const CASE = "cccccccc-2222-4222-8222-000000000001";
const id = (n) => `71717171-5555-4555-8555-${String(n).padStart(12, "0")}`;
function agreement(fields) {
  return {
    organizationId: ORG, studentCaseId: CASE, costMinor: "150000", costCurrency: "USD", contractCurrent: null, contractHistory: [],
    tranches: [], trancheSumMinor: "0", costMismatch: false, payments: [], paidMinor: "0", remainingMinor: "150000",
    currencyMismatch: false, canWrite: true, ...fields,
  };
}
const tranche = (n, amount, currency, outstanding, fields = {}) => ({ id: id(n), label: `Транш ${n}`, amountMinor: amount, currency,
  dueOn: null, totalPaidMinor: String(BigInt(amount) - BigInt(outstanding)), outstandingMinor: outstanding, ...fields });
const payment = (n, amount, currency, eventType = "payment") => ({ id: id(100 + n), obligationId: id(1), amountMinor: amount, currency,
  occurredOn: "2026-09-10", actorDisplayName: null, eventType, receipts: [] });

test("one currency: paid from the payment events, remaining from the server, overpayment named", () => {
  const same = plainSummary(agreement({
    payments: [payment(1, "40000", "USD"), payment(2, "20000", "USD")], paidMinor: "60000", remainingMinor: "90000",
    tranches: [tranche(1, "150000", "USD", "90000")], trancheSumMinor: "150000",
  }));
  assert.equal(same.cost, "1 500,00 USD");
  assert.deepEqual(same.paid, ["600,00 USD"]);
  assert.deepEqual(same.remaining, { values: ["900,00 USD"], note: null });
  assert.equal(same.refunds, false);
  assert.equal(same.tranchesAgainstCost, null);

  const over = plainSummary(agreement({ payments: [payment(1, "160000", "USD")], remainingMinor: "-10000" }));
  assert.deepEqual(over.remaining, { values: ["−100,00 USD"], note: "переплата" });

  const partial = plainSummary(agreement({ tranches: [tranche(1, "100000", "USD", "100000")], trancheSumMinor: "100000", costMismatch: true }));
  assert.equal(partial.tranchesAgainstCost, "Транши: 1 000,00 USD из 1 500,00 USD");
});

test("no cost: nothing is invented — no remaining, the reason in words", () => {
  const none = plainSummary(agreement({ costMinor: null, costCurrency: null, remainingMinor: null }));
  assert.equal(none.cost, null);
  assert.equal(none.costWithoutCurrency, false);
  assert.deepEqual(none.paid, []);
  assert.deepEqual(none.remaining, { values: [], note: "стоимость не указана" });
  assert.equal(plainSummary(agreement({ costCurrency: null, remainingMinor: null })).costWithoutCurrency, true);
});

test("different currencies: each currency separately, cost currency first, no conversion, a settled currency not named", () => {
  const cross = plainSummary(agreement({
    currencyMismatch: true, remainingMinor: null, paidMinor: "3060000",
    tranches: [tranche(1, "60000", "USD", "0"), tranche(2, "5000000", "KGS", "2000000")],
    payments: [payment(3, "500000", "KGS", "refund"), payment(2, "3500000", "KGS"), payment(1, "60000", "USD")],
  }));
  assert.deepEqual(cross.paid, ["600,00 USD", "30 000,00 KGS"]);
  assert.equal(cross.refunds, true);
  assert.deepEqual(cross.remaining, { values: ["20 000,00 KGS"], note: "по траншам, без пересчёта валют" });
  assert.equal(cross.tranchesAgainstCost, null);
});

test("tranche state and dates: «оплачен», «просрочен» only with a remaining sum; ДД.ММ, year only when not this year", () => {
  assert.equal(caseTrancheState(tranche(1, "60000", "USD", "0"), "2026-09-23"), "paid");
  assert.equal(caseTrancheState(tranche(2, "90000", "USD", "90000", { dueOn: "2026-09-20" }), "2026-09-23"), "overdue");
  assert.equal(caseTrancheState(tranche(3, "90000", "USD", "90000", { dueOn: "2026-09-30" }), "2026-09-23"), null);
  assert.equal(caseTrancheState(tranche(4, "90000", "USD", "90000"), "2026-09-23"), null);
  assert.equal(moneyDay("2026-09-20", "2026-09-23"), "20.09");
  assert.equal(moneyDay("2027-01-15", "2026-09-23"), "15.01.27");
  // Момент — день Бишкека (UTC+6): 17.09 20:30 UTC — уже 18.09.
  assert.equal(moneyMomentDay("2026-09-17T20:30:00.000Z", "2026-09-23"), "18.09");
});

test("the template warning speaks to the viewer: who adds it, or what the Admin does here", () => {
  const workspace = (fields) => ({ templates: [], reviewedSources: [], canManageTemplates: false, ...fields });
  const template = (status) => ({ status });
  assert.equal(caseContractTemplateNote(workspace({ templates: [template("approved")] })), null);
  assert.deepEqual(caseContractTemplateNote(workspace({})), { text: "Шаблона договора нет — его добавляет Администратор.", link: null });
  assert.deepEqual(caseContractTemplateNote(workspace({ templates: [template("draft")] })),
    { text: "Утверждённого шаблона договора нет — его утверждает Администратор.", link: null });
  const admin = { canManageTemplates: true };
  assert.match(caseContractTemplateNote(workspace(admin)).text, /проверенного источника пока нет/u);
  assert.equal(caseContractTemplateNote(workspace(admin)).link, null, "no link to a screen CRM does not have");
  assert.deepEqual(caseContractTemplateNote(workspace({ ...admin, reviewedSources: [{}] })).link, { href: "#contract-template-create", label: "Создать версию шаблона" });
  assert.deepEqual(caseContractTemplateNote(workspace({ ...admin, templates: [template("retired"), template("draft")] })).link,
    { href: "#contract-template-list", label: "Шаблоны договора" });
});

test("the sheet: a summary in rows, rare work behind «⋯», the release-gate testid on the visible sheet", () => {
  const admin = pages.get("admin-same-currency");
  const money = sheet(admin);
  // Проверка выпуска (scripts/evo-production-browser-smoke.mjs) ждёт видимым именно этот элемент с id дела.
  assert.match(money, /^<section[^>]*data-case-money=""[^>]*data-testid="v3-profile-contract-workspace" data-student-case-id="cccccccc-2222-4222-8222-000000000001"/u);
  assert.equal((admin.match(/data-testid="v3-profile-contract-workspace"/gu) ?? []).length, 1);
  const shown = visible(money);
  assert.match(text(shown), /^Договор и оплата Стоимость 1 500,00 USD Договор dogovor-sydykova-2026\.pdf 18\.09 · Эрмек Токтосунов Скачать Заменить Оплачено 600,00 USD Остаток 900,00 USD Транши/u);
  for (const testId of ["v3-case-agreement", "v3-case-agreement-tranches", "v3-case-agreement-payment", "v3-case-agreement-upload"]) {
    assert.match(shown, new RegExp(`data-testid="${testId}"`, "u"), testId);
  }
  // «⋯»: пять пунктов по порядку; их панели на странице, но скрыты до выбора.
  const menu = money.slice(money.indexOf('popover="auto"'), money.indexOf("</div>", money.indexOf('popover="auto"')));
  assert.deepEqual([...menu.matchAll(/<button[^>]*>([^<]+)<\/button>/gu)].map((match) => match[1]),
    ["Подготовка договора по шаблону", "Обязательства", "Стопы", "Дополнительные финансовые операции", "Служебные сведения"]);
  for (const panel of Object.values(CASE_MONEY_PANEL)) {
    assert.match(money, new RegExp(`<section id="${panel}" data-money-panel="" hidden=""`, "u"), panel);
  }
  // Прежний якорь итога операции договора — внутри своей панели (её открывает адрес `#contract-workflow`).
  assert.ok(money.indexOf('id="contract-workflow"') > money.indexOf('id="money-contract"'));
  assert.ok(money.indexOf('id="contract-workflow"') < money.indexOf('id="money-service"') || money.indexOf('id="money-service"') < money.indexOf('id="money-contract"'));
  assert.match(money, /data-testid="v3-profile-finance-controls"/u, "stop management stays on the page, in its panel");
  // Жаргон и сырые id — только в «Служебных сведениях».
  for (const jargon of [/Контекст Sales/u, /\bgate\b/u, /\bworkflow\b/u, /ID дела/u, /Версии записей/u, /\bactive\b/u]) {
    assert.doesNotMatch(text(shown), jargon, String(jargon));
  }
  assert.doesNotMatch(text(money), /Контекст Sales|Состояние дела active|gate \d/u);
});

test("one solid red at most: the header «Принять дело»; the sheet itself has none, no side stripe, no native «Choose File»", () => {
  for (const [name, html] of pages) {
    const money = sheet(html);
    assert.doesNotMatch(money, /(?<![\w:-])bg-accent(?![\w-])|\bv3-edge-danger\b|(?<![\w:-])text-danger\b/u, `${name}: no red fill, stripe or red text in the sheet`);
    for (const input of money.match(/<input[^>]*type="file"[^>]*>/gu) ?? []) assert.match(input, /class="sr-only"/u, `${name}: ${input}`);
  }
  const awaiting = pages.get("curator-no-contract");
  assert.equal((awaiting.match(SOLID_RED) ?? []).length, 1, "«Принять дело» stays the page's only solid red");
  assert.match(text(visible(sheet(awaiting))), /Договор не загружен Загрузить договор PDF, JPEG, PNG · до 25 МБ/u);
});

test("a finance stop is a summary row with a chip word and a way to its panel", () => {
  const shown = visible(sheet(pages.get("admin-stop")));
  assert.match(shown, /data-testid="v3-case-money-stop"/u);
  assert.match(text(shown), /Финансовый стоп стоп активен Второй платёж просрочен — подачу в вуз не начинаем до оплаты\. Стопы/u);
  assert.match(shown, /<span class="v3-chip t-caption" data-tone="danger">стоп активен<\/span>/u);
});

test("different currencies on the page: each currency separately, dates in Bishkek mono", () => {
  const shown = text(visible(sheet(pages.get("admin-cross-currency"))));
  assert.match(shown, /Оплачено 600,00 USD · 30 000,00 KGS с учётом возвратов Остаток 20 000,00 KGS по траншам, без пересчёта валют/u);
  assert.match(sheet(pages.get("admin-cross-currency")), /<time dateTime="2026-09-21" class="flex min-h-11 items-center font-mono t-meta tabular-nums text-fg-2">21\.09<\/time>/u);
  assert.doesNotMatch(shown, /\d{2}\.\d{2}\.\d{4}/u, "no toLocaleDateString dates");
});

test("the template warnings on the page address the viewer", () => {
  assert.match(text(sheet(pages.get("curator-template"))), /Шаблона договора нет — его добавляет Администратор\./u);
  assert.doesNotMatch(sheet(pages.get("curator-template")), /data-testid="platform-contract-template-create-panel"/u);
  assert.match(text(sheet(pages.get("admin-template"))), /Шаблона договора нет\. Создать его можно после проверки источника шаблона, а проверенного источника пока нет\./u);
  assert.match(sheet(pages.get("admin-template-source")), /<a href="#contract-template-create"[^>]*>Создать версию шаблона<\/a>/u);
  assert.match(sheet(pages.get("admin-template-source")), /<details id="contract-template-create"/u);
  // Кнопки подготовки — тёмные нейтральные, не красные.
  assert.doesNotMatch(read("src/components/v3/profile/ContractDraftReportWorkspace.tsx"), /\bbtnCls\b/u);
  assert.doesNotMatch(read("src/components/v3/profile/CaseAgreementForms.tsx"), /\bbtnCls\b/u);
  assert.doesNotMatch(read("src/components/v3/profile/FinanceEntryForms.tsx"), /\bbtnCls\b/u);
});
