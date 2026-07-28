\set ON_ERROR_STOP on

-- Catalog-only P2E inventory. All assertions inspect the disposable database
-- after migrations 001-043. They do not treat metadata as proof of Storage,
-- malware-scanner, Queue, WhatsApp, or any other provider behavior.

DO $$
DECLARE
  p2e_tables CONSTANT TEXT[] := ARRAY[
    'document_access_events',
    'document_requirements',
    'document_reviews',
    'document_slots',
    'document_validation_events',
    'document_versions',
    'notification_consent_events',
    'notification_consents',
    'notification_delivery_intents',
    'notification_events',
    'notifications',
    'payment_events',
    'payment_evidence',
    'payment_obligations',
    'stop_factor_events',
    'stop_factors'
  ];
  append_only_tables CONSTANT TEXT[] := ARRAY[
    'document_access_events',
    'document_reviews',
    'document_validation_events',
    'notification_consent_events',
    'notification_delivery_intents',
    'notification_events',
    'payment_events',
    'payment_evidence',
    'stop_factor_events'
  ];
  lifecycle_tables CONSTANT TEXT[] := ARRAY[
    'document_requirements',
    'document_slots',
    'document_versions',
    'notification_consents',
    'notifications',
    'payment_obligations',
    'stop_factors'
  ];
  expected_composite_fks CONSTANT TEXT[] := ARRAY[
    'document_reviews_version_fkey',
    'document_slots_current_version_fkey',
    'document_validation_events_version_fkey',
    'notification_consent_events_consent_fkey',
    'notification_delivery_intents_consent_fkey',
    'notification_delivery_intents_notification_fkey',
    'notification_events_notification_fkey',
    'payment_events_referenced_payment_fkey',
    'payment_evidence_event_fkey',
    'stop_factor_events_parent_fkey',
    'stop_factor_events_payment_event_fkey',
    'stop_factors_resolution_event_fkey'
  ];
  actual TEXT[];
  missing TEXT;
  violation TEXT;
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
  INTO actual
  FROM information_schema.tables
  WHERE table_schema = 'platform'
    AND table_name = ANY (p2e_tables)
    AND table_type = 'BASE TABLE';

  IF actual IS DISTINCT FROM p2e_tables THEN
    RAISE EXCEPTION
      'P2E table inventory mismatch: expected %, found %',
      p2e_tables,
      actual;
  END IF;

  SELECT string_agg(
    format(
      '%I.%I(owner=%I,rls=%s,forced=%s)',
      namespace.nspname,
      relation.relname,
      owner_role.rolname,
      relation.relrowsecurity,
      relation.relforcerowsecurity
    ),
    ', '
    ORDER BY relation.relname
  )
  INTO violation
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  JOIN pg_roles AS owner_role
    ON owner_role.oid = relation.relowner
  WHERE namespace.nspname = 'platform'
    AND relation.relname = ANY (p2e_tables)
    AND relation.relkind IN ('r', 'p')
    AND (
      owner_role.rolname <> 'postgres'
      OR NOT relation.relrowsecurity
      OR NOT relation.relforcerowsecurity
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2E tables must be postgres-owned with ENABLE/FORCE RLS: %',
      violation;
  END IF;

  SELECT string_agg(expected_name, ', ' ORDER BY expected_name)
  INTO missing
  FROM unnest(expected_composite_fks) AS expected(expected_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation
      ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform'
      AND constraint_row.contype = 'f'
      AND constraint_row.conname = expected.expected_name
      AND cardinality(constraint_row.conkey) >= 3
      AND cardinality(constraint_row.confkey) =
          cardinality(constraint_row.conkey)
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Missing tenant/parent-qualified P2E foreign keys: %',
      missing;
  END IF;

  SELECT string_agg(table_name, ', ' ORDER BY table_name)
  INTO missing
  FROM unnest(append_only_tables) AS expected(table_name)
  WHERE NOT EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS relation
        ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      JOIN pg_proc AS trigger_function
        ON trigger_function.oid = trigger_row.tgfoid
      JOIN pg_namespace AS function_namespace
        ON function_namespace.oid = trigger_function.pronamespace
      WHERE namespace.nspname = 'platform'
        AND relation.relname = expected.table_name
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgname = expected.table_name || '_append_only'
        AND trigger_row.tgtype = 27
        AND function_namespace.nspname = 'platform_private'
        AND trigger_function.proname = 'block_append_only_mutation'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS relation
        ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      JOIN pg_proc AS trigger_function
        ON trigger_function.oid = trigger_row.tgfoid
      JOIN pg_namespace AS function_namespace
        ON function_namespace.oid = trigger_function.pronamespace
      WHERE namespace.nspname = 'platform'
        AND relation.relname = expected.table_name
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgname = expected.table_name || '_no_truncate'
        AND trigger_row.tgtype = 34
        AND function_namespace.nspname = 'platform_private'
        AND trigger_function.proname = 'block_append_only_mutation'
    );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'P2E append-only UPDATE/DELETE/TRUNCATE guards missing for: %',
      missing;
  END IF;

  SELECT string_agg(table_name, ', ' ORDER BY table_name)
  INTO missing
  FROM unnest(lifecycle_tables) AS expected(table_name)
  WHERE NOT EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS relation
        ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'platform'
        AND relation.relname = expected.table_name
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgname = expected.table_name || '_no_delete'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS relation
        ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'platform'
        AND relation.relname = expected.table_name
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgname = expected.table_name || '_no_truncate'
    );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'P2E lifecycle DELETE/TRUNCATE guards missing for: %',
      missing;
  END IF;

  IF enum_range(NULL::platform.document_requirement_status)::TEXT[]
      IS DISTINCT FROM ARRAY['active', 'retired']::TEXT[]
    OR enum_range(NULL::platform.document_slot_status)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'required',
        'submitted',
        'approved',
        'correction_required',
        'rejected'
      ]::TEXT[]
    OR enum_range(NULL::platform.document_integrity_status)::TEXT[]
      IS DISTINCT FROM ARRAY['pending', 'verified', 'failed']::TEXT[]
    OR enum_range(NULL::platform.document_malware_status)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'pending',
        'clean',
        'infected',
        'error'
      ]::TEXT[]
    OR enum_range(NULL::platform.document_review_decision)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'approved',
        'correction_required',
        'rejected'
      ]::TEXT[]
    OR enum_range(NULL::platform.obligation_category)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'evo_service_fee',
        'third_party_cost'
      ]::TEXT[]
    OR enum_range(NULL::platform.payment_event_type)::TEXT[]
      IS DISTINCT FROM ARRAY['payment', 'refund']::TEXT[]
    OR enum_range(NULL::platform.stop_factor_status)::TEXT[]
      IS DISTINCT FROM ARRAY['active', 'resolved']::TEXT[]
    OR enum_range(NULL::platform.stop_factor_resolution_kind)::TEXT[]
      IS DISTINCT FROM ARRAY['payment_event', 'admin_override']::TEXT[]
    OR enum_range(NULL::platform.notification_channel)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'in_app',
        'individual_whatsapp'
      ]::TEXT[]
    OR enum_range(NULL::platform.notification_consent_status)::TEXT[]
      IS DISTINCT FROM ARRAY['granted', 'withdrawn']::TEXT[]
    OR enum_range(NULL::platform.notification_intent_status)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'pending',
        'consent_blocked',
        'cancelled'
      ]::TEXT[]
    OR enum_range(NULL::platform.notification_event_type)::TEXT[]
      IS DISTINCT FROM ARRAY['created', 'read', 'cancelled']::TEXT[]
  THEN
    RAISE EXCEPTION 'P2E enum inventory drifted from the accepted contract';
  END IF;

  -- P2E deliberately models only intent. Provider delivery/ACK state and
  -- broadcast recipient lists would overclaim this block's proof boundary.
  SELECT string_agg(
    format('%I.%I', column_row.table_name, column_row.column_name),
    ', '
    ORDER BY column_row.table_name, column_row.ordinal_position
  )
  INTO violation
  FROM information_schema.columns AS column_row
  WHERE column_row.table_schema = 'platform'
    AND column_row.table_name = ANY (p2e_tables)
    AND (
      column_row.column_name ~
        '(^|_)(broadcast|campaign|recipient_ids|provider_message|provider_ack|delivered|played)(_|$)'
      OR column_row.data_type = 'ARRAY'
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2E contains broadcast/provider-delivery surface outside intent scope: %',
      violation;
  END IF;
END
$$;

\echo 'P2E base catalog and invariant inventory passed'

DO $$
DECLARE
  p2e_tables CONSTANT TEXT[] := ARRAY[
    'document_access_events',
    'document_requirements',
    'document_reviews',
    'document_slots',
    'document_validation_events',
    'document_versions',
    'notification_consent_events',
    'notification_consents',
    'notification_delivery_intents',
    'notification_events',
    'notifications',
    'payment_events',
    'payment_evidence',
    'payment_obligations',
    'stop_factor_events',
    'stop_factors'
  ];
  authenticated_select_tables CONSTANT TEXT[] := ARRAY[
    'document_access_events',
    'document_requirements',
    'document_reviews',
    'document_slots',
    'document_validation_events',
    'document_versions',
    'payment_events',
    'payment_evidence',
    'payment_obligations',
    'stop_factor_events',
    'stop_factors'
  ];
  expected_policies CONSTANT TEXT[] := ARRAY[
    'document_access_events_full_read',
    'document_requirements_full_read',
    'document_reviews_full_read',
    'document_slots_full_read',
    'document_validation_events_full_read',
    'document_versions_full_read',
    'payment_events_full_read',
    'payment_evidence_full_read',
    'payment_obligations_full_read',
    'stop_factor_events_full_read',
    'stop_factors_full_read'
  ];
  actual TEXT[];
  table_name TEXT;
  role_name TEXT;
  privilege_name TEXT;
  should_select BOOLEAN;
  violation TEXT;
BEGIN
  SELECT array_agg(policyname ORDER BY policyname)
  INTO actual
  FROM pg_policies
  WHERE schemaname = 'platform'
    AND tablename = ANY (p2e_tables);

  IF actual IS DISTINCT FROM expected_policies THEN
    RAISE EXCEPTION
      'P2E policy inventory mismatch: expected %, found %',
      expected_policies,
      actual;
  END IF;

  SELECT string_agg(
    format(
      '%I.%I(policy=%I,cmd=%s,roles=%s,permissive=%s)',
      policy_row.schemaname,
      policy_row.tablename,
      policy_row.policyname,
      policy_row.cmd,
      policy_row.roles,
      policy_row.permissive
    ),
    ', '
    ORDER BY policy_row.tablename, policy_row.policyname
  )
  INTO violation
  FROM pg_policies AS policy_row
  WHERE policy_row.schemaname = 'platform'
    AND policy_row.tablename = ANY (p2e_tables)
    AND (
      policy_row.cmd <> 'SELECT'
      OR policy_row.roles IS DISTINCT FROM ARRAY['authenticated']::NAME[]
      OR policy_row.permissive <> 'PERMISSIVE'
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2E base-table policies are not authenticated SELECT-only: %',
      violation;
  END IF;

  FOREACH table_name IN ARRAY p2e_tables LOOP
    should_select := table_name = ANY (authenticated_select_tables);

    IF has_table_privilege(
      'authenticated',
      format('platform.%I', table_name),
      'SELECT'
    ) IS DISTINCT FROM should_select THEN
      RAISE EXCEPTION
        'authenticated SELECT grant mismatch for platform.%: expected %',
        table_name,
        should_select;
    END IF;

    FOREACH privilege_name IN ARRAY ARRAY[
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ] LOOP
      IF has_table_privilege(
        'authenticated',
        format('platform.%I', table_name),
        privilege_name
      ) THEN
        RAISE EXCEPTION
          'authenticated unexpectedly has % on platform.%',
          privilege_name,
          table_name;
      END IF;
    END LOOP;

    FOREACH role_name IN ARRAY ARRAY[
      'anon',
      'service_role',
      'supabase_auth_admin'
    ] LOOP
      FOREACH privilege_name IN ARRAY ARRAY[
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER'
      ] LOOP
        IF has_table_privilege(
          role_name,
          format('platform.%I', table_name),
          privilege_name
        ) THEN
          RAISE EXCEPTION
            '% unexpectedly has % on platform.%',
            role_name,
            privilege_name,
            table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  SELECT string_agg(
    format('%I.%I:%s', namespace.nspname, relation.relname, privilege.privilege_type),
    ', '
    ORDER BY relation.relname, privilege.privilege_type
  )
  INTO violation
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(relation.relacl, acldefault('r', relation.relowner))
  ) AS privilege
  WHERE namespace.nspname = 'platform'
    AND relation.relname = ANY (p2e_tables)
    AND privilege.grantee = 0;

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'PUBLIC retained a P2E table privilege: %',
      violation;
  END IF;
END
$$;

\echo 'P2E RLS policy and table-grant inventory passed'

DO $$
DECLARE
  authenticated_api CONSTANT TEXT[] := ARRAY[
    'platform.case_finance_summaries()',
    'platform.create_document_requirement(uuid,text,text,text,bigint,text,text,text,uuid)',
    'platform.create_document_slot(uuid,uuid,uuid,timestamp with time zone,text,uuid)',
    'platform.create_individual_notification(uuid,uuid,text,text,text,text,uuid)',
    'platform.create_payment_obligation(uuid,uuid,text,platform.obligation_category,bigint,text,timestamp with time zone,text,text,uuid)',
    'platform.create_stop_factor(uuid,uuid,uuid,uuid,text,text,text,text,uuid)',
    'platform.mark_own_notification_read(uuid,uuid,uuid)',
    'platform.my_notifications()',
    'platform.record_payment_event(uuid,uuid,platform.payment_event_type,uuid,bigint,text,timestamp with time zone,text,text,text,uuid)',
    'platform.resolve_stop_factor(uuid,uuid,platform.stop_factor_resolution_kind,uuid,text,text,uuid)',
    'platform.retire_document_requirement(uuid,uuid,text,uuid)',
    'platform.review_document_version(uuid,uuid,platform.document_review_decision,text,uuid)',
    'platform.sales_document_checklist()',
    'platform.set_own_notification_consent(uuid,platform.notification_consent_status,text,text,uuid)',
    'platform.student_portal_documents()',
    'platform.student_portal_finance()'
  ];
  service_api CONSTANT TEXT[] := ARRAY[
    'platform.attest_document_validation(uuid,uuid,platform.document_integrity_status,platform.document_malware_status,text,text,uuid)',
    'platform.record_document_version_metadata(uuid,uuid,uuid,text,text,bigint,text,text,uuid)'
  ];
  helper_names CONSTANT TEXT[] := ARRAY[
    'derive_obligation_status',
    'guard_p2e_parent_transition',
    'lock_p2e_request',
    'membership_has_active_scope',
    'platform_can_read_document_full',
    'platform_can_read_document_requirement',
    'platform_can_read_finance_full',
    'require_finance_actor',
    'require_notification_actor',
    'require_p2e_admin_actor'
  ];
  signature TEXT;
  routine_oid OID;
  violation TEXT;
BEGIN
  FOREACH signature IN ARRAY authenticated_api LOOP
    routine_oid := to_regprocedure(signature);
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION 'Missing P2E authenticated API: %', signature;
    END IF;

    IF NOT has_function_privilege(
      'authenticated',
      routine_oid,
      'EXECUTE'
    ) OR has_function_privilege(
      'anon',
      routine_oid,
      'EXECUTE'
    ) OR has_function_privilege(
      'service_role',
      routine_oid,
      'EXECUTE'
    ) OR has_function_privilege(
      'supabase_auth_admin',
      routine_oid,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'Authenticated-only P2E API grant mismatch: %',
        signature;
    END IF;
  END LOOP;

  FOREACH signature IN ARRAY service_api LOOP
    routine_oid := to_regprocedure(signature);
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION 'Missing P2E service API: %', signature;
    END IF;

    IF NOT has_function_privilege(
      'service_role',
      routine_oid,
      'EXECUTE'
    ) OR has_function_privilege(
      'authenticated',
      routine_oid,
      'EXECUTE'
    ) OR has_function_privilege(
      'anon',
      routine_oid,
      'EXECUTE'
    ) OR has_function_privilege(
      'supabase_auth_admin',
      routine_oid,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'Service-only P2E API grant mismatch: %',
        signature;
    END IF;
  END LOOP;

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
  WHERE namespace.nspname IN ('platform', 'platform_private', 'private')
    AND (
      routine.oid = ANY (
        ARRAY(
          SELECT to_regprocedure(api_signature)
          FROM unnest(authenticated_api || service_api)
            AS api(api_signature)
        )
      )
      OR routine.proname = ANY (helper_names)
    )
    AND (
      owner_role.rolname <> 'postgres'
      OR NOT routine.prosecdef
      OR array_to_string(routine.proconfig, ',')
        IS DISTINCT FROM 'search_path=""'
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2E SECURITY DEFINER routine owner/search_path mismatch: %',
      violation;
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
  CROSS JOIN LATERAL aclexplode(
    COALESCE(routine.proacl, acldefault('f', routine.proowner))
  ) AS privilege
  WHERE namespace.nspname IN ('platform', 'platform_private', 'private')
    AND (
      routine.oid = ANY (
        ARRAY(
          SELECT to_regprocedure(api_signature)
          FROM unnest(authenticated_api || service_api)
            AS api(api_signature)
        )
      )
      OR routine.proname = ANY (helper_names)
    )
    AND privilege.grantee = 0
    AND privilege.privilege_type = 'EXECUTE';

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'PUBLIC retained EXECUTE on a P2E routine: %',
      violation;
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'private.platform_can_read_document_full(uuid,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'private.platform_can_read_document_requirement(uuid,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'private.platform_can_read_finance_full(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'private.platform_can_read_document_full(uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'private.platform_can_read_finance_full(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'P2E private RLS-helper EXECUTE inventory is not least privilege';
  END IF;

  SELECT string_agg(
    format('%I.%I', namespace.nspname, relation.relname),
    ', '
    ORDER BY relation.relname
  )
  INTO violation
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'platform'
    AND relation.relkind IN ('v', 'm');

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2E privileged projections must be fixed functions, not views: %',
      violation;
  END IF;
END
$$;

\echo 'P2E SECURITY DEFINER and function-grant inventory passed'

DO $$
DECLARE
  actual_columns TEXT[];
  mismatch TEXT;
BEGIN
  SELECT array_agg(argument.name ORDER BY argument.ordinality)
  INTO actual_columns
  FROM pg_proc AS routine
  CROSS JOIN LATERAL unnest(
    routine.proallargtypes,
    routine.proargmodes,
    routine.proargnames
  ) WITH ORDINALITY AS argument(type_oid, mode, name, ordinality)
  WHERE routine.oid =
      'platform.sales_document_checklist()'::REGPROCEDURE
    AND argument.mode IN ('o', 't');

  IF actual_columns IS DISTINCT FROM ARRAY[
    'case_id',
    'document_slot_id',
    'requirement_key',
    'requirement_label',
    'instructions',
    'checklist_version',
    'slot_status',
    'deadline',
    'next_action'
  ]::TEXT[] THEN
    RAISE EXCEPTION
      'Sales document projection shape drifted: %',
      actual_columns;
  END IF;

  SELECT array_agg(argument.name ORDER BY argument.ordinality)
  INTO actual_columns
  FROM pg_proc AS routine
  CROSS JOIN LATERAL unnest(
    routine.proallargtypes,
    routine.proargmodes,
    routine.proargnames
  ) WITH ORDINALITY AS argument(type_oid, mode, name, ordinality)
  WHERE routine.oid =
      'platform.student_portal_documents()'::REGPROCEDURE
    AND argument.mode IN ('o', 't');

  IF actual_columns IS DISTINCT FROM ARRAY[
    'case_id',
    'document_slot_id',
    'requirement_key',
    'requirement_label',
    'instructions',
    'slot_status',
    'deadline',
    'next_action',
    'document_version_id',
    'version_no',
    'original_filename',
    'declared_mime_type',
    'byte_size',
    'submitted_at',
    'review_decision',
    'rework_reason',
    'reviewed_at'
  ]::TEXT[] THEN
    RAISE EXCEPTION
      'Student document projection shape drifted: %',
      actual_columns;
  END IF;

  SELECT array_agg(argument.name ORDER BY argument.ordinality)
  INTO actual_columns
  FROM pg_proc AS routine
  CROSS JOIN LATERAL unnest(
    routine.proallargtypes,
    routine.proargmodes,
    routine.proargnames
  ) WITH ORDINALITY AS argument(type_oid, mode, name, ordinality)
  WHERE routine.oid =
      'platform.case_finance_summaries()'::REGPROCEDURE
    AND argument.mode IN ('o', 't');

  IF actual_columns IS DISTINCT FROM ARRAY[
    'case_id',
    'payment_obligation_id',
    'obligation_label',
    'category',
    'amount_minor',
    'currency',
    'due_at',
    'derived_status',
    'overdue',
    'next_action',
    'has_active_stop_factor',
    'blocked_action'
  ]::TEXT[] THEN
    RAISE EXCEPTION
      'Staff finance projection shape drifted: %',
      actual_columns;
  END IF;

  SELECT array_agg(argument.name ORDER BY argument.ordinality)
  INTO actual_columns
  FROM pg_proc AS routine
  CROSS JOIN LATERAL unnest(
    routine.proallargtypes,
    routine.proargmodes,
    routine.proargnames
  ) WITH ORDINALITY AS argument(type_oid, mode, name, ordinality)
  WHERE routine.oid =
      'platform.student_portal_finance()'::REGPROCEDURE
    AND argument.mode IN ('o', 't');

  IF actual_columns IS DISTINCT FROM ARRAY[
    'case_id',
    'payment_obligation_id',
    'obligation_label',
    'category',
    'amount_minor',
    'currency',
    'due_at',
    'derived_status',
    'overdue',
    'next_action'
  ]::TEXT[] THEN
    RAISE EXCEPTION
      'Student finance projection shape drifted: %',
      actual_columns;
  END IF;

  SELECT array_agg(argument.name ORDER BY argument.ordinality)
  INTO actual_columns
  FROM pg_proc AS routine
  CROSS JOIN LATERAL unnest(
    routine.proallargtypes,
    routine.proargmodes,
    routine.proargnames
  ) WITH ORDINALITY AS argument(type_oid, mode, name, ordinality)
  WHERE routine.oid =
      'platform.my_notifications()'::REGPROCEDURE
    AND argument.mode IN ('o', 't');

  IF actual_columns IS DISTINCT FROM ARRAY[
    'notification_id',
    'student_case_id',
    'category',
    'title',
    'body',
    'created_at',
    'read_at',
    'in_app_status',
    'individual_whatsapp_status'
  ]::TEXT[] THEN
    RAISE EXCEPTION
      'Self notification projection shape drifted: %',
      actual_columns;
  END IF;

  WITH p2e_permission(permission_key) AS (
    SELECT unnest(ARRAY[
      'document.read.full',
      'document.manage',
      'document.review',
      'document.read.sales',
      'document.read.self',
      'finance.read.full',
      'finance.manage',
      'finance.event.confirm',
      'finance.stop.manage',
      'finance.read.summary',
      'finance.read.self',
      'notification.create',
      'notification.read.self',
      'notification.consent.self'
    ]::TEXT[])
  ),
  expected(role_name, permission_key) AS (
    SELECT 'admin', permission_key
    FROM p2e_permission
    UNION ALL
    SELECT *
    FROM (
      VALUES
        ('sales', 'document.read.sales'),
        ('sales', 'finance.read.summary'),
        ('sales', 'notification.create'),
        ('sales', 'notification.read.self'),
        ('sales', 'notification.consent.self'),
        ('curator', 'document.read.full'),
        ('curator', 'document.manage'),
        ('curator', 'document.review'),
        ('curator', 'finance.read.summary'),
        ('curator', 'notification.create'),
        ('curator', 'notification.read.self'),
        ('curator', 'notification.consent.self'),
        ('finance', 'finance.read.full'),
        ('finance', 'finance.manage'),
        ('finance', 'finance.event.confirm'),
        ('finance', 'finance.stop.manage'),
        ('finance', 'notification.create'),
        ('finance', 'notification.read.self'),
        ('finance', 'notification.consent.self'),
        ('student', 'document.read.self'),
        ('student', 'finance.read.self'),
        ('student', 'notification.read.self'),
        ('student', 'notification.consent.self')
    ) AS assignment(role_name, permission_key)
  ),
  actual AS (
    SELECT
      bundle.role::TEXT AS role_name,
      assignment.permission_key
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS assignment
      ON assignment.bundle_id = bundle.id
      AND assignment.bundle_role = bundle.role
    JOIN p2e_permission
      ON p2e_permission.permission_key = assignment.permission_key
    WHERE bundle.version = 3
      AND bundle.status = 'published'
  ),
  difference AS (
    SELECT
      COALESCE(expected.role_name, actual.role_name) AS role_name,
      COALESCE(
        expected.permission_key,
        actual.permission_key
      ) AS permission_key,
      CASE
        WHEN expected.role_name IS NULL THEN 'unexpected'
        ELSE 'missing'
      END AS difference_kind
    FROM expected
    FULL JOIN actual
      ON actual.role_name = expected.role_name
      AND actual.permission_key = expected.permission_key
    WHERE expected.role_name IS NULL
      OR actual.role_name IS NULL
  )
  SELECT string_agg(
    format('%s:%s:%s', role_name, permission_key, difference_kind),
    ', '
    ORDER BY role_name, permission_key
  )
  INTO mismatch
  FROM difference;

  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'P2E v3 permission matrix mismatch: %', mismatch;
  END IF;

  IF (
    SELECT count(*)
    FROM platform.role_bundle_versions
    WHERE version = 3
      AND status = 'published'
      AND id IN (
        '00000000-0000-4000-8000-000000000201',
        '00000000-0000-4000-8000-000000000202',
        '00000000-0000-4000-8000-000000000203',
        '00000000-0000-4000-8000-000000000204',
        '00000000-0000-4000-8000-000000000205'
      )
  ) <> 5 OR (
    SELECT count(*)
    FROM platform.role_bundle_versions
    WHERE version = 2
      AND status = 'published'
  ) <> 5 THEN
    RAISE EXCEPTION
      'Immutable published v2/v3 bundle inventory is incomplete';
  END IF;
END
$$;

\echo 'P2E fixed projection and v3 permission inventory passed'
