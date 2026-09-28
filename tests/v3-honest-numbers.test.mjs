// Э2 «Честные числа» (решения владельца 26.09.2026, миграция 247): одно
// правило этапа, одно определение передачи и одно определение «Продажи».
// Синтетические данные: имена и числа выдуманы, записей EVO здесь нет. Живой
// Supabase и права проверяет supabase/tests/platform_sales_one_truth.sql.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { PLATFORM_SALES_STAGES } from "../src/lib/platform-sales-contract.ts";
import { parseLeadHandoffStrip, parseSalesCount } from "../src/lib/sales-numbers-contract.ts";
import { isWorkingSalesStage, resolveSalesStage, SALES_BOARD_STAGES } from "../src/lib/v3/sales-stage.ts";
import * as access from "../src/lib/platform-access.ts";
import * as wording from "../src/lib/v3/wording.ts";
import * as stripView from "../src/components/v3/profile/handoff-strip-view.ts";
const { handoffFootnote, handoffStripView, salesRecordHref, stripCaseMoney, stripDay, stripPlain } = stripView;
import { parseSalesSaleSlice, salesReportContext } from "../src/lib/sales-register-navigation.ts";
import * as salesView from "../src/lib/sales-register-view.ts";

const require = createRequire(import.meta.url);
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime.js");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(path, resolve = require) {
  const code = ts.transpileModule(read(path), { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(resolve, compiled, compiled.exports);
  return compiled.exports;
}

const ORG = "10000000-0000-4000-8000-000000000001";
const LEAD = "10000000-0000-4000-8000-000000000702";
const RECORD = "10000000-0000-4000-8000-000000001902";
// «Сегодня» — 26.09.2026, полдень по Бишкеку.
const NOW = new Date("2026-09-26T06:00:00Z");

// Тот же ответ, что SQL-набор получает для лида 702 (передан через 088, запись в архиве).
const HANDED_JSON = {
  organization_id: ORG, lead_id: LEAD, stage: "handed_off",
  handoff: { completed_at: "2026-09-18T05:00:00+00:00", evidence: "handoff", acceptance_recordable: true },
  contract: { confirmed: true, confirmed_at: "2026-09-17T05:00:00+00:00" },
  first_payment: { received_date: "2026-09-17" },
  report: { status: "available", record: { id: RECORD, report_month: "2026-09-01", sale_date: "2026-09-17", archived: false,
    has_contract_number: true, paid: { minor: "60000", currency: "USD" }, link: "sale" } },
  curator: { display_name: "Куратор Синтетический", assigned_at: "2026-09-18T05:05:00+00:00" },
  acceptance: { decision: "accepted", at: "2026-09-19T03:30:00+00:00" },
};
const WORKING_JSON = {
  organization_id: ORG, lead_id: LEAD, stage: "qualified", handoff: null,
  contract: { confirmed: false, confirmed_at: null }, first_payment: { received_date: null },
  report: { status: "available", record: null }, curator: null, acceptance: null,
};
const parse = (json) => parseLeadHandoffStrip(json, { organizationId: ORG, leadId: LEAD });

test("one stage resolver: the truth table of platform_private.sales_lead_stage", () => {
  // Те же строки, что раздел 0 supabase/tests/platform_sales_one_truth.sql.
  for (const [lifecycleState, stageKey, handedOff, expected] of [
    ["open", "new", false, "new"],
    ["open", "new", true, "handed_off"],
    ["open", "qualified", false, "qualified"],
    ["open", "potential", true, "handed_off"],
    ["disqualified", "contacting", false, "closed"],
    ["disqualified", "qualified", true, "closed"],
    ["converted", "new", true, "closed"],
    ["archived", "new", false, "closed"],
  ]) {
    assert.equal(resolveSalesStage({ lifecycleState, stageKey, handedOff }), expected, `${lifecycleState}/${stageKey}/${handedOff}`);
  }
  assert.deepEqual(SALES_BOARD_STAGES, [...PLATFORM_SALES_STAGES, "handed_off"]);
  assert.equal(isWorkingSalesStage("handed_off"), false);
  assert.equal(isWorkingSalesStage("closed"), false);
  assert.ok(PLATFORM_SALES_STAGES.every(isWorkingSalesStage));
});

test("one list of sales stage names: six working stages and «Переданы», as the board columns", () => {
  assert.deepEqual(Object.keys(wording.SALES_STAGE_TITLE), [...SALES_BOARD_STAGES]);
  assert.deepEqual(SALES_BOARD_STAGES.map((key) => wording.salesStage(key)), [
    "Новый", "Связались", "Квалифицирован", "Встреча назначена", "Встреча проведена", "Потенциальный клиент", "Переданы",
  ]);
  assert.equal(wording.salesStage("handed_off"), wording.FUNNEL_STEP.handed);
  for (const key of PLATFORM_SALES_STAGES) {
    const word = wording.leadStage(key);
    assert.equal(wording.salesStage(key), word.charAt(0).toUpperCase() + word.slice(1), key);
  }
});

test("the board, «Сегодня» and the report funnel resolve the stage with the one resolver", () => {
  const pipeline = read("src/lib/v3/pipeline-source.ts");
  assert.match(pipeline, /import \{ resolveSalesStage, SALES_BOARD_STAGES \} from "@\/lib\/v3\/sales-stage";/u);
  assert.match(pipeline, /const STAGES: readonly PipelineStage\[\] = SALES_BOARD_STAGES\.map\(/u);
  assert.match(pipeline, /const stageKey = resolveSalesStage\(\{\s*lifecycleState: row\.lifecycleState,\s*stageKey: row\.stageKey,\s*handedOff: completed\.has\(row\.leadId\),\s*\}\);/u);
  assert.doesNotMatch(pipeline, /\? "handed_off" as const/u, "no second, inline stage rule");
  // Период: «Переданы» — завершённые передачи, а не любое дело или кабинет.
  const funnel = read("src/lib/v3/funnel-source.ts");
  assert.doesNotMatch(funnel, /linkedStudentCaseCount/u);
  assert.match(funnel, /readCompletedSalesHandoffs\(actor, \[\.\.\.cohortLeadIds\]\)/u);
  assert.match(funnel, /handed: handedLeadIds\.has\(row\.leadId\)/u);
  assert.match(funnel, /handed: handedRead \? cohort\.filter\(\(row\) => row\.handed\)\.length : null/u);
  // Lead 360: этап карточки — из полосы (SQL-правило), не сырой stage_key.
  const tabs = read("src/components/v3/profile/tabs.tsx");
  assert.doesNotMatch(tabs, /leadStage\(sales\.lead\.stageKey\)/u);
  assert.match(tabs, /handoffStripView\(sales\.strip\.strip, \{ now: new Date\(\) \}\)/u);
  assert.match(read("src/lib/v3/profile-source.ts"), /const stripRead = readLeadHandoffStrip\(actor, leadId\);/u);
});

test("the strip parser accepts exactly the SQL payload and refuses anything it cannot trust", () => {
  const strip = parse(HANDED_JSON);
  assert.equal(strip.stage, "handed_off");
  assert.deepEqual(strip.handoff, { completedAt: "2026-09-18T05:00:00+00:00", evidence: "handoff", acceptanceRecordable: true });
  assert.deepEqual(strip.report, { status: "available", record: { id: RECORD, reportMonth: "2026-09-01", saleDate: "2026-09-17", archived: false,
    hasContractNumber: true, paid: { minor: 60000, currency: "USD" }, link: "sale" } });
  // A 208 sale (no 088 row): the curator cannot answer; a declined handoff has no curator (182 cleared it).
  assert.equal(parse({ ...HANDED_JSON, handoff: { ...HANDED_JSON.handoff, evidence: "sales_report", acceptance_recordable: false }, acceptance: null })
    .handoff.acceptanceRecordable, false);
  assert.equal(parse({ ...HANDED_JSON, curator: null, acceptance: { decision: "declined", at: "2026-09-20T04:00:00+00:00" } }).acceptance.decision, "declined");
  assert.equal(parse(WORKING_JSON).stage, "qualified");
  assert.equal(parse({ ...WORKING_JSON, report: { status: "denied", record: null } }).report.status, "denied");
  for (const [label, json] of [
    ["another organization", { ...HANDED_JSON, organization_id: "10000000-0000-4000-8000-000000000009" }],
    ["another lead", { ...HANDED_JSON, lead_id: "10000000-0000-4000-8000-000000000009" }],
    ["an extra key", { ...HANDED_JSON, extra: 1 }],
    ["a missing key", Object.fromEntries(Object.entries(HANDED_JSON).filter(([key]) => key !== "acceptance"))],
    ["an unknown stage", { ...HANDED_JSON, stage: "won" }],
    ["«Переданы» without a handoff", { ...WORKING_JSON, stage: "handed_off" }],
    ["a handoff on a working stage", { ...HANDED_JSON, stage: "new" }],
    ["a curator without a handoff", { ...WORKING_JSON, curator: HANDED_JSON.curator }],
    ["an answer without a curator", { ...HANDED_JSON, curator: null }],
    ["an 088 handoff nobody can answer", { ...HANDED_JSON, handoff: { ...HANDED_JSON.handoff, acceptance_recordable: false } }],
    ["a handoff without the answer flag", { ...HANDED_JSON, handoff: { completed_at: HANDED_JSON.handoff.completed_at, evidence: "handoff" } }],
    ["a zero payment", { ...HANDED_JSON, report: { status: "available", record: { ...HANDED_JSON.report.record, paid: { minor: "0", currency: "USD" } } } }],
    ["a numeric payment", { ...HANDED_JSON, report: { status: "available", record: { ...HANDED_JSON.report.record, paid: { minor: 60000, currency: "USD" } } } }],
    ["a payment without a currency", { ...HANDED_JSON, report: { status: "available", record: { ...HANDED_JSON.report.record, paid: { minor: "60000", currency: "" } } } }],
    ["a record without the contract flag", { ...HANDED_JSON, report: { status: "available", record: Object.fromEntries(
      Object.entries(HANDED_JSON.report.record).filter(([key]) => key !== "has_contract_number")) } }],
    ["a record with an unknown link", { ...HANDED_JSON, report: { status: "available", record: { ...HANDED_JSON.report.record, link: "pipeline" } } }],
    ["an unknown evidence", { ...HANDED_JSON, handoff: { ...HANDED_JSON.handoff, evidence: "case_exists" } }],
    ["a broken timestamp", { ...HANDED_JSON, handoff: { ...HANDED_JSON.handoff, completed_at: "18.09.2026" } }],
    ["a confirmed contract without a date", { ...HANDED_JSON, contract: { confirmed: true, confirmed_at: null } }],
    ["an impossible date", { ...HANDED_JSON, first_payment: { received_date: "2026-02-30" } }],
    ["a record in a non-month", { ...HANDED_JSON, report: { status: "available", record: { ...HANDED_JSON.report.record, report_month: "2026-09-15" } } }],
    ["a denied report with a record", { ...HANDED_JSON, report: { status: "denied", record: HANDED_JSON.report.record } }],
  ]) {
    assert.equal(parse(json), null, label);
  }
  // A closed lead keeps its historical handoff.
  assert.equal(parse({ ...HANDED_JSON, stage: "closed" }).stage, "closed");
});

test("«Продажи»: the count parser keeps the four numbers and refuses a mismatch", () => {
  const expected = { organizationId: ORG, from: "2026-09-01", to: "2026-09-30" };
  const json = { organization_id: ORG, from: "2026-09-01", to: "2026-09-30", sales: "5", undated: "1", other_sale_date: "1", filed_elsewhere: "1" };
  assert.deepEqual(parseSalesCount(json, expected), { from: "2026-09-01", to: "2026-09-30", sales: 5, undated: 1, otherSaleDate: 1, filedElsewhere: 1 });
  assert.equal(parseSalesCount({ ...json, to: "2026-09-29" }, expected), null, "another period");
  assert.equal(parseSalesCount({ ...json, sales: 5 }, expected), null, "counts are text");
  assert.equal(parseSalesCount({ ...json, sales: "-1" }, expected), null);
  assert.equal(parseSalesCount({ ...json, filed_elsewhere: "6" }, expected), null, "more filed elsewhere than sales");
  assert.equal(parseSalesCount({ ...json, extra: "0" }, expected), null);
});

// Э8.4: куда ведут предупреждения — у Admin есть всё; у роли без действия предупреждения нет.
const CASE_HREF = "/v3/profile?case=10000000-0000-4000-8000-000000000801";
const SALE_HREF = `/v3/main?view=sales&new=true&lead=${LEAD}`;
const ALL_LINKS = { caseHref: CASE_HREF, saleHref: SALE_HREF, assignCurator: true };

test("Lead 360 «Передача»: after a handoff one line with dates and no warning", () => {
  const view = handoffStripView(parse(HANDED_JSON), { now: NOW, links: ALL_LINKS });
  assert.equal(view.stageTitle, "Переданы");
  assert.equal(stripPlain(view.summary), "Передано 18.09 · Куратор Синтетический · принято 19.09");
  // Dates are their own parts: the card draws them in JetBrains Mono.
  assert.deepEqual(view.summary, ["Передано ", { date: "18.09" }, " · Куратор Синтетический", " · принято ", { date: "19.09" }]);
  assert.deepEqual(view.warnings, []);
  // Э8.4: одни слова «Договор» и «Оплата»; подтверждение вручную так и названо.
  assert.deepEqual(view.items.map((item) => [item.label, item.state, item.text, item.date]), [
    ["Договор", "done", "подтверждён вручную", "17.09"],
    ["Оплата", "done", "первый платёж", "17.09"],
    ["Запись в отчёте", "done", null, "17.09"],
    ["Куратор", "done", "Куратор Синтетический", "18.09"],
    ["Принято", "done", null, "19.09"],
  ]);
  // Сумма первого платежа из подтверждения вручную — в самой «Оплате», а не второй строкой.
  assert.deepEqual(handoffStripView(parse(HANDED_JSON), { now: NOW, firstPayment: { amount: 600, currency: "USD" } }).items[1],
    { key: "payment", label: "Оплата", state: "done", text: "первый платёж 600\u00a0USD", date: "17.09" });
});

test("Lead 360 «Передача» (Э8.4): the case's uploaded contract and recorded payments (188) come first", () => {
  const agreement = {
    contractCurrent: { id: "c", originalFilename: "dogovor.pdf", uploadedAt: "2026-09-18T06:10:00Z", uploadedByDisplayName: null },
    payments: [
      { eventType: "payment", occurredOn: "2026-09-20" }, { eventType: "payment", occurredOn: "2026-09-18" }, { eventType: "refund", occurredOn: "2026-09-10" },
    ],
    paidMinor: "60000", costMinor: "150000", costCurrency: "USD", currencyMismatch: false,
  };
  assert.deepEqual(stripCaseMoney(agreement), { contractUploadedAt: "2026-09-18T06:10:00Z", paidText: "оплачено 600 из 1\u00a0500\u00a0USD", firstPaymentOn: "2026-09-18" });
  // Разные валюты или нет стоимости — «N из M» не сказать: первый платёж с датой.
  assert.deepEqual(stripCaseMoney({ ...agreement, currencyMismatch: true }).paidText, null);
  assert.deepEqual(stripCaseMoney({ ...agreement, costMinor: null }).firstPaymentOn, "2026-09-18");
  // Всё возвращено или платежей нет — оплаты нет; договора в деле нет — null.
  assert.deepEqual(stripCaseMoney({ ...agreement, paidMinor: "0" }), { contractUploadedAt: "2026-09-18T06:10:00Z", paidText: null, firstPaymentOn: null });
  assert.deepEqual(stripCaseMoney({ ...agreement, contractCurrent: null, payments: [], paidMinor: "0" }),
    { contractUploadedAt: null, paidText: null, firstPaymentOn: null });

  const bare = parse({ ...HANDED_JSON, contract: { confirmed: false, confirmed_at: null }, first_payment: { received_date: null },
    report: { status: "available", record: null } });
  const withCase = handoffStripView(bare, { now: NOW, caseMoney: stripCaseMoney(agreement) });
  assert.deepEqual(withCase.items.slice(0, 2).map((item) => [item.label, item.state, item.text, item.date]), [
    ["Договор", "done", "загружен", "18.09"],
    ["Оплата", "done", "оплачено 600 из 1\u00a0500\u00a0USD", null],
  ]);
  // Дело важнее подтверждения вручную: договор в деле — «загружен», а не «подтверждён вручную».
  assert.equal(handoffStripView(parse(HANDED_JSON), { now: NOW, caseMoney: stripCaseMoney(agreement) }).items[0].text, "загружен");
  assert.deepEqual(handoffStripView(bare, { now: NOW, caseMoney: stripCaseMoney({ ...agreement, costMinor: null }) }).items[1],
    { key: "payment", label: "Оплата", state: "done", text: "первый платёж", date: "18.09" });
  // Процент из финансов дела, когда 188 не прочитано (Lead 360 передаёт `paidText` сам).
  assert.equal(handoffStripView(bare, { now: NOW, caseMoney: { contractUploadedAt: null, paidText: "оплачено 40%", firstPaymentOn: null } })
    .items[1].text, "оплачено 40%");
});

test("Lead 360 «Передача»: a sale saved through the report (208) takes contract and payment from its record", () => {
  // The gate row confirms nothing on this path; the record has the sale date and the paid amount.
  const sold = handoffStripView(parse({ ...HANDED_JSON,
    handoff: { completed_at: "2026-09-23T03:00:00+00:00", evidence: "sales_report", acceptance_recordable: false },
    contract: { confirmed: false, confirmed_at: null }, first_payment: { received_date: null },
    report: { status: "available", record: { ...HANDED_JSON.report.record, sale_date: "2026-09-22", has_contract_number: false } },
    acceptance: null }), { now: NOW, links: ALL_LINKS });
  assert.deepEqual(sold.items.map((item) => [item.key, item.state, item.text, item.date]), [
    ["contract", "done", "по отчёту", "22.09"],
    ["payment", "done", "по отчёту: оплачено 600\u00a0USD", null],
    ["report", "done", null, "22.09"],
    ["curator", "done", "Куратор Синтетический", "18.09"],
    // 182 needs a 088 row the 208 branch never writes: no «ждёт ответа» nobody can give.
    ["accepted", "missing", "не отмечается", null],
  ]);
  assert.equal(stripPlain(sold.summary), "Передано 23.09 · Куратор Синтетический");
  // Э8.4: сделать с этим нечего — предупреждения нет, «не отмечается» остаётся словом в «Принято».
  assert.deepEqual(sold.warnings, []);
  // Without a paid amount or a sale date the record proves nothing: «—», never a guessed tick.
  const bare = handoffStripView(parse({ ...HANDED_JSON, contract: { confirmed: false, confirmed_at: null }, first_payment: { received_date: null },
    report: { status: "available", record: { ...HANDED_JSON.report.record, sale_date: null, has_contract_number: false, paid: null } } }), { now: NOW });
  assert.deepEqual(bare.items.slice(0, 2).map((item) => [item.key, item.state]), [["contract", "missing"], ["payment", "missing"]]);
  // An archived record is not a sale, so it is not evidence either.
  const archived = handoffStripView(parse({ ...HANDED_JSON, contract: { confirmed: false, confirmed_at: null }, first_payment: { received_date: null },
    report: { status: "available", record: { ...HANDED_JSON.report.record, archived: true } } }), { now: NOW });
  assert.deepEqual(archived.items.slice(0, 2).map((item) => item.state), ["missing", "missing"]);
  // A role without the report: the evidence is in the report — no tick, no dash.
  const unread = handoffStripView(parse({ ...HANDED_JSON,
    handoff: { completed_at: "2026-09-23T03:00:00+00:00", evidence: "sales_report", acceptance_recordable: false },
    contract: { confirmed: false, confirmed_at: null }, first_payment: { received_date: null },
    report: { status: "denied", record: null }, acceptance: null }), { now: NOW });
  assert.deepEqual(unread.items.map((item) => [item.key, item.state, item.text]), [
    ["contract", "elsewhere", "в отчёте продаж"], ["payment", "elsewhere", "в отчёте продаж"],
    ["curator", "done", "Куратор Синтетический"], ["accepted", "missing", "не отмечается"],
  ]);
  // An 088 handoff not answered yet waits with one word, in the line and in the strip.
  const waiting = handoffStripView(parse({ ...HANDED_JSON, acceptance: null }), { now: NOW, links: ALL_LINKS });
  assert.equal(stripPlain(waiting.summary), "Передано 18.09 · Куратор Синтетический · ждёт ответа");
  assert.deepEqual(waiting.items.at(-1), { key: "accepted", label: "Принято", state: "missing", text: "ждёт ответа", date: null });
  assert.deepEqual(waiting.warnings, [], "contract and payment are evidence, not a ban");
});

test("Lead 360 «Передача» (Э8.7, 254): a merely linked record is never the recorded sale — it names itself next to «Оформить продажу» instead", () => {
  // Not handed off, no pipeline record — only a plain link (254): the strip stays
  // neutral («Запись в отчёте» missing, no warning), and `linkedRecord` names the day.
  const linked = handoffStripView(parse({ ...WORKING_JSON,
    report: { status: "available", record: { ...HANDED_JSON.report.record, archived: false, link: "linked", sale_date: "2026-09-18" } } }),
    { now: NOW, links: ALL_LINKS });
  assert.deepEqual(linked.items.slice(0, 3).map((item) => [item.key, item.state]), [
    ["contract", "missing"], ["payment", "missing"], ["report", "missing"],
  ]);
  assert.deepEqual(linked.warnings, [], "a linked record is not evidence a handoff is missing something");
  assert.deepEqual(linked.linkedRecord, {
    text: ["Запись в отчёте — связана: ", { date: "18.09" }], href: `/v3/main?view=sales&year=2026&month=9&record=${RECORD}`, action: "Открыть запись",
  });
  // No sale date on the linked record: the line still names itself, without a date.
  assert.deepEqual(handoffStripView(parse({ ...WORKING_JSON,
    report: { status: "available", record: { ...HANDED_JSON.report.record, link: "linked", sale_date: null, has_contract_number: false } } }),
    { now: NOW }).linkedRecord, { text: ["Запись в отчёте — связана"], href: `/v3/main?view=sales&year=2026&month=9&record=${RECORD}`, action: "Открыть запись" });
  // A real pipeline sale: no linkedRecord line, the strip's own report item takes it as before.
  assert.equal(handoffStripView(parse(HANDED_JSON), { now: NOW }).linkedRecord, null);
  assert.equal(handoffStripView(parse(WORKING_JSON), { now: NOW }).linkedRecord, null, "no record at all");
});

test("Lead 360 «Передача» (Э8.4): each warning names its action and link; a warning nobody can act on is gone", () => {
  // Производственный лид: передан 18.09, запись о продаже в архиве.
  const archivedJson = { ...HANDED_JSON, report: { status: "available", record: { ...HANDED_JSON.report.record, archived: true } } };
  const archived = handoffStripView(parse(archivedJson), { now: NOW });
  assert.equal(archived.stageTitle, "Переданы", "an archived sale does not return the lead to the working board");
  const recordHref = `/v3/main?view=sales&year=2026&month=9&record=${RECORD}`;
  assert.deepEqual(archived.warnings, [{ text: ["Продажа в отчёте в архиве — в план месяца не считается"], href: recordHref, action: "Открыть запись" }]);
  assert.equal(salesRecordHref({ id: RECORD, reportMonth: "2026-09-01" }), recordHref);
  assert.equal(archived.items.find((item) => item.key === "report").state, "attention");
  assert.deepEqual(handoffStripView(parse({ ...HANDED_JSON, report: { status: "available", record: { ...HANDED_JSON.report.record, sale_date: null } } }),
    { now: NOW }).warnings, [{ text: ["В записи отчёта нет даты продажи — в план месяца не считается"], href: recordHref, action: "Открыть запись" }]);

  // Нет записи о продаже: «Оформить продажу» — у того, кто записывает продажи; у остальных предупреждения нет.
  const noRecord = parse({ ...HANDED_JSON, report: { status: "available", record: null } });
  assert.deepEqual(handoffStripView(noRecord, { now: NOW, links: ALL_LINKS }).warnings,
    [{ text: ["Продажа не записана в отчёт — в план месяца не считается"], href: SALE_HREF, action: "Оформить продажу" }]);
  assert.deepEqual(handoffStripView(noRecord, { now: NOW, links: { ...ALL_LINKS, saleHref: null } }).warnings, []);
  assert.equal(handoffStripView(noRecord, { now: NOW }).items.find((item) => item.key === "report").state, "missing");

  // Куратора нет: «Назначить куратора» — в деле и только с `case.curator.assign`.
  const noCurator = parse({ ...HANDED_JSON, curator: null, acceptance: null });
  assert.deepEqual(handoffStripView(noCurator, { now: NOW, links: ALL_LINKS }).warnings,
    [{ text: ["Куратор не назначен — дело ждёт назначения"], href: CASE_HREF, action: "Назначить куратора" }]);
  assert.deepEqual(handoffStripView(noCurator, { now: NOW, links: { ...ALL_LINKS, assignCurator: false } }).warnings, []);
  assert.deepEqual(handoffStripView(noCurator, { now: NOW, links: { ...ALL_LINKS, caseHref: null } }).warnings, [], "no case to open");

  // Куратор просит уточнить: ответ — в деле; дела не открыть — предупреждения нет, слово остаётся в «Принято».
  const clarifyJson = { ...HANDED_JSON, acceptance: { decision: "clarification_requested", at: "2026-09-19T03:30:00+00:00" } };
  const clarify = handoffStripView(parse(clarifyJson), { now: NOW, links: ALL_LINKS });
  assert.deepEqual(clarify.warnings, [{ text: ["Куратор просит уточнить передачу"], href: CASE_HREF, action: "Открыть дело" }]);
  assert.equal(stripPlain(clarify.summary), "Передано 18.09 · Куратор Синтетический · нужно уточнить 19.09");
  assert.deepEqual(handoffStripView(parse(clarifyJson), { now: NOW }).warnings, []);
  assert.equal(handoffStripView(parse(clarifyJson), { now: NOW }).items.at(-1).text, "нужно уточнить");
});

test("Lead 360 «Передача»: a declined handoff is a warning with its date and «Назначить куратора», and the summary says «отклонено»", () => {
  // 182: a decline returns the case to «ждёт куратора» and clears the curator; the handoff stays a fact.
  const json = { ...HANDED_JSON, curator: null, acceptance: { decision: "declined", at: "2026-09-20T04:00:00+00:00" } };
  const declined = handoffStripView(parse(json), { now: NOW, links: ALL_LINKS });
  assert.equal(declined.stageTitle, "Переданы");
  assert.equal(stripPlain(declined.summary), "Передано 18.09 · отклонено 20.09");
  assert.deepEqual(declined.warnings, [{ text: ["Куратор отклонил передачу ", { date: "20.09" }, " — дело ждёт нового куратора"],
    href: CASE_HREF, action: "Назначить куратора" }]);
  assert.deepEqual(declined.items.slice(-2).map((item) => [item.key, item.state, item.text, item.date]), [
    ["curator", "missing", null, null], ["accepted", "attention", "отклонено", "20.09"],
  ]);
  assert.deepEqual(handoffStripView(parse(json), { now: NOW, links: { ...ALL_LINKS, assignCurator: false } }).warnings, []);
});

test("Lead 360 «Передача»: before a handoff it is neutral; a role without the report has no report item", () => {
  const working = handoffStripView(parse(WORKING_JSON), { now: NOW, links: ALL_LINKS });
  assert.equal(working.stageTitle, "Квалифицирован");
  assert.equal(working.summary, null);
  assert.deepEqual(working.warnings, []);
  assert.ok(working.items.every((item) => item.state === "missing"));
  const denied = handoffStripView(parse({ ...HANDED_JSON, report: { status: "denied", record: null } }), { now: NOW, links: ALL_LINKS });
  assert.deepEqual(denied.items.map((item) => item.key), ["contract", "payment", "curator", "accepted"]);
  assert.deepEqual(denied.warnings, []);
  assert.equal(handoffStripView(parse({ ...HANDED_JSON, stage: "closed" }), { now: NOW }).stageTitle, "Лид закрыт");
  // One date format (DESIGN.md): ДД.ММ, another year with two digits — «03.01.27».
  assert.equal(stripDay("2025-12-30", "2026-09-26"), "30.12.25");
  assert.equal(stripDay("2027-01-03", "2026-09-26"), "03.01.27");
  assert.equal(stripDay("2026-09-17", "2026-09-26"), "17.09");
});

test("Lead 360 «Передача»: the footnote names only what the items do not — the expected payment and the evidence references", () => {
  const gate = { contractConfirmed: true, firstPaymentAmount: 600, firstPaymentCurrency: "USD", firstPaymentDueDate: "2026-09-20",
    firstPaymentReceivedDate: "2026-09-17", contractEvidenceReference: "Договор синтетический", firstPaymentEvidenceReference: "Платёж синтетический" };
  // Полученный платёж — в «Оплате» с суммой и датой; в сноске — только ссылки-доказательства, одними словами полосы.
  assert.deepEqual(handoffFootnote(gate, { now: NOW }), ["Договор: Договор синтетический", " · ", "Оплата: Платёж синтетический"]);
  assert.equal(stripPlain(handoffFootnote({ ...gate, firstPaymentReceivedDate: null, contractEvidenceReference: null, firstPaymentEvidenceReference: null },
    { now: NOW })), "Первый платёж 600\u00a0USD, ожидается 20.09");
  assert.equal(stripPlain(handoffFootnote({ ...gate, firstPaymentReceivedDate: null, firstPaymentDueDate: "2027-01-03", contractEvidenceReference: null,
    firstPaymentEvidenceReference: null }, { now: NOW })), "Первый платёж 600\u00a0USD, ожидается 03.01.27");
  assert.equal(handoffFootnote({ ...gate, contractConfirmed: false, contractEvidenceReference: null, firstPaymentEvidenceReference: null }, { now: NOW }), null);
});

const pill = compile("src/components/v3/Pill.tsx");
const ui = compile("src/components/ui.tsx");
const icons = compile("src/components/icons.tsx");
const inert = () => { throw new Error("SSR check never executes a server mutation"); };
const transition = compile("src/components/v3/profile/ProfileSalesTransition.tsx", (id) => {
  if (id === "@/lib/platform-access") return access;
  if (id === "@/lib/v3/wording") return wording;
  if (id === "@/components/ui") return ui;
  if (id === "@/components/icons") return icons;
  if (id === "@/components/v3/Pill") return pill;
  if (id === "@/lib/platform-student-handoff-actions") return { mutatePlatformLeadAdmissionsGateAction: inert };
  if (id === "@/lib/platform-handoff-acknowledgement-actions") return { respondToHandoffAction: inert };
  if (id === "./handoff-strip-view") return stripView;
  return require(id);
});
const GATE = {
  organizationId: ORG, leadId: LEAD, gateVersion: "4", gateState: "blocked", contractConfirmed: false,
  contractConfirmedByMembershipId: null, contractConfirmedAt: null, contractEvidenceReference: null,
  firstPaymentAmount: null, firstPaymentCurrency: null, firstPaymentDueDate: null, firstPaymentReceivedDate: null,
  firstPaymentConfirmedByMembershipId: null, firstPaymentConfirmedAt: null, firstPaymentEvidenceReference: null,
  overrideReason: null, overriddenByMembershipId: null, overriddenAt: null, normalHandoffAllowed: false,
  exceptionalHandoffAllowed: false, canConfirmContract: true, canConfirmFirstPayment: true, canOverrideGate: true, updatedAt: "2026-09-20T05:00:00Z",
};
const REQUESTS = { contract: LEAD, firstPayment: LEAD, override: LEAD, handoff: LEAD, platformAccess: LEAD, saleConditions: LEAD,
  prepareLeadCabinet: LEAD, wishesCard: LEAD, educationCard: LEAD, conditionsCard: LEAD };
function renderCard(view, gate = GATE, actor = { systemRole: "admin", presentationRole: null }) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh: inert } },
    createElement(transition.ProfileSalesTransition, { actor, gate, view, requestIds: REQUESTS })));
}

