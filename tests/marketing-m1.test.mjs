// «Маркетинг» М1 (план 06.10.2026, миграции 263–265): маршрут и права, строгий разбор ответов, правила
// честных чисел, исправление и вывод «Откуда узнал». Данные — синтетические; ответ базы здесь —
// фикстура той же формы, что отдают `marketing_overview_v1` / `marketing_leads_v1` (форма сверяется с
// 265), сами RPC, их права и подсчёт проверяет supabase/tests/platform_marketing_m1.sql.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { fixedRoleCanAccessRoute, FIXED_ROLE_ROUTES } from "../src/lib/fixed-role-policy.ts";
import {
  LEAD_CHANNEL_KEYS, LEAD_CHANNELS, LEAD_CHANNEL_BASES, parseLeadChannelRead, leadChannelText,
} from "../src/lib/lead-channel-contract.ts";
import {
  marketingLeadFilterParams, parseMarketingLeadFilters, parseMarketingLeads, parseMarketingOverview, parseSpendCancelled, parseSpendSaved,
} from "../src/lib/marketing-contract.ts";
import {
  costPerLead, formatMinor, formatPerLead, marketingHref, marketingSignals, parseMarketingView, parseSpendAmount, shareText, shiftIsoDate, stageWord,
} from "../src/lib/marketing-view.ts";
import { isStaffPreview, staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Мини-загрузчик TS/TSX для отрисовки компонентов; границы сервера подменяются явно. */
function loader(overrides) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const code = ts.transpileModule(read(path), { fileName: path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const compiled = { exports: {} };
    cache.set(path, compiled);
    const resolveFile = (base) => [`${base}.ts`, `${base}.tsx`, base].find((file) => existsSync(new URL(`../${file}`, import.meta.url)) && /\.tsx?$/.test(file));
    new Function("require", "module", "exports", code)((id) => {
      if (id in overrides) return overrides[id];
      if (id === "server-only") return {};
      if (id.startsWith("@/")) return load(resolveFile(join("src", id.slice(2))) ?? assert.fail(id));
      if (id.startsWith(".")) return load(resolveFile(join(dirname(path), id)) ?? assert.fail(`${path}: ${id}`));
      return require(id);
    }, compiled, compiled.exports);
    return compiled.exports;
  }
  return load;
}

/** Сплошной красный (кнопка действия): фокус и наведение рамкой — не он. */
const RED_ACTION = /(?<![\w:-])bg-accent(?![\w-])/u;
const ORG = "10000000-0000-4000-8000-000000000001";
const FROM = "2026-09-01", TO = "2026-09-30";
const SPEND_ID = "20000000-0000-4000-8000-000000000001";
const LEAD = "30000000-0000-4000-8000-000000000001";
const OWNER = "40000000-0000-4000-8000-000000000001";

const channelRow = (channel, over = {}) => ({
  channel, leads: 0, qualified: 0, handed_off: 0, contract: 0, contract_linked: 0, paid: 0, paid_without_amount: 0,
  paid_amounts: [], ai_assistant: 0, basis: { utm: 0, referrer: 0, staff: 0, corrected: 0, unknown: 0 }, ...over,
});
const saleRow = (channel, over = {}) => ({ channel, contracts: 0, linked_manually: 0, amount_missing: 0, amounts: [], ...over });
const spendRow = (over = {}) => ({
  id: SPEND_ID, period_start: "2026-09-01", period_end: "2026-09-30", amount_minor: "120000", currency: "USD",
  campaign: "Лето", note: "ручной ввод", created_at: "2026-10-01T05:00:00.123456+00:00", ...over,
});
/** 23 заявки: 6 рекламой (4 по метке, 2 со слов), 5 с сайта, 12 неизвестных. */
function overviewJson(over = {}) {
  const channels = [
    channelRow("instagram_ads", { leads: 6, qualified: 4, handed_off: 2, contract: 2, contract_linked: 1, paid: 1, paid_amounts: [{ currency: "USD", amount_minor: "60000", leads: 1 }], basis: { utm: 4, referrer: 0, staff: 1, corrected: 1, unknown: 0 } }),
    channelRow("instagram"),
    channelRow("website_search", { leads: 5, qualified: 1, ai_assistant: 2, basis: { utm: 0, referrer: 5, staff: 0, corrected: 0, unknown: 0 } }),
    channelRow("referral"),
    channelRow("other"),
    channelRow("unknown", { leads: 12, qualified: 2, basis: { utm: 0, referrer: 0, staff: 0, corrected: 0, unknown: 12 } }),
  ];
  return {
    organization_id: ORG, from: FROM, to: TO, time_zone: "Asia/Bishkek",
    cohort: {
      total: 23, open_count: 20, source_keys: { website: 11, instagram: 12 }, repeat_submissions: 3,
      totals: { leads: 23, qualified: 7, handed_off: 2, contract: 2, contract_linked: 1, paid: 1, paid_without_amount: 0 },
      channels,
    },
    sales: {
      total: 3,
      channels: [saleRow("instagram_ads", { contracts: 2, linked_manually: 1, amounts: [{ currency: "USD", amount_minor: "250000", contracts: 2 }] }),
        saleRow("instagram"), saleRow("website_search"), saleRow("referral"), saleRow("other"), saleRow("unknown"),
        saleRow("without_lead", { contracts: 1, amount_missing: 1 })],
      reconciliation: { by_channel_plus_without_lead: 3, report_sales: 3, difference: 0, matches: true },
    },
    spend: { inside_period: [spendRow()], inside_totals: [{ currency: "USD", amount_minor: "120000" }], partially_overlapping: [] },
    ...over,
  };
}
const parseOverview = (json) => parseMarketingOverview(json, { organizationId: ORG, from: FROM, to: TO });
const clone = (value) => structuredClone(value);

function leadRow(over = {}) {
  return {
    lead_id: LEAD, name: "Тест Синтетический", phone: "+996555000000", created_at: "2026-09-20T05:30:00.5+00:00", source_key: "website",
    channel: "instagram_ads", basis: "utm", corrected: false, ai_assistant: false, campaign: "Лето", landing_path: "/guides/apu/",
    stage: "qualified", lifecycle_state: "open", contract_signed_on: "2026-09-25", contract_linked_manually: false,
    paid: { amount_minor: "60000", currency: "USD", source: "report" }, owner: { membership_id: OWNER, name: "Менеджер Синтетический" }, ...over,
  };
}
const leadsJson = (rows = [leadRow()], over = {}) => ({
  organization_id: ORG, from: FROM, to: TO, total: rows.length, has_more: false, next_cursor: null, rows, ...over,
});
const parseLeads = (json, limit = 50) => parseMarketingLeads(json, { organizationId: ORG, from: FROM, to: TO, limit });

/** Граница базы — клиент с запрограммированным ответом RPC; разбор и права — настоящий `marketing-source`. */
function marketingSource(handler) {
  const rpcs = [];
  const client = { schema: () => ({ rpc: async (name, args) => { rpcs.push([name, args]); return handler(name, args); } }) };
  const source = loader({ "../supabase/server.ts": { createSupabaseServerClient: async () => client } })("src/lib/v3/marketing-source.ts");
  return { ...source, rpcs };
}
const { canUseMarketing, requireMarketingAdmin, MarketingForbiddenError } = marketingSource(() => ({ data: null, error: null }));

const admin = { organizationId: ORG, systemRole: "admin", presentationRole: null, permissionKeys: [], platformAccessVersion: 1, assignments: [] };

/* ---------------------------------------------------------------- маршрут и права */

test("«Маркетинг» is a fixed-role route open to Admin authority only, like «База знаний»", () => {
  assert.ok(FIXED_ROLE_ROUTES.includes("/v3/marketing"));
  assert.equal(fixedRoleCanAccessRoute("admin", "/v3/marketing"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/marketing"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/marketing"), false);
  assert.equal(isConnectedPlatformPage("/v3/marketing"), true, "the staff proxy lets the page through");
  assert.equal(isConnectedPlatformPage("/v3/marketing/extra"), false);
});

test("the section opens only for the real Admin: role preview, sales, admissions and invited staff are refused", () => {
  assert.equal(staffCanAccessRoute(admin, "/v3/marketing"), true);
  assert.equal(canUseMarketing(admin), true);
  assert.doesNotThrow(() => requireMarketingAdmin(admin));
  for (const presentationRole of ["admin", "sales", "admissions"]) {
    const preview = { ...admin, presentationRole };
    assert.equal(isStaffPreview(preview), true);
    assert.equal(staffCanAccessRoute(preview, "/v3/marketing"), false, presentationRole);
    assert.throws(() => requireMarketingAdmin(preview), MarketingForbiddenError, presentationRole);
  }
  const keys = ["lead.read", "lead.sales.workflow.manage", "sales.register.read", "knowledge.read.approved", "admin.preview", "marketing.read"];
  for (const systemRole of ["sales", "admissions", null]) {
    const staff = { ...admin, systemRole, permissionKeys: keys };
    assert.equal(staffCanAccessRoute(staff, "/v3/marketing"), false, String(systemRole));
    assert.equal(canUseMarketing(staff), false);
  }
  const page = read("src/app/(v3)/v3/marketing/page.tsx");
  assert.match(page, /requireV3PageActor\("\/v3\/marketing"\);\s*requireMarketingAdmin\(actor\);/u);
  // Раздел — две вкладки, обычные ссылки; ни выгрузки, ни имён в адресе.
  assert.match(read("src/components/v3/marketing/MarketingNav.tsx"), /QueueViewTabs/u);
  assert.doesNotMatch(read("src/components/v3/marketing/MarketingLeadsTable.tsx"), /csv|download|Экспорт|Скачать/iu);
});

test("a refused role never reaches the database: denied, not an empty or zero read", async () => {
  const { readMarketingOverview, readMarketingLeads, addMarketingSpend, cancelMarketingSpend, rpcs } = marketingSource(() => assert.fail("no RPC for a refused role"));
  for (const actor of [{ ...admin, presentationRole: "sales" }, { ...admin, systemRole: "sales" }]) {
    assert.deepEqual(await readMarketingOverview(actor, { from: FROM, to: TO }), { status: "denied" });
    assert.deepEqual(await readMarketingLeads(actor, { from: FROM, to: TO }, parseMarketingLeadFilters({}), null), { status: "denied" });
    assert.equal((await addMarketingSpend(actor, { requestId: "50000000-0000-4000-8000-000000000001", periodStart: FROM, periodEnd: TO, amountMinor: 1, currency: "USD", campaign: null, note: null })).status, "forbidden");
    assert.equal((await cancelMarketingSpend(actor, { requestId: "50000000-0000-4000-8000-000000000001", spendId: SPEND_ID })).status, "forbidden");
  }
  assert.equal(rpcs.length, 0);
});

test("a failed or malformed read is «denied» or «unavailable» and carries no figure — never a zero", async () => {
  const cases = [
    [{ data: null, error: { code: "42501", message: "marketing_forbidden" } }, "denied"],
    [{ data: null, error: { code: "XX000", message: "boom" } }, "unavailable"],
    [{ data: null, error: null }, "unavailable"],
    [{ data: {}, error: null }, "unavailable"],
    [{ data: { ...overviewJson(), cohort: { ...overviewJson().cohort, total: "23" } }, error: null }, "unavailable"],
    [{ data: { ...overviewJson(), organization_id: "other" }, error: null }, "unavailable"],
  ];
  for (const [answer, status] of cases) {
    const { readMarketingOverview } = marketingSource(() => answer);
    const read = await readMarketingOverview(admin, { from: FROM, to: TO });
    assert.deepEqual(read, { status }, JSON.stringify(answer).slice(0, 60));
  }
  const thrown = marketingSource(() => { throw new Error("network"); });
  assert.deepEqual(await thrown.readMarketingOverview(admin, { from: FROM, to: TO }), { status: "unavailable" });
  assert.deepEqual(await thrown.readMarketingLeads(admin, { from: FROM, to: TO }, parseMarketingLeadFilters({}), null), { status: "unavailable" });
  const leadsDenied = marketingSource(() => ({ data: null, error: { code: "42501" } }));
  assert.deepEqual(await leadsDenied.readMarketingLeads(admin, { from: FROM, to: TO }, parseMarketingLeadFilters({}), null), { status: "denied" });
  assert.deepEqual(await marketingSource(() => ({ data: leadsJson([{ ...leadRow(), notes: "x" }]), error: null }))
    .readMarketingLeads(admin, { from: FROM, to: TO }, parseMarketingLeadFilters({}), null), { status: "unavailable" });
});

test("the real shape is read with the exact RPC arguments: period, filters by key, cursor pair, page of 50", async () => {
  const overview = marketingSource(() => ({ data: overviewJson(), error: null }));
  const read = await overview.readMarketingOverview(admin, { from: FROM, to: TO });
  assert.equal(read.status, "available");
  assert.equal(read.overview.cohort.total, 23);
  assert.deepEqual(overview.rpcs, [["marketing_overview_v1", { p_from: FROM, p_to: TO }]]);
  const second = "30000000-0000-4000-8000-000000000002";
  const leads = marketingSource(() => ({ data: leadsJson([leadRow({ lead_id: second })], { total: 80, has_more: true, next_cursor: { created_at: "2026-09-20T05:30:00.5+00:00", id: second } }), error: null }));
  const filters = parseMarketingLeadFilters({ channel: "unknown", stage: "closed", campaign: "Лето", contract: "no", unknown: "1", no_owner: "1" });
  const page = await leads.readMarketingLeads(admin, { from: FROM, to: TO }, filters, { createdAt: "2026-09-21T01:00:00.25+00:00", id: LEAD });
  assert.equal(page.status, "available");
  assert.deepEqual(leads.rpcs, [["marketing_leads_v1", {
    p_from: FROM, p_to: TO, p_channel: "unknown", p_campaign: "Лето", p_stage: "closed", p_has_contract: false, p_unknown_only: true,
    p_no_owner: true, p_cursor_created_at: "2026-09-21T01:00:00.25+00:00", p_cursor_id: LEAD, p_limit: 50,
  }]]);
  const recent = marketingSource(() => ({ data: overviewJson(), error: null }));
  assert.deepEqual(await recent.readMarketingRecent(admin, { from: FROM, to: TO }), { leads: 23, spendRows: 1 });
  assert.equal(await marketingSource(() => ({ data: null, error: { code: "XX000" } })).readMarketingRecent(admin, { from: FROM, to: TO }), null, "an unread recent period is null, not zero");
});

test("spend writes map database errors to words and accept only the answer to their own request", async () => {
  const rid = "50000000-0000-4000-8000-000000000001";
  const input = { requestId: rid, periodStart: FROM, periodEnd: TO, amountMinor: 120000, currency: "USD", campaign: null, note: null };
  const saved = { status: "saved", spend_id: SPEND_ID, request_id: rid, period_start: FROM, period_end: TO, amount_minor: "120000", currency: "USD", campaign: null, note: null, created_at: "2026-10-01T05:00:00+00:00" };
  const ok = marketingSource(() => ({ data: saved, error: null }));
  assert.equal((await ok.addMarketingSpend(admin, input)).status, "saved");
  assert.deepEqual(ok.rpcs[0], ["marketing_spend_add_v1", { p_request_id: rid, p_period_start: FROM, p_period_end: TO, p_amount_minor: 120000, p_currency: "USD", p_campaign: null, p_note: null }]);
  for (const [code, message, status] of [["42501", "x", "forbidden"], ["22023", "marketing_spend_invalid", "invalid"], ["22023", "marketing_spend_request_conflict", "request_conflict"], ["XX000", "x", "unavailable"]]) {
    assert.equal((await marketingSource(() => ({ data: null, error: { code, message } })).addMarketingSpend(admin, input)).status, status, code + message);
  }
  assert.equal((await marketingSource(() => ({ data: { ...saved, request_id: "50000000-0000-4000-8000-000000000002" }, error: null })).addMarketingSpend(admin, input)).status, "unavailable");
  const cancel = { requestId: rid, spendId: SPEND_ID };
  const done = { status: "cancelled", spend_id: SPEND_ID, cancel_id: "60000000-0000-4000-8000-000000000001", request_id: rid, created_at: "2026-10-01T05:00:00+00:00" };
  assert.equal((await marketingSource(() => ({ data: done, error: null })).cancelMarketingSpend(admin, cancel)).status, "cancelled");
  for (const [code, status] of [["P0002", "not_found"], ["PT409", "already_cancelled"], ["42501", "forbidden"], ["22023", "invalid"]]) {
    assert.equal((await marketingSource(() => ({ data: null, error: { code, message: "" } })).cancelMarketingSpend(admin, cancel)).status, status, code);
  }
});

/* ---------------------------------------------------------------- строгий разбор */

test("overview parsing accepts the real shape and keeps the numbers as read", () => {
  const overview = parseOverview(overviewJson());
  assert.ok(overview);
  assert.equal(overview.cohort.total, 23);
  assert.equal(overview.cohort.openCount, 20);
  assert.equal(overview.cohort.repeatSubmissions, 3);
  assert.deepEqual(overview.cohort.channels.map((row) => row.channel), [...LEAD_CHANNEL_KEYS]);
  assert.equal(overview.cohort.channels[0].paidAmounts[0].amountMinor, "60000");
  assert.equal(overview.sales.channels.at(-1).channel, "without_lead");
  assert.equal(overview.sales.reconciliation.matches, true);
  assert.equal(overview.spend.insidePeriod[0].campaign, "Лето");
  assert.ok(Object.isFrozen(overview));
});

test("overview parsing refuses any deviation instead of drawing a number", () => {
  const bad = (mutate, label) => { const json = clone(overviewJson()); mutate(json); assert.equal(parseOverview(json), null, label); };
  assert.equal(parseOverview(null), null);
  assert.equal(parseOverview([]), null);
  assert.equal(parseOverview("{}"), null);
  bad((j) => { delete j.cohort.repeat_submissions; }, "missing key");
  bad((j) => { j.cohort.extra = 1; }, "extra key");
  bad((j) => { j.cohort.total = "23"; }, "count as string");
  bad((j) => { j.cohort.total = -1; }, "negative count");
  bad((j) => { j.cohort.total = 23.5; }, "fractional count");
  bad((j) => { j.organization_id = "other"; }, "another organisation");
  bad((j) => { j.from = "2026-08-01"; }, "another period");
  bad((j) => { j.time_zone = "UTC"; }, "another time zone");
  bad((j) => { j.cohort.channels.pop(); }, "five channels");
  bad((j) => { j.cohort.channels.reverse(); }, "channel order");
  bad((j) => { j.cohort.channels[0].leads = 7; }, "channels do not add up to the total");
  bad((j) => { j.cohort.channels[0].handed_off = 5; }, "handed off more than qualified");
  bad((j) => { j.cohort.channels[0].paid_without_amount = 3; }, "paid without amount more than paid");
  bad((j) => { j.cohort.open_count = 24; }, "open more than all");
  bad((j) => { j.cohort.totals.leads = 22; }, "totals disagree");
  bad((j) => { j.cohort.source_keys.website = 99; }, "source keys disagree");
  bad((j) => { j.cohort.channels[0].paid_amounts[0].amount_minor = 600; }, "money as number");
  bad((j) => { j.cohort.channels[0].paid_amounts[0].currency = "usd"; }, "currency shape");
  bad((j) => { j.sales.channels.pop(); }, "six sales rows");
  bad((j) => { j.sales.reconciliation.matches = false; }, "matches contradicts the difference");
  bad((j) => { j.sales.reconciliation.difference = 1; }, "difference contradicts the sums");
  bad((j) => { j.sales.reconciliation.report_sales = 4; j.sales.reconciliation.difference = -1; j.sales.reconciliation.matches = false; j.sales.total = 4; }, "total disagrees with rows");
  bad((j) => { j.spend.inside_period[0].amount_minor = "0"; }, "zero spend row");
  bad((j) => { j.spend.inside_period[0].period_start = "2026-10-02"; }, "reversed spend period");
  bad((j) => { delete j.spend.partially_overlapping; }, "spend list missing");
});

test("a visible reconciliation mismatch is a valid read, shown rather than hidden", () => {
  const json = overviewJson();
  json.sales.reconciliation = { by_channel_plus_without_lead: 3, report_sales: 5, difference: -2, matches: false };
  const overview = parseOverview(json);
  assert.equal(overview.sales.reconciliation.difference, -2);
  assert.equal(overview.sales.reconciliation.matches, false);
});

test("leads page parsing: exactly the seventeen keys, cursor consistent with has_more, nothing guessed", () => {
  assert.equal(Object.keys(leadRow()).length, 17);
  const page = parseLeads(leadsJson());
  assert.ok(page);
  assert.equal(page.rows[0].name, "Тест Синтетический");
  assert.equal(page.rows[0].paid.amountMinor, "60000");
  assert.equal(page.nextCursor, null);
  const second = "30000000-0000-4000-8000-000000000002";
  const withMore = parseLeads(leadsJson([leadRow({ lead_id: second })], { total: 80, has_more: true, next_cursor: { created_at: "2026-09-20T05:30:00.5+00:00", id: second } }));
  assert.deepEqual(withMore.nextCursor, { createdAt: "2026-09-20T05:30:00.5+00:00", id: second });
  const bad = (json, label, limit) => assert.equal(parseLeads(json, limit), null, label);
  bad(leadsJson([{ ...leadRow(), email: "x@y.example" }]), "an extra key (e.g. email, notes) is refused");
  bad(leadsJson([{ ...leadRow(), phone: undefined }]), "missing key");
  bad(leadsJson([leadRow({ channel: "facebook" })]), "unknown channel");
  bad(leadsJson([leadRow({ basis: "guess" })]), "unknown basis");
  bad(leadsJson([leadRow({ corrected: true })]), "corrected contradicts the basis");
  bad(leadsJson([leadRow({ stage: "won" })]), "unknown stage");
  bad(leadsJson([leadRow({ lifecycle_state: "deleted" })]), "unknown lifecycle");
  bad(leadsJson([leadRow({ contract_signed_on: "2026-02-30" })]), "impossible date");
  bad(leadsJson([leadRow({ contract_linked_manually: true, contract_signed_on: null })]), "linked without a contract");
  bad(leadsJson([leadRow({ paid: { amount_minor: 600, currency: "USD", source: "case" } })]), "money as number");
  bad(leadsJson([leadRow({ paid: { amount_minor: "1", currency: "USD", source: "card" } })]), "unknown payment source");
  bad(leadsJson([leadRow({ owner: { membership_id: "x", name: "A" } })]), "owner id shape");
  bad(leadsJson([leadRow({ created_at: "yesterday" })]), "timestamp");
  bad(leadsJson([leadRow()], { has_more: true }), "has_more without a cursor");
  bad(leadsJson([leadRow()], { next_cursor: { created_at: "2026-09-20T05:30:00+00:00", id: LEAD } }), "cursor without has_more");
  bad(leadsJson([leadRow()], { has_more: true, next_cursor: { created_at: "2026-09-20T05:30:00+00:00", id: second } }), "cursor is not the last shown row");
  bad(leadsJson([leadRow(), leadRow()], { total: 2 }), "more rows than the limit", 1);
  bad(leadsJson([leadRow(), leadRow()], { total: 1 }), "more rows than the total");
  bad(leadsJson([], { organization_id: "other" }), "another organisation");
  // Пустая, но прочитанная страница — это «0 заявок», а не сбой.
  assert.equal(parseLeads(leadsJson([]))?.total, 0);
});

test("paid may omit its amount (confirmed by hand) and a lead may have no name, phone or owner", () => {
  const row = leadRow({ name: null, phone: null, owner: null, paid: { amount_minor: null, currency: null, source: "gate" }, contract_signed_on: null, campaign: null, landing_path: null });
  const [parsed] = parseLeads(leadsJson([row])).rows;
  assert.equal(parsed.name, null);
  assert.equal(parsed.owner, null);
  assert.deepEqual(parsed.paid, { amountMinor: null, currency: null, source: "gate" });
});

test("spend answers are parsed against the request they answer", () => {
  const rid = "50000000-0000-4000-8000-000000000001";
  const saved = { status: "saved", spend_id: SPEND_ID, request_id: rid, period_start: "2026-09-01", period_end: "2026-09-30", amount_minor: "120000", currency: "USD", campaign: null, note: null, created_at: "2026-10-01T05:00:00+00:00" };
  assert.equal(parseSpendSaved(saved, rid)?.id, SPEND_ID);
  assert.equal(parseSpendSaved(saved, "50000000-0000-4000-8000-000000000002"), null);
  assert.equal(parseSpendSaved({ ...saved, status: "other" }, rid), null);
  const cancelled = { status: "cancelled", spend_id: SPEND_ID, cancel_id: "60000000-0000-4000-8000-000000000001", request_id: rid, created_at: "2026-10-01T05:00:00+00:00" };
  assert.equal(parseSpendCancelled(cancelled, rid, SPEND_ID), true);
  assert.equal(parseSpendCancelled(cancelled, rid, "20000000-0000-4000-8000-000000000009"), false);
  assert.equal(parseSpendCancelled({ ...cancelled, extra: 1 }, rid, SPEND_ID), false);
});

test("the lead-channel read is exactly {channel, basis, corrected, at} and corrected means the «исправлено» basis", () => {
  assert.deepEqual(parseLeadChannelRead({ channel: "instagram_ads", basis: "utm", corrected: false, at: "2026-09-20T05:30:00+00:00" }),
    { channel: "instagram_ads", basis: "utm", corrected: false, at: "2026-09-20T05:30:00+00:00" });
  assert.equal(parseLeadChannelRead({ channel: "unknown", basis: "unknown", corrected: false, at: null })?.at, null);
  for (const bad of [null, [], {}, { channel: "unknown", basis: "unknown", corrected: false },
    { channel: "unknown", basis: "unknown", corrected: false, at: null, utm_source: "x" },
    { channel: "other", basis: "corrected", corrected: false, at: null }, { channel: "other", basis: "utm", corrected: true, at: null },
    { channel: "facebook", basis: "utm", corrected: false, at: null }, { channel: "other", basis: "utm", corrected: false, at: "now" }]) {
    assert.equal(parseLeadChannelRead(bad), null, JSON.stringify(bad));
  }
  assert.equal(leadChannelText({ channel: "instagram_ads", basis: "utm" }), "Instagram — реклама · по метке");
  assert.deepEqual(Object.values(LEAD_CHANNEL_BASES), ["по метке", "по ссылке", "со слов клиента", "исправлено", "не известно"]);
});

/* ---------------------------------------------------------------- честные числа */

test("honest numbers: «N из M», a percentage only from ten, «—» for an empty denominator", () => {
  assert.equal(shareText(7, 23), "7 из 23 · 30 %");
  assert.equal(shareText(3, 9), "3 из 9");
  assert.equal(shareText(1, 10), "1 из 10 · 10 %");
  assert.equal(shareText(0, 0), "—");
  assert.equal(shareText(0, 12), "0 из 12 · 0 %");
  assert.equal(formatMinor("120000", "USD"), "1 200 USD");
  assert.equal(formatMinor("120050", "KGS"), "1 200,50 KGS");
  assert.equal(formatMinor("5", "EUR"), "0,05 EUR");
  assert.equal(formatMinor("9007199254740993123", "USD").endsWith("USD"), true, "no precision loss on large amounts");
  assert.equal(formatPerLead(1500.4, "USD"), "15 USD");
  assert.equal(parseSpendAmount("1200"), 120000);
  assert.equal(parseSpendAmount("1 200,5"), 120050);
  assert.equal(parseSpendAmount("0,05"), 5);
  for (const bad of ["", "0", "0,00", "-5", "1,234", "abc", "1e3", "10000000000", "1.2.3"]) assert.equal(parseSpendAmount(bad), null, bad);
});

test("cost per lead: three levels, one currency, never a divided zero", () => {
  const overview = parseOverview(overviewJson());
  const cost = costPerLead(overview);
  assert.equal(cost.status, "single");
  assert.equal(cost.currency, "USD");
  assert.deepEqual(cost.levels.map((level) => [level.key, level.leads, level.perLeadMinor]), [
    ["tagged", 4, 30000], ["by_word", 6, 20000], ["with_unknown", 18, 120000 / 18],
  ]);
  // Нет заявок рекламы — знаменатель 0, «—», а не деление на ноль.
  const noAds = overviewJson();
  noAds.cohort.channels[0] = channelRow("instagram_ads");
  noAds.cohort.channels[2].leads = 11; noAds.cohort.channels[2].basis.referrer = 11;
  const empty = costPerLead(parseOverview(noAds));
  assert.deepEqual(empty.levels.map((level) => [level.leads, level.perLeadMinor]), [[0, null], [0, null], [12, 10000]]);
  // Расход в двух валютах: цена не считается, суммы не складываются.
  const mixed = overviewJson();
  mixed.spend.inside_totals = [{ currency: "KGS", amount_minor: "500000" }, { currency: "USD", amount_minor: "120000" }];
  assert.deepEqual(costPerLead(parseOverview(mixed)), { status: "mixed_currencies", currencies: ["KGS", "USD"] });
  // Нет расхода — нет цены; частично пересекающийся расход в цену не входит.
  const none = overviewJson();
  none.spend = { inside_period: [], inside_totals: [], partially_overlapping: [spendRow({ period_start: "2026-08-20" })] };
  assert.deepEqual(costPerLead(parseOverview(none)), { status: "no_spend" });
});

test("signals: only «spend and no leads for 3 days» and «unknown above 40% of 10+ leads»", () => {
  const overview = parseOverview(overviewJson());
  // 12 из 23 — больше 40 %, заявок хватает: сигнал есть.
  assert.deepEqual(marketingSignals(overview, { leads: 4, spendRows: 1 }).map((s) => s.key), ["unknown_share"]);
  assert.deepEqual(marketingSignals(overview, { leads: 0, spendRows: 1 }).map((s) => s.key), ["spend_without_leads", "unknown_share"]);
  // Узкий период не прочитан — сигнала «заявок нет» нет (не ноль).
  assert.deepEqual(marketingSignals(overview, null).map((s) => s.key), ["unknown_share"]);
  assert.deepEqual(marketingSignals(overview, { leads: 0, spendRows: 0 }).map((s) => s.key), ["unknown_share"], "no spend, no signal");
  const few = overviewJson();
  few.cohort.total = 9; few.cohort.open_count = 9; few.cohort.source_keys = { website: 9 }; few.cohort.totals.leads = 9;
  few.cohort.channels = few.cohort.channels.map((row) => channelRow(row.channel));
  few.cohort.channels[5] = channelRow("unknown", { leads: 9, basis: { utm: 0, referrer: 0, staff: 0, corrected: 0, unknown: 9 } });
  assert.deepEqual(marketingSignals(parseOverview(few), { leads: 1, spendRows: 1 }), [], "nine leads: counts only, no share signal");
  const edge = overviewJson();
  edge.cohort.channels[5].leads = 12; // 12 из 30 = ровно 40 % — не больше
  edge.cohort.total = 30; edge.cohort.totals.leads = 30; edge.cohort.channels[1] = channelRow("instagram", { leads: 7 });
  edge.cohort.source_keys = { website: 30 };
  assert.deepEqual(marketingSignals(parseOverview(edge), { leads: 1, spendRows: 1 }), []);
});

test("addresses carry period and filter keys only: no names, phones or cursor", () => {
  assert.equal(marketingHref({ view: "overview", period: { key: "month" } }), "/v3/marketing");
  assert.equal(marketingHref({ view: "leads", period: { key: "week" } }), "/v3/marketing?view=leads&period=week");
  const filters = parseMarketingLeadFilters({ channel: "unknown", stage: "closed", campaign: "Лето", contract: "yes", unknown: "1", no_owner: "1" });
  assert.deepEqual(marketingLeadFilterParams(filters), { channel: "unknown", campaign: "Лето", stage: "closed", contract: "yes", unknown: "1", no_owner: "1" });
  const href = marketingHref({ view: "leads", period: { key: "custom", from: FROM, to: TO }, filters });
  assert.match(href, /^\/v3\/marketing\?view=leads&period=custom&from=2026-09-01&to=2026-09-30&/u);
  assert.doesNotMatch(href, /cursor|name|phone|lead_id|%2B|\+996/u);
  // Неизвестное значение фильтра — «нет фильтра», а не расширение запроса.
  assert.deepEqual(parseMarketingLeadFilters({ channel: "facebook", stage: "won", campaign: "x".repeat(101), contract: "maybe" }),
    { channel: null, campaign: null, stage: null, hasContract: null, unknownOnly: false, noOwner: false });
  assert.equal(parseMarketingView("leads"), "leads");
  assert.equal(parseMarketingView("instagram"), "overview");
  assert.equal(shiftIsoDate("2026-03-01", -2), "2026-02-27");
  assert.equal(stageWord("closed", "disqualified", {}), "Отказ");
  assert.equal(stageWord("closed", "archived", {}), "В архиве");
  assert.equal(stageWord("qualified", "open", { qualified: "Квалифицирован" }), "Квалифицирован");
});

/* ---------------------------------------------------------------- вывод и действия */

test("the overview draws two titled blocks, the unknown line, reconciliation and honest cells", () => {
  const load = loader({ "./MarketingSpendPanel": { MarketingSpendPanel: () => createElement("div", { "data-stub": "spend-panel" }) } });
  const { MarketingOverviewView } = load("src/components/v3/marketing/MarketingOverviewView.tsx");
  const html = renderToStaticMarkup(createElement(MarketingOverviewView, {
    read: { status: "available", overview: parseOverview(overviewJson()) }, recent: { leads: 0, spendRows: 1 },
    period: { from: FROM, to: TO }, retryHref: "/v3/marketing",
  }));
  assert.match(html, /Заявки периода — что с ними стало на сегодня/u);
  assert.match(html, /Продажи периода — по дате договора/u);
  assert.match(html, /Источник не известен — <span class="tabular-nums">12 из 23 · 52\u00a0%<\/span>/u);
  assert.match(html, /из них открыты <span[^>]*data-marketing-open="20"[^>]*>20<\/span>/u);
  assert.match(html, /Повторные обращения: <span class="tabular-nums">3<\/span>/u);
  assert.match(html, /Без привязки к лиду/u);
  assert.match(html, /data-testid="marketing-reconciliation" data-matches="true"/u);
  assert.match(html, /Совпадает\./u);
  // Строка канала без заявок: проценты не рисуются, доли «—».
  assert.match(html, /data-channel="referral"[\s\S]*?<td[^>]*>0<\/td><td[^>]*>—<\/td><td[^>]*>—<\/td><td[^>]*>—<\/td><td[^>]*>—<\/td>/u);
  assert.match(html, /Instagram — реклама/u);
  assert.match(html, /по метке 4 · со слов клиента 1 · исправлено 1/u);
  assert.match(html, /ИИ-ассистент 2/u);
  assert.match(html, /data-testid="marketing-signals"/u);
  assert.match(html, /data-cost-level="tagged"[^>]*>[\s\S]*?300 USD[\s\S]*?на 4 лида/u);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/u);
  assert.doesNotMatch(html, RED_ACTION, "no red action on the page");
  assert.match(html, /<span class="block t-body-compact text-fg">2\u00a0500\u00a0USD<span class="text-fg-2"> · 2 договора<\/span>/u, "sales amounts read as figures, not as captions");
});

