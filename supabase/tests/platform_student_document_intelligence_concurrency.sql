\set ON_ERROR_STOP on

-- BW8A optimistic-concurrency and exact-replay proof. This reuses the fully
-- synthetic BW3 case fixture created earlier in the migration-boundary test
-- run; no provider, production source, or customer data is contacted.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'BW8A concurrency assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;

\set bw8a_org '51000000-0000-4000-8000-000000000001'
\set bw8a_curator_user '51000000-0000-4000-8000-000000000103'
\set bw8a_request '59000000-0000-4000-8000-000000000701'
\set bw8a_stale_request '59000000-0000-4000-8000-000000000702'

SELECT student_case.id::TEXT AS bw8a_case_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'bw8a_org'
  AND student_case.source_key = 'bw3-synthetic-case-001'
\gset

SELECT
  profile.revision::TEXT AS bw8a_profile_revision_before,
  count(decision.id)::TEXT AS bw8a_decision_count_before,
  COALESCE(max(field_value.field_revision), 0)::TEXT
    AS bw8a_field_revision_before
FROM platform.student_profiles AS profile
LEFT JOIN platform.student_profile_field_decisions AS decision
  ON decision.organization_id = profile.organization_id
  AND decision.student_profile_id = profile.id
LEFT JOIN platform.student_profile_field_values AS field_value
  ON field_value.organization_id = profile.organization_id
  AND field_value.student_profile_id = profile.id
  AND field_value.field_key = 'study.scholarship_interest'
WHERE profile.organization_id = :'bw8a_org'
  AND profile.student_case_id = :'bw8a_case_id'
GROUP BY profile.revision
\gset

SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version
)::TEXT AS bw8a_curator_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw8a_curator_user'
\gset

SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version
)::TEXT AS bw8a_admin_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '51000000-0000-4000-8000-000000000101'
\gset

SELECT
  max(membership.id::TEXT) FILTER (
    WHERE membership."current_role" = 'admin'
  ) AS bw8a_admin_membership_id,
  max(membership.id::TEXT) FILTER (
    WHERE membership."current_role" = 'curator'
      AND profile.auth_user_id = :'bw8a_curator_user'
  ) AS bw8a_curator_membership_id,
  max(membership.id::TEXT) FILTER (
    WHERE membership."current_role" = 'sales'
  ) AS bw8a_sales_membership_id,
  min(membership.id::TEXT) FILTER (
    WHERE membership."current_role" = 'student'
  ) AS bw8a_student_membership_id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw8a_org'
  AND membership.status = 'active'
\gset

SELECT jsonb_build_object('role', 'service_role')::TEXT
  AS bw8a_service_claims
\gset

-- Build and apply the real reviewed China overlay. The intake contract
-- timestamp is deliberately present, but no reviewed contract/payment gate is
-- supplied to the overlay, so item 13 must remain not_required.
SET request.jwt.claims TO :'bw8a_admin_claims';
SET ROLE authenticated;
SELECT platform.register_workflow_source(
  :'bw8a_org', 'src_88888888888888888888888888888888',
  'google_drive_file',
  'https://drive.google.com/file/d/1EKZOzQKli3Ub2tVxsX1qlpRj21kAJ6C9/view',
  'synthetic-revision-20260805',
  'Register exact synthetic China checklist source',
  '59000000-0000-4000-8000-000000000730'
)::TEXT AS bw8a_china_source_id
\gset
SELECT platform.review_workflow_source(
  :'bw8a_org', :'bw8a_china_source_id', 'reviewed',
  'Review exact synthetic China checklist source',
  '59000000-0000-4000-8000-000000000731'
);
SELECT platform.create_china_student_document_overlay(
  :'bw8a_org', 'Synthetic China Degree', 'synthetic_china_program', 9001,
  :'bw8a_china_source_id', 'Create source-backed synthetic China overlay',
  '59000000-0000-4000-8000-000000000732'
)::TEXT AS bw8a_china_overlay_create
\gset
RESET ROLE;

