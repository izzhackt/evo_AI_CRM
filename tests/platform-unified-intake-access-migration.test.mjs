// Source-contract guards only. These read the actual migration file; they
// are not database execution or a live approve/reject acceptance (no
// Supabase credentials in this environment — the migration is not applied
// per the S1 task instructions). Behavior is checked by pattern-matching
// the SQL, the same style tests/staff-roles-sales-handoff-migrations.test.mjs
// uses for 173-175.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedMigrationVersions } from "../scripts/fast-release-ledger-gate.mjs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = source("supabase/migrations/180_platform_unified_intake_access.sql");

test("migration 180 continues the contiguous source ledger", () => {
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("179") && versions.includes("180"));
});

test("migration is transactional and fails closed on source drift, like 177/178", () => {
  assert.match(sql, /^BEGIN;$/mu);
  assert.match(sql, /^COMMIT;\s*$/mu);
  assert.match(sql, /RAISE EXCEPTION/u);
  assert.doesNotMatch(sql, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
  // Every portal-predicate patch is a self-verifying anchor-count replace —
  // an unexpected current body raises instead of silently reshaping it.
  assert.match(sql, /evo_u8_portal_pending_anchor_mismatch/u);
});

test("decide_student_application_v1 drops direction/curator from its signature entirely", () => {
  assert.match(sql, /DROP FUNCTION platform\.decide_student_application_v1\(UUID,BIGINT,TEXT,TEXT,UUID,TEXT,UUID\);/u);
  assert.match(sql, /CREATE FUNCTION platform\.decide_student_application_v1\(p_application_id UUID,p_expected_revision BIGINT,p_decision TEXT,\s*p_reason TEXT,p_request_id UUID\)/u);
  const decideBody = sql.slice(sql.indexOf("CREATE FUNCTION platform.decide_student_application_v1("), sql.indexOf("-- student_application_json: expose canonical_lead_id"));
  assert.doesNotMatch(decideBody, /p_admissions_direction|p_curator_membership_id|assign_student_case_curator/u);
  // Preserves the PT409 conflict contract (178) rather than reverting to 40001.
  assert.doesNotMatch(decideBody, /'40001'/u);
  assert.match(decideBody, /student_application_request_conflict' USING ERRCODE='PT409'/u);
  assert.match(decideBody, /student_application_conflict' USING ERRCODE='PT409'/u);
});

test("approve opens a curator-less, portal-activated pending case linked to the canonical lead", () => {
  const decideBody = sql.slice(sql.indexOf("CREATE FUNCTION platform.decide_student_application_v1("), sql.indexOf("-- student_application_json: expose canonical_lead_id"));
  // The insert names every student_cases column it sets — current_curator_membership_id
  // and handoff_at are absent, so they stay their column defaults (NULL),
  // which is exactly what the 'pending' branch of student_cases_state_shape_check requires.
  const insert = decideBody.slice(decideBody.indexOf("INSERT INTO platform.student_cases("), decideBody.indexOf(");", decideBody.indexOf("INSERT INTO platform.student_cases(")));
  assert.doesNotMatch(insert, /current_curator_membership_id|handoff_at/u);
  assert.match(insert, /canonical_lead_id\)/u);
  assert.match(insert, /'pending',statement_timestamp\(\),/u);
  assert.match(decideBody, /admissions_direction=NULL WHERE id=app\.id;/u);
  // Ensures (never duplicates) the lead: reuses app.canonical_lead_id when set,
  // and only calls create_or_link_lead/create_or_link_client when it is NULL.
  assert.match(decideBody, /lead_id:=app\.canonical_lead_id;\s*IF lead_id IS NULL THEN/u);
});

test("reject never touches the linked lead, canonical client identity or case creation", () => {
  const decideBody = sql.slice(sql.indexOf("CREATE FUNCTION platform.decide_student_application_v1("), sql.indexOf("-- student_application_json: expose canonical_lead_id"));
  const rejectBranch = decideBody.slice(decideBody.indexOf("IF p_decision='reject' THEN"), decideBody.indexOf("ELSE"));
  assert.match(rejectBranch, /UPDATE platform_private\.student_applications SET status='rejected'/u);
  assert.doesNotMatch(rejectBranch, /canonical_lead_id|create_or_link_lead|create_or_link_client|student_cases/u);
});

test("submit links the canonical client/lead only when an intake owner is configured, and only once", () => {
  const submitBody = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION platform.submit_student_application_v1("), sql.indexOf("-- ---------------------------------------------------------------------------\n-- d)"));
  assert.match(submitBody, /IF app\.canonical_lead_id IS NULL THEN/u);
  assert.match(submitBody, /SELECT c\.intake_owner_membership_id INTO owner_membership_id/u);
  assert.match(submitBody, /IF owner_membership_id IS NOT NULL THEN/u);
  assert.match(submitBody, /'evo_platform','client',app\.id::TEXT,'platform_application_submitted'/u);
  assert.match(submitBody, /'new','platform_application',\s*'evo_platform','lead'/u);
  assert.doesNotMatch(submitBody, /'40001'/u);
});

test("relaxed CHECKs keep both the historical and the new-linked shape legal", () => {
  assert.match(sql, /student_case_id IS NOT NULL\)\s*\);/u);
  assert.doesNotMatch(sql.slice(sql.indexOf("ADD CONSTRAINT student_applications_decision_shape_check")), /admissions_direction IS NOT NULL\)\)/u);
  const intakeCheck = sql.slice(sql.indexOf("ADD CONSTRAINT student_cases_intake_origin_check CHECK("), sql.indexOf("-- A «кабинет до продажи»"));
  // The public_application_id branch (third disjunct) no longer constrains
  // canonical_lead_id at all — neither requiring it NULL (the old 177 shape)
  // nor NOT NULL, so historical and newly linked rows are both legal.
  const publicApplicationBranch = intakeCheck.slice(intakeCheck.indexOf("public_application_id IS NOT NULL"));
  assert.doesNotMatch(publicApplicationBranch, /canonical_lead_id/u);
  // The untouched docs-intake branch (first disjunct) keeps requiring it NULL.
  const docsIntakeBranch = intakeCheck.slice(intakeCheck.indexOf("public_application_id IS NULL"), intakeCheck.indexOf("public_application_id IS NOT NULL"));
  assert.match(docsIntakeBranch, /AND canonical_client_id IS NOT NULL AND canonical_lead_id IS NULL/u);
  const stateCheck = sql.slice(sql.indexOf("ADD CONSTRAINT student_cases_state_shape_check CHECK ("), sql.indexOf("-- ---------------------------------------------------------------------------\n-- f)"));
  assert.doesNotMatch(stateCheck, /portal_activated_at IS NULL/u);
});

