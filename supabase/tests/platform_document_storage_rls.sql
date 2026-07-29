\set ON_ERROR_STOP on

-- P2H acceptance uses deterministic synthetic identities and object metadata
-- only. It proves database/RLS behavior in disposable PostgreSQL. The separate
-- local Storage API harness proves actual upload/sign/download behavior.

CREATE OR REPLACE FUNCTION pg_temp.p2h_assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P2H assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p2h_assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.p2h_capture_upload_error(
  p_organization_id UUID,
  p_document_slot_id UUID,
  p_original_filename TEXT,
  p_declared_mime_type TEXT,
  p_byte_size BIGINT,
  p_sha256_hex TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  captured_state TEXT;
  captured_message TEXT;
BEGIN
  PERFORM platform.reserve_document_upload(
    p_organization_id,
    p_document_slot_id,
    p_original_filename,
    p_declared_mime_type,
    p_byte_size,
    p_sha256_hex,
    p_request_id
  );

  RETURN jsonb_build_object(
    'state', '00000',
    'message', NULL
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      captured_state = RETURNED_SQLSTATE,
      captured_message = MESSAGE_TEXT;

    RETURN jsonb_build_object(
      'state', captured_state,
      'message', captured_message
    );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p2h_capture_download_error(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_access_purpose TEXT,
  p_expires_in_seconds INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  captured_state TEXT;
  captured_message TEXT;
BEGIN
  PERFORM platform.grant_document_download(
    p_organization_id,
    p_document_version_id,
    p_access_purpose,
    p_expires_in_seconds,
    p_request_id
  );

  RETURN jsonb_build_object(
    'state', '00000',
    'message', NULL
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      captured_state = RETURNED_SQLSTATE,
      captured_message = MESSAGE_TEXT;

    RETURN jsonb_build_object(
      'state', captured_state,
      'message', captured_message
    );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p2h_capture_upload_error(
  UUID,
  UUID,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  UUID
) TO authenticated;

GRANT EXECUTE ON FUNCTION pg_temp.p2h_capture_download_error(
  UUID,
  UUID,
  TEXT,
  INTEGER,
  UUID
) TO authenticated;

-- PostgreSQL RLS may report a denied UPDATE/DELETE as a successful statement
-- affecting zero invisible rows. Convert that zero-row denial into an explicit
-- SQLSTATE so the expected-denial gate cannot false-pass on unchanged state.
CREATE OR REPLACE FUNCTION pg_temp.p2h_probe_storage_update(
  p_bucket_id TEXT,
  p_object_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  affected_rows BIGINT;
BEGIN
  UPDATE storage.objects
  SET name = name
  WHERE bucket_id = p_bucket_id
    AND name = p_object_name;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows = 0 THEN
    RAISE EXCEPTION 'Storage object UPDATE was denied'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p2h_probe_storage_delete(
  p_bucket_id TEXT,
  p_object_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  affected_rows BIGINT;
BEGIN
  DELETE FROM storage.objects
  WHERE bucket_id = p_bucket_id
    AND name = p_object_name;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows = 0 THEN
    RAISE EXCEPTION 'Storage object DELETE was denied'
      USING ERRCODE = '42501';
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p2h_probe_storage_update(TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p2h_probe_storage_delete(TEXT, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.p2h_storage_select_matrix(
  p_org_a_object_name TEXT,
  p_org_b_object_name TEXT
)
RETURNS TABLE (
  direct_org_a_count BIGINT,
  direct_org_b_count BIGINT,
  list_total_count BIGINT,
  list_org_a_count BIGINT,
  list_org_b_count BIGINT,
  get_org_a_count BIGINT,
  get_org_b_count BIGINT,
  sign_org_a_count BIGINT,
  sign_org_b_count BIGINT,
  sign_many_org_a_count BIGINT,
  sign_many_org_b_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('storage.operation', '', false);
  SELECT
    count(*) FILTER (WHERE object.name = p_org_a_object_name),
    count(*) FILTER (WHERE object.name = p_org_b_object_name)
  INTO direct_org_a_count, direct_org_b_count
  FROM storage.objects AS object
  WHERE object.bucket_id = 'platform-documents';

  PERFORM set_config('storage.operation', 'storage.object.list', false);
  SELECT
    count(*),
    count(*) FILTER (WHERE object.name = p_org_a_object_name),
    count(*) FILTER (WHERE object.name = p_org_b_object_name)
  INTO list_total_count, list_org_a_count, list_org_b_count
  FROM storage.objects AS object
  WHERE object.bucket_id = 'platform-documents';

  PERFORM set_config(
    'storage.operation',
    'storage.object.get_authenticated',
    false
  );
  SELECT
    count(*) FILTER (WHERE object.name = p_org_a_object_name),
    count(*) FILTER (WHERE object.name = p_org_b_object_name)
  INTO get_org_a_count, get_org_b_count
  FROM storage.objects AS object
  WHERE object.bucket_id = 'platform-documents';

  PERFORM set_config('storage.operation', 'storage.object.sign', false);
  SELECT
    count(*) FILTER (WHERE object.name = p_org_a_object_name),
    count(*) FILTER (WHERE object.name = p_org_b_object_name)
  INTO sign_org_a_count, sign_org_b_count
  FROM storage.objects AS object
  WHERE object.bucket_id = 'platform-documents';

  PERFORM set_config('storage.operation', 'storage.object.sign_many', false);
  SELECT
    count(*) FILTER (WHERE object.name = p_org_a_object_name),
    count(*) FILTER (WHERE object.name = p_org_b_object_name)
  INTO sign_many_org_a_count, sign_many_org_b_count
  FROM storage.objects AS object
  WHERE object.bucket_id = 'platform-documents';

  RETURN NEXT;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p2h_storage_select_matrix(TEXT, TEXT)
  TO authenticated;

-- Resolve the durable P2D-P2G fixtures after migration 046 has upgraded every
-- membership to the immutable v6 bundle and incremented access_version.
SELECT
  membership.organization_id AS org_a_id,
  membership.id AS admin_a_membership_id,
  profile.id AS admin_a_profile_id,
  profile.access_version AS admin_a_access_version,
  (
    SELECT (audit.before_state ->> 'access_version')::BIGINT
    FROM platform.audit_events AS audit
    WHERE audit.action = 'rbac.bundle.upgrade'
      AND audit.resource_id = membership.id
      AND audit.actor_principal =
        'migration:046_platform_private_document_storage'
  ) AS admin_a_stale_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.organization_id AS org_b_id,
  membership.id AS admin_b_membership_id,
  profile.id AS admin_b_profile_id,
  profile.access_version AS admin_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  student_case.id AS case_a_id,
  student_case.student_membership_id AS student_a_membership_id,
  student_case.current_curator_membership_id AS curator_a_membership_id,
  student_case.target_country AS case_a_target_country,
  student_case.target_degree AS case_a_target_degree,
  student_case.program_direction AS case_a_program_direction
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT
  student_case.id AS case_b_id,
  student_case.student_membership_id AS student_b_membership_id,
  student_case.current_curator_membership_id AS curator_b_membership_id,
  student_case.target_country AS case_b_target_country,
  student_case.target_degree AS case_b_target_degree,
  student_case.program_direction AS case_b_program_direction
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT
  student_case.id AS org_b_case_id,
  student_case.student_membership_id AS org_b_student_membership_id,
  student_case.responsible_sales_membership_id
    AS org_b_sales_membership_id,
  COALESCE(student_case.target_country, 'synthetic-country')
    AS org_b_target_country,
  COALESCE(student_case.target_degree, 'synthetic-degree')
    AS org_b_target_degree,
  COALESCE(student_case.program_direction, 'synthetic-program')
    AS org_b_program_direction
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_b_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:org-b'
\gset

SELECT
  profile.id AS student_a_profile_id,
  profile.access_version AS student_a_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000005'
\gset

SELECT
  profile.id AS student_b_profile_id,
  profile.access_version AS student_b_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000001'
\gset

SELECT
  profile.auth_user_id AS org_b_student_auth_user_id,
  profile.id AS org_b_student_profile_id,
  profile.access_version AS org_b_student_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE membership.organization_id = :'org_b_id'
  AND membership.id = :'org_b_student_membership_id'
\gset

SELECT
  profile.id AS curator_a_profile_id,
  profile.access_version AS curator_a_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000002'
\gset

SELECT
  membership.id AS previous_curator_membership_id,
  profile.id AS previous_curator_profile_id,
  profile.access_version AS previous_curator_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000003'
\gset

SELECT
  profile.id AS curator_b_profile_id,
  profile.access_version AS curator_b_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000004'
\gset

SELECT
  membership.id AS finance_a_membership_id,
  profile.id AS finance_a_profile_id,
  profile.access_version AS finance_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000005'
\gset

SELECT
  membership.id AS sales_a_membership_id,
  profile.id AS sales_a_profile_id,
  profile.access_version AS sales_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000002'
\gset

SELECT
  profile.auth_user_id AS blocked_auth_user_id,
  profile.access_version AS blocked_access_version,
  membership."current_role"::TEXT AS blocked_business_role
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE membership.organization_id = :'org_a_id'
  AND membership.status = 'blocked'
ORDER BY membership.id
LIMIT 1
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT
)::TEXT AS admin_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_stale_access_version'::BIGINT
)::TEXT AS admin_a_stale_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_b_access_version'::BIGINT
)::TEXT AS admin_b_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_a_access_version'::BIGINT
)::TEXT AS student_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_b_access_version'::BIGINT
)::TEXT AS student_b_claims
\gset
SELECT jsonb_build_object(
  'sub', :'org_b_student_auth_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'org_b_student_access_version'::BIGINT
)::TEXT AS org_b_student_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_a_access_version'::BIGINT
)::TEXT AS curator_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'previous_curator_access_version'::BIGINT
)::TEXT AS previous_curator_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000004',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_b_access_version'::BIGINT
)::TEXT AS curator_b_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'finance_a_access_version'::BIGINT
)::TEXT AS finance_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'sales_a_access_version'::BIGINT
)::TEXT AS sales_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'blocked_auth_user_id',
  'role', 'authenticated',
  'platform_role', :'blocked_business_role',
  'platform_access_version', :'blocked_access_version'::BIGINT
)::TEXT AS blocked_claims
\gset