SET request.jwt.claims TO :'bw8a_service_claims';
SET ROLE service_role;
SELECT platform.create_pending_student_case(
  :'bw8a_org', :'bw8a_student_membership_id', :'bw8a_sales_membership_id',
  'bw8a-china-applicability-case', 'bw8a-synthetic-intake-contract',
  '2026-08-02T08:00:00Z'::TIMESTAMPTZ,
  'BW8A Synthetic China Student', 'China', 'Synthetic China Degree',
  'synthetic_china_program', 'synthetic_china_intake', 'ru',
  'synthetic_china_budget', 'profile_and_route',
  'Complete synthetic China profile',
  '59000000-0000-4000-8000-000000000733'
)::TEXT AS bw8a_china_case_create
\gset
RESET ROLE;

SELECT (:'bw8a_china_case_create'::JSONB ->> 'student_case_id')
  AS bw8a_china_case_id,
  (:'bw8a_china_overlay_create'::JSONB
    ->> 'country_requirement_version_id') AS bw8a_china_version_id
\gset

SET request.jwt.claims TO :'bw8a_admin_claims';
SET ROLE authenticated;
SELECT platform.apply_china_student_document_overlay(
  :'bw8a_org', :'bw8a_china_case_id', :'bw8a_china_version_id',
  'Apply synthetic China overlay before payment evidence',
  '59000000-0000-4000-8000-000000000734'
)::TEXT AS bw8a_china_overlay_apply
\gset
RESET ROLE;

SELECT
  count(*) FILTER (WHERE slot.applicability_status = 'required')::TEXT
    AS bw8a_overlay_required_count,
  count(*) FILTER (WHERE slot.applicability_status = 'pending_information')::TEXT
    AS bw8a_overlay_pending_count,
  count(*) FILTER (WHERE slot.applicability_status = 'not_required')::TEXT
    AS bw8a_overlay_not_required_count
FROM platform.document_slots AS slot
WHERE slot.organization_id = :'bw8a_org'
  AND slot.student_case_id = :'bw8a_china_case_id'
\gset

SET request.jwt.claims TO :'bw8a_admin_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'bw8a_org', :'bw8a_china_case_id', :'bw8a_curator_membership_id',
  'Assign Curator for reviewed applicability recompute',
  '59000000-0000-4000-8000-000000000735'
);
SELECT platform.upsert_student_profile(
  :'bw8a_org', :'bw8a_china_case_id', 0,
  'BW8A Synthetic China Student', 'BW8A Synthetic Legal Student',
  DATE '2010-08-06', 'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_china_budget',
  ARRAY['self', 'guardian']::TEXT[], 'granted',
  'synthetic://bw8a/consent', 'Complete document checklist',
  'Create complete profile after initial overlay review',
  '59000000-0000-4000-8000-000000000736'
)::TEXT AS bw8a_china_profile_create
\gset
RESET ROLE;

-- Assignment changes access-version evidence, so refresh the Curator JWT
-- before using either the original case or the new China case.
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version
)::TEXT AS bw8a_curator_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw8a_curator_user'
\gset

SET request.jwt.claims TO :'bw8a_curator_claims';
SET ROLE authenticated;

SELECT platform.manual_edit_student_profile_field(
  :'bw8a_org',
  :'bw8a_case_id',
  :'bw8a_profile_revision_before',
  'study.scholarship_interest',
  'boolean',
  'true'::JSONB,
  'Synthetic BW8A optimistic concurrency proof',
  :'bw8a_request'
)::TEXT AS bw8a_first_result
\gset

-- An exact retry must return the stored result even though the profile has
-- already advanced to the next revision.
SELECT platform.manual_edit_student_profile_field(
  :'bw8a_org',
  :'bw8a_case_id',
  :'bw8a_profile_revision_before',
  'study.scholarship_interest',
  'boolean',
  'true'::JSONB,
  'Synthetic BW8A optimistic concurrency proof',
  :'bw8a_request'
)::TEXT AS bw8a_replay_result
\gset