test("the new lead-card read reuses the existing canonical-lead read authority, not a new permission", () => {
  assert.match(sql, /CREATE FUNCTION platform\.staff_student_application_for_lead_v1\(p_lead_id UUID\)/u);
  assert.match(sql, /private\.platform_can_read_canonical_lead\(org,p_lead_id\)/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.submit_student_application_v1\(UUID,JSONB,BIGINT\),\s*platform\.decide_student_application_v1\(UUID,BIGINT,TEXT,TEXT,UUID\),\s*platform\.staff_student_application_for_lead_v1\(UUID\)\s*TO authenticated;/u);
});

test("portal predicate patches list exactly the functions extended to 'pending', matching the header", () => {
  const patchedSignatures = [
    "private.platform_can_read_student_portal_case(uuid,uuid)",
    "platform.student_portal_overview_v2()",
    "platform_private.live_student_portal_recipient(uuid,uuid)",
    "platform.admit_student_document_upload_scan(uuid,uuid,uuid)",
    "private.grant_student_portal_document_download(uuid,uuid,uuid)",
    "private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)",
    "private.consume_document_download_grant_pre_e5(uuid,uuid)",
    "platform.reserve_document_upload_after_ingress_scan(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text,text,timestamp with time zone,uuid)",
    "platform.preflight_document_upload(uuid,uuid,text,text,bigint,text,uuid)",
    "platform_private.require_document_storage_actor(uuid,uuid,text)",
    "platform_private.require_current_upload_reservation(uuid,uuid,text)",
  ];
  for (const signature of patchedSignatures) {
    const needle = `'${signature}'`;
    assert.ok(sql.includes(needle), signature);
  }
  // grant_document_download_pre_e5 is patched twice (preliminary check + post-lock recheck).
  const occurrences = sql.split("'private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)'").length - 1;
  assert.equal(occurrences, 2);
  // Deliberately-left functions stay documented in the header, not silently dropped.
  for (const leftAlone of [
    "student_portal_finance_v2",
    "student_portal_applications_v2",
    "student_portal_messages",
    "platform_can_read_student_case",
    "require_notification_actor",
  ]) {
    assert.ok(sql.includes(leftAlone), leftAlone);
  }
});
