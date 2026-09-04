\set ON_ERROR_STOP on

-- Migration 113 current-boundary proof. Fixtures are synthetic, isolated and
-- rolled back; no provider, production or managed-project state is touched.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p113_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 113 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p113_capture_error(
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

CREATE OR REPLACE FUNCTION pg_temp.p113_insert_link_sqlstate(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_document_slot_id UUID,
  p_target_kind platform.document_slot_case_link_target_kind,
  p_university_application_id UUID,
  p_visa_case_id UUID,
  p_created_by_membership_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO platform.document_slot_case_links (
    organization_id,
    student_case_id,
    document_slot_id,
    target_kind,
    university_application_id,
    visa_case_id,
    created_by_membership_id
  )
  VALUES (
    p_organization_id,
    p_student_case_id,
    p_document_slot_id,
    p_target_kind,
    p_university_application_id,
    p_visa_case_id,
    p_created_by_membership_id
  );
  RETURN '00000';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p113_assert(BOOLEAN, TEXT)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p113_capture_error(TEXT)
  TO anon, authenticated;

DO $catalog_contract$
DECLARE
  table_oid OID := 'platform.document_slot_case_links'::REGCLASS;
  type_oid OID := 'platform.document_slot_case_link_target_kind'::REGTYPE;
  link_rpc_oid OID := (
    'platform.set_document_slot_case_link(uuid,uuid,uuid,platform.document_slot_case_link_target_kind,uuid,boolean,bigint,text,uuid)'::REGPROCEDURE
  )::OID;
  workspace_rpc_oid OID := (
    'platform.staff_student_case_document_workspace(uuid)'::REGPROCEDURE
  )::OID;
  slot_guard_oid OID := (
    'platform_private.guard_dynamic_document_slot_transition()'::REGPROCEDURE
  )::OID;
  forbidden_role TEXT;
BEGIN
  IF NOT (
    SELECT class.relrowsecurity AND class.relforcerowsecurity
    FROM pg_catalog.pg_class AS class
    WHERE class.oid = table_oid
  ) THEN
    RAISE EXCEPTION 'document_slot_case_links RLS must be enabled and forced';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'platform'
      AND policy.tablename = 'document_slot_case_links'
      AND policy.policyname = 'document_slot_case_links_full_read'
      AND 'authenticated' = ANY(policy.roles)
      AND policy.cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'document_slot_case_links read policy is missing';
  END IF;

  IF NOT pg_catalog.has_table_privilege('authenticated', table_oid, 'SELECT')
    OR pg_catalog.has_table_privilege('authenticated', table_oid, 'INSERT')
    OR pg_catalog.has_table_privilege('authenticated', table_oid, 'UPDATE')
    OR pg_catalog.has_table_privilege('authenticated', table_oid, 'DELETE')
    OR pg_catalog.has_table_privilege('anon', table_oid, 'SELECT')
    OR pg_catalog.has_table_privilege('service_role', table_oid, 'INSERT')
  THEN
    RAISE EXCEPTION 'document_slot_case_links table grants drifted';
  END IF;

  IF NOT pg_catalog.has_type_privilege('authenticated', type_oid, 'USAGE')
    OR pg_catalog.has_type_privilege('anon', type_oid, 'USAGE')
    OR pg_catalog.has_type_privilege('service_role', type_oid, 'USAGE')
  THEN
    RAISE EXCEPTION 'document slot case link enum grants drifted';
  END IF;

  IF NOT (
    SELECT routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.prokind = 'f'
      AND NOT routine.proretset
      AND pg_catalog.pg_get_function_result(routine.oid) = 'jsonb'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = link_rpc_oid
  ) THEN
    RAISE EXCEPTION 'set_document_slot_case_link hardening drifted';
  END IF;

  IF pg_catalog.pg_get_function_identity_arguments(link_rpc_oid) <>
    'p_organization_id uuid, p_student_case_id uuid, p_document_slot_id uuid, p_target_kind platform.document_slot_case_link_target_kind, p_target_id uuid, p_enabled boolean, p_expected_version bigint, p_reason text, p_request_id uuid'
  THEN
    RAISE EXCEPTION 'set_document_slot_case_link signature drifted';
  END IF;

  IF NOT (
    SELECT routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.prokind = 'f'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = slot_guard_oid
  ) THEN
    RAISE EXCEPTION 'document slot transition guard hardening drifted';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon',
    'authenticated',
    'service_role',
    'supabase_auth_admin'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(forbidden_role, slot_guard_oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION '% unexpectedly executes document slot transition guard',
        forbidden_role;
    END IF;
  END LOOP;

  IF NOT (
    SELECT routine.prosecdef
      AND routine.provolatile = 's'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = workspace_rpc_oid
  ) THEN
    RAISE EXCEPTION 'staff document workspace hardening drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege('authenticated', link_rpc_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(
      'authenticated',
      workspace_rpc_oid,
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'authenticated lacks document case-link execution grants';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon',
    'service_role',
    'supabase_auth_admin'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(forbidden_role, link_rpc_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege(
        forbidden_role,
        workspace_rpc_oid,
        'EXECUTE'
      )
    THEN
      RAISE EXCEPTION '% unexpectedly executes document case-link RPCs',
        forbidden_role;
    END IF;
  END LOOP;

  IF NOT (
    SELECT bool_and(pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE expected.pattern)
    FROM (VALUES
      (
        'document_slot_case_links_document_slot_fkey',
        '%FOREIGN KEY (organization_id, document_slot_id, student_case_id)%REFERENCES platform.document_slots(organization_id, id, student_case_id)%'
      ),
      (
        'document_slot_case_links_university_application_fkey',
        '%FOREIGN KEY (organization_id, university_application_id, student_case_id)%REFERENCES platform.university_applications(organization_id, id, student_case_id)%'
      ),
      (
        'document_slot_case_links_visa_case_fkey',
        '%FOREIGN KEY (organization_id, visa_case_id, student_case_id)%REFERENCES platform.visa_cases(organization_id, id, student_case_id)%'
      )
    ) AS expected(name, pattern)
    JOIN pg_catalog.pg_constraint AS constraint_row
      ON constraint_row.conrelid = table_oid
      AND constraint_row.conname = expected.name
      AND constraint_row.contype = 'f'
  ) THEN
    RAISE EXCEPTION 'document case-link composite foreign keys drifted';
  END IF;

  IF NOT (
    'document.slot.application.link' = ANY(platform_private.p7a_safe_audit_actions())
    AND 'document.slot.application.unlink' = ANY(platform_private.p7a_safe_audit_actions())
    AND 'document.slot.visa.link' = ANY(platform_private.p7a_safe_audit_actions())
    AND 'document.slot.visa.unlink' = ANY(platform_private.p7a_safe_audit_actions())
    AND platform_private.p7a_safe_audit_actions() = (
      SELECT array_agg(DISTINCT action ORDER BY action)
      FROM unnest(platform_private.p7a_safe_audit_actions()) AS item(action)
    )
  ) THEN
    RAISE EXCEPTION 'document case-link audit actions are incomplete';
  END IF;
END
$catalog_contract$;

\set p113_org_a '59911300-0000-4000-8000-000000000001'
\set p113_org_b '59911300-0000-4000-8000-000000000002'
\set p113_case_a '59911300-0000-4000-8000-000000000011'
\set p113_case_a2 '59911300-0000-4000-8000-000000000012'
\set p113_case_b '59911300-0000-4000-8000-000000000013'
\set p113_org_scope_a '59911300-0000-4000-8000-000000000021'
\set p113_org_scope_b '59911300-0000-4000-8000-000000000022'
\set p113_case_scope_a '59911300-0000-4000-8000-000000000023'
\set p113_case_scope_a2 '59911300-0000-4000-8000-000000000024'
\set p113_case_scope_b '59911300-0000-4000-8000-000000000025'
\set p113_case_scope_a_v2 '59911300-0000-4000-8000-000000000026'
\set p113_case_scope_a2_v2 '59911300-0000-4000-8000-000000000027'

\set p113_admin_a_user '59911300-0000-4000-8000-000000000101'
\set p113_sales_a_user '59911300-0000-4000-8000-000000000102'
\set p113_curator_a_user '59911300-0000-4000-8000-000000000103'
\set p113_student_a_user '59911300-0000-4000-8000-000000000104'
\set p113_admin_b_user '59911300-0000-4000-8000-000000000105'
\set p113_student_b_user '59911300-0000-4000-8000-000000000106'

\set p113_admin_a_profile '59911300-0000-4000-8000-000000000201'
\set p113_sales_a_profile '59911300-0000-4000-8000-000000000202'
\set p113_curator_a_profile '59911300-0000-4000-8000-000000000203'
\set p113_student_a_profile '59911300-0000-4000-8000-000000000204'
\set p113_admin_b_profile '59911300-0000-4000-8000-000000000205'
\set p113_student_b_profile '59911300-0000-4000-8000-000000000206'

\set p113_admin_a_membership '59911300-0000-4000-8000-000000000301'
\set p113_sales_a_membership '59911300-0000-4000-8000-000000000302'
\set p113_curator_a_membership '59911300-0000-4000-8000-000000000303'
\set p113_student_a_membership '59911300-0000-4000-8000-000000000304'
\set p113_admin_b_membership '59911300-0000-4000-8000-000000000305'
\set p113_student_b_membership '59911300-0000-4000-8000-000000000306'

\set p113_requirement_a '59911300-0000-4000-8000-000000000401'
\set p113_slot_a '59911300-0000-4000-8000-000000000402'
\set p113_application_a '59911300-0000-4000-8000-000000000501'
\set p113_application_a2 '59911300-0000-4000-8000-000000000502'
\set p113_application_b '59911300-0000-4000-8000-000000000503'
\set p113_visa_a '59911300-0000-4000-8000-000000000601'
\set p113_visa_a2 '59911300-0000-4000-8000-000000000602'

SELECT bundle.id AS p113_admin_bundle, bundle.version AS p113_admin_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p113_sales_bundle, bundle.version AS p113_sales_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p113_curator_bundle, bundle.version AS p113_curator_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p113_student_bundle, bundle.version AS p113_student_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

INSERT INTO platform.organizations (id, name)
VALUES
  (:'p113_org_a', 'Migration 113 Organization A'),
  (:'p113_org_b', 'Migration 113 Organization B');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'p113_admin_a_user', 'p113-admin-a@example.invalid', '{}'),
  (:'p113_sales_a_user', 'p113-sales-a@example.invalid', '{}'),
  (:'p113_curator_a_user', 'p113-curator-a@example.invalid', '{}'),
  (:'p113_student_a_user', 'p113-student-a@example.invalid', '{}'),
  (:'p113_admin_b_user', 'p113-admin-b@example.invalid', '{}'),
  (:'p113_student_b_user', 'p113-student-b@example.invalid', '{}');

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
)
VALUES
  (:'p113_admin_a_profile', :'p113_admin_a_user', 'P113 Admin A', 'active', 1),
  (:'p113_sales_a_profile', :'p113_sales_a_user', 'P113 Sales A', 'active', 1),
  (:'p113_curator_a_profile', :'p113_curator_a_user', 'P113 Admissions A', 'active', 1),
  (:'p113_student_a_profile', :'p113_student_a_user', 'P113 Student A', 'active', 1),
  (:'p113_admin_b_profile', :'p113_admin_b_user', 'P113 Admin B', 'active', 1),
  (:'p113_student_b_profile', :'p113_student_b_user', 'P113 Student B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
VALUES
  (:'p113_admin_a_membership', :'p113_org_a', :'p113_admin_a_profile', 'active', 'admin', :'p113_admin_bundle'),
  (:'p113_sales_a_membership', :'p113_org_a', :'p113_sales_a_profile', 'active', 'sales', :'p113_sales_bundle'),
  (:'p113_curator_a_membership', :'p113_org_a', :'p113_curator_a_profile', 'active', 'curator', :'p113_curator_bundle'),
  (:'p113_student_a_membership', :'p113_org_a', :'p113_student_a_profile', 'active', 'student', :'p113_student_bundle'),
  (:'p113_admin_b_membership', :'p113_org_b', :'p113_admin_b_profile', 'active', 'admin', :'p113_admin_bundle'),
  (:'p113_student_b_membership', :'p113_org_b', :'p113_student_b_profile', 'active', 'student', :'p113_student_bundle');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
)
VALUES
  (:'p113_org_scope_a', :'p113_org_a', 'organization', :'p113_org_a', 1),
  (:'p113_org_scope_b', :'p113_org_b', 'organization', :'p113_org_b', 1),
  (:'p113_case_scope_a', :'p113_org_a', 'student_case', :'p113_case_a', 1),
  (:'p113_case_scope_a2', :'p113_org_a', 'student_case', :'p113_case_a2', 1),
  (:'p113_case_scope_b', :'p113_org_b', 'student_case', :'p113_case_b', 1);

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
VALUES
  (
    '59911300-0000-4000-8000-000000000701', :'p113_org_a',
    :'p113_admin_a_membership', :'p113_org_scope_a', 1, 1, TRUE,
    'system', NULL, 'Migration 113 org admin scope',
    '59911300-0000-4000-8000-000000000801'
  ),
  (
    '59911300-0000-4000-8000-000000000702', :'p113_org_b',
    :'p113_admin_b_membership', :'p113_org_scope_b', 1, 1, TRUE,
    'system', NULL, 'Migration 113 org admin scope',
    '59911300-0000-4000-8000-000000000802'
  ),
  (
    '59911300-0000-4000-8000-000000000703', :'p113_org_a',
    :'p113_sales_a_membership', :'p113_case_scope_a', 1, 1, TRUE,
    'system', NULL, 'Migration 113 sales case scope',
    '59911300-0000-4000-8000-000000000803'
  ),
  (
    '59911300-0000-4000-8000-000000000704', :'p113_org_a',
    :'p113_curator_a_membership', :'p113_case_scope_a', 1, 1, TRUE,
    'system', NULL, 'Migration 113 curator case scope',
    '59911300-0000-4000-8000-000000000804'
  ),
  (
    '59911300-0000-4000-8000-000000000705', :'p113_org_a',
    :'p113_curator_a_membership', :'p113_case_scope_a2', 1, 1, TRUE,
    'system', NULL, 'Migration 113 curator case scope',
    '59911300-0000-4000-8000-000000000805'
  ),
  (
    '59911300-0000-4000-8000-000000000708', :'p113_org_a',
    :'p113_curator_a_membership', :'p113_org_scope_a', 1, 1, TRUE,
    'system', NULL, 'Migration 113 Admissions runtime scope',
    '59911300-0000-4000-8000-000000000808'
  );

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
    :'p113_case_a', :'p113_org_a', :'p113_student_a_membership',
    :'p113_sales_a_membership', NULL,
    'synthetic:p113:case:a', 'synthetic:p113:contract:a', statement_timestamp(),
    'P113 Student A', 'United Kingdom', 'Bachelor', 'Business',
    '2027 Fall', 'approved', 'contract_confirmed', 'pending', NULL,
    NULL, NULL, 'Prepare handoff', :'p113_case_scope_a', 1
  ),
  (
    :'p113_case_a2', :'p113_org_a', :'p113_student_a_membership',
    :'p113_sales_a_membership', NULL,
    'synthetic:p113:case:a2', 'synthetic:p113:contract:a2', statement_timestamp(),
    'P113 Student A2', 'Canada', 'Master', 'Computing',
    '2027 Fall', 'approved', 'contract_confirmed', 'pending', NULL,
    NULL, NULL, 'Prepare handoff', :'p113_case_scope_a2', 1
  ),
  (
    :'p113_case_b', :'p113_org_b', :'p113_student_b_membership',
    :'p113_admin_b_membership', NULL,
    'synthetic:p113:case:b', 'synthetic:p113:contract:b', statement_timestamp(),
    'P113 Student B', 'United Kingdom', 'Bachelor', 'Business',
    '2027 Fall', 'approved', 'contract_confirmed', 'pending', NULL,
    NULL, NULL, 'Prepare handoff', :'p113_case_scope_b', 1
  );

UPDATE platform.record_scopes AS scope
SET is_active = FALSE
WHERE scope.id IN (:'p113_case_scope_a', :'p113_case_scope_a2');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
)
VALUES
  (:'p113_case_scope_a_v2', :'p113_org_a', 'student_case', :'p113_case_a', 2),
  (:'p113_case_scope_a2_v2', :'p113_org_a', 'student_case', :'p113_case_a2', 2);

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
VALUES
  (
    '59911300-0000-4000-8000-000000000706', :'p113_org_a',
    :'p113_curator_a_membership', :'p113_case_scope_a_v2', 2, 1, TRUE,
    'system', NULL, 'Migration 113 active curator case scope',
    '59911300-0000-4000-8000-000000000806'
  ),
  (
    '59911300-0000-4000-8000-000000000707', :'p113_org_a',
    :'p113_curator_a_membership', :'p113_case_scope_a2_v2', 2, 1, TRUE,
    'system', NULL, 'Migration 113 active curator case scope',
    '59911300-0000-4000-8000-000000000807'
  );

