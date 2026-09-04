\set ON_ERROR_STOP on

-- Migration 109 isolated proof. All rows and Storage metadata are synthetic
-- and rolled back; no provider, managed project or production state is used.
BEGIN;

CREATE FUNCTION pg_temp.p109_assert(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 109 assertion failed: %', message;
  END IF;
END
$$;
CREATE FUNCTION pg_temp.p109_capture(statement text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false, 'sqlstate', SQLSTATE, 'message', SQLERRM
  );
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p109_assert(boolean, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p109_capture(text)
  TO anon, authenticated, service_role;

DO $catalog$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'platform.list_company_knowledge_folders()',
    'platform.list_company_knowledge_files()',
    'platform.create_company_knowledge_folder(uuid,text,uuid)',
    'platform.rename_company_knowledge_folder(uuid,text,bigint,uuid)',
    'platform.move_company_knowledge_folder(uuid,uuid,bigint,uuid)',
    'platform.remove_company_knowledge_folder(uuid,bigint,uuid)',
    'platform.rename_company_knowledge_file(uuid,text,bigint,uuid)',
    'platform.move_company_knowledge_file(uuid,uuid,bigint,uuid)',
    'platform.remove_company_knowledge_file(uuid,bigint,uuid)',
    'platform.reserve_company_knowledge_file_upload(uuid,uuid,text,text,bigint,text,uuid,bigint)',
    'platform.finalize_company_knowledge_file_upload(uuid)',
    'platform.grant_company_knowledge_file_download(uuid,uuid)',
    'platform.consume_company_knowledge_file_download_grant(uuid)'
  ] LOOP
    IF to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'Missing required function %', signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policies policy
    WHERE policy.schemaname = 'storage' AND policy.tablename = 'objects'
      AND (
        COALESCE(policy.qual, '') LIKE '%platform-knowledge-files%'
        OR COALESCE(policy.with_check, '') LIKE '%platform-knowledge-files%'
      )
  ) THEN
    RAISE EXCEPTION 'Company knowledge bucket must have no browser policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges privilege
    WHERE privilege.routine_schema = 'platform'
      AND privilege.routine_name IN (
        'finalize_company_knowledge_file_upload',
        'consume_company_knowledge_file_download_grant'
      )
      AND privilege.grantee NOT IN ('service_role', 'postgres')
  ) THEN
    RAISE EXCEPTION 'Service-only company file RPC leaked EXECUTE';
  END IF;
  IF NOT (
    'company.file.upload.finalize' = ANY(
      platform_private.p7a_safe_audit_actions()
    )
    AND 'company.file.download.consume' = ANY(
      platform_private.p7a_safe_audit_actions()
    )
    AND 'company_knowledge_folder' = ANY(
      platform_private.p7a_safe_audit_resource_types()
    )
    AND 'company_knowledge_file' = ANY(
      platform_private.p7a_safe_audit_resource_types()
    )
  ) THEN
    RAISE EXCEPTION 'Company file audit actions are not export-safe';
  END IF;
END
$catalog$;

\set org_a '59920000-0000-4000-8000-000000000001'
\set org_b '59920000-0000-4000-8000-000000000002'
\set admin_a_user '59920000-0000-4000-8000-000000000101'
\set curator_a_user '59920000-0000-4000-8000-000000000102'
\set sales_a_user '59920000-0000-4000-8000-000000000103'
\set admin_b_user '59920000-0000-4000-8000-000000000104'
\set admin_a_profile '59920000-0000-4000-8000-000000000201'
\set curator_a_profile '59920000-0000-4000-8000-000000000202'
\set sales_a_profile '59920000-0000-4000-8000-000000000203'
\set admin_b_profile '59920000-0000-4000-8000-000000000204'
\set admin_a_membership '59920000-0000-4000-8000-000000000301'
\set curator_a_membership '59920000-0000-4000-8000-000000000302'
\set sales_a_membership '59920000-0000-4000-8000-000000000303'
\set admin_b_membership '59920000-0000-4000-8000-000000000304'
\set org_a_scope '59920000-0000-4000-8000-000000000311'
\set org_b_scope '59920000-0000-4000-8000-000000000312'
\set file_a '59920000-0000-4000-8000-000000000401'
\set mismatch_file '59920000-0000-4000-8000-000000000402'

