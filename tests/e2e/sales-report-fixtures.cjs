"use strict";

/**
 * СИНТЕТИЧЕСКИЕ данные и подмены границ данных и прав для «Отчёта продаж» (tests/e2e/sales-report-next-static-render.cjs). Имена,
 * суммы и записи выдуманы для проверки вёрстки и не являются записями EVO. Модуль не зависит от Node: тот же файл собирается в
 * браузерный бандл гидратации (как `boards-fixtures.cjs`), сервер и браузер строят одно дерево. Подменены только чтения отчёта,
 * финансов, звонков и «Динамики», проверка сотрудника и серверные действия; настоящие `main/page.tsx`, `readSalesRegisterPage` и
 * компоненты работают поверх них.
 */

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const uuid = (prefix, n) => `${prefix}-5555-4555-8555-${String(n).padStart(12, "0")}`;
const ADMIN = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002", membershipId: ME, organizationId: ORG,
  displayName: "Администратор (синтетический)", systemRole: "admin", platformAccessVersion: 1, assignments: [], permissionKeys: [],
  email: "synthetic@example.invalid", presentationRole: null,
};
// Сотрудник с правом читать отчёт и записи; просмотр роли — администратор в роли продаж.
const ACTORS = {
  admin: ADMIN,
  staff: { ...ADMIN, systemRole: "staff", permissionKeys: ["sales.report.read", "sales.read", "sales.register.read", "lead.read"] },
  preview: { ...ADMIN, presentationRole: "sales" },
};
let currentActor = ADMIN;
const setActor = (kind) => { currentActor = ACTORS[kind] ?? ADMIN; };

const managerKey = (label) => label.trim().replace(/\s+/gu, " ").replace(/[.\s]+$/u, "").toLowerCase();
function reviewReasonsOf(row) {
  if (!row.needsReview) return [];
  const reasons = [];
  if (row.signingDate === null) reasons.push("signing_date_missing");
  if (row.serviceCostMinor === null) reasons.push("service_cost_missing");
  if (row.paidMinor === null) reasons.push("paid_missing");
  if (row.serviceCostCurrency && row.paidCurrency && row.serviceCostCurrency !== row.paidCurrency && row.paidContractCurrency !== row.serviceCostCurrency) reasons.push("contract_amount_missing");
  for (const flag of row.importFlags) if (flag === "status_unspecified" && !["оплачено", "частично оплачено", "не оплачено"].includes(row.statusRaw.trim().toLowerCase())) reasons.push(`import:${flag}`);
  return reasons;
}
function row(n, f) {
  const base = {
    id: uuid("78787878", n), version: 1, reportMonth: f.month ?? "2026-09-01", signingDate: f.sale === undefined ? "2026-09-10" : f.sale, applicantName: f.name, phone: "+996 000 000 0" + String(n).padStart(2, "0"),
    country: f.country ?? "Малайзия", university: "", program: f.program ?? "Бакалавриат", direction: f.direction ?? f.country ?? "Малайзия", intake: "2027", contractNumber: "", managerLabel: f.manager ?? "Санжар Эскизов",
    statusRaw: "", ownerMembershipId: ME, serviceCostRaw: String((f.cost === undefined ? 150000 : f.cost ?? 0) / 100), serviceCostMinor: f.cost === undefined ? 150000 : f.cost,
    serviceCostCurrency: f.cost === null ? null : f.costCurrency ?? "USD", paidRaw: f.paid === null ? "" : String((f.paid === undefined ? 60000 : f.paid) / 100), paidMinor: f.paid === undefined ? 60000 : f.paid,
    paidCurrency: f.paid === null ? null : f.paidCurrency ?? "USD", needsReview: f.review ?? false, notes: f.notes ?? "", archived: f.archived ?? false, sourceKey: null, sourceKind: f.flags ? "import" : "manual",
    leadId: null, clientId: null, sourceSha256: null, sourceSheet: f.flags ? "Сентябрь (синтетический лист)" : null, sourceRow: f.flags ? 10 + n : null, updatedAt: "2026-09-24T05:00:00.000Z",
    paidContractMinor: f.contract ?? null, paidContractCurrency: f.contract == null ? null : f.costCurrency ?? "USD", reviewReasons: [], importFlags: f.flags ?? [],
    managerKey: managerKey(f.manager ?? "Санжар Эскизов"), withdrawal: f.withdrawal ?? null,
  };
  return { ...base, reviewReasons: reviewReasonsOf(base) };
}
const ROWS = [
  row(1, { name: "Алина Переданная", sale: "2026-09-22" }),
  row(2, { name: "Айжан Примерова", sale: "2026-09-20", manager: " санжар эскизов", review: true, flags: ["status_unspecified"] }),
  row(3, { name: "Тимур Образцов", sale: "2026-09-14", manager: "Айдана Макетова", country: "Китай", program: "Магистратура, экономика", paid: null, review: true }),
  row(4, { name: "Бекзат Тестов", sale: null, review: true }),
  row(5, { name: "Данияр Макетов", sale: "2026-09-05", cost: 12000000, costCurrency: "KGS", paid: 5000000, paidCurrency: "KGS" }),
  row(6, { name: "Руслан Прототипов", sale: "2026-09-03", manager: "Айдана Макетова", cost: 180000, paid: 4500000, paidCurrency: "KGS", review: true }),
  row(7, { name: "Эльвира Шаблонова с очень длинным именем для проверки обрезки", sale: "2026-09-12", cost: null, paid: null, review: true }),
  row(8, { name: "Нурлан Отказной", sale: "2026-09-18", withdrawal: { kind: "partial", at: "2026-09-25T05:00:00.000Z", by: "Администратор (синтетический)", note: "Передумал после первого платежа" } }),
  row(13, { name: "Ольга Архивная", sale: "2026-09-08", archived: true }),
  row(10, { name: "Камила Условная", month: "2026-08-01", sale: "2026-08-19" }),
];
const REPORT = { rows: ROWS };
const state = { calls: [], target: 35 };
globalThis.__salesReportFixture = state;

