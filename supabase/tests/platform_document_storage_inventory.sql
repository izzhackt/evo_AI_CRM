\set ON_ERROR_STOP on

-- Exact P2H catalog, privilege and backup-inventory acceptance. The preceding
-- stateful RLS suite supplies only disposable synthetic bindings/objects.

CREATE OR REPLACE FUNCTION pg_temp.p2h_inventory_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P2H inventory assertion failed: %', p_message;
  END IF;
END
$$;

DO $p2h_bundle_inventory$
DECLARE
  membership_count INTEGER;
BEGIN
  SELECT count(*)
  INTO membership_count
  FROM platform.organization_memberships
  WHERE "current_role" IS NOT NULL;

  IF (
    SELECT count(*)
    FROM platform.role_bundle_versions
    WHERE version = 6
      AND status = 'published'
  ) <> 5 OR EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions
    WHERE version = 6
      AND role::TEXT NOT IN (
        'admin',
        'sales',
        'curator',
        'finance',
        'student'
      )
  ) THEN
    RAISE EXCEPTION
      'P2H must publish exactly five immutable v6 role bundles';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
    WHERE membership."current_role" IS NOT NULL
      AND (
        bundle.version <> 6
        OR bundle.status <> 'published'
        OR bundle.role <> membership."current_role"
      )
  ) THEN
    RAISE EXCEPTION
      'Every Platform membership must reference its matching v6 bundle';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.membership_role_history AS history
    JOIN platform.role_bundle_versions AS previous_bundle
      ON previous_bundle.id = history.previous_bundle_id
    JOIN platform.role_bundle_versions AS new_bundle
      ON new_bundle.id = history.new_bundle_id
    WHERE history.actor_kind = 'system'
      AND history.reason = 'P2H immutable RBAC bundle upgrade'
      AND previous_bundle.version = 5
      AND new_bundle.version = 6
  ) <> membership_count OR (
    SELECT count(*)
    FROM platform.audit_events
    WHERE action = 'rbac.bundle.upgrade'
      AND actor_principal =
        'migration:046_platform_private_document_storage'
      AND reason = 'P2H immutable RBAC bundle upgrade'
      AND (before_state ->> 'access_version')::BIGINT + 1 =
        (after_state ->> 'access_version')::BIGINT
  ) <> membership_count THEN
    RAISE EXCEPTION
      'P2H requires one v5-to-v6 history/audit pair per membership';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.permission_definitions
    WHERE permission_key IN (
      'document.upload',
      'document.download'
    )
  ) <> 2 THEN
    RAISE EXCEPTION
      'P2H explicit document upload/download permissions are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions AS bundle
    CROSS JOIN (
      VALUES
        ('document.upload'::TEXT),
        ('document.download'::TEXT)
    ) AS permission(permission_key)
    WHERE bundle.version = 6
      AND (
        EXISTS (
          SELECT 1
          FROM platform.role_bundle_permissions AS assigned
          WHERE assigned.bundle_id = bundle.id
            AND assigned.bundle_role = bundle.role
            AND assigned.permission_key = permission.permission_key
        )
        IS DISTINCT FROM (
          bundle.role IN ('admin', 'curator', 'student')
        )
      )
  ) THEN
    RAISE EXCEPTION
      'P2H upload/download permission matrix drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions
    WHERE role::TEXT = 'visa'
  ) THEN
    RAISE EXCEPTION 'P2H reintroduced the removed Visa business role';
  END IF;

  IF EXISTS (
    (
      SELECT
        v6.role::TEXT,
        permission.permission_key
      FROM platform.role_bundle_permissions AS permission
      JOIN platform.role_bundle_versions AS v6
        ON v6.id = permission.bundle_id
        AND v6.role = permission.bundle_role
        AND v6.version = 6
      WHERE permission.permission_key NOT IN (
        'document.upload',
        'document.download'
      )
      EXCEPT
      SELECT
        v5.role::TEXT,
        permission.permission_key
      FROM platform.role_bundle_permissions AS permission
      JOIN platform.role_bundle_versions AS v5
        ON v5.id = permission.bundle_id
        AND v5.role = permission.bundle_role
        AND v5.version = 5
    )
    UNION ALL
    (
      SELECT
        v5.role::TEXT,
        permission.permission_key
      FROM platform.role_bundle_permissions AS permission
      JOIN platform.role_bundle_versions AS v5
        ON v5.id = permission.bundle_id
        AND v5.role = permission.bundle_role
        AND v5.version = 5
      EXCEPT
      SELECT
        v6.role::TEXT,
        permission.permission_key
      FROM platform.role_bundle_permissions AS permission
      JOIN platform.role_bundle_versions AS v6
        ON v6.id = permission.bundle_id
        AND v6.role = permission.bundle_role
        AND v6.version = 6
      WHERE permission.permission_key NOT IN (
        'document.upload',
        'document.download'
      )
    )
  ) THEN
    RAISE EXCEPTION 'P2H v6 contains an unexpected non-storage permission';
  END IF;