-- Create one fresh confirmed-contract case that deliberately remains pending:
-- no Curator, no student case scope and no Portal activation.
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT (
  platform.create_pending_student_case(
    :'org_b_id',
    :'org_b_student_membership_id',
    :'org_b_sales_membership_id',
    'synthetic:p2h:pending-portal',
    'synthetic:p2h:contract',
    statement_timestamp(),
    'Synthetic pending Student',
    'synthetic-country',
    'synthetic-degree',
    'synthetic-program',
    'synthetic-intake',
    'RU',
    'synthetic-funding',
    'contract_confirmed',
    'Await Admin Curator assignment',
    '46000000-0000-4000-8000-000000000050'
  ) ->> 'student_case_id'
)::UUID AS p2h_pending_case_id
\gset
RESET ROLE;

-- Model the config-provisioned private bucket in the disposable provider
-- catalog. Migration 046 itself never writes storage.buckets.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'platform-documents',
  'platform-documents',
  FALSE,
  26214400,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
);

-- Create isolated required slots for positive and negative authorization
-- paths. These are synthetic fixture rows, not production data.
INSERT INTO platform.document_requirements (
  id,
  organization_id,
  target_country,
  target_degree,
  program_direction,
  checklist_version,
  requirement_key,
  label,
  instructions,
  status,
  created_by_membership_id
)
VALUES
  (
    '46000000-0000-4000-8000-000000000001',
    :'org_a_id',
    :'case_a_target_country',
    :'case_a_target_degree',
    :'case_a_program_direction',
    46,
    'p2h.admin',
    'P2H Admin upload',
    'Synthetic disposable test',
    'active',
    :'admin_a_membership_id'
  ),
  (
    '46000000-0000-4000-8000-000000000002',
    :'org_a_id',
    :'case_a_target_country',
    :'case_a_target_degree',
    :'case_a_program_direction',
    46,
    'p2h.curator',
    'P2H Curator upload',
    'Synthetic disposable test',
    'active',
    :'admin_a_membership_id'
  ),
  (
    '46000000-0000-4000-8000-000000000003',
    :'org_a_id',
    :'case_a_target_country',
    :'case_a_target_degree',
    :'case_a_program_direction',
    46,
    'p2h.student',
    'P2H Student upload',
    'Synthetic disposable test',
    'active',
    :'admin_a_membership_id'
  ),
  (
    '46000000-0000-4000-8000-000000000004',
    :'org_a_id',
    :'case_b_target_country',
    :'case_b_target_degree',
    :'case_b_program_direction',
    46,
    'p2h.cross-student',
    'P2H cross-student denial',
    'Synthetic disposable test',
    'active',
    :'admin_a_membership_id'
  ),
  (
    '46000000-0000-4000-8000-000000000005',
    :'org_b_id',
    :'org_b_target_country',
    :'org_b_target_degree',
    :'org_b_program_direction',
    46,
    'p2h.pending-portal',
    'P2H pending Portal denial',
    'Synthetic disposable test',
    'active',
    :'admin_b_membership_id'
  ),
  (
    '46000000-0000-4000-8000-000000000006',
    :'org_a_id',
    :'case_a_target_country',
    :'case_a_target_degree',
    :'case_a_program_direction',
    46,
    'p2h.shared-curator-student',
    'P2H shared Curator and Student upload',
    'Synthetic same-case live reservation conflict test',
    'active',
    :'admin_a_membership_id'
  );

INSERT INTO platform.document_slots (
  id,
  organization_id,
  student_case_id,
  requirement_id,
  status,
  created_by_membership_id
)
VALUES
  (
    '46000000-0000-4000-8000-000000000101',
    :'org_a_id',
    :'case_a_id',
    '46000000-0000-4000-8000-000000000001',
    'required',
    :'admin_a_membership_id'
  ),
  (
    '46000000-0000-4000-8000-000000000102',
    :'org_a_id',
    :'case_a_id',
    '46000000-0000-4000-8000-000000000002',
    'required',
    :'admin_a_membership_id'
  ),
  (
    '46000000-0000-4000-8000-000000000103',
    :'org_a_id',
    :'case_a_id',
    '46000000-0000-4000-8000-000000000003',
    'required',
    :'admin_a_membership_id'
  ),
  (
    '46000000-0000-4000-8000-000000000104',
    :'org_a_id',
    :'case_b_id',
    '46000000-0000-4000-8000-000000000004',
    'required',
    :'admin_a_membership_id'
  ),
  (
    '46000000-0000-4000-8000-000000000105',
    :'org_b_id',
    :'p2h_pending_case_id',
    '46000000-0000-4000-8000-000000000005',
    'required',
    :'admin_b_membership_id'
  ),
  (
    '46000000-0000-4000-8000-000000000106',
    :'org_a_id',
    :'case_a_id',
    '46000000-0000-4000-8000-000000000006',
    'required',
    :'admin_a_membership_id'
  );

-- Fresh Admin, assigned Curator and activated self Student can each reserve an
-- exact immutable upload target. Browser inputs never influence object_name.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT
  platform.reserve_document_upload(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000101',
    'admin-passport.pdf',
    'application/pdf',
    1024,
    repeat('a', 64),
    '46000000-0000-4000-8000-000000000201'
  ) AS admin_reservation
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT
  platform.reserve_document_upload(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000102',
    'curator-passport.pdf',
    'application/pdf',
    2048,
    repeat('b', 64),
    '46000000-0000-4000-8000-000000000202'
  ) AS curator_reservation
\gset
SELECT
  platform.reserve_document_upload(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000102',
    'curator-passport.pdf',
    'application/pdf',
    2048,
    repeat('b', 64),
    '46000000-0000-4000-8000-000000000202'
  ) AS curator_reservation_replay
\gset
\set ON_ERROR_STOP off
SELECT platform.reserve_document_upload(
  :'org_a_id',
  '46000000-0000-4000-8000-000000000102',
  'changed-replay.pdf',
  'application/pdf',
  2048,
  repeat('b', 64),
  '46000000-0000-4000-8000-000000000202'
);
\set upload_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT
  platform.reserve_document_upload(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000103',
    'student-photo.png',
    'image/png',
    4096,
    repeat('c', 64),
    '46000000-0000-4000-8000-000000000203'
  ) AS student_reservation
\gset
RESET ROLE;

-- Curator and Student deliberately share one requirement/slot on the same
-- case. The Curator's live opaque capability wins; a fresh Student request
-- must not create a parallel version or move the slot pointer. The Curator can
-- still replay the original request exactly.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT
  platform.reserve_document_upload(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000106',
    'shared-case-document.pdf',
    'application/pdf',
    3072,
    repeat('7', 64),
    '46000000-0000-4000-8000-000000000204'
  ) AS shared_curator_reservation
\gset
RESET ROLE;

SELECT
  (
    SELECT count(*)
    FROM platform.document_versions
    WHERE organization_id = :'org_a_id'
      AND document_slot_id =
        '46000000-0000-4000-8000-000000000106'
  ) AS shared_version_count_before,
  (
    SELECT count(*)
    FROM platform_private.document_upload_reservations
    WHERE organization_id = :'org_a_id'
      AND document_slot_id =
        '46000000-0000-4000-8000-000000000106'
  ) AS shared_reservation_count_before,
  (
    SELECT count(*)
    FROM platform_private.document_storage_bindings
    WHERE organization_id = :'org_a_id'
      AND document_slot_id =
        '46000000-0000-4000-8000-000000000106'
  ) AS shared_binding_count_before,
  COALESCE(slot.current_version_id::TEXT, '') AS shared_pointer_before,
  COALESCE(slot.current_version_no, 0) AS shared_version_no_before,
  slot.status::TEXT AS shared_status_before
FROM platform.document_slots AS slot
WHERE slot.organization_id = :'org_a_id'
  AND slot.id = '46000000-0000-4000-8000-000000000106'
\gset

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT
  pg_temp.p2h_capture_upload_error(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000106',
    'student-fresh-collision.pdf',
    'application/pdf',
    4096,
    repeat('8', 64),
    '46000000-0000-4000-8000-000000000205'
  ) AS shared_student_conflict
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT
  platform.reserve_document_upload(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000106',
    'shared-case-document.pdf',
    'application/pdf',
    3072,
    repeat('7', 64),
    '46000000-0000-4000-8000-000000000204'
  ) AS shared_curator_reservation_replay
