\set ON_ERROR_STOP on

-- Migration 108 current-boundary proof. Fixtures are synthetic, isolated and
-- rolled back; no provider, production or managed-project state is touched.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p108_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 108 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p108_capture_error(
  p_statement TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_statement;
  RETURN jsonb_build_object('ok', TRUE);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p108_document_queue(p_limit INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  payload JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(queue_row)), '[]'::JSONB)
  INTO payload
  FROM platform.staff_document_queue(p_limit) AS queue_row;
  RETURN payload;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p108_assert(BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p108_capture_error(TEXT)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p108_document_queue(INTEGER)
  TO authenticated;

DO $catalog_contract$
DECLARE
  rpc_name TEXT;
  routine_oid OID;
  routine_count INTEGER;
  routine_row pg_catalog.pg_proc%ROWTYPE;
  forbidden_role TEXT;
BEGIN
  FOREACH rpc_name IN ARRAY ARRAY[
    'create_custom_document_slot',
    'change_document_slot_metadata',
    'remove_document_slot'
  ]
  LOOP
    SELECT count(*), (array_agg(routine.oid))[1]
    INTO routine_count, routine_oid
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = rpc_name;

    IF routine_count <> 1 OR routine_oid IS NULL THEN
      RAISE EXCEPTION
        'Migration 108 must expose exactly one platform.% RPC, found %',
        rpc_name,
        routine_count;
    END IF;

    SELECT routine.* INTO STRICT routine_row
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = routine_oid;

    IF NOT routine_row.prosecdef
      OR routine_row.provolatile <> 'v'
      OR routine_row.prokind <> 'f'
      OR routine_row.proretset
      OR pg_catalog.pg_get_function_result(routine_oid) <> 'jsonb'
      OR NOT (routine_row.proconfig @> ARRAY['search_path=""']::TEXT[])
      OR routine_row.pronargdefaults <> 0
      OR NOT COALESCE(
        routine_row.proargnames @> ARRAY['p_request_id']::TEXT[],
        FALSE
      )
    THEN
      RAISE EXCEPTION 'Migration 108 RPC contract drifted for platform.%',
        rpc_name;
    END IF;

    IF NOT pg_catalog.has_function_privilege(
      'authenticated', routine_oid, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'authenticated lacks EXECUTE on platform.%', rpc_name;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon',
      'service_role',
      'supabase_auth_admin'
    ]
    LOOP
      IF pg_catalog.has_function_privilege(
        forbidden_role, routine_oid, 'EXECUTE'
      ) THEN
        RAISE EXCEPTION '% unexpectedly has EXECUTE on platform.%',
          forbidden_role,
          rpc_name;
      END IF;
    END LOOP;
  END LOOP;

  IF pg_catalog.pg_get_function_identity_arguments(
    'platform.create_custom_document_slot(uuid,uuid,text,text,uuid)'::REGPROCEDURE
  ) <> 'p_organization_id uuid, p_student_case_id uuid, p_label text, p_group_label text, p_request_id uuid'
    OR pg_catalog.pg_get_function_identity_arguments(
      'platform.change_document_slot_metadata(uuid,uuid,uuid,text,text,bigint,text,uuid)'::REGPROCEDURE
    ) <> 'p_organization_id uuid, p_student_case_id uuid, p_document_slot_id uuid, p_label text, p_group_label text, p_expected_version bigint, p_reason text, p_request_id uuid'
    OR pg_catalog.pg_get_function_identity_arguments(
      'platform.remove_document_slot(uuid,uuid,uuid,bigint,text,uuid)'::REGPROCEDURE
    ) <> 'p_organization_id uuid, p_student_case_id uuid, p_document_slot_id uuid, p_expected_version bigint, p_reason text, p_request_id uuid'
  THEN
    RAISE EXCEPTION 'Migration 108 RPC signatures drifted';
  END IF;

  IF (
    SELECT attribute.attnotnull
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'platform.document_slots'::REGCLASS
      AND attribute.attname = 'requirement_id'
  )
    OR (
      SELECT attribute.attnotnull
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid =
        'platform.student_portal_notification_projection_v1'::REGCLASS
        AND attribute.attname = 'document_requirement_id'
    )
    OR NOT (
      SELECT attribute.attnotnull
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'platform.document_slots'::REGCLASS
        AND attribute.attname = 'intent_kind'
    )
    OR NOT (
      SELECT attribute.attnotnull
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'platform.document_slots'::REGCLASS
        AND attribute.attname = 'version'
    )
  THEN
    RAISE EXCEPTION 'Migration 108 slot nullability/version contract drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.document_requirements AS requirement
    WHERE requirement.group_label IS NULL
      OR btrim(requirement.group_label) = ''
  )
    OR EXISTS (
      SELECT 1
      FROM platform.document_slots AS slot
      WHERE slot.intent_kind <> 'baseline'
        OR slot.version <> 1
        OR slot.requirement_id IS NULL
    )
  THEN
    RAISE EXCEPTION 'Migration 108 baseline backfill is incomplete';
  END IF;

  IF NOT (
    'document.slot.custom.create' = ANY(
      platform_private.p7a_safe_audit_actions()
    )
    AND 'document.slot.metadata.change' = ANY(
      platform_private.p7a_safe_audit_actions()
    )
    AND 'document.slot.remove' = ANY(
      platform_private.p7a_safe_audit_actions()
    )
    AND platform_private.p7a_safe_audit_actions() = (
      SELECT array_agg(DISTINCT action ORDER BY action)
      FROM unnest(platform_private.p7a_safe_audit_actions()) AS item(action)
    )
  ) THEN
    RAISE EXCEPTION 'Migration 108 audit action allowlist is incomplete';
  END IF;
