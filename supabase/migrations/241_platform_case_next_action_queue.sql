-- «Студенты» — queue backend (PR 1 of 2; the UI PR follows).
-- docs/PLAN_CHANGES.md «2026-09-25 — «Студенты»: решения владельца по критике
-- 24.09; backend очереди дел (PR 1 из 2)».
--
-- Owner decision 25.09: «Следующий шаг / Срок» is the EDITABLE case field
-- platform.student_cases.next_action / next_action_due_on (042/137), edited by
-- the case's curator and Admin. Today no CRM application code writes it after
-- the Sales handoff default (088) (137's configure/update_case_admissions_*_v1
-- can, but nothing in the app calls them), and the directory is ordered by
-- updated_at (078).
--
-- STAFF-ONLY. Until this migration the same column was also returned to the
-- Student word for word by platform.student_portal_cases() (042; the iPhone
-- home «Следующий шаг») and platform.student_portal_profile()
-- (case_next_action, 159). A staff-edited free-text step («Позвонить
-- студенту») is an instruction for staff, so section (f) stops both Student
-- projections from returning it. docs/PLAN_CHANGES.md «2026-09-25 —
-- «Студенты» PR 1: «Следующий шаг» только для сотрудников» records that the
-- owner has not yet chosen between a student-facing and a staff-only step and
-- that this is the safe default until they do.
--
-- Forward-only. Everything is additive except (e) and (f), which rewrite the
-- bodies of three existing functions and keep their signatures and grants:
--
--  a) platform_private.case_next_action_band / case_queue_in_view: two small
--     IMMUTABLE predicates shared by the page read and the counts read, so a
--     tab or band number is always computed by the SAME expression as the rows
--     the click shows.
--  b) platform.set_case_next_action_v1: set or clear the next step and its
--     optional due date.
--     * Authority is exactly the other route-level case commands' authority
--       (137 configure/update_case_admissions_*_v1): the read-only preflight
--       platform_private.u7_require_case_workspace_actor, then
--       platform_private.admissions_lock_case(case, 'case.route.manage'),
--       i.e. the shared assignment-domain lock, require_domain_actor,
--       SELECT ... FOR UPDATE and a post-lock require_case_operator. The
--       case's curator (own scope) and Admin pass; Sales (no
--       case.route.manage/case.read.full), another curator (own scope misses)
--       a Student and anon are refused with 42501. A role holding
--       case.route.manage on a department/direction/record scope passes, the
--       same as for every other case.route.manage command. Admin role preview
--       is refused in the server action (preview never writes).
--     * Optimistic version: admissions_version — the existing token for the
--       admissions-owned case fields including next_action (137); every write
--       bumps it by exactly one, which also satisfies 137's
--       admissions_case_command_guard for playbook-configured cases. The
--       application requirements editor (226) folds admissions_version into
--       its contextHash, so an editor opened before a next-step save asks for
--       a reload instead of silently overwriting (fail-closed, intended).
--     * Idempotency: request_id through platform.audit_events (UNIQUE
--       request_id), the 042/182 shape. An exact replay by the same actor
--       returns the original receipt rebuilt from that audit row; any other
--       reuse is 22023.
--     * Event: platform.audit_events action 'case.next.action.change' on the
--       student_case (before/after: next_action, next_action_due_on,
--       admissions_version). The wording label `next_action_updated` in
--       src/lib/v3/wording.ts is a leftover of the retired v2
--       evo_business_events runtime (`application.next_action_updated`,
--       commit 8a3ead549); no current Platform code writes it. Section (e)
--       makes the new action visible in the case «История».
--  c) platform.staff_student_case_queue_v1: one page of the work queue.
--     Views mine / needs_action / active / needs_curator / closed; filters
--     direction, curator, pipeline_stage (187 board words) and search; sort
--     'due' = next_action_due_on ASC NULLS LAST (dated steps first, then a
--     step without a date, then no step at all), then student_case_id — or
--     'updated' = updated_at DESC, id DESC (the 078 order). Keyset cursor
--     carries only a rank, a date or timestamp and a case id (no personal
--     data). Row visibility is private.platform_can_read_student_case, the
--     same predicate as the 078 page, the 183 summary and the 187 board;
--     «Мои» only narrows it to cases the actor currently curates.
--  d) platform.staff_student_case_queue_counts_v1: tab (view), band and facet
--     counts under the same filters as (c). admissions_direction_summary_v1
--     (183) is unchanged: it cannot express the needs_action union, closed
--     cases, due bands or the pipeline_stage filter.
--  e) private.staff_student_case_activity (132): its student_case allowlist
--     gains 'case.next.action.change' (self-verifying anchor replace, the
--     182 pattern; CREATE OR REPLACE keeps the owner and grants). The Admin
--     audit search allowlist (p7a) is NOT widened here.
--  f) platform.student_portal_cases() and platform.student_portal_profile():
--     the next_action / case_next_action column is always NULL (same anchor
--     replace; same signature, owner and grants). The web portal is not
--     affected: it reads student_portal_overview_v2 (131), which never used
--     the free-text case step.
--
-- Style: SECURITY DEFINER, SET search_path = '', REVOKE/GRANT pairs, no
-- existing signature or default changes. References:
-- https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY
-- https://www.postgresql.org/docs/current/functions-comparisons.html#ROW-WISE-COMPARISON
-- https://docs.postgrest.org/en/stable/references/errors.html (PTxxx -> HTTP status)
BEGIN;

