\set ON_ERROR_STOP on

-- Catalog programme structure, ACL and validator inventory at the exact
-- migration-079 boundary. No fixture row is created and nothing is mutated.
DO $$
DECLARE
  checked_table_name TEXT;
  checked_relation REGCLASS;
  checked_role TEXT;
BEGIN
  -- Programme levels. `transfer_programme` exists because INTI American and
  -- Australian Degree Transfer routes are not foundation, diploma or bachelor.
  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'catalog_programme_level'
  ) IS DISTINCT FROM ARRAY[
    'foundation', 'certificate', 'diploma', 'pre_university',
    'bachelor', 'master', 'doctoral', 'transfer_programme'
  ]::NAME[] THEN
    RAISE EXCEPTION 'Catalog programme level enum drifted';
  END IF;

  -- Study mode is a dimension because a third of measured programmes state
  -- duration per mode.
  IF (
    SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'catalog_study_mode'
  ) IS DISTINCT FROM ARRAY['full_time', 'part_time', 'online']::NAME[] THEN
    RAISE EXCEPTION 'Catalog study mode enum drifted';
  END IF;

  -- The knowledge vault source kind must exist and must be appended last so
  -- earlier stored values keep their sort order.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'workflow_source_kind'
      AND enum_value.enumlabel = 'knowledge_vault'
  ) THEN
    RAISE EXCEPTION 'knowledge_vault source kind is missing';
  END IF;

  -- Both relations must force row level security, not merely enable it.
  FOREACH checked_table_name IN ARRAY ARRAY[
    'catalog_programmes',
    'catalog_programme_candidates'
  ] LOOP
    checked_relation := format('platform.%I', checked_table_name)::REGCLASS;

    IF NOT (
      SELECT relrowsecurity AND relforcerowsecurity
      FROM pg_class
      WHERE oid = checked_relation
    ) THEN
      RAISE EXCEPTION
        'Row level security is not forced on platform.%', checked_table_name;
    END IF;

    -- No browser-facing or service role may hold direct table privileges
    -- beyond the SELECT that the policies then narrow.
    FOREACH checked_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'platform'
          AND table_name = checked_table_name
          AND grantee = checked_role
      ) THEN
        RAISE EXCEPTION
          'Role % unexpectedly holds a grant on platform.%',
          checked_role, checked_table_name;
      END IF;
    END LOOP;

    IF (
      SELECT array_agg(DISTINCT privilege_type::TEXT ORDER BY privilege_type::TEXT)
      FROM information_schema.role_table_grants
      WHERE table_schema = 'platform'
        AND table_name = checked_table_name
        AND grantee = 'authenticated'
    ) IS DISTINCT FROM ARRAY['SELECT']::TEXT[] THEN
      RAISE EXCEPTION
        'authenticated must hold exactly SELECT on platform.%',
        checked_table_name;
    END IF;
  END LOOP;

  -- Teaching language was found in zero of 104 measured documents, so the
  -- column must not exist: an always-empty column invites a guess.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'catalog_programmes'
      AND column_name IN ('study_language', 'tuition', 'tuition_amount')
  ) THEN
    RAISE EXCEPTION
      'catalog_programmes gained a column the source cannot fill';
  END IF;

  -- Duration must stay nullable: a NULL records the absence of a literal fact.
  IF (
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'catalog_programmes'
      AND column_name = 'duration_months'
  ) IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'duration_months must remain nullable';
  END IF;

  -- Uniqueness must include level and study mode.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'platform'
      AND indexname = 'catalog_programmes_normalized_key'
      AND indexdef LIKE '%programme_level%'
      AND indexdef LIKE '%study_mode%'
  ) THEN
    RAISE EXCEPTION
      'catalog_programmes uniqueness must include level and study mode';
  END IF;
END
$$;

-- The knowledge vault source form accepts only the synthetic identifier and
-- never a filesystem path.
DO $$
BEGIN
  IF NOT platform_private.is_safe_workflow_source_url(
    'knowledge_vault',
    'evo-knowledge://internal/' || repeat('a', 64)
  ) THEN
    RAISE EXCEPTION 'A valid knowledge vault source identifier was rejected';
  END IF;

  IF platform_private.is_safe_workflow_source_url(
    'knowledge_vault',
    'file:///home/user/vault/document.md'
  ) THEN
    RAISE EXCEPTION 'A filesystem path was accepted as a vault source';
  END IF;

  IF platform_private.is_safe_workflow_source_url(
    'knowledge_vault',
    'evo-knowledge://internal/abc'
  ) THEN
    RAISE EXCEPTION 'A malformed digest was accepted as a vault source';
  END IF;

  IF platform_private.is_safe_workflow_source_url(
    'knowledge_vault',
    'evo-knowledge://client/' || repeat('a', 64)
  ) THEN
    RAISE EXCEPTION 'A non-internal audience was accepted as a vault source';
  END IF;
END
$$;

-- Intake months accept only a bounded, unique, ascending set.
DO $$
BEGIN
  IF NOT platform_private.catalog_intake_months_are_valid(
    ARRAY[1, 5, 8]::SMALLINT[]
  ) THEN
    RAISE EXCEPTION 'A valid intake month set was rejected';
  END IF;

  IF NOT platform_private.catalog_intake_months_are_valid(
    '{}'::SMALLINT[]
  ) THEN
    RAISE EXCEPTION 'An empty intake month set must be allowed';
  END IF;

  IF platform_private.catalog_intake_months_are_valid(
    ARRAY[0, 13]::SMALLINT[]
  ) THEN
    RAISE EXCEPTION 'An out-of-range intake month was accepted';
  END IF;

  IF platform_private.catalog_intake_months_are_valid(
    ARRAY[3, 3]::SMALLINT[]
  ) THEN
    RAISE EXCEPTION 'A duplicate intake month was accepted';
  END IF;

  IF platform_private.catalog_intake_months_are_valid(
    ARRAY[8, 1]::SMALLINT[]
  ) THEN
    RAISE EXCEPTION 'An unsorted intake month set was accepted';
  END IF;
END
$$;