function readReport(selection) {
  const mm = selection.month ? String(selection.month).padStart(2, "0") : null;
  const first = `${selection.year}-${mm ?? "01"}-01`;
  const end = mm ? `${selection.year}-${mm}-31` : `${selection.year}-12-31`;
  const inPeriod = (date) => date !== null && date >= first && date <= end;
  let rows = REPORT.rows.filter((one) => one.archived === Boolean(selection.archived));
  rows = selection.saleSlice === "filed_elsewhere" ? rows.filter((one) => inPeriod(one.signingDate) && !inPeriod(one.reportMonth)) : rows.filter((one) => inPeriod(one.reportMonth));
  if (selection.saleSlice === "undated") rows = rows.filter((one) => one.signingDate === null);
  else if (selection.saleSlice === "other_sale_date") rows = rows.filter((one) => one.signingDate !== null && !inPeriod(one.signingDate));
  if (selection.needsReview != null) rows = rows.filter((one) => one.needsReview === selection.needsReview);
  if (selection.direction) rows = rows.filter((one) => one.direction === selection.direction);
  if (selection.query) rows = rows.filter((one) => [one.applicantName, one.phone, one.contractNumber].some((value) => value.toLowerCase().includes(selection.query.toLowerCase())));
  const spellings = new Map();
  for (const one of REPORT.rows) {
    const key = managerKey(one.managerLabel);
    if (!key) continue;
    const tidy = one.managerLabel.trim().replace(/\s+/gu, " ");
    const counts = spellings.get(key) ?? new Map();
    counts.set(tidy, (counts.get(tidy) ?? 0) + 1);
    spellings.set(key, counts);
  }
  const managerOptions = [...spellings.entries()].map(([key, counts]) => ({ key, name: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))[0][0], count: rows.filter((one) => one.managerKey === key).length }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const selectedKey = selection.manager ? managerKey(selection.manager) : null;
  if (selectedKey) rows = rows.filter((one) => one.managerKey === selectedKey);
  const offset = selection.offset ?? 0;
  const archived = Boolean(selection.archived);
  const counted = rows.filter((one) => one.withdrawal === null);
  const totals = new Map();
  for (const one of counted) {
    if (one.serviceCostMinor !== null) { const t = totals.get(one.serviceCostCurrency) ?? { currency: one.serviceCostCurrency, costMinor: 0, paidMinor: 0 }; t.costMinor += one.serviceCostMinor; totals.set(one.serviceCostCurrency, t); }
    if (one.paidMinor !== null) { const t = totals.get(one.paidCurrency) ?? { currency: one.paidCurrency, costMinor: 0, paidMinor: 0 }; t.paidMinor += one.paidMinor; totals.set(one.paidCurrency, t); }
  }
  const refusedPaid = new Map();
  for (const one of rows.filter((item) => item.withdrawal !== null && item.paidMinor !== null)) refusedPaid.set(one.paidCurrency, (refusedPaid.get(one.paidCurrency) ?? 0) + one.paidMinor);
  return {
    year: selection.year, month: selection.month ?? null, totalCount: rows.length, rows: rows.slice(offset, offset + 50), offset, hasMore: offset + 50 < rows.length,
    selected: selection.recordId ? REPORT.rows.find((one) => one.id === selection.recordId) ?? null : null,
    totals: archived ? [] : [...totals.values()], unresolvedCostCount: archived ? 0 : counted.filter((one) => one.serviceCostMinor === null).length,
    unresolvedPaidCount: archived ? 0 : counted.filter((one) => one.paidMinor === null).length, targets: [], managerOptions,
    ownerOptions: [{ membershipId: ME, displayLabel: "Администратор (синтетический)" }], query: selection.query || null, managerKey: selectedKey,
    withdrawn: archived ? { count: 0, paid: [] } : { count: rows.length - counted.length, paid: [...refusedPaid.entries()].map(([currency, paidMinor]) => ({ currency, paidMinor })) },
  };
}
function countFor(period) {
  const inPeriod = (date) => date !== null && date >= period.from && date <= period.to;
  const rows = REPORT.rows.filter((one) => !one.archived && one.withdrawal === null);
  return { status: "available", count: { from: period.from, to: period.to, sales: rows.filter((one) => inPeriod(one.signingDate)).length,
    undated: rows.filter((one) => inPeriod(one.reportMonth) && one.signingDate === null).length,
    otherSaleDate: rows.filter((one) => inPeriod(one.reportMonth) && one.signingDate !== null && !inPeriod(one.signingDate)).length,
    filedElsewhere: rows.filter((one) => inPeriod(one.signingDate) && !inPeriod(one.reportMonth)).length } };
}
const MANAGER_LABELS = { labels: [
  { key: "айдана макетова", tidy: "Айдана Макетова", recordCount: 2, spellings: [{ spelling: "Айдана Макетова", count: 2 }], mapping: { displayName: "Айдана Макетова", membershipId: ME, version: 1, updatedAt: "2026-09-28T05:00:00.000Z" } },
  { key: "санжар эскизов", tidy: "Санжар Эскизов", recordCount: 7, spellings: [{ spelling: "Санжар Эскизов", count: 6 }, { spelling: " санжар эскизов", count: 1 }], mapping: null },
], staffOptions: [{ id: ME, label: "Администратор (синтетический)" }] };