SELECT id AS admin_bundle, version AS admin_bundle_version
FROM platform.role_bundle_versions
WHERE role = 'admin' AND status = 'published'
ORDER BY version DESC LIMIT 1 \gset
SELECT id AS curator_bundle, version AS curator_bundle_version
FROM platform.role_bundle_versions
WHERE role = 'curator' AND status = 'published'
ORDER BY version DESC LIMIT 1 \gset
SELECT id AS sales_bundle, version AS sales_bundle_version
FROM platform.role_bundle_versions
WHERE role = 'sales' AND status = 'published'
ORDER BY version DESC LIMIT 1 \gset

INSERT INTO platform.organizations(id, name) VALUES
  (:'org_a', 'Migration 109 Organization A'),
  (:'org_b', 'Migration 109 Organization B');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  (:'admin_a_user', 'p109-admin-a@example.invalid', '{}'),
  (:'curator_a_user', 'p109-curator-a@example.invalid', '{}'),
  (:'sales_a_user', 'p109-sales-a@example.invalid', '{}'),
  (:'admin_b_user', 'p109-admin-b@example.invalid', '{}');
INSERT INTO platform.profiles(
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'admin_a_profile', :'admin_a_user', 'P109 Admin A', 'active', 1),
  (:'curator_a_profile', :'curator_a_user', 'P109 Admissions A', 'active', 1),
  (:'sales_a_profile', :'sales_a_user', 'P109 Sales A', 'active', 1),
  (:'admin_b_profile', :'admin_b_user', 'P109 Admin B', 'active', 1);
INSERT INTO platform.organization_memberships(
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (:'admin_a_membership', :'org_a', :'admin_a_profile', 'active', 'admin', :'admin_bundle'),
  (:'curator_a_membership', :'org_a', :'curator_a_profile', 'active', 'curator', :'curator_bundle'),
  (:'sales_a_membership', :'org_a', :'sales_a_profile', 'active', 'sales', :'sales_bundle'),
  (:'admin_b_membership', :'org_b', :'admin_b_profile', 'active', 'admin', :'admin_bundle');
INSERT INTO platform.record_scopes(
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'org_a_scope', :'org_a', 'organization', :'org_a', 1),
  (:'org_b_scope', :'org_b', 'organization', :'org_b', 1);
INSERT INTO platform.membership_scope_assignments(
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason,
  request_id
)
SELECT fixture.id, fixture.organization_id, fixture.membership_id,
  fixture.scope_id, 1, 1, true, 'system', NULL,
  'Migration 109 isolated organization scope', fixture.request_id
FROM (VALUES
  ('59920000-0000-4000-8000-000000000321'::uuid, :'org_a'::uuid,
    :'admin_a_membership'::uuid, :'org_a_scope'::uuid,
    '59920000-0000-4000-8000-000000000331'::uuid),
  ('59920000-0000-4000-8000-000000000322'::uuid, :'org_a'::uuid,
    :'curator_a_membership'::uuid, :'org_a_scope'::uuid,
    '59920000-0000-4000-8000-000000000332'::uuid),
  ('59920000-0000-4000-8000-000000000323'::uuid, :'org_a'::uuid,
    :'sales_a_membership'::uuid, :'org_a_scope'::uuid,
    '59920000-0000-4000-8000-000000000333'::uuid),
  ('59920000-0000-4000-8000-000000000324'::uuid, :'org_b'::uuid,
    :'admin_b_membership'::uuid, :'org_b_scope'::uuid,
    '59920000-0000-4000-8000-000000000334'::uuid)
) fixture(id, organization_id, membership_id, scope_id, request_id);

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'platform-knowledge-files', 'platform-knowledge-files', false, 26214400,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
) ON CONFLICT (id) DO NOTHING;

SELECT
  jsonb_build_object(
    'sub', :'admin_a_user', 'role', 'authenticated',
    'platform_role', 'admin', 'platform_access_version', 1,
    'platform_organization_id', :'org_a',
    'platform_membership_id', :'admin_a_membership',
    'platform_bundle_id', :'admin_bundle',
    'platform_bundle_version', :'admin_bundle_version'::integer
  )::text AS admin_a_claims,
  jsonb_build_object(
    'sub', :'curator_a_user', 'role', 'authenticated',
    'platform_role', 'curator', 'platform_access_version', 1,
    'platform_organization_id', :'org_a',
    'platform_membership_id', :'curator_a_membership',
    'platform_bundle_id', :'curator_bundle',
    'platform_bundle_version', :'curator_bundle_version'::integer
  )::text AS curator_a_claims,
  jsonb_build_object(
    'sub', :'sales_a_user', 'role', 'authenticated',
    'platform_role', 'sales', 'platform_access_version', 1,
    'platform_organization_id', :'org_a',
    'platform_membership_id', :'sales_a_membership',
    'platform_bundle_id', :'sales_bundle',
    'platform_bundle_version', :'sales_bundle_version'::integer
  )::text AS sales_a_claims,
  jsonb_build_object(
    'sub', :'admin_b_user', 'role', 'authenticated',
    'platform_role', 'admin', 'platform_access_version', 1,
    'platform_organization_id', :'org_b',
    'platform_membership_id', :'admin_b_membership',
    'platform_bundle_id', :'admin_bundle',
    'platform_bundle_version', :'admin_bundle_version'::integer
  )::text AS admin_b_claims
