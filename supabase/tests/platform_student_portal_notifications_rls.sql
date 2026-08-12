\set ON_ERROR_STOP on

-- P6B runs only in the disposable authorization database. Every identity,
-- document and reason below is synthetic; no Storage object, provider,
-- WhatsApp session or production service is contacted.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P6B assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'platform_private.can_subscribe_student_portal_notifications(text)',
    'EXECUTE'
  )
    AND NOT has_schema_privilege(
      'authenticated',
      'platform_private',
      'USAGE'
    ),
  'Realtime RLS helper must be executable by the bound policy without exposing the private schema'
);

SELECT
  student_case.organization_id AS org_a_id,
  student_case.id AS case_a_id,
  student_case.student_membership_id AS student_a_membership_id,
  student_case.current_curator_membership_id AS curator_a_membership_id,
  student_case.current_scope_id AS case_a_scope_id,
  student_case.current_scope_version AS case_a_scope_version,
  student_case.target_country AS target_country,
  student_case.target_degree AS target_degree,
  student_case.program_direction AS program_direction
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

-- Earlier exact-boundary workflow suites deliberately rotate Case A's scope
-- and can leave the synthetic Student's latest assignment on the retired
-- version. P6B requires the current live case scope before it can submit the
-- document versions used by this isolated acceptance fixture.
SELECT platform_private.append_scope_event(
  :'org_a_id',
  :'student_a_membership_id',
  :'case_a_scope_id',
  :'case_a_scope_version'::BIGINT,
  TRUE,
  'service',
  NULL,
  'Synthetic P6B current Student case scope grant',
  '46800000-0000-4000-8000-000000000090'
);

SELECT
  membership.id AS admin_a_membership_id,
  profile.auth_user_id AS admin_a_user_id,
  profile.access_version AS admin_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
ORDER BY membership.id
LIMIT 1
\gset

-- The migration-046 authorization suite deliberately leaves this synthetic
-- Student membership blocked after proving that a download grant cannot
-- outlive authority revocation. Restore only that disposable fixture through
-- the accepted Admin boundary before P6B captures the bumped access version.
-- The outer transaction rolls this reactivation back with every other P6B
-- fixture write.
SELECT jsonb_build_object(
  'sub', :'admin_a_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT
)::TEXT AS p6b_admin_setup_claims
\gset

SET request.jwt.claims TO :'p6b_admin_setup_claims';
SET ROLE authenticated;
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = :'org_a_id'
      AND membership.id = :'student_a_membership_id'
      AND membership.status <> 'active'
  )
  THEN platform.change_membership_status(
    :'org_a_id',
    :'student_a_membership_id',
    'active',
    'Synthetic P6B restore after membership revocation proof',
    '46800000-0000-4000-8000-000000000089'
  )
  ELSE NULL::JSONB
END AS p6b_student_reactivation;
RESET ROLE;

SELECT
  profile.auth_user_id AS curator_a_user_id,
  profile.access_version AS curator_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'curator_a_membership_id'
\gset

SELECT
  profile.id AS student_a_profile_id,
  profile.auth_user_id AS student_a_user_id,
  profile.access_version AS student_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'student_a_membership_id'
\gset

SELECT
  student_case.student_membership_id AS student_b_membership_id,
  profile.auth_user_id AS student_b_user_id,
  profile.access_version AS student_b_access_version
FROM platform.student_cases AS student_case
JOIN platform.organization_memberships AS membership
  ON membership.organization_id = student_case.organization_id
  AND membership.id = student_case.student_membership_id
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT
  student_case.organization_id AS org_b_id,
  student_case.student_membership_id AS student_org_b_membership_id,
  profile.auth_user_id AS student_org_b_user_id,
  profile.access_version AS student_org_b_access_version
FROM platform.student_cases AS student_case
JOIN platform.organization_memberships AS membership
  ON membership.organization_id = student_case.organization_id
  AND membership.id = student_case.student_membership_id
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE student_case.source_key = 'synthetic:amocrm:lead:org-b'
\gset

SELECT
  membership.id AS sales_a_membership_id,
  profile.auth_user_id AS sales_a_user_id,
  profile.access_version AS sales_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'sales'
ORDER BY membership.id
LIMIT 1
\gset

SELECT jsonb_build_object(
  'sub', :'admin_a_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT
)::TEXT AS admin_a_claims,
jsonb_build_object(
  'sub', :'curator_a_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_a_access_version'::BIGINT
)::TEXT AS curator_a_claims,
jsonb_build_object(
  'sub', :'student_a_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_a_access_version'::BIGINT
)::TEXT AS student_a_claims,
jsonb_build_object(
  'sub', :'student_a_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version',
    GREATEST(:'student_a_access_version'::BIGINT - 1, 0)
)::TEXT AS student_a_stale_claims,
jsonb_build_object(
  'sub', :'student_b_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_b_access_version'::BIGINT
)::TEXT AS student_b_claims,
jsonb_build_object(
  'sub', :'student_org_b_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_org_b_access_version'::BIGINT
)::TEXT AS student_org_b_claims,
jsonb_build_object(
  'sub', :'sales_a_user_id',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'sales_a_access_version'::BIGINT
)::TEXT AS sales_a_claims,
jsonb_build_object('role', 'service_role')::TEXT AS service_claims
\gset

-- Add one synthetic pending/nonactivated case so the producer eligibility
-- boundary is exercised without weakening the accepted state transition RPCs.
SELECT
  gen_random_uuid()::TEXT AS pending_case_id,
  gen_random_uuid()::TEXT AS pending_case_scope_id