UPDATE platform.student_cases AS student_case
SET
  current_curator_membership_id = :'p113_curator_a_membership',
  operational_stage = 'documents',
  state = 'active',
  handoff_at = statement_timestamp(),
  portal_activated_at = statement_timestamp(),
  next_action = 'Collect documents',
  current_scope_id = CASE student_case.id
    WHEN :'p113_case_a'::UUID THEN :'p113_case_scope_a_v2'::UUID
    ELSE :'p113_case_scope_a2_v2'::UUID
  END,
  current_scope_version = 2
WHERE student_case.id IN (:'p113_case_a', :'p113_case_a2');

INSERT INTO platform.document_requirements (
  id, organization_id, target_country, target_degree, program_direction,
  checklist_version, requirement_key, label, instructions, status,
  created_by_membership_id
)
VALUES (
  :'p113_requirement_a', :'p113_org_a', 'United Kingdom', 'Bachelor',
  'Business', 1, 'passport', 'Passport', 'Upload a clear passport scan.',
  'active', :'p113_admin_a_membership'
);

INSERT INTO platform.document_slots (
  id, organization_id, student_case_id, requirement_id, status,
  created_by_membership_id
)
VALUES (
  :'p113_slot_a', :'p113_org_a', :'p113_case_a',
  :'p113_requirement_a', 'required', :'p113_curator_a_membership'
);