const STUBS = {
  "@/lib/platform-guards": { requireV3PageActor: async () => currentActor, requirePlatformStaffActor: async () => currentActor },
  "@/lib/v3/sales-register-source": {
    readSalesRegisterWorkspace: async (_actor, selection) => readReport(selection),
    readSalesRegisterIntakeOptions: async () => null,
    readSalesRegisterWriteAccess: async () => "allowed",
    readSalesRegisterDirections: async () => ["Малайзия", "Китай", "china"],
    readSalesRegisterManagement: async (_actor, reportMonth) => ({ status: "ready", data: { reportMonth: reportMonth ?? "2026-09-01", canManageTarget: true, canImport: true,
      target: reportMonth === "2026-09-01" ? { id: uuid("89898989", 1), version: 2, reportMonth, managerLabel: null, targetCount: state.target } : null } }),
    readSalesManagerLabels: async () => ({ status: "ready", data: MANAGER_LABELS }),
    readSalesRecordLeadLink: async () => ({ status: "ready", link: null }),
    searchSalesRecordLeadOptions: async () => [],
  },
  "@/lib/v3/finance-entry-source": { readMonthlyPaymentSummary: async () => ({ status: "ready", totals: [
    { currency: "USD", paymentsMinor: "1250000", refundsMinor: "150000", netMinor: "1100000", eventCount: "9" },
    { currency: "KGS", paymentsMinor: "9000000", refundsMinor: "0", netMinor: "9000000", eventCount: "2" }] }) },
  "@/lib/v3/sales-numbers-source": { readSalesCount: async (_actor, period) => countFor(period), readLeadHandoffStrip: async () => ({ status: "unavailable" }) },
  "@/lib/platform-sales": { getPlatformSalesLead: async () => null },
  "@/lib/v3/sales-dynamics-source": { readSalesDynamics: async (_actor, period) => ({
    dashboard: { figures: { counts: { leads: 28, qualified: 12, handed: 5 }, metrics: [], stages: [] }, trend: null },
    funnel: { status: "available", working: 18, stages: [{ key: "new", name: "Новый", value: 8 }, { key: "contacting", name: "Связались", value: 5 }, { key: "qualified", name: "Квалифицирован", value: 3 },
      { key: "meeting_scheduled", name: "Встреча назначена", value: 1 }, { key: "meeting_completed", name: "Встреча проведена", value: 1 }, { key: "potential", name: "Потенциальный клиент", value: 0 }, { key: "handed_off", name: "Переданы", value: 5 }] },
    sales: countFor({ from: period.from, to: period.to }) }) },
  "@/lib/v3/telephony-report-source": { canReadTelephonyReport: () => false, readTelephonyReport: async () => ({ status: "off" }) },
  "@/lib/v3/telephony-dial-source": { readDialOptions: async () => ({ status: "off" }) },
  "@/lib/v3/telephony-task-leads-source": { readTodayTaskLeads: async () => ({}) },
  "@/lib/v3/today-source": { readTodayQueue: async () => ({ access: {}, reads: {} }), todayLinks: () => ({ boards: [], mainAction: null }) },
  // «Убрать» / «Вернуть» (307): подменённое действие записывает вызов и меняет запись, как сервер (версия +1).
  "@/lib/platform-sales-register-actions": {
    // Остальные действия форм отчёта: в проверках не выполняются, но модуль должен их отдавать (форма берёт `useActionState`).
    saveSalesManagerLabelAction: async (previous) => previous,
    linkSalesRecordLeadAction: async (previous) => previous,
    searchSalesRecordLeadOptionsAction: async () => [],
    saveSalesRegisterAction: async (previous) => previous,
    saveSalesTargetAction: async (previous) => previous,
    importSalesRegisterAction: async (previous) => previous,
    searchSalesRegisterStudentsAction: async () => [],
    readSalesReportConditionsPreviewAction: async () => null,
    setSalesRegisterWithdrawalAction: async (previous, form) => {
      const id = String(form.get("record_id"));
      const restore = String(form.get("kind") ?? "") === "";
      state.calls.push({ id, restore, kind: String(form.get("kind") ?? ""), note: String(form.get("note") ?? "") });
      const target = REPORT.rows.find((one) => one.id === id);
      if (!target) return { ...previous, status: "unavailable" };
      Object.assign(target, { version: target.version + 1, withdrawal: restore ? null : { kind: String(form.get("kind")), at: "2026-09-26T05:00:00.000Z", by: "Администратор (синтетический)", note: String(form.get("note") || "") || null } });
      return { status: "saved", requestId: String(form.get("request_id")), recordId: id, operation: restore ? "withdraw_undo" : "withdraw" };
    },
  },
};

/** Предсказуемые UUID для `randomUUID()` страницы: сервер и браузер получают одну последовательность. */
function syntheticUuids() {
  let next = 0;
  return () => `99999999-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`;
}
const selectSalesRows = () => {};
const setSaveSucceeds = () => {};

module.exports = { ACTOR: ADMIN, ACTORS, STUBS, REPORT, state, ROWS, setActor, selectSalesRows, setSaveSucceeds, syntheticUuids, uuid };
