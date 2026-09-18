-- Unified-workflow pivot, slice S3 «Передача и принятие дела» (plan §7).
-- docs/EVO_UNIFIED_WORKFLOW_PLAN_2026-09-18.md §7 + docs/PLAN_CHANGES.md
-- «unified workflow: план-контракт реализации», S1, S2 (2026-09-18).
--
-- Plan §7: a curator sees «Ожидает принятия» and either «Принять дело» or
-- «Отклонить». «Отклоняется назначение куратору, а не студент, доступ или
-- продажа. Продажа остаётся в отчёте; сведения и файлы сохраняются. Дело
-- остаётся в «Студентах» с отметкой «Нужно назначить куратора», Admin
-- выбирает другого куратора внутри того же дела.» No separate «приём дела»
-- stage, no clarification-request form change (that path is untouched).
--
-- Sections:
--  a) student_case_handoff_acknowledgements: decision vocabulary gains
--     'declined' (append-only model unchanged — a decline is a new revision
--     row like every other response; historical accepted/clarification_requested
--     rows stay valid under the widened CHECK).
--  b) student_case_lifecycle_events: event_type gains 'declined' for the
--     active-to-pending transition a decline performs (the inverse of
--     'activated').
--  c) platform_private.case_sale_or_handoff_evidence: one small shared
--     predicate — «this case was ever the target of a sale/handoff» — used by
--     BOTH the awaiting-acceptance directory signal and the new needs-curator
--     signal below, so the two stay definitionally consistent.
--  d) platform_private.admissions_attention_flags (145) is widened:
--       - a 'pending' case now returns ['needs_curator'] when the evidence
--         predicate holds, else [] (still nothing for a bare S1 «кабинет до
--         продажи» cabinet case with no sale — plan's explicit distinction).
--       - the existing 'awaiting_ack' flag's EXISTS(sales_admissions_handoffs)
--         check is replaced by the same shared predicate, which ALSO covers a
--         sales_register row reachable via the case's canonical_lead_id.
--     AWAITING-ACCEPTANCE PREDICATE CHOICE (closes the S2 known deviation):
--     S2's own entry documents that its pending-case-activation branch of
--     create_sales_report_handoff (181) writes NO sales_admissions_handoffs
--     row (that table is the OTHER branch's evidence — handoff_lead_to_admissions,
--     088/134), so the old awaiting_ack predicate never fired for a case
--     activated that way. Rather than touch 181's already-shipped RPC (the
--     task's own suggested smaller alternative), this migration widens the
--     READ predicate instead: a case counts as sale/handoff-evidenced when
--     EITHER a platform.sales_admissions_handoffs row exists for it OR a
--     platform_private.sales_register row exists for its canonical_lead_id.
--     sales_register has UNIQUE(organization_id, lead_id) and student_cases
--     has UNIQUE(organization_id, canonical_lead_id) WHERE state IN
--     ('pending','active') (088), so at most one case is ever "open" for a
--     given lead at a time; a pending case can only carry a sales_register
--     row for its own lead once that lead's sale put IT through 'active'
--     first (both creation branches of create_sales_report_handoff insert
--     sales_register in the SAME transaction as activation) — so this OR
--     never produces a false positive against a historical, pre-pivot,
--     never-handed-off pending case (docs-intake cases have no
--     canonical_lead_id at all; a bare S1 cabinet-before-sale case has one
--     but no register row yet). The only way a *pending* case can carry this
--     evidence going forward is exactly the scenario this migration adds:
--     the decline-revert in (e) below leaves handoff_at/curator cleared but
--     never touches sales_admissions_handoffs or sales_register.
--  e) private.respond_student_case_handoff / platform.respond_student_case_handoff
--     (130, with 149's is_eligible_staff_responsibility patch folded in as
--     the current baseline) are replaced whole: decision='declined' requires
--     a reason (reusing the existing `clarification` column/parameter — a
--     second free-text column for the same purpose would be a second source
--     of truth for one fact; the CHECK below simply bounds it tighter, 1-1000
--     chars, to fit the lifecycle-event `reason` column's own limit). The
--     actor gate is UNCHANGED (current curator — or an eligible Admin acting
--     as curator, 149 — of the ACTIVE case); on a fresh declined response the
--     case is reverted to state='pending' (curator/handoff cleared — legal
--     under 088's student_cases_state_shape_check), portal_activated_at is
--     left untouched (already legal on 'pending' since migration 180),
--     canonical_lead_id/canonical_client_id/public_application_id and every
--     sale/register row are untouched. The case's record_scope is bumped
--     (mirroring assign_student_case_curator_authorized_e1's own
--     grant/revoke bookkeeping, run in reverse): the declining curator and
--     the student lose their scope grant, the responsible Sales owner
--     regains the one 'pending' already relies on elsewhere
--     (private.platform_can_read_student_case's Sales branch) so the case
--     stays visible to Sales/Admin immediately after decline.
--  f) platform.assign_case_curator_v1: new Admin-only RPC for a needs-curator
--     case (state='pending' AND the same sale/handoff evidence predicate).
--     Gate mirrors platform_private.assign_student_case_curator_body/117's
--     own private.assign_student_case_curator exactly (require_admin_actor
--     with case.curator.assign, the shared assignment-domain advisory lock,
--     then require_case_assignment_admin_locked's post-lock recheck) — no
--     broader authority than what case.curator.assign already grants
--     elsewhere. It then reuses assign_student_case_curator_authorized_e1
--     (126/177/181's own reused initial-assignment branch) exactly as every
--     other "approve a pending case with a curator" caller in this codebase
--     does, after confirming the case is actually in the needs-curator shape
--     (not just any pending cabinet case).
--  g) platform.staff_case_attention_flags_v1: a tiny new staff read (mirrors
--     admissions_direction_summary_v1's own direct SECURITY DEFINER style,
--     no private wrapper) so CaseHeader can ask "does this case need a
--     curator" without duplicating the predicate client-side.
--  h) platform.staff_student_case_page (078/110, patched by 137/149/176/177)
--     is widened additively, in place, via CREATE OR REPLACE — Postgres
--     allows appending trailing columns to an existing RETURNS TABLE this
--     way, so (unlike 137's own patch, which changed the parameter list and
--     therefore needed DROP+CREATE+re-GRANT) no DROP or grant replay is
--     needed here. Two changes: 'needs_curator' joins the p_attention
--     allow-list, and a new attention_flags column exposes the full flag set
--     per row (access_mode='full' rows only) so the directory can render
--     «Ожидает принятия»/«Нужно назначить куратора» badges without a second
--     round trip per row.
--
-- Style: SECURITY DEFINER, SET search_path='', REVOKE/GRANT pairs, the
-- self-verifying pg_get_functiondef+replace anchor pattern with RAISE
-- EXCEPTION on drift (137/149/156/176/177/180/181), dollar-quoted replace()
-- arguments throughout (avoids the doubled-quote escaping 137/149 needed,
-- since a dollar-quoted literal needs no escaping for embedded SQL quotes).
BEGIN;

-- ---------------------------------------------------------------------------
-- a) student_case_handoff_acknowledgements: 'declined' joins the vocabulary
-- ---------------------------------------------------------------------------
DO $ack_decision_shape$
DECLARE decision_check TEXT; shape_check TEXT;
BEGIN
  SELECT con.conname INTO decision_check
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'platform' AND rel.relname = 'student_case_handoff_acknowledgements'
    AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE $p$%decision = ANY%$p$;
  IF decision_check IS NULL THEN RAISE EXCEPTION 'ack_decision_check_not_found'; END IF;
  EXECUTE format('ALTER TABLE platform.student_case_handoff_acknowledgements DROP CONSTRAINT %I', decision_check);

  SELECT con.conname INTO shape_check
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'platform' AND rel.relname = 'student_case_handoff_acknowledgements'
    AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE $p$%char_length(btrim(clarification))%$p$;
  IF shape_check IS NULL THEN RAISE EXCEPTION 'ack_clarification_shape_check_not_found'; END IF;
  EXECUTE format('ALTER TABLE platform.student_case_handoff_acknowledgements DROP CONSTRAINT %I', shape_check);
END
$ack_decision_shape$;

ALTER TABLE platform.student_case_handoff_acknowledgements
  ADD CONSTRAINT student_case_handoff_acknowledgements_decision_check
    CHECK (decision IN ('accepted', 'clarification_requested', 'declined')),
  ADD CONSTRAINT student_case_handoff_acknowledgements_clarification_check CHECK (
    (decision = 'accepted' AND clarification IS NULL)
    OR (decision = 'clarification_requested' AND clarification IS NOT NULL
      AND char_length(btrim(clarification)) BETWEEN 1 AND 2000)
    OR (decision = 'declined' AND clarification IS NOT NULL
      AND char_length(btrim(clarification)) BETWEEN 1 AND 1000)
  );

-- ---------------------------------------------------------------------------
-- b) student_case_lifecycle_events: 'declined' (active -> pending)
-- ---------------------------------------------------------------------------
DO $lifecycle_event_type$
DECLARE event_type_check TEXT;
BEGIN
  SELECT con.conname INTO event_type_check
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'platform' AND rel.relname = 'student_case_lifecycle_events'
    AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE $p$%event_type = ANY%$p$
    AND pg_get_constraintdef(con.oid) NOT LIKE $p$%previous_state%$p$;
  IF event_type_check IS NULL THEN RAISE EXCEPTION 'lifecycle_event_type_check_not_found'; END IF;
  EXECUTE format('ALTER TABLE platform.student_case_lifecycle_events DROP CONSTRAINT %I', event_type_check);