END
$p2h_bundle_inventory$;

DO $p2h_private_table_inventory$
DECLARE
  table_name TEXT;
  expected_columns TEXT[];
  actual_columns TEXT[];
  forbidden_privileges TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'document_upload_reservations',
    'document_storage_bindings',
    'document_upload_finalizations',
    'document_download_grants',
    'document_download_consumptions'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'platform_private'
        AND relation.relname = table_name
        AND relation.relkind = 'r'
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION
        'Private P2H table % must have forced RLS',
        table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_policy AS policy
      JOIN pg_class AS relation
        ON relation.oid = policy.polrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'platform_private'
        AND relation.relname = table_name
    ) THEN
      RAISE EXCEPTION
        'Private P2H table % must expose no RLS policy',
        table_name;
    END IF;

    SELECT string_agg(
      format('%s:%s', principal.role_name, privilege.privilege_name),
      ', '
      ORDER BY principal.role_name, privilege.privilege_name
    )
    INTO forbidden_privileges
    FROM (
      VALUES
        ('PUBLIC'::TEXT),
        ('anon'::TEXT),
        ('authenticated'::TEXT),
        ('service_role'::TEXT),
        ('supabase_auth_admin'::TEXT)
    ) AS principal(role_name)
    CROSS JOIN (
      VALUES
        ('SELECT'::TEXT),
        ('INSERT'::TEXT),
        ('UPDATE'::TEXT),
        ('DELETE'::TEXT),
        ('TRUNCATE'::TEXT),
        ('REFERENCES'::TEXT),
        ('TRIGGER'::TEXT)
    ) AS privilege(privilege_name)
    WHERE CASE
      WHEN principal.role_name = 'PUBLIC' THEN EXISTS (
        SELECT 1
        FROM pg_class AS relation
        CROSS JOIN LATERAL aclexplode(
          COALESCE(
            relation.relacl,
            acldefault('r', relation.relowner)
          )
        ) AS relation_acl
        WHERE relation.oid = to_regclass(
          format('platform_private.%I', table_name)
        )
          AND relation_acl.grantee = 0
          AND relation_acl.privilege_type = privilege.privilege_name
      )
      ELSE has_table_privilege(
        principal.role_name,
        format('platform_private.%I', table_name),
        privilege.privilege_name
      )
    END;

    IF forbidden_privileges IS NOT NULL THEN
      RAISE EXCEPTION
        'Private P2H table % has forbidden direct privileges: %',
        table_name,
        forbidden_privileges;
    END IF;
  END LOOP;

  IF (
    SELECT count(*)
    FROM pg_trigger AS trigger
    JOIN pg_class AS relation
      ON relation.oid = trigger.tgrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND relation.relname IN (
        'document_upload_reservations',
        'document_storage_bindings',
        'document_upload_finalizations',
        'document_download_grants',
        'document_download_consumptions'
      )
      AND NOT trigger.tgisinternal
      AND trigger.tgname IN (
        'document_upload_reservations_append_only_rows',
        'document_upload_reservations_no_truncate',
        'document_storage_bindings_append_only_rows',
        'document_storage_bindings_no_truncate',
        'document_upload_finalizations_append_only_rows',
        'document_upload_finalizations_no_truncate',
        'document_download_grants_append_only_rows',
        'document_download_grants_no_truncate',
        'document_download_consumptions_append_only_rows',
        'document_download_consumptions_no_truncate'
      )
  ) <> 10 THEN
    RAISE EXCEPTION
      'P2H immutable reservation/binding/grant/consumption triggers are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS catalog_column
    WHERE catalog_column.table_schema = 'platform_private'
      AND catalog_column.table_name IN (
        'document_upload_reservations',
        'document_storage_bindings',
        'document_upload_finalizations',
        'document_download_grants',
        'document_download_consumptions'
      )
      AND catalog_column.column_name IN (
        'original_filename',
        'signed_url',
        'download_token',
        'deleted_at',
        'delete_after'
      )
  ) THEN
    RAISE EXCEPTION
      'Private P2H tables contain filename/token/deletion lifecycle columns';
  END IF;

  SELECT array_agg(
    catalog_column.column_name::TEXT
    ORDER BY catalog_column.ordinal_position
  )
  INTO actual_columns
  FROM information_schema.columns AS catalog_column
  WHERE catalog_column.table_schema = 'platform_private'
    AND catalog_column.table_name = 'document_upload_reservations';

  expected_columns := ARRAY[
    'id',
    'request_id',
    'organization_id',
    'student_case_id',
    'document_slot_id',
    'document_version_id',
    'uploader_profile_id',
    'uploader_membership_id',
    'uploader_auth_user_id',
    'bucket_id',
    'object_name',
    'declared_mime_type',
    'byte_size',
    'sha256_hex',
    'expires_at',
    'created_at'
  ];
  IF actual_columns IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION
      'document_upload_reservations column contract drifted: %',
      actual_columns;
  END IF;

  SELECT array_agg(
    catalog_column.column_name::TEXT
    ORDER BY catalog_column.ordinal_position
  )
  INTO actual_columns
  FROM information_schema.columns AS catalog_column
  WHERE catalog_column.table_schema = 'platform_private'
    AND catalog_column.table_name = 'document_storage_bindings';

  expected_columns := ARRAY[
    'id',
    'organization_id',
    'student_case_id',
    'document_slot_id',
    'document_version_id',
    'upload_reservation_id',
    'bucket_id',
    'object_name',
    'created_at'
  ];
  IF actual_columns IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION
      'document_storage_bindings column contract drifted: %',
      actual_columns;
  END IF;

  SELECT array_agg(
    catalog_column.column_name::TEXT
    ORDER BY catalog_column.ordinal_position
  )
  INTO actual_columns
  FROM information_schema.columns AS catalog_column
  WHERE catalog_column.table_schema = 'platform_private'
    AND catalog_column.table_name = 'document_upload_finalizations';

  expected_columns := ARRAY[
    'id',
    'request_id',
    'organization_id',
    'upload_reservation_id',
    'student_case_id',
    'document_version_id',
    'document_slot_id',
    'finalization_audit_event_id',
    'bucket_id',
    'object_name',
    'published_version_no',
    'object_created_at',
    'finalized_at'
  ];
  IF actual_columns IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION
      'document_upload_finalizations column contract drifted: %',
      actual_columns;
  END IF;

  SELECT array_agg(
    catalog_column.column_name::TEXT
    ORDER BY catalog_column.ordinal_position
  )
  INTO actual_columns
  FROM information_schema.columns AS catalog_column
  WHERE catalog_column.table_schema = 'platform_private'
    AND catalog_column.table_name = 'document_download_grants';

  expected_columns := ARRAY[
    'id',
    'request_id',
    'organization_id',
    'student_case_id',
    'document_slot_id',
    'document_version_id',
    'storage_binding_id',
    'document_access_event_id',
    'grantee_profile_id',
    'grantee_membership_id',
    'grantee_auth_user_id',
    'grantee_role',
    'grantee_access_version',
    'access_purpose',
    'expires_in_seconds',
    'expires_at',
    'created_at'
  ];
  IF actual_columns IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION
      'document_download_grants column contract drifted: %',
      actual_columns;
  END IF;

  SELECT array_agg(
    catalog_column.column_name::TEXT
    ORDER BY catalog_column.ordinal_position
  )
  INTO actual_columns
  FROM information_schema.columns AS catalog_column
  WHERE catalog_column.table_schema = 'platform_private'
    AND catalog_column.table_name = 'document_download_consumptions';

  expected_columns := ARRAY[
    'id',
    'request_id',
    'organization_id',
    'document_download_grant_id',
    'document_access_event_id',
    'signing_audit_event_id',
    'storage_binding_id',
    'bucket_id',
    'object_name',
    'max_signed_url_expires_in_seconds',
    'grant_expires_at',
    'consumed_at'
  ];
  IF actual_columns IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION
      'document_download_consumptions column contract drifted: %',
      actual_columns;
  END IF;
