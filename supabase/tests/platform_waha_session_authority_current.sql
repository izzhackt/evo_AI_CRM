\set ON_ERROR_STOP on

-- P8R6 current-boundary acceptance. All evidence is synthetic and local to
-- the disposable PostgreSQL database; no WAHA, amoCRM, AI or managed
-- Supabase provider is contacted.
BEGIN;

DO $$
DECLARE
  message_routine CONSTANT REGPROCEDURE :=
    'platform.sync_lead_agent_whatsapp(uuid,uuid,uuid,bigint,bigint,bigint,uuid)'::REGPROCEDURE;
  status_routine CONSTANT REGPROCEDURE :=
    'platform.sync_lead_agent_session_status(uuid,uuid,uuid)'::REGPROCEDURE;
  health_routine CONSTANT REGPROCEDURE :=
    'platform.staff_waha_session_health(uuid,text)'::REGPROCEDURE;
  binding_routine CONSTANT REGPROCEDURE :=
    'platform_private.require_private_waha_message_binding()'::REGPROCEDURE;
  message_definition TEXT := pg_catalog.pg_get_functiondef(message_routine::OID);
  status_definition TEXT := pg_catalog.pg_get_functiondef(status_routine::OID);
  health_definition TEXT := pg_catalog.pg_get_functiondef(health_routine::OID);
  binding_definition TEXT := pg_catalog.pg_get_functiondef(binding_routine::OID);
  health_constraint TEXT;
  observation_constraint TEXT;
  forbidden_role TEXT;
BEGIN
  IF message_definition NOT LIKE '%provider_account_ref <> ''waha:evo-inbox''%'
    OR message_definition NOT LIKE '%waha_session_name <> ''evo-inbox''%'
    OR message_definition LIKE '%crm_primary%'
  THEN
    RAISE EXCEPTION
      'Lead-Agent message projection is not exact evo-inbox/waha:evo-inbox';
  END IF;

  IF status_definition NOT LIKE '%provider_account_ref <> ''waha:evo-inbox''%'
    OR status_definition NOT LIKE '%waha_session_name <> ''evo-inbox''%'
    OR status_definition LIKE '%crm_primary%'
  THEN
    RAISE EXCEPTION
      'Lead-Agent session-status projection is not exact evo-inbox/waha:evo-inbox';
  END IF;

  IF health_definition NOT LIKE '%p_waha_session_name <> ''evo-inbox''%'
    OR health_definition LIKE '%crm_primary%'
  THEN
    RAISE EXCEPTION 'Staff current health is not restricted to evo-inbox';
  END IF;

  IF binding_definition NOT LIKE '%binding.waha_session_name = ''evo-inbox''%'
    OR binding_definition NOT LIKE '%provider_account_ref = ''waha:evo-inbox''%'
    OR binding_definition LIKE '%crm_primary%'
  THEN
    RAISE EXCEPTION 'New private-message binding is not exact evo-inbox';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = message_routine::OID
      AND routine.prosecdef
      AND routine.provolatile = 'v'
      AND NOT routine.proretset
      AND routine.prorettype = 'jsonb'::REGTYPE
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = status_routine::OID
      AND routine.prosecdef
      AND routine.provolatile = 'v'
      AND NOT routine.proretset
      AND routine.prorettype = 'jsonb'::REGTYPE
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = health_routine::OID
      AND routine.prosecdef
      AND routine.provolatile = 's'
      AND routine.proretset
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'P8R6 RPC signature or hardened posture drifted';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
  INTO health_constraint
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'platform.waha_session_health'::REGCLASS
    AND constraint_row.conname = 'waha_session_health_session_name_check';

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
  INTO observation_constraint
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid =
      'platform_private.waha_session_observations'::REGCLASS
    AND constraint_row.conname =
      'waha_session_observations_session_name_check';

  IF health_constraint NOT LIKE '%evo-inbox%'
    OR health_constraint NOT LIKE '%crm_primary%'
    OR observation_constraint NOT LIKE '%evo-inbox%'
    OR observation_constraint NOT LIKE '%crm_primary%'
  THEN
    RAISE EXCEPTION
      'Historical session constraints no longer preserve exact provenance';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role', message_routine, 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', status_routine, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role lacks current Lead-Agent projection EXECUTE';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role, message_routine, 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      forbidden_role, status_routine, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        '% unexpectedly has Lead-Agent projection EXECUTE', forbidden_role;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated', health_routine, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', health_routine, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Staff current-health grants drifted';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P8R6 assertion failed: %', p_message;
  END IF;