INSERT INTO platform.university_applications (
  id, organization_id, student_case_id, institution_name, program_name,
  created_by_membership_id
)
VALUES
  (
    :'p113_application_a', :'p113_org_a', :'p113_case_a',
    'University A', 'Business Analytics', :'p113_curator_a_membership'
  ),
  (
    :'p113_application_a2', :'p113_org_a', :'p113_case_a2',
    'University A2', 'Computer Science', :'p113_curator_a_membership'
  ),
  (
    :'p113_application_b', :'p113_org_b', :'p113_case_b',
    'University B', 'Business', :'p113_admin_b_membership'
  );

INSERT INTO platform.visa_cases (
  id, organization_id, student_case_id, created_by_membership_id
)
VALUES
  (:'p113_visa_a', :'p113_org_a', :'p113_case_a', :'p113_curator_a_membership'),
  (:'p113_visa_a2', :'p113_org_a', :'p113_case_a2', :'p113_curator_a_membership');

SELECT pg_temp.p113_assert(
  pg_temp.p113_insert_link_sqlstate(
    :'p113_org_a',
    :'p113_case_a',
    :'p113_slot_a',
    'university_application',
    :'p113_application_a2',
    NULL,
    :'p113_curator_a_membership'
  ) = '23503',
  'cross-case application link must fail inside PostgreSQL'
);

