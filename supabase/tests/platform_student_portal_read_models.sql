\set ON_ERROR_STOP on

-- Migration 127 current-boundary proof. Every fixture is synthetic and the
-- transaction rolls back; no managed Supabase or provider state is touched.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE OR REPLACE FUNCTION pg_temp.p127_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 127 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p127_capture_error(p_statement TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_statement;
  RETURN pg_catalog.jsonb_build_object('ok', TRUE);
EXCEPTION
  WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p127_assert(BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p127_capture_error(TEXT)
  TO authenticated;

-- New read models are stable set-returning SECURITY DEFINER RPCs with an empty
-- search_path and the smallest role grant. Their exact OUT columns are the
-- browser data-minimization contract.
DO $catalog_contract$
DECLARE
  contract RECORD;
  routine_oid OID;
  routine_row pg_catalog.pg_proc%ROWTYPE;
  output_columns TEXT[];
  forbidden_role TEXT;
  routine_definition TEXT;
BEGIN
  FOR contract IN
    SELECT * FROM (
      VALUES
        (
          'platform.student_portal_overview_v1()',
          ARRAY[
            'operational_stage',
            'next_action',
            'next_action_due_at',
            'next_action_due_on',
            'curator_display_name'
          ]::TEXT[]
        ),
        (
          'platform.student_portal_applications_v2()',
          ARRAY[
            'application_id',
            'institution_name',
            'program_name',
            'application_status',
            'is_primary',
            'university_deadline_on'
          ]::TEXT[]
        ),
        (
          'platform.student_portal_application_timeline_v1(uuid,integer)',
          ARRAY['previous_status', 'new_status', 'occurred_at']::TEXT[]
        ),
        (
          'platform.student_portal_visa_cases_v2()',
          ARRAY['visa_case_id', 'visa_status']::TEXT[]
        ),
        (
          'platform.student_portal_visa_timeline_v1(uuid,integer)',
          ARRAY['previous_status', 'new_status', 'occurred_at']::TEXT[]
        ),
        (
          'platform.student_portal_finance_v2()',
          ARRAY[
            'obligation_label',
            'category',
            'amount_minor',
            'paid_minor',
            'refunded_minor',
            'outstanding_minor',
            'currency',
            'due_at',
            'derived_status',
            'overdue',
            'next_action'
          ]::TEXT[]
        )
    ) AS expected(signature, columns)
  LOOP
    routine_oid := pg_catalog.to_regprocedure(contract.signature);
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION 'Migration 127 routine is missing: %', contract.signature;
    END IF;

    SELECT * INTO STRICT routine_row
    FROM pg_catalog.pg_proc
    WHERE oid = routine_oid;

    IF NOT routine_row.prosecdef
      OR routine_row.provolatile <> 's'
      OR routine_row.prokind <> 'f'
      OR NOT routine_row.proretset
      OR routine_row.pronargdefaults <> 0
      OR NOT (routine_row.proconfig @> ARRAY['search_path=""']::TEXT[])
    THEN
      RAISE EXCEPTION 'Migration 127 routine contract drifted: %',
        contract.signature;
    END IF;

    SELECT pg_catalog.coalesce(
      pg_catalog.array_agg(parameter.parameter_name::TEXT
        ORDER BY parameter.ordinal_position),
      ARRAY[]::TEXT[]
    )
    INTO output_columns
    FROM information_schema.parameters AS parameter
    WHERE parameter.specific_schema = 'platform'
      AND parameter.specific_name =
        routine_row.proname || '_' || routine_oid::TEXT
      AND parameter.parameter_mode = 'OUT';

    IF output_columns IS DISTINCT FROM contract.columns THEN
      RAISE EXCEPTION 'Migration 127 OUT columns drifted for %: %',
        contract.signature,
        output_columns;
    END IF;

    IF NOT pg_catalog.has_function_privilege(
      'authenticated', routine_oid, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'authenticated lacks EXECUTE on %', contract.signature;
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
        RAISE EXCEPTION '% unexpectedly has EXECUTE on %',
          forbidden_role,
          contract.signature;
      END IF;
    END LOOP;

    routine_definition := pg_catalog.pg_get_functiondef(routine_oid);
    IF routine_definition NOT LIKE '%student_membership.status = ''active''%'
      OR routine_definition NOT LIKE '%student_profile.status = ''active''%'
      OR routine_definition NOT LIKE '%organization.status = ''active''%'
      OR routine_definition NOT LIKE '%bundle.status = ''published''%'
      OR routine_definition NOT LIKE '%student_case.portal_activated_at IS NOT NULL%'
      OR routine_definition NOT LIKE '%platform_can_read_student_portal_case%'
      OR routine_definition NOT LIKE '%''portal.read.self''%'
      OR routine_definition NOT LIKE '%''organization''::platform.scope_kind%'
      OR routine_definition NOT LIKE '%''student_case''::platform.scope_kind%'
    THEN
      RAISE EXCEPTION 'Migration 127 explicit Student-self checks drifted: %',
        contract.signature;
    END IF;
  END LOOP;
END
$catalog_contract$;

-- Existing migration-108 document and notification signatures remain the only
-- active projections for those tabs.
DO $reuse_contract$
DECLARE
  routine_oid OID;
  output_columns TEXT[];
BEGIN
  routine_oid := 'platform.student_portal_documents()'::REGPROCEDURE;
  SELECT pg_catalog.array_agg(parameter.parameter_name::TEXT
    ORDER BY parameter.ordinal_position)
  INTO output_columns
  FROM information_schema.parameters AS parameter
  JOIN pg_catalog.pg_proc AS routine
    ON parameter.specific_name = routine.proname || '_' || routine.oid::TEXT
  WHERE routine.oid = routine_oid
    AND parameter.specific_schema = 'platform'
    AND parameter.parameter_mode = 'OUT';
  IF output_columns IS DISTINCT FROM ARRAY[
    'case_id', 'document_slot_id', 'requirement_key', 'requirement_label',
    'instructions', 'slot_status', 'deadline', 'next_action',
    'document_version_id', 'version_no', 'original_filename',
    'declared_mime_type', 'byte_size', 'submitted_at', 'review_decision',
    'rework_reason', 'reviewed_at'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Migration 108 student_portal_documents signature drifted';
  END IF;

  routine_oid := 'platform.student_portal_notifications_v2()'::REGPROCEDURE;
  SELECT pg_catalog.array_agg(parameter.parameter_name::TEXT
    ORDER BY parameter.ordinal_position)
  INTO output_columns
  FROM information_schema.parameters AS parameter
  JOIN pg_catalog.pg_proc AS routine
    ON parameter.specific_name = routine.proname || '_' || routine.oid::TEXT
  WHERE routine.oid = routine_oid
    AND parameter.specific_schema = 'platform'
    AND parameter.parameter_mode = 'OUT';
  IF output_columns IS DISTINCT FROM ARRAY[
    'notification_id', 'category', 'event_code', 'subject_label', 'detail',
    'due_at', 'created_at', 'read_at'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Migration 108 student_portal_notifications_v2 signature drifted';
  END IF;
END
$reuse_contract$;

-- Every source table retains forced RLS. SECURITY DEFINER bypass never becomes
-- a reason to weaken the table boundary.
SELECT pg_temp.p127_assert(
  (
    SELECT pg_catalog.bool_and(class.relrowsecurity AND class.relforcerowsecurity)
    FROM pg_catalog.pg_class AS class
    WHERE class.oid = ANY(ARRAY[
      'platform.student_cases'::REGCLASS,
      'platform.case_tasks'::REGCLASS,
      'platform.university_applications'::REGCLASS,
      'platform.university_application_events'::REGCLASS,
      'platform.visa_cases'::REGCLASS,
      'platform.visa_case_events'::REGCLASS,
      'platform.payment_obligations'::REGCLASS,
      'platform.document_slots'::REGCLASS,
      'platform.document_versions'::REGCLASS,
      'platform.document_reviews'::REGCLASS,
      'platform.notifications'::REGCLASS
    ])
  ),
  'Student Portal source tables must retain ENABLE + FORCE RLS'
);

\set p127_org '59927000-0000-4000-8000-000000000001'
\set p127_org_scope '59927000-0000-4000-8000-000000000002'
\set p127_case_a '59927000-0000-4000-8000-000000000011'
\set p127_case_b '59927000-0000-4000-8000-000000000012'
\set p127_case_c '59927000-0000-4000-8000-000000000013'
\set p127_case_scope_a '59927000-0000-4000-8000-000000000021'
\set p127_case_scope_b '59927000-0000-4000-8000-000000000022'
\set p127_case_scope_c '59927000-0000-4000-8000-000000000023'

\set p127_admin_user '59927000-0000-4000-8000-000000000101'
\set p127_sales_user '59927000-0000-4000-8000-000000000102'
\set p127_curator_user '59927000-0000-4000-8000-000000000103'
\set p127_student_a_user '59927000-0000-4000-8000-000000000104'
\set p127_student_b_user '59927000-0000-4000-8000-000000000105'
\set p127_student_c_user '59927000-0000-4000-8000-000000000106'

\set p127_admin_profile '59927000-0000-4000-8000-000000000201'
\set p127_sales_profile '59927000-0000-4000-8000-000000000202'
\set p127_curator_profile '59927000-0000-4000-8000-000000000203'
\set p127_student_a_profile '59927000-0000-4000-8000-000000000204'
\set p127_student_b_profile '59927000-0000-4000-8000-000000000205'
\set p127_student_c_profile '59927000-0000-4000-8000-000000000206'

\set p127_admin_membership '59927000-0000-4000-8000-000000000301'
\set p127_sales_membership '59927000-0000-4000-8000-000000000302'
\set p127_curator_membership '59927000-0000-4000-8000-000000000303'
\set p127_student_a_membership '59927000-0000-4000-8000-000000000304'
\set p127_student_b_membership '59927000-0000-4000-8000-000000000305'
\set p127_student_c_membership '59927000-0000-4000-8000-000000000306'

\set p127_application_a '59927000-0000-4000-8000-000000000401'
\set p127_application_b '59927000-0000-4000-8000-000000000402'
\set p127_application_c '59927000-0000-4000-8000-000000000403'
\set p127_visa_a '59927000-0000-4000-8000-000000000411'
\set p127_visa_b '59927000-0000-4000-8000-000000000412'
\set p127_obligation_a '59927000-0000-4000-8000-000000000421'
\set p127_obligation_b '59927000-0000-4000-8000-000000000422'
\set p127_obligation_c '59927000-0000-4000-8000-000000000423'

SELECT bundle.id AS p127_admin_bundle,
       bundle.version AS p127_admin_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

SELECT bundle.id AS p127_sales_bundle,
       bundle.version AS p127_sales_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

SELECT bundle.id AS p127_curator_bundle,
       bundle.version AS p127_curator_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

SELECT bundle.id AS p127_student_bundle,
       bundle.version AS p127_student_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

INSERT INTO platform.organizations (id, name)
VALUES (:'p127_org', 'Migration 127 Organization');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'p127_admin_user', 'p127-admin@example.invalid', '{}'),
  (:'p127_sales_user', 'p127-sales@example.invalid', '{}'),
  (:'p127_curator_user', 'p127-curator@example.invalid', '{}'),
  (:'p127_student_a_user', 'p127-student-a@example.invalid', '{}'),
  (:'p127_student_b_user', 'p127-student-b@example.invalid', '{}'),
  (:'p127_student_c_user', 'p127-student-c@example.invalid', '{}');

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
)
VALUES
  (:'p127_admin_profile', :'p127_admin_user', 'P127 Admin', 'active', 1),
  (:'p127_sales_profile', :'p127_sales_user', 'P127 Sales', 'active', 1),
  (:'p127_curator_profile', :'p127_curator_user', 'P127 Curator', 'active', 1),
  (:'p127_student_a_profile', :'p127_student_a_user', 'P127 Student A', 'active', 1),
  (:'p127_student_b_profile', :'p127_student_b_user', 'P127 Student B', 'active', 1),
  (:'p127_student_c_profile', :'p127_student_c_user', 'P127 Student C', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
VALUES
  (:'p127_admin_membership', :'p127_org', :'p127_admin_profile', 'active', 'admin', :'p127_admin_bundle'),
  (:'p127_sales_membership', :'p127_org', :'p127_sales_profile', 'active', 'sales', :'p127_sales_bundle'),
  (:'p127_curator_membership', :'p127_org', :'p127_curator_profile', 'active', 'curator', :'p127_curator_bundle'),
  (:'p127_student_a_membership', :'p127_org', :'p127_student_a_profile', 'active', 'student', :'p127_student_bundle'),
  (:'p127_student_b_membership', :'p127_org', :'p127_student_b_profile', 'active', 'student', :'p127_student_bundle'),
  (:'p127_student_c_membership', :'p127_org', :'p127_student_c_profile', 'active', 'student', :'p127_student_bundle');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
)
VALUES
  (:'p127_org_scope', :'p127_org', 'organization', :'p127_org', 1),
  (:'p127_case_scope_a', :'p127_org', 'student_case', :'p127_case_a', 1),
  (:'p127_case_scope_b', :'p127_org', 'student_case', :'p127_case_b', 1),
  (:'p127_case_scope_c', :'p127_org', 'student_case', :'p127_case_c', 1);

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
SELECT
  fixture.id,
  :'p127_org',
  fixture.membership_id,
  fixture.scope_id,
  1,
  1,
  TRUE,
  'system',
  NULL,
  'Migration 127 isolated scope',
  fixture.request_id
FROM (VALUES
  ('59927000-0000-4000-8000-000000000501'::UUID, :'p127_admin_membership'::UUID, :'p127_org_scope'::UUID, '59927000-0000-4000-8000-000000000601'::UUID),
  ('59927000-0000-4000-8000-000000000502'::UUID, :'p127_student_a_membership'::UUID, :'p127_org_scope'::UUID, '59927000-0000-4000-8000-000000000602'::UUID),
  ('59927000-0000-4000-8000-000000000503'::UUID, :'p127_student_a_membership'::UUID, :'p127_case_scope_a'::UUID, '59927000-0000-4000-8000-000000000603'::UUID),
  ('59927000-0000-4000-8000-000000000504'::UUID, :'p127_student_b_membership'::UUID, :'p127_org_scope'::UUID, '59927000-0000-4000-8000-000000000604'::UUID),
  ('59927000-0000-4000-8000-000000000505'::UUID, :'p127_student_b_membership'::UUID, :'p127_case_scope_b'::UUID, '59927000-0000-4000-8000-000000000605'::UUID),
  ('59927000-0000-4000-8000-000000000506'::UUID, :'p127_student_c_membership'::UUID, :'p127_org_scope'::UUID, '59927000-0000-4000-8000-000000000606'::UUID),
  ('59927000-0000-4000-8000-000000000507'::UUID, :'p127_student_c_membership'::UUID, :'p127_case_scope_c'::UUID, '59927000-0000-4000-8000-000000000607'::UUID)
) AS fixture(id, membership_id, scope_id, request_id);

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
    :'p127_case_a', :'p127_org', :'p127_student_a_membership',
    :'p127_sales_membership', :'p127_curator_membership',
    'synthetic:p127:case:a', 'synthetic:p127:contract:a',
    '2026-09-01T08:00:00Z', 'P127 Student A', 'United Kingdom',
    'Bachelor', 'Computer Science', '2027 Fall', 'approved',
    'documents', 'active', '2026-09-01T09:00:00Z',
    '2026-09-01T09:00:00Z', NULL, 'Fallback student action',
    :'p127_case_scope_a', 1
  ),
  (
    :'p127_case_b', :'p127_org', :'p127_student_b_membership',
    :'p127_sales_membership', :'p127_curator_membership',
    'synthetic:p127:case:b', 'synthetic:p127:contract:b',
    '2026-09-01T08:00:00Z', 'P127 Student B', 'Canada',
    'Master', 'Data Science', '2027 Fall', 'approved',
    'applications', 'active', '2026-09-01T09:00:00Z',
    '2026-09-01T09:00:00Z', NULL, 'Other student action',
    :'p127_case_scope_b', 1
  ),
  (
    :'p127_case_c', :'p127_org', :'p127_student_c_membership',
    :'p127_sales_membership', NULL,
    'synthetic:p127:case:c', 'synthetic:p127:contract:c',
    '2026-09-01T08:00:00Z', 'P127 Student C', 'Türkiye',
    'Bachelor', 'Business', '2027 Fall', 'approved',
    'contract_confirmed', 'pending', NULL, NULL, NULL,
    'Inactive portal action', :'p127_case_scope_c', 1
  );

INSERT INTO platform.university_applications (
  id, organization_id, student_case_id, institution_name, program_name,
  status, latest_evidence_reference, created_by_membership_id, is_primary,
  university_deadline_on
)
VALUES
  (
    :'p127_application_a', :'p127_org', :'p127_case_a',
    'University of Example', 'Computer Science', 'submitted',
    'internal:p127:application:a', :'p127_curator_membership', TRUE, NULL
  ),
  (
    :'p127_application_b', :'p127_org', :'p127_case_b',
    'Other University', 'Data Science', 'offer',
    'internal:p127:application:b', :'p127_curator_membership', TRUE,
    '2026-10-01'
  ),
  (
    :'p127_application_c', :'p127_org', :'p127_case_c',
    'Inactive Portal University', 'Business', 'ready', NULL,
    :'p127_curator_membership', TRUE, NULL
  );

INSERT INTO platform.university_application_events (
  id, organization_id, application_id, student_case_id, previous_status,
  new_status, evidence_reference, note, actor_membership_id, request_id,
  created_at
)
VALUES
  ('59927000-0000-4000-8000-000000000701', :'p127_org', :'p127_application_a', :'p127_case_a', NULL, 'preparation', NULL, 'internal initial note', :'p127_curator_membership', '59927000-0000-4000-8000-000000000801', '2026-09-01T10:00:00Z'),
  ('59927000-0000-4000-8000-000000000702', :'p127_org', :'p127_application_a', :'p127_case_a', 'preparation', 'ready', NULL, 'internal ready note', :'p127_curator_membership', '59927000-0000-4000-8000-000000000802', '2026-09-02T10:00:00Z'),
  ('59927000-0000-4000-8000-000000000703', :'p127_org', :'p127_application_a', :'p127_case_a', 'ready', 'submitted', 'internal:p127:application:a', 'internal submitted note', :'p127_curator_membership', '59927000-0000-4000-8000-000000000803', '2026-09-03T10:00:00Z'),
  ('59927000-0000-4000-8000-000000000704', :'p127_org', :'p127_application_b', :'p127_case_b', 'under_review', 'offer', 'internal:p127:application:b', 'other student note', :'p127_curator_membership', '59927000-0000-4000-8000-000000000804', '2026-09-04T10:00:00Z');

INSERT INTO platform.visa_cases (
  id, organization_id, student_case_id, status, latest_evidence_reference,
  created_by_membership_id
)
VALUES
  (:'p127_visa_a', :'p127_org', :'p127_case_a', 'approved', 'internal:p127:visa:a', :'p127_curator_membership'),
  (:'p127_visa_b', :'p127_org', :'p127_case_b', 'submitted', NULL, :'p127_curator_membership');

INSERT INTO platform.visa_case_events (
  id, organization_id, visa_case_id, student_case_id, previous_status,
  new_status, evidence_reference, note, actor_membership_id, request_id,
  created_at
)
VALUES
  ('59927000-0000-4000-8000-000000000711', :'p127_org', :'p127_visa_a', :'p127_case_a', NULL, 'docs', NULL, 'internal visa note', :'p127_curator_membership', '59927000-0000-4000-8000-000000000811', '2026-09-01T11:00:00Z'),
  ('59927000-0000-4000-8000-000000000712', :'p127_org', :'p127_visa_a', :'p127_case_a', 'docs', 'submitted', 'internal:p127:visa:submitted', 'internal visa note', :'p127_curator_membership', '59927000-0000-4000-8000-000000000812', '2026-09-02T11:00:00Z'),
  ('59927000-0000-4000-8000-000000000713', :'p127_org', :'p127_visa_a', :'p127_case_a', 'submitted', 'approved', 'internal:p127:visa:a', 'internal visa note', :'p127_curator_membership', '59927000-0000-4000-8000-000000000813', '2026-09-03T11:00:00Z'),
  ('59927000-0000-4000-8000-000000000714', :'p127_org', :'p127_visa_b', :'p127_case_b', 'docs', 'submitted', NULL, 'other student visa note', :'p127_curator_membership', '59927000-0000-4000-8000-000000000814', '2026-09-04T11:00:00Z');

INSERT INTO platform.payment_obligations (
  id, organization_id, student_case_id, label, category, amount_minor,
  currency, due_at, next_action, total_paid_minor, total_refunded_minor,
  created_by_membership_id
)
VALUES
  (:'p127_obligation_a', :'p127_org', :'p127_case_a', 'EVO service fee', 'evo_service_fee', 10000, 'USD', '2099-10-01T08:00:00Z', 'Pay the remaining balance', 4000, 1000, :'p127_curator_membership'),
  (:'p127_obligation_b', :'p127_org', :'p127_case_b', 'Other student fee', 'third_party_cost', 20000, 'USD', '2099-10-02T08:00:00Z', 'Other student action', 0, 0, :'p127_curator_membership'),
  (:'p127_obligation_c', :'p127_org', :'p127_case_c', 'Inactive portal fee', 'evo_service_fee', 30000, 'USD', '2099-10-03T08:00:00Z', 'Inactive portal action', 0, 0, :'p127_curator_membership');

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p127_student_a_user',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p127_org',
  'platform_membership_id', :'p127_student_a_membership',
  'platform_bundle_id', :'p127_student_bundle',
  'platform_bundle_version', :'p127_student_bundle_version'::BIGINT
)::TEXT AS p127_student_a_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p127_student_a_profile'
\gset

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p127_student_c_user',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p127_org',
  'platform_membership_id', :'p127_student_c_membership',
  'platform_bundle_id', :'p127_student_bundle',
  'platform_bundle_version', :'p127_student_bundle_version'::BIGINT
)::TEXT AS p127_student_c_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p127_student_c_profile'
\gset

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p127_admin_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p127_org',
  'platform_membership_id', :'p127_admin_membership',
  'platform_bundle_id', :'p127_admin_bundle',
  'platform_bundle_version', :'p127_admin_bundle_version'::BIGINT
)::TEXT AS p127_admin_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p127_admin_profile'
\gset

