\set ON_ERROR_STOP on

-- Migration 109 focused database/authorization proof. All rows and Storage
-- metadata are synthetic and rolled back; no managed project or provider is
-- contacted.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p109_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 109 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p109_capture_error(p_statement TEXT)
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

GRANT EXECUTE ON FUNCTION pg_temp.p109_assert(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p109_capture_error(TEXT)
  TO anon, authenticated, service_role;

DO $catalog_contract$
DECLARE
  table_name TEXT;
  rpc_signature TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'platform.company_file_folders',
    'platform.company_files',
    'platform.company_file_versions',
    'platform_private.company_file_command_receipts',
    'platform_private.company_file_upload_reservations',
    'platform_private.company_file_storage_bindings',
    'platform_private.company_file_upload_finalizations',
    'platform_private.company_file_download_grants',
    'platform_private.company_file_download_consumptions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = table_name::REGCLASS
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION '% must force RLS', table_name;
    END IF;

    IF has_table_privilege('anon', table_name, 'SELECT')
      OR has_table_privilege('authenticated', table_name, 'SELECT')
      OR has_table_privilege('service_role', table_name, 'SELECT')
      OR has_table_privilege('anon', table_name, 'INSERT')
      OR has_table_privilege('authenticated', table_name, 'INSERT')
      OR has_table_privilege('service_role', table_name, 'INSERT')
    THEN
      RAISE EXCEPTION '% leaked direct table privileges', table_name;
    END IF;
  END LOOP;

  FOREACH rpc_signature IN ARRAY ARRAY[
    'platform.staff_company_file_workspace(uuid)',
    'platform.create_company_file_folder(uuid,uuid,text,uuid)',
    'platform.rename_company_file_folder(uuid,uuid,bigint,text,uuid)',
    'platform.move_company_file_folder(uuid,uuid,bigint,uuid,uuid)',
    'platform.archive_company_file_folder(uuid,uuid,bigint,uuid)',
    'platform.create_company_file(uuid,uuid,text,uuid)',
    'platform.rename_company_file(uuid,uuid,bigint,text,uuid)',
    'platform.move_company_file(uuid,uuid,bigint,uuid,uuid)',
    'platform.archive_company_file(uuid,uuid,bigint,uuid)',
    'platform.reserve_company_file_upload(uuid,uuid,bigint,text,text,bigint,text,uuid)',
    'platform.grant_company_file_download(uuid,uuid,text,integer,uuid)'
  ] LOOP
    IF NOT has_function_privilege('authenticated', rpc_signature, 'EXECUTE')
      OR has_function_privilege('anon', rpc_signature, 'EXECUTE')
    THEN
      RAISE EXCEPTION '% has the wrong browser grants', rpc_signature;
    END IF;
  END LOOP;

  FOREACH rpc_signature IN ARRAY ARRAY[
    'platform.finalize_company_file_upload(uuid,uuid,uuid)',
    'platform.consume_company_file_download_grant(uuid,uuid,uuid)'
  ] LOOP
    IF NOT has_function_privilege('service_role', rpc_signature, 'EXECUTE')
      OR has_function_privilege('authenticated', rpc_signature, 'EXECUTE')
      OR has_function_privilege('anon', rpc_signature, 'EXECUTE')
    THEN
      RAISE EXCEPTION '% has the wrong trusted-service grants', rpc_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.policyname = 'Platform company file reserved upload'
      AND policy.cmd = 'INSERT'
      AND policy.roles = ARRAY['authenticated']::NAME[]
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND (
        COALESCE(policy.qual, '') LIKE '%platform-company-files%'
        OR COALESCE(policy.with_check, '') LIKE '%platform-company-files%'
      )
      AND NOT (
        policy.policyname = 'Platform company file reserved upload'
        AND policy.cmd = 'INSERT'
      )
  ) THEN
    RAISE EXCEPTION 'company file Storage must expose one insert-only policy';
  END IF;

  IF position(
    'IF (SELECT auth.jwt() ->> ''role'') IS DISTINCT FROM ''service_role'''
    IN pg_get_functiondef(
      'platform.finalize_company_file_upload(uuid,uuid,uuid)'::REGPROCEDURE
    )
  ) = 0 OR position(
    'IF (SELECT auth.jwt() ->> ''role'') IS DISTINCT FROM ''service_role'''
    IN pg_get_functiondef(
      'platform.consume_company_file_download_grant(uuid,uuid,uuid)'::REGPROCEDURE
    )
  ) = 0 THEN
    RAISE EXCEPTION 'service-only RPCs lost their explicit fail-closed gate';
  END IF;