SELECT pg_temp.p113_assert(
  pg_temp.p113_insert_link_sqlstate(
    :'p113_org_a',
    :'p113_case_a',
    :'p113_slot_a',
    'university_application',
    :'p113_application_b',
    NULL,
    :'p113_curator_a_membership'
  ) = '23503',
  'cross-organization application link must fail inside PostgreSQL'
);

SELECT pg_temp.p113_assert(
  pg_temp.p113_insert_link_sqlstate(
    :'p113_org_a',
    :'p113_case_a',
    :'p113_slot_a',
    'visa_case',
    NULL,
    :'p113_visa_a2',
    :'p113_curator_a_membership'
  ) = '23503',
  'cross-case visa link must fail inside PostgreSQL'
);

SELECT pg_temp.p113_assert(
  (
    pg_temp.p113_capture_error(format(
      'UPDATE platform.document_slots SET version = version + 1, updated_at = statement_timestamp(), next_action = %L WHERE organization_id = %L::uuid AND student_case_id = %L::uuid AND id = %L::uuid',
      'Unsupported aggregate mutation',
      :'p113_org_a', :'p113_case_a', :'p113_slot_a'
    ))->>'sqlstate'
  ) = '55000'
  AND EXISTS (
    SELECT 1
    FROM platform.document_slots AS slot
    WHERE slot.organization_id = :'p113_org_a'
      AND slot.student_case_id = :'p113_case_a'
      AND slot.id = :'p113_slot_a'
      AND slot.version = 1
      AND slot.next_action IS NULL
  ),
  'aggregate version transition must reject any accompanying slot mutation'
);