-- Reusing the request id with changed input is never a second write.
\set ON_ERROR_STOP off
SELECT platform.manual_edit_student_profile_field(
  :'bw8a_org',
  :'bw8a_case_id',
  :'bw8a_profile_revision_before',
  'study.scholarship_interest',
  'boolean',
  'false'::JSONB,
  'Synthetic BW8A optimistic concurrency proof',
  :'bw8a_request'
);
\set bw8a_changed_replay_state :SQLSTATE

-- A different request racing from the same old revision loses with the
-- explicit serialization SQLSTATE and cannot append history.
SELECT platform.manual_edit_student_profile_field(
  :'bw8a_org',
  :'bw8a_case_id',
  :'bw8a_profile_revision_before',
  'study.scholarship_interest',
  'boolean',
  'false'::JSONB,
  'Synthetic stale writer must fail',
  :'bw8a_stale_request'
);
\set bw8a_stale_revision_state :SQLSTATE
\set ON_ERROR_STOP on

RESET ROLE;

SELECT
  profile.revision::TEXT AS bw8a_profile_revision_after,
  count(decision.id)::TEXT AS bw8a_decision_count_after,
  max(field_value.field_revision)::TEXT AS bw8a_field_revision_after,
  max(field_value.field_value::TEXT) AS bw8a_field_value_after,
  count(*) FILTER (
    WHERE decision.request_id = :'bw8a_request'
  )::TEXT AS bw8a_request_decision_count,
  count(*) FILTER (
    WHERE decision.request_id = :'bw8a_stale_request'
  )::TEXT AS bw8a_stale_decision_count
FROM platform.student_profiles AS profile
LEFT JOIN platform.student_profile_field_decisions AS decision
  ON decision.organization_id = profile.organization_id
  AND decision.student_profile_id = profile.id
LEFT JOIN platform.student_profile_field_values AS field_value
  ON field_value.organization_id = profile.organization_id
  AND field_value.student_profile_id = profile.id
  AND field_value.field_key = 'study.scholarship_interest'
WHERE profile.organization_id = :'bw8a_org'
  AND profile.student_case_id = :'bw8a_case_id'
GROUP BY profile.revision
\gset

SELECT pg_temp.assert_true(
  :'bw8a_first_result'::JSONB = :'bw8a_replay_result'::JSONB
    AND :'bw8a_changed_replay_state' = '22023'
    AND :'bw8a_stale_revision_state' = '40001',
  'exact replay, changed replay, or stale revision SQLSTATE drifted'
);

SELECT pg_temp.assert_true(
  :'bw8a_profile_revision_after'::BIGINT
      = :'bw8a_profile_revision_before'::BIGINT + 1
    AND :'bw8a_field_revision_after'::BIGINT
      = :'bw8a_field_revision_before'::BIGINT + 1
    AND :'bw8a_field_value_after'::JSONB = 'true'::JSONB
    AND :'bw8a_decision_count_after'::BIGINT
      = :'bw8a_decision_count_before'::BIGINT + 1
    AND :'bw8a_request_decision_count' = '1'
    AND :'bw8a_stale_decision_count' = '0',
  'failed retries changed profile, field, or append-only decision history'
);

-- The actual overlay was applied while DOB and payment-gate evidence were
-- absent. The later complete profile introduces DOB, and these reviewed RPCs
-- recompute the minor decision first and the contract/payment decision second.
SELECT (:'bw8a_china_profile_create'::JSONB ->> 'revision')::TEXT
  AS bw8a_china_profile_revision
\gset

SET request.jwt.claims TO :'bw8a_curator_claims';
SET ROLE authenticated;

SELECT platform.recompute_student_document_applicability(
  :'bw8a_org', :'bw8a_china_case_id',
  :'bw8a_china_profile_revision'::BIGINT,
  DATE '2026-08-05', NULL, NULL,
  'Review applicability after synthetic DOB',
  '59000000-0000-4000-8000-000000000710'
)::TEXT AS bw8a_after_dob_result
\gset