test("a mismatch with «Продажи» is shown as a number, never merged away", () => {
  const load = loader({ "./MarketingSpendPanel": { MarketingSpendPanel: () => null } });
  const { MarketingOverviewView } = load("src/components/v3/marketing/MarketingOverviewView.tsx");
  const json = overviewJson();
  json.sales.reconciliation = { by_channel_plus_without_lead: 3, report_sales: 5, difference: -2, matches: false };
  const html = renderToStaticMarkup(createElement(MarketingOverviewView, {
    read: { status: "available", overview: parseOverview(json) }, recent: null, period: { from: FROM, to: TO }, retryHref: "/v3/marketing",
  }));
  assert.match(html, /data-matches="false"/u);
  assert.match(html, /Расхождение: -2\./u);
  assert.match(html, /«Продажи» в отчёте — <span class="tabular-nums">5<\/span>/u);
});

test("unavailable and denied overviews say so in words and draw no figure", () => {
  const load = loader({ "./MarketingSpendPanel": { MarketingSpendPanel: () => null } });
  const { MarketingOverviewView } = load("src/components/v3/marketing/MarketingOverviewView.tsx");
  const unavailable = renderToStaticMarkup(createElement(MarketingOverviewView, { read: { status: "unavailable" }, recent: null, period: { from: FROM, to: TO }, retryHref: "/v3/marketing?period=week" }));
  assert.match(unavailable, /Не удалось загрузить обзор маркетинга/u);
  assert.match(unavailable, /href="\/v3\/marketing\?period=week"[^>]*>Повторить/u);
  assert.doesNotMatch(unavailable, /tabular-nums|из \d/u);
  const denied = renderToStaticMarkup(createElement(MarketingOverviewView, { read: { status: "denied" }, recent: null, period: { from: FROM, to: TO }, retryHref: "/v3/marketing" }));
  assert.match(denied, /только администратору/u);
  assert.doesNotMatch(denied, /tabular-nums/u);
});