SELECT
  jsonb_build_object(
    'sub', :'p113_curator_a_user',
    'role', 'authenticated',
    'platform_role', 'curator',
    'platform_access_version', 1,
    'platform_organization_id', :'p113_org_a',
    'platform_membership_id', :'p113_curator_a_membership',
    'platform_bundle_id', :'p113_curator_bundle',
    'platform_bundle_version', :'p113_curator_bundle_version'::INTEGER
  )::TEXT AS p113_curator_a_claims,
  jsonb_build_object(
    'sub', :'p113_sales_a_user',
    'role', 'authenticated',
    'platform_role', 'sales',
    'platform_access_version', 1,
    'platform_organization_id', :'p113_org_a',
    'platform_membership_id', :'p113_sales_a_membership',
    'platform_bundle_id', :'p113_sales_bundle',
    'platform_bundle_version', :'p113_sales_bundle_version'::INTEGER
  )::TEXT AS p113_sales_a_claims,
  jsonb_build_object(
    'sub', :'p113_admin_a_user',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', 1,
    'platform_organization_id', :'p113_org_a',
    'platform_membership_id', :'p113_admin_a_membership',
    'platform_bundle_id', :'p113_admin_bundle',
    'platform_bundle_version', :'p113_admin_bundle_version'::INTEGER
  )::TEXT AS p113_admin_a_claims