SELECT platform.recompute_student_document_applicability(
  :'bw8a_org', :'bw8a_china_case_id',
  :'bw8a_china_profile_revision'::BIGINT,
  DATE '2026-08-05', NULL, NULL,
  'Review applicability after synthetic DOB',
  '59000000-0000-4000-8000-000000000710'
)::TEXT AS bw8a_after_dob_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.recompute_student_document_applicability(
  :'bw8a_org', :'bw8a_china_case_id',
  :'bw8a_china_profile_revision'::BIGINT,
  DATE '2026-08-05', '2026-08-04T12:00:00Z'::TIMESTAMPTZ,
  'synthetic://bw8a/payment/replay-mismatch',
  'Review applicability after synthetic DOB',
  '59000000-0000-4000-8000-000000000710'
);
\set bw8a_applicability_changed_replay_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.recompute_student_document_applicability(
  :'bw8a_org', :'bw8a_china_case_id',
  :'bw8a_china_profile_revision'::BIGINT,
  DATE '2026-08-05', '2026-08-04T12:00:00Z'::TIMESTAMPTZ,
  'synthetic://bw8a/payment/reviewed',
  'Review applicability after synthetic contract payment',
  '59000000-0000-4000-8000-000000000713'
)::TEXT AS bw8a_after_contract_result
\gset
RESET ROLE;

SELECT slot.id::TEXT AS bw8a_always_slot
FROM platform.document_slots AS slot
JOIN platform.document_requirements AS requirement
  ON requirement.organization_id = slot.organization_id
  AND requirement.id = slot.requirement_id
WHERE slot.organization_id = :'bw8a_org'
  AND slot.student_case_id = :'bw8a_china_case_id'
  AND requirement.applicability_rule = 'always'
ORDER BY requirement.source_item_order
LIMIT 1
\gset

\set ON_ERROR_STOP off
UPDATE platform.document_slots
SET applicability_status = 'pending_information',
    applicability_reference_date = DATE '2026-08-05'
WHERE organization_id = :'bw8a_org'
  AND id = :'bw8a_always_slot';
\set bw8a_direct_applicability_update_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT
  bool_and(slot.applicability_status = 'required') FILTER (
    WHERE requirement.applicability_rule = 'always'
  )::TEXT AS bw8a_always_required,
  bool_and(slot.applicability_status = 'required') FILTER (
    WHERE requirement.applicability_rule = 'minor_only'
  )::TEXT AS bw8a_minor_required,
  bool_and(slot.applicability_status = 'required') FILTER (
    WHERE requirement.applicability_rule = 'after_contract_payment'
  )::TEXT AS bw8a_contract_required
FROM platform.document_slots AS slot
JOIN platform.document_requirements AS requirement
  ON requirement.organization_id = slot.organization_id
  AND requirement.id = slot.requirement_id
WHERE slot.organization_id = :'bw8a_org'
  AND slot.student_case_id = :'bw8a_china_case_id'
\gset

SELECT
  count(*)::TEXT AS bw8a_applicability_audit_count,
  count(*) FILTER (
    WHERE before_state ? 'slot_decisions'
      AND after_state ? 'slot_decisions'
      AND after_state ? 'input_sha256'
  )::TEXT AS bw8a_applicability_evidence_count
FROM platform.audit_events
WHERE action = 'student.document.applicability.recompute'
  AND resource_id = :'bw8a_china_case_id'
  AND request_id IN (
    '59000000-0000-4000-8000-000000000710',
    '59000000-0000-4000-8000-000000000713'
  )
\gset

SELECT count(*)::TEXT AS bw8a_recompute_context_count
FROM platform_private.document_applicability_recompute_context
\gset

SELECT pg_temp.assert_true(
  :'bw8a_overlay_required_count' = '11'
    AND :'bw8a_overlay_pending_count' = '2'
    AND :'bw8a_overlay_not_required_count' = '1'
    AND (:'bw8a_china_overlay_apply'::JSONB
      ->> 'contract_payment_gate_exists')::BOOLEAN = FALSE,
  'real pre-contract China overlay applicability drifted'
);