\gset

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version,
  is_active
)
VALUES (
  :'pending_case_scope_id',
  :'org_a_id',
  'student_case',
  :'pending_case_id',
  1,
  TRUE
);

INSERT INTO platform.membership_scope_assignments (
  organization_id,
  membership_id,
  scope_id,
  scope_version,
  assignment_version,
  granted,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
)
VALUES (
  :'org_a_id',
  :'student_a_membership_id',
  :'pending_case_scope_id',
  1,
  1,
  TRUE,
  'service',
  NULL,
  'Synthetic P6B pending case scope grant',
  '46800000-0000-4000-8000-000000000091'
);

INSERT INTO platform.student_cases (
  id,
  organization_id,
  student_membership_id,
  responsible_sales_membership_id,
  source_key,
  contract_confirmation_ref,
  contract_confirmed_at,
  student_display_name,
  target_country,
  target_degree,
  program_direction,
  state,
  current_scope_id,
  current_scope_version
)
VALUES (
  :'pending_case_id',
  :'org_a_id',
  :'student_a_membership_id',
  :'sales_a_membership_id',
  'synthetic:amocrm:lead:p6b-pending',
  'synthetic:p6b:pending:contract',
  statement_timestamp(),
  'Synthetic Pending P6B Student',
  :'target_country',
  :'target_degree',
  :'program_direction',
  'pending',
  :'pending_case_scope_id',
  1
);

-- Create independent current-version review targets through the accepted
-- public/service boundaries: gated publication, legacy-wrapper silence,
-- approved silence, unsafe text containment and eligibility failures.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT (
  platform.create_document_requirement(
    :'org_a_id', :'target_country', :'target_degree', :'program_direction',
    6801, 'p6b_negative', 'P6B Negative Document',
    'Synthetic P6B negative-review requirement',
    '46800000-0000-4000-8000-000000000101'
  ) ->> 'document_requirement_id'
)::TEXT AS negative_requirement_id
\gset
SELECT (
  platform.create_document_requirement(
    :'org_a_id', :'target_country', :'target_degree', :'program_direction',
    6802, 'p6b_approved', 'P6B Approved Document',
    'Synthetic P6B approved-review requirement',
    '46800000-0000-4000-8000-000000000102'
  ) ->> 'document_requirement_id'
)::TEXT AS approved_requirement_id
\gset
SELECT (
  platform.create_document_requirement(
    :'org_a_id', :'target_country', :'target_degree', :'program_direction',
    6803, 'p6b_atomic', 'P6B Atomic Document',
    'Synthetic P6B atomic-failure requirement',
    '46800000-0000-4000-8000-000000000103'
  ) ->> 'document_requirement_id'
)::TEXT AS atomic_requirement_id
\gset
SELECT (
  platform.create_document_requirement(
    :'org_a_id', :'target_country', :'target_degree', :'program_direction',
    6804, 'p6b_unsafe_label', repeat('L', 301),
    'Synthetic P6B unsafe-label requirement',
    '46800000-0000-4000-8000-000000000104'
  ) ->> 'document_requirement_id'
)::TEXT AS unsafe_label_requirement_id
\gset
SELECT (
  platform.create_document_requirement(
    :'org_a_id', :'target_country', :'target_degree', :'program_direction',
    6805, 'p6b_legacy_wrapper', 'P6B Legacy Wrapper Document',
    'Synthetic P6B original-wrapper requirement',
    '46800000-0000-4000-8000-000000000105'
  ) ->> 'document_requirement_id'
)::TEXT AS legacy_wrapper_requirement_id
\gset
SELECT (
  platform.create_document_requirement(
    :'org_a_id', :'target_country', :'target_degree', :'program_direction',
    6806, repeat('k', 129), 'P6B Unsafe Key Document',
    'Synthetic P6B unsafe-key requirement',
    '46800000-0000-4000-8000-000000000106'
  ) ->> 'document_requirement_id'
)::TEXT AS unsafe_key_requirement_id
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT (
  platform.create_document_slot(
    :'org_a_id', :'case_a_id', :'negative_requirement_id',
    NULL, 'Review synthetic P6B negative document',
    '46800000-0000-4000-8000-000000000111'
  ) ->> 'document_slot_id'
)::TEXT AS negative_slot_id
\gset
SELECT (
  platform.create_document_slot(
    :'org_a_id', :'case_a_id', :'approved_requirement_id',
    NULL, 'Review synthetic P6B approved document',
    '46800000-0000-4000-8000-000000000112'
  ) ->> 'document_slot_id'
)::TEXT AS approved_slot_id
\gset
SELECT (
  platform.create_document_slot(
    :'org_a_id', :'case_a_id', :'atomic_requirement_id',
    NULL, 'Review synthetic P6B atomic document',
    '46800000-0000-4000-8000-000000000113'
  ) ->> 'document_slot_id'
)::TEXT AS atomic_slot_id
\gset
SELECT (
  platform.create_document_slot(
    :'org_a_id', :'case_a_id', :'unsafe_label_requirement_id',
    NULL, 'Review synthetic P6B unsafe-label document',
    '46800000-0000-4000-8000-000000000114'
  ) ->> 'document_slot_id'
)::TEXT AS unsafe_label_slot_id
\gset
SELECT (
  platform.create_document_slot(
    :'org_a_id', :'case_a_id', :'legacy_wrapper_requirement_id',
    NULL, 'Review synthetic P6B original-wrapper document',
    '46800000-0000-4000-8000-000000000115'
  ) ->> 'document_slot_id'
)::TEXT AS legacy_wrapper_slot_id
\gset
SELECT (
  platform.create_document_slot(
    :'org_a_id', :'case_a_id', :'unsafe_key_requirement_id',
    NULL, 'Review synthetic P6B unsafe-key document',
    '46800000-0000-4000-8000-000000000116'
  ) ->> 'document_slot_id'
)::TEXT AS unsafe_key_slot_id
\gset
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT (
  platform.create_document_slot(
    :'org_a_id', :'pending_case_id', :'negative_requirement_id',
    NULL, 'Review synthetic P6B pending-case document',
    '46800000-0000-4000-8000-000000000117'
  ) ->> 'document_slot_id'
)::TEXT AS pending_case_slot_id
\gset
RESET ROLE;

