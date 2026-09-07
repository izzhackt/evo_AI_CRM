\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 123. All rows are synthetic and
-- rolled back; this suite never touches a managed Supabase project.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE OR REPLACE FUNCTION pg_temp.p123_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 123 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p123_assert(BOOLEAN, TEXT)
  TO authenticated, service_role;

DO $catalog_contract$
DECLARE
  public_oid OID := pg_catalog.to_regprocedure(
    'platform.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)'
  )::OID;
  helper_oid OID := pg_catalog.to_regprocedure(
    'private.staff_sales_lead_page_with_latest_note(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)'
  )::OID;
  expected_result TEXT :=
    'TABLE(sort_at timestamp with time zone, organization_id uuid, lead_id uuid, client_id uuid, client_display_name text, client_email text, client_phone text, current_owner_membership_id uuid, current_owner_display_name text, stage_key text, source_key text, lifecycle_state platform.lead_lifecycle_state, next_action_text text, next_action_due_date date, workflow_version bigint, is_connected boolean, open_duplicate_candidate_count bigint, linked_student_case_count bigint, linked_conversation_count bigint, created_at timestamp with time zone, updated_at timestamp with time zone, stage_entered_at timestamp with time zone, latest_note_id uuid, latest_note_body text, latest_note_author_display_name text, latest_note_created_at timestamp with time zone)';
BEGIN
  IF public_oid IS NULL OR helper_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 123 Sales note projection function is missing';
  END IF;

  IF pg_catalog.pg_get_function_result(public_oid) <> expected_result
    OR pg_catalog.pg_get_function_result(helper_oid) <> expected_result
  THEN
    RAISE EXCEPTION 'Migration 123 return shape drifted';
  END IF;

  IF (
      SELECT routine.prosecdef IS FALSE
        AND routine.provolatile = 's'
        AND routine.proconfig = ARRAY['search_path=""']::TEXT[]
        AND routine.pronargdefaults = 8
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = public_oid
    ) IS DISTINCT FROM TRUE
    OR (
      SELECT routine.prosecdef IS TRUE
        AND routine.provolatile = 's'
        AND routine.proconfig = ARRAY['search_path=""']::TEXT[]
        AND routine.pronargdefaults = 8
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = helper_oid
    ) IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION 'Migration 123 function hardening drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege('authenticated', public_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', helper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', public_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', public_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('supabase_auth_admin', public_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', helper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', helper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('supabase_auth_admin', helper_oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Migration 123 function grants drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = 'staff_sales_lead_page'
  ) <> 1 THEN
    RAISE EXCEPTION 'Migration 123 exposed an ambiguous Sales page overload';
  END IF;
END
$catalog_contract$;

SELECT bundle.id AS p123_admin_bundle, bundle.version AS p123_admin_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

\set p123_org 59912300-0000-4000-8000-000000000001
\set p123_scope 59912300-0000-4000-8000-000000000002
\set p123_user 59912300-0000-4000-8000-000000000011
\set p123_profile 59912300-0000-4000-8000-000000000021
\set p123_membership 59912300-0000-4000-8000-000000000031
\set p123_lead_with_notes 59912300-0000-4000-8000-000000000061
\set p123_lead_without_notes 59912300-0000-4000-8000-000000000062
\set p123_older_note 59912300-0000-4000-8000-000000000071
\set p123_latest_note 59912300-0000-4000-8000-000000000072

INSERT INTO platform.organizations (id, name)
VALUES (:'p123_org', 'Migration 123 Organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES (:'p123_scope', :'p123_org', 'organization', :'p123_org', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (:'p123_user', 'p123-admin@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES (
  :'p123_profile', :'p123_user', 'P123 Canonical Author', 'active', 1
);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES (
  :'p123_membership', :'p123_org', :'p123_profile', 'active', 'admin',
  :'p123_admin_bundle'
);

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES (
  '59912300-0000-4000-8000-000000000041', :'p123_org',
  :'p123_membership', :'p123_scope', 1, 1, TRUE, 'system', NULL,
  'P123 admin scope', '59912300-0000-4000-8000-000000000141'
);

INSERT INTO platform.leads (
  id, organization_id, client_id, current_owner_membership_id,
  stage_key, source_key, lifecycle_state, created_at, updated_at
) VALUES
  (
    :'p123_lead_with_notes', :'p123_org', NULL, NULL,
    'new', 'p123', 'open',
    '2026-09-01 06:00:00+00', '2026-09-03 06:00:00+00'
  ),
  (
    :'p123_lead_without_notes', :'p123_org', NULL, NULL,
    'new', 'p123', 'open',
    '2026-09-01 07:00:00+00', '2026-09-02 06:00:00+00'
  );

INSERT INTO platform.case_notes (
  id, organization_id, lead_id, body, created_by_membership_id, created_at
) VALUES
  (
    :'p123_older_note', :'p123_org', :'p123_lead_with_notes',
    'Earlier exact lead note', :'p123_membership',
    '2026-09-04 08:00:00+00'
  ),
  (
    :'p123_latest_note', :'p123_org', :'p123_lead_with_notes',
    'Latest exact lead note', :'p123_membership',
    '2026-09-04 09:00:00+00'
  );

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p123_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p123_org',
  'platform_membership_id', :'p123_membership',
  'platform_bundle_id', :'p123_admin_bundle',
  'platform_bundle_version', :'p123_admin_version'::INTEGER
)::TEXT AS p123_admin_claims
\gset

SET request.jwt.claims TO :'p123_admin_claims';
SET ROLE authenticated;

SELECT pg_catalog.to_jsonb(page.*)::TEXT AS p123_note_row
FROM platform.staff_sales_lead_page(20) AS page
WHERE page.lead_id = :'p123_lead_with_notes'
\gset

SELECT pg_catalog.to_jsonb(page.*)::TEXT AS p123_empty_row
FROM platform.staff_sales_lead_page(20) AS page
WHERE page.lead_id = :'p123_lead_without_notes'
\gset

RESET ROLE;

SELECT pg_temp.p123_assert(
  :'p123_note_row'::JSONB ->> 'latest_note_id' = :'p123_latest_note'
    AND :'p123_note_row'::JSONB ->> 'latest_note_body'
      = 'Latest exact lead note'
    AND :'p123_note_row'::JSONB ->> 'latest_note_author_display_name'
      = 'P123 Canonical Author'
    AND :'p123_note_row'::JSONB ->> 'latest_note_created_at'
      = '2026-09-04T09:00:00+00:00'
    AND :'p123_note_row'::JSONB ->> 'stage_entered_at'
      = '2026-09-01T06:00:00+00:00',
  'Sales page did not return the exact latest lead note and stage entry'
);

SELECT pg_temp.p123_assert(
  :'p123_empty_row'::JSONB -> 'latest_note_id' = 'null'::JSONB
    AND :'p123_empty_row'::JSONB -> 'latest_note_body' = 'null'::JSONB
    AND :'p123_empty_row'::JSONB -> 'latest_note_author_display_name'
      = 'null'::JSONB
    AND :'p123_empty_row'::JSONB -> 'latest_note_created_at' = 'null'::JSONB,
  'A lead without notes received a substituted or partial note projection'
);

SELECT pg_temp.p123_assert(
  (
    SELECT pg_catalog.count(*)
    FROM platform.staff_sales_lead_page(20) AS page
    WHERE page.lead_id = :'p123_lead_with_notes'
  ) = 1,
  'Latest-note projection duplicated a Sales page row'
);

RESET request.jwt.claims;
ROLLBACK;
