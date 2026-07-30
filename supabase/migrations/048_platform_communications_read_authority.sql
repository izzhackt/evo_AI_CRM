-- ============================================================
-- 048_platform_communications_read_authority.sql
--
-- P3B: make the existing staff communication read RPCs safe for
-- PostgREST read-only transactions. The write authority helper keeps its
-- locking behavior; this migration adds a separate lock-free read helper.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform_private.require_domain_actor_read(
  p_organization_id UUID,
  p_permission_key TEXT
)
RETURNS TABLE (
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID,
  actor_role platform.business_role
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL
    OR (SELECT auth.uid()) IS NULL
    OR NOT private.platform_has_permission(
      p_organization_id,
      p_permission_key
    )
  THEN
    RAISE EXCEPTION
      'Active Platform permission is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    profile.id,
    membership.id,
    profile.auth_user_id,
    membership."current_role"
  FROM platform.profiles AS profile
  JOIN platform.organization_memberships AS membership
    ON membership.profile_id = profile.id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE profile.auth_user_id = (SELECT auth.uid())
    AND profile.status = 'active'
    AND membership.organization_id = p_organization_id
    AND membership.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
    AND membership."current_role"::TEXT =
      (SELECT auth.jwt() ->> 'platform_role')
    AND profile.access_version::TEXT =
      (SELECT auth.jwt() ->> 'platform_access_version');

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Active Platform permission is required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_domain_actor_read(
  UUID,
  TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.staff_communication_queue(
  p_organization_id UUID
)
RETURNS TABLE (
  conversation_id UUID,
  student_case_id UUID,
  queue platform.communication_queue,
  status platform.communication_status,
  subject TEXT,
  waha_session_name TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  RETURN QUERY
  SELECT
    conversation.id,
    conversation.student_case_id,
    conversation.queue,
    conversation.status,
    conversation.subject,
    conversation.waha_session_name,
    conversation.kommo_account_id,
    conversation.kommo_conversation_id,
    conversation.amocrm_account_id,
    conversation.amocrm_lead_id,
    conversation.amocrm_contact_id,
    conversation.created_at
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND private.platform_can_read_communication_full(
      conversation.organization_id,
      conversation.id
    )
  ORDER BY conversation.updated_at DESC, conversation.id;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_conversation_messages(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  message_id UUID,
  conversation_id UUID,
  direction platform.communication_direction,
  body_text TEXT,
  language platform.communication_message_language,
  student_visible BOOLEAN,
  waha_session_name TEXT,
  waha_message_id TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  kommo_message_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  ) THEN
    RAISE EXCEPTION
      'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    message.id,
    message.conversation_id,
    message.direction,
    message.body_text,
    message.language,
    message.student_visible,
    message.waha_session_name,
    message.waha_message_id,
    message.kommo_account_id,
    message.kommo_conversation_id,
    message.kommo_message_id,
    message.amocrm_account_id,
    message.amocrm_lead_id,
    message.amocrm_contact_id,
    message.created_at
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.conversation_id = p_conversation_id
  ORDER BY message.created_at, message.id;
END
$$;

REVOKE ALL ON FUNCTION
  platform.staff_communication_queue(UUID),
  platform.staff_conversation_messages(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.staff_communication_queue(UUID),
  platform.staff_conversation_messages(UUID, UUID)
TO authenticated;

COMMIT;