END
$lifecycle_event_type$;

ALTER TABLE platform.student_case_lifecycle_events
  ADD CONSTRAINT student_case_lifecycle_events_event_type_check
    CHECK (event_type IN ('activated', 'closed', 'reopened', 'declined')),
  DROP CONSTRAINT student_case_lifecycle_events_transition_check,
  ADD CONSTRAINT student_case_lifecycle_events_transition_check CHECK (
    (event_type = 'activated' AND previous_state = 'pending' AND new_state = 'active')
    OR (event_type = 'closed' AND previous_state = 'active' AND new_state = 'closed')
    OR (event_type = 'reopened' AND previous_state = 'closed' AND new_state = 'active')
    OR (event_type = 'declined' AND previous_state = 'active' AND new_state = 'pending')
  );

-- ---------------------------------------------------------------------------
-- c) shared sale/handoff evidence predicate
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.case_sale_or_handoff_evidence(
  p_organization_id UUID, p_student_case_id UUID
)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(
    SELECT 1 FROM platform.sales_admissions_handoffs h
    WHERE h.organization_id = p_organization_id AND h.student_case_id = p_student_case_id
  ) OR EXISTS(
    SELECT 1 FROM platform.student_cases c
    JOIN platform_private.sales_register r
      ON r.organization_id = c.organization_id AND r.lead_id = c.canonical_lead_id
    WHERE c.organization_id = p_organization_id AND c.id = p_student_case_id
      AND c.canonical_lead_id IS NOT NULL
  )