END
$catalog_contract$;

\set p109_org_a '59920000-0000-4000-8000-000000000001'
\set p109_org_b '59920000-0000-4000-8000-000000000002'
\set p109_admin_a_user '59920000-0000-4000-8000-000000000101'
\set p109_sales_a_user '59920000-0000-4000-8000-000000000102'
\set p109_curator_a_user '59920000-0000-4000-8000-000000000103'
\set p109_admin_b_user '59920000-0000-4000-8000-000000000104'
\set p109_admin_a_profile '59920000-0000-4000-8000-000000000201'
\set p109_sales_a_profile '59920000-0000-4000-8000-000000000202'
\set p109_curator_a_profile '59920000-0000-4000-8000-000000000203'
\set p109_admin_b_profile '59920000-0000-4000-8000-000000000204'
\set p109_admin_a_membership '59920000-0000-4000-8000-000000000301'
\set p109_sales_a_membership '59920000-0000-4000-8000-000000000302'
\set p109_curator_a_membership '59920000-0000-4000-8000-000000000303'
\set p109_admin_b_membership '59920000-0000-4000-8000-000000000304'

SELECT bundle.id AS p109_admin_bundle, bundle.version AS p109_admin_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p109_sales_bundle, bundle.version AS p109_sales_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p109_curator_bundle, bundle.version AS p109_curator_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

