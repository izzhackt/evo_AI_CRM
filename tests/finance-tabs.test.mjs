// «Финансы» с вкладками (решение владельца 06.11.2026): «Отчёт продаж» переехал с `/main?view=sales` во вкладку «Финансы»,
// рядом «Финансовый отчёт» (Looker Studio) и «Долги студентов» (миграция 332). Проверяется: какие вкладки видит каждая роль и что
// продажник не получает ни финансовых вкладок, ни их адресов; «Нет доступа» просмотру роли и остальным; переход со старого адреса;
// строгий разбор ответа «Долгов»; чтение через функцию базы; сводка по менеджерам и подсветка долга в таблице продаж.
// Все данные синтетические (выдуманные имена и суммы): репозиторий публичный. Сами функции базы — supabase/tests/platform_student_debts.sql.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { isStaffPreview, staffCanAccessRoute, staffCanFinanceTabHint, staffCanSalesTab } from "../src/lib/platform-access.ts";
import { salesDynamicsCarry, salesDynamicsHref, salesReportRedirectHref } from "../src/lib/sales-register-navigation.ts";
import { parseStudentDebts } from "../src/lib/student-debts-contract.ts";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Мини-загрузчик TS/TSX: границы сервера подменяются явно (`overrides` — по тексту импорта). */
function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const code = ts.transpileModule(read(path), { fileName: path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const compiled = { exports: {} };
    cache.set(path, compiled);
    const resolveFile = (base) => [`${base}.ts`, `${base}.tsx`, base, `${base}/index.ts`, `${base}/index.tsx`].find((file) => existsSync(new URL(`../${file}`, import.meta.url)) && /\.tsx?$/.test(file));
    new Function("require", "module", "exports", code)((id) => {
      if (id in overrides) return overrides[id];
      if (id === "server-only") return {};
      if (id.endsWith(".json") && id.startsWith("@/")) return JSON.parse(read(join("src", id.slice(2))));
      if (id.endsWith(".json") && id.startsWith(".")) return JSON.parse(read(join(dirname(path), id)));
      if (id.startsWith("@/")) return load(resolveFile(join("src", id.slice(2))) ?? assert.fail(id));
      if (id.startsWith(".")) return load(resolveFile(join(dirname(path), id)) ?? assert.fail(`${path}: ${id}`));
      return require(id);
    }, compiled, compiled.exports);
    return compiled.exports;
  }
  return load;
}

const sharedLoad = loader({});
const { salesManagerSummary } = sharedLoad("src/components/staff/sales-next/sales-next-manager-summary.ts");
const { salesRowData } = sharedLoad("src/components/staff/sales-next/sales-next-rows.ts");

const ORG = "10000000-0000-4000-8000-000000000332";
const CASE_A = "32000000-0000-4000-8000-00000000000a";
const CASE_B = "32000000-0000-4000-8000-00000000000b";
const base = { organizationId: ORG, presentationRole: null, platformAccessVersion: 1, assignments: [] };
const admin = { ...base, systemRole: "admin", permissionKeys: [] };
// Бухгалтер только с finance.read.full: финансовые вкладки есть, «Отчёта продаж» нет (права на записи нет). Бухгалтер с чтением записей — оба.
const accountant = { ...base, systemRole: "staff", permissionKeys: ["finance.read.full"] };
const accountantWithRegister = { ...base, systemRole: "staff", permissionKeys: ["finance.read.full", "sales.register.read"] };
const salesperson = { ...base, systemRole: "staff", permissionKeys: ["lead.read", "lead.sales.workflow.manage", "sales.register.read", "sales.register.manage", "finance.read.summary"] };
const admissionsLead = { ...base, systemRole: "staff", permissionKeys: ["lead.read", "case.read.full", "knowledge.read.approved"] };
const nobody = { ...base, systemRole: "staff", permissionKeys: ["knowledge.read.approved"] };
const connected = { status: "available", link: { reportKey: "finance", configured: false, reportId: null, pageId: null, version: 0, updatedAt: null } };

