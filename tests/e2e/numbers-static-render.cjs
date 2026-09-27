"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require (тот же приём, что в
// case-static-render.cjs и boards-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер Э2 «Честные числа» (решения владельца 26.09.2026,
 * миграция 247): НАСТОЯЩИЕ компоненты с СИНТЕТИЧЕСКИМИ данными — имена,
 * числа и записи выдуманы для проверки вёрстки и не являются записями EVO.
 * Живой Supabase и права проверяет supabase/tests/platform_sales_one_truth.sql.
 *
 *  - Lead 360 (`/v3/profile?id=…`): `Profile` с полосой «Передача» —
 *    переданный лид как в production (передан 18.09, запись о продаже в
 *    архиве: предупреждение словами и «Открыть запись»), лид, проданный в
 *    уже открытое дело (208: дата по квитанции; договор и оплата — по записи
 *    отчёта; приём в CRM не отмечается — сказано словами), и лид до передачи
 *    (полоса нейтральна, формы подтверждения спокойные);
 *  - «Отчёт продаж»: настоящий `SalesRegisterView` с подменёнными чтениями —
 *    заголовок «Продажи за сентябрь» по дате продажи и названные расхождения
 *    с таблицей месяца отчёта — ссылками на эти записи; и сама таблица по
 *    ссылке «без даты продажи» (`sale=undated`);
 *  - «Динамика по дням»: настоящие чтения периода и доски с подменёнными
 *    RPC — переданный лид в «Переданы» (а не «Новый») и на доске, и в
 *    когорте периода; кабинет без продажи не передача; «Продажи за период»
 *    по тому же определению, что заголовок отчёта.
 *
 *   node tests/e2e/numbers-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] (для tests/v3-honest-numbers.test.mjs).
 *   node tests/e2e/numbers-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900 и 390×844 (во весь рост) в
 *       outDir (по умолчанию .impeccable/review, не коммитится):
 *       numbers-<сценарий>-<ширина>.png и метрики на каждый снимок.
 *   node tests/e2e/numbers-static-render.cjs --json-e4
 *     → stdout: JSON [{ name, html }] страниц Э4 ниже в обоих обликах
 *       (для tests/v3-e4-work-surfaces.test.mjs).
 *   node tests/e2e/numbers-static-render.cjs --e4-screenshots [outDir]
 *     → Э4 (27.09.2026): Lead 360 как рабочая карточка — лид на раннем этапе,
 *       «Потенциальный клиент», переданный лид — и «Отчёт продаж» (список,
 *       открытая запись в панели, «Весь 2026 год» — и с открытой записью,
 *       срез «записаны в другой месяц отчёта», больше 500 записей — суммы
 *       сервера, «Поступления и возвраты за месяц») в прежнем и новом облике, 1440×900, 1280×800 и 390×844 во
 *       весь рост: e4-<сценарий>[-next]-<ширина>.png, высота страницы, число
 *       сплошных красных и видимых месяцев отчёта на каждый снимок.
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

const compile = (source, fileName) =>
  ts.transpileModule(source, {
    fileName,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8"), filename), filename);
  };
}
Module._extensions[".png"] = (module, filename) => {
  module.exports = { src: pathToFileURL(filename).href, width: 1843, height: 842 };
};
Module._extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });
};

// --- синтетические данные ---------------------------------------------------
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const LEAD_ID = "dddddddd-3333-4333-8333-000000000001";
const uuid = (prefix, n) => `${prefix}-5555-4555-8555-${String(n).padStart(12, "0")}`;
const ADMIN = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, displayName: "Администратор (синтетический)", systemRole: "admin",
  platformAccessVersion: 1, assignments: [], permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
};
// «Сегодня» — 26.09.2026 (полоса считает год от текущих часов; даты фикстур в этом году).
const CURATOR_NAME = "Айгерим Условная";