END
$$;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        source_event.provider_account_ref = 'waha:crm_primary'
        AND source_event.waha_session_name = 'crm_primary'
        AND source_event.event_type = 'session.status'
        AND source_event.provider_occurred_at =
          '2026-08-22 09:00:00+06'::TIMESTAMPTZ
        AND source_event.received_at =
          '2026-08-22 09:00:01+06'::TIMESTAMPTZ
        AND source_event.raw_payload =
          '{"event":"session.status","session":"crm_primary","payload":{"name":"crm_primary","status":"LEGACY_WORKING"}}'::JSONB
      )
    FROM platform_private.provider_webhook_events AS source_event
    WHERE source_event.id = '82000000-0000-4000-8000-000000000901'
      AND source_event.organization_id =
        '82000000-0000-4000-8000-000000000900'
  ),
  'migration 082 rewrote or removed historical provider evidence'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        observation.source_webhook_event_id =
          '82000000-0000-4000-8000-000000000901'
        AND observation.waha_session_name = 'crm_primary'
        AND observation.status = 'LEGACY_WORKING'
        AND observation.observed_at =
          '2026-08-22 09:00:00+06'::TIMESTAMPTZ
        AND observation.request_id =
          '82000000-0000-4000-8000-000000000904'
        AND observation.created_at =
          '2026-08-22 09:00:02+06'::TIMESTAMPTZ
      )
    FROM platform_private.waha_session_observations AS observation
    WHERE observation.id = '82000000-0000-4000-8000-000000000902'
      AND observation.organization_id =
        '82000000-0000-4000-8000-000000000900'
  ),
  'migration 082 rewrote or removed historical session observation'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        health.waha_session_name = 'crm_primary'
        AND health.status = 'LEGACY_WORKING'
        AND health.observed_at =
          '2026-08-22 09:00:00+06'::TIMESTAMPTZ
      )
    FROM platform.waha_session_health AS health
    WHERE health.organization_id =
      '82000000-0000-4000-8000-000000000900'
  ),
  'migration 082 rewrote or removed historical health evidence'
);

INSERT INTO platform.organizations (id, name)
VALUES (
  '82000000-0000-4000-8000-000000000001',
  'P8R6 current session acceptance'
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    '82000000-0000-4000-8000-000000000010',
    'p8r6-sales@example.invalid',
    '{}'::JSONB
  ),
  (
    '82000000-0000-4000-8000-000000000020',
    'p8r6-admin@example.invalid',
    '{}'::JSONB
  );

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (
    '82000000-0000-4000-8000-000000000011',
    '82000000-0000-4000-8000-000000000010',
    'P8R6 Sales', 'active', 1
  ),
  (
    '82000000-0000-4000-8000-000000000021',
    '82000000-0000-4000-8000-000000000020',
    'P8R6 Admin', 'active', 1
  );

INSERT INTO platform.role_bundle_versions (
  id, role, version, status, label, published_at
) VALUES (
  '82000000-0000-4000-8000-000000000012',
  'sales', 820001, 'draft', 'P8R6 exact-session sales', NULL
);

INSERT INTO platform.role_bundle_permissions (
  bundle_id, bundle_role, permission_key
) VALUES
  (
    '82000000-0000-4000-8000-000000000012',
    'sales', 'organization.read'
  ),
  (
    '82000000-0000-4000-8000-000000000012',
    'sales', 'communication.read.full'
  );

UPDATE platform.role_bundle_versions
SET
  status = 'published',
  published_at = '2026-08-23 09:00:00+06'