-- The long-running authorization database intentionally mutates Student
-- memberships in earlier boundary suites. Use the accepted organization-
-- scoped Admin submitter path so P6B tests only their own review/recipient
-- authorization; Student scope is asserted independently below.
SET request.jwt.claims TO :'service_claims';
SET ROLE service_role;
SELECT (
  platform.record_document_version_metadata(
    :'org_a_id', :'negative_slot_id', :'admin_a_membership_id',
    'p6b-negative-v1.pdf', 'application/pdf', 2048,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'synthetic:p6b:negative:v1',
    '46800000-0000-4000-8000-000000000121'
  ) ->> 'document_version_id'
)::TEXT AS negative_version_v1_id
\gset
SELECT (
  platform.record_document_version_metadata(
    :'org_a_id', :'approved_slot_id', :'admin_a_membership_id',
    'p6b-approved-v1.pdf', 'application/pdf', 2048,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'synthetic:p6b:approved:v1',
    '46800000-0000-4000-8000-000000000122'
  ) ->> 'document_version_id'
)::TEXT AS approved_version_id
\gset
SELECT (
  platform.record_document_version_metadata(
    :'org_a_id', :'atomic_slot_id', :'admin_a_membership_id',
    'p6b-atomic-v1.pdf', 'application/pdf', 2048,
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'synthetic:p6b:atomic:v1',
    '46800000-0000-4000-8000-000000000123'
  ) ->> 'document_version_id'
)::TEXT AS atomic_version_id
\gset
SELECT (
  platform.record_document_version_metadata(
    :'org_a_id', :'unsafe_label_slot_id', :'admin_a_membership_id',
    'p6b-unsafe-label-v1.pdf', 'application/pdf', 2048,
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'synthetic:p6b:unsafe-label:v1',
    '46800000-0000-4000-8000-000000000125'
  ) ->> 'document_version_id'
)::TEXT AS unsafe_label_version_id
\gset
SELECT (
  platform.record_document_version_metadata(
    :'org_a_id', :'legacy_wrapper_slot_id', :'admin_a_membership_id',
    'p6b-legacy-wrapper-v1.pdf', 'application/pdf', 2048,
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'synthetic:p6b:legacy-wrapper:v1',
    '46800000-0000-4000-8000-000000000126'
  ) ->> 'document_version_id'
)::TEXT AS legacy_wrapper_version_id
\gset
SELECT (
  platform.record_document_version_metadata(
    :'org_a_id', :'unsafe_key_slot_id', :'admin_a_membership_id',
    'p6b-unsafe-key-v1.pdf', 'application/pdf', 2048,
    '9999999999999999999999999999999999999999999999999999999999999999',
    'synthetic:p6b:unsafe-key:v1',
    '46800000-0000-4000-8000-000000000127'
  ) ->> 'document_version_id'
)::TEXT AS unsafe_key_version_id
\gset
SELECT (
  platform.record_document_version_metadata(
    :'org_a_id', :'pending_case_slot_id', :'admin_a_membership_id',
    'p6b-pending-case-v1.pdf', 'application/pdf', 2048,
    '8888888888888888888888888888888888888888888888888888888888888888',
    'synthetic:p6b:pending-case:v1',
    '46800000-0000-4000-8000-000000000128'
  ) ->> 'document_version_id'
)::TEXT AS pending_case_version_id
\gset
SELECT platform.attest_document_validation(
  :'org_a_id', :'approved_version_id', 'verified', 'clean',
  'synthetic-p6b-scanner', 'synthetic:p6b:approved:validation',
  '46800000-0000-4000-8000-000000000124'
);
RESET ROLE;

-- Absence of a private runtime-control row is the disabled default. The gated
-- RPC fails before the legacy review mutation and leaves no source/projection.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SAVEPOINT expect_default_off_denied;
\set ON_ERROR_STOP off
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'negative_version_v1_id', 'correction_required',
  'Please replace the synthetic scan with a legible copy.',
  '46800000-0000-4000-8000-000000000129'
);
\set default_off_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_default_off_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_default_off_denied;
RESET ROLE;

SELECT pg_temp.assert_true(
  :'default_off_state' = '55000'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.document_reviews AS review
      WHERE review.request_id = '46800000-0000-4000-8000-000000000129'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.student_portal_notification_projection_v1
    )
    AND (
      SELECT slot.status = 'submitted'
      FROM platform.document_slots AS slot
      WHERE slot.id = :'negative_slot_id'
    ),
  'P6B default-off gate mutated a review or notification'
);

INSERT INTO platform_private.student_portal_notification_runtime_controls (
  organization_id,
  enabled
)
VALUES (:'org_a_id', TRUE);

