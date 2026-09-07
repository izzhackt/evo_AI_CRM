\set ON_ERROR_STOP on

-- Stage E5 runs only after migration 128 in the disposable authorization
-- database. Reuse the synthetic P2H document fixture, add a real scanner proof
-- inside this transaction, and roll every mutation back at the end.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.e5_assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'E5 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.e5_capture_student_grant(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM platform.grant_student_portal_document_download(
    p_organization_id,
    p_document_version_id,
    p_request_id
  );
  RETURN jsonb_build_object('state', '00000', 'message', NULL);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('state', SQLSTATE, 'message', SQLERRM);
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.e5_capture_staff_grant(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM platform.grant_document_download(
    p_organization_id,
    p_document_version_id,
    'student generic bypass denied',
    60,
    p_request_id
  );
  RETURN jsonb_build_object('state', '00000', 'message', NULL);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('state', SQLSTATE, 'message', SQLERRM);
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.e5_capture_student_consume(
  p_document_download_grant_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM platform.consume_student_portal_document_download_grant(
    p_document_download_grant_id,
    p_request_id
  );
  RETURN jsonb_build_object('state', '00000', 'message', NULL);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('state', SQLSTATE, 'message', SQLERRM);
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.e5_capture_staff_consume(
  p_document_download_grant_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM platform.consume_document_download_grant(
    p_document_download_grant_id,
    p_request_id
  );
  RETURN jsonb_build_object('state', '00000', 'message', NULL);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('state', SQLSTATE, 'message', SQLERRM);
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.e5_assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.e5_capture_student_grant(UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.e5_capture_staff_grant(UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.e5_capture_student_consume(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.e5_capture_staff_consume(UUID, UUID)
  TO service_role;

SELECT pg_temp.e5_assert_true(
  to_regprocedure(
    'private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'private.consume_document_download_grant_pre_e5(uuid,uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform.grant_student_portal_document_download(uuid,uuid,uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform.consume_student_portal_document_download_grant(uuid,uuid)'
  ) IS NOT NULL,
  'migration 128 function inventory is incomplete'
);

SELECT pg_temp.e5_assert_true(
  has_function_privilege(
    'authenticated',
    'platform.grant_student_portal_document_download(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.grant_student_portal_document_download(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.grant_student_portal_document_download(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.consume_student_portal_document_download_grant(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.consume_student_portal_document_download_grant(uuid,uuid)',
    'EXECUTE'
  ),
  'Student grant/consume RPC privileges drifted'
);

SELECT pg_temp.e5_assert_true(
  NOT has_function_privilege(
    'authenticated',
    'private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.consume_document_download_grant_pre_e5(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.consume_document_download_grant_pre_e5(uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'private.grant_staff_document_download(uuid,uuid,text,integer,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'private.grant_student_portal_document_download(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.grant_staff_document_download(uuid,uuid,text,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.grant_student_portal_document_download(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'private.consume_staff_document_download_grant(uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'private.consume_student_portal_document_download_grant(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.consume_staff_document_download_grant(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.consume_student_portal_document_download_grant(uuid,uuid)',
    'EXECUTE'
  ),
  'moved core or private role-helper privileges drifted'
);

WITH public_wrappers AS (
  SELECT routine.oid
  FROM pg_proc AS routine
  WHERE routine.oid = ANY (
    ARRAY[
      'platform.grant_document_download(uuid,uuid,text,integer,uuid)'::REGPROCEDURE,
      'platform.grant_student_portal_document_download(uuid,uuid,uuid)'::REGPROCEDURE,
      'platform.consume_document_download_grant(uuid,uuid)'::REGPROCEDURE,
      'platform.consume_student_portal_document_download_grant(uuid,uuid)'::REGPROCEDURE
    ]
  )
), private_authorities AS (
  SELECT routine.oid
  FROM pg_proc AS routine
  WHERE routine.oid = ANY (
    ARRAY[
      'private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)'::REGPROCEDURE,
      'private.consume_document_download_grant_pre_e5(uuid,uuid)'::REGPROCEDURE,
      'private.grant_staff_document_download(uuid,uuid,text,integer,uuid)'::REGPROCEDURE,
      'private.grant_student_portal_document_download(uuid,uuid,uuid)'::REGPROCEDURE,
      'private.consume_staff_document_download_grant(uuid,uuid)'::REGPROCEDURE,
      'private.consume_student_portal_document_download_grant(uuid,uuid)'::REGPROCEDURE
    ]
  )
)
SELECT pg_temp.e5_assert_true(
  NOT EXISTS (
    SELECT 1 FROM public_wrappers
    JOIN pg_proc AS routine USING (oid)
    WHERE routine.prosecdef
      OR array_to_string(routine.proconfig, ',')
        IS DISTINCT FROM 'search_path=""'
  )
  AND NOT EXISTS (
    SELECT 1 FROM private_authorities
    JOIN pg_proc AS routine USING (oid)
    JOIN pg_roles AS owner ON owner.oid = routine.proowner
    WHERE NOT routine.prosecdef
      OR owner.rolname <> 'postgres'
      OR array_to_string(routine.proconfig, ',')
        IS DISTINCT FROM 'search_path=""'
  ),
  'public invoker or private definer boundary drifted'
);

WITH authority_contract AS (
  SELECT
    pg_get_functiondef(
      'private.grant_student_portal_document_download(uuid,uuid,uuid)'
        ::REGPROCEDURE
    ) AS grant_definition,
    pg_get_functiondef(
      'private.consume_student_portal_document_download_grant(uuid,uuid)'
        ::REGPROCEDURE
    ) AS consume_definition
)
SELECT pg_temp.e5_assert_true(
  grant_definition LIKE '%actor.actor_role IS DISTINCT FROM ''student''%'
  AND grant_definition LIKE '%slot.current_version_id = version.id%'
  AND grant_definition LIKE '%document_upload_finalizations%'
  AND grant_definition LIKE '%version.integrity_status = ''verified''%'
  AND grant_definition LIKE '%version.malware_status = ''clean''%'
  AND consume_definition LIKE '%grantee_role IS DISTINCT FROM ''student''%'
  AND consume_definition LIKE '%slot.current_version_id = version.id%'
  AND consume_definition LIKE '%document_upload_finalizations%'
  AND consume_definition LIKE '%version.integrity_status = ''verified''%'
  AND consume_definition LIKE '%version.malware_status = ''clean''%'
  AND consume_definition LIKE '%FOR UPDATE OF slot NOWAIT%',
  'current finalized clean Student authority checks drifted'
)
FROM authority_contract;

-- Resolve the shared synthetic identities and restore the Student fixture only
-- inside this transaction. The accepted Admin command bumps access_version, so
-- Student claims are captured after reactivation.
SELECT
  student_case.organization_id AS org_a_id,
  student_case.id AS case_a_id,
  student_case.student_membership_id AS student_a_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT
  student_case.id AS case_b_id,
  student_case.student_membership_id AS student_b_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT membership.organization_id AS org_b_id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  membership.id AS admin_a_membership_id,
  profile.auth_user_id AS admin_a_user_id,
  profile.access_version AS admin_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
\gset

SELECT jsonb_build_object(
  'sub', :'admin_a_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT
)::TEXT AS admin_a_claims
\gset

-- Migration 083 intentionally removed the broad membership lifecycle RPC from
-- the browser surface. Restore only the historical disposable P2H Student row
-- as the owner and advance the same access-version boundary used by revocation.
WITH changed_membership AS (
  UPDATE platform.organization_memberships
  SET status = 'active'
  WHERE organization_id = :'org_a_id'
    AND id = :'student_a_membership_id'
    AND status <> 'active'
  RETURNING profile_id
)
SELECT platform_private.bump_access_version(profile_id)
FROM changed_membership;

SELECT
  profile.id AS student_a_profile_id,
  profile.auth_user_id AS student_a_user_id,
  profile.access_version AS student_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'student_a_membership_id'
  AND membership.status = 'active'
\gset

SELECT
  profile.auth_user_id AS student_b_user_id,
  profile.access_version AS student_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'student_b_membership_id'
  AND membership.status = 'active'
\gset

SELECT jsonb_build_object(
  'sub', :'student_a_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_a_access_version'::BIGINT
)::TEXT AS student_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'student_b_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_b_access_version'::BIGINT
)::TEXT AS student_b_claims
\gset

-- Migration 115 correctly invalidated historical fake-clean metadata. Attach a
-- synthetic but relationally complete scanner proof through its service RPC to
-- one finalized current Student version, so migration 128 is exercised against
-- real authority joins instead of regex-only assertions.
SELECT
  slot.id AS current_slot_id,
  slot.status::TEXT AS current_slot_status,
  slot.current_version_no AS current_version_no,
  version.id AS current_version_id,
  version.sha256_hex AS current_sha256_hex,
  finalization.upload_reservation_id AS current_upload_reservation_id,
  finalization.request_id AS current_finalization_request_id
FROM platform.document_slots AS slot
JOIN platform.document_versions AS version
  ON version.organization_id = slot.organization_id
  AND version.student_case_id = slot.student_case_id
  AND version.document_slot_id = slot.id
  AND version.id = slot.current_version_id
JOIN platform_private.document_upload_finalizations AS finalization
  ON finalization.organization_id = version.organization_id
  AND finalization.document_version_id = version.id
WHERE slot.organization_id = :'org_a_id'
  AND slot.student_case_id = :'case_a_id'
  AND slot.removed_at IS NULL
  AND slot.status IN ('submitted', 'correction_required', 'rejected')
  AND version.integrity_status = 'verified'
  AND version.malware_status = 'error'
  AND version.malware_scan_attestation_id IS NULL
ORDER BY slot.id
LIMIT 1
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.finalize_document_upload_with_scan(
  :'org_a_id',
  :'current_upload_reservation_id',
  'ClamAV',
  '1.5.4',
  '28001',
  'clamd-zinstream-v1',
  :'current_sha256_hex',
  statement_timestamp(),
  :'current_finalization_request_id'
);
RESET ROLE;

-- Expire any still-live historical P2H grant deterministically. The fixture's
-- append-only trigger is disabled only for this test normalization statement;
-- the setting is restored before exercising migration 128.
SET LOCAL session_replication_role = replica;
UPDATE platform_private.document_download_grants
SET expires_at = statement_timestamp()
WHERE organization_id = :'org_a_id'
  AND grantee_auth_user_id = :'student_a_user_id'
  AND document_version_id = :'current_version_id'
  AND expires_at > statement_timestamp()
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.document_download_consumptions AS consumption
    WHERE consumption.document_download_grant_id =
      platform_private.document_download_grants.id
  );
SET LOCAL session_replication_role = origin;

-- Student cannot bypass the dedicated policy through the historical generic
-- RPC. The dedicated RPC succeeds only for the exact current clean version and
-- replays the same request deterministically.
SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.e5_capture_staff_grant(
  :'org_a_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000010'
) AS generic_student_grant_error
\gset
SELECT platform.grant_student_portal_document_download(
  :'org_a_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000011'
) AS current_grant
\gset
SELECT platform.grant_student_portal_document_download(
  :'org_a_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000011'
) AS current_grant_replay
\gset
RESET ROLE;

SELECT pg_temp.e5_assert_true(
  :'generic_student_grant_error'::JSONB ->> 'state' = '42501'
  AND :'current_grant'::JSONB = :'current_grant_replay'::JSONB
  AND (
    :'current_grant'::JSONB ->> 'storage_api_service_sign_required'
  )::BOOLEAN
  AND :'current_grant'::JSONB -> 'signed_url' = 'null'::JSONB
  AND (
    SELECT count(*) = 1
    FROM platform_private.document_download_grants AS grant_row
    WHERE grant_row.request_id =
      '58012800-0000-4000-8000-000000000011'
      AND grant_row.grantee_role = 'student'
      AND grant_row.access_purpose = 'student_document_download'
      AND grant_row.expires_in_seconds = 60
  ),
  'Student generic denial, current grant or exact replay failed'
);

-- Generic service consumption rejects a Student grant. The dedicated consume
-- succeeds once and exact replay does not create a second consumption.
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5_capture_staff_consume(
  (:'current_grant'::JSONB ->> 'document_download_grant_id')::UUID,
  '58012800-0000-4000-8000-000000000012'
) AS generic_student_consume_error
\gset
SELECT platform.consume_student_portal_document_download_grant(
  (:'current_grant'::JSONB ->> 'document_download_grant_id')::UUID,
  '58012800-0000-4000-8000-000000000013'
) AS current_consumption
\gset
SELECT pg_temp.e5_capture_student_consume(
  (:'current_grant'::JSONB ->> 'document_download_grant_id')::UUID,
  '58012800-0000-4000-8000-000000000013'
) AS current_consumption_replay_error
\gset
RESET ROLE;

SELECT pg_temp.e5_assert_true(
  :'generic_student_consume_error'::JSONB ->> 'state' = '42501'
  AND :'current_consumption_replay_error'::JSONB ->> 'state' = '23505'
  AND (
    SELECT count(*) = 1
    FROM platform_private.document_download_consumptions AS consumption
    WHERE consumption.document_download_grant_id =
      (:'current_grant'::JSONB
        ->> 'document_download_grant_id')::UUID
  ),
  'Student-only one-time consume or replay failed'
);

-- Replacing the public generic routines must not regress the accepted staff
-- path. Admin grants through the staff wrapper and service_role consumes only
-- that non-Student grant through the generic consume wrapper.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.grant_document_download(
  :'org_a_id',
  :'current_version_id',
  'E5 staff wrapper regression proof',
  60,
  '58012800-0000-4000-8000-000000000014'
) AS staff_grant
\gset
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.consume_document_download_grant(
  (:'staff_grant'::JSONB ->> 'document_download_grant_id')::UUID,
  '58012800-0000-4000-8000-000000000015'
) AS staff_consumption
\gset
RESET ROLE;

SELECT pg_temp.e5_assert_true(
  (:'staff_consumption'::JSONB ->> 'document_download_grant_id') =
    (:'staff_grant'::JSONB ->> 'document_download_grant_id')
  AND EXISTS (
    SELECT 1
    FROM platform_private.document_download_grants AS grant_row
    JOIN platform_private.document_download_consumptions AS consumption
      ON consumption.document_download_grant_id = grant_row.id
    WHERE grant_row.request_id =
      '58012800-0000-4000-8000-000000000014'
      AND grant_row.grantee_role = 'admin'
      AND consumption.request_id =
        '58012800-0000-4000-8000-000000000015'
  ),
  'staff grant/consume wrapper regression failed'
);

-- Same-organization cross-case and mismatched-organization calls use the real
-- Student RPC, proving ownership/tenant denial rather than generic role denial.
SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
SELECT pg_temp.e5_capture_student_grant(
  :'org_a_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000020'
) AS cross_case_grant_error
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.e5_capture_student_grant(
  :'org_b_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000021'
) AS cross_org_grant_error
\gset
RESET ROLE;

SELECT pg_temp.e5_assert_true(
  :'cross_case_grant_error'::JSONB ->> 'state' = '42501'
  AND :'cross_org_grant_error'::JSONB ->> 'state' = '42501'
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.document_download_grants AS grant_row
    WHERE grant_row.request_id IN (
      '58012800-0000-4000-8000-000000000020',
      '58012800-0000-4000-8000-000000000021'
    )
  ),
  'cross-case or cross-organization Student grant was not denied'
);

-- Point the slot at an unfinished replacement. The formerly current clean
-- version is now historical and the replacement lacks finalization/scan proof;
-- neither can receive a Student grant.
SELECT COALESCE(MAX(version.version_no), 0) + 1 AS unfinished_version_no
FROM platform.document_versions AS version
WHERE version.organization_id = :'org_a_id'
  AND version.document_slot_id = :'current_slot_id'
\gset

SAVEPOINT e5_non_current_grant_state;
INSERT INTO platform.document_versions (
  id,
  organization_id,
  student_case_id,
  document_slot_id,
  version_no,
  original_filename,
  declared_mime_type,
  byte_size,
  sha256_hex,
  ingest_evidence_ref,
  submitted_by_membership_id,
  integrity_status,
  malware_status
)
VALUES (
  '58012800-0000-4000-8000-000000000030',
  :'org_a_id',
  :'case_a_id',
  :'current_slot_id',
  :'unfinished_version_no',
  'unfinished-e5.pdf',
  'application/pdf',
  128,
  repeat('e', 64),
  'test:e5:unfinished-current-version',
  :'student_a_membership_id',
  'pending',
  'pending'
);
UPDATE platform.document_slots
SET
  status = 'submitted',
  current_version_id = '58012800-0000-4000-8000-000000000030',
  current_version_no = :'unfinished_version_no'
WHERE organization_id = :'org_a_id'
  AND id = :'current_slot_id';

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.e5_capture_student_grant(
  :'org_a_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000031'
) AS historical_grant_error
\gset
SELECT pg_temp.e5_capture_student_grant(
  :'org_a_id',
  '58012800-0000-4000-8000-000000000030',
  '58012800-0000-4000-8000-000000000032'
) AS unfinished_grant_error
\gset
RESET ROLE;

SELECT pg_temp.e5_assert_true(
  :'historical_grant_error'::JSONB ->> 'state' = '42501'
  AND :'unfinished_grant_error'::JSONB ->> 'state' = '42501'
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.document_download_grants AS grant_row
    WHERE grant_row.request_id IN (
      '58012800-0000-4000-8000-000000000031',
      '58012800-0000-4000-8000-000000000032'
    )
  ),
  'historical same-slot or unfinished current version received a grant'
);
ROLLBACK TO SAVEPOINT e5_non_current_grant_state;
RELEASE SAVEPOINT e5_non_current_grant_state;

-- Quarantined current metadata is rejected at grant time.
SAVEPOINT e5_quarantine_grant_state;
UPDATE platform.document_versions
SET
  malware_status = 'infected',
  validation_updated_at = statement_timestamp()
WHERE organization_id = :'org_a_id'
  AND id = :'current_version_id';
SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.e5_capture_student_grant(
  :'org_a_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000040'
) AS quarantine_grant_error
\gset
RESET ROLE;
SELECT pg_temp.e5_assert_true(
  :'quarantine_grant_error'::JSONB ->> 'state' = '42501'
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.document_download_grants AS grant_row
    WHERE grant_row.request_id =
      '58012800-0000-4000-8000-000000000040'
  ),
  'quarantined current version received a Student grant'
);
ROLLBACK TO SAVEPOINT e5_quarantine_grant_state;
RELEASE SAVEPOINT e5_quarantine_grant_state;

-- A grant created while current/clean becomes unusable if the version is
-- quarantined before provider signing. Restoring clean state makes the same
-- unconsumed grant valid, proving the failed call did not burn it.
SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT platform.grant_student_portal_document_download(
  :'org_a_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000041'
) AS quarantine_consume_grant
\gset
RESET ROLE;

SAVEPOINT e5_quarantine_consume_state;
UPDATE platform.document_versions
SET
  malware_status = 'infected',
  validation_updated_at = statement_timestamp()
WHERE organization_id = :'org_a_id'
  AND id = :'current_version_id';
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5_capture_student_consume(
  (:'quarantine_consume_grant'::JSONB
    ->> 'document_download_grant_id')::UUID,
  '58012800-0000-4000-8000-000000000042'
) AS quarantine_consume_error
\gset
RESET ROLE;
SELECT pg_temp.e5_assert_true(
  :'quarantine_consume_error'::JSONB ->> 'state' = '42501'
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.document_download_consumptions AS consumption
    WHERE consumption.request_id =
      '58012800-0000-4000-8000-000000000042'
  ),
  'quarantined grant remained consumable or was burned on denial'
);
ROLLBACK TO SAVEPOINT e5_quarantine_consume_state;
RELEASE SAVEPOINT e5_quarantine_consume_state;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.consume_student_portal_document_download_grant(
  (:'quarantine_consume_grant'::JSONB
    ->> 'document_download_grant_id')::UUID,
  '58012800-0000-4000-8000-000000000043'
);
RESET ROLE;

-- Superseding the slot after grant makes the clean version historical. The
-- consume RPC must recheck currentness/finalization and roll back its attempted
-- one-time consumption.
SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT platform.grant_student_portal_document_download(
  :'org_a_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000050'
) AS historical_consume_grant
\gset
RESET ROLE;

SAVEPOINT e5_historical_consume_state;
INSERT INTO platform.document_versions (
  id,
  organization_id,
  student_case_id,
  document_slot_id,
  version_no,
  original_filename,
  declared_mime_type,
  byte_size,
  sha256_hex,
  ingest_evidence_ref,
  submitted_by_membership_id,
  integrity_status,
  malware_status
)
VALUES (
  '58012800-0000-4000-8000-000000000051',
  :'org_a_id',
  :'case_a_id',
  :'current_slot_id',
  :'unfinished_version_no',
  'replacement-e5.pdf',
  'application/pdf',
  128,
  repeat('f', 64),
  'test:e5:replacement-before-consume',
  :'student_a_membership_id',
  'pending',
  'pending'
);
UPDATE platform.document_slots
SET
  status = 'submitted',
  current_version_id = '58012800-0000-4000-8000-000000000051',
  current_version_no = :'unfinished_version_no'
WHERE organization_id = :'org_a_id'
  AND id = :'current_slot_id';

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5_capture_student_consume(
  (:'historical_consume_grant'::JSONB
    ->> 'document_download_grant_id')::UUID,
  '58012800-0000-4000-8000-000000000052'
) AS historical_consume_error
\gset
RESET ROLE;
SELECT pg_temp.e5_assert_true(
  :'historical_consume_error'::JSONB ->> 'state' = '42501'
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.document_download_consumptions AS consumption
    WHERE consumption.request_id =
      '58012800-0000-4000-8000-000000000052'
  ),
  'historical/unfinished current state remained consumable'
);
ROLLBACK TO SAVEPOINT e5_historical_consume_state;
RELEASE SAVEPOINT e5_historical_consume_state;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.consume_student_portal_document_download_grant(
  (:'historical_consume_grant'::JSONB
    ->> 'document_download_grant_id')::UUID,
  '58012800-0000-4000-8000-000000000053'
);
RESET ROLE;

-- Live revocation is enforced both when creating a grant and again after a
-- previously valid grant has crossed the service boundary for signing.
SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT platform.grant_student_portal_document_download(
  :'org_a_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000060'
) AS revoked_consume_grant
\gset
RESET ROLE;

-- Model an out-of-band authority revocation as the database owner. There is no
-- Student lifecycle RPC after migration 083, and the E5 functions must reject
-- both the blocked membership and its stale access-version claim.
WITH changed_membership AS (
  UPDATE platform.organization_memberships
  SET status = 'blocked'
  WHERE organization_id = :'org_a_id'
    AND id = :'student_a_membership_id'
    AND status <> 'blocked'
  RETURNING profile_id
)
SELECT platform_private.bump_access_version(profile_id)
FROM changed_membership;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.e5_capture_student_grant(
  :'org_a_id',
  :'current_version_id',
  '58012800-0000-4000-8000-000000000062'
) AS revoked_grant_error
\gset
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5_capture_student_consume(
  (:'revoked_consume_grant'::JSONB
    ->> 'document_download_grant_id')::UUID,
  '58012800-0000-4000-8000-000000000063'
) AS revoked_consume_error
\gset
RESET ROLE;

SELECT pg_temp.e5_assert_true(
  :'revoked_grant_error'::JSONB ->> 'state' = '42501'
  AND :'revoked_consume_error'::JSONB ->> 'state' = '42501'
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.document_download_grants AS grant_row
    WHERE grant_row.request_id =
      '58012800-0000-4000-8000-000000000062'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.document_download_consumptions AS consumption
    WHERE consumption.request_id =
      '58012800-0000-4000-8000-000000000063'
  ),
  'revoked Student retained grant or backend consumption authority'
);

ROLLBACK;

SELECT 'platform Student current-document download tests passed' AS result;