END
$catalog_contract$;

\set p108_org_a '59910000-0000-4000-8000-000000000001'
\set p108_org_b '59910000-0000-4000-8000-000000000002'
\set p108_case_a '59910000-0000-4000-8000-000000000011'
\set p108_case_a2 '59910000-0000-4000-8000-000000000012'
\set p108_org_scope_a '59910000-0000-4000-8000-000000000021'
\set p108_org_scope_b '59910000-0000-4000-8000-000000000022'
\set p108_case_scope_a '59910000-0000-4000-8000-000000000023'
\set p108_case_scope_a2 '59910000-0000-4000-8000-000000000024'
\set p108_case_scope_a_v2 '59910000-0000-4000-8000-000000000025'
\set p108_case_scope_a2_v2 '59910000-0000-4000-8000-000000000026'

\set p108_admin_a_user '59910000-0000-4000-8000-000000000101'
\set p108_sales_a_user '59910000-0000-4000-8000-000000000102'
\set p108_curator_a_user '59910000-0000-4000-8000-000000000103'
\set p108_student_a_user '59910000-0000-4000-8000-000000000104'
\set p108_admin_b_user '59910000-0000-4000-8000-000000000105'

\set p108_admin_a_profile '59910000-0000-4000-8000-000000000201'
\set p108_sales_a_profile '59910000-0000-4000-8000-000000000202'
\set p108_curator_a_profile '59910000-0000-4000-8000-000000000203'
\set p108_student_a_profile '59910000-0000-4000-8000-000000000204'
\set p108_admin_b_profile '59910000-0000-4000-8000-000000000205'

\set p108_admin_a_membership '59910000-0000-4000-8000-000000000301'
\set p108_sales_a_membership '59910000-0000-4000-8000-000000000302'
\set p108_curator_a_membership '59910000-0000-4000-8000-000000000303'
\set p108_student_a_membership '59910000-0000-4000-8000-000000000304'
\set p108_admin_b_membership '59910000-0000-4000-8000-000000000305'

\set p108_requirement_a '59910000-0000-4000-8000-000000000401'
\set p108_baseline_slot_a '59910000-0000-4000-8000-000000000402'
\set p108_historical_version '59910000-0000-4000-8000-000000000403'
\set p108_historical_version_two '59910000-0000-4000-8000-000000000404'

SELECT bundle.id AS p108_admin_bundle, bundle.version AS p108_admin_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p108_sales_bundle, bundle.version AS p108_sales_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p108_curator_bundle, bundle.version AS p108_curator_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p108_student_bundle, bundle.version AS p108_student_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

INSERT INTO platform.organizations (id, name)
VALUES
  (:'p108_org_a', 'Migration 108 Organization A'),
  (:'p108_org_b', 'Migration 108 Organization B');