END
$p2h_private_table_inventory$;

DO $p2h_guard_inventory$
DECLARE
  upload_definition TEXT;
  finalize_definition TEXT;
  download_definition TEXT;
  review_definition TEXT;
  upload_policy_definition TEXT;
BEGIN
  IF (
    SELECT count(*)
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation
      ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE (
      namespace.nspname,
      relation.relname,
      constraint_row.conname,
      constraint_row.convalidated
    ) IN (
      (
        'platform',
        'document_versions',
        'document_versions_original_filename_size_check',
        TRUE
      ),
      (
        'platform',
        'document_access_events',
        'document_access_events_purpose_size_check',
        TRUE
      )
    )
  ) <> 2 THEN
    RAISE EXCEPTION
      'P2H text-bound constraints are missing or not validated';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_indexes AS index_row
    WHERE index_row.schemaname = 'platform_private'
      AND index_row.indexname IN (
        'document_upload_reservations_actor_rate_idx',
        'document_upload_reservations_slot_live_idx',
        'document_upload_reservations_slot_rate_idx',
        'document_download_grants_actor_rate_idx',
        'document_download_grants_actor_version_live_idx'
      )
  ) <> 5 THEN
    RAISE EXCEPTION 'P2H conflict/rate index contract drifted';
  END IF;

  SELECT pg_get_functiondef(
    'platform.finalize_document_upload(uuid,uuid,uuid)'::REGPROCEDURE
  )
  INTO STRICT finalize_definition;
  SELECT pg_get_functiondef(
    'platform.reserve_document_upload(uuid,uuid,text,text,bigint,text,uuid)'
      ::REGPROCEDURE
  )
  INTO STRICT upload_definition;
  SELECT pg_get_functiondef(
    'platform.grant_document_download(uuid,uuid,text,integer,uuid)'
      ::REGPROCEDURE
  )
  INTO STRICT download_definition;
  SELECT pg_get_functiondef(
    (
      'platform.review_document_version('
      || 'uuid,uuid,platform.document_review_decision,text,uuid'
      || ')'
    )::REGPROCEDURE
  )
  INTO STRICT review_definition;
  SELECT pg_get_functiondef(
    'private.platform_can_upload_reserved_document(text,text)'::REGPROCEDURE
  )
  INTO STRICT upload_policy_definition;

  IF upload_definition NOT LIKE '%actor_hourly_limit CONSTANT INTEGER := 60%'
    OR upload_definition NOT LIKE '%slot_hourly_limit CONSTANT INTEGER := 12%'
    OR upload_definition NOT LIKE '%ERRCODE = ''PT409''%'
    OR upload_definition NOT LIKE '%ERRCODE = ''PT429''%'
    OR upload_definition NOT LIKE '%reservation.organization_id = p_organization_id%'
    OR upload_definition NOT LIKE
      '%platform_private.document_upload_finalizations%'
    OR upload_definition NOT LIKE '%MAX(version.version_no)%'
    OR strpos(upload_definition, 'FOR UPDATE OF student_case') = 0
    OR strpos(upload_definition, 'INTO slot_row') <=
      strpos(upload_definition, 'FOR UPDATE OF student_case')
  THEN
    RAISE EXCEPTION 'P2H upload conflict/rate contract drifted';
  END IF;

  IF finalize_definition NOT LIKE '%storage.objects%'
    OR finalize_definition NOT LIKE
      '%object_row.created_at > reservation.expires_at%'
    OR finalize_definition NOT LIKE
      '%document.upload.finalize%'
    OR finalize_definition NOT LIKE
      '%platform_private.document_upload_finalizations%'
    OR strpos(finalize_definition, 'INTO case_row') = 0
    OR strpos(finalize_definition, 'INTO slot_row') <=
      strpos(finalize_definition, 'INTO case_row')
    OR strpos(finalize_definition, 'INTO version_row') <=
      strpos(finalize_definition, 'INTO slot_row')
    OR strpos(finalize_definition, 'INTO STRICT reservation') <=
      strpos(finalize_definition, 'INTO version_row')
  THEN
    RAISE EXCEPTION 'P2H upload finalization contract drifted';
  END IF;

  IF download_definition NOT LIKE '%actor_hourly_limit CONSTANT INTEGER := 120%'
    OR download_definition NOT LIKE '%ERRCODE = ''PT409''%'
    OR download_definition NOT LIKE '%ERRCODE = ''PT429''%'
    OR download_definition NOT LIKE
      '%download_grant.organization_id = p_organization_id%'
    OR download_definition NOT LIKE
      '%platform_private.document_download_consumptions%'
  THEN
    RAISE EXCEPTION 'P2H download conflict/rate contract drifted';
  END IF;

  IF strpos(download_definition, 'INTO actor') = 0
    OR strpos(download_definition, 'INTO preliminary_version') <=
      strpos(download_definition, 'INTO actor')
    OR strpos(download_definition, 'INTO case_row') <=
      strpos(download_definition, 'INTO preliminary_version')
    OR strpos(download_definition, 'INTO version_row') <=
      strpos(download_definition, 'INTO case_row')
    OR download_definition NOT LIKE
      '%version.student_case_id = case_row.id%'
  THEN
    RAISE EXCEPTION 'P2H download lock-order contract drifted';
  END IF;

  IF strpos(review_definition, 'INTO preliminary_version') = 0
    OR strpos(review_definition, 'INTO actor') <=
      strpos(review_definition, 'INTO preliminary_version')
    OR strpos(review_definition, 'INTO target_case') <=
      strpos(review_definition, 'INTO actor')
    OR strpos(review_definition, 'INTO slot_row') <=
      strpos(review_definition, 'INTO target_case')
    OR strpos(review_definition, 'INTO version_row') <=
      strpos(review_definition, 'INTO slot_row')
    OR review_definition NOT LIKE
      '%version.document_slot_id = slot_row.id%'
  THEN
    RAISE EXCEPTION 'P2H review lock-order contract drifted';
  END IF;

  IF upload_policy_definition LIKE
      '%slot.current_version_id = reservation.document_version_id%'
  THEN
    RAISE EXCEPTION
      'P2H immutable upload capability still depends on mutable slot pointer';
  END IF;
