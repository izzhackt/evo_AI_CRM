-- «Студенты» — вид «Ожидает начала» в очереди дел (Э0.2 плана редизайна
-- 25.09.2026, docs/EVO_CRM_REDESIGN_PLAN_2026-09-25.md).
-- docs/PLAN_CHANGES.md «2026-09-25 — Э0.2: «Ожидает начала» в очереди дел
-- (миграция 242)».
--
-- Why: the 241 queue has the views mine / needs_action / active /
-- needs_curator / closed. A plain pending case (a lead cabinet prepared
-- before the sale, or a legacy pending case) matches none of them: «Мои» and
-- «Все в работе» need state 'active', «Закрытые» needs 'closed', and
-- needs_action / needs_curator need an attention flag that only a sold or
-- handed-off pending case carries. Before the queue, staff found these cases
-- through the 24.09 facet «Статус → Ожидает начала». This migration adds the
-- view 'pending' = state 'pending'.
--
-- Forward-only. No new object and no signature, default, owner or grant
-- change:
--  a) platform_private.case_queue_in_view (241) gains WHEN 'pending'. It is
--     the one predicate both reads use, so the tab number is still computed
--     by the same expression as the rows its click shows.
--  b) platform.staff_student_case_queue_v1 and
--     platform.staff_student_case_queue_counts_v1 accept p_view 'pending':
--     a self-verifying anchor replace of their p_view allowlist (the 182/241
--     pattern: exactly one old list before, exactly one new list after).
--  c) the counts read returns views.pending next to the other views.
-- Authority and visibility are unchanged: the same staff admissions gate
-- and case.read.full check, and private.platform_can_read_student_case per
-- row. Attention flags stay computed only for needs_action / needs_curator.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) The shared view predicate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_private.case_queue_in_view(
  p_view TEXT, p_state platform.student_case_state, p_is_mine BOOLEAN, p_flags TEXT[]
) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_view
    WHEN 'mine' THEN p_state = 'active' AND COALESCE(p_is_mine, FALSE)
    WHEN 'needs_action' THEN COALESCE(p_flags && ARRAY['overdue', 'awaiting_ack', 'needs_curator']::TEXT[], FALSE)
    WHEN 'active' THEN p_state = 'active'
    WHEN 'needs_curator' THEN COALESCE('needs_curator' = ANY (p_flags), FALSE)
    WHEN 'closed' THEN p_state = 'closed'
    WHEN 'pending' THEN p_state = 'pending'
    ELSE FALSE
  END
$$;

-- ---------------------------------------------------------------------------
-- b) Both reads accept the view
-- ---------------------------------------------------------------------------
DO $a242_views$
DECLARE
  target TEXT;
  original TEXT;
  body TEXT;
  old_list CONSTANT TEXT := $q$p_view NOT IN ('mine', 'needs_action', 'active', 'needs_curator', 'closed')$q$;
  new_list CONSTANT TEXT := $q$p_view NOT IN ('mine', 'needs_action', 'active', 'needs_curator', 'closed', 'pending')$q$;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
    'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'
  ] LOOP
    original := pg_get_functiondef(target::regprocedure);
    body := replace(original, old_list, new_list);
    IF (length(original) - length(replace(original, old_list, ''))) / length(old_list) <> 1
      OR (length(body) - length(replace(body, new_list, ''))) / length(new_list) <> 1
    THEN
      RAISE EXCEPTION 'student_case_queue_view_list_anchor_drift: %', target;
    END IF;
    EXECUTE body;
  END LOOP;
END
$a242_views$;

-- ---------------------------------------------------------------------------
-- c) The counts read reports the new view
-- ---------------------------------------------------------------------------
DO $a242_counts$
DECLARE
  original TEXT;
  body TEXT;
  old_views CONSTANT TEXT := $q$'closed', count(*) FILTER (WHERE platform_private.case_queue_in_view('closed', state, is_mine, flags)))$q$;
  new_views CONSTANT TEXT := $q$'closed', count(*) FILTER (WHERE platform_private.case_queue_in_view('closed', state, is_mine, flags)),
      'pending', count(*) FILTER (WHERE platform_private.case_queue_in_view('pending', state, is_mine, flags)))$q$;
BEGIN
  original := pg_get_functiondef('platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure);
  body := replace(original, old_views, new_views);
  IF (length(original) - length(replace(original, old_views, ''))) / length(old_views) <> 1
    OR (length(body) - length(replace(body, new_views, ''))) / length(new_views) <> 1
  THEN
    RAISE EXCEPTION 'student_case_queue_counts_views_anchor_drift';
  END IF;
  EXECUTE body;
END
$a242_counts$;

COMMENT ON FUNCTION platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) IS
  '«Студенты» work queue page: views mine/needs_action/active/needs_curator/closed and (since 242) pending, due or updated keyset order, pipeline_stage and checklist document counts per row; visibility = private.platform_can_read_student_case.';
COMMENT ON FUNCTION platform.staff_student_case_queue_counts_v1(TEXT, TEXT, UUID, TEXT, TEXT) IS
  '«Студенты» queue counts: views (pending since 242), due bands and direction/curator/stage facets under the exact filters of staff_student_case_queue_v1; visibility = private.platform_can_read_student_case.';

COMMIT;
