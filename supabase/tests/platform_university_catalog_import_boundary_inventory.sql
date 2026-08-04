\set ON_ERROR_STOP on

-- BW5 catalog, ACL and API inventory at the exact migration-056 boundary.
DO $$
DECLARE
  checked_table_name TEXT;
  checked_relation REGCLASS;
  checked_role TEXT;
  checked_routine REGPROCEDURE;
  routine_signature TEXT;
  authenticated_routines REGPROCEDURE[] := ARRAY[
    'platform.create_catalog_import_batch(uuid,uuid,platform.catalog_institution_kind,text,uuid)'::REGPROCEDURE,
    'platform.stage_catalog_import_candidate(uuid,uuid,text,text,text,text,text,uuid)'::REGPROCEDURE,
    'platform.validate_catalog_import_batch(uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.review_catalog_import_batch(uuid,uuid,platform.catalog_import_review_decision,text,uuid)'::REGPROCEDURE,
    'platform.create_catalog_university_application(uuid,uuid,uuid,text,platform.application_status,text,text,uuid)'::REGPROCEDURE,
    'platform.staff_catalog_institutions()'::REGPROCEDURE,
    'platform.admin_catalog_sources()'::REGPROCEDURE,
    'platform.admin_catalog_import_batches()'::REGPROCEDURE,
    'platform.admin_catalog_import_candidates(uuid)'::REGPROCEDURE
  ];