END
$p2h_guard_inventory$;

DO $p2h_function_inventory$
DECLARE
  violation TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        (
          'platform.reserve_document_upload(uuid,uuid,text,text,bigint,text,uuid)',
          FALSE,
          TRUE,
          FALSE,
          FALSE
        ),
        (
          'platform.finalize_document_upload(uuid,uuid,uuid)',
          FALSE,
          FALSE,
          FALSE,
          TRUE
        ),
        (
          'platform.grant_document_download(uuid,uuid,text,integer,uuid)',
          FALSE,
          TRUE,
          FALSE,
          FALSE
        ),
        (
          'platform.document_storage_backup_inventory()',
          FALSE,
          FALSE,
          FALSE,
          TRUE
        ),
        (
          'private.platform_can_upload_reserved_document(text,text)',
          FALSE,
          TRUE,
          FALSE,
          FALSE
        ),
        (
          'platform.consume_document_download_grant(uuid,uuid)',
          FALSE,
          FALSE,
          FALSE,
          TRUE
        ),
        (
          'platform_private.lock_p2h_request(uuid)',
          FALSE,
          FALSE,
          FALSE,
          FALSE
        ),
        (
          'platform_private.require_document_storage_actor(uuid,uuid,text)',
          FALSE,
          FALSE,
          FALSE,
          FALSE
        )
    ) AS expected(
      signature,
      anon_ok,
      authenticated_ok,
      supabase_auth_admin_ok,
      service_role_ok
    )
    WHERE to_regprocedure(expected.signature) IS NULL
      OR has_function_privilege(
        'anon',
        expected.signature,
        'EXECUTE'
      ) IS DISTINCT FROM expected.anon_ok
      OR has_function_privilege(
        'authenticated',
        expected.signature,
        'EXECUTE'
      ) IS DISTINCT FROM expected.authenticated_ok
      OR has_function_privilege(
        'supabase_auth_admin',
        expected.signature,
        'EXECUTE'
      ) IS DISTINCT FROM expected.supabase_auth_admin_ok
      OR has_function_privilege(
        'service_role',
        expected.signature,
        'EXECUTE'
      ) IS DISTINCT FROM expected.service_role_ok
  ) THEN
    RAISE EXCEPTION 'P2H function existence/execute grants drifted';
  END IF;

  SELECT string_agg(
    format(
      '%I.%I(%s)',
      namespace.nspname,
      routine.proname,
      pg_get_function_identity_arguments(routine.oid)
    ),
    ', '
    ORDER BY namespace.nspname, routine.proname
  )
  INTO violation
  FROM pg_proc AS routine
  JOIN pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  JOIN pg_roles AS owner_role
    ON owner_role.oid = routine.proowner
  WHERE routine.oid = ANY (
    ARRAY[
      'platform.reserve_document_upload(uuid,uuid,text,text,bigint,text,uuid)'::REGPROCEDURE,
      'platform.finalize_document_upload(uuid,uuid,uuid)'::REGPROCEDURE,
      'platform.grant_document_download(uuid,uuid,text,integer,uuid)'::REGPROCEDURE,
      'platform.document_storage_backup_inventory()'::REGPROCEDURE,
      'private.platform_can_upload_reserved_document(text,text)'::REGPROCEDURE,
      'platform.consume_document_download_grant(uuid,uuid)'::REGPROCEDURE,
      'platform_private.lock_p2h_request(uuid)'::REGPROCEDURE,
      'platform_private.require_document_storage_actor(uuid,uuid,text)'::REGPROCEDURE
    ]
  )
    AND (
      owner_role.rolname <> 'postgres'
      OR NOT routine.prosecdef
      OR array_to_string(routine.proconfig, ',')
        IS DISTINCT FROM 'search_path=""'
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2H SECURITY DEFINER owner/search_path mismatch: %',
      violation;
  END IF;

  IF (
    SELECT routine.provolatile
    FROM pg_proc AS routine
    WHERE routine.oid =
      'platform.document_storage_backup_inventory()'::REGPROCEDURE
  ) <> 's' OR EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    WHERE routine.oid = ANY (
      ARRAY[
        'platform.reserve_document_upload(uuid,uuid,text,text,bigint,text,uuid)'::REGPROCEDURE,
        'platform.finalize_document_upload(uuid,uuid,uuid)'::REGPROCEDURE,
        'platform.grant_document_download(uuid,uuid,text,integer,uuid)'::REGPROCEDURE,
        'platform.consume_document_download_grant(uuid,uuid)'::REGPROCEDURE,
        'platform_private.lock_p2h_request(uuid)'::REGPROCEDURE,
        'platform_private.require_document_storage_actor(uuid,uuid,text)'::REGPROCEDURE
      ]
    )
      AND routine.provolatile <> 'v'
  ) THEN
    RAISE EXCEPTION 'P2H function volatility contract drifted';
  END IF;

  IF (
    SELECT routine.proargnames
    FROM pg_proc AS routine
    WHERE routine.oid =
      'platform.document_storage_backup_inventory()'::REGPROCEDURE
  ) && ARRAY[
    'original_filename',
    'signed_url',
    'actual_sha256_hex',
    'content_sha256_hex'
  ] THEN
    RAISE EXCEPTION
      'P2H backup inventory exposes filename/URL or claims an actual hash';
  END IF;