INSERT INTO platform_private.student_portal_notification_runtime_controls (
  organization_id,
  enabled
)
VALUES (:'p108_org_a', TRUE);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'p108_admin_a_user', 'p108-admin-a@example.invalid', '{}'),
  (:'p108_sales_a_user', 'p108-sales-a@example.invalid', '{}'),
  (:'p108_curator_a_user', 'p108-curator-a@example.invalid', '{}'),
  (:'p108_student_a_user', 'p108-student-a@example.invalid', '{}'),
  (:'p108_admin_b_user', 'p108-admin-b@example.invalid', '{}');

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
)
VALUES
  (:'p108_admin_a_profile', :'p108_admin_a_user', 'P108 Admin A', 'active', 1),
  (:'p108_sales_a_profile', :'p108_sales_a_user', 'P108 Sales A', 'active', 1),
  (:'p108_curator_a_profile', :'p108_curator_a_user', 'P108 Admissions A', 'active', 1),
  (:'p108_student_a_profile', :'p108_student_a_user', 'P108 Student A', 'active', 1),
  (:'p108_admin_b_profile', :'p108_admin_b_user', 'P108 Admin B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
VALUES
  (:'p108_admin_a_membership', :'p108_org_a', :'p108_admin_a_profile', 'active', 'admin', :'p108_admin_bundle'),
  (:'p108_sales_a_membership', :'p108_org_a', :'p108_sales_a_profile', 'active', 'sales', :'p108_sales_bundle'),
  (:'p108_curator_a_membership', :'p108_org_a', :'p108_curator_a_profile', 'active', 'curator', :'p108_curator_bundle'),
  (:'p108_student_a_membership', :'p108_org_a', :'p108_student_a_profile', 'active', 'student', :'p108_student_bundle'),
  (:'p108_admin_b_membership', :'p108_org_b', :'p108_admin_b_profile', 'active', 'admin', :'p108_admin_bundle');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
)
VALUES
  (:'p108_org_scope_a', :'p108_org_a', 'organization', :'p108_org_a', 1),
  (:'p108_org_scope_b', :'p108_org_b', 'organization', :'p108_org_b', 1),
  (:'p108_case_scope_a', :'p108_org_a', 'student_case', :'p108_case_a', 1),
  (:'p108_case_scope_a2', :'p108_org_a', 'student_case', :'p108_case_a2', 1);

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
SELECT
  fixture.id,
  fixture.organization_id,
  fixture.membership_id,
  fixture.scope_id,
  1,
  1,
  TRUE,
  'system',
  NULL,
  'Migration 108 isolated scope',
  fixture.request_id
FROM (VALUES
  ('59910000-0000-4000-8000-000000000501'::UUID, :'p108_org_a'::UUID, :'p108_admin_a_membership'::UUID, :'p108_org_scope_a'::UUID, '59910000-0000-4000-8000-000000000601'::UUID),
  ('59910000-0000-4000-8000-000000000502'::UUID, :'p108_org_b'::UUID, :'p108_admin_b_membership'::UUID, :'p108_org_scope_b'::UUID, '59910000-0000-4000-8000-000000000602'::UUID),
  ('59910000-0000-4000-8000-000000000505'::UUID, :'p108_org_a'::UUID, :'p108_sales_a_membership'::UUID, :'p108_case_scope_a'::UUID, '59910000-0000-4000-8000-000000000605'::UUID),
  ('59910000-0000-4000-8000-000000000506'::UUID, :'p108_org_a'::UUID, :'p108_student_a_membership'::UUID, :'p108_case_scope_a'::UUID, '59910000-0000-4000-8000-000000000606'::UUID)
) AS fixture(id, organization_id, membership_id, scope_id, request_id);

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, closed_at, next_action, current_scope_id,
  current_scope_version
)
VALUES
  (
    :'p108_case_a', :'p108_org_a', :'p108_student_a_membership',
    :'p108_sales_a_membership', NULL,
    'synthetic:p108:case:a', 'synthetic:p108:contract:a', statement_timestamp(),
    'P108 Student A', 'United Kingdom', 'Bachelor', 'Business',
    '2027 Fall', 'approved', 'contract_confirmed', 'pending', NULL,
    NULL, NULL, 'Prepare handoff', :'p108_case_scope_a', 1
  ),
  (
    :'p108_case_a2', :'p108_org_a', :'p108_student_a_membership',
    :'p108_sales_a_membership', NULL,
    'synthetic:p108:case:a2', 'synthetic:p108:contract:a2', statement_timestamp(),
    'P108 Student A2', 'Canada', 'Master', 'Computing',
    '2027 Fall', 'approved', 'contract_confirmed', 'pending', NULL,
    NULL, NULL, 'Prepare handoff', :'p108_case_scope_a2', 1
  );

UPDATE platform.record_scopes AS scope
SET is_active = FALSE
WHERE scope.id IN (:'p108_case_scope_a', :'p108_case_scope_a2');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
)
VALUES
  (:'p108_case_scope_a_v2', :'p108_org_a', 'student_case', :'p108_case_a', 2),
  (:'p108_case_scope_a2_v2', :'p108_org_a', 'student_case', :'p108_case_a2', 2);

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
VALUES
  (
    '59910000-0000-4000-8000-000000000503', :'p108_org_a',
    :'p108_curator_a_membership', :'p108_case_scope_a_v2', 2, 1, TRUE,
    'system', NULL, 'Migration 108 active-case scope',
    '59910000-0000-4000-8000-000000000603'
  ),
  (
    '59910000-0000-4000-8000-000000000504', :'p108_org_a',
    :'p108_curator_a_membership', :'p108_case_scope_a2_v2', 2, 1, TRUE,
    'system', NULL, 'Migration 108 closed-case scope',
    '59910000-0000-4000-8000-000000000604'
  ),
  (
    '59910000-0000-4000-8000-000000000507', :'p108_org_a',
    :'p108_student_a_membership', :'p108_case_scope_a_v2', 2, 1, TRUE,
    'system', NULL, 'Migration 108 Student Portal scope',
    '59910000-0000-4000-8000-000000000607'
  );

