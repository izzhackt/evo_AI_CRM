\set ON_ERROR_STOP on

-- Migration 102 acceptance is synthetic and transactional. It proves the
-- schema-tip authority without contacting WAHA, Supabase Cloud or customer
-- data. The provider itself is exercised by the separate #566 acceptance.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 102 assertion failed: %', p_message;
  END IF;
END
$$;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
    FROM platform_private.provider_webhook_events AS event
    WHERE event.id = 'a1020000-0000-4000-8000-000000000101'
      AND event.provider_account_ref = 'waha:evo-inbox'
      AND event.waha_session_name = 'evo-inbox'
      AND event.raw_payload #>> '{payload,status}' = 'SCAN_QR_CODE'
  ),
  'historical evo-inbox webhook evidence was changed or removed'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
    FROM platform_private.waha_session_observations AS observation
    WHERE observation.id = 'a1020000-0000-4000-8000-000000000102'
      AND observation.waha_session_name = 'evo-inbox'
      AND observation.status = 'SCAN_QR_CODE'
  ),
  'historical evo-inbox observation was changed or removed'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.waha_session_health AS health
    WHERE health.waha_session_name <> 'crm_primary'
  ),
  'a legacy session survived in the current health projection'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attrdef AS attribute_default
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = attribute_default.adrelid
     AND attribute.attnum = attribute_default.adnum
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = attribute_default.adrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('platform', 'platform_private')
      AND pg_catalog.pg_get_expr(
        attribute_default.adbin,
        attribute_default.adrelid
      ) LIKE '%evo-inbox%'
  ),
  'an active Platform default still emits evo-inbox'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
    FROM information_schema.columns AS column_contract
    WHERE column_contract.table_schema = 'platform_private'
      AND column_contract.table_name = 'manual_send_waha_runtime_bindings'
      AND (
        (
          column_contract.column_name = 'waha_session_name'
          AND column_contract.column_default = '''crm_primary''::text'
        )
        OR (
          column_contract.column_name = 'waha_base_url'
          AND column_contract.column_default =
            '''http://evo-crm-waha:3000''::text'
        )
      )
  ),
  'manual-send runtime defaults are not the exact sales transport'
);

DO $$
DECLARE
  forbidden_signature TEXT;
BEGIN
  FOREACH forbidden_signature IN ARRAY ARRAY[
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)',
    'platform.finish_autonomous_reply(uuid,uuid,uuid,text,text,text,timestamptz,uuid)',
    'platform.sync_lead_agent_whatsapp(uuid,uuid,uuid,bigint,bigint,bigint,uuid)'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      'service_role',
      forbidden_signature::REGPROCEDURE,
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'authenticated',
      forbidden_signature::REGPROCEDURE,
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'anon',
      forbidden_signature::REGPROCEDURE,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'superseded sender/writer remains callable: %',
        forbidden_signature;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'platform.claim_durable_work(integer,text,uuid)'::REGPROCEDURE,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'the retained generic durable-work API lost service_role execution';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_contract
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = trigger_contract.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform'
      AND relation.relname = 'communication_messages'
      AND trigger_contract.tgname =
        'communication_messages_private_autonomous_binding'
      AND NOT trigger_contract.tgisinternal
  ) THEN
    RAISE EXCEPTION 'superseded autonomous outbound trigger remains active';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname IN ('platform', 'platform_private')
      AND routine.prosrc LIKE '%evo-inbox%'
      AND (
        pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege(
          'authenticated', routine.oid, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          'service_role', routine.oid, 'EXECUTE'
        )
      )
  ) THEN
    RAISE EXCEPTION 'a callable routine still contains evo-inbox authority';
  END IF;
END
$$;

-- The old evidence remains readable but cannot be projected into active health.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  TRUE
);
SET LOCAL ROLE service_role;

DO $$
BEGIN
  BEGIN
    PERFORM platform.sync_lead_agent_session_status(
      'a1020000-0000-4000-8000-000000000001',
      'a1020000-0000-4000-8000-000000000101',
      'a1020000-0000-4000-8000-000000000113'
    );
    RAISE EXCEPTION 'historical evo-inbox status was reactivated';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  BEGIN
    PERFORM platform.persist_provider_webhook_event(
      'a1020000-0000-4000-8000-000000000001',
      'waha',
      'waha:evo-inbox',
      NULL,
      NULL,
      'migration-102-new-legacy-rejected',
      'evo-inbox',
      'migration-102-new-legacy-rejected',
      'session.status',
      '2026-09-02 12:00:00+06',
      'verified',
      '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"WORKING"}}',
      '{"hmac_verified":true}',
      'synthetic:migration-102:legacy-rejected',
      repeat('a2', 32),
      'a1020000-0000-4000-8000-000000000114'
    );
    RAISE EXCEPTION 'new evo-inbox webhook evidence was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$$;

SELECT platform.persist_provider_webhook_event(
  'a1020000-0000-4000-8000-000000000001',
  'waha',
  'waha:crm_primary',
  NULL,
  NULL,
  'migration-102-current-session-status',
  'crm_primary',
  'migration-102-current-session-status',
  'session.status',
  '2026-09-02 12:01:00+06',
  'verified',
  '{"event":"session.status","session":"crm_primary","payload":{"name":"crm_primary","status":"WORKING"}}',
  '{"hmac_verified":true}',
  'synthetic:migration-102:current-session',
  repeat('a3', 32),
  'a1020000-0000-4000-8000-000000000115'
) AS crm_primary_webhook_result
\gset

SELECT platform.sync_lead_agent_session_status(
  'a1020000-0000-4000-8000-000000000001',
  (:'crm_primary_webhook_result'::JSONB ->> 'provider_webhook_event_id')::UUID,
  'a1020000-0000-4000-8000-000000000116'
) AS crm_primary_status_result
\gset

RESET ROLE;

SELECT pg_temp.assert_true(
  :'crm_primary_status_result'::JSONB ->> 'status' = 'WORKING'
    AND (
      SELECT health.status = 'WORKING'
        AND health.waha_session_name = 'crm_primary'
      FROM platform.waha_session_health AS health
      WHERE health.organization_id =
        'a1020000-0000-4000-8000-000000000001'
    ),
  'crm_primary signed session status did not become current health'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 16
    FROM pg_catalog.pg_trigger AS trigger_contract
    WHERE trigger_contract.tgname = 'enforce_crm_primary_waha_write'
      AND NOT trigger_contract.tgisinternal
  ) AND (
    SELECT pg_catalog.count(*) = 1
    FROM pg_catalog.pg_trigger AS trigger_contract
    WHERE trigger_contract.tgname = 'enforce_crm_primary_webhook_write'
      AND NOT trigger_contract.tgisinternal
  ),
  'schema-tip noncanonical WAHA write guards are incomplete'
);

ROLLBACK;