END
$p2h_function_inventory$;

DO $p2h_storage_policy_inventory$
DECLARE
  avatar_owner_expression CONSTANT TEXT :=
    $policy_expression$((bucket_id='avatars'::text)AND((auth.uid())::text=(storage.foldername(name))[1]))$policy_expression$;
  flow_member_expression CONSTANT TEXT :=
    $policy_expression$((bucket_id='flow-media'::text)AND((EXISTS(SELECT1FROMprofilespWHERE((p.user_id=auth.uid())AND(('account-'::text||(p.account_id)::text)=(storage.foldername(objects.name))[1]))))OR((auth.uid())::text=(storage.foldername(name))[1])))$policy_expression$;
  chat_member_expression CONSTANT TEXT :=
    $policy_expression$((bucket_id='chat-media'::text)AND(EXISTS(SELECT1FROMprofilespWHERE((p.user_id=auth.uid())AND(('account-'::text||(p.account_id)::text)=(storage.foldername(objects.name))[1])))))$policy_expression$;
  platform_upload_expression CONSTANT TEXT :=
    $policy_expression$((bucket_id='platform-documents'::text)ANDstorage.allow_only_operation('storage.object.upload'::text)AND(SELECTprivate.platform_can_upload_reserved_document(objects.bucket_id,objects.name)ASplatform_can_upload_reserved_document))$policy_expression$;
  policy_drift TEXT;