async function financePage(actor, tab, { financeRead = connected, debts = { status: "denied" } } = {}) {
  const reads = []; const debtReads = [];
  const SalesTabView = () => null;
  const load = loader({
    "@/lib/platform-guards": { requireV3PageActor: async () => actor },
    "@/lib/v3/report-links-source": { readReportLink: async () => { reads.push(1); return financeRead; } },
    "@/lib/v3/student-debts-source": { readStudentDebts: async () => { debtReads.push(1); return debts; } },
    "@/components/staff/sales-next/SalesTabView": { SalesTabView },
  });
  const element = await load("src/app/(staff)/finance/page.tsx").default({ searchParams: Promise.resolve(tab === null ? {} : { tab }) });
  const sales = element.type === SalesTabView;
  const tabs = element.props.tabs ? renderToStaticMarkup(element.props.tabs) : "";
  const html = sales ? "" : renderToStaticMarkup(createElement(load("src/components/staff/finance-next/FinanceNextPage.tsx").FinanceNextPage, element.props));
  return { sales, tabs, html, reads, debtReads, element };
}
const labels = (tabs) => [...tabs.matchAll(/<a [^>]*>([^<]+)<\/a>/gu)].map((match) => match[1].trim());

test("a salesperson sees only «Отчёт продаж»: no finance tab, no finance or debts link, `?tab=` of a closed tab opens the first open one, the database is not asked", async () => {
  for (const tab of [null, "sales", "finance", "debts", "unknown"]) {
    const page = await financePage(salesperson, tab);
    assert.equal(page.sales, true, `tab=${tab}`);
    assert.deepEqual(labels(page.tabs), ["Отчёт продаж"], `tab=${tab}`);
    assert.doesNotMatch(page.tabs, /tab=finance|tab=debts|Финансовый отчёт|Долги студентов/u, `tab=${tab}`);
    assert.deepEqual(page.reads, [], `tab=${tab}: no finance read for a role without finance.read.full`);
    assert.deepEqual(page.debtReads, [], `tab=${tab}: no debts read`);
  }
});

test("the Admin and an accountant who reads the register see all three tabs, the default is the first («Отчёт продаж»), the others open on their address", async () => {
  for (const actor of [accountantWithRegister, admin]) {
    const first = await financePage(actor, null);
    assert.equal(first.sales, true);
    assert.deepEqual(labels(first.tabs), ["Отчёт продаж", "Финансовый отчёт", "Долги студентов"]);
    assert.match(first.tabs, /<a aria-current="page"[^>]*href="\/finance\?tab=sales"/u);
    const finance = await financePage(actor, "finance");
    assert.match(finance.html, /Отчёт ещё не подключён\./u);
    assert.match(finance.html, /aria-current="page"[^>]*>Финансовый отчёт</u);
    assert.deepEqual(finance.debtReads, [], "the debts are read only on their own tab");
    const debts = await financePage(actor, "debts", { debts: { status: "available", debts: { rows: [], totals: [], caseRowCount: 0, truncated: false } } });
    assert.match(debts.html, /Долгов нет\./u);
    assert.deepEqual(debts.debtReads, [1]);
  }
});

test("an accountant with only finance.read.full sees only the finance tabs and lands on «Финансовый отчёт», never on a dead end", async () => {
  for (const tab of [null, "sales", "unknown"]) {
    const page = await financePage(accountant, tab);
    assert.equal(page.sales, false, `tab=${tab}: no sales tab, no «Нет доступа к отчёту продаж»`);
    assert.deepEqual(labels(page.tabs), ["Финансовый отчёт", "Долги студентов"], `tab=${tab}`);
    assert.match(page.html, /aria-current="page"[^>]*>Финансовый отчёт</u, `tab=${tab}: the default is the first usable tab`);
    assert.match(page.html, /Отчёт ещё не подключён\./u, `tab=${tab}`);
    assert.doesNotMatch(page.tabs, /tab=sales|Отчёт продаж/u);
  }
  const debts = await financePage(accountant, "debts", { debts: { status: "available", debts: { rows: [], totals: [], caseRowCount: 0, truncated: false } } });
  assert.match(debts.html, /Долгов нет\./u);
});

test("a holder of finance.read.full whose scope the database refuses (own, direction, ...) keeps only «Отчёт продаж» if she reads the register, otherwise nothing: no menu item, «Нет доступа»", async () => {
  const noTabs = await financePage(accountant, null, { financeRead: { status: "denied" } });
  assert.equal(noTabs.sales, false);
  assert.match(noTabs.html, /data-testid="v3-finance-denied"/u);
  assert.equal(noTabs.element.props.tabs, null);
  for (const tab of ["finance", "debts"]) {
    const page = await financePage(accountantWithRegister, tab, { financeRead: { status: "denied" } });
    assert.equal(page.sales, true);
    assert.deepEqual(labels(page.tabs), ["Отчёт продаж"]);
    assert.deepEqual(page.debtReads, []);
  }
});

