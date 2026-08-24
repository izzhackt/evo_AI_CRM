\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 085. This suite proves the exact
-- receive-only Sales intake SQL contract at the schema tip without contacting
-- any provider or managed environment.
BEGIN;

DO $$
DECLARE
  contract RECORD;
  routine_oid OID;
  routine_row pg_proc%ROWTYPE;
  forbidden_role TEXT;
BEGIN
  FOR contract IN
    SELECT *
    FROM (
      VALUES
        (
          'platform_private.bind_waha_chat_to_canonical(uuid,uuid)',
          'v'::"char",
          0,
          FALSE
        ),
        (
          'platform.staff_waha_sales_intake_page(uuid,integer,timestamp with time zone,uuid,text,text)',
          's'::"char",
          4,
          TRUE
        ),
        (
          'platform.staff_canonical_lead_conversation_link(uuid,uuid,uuid)',
          's'::"char",
          0,
          TRUE
        )
    ) AS expected(signature, volatility, default_count, returns_set)
  LOOP
    routine_oid := pg_catalog.to_regprocedure(contract.signature)::OID;
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION
        'Migration 085 routine signature is missing: %',
        contract.signature;
    END IF;

    SELECT routine.*
    INTO STRICT routine_row
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = routine_oid;

    IF NOT routine_row.prosecdef
      OR routine_row.provolatile <> contract.volatility
      OR routine_row.prokind <> 'f'
      OR routine_row.proretset IS DISTINCT FROM contract.returns_set
      OR NOT (routine_row.proconfig @> ARRAY['search_path=""']::TEXT[])
      OR routine_row.pronargdefaults <> contract.default_count
    THEN
      RAISE EXCEPTION
        'Migration 085 hardened routine contract drifted for %',
        contract.signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = relation.relnamespace
    WHERE namespace_row.nspname = 'platform_private'
      AND relation.relname = 'waha_direct_chat_bindings'
      AND trigger_row.tgname = 'waha_direct_chat_bindings_canonical_link'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'Migration 085 canonical-link trigger is missing from platform_private.waha_direct_chat_bindings';
  END IF;

  FOR forbidden_role IN
    SELECT role_name
    FROM (
      VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin')
    ) AS roles(role_name)
  LOOP
    IF has_function_privilege(
      forbidden_role,
      'platform_private.bind_waha_chat_to_canonical(uuid,uuid)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'Migration 085 leaked private bind execution to %',
        forbidden_role;
    END IF;
  END LOOP;

  IF NOT has_function_privilege(
    'authenticated',
    'platform.staff_waha_sales_intake_page(uuid,integer,timestamp with time zone,uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Migration 085 staff intake page RPC is not executable by authenticated';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'platform.staff_canonical_lead_conversation_link(uuid,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Migration 085 lead conversation link RPC is not executable by authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform_private.waha_direct_chat_bindings AS binding
    JOIN platform.communication_conversations AS conversation
      ON conversation.organization_id = binding.organization_id
     AND conversation.id = binding.conversation_id
    WHERE binding.id = '85300000-0000-4000-8000-000000000005'
      AND binding.normalized_chat_id = '123@c.us'
      AND conversation.canonical_client_id IS NULL
      AND conversation.canonical_lead_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Migration 085 rewrote, rejected, or canonicalized an unsupported historical direct chat';
  END IF;
END
$$;

DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM platform.staff_waha_sales_intake_page(
      '85000000-0000-4000-8000-000000000001',
      102
    );
    RAISE EXCEPTION 'sales intake page accepted an oversized limit';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM *
    FROM platform.staff_waha_sales_intake_page(
      '85000000-0000-4000-8000-000000000001',
      50,
      '2026-08-24T10:00:00Z'::TIMESTAMPTZ,
      NULL
    );
    RAISE EXCEPTION 'sales intake page accepted an incomplete cursor';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM *
    FROM platform.staff_waha_sales_intake_page(
      '85000000-0000-4000-8000-000000000001',
      50,
      NULL,
      NULL,
      'outbound',
      NULL
    );
    RAISE EXCEPTION 'sales intake page accepted an invalid state';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM *
    FROM platform.staff_waha_sales_intake_page(
      '85000000-0000-4000-8000-000000000001',
      50,
      NULL,
      NULL,
      NULL,
      repeat('x', 201)
    );
    RAISE EXCEPTION 'sales intake page accepted an oversized query';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$$;

ROLLBACK;

SELECT 'platform migration 085 current receive-only sales contract passed' AS result;