test("the false red «ожидает условий» is gone: a neutral «Передача» strip, quiet confirmation forms", () => {
  const before = renderCard(handoffStripView(parse(WORKING_JSON), { now: NOW }));
  assert.match(before, /<h3 class="t-section[^"]*">Передача/u);
  assert.doesNotMatch(before, /ожидает условий|Договор и оплата|bg-danger-weak/u);
  assert.equal((before.match(/data-handoff-item="/gu) ?? []).length, 5);
  assert.doesNotMatch(before, /data-testid="v3-handoff-summary"|data-testid="v3-handoff-warnings"/u, "nothing to warn about before a handoff");
  // The confirmations stay, as quiet buttons: the page's one red belongs to its main action.
  assert.match(before, /data-testid="v3-gate-contract-form"/u);
  assert.doesNotMatch(before, /bg-accent/u);
  assert.doesNotMatch(before, /Версия проверки/u);

  // No summary, no warning: no rule above the strip to double the card header's line.
  assert.match(before, /<dl class="grid divide-y divide-border @2xl:grid-cols-5 @2xl:divide-x @2xl:divide-y-0" data-testid="v3-handoff-strip">/u);

  const after = renderCard(handoffStripView(parse(HANDED_JSON), { now: NOW }),
    { ...GATE, contractConfirmed: true, firstPaymentAmount: 600, firstPaymentCurrency: "USD", firstPaymentDueDate: "2026-09-20",
      firstPaymentReceivedDate: "2026-09-17", normalHandoffAllowed: true, gateState: "satisfied" });
  const mono = (date) => `<span class="whitespace-nowrap font-mono tabular-nums">${date.replace(".", "\\.")}</span>`;
  // The word before a date keeps it on its line (a no-break space).
  assert.match(after, new RegExp(`data-testid="v3-handoff-summary">Передано\u00a0${mono("18.09")} · Куратор Синтетический · принято\u00a0${mono("19.09")}</p>`, "u"));
  assert.match(after, /data-testid="v3-handoff-strip"[^>]*>/u);
  // Э8.4: полученный платёж — в самой «Оплате»; без ссылок-доказательств сноски нет, и линии под полосой тоже.
  assert.match(after, /class="grid [^"]*border-t border-border" data-testid="v3-handoff-strip"/u);
  assert.doesNotMatch(after, /v3-handoff-footnote|ожидается|получен|20\.09\.2026/u);
  const referenced = renderCard(handoffStripView(parse(HANDED_JSON), { now: NOW }),
    { ...GATE, contractConfirmed: true, firstPaymentReceivedDate: "2026-09-17", normalHandoffAllowed: true, gateState: "satisfied",
      contractEvidenceReference: "Договор синтетический", firstPaymentEvidenceReference: "Платёж синтетический" });
  assert.match(referenced, /class="grid [^"]*border-t border-border border-b border-border" data-testid="v3-handoff-strip"/u);
  assert.match(referenced, /data-testid="v3-handoff-footnote">Договор: Договор синтетический · Оплата: Платёж синтетический<\/p>/u);
  assert.doesNotMatch(after, /v3-handoff-warnings|text-warn/u);
  assert.equal((after.match(/data-state="done"/gu) ?? []).length, 5);
  assert.doesNotMatch(after, /<form\b/u, "nothing left to confirm");

  const unread = renderCard(null);
  assert.match(unread, /role="alert"[^>]*>.*Не удалось загрузить передачу\./u);
  assert.doesNotMatch(unread, /data-handoff-item/u, "no guessed ticks without a read");
});

test("«Продажи» headline: one number by sale date, discrepancies named, no number without a read", () => {
  const headline = compile("src/components/v3/SalesPeriodHeadline.tsx", (id) => {
    if (id === "@/lib/sales-register-view") return salesView;
    if (id === "./blocks/progress") return compile("src/components/v3/blocks/progress.ts");
    return require(id);
  });
  assert.deepEqual(headline.salesHeadlinePeriod(2026, 9), { from: "2026-09-01", to: "2026-09-30", label: "сентябрь 2026" });
  assert.deepEqual(headline.salesHeadlinePeriod(2028, 2), { from: "2028-02-01", to: "2028-02-29", label: "февраль 2028" });
  assert.deepEqual(headline.salesHeadlinePeriod(2026, undefined), { from: "2026-01-01", to: "2026-12-31", label: "2026 год" });
  const { saleSliceHref } = salesReportContext({ year: "2026", month: "9" }, { year: 2026, month: 9 });
  const render = (read, extra = {}) => renderToStaticMarkup(createElement(headline.SalesPeriodHeadline,
    { read, label: "сентябрь 2026", retryHref: "/v3/main?view=sales", sliceHref: saleSliceHref, ...extra }));
  const september = { status: "available", count: { from: "2026-09-01", to: "2026-09-30", sales: 5, undated: 1, otherSaleDate: 1, filedElsewhere: 1 } };
  const full = render(september);
  const plain = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
  assert.match(full, /<p class="t-section text-fg"><span class="tabular-nums">5<\/span> продаж<\/p>/u);
  assert.match(plain(full), /^5 продаж по дате продажи за сентябрь 2026, без архива Не входят: без даты продажи — 1 запись дата продажи в другом месяце — 1 запись Входят из другого месяца отчёта: 1 запись$/u);
  // Each named discrepancy opens exactly those records (same period, no other filter), with a 44 px target.
  for (const [slice, words] of [["undated", "без даты продажи — 1 запись"], ["other_sale_date", "дата продажи в другом месяце — 1 запись"], ["filed_elsewhere", "1 запись"]]) {
    assert.match(full, new RegExp(`<a href="/v3/main\\?view=sales&amp;year=2026&amp;month=9&amp;sale=${slice}" class="inline-flex min-h-11 [^"]*" data-sale-slice="${slice}">${words}</a>`, "u"), slice);
  }
  assert.doesNotMatch(full, /без фильтров/u);
  assert.match(plain(render(september, { filtered: true })), /по дате продажи за сентябрь 2026, без архива и без фильтров/u, "not to be read against the filtered rows");
  // Э4: план месяца из чтения — «N продаж из плана M», «осталось» и тонкая полоса «продажи из плана» (Э1.3).
  const planned = render(september, { target: 35 });
  assert.match(plain(planned), /^5 продаж из плана 35 по дате продажи за сентябрь 2026, без архива · осталось 30 /u);
  assert.match(planned, /<span class="v3-progress-track mt-1\.5" aria-hidden="true"><span class="v3-progress-fill" style="width:14\.3%"><\/span><\/span>/u);
  assert.doesNotMatch(full, /v3-progress-track/u, "no plan read — no bar");
  assert.match(plain(render(september, { target: 5 })), /^5 продаж из плана 5 по дате продажи за сентябрь 2026, без архива · план выполнен/u);
  assert.doesNotMatch(render(september, { target: 4 }), /v3-progress-track/u, "no bar past the plan: 5 of 4 is not a share");
  assert.match(plain(render({ status: "available", count: { ...september.count, sales: 1 } })), /^1 продажа /u);
  assert.match(plain(render({ status: "available", count: { ...september.count, sales: 3 } })), /^3 продажи /u);
  assert.doesNotMatch(render(september, { sliceHref: undefined }), /<a /u, "without a target the words stay words");
  assert.doesNotMatch(full, /font-mono/u, "counts are Golos tabular digits");
  const clean = render({ status: "available", count: { from: "2026-09-01", to: "2026-09-30", sales: 6, undated: 0, otherSaleDate: 0, filedElsewhere: 0 } });
  assert.doesNotMatch(clean, /v3-sales-headline-notes/u);
  assert.equal(render({ status: "denied" }), "");
  assert.match(render({ status: "unavailable" }), /role="alert"[^>]*>Не удалось посчитать продажи за сентябрь 2026\./u);
  assert.doesNotMatch(render({ status: "unavailable" }), /Продажи за/u);
  const view = read("src/components/v3/SalesRegisterView.tsx");
  assert.match(view, /readSalesCount\(actor, headlinePeriod\)/u);
  assert.match(view, /filtered=\{hasFilters\} sliceHref=\{saleSliceHref\}/u);
  assert.match(read("src/lib/v3/sales-numbers-source.ts"), /rpc\("staff_sales_count_v1"/u);
  // Э8.6 (253): one read, v4, carries the slice as v3 did; v2/v3 stay on the server for rollback.
  const source = read("src/lib/v3/sales-register-source.ts");
  assert.match(source, /rpc\("read_sales_register_v4", \{[^}]*p_query: query \|\| null, p_sale_slice: slice,\s*\}\)/u);
  assert.doesNotMatch(source, /read_sales_register_v[23]"/u);
});

test("report navigation: «sale=<slice>» is one of the three sets, never over the archive, and survives paging", () => {
  const current = { year: 2026, month: 9 };
  assert.deepEqual(["undated", "other_sale_date", "filed_elsewhere", "archived", "", undefined].map(parseSalesSaleSlice),
    ["undated", "other_sale_date", "filed_elsewhere", null, null, null]);
  const slice = salesReportContext({ year: "2026", month: "9", sale: "undated" }, current);
  assert.equal(slice.valid, true);
  assert.equal(slice.saleSlice, "undated");
  assert.equal(slice.href({ offset: "50" }), "/v3/main?view=sales&year=2026&month=9&sale=undated&offset=50");
  assert.equal(slice.clearFiltersHref, "/v3/main?view=sales&year=2026&month=9");
  assert.equal(slice.saleSliceHref("filed_elsewhere"), "/v3/main?view=sales&year=2026&month=9&sale=filed_elsewhere");
  // The link from the headline drops other row filters: exactly the records it names.
  assert.equal(salesReportContext({ year: "2026", month: "all", manager: "M", q: "x" }, current).saleSliceHref("undated"),
    "/v3/main?view=sales&year=2026&month=all&sale=undated");
  assert.equal(salesReportContext({ year: "2026", month: "9", sale: "undated", archived: "true" }, current).valid, false);
  assert.equal(salesReportContext({ year: "2026", month: "9", sale: "everything" }, current).valid, false);
  assert.equal(salesReportContext({ year: "2026", month: "9", sale: "everything" }, current).saleSlice, null);
});

// Настоящие компоненты страницы с синтетическими данными (tests/e2e/numbers-static-render.cjs --json):
// Lead 360, «Отчёт продаж» с подменёнными чтениями и воронка по настоящему чтению доски.
test("rendered pages: Lead 360 strip, the report headline and the board funnel tell one truth", async () => {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const pages = new Map(JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(new URL("./e2e/numbers-static-render.cjs", import.meta.url)), "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).map((page) => [page.name, page.html]));
  const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();

  // Переданный лид как в production: этап доски, передача с датами, архивная запись названа словами.
  // Lead 360 (Э4): строка передачи — в шапке («Что дальше»), в «Сведениях» она не повторяется.
  const handed = pages.get("lead-handed");
  // Этап — дорожка из 7 этапов продаж (Э1.4), текущий — «Переданы».
  assert.match(handed, /<div class="v3-track" data-track="sales">[\s\S]*?<span class="sr-only">Переданы, текущий этап, Продажи<\/span>/u);
  assert.match(text(handed), /Что дальше Передано 18\.09 · Айгерим Условная · принято 19\.09/u);
  // Э8.4: предупреждение называет действие и ведёт к нему; слова «Договор» и «Оплата» — одни на полосе и в ленте.
  assert.match(text(handed), /Передача Продажа в отчёте в архиве — в план месяца не считается Открыть запись/u);
  assert.doesNotMatch(handed, /data-testid="v3-handoff-summary"/u);
  assert.match(handed, /<a href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9&amp;record=12341234-5555-4555-8555-000000000001" class="-my-3 inline-flex min-h-11[^"]*">Открыть запись<\/a>/u);
  assert.match(text(handed), /Договор есть подтверждён вручную 17\.09 Оплата есть первый платёж 600 USD 17\.09 Запись в отчёте в архиве/u);
  assert.match(text(handed), /Договор: Договор № 0000 \(синтетический\) · Оплата: Платёж 0000 \(синтетический\)/u);
  assert.match(text(handed), /Первый платёж подтверждён вручную 17\.09 12:00 Договор подтверждён вручную 17\.09 11:00/u);
  assert.doesNotMatch(handed, /ожидает условий|ожидается|получен 17|Новый</u);
  // Продажа в уже открытое дело (208): дата по квитанции; договор и оплата — по той
  // же записи «Отчёта продаж» (22.09, 600 USD); ответа куратора не бывает — сказано словами.
  const sold = pages.get("lead-sold");
  assert.match(text(sold), /Что дальше Передано 23\.09 · Айгерим Условная Обзор/u);
  // Э8.4: приём в CRM не отмечается — это слово в «Принято»; предупреждения без действия нет.
  assert.doesNotMatch(sold, /data-testid="v3-handoff-warnings"|не отмечается:/u);
  assert.match(text(sold), /Договор есть по отчёту 22\.09 Оплата есть по отчёту: оплачено 600 USD Запись в отчёте есть 22\.09 .*? Принято — нет не отмечается/u);
  assert.doesNotMatch(text(sold), /ждёт принятия|ждёт ответа/u, "no pending step nobody can take");
  const report = pages.get("report");
  assert.match(text(report), /Алина Переданная Малайзия · Бакалавриат Санжар Эскизов 22\.09 1 500 USD 600 USD/u, "the same record says the same numbers");
  // До передачи: нейтрально. Э8.4: формы подтверждения — не в «Данных лида», а наверху вкладки
  // «Договор и оплата»; полоса ведёт туда «Изменить» (якорь форм). Исключение Admin там свёрнуто.
  const working = pages.get("lead-working");
  assert.match(working, /<span class="sr-only">Квалифицирован, текущий этап, Продажи<\/span>/u);
  assert.doesNotMatch(working, /v3-handoff-summary|v3-handoff-warnings/u);
  assert.doesNotMatch(working, /v3-lead-group-contract|v3-gate-contract-form|Подтверждение договора и платежа/u);
  assert.match(working, /<a class="inline-flex min-h-11 [^"]*ms-auto" data-testid="v3-handoff-edit" aria-label="Изменить договор и оплату" href="\/v3\/profile\?id=[^"]+&amp;tab=money#handoff-confirm">Изменить<\/a>/u);
  const money = pages.get("lead-working-money");
  const gateSection = money.slice(money.indexOf('<section id="handoff-confirm"'));
  assert.match(gateSection, /^<section id="handoff-confirm" aria-labelledby="handoff-confirm-title" class="max-w-3xl scroll-mt-4" data-testid="v3-lead-gate"><h2 id="handoff-confirm-title" class="t-section text-fg">Подтверждение вручную<\/h2>/u);
  assert.match(gateSection, /<h3 class="t-item text-fg">Подтвердить договор<\/h3>.*?data-testid="v3-gate-contract-form"/u);
  assert.match(gateSection, /<details class="group py-1"><summary[^>]*>.*?Исключение Admin<\/summary>/u);
  // У лида без дела пустого «Все обязательства по делу» нет; сплошной красный — только главное действие.
  assert.doesNotMatch(money, /Все обязательства по делу|Обязательств пока нет/u);
  assert.match(money, /aria-current="page" class="v3-choice inline-flex min-h-11 [^"]*" href="[^"]*tab=money">Договор и оплата<\/a>/u);
  // Сплошной красный на странице один — главное действие; в «Передаче» и группах правки его нет.
  const solidRed = (html) => html.match(/(?<![\w:-])bg-accent(?![\w-])/gu)?.length ?? 0;
  assert.equal(solidRed(working), 1);
  assert.equal(solidRed(money), 1);
  assert.match(working, /class="v3-raised [^"]*bg-accent [^"]*" data-testid="v3-lead-primary">Записать следующий шаг<\/button>/u);
  for (const part of ["v3-lead-facts", "v3-lead-edit"]) {
    const from = working.indexOf(`data-testid="${part}"`);
    assert.ok(from > 0, part);
    assert.equal(solidRed(working.slice(from, working.indexOf("</section>", from + 1) + 1 || undefined)), 0, part);
  }
  assert.equal(solidRed(handed), 0, "after a handoff «Открыть дело» is neutral");

  // Lead 360: «Добавить заметку» — спокойная кнопка 44 px; сплошной красный — одно главное действие.
  for (const page of [handed, sold, working]) {
    assert.match(page, /<button type="submit" class="v3-raised inline-flex min-h-11 [^"]*t-label[^"]*">Добавить заметку<\/button>/u);
    assert.doesNotMatch(page, /text-xs font-semibold text-white[^>]*>Добавить заметку/u);
  }

  // «Отчёт продаж»: «Продажи» по дате продажи; таблица месяца (6 записей) сходится со словами,
  // а каждое расхождение ведёт к своим записям.
  assert.match(report, /data-testid="v3-sales-headline" data-sales="5"/u);
  assert.match(text(report), /5 продаж по дате продажи за сентябрь 2026, без архива Не входят: без даты продажи — 1 запись дата продажи в другом месяце — 1 запись Входят из другого месяца отчёта: 1 запись/u);
  assert.match(report, /href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9&amp;sale=undated"/u);
  assert.match(text(report), /Продажи: 6 записей/u);
  // По ссылке «без даты продажи»: ровно эта запись, слова среза и «без фильтров» у числа.
  const undated = pages.get("report-undated");
  assert.match(text(undated), /5 продаж по дате продажи за сентябрь 2026, без архива и без фильтров/u);
  assert.match(text(undated), /Записи без даты продажи: в продажи не входят — сентябрь 2026\. Все записи периода/u);
  assert.match(text(undated), /Продажи: 1 запись/u);
  assert.match(text(undated), /Данияр Макетов/u);
  assert.doesNotMatch(text(undated), /Алина Переданная|Тимур Образцов/u);

  // «Динамика по дням»: настоящие чтения периода и доски. Переданный лид (его stage_key — 'new')
  // — «Переданы» и в когорте, и на доске; кабинет без продажи (лид 2) — не передача.
  const dynamics = pages.get("funnel");
  const board = dynamics.indexOf('aria-labelledby="sales-dynamics-board"');
  const cohort = text(dynamics.slice(dynamics.indexOf('aria-labelledby="sales-dynamics-period"'), board));
  // Воронка периода не сужается не туда: переданный лид квалифицирован передачей,
  // лид 2 — доказанным входом; квалифицированы (2) ≥ переданы (1).
  assert.match(cohort, /Пришло лидов 4 Из них квалифицированы 2 Из них переданы 1/u);
  assert.match(cohort, /Продажи за период: 5 · по дате продажи, без архива; без даты продажи не посчитаны: 1 запись/u);
  const current = text(dynamics.slice(board));
  assert.match(current, /Новый 1 .*Связались 1 .*Квалифицирован 1 .*Переданы 1/u);
});
