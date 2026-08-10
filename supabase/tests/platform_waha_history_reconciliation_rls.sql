\set ON_ERROR_STOP on

-- P5C acceptance uses synthetic normalized history observations in the
-- disposable authorization database. It performs no WAHA/provider call,
-- WhatsApp send, read-mark, session mutation or amoCRM action.

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P5C assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

SELECT
  membership.organization_id AS org_a_id,
  membership.id AS sales_a_membership_id,
  profile.access_version AS sales_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '4b500000-0000-4000-8000-000000000003'
\gset

SELECT
  membership.organization_id AS org_b_id,
  membership.id AS sales_b_membership_id
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000007'
\gset

SELECT pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'platform.begin_waha_history_reconciliation(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.begin_waha_history_reconciliation(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.begin_waha_history_reconciliation(uuid,text,text,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.project_waha_history_page(uuid,uuid,text,text,jsonb,integer,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.project_waha_history_page(uuid,uuid,text,text,jsonb,integer,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.project_waha_history_page(uuid,uuid,text,text,jsonb,integer,integer,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.finish_waha_history_reconciliation(uuid,uuid,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.finish_waha_history_reconciliation(uuid,uuid,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.finish_waha_history_reconciliation(uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'history RPC privileges are not service-only'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    'anon',
    'platform_private.waha_history_reconciliation_runs',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.waha_history_reconciliation_runs',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.waha_history_reconciliation_runs',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'platform_private.waha_history_message_observations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.waha_history_message_observations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.waha_history_message_observations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'platform_private.waha_history_reconciliation_checkpoints',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.waha_history_reconciliation_checkpoints',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.waha_history_reconciliation_checkpoints',
    'SELECT'
  ),
  'private history evidence tables grant direct access'
);

SELECT pg_temp.assert_true(
  bool_and(class.relrowsecurity AND class.relforcerowsecurity),
  'private history evidence is not FORCE RLS'
)
  FROM pg_class AS class
  JOIN pg_namespace AS namespace
    ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'platform_private'
    AND class.relname IN (
      'waha_history_reconciliation_runs',
      'waha_history_reconciliation_lifecycle',
      'waha_history_reconciliation_requests',
      'waha_history_message_observations',
      'waha_history_projection_effects',
      'waha_history_reconciliation_checkpoints'
    );

\set ON_ERROR_STOP off
SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
SELECT platform.begin_waha_history_reconciliation(
  :'org_a_id',
  'evo-inbox',
  'NOWEB',
  :'sales_a_membership_id',
  '46100000-0000-4000-8000-000000000001'
);
\set p5c_anon_rpc_state :SQLSTATE
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO '{"role":"authenticated"}';
SET ROLE authenticated;
SELECT platform.begin_waha_history_reconciliation(
  :'org_a_id',
  'evo-inbox',
  'NOWEB',
  :'sales_a_membership_id',
  '46100000-0000-4000-8000-000000000002'
);
\set p5c_authenticated_rpc_state :SQLSTATE
SELECT count(*) FROM platform_private.waha_history_reconciliation_runs;
\set p5c_authenticated_table_state :SQLSTATE
RESET ROLE;
RESET request.jwt.claims;
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p5c_anon_rpc_state' = '42501'
  AND :'p5c_authenticated_rpc_state' = '42501'
  AND :'p5c_authenticated_table_state' = '42501',
  'anon/authenticated bypassed a service-only RPC or private table'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.begin_waha_history_reconciliation(
  :'org_a_id',
  'evo-inbox',
  'NOWEB',
  :'sales_a_membership_id',
  '46100000-0000-4000-8000-000000000101'
)::TEXT AS p5c_begin
\gset

SELECT (:'p5c_begin'::JSONB ->> 'run_id') AS p5c_run_id
\gset

\set ON_ERROR_STOP off
SELECT platform.begin_waha_history_reconciliation(
  :'org_a_id',
  'crm_primary',
  'NOWEB',
  :'sales_a_membership_id',
  '46100000-0000-4000-8000-000000000102'
);
\set p5c_wrong_begin_session_state :SQLSTATE

SELECT platform.begin_waha_history_reconciliation(
  :'org_a_id',
  'evo-inbox',
  'UNKNOWN',
  :'sales_a_membership_id',
  '46100000-0000-4000-8000-000000000118'
);
\set p5c_unknown_engine_state :SQLSTATE

