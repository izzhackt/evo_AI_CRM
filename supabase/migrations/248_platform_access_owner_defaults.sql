-- Доступ по решениям владельца B и C (26.09.2026). docs/PLAN_CHANGES.md
-- «2026-09-26 — Доступ по решениям владельца: кураторы, приглашение в
-- кабинет, меню (миграция 248)». 246 and 247 belong to parallel slices; the
-- number is renumbered at merge if needed.
--
-- Owner defaults after the 26.09 access audit (announced as «what I'll do
-- unless you object», no objection):
--  B) the Admissions Manager (the role holds case.curator.assign, department
--     scope) assigns and reassigns curators and sees the pending and
--     «Ждут куратора» cases of the admissions department;
--  C) the Sales Manager (lead.sales.workflow.manage) sends and reissues the
--     student-cabinet invite for the leads it can access.
-- (Decision D — the «Продажи» menu group — is application code only.)
--
-- Why: 244 made board moves, the requirements save, lead cabinet preparation
-- and curator assignment work for invited staff (coarse role NULL since 155),
-- but kept assignment, the curator options and the cabinet invite as they
-- were, pending these decisions:
--   * private.assign_case_curator_v1 (244) and
--     platform.staff_student_portal_curator_options (149:162-163) require
--     require_admin_actor, so a department holder of case.curator.assign is
--     refused;
--   * a pending case is owned by its responsible Sales member
--     (platform_private.staff_resource_context, 155), so a department scope
--     of the admissions department never covers a case a curator declined:
--     its «Ждут куратора» view stays empty;
--   * require_student_portal_cabinet_actor_e1 (185:337),
--     assert_student_portal_cabinet_membership_e1 (185:372) and the post-lock
--     identity check of prepare_student_portal_provisioning (185:754, as 193
--     and 194 left it) require the coarse role IN ('admin','sales'), which no
--     invited member has, and staff_student_case_cabinet_origin_v1 (185)
--     answers only case.read.full readers, so the lead card cannot tell the
--     Sales Manager that its lead's cabinet case waits for an invite.
--
-- The rule for B (the smallest one that works for a one-department team and
-- never reads more than the manager could read while the case was active):
-- a pending case that needs a curator (182's needs_curator shape: pending,
-- no curator, sale or handoff evidence) belongs, besides its existing owner
-- contexts, to the curator whose decline returned it to pending (the latest
-- 'declined' lifecycle event — 'declined' is the only active -> pending
-- transition). A member whose role holds BOTH case.read.full and
-- case.curator.assign in a scope that covers that curator reads and assigns
-- the case. With the curator as the owner, only a department scope adds
-- anything (the organization scope and the Admin already pass; the case's
-- direction and record scopes already match), and the curator who declined
-- is excluded, so its own scope never gets the case back (182 took it). So:
-- the Admissions Manager sees exactly the declined cases its department
-- curated while active. Pre-sale cases (a lead cabinet, an approved
-- application) carry no sale evidence and stay with Sales: admissions staff
-- never read them in any state.
--
-- Forward-only, on the LATEST definitions (nothing later than the migrations
-- named patches them): SECURITY DEFINER, search_path = '', no signature,
-- owner or grant change of an existing function, error codes and messages
-- unchanged except where the refusal now comes from the permission check
-- (below):
--  a) platform_private.needs_curator_case_last_curator(org, case) and
--     platform_private.staff_can_take_needs_curator_case(org, member, case):
--     the rule above; new, private, no grants.
--  b) private.platform_can_read_student_case (156): the unchanged
--     case.read.full check first; only when it refuses, the rule (a) for the
--     current staff actor. Read-only: every write on a case checks its own
--     permission on the case (staff_can_access), which (a) does not touch.
--  c) private.assign_case_curator_v1 (244): the read-only preflight is
--     require_domain_actor_read(case.curator.assign) instead of
--     require_admin_actor — the 156 pattern of private.assign_student_case_curator
--     and private.manage_case_coverage; after the assignment-domain and
--     request locks the new platform_private.require_case_curator_assigner_locked
--     locks the organization, profile and membership rows (require_domain_actor)
--     and checks case.curator.assign on the case or the rule (a). The Admin
--     passes as before (organization-wide). Replay, the needs-curator shape
--     check, the eligible-curator check and the journal are unchanged
--     (assign_student_case_curator_authorized_e1). A caller without
--     case.curator.assign now gets 42501 'Active Platform permission is
--     required' instead of 42501 'System Admin is required'.
--  d) platform.staff_student_portal_curator_options (149): holders of
--     case.curator.assign (require_domain_actor_read) instead of two
--     require_admin_actor calls — the same eligible curators the «Нагрузка
--     кураторов» read (private.read_curator_coverage_workspace) already lists
--     to them.
--  e) platform_private.require_student_portal_cabinet_actor_e1 (185): staff,
--     not a student, instead of the coarse IN ('admin','sales');
--     staff_can_access(..., 'lead.sales.workflow.manage', 'lead', lead)
--     decides, as before.
--  f) platform_private.assert_student_portal_cabinet_membership_e1 (185): the
--     coarse predicate is dropped; staff_membership_identity already returns
--     only an active, non-student member of an active organization, and the
--     live lead permission decides.
--  g) platform.prepare_student_portal_provisioning (185 + 193 + 194): the one
--     post-lock identity condition of the cabinet_pending branch
--     (self-verifying anchor replace, the 244 pattern). Input and email
--     checks, the fingerprint replay, the case and email reservations, the
--     normal_u6/legacy_pending branches (Admin only) and the dispatch
--     machinery are unchanged.
--  h) platform.staff_student_case_cabinet_origin_v1 (185): also answers a
--     staff member who holds lead.sales.workflow.manage on the case's own
--     lead-cabinet lead — the same authority the invite requires — so the
--     lead card can offer the invite. It still returns only a boolean.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) The needs-curator rule
-- ---------------------------------------------------------------------------
-- The curator whose decline (182) returned a needs-curator case to pending;
-- NULL for any other case.
CREATE FUNCTION platform_private.needs_curator_case_last_curator(
  p_organization_id UUID, p_student_case_id UUID
) RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT declined.actor_membership_id
  FROM platform.student_cases AS c
  CROSS JOIN LATERAL (
    SELECT e.actor_membership_id FROM platform.student_case_lifecycle_events AS e
    WHERE e.organization_id = c.organization_id AND e.student_case_id = c.id AND e.event_type = 'declined'
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1
  ) AS declined
  WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id
    AND c.state = 'pending' AND c.current_curator_membership_id IS NULL
    AND platform_private.case_sale_or_handoff_evidence(c.organization_id, c.id)