-- Enabling P6B does not change the accepted 043 signature: the original RPC
-- still performs the legacy review but cannot arm the publication trigger.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT platform.review_document_version(
  :'org_a_id', :'legacy_wrapper_version_id', 'correction_required',
  'Synthetic original-wrapper review remains nonpublishing.',
  '46800000-0000-4000-8000-000000000130'
)::TEXT AS legacy_wrapper_review_result
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'legacy_wrapper_review_result'::JSONB ->> 'decision' =
      'correction_required'
    AND EXISTS (
      SELECT 1
      FROM platform.document_reviews AS review
      WHERE review.request_id = '46800000-0000-4000-8000-000000000130'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.student_portal_notification_projection_v1 AS projection
      JOIN platform.document_reviews AS review
        ON review.id = projection.source_record_id
      WHERE review.request_id = '46800000-0000-4000-8000-000000000130'
    ),
  'original review wrapper unexpectedly armed P6B publication'
);

-- One authorized gated negative review atomically publishes one notification,
-- private projection, created event and ID-free private invalidation.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'negative_version_v1_id', 'correction_required',
  'Please replace the synthetic scan with a legible copy.',
  '46800000-0000-4000-8000-000000000131'
)::TEXT AS negative_review_result
\gset
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'negative_version_v1_id', 'correction_required',
  'Please replace the synthetic scan with a legible copy.',
  '46800000-0000-4000-8000-000000000131'
)::TEXT AS negative_review_replay
\gset
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'approved_version_id', 'approved', NULL,
  '46800000-0000-4000-8000-000000000132'
)::TEXT AS approved_review_result
\gset
RESET ROLE;

SELECT
  projection.notification_id::TEXT AS negative_notification_id,
  projection.source_record_id::TEXT AS negative_review_id
FROM platform.student_portal_notification_projection_v1 AS projection
JOIN platform.document_reviews AS review
  ON review.id = projection.source_record_id
WHERE review.request_id = '46800000-0000-4000-8000-000000000131'
\gset

SELECT pg_temp.assert_true(
  :'negative_review_result'::JSONB = :'negative_review_replay'::JSONB
    AND (
      SELECT count(*) = 1
      FROM platform.student_portal_notification_projection_v1 AS projection
      WHERE projection.source_record_id = :'negative_review_id'
    )
    AND (
      SELECT count(*) = 1
      FROM platform.notification_events AS event
      WHERE event.notification_id = :'negative_notification_id'
        AND event.event_type = 'created'
        AND event.request_id =
          '46800000-0000-4000-8000-000000000131'
    )
    AND (
      SELECT count(*) = 0
      FROM platform.notification_delivery_intents AS intent
      WHERE intent.notification_id = :'negative_notification_id'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.student_portal_notification_projection_v1 AS projection
      JOIN platform.document_reviews AS review
        ON review.id = projection.source_record_id
      WHERE review.request_id = '46800000-0000-4000-8000-000000000132'
    ),
  'negative review publication, replay, approved silence or zero-intent contract failed'
);

-- The producer revalidates every browser-visible string even when the older
-- review/requirement RPC accepted it. Both failures roll back the source review
-- and slot transition, leaving the one valid notification unchanged.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SAVEPOINT expect_unsafe_label_denied;
\set ON_ERROR_STOP off
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'unsafe_label_version_id', 'rejected',
  'Synthetic safe reason with an oversized configured requirement label.',
  '46800000-0000-4000-8000-000000000134'
);
\set unsafe_label_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_unsafe_label_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_unsafe_label_denied;

SAVEPOINT expect_unsafe_key_denied;
\set ON_ERROR_STOP off
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'unsafe_key_version_id', 'rejected',
  'Synthetic safe reason with an oversized configured requirement key.',
  '46800000-0000-4000-8000-000000000136'
);
\set unsafe_key_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_unsafe_key_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_unsafe_key_denied;

SAVEPOINT expect_control_reason_denied;
\set ON_ERROR_STOP off
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'atomic_version_id', 'rejected',
  'Synthetic first line.' || chr(10) || 'Synthetic second line.',
  '46800000-0000-4000-8000-000000000135'
);
\set control_reason_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_control_reason_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_control_reason_denied;
RESET ROLE;

SELECT pg_temp.assert_true(
  :'unsafe_label_state' = '22023'
    AND :'unsafe_key_state' = '22023'
    AND :'control_reason_state' = '22023'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.document_reviews AS review
      WHERE review.request_id IN (
        '46800000-0000-4000-8000-000000000134',
        '46800000-0000-4000-8000-000000000135',
        '46800000-0000-4000-8000-000000000136'
      )
    )
    AND (
      SELECT count(*) = 1
      FROM platform.student_portal_notification_projection_v1
    ),
  'P6B producer accepted an unsafe label, key or control-character reason'
);

-- A pending case has no activated Portal, so the gated review and its slot
-- transition must roll back instead of creating an unreadable notification.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SAVEPOINT expect_pending_case_denied;
\set ON_ERROR_STOP off
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'pending_case_version_id', 'rejected',
  'Synthetic pending case must not receive a Portal notification.',
  '46800000-0000-4000-8000-000000000138'
);
\set pending_case_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_pending_case_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_pending_case_denied;
RESET ROLE;

