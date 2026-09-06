\set ON_ERROR_STOP on

-- Migration 120 focused database/authorization proof. All rows are synthetic
-- and rolled back; no managed project or provider is contacted.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p120_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 120 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p120_capture_error(p_statement TEXT)
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

GRANT EXECUTE ON FUNCTION pg_temp.p120_assert(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p120_capture_error(TEXT)
  TO anon, authenticated, service_role;

-- Catalog contract: forced RLS, no direct table privileges, exact RPC grants
-- and the composed P7A allowlists.
DO $catalog_contract$
DECLARE
  rpc_signature TEXT;
  routine_oid REGPROCEDURE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'platform.reply_snippets'::REGCLASS
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'platform.reply_snippets must force RLS';
  END IF;

  IF has_table_privilege('anon', 'platform.reply_snippets', 'SELECT')
    OR has_table_privilege('authenticated', 'platform.reply_snippets', 'SELECT')
    OR has_table_privilege('service_role', 'platform.reply_snippets', 'SELECT')
    OR has_table_privilege('anon', 'platform.reply_snippets', 'INSERT')
    OR has_table_privilege(
      'authenticated', 'platform.reply_snippets', 'INSERT'
    )
    OR has_table_privilege(
      'service_role', 'platform.reply_snippets', 'INSERT'
    )
    OR has_table_privilege(
      'authenticated', 'platform.reply_snippets', 'UPDATE'
    )
    OR has_table_privilege(
      'authenticated', 'platform.reply_snippets', 'DELETE'
    )
  THEN
    RAISE EXCEPTION 'platform.reply_snippets leaked direct table privileges';
  END IF;

  FOREACH rpc_signature IN ARRAY ARRAY[
    'platform.list_reply_snippets(uuid,text)',
    'platform.create_reply_snippet(uuid,text,text,text,uuid)',
    'platform.update_reply_snippet(uuid,uuid,text,text,text,bigint,uuid)',
    'platform.archive_reply_snippet(uuid,uuid,bigint,uuid)'
  ] LOOP
    routine_oid := pg_catalog.to_regprocedure(rpc_signature);
    IF routine_oid IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = routine_oid
          AND NOT routine.prosecdef
          AND routine.provolatile = CASE
            WHEN rpc_signature LIKE '%.list_reply_snippets%' THEN 's'::"char"
            ELSE 'v'::"char"
          END
          AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      )
      OR NOT has_function_privilege('authenticated', rpc_signature, 'EXECUTE')
      OR has_function_privilege('anon', rpc_signature, 'EXECUTE')
      OR has_function_privilege('service_role', rpc_signature, 'EXECUTE')
      OR has_function_privilege(
        'supabase_auth_admin', rpc_signature, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION
        '% must be an empty-search-path invoker with exact browser grants',
        rpc_signature;
    END IF;
  END LOOP;

  FOREACH rpc_signature IN ARRAY ARRAY[
    'private.list_reply_snippets(uuid,text)',
    'private.create_reply_snippet(uuid,text,text,text,uuid)',
    'private.update_reply_snippet(uuid,uuid,text,text,text,bigint,uuid)',
    'private.archive_reply_snippet(uuid,uuid,bigint,uuid)'
  ] LOOP
    routine_oid := pg_catalog.to_regprocedure(rpc_signature);
    IF routine_oid IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = routine_oid
          AND routine.prosecdef
          AND routine.provolatile = CASE
            WHEN rpc_signature LIKE '%.list_reply_snippets%' THEN 's'::"char"
            ELSE 'v'::"char"
          END
          AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      )
      OR NOT has_function_privilege('authenticated', rpc_signature, 'EXECUTE')
      OR has_function_privilege('anon', rpc_signature, 'EXECUTE')
      OR has_function_privilege('service_role', rpc_signature, 'EXECUTE')
      OR has_function_privilege(
        'supabase_auth_admin', rpc_signature, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION
        '% must be a hardened private definer with exact caller grants',
        rpc_signature;
    END IF;
  END LOOP;

  FOREACH rpc_signature IN ARRAY ARRAY[
    'private.require_reply_snippet_actor(uuid)',
    'private.reply_snippet_audience_visible(text,text)',
    'private.assert_reply_snippet_request_actor(uuid,uuid,uuid,uuid)'
  ] LOOP
    IF has_function_privilege('anon', rpc_signature, 'EXECUTE')
      OR has_function_privilege('authenticated', rpc_signature, 'EXECUTE')
      OR has_function_privilege('service_role', rpc_signature, 'EXECUTE')
      OR has_function_privilege(
        'supabase_auth_admin', rpc_signature, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION '% must stay private', rpc_signature;
    END IF;
  END LOOP;

  IF NOT (
    ARRAY['snippet.archive', 'snippet.create', 'snippet.update']::TEXT[]
      <@ platform_private.p7a_safe_audit_actions()
    AND ARRAY['reply_snippet']::TEXT[]
      <@ platform_private.p7a_safe_audit_resource_types()
  ) THEN
    RAISE EXCEPTION 'P7A allowlists are missing the snippet audit surface';
  END IF;
END
$catalog_contract$;

\set p120_org_a '77120000-0000-4000-8000-000000000001'
\set p120_org_b '77120000-0000-4000-8000-000000000002'
\set p120_admin_a_user '77120000-0000-4000-8000-000000000101'
\set p120_sales_a_user '77120000-0000-4000-8000-000000000102'
\set p120_curator_a_user '77120000-0000-4000-8000-000000000103'
\set p120_admin_b_user '77120000-0000-4000-8000-000000000104'
\set p120_admin_a_profile '77120000-0000-4000-8000-000000000201'
\set p120_sales_a_profile '77120000-0000-4000-8000-000000000202'
\set p120_curator_a_profile '77120000-0000-4000-8000-000000000203'
\set p120_admin_b_profile '77120000-0000-4000-8000-000000000204'
\set p120_admin_a_membership '77120000-0000-4000-8000-000000000301'
\set p120_sales_a_membership '77120000-0000-4000-8000-000000000302'
\set p120_curator_a_membership '77120000-0000-4000-8000-000000000303'
\set p120_admin_b_membership '77120000-0000-4000-8000-000000000304'

SELECT bundle.id AS p120_admin_bundle,
  bundle.version AS p120_admin_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'communication.manual.send'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'communication.read.full'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p120_sales_bundle,
  bundle.version AS p120_sales_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'communication.manual.send'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'communication.read.full'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p120_curator_bundle,
  bundle.version AS p120_curator_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'communication.manual.send'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'communication.read.full'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset

INSERT INTO platform.organizations (id, name)
VALUES
  (:'p120_org_a', 'Migration 120 Organization A'),
  (:'p120_org_b', 'Migration 120 Organization B');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'p120_admin_a_user', 'p120-admin-a@example.invalid', '{}'),
  (:'p120_sales_a_user', 'p120-sales-a@example.invalid', '{}'),
  (:'p120_curator_a_user', 'p120-curator-a@example.invalid', '{}'),
  (:'p120_admin_b_user', 'p120-admin-b@example.invalid', '{}');

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
)
VALUES
  (:'p120_admin_a_profile', :'p120_admin_a_user', 'P120 Admin A', 'active', 1),
  (:'p120_sales_a_profile', :'p120_sales_a_user', 'P120 Sales A', 'active', 1),
  (
    :'p120_curator_a_profile', :'p120_curator_a_user',
    'P120 Admissions A', 'active', 1
  ),
  (:'p120_admin_b_profile', :'p120_admin_b_user', 'P120 Admin B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
VALUES
  (
    :'p120_admin_a_membership', :'p120_org_a', :'p120_admin_a_profile',
    'active', 'admin', :'p120_admin_bundle'
  ),
  (
    :'p120_sales_a_membership', :'p120_org_a', :'p120_sales_a_profile',
    'active', 'sales', :'p120_sales_bundle'
  ),
  (
    :'p120_curator_a_membership', :'p120_org_a', :'p120_curator_a_profile',
    'active', 'curator', :'p120_curator_bundle'
  ),
  (
    :'p120_admin_b_membership', :'p120_org_b', :'p120_admin_b_profile',
    'active', 'admin', :'p120_admin_bundle'
  );

SELECT
  jsonb_build_object(
    'sub', :'p120_admin_a_user', 'role', 'authenticated',
    'platform_role', 'admin', 'platform_access_version', 1,
    'platform_organization_id', :'p120_org_a',
    'platform_membership_id', :'p120_admin_a_membership',
    'platform_bundle_id', :'p120_admin_bundle',
    'platform_bundle_version', :'p120_admin_bundle_version'::INTEGER
  )::TEXT AS p120_admin_a_claims,
  jsonb_build_object(
    'sub', :'p120_sales_a_user', 'role', 'authenticated',
    'platform_role', 'sales', 'platform_access_version', 1,
    'platform_organization_id', :'p120_org_a',
    'platform_membership_id', :'p120_sales_a_membership',
    'platform_bundle_id', :'p120_sales_bundle',
    'platform_bundle_version', :'p120_sales_bundle_version'::INTEGER
  )::TEXT AS p120_sales_a_claims,
  jsonb_build_object(
    'sub', :'p120_curator_a_user', 'role', 'authenticated',
    'platform_role', 'curator', 'platform_access_version', 1,
    'platform_organization_id', :'p120_org_a',
    'platform_membership_id', :'p120_curator_a_membership',
    'platform_bundle_id', :'p120_curator_bundle',
    'platform_bundle_version', :'p120_curator_bundle_version'::INTEGER
  )::TEXT AS p120_curator_a_claims,
  jsonb_build_object(
    'sub', :'p120_admin_b_user', 'role', 'authenticated',
    'platform_role', 'admin', 'platform_access_version', 1,
    'platform_organization_id', :'p120_org_b',
    'platform_membership_id', :'p120_admin_b_membership',
    'platform_bundle_id', :'p120_admin_bundle',
    'platform_bundle_version', :'p120_admin_bundle_version'::INTEGER
  )::TEXT AS p120_admin_b_claims
\gset

-- Happy path: every staff role creates inside its visible audiences, and an
-- exact replay returns the one canonical result.
SET request.jwt.claims TO :'p120_admin_a_claims';
SET ROLE authenticated;
SELECT platform.create_reply_snippet(
  :'p120_org_a', 'all', 'Greeting',
  E'Hello!\nThanks for reaching out to EVO.',
  '77120000-0000-4000-8000-000000000701'
)::TEXT AS p120_all_snippet
\gset
SELECT platform.create_reply_snippet(
  :'p120_org_a', 'all', 'Greeting',
  E'Hello!\nThanks for reaching out to EVO.',
  '77120000-0000-4000-8000-000000000701'
)::TEXT AS p120_all_snippet_replay
\gset
RESET ROLE;

SET request.jwt.claims TO :'p120_sales_a_claims';
SET ROLE authenticated;
SELECT platform.create_reply_snippet(
  :'p120_org_a', 'sales', 'Pricing follow-up',
  'Our consultation packages start after the first call.',
  '77120000-0000-4000-8000-000000000702'
)::TEXT AS p120_sales_snippet
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'admissions', 'Wrong audience', 'Sales cannot post this.',
  '77120000-0000-4000-8000-000000000703'
))::TEXT AS p120_sales_admissions_error
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'everyone', 'Bad audience', 'Unknown audience key.',
  '77120000-0000-4000-8000-000000000704'
))::TEXT AS p120_bad_audience_error
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'sales', '   ', 'Blank title must fail.',
  '77120000-0000-4000-8000-000000000705'
))::TEXT AS p120_blank_title_error
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'sales', 'Too long', repeat('x', 2001),
  '77120000-0000-4000-8000-000000000706'
))::TEXT AS p120_long_body_error
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'sales', U&'Bad\0085title', 'Valid body',
  '77120000-0000-4000-8000-000000000708'
))::TEXT AS p120_c1_title_error
\gset
RESET ROLE;