UPDATE platform.student_cases AS student_case
SET
  current_curator_membership_id = :'p108_curator_a_membership',
  operational_stage = 'documents',
  state = 'active',
  handoff_at = statement_timestamp(),
  portal_activated_at = statement_timestamp(),
  next_action = 'Collect documents',
  current_scope_id = CASE student_case.id
    WHEN :'p108_case_a'::UUID THEN :'p108_case_scope_a_v2'::UUID
    ELSE :'p108_case_scope_a2_v2'::UUID
  END,
  current_scope_version = 2
WHERE student_case.id IN (:'p108_case_a', :'p108_case_a2');

INSERT INTO platform.document_requirements (
  id, organization_id, target_country, target_degree, program_direction,
  checklist_version, requirement_key, label, instructions, status,
  created_by_membership_id
)
VALUES (
  :'p108_requirement_a', :'p108_org_a', 'United Kingdom', 'Bachelor',
  'Business', 1, 'passport', 'Passport', 'Upload a clear passport scan.',
  'active', :'p108_admin_a_membership'
);

INSERT INTO platform.document_slots (
  id, organization_id, student_case_id, requirement_id, status,
  created_by_membership_id
)
VALUES (
  :'p108_baseline_slot_a', :'p108_org_a', :'p108_case_a',
  :'p108_requirement_a', 'required', :'p108_curator_a_membership'
);

SELECT pg_temp.p108_assert(
  (
    SELECT requirement.group_label = 'Обязательные документы'
    FROM platform.document_requirements AS requirement
    WHERE requirement.id = :'p108_requirement_a'
  )
  AND (
    SELECT slot.intent_kind = 'baseline'
      AND slot.version = 1
      AND slot.removed_at IS NULL
    FROM platform.document_slots AS slot
    WHERE slot.id = :'p108_baseline_slot_a'
  ),
  'baseline defaults/backfill are not durable'
);

SELECT
  jsonb_build_object(
    'sub', :'p108_admin_a_user',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', 1,
    'platform_organization_id', :'p108_org_a',
    'platform_membership_id', :'p108_admin_a_membership',
    'platform_bundle_id', :'p108_admin_bundle',
    'platform_bundle_version', :'p108_admin_bundle_version'::INTEGER
  )::TEXT AS p108_admin_a_claims,
  jsonb_build_object(
    'sub', :'p108_sales_a_user',
    'role', 'authenticated',
    'platform_role', 'sales',
    'platform_access_version', 1,
    'platform_organization_id', :'p108_org_a',
    'platform_membership_id', :'p108_sales_a_membership',
    'platform_bundle_id', :'p108_sales_bundle',
    'platform_bundle_version', :'p108_sales_bundle_version'::INTEGER
  )::TEXT AS p108_sales_a_claims,
  jsonb_build_object(
    'sub', :'p108_curator_a_user',
    'role', 'authenticated',
    'platform_role', 'curator',
    'platform_access_version', 1,
    'platform_organization_id', :'p108_org_a',
    'platform_membership_id', :'p108_curator_a_membership',
    'platform_bundle_id', :'p108_curator_bundle',
    'platform_bundle_version', :'p108_curator_bundle_version'::INTEGER
  )::TEXT AS p108_curator_a_claims,
  jsonb_build_object(
    'sub', :'p108_student_a_user',
    'role', 'authenticated',
    'platform_role', 'student',
    'platform_access_version', 1,
    'platform_organization_id', :'p108_org_a',
    'platform_membership_id', :'p108_student_a_membership',
    'platform_bundle_id', :'p108_student_bundle',
    'platform_bundle_version', :'p108_student_bundle_version'::INTEGER
  )::TEXT AS p108_student_a_claims,
  jsonb_build_object(
    'sub', :'p108_admin_b_user',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', 1,
    'platform_organization_id', :'p108_org_b',
    'platform_membership_id', :'p108_admin_b_membership',
    'platform_bundle_id', :'p108_admin_bundle',
    'platform_bundle_version', :'p108_admin_bundle_version'::INTEGER
  )::TEXT AS p108_admin_b_claims
\gset

SET request.jwt.claims TO :'p108_curator_a_claims';
SET ROLE authenticated;

SELECT platform.create_custom_document_slot(
  :'p108_org_a',
  :'p108_case_a',
  'Parent consent letter',
  'Personal documents',
  '59910000-0000-4000-8000-000000000701'
)::TEXT AS p108_custom_create
\gset

SELECT platform.create_custom_document_slot(
  :'p108_org_a',
  :'p108_case_a',
  'Parent consent letter',
  'Personal documents',
  '59910000-0000-4000-8000-000000000701'
)::TEXT AS p108_custom_create_replay
\gset

