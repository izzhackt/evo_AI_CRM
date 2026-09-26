-- «Закрыть лид» и «Завершить дело» — с причиной и возвратом в работу.
-- docs/PLAN_CHANGES.md «2026-09-26 — Закрыть лид и завершить дело
-- (миграция 246)», owner decision 26.09.2026 (track C1 of the readiness
-- audit): daily work needs an honest end. Until now no application action
-- changed platform.leads.lifecycle_state (a lost lead stayed on the board
-- forever) and no UI moved platform.student_cases.state to closed.
--
-- Forward-only and additive: four new functions, nothing existing is
-- replaced; no table, column, enum value, trigger, signature, owner or grant
-- of an existing object changes. SECURITY DEFINER, SET search_path = '',
-- REVOKE/GRANT pairs, the 241 style.
--
--  a) platform.set_lead_closed_v1 — close a lost lead with a reason, or return
--     it to work.
--     * Storage: the EXISTING value 'disqualified' of
--       platform.lead_lifecycle_state (084). platform_private.guard_lead_mutation
--       (084) already allows disqualified -> open, while 'archived' is
--       immutable once set, so no new enum value is needed. The UI word is
--       «Закрыт»; the reason carries the nuance.
--     * Only lifecycle_state changes. stage_key, the owner and the next step
--       stay as they were, so «Вернуть в работу» restores the lead open at its
--       previous stage (and with its previous next step). Every board, funnel,
--       requests and handoff read already filters lifecycle_state = 'open'
--       (086/094/119/123/210/212/221), so a closed lead leaves the working
--       stages, the board counts and the «Сегодня»/«Без действия» chips
--       without touching those reads.
--     * workflow_version is NOT bumped: migration 111 ties it to the U4
--       workflow receipts, and the board fails closed on any version without
--       its receipt. The expected workflow version is still checked (PT409),
--       exactly as the stage form does, and a lifecycle that already moved is
--       a PT409 conflict too.
--     * Authority: staff (never a Student) holding lead.sales.workflow.manage
--       AND lead.read on this lead (staff_can_access, the 244 shape of
--       prepare_lead_cabinet_v1); the system Admin passes. No coarse role.
--     * A lead with a completed admissions handoff is a sale: closing it as
--       lost is refused (55000 lead_lifecycle_handed_off). «Completed» is the
--       SAME read the board uses (platform.staff_sales_handoff_facts, 212), so
--       there is one definition.
--     * Idempotency: request_id through platform.audit_events (UNIQUE
--       request_id), the 241 shape: an exact replay by the same actor returns
--       the original receipt; any other reuse is 22023. Event action
--       'lead.lifecycle.change' on resource 'lead'. The Admin audit search
--       allowlist (071/p7a) is not widened.
--  b) platform.staff_closed_leads_v1 — closed leads the caller can read
--     (lead.read per lead), newest closure first, with reason, note, date,
--     who closed and a can_manage hint; p_lead_id narrows it to one lead. The
--     V3 board «Закрытые» view and Lead 360 of a closed lead read it: the
--     detail read (093) returns open leads only and is not changed.
--  c) platform.set_student_case_closed_v1 — finish a case with an outcome, or
--     return it to work.
--     * Transitions active -> closed and closed -> active are the ones 042
--       already allows (guard_student_case_transition, lifecycle event types
--       'closed'/'reopened'); no new transition is added.
--     * Authority: the 137/241 case-command chain — the read-only preflight
--       platform_private.u7_require_case_workspace_actor (case.read.full on
--       the case), then platform_private.admissions_lock_case(case,
--       'case.lifecycle.change'): the shared assignment-domain lock,
--       require_domain_actor, SELECT ... FOR UPDATE and a post-lock
--       require_case_operator. The case's curator (own scope), a department
--       Admissions Manager and the Admin pass; another curator, Sales, a
--       Student and anon are refused (42501). Students are refused explicitly
--       before any lock.
--     * Optimistic version: admissions_version (+1), the 241 token. The bump
--       also satisfies 137's admissions_case_command_guard; for a case bound
--       to a 137 playbook the playbook outcome follows the state as that guard
--       requires: 'arrived' when the case is enrolled and its confirmed
--       arrival facts exist, otherwise 'cancelled'; 'active' on return.
--     * Events: platform.student_case_lifecycle_events (042) and
--       platform.audit_events 'case.lifecycle.change' with the outcome and
--       note (already in the case «История» allowlist, 132).
--     * platform.change_student_case_state (042) is not used: it has no
--       expected version and no outcome, and a playbook-bound case refuses it.
--  d) platform.staff_student_case_closure_v1 — the outcome, note, date, who
--     closed and a can_change hint for Student 360 and the «Быстрый
--     просмотр» panel. Lock-free (PostgREST runs STABLE reads READ ONLY).
--
-- References:
-- https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY
-- https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS
-- https://docs.postgrest.org/en/stable/references/errors.html (PTxxx -> HTTP status)
BEGIN;