SET request.jwt.claims TO :'p120_curator_a_claims';
SET ROLE authenticated;
SELECT platform.create_reply_snippet(
  :'p120_org_a', 'admissions', 'Document checklist',
  'Please send your passport scan and transcript.',
  '77120000-0000-4000-8000-000000000707'
)::TEXT AS p120_admissions_snippet
\gset
RESET ROLE;

SELECT pg_temp.p120_assert(
  :'p120_all_snippet'::JSONB = :'p120_all_snippet_replay'::JSONB
    AND :'p120_all_snippet'::JSONB ->> 'version' = '1'
    AND :'p120_all_snippet'::JSONB ->> 'audience' = 'all'
    AND :'p120_sales_admissions_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p120_bad_audience_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p120_blank_title_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p120_long_body_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p120_c1_title_error'::JSONB ->> 'sqlstate' = '22023',
  'create validation, audience guard or idempotent replay failed'
);

SELECT (:'p120_all_snippet'::JSONB ->> 'reply_snippet_id')::UUID
  AS p120_all_snippet_id,
  (:'p120_sales_snippet'::JSONB ->> 'reply_snippet_id')::UUID
  AS p120_sales_snippet_id,
  (:'p120_admissions_snippet'::JSONB ->> 'reply_snippet_id')::UUID
  AS p120_admissions_snippet_id