SELECT pg_temp.p108_assert(
  :'p108_custom_create'::JSONB = :'p108_custom_create_replay'::JSONB
    AND :'p108_custom_create'::JSONB ->> 'document_requirement_id' IS NULL
    AND :'p108_custom_create'::JSONB ->> 'intent_kind' = 'custom'
    AND :'p108_custom_create'::JSONB ->> 'version' = '1',
  'Admissions custom create or immutable replay failed'
);

SELECT :'p108_custom_create'::JSONB ->> 'document_slot_id'
  AS p108_custom_slot_a
\gset

RESET ROLE;
RESET request.jwt.claims;

INSERT INTO platform.document_versions (
  id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex,
  ingest_evidence_ref, submitted_by_membership_id
)
VALUES (
  :'p108_historical_version', :'p108_org_a', :'p108_case_a',
  :'p108_custom_slot_a', 1, 'consent.pdf', 'application/pdf', 1024,
  repeat('a', 64), 'synthetic:p108:historical-version',
  :'p108_curator_a_membership'
);

UPDATE platform.document_slots AS slot
SET
  status = 'submitted',
  current_version_id = :'p108_historical_version',
  current_version_no = 1
WHERE slot.id = :'p108_custom_slot_a';

INSERT INTO platform.document_versions (
  id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex,
  ingest_evidence_ref, submitted_by_membership_id
)
VALUES (
  :'p108_historical_version_two', :'p108_org_a', :'p108_case_a',
  :'p108_custom_slot_a', 2, 'consent-v2.pdf', 'application/pdf', 2048,
  repeat('b', 64), 'synthetic:p108:historical-version-two',
  :'p108_curator_a_membership'
);

-- Regression: canonical upload finalization republishes a submitted slot as
-- submitted with a new current-version pointer. Metadata guards must not
-- break this pre-existing second-upload transition.
UPDATE platform.document_slots AS slot
SET
  status = 'submitted',
  current_version_id = :'p108_historical_version_two',
  current_version_no = 2
WHERE slot.id = :'p108_custom_slot_a';

SELECT pg_temp.p108_assert(
  (
    SELECT slot.status = 'submitted'
      AND slot.current_version_id = :'p108_historical_version_two'
      AND slot.current_version_no = 2
      AND slot.version = 3
    FROM platform.document_slots AS slot
    WHERE slot.id = :'p108_custom_slot_a'
  ),
  'submitted-to-submitted second upload transition regressed'
);

SET request.jwt.claims TO :'p108_curator_a_claims';
SET ROLE authenticated;

SELECT pg_temp.p108_assert(
  EXISTS (
    SELECT 1
    FROM platform.staff_student_case_documents(:'p108_case_a') AS document
    WHERE document.document_slot_id = :'p108_custom_slot_a'
      AND document.document_requirement_id IS NULL
      AND document.requirement_key IS NULL
      AND document.requirement_label = 'Parent consent letter'
      AND document.instructions IS NULL
      AND document.checklist_version IS NULL
      AND document.document_version_id = :'p108_historical_version_two'
      AND document.version_no = 2
  ),
  'staff document projection omitted the custom slot'
);

SELECT platform.review_document_version_with_portal_notification_v1(
  :'p108_org_a',
  :'p108_historical_version_two',
  'correction_required',
  'Please upload a signed parent consent letter.',
  '59910000-0000-4000-8000-000000000711'
)::TEXT AS p108_custom_review
\gset