test("the leads table shows the plan columns, links the name to Lead 360 and never prints raw marks", () => {
  const load = loader({
    "next/link": { __esModule: true, default: ({ href, children, ...rest }) => createElement("a", { href, ...rest }, children) },
    "@/lib/platform-marketing-actions": { loadMoreMarketingLeadsAction: async () => ({ status: "unavailable" }) },
  });
  const { MarketingLeadsTable } = load("src/components/v3/marketing/MarketingLeadsTable.tsx");
  const second = "30000000-0000-4000-8000-000000000002";
  const page = parseLeads(leadsJson([
    leadRow(),
    leadRow({ lead_id: second, name: null, source_key: "whatsapp_manual", channel: "unknown", basis: "unknown", campaign: null, landing_path: null, stage: "closed", lifecycle_state: "disqualified",
      contract_signed_on: null, paid: null, owner: null }),
  ], { total: 80, has_more: true, next_cursor: { created_at: "2026-09-20T05:30:00.5+00:00", id: second } }));
  const html = renderToStaticMarkup(createElement(MarketingLeadsTable, { initial: page, request: { from: FROM, to: TO, filters: parseMarketingLeadFilters({}) } }));
  for (const head of ["Имя", "Телефон", "Пришёл", "Канал связи", "Откуда узнал", "Кампания", "Страница входа", "Этап", "Договор", "Оплата", "Ответственный"]) {
    assert.match(html, new RegExp(`<th scope="col"[^>]*>${head}</th>`, "u"), head);
  }
  assert.match(html, new RegExp(`href="/v3/profile\\?id=${LEAD}"[^>]*>Тест Синтетический</a>`, "u"));
  assert.match(html, /Instagram — реклама · по метке/u);
  assert.match(html, /Лид без имени/u);
  assert.match(html, /Отказ/u);
  assert.match(html, /WhatsApp/u);
  assert.doesNotMatch(html, /WhatsApp \(вручную\)/u, "manual and automatic WhatsApp share one word");
  assert.match(html, /не назначен/u);
  assert.match(html, /\/guides\/apu\//u);
  assert.match(html, /600 USD/u);
  assert.match(html, /по записи отчёта/u);
  assert.match(html, /Заявок по фильтрам: <span class="tabular-nums">80<\/span> · показано <span class="tabular-nums">2<\/span>/u);
  assert.match(html, />Показать ещё</u);
  assert.doesNotMatch(html, /\.csv|Экспорт|Скачать/u);
});

test("«Откуда узнал» in Lead 360: label and basis from the read, a quiet correction for those who may edit", () => {
  const load = loader({
    "@/lib/platform-lead-channel-actions": { correctLeadChannelAction: async () => ({ status: "unavailable" }) },
  });
  const { LeadChannelCorrection } = load("src/components/v3/profile/LeadChannelCorrection.tsx");
  const html = renderToStaticMarkup(createElement(LeadChannelCorrection, { leadId: LEAD, requestId: "70000000-0000-4000-8000-000000000001", current: "unknown" }));
  const options = [...html.matchAll(/<option value="([a-z_]+)"[^>]*>([^<]+)<\/option>/gu)].map((m) => [m[1], m[2]]);
  assert.deepEqual(options, Object.entries(LEAD_CHANNELS));
  assert.match(html, /<option value="unknown" selected="">Не известно<\/option>/u);
  assert.match(html, /name="lead_id" value="30000000-0000-4000-8000-000000000001"/u);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Сохранить<\/button>/u, "saving waits for a different choice");
  assert.doesNotMatch(html, RED_ACTION, "no red button in the lead card");
  const lead = read("src/components/v3/profile/LeadWorkParts.tsx");
  assert.match(lead, /<Fact term="Откуда узнал">\{input\.channel\}<\/Fact>/u);
  const fact = read("src/components/v3/profile/LeadChannelFact.tsx");
  assert.match(fact, /readLeadChannel\(actor, leadId\)/u);
  assert.match(fact, /!isStaffPreview\(actor\) && staffHasPermission\(actor, "lead\.sales\.workflow\.manage"\)/u);
});

