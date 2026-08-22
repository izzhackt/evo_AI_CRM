\set ON_ERROR_STOP on

-- Catalog-only P2D inventory. All assertions run against the disposable
-- migrated PostgreSQL database and do not infer safety from SQL source text.

DO $$
DECLARE
  domain_tables CONSTANT TEXT[] := ARRAY[
    'case_task_events',
    'case_tasks',
    'student_case_assignment_events',
    'student_case_lifecycle_events',
    'student_case_updates',
    'student_cases',
    'university_application_events',
    'university_applications',
    'visa_case_events',
    'visa_cases'
  ];
  expected_policies CONSTANT TEXT[] := ARRAY[
    'case_task_events_staff_read',
    'case_tasks_staff_read',
    'student_case_assignment_events_staff_read',
    'student_case_lifecycle_events_staff_read',
    'student_case_updates_staff_read',
    'student_cases_staff_read',
    'university_application_events_staff_read',
    'university_applications_staff_read',
    'visa_case_events_staff_read',
    'visa_cases_staff_read'
  ];
  actual_tables TEXT[];
  actual_policies TEXT[];
  relation_record RECORD;
  role_name TEXT;
  privilege_name TEXT;
  violation TEXT;
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
  INTO actual_tables
  FROM information_schema.tables
  WHERE table_schema = 'platform'
    AND table_name = ANY (domain_tables)
    AND table_type = 'BASE TABLE';

  IF actual_tables IS DISTINCT FROM domain_tables THEN
    RAISE EXCEPTION
      'P2D domain table inventory mismatch: expected %, found %',
      domain_tables,
      actual_tables;
  END IF;

  SELECT string_agg(
    format('%I.%I(owner=%I,rls=%s,forced=%s)',
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
    AND relation.relkind IN ('r', 'p')
    AND (
      owner_role.rolname <> 'postgres'
      OR NOT relation.relrowsecurity
      OR NOT relation.relforcerowsecurity
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'Every platform table must be postgres-owned with enabled+forced RLS: %',
      violation;
  END IF;

  SELECT string_agg(
    format('%I.%I:%I',
      child_namespace.nspname,
      child.relname,
      constraint_record.conname
    ),
    ', '
    ORDER BY child.relname, constraint_record.conname
  )
  INTO violation
  FROM pg_constraint AS constraint_record
  JOIN pg_class AS child
    ON child.oid = constraint_record.conrelid
  JOIN pg_namespace AS child_namespace
    ON child_namespace.oid = child.relnamespace
  JOIN pg_class AS parent
    ON parent.oid = constraint_record.confrelid
  JOIN pg_namespace AS parent_namespace
    ON parent_namespace.oid = parent.relnamespace
  WHERE constraint_record.contype = 'f'
    AND constraint_record.confdeltype = 'c'
    AND (
      child_namespace.nspname = 'platform'
      OR parent_namespace.nspname = 'platform'
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'Platform foreign keys must not cascade deletes: %',
      violation;
  END IF;

  SELECT string_agg(
    format('%I.%I:%I(%s)',
      namespace.nspname,
      relation.relname,
      foreign_key.conname,
      foreign_key.conkey
    ),
    ', '
    ORDER BY relation.relname, foreign_key.conname
  )
  INTO violation
  FROM pg_constraint AS foreign_key
  JOIN pg_class AS relation
    ON relation.oid = foreign_key.conrelid
  JOIN pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'platform'
    AND foreign_key.contype = 'f'
    AND cardinality(foreign_key.conkey) > 1
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index AS candidate_index
      WHERE candidate_index.indrelid = foreign_key.conrelid
        AND candidate_index.indisvalid
        AND candidate_index.indisready
        AND candidate_index.indpred IS NULL
        AND ARRAY(
          SELECT candidate_index.indkey[position - 1]::SMALLINT
          FROM generate_series(
            1,
            cardinality(foreign_key.conkey)
          ) AS position
          ORDER BY position
        ) = foreign_key.conkey
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'Composite Platform foreign keys need matching leading indexes: %',
      violation;
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
  INTO actual_policies
  FROM pg_policies
  WHERE schemaname = 'platform'
    AND tablename = ANY (domain_tables);

  IF actual_policies IS DISTINCT FROM expected_policies THEN
    RAISE EXCEPTION
      'P2D RLS policy inventory mismatch: expected %, found %',
      expected_policies,
      actual_policies;
  END IF;

  SELECT string_agg(
    format('%I.%I(cmd=%s,roles=%s,check=%s)',
      schemaname,
      tablename,
      cmd,
      roles,
      with_check
    ),
    ', '
    ORDER BY tablename, policyname
  )
  INTO violation
  FROM pg_policies
  WHERE schemaname = 'platform'
    AND tablename = ANY (domain_tables)
    AND (
      cmd <> 'SELECT'
      OR roles IS DISTINCT FROM ARRAY['authenticated']::NAME[]
      OR with_check IS NOT NULL
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2D tables may expose authenticated SELECT policies only: %',
      violation;
  END IF;

  FOR relation_record IN
    SELECT relation.oid, relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform'
      AND relation.relname = ANY (domain_tables)
      AND relation.relkind IN ('r', 'p')
  LOOP
    IF NOT has_table_privilege(
      'authenticated',
      relation_record.oid,
      'SELECT'
    ) THEN
      RAISE EXCEPTION
        'authenticated lacks SELECT on platform.%',
        relation_record.relname;
    END IF;

    FOREACH privilege_name IN ARRAY ARRAY[
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    LOOP
      IF has_table_privilege(
        'authenticated',
        relation_record.oid,
        privilege_name
      ) THEN
        RAISE EXCEPTION
          'authenticated unexpectedly has % on platform.%',
          privilege_name,
          relation_record.relname;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(
          (SELECT relation.relacl
           FROM pg_class AS relation
           WHERE relation.oid = relation_record.oid),
          acldefault('r', (SELECT relation.relowner
                           FROM pg_class AS relation
                           WHERE relation.oid = relation_record.oid))
        )
      ) AS privilege
      WHERE privilege.grantee = 0
    ) THEN
      RAISE EXCEPTION
        'PUBLIC unexpectedly has a privilege on platform.%',
        relation_record.relname;
    END IF;

    FOREACH role_name IN ARRAY ARRAY[
      'anon',
      'service_role',
      'supabase_auth_admin'
    ]
    LOOP
      FOREACH privilege_name IN ARRAY ARRAY[
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER'
      ]
      LOOP
        IF has_table_privilege(
          role_name,
          relation_record.oid,
          privilege_name
        ) THEN
          RAISE EXCEPTION
            '% unexpectedly has % on platform.%',
            role_name,
            privilege_name,
            relation_record.relname;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$$;

DO $$
DECLARE
  public_api CONSTANT TEXT[] := ARRAY[
    'append_student_case_update',
    'assign_student_case_curator',
    'change_case_task',
    'change_student_case_state',
    'change_university_application',
    'change_visa_case',
    'create_case_task',
    'create_pending_student_case',
    'create_university_application',
    'create_visa_case',
    'set_student_case_route',
    'student_portal_applications',
    'student_portal_cases',
    'student_portal_tasks',
    'student_portal_updates',
    'student_portal_visa_cases'
  ];
  authenticated_api CONSTANT TEXT[] := ARRAY[
    'append_student_case_update',
    'assign_student_case_curator',
    'change_case_task',
    'change_student_case_state',
    'change_university_application',
    'change_visa_case',
    'create_case_task',
    'create_university_application',
    'create_visa_case',
    'set_student_case_route',
    'student_portal_applications',
    'student_portal_cases',
    'student_portal_tasks',
    'student_portal_updates',
    'student_portal_visa_cases'
  ];
  actual_api TEXT[];
  routine RECORD;
  role_name TEXT;
  unsafe_routine TEXT;
  projection_view TEXT;
BEGIN
  SELECT array_agg(routine_record.proname ORDER BY routine_record.proname)
  INTO actual_api
  FROM pg_proc AS routine_record
  JOIN pg_namespace AS namespace
    ON namespace.oid = routine_record.pronamespace
  WHERE namespace.nspname = 'platform'
    AND routine_record.proname = ANY (public_api);

  IF actual_api IS DISTINCT FROM public_api THEN
    RAISE EXCEPTION
      'P2D public API inventory mismatch: expected %, found %',
      public_api,
      actual_api;
  END IF;

  SELECT string_agg(
    format('%I.%I(%s)',
      namespace.nspname,
      routine_record.proname,
      pg_get_function_identity_arguments(routine_record.oid)
    ),
    ', '
    ORDER BY namespace.nspname, routine_record.proname
  )
  INTO unsafe_routine
  FROM pg_proc AS routine_record
  JOIN pg_namespace AS namespace
    ON namespace.oid = routine_record.pronamespace
  WHERE namespace.nspname IN ('platform', 'platform_private', 'private')
    AND (
      routine_record.proname = ANY (public_api)
      OR routine_record.proname IN (
        'application_status_needs_evidence',
        'block_domain_delete',
        'guard_student_case_transition',
        'lock_p2d_request',
        'platform_can_read_student_case',
        'platform_can_read_student_portal_case',
        'protect_domain_identity',
        'protect_student_case_scope',
        'require_case_operator',
        'require_domain_actor',
        'require_live_task_assignee',
        'visa_status_needs_evidence'
      )
    )
    AND (
      NOT routine_record.prosecdef
      OR array_to_string(routine_record.proconfig, ',')
        IS DISTINCT FROM 'search_path=""'
    );

  IF unsafe_routine IS NOT NULL THEN
    RAISE EXCEPTION
      'P2D SECURITY DEFINER routine lacks empty search_path: %',
      unsafe_routine;
  END IF;

  FOR routine IN
    SELECT
      routine_record.oid,
      routine_record.proname,
      pg_get_function_identity_arguments(routine_record.oid) AS arguments
    FROM pg_proc AS routine_record
    JOIN pg_namespace AS namespace
      ON namespace.oid = routine_record.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine_record.proname = ANY (public_api)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_proc AS privilege_routine
      CROSS JOIN LATERAL aclexplode(
        COALESCE(
          privilege_routine.proacl,
          acldefault('f', privilege_routine.proowner)
        )
      ) AS privilege
      WHERE privilege_routine.oid = routine.oid
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    )
      OR has_function_privilege('anon', routine.oid, 'EXECUTE')
      OR has_function_privilege(
        'supabase_auth_admin',
        routine.oid,
        'EXECUTE'
      )
    THEN
      RAISE EXCEPTION
        'Unexpected broad EXECUTE on platform.%(%)',
        routine.proname,
        routine.arguments;
    END IF;

    IF routine.proname = 'create_pending_student_case' THEN
      IF has_function_privilege(
        'authenticated',
        routine.oid,
        'EXECUTE'
      ) OR NOT has_function_privilege(
        'service_role',
        routine.oid,
        'EXECUTE'
      ) THEN
        RAISE EXCEPTION
          'create_pending_student_case must be service-role-only';
      END IF;
    ELSE
      IF NOT has_function_privilege(
        'authenticated',
        routine.oid,
        'EXECUTE'
      ) OR has_function_privilege(
        'service_role',
        routine.oid,
        'EXECUTE'
      ) THEN
        RAISE EXCEPTION
          'platform.%(%) must be authenticated-only',
          routine.proname,
          routine.arguments;
      END IF;
    END IF;
  END LOOP;

  IF NOT has_function_privilege(
    'authenticated',
    'private.platform_can_read_student_case(uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'private.platform_can_read_student_case(uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'private.platform_can_read_student_portal_case(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'P2D private read-helper EXECUTE inventory is not least privilege';
  END IF;

  SELECT string_agg(
    format('%I.%I', namespace.nspname, relation.relname),
    ', '
    ORDER BY relation.relname
  )
  INTO projection_view
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'platform'
    AND relation.relkind IN ('v', 'm');

  IF projection_view IS NOT NULL THEN
    RAISE EXCEPTION
      'Privileged Platform projections must be fixed functions, not normal views: %',
      projection_view;
  END IF;
END
$$;

\echo 'P2D catalog/grant inventory passed'