INSERT INTO platform.organizations (id, name)
VALUES
  (:'p109_org_a', 'Migration 109 Organization A'),
  (:'p109_org_b', 'Migration 109 Organization B');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'p109_admin_a_user', 'p109-admin-a@example.invalid', '{}'),
  (:'p109_sales_a_user', 'p109-sales-a@example.invalid', '{}'),
  (:'p109_curator_a_user', 'p109-curator-a@example.invalid', '{}'),
  (:'p109_admin_b_user', 'p109-admin-b@example.invalid', '{}');

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
)
VALUES
  (:'p109_admin_a_profile', :'p109_admin_a_user', 'P109 Admin A', 'active', 1),
  (:'p109_sales_a_profile', :'p109_sales_a_user', 'P109 Sales A', 'active', 1),
  (:'p109_curator_a_profile', :'p109_curator_a_user', 'P109 Admissions A', 'active', 1),
  (:'p109_admin_b_profile', :'p109_admin_b_user', 'P109 Admin B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
VALUES
  (:'p109_admin_a_membership', :'p109_org_a', :'p109_admin_a_profile', 'active', 'admin', :'p109_admin_bundle'),
  (:'p109_sales_a_membership', :'p109_org_a', :'p109_sales_a_profile', 'active', 'sales', :'p109_sales_bundle'),
  (:'p109_curator_a_membership', :'p109_org_a', :'p109_curator_a_profile', 'active', 'curator', :'p109_curator_bundle'),
  (:'p109_admin_b_membership', :'p109_org_b', :'p109_admin_b_profile', 'active', 'admin', :'p109_admin_bundle');

SELECT
  jsonb_build_object(
    'sub', :'p109_admin_a_user', 'role', 'authenticated',
    'platform_role', 'admin', 'platform_access_version', 1,
    'platform_organization_id', :'p109_org_a',
    'platform_membership_id', :'p109_admin_a_membership',
    'platform_bundle_id', :'p109_admin_bundle',
    'platform_bundle_version', :'p109_admin_bundle_version'::INTEGER
  )::TEXT AS p109_admin_a_claims,
  jsonb_build_object(
    'sub', :'p109_sales_a_user', 'role', 'authenticated',
    'platform_role', 'sales', 'platform_access_version', 1,
    'platform_organization_id', :'p109_org_a',
    'platform_membership_id', :'p109_sales_a_membership',
    'platform_bundle_id', :'p109_sales_bundle',
    'platform_bundle_version', :'p109_sales_bundle_version'::INTEGER
  )::TEXT AS p109_sales_a_claims,
  jsonb_build_object(
    'sub', :'p109_curator_a_user', 'role', 'authenticated',
    'platform_role', 'curator', 'platform_access_version', 1,
    'platform_organization_id', :'p109_org_a',
    'platform_membership_id', :'p109_curator_a_membership',
    'platform_bundle_id', :'p109_curator_bundle',
    'platform_bundle_version', :'p109_curator_bundle_version'::INTEGER
  )::TEXT AS p109_curator_a_claims,
  jsonb_build_object(
    'sub', :'p109_admin_b_user', 'role', 'authenticated',
    'platform_role', 'admin', 'platform_access_version', 1,
    'platform_organization_id', :'p109_org_b',
    'platform_membership_id', :'p109_admin_b_membership',
    'platform_bundle_id', :'p109_admin_bundle',
    'platform_bundle_version', :'p109_admin_bundle_version'::INTEGER
  )::TEXT AS p109_admin_b_claims
\gset

-- The plain PostgreSQL authorization harness does not read config.toml, so it
-- creates only this synthetic bucket metadata. Product object bytes still use
-- the Storage API in real app/browser proof.
INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
VALUES (
  'platform-company-files',
  'platform-company-files',
  FALSE,
  26214400,
  ARRAY[
    'application/pdf', 'image/jpeg', 'image/png', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::TEXT[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

SET request.jwt.claims TO :'p109_admin_a_claims';
SET ROLE authenticated;
SELECT platform.create_company_file_folder(
  :'p109_org_a', NULL, 'Operations',
  '59920000-0000-4000-8000-000000000701'
)::TEXT AS p109_folder_a
\gset
SELECT platform.create_company_file_folder(
  :'p109_org_a', NULL, 'Operations',
  '59920000-0000-4000-8000-000000000701'
)::TEXT AS p109_folder_a_replay
\gset
SELECT platform.create_company_file_folder(
  :'p109_org_a', NULL, 'Archive',
  '59920000-0000-4000-8000-000000000702'
)::TEXT AS p109_folder_b
\gset
RESET ROLE;

SELECT pg_temp.p109_assert(
  :'p109_folder_a'::JSONB = :'p109_folder_a_replay'::JSONB
    AND :'p109_folder_a'::JSONB ->> 'version' = '1'
    AND :'p109_folder_a'::JSONB ->> 'name' = 'Operations',
  'admin folder create/replay did not preserve one canonical row'
);

SELECT (:'p109_folder_a'::JSONB ->> 'folder_id')::UUID AS p109_folder_a_id,
  (:'p109_folder_b'::JSONB ->> 'folder_id')::UUID AS p109_folder_b_id
\gset

-- Authorization occurs before receipt replay: a Sales actor, anon actor and
-- other-organization Admin all fail to reuse the successful Admin request id.
SET request.jwt.claims TO :'p109_sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p109_capture_error(format(
  'SELECT platform.create_company_file_folder(%L::uuid,NULL,%L,%L::uuid)',
  :'p109_org_a', 'Operations', '59920000-0000-4000-8000-000000000701'
))::TEXT AS p109_sales_replay_error
\gset
RESET ROLE;

SET request.jwt.claims TO :'p109_admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.p109_capture_error(format(
  'SELECT platform.create_company_file_folder(%L::uuid,NULL,%L,%L::uuid)',
  :'p109_org_a', 'Operations', '59920000-0000-4000-8000-000000000701'
))::TEXT AS p109_cross_org_replay_error
\gset
RESET ROLE;

SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
SELECT pg_temp.p109_capture_error(format(
  'SELECT platform.create_company_file_folder(%L::uuid,NULL,%L,%L::uuid)',
  :'p109_org_a', 'Operations', '59920000-0000-4000-8000-000000000701'
))::TEXT AS p109_anon_replay_error
\gset
RESET ROLE;

SELECT pg_temp.p109_assert(
  :'p109_sales_replay_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p109_cross_org_replay_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p109_anon_replay_error'::JSONB ->> 'sqlstate' = '42501',
  'sales, anon or cross-org replay crossed the company-file boundary'
);

