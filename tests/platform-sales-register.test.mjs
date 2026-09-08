import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSalesDate, parseSalesInteger, parseSalesRegisterWorkspace } from "../src/lib/platform-sales-register-contract.ts";

// Pure boundary/source assertions; no fake successful RPC or business actor.
test("sales scalar boundaries reject date rollover, infinity and unsafe money", () => {
  for (const value of ["2026-02-30", "2026-13-01", "infinity", "2101-01-01", "2026-2-1", null]) assert.equal(parseSalesDate(value), null);
  assert.equal(parseSalesDate("2024-02-29"), "2024-02-29");
  for (const value of [NaN, Infinity, -1, "1.5", "1e2", " 12", Number.MAX_SAFE_INTEGER + 1]) assert.equal(parseSalesInteger(value), null);
  assert.equal(parseSalesInteger("0"), 0);
  assert.equal(parseSalesInteger("1000000000001", 1_000_000_000_000), null);
  assert.throws(() => parseSalesRegisterWorkspace(null, ""), /unavailable/);
  assert.throws(() => parseSalesRegisterWorkspace({ rows: [] }, ""), /unavailable/);
});
test("sales register has one guarded canonical handoff path and no first-payment inference", () => {
  const sql = readFileSync(new URL("../supabase/migrations/134_platform_sales_register.sql", import.meta.url), "utf8");
  assert.match(sql, /UNIQUE\(organization_id,lead_id\)/);
  assert.match(sql, /AFTER INSERT ON platform\.sales_admissions_handoffs/);
  assert.match(sql, /NEW\.handoff_state='completed'/);
  assert.match(sql, /AT TIME ZONE 'Asia\/Bishkek'/);
  assert.match(sql, /sales_context->>'current_owner_membership_id'/);
  assert.doesNotMatch(sql, /first_payment_amount|contract_confirmed_at/);
  assert.match(sql, /IF EXISTS\(SELECT 1 FROM platform_private\.sales_register r WHERE r\.organization_id=handoff\.organization_id AND r\.lead_id=handoff\.lead_id\) THEN RETURN/);
  assert.match(sql, /WHERE handoff_state='completed' ORDER BY organization_id,handed_off_at,id/);
});
test("source and actions use cookie authority with no provider or elevated client", () => {
  const source = readFileSync(new URL("../src/lib/v3/sales-register-source.ts", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/lib/platform-sales-register-actions.ts", import.meta.url), "utf8");
  assert.match(source, /createSupabaseServerClient\(\)/);
  assert.match(source, /row\.ownerMembershipId !== actor\.membershipId/);
  assert.match(actions, /p_expected_version: version/);
  assert.match(actions, /data\.request_id !== requestId/);
  assert.doesNotMatch(source + actions, /createSupabaseAdmin|SERVICE_ROLE|SECRET_KEY|\.from\(/);
  assert.match(actions, /inserted \+ skipped \+ mismatches !== input\.sales\.length/);
});