SELECT platform.project_waha_history_page(
  :'org_b_id',
  :'p5c_run_id',
  'evo-inbox',
  '14155550610@c.us',
  '[]'::JSONB,
  1,
  0,
  '46100000-0000-4000-8000-000000000103'
);
\set p5c_cross_org_state :SQLSTATE

SELECT platform.project_waha_history_page(
  :'org_a_id',
  :'p5c_run_id',
  'crm_primary',
  '14155550610@c.us',
  '[]'::JSONB,
  1,
  0,
  '46100000-0000-4000-8000-000000000104'
);
\set p5c_wrong_page_session_state :SQLSTATE

SELECT platform.project_waha_history_page(
  :'org_a_id',
  :'p5c_run_id',
  'evo-inbox',
  '120363000000000000@g.us',
  '[]'::JSONB,
  1,
  0,
  '46100000-0000-4000-8000-000000000105'
);
\set p5c_group_identifier_state :SQLSTATE

SELECT platform.project_waha_history_page(
  :'org_a_id',
  :'p5c_run_id',
  'evo-inbox',
  '14155550610@c.us',
  jsonb_build_array(
    jsonb_build_object(
      'raw_message_id', 'p5c-history-empty-non-media',
      'direction', 'inbound',
      'occurred_at', '2026-08-09T08:59:00+06:00',
      'body_text', '',
      'has_media', FALSE
    )
  ),
  0,
  1,
  '46100000-0000-4000-8000-000000000119'
);
\set p5c_empty_non_media_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p5c_wrong_begin_session_state' = '22023'
  AND :'p5c_unknown_engine_state' = '22023'
  AND :'p5c_cross_org_state' = '42501'
  AND :'p5c_wrong_page_session_state' = '22023'
  AND :'p5c_group_identifier_state' = '22023'
  AND :'p5c_empty_non_media_state' = '22023',
  'history tenant/session/direct-chat boundaries did not fail closed'
);

-- A provider chats page may contain only rejected non-direct chats. The server
-- passes no raw chat identifier and the cursor can advance without persisting
-- the rejected group/status/broadcast ID.
SELECT platform.project_waha_history_page(
  :'org_a_id',
  :'p5c_run_id',
  'evo-inbox',
  NULL,
  '[]'::JSONB,
  1,
  0,
  '46100000-0000-4000-8000-000000000106'
)::TEXT AS p5c_skipped_chat_page
\gset

SELECT platform.project_waha_history_page(
  :'org_a_id',
  :'p5c_run_id',
  'evo-inbox',
  '14155550610@s.whatsapp.net',
  jsonb_build_array(
    jsonb_build_object(
      'raw_message_id', 'p5c-history-inbound-1',
      'direction', 'inbound',
      'occurred_at', '2026-08-09T09:00:00+06:00',
      'body_text', 'Synthetic P5C inbound',
      'has_media', FALSE
    ),
    jsonb_build_object(
      'raw_message_id', 'p5c-history-outbound-1',
      'direction', 'outbound',
      'occurred_at', '2026-08-09T09:01:00+06:00',
      'body_text', 'Synthetic P5C historical outbound',
      'has_media', FALSE
    ),
    jsonb_build_object(
      'raw_message_id', 'p5c-history-media-1',
      'direction', 'inbound',
      'occurred_at', '2026-08-09T09:02:00+06:00',
      'body_text', '',
      'has_media', TRUE
    )
  ),
  1,
  3,
  '46100000-0000-4000-8000-000000000107'
)::TEXT AS p5c_project_page
\gset

SELECT platform.project_waha_history_page(
  :'org_a_id',
  :'p5c_run_id',
  'evo-inbox',
  '14155550610@s.whatsapp.net',
  jsonb_build_array(
    jsonb_build_object(
      'raw_message_id', 'p5c-history-inbound-1',
      'direction', 'inbound',
      'occurred_at', '2026-08-09T09:00:00+06:00',
      'body_text', 'Synthetic P5C inbound',
      'has_media', FALSE
    ),
    jsonb_build_object(
      'raw_message_id', 'p5c-history-outbound-1',
      'direction', 'outbound',
      'occurred_at', '2026-08-09T09:01:00+06:00',
      'body_text', 'Synthetic P5C historical outbound',
      'has_media', FALSE
    ),
    jsonb_build_object(
      'raw_message_id', 'p5c-history-media-1',
      'direction', 'inbound',
      'occurred_at', '2026-08-09T09:02:00+06:00',
      'body_text', '',
      'has_media', TRUE
    )
  ),
  1,
  3,
  '46100000-0000-4000-8000-000000000107'
)::TEXT AS p5c_project_replay
\gset

