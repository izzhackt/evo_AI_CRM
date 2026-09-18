// Source-contract guards only. These read the actual migration file; they
// are not database execution (no Supabase credentials in this environment —
// the migration is not applied per every prior slice's own instruction).
// Same pattern as tests/platform-lead-sale-conditions-migration.test.mjs
// (181) and tests/platform-unified-intake-access-migration.test.mjs (180).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedMigrationVersions } from "../scripts/fast-release-ledger-gate.mjs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = source("supabase/migrations/184_platform_card_fields_and_partner_details.sql");

test("migration 184 continues the contiguous source ledger", () => {
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("183") && versions.includes("184"));
});

test("migration is transactional and fails closed on source drift, like every prior unified-workflow slice", () => {
  assert.match(sql, /^BEGIN;$/mu);
  assert.match(sql, /^COMMIT;\s*$/mu);
  assert.match(sql, /RAISE EXCEPTION/u);
  assert.doesNotMatch(sql, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
});

test("every exposed platform.* RPC in this migration is SECURITY DEFINER, search_path-locked and REVOKE/GRANT-paired", () => {
  for (const fn of [
    "platform.prepare_lead_cabinet_v1(UUID,UUID,UUID)",
    "platform.staff_lead_cabinet_case_v1(UUID,UUID)",
    "platform.update_application_partner_details_v1(UUID,UUID,UUID,UUID,BIGINT,JSONB)",
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION[\\s\\S]{0,200}${fn.replace(/[.()]/gu, "\\$&")}`, "u"),
      `${fn} is not REVOKEd`);
  }
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.prepare_lead_cabinet_v1\(UUID,UUID,UUID\),\s*platform\.staff_lead_cabinet_case_v1\(UUID,UUID\)\s*TO authenticated;/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.update_application_partner_details_v1\(UUID,UUID,UUID,UUID,BIGINT,JSONB\) TO authenticated;/u);
  const prepareFn = sql.slice(sql.indexOf("CREATE FUNCTION platform.prepare_lead_cabinet_v1("), sql.indexOf("-- Companion read"));
  assert.match(prepareFn, /SECURITY DEFINER/u);
  assert.match(prepareFn, /SET search_path=''/u);
  const partnerFn = sql.slice(sql.indexOf("CREATE FUNCTION platform.update_application_partner_details_v1("), sql.indexOf("REVOKE ALL ON FUNCTION platform.update_application_partner_details_v1"));
  assert.match(partnerFn, /SECURITY DEFINER/u);
  assert.match(partnerFn, /SET search_path=''/u);
});

// ---------------------------------------------------------------------------
// a) lead_sale_condition_fields widening
// ---------------------------------------------------------------------------
test("lead_sale_condition_fields keeps every 181 key legal and adds the three new card-block families", () => {
  const validator = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION platform_private.lead_sale_condition_fields("),
    sql.indexOf("-- lead_sale_conditions_row/staff_lead_sale_conditions_v1"),
  );
  for (const key of [
    // 181's original 9 (plan §5's «Условия продажи»)
    "service_label", "signing_date", "service_cost_raw", "service_cost_minor", "service_cost_currency",
    "paid_raw", "paid_minor", "paid_currency", "payment_note",
    // «Пожелания»
    "wishes_countries", "wishes_study_fields", "wishes_education_level", "wishes_intake_year",
    "wishes_intake_season", "wishes_universities",
    // «Образование»
    "education_current", "education_grade", "education_marks", "education_english", "education_certificates",
    // «Условия»
    "conditions_budget_raw", "conditions_budget_minor", "conditions_budget_currency", "conditions_budget_period",
    "conditions_scholarship", "conditions_note",
  ]) {
    assert.match(validator, new RegExp(`'${key}'`), `${key} missing from the widened allowlist`);
  }
  // Same currency set and amount-pairing rule as 134/181, now three pairs.
  assert.match(validator, /currency NOT IN \('USD','EUR','KGS'\)/u);
  assert.match(validator, /\(amount IS NULL\)<>\(currency IS NULL\)/u);
  assert.match(validator, /ARRAY\['service_cost','paid','conditions_budget'\]/u);
  // wishes_intake_year: a bare 4-digit year, not a free-form string.
  assert.match(validator, /value !~ '\^\(19\|20\|21\)\[0-9\]\{2\}\$'/u);
  // conditions_budget_period: a bounded named choice.
  assert.match(validator, /value NOT IN \('year','program'\)/u);
  // Still no SECURITY DEFINER on the pure validator, matching 134/181.
  assert.doesNotMatch(validator, /SECURITY DEFINER/u);
});

test("lead_sale_conditions_row and staff_lead_sale_conditions_v1 reuse the validator itself as a defaults source", () => {
  const rowFn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION platform_private.lead_sale_conditions_row("),
    sql.indexOf("CREATE OR REPLACE FUNCTION platform.staff_lead_sale_conditions_v1("),
  );
  assert.match(rowFn, /platform_private\.lead_sale_condition_fields\('\{\}'::JSONB\)\|\|p_row\.fields\|\|jsonb_build_object/u);
  const readFn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION platform.staff_lead_sale_conditions_v1("),
    sql.indexOf("-- ---------------------------------------------------------------------------\n-- b)"),
  );
  assert.match(readFn, /private\.platform_can_read_canonical_lead\(p_organization_id,p_lead_id\)/u);
  assert.match(readFn, /IF NOT FOUND THEN\s*RETURN platform_private\.lead_sale_condition_fields\('\{\}'::JSONB\)/u);
  assert.match(readFn, /RETURN platform_private\.lead_sale_conditions_row\(row\)\|\|jsonb_build_object\('linked_sales_register',linked\)/u);
});

// ---------------------------------------------------------------------------
// b) prepare_lead_cabinet_v1 + intake-origin CHECK + staff_lead_cabinet_case_v1
// ---------------------------------------------------------------------------
test("student_cases_intake_origin_check keeps every S1/180 shape legal and adds the lead-cabinet shape", () => {
  const check = sql.slice(sql.indexOf("ALTER TABLE platform.student_cases\n  DROP CONSTRAINT student_cases_intake_origin_check"), sql.indexOf("CREATE FUNCTION platform.prepare_lead_cabinet_v1"));
  assert.match(check, /responsible_sales_membership_id IS NOT NULL/u);
  assert.match(check, /'docs-intake:'\|\|id::TEXT/u);
  assert.match(check, /'public_student_application:'\|\|public_application_id::TEXT/u);
  assert.match(check, /'lead-cabinet:'\|\|canonical_lead_id::TEXT/u);
  assert.match(check, /canonical_lead_id IS NOT NULL AND student_membership_id IS NULL/u);
});

test("prepare_lead_cabinet_v1 gates on the same scoped lead-workflow permission every lead sales write already uses", () => {
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION platform.prepare_lead_cabinet_v1("), sql.indexOf("-- Companion read"));
  assert.match(fn, /a\.platform_role IN \('admin','sales'\)/u);
  assert.match(fn, /platform_private\.staff_can_access\(p_organization_id,actor\.membership_id,'lead\.sales\.workflow\.manage','lead',p_lead_id\)/u);
  assert.match(fn, /platform_private\.lock_p2d_request\(p_request_id\)/u);
  assert.match(fn, /platform_private\.replay_audit\(p_request_id,'lead\.cabinet\.prepare','lead',p_lead_id,/u);
});

test("prepare_lead_cabinet_v1 refuses a lead that already has a case or an already-existing Student membership", () => {
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION platform.prepare_lead_cabinet_v1("), sql.indexOf("-- Companion read"));
  assert.match(fn, /sc\.state IN \('pending','active'\)\) THEN\s*RAISE EXCEPTION 'lead_cabinet_case_exists' USING ERRCODE='PT409'/u);
  assert.match(fn, /m\."current_role"='student'\) THEN\s*RAISE EXCEPTION 'lead_cabinet_membership_exists' USING ERRCODE='PT409'/u);
});

test("prepare_lead_cabinet_v1 creates the S1 pending, curator-less shape and leaves portal_activated_at unset", () => {
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION platform.prepare_lead_cabinet_v1("), sql.indexOf("-- Companion read"));
  assert.match(fn, /INSERT INTO platform\.student_cases\(id,organization_id,responsible_sales_membership_id,source_key,student_display_name,\s*operational_stage,state,current_scope_id,current_scope_version,canonical_lead_id\)/u);
  assert.match(fn, /'intake_review','pending',scope_id,1,p_lead_id/u);
  // No student_membership_id and no portal_activated_at column in the INSERT
  // list at all — deliberately deferred (see migration header).
  assert.doesNotMatch(fn, /student_membership_id/u);
  assert.doesNotMatch(fn, /portal_activated_at/u);
  assert.match(fn, /INSERT INTO platform\.audit_events/u);
});

test("staff_lead_cabinet_case_v1 is gated identically to staff_lead_sale_conditions_v1 and returns a compact case pointer", () => {
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION platform.staff_lead_cabinet_case_v1("), sql.indexOf("REVOKE ALL ON FUNCTION platform.prepare_lead_cabinet_v1"));
  assert.match(fn, /private\.platform_can_read_canonical_lead\(p_organization_id,p_lead_id\)/u);
  assert.match(fn, /ORDER BY sc\.created_at DESC LIMIT 1/u);
  assert.match(fn, /IF NOT FOUND THEN RETURN NULL; END IF;/u);
  assert.match(fn, /'student_case_id',found_case\.id,'state',found_case\.state::TEXT/u);
});

// ---------------------------------------------------------------------------
// c) application_partner_detail_fields + update_application_partner_details_v1
// ---------------------------------------------------------------------------
test("application_partner_detail_fields allowlists exactly the four new keys and shape-checks the link", () => {
  const validator = sql.slice(
    sql.indexOf("CREATE FUNCTION platform_private.application_partner_detail_fields("),
    sql.indexOf("CREATE FUNCTION platform.update_application_partner_details_v1("),
  );
  for (const key of ["partner_contact", "external_link", "decision_reference", "decision_note"]) {
    assert.match(validator, new RegExp(`'${key}'`), `${key} missing`);
  }
  assert.doesNotMatch(validator, /partnerContact|packageReference|offerConditions/u);
  assert.match(validator, /key='external_link'/u);
  assert.match(validator, /'\^https:\/\//u);
  assert.match(validator, /\[\^\\s<>"\]\{1,1990\}\$'/u);
  assert.doesNotMatch(validator, /SECURITY DEFINER/u);
});

test("update_application_partner_details_v1 uses the strongest kept-CRUD gate and requires NO admissions playbook", () => {
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION platform.update_application_partner_details_v1("), sql.indexOf("REVOKE ALL ON FUNCTION platform.update_application_partner_details_v1"));
  assert.match(fn, /platform_private\.require_domain_actor\(p_organization_id,'application\.manage'\)/u);
  assert.match(fn, /platform_private\.require_case_operator\(p_organization_id,target_student_case_id,'application\.manage'\)/u);
  // NO playbook-configuration gate (137's own "Configure a country playbook
  // first" check) — this RPC never calls admissions_lock_case/
  // admissions_related_command, the family that enforces that requirement.
  assert.doesNotMatch(fn, /admissions_lock_case|admissions_related_command|Configure a country playbook first/u);
  assert.match(fn, /platform_private\.lock_p2d_request\(p_request_id\)/u);
  assert.match(fn, /platform_private\.replay_audit\(p_request_id,'application\.partner\.details\.update','university_application',/u);
});

test("update_application_partner_details_v1 verifies the case match, checks optimistic concurrency and merges without clobbering other keys", () => {
  const fn = sql.slice(sql.indexOf("CREATE FUNCTION platform.update_application_partner_details_v1("), sql.indexOf("REVOKE ALL ON FUNCTION platform.update_application_partner_details_v1"));
  assert.match(fn, /target_student_case_id IS DISTINCT FROM p_student_case_id/u);
  assert.match(fn, /application_row\.version<>p_expected_version OR application_row\.version=9223372036854775807/u);
  assert.match(fn, /'admissions_version_conflict' USING ERRCODE='PT409'/u);
  assert.match(fn, /SET admissions_details=COALESCE\(admissions_details,'\{\}'::JSONB\)\|\|normalized, version=version\+1/u);
});

test("both new actions are exposed in the admin audit journal allowlist", () => {
  assert.match(sql, /ALTER FUNCTION platform_private\.p7a_safe_audit_actions\(\)\s*RENAME TO p7a_safe_audit_actions_pre_card_fields_and_partner_details;/u);
  assert.match(sql, /ARRAY\['lead\.cabinet\.prepare','application\.partner\.details\.update'\]::TEXT\[\]/u);
});
