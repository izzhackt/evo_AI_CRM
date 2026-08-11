\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

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
    RAISE EXCEPTION 'P5F3 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
TO authenticated, service_role;

DO $assert$
DECLARE
  private_table TEXT;
  forbidden_role TEXT;
  forbidden_privilege TEXT;
BEGIN
  FOREACH private_table IN ARRAY ARRAY[
    'conversation_autonomy_control_events',
    'autonomous_reply_gate_decisions',
    'autonomous_reply_intents',
    'autonomous_reply_intent_lifecycle',
    'autonomous_reply_attempts',
    'autonomous_reply_claim_receipts',
    'autonomous_reply_attempt_results',
    'autonomous_reply_provider_bindings'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'platform_private'
        AND relation.relname = private_table
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'Private P5F3 table % must FORCE RLS', private_table;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies AS policy
      WHERE policy.schemaname = 'platform_private'
        AND policy.tablename = private_table
    ) THEN
      RAISE EXCEPTION 'Private P5F3 table % must have no policies', private_table;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ]
    LOOP
      FOREACH forbidden_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ]
      LOOP
        IF pg_catalog.has_table_privilege(
          forbidden_role,
          'platform_private.' || private_table,
          forbidden_privilege
        ) THEN
          RAISE EXCEPTION
            'Private P5F3 table % has forbidden direct privilege %:%',
            private_table,
            forbidden_role,
            forbidden_privilege;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'platform.set_conversation_autonomy_control(uuid,uuid,bigint,text,text,uuid)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated',
    'platform.staff_conversation_autonomous_reply_state(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated P5F3 staff RPC grants are incomplete';
  END IF;

  IF pg_catalog.has_function_privilege(
    'authenticated',
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'platform.finish_autonomous_reply(uuid,uuid,uuid,text,text,text,timestamptz,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated role must not execute P5F3 worker RPCs';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'platform.finish_autonomous_reply(uuid,uuid,uuid,text,text,text,timestamptz,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Service role P5F3 worker RPC grants are incomplete';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role,
      'platform_private.p5f3_policy_now()',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'Private P5F3 policy clock has forbidden EXECUTE grant for %',
        forbidden_role;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'platform_private'
      AND procedure.proname = 'p5f3_policy_now'
      AND procedure.pronargs = 0
      AND procedure.prosecdef
      AND procedure.provolatile = 's'
      AND procedure.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_catalog.regexp_replace(
        procedure.prosrc,
        '[[:space:]]',
        '',
        'g'
      ) = 'SELECTpg_catalog.statement_timestamp()'
  ) THEN
    RAISE EXCEPTION 'Private P5F3 production policy clock drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform'
      AND relation.relname = 'conversation_autonomous_reply_state'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) OR NOT pg_catalog.has_table_privilege(
    'authenticated',
    'platform.conversation_autonomous_reply_state',
    'SELECT'
  ) OR pg_catalog.has_table_privilege(
    'authenticated',
    'platform.conversation_autonomous_reply_state',
    'INSERT'
  ) OR pg_catalog.has_table_privilege(
    'authenticated',
    'platform.conversation_autonomous_reply_state',
    'UPDATE'
  ) OR pg_catalog.has_table_privilege(
    'authenticated',
    'platform.conversation_autonomous_reply_state',
    'DELETE'
  ) OR pg_catalog.has_table_privilege(
    'authenticated',
    'platform.conversation_autonomous_reply_state',
    'TRUNCATE'
  ) THEN
    RAISE EXCEPTION 'Safe P5F3 public projection ACL/RLS drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'platform'
      AND procedure.proname IN (
        'set_conversation_autonomy_control',
        'claim_autonomous_reply',
        'finish_autonomous_reply',
        'staff_conversation_autonomous_reply_state',
        'project_claimed_waha_observation'
      )
      AND (
        NOT procedure.prosecdef
        OR procedure.proconfig IS DISTINCT FROM
          ARRAY['search_path=""']::TEXT[]
      )
  ) THEN
    RAISE EXCEPTION 'P5F3 RPC definer/search_path hardening drifted';
  END IF;
END
$assert$;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(argument_name ORDER BY ordinal)
    FROM (
      SELECT
        argument.name AS argument_name,
        argument.ordinality AS ordinal
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      CROSS JOIN LATERAL pg_catalog.unnest(
        procedure.proargnames
      ) WITH ORDINALITY AS argument(name, ordinality)
      WHERE namespace.nspname = 'platform'
        AND procedure.proname =
          'staff_conversation_autonomous_reply_state'
        AND procedure.proargmodes[argument.ordinality] =
          't'::pg_catalog."char"
    ) AS output_arguments
  ) = ARRAY[
    'control_state',
    'control_version',
    'control_reason',
    'control_recorded_at',
    'decision_state',
    'decision_reason_code',
    'policy_version',
    'proposal_request_id',
    'source_message_id',
    'intent_id',
    'intent_state',
    'attempt_outcome',
    'communication_message_id',
    'ack_name',
    'decided_at',
    'attempted_at',
    'autonomous_authority'
  ]::TEXT[],
  'safe staff DTO columns drifted'
);

SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'INTERVAL ''60 seconds'''
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'accepted_24h_count >= 6'
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'consecutive_count >= 3'
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'NOT EXISTS[[:space:]]*\([[:space:]]*SELECT 1[[:space:]]*FROM platform_private.autonomous_reply_intents'
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'A claimed autonomous reply request cannot be replayed',
  'cooldown/rate/single-use/no-replay claim gates drifted'
);

SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'platform_private\.p5f3_policy_now\(\)'
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'policy_now := platform_private\.p5f3_policy_now\(\);[[:space:]]*IF NOT EXISTS'
  AND pg_catalog.regexp_count(
    pg_catalog.pg_get_functiondef(
      'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
    ),
    'evo:p5f3:conversation:'
  ) >= 2
  AND pg_catalog.pg_get_functiondef(
    'platform.finish_autonomous_reply(uuid,uuid,uuid,text,text,text,timestamptz,uuid)'::REGPROCEDURE
  ) ~ 'evo:p5f3:conversation:'
  AND pg_catalog.pg_get_functiondef(
    'platform.set_conversation_autonomy_control(uuid,uuid,bigint,text,text,uuid)'::REGPROCEDURE
  ) ~ 'evo:p5f3:conversation:',
  'private policy clock or shared conversation lock drifted'
);

SELECT pg_temp.assert_true(
  pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'platform.project_claimed_waha_observation_p5e(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE
  )) ~ 'waha_ack_binding_pending'
  AND pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'platform.project_claimed_waha_observation_p5e(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE
  )) ~ '''retryable_error'''
  AND pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'platform.project_claimed_waha_observation_p5e(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE
  )) ~ 'persist_effect := false',
  'pre-binding ACK must remain retryable without a persisted projection effect'
);

SELECT pg_temp.assert_true(
  pg_catalog.col_description(
    'platform.communication_messages'::REGCLASS,
    (
      SELECT attribute.attnum
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'platform.communication_messages'::REGCLASS
        AND attribute.attname = 'autonomous_reply_intent_id'
        AND NOT attribute.attisdropped
    )
  ) LIKE '%exact verified inbound trigger%transport and ACK evidence remain in private%',
  'autonomous outbound trigger/transport provenance comment drifted'
);

SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'JOIN platform_private\.provider_webhook_events AS source_event'
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'source_event\.verification_status = ''verified'''
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'source_event\.event_type IN \(''message'', ''message\.any''\)'
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'source_event\.payload_id = binding\.raw_message_id'
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ '''inside_reply_window'', source_message\.created_at BETWEEN[[:space:]]*policy_now - INTERVAL ''24 hours'' AND policy_now'
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ '''business_hours'',[[:space:]]*\(policy_now AT TIME ZONE ''Asia/Bishkek''\)',
  'verified exact inbound reply binding or policy snapshot drifted'
);

SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'platform.finish_autonomous_reply(uuid,uuid,uuid,text,text,text,timestamptz,uuid)'::REGPROCEDURE
  ) ~ 'p_provider_observed_at < attempt\.created_at - INTERVAL ''5 minutes'''
  AND pg_catalog.pg_get_functiondef(
    'platform.finish_autonomous_reply(uuid,uuid,uuid,text,text,text,timestamptz,uuid)'::REGPROCEDURE
  ) ~ 'p_provider_observed_at < source_message\.created_at',
  'accepted provider observation lower bounds drifted'
);

SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'platform.project_claimed_waha_observation(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE
  ) ~ 'platform_private\.autonomous_reply_provider_bindings'
  AND pg_catalog.pg_get_functiondef(
    'platform.project_claimed_waha_observation(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE
  ) ~ 'platform_private\.waha_ack_observations'
  AND pg_catalog.pg_get_functiondef(
    'platform.project_claimed_waha_observation(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE
  ) ~ 'platform\.waha_message_ack_current'
  AND pg_catalog.pg_get_functiondef(
    'platform.project_claimed_waha_observation(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE
  ) ~ 'platform\.project_claimed_waha_observation_p5e'
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE NOT trigger_row.tgisinternal
      AND trigger_row.tgname =
        'waha_message_ack_current_autonomous_projection'
      AND trigger_row.tgfoid =
        'platform_private.project_autonomous_reply_ack_state()'::REGPROCEDURE
  ),
  'autonomous provider binding ACK lookup/projection drifted'
);