-- ---------------------------------------------------------------------------
-- a) Shared predicates
-- ---------------------------------------------------------------------------
-- Band of a case by its editable next step relative to the Bishkek day.
-- «На этой неделе» ends on the ISO-week Sunday of p_today.
CREATE FUNCTION platform_private.case_next_action_band(
  p_next_action TEXT, p_due_on DATE, p_today DATE
) RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_next_action IS NULL THEN 'no_step'
    WHEN p_due_on IS NULL THEN 'undated'
    WHEN p_due_on < p_today THEN 'overdue'
    WHEN p_due_on = p_today THEN 'today'
    WHEN p_due_on <= p_today + (7 - EXTRACT(ISODOW FROM p_today)::INTEGER) THEN 'this_week'
    ELSE 'later'
  END
$$;

-- View membership. p_flags is only read by needs_action/needs_curator, so
-- callers may pass NULL for the other views and skip the flag computation.
CREATE FUNCTION platform_private.case_queue_in_view(
  p_view TEXT, p_state platform.student_case_state, p_is_mine BOOLEAN, p_flags TEXT[]
) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_view
    WHEN 'mine' THEN p_state = 'active' AND COALESCE(p_is_mine, FALSE)
    WHEN 'needs_action' THEN COALESCE(p_flags && ARRAY['overdue', 'awaiting_ack', 'needs_curator']::TEXT[], FALSE)
    WHEN 'active' THEN p_state = 'active'
    WHEN 'needs_curator' THEN COALESCE('needs_curator' = ANY (p_flags), FALSE)
    WHEN 'closed' THEN p_state = 'closed'
    ELSE FALSE
  END
$$;