\gset
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  :'shared_curator_reservation'::JSONB =
      :'shared_curator_reservation_replay'::JSONB
    AND (
      :'shared_student_conflict'::JSONB ->> 'state'
    ) = 'PT409'
    AND (
      :'shared_student_conflict'::JSONB ->> 'message'
    ) = 'A document upload is already in progress'
    AND (
      SELECT count(*)
      FROM platform.document_versions
      WHERE organization_id = :'org_a_id'
        AND document_slot_id =
          '46000000-0000-4000-8000-000000000106'
    ) = :'shared_version_count_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform_private.document_upload_reservations
      WHERE organization_id = :'org_a_id'
        AND document_slot_id =
          '46000000-0000-4000-8000-000000000106'
    ) = :'shared_reservation_count_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform_private.document_storage_bindings
      WHERE organization_id = :'org_a_id'
        AND document_slot_id =
          '46000000-0000-4000-8000-000000000106'
    ) = :'shared_binding_count_before'::BIGINT
    AND (
      SELECT COALESCE(slot.current_version_id::TEXT, '')
      FROM platform.document_slots AS slot
      WHERE slot.organization_id = :'org_a_id'
        AND slot.id = '46000000-0000-4000-8000-000000000106'
    ) = :'shared_pointer_before'
    AND (
      SELECT COALESCE(slot.current_version_no, 0)
      FROM platform.document_slots AS slot
      WHERE slot.organization_id = :'org_a_id'
        AND slot.id = '46000000-0000-4000-8000-000000000106'
    ) = :'shared_version_no_before'::BIGINT
    AND (
      SELECT slot.status::TEXT
      FROM platform.document_slots AS slot
      WHERE slot.organization_id = :'org_a_id'
        AND slot.id = '46000000-0000-4000-8000-000000000106'
    ) = :'shared_status_before'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.document_upload_reservations
      WHERE request_id =
        '46000000-0000-4000-8000-000000000205'
    )
    AND (
      SELECT count(*)
      FROM platform.audit_events
      WHERE request_id =
        '46000000-0000-4000-8000-000000000204'
        AND action = 'document.upload.reserve'
    ) = 1
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events
      WHERE request_id =
        '46000000-0000-4000-8000-000000000205'
    ),
  'same-slot live reservation conflict changed rows, pointer or replay'
);

-- Input-size rejection occurs before any version, binding, reservation or
-- audit write. Exactly 255 characters are allowed; 256 are rejected.
SELECT
  (SELECT count(*) FROM platform.document_versions)
    AS oversized_filename_versions_before,
  (
    SELECT count(*)
    FROM platform_private.document_upload_reservations
  ) AS oversized_filename_reservations_before,
  (
    SELECT count(*)
    FROM platform_private.document_storage_bindings
  ) AS oversized_filename_bindings_before,
  (SELECT count(*) FROM platform.audit_events)
    AS oversized_filename_audits_before
\gset

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT
  pg_temp.p2h_capture_upload_error(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000101',
    repeat('f', 256),
    'application/pdf',
    512,
    repeat('9', 64),
    '46000000-0000-4000-8000-000000000206'
  ) AS oversized_filename_error
\gset
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  (:'oversized_filename_error'::JSONB ->> 'state') = '22023'
    AND (
      :'oversized_filename_error'::JSONB ->> 'message'
    ) = 'Valid private document upload metadata is required'
    AND (
      SELECT count(*)
      FROM platform.document_versions
    ) = :'oversized_filename_versions_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform_private.document_upload_reservations
    ) = :'oversized_filename_reservations_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform_private.document_storage_bindings
    ) = :'oversized_filename_bindings_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform.audit_events
    ) = :'oversized_filename_audits_before'::BIGINT
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.document_upload_reservations
      WHERE request_id =
        '46000000-0000-4000-8000-000000000206'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events
      WHERE request_id =
        '46000000-0000-4000-8000-000000000206'
    ),
  '256-character filename was not rejected without side effects'
);

SELECT pg_temp.p2h_assert_true(
  (:'admin_reservation'::JSONB ->> 'object_name')
      ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
    AND (:'curator_reservation'::JSONB ->> 'object_name')
      ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
    AND (:'student_reservation'::JSONB ->> 'object_name')
      ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
    AND (:'curator_reservation'::JSONB ->> 'object_name')
      NOT LIKE '%curator-passport%'
    AND :'curator_reservation'::JSONB =
      :'curator_reservation_replay'::JSONB
    AND (:'admin_reservation'::JSONB ->> 'document_slot_published')::BOOLEAN
      IS FALSE
    AND (:'curator_reservation'::JSONB ->> 'document_slot_published')::BOOLEAN
      IS FALSE
    AND (:'student_reservation'::JSONB ->> 'document_slot_published')::BOOLEAN
      IS FALSE
    AND NOT EXISTS (
      SELECT 1
      FROM platform.document_slots AS slot
      WHERE slot.id IN (
        '46000000-0000-4000-8000-000000000101',
        '46000000-0000-4000-8000-000000000102',
        '46000000-0000-4000-8000-000000000103'
      )
        AND (
          slot.status <> 'required'
          OR slot.current_version_id IS NOT NULL
          OR slot.current_version_no IS NOT NULL
        )
    )
    AND :'upload_replay_mismatch_state' <> '00000'
    AND (
      SELECT count(*)
      FROM platform.audit_events
      WHERE request_id =
        '46000000-0000-4000-8000-000000000202'
        AND action = 'document.upload.reserve'
    ) = 1,
  'positive reservation, opaque name or exact replay contract failed'
);

SELECT
  (:'admin_reservation'::JSONB ->> 'document_version_id')::UUID
    AS admin_version_id,
  (:'admin_reservation'::JSONB ->> 'upload_reservation_id')::UUID
    AS admin_upload_reservation_id,
  (:'admin_reservation'::JSONB ->> 'object_name')::TEXT
    AS admin_object_name,
  (:'curator_reservation'::JSONB ->> 'document_version_id')::UUID
    AS curator_version_id,
  (:'curator_reservation'::JSONB ->> 'upload_reservation_id')::UUID
    AS curator_upload_reservation_id,
  (:'curator_reservation'::JSONB ->> 'object_name')::TEXT
    AS curator_object_name,
  (:'student_reservation'::JSONB ->> 'document_version_id')::UUID
    AS student_version_id,
  (:'student_reservation'::JSONB ->> 'upload_reservation_id')::UUID
    AS student_upload_reservation_id,
  (:'student_reservation'::JSONB ->> 'object_name')::TEXT
    AS student_object_name
\gset

-- Every denied role/scope path receives no reservation and no metadata row.
SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.reserve_document_upload(
  :'org_a_id',
  '46000000-0000-4000-8000-000000000101',
  'sales-denied.pdf',
  'application/pdf',
  100,
  repeat('d', 64),
  '46000000-0000-4000-8000-000000000211'
);
\set sales_upload_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.reserve_document_upload(
  :'org_a_id',
  '46000000-0000-4000-8000-000000000101',
  'finance-denied.pdf',
  'application/pdf',
  100,
  repeat('e', 64),
  '46000000-0000-4000-8000-000000000212'
);
\set finance_upload_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'previous_curator_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.reserve_document_upload(
  :'org_a_id',
  '46000000-0000-4000-8000-000000000101',
  'former-curator-denied.pdf',
  'application/pdf',
  100,
  repeat('f', 64),
  '46000000-0000-4000-8000-000000000213'
);
\set former_curator_upload_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.reserve_document_upload(
  :'org_a_id',
  '46000000-0000-4000-8000-000000000104',
  'cross-student-denied.pdf',
  'application/pdf',
  100,
  repeat('1', 64),
  '46000000-0000-4000-8000-000000000214'
);
\set cross_student_upload_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.reserve_document_upload(
  :'org_b_id',
  '46000000-0000-4000-8000-000000000105',
  'cross-org-denied.pdf',
  'application/pdf',
  100,
  repeat('2', 64),
  '46000000-0000-4000-8000-000000000215'
);
\set cross_org_upload_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'org_b_student_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.reserve_document_upload(
  :'org_b_id',
  '46000000-0000-4000-8000-000000000105',
  'pending-portal-denied.pdf',
  'application/pdf',
  100,
  repeat('3', 64),
  '46000000-0000-4000-8000-000000000216'
);
\set pending_portal_upload_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'admin_a_stale_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.reserve_document_upload(
  :'org_a_id',
  '46000000-0000-4000-8000-000000000101',
  'stale-denied.pdf',
  'application/pdf',
  100,
  repeat('4', 64),
  '46000000-0000-4000-8000-000000000217'
);
\set stale_upload_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'blocked_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.reserve_document_upload(
  :'org_a_id',
  '46000000-0000-4000-8000-000000000101',
  'blocked-denied.pdf',
  'application/pdf',
  100,
  repeat('5', 64),
  '46000000-0000-4000-8000-000000000218'
);
\set blocked_upload_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- A caller cannot use error details to discover whether a slot exists. The
-- same Student receives the same generic 42501 state/message for one missing
-- slot and one real slot belonging to another Student case.
SELECT
  (SELECT count(*) FROM platform.document_versions)
    AS slot_probe_versions_before,
  (
    SELECT count(*)
    FROM platform_private.document_upload_reservations
  ) AS slot_probe_reservations_before,
  (
    SELECT count(*)
    FROM platform_private.document_storage_bindings
  ) AS slot_probe_bindings_before,
  (SELECT count(*) FROM platform.audit_events)
    AS slot_probe_audits_before
