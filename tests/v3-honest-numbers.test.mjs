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
import { handoffStripView, stripDay } from "../src/components/v3/profile/handoff-strip-view.ts";

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
  handoff: { completed_at: "2026-09-18T05:00:00+00:00", evidence: "handoff" },
  contract: { confirmed: true, confirmed_at: "2026-09-17T05:00:00+00:00" },
  first_payment: { received_date: "2026-09-17" },
  report: { status: "available", record: { id: RECORD, report_month: "2026-09-01", sale_date: "2026-09-17", archived: false } },
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
  assert.deepEqual(strip.handoff, { completedAt: "2026-09-18T05:00:00+00:00", evidence: "handoff" });
  assert.deepEqual(strip.report, { status: "available", record: { id: RECORD, reportMonth: "2026-09-01", saleDate: "2026-09-17", archived: false } });
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

test("Lead 360 «Передача»: after a handoff one line with dates and no warning", () => {
  const view = handoffStripView(parse(HANDED_JSON), { now: NOW });
  assert.equal(view.stageTitle, "Переданы");
  assert.equal(view.summary, "Передано 18.09 · Куратор Синтетический · принято 19.09");
  assert.deepEqual(view.warnings, []);
  assert.deepEqual(view.items.map((item) => [item.label, item.state, item.text, item.date]), [
    ["Договор", "done", null, "17.09"],
    ["Первый платёж", "done", null, "17.09"],
    ["Запись в отчёте", "done", null, "17.09"],
    ["Куратор", "done", "Куратор Синтетический", "18.09"],
    ["Принято", "done", null, "19.09"],
  ]);
});