test("spend actions validate on the server and refuse role preview; the minor amount is exact", async () => {
  const added = [], cancelled = [];
  let preview = false;
  const load = loader({
    "next/cache": { revalidatePath() {} },
    "./platform-guards": { requirePlatformStaffActor: async () => ({ organizationId: ORG }) },
    "./v3/marketing-source": {
      canUseMarketing: () => !preview,
      addMarketingSpend: async (_actor, input) => { added.push(input); return { status: "saved" }; },
      cancelMarketingSpend: async (_actor, input) => { cancelled.push(input); return { status: "cancelled" }; },
      readMarketingLeads: async () => ({ status: "unavailable" }),
    },
  });
  const actions = load("src/lib/platform-marketing-actions.ts");
  const rid = "50000000-0000-4000-8000-000000000001";
  const form = (over = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ request_id: rid, period_start: "2026-09-01", period_end: "2026-09-30", amount: "1 200,5", currency: "USD", campaign: " Лето ", note: "", ...over })) data.set(key, value);
    return data;
  };
  const idle = { status: "idle", requestId: rid };
  assert.deepEqual(await actions.addMarketingSpendAction(idle, form()), { status: "saved", requestId: rid });
  assert.deepEqual(added, [{ requestId: rid, periodStart: "2026-09-01", periodEnd: "2026-09-30", amountMinor: 120050, currency: "USD", campaign: "Лето", note: null }]);
  for (const bad of [{ amount: "0" }, { amount: "1,234" }, { currency: "GBP" }, { currency: "usd" }, { period_start: "2026-10-01" }, { period_start: "2026-02-30" },
    { period_start: "2025-01-01", period_end: "2026-09-30" }, { campaign: "x".repeat(101) }, { note: "y".repeat(501) }, { campaign: "a\u0000b" }, { request_id: "nope" }]) {
    assert.equal((await actions.addMarketingSpendAction(idle, form(bad))).status, "invalid", JSON.stringify(bad));
  }
  assert.equal(added.length, 1, "nothing invalid reaches the database");
  const cancel = (over = {}) => { const data = new FormData(); data.set("request_id", rid); data.set("spend_id", SPEND_ID); for (const [k, v] of Object.entries(over)) data.set(k, v); return data; };
  assert.equal((await actions.cancelMarketingSpendAction({ status: "idle", requestId: rid }, cancel())).status, "cancelled");
  assert.deepEqual(cancelled, [{ requestId: rid, spendId: SPEND_ID }]);
  assert.equal((await actions.cancelMarketingSpendAction({ status: "idle", requestId: rid }, cancel({ spend_id: "x" }))).status, "invalid");
  preview = true;
  assert.equal((await actions.addMarketingSpendAction(idle, form())).status, "forbidden");
  assert.equal((await actions.cancelMarketingSpendAction({ status: "idle", requestId: rid }, cancel())).status, "forbidden");
  assert.deepEqual(await actions.loadMoreMarketingLeadsAction({ from: FROM, to: TO, channel: null, campaign: null, stage: null, hasContract: null, unknownOnly: false, noOwner: false, cursor: { createdAt: "2026-09-20T05:30:00+00:00", id: LEAD } }), { status: "denied" });
  assert.equal(added.length, 1);
  assert.equal(cancelled.length, 1);
});

