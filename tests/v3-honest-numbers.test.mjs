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
const { handoffFootnote, handoffStripView, salesRecordHref, stripDay, stripPlain } = stripView;
import { parseSalesSaleSlice, salesReportContext } from "../src/lib/sales-register-navigation.ts";

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
    has_contract_number: true, paid: { minor: "60000", currency: "USD" } } },
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
    hasContractNumber: true, paid: { minor: 60000, currency: "USD" } } });
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

const warningTexts = (view) => view.warnings.map((warning) => stripPlain(warning.text));

test("Lead 360 «Передача»: after a handoff one line with dates and no warning", () => {
  const view = handoffStripView(parse(HANDED_JSON), { now: NOW });
  assert.equal(view.stageTitle, "Переданы");
  assert.equal(stripPlain(view.summary), "Передано 18.09 · Куратор Синтетический · принято 19.09");
  // Dates are their own parts: the card draws them in JetBrains Mono.
  assert.deepEqual(view.summary, ["Передано ", { date: "18.09" }, " · Куратор Синтетический", " · принято ", { date: "19.09" }]);
  assert.deepEqual(view.warnings, []);
  assert.deepEqual(view.items.map((item) => [item.label, item.state, item.text, item.date]), [
    ["Договор", "done", null, "17.09"],
    ["Первый платёж", "done", null, "17.09"],
    ["Запись в отчёте", "done", null, "17.09"],
    ["Куратор", "done", "Куратор Синтетический", "18.09"],
    ["Принято", "done", null, "19.09"],
  ]);
});

test("Lead 360 «Передача»: a sale saved through the report (208) takes contract and payment from its record", () => {
  // The gate row confirms nothing on this path; the record has the sale date and the paid amount.
  const sold = handoffStripView(parse({ ...HANDED_JSON,
    handoff: { completed_at: "2026-09-23T03:00:00+00:00", evidence: "sales_report", acceptance_recordable: false },
    contract: { confirmed: false, confirmed_at: null }, first_payment: { received_date: null },
    report: { status: "available", record: { ...HANDED_JSON.report.record, sale_date: "2026-09-22", has_contract_number: false } },
    acceptance: null }), { now: NOW });
  assert.deepEqual(sold.items.map((item) => [item.key, item.state, item.text, item.date]), [
    ["contract", "done", "по отчёту", "22.09"],
    ["payment", "done", "по отчёту: оплачено 600\u00a0USD", null],
    ["report", "done", null, "22.09"],
    ["curator", "done", "Куратор Синтетический", "18.09"],
    // 182 needs a 088 row the 208 branch never writes: no «ждёт ответа» nobody can give.
    ["accepted", "missing", "не отмечается", null],
  ]);
  assert.equal(stripPlain(sold.summary), "Передано 23.09 · Куратор Синтетический");
  assert.deepEqual(warningTexts(sold), ["Приём этой передачи в CRM не отмечается: продажа записана в уже открытый кабинет."]);
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
  const waiting = handoffStripView(parse({ ...HANDED_JSON, acceptance: null }), { now: NOW });
  assert.equal(stripPlain(waiting.summary), "Передано 18.09 · Куратор Синтетический · ждёт ответа");
  assert.deepEqual(waiting.items.at(-1), { key: "accepted", label: "Принято", state: "missing", text: "ждёт ответа", date: null });
  assert.deepEqual(waiting.warnings, [], "contract and payment are evidence, not a ban");
});