-- A fresh overlapping page is semantically idempotent: existing effects are
-- revalidated, no duplicate public/private messages are created, and only the
-- durable cursor advances.
SELECT platform.project_waha_history_page(
  :'org_a_id',
  :'p5c_run_id',
  'evo-inbox',
  '14155550610@c.us',
  jsonb_build_array(
    jsonb_build_object(
      'raw_message_id', 'p5c-history-inbound-1',
      'direction', 'inbound',
      'occurred_at', '2026-08-09T09:00:00+06:00',
      'body_text', 'Synthetic P5C inbound',
      'has_media', FALSE
    ),
    jsonb_build_object(
      'raw_message_id', 'p5c-history-outbound-1',
      'direction', 'outbound',
      'occurred_at', '2026-08-09T09:01:00+06:00',
      'body_text', 'Synthetic P5C historical outbound',
      'has_media', FALSE
    ),
    jsonb_build_object(
      'raw_message_id', 'p5c-history-media-1',
      'direction', 'inbound',
      'occurred_at', '2026-08-09T09:02:00+06:00',
      'body_text', '',
      'has_media', TRUE
    )
  ),
  1,
  6,
  '46100000-0000-4000-8000-000000000108'
)::TEXT AS p5c_overlap_page
\gset

RESET ROLE;
RESET request.jwt.claims;

SELECT binding.conversation_id AS p5c_conversation_id
FROM platform_private.waha_direct_chat_bindings AS binding
WHERE binding.organization_id = :'org_a_id'
  AND binding.waha_session_name = 'evo-inbox'
  AND binding.normalized_chat_id = '14155550610@c.us'
\gset

SELECT pg_temp.assert_true(
  :'p5c_project_page'::JSONB = :'p5c_project_replay'::JSONB
  AND (:'p5c_project_page'::JSONB ->> 'state') = 'running'
  AND (:'p5c_project_page'::JSONB ->> 'projected_count')::INTEGER = 3
  AND (:'p5c_overlap_page'::JSONB ->> 'projected_count')::INTEGER = 0
  AND (:'p5c_overlap_page'::JSONB ->> 'chat_offset')::INTEGER = 1
  AND (:'p5c_overlap_page'::JSONB ->> 'message_offset')::INTEGER = 6,
  'page projection/replay/cursor response is invalid'
);

SELECT pg_temp.assert_true(
  conversation.responsible_sales_membership_id = :'sales_a_membership_id'
  AND conversation.sales_authority_source = 'platform_intake'
  AND conversation.amocrm_account_id IS NULL
  AND conversation.amocrm_lead_id IS NULL
  AND conversation.amocrm_contact_id IS NULL,
  'history projection changed assignment or invented amoCRM authority'
)
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = :'org_a_id'
    AND conversation.id = :'p5c_conversation_id';

SELECT pg_temp.assert_true(
  count(*) = 3
  AND count(*) FILTER (WHERE message.direction = 'inbound') = 2
  AND count(*) FILTER (WHERE message.direction = 'outbound') = 1
  AND count(*) FILTER (
    WHERE message.direction = 'outbound'
      AND message.manual_send_authorization_id IS NULL
      AND message.message_identity_source = 'private_waha_history_binding'
  ) = 1
  AND bool_and(
    message.waha_session_name IS NULL
    AND message.waha_message_id IS NULL
    AND message.kommo_account_id IS NULL
    AND message.kommo_conversation_id IS NULL
    AND message.kommo_message_id IS NULL
    AND message.amocrm_account_id IS NULL
    AND message.amocrm_lead_id IS NULL
    AND message.amocrm_contact_id IS NULL
  ),
  'public message directions/provenance/provider identity are invalid'
)
  FROM platform.communication_messages AS message
  WHERE message.organization_id = :'org_a_id'
    AND message.conversation_id = :'p5c_conversation_id';