SELECT pg_temp.assert_true(
  pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ '''mutable_gate_blocked''[[:space:]]*,[[:space:]]*fixed_policy_version'
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ '''manual_review''[[:space:]]*,[[:space:]]*NULL[[:space:]]*,[[:space:]]*NULL[[:space:]]*,[[:space:]]*NULL[[:space:]]*,[[:space:]]*now_at[[:space:]]*,[[:space:]]*now_at[[:space:]]*,[[:space:]]*FALSE'
  AND pg_catalog.pg_get_functiondef(
    'platform.claim_autonomous_reply(uuid,text,integer,text,uuid)'::REGPROCEDURE
  ) ~ 'decision_reason_code = EXCLUDED\.decision_reason_code',
  'mutable-gate manual-review safe projection drifted'
);

SELECT pg_temp.assert_true(
  count(*) = 1,
  'P5F3 safe-state Realtime invalidation trigger drifted'
)
FROM pg_catalog.pg_trigger AS trigger_row
WHERE NOT trigger_row.tgisinternal
  AND trigger_row.tgname =
    'conversation_autonomous_reply_state_realtime_invalidate'
  AND trigger_row.tgfoid =
    'platform_private.broadcast_platform_messaging_invalidation()'::REGPROCEDURE
  AND pg_catalog.encode(trigger_row.tgargs, 'escape') =
    'autonomous_reply\000';

-- Resolve the persistent two-tenant communication fixtures built by the
-- earlier authorization slices. All P5F3 rows below are synthetic and roll
-- back; no provider is called.
SELECT
  membership.organization_id AS p5f3_org_b,
  membership.id AS p5f3_admin_b_membership,
  profile.access_version AS p5f3_admin_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  membership.organization_id AS p5f3_org_a,
  profile.access_version AS p5f3_admin_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  conversation.id AS p5f3_conversation_b,
  conversation.responsible_sales_membership_id AS p5f3_sales_b,
  latest_message.id AS p5f3_source_b,
  latest_message.source_webhook_event_id AS p5f3_source_event_b
FROM platform.communication_conversations AS conversation
JOIN LATERAL (
  SELECT message.id, message.direction, message.source_webhook_event_id
  FROM platform.communication_messages AS message
  WHERE message.organization_id = conversation.organization_id
    AND message.conversation_id = conversation.id
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1
) AS latest_message ON latest_message.direction = 'inbound'
WHERE conversation.organization_id = :'p5f3_org_b'
  AND conversation.status = 'open'
ORDER BY conversation.created_at
LIMIT 1
\gset

SELECT conversation.id AS p5f3_conversation_a
FROM platform.communication_conversations AS conversation
WHERE conversation.organization_id = :'p5f3_org_a'
  AND conversation.status = 'open'
ORDER BY conversation.created_at
LIMIT 1
\gset

SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p5f3_admin_b_access_version'::BIGINT
)::TEXT AS p5f3_admin_b_claims
\gset

SELECT pg_temp.assert_true(
  :'p5f3_source_b' <> '' AND :'p5f3_conversation_a' <> '',
  'persistent P5F3 fixture resolution drifted'
);

-- Earlier authorization suites provide the tenant/conversation/message shape,
-- but they do not promise that the latest inbound came from verified P5A
-- webhook ingress. Normalize only this transaction-local source event into the
-- exact verified P5A shape that P5F3 is allowed to answer. The enclosing
-- transaction rolls the fixture back, and the append-only trigger is restored
-- before any service RPC executes.
ALTER TABLE platform_private.provider_webhook_events
  DISABLE TRIGGER provider_webhook_events_append_only;
UPDATE platform_private.provider_webhook_events
SET provider = 'waha',
    provider_account_ref = 'waha:evo-inbox',
    waha_session_name = 'evo-inbox',
    event_type = 'message',
    verification_status = 'verified',
    verification_headers = '{"hmac_verified":true}'::JSONB
WHERE organization_id = :'p5f3_org_b'
  AND id = :'p5f3_source_event_b';
ALTER TABLE platform_private.provider_webhook_events
  ENABLE TRIGGER provider_webhook_events_append_only;

SELECT source_event.payload_id AS p5f3_source_payload_id
FROM platform_private.provider_webhook_events AS source_event
WHERE source_event.organization_id = :'p5f3_org_b'
  AND source_event.id = :'p5f3_source_event_b'
\gset

INSERT INTO platform_private.waha_direct_chat_bindings (
  organization_id,
  waha_session_name,
  normalized_chat_id,
  conversation_id,
  source_webhook_event_id
)
SELECT
  :'p5f3_org_b',
  'evo-inbox',
  '996700000067@c.us',
  :'p5f3_conversation_b',
  :'p5f3_source_event_b'