// Три лида Lead 360 — то, что вернуло бы staff_lead_handoff_strip_v1.
const STRIPS = {
  // Как в production 26.09: передан 18.09 через 088, запись о продаже в архиве.
  handed: {
    leadId: LEAD_ID, stage: "handed_off",
    handoff: { completedAt: "2026-09-18T05:00:00.000Z", evidence: "handoff", acceptanceRecordable: true },
    contract: { confirmed: true, confirmedAt: "2026-09-17T05:00:00.000Z" }, firstPayment: { receivedDate: "2026-09-17" },
    report: { status: "available", record: { id: uuid("12341234", 1), reportMonth: "2026-09-01", saleDate: "2026-09-17", archived: true,
      hasContractNumber: true, paid: { minor: 60000, currency: "USD" } } },
    curator: { displayName: CURATOR_NAME, assignedAt: "2026-09-18T05:05:00.000Z" },
    acceptance: { decision: "accepted", at: "2026-09-19T03:30:00.000Z" },
  },
  // Продажа сохранена в отчёте в уже открытое дело (208): дата — по квитанции;
  // строка условий ничего не подтверждает — договор и оплата по записи отчёта
  // (та же запись «Алина Переданная» в «Отчёте продаж»: 22.09, оплачено 600 USD);
  // ответ куратора записать нельзя (182 требует строки 088).
  sold: {
    leadId: LEAD_ID, stage: "handed_off",
    handoff: { completedAt: "2026-09-23T03:00:00.000Z", evidence: "sales_report", acceptanceRecordable: false },
    contract: { confirmed: false, confirmedAt: null }, firstPayment: { receivedDate: null },
    report: { status: "available", record: { id: uuid("56565656", 1), reportMonth: "2026-09-01", saleDate: "2026-09-22", archived: false,
      hasContractNumber: false, paid: { minor: 60000, currency: "USD" } } },
    curator: { displayName: CURATOR_NAME, assignedAt: "2026-09-23T03:00:00.000Z" }, acceptance: null,
  },
  // До передачи: квалифицирован, договора ещё нет.
  working: {
    leadId: LEAD_ID, stage: "qualified", handoff: null,
    contract: { confirmed: false, confirmedAt: null }, firstPayment: { receivedDate: null },
    report: { status: "available", record: null }, curator: null, acceptance: null,
  },
};
const GATE_BLOCKED = {
  organizationId: ORG, leadId: LEAD_ID, gateVersion: "2", gateState: "blocked", contractConfirmed: false,
  contractConfirmedByMembershipId: null, contractConfirmedAt: null, contractEvidenceReference: null, firstPaymentAmount: null,
  firstPaymentCurrency: null, firstPaymentDueDate: null, firstPaymentReceivedDate: null, firstPaymentConfirmedByMembershipId: null,
  firstPaymentConfirmedAt: null, firstPaymentEvidenceReference: null, overrideReason: null, overriddenByMembershipId: null,
  overriddenAt: null, normalHandoffAllowed: false, exceptionalHandoffAllowed: false, canConfirmContract: true,
  canConfirmFirstPayment: true, canOverrideGate: true, updatedAt: "2026-09-20T05:00:00.000Z",
};
const GATE_SATISFIED = {
  ...GATE_BLOCKED, gateVersion: "4", gateState: "satisfied", contractConfirmed: true, contractConfirmedByMembershipId: ME,
  contractConfirmedAt: "2026-09-17T05:00:00.000Z", contractEvidenceReference: "Договор № 0000 (синтетический)",
  firstPaymentAmount: 600, firstPaymentCurrency: "USD", firstPaymentDueDate: "2026-09-20", firstPaymentReceivedDate: "2026-09-17",
  firstPaymentConfirmedByMembershipId: ME, firstPaymentConfirmedAt: "2026-09-17T06:00:00.000Z",
  firstPaymentEvidenceReference: "Платёж 0000 (синтетический)", normalHandoffAllowed: true,
};
const LEAD_SCENARIOS = {
  "lead-handed": { strip: STRIPS.handed, gate: GATE_SATISFIED, stageKey: "new", next: "Передано в поступление" },
  "lead-sold": { strip: STRIPS.sold, gate: { ...GATE_BLOCKED, canConfirmContract: false, canConfirmFirstPayment: false, canOverrideGate: false },
    stageKey: "meeting_completed", next: "Передано в поступление" },
  "lead-working": { strip: STRIPS.working, gate: GATE_BLOCKED, stageKey: "qualified", next: "Отправить договор на подпись" },
};

// Э4: условия продажи и заметки лида — синтетика той же формы, что читает Lead 360.
const CONDITIONS = {
  leadId: LEAD_ID, organizationId: ORG, revision: 3, serviceLabel: "Поступление в Малайзию «под ключ»", signingDate: null,
  serviceCostRaw: "1500", serviceCostMinor: 150000, serviceCostCurrency: "USD", paidRaw: "", paidMinor: null, paidCurrency: null,
  paymentNote: "", wishesCountries: "Малайзия", wishesStudyFields: "IT, бизнес", wishesEducationLevel: "Бакалавриат",
  wishesIntakeYear: "2027", wishesIntakeSeason: "осень", wishesUniversities: "", educationCurrent: "11 класс", educationGrade: "",
  educationMarks: "", educationEnglish: "IELTS 6.0", educationCertificates: "", conditionsBudgetRaw: "8000", conditionsBudgetMinor: 800000,
  conditionsBudgetCurrency: "USD", conditionsBudgetPeriod: "year", conditionsScholarship: "", conditionsNote: "",
  updatedByMembershipId: ME, updatedAt: "2026-09-20T05:00:00.000Z", linkedSalesRegister: null,
};
const EMPTY_CONDITIONS = { ...CONDITIONS, serviceLabel: "", serviceCostRaw: "", serviceCostMinor: null, serviceCostCurrency: null,
  wishesStudyFields: "", wishesEducationLevel: "", wishesIntakeSeason: "", educationCurrent: "", educationEnglish: "",
  conditionsBudgetRaw: "", conditionsBudgetMinor: null, conditionsBudgetCurrency: null, conditionsBudgetPeriod: null };
const note = (body, at, author = "Санжар Эскизов") => ({ body, authorDisplayName: author, createdAt: at });
const E4_LEADS = {
  // Ранний этап: связались, следующий шаг с датой, условия почти пустые.
  early: { strip: { ...STRIPS.working, stage: "contacting" }, gate: GATE_BLOCKED, stageKey: "contacting",
    next: "Позвонить после консультации с родителями", due: "2026-09-29", conditions: EMPTY_CONDITIONS,
    notes: [note("Созвонились: интересует Малайзия, бюджет до 8 000 USD в год. Родители хотят консультацию.", "2026-09-25T09:40:00.000Z"),
      note("Пришла заявка с сайта, перезвонить вечером.", "2026-09-24T12:05:00.000Z")] },
  // «Потенциальный клиент»: условия заполнены, договора ещё нет — главное действие «Оформить продажу».
  // Связанная переписка — «Написать» у заголовка (на телефоне — значком).
  potential: { strip: { ...STRIPS.working, stage: "potential" }, gate: GATE_BLOCKED, stageKey: "potential",
    next: "Подписать договор", due: "2026-09-26", conditions: CONDITIONS,
    conversations: [{ conversationId: uuid("67676767", 1), subject: "Переписка с сайта (синтетическая)", queue: "sales", status: "open",
      updatedAt: "2026-09-20T05:00:00.000Z" }],
    notes: [note("Встреча прошла, семья согласна на пакет «под ключ». Ждём подписи договора.", "2026-09-23T10:15:00.000Z"),
      note("Назначили встречу в офисе на 23.09.", "2026-09-19T07:30:00.000Z"),
      note("Квалифицирован: 11 класс, IELTS 6.0, Малайзия, осень 2027.", "2026-09-16T08:00:00.000Z")] },
  // Передан: этап доски «Переданы», строка передачи вместо шага, «Открыть дело» — нейтральное.
  handed: { strip: STRIPS.handed, gate: GATE_SATISFIED, stageKey: "new", next: "Передано в поступление", due: null,
    conditions: { ...CONDITIONS, signingDate: "2026-09-17", paidRaw: "600", paidMinor: 60000, paidCurrency: "USD" },
    handoff: { caseId: uuid("45454545", 1), canOpenCase: true },
    notes: [note("Договор подписан, первый платёж получен. Передаём куратору.", "2026-09-17T11:20:00.000Z")] },
};

