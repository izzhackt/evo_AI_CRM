\set ON_ERROR_STOP on

-- Catalog-only P2F inventory. Assertions inspect the disposable database
-- after migration 044. They prove schema, authorization and immutable-ledger
-- contracts only; no WAHA, Kommo, amoCRM, AI provider or Queue is contacted.

DO $$
DECLARE
  public_p2f_tables CONSTANT TEXT[] := ARRAY[
    'ai_draft_events',
    'ai_draft_knowledge_citations',
    'ai_draft_requests',
    'ai_drafts',
    'approved_knowledge_versions',
    'communication_conversations',
    'communication_messages',
    'conversation_handoff_events',
    'conversation_participants',
    'manual_send_authorizations'
  ];
  private_p2f_tables CONSTANT TEXT[] := ARRAY[
    'provider_reconciliation_events',
    'provider_webhook_events'
  ];
  actual TEXT[];
  violation TEXT;
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
  INTO actual
  FROM information_schema.tables
  WHERE table_schema = 'platform'
    AND table_name = ANY (public_p2f_tables)
    AND table_type = 'BASE TABLE';

  IF actual IS DISTINCT FROM public_p2f_tables THEN
    RAISE EXCEPTION
      'P2F public table inventory mismatch: expected %, found %',
      public_p2f_tables,
      actual;
  END IF;

  SELECT array_agg(table_name ORDER BY table_name)
  INTO actual
  FROM information_schema.tables
  WHERE table_schema = 'platform_private'
    AND table_name = ANY (private_p2f_tables)
    AND table_type = 'BASE TABLE';

  IF actual IS DISTINCT FROM private_p2f_tables THEN
    RAISE EXCEPTION
      'P2F private table inventory mismatch: expected %, found %',
      private_p2f_tables,
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
  WHERE (
      (
        namespace.nspname = 'platform'
        AND relation.relname = ANY (public_p2f_tables)
      )
      OR (
        namespace.nspname = 'platform_private'
        AND relation.relname = ANY (private_p2f_tables)
      )
    )
    AND relation.relkind IN ('r', 'p')
    AND (
      owner_role.rolname <> 'postgres'
      OR NOT relation.relrowsecurity
      OR NOT relation.relforcerowsecurity
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2F tables must be postgres-owned with ENABLE/FORCE RLS: %',
      violation;
  END IF;

  IF enum_range(NULL::platform.communication_queue)::TEXT[]
      IS DISTINCT FROM ARRAY['sales', 'curator']::TEXT[]
    OR enum_range(NULL::platform.communication_status)::TEXT[]
      IS DISTINCT FROM ARRAY['open', 'closed']::TEXT[]
    OR enum_range(NULL::platform.conversation_participant_kind)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'customer',
        'sales',
        'curator',
        'admin'
      ]::TEXT[]
    OR enum_range(NULL::platform.communication_direction)::TEXT[]
      IS DISTINCT FROM ARRAY['inbound', 'outbound']::TEXT[]
    OR enum_range(NULL::platform.communication_message_language)::TEXT[]
      IS DISTINCT FROM ARRAY['ru', 'en', 'undetermined']::TEXT[]
    OR enum_range(NULL::platform.communication_provider)::TEXT[]
      IS DISTINCT FROM ARRAY['waha', 'kommo', 'amocrm']::TEXT[]
    OR enum_range(NULL::platform.webhook_verification_status)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'verified',
        'rejected',
        'stale',
        'missing'
      ]::TEXT[]
    OR enum_range(NULL::platform.provider_observation_kind)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'message_observed',
        'ack_observed',
        'link_resolved',
        'conflict',
        'unknown_result'
      ]::TEXT[]
    OR enum_range(NULL::platform.waha_ack_state)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'error',
        'pending',
        'server',
        'device',
        'read',
        'played',
        'unknown'
      ]::TEXT[]
    OR enum_range(NULL::platform.knowledge_version_status)::TEXT[]
      IS DISTINCT FROM ARRAY['approved', 'retired']::TEXT[]
    OR enum_range(NULL::platform.ai_language_detection_status)::TEXT[]
      IS DISTINCT FROM ARRAY['confident', 'uncertain']::TEXT[]
    OR enum_range(NULL::platform.ai_draft_language)::TEXT[]
      IS DISTINCT FROM ARRAY['ru', 'en']::TEXT[]
    OR enum_range(NULL::platform.ai_draft_state)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'awaiting_language_selection',
        'language_selected',
        'review_required',
        'rework_requested',
        'ready_for_manual_send',
        'manual_send_authorized',
        'handed_off'
      ]::TEXT[]
    OR enum_range(NULL::platform.ai_draft_review_decision)::TEXT[]
      IS DISTINCT FROM ARRAY['approved', 'rework', 'handoff']::TEXT[]
    OR enum_range(NULL::platform.ai_draft_event_type)::TEXT[]
      IS DISTINCT FROM ARRAY[
        'created',
        'language_selected',
        'generation_completed',
        'reviewed',
        'manual_send_authorized',
        'handed_off'
      ]::TEXT[]
  THEN
    RAISE EXCEPTION 'P2F enum inventory drifted from the locked contract';
  END IF;

  -- P2F owns data contracts, not automatic customer messaging or P2G retry
  -- machinery. Reject any new column that represents those forbidden paths.
  SELECT string_agg(
    format('%I.%I', column_row.table_name, column_row.column_name),
    ', '
    ORDER BY column_row.table_name, column_row.ordinal_position
  )
  INTO violation
  FROM information_schema.columns AS column_row
  WHERE (
      (
        column_row.table_schema = 'platform'
        AND column_row.table_name = ANY (public_p2f_tables)
      )
      OR (
        column_row.table_schema = 'platform_private'
        AND column_row.table_name = ANY (private_p2f_tables)
      )
    )
    AND (
      column_row.column_name ~
        '(^|_)(auto_reply|autoreply|broadcast|mass_send|audience_ids|recipient_ids|automatic_retry|retry_count|next_retry|queue_message|outbox)(_|$)'
      OR column_row.data_type = 'ARRAY'
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2F contains forbidden automation/broadcast/retry surface: %',
      violation;
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
      'P2F privileged projections must be fixed functions, not views: %',
      violation;
  END IF;
END
$$;

\echo 'P2F base catalog and forbidden-surface inventory passed'

DO $$
DECLARE
  append_only_public CONSTANT TEXT[] := ARRAY[
    'ai_draft_events',
    'ai_draft_knowledge_citations',
    'ai_draft_requests',
    'communication_messages',
    'conversation_handoff_events',
    'conversation_participants',
    'manual_send_authorizations'
  ];
  append_only_private CONSTANT TEXT[] := ARRAY[
    'provider_reconciliation_events',
    'provider_webhook_events'
  ];
  lifecycle_tables CONSTANT TEXT[] := ARRAY[
    'ai_drafts',
    'approved_knowledge_versions',
    'communication_conversations'
  ];
  public_p2f_tables CONSTANT TEXT[] := ARRAY[
    'ai_draft_events',
    'ai_draft_knowledge_citations',
    'ai_draft_requests',
    'ai_drafts',
    'approved_knowledge_versions',
    'communication_conversations',
    'communication_messages',
    'conversation_handoff_events',
    'conversation_participants',
    'manual_send_authorizations'
  ];
  private_p2f_tables CONSTANT TEXT[] := ARRAY[
    'provider_reconciliation_events',
    'provider_webhook_events'
  ];
  expected_composite_fks CONSTANT TEXT[] := ARRAY[
    'ai_draft_events_actor_membership_fkey',
    'ai_draft_events_draft_fkey',
    'ai_draft_events_knowledge_fkey',
    'ai_draft_knowledge_citations_draft_fkey',
    'ai_draft_knowledge_citations_knowledge_fkey',
    'ai_draft_requests_case_fkey',
    'ai_draft_requests_conversation_fkey',
    'ai_draft_requests_membership_fkey',
    'ai_draft_requests_message_fkey',
    'ai_drafts_case_fkey',
    'ai_drafts_conversation_fkey',
    'ai_drafts_knowledge_fkey',
    'ai_drafts_request_fkey',
    'ai_drafts_reviewer_fkey',
    'ai_drafts_source_message_fkey',
    'approved_knowledge_versions_approver_fkey',
    'approved_knowledge_versions_retirer_fkey',
    'communication_conversations_case_fkey',
    'communication_conversations_curator_fkey',
    'communication_conversations_sales_fkey',
    'communication_conversations_scope_fkey',
    'communication_conversations_source_event_fkey',
    'communication_messages_case_fkey',
    'communication_messages_conversation_fkey',
    'communication_messages_manual_authorization_fkey',
    'communication_messages_sender_fkey',
    'communication_messages_source_fkey',
    'conversation_handoff_events_conversation_fkey',
    'conversation_handoff_events_assignment_event_fkey',
    'conversation_handoff_events_new_case_fkey',
    'conversation_handoff_events_new_owner_fkey',
    'conversation_handoff_events_previous_case_fkey',
    'conversation_handoff_events_previous_owner_fkey',
    'conversation_handoff_events_source_fkey',
    'conversation_participants_conversation_fkey',
    'conversation_participants_membership_fkey',
    'conversation_participants_source_fkey',
    'manual_send_authorizations_draft_fkey',
    'manual_send_authorizations_membership_fkey',
    'provider_reconciliation_events_conversation_fkey',
    'provider_reconciliation_events_manual_authorization_fkey',
    'provider_reconciliation_events_message_fkey',
    'provider_reconciliation_events_source_fkey'
  ];
  required_indexes CONSTANT TEXT[] := ARRAY[
    'ai_draft_knowledge_citations_draft_knowledge_key',
    'ai_draft_knowledge_citations_draft_order_key',
    'ai_draft_requests_source_key',
    'ai_drafts_source_open_key',
    'communication_conversations_amocrm_lead_key',
    'communication_conversations_case_queue_idx',
    'communication_conversations_curator_queue_idx',
    'communication_conversations_kommo_key',
    'communication_conversations_sales_queue_idx',
    'conversation_handoff_events_assignment_event_idx',
    'communication_messages_kommo_key',
    'communication_messages_manual_authorization_key',
    'communication_messages_waha_key',
    'manual_send_authorizations_draft_key',
    'provider_reconciliation_events_source_effect_key',
    'provider_reconciliation_events_unknown_authorization_key',
    'provider_webhook_events_provider_request_key',
    'provider_webhook_events_waha_business_key'
  ];
  role_name TEXT;
  target_table_name TEXT;
  privilege_name TEXT;
  missing TEXT;
  violation TEXT;
BEGIN
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
    WHERE namespace.nspname IN ('platform', 'platform_private')
      AND constraint_row.contype = 'f'
      AND constraint_row.conname = expected.expected_name
      AND cardinality(constraint_row.conkey) >= 2
      AND cardinality(constraint_row.confkey) =
          cardinality(constraint_row.conkey)
      AND EXISTS (
        SELECT 1
        FROM unnest(constraint_row.conkey) AS key(attnum)
        JOIN pg_attribute AS attribute_row
          ON attribute_row.attrelid = relation.oid
          AND attribute_row.attnum = key.attnum
        WHERE attribute_row.attname = 'organization_id'
      )
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Missing tenant/parent-qualified P2F foreign keys: %',
      missing;
  END IF;

  SELECT string_agg(expected_name, ', ' ORDER BY expected_name)
  INTO missing
  FROM unnest(required_indexes) AS expected(expected_name)
  WHERE to_regclass(
    CASE
      WHEN expected.expected_name LIKE 'provider_%'
        THEN 'platform_private.' || expected.expected_name
      ELSE 'platform.' || expected.expected_name
    END
  ) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing P2F dedupe/queue indexes: %', missing;
  END IF;

  IF to_regclass(
      'platform_private.provider_webhook_events_kommo_business_key'
    ) IS NOT NULL
    OR to_regclass(
      'platform_private.provider_webhook_events_amocrm_business_key'
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION
      'Non-WAHA raw webhook business-key indexes must not infer provider identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_class AS table_relation
      ON table_relation.oid = index_row.indrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = table_relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND table_relation.relname = 'provider_webhook_events'
      AND index_relation.relname =
          'provider_webhook_events_waha_business_key'
      AND index_row.indisunique
      AND pg_get_indexdef(index_row.indexrelid) LIKE
        '%(organization_id, provider_account_ref, waha_session_name, event_type, payload_id, COALESCE(provider_event_variant_ref, ''%''::text))%'
      AND pg_get_expr(index_row.indpred, index_row.indrelid) =
          '(provider = ''waha''::platform.communication_provider)'
  ) THEN
    RAISE EXCEPTION
      'WAHA raw webhook event-type/variant business key drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_class AS table_relation
      ON table_relation.oid = index_row.indrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = table_relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND table_relation.relname = 'provider_reconciliation_events'
      AND index_relation.relname =
          'provider_reconciliation_events_source_effect_key'
      AND index_row.indisunique
      AND index_row.indnullsnotdistinct
      AND pg_get_indexdef(index_row.indexrelid) LIKE
        '%(organization_id, source_webhook_event_id, observation_kind, conversation_id, communication_message_id, ack_state) NULLS NOT DISTINCT%'
      AND pg_get_expr(index_row.indpred, index_row.indrelid) =
          '(source_webhook_event_id IS NOT NULL)'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_class AS table_relation
      ON table_relation.oid = index_row.indrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = table_relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND table_relation.relname = 'provider_reconciliation_events'
      AND index_relation.relname =
          'provider_reconciliation_events_unknown_authorization_key'
      AND index_row.indisunique
      AND pg_get_indexdef(index_row.indexrelid) LIKE
        '%(organization_id, manual_send_authorization_id)%'
      AND pg_get_expr(index_row.indpred, index_row.indrelid) =
          '(observation_kind = ''unknown_result''::platform.provider_observation_kind)'
  ) THEN
    RAISE EXCEPTION
      'Canonical provider reconciliation effect keys drifted';
  END IF;

  SELECT string_agg(
    format('%I.%I', expected.schema_name, expected.table_name),
    ', '
    ORDER BY expected.schema_name, expected.table_name
  )
  INTO missing
  FROM (
    SELECT
      'platform'::TEXT AS schema_name,
      public_table.table_name
    FROM unnest(append_only_public) AS public_table(table_name)
    UNION ALL
    SELECT
      'platform_private'::TEXT AS schema_name,
      private_table.table_name
    FROM unnest(append_only_private) AS private_table(table_name)
  ) AS expected
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
      WHERE namespace.nspname = expected.schema_name
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
      WHERE namespace.nspname = expected.schema_name
        AND relation.relname = expected.table_name
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgname = expected.table_name || '_no_truncate'
        AND trigger_row.tgtype = 34
        AND function_namespace.nspname = 'platform_private'
        AND trigger_function.proname = 'block_append_only_mutation'
    );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'P2F append-only UPDATE/DELETE/TRUNCATE guards missing for: %',
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
        AND trigger_row.tgtype = 11
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
        AND trigger_row.tgtype = 34
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
        AND trigger_row.tgname = expected.table_name || '_identity_immutable'
        AND trigger_row.tgtype = 19
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
        AND trigger_row.tgname = expected.table_name || '_transition_guard'
        AND trigger_row.tgtype = 19
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
        AND trigger_row.tgname = expected.table_name || '_set_updated_at'
        AND trigger_row.tgtype = 19
    );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'P2F lifecycle immutability/transition guards missing for: %',
      missing;
  END IF;

  FOREACH target_table_name IN ARRAY public_p2f_tables LOOP
    IF NOT has_table_privilege(
      'authenticated',
      format('platform.%I', target_table_name),
      'SELECT'
    ) THEN
      RAISE EXCEPTION
        'authenticated lacks RLS-governed SELECT on platform.%',
        target_table_name;
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
        format('platform.%I', target_table_name),
        privilege_name
      ) THEN
        RAISE EXCEPTION
          'authenticated unexpectedly has % on platform.%',
          privilege_name,
          target_table_name;
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
          format('platform.%I', target_table_name),
          privilege_name
        ) THEN
          RAISE EXCEPTION
            '% unexpectedly has % on platform.%',
            role_name,
            privilege_name,
            target_table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH target_table_name IN ARRAY private_p2f_tables LOOP
    FOREACH role_name IN ARRAY ARRAY[
      'anon',
      'authenticated',
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
          format('platform_private.%I', target_table_name),
          privilege_name
        ) THEN
          RAISE EXCEPTION
            '% unexpectedly has % on platform_private.%',
            role_name,
            privilege_name,
            target_table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    JOIN pg_class AS relation
      ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace AS relation_namespace
      ON relation_namespace.oid = relation.relnamespace
    JOIN pg_proc AS trigger_function
      ON trigger_function.oid = trigger_row.tgfoid
    JOIN pg_namespace AS function_namespace
      ON function_namespace.oid = trigger_function.pronamespace
    JOIN pg_roles AS owner_role
      ON owner_role.oid = trigger_function.proowner
    WHERE relation_namespace.nspname = 'platform'
      AND relation.relname = 'student_case_assignment_events'
      AND trigger_row.tgname =
          'student_case_assignment_sync_communications'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgtype = 5
      AND function_namespace.nspname = 'platform_private'
      AND trigger_function.proname =
          'sync_case_assignment_conversations'
      AND owner_role.rolname = 'postgres'
      AND trigger_function.prosecdef
      AND array_to_string(trigger_function.proconfig, ',') =
          'search_path=""'
  ) THEN
    RAISE EXCEPTION
      'P2F assignment-event AFTER INSERT communication sync trigger drifted';
  END IF;