SELECT pg_temp.assert_true(
  :'bw8a_after_dob_result'::JSONB = :'bw8a_after_dob_replay'::JSONB
    AND (:'bw8a_after_dob_result'::JSONB ->> 'changed_slot_count')::BIGINT = 2
    AND (:'bw8a_after_dob_result'::JSONB
      ->> 'date_of_birth_present')::BOOLEAN = TRUE
    AND (:'bw8a_after_dob_result'::JSONB
      ->> 'contract_payment_gate_exists')::BOOLEAN = FALSE
    AND :'bw8a_applicability_changed_replay_state' = '22023'
    AND (:'bw8a_after_contract_result'::JSONB
      ->> 'changed_slot_count')::BIGINT = 1,
  'reviewed applicability replay or later-state recompute drifted'
);

SELECT pg_temp.assert_true(
  :'bw8a_always_required'::BOOLEAN
    AND :'bw8a_minor_required'::BOOLEAN
    AND :'bw8a_contract_required'::BOOLEAN
    AND :'bw8a_direct_applicability_update_state' = '55000'
    AND :'bw8a_applicability_audit_count' = '2'
    AND :'bw8a_applicability_evidence_count' = '2'
    AND :'bw8a_recompute_context_count' = '0',
  'applicability outcomes, immutable-write guard, or audit evidence drifted'
);

-- Two independent database sessions prove that reserve/finalize double-submit
-- calls wait on the canonical parent lock and deduplicate after the winner
-- commits. An expired append-only reservation must not brick its export: a new
-- request receives a new exact object path. The one-time consume race must
-- reject a different-request loser with the domain error, while an exact
-- request retry replays its committed success without a second consumption.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT export.id::TEXT AS bw8a_profile_export_id
FROM platform.student_profile_exports AS export
WHERE export.organization_id = :'bw8a_org'
  AND export.request_id = '59000000-0000-4000-8000-000000000310'
\gset

-- Build a historical expired row without weakening the production API with a
-- test clock or caller-controlled TTL. This disposable database restores the
-- table's forced-RLS state immediately after the insert.
ALTER TABLE platform_private.student_profile_export_storage_reservations
  DISABLE ROW LEVEL SECURITY;
INSERT INTO platform_private.student_profile_export_storage_reservations (
  id, request_id, organization_id, student_case_id, profile_export_id,
  object_name, expires_at, created_at
) VALUES (
  '59000000-0000-4000-8000-000000000720',
  '59000000-0000-4000-8000-000000000720',
  :'bw8a_org', :'bw8a_case_id', :'bw8a_profile_export_id',
  'organizations/' || :'bw8a_org' || '/student-cases/' || :'bw8a_case_id'
    || '/profile-exports/' || :'bw8a_profile_export_id'
    || '/reservations/59000000-0000-4000-8000-000000000720/profile.docx',
  statement_timestamp() - INTERVAL '45 minutes',
  statement_timestamp() - INTERVAL '60 minutes'
);
ALTER TABLE platform_private.student_profile_export_storage_reservations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_profile_export_storage_reservations
  FORCE ROW LEVEL SECURITY;

SELECT (
  'host=127.0.0.1 user=postgres dbname=' || current_database()
)::TEXT
  AS bw8a_dblink_connection
\gset

-- The harness accepts loopback connections through pg_hba trust. Its postgres
-- role is intentionally non-superuser, so use the extension-owner `_u` entry
-- point; the entire extension/schema are dropped again before this test exits.
SELECT extensions.dblink_connect_u(
  'bw8a_export_1', :'bw8a_dblink_connection'
);
SELECT extensions.dblink_connect_u(
  'bw8a_export_2', :'bw8a_dblink_connection'
);
SELECT extensions.dblink_exec(
  'bw8a_export_1', $$SET request.jwt.claims TO '{"role":"service_role"}'$$
);
SELECT extensions.dblink_exec('bw8a_export_1', 'SET ROLE service_role');
SELECT extensions.dblink_exec(
  'bw8a_export_2', $$SET request.jwt.claims TO '{"role":"service_role"}'$$
);
SELECT extensions.dblink_exec('bw8a_export_2', 'SET ROLE service_role');

