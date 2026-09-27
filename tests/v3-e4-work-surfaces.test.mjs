// Э4 (27.09.2026): Lead 360 как рабочая карточка и «Отчёт продаж» без коробок.
// Синтетические данные: имена, суммы и записи выдуманы, записей EVO здесь нет.
// Чистая логика — прямо из модулей; страницы — настоящие компоненты статического
// рендера (tests/e2e/numbers-static-render.cjs --json-e4).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LEAD_PORTAL_GROUP_ID, LEAD_STEP_DRAWER_ID, handoffGateForms, leadDay, leadDueState, leadFeed, leadGroupSummaries,
  leadLastContact, leadMoment, leadPrimaryAction, leadSaleHref,
} from "../src/components/v3/profile/lead-work-view.ts";
import {
  SALES_NO_REMAINDER_TEXT, groupSalesLabels, recordsDative, recordsWord, salesLabelGroupOf, salesMoneySummary, salesPeriodSteps,
  salesRowNoRemainder, salesRowRemainder, salesRowReview, salesSummaryBasis, salesWord,
} from "../src/lib/sales-register-view.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
/** Сплошной красный — класс `bg-accent` кнопки главного действия (не `bg-accent-weak`, не `hover:`). */
const solidRed = (html) => html.match(/(?<![\w:-])bg-accent(?![\w-])/gu)?.length ?? 0;
const LEAD = "dddddddd-3333-4333-8333-000000000001";

test("Lead 360: one main action by state — step, sale for «Потенциальный клиент», a neutral case after the handoff", () => {
  const base = { leadId: LEAD, stage: "contacting", handedOff: false, caseHref: null, canManageWorkflow: true, canRegisterSale: true };
  assert.deepEqual(leadPrimaryAction(base), { kind: "step" });
  assert.deepEqual(leadPrimaryAction({ ...base, stage: "potential" }), { kind: "sale", href: leadSaleHref(LEAD) });
  assert.equal(leadSaleHref(LEAD), `/v3/main?view=sales&new=true&lead=${LEAD}`);
  // Без права записывать продажи у «Потенциального клиента» — снова шаг; без права вести лид — ничего.
  assert.deepEqual(leadPrimaryAction({ ...base, stage: "potential", canRegisterSale: false }), { kind: "step" });
  assert.equal(leadPrimaryAction({ ...base, canManageWorkflow: false, canRegisterSale: false }), null);
  // После передачи — только «Открыть дело», и только тому, кому дело открывается.
  assert.deepEqual(leadPrimaryAction({ ...base, handedOff: true, caseHref: "/v3/profile?case=x" }), { kind: "case", href: "/v3/profile?case=x" });
  assert.equal(leadPrimaryAction({ ...base, stage: "potential", handedOff: true }), null);
  assert.equal(LEAD_STEP_DRAWER_ID, "lead-next-step");
  assert.equal(LEAD_PORTAL_GROUP_ID, "portal-access");
});

test("Lead 360: the gate forms group follows the same check as the forms, and a preview writes nothing", () => {
  const gate = { contractConfirmed: false, firstPaymentReceivedDate: null, canConfirmContract: true, canConfirmFirstPayment: true,
    canOverrideGate: true, normalHandoffAllowed: false };
  assert.deepEqual(handoffGateForms(gate, false), { contract: true, payment: false, override: true });
  assert.deepEqual(handoffGateForms({ ...gate, contractConfirmed: true }, false), { contract: false, payment: true, override: true });
  assert.deepEqual(handoffGateForms({ ...gate, contractConfirmed: true, firstPaymentReceivedDate: "2026-09-17", normalHandoffAllowed: true }, false),
    { contract: false, payment: false, override: false });
  assert.deepEqual(handoffGateForms(gate, true), { contract: false, payment: false, override: false });
});

test("Lead 360: group lines, the feed, the last contact and dates come from what was read", () => {
  const empty = { serviceLabel: "", serviceCostMinor: null, serviceCostCurrency: null, paidMinor: null, paidCurrency: null,
    wishesCountries: "", wishesStudyFields: "", wishesIntakeYear: "", educationCurrent: "", educationEnglish: "",
    conditionsBudgetMinor: null, conditionsBudgetCurrency: null, conditionsScholarship: "" };
  assert.deepEqual(leadGroupSummaries(empty), { sale: null, wishes: null, education: null, conditions: null });
  const filled = leadGroupSummaries({ ...empty, serviceLabel: " Пакет ", serviceCostMinor: 150000, serviceCostCurrency: "USD",
    paidMinor: 60000, paidCurrency: "USD", wishesCountries: "Малайзия", wishesIntakeYear: "2027", conditionsBudgetMinor: 800000,
    conditionsBudgetCurrency: "USD" });
  assert.equal(filled.sale, "Пакет · 1 500 USD · оплачено 600 USD");
  assert.equal(filled.wishes, "Малайзия · 2027");
  assert.equal(filled.conditions, "бюджет 8 000 USD");

  const notes = [{ body: "Новая", authorDisplayName: "Сотрудник", createdAt: "2026-09-25T09:40:00.000Z" },
    { body: "Старая", authorDisplayName: "Сотрудник", createdAt: "2026-09-10T09:40:00.000Z" }];
  const events = [{ key: "created", at: "2026-09-05T05:00:00.000Z", text: "Лид создан" },
    { key: "contract", at: "2026-09-20T05:00:00.000Z", text: "Договор подтверждён" }, { key: "bad", at: "не дата", text: "—" }];
  assert.deepEqual(leadFeed(notes, events, true).map((item) => item.kind === "note" ? item.note.body : item.event.key),
    ["Новая", "contract", "Старая", "created"]);
  // Более ранние страницы заметок — без событий: они не повторяются на каждой странице.
  assert.deepEqual(leadFeed(notes, events, false).map((item) => item.kind), ["note", "note"]);

  assert.deepEqual(leadLastContact("2026-09-25T09:40:00.000Z", [{ updatedAt: "2026-09-26T09:40:00.000Z" }]),
    { at: "2026-09-26T09:40:00.000Z", what: "переписка" });
  assert.deepEqual(leadLastContact("2026-09-25T09:40:00.000Z", []), { at: "2026-09-25T09:40:00.000Z", what: "заметка" });
  assert.equal(leadLastContact(null, []), null);

  const now = new Date("2026-09-27T06:00:00.000Z");
  assert.equal(leadMoment("2026-09-25T09:40:00.000Z", now), "25.09 15:40", "Bishkek time");
  assert.equal(leadMoment("2025-12-31T10:00:00.000Z", now), "31.12.25 16:00", "another year keeps its two digits");
  assert.equal(leadDay("2026-09-29", "2026-09-27"), "29.09");
  assert.equal(leadDay("2027-01-03", "2026-09-27"), "03.01.27");
  assert.deepEqual(["2026-09-26", "2026-09-27", "2026-09-28", null].map((day) => leadDueState(day, "2026-09-27")),
    ["overdue", "today", "later", null]);
});