\gset

-- Reusing a successful request id with different inputs is a hard conflict,
-- and other principals cannot read the stored result through replay.
SET request.jwt.claims TO :'p120_admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'all', 'Greeting changed', 'Different body.',
  '77120000-0000-4000-8000-000000000701'
))::TEXT AS p120_request_conflict_error
\gset
RESET ROLE;

SET request.jwt.claims TO :'p120_admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'all', 'Greeting',
  E'Hello!\nThanks for reaching out to EVO.',
  '77120000-0000-4000-8000-000000000701'
))::TEXT AS p120_cross_org_replay_error
\gset
RESET ROLE;

SET request.jwt.claims TO :'p120_sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'all', 'Greeting',
  E'Hello!\nThanks for reaching out to EVO.',
  '77120000-0000-4000-8000-000000000701'
))::TEXT AS p120_cross_actor_replay_error
\gset
RESET ROLE;

SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'all', 'Greeting',
  E'Hello!\nThanks for reaching out to EVO.',
  '77120000-0000-4000-8000-000000000701'
))::TEXT AS p120_anon_error
\gset
RESET ROLE;

SELECT pg_temp.p120_assert(
  :'p120_request_conflict_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p120_request_conflict_error'::JSONB ->> 'message'
      LIKE '%already used%'
    AND :'p120_cross_org_replay_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p120_cross_actor_replay_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p120_anon_error'::JSONB ->> 'sqlstate' = '42501',
  'request-id reuse, cross-actor, cross-organization or anonymous access crossed the boundary'
);