-- ---------------------------------------------------------------------------
-- Anchors this migration relies on (fail before creating anything if a later
-- migration changed them).
-- ---------------------------------------------------------------------------
DO $a246_anchors$
BEGIN
  IF strpos(pg_get_functiondef('platform_private.guard_lead_mutation()'::regprocedure),
      $q$NEW.lifecycle_state NOT IN ('open', 'disqualified', 'archived')$q$) = 0
    OR strpos(pg_get_functiondef('platform_private.guard_student_case_transition()'::regprocedure),
      $q$OR (OLD.state = 'closed' AND NEW.state = 'active')$q$) = 0
    OR to_regprocedure('platform.staff_sales_handoff_facts(uuid,uuid[])') IS NULL
    OR to_regprocedure('platform_private.admissions_lock_case(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.u7_require_case_workspace_actor(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'a246_closure_anchor_drift';
  END IF;
END
$a246_anchors$;

-- ---------------------------------------------------------------------------
-- a) platform.set_lead_closed_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.set_lead_closed_v1(
  p_organization_id UUID,
  p_lead_id UUID,
  p_expected_workflow_version BIGINT,
  p_closed BOOLEAN,
  p_reason TEXT,
  p_note TEXT,
  p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  lead_row platform.leads%ROWTYPE;
  changed platform.leads%ROWTYPE;
  prior platform.audit_events%ROWTYPE;
  note_text TEXT := NULLIF(btrim(p_note,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '');
  handoff JSONB;
  target_lifecycle TEXT := CASE WHEN p_closed THEN 'closed' ELSE 'open' END;
  recorded_at TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL OR p_lead_id IS NULL OR p_request_id IS NULL OR p_closed IS NULL
    OR p_expected_workflow_version IS NULL OR p_expected_workflow_version < 1
    -- Closing names one reason from the fixed list; «Другое» needs its text,
    -- and only «Другое» carries text. Returning to work carries neither.
    OR (p_closed AND (p_reason IS NULL
      OR p_reason NOT IN ('no_response', 'other_agency', 'budget', 'duplicate', 'other')))
    OR (p_closed AND p_reason = 'other' AND note_text IS NULL)
    OR (p_closed AND p_reason <> 'other' AND p_note IS NOT NULL)
    OR (NOT p_closed AND (p_reason IS NOT NULL OR p_note IS NOT NULL))
    OR char_length(note_text) > 500
    -- One line: C0 and C1 controls, U+2028 and U+2029 (the 241 rule).
    OR note_text ~ U&'[\0001-\001F\007F-\009F\2028\2029]'
  THEN
    RAISE EXCEPTION 'lead_lifecycle_invalid' USING ERRCODE = '22023';
  END IF;

  -- Staff only, never a Student; the lead permissions decide, not the coarse
  -- role (frozen since 155, NULL for invited staff).
  SELECT a.* INTO actor FROM platform.current_actor_authority() AS a
    WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student'
      AND platform_private.staff_can_access(a.organization_id, a.membership_id,
        'lead.sales.workflow.manage', 'lead', p_lead_id)
      AND platform_private.staff_can_access(a.organization_id, a.membership_id,
        'lead.read', 'lead', p_lead_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_lifecycle_forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2d_request(p_request_id);
  -- The workflow command's organization lock mode (086), then the lead row:
  -- the stage form, the handoff and this command serialize on the lead.
  PERFORM 1 FROM platform.organizations AS o WHERE o.id = p_organization_id FOR KEY SHARE;
  SELECT * INTO lead_row FROM platform.leads AS l
    WHERE l.organization_id = p_organization_id AND l.id = p_lead_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_lifecycle_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prior FROM platform.audit_events WHERE request_id = p_request_id;
  IF FOUND THEN
    IF prior.organization_id IS DISTINCT FROM p_organization_id
      OR prior.action IS DISTINCT FROM 'lead.lifecycle.change'
      OR prior.resource_type IS DISTINCT FROM 'lead'
      OR prior.resource_id IS DISTINCT FROM p_lead_id
      OR prior.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR prior.after_state ->> 'lifecycle' IS DISTINCT FROM target_lifecycle
      OR prior.after_state ->> 'reason' IS DISTINCT FROM p_reason
      OR prior.after_state ->> 'note' IS DISTINCT FROM note_text
      OR prior.after_state ->> 'workflow_version' IS DISTINCT FROM p_expected_workflow_version::TEXT
    THEN
      RAISE EXCEPTION 'lead_lifecycle_request_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'organization_id', prior.organization_id, 'lead_id', prior.resource_id,
      'lifecycle', prior.after_state -> 'lifecycle',
      'reason', prior.after_state -> 'reason', 'note', prior.after_state -> 'note',
      'stage_key', prior.after_state -> 'stage_key',
      'workflow_version', prior.after_state -> 'workflow_version',
      'request_id', prior.request_id, 'changed_at', prior.created_at
    );
  END IF;

  IF lead_row.workflow_version <> p_expected_workflow_version THEN
    RAISE EXCEPTION 'lead_lifecycle_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF (p_closed AND lead_row.lifecycle_state <> 'open')
    OR (NOT p_closed AND lead_row.lifecycle_state <> 'disqualified')
  THEN
    RAISE EXCEPTION 'lead_lifecycle_state_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF p_closed THEN
    -- One definition of «передан»: the board's own read (212). The actor holds
    -- lead.read on this open lead, so the read answers for exactly this lead.
    handoff := platform.staff_sales_handoff_facts(p_organization_id, ARRAY[p_lead_id]);
    IF jsonb_array_length(handoff -> 'leads') <> 1
      OR handoff -> 'leads' -> 0 ->> 'lead_id' IS DISTINCT FROM p_lead_id::TEXT
      OR (handoff -> 'leads' -> 0 ->> 'completed')::BOOLEAN IS DISTINCT FROM FALSE
    THEN
      RAISE EXCEPTION 'lead_lifecycle_handed_off' USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE platform.leads AS l
  SET lifecycle_state = CASE WHEN p_closed THEN 'disqualified'::platform.lead_lifecycle_state
    ELSE 'open'::platform.lead_lifecycle_state END
  WHERE l.organization_id = lead_row.organization_id AND l.id = lead_row.id
  RETURNING * INTO changed;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id,
    actor_principal, action, resource_type, resource_id, before_state,
    after_state, reason, request_id
  ) VALUES (
    lead_row.organization_id, 'user', actor.profile_id, actor.membership_id,
    'auth:' || actor.auth_user_id::TEXT, 'lead.lifecycle.change', 'lead', lead_row.id,
    jsonb_build_object('lifecycle', CASE WHEN p_closed THEN 'open' ELSE 'closed' END,
      'lifecycle_state', lead_row.lifecycle_state::TEXT,
      'workflow_version', lead_row.workflow_version::TEXT),
    jsonb_build_object('lifecycle', target_lifecycle,
      'lifecycle_state', changed.lifecycle_state::TEXT,
      'reason', p_reason, 'note', note_text, 'stage_key', changed.stage_key,
      'workflow_version', changed.workflow_version::TEXT),
    CASE WHEN p_closed THEN 'Lead closed' ELSE 'Lead returned to work' END,
    p_request_id
  ) RETURNING created_at INTO recorded_at;

  -- The receipt is the committed row, never an optimistic echo of the input.
  RETURN jsonb_build_object(
    'organization_id', changed.organization_id, 'lead_id', changed.id,
    'lifecycle', CASE WHEN changed.lifecycle_state = 'open' THEN 'open' ELSE 'closed' END,
    'reason', p_reason, 'note', note_text, 'stage_key', changed.stage_key,
    'workflow_version', changed.workflow_version::TEXT,
    'request_id', p_request_id, 'changed_at', recorded_at
  );
END
$$;

REVOKE ALL ON FUNCTION platform.set_lead_closed_v1(UUID, UUID, BIGINT, BOOLEAN, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.set_lead_closed_v1(UUID, UUID, BIGINT, BOOLEAN, TEXT, TEXT, UUID)
  TO authenticated;
COMMENT ON FUNCTION platform.set_lead_closed_v1(UUID, UUID, BIGINT, BOOLEAN, TEXT, TEXT, UUID) IS
  '«Закрыть лид» / «Вернуть в работу»: lifecycle open <-> disqualified with a reason (no_response, other_agency, budget, duplicate, other + note). Stage, owner and next step unchanged; workflow_version checked, not bumped (111). lead.sales.workflow.manage + lead.read on the lead; a completed handoff (212) refuses closing. Idempotent by request_id via audit_events (lead.lifecycle.change).';

-- ---------------------------------------------------------------------------
-- b) platform.staff_closed_leads_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_closed_leads_v1(
  p_limit INTEGER DEFAULT 50,
  p_cursor TEXT DEFAULT NULL,
  p_lead_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a RECORD;
  cursor_at TIMESTAMPTZ;
  cursor_id UUID;
  result JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role IS NOT DISTINCT FROM 'student'
    OR NOT platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read')
  THEN
    RAISE EXCEPTION 'closed_leads_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR (p_cursor IS NOT NULL AND p_cursor !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  THEN
    RAISE EXCEPTION 'closed_leads_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_cursor IS NOT NULL THEN
    BEGIN
      cursor_at := split_part(p_cursor, '|', 1)::TIMESTAMPTZ;
      cursor_id := split_part(p_cursor, '|', 2)::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'closed_leads_invalid' USING ERRCODE = '22023';
    END;
  END IF;

  WITH closed AS MATERIALIZED (
    SELECT l.id, l.stage_key, l.workflow_version, l.updated_at,
      client.display_name AS client_display_name,
      owner_profile.display_name AS owner_display_name,
      last_close.created_at AS event_at,
      last_close.after_state AS event_state,
      closer_profile.display_name AS closed_by_display_name,
      -- A lead closed outside this command has no event: its last change
      -- orders it, and the row says so (closed_at NULL, no reason).
      COALESCE(last_close.created_at, l.updated_at) AS sort_at
    FROM platform.leads AS l
    LEFT JOIN platform.clients AS client
      ON client.organization_id = l.organization_id AND client.id = l.client_id
    LEFT JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = l.organization_id
     AND owner_membership.id = l.current_owner_membership_id
    LEFT JOIN platform.profiles AS owner_profile ON owner_profile.id = owner_membership.profile_id
    LEFT JOIN LATERAL (
      SELECT e.created_at, e.after_state, e.actor_profile_id
      FROM platform.audit_events AS e
      WHERE e.organization_id = l.organization_id AND e.resource_type = 'lead'
        AND e.resource_id = l.id AND e.action = 'lead.lifecycle.change'
        AND e.after_state ->> 'lifecycle' = 'closed'
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1
    ) AS last_close ON TRUE
    LEFT JOIN platform.profiles AS closer_profile ON closer_profile.id = last_close.actor_profile_id
    WHERE l.organization_id = a.organization_id
      AND l.lifecycle_state = 'disqualified'
      AND (p_lead_id IS NULL OR l.id = p_lead_id)
      AND platform_private.staff_can_access(l.organization_id, a.membership_id, 'lead.read', 'lead', l.id)
  ), page AS MATERIALIZED (
    SELECT closed.*, row_number() OVER (ORDER BY sort_at DESC, id DESC) AS ordinal
    FROM closed
    WHERE p_cursor IS NULL OR (sort_at, id) < (cursor_at, cursor_id)
    ORDER BY sort_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT jsonb_build_object(
    'organization_id', a.organization_id,
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'lead_id', page.id,
      'client_display_name', page.client_display_name,
      'owner_display_name', page.owner_display_name,
      'stage_key', page.stage_key,
      'workflow_version', page.workflow_version::TEXT,
      'closed_at', page.event_at,
      'reason', page.event_state ->> 'reason',
      'note', page.event_state ->> 'note',
      'closed_by_display_name', page.closed_by_display_name,
      'can_manage', platform_private.staff_can_access(a.organization_id, a.membership_id,
        'lead.sales.workflow.manage', 'lead', page.id)
    ) ORDER BY page.ordinal) FROM page WHERE page.ordinal <= p_limit), '[]'::JSONB),
    'next_cursor', (SELECT to_char(page.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        || '|' || page.id::TEXT
      FROM page WHERE page.ordinal = p_limit AND (SELECT count(*) FROM page) > p_limit)
  ) INTO result;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_closed_leads_v1(INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_closed_leads_v1(INTEGER, TEXT, UUID) TO authenticated;
COMMENT ON FUNCTION platform.staff_closed_leads_v1(INTEGER, TEXT, UUID) IS
  'Closed (disqualified) leads the caller reads by lead.read, newest closure first: reason, note, date and who closed from the last lead.lifecycle.change event, can_manage hint. Staff only; p_lead_id narrows to one lead (Lead 360 of a closed lead).';

-- ---------------------------------------------------------------------------
-- c) platform.set_student_case_closed_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.set_student_case_closed_v1(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_expected_version BIGINT,
  p_closed BOOLEAN,
  p_outcome TEXT,
  p_note TEXT,
  p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller RECORD;
  actor RECORD;
  c platform.student_cases%ROWTYPE;
  changed platform.student_cases%ROWTYPE;
  prior platform.audit_events%ROWTYPE;
  note_text TEXT := NULLIF(btrim(p_note,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '');
  target_state TEXT := CASE WHEN p_closed THEN 'closed' ELSE 'active' END;
  playbook_outcome TEXT;
  recorded_at TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_request_id IS NULL OR p_closed IS NULL
    OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9223372036854775806
    OR (p_closed AND (p_outcome IS NULL
      OR p_outcome NOT IN ('enrolled', 'declined', 'not_admitted', 'other')))
    OR (p_closed AND p_outcome = 'other' AND note_text IS NULL)
    OR (p_closed AND p_outcome <> 'other' AND p_note IS NOT NULL)
    OR (NOT p_closed AND (p_outcome IS NOT NULL OR p_note IS NOT NULL))
    OR char_length(note_text) > 500
    OR note_text ~ U&'[\0001-\001F\007F-\009F\2028\2029]'
  THEN
    RAISE EXCEPTION 'case_closure_invalid' USING ERRCODE = '22023';
  END IF;

  -- A Student never closes a case, not even the own one; refused before any lock.
  SELECT a.* INTO caller FROM platform.current_actor_authority() AS a
    WHERE a.organization_id = p_organization_id;
  IF NOT FOUND OR caller.platform_role IS NOT DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  -- Read-only preflight before any advisory lock is taken for this caller.
  SELECT * INTO actor FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);
  IF actor.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.lock_p2d_request(p_request_id);
  -- 137's case-command lock/authority chain with the lifecycle permission,
  -- re-checked after the row lock.
  c := platform_private.admissions_lock_case(p_student_case_id, 'case.lifecycle.change');
  IF c.id IS NULL OR c.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prior FROM platform.audit_events WHERE request_id = p_request_id;
  IF FOUND THEN
    IF prior.organization_id IS DISTINCT FROM p_organization_id
      OR prior.action IS DISTINCT FROM 'case.lifecycle.change'
      OR prior.resource_type IS DISTINCT FROM 'student_case'
      OR prior.resource_id IS DISTINCT FROM p_student_case_id
      OR prior.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR prior.after_state ->> 'case_state' IS DISTINCT FROM target_state
      OR prior.after_state ->> 'outcome' IS DISTINCT FROM p_outcome
      OR prior.after_state ->> 'note' IS DISTINCT FROM note_text
      OR prior.after_state ->> 'admissions_version' IS DISTINCT FROM (p_expected_version + 1)::TEXT
    THEN
      RAISE EXCEPTION 'case_closure_request_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'organization_id', prior.organization_id, 'student_case_id', prior.resource_id,
      'state', prior.after_state -> 'case_state',
      'outcome', prior.after_state -> 'outcome', 'note', prior.after_state -> 'note',
      'closed_at', prior.after_state -> 'closed_at',
      'admissions_version', prior.after_state -> 'admissions_version',
      'request_id', prior.request_id, 'changed_at', prior.created_at
    );
  END IF;

  IF (p_closed AND c.state <> 'active') OR (NOT p_closed AND c.state <> 'closed') THEN
    RAISE EXCEPTION 'case_closure_state_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF p_expected_version <> c.admissions_version OR c.admissions_version = 9223372036854775807 THEN
    RAISE EXCEPTION 'case_closure_version_conflict' USING ERRCODE = 'PT409';
  END IF;

  -- 137 playbook cases: the playbook outcome must follow the state
  -- (admissions_guard_case); 'arrived' needs the confirmed arrival facts.
  IF c.admissions_playbook_version_id IS NOT NULL THEN
    playbook_outcome := CASE
      WHEN NOT p_closed THEN 'active'
      WHEN p_outcome = 'enrolled' AND c.operational_stage = 'arrival_and_adaptation'
        AND c.admissions_facts ?& ARRAY['arrivalOn', 'arrivalConfirmedBy', 'arrivalEvidence'] THEN 'arrived'
      ELSE 'cancelled'
    END;
  END IF;

  UPDATE platform.student_cases AS sc
  SET state = target_state::platform.student_case_state,
    closed_at = CASE WHEN p_closed THEN statement_timestamp() ELSE NULL END,
    admissions_outcome = CASE WHEN c.admissions_playbook_version_id IS NULL
      THEN sc.admissions_outcome ELSE playbook_outcome END,
    admissions_version = sc.admissions_version + 1
  WHERE sc.organization_id = c.organization_id AND sc.id = c.id
  RETURNING * INTO changed;

  INSERT INTO platform.student_case_lifecycle_events (
    organization_id, student_case_id, event_type, previous_state, new_state,
    actor_membership_id, reason, request_id
  ) VALUES (
    c.organization_id, c.id, CASE WHEN p_closed THEN 'closed' ELSE 'reopened' END,
    c.state, changed.state, actor.membership_id,
    CASE WHEN p_closed THEN 'Case finished: ' || p_outcome ELSE 'Case returned to work' END,
    p_request_id
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id,
    actor_principal, action, resource_type, resource_id, before_state,
    after_state, reason, request_id, resulting_version
  ) VALUES (
    c.organization_id, 'user', actor.profile_id, actor.membership_id,
    'auth:' || actor.auth_user_id::TEXT, 'case.lifecycle.change', 'student_case', c.id,
    jsonb_build_object('case_state', c.state::TEXT, 'closed_at', c.closed_at,
      'admissions_version', c.admissions_version::TEXT),
    jsonb_build_object('case_state', changed.state::TEXT, 'closed_at', changed.closed_at,
      'outcome', p_outcome, 'note', note_text,
      'admissions_version', changed.admissions_version::TEXT),
    CASE WHEN p_closed THEN 'Case finished' ELSE 'Case returned to work' END,
    p_request_id, changed.admissions_version
  ) RETURNING created_at INTO recorded_at;

  RETURN jsonb_build_object(
    'organization_id', changed.organization_id, 'student_case_id', changed.id,
    'state', changed.state::TEXT, 'outcome', p_outcome, 'note', note_text,
    'closed_at', changed.closed_at,
    'admissions_version', changed.admissions_version::TEXT,
    'request_id', p_request_id, 'changed_at', recorded_at
  );