SET request.jwt.claims TO :'p109_curator_a_claims';
SET ROLE authenticated;
SELECT platform.create_company_file(
  :'p109_org_a', :'p109_folder_a_id', 'Admissions handbook',
  '59920000-0000-4000-8000-000000000703'
)::TEXT AS p109_file
\gset
SELECT (:'p109_file'::JSONB ->> 'company_file_id')::UUID AS p109_file_id
\gset

SELECT platform.rename_company_file(
  :'p109_org_a', :'p109_file_id', 1, 'Admissions playbook',
  '59920000-0000-4000-8000-000000000704'
)::TEXT AS p109_file_renamed
\gset
SELECT platform.move_company_file(
  :'p109_org_a', :'p109_file_id', 2, :'p109_folder_b_id',
  '59920000-0000-4000-8000-000000000705'
)::TEXT AS p109_file_moved
\gset

SELECT pg_temp.p109_capture_error(format(
  'SELECT platform.archive_company_file_folder(%L::uuid,%L::uuid,1,%L::uuid)',
  :'p109_org_a', :'p109_folder_b_id',
  '59920000-0000-4000-8000-000000000706'
))::TEXT AS p109_nonempty_archive_error
\gset
SELECT pg_temp.p109_capture_error(format(
  'SELECT platform.rename_company_file(%L::uuid,%L::uuid,1,%L,%L::uuid)',
  :'p109_org_a', :'p109_file_id', 'Stale rename',
  '59920000-0000-4000-8000-000000000707'
))::TEXT AS p109_stale_file_error
\gset

SELECT platform.reserve_company_file_upload(
  :'p109_org_a', :'p109_file_id', 3, 'admissions-playbook.pdf',
  'application/pdf', 4096, repeat('a', 64),
  '59920000-0000-4000-8000-000000000708'
)::TEXT AS p109_reservation
\gset

SELECT pg_temp.p109_assert(
  :'p109_nonempty_archive_error'::JSONB ->> 'sqlstate' = 'PT409'
    AND :'p109_stale_file_error'::JSONB ->> 'sqlstate' = '40001'
    AND :'p109_reservation'::JSONB ->> 'version_no' = '1'
    AND :'p109_reservation'::JSONB ->> 'file_version_published' = 'false',
  'folder emptiness, optimistic lock or pending-version contract failed'
);

SELECT set_config('storage.operation', 'storage.object.upload', false);
SELECT pg_temp.p109_capture_error(format(
  'INSERT INTO storage.objects(bucket_id,name,metadata) VALUES (%L,%L,%L::jsonb)',
  'platform-company-files',
  'ff/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  '{"size":4096,"mimetype":"application/pdf"}'
))::TEXT AS p109_wrong_object_error
\gset

INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES (
  'platform-company-files',
  :'p109_reservation'::JSONB ->> 'object_name',
  jsonb_build_object('size', 2048, 'mimetype', 'application/pdf')
);
RESET ROLE;