SELECT pg_temp.assert_true(
  count(*) = 1
  AND bool_and(
    message.body_text =
      '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.'
  ),
  'media-only history did not receive the fixed operator marker'
)
  FROM platform.communication_messages AS message
  JOIN platform_private.waha_message_bindings AS binding
    ON binding.organization_id = message.organization_id
   AND binding.communication_message_id = message.id
  WHERE binding.organization_id = :'org_a_id'
    AND binding.raw_message_id = 'p5c-history-media-1';

SELECT pg_temp.assert_true(
  count(*) = 3
  AND bool_and(
    event.verification_status = 'missing'
    AND event.event_type = 'history.message'
    AND event.verification_headers ->> 'provenance' = 'api_history'
    AND event.verification_headers -> 'webhook_verified' = 'false'::JSONB
    AND event.verification_headers -> 'read_only' = 'true'::JSONB
  ),
  'history source envelopes fabricated webhook verification or lost provenance'
)
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = :'org_a_id'
    AND event.provider = 'waha'
    AND event.waha_session_name = 'evo-inbox'
    AND event.event_type = 'history.message'
    AND event.payload_id LIKE 'p5c-history-%-1';

SELECT pg_temp.assert_true(
  position('14155550610@c.us' IN row_to_json(message)::TEXT) = 0
  AND position('p5c-history-inbound-1' IN row_to_json(message)::TEXT) = 0
  AND position('p5c-history-outbound-1' IN row_to_json(message)::TEXT) = 0
  AND position('p5c-history-media-1' IN row_to_json(message)::TEXT) = 0,
  'raw WAHA chat/message identifiers leaked into a public message row'
)
  FROM platform.communication_messages AS message
  WHERE message.organization_id = :'org_a_id'
    AND message.conversation_id = :'p5c_conversation_id'
  LIMIT 1;

-- Authorized staff receives the accepted public history projection but every
-- provider identifier remains null. No private raw ID is returned by the RPC.
SELECT jsonb_build_object(
  'sub', '4b500000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'sales_a_access_version'::BIGINT
)::TEXT AS p5c_sales_claims
\gset

SET request.jwt.claims TO :'p5c_sales_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p5c_staff_message_count,
       bool_and(
         waha_session_name IS NULL
         AND waha_message_id IS NULL
         AND kommo_message_id IS NULL
         AND amocrm_lead_id IS NULL
       )::TEXT AS p5c_staff_provider_ids_private
FROM platform.staff_conversation_messages(
  :'org_a_id',
  :'p5c_conversation_id'
)
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  :'p5c_staff_message_count'::INTEGER = 3
  AND :'p5c_staff_provider_ids_private'::BOOLEAN,
  'authorized staff history RPC exposed provider identity or lost messages'
);

-- Same request id with changed input is rejected before any mutation.
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.project_waha_history_page(
  :'org_a_id',
  :'p5c_run_id',
  'evo-inbox',
  '14155550610@c.us',
  '[]'::JSONB,
  2,
  0,
  '46100000-0000-4000-8000-000000000108'
);
\set p5c_changed_replay_state :SQLSTATE

-- Same provider identity with altered content is a conflict. Because the page
-- is atomic, the durable cursor remains at 1/6.
SELECT platform.project_waha_history_page(
  :'org_a_id',
  :'p5c_run_id',
  'evo-inbox',
  '14155550610@c.us',
  jsonb_build_array(
    jsonb_build_object(
      'raw_message_id', 'p5c-history-inbound-1',
      'direction', 'inbound',
      'occurred_at', '2026-08-09T09:00:00+06:00',
      'body_text', 'Conflicting content',
      'has_media', FALSE
    )
  ),
  1,
  7,
  '46100000-0000-4000-8000-000000000109'
);
\set p5c_payload_conflict_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.finish_waha_history_reconciliation(
  :'org_a_id',
  :'p5c_run_id',
  'completed',
  '46100000-0000-4000-8000-000000000110'
)::TEXT AS p5c_finish
\gset

SELECT platform.finish_waha_history_reconciliation(
  :'org_a_id',
  :'p5c_run_id',
  'completed',
  '46100000-0000-4000-8000-000000000110'
)::TEXT AS p5c_finish_replay
\gset

SELECT platform.begin_waha_history_reconciliation(
  :'org_a_id',
  'evo-inbox',
  'NOWEB',
  :'sales_a_membership_id',
  '46100000-0000-4000-8000-000000000111'
)::TEXT AS p5c_second_begin
\gset
SELECT (:'p5c_second_begin'::JSONB ->> 'run_id') AS p5c_second_run_id
\gset

