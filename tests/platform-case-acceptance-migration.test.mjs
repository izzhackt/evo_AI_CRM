// Source-contract guards only. These read the actual migration file; they
// are not database execution (no Supabase credentials in this environment —
// the migration is not applied per the S3 task instructions). Behavior is
// checked by pattern-matching the SQL, the same style
// tests/platform-lead-sale-conditions-migration.test.mjs (S2) and
// tests/platform-unified-intake-access-migration.test.mjs (S1) use.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedMigrationVersions } from "../scripts/fast-release-ledger-gate.mjs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = source("supabase/migrations/182_platform_case_acceptance.sql");

test("migration 182 continues the contiguous source ledger", () => {
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("181") && versions.includes("182"));
});

test("migration is transactional and fails closed on source drift, like 173-181", () => {
  assert.match(sql, /^BEGIN;$/mu);
  assert.match(sql, /^COMMIT;\s*$/mu);
  assert.match(sql, /RAISE EXCEPTION/u);
  assert.doesNotMatch(sql, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
});

test("acknowledgement decision vocabulary gains 'declined' without touching the append-only model", () => {
  assert.match(sql, /CHECK \(decision IN \('accepted', 'clarification_requested', 'declined'\)\)/u);
  assert.match(sql, /OR \(decision = 'declined' AND clarification IS NOT NULL\s*\n\s*AND char_length\(btrim\(clarification\)\) BETWEEN 1 AND 1000\)/u);
  // The table itself, its append-only triggers and revision/request_id shape
  // are untouched — only the two auto-named CHECK constraints are replaced.
  assert.doesNotMatch(sql, /CREATE TABLE platform\.student_case_handoff_acknowledgements|forbid_case_note_change/u);
});

test("student_case_lifecycle_events gains 'declined' as the inverse of 'activated'", () => {
  assert.match(sql, /CHECK \(event_type IN \('activated', 'closed', 'reopened', 'declined'\)\)/u);
  assert.match(sql, /OR \(event_type = 'declined' AND previous_state = 'active' AND new_state = 'pending'\)/u);
});

test("case_sale_or_handoff_evidence is the single shared predicate for needs_curator and awaiting_ack", () => {
  const helper = sql.slice(
    sql.indexOf("CREATE FUNCTION platform_private.case_sale_or_handoff_evidence("),
    sql.indexOf("-- ---", sql.indexOf("CREATE FUNCTION platform_private.case_sale_or_handoff_evidence(")),
  );
  assert.match(helper, /FROM platform\.sales_admissions_handoffs h/u);
  assert.match(helper, /FROM platform\.student_cases c\s*\n\s*JOIN platform_private\.sales_register r/u);
  assert.match(helper, /ON r\.organization_id = c\.organization_id AND r\.lead_id = c\.canonical_lead_id/u);

  const flags = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION platform_private.admissions_attention_flags("),
    sql.indexOf("-- ---", sql.indexOf("CREATE OR REPLACE FUNCTION platform_private.admissions_attention_flags(")),
  );
  // Both the pending needs_curator branch and the active awaiting_ack branch
  // call the SAME shared predicate — never a duplicated inline EXISTS.
  assert.equal(
    (flags.match(/platform_private\.case_sale_or_handoff_evidence\(c\.organization_id,c\.id\)/gu) ?? []).length,
    2,
  );
  assert.match(flags, /IF c\.state='pending' THEN/u);
  assert.match(flags, /flags:=array_append\(flags,'needs_curator'\)/u);
  // A bare S1 cabinet-before-sale pending case (no evidence) still returns [].
  assert.match(flags, /IF platform_private\.case_sale_or_handoff_evidence\(c\.organization_id,c\.id\) THEN\s*\n\s*flags:=array_append\(flags,'needs_curator'\);\s*\n\s*END IF;\s*\n\s*RETURN flags;/u);
});

test("respond_student_case_handoff: declined reverts to pending, preserving portal_activated_at and every sale link", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION private.respond_student_case_handoff("),
    sql.indexOf("CREATE OR REPLACE FUNCTION platform.respond_student_case_handoff("),
  );
  // Decision vocabulary and per-decision clarification/reason bounds.
  assert.match(fn, /p_decision NOT IN \('accepted', 'clarification_requested', 'declined'\)/u);
  assert.match(fn, /OR \(p_decision IN \('clarification_requested', 'declined'\) AND normalized_clarification IS NULL\)/u);
  assert.match(fn, /OR \(p_decision = 'declined' AND char_length\(normalized_clarification\) > 1000\)/u);
  // The actor gate is UNCHANGED (149's eligible-staff-responsibility patch,
  // folded in as the current baseline) — no separate, looser decline gate.
  assert.match(fn, /NOT platform_private\.is_eligible_staff_responsibility\(p_organization_id, actor\.actor_membership_id, 'curator'\)/u);
  assert.match(fn, /student_case\.state = 'active'/u);
  // The revert only runs on a FRESH insert (never on a replayed request) and
  // never touches the sale/case data — only curator/handoff/scope on the case.
  assert.match(fn, /IF p_decision = 'declined' THEN/u);
  assert.match(fn, /SET current_curator_membership_id = NULL,\s*\n\s*state = 'pending',\s*\n\s*handoff_at = NULL,/u);
  assert.doesNotMatch(fn, /portal_activated_at\s*=/u);
  assert.doesNotMatch(fn, /canonical_lead_id\s*=|canonical_client_id\s*=|public_application_id\s*=/u);
  assert.doesNotMatch(fn, /UPDATE platform_private\.sales_register|DELETE FROM platform\.sales_admissions_handoffs/u);
  // Lifecycle event records the exact transition; no new assignment event
  // (student_case_assignment_events.new_curator_membership_id is NOT NULL —
  // there is no new curator on a decline).
  assert.match(fn, /'declined', 'active', 'pending',/u);
  assert.doesNotMatch(fn, /INSERT INTO platform\.student_case_assignment_events/u);
  // Scope bookkeeping mirrors assign_student_case_curator_authorized_e1's own
  // 'assigned' branch, in reverse: curator + student revoked, Sales regains.
  assert.match(fn, /actor\.actor_membership_id,\s*\n\s*previous_scope\.id, previous_scope\.scope_version, FALSE,/u);
  assert.match(fn, /target_case\.responsible_sales_membership_id,\s*\n\s*new_scope_id, new_scope_version, TRUE,/u);
  assert.match(fn, /CASE p_decision\s*\n\s*WHEN 'accepted' THEN 'case\.handoff\.acknowledge'\s*\n\s*WHEN 'clarification_requested' THEN 'case\.handoff\.clarification'\s*\n\s*ELSE 'case\.handoff\.decline'/u);
});