END
$$;

REVOKE ALL ON FUNCTION platform.set_student_case_closed_v1(UUID, UUID, BIGINT, BOOLEAN, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.set_student_case_closed_v1(UUID, UUID, BIGINT, BOOLEAN, TEXT, TEXT, UUID)
  TO authenticated;
COMMENT ON FUNCTION platform.set_student_case_closed_v1(UUID, UUID, BIGINT, BOOLEAN, TEXT, TEXT, UUID) IS
  '«Завершить дело» / «Вернуть в работу»: active <-> closed (042 transitions) with an outcome (enrolled, declined, not_admitted, other + note). Authority = 137/241 case commands with case.lifecycle.change (admissions_lock_case); Students refused; optimistic admissions_version (+1); student_case_lifecycle_events + audit case.lifecycle.change; idempotent by request_id.';

-- ---------------------------------------------------------------------------
-- d) platform.staff_student_case_closure_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_student_case_closure_v1(
  p_organization_id UUID,
  p_student_case_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller RECORD;
  c platform.student_cases%ROWTYPE;
  closed_outcome TEXT;
  closed_note TEXT;
  closed_by TEXT;
BEGIN
  SELECT a.* INTO caller FROM platform.current_actor_authority() AS a
    WHERE a.organization_id = p_organization_id;
  IF NOT FOUND OR caller.platform_role IS NOT DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  -- case.read.full on this case; lock-free.
  PERFORM platform_private.u7_require_case_workspace_actor(p_student_case_id);
  SELECT * INTO c FROM platform.student_cases AS sc
    WHERE sc.organization_id = p_organization_id AND sc.id = p_student_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;

  -- The current closure: the latest 'closed' lifecycle event (every closing
  -- path writes one, 042/137/246); its outcome exists only when this
  -- migration's command wrote the matching audit row.
  IF c.state = 'closed' THEN
    SELECT closer.display_name, audit.after_state ->> 'outcome', audit.after_state ->> 'note'
    INTO closed_by, closed_outcome, closed_note
    FROM platform.student_case_lifecycle_events AS event
    LEFT JOIN platform.organization_memberships AS m
      ON m.organization_id = event.organization_id AND m.id = event.actor_membership_id
    LEFT JOIN platform.profiles AS closer ON closer.id = m.profile_id
    LEFT JOIN platform.audit_events AS audit
      ON audit.request_id = event.request_id AND audit.action = 'case.lifecycle.change'
     AND audit.resource_type = 'student_case' AND audit.resource_id = event.student_case_id
    WHERE event.organization_id = c.organization_id AND event.student_case_id = c.id
      AND event.event_type = 'closed'
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'organization_id', c.organization_id,
    'student_case_id', c.id,
    'state', c.state::TEXT,
    'admissions_version', c.admissions_version::TEXT,
    'closed_at', c.closed_at,
    'outcome', closed_outcome,
    'note', closed_note,
    'closed_by_display_name', closed_by,
    'can_change', c.state IN ('active', 'closed')
      AND platform_private.staff_can_access(p_organization_id, caller.membership_id,
        'case.lifecycle.change', 'student_case', c.id)
  );
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_closure_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_closure_v1(UUID, UUID) TO authenticated;
COMMENT ON FUNCTION platform.staff_student_case_closure_v1(UUID, UUID) IS
  'Closure of one case for staff (case.read.full): state, admissions_version, closed_at, outcome/note/who from the latest closed lifecycle event and its 246 audit row, can_change hint (case.lifecycle.change). Students refused; lock-free.';