function row(fields = {}) {
  return {
    id: "r", signingDate: "2026-09-10", serviceCostRaw: "1500", serviceCostMinor: 150000, serviceCostCurrency: "USD",
    paidRaw: "600", paidMinor: 60000, paidCurrency: "USD", managerLabel: "Менеджер", needsReview: false, archived: false, ...fields,
  };
}

test("«Отчёт продаж»: filter options are grouped for display only, and every spelling stays selectable", () => {
  const groups = groupSalesLabels(["Санжар  Эскизов", " санжар эскизов", "Санжар Эскизов", "Айдана Макетова", "   ", "Малайзия", "малайзия "]);
  assert.deepEqual(groups.map((group) => [group.label, group.value, group.variants.length]), [
    ["Айдана Макетова", "Айдана Макетова", 1],
    ["Малайзия", "Малайзия", 2],
    ["Санжар Эскизов", "Санжар Эскизов", 3],
  ]);
  // Группа без аккуратного написания выбирает первое прочитанное.
  assert.deepEqual(groupSalesLabels([" x ", "X"]).map((group) => [group.label, group.value]), [["X", "X"]]);
  assert.deepEqual(groupSalesLabels([" x "]).map((group) => [group.label, group.value]), [["x", " x "]]);
  assert.equal(salesLabelGroupOf(groups, " санжар эскизов")?.label, "Санжар Эскизов");
  assert.equal(salesLabelGroupOf(groups, "Нет такого"), null);
  assert.equal(salesLabelGroupOf(groups, null), null);
});

