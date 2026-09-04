-- ============================================================
-- 106_platform_communication_command_context.sql
--
-- Expose the exact canonical CRM bindings for one selected, staff-visible
-- conversation. Provider identifiers are deliberately excluded: command
-- routing must never infer canonical scope from amoCRM, Kommo or WAHA ids.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform.staff_communication_command_context(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  conversation_id UUID,
  canonical_lead_id UUID,
  canonical_client_id UUID,
  student_case_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL
    OR p_organization_id = '00000000-0000-0000-0000-000000000000'::UUID
  THEN
    RAISE EXCEPTION 'Invalid communication command organization'
      USING ERRCODE = '22023';
  END IF;

  IF p_conversation_id IS NULL
    OR p_conversation_id = '00000000-0000-0000-0000-000000000000'::UUID
  THEN
    RAISE EXCEPTION 'Invalid communication command conversation'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  RETURN QUERY
  WITH actor AS MATERIALIZED (
    SELECT authority.organization_id
    FROM platform.current_actor_authority() AS authority
    WHERE authority.organization_id = p_organization_id
  )
  SELECT
    conversation.id,
    conversation.canonical_lead_id,
    conversation.canonical_client_id,
    conversation.student_case_id
  FROM actor
  JOIN platform.communication_conversations AS conversation
    ON conversation.organization_id = actor.organization_id
   AND conversation.id = p_conversation_id
  WHERE COALESCE(
      private.platform_can_read_communication_full(
        conversation.organization_id,
        conversation.id
      ),
      FALSE
    )
  LIMIT 1;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_communication_command_context(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION platform.staff_communication_command_context(UUID, UUID)
  TO authenticated;

COMMENT ON FUNCTION platform.staff_communication_command_context(UUID, UUID) IS
  'Returns exact stored canonical lead, client and Student Case bindings for one current-actor-visible conversation; never infers scope from provider identifiers.';

COMMIT;