test("Lead 360 «Передача»: a handoff lacking evidence says so in words, with the record to open", () => {
  // Производственный лид: передан 18.09, запись о продаже в архиве.
  const archived = handoffStripView(parse({ ...HANDED_JSON,
    report: { status: "available", record: { ...HANDED_JSON.report.record, archived: true } } }), { now: NOW });
  assert.equal(archived.stageTitle, "Переданы", "an archived sale does not return the lead to the working board");
  assert.deepEqual(archived.warnings, [{ text: ["Запись о продаже в архиве и в продажи не входит."],
    href: `/v3/main?view=sales&year=2026&month=9&record=${RECORD}` }]);
  assert.equal(salesRecordHref({ id: RECORD, reportMonth: "2026-09-01" }), `/v3/main?view=sales&year=2026&month=9&record=${RECORD}`);
  assert.equal(archived.items.find((item) => item.key === "report").state, "attention");
  assert.deepEqual(warningTexts(handoffStripView(parse({ ...HANDED_JSON, curator: null, acceptance: null }), { now: NOW })),
    ["Куратор не назначен: дело ждёт назначения."]);
  assert.deepEqual(handoffStripView(parse({ ...HANDED_JSON, report: { status: "available", record: null } }), { now: NOW }).warnings,
    [{ text: ["Записи о продаже в отчёте нет."], href: null }]);
  assert.deepEqual(warningTexts(handoffStripView(parse({ ...HANDED_JSON, report: { status: "available", record: { ...HANDED_JSON.report.record, sale_date: null } } }), { now: NOW })),
    ["В записи отчёта нет даты продажи, поэтому в продажи она не входит."]);
  const clarify = handoffStripView(parse({ ...HANDED_JSON, acceptance: { decision: "clarification_requested", at: "2026-09-19T03:30:00+00:00" } }), { now: NOW });
  assert.deepEqual(warningTexts(clarify), ["Куратор просит уточнить передачу."]);
  assert.equal(stripPlain(clarify.summary), "Передано 18.09 · Куратор Синтетический · нужно уточнить 19.09");
});

test("Lead 360 «Передача»: a declined handoff is a warning with its date, and the summary says «отклонено»", () => {
  // 182: a decline returns the case to «ждёт куратора» and clears the curator; the handoff stays a fact.
  const declined = handoffStripView(parse({ ...HANDED_JSON, curator: null,
    acceptance: { decision: "declined", at: "2026-09-20T04:00:00+00:00" } }), { now: NOW });
  assert.equal(declined.stageTitle, "Переданы");
  assert.equal(stripPlain(declined.summary), "Передано 18.09 · отклонено 20.09");
  assert.deepEqual(declined.warnings, [{ text: ["Куратор отклонил передачу ", { date: "20.09" }, ": дело ждёт нового куратора."], href: null }]);
  assert.deepEqual(declined.items.slice(-2).map((item) => [item.key, item.state, item.text, item.date]), [
    ["curator", "missing", null, null], ["accepted", "attention", "отклонено", "20.09"],
  ]);
});

test("Lead 360 «Передача»: before a handoff it is neutral; a role without the report has no report item", () => {
  const working = handoffStripView(parse(WORKING_JSON), { now: NOW });
  assert.equal(working.stageTitle, "Квалифицирован");
  assert.equal(working.summary, null);
  assert.deepEqual(working.warnings, []);
  assert.ok(working.items.every((item) => item.state === "missing"));
  const denied = handoffStripView(parse({ ...HANDED_JSON, report: { status: "denied", record: null } }), { now: NOW });
  assert.deepEqual(denied.items.map((item) => item.key), ["contract", "payment", "curator", "accepted"]);
  assert.deepEqual(denied.warnings, []);
  assert.equal(handoffStripView(parse({ ...HANDED_JSON, stage: "closed" }), { now: NOW }).stageTitle, "Лид закрыт");
  // One date format (DESIGN.md): ДД.ММ, another year with two digits — «03.01.27».
  assert.equal(stripDay("2025-12-30", "2026-09-26"), "30.12.25");
  assert.equal(stripDay("2027-01-03", "2026-09-26"), "03.01.27");
  assert.equal(stripDay("2026-09-17", "2026-09-26"), "17.09");
});