test("assign_case_curator_v1 gates on case.curator.assign and the needs-curator shape, then reuses the initial-assignment branch", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE FUNCTION private.assign_case_curator_v1("),
    sql.indexOf("CREATE FUNCTION platform.assign_case_curator_v1("),
  );
  assert.match(fn, /platform_private\.require_admin_actor\(p_organization_id, 'case\.curator\.assign'\)/u);
  assert.match(fn, /platform_private\.lock_student_case_note_assignment_domain\(p_organization_id\)/u);
  assert.match(fn, /platform_private\.require_case_assignment_admin_locked\(p_organization_id\)/u);
  // A retried request must replay the cached receipt BEFORE the needs-curator
  // shape check, since a successful call moves the case out of 'pending' —
  // checked BEFORE the state-fetch, not after.
  const replayAt = fn.indexOf("replayed := platform_private.replay_audit(");
  const shapeCheckAt = fn.indexOf("target_case.state <> 'pending'");
  assert.ok(replayAt > 0 && shapeCheckAt > replayAt, "replay check must precede the needs-curator shape check");
  assert.match(fn, /IF replayed IS NOT NULL THEN RETURN replayed; END IF;/u);
  assert.match(fn, /target_case\.state <> 'pending'\s*\n\s*OR NOT platform_private\.case_sale_or_handoff_evidence\(p_organization_id, p_student_case_id\)/u);
  assert.match(fn, /RETURN platform_private\.assign_student_case_curator_authorized_e1\(/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION platform\.assign_case_curator_v1\(UUID, UUID, UUID, UUID, TEXT\)/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.assign_case_curator_v1\(UUID, UUID, UUID, UUID, TEXT\) TO authenticated;/u);
});

test("staff_student_case_page gains needs_curator in the attention allow-list and a new attention_flags column, additively", () => {
  const patch = sql.slice(sql.indexOf("DO $s3_directory$"), sql.indexOf("COMMIT;"));
  assert.match(patch, /'platform\.staff_student_case_page\(integer,timestamptz,uuid,platform\.student_case_state,text,uuid,text,uuid,text\)'::regprocedure/u);
  assert.match(patch, /admissions_direction text, next_action_due_on date, admissions_version bigint, attention_flags text\[\]\)/u);
  assert.match(patch, /'visas','arrivals','awaiting_ack','needs_curator'\)\)/u);
  assert.match(patch, /CASE WHEN page\.access_mode = 'full' THEN platform_private\.admissions_attention_flags\(page\.student_case_id\) END/u);
  // No DROP FUNCTION / re-GRANT dance for this one (unlike 137's own
  // parameter-list change) — an additive RETURNS TABLE change survives
  // CREATE OR REPLACE in place.
  assert.doesNotMatch(patch, /DROP FUNCTION/u);
  assert.match(patch, /RAISE EXCEPTION 'staff_student_case_page_source_anchor_drift'/u);
});