test("role preview and roles without sales or finance rights get «Нет доступа» from the route guard; the old address redirects", () => {
  for (const presentationRole of ["admin", "sales", "admissions"]) {
    const preview = { ...admin, presentationRole };
    assert.equal(isStaffPreview(preview), true);
    assert.equal(staffCanAccessRoute(preview, "/finance"), false, `preview ${presentationRole}`);
    assert.equal(staffCanAccessRoute({ ...preview, permissionKeys: ["finance.read.full", "sales.register.read"] }, "/finance"), false, `preview ${presentationRole} with rights`);
  }
  assert.equal(staffCanAccessRoute(nobody, "/finance"), false);
  assert.equal(staffCanAccessRoute(salesperson, "/finance"), true);
  assert.equal(staffCanFinanceTabHint(salesperson), false, "finance.read.summary / finance.manage do not open the finance tabs");
  assert.equal(staffCanSalesTab(salesperson), true);
  assert.equal(staffCanFinanceTabHint(accountant), true);
  assert.equal(staffCanSalesTab(accountant), false, "finance.read.full alone does not open the sales report tab (it would be a dead end)");
  assert.equal(staffCanSalesTab(accountantWithRegister), true);
  assert.match(read("src/lib/platform-guards.ts"), /redirect\(`\/access-denied\?from=\$\{encodeURIComponent\(route\)\}`\)/u);
  // Старый адрес: тот же отчёт во вкладке «Финансов», параметры (период, фильтры, запись, форма) сохраняются, `view` заменяется на `tab`.
  assert.equal(salesReportRedirectHref({ view: "sales" }), "/finance?tab=sales");
  assert.equal(salesReportRedirectHref({ view: "sales", year: "2026", month: "9", record: "x", new: "true", lead: "y" }), "/finance?tab=sales&year=2026&month=9&record=x&new=true&lead=y");
  assert.equal(salesReportRedirectHref({ view: "sales", tab: "finance", period: "week", extra: ["a", "b"] }), "/finance?tab=sales&period=week", "a smuggled tab never wins; lists are dropped");
  assert.match(read("src/app/(staff)/main/page.tsx"), /if \(query\.view === "sales" && staffCanSalesTab\(actor\)\) redirect\(salesReportRedirectHref\(query\)\);/u);
});

test("the debts answer is parsed strictly: exact keys, debt = cost - paid > 0, totals per currency, no unknown shapes", () => {
  const row = (extra = {}) => ({ case_id: CASE_A, student_name: "Тестовый Студент А", country: "Китай", direction: "Инженерия", curator: "Куратор Т.", currency: "USD", cost_minor: 500000, paid_minor: 200000, debt_minor: 300000, has_other_currency_payments: false, ...extra });
  const answer = (extra = {}) => ({ schema_version: 1, organization_id: ORG, rows: [row(), row({ case_id: CASE_B, currency: "KGS", cost_minor: 100, paid_minor: 40, debt_minor: 60, curator: null, direction: null })],
    totals: [{ currency: "KGS", cost_minor: 100, paid_minor: 40, debt_minor: 60, case_count: 1 }, { currency: "USD", cost_minor: 500000, paid_minor: 200000, debt_minor: 300000, case_count: 1 }], case_row_count: 2, truncated: false, ...extra });
  const parsed = parseStudentDebts(answer(), ORG);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[1].curator, null);
  assert.deepEqual(parsed.totals.map((total) => total.currency), ["KGS", "USD"], "per currency, never summed together");
  for (const bad of [answer({ organization_id: "10000000-0000-4000-8000-0000000000ff" }), answer({ schema_version: 2 }), answer({ extra: 1 }), answer({ rows: [row({ debt_minor: 0, paid_minor: 500000 })] }),
    answer({ rows: [row({ debt_minor: 1 })] }), answer({ rows: [row({ currency: "usd" })] }), answer({ rows: [row({ has_other_currency_payments: "no" })] }), answer({ rows: [{ ...row(), has_other_currency_payments: undefined }] }), answer({ rows: [row({ case_id: "nope" })] }), answer({ truncated: true }),
    answer({ totals: [{ currency: "USD", cost_minor: 1, paid_minor: 0, debt_minor: 1, case_count: 1 }, { currency: "USD", cost_minor: 1, paid_minor: 0, debt_minor: 1, case_count: 1 }] }), null, [], "x"]) {
    assert.throws(() => parseStudentDebts(bad, ORG));
  }
});

function debtsSource(handler, actor) {
  const rpcs = [];
  const client = { schema: (name) => ({ rpc: async (fn, args) => { rpcs.push([name, fn, args]); return handler(fn, args); } }) };
  const source = loader({ "../supabase/server.ts": { createSupabaseServerClient: async () => client } })("src/lib/v3/student-debts-source.ts");
  return { read: () => source.readStudentDebts(actor), rpcs };
}

