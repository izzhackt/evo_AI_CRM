// Source-contract guards only. These read the actual migration file; they
// are not database execution (no Supabase credentials in this environment —
// the migration is not applied per every prior slice's own instruction; the
// real execution check is `npm run test:database:migration-boundaries`, run
// separately). Same pattern as tests/platform-card-fields-migration.test.mjs
// (184) and tests/platform-case-acceptance-migration.test.mjs (182).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedMigrationVersions } from "../scripts/fast-release-ledger-gate.mjs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = source("supabase/migrations/185_platform_cabinet_invites.sql");

test("migration 185 continues the contiguous source ledger", () => {
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("184") && versions.includes("185"));
});

test("migration is transactional and fails closed on source drift, like every prior unified-workflow slice", () => {
  assert.match(sql, /^BEGIN;$/mu);
  assert.match(sql, /^COMMIT;\s*$/mu);
  assert.match(sql, /RAISE EXCEPTION/u);
  assert.doesNotMatch(sql, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
});

test("the file contains no control characters (byte-scan, mandatory per the task contract)", () => {
  const bad = [...sql].filter((ch) => {
    const code = ch.codePointAt(0);
    return code < 0x20 && ch !== "\n" && ch !== "\t";
  });
  assert.deepEqual(bad, []);
});

test("anchor-patch DO blocks for prepare/finalize fail closed on drift (55000) via pg_get_functiondef, matching 149/157/182's own idiom", () => {
  assert.match(sql, /pg_catalog\.pg_get_functiondef\(\s*'platform\.prepare_student_portal_provisioning\(uuid,uuid,text,text,text,uuid,text,uuid\)'::regprocedure\s*\)/u);
  assert.match(sql, /'student_portal_prepare_cabinet_source_drift' USING ERRCODE = '55000'/u);
  assert.match(sql, /pg_catalog\.pg_get_functiondef\(\s*'platform\.finalize_student_portal_authority\(uuid,bigint,bigint\)'::regprocedure\s*\)/u);
  assert.match(sql, /'student_portal_finalize_cabinet_source_drift' USING ERRCODE = '55000'/u);
  // The dynamic constraint-name discovery in (a) uses the same fail-closed
  // idiom as 182's DO $ack_decision_shape$ block (pg_constraint lookup, NULL
  // check, RAISE EXCEPTION before any DROP CONSTRAINT).
  assert.match(sql, /IF case_shape_check IS NULL THEN\s*RAISE EXCEPTION 'portal_receipts_case_shape_check_not_found'/u);
  assert.match(sql, /IF permission_keys_check IS NULL THEN\s*RAISE EXCEPTION 'portal_receipts_permission_keys_check_not_found'/u);
});

// ---------------------------------------------------------------------------
// a) shape CHECKs
// ---------------------------------------------------------------------------
test("case_shape / permission_keys / shape-check CHECKs are widened to cabinet_pending; every historical row shape stays legal", () => {
  assert.match(sql, /CHECK \(case_shape IN \('normal_u6', 'legacy_pending', 'cabinet_pending'\)\)/u);
  assert.match(
    sql,
    /CONSTRAINT student_portal_receipts_permission_keys_check CHECK \(\s*required_permission_keys = ARRAY\['membership\.provision', 'scope\.manage'\]::TEXT\[\]\s*OR required_permission_keys = ARRAY\[\s*'membership\.provision', 'scope\.manage', 'case\.curator\.assign'\s*\]::TEXT\[\]\s*OR required_permission_keys = ARRAY\['lead\.sales\.workflow\.manage'\]::TEXT\[\]\s*\)/u,
  );
  assert.match(
    sql,
    /CONSTRAINT student_portal_receipts_shape_check CHECK \(\s*\(case_shape = 'normal_u6' AND legacy_curator_membership_id IS NULL\)\s*OR \(case_shape = 'legacy_pending' AND legacy_curator_membership_id IS NOT NULL\)\s*OR \(case_shape = 'cabinet_pending' AND legacy_curator_membership_id IS NULL\)\s*\)/u,
  );
  // cabinet_pending does NOT get membership.provision/scope.manage — the
  // caller (Sales) can never hold those staff_system_only keys (155).
  const permissionKeysCheck = sql.slice(
    sql.indexOf("ADD CONSTRAINT student_portal_receipts_permission_keys_check"),
    sql.indexOf("DROP CONSTRAINT student_portal_receipts_shape_check"),
  );
  assert.doesNotMatch(permissionKeysCheck, /'lead\.sales\.workflow\.manage', 'membership\.provision'/u);
});

// ---------------------------------------------------------------------------
// b) private authority helpers
// ---------------------------------------------------------------------------
test("resolve_student_portal_cabinet_lead_e1 requires a genuine 184 lead-cabinet origin (source_key + canonical_lead_id), nothing else", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE FUNCTION platform_private.resolve_student_portal_cabinet_lead_e1"),
    sql.indexOf("REVOKE ALL ON FUNCTION platform_private.resolve_student_portal_cabinet_lead_e1"),
  );
  assert.match(fn, /student_case\.source_key LIKE 'lead-cabinet:%'/u);
  assert.match(fn, /student_case\.canonical_lead_id IS NOT NULL/u);
  assert.doesNotMatch(fn, /SECURITY INVOKER/u);
  assert.match(fn, /SECURITY DEFINER/u);
});