-- ---------------------------------------------------------------------------
-- Self-check: definer, empty search_path, authenticated-only EXECUTE, no
-- coarse-role gate.
-- ---------------------------------------------------------------------------
DO $a246_verify$
DECLARE routine RECORD; checked INTEGER := 0;
BEGIN
  FOR routine IN SELECT p.oid, p.oid::REGPROCEDURE AS signature, p.prosrc, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN (
      'platform.set_lead_closed_v1(uuid,uuid,bigint,boolean,text,text,uuid)'::regprocedure,
      'platform.staff_closed_leads_v1(integer,text,uuid)'::regprocedure,
      'platform.set_student_case_closed_v1(uuid,uuid,bigint,boolean,text,text,uuid)'::regprocedure,
      'platform.staff_student_case_closure_v1(uuid,uuid)'::regprocedure)
  LOOP
    checked := checked + 1;
    IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR routine.prosrc ~ 'platform_role\s*(NOT\s+)?IN\s*\(' OR routine.prosrc ~ 'platform_role\s*(<>|=)\s*'''
      OR NOT has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      OR has_function_privilege('anon', routine.oid, 'EXECUTE')
      OR has_function_privilege('service_role', routine.oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'a246_closure_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
  IF checked <> 4 THEN
    RAISE EXCEPTION 'a246_closure_verification_failed: % of 4 functions', checked;
  END IF;
END
$a246_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