WHERE NOT EXISTS (
  SELECT 1
  FROM platform_private.waha_direct_chat_bindings AS binding
  WHERE binding.organization_id = :'p5f3_org_b'
    AND binding.conversation_id = :'p5f3_conversation_b'
)
ON CONFLICT DO NOTHING;

INSERT INTO platform_private.waha_message_bindings (
  organization_id,
  waha_session_name,
  raw_message_id,
  communication_message_id,
  source_webhook_event_id
)
SELECT
  :'p5f3_org_b',
  'evo-inbox',
  :'p5f3_source_payload_id',
  :'p5f3_source_b',
  :'p5f3_source_event_b'
WHERE NOT EXISTS (
  SELECT 1
  FROM platform_private.waha_message_bindings AS binding
  WHERE binding.organization_id = :'p5f3_org_b'
    AND binding.communication_message_id = :'p5f3_source_b'
)
ON CONFLICT DO NOTHING;

INSERT INTO platform.waha_session_health (
  organization_id,
  waha_session_name,
  status,
  observed_at
) VALUES (
  :'p5f3_org_b',
  'evo-inbox',
  'WORKING',
  statement_timestamp()
)
ON CONFLICT (organization_id, waha_session_name) DO UPDATE
SET status = EXCLUDED.status,
    observed_at = EXCLUDED.observed_at;

SELECT
  binding.id AS p5f3_direct_binding,
  binding.normalized_chat_id AS p5f3_raw_chat
FROM platform_private.waha_direct_chat_bindings AS binding
WHERE binding.organization_id = :'p5f3_org_b'
  AND binding.conversation_id = :'p5f3_conversation_b'
  AND binding.waha_session_name = 'evo-inbox'
\gset

SELECT
  binding.id AS p5f3_reply_binding,
  binding.raw_message_id AS p5f3_raw_reply_to
FROM platform_private.waha_message_bindings AS binding
WHERE binding.organization_id = :'p5f3_org_b'
  AND binding.communication_message_id = :'p5f3_source_b'
  AND binding.waha_session_name = 'evo-inbox'
\gset

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM platform_private.waha_message_bindings AS binding
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = binding.organization_id
     AND source_event.id = binding.source_webhook_event_id
    WHERE binding.organization_id = :'p5f3_org_b'
      AND binding.communication_message_id = :'p5f3_source_b'
      AND binding.source_webhook_event_id = :'p5f3_source_event_b'
      AND binding.waha_session_name = 'evo-inbox'
      AND source_event.provider = 'waha'
      AND source_event.provider_account_ref = 'waha:evo-inbox'
      AND source_event.waha_session_name = 'evo-inbox'
      AND source_event.verification_status = 'verified'
      AND source_event.event_type IN ('message', 'message.any')
      AND source_event.payload_id = binding.raw_message_id
  ),
  'eligible reply target lacks exact verified P5A source evidence'
);

SELECT pg_catalog.jsonb_build_object(
  'schema_version', 1,
  'language', 'ru',
  'intent', 'admissions_discovery',
  'confidence', 90,
  'risk', 'low',
  'handoff_required', false,
  'handoff_reasons', '[]'::JSONB,
  'citations', '[]'::JSONB,
  'memory_changes', '[]'::JSONB,
  'qualification', pg_catalog.jsonb_build_object(
    'status', 'collecting',
    'completeness', 25,
    'missing_fact_keys', pg_catalog.jsonb_build_array('preferred_program'),
    'notes', 'Synthetic P5F3 qualification.'
  ),
  'reply_text', 'Здравствуйте! Какую программу вы рассматриваете?'
) AS p5f3_proposal_response
\gset

INSERT INTO platform_private.gemini_proposal_requests (
  id,
  organization_id,
  conversation_id,
  source_message_id,
  request_id,
  request_fingerprint,
  model_ref,
  schema_version,
  prompt_policy_version,
  private_context,
  context_sha256,
  input_sha256
) VALUES (
  '67000000-0000-4000-8000-000000000100',
  :'p5f3_org_b',
  :'p5f3_conversation_b',
  :'p5f3_source_b',
  '67000000-0000-4000-8000-000000000101',
  platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object('fixture', 'p5f3-request')
  ),
  'gemini-3.5-flash',
  1,
  'p5f2-gemini-proposal-v1',
  pg_catalog.jsonb_build_object(
    'retrieval', pg_catalog.jsonb_build_object('evidence', '[]'::JSONB)
  ),
  platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'retrieval', pg_catalog.jsonb_build_object('evidence', '[]'::JSONB)
    )
  ),
  platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object('fixture', 'p5f3-input')
  )
);