-- Direct table access stays revoked for browser principals.
SET request.jwt.claims TO :'p120_admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p120_capture_error(
  'SELECT count(*) FROM platform.reply_snippets'
)::TEXT AS p120_direct_select_error
\gset
RESET ROLE;

SELECT pg_temp.p120_assert(
  :'p120_direct_select_error'::JSONB ->> 'sqlstate' = '42501',
  'authenticated principals read platform.reply_snippets directly'
);

-- Audience-scoped listings per role.
SET request.jwt.claims TO :'p120_sales_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p120_sales_list_count,
  count(*) FILTER (WHERE listing.audience = 'admissions')::TEXT
    AS p120_sales_admissions_count
FROM platform.list_reply_snippets(:'p120_org_a') AS listing
\gset
SELECT count(*)::TEXT AS p120_sales_filtered_count
FROM platform.list_reply_snippets(:'p120_org_a', 'sales') AS listing
\gset
SELECT count(*)::TEXT AS p120_sales_admissions_filter_count
FROM platform.list_reply_snippets(:'p120_org_a', 'admissions') AS listing
\gset
RESET ROLE;

SET request.jwt.claims TO :'p120_curator_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p120_curator_list_count,
  count(*) FILTER (WHERE listing.audience = 'sales')::TEXT
    AS p120_curator_sales_count
