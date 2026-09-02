-- ============================================================
-- 094_platform_sales_queue_link_alignment.sql
--
-- Keep every WhatsApp-derived Sales queue truth on the exact verified
-- Platform-intake relation established by migration 085 and reused by the
-- corrected detail projection in migration 093. A shared client, a different
-- lead, a non-intake conversation, or an unverified/unbound provider
-- observation must not mark a queue row connected or inflate its count.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform.staff_sales_lead_page(
  p_limit INTEGER,
  p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_connection_filter TEXT DEFAULT 'all',
  p_stage_filter TEXT DEFAULT NULL,
  p_assignment_filter TEXT DEFAULT 'all',
  p_owner_membership_id UUID DEFAULT NULL,
  p_due_filter TEXT DEFAULT 'all',
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  lead_id UUID,
  client_id UUID,
  client_display_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  current_owner_membership_id UUID,
  current_owner_display_name TEXT,
  stage_key TEXT,
  source_key TEXT,
  lifecycle_state platform.lead_lifecycle_state,
  next_action_text TEXT,
  next_action_due_date DATE,
  workflow_version BIGINT,
  is_connected BOOLEAN,
  open_duplicate_candidate_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_connection_filter TEXT;
  normalized_stage_filter TEXT;
  normalized_assignment_filter TEXT;
  normalized_due_filter TEXT;
  normalized_query TEXT;
  bishkek_today DATE;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'sales_workflow_invalid_limit'
      USING ERRCODE = '22023';
  END IF;

  IF (p_cursor_updated_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'sales_workflow_incomplete_cursor'
      USING ERRCODE = '22023';
  END IF;

  IF p_query IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(p_query)) > 200
  THEN
    RAISE EXCEPTION 'sales_workflow_query_too_long'
      USING ERRCODE = '22023';
  END IF;

  normalized_connection_filter := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_connection_filter)), ''),
    'all'
  );
  normalized_stage_filter := COALESCE(
    NULLIF(pg_catalog.btrim(p_stage_filter), ''),
    'all'
  );
  normalized_assignment_filter := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_assignment_filter)), ''),
    'all'
  );
  normalized_due_filter := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_due_filter)), ''),
    'all'
  );
  normalized_query := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(p_query)),
    ''
  );

  IF normalized_connection_filter NOT IN (
    'all', 'connected', 'unconnected'
  ) THEN
    RAISE EXCEPTION 'sales_workflow_invalid_connection_filter'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_stage_filter <> 'all'
    AND normalized_stage_filter NOT IN (
      'new',
      'contacting',
      'qualified',
      'meeting_scheduled',
      'meeting_completed',
      'potential'
    )
  THEN
    RAISE EXCEPTION 'sales_workflow_invalid_stage_filter'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_assignment_filter NOT IN ('all', 'mine', 'unassigned') THEN
    RAISE EXCEPTION 'sales_workflow_invalid_assignment_filter'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_due_filter NOT IN (
    'all', 'scheduled', 'unscheduled', 'due_today', 'overdue'
  ) THEN
    RAISE EXCEPTION 'sales_workflow_invalid_due_filter'
      USING ERRCODE = '22023';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_workflow_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_membership_id IS NOT NULL
    AND (
      actor.platform_role <> 'admin'
      OR NOT platform_private.is_eligible_sales_owner(
        actor.organization_id,
        p_owner_membership_id
      )
    )
  THEN
    RAISE EXCEPTION 'sales_workflow_invalid_owner_filter'
      USING ERRCODE = '22023';
  END IF;

  bishkek_today := pg_catalog.timezone(
    'Asia/Bishkek',
    pg_catalog.statement_timestamp()
  )::DATE;

  RETURN QUERY
  WITH visible AS MATERIALIZED (
    SELECT
      lead.updated_at AS sort_at,
      lead.organization_id,
      lead.id AS lead_id,
      client.id AS client_id,
      client.display_name AS client_display_name,
      client.email AS client_email,
      client.phone AS client_phone,
      lead.current_owner_membership_id,
      owner_profile.display_name AS current_owner_display_name,
      lead.stage_key,
      lead.source_key,
      lead.lifecycle_state,
      lead.next_action_text,
      lead.next_action_due_date,
      lead.workflow_version,
      EXISTS (
        SELECT 1
        FROM platform.communication_conversations AS direct_conversation
        WHERE direct_conversation.organization_id = lead.organization_id
          AND direct_conversation.canonical_lead_id = lead.id
          AND direct_conversation.sales_authority_source = 'platform_intake'
          AND direct_conversation.queue = 'sales'
          AND direct_conversation.canonical_client_id = lead.client_id
          AND EXISTS (
            SELECT 1
            FROM platform_private.waha_direct_chat_bindings AS binding
            JOIN platform_private.provider_webhook_events AS source_event
              ON source_event.organization_id = binding.organization_id
             AND source_event.id = binding.source_webhook_event_id
            WHERE binding.organization_id = direct_conversation.organization_id
              AND binding.conversation_id = direct_conversation.id
              AND binding.waha_session_name = direct_conversation.waha_session_name
              AND source_event.provider = 'waha'
              AND source_event.verification_status = 'verified'
              AND source_event.event_type IN ('message', 'message.any')
              AND source_event.raw_payload -> 'payload' -> 'fromMe'
                = 'false'::JSONB
              AND pg_catalog.lower(
                COALESCE(
                  pg_catalog.btrim(
                    source_event.raw_payload -> 'payload' ->> 'source'
                  ),
                  ''
                )
              ) <> 'api'
          )
          AND private.platform_can_read_canonical_lead(
            lead.organization_id,
            lead.id
          )
          AND private.platform_can_read_communication_full(
            direct_conversation.organization_id,
            direct_conversation.id
          )
      ) AS is_connected,
      CASE
        WHEN client.id IS NULL THEN 0::BIGINT
        ELSE (
          SELECT pg_catalog.count(*)
          FROM platform_private.client_duplicate_candidates AS candidate
          WHERE candidate.organization_id = lead.organization_id
            AND candidate.status = 'open'
            AND client.id IN (
              candidate.left_client_id,
              candidate.right_client_id
            )
        )
      END AS open_duplicate_candidate_count,
      (
        SELECT pg_catalog.count(*)
        FROM platform.student_cases AS student_case
        WHERE student_case.organization_id = lead.organization_id
          AND (
            student_case.canonical_lead_id = lead.id
            OR (
              lead.client_id IS NOT NULL
              AND student_case.canonical_client_id = lead.client_id
            )
          )
          AND private.platform_can_read_student_case(
            student_case.organization_id,
            student_case.id
          )
      ) AS linked_student_case_count,
      (
        SELECT pg_catalog.count(*)
        FROM platform.communication_conversations AS conversation
        WHERE conversation.organization_id = lead.organization_id
          AND conversation.canonical_lead_id = lead.id
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
              AND source_event.raw_payload -> 'payload' -> 'fromMe'
                = 'false'::JSONB
              AND pg_catalog.lower(
                COALESCE(
                  pg_catalog.btrim(
                    source_event.raw_payload -> 'payload' ->> 'source'
                  ),
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
      ) AS linked_conversation_count,
      lead.created_at,
      lead.updated_at
    FROM platform.leads AS lead
    LEFT JOIN platform.clients AS client
      ON client.organization_id = lead.organization_id
      AND client.id = lead.client_id
    LEFT JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = lead.organization_id
      AND owner_membership.id = lead.current_owner_membership_id
    LEFT JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
    WHERE lead.organization_id = actor.organization_id
      AND lead.lifecycle_state = 'open'
      AND (
        actor.platform_role = 'admin'
        OR lead.current_owner_membership_id = actor.membership_id
        OR lead.current_owner_membership_id IS NULL
      )
      AND (
        normalized_stage_filter = 'all'
        OR lead.stage_key = normalized_stage_filter
      )
      AND (
        normalized_assignment_filter = 'all'
        OR (
          normalized_assignment_filter = 'mine'
          AND lead.current_owner_membership_id = actor.membership_id
        )
        OR (
          normalized_assignment_filter = 'unassigned'
          AND lead.current_owner_membership_id IS NULL
        )
      )
      AND (
        p_owner_membership_id IS NULL
        OR lead.current_owner_membership_id = p_owner_membership_id
      )
      AND (
        normalized_due_filter = 'all'
        OR (
          normalized_due_filter = 'scheduled'
          AND lead.next_action_due_date IS NOT NULL
        )
        OR (
          normalized_due_filter = 'unscheduled'
          AND lead.next_action_due_date IS NULL
        )
        OR (
          normalized_due_filter = 'due_today'
          AND lead.next_action_due_date = bishkek_today
        )
        OR (
          normalized_due_filter = 'overdue'
          AND lead.next_action_due_date < bishkek_today
        )
      )
      AND (
        normalized_query IS NULL
        OR pg_catalog.strpos(
          pg_catalog.lower(
            pg_catalog.concat_ws(
              ' ',
              client.display_name,
              client.email,
              client.phone,
              owner_profile.display_name,
              lead.id::TEXT,
              lead.stage_key,
              lead.source_key,
              lead.next_action_text
            )
          ),
          normalized_query
        ) > 0
      )
  )
  SELECT
    visible.sort_at,
    visible.organization_id,
    visible.lead_id,
    visible.client_id,
    visible.client_display_name,
    visible.client_email,
    visible.client_phone,
    visible.current_owner_membership_id,
    visible.current_owner_display_name,
    visible.stage_key,
    visible.source_key,
    visible.lifecycle_state,
    visible.next_action_text,
    visible.next_action_due_date,
    visible.workflow_version,
    visible.is_connected,
    visible.open_duplicate_candidate_count,
    visible.linked_student_case_count,
    visible.linked_conversation_count,
    visible.created_at,
    visible.updated_at
  FROM visible
  WHERE (
      normalized_connection_filter = 'all'
      OR (
        normalized_connection_filter = 'connected'
        AND visible.is_connected
      )
      OR (
        normalized_connection_filter = 'unconnected'
        AND NOT visible.is_connected
      )
    )
    AND (
      p_cursor_updated_at IS NULL
      OR (visible.sort_at, visible.lead_id)
        < (p_cursor_updated_at, p_cursor_id)
    )
  ORDER BY visible.sort_at DESC, visible.lead_id DESC
  LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_sales_lead_page(
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT
)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.staff_sales_lead_page(
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT
)
TO authenticated;

COMMENT ON FUNCTION platform.staff_sales_lead_page(
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT
) IS
  'Bounded role-scoped U4 Sales queue with pre-limit connected, stage, assignment, due and query filters.';

COMMIT;