\gset

SET request.jwt.claims TO :'p113_curator_a_claims';
SET ROLE authenticated;

SELECT platform.set_document_slot_case_link(
  :'p113_org_a', :'p113_case_a', :'p113_slot_a',
  'university_application', :'p113_application_a', TRUE,
  1, 'Application evidence required',
  '59911300-0000-4000-8000-000000000901'
)::TEXT AS p113_application_link
\gset

SELECT platform.set_document_slot_case_link(
  :'p113_org_a', :'p113_case_a', :'p113_slot_a',
  'university_application', :'p113_application_a', TRUE,
  1, 'Application evidence required',
  '59911300-0000-4000-8000-000000000901'
)::TEXT AS p113_application_link_replay
\gset

SELECT pg_temp.p113_assert(
  :'p113_application_link'::JSONB = :'p113_application_link_replay'::JSONB
  AND :'p113_application_link'::JSONB @> jsonb_build_object(
    'organization_id', :'p113_org_a'::UUID,
    'student_case_id', :'p113_case_a'::UUID,
    'document_slot_id', :'p113_slot_a'::UUID,
    'target_kind', 'university_application',
    'target_id', :'p113_application_a'::UUID,
    'university_application_id', :'p113_application_a'::UUID,
    'visa_case_id', NULL,
    'linked', TRUE,
    'expected_version', '1',
    'version', '2',
    'reason', 'Application evidence required',
    'request_id', '59911300-0000-4000-8000-000000000901'::UUID
  )
  AND (:'p113_application_link'::JSONB->>'document_slot_case_link_id')::UUID IS NOT NULL,
  'application link must advance the slot once and replay the exact receipt'
);

SELECT pg_temp.p113_assert(
  (
    pg_temp.p113_capture_error(format(
      'SELECT platform.set_document_slot_case_link(%L::uuid,%L::uuid,%L::uuid,%L::platform.document_slot_case_link_target_kind,%L::uuid,%L::boolean,%L::bigint,%L::text,%L::uuid)',
      :'p113_org_a', :'p113_case_a', :'p113_slot_a',
      'university_application', :'p113_application_a', 'false',
      '1', 'Changed request shape',
      '59911300-0000-4000-8000-000000000901'
    ))->>'sqlstate'
  ) = '22023',
  'same request id with a changed payload must fail closed'
);

SELECT pg_temp.p113_assert(
  (
    pg_temp.p113_capture_error(format(
      'SELECT platform.set_document_slot_case_link(%L::uuid,%L::uuid,%L::uuid,%L::platform.document_slot_case_link_target_kind,%L::uuid,%L::boolean,%L::bigint,%L::text,%L::uuid)',
      :'p113_org_a', :'p113_case_a', :'p113_slot_a',
      'university_application', :'p113_application_a', 'true',
      '2', 'Duplicate link is not a change',
      '59911300-0000-4000-8000-000000000902'
    ))->>'sqlstate'
  ) = '22023',
  'a new-request link no-op must fail closed'
);

SELECT pg_temp.p113_assert(
  (
    pg_temp.p113_capture_error(format(
      'SELECT platform.set_document_slot_case_link(%L::uuid,%L::uuid,%L::uuid,%L::platform.document_slot_case_link_target_kind,%L::uuid,%L::boolean,%L::bigint,%L::text,%L::uuid)',
      :'p113_org_a', :'p113_case_a', :'p113_slot_a',
      'visa_case', :'p113_visa_a', 'true',
      '1', 'Stale visa evidence decision',
      '59911300-0000-4000-8000-000000000903'
    ))->>'sqlstate'
  ) = 'PT409',
  'a stale target mutation must fail optimistic concurrency'
);