SELECT pg_temp.p109_assert(
  :'p109_wrong_object_error'::JSONB ->> 'sqlstate' = '42501'
    AND (
      SELECT count(*) FROM storage.objects
      WHERE bucket_id = 'platform-company-files'
    ) = 1,
  'Storage upload policy allowed an unreserved object or lost the exact object'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.p109_capture_error(format(
  'SELECT platform.finalize_company_file_upload(%L::uuid,%L::uuid,%L::uuid)',
  :'p109_org_a',
  :'p109_reservation'::JSONB ->> 'upload_reservation_id',
  '59920000-0000-4000-8000-000000000709'
))::TEXT AS p109_metadata_mismatch_error
\gset
RESET ROLE;

SELECT pg_temp.p109_assert(
  :'p109_metadata_mismatch_error'::JSONB ->> 'sqlstate' = '22000'
    AND (
      SELECT company_file.current_version_id IS NULL
      FROM platform.company_files AS company_file
      WHERE company_file.id = :'p109_file_id'
    ),
  'mismatched provider byte metadata did not fail closed before publication'
);

-- Test-only provider-metadata correction. Browser principals have no UPDATE
-- policy; the real app uploads a correct object once rather than repairing it.
UPDATE storage.objects
SET metadata = jsonb_build_object('size', 4096, 'mimetype', 'application/pdf')
WHERE bucket_id = 'platform-company-files'
  AND name = (:'p109_reservation'::JSONB ->> 'object_name');

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.finalize_company_file_upload(
  :'p109_org_a',
  (:'p109_reservation'::JSONB ->> 'upload_reservation_id')::UUID,
  '59920000-0000-4000-8000-000000000709'
)::TEXT AS p109_finalization
\gset
SELECT platform.finalize_company_file_upload(
  :'p109_org_a',
  (:'p109_reservation'::JSONB ->> 'upload_reservation_id')::UUID,
  '59920000-0000-4000-8000-000000000709'
)::TEXT AS p109_finalization_replay
\gset
RESET ROLE;

SELECT pg_temp.p109_assert(
  :'p109_finalization'::JSONB = :'p109_finalization_replay'::JSONB
    AND :'p109_finalization'::JSONB ->> 'file_version' = '4'
    AND (
      SELECT company_file.current_version_id
      FROM platform.company_files AS company_file
      WHERE company_file.id = :'p109_file_id'
    ) = (:'p109_reservation'::JSONB ->> 'company_file_version_id')::UUID
    AND (
      SELECT audit.before_state ->> 'file_version' = '3'
        AND audit.before_state -> 'current_version_id' = 'null'::JSONB
        AND audit.before_state ->> 'company_file_id' = :'p109_file_id'
      FROM platform.audit_events AS audit
      WHERE audit.request_id = '59920000-0000-4000-8000-000000000709'
        AND audit.action = 'company.file.upload.finalize'
    ),
  'service finalization was not idempotent, lost before-state or published the wrong version'
);

SET request.jwt.claims TO :'p109_curator_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p109_workspace_count
FROM platform.staff_company_file_workspace(:'p109_org_a')
\gset
SELECT platform.grant_company_file_download(
  :'p109_org_a',
  (:'p109_reservation'::JSONB ->> 'company_file_version_id')::UUID,
  'Staff reviewed company knowledge file', 60,
  '59920000-0000-4000-8000-000000000710'
)::TEXT AS p109_grant
\gset
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.consume_company_file_download_grant(
  :'p109_org_a',
  (:'p109_grant'::JSONB ->> 'company_file_download_grant_id')::UUID,
  '59920000-0000-4000-8000-000000000711'
)::TEXT AS p109_consumption
\gset
SELECT platform.consume_company_file_download_grant(
  :'p109_org_a',
  (:'p109_grant'::JSONB ->> 'company_file_download_grant_id')::UUID,
  '59920000-0000-4000-8000-000000000711'
)::TEXT AS p109_consumption_replay
\gset
RESET ROLE;

SELECT pg_temp.p109_assert(
  :'p109_workspace_count'::INTEGER = 3
    AND :'p109_grant'::JSONB ->> 'signed_url' IS NULL
    AND :'p109_grant'::JSONB ->> 'storage_api_service_sign_required' = 'true'
    AND :'p109_consumption'::JSONB = :'p109_consumption_replay'::JSONB
    AND :'p109_consumption'::JSONB ->> 'bucket_id' = 'platform-company-files'
    AND :'p109_consumption'::JSONB ? 'signing_expires_at',
  'workspace, audited grant or idempotent service consumption failed'
);

SET request.jwt.claims TO :'p109_curator_a_claims';
SET ROLE authenticated;
SELECT platform.archive_company_file(
  :'p109_org_a', :'p109_file_id', 4,
  '59920000-0000-4000-8000-000000000712'
)::TEXT AS p109_file_archived
\gset
SELECT platform.archive_company_file_folder(
  :'p109_org_a', :'p109_folder_b_id', 1,
  '59920000-0000-4000-8000-000000000713'
)::TEXT AS p109_folder_archived
\gset
RESET ROLE;

SELECT pg_temp.p109_assert(
  :'p109_file_archived'::JSONB ->> 'archived_at' IS NOT NULL
    AND :'p109_folder_archived'::JSONB ->> 'archived_at' IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM platform.company_file_versions AS file_version
      WHERE file_version.id =
        (:'p109_reservation'::JSONB ->> 'company_file_version_id')::UUID
    )
    AND EXISTS (
      SELECT 1
      FROM storage.objects AS object
      WHERE object.bucket_id = 'platform-company-files'
        AND object.name = (:'p109_reservation'::JSONB ->> 'object_name')
    ),
  'metadata archive removed immutable version or private object history'
);

ROLLBACK;