// «Отчёт продаж», сентябрь 2026: те же записи, что в SQL-наборе 247.
function saleRow(n, fields) {
  return {
    id: uuid("56565656", n), version: 1, reportMonth: fields.month ?? "2026-09-01", signingDate: fields.sale ?? null,
    applicantName: fields.name, phone: "", country: "Малайзия", university: "", program: fields.program ?? "Бакалавриат",
    direction: "Малайзия", intake: "2027", contractNumber: "", managerLabel: "Санжар Эскизов", statusRaw: "",
    ownerMembershipId: ME, serviceCostRaw: "1500", serviceCostMinor: 150000, serviceCostCurrency: "USD", paidRaw: "600",
    paidMinor: 60000, paidCurrency: "USD", needsReview: false, notes: "", archived: false, sourceKey: null,
    sourceKind: fields.pipeline ? "pipeline" : "manual", leadId: fields.pipeline ? LEAD_ID : null, clientId: null,
    sourceSha256: null, sourceSheet: null, sourceRow: null, updatedAt: "2026-09-24T05:00:00.000Z",
  };
}
const REPORT_ROWS = [
  saleRow(1, { name: "Алина Переданная", sale: "2026-09-22", pipeline: true }),
  saleRow(2, { name: "Айжан Примерова", sale: "2026-09-20" }),
  saleRow(3, { name: "Тимур Образцов", sale: "2026-09-14" }),
  saleRow(4, { name: "Бекзат Тестов", sale: "2026-09-05" }),
  saleRow(5, { name: "Данияр Макетов", sale: null }),
  saleRow(6, { name: "Руслан Прототипов", sale: "2026-08-30" }),
];
const SALES_COUNT = { status: "available", count: { from: "2026-09-01", to: "2026-09-30", sales: 5, undated: 1, otherSaleDate: 1, filedElsewhere: 1 } };

// Э4: отчёт с записями, по которым видно сведение фильтров, причины «Уточнить»
// и остаток по валютам: одно имя менеджера в трёх написаниях, направление в двух,
// оплата в другой валюте, запись без даты продажи и без стоимости.
function e4Row(n, fields) {
  return { ...saleRow(n, { name: fields.name, sale: fields.sale === undefined ? "2026-09-10" : fields.sale, month: fields.month }),
    id: uuid("78787878", n), managerLabel: fields.manager ?? "Санжар Эскизов", country: fields.country ?? "Малайзия",
    direction: fields.direction ?? "Малайзия", program: fields.program ?? "Бакалавриат",
    serviceCostRaw: fields.costRaw ?? String((fields.cost ?? 150000) / 100), serviceCostMinor: fields.cost === undefined ? 150000 : fields.cost,
    serviceCostCurrency: fields.cost === null ? null : fields.costCurrency ?? "USD",
    paidRaw: fields.paidRaw ?? (fields.paid === null ? "" : String((fields.paid ?? 60000) / 100)), paidMinor: fields.paid === undefined ? 60000 : fields.paid,
    paidCurrency: fields.paid === null ? null : fields.paidCurrency ?? "USD", needsReview: fields.review ?? false,
    leadId: null, sourceKind: "manual" };
}
const E4_ROWS = [
  e4Row(1, { name: "Алина Переданная", sale: "2026-09-22", review: false }),
  e4Row(2, { name: "Айжан Примерова", sale: "2026-09-20", manager: " санжар эскизов", review: true }),
  e4Row(3, { name: "Тимур Образцов", sale: "2026-09-14", manager: "Айдана Макетова", country: "Китай", direction: "Китай", program: "Магистратура, экономика", paid: null, review: true }),
  e4Row(4, { name: "Бекзат Тестов", sale: null, manager: "Санжар  Эскизов", review: true }),
  e4Row(5, { name: "Данияр Макетов", sale: "2026-09-05", cost: 12000000, costCurrency: "KGS", paid: 5000000, paidCurrency: "KGS", direction: "малайзия ", review: false }),
  e4Row(6, { name: "Руслан Прототипов", sale: "2026-09-03", manager: "Айдана Макетова", cost: 180000, paid: 4500000, paidCurrency: "KGS", review: true }),
  e4Row(7, { name: "Эльвира Шаблонова", sale: "2026-09-12", cost: null, costRaw: "по договорённости", paid: null, review: true }),
  e4Row(8, { name: "Нурлан Черновой", sale: "2026-09-18", manager: "", paid: 150000, review: true }),
  e4Row(9, { name: "Асель Пробная", sale: "2026-09-25", manager: "Айдана Макетова", country: "Китай", direction: "China", program: "Foundation", cost: 250000, paid: 250000, review: false }),
];
// Записи других месяцев отчёта — для «Весь 2026 год» и среза «записаны в другой месяц отчёта»:
// продажа 30.07 записана в августовский отчёт. В сентябрь не попадают, числа сентября прежние.
const E4_EARLIER_ROWS = [
  e4Row(10, { name: "Камила Условная", month: "2026-08-01", sale: "2026-08-19", review: false }),
  e4Row(11, { name: "Эрлан Выдуманный", month: "2026-08-01", sale: "2026-07-30", cost: 200000, paid: 200000, review: false }),
  e4Row(12, { name: "Жанна Модельная", month: "2026-07-01", sale: "2026-07-08", cost: 9000000, costCurrency: "KGS", paid: 3000000, paidCurrency: "KGS", review: true, manager: "Айдана Макетова" }),
];
// «Продажи» периода теми же тремя множествами, что staff_sales_count_v1 (247), — из записей набора.
function countFor(period) {
  const inPeriod = (date) => date !== null && date >= period.from && date <= period.to;
  const rows = REPORT.rows.filter((row) => !row.archived);
  const filed = (row) => inPeriod(row.reportMonth);
  return { status: "available", count: { from: period.from, to: period.to,
    sales: rows.filter((row) => inPeriod(row.signingDate)).length,
    undated: rows.filter((row) => filed(row) && row.signingDate === null).length,
    otherSaleDate: rows.filter((row) => filed(row) && row.signingDate !== null && !inPeriod(row.signingDate)).length,
    filedElsewhere: rows.filter((row) => inPeriod(row.signingDate) && !filed(row)).length } };
}
const E4_MANAGEMENT = { status: "ready", data: { reportMonth: "2026-09-01", canManageTarget: true, canImport: false,
  target: { id: uuid("89898989", 1), version: 2, reportMonth: "2026-09-01", managerLabel: null, targetCount: 35 } } };

