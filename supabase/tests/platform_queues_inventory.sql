\set ON_ERROR_STOP on

-- Catalog-only P2G inventory. Assertions inspect the disposable database after
-- migration 045. They prove queue schema, grants, RLS, role-bundle and source
-- contracts only. They do not treat metadata as proof that a worker, provider,
-- Queue consumer or delivery path ran.

DO $$
DECLARE
  private_tables CONSTANT TEXT[] := ARRAY[
    'durable_work_attempts',
    'durable_work_dead_letters',
    'durable_work_events',
    'durable_work_idempotency',
    'durable_work_items'
  ];
  public_tables CONSTANT TEXT[] := ARRAY[
    'work_review_cases',
    'work_review_events'
  ];
  all_tables CONSTANT TEXT[] := ARRAY[
    'durable_work_attempts',
    'durable_work_dead_letters',
    'durable_work_events',
    'durable_work_idempotency',
    'durable_work_items',
    'work_review_cases',
    'work_review_events'
  ];
  actual TEXT[];
  missing TEXT;
  violation TEXT;
  routine_source TEXT;
  queue_payload_source TEXT;
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
  INTO actual
  FROM information_schema.tables
  WHERE table_schema = 'platform_private'
    AND table_name = ANY (private_tables)
    AND table_type = 'BASE TABLE';

  IF actual IS DISTINCT FROM private_tables THEN
    RAISE EXCEPTION
      'P2G private table inventory mismatch: expected %, found %',
      private_tables,
      actual;
  END IF;

  SELECT array_agg(table_name ORDER BY table_name)
  INTO actual
  FROM information_schema.tables
  WHERE table_schema = 'platform'
    AND table_name = ANY (public_tables)
    AND table_type = 'BASE TABLE';

  IF actual IS DISTINCT FROM public_tables THEN
    RAISE EXCEPTION
      'P2G public table inventory mismatch: expected %, found %',
      public_tables,
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
    ORDER BY namespace.nspname, relation.relname
  )
  INTO violation
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  JOIN pg_roles AS owner_role
    ON owner_role.oid = relation.relowner
  WHERE relation.relkind = 'r'
    AND (
      (
        namespace.nspname = 'platform_private'
        AND relation.relname = ANY (private_tables)
      )
      OR (
        namespace.nspname = 'platform'
        AND relation.relname = ANY (public_tables)
      )
    )
    AND (
      owner_role.rolname <> 'postgres'
      OR NOT relation.relrowsecurity
      OR NOT relation.relforcerowsecurity
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2G queue/review RLS owner drifted: %',
      violation;
  END IF;

  IF enum_range(NULL::platform.durable_work_kind)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'provider_webhook_process',
        'ai_draft_generate',
        'manual_whatsapp_send'
      ]::TEXT[] THEN
    RAISE EXCEPTION
      'P2G durable_work_kind enum drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(enum_range(NULL::platform.durable_work_kind)::TEXT[]) AS label
    WHERE label ~ '(auto|reply|broadcast|campaign|ky|kyrgyz)'
  ) THEN
    RAISE EXCEPTION
      'P2G durable_work_kind leaked forbidden work classes';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.permission_definitions
    WHERE permission_key = 'workreview.read'
  ) OR NOT EXISTS (
    SELECT 1
    FROM platform.permission_definitions
    WHERE permission_key = 'workreview.resolve'
  ) THEN
    RAISE EXCEPTION
      'P2G work-review permissions are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = permission.bundle_id
    WHERE bundle.version = 5
      AND permission.permission_key IN ('workreview.read', 'workreview.resolve')
      AND bundle.role <> 'admin'
  ) OR (
    SELECT count(*)
    FROM platform.role_bundle_permissions AS permission
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = permission.bundle_id
    WHERE bundle.version = 5
      AND permission.permission_key IN ('workreview.read', 'workreview.resolve')
      AND bundle.role = 'admin'
      AND bundle.status = 'published'
  ) <> 2 THEN
    RAISE EXCEPTION
      'P2G work-review permissions are not Admin-only v5';
  END IF;

  SELECT string_agg(
    format('%I.%I.%I', expected.schema_name, expected.table_name, expected.column_name),
    ', '
    ORDER BY expected.schema_name, expected.table_name, expected.column_name
  )
  INTO missing
  FROM (
    VALUES
      ('platform_private', 'durable_work_items', 'organization_id'),
      ('platform_private', 'durable_work_items', 'kind'),
      ('platform_private', 'durable_work_items', 'request_id'),
      ('platform_private', 'durable_work_attempts', 'work_item_id'),
      ('platform_private', 'durable_work_events', 'work_item_id'),
      ('platform_private', 'durable_work_dead_letters', 'work_item_id'),
      ('platform_private', 'durable_work_idempotency', 'business_key_sha256'),
      ('platform', 'work_review_cases', 'organization_id'),
      ('platform', 'work_review_events', 'organization_id')
  ) AS expected(schema_name, table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = expected.schema_name
      AND column_row.table_name = expected.table_name
      AND column_row.column_name = expected.column_name
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'P2G minimum queue/review columns are missing: %',
      missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE (
        (
          column_row.table_schema = 'platform_private'
          AND column_row.table_name = ANY (private_tables)
        )
        OR (
          column_row.table_schema = 'platform'
          AND column_row.table_name = ANY (public_tables)
        )
      )
      AND column_row.column_name ~ '(body|raw|payload|token|secret|password)'
      AND column_row.column_name NOT IN (
        'business_key_sha256',
        'error_payload_sha256',
        'evidence_ref',
        'request_id'
      )
  ) THEN
    RAISE EXCEPTION
      'P2G queue/review tables expose forbidden raw/body/secret columns';
  END IF;

  IF has_schema_privilege('anon', 'platform_private', 'USAGE')
    OR has_schema_privilege('authenticated', 'platform_private', 'USAGE')
    OR has_schema_privilege('anon', 'pgmq_public', 'USAGE')
    OR has_schema_privilege('authenticated', 'pgmq_public', 'USAGE') THEN
    RAISE EXCEPTION
      'Browser roles must not have platform_private or pgmq_public schema usage';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(all_tables) AS expected(table_name)
    WHERE has_table_privilege('anon', format(
      '%s.%s',
      CASE
        WHEN expected.table_name IN ('work_review_cases', 'work_review_events')
          THEN 'platform'
        ELSE 'platform_private'
      END,
      expected.table_name
    ), 'SELECT')
      OR has_table_privilege('authenticated', format(
        '%s.%s',
        CASE
          WHEN expected.table_name IN ('work_review_cases', 'work_review_events')
            THEN 'platform'
          ELSE 'platform_private'
        END,
        expected.table_name
      ), 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  ) THEN
    RAISE EXCEPTION
      'Browser or authenticated roles hold forbidden direct queue/review table privileges';
  END IF;

  SELECT regexp_replace(
    string_agg(routine.prosrc, E'\n' ORDER BY routine.proname),
    '[[:space:]]+',
    ' ',
    'g'
  )
  INTO routine_source
  FROM pg_proc AS routine
  JOIN pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname IN ('platform', 'platform_private')
    AND routine.proname IN (
      'enqueue_verified_webhook_work',
      'enqueue_ai_draft_work',
      'enqueue_manual_whatsapp_send',
      'claim_durable_work',
      'extend_durable_work_lease',
      'finish_durable_work',
      'admin_work_review_cases',
      'resolve_work_review_case',
      'p2g_enqueue_work',
      'p2g_dead_letter_work'
    );

  IF routine_source IS NULL
    OR position('platform_work_v1' IN routine_source) = 0
    OR position('platform_dead_letter_v1' IN routine_source) = 0
    OR position('pgmq.read' IN routine_source) = 0
    OR position('pop(' IN lower(routine_source)) > 0 THEN
    RAISE EXCEPTION
      'P2G queue functions drifted from the required hardcoded queues/read primitive';
  END IF;

  SELECT regexp_replace(
    string_agg(routine.prosrc, E'\n' ORDER BY routine.proname),
    '[[:space:]]+',
    ' ',
    'g'
  )
  INTO queue_payload_source
  FROM pg_proc AS routine
  JOIN pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'platform_private'
    AND routine.proname = 'p2g_enqueue_work';

  IF queue_payload_source IS NULL
    OR queue_payload_source NOT LIKE '%jsonb_build_object(%''v''%'
    OR queue_payload_source NOT LIKE '%''work_item_id''%'
    OR queue_payload_source NOT LIKE '%''kind''%'
    OR queue_payload_source LIKE '%''body''%'
    OR queue_payload_source LIKE '%''body_text''%'
    OR queue_payload_source LIKE '%''raw''%'
    OR queue_payload_source LIKE '%''raw_payload''%'
    OR queue_payload_source LIKE '%''generated_text''%'
    OR queue_payload_source LIKE '%''reviewed_text''%'
    OR queue_payload_source LIKE '%''verification_headers''%'
    OR queue_payload_source LIKE '%''secret''%'
    OR queue_payload_source LIKE '%''token''%' THEN
    RAISE EXCEPTION
      'P2G enqueue payload is not the exact pointer-only {v,work_item_id,kind} contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = 'resolve_work_review_case'
      AND regexp_replace(routine.prosrc, '[[:space:]]+', ' ', 'g') LIKE
          '%INSERT INTO platform.audit_events%'
      AND regexp_replace(routine.prosrc, '[[:space:]]+', ' ', 'g') LIKE
          '%before_state%'
      AND regexp_replace(routine.prosrc, '[[:space:]]+', ' ', 'g') LIKE
          '%after_state%'
      AND regexp_replace(routine.prosrc, '[[:space:]]+', ' ', 'g') NOT LIKE
          '%pgmq_public%'
  ) THEN
    RAISE EXCEPTION
      'P2G resolve_work_review_case must audit before/after state and avoid queue mutation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname IN (
        'enqueue_verified_webhook_work',
        'enqueue_ai_draft_work',
        'enqueue_manual_whatsapp_send',
        'claim_durable_work',
        'extend_durable_work_lease',
        'finish_durable_work'
      )
      AND (
        NOT routine.prosecdef
        OR routine.proconfig IS NULL
        OR array_to_string(routine.proconfig, ',') NOT LIKE '%search_path=%'
      )
  ) THEN
    RAISE EXCEPTION
      'P2G service queue wrappers must remain SECURITY DEFINER with explicit search_path';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('platform.enqueue_verified_webhook_work(uuid,uuid,text,integer,uuid)', FALSE, FALSE, FALSE, TRUE),
        ('platform.enqueue_ai_draft_work(uuid,uuid,text,integer,uuid)', FALSE, FALSE, FALSE, TRUE),
        ('platform.enqueue_manual_whatsapp_send(uuid,uuid,text,integer,uuid)', FALSE, FALSE, FALSE, TRUE),
        ('platform.claim_durable_work(integer,text,uuid)', FALSE, FALSE, FALSE, TRUE),
        ('platform.extend_durable_work_lease(uuid,uuid,integer,uuid)', FALSE, FALSE, FALSE, TRUE),
        ('platform.finish_durable_work(uuid,uuid,platform.durable_work_finish_outcome,text,text,integer,uuid)', FALSE, FALSE, FALSE, TRUE),
        ('platform.admin_work_review_cases(uuid)', FALSE, TRUE, FALSE, FALSE),
        ('platform.resolve_work_review_case(uuid,uuid,platform.work_review_resolution,text,uuid)', FALSE, TRUE, FALSE, FALSE)
    ) AS expected(signature, anon_ok, authenticated_ok, supabase_auth_admin_ok, service_role_ok)
    WHERE has_function_privilege('anon', expected.signature, 'EXECUTE')
        IS DISTINCT FROM expected.anon_ok
      OR has_function_privilege('authenticated', expected.signature, 'EXECUTE')
        IS DISTINCT FROM expected.authenticated_ok
      OR has_function_privilege('supabase_auth_admin', expected.signature, 'EXECUTE')
        IS DISTINCT FROM expected.supabase_auth_admin_ok
      OR has_function_privilege('service_role', expected.signature, 'EXECUTE')
        IS DISTINCT FROM expected.service_role_ok
  ) THEN
    RAISE EXCEPTION
      'P2G function execute grants drifted';
  END IF;
END
$$;

\echo 'P2G exact queue/review inventory passed'