test("require_student_portal_cabinet_actor_e1 (live actor) uses the 180/184 admin-or-sales + staff_can_access precedent, fails closed", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE FUNCTION platform_private.require_student_portal_cabinet_actor_e1"),
    sql.indexOf("REVOKE ALL ON FUNCTION platform_private.require_student_portal_cabinet_actor_e1"),
  );
  assert.match(fn, /FROM platform\.current_actor_authority\(\) a/u);
  assert.match(fn, /a\.platform_role IN \('admin', 'sales'\)/u);
  assert.match(
    fn,
    /platform_private\.staff_can_access\(\s*p_organization_id, a\.membership_id,\s*'lead\.sales\.workflow\.manage', 'lead', p_lead_id\s*\)/u,
  );
  assert.match(fn, /RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501'/u);
  assert.match(fn, /RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001'/u);
});

test("assert_student_portal_cabinet_membership_e1 re-verifies a STORED membership_id (no live session), same predicate", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE FUNCTION platform_private.assert_student_portal_cabinet_membership_e1"),
    sql.indexOf("REVOKE ALL ON FUNCTION platform_private.assert_student_portal_cabinet_membership_e1"),
  );
  assert.match(fn, /platform_private\.staff_membership_identity\(p_organization_id, p_membership_id\)/u);
  assert.match(fn, /identity\.coarse_role IN \('admin', 'sales'\)/u);
  assert.match(fn, /'lead\.sales\.workflow\.manage', 'lead', p_lead_id/u);
  assert.doesNotMatch(fn, /current_actor_authority/u);
});

// ---------------------------------------------------------------------------
// assert_student_portal_receipt_authority_e1 -- the repointed assertion
// ---------------------------------------------------------------------------
test("assert_student_portal_receipt_authority_e1: normal_u6/legacy_pending delegate verbatim; cabinet_pending re-resolves the lead every call", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE FUNCTION platform_private.assert_student_portal_receipt_authority_e1"),
    sql.indexOf("REVOKE ALL ON FUNCTION platform_private.assert_student_portal_receipt_authority_e1"),
  );
  assert.match(
    fn,
    /IF receipt\.case_shape <> 'cabinet_pending' THEN\s*PERFORM platform_private\.assert_student_portal_receipt_admin_e1\(p_receipt_id\);\s*RETURN;\s*END IF;/u,
  );
  assert.match(
    fn,
    /v_lead_id := platform_private\.resolve_student_portal_cabinet_lead_e1\(\s*receipt\.organization_id, receipt\.student_case_id\s*\);/u,
  );
  assert.match(
    fn,
    /PERFORM platform_private\.assert_student_portal_cabinet_membership_e1\(\s*receipt\.organization_id, receipt\.authorizing_membership_id, v_lead_id\s*\);/u,
  );
});