/** Какой отчёт отдают подменённые чтения: прежние шесть записей Э2 или набор Э4. */
const REPORT = { rows: REPORT_ROWS, count: SALES_COUNT, management: { status: "denied" }, directions: ["Малайзия"], managerLabels: ["Санжар Эскизов"] };
function useE4Report() {
  Object.assign(REPORT, { rows: [...E4_ROWS, ...E4_EARLIER_ROWS], count: countFor, management: E4_MANAGEMENT,
    directions: ["China", "Китай", "Малайзия", "малайзия "], managerLabels: ["Айдана Макетова", "Санжар Эскизов", " санжар эскизов", "Санжар  Эскизов"] });
}
// Больше 500 записей в выборке: остаток по всем страницам не читается, суммы — сервера по записям
// (`totals`), а неуточнённые стоимость и оплата, которых в них нет, названы числом.
function useE4BulkReport() {
  const patterns = [{}, { cost: null, costRaw: "по договорённости", paid: null }, { paid: null, paidRaw: "половина" },
    { cost: 12000000, costCurrency: "KGS", paid: 5000000, paidCurrency: "KGS" }, { paid: 4500000, paidCurrency: "KGS", cost: 180000 }];
  const rows = Array.from({ length: 520 }, (_, index) => e4Row(100 + index, { name: `Синтетическая запись ${index + 1}`,
    sale: `2026-09-${String(1 + (index % 28)).padStart(2, "0")}`, review: index % 3 === 0, ...patterns[index % 7 === 0 ? 1 : index % 11 === 0 ? 2 : index % 4 === 0 ? 3 : index % 9 === 0 ? 4 : 0] }));
  Object.assign(REPORT, { rows, count: countFor, management: { status: "denied" } });
}

/** Ответ read_sales_register_v2/v3 по выборке — теми же правилами, что проверяет `readSalesRegisterWorkspace`. */
function readReport(selection) {
  // Период — как в 247: месяцы отчёта периода; срез 'filed_elsewhere' — продажи периода с другим месяцем отчёта.
  const mm = selection.month ? String(selection.month).padStart(2, "0") : null;
  const first = `${selection.year}-${mm ?? "01"}-01`;
  const end = mm ? `${selection.year}-${mm}-31` : `${selection.year}-12-31`;
  const inPeriod = (date) => date !== null && date >= first && date <= end;
  let rows = REPORT.rows.filter((row) => row.archived === Boolean(selection.archived));
  rows = selection.saleSlice === "filed_elsewhere"
    ? rows.filter((row) => inPeriod(row.signingDate) && !inPeriod(row.reportMonth))
    : rows.filter((row) => inPeriod(row.reportMonth));
  if (selection.saleSlice === "undated") rows = rows.filter((row) => row.signingDate === null);
  else if (selection.saleSlice === "other_sale_date") rows = rows.filter((row) => row.signingDate !== null && !inPeriod(row.signingDate));
  if (selection.needsReview != null) rows = rows.filter((row) => row.needsReview === selection.needsReview);
  if (selection.manager) rows = rows.filter((row) => row.managerLabel === selection.manager);
  if (selection.direction) rows = rows.filter((row) => row.direction === selection.direction);
  const offset = selection.offset ?? 0;
  const totals = new Map();
  for (const row of rows) {
    if (row.serviceCostMinor !== null) {
      const total = totals.get(row.serviceCostCurrency) ?? { currency: row.serviceCostCurrency, costMinor: 0, paidMinor: 0 };
      total.costMinor += row.serviceCostMinor;
      totals.set(row.serviceCostCurrency, total);
    }
    if (row.paidMinor !== null) {
      const total = totals.get(row.paidCurrency) ?? { currency: row.paidCurrency, costMinor: 0, paidMinor: 0 };
      total.paidMinor += row.paidMinor;
      totals.set(row.paidCurrency, total);
    }
  }
  return {
    year: selection.year, month: selection.month ?? null, totalCount: rows.length, rows: rows.slice(offset, offset + 50), offset, hasMore: offset + 50 < rows.length,
    selected: selection.recordId ? REPORT.rows.find((row) => row.id === selection.recordId) ?? null : null,
    totals: [...totals.values()], unresolvedCostCount: rows.filter((row) => row.serviceCostMinor === null && row.serviceCostRaw).length,
    unresolvedPaidCount: rows.filter((row) => row.paidMinor === null && row.paidRaw).length,
    targets: [], managerLabels: REPORT.managerLabels, ownerOptions: [],
  };
}