REVOKE ALL ON FUNCTION platform_private.case_next_action_band(TEXT, DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.case_queue_in_view(TEXT, platform.student_case_state, BOOLEAN, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- b) platform.set_case_next_action_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.set_case_next_action_v1(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_expected_version BIGINT,
  p_next_action TEXT,
  p_next_action_due_on DATE,
  p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  c platform.student_cases%ROWTYPE;
  changed platform.student_cases%ROWTYPE;
  prior platform.audit_events%ROWTYPE;
  normalized TEXT := NULLIF(btrim(p_next_action,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '');
  due_text TEXT;
  recorded_at TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL OR p_request_id IS NULL
    OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9223372036854775806
    OR (normalized IS NULL AND p_next_action_due_on IS NOT NULL)
    OR char_length(normalized) > 1000
    -- One line, locale-independent: C0 and C1 controls, U+2028 and U+2029,
    -- exactly the TypeScript WRITE_CONTROL_PATTERN (text cannot hold U+0000).
    OR normalized ~ U&'[\0001-\001F\007F-\009F\2028\2029]'
    OR (p_next_action_due_on IS NOT NULL
      AND p_next_action_due_on NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
  THEN
    RAISE EXCEPTION 'case_next_action_invalid' USING ERRCODE = '22023';
  END IF;
  due_text := to_char(p_next_action_due_on, 'YYYY-MM-DD');

  -- Read-only preflight before any advisory lock is taken for this caller.
  SELECT * INTO actor FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);
  IF actor.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.lock_p2d_request(p_request_id);
  -- 137's route-command lock/authority chain, re-checked after the row lock.
  c := platform_private.admissions_lock_case(p_student_case_id, 'case.route.manage');
  IF c.id IS NULL OR c.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prior FROM platform.audit_events WHERE request_id = p_request_id;
  IF FOUND THEN
    IF prior.organization_id IS DISTINCT FROM p_organization_id
      OR prior.action IS DISTINCT FROM 'case.next.action.change'
      OR prior.resource_type IS DISTINCT FROM 'student_case'
      OR prior.resource_id IS DISTINCT FROM p_student_case_id
      OR prior.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR prior.after_state ->> 'next_action' IS DISTINCT FROM normalized
      OR prior.after_state ->> 'next_action_due_on' IS DISTINCT FROM due_text
      OR prior.after_state ->> 'admissions_version' IS DISTINCT FROM (p_expected_version + 1)::TEXT
    THEN
      RAISE EXCEPTION 'case_next_action_request_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'organization_id', prior.organization_id, 'student_case_id', prior.resource_id,
      'next_action', prior.after_state -> 'next_action',
      'next_action_due_on', prior.after_state -> 'next_action_due_on',
      'admissions_version', prior.after_state -> 'admissions_version',
      'cleared', prior.after_state -> 'next_action' = 'null'::JSONB,
      'request_id', prior.request_id, 'changed_at', prior.created_at
    );
  END IF;

  IF c.state <> 'active' THEN
    RAISE EXCEPTION 'case_next_action_case_not_active' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version <> c.admissions_version OR c.admissions_version = 9223372036854775807 THEN
    RAISE EXCEPTION 'case_next_action_version_conflict' USING ERRCODE = 'PT409';
  END IF;

  UPDATE platform.student_cases
  SET next_action = normalized,
    next_action_due_on = p_next_action_due_on,
    admissions_version = admissions_version + 1
  WHERE organization_id = c.organization_id AND id = c.id
  RETURNING * INTO changed;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id,
    actor_principal, action, resource_type, resource_id, before_state,
    after_state, reason, request_id, resulting_version
  ) VALUES (
    c.organization_id, 'user', actor.profile_id, actor.membership_id,
    'auth:' || actor.auth_user_id::TEXT, 'case.next.action.change', 'student_case', c.id,
    jsonb_build_object('next_action', c.next_action,
      'next_action_due_on', to_char(c.next_action_due_on, 'YYYY-MM-DD'),
      'admissions_version', c.admissions_version::TEXT),
    jsonb_build_object('next_action', changed.next_action,
      'next_action_due_on', to_char(changed.next_action_due_on, 'YYYY-MM-DD'),
      'admissions_version', changed.admissions_version::TEXT),
    CASE WHEN normalized IS NULL THEN 'Case next action cleared' ELSE 'Case next action set' END,
    p_request_id, changed.admissions_version
  ) RETURNING created_at INTO recorded_at;

  -- The receipt is the committed row, never an optimistic echo of the input.
  RETURN jsonb_build_object(
    'organization_id', changed.organization_id, 'student_case_id', changed.id,
    'next_action', changed.next_action,
    'next_action_due_on', to_char(changed.next_action_due_on, 'YYYY-MM-DD'),
    'admissions_version', changed.admissions_version::TEXT,
    'cleared', changed.next_action IS NULL,
    'request_id', p_request_id, 'changed_at', recorded_at
  );
END
$$;

REVOKE ALL ON FUNCTION platform.set_case_next_action_v1(UUID, UUID, BIGINT, TEXT, DATE, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.set_case_next_action_v1(UUID, UUID, BIGINT, TEXT, DATE, UUID)
  TO authenticated;
COMMENT ON FUNCTION platform.set_case_next_action_v1(UUID, UUID, BIGINT, TEXT, DATE, UUID) IS
  '«Следующий шаг / Срок»: set or clear student_cases.next_action/next_action_due_on on an active case. Staff-only: since 241 the Student projections return NULL for it. Authority = 137 route commands (admissions_lock_case, case.route.manage); optimistic admissions_version (+1); idempotent by request_id via audit_events; appends case.next.action.change.';

-- ---------------------------------------------------------------------------
-- c) platform.staff_student_case_queue_v1
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_student_case_queue_v1(
  p_view TEXT,
  p_limit INTEGER DEFAULT 25,
  p_sort TEXT DEFAULT 'due',
  p_cursor TEXT DEFAULT NULL,
  p_direction TEXT DEFAULT NULL,
  p_curator_membership_id UUID DEFAULT NULL,
  p_pipeline_stage TEXT DEFAULT NULL,
  p_query TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a RECORD;
  today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE;
  q TEXT := NULLIF(btrim(p_query), '');
  parts TEXT[];
  cursor_rank INTEGER;
  cursor_due DATE;
  cursor_updated TIMESTAMPTZ;
  cursor_id UUID;
  cursor_invalid BOOLEAN := FALSE;
  result JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role NOT IN ('admin', 'curator')
    OR NOT private.platform_has_permission(a.organization_id, 'case.read.full') THEN
    RAISE EXCEPTION 'Staff admissions authority required' USING ERRCODE = '42501';
  END IF;
  IF p_view IS NULL OR p_view NOT IN ('mine', 'needs_action', 'active', 'needs_curator', 'closed')
    OR p_sort IS NULL OR p_sort NOT IN ('due', 'updated')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR (p_direction IS NOT NULL AND p_direction NOT IN ('CN', 'MY', 'EUROPE', 'AE', 'TR', 'unknown'))
    OR (p_pipeline_stage IS NOT NULL AND p_pipeline_stage NOT IN ('new', 'shortlist', 'documents',
      'ready_to_submit', 'awaiting_decision', 'confirmed', 'visa', 'predeparture', 'arrived'))
    OR (p_query IS NOT NULL AND char_length(p_query) > 200)
  THEN
    RAISE EXCEPTION 'Invalid student case queue request' USING ERRCODE = '22023';
  END IF;

  IF p_cursor IS NOT NULL THEN
    parts := string_to_array(p_cursor, '|');
    BEGIN
      IF p_sort = 'due' AND p_cursor ~ '^due\|[012]\|([0-9]{4}-[0-9]{2}-[0-9]{2}|infinity)\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        cursor_rank := parts[2]::INTEGER;
        cursor_due := parts[3]::DATE;
        cursor_id := parts[4]::UUID;
        -- Rank 0 carries a real date; ranks 1-2 (no date / no step) carry infinity.
        cursor_invalid := (cursor_rank = 0) = (cursor_due = 'infinity'::DATE);
      ELSIF p_sort = 'updated' AND p_cursor ~ '^updated\|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        cursor_updated := parts[2]::TIMESTAMPTZ;
        cursor_id := parts[3]::UUID;
      ELSE
        cursor_invalid := TRUE;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      cursor_invalid := TRUE;
    END;
    IF cursor_invalid THEN
      RAISE EXCEPTION 'Invalid student case queue cursor' USING ERRCODE = '22023';
    END IF;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT c.organization_id, c.id, c.updated_at,
      platform_private.case_next_action_band(c.next_action, c.next_action_due_on, today) AS band,
      CASE WHEN c.next_action IS NULL THEN 2 WHEN c.next_action_due_on IS NULL THEN 1 ELSE 0 END AS sort_rank,
      CASE WHEN c.next_action IS NOT NULL AND c.next_action_due_on IS NOT NULL
        THEN c.next_action_due_on ELSE 'infinity'::DATE END AS sort_due
    FROM platform.student_cases AS c
    WHERE c.organization_id = a.organization_id
      AND (p_direction IS NULL OR COALESCE(c.admissions_direction, 'unknown') = p_direction)
      AND (p_curator_membership_id IS NULL OR c.current_curator_membership_id = p_curator_membership_id)
      AND (p_pipeline_stage IS NULL OR c.pipeline_stage = p_pipeline_stage)
      AND (q IS NULL OR strpos(lower(concat_ws(' ', c.student_display_name, c.target_country,
        c.target_degree, c.program_direction)), lower(q)) > 0)
      AND private.platform_can_read_student_case(c.organization_id, c.id)
      AND platform_private.case_queue_in_view(p_view, c.state,
        c.current_curator_membership_id = a.membership_id,
        CASE WHEN p_view IN ('needs_action', 'needs_curator') AND c.state IN ('active', 'pending')
          THEN platform_private.admissions_attention_flags(c.id) END)
  ), page AS MATERIALIZED (
    SELECT candidates.*, row_number() OVER (ORDER BY
      CASE WHEN p_sort = 'due' THEN sort_rank END ASC,
      CASE WHEN p_sort = 'due' THEN sort_due END ASC,
      CASE WHEN p_sort = 'due' THEN id END ASC,
      CASE WHEN p_sort = 'updated' THEN updated_at END DESC,
      CASE WHEN p_sort = 'updated' THEN id END DESC) AS ordinal
    FROM candidates
    WHERE p_cursor IS NULL
      OR (p_sort = 'due' AND (sort_rank, sort_due, id) > (cursor_rank, cursor_due, cursor_id))
      OR (p_sort = 'updated' AND (updated_at, id) < (cursor_updated, cursor_id))
    ORDER BY
      CASE WHEN p_sort = 'due' THEN sort_rank END ASC,
      CASE WHEN p_sort = 'due' THEN sort_due END ASC,
      CASE WHEN p_sort = 'due' THEN id END ASC,
      CASE WHEN p_sort = 'updated' THEN updated_at END DESC,
      CASE WHEN p_sort = 'updated' THEN id END DESC
    LIMIT p_limit + 1
  ), shown AS (
    SELECT page.ordinal, page.band,
      CASE WHEN p_sort = 'due'
        THEN 'due|' || page.sort_rank || '|' || CASE WHEN page.sort_due = 'infinity'::DATE
          THEN 'infinity' ELSE to_char(page.sort_due, 'YYYY-MM-DD') END || '|' || page.id::TEXT
        ELSE 'updated|' || to_char(page.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          || '|' || page.id::TEXT
      END AS row_cursor,
      c.*,
      curator_profile.display_name AS curator_display_name,
      platform_private.admissions_attention_flags(c.id) AS flags,
      private.platform_can_read_document_full(c.organization_id, c.id) AS can_read_documents
    FROM page
    JOIN platform.student_cases AS c ON c.organization_id = page.organization_id AND c.id = page.id
    LEFT JOIN platform.organization_memberships AS curator_membership
      ON curator_membership.organization_id = c.organization_id
     AND curator_membership.id = c.current_curator_membership_id
    LEFT JOIN platform.profiles AS curator_profile ON curator_profile.id = curator_membership.profile_id
    WHERE page.ordinal <= p_limit
  )
  SELECT jsonb_build_object(
    'view', p_view,
    'sort', p_sort,
    'today', to_char(today, 'YYYY-MM-DD'),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'student_case_id', shown.id,
      'student_display_name', shown.student_display_name,
      'state', shown.state,
      'admissions_direction', shown.admissions_direction,
      'target_country', shown.target_country,
      'target_degree', shown.target_degree,
      'pipeline_stage', shown.pipeline_stage,
      'pipeline_hidden', shown.pipeline_hidden_at IS NOT NULL,
      'next_action', shown.next_action,
      'next_action_due_on', to_char(shown.next_action_due_on, 'YYYY-MM-DD'),
      'due_band', shown.band,
      'admissions_version', shown.admissions_version::TEXT,
      'current_curator_membership_id', shown.current_curator_membership_id,
      'current_curator_display_name', shown.curator_display_name,
      'is_mine', COALESCE(shown.current_curator_membership_id = a.membership_id, FALSE),
      'attention_flags', to_jsonb(COALESCE(shown.flags, ARRAY[]::TEXT[])),
      'overdue_task_count', (
        SELECT count(*) FROM platform.case_tasks AS task
        WHERE task.organization_id = shown.organization_id AND task.student_case_id = shown.id
          AND task.status NOT IN ('done', 'cancelled')
          AND ((task.due_at IS NOT NULL AND task.due_at < CURRENT_TIMESTAMP)
            OR (task.due_on IS NOT NULL AND task.due_on < today))),
      'documents', CASE WHEN shown.can_read_documents THEN (
        SELECT jsonb_build_object(
          'total', count(*),
          'submitted', count(*) FILTER (WHERE slot.status = 'submitted'),
          'correction_required', count(*) FILTER (WHERE slot.status = 'correction_required'),
          'rejected', count(*) FILTER (WHERE slot.status = 'rejected'),
          'approved', count(*) FILTER (WHERE slot.status = 'approved'),
          'missing', count(*) FILTER (WHERE slot.status = 'required'))
        FROM platform.document_slots AS slot
        WHERE slot.organization_id = shown.organization_id AND slot.student_case_id = shown.id
          AND slot.removed_at IS NULL) END,
      'updated_at', shown.updated_at,
      'cursor', shown.row_cursor
    ) ORDER BY shown.ordinal) FROM shown), '[]'::JSONB),
    'next_cursor', CASE WHEN (SELECT count(*) FROM page) > p_limit
      THEN (SELECT shown.row_cursor FROM shown WHERE shown.ordinal = p_limit) END
  ) INTO result;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT)
  TO authenticated;
