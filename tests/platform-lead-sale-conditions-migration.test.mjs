// Source-contract guards only. These read the actual migration file; they
// are not database execution (no Supabase credentials in this environment —
// the migration is not applied per the S2 task instructions). Behavior is
// checked by pattern-matching the SQL, the same style
// tests/platform-unified-intake-access-migration.test.mjs (S1) and
// tests/staff-roles-sales-handoff-migrations.test.mjs (173-175) use.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedMigrationVersions } from "../scripts/fast-release-ledger-gate.mjs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = source("supabase/migrations/181_platform_lead_sale_conditions.sql");

test("migration 181 continues the contiguous source ledger", () => {
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("180") && versions.includes("181"));
});

test("migration is transactional and fails closed on source drift, like 173-175/177-180", () => {
  assert.match(sql, /^BEGIN;$/mu);
  assert.match(sql, /^COMMIT;\s*$/mu);
  assert.match(sql, /RAISE EXCEPTION/u);
  assert.doesNotMatch(sql, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
});

test("every exposed platform.* RPC in this migration is SECURITY DEFINER, search_path-locked and REVOKE/GRANT-paired", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION platform\.save_lead_sale_conditions_v1\(UUID,UUID,UUID,BIGINT,JSONB\),\s*platform\.staff_lead_sale_conditions_v1\(UUID,UUID\)\s*FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.save_lead_sale_conditions_v1\(UUID,UUID,UUID,BIGINT,JSONB\),\s*platform\.staff_lead_sale_conditions_v1\(UUID,UUID\)\s*TO authenticated;/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION platform\.create_sales_report_handoff\(UUID,UUID,UUID,UUID,DATE\)\s*FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.create_sales_report_handoff\(UUID,UUID,UUID,UUID,DATE\) TO authenticated;/u);
  const createFn = sql.slice(sql.indexOf("CREATE FUNCTION platform.save_lead_sale_conditions_v1("), sql.indexOf("CREATE FUNCTION platform.staff_lead_sale_conditions_v1("));
  assert.match(createFn, /SECURITY DEFINER/u);
  assert.match(createFn, /SET search_path=''/u);
});

test("lead_sale_condition_fields mirrors sales_register_fields' money-pair/currency/length conventions on the card's own key set", () => {
  const validator = sql.slice(
    sql.indexOf("CREATE FUNCTION platform_private.lead_sale_condition_fields("),
    sql.indexOf("CREATE FUNCTION platform_private.lead_sale_conditions_row("),
  );
  // Exact allowlist: the card's vocabulary, not the register's.
  for (const key of [
    "service_label", "signing_date", "service_cost_raw", "service_cost_minor", "service_cost_currency",
    "paid_raw", "paid_minor", "paid_currency", "payment_note",
  ]) {
    assert.match(validator, new RegExp(`'${key}'`));
  }
  assert.doesNotMatch(validator, /'report_month'|'applicant_name'|'university'|'program'|'contract_number'/u);
  // Same currency set and amount-pairing rule as 134's sales_register_fields.
  assert.match(validator, /currency NOT IN \('USD','EUR','KGS'\)/u);
  assert.match(validator, /\(amount IS NULL\)<>\(currency IS NULL\)/u);
  assert.match(validator, /amount !~ '\^\(0\|\[1-9\]\[0-9\]\{0,12\}\)\$'/u);
  assert.match(validator, /amount::NUMERIC>1000000000000/u);
  // No SECURITY DEFINER on the pure validator, matching 134's own convention
  // (it is called internally by the exposed RPCs, never invoked directly).
  assert.doesNotMatch(validator, /SECURITY DEFINER/u);
});

test("save_lead_sale_conditions_v1 gates on the same scoped lead-workflow permission the report handoff already used", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE FUNCTION platform.save_lead_sale_conditions_v1("),
    sql.indexOf("CREATE FUNCTION platform.staff_lead_sale_conditions_v1("),
  );
  assert.match(fn, /platform_private\.staff_can_access\(p_organization_id,actor\.membership_id,'lead\.sales\.workflow\.manage','lead',p_lead_id\)/u);
  // Upsert with optimistic concurrency: revision 0 means "no row yet".
  assert.match(fn, /\(old\.lead_id IS NULL\)<>\(p_expected_revision=0\)/u);
  assert.match(fn, /'lead_sale_conditions_stale' USING ERRCODE='PT409'/u);
  // Payload-bound replay: the fingerprint binds actor+lead+revision+fields,
  // so a reused request_id with different input fails closed instead of
  // silently replaying the wrong receipt.
  assert.match(fn, /fingerprint:=md5\(jsonb_build_object\('actor',actor\.membership_id,'lead',p_lead_id,\s*'revision',p_expected_revision,'fields',p_fields\)::TEXT\);/u);
  assert.match(fn, /'lead_sale_conditions_request_id_conflict' USING ERRCODE='22023'/u);
  assert.match(fn, /INSERT INTO platform\.audit_events/u);
});