test("Lead 360 «Передача»: a handoff lacking evidence says so in words", () => {
  // Производственный лид: передан 18.09, запись о продаже в архиве.
  const archived = handoffStripView(parse({ ...HANDED_JSON,
    report: { status: "available", record: { ...HANDED_JSON.report.record, archived: true } } }), { now: NOW });
  assert.equal(archived.stageTitle, "Переданы", "an archived sale does not return the lead to the working board");
  assert.deepEqual(archived.warnings, ["Запись о продаже в архиве и в продажи не входит."]);
  assert.equal(archived.items.find((item) => item.key === "report").state, "attention");
  // Путь 208: передача по квитанции отчёта, куратор ещё не ответил.
  const receipt = handoffStripView(parse({ ...HANDED_JSON, handoff: { completed_at: "2026-09-23T03:00:00+00:00", evidence: "sales_report" },
    contract: { confirmed: false, confirmed_at: null }, first_payment: { received_date: null }, acceptance: null }), { now: NOW });
  assert.equal(receipt.summary, "Передано 23.09 · Куратор Синтетический · ждёт принятия");
  assert.deepEqual(receipt.warnings, [], "contract and payment are evidence, not a ban");
  assert.deepEqual(receipt.items.find((item) => item.key === "accepted"), { key: "accepted", label: "Принято", state: "missing", text: "ждёт ответа", date: null });
  // Куратор отклонил: дело ждёт назначения; записи в отчёте нет; дата продажи не указана.
  assert.deepEqual(handoffStripView(parse({ ...HANDED_JSON, curator: null, acceptance: null }), { now: NOW }).warnings,
    ["Куратор не назначен: дело ждёт назначения."]);
  assert.deepEqual(handoffStripView(parse({ ...HANDED_JSON, report: { status: "available", record: null } }), { now: NOW }).warnings,
    ["Записи о продаже в отчёте нет."]);
  assert.deepEqual(handoffStripView(parse({ ...HANDED_JSON, report: { status: "available", record: { ...HANDED_JSON.report.record, sale_date: null } } }), { now: NOW }).warnings,
    ["В записи отчёта нет даты продажи, поэтому в продажи она не входит."]);
  assert.deepEqual(handoffStripView(parse({ ...HANDED_JSON, acceptance: { decision: "clarification_requested", at: "2026-09-19T03:30:00+00:00" } }), { now: NOW }).warnings,
    ["Куратор просит уточнить передачу."]);
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
  assert.equal(stripDay("2025-12-30", "2026-09-26"), "30.12.2025", "another year keeps its year");
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

  const after = renderCard(handoffStripView(parse(HANDED_JSON), { now: NOW }),
    { ...GATE, contractConfirmed: true, firstPaymentReceivedDate: "2026-09-17", normalHandoffAllowed: true, gateState: "satisfied" });
  assert.match(after, /data-testid="v3-handoff-summary">Передано 18\.09 · Куратор Синтетический · принято 19\.09</u);
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
  const render = (read) => renderToStaticMarkup(createElement(headline.SalesPeriodHeadline, { read, label: "сентябрь 2026", retryHref: "/v3/main?view=sales" }));
  const full = render({ status: "available", count: { from: "2026-09-01", to: "2026-09-30", sales: 5, undated: 1, otherSaleDate: 1, filedElsewhere: 1 } });
  assert.match(full, /Продажи за сентябрь 2026: <strong class="[^"]*tabular-nums[^"]*">5<\/strong>/u);
  assert.match(full, /Не входят: без даты продажи — 1 запись, дата продажи в другом месяце — 1 запись\. Входят из другого месяца отчёта: 1 запись\./u);
  assert.doesNotMatch(full, /font-mono/u, "counts are Golos tabular digits");
  const clean = render({ status: "available", count: { from: "2026-09-01", to: "2026-09-30", sales: 6, undated: 0, otherSaleDate: 0, filedElsewhere: 0 } });
  assert.doesNotMatch(clean, /v3-sales-headline-notes/u);
  assert.equal(render({ status: "denied" }), "");
  assert.match(render({ status: "unavailable" }), /role="alert"[^>]*>Не удалось посчитать продажи за сентябрь 2026\./u);
  assert.doesNotMatch(render({ status: "unavailable" }), /Продажи за/u);
  const view = read("src/components/v3/SalesRegisterView.tsx");
  assert.match(view, /readSalesCount\(actor, headlinePeriod\)/u);
  assert.match(read("src/lib/v3/sales-numbers-source.ts"), /rpc\("staff_sales_count_v1"/u);
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
  assert.match(text(handed), /Передача Передано 18\.09 · Айгерим Условная · принято 19\.09 Запись о продаже в архиве и в продажи не входит\./u);
  assert.doesNotMatch(handed, /ожидает условий|Новый</u);
  // Продажа в уже открытое дело (208): дата по квитанции, без предупреждения.
  const sold = pages.get("lead-sold");
  assert.match(text(sold), /Передано 23\.09 · Айгерим Условная · ждёт принятия/u);
  assert.doesNotMatch(sold, /v3-handoff-warnings/u);
  // До передачи: нейтрально, формы подтверждения спокойные, исключение Admin свёрнуто.
  const working = pages.get("lead-working");
  assert.match(working, /data-testid="v3-lead-stage">Квалифицирован</u);
  assert.doesNotMatch(working, /v3-handoff-summary|v3-handoff-warnings/u);
  assert.match(working, /<details class="group border-t border-border px-4 py-1"><summary[^>]*>.*?Исключение Admin<\/summary>/u);
  const transition = working.slice(working.indexOf('data-testid="v3-sales-transition"'));
  assert.doesNotMatch(transition.slice(0, transition.indexOf("</section>")), /bg-accent/u, "no solid red in «Передача»");

  // «Отчёт продаж»: «Продажи» по дате продажи; таблица месяца (6 записей) сходится со словами.
  const report = pages.get("report");
  assert.match(report, /data-testid="v3-sales-headline" data-sales="5"/u);
  assert.match(text(report), /Продажи за сентябрь 2026: 5 · по дате продажи, без архива Не входят: без даты продажи — 1 запись, дата продажи в другом месяце — 1 запись\. Входят из другого месяца отчёта: 1 запись\./u);
  assert.match(text(report), /Найдено по фильтрам Записей продаж 6/u);

  // Воронка по доске: переданный лид (его stage_key — 'new') в «Переданы», а не в «Новый».
  const funnel = text(pages.get("funnel"));
  assert.match(funnel, /В работе 3 · Переданы 1/u);
  assert.match(funnel, /Новый 1 .*Переданы 1/u);
});