END
$$;

\echo 'P2F tenant keys, immutable ledgers and direct-table containment passed'

DO $$
DECLARE
  missing TEXT;
BEGIN
  WITH required_column(schema_name, table_name, column_name) AS (
    VALUES
      ('platform_private', 'provider_webhook_events', 'provider_account_ref'),
      (
        'platform_private',
        'provider_webhook_events',
        'provider_conversation_ref'
      ),
      (
        'platform_private',
        'provider_webhook_events',
        'provider_event_variant_ref'
      ),
      ('platform_private', 'provider_webhook_events', 'provider_request_id'),
      ('platform_private', 'provider_webhook_events', 'waha_session_name'),
      ('platform_private', 'provider_webhook_events', 'payload_id'),
      ('platform_private', 'provider_webhook_events', 'verification_status'),
      ('platform_private', 'provider_webhook_events', 'raw_payload'),
      ('platform_private', 'provider_webhook_events', 'verification_headers'),
      (
        'platform_private',
        'provider_webhook_events',
        'verification_evidence_ref'
      ),
      ('platform_private', 'provider_webhook_events', 'payload_sha256'),
      ('platform', 'communication_conversations', 'student_case_id'),
      (
        'platform',
        'communication_conversations',
        'responsible_sales_membership_id'
      ),
      (
        'platform',
        'communication_conversations',
        'current_curator_membership_id'
      ),
      ('platform', 'communication_conversations', 'current_scope_id'),
      ('platform', 'communication_conversations', 'current_scope_version'),
      ('platform', 'communication_conversations', 'queue'),
      ('platform', 'communication_conversations', 'waha_session_name'),
      ('platform', 'communication_conversations', 'kommo_account_id'),
      ('platform', 'communication_conversations', 'kommo_conversation_id'),
      ('platform', 'communication_conversations', 'amocrm_account_id'),
      ('platform', 'communication_conversations', 'amocrm_lead_id'),
      ('platform', 'communication_conversations', 'amocrm_contact_id'),
      ('platform', 'communication_messages', 'sender_participant_id'),
      ('platform', 'communication_messages', 'direction'),
      ('platform', 'communication_messages', 'body_text'),
      ('platform', 'communication_messages', 'language'),
      ('platform', 'communication_messages', 'student_visible'),
      ('platform', 'communication_messages', 'waha_session_name'),
      ('platform', 'communication_messages', 'waha_message_id'),
      ('platform', 'communication_messages', 'kommo_account_id'),
      ('platform', 'communication_messages', 'kommo_conversation_id'),
      ('platform', 'communication_messages', 'kommo_message_id'),
      ('platform', 'communication_messages', 'amocrm_account_id'),
      ('platform', 'communication_messages', 'amocrm_lead_id'),
      ('platform', 'communication_messages', 'amocrm_contact_id'),
      (
        'platform',
        'communication_messages',
        'manual_send_authorization_id'
      ),
      (
        'platform',
        'conversation_handoff_events',
        'source_webhook_event_id'
      ),
      (
        'platform',
        'conversation_handoff_events',
        'student_case_assignment_event_id'
      ),
      ('platform', 'approved_knowledge_versions', 'knowledge_key'),
      ('platform', 'approved_knowledge_versions', 'version'),
      ('platform', 'approved_knowledge_versions', 'status'),
      ('platform', 'approved_knowledge_versions', 'content_text'),
      ('platform', 'approved_knowledge_versions', 'content_sha256'),
      ('platform', 'approved_knowledge_versions', 'provenance_ref'),
      ('platform', 'ai_draft_requests', 'source_message_id'),
      ('platform', 'ai_draft_requests', 'requested_language'),
      ('platform', 'ai_draft_requests', 'requested_by_membership_id'),
      ('platform', 'ai_drafts', 'ai_draft_request_id'),
      ('platform', 'ai_drafts', 'supersedes_ai_draft_id'),
      ('platform', 'ai_drafts', 'source_message_id'),
      ('platform', 'ai_drafts', 'detection_status'),
      ('platform', 'ai_drafts', 'selected_language'),
      ('platform', 'ai_drafts', 'provider_ref'),
      ('platform', 'ai_drafts', 'model_ref'),
      ('platform', 'ai_drafts', 'prompt_policy_version'),
      ('platform', 'ai_drafts', 'source_context'),
      ('platform', 'ai_drafts', 'source_context_sha256'),
      ('platform', 'ai_drafts', 'generated_text'),
      ('platform', 'ai_drafts', 'reviewed_text'),
      (
        'platform',
        'ai_draft_knowledge_citations',
        'knowledge_version_id'
      ),
      ('platform', 'ai_draft_events', 'event_type'),
      ('platform', 'ai_draft_events', 'content_text'),
      ('platform', 'manual_send_authorizations', 'final_text'),
      ('platform', 'manual_send_authorizations', 'final_text_sha256'),
      (
        'platform',
        'manual_send_authorizations',
        'authorized_by_membership_id'
      ),
      (
        'platform_private',
        'provider_reconciliation_events',
        'observation_kind'
      ),
      (
        'platform_private',
        'provider_reconciliation_events',
        'source_webhook_event_id'
      ),
      (
        'platform_private',
        'provider_reconciliation_events',
        'ack_state'
      ),
      (
        'platform_private',
        'provider_reconciliation_events',
        'manual_send_authorization_id'
      ),
      (
        'platform_private',
        'provider_reconciliation_events',
        'requires_manual_review'
      ),
      (
        'platform_private',
        'provider_reconciliation_events',
        'evidence_ref'
      )
  )
  SELECT string_agg(
    format('%I.%I.%I', schema_name, table_name, column_name),
    ', '
    ORDER BY schema_name, table_name, column_name
  )
  INTO missing
  FROM required_column
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = required_column.schema_name
      AND column_row.table_name = required_column.table_name
      AND column_row.column_name = required_column.column_name
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Missing P2F provider/account/draft evidence columns: %',
      missing;
  END IF;