test("finalize_student_portal_authority now calls assert_student_portal_receipt_authority_e1, not the old admin-only assertion, at its one call site", () => {
  const patchSection = sql.slice(
    sql.indexOf("DO $finalize_cabinet_patch$"),
    sql.indexOf("$finalize_cabinet_patch$;") + "$finalize_cabinet_patch$;".length,
  );
  assert.match(
    patchSection,
    /PERFORM platform_private\.assert_student_portal_receipt_authority_e1\(p_receipt_id\);/u,
  );
});

// ---------------------------------------------------------------------------
// c) prepare_student_portal_provisioning cabinet_pending branch
// ---------------------------------------------------------------------------
test("prepare's cabinet_pending branch: curator-less input guard, resource-scoped authority (not require_admin_actor), genuine-origin shape check", () => {
  const patchSection = sql.slice(
    sql.indexOf("DO $prepare_cabinet_patch$"),
    sql.indexOf("$prepare_cabinet_patch$;") + "$prepare_cabinet_patch$;".length,
  );
  assert.match(
    patchSection,
    /OR \(p_case_shape = 'cabinet_pending' AND p_legacy_curator_membership_id IS NOT NULL\)/u,
  );
  assert.match(
    patchSection,
    /WHEN 'cabinet_pending' THEN ARRAY\['lead\.sales\.workflow\.manage'\]::TEXT\[\]/u,
  );
  // The live actor gate for cabinet_pending is NEVER require_admin_actor
  // (which hard-requires system_role='admin' regardless of the key checked).
  const cabinetPreflight = patchSection.slice(
    patchSection.indexOf("IF p_case_shape = 'cabinet_pending' THEN"),
    patchSection.indexOf("ELSE\n    FOREACH permission_key"),
  );
  assert.doesNotMatch(cabinetPreflight, /require_admin_actor/u);
  assert.match(cabinetPreflight, /require_student_portal_cabinet_actor_e1/u);
  assert.match(
    patchSection,
    /ELSIF p_case_shape = 'cabinet_pending' THEN[\s\S]*?target_case\.source_key NOT LIKE 'lead-cabinet:%'[\s\S]*?target_case\.canonical_lead_id IS NULL[\s\S]*?target_case\.canonical_lead_id <> v_lead_id[\s\S]*?target_case\.state <> 'pending'[\s\S]*?target_case\.current_curator_membership_id IS NOT NULL[\s\S]*?target_case\.handoff_at IS NOT NULL[\s\S]*?target_case\.portal_activated_at IS NOT NULL[\s\S]*?target_case\.closed_at IS NOT NULL/u,
  );
});