SET request.jwt.claims TO :'p127_student_a_claims';
SET ROLE authenticated;

SELECT pg_temp.p127_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.min(operational_stage) = 'documents'
      AND pg_catalog.min(next_action) = 'Fallback student action'
      AND pg_catalog.bool_and(next_action_due_at IS NULL)
      AND pg_catalog.bool_and(next_action_due_on IS NULL)
      AND pg_catalog.min(curator_display_name) = 'P127 Curator'
    FROM platform.student_portal_overview_v1()
  ),
  'overview fallback and active curator facts drifted'
);

SELECT pg_temp.p127_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(application_id = :'p127_application_a'::UUID)
      AND pg_catalog.min(application_status::TEXT) = 'submitted'
      AND pg_catalog.bool_and(is_primary)
      AND pg_catalog.bool_and(university_deadline_on IS NULL)
    FROM platform.student_portal_applications_v2()
  ),
  'application projection leaked another case or invented a deadline'
);

SELECT pg_temp.p127_assert(
  (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.min(new_status::TEXT)
        FILTER (WHERE occurred_at = '2026-09-03T10:00:00Z') = 'submitted'
      AND pg_catalog.min(previous_status::TEXT)
        FILTER (WHERE occurred_at = '2026-09-02T10:00:00Z') = 'preparation'
    FROM platform.student_portal_application_timeline_v1(
      :'p127_application_a',
      2
    )
  ),
  'application timeline is not bounded to safe status facts'
);