BEGIN
  WITH expected_policy (
    policy_name,
    command_name,
    role_names,
    permissive_mode,
    normalized_using,
    normalized_with_check
  ) AS (
    VALUES
      (
        'Avatars are publicly readable'::TEXT,
        'SELECT'::TEXT,
        ARRAY['public'::NAME],
        'PERMISSIVE'::TEXT,
        $policy_expression$(bucket_id='avatars'::text)$policy_expression$,
        ''::TEXT
      ),
      (
        'Flow media is publicly readable'::TEXT,
        'SELECT'::TEXT,
        ARRAY['public'::NAME],
        'PERMISSIVE'::TEXT,
        $policy_expression$(bucket_id='flow-media'::text)$policy_expression$,
        ''::TEXT
      ),
      (
        'Members can delete chat media'::TEXT,
        'DELETE'::TEXT,
        ARRAY['authenticated'::NAME],
        'PERMISSIVE'::TEXT,
        chat_member_expression,
        ''::TEXT
      ),
      (
        'Members can delete flow media'::TEXT,
        'DELETE'::TEXT,
        ARRAY['public'::NAME],
        'PERMISSIVE'::TEXT,
        flow_member_expression,
        ''::TEXT
      ),
      (
        'Members can read chat media'::TEXT,
        'SELECT'::TEXT,
        ARRAY['authenticated'::NAME],
        'PERMISSIVE'::TEXT,
        chat_member_expression,
        ''::TEXT
      ),
      (
        'Members can update flow media'::TEXT,
        'UPDATE'::TEXT,
        ARRAY['public'::NAME],
        'PERMISSIVE'::TEXT,
        flow_member_expression,
        ''::TEXT
      ),
      (
        'Members can upload chat media'::TEXT,
        'INSERT'::TEXT,
        ARRAY['authenticated'::NAME],
        'PERMISSIVE'::TEXT,
        ''::TEXT,
        chat_member_expression
      ),
      (
        'Members can upload flow media'::TEXT,
        'INSERT'::TEXT,
        ARRAY['public'::NAME],
        'PERMISSIVE'::TEXT,
        ''::TEXT,
        flow_member_expression
      ),
      (
        'Platform document reserved upload'::TEXT,
        'INSERT'::TEXT,
        ARRAY['authenticated'::NAME],
        'PERMISSIVE'::TEXT,
        ''::TEXT,
        platform_upload_expression
      ),
      (
        'Users can delete their own avatar'::TEXT,
        'DELETE'::TEXT,
        ARRAY['public'::NAME],
        'PERMISSIVE'::TEXT,
        avatar_owner_expression,
        ''::TEXT
      ),
      (
        'Users can update their own avatar'::TEXT,
        'UPDATE'::TEXT,
        ARRAY['public'::NAME],
        'PERMISSIVE'::TEXT,
        avatar_owner_expression,
        ''::TEXT
      ),
      (
        'Users can upload their own avatar'::TEXT,
        'INSERT'::TEXT,
        ARRAY['public'::NAME],
        'PERMISSIVE'::TEXT,
        ''::TEXT,
        avatar_owner_expression
      )
  ),
  actual_policy AS (
    SELECT
      policy.policyname::TEXT AS policy_name,
      policy.cmd::TEXT AS command_name,
      policy.roles AS role_names,
      policy.permissive::TEXT AS permissive_mode,
      regexp_replace(
        COALESCE(policy.qual, ''),
        '[[:space:]]+',
        '',
        'g'
      ) AS normalized_using,
      regexp_replace(
        COALESCE(policy.with_check, ''),
        '[[:space:]]+',
        '',
        'g'
      ) AS normalized_with_check
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
  ),
  policy_difference AS (
    SELECT
      'unexpected'::TEXT AS difference_kind,
      actual.*
    FROM actual_policy AS actual
    WHERE NOT EXISTS (
      SELECT 1
      FROM expected_policy AS expected
      WHERE expected.policy_name = actual.policy_name
        AND expected.command_name = actual.command_name
        AND expected.role_names = actual.role_names
        AND expected.permissive_mode = actual.permissive_mode
        AND expected.normalized_using = actual.normalized_using
        AND expected.normalized_with_check =
          actual.normalized_with_check
    )

    UNION ALL

    SELECT
      'missing'::TEXT AS difference_kind,
      expected.*
    FROM expected_policy AS expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM actual_policy AS actual
      WHERE actual.policy_name = expected.policy_name
        AND actual.command_name = expected.command_name
        AND actual.role_names = expected.role_names
        AND actual.permissive_mode = expected.permissive_mode
        AND actual.normalized_using = expected.normalized_using
        AND actual.normalized_with_check =
          expected.normalized_with_check
    )
  )
  SELECT string_agg(
    format(
      '%s policy=%I command=%s roles=%s',
      difference.difference_kind,
      difference.policy_name,
      difference.command_name,
      difference.role_names::TEXT
    ),
    '; '
    ORDER BY
      difference.difference_kind,
      difference.policy_name
  )
  INTO policy_drift
  FROM policy_difference AS difference;

  IF policy_drift IS NOT NULL THEN
    RAISE EXCEPTION
      'storage.objects policy allowlist drifted: %',
      policy_drift;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'platform-documents'
      AND name = 'platform-documents'
      AND NOT public
      AND file_size_limit = 26214400
      AND allowed_mime_types =
        ARRAY['application/pdf', 'image/jpeg', 'image/png']
  ) THEN
    RAISE EXCEPTION
      'Disposable fixed private platform-documents bucket contract drifted';
  END IF;