$$;
REVOKE ALL ON FUNCTION platform_private.case_sale_or_handoff_evidence(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- d) admissions_attention_flags (145): needs_curator (pending) + shared
--    evidence predicate for awaiting_ack (active)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_private.admissions_attention_flags(p_case_id UUID)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform.student_cases%ROWTYPE; flags TEXT[]:=ARRAY[]::TEXT[]; ack TEXT;
 today DATE:=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE;
BEGIN
 SELECT * INTO STRICT c FROM platform.student_cases WHERE id=p_case_id;
 IF c.state='pending' THEN
  -- S3 (plan §7): a pending case that already carries sale/handoff evidence
  -- (today, only the decline-revert in (e) below produces this) needs an
  -- Admin to pick a new curator; a bare S1 «кабинет до продажи» cabinet case
  -- with no sale stays the plain «Ожидает начала» state — no flag.
  IF platform_private.case_sale_or_handoff_evidence(c.organization_id,c.id) THEN
   flags:=array_append(flags,'needs_curator');
  END IF;
  RETURN flags;
 END IF;
 IF c.state<>'active' THEN RETURN flags; END IF;
 IF c.next_action_due_on<today
  OR EXISTS(SELECT 1 FROM platform_private.admissions_deadline_rows(c.id) d WHERE d.deadline<today)
  OR EXISTS(SELECT 1 FROM platform.case_tasks t WHERE t.organization_id=c.organization_id AND t.student_case_id=c.id AND t.status NOT IN ('done','cancelled') AND (t.due_at<CURRENT_TIMESTAMP OR t.due_on<today))
 THEN flags:=array_append(flags,'overdue'); END IF;
 IF EXISTS(SELECT 1 FROM platform.university_applications a WHERE a.organization_id=c.organization_id AND a.student_case_id=c.id
  AND a.status IN ('preparation','ready','submitted','under_review','offer')
  AND a.admissions_details ? 'partnerSentOn' AND NOT a.admissions_details ? 'universitySubmittedOn')
 THEN flags:=array_append(flags,'awaiting_partner'); END IF;
 IF c.operational_stage='applications' AND EXISTS(SELECT 1 FROM platform.university_applications a WHERE a.student_case_id=c.id AND a.is_primary AND a.admissions_details ? 'universitySubmittedOn' AND a.status IN ('submitted','under_review','offer','enrolled')) THEN flags:=array_append(flags,'submitted'); END IF;
 IF c.operational_stage='decisions' THEN flags:=array_append(flags,'decisions'); END IF;
 IF c.operational_stage='visa_and_predeparture' THEN flags:=array_append(flags,'visas'); END IF;
 IF c.operational_stage='arrival_and_adaptation' THEN flags:=array_append(flags,'arrivals'); END IF;
 SELECT r.decision INTO ack FROM platform.student_case_handoff_acknowledgements r JOIN platform.student_case_assignment_events x ON x.id=r.assignment_event_id
  WHERE r.organization_id=c.organization_id AND r.student_case_id=c.id AND x.new_scope_version=c.current_scope_version AND r.curator_membership_id=c.current_curator_membership_id ORDER BY r.revision DESC LIMIT 1;
 IF ack IS DISTINCT FROM 'accepted' AND platform_private.case_sale_or_handoff_evidence(c.organization_id,c.id) THEN flags:=array_append(flags,'awaiting_ack'); END IF;
 RETURN flags;