\gset

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT
  pg_temp.p2h_capture_upload_error(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000199',
    'missing-slot-probe.pdf',
    'application/pdf',
    100,
    repeat('a', 64),
    '46000000-0000-4000-8000-000000000219'
  ) AS missing_slot_denial
\gset
SELECT
  pg_temp.p2h_capture_upload_error(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000104',
    'unauthorized-slot-probe.pdf',
    'application/pdf',
    100,
    repeat('b', 64),
    '46000000-0000-4000-8000-000000000220'
  ) AS unauthorized_slot_denial
\gset
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  (:'missing_slot_denial'::JSONB ->> 'state') = '42501'
    AND (:'unauthorized_slot_denial'::JSONB ->> 'state') = '42501'
    AND (:'missing_slot_denial'::JSONB ->> 'message') =
      (:'unauthorized_slot_denial'::JSONB ->> 'message')
    AND (:'missing_slot_denial'::JSONB ->> 'message') =
      'Document is unavailable'
    AND (
      SELECT count(*)
      FROM platform.document_versions
    ) = :'slot_probe_versions_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform_private.document_upload_reservations
    ) = :'slot_probe_reservations_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform_private.document_storage_bindings
    ) = :'slot_probe_bindings_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform.audit_events
    ) = :'slot_probe_audits_before'::BIGINT
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.document_upload_reservations
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000219',
        '46000000-0000-4000-8000-000000000220'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000219',
        '46000000-0000-4000-8000-000000000220'
      )
    ),
  'missing and unauthorized slots were distinguishable or wrote state'
);

SELECT pg_temp.p2h_assert_true(
  :'sales_upload_state' <> '00000'
    AND :'finance_upload_state' <> '00000'
    AND :'former_curator_upload_state' <> '00000'
    AND :'cross_student_upload_state' <> '00000'
    AND :'cross_org_upload_state' <> '00000'
    AND :'pending_portal_upload_state' <> '00000'
    AND :'stale_upload_state' <> '00000'
    AND :'blocked_upload_state' <> '00000'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.document_upload_reservations
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000211',
        '46000000-0000-4000-8000-000000000212',
        '46000000-0000-4000-8000-000000000213',
        '46000000-0000-4000-8000-000000000214',
        '46000000-0000-4000-8000-000000000215',
        '46000000-0000-4000-8000-000000000216',
        '46000000-0000-4000-8000-000000000217',
        '46000000-0000-4000-8000-000000000218'
      )
    ),
  'role, scope, tenant, Portal, stale or blocked reservation denial failed'
);

-- Keep the security limits bounded without manufacturing 60/120 browser calls
-- in this stateful suite. These constants and one-hour windows are part of the
-- database contract; behavioral conflict/input tests above still exercise the
-- public RPC boundary.
WITH function_contract AS (
  SELECT
    pg_get_functiondef(
      'platform.reserve_document_upload(uuid,uuid,text,text,bigint,text,uuid)'
        ::REGPROCEDURE
    ) AS upload_definition,
    pg_get_functiondef(
      'platform.grant_document_download(uuid,uuid,text,integer,uuid)'
        ::REGPROCEDURE
    ) AS download_definition
)
SELECT pg_temp.p2h_assert_true(
  upload_definition
      ~ 'actor_hourly_limit CONSTANT INTEGER := 60'
    AND upload_definition
      ~ 'slot_hourly_limit CONSTANT INTEGER := 12'
    AND upload_definition LIKE
      '%reservation_created_at - INTERVAL ''1 hour''%'
    AND upload_definition LIKE '%USING ERRCODE = ''PT429''%'
    AND download_definition
      ~ 'actor_hourly_limit CONSTANT INTEGER := 120'
    AND download_definition LIKE
      '%grant_created_at - INTERVAL ''1 hour''%'
    AND download_definition LIKE '%USING ERRCODE = ''PT429''%',
  'P2H rolling upload/download rate-limit contract drifted'
)
FROM function_contract;

-- Only the exact Storage upload operation, uploader and opaque reserved name
-- may insert. Wrong operations/names/users and object update/delete fail.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT set_config('storage.operation', 'storage.object.upload', false);
INSERT INTO storage.objects (bucket_id, name)
VALUES ('platform-documents', :'curator_object_name');

\set ON_ERROR_STOP off
INSERT INTO storage.objects (bucket_id, name)
VALUES (
  'platform-documents',
  'ff/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
);
\set wrong_object_upload_state :SQLSTATE
SELECT set_config('storage.operation', 'storage.object.sign', false);
INSERT INTO storage.objects (bucket_id, name)
VALUES ('platform-documents', :'admin_object_name');
\set wrong_operation_upload_state :SQLSTATE
SELECT pg_temp.p2h_probe_storage_update(
  'platform-documents',
  :'curator_object_name'
);
\set storage_update_state :SQLSTATE
SELECT pg_temp.p2h_probe_storage_delete(
  'platform-documents',
  :'curator_object_name'
);
\set storage_delete_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT set_config('storage.operation', 'storage.object.upload', false);
\set ON_ERROR_STOP off
INSERT INTO storage.objects (bucket_id, name)
VALUES ('platform-documents', :'admin_object_name');
\set wrong_uploader_state :SQLSTATE
\set ON_ERROR_STOP on
INSERT INTO storage.objects (bucket_id, name)
VALUES ('platform-documents', :'student_object_name');
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT set_config('storage.operation', 'storage.object.upload', false);
INSERT INTO storage.objects (bucket_id, name)
VALUES ('platform-documents', :'admin_object_name');
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  :'wrong_object_upload_state' <> '00000'
    AND :'wrong_operation_upload_state' <> '00000'
    AND :'wrong_uploader_state' <> '00000'
    AND :'storage_update_state' = '42501'
    AND :'storage_delete_state' = '42501'
    AND (
      SELECT count(*)
      FROM storage.objects
      WHERE bucket_id = 'platform-documents'
    ) = 3
    AND EXISTS (
      SELECT 1
      FROM storage.objects
      WHERE bucket_id = 'platform-documents'
        AND name = :'curator_object_name'
    ),
  'operation/name/uploader/immutability Storage policy failed'
);

-- Reservation alone never publishes a slot. Finalization is service-only,
-- requires an exact in-window object, and is idempotent for one request ID.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.finalize_document_upload(
  :'org_a_id',
  :'admin_upload_reservation_id',
  '46000000-0000-4000-8000-000000000340'
);
\set browser_finalize_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.finalize_document_upload(
  :'org_b_id',
  :'admin_upload_reservation_id',
  '46000000-0000-4000-8000-000000000341'
);
\set cross_org_finalize_state :SQLSTATE
SELECT platform.finalize_document_upload(
  :'org_a_id',
  (:'shared_curator_reservation'::JSONB
    ->> 'upload_reservation_id')::UUID,
  '46000000-0000-4000-8000-000000000342'
);
\set missing_object_finalize_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT
  platform.finalize_document_upload(
    :'org_a_id',
    :'curator_upload_reservation_id',
    '46000000-0000-4000-8000-000000000343'
  ) AS curator_finalization
\gset
SELECT
  platform.finalize_document_upload(
    :'org_a_id',
    :'curator_upload_reservation_id',
    '46000000-0000-4000-8000-000000000343'
  ) AS curator_finalization_replay
\gset
SELECT
  platform.finalize_document_upload(
    :'org_a_id',
    :'student_upload_reservation_id',
    '46000000-0000-4000-8000-000000000344'
  ) AS student_finalization
\gset
SELECT
  platform.finalize_document_upload(
    :'org_a_id',
    :'admin_upload_reservation_id',
    '46000000-0000-4000-8000-000000000345'
  ) AS admin_finalization
\gset

\set ON_ERROR_STOP off
SELECT platform.finalize_document_upload(
  :'org_a_id',
  :'curator_upload_reservation_id',
  '46000000-0000-4000-8000-000000000346'
);
\set finalize_second_request_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  :'browser_finalize_state' <> '00000'
    AND :'cross_org_finalize_state' = '42501'
    AND :'missing_object_finalize_state' = '42501'
    AND :'finalize_second_request_state' = '23505'
    AND :'curator_finalization'::JSONB =
      :'curator_finalization_replay'::JSONB
    AND (:'curator_finalization'::JSONB
      ->> 'document_slot_published')::BOOLEAN
    AND (:'curator_finalization'::JSONB
      ->> 'published_version_no')::BIGINT = 1
    AND (
      SELECT count(*)
      FROM platform_private.document_upload_finalizations
      WHERE upload_reservation_id IN (
        :'admin_upload_reservation_id',
        :'curator_upload_reservation_id',
        :'student_upload_reservation_id'
      )
    ) = 3
    AND (
      SELECT count(*)
      FROM platform.audit_events
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000343',
        '46000000-0000-4000-8000-000000000344',
        '46000000-0000-4000-8000-000000000345'
      )
        AND action = 'document.upload.finalize'
    ) = 3
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000340',
        '46000000-0000-4000-8000-000000000341',
        '46000000-0000-4000-8000-000000000342',
        '46000000-0000-4000-8000-000000000346'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.document_slots AS slot
      WHERE (
        slot.id = '46000000-0000-4000-8000-000000000101'
        AND slot.current_version_id <> :'admin_version_id'
      )
        OR (
          slot.id = '46000000-0000-4000-8000-000000000102'
          AND slot.current_version_id <> :'curator_version_id'
        )
        OR (
          slot.id = '46000000-0000-4000-8000-000000000103'
          AND slot.current_version_id <> :'student_version_id'
        )
        OR (
          slot.id IN (
            '46000000-0000-4000-8000-000000000101',
            '46000000-0000-4000-8000-000000000102',
            '46000000-0000-4000-8000-000000000103'
          )
          AND (
            slot.status <> 'submitted'
            OR slot.current_version_no <> 1
          )
        )
    ),
  'service-only exact upload finalization or replay contract failed'
);