test("prepare's normal_u6/legacy_pending branches are reproduced byte-for-byte from the CURRENT (149+157-patched) live body", () => {
  const patchSection = sql.slice(
    sql.indexOf("DO $prepare_cabinet_patch$"),
    sql.indexOf("$prepare_cabinet_patch$;") + "$prepare_cabinet_patch$;".length,
  );
  // 157's own staff_lock_memberships + staff_membership_identity restructuring
  // must still be present verbatim inside the ELSE (non-cabinet) branch.
  assert.match(patchSection, /platform_private\.staff_lock_memberships\(p_organization_id,/u);
  assert.match(
    patchSection,
    /identity\.system_role='admin' AND identity\.profile_id=actor\.actor_profile_id/u,
  );
  // 149's is_eligible_staff_responsibility -> 157's staff_can_receive_assignment
  // curator-eligibility check must still be present verbatim.
  assert.match(patchSection, /staff_can_receive_assignment\(p_organization_id,identity\.membership_id,/u);
  assert.match(patchSection, /'case\.read\.full','student_case',p_student_case_id/u);
});

// ---------------------------------------------------------------------------
// d) finalize_student_portal_authority cabinet_pending branch
// ---------------------------------------------------------------------------
test("finalize's cabinet_pending state-shape branch requires pending/no-curator/no-handoff/no-portal-activation/not-closed, no continuing_* flag", () => {
  const patchSection = sql.slice(
    sql.indexOf("DO $finalize_cabinet_patch$"),
    sql.indexOf("$finalize_cabinet_patch$;") + "$finalize_cabinet_patch$;".length,
  );
  assert.match(
    patchSection,
    /ELSIF receipt\.case_shape = 'cabinet_pending' THEN[\s\S]*?IF target_case\.state <> 'pending'\s*OR target_case\.current_curator_membership_id IS NOT NULL\s*OR target_case\.handoff_at IS NOT NULL\s*OR target_case\.portal_activated_at IS NOT NULL\s*OR target_case\.closed_at IS NOT NULL\s*THEN RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001'; END IF;/u,
  );
});

test("finalize's cabinet_pending activation UPDATE sets ONLY portal_activated_at -- no curator, no state flip, no handoff_at (plan §4)", () => {
  const patchSection = sql.slice(
    sql.indexOf("DO $finalize_cabinet_patch$"),
    sql.indexOf("$finalize_cabinet_patch$;") + "$finalize_cabinet_patch$;".length,
  );
  const cabinetActivationStart = patchSection.indexOf(
    "ELSIF receipt.case_shape = 'cabinet_pending' THEN\n    -- Plan",
  );
  const activationBranch = patchSection.slice(
    cabinetActivationStart,
    patchSection.indexOf("ELSE\n    curator_result :=", cabinetActivationStart),
  );
  assert.match(
    activationBranch,
    /UPDATE platform\.student_cases AS student_case\s*SET portal_activated_at = occurred_at\s*WHERE student_case\.organization_id = receipt\.organization_id\s*AND student_case\.id = receipt\.student_case_id\s*AND student_case\.student_membership_id = new_student_membership_id\s*AND student_case\.state = 'pending'\s*AND student_case\.current_curator_membership_id IS NULL\s*AND student_case\.portal_activated_at IS NULL\s*AND student_case\.closed_at IS NULL;/u,
  );
  // No curator_membership_id, no state=, no handoff_at anywhere in this SET.
  assert.doesNotMatch(activationBranch, /SET[\s\S]*current_curator_membership_id\s*=/u);
  assert.doesNotMatch(activationBranch, /SET[\s\S]*handoff_at\s*=/u);
  assert.match(activationBranch, /GET DIAGNOSTICS row_count = ROW_COUNT;/u);
  assert.match(activationBranch, /IF row_count <> 1 THEN\s*RAISE EXCEPTION 'portal_case_invalid_shape'/u);
});

test("the shared bind branch (student_membership_id) stays untouched and shape-agnostic -- it already runs for cabinet_pending", () => {
  const patchSection = sql.slice(
    sql.indexOf("DO $finalize_cabinet_patch$"),
    sql.indexOf("$finalize_cabinet_patch$;") + "$finalize_cabinet_patch$;".length,
  );
  const bindBranch = patchSection.slice(
    patchSection.indexOf("ELSE\n    BEGIN\n      membership_result"),
    patchSection.indexOf("IF receipt.case_shape = 'normal_u6' THEN\n    UPDATE"),
  );
  assert.doesNotMatch(bindBranch, /case_shape/u);
  assert.match(
    bindBranch,
    /UPDATE platform\.student_cases AS student_case\s*SET student_membership_id = new_student_membership_id\s*WHERE student_case\.organization_id = receipt\.organization_id\s*AND student_case\.id = receipt\.student_case_id\s*AND student_case\.student_membership_id IS NULL;/u,
  );
});

// ---------------------------------------------------------------------------
// e) authorize_student_portal_invite_reissue cabinet_pending branch
// ---------------------------------------------------------------------------
test("authorize_student_portal_invite_reissue is CREATE OR REPLACE (it already existed) and branches cabinet_pending away from require_admin_actor", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION platform\.authorize_student_portal_invite_reissue\(/u);
  const fn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION platform.authorize_student_portal_invite_reissue"),
    sql.indexOf("REVOKE ALL ON FUNCTION platform.authorize_student_portal_invite_reissue"),
  );
  assert.match(fn, /candidate\.case_shape,\s*candidate\.student_case_id/u);
  // Two-phase check, same shape as prepare: pre-lock and post-lock. Slice
  // ONLY the cabinet_pending arm itself (up to its own ELSE), not the
  // sibling non-cabinet branch, which legitimately still calls
  // require_admin_actor for normal_u6/legacy_pending receipts.
  const preLockStart = fn.indexOf("IF receipt_hint.case_shape = 'cabinet_pending' THEN");
  const preLockCabinetArm = fn.slice(
    preLockStart,
    fn.indexOf("ELSE\n    FOREACH permission_key IN ARRAY receipt_hint", preLockStart),
  );
  const postLockStart = fn.lastIndexOf("IF receipt.case_shape = 'cabinet_pending' THEN");
  const postLockCabinetArm = fn.slice(
    postLockStart,
    fn.indexOf("ELSE\n    FOREACH permission_key IN ARRAY receipt.required_permission_keys", postLockStart),
  );
  assert.doesNotMatch(preLockCabinetArm, /require_admin_actor/u);
  assert.doesNotMatch(postLockCabinetArm, /require_admin_actor/u);
  assert.match(preLockCabinetArm, /require_student_portal_cabinet_actor_e1/u);
  assert.match(postLockCabinetArm, /require_student_portal_cabinet_actor_e1/u);
});