test("Lead 360 «Передача»: the footnote says «получен ДД.ММ» once the payment is in, «ожидается ДД.ММ» before", () => {
  const gate = { contractConfirmed: true, firstPaymentAmount: 600, firstPaymentCurrency: "USD", firstPaymentDueDate: "2026-09-20",
    firstPaymentReceivedDate: "2026-09-17", contractEvidenceReference: "Договор синтетический", firstPaymentEvidenceReference: null };
  assert.deepEqual(handoffFootnote(gate, { now: NOW }), ["Первый платёж 600 USD, получен ", { date: "17.09" }, " · ", "Договор: Договор синтетический"]);
  assert.equal(stripPlain(handoffFootnote({ ...gate, firstPaymentReceivedDate: null, contractEvidenceReference: null }, { now: NOW })),
    "Первый платёж 600 USD, ожидается 20.09");
  assert.equal(stripPlain(handoffFootnote({ ...gate, firstPaymentReceivedDate: null, firstPaymentDueDate: "2027-01-03", contractEvidenceReference: null }, { now: NOW })),
    "Первый платёж 600 USD, ожидается 03.01.27");
  assert.equal(handoffFootnote({ ...gate, contractConfirmed: false, contractEvidenceReference: null }, { now: NOW }), null);
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
  assert.match(after, /class="grid [^"]*border-t border-border border-b border-border" data-testid="v3-handoff-strip"/u);
  // The footnote: received, not «ожидается»; its date in the same mono format.
  assert.match(after, new RegExp(`data-testid="v3-handoff-footnote">Первый платёж 600 USD, получен\u00a0${mono("17.09")}</p>`, "u"));
  assert.doesNotMatch(after, /ожидается|20\.09\.2026/u);
  assert.doesNotMatch(after, /v3-handoff-warnings|text-warn/u);
  assert.equal((after.match(/data-state="done"/gu) ?? []).length, 5);
  assert.doesNotMatch(after, /<form\b/u, "nothing left to confirm");

  const unread = renderCard(null);
  assert.match(unread, /role="alert"[^>]*>.*Не удалось загрузить передачу\./u);
  assert.doesNotMatch(unread, /data-handoff-item/u, "no guessed ticks without a read");
});

