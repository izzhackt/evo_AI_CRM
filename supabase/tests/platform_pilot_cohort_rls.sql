\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- U10 is repository/disposable-local evidence only. The public seams under
-- test are the two Admin mutations and the two bounded staff reads. Direct
-- table access, legacy writes and provider calls are deliberately outside the
-- accepted path.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.u10_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'U10 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.u10_assert(BOOLEAN, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.u10_attempt_configure(
  p_organization_id UUID,
  p_cutoff_at TIMESTAMPTZ,
  p_state TEXT,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'result', platform.configure_pilot_cohort(
      p_organization_id,
      p_cutoff_at,
      p_state,
      p_reason,
      p_request_id
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN pg_catalog.jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u10_attempt_membership(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_action TEXT,
  p_reason TEXT,
  p_provenance JSONB,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'result', platform.set_student_case_pilot_membership(
      p_organization_id,
      p_student_case_id,
      p_action,
      p_reason,
      p_provenance,
      p_request_id
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN pg_catalog.jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u10_attempt_staff_read(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_history_limit INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  row_data RECORD;
BEGIN
  SELECT *
  INTO STRICT row_data
  FROM platform.staff_student_case_pilot_cohort(
    p_organization_id,
    p_student_case_id,
    p_history_limit
  );

  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'result', pg_catalog.to_jsonb(row_data)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN pg_catalog.jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u10_attempt_boundary(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_target TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  row_data RECORD;
BEGIN
  SELECT *
  INTO STRICT row_data
  FROM platform.staff_pilot_write_boundary(
    p_organization_id,
    p_student_case_id,
    p_target
  );

  RETURN pg_catalog.jsonb_build_object(
    'ok', TRUE,
    'result', pg_catalog.to_jsonb(row_data)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN pg_catalog.jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u10_attempt_event_mutation(
  p_event_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE platform.pilot_cohort_membership_events AS event
  SET reason = reason
  WHERE event.id = p_event_id;
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u10_attempt_config_mutation(
  p_configuration_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE platform.pilot_cohort_configurations AS config
  SET configuration_state = configuration_state
  WHERE config.id = p_configuration_id;
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.u10_attempt_configure(
  UUID, TIMESTAMPTZ, TEXT, TEXT, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u10_attempt_membership(
  UUID, UUID, TEXT, TEXT, JSONB, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u10_attempt_staff_read(UUID, UUID, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u10_attempt_boundary(UUID, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u10_attempt_event_mutation(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u10_attempt_config_mutation(UUID)
  TO authenticated;

-- The first tracer bullet is intentionally structural: all later behavioral
-- assertions depend on these exact PostgREST seams and default-deny tables.
SELECT pg_temp.u10_assert(
  to_regclass('platform.pilot_cohort_configurations') IS NOT NULL
  AND to_regclass('platform.pilot_cohort_membership_events') IS NOT NULL
  AND to_regprocedure(
    'platform.configure_pilot_cohort(uuid,timestamp with time zone,text,text,uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform.set_student_case_pilot_membership(uuid,uuid,text,text,jsonb,uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform.staff_student_case_pilot_cohort(uuid,uuid,integer)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform.staff_pilot_write_boundary(uuid,uuid,text)'
  ) IS NOT NULL,
  'U10 public relation or RPC inventory is incomplete'
);

SELECT pg_temp.u10_assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'platform'
      AND procedure.proname IN (
        'configure_pilot_cohort',
        'set_student_case_pilot_membership',
        'staff_student_case_pilot_cohort',
        'staff_pilot_write_boundary'
      )
      AND (
        NOT procedure.prosecdef
        OR procedure.proconfig IS DISTINCT FROM
          ARRAY['search_path=""']::TEXT[]
      )
  )
  AND (
    SELECT procedure.provolatile = 's'
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'platform.staff_student_case_pilot_cohort(uuid,uuid,integer)'::REGPROCEDURE
  )
  AND (
    SELECT procedure.provolatile = 's'
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'platform.staff_pilot_write_boundary(uuid,uuid,text)'::REGPROCEDURE
  ),
  'U10 RPC SECURITY DEFINER/search_path/volatility posture drifted'
);

SELECT pg_temp.u10_assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid IN (
      'platform.pilot_cohort_configurations'::REGCLASS,
      'platform.pilot_cohort_membership_events'::REGCLASS,
      'platform_private.pilot_cohort_configuration_receipts'::REGCLASS,
      'platform_private.pilot_cohort_membership_receipts'::REGCLASS
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid IN (
      'platform.pilot_cohort_configurations'::REGCLASS,
      'platform.pilot_cohort_membership_events'::REGCLASS,
      'platform_private.pilot_cohort_configuration_receipts'::REGCLASS,
      'platform_private.pilot_cohort_membership_receipts'::REGCLASS
    )
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ),
  'U10 direct tables must keep forced default-deny RLS'
);

SELECT pg_temp.u10_assert(
  NOT pg_catalog.has_table_privilege(
    'authenticated',
    'platform.pilot_cohort_configurations',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT pg_catalog.has_table_privilege(
    'authenticated',
    'platform.pilot_cohort_membership_events',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT pg_catalog.has_table_privilege(
    'service_role',
    'platform.pilot_cohort_configurations',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT pg_catalog.has_table_privilege(
    'service_role',
    'platform.pilot_cohort_membership_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'browser/service roles retained a direct U10 table grant'
);

SELECT pg_temp.u10_assert(
  pg_catalog.has_function_privilege(
    'authenticated',
    'platform.configure_pilot_cohort(uuid,timestamp with time zone,text,text,uuid)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated',
    'platform.set_student_case_pilot_membership(uuid,uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated',
    'platform.staff_student_case_pilot_cohort(uuid,uuid,integer)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated',
    'platform.staff_pilot_write_boundary(uuid,uuid,text)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'platform.configure_pilot_cohort(uuid,timestamp with time zone,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'service_role',
    'platform.set_student_case_pilot_membership(uuid,uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'U10 RPC least-privilege ACL drifted'
);

SELECT pg_temp.u10_assert(
  'pilot.cohort.configured' = ANY(
    platform_private.p7a_safe_audit_actions()
  )
  AND 'pilot.cohort.member.automatic' = ANY(
    platform_private.p7a_safe_audit_actions()
  )
  AND 'pilot.cohort.member.included' = ANY(
    platform_private.p7a_safe_audit_actions()
  )
  AND 'pilot.cohort.member.excluded' = ANY(
    platform_private.p7a_safe_audit_actions()
  )
  AND 'pilot_cohort_configuration' = ANY(
    platform_private.p7a_safe_audit_resource_types()
  )
  AND 'pilot_cohort_membership' = ANY(
    platform_private.p7a_safe_audit_resource_types()
  ),
  'U10 audit actions/resources are absent from the P7A safe projection'
);

-- Reuse the durable authorization fixtures established by the earlier suites.
SELECT
  membership.organization_id AS u10_org_b,
  membership.id AS u10_admin_b_membership,
  profile.id AS u10_admin_b_profile,
  profile.auth_user_id AS u10_admin_b_user,
  profile.access_version AS u10_admin_b_access_version,
  membership.current_bundle_id AS u10_admin_b_bundle,
  bundle.version AS u10_admin_b_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
\gset

SELECT
  membership.organization_id AS u10_org_a,
  membership.id AS u10_admin_a_membership,
  profile.auth_user_id AS u10_admin_a_user,
  profile.access_version AS u10_admin_a_access_version,
  membership.current_bundle_id AS u10_admin_a_bundle,
  bundle.version AS u10_admin_a_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
\gset

SELECT membership.id AS u10_sales_b_membership
FROM platform.organization_memberships AS membership
WHERE membership.organization_id = :'u10_org_b'
  AND membership.status = 'active'
  AND membership."current_role" = 'sales'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  membership.id AS u10_unauthorized_membership,
  profile.auth_user_id AS u10_unauthorized_user,
  profile.access_version AS u10_unauthorized_access_version,
  membership.current_bundle_id AS u10_unauthorized_bundle,
  bundle.version AS u10_unauthorized_bundle_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'u10_org_b'
  AND membership.status = 'active'
  AND membership."current_role" = 'student'
ORDER BY membership.id
LIMIT 1
\gset

SELECT pg_temp.u10_assert(
  :'u10_org_a' <> :'u10_org_b'
  AND :'u10_sales_b_membership' <> ''
  AND :'u10_unauthorized_user' <> '',
  'persistent U10 actor fixture resolution drifted'
);

SELECT pg_catalog.jsonb_build_object(
  'sub', :'u10_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'u10_admin_b_access_version'::BIGINT,
  'platform_organization_id', :'u10_org_b',
  'platform_membership_id', :'u10_admin_b_membership',
  'platform_bundle_id', :'u10_admin_b_bundle',
  'platform_bundle_version', :'u10_admin_b_bundle_version'::BIGINT
)::TEXT AS u10_admin_b_claims
\gset

SELECT pg_catalog.jsonb_build_object(
  'sub', :'u10_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'u10_admin_a_access_version'::BIGINT,
  'platform_organization_id', :'u10_org_a',
  'platform_membership_id', :'u10_admin_a_membership',
  'platform_bundle_id', :'u10_admin_a_bundle',
  'platform_bundle_version', :'u10_admin_a_bundle_version'::BIGINT
)::TEXT AS u10_admin_a_claims
\gset

SELECT pg_catalog.jsonb_build_object(
  'sub', :'u10_unauthorized_user',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'u10_unauthorized_access_version'::BIGINT,
  'platform_organization_id', :'u10_org_b',
  'platform_membership_id', :'u10_unauthorized_membership',
  'platform_bundle_id', :'u10_unauthorized_bundle',
  'platform_bundle_version', :'u10_unauthorized_bundle_version'::BIGINT
)::TEXT AS u10_unauthorized_claims
\gset

\set u10_preconfig_client '92000000-0000-4000-8000-000000000101'
\set u10_preconfig_lead '92000000-0000-4000-8000-000000000201'
\set u10_preconfig_case '92000000-0000-4000-8000-000000000301'
\set u10_preconfig_scope '92000000-0000-4000-8000-000000000401'
\set u10_legacy_client '92000000-0000-4000-8000-000000000102'
\set u10_legacy_lead '92000000-0000-4000-8000-000000000202'
\set u10_legacy_case '92000000-0000-4000-8000-000000000302'
\set u10_legacy_scope '92000000-0000-4000-8000-000000000402'
\set u10_eligible_client '92000000-0000-4000-8000-000000000103'
\set u10_eligible_lead '92000000-0000-4000-8000-000000000203'
\set u10_eligible_case '92000000-0000-4000-8000-000000000303'
\set u10_eligible_scope '92000000-0000-4000-8000-000000000403'
\set u10_mismatch_client '92000000-0000-4000-8000-000000000104'
\set u10_mismatch_lead '92000000-0000-4000-8000-000000000204'
\set u10_mismatch_case '92000000-0000-4000-8000-000000000304'
\set u10_mismatch_scope '92000000-0000-4000-8000-000000000404'
\set u10_paused_client '92000000-0000-4000-8000-000000000105'
\set u10_paused_lead '92000000-0000-4000-8000-000000000205'
\set u10_paused_case '92000000-0000-4000-8000-000000000305'
\set u10_paused_scope '92000000-0000-4000-8000-000000000405'

-- A canonical case created before any pilot configuration must remain outside
-- even when its timestamps would satisfy a later cutoff. This is the direct
-- no-backfill proof.
INSERT INTO platform.clients (
  id,
  organization_id,
  display_name,
  normalized_name
) VALUES (
  :'u10_preconfig_client',
  :'u10_org_b',
  'U10 Preconfiguration Client',
  platform_private.normalize_person_name('U10 Preconfiguration Client')
);

INSERT INTO platform.leads (
  id,
  organization_id,
  client_id,
  current_owner_membership_id,
  stage_key,
  source_key
) VALUES (
  :'u10_preconfig_lead',
  :'u10_org_b',
  :'u10_preconfig_client',
  :'u10_sales_b_membership',
  'new',
  'u10_preconfig'
);

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version,
  is_active
) VALUES (
  :'u10_preconfig_scope',
  :'u10_org_b',
  'student_case',
  :'u10_preconfig_case',
  1,
  TRUE
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
  current_scope_id,
  current_scope_version,
  canonical_client_id,
  canonical_lead_id
) VALUES (
  :'u10_preconfig_case',
  :'u10_org_b',
  NULL,
  :'u10_sales_b_membership',
  'canonical-lead:' || :'u10_preconfig_lead',
  NULL,
  NULL,
  'U10 Preconfiguration Case',
  NULL,
  NULL,
  :'u10_preconfig_scope',
  1,
  :'u10_preconfig_client',
  :'u10_preconfig_lead'
);

SELECT pg_temp.u10_assert(
  (
    SELECT student_case.pilot_membership_status = 'outside'
      AND student_case.pilot_membership_version = 0
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'u10_preconfig_case'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.pilot_cohort_membership_events AS event
    WHERE event.student_case_id = :'u10_preconfig_case'
  ),
  'case inserted before explicit configuration entered the pilot'
);

SELECT transaction_timestamp() - INTERVAL '1 hour' AS u10_cutoff_at
\gset

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u10_admin_b_claims', true);

SELECT pg_temp.u10_attempt_configure(
  :'u10_org_b',
  :'u10_cutoff_at',
  'active',
  'Enable the bounded U10 net-new cohort',
  '92000000-0000-4000-8000-000000000501'
) AS u10_config_first
\gset

SELECT pg_temp.u10_attempt_configure(
  :'u10_org_b',
  :'u10_cutoff_at',
  'active',
  'Enable the bounded U10 net-new cohort',
  '92000000-0000-4000-8000-000000000501'
) AS u10_config_replay
\gset

SELECT pg_temp.u10_attempt_configure(
  :'u10_org_b',
  :'u10_cutoff_at',
  'active',
  'Conflicting reuse must fail',
  '92000000-0000-4000-8000-000000000501'
) AS u10_config_conflict
\gset

SELECT pg_temp.u10_assert(
  (:'u10_config_first'::JSONB ->> 'ok')::BOOLEAN
  AND NOT (:'u10_config_first'::JSONB #>> '{result,replayed}')::BOOLEAN
  AND (:'u10_config_replay'::JSONB #>> '{result,replayed}')::BOOLEAN
  AND (:'u10_config_first'::JSONB #>> '{result,request_id}') =
    '92000000-0000-4000-8000-000000000501'
  AND (:'u10_config_replay'::JSONB #>> '{result,request_id}') =
    '92000000-0000-4000-8000-000000000501'
  AND (:'u10_config_first'::JSONB #>> '{result,configuration_id}') =
    (:'u10_config_replay'::JSONB #>> '{result,configuration_id}')
  AND NOT (:'u10_config_conflict'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_config_conflict'::JSONB ->> 'sqlstate' = '23505',
  'configuration exact replay or request conflict drifted'
);

RESET ROLE;

SELECT pg_temp.u10_assert(
  (
    SELECT student_case.pilot_membership_status = 'outside'
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'u10_preconfig_case'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.pilot_cohort_membership_events AS event
    WHERE event.student_case_id = :'u10_preconfig_case'
  ),
  'enabling the cohort backfilled an existing canonical case'
);

INSERT INTO platform.clients (
  id,
  organization_id,
  display_name,
  normalized_name,
  created_at
) VALUES
  (
    :'u10_legacy_client',
    :'u10_org_b',
    'U10 Legacy Client',
    platform_private.normalize_person_name('U10 Legacy Client'),
    :'u10_cutoff_at'::TIMESTAMPTZ - INTERVAL '1 day'
  ),
  (
    :'u10_eligible_client',
    :'u10_org_b',
    'U10 Eligible Client',
    platform_private.normalize_person_name('U10 Eligible Client'),
    :'u10_cutoff_at'::TIMESTAMPTZ + INTERVAL '1 minute'
  ),
  (
    :'u10_mismatch_client',
    :'u10_org_b',
    'U10 Mismatch Client',
    platform_private.normalize_person_name('U10 Mismatch Client'),
    :'u10_cutoff_at'::TIMESTAMPTZ + INTERVAL '2 minutes'
  );

INSERT INTO platform.leads (
  id,
  organization_id,
  client_id,
  current_owner_membership_id,
  stage_key,
  source_key,
  created_at
) VALUES
  (
    :'u10_legacy_lead',
    :'u10_org_b',
    :'u10_legacy_client',
    :'u10_sales_b_membership',
    'new',
    'u10_legacy',
    :'u10_cutoff_at'::TIMESTAMPTZ - INTERVAL '1 day'
  ),
  (
    :'u10_eligible_lead',
    :'u10_org_b',
    :'u10_eligible_client',
    :'u10_sales_b_membership',
    'new',
    'u10_eligible',
    :'u10_cutoff_at'::TIMESTAMPTZ + INTERVAL '1 minute'
  ),
  (
    :'u10_mismatch_lead',
    :'u10_org_b',
    :'u10_mismatch_client',
    :'u10_sales_b_membership',
    'new',
    'u10_mismatch',
    :'u10_cutoff_at'::TIMESTAMPTZ + INTERVAL '2 minutes'
  );

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version,
  is_active
) VALUES
  (
    :'u10_legacy_scope', :'u10_org_b', 'student_case',
    :'u10_legacy_case', 1, TRUE
  ),
  (
    :'u10_eligible_scope', :'u10_org_b', 'student_case',
    :'u10_eligible_case', 1, TRUE
  ),
  (
    :'u10_mismatch_scope', :'u10_org_b', 'student_case',
    :'u10_mismatch_case', 1, TRUE
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
  current_scope_id,
  current_scope_version,
  canonical_client_id,
  canonical_lead_id,
  created_at
) VALUES
  (
    :'u10_legacy_case',
    :'u10_org_b',
    NULL,
    :'u10_sales_b_membership',
    'canonical-lead:' || :'u10_legacy_lead',
    NULL,
    NULL,
    'U10 Legacy Case',
    NULL,
    NULL,
    :'u10_legacy_scope',
    1,
    :'u10_legacy_client',
    :'u10_legacy_lead',
    :'u10_cutoff_at'::TIMESTAMPTZ - INTERVAL '1 day'
  ),
  (
    :'u10_eligible_case',
    :'u10_org_b',
    NULL,
    :'u10_sales_b_membership',
    'canonical-lead:' || :'u10_eligible_lead',
    NULL,
    NULL,
    'U10 Eligible Case',
    NULL,
    NULL,
    :'u10_eligible_scope',
    1,
    :'u10_eligible_client',
    :'u10_eligible_lead',
    :'u10_cutoff_at'::TIMESTAMPTZ + INTERVAL '1 minute'
  ),
  (
    :'u10_mismatch_case',
    :'u10_org_b',
    NULL,
    :'u10_sales_b_membership',
    'u10-direct-case',
    NULL,
    NULL,
    'U10 Source Mismatch Case',
    NULL,
    NULL,
    :'u10_mismatch_scope',
    1,
    :'u10_mismatch_client',
    :'u10_mismatch_lead',
    :'u10_cutoff_at'::TIMESTAMPTZ + INTERVAL '2 minutes'
  );

SELECT pg_temp.u10_assert(
  (
    SELECT student_case.pilot_membership_status = 'included'
      AND student_case.pilot_membership_basis = 'cutoff_rule'
      AND student_case.pilot_membership_version = 1
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'u10_eligible_case'
  )
  AND (
    SELECT student_case.pilot_membership_status = 'outside'
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'u10_legacy_case'
  )
  AND (
    SELECT student_case.pilot_membership_status = 'outside'
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'u10_mismatch_case'
  )
  AND (
    SELECT COUNT(*) = 1
    FROM platform.pilot_cohort_membership_events AS event
    WHERE event.student_case_id = :'u10_eligible_case'
      AND event.event_action = 'automatic_include'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.pilot_cohort_membership_events AS event
    WHERE event.student_case_id IN (
      :'u10_legacy_case',
      :'u10_mismatch_case'
    )
  ),
  'exact automatic cutoff/source rule admitted or excluded the wrong case'
);

SELECT pg_temp.u10_assert(
  (
    SELECT COUNT(*) = 1
    FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = :'u10_org_b'
      AND student_case.id = :'u10_eligible_case'
  )
  AND (
    SELECT COUNT(*) = 1
    FROM platform.audit_events AS event
    WHERE event.organization_id = :'u10_org_b'
      AND event.resource_id = :'u10_eligible_case'
      AND event.action = 'pilot.cohort.member.automatic'
  ),
  'automatic membership duplicated canonical state or missed its audit'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u10_admin_b_claims', true);

SELECT pg_temp.u10_attempt_membership(
  :'u10_org_b',
  :'u10_preconfig_case',
  'include',
  'Authorized bounded legacy exception for the pilot',
  '{"source":"approved_allowlist","reference":"u10-local-proof"}'::JSONB,
  '92000000-0000-4000-8000-000000000502'
) AS u10_include_first
\gset

SELECT pg_temp.u10_attempt_membership(
  :'u10_org_b',
  :'u10_preconfig_case',
  'include',
  'Authorized bounded legacy exception for the pilot',
  '{"source":"approved_allowlist","reference":"u10-local-proof"}'::JSONB,
  '92000000-0000-4000-8000-000000000502'
) AS u10_include_replay
\gset

SELECT pg_temp.u10_attempt_membership(
  :'u10_org_b',
  :'u10_preconfig_case',
  'include',
  'Conflicting membership reuse',
  '{"source":"approved_allowlist","reference":"u10-local-proof"}'::JSONB,
  '92000000-0000-4000-8000-000000000502'
) AS u10_include_conflict
\gset

SELECT pg_temp.u10_assert(
  (:'u10_include_first'::JSONB ->> 'ok')::BOOLEAN
  AND NOT (:'u10_include_first'::JSONB #>> '{result,replayed}')::BOOLEAN
  AND (:'u10_include_replay'::JSONB #>> '{result,replayed}')::BOOLEAN
  AND (:'u10_include_first'::JSONB #>> '{result,request_id}') =
    '92000000-0000-4000-8000-000000000502'
  AND (:'u10_include_replay'::JSONB #>> '{result,request_id}') =
    '92000000-0000-4000-8000-000000000502'
  AND (:'u10_include_first'::JSONB #>> '{result,event_id}') =
    (:'u10_include_replay'::JSONB #>> '{result,event_id}')
  AND NOT (:'u10_include_conflict'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_include_conflict'::JSONB ->> 'sqlstate' = '23505',
  'manual include exact replay or conflict behavior drifted'
);

SELECT pg_temp.u10_attempt_membership(
  :'u10_org_b',
  :'u10_legacy_case',
  'include',
  'Unsafe provenance must fail closed',
  '{"source":"unsafe_probe","api_key":"must-not-be-stored"}'::JSONB,
  '92000000-0000-4000-8000-000000000508'
) AS u10_unsafe_provenance
\gset

RESET ROLE;

SELECT pg_temp.u10_assert(
  NOT (:'u10_unsafe_provenance'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_unsafe_provenance'::JSONB ->> 'sqlstate' = '22023'
  AND NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id = '92000000-0000-4000-8000-000000000508'
  ),
  'unsafe/sensitive provenance reached canonical or audit state'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u10_admin_b_claims', true);

SELECT pg_temp.u10_attempt_membership(
  :'u10_org_b',
  :'u10_preconfig_case',
  'exclude',
  'Remove the exception while preserving history',
  '{"source":"pilot_review","reference":"u10-local-proof"}'::JSONB,
  '92000000-0000-4000-8000-000000000503'
) AS u10_exclude_first
\gset

RESET ROLE;

SELECT pg_temp.u10_assert(
  (:'u10_exclude_first'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_exclude_first'::JSONB #>> '{result,membership_status}' = 'excluded'
  AND (
    SELECT student_case.pilot_membership_status = 'excluded'
      AND student_case.pilot_membership_version = 2
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'u10_preconfig_case'
  )
  AND (
    SELECT pg_catalog.array_agg(
      event.event_action ORDER BY event.membership_version
    ) = ARRAY['manual_include', 'manual_exclude']::TEXT[]
    FROM platform.pilot_cohort_membership_events AS event
    WHERE event.student_case_id = :'u10_preconfig_case'
  ),
  'manual exclusion removed history or left the wrong current state'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u10_admin_b_claims', true);

SELECT pg_temp.u10_attempt_boundary(
  :'u10_org_b', :'u10_eligible_case', 'evo_supabase'
) AS u10_canonical_boundary
\gset
SELECT pg_temp.u10_attempt_boundary(
  :'u10_org_b', :'u10_eligible_case', 'legacy_crm'
) AS u10_legacy_boundary
\gset
SELECT pg_temp.u10_attempt_boundary(
  :'u10_org_b', :'u10_preconfig_case', 'evo_supabase'
) AS u10_excluded_boundary
\gset

SELECT pg_temp.u10_assert(
  (:'u10_canonical_boundary'::JSONB #>> '{result,allowed}')::BOOLEAN
  AND :'u10_canonical_boundary'::JSONB #>> '{result,reason_code}' =
    'canonical_write_allowed'
  AND NOT (:'u10_legacy_boundary'::JSONB #>> '{result,allowed}')::BOOLEAN
  AND :'u10_legacy_boundary'::JSONB #>> '{result,reason_code}' =
    'legacy_write_forbidden'
  AND NOT (:'u10_legacy_boundary'::JSONB #>>
    '{result,fallback_allowed}')::BOOLEAN
  AND :'u10_legacy_boundary'::JSONB #>> '{result,authority}' =
    'evo_supabase_only'
  AND NOT (:'u10_excluded_boundary'::JSONB #>> '{result,allowed}')::BOOLEAN
  AND :'u10_excluded_boundary'::JSONB #>> '{result,reason_code}' =
    'pilot_membership_excluded',
  'canonical/legacy write-boundary evaluator is not truthful'
);

SELECT pg_temp.u10_attempt_staff_read(
  :'u10_org_b', :'u10_preconfig_case', 1
) AS u10_bounded_read
\gset

SELECT pg_temp.u10_assert(
  (:'u10_bounded_read'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_bounded_read'::JSONB #>> '{result,membership_status}' = 'excluded'
  AND :'u10_bounded_read'::JSONB #>> '{result,membership_basis}' =
    'manual_exclude'
  AND :'u10_bounded_read'::JSONB #>> '{result,configuration,state}' = 'active'
  AND pg_catalog.jsonb_array_length(
    :'u10_bounded_read'::JSONB #> '{result,history}'
  ) = 1
  AND (:'u10_bounded_read'::JSONB #>> '{result,counts,total}')::BIGINT >= 4
  AND (:'u10_bounded_read'::JSONB #>>
    '{result,write_boundary,fallback_allowed}')::BOOLEAN IS FALSE,
  'bounded staff case/config/count/history projection drifted'
);

SELECT pg_temp.u10_assert(
  pg_temp.u10_attempt_event_mutation(
    (:'u10_include_first'::JSONB #>> '{result,event_id}')::UUID
  ) = '55000',
  'append-only membership history accepted mutation'
);

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u10_admin_b_claims', true);

SELECT pg_temp.u10_attempt_configure(
  :'u10_org_b',
  :'u10_cutoff_at',
  'paused',
  'Pause automatic entry without rewriting prior cases',
  '92000000-0000-4000-8000-000000000504'
) AS u10_pause_config
\gset

SELECT pg_temp.u10_assert(
  (:'u10_pause_config'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_pause_config'::JSONB #>> '{result,state}' = 'paused'
  AND (:'u10_pause_config'::JSONB #>> '{result,version}')::BIGINT = 2
  AND pg_temp.u10_attempt_config_mutation(
    (:'u10_pause_config'::JSONB #>> '{result,configuration_id}')::UUID
  ) = '55000',
  'append-only paused configuration version was not created'
);

RESET ROLE;

INSERT INTO platform.clients (
  id,
  organization_id,
  display_name,
  normalized_name,
  created_at
) VALUES (
  :'u10_paused_client',
  :'u10_org_b',
  'U10 Paused Client',
  platform_private.normalize_person_name('U10 Paused Client'),
  :'u10_cutoff_at'::TIMESTAMPTZ + INTERVAL '3 minutes'
);

INSERT INTO platform.leads (
  id,
  organization_id,
  client_id,
  current_owner_membership_id,
  stage_key,
  source_key,
  created_at
) VALUES (
  :'u10_paused_lead',
  :'u10_org_b',
  :'u10_paused_client',
  :'u10_sales_b_membership',
  'new',
  'u10_paused',
  :'u10_cutoff_at'::TIMESTAMPTZ + INTERVAL '3 minutes'
);

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version,
  is_active
) VALUES (
  :'u10_paused_scope',
  :'u10_org_b',
  'student_case',
  :'u10_paused_case',
  1,
  TRUE
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
  current_scope_id,
  current_scope_version,
  canonical_client_id,
  canonical_lead_id,
  created_at
) VALUES (
  :'u10_paused_case',
  :'u10_org_b',
  NULL,
  :'u10_sales_b_membership',
  'canonical-lead:' || :'u10_paused_lead',
  NULL,
  NULL,
  'U10 Paused Case',
  NULL,
  NULL,
  :'u10_paused_scope',
  1,
  :'u10_paused_client',
  :'u10_paused_lead',
  :'u10_cutoff_at'::TIMESTAMPTZ + INTERVAL '3 minutes'
);

SELECT pg_temp.u10_assert(
  (
    SELECT student_case.pilot_membership_status = 'outside'
      AND student_case.pilot_membership_basis IS NULL
      AND student_case.pilot_membership_reason IS NULL
      AND student_case.pilot_membership_provenance IS NULL
      AND student_case.pilot_changed_by_membership_id IS NULL
      AND student_case.pilot_changed_at IS NULL
    FROM platform.student_cases AS student_case
    WHERE student_case.id = :'u10_paused_case'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.pilot_cohort_membership_events AS event
    WHERE event.student_case_id = :'u10_paused_case'
  ),
  'paused configuration admitted a new case or fabricated outside provenance'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u10_admin_b_claims', true);
SELECT pg_temp.u10_attempt_staff_read(
  :'u10_org_b', :'u10_paused_case', 20
) AS u10_outside_read
\gset

SELECT pg_temp.u10_assert(
  (:'u10_outside_read'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_outside_read'::JSONB #>> '{result,membership_status}' = 'outside'
  AND :'u10_outside_read'::JSONB #> '{result,membership_basis}' = 'null'::JSONB
  AND :'u10_outside_read'::JSONB #>> '{result,configuration,state}' = 'paused'
  AND pg_catalog.jsonb_array_length(
    :'u10_outside_read'::JSONB #> '{result,history}'
  ) = 0
  AND (
    (:'u10_outside_read'::JSONB #>> '{result,counts,outside}')::BIGINT
    + (:'u10_outside_read'::JSONB #>> '{result,counts,included}')::BIGINT
    + (:'u10_outside_read'::JSONB #>> '{result,counts,excluded}')::BIGINT
  ) = (:'u10_outside_read'::JSONB #>> '{result,counts,total}')::BIGINT,
  'outside state, current paused config or bounded counts drifted'
);

RESET ROLE;

-- Non-Admin and foreign-tenant identities fail through the same bounded RPC
-- seams and cannot use direct tables as a fallback.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u10_unauthorized_claims', true);
SELECT pg_temp.u10_attempt_configure(
  :'u10_org_b',
  :'u10_cutoff_at',
  'active',
  'Unauthorized config attempt',
  '92000000-0000-4000-8000-000000000505'
) AS u10_unauthorized_config
\gset
SELECT pg_temp.u10_attempt_membership(
  :'u10_org_b',
  :'u10_eligible_case',
  'exclude',
  'Unauthorized membership attempt',
  '{"source":"unauthorized_probe"}'::JSONB,
  '92000000-0000-4000-8000-000000000506'
) AS u10_unauthorized_membership
\gset

SELECT pg_temp.u10_assert(
  NOT (:'u10_unauthorized_config'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_unauthorized_config'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u10_unauthorized_membership'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_unauthorized_membership'::JSONB ->> 'sqlstate' = '42501',
  'non-Admin identity retained pilot mutation authority'
);

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'u10_admin_a_claims', true);
SELECT pg_temp.u10_attempt_staff_read(
  :'u10_org_b', :'u10_eligible_case', 20
) AS u10_cross_org_read
\gset
SELECT pg_temp.u10_attempt_boundary(
  :'u10_org_b', :'u10_eligible_case', 'evo_supabase'
) AS u10_cross_org_boundary
\gset
SELECT pg_temp.u10_attempt_membership(
  :'u10_org_b',
  :'u10_eligible_case',
  'exclude',
  'Cross-organization mutation attempt',
  '{"source":"cross_org_probe"}'::JSONB,
  '92000000-0000-4000-8000-000000000507'
) AS u10_cross_org_membership
\gset

SELECT pg_temp.u10_assert(
  NOT (:'u10_cross_org_read'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_cross_org_read'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u10_cross_org_boundary'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_cross_org_boundary'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u10_cross_org_membership'::JSONB ->> 'ok')::BOOLEAN
  AND :'u10_cross_org_membership'::JSONB ->> 'sqlstate' = '42501',
  'cross-organization pilot read or mutation did not fail closed'
);

RESET ROLE;

SELECT pg_temp.u10_assert(
  (
    SELECT COUNT(*) = 2
    FROM platform.pilot_cohort_configurations AS config
    WHERE config.organization_id = :'u10_org_b'
  )
  AND (
    SELECT COUNT(*) = 3
    FROM platform.pilot_cohort_membership_events AS event
    WHERE event.organization_id = :'u10_org_b'
      AND event.student_case_id IN (
        :'u10_eligible_case',
        :'u10_preconfig_case'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id IN (
      '92000000-0000-4000-8000-000000000505',
      '92000000-0000-4000-8000-000000000506',
      '92000000-0000-4000-8000-000000000507'
    )
  ),
  'denied/replayed operations wrote duplicate or unauthorized evidence'
);

SELECT pg_temp.u10_assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid IN (
      'platform.configure_pilot_cohort(uuid,timestamp with time zone,text,text,uuid)'::REGPROCEDURE,
      'platform.set_student_case_pilot_membership(uuid,uuid,text,text,jsonb,uuid)'::REGPROCEDURE,
      'platform.staff_pilot_write_boundary(uuid,uuid,text)'::REGPROCEDURE
    )
      AND (
        pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
          LIKE '%amocrm%'
        OR pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
          LIKE '%legacy.crm%'
        OR pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
          LIKE '%communication_messages%'
        OR pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid))
          LIKE '%manual_send%'
      )
  ),
  'U10 mutation/evaluator definition contains a legacy/provider write seam'
);

ROLLBACK;