END
$p2h_storage_policy_inventory$;

-- Model current provider metadata without changing immutable Platform rows:
-- one correct size, one mismatch, one unknown size and one unbound object.
UPDATE storage.objects
SET metadata = jsonb_build_object('size', 2048)
WHERE bucket_id = 'platform-documents'
  AND name = (
    SELECT binding.object_name
    FROM platform_private.document_storage_bindings AS binding
    JOIN platform.document_versions AS version
      ON version.organization_id = binding.organization_id
      AND version.id = binding.document_version_id
    WHERE version.sha256_hex = repeat('b', 64)
  );

UPDATE storage.objects
SET metadata = jsonb_build_object('size', 999)
WHERE bucket_id = 'platform-documents'
  AND name = (
    SELECT binding.object_name
    FROM platform_private.document_storage_bindings AS binding
    JOIN platform.document_versions AS version
      ON version.organization_id = binding.organization_id
      AND version.id = binding.document_version_id
    WHERE version.sha256_hex = repeat('c', 64)
  );

INSERT INTO storage.objects (
  id,
  bucket_id,
  name,
  metadata
)
VALUES (
  '46000000-0000-4000-8000-000000000901',
  'platform-documents',
  'ee/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  jsonb_build_object('size', 777)
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT
  count(*) FILTER (
    WHERE inventory.inventory_state = 'missing_object'
  ) AS missing_object_count,
  count(*) FILTER (
    WHERE inventory.inventory_state = 'unbound_object'
  ) AS unbound_object_count,
  count(*) FILTER (
    WHERE inventory.inventory_state = 'size_mismatch'
  ) AS size_mismatch_count,
  count(*) FILTER (
    WHERE inventory.inventory_state = 'present'
  ) AS present_count,
  count(*) FILTER (
    WHERE inventory.inventory_state = 'present_size_unknown'
  ) AS present_size_unknown_count,
  count(*) FILTER (
    WHERE inventory.binding_present
      AND inventory.expected_byte_size IS NOT NULL
      AND inventory.expected_sha256_hex ~ '^[0-9a-f]{64}$'
  ) AS protected_expected_metadata_count,
  count(*) FILTER (
    WHERE NOT inventory.binding_present
      AND inventory.storage_object_present
      AND inventory.expected_byte_size IS NULL
      AND inventory.expected_sha256_hex IS NULL
  ) AS safe_unbound_shape_count,
  count(*) FILTER (
    WHERE to_jsonb(inventory) ? 'original_filename'
      OR to_jsonb(inventory) ? 'signed_url'
      OR to_jsonb(inventory) ? 'actual_sha256_hex'
  ) AS forbidden_inventory_key_count
FROM platform.document_storage_backup_inventory() AS inventory
\gset
RESET ROLE;

SELECT pg_temp.p2h_inventory_assert(
  :'missing_object_count'::INTEGER >= 1
    AND :'unbound_object_count'::INTEGER = 1
    AND :'size_mismatch_count'::INTEGER = 1
    AND :'present_count'::INTEGER >= 1
    AND :'present_size_unknown_count'::INTEGER >= 1
    AND :'protected_expected_metadata_count'::INTEGER >= 4
    AND :'safe_unbound_shape_count'::INTEGER = 1
    AND :'forbidden_inventory_key_count'::INTEGER = 0,
  format(
    'backup reconciliation counts: missing %s, unbound %s, mismatch %s, present %s, unknown %s, protected %s, safe-unbound %s, forbidden %s',
    :'missing_object_count',
    :'unbound_object_count',
    :'size_mismatch_count',
    :'present_count',
    :'present_size_unknown_count',
    :'protected_expected_metadata_count',
    :'safe_unbound_shape_count',
    :'forbidden_inventory_key_count'
  )
);

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version',
  (
    SELECT profile.access_version
    FROM platform.profiles AS profile
    WHERE profile.auth_user_id =
      '10000000-0000-4000-8000-000000000001'
  )
)::TEXT AS admin_claims
\gset
SET request.jwt.claims TO :'admin_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT * FROM platform.document_storage_backup_inventory();
\set browser_backup_inventory_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p2h_inventory_assert(
  :'browser_backup_inventory_state' <> '00000',
  'authenticated browser executed service-only backup inventory'
);

\echo 'P2H private document Storage inventory passed'