END
$$;

\echo 'P2F provider identity and draft-evidence columns passed'

DO $$
DECLARE
  expected_policies CONSTANT TEXT[] := ARRAY[
    'ai_draft_events:ai_draft_events_full_read',
    'ai_draft_knowledge_citations:ai_draft_knowledge_citations_full_read',
    'ai_draft_requests:ai_draft_requests_full_read',
    'ai_drafts:ai_drafts_full_read',
    'approved_knowledge_versions:approved_knowledge_versions_read',
    'communication_conversations:communication_conversations_full_read',
    'communication_messages:communication_messages_full_read',
    'conversation_handoff_events:conversation_handoff_events_full_read',
    'conversation_participants:conversation_participants_full_read',
    'manual_send_authorizations:manual_send_authorizations_full_read'
  ];
  actual TEXT[];
  violation TEXT;
BEGIN
  SELECT array_agg(
    policy_row.tablename || ':' || policy_row.policyname
    ORDER BY policy_row.tablename, policy_row.policyname
  )
  INTO actual
  FROM pg_policies AS policy_row
  WHERE policy_row.schemaname = 'platform'
    AND policy_row.tablename = ANY (ARRAY[
      'ai_draft_events',
      'ai_draft_knowledge_citations',
      'ai_draft_requests',
      'ai_drafts',
      'approved_knowledge_versions',
      'communication_conversations',
      'communication_messages',
      'conversation_handoff_events',
      'conversation_participants',
      'manual_send_authorizations'
    ]);

  IF actual IS DISTINCT FROM expected_policies THEN
    RAISE EXCEPTION
      'P2F policy inventory mismatch: expected %, found %',
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
    AND (
      policy_row.tablename || ':' || policy_row.policyname
    ) = ANY (expected_policies)
    AND (
      policy_row.cmd <> 'SELECT'
      OR policy_row.roles IS DISTINCT FROM ARRAY['authenticated']::NAME[]
      OR policy_row.permissive <> 'PERMISSIVE'
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2F base-table policies are not authenticated SELECT-only: %',
      violation;
  END IF;

  SELECT string_agg(
    format('%I:%I', policy_row.tablename, policy_row.policyname),
    ', '
    ORDER BY policy_row.tablename, policy_row.policyname
  )
  INTO violation
  FROM pg_policies AS policy_row
  WHERE policy_row.schemaname = 'platform'
    AND (
      policy_row.tablename || ':' || policy_row.policyname
    ) = ANY (expected_policies)
    AND (
      (
        policy_row.tablename = 'approved_knowledge_versions'
        AND position(
          'platform_can_read_approved_knowledge'
          IN COALESCE(policy_row.qual, '')
        ) = 0
      )
      OR (
        policy_row.tablename <> 'approved_knowledge_versions'
        AND position(
          'platform_can_read_communication_full'
          IN COALESCE(policy_row.qual, '')
        ) = 0
      )
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2F SELECT policy bypasses fixed authorization helper: %',
      violation;
  END IF;

  SELECT string_agg(
    format('%I.%I:%I', schemaname, tablename, policyname),
    ', '
    ORDER BY tablename, policyname
  )
  INTO violation
  FROM pg_policies
  WHERE schemaname = 'platform_private'
    AND tablename IN (
      'provider_reconciliation_events',
      'provider_webhook_events'
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'Private provider evidence must not expose RLS policies: %',
      violation;
  END IF;
END
$$;

\echo 'P2F authenticated read-policy and private deny-all inventory passed'

DO $$
DECLARE
  mismatch TEXT;
  missing_required_permission TEXT;
BEGIN
  WITH p2f_permission(permission_key) AS (
    SELECT *
    FROM unnest(ARRAY[
      'ai.draft.request',
      'ai.draft.review',
      'communication.manual.send',
      'communication.read.full',
      'communication.read.self',
      'communication.read.summary',
      'knowledge.manage',
      'knowledge.read.approved'
    ])
  ),
  expected(role_name, permission_key) AS (
    SELECT 'admin'::TEXT, permission_key
    FROM p2f_permission
    UNION ALL
    SELECT *
    FROM (
      VALUES
        ('sales', 'ai.draft.request'),
        ('sales', 'ai.draft.review'),
        ('sales', 'communication.manual.send'),
        ('sales', 'communication.read.full'),
        ('sales', 'communication.read.summary'),
        ('sales', 'knowledge.read.approved'),
        ('curator', 'ai.draft.request'),
        ('curator', 'ai.draft.review'),
        ('curator', 'communication.manual.send'),
        ('curator', 'communication.read.full'),
        ('curator', 'knowledge.read.approved'),
        ('student', 'communication.read.self')
    ) AS role_permission(role_name, permission_key)
  ),
  actual AS (
    SELECT
      bundle.role::TEXT AS role_name,
      permission.permission_key
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
    WHERE bundle.version = 4
      AND permission.permission_key IN (
        SELECT permission_key FROM p2f_permission
      )
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
    FULL OUTER JOIN actual
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
    RAISE EXCEPTION 'P2F v4 permission matrix mismatch: %', mismatch;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions AS v3
    JOIN platform.role_bundle_permissions AS v3_permission
      ON v3_permission.bundle_id = v3.id
      AND v3_permission.bundle_role = v3.role
    JOIN platform.role_bundle_versions AS v4
      ON v4.role = v3.role
      AND v4.version = 4
    LEFT JOIN platform.role_bundle_permissions AS v4_permission
      ON v4_permission.bundle_id = v4.id
      AND v4_permission.bundle_role = v4.role
      AND v4_permission.permission_key = v3_permission.permission_key -- gitleaks:allow
    WHERE v3.version = 3
      AND v4_permission.permission_key IS NULL
  ) THEN
    RAISE EXCEPTION 'P2F v4 dropped an immutable v3 permission';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.role_bundle_versions
    WHERE version = 4
      AND status = 'published'
      AND id IN (
        '00000000-0000-4000-8000-000000000301',
        '00000000-0000-4000-8000-000000000302',
        '00000000-0000-4000-8000-000000000303',
        '00000000-0000-4000-8000-000000000304',
        '00000000-0000-4000-8000-000000000305'
      )
  ) <> 5 OR (
    SELECT count(*)
    FROM platform.role_bundle_versions
    WHERE version = 3
      AND status = 'published'
  ) <> 5 THEN
    RAISE EXCEPTION
      'Immutable published v3/v4 bundle inventory is incomplete';
  END IF;

  WITH p2f_routine AS (
    SELECT routine.prosrc
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname IN (
        'authorize_manual_send',
        'publish_approved_knowledge_version',
        'request_ai_draft',
        'resolve_ai_draft_language',
        'retire_approved_knowledge_version',
        'review_ai_draft'
      )
  ),
  required_permission AS (
    SELECT DISTINCT (match.capture)[1] AS permission_key
    FROM p2f_routine
    CROSS JOIN LATERAL regexp_matches(
      p2f_routine.prosrc,
      'require_(?:p2f_admin|communication)_actor\([^;]*?''([a-z.]+)''[[:space:]]*\)',
      'g'
    ) AS match(capture)
  )
  SELECT string_agg(permission_key, ', ' ORDER BY permission_key)
  INTO missing_required_permission
  FROM required_permission
  WHERE NOT EXISTS (
      SELECT 1
      FROM platform.permission_definitions AS definition
      WHERE definition.permission_key =
          required_permission.permission_key
    )
    OR NOT EXISTS (
      SELECT 1
      FROM platform.role_bundle_versions AS bundle
      JOIN platform.role_bundle_permissions AS permission
        ON permission.bundle_id = bundle.id
        AND permission.bundle_role = bundle.role
      WHERE bundle.version = 4
        AND bundle.status = 'published'
        AND permission.permission_key =
            required_permission.permission_key
    );

  IF missing_required_permission IS NOT NULL THEN
    RAISE EXCEPTION
      'P2F require_* references undefined or unmapped permission: %',
      missing_required_permission;
  END IF;
END
$$;

\echo 'P2F immutable v4 role/permission inventory passed'

DO $$
DECLARE
  authenticated_api CONSTANT TEXT[] := ARRAY[
    'platform.approved_knowledge_catalog(uuid)',
    'platform.authorize_manual_send(uuid,uuid,text,text,uuid)',
    'platform.former_sales_case_summaries(uuid)',
    'platform.publish_approved_knowledge_version(uuid,text,text,bigint,text,text,text,text,uuid)',
    'platform.request_ai_draft(uuid,uuid,uuid,platform.ai_draft_language,text,uuid)',
    'platform.resolve_ai_draft_language(uuid,uuid,platform.ai_draft_language,boolean,text,uuid)',
    'platform.retire_approved_knowledge_version(uuid,uuid,text,uuid)',
    'platform.review_ai_draft(uuid,uuid,platform.ai_draft_review_decision,text,text,uuid)',
    'platform.staff_communication_command_context(uuid,uuid)',
    'platform.staff_communication_queue(uuid)',
    'platform.staff_conversation_messages(uuid,uuid)',
    'platform.student_portal_messages(uuid)'
  ];
  service_api CONSTANT TEXT[] := ARRAY[
    'platform.append_provider_reconciliation_event(uuid,uuid,uuid,uuid,uuid,platform.provider_observation_kind,platform.waha_ack_state,text,uuid)',
    'platform.complete_ai_draft_generation(uuid,uuid,uuid,text,text,text,text,uuid)',
    'platform.create_communication_conversation(uuid,uuid,uuid,text,text,bigint,text,bigint,bigint,bigint,uuid,uuid)',
    'platform.link_communication_conversation_case(uuid,uuid,uuid,uuid,uuid)',
    'platform.persist_provider_webhook_event(uuid,platform.communication_provider,text,text,text,text,text,text,text,timestamp with time zone,platform.webhook_verification_status,jsonb,jsonb,text,text,uuid)',
    'platform.record_ai_draft(uuid,uuid,uuid,platform.ai_language_detection_status,platform.ai_draft_language,uuid,text,text,text,text,jsonb,text,uuid)',
    'platform.record_communication_message(uuid,uuid,platform.communication_direction,text,platform.communication_message_language,boolean,text,text,bigint,text,text,bigint,bigint,bigint,uuid,uuid,uuid)',
    'platform.record_conversation_participant(uuid,uuid,platform.conversation_participant_kind,uuid,text,uuid,uuid)'
  ];
  helper_api CONSTANT TEXT[] := ARRAY[
    'private.platform_can_read_approved_knowledge(uuid)',
    'private.platform_can_read_communication_full(uuid,uuid)'
  ];
  signature TEXT;
  routine_oid OID;
  routine RECORD;
  missing TEXT;
  violation TEXT;
  actual_output TEXT[];
  normalized_source TEXT;
  projection RECORD;
BEGIN
  SELECT string_agg(api_signature, ', ' ORDER BY api_signature)
  INTO missing
  FROM unnest(authenticated_api || service_api) AS api(api_signature)
  WHERE to_regprocedure(api_signature) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing exact P2F API signatures: %', missing;
  END IF;

  SELECT string_agg(
    format('%I(count=%s)', expected.proname, expected.overload_count),
    ', '
    ORDER BY expected.proname
  )
  INTO violation
  FROM (
    SELECT
      split_part(
        split_part(api_signature, '.', 2),
        '(',
        1
      ) AS proname,
      (
        SELECT count(*)
        FROM pg_proc AS candidate
        JOIN pg_namespace AS namespace
          ON namespace.oid = candidate.pronamespace
        WHERE namespace.nspname = 'platform'
          AND candidate.proname = split_part(
            split_part(api_signature, '.', 2),
            '(',
            1
          )
      ) AS overload_count
    FROM unnest(authenticated_api || service_api)
      AS api(api_signature)
  ) AS expected
  WHERE expected.overload_count <> 1;

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION 'P2F API overload inventory drifted: %', violation;
  END IF;

  SELECT string_agg(
    format(
      '%I.%I(%s)',
      namespace.nspname,
      routine_row.proname,
      pg_get_function_identity_arguments(routine_row.oid)
    ),
    ', '
    ORDER BY routine_row.proname
  )
  INTO violation
  FROM pg_proc AS routine_row
  JOIN pg_namespace AS namespace
    ON namespace.oid = routine_row.pronamespace
  JOIN pg_roles AS owner_role
    ON owner_role.oid = routine_row.proowner
  WHERE routine_row.oid = ANY (
      ARRAY(
        SELECT to_regprocedure(api_signature)
        FROM unnest(authenticated_api || service_api)
          AS api(api_signature)
      )
    )
    AND (
      namespace.nspname <> 'platform'
      OR owner_role.rolname <> 'postgres'
      OR NOT routine_row.prosecdef
      OR array_to_string(routine_row.proconfig, ',')
        IS DISTINCT FROM 'search_path=""'
    );

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2F API owner/SECURITY DEFINER/search_path drifted: %',
      violation;
  END IF;

  SELECT lower(regexp_replace(routine_row.prosrc, '\s+', ' ', 'g'))
  INTO normalized_source
  FROM pg_proc AS routine_row
  WHERE routine_row.oid = to_regprocedure(
    'platform.append_provider_reconciliation_event(uuid,uuid,uuid,uuid,uuid,platform.provider_observation_kind,platform.waha_ack_state,text,uuid)'
  );

  IF normalized_source NOT LIKE
      '%pg_advisory_xact_lock(%evo:p2f:provider-observation:source:%'
    OR normalized_source NOT LIKE
      '%pg_advisory_xact_lock(%evo:p2f:provider-observation:unknown:%'
    OR normalized_source NOT LIKE
      '%from platform_private.provider_reconciliation_events as event%'
    OR normalized_source NOT LIKE '%for update%'
  THEN
    RAISE EXCEPTION
      'Provider reconciliation advisory-lock/business replay contract drifted';
  END IF;

  FOREACH signature IN ARRAY authenticated_api LOOP
    routine_oid := to_regprocedure(signature);
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
    ) OR EXISTS (
      SELECT 1
      FROM pg_proc AS privilege_routine
      CROSS JOIN LATERAL aclexplode(
        COALESCE(
          privilege_routine.proacl,
          acldefault('f', privilege_routine.proowner)
        )
      ) AS privilege
      WHERE privilege_routine.oid = routine_oid
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'Authenticated-only P2F API ACL drifted: %',
        signature;
    END IF;
  END LOOP;

  FOREACH signature IN ARRAY service_api LOOP
    routine_oid := to_regprocedure(signature);
    IF NOT has_function_privilege(
      'service_role',
      routine_oid,
      'EXECUTE'
    ) OR has_function_privilege(
      'anon',
      routine_oid,
      'EXECUTE'
    ) OR has_function_privilege(
      'authenticated',
      routine_oid,
      'EXECUTE'
    ) OR has_function_privilege(
      'supabase_auth_admin',
      routine_oid,
      'EXECUTE'
    ) OR EXISTS (
      SELECT 1
      FROM pg_proc AS privilege_routine
      CROSS JOIN LATERAL aclexplode(
        COALESCE(
          privilege_routine.proacl,
          acldefault('f', privilege_routine.proowner)
        )
      ) AS privilege
      WHERE privilege_routine.oid = routine_oid
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'Service-only P2F API ACL drifted: %', signature;
    END IF;
  END LOOP;

  IF to_regprocedure(
    'platform_private.sync_case_assignment_conversations()'
  ) IS NULL THEN
    RAISE EXCEPTION 'Missing assignment-to-communication sync trigger helper';
  END IF;

  routine_oid := to_regprocedure(
    'platform_private.sync_case_assignment_conversations()'
  );
  IF has_function_privilege('anon', routine_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', routine_oid, 'EXECUTE')
    OR has_function_privilege('service_role', routine_oid, 'EXECUTE')
    OR has_function_privilege(
      'supabase_auth_admin',
      routine_oid,
      'EXECUTE'
    )
    OR EXISTS (
      SELECT 1
      FROM pg_proc AS privilege_routine
      CROSS JOIN LATERAL aclexplode(
        COALESCE(
          privilege_routine.proacl,
          acldefault('f', privilege_routine.proowner)
        )
      ) AS privilege
      WHERE privilege_routine.oid = routine_oid
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION
      'Assignment-to-communication trigger helper is directly executable';
  END IF;

  FOREACH signature IN ARRAY helper_api LOOP
    routine_oid := to_regprocedure(signature);
    IF routine_oid IS NULL
      OR NOT has_function_privilege(
        'authenticated',
        routine_oid,
        'EXECUTE'
      )
      OR has_function_privilege('anon', routine_oid, 'EXECUTE')
      OR has_function_privilege('service_role', routine_oid, 'EXECUTE')
      OR has_function_privilege(
        'supabase_auth_admin',
        routine_oid,
        'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'P2F RLS-helper ACL drifted: %', signature;
    END IF;
  END LOOP;

  FOR projection IN
    SELECT *
    FROM (
      VALUES
        (
          'platform.staff_communication_queue(uuid)'::TEXT,
          ARRAY[
            'conversation_id:uuid',
            'student_case_id:uuid',
            'queue:platform.communication_queue',
            'status:platform.communication_status',
            'subject:text',
            'waha_session_name:text',
            'kommo_account_id:bigint',
            'kommo_conversation_id:text',
            'amocrm_account_id:bigint',
            'amocrm_lead_id:bigint',
            'amocrm_contact_id:bigint',
            'created_at:timestamp with time zone'
          ]::TEXT[],
          'ORDER BY conversation.updated_at DESC, conversation.id'::TEXT
        ),
        (
          'platform.staff_conversation_messages(uuid,uuid)'::TEXT,
          ARRAY[
            'message_id:uuid',
            'conversation_id:uuid',
            'direction:platform.communication_direction',
            'body_text:text',
            'language:platform.communication_message_language',
            'student_visible:boolean',
            'waha_session_name:text',
            'waha_message_id:text',
            'kommo_account_id:bigint',
            'kommo_conversation_id:text',
            'kommo_message_id:text',
            'amocrm_account_id:bigint',
            'amocrm_lead_id:bigint',
            'amocrm_contact_id:bigint',
            'created_at:timestamp with time zone'
          ]::TEXT[],
          'ORDER BY message.created_at, message.id'::TEXT
        ),
        (
          'platform.former_sales_case_summaries(uuid)'::TEXT,
          ARRAY[
            'student_case_id:uuid',
            'student_display_name:text',
            'case_state:platform.student_case_state',
            'target_country:text',
            'target_degree:text',
            'assigned_curator_display_name:text',
            'handoff_at:timestamp with time zone'
          ]::TEXT[],
          'ORDER BY target_case.handoff_at DESC, target_case.id'::TEXT
        ),
        (
          'platform.student_portal_messages(uuid)'::TEXT,
          ARRAY[
            'message_id:uuid',
            'student_case_id:uuid',
            'direction:platform.communication_direction',
            'body_text:text',
            'language:platform.communication_message_language',
            'created_at:timestamp with time zone'
          ]::TEXT[],
          'ORDER BY message.created_at, message.id'::TEXT
        ),
        (
          'platform.approved_knowledge_catalog(uuid)'::TEXT,
          ARRAY[
            'knowledge_version_id:uuid',
            'knowledge_key:text',
            'title:text',
            'version:bigint',
            'content_text:text',
            'content_sha256:text',
            'provenance_ref:text',
            'approved_at:timestamp with time zone'
          ]::TEXT[],
          'ORDER BY knowledge.knowledge_key, knowledge.version DESC'::TEXT
        )
    ) AS expected(signature, output_columns, required_order)
  LOOP
    routine_oid := to_regprocedure(projection.signature);

    SELECT array_agg(
      routine_row.proargnames[argument_index]
        || ':'
        || format_type(
          routine_row.proallargtypes[argument_index],
          NULL
        )
      ORDER BY argument_index
    )
    INTO actual_output
    FROM pg_proc AS routine_row
    CROSS JOIN LATERAL generate_subscripts(
      routine_row.proallargtypes,
      1
    ) AS argument(argument_index)
    WHERE routine_row.oid = routine_oid
      AND routine_row.proargmodes[argument_index] = 't';

    IF actual_output IS DISTINCT FROM projection.output_columns THEN
      RAISE EXCEPTION
        'P2F projection output drifted for %: expected %, found %',
        projection.signature,
        projection.output_columns,
        actual_output;
    END IF;

    SELECT regexp_replace(
      routine_row.prosrc,
      '[[:space:]]+',
      ' ',
      'g'
    )
    INTO normalized_source
    FROM pg_proc AS routine_row
    WHERE routine_row.oid = routine_oid;

    IF position(projection.required_order IN normalized_source) = 0 THEN
      RAISE EXCEPTION
        'P2F projection deterministic ordering drifted for %',
        projection.signature;
    END IF;

    IF projection.signature =
        'platform.former_sales_case_summaries(uuid)'
      AND normalized_source ~
        '(target_case[.]updated_at|communication_messages|communication_conversations|waha_|kommo_|amocrm_|count[[:space:]]*[(])'
    THEN
      RAISE EXCEPTION
        'Former-Sales summary exposes forbidden recency/transcript/provider source';
    END IF;
  END LOOP;
END
$$;

\echo 'P2F exact RPC, ACL, trigger and projection inventory passed'