SELECT platform.finish_waha_history_reconciliation(
  :'org_a_id',
  :'p5c_second_run_id',
  'paused',
  '46100000-0000-4000-8000-000000000112'
)::TEXT AS p5c_pause
\gset

SELECT platform.begin_waha_history_reconciliation(
  :'org_a_id',
  'evo-inbox',
  'NOWEB',
  :'sales_a_membership_id',
  '46100000-0000-4000-8000-000000000113'
)::TEXT AS p5c_resume
\gset

RESET ROLE;
RESET request.jwt.claims;

SELECT chat_offset::TEXT AS p5c_last_chat_offset,
       message_offset::TEXT AS p5c_last_message_offset
FROM platform_private.waha_history_reconciliation_checkpoints
WHERE organization_id = :'org_a_id'
  AND run_id = :'p5c_run_id'
ORDER BY checkpointed_at DESC, id DESC
LIMIT 1
\gset

SELECT pg_temp.assert_true(
  :'p5c_changed_replay_state' = '22023'
  AND :'p5c_payload_conflict_state' = '23505'
  AND :'p5c_last_chat_offset'::INTEGER = 1
  AND :'p5c_last_message_offset'::INTEGER = 6
  AND :'p5c_finish'::JSONB = :'p5c_finish_replay'::JSONB
  AND (:'p5c_finish'::JSONB ->> 'state') = 'completed'
  AND (:'p5c_finish'::JSONB ->> 'projected_count')::INTEGER = 3
  AND (:'p5c_finish'::JSONB ->> 'chat_offset')::INTEGER = 1
  AND (:'p5c_finish'::JSONB ->> 'message_offset')::INTEGER = 6,
  'conflict rollback, completion or finish replay evidence is invalid'
);

SELECT pg_temp.assert_true(
  (:'p5c_second_begin'::JSONB ->> 'run_id') <>
    (:'p5c_begin'::JSONB ->> 'run_id')
  AND (:'p5c_pause'::JSONB ->> 'state') = 'paused'
  AND (:'p5c_resume'::JSONB ->> 'run_id') =
    (:'p5c_second_begin'::JSONB ->> 'run_id')
  AND (:'p5c_resume'::JSONB ->> 'state') = 'running'
  AND (:'p5c_resume'::JSONB ->> 'chat_offset')::INTEGER = 0
  AND (:'p5c_resume'::JSONB ->> 'message_offset')::INTEGER = 0,
  'completed run replacement or paused run resume is invalid'
);

SELECT pg_temp.assert_true(
  count(*) = 3
  AND count(*) FILTER (WHERE state = 'running') = 2
  AND count(*) FILTER (WHERE state = 'paused') = 1,
  'append-only lifecycle did not preserve begin/pause/resume evidence'
)
  FROM platform_private.waha_history_reconciliation_lifecycle
  WHERE organization_id = :'org_a_id'
    AND run_id = :'p5c_second_run_id';

SELECT pg_temp.assert_true(
  count(*) = 3
  AND bool_and(effect.disposition IN ('projected', 'reconciled_existing')),
  'projection effects are incomplete or invalid'
)
  FROM platform_private.waha_history_projection_effects AS effect
  WHERE effect.organization_id = :'org_a_id'
    AND effect.run_id = :'p5c_run_id';

-- A corrupted newest run without append-only lifecycle evidence must stop the
-- service path. It must never be hidden by creating a replacement run.
INSERT INTO platform_private.waha_history_reconciliation_runs (
  id,
  organization_id,
  waha_session_name,
  engine,
  intake_sales_membership_id,
  source_provenance,
  start_request_id,
  started_at
)
VALUES (
  '46100000-0000-4000-8000-000000000114',
  :'org_a_id',
  'evo-inbox',
  'NOWEB',
  :'sales_a_membership_id',
  'api_history',
  '46100000-0000-4000-8000-000000000115',
  clock_timestamp() + INTERVAL '1 hour'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.begin_waha_history_reconciliation(
  :'org_a_id',
  'evo-inbox',
  'NOWEB',
  :'sales_a_membership_id',
  '46100000-0000-4000-8000-000000000116'
);
\set p5c_missing_lifecycle_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  :'p5c_missing_lifecycle_state' = '55000',
  'a run without lifecycle evidence did not fail closed'
);

SELECT 'platform WAHA history reconciliation RLS checks passed' AS result;