SELECT platform.set_document_slot_case_link(
  :'p113_org_a', :'p113_case_a', :'p113_slot_a',
  'visa_case', :'p113_visa_a', TRUE,
  2, 'Visa evidence required',
  '59911300-0000-4000-8000-000000000904'
)::TEXT AS p113_visa_link
\gset

SELECT pg_temp.p113_assert(
  :'p113_visa_link'::JSONB @> jsonb_build_object(
    'target_kind', 'visa_case',
    'target_id', :'p113_visa_a'::UUID,
    'university_application_id', NULL,
    'visa_case_id', :'p113_visa_a'::UUID,
    'linked', TRUE,
    'expected_version', '2',
    'version', '3',
    'reason', 'Visa evidence required',
    'request_id', '59911300-0000-4000-8000-000000000904'::UUID
  ),
  'visa link must advance the same slot aggregate'
);

SELECT platform.staff_student_case_document_workspace(:'p113_case_a')::TEXT
  AS p113_workspace
\gset

SELECT pg_temp.p113_assert(
  (
    SELECT count(*) = 2
    FROM jsonb_array_elements((:'p113_workspace'::JSONB)->'slots') AS slot(payload)
    CROSS JOIN LATERAL jsonb_array_elements(slot.payload->'case_links') AS link(payload)
    WHERE slot.payload->>'document_slot_id' = :'p113_slot_a'
      AND (
        (
          link.payload->>'target_kind' = 'university_application'
          AND link.payload->>'university_application_id' = :'p113_application_a'
          AND link.payload->'visa_case_id' = 'null'::JSONB
        )
        OR (
          link.payload->>'target_kind' = 'visa_case'
          AND link.payload->'university_application_id' = 'null'::JSONB
          AND link.payload->>'visa_case_id' = :'p113_visa_a'
        )
      )
  ),
  'staff document workspace must project sorted typed application and visa links'
);

SELECT pg_temp.p113_assert(
  (SELECT count(*) FROM platform.document_slot_case_links) = 2,
  'assigned curator must read own document case links through RLS'
);

SELECT pg_temp.p113_assert(
  (
    pg_temp.p113_capture_error(format(
      'SELECT platform.set_document_slot_case_link(%L::uuid,%L::uuid,%L::uuid,%L::platform.document_slot_case_link_target_kind,%L::uuid,%L::boolean,%L::bigint,%L::text,%L::uuid)',
      :'p113_org_a', :'p113_case_a', :'p113_slot_a',
      'university_application', :'p113_application_a2', 'true',
      '3', 'Wrong case application',
      '59911300-0000-4000-8000-000000000905'
    ))->>'sqlstate'
  ) = '42501',
  'RPC must reject a cross-case application target'
);

SELECT platform.set_document_slot_case_link(
  :'p113_org_a', :'p113_case_a', :'p113_slot_a',
  'university_application', :'p113_application_a', FALSE,
  3, 'Application no longer needs this evidence',
  '59911300-0000-4000-8000-000000000906'
)::TEXT AS p113_application_unlink
\gset

SELECT platform.set_document_slot_case_link(
  :'p113_org_a', :'p113_case_a', :'p113_slot_a',
  'university_application', :'p113_application_a', FALSE,
  3, 'Application no longer needs this evidence',
  '59911300-0000-4000-8000-000000000906'
)::TEXT AS p113_application_unlink_replay
\gset

SELECT pg_temp.p113_assert(
  :'p113_application_unlink'::JSONB = :'p113_application_unlink_replay'::JSONB
  AND :'p113_application_unlink'::JSONB @> jsonb_build_object(
    'target_kind', 'university_application',
    'target_id', :'p113_application_a'::UUID,
    'linked', FALSE,
    'document_slot_case_link_id', NULL,
    'expected_version', '3',
    'version', '4',
    'reason', 'Application no longer needs this evidence'
  ),
  'unlink must advance once, delete only the target and replay exactly'
);

SET request.jwt.claims TO :'p113_admin_a_claims';