SELECT extensions.dblink_exec('bw8a_export_1', 'BEGIN');
SELECT extensions.dblink_send_query(
  'bw8a_export_1',
  pg_catalog.format(
    'SELECT platform.reserve_student_profile_export_storage(%L::UUID, %L::UUID, %L::UUID)',
    :'bw8a_org', :'bw8a_profile_export_id',
    '59000000-0000-4000-8000-000000000721'
  )
);
SELECT remote.result::TEXT AS bw8a_reserve_first
FROM extensions.dblink_get_result('bw8a_export_1') AS remote(result JSONB)
\gset
SELECT count(*)
FROM extensions.dblink_get_result('bw8a_export_1') AS drained(result JSONB);

SELECT extensions.dblink_send_query(
  'bw8a_export_2',
  pg_catalog.format(
    'SELECT platform.reserve_student_profile_export_storage(%L::UUID, %L::UUID, %L::UUID)',
    :'bw8a_org', :'bw8a_profile_export_id',
    '59000000-0000-4000-8000-000000000722'
  )
);
SELECT pg_catalog.pg_sleep(0.2);
SELECT pg_temp.assert_true(
  extensions.dblink_is_busy('bw8a_export_2') = 1,
  'second export reservation did not wait on the parent export lock'
);
SELECT extensions.dblink_exec('bw8a_export_1', 'COMMIT');
SELECT remote.result::TEXT AS bw8a_reserve_second
FROM extensions.dblink_get_result('bw8a_export_2') AS remote(result JSONB)
\gset
SELECT count(*)
FROM extensions.dblink_get_result('bw8a_export_2') AS drained(result JSONB);

SELECT pg_temp.assert_true(
  :'bw8a_reserve_first'::JSONB ->> 'storage_reservation_id'
      = :'bw8a_reserve_second'::JSONB ->> 'storage_reservation_id'
    AND :'bw8a_reserve_first'::JSONB ->> 'storage_reservation_id'
      <> '59000000-0000-4000-8000-000000000720'
    AND :'bw8a_reserve_first'::JSONB ->> 'object_name'
      <> 'organizations/' || :'bw8a_org' || '/student-cases/'
        || :'bw8a_case_id' || '/profile-exports/'
        || :'bw8a_profile_export_id'
        || '/reservations/59000000-0000-4000-8000-000000000720/profile.docx'
    AND (:'bw8a_reserve_first'::JSONB ->> 'deduplicated')::BOOLEAN = FALSE
    AND (:'bw8a_reserve_second'::JSONB ->> 'deduplicated')::BOOLEAN = TRUE,
  'expired-reservation recovery or concurrent reserve convergence drifted'
);

-- Even a stale object uploaded inside the old reservation's original window
-- cannot take over after renewal. The new reservation is now the sole
-- finalization capability for this export.
INSERT INTO storage.objects (bucket_id, name, created_at)
VALUES (
  'platform-documents',
  'organizations/' || :'bw8a_org' || '/student-cases/' || :'bw8a_case_id'
    || '/profile-exports/' || :'bw8a_profile_export_id'
    || '/reservations/59000000-0000-4000-8000-000000000720/profile.docx',
  statement_timestamp() - INTERVAL '50 minutes'
);
SELECT extensions.dblink_send_query(
  'bw8a_export_1',
  pg_catalog.format(
    'SELECT platform.finalize_student_profile_export_storage(%L::UUID, %L::UUID, %L, %s::BIGINT, %L::UUID)',
    :'bw8a_org', '59000000-0000-4000-8000-000000000720',
    repeat('e', 64), 512,
    '59000000-0000-4000-8000-000000000728'
  )
);
SELECT count(*) AS bw8a_stale_finalize_rows
FROM extensions.dblink_get_result('bw8a_export_1', FALSE)
  AS remote(result JSONB)