SELECT pg_temp.p108_assert(
  :'p108_custom_review'::JSONB ->> 'document_slot_id'
      = :'p108_custom_slot_a'
    AND :'p108_custom_review'::JSONB ->> 'decision'
      = 'correction_required'
    AND :'p108_custom_review'::JSONB ->> 'slot_status'
      = 'correction_required',
  'custom slot review command failed'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p108_assert(
  (
    SELECT count(*) = 1
    FROM platform.document_reviews AS review
    JOIN platform.student_portal_notification_projection_v1 AS projection
      ON projection.organization_id = review.organization_id
      AND projection.source_record_id = review.id
      AND projection.document_slot_id = review.document_slot_id
      AND projection.document_version_id = review.document_version_id
    JOIN platform.notifications AS notification
      ON notification.organization_id = projection.organization_id
      AND notification.id = projection.notification_id
    WHERE review.request_id =
      '59910000-0000-4000-8000-000000000711'
      AND projection.document_requirement_id IS NULL
      AND projection.requirement_label = 'Parent consent letter'
      AND projection.review_decision = 'correction_required'
      AND notification.body =
        'Parent consent letter: Please upload a signed parent consent letter.'
  ),
  'custom slot review did not publish a nullable immutable Portal projection'
);

SET request.jwt.claims TO :'p108_student_a_claims';
SET ROLE authenticated;

SELECT pg_temp.p108_assert(
  EXISTS (
    SELECT 1
    FROM platform.student_portal_notifications_v1() AS notification
    WHERE notification.review_decision = 'correction_required'
      AND notification.requirement_key IS NULL
      AND notification.requirement_label = 'Parent consent letter'
      AND notification.reason =
        'Please upload a signed parent consent letter.'
  )
    AND EXISTS (
      SELECT 1
      FROM platform.student_portal_notifications_v2() AS notification
      WHERE notification.event_code = 'correction_required'
        AND notification.subject_label = 'Parent consent letter'
        AND notification.detail =
          'Please upload a signed parent consent letter.'
    )
    AND EXISTS (
      SELECT 1
      FROM platform.student_portal_documents() AS document
      WHERE document.document_slot_id = :'p108_custom_slot_a'
        AND document.requirement_key IS NULL
        AND document.requirement_label = 'Parent consent letter'
        AND document.instructions IS NULL
        AND document.document_version_id = :'p108_historical_version_two'
        AND document.version_no = 2
        AND document.review_decision = 'correction_required'
        AND document.rework_reason =
          'Please upload a signed parent consent letter.'
    ),
  'Student Portal v1/v2 notification or document projection omitted custom intent'
);

RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'p108_sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p108_capture_error(format(
  'SELECT platform.create_custom_document_slot(%L::uuid,%L::uuid,%L,%L,%L::uuid)',
  :'p108_org_a', :'p108_case_a', 'Sales slot', 'Sales group',
  '59910000-0000-4000-8000-000000000702'
))::TEXT AS p108_sales_denied
\gset
RESET ROLE;
RESET request.jwt.claims;

SET ROLE anon;
SELECT pg_temp.p108_capture_error(format(
  'SELECT platform.create_custom_document_slot(%L::uuid,%L::uuid,%L,%L,%L::uuid)',
  :'p108_org_a', :'p108_case_a', 'Anon slot', 'Anon group',
  '59910000-0000-4000-8000-000000000703'
))::TEXT AS p108_anon_denied
\gset
RESET ROLE;

SET request.jwt.claims TO :'p108_admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.p108_capture_error(format(
  'SELECT platform.create_custom_document_slot(%L::uuid,%L::uuid,%L,%L,%L::uuid)',
  :'p108_org_a', :'p108_case_a', 'Cross-org slot', 'Cross-org group',
  '59910000-0000-4000-8000-000000000704'
))::TEXT AS p108_cross_org_denied
\gset
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'p108_curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p108_capture_error(format(
  'SELECT platform.change_document_slot_metadata(%L::uuid,%L::uuid,%L::uuid,%L,%L,1,%L,%L::uuid)',
  :'p108_org_a', :'p108_case_a2', :'p108_baseline_slot_a',
  'Wrong case label', 'Wrong case group', 'Wrong case must fail',
  '59910000-0000-4000-8000-000000000705'
))::TEXT AS p108_cross_case_denied
\gset
RESET ROLE;
RESET request.jwt.claims;

UPDATE platform.student_cases AS student_case
SET
  state = 'closed',
  closed_at = statement_timestamp(),
  next_action = 'Case closed'
WHERE student_case.id = :'p108_case_a2';

SET request.jwt.claims TO :'p108_curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p108_capture_error(format(
  'SELECT platform.create_custom_document_slot(%L::uuid,%L::uuid,%L,%L,%L::uuid)',
  :'p108_org_a', :'p108_case_a2', 'Closed case slot', 'Closed group',
  '59910000-0000-4000-8000-000000000710'
))::TEXT AS p108_closed_case_denied
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p108_assert(
  :'p108_sales_denied'::JSONB ->> 'sqlstate' = '42501'
    AND :'p108_anon_denied'::JSONB ->> 'sqlstate' = '42501'
    AND :'p108_cross_org_denied'::JSONB ->> 'sqlstate' = '42501'
    AND :'p108_cross_case_denied'::JSONB ->> 'sqlstate' = '42501'
    AND :'p108_closed_case_denied'::JSONB ->> 'sqlstate' = '42501',
  'sales/anon/cross-org/cross-case/closed-case denial failed'
);

SET request.jwt.claims TO :'p108_admin_a_claims';
SET ROLE authenticated;

SELECT platform.change_document_slot_metadata(
  :'p108_org_a',
  :'p108_case_a',
  :'p108_baseline_slot_a',
  'Travel passport',
  'Identity documents',
  1,
  'Use the case-specific checklist wording',
  '59910000-0000-4000-8000-000000000706'
)::TEXT AS p108_baseline_change
\gset

SELECT pg_temp.p108_capture_error(format(
  'SELECT platform.change_document_slot_metadata(%L::uuid,%L::uuid,%L::uuid,%L,%L,1,%L,%L::uuid)',
  :'p108_org_a', :'p108_case_a', :'p108_baseline_slot_a',
  'Stale rename', 'Stale group', 'Stale version must fail',
  '59910000-0000-4000-8000-000000000707'
))::TEXT AS p108_stale_change
\gset