SELECT pg_temp.assert_true(
  :'pending_case_state' = '55000'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.document_reviews AS review
      WHERE review.request_id = '46800000-0000-4000-8000-000000000138'
    )
    AND (
      SELECT slot.status = 'submitted'
      FROM platform.document_slots AS slot
      WHERE slot.id = :'pending_case_slot_id'
    ),
  'pending/nonactivated case publication did not roll back atomically'
);

-- The producer uses the latest active student_case scope event for the
-- recipient. A later revoke makes publication fail and rolls the review back.
SAVEPOINT expect_revoked_student_scope_denied;
INSERT INTO platform.membership_scope_assignments (
  organization_id,
  membership_id,
  scope_id,
  scope_version,
  assignment_version,
  granted,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
)
VALUES (
  :'org_a_id',
  :'student_a_membership_id',
  :'case_a_scope_id',
  :'case_a_scope_version',
  (
    SELECT COALESCE(MAX(assignment.assignment_version), 0) + 1
    FROM platform.membership_scope_assignments AS assignment
    WHERE assignment.organization_id = :'org_a_id'
      AND assignment.membership_id = :'student_a_membership_id'
      AND assignment.scope_id = :'case_a_scope_id'
  ),
  FALSE,
  'service',
  NULL,
  'Synthetic P6B latest student scope revoke',
  '46800000-0000-4000-8000-000000000139'
);
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'atomic_version_id', 'rejected',
  'Synthetic revoked-scope publication failure.',
  '46800000-0000-4000-8000-000000000140'
);
\set revoked_student_scope_state :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT expect_revoked_student_scope_denied;
RESET ROLE;
RELEASE SAVEPOINT expect_revoked_student_scope_denied;

SELECT pg_temp.assert_true(
  :'revoked_student_scope_state' = '55000'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.document_reviews AS review
      WHERE review.request_id = '46800000-0000-4000-8000-000000000140'
    )
    AND (
      SELECT slot.status = 'submitted'
      FROM platform.document_slots AS slot
      WHERE slot.id = :'atomic_slot_id'
    ),
  'latest revoked Student case scope did not fail and roll back'
);

-- If the live Student recipient disappears, the trigger rejects publication;
-- the review insert and preceding slot update are rolled back with it.
SAVEPOINT expect_atomic_publication_failure;
UPDATE platform.profiles
SET status = 'blocked'
WHERE id = :'student_a_profile_id';
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'atomic_version_id', 'rejected',
  'Synthetic atomic publication failure.',
  '46800000-0000-4000-8000-000000000133'
);
\set atomic_publication_state :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT expect_atomic_publication_failure;
RESET ROLE;
RELEASE SAVEPOINT expect_atomic_publication_failure;

SELECT pg_temp.assert_true(
  :'atomic_publication_state' = '55000'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.document_reviews AS review
      WHERE review.request_id = '46800000-0000-4000-8000-000000000133'
    )
    AND (
      SELECT slot.status = 'submitted'
      FROM platform.document_slots AS slot
      WHERE slot.id = :'atomic_slot_id'
    )
    AND (
      SELECT count(*) = 1
      FROM platform.student_portal_notification_projection_v1
    ),
  'review and notification publication were not atomic'
);

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT platform.review_document_version_with_portal_notification_v1(
  :'org_a_id', :'atomic_version_id', 'rejected',
  'The synthetic document does not satisfy this requirement.',
  '46800000-0000-4000-8000-000000000137'
)::TEXT AS rejected_review_result
\gset
RESET ROLE;

SELECT projection.notification_id::TEXT AS rejected_notification_id
FROM platform.student_portal_notification_projection_v1 AS projection
JOIN platform.document_reviews AS review
  ON review.id = projection.source_record_id
WHERE review.request_id = '46800000-0000-4000-8000-000000000137'
\gset

SELECT pg_temp.assert_true(
  :'rejected_review_result'::JSONB ->> 'decision' = 'rejected'
    AND (
      SELECT projection.review_decision = 'rejected'
      FROM platform.student_portal_notification_projection_v1 AS projection
      WHERE projection.notification_id = :'rejected_notification_id'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.notification_delivery_intents AS intent
      WHERE intent.notification_id = :'rejected_notification_id'
    ),
  'rejected review did not publish exactly one in-app-only projection'
);

-- A later version must replace, not duplicate, the staff review row for the
-- same slot. The durable notification still refers privately to its exact
-- source review while the staff action targets only the current version.
SET request.jwt.claims TO :'service_claims';
SET ROLE service_role;
SELECT (
  platform.record_document_version_metadata(
    :'org_a_id', :'negative_slot_id', :'admin_a_membership_id',
    'p6b-negative-v2.pdf', 'application/pdf', 3072,
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'synthetic:p6b:negative:v2',
    '46800000-0000-4000-8000-000000000141'
  ) ->> 'document_version_id'
)::TEXT AS negative_version_v2_id
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS current_staff_document_count,
       min(document_version_id::TEXT) AS current_staff_document_version_id
FROM platform.staff_student_case_documents(:'case_a_id')
WHERE document_slot_id = :'negative_slot_id'
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'current_staff_document_count'::INTEGER = 1
    AND :'current_staff_document_version_id' = :'negative_version_v2_id',
  'staff document projection did not bind the exact current version'
);