END $$;

-- ---------------------------------------------------------------------------
-- e) respond_student_case_handoff: 'declined' -> revert to pending
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.respond_student_case_handoff(
  p_organization_id UUID, p_student_case_id UUID, p_assignment_event_id UUID,
  p_expected_acknowledgement_id UUID, p_decision TEXT, p_clarification TEXT,
  p_agreed_contact_date DATE, p_request_id UUID
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  assignment_id UUID;
  handoff_id UUID;
  target_case platform.student_cases%ROWTYPE;
  previous_scope platform.record_scopes%ROWTYPE;
  new_scope_id UUID;
  new_scope_version BIGINT;
  current_response platform.student_case_handoff_acknowledgements%ROWTYPE;
  response platform.student_case_handoff_acknowledgements%ROWTYPE;
  normalized_clarification TEXT := nullif(btrim(p_clarification,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '');
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR p_assignment_event_id IS NULL OR p_request_id IS NULL
    OR p_decision IS NULL OR p_decision NOT IN ('accepted', 'clarification_requested', 'declined')
    OR (p_decision = 'accepted' AND normalized_clarification IS NOT NULL)
    OR (p_decision IN ('clarification_requested', 'declined') AND normalized_clarification IS NULL)
    OR (p_decision = 'declined' AND char_length(normalized_clarification) > 1000)
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
  -- 149: an eligible Admin may act in the curator's stead; never a wider role.
  IF NOT platform_private.is_eligible_staff_responsibility(p_organization_id, actor.actor_membership_id, 'curator') OR NOT EXISTS (
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

    IF p_decision = 'declined' THEN
      -- Plan §7: revert the ASSIGNMENT, never the sale or the case data.
      -- state_shape_check (088, relaxed by 180) allows a pending case to
      -- keep portal_activated_at — it is simply left out of this SET clause,
      -- so it is preserved automatically. canonical_lead_id/canonical_client_id/
      -- public_application_id and every sale/register row are never touched.
      SELECT * INTO target_case FROM platform.student_cases
      WHERE organization_id = p_organization_id AND id = p_student_case_id
      FOR UPDATE;

      SELECT * INTO previous_scope FROM platform.record_scopes AS scope
      WHERE scope.organization_id = p_organization_id
        AND scope.id = target_case.current_scope_id
        AND scope.scope_version = target_case.current_scope_version
        AND scope.scope_kind = 'student_case' AND scope.scope_key = p_student_case_id
        AND scope.is_active
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Active student-case scope is unavailable' USING ERRCODE = '55000';
      END IF;
      new_scope_id := gen_random_uuid();
      new_scope_version := previous_scope.scope_version + 1;
      UPDATE platform.record_scopes SET is_active = FALSE WHERE id = previous_scope.id;
      INSERT INTO platform.record_scopes (
        id, organization_id, scope_kind, scope_key, scope_version, is_active
      ) VALUES (
        new_scope_id, p_organization_id, 'student_case', p_student_case_id, new_scope_version, TRUE
      );

      -- Inverse of assign_student_case_curator_authorized_e1's own 'assigned'
      -- branch: revoke exactly who that branch grants (curator + student),
      -- grant back exactly who it revokes (the responsible Sales owner), so
      -- the case is immediately visible to Sales/Admin again while pending.
      PERFORM platform_private.append_scope_event(
        p_organization_id, actor.actor_membership_id,
        previous_scope.id, previous_scope.scope_version, FALSE,
        'user', actor.actor_profile_id, normalized_clarification, p_request_id
      );
      IF target_case.student_membership_id IS NOT NULL THEN
        PERFORM platform_private.append_scope_event(
          p_organization_id, target_case.student_membership_id,
          previous_scope.id, previous_scope.scope_version, FALSE,
          'user', actor.actor_profile_id, normalized_clarification, p_request_id
        );
      END IF;
      PERFORM platform_private.append_scope_event(
        p_organization_id, target_case.responsible_sales_membership_id,
        new_scope_id, new_scope_version, TRUE,
        'user', actor.actor_profile_id, normalized_clarification, p_request_id
      );

      UPDATE platform.student_cases
      SET current_curator_membership_id = NULL,
        state = 'pending',
        handoff_at = NULL,
        current_scope_id = new_scope_id,
        current_scope_version = new_scope_version
      WHERE organization_id = p_organization_id AND id = p_student_case_id;

      INSERT INTO platform.student_case_lifecycle_events (
        organization_id, student_case_id, event_type, previous_state, new_state,
        actor_membership_id, reason, request_id
      ) VALUES (
        p_organization_id, p_student_case_id, 'declined', 'active', 'pending',
        actor.actor_membership_id, normalized_clarification, p_request_id
      );
    END IF;

    INSERT INTO platform.audit_events (
      organization_id, actor_kind, actor_profile_id, actor_membership_id,
      actor_principal, action, resource_type, resource_id, before_state,
      after_state, reason, request_id
    ) VALUES (
      p_organization_id, 'user', actor.actor_profile_id, actor.actor_membership_id,
      'auth:' || actor.actor_auth_user_id::TEXT,
      CASE p_decision
        WHEN 'accepted' THEN 'case.handoff.acknowledge'
        WHEN 'clarification_requested' THEN 'case.handoff.clarification'
        ELSE 'case.handoff.decline'
      END,
      'student_case', p_student_case_id,
      jsonb_build_object('acknowledgement_id', current_response.id),
      jsonb_build_object('acknowledgement_id', response.id,
        'assignment_event_id', assignment_id, 'decision', p_decision,
        'agreed_contact_date', p_agreed_contact_date,
        'case_state', CASE WHEN p_decision = 'declined' THEN 'pending' ELSE NULL END),
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

CREATE OR REPLACE FUNCTION platform.respond_student_case_handoff(
  p_organization_id UUID, p_student_case_id UUID, p_assignment_event_id UUID,
  p_expected_acknowledgement_id UUID, p_decision TEXT, p_clarification TEXT,
  p_agreed_contact_date DATE, p_request_id UUID
)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.respond_student_case_handoff(p_organization_id, p_student_case_id,
    p_assignment_event_id, p_expected_acknowledgement_id, p_decision,
    p_clarification, p_agreed_contact_date, p_request_id)
$$;

REVOKE ALL ON FUNCTION private.respond_student_case_handoff(UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.respond_student_case_handoff(UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.respond_student_case_handoff(UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.respond_student_case_handoff(UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- f) assign_case_curator_v1: Admin assigns a curator to a needs-curator case
-- ---------------------------------------------------------------------------
CREATE FUNCTION private.assign_case_curator_v1(
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

  -- Read-only preflight before the shared assignment-domain lock, exactly
  -- like 117's private.assign_student_case_curator.
  PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id, 'case.curator.assign');
  PERFORM platform_private.lock_student_case_note_assignment_domain(p_organization_id);
  PERFORM platform_private.lock_p2d_request(p_request_id);
  PERFORM platform_private.require_case_assignment_admin_locked(p_organization_id);
  SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id, 'case.curator.assign');

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

CREATE FUNCTION platform.assign_case_curator_v1(
  p_organization_id UUID, p_request_id UUID, p_student_case_id UUID,
  p_curator_membership_id UUID, p_reason TEXT
)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.assign_case_curator_v1(
    p_organization_id, p_request_id, p_student_case_id, p_curator_membership_id, p_reason)
$$;

REVOKE ALL ON FUNCTION private.assign_case_curator_v1(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.assign_case_curator_v1(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.assign_case_curator_v1(UUID, UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.assign_case_curator_v1(UUID, UUID, UUID, UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- g) staff_case_attention_flags_v1: small staff read for CaseHeader
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_case_attention_flags_v1(p_student_case_id UUID)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org UUID;
BEGIN
  SELECT authority.organization_id INTO org FROM platform.current_actor_authority() AS authority;
  IF org IS NULL OR NOT private.platform_can_read_student_case(org, p_student_case_id) THEN
    RAISE EXCEPTION 'Case is unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN platform_private.admissions_attention_flags(p_student_case_id);
END
$$;
REVOKE ALL ON FUNCTION platform.staff_case_attention_flags_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_attention_flags_v1(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- h) staff_student_case_page (078/110/137/149/176/177): p_attention gains
--    'needs_curator'; a new attention_flags column feeds directory badges.
--    Additive RETURNS TABLE change -> CREATE OR REPLACE in place, no DROP,
--    no grant replay (unlike 137's own parameter-list change).
-- ---------------------------------------------------------------------------
DO $s3_directory$
DECLARE original TEXT; body TEXT;
BEGIN
  original := pg_get_functiondef(
    'platform.staff_student_case_page(integer,timestamptz,uuid,platform.student_case_state,text,uuid,text,uuid,text)'::regprocedure
  );
  body := replace(
    original,
    $a1$admissions_direction text, next_action_due_on date, admissions_version bigint)$a1$,
    $a2$admissions_direction text, next_action_due_on date, admissions_version bigint, attention_flags text[])$a2$
  );
  body := replace(
    body,
    $a3$'visas','arrivals','awaiting_ack'))$a3$,
    $a4$'visas','arrivals','awaiting_ack','needs_curator'))$a4$
  );
  body := replace(
    body,
    $a5$    ) END, page.admissions_direction,page.next_action_due_on,page.admissions_version
  FROM page$a5$,
    $a6$    ) END, page.admissions_direction,page.next_action_due_on,page.admissions_version,
    CASE WHEN page.access_mode = 'full' THEN platform_private.admissions_attention_flags(page.student_case_id) END
  FROM page$a6$
  );
  IF body = original
    OR strpos(body, 'attention_flags text[])') = 0
    OR strpos(body, $chk$'needs_curator'))$chk$) = 0
    OR strpos(body, 'platform_private.admissions_attention_flags(page.student_case_id) END') = 0
  THEN
    RAISE EXCEPTION 'staff_student_case_page_source_anchor_drift';
  END IF;
  EXECUTE body;
END
$s3_directory$;

COMMIT;