SELECT pg_temp.p127_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.student_portal_application_timeline_v1(
      :'p127_application_b',
      100
    )
  ),
  'application timeline crossed the exact Student case boundary'
);

SELECT pg_temp.p127_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(visa_case_id = :'p127_visa_a'::UUID)
      AND pg_catalog.min(visa_status::TEXT) = 'approved'
    FROM platform.student_portal_visa_cases_v2()
  ),
  'visa projection leaked another Student case'
);

SELECT pg_temp.p127_assert(
  (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.max(occurred_at) = '2026-09-03T11:00:00Z'
      AND pg_catalog.min(occurred_at) = '2026-09-02T11:00:00Z'
    FROM platform.student_portal_visa_timeline_v1(:'p127_visa_a', 2)
  ),
  'visa timeline is not bounded and newest-first'
);

SELECT pg_temp.p127_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.student_portal_visa_timeline_v1(:'p127_visa_b', 100)
  ),
  'visa timeline crossed the exact Student case boundary'
);

SELECT pg_temp.p127_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.min(amount_minor) = 10000
      AND pg_catalog.min(paid_minor) = 4000
      AND pg_catalog.min(refunded_minor) = 1000
      AND pg_catalog.min(outstanding_minor) = 7000
      AND pg_catalog.min(derived_status::TEXT) = 'partially_paid'
      AND NOT pg_catalog.bool_or(overdue)
    FROM platform.student_portal_finance_v2()
  ),
  'finance projection or exact minor-unit outstanding drifted'
);