INSERT INTO platform_private.gemini_proposal_results (
  organization_id,
  conversation_id,
  source_message_id,
  proposal_request_id,
  outcome,
  failure_code,
  private_prompt_text,
  prompt_sha256,
  private_provider_interaction_ref,
  private_provider_status,
  private_response_json,
  response_sha256
) VALUES (
  :'p5f3_org_b',
  :'p5f3_conversation_b',
  :'p5f3_source_b',
  '67000000-0000-4000-8000-000000000100',
  'proposal_ready',
  NULL,
  'Synthetic P5F3 prompt.',
  platform_private.ai_memory_text_sha256('Synthetic P5F3 prompt.'),
  'synthetic-p5f3-provider-reference',
  'completed',
  :'p5f3_proposal_response'::JSONB,
  platform_private.ai_memory_json_sha256(
    :'p5f3_proposal_response'::JSONB
  )
);

-- Safe read defaults to paused/version zero before the first staff action.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'p5f3_admin_b_claims', true);
SELECT pg_catalog.to_jsonb(state.*)::TEXT AS p5f3_default_state
FROM platform.staff_conversation_autonomous_reply_state(
  :'p5f3_org_b',
  :'p5f3_conversation_b'
) AS state
\gset

SELECT pg_temp.assert_true(
  :'p5f3_default_state'::JSONB ->> 'control_state' = 'paused'
  AND :'p5f3_default_state'::JSONB ->> 'control_version' = '0'
  AND :'p5f3_default_state'::JSONB ->> 'control_reason' = 'no_control_event'
  AND NOT (:'p5f3_default_state'::JSONB ->> 'autonomous_authority')::BOOLEAN,
  'default safe autonomy state drifted'
);

SELECT platform.set_conversation_autonomy_control(
  :'p5f3_org_b',
  :'p5f3_conversation_b',
  0,
  'enabled',
  'Synthetic explicit staff enable',
  '67000000-0000-4000-8000-000000000150'
)::TEXT AS p5f3_control_json
\gset

SELECT pg_temp.assert_true(
  :'p5f3_control_json'::JSONB ->> 'control_state' = 'enabled'
  AND :'p5f3_control_json'::JSONB ->> 'control_version' = '1'
  AND (:'p5f3_control_json'::JSONB ->> 'autonomous_authority')::BOOLEAN,
  'explicit staff enable receipt drifted'
);

SELECT platform.set_conversation_autonomy_control(
  :'p5f3_org_b',
  :'p5f3_conversation_b',
  0,
  'enabled',
  'Synthetic explicit staff enable',
  '67000000-0000-4000-8000-000000000150'
)::TEXT AS p5f3_control_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.set_conversation_autonomy_control(
  :'p5f3_org_b',
  :'p5f3_conversation_b',
  1,
  'paused',
  'Conflicting request reuse',
  '67000000-0000-4000-8000-000000000150'
);
\set p5f3_control_conflict_state :SQLSTATE
SELECT platform.set_conversation_autonomy_control(
  :'p5f3_org_a',
  :'p5f3_conversation_a',
  0,
  'enabled',
  'Cross tenant attempt',
  '67000000-0000-4000-8000-000000000151'
);
\set p5f3_cross_tenant_control_state :SQLSTATE
SELECT * FROM platform_private.autonomous_reply_intents;
\set p5f3_authenticated_private_state :SQLSTATE
SELECT platform.claim_autonomous_reply(
  :'p5f3_org_b',
  'browser',
  60,
  'p5f3-v1',
  '67000000-0000-4000-8000-000000000152'
);
\set p5f3_authenticated_claim_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5f3_control_replay'::JSONB = :'p5f3_control_json'::JSONB
  AND :'p5f3_control_conflict_state' = '22023'
  AND :'p5f3_cross_tenant_control_state' = '42501'
  AND :'p5f3_authenticated_private_state' = '42501'
  AND :'p5f3_authenticated_claim_state' = '42501',
  'staff replay/tenant/private/service boundary drifted'
);

CREATE OR REPLACE FUNCTION platform_private.p5f3_policy_now()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN local_now::TIME < TIME '09:00'
      THEN (local_now::DATE + TIME '09:30') AT TIME ZONE 'Asia/Bishkek'
    WHEN local_now::TIME >= TIME '21:00'
      THEN (local_now::DATE + 1 + TIME '09:30') AT TIME ZONE 'Asia/Bishkek'
    ELSE pg_catalog.statement_timestamp()
  END
  FROM (
    SELECT pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Bishkek'
      AS local_now
  ) AS clock
$$;

REVOKE ALL ON FUNCTION platform_private.p5f3_policy_now()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

