import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decimalToMinor, financeDateTime, financeLocalDate, financeMoney, readAuthorizedMonthlyPaymentSummary } from "../src/lib/platform-finance-entry-contract.ts";

test("money parser uses integer minor units and rejects ambiguous amounts", () => {
  assert.equal(decimalToMinor("1,01"), "101");
  assert.equal(decimalToMinor("90071992547409.91"), "9007199254740991");
  for (const value of ["0", "-1", "NaN", "1e3", "1.001", "1,000.00", "90071992547409.92"]) assert.equal(decimalToMinor(value), null);
  assert.equal(financeMoney("-101", "USD"), "−1,01 USD");
});
test("business datetime is explicit Bishkek wall-clock and rejects invalid dates", () => {
  assert.equal(financeDateTime("2026-09-10T12:30"), "2026-09-10T06:30:00.000Z");
  for (const value of ["2026-02-30T12:00", "2026-09-10T24:00", "2026-09-10T12:60", "2026-09-10", "2026-09-10T12:30Z"]) assert.equal(financeDateTime(value), null);
});
test("manual intake uses canonical helpers, immutable receipts, fresh authority and contact stop", () => {
  const sql = readFileSync(new URL("../supabase/migrations/143_platform_manual_sales_intake.sql", import.meta.url), "utf8");
  assert.match(sql, /platform\.current_actor_authority\(\)/);
  assert.match(sql, /platform_private\.create_or_link_client/);
  assert.match(sql, /platform_private\.create_or_link_lead/);
  assert.match(sql, /receipt\.payload<>payload/);
  assert.match(sql, /manual_lead_receipts FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /manual_lead_receipts_append_only/);
  assert.match(sql, /'status','duplicate'/);
  assert.doesNotMatch(sql, /INSERT INTO platform_private\.sales_register|INSERT INTO auth\.users/);
});
test("finance reads preserve case gate; monthly summary uses real dated events", () => {
  const sql = readFileSync(new URL("../supabase/migrations/144_platform_finance_entry_and_report.sql", import.meta.url), "utf8");
  assert.match(sql, /platform\.staff_case_finance_control\(p_student_case_id,20\)/);
  assert.match(sql, /private\.platform_can_read_finance_full/);
  assert.match(sql, /e\.occurred_at>=starts AND e\.occurred_at<ends/);
  assert.match(sql, /AT TIME ZONE 'Asia\/Bishkek'/);
  assert.match(sql, /payments-refunds/);
  assert.ok(sql.indexOf("p_manager_label IS NULL OR") < sql.indexOf("LIMIT 50 OFFSET p_offset"));
  assert.ok(sql.indexOf("p_needs_review IS NULL OR") < sql.indexOf("LIMIT 50 OFFSET p_offset"));
});
test("entry adapter writes through original ledger commands, never report paid", () => {
  const source = readFileSync(new URL("../src/lib/v3/finance-entry-source.ts", import.meta.url), "utf8");
  assert.match(source, /"create_payment_obligation" : "record_payment_event"/);
  assert.doesNotMatch(source, /manage_sales_register|\.insert\(/);
  for (const file of ["ManualLeadForm.tsx", "profile/FinanceEntryForms.tsx"]) {
    const form = readFileSync(new URL(`../src/components/v3/${file}`, import.meta.url), "utf8");
    assert.match(form, /frozen\.current \?\? form/);
    assert.match(form, /result\.status !== "unavailable"/);
    assert.match(form, /currentRequestId === state\.requestId/);
  }
});

const organizationId = "00000000-0000-4000-8000-000000000001";
const allowed = { schemaVersion: 1, organizationId, canReadSummary: true };
const summary = { organization_id: organizationId, year: 2026, month: 9,
  totals: [{ currency: "USD", payments_minor: "50000", refunds_minor: "10000", net_minor: "40000", event_count: "2" }] };

test("monthly cash coordinator reads totals only after live organization access", async () => {
  const calls = [];
  const result = await readAuthorizedMonthlyPaymentSummary(organizationId, 2026, 9, {
    readAccess: async () => { calls.push("access"); return allowed; },
    readTotals: async () => { calls.push("totals"); return summary; },
  });
  assert.deepEqual(calls, ["access", "totals"]);
  assert.deepEqual(result, { status: "ready", totals: [{ currency: "USD", paymentsMinor: "50000", refundsMinor: "10000", netMinor: "40000", eventCount: "2" }] });
});

test("scoped finance without organization access is not an empty monthly report", async () => {
  let totalReads = 0;
  const result = await readAuthorizedMonthlyPaymentSummary(organizationId, 2026, 9, {
    readAccess: async () => ({ ...allowed, canReadSummary: false }),
    readTotals: async () => { totalReads += 1; return summary; },
  });
  assert.deepEqual(result, { status: "not_allowed" });
  assert.equal(totalReads, 0);
});

test("monthly cash coordinator rejects mismatched access and does not mask allowed read errors", async () => {
  let totalReads = 0;
  for (const access of [null, { ...allowed, schemaVersion: 2 }, { ...allowed, organizationId: "00000000-0000-4000-8000-000000000002" },
    { ...allowed, canReadSummary: "true" }, { ...allowed, extra: true }]) {
    await assert.rejects(readAuthorizedMonthlyPaymentSummary(organizationId, 2026, 9, {
      readAccess: async () => access,
      readTotals: async () => { totalReads += 1; return summary; },
    }), /Finance entry is unavailable/);
  }
  assert.equal(totalReads, 0);
  for (const failed of ["access", "totals"]) {
    const error = new Error("reader unavailable");
    await assert.rejects(readAuthorizedMonthlyPaymentSummary(organizationId, 2026, 9, {
      readAccess: async () => { if (failed === "access") throw error; return allowed; },
      readTotals: async () => { throw error; },
    }), value => value === error);
  }
});

test("monthly cash validates the period before invoking readers and accepts true empty totals", async () => {
  let reads = 0;
  for (const [year, month] of [[2026, 0], [2026, 13], [1899, 1], [2026.5, 1]]) {
    await assert.rejects(readAuthorizedMonthlyPaymentSummary(organizationId, year, month, {
      readAccess: async () => { reads += 1; return allowed; }, readTotals: async () => summary,
    }));
  }
  assert.equal(reads, 0);
  assert.deepEqual(await readAuthorizedMonthlyPaymentSummary(organizationId, 2026, 9, {
    readAccess: async () => allowed, readTotals: async () => ({ ...summary, totals: [] }),
  }), { status: "ready", totals: [] });
});

test("sales record totals and plan remain independent of monthly cash availability", () => {
  const view = readFileSync(new URL("../src/components/v3/SalesRegisterView.tsx", import.meta.url), "utf8");
  assert.match(view, /checkFinanceAccess && month && query\.archived !== "true"/);
  assert.match(view, /workspace\.totals\.length > 0/);
  assert.match(view, /cash && cash\.status !== "not_allowed" && month/);
  assert.match(view, /cash\.status === "unavailable"/);
  assert.doesNotMatch(view, /canReadFinance = cash/);
});

test("payment DATE preserves local day while timestamp retains UTC conversion", () => {
  for (const [local, utc] of [
    ["2026-09-21T00:00", "2026-09-20T18:00:00.000Z"],
    ["2026-09-21T05:59", "2026-09-20T23:59:00.000Z"],
    ["2026-09-21T06:00", "2026-09-21T00:00:00.000Z"],
    ["2026-10-01T00:00", "2026-09-30T18:00:00.000Z"],
    ["2027-01-01T00:00", "2026-12-31T18:00:00.000Z"],
    ["2024-02-29T00:00", "2024-02-28T18:00:00.000Z"],
    ["2024-03-01T05:59", "2024-02-29T23:59:00.000Z"],
    ["2026-09-21T23:59", "2026-09-21T17:59:00.000Z"],
  ]) {
    assert.equal(financeLocalDate(local), local.slice(0, 10));
    assert.equal(financeDateTime(local), utc);
  }
});
test("payment local date validates the complete datetime-local input", () => {
  for (const value of ["2025-02-29T00:00", "2026-04-31T00:00", "2026-00-01T00:00", "2026-13-01T00:00", "2026-09-00T00:00", "2026-09-21T24:00", "2026-09-21T12:60", "2026-09-21T-1:00", "2026-09-21", "2026-09-21T1:00", "2026-09-21T00:00:00", "2026-09-21T00:00Z", "2026-09-21T00:00+06:00", " 2026-09-21T00:00", "2026-09-21T00:00\n", ""]) {
    assert.equal(financeLocalDate(value), null, JSON.stringify(value));
    assert.equal(financeDateTime(value), null, JSON.stringify(value));
  }
});