FROM platform.list_reply_snippets(:'p120_org_a') AS listing
\gset
RESET ROLE;

SET request.jwt.claims TO :'p120_admin_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p120_admin_list_count
FROM platform.list_reply_snippets(:'p120_org_a') AS listing
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT count(*) FROM platform.list_reply_snippets(%L::uuid, %L)',
  :'p120_org_a', 'draft'
))::TEXT AS p120_bad_filter_error
\gset
RESET ROLE;

SET request.jwt.claims TO :'p120_admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.p120_capture_error(format(
  'SELECT count(*) FROM platform.list_reply_snippets(%L::uuid)',
  :'p120_org_a'
))::TEXT AS p120_cross_org_list_error
\gset
RESET ROLE;

SELECT pg_temp.p120_assert(
  :'p120_sales_list_count'::INTEGER = 2
    AND :'p120_sales_admissions_count'::INTEGER = 0
    AND :'p120_sales_filtered_count'::INTEGER = 1
    AND :'p120_sales_admissions_filter_count'::INTEGER = 0
    AND :'p120_curator_list_count'::INTEGER = 2
    AND :'p120_curator_sales_count'::INTEGER = 0
    AND :'p120_admin_list_count'::INTEGER = 3
    AND :'p120_bad_filter_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p120_cross_org_list_error'::JSONB ->> 'sqlstate' = '42501',
  'audience visibility, filter validation or cross-organization listing failed'
);

-- Optimistic update: author edits, stale version conflicts, foreign author is
-- denied, admin overrides, and the audience stays inside the writer''s set.
SET request.jwt.claims TO :'p120_sales_a_claims';
SET ROLE authenticated;
SELECT platform.update_reply_snippet(
  :'p120_org_a', :'p120_sales_snippet_id', 'sales', 'Pricing follow-up',
  'Updated: our packages are described in the attached PDF.',
  1, '77120000-0000-4000-8000-000000000708'
)::TEXT AS p120_sales_update
\gset
SELECT platform.update_reply_snippet(
  :'p120_org_a', :'p120_sales_snippet_id', 'sales', 'Pricing follow-up',
  'Updated: our packages are described in the attached PDF.',
  1, '77120000-0000-4000-8000-000000000708'
)::TEXT AS p120_sales_update_replay
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.update_reply_snippet(%L::uuid,%L::uuid,%L,%L,%L,1,%L::uuid)',
  :'p120_org_a', :'p120_sales_snippet_id', 'sales', 'Stale', 'Stale body.',
  '77120000-0000-4000-8000-000000000709'
))::TEXT AS p120_stale_update_error
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.update_reply_snippet(%L::uuid,%L::uuid,%L,%L,%L,2,%L::uuid)',
  :'p120_org_a', :'p120_sales_snippet_id', 'admissions', 'Escape',
  'Sales must not retarget to admissions.',
  '77120000-0000-4000-8000-000000000710'
))::TEXT AS p120_audience_escape_error
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.update_reply_snippet(%L::uuid,%L::uuid,%L,%L,%L,1,%L::uuid)',
  :'p120_org_a', :'p120_all_snippet_id', 'all', 'Greeting',
  'Sales must not edit the admin snippet.',
  '77120000-0000-4000-8000-000000000711'
))::TEXT AS p120_foreign_author_error
\gset
RESET ROLE;

