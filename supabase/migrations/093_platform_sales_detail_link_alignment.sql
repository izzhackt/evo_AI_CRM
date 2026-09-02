-- ============================================================
-- 093_platform_sales_detail_link_alignment.sql
--
-- Keep the Sales detail conversation count and projection on the exact
-- verified Platform-intake relation already established by migration 085.
-- A shared client, a different lead, a non-intake conversation, or an
-- unverified/unbound provider observation is not a Sales lead link.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform.staff_sales_lead_detail(p_lead_id UUID)
RETURNS TABLE (
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
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  external_identifiers JSONB,
  provenance JSONB,
  linked_student_cases JSONB,
  linked_conversations JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
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

  RETURN QUERY
  SELECT
    lead.organization_id,
    lead.id,
    client.id,
    client.display_name,
    client.email,
    client.phone,
    lead.current_owner_membership_id,
    owner_profile.display_name,
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
    ),
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
    END,
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
    ),
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
    ),
    lead.created_at,
    lead.updated_at,
    COALESCE(safe_context.external_identifiers, '[]'::JSONB),
    COALESCE(safe_context.provenance, '[]'::JSONB),
    COALESCE(safe_context.linked_student_cases, '[]'::JSONB),
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        conversation_projection.item
        ORDER BY conversation_projection.updated_at DESC,
          conversation_projection.id DESC
      )
      FROM (
        SELECT
          conversation.id,
          conversation.updated_at,
          pg_catalog.jsonb_build_object(
            'conversation_id', conversation.id,
            'subject', conversation.subject,
            'queue', conversation.queue,
            'status', conversation.status,
            'updated_at', conversation.updated_at
          ) AS item
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
        ORDER BY conversation.updated_at DESC, conversation.id DESC
        LIMIT 25
      ) AS conversation_projection
    ), '[]'::JSONB)
  FROM platform.leads AS lead
  LEFT JOIN platform.clients AS client
    ON client.organization_id = lead.organization_id
    AND client.id = lead.client_id
  LEFT JOIN platform.organization_memberships AS owner_membership
    ON owner_membership.organization_id = lead.organization_id
    AND owner_membership.id = lead.current_owner_membership_id
  LEFT JOIN platform.profiles AS owner_profile
    ON owner_profile.id = owner_membership.profile_id
  LEFT JOIN LATERAL (
    SELECT
      detail.external_identifiers,
      detail.provenance,
      detail.linked_student_cases
    FROM platform.staff_canonical_lead_detail(lead.id) AS detail
    LIMIT 1
  ) AS safe_context ON TRUE
  WHERE lead.organization_id = actor.organization_id
    AND lead.id = p_lead_id
    AND lead.lifecycle_state = 'open'
    AND (
      actor.platform_role = 'admin'
      OR lead.current_owner_membership_id = actor.membership_id
      OR lead.current_owner_membership_id IS NULL
    )
  LIMIT 1;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_sales_lead_detail(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.staff_sales_lead_detail(UUID)
TO authenticated;

COMMENT ON FUNCTION platform.staff_sales_lead_detail(UUID) IS
  'One role-scoped canonical Sales lead; conversation count and projection include only exact verified Platform-intake links.';

COMMIT;
