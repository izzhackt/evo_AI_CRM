-- ============================================================
-- 085_platform_waha_receive_only_sales.sql
--
-- U3: atomically bind the existing verified receive-only WAHA projection to
-- canonical EVO clients/leads, and expose a bounded safe Sales intake page.
-- No provider call, outbound send, amoCRM write, or production action occurs.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform_private.bind_waha_chat_to_canonical(
  p_organization_id UUID,
  p_binding_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  conversation platform.communication_conversations%ROWTYPE;
  payload JSONB;
  payload_chat_id TEXT;
  phone_digits TEXT;
  external_identity TEXT;
  source_ref TEXT;
  resolved_client_id UUID;
  resolved_lead_id UUID;
BEGIN
  IF p_organization_id IS NULL OR p_binding_id IS NULL THEN
    RAISE EXCEPTION 'WAHA canonical binding identity is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT candidate.*
  INTO binding
  FROM platform_private.waha_direct_chat_bindings AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_binding_id;

  IF binding.id IS NULL THEN
    RAISE EXCEPTION 'WAHA direct-chat binding is unavailable'
      USING ERRCODE = '23503';
  END IF;

  SELECT event.*
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = binding.organization_id
    AND event.id = binding.source_webhook_event_id;

  SELECT candidate.*
  INTO conversation
  FROM platform.communication_conversations AS candidate
  WHERE candidate.organization_id = binding.organization_id
    AND candidate.id = binding.conversation_id
  FOR UPDATE;

  payload := source_event.raw_payload -> 'payload';
  IF source_event.id IS NULL OR conversation.id IS NULL THEN
    RAISE EXCEPTION 'WAHA canonical source or conversation is unavailable'
      USING ERRCODE = '23503';
  END IF;

  -- Other historical/future binding lanes may reuse this private table. They
  -- remain untouched; only a verified direct inbound ingress observation is
  -- canonical Sales intake.
  IF source_event.provider <> 'waha'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type NOT IN ('message', 'message.any')
    OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
    OR payload -> 'fromMe' IS DISTINCT FROM 'false'::JSONB
    OR lower(COALESCE(btrim(payload ->> 'source'), '')) = 'api'
  THEN
    RETURN;
  END IF;

  payload_chat_id := platform_private.normalize_waha_direct_chat_id(
    COALESCE(
      NULLIF(btrim(payload ->> 'from'), ''),
      NULLIF(btrim(payload ->> 'chatId'), ''),
      NULLIF(btrim(payload #>> '{_data,from}'), ''),
      NULLIF(btrim(payload #>> '{_data,id,remote}'), '')
    )
  );

  IF source_event.waha_session_name <> binding.waha_session_name
    OR payload_chat_id IS NULL
    OR payload_chat_id <> binding.normalized_chat_id
    OR conversation.waha_session_name <> binding.waha_session_name
  THEN
    RAISE EXCEPTION
      'Only one verified direct inbound WAHA intake may acquire canonical identity'
      USING ERRCODE = '23514';
  END IF;

  -- Other verified WAHA lanes, including the legacy Lead-Agent sync path, may
  -- append the same private binding table. They must remain writable without
  -- acquiring the U3 canonical Sales identity contract.
  IF conversation.sales_authority_source <> 'platform_intake'
    OR conversation.queue <> 'sales'
    OR conversation.responsible_sales_membership_id IS NULL
  THEN
    RETURN;
  END IF;

  phone_digits := regexp_replace(
    split_part(binding.normalized_chat_id, '@', 1),
    '[^0-9]',
    '',
    'g'
  );
  IF phone_digits !~ '^[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'WAHA direct-chat phone identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  external_identity :=
    binding.waha_session_name || ':' || binding.normalized_chat_id;
  source_ref := 'waha-event:' || source_event.id::TEXT;

  resolved_client_id := platform_private.create_or_link_client(
    binding.organization_id,
    'WhatsApp ••••' || right(phone_digits, 4),
    NULL,
    '+' || phone_digits,
    'waha',
    'direct_chat',
    external_identity,
    'webhook_verified',
    source_event.provider_occurred_at,
    NULL,
    source_ref
  );

  resolved_lead_id := platform_private.create_or_link_lead(
    binding.organization_id,
    resolved_client_id,
    conversation.responsible_sales_membership_id,
    'new_inbound',
    'whatsapp',
    'waha',
    'sales_intake',
    external_identity,
    'webhook_verified',
    source_event.provider_occurred_at,
    NULL,
    source_ref
  );

  IF (
    conversation.canonical_client_id IS NOT NULL
    AND conversation.canonical_client_id <> resolved_client_id
  ) OR (
    conversation.canonical_lead_id IS NOT NULL
    AND conversation.canonical_lead_id <> resolved_lead_id
  ) THEN
    RAISE EXCEPTION
      'Existing canonical conversation identity conflicts with exact WAHA identity'
      USING ERRCODE = '23514';
  END IF;

  UPDATE platform.communication_conversations AS target
  SET canonical_client_id = resolved_client_id,
      canonical_lead_id = resolved_lead_id
  WHERE target.organization_id = binding.organization_id
    AND target.id = binding.conversation_id
    AND (
      target.canonical_client_id IS DISTINCT FROM resolved_client_id
      OR target.canonical_lead_id IS DISTINCT FROM resolved_lead_id
    );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.link_canonical_waha_chat_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform_private.bind_waha_chat_to_canonical(
    NEW.organization_id,
    NEW.id
  );
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.bind_waha_chat_to_canonical(UUID, UUID),
  platform_private.link_canonical_waha_chat_binding()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER waha_direct_chat_bindings_canonical_link
  AFTER INSERT
  ON platform_private.waha_direct_chat_bindings
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.link_canonical_waha_chat_binding();

-- Existing verified direct-chat bindings are now part of the unified Sales
-- queue too. The exact provider identity makes this backfill idempotent.
DO $$
DECLARE
  existing_binding RECORD;
BEGIN
  FOR existing_binding IN
    SELECT binding.organization_id, binding.id
    FROM platform_private.waha_direct_chat_bindings AS binding
    -- Migration 060 historically accepted any numeric direct-chat identifier.
    -- U3 only canonicalizes an E.164-sized sender; older out-of-range rows stay
    -- preserved as private evidence instead of aborting the forward migration.
    WHERE binding.normalized_chat_id ~ '^[0-9]{7,15}@c[.]us$'
    ORDER BY binding.organization_id, binding.created_at, binding.id
  LOOP
    PERFORM platform_private.bind_waha_chat_to_canonical(
      existing_binding.organization_id,
      existing_binding.id
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_waha_sales_intake_page(
  p_organization_id UUID,
  p_limit INTEGER,
  p_before_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_before_work_item_id UUID DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  work_item_id UUID,
  intake_state TEXT,
  attempt_count INTEGER,
  available_at TIMESTAMPTZ,
  provider_occurred_at TIMESTAMPTZ,
  conversation_id UUID,
  canonical_lead_id UUID,
  canonical_client_id UUID,
  client_display_name TEXT,
  subject TEXT,
  message_preview TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_state TEXT;
  normalized_query TEXT;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;
  IF (p_before_sort_at IS NULL) <> (p_before_work_item_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete Sales intake cursor' USING ERRCODE = '22023';
  END IF;

  normalized_state := NULLIF(lower(btrim(p_state)), '');
  normalized_query := NULLIF(lower(btrim(p_query)), '');
  IF normalized_state IS NOT NULL AND normalized_state NOT IN (
    'queued',
    'retrying',
    'received',
    'manual_review',
    'unsupported',
    'terminal_failure'
  ) THEN
    RAISE EXCEPTION 'Invalid Sales intake state' USING ERRCODE = '22023';
  END IF;
  IF p_query IS NOT NULL AND (
    normalized_query IS NULL OR char_length(normalized_query) > 200
  ) THEN
    RAISE EXCEPTION 'Invalid Sales intake query' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  RETURN QUERY
  WITH actor AS MATERIALIZED (
    SELECT authority.*
    FROM platform.current_actor_authority() AS authority
    WHERE authority.organization_id = p_organization_id
  ),
  classified AS MATERIALIZED (
    SELECT
      GREATEST(
        work.updated_at,
        COALESCE(effect.projected_at, work.updated_at),
        COALESCE(message.created_at, work.updated_at)
      ) AS row_sort_at,
      work.id AS row_work_item_id,
      CASE
        WHEN work.state = 'queued' THEN 'queued'
        WHEN work.state IN ('leased', 'retry_wait') THEN 'retrying'
        WHEN work.state = 'succeeded'
          AND effect.disposition = 'succeeded'
          AND COALESCE(
            (effect.result ->> 'human_review_required')::BOOLEAN,
            FALSE
          )
        THEN 'manual_review'
        WHEN work.state = 'succeeded'
          AND effect.disposition = 'succeeded'
        THEN 'received'
        WHEN effect.disposition = 'terminal_error'
          AND COALESCE(
            effect.result ->> 'error_code',
            latest_request.response ->> 'error_code'
          ) IN (
            'waha_event_type_unsupported',
            'waha_inbound_chat_required',
            'waha_inbound_unsupported_chat'
          )
        THEN 'unsupported'
        ELSE 'terminal_failure'
      END AS row_intake_state,
      work.attempt_count AS row_attempt_count,
      work.available_at AS row_available_at,
      source_event.provider_occurred_at AS row_provider_occurred_at,
      conversation.id AS row_conversation_id,
      conversation.canonical_lead_id AS row_canonical_lead_id,
      conversation.canonical_client_id AS row_canonical_client_id,
      client.display_name AS row_client_display_name,
      conversation.subject AS row_subject,
      left(message.body_text, 500) AS row_message_preview,
      COALESCE(
        effect.result ->> 'error_code',
        latest_request.response ->> 'error_code'
      ) AS row_error_code,
      work.created_at AS row_created_at,
      work.updated_at AS row_updated_at,
      latest_request.intake_sales_membership_id,
      actor.platform_role,
      actor.membership_id
    FROM platform_private.durable_work_items AS work
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = work.organization_id
     AND source_event.id = work.source_webhook_event_id
    CROSS JOIN actor
    LEFT JOIN platform_private.waha_work_projection_effects AS effect
      ON effect.organization_id = work.organization_id
     AND effect.work_item_id = work.id
    LEFT JOIN LATERAL (
      SELECT request.intake_sales_membership_id, request.response
      FROM platform_private.waha_work_projection_requests AS request
      WHERE request.organization_id = work.organization_id
        AND request.work_item_id = work.id
      ORDER BY request.created_at DESC, request.request_id DESC
      LIMIT 1
    ) AS latest_request ON TRUE
    LEFT JOIN platform_private.waha_message_bindings AS message_binding
      ON message_binding.organization_id = source_event.organization_id
     AND message_binding.source_webhook_event_id = source_event.id
    LEFT JOIN platform.communication_messages AS message
      ON message.organization_id = message_binding.organization_id
     AND message.id = message_binding.communication_message_id
    LEFT JOIN platform.communication_conversations AS conversation
      ON conversation.organization_id = message.organization_id
     AND conversation.id = message.conversation_id
    LEFT JOIN platform.clients AS client
      ON client.organization_id = conversation.organization_id
     AND client.id = conversation.canonical_client_id
    WHERE work.organization_id = p_organization_id
      AND work.kind = 'provider_webhook_process'
      AND source_event.provider = 'waha'
      AND source_event.event_type IN ('message', 'message.any')
      AND source_event.verification_status = 'verified'
      AND source_event.raw_payload -> 'payload' -> 'fromMe' = 'false'::JSONB
      AND lower(
        COALESCE(
          btrim(source_event.raw_payload -> 'payload' ->> 'source'),
          ''
        )
      ) <> 'api'
      -- A projected conversation is a U3 Sales row only after the exact
      -- private direct-chat binding acquired canonical U2 identity. This
      -- excludes the retained provider-linked Lead-Agent/amoCRM lane while
      -- still keeping pre-projection retry and terminal rows observable.
      AND (
        conversation.id IS NULL
        OR (
          conversation.sales_authority_source = 'platform_intake'
          AND conversation.queue = 'sales'
          AND conversation.canonical_client_id IS NOT NULL
          AND conversation.canonical_lead_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM platform_private.waha_direct_chat_bindings AS direct_binding
            WHERE direct_binding.organization_id = conversation.organization_id
              AND direct_binding.conversation_id = conversation.id
              AND direct_binding.waha_session_name = conversation.waha_session_name
          )
        )
      )
      AND (
        actor.platform_role = 'admin'
        OR (
          conversation.id IS NOT NULL
          AND private.platform_can_read_communication_full(
            conversation.organization_id,
            conversation.id
          )
        )
        OR (
          conversation.id IS NULL
          AND actor.platform_role = 'sales'
          AND latest_request.intake_sales_membership_id = actor.membership_id
        )
      )
  ),
  filtered AS MATERIALIZED (
    SELECT classified.*
    FROM classified
    WHERE (
      normalized_state IS NULL
      OR classified.row_intake_state = normalized_state
    )
      AND (
        normalized_query IS NULL
        OR lower(COALESCE(classified.row_client_display_name, ''))
          LIKE '%' || normalized_query || '%'
        OR lower(COALESCE(classified.row_subject, ''))
          LIKE '%' || normalized_query || '%'
        OR lower(COALESCE(classified.row_message_preview, ''))
          LIKE '%' || normalized_query || '%'
        OR lower(COALESCE(classified.row_error_code, ''))
          LIKE '%' || normalized_query || '%'
        OR COALESCE(classified.row_canonical_lead_id::TEXT, '')
          LIKE '%' || normalized_query || '%'
        OR COALESCE(classified.row_conversation_id::TEXT, '')
          LIKE '%' || normalized_query || '%'
      )
      AND (
        p_before_sort_at IS NULL
        OR (
          classified.row_sort_at,
          classified.row_work_item_id
        ) < (p_before_sort_at, p_before_work_item_id)
      )
  )
  SELECT
    filtered.row_sort_at,
    filtered.row_work_item_id,
    filtered.row_intake_state,
    filtered.row_attempt_count,
    filtered.row_available_at,
    filtered.row_provider_occurred_at,
    filtered.row_conversation_id,
    filtered.row_canonical_lead_id,
    filtered.row_canonical_client_id,
    filtered.row_client_display_name,
    filtered.row_subject,
    filtered.row_message_preview,
    filtered.row_error_code,
    filtered.row_created_at,
    filtered.row_updated_at
  FROM filtered
  ORDER BY filtered.row_sort_at DESC, filtered.row_work_item_id DESC
  LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_canonical_lead_conversation_link(
  p_organization_id UUID,
  p_lead_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (linked BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'lead.read'
  );

  RETURN QUERY
  SELECT EXISTS (
    SELECT 1
    FROM platform.leads AS lead
    JOIN platform.communication_conversations AS conversation
      ON conversation.organization_id = lead.organization_id
     AND conversation.canonical_lead_id = lead.id
    WHERE lead.organization_id = p_organization_id
      AND lead.id = p_lead_id
      AND conversation.id = p_conversation_id
      AND conversation.sales_authority_source = 'platform_intake'
      AND conversation.queue = 'sales'
      AND conversation.canonical_client_id = lead.client_id
      AND EXISTS (
        SELECT 1
        FROM platform_private.waha_direct_chat_bindings AS binding
        JOIN platform_private.provider_webhook_events AS source_event
          ON source_event.organization_id = binding.organization_id
         AND source_event.id = binding.source_webhook_event_id
        WHERE binding.organization_id = conversation.organization_id
          AND binding.conversation_id = conversation.id
          AND binding.waha_session_name = conversation.waha_session_name
          AND source_event.provider = 'waha'
          AND source_event.verification_status = 'verified'
          AND source_event.event_type IN ('message', 'message.any')
          AND source_event.raw_payload -> 'payload' -> 'fromMe' = 'false'::JSONB
          AND lower(
            COALESCE(
              btrim(source_event.raw_payload -> 'payload' ->> 'source'),
              ''
            )
          ) <> 'api'
      )
      AND private.platform_can_read_canonical_lead(
        lead.organization_id,
        lead.id
      )
      AND private.platform_can_read_communication_full(
        conversation.organization_id,
        conversation.id
      )
  );
END
$$;

-- Migration 084's client detail joined the unparameterized
-- visible_canonical_clients() set before applying the requested client id.
-- PostgREST therefore evaluated every visible client's permission-aware
-- counters and could hit statement_timeout even though the caller requested
-- one primary-key row. Keep the public contract intact while making the
-- authorization and projections target-first.
CREATE OR REPLACE FUNCTION platform.staff_canonical_client_detail(
  p_client_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  client_id UUID,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  lifecycle_state platform.client_lifecycle_state,
  open_duplicate_candidate_count BIGINT,
  linked_lead_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  external_identifiers JSONB,
  provenance JSONB,
  linked_leads JSONB,
  linked_student_cases JSONB,
  linked_conversations JSONB
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH RECURSIVE requested AS MATERIALIZED (
    SELECT
      client.organization_id,
      platform_private.resolve_canonical_client_id(
        client.organization_id,
        client.id
      ) AS client_id
    FROM platform.clients AS client
    WHERE client.id = p_client_id
  ),
  client_family(organization_id, client_id) AS (
    SELECT requested.organization_id, requested.client_id
    FROM requested

    UNION

    SELECT alias.organization_id, alias.superseded_client_id
    FROM client_family AS family
    JOIN platform_private.client_aliases AS alias
      ON alias.organization_id = family.organization_id
      AND alias.canonical_client_id = family.client_id
  ),
  visible AS MATERIALIZED (
    SELECT
      target_client.organization_id,
      target_client.id AS client_id,
      target_client.display_name,
      target_client.email,
      target_client.phone,
      target_client.lifecycle_state,
      (
        SELECT count(*)
        FROM platform_private.client_duplicate_candidates AS candidate
        WHERE candidate.organization_id = target_client.organization_id
          AND candidate.status = 'open'
          AND target_client.id IN (
            candidate.left_client_id,
            candidate.right_client_id
          )
      ) AS open_duplicate_candidate_count,
      (
        SELECT count(*)
        FROM platform.leads AS linked_lead
        WHERE linked_lead.organization_id = target_client.organization_id
          AND linked_lead.client_id = target_client.id
          AND private.platform_can_read_canonical_lead(
            linked_lead.organization_id,
            linked_lead.id
          )
      ) AS linked_lead_count,
      (
        SELECT count(*)
        FROM platform.student_cases AS student_case
        LEFT JOIN platform.leads AS case_lead
          ON case_lead.organization_id = student_case.organization_id
          AND case_lead.id = student_case.canonical_lead_id
        WHERE student_case.organization_id = target_client.organization_id
          AND (
            student_case.canonical_client_id = target_client.id
            OR case_lead.client_id = target_client.id
          )
          AND private.platform_can_read_student_case(
            student_case.organization_id,
            student_case.id
          )
      ) AS linked_student_case_count,
      (
        SELECT count(*)
        FROM platform.communication_conversations AS conversation
        LEFT JOIN platform.leads AS conversation_lead
          ON conversation_lead.organization_id = conversation.organization_id
          AND conversation_lead.id = conversation.canonical_lead_id
        WHERE conversation.organization_id = target_client.organization_id
          AND (
            conversation.canonical_client_id = target_client.id
            OR conversation_lead.client_id = target_client.id
          )
          AND private.platform_can_read_communication_full(
            conversation.organization_id,
            conversation.id
          )
      ) AS linked_conversation_count,
      target_client.created_at,
      target_client.updated_at
    FROM requested
    JOIN platform.clients AS target_client
      ON target_client.organization_id = requested.organization_id
      AND target_client.id = requested.client_id
    WHERE private.platform_can_read_canonical_client(
      target_client.organization_id,
      target_client.id
    )
  )
  SELECT
    visible.organization_id,
    visible.client_id,
    visible.display_name,
    visible.email,
    visible.phone,
    visible.lifecycle_state,
    visible.open_duplicate_candidate_count,
    visible.linked_lead_count,
    visible.linked_student_case_count,
    visible.linked_conversation_count,
    visible.created_at,
    visible.updated_at,
    COALESCE((
      SELECT jsonb_agg(
        external_projection.item
        ORDER BY external_projection.observed_at DESC,
          external_projection.id DESC
      )
      FROM (
        SELECT
          external.id,
          external.observed_at,
          jsonb_build_object(
            'id', external.id,
            'source_system', external.source_system,
            'external_object_type', external.external_object_type,
            'external_identifier', external.external_identifier,
            'observed_at', external.observed_at,
            'imported_at', external.imported_at,
            'source_ref', external.source_ref
          ) AS item
        FROM platform.external_identifiers AS external
        WHERE external.organization_id = visible.organization_id
          AND external.client_id IS NOT NULL
          AND external.client_id IN (
            SELECT family.client_id
            FROM client_family AS family
            WHERE family.organization_id = visible.organization_id
          )
        ORDER BY external.observed_at DESC, external.id DESC
        LIMIT 25
      ) AS external_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        provenance_projection.item
        ORDER BY provenance_projection.observed_at DESC,
          provenance_projection.id DESC
      )
      FROM (
        SELECT
          evidence.id,
          evidence.observed_at,
          jsonb_build_object(
            'id', evidence.id,
            'source_system', evidence.source_system,
            'evidence_type', evidence.evidence_type,
            'observed_at', evidence.observed_at,
            'imported_at', evidence.imported_at,
            'source_ref', evidence.source_ref,
            'recorded_at', evidence.recorded_at
          ) AS item
        FROM platform.subject_provenance AS evidence
        WHERE evidence.organization_id = visible.organization_id
          AND evidence.client_id IS NOT NULL
          AND evidence.client_id IN (
            SELECT family.client_id
            FROM client_family AS family
            WHERE family.organization_id = visible.organization_id
          )
        ORDER BY evidence.observed_at DESC, evidence.id DESC
        LIMIT 25
      ) AS provenance_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        lead_projection.item
        ORDER BY lead_projection.updated_at DESC,
          lead_projection.id DESC
      )
      FROM (
        SELECT
          lead.id,
          lead.updated_at,
          jsonb_build_object(
            'lead_id', lead.id,
            'stage_key', lead.stage_key,
            'lifecycle_state', lead.lifecycle_state,
            'source_key', lead.source_key,
            'current_owner_membership_id',
              lead.current_owner_membership_id,
            'current_owner_display_name', owner_profile.display_name,
            'updated_at', lead.updated_at
          ) AS item
        FROM platform.leads AS lead
        LEFT JOIN platform.organization_memberships AS owner_membership
          ON owner_membership.organization_id = lead.organization_id
          AND owner_membership.id = lead.current_owner_membership_id
        LEFT JOIN platform.profiles AS owner_profile
          ON owner_profile.id = owner_membership.profile_id
        WHERE lead.organization_id = visible.organization_id
          AND lead.client_id = visible.client_id
          AND private.platform_can_read_canonical_lead(
            lead.organization_id,
            lead.id
          )
        ORDER BY lead.updated_at DESC, lead.id DESC
        LIMIT 25
      ) AS lead_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        case_projection.item
        ORDER BY case_projection.updated_at DESC,
          case_projection.id DESC
      )
      FROM (
        SELECT
          student_case.id,
          student_case.updated_at,
          jsonb_build_object(
            'student_case_id', student_case.id,
            'student_display_name', student_case.student_display_name,
            'operational_stage', student_case.operational_stage,
            'state', student_case.state,
            'updated_at', student_case.updated_at
          ) AS item
        FROM platform.student_cases AS student_case
        LEFT JOIN platform.leads AS case_lead
          ON case_lead.organization_id = student_case.organization_id
          AND case_lead.id = student_case.canonical_lead_id
        WHERE student_case.organization_id = visible.organization_id
          AND (
            student_case.canonical_client_id = visible.client_id
            OR case_lead.client_id = visible.client_id
          )
          AND private.platform_can_read_student_case(
            student_case.organization_id,
            student_case.id
          )
        ORDER BY student_case.updated_at DESC, student_case.id DESC
        LIMIT 25
      ) AS case_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        conversation_projection.item
        ORDER BY conversation_projection.updated_at DESC,
          conversation_projection.id DESC
      )
      FROM (
        SELECT
          conversation.id,
          conversation.updated_at,
          jsonb_build_object(
            'conversation_id', conversation.id,
            'subject', conversation.subject,
            'queue', conversation.queue,
            'status', conversation.status,
            'updated_at', conversation.updated_at
          ) AS item
        FROM platform.communication_conversations AS conversation
        LEFT JOIN platform.leads AS conversation_lead
          ON conversation_lead.organization_id = conversation.organization_id
          AND conversation_lead.id = conversation.canonical_lead_id
        WHERE conversation.organization_id = visible.organization_id
          AND (
            conversation.canonical_client_id = visible.client_id
            OR conversation_lead.client_id = visible.client_id
          )
          AND private.platform_can_read_communication_full(
            conversation.organization_id,
            conversation.id
          )
        ORDER BY conversation.updated_at DESC, conversation.id DESC
        LIMIT 25
      ) AS conversation_projection
    ), '[]'::JSONB)
  FROM visible
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION
  platform.staff_waha_sales_intake_page(
    UUID,
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    TEXT,
    TEXT
  ),
  platform.staff_canonical_lead_conversation_link(UUID, UUID, UUID),
  platform.staff_canonical_client_detail(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.staff_waha_sales_intake_page(
    UUID,
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    TEXT,
    TEXT
  ),
  platform.staff_canonical_lead_conversation_link(UUID, UUID, UUID),
  platform.staff_canonical_client_detail(UUID)
TO authenticated;

COMMENT ON FUNCTION platform_private.bind_waha_chat_to_canonical(UUID, UUID) IS
  'Atomically links one verified direct inbound WAHA binding to exact canonical EVO client and lead identity.';
COMMENT ON FUNCTION platform.staff_waha_sales_intake_page(
  UUID,
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  TEXT,
  TEXT
) IS
  'Safe role/object-scoped receive-only WAHA Sales intake with pre-pagination state/search filters and a stable capped keyset.';
COMMENT ON FUNCTION platform.staff_canonical_lead_conversation_link(
  UUID,
  UUID,
  UUID
) IS
  'Checks one exact authorized canonical lead-to-conversation relationship for the nested receive-only Sales transcript.';
COMMENT ON FUNCTION platform.staff_canonical_client_detail(UUID) IS
  'Returns one exact authorized canonical client detail without evaluating the full visible-client inventory.';

COMMIT;