SELECT pg_temp.assert_true(
  (platform_private.p5f3_policy_now() AT TIME ZONE 'Asia/Bishkek')::TIME
    >= TIME '09:00'
  AND (platform_private.p5f3_policy_now() AT TIME ZONE 'Asia/Bishkek')::TIME
    < TIME '21:00',
  'disposable P5F3 policy clock did not enter the approved window'
);

SELECT
  source_event.event_type AS p5f3_original_source_event_type,
  source_event.verification_status::TEXT
    AS p5f3_original_source_verification_status,
  source_event.verification_headers::TEXT
    AS p5f3_original_source_verification_headers
FROM platform_private.provider_webhook_events AS source_event
WHERE source_event.organization_id = :'p5f3_org_b'
  AND source_event.id = :'p5f3_source_event_b'
\gset

-- Exercise the real claim against the P5E history/missing provenance shape.
-- The append-only trigger is disabled only for this transaction-local negative
-- fixture and is restored before the eligible claim below.
ALTER TABLE platform_private.provider_webhook_events
  DISABLE TRIGGER provider_webhook_events_append_only;
UPDATE platform_private.provider_webhook_events
SET event_type = 'history.message',
    verification_status = 'missing',
    verification_headers =
      '{"provenance":"api_history","webhook_verified":false,"read_only":true}'::JSONB
WHERE organization_id = :'p5f3_org_b'
  AND id = :'p5f3_source_event_b';
ALTER TABLE platform_private.provider_webhook_events
  ENABLE TRIGGER provider_webhook_events_append_only;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT platform.claim_autonomous_reply(
  :'p5f3_org_b',
  'p5f3-synthetic-worker',
  120,
  'p5f3-v1',
  '67000000-0000-4000-8000-000000000199'
)::TEXT AS p5f3_history_claim_json
\gset
RESET ROLE;

ALTER TABLE platform_private.provider_webhook_events
  DISABLE TRIGGER provider_webhook_events_append_only;
UPDATE platform_private.provider_webhook_events
SET event_type = :'p5f3_original_source_event_type',
    verification_status =
      :'p5f3_original_source_verification_status'
        ::platform.webhook_verification_status,
    verification_headers =
      :'p5f3_original_source_verification_headers'::JSONB
WHERE organization_id = :'p5f3_org_b'
  AND id = :'p5f3_source_event_b';
ALTER TABLE platform_private.provider_webhook_events
  ENABLE TRIGGER provider_webhook_events_append_only;

SELECT pg_temp.assert_true(
  :'p5f3_history_claim_json'::JSONB ->> 'state' = 'blocked'
  AND :'p5f3_history_claim_json'::JSONB ->> 'reason_code' =
    'binding_unavailable'
  AND :'p5f3_history_claim_json'::JSONB -> 'intent_id' = 'null'::JSONB,
  'history/missing reply binding did not fail closed'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT platform.claim_autonomous_reply(
  :'p5f3_org_b',
  'p5f3-synthetic-worker',
  120,
  'p5f3-v1',
  '67000000-0000-4000-8000-000000000200'
)::TEXT AS p5f3_claim_json
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5f3_claim_json'::JSONB ->> 'state' = 'claimed'
  AND :'p5f3_claim_json'::JSONB ->> 'waha_session_name' = 'evo-inbox'
  AND :'p5f3_claim_json'::JSONB ->> 'raw_chat_id' = :'p5f3_raw_chat'
  AND :'p5f3_claim_json'::JSONB ->> 'raw_reply_to' = :'p5f3_raw_reply_to',
  'eligible exact reply claim drifted'
);

SELECT
  :'p5f3_claim_json'::JSONB ->> 'intent_id' AS p5f3_intent_id,
  :'p5f3_claim_json'::JSONB ->> 'attempt_id' AS p5f3_attempt_id
\gset

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set ON_ERROR_STOP off
SELECT platform.claim_autonomous_reply(
  :'p5f3_org_b',
  'p5f3-synthetic-worker',
  120,
  'p5f3-v1',
  '67000000-0000-4000-8000-000000000200'
);
\set p5f3_claim_replay_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5f3_claim_replay_state' = '42501',
  'claimed request replay exposed a second transport instruction'
);

SELECT statement_timestamp()::TEXT AS p5f3_provider_observed_at
\gset

SELECT message.created_at::TEXT AS p5f3_source_created_at
FROM platform.communication_messages AS message
WHERE message.organization_id = :'p5f3_org_b'
  AND message.id = :'p5f3_source_b'
\gset

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set ON_ERROR_STOP off
SELECT platform.finish_autonomous_reply(
  :'p5f3_org_b',
  :'p5f3_intent_id',
  :'p5f3_attempt_id',
  'accepted',
  NULL,
  'p5f3-synthetic-provider-message-too-old',
  statement_timestamp() - INTERVAL '1 day',
  '67000000-0000-4000-8000-000000000299'
);
\set p5f3_old_provider_observed_state :SQLSTATE
\set ON_ERROR_STOP on

