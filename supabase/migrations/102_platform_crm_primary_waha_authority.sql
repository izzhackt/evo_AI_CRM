-- 102_platform_crm_primary_waha_authority.sql
-- Make the already-connected sales WAHA session the only active Platform
-- transport identity. Historical evo-inbox evidence stays queryable, but it
-- cannot be inserted, projected, claimed, reconciled or used as a fallback.

BEGIN;

LOCK TABLE
  platform.communication_conversations,
  platform.communication_messages,
  platform.waha_session_health,
  platform_private.autonomous_reply_provider_bindings,
  platform_private.manual_send_provider_bindings,
  platform_private.manual_send_waha_runtime_bindings,
  platform_private.manual_whatsapp_reconciliation_requests,
  platform_private.manual_whatsapp_reconciliation_results,
  platform_private.provider_webhook_events,
  platform_private.waha_ack_observations,
  platform_private.waha_direct_chat_bindings,
  platform_private.waha_history_message_observations,
  platform_private.waha_history_reconciliation_runs,
  platform_private.waha_media_object_bindings,
  platform_private.waha_message_bindings,
  platform_private.waha_session_observations
IN ACCESS EXCLUSIVE MODE;

DO $runtime_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM platform_private.manual_send_waha_runtime_bindings AS binding
    WHERE NOT (
      (
        binding.waha_session_name = 'evo-inbox'
        AND binding.waha_base_url = 'http://evo-inbox-waha:3000'
      )
      OR (
        binding.waha_session_name = 'crm_primary'
        AND binding.waha_base_url = 'http://evo-crm-waha:3000'
      )
    )
  ) THEN
    RAISE EXCEPTION
      'Manual-send WAHA binding contains an unknown transport; reconcile it before migration 102'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.manual_send_waha_runtime_bindings AS binding
    WHERE binding.waha_session_name = 'evo-inbox'
      AND binding.binding_version >= 9007199254740991
  ) THEN
    RAISE EXCEPTION
      'Manual-send WAHA binding version is exhausted before crm_primary cutover'
      USING ERRCODE = '22003';
  END IF;
END
$runtime_guard$;

ALTER TABLE platform_private.manual_send_waha_runtime_bindings
  DROP CONSTRAINT manual_send_waha_runtime_bindings_waha_session_name_check,
  DROP CONSTRAINT manual_send_waha_runtime_bindings_waha_base_url_check;

UPDATE platform_private.manual_send_waha_runtime_bindings AS binding
SET
  waha_session_name = 'crm_primary',
  waha_base_url = 'http://evo-crm-waha:3000',
  binding_version = binding.binding_version + 1,
  updated_at = pg_catalog.statement_timestamp()
WHERE binding.waha_session_name = 'evo-inbox'
  AND binding.waha_base_url = 'http://evo-inbox-waha:3000';

ALTER TABLE platform_private.manual_send_waha_runtime_bindings
  ALTER COLUMN waha_session_name SET DEFAULT 'crm_primary',
  ALTER COLUMN waha_base_url SET DEFAULT 'http://evo-crm-waha:3000',
  ADD CONSTRAINT manual_send_waha_runtime_bindings_waha_session_name_check
    CHECK (waha_session_name = 'crm_primary'),
  ADD CONSTRAINT manual_send_waha_runtime_bindings_waha_base_url_check
    CHECK (waha_base_url = 'http://evo-crm-waha:3000');

-- Current health is a projection, not immutable evidence. The signed webhook
-- event and private observation remain intact; only the stale active projection
-- is removed before the exact crm_primary constraint is installed.
DELETE FROM platform.waha_session_health
WHERE waha_session_name = 'evo-inbox';

ALTER TABLE platform.waha_session_health
  DROP CONSTRAINT waha_session_health_session_name_check,
  ALTER COLUMN waha_session_name SET DEFAULT 'crm_primary',
  ADD CONSTRAINT waha_session_health_session_name_check
    CHECK (waha_session_name = 'crm_primary');

-- These relations are immutable provider evidence. Their old rows must remain
-- valid, while the write trigger installed below prevents any new legacy row.
ALTER TABLE platform_private.autonomous_reply_provider_bindings
  DROP CONSTRAINT autonomous_reply_provider_bindings_waha_session_name_check,
  ADD CONSTRAINT autonomous_reply_provider_bindings_waha_session_name_check
    CHECK (waha_session_name IN ('evo-inbox', 'crm_primary'));