test("staff_lead_sale_conditions_v1 is gated on lead read and exposes the linked sales_register row", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE FUNCTION platform.staff_lead_sale_conditions_v1("),
    sql.indexOf("REVOKE ALL ON FUNCTION platform.save_lead_sale_conditions_v1"),
  );
  assert.match(fn, /private\.platform_can_read_canonical_lead\(p_organization_id,p_lead_id\)/u);
  assert.match(fn, /FROM platform_private\.sales_register r WHERE r\.organization_id=p_organization_id AND r\.lead_id=p_lead_id/u);
  assert.match(fn, /'linked_sales_register'/u);
});

test("create_sales_report_handoff drops its 8-argument creation signature for the narrow (org,request,lead,curator,report_month) one", () => {
  assert.match(sql, /DROP FUNCTION platform\.create_sales_report_handoff\(UUID,UUID,JSONB,TEXT,UUID,UUID,TEXT,TEXT\);/u);
  assert.match(sql, /CREATE FUNCTION platform\.create_sales_report_handoff\(\s*p_organization_id UUID,p_request_id UUID,p_lead_id UUID,p_curator_membership_id UUID,p_report_month DATE DEFAULT NULL\s*\)/u);
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION platform.create_sales_report_handoff("), sql.indexOf("REVOKE ALL ON FUNCTION platform.create_sales_report_handoff"));
  // The create-new-lead branch (and its owner_membership_id/email/direction
  // inputs) is gone entirely: the report always выбирает существующего лида.
  assert.doesNotMatch(fn, /create_manual_sales_lead|p_email|p_interest_direction|owner_membership_id","","/u);
  assert.doesNotMatch(fn, /p_fields->>'owner_membership_id'/u);
});

test("create_sales_report_handoff requires card conditions with a service cost before building the register payload", () => {
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION platform.create_sales_report_handoff("), sql.indexOf("REVOKE ALL ON FUNCTION platform.create_sales_report_handoff"));
  assert.match(fn, /FROM platform_private\.lead_sale_conditions c\s*WHERE c\.organization_id=p_organization_id AND c\.lead_id=p_lead_id FOR UPDATE;/u);
  assert.match(fn, /IF NOT FOUND OR conditions\.fields->>'service_cost_minor' IS NULL THEN\s*RAISE EXCEPTION 'sale_conditions_missing' USING ERRCODE='22023';/u);
  // Explicit key-by-key mapping onto the register's own vocabulary — never a
  // blind merge (the register's validator would reject unknown card keys
  // like service_label/payment_note).
  assert.match(fn, /'program',conditions\.fields->>'service_label'/u);
  assert.match(fn, /'notes',conditions\.fields->>'payment_note'/u);
});

test("a lead's existing pending S1 cabinet case is activated in place, never re-created", () => {
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION platform.create_sales_report_handoff("), sql.indexOf("REVOKE ALL ON FUNCTION platform.create_sales_report_handoff"));
  assert.match(fn, /FROM platform\.student_cases sc\s*WHERE sc\.organization_id=p_organization_id AND sc\.canonical_lead_id=p_lead_id AND sc\.state='pending' FOR UPDATE;/u);
  const pendingLookup = fn.indexOf("SELECT * INTO pending_case FROM platform.student_cases sc");
  const pendingBranch = fn.slice(fn.indexOf("IF FOUND THEN", pendingLookup), fn.indexOf("ELSE\n", pendingLookup));
  assert.match(pendingBranch, /platform_private\.assign_student_case_curator_authorized_e1\(p_organization_id,pending_case\.id,p_curator_membership_id,/u);
  // This branch never touches platform.sales_admissions_handoffs (that table
  // is the OTHER path's evidence — see the migration header), so its own
  // AFTER INSERT trigger (134's sales_register_completed_handoff) cannot
  // seed a placeholder row here; the fully-populated row is inserted directly.
  assert.doesNotMatch(pendingBranch, /INSERT INTO platform\.sales_admissions_handoffs|platform_private\.handoff_lead_to_admissions\(/u);
  assert.match(pendingBranch, /INSERT INTO platform_private\.sales_register\(organization_id,report_month,owner_membership_id,source_kind,lead_id,client_id,fields,source_snapshot\)/u);
  assert.match(pendingBranch, /'pipeline'/u);
  const elseBranch = fn.slice(fn.indexOf("ELSE\n", pendingLookup), fn.indexOf("receipt:=jsonb_build_object"));
  assert.match(elseBranch, /platform_private\.handoff_lead_to_admissions\(p_lead_id,selected_gate_version,p_curator_membership_id,'sales_report',/u);
});

test("client_id for both branches comes from the canonical lead, never the (possibly ownerless) case row", () => {
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION platform.create_sales_report_handoff("), sql.indexOf("REVOKE ALL ON FUNCTION platform.create_sales_report_handoff"));
  assert.match(fn, /INTO canonical_name,canonical_phone,owner_id,client_id_value\s*FROM platform\.leads l JOIN platform\.clients c/u);
  assert.doesNotMatch(fn, /pending_case\.canonical_client_id/u);
});