-- A newer abandoned reservation consumes version 2 but cannot displace the
-- object-backed current version 1. Missing-object finalization stays denied.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT
  platform.reserve_document_upload(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000101',
    'admin-abandoned-v2.pdf',
    'application/pdf',
    512,
    repeat('d', 64),
    '46000000-0000-4000-8000-000000000347'
  ) AS abandoned_admin_v2
\gset
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.finalize_document_upload(
  :'org_a_id',
  (:'abandoned_admin_v2'::JSONB ->> 'upload_reservation_id')::UUID,
  '46000000-0000-4000-8000-000000000348'
);
\set abandoned_v2_finalize_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  (:'abandoned_admin_v2'::JSONB
    ->> 'document_slot_published')::BOOLEAN IS FALSE
    AND :'abandoned_v2_finalize_state' = '42501'
    AND (
      SELECT version.version_no
      FROM platform.document_versions AS version
      WHERE version.id =
        (:'abandoned_admin_v2'::JSONB ->> 'document_version_id')::UUID
    ) = 2
    AND (
      SELECT slot.current_version_id
      FROM platform.document_slots AS slot
      WHERE slot.id = '46000000-0000-4000-8000-000000000101'
    ) = :'admin_version_id'
    AND (
      SELECT slot.current_version_no
      FROM platform.document_slots AS slot
      WHERE slot.id = '46000000-0000-4000-8000-000000000101'
    ) = 1
    AND (
      SELECT slot.status
      FROM platform.document_slots AS slot
      WHERE slot.id = '46000000-0000-4000-8000-000000000101'
    ) = 'submitted'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events
      WHERE request_id =
        '46000000-0000-4000-8000-000000000348'
    ),
  'abandoned version 2 displaced the object-backed current version 1'
);

-- Provider metadata that says the exact object was created after reservation
-- expiry cannot be used to publish the pending version.
INSERT INTO storage.objects (bucket_id, name, created_at)
VALUES (
  'platform-documents',
  (:'shared_curator_reservation'::JSONB ->> 'object_name'),
  (:'shared_curator_reservation'::JSONB ->> 'expires_at')::TIMESTAMPTZ
    + INTERVAL '1 second'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.finalize_document_upload(
  :'org_a_id',
  (:'shared_curator_reservation'::JSONB
    ->> 'upload_reservation_id')::UUID,
  '46000000-0000-4000-8000-000000000349'
);
\set late_object_finalize_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  :'late_object_finalize_state' = '42501'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.document_upload_finalizations
      WHERE upload_reservation_id =
        (:'shared_curator_reservation'::JSONB
          ->> 'upload_reservation_id')::UUID
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events
      WHERE request_id =
        '46000000-0000-4000-8000-000000000349'
    )
    AND (
      SELECT slot.status
      FROM platform.document_slots AS slot
      WHERE slot.id = '46000000-0000-4000-8000-000000000106'
    ) = 'required',
  'late provider object metadata incorrectly finalized a reservation'
);

-- Liveness regression: synthesize elapsed time in this disposable database.
-- Uploaded v1 is now in-window but its reservation has expired; a fresh,
-- objectless v2 can be reserved. Finalizing v1 must still publish it because
-- no newer version has become current. The immutable trigger is re-enabled
-- immediately after the test-only clock shift.
ALTER TABLE platform_private.document_upload_reservations
  DISABLE TRIGGER document_upload_reservations_append_only_rows;
UPDATE platform_private.document_upload_reservations
SET
  created_at = statement_timestamp() - INTERVAL '20 minutes',
  expires_at = statement_timestamp() - INTERVAL '10 minutes'
WHERE id = (
  :'shared_curator_reservation'::JSONB
    ->> 'upload_reservation_id'
)::UUID;
ALTER TABLE platform_private.document_upload_reservations
  ENABLE TRIGGER document_upload_reservations_append_only_rows;
UPDATE storage.objects
SET created_at = statement_timestamp() - INTERVAL '15 minutes'
WHERE bucket_id = 'platform-documents'
  AND name = (:'shared_curator_reservation'::JSONB ->> 'object_name');

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT
  platform.reserve_document_upload(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000106',
    'shared-abandoned-v2.pdf',
    'application/pdf',
    1024,
    repeat('e', 64),
    '46000000-0000-4000-8000-000000000350'
  ) AS shared_abandoned_v2
\gset
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT
  platform.finalize_document_upload(
    :'org_a_id',
    (:'shared_curator_reservation'::JSONB
      ->> 'upload_reservation_id')::UUID,
    '46000000-0000-4000-8000-000000000351'
  ) AS shared_v1_finalization
\gset
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  (:'shared_abandoned_v2'::JSONB
    ->> 'document_slot_published')::BOOLEAN IS FALSE
    AND (:'shared_v1_finalization'::JSONB
      ->> 'published_version_no')::BIGINT = 1
    AND (
      SELECT version.version_no
      FROM platform.document_versions AS version
      WHERE version.id =
        (:'shared_abandoned_v2'::JSONB ->> 'document_version_id')::UUID
    ) = 2
    AND (
      SELECT slot.current_version_id
      FROM platform.document_slots AS slot
      WHERE slot.id = '46000000-0000-4000-8000-000000000106'
    ) = (
      :'shared_curator_reservation'::JSONB
        ->> 'document_version_id'
    )::UUID
    AND (
      SELECT slot.current_version_no
      FROM platform.document_slots AS slot
      WHERE slot.id = '46000000-0000-4000-8000-000000000106'
    ) = 1
    AND (
      SELECT slot.status
      FROM platform.document_slots AS slot
      WHERE slot.id = '46000000-0000-4000-8000-000000000106'
    ) = 'submitted'
    AND EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger
      WHERE trigger.tgrelid =
        'platform_private.document_upload_reservations'::REGCLASS
        AND trigger.tgname =
          'document_upload_reservations_append_only_rows'
        AND trigger.tgenabled = 'O'
    ),
  'abandoned later reservation stranded an earlier valid uploaded version'
);

-- Signing is denied while validation is pending even if an object exists.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.grant_document_download(
  :'org_a_id',
  :'curator_version_id',
  'pending validation denial',
  60,
  '46000000-0000-4000-8000-000000000301'
);
\set pending_validation_grant_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- A trusted service attests provider-side checks. The SQL event is evidence of
-- the attestation, not independent proof of scanner execution.
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.attest_document_validation(
  :'org_a_id',
  :'curator_version_id',
  'verified',
  'clean',
  'synthetic:p2h:validator',
  'synthetic:p2h:evidence:curator',
  '46000000-0000-4000-8000-000000000302'
);
SELECT platform.attest_document_validation(
  :'org_a_id',
  :'student_version_id',
  'verified',
  'clean',
  'synthetic:p2h:validator',
  'synthetic:p2h:evidence:student',
  '46000000-0000-4000-8000-000000000303'
);
SELECT platform.attest_document_validation(
  :'org_a_id',
  :'admin_version_id',
  'verified',
  'clean',
  'synthetic:p2h:validator',
  'synthetic:p2h:evidence:admin',
  '46000000-0000-4000-8000-000000000307'
);
RESET ROLE;

-- Assigned Curator creates an audited grant. Exact replay returns the same
-- grant; mismatched replay fails and creates no second access event.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT
  platform.grant_document_download(
    :'org_a_id',
    :'curator_version_id',
    'case document review',
    60,
    '46000000-0000-4000-8000-000000000304'
  ) AS curator_grant
\gset
SELECT
  platform.grant_document_download(
    :'org_a_id',
    :'curator_version_id',
    'case document review',
    60,
    '46000000-0000-4000-8000-000000000304'
  ) AS curator_grant_replay
\gset
\set ON_ERROR_STOP off
SELECT platform.grant_document_download(
  :'org_a_id',
  :'curator_version_id',
  'changed purpose',
  60,
  '46000000-0000-4000-8000-000000000304'
);
\set download_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  (
    SELECT count(*)
    FROM platform_private.document_download_grants
  ) AS guarded_download_grants_before,
  (
    SELECT count(*)
    FROM platform.document_access_events
  ) AS guarded_download_access_before,
  (SELECT count(*) FROM platform.audit_events)
    AS guarded_download_audits_before
