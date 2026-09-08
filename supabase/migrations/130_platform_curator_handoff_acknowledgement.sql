-- UX-3: acknowledgement is not a second handoff or an access gate.
-- Official security/locking basis (reviewed 2026-09-08):
-- https://supabase.com/docs/guides/database/functions
-- https://www.postgresql.org/docs/current/explicit-locking.html
BEGIN;

CREATE TABLE platform.student_case_handoff_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  handoff_id UUID NOT NULL,
  assignment_event_id UUID NOT NULL
    REFERENCES platform.student_case_assignment_events(id) ON DELETE RESTRICT,
  curator_membership_id UUID NOT NULL,
  revision BIGINT NOT NULL CHECK (revision > 0),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'clarification_requested')),
  clarification TEXT,
  agreed_contact_date DATE CHECK (
    agreed_contact_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
  ),
  expected_acknowledgement_id UUID
    REFERENCES platform.student_case_handoff_acknowledgements(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, handoff_id)
    REFERENCES platform.sales_admissions_handoffs(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, curator_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (assignment_event_id, revision),
  CHECK (
    (decision = 'accepted' AND clarification IS NULL)
    OR (decision = 'clarification_requested' AND clarification IS NOT NULL
      AND char_length(btrim(clarification)) BETWEEN 1 AND 2000)
  )
);

CREATE INDEX student_case_handoff_acknowledgements_case_idx
  ON platform.student_case_handoff_acknowledgements
    (organization_id, student_case_id, created_at DESC, id DESC);
ALTER TABLE platform.student_case_handoff_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_case_handoff_acknowledgements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.student_case_handoff_acknowledgements
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
CREATE TRIGGER student_case_handoff_acknowledgements_append_only
  BEFORE UPDATE OR DELETE ON platform.student_case_handoff_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION private.forbid_case_note_change();
CREATE TRIGGER student_case_handoff_acknowledgements_no_truncate
  BEFORE TRUNCATE ON platform.student_case_handoff_acknowledgements
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_case_note_change();

CREATE FUNCTION private.staff_student_case_handoff_acknowledgement(p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  assignment_id UUID;
  current_response JSONB;
BEGIN
  SELECT * INTO actor
  FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);
  SELECT * INTO STRICT target_case FROM platform.student_cases
  WHERE organization_id = actor.organization_id AND id = p_student_case_id;

  -- Scope versions strictly increase on reassignment, including away/back.
  -- Do not bind to a membership alone or to the original handoff owner.
  SELECT assignment.id INTO assignment_id
  FROM platform.student_case_assignment_events AS assignment
  WHERE assignment.organization_id = actor.organization_id
    AND assignment.student_case_id = p_student_case_id
    AND assignment.new_curator_membership_id = target_case.current_curator_membership_id
  ORDER BY assignment.new_scope_version DESC LIMIT 1;

  SELECT jsonb_build_object(
    'acknowledgement_id', response.id, 'decision', response.decision,
    'clarification', response.clarification,
    'agreed_contact_date', response.agreed_contact_date,
    'created_at', response.created_at
  ) INTO current_response
  FROM platform.student_case_handoff_acknowledgements AS response
  WHERE response.organization_id = actor.organization_id
    AND response.student_case_id = p_student_case_id
    AND response.assignment_event_id = assignment_id
    AND response.curator_membership_id = target_case.current_curator_membership_id
  ORDER BY response.revision DESC LIMIT 1;

  RETURN jsonb_build_object(
    'organization_id', actor.organization_id, 'student_case_id', p_student_case_id,
    'assignment_event_id', assignment_id,
    'can_respond', actor.platform_role = 'curator'
      AND actor.membership_id = target_case.current_curator_membership_id
      AND target_case.state = 'active' AND assignment_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM platform.sales_admissions_handoffs AS handoff
        WHERE handoff.organization_id = actor.organization_id
          AND handoff.student_case_id = p_student_case_id),
    'current', current_response
  );
END
$$;