\set ON_ERROR_STOP off
SELECT platform.finish_autonomous_reply(
  :'p5f3_org_b',
  :'p5f3_intent_id',
  :'p5f3_attempt_id',
  'accepted',
  NULL,
  'p5f3-synthetic-provider-message-before-source',
  :'p5f3_source_created_at'::TIMESTAMPTZ - INTERVAL '1 second',
  '67000000-0000-4000-8000-000000000298'
);
\set p5f3_before_source_provider_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.finish_autonomous_reply(
  :'p5f3_org_b',
  :'p5f3_intent_id',
  :'p5f3_attempt_id',
  'accepted',
  NULL,
  'p5f3-synthetic-provider-message',
  :'p5f3_provider_observed_at'::TIMESTAMPTZ,
  '67000000-0000-4000-8000-000000000300'
)::TEXT AS p5f3_finish_json
\gset

SELECT platform.finish_autonomous_reply(
  :'p5f3_org_b',
  :'p5f3_intent_id',
  :'p5f3_attempt_id',
  'accepted',
  NULL,
  'p5f3-synthetic-provider-message',
  :'p5f3_provider_observed_at'::TIMESTAMPTZ,
  '67000000-0000-4000-8000-000000000300'
)::TEXT AS p5f3_finish_replay_json
\gset

SELECT platform.claim_autonomous_reply(
  :'p5f3_org_b',
  'p5f3-synthetic-worker',
  120,
  'p5f3-v1',
  '67000000-0000-4000-8000-000000000301'
)::TEXT AS p5f3_after_terminal_claim
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5f3_old_provider_observed_state' = '22023'
  AND :'p5f3_before_source_provider_state' = '22023',
  'accepted provider evidence lower-bound denial drifted'
);

SET CONSTRAINTS platform.communication_messages_private_autonomous_binding IMMEDIATE;
SET CONSTRAINTS platform.communication_messages_private_autonomous_binding DEFERRED;

SELECT pg_temp.assert_true(
  :'p5f3_finish_json'::JSONB ->> 'state' = 'accepted'
  AND :'p5f3_finish_json'::JSONB ->> 'communication_message_id' <> ''
  AND :'p5f3_finish_json'::JSONB -> 'ack_name' = 'null'::JSONB
  AND :'p5f3_finish_replay_json'::JSONB = :'p5f3_finish_json'::JSONB
  AND :'p5f3_after_terminal_claim'::JSONB ->> 'state' = 'empty',
  'accepted finish replay or terminal no-reclaim drifted'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM platform.communication_messages AS message
    JOIN platform_private.autonomous_reply_provider_bindings AS binding
      ON binding.organization_id = message.organization_id
     AND binding.communication_message_id = message.id
    WHERE message.organization_id = :'p5f3_org_b'
      AND message.autonomous_reply_intent_id = :'p5f3_intent_id'
      AND message.direction = 'outbound'
      AND message.message_identity_source =
        'private_autonomous_reply_binding'
      AND message.manual_send_authorization_id IS NULL
      AND message.waha_message_id IS NULL
      AND binding.waha_session_name = 'evo-inbox'
      AND binding.raw_message_id = 'p5f3-synthetic-provider-message'
  ),
  'accepted public message/private provider binding drifted'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', :'p5f3_admin_b_claims', true);
SELECT pg_catalog.to_jsonb(state.*)::TEXT AS p5f3_staff_state
FROM platform.staff_conversation_autonomous_reply_state(
  :'p5f3_org_b',
  :'p5f3_conversation_b'
) AS state
\gset
\set ON_ERROR_STOP off
SELECT * FROM platform_private.autonomous_reply_provider_bindings;
\set p5f3_authenticated_provider_binding_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5f3_staff_state'::JSONB ->> 'intent_state' = 'accepted'
  AND :'p5f3_staff_state'::JSONB ->> 'attempt_outcome' = 'accepted'
  AND :'p5f3_staff_state'::JSONB ->> 'communication_message_id' <> ''
  AND :'p5f3_authenticated_provider_binding_state' = '42501'
  AND NOT :'p5f3_staff_state' ~
    'raw|provider_message|reply_text|chat_id|waha_session|hash|phone|secret|token',
  'safe accepted staff state or private provider containment drifted'
);

-- Migration 067 wraps the accepted P5E projector only to add autonomous ACK
-- resolution. Prove that an ACK for an older history-bound outbound still
-- delegates through the original P5E binding path instead of being captured
-- or rejected by the autonomous lane. This is the exact cross-version path
-- used by the dedicated P5E browser proof.
SELECT
  binding.organization_id AS p5f3_legacy_ack_org,
  binding.communication_message_id AS p5f3_legacy_ack_message,
  conversation.responsible_sales_membership_id AS p5f3_legacy_ack_sales