\gset

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT
  pg_temp.p2h_capture_download_error(
    :'org_a_id',
    :'curator_version_id',
    repeat('p', 256),
    60,
    '46000000-0000-4000-8000-000000000308'
  ) AS oversized_purpose_error
\gset
SELECT
  pg_temp.p2h_capture_download_error(
    :'org_a_id',
    :'curator_version_id',
    'fresh duplicate live grant',
    60,
    '46000000-0000-4000-8000-000000000309'
  ) AS fresh_same_version_conflict
\gset
SELECT
  platform.grant_document_download(
    :'org_a_id',
    :'curator_version_id',
    'case document review',
    60,
    '46000000-0000-4000-8000-000000000304'
  ) AS curator_grant_post_conflict_replay
\gset
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  :'pending_validation_grant_state' <> '00000'
    AND :'curator_grant'::JSONB = :'curator_grant_replay'::JSONB
    AND :'curator_grant'::JSONB =
      :'curator_grant_post_conflict_replay'::JSONB
    AND NOT (:'curator_grant'::JSONB ? 'bucket_id')
    AND NOT (:'curator_grant'::JSONB ? 'object_name')
    AND NOT (:'curator_grant'::JSONB ? 'document_access_event_id')
    AND (:'curator_grant'::JSONB -> 'signed_url') = 'null'::JSONB
    AND (
      :'curator_grant'::JSONB
        ->> 'storage_api_service_sign_required'
    )::BOOLEAN
    AND :'download_replay_mismatch_state' <> '00000'
    AND (
      SELECT count(*)
      FROM platform.document_access_events
      WHERE request_id =
        '46000000-0000-4000-8000-000000000304'
    ) = 1
    AND (
      SELECT count(*)
      FROM platform_private.document_download_grants
      WHERE request_id =
        '46000000-0000-4000-8000-000000000304'
    ) = 1
    AND (
      SELECT count(*)
      FROM platform.audit_events
      WHERE request_id =
        '46000000-0000-4000-8000-000000000304'
        AND action = 'document.download.grant'
    ) = 1
    AND (:'oversized_purpose_error'::JSONB ->> 'state') = '22023'
    AND (
      :'oversized_purpose_error'::JSONB ->> 'message'
    ) = 'Valid short-lived document download grant inputs are required'
    AND (
      :'fresh_same_version_conflict'::JSONB ->> 'state'
    ) = 'PT409'
    AND (
      :'fresh_same_version_conflict'::JSONB ->> 'message'
    ) = 'A document download grant is already active'
    AND (
      SELECT count(*)
      FROM platform_private.document_download_grants
    ) = :'guarded_download_grants_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform.document_access_events
    ) = :'guarded_download_access_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform.audit_events
    ) = :'guarded_download_audits_before'::BIGINT
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.document_download_grants
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000308',
        '46000000-0000-4000-8000-000000000309'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.document_access_events
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000308',
        '46000000-0000-4000-8000-000000000309'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000308',
        '46000000-0000-4000-8000-000000000309'
      )
    ),
  'validation gate, audited grant or exact grant replay failed'
);

-- Version discovery is equally opaque: a different-case Student receives the
-- same generic 42501 state/message for a missing UUID and a real version they
-- are not authorized to inspect.
SELECT
  (
    SELECT count(*)
    FROM platform_private.document_download_grants
  ) AS version_probe_grants_before,
  (
    SELECT count(*)
    FROM platform.document_access_events
  ) AS version_probe_access_before,
  (SELECT count(*) FROM platform.audit_events)
    AS version_probe_audits_before
\gset

SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
SELECT
  pg_temp.p2h_capture_download_error(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000999',
    'missing version probe',
    60,
    '46000000-0000-4000-8000-000000000316'
  ) AS missing_version_denial
\gset
SELECT
  pg_temp.p2h_capture_download_error(
    :'org_a_id',
    :'curator_version_id',
    'unauthorized version probe',
    60,
    '46000000-0000-4000-8000-000000000317'
  ) AS unauthorized_version_denial
\gset
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  (:'missing_version_denial'::JSONB ->> 'state') = '42501'
    AND (:'unauthorized_version_denial'::JSONB ->> 'state') = '42501'
    AND (:'missing_version_denial'::JSONB ->> 'message') =
      (:'unauthorized_version_denial'::JSONB ->> 'message')
    AND (:'missing_version_denial'::JSONB ->> 'message') =
      'Document is unavailable'
    AND (
      SELECT count(*)
      FROM platform_private.document_download_grants
    ) = :'version_probe_grants_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform.document_access_events
    ) = :'version_probe_access_before'::BIGINT
    AND (
      SELECT count(*)
      FROM platform.audit_events
    ) = :'version_probe_audits_before'::BIGINT
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.document_download_grants
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000316',
        '46000000-0000-4000-8000-000000000317'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.document_access_events
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000316',
        '46000000-0000-4000-8000-000000000317'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000316',
        '46000000-0000-4000-8000-000000000317'
      )
    ),
  'missing and unauthorized versions were distinguishable or wrote state'
);

-- Create one exact object-backed version in organization B so browser SELECT
-- probes cover both tenant directions with real immutable bindings. The
-- authenticated INSERT still uses only the reserved opaque name and upload
-- operation; finalization remains service-only.
SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT
  platform.reserve_document_upload(
    :'org_b_id',
    '46000000-0000-4000-8000-000000000105',
    'org-b-storage-matrix.pdf',
    'application/pdf',
    1536,
    repeat('4', 64),
    '46000000-0000-4000-8000-000000000328'
  ) AS org_b_matrix_reservation
\gset
SELECT
  (:'org_b_matrix_reservation'::JSONB
    ->> 'document_version_id')::UUID AS org_b_matrix_version_id,
  (:'org_b_matrix_reservation'::JSONB
    ->> 'upload_reservation_id')::UUID
      AS org_b_matrix_upload_reservation_id,
  (:'org_b_matrix_reservation'::JSONB
    ->> 'object_name')::TEXT AS org_b_matrix_object_name
\gset
SELECT set_config('storage.operation', 'storage.object.upload', false);
INSERT INTO storage.objects (bucket_id, name)
VALUES ('platform-documents', :'org_b_matrix_object_name');
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT
  platform.finalize_document_upload(
    :'org_b_id',
    :'org_b_matrix_upload_reservation_id',
    '46000000-0000-4000-8000-000000000329'
  ) AS org_b_matrix_finalization
\gset
RESET ROLE;

-- No browser role may directly SELECT, list, get or sign private Storage
-- objects. Save every role/operation result for the organization-A and
-- organization-B objects; the single aggregate assertion below rejects any
-- visible row. sign_many remains covered beside the single-object sign path.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT *
FROM pg_temp.p2h_storage_select_matrix(
  :'curator_object_name',
  :'org_b_matrix_object_name'
)
\gset admin_a_
RESET ROLE;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT *
FROM pg_temp.p2h_storage_select_matrix(
  :'curator_object_name',
  :'org_b_matrix_object_name'
)
\gset admin_b_
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT *
FROM pg_temp.p2h_storage_select_matrix(
  :'curator_object_name',
  :'org_b_matrix_object_name'
)
\gset sales_a_
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
SELECT *
FROM pg_temp.p2h_storage_select_matrix(
  :'curator_object_name',
  :'org_b_matrix_object_name'
)
\gset finance_a_
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT *
FROM pg_temp.p2h_storage_select_matrix(
  :'curator_object_name',
  :'org_b_matrix_object_name'
)
\gset curator_a_
\set ON_ERROR_STOP off
SELECT platform.consume_document_download_grant(
  (:'curator_grant'::JSONB
    ->> 'document_download_grant_id')::UUID,
  '46000000-0000-4000-8000-000000000330'
);
\set browser_consume_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT *
FROM pg_temp.p2h_storage_select_matrix(
  :'curator_object_name',
  :'org_b_matrix_object_name'
)
\gset student_a_
RESET ROLE;

SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
SELECT *
FROM pg_temp.p2h_storage_select_matrix(
  :'curator_object_name',
  :'org_b_matrix_object_name'
)
\gset student_b_
RESET ROLE;

SET request.jwt.claims TO :'org_b_student_claims';
SET ROLE authenticated;
SELECT *
FROM pg_temp.p2h_storage_select_matrix(
  :'curator_object_name',
  :'org_b_matrix_object_name'
)
\gset org_b_student_
RESET ROLE;

-- Retain the original named denial results while the expanded matrix carries
-- exact per-role, per-operation and per-object variables.
SELECT
  :'curator_a_sign_org_a_count'::BIGINT AS curator_sign_count,
  :'curator_a_get_org_a_count'::BIGINT AS curator_get_count,
  :'curator_a_list_total_count'::BIGINT AS curator_list_count,
  :'curator_a_sign_many_org_a_count'::BIGINT
    AS curator_sign_many_count,
  :'student_b_sign_org_a_count'::BIGINT AS wrong_student_sign_count
\gset