SELECT pg_temp.p127_assert(
  NOT EXISTS (SELECT 1 FROM platform.student_cases)
    AND NOT EXISTS (SELECT 1 FROM platform.university_applications)
    AND NOT EXISTS (SELECT 1 FROM platform.visa_cases)
    AND NOT EXISTS (SELECT 1 FROM platform.payment_obligations),
  'Student gained a direct base-table read instead of projection-only access'
);

SELECT pg_temp.p127_assert(
  NOT EXISTS (SELECT 1 FROM platform.student_portal_documents())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_notifications_v2()),
  'reused document/notification projections should stay empty for this case'
);

SELECT pg_temp.p127_assert(
  (
    pg_temp.p127_capture_error(
      'SELECT * FROM platform.student_portal_application_timeline_v1('''
        || :'p127_application_a'
        || '''::UUID, 0)'
    ) ->> 'sqlstate'
  ) = '22023'
  AND (
    pg_temp.p127_capture_error(
      'SELECT * FROM platform.student_portal_visa_timeline_v1('''
        || :'p127_visa_a'
        || '''::UUID, 101)'
    ) ->> 'sqlstate'
  ) = '22023',
  'timeline bounds must reject limits outside 1..100'
);

RESET ROLE;
RESET request.jwt.claims;

-- Match migration 110 ordering exactly: timed instants remain exact, all-day
-- values compare at the start of their Bishkek day, undated tasks sort last,
-- and the title/date always come from the same row.
SAVEPOINT p127_timed_task_order;
INSERT INTO platform.case_tasks (
  id, organization_id, student_case_id, task_type, title,
  assignee_membership_id, priority, due_at, due_on, status, student_visible,
  created_by_membership_id
)
VALUES
  ('59927000-0000-4000-8000-000000000901', :'p127_org', :'p127_case_a', 'portal_next', 'Timed exact action', :'p127_curator_membership', 'normal', '2026-09-09T17:59:00Z', NULL, 'open', TRUE, :'p127_curator_membership'),
  ('59927000-0000-4000-8000-000000000902', :'p127_org', :'p127_case_a', 'portal_next', 'All-day later action', :'p127_curator_membership', 'normal', NULL, '2026-09-10', 'open', TRUE, :'p127_curator_membership'),
  ('59927000-0000-4000-8000-000000000903', :'p127_org', :'p127_case_a', 'portal_next', 'Undated action', :'p127_curator_membership', 'normal', NULL, NULL, 'blocked', TRUE, :'p127_curator_membership'),
  ('59927000-0000-4000-8000-000000000904', :'p127_org', :'p127_case_a', 'portal_next', 'Invisible earlier action', :'p127_curator_membership', 'normal', '2026-09-01T00:00:00Z', NULL, 'open', FALSE, :'p127_curator_membership'),
  ('59927000-0000-4000-8000-000000000905', :'p127_org', :'p127_case_a', 'portal_next', 'Done earlier action', :'p127_curator_membership', 'normal', '2026-09-01T00:00:00Z', NULL, 'done', TRUE, :'p127_curator_membership');

SET request.jwt.claims TO :'p127_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p127_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.min(next_action) = 'Timed exact action'
      AND pg_catalog.min(next_action_due_at) = '2026-09-09T17:59:00Z'
      AND pg_catalog.bool_and(next_action_due_on IS NULL)
    FROM platform.student_portal_overview_v1()
  ),
  'overview did not keep the earliest timed task title and due_at together'
);
RESET ROLE;
RESET request.jwt.claims;
ROLLBACK TO SAVEPOINT p127_timed_task_order;

SAVEPOINT p127_all_day_task_order;
INSERT INTO platform.case_tasks (
  id, organization_id, student_case_id, task_type, title,
  assignee_membership_id, priority, due_at, due_on, status, student_visible,
  created_by_membership_id
)
VALUES
  ('59927000-0000-4000-8000-000000000911', :'p127_org', :'p127_case_a', 'portal_next', 'All-day exact action', :'p127_curator_membership', 'normal', NULL, '2026-09-10', 'in_progress', TRUE, :'p127_curator_membership'),
  ('59927000-0000-4000-8000-000000000912', :'p127_org', :'p127_case_a', 'portal_next', 'Timed later action', :'p127_curator_membership', 'normal', '2026-09-09T18:01:00Z', NULL, 'open', TRUE, :'p127_curator_membership'),
  ('59927000-0000-4000-8000-000000000913', :'p127_org', :'p127_case_a', 'portal_next', 'Undated action', :'p127_curator_membership', 'normal', NULL, NULL, 'blocked', TRUE, :'p127_curator_membership');

SET request.jwt.claims TO :'p127_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p127_assert(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.min(next_action) = 'All-day exact action'
      AND pg_catalog.bool_and(next_action_due_at IS NULL)
      AND pg_catalog.min(next_action_due_on) = '2026-09-10'::DATE
    FROM platform.student_portal_overview_v1()
  ),
  'overview did not keep the Bishkek all-day task title and due_on together'
);
RESET ROLE;
RESET request.jwt.claims;
ROLLBACK TO SAVEPOINT p127_all_day_task_order;

-- A live Student authority with an exact pending case scope still receives no
-- data until the case portal is activated.
SET request.jwt.claims TO :'p127_student_c_claims';
SET ROLE authenticated;
SELECT pg_temp.p127_assert(
  NOT EXISTS (SELECT 1 FROM platform.student_portal_overview_v1())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_applications_v2())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_visa_cases_v2())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_finance_v2()),
  'portal-inactive Student case exposed data'
);
RESET ROLE;
RESET request.jwt.claims;

-- Staff cannot use Student-self projections even with broad Admin authority.
SET request.jwt.claims TO :'p127_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p127_assert(
  NOT EXISTS (SELECT 1 FROM platform.student_portal_overview_v1())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_applications_v2())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_application_timeline_v1(:'p127_application_a', 10))
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_visa_cases_v2())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_visa_timeline_v1(:'p127_visa_a', 10))
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_finance_v2()),
  'staff authority entered a Student-self projection'
);
RESET ROLE;
RESET request.jwt.claims;

-- Removing the Student case scope is fail-closed even while every other
-- identity, activation and permission fact stays valid.
SAVEPOINT p127_case_scope_denial;
INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
VALUES (
  '59927000-0000-4000-8000-000000000521', :'p127_org',
  :'p127_student_a_membership', :'p127_case_scope_a', 1, 2, FALSE,
  'system', NULL, 'Migration 127 case-scope denial',
  '59927000-0000-4000-8000-000000000621'
);
SET request.jwt.claims TO :'p127_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p127_assert(
  NOT EXISTS (SELECT 1 FROM platform.student_portal_overview_v1())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_applications_v2())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_finance_v2()),
  'revoked exact case scope exposed Student Portal data'
);
RESET ROLE;
RESET request.jwt.claims;
ROLLBACK TO SAVEPOINT p127_case_scope_denial;

-- Removing organization scope prevents current authority resolution and every
-- read model remains empty.
SAVEPOINT p127_org_scope_denial;
INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
VALUES (
  '59927000-0000-4000-8000-000000000522', :'p127_org',
  :'p127_student_a_membership', :'p127_org_scope', 1, 2, FALSE,
  'system', NULL, 'Migration 127 organization-scope denial',
  '59927000-0000-4000-8000-000000000622'
);
SET request.jwt.claims TO :'p127_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p127_assert(
  NOT EXISTS (SELECT 1 FROM platform.student_portal_overview_v1())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_applications_v2())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_finance_v2()),
  'revoked organization scope exposed Student Portal data'
);
RESET ROLE;
RESET request.jwt.claims;
ROLLBACK TO SAVEPOINT p127_org_scope_denial;

-- Portal permission is mandatory for every projection; finance additionally
-- requires finance.read.self.
SAVEPOINT p127_portal_permission_denial;
DELETE FROM platform.role_bundle_permissions
WHERE bundle_id = :'p127_student_bundle'
  AND permission_key = 'portal.read.self';
SET request.jwt.claims TO :'p127_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p127_assert(
  NOT EXISTS (SELECT 1 FROM platform.student_portal_overview_v1())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_applications_v2())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_finance_v2()),
  'missing portal.read.self exposed Student Portal data'
);
RESET ROLE;
RESET request.jwt.claims;
ROLLBACK TO SAVEPOINT p127_portal_permission_denial;

SAVEPOINT p127_finance_permission_denial;
DELETE FROM platform.role_bundle_permissions
WHERE bundle_id = :'p127_student_bundle'
  AND permission_key = 'finance.read.self';
SET request.jwt.claims TO :'p127_student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p127_assert(
  EXISTS (SELECT 1 FROM platform.student_portal_overview_v1())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_finance_v2()),
  'finance projection did not enforce finance.read.self independently'
);
RESET ROLE;
RESET request.jwt.claims;
ROLLBACK TO SAVEPOINT p127_finance_permission_denial;

ROLLBACK;