ALTER TABLE platform_private.manual_send_provider_bindings
  DROP CONSTRAINT manual_send_provider_bindings_waha_session_name_check,
  ADD CONSTRAINT manual_send_provider_bindings_waha_session_name_check
    CHECK (waha_session_name IN ('evo-inbox', 'crm_primary'));

ALTER TABLE platform_private.manual_whatsapp_reconciliation_requests
  DROP CONSTRAINT manual_whatsapp_reconciliation_requests_waha_session_name_check,
  ADD CONSTRAINT manual_whatsapp_reconciliation_requests_waha_session_name_check
    CHECK (waha_session_name IN ('evo-inbox', 'crm_primary'));

ALTER TABLE platform_private.manual_whatsapp_reconciliation_results
  DROP CONSTRAINT manual_whatsapp_reconciliation_results_waha_session_name_check,
  ADD CONSTRAINT manual_whatsapp_reconciliation_results_waha_session_name_check
    CHECK (waha_session_name IN ('evo-inbox', 'crm_primary'));

ALTER TABLE platform_private.waha_ack_observations
  DROP CONSTRAINT waha_ack_observations_waha_session_name_check,
  ADD CONSTRAINT waha_ack_observations_waha_session_name_check
    CHECK (waha_session_name IN ('evo-inbox', 'crm_primary'));

ALTER TABLE platform_private.waha_history_message_observations
  DROP CONSTRAINT waha_history_message_observations_waha_session_name_check,
  ADD CONSTRAINT waha_history_message_observations_waha_session_name_check
    CHECK (waha_session_name IN ('evo-inbox', 'crm_primary'));

ALTER TABLE platform_private.waha_history_reconciliation_runs
  DROP CONSTRAINT waha_history_reconciliation_runs_waha_session_name_check,
  ADD CONSTRAINT waha_history_reconciliation_runs_waha_session_name_check
    CHECK (waha_session_name IN ('evo-inbox', 'crm_primary'));

ALTER TABLE platform_private.waha_media_object_bindings
  DROP CONSTRAINT waha_media_object_bindings_waha_session_name_check,
  ADD CONSTRAINT waha_media_object_bindings_waha_session_name_check
    CHECK (waha_session_name IN ('evo-inbox', 'crm_primary'));

ALTER TABLE platform_private.waha_session_observations
  DROP CONSTRAINT waha_session_observations_session_name_check,
  ADD CONSTRAINT waha_session_observations_session_name_check
    CHECK (waha_session_name IN ('evo-inbox', 'crm_primary'));

-- Snapshot every routine contract before replacing the exact legacy transport
-- constants. CREATE OR REPLACE must not alter ownership, grants, volatility,
-- SECURITY DEFINER or the locked search_path contract.
CREATE TEMPORARY TABLE migration_102_function_contracts
ON COMMIT DROP
AS
SELECT
  routine.oid,
  routine.proowner,
  routine.proacl,
  routine.prosecdef,
  routine.proconfig,
  routine.provolatile,
  routine.proleakproof,
  routine.proparallel
FROM pg_catalog.pg_proc AS routine
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = routine.pronamespace
WHERE namespace.nspname IN ('platform', 'platform_private')
  AND routine.prosrc LIKE '%evo-inbox%';

DO $routine_cutover$
DECLARE
  routine_row RECORD;
  replacement_definition TEXT;
  replaced_count INTEGER := 0;
BEGIN
  IF (SELECT count(*) FROM migration_102_function_contracts) <> 29 THEN
    RAISE EXCEPTION
      'Migration 102 expected 29 legacy WAHA routines at schema tip, found %',
      (SELECT count(*) FROM migration_102_function_contracts)
      USING ERRCODE = '55000';
  END IF;

  FOR routine_row IN
    SELECT
      contract.oid,
      pg_catalog.pg_get_functiondef(contract.oid) AS definition
    FROM migration_102_function_contracts AS contract
    WHERE contract.oid <> ALL (ARRAY[
      'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE::OID,
      'platform.finish_autonomous_reply(uuid,uuid,uuid,text,text,text,timestamptz,uuid)'::REGPROCEDURE::OID,
      'platform.sync_lead_agent_whatsapp(uuid,uuid,uuid,bigint,bigint,bigint,uuid)'::REGPROCEDURE::OID,
      'platform_private.require_private_autonomous_reply_binding()'::REGPROCEDURE::OID
    ])
    ORDER BY contract.oid
  LOOP
    replacement_definition := pg_catalog.replace(
      pg_catalog.replace(
        routine_row.definition,
        'http://evo-inbox-waha:3000',
        'http://evo-crm-waha:3000'
      ),
      'evo-inbox',
      'crm_primary'
    );

    IF replacement_definition IS NOT DISTINCT FROM routine_row.definition THEN
      RAISE EXCEPTION
        'Migration 102 did not replace legacy constants in routine %',
        routine_row.oid::REGPROCEDURE
        USING ERRCODE = '55000';
    END IF;

    EXECUTE replacement_definition;
    replaced_count := replaced_count + 1;
  END LOOP;

  IF replaced_count <> 25 THEN
    RAISE EXCEPTION
      'Migration 102 replaced an unexpected routine count: %',
      replaced_count
      USING ERRCODE = '55000';
  END IF;