FROM platform_private.waha_message_bindings AS binding
JOIN platform.communication_messages AS message
  ON message.organization_id = binding.organization_id
 AND message.id = binding.communication_message_id
JOIN platform.communication_conversations AS conversation
  ON conversation.organization_id = message.organization_id
 AND conversation.id = message.conversation_id
WHERE binding.waha_session_name = 'evo-inbox'
  AND binding.raw_message_id = 'p5c-history-outbound-1'
  AND message.direction = 'outbound'
  AND message.message_identity_source = 'private_waha_history_binding'
\gset

SELECT pg_temp.assert_true(
  :'p5f3_legacy_ack_org' <> ''
  AND :'p5f3_legacy_ack_message' <> ''
  AND :'p5f3_legacy_ack_sales' <> '',
  'persistent history-bound ACK fixture is unavailable'
);

UPDATE pgmq.q_platform_work_v1
SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
WHERE vt <= pg_catalog.clock_timestamp();

INSERT INTO platform_private.provider_webhook_events (
  id,
  organization_id,
  provider,
  provider_account_ref,
  provider_conversation_ref,
  provider_event_variant_ref,
  provider_request_id,
  waha_session_name,
  payload_id,
  event_type,
  provider_occurred_at,
  verification_status,
  raw_payload,
  verification_headers,
  verification_evidence_ref,
  payload_sha256,
  request_id
)
VALUES (
  '46700000-0000-4000-8000-000000000901',
  :'p5f3_legacy_ack_org',
  'waha',
  'waha:evo-inbox',
  NULL,
  'read',
  'synthetic-p5f3-legacy-history-ack',
  'evo-inbox',
  'local-message-ack-delivery:' || repeat('f1', 32) || ':' ||
    repeat('f2', 32),
  'message.ack',
  pg_catalog.statement_timestamp(),
  'verified',
  '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5c-history-outbound-1","fromMe":true,"ack":3,"ackName":"READ"}}',
  '{"hmac_verified":true}',
  'synthetic:p5f3:legacy-history-ack',
  repeat('f1', 32),
  '46700000-0000-4000-8000-000000000902'
);

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT platform.enqueue_verified_webhook_work(
  :'p5f3_legacy_ack_org',
  '46700000-0000-4000-8000-000000000901',
  pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to('p5f3-legacy-history-ack', 'UTF8')
    ),
    'hex'
  ),
  4,
  '46700000-0000-4000-8000-000000000903'
);

SELECT platform.claim_waha_event_projection(
  :'p5f3_legacy_ack_org',
  300,
  'p5f3-legacy-history-ack-worker',
  '46700000-0000-4000-8000-000000000904'
)::TEXT AS p5f3_legacy_ack_claim
\gset

SELECT platform.project_claimed_waha_observation(
  :'p5f3_legacy_ack_org',
  (:'p5f3_legacy_ack_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5f3_legacy_ack_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5f3_legacy_ack_sales',
  '46700000-0000-4000-8000-000000000905'
)::TEXT AS p5f3_legacy_ack_projection
\gset

SELECT platform.finish_waha_event_projection(
  :'p5f3_legacy_ack_org',
  (:'p5f3_legacy_ack_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5f3_legacy_ack_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'p5f3_legacy_ack_projection'::JSONB ->> 'disposition')::
    platform.durable_work_finish_outcome,
  :'p5f3_legacy_ack_projection'::JSONB ->> 'error_code',
  :'p5f3_legacy_ack_projection'::JSONB ->> 'evidence_ref',
  NULL,
  '46700000-0000-4000-8000-000000000906'
)::TEXT AS p5f3_legacy_ack_finish
\gset

RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5f3_legacy_ack_projection'::JSONB ->> 'disposition' = 'succeeded'
  AND :'p5f3_legacy_ack_projection'::JSONB ->> 'waha_ack_name' = 'READ'
  AND :'p5f3_legacy_ack_projection'::JSONB ->>
    'communication_message_id' = :'p5f3_legacy_ack_message'
  AND :'p5f3_legacy_ack_finish'::JSONB ->> 'state' = 'succeeded'
  AND EXISTS (
    SELECT 1
    FROM platform_private.waha_ack_observations AS observation
    WHERE observation.organization_id = :'p5f3_legacy_ack_org'
      AND observation.communication_message_id = :'p5f3_legacy_ack_message'
      AND observation.source_webhook_event_id =
        '46700000-0000-4000-8000-000000000901'
      AND observation.ack_name = 'READ'
  ),
  'migration 067 no longer preserves the P5E history-bound ACK path'
);

ROLLBACK;
