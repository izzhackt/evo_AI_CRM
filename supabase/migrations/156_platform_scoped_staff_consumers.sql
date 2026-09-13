-- S2: current domain consumers share the paired permission/resource authority.
-- 155 and 156 are one cutover; never enable role editing on 155 alone.
-- Historical role labels remain in return contracts and audit only. Student
-- ownership and sensitive personal grants remain separate protected boundaries.
-- https://supabase.com/docs/guides/database/postgres/row-level-security
-- https://supabase.com/docs/guides/api/securing-your-api
BEGIN;

-- RLS evaluates as the requesting database role. Expose only this actor-bound
-- boolean wrapper; never grant clients the arbitrary-membership evaluator.
CREATE FUNCTION private.platform_staff_can_access(p_organization_id UUID,p_permission_key TEXT,
  p_resource_kind TEXT,p_resource_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT platform_private.staff_can_access_for_actor(p_organization_id,p_permission_key,p_resource_kind,p_resource_id)
$$;
REVOKE ALL ON FUNCTION private.platform_staff_can_access(UUID,TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_staff_can_access(UUID,TEXT,TEXT,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION private.platform_can_read_student_case(
  p_organization_id UUID, p_student_case_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT platform_private.staff_can_access_for_actor(
    p_organization_id, 'case.read.full', 'student_case', p_student_case_id)
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_canonical_lead(
  p_organization_id UUID, p_lead_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT platform_private.staff_can_access_for_actor(
    p_organization_id, 'lead.read', 'lead', p_lead_id)
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_canonical_client(
  p_organization_id UUID, p_client_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT platform_private.staff_can_access_for_actor(
    p_organization_id, 'client.read', 'client',
    platform_private.resolve_canonical_client_id(p_organization_id, p_client_id))
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_document_full(
  p_organization_id UUID, p_student_case_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT platform_private.staff_can_access_for_actor(
    p_organization_id, 'document.read.full', 'student_case', p_student_case_id)
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_document_requirement(
  p_organization_id UUID, p_requirement_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT platform_private.staff_can_access_for_actor(
    p_organization_id, 'document.read.full', 'organization', p_organization_id)
  OR EXISTS (
    SELECT 1 FROM platform.document_slots AS slot
    WHERE slot.organization_id = p_organization_id
      AND slot.requirement_id = p_requirement_id
      AND private.platform_can_read_document_full(slot.organization_id, slot.student_case_id)
  )
$$;

-- This organization-wide root is used by global Finance collections. Case
-- collections below use the actual case rather than granting a global scope.
CREATE OR REPLACE FUNCTION private.platform_can_read_finance_full(
  p_organization_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT platform_private.staff_can_access_for_actor(
    p_organization_id, 'finance.read.full', 'organization', p_organization_id)
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_approved_knowledge(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.staff_can_access_for_actor(p_organization_id,
    'knowledge.read.approved', 'organization', p_organization_id)
$$;
CREATE OR REPLACE FUNCTION private.platform_can_read_work_review(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.staff_can_access_for_actor(p_organization_id,
    'workreview.read', 'organization', p_organization_id)
$$;
CREATE OR REPLACE FUNCTION private.platform_can_read_workflow_contracts(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.staff_can_access_for_actor(p_organization_id,
    'workflow.contract.read', 'organization', p_organization_id)
$$;
CREATE OR REPLACE FUNCTION private.platform_can_manage_workflow_contracts(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.staff_can_access_for_actor(p_organization_id,
    'workflow.contract.manage', 'organization', p_organization_id)
$$;
CREATE OR REPLACE FUNCTION private.platform_can_read_contract_template(
  p_organization_id UUID, p_status platform.contract_template_version_status
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.staff_can_access_for_actor(p_organization_id,
    'contract.template.read', 'organization', p_organization_id)
    AND (p_status = 'approved' OR platform_private.staff_can_access_for_actor(p_organization_id,
      'contract.template.manage', 'organization', p_organization_id))
$$;

CREATE OR REPLACE FUNCTION platform_private.require_case_operator(
  p_organization_id UUID, p_student_case_id UUID, p_permission_key TEXT
) RETURNS TABLE (
  actor_profile_id UUID, actor_membership_id UUID,
  actor_auth_user_id UUID, actor_role platform.business_role
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.require_domain_actor(p_organization_id, p_permission_key);
  IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
    p_permission_key, 'student_case', p_student_case_id)
    OR (p_permission_key IN ('contract.evidence.confirm','finance.event.confirm',
      'finance.first.payment.confirm','admissions.handoff.gate.override')
      AND NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
        'case.read.full', 'student_case', p_student_case_id)) THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.actor_profile_id, actor.actor_membership_id,
    actor.actor_auth_user_id, actor.actor_role;
END
$$;

CREATE FUNCTION platform.staff_case_access_snapshot(p_organization_id UUID, p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority()
    WHERE current_actor_authority.organization_id = p_organization_id;
  IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id, a.membership_id,
    'case.read.full', 'student_case', p_student_case_id) THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('organizationId', p_organization_id, 'studentCaseId', p_student_case_id,
    'documents', platform_private.staff_can_access(p_organization_id, a.membership_id, 'document.read.full', 'student_case', p_student_case_id),
    'finance', (platform_private.staff_can_access(p_organization_id, a.membership_id, 'finance.read.full', 'student_case', p_student_case_id)
      OR platform_private.staff_can_access(p_organization_id, a.membership_id, 'finance.read.summary', 'student_case', p_student_case_id)),
    'studentProfile', platform_private.staff_can_access(p_organization_id, a.membership_id, 'profile.read.full', 'student_case', p_student_case_id),
    'contract', platform_private.staff_can_access(p_organization_id, a.membership_id, 'case.workflow.read', 'student_case', p_student_case_id),
    'handoff', TRUE, 'applications', TRUE, 'visa', TRUE);
END
$$;
REVOKE ALL ON FUNCTION platform.staff_case_access_snapshot(UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_access_snapshot(UUID,UUID) TO authenticated;

-- The union-only staff snapshot cannot pair a permission with its assignment.
-- Expose only this live organization-total hint; the data RPC rechecks it.
-- Definer/search_path and explicit EXECUTE grants follow:
-- https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker
CREATE FUNCTION platform.staff_monthly_payment_summary_access(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT i.* INTO actor
  FROM platform.current_actor_authority() AS a
  JOIN platform_private.staff_membership_identity(a.organization_id, a.membership_id) AS i ON TRUE
  WHERE a.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finance summary access is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('schemaVersion', 1, 'organizationId', actor.organization_id,
    'canReadSummary', platform_private.staff_can_access(
      actor.organization_id, actor.membership_id, 'finance.read.full',
      'organization', actor.organization_id));
END
$$;
REVOKE ALL ON FUNCTION platform.staff_monthly_payment_summary_access(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_monthly_payment_summary_access(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION private.platform_can_read_communication_full(
  p_organization_id UUID, p_conversation_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.staff_can_access_for_actor(p_organization_id,
    'communication.read.full', 'conversation', p_conversation_id)
$$;
CREATE OR REPLACE FUNCTION platform_private.membership_can_read_communication(
  p_organization_id UUID, p_membership_id UUID, p_conversation_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.staff_can_access(p_organization_id, p_membership_id,
    'communication.read.full', 'conversation', p_conversation_id)
$$;
CREATE OR REPLACE FUNCTION platform_private.require_communication_actor(
  p_organization_id UUID, p_conversation_id UUID, p_permission_key TEXT
) RETURNS TABLE (
  actor_profile_id UUID, actor_membership_id UUID,
  actor_auth_user_id UUID, actor_role platform.business_role
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.require_domain_actor(p_organization_id, p_permission_key);
  IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
    p_permission_key, 'conversation', p_conversation_id) THEN
    RAISE EXCEPTION 'Communication conversation is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.actor_profile_id, actor.actor_membership_id,
    actor.actor_auth_user_id, actor.actor_role;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_notification_actor(
  p_organization_id UUID, p_student_case_id UUID, p_category TEXT
) RETURNS TABLE (
  actor_profile_id UUID, actor_membership_id UUID,
  actor_auth_user_id UUID, actor_role platform.business_role
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_student_case_id IS NULL OR p_category IS NULL
    OR lower(btrim(p_category)) !~ '^[a-z][a-z0-9_.-]*$' THEN
    RAISE EXCEPTION 'A valid notification case and category are required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT * FROM platform_private.require_case_operator(
    p_organization_id, p_student_case_id, 'notification.create');
END
$$;

CREATE OR REPLACE FUNCTION platform_private.u7_require_case_workspace_actor(
  p_student_case_id UUID
) RETURNS TABLE (
  auth_user_id UUID, profile_id UUID, membership_id UUID, organization_id UUID,
  student_case_id UUID, display_name TEXT, platform_role platform.business_role
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'student_case_id is required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT a.auth_user_id, a.profile_id, a.membership_id,
    a.organization_id, p_student_case_id, a.display_name, a.platform_role
  FROM platform.current_actor_authority() AS a
  WHERE platform_private.staff_can_access(a.organization_id, a.membership_id,
    'case.read.full', 'student_case', p_student_case_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
END
$$;

-- An action preflight, not record authorization: each row/mutation consumer
-- still checks its exact case through the paired evaluator.
CREATE OR REPLACE FUNCTION platform_private.require_admissions_runtime_actor(
  p_permission_key TEXT
) RETURNS TABLE (
  auth_user_id UUID, profile_id UUID, membership_id UUID, organization_id UUID,
  display_name TEXT, platform_role platform.business_role
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN QUERY SELECT a.auth_user_id, a.profile_id, a.membership_id,
    a.organization_id, a.display_name, a.platform_role
  FROM platform.current_actor_authority() AS a
  WHERE a.platform_role IS DISTINCT FROM 'student'
    AND private.platform_has_permission(a.organization_id, p_permission_key);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admissions runtime authority is required' USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION private.platform_can_access_bw6_case(
  p_organization_id UUID, p_student_case_id UUID, p_permission_key TEXT,
  p_post_contract_only BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.student_cases AS c
    WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id
      AND (NOT p_post_contract_only OR c.state IN ('active', 'closed'))
      AND platform_private.staff_can_access_for_actor(
        c.organization_id, p_permission_key, 'student_case', c.id)
  )
$$;

CREATE OR REPLACE FUNCTION platform_private.require_bw6_case_actor(
  p_organization_id UUID, p_student_case_id UUID, p_permission_key TEXT,
  p_post_contract_only BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
  actor_profile_id UUID, actor_membership_id UUID,
  actor_auth_user_id UUID, actor_role platform.business_role
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE actor RECORD; c platform.student_cases%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM platform_private.require_domain_actor(p_organization_id, p_permission_key);
  SELECT * INTO c FROM platform.student_cases s
    WHERE s.organization_id = p_organization_id AND s.id = p_student_case_id FOR UPDATE;
  IF NOT FOUND OR (p_post_contract_only AND c.state NOT IN ('active', 'closed'))
    OR NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
      p_permission_key, 'student_case', p_student_case_id) THEN
    RAISE EXCEPTION 'Authorized student case is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.actor_profile_id, actor.actor_membership_id,
    actor.actor_auth_user_id, actor.actor_role;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_company_file_actor(
  p_organization_id UUID, p_permission_key TEXT
) RETURNS TABLE (
  actor_profile_id UUID, actor_membership_id UUID,
  actor_auth_user_id UUID, actor_role platform.business_role
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.require_domain_actor(p_organization_id, p_permission_key);
  IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
    p_permission_key, 'organization', p_organization_id) THEN
    RAISE EXCEPTION 'Company file access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.actor_profile_id, actor.actor_membership_id,
    actor.actor_auth_user_id, actor.actor_role;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_finance_actor(
  p_organization_id UUID, p_permission_key TEXT
) RETURNS TABLE (
  actor_profile_id UUID, actor_membership_id UUID,
  actor_auth_user_id UUID, actor_role platform.business_role
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.require_domain_actor(p_organization_id, p_permission_key);
  IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
    p_permission_key, 'organization', p_organization_id) THEN
    RAISE EXCEPTION 'Active organization-scoped permission is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.actor_profile_id, actor.actor_membership_id,
    actor.actor_auth_user_id, actor.actor_role;
END
$$;

CREATE FUNCTION platform_private.require_organization_operator(p_organization_id UUID, p_permission_key TEXT)
RETURNS TABLE(actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID, actor_role platform.business_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform_private.require_domain_actor(p_organization_id, p_permission_key);
  IF NOT platform_private.staff_can_access(p_organization_id, a.actor_membership_id,
    p_permission_key, 'organization', p_organization_id) THEN
    RAISE EXCEPTION 'Organization action is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT a.actor_profile_id, a.actor_membership_id, a.actor_auth_user_id, a.actor_role;
END
$$;
REVOKE ALL ON FUNCTION platform_private.require_organization_operator(UUID,TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Existing published APIs are retained; their implementation now delegates to
-- the actual organization action, not a fixed business-role name.
DO $migration$
DECLARE helper TEXT; permission TEXT;
BEGIN
  FOR helper, permission IN SELECT * FROM (VALUES
    ('require_bw1_admin_actor','workflow.contract.manage'),
    ('require_bw3_admin_actor','country.requirement.manage'),
    ('require_bw4_admin_actor','prompt.artifact.manage')
  ) AS replacements(helper, permission) LOOP
    EXECUTE format($definition$
      CREATE OR REPLACE FUNCTION platform_private.%I(p_organization_id UUID)
      RETURNS TABLE(actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID)
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $body$
      BEGIN
        RETURN QUERY SELECT a.actor_profile_id, a.actor_membership_id, a.actor_auth_user_id
        FROM platform_private.require_organization_operator(p_organization_id, %L) a;
      END
      $body$
    $definition$, helper, permission);
  END LOOP;
  FOR helper, permission IN SELECT * FROM (VALUES
    ('require_bw5_admin_actor','catalog.import.manage'),
    ('require_bw6_admin_actor','contract.template.manage')
  ) AS replacements(helper, permission) LOOP
    EXECUTE format($definition$
      CREATE OR REPLACE FUNCTION platform_private.%I(p_organization_id UUID)
      RETURNS TABLE(actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID, actor_role platform.business_role)
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $body$
      BEGIN
        RETURN QUERY SELECT * FROM platform_private.require_organization_operator(p_organization_id, %L);
      END
      $body$
    $definition$, helper, permission);
  END LOOP;
  FOREACH helper IN ARRAY ARRAY['require_p2e_admin_actor','require_p2f_admin_actor'] LOOP
    EXECUTE format($definition$
      CREATE OR REPLACE FUNCTION platform_private.%I(p_organization_id UUID,p_permission_key TEXT)
      RETURNS TABLE(actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID, actor_role platform.business_role)
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $body$
      BEGIN
        RETURN QUERY SELECT * FROM platform_private.require_organization_operator(p_organization_id, p_permission_key);
      END
      $body$
    $definition$, helper);
  END LOOP;
END
$migration$;

CREATE OR REPLACE FUNCTION platform_private.current_bw5_actor(p_permission_key TEXT, p_require_admin_scope BOOLEAN DEFAULT FALSE)
RETURNS TABLE(actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID,
  actor_organization_id UUID, actor_role platform.business_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT a.profile_id, a.membership_id, a.auth_user_id, a.organization_id, a.platform_role
  FROM platform.current_actor_authority() a
  WHERE platform_private.staff_can_access(a.organization_id, a.membership_id,
    p_permission_key, 'organization', a.organization_id)
    OR (NOT p_require_admin_scope AND a.platform_role = 'student'
      AND p_permission_key = 'catalog.read'
      AND private.platform_has_permission(a.organization_id, p_permission_key));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Platform permission is required' USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION private.require_student_case_note_mutation_actor(
  p_organization_id UUID, p_student_case_id UUID
) RETURNS TABLE (
  actor_profile_id UUID, actor_membership_id UUID,
  actor_auth_user_id UUID, actor_role platform.business_role
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.require_domain_actor(p_organization_id, 'case.read.full');
  PERFORM 1 FROM platform.student_cases c
    WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id FOR UPDATE;
  IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
    'case.read.full', 'student_case', p_student_case_id) THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.actor_profile_id, actor.actor_membership_id,
    actor.actor_auth_user_id, actor.actor_role;
END
$$;

-- Student case access remains the existing separate owner-only portal path.
CREATE OR REPLACE FUNCTION platform_private.require_case_operations_actor(
  p_case_id UUID, p_allow_student BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
  organization_id UUID, membership_id UUID, student_case_id UUID,
  platform_role platform.business_role
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE a RECORD; c platform.student_cases%ROWTYPE;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL THEN
    RAISE EXCEPTION 'Case access denied' USING ERRCODE = '42501';
  END IF;
  IF a.platform_role = 'student' AND p_allow_student
    AND private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    IF (SELECT count(*) FROM platform.student_portal_cases()) <> 1 THEN
      RAISE EXCEPTION 'Case access denied' USING ERRCODE = '42501';
    END IF;
    SELECT s.* INTO c FROM platform.student_cases s
    JOIN platform.student_portal_cases() portal ON portal.case_id = s.id
    WHERE s.organization_id = a.organization_id AND s.student_membership_id = a.membership_id;
    IF NOT FOUND OR (p_case_id IS NOT NULL AND p_case_id <> c.id) THEN
      RAISE EXCEPTION 'Case access denied' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT s.* INTO c FROM platform.student_cases s
    WHERE s.organization_id = a.organization_id AND s.id = p_case_id
      AND platform_private.staff_can_access(a.organization_id, a.membership_id,
        'case.read.full', 'student_case', s.id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case access denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN QUERY SELECT a.organization_id, a.membership_id, c.id, a.platform_role;
END
$$;

-- Team channels have no department/direction owner. Their permission is
-- explicitly organization-wide; a Sales record grant is not a chat grant.
CREATE OR REPLACE FUNCTION platform_private.team_chat_can_access(
  p_organization_id UUID, p_channel_key TEXT
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_channel_key IN ('general', 'sales', 'admissions')
    AND platform_private.staff_can_access_for_actor(p_organization_id,
      'team.chat.' || p_channel_key, 'organization', p_organization_id)
$$;

CREATE OR REPLACE FUNCTION platform_private.amocrm_runtime_actor(
  p_organization_id UUID, p_actor_role TEXT, p_workflow_scope TEXT,
  p_workflow_lead_id UUID, p_student_case_id UUID
) RETURNS TABLE (
  organization_id UUID, actor_profile_id UUID, actor_membership_id UUID,
  actor_auth_user_id UUID, actor_display_name TEXT, actor_role TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; identity RECORD; descriptor TEXT;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority()
    WHERE current_actor_authority.organization_id = p_organization_id;
  SELECT * INTO identity FROM platform_private.staff_membership_identity(p_organization_id, a.membership_id);
  IF identity.membership_id IS NULL THEN
    RAISE EXCEPTION 'amocrm_command_forbidden' USING ERRCODE = '42501';
  END IF;
  descriptor := CASE WHEN identity.system_role = 'admin' THEN 'admin'
    WHEN p_workflow_scope = 'sales_pre_handoff' THEN 'sales'
    WHEN p_workflow_scope = 'admissions_post_handoff' THEN 'admissions' END;
  -- actor_role is the operation-view label retained in immutable receipts,
  -- not a second authorization role or a caller-selected effective identity.
  IF descriptor IS NULL OR p_actor_role IS DISTINCT FROM descriptor
    OR NOT platform_private.staff_can_access(p_organization_id, a.membership_id,
      'lead.read', 'lead', p_workflow_lead_id) THEN
    RAISE EXCEPTION 'amocrm_command_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_workflow_scope = 'sales_pre_handoff' THEN
    IF p_student_case_id IS NOT NULL THEN
      RAISE EXCEPTION 'amocrm_command_forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF p_workflow_scope = 'admissions_post_handoff' THEN
    IF p_student_case_id IS NULL OR NOT platform_private.staff_can_access(
      p_organization_id, a.membership_id, 'case.read.full', 'student_case', p_student_case_id)
      OR NOT EXISTS (SELECT 1 FROM platform.student_cases c
        WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id
          AND c.canonical_lead_id = p_workflow_lead_id) THEN
      RAISE EXCEPTION 'amocrm_command_forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'amocrm_command_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT a.organization_id, a.profile_id, a.membership_id,
    a.auth_user_id, a.display_name, descriptor;
END
$$;

-- Existing accepted files and immutable receipts are unchanged. Old unfinished
-- reservations have no authority snapshot and explicitly cease to be usable.
ALTER TABLE platform_private.document_upload_reservations
  ADD COLUMN uploader_access_version BIGINT CHECK (uploader_access_version > 0);
ALTER TABLE platform_private.company_file_upload_reservations
  ADD COLUMN uploader_access_version BIGINT CHECK (uploader_access_version > 0);
ALTER TABLE platform_private.company_file_download_grants
  ADD COLUMN grantee_access_version BIGINT CHECK (grantee_access_version > 0);

CREATE FUNCTION platform_private.capture_upload_access_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT p.access_version INTO STRICT NEW.uploader_access_version
  FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
  WHERE p.id = NEW.uploader_profile_id AND p.auth_user_id = NEW.uploader_auth_user_id
    AND m.organization_id = NEW.organization_id AND m.id = NEW.uploader_membership_id
    AND p.status = 'active' AND m.status = 'active'
  FOR SHARE OF p, m;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.capture_upload_access_version()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER document_upload_capture_access_version
  BEFORE INSERT ON platform_private.document_upload_reservations
  FOR EACH ROW EXECUTE FUNCTION platform_private.capture_upload_access_version();
CREATE TRIGGER company_upload_capture_access_version
  BEFORE INSERT ON platform_private.company_file_upload_reservations
  FOR EACH ROW EXECUTE FUNCTION platform_private.capture_upload_access_version();

CREATE FUNCTION platform_private.capture_company_download_access_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT p.access_version INTO STRICT NEW.grantee_access_version
  FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
  WHERE p.id = NEW.grantee_profile_id AND p.auth_user_id = NEW.grantee_auth_user_id
    AND m.organization_id = NEW.organization_id AND m.id = NEW.grantee_membership_id
    AND p.status = 'active' AND m.status = 'active'
  FOR SHARE OF p, m;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.capture_company_download_access_version()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER company_download_capture_access_version
  BEFORE INSERT ON platform_private.company_file_download_grants
  FOR EACH ROW EXECUTE FUNCTION platform_private.capture_company_download_access_version();

ALTER TABLE platform_private.message_media_attachment_intents
  ALTER COLUMN actor_role DROP NOT NULL,
  DROP CONSTRAINT message_media_attachment_intents_actor_role_check,
  ADD CONSTRAINT message_media_attachment_intents_actor_role_check CHECK (actor_role IS DISTINCT FROM 'student');
ALTER TABLE platform_private.company_file_download_grants
  ALTER COLUMN grantee_role DROP NOT NULL,
  DROP CONSTRAINT company_file_download_grants_grantee_role_check,
  ADD CONSTRAINT company_file_download_grants_grantee_role_check CHECK (grantee_role IS DISTINCT FROM 'student');
ALTER TABLE platform_private.document_download_grants
  ALTER COLUMN grantee_role DROP NOT NULL,
  DROP CONSTRAINT document_download_grants_grantee_role_check;
ALTER TABLE platform_private.communication_media_download_grants
  ALTER COLUMN grantee_role DROP NOT NULL;

CREATE OR REPLACE FUNCTION platform_private.require_scanned_upload_actor(
  p_organization_id UUID, p_actor_auth_user_id UUID, p_permission_key TEXT
) RETURNS TABLE (
  actor_profile_id UUID, actor_membership_id UUID,
  actor_auth_user_id UUID, actor_role platform.business_role
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
    OR p_organization_id IS NULL OR p_actor_auth_user_id IS NULL
    OR p_permission_key NOT IN ('document.upload', 'company.file.upload') THEN
    RAISE EXCEPTION 'Active Platform upload permission is required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM platform.organizations o WHERE o.id=p_organization_id FOR UPDATE;
  RETURN QUERY SELECT p.id, m.id, p.auth_user_id, m."current_role"
  FROM platform.profiles p
  JOIN platform.organization_memberships m ON m.profile_id = p.id
  JOIN platform.organizations o ON o.id = m.organization_id
  WHERE p.auth_user_id = p_actor_auth_user_id AND p.status = 'active'
    AND m.organization_id = p_organization_id AND m.status = 'active' AND o.status = 'active'
    AND (
      platform_private.staff_has_permission(p_organization_id, m.id, p_permission_key)
      OR (m."current_role" = 'student' AND p_permission_key = 'document.upload' AND EXISTS (
        SELECT 1 FROM platform.role_bundle_versions b
        JOIN platform.role_bundle_permissions bp ON bp.bundle_id = b.id AND bp.bundle_role = b.role
        WHERE b.id = m.current_bundle_id AND b.role = 'student' AND b.status = 'published'
          AND bp.permission_key = p_permission_key))
    )
  FOR UPDATE OF p, m, o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Platform upload permission is required' USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION private.message_media_attachment_actor_is_current(
  p_attachment_intent_id UUID
) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE intent_row platform_private.message_media_attachment_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent_row FROM platform_private.message_media_attachment_intents i
    WHERE i.id = p_attachment_intent_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  PERFORM 1 FROM platform.organizations o WHERE o.id = intent_row.organization_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  PERFORM 1 FROM platform.profiles p WHERE p.id = intent_row.actor_profile_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  PERFORM 1 FROM platform.organization_memberships m
    WHERE m.organization_id = intent_row.organization_id AND m.id = intent_row.actor_membership_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  PERFORM 1 FROM platform_private.message_media_attachment_intents i
    WHERE i.id=intent_row.id AND i.organization_id=intent_row.organization_id
      AND i.actor_profile_id=intent_row.actor_profile_id
      AND i.actor_membership_id=intent_row.actor_membership_id
      AND i.actor_auth_user_id=intent_row.actor_auth_user_id
      AND i.actor_access_version=intent_row.actor_access_version
      AND i.student_case_id=intent_row.student_case_id AND i.conversation_id=intent_row.conversation_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM platform_private.staff_membership_identity(
      intent_row.organization_id, intent_row.actor_membership_id) i
    JOIN platform.student_cases c ON c.organization_id = i.organization_id AND c.id = intent_row.student_case_id
    JOIN platform.communication_conversations conversation
      ON conversation.organization_id = c.organization_id AND conversation.id = intent_row.conversation_id
      AND conversation.student_case_id=c.id
    WHERE i.profile_id = intent_row.actor_profile_id AND i.auth_user_id = intent_row.actor_auth_user_id
      AND i.access_version = intent_row.actor_access_version
      AND c.state IN ('active', 'closed')
      AND platform_private.staff_can_access(i.organization_id, i.membership_id,
        'document.upload', 'student_case', c.id)
      AND platform_private.staff_can_access(i.organization_id, i.membership_id,
        'communication.read.full', 'conversation', conversation.id)
  );
END
$$;

CREATE FUNCTION platform_private.require_current_upload_reservation(
  p_organization_id UUID, p_upload_reservation_id UUID, p_resource_kind TEXT
) RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r RECORD; identity RECORD; profile platform.profiles%ROWTYPE;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
    OR p_resource_kind NOT IN ('student_case', 'company_file') THEN
    RAISE EXCEPTION 'Upload authority is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM platform.organizations o WHERE o.id = p_organization_id FOR KEY SHARE;
  SELECT * INTO r FROM (
    SELECT u.uploader_profile_id profile_id, u.uploader_membership_id membership_id,
      u.uploader_auth_user_id auth_user_id, u.uploader_access_version access_version,
      u.student_case_id resource_id
    FROM platform_private.document_upload_reservations u
    WHERE p_resource_kind = 'student_case' AND u.organization_id = p_organization_id AND u.id = p_upload_reservation_id
    UNION ALL
    SELECT u.uploader_profile_id, u.uploader_membership_id, u.uploader_auth_user_id,
      u.uploader_access_version, u.company_file_id
    FROM platform_private.company_file_upload_reservations u
    WHERE p_resource_kind = 'company_file' AND u.organization_id = p_organization_id AND u.id = p_upload_reservation_id
  ) reservation;
  IF NOT FOUND OR r.access_version IS NULL THEN
    RAISE EXCEPTION 'Upload authority changed; start a new upload' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO profile FROM platform.profiles p WHERE p.id = r.profile_id FOR SHARE;
  PERFORM 1 FROM platform.organization_memberships m
    WHERE m.organization_id = p_organization_id AND m.id = r.membership_id FOR SHARE;
  IF NOT FOUND OR profile.status <> 'active' OR profile.auth_user_id IS DISTINCT FROM r.auth_user_id
    OR profile.access_version IS DISTINCT FROM r.access_version THEN
    RAISE EXCEPTION 'Upload authority changed; start a new upload' USING ERRCODE = '42501';
  END IF;
  IF platform_private.staff_can_access(p_organization_id, r.membership_id,
    CASE WHEN p_resource_kind = 'company_file' THEN 'company.file.upload' ELSE 'document.upload' END,
    p_resource_kind, r.resource_id) THEN RETURN; END IF;
  -- Original Student owner path only; no staff can enter through this branch.
  IF p_resource_kind = 'student_case' AND EXISTS (
    SELECT 1 FROM platform.organization_memberships m
    JOIN platform.organizations o ON o.id = m.organization_id AND o.status = 'active'
    JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id AND b.role = 'student' AND b.status = 'published'
    JOIN platform.role_bundle_permissions bp ON bp.bundle_id = b.id AND bp.bundle_role = b.role AND bp.permission_key = 'document.upload'
    JOIN platform.student_cases c ON c.organization_id = m.organization_id AND c.id = r.resource_id
      AND c.student_membership_id = m.id AND c.state IN ('active', 'closed') AND c.portal_activated_at IS NOT NULL
    WHERE m.organization_id = p_organization_id AND m.id = r.membership_id
      AND m.profile_id = r.profile_id AND m.status = 'active' AND m."current_role" = 'student'
      AND platform_private.membership_has_active_scope(p_organization_id, m.id, 'student_case', c.id)
  ) THEN RETURN; END IF;
  RAISE EXCEPTION 'Upload authority changed; start a new upload' USING ERRCODE = '42501';
END
$$;
REVOKE ALL ON FUNCTION platform_private.require_current_upload_reservation(UUID,UUID,TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.staff_workspace_participants(p_organization_id UUID)
RETURNS TABLE(membership_id UUID, display_name TEXT, platform_role platform.business_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.current_actor_authority() a
    JOIN LATERAL platform_private.staff_membership_identity(a.organization_id, a.membership_id) i ON TRUE
    WHERE a.organization_id = p_organization_id AND EXISTS (
      SELECT 1 FROM unnest(ARRAY['staff.task.read','staff.task.create','staff.task.edit',
        'staff.task.complete','membership.read']) permission(key)
      WHERE platform_private.staff_has_permission(a.organization_id,a.membership_id,permission.key))) THEN
    RAISE EXCEPTION 'staff_workspace_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT i.membership_id, i.display_name, i.coarse_role
  FROM platform.organization_memberships m
  JOIN LATERAL platform_private.staff_membership_identity(m.organization_id, m.id) i ON TRUE
  WHERE m.organization_id = p_organization_id
  ORDER BY lower(i.display_name), i.membership_id;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.is_eligible_staff_responsibility(
  p_organization_id UUID, p_membership_id UUID, p_required_role TEXT
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  -- Responsibility labels are retained for current callers, not business
  -- roles. Commands also evaluate the concrete future assignment below.
  SELECT CASE p_required_role
    WHEN 'sales' THEN platform_private.staff_has_permission(p_organization_id, p_membership_id, 'lead.read')
      AND platform_private.staff_has_permission(p_organization_id, p_membership_id, 'lead.sales.workflow.manage')
    WHEN 'curator' THEN platform_private.staff_has_permission(p_organization_id, p_membership_id, 'case.read.full')
      AND platform_private.staff_has_permission(p_organization_id, p_membership_id, 'task.manage')
    ELSE FALSE END
$$;

CREATE OR REPLACE FUNCTION platform_private.sales_register_actor(p_organization_id UUID)
RETURNS TABLE(auth_user_id UUID, profile_id UUID, membership_id UUID, platform_role platform.business_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT a.auth_user_id, a.profile_id, a.membership_id, a.platform_role
  FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id AND EXISTS (
    SELECT 1 FROM unnest(ARRAY['sales.register.read','sales.register.manage',
      'sales.register.import','sales.register.target.manage']) AS permission(key)
    WHERE platform_private.staff_has_permission(a.organization_id, a.membership_id, permission.key));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_live_task_assignee(
  p_organization_id UUID, p_membership_id UUID
) RETURNS TABLE(assignee_profile_id UUID, assignee_role platform.business_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM platform.organizations WHERE id = p_organization_id FOR SHARE;
  PERFORM p.id FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
    WHERE m.organization_id = p_organization_id AND m.id = p_membership_id FOR SHARE OF p;
  PERFORM m.id FROM platform.organization_memberships m
    WHERE m.organization_id = p_organization_id AND m.id = p_membership_id FOR SHARE;
  RETURN QUERY SELECT i.profile_id, i.coarse_role
  FROM platform_private.staff_membership_identity(p_organization_id, p_membership_id) i
  WHERE platform_private.staff_has_permission(p_organization_id, p_membership_id, 'task.manage')
    OR platform_private.staff_has_permission(p_organization_id, p_membership_id, 'task.create');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Live task assignee is required' USING ERRCODE = '22023';
  END IF;
END
$$;

CREATE FUNCTION platform_private.require_case_task_assignee(
  p_organization_id UUID, p_membership_id UUID, p_student_case_id UUID
) RETURNS TABLE(assignee_profile_id UUID, assignee_role platform.business_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE assignee RECORD;
BEGIN
  SELECT * INTO assignee FROM platform_private.require_live_task_assignee(p_organization_id, p_membership_id);
  IF NOT platform_private.staff_can_access(p_organization_id, p_membership_id,
    'case.read.full', 'student_case', p_student_case_id)
    OR NOT (platform_private.staff_can_receive_assignment(p_organization_id, p_membership_id,
      'task.manage', 'student_case', p_student_case_id)
      OR platform_private.staff_can_receive_assignment(p_organization_id, p_membership_id,
        'task.create', 'student_case', p_student_case_id)) THEN
    RAISE EXCEPTION 'Case task assignee is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT assignee.assignee_profile_id, assignee.assignee_role;
END
$$;
REVOKE ALL ON FUNCTION platform_private.require_case_task_assignee(UUID,UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform_private.case_workspace_assignees(p_organization_id UUID, p_student_case_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('membership_id', i.membership_id,
    'display_name', i.display_name, 'role', i.coarse_role) ORDER BY lower(i.display_name), i.membership_id), '[]'::JSONB)
  FROM platform.organization_memberships m
  JOIN LATERAL platform_private.staff_membership_identity(m.organization_id, m.id) i ON TRUE
  WHERE m.organization_id = p_organization_id
    AND platform_private.staff_can_access(p_organization_id, m.id, 'case.read.full', 'student_case', p_student_case_id)
    AND (platform_private.staff_can_receive_assignment(p_organization_id, m.id, 'task.manage', 'student_case', p_student_case_id)
      OR platform_private.staff_can_receive_assignment(p_organization_id, m.id, 'task.create', 'student_case', p_student_case_id))
$$;
REVOKE ALL ON FUNCTION platform_private.case_workspace_assignees(UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Existing task recipients retain case-workspace eligibility or receive this
-- specific task through the canonical prospective scoped evaluator. Creation
-- and coverage eligibility for an entire case are unchanged.
CREATE FUNCTION platform_private.selected_case_task_recipient_eligible(
  p_organization_id UUID, p_membership_id UUID, p_student_case_id UUID, p_case_task_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.case_tasks AS task
    JOIN platform_private.staff_membership_identity(p_organization_id, p_membership_id) AS i ON TRUE
    WHERE task.organization_id = p_organization_id
      AND task.id = p_case_task_id AND task.student_case_id = p_student_case_id
      AND (
        (platform_private.staff_can_access(p_organization_id, p_membership_id,
          'case.read.full', 'student_case', p_student_case_id)
          AND (platform_private.staff_can_receive_assignment(p_organization_id, p_membership_id,
            'task.manage', 'student_case', p_student_case_id)
            OR platform_private.staff_can_receive_assignment(p_organization_id, p_membership_id,
              'task.create', 'student_case', p_student_case_id)))
        OR platform_private.staff_can_receive_assignment(p_organization_id, p_membership_id,
          'task.manage', 'task', p_case_task_id)
      )
  )
$$;
REVOKE ALL ON FUNCTION platform_private.selected_case_task_recipient_eligible(UUID,UUID,UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform_private.require_selected_case_task_assignee(
  p_organization_id UUID, p_membership_id UUID, p_student_case_id UUID, p_case_task_id UUID
) RETURNS TABLE(assignee_profile_id UUID, assignee_role platform.business_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE assignee RECORD;
BEGIN
  SELECT * INTO assignee FROM platform_private.require_live_task_assignee(p_organization_id, p_membership_id);
  IF NOT platform_private.selected_case_task_recipient_eligible(
    p_organization_id, p_membership_id, p_student_case_id, p_case_task_id) THEN
    RAISE EXCEPTION 'Case task assignee is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT assignee.assignee_profile_id, assignee.assignee_role;
END
$$;
REVOKE ALL ON FUNCTION platform_private.require_selected_case_task_assignee(UUID,UUID,UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Decision12: the queue and target expose the same task projection. A selected
-- task does not authorize reading the case profile or its other tasks.
CREATE FUNCTION platform.staff_case_task_target(
  p_organization_id UUID, p_student_case_id UUID, p_case_task_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; task_json JSONB; assignees JSONB; can_assign BOOLEAN;
  current_assignee_role platform.business_role;
BEGIN
  SELECT a.organization_id, a.membership_id INTO actor
  FROM platform.current_actor_authority() AS a
  JOIN platform_private.staff_membership_identity(a.organization_id, a.membership_id) AS i ON TRUE
  WHERE a.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case task is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'sort_at', CASE
      WHEN task.due_at IS NOT NULL THEN task.due_at
      WHEN task.due_on IS NOT NULL THEN task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ END,
    'organization_id', task.organization_id,
    'case_task_id', task.id,
    'version', task.version::TEXT,
    'student_case_id', task.student_case_id,
    'student_display_name', student_case.student_display_name,
    'case_state', student_case.state,
    'task_type', task.task_type,
    'title', task.title,
    'status', task.status,
    'priority', task.priority,
    'due_on', task.due_on,
    'due_at', task.due_at,
    'student_visible', task.student_visible,
    'assignee_membership_id', task.assignee_membership_id,
    'assignee_display_name', assignee_profile.display_name,
    'created_at', task.created_at,
    'updated_at', task.updated_at
  ) INTO task_json
  FROM platform.case_tasks AS task
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = task.organization_id AND student_case.id = task.student_case_id
  JOIN platform.organization_memberships AS assignee_membership
    ON assignee_membership.organization_id = task.organization_id AND assignee_membership.id = task.assignee_membership_id
  JOIN platform.profiles AS assignee_profile ON assignee_profile.id = assignee_membership.profile_id
  WHERE task.organization_id = actor.organization_id
    AND task.student_case_id = p_student_case_id AND task.id = p_case_task_id
    AND student_case.state IN ('active', 'closed') AND student_case.handoff_at IS NOT NULL
    AND platform_private.staff_can_access(actor.organization_id, actor.membership_id,
      'task.manage', 'task', task.id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case task is unavailable' USING ERRCODE = '42501';
  END IF;

  can_assign := platform_private.staff_can_access(actor.organization_id, actor.membership_id,
    'task.assign', 'student_case', p_student_case_id);
  IF NOT can_assign THEN
    -- Informational current assignee, not an eligibility bypass. The command
    -- rechecks the live recipient even when assignment is unchanged.
    SELECT i.coarse_role INTO current_assignee_role
    FROM platform_private.staff_membership_identity(actor.organization_id,
      (task_json->>'assignee_membership_id')::UUID) AS i;
    assignees := jsonb_build_array(jsonb_build_object(
      'membership_id', task_json->>'assignee_membership_id',
      'display_name', task_json->>'assignee_display_name', 'role', current_assignee_role));
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('membership_id', i.membership_id,
      'display_name', i.display_name, 'role', i.coarse_role)
      ORDER BY lower(i.display_name), i.membership_id), '[]'::JSONB) INTO assignees
    FROM platform.organization_memberships AS m
    JOIN platform_private.staff_membership_identity(m.organization_id, m.id) AS i ON TRUE
    WHERE m.organization_id = actor.organization_id
      AND platform_private.selected_case_task_recipient_eligible(
        actor.organization_id, m.id, p_student_case_id, p_case_task_id)
      -- Match the existing command's coverage restriction for this status.
      AND (task_json->>'status' NOT IN ('open', 'in_progress', 'blocked')
        OR NOT EXISTS (SELECT 1 FROM platform_private.case_curator_coverages AS coverage
          WHERE coverage.organization_id = actor.organization_id AND coverage.student_case_id = p_student_case_id)
        OR i.system_role = 'admin'
        OR EXISTS (SELECT 1 FROM platform.student_cases AS student_case
          WHERE student_case.organization_id = actor.organization_id AND student_case.id = p_student_case_id
            AND student_case.current_curator_membership_id = m.id));
    IF jsonb_array_length(assignees) > 100 THEN
      RAISE EXCEPTION 'Case task recipient list exceeds the supported limit' USING ERRCODE = '54000';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1, 'organizationId', actor.organization_id,
    'studentCaseId', p_student_case_id, 'task', task_json, 'assignees', assignees,
    'capabilities', jsonb_build_object('canAssign', can_assign,
      'canChangeVisibility', platform_private.staff_can_access(actor.organization_id, actor.membership_id,
        'task.visibility.manage', 'student_case', p_student_case_id),
      'canReadCase', platform_private.staff_can_access(actor.organization_id, actor.membership_id,
        'case.read.full', 'student_case', p_student_case_id)));
END
$$;
REVOKE ALL ON FUNCTION platform.staff_case_task_target(UUID,UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_task_target(UUID,UUID,UUID) TO authenticated;

CREATE FUNCTION platform_private.require_case_assignment_operator_locked(
  p_organization_id UUID, p_student_case_id UUID
) RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM platform_private.require_case_operator(
    p_organization_id, p_student_case_id, 'case.curator.assign');
END
$$;
REVOKE ALL ON FUNCTION platform_private.require_case_assignment_operator_locked(UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.staff_notification_visible(n platform.staff_notifications)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.current_actor_authority() a
    WHERE a.organization_id = n.organization_id AND a.membership_id = n.recipient_membership_id
      AND a.platform_role IS DISTINCT FROM 'student' AND (
        (n.staff_task_id IS NOT NULL AND platform_private.staff_can_access(
          n.organization_id, a.membership_id, 'staff.task.read', 'staff_task', n.staff_task_id))
        OR (n.message_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM platform.team_chat_messages m
          WHERE m.organization_id = n.organization_id AND m.id = n.message_id
            AND m.deleted_at IS NULL AND a.membership_id = ANY(m.mentioned_membership_ids)
            AND platform_private.team_chat_can_access(n.organization_id, m.channel_key)))
        OR (n.kind = 'case_help' AND platform_private.staff_can_access(
          n.organization_id, a.membership_id, 'case.read.full', 'student_case', n.student_case_id))
      )
  )
$$;

CREATE FUNCTION platform.team_chat_participants(p_organization_id UUID, p_channel_key TEXT)
RETURNS TABLE(membership_id UUID, display_name TEXT, platform_role platform.business_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT platform_private.team_chat_can_access(p_organization_id, p_channel_key) THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT i.membership_id, i.display_name, i.coarse_role
  FROM platform.organization_memberships m
  JOIN LATERAL platform_private.staff_membership_identity(m.organization_id, m.id) i ON TRUE
  WHERE m.organization_id = p_organization_id AND platform_private.staff_can_access(
    m.organization_id, m.id, 'team.chat.' || p_channel_key, 'organization', m.organization_id)
  ORDER BY lower(i.display_name), i.membership_id;
END
$$;

CREATE FUNCTION platform.staff_task_assignees(p_organization_id UUID, p_staff_task_id UUID DEFAULT NULL)
RETURNS TABLE(membership_id UUID, display_name TEXT, platform_role platform.business_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (
    (p_staff_task_id IS NULL AND platform_private.staff_can_access_for_actor(
      p_organization_id, 'staff.task.create', 'organization', p_organization_id))
    OR (p_staff_task_id IS NOT NULL AND platform_private.staff_can_access_for_actor(
      p_organization_id, 'staff.task.read', 'staff_task', p_staff_task_id))
  ) THEN
    RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT i.membership_id, i.display_name, i.coarse_role
  FROM platform.organization_memberships m
  JOIN LATERAL platform_private.staff_membership_identity(m.organization_id, m.id) i ON TRUE
  WHERE m.organization_id = p_organization_id
    AND platform_private.staff_can_receive_assignment(m.organization_id, m.id,
      'staff.task.complete', 'staff_task', p_staff_task_id)
    AND platform_private.staff_can_receive_assignment(m.organization_id, m.id,
      'staff.task.read', 'staff_task', p_staff_task_id)
  ORDER BY lower(i.display_name), i.membership_id;
END
$$;
REVOKE ALL ON FUNCTION platform.team_chat_participants(UUID,TEXT), platform.staff_task_assignees(UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.team_chat_participants(UUID,TEXT), platform.staff_task_assignees(UUID,UUID)
  TO authenticated;

ALTER POLICY staff_tasks_read ON platform.staff_tasks USING (
  private.platform_staff_can_access(organization_id, 'staff.task.read', 'staff_task', id)
);

-- Amend exact current bodies instead of restoring obsolete signatures or
-- losing later business additions (including 147's task completion result).
-- Every anchor is explicit; drift aborts the transaction rather than silently
-- skipping an authorization consumer. The helper is removed before commit.
CREATE FUNCTION pg_temp.evo_s2_replace(p_signature TEXT, p_before TEXT, p_after TEXT,
  p_expected INTEGER DEFAULT 1) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; revised TEXT; occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(p_signature::regprocedure) INTO body;
  occurrences := (length(body) - length(replace(body, p_before, ''))) / length(p_before);
  IF occurrences <> p_expected THEN
    RAISE EXCEPTION 's2_consumer_anchor_mismatch: % (% instead of %)',
      p_signature, occurrences, p_expected;
  END IF;
  revised := replace(body, p_before, p_after);
  EXECUTE revised;
END
$$;

-- Keep each historical projection byte-for-byte except its authority predicate.
-- Case help already resolves exact case access before listing requests. A null
-- staff description must not hide rows behind the Student-only ownership filter.
DO $scoped_case_help_reads$
BEGIN
  PERFORM pg_temp.evo_s2_replace(
    'platform.case_help_workspace_v1(uuid,timestamp with time zone,uuid)',
    $$a.platform_role<>'student'$$,
    $$a.platform_role IS DISTINCT FROM 'student'$$);
END
$scoped_case_help_reads$;

-- Full finance access is sufficient for its selected case; the summary branch
-- retains its separate case-read prerequisite and pairs both keys to that case.
DO $scoped_finance_reads$
DECLARE spec RECORD; body TEXT;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('platform.staff_case_finance_control(uuid,integer)', '1bcf050aef1215779fa90f0ba09aa770'),
    ('platform.staff_finance_control_queue(integer,uuid[])', 'bb9e645f9a1250599766066892ada88b')
  ) AS definitions(signature, expected_md5) LOOP
    SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid = spec.signature::regprocedure;
    IF md5(body) <> spec.expected_md5 THEN
      RAISE EXCEPTION 'Unexpected scoped finance read definition: %', spec.signature;
    END IF;
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('platform.staff_case_finance_control(uuid,integer)',
    $$    AND (
      private.platform_can_read_finance_full(
        student_case.organization_id
      )
      OR (
        private.platform_can_read_student_case(
          student_case.organization_id,
          student_case.id
        )
        AND private.platform_has_permission(
          student_case.organization_id,
          'finance.read.summary'
        )
      )
    )$$,
    $$    AND (
      platform_private.staff_can_access_for_actor(
        student_case.organization_id, 'finance.read.full', 'student_case', student_case.id
      )
      OR (
        private.platform_can_read_student_case(
          student_case.organization_id, student_case.id
        )
        AND platform_private.staff_can_access_for_actor(
          student_case.organization_id, 'finance.read.summary', 'student_case', student_case.id
        )
      )
    )$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_finance_control_queue(integer,uuid[])',
    $$    AND (
      private.platform_can_read_finance_full(
        obligation.organization_id
      )
      OR (
        private.platform_can_read_student_case(
          obligation.organization_id,
          obligation.student_case_id
        )
        AND private.platform_has_permission(
          obligation.organization_id,
          'finance.read.summary'
        )
      )
    )$$,
    $$    AND (
      platform_private.staff_can_access_for_actor(
        obligation.organization_id, 'finance.read.full', 'student_case', obligation.student_case_id
      )
      OR (
        private.platform_can_read_student_case(
          obligation.organization_id, obligation.student_case_id
        )
        AND platform_private.staff_can_access_for_actor(
          obligation.organization_id, 'finance.read.summary', 'student_case', obligation.student_case_id
        )
      )
    )$$);
END
$scoped_finance_reads$;

DO $migration$
DECLARE task_command CONSTANT TEXT := 'platform.mutate_staff_task(uuid,text,uuid,bigint,uuid,text,uuid,text,platform.case_task_status,platform.case_task_priority,date,timestamp with time zone)';
  task_list CONSTANT TEXT := 'platform.staff_task_list(uuid,text,text,timestamp with time zone,uuid,uuid,integer)';
BEGIN
  PERFORM pg_temp.evo_s2_replace(task_command,
    $$a.platform_role IN ('admin', 'sales', 'curator')$$,
    $$a.platform_role IS DISTINCT FROM 'student'$$);
  PERFORM pg_temp.evo_s2_replace(task_command,
    $$  payload := jsonb_build_object('operation', p_operation,$$,
    $$  IF p_operation = 'create' AND NOT platform_private.staff_can_access(
      p_organization_id, actor.membership_id, 'staff.task.create', 'organization', p_organization_id)
    THEN RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE = '42501'; END IF;
  payload := jsonb_build_object('operation', p_operation,$$);
  PERFORM pg_temp.evo_s2_replace(task_command,
    $$IF NOT FOUND OR (actor.platform_role <> 'admin'
      AND actor.membership_id NOT IN (task_row.creator_membership_id, task_row.assignee_membership_id))$$,
    $$IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id,
      actor.membership_id, 'staff.task.read', 'staff_task', task_row.id)$$);
  PERFORM pg_temp.evo_s2_replace(task_command,
    $$IF p_operation = 'edit' AND actor.platform_role <> 'admin' AND actor.membership_id <> task_row.creator_membership_id$$,
    $$IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
      CASE WHEN p_operation = 'status' THEN 'staff.task.complete' ELSE 'staff.task.edit' END,
      'staff_task', task_row.id)$$);
  PERFORM pg_temp.evo_s2_replace(task_command,
    $$m.status = 'active' AND p.status = 'active' AND m."current_role" IN ('admin', 'sales', 'curator')$$,
    $$m.status = 'active' AND p.status = 'active'
      AND platform_private.staff_can_receive_assignment(p_organization_id, m.id,
        'staff.task.complete', 'staff_task', task_row.id)
      AND platform_private.staff_can_receive_assignment(p_organization_id, m.id,
        'staff.task.read', 'staff_task', task_row.id)$$);
  PERFORM pg_temp.evo_s2_replace(task_command,
    $$IF NOT FOUND OR (actor.platform_role <> 'admin' AND assignee.role <> actor.platform_role)$$,
    $$IF NOT FOUND$$);
  PERFORM pg_temp.evo_s2_replace(task_list,
    $$a.platform_role IN ('admin', 'sales', 'curator')$$,
    $$platform_private.staff_has_permission(a.organization_id, a.membership_id, 'staff.task.read')$$);
  PERFORM pg_temp.evo_s2_replace(task_list,
    $$(actor.platform_role = 'admin' OR actor.membership_id IN (t.creator_membership_id, t.assignee_membership_id))$$,
    $$platform_private.staff_can_access(t.organization_id, actor.membership_id,
      'staff.task.read', 'staff_task', t.id)$$);
END
$migration$;

DO $migration$
DECLARE signature TEXT; original TEXT; anchor TEXT;
BEGIN
  -- These roots independently enforce the case, task and/or channel predicate
  -- below. Only their former coarse staff-presence allowlist is removed.
  FOREACH signature IN ARRAY ARRAY[
    'platform.create_staff_task_from_chat(uuid,uuid,uuid,bigint,text,uuid,text,platform.case_task_priority,date,timestamp with time zone)',
    'platform.team_chat_task_links(uuid,uuid[])',
    'platform.staff_task_chat_source(uuid,uuid)',
    'platform.create_staff_task_from_lead(uuid,uuid,uuid,bigint,text,uuid,text,platform.case_task_priority,date,timestamp with time zone)',
    'platform.complete_staff_task_with_result(uuid,uuid,uuid,bigint,text)',
    'platform.staff_task_context(uuid,uuid)',
    'platform.staff_task_lead_context(uuid,uuid)',
    'platform.lead_staff_task_links(uuid,uuid)',
    'platform.staff_notifications_page(uuid,timestamp with time zone,uuid)'
  ] LOOP
    SELECT pg_get_functiondef(signature::regprocedure) INTO original;
    anchor := CASE
      WHEN position($$a.platform_role IN ('admin','sales','curator')$$ IN original) > 0
        THEN $$a.platform_role IN ('admin','sales','curator')$$
      WHEN position($$a.platform_role IN('admin','sales','curator')$$ IN original) > 0
        THEN $$a.platform_role IN('admin','sales','curator')$$
      ELSE NULL END;
    IF anchor IS NULL THEN RAISE EXCEPTION 's2_consumer_staff_anchor_missing: %', signature; END IF;
    PERFORM pg_temp.evo_s2_replace(signature, anchor, $$a.platform_role IS DISTINCT FROM 'student'$$);
  END LOOP;

  FOREACH signature IN ARRAY ARRAY[
    'platform.team_chat_task_links(uuid,uuid[])',
    'platform.create_staff_task_from_lead(uuid,uuid,uuid,bigint,text,uuid,text,platform.case_task_priority,date,timestamp with time zone)',
    'platform.complete_staff_task_with_result(uuid,uuid,uuid,bigint,text)',
    'platform.staff_task_context(uuid,uuid)',
    'platform.lead_staff_task_links(uuid,uuid)'
  ] LOOP
    SELECT pg_get_functiondef(signature::regprocedure) INTO original;
    anchor := CASE
      WHEN position($$(actor.platform_role = 'admin' OR actor.membership_id IN (t.creator_membership_id, t.assignee_membership_id))$$ IN original) > 0
        THEN $$(actor.platform_role = 'admin' OR actor.membership_id IN (t.creator_membership_id, t.assignee_membership_id))$$
      ELSE $$(actor.platform_role='admin' OR actor.membership_id IN(t.creator_membership_id,t.assignee_membership_id))$$ END;
    PERFORM pg_temp.evo_s2_replace(signature, anchor,
      $$platform_private.staff_can_access(t.organization_id, actor.membership_id, 'staff.task.read', 'staff_task', t.id)$$);
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('platform.staff_task_chat_source(uuid,uuid)',
    $$(a.platform_role = 'admin' OR a.membership_id IN (t.creator_membership_id, t.assignee_membership_id))$$,
    $$platform_private.staff_can_access(t.organization_id, a.membership_id, 'staff.task.read', 'staff_task', t.id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.create_staff_task_from_chat(uuid,uuid,uuid,bigint,text,uuid,text,platform.case_task_priority,date,timestamp with time zone)',
    $$(actor.platform_role = 'admin'
        OR actor.membership_id IN (t.creator_membership_id, t.assignee_membership_id))$$,
    $$platform_private.staff_can_access(t.organization_id, actor.membership_id, 'staff.task.read', 'staff_task', t.id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_task_lead_context(uuid,uuid)',
    $$actor.platform_role IN('admin','sales') AND l.lifecycle_state='open'$$,
    $$platform_private.staff_can_access(l.organization_id, actor.membership_id, 'lead.read', 'lead', l.id) AND l.lifecycle_state='open'$$);

  PERFORM pg_temp.evo_s2_replace('platform.team_chat_channels(uuid)',
    $$actor.platform_role NOT IN ('admin', 'sales', 'curator')$$,
    $$actor.platform_role = 'student'$$);
  PERFORM pg_temp.evo_s2_replace('platform.team_chat_command(uuid,text,uuid,jsonb)',
    $$        JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id AND b.role = m.current_role
$$, '');
  PERFORM pg_temp.evo_s2_replace('platform.team_chat_command(uuid,text,uuid,jsonb)',
    $$AND m.status = 'active' AND p.status = 'active' AND b.status = 'published'
          AND m.current_role IN ('admin', 'sales', 'curator')
          AND (p_channel_key = 'general' OR m.current_role = 'admin'
            OR (p_channel_key = 'sales' AND m.current_role = 'sales')
            OR (p_channel_key = 'admissions' AND m.current_role = 'curator'))$$,
    $$AND platform_private.staff_can_access(p_organization_id, m.id,
          'team.chat.' || p_channel_key, 'organization', p_organization_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.team_chat_command(uuid,text,uuid,jsonb)',
    $$operation = 'moderate' AND actor.platform_role <> 'admin'$$,
    $$operation = 'moderate' AND NOT platform_private.staff_can_access(p_organization_id,
      actor.membership_id, 'team.chat.moderate', 'organization', p_organization_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform_private.check_staff_task_source()',
    $$IF NOT FOUND OR assignee_role NOT IN ('admin', 'sales', 'curator')
      OR (channel = 'sales' AND assignee_role NOT IN ('admin', 'sales'))
      OR (channel = 'admissions' AND assignee_role NOT IN ('admin', 'curator'))$$,
    $$IF NOT FOUND OR NOT platform_private.staff_can_access(NEW.organization_id,
      NEW.assignee_membership_id, 'team.chat.' || channel, 'organization', NEW.organization_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform_private.notify_staff_task_event()',
    $$m.current_role IN ('admin','sales','curator')$$,
    $$platform_private.staff_can_access(NEW.organization_id, m.id, 'staff.task.read', 'staff_task', task_row.id)$$);
  PERFORM pg_temp.evo_s2_replace('platform_private.notify_staff_chat_mention()',
    $$m.current_role IN ('admin','sales','curator') AND $$, '');
  PERFORM pg_temp.evo_s2_replace('platform_private.notify_staff_chat_mention()',
    $$(NEW.channel_key = 'general' OR m.current_role = 'admin'
        OR (NEW.channel_key = 'sales' AND m.current_role = 'sales')
        OR (NEW.channel_key = 'admissions' AND m.current_role = 'curator'))$$,
    $$platform_private.staff_can_access(NEW.organization_id, m.id,
      'team.chat.' || NEW.channel_key, 'organization', NEW.organization_id)$$);
END
$migration$;

DO $migration$
DECLARE signature TEXT; permission TEXT;
BEGIN
  FOR signature, permission IN SELECT * FROM (VALUES
    ('platform.create_payment_obligation(uuid,uuid,text,platform.obligation_category,bigint,text,timestamp with time zone,text,text,uuid)', 'finance.manage'),
    ('platform.record_payment_event(uuid,uuid,platform.payment_event_type,uuid,bigint,text,timestamp with time zone,text,text,text,uuid)', 'finance.event.confirm'),
    ('platform.resolve_case_stop_factor(uuid,uuid,uuid,platform.stop_factor_resolution_kind,uuid,text,text,bigint,uuid)', 'finance.stop.manage'),
    ('platform.settle_payment_obligation(uuid,uuid,uuid,text,text,text,uuid)', 'finance.event.confirm')
  ) AS patches(signature,permission) LOOP
    PERFORM pg_temp.evo_s2_replace(signature,
      'platform_private.require_finance_actor(' || E'\n    p_organization_id,\n    ' || quote_literal(permission) || E'\n  )',
      'platform_private.require_case_operator(p_organization_id, p_student_case_id, ' || quote_literal(permission) || ')', 2);
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('platform.resolve_case_stop_factor(uuid,uuid,uuid,platform.stop_factor_resolution_kind,uuid,text,text,bigint,uuid)',
    $$IF actor.actor_role <> 'admin' THEN$$,
    $$IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
      'finance.stop.manage', 'student_case', p_student_case_id) THEN$$, 2);
  PERFORM pg_temp.evo_s2_replace('platform.staff_monthly_payment_summary(uuid,integer,integer)',
    $$a.platform_role='admin'$$,
    $$platform_private.staff_can_access(a.organization_id, a.membership_id,
      'finance.read.full', 'organization', a.organization_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_finance_entry_workspace(uuid)',
    $$actor.platform_role NOT IN ('admin','curator')$$,
    $$NOT platform_private.staff_can_access(actor.organization_id, actor.membership_id,
      'case.read.full', 'student_case', p_student_case_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_finance_entry_workspace(uuid)',
    $$private.platform_can_read_finance_full(actor.organization_id)$$,
    $$platform_private.staff_can_access(actor.organization_id, actor.membership_id,
      'finance.read.full', 'student_case', p_student_case_id)$$);
  FOREACH permission IN ARRAY ARRAY['finance.manage','finance.event.confirm'] LOOP
    PERFORM pg_temp.evo_s2_replace('platform.staff_finance_entry_workspace(uuid)',
      'private.platform_has_permission(actor.organization_id,' || quote_literal(permission) || E')\n      AND private.platform_has_scope(actor.organization_id,''organization'',actor.organization_id)',
      'platform_private.staff_can_access(actor.organization_id, actor.membership_id, ' || quote_literal(permission) || ', ''student_case'', p_student_case_id)',
      CASE WHEN permission = 'finance.event.confirm' THEN 2 ELSE 1 END);
  END LOOP;
  -- This RPC confirms the explicit personal sensitive grant only. Selected
  -- object mutations separately require their paired action/resource grant.
  PERFORM pg_temp.evo_s2_replace('platform.assert_sensitive_permission(uuid,text)',
    $$ OR NOT private.platform_has_scope(
    p_organization_id,
    'organization',
    p_organization_id
  )$$, '');
END
$migration$;

-- Migration129 is still the current change body after migration133 renamed it.
-- Pin it before any replacement; only target authority and recipient selection
-- change here. The later task.assign/visibility pairs and operational rules stay.
DO $scoped_case_task_target$
DECLARE change_task CONSTANT TEXT := 'platform_private.coverage_change_task_body(uuid,uuid,platform.case_task_status,uuid,platform.case_task_priority,timestamp with time zone,date,boolean,bigint,uuid,text)';
  body TEXT;
BEGIN
  SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid = change_task::regprocedure;
  IF md5(body) <> '16b6a812c50a762e568c1d07e75cb125' THEN
    RAISE EXCEPTION 'Unexpected selected task command definition';
  END IF;
  PERFORM pg_temp.evo_s2_replace(change_task,
    $$  FROM platform_private.require_case_operator(
    p_organization_id, task_row.student_case_id, 'task.manage'
  );$$,
    $$  FROM platform_private.require_domain_actor(p_organization_id, 'task.manage');
  IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
    'task.manage', 'task', task_row.id) THEN
    RAISE EXCEPTION 'Student case task is unavailable' USING ERRCODE = '42501';
  END IF;$$);
  PERFORM pg_temp.evo_s2_replace(change_task,
    $$platform_private.require_live_task_assignee(
    p_organization_id, p_new_assignee_membership_id
  )$$,
    $$platform_private.require_selected_case_task_assignee(p_organization_id, p_new_assignee_membership_id, task_row.student_case_id, task_row.id)$$);
END
$scoped_case_task_target$;

DO $migration$
DECLARE create_task CONSTANT TEXT := 'platform_private.coverage_create_task_body(uuid,uuid,text,text,uuid,platform.case_task_priority,timestamp with time zone,date,platform.case_task_status,boolean,bigint,uuid)';
  change_task CONSTANT TEXT := 'platform_private.coverage_change_task_body(uuid,uuid,platform.case_task_status,uuid,platform.case_task_priority,timestamp with time zone,date,boolean,bigint,uuid,text)';
BEGIN
  PERFORM pg_temp.evo_s2_replace(create_task, $$'task.manage'$$, $$'task.create'$$, 2);
  PERFORM pg_temp.evo_s2_replace(create_task,
    $$platform_private.require_live_task_assignee(
    p_organization_id,
    p_assignee_membership_id
  )$$,
    $$platform_private.require_case_task_assignee(p_organization_id, p_assignee_membership_id, p_student_case_id)$$);
  PERFORM pg_temp.evo_s2_replace(create_task,
    $$IF actor.actor_role <> 'admin'
    AND p_assignee_membership_id <> actor.actor_membership_id$$,
    $$IF p_assignee_membership_id <> actor.actor_membership_id
    AND NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
      'task.assign', 'student_case', p_student_case_id)$$);
  PERFORM pg_temp.evo_s2_replace(change_task,
    $$IF actor.actor_role <> 'admin' AND (
    actor.actor_role <> 'curator'
    OR task_row.assignee_membership_id <> actor.actor_membership_id
    OR p_new_assignee_membership_id <> actor.actor_membership_id
    OR task_row.student_visible <> p_student_visible
  )$$,
    $$IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
      'task.manage', 'task', task_row.id)
    OR (task_row.assignee_membership_id <> p_new_assignee_membership_id AND NOT
      platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
        'task.assign', 'student_case', task_row.student_case_id))
    OR (task_row.student_visible <> p_student_visible AND NOT
      platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
        'task.visibility.manage', 'student_case', task_row.student_case_id))$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_student_case_task_workspace(uuid)',
    $$platform_private.u7_workspace_assignees(actor.organization_id)$$,
    $$platform_private.case_workspace_assignees(actor.organization_id, p_student_case_id)$$);
  PERFORM pg_temp.evo_s2_replace('private.manage_case_coverage(text,uuid,uuid,uuid,bigint,uuid,date,uuid,bigint,jsonb,text,uuid)',
    $$platform_private.require_live_task_assignee(p_organization_id,binding.original_assignee_membership_id)$$,
    $$platform_private.require_case_task_assignee(p_organization_id,binding.original_assignee_membership_id,p_student_case_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform_private.coverage_require_current_task_assignee(uuid,uuid,uuid,platform.case_task_status)',
    $$member."current_role"='curator'$$,
    $$NOT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, member.id) i WHERE i.system_role = 'admin')$$);
END
$migration$;
DROP FUNCTION platform_private.u7_workspace_assignees(UUID);

DO $migration$
DECLARE signature TEXT; permission TEXT;
  staff_branch CONSTANT TEXT := $$      (
        actor.actor_role = 'admin'
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          actor.actor_membership_id,
          'organization',
          p_organization_id
        )
      )
      OR (
        actor.actor_role = 'curator'
        AND student_case.state IN ('active', 'closed')
        AND student_case.current_curator_membership_id IS NOT DISTINCT FROM
          actor.actor_membership_id
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          actor.actor_membership_id,
          'student_case',
          student_case.id
        )
      )$$;
BEGIN
  FOR signature, permission IN SELECT * FROM (VALUES
    ('platform.preflight_document_upload(uuid,uuid,text,text,bigint,text,uuid)', 'document.upload'),
    ('platform.reserve_document_upload_after_ingress_scan(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text,text,timestamp with time zone,uuid)', 'document.upload'),
    ('private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)', 'document.download')
  ) AS patches(signature,permission) LOOP
    PERFORM pg_temp.evo_s2_replace(signature, staff_branch,
      '      platform_private.staff_can_access(p_organization_id, actor.actor_membership_id, '
        || quote_literal(permission) || ', ''student_case'', student_case.id)');
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)',
    replace(replace(substring(staff_branch from 3), E'\n  ', E'\n'), 'student_case.', 'case_row.'),
    $$    platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
      'document.download', 'student_case', case_row.id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.reserve_company_file_upload_after_ingress_scan(uuid,uuid,uuid,bigint,text,text,bigint,text,text,text,text,text,text,timestamp with time zone,uuid)',
    $$IF actor.actor_role NOT IN ('admin', 'curator') THEN$$,
    $$IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
      'company.file.upload', 'company_file', p_company_file_id) THEN$$);
  -- Capture current actor grants before mutable case/file rows and before any
  -- object is published. The existing exact scan/hash and replay logic stays.
  PERFORM pg_temp.evo_s2_replace('platform_private.finalize_document_upload_storage_step(uuid,uuid,uuid)',
    $$  SELECT *
  INTO case_row
  FROM platform.student_cases AS student_case$$,
    $$  PERFORM platform_private.require_current_upload_reservation(
    p_organization_id, p_upload_reservation_id, 'student_case');
  SELECT *
  INTO case_row
  FROM platform.student_cases AS student_case$$);
  PERFORM pg_temp.evo_s2_replace('platform.finalize_company_file_upload(uuid,uuid,text,text,text,text,text,timestamp with time zone,uuid)',
    $$  command_input := jsonb_build_object($$,
    $$  PERFORM platform_private.require_current_upload_reservation(
    p_organization_id, p_upload_reservation_id, 'company_file');
  command_input := jsonb_build_object($$);
END
$migration$;

DO $migration$
DECLARE original TEXT; previous_guard TEXT; start_at INTEGER; end_at INTEGER;
BEGIN
  SELECT pg_get_functiondef('private.consume_document_download_grant_pre_e5(uuid,uuid)'::regprocedure) INTO original;
  start_at := position('  SELECT TRUE' IN original);
  end_at := position('  IF NOT COALESCE(authorization_valid' IN original);
  previous_guard := substring(original FROM start_at FOR end_at - start_at);
  IF md5(previous_guard) <> 'ae0f6569459297cfd0c35b4cc92d9d36' THEN
    RAISE EXCEPTION 's2_document_download_guard_changed';
  END IF;
  PERFORM pg_temp.evo_s2_replace('private.consume_document_download_grant_pre_e5(uuid,uuid)', previous_guard,
    $$  PERFORM 1 FROM platform.organizations o WHERE o.id = download_grant.organization_id FOR KEY SHARE;
  PERFORM 1 FROM platform.profiles p WHERE p.id = download_grant.grantee_profile_id FOR SHARE;
  PERFORM 1 FROM platform.organization_memberships m
    WHERE m.organization_id = download_grant.organization_id AND m.id = download_grant.grantee_membership_id FOR SHARE;
  SELECT TRUE INTO authorization_valid
  FROM platform.profiles AS profile
  JOIN platform.organization_memberships AS membership
    ON membership.organization_id = download_grant.organization_id
    AND membership.id = download_grant.grantee_membership_id AND membership.profile_id = profile.id
  JOIN platform.organizations AS organization ON organization.id = membership.organization_id
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = download_grant.organization_id AND student_case.id = download_grant.student_case_id
  JOIN platform.document_versions AS document_version
    ON document_version.organization_id = download_grant.organization_id
    AND document_version.id = download_grant.document_version_id
    AND document_version.student_case_id = download_grant.student_case_id
    AND document_version.document_slot_id = download_grant.document_slot_id
  WHERE profile.id = download_grant.grantee_profile_id
    AND profile.auth_user_id = download_grant.grantee_auth_user_id AND profile.status = 'active'
    AND profile.access_version = download_grant.grantee_access_version
    AND membership.status = 'active' AND organization.status = 'active'
    AND document_version.integrity_status = 'verified' AND document_version.malware_status = 'clean'
    AND (
      platform_private.staff_can_access(download_grant.organization_id, membership.id,
        'document.download', 'document', download_grant.document_version_id)
      OR (membership."current_role" = 'student'
        AND download_grant.grantee_role = 'student'
        AND student_case.state IN ('active', 'closed') AND student_case.student_membership_id = membership.id
        AND student_case.portal_activated_at IS NOT NULL
        AND platform_private.membership_has_active_scope(download_grant.organization_id, membership.id,
          'student_case', download_grant.student_case_id)
        AND EXISTS (SELECT 1 FROM platform.role_bundle_versions b
          JOIN platform.role_bundle_permissions bp ON bp.bundle_id = b.id AND bp.bundle_role = b.role
          WHERE b.id = membership.current_bundle_id AND b.role = 'student' AND b.status = 'published'
            AND bp.permission_key = 'document.download'))
    )
  FOR UPDATE OF student_case, document_version;

$$);
  SELECT pg_get_functiondef('platform.consume_company_file_download_grant(uuid,uuid,uuid)'::regprocedure) INTO original;
  start_at := position('  IF NOT EXISTS (' IN original);
  end_at := position('  SELECT * INTO STRICT binding' IN original);
  previous_guard := substring(original FROM start_at FOR end_at - start_at);
  IF md5(previous_guard) <> 'bae07d212db963bd5f84fef0f01542fb' THEN
    RAISE EXCEPTION 's2_company_download_guard_changed';
  END IF;
  PERFORM pg_temp.evo_s2_replace('platform.consume_company_file_download_grant(uuid,uuid,uuid)', previous_guard,
    $$  PERFORM 1 FROM platform.organizations o WHERE o.id = grant_row.organization_id FOR KEY SHARE;
  PERFORM 1 FROM platform.profiles p WHERE p.id = grant_row.grantee_profile_id FOR SHARE;
  PERFORM 1 FROM platform.organization_memberships m
    WHERE m.organization_id = grant_row.organization_id AND m.id = grant_row.grantee_membership_id FOR SHARE;
  IF NOT EXISTS (
    SELECT 1 FROM platform_private.staff_membership_identity(grant_row.organization_id, grant_row.grantee_membership_id) i
    WHERE i.profile_id = grant_row.grantee_profile_id AND i.auth_user_id = grant_row.grantee_auth_user_id
      AND i.access_version = grant_row.grantee_access_version
      AND platform_private.staff_can_access(i.organization_id, i.membership_id,
        'company.file.download', 'company_file', grant_row.company_file_id)
  ) THEN
    RAISE EXCEPTION 'Company file access was revoked' USING ERRCODE = '42501';
  END IF;

$$);
END
$migration$;

DO $migration$
DECLARE signature TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'platform_private.mutate_company_file_folder(uuid,uuid,bigint,text,uuid,text,uuid)',
    'platform_private.mutate_company_file(uuid,uuid,bigint,text,uuid,text,uuid)',
    'platform.create_company_file_folder(uuid,uuid,text,uuid)',
    'platform.create_company_file(uuid,uuid,text,uuid)'
  ] LOOP
    PERFORM pg_temp.evo_s2_replace(signature, $$'document.upload'$$, $$'company.file.manage'$$);
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('platform.preflight_company_file_upload(uuid,uuid,bigint,text,text,bigint,text,uuid)',
    $$'document.upload'$$, $$'company.file.upload'$$);
  PERFORM pg_temp.evo_s2_replace('platform.reserve_company_file_upload_after_ingress_scan(uuid,uuid,uuid,bigint,text,text,bigint,text,text,text,text,text,text,timestamp with time zone,uuid)',
    $$'document.upload'$$, $$'company.file.upload'$$);
  PERFORM pg_temp.evo_s2_replace('platform.grant_company_file_download(uuid,uuid,text,integer,uuid)',
    $$'document.download'$$, $$'company.file.download'$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_company_file_workspace(uuid)',
    $$    OR (SELECT auth.jwt() ->> 'platform_role') NOT IN ('admin', 'curator')
    OR NOT private.platform_has_permission(
      p_organization_id,
      'document.download'
    )$$,
    $$    OR NOT platform_private.staff_can_access_for_actor(p_organization_id,
      'company.file.read', 'organization', p_organization_id)$$);
END
$migration$;

DO $migration$
DECLARE assignment_body CONSTANT TEXT := 'platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)';
  coverage CONSTANT TEXT := 'private.manage_case_coverage(text,uuid,uuid,uuid,bigint,uuid,date,uuid,bigint,jsonb,text,uuid)';
BEGIN
  PERFORM pg_temp.evo_s2_replace('private.assign_student_case_curator(uuid,uuid,uuid,text,uuid)',
    $$platform_private.require_admin_actor($$, $$platform_private.require_domain_actor_read($$);
  PERFORM pg_temp.evo_s2_replace('private.assign_student_case_curator(uuid,uuid,uuid,text,uuid)',
    $$platform_private.require_case_assignment_admin_locked(
    p_organization_id
  )$$,
    $$platform_private.require_case_assignment_operator_locked(p_organization_id, p_student_case_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform_private.assign_student_case_curator_body(uuid,uuid,uuid,text,uuid)',
    $$platform_private.require_admin_actor(
    p_organization_id, 'case.curator.assign'
  )$$,
    $$platform_private.require_case_operator(p_organization_id, p_student_case_id, 'case.curator.assign')$$);
  PERFORM pg_temp.evo_s2_replace(coverage,
    $$platform_private.require_admin_actor(p_organization_id, 'case.curator.assign')$$,
    $$platform_private.require_domain_actor_read(p_organization_id, 'case.curator.assign')$$,
    2);
  PERFORM pg_temp.evo_s2_replace(coverage,
    $$platform_private.require_case_assignment_admin_locked(p_organization_id)$$,
    $$platform_private.require_case_assignment_operator_locked(p_organization_id, p_student_case_id)$$);
  PERFORM pg_temp.evo_s2_replace(assignment_body,
    $$  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
$$, '');
  PERFORM pg_temp.evo_s2_replace(assignment_body,
    $$    AND bundle.status = 'published'
  FOR UPDATE OF membership, profile, bundle;$$,
    $$    AND platform_private.staff_can_receive_assignment(p_organization_id, membership.id,
      'case.read.full', 'student_case', p_student_case_id)
    AND platform_private.staff_can_receive_assignment(p_organization_id, membership.id,
      'task.manage', 'student_case', p_student_case_id)
  FOR UPDATE OF membership, profile;$$);
END
$migration$;
DROP FUNCTION platform_private.require_case_assignment_admin_locked(UUID);

DO $migration$
DECLARE manage CONSTANT TEXT := 'private.manage_sales_register_v1(uuid,text,uuid,bigint,jsonb,text,uuid)';
  read_rows CONSTANT TEXT := 'private.read_sales_register_v1(uuid,integer,integer,integer,uuid,boolean,text,text,boolean)';
BEGIN
  PERFORM pg_temp.evo_s2_replace(manage,
    $$IF actor.platform_role='sales' AND NOT EXISTS(SELECT 1 FROM platform_private.sales_register r
     WHERE r.id=(prior.receipt->>'record_id')::UUID AND r.organization_id=p_organization_id AND r.owner_membership_id=actor.membership_id)$$,
    $$IF NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.manage', 'sales_register', (prior.receipt->>'record_id')::UUID)$$);
  PERFORM pg_temp.evo_s2_replace(manage,
    $$(actor.platform_role='sales' AND old.owner_membership_id IS DISTINCT FROM actor.membership_id)$$,
    $$NOT platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.manage', 'sales_register', old.id)$$);
  PERFORM pg_temp.evo_s2_replace(manage,
    $$   IF actor.platform_role='sales' THEN
     IF owner_id IS NOT NULL AND owner_id<>actor.membership_id THEN RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501'; END IF;
     owner_id:=actor.membership_id;
   END IF;$$,
    $$   IF owner_id IS NULL AND NOT platform_private.staff_can_create_for_owner(p_organization_id,
     actor.membership_id, 'sales.register.manage', 'sales_register', NULL) THEN
     owner_id := actor.membership_id;
   END IF;
   IF NOT platform_private.staff_can_create_for_owner(p_organization_id, actor.membership_id,
     'sales.register.manage', 'sales_register', owner_id) THEN
     RAISE EXCEPTION 'sales_register_forbidden' USING ERRCODE='42501';
   END IF;$$);
  PERFORM pg_temp.evo_s2_replace(manage,
    $$platform_private.is_eligible_sales_owner(p_organization_id,owner_id)$$,
    $$platform_private.staff_can_receive_assignment(p_organization_id, owner_id,
      'sales.register.read', 'sales_register', p_record_id)$$);
  PERFORM pg_temp.evo_s2_replace(read_rows,
    $$(actor.platform_role='admin' OR r.owner_membership_id=actor.membership_id)$$,
    $$platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.read', 'sales_register', r.id)$$, 3);
  PERFORM pg_temp.evo_s2_replace(read_rows,
    $$IF actor.platform_role='admin' THEN$$,
    $$IF platform_private.staff_can_access(p_organization_id, actor.membership_id,
      'sales.register.target.manage', 'organization', p_organization_id) THEN$$);
  PERFORM pg_temp.evo_s2_replace(read_rows,
    $$platform_private.is_eligible_sales_owner(p_organization_id,m.id)
   AND (actor.platform_role='admin' OR m.id=actor.membership_id)$$,
    $$platform_private.staff_can_receive_assignment(p_organization_id, m.id, 'sales.register.read', 'sales_register', NULL)
   AND platform_private.staff_can_create_for_owner(p_organization_id, actor.membership_id,
     'sales.register.manage', 'sales_register', m.id)$$);
END
$migration$;

-- These projections return only rows accepted by the same canonical resolver
-- as the direct RLS root; role names no longer form a second visibility path.
DO $migration$
DECLARE spec RECORD; body TEXT; old_tail TEXT;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('platform_private.visible_canonical_clients()', '66ed9b973b741769899a0c55f7f931bc', 'client'),
    ('platform_private.visible_canonical_leads()', '763ead7c28caa95bdd58e02c73abd8e4', 'lead')
  ) AS x(signature, expected_md5, resource_kind) LOOP
    SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid = spec.signature::regprocedure;
    IF md5(body) <> spec.expected_md5 THEN RAISE EXCEPTION 'Unexpected canonical projection: %', spec.signature; END IF;
    old_tail := substring(body FROM position('  WHERE private.platform_has_permission(' IN body));
    PERFORM pg_temp.evo_s2_replace(spec.signature, old_tail,
      format('  WHERE private.platform_can_read_canonical_%1$s(%1$s.organization_id, %1$s.id)%2$s',
        spec.resource_kind, chr(10)));
  END LOOP;
  FOR spec IN SELECT * FROM (VALUES
    ('private.import_sales_register_v1(uuid,uuid,jsonb)', 'sales.register.import'),
    ('private.manage_sales_register_target_v1(uuid,uuid,bigint,date,text,integer,text,uuid)', 'sales.register.target.manage')
  ) AS x(signature, permission_key) LOOP
    PERFORM pg_temp.evo_s2_replace(spec.signature,
      $$actor.platform_role<>'admin'$$,
      format('NOT platform_private.staff_can_access(p_organization_id, actor.membership_id, %L, ''organization'', p_organization_id)', spec.permission_key), 2);
  END LOOP;
  FOR spec IN SELECT * FROM (VALUES
    ('platform.admissions_direction_summary_v1(text,uuid,date,date)'),
    ('platform.admissions_playbook_catalog_v1()')
  ) AS x(signature) LOOP
    PERFORM pg_temp.evo_s2_replace(spec.signature,
      $$a.platform_role NOT IN ('admin','curator') OR NOT private.platform_has_permission(a.organization_id,'case.read.full')$$,
      $$NOT platform_private.staff_has_permission(a.organization_id,a.membership_id,'case.read.full')$$);
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('platform.staff_student_profile_snapshot(uuid)',
    $$private.platform_has_permission(
      student_case.organization_id,
      'profile.read.full'
    )$$,
    $$platform_private.staff_can_access_for_actor(student_case.organization_id,
      'profile.read.full', 'student_case', student_case.id)$$);
END
$migration$;

-- The contract workspace is readable independently from its mutation buttons.
-- Publication and draft generation still recheck their own exact action.
DO $migration$
DECLARE body TEXT; old_part TEXT;
BEGIN
  SELECT prosrc INTO STRICT body FROM pg_proc
    WHERE oid = 'platform.staff_case_contract_workspace(uuid,uuid)'::regprocedure;
  IF md5(body) <> '56467858355f2e6f6c725c7c47fe720a' THEN
    RAISE EXCEPTION 'Unexpected contract workspace definition';
  END IF;
  old_part := substring(body FROM position('  SELECT' IN body)
    FOR position('  SELECT * INTO student_case' IN body) - position('  SELECT' IN body));
  PERFORM pg_temp.evo_s2_replace('platform.staff_case_contract_workspace(uuid,uuid)', old_part,
    $$  SELECT * INTO actor FROM platform_private.require_domain_actor_read(p_organization_id, 'case.workflow.read');
  IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
    'case.workflow.read', 'student_case', p_student_case_id) THEN
    RAISE EXCEPTION 'Actor is not authorized for this contract workspace' USING ERRCODE='42501';
  END IF;

$$);
  old_part := substring(body FROM position('  can_manage_templates :=' IN body)
    FOR position('  IF can_manage_templates THEN' IN body) - position('  can_manage_templates :=' IN body));
  PERFORM pg_temp.evo_s2_replace('platform.staff_case_contract_workspace(uuid,uuid)', old_part,
    $$  can_manage_templates := platform_private.staff_can_access(p_organization_id,
    actor.actor_membership_id, 'contract.template.manage', 'organization', p_organization_id);
  can_generate_contract := platform_private.staff_can_access(p_organization_id,
    actor.actor_membership_id, 'contract.draft.manage', 'student_case', p_student_case_id);
  can_review_contract := can_generate_contract;
  can_manage_post_contract := student_case.state IN ('active', 'closed')
    AND platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
      'post.contract.manage', 'student_case', p_student_case_id);
  can_review_report := can_manage_post_contract;

$$);
END
$migration$;

DO $migration$
DECLARE manual CONSTANT TEXT := 'platform.create_manual_sales_lead(uuid,uuid,text,text,text,text,uuid,text,text,date)';
  workflow CONSTANT TEXT := 'platform.mutate_sales_lead_workflow(uuid,bigint,uuid,text,uuid,text,date,boolean,text)';
BEGIN
  PERFORM pg_temp.evo_s2_replace(manual,
    $$  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id AND a.platform_role IN ('admin','sales')
      AND private.platform_has_permission(a.organization_id,'lead.sales.workflow.manage');$$,
    $$  PERFORM 1 FROM platform.organizations o WHERE o.id=p_organization_id FOR KEY SHARE;
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id=p_organization_id
      AND platform_private.staff_can_create_for_owner(a.organization_id,a.membership_id,
        'lead.sales.workflow.manage','lead',p_owner_membership_id);$$);
  PERFORM pg_temp.evo_s2_replace(manual,
    $$NOT platform_private.is_eligible_sales_owner(p_organization_id,p_owner_membership_id)
    OR (actor.platform_role='sales' AND p_owner_membership_id<>actor.membership_id)$$,
    $$NOT platform_private.staff_can_receive_assignment(p_organization_id,p_owner_membership_id,
      'lead.read','lead',NULL)
    OR NOT platform_private.staff_can_receive_assignment(p_organization_id,p_owner_membership_id,
      'lead.sales.workflow.manage','lead',NULL)$$);
  PERFORM pg_temp.evo_s2_replace(workflow,
    $$  SELECT authority.*
  INTO actor$$,
    $$  PERFORM 1 FROM platform.organizations o JOIN platform.leads l ON l.organization_id=o.id
    WHERE l.id=p_lead_id FOR KEY SHARE OF o;
  SELECT authority.*
  INTO actor$$);
  PERFORM pg_temp.evo_s2_replace(workflow,
    $$authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    )$$,
    $$platform_private.staff_can_access(authority.organization_id, authority.membership_id,
      'lead.sales.workflow.manage', 'lead', p_lead_id)$$);
  PERFORM pg_temp.evo_s2_replace(workflow,
    $$    AND (
      actor.platform_role = 'admin'
      OR candidate.current_owner_membership_id = actor.membership_id
      OR candidate.current_owner_membership_id IS NULL
    )$$,
    $$    AND platform_private.staff_can_access(candidate.organization_id, actor.membership_id,
      'lead.sales.workflow.manage', 'lead', candidate.id)$$);
  PERFORM pg_temp.evo_s2_replace(workflow,
    $$  IF actor.platform_role = 'sales' THEN
    IF (
      lead_record.current_owner_membership_id IS NULL
      AND p_owner_membership_id IS DISTINCT FROM actor.membership_id
    ) OR (
      lead_record.current_owner_membership_id = actor.membership_id
      AND p_owner_membership_id IS DISTINCT FROM actor.membership_id
    ) THEN
      RAISE EXCEPTION 'workflow_invalid_owner'
        USING ERRCODE = '22023';
    END IF;
  ELSIF owner_changed THEN
    IF NOT private.platform_has_permission(
      actor.organization_id,
      'lead.sales.owner.assign'
    ) OR (
      p_owner_membership_id IS NOT NULL
      AND NOT platform_private.is_eligible_sales_owner(
        actor.organization_id,
        p_owner_membership_id
      )
    ) THEN
      RAISE EXCEPTION 'workflow_invalid_owner'
        USING ERRCODE = '22023';
    END IF;
  END IF;$$,
    $$  IF owner_changed AND (
    NOT platform_private.staff_can_access(actor.organization_id, actor.membership_id,
      'lead.sales.owner.assign', 'lead', lead_record.id)
    OR (p_owner_membership_id IS NOT NULL AND (
      NOT platform_private.staff_can_receive_assignment(actor.organization_id,p_owner_membership_id,
        'lead.read','lead',lead_record.id)
      OR NOT platform_private.staff_can_receive_assignment(actor.organization_id,p_owner_membership_id,
        'lead.sales.workflow.manage','lead',lead_record.id)
    ))
  ) THEN RAISE EXCEPTION 'workflow_invalid_owner' USING ERRCODE='22023'; END IF;$$);
  PERFORM pg_temp.evo_s2_replace(workflow,
    $$    actor.platform_role = 'admin'
    AND owner_changed$$,
    $$    owner_changed$$);
END
$migration$;

DO $migration$
DECLARE gate CONSTANT TEXT := 'platform.mutate_lead_admissions_gate(uuid,bigint,uuid,text,numeric,text,date,date,text,text)';
  handoff CONSTANT TEXT := 'platform.handoff_lead_to_admissions(uuid,bigint,uuid,text,text,uuid)';
  signature TEXT; action_key TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[gate,handoff] LOOP
    PERFORM pg_temp.evo_s2_replace(signature,
      $$  SELECT authority.*
  INTO actor$$,
      $$  PERFORM 1 FROM platform.organizations o JOIN platform.leads l ON l.organization_id=o.id
    WHERE l.id=p_lead_id FOR KEY SHARE OF o;
  SELECT authority.*
  INTO actor$$);
  END LOOP;
  PERFORM pg_temp.evo_s2_replace(gate,
    $$authority.platform_role IN ('admin', 'sales', 'curator')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.read'
    )$$,
    $$platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'lead.read','lead',p_lead_id)$$);
  PERFORM pg_temp.evo_s2_replace(gate,
    $$    AND (
      actor.platform_role = 'admin'
      OR (
        actor.platform_role = 'sales'
        AND (
          lead.current_owner_membership_id = actor.membership_id
          OR lead.current_owner_membership_id IS NULL
        )
      )
      OR (
        actor.platform_role = 'curator'
        AND private.platform_can_read_canonical_lead(
          lead.organization_id,
          lead.id
        )
      )
    )$$,
    $$    AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,
      'lead.read','lead',lead.id)$$);
  -- Personal grants are never supplied by editable roles. The override key
  -- also enforces the explicit system-Admin boundary in staff_has_permission.
  PERFORM pg_temp.evo_s2_replace(gate,
    $$actor.platform_role <> 'admin'
    OR NOT private.platform_has_permission($$,
    $$NOT private.platform_has_permission($$);
  PERFORM pg_temp.evo_s2_replace(gate,
    $$actor.platform_role = 'admin'
        AND private.platform_has_permission($$,
    $$private.platform_has_permission($$);
  PERFORM pg_temp.evo_s2_replace(handoff,
    $$authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    )$$,
    $$platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'lead.sales.workflow.manage','lead',p_lead_id)$$);
  PERFORM pg_temp.evo_s2_replace(handoff,
    $$actor.platform_role <> 'admin'$$,
    $$NOT platform_private.staff_has_permission(actor.organization_id,actor.membership_id,
      'admissions.handoff.gate.override')$$);
  PERFORM pg_temp.evo_s2_replace(handoff,
    $$    AND (
      actor.platform_role = 'admin'
      OR lead.current_owner_membership_id = actor.membership_id
    )$$,
    $$    AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,
      'lead.sales.workflow.manage','lead',lead.id)$$);
  PERFORM pg_temp.evo_s2_replace(handoff,
    $$  JOIN platform.role_bundle_versions AS sales_owner_bundle
    ON sales_owner_bundle.id = sales_owner.current_bundle_id
    AND sales_owner_bundle.role = sales_owner."current_role"
$$, '');
  PERFORM pg_temp.evo_s2_replace(handoff,
    $$    AND sales_owner_bundle.status = 'published'
$$, '');
  PERFORM pg_temp.evo_s2_replace(handoff,
    $$platform_private.is_eligible_staff_responsibility(sales_owner.organization_id, sales_owner.id, 'sales')$$,
    $$platform_private.staff_can_access(sales_owner.organization_id,sales_owner.id,
      'lead.sales.workflow.manage','lead',lead_record.id)$$);
  PERFORM pg_temp.evo_s2_replace(handoff,
    $$  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
$$, '');
  PERFORM pg_temp.evo_s2_replace(handoff,
    $$    AND bundle.status = 'published'
$$, '');
  PERFORM pg_temp.evo_s2_replace(handoff,
    $$  admissions_scope_version := target_case.current_scope_version + 1;$$,
    $$  IF NOT platform_private.staff_can_receive_assignment(actor.organization_id,p_admissions_owner_membership_id,
    'case.read.full','student_case',target_case.id)
    OR NOT platform_private.staff_can_receive_assignment(actor.organization_id,p_admissions_owner_membership_id,
      'task.manage','student_case',target_case.id) THEN
    RAISE EXCEPTION 'admissions_handoff_invalid_owner' USING ERRCODE='22023';
  END IF;
  admissions_scope_version := target_case.current_scope_version + 1;$$);
END
$migration$;

-- Provider intake selects a live eligible owner; it is not a business role.
CREATE OR REPLACE FUNCTION platform_private.require_waha_history_sales(
  p_organization_id UUID, p_membership_id UUID
) RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT platform_private.staff_can_receive_assignment(p_organization_id,p_membership_id,
    'lead.read','lead',NULL)
    OR NOT platform_private.staff_can_create_for_owner(p_organization_id,p_membership_id,
      'lead.sales.workflow.manage','lead',p_membership_id)
    OR NOT platform_private.staff_has_permission(p_organization_id,p_membership_id,
      'communication.read.full') THEN
    RAISE EXCEPTION 'An active tenant-scoped intake membership is required' USING ERRCODE='42501';
  END IF;
END
$$;

DO $migration$
DECLARE coverage CONSTANT TEXT := 'private.read_curator_coverage_workspace(uuid,uuid,uuid,uuid)';
BEGIN
  -- LANGUAGE SQL validates each replacement immediately; remove the predicate
  -- before its now-unused join so every intermediate definition stays valid.
  PERFORM pg_temp.evo_s2_replace('platform_private.u6_eligible_admissions_owners(uuid)',
    $$      AND bundle.status = 'published'
$$, '');
  PERFORM pg_temp.evo_s2_replace('platform_private.u6_eligible_admissions_owners(uuid)',
    $$    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
$$, '');
  PERFORM pg_temp.evo_s2_replace(coverage,
    $$platform_private.require_admin_actor(p_organization_id,'case.curator.assign')$$,
    $$platform_private.require_domain_actor_read(p_organization_id,'case.curator.assign')$$);
  PERFORM pg_temp.evo_s2_replace(coverage,
    $$organization_id=p_organization_id AND "current_role" IN ('admin','curator')$$,
    $$organization_id=p_organization_id AND "current_role" IS DISTINCT FROM 'student'$$);
  PERFORM pg_temp.evo_s2_replace(coverage,
    $$  LEFT JOIN platform.role_bundle_versions AS bundle ON bundle.id=member.current_bundle_id AND bundle.role=member."current_role"
$$, '');
  PERFORM pg_temp.evo_s2_replace(coverage,
    $$member.organization_id=p_organization_id AND member."current_role" IN ('admin','curator')$$,
    $$member.organization_id=p_organization_id AND (
      platform_private.is_eligible_staff_responsibility(member.organization_id,member.id,'curator')
      OR EXISTS(SELECT 1 FROM platform.student_cases old_case WHERE old_case.organization_id=member.organization_id
        AND old_case.current_curator_membership_id=member.id
        AND platform_private.staff_can_access_for_actor(old_case.organization_id,'case.curator.assign','student_case',old_case.id)))$$);
  PERFORM pg_temp.evo_s2_replace(coverage,
    $$sc.state='active'$$,
    $$sc.state='active' AND platform_private.staff_can_access_for_actor(sc.organization_id,
      'case.curator.assign','student_case',sc.id)$$, 4);
  PERFORM pg_temp.evo_s2_replace(coverage,
    $$AND id=p_student_case_id AND state='active';$$,
    $$AND id=p_student_case_id AND state='active'
      AND platform_private.staff_can_access_for_actor(organization_id,'case.curator.assign','student_case',id);$$);
  PERFORM pg_temp.evo_s2_replace(coverage, $$member."current_role"='admin'$$, $$member.is_system_admin$$);
  PERFORM pg_temp.evo_s2_replace(coverage, $$return_member."current_role"<>'admin'$$, $$NOT return_member.is_system_admin$$);
  PERFORM pg_temp.evo_s2_replace(coverage, $$member."current_role"<>'admin'$$, $$NOT member.is_system_admin$$);
  PERFORM pg_temp.evo_s2_replace(coverage,
    $$return_bundle.status IS DISTINCT FROM 'published'$$,
    $$NOT platform_private.staff_can_receive_assignment(p_organization_id,return_member.id,
      'task.manage','student_case',p_student_case_id)$$);
  PERFORM pg_temp.evo_s2_replace(coverage,
    $$    LEFT JOIN platform.role_bundle_versions AS return_bundle ON return_bundle.id=return_member.current_bundle_id AND return_bundle.role=return_member."current_role"
$$, '');
  PERFORM pg_temp.evo_s2_replace('private.reserve_message_media_attachment(uuid,uuid,uuid,uuid,bigint,uuid)',
    $$    OR actor.actor_role IS DISTINCT FROM authority.platform_role
    OR actor.actor_role NOT IN ('admin', 'curator')
$$, '');
  PERFORM pg_temp.evo_s2_replace('platform.consume_communication_media_download_grant(uuid,uuid)',
    $$        AND membership."current_role" = grant_row.grantee_role
$$, '');
  PERFORM pg_temp.evo_s2_replace('platform.consume_communication_media_download_grant(uuid,uuid)',
    $$  SELECT
    download_grant.id,$$,
    $$  PERFORM 1 FROM platform.organizations o
    JOIN platform_private.communication_media_download_grants g ON g.organization_id=o.id
    WHERE g.id=p_media_download_grant_id FOR KEY SHARE OF o;
  PERFORM 1 FROM platform.profiles p
    JOIN platform_private.communication_media_download_grants g ON g.grantee_profile_id=p.id
    WHERE g.id=p_media_download_grant_id FOR SHARE OF p;
  SELECT
    download_grant.id,$$);
END
$migration$;

-- Relation reads must use their own row's case, not an unrelated permission
-- union combined with an organization-scope check.
ALTER POLICY organizations_read ON platform.organizations USING (
  private.platform_staff_can_access(id,'organization.read','organization',id)
  OR ((SELECT auth.jwt()->>'platform_role')='student'
    AND private.platform_has_permission(id,'organization.read')
    AND private.platform_has_scope(id,'organization',id))
);
DO $migration$
DECLARE spec RECORD; body TEXT; old_part TEXT;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('country_requirement_versions','country_requirement_versions_admin_read','country.requirement.manage'),
    ('country_requirement_version_sources','country_requirement_version_sources_admin_read','country.requirement.manage'),
    ('catalog_import_batches','catalog_import_batches_admin_read','catalog.import.manage'),
    ('catalog_import_candidates','catalog_import_candidates_admin_read','catalog.import.manage')
  ) x(table_name,policy_name,permission_key) LOOP
    EXECUTE format('ALTER POLICY %I ON platform.%I USING (private.platform_staff_can_access(organization_id,%L,''organization'',organization_id))',
      spec.policy_name,spec.table_name,spec.permission_key);
  END LOOP;
  FOR spec IN SELECT * FROM (VALUES
    ('payment_events','payment_events_full_read'),
    ('payment_obligations','payment_obligations_full_read'),
    ('payment_evidence','payment_evidence_full_read'),
    ('stop_factors','stop_factors_full_read'),
    ('stop_factor_events','stop_factor_events_full_read')
  ) x(table_name,policy_name) LOOP
    EXECUTE format('ALTER POLICY %I ON platform.%I USING (private.platform_staff_can_access(organization_id,''finance.read.full'',''student_case'',student_case_id))',
      spec.policy_name,spec.table_name);
  END LOOP;
  FOR spec IN SELECT * FROM (VALUES
    ('platform.sales_document_checklist()','bbb585e3e160f509bdd6f96cf0ffd4ca','document.read.sales'),
    ('platform.case_finance_summaries()','e6fd36df3969480bf36772cbb170279c','finance.read.summary')
  ) x(signature,expected_md5,permission_key) LOOP
    SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid=spec.signature::regprocedure;
    IF md5(body)<>spec.expected_md5 THEN RAISE EXCEPTION 'Unexpected summary definition: %',spec.signature; END IF;
    old_part:=substring(body FROM position('  WHERE profile.auth_user_id' IN body)
      FOR position('  ORDER BY ' IN substring(body FROM position('  WHERE profile.auth_user_id' IN body)))-1);
    PERFORM pg_temp.evo_s2_replace(spec.signature,old_part,
      format('  WHERE profile.auth_user_id = (SELECT auth.uid()) AND platform_private.staff_can_access_for_actor(student_case.organization_id,%L,''student_case'',student_case.id)%s%s',
        spec.permission_key,CASE WHEN spec.permission_key='document.read.sales' THEN ' AND student_case.state=''pending''' ELSE '' END,chr(10)));
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('platform.sales_document_checklist()',
    $$membership.id = student_case.responsible_sales_membership_id$$,
    $$membership.id = (SELECT a.membership_id FROM platform.current_actor_authority() a)$$);
  PERFORM pg_temp.evo_s2_replace('platform.former_sales_case_summaries(uuid)',
    $$'communication.read.summary'$$, $$'case.read.summary'$$);
  PERFORM pg_temp.evo_s2_replace('platform.former_sales_case_summaries(uuid)',
    $$  IF actor.actor_role <> 'sales' THEN
    RAISE EXCEPTION
      'Former-Sales summaries are available only to Sales'
      USING ERRCODE = '42501';
  END IF;
$$, '');
  PERFORM pg_temp.evo_s2_replace('platform.former_sales_case_summaries(uuid)',
    $$target_case.responsible_sales_membership_id =
      actor.actor_membership_id$$,
    $$platform_private.staff_can_access(p_organization_id,actor.actor_membership_id,
      'case.read.summary','student_case',target_case.id)$$);
END
$migration$;

CREATE OR REPLACE FUNCTION private.require_lead_note_actor(p_organization_id UUID,p_lead_id UUID)
RETURNS TABLE(actor_profile_id UUID,actor_membership_id UUID,actor_auth_user_id UUID,actor_role platform.business_role)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN QUERY SELECT a.profile_id,a.membership_id,a.auth_user_id,a.platform_role
  FROM platform.current_actor_authority() a WHERE a.organization_id=p_organization_id
    AND platform_private.staff_can_access(a.organization_id,a.membership_id,'lead.sales.workflow.manage','lead',p_lead_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead is unavailable' USING ERRCODE='42501'; END IF;
END
$$;
CREATE OR REPLACE FUNCTION private.require_lead_note_mutation_actor(p_organization_id UUID,p_lead_id UUID)
RETURNS TABLE(actor_profile_id UUID,actor_membership_id UUID,actor_auth_user_id UUID,actor_role platform.business_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform_private.require_domain_actor(p_organization_id,'lead.sales.workflow.manage');
  PERFORM 1 FROM platform.leads l WHERE l.organization_id=p_organization_id AND l.id=p_lead_id FOR UPDATE;
  IF NOT FOUND OR NOT platform_private.staff_can_access(p_organization_id,a.actor_membership_id,
    'lead.sales.workflow.manage','lead',p_lead_id) THEN
    RAISE EXCEPTION 'Lead is unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT a.actor_profile_id,a.actor_membership_id,a.actor_auth_user_id,a.actor_role;
END
$$;

DO $migration$
DECLARE signature TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'platform.staff_lead_admissions_handoff(uuid)', 'platform.staff_sales_lead_detail(uuid)'
  ] LOOP
    PERFORM pg_temp.evo_s2_replace(signature,
      $$authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    )$$,
      $$platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'lead.sales.workflow.manage','lead',p_lead_id)$$);
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('platform.staff_lead_admissions_handoff(uuid)',
    $$    AND (
      actor.platform_role = 'admin'
      OR lead.current_owner_membership_id = actor.membership_id
    )$$,
    $$    AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,
      'lead.sales.workflow.manage','lead',lead.id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_sales_lead_detail(uuid)',
    $$    AND (
      actor.platform_role = 'admin'
      OR lead.current_owner_membership_id = actor.membership_id
      OR lead.current_owner_membership_id IS NULL
    )$$,
    $$    AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,
      'lead.sales.workflow.manage','lead',lead.id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_sales_lead_detail(uuid)',
    $$'lead.sales.workflow.manage'$$, $$'lead.read'$$, 2);
  PERFORM pg_temp.evo_s2_replace('platform.staff_student_case_handoff_context(uuid)',
    $$authority.platform_role IN ('admin', 'curator')
    AND private.platform_has_permission(
      authority.organization_id,
      'case.read.full'
    )$$,
    $$platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'case.read.full','student_case',p_student_case_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_sales_owner_options(integer,text,uuid,text)',
    $$authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    )$$,
    $$platform_private.staff_has_permission(authority.organization_id,authority.membership_id,
      'lead.sales.workflow.manage')$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_sales_owner_options(integer,text,uuid,text)',
    $$    AND (
      actor.platform_role = 'admin'
      OR membership.id = actor.membership_id
    )$$,
    $$    AND platform_private.staff_can_create_for_owner(actor.organization_id,actor.membership_id,
      'lead.sales.workflow.manage','lead',membership.id)
    AND platform_private.staff_can_receive_assignment(actor.organization_id,membership.id,'lead.read','lead',NULL)
    AND platform_private.staff_can_receive_assignment(actor.organization_id,membership.id,'lead.sales.workflow.manage','lead',NULL)$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_lead_admissions_gate(uuid)',
    $$authority.platform_role IN ('admin', 'sales', 'curator')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.read'
    )$$,
    $$platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'lead.read','lead',p_lead_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_lead_admissions_gate(uuid)',
    $$actor.platform_role = 'admin'
      AND private.platform_has_permission($$,
    $$private.platform_has_permission($$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_lead_admissions_gate(uuid)',
    $$    AND (
      actor.platform_role = 'admin'
      OR (
        actor.platform_role = 'sales'
        AND (
          lead.current_owner_membership_id = actor.membership_id
          OR lead.current_owner_membership_id IS NULL
        )
      )
      OR (
        actor.platform_role = 'curator'
        AND private.platform_can_read_canonical_lead(
          lead.organization_id,
          lead.id
        )
      )
    )$$,
    $$    AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,
      'lead.read','lead',lead.id)$$);
END
$migration$;

ALTER TABLE platform.post_contract_items ALTER COLUMN owner_role DROP NOT NULL,
  DROP CONSTRAINT post_contract_items_owner_role_check;
DO $migration$
DECLARE signature TEXT;
BEGIN
  PERFORM pg_temp.evo_s2_replace('platform_private.guard_post_contract_item_mutation()',
    $$    OR NEW.owner_role NOT IN ('admin', 'curator')$$,
    $$    OR NOT platform_private.staff_can_access(NEW.organization_id,NEW.owner_membership_id,
      'post.contract.manage','student_case',NEW.student_case_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.update_post_contract_item(uuid,uuid,uuid,bigint,platform.post_contract_item_status,uuid,text,text,text,uuid)',
    $$    OR owner."current_role" NOT IN ('admin', 'curator')$$,
    $$    OR NOT platform_private.staff_can_access(p_organization_id,p_owner_membership_id,
      'post.contract.manage','student_case',p_student_case_id)$$);
  FOREACH signature IN ARRAY ARRAY[
    'platform.create_decision_backlog_entry(uuid,uuid,uuid,text,platform.business_role,platform.decision_requirement_kind,uuid,platform.student_profile_field,uuid,text,text,uuid)',
    'platform.transition_decision_backlog_entry(uuid,uuid,uuid,bigint,platform.decision_backlog_status,text,text,platform.business_role,platform.decision_requirement_kind,uuid,platform.student_profile_field,uuid,text,text,uuid)'
  ] LOOP
    PERFORM pg_temp.evo_s2_replace(signature,
      $$  IF actor.actor_role <> 'admin' AND p_owner_role <> actor.actor_role THEN
    RAISE EXCEPTION 'Decision owner role exceeds the actor authority'
      USING ERRCODE = '42501';
  END IF;
$$,
      $$  -- owner_role is a workflow responsibility descriptor, not an account
  -- permission. The actual actor has decision.manage on this conversation.
$$);
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('platform.staff_conversation_bw4_workspace(uuid,uuid)',
    $$  allowed_owner_roles := CASE actor.actor_role
    WHEN 'admin' THEN to_jsonb(ARRAY['admin', 'sales', 'curator']::TEXT[])
    WHEN 'sales' THEN to_jsonb(ARRAY['sales']::TEXT[])
    WHEN 'curator' THEN to_jsonb(ARRAY['curator']::TEXT[])
    ELSE '[]'::JSONB
  END;$$,
    $$  allowed_owner_roles := to_jsonb(ARRAY['admin','sales','curator']::TEXT[]);$$);
END
$migration$;

CREATE OR REPLACE FUNCTION private.require_reply_snippet_actor(p_organization_id UUID)
RETURNS TABLE(actor_profile_id UUID,actor_membership_id UUID,actor_auth_user_id UUID,actor_role platform.business_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; permission_key TEXT;
BEGIN
  PERFORM 1 FROM platform.organizations o WHERE o.id=p_organization_id FOR KEY SHARE;
  SELECT * INTO a FROM platform.current_actor_authority() WHERE organization_id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reply snippets are unavailable' USING ERRCODE='42501'; END IF;
  permission_key := CASE WHEN platform_private.staff_can_access(p_organization_id,a.membership_id,
    'reply.snippet.manage','organization',p_organization_id) THEN 'reply.snippet.manage'
    WHEN platform_private.staff_can_access(p_organization_id,a.membership_id,
      'reply.snippet.moderate','organization',p_organization_id) THEN 'reply.snippet.moderate' END;
  IF permission_key IS NULL THEN RAISE EXCEPTION 'Reply snippets are unavailable' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT * FROM platform_private.require_domain_actor(p_organization_id,permission_key);
END
$$;
DO $migration$
DECLARE signature TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'private.create_reply_snippet(uuid,text,text,text,uuid)',
    'private.update_reply_snippet(uuid,uuid,text,text,text,bigint,uuid)'
  ] LOOP
    PERFORM pg_temp.evo_s2_replace(signature,
      $$private.reply_snippet_audience_visible(
    actor.actor_role::TEXT,
    p_audience
  )$$,
      $$platform_private.staff_can_access(p_organization_id,actor.actor_membership_id,
    'reply.snippet.'||p_audience,'organization',p_organization_id)$$);
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('private.create_reply_snippet(uuid,text,text,text,uuid)',
    $$  IF NOT platform_private.staff_can_access(p_organization_id,actor.actor_membership_id,$$,
    $$  IF NOT platform_private.staff_can_access(p_organization_id,actor.actor_membership_id,
    'reply.snippet.manage','organization',p_organization_id)
    OR NOT platform_private.staff_can_access(p_organization_id,actor.actor_membership_id,$$);
  FOREACH signature IN ARRAY ARRAY[
    'private.update_reply_snippet(uuid,uuid,text,text,text,bigint,uuid)',
    'private.archive_reply_snippet(uuid,uuid,bigint,uuid)'
  ] LOOP
    PERFORM pg_temp.evo_s2_replace(signature,
      $$  IF actor.actor_role <> 'admin'
    AND (
      snippet_row.created_by_membership_id
        IS DISTINCT FROM actor.actor_membership_id
      OR NOT private.reply_snippet_audience_visible(
        actor.actor_role::TEXT,
        snippet_row.audience
      )
    )$$,
      $$  IF NOT platform_private.staff_can_access(p_organization_id,actor.actor_membership_id,
    CASE WHEN snippet_row.created_by_membership_id=actor.actor_membership_id
      THEN 'reply.snippet.manage' ELSE 'reply.snippet.moderate' END,'organization',p_organization_id)
    OR NOT platform_private.staff_can_access(p_organization_id,actor.actor_membership_id,
      'reply.snippet.'||snippet_row.audience,'organization',p_organization_id)$$);
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('private.list_reply_snippets(uuid,text)',
    $$    OR (SELECT auth.jwt() ->> 'platform_role')
      NOT IN ('admin', 'sales', 'curator')
    OR NOT private.platform_has_permission(
      p_organization_id,
      'communication.read.full'
    )$$,
    $$    OR NOT (platform_private.staff_can_access_for_actor(p_organization_id,'reply.snippet.sales','organization',p_organization_id)
      OR platform_private.staff_can_access_for_actor(p_organization_id,'reply.snippet.admissions','organization',p_organization_id)
      OR platform_private.staff_can_access_for_actor(p_organization_id,'reply.snippet.all','organization',p_organization_id))$$);
  PERFORM pg_temp.evo_s2_replace('private.list_reply_snippets(uuid,text)',
    $$private.reply_snippet_audience_visible(
      (SELECT auth.jwt() ->> 'platform_role'),
      snippet.audience
    )$$,
    $$platform_private.staff_can_access_for_actor(p_organization_id,
      'reply.snippet.'||snippet.audience,'organization',p_organization_id)$$);
END
$migration$;
DROP FUNCTION private.reply_snippet_audience_visible(TEXT,TEXT);

CREATE FUNCTION platform_private.staff_intake_owner_is_eligible(p_organization_id UUID,p_membership_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT platform_private.staff_can_receive_assignment(p_organization_id,p_membership_id,'lead.read','lead',NULL)
    AND platform_private.staff_can_create_for_owner(p_organization_id,p_membership_id,
      'lead.sales.workflow.manage','lead',p_membership_id)
    AND platform_private.staff_has_permission(p_organization_id,p_membership_id,'communication.read.full')
$$;
REVOKE ALL ON FUNCTION platform_private.staff_intake_owner_is_eligible(UUID,UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

DO $migration$
DECLARE body TEXT; old_part TEXT; start_pos INTEGER;
BEGIN
  PERFORM pg_temp.evo_s2_replace('platform.create_communication_conversation(uuid,uuid,uuid,text,text,bigint,text,bigint,bigint,bigint,uuid,uuid)',
    $$  IF NOT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
     AND bundle.role = membership."current_role"
     AND bundle.status = 'published'
    WHERE membership.organization_id = p_organization_id
      AND membership.id = p_responsible_sales_membership_id
      AND membership.status = 'active'
      AND membership."current_role" = 'sales'
  ) THEN$$,
    $$  IF NOT platform_private.staff_intake_owner_is_eligible(p_organization_id,p_responsible_sales_membership_id) THEN$$);
  SELECT prosrc INTO STRICT body FROM pg_proc
    WHERE oid='platform.record_conversation_participant(uuid,uuid,platform.conversation_participant_kind,uuid,text,uuid,uuid)'::regprocedure;
  IF md5(body)<>'a649333aa56cb5bb2af30085271fbf81' THEN RAISE EXCEPTION 'Unexpected participant definition'; END IF;
  start_pos:=position('  ELSIF p_participant_kind = ''sales'' THEN' IN body);
  old_part:=substring(body FROM start_pos FOR position('  IF p_membership_id IS NOT NULL THEN' IN body)-start_pos);
  PERFORM pg_temp.evo_s2_replace('platform.record_conversation_participant(uuid,uuid,platform.conversation_participant_kind,uuid,text,uuid,uuid)',old_part,
    $$  ELSE
    -- Non-customer kinds describe the conversation workflow; they no longer
    -- assert the employee's current permission role.
    IF p_membership_id IS NULL OR p_external_subject_ref IS NOT NULL
      OR NOT platform_private.staff_can_access(p_organization_id,p_membership_id,
        'communication.read.full','conversation',p_conversation_id) THEN
      RAISE EXCEPTION 'An authorized staff conversation participant is required' USING ERRCODE='42501';
    END IF;
  END IF;

$$);
  SELECT prosrc INTO STRICT body FROM pg_proc
    WHERE oid='platform.sync_lead_agent_whatsapp(uuid,uuid,uuid,bigint,bigint,bigint,uuid)'::regprocedure;
  IF md5(body)<>'9e24630ce8493d7f697052bbd13fc1f7' THEN RAISE EXCEPTION 'Unexpected Lead-Agent projection definition'; END IF;
  start_pos:=position($$  IF NOT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership$$ IN body);
  old_part:=substring(body FROM start_pos FOR position('  PERFORM pg_catalog.pg_advisory_xact_lock(' IN substring(body FROM start_pos))-1);
  PERFORM pg_temp.evo_s2_replace('platform.sync_lead_agent_whatsapp(uuid,uuid,uuid,bigint,bigint,bigint,uuid)',old_part,
    $$  PERFORM platform_private.require_waha_history_sales(p_organization_id,p_intake_sales_membership_id);

$$);
  SELECT prosrc INTO STRICT body FROM pg_proc
    WHERE oid='platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)'::regprocedure;
  IF md5(body)<>'54986baa0a8bdd66bf3da43af7316d8f' THEN RAISE EXCEPTION 'Unexpected WAHA projection definition'; END IF;
  start_pos:=position($$    AND NOT EXISTS (
      SELECT 1
      FROM platform.organization_memberships AS membership$$ IN body);
  old_part:=substring(body FROM start_pos FOR position('  THEN' IN substring(body FROM start_pos))-1);
  PERFORM pg_temp.evo_s2_replace('platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)',old_part,
    $$    AND NOT platform_private.staff_intake_owner_is_eligible(p_organization_id,p_intake_sales_membership_id)
$$);
  PERFORM pg_temp.evo_s2_replace('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)',
    $$membership.current_role IN ('admin', 'sales', 'curator')$$,
    $$platform_private.staff_can_access(membership.organization_id,membership.id,
      'communication.manual.send','conversation',authorization_row.conversation_id)$$);
  PERFORM pg_temp.evo_s2_replace('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)',
    $$sender_membership.current_role::TEXT$$,
    $$(CASE WHEN sender_membership.is_system_admin THEN 'admin' ELSE
      (SELECT CASE WHEN c.queue='sales' THEN 'sales' ELSE 'curator' END
       FROM platform.communication_conversations c WHERE c.organization_id=work_item.organization_id
         AND c.id=authorization_row.conversation_id) END)$$, 3);
END
$migration$;

DO $migration$
DECLARE spec RECORD; body TEXT; old_part TEXT; start_pos INTEGER;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('platform.staff_student_case_document_workspace(uuid)','document.read.full','student_case','student_case.id'),
    ('platform.staff_document_queue(integer)','document.read.full','document_slot','slot.id'),
    ('platform.staff_visa_queue(integer)','visa.manage','visa_case','visa_case.id'),
    ('private.staff_case_task_queue(integer,timestamp with time zone,uuid,date,date)','task.manage','task','case_task.id'),
    ('private.staff_case_task_undated_page(integer,timestamp with time zone,uuid)','task.manage','task','case_task.id')
  ) x(signature,permission_key,resource_kind,resource_id) LOOP
    PERFORM pg_temp.evo_s2_replace(spec.signature,
      $$    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )$$,
      format('    AND platform_private.staff_can_access(student_case.organization_id,actor.membership_id,%L,%L,%s)',
        spec.permission_key,spec.resource_kind,spec.resource_id));
  END LOOP;
  FOR spec IN SELECT * FROM (VALUES
    ('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)'),
    ('platform.staff_sales_stage_entry_cohort(date,date,integer,timestamp with time zone,uuid)')
  ) x(signature) LOOP
    PERFORM pg_temp.evo_s2_replace(spec.signature,
      $$authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    )$$,
      $$platform_private.staff_has_permission(authority.organization_id,authority.membership_id,'lead.read')$$);
    PERFORM pg_temp.evo_s2_replace(spec.signature,
      $$      AND (
        actor.platform_role = 'admin'
        OR lead.current_owner_membership_id = actor.membership_id
        OR lead.current_owner_membership_id IS NULL
      )$$,
      $$      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,'lead.read','lead',lead.id)$$, 2);
  END LOOP;
  PERFORM pg_temp.evo_s2_replace('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)',
    $$actor.platform_role <> 'admin'
      OR NOT platform_private.is_eligible_sales_owner($$,
    $$NOT platform_private.is_eligible_sales_owner($$);
  SELECT prosrc INTO STRICT body FROM pg_proc
    WHERE oid='platform.staff_canonical_client_page(integer,timestamp with time zone,uuid,platform.client_lifecycle_state,text)'::regprocedure;
  IF md5(body)<>'d1ef865cdf740e683517eeef7c30d9e1' THEN RAISE EXCEPTION 'Unexpected canonical client page'; END IF;
  start_pos:=position($$      AND (
        actor.platform_role = 'admin'$$ IN body);
  old_part:=substring(body FROM start_pos FOR position($$      AND (
        p_before_sort_at IS NULL$$ IN body)-start_pos);
  PERFORM pg_temp.evo_s2_replace('platform.staff_canonical_client_page(integer,timestamp with time zone,uuid,platform.client_lifecycle_state,text)',old_part,
    $$      AND platform_private.staff_can_access(client.organization_id,actor.membership_id,'client.read','client',client.id)
$$);
  PERFORM pg_temp.evo_s2_replace('platform.assert_case_finance_stop_factor(uuid,uuid,text,text,text,text,bigint,uuid)',
    $$    OR actor.platform_role NOT IN ('admin', 'curator')
$$, '');
  PERFORM pg_temp.evo_s2_replace('platform.assert_case_finance_stop_factor(uuid,uuid,text,text,text,text,bigint,uuid)',
    $$    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )$$,
    $$    AND platform_private.staff_can_access(student_case.organization_id,actor.membership_id,
      'finance.read.summary','student_case',student_case.id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.assert_case_finance_stop_factor(uuid,uuid,text,text,text,text,bigint,uuid)',
    $$      JOIN platform.role_bundle_versions AS owner_bundle
        ON owner_bundle.id = owner_membership.current_bundle_id
        AND owner_bundle.role = owner_membership."current_role"
$$, '');
  PERFORM pg_temp.evo_s2_replace('platform.assert_case_finance_stop_factor(uuid,uuid,text,text,text,text,bigint,uuid)',
    $$        AND owner_bundle.status = 'published'
$$, '');
END
$migration$;

DO $migration$
DECLARE body TEXT; old_part TEXT; start_pos INTEGER;
  metadata CONSTANT TEXT := 'platform.record_document_version_metadata(uuid,uuid,uuid,text,text,bigint,text,text,uuid)';
BEGIN
  SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='private.create_case_note(uuid,uuid,uuid,text,uuid)'::regprocedure;
  IF md5(body)<>'94a227945c52f11b176383a8c9e9ec79' THEN RAISE EXCEPTION 'Unexpected note preflight definition'; END IF;
  start_pos:=position($$    PERFORM 1
    FROM platform.profiles AS profile$$ IN body);
  old_part:=substring(body FROM start_pos FOR position('    IF NOT FOUND THEN' IN body)-start_pos);
  PERFORM pg_temp.evo_s2_replace('private.create_case_note(uuid,uuid,uuid,text,uuid)',old_part,
    $$    PERFORM 1 FROM platform_private.require_domain_actor_read(p_organization_id,'case.read.full');

$$);
  -- The legacy service metadata RPC remains service-only. Its Student path
  -- keeps its published bundle; staff upload authority is object-scoped.
  PERFORM pg_temp.evo_s2_replace(metadata,
    $$  JOIN platform.role_bundle_versions AS bundle$$,
    $$  LEFT JOIN platform.role_bundle_versions AS bundle$$);
  PERFORM pg_temp.evo_s2_replace(metadata,
    $$    AND bundle.status = 'published'$$,
    $$    AND (membership."current_role" IS DISTINCT FROM 'student' OR bundle.status='published')$$);
  PERFORM pg_temp.evo_s2_replace(metadata,
    $$      OR (
        membership."current_role" = 'curator'
        AND membership.id = target_case.current_curator_membership_id
        AND target_case.state IN ('active', 'closed')
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          membership.id,
          'student_case',
          target_case.id
        )
      )
      OR (
        membership."current_role" = 'admin'
        AND platform_private.membership_has_active_scope(
          p_organization_id,
          membership.id,
          'organization',
          p_organization_id
        )
      )$$,
    $$      OR platform_private.staff_can_access(p_organization_id,membership.id,
        'document.upload','document_slot',p_document_slot_id)$$);
  SELECT prosrc INTO STRICT body FROM pg_proc
    WHERE oid='platform.create_pending_student_case(uuid,uuid,uuid,text,text,timestamp with time zone,text,text,text,text,text,text,text,text,text,uuid)'::regprocedure;
  start_pos:=position($$  SELECT profile.id
  INTO sales_profile_id$$ IN body);
  old_part:=substring(body FROM start_pos FOR position('  IF sales_profile_id IS NULL THEN' IN body)-start_pos);
  PERFORM pg_temp.evo_s2_replace('platform.create_pending_student_case(uuid,uuid,uuid,text,text,timestamp with time zone,text,text,text,text,text,text,text,text,text,uuid)',old_part,
    $$  SELECT profile.id INTO sales_profile_id
  FROM platform.organization_memberships membership
  JOIN platform.profiles profile ON profile.id=membership.profile_id
  JOIN platform.organizations organization ON organization.id=membership.organization_id
  WHERE membership.organization_id=p_organization_id AND membership.id=p_responsible_sales_membership_id
    AND platform_private.is_eligible_sales_owner(p_organization_id,membership.id)
    AND platform_private.staff_has_permission(p_organization_id,membership.id,'case.read.full')
  FOR UPDATE OF membership,profile,organization;

$$);
  PERFORM pg_temp.evo_s2_replace('platform.resolve_client_duplicate(uuid,uuid,uuid,text,uuid)',
    $$authority.platform_role = 'admin'$$,
    $$platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'client.duplicate.resolve','client',platform_private.resolve_canonical_client_id(authority.organization_id,p_survivor_client_id))
      AND platform_private.staff_can_access(authority.organization_id,authority.membership_id,
      'client.duplicate.resolve','client',platform_private.resolve_canonical_client_id(authority.organization_id,p_superseded_client_id))$$, 2);
  PERFORM pg_temp.evo_s2_replace('platform.platform_operational_signals_v1(uuid)',
    $$membership."current_role" = 'admin'$$, $$membership.is_system_admin$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_waha_sales_intake_page(uuid,integer,timestamp with time zone,uuid,text,text)',
    $$actor.platform_role = 'admin'$$,
    $$EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(actor.organization_id,actor.membership_id) i WHERE i.system_role='admin')$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_waha_sales_intake_page(uuid,integer,timestamp with time zone,uuid,text,text)',
    $$actor.platform_role = 'sales'$$,
    $$platform_private.staff_intake_owner_is_eligible(actor.organization_id,actor.membership_id)$$);
END
$migration$;

-- A prepared manual send is an authority-bearing intent, not a durable grant.
-- Existing pending intents without a version must be prepared again; immutable
-- completed conversation history remains available through normal read scope.
ALTER TABLE platform.manual_send_authorizations
  ADD COLUMN authorized_access_version BIGINT CHECK (authorized_access_version>0);
CREATE FUNCTION platform_private.capture_manual_send_authority()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE version BIGINT;
BEGIN
  PERFORM 1 FROM platform.organizations o WHERE o.id=NEW.organization_id FOR KEY SHARE;
  SELECT p.access_version INTO version
  FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id=p.id
  WHERE m.organization_id=NEW.organization_id AND m.id=NEW.authorized_by_membership_id
    AND p.id=NEW.authorized_by_profile_id AND m.status='active' AND p.status='active'
    AND platform_private.staff_can_access(m.organization_id,m.id,'communication.manual.send','conversation',NEW.conversation_id)
  FOR SHARE OF p,m;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manual-send authority is unavailable' USING ERRCODE='42501'; END IF;
  NEW.authorized_access_version:=version;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.capture_manual_send_authority()
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
CREATE TRIGGER manual_send_authorizations_staff_authority BEFORE INSERT ON platform.manual_send_authorizations
  FOR EACH ROW EXECUTE FUNCTION platform_private.capture_manual_send_authority();
DO $migration$
BEGIN
  PERFORM pg_temp.evo_s2_replace('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)',
    $$  SELECT membership.*
  INTO sender_membership$$,
    $$  PERFORM 1 FROM platform.organizations o WHERE o.id=work_item.organization_id FOR KEY SHARE;
  PERFORM 1 FROM platform.profiles p WHERE p.id=authorization_row.authorized_by_profile_id FOR SHARE;
  SELECT membership.*
  INTO sender_membership$$);
  PERFORM pg_temp.evo_s2_replace('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)',
    $$    AND membership.id = authorization_row.authorized_by_membership_id$$,
    $$    AND membership.id = authorization_row.authorized_by_membership_id
    AND profile.id = authorization_row.authorized_by_profile_id
    AND profile.access_version = authorization_row.authorized_access_version$$);
  PERFORM pg_temp.evo_s2_replace('platform.create_pending_student_case(uuid,uuid,uuid,text,text,timestamp with time zone,text,text,text,text,text,text,text,text,text,uuid)',
    $$  result := jsonb_build_object($$,
    $$  IF NOT platform_private.staff_can_access(p_organization_id,p_responsible_sales_membership_id,
    'case.read.full','student_case',created_case_id) THEN
    RAISE EXCEPTION 'The responsible employee cannot access this case' USING ERRCODE='42501';
  END IF;
  result := jsonb_build_object($$);
END
$migration$;

CREATE OR REPLACE FUNCTION platform_private.require_document_storage_actor(
  p_organization_id UUID,p_student_case_id UUID,p_permission_key TEXT
) RETURNS TABLE(actor_profile_id UUID,actor_membership_id UUID,actor_auth_user_id UUID,actor_role platform.business_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; c platform.student_cases%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR p_permission_key IS NULL OR p_permission_key NOT IN ('document.upload','document.download') THEN
    RAISE EXCEPTION 'Document is unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO a FROM platform_private.require_domain_actor(p_organization_id,p_permission_key);
  SELECT * INTO c FROM platform.student_cases WHERE organization_id=p_organization_id AND id=p_student_case_id FOR UPDATE;
  IF NOT FOUND OR NOT (
    platform_private.staff_can_access(p_organization_id,a.actor_membership_id,p_permission_key,'student_case',c.id)
    OR (a.actor_role IS NOT DISTINCT FROM 'student' AND c.state IN ('active','closed')
      AND c.student_membership_id=a.actor_membership_id AND c.portal_activated_at IS NOT NULL
      AND platform_private.membership_has_active_scope(p_organization_id,a.actor_membership_id,'student_case',c.id))
  ) THEN RAISE EXCEPTION 'Document is unavailable' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT a.actor_profile_id,a.actor_membership_id,a.actor_auth_user_id,a.actor_role;
END
$$;
DO $migration$
BEGIN
  PERFORM pg_temp.evo_s2_replace('platform.record_document_version_metadata(uuid,uuid,uuid,text,text,bigint,text,text,uuid)',
    $$  SELECT slot.student_case_id$$,
    $$  PERFORM 1 FROM platform.organizations o WHERE o.id=p_organization_id FOR KEY SHARE;
  SELECT slot.student_case_id$$);
  PERFORM pg_temp.evo_s2_replace('platform.create_pending_student_case(uuid,uuid,uuid,text,text,timestamp with time zone,text,text,text,text,text,text,text,text,text,uuid)',
    $$  PERFORM platform_private.lock_p2d_request(p_request_id);$$,
    $$  PERFORM 1 FROM platform.organizations o WHERE o.id=p_organization_id FOR UPDATE;
  PERFORM platform_private.lock_p2d_request(p_request_id);$$);
END
$migration$;

-- Coarse staff metadata may be NULL. Every mixed staff/Student boolean must
-- remain two-valued; NULL metadata cannot turn a NOT-authorized guard unknown.
DO $migration$
DECLARE signature TEXT; body TEXT; matches INTEGER;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'platform.preflight_document_upload(uuid,uuid,text,text,bigint,text,uuid)',
    'platform.reserve_document_upload_after_ingress_scan(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text,text,timestamp with time zone,uuid)',
    'private.grant_document_download_pre_e5(uuid,uuid,text,integer,uuid)'
  ] LOOP
    SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid=signature::regprocedure;
    matches:=(length(body)-length(replace(body,$$actor.actor_role = 'student'$$,'')))/length($$actor.actor_role = 'student'$$);
    IF matches<1 THEN RAISE EXCEPTION 'Expected preserved Student branch in %',signature; END IF;
    PERFORM pg_temp.evo_s2_replace(signature,$$actor.actor_role = 'student'$$,
      $$actor.actor_role IS NOT DISTINCT FROM 'student'$$,matches);
  END LOOP;
END
$migration$;

-- Provider mutations have their own paired write permission. Read bindings and
-- status still use amocrm_runtime_actor; a read-only assignment cannot dispatch.
CREATE FUNCTION platform_private.require_amocrm_command_actor(
  p_organization_id UUID,p_actor_role TEXT,p_workflow_scope TEXT,
  p_workflow_lead_id UUID,p_student_case_id UUID
) RETURNS TABLE(organization_id UUID,actor_profile_id UUID,actor_membership_id UUID,
  actor_auth_user_id UUID,actor_display_name TEXT,actor_role TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;
BEGIN
  PERFORM 1 FROM platform.organizations o WHERE o.id=p_organization_id FOR UPDATE;
  SELECT * INTO STRICT a FROM platform_private.amocrm_runtime_actor(
    p_organization_id,p_actor_role,p_workflow_scope,p_workflow_lead_id,p_student_case_id);
  IF NOT platform_private.staff_can_access(p_organization_id,a.actor_membership_id,
    'amocrm.command.manage',
    CASE WHEN p_workflow_scope='sales_pre_handoff' THEN 'lead' ELSE 'student_case' END,
    CASE WHEN p_workflow_scope='sales_pre_handoff' THEN p_workflow_lead_id ELSE p_student_case_id END)
  THEN RAISE EXCEPTION 'amocrm_command_forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT a.organization_id,a.actor_profile_id,a.actor_membership_id,
    a.actor_auth_user_id,a.actor_display_name,a.actor_role;
END
$$;

-- Immutable receipts retain the version that authorized the operation. Old
-- prepared receipts without a version cannot newly dispatch; history remains.
ALTER TABLE platform_private.amocrm_command_receipts
  ADD COLUMN actor_access_version BIGINT CHECK(actor_access_version>0);
CREATE FUNCTION platform_private.capture_amocrm_command_authority()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; identity RECORD;
BEGIN
  SELECT * INTO STRICT a FROM platform_private.require_amocrm_command_actor(
    NEW.organization_id,NEW.actor_role,NEW.workflow_scope,NEW.workflow_lead_id,NEW.student_case_id);
  IF a.actor_profile_id IS DISTINCT FROM NEW.actor_profile_id
    OR a.actor_membership_id IS DISTINCT FROM NEW.actor_membership_id
    OR a.actor_auth_user_id IS DISTINCT FROM NEW.actor_auth_user_id THEN
    RAISE EXCEPTION 'amocrm_command_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT identity FROM platform_private.staff_membership_identity(NEW.organization_id,NEW.actor_membership_id);
  NEW.actor_access_version:=identity.access_version;
  RETURN NEW;
END
$$;
CREATE TRIGGER amocrm_command_receipts_staff_authority
  BEFORE INSERT ON platform_private.amocrm_command_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.capture_amocrm_command_authority();

CREATE FUNCTION platform_private.require_current_amocrm_receipt(p_organization_id UUID,p_receipt_id UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt platform_private.amocrm_command_receipts%ROWTYPE; identity RECORD; descriptor TEXT;
BEGIN
  PERFORM 1 FROM platform.organizations o WHERE o.id=p_organization_id FOR KEY SHARE;
  SELECT * INTO receipt FROM platform_private.amocrm_command_receipts r
    WHERE r.organization_id=p_organization_id AND r.id=p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'amocrm_command_forbidden' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform.profiles p WHERE p.id=receipt.actor_profile_id FOR SHARE;
  PERFORM 1 FROM platform.organization_memberships m WHERE m.id=receipt.actor_membership_id FOR SHARE;
  SELECT * INTO identity FROM platform_private.staff_membership_identity(p_organization_id,receipt.actor_membership_id);
  IF identity.membership_id IS NULL OR identity.profile_id IS DISTINCT FROM receipt.actor_profile_id
    OR identity.auth_user_id IS DISTINCT FROM receipt.actor_auth_user_id
    OR identity.access_version IS DISTINCT FROM receipt.actor_access_version THEN
    RAISE EXCEPTION 'amocrm_command_authority_changed' USING ERRCODE='42501';
  END IF;
  descriptor:=CASE WHEN identity.system_role='admin' THEN 'admin'
    WHEN receipt.workflow_scope='sales_pre_handoff' THEN 'sales'
    WHEN receipt.workflow_scope='admissions_post_handoff' THEN 'admissions' END;
  IF descriptor IS NULL OR descriptor IS DISTINCT FROM receipt.actor_role
    OR NOT platform_private.staff_can_access(p_organization_id,identity.membership_id,
      'lead.read','lead',receipt.workflow_lead_id)
    OR NOT platform_private.staff_can_access(p_organization_id,identity.membership_id,
      'amocrm.command.manage',CASE WHEN receipt.workflow_scope='sales_pre_handoff' THEN 'lead' ELSE 'student_case' END,
      CASE WHEN receipt.workflow_scope='sales_pre_handoff' THEN receipt.workflow_lead_id ELSE receipt.student_case_id END)
    OR (receipt.workflow_scope='sales_pre_handoff' AND receipt.student_case_id IS NOT NULL)
    OR (receipt.workflow_scope='admissions_post_handoff' AND (
      NOT platform_private.staff_can_access(p_organization_id,identity.membership_id,
        'case.read.full','student_case',receipt.student_case_id)
      OR NOT EXISTS(SELECT 1 FROM platform.student_cases c WHERE c.organization_id=p_organization_id
        AND c.id=receipt.student_case_id AND c.canonical_lead_id=receipt.workflow_lead_id)))
  THEN RAISE EXCEPTION 'amocrm_command_authority_changed' USING ERRCODE='42501'; END IF;
END
$$;
REVOKE ALL ON FUNCTION platform_private.require_amocrm_command_actor(UUID,TEXT,TEXT,UUID,UUID),
  platform_private.capture_amocrm_command_authority(),
  platform_private.require_current_amocrm_receipt(UUID,UUID)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;

DO $migration$
BEGIN
  PERFORM pg_temp.evo_s2_replace(
    'platform.prepare_amocrm_command(uuid,jsonb,uuid,uuid,platform.amocrm_command_operation,text,text,text,jsonb)',
    'platform_private.amocrm_runtime_actor(', 'platform_private.require_amocrm_command_actor(');
  PERFORM pg_temp.evo_s2_replace('platform.release_prepared_amocrm_command(uuid,jsonb,uuid,uuid,uuid,uuid)',
    'platform_private.amocrm_runtime_actor(', 'platform_private.require_amocrm_command_actor(');
  PERFORM pg_temp.evo_s2_replace('platform.claim_amocrm_command(uuid,uuid,uuid,text,integer)',
    $$  SELECT *
  INTO attempt_row$$,
    $$  PERFORM 1 FROM platform.organizations o WHERE o.id=p_organization_id FOR KEY SHARE;
  SELECT *
  INTO attempt_row$$);
  -- Replayed/already-dispatched outcomes remain readable. Recheck only before
  -- the one-way prepared -> provider-dispatched transition, never on recovery.
  PERFORM pg_temp.evo_s2_replace('platform.claim_amocrm_command(uuid,uuid,uuid,text,integer)',
    $$  UPDATE platform_private.amocrm_command_attempts
  SET$$,
    $$  PERFORM platform_private.require_current_amocrm_receipt(p_organization_id,attempt_row.command_receipt_id);
  UPDATE platform_private.amocrm_command_attempts
  SET$$);
  PERFORM pg_temp.evo_s2_replace('platform.assert_case_finance_stop_factor(uuid,uuid,text,text,text,text,bigint,uuid)',
    $$      'finance.read.summary','student_case',student_case.id)$$,
    $$      'finance.read.summary','student_case',student_case.id)
    AND platform_private.staff_can_access(student_case.organization_id,actor.membership_id,
      'finance.stop.create','student_case',student_case.id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.student_portal_messages(uuid)',
    $$actor.actor_role <> 'student'$$,$$actor.actor_role IS DISTINCT FROM 'student'$$);
  PERFORM pg_temp.evo_s2_replace('platform_private.write_student_assessment(text,text,uuid,bigint,jsonb,uuid)',
    $$locked_actor.actor_role <> 'student'$$,$$locked_actor.actor_role IS DISTINCT FROM 'student'$$);
END
$migration$;

-- Remaining operational exceptions use the protected Admin identity, not a
-- nullable historical role label. Keep the existing active-case/reason rules.
DO $migration$
BEGIN
  PERFORM pg_temp.evo_s2_replace(
    'platform_private.coverage_change_task_body(uuid,uuid,platform.case_task_status,uuid,platform.case_task_priority,timestamp with time zone,date,boolean,bigint,uuid,text)',
    $$IF actor.actor_role = 'curator' AND ($$,
    $$IF NOT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id,actor.actor_membership_id) i
    WHERE i.system_role='admin') AND ($$);
  PERFORM pg_temp.evo_s2_replace(
    'platform_private.coverage_change_task_body(uuid,uuid,platform.case_task_status,uuid,platform.case_task_priority,timestamp with time zone,date,boolean,bigint,uuid,text)',
    $$IF p_reason IS NULL AND actor.actor_role <> 'admin' AND ($$,
    $$IF p_reason IS NULL AND NOT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id,actor.actor_membership_id) i
    WHERE i.system_role='admin') AND ($$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_lead_admissions_handoff(uuid)',
    $$      AND (
        actor.platform_role = 'admin'
        OR lead.current_owner_membership_id = actor.membership_id
      )$$,
    $$      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,
        'lead.sales.workflow.manage','lead',lead.id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.staff_lead_admissions_handoff(uuid)',
    $$      AND actor.platform_role = 'admin'$$,
    $$      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,
        'lead.sales.workflow.manage','lead',lead.id)
      AND platform_private.staff_can_access(lead.organization_id,actor.membership_id,
        'admissions.handoff.gate.override','lead',lead.id)$$);
  -- Student sees only their published task projection. The displayed assignee
  -- can be any currently active staff identity with a custom role.
  PERFORM pg_temp.evo_s2_replace('platform.student_portal_overview_v2()',
    $$      AND assignee_membership."current_role" IN ('admin', 'sales', 'curator')$$,
    $$      AND EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(
        task.organization_id,assignee_membership.id))$$);
  PERFORM pg_temp.evo_s2_replace('platform.student_portal_overview_v2()',
    $$    JOIN platform.role_bundle_versions AS assignee_bundle
      ON assignee_bundle.id = assignee_membership.current_bundle_id
      AND assignee_bundle.role = assignee_membership."current_role"
      AND assignee_bundle.status = 'published'
$$,'');
  PERFORM pg_temp.evo_s2_replace('platform.student_portal_overview_v2()',
    $$    JOIN platform.role_bundle_versions AS curator_bundle
      ON curator_bundle.id = curator_membership.current_bundle_id
      AND curator_bundle.role = curator_membership."current_role"
      AND curator_bundle.status = 'published'
$$,'');
  PERFORM pg_temp.evo_s2_replace('platform.student_portal_overview_v2()',
    $$platform_private.is_eligible_staff_responsibility(curator_membership.organization_id, curator_membership.id, 'curator')$$,
    $$platform_private.staff_can_access(curator_membership.organization_id,curator_membership.id,
        'case.read.full','student_case',student_case.id)$$);
  PERFORM pg_temp.evo_s2_replace('platform.create_case_help_request_v1(text,text,uuid)',
    $$(m.current_role='admin' OR(m.current_role='curator' AND m.id=c.current_curator_membership_id))$$,
    $$(m.is_system_admin OR m.id=c.current_curator_membership_id)
 AND platform_private.staff_can_access(m.organization_id,m.id,'case.read.full','student_case',c.id)$$);
  PERFORM pg_temp.evo_s2_replace('private.manage_case_coverage(text,uuid,uuid,uuid,bigint,uuid,date,uuid,bigint,jsonb,text,uuid)',
    $$task.assignee_role<>'admin'$$,
    $$NOT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id,task.assignee_membership_id) i
        WHERE i.system_role='admin')$$,2);
  PERFORM pg_temp.evo_s2_replace('private.manage_case_coverage(text,uuid,uuid,uuid,bigint,uuid,date,uuid,bigint,jsonb,text,uuid)',
    $$AND "current_role"='admin' AND status='active' FOR UPDATE$$,
    $$AND is_system_admin AND status='active' FOR UPDATE$$);
  PERFORM pg_temp.evo_s2_replace('private.manage_case_coverage(text,uuid,uuid,uuid,bigint,uuid,date,uuid,bigint,jsonb,text,uuid)',
    $$    JOIN platform.role_bundle_versions AS bundle ON bundle.id=membership.current_bundle_id
      AND bundle.role=membership."current_role" AND bundle.status='published'
$$,'');
  PERFORM pg_temp.evo_s2_replace('private.manage_case_coverage(text,uuid,uuid,uuid,bigint,uuid,date,uuid,bigint,jsonb,text,uuid)',
    $$platform_private.is_eligible_staff_responsibility(membership.organization_id, membership.id, 'curator')$$,
    $$platform_private.staff_can_receive_assignment(membership.organization_id,membership.id,
        'case.read.full','student_case',p_student_case_id)
      AND platform_private.staff_can_receive_assignment(membership.organization_id,membership.id,
        'task.manage','student_case',p_student_case_id)$$);
END
$migration$;

DROP FUNCTION pg_temp.evo_s2_replace(TEXT,TEXT,TEXT,INTEGER);
COMMIT;
