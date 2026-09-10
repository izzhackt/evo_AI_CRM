import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decimalToMinor, financeDateTime, financeMoney } from "../src/lib/platform-finance-entry-contract.ts";

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