test("«Показать ещё» re-validates its input: odd periods, filters and cursors never reach the read", async () => {
  const reads = [];
  const load = loader({
    "next/cache": { revalidatePath() {} },
    "./platform-guards": { requirePlatformStaffActor: async () => ({ organizationId: ORG }) },
    "./v3/marketing-source": { canUseMarketing: () => true, readMarketingLeads: async (...args) => { reads.push(args); return { status: "unavailable" }; } },
  });
  const { loadMoreMarketingLeadsAction } = load("src/lib/platform-marketing-actions.ts");
  const good = { from: FROM, to: TO, channel: "unknown", campaign: null, stage: "closed", hasContract: false, unknownOnly: true, noOwner: false, cursor: { createdAt: "2026-09-20T05:30:00.5+00:00", id: LEAD } };
  await loadMoreMarketingLeadsAction(good);
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].slice(1), [{ from: FROM, to: TO }, { channel: "unknown", campaign: null, stage: "closed", hasContract: false, unknownOnly: true, noOwner: false }, { createdAt: "2026-09-20T05:30:00.5+00:00", id: LEAD }]);
  for (const bad of [{ from: "2020-01-01" }, { to: "2026-02-30" }, { from: "2026-10-01", to: "2026-09-01" }, { channel: "facebook" }, { stage: "won" },
    { cursor: { createdAt: "yesterday", id: LEAD } }, { cursor: { createdAt: "2026-09-20T05:30:00+00:00", id: "x" } }, { campaign: "z".repeat(101) }, { unknownOnly: "1" }]) {
    assert.deepEqual(await loadMoreMarketingLeadsAction({ ...good, ...bad }), { status: "unavailable" }, JSON.stringify(bad));
  }
  assert.equal(reads.length, 1, "invalid input never reaches the read");
});