\gset
SELECT pg_temp.assert_true(
  :'bw8a_stale_finalize_rows'::BIGINT = 0
    AND pg_catalog.strpos(
      extensions.dblink_error_message('bw8a_export_1'),
      'superseded by a newer reservation'
    ) > 0
    AND pg_catalog.strpos(
      pg_catalog.lower(extensions.dblink_error_message('bw8a_export_1')),
      'duplicate key'
    ) = 0,
  'superseded reservation was not rejected with the domain error'
);
SELECT count(*)
FROM extensions.dblink_get_result('bw8a_export_1', FALSE)
  AS drained(result JSONB);

INSERT INTO storage.objects (bucket_id, name)
VALUES (
  :'bw8a_reserve_first'::JSONB ->> 'bucket_id',
  :'bw8a_reserve_first'::JSONB ->> 'object_name'
);

SELECT extensions.dblink_exec('bw8a_export_1', 'BEGIN');
SELECT extensions.dblink_send_query(
  'bw8a_export_1',
  pg_catalog.format(
    'SELECT platform.finalize_student_profile_export_storage(%L::UUID, %L::UUID, %L, %s::BIGINT, %L::UUID)',
    :'bw8a_org',
    :'bw8a_reserve_first'::JSONB ->> 'storage_reservation_id',
    repeat('d', 64), 1024,
    '59000000-0000-4000-8000-000000000723'
  )
);
SELECT remote.result::TEXT AS bw8a_finalize_first
FROM extensions.dblink_get_result('bw8a_export_1') AS remote(result JSONB)
\gset
SELECT count(*)
FROM extensions.dblink_get_result('bw8a_export_1') AS drained(result JSONB);

SELECT extensions.dblink_send_query(
  'bw8a_export_2',
  pg_catalog.format(
    'SELECT platform.finalize_student_profile_export_storage(%L::UUID, %L::UUID, %L, %s::BIGINT, %L::UUID)',
    :'bw8a_org',
    :'bw8a_reserve_first'::JSONB ->> 'storage_reservation_id',
    repeat('d', 64), 1024,
    '59000000-0000-4000-8000-000000000724'
  )
);
SELECT pg_catalog.pg_sleep(0.2);
SELECT pg_temp.assert_true(
  extensions.dblink_is_busy('bw8a_export_2') = 1,
  'second export finalization did not wait on the reservation lock'
);
SELECT extensions.dblink_exec('bw8a_export_1', 'COMMIT');
SELECT remote.result::TEXT AS bw8a_finalize_second
FROM extensions.dblink_get_result('bw8a_export_2') AS remote(result JSONB)
\gset
SELECT count(*)
FROM extensions.dblink_get_result('bw8a_export_2') AS drained(result JSONB);

SELECT pg_temp.assert_true(
  :'bw8a_finalize_first'::JSONB ->> 'storage_binding_id'
      = :'bw8a_finalize_second'::JSONB ->> 'storage_binding_id'
    AND (:'bw8a_finalize_first'::JSONB ->> 'deduplicated')::BOOLEAN = FALSE
    AND (:'bw8a_finalize_second'::JSONB ->> 'deduplicated')::BOOLEAN = TRUE,
  'concurrent finalize calls did not converge on one binding'
);

SET request.jwt.claims TO :'bw8a_curator_claims';
SET ROLE authenticated;
SELECT platform.grant_student_profile_export_download(
  :'bw8a_org', :'bw8a_profile_export_id',
  'Synthetic one-time download concurrency proof', 300,
  '59000000-0000-4000-8000-000000000725'
)::TEXT AS bw8a_download_grant
\gset
RESET ROLE;