COMMENT ON FUNCTION platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) IS
  '«Студенты» work queue page: views mine/needs_action/active/needs_curator/closed, due or updated keyset order, pipeline_stage and checklist document counts per row; visibility = private.platform_can_read_student_case.';

-- ---------------------------------------------------------------------------
-- d) platform.staff_student_case_queue_counts_v1
-- ---------------------------------------------------------------------------
-- Every number equals the row count staff_student_case_queue_v1 returns for
-- the same arguments: tab counts apply all filters; each facet applies every
-- filter except its own (direction, curator, stage) plus p_view.
CREATE FUNCTION platform.staff_student_case_queue_counts_v1(
  p_view TEXT DEFAULT 'active',
  p_direction TEXT DEFAULT NULL,
  p_curator_membership_id UUID DEFAULT NULL,
  p_pipeline_stage TEXT DEFAULT NULL,
  p_query TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a RECORD;
  today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE;
  q TEXT := NULLIF(btrim(p_query), '');
  result JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role NOT IN ('admin', 'curator')
    OR NOT private.platform_has_permission(a.organization_id, 'case.read.full') THEN
    RAISE EXCEPTION 'Staff admissions authority required' USING ERRCODE = '42501';
  END IF;
  IF p_view IS NULL OR p_view NOT IN ('mine', 'needs_action', 'active', 'needs_curator', 'closed')
    OR (p_direction IS NOT NULL AND p_direction NOT IN ('CN', 'MY', 'EUROPE', 'AE', 'TR', 'unknown'))
    OR (p_pipeline_stage IS NOT NULL AND p_pipeline_stage NOT IN ('new', 'shortlist', 'documents',
      'ready_to_submit', 'awaiting_decision', 'confirmed', 'visa', 'predeparture', 'arrived'))
    OR (p_query IS NOT NULL AND char_length(p_query) > 200)
  THEN
    RAISE EXCEPTION 'Invalid student case queue request' USING ERRCODE = '22023';
  END IF;

  WITH base AS MATERIALIZED (
    SELECT c.id, c.state, c.pipeline_stage, c.current_curator_membership_id AS curator_id,
      COALESCE(c.admissions_direction, 'unknown') AS direction_key,
      COALESCE(c.current_curator_membership_id = a.membership_id, FALSE) AS is_mine,
      CASE WHEN c.state IN ('active', 'pending') THEN platform_private.admissions_attention_flags(c.id) END AS flags,
      platform_private.case_next_action_band(c.next_action, c.next_action_due_on, today) AS band,
      (p_direction IS NULL OR COALESCE(c.admissions_direction, 'unknown') = p_direction) AS m_direction,
      (p_curator_membership_id IS NULL OR c.current_curator_membership_id = p_curator_membership_id) AS m_curator,
      (p_pipeline_stage IS NULL OR c.pipeline_stage = p_pipeline_stage) AS m_stage
    FROM platform.student_cases AS c
    WHERE c.organization_id = a.organization_id
      AND (q IS NULL OR strpos(lower(concat_ws(' ', c.student_display_name, c.target_country,
        c.target_degree, c.program_direction)), lower(q)) > 0)
      AND private.platform_can_read_student_case(c.organization_id, c.id)
  ), viewed AS MATERIALIZED (
    SELECT base.*, platform_private.case_queue_in_view(p_view, base.state, base.is_mine, base.flags) AS in_view
    FROM base
  )
  SELECT jsonb_build_object(
    'view', p_view,
    'today', to_char(today, 'YYYY-MM-DD'),
    'views', (SELECT jsonb_build_object(
      'mine', count(*) FILTER (WHERE platform_private.case_queue_in_view('mine', state, is_mine, flags)),
      'needs_action', count(*) FILTER (WHERE platform_private.case_queue_in_view('needs_action', state, is_mine, flags)),
      'active', count(*) FILTER (WHERE platform_private.case_queue_in_view('active', state, is_mine, flags)),
      'needs_curator', count(*) FILTER (WHERE platform_private.case_queue_in_view('needs_curator', state, is_mine, flags)),
      'closed', count(*) FILTER (WHERE platform_private.case_queue_in_view('closed', state, is_mine, flags)))
      FROM base WHERE m_direction AND m_curator AND m_stage),
    'total', (SELECT count(*) FROM viewed WHERE in_view AND m_direction AND m_curator AND m_stage),
    'bands', (SELECT jsonb_build_object(
      'overdue', count(*) FILTER (WHERE band = 'overdue'),
      'today', count(*) FILTER (WHERE band = 'today'),
      'this_week', count(*) FILTER (WHERE band = 'this_week'),
      'later', count(*) FILTER (WHERE band = 'later'),
      'undated', count(*) FILTER (WHERE band = 'undated'),
      'no_step', count(*) FILTER (WHERE band = 'no_step'))
      FROM viewed WHERE in_view AND m_direction AND m_curator AND m_stage),
    'directions', COALESCE((SELECT jsonb_agg(jsonb_build_object('direction', facet.direction_key, 'count', facet.n)
      ORDER BY facet.direction_key)
      FROM (SELECT direction_key, count(*) AS n FROM viewed
        WHERE in_view AND m_curator AND m_stage GROUP BY direction_key) AS facet), '[]'::JSONB),
    'curators', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'membership_id', facet.curator_id, 'display_name', curator_profile.display_name,
        'is_me', facet.curator_id = a.membership_id, 'count', facet.n)
      ORDER BY facet.curator_id = a.membership_id DESC, lower(curator_profile.display_name), facet.curator_id)
      FROM (SELECT curator_id, count(*) AS n FROM viewed
        WHERE in_view AND m_direction AND m_stage AND curator_id IS NOT NULL GROUP BY curator_id) AS facet
      LEFT JOIN platform.organization_memberships AS curator_membership
        ON curator_membership.organization_id = a.organization_id AND curator_membership.id = facet.curator_id
      LEFT JOIN platform.profiles AS curator_profile ON curator_profile.id = curator_membership.profile_id), '[]'::JSONB),
    'stages', COALESCE((SELECT jsonb_agg(jsonb_build_object('pipeline_stage', facet.pipeline_stage, 'count', facet.n)
      ORDER BY array_position(ARRAY['new', 'shortlist', 'documents', 'ready_to_submit', 'awaiting_decision',
        'confirmed', 'visa', 'predeparture', 'arrived']::TEXT[], facet.pipeline_stage))
      FROM (SELECT pipeline_stage, count(*) AS n FROM viewed
        WHERE in_view AND m_direction AND m_curator GROUP BY pipeline_stage) AS facet), '[]'::JSONB)
  ) INTO result;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_queue_counts_v1(TEXT, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_queue_counts_v1(TEXT, TEXT, UUID, TEXT, TEXT)
  TO authenticated;
COMMENT ON FUNCTION platform.staff_student_case_queue_counts_v1(TEXT, TEXT, UUID, TEXT, TEXT) IS
  '«Студенты» queue counts: views, due bands and direction/curator/stage facets under the exact filters of staff_student_case_queue_v1; visibility = private.platform_can_read_student_case.';

-- ---------------------------------------------------------------------------
-- e) «История» дела: the activity allowlist gains the next-step event
-- ---------------------------------------------------------------------------
DO $a241_activity$
DECLARE original TEXT; body TEXT;
BEGIN
  original := pg_get_functiondef(
    'private.staff_student_case_activity(uuid,integer,timestamptz,uuid)'::regprocedure
  );
  body := replace(
    original,
    $old$'case.coverage.start','case.coverage.return']::TEXT[])$old$,
    $new$'case.coverage.start','case.coverage.return','case.next.action.change']::TEXT[])$new$
  );
  IF body = original
    OR (length(body) - length(replace(body, $chk$'case.next.action.change'$chk$, '')))
      / length($chk$'case.next.action.change'$chk$) <> 1
  THEN
    RAISE EXCEPTION 'staff_student_case_activity_source_anchor_drift';
  END IF;
  EXECUTE body;