SET request.jwt.claims TO :'p120_admin_a_claims';
SET ROLE authenticated;
SELECT platform.update_reply_snippet(
  :'p120_org_a', :'p120_sales_snippet_id', 'all', 'Pricing follow-up',
  'Admin retargeted this snippet to every staff role.',
  2, '77120000-0000-4000-8000-000000000712'
)::TEXT AS p120_admin_override_update
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.update_reply_snippet(%L::uuid,%L::uuid,%L,%L,%L,3,%L::uuid)',
  :'p120_org_a', :'p120_sales_snippet_id', 'all', 'Pricing follow-up',
  'Admin retargeted this snippet to every staff role.',
  '77120000-0000-4000-8000-000000000713'
))::TEXT AS p120_no_change_error
\gset
RESET ROLE;

SELECT pg_temp.p120_assert(
  :'p120_sales_update'::JSONB = :'p120_sales_update_replay'::JSONB
    AND :'p120_sales_update'::JSONB ->> 'version' = '2'
    AND :'p120_stale_update_error'::JSONB ->> 'sqlstate' = 'PT409'
    AND :'p120_audience_escape_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p120_foreign_author_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p120_admin_override_update'::JSONB ->> 'version' = '3'
    AND :'p120_no_change_error'::JSONB ->> 'sqlstate' = '22023',
  'optimistic update, author boundary or admin override failed'
);

-- Audit trail: the update kept a before/after pair under the composed action.
SELECT pg_temp.p120_assert(
  EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id = '77120000-0000-4000-8000-000000000708'
      AND audit.action = 'snippet.update'
      AND audit.resource_type = 'reply_snippet'
      AND audit.resource_id = :'p120_sales_snippet_id'
      AND audit.before_state ->> 'version' = '1'
      AND audit.after_state ->> 'version' = '2'
  ),
  'snippet.update audit evidence is missing or malformed'
);

-- Archive: author archives their own snippet, replay is idempotent, archived
-- rows leave listings, and a second archive attempt conflicts.
SET request.jwt.claims TO :'p120_curator_a_claims';
SET ROLE authenticated;
SELECT platform.archive_reply_snippet(
  :'p120_org_a', :'p120_admissions_snippet_id', 1,
  '77120000-0000-4000-8000-000000000714'
)::TEXT AS p120_archive
\gset
SELECT platform.archive_reply_snippet(
  :'p120_org_a', :'p120_admissions_snippet_id', 1,
  '77120000-0000-4000-8000-000000000714'
)::TEXT AS p120_archive_replay
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.archive_reply_snippet(%L::uuid,%L::uuid,2,%L::uuid)',
  :'p120_org_a', :'p120_admissions_snippet_id',
  '77120000-0000-4000-8000-000000000715'
))::TEXT AS p120_double_archive_error
\gset
SELECT count(*)::TEXT AS p120_curator_after_archive_count
FROM platform.list_reply_snippets(:'p120_org_a') AS listing
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.update_reply_snippet(%L::uuid,%L::uuid,%L,%L,%L,2,%L::uuid)',
  :'p120_org_a', :'p120_admissions_snippet_id', 'admissions',
  'Document checklist', 'Archived snippets are not editable.',
  '77120000-0000-4000-8000-000000000716'
))::TEXT AS p120_update_archived_error
\gset
RESET ROLE;

SELECT pg_temp.p120_assert(
  :'p120_archive'::JSONB = :'p120_archive_replay'::JSONB
    AND :'p120_archive'::JSONB ->> 'version' = '2'
    AND :'p120_archive'::JSONB ->> 'archived_at' IS NOT NULL
    AND :'p120_double_archive_error'::JSONB ->> 'sqlstate' = 'PT409'
    AND :'p120_curator_after_archive_count'::INTEGER = 2
    AND :'p120_update_archived_error'::JSONB ->> 'sqlstate' = '42501'
    AND EXISTS (
      SELECT 1
      FROM platform.reply_snippets AS snippet
      WHERE snippet.id = :'p120_admissions_snippet_id'
        AND snippet.archived_at IS NOT NULL
    ),
  'archive lifecycle, idempotent replay or archived-row visibility failed'
);