-- Migration 068 preserves acknowledgement for an unread legacy two-intent
-- notification but makes the legacy RPC unavailable for every P6B row. Its
-- renamed delegate is not directly executable by browser roles.
SELECT notification.id::TEXT AS unread_legacy_notification_id
FROM platform.notifications AS notification
WHERE notification.organization_id = :'org_a_id'
  AND notification.recipient_membership_id = :'student_a_membership_id'
  AND notification.read_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM platform.student_portal_notification_projection_v1 AS projection
    WHERE projection.organization_id = notification.organization_id
      AND projection.notification_id = notification.id
  )
  AND (
    SELECT count(*)
    FROM platform.notification_delivery_intents AS intent
    WHERE intent.organization_id = notification.organization_id
      AND intent.notification_id = notification.id
      AND intent.channel IN ('in_app', 'individual_whatsapp')
  ) = 2
ORDER BY notification.created_at, notification.id
LIMIT 1
\gset

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT platform.mark_own_notification_read(
  :'org_a_id', :'unread_legacy_notification_id',
  '46800000-0000-4000-8000-000000000145'
)::TEXT AS legacy_ack_result
\gset
SAVEPOINT expect_legacy_p6b_ack_denied;
\set ON_ERROR_STOP off
SELECT platform.mark_own_notification_read(
  :'org_a_id', :'negative_notification_id',
  '46800000-0000-4000-8000-000000000146'
);
\set legacy_p6b_ack_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_legacy_p6b_ack_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_legacy_p6b_ack_denied;
SAVEPOINT expect_legacy_delegate_denied;
\set ON_ERROR_STOP off
SELECT platform_private.mark_own_notification_read_legacy_043(
  :'org_a_id', :'unread_legacy_notification_id',
  '46800000-0000-4000-8000-000000000147'
);
\set legacy_delegate_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_legacy_delegate_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_legacy_delegate_denied;
RESET ROLE;

SELECT pg_temp.assert_true(
  :'legacy_ack_result'::JSONB ->> 'notification_id' =
      :'unread_legacy_notification_id'
    AND :'legacy_ack_result'::JSONB ->> 'read_at' IS NOT NULL
    AND :'legacy_p6b_ack_state' = '42501'
    AND :'legacy_delegate_state' = '42501',
  'legacy compatibility or P6B legacy-ack containment failed'
);

-- Direct projection access and cross-actor acknowledgement fail closed.
SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS same_org_other_student_read_count
FROM platform.student_portal_notifications_v1()
WHERE notification_id = :'negative_notification_id'
\gset
SAVEPOINT expect_same_org_ack_denied;
\set ON_ERROR_STOP off
SELECT platform.mark_own_student_portal_notification_read_v1(
  :'negative_notification_id',
  '46800000-0000-4000-8000-000000000151'
);
\set same_org_ack_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_same_org_ack_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_same_org_ack_denied;
RESET ROLE;

SET request.jwt.claims TO :'student_org_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS cross_org_student_read_count
FROM platform.student_portal_notifications_v1()
WHERE notification_id = :'negative_notification_id'
\gset
SAVEPOINT expect_cross_org_ack_denied;
\set ON_ERROR_STOP off
SELECT platform.mark_own_student_portal_notification_read_v1(
  :'negative_notification_id',
  '46800000-0000-4000-8000-000000000152'
);
\set cross_org_ack_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_cross_org_ack_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_cross_org_ack_denied;
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS wrong_role_read_count
FROM platform.student_portal_notifications_v1()
WHERE notification_id = :'negative_notification_id'
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_a_stale_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS stale_actor_read_count
FROM platform.student_portal_notifications_v1()
WHERE notification_id = :'negative_notification_id'
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SAVEPOINT expect_direct_projection_denied;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform.student_portal_notification_projection_v1;
\set direct_projection_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_direct_projection_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_direct_projection_denied;
SAVEPOINT expect_private_helper_denied;
\set ON_ERROR_STOP off
SELECT platform_private.can_subscribe_student_portal_notifications(
  'platform-portal-notifications:' || :'org_a_id' || ':'
    || :'student_a_membership_id'
);
\set private_helper_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_private_helper_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_private_helper_denied;
SAVEPOINT expect_runtime_control_denied;
\set ON_ERROR_STOP off
SELECT enabled
FROM platform_private.student_portal_notification_runtime_controls
WHERE organization_id = :'org_a_id';
\set runtime_control_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_runtime_control_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_runtime_control_denied;
RESET ROLE;

SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
SAVEPOINT expect_anon_projection_denied;
\set ON_ERROR_STOP off
SELECT * FROM platform.student_portal_notifications_v1();
\set anon_projection_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_anon_projection_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_anon_projection_denied;
RESET ROLE;

SELECT pg_temp.assert_true(
  :'same_org_other_student_read_count'::INTEGER = 0
    AND :'cross_org_student_read_count'::INTEGER = 0
    AND :'wrong_role_read_count'::INTEGER = 0
    AND :'stale_actor_read_count'::INTEGER = 0
    AND :'same_org_ack_state' = '42501'
    AND :'cross_org_ack_state' = '42501'
    AND :'direct_projection_state' = '42501'
    AND :'private_helper_state' = '42501'
    AND :'runtime_control_state' = '42501'
    AND :'anon_projection_state' = '42501',
  'self-only read/ack authority or private projection containment failed'
);

-- The intended Student receives exactly the frozen safe row contract, then a
-- replay-safe one-way read transition with exact three-key JSON evidence.
SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT to_jsonb(notification_row)::TEXT AS own_notification_row
FROM platform.student_portal_notifications_v1() AS notification_row
WHERE notification_row.notification_id = :'negative_notification_id'
\gset
SELECT count(*)::TEXT AS own_rejected_notification_count
FROM platform.student_portal_notifications_v1() AS notification_row
WHERE notification_row.notification_id = :'rejected_notification_id'
  AND notification_row.review_decision = 'rejected'