test("«Отчёт продаж»: «Уточнить» names only what the record lacks, remainder stays within one currency", () => {
  assert.deepEqual(salesRowReview(row()), { state: "checked" });
  assert.deepEqual(salesRowReview(row({ archived: true, needsReview: true })), { state: "archived" });
  assert.deepEqual(salesRowReview(row({ needsReview: true })), { state: "review", reasons: ["причина не записана"] });
  assert.deepEqual(salesRowReview(row({ needsReview: true, signingDate: null, serviceCostMinor: null, serviceCostCurrency: null,
    paidMinor: null, paidCurrency: null, paidRaw: "половина", managerLabel: " " })).reasons,
  ["нет даты продажи", "стоимость не разобрана", "оплата не разобрана", "нет менеджера"]);
  assert.deepEqual(salesRowReview(row({ needsReview: true, paidCurrency: "KGS" })).reasons, ["оплата в другой валюте"]);

  assert.equal(salesRowRemainder(row()), 90000);
  assert.equal(salesRowRemainder(row({ paidMinor: 0, paidRaw: "0" })), 150000, "a stated zero payment is a payment");
  // Пустая оплата — неизвестна (подсказка формы, «Не уточнено» записи, `paid_minor IS NULL` сервера), не ноль.
  assert.equal(salesRowRemainder(row({ paidMinor: null, paidCurrency: null, paidRaw: "" })), null, "unknown payment is not zero");
  assert.equal(salesRowRemainder(row({ paidMinor: null, paidCurrency: null, paidRaw: "половина" })), null);
  assert.equal(salesRowRemainder(row({ paidCurrency: "KGS" })), null, "no conversion");
  assert.equal(salesRowRemainder(row({ serviceCostMinor: null, serviceCostCurrency: null })), null);
  assert.equal(salesRowRemainder(row({ archived: true })), null, "an archived record is outside the working totals");
  assert.deepEqual([
    row(), row({ archived: true }), row({ serviceCostMinor: null, serviceCostCurrency: null, paidMinor: null, paidCurrency: null, paidRaw: "" }),
    row({ paidMinor: null, paidCurrency: null, paidRaw: "половина" }), row({ paidMinor: null, paidCurrency: null, paidRaw: " " }), row({ paidCurrency: "KGS" }),
  ].map((one) => { const why = salesRowNoRemainder(one); return why && SALES_NO_REMAINDER_TEXT[why]; }),
  [null, "в архиве", "нет стоимости", "оплата не разобрана", "оплата не указана", "оплата в другой валюте"]);

  const summary = salesMoneySummary([
    row(), row({ paidMinor: null, paidCurrency: null, paidRaw: "" }),
    row({ serviceCostMinor: 1200000, serviceCostCurrency: "KGS", paidMinor: 500000, paidCurrency: "KGS" }),
    row({ serviceCostMinor: 180000, paidMinor: 4500000, paidCurrency: "KGS" }),
    row({ serviceCostMinor: null, serviceCostCurrency: null }),
    row({ paidMinor: null, paidCurrency: null, paidRaw: "половина" }),
  ]);
  // Запись без оплаты в строку USD не входит: ни стоимостью, ни «оплатой 0», ни остатком.
  assert.deepEqual(summary.lines, [
    { currency: "KGS", costMinor: 1200000, paidMinor: 500000, remainderMinor: 700000, count: 1 },
    { currency: "USD", costMinor: 150000, paidMinor: 60000, remainderMinor: 90000, count: 1 },
  ]);
  assert.deepEqual(summary.cross, [{ costCurrency: "USD", paidCurrency: "KGS", costMinor: 180000, paidMinor: 4500000, count: 1 }]);
  assert.equal(summary.noCost, 1);
  assert.equal(summary.paidUnclear, 1);
  assert.equal(summary.paidMissing, 1);
  for (const line of summary.lines) assert.equal(line.costMinor - line.paidMinor, line.remainderMinor);
  // Архивные записи в суммы не входят вовсе (и «Архив» сумм не показывает).
  const archivedOnly = salesMoneySummary([row({ archived: true }), row({ archived: true, paidMinor: null, paidCurrency: null, paidRaw: "" })]);
  assert.deepEqual([archivedOnly.lines, archivedOnly.cross, archivedOnly.noCost, archivedOnly.paidUnclear, archivedOnly.paidMissing], [[], [], 0, 0, 0]);

  // Основа сумм — записи месяца отчёта: сколько из них без даты продажи и с датой в другом периоде.
  const rows = [row(), row({ signingDate: null }), row({ signingDate: "2026-08-30" }), row({ signingDate: "2026-09-30" })];
  assert.deepEqual(salesSummaryBasis(rows, { year: 2026, month: 9 }), { total: 4, undated: 1, otherSaleDate: 1 });
  assert.deepEqual(salesSummaryBasis(rows, { year: 2026, month: undefined }), { total: 4, undated: 1, otherSaleDate: 0 });
  assert.deepEqual([1, 2, 9, 11, 21, 111].map(recordsDative), ["записи", "записям", "записям", "записям", "записи", "записям"]);
});

test("«Отчёт продаж»: the month stepper crosses years, «весь год» steps by year; words agree with numbers", () => {
  assert.deepEqual(salesPeriodSteps(2026, 9), { previous: { year: 2026, month: 8 }, next: { year: 2026, month: 10 } });
  assert.deepEqual(salesPeriodSteps(2026, 1).previous, { year: 2025, month: 12 });
  assert.deepEqual(salesPeriodSteps(2026, 12).next, { year: 2027, month: 1 });
  assert.deepEqual(salesPeriodSteps(2026, undefined), { previous: { year: 2025, month: undefined }, next: { year: 2027, month: undefined } });
  assert.deepEqual([0, 1, 2, 5, 11, 21, 22, 112].map(salesWord), ["продаж", "продажа", "продажи", "продаж", "продаж", "продажа", "продажи", "продаж"]);
  assert.deepEqual([1, 3, 5, 14, 101].map(recordsWord), ["запись", "записи", "записей", "записей", "запись"]);
});