SELECT platform.set_document_slot_case_link(
  :'p113_org_a', :'p113_case_a', :'p113_slot_a',
  'university_application', :'p113_application_a', TRUE,
  4, 'Admin confirms shared application evidence',
  '59911300-0000-4000-8000-000000000907'
)::TEXT AS p113_admin_link
\gset

SELECT pg_temp.p113_assert(
  :'p113_admin_link'::JSONB @> jsonb_build_object(
    'linked', TRUE,
    'expected_version', '4',
    'version', '5',
    'reason', 'Admin confirms shared application evidence'
  )
  AND (SELECT count(*) FROM platform.document_slot_case_links) = 2,
  'Admin must mutate the same canonical relation as Admissions'
);

RESET ROLE;

SELECT pg_temp.p113_assert(
  (
    SELECT count(*)
    FROM platform.audit_events AS event
    WHERE event.organization_id = :'p113_org_a'
      AND event.resource_type = 'document_slot'
      AND event.resource_id = :'p113_slot_a'
      AND event.action IN (
        'document.slot.application.link',
        'document.slot.application.unlink',
        'document.slot.visa.link'
      )
  ) = 4,
  'each real link or unlink must append exactly one audit event'
);

UPDATE platform.document_slots
SET
  removed_at = statement_timestamp(),
  removed_by_membership_id = :'p113_admin_a_membership',
  removal_reason = 'Synthetic removed-slot replay proof',
  updated_at = statement_timestamp()
WHERE organization_id = :'p113_org_a'
  AND id = :'p113_slot_a';

SET request.jwt.claims TO :'p113_curator_a_claims';
SET ROLE authenticated;

SELECT platform.set_document_slot_case_link(
  :'p113_org_a', :'p113_case_a', :'p113_slot_a',
  'university_application', :'p113_application_a', TRUE,
  1, 'Application evidence required',
  '59911300-0000-4000-8000-000000000901'
)::TEXT AS p113_application_replay_after_removal
\gset

SELECT pg_temp.p113_assert(
  :'p113_application_replay_after_removal'::JSONB = :'p113_application_link'::JSONB,
  'an identical durable retry must replay after the slot is removed'
);

SELECT pg_temp.p113_assert(
  (
    pg_temp.p113_capture_error(format(
      'SELECT platform.set_document_slot_case_link(%L::uuid,%L::uuid,%L::uuid,%L::platform.document_slot_case_link_target_kind,%L::uuid,%L::boolean,%L::bigint,%L::text,%L::uuid)',
      :'p113_org_a', :'p113_case_a', :'p113_slot_a',
      'visa_case', :'p113_visa_a', 'false',
      '5', 'Removed slot must reject a new command',
      '59911300-0000-4000-8000-000000000908'
    ))->>'sqlstate'
  ) = '42501',
  'a removed slot must reject every new link mutation'
);

SET request.jwt.claims TO :'p113_sales_a_claims';

SELECT pg_temp.p113_assert(
  (SELECT count(*) FROM platform.document_slot_case_links) = 0,
  'sales role must not read historical document links through RLS'
);

SELECT pg_temp.p113_assert(
  (
    pg_temp.p113_capture_error(format(
      'SELECT platform.set_document_slot_case_link(%L::uuid,%L::uuid,%L::uuid,%L::platform.document_slot_case_link_target_kind,%L::uuid,%L::boolean,%L::bigint,%L::text,%L::uuid)',
      :'p113_org_a', :'p113_case_a', :'p113_slot_a',
      'visa_case', :'p113_visa_a', 'false',
      '5', 'Sales cannot unlink evidence',
      '59911300-0000-4000-8000-000000000909'
    ))->>'sqlstate'
  ) = '42501',
  'sales role must not mutate document case links'
);

SET ROLE anon;
SET request.jwt.claims TO '{}';

SELECT pg_temp.p113_assert(
  (
    pg_temp.p113_capture_error(format(
      'SELECT platform.set_document_slot_case_link(%L::uuid,%L::uuid,%L::uuid,%L::platform.document_slot_case_link_target_kind,%L::uuid,%L::boolean,%L::bigint,%L::text,%L::uuid)',
      :'p113_org_a', :'p113_case_a', :'p113_slot_a',
      'visa_case', :'p113_visa_a', 'false',
      '5', 'Anonymous cannot unlink evidence',
      '59911300-0000-4000-8000-000000000910'
    ))->>'sqlstate'
  ) = '42501',
  'anon must not execute document case-link RPC'
);

RESET ROLE;

ROLLBACK;