SELECT pg_temp.p2h_assert_true(
  NOT EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('admin_a', 'direct', 'org_a',
          :'admin_a_direct_org_a_count'::BIGINT),
        ('admin_a', 'direct', 'org_b',
          :'admin_a_direct_org_b_count'::BIGINT),
        ('admin_a', 'list', 'all',
          :'admin_a_list_total_count'::BIGINT),
        ('admin_a', 'list', 'org_a',
          :'admin_a_list_org_a_count'::BIGINT),
        ('admin_a', 'list', 'org_b',
          :'admin_a_list_org_b_count'::BIGINT),
        ('admin_a', 'get', 'org_a',
          :'admin_a_get_org_a_count'::BIGINT),
        ('admin_a', 'get', 'org_b',
          :'admin_a_get_org_b_count'::BIGINT),
        ('admin_a', 'sign', 'org_a',
          :'admin_a_sign_org_a_count'::BIGINT),
        ('admin_a', 'sign', 'org_b',
          :'admin_a_sign_org_b_count'::BIGINT),
        ('admin_a', 'sign_many', 'org_a',
          :'admin_a_sign_many_org_a_count'::BIGINT),
        ('admin_a', 'sign_many', 'org_b',
          :'admin_a_sign_many_org_b_count'::BIGINT),
        ('admin_b', 'direct', 'org_a',
          :'admin_b_direct_org_a_count'::BIGINT),
        ('admin_b', 'direct', 'org_b',
          :'admin_b_direct_org_b_count'::BIGINT),
        ('admin_b', 'list', 'all',
          :'admin_b_list_total_count'::BIGINT),
        ('admin_b', 'list', 'org_a',
          :'admin_b_list_org_a_count'::BIGINT),
        ('admin_b', 'list', 'org_b',
          :'admin_b_list_org_b_count'::BIGINT),
        ('admin_b', 'get', 'org_a',
          :'admin_b_get_org_a_count'::BIGINT),
        ('admin_b', 'get', 'org_b',
          :'admin_b_get_org_b_count'::BIGINT),
        ('admin_b', 'sign', 'org_a',
          :'admin_b_sign_org_a_count'::BIGINT),
        ('admin_b', 'sign', 'org_b',
          :'admin_b_sign_org_b_count'::BIGINT),
        ('admin_b', 'sign_many', 'org_a',
          :'admin_b_sign_many_org_a_count'::BIGINT),
        ('admin_b', 'sign_many', 'org_b',
          :'admin_b_sign_many_org_b_count'::BIGINT),
        ('sales_a', 'direct', 'org_a',
          :'sales_a_direct_org_a_count'::BIGINT),
        ('sales_a', 'direct', 'org_b',
          :'sales_a_direct_org_b_count'::BIGINT),
        ('sales_a', 'list', 'all',
          :'sales_a_list_total_count'::BIGINT),
        ('sales_a', 'list', 'org_a',
          :'sales_a_list_org_a_count'::BIGINT),
        ('sales_a', 'list', 'org_b',
          :'sales_a_list_org_b_count'::BIGINT),
        ('sales_a', 'get', 'org_a',
          :'sales_a_get_org_a_count'::BIGINT),
        ('sales_a', 'get', 'org_b',
          :'sales_a_get_org_b_count'::BIGINT),
        ('sales_a', 'sign', 'org_a',
          :'sales_a_sign_org_a_count'::BIGINT),
        ('sales_a', 'sign', 'org_b',
          :'sales_a_sign_org_b_count'::BIGINT),
        ('sales_a', 'sign_many', 'org_a',
          :'sales_a_sign_many_org_a_count'::BIGINT),
        ('sales_a', 'sign_many', 'org_b',
          :'sales_a_sign_many_org_b_count'::BIGINT),
        ('finance_a', 'direct', 'org_a',
          :'finance_a_direct_org_a_count'::BIGINT),
        ('finance_a', 'direct', 'org_b',
          :'finance_a_direct_org_b_count'::BIGINT),
        ('finance_a', 'list', 'all',
          :'finance_a_list_total_count'::BIGINT),
        ('finance_a', 'list', 'org_a',
          :'finance_a_list_org_a_count'::BIGINT),
        ('finance_a', 'list', 'org_b',
          :'finance_a_list_org_b_count'::BIGINT),
        ('finance_a', 'get', 'org_a',
          :'finance_a_get_org_a_count'::BIGINT),
        ('finance_a', 'get', 'org_b',
          :'finance_a_get_org_b_count'::BIGINT),
        ('finance_a', 'sign', 'org_a',
          :'finance_a_sign_org_a_count'::BIGINT),
        ('finance_a', 'sign', 'org_b',
          :'finance_a_sign_org_b_count'::BIGINT),
        ('finance_a', 'sign_many', 'org_a',
          :'finance_a_sign_many_org_a_count'::BIGINT),
        ('finance_a', 'sign_many', 'org_b',
          :'finance_a_sign_many_org_b_count'::BIGINT),
        ('curator_a', 'direct', 'org_a',
          :'curator_a_direct_org_a_count'::BIGINT),
        ('curator_a', 'direct', 'org_b',
          :'curator_a_direct_org_b_count'::BIGINT),
        ('curator_a', 'list', 'all',
          :'curator_a_list_total_count'::BIGINT),
        ('curator_a', 'list', 'org_a',
          :'curator_a_list_org_a_count'::BIGINT),
        ('curator_a', 'list', 'org_b',
          :'curator_a_list_org_b_count'::BIGINT),
        ('curator_a', 'get', 'org_a',
          :'curator_a_get_org_a_count'::BIGINT),
        ('curator_a', 'get', 'org_b',
          :'curator_a_get_org_b_count'::BIGINT),
        ('curator_a', 'sign', 'org_a',
          :'curator_a_sign_org_a_count'::BIGINT),
        ('curator_a', 'sign', 'org_b',
          :'curator_a_sign_org_b_count'::BIGINT),
        ('curator_a', 'sign_many', 'org_a',
          :'curator_a_sign_many_org_a_count'::BIGINT),
        ('curator_a', 'sign_many', 'org_b',
          :'curator_a_sign_many_org_b_count'::BIGINT),
        ('student_a', 'direct', 'org_a',
          :'student_a_direct_org_a_count'::BIGINT),
        ('student_a', 'direct', 'org_b',
          :'student_a_direct_org_b_count'::BIGINT),
        ('student_a', 'list', 'all',
          :'student_a_list_total_count'::BIGINT),
        ('student_a', 'list', 'org_a',
          :'student_a_list_org_a_count'::BIGINT),
        ('student_a', 'list', 'org_b',
          :'student_a_list_org_b_count'::BIGINT),
        ('student_a', 'get', 'org_a',
          :'student_a_get_org_a_count'::BIGINT),
        ('student_a', 'get', 'org_b',
          :'student_a_get_org_b_count'::BIGINT),
        ('student_a', 'sign', 'org_a',
          :'student_a_sign_org_a_count'::BIGINT),
        ('student_a', 'sign', 'org_b',
          :'student_a_sign_org_b_count'::BIGINT),
        ('student_a', 'sign_many', 'org_a',
          :'student_a_sign_many_org_a_count'::BIGINT),
        ('student_a', 'sign_many', 'org_b',
          :'student_a_sign_many_org_b_count'::BIGINT),
        ('student_b', 'direct', 'org_a',
          :'student_b_direct_org_a_count'::BIGINT),
        ('student_b', 'direct', 'org_b',
          :'student_b_direct_org_b_count'::BIGINT),
        ('student_b', 'list', 'all',
          :'student_b_list_total_count'::BIGINT),
        ('student_b', 'list', 'org_a',
          :'student_b_list_org_a_count'::BIGINT),
        ('student_b', 'list', 'org_b',
          :'student_b_list_org_b_count'::BIGINT),
        ('student_b', 'get', 'org_a',
          :'student_b_get_org_a_count'::BIGINT),
        ('student_b', 'get', 'org_b',
          :'student_b_get_org_b_count'::BIGINT),
        ('student_b', 'sign', 'org_a',
          :'student_b_sign_org_a_count'::BIGINT),
        ('student_b', 'sign', 'org_b',
          :'student_b_sign_org_b_count'::BIGINT),
        ('student_b', 'sign_many', 'org_a',
          :'student_b_sign_many_org_a_count'::BIGINT),
        ('student_b', 'sign_many', 'org_b',
          :'student_b_sign_many_org_b_count'::BIGINT),
        ('org_b_student', 'direct', 'org_a',
          :'org_b_student_direct_org_a_count'::BIGINT),
        ('org_b_student', 'direct', 'org_b',
          :'org_b_student_direct_org_b_count'::BIGINT),
        ('org_b_student', 'list', 'all',
          :'org_b_student_list_total_count'::BIGINT),
        ('org_b_student', 'list', 'org_a',
          :'org_b_student_list_org_a_count'::BIGINT),
        ('org_b_student', 'list', 'org_b',
          :'org_b_student_list_org_b_count'::BIGINT),
        ('org_b_student', 'get', 'org_a',
          :'org_b_student_get_org_a_count'::BIGINT),
        ('org_b_student', 'get', 'org_b',
          :'org_b_student_get_org_b_count'::BIGINT),
        ('org_b_student', 'sign', 'org_a',
          :'org_b_student_sign_org_a_count'::BIGINT),
        ('org_b_student', 'sign', 'org_b',
          :'org_b_student_sign_org_b_count'::BIGINT),
        ('org_b_student', 'sign_many', 'org_a',
          :'org_b_student_sign_many_org_a_count'::BIGINT),
        ('org_b_student', 'sign_many', 'org_b',
          :'org_b_student_sign_many_org_b_count'::BIGINT)
    ) AS matrix_result(identity_name, operation_name, object_scope, row_count)
    WHERE matrix_result.row_count <> 0
  )
    AND :'curator_sign_count'::INTEGER = 0
    AND :'curator_get_count'::INTEGER = 0
    AND :'curator_list_count'::INTEGER = 0
    AND :'curator_sign_many_count'::INTEGER = 0
    AND :'wrong_student_sign_count'::INTEGER = 0
    AND (:'org_b_matrix_finalization'::JSONB ->> 'organization_id')::UUID =
      :'org_b_id'
    AND (:'org_b_matrix_finalization'::JSONB ->> 'object_name') =
      :'org_b_matrix_object_name'
    AND (:'org_b_matrix_finalization'::JSONB
      ->> 'document_slot_published')::BOOLEAN
    AND (
      SELECT count(*)
      FROM storage.objects AS object
      WHERE object.bucket_id = 'platform-documents'
        AND object.name IN (
          :'curator_object_name',
          :'org_b_matrix_object_name'
        )
    ) = 2
    AND EXISTS (
      SELECT 1
      FROM platform_private.document_storage_bindings AS binding
      WHERE binding.organization_id = :'org_a_id'
        AND binding.object_name = :'curator_object_name'
    )
    AND EXISTS (
      SELECT 1
      FROM platform_private.document_storage_bindings AS binding
      WHERE binding.organization_id = :'org_b_id'
        AND binding.object_name = :'org_b_matrix_object_name'
    )
    AND :'browser_consume_state' <> '00000',
  'browser Storage role/tenant/operation matrix or service-consumption boundary failed'
);

