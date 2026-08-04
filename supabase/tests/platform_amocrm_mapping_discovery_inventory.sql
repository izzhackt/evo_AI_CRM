\set ON_ERROR_STOP on

-- P4A schema, ownership, RLS and ACL inventory at migration 058.
DO $$
DECLARE
  target_table CONSTANT REGCLASS :=
    'platform_private.amocrm_mapping_discovery_versions'::REGCLASS;
  persist_rpc CONSTANT REGPROCEDURE :=
    'platform.persist_amocrm_mapping_discovery(uuid,bigint,text,text,jsonb,text,text,timestamp with time zone,uuid)'::REGPROCEDURE;
  admin_rpc CONSTANT REGPROCEDURE :=
    'platform.admin_amocrm_mapping_discovery_versions(uuid,bigint,bigint)'::REGPROCEDURE;
  safe_helper CONSTANT REGPROCEDURE :=
    'platform_private.amocrm_mapping_json_is_safe(jsonb)'::REGPROCEDURE;
  snapshot_helper CONSTANT REGPROCEDURE :=
    'platform_private.amocrm_mapping_snapshot_is_valid(jsonb,bigint,text,text)'::REGPROCEDURE;
  checked_role TEXT;
  checked_privilege TEXT;
  checked_routine REGPROCEDURE;
  persist_definition TEXT;
  validator_definition TEXT;
  request_lock_position INTEGER;
  account_lock_position INTEGER;
  version_allocation_position INTEGER;
  insert_position INTEGER;
  expected_columns TEXT[] := ARRAY[
    'id:uuid:not-null',
    'organization_id:uuid:not-null',
    'amocrm_account_id:bigint:not-null',
    'account_domain:text:not-null',
    'account_subdomain:text:not-null',
    'version:bigint:not-null',
    'snapshot_schema_version:integer:not-null',
    'sanitized_snapshot:jsonb:not-null',
    'snapshot_sha256:text:not-null',
    'evidence_kind:text:not-null',
    'evidence_ref:text:not-null',
    'request_id:uuid:not-null',
    'discovered_at:timestamp with time zone:not-null',
    'created_at:timestamp with time zone:not-null'
  ];
  actual_columns TEXT[];
  expected_result_names TEXT[] := ARRAY[
    'discovery_version_id',
    'organization_id',
    'amocrm_account_id',
    'account_domain',
    'account_subdomain',
    'version',
    'snapshot_schema_version',
    'sanitized_snapshot',
    'snapshot_sha256',
    'evidence_kind',
    'evidence_ref',
    'request_id',
    'discovered_at',
    'created_at'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid = target_table
      AND namespace.nspname = 'platform_private'
      AND relation.relname = 'amocrm_mapping_discovery_versions'
      AND relation.relkind = 'r'
      AND relation.relpersistence = 'p'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
      AND owner_role.rolname = 'postgres'
  ) THEN
    RAISE EXCEPTION 'P4A private table owner/RLS contract drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid = target_table
  ) THEN
    RAISE EXCEPTION 'P4A private table unexpectedly has an RLS policy';
  END IF;

  SELECT pg_catalog.array_agg(
    attribute.attname
      || ':'
      || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      || ':'
      || CASE WHEN attribute.attnotnull THEN 'not-null' ELSE 'nullable' END
    ORDER BY attribute.attnum
  )
  INTO actual_columns
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = target_table
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF actual_columns IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION 'P4A table column contract drifted: %', actual_columns;
  END IF;

  IF (
    SELECT pg_get_expr(attribute.adbin, attribute.adrelid)
    FROM pg_attrdef AS attribute
    JOIN pg_attribute AS column_record
      ON column_record.attrelid = attribute.adrelid
      AND column_record.attnum = attribute.adnum
    WHERE attribute.adrelid = target_table
      AND column_record.attname = 'id'
  ) NOT LIKE '%gen_random_uuid%'
    OR (
      SELECT pg_get_expr(attribute.adbin, attribute.adrelid)
      FROM pg_attrdef AS attribute
      JOIN pg_attribute AS column_record
        ON column_record.attrelid = attribute.adrelid
        AND column_record.attnum = attribute.adnum
      WHERE attribute.adrelid = target_table
        AND column_record.attname = 'snapshot_schema_version'
    ) IS DISTINCT FROM '1'
    OR (
      SELECT pg_get_expr(attribute.adbin, attribute.adrelid)
      FROM pg_attrdef AS attribute
      JOIN pg_attribute AS column_record
        ON column_record.attrelid = attribute.adrelid
        AND column_record.attnum = attribute.adnum
      WHERE attribute.adrelid = target_table
        AND column_record.attname = 'created_at'
    ) NOT LIKE '%statement_timestamp%'
  THEN
    RAISE EXCEPTION 'P4A table defaults drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.contype = 'f'
      AND constraint_record.confrelid = 'platform.organizations'::REGCLASS
      AND constraint_record.confdeltype = 'r'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.conname =
        'amocrm_mapping_discovery_versions_organization_id_id_key'
      AND constraint_record.contype = 'u'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.conname =
        'amocrm_mapping_discovery_versions_org_account_version_key'
      AND constraint_record.contype = 'u'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.conname =
        'amocrm_mapping_discovery_versions_request_id_key'
      AND constraint_record.contype = 'u'
  ) THEN
    RAISE EXCEPTION 'P4A FK or immutable stream uniqueness drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_index AS index_record
    WHERE index_record.indrelid = target_table
      AND index_record.indisunique
      AND pg_get_indexdef(index_record.indexrelid) LIKE '%snapshot_sha256%'
  ) THEN
    RAISE EXCEPTION 'P4A snapshot hash was incorrectly made unique';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.contype = 'c'
      AND pg_get_constraintdef(constraint_record.oid)
        LIKE '%amocrm_mapping_snapshot_is_valid%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.contype = 'c'
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%.amocrm.ru%'
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%.kommo.com%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = target_table
      AND constraint_record.contype = 'c'
      AND pg_get_constraintdef(constraint_record.oid)
        LIKE '%local_non_provider%'
      AND pg_get_constraintdef(constraint_record.oid)
        LIKE '%provider_observed%'
  ) THEN
    RAISE EXCEPTION 'P4A snapshot/domain/evidence checks drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
      trigger_record.tgname::TEXT ORDER BY trigger_record.tgname
    )
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = target_table
      AND NOT trigger_record.tgisinternal
  ) IS DISTINCT FROM ARRAY[
    'amocrm_mapping_discovery_versions_append_only_rows',
    'amocrm_mapping_discovery_versions_no_truncate'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'P4A append-only trigger inventory drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = target_table
      AND trigger_record.tgname =
        'amocrm_mapping_discovery_versions_append_only_rows'
      AND trigger_record.tgfoid =
        'platform_private.block_append_only_mutation()'::REGPROCEDURE
      AND trigger_record.tgtype = 27
      AND trigger_record.tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = target_table
      AND trigger_record.tgname =
        'amocrm_mapping_discovery_versions_no_truncate'
      AND trigger_record.tgfoid =
        'platform_private.block_append_only_mutation()'::REGPROCEDURE
      AND trigger_record.tgtype = 34
      AND trigger_record.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'P4A append-only trigger behavior drifted';
  END IF;

  FOREACH checked_privilege IN ARRAY ARRAY[
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER'
  ] LOOP
    FOREACH checked_role IN ARRAY ARRAY[
      'anon',
      'authenticated',
      'service_role',
      'supabase_auth_admin'
    ] LOOP
      IF has_table_privilege(
        checked_role,
        target_table,
        checked_privilege
      ) THEN
        RAISE EXCEPTION 'P4A table leaked % to %',
          checked_privilege, checked_role;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    CROSS JOIN LATERAL aclexplode(
      COALESCE(relation.relacl, acldefault('r', relation.relowner))
    ) AS privilege
    WHERE relation.oid = target_table
      AND privilege.grantee = 0
  ) THEN
    RAISE EXCEPTION 'P4A table leaked a privilege to PUBLIC';
  END IF;

  FOREACH checked_routine IN ARRAY ARRAY[safe_helper, snapshot_helper] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS routine
      JOIN pg_roles AS owner_role ON owner_role.oid = routine.proowner
      WHERE routine.oid = checked_routine
        AND owner_role.rolname = 'postgres'
        AND NOT routine.prosecdef
        AND routine.provolatile = 'i'
        AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
    ) THEN
      RAISE EXCEPTION 'P4A validator % hardening drifted', checked_routine;
    END IF;

    FOREACH checked_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(checked_role, checked_routine, 'EXECUTE') THEN
        RAISE EXCEPTION 'P4A validator % leaked EXECUTE to %',
          checked_routine, checked_role;
      END IF;
    END LOOP;
  END LOOP;

  SELECT pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(snapshot_helper)),
    '[[:space:]]+',
    '',
    'g'
  )
  INTO validator_definition;

  IF pg_catalog.strpos(
    validator_definition,
    $needle$nested_keysisdistinctfromarray['id','is_archive','is_main','name','statuses']::text[]$needle$
  ) = 0
    OR pg_catalog.strpos(
      validator_definition,
      $needle$nested_keysisdistinctfromarray['id','is_editable','name','sort','type']::text[]$needle$
    ) = 0
    OR pg_catalog.strpos(
      validator_definition,
      $needle$nested_keysisdistinctfromarray['id','is_active','name']::text[]$needle$
    ) = 0
    OR pg_catalog.strpos(
      validator_definition,
      $needle$nested_keysisdistinctfromarray['code','enums','id','name','type']::text[]$needle$
    ) = 0
    OR pg_catalog.strpos(
      validator_definition,
      $needle$nested_keysisdistinctfromarray['id','sort','value']::text[]$needle$
    ) = 0
    OR pg_catalog.strpos(
      validator_definition,
      $needle$jsonb_typeof(pipeline_entry.value->'id')<>'string'$needle$
    ) = 0
    OR pg_catalog.strpos(
      validator_definition,
      $needle$jsonb_typeof(status_entry.value->'sort')<>'number'$needle$
    ) = 0
    OR pg_catalog.strpos(
      validator_definition,
      $needle$jsonb_typeof(custom_field_entry.value->'enums')<>'array'$needle$
    ) = 0
  THEN
    RAISE EXCEPTION 'P4A canonical nested allowlist/type validation drifted';
  END IF;

  SELECT pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(safe_helper)),
    '[[:space:]]+',
    '',
    'g'
  )
  INTO validator_definition;

  IF pg_catalog.strpos(validator_definition, $needle$'accesstoken'$needle$) = 0
    OR pg_catalog.strpos(validator_definition, $needle$'refreshtoken'$needle$) = 0
    OR pg_catalog.strpos(validator_definition, $needle$'clientsecret'$needle$) = 0
    OR pg_catalog.strpos(validator_definition, $needle$regexp_replace($needle$) = 0
  THEN
    RAISE EXCEPTION 'P4A normalized secret-key rejection drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    JOIN pg_roles AS owner_role ON owner_role.oid = routine.proowner
    WHERE routine.oid = persist_rpc
      AND owner_role.rolname = 'postgres'
      AND routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND routine.pronargdefaults = 0
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    JOIN pg_roles AS owner_role ON owner_role.oid = routine.proowner
    WHERE routine.oid = admin_rpc
      AND owner_role.rolname = 'postgres'
      AND routine.prosecdef
      AND routine.provolatile = 's'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND routine.pronargdefaults = 1
  ) THEN
    RAISE EXCEPTION 'P4A public RPC owner/security/search_path drifted';
  END IF;

  IF NOT has_function_privilege('service_role', persist_rpc, 'EXECUTE')
    OR has_function_privilege('anon', persist_rpc, 'EXECUTE')
    OR has_function_privilege('authenticated', persist_rpc, 'EXECUTE')
    OR has_function_privilege('supabase_auth_admin', persist_rpc, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'P4A persist RPC EXECUTE ACL drifted';
  END IF;

  IF NOT has_function_privilege('authenticated', admin_rpc, 'EXECUTE')
    OR has_function_privilege('anon', admin_rpc, 'EXECUTE')
    OR has_function_privilege('service_role', admin_rpc, 'EXECUTE')
    OR has_function_privilege('supabase_auth_admin', admin_rpc, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'P4A Admin read RPC EXECUTE ACL drifted';
  END IF;

  FOREACH checked_routine IN ARRAY ARRAY[
    safe_helper, snapshot_helper, persist_rpc, admin_rpc
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_proc AS routine
      CROSS JOIN LATERAL aclexplode(
        COALESCE(routine.proacl, acldefault('f', routine.proowner))
      ) AS privilege
      WHERE routine.oid = checked_routine
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'P4A routine % leaked EXECUTE to PUBLIC',
        checked_routine;
    END IF;
  END LOOP;

  IF (
    SELECT routine.proargnames[10:23]
    FROM pg_proc AS routine
    WHERE routine.oid = persist_rpc
  ) IS DISTINCT FROM expected_result_names
    OR (
      SELECT routine.proargnames[4:17]
      FROM pg_proc AS routine
      WHERE routine.oid = admin_rpc
    ) IS DISTINCT FROM expected_result_names
  THEN
    RAISE EXCEPTION 'P4A RPC result aliases drifted';
  END IF;

  IF (
    SELECT pg_get_expr(routine.proargdefaults, 0)
    FROM pg_proc AS routine
    WHERE routine.oid = admin_rpc
  ) IS DISTINCT FROM 'NULL::bigint' THEN
    RAISE EXCEPTION 'P4A Admin latest-version default drifted';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(persist_rpc)
  INTO persist_definition;
  request_lock_position := pg_catalog.strpos(
    persist_definition,
    'evo:p4a:amocrm-mapping-request:'
  );
  account_lock_position := pg_catalog.strpos(
    persist_definition,
    'evo:p4a:amocrm-mapping-account:'
  );
  version_allocation_position := pg_catalog.strpos(
    persist_definition,
    'SELECT COALESCE(MAX(candidate.version), 0) + 1'
  );
  insert_position := pg_catalog.strpos(
    persist_definition,
    'INSERT INTO platform_private.amocrm_mapping_discovery_versions ('
  );
  IF request_lock_position = 0
    OR account_lock_position = 0
    OR version_allocation_position = 0
    OR insert_position = 0
    OR request_lock_position >= account_lock_position
    OR account_lock_position >= version_allocation_position
    OR version_allocation_position >= insert_position
  THEN
    RAISE EXCEPTION
      'P4A request/account lock and version allocation order drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.permission_definitions AS permission
    WHERE permission.permission_key LIKE '%amocrm%'
      OR permission.permission_key LIKE '%mapping.discovery%'
  ) OR EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions AS bundle
    WHERE bundle.version > 11
  ) THEN
    RAISE EXCEPTION 'P4A incorrectly introduced RBAC permission/bundle state';
  END IF;
END
$$;

SELECT 'platform amoCRM mapping discovery inventory passed' AS result;