\gset

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT platform.create_company_knowledge_folder(
  NULL, 'Operations', '59920000-0000-4000-8000-000000000501'
)::text AS root_create \gset
SELECT platform.create_company_knowledge_folder(
  (:'root_create'::jsonb ->> 'folder_id')::uuid, 'Policies',
  '59920000-0000-4000-8000-000000000502'
)::text AS child_create \gset
SELECT platform.create_company_knowledge_folder(
  NULL, 'Operations', '59920000-0000-4000-8000-000000000501'
)::text AS root_replay \gset
SELECT pg_temp.p109_assert(
  :'root_create'::jsonb = :'root_replay'::jsonb,
  'exact folder request replay must return the first receipt'
);
SELECT pg_temp.p109_capture($sql$
  SELECT platform.create_company_knowledge_folder(
    NULL, 'Changed', '59920000-0000-4000-8000-000000000501'
  )
$sql$)::text AS replay_mismatch \gset
SELECT pg_temp.p109_assert(
  :'replay_mismatch'::jsonb ->> 'sqlstate' = '23505',
  'changed-payload replay must fail'
);
SELECT pg_temp.p109_capture(format(
  'SELECT platform.move_company_knowledge_folder(%L::uuid,%L::uuid,1,%L::uuid)',
  :'root_create'::jsonb ->> 'folder_id',
  :'child_create'::jsonb ->> 'folder_id',
  '59920000-0000-4000-8000-000000000503'
))::text AS cycle_error \gset
SELECT pg_temp.p109_assert(
  :'cycle_error'::jsonb ->> 'sqlstate' = '22023',
  'folder cycles must fail'
);
SELECT pg_temp.p109_capture(format(
  'SELECT platform.remove_company_knowledge_folder(%L::uuid,1,%L::uuid)',
  :'root_create'::jsonb ->> 'folder_id',
  '59920000-0000-4000-8000-000000000504'
))::text AS nonempty_error \gset
SELECT pg_temp.p109_assert(
  :'nonempty_error'::jsonb ->> 'sqlstate' = '23503',
  'nonempty folder removal must fail'
);
SELECT pg_temp.p109_capture(format(
  'SELECT platform.rename_company_knowledge_folder(%L::uuid,%L,99,%L::uuid)',
  :'root_create'::jsonb ->> 'folder_id', 'Wrong Version',
  '59920000-0000-4000-8000-000000000505'
))::text AS folder_conflict \gset
SELECT pg_temp.p109_assert(
  :'folder_conflict'::jsonb ->> 'sqlstate' = 'PT409',
  'folder optimistic conflict must fail'
);