// Доска продаж: четыре открытых лида, один из них передан (его stage_key — всё ещё 'new').
function boardRow(n, stageKey, name) {
  return {
    organizationId: ORG, leadId: uuid("dddddddd", n), clientId: uuid("cccccccc", n), clientDisplayName: name, clientEmail: null, clientPhone: null,
    currentOwnerMembershipId: ME, currentOwnerDisplayName: "Санжар Эскизов", stageKey, sourceKey: "website", lifecycleState: "open",
    nextActionText: "Позвонить", nextActionDueDate: "2026-09-27", workflowVersion: "1", isConnected: false, openDuplicateCandidateCount: 0,
    linkedStudentCaseCount: n === 1 || n === 2 ? 1 : 0, linkedConversationCount: 0, createdAt: "2026-09-05T05:00:00.000Z",
    updatedAt: "2026-09-24T05:00:00.000Z", stageEnteredAt: "2026-09-20T05:00:00.000Z", latestNote: null,
  };
}
const BOARD_ROWS = [boardRow(1, "new", "Алина Переданная"), boardRow(2, "qualified", "Айжан Примерова"),
  boardRow(3, "new", "Тимур Образцов"), boardRow(4, "contacting", "Бекзат Тестов")];
const HANDED = new Set([uuid("dddddddd", 1)]);

const STUBS = {
  "@/lib/v3/sales-register-source": {
    // Срез «без даты продажи» — как read_sales_register_v3 с p_sale_slice => 'undated'.
    readSalesRegisterWorkspace: async (_actor, selection) => readReport(selection),
    readSalesRegisterIntakeOptions: async () => null,
    readSalesRegisterWriteAccess: async () => "allowed",
    readSalesRegisterDirections: async () => REPORT.directions,
    // План — только у своего месяца отчёта (у Э4 — сентябрь); другой месяц или весь год — без плана.
    readSalesRegisterManagement: async (_actor, reportMonth) => REPORT.management.status === "ready" && reportMonth !== REPORT.management.data.reportMonth
      ? { status: "ready", data: { ...REPORT.management.data, reportMonth, target: null } } : REPORT.management,
  },
  // «Поступления и возвраты за месяц»: по умолчанию роль сводку не читает; сценарий Э4 `report-cash` — читает.
  "@/lib/v3/finance-entry-source": { readMonthlyPaymentSummary: async () => REPORT.cash ?? { status: "not_allowed" } },
  "@/lib/v3/sales-numbers-source": { readSalesCount: async (_actor, period) => typeof REPORT.count === "function" ? REPORT.count(period) : REPORT.count,
    readLeadHandoffStrip: async () => ({ status: "unavailable" }) },
  "@/lib/platform-sales-stage-entries": {
    // Доказанный вход в «Квалифицирован» у лида 2 (он и на доске «Квалифицирован»);
    // у переданного лида 1 (stage_key 'new', как в production) входа нет — он
    // квалифицирован передачей.
    listPlatformSalesStageEntries: async () => ({ rows: [{ organizationId: ORG, leadId: uuid("dddddddd", 2), stageKey: "qualified",
      enteredAt: "2026-09-10T05:00:00.000Z", enteredOn: "2026-09-10", requestId: uuid("14141414", 1) }], hasNext: false, nextCursor: null }),
    PlatformSalesStageEntryError: class PlatformSalesStageEntryError extends Error {},
  },
  "@/lib/platform-sales": {
    listPlatformSalesLeads: async () => ({ rows: BOARD_ROWS, hasNext: false, nextCursor: null }),
    listPlatformSalesOwnerOptions: async () => ({ rows: [], hasNext: false, nextCursor: null }),
    readPlatformSalesPipeline: async (actor, readers) => ({ board: await readers.board(actor), ownerOptions: null, canCreateLead: true }),
    PlatformSalesRepositoryError: class PlatformSalesRepositoryError extends Error {},
  },
  "@/lib/v3/sales-handoff-source": { readCompletedSalesHandoffs: async () => HANDED },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (typeof request === "string" && Object.hasOwn(STUBS, request)) {
    const filename = join(ROOT, ".stub-numbers", `${request.replace(/[^a-z0-9]+/giu, "_")}.js`);
    if (!Module._cache[filename]) {
      const stub = new Module(filename);
      stub.filename = filename;
      stub.exports = STUBS[request];
      stub.loaded = true;
      Module._cache[filename] = stub;
    }
    return filename;
  }
  if (request === "server-only") return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    }
    return originalResolve.call(this, base, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");

const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
function withContexts(node, pathname, search) {
  return createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: pathname },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}
function shell(actor, title, body, look = false) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  // `look` — новый облик (предпросмотр Admin): слой `data-look` и оболочка Э1.2.
  return createElement("div", { className: "v3-world", "data-look": look ? "next" : undefined },
    createElement(AppShell, { actor, initialNotifications: null, ...(look ? { look: "next" } : {}) },
      title === null ? body : createElement(PartShell, { title, count: null }, body)));
}