-- The trusted backend consumes the opaque Curator grant exactly once. The
-- result is object-specific and returns only a bounded provider-signing TTL;
-- SQL never creates or stores a signed URL/token.
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT
  platform.consume_document_download_grant(
    (:'curator_grant'::JSONB
      ->> 'document_download_grant_id')::UUID,
    '46000000-0000-4000-8000-000000000331'
  ) AS curator_consumption
\gset
\set ON_ERROR_STOP off
SELECT platform.consume_document_download_grant(
  (:'curator_grant'::JSONB
    ->> 'document_download_grant_id')::UUID,
  '46000000-0000-4000-8000-000000000332'
);
\set consumed_replay_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT set_config('storage.operation', 'storage.object.sign', false);
SELECT count(*) AS curator_post_consume_sign_count
FROM storage.objects
WHERE bucket_id = 'platform-documents'
  AND name = :'curator_object_name'
\gset
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  (:'curator_consumption'::JSONB ->> 'bucket_id') =
    'platform-documents'
    AND (:'curator_consumption'::JSONB ->> 'object_name') =
      :'curator_object_name'
    AND (
      :'curator_consumption'::JSONB
        ->> 'max_signed_url_expires_in_seconds'
    )::INTEGER BETWEEN 1 AND 60
    AND (:'curator_consumption'::JSONB -> 'signed_url') =
      'null'::JSONB
    AND (
      :'curator_consumption'::JSONB
        ->> 'storage_api_service_sign_required'
    )::BOOLEAN
    AND :'consumed_replay_state' <> '00000'
    AND :'curator_post_consume_sign_count'::INTEGER = 0
    AND (
      SELECT count(*)
      FROM platform_private.document_download_consumptions
      WHERE document_download_grant_id =
        (:'curator_grant'::JSONB
          ->> 'document_download_grant_id')::UUID
    ) = 1
    AND EXISTS (
      SELECT 1
      FROM platform.audit_events
      WHERE request_id =
        '46000000-0000-4000-8000-000000000331'
        AND actor_kind = 'service'
        AND action = 'document.download.sign.authorize'
    ),
  'one-time service signing authorization failed'
);

-- Admin and activated self Student may independently grant authorized
-- case documents. Sales, Finance, former Curator, cross-student and stale
-- tokens cannot create grants.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.grant_document_download(
  :'org_a_id',
  :'curator_version_id',
  'admin oversight',
  60,
  '46000000-0000-4000-8000-000000000305'
);
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT
  platform.grant_document_download(
    :'org_a_id',
    :'student_version_id',
    'student own document',
    60,
    '46000000-0000-4000-8000-000000000306'
  ) AS student_grant
\gset
SELECT set_config('storage.operation', 'storage.object.sign', false);
SELECT count(*) AS student_sign_count
FROM storage.objects
WHERE bucket_id = 'platform-documents'
  AND name = :'student_object_name'
\gset
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.grant_document_download(
  :'org_a_id',
  :'curator_version_id',
  'sales denied',
  60,
  '46000000-0000-4000-8000-000000000311'
);
\set sales_grant_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.grant_document_download(
  :'org_a_id',
  :'curator_version_id',
  'finance denied',
  60,
  '46000000-0000-4000-8000-000000000312'
);
\set finance_grant_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'previous_curator_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.grant_document_download(
  :'org_a_id',
  :'curator_version_id',
  'former curator denied',
  60,
  '46000000-0000-4000-8000-000000000313'
);
\set former_curator_grant_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.grant_document_download(
  :'org_a_id',
  :'curator_version_id',
  'cross student denied',
  60,
  '46000000-0000-4000-8000-000000000314'
);
\set cross_student_grant_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'admin_a_stale_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.grant_document_download(
  :'org_a_id',
  :'curator_version_id',
  'stale denied',
  60,
  '46000000-0000-4000-8000-000000000315'
);
\set stale_grant_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  :'student_sign_count'::INTEGER = 0
    AND :'sales_grant_state' <> '00000'
    AND :'finance_grant_state' <> '00000'
    AND :'former_curator_grant_state' <> '00000'
    AND :'cross_student_grant_state' <> '00000'
    AND :'stale_grant_state' <> '00000'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.document_download_grants
      WHERE request_id IN (
        '46000000-0000-4000-8000-000000000311',
        '46000000-0000-4000-8000-000000000312',
        '46000000-0000-4000-8000-000000000313',
        '46000000-0000-4000-8000-000000000314',
        '46000000-0000-4000-8000-000000000315'
      )
    ),
  'Admin/Student positive or staff/scope/stale grant denial failed'
);

-- A grant does not survive a later membership/access-version revocation. The
-- backend rechecks current authority at consumption time.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.change_membership_status(
  :'org_a_id',
  :'student_a_membership_id',
  'blocked',
  'P2H revoke before provider signing proof',
  '46000000-0000-4000-8000-000000000334'
);
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.consume_document_download_grant(
  (:'student_grant'::JSONB
    ->> 'document_download_grant_id')::UUID,
  '46000000-0000-4000-8000-000000000335'
);
\set revoked_student_consume_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  :'revoked_student_consume_state' <> '00000'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.document_download_consumptions
      WHERE request_id =
        '46000000-0000-4000-8000-000000000335'
    ),
  'revoked membership/access_version retained backend signing authority'
);

-- A one-second grant expires against the database clock and cannot be
-- consumed by the trusted backend.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT
  platform.grant_document_download(
    :'org_a_id',
    :'admin_version_id',
    'expiry proof',
    1,
    '46000000-0000-4000-8000-000000000320'
  ) AS expiring_admin_grant
\gset
RESET ROLE;
SELECT pg_sleep(1.1);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.consume_document_download_grant(
  (:'expiring_admin_grant'::JSONB
    ->> 'document_download_grant_id')::UUID,
  '46000000-0000-4000-8000-000000000333'
);
\set expired_admin_consume_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  :'expired_admin_consume_state' <> '00000'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.document_download_consumptions
      WHERE request_id =
        '46000000-0000-4000-8000-000000000333'
    ),
  'expired audited grant remained consumable'
);

-- Leave one immutable binding without a Storage object so the service-only
-- backup inventory must report missing_object.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT
  platform.reserve_document_upload(
    :'org_a_id',
    '46000000-0000-4000-8000-000000000104',
    'missing-object.pdf',
    'application/pdf',
    512,
    repeat('6', 64),
    '46000000-0000-4000-8000-000000000321'
  ) AS missing_object_reservation
\gset
RESET ROLE;

-- Private tables are not browser mutation/read surfaces.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT * FROM platform_private.document_upload_reservations LIMIT 1;
\set private_reservation_read_state :SQLSTATE
SELECT * FROM platform_private.document_storage_bindings LIMIT 1;
\set private_binding_read_state :SQLSTATE
SELECT * FROM platform_private.document_download_grants LIMIT 1;
\set private_grant_read_state :SQLSTATE
SELECT * FROM platform_private.document_download_consumptions LIMIT 1;
\set private_consumption_read_state :SQLSTATE
UPDATE platform.document_versions
SET sha256_hex = sha256_hex
WHERE id = :'curator_version_id';
\set version_update_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.p2h_assert_true(
  :'private_reservation_read_state' <> '00000'
    AND :'private_binding_read_state' <> '00000'
    AND :'private_grant_read_state' <> '00000'
    AND :'private_consumption_read_state' <> '00000'
    AND :'version_update_state' <> '00000',
  'private-table or immutable document metadata browser boundary failed'
);

RESET request.jwt.claims;
SELECT set_config('storage.operation', '', false);

\echo 'P2H private document Storage RLS passed'