CREATE FUNCTION private.respond_student_case_handoff(
  p_organization_id UUID, p_student_case_id UUID, p_assignment_event_id UUID,
  p_expected_acknowledgement_id UUID, p_decision TEXT, p_clarification TEXT,
  p_agreed_contact_date DATE, p_request_id UUID
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  assignment_id UUID;
  handoff_id UUID;
  current_response platform.student_case_handoff_acknowledgements%ROWTYPE;
  response platform.student_case_handoff_acknowledgements%ROWTYPE;
  normalized_clarification TEXT := nullif(btrim(p_clarification,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '');
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR p_assignment_event_id IS NULL OR p_request_id IS NULL
    OR p_decision IS NULL OR p_decision NOT IN ('accepted', 'clarification_requested')
    OR (p_decision = 'accepted' AND normalized_clarification IS NOT NULL)
    OR (p_decision = 'clarification_requested' AND normalized_clarification IS NULL)
    OR char_length(normalized_clarification) > 2000
    OR normalized_clarification ~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
    OR (p_agreed_contact_date IS NOT NULL AND
      p_agreed_contact_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
  THEN
    RAISE EXCEPTION 'Invalid handoff response' USING ERRCODE = '22023';
  END IF;

  -- Read-only auth preflight before accepting an organization advisory key.
  PERFORM 1 FROM platform_private.require_domain_actor_read(p_organization_id, 'case.read.full');
  -- Same order as notes and Admin assignment: domain, request, actor, case.
  PERFORM platform_private.lock_student_case_note_assignment_domain(p_organization_id);
  PERFORM platform_private.lock_p2d_request(p_request_id);
  SELECT * INTO actor FROM private.require_student_case_note_mutation_actor(
    p_organization_id, p_student_case_id);
  -- Fresh authorization after any row-lock wait, while actor/case locks remain held.
  PERFORM 1 FROM platform_private.require_domain_actor_read(p_organization_id, 'case.read.full');
  IF actor.actor_role <> 'curator' OR NOT EXISTS (
    SELECT 1 FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = p_organization_id
      AND student_case.id = p_student_case_id AND student_case.state = 'active'
      AND student_case.current_curator_membership_id = actor.actor_membership_id
  ) THEN
    RAISE EXCEPTION 'Current Curator is required' USING ERRCODE = '42501';
  END IF;

  SELECT assignment.id INTO assignment_id
  FROM platform.student_case_assignment_events AS assignment
  WHERE assignment.organization_id = p_organization_id
    AND assignment.student_case_id = p_student_case_id
    AND assignment.new_curator_membership_id = actor.actor_membership_id
  ORDER BY assignment.new_scope_version DESC LIMIT 1;
  IF assignment_id IS DISTINCT FROM p_assignment_event_id THEN
    RAISE EXCEPTION 'Handoff assignment changed' USING ERRCODE = '40001';
  END IF;
  SELECT handoff.id INTO handoff_id FROM platform.sales_admissions_handoffs AS handoff
  WHERE handoff.organization_id = p_organization_id
    AND handoff.student_case_id = p_student_case_id;
  IF handoff_id IS NULL THEN
    RAISE EXCEPTION 'Completed handoff is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO response FROM platform.student_case_handoff_acknowledgements
  WHERE request_id = p_request_id;
  IF FOUND THEN
    IF response.organization_id IS DISTINCT FROM p_organization_id
      OR response.student_case_id IS DISTINCT FROM p_student_case_id
      OR response.assignment_event_id IS DISTINCT FROM p_assignment_event_id
      OR response.curator_membership_id IS DISTINCT FROM actor.actor_membership_id
      OR response.expected_acknowledgement_id IS DISTINCT FROM p_expected_acknowledgement_id
      OR response.decision IS DISTINCT FROM p_decision
      OR response.clarification IS DISTINCT FROM normalized_clarification
      OR response.agreed_contact_date IS DISTINCT FROM p_agreed_contact_date
    THEN
      RAISE EXCEPTION 'Handoff request was already used' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = p_request_id) THEN
      RAISE EXCEPTION 'Handoff request was already used' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO current_response FROM platform.student_case_handoff_acknowledgements
    WHERE organization_id = p_organization_id AND student_case_id = p_student_case_id
      AND assignment_event_id = p_assignment_event_id
    ORDER BY revision DESC LIMIT 1;
    IF current_response.id IS DISTINCT FROM p_expected_acknowledgement_id THEN
      RAISE EXCEPTION 'Handoff response changed' USING ERRCODE = '40001';
    END IF;
    INSERT INTO platform.student_case_handoff_acknowledgements (
      organization_id, student_case_id, handoff_id, assignment_event_id,
      curator_membership_id, revision, decision, clarification, agreed_contact_date,
      expected_acknowledgement_id, request_id
    ) VALUES (
      p_organization_id, p_student_case_id, handoff_id, assignment_id,
      actor.actor_membership_id, COALESCE(current_response.revision, 0) + 1,
      p_decision, normalized_clarification, p_agreed_contact_date,
      p_expected_acknowledgement_id, p_request_id
    ) RETURNING * INTO response;

    INSERT INTO platform.audit_events (
      organization_id, actor_kind, actor_profile_id, actor_membership_id,
      actor_principal, action, resource_type, resource_id, before_state,
      after_state, reason, request_id
    ) VALUES (
      p_organization_id, 'user', actor.actor_profile_id, actor.actor_membership_id,
      'auth:' || actor.actor_auth_user_id::TEXT,
      CASE p_decision WHEN 'accepted' THEN 'case.handoff.acknowledge'
        ELSE 'case.handoff.clarification' END,
      'student_case', p_student_case_id,
      jsonb_build_object('acknowledgement_id', current_response.id),
      jsonb_build_object('acknowledgement_id', response.id,
        'assignment_event_id', assignment_id, 'decision', p_decision,
        'agreed_contact_date', p_agreed_contact_date),
      'Curator handoff response recorded', p_request_id
    );
  END IF;
  -- Receipt is the exact committed response, not an optimistic UI success.
  RETURN jsonb_build_object(
    'organization_id', response.organization_id, 'student_case_id', response.student_case_id,
    'assignment_event_id', response.assignment_event_id,
    'acknowledgement_id', response.id, 'request_id', response.request_id,
    'decision', response.decision, 'clarification', response.clarification,
    'agreed_contact_date', response.agreed_contact_date, 'created_at', response.created_at
  );
END
$$;

REVOKE ALL ON FUNCTION private.staff_student_case_handoff_acknowledgement(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.respond_student_case_handoff(UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.staff_student_case_handoff_acknowledgement(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.respond_student_case_handoff(UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, UUID) TO authenticated;

CREATE FUNCTION platform.staff_student_case_handoff_acknowledgement(p_student_case_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.staff_student_case_handoff_acknowledgement(p_student_case_id)
$$;
CREATE FUNCTION platform.respond_student_case_handoff(
  p_organization_id UUID, p_student_case_id UUID, p_assignment_event_id UUID,
  p_expected_acknowledgement_id UUID, p_decision TEXT, p_clarification TEXT,
  p_agreed_contact_date DATE, p_request_id UUID
)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.respond_student_case_handoff(p_organization_id, p_student_case_id,
    p_assignment_event_id, p_expected_acknowledgement_id, p_decision,
    p_clarification, p_agreed_contact_date, p_request_id)
$$;
REVOKE ALL ON FUNCTION platform.staff_student_case_handoff_acknowledgement(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.respond_student_case_handoff(UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_handoff_acknowledgement(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.respond_student_case_handoff(UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, UUID) TO authenticated;

-- Former Sales needs the current clarification, not the Admissions history.
-- Reuse the existing exact lead handoff-summary ownership gate and return
-- only decision/prose/date: no assignment, actor, audit or response-history IDs.
CREATE FUNCTION private.staff_lead_handoff_acknowledgement(p_lead_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  handoff RECORD;
  current_response JSONB;
BEGIN
  SELECT * INTO handoff FROM platform.staff_lead_admissions_handoff(p_lead_id);
  IF NOT FOUND OR handoff.case_id IS NULL OR handoff.handed_off_at IS NULL THEN
    RAISE EXCEPTION 'Handoff summary is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('decision', response.decision,
    'clarification', response.clarification, 'agreed_contact_date', response.agreed_contact_date)
  INTO current_response
  FROM platform.student_cases AS student_case
  JOIN LATERAL (
    SELECT event.id FROM platform.student_case_assignment_events AS event
    WHERE event.organization_id = student_case.organization_id
      AND event.student_case_id = student_case.id
      AND event.new_curator_membership_id = student_case.current_curator_membership_id
    ORDER BY event.new_scope_version DESC LIMIT 1
  ) AS assignment ON TRUE
  JOIN platform.student_case_handoff_acknowledgements AS response
    ON response.organization_id = student_case.organization_id
    AND response.student_case_id = student_case.id
    AND response.assignment_event_id = assignment.id
    AND response.curator_membership_id = student_case.current_curator_membership_id
  WHERE student_case.organization_id = handoff.organization_id
    AND student_case.id = handoff.case_id
  ORDER BY response.revision DESC LIMIT 1;
  RETURN jsonb_build_object('organization_id', handoff.organization_id,
    'lead_id', p_lead_id, 'student_case_id', handoff.case_id,
    'can_respond', FALSE, 'current', current_response);
END
$$;
CREATE FUNCTION platform.staff_lead_handoff_acknowledgement(p_lead_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.staff_lead_handoff_acknowledgement(p_lead_id)
$$;
REVOKE ALL ON FUNCTION private.staff_lead_handoff_acknowledgement(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_lead_handoff_acknowledgement(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.staff_lead_handoff_acknowledgement(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_lead_handoff_acknowledgement(UUID) TO authenticated;

COMMIT;