SELECT platform.reserve_company_knowledge_file_upload(
  (:'child_create'::jsonb ->> 'folder_id')::uuid, :'file_a', 'Guide.pdf',
  'application/pdf', 4, repeat('a', 64),
  '59920000-0000-4000-8000-000000000506', NULL
)::text AS reservation \gset
SELECT platform.reserve_company_knowledge_file_upload(
  (:'child_create'::jsonb ->> 'folder_id')::uuid, :'file_a', 'Guide.pdf',
  'application/pdf', 4, repeat('a', 64),
  '59920000-0000-4000-8000-000000000506', NULL
)::text AS reservation_replay \gset
SELECT pg_temp.p109_assert(
  :'reservation'::jsonb = :'reservation_replay'::jsonb,
  'exact upload reservation replay must return the first receipt'
);
SELECT pg_temp.p109_capture($sql$
  SELECT platform.reserve_company_knowledge_file_upload(
    NULL, '59920000-0000-4000-8000-000000000401', 'Guide.pdf',
    'application/pdf', 5, repeat('a', 64),
    '59920000-0000-4000-8000-000000000506', NULL
  )
$sql$)::text AS reserve_mismatch \gset
SELECT pg_temp.p109_assert(
  :'reserve_mismatch'::jsonb ->> 'sqlstate' = '23505',
  'changed upload replay payload must fail'
);
SELECT pg_temp.p109_capture(format(
  'INSERT INTO storage.objects(bucket_id,name,metadata) VALUES (%L,%L,%L::jsonb)',
  'platform-knowledge-files', repeat('f', 64),
  '{"size":4,"mimetype":"application/pdf"}'
))::text AS browser_storage_insert \gset
SELECT pg_temp.p109_assert(
  :'browser_storage_insert'::jsonb ->> 'sqlstate' = '42501',
  'authenticated browser Storage insert must remain denied'
);
SELECT pg_temp.p109_capture(format(
  'SELECT platform.finalize_company_knowledge_file_upload(%L::uuid)',
  :'reservation'::jsonb ->> 'reservation_id'
))::text AS browser_finalize \gset
SELECT pg_temp.p109_assert(
  :'browser_finalize'::jsonb ->> 'sqlstate' = '42501',
  'authenticated caller must not finalize Storage'
);
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.p109_capture(format(
  'SELECT platform.finalize_company_knowledge_file_upload(%L::uuid)',
  :'reservation'::jsonb ->> 'reservation_id'
))::text AS missing_object \gset
SELECT pg_temp.p109_assert(
  :'missing_object'::jsonb ->> 'sqlstate' = '55000',
  'finalization without the exact Storage object must fail closed'
);
RESET ROLE;
RESET request.jwt.claims;

INSERT INTO storage.objects(bucket_id, name, metadata, created_at) VALUES (
  'platform-knowledge-files', :'reservation'::jsonb ->> 'object_name',
  jsonb_build_object(
    'size', 4, 'mimetype', 'application/pdf',
    'metadata', jsonb_build_object('sha256', repeat('a', 64))
  ), statement_timestamp()
);
SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.finalize_company_knowledge_file_upload(
  (:'reservation'::jsonb ->> 'reservation_id')::uuid
)::text AS finalization \gset
SELECT platform.finalize_company_knowledge_file_upload(
  (:'reservation'::jsonb ->> 'reservation_id')::uuid
)::text AS finalization_replay \gset
SELECT pg_temp.p109_assert(
  :'finalization'::jsonb = :'finalization_replay'::jsonb,
  'upload finalization must be idempotent by reservation'
);
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p109_assert(
  (SELECT count(*) = 1 FROM platform.list_company_knowledge_files()),
  'Admissions must see the finalized company file'
);
SELECT platform.rename_company_knowledge_file(
  :'file_a', 'Guide 2027.pdf', 1,
  '59920000-0000-4000-8000-000000000507'
)::text AS renamed_file \gset
SELECT platform.move_company_knowledge_file(
  :'file_a', (:'root_create'::jsonb ->> 'folder_id')::uuid, 2,
  '59920000-0000-4000-8000-000000000508'
)::text AS moved_file \gset
SELECT pg_temp.p109_capture(format(
  'SELECT platform.rename_company_knowledge_file(%L::uuid,%L,1,%L::uuid)',
  :'file_a', 'Stale.pdf', '59920000-0000-4000-8000-000000000509'
))::text AS file_conflict \gset
SELECT pg_temp.p109_assert(
  :'file_conflict'::jsonb ->> 'sqlstate' = 'PT409',
  'file optimistic conflict must fail'
);
SELECT platform.grant_company_knowledge_file_download(
  (:'finalization'::jsonb ->> 'file_version_id')::uuid,
  '59920000-0000-4000-8000-000000000510'
)::text AS grant_one \gset
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.consume_company_knowledge_file_download_grant(
  (:'grant_one'::jsonb ->> 'grant_id')::uuid
)::text AS consumption \gset
SELECT pg_temp.p109_capture(format(
  'SELECT platform.consume_company_knowledge_file_download_grant(%L::uuid)',
  :'grant_one'::jsonb ->> 'grant_id'
))::text AS second_consume \gset
SELECT pg_temp.p109_assert(
  :'second_consume'::jsonb ->> 'sqlstate' = '23505',
  'download grant must be one-time'
);
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT platform.grant_company_knowledge_file_download(
  (:'finalization'::jsonb ->> 'file_version_id')::uuid,
  '59920000-0000-4000-8000-000000000511'
)::text AS grant_two \gset
SELECT platform.remove_company_knowledge_file(
  :'file_a', 3, '59920000-0000-4000-8000-000000000512'
)::text AS removed_file \gset
SELECT pg_temp.p109_assert(
  (SELECT count(*) = 0 FROM platform.list_company_knowledge_files()),
  'removed company file must disappear from active list'
);
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.p109_capture(format(
  'SELECT platform.consume_company_knowledge_file_download_grant(%L::uuid)',
  :'grant_two'::jsonb ->> 'grant_id'
))::text AS removed_consume \gset
SELECT pg_temp.p109_assert(
  :'removed_consume'::jsonb ->> 'sqlstate' = '42501',
  'removal must make immutable bytes inaccessible'
);
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p109_capture(
  'SELECT * FROM platform.list_company_knowledge_folders()'
)::text AS sales_list \gset
SELECT pg_temp.p109_capture($sql$
  SELECT platform.create_company_knowledge_folder(
    NULL, 'Sales denied', '59920000-0000-4000-8000-000000000513'
  )
$sql$)::text AS sales_create \gset
SELECT pg_temp.p109_assert(
  :'sales_list'::jsonb ->> 'sqlstate' = '42501'
    AND :'sales_create'::jsonb ->> 'sqlstate' = '42501',
  'Sales must have no company file authority'
);
SELECT pg_temp.p109_capture('SELECT * FROM platform.company_knowledge_files')
  ::text AS direct_table \gset