\gset
SELECT count(*)::TEXT AS p6b_legacy_list_count
FROM platform.my_notifications()
WHERE notification_id = :'negative_notification_id'
\gset
SELECT platform.mark_own_student_portal_notification_read_v1(
  :'negative_notification_id',
  '46800000-0000-4000-8000-000000000153'
)::TEXT AS own_ack_result
\gset
SELECT platform.mark_own_student_portal_notification_read_v1(
  :'negative_notification_id',
  '46800000-0000-4000-8000-000000000153'
)::TEXT AS own_ack_replay
\gset
SELECT to_jsonb(notification_row)::TEXT AS own_notification_after_ack
FROM platform.student_portal_notifications_v1() AS notification_row
WHERE notification_row.notification_id = :'negative_notification_id'
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 8
    FROM jsonb_object_keys(:'own_notification_row'::JSONB)
  )
    AND :'own_notification_row'::JSONB ?& ARRAY[
      'notification_id', 'category', 'review_decision', 'requirement_key',
      'requirement_label', 'reason', 'created_at', 'read_at'
    ]
    AND :'own_notification_row'::JSONB ->> 'category' = 'document.review'
    AND :'own_notification_row'::JSONB ->> 'review_decision' =
      'correction_required'
    AND :'own_notification_row'::JSONB ->> 'requirement_key' = 'p6b_negative'
    AND :'own_notification_row'::JSONB ->> 'read_at' IS NULL
    AND :'own_rejected_notification_count'::INTEGER = 1
    AND :'p6b_legacy_list_count'::INTEGER = 0
    AND (
      SELECT count(*) = 3
      FROM jsonb_object_keys(:'own_ack_result'::JSONB)
    )
    AND :'own_ack_result'::JSONB ?&
      ARRAY['notification_id', 'is_read', 'read_at']
    AND (:'own_ack_result'::JSONB ->> 'is_read')::BOOLEAN
    AND :'own_ack_result'::JSONB = :'own_ack_replay'::JSONB
    AND :'own_notification_after_ack'::JSONB ->> 'read_at' IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM platform.audit_events AS event
      WHERE event.request_id = '46800000-0000-4000-8000-000000000153'
        AND event.action = 'notification.read'
        AND event.resource_type = 'notification'
        AND event.resource_id = :'negative_notification_id'
        AND event.after_state = :'own_ack_result'::JSONB
    )
    AND position('student_case_id' IN :'own_notification_row') = 0
    AND position('source_record_id' IN :'own_notification_row') = 0
    AND position('document_version_id' IN :'own_notification_row') = 0
    AND position('reviewer' IN :'own_notification_row') = 0
    AND position('topic' IN :'own_notification_row') = 0
    AND position('provider' IN :'own_notification_row') = 0
    AND (
      SELECT count(*) = 2
      FROM platform.notification_events AS event
      WHERE event.notification_id = :'negative_notification_id'
        AND event.event_type IN ('created', 'read')
    ),
  'safe Student row shape, read transition, replay or audit event failed'
);

-- Live membership status is rechecked. Roll back the synthetic status change
-- so the shared authorization fixture is not mutated after this proof.
SAVEPOINT expect_inactive_student_denied;
UPDATE platform.organization_memberships
SET status = 'inactive'
WHERE organization_id = :'org_a_id'
  AND id = :'student_a_membership_id';
SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS inactive_student_read_count
FROM platform.student_portal_notifications_v1()
\gset
SAVEPOINT expect_inactive_ack_denied;
\set ON_ERROR_STOP off
SELECT platform.mark_own_student_portal_notification_read_v1(
  :'negative_notification_id',
  '46800000-0000-4000-8000-000000000154'
);
\set inactive_ack_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_inactive_ack_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_inactive_ack_denied;
RESET ROLE;
ROLLBACK TO SAVEPOINT expect_inactive_student_denied;
RELEASE SAVEPOINT expect_inactive_student_denied;

-- The public reader is deterministic and hard-capped. Seed 501 fully linked
-- synthetic rows inside a savepoint, prove only the newest 500 are returned,
-- then roll every boundary row and its Realtime invalidation back.
SAVEPOINT prove_notification_reader_limit;
CREATE TEMP TABLE p6b_notification_limit_rows ON COMMIT DROP AS
SELECT
  sequence_no,
  gen_random_uuid() AS review_id,
  gen_random_uuid() AS notification_id,
  gen_random_uuid() AS review_request_id,
  statement_timestamp() + INTERVAL '1 day'
    - (sequence_no * INTERVAL '1 millisecond') AS created_at
FROM generate_series(1, 501) AS series(sequence_no);

INSERT INTO platform.document_reviews (
  id,
  organization_id,
  student_case_id,
  document_slot_id,
  document_version_id,
  decision,
  reason,
  reviewer_membership_id,
  request_id,
  created_at
)
SELECT
  boundary.review_id,
  :'org_a_id',
  :'case_a_id',
  :'negative_slot_id',
  :'negative_version_v1_id',
  'rejected',
  'Synthetic P6B pagination boundary row',
  :'curator_a_membership_id',
  boundary.review_request_id,
  boundary.created_at
FROM p6b_notification_limit_rows AS boundary;