END
$routine_cutover$;

-- Routines introduced before exact-session authority accepted a session as an
-- argument and relied on table checks. Inject an explicit public-boundary guard
-- as well, so legacy evidence cannot be reactivated through a callable API.
DO $argument_guard_cutover$
DECLARE
  target_oid REGPROCEDURE;
  definition TEXT;
  guarded_definition TEXT;
  target_signature TEXT;
BEGIN
  FOREACH target_signature IN ARRAY ARRAY[
    'platform.create_communication_conversation(uuid,uuid,uuid,text,text,bigint,text,bigint,bigint,bigint,uuid,uuid)',
    'platform.record_communication_message(uuid,uuid,platform.communication_direction,text,platform.communication_message_language,boolean,text,text,bigint,text,text,bigint,bigint,bigint,uuid,uuid,uuid)',
    'platform.finish_manual_whatsapp_reconciliation(uuid,text,text,text,integer,text,text,platform.waha_ack_state,timestamptz,timestamptz,uuid)',
    'platform_private.finish_manual_whatsapp_reconciliation_internal(uuid,text,text,text,integer,text,text,platform.waha_ack_state,timestamptz,timestamptz,uuid)'
  ]
  LOOP
    target_oid := target_signature::REGPROCEDURE;
    definition := pg_catalog.pg_get_functiondef(target_oid);
    guarded_definition := pg_catalog.regexp_replace(
      definition,
      E'\nBEGIN\n',
      E'\nBEGIN\n  IF p_waha_session_name IS DISTINCT FROM \'crm_primary\' THEN\n    RAISE EXCEPTION \'Only crm_primary is active\' USING ERRCODE = \'22023\';\n  END IF;\n',
      ''
    );

    IF guarded_definition IS NOT DISTINCT FROM definition THEN
      RAISE EXCEPTION
        'Migration 102 could not install the session guard in %',
        target_oid
        USING ERRCODE = '55000';
    END IF;

    EXECUTE guarded_definition;
  END LOOP;

  target_oid :=
    'platform.persist_provider_webhook_event(uuid,platform.communication_provider,text,text,text,text,text,text,text,timestamptz,platform.webhook_verification_status,jsonb,jsonb,text,text,uuid)'::REGPROCEDURE;
  definition := pg_catalog.pg_get_functiondef(target_oid);
  guarded_definition := pg_catalog.regexp_replace(
    definition,
    E'\nBEGIN\n',
    E'\nBEGIN\n  IF p_provider = \'waha\' AND (p_waha_session_name IS DISTINCT FROM \'crm_primary\' OR p_provider_account_ref IS DISTINCT FROM \'waha:crm_primary\') THEN\n    RAISE EXCEPTION \'Only waha:crm_primary is active\' USING ERRCODE = \'22023\';\n  END IF;\n',
    ''
  );

  IF guarded_definition IS NOT DISTINCT FROM definition THEN
    RAISE EXCEPTION
      'Migration 102 could not install the exact webhook identity guard'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE guarded_definition;
END
$argument_guard_cutover$;

DO $routine_contract_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM migration_102_function_contracts AS before_contract
    JOIN pg_catalog.pg_proc AS after_contract
      ON after_contract.oid = before_contract.oid
    WHERE after_contract.proowner IS DISTINCT FROM before_contract.proowner
      OR after_contract.proacl IS DISTINCT FROM before_contract.proacl
      OR after_contract.prosecdef IS DISTINCT FROM before_contract.prosecdef
      OR after_contract.proconfig IS DISTINCT FROM before_contract.proconfig
      OR after_contract.provolatile IS DISTINCT FROM before_contract.provolatile
      OR after_contract.proleakproof IS DISTINCT FROM before_contract.proleakproof
      OR after_contract.proparallel IS DISTINCT FROM before_contract.proparallel
  ) THEN
    RAISE EXCEPTION
      'Migration 102 changed a protected routine contract'
      USING ERRCODE = '55000';
  END IF;

END
$routine_contract_guard$;

