\set ON_ERROR_STOP on

-- BW4 catalog/ACL proof at the exact migration-054 boundary.
DO $$
DECLARE
  checked_relation REGCLASS;
  checked_table_name TEXT;
  role_name TEXT;
  privilege_name TEXT;
  routine REGPROCEDURE;
  authenticated_routines REGPROCEDURE[] := ARRAY[
    'platform.publish_ai_prompt_artifact_version(uuid,platform.ai_prompt_artifact_kind,text,text,text,text,uuid)'::REGPROCEDURE,
    'platform.retire_ai_prompt_artifact_version(uuid,uuid,bigint,text,uuid)'::REGPROCEDURE,
    'platform.admin_ai_prompt_artifact_catalog(uuid)'::REGPROCEDURE,
    'platform.create_decision_backlog_entry(uuid,uuid,uuid,text,platform.business_role,platform.decision_requirement_kind,uuid,platform.student_profile_field,uuid,text,text,uuid)'::REGPROCEDURE,
    'platform.transition_decision_backlog_entry(uuid,uuid,uuid,bigint,platform.decision_backlog_status,text,text,platform.business_role,platform.decision_requirement_kind,uuid,platform.student_profile_field,uuid,text,text,uuid)'::REGPROCEDURE,
    'platform.request_ai_draft_with_knowledge(uuid,uuid,uuid,platform.ai_draft_language,uuid,text,uuid)'::REGPROCEDURE,
    'platform.staff_conversation_bw4_workspace(uuid,uuid)'::REGPROCEDURE
  ];
  service_routine REGPROCEDURE :=
    'platform.complete_ai_draft_generation(uuid,uuid,uuid,text,text,text,text,uuid)'::REGPROCEDURE;