SELECT platform.staff_student_case_document_workspace(:'p108_case_a')::TEXT
  AS p108_workspace_before_remove
\gset
SELECT pg_temp.p108_document_queue(101)::TEXT AS p108_queue_before_remove
\gset

SELECT pg_temp.p108_assert(
  :'p108_baseline_change'::JSONB ->> 'version' = '2'
    AND :'p108_baseline_change'::JSONB ->> 'intent_kind' = 'baseline'
    AND :'p108_stale_change'::JSONB ->> 'sqlstate' = 'PT409'
    AND :'p108_stale_change'::JSONB ->> 'message'
      = 'document_slot_version_conflict'
    AND (
      SELECT requirement.label = 'Passport'
        AND requirement.group_label = 'Обязательные документы'
      FROM platform.document_requirements AS requirement
      WHERE requirement.id = :'p108_requirement_a'
    )
    AND (
      SELECT slot.display_label = 'Travel passport'
        AND slot.group_label = 'Identity documents'
        AND slot.version = 2
      FROM platform.document_slots AS slot
      WHERE slot.id = :'p108_baseline_slot_a'
    ),
  'baseline override mutated the shared requirement or version contract'
);

SELECT pg_temp.p108_assert(
  jsonb_array_length(
    :'p108_workspace_before_remove'::JSONB -> 'slots'
  ) = 2
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        :'p108_workspace_before_remove'::JSONB -> 'slots'
      ) AS slot(payload)
      WHERE slot.payload ->> 'document_slot_id' = :'p108_baseline_slot_a'
        AND slot.payload ->> 'document_requirement_id' = :'p108_requirement_a'
        AND slot.payload ->> 'requirement_key' = 'passport'
        AND slot.payload ->> 'requirement_label' = 'Travel passport'
        AND slot.payload ->> 'group_label' = 'Identity documents'
        AND slot.payload ->> 'intent_kind' = 'baseline'
        AND slot.payload ->> 'slot_version' = '2'
        AND slot.payload ->> 'checklist_version' = '1'
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        :'p108_workspace_before_remove'::JSONB -> 'slots'
      ) AS slot(payload)
      WHERE slot.payload ->> 'document_slot_id' = :'p108_custom_slot_a'
        AND slot.payload -> 'document_requirement_id' = 'null'::JSONB
        AND slot.payload -> 'requirement_key' = 'null'::JSONB
        AND slot.payload -> 'checklist_version' = 'null'::JSONB
        AND slot.payload ->> 'requirement_label' = 'Parent consent letter'
        AND slot.payload ->> 'group_label' = 'Personal documents'
        AND slot.payload ->> 'intent_kind' = 'custom'
        AND slot.payload ->> 'slot_version' = '4'
        AND slot.payload ?& ARRAY[
          'instructions', 'slot_status', 'deadline', 'next_action',
          'current_version_id', 'current_version_no', 'created_at',
          'updated_at', 'versions'
        ]
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(:'p108_queue_before_remove'::JSONB)
        AS queue_row(payload)
      WHERE queue_row.payload ->> 'document_slot_id' = :'p108_baseline_slot_a'
        AND queue_row.payload ->> 'requirement_label' = 'Travel passport'
    ),
  'workspace shape/custom nullability/resolved queue label failed'
);

SELECT platform.change_document_slot_metadata(
  :'p108_org_a',
  :'p108_case_a',
  :'p108_custom_slot_a',
  'Renamed parent consent letter',
  'Personal documents',
  4,
  'Rename after the review was published',
  '59910000-0000-4000-8000-000000000712'
)::TEXT AS p108_custom_rename_after_review
\gset

RESET ROLE;
RESET request.jwt.claims;
SET request.jwt.claims TO :'p108_student_a_claims';
SET ROLE authenticated;

SELECT pg_temp.p108_assert(
  :'p108_custom_rename_after_review'::JSONB ->> 'version' = '5'
    AND EXISTS (
      SELECT 1
      FROM platform.student_portal_notifications_v1() AS notification
      WHERE notification.review_decision = 'correction_required'
        AND notification.requirement_key IS NULL
        AND notification.requirement_label = 'Parent consent letter'
        AND notification.reason =
          'Please upload a signed parent consent letter.'
    )
    AND EXISTS (
      SELECT 1
      FROM platform.student_portal_notifications_v2() AS notification
      WHERE notification.category = 'document.review'
        AND notification.event_code = 'correction_required'
        AND notification.subject_label = 'Parent consent letter'
        AND notification.detail =
          'Please upload a signed parent consent letter.'
    ),
  'published Portal v1/v2 review evidence changed after the custom slot rename'
);