BEGIN
  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'catalog_institution_kind'
  ) IS DISTINCT FROM ARRAY['university', 'college']::NAME[] THEN
    RAISE EXCEPTION 'BW5 institution kind enum drifted';
  END IF;

  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'catalog_import_status'
  ) IS DISTINCT FROM ARRAY[
    'staging', 'validated', 'approved', 'rejected'
  ]::NAME[] THEN
    RAISE EXCEPTION 'BW5 import status enum drifted';
  END IF;

  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'catalog_candidate_validation_status'
  ) IS DISTINCT FROM ARRAY['pending', 'valid', 'invalid']::NAME[] THEN
    RAISE EXCEPTION 'BW5 candidate validation enum drifted';
  END IF;

  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'catalog_import_review_decision'
  ) IS DISTINCT FROM ARRAY['approve', 'reject']::NAME[] THEN
    RAISE EXCEPTION 'BW5 review decision enum drifted';
  END IF;

  FOREACH checked_table_name IN ARRAY ARRAY[
    'catalog_import_batches',
    'catalog_institutions',
    'catalog_import_candidates'
  ] LOOP
    checked_relation := format('platform.%I', checked_table_name)::REGCLASS;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS relation
      JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
      WHERE relation.oid = checked_relation
        AND relation.relkind = 'r'
        AND owner_role.rolname = 'postgres'
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION
        'BW5 platform.% must be postgres-owned with forced RLS',
        checked_table_name;
    END IF;

    IF (
      SELECT count(*)
      FROM pg_policy AS policy
      WHERE policy.polrelid = checked_relation
    ) <> 1 OR EXISTS (
      SELECT 1
      FROM pg_policy AS policy
      WHERE policy.polrelid = checked_relation
        AND policy.polcmd <> 'r'
    ) THEN
      RAISE EXCEPTION 'BW5 platform.% must expose SELECT only', checked_table_name;
    END IF;

    IF NOT has_table_privilege('authenticated', checked_relation, 'SELECT')
      OR has_table_privilege('authenticated', checked_relation, 'INSERT')
      OR has_table_privilege('authenticated', checked_relation, 'UPDATE')
      OR has_table_privilege('authenticated', checked_relation, 'DELETE')
      OR has_table_privilege('authenticated', checked_relation, 'TRUNCATE')
    THEN
      RAISE EXCEPTION 'BW5 platform.% authenticated ACL drifted', checked_table_name;
    END IF;

    FOREACH checked_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_table_privilege(checked_role, checked_relation, 'SELECT')
        OR has_table_privilege(checked_role, checked_relation, 'INSERT')
        OR has_table_privilege(checked_role, checked_relation, 'UPDATE')
        OR has_table_privilege(checked_role, checked_relation, 'DELETE')
        OR has_table_privilege(checked_role, checked_relation, 'TRUNCATE')
      THEN
        RAISE EXCEPTION
          'BW5 platform.% leaked table privilege to %',
          checked_table_name,
          checked_role;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    JOIN pg_type AS attribute_type ON attribute_type.oid = attribute.atttypid
    WHERE attribute.attrelid IN (
      'platform.catalog_import_batches'::REGCLASS,
      'platform.catalog_institutions'::REGCLASS,
      'platform.catalog_import_candidates'::REGCLASS
    )
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND (
        attribute_type.typname IN ('json', 'jsonb', 'bytea')
        OR attribute.attname ~ '(raw|payload|customer|personal|pii)'
      )
  ) THEN
    RAISE EXCEPTION 'BW5 catalog relations contain a raw payload or customer-data field';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'platform.university_applications'::REGCLASS
      AND attribute.attname = 'catalog_institution_id'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND NOT attribute.attnotnull
      AND attribute.atttypid = 'uuid'::REGTYPE
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
        'platform.university_applications'::REGCLASS
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'platform.catalog_institutions'::REGCLASS
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    WHERE index_row.indrelid = 'platform.university_applications'::REGCLASS
      AND pg_get_indexdef(index_row.indexrelid) LIKE
        '%catalog_institution_id%'
  ) THEN
    RAISE EXCEPTION 'BW5 application catalog link, FK or index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'platform.catalog_import_batches'::REGCLASS
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'platform.source_registry'::REGCLASS
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'platform.catalog_institutions'::REGCLASS
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'platform.catalog_import_batches'::REGCLASS
      AND array_length(constraint_row.conkey, 1) = 5
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'platform.catalog_institutions'::REGCLASS
      AND constraint_row.contype = 'u'
      AND constraint_row.conname = 'catalog_institutions_source_record_key'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class AS index_relation
    WHERE index_relation.relname = 'catalog_institutions_normalized_key'
      AND index_relation.relkind = 'i'
  ) THEN
    RAISE EXCEPTION 'BW5 exact provenance or uniqueness contract is missing';
  END IF;

  IF (
    SELECT pg_get_expr(policy.polqual, policy.polrelid)
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'platform.catalog_institutions'::REGCLASS
  ) NOT LIKE '%catalog.read%' THEN
    RAISE EXCEPTION 'BW5 approved catalog RLS lacks live catalog.read';
  END IF;

  FOREACH checked_relation IN ARRAY ARRAY[
    'platform.catalog_import_batches'::REGCLASS,
    'platform.catalog_import_candidates'::REGCLASS
  ] LOOP
    IF NOT (
      SELECT pg_get_expr(policy.polqual, policy.polrelid)
      FROM pg_policy AS policy
      WHERE policy.polrelid = checked_relation
    ) LIKE '%catalog.import.manage%'
      OR NOT (
        SELECT pg_get_expr(policy.polqual, policy.polrelid)
        FROM pg_policy AS policy
        WHERE policy.polrelid = checked_relation
      ) LIKE '%platform_has_scope%'
    THEN
      RAISE EXCEPTION 'BW5 import RLS lacks Admin permission or organization scope';
    END IF;
  END LOOP;

  FOREACH checked_routine IN ARRAY authenticated_routines LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS routine
      JOIN pg_roles AS owner_role ON owner_role.oid = routine.proowner
      WHERE routine.oid = checked_routine
        AND owner_role.rolname = 'postgres'
        AND routine.prosecdef
        AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
    ) THEN
      RAISE EXCEPTION 'BW5 routine % lacks owner/security/search_path hardening', checked_routine;
    END IF;

    IF NOT has_function_privilege('authenticated', checked_routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'BW5 routine % is not executable by authenticated', checked_routine;
    END IF;
    FOREACH checked_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(checked_role, checked_routine, 'EXECUTE') THEN
        RAISE EXCEPTION 'BW5 routine % leaked EXECUTE to %', checked_routine, checked_role;
      END IF;
    END LOOP;
  END LOOP;

  IF (
    SELECT routine.proargnames
    FROM pg_proc AS routine
    WHERE routine.oid = 'platform.staff_catalog_institutions()'::REGPROCEDURE
  ) IS DISTINCT FROM ARRAY[
    'organization_id', 'catalog_institution_id', 'institution_kind',
    'institution_name', 'country_code', 'city', 'source_registry_id',
    'source_revision', 'import_batch_id', 'approved_at'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW5 staff catalog result column contract drifted';
  END IF;

  IF (
    SELECT routine.proargnames
    FROM pg_proc AS routine
    WHERE routine.oid = 'platform.admin_catalog_sources()'::REGPROCEDURE
  ) IS DISTINCT FROM ARRAY[
    'organization_id', 'source_registry_id', 'source_kind', 'source_url',
    'source_revision', 'review_status', 'created_at', 'reviewed_at'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW5 Admin source result column contract drifted';
  END IF;

  IF (
    SELECT routine.proargnames
    FROM pg_proc AS routine
    WHERE routine.oid = 'platform.admin_catalog_import_batches()'::REGPROCEDURE
  ) IS DISTINCT FROM ARRAY[
    'organization_id', 'catalog_import_batch_id', 'source_registry_id',
    'source_kind', 'source_url', 'source_revision', 'institution_kind',
    'status', 'candidate_count', 'valid_candidate_count',
    'invalid_candidate_count', 'created_at', 'validated_at', 'reviewed_at',
    'review_reason'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW5 Admin batch result column contract drifted';
  END IF;

  IF (
    SELECT routine.proargnames
    FROM pg_proc AS routine
    WHERE routine.oid =
      'platform.admin_catalog_import_candidates(uuid)'::REGPROCEDURE
  ) IS DISTINCT FROM ARRAY[
    'p_catalog_import_batch_id', 'organization_id',
    'catalog_import_candidate_id', 'catalog_import_batch_id',
    'source_record_key', 'institution_name', 'country_code', 'city',
    'validation_status', 'validation_errors', 'catalog_institution_id',
    'created_at'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW5 Admin candidate result column contract drifted';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.role_bundle_versions AS bundle
    WHERE bundle.version = 10
      AND bundle.status = 'published'
  ) <> 5 THEN
    RAISE EXCEPTION 'BW5 must publish exactly five v10 bundles';
  END IF;

  IF EXISTS (
    VALUES
      ('admin'::platform.business_role, 'catalog.read'::TEXT),
      ('admin'::platform.business_role, 'catalog.import.manage'::TEXT),
      ('sales'::platform.business_role, 'catalog.read'::TEXT),
      ('curator'::platform.business_role, 'catalog.read'::TEXT)
    EXCEPT
    SELECT bundle.role, permission.permission_key
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
    WHERE bundle.version = 10
      AND permission.permission_key IN ('catalog.read', 'catalog.import.manage')
  ) OR EXISTS (
    SELECT bundle.role, permission.permission_key
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
    WHERE bundle.version = 10
      AND permission.permission_key IN ('catalog.read', 'catalog.import.manage')
    EXCEPT
    VALUES
      ('admin'::platform.business_role, 'catalog.read'::TEXT),
      ('admin'::platform.business_role, 'catalog.import.manage'::TEXT),
      ('sales'::platform.business_role, 'catalog.read'::TEXT),
      ('curator'::platform.business_role, 'catalog.read'::TEXT)
  ) THEN
    RAISE EXCEPTION 'BW5 role/permission matrix drifted';
  END IF;

  IF EXISTS (
    SELECT v10.role, permission.permission_key
    FROM platform.role_bundle_versions AS v10
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v10.id
      AND permission.bundle_role = v10.role
    WHERE v10.version = 10
      AND permission.permission_key NOT IN ('catalog.read', 'catalog.import.manage')
    EXCEPT
    SELECT v9.role, permission.permission_key
    FROM platform.role_bundle_versions AS v9
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v9.id
      AND permission.bundle_role = v9.role
    WHERE v9.version = 9
  ) OR EXISTS (
    SELECT v9.role, permission.permission_key
    FROM platform.role_bundle_versions AS v9
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v9.id
      AND permission.bundle_role = v9.role
    WHERE v9.version = 9
    EXCEPT
    SELECT v10.role, permission.permission_key
    FROM platform.role_bundle_versions AS v10
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v10.id
      AND permission.bundle_role = v10.role
    WHERE v10.version = 10
  ) THEN
    RAISE EXCEPTION 'BW5 v10 bundles did not clone the complete v9 baseline';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
    WHERE membership."current_role" IS NOT NULL
      AND membership.current_bundle_id IS NOT NULL
      AND (
        bundle.version <> 10
        OR bundle.role <> membership."current_role"
        OR bundle.status <> 'published'
      )
  ) THEN
    RAISE EXCEPTION 'BW5 left a membership outside its published v10 bundle';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.membership_role_history AS history
    LEFT JOIN platform.audit_events AS audit
      ON audit.request_id = history.request_id
      AND audit.organization_id = history.organization_id
      AND audit.resource_id = history.membership_id
      AND audit.action = 'rbac.bundle.upgrade'
    JOIN platform.role_bundle_versions AS previous_bundle
      ON previous_bundle.id = history.previous_bundle_id
    JOIN platform.role_bundle_versions AS new_bundle
      ON new_bundle.id = history.new_bundle_id
    JOIN platform.profiles AS profile ON profile.id = history.profile_id
    WHERE history.reason = 'BW5 immutable RBAC bundle upgrade'
      AND (
        audit.id IS NULL
        OR previous_bundle.version <> 9
        OR new_bundle.version <> 10
        OR (audit.before_state ->> 'access_version')::BIGINT + 1 <>
          (audit.after_state ->> 'access_version')::BIGINT
        OR (audit.after_state ->> 'access_version')::BIGINT <>
          profile.access_version
      )
  ) THEN
    RAISE EXCEPTION 'BW5 membership history/audit/access-version evidence drifted';
  END IF;
END
$$;

SELECT 'platform university catalog import boundary inventory passed' AS result;