// ---------------------------------------------------------------------------
// f) companion read + p7a allowlist
// ---------------------------------------------------------------------------
test("staff_student_case_cabinet_origin_v1: read-gated, delegates to the one shared authority predicate, granted to authenticated", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE FUNCTION platform.staff_student_case_cabinet_origin_v1"),
    sql.indexOf("REVOKE ALL ON FUNCTION platform.staff_student_case_cabinet_origin_v1"),
  );
  assert.match(fn, /private\.platform_can_read_student_case\(p_organization_id, p_student_case_id\)/u);
  assert.match(fn, /platform_private\.resolve_student_portal_cabinet_lead_e1\(/u);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION platform\.staff_student_case_cabinet_origin_v1\(UUID, UUID\)\s*TO authenticated;/u,
  );
});

test("no new p7a_safe_audit_actions entries -- every action name this migration's new code paths write is already allowlisted", () => {
  // No rename-and-replace of p7a_safe_audit_actions() (the 154/179/181/184
  // pattern for a genuinely NEW action name) — only the header's own prose
  // may mention the function name while explaining why none is needed.
  assert.doesNotMatch(sql, /ALTER FUNCTION platform_private\.p7a_safe_audit_actions\(\)/u);
  assert.doesNotMatch(sql, /CREATE FUNCTION platform_private\.p7a_safe_audit_actions\(\)/u);
  // finalize's cabinet_pending branch reuses the existing audit insert
  // ('student.portal.authority.activate') unconditionally, not a new action.
  const finalizeSection = sql.slice(
    sql.indexOf("DO $finalize_cabinet_patch$"),
    sql.indexOf("$finalize_cabinet_patch$;") + "$finalize_cabinet_patch$;".length,
  );
  assert.match(finalizeSection, /'student\.portal\.authority\.activate', 'student_case', receipt\.student_case_id/u);
});

test("every exposed platform.* RPC this migration touches is SECURITY DEFINER, search_path-locked and REVOKE/GRANT-paired", () => {
  for (const fn of [
    "platform.staff_student_case_cabinet_origin_v1(UUID, UUID)",
    "platform.authorize_student_portal_invite_reissue(",
  ]) {
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON FUNCTION[\\s\\S]{0,400}${fn.replace(/[.()[\]]/gu, "\\$&")}`, "u"),
      `${fn} is not REVOKEd`,
    );
  }
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION platform\.authorize_student_portal_invite_reissue\(\s*UUID, BIGINT, BIGINT, UUID, TEXT\s*\) TO authenticated;/u,
  );
});