RESET ROLE;
RESET request.jwt.claims;
SET request.jwt.claims TO :'p108_admin_a_claims';
SET ROLE authenticated;

SELECT platform.remove_document_slot(
  :'p108_org_a',
  :'p108_case_a',
  :'p108_custom_slot_a',
  5,
  'The case no longer requires parental consent',
  '59910000-0000-4000-8000-000000000708'
)::TEXT AS p108_custom_remove
\gset

SELECT platform.remove_document_slot(
  :'p108_org_a',
  :'p108_case_a',
  :'p108_custom_slot_a',
  5,
  'The case no longer requires parental consent',
  '59910000-0000-4000-8000-000000000708'
)::TEXT AS p108_custom_remove_replay
\gset

SELECT platform.staff_student_case_document_workspace(:'p108_case_a')::TEXT
  AS p108_workspace_after_remove
\gset
SELECT pg_temp.p108_document_queue(101)::TEXT AS p108_queue_after_remove
\gset

SELECT pg_temp.p108_assert(
  :'p108_custom_remove'::JSONB = :'p108_custom_remove_replay'::JSONB
    AND :'p108_custom_remove'::JSONB ->> 'version' = '6'
    AND :'p108_custom_remove'::JSONB ->> 'intent_kind' = 'custom'
    AND :'p108_custom_remove'::JSONB ->> 'removal_reason'
      = 'The case no longer requires parental consent'
    AND jsonb_array_length(
      :'p108_workspace_after_remove'::JSONB -> 'slots'
    ) = 1
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        :'p108_workspace_after_remove'::JSONB -> 'slots'
      ) AS slot(payload)
      WHERE slot.payload ->> 'document_slot_id' = :'p108_custom_slot_a'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(:'p108_queue_after_remove'::JSONB)
        AS queue_row(payload)
      WHERE queue_row.payload ->> 'document_slot_id' = :'p108_custom_slot_a'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.staff_student_case_documents(:'p108_case_a') AS document
      WHERE document.document_slot_id = :'p108_custom_slot_a'
    ),
  'soft removal replay or active-only staff projections failed'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p108_capture_error(format(
  'INSERT INTO platform.document_versions (organization_id,student_case_id,document_slot_id,version_no,original_filename,declared_mime_type,byte_size,sha256_hex,ingest_evidence_ref,submitted_by_membership_id) VALUES (%L::uuid,%L::uuid,%L::uuid,3,%L,%L,1024,%L,%L,%L::uuid)',
  :'p108_org_a', :'p108_case_a', :'p108_custom_slot_a',
  'late-version.pdf', 'application/pdf', repeat('b', 64),
  'synthetic:p108:blocked-version', :'p108_curator_a_membership'
))::TEXT AS p108_removed_version_denied
\gset

SET request.jwt.claims TO :'p108_curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p108_capture_error(format(
  'SELECT platform.reserve_document_upload(%L::uuid,%L::uuid,%L,%L,1024,%L,%L::uuid)',
  :'p108_org_a', :'p108_custom_slot_a', 'late-upload.pdf',
  'application/pdf', repeat('c', 64),
  '59910000-0000-4000-8000-000000000709'
))::TEXT AS p108_removed_upload_denied
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p108_assert(
  :'p108_removed_version_denied'::JSONB ->> 'sqlstate' = '42501'
    AND :'p108_removed_version_denied'::JSONB ->> 'message'
      = 'Document slot is unavailable for a new version'
    AND :'p108_removed_upload_denied'::JSONB ->> 'sqlstate' = '42501'
    AND (
      SELECT count(*) = 2
      FROM platform.document_versions AS version
      WHERE version.document_slot_id = :'p108_custom_slot_a'
        AND version.id IN (
          :'p108_historical_version',
          :'p108_historical_version_two'
        )
    )
    AND (
      SELECT slot.removed_at IS NOT NULL
        AND slot.removed_by_membership_id = :'p108_admin_a_membership'
        AND slot.removal_reason
          = 'The case no longer requires parental consent'
        AND slot.version = 5
      FROM platform.document_slots AS slot
      WHERE slot.id = :'p108_custom_slot_a'
    ),
  'removed-slot upload/version guard or history preservation failed'
);

SELECT pg_temp.p108_assert(
  (
    SELECT count(*) = 3
    FROM platform.audit_events AS event
    WHERE event.request_id IN (
      '59910000-0000-4000-8000-000000000701',
      '59910000-0000-4000-8000-000000000706',
      '59910000-0000-4000-8000-000000000708'
    )
      AND event.action IN (
        'document.slot.custom.create',
        'document.slot.metadata.change',
        'document.slot.remove'
      )
  ),
  'exactly-once document slot audit coverage failed'
);

ROLLBACK;

SELECT 'platform dynamic document checklist tests passed' AS result;
