\set ON_ERROR_STOP on

-- Migration 128 Student upload admission acceptance. All synthetic mutations
-- remain inside this transaction; the authorization database is disposable,
-- but rollback keeps later migration gates independent from these limits.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.e5a_assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'E5A assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.e5a_capture_admission(
  p_organization_id UUID,
  p_document_slot_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  response JSONB;
BEGIN
  SELECT platform.admit_student_document_upload_scan(
    p_organization_id,
    p_document_slot_id,
    p_request_id
  ) INTO response;
  RETURN jsonb_build_object(
    'state', '00000',
    'message', NULL,
    'data', response
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'state', SQLSTATE,
    'message', SQLERRM,
    'data', NULL
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.e5a_capture_completion(
  p_organization_id UUID,
  p_actor_auth_user_id UUID,
  p_admission_id UUID,
  p_request_id UUID,
  p_outcome TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  response JSONB;
BEGIN
  SELECT platform.complete_student_document_upload_scan_admission(
    p_organization_id,
    p_actor_auth_user_id,
    p_admission_id,
    p_request_id,
    p_outcome
  ) INTO response;
  RETURN jsonb_build_object(
    'state', '00000',
    'message', NULL,
    'data', response
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'state', SQLSTATE,
    'message', SQLERRM,
    'data', NULL
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.e5a_capture_claim(
  p_organization_id UUID,
  p_actor_auth_user_id UUID,
  p_admission_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  response JSONB;
BEGIN
  SELECT platform.claim_student_document_upload_scan(
    p_organization_id,
    p_actor_auth_user_id,
    p_admission_id,
    p_request_id
  ) INTO response;
  RETURN jsonb_build_object(
    'state', '00000',
    'message', NULL,
    'data', response
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'state', SQLSTATE,
    'message', SQLERRM,
    'data', NULL
  );
END
$$;

REVOKE ALL ON FUNCTION pg_temp.e5a_assert_true(BOOLEAN, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.e5a_assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION pg_temp.e5a_capture_admission(UUID, UUID, UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.e5a_capture_admission(UUID, UUID, UUID)
  TO authenticated;
REVOKE ALL ON FUNCTION pg_temp.e5a_capture_claim(UUID, UUID, UUID, UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.e5a_capture_claim(UUID, UUID, UUID, UUID)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION pg_temp.e5a_capture_completion(
  UUID, UUID, UUID, UUID, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.e5a_capture_completion(
  UUID, UUID, UUID, UUID, TEXT
) TO authenticated, service_role;

-- The browser can admit only; completion and the private ledger stay service
-- owned. service_role can complete but cannot open a scan admission itself.
SELECT pg_temp.e5a_assert_true(
  has_function_privilege(
    'authenticated',
    'platform.admit_student_document_upload_scan(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.claim_student_document_upload_scan(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.complete_student_document_upload_scan_admission(uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.complete_student_document_upload_scan_admission(uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.admit_student_document_upload_scan(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.claim_student_document_upload_scan(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'private.claim_student_document_upload_scan(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.complete_student_document_upload_scan_admission(uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'private.complete_student_document_upload_scan_admission(uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'admission/completion execute privileges drifted'
);

SELECT pg_temp.e5a_assert_true(
  NOT has_table_privilege(
    'authenticated',
    'platform_private.student_document_scan_admissions',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.student_document_scan_admissions',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.student_document_scan_admissions',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.student_document_scan_admissions',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.student_document_scan_admissions',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.student_document_scan_admissions',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.student_document_scan_admissions',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.student_document_scan_admissions',
    'DELETE'
  ),
  'private scan ledger became directly accessible'
);

SELECT
  student_case.organization_id AS e5a_org_id,
  student_case.id AS e5a_case_id,
  student_case.student_membership_id AS e5a_student_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT
  student_case.id AS e5a_foreign_case_id,
  student_case.student_membership_id AS e5a_foreign_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'e5a_org_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

-- Migration 083 removed browser membership lifecycle mutation. Restore only
-- this disposable Student owner, then derive the full freshness tuple.
WITH changed_membership AS (
  UPDATE platform.organization_memberships
  SET status = 'active'
  WHERE organization_id = :'e5a_org_id'
    AND id = :'e5a_student_membership_id'
    AND status <> 'active'
  RETURNING profile_id
)
SELECT platform_private.bump_access_version(profile_id)
FROM changed_membership;

SELECT
  profile.id AS e5a_student_profile_id,
  profile.auth_user_id AS e5a_student_user_id,
  profile.access_version AS e5a_student_access_version,
  membership.current_bundle_id AS e5a_student_bundle_id,
  bundle.version AS e5a_student_bundle_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
  AND bundle.role = membership."current_role"
WHERE membership.organization_id = :'e5a_org_id'
  AND membership.id = :'e5a_student_membership_id'
  AND membership.status = 'active'
\gset

SELECT jsonb_build_object(
  'sub', :'e5a_student_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_organization_id', :'e5a_org_id',
  'platform_membership_id', :'e5a_student_membership_id',
  'platform_access_version', :'e5a_student_access_version'::BIGINT,
  'platform_bundle_id', :'e5a_student_bundle_id',
  'platform_bundle_version', :'e5a_student_bundle_version'::BIGINT
)::TEXT AS e5a_student_claims
\gset

-- Three deterministic own slots isolate actor, slot and global counters. One
-- foreign slot exercises ownership without relying on mutable fixture status.
INSERT INTO platform.document_slots (
  id,
  organization_id,
  student_case_id,
  requirement_id,
  status,
  created_by_membership_id,
  intent_kind,
  display_label,
  group_label
)
VALUES
  (
    '58012880-0000-4000-8000-000000000001',
    :'e5a_org_id',
    :'e5a_case_id',
    NULL,
    'required',
    :'e5a_student_membership_id',
    'custom',
    'E5 admission slot A',
    'E5 admission proof'
  ),
  (
    '58012880-0000-4000-8000-000000000002',
    :'e5a_org_id',
    :'e5a_case_id',
    NULL,
    'required',
    :'e5a_student_membership_id',
    'custom',
    'E5 admission slot B',
    'E5 admission proof'
  ),
  (
    '58012880-0000-4000-8000-000000000003',
    :'e5a_org_id',
    :'e5a_case_id',
    NULL,
    'required',
    :'e5a_student_membership_id',
    'custom',
    'E5 admission slot C',
    'E5 admission proof'
  ),
  (
    '58012880-0000-4000-8000-000000000004',
    :'e5a_org_id',
    :'e5a_foreign_case_id',
    NULL,
    'required',
    :'e5a_foreign_membership_id',
    'custom',
    'E5 foreign admission slot',
    'E5 admission proof'
  );

-- A valid own-slot admission is durable; browser claim/completion are denied.
-- service_role claims capacity immediately before ClamAV, can replay that
-- exact claim, and completes idempotently for one terminal outcome.
SET request.jwt.claims TO :'e5a_student_claims';
SET ROLE authenticated;
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000001',
  '58012881-0000-4000-8000-000000000001'
) AS e5a_first_admission
\gset
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000004',
  '58012881-0000-4000-8000-000000000002'
) AS e5a_foreign_admission
\gset
SELECT pg_temp.e5a_capture_completion(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (:'e5a_first_admission'::JSONB -> 'data' ->> 'admission_id')::UUID,
  '58012881-0000-4000-8000-000000000001',
  'completed'
) AS e5a_browser_completion
\gset
SELECT pg_temp.e5a_capture_claim(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (:'e5a_first_admission'::JSONB -> 'data' ->> 'admission_id')::UUID,
  '58012881-0000-4000-8000-000000000001'
) AS e5a_browser_claim
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.e5a_assert_true(
  :'e5a_first_admission'::JSONB ->> 'state' = '00000'
  AND (
    :'e5a_first_admission'::JSONB -> 'data' ->> 'scan_allowed'
  )::BOOLEAN
  AND NOT (
    :'e5a_first_admission'::JSONB -> 'data' ->> 'terminal_replay'
  )::BOOLEAN
  AND (
    :'e5a_first_admission'::JSONB -> 'data' ->> 'attempt_no'
  )::BIGINT = 1
  AND :'e5a_foreign_admission'::JSONB ->> 'state' = '42501'
  AND :'e5a_browser_claim'::JSONB ->> 'state' = '42501'
  AND :'e5a_browser_completion'::JSONB ->> 'state' = '42501',
  'own/foreign admission or browser claim/completion boundary failed'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5a_capture_claim(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (:'e5a_first_admission'::JSONB -> 'data' ->> 'admission_id')::UUID,
  '58012881-0000-4000-8000-000000000001'
) AS e5a_service_claim
\gset
RESET ROLE;
UPDATE platform_private.student_document_scan_admissions
SET
  admitted_at = statement_timestamp() - INTERVAL '14 minutes 40 seconds',
  lease_expires_at = statement_timestamp() + INTERVAL '20 seconds',
  scan_claimed_at = statement_timestamp() - INTERVAL '14 minutes 40 seconds',
  scan_lease_expires_at = statement_timestamp() + INTERVAL '20 seconds'
WHERE id = (
  :'e5a_first_admission'::JSONB -> 'data' ->> 'admission_id'
)::UUID;
SET ROLE service_role;
SELECT pg_temp.e5a_capture_claim(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (:'e5a_first_admission'::JSONB -> 'data' ->> 'admission_id')::UUID,
  '58012881-0000-4000-8000-000000000001'
) AS e5a_service_claim_replay
\gset
SELECT pg_temp.e5a_capture_completion(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (:'e5a_first_admission'::JSONB -> 'data' ->> 'admission_id')::UUID,
  '58012881-0000-4000-8000-000000000001',
  'completed'
) AS e5a_service_completion
\gset
SELECT pg_temp.e5a_capture_completion(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (:'e5a_first_admission'::JSONB -> 'data' ->> 'admission_id')::UUID,
  '58012881-0000-4000-8000-000000000001',
  'completed'
) AS e5a_service_completion_replay
\gset
SELECT pg_temp.e5a_capture_completion(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (:'e5a_first_admission'::JSONB -> 'data' ->> 'admission_id')::UUID,
  '58012881-0000-4000-8000-000000000001',
  'failed'
) AS e5a_service_completion_conflict
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.e5a_assert_true(
  :'e5a_service_claim'::JSONB ->> 'state' = '00000'
  AND NOT (
    :'e5a_service_claim'::JSONB -> 'data' ->> 'scan_claim_replay'
  )::BOOLEAN
  AND (
    :'e5a_service_claim'::JSONB -> 'data' ->> 'scan_allowed'
  )::BOOLEAN
  AND :'e5a_service_claim_replay'::JSONB ->> 'state' = '00000'
  AND (
    :'e5a_service_claim_replay'::JSONB -> 'data'
      ->> 'scan_claim_replay'
  )::BOOLEAN
  AND (
    :'e5a_service_claim_replay'::JSONB -> 'data'
      ->> 'claim_checked_at'
  )::TIMESTAMPTZ > (
    :'e5a_service_claim_replay'::JSONB -> 'data'
      ->> 'scan_claimed_at'
  )::TIMESTAMPTZ
  AND (
    (
      :'e5a_service_claim_replay'::JSONB -> 'data'
        ->> 'scan_lease_expires_at'
    )::TIMESTAMPTZ
    - (
      :'e5a_service_claim_replay'::JSONB -> 'data'
        ->> 'claim_checked_at'
    )::TIMESTAMPTZ
  ) BETWEEN INTERVAL '0.001 seconds' AND INTERVAL '20 seconds'
  AND :'e5a_service_completion'::JSONB ->> 'state' = '00000'
  AND :'e5a_service_completion'::JSONB -> 'data' =
      :'e5a_service_completion_replay'::JSONB -> 'data'
  AND :'e5a_service_completion_conflict'::JSONB ->> 'state' = '23505',
  'service-only scan claim/completion replay contract failed'
);

-- Rejected/failed work can retry with the same stable request identity. The
-- active retry cannot overlap itself and every physical retry increments.
SET request.jwt.claims TO :'e5a_student_claims';
SET ROLE authenticated;
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000002',
  '58012881-0000-4000-8000-000000000003'
) AS e5a_retry_one
\gset
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5a_capture_completion(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (:'e5a_retry_one'::JSONB -> 'data' ->> 'admission_id')::UUID,
  '58012881-0000-4000-8000-000000000003',
  'rejected'
) AS e5a_retry_one_completion
\gset
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'e5a_student_claims';
SET ROLE authenticated;
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000002',
  '58012881-0000-4000-8000-000000000003'
) AS e5a_retry_two
\gset
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000002',
  '58012881-0000-4000-8000-000000000003'
) AS e5a_retry_overlap
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.e5a_assert_true(
  :'e5a_retry_one_completion'::JSONB ->> 'state' = '00000'
  AND :'e5a_retry_two'::JSONB ->> 'state' = '00000'
  AND (
    :'e5a_retry_two'::JSONB -> 'data' ->> 'attempt_no'
  )::BIGINT = 2
  AND (
    :'e5a_retry_two'::JSONB -> 'data' ->> 'request_retry'
  )::BOOLEAN
  AND :'e5a_retry_overlap'::JSONB ->> 'state' = 'PT409',
  'counted retry or overlap rejection failed'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5a_capture_completion(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (:'e5a_retry_two'::JSONB -> 'data' ->> 'admission_id')::UUID,
  '58012881-0000-4000-8000-000000000003',
  'failed'
) AS e5a_retry_two_completion
\gset
RESET ROLE;
RESET request.jwt.claims;

-- An expired attempt permits a new lease. A late completion is tied to the
-- exact admission id and cannot accidentally release the newer attempt.
INSERT INTO platform_private.student_document_scan_admissions (
  id,
  request_id,
  attempt_no,
  organization_id,
  student_case_id,
  document_slot_id,
  uploader_profile_id,
  uploader_membership_id,
  uploader_auth_user_id,
  admitted_at,
  lease_expires_at
)
VALUES (
  '58012882-0000-4000-8000-000000000001',
  '58012881-0000-4000-8000-000000000004',
  1,
  :'e5a_org_id',
  :'e5a_case_id',
  '58012880-0000-4000-8000-000000000003',
  :'e5a_student_profile_id',
  :'e5a_student_membership_id',
  :'e5a_student_user_id',
  statement_timestamp() - INTERVAL '20 minutes',
  statement_timestamp() - INTERVAL '5 minutes'
);

SET request.jwt.claims TO :'e5a_student_claims';
SET ROLE authenticated;
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000003',
  '58012881-0000-4000-8000-000000000004'
) AS e5a_stale_retry
\gset
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5a_capture_completion(
  :'e5a_org_id',
  :'e5a_student_user_id',
  '58012882-0000-4000-8000-000000000001',
  '58012881-0000-4000-8000-000000000004',
  'failed'
) AS e5a_late_completion
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.e5a_assert_true(
  :'e5a_stale_retry'::JSONB ->> 'state' = '00000'
  AND (
    :'e5a_stale_retry'::JSONB -> 'data' ->> 'attempt_no'
  )::BIGINT = 2
  AND :'e5a_late_completion'::JSONB ->> 'state' = '00000'
  AND (
    SELECT released_at IS NULL
    FROM platform_private.student_document_scan_admissions
    WHERE id = (
      :'e5a_stale_retry'::JSONB -> 'data' ->> 'admission_id'
    )::UUID
  ),
  'expired lease retry or late completion isolation failed'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5a_capture_completion(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (:'e5a_stale_retry'::JSONB -> 'data' ->> 'admission_id')::UUID,
  '58012881-0000-4000-8000-000000000004',
  'failed'
) AS e5a_stale_retry_completion
\gset
RESET ROLE;
RESET request.jwt.claims;

-- All HTTP attempts count in rolling windows, even after release. Separate
-- savepoints isolate actor and slot limits from the other acceptance cases.
SAVEPOINT e5a_actor_rate;
INSERT INTO platform_private.student_document_scan_admissions (
  request_id,
  attempt_no,
  organization_id,
  student_case_id,
  document_slot_id,
  uploader_profile_id,
  uploader_membership_id,
  uploader_auth_user_id,
  admitted_at,
  lease_expires_at,
  released_at,
  release_outcome
)
SELECT
  gen_random_uuid(),
  1,
  :'e5a_org_id',
  :'e5a_case_id',
  '58012880-0000-4000-8000-000000000001',
  :'e5a_student_profile_id',
  :'e5a_student_membership_id',
  :'e5a_student_user_id',
  statement_timestamp() - make_interval(secs => n),
  statement_timestamp() - make_interval(secs => n) + INTERVAL '1 minute',
  statement_timestamp() - make_interval(secs => n) + INTERVAL '1 second',
  'failed'
FROM generate_series(1, 60) AS n;
SET request.jwt.claims TO :'e5a_student_claims';
SET ROLE authenticated;
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000002',
  '58012881-0000-4000-8000-000000000005'
) AS e5a_actor_rate_result
\gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.e5a_assert_true(
  :'e5a_actor_rate_result'::JSONB ->> 'state' = 'PT429',
  'rolling actor rate limit failed'
);
ROLLBACK TO SAVEPOINT e5a_actor_rate;

SAVEPOINT e5a_slot_rate;
INSERT INTO platform_private.student_document_scan_admissions (
  request_id,
  attempt_no,
  organization_id,
  student_case_id,
  document_slot_id,
  uploader_profile_id,
  uploader_membership_id,
  uploader_auth_user_id,
  admitted_at,
  lease_expires_at,
  released_at,
  release_outcome
)
SELECT
  gen_random_uuid(),
  1,
  :'e5a_org_id',
  :'e5a_case_id',
  '58012880-0000-4000-8000-000000000002',
  :'e5a_student_profile_id',
  :'e5a_student_membership_id',
  gen_random_uuid(),
  statement_timestamp() - make_interval(secs => n),
  statement_timestamp() - make_interval(secs => n) + INTERVAL '1 minute',
  statement_timestamp() - make_interval(secs => n) + INTERVAL '1 second',
  'rejected'
FROM generate_series(1, 12) AS n;
SET request.jwt.claims TO :'e5a_student_claims';
SET ROLE authenticated;
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000002',
  '58012881-0000-4000-8000-000000000006'
) AS e5a_slot_rate_result
\gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.e5a_assert_true(
  :'e5a_slot_rate_result'::JSONB ->> 'state' = 'PT429',
  'rolling slot rate limit failed'
);
ROLLBACK TO SAVEPOINT e5a_slot_rate;

-- Initial admission never consumes scarce ClamAV capacity. The service-only
-- claim enforces two scans per actor, one per slot and four globally.
SAVEPOINT e5a_actor_capacity;
SET request.jwt.claims TO :'e5a_student_claims';
SET ROLE authenticated;
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000002',
  '58012881-0000-4000-8000-000000000007'
) AS e5a_actor_capacity_admission
\gset
RESET ROLE;
RESET request.jwt.claims;
INSERT INTO platform_private.student_document_scan_admissions (
  request_id, attempt_no, organization_id, student_case_id, document_slot_id,
  uploader_profile_id, uploader_membership_id, uploader_auth_user_id,
  admitted_at, lease_expires_at, scan_claimed_at, scan_lease_expires_at
)
SELECT
  gen_random_uuid(), 1, :'e5a_org_id', :'e5a_case_id',
  '58012880-0000-4000-8000-000000000001',
  :'e5a_student_profile_id', :'e5a_student_membership_id',
  :'e5a_student_user_id', statement_timestamp(),
  statement_timestamp() + INTERVAL '15 minutes', statement_timestamp(),
  statement_timestamp() + INTERVAL '15 minutes'
FROM generate_series(1, 2);
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5a_capture_claim(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (
    :'e5a_actor_capacity_admission'::JSONB -> 'data'
      ->> 'admission_id'
  )::UUID,
  '58012881-0000-4000-8000-000000000007'
) AS e5a_actor_capacity_result
\gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.e5a_assert_true(
  :'e5a_actor_capacity_admission'::JSONB ->> 'state' = '00000'
  AND :'e5a_actor_capacity_result'::JSONB ->> 'state' = 'PT409',
  'service claim actor capacity failed'
);
ROLLBACK TO SAVEPOINT e5a_actor_capacity;

SAVEPOINT e5a_slot_capacity;
SET request.jwt.claims TO :'e5a_student_claims';
SET ROLE authenticated;
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000002',
  '58012881-0000-4000-8000-000000000008'
) AS e5a_slot_capacity_admission
\gset
RESET ROLE;
RESET request.jwt.claims;
INSERT INTO platform_private.student_document_scan_admissions (
  request_id, attempt_no, organization_id, student_case_id, document_slot_id,
  uploader_profile_id, uploader_membership_id, uploader_auth_user_id,
  admitted_at, lease_expires_at, scan_claimed_at, scan_lease_expires_at
)
VALUES (
  gen_random_uuid(), 1, :'e5a_org_id', :'e5a_case_id',
  '58012880-0000-4000-8000-000000000002',
  :'e5a_student_profile_id', :'e5a_student_membership_id', gen_random_uuid(),
  statement_timestamp(), statement_timestamp() + INTERVAL '15 minutes',
  statement_timestamp(), statement_timestamp() + INTERVAL '15 minutes'
);
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5a_capture_claim(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (
    :'e5a_slot_capacity_admission'::JSONB -> 'data'
      ->> 'admission_id'
  )::UUID,
  '58012881-0000-4000-8000-000000000008'
) AS e5a_slot_capacity_result
\gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.e5a_assert_true(
  :'e5a_slot_capacity_admission'::JSONB ->> 'state' = '00000'
  AND :'e5a_slot_capacity_result'::JSONB ->> 'state' = 'PT409',
  'service claim slot capacity failed'
);
ROLLBACK TO SAVEPOINT e5a_slot_capacity;

SAVEPOINT e5a_global_capacity;
SET request.jwt.claims TO :'e5a_student_claims';
SET ROLE authenticated;
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  '58012880-0000-4000-8000-000000000003',
  '58012881-0000-4000-8000-000000000009'
) AS e5a_global_capacity_admission
\gset
RESET ROLE;
RESET request.jwt.claims;
INSERT INTO platform_private.student_document_scan_admissions (
  request_id, attempt_no, organization_id, student_case_id, document_slot_id,
  uploader_profile_id, uploader_membership_id, uploader_auth_user_id,
  admitted_at, lease_expires_at, scan_claimed_at, scan_lease_expires_at
)
SELECT
  gen_random_uuid(), 1, :'e5a_org_id', :'e5a_case_id',
  '58012880-0000-4000-8000-000000000001',
  :'e5a_student_profile_id', :'e5a_student_membership_id', gen_random_uuid(),
  statement_timestamp(), statement_timestamp() + INTERVAL '15 minutes',
  statement_timestamp(), statement_timestamp() + INTERVAL '15 minutes'
FROM generate_series(1, 4);
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5a_capture_claim(
  :'e5a_org_id',
  :'e5a_student_user_id',
  (
    :'e5a_global_capacity_admission'::JSONB -> 'data'
      ->> 'admission_id'
  )::UUID,
  '58012881-0000-4000-8000-000000000009'
) AS e5a_global_capacity_result
\gset
RESET ROLE;
RESET request.jwt.claims;
SELECT pg_temp.e5a_assert_true(
  :'e5a_global_capacity_admission'::JSONB ->> 'state' = '00000'
  AND :'e5a_global_capacity_result'::JSONB ->> 'state' = 'PT409',
  'service claim global capacity failed'
);
ROLLBACK TO SAVEPOINT e5a_global_capacity;

-- A completed admission with the canonical reservation/finalization receipt
-- replays the durable 201 payload and consumes no new scan attempt.
SELECT
  slot.id AS e5a_terminal_slot_id,
  reservation.request_id AS e5a_terminal_request_id,
  version.id AS e5a_terminal_version_id,
  version.version_no AS e5a_terminal_version_no
FROM platform.document_slots AS slot
JOIN platform.document_versions AS version
  ON version.organization_id = slot.organization_id
  AND version.student_case_id = slot.student_case_id
  AND version.document_slot_id = slot.id
  AND version.id = slot.current_version_id
JOIN platform_private.document_upload_reservations AS reservation
  ON reservation.organization_id = version.organization_id
  AND reservation.student_case_id = version.student_case_id
  AND reservation.document_slot_id = version.document_slot_id
  AND reservation.document_version_id = version.id
JOIN platform_private.document_upload_finalizations AS finalization
  ON finalization.organization_id = reservation.organization_id
  AND finalization.upload_reservation_id = reservation.id
  AND finalization.document_version_id = reservation.document_version_id
  AND finalization.published_version_no = version.version_no
WHERE slot.organization_id = :'e5a_org_id'
  AND slot.student_case_id = :'e5a_case_id'
  AND slot.removed_at IS NULL
ORDER BY slot.id
LIMIT 1
\gset

INSERT INTO platform_private.student_document_scan_admissions (
  request_id,
  attempt_no,
  organization_id,
  student_case_id,
  document_slot_id,
  uploader_profile_id,
  uploader_membership_id,
  uploader_auth_user_id,
  admitted_at,
  lease_expires_at,
  released_at,
  release_outcome
)
VALUES (
  :'e5a_terminal_request_id',
  1,
  :'e5a_org_id',
  :'e5a_case_id',
  :'e5a_terminal_slot_id',
  :'e5a_student_profile_id',
  :'e5a_student_membership_id',
  :'e5a_student_user_id',
  statement_timestamp() - INTERVAL '30 seconds',
  statement_timestamp() + INTERVAL '14 minutes',
  statement_timestamp() - INTERVAL '1 second',
  'completed'
);

SET request.jwt.claims TO :'e5a_student_claims';
SET ROLE authenticated;
SELECT pg_temp.e5a_capture_admission(
  :'e5a_org_id',
  :'e5a_terminal_slot_id',
  :'e5a_terminal_request_id'
) AS e5a_terminal_replay
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.e5a_assert_true(
  :'e5a_terminal_replay'::JSONB ->> 'state' = '00000'
  AND (
    :'e5a_terminal_replay'::JSONB -> 'data' ->> 'terminal_replay'
  )::BOOLEAN
  AND NOT (
    :'e5a_terminal_replay'::JSONB -> 'data' ->> 'scan_allowed'
  )::BOOLEAN
  AND (
    :'e5a_terminal_replay'::JSONB -> 'data' ->> 'document_version_id'
  )::UUID = :'e5a_terminal_version_id'
  AND (
    :'e5a_terminal_replay'::JSONB -> 'data' ->> 'version_no'
  )::BIGINT = :'e5a_terminal_version_no'::BIGINT
  AND (
    SELECT count(*) = 1
    FROM platform_private.student_document_scan_admissions
    WHERE request_id = :'e5a_terminal_request_id'
  ),
  'completed terminal replay failed or created another attempt'
);

ROLLBACK;

SELECT 'platform migration 128 Student scan admission acceptance passed'
  AS result;