test("the debts read asks only the database function, never reaches it for a role without finance.read.full, and maps a refusal to «denied»", async () => {
  const ok = { schema_version: 1, organization_id: ORG, rows: [], totals: [], case_row_count: 0, truncated: false };
  const allowed = debtsSource(() => ({ data: ok, error: null }), accountant);
  assert.deepEqual(await allowed.read(), { status: "available", debts: { rows: [], totals: [], caseRowCount: 0, truncated: false } });
  assert.deepEqual(allowed.rpcs, [["platform", "student_debts_v1", { p_organization_id: ORG }]]);
  for (const actor of [salesperson, nobody, { ...admin, presentationRole: "sales" }]) {
    const refused = debtsSource(() => assert.fail("no RPC"), actor);
    assert.deepEqual(await refused.read(), { status: "denied" });
    assert.equal(refused.rpcs.length, 0);
  }
  assert.deepEqual(await debtsSource(() => ({ data: null, error: { code: "42501" } }), admin).read(), { status: "denied" });
  assert.deepEqual(await debtsSource(() => ({ data: null, error: { code: "XX000" } }), admin).read(), { status: "unavailable" });
  assert.deepEqual(await debtsSource(() => ({ data: { wrong: true }, error: null }), admin).read(), { status: "unavailable" });
  const source = read("src/lib/v3/student-debts-source.ts");
  assert.doesNotMatch(source, /service_role|SERVICE_ROLE|\.from\(/u, "no table reads and no service key from the page");
});

test("«Долги студентов»: rows with the link to the case, totals per currency as stored, an honest empty state and a read failure", () => {
  const load = loader({});
  const { StudentDebtsNext } = load("src/components/staff/finance-next/StudentDebtsNext.tsx");
  const debts = { rows: [
    { caseId: CASE_A, studentName: "Тестовый Студент А", country: "Китай", direction: "Инженерия", curator: "Куратор Т.", currency: "USD", costMinor: 500000, paidMinor: 200000, debtMinor: 300000, hasOtherCurrencyPayments: true },
    { caseId: CASE_B, studentName: "Тестовый Студент Б", country: "Малайзия", direction: null, curator: null, currency: "KGS", costMinor: 100000, paidMinor: 40000, debtMinor: 60000, hasOtherCurrencyPayments: false }],
  totals: [{ currency: "KGS", costMinor: 100000, paidMinor: 40000, debtMinor: 60000, caseCount: 1 }, { currency: "USD", costMinor: 500000, paidMinor: 200000, debtMinor: 300000, caseCount: 1 }], caseRowCount: 2, truncated: false };
  const html = renderToStaticMarkup(createElement(StudentDebtsNext, { read: { status: "available", debts } }));
  assert.match(html, new RegExp(`href="/profile\\?case=${CASE_A}"`, "u"));
  assert.match(html, /data-testid="student-debts-totals"/u);
  assert.equal([...html.matchAll(/data-debt-other-currency=""/gu)].length, 2, "only the flagged row carries the hint (once in the table, once in its phone card)");
  assert.match(html, /есть оплаты в другой валюте/u);
  assert.match(html, /data-testid="student-debts-rule"[^>]*>Долг = стоимость договора минус оплачено\. Считаются только договорные взносы EVO/u, "the rule in plain Russian");
  assert.match(html, /3\s?000 USD/u);
  assert.match(html, /600 KGS/u);
  assert.doesNotMatch(html, /<th[^>]*>\s*Итого\b/u);
  const empty = renderToStaticMarkup(createElement(StudentDebtsNext, { read: { status: "available", debts: { rows: [], totals: [], caseRowCount: 0, truncated: false } } }));
  assert.match(empty, /Долгов нет\./u);
  assert.doesNotMatch(empty, /<table/u);
  assert.match(renderToStaticMarkup(createElement(StudentDebtsNext, { read: { status: "unavailable" } })), /Не удалось загрузить долги студентов/u);
  assert.match(renderToStaticMarkup(createElement(StudentDebtsNext, { read: { status: "denied" } })), /data-testid="v3-student-debts-denied"/u);
});

const saleRow = (over) => ({ id: "78000000-0000-4000-8000-000000000001", version: 1, reportMonth: "2026-09-01", signingDate: "2026-09-10", applicantName: "Тестовая Студентка", phone: "", country: "Китай",
  university: "Тестовый университет", program: "Тестовая программа", direction: "", intake: "Осень 2026", contractNumber: "", managerLabel: "Тестовый Менеджер А", statusRaw: "Оплачено частично",
  ownerMembershipId: null, serviceCostRaw: "", serviceCostMinor: 100000, serviceCostCurrency: "USD", paidRaw: "", paidMinor: 40000, paidCurrency: "USD", needsReview: false, notes: "", archived: false,
  sourceKey: null, sourceKind: "manual", leadId: null, clientId: null, sourceSha256: null, sourceSheet: null, sourceRow: null, updatedAt: "2026-09-10T00:00:00Z",
  paidContractMinor: null, paidContractCurrency: null, reviewReasons: [], importFlags: [], managerKey: "тестовый менеджер а", withdrawal: null, ...over });

test("the sales table carries the owner's columns as stored, the debt is cost - paid (never converted), and a row without data shows no invented number", () => {
  const ctx = { year: 2026, href: "/finance?tab=sales", manager: "Тестовый Менеджер А", showReportMonth: false, actionRequestId: null };
  const row = salesRowData(saleRow({}), ctx);
  assert.deepEqual([row.country, row.university, row.program, row.intake, row.status, row.manager], ["Китай", "Тестовый университет", "Тестовая программа", "Осень 2026", "Оплачено частично", "Тестовый Менеджер А"]);
  assert.equal(row.debtMinor, 60000);
  assert.match(row.remainder, /600 USD/u);
  const noCost = salesRowData(saleRow({ serviceCostMinor: null, serviceCostCurrency: null }), ctx);
  assert.equal(noCost.debtMinor, null, "no cost - no debt number");
  const other = salesRowData(saleRow({ paidCurrency: "KGS" }), ctx);
  assert.equal(other.debtMinor, null, "different currencies are never subtracted");
  const cells = read("src/components/staff/sales-next/SalesRecordCells.tsx");
  for (const header of ["ФИО студента", "Страна", "Стоимость", "Дата подписания", "Оплачено", "Долг", "Университет", "Программа", "Интейк", "Статус", "Менеджер"]) assert.match(cells, new RegExp(`"${header}"`, "u"), header);
  assert.match(cells, /text-danger/u, "a debt above zero is highlighted (and has the word «Долг» for a screen reader)");
});

test("the month summary: per salesperson the count and the sum per currency as stored, a total row, archived and withdrawn sales out, no conversion", () => {
  const name = (row) => row.managerLabel;
  const summary = salesManagerSummary([
    saleRow({ id: "1" }), saleRow({ id: "2", serviceCostMinor: 250000 }), saleRow({ id: "3", managerLabel: "Тестовый Менеджер Б", managerKey: "б", serviceCostCurrency: "KGS", serviceCostMinor: 90000 }),
    saleRow({ id: "4", archived: true }), saleRow({ id: "5", withdrawal: { kind: "unpaid", at: "2026-09-12T00:00:00Z", by: "x", note: null } }),
    saleRow({ id: "6", serviceCostMinor: null, serviceCostCurrency: null }),
  ], name);
  const plain = (list) => list.map((value) => value.replace(/\u00a0/gu, " "));
  assert.deepEqual(summary.managers.map((m) => [m.name, m.count, plain(m.sums), m.noCost]), [["Тестовый Менеджер А", 3, ["3 500 USD"], 1], ["Тестовый Менеджер Б", 1, ["900 KGS"], 0]]);
  assert.deepEqual([summary.total.count, plain(summary.total.sums), summary.total.noCost], [4, ["900 KGS", "3 500 USD"], 1], "currencies stay apart");
  assert.deepEqual(salesManagerSummary([], name).managers, []);
});

test("admissions staff with only lead.read never get «Финансы»; their «Динамика по дням» stays under «Сегодня» with its own links", () => {
  assert.equal(staffCanSalesTab(admissionsLead), false);
  assert.equal(staffCanFinanceTabHint(admissionsLead), false);
  assert.equal(staffCanAccessRoute(admissionsLead, "/finance"), false, "the route says «Нет доступа»");
  assert.equal(staffCanAccessRoute(admissionsLead, "/main"), true);
  assert.equal(staffCanSalesTab(admin), true);
  assert.equal(staffCanSalesTab(accountantWithRegister), true);
  assert.equal(staffCanSalesTab(salesperson), true);
  assert.deepEqual(salesDynamicsCarry({ year: "2026" }, "today"), { view: "sales", year: "2026" });
  assert.equal(salesDynamicsHref({}, { key: "week" }, "sales-dynamics", "today"), "/main?view=sales&period=week#sales-dynamics");
  assert.equal(salesDynamicsHref({}, { key: "week" }), "/finance?tab=sales&period=week#sales-dynamics");
});