BEGIN
  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'decision_backlog_status'
  ) IS DISTINCT FROM ARRAY['unresolved', 'answered', 'retired']::NAME[] THEN
    RAISE EXCEPTION 'BW4 decision status enum drifted';
  END IF;

  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'decision_requirement_kind'
  ) IS DISTINCT FROM ARRAY[
    'general',
    'student_profile',
    'country_requirement',
    'document_requirement',
    'handoff'
  ]::NAME[] THEN
    RAISE EXCEPTION 'BW4 decision requirement enum drifted';
  END IF;

  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'ai_prompt_artifact_kind'
  ) IS DISTINCT FROM ARRAY['prompt_policy', 'business_context']::NAME[] THEN
    RAISE EXCEPTION 'BW4 prompt artifact kinds drifted';
  END IF;

  FOREACH checked_table_name IN ARRAY ARRAY[
    'decision_backlogs',
    'decision_backlog_versions',
    'ai_draft_request_prompt_selections'
  ] LOOP
    checked_relation := format('platform.%I', checked_table_name)::REGCLASS;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
      WHERE relation.oid = checked_relation
        AND namespace.nspname = 'platform'
        AND relation.relkind = 'r'
        AND owner_role.rolname = 'postgres'
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'BW4 platform.% must be postgres-owned with forced RLS',
        checked_table_name;
    END IF;

    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_table_privilege(role_name, checked_relation, 'SELECT') THEN
        RAISE EXCEPTION '% unexpectedly reads %', role_name, checked_relation;
      END IF;
    END LOOP;

    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ] LOOP
      FOREACH privilege_name IN ARRAY ARRAY[
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] LOOP
        IF has_table_privilege(role_name, checked_relation, privilege_name) THEN
          RAISE EXCEPTION '% unexpectedly has % on %',
            role_name, privilege_name, checked_relation;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  checked_relation :=
    'platform_private.ai_prompt_artifact_versions'::REGCLASS;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid = checked_relation
      AND namespace.nspname = 'platform_private'
      AND relation.relkind = 'r'
      AND owner_role.rolname = 'postgres'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Private BW4 prompt table lacks owner/RLS containment';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
  ] LOOP
    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
      IF has_table_privilege(role_name, checked_relation, privilege_name) THEN
        RAISE EXCEPTION '% unexpectedly has % on private prompt artifacts',
          role_name, privilege_name;
      END IF;
    END LOOP;
  END LOOP;

  IF has_table_privilege(
    'authenticated',
    'platform.decision_backlogs',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'platform.decision_backlog_versions',
    'SELECT'
  ) OR NOT has_table_privilege(
    'authenticated',
    'platform.ai_draft_request_prompt_selections',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'BW4 authenticated table read posture drifted';
  END IF;

  IF (
    SELECT array_agg(policyname::TEXT ORDER BY policyname)
    FROM pg_policies
    WHERE schemaname = 'platform'
      AND tablename = 'ai_draft_request_prompt_selections'
  ) IS DISTINCT FROM ARRAY[
    'ai_draft_request_prompt_selections_full_read'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW4 prompt selection policy inventory drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'ai_draft_request_prompt_selections'
      AND column_name IN ('content_text', 'raw_content', 'prompt_text')
  ) THEN
    RAISE EXCEPTION 'Raw prompt content leaked into the public selection table';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'ai_drafts'
      AND column_name = 'prompt_policy_artifact_version_id'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'ai_drafts'
      AND column_name = 'business_context_artifact_version_id'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'Historical-compatible AI draft prompt FK columns drifted';
  END IF;

  IF to_regprocedure(
    'platform.request_ai_draft(uuid,uuid,uuid,platform.ai_draft_language,text,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Superseded direct request_ai_draft RPC was reintroduced';
  END IF;

  FOREACH routine IN ARRAY authenticated_routines LOOP
    IF NOT has_function_privilege('authenticated', routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated lacks EXECUTE on %', routine;
    END IF;
    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(role_name, routine, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly executes %', role_name, routine;
      END IF;
    END LOOP;
  END LOOP;

  IF (
    SELECT procedure.provolatile
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'platform.staff_conversation_bw4_workspace(uuid,uuid)'::REGPROCEDURE
  ) IS DISTINCT FROM 'v'::"char" THEN
    RAISE EXCEPTION
      'BW4 workspace must remain VOLATILE for its locked authority helper';
  END IF;

  IF NOT has_function_privilege('service_role', service_routine, 'EXECUTE')
    OR has_function_privilege('authenticated', service_routine, 'EXECUTE')
    OR has_function_privilege('anon', service_routine, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'BW4 generation completion execute posture drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE (
      namespace.nspname = 'platform'
      AND procedure.proname IN (
        'publish_ai_prompt_artifact_version',
        'retire_ai_prompt_artifact_version',
        'admin_ai_prompt_artifact_catalog',
        'create_decision_backlog_entry',
        'transition_decision_backlog_entry',
        'request_ai_draft_with_knowledge',
        'complete_ai_draft_generation',
        'staff_conversation_bw4_workspace'
      )
    )
    AND (
      NOT procedure.prosecdef
      OR NOT (
        procedure.proconfig @> ARRAY['search_path=""']::TEXT[]
      )
    )
  ) THEN
    RAISE EXCEPTION 'BW4 public RPC hardening drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid =
      'platform_private.ai_prompt_artifact_versions'::REGCLASS
      AND tgname = 'ai_prompt_artifact_versions_transition_guard'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'platform.decision_backlog_versions'::REGCLASS
      AND tgname = 'decision_backlog_versions_append_only'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'platform.ai_drafts'::REGCLASS
      AND tgname = 'ai_drafts_prompt_pin_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'BW4 immutable-history trigger inventory drifted';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.role_bundle_versions
    WHERE version = 9 AND status = 'published'
  ) <> 5 THEN
    RAISE EXCEPTION 'BW4 requires five published v9 bundles';
  END IF;

  IF EXISTS (
    SELECT expected.role, expected.permission_key
    FROM (VALUES
      ('admin'::platform.business_role, 'decision.read'::TEXT),
      ('admin'::platform.business_role, 'decision.manage'::TEXT),
      ('admin'::platform.business_role, 'prompt.artifact.manage'::TEXT),
      ('sales'::platform.business_role, 'decision.read'::TEXT),
      ('sales'::platform.business_role, 'decision.manage'::TEXT),
      ('curator'::platform.business_role, 'decision.read'::TEXT),
      ('curator'::platform.business_role, 'decision.manage'::TEXT)
    ) AS expected(role, permission_key)
    EXCEPT
    SELECT bundle.role, permission.permission_key
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
    WHERE bundle.version = 9
  ) OR EXISTS (
    SELECT bundle.role, permission.permission_key
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
    WHERE bundle.version = 9
      AND permission.permission_key IN (
        'decision.read', 'decision.manage', 'prompt.artifact.manage'
      )
    EXCEPT
    SELECT *
    FROM (VALUES
      ('admin'::platform.business_role, 'decision.read'::TEXT),
      ('admin'::platform.business_role, 'decision.manage'::TEXT),
      ('admin'::platform.business_role, 'prompt.artifact.manage'::TEXT),
      ('sales'::platform.business_role, 'decision.read'::TEXT),
      ('sales'::platform.business_role, 'decision.manage'::TEXT),
      ('curator'::platform.business_role, 'decision.read'::TEXT),
      ('curator'::platform.business_role, 'decision.manage'::TEXT)
    ) AS expected(role, permission_key)
  ) THEN
    RAISE EXCEPTION 'BW4 v9 permission matrix drifted';
  END IF;

  IF EXISTS (
    SELECT v9.role, permission.permission_key
    FROM platform.role_bundle_versions AS v9
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v9.id
      AND permission.bundle_role = v9.role
    WHERE v9.version = 9
      AND permission.permission_key NOT IN (
        'decision.read', 'decision.manage', 'prompt.artifact.manage'
      )
    EXCEPT
    SELECT v8.role, permission.permission_key
    FROM platform.role_bundle_versions AS v8
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v8.id
      AND permission.bundle_role = v8.role
    WHERE v8.version = 8
  ) OR EXISTS (
    SELECT v8.role, permission.permission_key
    FROM platform.role_bundle_versions AS v8
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v8.id
      AND permission.bundle_role = v8.role
    WHERE v8.version = 8
    EXCEPT
    SELECT v9.role, permission.permission_key
    FROM platform.role_bundle_versions AS v9
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v9.id
      AND permission.bundle_role = v9.role
    WHERE v9.version = 9
  ) THEN
    RAISE EXCEPTION 'BW4 v9 bundles did not clone the complete v8 baseline';
  END IF;
END
$$;

SELECT 'platform decision and prompt lifecycle inventory passed' AS result;