$$;

-- A member reads and assigns a needs-curator case when its role holds both
-- case.read.full and case.curator.assign in a scope that covers the curator
-- who declined it (in practice: that curator's department). The curator who
-- declined is never covered through its own scope.
CREATE FUNCTION platform_private.staff_can_take_needs_curator_case(
  p_organization_id UUID, p_membership_id UUID, p_student_case_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((
    SELECT last_curator.membership_id <> p_membership_id
      AND platform_private.staff_context_can_access(p_organization_id, p_membership_id,
        'case.read.full', 'student_case', p_student_case_id,
        last_curator.membership_id, p_student_case_id, NULL)
      AND platform_private.staff_context_can_access(p_organization_id, p_membership_id,
        'case.curator.assign', 'student_case', p_student_case_id,
        last_curator.membership_id, p_student_case_id, NULL)
    FROM (SELECT platform_private.needs_curator_case_last_curator(p_organization_id, p_student_case_id)
      AS membership_id) AS last_curator
    WHERE last_curator.membership_id IS NOT NULL
  ), FALSE)
$$;

REVOKE ALL ON FUNCTION
  platform_private.needs_curator_case_last_curator(UUID, UUID),
  platform_private.staff_can_take_needs_curator_case(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- b) private.platform_can_read_student_case (156): the rule after the
-- unchanged case.read.full check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.platform_can_read_student_case(
  p_organization_id UUID, p_student_case_id UUID
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
    WHEN platform_private.staff_can_access_for_actor(
      p_organization_id, 'case.read.full', 'student_case', p_student_case_id) THEN TRUE
    -- 248: a needs-curator case also reads for the staff member who may
    -- assign it (owner decision B); students never match.
    ELSE EXISTS (
      SELECT 1 FROM platform.current_actor_authority() AS a
      WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student'
        AND platform_private.staff_can_take_needs_curator_case(a.organization_id, a.membership_id, p_student_case_id))
  END
$$;

-- ---------------------------------------------------------------------------
-- c) Curator assignment for holders of case.curator.assign
-- ---------------------------------------------------------------------------
-- Post-lock authority of assign_case_curator_v1: row locks on the
-- organization, the actor's profile and membership and a fresh read of the
-- actor (require_domain_actor, as 156's require_case_operator), then
-- case.curator.assign on this case or the needs-curator rule (a).
CREATE FUNCTION platform_private.require_case_curator_assigner_locked(
  p_organization_id UUID, p_student_case_id UUID
) RETURNS TABLE(actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.require_domain_actor(p_organization_id, 'case.curator.assign');
  IF NOT platform_private.staff_can_access(p_organization_id, actor.actor_membership_id,
      'case.curator.assign', 'student_case', p_student_case_id)
    AND NOT platform_private.staff_can_take_needs_curator_case(p_organization_id,
      actor.actor_membership_id, p_student_case_id)
  THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.actor_profile_id, actor.actor_membership_id, actor.actor_auth_user_id;
END
$$;
REVOKE ALL ON FUNCTION platform_private.require_case_curator_assigner_locked(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION private.assign_case_curator_v1(
  p_organization_id UUID, p_request_id UUID, p_student_case_id UUID,
  p_curator_membership_id UUID, p_reason TEXT
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_student_case_id IS NULL OR p_curator_membership_id IS NULL OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'Assignment reason of 1 to 1000 characters is required' USING ERRCODE = '22023';
  END IF;

  -- 248: read-only preflight before the shared assignment-domain lock — the
  -- actor's role holds case.curator.assign (the Admin, the Admissions
  -- Manager), as 156 made private.assign_student_case_curator and
  -- private.manage_case_coverage check it.
  PERFORM 1 FROM platform_private.require_domain_actor_read(p_organization_id, 'case.curator.assign');
  PERFORM platform_private.lock_student_case_note_assignment_domain(p_organization_id);
  PERFORM platform_private.lock_p2d_request(p_request_id);
  -- 248: after the locks — row locks, the live actor, and case.curator.assign
  -- on this case or the needs-curator rule of its department.
  SELECT * INTO actor FROM platform_private.require_case_curator_assigner_locked(p_organization_id, p_student_case_id);

  -- A successful call moves the case out of 'pending', so a retried request
  -- (same request_id) must replay the cached result BEFORE the needs-curator
  -- shape check below — otherwise a network retry after a real success would
  -- fail closed on "Case does not need a curator assignment" instead of
  -- returning the original receipt. Same action/shape
  -- assign_student_case_curator_authorized_e1 itself checks again internally.
  replayed := platform_private.replay_audit(
    p_request_id, 'case.curator.set', 'student_case', p_student_case_id, btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id, 'student_case_id', p_student_case_id,
      'curator_membership_id', p_curator_membership_id
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target_case FROM platform.student_cases
  WHERE organization_id = p_organization_id AND id = p_student_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  -- Scoped to the needs-curator shape only: a pending case with sale/handoff
  -- evidence (declined-assignment revert today). A bare S1 cabinet-before-sale
  -- case is not assignable through this entry point — plan §7 only covers
  -- reassigning an existing sale's case, never a manual early assignment.
  IF target_case.state <> 'pending'
    OR NOT platform_private.case_sale_or_handoff_evidence(p_organization_id, p_student_case_id)
  THEN
    RAISE EXCEPTION 'Case does not need a curator assignment' USING ERRCODE = '55000';
  END IF;

  RETURN platform_private.assign_student_case_curator_authorized_e1(
    p_organization_id, p_student_case_id, p_curator_membership_id, p_reason, p_request_id,
    actor.actor_profile_id, actor.actor_membership_id, actor.actor_auth_user_id
  );
END
$$;

-- ---------------------------------------------------------------------------
-- d) platform.staff_student_portal_curator_options (149): holders of
-- case.curator.assign
-- ---------------------------------------------------------------------------
-- Narrow authenticated staff DTO: the eligible curators, the same set the
-- «Нагрузка кураторов» read already lists to holders of case.curator.assign.
-- Its bound is explicit here: never silently present a partial directory.
CREATE OR REPLACE FUNCTION platform.staff_student_portal_curator_options(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  -- 248: the Admin and the Admissions Manager (before: the Admin only, with
  -- membership.provision and case.curator.assign).
  PERFORM 1 FROM platform_private.require_domain_actor_read(p_organization_id, 'case.curator.assign');
  IF (SELECT count(*) FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND platform_private.is_eligible_staff_responsibility(
        membership.organization_id, membership.id, 'curator')) > 100
  THEN
    RAISE EXCEPTION 'Curator options exceed supported bound' USING ERRCODE = '54000';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'owners', platform_private.u6_eligible_admissions_owners(p_organization_id)
  );
END $function$;

-- ---------------------------------------------------------------------------
-- e) platform_private.require_student_portal_cabinet_actor_e1 (185): staff
-- with the lead permission
-- ---------------------------------------------------------------------------
-- Live-session actor check (current_actor_authority()-based): used wherever
-- a LIVE caller is being authorized right now (prepare, reissue-authorize).
CREATE OR REPLACE FUNCTION platform_private.require_student_portal_cabinet_actor_e1(
  p_organization_id UUID,
  p_lead_id UUID
)
RETURNS TABLE(actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_lead_id IS NULL THEN
    -- Not a genuine cabinet case (no lead-cabinet source_key/canonical_lead_id) --
    -- fail closed before even asking who is calling.
    RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
  END IF;
  RETURN QUERY
  SELECT a.profile_id, a.membership_id, a.auth_user_id
  FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id
    -- 248: staff, never a student; the lead permission decides, not the
    -- coarse role frozen since 155.
    AND a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.staff_can_access(
      p_organization_id, a.membership_id,
      'lead.sales.workflow.manage', 'lead', p_lead_id
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- f) platform_private.assert_student_portal_cabinet_membership_e1 (185):
-- the stored preparer keeps the live lead permission
-- ---------------------------------------------------------------------------
-- Stored-membership re-verification (no live session -- finalize runs under
-- the service-role client with no JWT actor): re-checks a SPECIFIC
-- membership_id recorded on the receipt at prepare time.
CREATE OR REPLACE FUNCTION platform_private.assert_student_portal_cabinet_membership_e1(
  p_organization_id UUID,
  p_membership_id UUID,
  p_lead_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'portal_case_invalid_shape' USING ERRCODE = '40001';
  END IF;
  -- 248: staff_membership_identity returns only an active, non-student member
  -- of an active organization; the live lead permission decides.
  IF NOT EXISTS (
    SELECT 1
    FROM platform_private.staff_membership_identity(p_organization_id, p_membership_id) AS identity
    WHERE platform_private.staff_can_access(
        p_organization_id, p_membership_id,
        'lead.sales.workflow.manage', 'lead', p_lead_id
      )
  ) THEN
    RAISE EXCEPTION 'portal_admin_authority_changed' USING ERRCODE = '42501';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- g) platform.prepare_student_portal_provisioning (185 + 193 + 194): the
-- cabinet_pending post-lock identity check without the coarse role
-- ---------------------------------------------------------------------------
DO $a248_prepare$
DECLARE
  original TEXT;
  body TEXT;
  old_identity CONSTANT TEXT := $q$WHERE identity.coarse_role IN ('admin','sales') AND identity.profile_id=actor.actor_profile_id$q$;
  new_identity CONSTANT TEXT := $q$WHERE identity.profile_id=actor.actor_profile_id$q$;
BEGIN
  original := pg_get_functiondef(
    'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)'::regprocedure);
  body := replace(original, old_identity, new_identity);
  IF (length(original) - length(replace(original, old_identity, ''))) / length(old_identity) <> 1
    OR (length(original) - length(replace(original, new_identity, ''))) / length(new_identity) <> 0
    OR (length(body) - length(replace(body, new_identity, ''))) / length(new_identity) <> 1
    OR strpos(body, 'coarse_role') <> 0
    OR (length(body) - length(replace(body, $q$WHERE identity.system_role='admin' AND identity.profile_id=actor.actor_profile_id$q$, '')))
      / length($q$WHERE identity.system_role='admin' AND identity.profile_id=actor.actor_profile_id$q$) <> 1
  THEN
    RAISE EXCEPTION 'student_portal_cabinet_identity_anchor_drift';
  END IF;
  EXECUTE body;
END
$a248_prepare$;

-- ---------------------------------------------------------------------------
-- h) platform.staff_student_case_cabinet_origin_v1 (185): also for the member
-- who manages the case's own lead-cabinet lead
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.staff_student_case_cabinet_origin_v1(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE cabinet_lead_id UUID;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'portal_case_unreadable' USING ERRCODE = '42501';
  END IF;
  cabinet_lead_id := platform_private.resolve_student_portal_cabinet_lead_e1(
    p_organization_id, p_student_case_id
  );
  -- 248: a case reader as before, or the staff member who may send this
  -- cabinet's invite (lead.sales.workflow.manage on its own lead, the
  -- authority require_student_portal_cabinet_actor_e1 checks).
  IF NOT private.platform_can_read_student_case(p_organization_id, p_student_case_id)
    AND NOT (cabinet_lead_id IS NOT NULL AND platform_private.staff_can_access_for_actor(
      p_organization_id, 'lead.sales.workflow.manage', 'lead', cabinet_lead_id))
  THEN
    RAISE EXCEPTION 'portal_case_unreadable' USING ERRCODE = '42501';
  END IF;
  RETURN cabinet_lead_id IS NOT NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- i) Same grants as their origin migrations, restated; self-check
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  private.platform_can_read_student_case(UUID, UUID),
  private.assign_case_curator_v1(UUID, UUID, UUID, UUID, TEXT),
  platform.staff_student_portal_curator_options(UUID),
  platform.prepare_student_portal_provisioning(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID),
  platform.staff_student_case_cabinet_origin_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  private.platform_can_read_student_case(UUID, UUID),
  private.assign_case_curator_v1(UUID, UUID, UUID, UUID, TEXT),
  platform.staff_student_portal_curator_options(UUID),
  platform.prepare_student_portal_provisioning(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID),
  platform.staff_student_case_cabinet_origin_v1(UUID, UUID)
  TO authenticated;
REVOKE ALL ON FUNCTION
  platform_private.require_student_portal_cabinet_actor_e1(UUID, UUID),
  platform_private.assert_student_portal_cabinet_membership_e1(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- No coarse-role gate and no Admin-only helper remain in the changed bodies;
-- every function stays SECURITY DEFINER with the empty search_path, and the
-- private helpers are not executable by any API role.
DO $a248_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.prosrc, p.prosecdef, p.proconfig,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
      n.nspname = 'platform_private' AS private_helper
    FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE p.oid IN (
      'platform_private.needs_curator_case_last_curator(uuid,uuid)'::regprocedure,
      'platform_private.staff_can_take_needs_curator_case(uuid,uuid,uuid)'::regprocedure,
      'platform_private.require_case_curator_assigner_locked(uuid,uuid)'::regprocedure,
      'private.platform_can_read_student_case(uuid,uuid)'::regprocedure,
      'private.assign_case_curator_v1(uuid,uuid,uuid,uuid,text)'::regprocedure,
      'platform.staff_student_portal_curator_options(uuid)'::regprocedure,
      'platform_private.require_student_portal_cabinet_actor_e1(uuid,uuid)'::regprocedure,
      'platform_private.assert_student_portal_cabinet_membership_e1(uuid,uuid,uuid)'::regprocedure,
      'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)'::regprocedure,
      'platform.staff_student_case_cabinet_origin_v1(uuid,uuid)'::regprocedure)
  LOOP
    IF routine.prosrc ~ 'platform_role\s*(NOT\s+)?IN\s*\(' OR routine.prosrc ~ 'coarse_role'
      -- normal_u6/legacy_pending invites stay Admin-only inside prepare.
      OR (strpos(routine.prosrc, 'require_admin_actor') <> 0
        AND routine.signature <> 'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)'::regprocedure)
      OR NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR routine.anon_execute OR routine.service_role_execute
      OR routine.authenticated_execute = routine.private_helper
    THEN
      RAISE EXCEPTION 'a248_access_owner_defaults_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
END
$a248_verify$;

COMMIT;