-- These functions belong to superseded autonomous or frozen V1 paths.
-- Pointing them at crm_primary would reactivate a second sender or writer, so
-- migration 102 deliberately leaves their historical bodies intact and
-- removes every application role's execution authority instead.
REVOKE ALL ON FUNCTION
  platform.claim_autonomous_reply(UUID, TEXT, INTEGER, TEXT, UUID)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  platform.finish_autonomous_reply(
    UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID
  )
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  platform.sync_lead_agent_whatsapp(
    UUID, UUID, UUID, BIGINT, BIGINT, BIGINT, UUID
  )
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS communication_messages_private_autonomous_binding
  ON platform.communication_messages;
REVOKE ALL ON FUNCTION
  platform_private.require_private_autonomous_reply_binding()
FROM PUBLIC, anon, authenticated, service_role;

DO $callable_legacy_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname IN ('platform', 'platform_private')
      AND routine.prosrc LIKE '%evo-inbox%'
      AND (
        pg_catalog.has_function_privilege(
          'anon', routine.oid, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          'authenticated', routine.oid, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          'service_role', routine.oid, 'EXECUTE'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'A callable Platform routine still contains evo-inbox authority'
      USING ERRCODE = '55000';
  END IF;
END
$callable_legacy_guard$;

CREATE OR REPLACE FUNCTION platform_private.enforce_crm_primary_waha_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  row_data JSONB := pg_catalog.to_jsonb(NEW);
  session_name TEXT := row_data ->> 'waha_session_name';
BEGIN
  IF session_name IS NOT NULL
    AND session_name <> 'crm_primary'
  THEN
    RAISE EXCEPTION
      'Only crm_primary may be written as the active WAHA session'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION platform_private.enforce_crm_primary_waha_write()
  FROM PUBLIC, anon, authenticated, service_role;

DO $write_triggers$
DECLARE
  target_table REGCLASS;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'platform.communication_conversations'::REGCLASS,
    'platform.communication_messages'::REGCLASS,
    'platform.waha_session_health'::REGCLASS,
    'platform_private.autonomous_reply_provider_bindings'::REGCLASS,
    'platform_private.manual_send_provider_bindings'::REGCLASS,
    'platform_private.manual_send_waha_runtime_bindings'::REGCLASS,
    'platform_private.manual_whatsapp_reconciliation_requests'::REGCLASS,
    'platform_private.manual_whatsapp_reconciliation_results'::REGCLASS,
    'platform_private.provider_webhook_events'::REGCLASS,
    'platform_private.waha_ack_observations'::REGCLASS,
    'platform_private.waha_direct_chat_bindings'::REGCLASS,
    'platform_private.waha_history_message_observations'::REGCLASS,
    'platform_private.waha_history_reconciliation_runs'::REGCLASS,
    'platform_private.waha_media_object_bindings'::REGCLASS,
    'platform_private.waha_message_bindings'::REGCLASS,
    'platform_private.waha_session_observations'::REGCLASS
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS enforce_crm_primary_waha_write ON %s',
      target_table
    );
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER enforce_crm_primary_waha_write BEFORE INSERT OR UPDATE OF waha_session_name ON %s FOR EACH ROW EXECUTE FUNCTION platform_private.enforce_crm_primary_waha_write()',
      target_table
    );
  END LOOP;
END
$write_triggers$;

CREATE OR REPLACE FUNCTION platform_private.enforce_crm_primary_webhook_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.provider = 'waha'
    AND (
      NEW.waha_session_name IS DISTINCT FROM 'crm_primary'
      OR NEW.provider_account_ref IS DISTINCT FROM 'waha:crm_primary'
    )
  THEN
    RAISE EXCEPTION
      'Only waha:crm_primary may be written as the active WAHA webhook identity'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION platform_private.enforce_crm_primary_webhook_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_crm_primary_webhook_write
  ON platform_private.provider_webhook_events;
CREATE TRIGGER enforce_crm_primary_webhook_write
BEFORE INSERT OR UPDATE OF provider, provider_account_ref, waha_session_name
ON platform_private.provider_webhook_events
FOR EACH ROW
EXECUTE FUNCTION platform_private.enforce_crm_primary_webhook_write();

COMMENT ON FUNCTION platform_private.enforce_crm_primary_waha_write() IS
  'Rejects every new or reactivated non-crm_primary WAHA session while leaving immutable historical rows queryable.';
COMMENT ON FUNCTION platform_private.enforce_crm_primary_webhook_write() IS
  'Rejects every new WAHA webhook identity except the connected sales waha:crm_primary account.';

COMMIT;