SELECT extensions.dblink_exec('bw8a_export_1', 'BEGIN');
SELECT extensions.dblink_send_query(
  'bw8a_export_1',
  pg_catalog.format(
    'SELECT platform.consume_student_profile_export_download_grant(%L::UUID, %L, %L::UUID)',
    :'bw8a_download_grant'::JSONB ->> 'download_grant_id',
    :'bw8a_download_grant'::JSONB ->> 'download_token',
    '59000000-0000-4000-8000-000000000726'
  )
);
SELECT remote.result::TEXT AS bw8a_consume_first
FROM extensions.dblink_get_result('bw8a_export_1') AS remote(result JSONB)
\gset
SELECT count(*)
FROM extensions.dblink_get_result('bw8a_export_1') AS drained(result JSONB);

SELECT extensions.dblink_exec('bw8a_export_2', 'BEGIN');
SELECT extensions.dblink_send_query(
  'bw8a_export_2',
  pg_catalog.format(
    'SELECT platform.consume_student_profile_export_download_grant(%L::UUID, %L, %L::UUID)',
    :'bw8a_download_grant'::JSONB ->> 'download_grant_id',
    :'bw8a_download_grant'::JSONB ->> 'download_token',
    '59000000-0000-4000-8000-000000000727'
  )
);
SELECT pg_catalog.pg_sleep(0.2);
SELECT pg_temp.assert_true(
  extensions.dblink_is_busy('bw8a_export_2') = 1,
  'second one-time consume did not wait on the grant lock'
);
SELECT extensions.dblink_exec('bw8a_export_1', 'COMMIT');
SELECT count(*) AS bw8a_consume_loser_rows
FROM extensions.dblink_get_result('bw8a_export_2', FALSE)
  AS remote(result JSONB)
\gset
SELECT pg_temp.assert_true(
  pg_catalog.strpos(
    extensions.dblink_error_message('bw8a_export_2'),
    'Download grant is invalid, expired, or consumed'
  ) > 0
    AND pg_catalog.strpos(
      pg_catalog.lower(extensions.dblink_error_message('bw8a_export_2')),
      'duplicate key'
    ) = 0,
  'consume loser returned a raw database error instead of the domain rejection'
);
SELECT count(*)
FROM extensions.dblink_get_result('bw8a_export_2', FALSE)
  AS drained(result JSONB);
SELECT extensions.dblink_exec('bw8a_export_2', 'ROLLBACK');

SELECT extensions.dblink_send_query(
  'bw8a_export_1',
  pg_catalog.format(
    'SELECT platform.consume_student_profile_export_download_grant(%L::UUID, %L, %L::UUID)',
    :'bw8a_download_grant'::JSONB ->> 'download_grant_id',
    :'bw8a_download_grant'::JSONB ->> 'download_token',
    '59000000-0000-4000-8000-000000000726'
  )
);
SELECT remote.result::TEXT AS bw8a_consume_exact_replay
FROM extensions.dblink_get_result('bw8a_export_1') AS remote(result JSONB)
\gset
SELECT count(*)
FROM extensions.dblink_get_result('bw8a_export_1') AS drained(result JSONB);

SELECT count(*)::TEXT AS bw8a_download_consumption_count
FROM platform_private.student_profile_export_download_consumptions
WHERE download_grant_id = (
  :'bw8a_download_grant'::JSONB ->> 'download_grant_id'
)::UUID
\gset

SELECT pg_temp.assert_true(
  (:'bw8a_consume_first'::JSONB ->> 'consumed')::BOOLEAN = TRUE
    AND :'bw8a_consume_first'::JSONB = :'bw8a_consume_exact_replay'::JSONB
    AND :'bw8a_consume_loser_rows'::BIGINT = 0
    AND :'bw8a_download_consumption_count' = '1',
  'consume replay/race did not produce one stable success and one rejection'
);

SELECT extensions.dblink_disconnect('bw8a_export_1');
SELECT extensions.dblink_disconnect('bw8a_export_2');
DROP EXTENSION dblink;
DROP SCHEMA extensions;

SELECT 'platform student document intelligence concurrency passed' AS result;