WHERE id = '82000000-0000-4000-8000-000000000012';

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status,
  "current_role", current_bundle_id
) VALUES
  (
    '82000000-0000-4000-8000-000000000013',
    '82000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000011',
    'active', 'sales',
    '82000000-0000-4000-8000-000000000012'
  ),
  (
    '82000000-0000-4000-8000-000000000023',
    '82000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000021',
    'active', 'admin',
    '00000000-0000-4000-8000-000000000001'
  );

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version, is_active
) VALUES (
  '82000000-0000-4000-8000-000000000014',
  '82000000-0000-4000-8000-000000000001',
  'organization',
  '82000000-0000-4000-8000-000000000001',
  1, TRUE
);

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id,
  reason, request_id
) VALUES
  (
    '82000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000013',
    '82000000-0000-4000-8000-000000000014',
    1, 1, TRUE, 'service', NULL,
    'Grant P8R6 Sales organization acceptance scope',
    '82000000-0000-4000-8000-000000000015'
  ),
  (
    '82000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000023',
    '82000000-0000-4000-8000-000000000014',
    1, 1, TRUE, 'service', NULL,
    'Grant P8R6 Admin organization acceptance scope',
    '82000000-0000-4000-8000-000000000025'
  );

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256,
  request_id
) VALUES
  (
    '82000000-0000-4000-8000-000000000101',
    '82000000-0000-4000-8000-000000000001',
    'waha', 'waha:evo-inbox', NULL, NULL,
    'p8r6-current-message', 'evo-inbox',
    'p8r6-current-message', 'message.any',
    '2026-08-23 10:00:00+06', 'verified',
    '{"event":"message.any","session":"evo-inbox","payload":{"id":"p8r6-current-message","from":"996555820001@c.us","fromMe":false,"body":"Synthetic P8R6 inbound"}}',
    '{"hmac_verified":true}', 'synthetic:p8r6:current-message',
    repeat('11', 32),
    '82000000-0000-4000-8000-000000000111'
  ),
  (
    '82000000-0000-4000-8000-000000000102',
    '82000000-0000-4000-8000-000000000001',
    'waha', 'waha:crm_primary', NULL, NULL,
    'p8r6-rejected-message', 'crm_primary',
    'p8r6-rejected-message', 'message.any',
    '2026-08-23 10:01:00+06', 'verified',
    '{"event":"message.any","session":"crm_primary","payload":{"id":"p8r6-rejected-message","from":"996555820002@c.us","fromMe":false,"body":"Rejected historical session"}}',
    '{"hmac_verified":true}', 'synthetic:p8r6:rejected-message',
    repeat('22', 32),
    '82000000-0000-4000-8000-000000000112'
  ),
  (
    '82000000-0000-4000-8000-000000000103',
    '82000000-0000-4000-8000-000000000001',
    'waha', 'waha:evo-inbox', NULL, NULL,
    'p8r6-current-status', 'evo-inbox',
    'p8r6-current-status', 'session.status',
    '2026-08-23 10:02:00+06', 'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"WORKING"}}',
    '{"hmac_verified":true}', 'synthetic:p8r6:current-status',
    repeat('33', 32),
    '82000000-0000-4000-8000-000000000113'
  ),
  (
    '82000000-0000-4000-8000-000000000104',
    '82000000-0000-4000-8000-000000000001',
    'waha', 'waha:crm_primary', NULL, NULL,
    'p8r6-rejected-status', 'crm_primary',
    'p8r6-rejected-status', 'session.status',
    '2026-08-23 10:03:00+06', 'verified',
    '{"event":"session.status","session":"crm_primary","payload":{"name":"crm_primary","status":"WORKING"}}',
    '{"hmac_verified":true}', 'synthetic:p8r6:rejected-status',
    repeat('44', 32),
    '82000000-0000-4000-8000-000000000114'
  );

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;

SELECT platform.sync_lead_agent_whatsapp(
  '82000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000101',
  '82000000-0000-4000-8000-000000000013',
  820001, 820002, 820003,
  '82000000-0000-4000-8000-000000000201'
)::TEXT AS p8r6_message_first
\gset

SELECT platform.sync_lead_agent_whatsapp(
  '82000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000101',
  '82000000-0000-4000-8000-000000000013',
  820001, 820002, 820003,
  '82000000-0000-4000-8000-000000000201'
)::TEXT AS p8r6_message_request_replay
\gset

SELECT platform.sync_lead_agent_whatsapp(
  '82000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000101',
  '82000000-0000-4000-8000-000000000013',
  820001, 820002, 820003,
  '82000000-0000-4000-8000-000000000202'
)::TEXT AS p8r6_message_source_replay
\gset

DO $$
BEGIN
  BEGIN
    PERFORM platform.sync_lead_agent_whatsapp(
      '82000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000102',
      '82000000-0000-4000-8000-000000000013',
      820001, 820002, 820003,
      '82000000-0000-4000-8000-000000000203'
    );
    RAISE EXCEPTION 'Lead-Agent message sync accepted crm_primary evidence';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
END
$$;

SELECT platform.sync_lead_agent_session_status(
  '82000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000103',
  '82000000-0000-4000-8000-000000000301'
)::TEXT AS p8r6_status_first
\gset

SELECT platform.sync_lead_agent_session_status(
  '82000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000103',
  '82000000-0000-4000-8000-000000000302'
)::TEXT AS p8r6_status_replay
\gset

