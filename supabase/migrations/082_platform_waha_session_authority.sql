-- ============================================================
-- 082_platform_waha_session_authority.sql
--
-- Make evo-inbox the only forward WAHA identity accepted by the signed
-- Lead-Agent projections and staff current-health selector. Historical
-- crm_primary rows remain byte-for-byte provider provenance; no alias,
-- fallback, rewrite or second current-session path is introduced.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform_private.require_private_waha_message_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.message_identity_source = 'private_waha_binding'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.waha_message_bindings AS binding
      JOIN platform_private.provider_webhook_events AS source_event
        ON source_event.organization_id = binding.organization_id
       AND source_event.id = binding.source_webhook_event_id
      WHERE binding.organization_id = NEW.organization_id
        AND binding.communication_message_id = NEW.id
        AND binding.source_webhook_event_id = NEW.source_webhook_event_id
        AND binding.waha_session_name = 'evo-inbox'
        AND source_event.provider = 'waha'
        AND source_event.provider_account_ref = 'waha:evo-inbox'
        AND source_event.waha_session_name = 'evo-inbox'
        AND source_event.payload_id = binding.raw_message_id
    )
  THEN
    RAISE EXCEPTION
      'A private WAHA message requires its exact canonical provider binding'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform.sync_lead_agent_whatsapp(
  p_organization_id UUID,
  p_provider_webhook_event_id UUID,
  p_intake_sales_membership_id UUID,
  p_amocrm_account_id BIGINT,
  p_amocrm_lead_id BIGINT,
  p_amocrm_contact_id BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prior_request platform_private.lead_agent_sync_requests%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  direct_binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  message_binding platform_private.waha_message_bindings%ROWTYPE;
  conversation_row platform.communication_conversations%ROWTYPE;
  customer_participant platform.conversation_participants%ROWTYPE;
  v_normalized_chat_id TEXT;
  v_inbound_body_text TEXT;
  v_raw_message_id TEXT;
  input_sha256 TEXT;
  result JSONB;
  created_conversation_id UUID := gen_random_uuid();
  created_scope_id UUID := gen_random_uuid();
  created_customer_participant_id UUID := gen_random_uuid();
  created_sales_participant_id UUID := gen_random_uuid();
  created_message_id UUID := gen_random_uuid();
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL
    OR p_provider_webhook_event_id IS NULL
    OR p_intake_sales_membership_id IS NULL
    OR p_amocrm_account_id IS NULL OR p_amocrm_account_id <= 0
    OR p_amocrm_lead_id IS NULL OR p_amocrm_lead_id <= 0
    OR p_amocrm_contact_id IS NULL OR p_amocrm_contact_id <= 0
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'Exact Lead-Agent sync identity is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p8r6:lead-agent-sync-request:' || p_request_id::TEXT,
      0
    )
  );
  input_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'source_webhook_event_id', p_provider_webhook_event_id,
      'intake_sales_membership_id', p_intake_sales_membership_id,
      'amocrm_account_id', p_amocrm_account_id,
      'amocrm_lead_id', p_amocrm_lead_id,
      'amocrm_contact_id', p_amocrm_contact_id
    )::TEXT, 'UTF8')),
    'hex'
  );

  SELECT event.*
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_provider_webhook_event_id;
  IF source_event.id IS NULL
    OR source_event.provider <> 'waha'
    OR source_event.provider_account_ref <> 'waha:evo-inbox'
    OR source_event.waha_session_name <> 'evo-inbox'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type <> 'message.any'
    OR source_event.raw_payload ->> 'event' <> 'message.any'
    OR source_event.raw_payload ->> 'session' <> 'evo-inbox'
    OR source_event.raw_payload #>> '{payload,fromMe}' <> 'false'
  THEN
    RAISE EXCEPTION 'Exact signed evo-inbox source evidence is required'
      USING ERRCODE = '42501';
  END IF;

  v_raw_message_id := pg_catalog.btrim(
    source_event.raw_payload #>> '{payload,id}'
  );
  v_normalized_chat_id := platform_private.normalize_waha_direct_chat_id(
    source_event.raw_payload #>> '{payload,from}'
  );
  v_inbound_body_text := pg_catalog.btrim(
    source_event.raw_payload #>> '{payload,body}'
  );
  IF v_raw_message_id IS NULL OR v_raw_message_id = ''
    OR v_raw_message_id <> source_event.payload_id
    OR pg_catalog.char_length(v_raw_message_id) > 256
    OR v_normalized_chat_id IS NULL
    OR v_inbound_body_text IS NULL OR v_inbound_body_text = ''
    OR pg_catalog.char_length(v_inbound_body_text) > 4000
  THEN
    RAISE EXCEPTION 'Signed Lead-Agent message payload is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT request.*
  INTO prior_request
  FROM platform_private.lead_agent_sync_requests AS request
  WHERE request.request_id = p_request_id;
  IF prior_request.request_id IS NOT NULL THEN
    IF prior_request.input_sha256 <> input_sha256 THEN
      RAISE EXCEPTION 'request_id was already used for another mutation'
        USING ERRCODE = '22023';
    END IF;
    RETURN prior_request.response;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile ON profile.id = membership.profile_id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
     AND bundle.role = membership."current_role"
     AND bundle.status = 'published'
    WHERE membership.organization_id = p_organization_id
      AND membership.id = p_intake_sales_membership_id
      AND membership.status = 'active'
      AND membership."current_role" = 'sales'
      AND profile.status = 'active'
      AND organization.status = 'active'
      AND platform_private.membership_has_active_scope(
        p_organization_id, membership.id, 'organization', p_organization_id
      )
      AND (
        SELECT pg_catalog.count(DISTINCT permission.permission_key) = 2
        FROM platform.role_bundle_permissions AS permission
        WHERE permission.bundle_id = bundle.id
          AND permission.bundle_role = bundle.role
          AND permission.permission_key IN (
            'organization.read', 'communication.read.full'
          )
      )
  ) THEN
    RAISE EXCEPTION 'Authorized intake Sales membership is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p8r6:evo-inbox-chat:' || p_organization_id::TEXT || ':'
        || v_normalized_chat_id,
      0
    )
  );
  SELECT binding.*
  INTO message_binding
  FROM platform_private.waha_message_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.waha_session_name = 'evo-inbox'
    AND binding.raw_message_id = v_raw_message_id;

  IF message_binding.id IS NOT NULL THEN
    SELECT conversation.*
    INTO conversation_row
    FROM platform.communication_conversations AS conversation
    JOIN platform.communication_messages AS message
      ON message.organization_id = conversation.organization_id
     AND message.conversation_id = conversation.id
    WHERE conversation.organization_id = p_organization_id
      AND message.id = message_binding.communication_message_id;
    IF conversation_row.id IS NULL
      OR conversation_row.waha_session_name <> 'evo-inbox'
      OR conversation_row.amocrm_account_id <> p_amocrm_account_id
      OR conversation_row.amocrm_lead_id <> p_amocrm_lead_id
      OR conversation_row.amocrm_contact_id <> p_amocrm_contact_id
    THEN
      RAISE EXCEPTION 'Duplicate message conflicts with canonical amoCRM identity'
        USING ERRCODE = '23505';
    END IF;
    created_conversation_id := conversation_row.id;
    created_message_id := message_binding.communication_message_id;
    result := pg_catalog.jsonb_build_object(
      'conversation_id', created_conversation_id,
      'communication_message_id', created_message_id,
      'deduplicated', TRUE,
      'provider_identity_private', TRUE
    );
  ELSE
    SELECT binding.*
    INTO direct_binding
    FROM platform_private.waha_direct_chat_bindings AS binding
    WHERE binding.organization_id = p_organization_id
      AND binding.waha_session_name = 'evo-inbox'
      AND binding.normalized_chat_id = v_normalized_chat_id;
    IF direct_binding.id IS NULL THEN
      INSERT INTO platform.record_scopes (
        id, organization_id, scope_kind, scope_key, scope_version, is_active
      ) VALUES (
        created_scope_id, p_organization_id, 'conversation',
        created_conversation_id, 1, TRUE
      );
      INSERT INTO platform.membership_scope_assignments (
        organization_id, membership_id, scope_id, scope_version,
        assignment_version, granted, actor_kind, actor_profile_id,
        reason, request_id
      ) VALUES (
        p_organization_id, p_intake_sales_membership_id, created_scope_id, 1,
        1, TRUE, 'service', NULL,
        'Grant Sales access to one amoCRM-resolved evo-inbox conversation',
        p_request_id
      );
      INSERT INTO platform.communication_conversations (
        id, organization_id, student_case_id,
        responsible_sales_membership_id, sales_authority_source,
        current_curator_membership_id, queue, status, subject,
        waha_session_name, kommo_account_id, kommo_conversation_id,
        amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
        current_scope_id, current_scope_version, created_from_webhook_event_id
      ) VALUES (
        created_conversation_id, p_organization_id, NULL,
        p_intake_sales_membership_id, 'provider_linked', NULL,
        'sales', 'open',
        'WhatsApp ••••'
          || pg_catalog.right(
            pg_catalog.split_part(v_normalized_chat_id, '@', 1),
            4
          ),
        'evo-inbox', NULL, NULL,
        p_amocrm_account_id, p_amocrm_lead_id, p_amocrm_contact_id,
        created_scope_id, 1, source_event.id
      );
      INSERT INTO platform.conversation_participants (
        id, organization_id, conversation_id, participant_kind,
        membership_id, external_subject_ref, source_webhook_event_id
      ) VALUES
        (
          created_customer_participant_id, p_organization_id,
          created_conversation_id, 'customer', NULL,
          'waha-participant:' || created_customer_participant_id::TEXT,
          source_event.id
        ),
        (
          created_sales_participant_id, p_organization_id,
          created_conversation_id, 'sales', p_intake_sales_membership_id,
          NULL, source_event.id
        );
      INSERT INTO platform_private.waha_direct_chat_bindings (
        organization_id, waha_session_name, normalized_chat_id,
        conversation_id, source_webhook_event_id
      ) VALUES (
        p_organization_id, 'evo-inbox', v_normalized_chat_id,
        created_conversation_id, source_event.id
      );
      conversation_row.id := created_conversation_id;
    ELSE
      SELECT conversation.*
      INTO conversation_row
      FROM platform.communication_conversations AS conversation
      WHERE conversation.organization_id = p_organization_id
        AND conversation.id = direct_binding.conversation_id;
      IF conversation_row.id IS NULL
        OR conversation_row.status <> 'open'
        OR conversation_row.waha_session_name <> 'evo-inbox'
        OR conversation_row.sales_authority_source <> 'provider_linked'
        OR conversation_row.amocrm_account_id <> p_amocrm_account_id
        OR conversation_row.amocrm_lead_id <> p_amocrm_lead_id
        OR conversation_row.amocrm_contact_id <> p_amocrm_contact_id
      THEN
        RAISE EXCEPTION 'evo-inbox chat binding conflicts with canonical identity'
          USING ERRCODE = '23505';
      END IF;
      SELECT participant.*
      INTO customer_participant
      FROM platform.conversation_participants AS participant
      WHERE participant.organization_id = p_organization_id
        AND participant.conversation_id = conversation_row.id
        AND participant.participant_kind = 'customer'
      ORDER BY participant.created_at, participant.id
      LIMIT 1;
      IF customer_participant.id IS NULL THEN
        RAISE EXCEPTION
          'Bound evo-inbox conversation has no customer participant'
          USING ERRCODE = '55000';
      END IF;
      created_conversation_id := conversation_row.id;
      created_customer_participant_id := customer_participant.id;
    END IF;

    INSERT INTO platform.communication_messages (
      id, organization_id, conversation_id, student_case_id,
      sender_participant_id, direction, body_text, language,
      student_visible, message_identity_source,
      waha_session_name, waha_message_id,
      kommo_account_id, kommo_conversation_id, kommo_message_id,
      amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
      source_webhook_event_id, manual_send_authorization_id,
      autonomous_reply_intent_id, created_at
    ) VALUES (
      created_message_id, p_organization_id, created_conversation_id, NULL,
      created_customer_participant_id, 'inbound', v_inbound_body_text,
      'undetermined', FALSE, 'private_waha_binding',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      source_event.id, NULL, NULL, source_event.provider_occurred_at
    );
    INSERT INTO platform_private.waha_message_bindings (
      organization_id, waha_session_name, raw_message_id,
      communication_message_id, source_webhook_event_id
    ) VALUES (
      p_organization_id, 'evo-inbox', v_raw_message_id,
      created_message_id, source_event.id
    );
    result := pg_catalog.jsonb_build_object(
      'conversation_id', created_conversation_id,
      'communication_message_id', created_message_id,
      'deduplicated', FALSE,
      'provider_identity_private', TRUE
    );
  END IF;

  INSERT INTO platform_private.lead_agent_sync_requests (
    request_id, input_sha256, organization_id, source_webhook_event_id,
    conversation_id, communication_message_id, response
  ) VALUES (
    p_request_id, input_sha256, p_organization_id, source_event.id,
    created_conversation_id, created_message_id, result
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'service', NULL, 'service:evo-lead-agent',
    'communication.leadagent.sync', 'communication_message',
    created_message_id, NULL,
    pg_catalog.jsonb_build_object(
      'conversation_id', created_conversation_id,
      'source_webhook_event_id', source_event.id,
      'deduplicated', result -> 'deduplicated'
    ),
    'Bind amoCRM-resolved signed Lead-Agent ingress to Platform',
    p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.sync_lead_agent_session_status(
  p_organization_id UUID,
  p_provider_webhook_event_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_event platform_private.provider_webhook_events%ROWTYPE;
  prior_observation platform_private.waha_session_observations%ROWTYPE;
  current_health platform.waha_session_health%ROWTYPE;
  session_status TEXT;
  created_observation_id UUID := gen_random_uuid();
  changed_rows INTEGER := 0;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL
    OR p_provider_webhook_event_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'Exact Lead-Agent session evidence is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p8r6:lead-agent-session-source:'
        || p_organization_id::TEXT || ':'
        || p_provider_webhook_event_id::TEXT,
      0
    )
  );

  SELECT event.*
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_provider_webhook_event_id;

  IF source_event.id IS NULL
    OR source_event.provider <> 'waha'
    OR source_event.provider_account_ref <> 'waha:evo-inbox'
    OR source_event.waha_session_name <> 'evo-inbox'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type <> 'session.status'
    OR source_event.raw_payload ->> 'event' <> 'session.status'
    OR source_event.raw_payload ->> 'session' <> 'evo-inbox'
    OR source_event.raw_payload #>> '{payload,name}' <> 'evo-inbox'
  THEN
    RAISE EXCEPTION 'Exact signed evo-inbox session evidence is required'
      USING ERRCODE = '42501';
  END IF;

  session_status := source_event.raw_payload #>> '{payload,status}';
  IF session_status IS NULL
    OR session_status IS DISTINCT FROM pg_catalog.btrim(session_status)
    OR pg_catalog.char_length(session_status) NOT BETWEEN 1 AND 64
    OR session_status !~ '^[A-Z][A-Z0-9_]{0,63}$'
  THEN
    RAISE EXCEPTION 'Signed Lead-Agent session status is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT observation.*
  INTO prior_observation
  FROM platform_private.waha_session_observations AS observation
  WHERE observation.organization_id = p_organization_id
    AND observation.source_webhook_event_id = source_event.id;

  IF prior_observation.id IS NOT NULL THEN
    IF prior_observation.waha_session_name <> 'evo-inbox'
      OR prior_observation.status <> session_status
      OR prior_observation.observed_at <> source_event.provider_occurred_at
    THEN
      RAISE EXCEPTION 'Session evidence conflicts with its prior projection'
        USING ERRCODE = '23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'waha_session_name', prior_observation.waha_session_name,
      'status', prior_observation.status,
      'observed_at', prior_observation.observed_at,
      'current_state_updated', FALSE,
      'deduplicated', TRUE
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'platform:waha-session-health:'
        || p_organization_id::TEXT || ':evo-inbox',
      0
    )
  );

  SELECT health.*
  INTO current_health
  FROM platform.waha_session_health AS health
  WHERE health.organization_id = p_organization_id
    AND health.waha_session_name = 'evo-inbox'
  FOR UPDATE;

  IF current_health.organization_id IS NOT NULL
    AND current_health.observed_at = source_event.provider_occurred_at
    AND current_health.status IS DISTINCT FROM session_status
  THEN
    RAISE EXCEPTION 'Equal-time session observations conflict'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO platform_private.waha_session_observations (
    id,
    organization_id,
    source_webhook_event_id,
    waha_session_name,
    status,
    observed_at,
    request_id
  )
  VALUES (
    created_observation_id,
    p_organization_id,
    source_event.id,
    'evo-inbox',
    session_status,
    source_event.provider_occurred_at,
    p_request_id
  );

  INSERT INTO platform.waha_session_health (
    organization_id,
    waha_session_name,
    status,
    observed_at
  )
  VALUES (
    p_organization_id,
    'evo-inbox',
    session_status,
    source_event.provider_occurred_at
  )
  ON CONFLICT (organization_id, waha_session_name)
  DO UPDATE SET
    status = EXCLUDED.status,
    observed_at = EXCLUDED.observed_at
  WHERE EXCLUDED.observed_at > platform.waha_session_health.observed_at;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;

  result := pg_catalog.jsonb_build_object(
    'waha_session_name', 'evo-inbox',
    'status', session_status,
    'observed_at', source_event.provider_occurred_at,
    'current_state_updated', changed_rows = 1,
    'deduplicated', FALSE
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:evo-lead-agent',
    'communication.leadagent.sessionstatus',
    'waha_session_observation',
    created_observation_id,
    CASE
      WHEN current_health.organization_id IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object(
        'waha_session_name', current_health.waha_session_name,
        'status', current_health.status,
        'observed_at', current_health.observed_at
      )
    END,
    result || pg_catalog.jsonb_build_object(
      'source_webhook_event_id', source_event.id
    ),
    'Project signed Lead-Agent session health into the unified Platform',
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_waha_session_health(
  p_organization_id UUID,
  p_waha_session_name TEXT
)
RETURNS TABLE (
  waha_session_name TEXT,
  status TEXT,
  observed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_waha_session_name IS NULL
    OR p_waha_session_name <> 'evo-inbox'
  THEN
    RAISE EXCEPTION 'Exact current Platform WAHA session is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM platform.current_actor_authority() AS authority
    WHERE authority.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION
      'Active organization-scoped Platform authority is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    health.waha_session_name,
    health.status,
    health.observed_at
  FROM platform.waha_session_health AS health
  WHERE health.organization_id = p_organization_id
    AND health.waha_session_name = 'evo-inbox';
END
$$;

REVOKE ALL ON FUNCTION platform.sync_lead_agent_whatsapp(
  UUID, UUID, UUID, BIGINT, BIGINT, BIGINT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.sync_lead_agent_whatsapp(
  UUID, UUID, UUID, BIGINT, BIGINT, BIGINT, UUID
) TO service_role;

REVOKE ALL ON FUNCTION platform.sync_lead_agent_session_status(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.sync_lead_agent_session_status(
  UUID, UUID, UUID
) TO service_role;

REVOKE ALL ON FUNCTION platform.staff_waha_session_health(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION platform.staff_waha_session_health(UUID, TEXT)
  TO authenticated;

COMMENT ON FUNCTION platform_private.require_private_waha_message_binding() IS
  'Requires exact evo-inbox provider evidence for every new private WAHA message while historical rows remain unchanged.';
COMMENT ON FUNCTION platform.sync_lead_agent_whatsapp(
  UUID, UUID, UUID, BIGINT, BIGINT, BIGINT, UUID
) IS
  'Projects one verified evo-inbox Lead-Agent message into the canonical Platform model.';
COMMENT ON FUNCTION platform.sync_lead_agent_session_status(
  UUID, UUID, UUID
) IS
  'Projects one verified evo-inbox session observation into the canonical Platform WAHA health model.';
COMMENT ON FUNCTION platform.staff_waha_session_health(UUID, TEXT) IS
  'Returns only the exact evo-inbox current-health row visible to an authorized staff actor.';

COMMIT;