test("«Продажи» headline: one number by sale date, discrepancies named, no number without a read", () => {
  const headline = compile("src/components/v3/SalesPeriodHeadline.tsx");
  assert.deepEqual(headline.salesHeadlinePeriod(2026, 9), { from: "2026-09-01", to: "2026-09-30", label: "сентябрь 2026" });
  assert.deepEqual(headline.salesHeadlinePeriod(2028, 2), { from: "2028-02-01", to: "2028-02-29", label: "февраль 2028" });
  assert.deepEqual(headline.salesHeadlinePeriod(2026, undefined), { from: "2026-01-01", to: "2026-12-31", label: "2026 год" });
  const { saleSliceHref } = salesReportContext({ year: "2026", month: "9" }, { year: 2026, month: 9 });
  const render = (read, extra = {}) => renderToStaticMarkup(createElement(headline.SalesPeriodHeadline,
    { read, label: "сентябрь 2026", retryHref: "/v3/main?view=sales", sliceHref: saleSliceHref, ...extra }));
  const september = { status: "available", count: { from: "2026-09-01", to: "2026-09-30", sales: 5, undated: 1, otherSaleDate: 1, filedElsewhere: 1 } };
  const full = render(september);
  const plain = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
  assert.match(full, /Продажи за сентябрь 2026: <strong class="[^"]*tabular-nums[^"]*">5<\/strong>/u);
  assert.match(plain(full), /· по дате продажи, без архива Не входят: без даты продажи — 1 запись дата продажи в другом месяце — 1 запись Входят из другого месяца отчёта: 1 запись$/u);
  // Each named discrepancy opens exactly those records (same period, no other filter), with a 44 px target.
  for (const [slice, words] of [["undated", "без даты продажи — 1 запись"], ["other_sale_date", "дата продажи в другом месяце — 1 запись"], ["filed_elsewhere", "1 запись"]]) {
    assert.match(full, new RegExp(`<a href="/v3/main\\?view=sales&amp;year=2026&amp;month=9&amp;sale=${slice}" class="inline-flex min-h-11 [^"]*" data-sale-slice="${slice}">${words}</a>`, "u"), slice);
  }
  assert.doesNotMatch(full, /без фильтров/u);
  assert.match(plain(render(september, { filtered: true })), /· по дате продажи, без архива и без фильтров/u, "not to be read against «Найдено по фильтрам»");
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
  // Only a slice reads v3; the ordinary report keeps v2.
  const source = read("src/lib/v3/sales-register-source.ts");
  assert.match(source, /slice === null\s*\? await client\.schema\("platform"\)\.rpc\("read_sales_register_v2", filters\)\s*: await client\.schema\("platform"\)\.rpc\("read_sales_register_v3", \{ \.\.\.filters, p_sale_slice: slice \}\)/u);
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
  const handed = pages.get("lead-handed");
  assert.match(handed, /data-testid="v3-lead-stage">Переданы</u);
  assert.match(text(handed), /Передача Передано 18\.09 · Айгерим Условная · принято 19\.09 Запись о продаже в архиве и в продажи не входит\. Открыть запись/u);
  assert.match(handed, /<a href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9&amp;record=12341234-5555-4555-8555-000000000001" class="-my-3 inline-flex min-h-11/u);
  assert.match(text(handed), /Первый платёж 600 USD, получен 17\.09/u);
  assert.doesNotMatch(handed, /ожидает условий|ожидается|Новый</u);
  // Продажа в уже открытое дело (208): дата по квитанции; договор и оплата — по той
  // же записи «Отчёта продаж» (22.09, 600 USD); ответа куратора не бывает — сказано словами.
  const sold = pages.get("lead-sold");
  assert.match(text(sold), /Передано 23\.09 · Айгерим Условная Приём этой передачи в CRM не отмечается: продажа записана в уже открытый кабинет\./u);
  assert.match(text(sold), /Договор есть по отчёту 22\.09 Первый платёж есть по отчёту: оплачено 600 USD Запись в отчёте есть 22\.09/u);
  assert.doesNotMatch(text(sold), /ждёт принятия|ждёт ответа/u, "no pending step nobody can take");
  const report = pages.get("report");
  assert.match(text(report), /Алина Переданная .*? 22\.09\.2026 .*? 600 USD/u, "the same record says the same numbers");
  // До передачи: нейтрально, формы подтверждения спокойные, исключение Admin свёрнуто.
  const working = pages.get("lead-working");
  assert.match(working, /data-testid="v3-lead-stage">Квалифицирован</u);
  assert.doesNotMatch(working, /v3-handoff-summary|v3-handoff-warnings/u);
  assert.match(working, /<details class="group border-t border-border px-4 py-1"><summary[^>]*>.*?Исключение Admin<\/summary>/u);
  const transition = working.slice(working.indexOf('data-testid="v3-sales-transition"'));
  assert.doesNotMatch(transition.slice(0, transition.indexOf("</section>")), /bg-accent/u, "no solid red in «Передача»");

  // Lead 360: «Добавить заметку» — спокойная кнопка 44 px; сплошной красный — одно главное действие.
  for (const page of [handed, sold, working]) {
    assert.match(page, /<button type="submit" class="v3-raised inline-flex min-h-11 [^"]*t-label[^"]*">Добавить заметку<\/button>/u);
    assert.doesNotMatch(page, /text-xs font-semibold text-white[^>]*>Добавить заметку/u);
  }

  // «Отчёт продаж»: «Продажи» по дате продажи; таблица месяца (6 записей) сходится со словами,
  // а каждое расхождение ведёт к своим записям.
  assert.match(report, /data-testid="v3-sales-headline" data-sales="5"/u);
  assert.match(text(report), /Продажи за сентябрь 2026: 5 · по дате продажи, без архива Не входят: без даты продажи — 1 запись дата продажи в другом месяце — 1 запись Входят из другого месяца отчёта: 1 запись/u);
  assert.match(report, /href="\/v3\/main\?view=sales&amp;year=2026&amp;month=9&amp;sale=undated"/u);
  assert.match(text(report), /Найдено по фильтрам Записей продаж 6/u);
  // По ссылке «без даты продажи»: ровно эта запись, слова среза и «без фильтров» у числа.
  const undated = pages.get("report-undated");
  assert.match(text(undated), /Продажи за сентябрь 2026: 5 · по дате продажи, без архива и без фильтров/u);
  assert.match(text(undated), /Записи без даты продажи: в продажи не входят — сентябрь 2026\. Все записи периода/u);
  assert.match(text(undated), /Найдено по фильтрам Записей продаж 1/u);
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