-- A role label is not enough: loss of the exact communication permissions in
-- the live bundle revokes both reads and writes immediately.
INSERT INTO platform.role_bundle_versions (
  id, role, version, status, label, published_at
) VALUES (
  '77120000-0000-4000-8000-000000000401',
  'sales',
  120001,
  'draft',
  'P120 sales bundle without communication permissions',
  NULL
);
INSERT INTO platform.role_bundle_permissions (
  bundle_id, bundle_role, permission_key
) VALUES (
  '77120000-0000-4000-8000-000000000401',
  'sales',
  'organization.read'
);
UPDATE platform.role_bundle_versions
SET status = 'published',
    published_at = statement_timestamp()
WHERE id = '77120000-0000-4000-8000-000000000401';
UPDATE platform.organization_memberships
SET current_bundle_id = '77120000-0000-4000-8000-000000000401'
WHERE id = :'p120_sales_a_membership';
SELECT jsonb_build_object(
  'sub', :'p120_sales_a_user', 'role', 'authenticated',
  'platform_role', 'sales', 'platform_access_version', 1,
  'platform_organization_id', :'p120_org_a',
  'platform_membership_id', :'p120_sales_a_membership',
  'platform_bundle_id', '77120000-0000-4000-8000-000000000401',
  'platform_bundle_version', 120001
)::TEXT AS p120_limited_sales_claims
\gset

SET request.jwt.claims TO :'p120_limited_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p120_capture_error(format(
  'SELECT count(*) FROM platform.list_reply_snippets(%L::uuid)',
  :'p120_org_a'
))::TEXT AS p120_missing_read_permission_error
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'sales', 'Permission probe',
  'Missing communication.manual.send must fail closed.',
  '77120000-0000-4000-8000-000000000717'
))::TEXT AS p120_missing_send_permission_error
\gset
RESET ROLE;

SELECT pg_temp.p120_assert(
  :'p120_missing_read_permission_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p120_missing_send_permission_error'::JSONB ->> 'sqlstate' = '42501'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events AS audit
      WHERE audit.request_id = '77120000-0000-4000-8000-000000000717'
    ),
  'live communication permission loss did not revoke snippet access'
);

UPDATE platform.organization_memberships
SET current_bundle_id = :'p120_sales_bundle'
WHERE id = :'p120_sales_a_membership';

-- Authorship does not survive a role change across an invisible audience.
-- The same person, now Admissions, cannot mutate the Sales-only text they
-- authored under their former role.
SET request.jwt.claims TO :'p120_sales_a_claims';
SET ROLE authenticated;
SELECT platform.create_reply_snippet(
  :'p120_org_a', 'sales', 'Role transition probe',
  'This remains visible only to Sales.',
  '77120000-0000-4000-8000-000000000718'
)::TEXT AS p120_role_transition_snippet
\gset
RESET ROLE;
SELECT (:'p120_role_transition_snippet'::JSONB ->> 'reply_snippet_id')::UUID
  AS p120_role_transition_snippet_id
\gset

UPDATE platform.organization_memberships
SET "current_role" = 'curator',
    current_bundle_id = :'p120_curator_bundle'
WHERE id = :'p120_sales_a_membership';
SELECT jsonb_build_object(
  'sub', :'p120_sales_a_user', 'role', 'authenticated',
  'platform_role', 'curator', 'platform_access_version', 1,
  'platform_organization_id', :'p120_org_a',
  'platform_membership_id', :'p120_sales_a_membership',
  'platform_bundle_id', :'p120_curator_bundle',
  'platform_bundle_version', :'p120_curator_bundle_version'::INTEGER
)::TEXT AS p120_sales_as_curator_claims
\gset