const pages = new Map(JSON.parse(execFileSync(process.execPath,
  [fileURLToPath(new URL("./e2e/numbers-static-render.cjs", import.meta.url)), "--json-e4"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).map((page) => [page.name, page.html]));

test("rendered Lead 360: name as h1, stage and «Что дальше» in the header, one solid red", () => {
  const early = pages.get("lead-early");
  const potential = pages.get("lead-potential");
  const handed = pages.get("lead-handed");
  for (const page of [early, potential, handed]) {
    assert.equal(page.match(/<h1\b/gu)?.length, 1);
    assert.match(page, /<h1 class="t-page-title[^"]*">Алина Переданная/u);
    assert.match(page, /data-testid="v3-lead-header"/u);
    assert.match(page, /data-testid="v3-lead-overview"/u);
    assert.match(text(page), /Воронка продаж Алина Переданная/u, "the way back sits above the name");
  }
  assert.equal(solidRed(early), 1, "early");
  assert.match(early, /<button type="button" popoverTarget="lead-next-step" aria-haspopup="dialog" class="v3-raised [^"]*bg-accent[^"]*" data-testid="v3-lead-primary">Записать следующий шаг<\/button>/u);
  assert.equal(solidRed(potential), 1, "potential");
  assert.match(potential, /<a class="v3-raised [^"]*bg-accent[^"]*" data-testid="v3-lead-primary" href="\/v3\/main\?view=sales&amp;new=true&amp;lead=[^"]+">Оформить продажу<\/a>/u);
  assert.equal(solidRed(handed), 0, "handed");
  assert.match(handed, /data-testid="v3-lead-primary" href="\/v3\/profile\?case=[^"]+">Открыть дело<\/a>/u);
  // «Что дальше» правится прежней формой доски в панели верхнего слоя; после передачи панели нет.
  for (const page of [early, potential]) {
    assert.match(page, /<div id="lead-next-step" popover="auto" role="dialog" aria-labelledby="[^"]+" data-testid="v3-lead-step-drawer"/u);
    assert.match(page, /data-testid="v3-pipeline-workflow-form"/u);
    assert.match(page, /<button type="button" popoverTarget="lead-next-step" aria-haspopup="dialog" class="[^"]*underline[^"]*">Изменить<\/button>/u);
  }
  assert.doesNotMatch(handed, /v3-lead-step-drawer|v3-pipeline-workflow-form/u);
  assert.match(text(handed), /Что дальше Передано 18\.09 · Айгерим Условная · принято 19\.09/u);
  assert.match(text(early), /Что дальше Позвонить после консультации с родителями 29\.09/u);
  // Вторичные действия: «Написать» (связанная переписка) и «Задача по лиду» — не «Создать задачу»
  // верхней строки; на телефоне — значки 44 px, имя остаётся для чтения с экрана.
  const actions = potential.slice(potential.indexOf('data-testid="v3-lead-actions"'), potential.indexOf('data-testid="v3-lead-actions-menu"'));
  assert.match(actions, /title="Написать"[^>]*>.*?<span class="sr-only sm:not-sr-only">Написать<\/span><\/a>/u);
  // Э7: «Задача по лиду» открывает на месте тот же диалог «Новая задача», что у всех входов, — это кнопка.
  assert.match(actions, /<button type="button" aria-haspopup="dialog" title="Задача по лиду" data-testid="v3-lead-task"[^>]*>.*?<span class="sr-only sm:not-sr-only">Задача по лиду<\/span><\/button>/u);
  assert.doesNotMatch(actions, />Создать задачу</u);
  // Итог сохранения шага — в строке состояния шапки, а не внутри закрытой панели.
  assert.match(potential, /<p role="status" aria-live="polite" class="sr-only" data-testid="v3-lead-step-status"><\/p><div id="lead-next-step" popover="auto"/u);
  // Блоки Э1.3: дорожка этапа, срок словом, инициалы.
  assert.match(pages.get("lead-early"), /data-track="sales"/u);
  assert.match(pages.get("lead-early"), /<span class="sr-only">Связались, текущий этап, Продажи<\/span>/u);
  assert.match(pages.get("lead-early"), /class="v3-due t-caption" data-due="upcoming">через 2 дн</u);
  assert.match(pages.get("lead-early"), /v3-initials/u);
  assert.match(text(pages.get("lead-potential")), /Подписать договор 26\.09 прошёл 1 дн Изменить/u);
});

test("rendered Lead 360: feed on the left, facts and the «Передача» strip on the right, groups one at a time with a quiet save", () => {
  const page = pages.get("lead-potential");
  // Лента: однострочная заметка — прежнее действие, кнопка спокойная; заметки и события новые сверху.
  assert.match(page, /data-testid="v3-lead-note-composer"/u);
  assert.match(page, /<textarea id="lead-note-body" name="body" required="" rows="1"/u);
  assert.match(page, /<button type="submit" class="v3-raised inline-flex min-h-11 [^"]*t-label[^"]*">Добавить заметку<\/button>/u);
  assert.match(text(page), /Лента Новая заметка Добавить заметку Встреча прошла.*? Санжар Эскизов · 23\.09 16:15 Назначили встречу.*? Квалифицирован:.*? Лид создан · сайт 05\.09 11:00/u);
  // Порядок чтения (и телефона): «Сведения», лента, «Передача», группы правки.
  assert.match(text(page), /Сведения Ответственный СЭ Санжар Эскизов Источник сайт · с 05\.09\.2026 Контакты \+996 000 000 002 lead@example\.invalid Последний контакт 23\.09 16:15 · заметка Лента .*? Лид создан · сайт 05\.09 11:00 Передача ничего не подтверждено Данные лида/u);
  assert.match(page, /<a href="tel:\+996000000002" class="flex min-h-11/u);
  // До первого доказательства «Передача» — одна строка, не пять прочерков; первый факт — полоса.
  assert.doesNotMatch(page, /data-handoff-item="/u);
  assert.match(page, /data-testid="v3-handoff-empty">ничего не подтверждено</u);
  assert.equal((pages.get("lead-handed").match(/data-handoff-item="/gu) ?? []).length, 5);
  // От 1280 px правая колонка — с волосяной линией слева во весь рост.
  assert.match(page, /data-testid="v3-lead-overview"><aside class="@container min-w-0 xl:col-start-2 xl:row-start-1 xl:border-s xl:border-border xl:ps-6"/u);
  assert.match(page, /<div class="flex min-w-0 flex-col gap-6 xl:col-start-2 xl:row-start-2 xl:border-s xl:border-border xl:ps-6 xl:pt-6"><section aria-labelledby="lead-handoff-title"/u);
  // Группы правки: одно имя у всех — открыта одна; «Сохранить» — спокойная кнопка, не красная.
  const groups = [...page.matchAll(/<details name="lead-edit"[^>]*data-testid="(v3-lead-group-[a-z]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(groups, ["v3-lead-group-sale", "v3-lead-group-wishes", "v3-lead-group-education", "v3-lead-group-conditions",
    "v3-lead-group-contract", "v3-lead-group-portal"]);
  assert.match(page, /<details name="lead-edit" id="sale-conditions"/u, "#sale-conditions from the report and the money tab still lands here");
  assert.match(page, /<details name="lead-edit" id="portal-access"/u);
  assert.doesNotMatch(page, /<details name="lead-edit"[^>]* open=""/u, "all groups start collapsed");
  assert.match(text(page), /Условия продажи Поступление в Малайзию «под ключ» · 1 500 USD/u);
  assert.match(text(page), /Пожелания Малайзия · IT, бизнес · 2027/u);
  // Названия групп не повторяют соседей: «Условия» — бюджет и ограничения, подтверждения — не вкладка «Договор и оплата».
  assert.match(text(page), /Бюджет и ограничения бюджет 8 000 USD/u);
  assert.match(text(page), /Подтверждение договора и платежа договор не подтверждён/u);
  const edit0 = page.slice(page.indexOf('data-testid="v3-lead-edit"'));
  assert.doesNotMatch(edit0, /<span class="t-item text-fg">(Условия|Договор и оплата)<\/span>/u);
  const edit = page.slice(page.indexOf('data-testid="v3-lead-edit"'));
  assert.equal(solidRed(edit), 0);
  assert.match(edit, />Сохранить условия<\/button>/u);
  assert.equal(edit.match(/>Сохранить<\/button>/gu)?.length, 3, "Пожелания, Образование, Условия");
  assert.match(edit, /data-testid="v3-lead-gate-forms"/u);
  // «⋯»: «Доступ к порталу» раскрывает свою группу, «Закрыть лид…» — прежнее окно.
  const menu = page.slice(page.indexOf('data-testid="v3-lead-actions-menu"'));
  assert.match(menu, /^data-testid="v3-lead-actions-menu"[^>]*><button type="button" class="[^"]*">Доступ к порталу<\/button><button type="button" class="[^"]*">Закрыть лид…<\/button>/u);
  // Переданный лид: закрыть нельзя, причина словами; строки передачи в «Сведениях» второй раз нет.
  const handed = pages.get("lead-handed");
  assert.match(text(handed), /Закрыть лид Лид передан в поступление — это продажа\./u);
  assert.doesNotMatch(handed, /v3-handoff-summary/u);
  assert.doesNotMatch(handed, /v3-lead-group-contract/u, "nothing left to confirm — no group");
});

test("rendered «Отчёт продаж»: stepper, plan headline, sums by currency, one toolbar row and single-line rows", () => {
  const report = pages.get("report");
  assert.equal(report.match(/<h1\b/gu)?.length, 1);
  assert.equal(solidRed(report), 1);
  assert.match(report, /<a class="v3-raised [^"]*bg-accent[^"]*" href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9&amp;new=true">Добавить продажу<\/a>/u);
  // Переключатель месяца вместо года числом и месяца списком; «Весь год» — в его меню.
  assert.match(report, /aria-label="Предыдущий месяц"[^>]*href="\/v3\/main\?view=sales&amp;year=2026&amp;month=8"|href="\/v3\/main\?view=sales&amp;year=2026&amp;month=8"[^>]*aria-label="Предыдущий месяц"/u);
  assert.match(report, /href="\/v3\/main\?view=sales&amp;year=2026&amp;month=10"/u);
  assert.match(text(report), /Отчёт продаж Сентябрь 2026 Январь 2026 .*? Декабрь 2026 Весь 2026 год Добавить продажу/u);
  assert.doesNotMatch(report, /name="year"[^>]*type="number"|>Показать<\/button>|Найдено по фильтрам/u);
  // «N продаж из плана M» и тонкая полоса (Э1.3).
  assert.match(text(report), /8 продаж из плана 35 по дате продажи за сентябрь 2026, без архива · осталось 27/u);
  assert.match(report, /v3-progress-track/u);
  // Основа сумм названа рядом с заголовком: записи месяца отчёта, из них без даты продажи —
  // «8 продаж» (по дате продажи) и суммы по 9 записям не спорят молча.
  assert.match(report, /<p class="t-meta text-fg-2" data-money-basis="9">Суммы по 9 записям месяца отчёта, из них 1 без даты продажи<\/p>/u);
  // Выровненная таблица: подписи столбцов один раз, строки валют; остаток — только внутри
  // одной валюты; оплата в другой валюте — своей строкой пары без остатка.
  // «Тимур Образцов» (1 500 USD, оплата не указана) в строку USD не входит: 8 500 − 5 800 = 2 700.
  assert.match(text(report), /Валюта Стоимость Оплачено Остаток KGS 120 000 50 000 70 000 USD 8 500 5 800 2 700 USD → KGS : стоимость в USD, оплата в KGS, 1 запись 1 800 USD 45 000 KGS — остаток не считается/u);
  assert.match(report, /<tr data-money-cross="USD&gt;KGS">/u);
  // Сноска — одна строка.
  const money = report.slice(report.indexOf('data-testid="sales-money-summary"'), report.indexOf("</section>", report.indexOf('data-testid="sales-money-summary"')));
  assert.equal(money.match(/<p\b/gu)?.length, 2, "the basis line and one footnote");
  assert.match(text(money), /USD → KGS — стоимость в USD, оплата в KGS \(1 запись\): остаток не считается\. Не вошли: без стоимости — 1 запись, оплата не указана — 1 запись\. Валюты не пересчитываются; это записи отчёта, не поступления за месяц\./u);
  // Одна строка инструментов, выбор применяется ссылкой; «Нужно уточнить · N» — из чтения.
  assert.match(report, /data-testid="sales-review-toggle" href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9&amp;review=true">Нужно уточнить<span class="tabular-nums"> · 6<\/span><\/a>/u);
  assert.match(report, /href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9&amp;archived=true">Архив<\/a>/u);
  // Менеджер: три написания одного имени — одна строка меню.
  const managers = report.slice(report.indexOf('aria-label="Менеджер"'), report.indexOf('aria-label="Направление"'));
  assert.equal(managers.match(/>Санжар Эскизов</gu)?.length, 1);
  assert.doesNotMatch(managers, /другое написание/u);
  const directions = report.slice(report.indexOf('role="group" aria-label="Направление"'));
  assert.deepEqual([...directions.slice(0, directions.indexOf("</ul>")).matchAll(/<span class="min-w-0 flex-1">([^<]+)<\/span>/gu)].map((match) => match[1]),
    ["Все", "Китай", "Малайзия", "China"], "«China» and «Китай» stay apart: the mapping to the direction list is the owner's later step");
  // Строки в одну линию: причины «Уточнить» словами из записи или «Сверено».
  assert.match(text(report), /Студент Страна · программа Менеджер Дата Стоимость Оплачено Остаток Уточнить/u);
  assert.match(text(report), /Бекзат Тестов Малайзия · Бакалавриат Санжар Эскизов — 1 500 USD 600 USD остаток 900 USD нет даты продажи/u);
  assert.match(text(report), /Руслан Прототипов Малайзия · Бакалавриат Айдана Макетова 03\.09 1 800 USD 45 000 KGS остаток — \(оплата в другой валюте\) оплата в другой валюте/u);
  assert.match(text(report), /Айжан Примерова Малайзия · Бакалавриат санжар эскизов 20\.09 1 500 USD 600 USD остаток 900 USD причина не записана/u);
  assert.match(text(report), /Алина Переданная Малайзия · Бакалавриат Санжар Эскизов 22\.09 1 500 USD 600 USD остаток 900 USD Сверено/u);
  // Оплата не указана — неизвестна: остатка нет, причина — подсказкой и для чтения с экрана, на узкой строке — словами.
  assert.match(text(report), /Тимур Образцов Китай · Магистратура, экономика Айдана Макетова 14\.09 1 500 USD — остаток — \(оплата не указана\) причина не записана/u);
  assert.match(report, /<span class="block truncate t-body-compact tabular-nums text-fg" title="оплата не указана" data-no-remainder="paid_missing">/u);
  assert.doesNotMatch(text(report), /остаток 1 500 USD/u, "no remainder built on an unknown payment");
  assert.match(report, /<p class="truncate t-meta tabular-nums text-fg-2">стоимость 1\s500\sUSD · оплата не указана<\/p>/u);
  assert.match(report, /<time dateTime="2026-09-22" class="t-body-compact text-fg-2 font-mono tabular-nums">22\.09<\/time>/u);
  // Узкая строка: дата — JetBrains Mono, «Уточнить» — своей строкой целиком, без многоточия.
  assert.match(report, /<p class="truncate t-meta text-fg-2"><time dateTime="2026-09-20" class="font-mono tabular-nums">20\.09<\/time> · санжар эскизов · Малайзия · Бакалавриат<\/p>/u);
  assert.match(report, /<p class="break-words t-meta text-fg-2" data-row-review="">Уточнить: причина не записана<\/p>/u);
  assert.match(report, /<p class="break-words t-meta text-fg-3" data-row-review="">Сверено<\/p>/u);
  // Ширины столбцов: суммы — не шире нужного, место — тексту (от 70rem).
  assert.match(report, /<col class="w-\[11%\] @min-\[70rem\]\/sales-records:w-\[9\.5%\]"\/>/u);
  assert.match(report, /<col class="w-\[14%\] @min-\[70rem\]\/sales-records:w-\[18%\]"\/>/u);
  // «Изменить план месяца» — тем же шевроном, что группы правки, без знака браузера.
  assert.match(report, /<details class="group"><summary class="flex min-h-12 w-fit cursor-pointer list-none [^"]*\[&amp;::-webkit-details-marker\]:hidden">Изменить план месяца<svg/u);
  // Клик по строке открывает запись в панели рядом со списком: у того, кто исправляет, — сразу форма.
  assert.match(report, /href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9&amp;record=78787878-5555-4555-8555-000000000001&amp;edit=true"/u);
  assert.doesNotMatch(report, /queue-detail-panel/u);
});

test("rendered «Отчёт продаж»: the record opens in the right panel next to the list, the form saves quietly", () => {
  const page = pages.get("report-panel");
  assert.equal(page.match(/<h1\b/gu)?.length, 1, "the page keeps its one h1");
  assert.equal(solidRed(page), 1, "«Добавить продажу» stays the only red");
  assert.match(page, /aria-label="Записи продаж"/u, "the list stays");
  assert.match(page, /<dialog open="" aria-labelledby="sale-panel-title" data-testid="queue-detail-panel"/u);
  assert.match(page, /<h2 id="sale-panel-title" tabindex="-1" data-queue-heading="" class="t-record-title[^"]*">Айжан Примерова<\/h2>/u);
  // Без подписи над заголовком панели: имя несёт панель само.
  assert.doesNotMatch(page, /<p class="t-caption text-fg-2">Запись продажи<\/p>/u);
  assert.match(page, /data-testid="sales-register-form"/u);
  assert.match(page, /<button type="submit" class="v3-raised [^"]*bg-fg[^"]*"[^>]*>Сохранить продажу<\/button>/u);
  assert.match(page, /data-testid="queue-detail-close" [^>]*href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9"/u);
  assert.match(page, /data-selected="" class="[^"]*bg-surface-2/u);
  assert.doesNotMatch(page, /← К отчёту/u);
});

test("rendered «Отчёт продаж»: the report month stays visible where rows differ in it, and the sums name their basis", () => {
  const reportMonthCell = (month, words, compact) => new RegExp(`<td role="cell" class="[^"]*" data-report-month="${month}"><time dateTime="${month}" class="block truncate t-body-compact text-fg-2 font-mono tabular-nums" title="Месяц отчёта: ${words}">${compact.replace(".", "\\.")}</time></td>`, "u");
  const reportMonthLine = (month, words) => `<p class="truncate t-meta text-fg-2" data-report-month="${month}">Месяц отчёта: ${words}</p>`;
  // Месяц — один месяц отчёта: столбца и строки нет.
  const month = pages.get("report");
  assert.doesNotMatch(month, /data-report-month|Месяц отчёта/u);
  // «Весь 2026 год»: столбец «Месяц отчёта» (широкий контейнер) и строка «Месяц отчёта: …» (узкий:
  // телефон и список рядом с открытой записью) у каждой записи — видимым текстом, не подсказкой.
  for (const name of ["report-year", "report-year-panel"]) {
    const year = pages.get(name);
    assert.match(text(year), /Студент Страна · программа Менеджер Дата Месяц отчёта Стоимость Оплачено Остаток Уточнить/u);
    assert.match(year, reportMonthCell("2026-08", "Август 2026", "08.2026"));
    assert.match(year, reportMonthCell("2026-07", "Июль 2026", "07.2026"));
    assert.ok(year.includes(reportMonthLine("2026-09", "Сентябрь 2026")));
    assert.ok(year.includes(reportMonthLine("2026-07", "Июль 2026")));
    assert.equal(year.match(/<p class="truncate t-meta text-fg-2" data-report-month=/gu)?.length, 12, "every row of the year");
    assert.doesNotMatch(year, /<span class="sr-only">\. Месяц отчёта/u, "not a screen-reader-only copy");
    assert.equal(year.slice(year.indexOf("<colgroup"), year.indexOf("</colgroup>")).match(/<col\b/gu)?.length, 9);
    assert.match(year, /<p class="t-meta text-fg-2" data-money-basis="12">Суммы по 12 записям года отчёта, из них 1 без даты продажи<\/p>/u);
  }
  assert.match(pages.get("report-year-panel"), /data-testid="queue-detail-panel"/u);
  // Срез июля «записаны в другой месяц отчёта»: у строки её месяц отчёта; основа сумм — эти продажи,
  // а не «записи месяца отчёта».
  const elsewhere = pages.get("report-elsewhere");
  assert.match(text(elsewhere), /Продажи периода, записанные в другой месяц отчёта — июль 2026\./u);
  assert.match(elsewhere, /<p class="t-meta text-fg-2" data-money-basis="1">Суммы по 1 записи с датой продажи в этом месяце и другим месяцем отчёта<\/p>/u);
  assert.doesNotMatch(elsewhere, /записи месяца отчёта|записям месяца отчёта/u);
  assert.match(elsewhere, reportMonthCell("2026-08", "Август 2026", "08.2026"));
  assert.ok(elsewhere.includes(reportMonthLine("2026-08", "Август 2026")));
  assert.match(text(elsewhere), /Эрлан Выдуманный Малайзия · Бакалавриат Санжар Эскизов 30\.07 08\.2026 2 000 USD 2 000 USD/u);
  // Больше 500 записей: остатка нет, суммы — сервера по записям, и неуточнённые значения,
  // которых в них нет, названы числом (как до Э4).
  const bulk = pages.get("report-bulk");
  const money = bulk.slice(bulk.indexOf('data-testid="sales-money-summary"'), bulk.indexOf("</section>", bulk.indexOf('data-testid="sales-money-summary"')));
  assert.match(text(money), /Суммы по 520 записям месяца отчёта Стоимость, оплачено и остаток по валютам Валюта Стоимость Оплачено по записям USD/u);
  assert.doesNotMatch(money, />Остаток</u);
  // Как 247: неуточнённая оплата — каждая запись без суммы оплаты (75 без стоимости и оплаты + 41 неразобранная).
  assert.match(text(money), /Остаток не посчитан: в выборке больше 500 записей — сузьте период или фильтры\. В денежные итоги не включены неуточнённые значения: стоимость — 75, оплата — 116\. Валюты не пересчитываются/u);
  const view = read("src/components/v3/SalesRegisterView.tsx");
  assert.match(view, /workspace\.unresolvedCostCount > 0 \|\| workspace\.unresolvedPaidCount > 0/u);
});

test("rendered «Отчёт продаж»: «Архив» shows how many records, with no sums and no remainder, as the server and main do", () => {
  const page = pages.get("report-archive");
  assert.doesNotMatch(page, /sales-money-summary|sales-money-table|Суммы по/u, "no money summary for archived records");
  assert.match(page, /<p class="mt-4 border-y border-border py-3 t-meta text-fg-2" data-testid="sales-archive-basis" data-archive-count="2">В архиве — 2 записи месяца отчёта\. Архивные записи не входят в рабочие итоги: суммы и остаток по ним не считаются\.<\/p>/u);
  assert.match(text(page), /Студент Страна · программа Менеджер Дата Стоимость Оплачено Уточнить/u);
  assert.doesNotMatch(page, />Остаток<|data-no-remainder|>остаток </u, "no remainder column or cell");
  assert.equal(page.slice(page.indexOf("<colgroup"), page.indexOf("</colgroup>")).match(/<col\b/gu)?.length, 7);
  // Строки — прежние стоимость и оплата по записи; неизвестная оплата — словами.
  assert.match(text(page), /Ольга Архивная Малайзия · Бакалавриат Санжар Эскизов 08\.09 1 500 USD 600 USD В архиве/u);
  assert.match(text(page), /Марат Отложенный Малайзия · Бакалавриат Санжар Эскизов 16\.09 1 500 USD — В архиве/u);
  assert.match(page, /<a [^>]*aria-current="true" class="v3-choice[^"]*" href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9">Архив<\/a>|href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9"[^>]*>Архив<\/a>/u);
  assert.equal(solidRed(page), 1);
  const view = read("src/components/v3/SalesRegisterView.tsx");
  assert.match(view, /const summaryRead = workspace && !creatingForm && !archiveView \? await readSummaryRows\(/u, "no all-pages read for the archive");
});

test("rendered «Отчёт продаж»: «Поступления и возвраты за месяц» keeps its read, words and states, below the records", () => {
  const page = pages.get("report-cash");
  const start = page.indexOf('data-testid="sales-cash-totals"');
  assert.ok(start > page.indexOf('aria-label="Страницы отчёта"'), "below the records and their pages");
  const cash = page.slice(start, page.indexOf("</section>", start));
  assert.match(text(cash), /Поступления и возвраты за месяц Подтверждённые финансовые события всей организации по дате операции, время Бишкека\. Фильтры строк продаж на этот блок не влияют\. Расходы третьих сторон не являются выручкой EVO\./u);
  assert.match(text(cash), /USD Получено 5 400,00 USD Возвращено 600,00 USD Итого 4 800,00 USD KGS Получено 50 000,00 KGS Возвращено 0,00 KGS Итого 50 000,00 KGS/u);
  assert.equal(cash.match(/<dl\b/gu)?.length, 2, "a term list per currency, as before");
  assert.equal(cash.match(/<dt>/gu)?.length, 6);
  // Без сводки (роль её не читает) блока нет, как и прежде.
  assert.doesNotMatch(pages.get("report"), /sales-cash-totals/u);
  const view = read("src/components/v3/SalesRegisterView.tsx");
  assert.match(view, /Не удалось загрузить финансовую сводку\. Обновите страницу, чтобы повторить\./u);
  assert.match(view, /В этом месяце подтверждённых финансовых событий нет\./u);
  assert.match(view, /\{workspace && cash && cash\.status !== "not_allowed" && month \?/u);
});

test("the page wires Lead 360 through the board's reads and «Оформить продажу» through the report's own search", () => {
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /const leadSales = view && !caseTarget && view\.details\.routeTarget\.leadId \? view\.sales : null;/u);
  assert.match(page, /readsOwners \? readPipelineOwnerOptions\(actor\)\.catch\(\(\) => null\) : null,/u);
  assert.match(page, /staffHasPermission\(actor, "lead\.sales\.workflow\.manage"\) && staffHasPermission\(actor, "lead\.sales\.owner\.assign"\)/u);
  assert.match(page, /stages: readPipelineStages\(\)\.flatMap\(\(stage\) => stage\.key === "handed_off" \? \[\] : \[\{ key: stage\.key, title: stage\.title \}\]\),/u);
  // Student 360 (Э4): действия дела у заголовка — `caseParts.actions`, как у Lead 360.
  assert.match(page, /action=\{docsAction \?\? caseParts\?\.actions \?\? leadParts\?\.actions\}/u);
  // Вкладка браузера остаётся «Лид — EVO CRM».
  assert.match(read("src/lib/v3/navigation.ts"), /isLeadProfile\(query\)\) return "Лид";/u);
  const drawer = read("src/components/v3/profile/LeadStepDrawer.tsx");
  assert.match(drawer, /<PipelineDecisionForm\s+key=\{`\$\{lead\.leadId\}:\$\{lead\.workflowVersion\}`\}/u);
  // Панель ставит фокус на «Следующее действие», после сохранения закрывается и возвращает фокус.
  assert.match(drawer, /element\.querySelector<HTMLElement>\('textarea\[name="next_action_text"\]'\)/u);
  assert.match(drawer, /if \(element\?\.matches\(":popover-open"\)\) element\.hidePopover\(\);/u);
  assert.match(drawer, /if \(back\?\.isConnected\) back\.focus\(\);/u);
  assert.match(drawer, /onSaved=\{closeSaved\}/u);
  const view = read("src/components/v3/SalesRegisterView.tsx");
  assert.match(view, /const leadId = creatingForm && typeof query\.lead === "string" \? parseSalesUuid\(query\.lead\) : null;/u);
  assert.match(view, /getPlatformSalesLead\(actor, leadId\)\.then\(\(lead\) => lead\?\.clientDisplayName \? \{ id: lead\.leadId, query: lead\.clientDisplayName \} : null, \(\) => null\)/u);
  assert.match(view, /const rowHref = \(row: SalesRegisterRow\) => href\(canManage \? \{ record: row\.id, edit: "true" \} : \{ record: row\.id \}\);/u);
  const forms = read("src/components/v3/SalesRegisterForms.tsx");
  assert.match(forms, /const result = await searchSalesRegisterStudentsAction\(wanted\.query\)/u);
  assert.match(forms, /const lead = result\.leads\.find\(item => item\.id === wanted\.id\) \?\? null;\s+if \(lead\) chooseLead\(lead\);/u);
  // Главная рисует отчёт без признака облика: облик один (Э1.5).
  assert.match(read("src/app/(v3)/v3/main/page.tsx"), /<SalesRegisterView actor=\{actor\} query=\{query\} dynamics=\{section\} \/>/u);
});