INSERT INTO platform.notifications (
  id,
  organization_id,
  student_case_id,
  recipient_membership_id,
  category,
  title,
  body,
  dedupe_key,
  created_by_membership_id,
  created_at,
  updated_at
)
SELECT
  boundary.notification_id,
  :'org_a_id',
  :'case_a_id',
  :'student_a_membership_id',
  'document.review',
  'Synthetic pagination boundary',
  'Synthetic P6B pagination boundary row',
  'synthetic:p6b:pagination:' || boundary.sequence_no::TEXT,
  :'curator_a_membership_id',
  boundary.created_at,
  boundary.created_at
FROM p6b_notification_limit_rows AS boundary;

INSERT INTO platform.student_portal_notification_projection_v1 (
  notification_id,
  organization_id,
  student_case_id,
  recipient_membership_id,
  source_record_id,
  document_slot_id,
  document_version_id,
  document_requirement_id,
  review_decision,
  created_at
)
SELECT
  boundary.notification_id,
  :'org_a_id',
  :'case_a_id',
  :'student_a_membership_id',
  boundary.review_id,
  :'negative_slot_id',
  :'negative_version_v1_id',
  :'negative_requirement_id',
  'rejected',
  boundary.created_at
FROM p6b_notification_limit_rows AS boundary;

SELECT count(*)::TEXT AS boundary_projection_count
FROM platform.student_portal_notification_projection_v1 AS projection
JOIN p6b_notification_limit_rows AS boundary
  ON boundary.review_id = projection.source_record_id
\gset

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS boundary_reader_count
FROM platform.student_portal_notifications_v1() AS notification_row
WHERE notification_row.reason = 'Synthetic P6B pagination boundary row'
\gset
RESET ROLE;

ROLLBACK TO SAVEPOINT prove_notification_reader_limit;
RELEASE SAVEPOINT prove_notification_reader_limit;

SELECT pg_temp.assert_true(
  :'boundary_projection_count'::INTEGER = 501
    AND :'boundary_reader_count'::INTEGER = 500,
  'Student Portal notification reader did not enforce the 500-row boundary'
);

-- The two review triggers and acknowledgement emit only three empty private
-- invalidations.
SELECT
  'platform-portal-notifications:' || :'org_a_id' || ':'
    || :'student_a_membership_id' AS student_a_topic,
  'platform-portal-notifications:' || :'org_a_id' || ':'
    || :'student_b_membership_id' AS student_b_topic,
  'platform-portal-notifications:' || :'org_b_id' || ':'
    || :'student_org_b_membership_id' AS student_org_b_topic
\gset

SET request.jwt.claims TO :'student_a_claims';
SELECT set_config('realtime.topic', :'student_a_topic', TRUE);
SET ROLE authenticated;
SELECT count(*)::TEXT AS own_realtime_count
FROM realtime.messages
WHERE topic = :'student_a_topic'
  AND extension = 'broadcast'
\gset
SELECT count(*)::TEXT AS own_realtime_total
FROM realtime.messages
\gset
SAVEPOINT expect_realtime_insert_denied;
\set ON_ERROR_STOP off
INSERT INTO realtime.messages (topic, extension, payload, event, private)
VALUES (:'student_a_topic', 'broadcast', '{}', 'invalidate', TRUE);
\set realtime_insert_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_realtime_insert_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_realtime_insert_denied;
SAVEPOINT expect_realtime_send_denied;
\set ON_ERROR_STOP off
SELECT realtime.send('{}', 'invalidate', :'student_a_topic', TRUE);
\set realtime_send_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_realtime_send_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_realtime_send_denied;
RESET ROLE;

SET request.jwt.claims TO :'student_b_claims';
SELECT set_config('realtime.topic', :'student_a_topic', TRUE);
SET ROLE authenticated;
SELECT count(*)::TEXT AS same_org_other_student_realtime_count
FROM realtime.messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_org_b_claims';
SELECT set_config('realtime.topic', :'student_a_topic', TRUE);
SET ROLE authenticated;
SELECT count(*)::TEXT AS cross_org_student_realtime_count
FROM realtime.messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_a_stale_claims';
SELECT set_config('realtime.topic', :'student_a_topic', TRUE);
SET ROLE authenticated;
SELECT count(*)::TEXT AS stale_student_realtime_count
FROM realtime.messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SELECT set_config(
  'realtime.topic',
  'platform-portal-notifications:not-a-uuid:not-a-uuid',
  TRUE
);
SET ROLE authenticated;
SELECT count(*)::TEXT AS malformed_topic_realtime_count
FROM realtime.messages
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'inactive_student_read_count'::INTEGER = 0
    AND :'inactive_ack_state' = '42501'
    AND :'own_realtime_count'::INTEGER = 3
    AND :'own_realtime_total'::INTEGER = :'own_realtime_count'::INTEGER
    AND :'same_org_other_student_realtime_count'::INTEGER = 0
    AND :'cross_org_student_realtime_count'::INTEGER = 0
    AND :'stale_student_realtime_count'::INTEGER = 0
    AND :'malformed_topic_realtime_count'::INTEGER = 0
    AND :'realtime_insert_state' = '42501'
    AND :'realtime_send_state' = '42501'
    AND (
      SELECT count(*) = 3
        AND bool_and(message.event = 'invalidate')
        AND bool_and(message.private)
        AND bool_and(message.payload = '{}'::JSONB)
      FROM realtime.messages AS message
      WHERE message.topic = :'student_a_topic'
    ),
  'private Realtime invalidation payload or membership authorization failed'
);

RESET request.jwt.claims;
ROLLBACK;