// --- Lead 360 ----------------------------------------------------------------
// Как `profile/page.tsx` для `?id=`: имя — h1, возврат «Воронка продаж» над ним,
// действия у заголовка, шапка «Этап · Что дальше» и «Обзор» из `leadWorkParts`.
function leadPage(name, { look = false } = {}) {
  const scenario = LEAD_SCENARIOS[name] ?? E4_LEADS[name];
  const { Profile } = require(join(ROOT, "src/components/v3/profile/Profile.tsx"));
  const { buildV3ProfileHref } = require(join(ROOT, "src/components/v3/profile/types.ts"));
  const { leadWorkParts } = require(join(ROOT, "src/components/v3/profile/LeadWorkParts.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const { Icon } = require(join(ROOT, "src/components/icons.tsx"));
  const wording = require(join(ROOT, "src/lib/v3/wording.ts"));
  const hrefFor = (tab) => buildV3ProfileHref({ leadId: LEAD_ID, studentCaseId: null }, tab);
  const profile = {
    leadId: LEAD_ID, person: "Алина Переданная", email: "lead@example.invalid", phone: "+996 000 000 002", student: scenario.strip.handoff !== null,
    stage: scenario.stageKey, caseStatus: null, source: "website", qualification: null, arrived: "05.09.2026", nextAction: scenario.next,
    nextActionAt: null, handoff: null, applications: [], visa: [], financeStop: null, timeline: [],
  };
  const draft = {
    access: { documents: false, finance: false, studentProfile: false, contract: false },
    routeTarget: { leadId: LEAD_ID, studentCaseId: null }, responsible: "Санжар Эскизов", provider: null, person: [], study: [],
    profileFields: null, studentApplication: null, profileFieldSources: [], documents: [], otherFiles: [], budget: null, currency: null,
    payments: [], paid: null, remaining: null, paidPercent: null, admissions: null, contract: null, handoffAcknowledgement: null,
    salesHandoffAcknowledgement: null, saleConditions: scenario.conditions ?? null, leadCabinetCase: null, contractSignedAt: null,
  };
  const sales = {
    lead: { leadId: LEAD_ID, currentOwnerMembershipId: ME, currentOwnerDisplayName: "Санжар Эскизов", stageKey: scenario.stageKey,
      nextActionText: scenario.next, nextActionDueDate: scenario.due ?? null, workflowVersion: "5" },
    leadCreatedAt: "2026-09-05T05:00:00.000Z",
    gate: scenario.gate, handoff: { caseId: null, canOpenCase: false, handedOffAt: scenario.strip.handoff?.completedAt ?? null, ...scenario.handoff },
    strip: { status: "available", strip: scenario.strip }, linkedConversations: scenario.conversations ?? [],
  };
  const requestIds = Object.fromEntries(["contract", "firstPayment", "override", "handoff", "platformAccess", "saleConditions",
    "prepareLeadCabinet", "wishesCard", "educationCard", "conditionsCard", "step", "note"].map((key, index) => [key, uuid("13131313", index + 1)]));
  const notes = { subject: { leadId: LEAD_ID, studentCaseId: null }, rows: scenario.notes ?? [] };
  const parts = leadWorkParts({
    actor: ADMIN, profile, draft, sales, notes, notesOlderHref: null, notesLatestHref: null,
    requestIds: { ...requestIds, portal: "", cabinetPortal: "" },
    stages: ["new", "contacting", "qualified", "meeting_scheduled", "meeting_completed", "potential"].map((key) => ({ key, title: wording.salesStage(key) })),
    ownerOptions: [{ membershipId: ME, displayLabel: "Санжар Эскизов" }], ownerOptionsHaveMore: false, curators: [], curatorsAvailable: true,
    submissions: null, hrefFor, now: new Date("2026-09-27T06:00:00.000Z"), ...(look ? { look: "next" } : {}),
  });
  const body = createElement(Profile, {
    profile, draft, sales, actor: ADMIN, organizationId: ORG, studentPortalCurators: [], studentPortalCuratorsAvailable: true,
    requestIds, noteRequestId: uuid("13131313", 20), notes, notesOlderHref: null, notesLatestHref: null, tab: "overview", hrefFor,
    caseHeader: parts.header, caseOverview: parts.overview,
  });
  const back = createElement("a", { href: "/v3/pipeline", className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    createElement(Icon, { name: "arrow-left", size: 16 }), "Воронка продаж");
  const page = createElement(PartShell, { title: profile.person, count: null, action: parts.actions, dense: true, back },
    createElement("div", { className: "space-y-6" }, body));
  return renderToStaticMarkup(withContexts(shell(ADMIN, null, page, look), "/v3/profile", `id=${LEAD_ID}&tab=overview`));
}

// --- «Отчёт продаж» ------------------------------------------------------------
async function reportPage(extra = {}, { look = false } = {}) {
  const { SalesRegisterView } = require(join(ROOT, "src/components/v3/SalesRegisterView.tsx"));
  const query = { view: "sales", year: "2026", month: "9", ...extra };
  const element = await SalesRegisterView({ actor: ADMIN, query, ...(look ? { look: "next" } : {}) });
  return renderToStaticMarkup(withContexts(shell(ADMIN, null, element, look), "/v3/main", new URLSearchParams(query).toString()));
}

// --- «Динамика по дням»: когорта, «Продажи» периода и воронка по доске ----------
// Настоящие чтения периода и доски (`readSalesDynamics` → `readPeriodDashboard`,
// `readPipelineLeads`, `salesBoardFunnel`) поверх подменённых RPC: переданный
// лид (его stage_key — 'new') — «Переданы» и на доске, и в когорте; кабинет без
// продажи (лид 2) — не передача.
async function funnelPage() {
  const { readSalesDynamics } = require(join(ROOT, "src/lib/v3/sales-dynamics-source.ts"));
  const { SalesDynamics } = require(join(ROOT, "src/components/v3/SalesDynamics.tsx"));
  const { salesDynamicsCarry, salesDynamicsHref } = require(join(ROOT, "src/lib/sales-register-navigation.ts"));
  const period = { key: "custom", from: "2026-09-01", to: "2026-09-26", today: "2026-09-26" };
  const query = { view: "sales", period: "custom", from: period.from, to: period.to };
  const read = await readSalesDynamics(ADMIN, period);
  const periods = [["today", "Сегодня"], ["yesterday", "Вчера"], ["week", "Неделя"], ["month", "Месяц"], ["custom", "Период"]];
  const body = createElement(SalesDynamics, {
    id: "sales-dynamics", open: true,
    choices: periods.map(([key, title]) => ({ key, title, href: salesDynamicsHref(query, key === "custom" ? period : { key }), active: key === "custom" })),
    range: { from: period.from, to: period.to, max: period.today }, periodText: "1 сен — 26 сен",
    formAction: "/v3/main#sales-dynamics", carry: salesDynamicsCarry(query), retryHref: salesDynamicsHref(query, period), read,
  });
  return renderToStaticMarkup(withContexts(shell(ADMIN, "Отчёт продаж", body), "/v3/main", "view=sales&period=custom"));
}

async function renderAll() {
  const out = [];
  for (const name of Object.keys(LEAD_SCENARIOS)) out.push({ name, html: leadPage(name) });
  out.push({ name: "report", html: await reportPage() });
  out.push({ name: "report-undated", html: await reportPage({ sale: "undated" }) });
  out.push({ name: "funnel", html: await funnelPage() });
  return out;
}

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${pathToFileURL(join(dir, "files")).href}/`);
  });
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8")].join("\n");
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const SIZES = {
    1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  };
  try {
    for (const { name, html } of await renderAll()) {
      const htmlPath = join(outDir, `numbers-${name}.html`);
      writeFileSync(htmlPath, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Э2 — ${name} (синтетические данные)</title><style>${css}</style></head><body class="min-h-full">${html}</body></html>`);
      for (const width of ["1440", "390"]) {
        const context = await browser.newContext(SIZES[width]);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].map((image) => image.decode().catch(() => null)));
        });
        const target = name.startsWith("lead") ? '[data-testid="v3-lead-stage"]' : name.startsWith("report") ? "main h1" : "#sales-dynamics";
        // Lead 360 — во весь рост с шапкой профиля: этап, полоса и заметки на одном снимке.
        const fullPage = name.startsWith("lead");
        if (!fullPage) await page.evaluate((selector) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`no ${selector}`);
          window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 96), behavior: "instant" });
        }, target);
        if (errors.length) throw new Error(`${name}: browser errors:\n${errors.join("\n")}`);
        const metrics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          solidRed: [...document.querySelectorAll("main a, main button")].filter((element) => element.checkVisibility()
            && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
          smallText: [...document.querySelectorAll("main *")].filter((element) => element.checkVisibility()
            && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
            && parseFloat(getComputedStyle(element).fontSize) < 12).length,
          smallTargets: [...document.querySelectorAll("main a, main button, main summary")].filter((element) =>
            element.checkVisibility() && element.getBoundingClientRect().height < 24).length,
          stripItems: document.querySelectorAll("[data-handoff-item]").length,
          warnings: document.querySelectorAll('[data-testid="v3-handoff-warnings"] li').length,
          headline: document.querySelector('[data-testid="v3-sales-headline"]')?.textContent?.replace(/\s+/gu, " ").trim() ?? null,
        }));
        const file = `numbers-${name}-${width}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage });
        process.stdout.write(`${file}: ${Object.entries(metrics).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join(" ")}\n`);
        if (name === "funnel") {
          // Второй экран: «Продажи за период» и «Сейчас на доске».
          await page.evaluate(() => {
            const element = document.querySelector("[data-period-sales]");
            window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 24), behavior: "instant" });
          });
          await page.screenshot({ path: join(outDir, `numbers-funnel-board-${width}.png`) });
          process.stdout.write(`numbers-funnel-board-${width}.png\n`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

// --- Э4: Lead 360 и «Отчёт продаж» в обоих обликах ---------------------------------
async function e4Pages(look) {
  useE4Report();
  return [
    { name: "lead-early", html: leadPage("early", { look }) },
    { name: "lead-potential", html: leadPage("potential", { look }) },
    { name: "lead-handed", html: leadPage("handed", { look }) },
    { name: "report", html: await reportPage({}, { look }) },
    { name: "report-panel", html: await reportPage({ record: E4_ROWS[1].id, edit: "true" }, { look }) },
    // Месяц отчёта в строке: «Весь 2026 год» (и с открытой записью — узкая строка при 1440)
    // и срез июля «записаны в другой месяц отчёта».
    { name: "report-year", html: await reportPage({ month: "all" }, { look }) },
    { name: "report-year-panel", html: await reportPage({ month: "all", record: E4_EARLIER_ROWS[1].id, edit: "true" }, { look }) },
    { name: "report-elsewhere", html: await reportPage({ month: "7", sale: "filed_elsewhere" }, { look }) },
    { name: "report-bulk", html: await (async () => { useE4BulkReport(); const html = await reportPage({}, { look }); useE4Report(); return html; })() },
    // «Поступления и возвраты за месяц» под записями: сводка финансовых событий месяца (синтетика).
    { name: "report-cash", html: await (async () => {
      REPORT.cash = { status: "ready", totals: [
        { currency: "USD", paymentsMinor: "540000", refundsMinor: "60000", netMinor: "480000", eventCount: 7 },
        { currency: "KGS", paymentsMinor: "5000000", refundsMinor: "0", netMinor: "5000000", eventCount: 1 }] };
      const html = await reportPage({}, { look });
      delete REPORT.cash;
      return html;
    })() },
  ];
}

async function e4Screenshots() {
  const outIndex = process.argv.indexOf("--e4-screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const SIZES = {
    1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  };
  const results = [];
  try {
    for (const look of [false, true]) {
      for (const { name, html } of await e4Pages(look)) {
        const file = `e4-${name}${look ? "-next" : ""}`;
        const htmlPath = join(outDir, `${file}.html`);
        writeFileSync(htmlPath, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Э4 — ${name} (синтетические данные)</title><style>${css}</style></head><body class="min-h-full">${html}</body></html>`);
        for (const width of ["1440", "1280", "390"]) {
          const context = await browser.newContext(SIZES[width]);
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
          await page.evaluate(async () => {
            await document.fonts.ready;
            // Только видимые: скрытая копия логотипа (lazy) в оболочке нового облика не грузится, и её decode() не завершится.
            await Promise.all([...document.images].filter((image) => image.checkVisibility()).map((image) => image.decode().catch(() => null)));
          });
          // Во весь рост меню разделов — обычная колонка, а не липкая высотой в экран (как в case-static-render).
          await page.addStyleTag({ content: 'nav[aria-label="Разделы"] { position: static !important; height: auto !important; }' });
          if (errors.length) throw new Error(`${file}: browser errors:\n${errors.join("\n")}`);
          const metrics = await page.evaluate(() => {
            const visible = (element) => element.checkVisibility();
            const firstRow = document.querySelector('[aria-label="Записи продаж"] tbody tr');
            return {
              height: document.documentElement.scrollHeight,
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              // Шире окна, хотя страница не прокручивается вбок (оболочка режет переполнение): кроме лент и таблиц с прокруткой.
              wide: [...document.querySelectorAll("main *")].filter((element) => visible(element)
                && element.getBoundingClientRect().right > window.innerWidth + 1
                && !element.closest('[data-tab-strip], [role="region"], [popover], dialog')).length,
              solidRed: [...document.querySelectorAll("a, button")].filter((element) => visible(element)
                && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map((element) => element.textContent.trim()),
              smallText: [...document.querySelectorAll("main *")].filter((element) => visible(element)
                && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
                && parseFloat(getComputedStyle(element).fontSize) < 12).length,
              smallTargets: [...document.querySelectorAll("main a, main button, main summary")].filter((element) =>
                visible(element) && element.getBoundingClientRect().height < 24).map((element) => element.textContent.trim().slice(0, 30)),
              h1: [...document.querySelectorAll("h1")].map((element) => element.textContent.trim()),
              firstRowTop: firstRow ? Math.round(firstRow.getBoundingClientRect().top + window.scrollY) : null,
              firstRowHeight: firstRow ? Math.round(firstRow.getBoundingClientRect().height) : null,
              // Месяц отчёта строки виден (столбец или строка под именем), а не только подсказкой; и не обрезан.
              reportMonths: [...document.querySelectorAll("[data-report-month]")].filter((element) => visible(element)).length,
              reportMonthCut: [...document.querySelectorAll("[data-report-month], [data-report-month] > time")].filter((element) => visible(element)
                && element.scrollWidth > element.clientWidth + 1).length,
            };
          });
          const shot = `${file}-${width}.png`;
          await page.screenshot({ path: join(outDir, shot), fullPage: true });
          results.push({ shot, ...metrics });
          if (name === "lead-potential" && width !== "1280") {
            // Открытая группа правки («Условия продажи») и панель «Что дальше» поверх страницы.
            const red = () => page.evaluate(() => [...document.querySelectorAll("a, button")].filter((element) => element.checkVisibility()
              && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length);
            await page.evaluate(() => { document.querySelector('[data-testid="v3-lead-group-sale"]').open = true; });
            const groupShot = `${file}-group-${width}.png`;
            await page.screenshot({ path: join(outDir, groupShot), fullPage: true });
            process.stdout.write(`${groupShot}: solidRed=${await red()}\n`);
            await page.evaluate(() => {
              document.querySelector('[data-testid="v3-lead-group-sale"]').open = false;
              window.scrollTo(0, 0);
              document.getElementById("lead-next-step").showPopover();
            });
            const drawerShot = `${file}-drawer-${width}.png`;
            await page.screenshot({ path: join(outDir, drawerShot) });
            process.stdout.write(`${drawerShot}: solidRed=${await red()}\n`);
          }
          process.stdout.write(`${shot}: height=${metrics.height} overflow=${metrics.overflow} wide=${metrics.wide} solidRed=${metrics.solidRed.length}${metrics.solidRed.length ? ` (${metrics.solidRed.join(" | ")})` : ""} smallText=${metrics.smallText} smallTargets=${metrics.smallTargets.length}${metrics.smallTargets.length ? ` (${metrics.smallTargets.join(" | ")})` : ""} h1=${metrics.h1.join("/")}${metrics.firstRowTop !== null ? ` firstRowTop=${metrics.firstRowTop} rowHeight=${metrics.firstRowHeight}` : ""}${metrics.reportMonths ? ` reportMonths=${metrics.reportMonths} reportMonthCut=${metrics.reportMonthCut}` : ""}\n`);
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(outDir, "e4-metrics.json"), JSON.stringify(results, null, 2));
}

if (process.argv.includes("--json-e4")) {
  // Э4 в обоих обликах: имена нового облика — с «-next» (для tests/v3-e4-work-surfaces.test.mjs).
  Promise.all([e4Pages(false), e4Pages(true)])
    .then(([current, next]) => process.stdout.write(JSON.stringify([...current, ...next.map((page) => ({ ...page, name: `${page.name}-next` }))])))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
} else if (process.argv.includes("--e4-screenshots")) {
  e4Screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--json")) {
  renderAll().then((pages) => process.stdout.write(JSON.stringify(pages))).catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: numbers-static-render.cjs --json | --json-e4 | --screenshots [outDir] | --e4-screenshots [outDir]");
  process.exit(2);
}