DO $$
BEGIN
  BEGIN
    PERFORM platform.sync_lead_agent_session_status(
      '82000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000104',
      '82000000-0000-4000-8000-000000000303'
    );
    RAISE EXCEPTION
      'Lead-Agent session-status sync accepted crm_primary evidence';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
END
$$;

RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.assert_true(
  :'p8r6_message_first'::JSONB =
    :'p8r6_message_request_replay'::JSONB,
  'identical message request did not replay its exact response'
);
SELECT pg_temp.assert_true(
  :'p8r6_message_first'::JSONB ->> 'deduplicated' = 'false'
    AND :'p8r6_message_source_replay'::JSONB ->> 'deduplicated' = 'true',
  'message request/source replay dispositions drifted'
);
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
    FROM platform.communication_messages AS message
    WHERE message.organization_id =
      '82000000-0000-4000-8000-000000000001'
      AND message.source_webhook_event_id =
        '82000000-0000-4000-8000-000000000101'
  ),
  'message replay created more than one Platform message'
);
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        binding.waha_session_name = 'evo-inbox'
        AND source_event.provider_account_ref = 'waha:evo-inbox'
      )
    FROM platform_private.waha_message_bindings AS binding
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = binding.organization_id
     AND source_event.id = binding.source_webhook_event_id
    WHERE binding.organization_id =
      '82000000-0000-4000-8000-000000000001'
      AND binding.source_webhook_event_id =
        '82000000-0000-4000-8000-000000000101'
  ),
  'message projection did not persist exact evo-inbox provider identity'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform_private.lead_agent_sync_requests AS request
    WHERE request.source_webhook_event_id =
      '82000000-0000-4000-8000-000000000102'
  ),
  'rejected crm_primary message evidence created a sync receipt'
);

SELECT pg_temp.assert_true(
  :'p8r6_status_first'::JSONB ->> 'waha_session_name' = 'evo-inbox'
    AND :'p8r6_status_first'::JSONB ->> 'status' = 'WORKING'
    AND :'p8r6_status_first'::JSONB ->> 'deduplicated' = 'false'
    AND :'p8r6_status_replay'::JSONB ->> 'waha_session_name' = 'evo-inbox'
    AND :'p8r6_status_replay'::JSONB ->> 'deduplicated' = 'true',
  'session-status projection/replay did not retain exact evo-inbox identity'
);
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        observation.waha_session_name = 'evo-inbox'
        AND observation.status = 'WORKING'
      )
    FROM platform_private.waha_session_observations AS observation
    WHERE observation.organization_id =
      '82000000-0000-4000-8000-000000000001'
      AND observation.source_webhook_event_id =
        '82000000-0000-4000-8000-000000000103'
  ),
  'session-status replay created duplicate or noncanonical observations'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform_private.waha_session_observations AS observation
    WHERE observation.organization_id =
      '82000000-0000-4000-8000-000000000001'
      AND observation.source_webhook_event_id =
        '82000000-0000-4000-8000-000000000104'
  ),
  'rejected crm_primary status evidence created an observation'
);

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"82000000-0000-4000-8000-000000000010","platform_role":"sales","platform_access_version":1}',
  true
);
SET LOCAL ROLE authenticated;

SELECT
  health.waha_session_name AS p8r6_staff_session,
  health.status AS p8r6_staff_status,
  health.observed_at::TEXT AS p8r6_staff_observed_at
FROM platform.staff_waha_session_health(
  '82000000-0000-4000-8000-000000000001',
  'evo-inbox'
) AS health
\gset

DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM platform.staff_waha_session_health(
      '82000000-0000-4000-8000-000000000001',
      'crm_primary'
    );
    RAISE EXCEPTION 'Staff current health accepted crm_primary';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$$;

RESET ROLE;

SELECT pg_temp.assert_true(
  :'p8r6_staff_session' = 'evo-inbox'
    AND :'p8r6_staff_status' = 'WORKING'
    AND :'p8r6_staff_observed_at'::TIMESTAMPTZ =
      '2026-08-23 10:02:00+06'::TIMESTAMPTZ,
  'staff current health did not return the exact evo-inbox tuple'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        health.waha_session_name = 'crm_primary'
        AND health.status = 'LEGACY_WORKING'
        AND health.observed_at =
          '2026-08-22 09:00:00+06'::TIMESTAMPTZ
      )
    FROM platform.waha_session_health AS health
    WHERE health.organization_id =
      '82000000-0000-4000-8000-000000000900'
  ),
  'current projection mutated the preserved historical health row'
);

ROLLBACK;

SELECT 'platform migration 082 WAHA session authority contract passed' AS result;