SELECT pg_temp.p109_assert(
  :'direct_table'::jsonb ->> 'sqlstate' = '42501',
  'browser must have no direct table privilege'
);
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.p109_assert(
  (SELECT count(*) = 0 FROM platform.list_company_knowledge_folders()),
  'other organization must not see folders'
);
SELECT platform.create_company_knowledge_folder(
  NULL, 'Admin B Workspace',
  '59920000-0000-4000-8000-000000000515'
)::text AS admin_b_folder \gset
SELECT pg_temp.p109_assert(
  :'admin_b_folder'::jsonb ->> 'organization_id' = :'org_b',
  'Admin must have full company knowledge authority in its organization'
);
SELECT pg_temp.p109_capture(format(
  'SELECT platform.rename_company_knowledge_folder(%L::uuid,%L,1,%L::uuid)',
  :'root_create'::jsonb ->> 'folder_id', 'Cross org denied',
  '59920000-0000-4000-8000-000000000514'
))::text AS cross_org \gset
SELECT pg_temp.p109_assert(
  :'cross_org'::jsonb ->> 'sqlstate' = '42501',
  'cross-organization mutation must converge on unavailable'
);
RESET ROLE;
RESET request.jwt.claims;

SET ROLE anon;
SELECT pg_temp.p109_capture(
  'SELECT * FROM platform.list_company_knowledge_folders()'
)::text AS anon_list \gset
SELECT pg_temp.p109_assert(
  :'anon_list'::jsonb ->> 'sqlstate' = '42501',
  'anon must not execute company knowledge reads'
);
RESET ROLE;

SELECT pg_temp.p109_capture($sql$
  UPDATE platform_private.company_knowledge_command_receipts
  SET response = '{}'::jsonb
  WHERE request_id = '59920000-0000-4000-8000-000000000501'
$sql$)::text AS receipt_mutation \gset
SELECT pg_temp.p109_capture(format(
  'UPDATE platform.company_knowledge_file_versions SET byte_size=5 WHERE id=%L::uuid',
  :'finalization'::jsonb ->> 'file_version_id'
))::text AS version_mutation \gset
SELECT pg_temp.p109_assert(
  :'receipt_mutation'::jsonb ->> 'sqlstate' = '55000'
    AND :'version_mutation'::jsonb ->> 'sqlstate' = '55000',
  'command receipts and file versions must be append-only'
);
SELECT pg_temp.p109_assert(
  EXISTS (
    SELECT 1 FROM platform.company_knowledge_file_versions version
    WHERE version.id = (:'finalization'::jsonb ->> 'file_version_id')::uuid
  ) AND EXISTS (
    SELECT 1 FROM storage.objects object
    WHERE object.bucket_id = 'platform-knowledge-files'
      AND object.name = :'reservation'::jsonb ->> 'object_name'
  ),
  'soft removal must preserve immutable private history'
);

ROLLBACK;