END
$a241_activity$;

-- ---------------------------------------------------------------------------
-- f) The next step is staff-only: the Student projections stop returning it
-- ---------------------------------------------------------------------------
-- Both functions keep their RETURNS TABLE, so CREATE OR REPLACE keeps the
-- owner and the EXECUTE grant (authenticated only); the column stays in the
-- shape and is NULL for every row. Each body must reference
-- student_case.next_action exactly once before and not at all after.
DO $a241_portal$
DECLARE target TEXT; original TEXT; body TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['platform.student_portal_cases()', 'platform.student_portal_profile()'] LOOP
    original := pg_get_functiondef(target::regprocedure);
    body := replace(original, 'student_case.next_action,', 'NULL::TEXT,');
    IF (length(original) - length(replace(original, 'student_case.next_action', '')))
        / length('student_case.next_action') <> 1
      OR strpos(body, 'student_case.next_action') > 0
    THEN
      RAISE EXCEPTION 'student_portal_next_action_anchor_drift: %', target;
    END IF;
    EXECUTE body;
  END LOOP;
END
$a241_portal$;

COMMENT ON FUNCTION platform.student_portal_cases() IS
  'Student-safe self projection with no caller-selectable case identifier. next_action is always NULL since 241: the case next step is staff-only.';
COMMENT ON FUNCTION platform.student_portal_profile() IS
  'Student-self profile projection. case_next_action is always NULL since 241: the case next step is staff-only.';

COMMIT;