SET request.jwt.claims TO :'p120_sales_as_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.update_reply_snippet(%L::uuid,%L::uuid,%L,%L,%L,1,%L::uuid)',
  :'p120_org_a', :'p120_role_transition_snippet_id', 'admissions',
  'Role transition probe', 'A new role cannot retarget an invisible snippet.',
  '77120000-0000-4000-8000-000000000719'
))::TEXT AS p120_role_transition_update_error
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.archive_reply_snippet(%L::uuid,%L::uuid,1,%L::uuid)',
  :'p120_org_a', :'p120_role_transition_snippet_id',
  '77120000-0000-4000-8000-000000000720'
))::TEXT AS p120_role_transition_archive_error
\gset
RESET ROLE;

SELECT pg_temp.p120_assert(
  :'p120_role_transition_update_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p120_role_transition_archive_error'::JSONB ->> 'sqlstate' = '42501'
    AND EXISTS (
      SELECT 1
      FROM platform.reply_snippets AS snippet
      WHERE snippet.id = :'p120_role_transition_snippet_id'
        AND snippet.audience = 'sales'
        AND snippet.version = 1
        AND snippet.archived_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events AS audit
      WHERE audit.request_id IN (
        '77120000-0000-4000-8000-000000000719',
        '77120000-0000-4000-8000-000000000720'
      )
    ),
  'role transition crossed the original audience boundary'
);

-- PostgreSQL and TypeScript share an explicit storage contract: ASCII SPACE
-- and edge LF are trimmed from bodies, while char_length/code-point limits
-- treat an astral emoji as one character. A direct RPC write must therefore
-- never create a row that the TypeScript reader rejects.
SET request.jwt.claims TO :'p120_admin_a_claims';
SET ROLE authenticated;
SELECT platform.create_reply_snippet(
  :'p120_org_a', 'all', 'Whitespace boundary',
  E'\n  Wrapped body  \n',
  '77120000-0000-4000-8000-000000000721'
)::TEXT AS p120_wrapped_body_snippet
\gset
SELECT platform.create_reply_snippet(
  :'p120_org_a', 'all', 'Emoji boundary', repeat('😀', 2000),
  '77120000-0000-4000-8000-000000000722'
)::TEXT AS p120_emoji_boundary_snippet
\gset
SELECT pg_temp.p120_capture_error(format(
  'SELECT platform.create_reply_snippet(%L::uuid,%L,%L,%L,%L::uuid)',
  :'p120_org_a', 'all', 'Emoji over limit', repeat('😀', 2001),
  '77120000-0000-4000-8000-000000000723'
))::TEXT AS p120_emoji_over_limit_error
\gset
SELECT count(*) FILTER (
    WHERE listing.reply_snippet_id =
      (:'p120_wrapped_body_snippet'::JSONB ->> 'reply_snippet_id')::UUID
      AND listing.body = 'Wrapped body'
  )::TEXT AS p120_wrapped_body_list_count,
  count(*) FILTER (
    WHERE listing.reply_snippet_id =
      (:'p120_emoji_boundary_snippet'::JSONB ->> 'reply_snippet_id')::UUID
      AND pg_catalog.char_length(listing.body) = 2000
  )::TEXT AS p120_emoji_boundary_list_count
FROM platform.list_reply_snippets(:'p120_org_a') AS listing
\gset
RESET ROLE;

SELECT pg_temp.p120_assert(
  :'p120_wrapped_body_snippet'::JSONB ->> 'body' = 'Wrapped body'
    AND :'p120_wrapped_body_list_count'::INTEGER = 1
    AND pg_catalog.char_length(
      :'p120_emoji_boundary_snippet'::JSONB ->> 'body'
    ) = 2000
    AND :'p120_emoji_boundary_list_count'::INTEGER = 1
    AND :'p120_emoji_over_limit_error'::JSONB ->> 'sqlstate' = '22023',
  'reply snippet whitespace or Unicode code-point contract drifted'
);

ROLLBACK;
