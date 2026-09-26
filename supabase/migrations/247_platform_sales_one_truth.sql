-- Э2 «Честные числа»: одна правда о продажах и этапах (решения владельца
-- 26.09.2026). docs/PLAN_CHANGES.md «2026-09-26 — Э2 «Честные числа»: одна
-- правда о продажах и этапах (миграция 247)».
--
-- Why (26.09 readiness audit, UXSALES and PLAN): the one lead in production
-- showed four different numbers. platform.current_sales_funnel (210) counted
-- leads.stage_key, so a lead with a completed handoff stayed «Новый», while
-- the board (212 + src/lib/v3/pipeline-source.ts) put the same lead into
-- «Переданы»; the period «Переданы» counted any linked case, a bare cabinet
-- without a sale included; «Продажи» had a different rule on every surface;
-- Lead 360 could not date a handoff made through the report into an already
-- open cabinet case (208 inserts no 088 row).
--
-- Owner decisions 26.09 (announced defaults, no objection):
--  * a «Продажа» is a non-archived «Отчёт продаж» record, counted by its sale
--    date (fields.signing_date, «Дата продажи»);
--  * an archived sale does NOT return the lead to the working board; the
--    board's last column stays «Переданы»;
--  * sales stages are the six working stages plus «Переданы».
--
-- Functions only: no table, row, grant-on-existing, owner or signature change.
-- Forward-only, over the LATEST definitions (210 for current_sales_funnel,
-- 212 for staff_sales_handoff_facts; nothing later touches either). SECURITY
-- DEFINER with search_path = '' throughout.
--
--  a) platform_private.sales_lead_handoffs(org, lead_ids): the ONE definition
--     of a completed handoff, moved verbatim out of 212 — a 088
--     sales_admissions_handoffs row in state 'completed', or a 208 pipeline
--     report record that activated a pending cabinet case AND carries its
--     immutable create receipt. Archive, current case state and curator do
--     not undo a historical handoff. Earliest evidence wins; it returns the
--     handoff's case and which evidence proved it. Lifecycle is NOT filtered
--     here: callers decide visibility, (b) decides the stage.
--  b) platform_private.sales_lead_stage(lifecycle, stage_key, handed_off):
--     the ONE stage resolver. A lead whose lifecycle is not 'open' is
--     'closed' and never counts as working; otherwise a completed handoff is
--     'handed_off' («Переданы»); otherwise the canonical stage_key. The TS
--     mirror is src/lib/v3/sales-stage.ts (same truth table, pinned by tests).
--  c) platform.staff_sales_handoff_facts (212): the same gate, batch checks,
--     payload and errors; the completed set now comes from (a).
--  d) platform.current_sales_funnel (210): stages come from (b) over the
--     same visible open leads, so a handed-off lead leaves its old working
--     stage. The payload keeps its shape for the running version (six
--     stages; lead_count = their sum = working leads) and gains 'handed_off'
--     (count as text). 'sales' keeps 210's meaning — non-archived pipeline
--     records of the funnel's (now working) leads.
--  e) platform.staff_sales_count_v1(org, from, to): the ONE «Продажи» count —
--     non-archived records the actor may read (sales.register.read per record,
--     as read_sales_register_v2) whose sale date lies in [from, to]. Records
--     are never guessed into a period: it also returns, for the report months
--     the period touches, how many records have no sale date ('undated') or a
--     sale date outside the period ('other_sale_date'), and how many sales of
--     the period are filed under another report month ('filed_elsewhere').
--  f) platform.staff_lead_handoff_strip_v1(org, lead): Lead 360 «Передача» —
--     the resolved stage (b), the handoff (a) with its date and evidence,
--     contract and first payment confirmations from the gate row, the lead's
--     report record (only with sales.register.read and record access), and
--     for the handoff's case the current curator with the assignment time and
--     the curator's latest answer to that assignment. Gate: lead.read on this
--     lead (the 212 gate); students and callers without a membership refused.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) platform_private.sales_lead_handoffs
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.sales_lead_handoffs(p_organization_id UUID, p_lead_ids UUID[])
RETURNS TABLE(lead_id UUID, completed_at TIMESTAMPTZ, student_case_id UUID, evidence TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH candidates AS MATERIALIZED (
    SELECT l.id, l.client_id FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.id = ANY(p_lead_ids)
  ), completed AS (
    SELECT h.lead_id, h.handed_off_at AS completed_at, h.student_case_id, 'handoff'::TEXT AS evidence
    FROM platform.sales_admissions_handoffs h
    JOIN candidates l ON l.id = h.lead_id AND l.client_id = h.client_id
    WHERE h.organization_id = p_organization_id AND h.handoff_state = 'completed'
    UNION ALL
    -- 208 activates a pre-existing cabinet case without inserting an 088 row.
    -- Require BOTH its pipeline provenance and its immutable create receipt.
    SELECT r.lead_id, request.created_at, c.id, 'sales_report'::TEXT
    FROM platform_private.sales_register r
    JOIN candidates l ON l.id = r.lead_id AND l.client_id = r.client_id
    JOIN platform.student_cases c ON c.organization_id = r.organization_id
      AND c.canonical_lead_id = r.lead_id AND c.canonical_client_id = r.client_id
      AND c.id::TEXT = r.source_snapshot->>'student_case_id'
    JOIN platform_private.sales_report_handoff_requests request
      ON request.organization_id = r.organization_id
      AND request.receipt->>'organization_id' = r.organization_id::TEXT
      AND request.receipt->>'operation' = 'create'
      AND request.receipt->>'record_id' = r.id::TEXT
      AND request.receipt->>'student_case_id' = c.id::TEXT
      AND request.receipt->>'request_id' = request.request_id::TEXT
    WHERE r.organization_id = p_organization_id AND r.source_kind = 'pipeline'
      AND r.source_snapshot->>'activation' = 'pending_case'
  )
  SELECT DISTINCT ON (c.lead_id) c.lead_id, c.completed_at, c.student_case_id, c.evidence
  FROM completed c
  ORDER BY c.lead_id, c.completed_at, c.evidence
$$;

-- ---------------------------------------------------------------------------
-- b) platform_private.sales_lead_stage
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.sales_lead_stage(
  p_lifecycle_state platform.lead_lifecycle_state, p_stage_key TEXT, p_handed_off BOOLEAN
) RETURNS TEXT
LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_lifecycle_state IS DISTINCT FROM 'open'::platform.lead_lifecycle_state THEN 'closed'
    WHEN p_handed_off IS TRUE THEN 'handed_off'
    ELSE p_stage_key
  END
$$;

REVOKE ALL ON FUNCTION platform_private.sales_lead_handoffs(UUID, UUID[]),
  platform_private.sales_lead_stage(platform.lead_lifecycle_state, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- c) platform.staff_sales_handoff_facts (212): completed set from (a)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.staff_sales_handoff_facts(p_organization_id UUID, p_lead_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  visible_count BIGINT;
  facts JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_handoff_facts_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_lead_ids IS NULL OR cardinality(p_lead_ids) > 4000
    OR EXISTS (SELECT 1 FROM unnest(p_lead_ids) id WHERE id IS NULL)
    OR (SELECT count(DISTINCT id) FROM unnest(p_lead_ids) id) <> cardinality(p_lead_ids) THEN
    RAISE EXCEPTION 'sales_handoff_facts_invalid' USING ERRCODE = '22023';
  END IF;

  WITH visible_leads AS MATERIALIZED (
    SELECT l.id FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.id = ANY(p_lead_ids)
      AND l.lifecycle_state = 'open'
      AND platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'lead.read', 'lead', l.id)
  ), handoffs AS MATERIALIZED (
    SELECT h.lead_id, h.completed_at
    FROM platform_private.sales_lead_handoffs(p_organization_id, ARRAY(SELECT v.id FROM visible_leads v)) h
  )
  SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object(
    'lead_id', l.id, 'completed', h.completed_at IS NOT NULL,
    'completed_at', h.completed_at) ORDER BY l.id), '[]'::JSONB)
  INTO visible_count, facts
  FROM visible_leads l LEFT JOIN handoffs h ON h.lead_id = l.id;

  -- Missing, closed and inaccessible IDs all deny the complete batch. Never
  -- turn an omitted record into a false "not handed off" result.
  IF visible_count <> cardinality(p_lead_ids) THEN
    RAISE EXCEPTION 'sales_handoff_facts_forbidden' USING ERRCODE = '42501';
  END IF;
  -- JSON avoids PostgREST's row cap silently clipping a board-sized batch.
  RETURN jsonb_build_object('organization_id', p_organization_id, 'leads', facts);
END
$$;

-- ---------------------------------------------------------------------------
-- d) platform.current_sales_funnel (210): stages from (b); + handed_off
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.current_sales_funnel(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  stages JSONB;
  lead_count BIGINT;
  handed_off_count BIGINT;
  sales_count BIGINT;
  can_read_report BOOLEAN;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_funnel_forbidden' USING ERRCODE = '42501';
  END IF;

  can_read_report := platform_private.staff_has_permission(
    p_organization_id, actor.membership_id, 'sales.register.read');

  -- The same visible open leads as 210; the stage is the board's (b), so a
  -- handed-off lead is counted once, as «Переданы», never in its old stage.
  WITH visible_leads AS MATERIALIZED (
    SELECT l.id, l.stage_key, l.lifecycle_state FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.lifecycle_state = 'open'
      AND platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'lead.read', 'lead', l.id)
  ), handoffs AS MATERIALIZED (
    SELECT h.lead_id
    FROM platform_private.sales_lead_handoffs(p_organization_id, ARRAY(SELECT v.id FROM visible_leads v)) h
  ), resolved AS MATERIALIZED (
    SELECT l.id, platform_private.sales_lead_stage(l.lifecycle_state, l.stage_key, h.lead_id IS NOT NULL) AS stage
    FROM visible_leads l LEFT JOIN handoffs h ON h.lead_id = l.id
  ), stage_keys(position, key) AS (VALUES
    (1, 'new'), (2, 'contacting'), (3, 'qualified'),
    (4, 'meeting_scheduled'), (5, 'meeting_completed'), (6, 'potential')
  ), stage_counts AS (
    SELECT s.position, s.key, count(r.id) AS count
    FROM stage_keys s LEFT JOIN resolved r ON r.stage = s.key
    GROUP BY s.position, s.key
  )
  SELECT
    (SELECT jsonb_agg(jsonb_build_object('key', s.key, 'count', s.count::TEXT)
      ORDER BY s.position) FROM stage_counts s),
    (SELECT count(*) FROM resolved r JOIN stage_keys s ON s.key = r.stage),
    (SELECT count(*) FROM resolved r WHERE r.stage = 'handed_off'),
    CASE WHEN can_read_report THEN (
      SELECT count(*) FROM platform_private.sales_register r
      JOIN resolved l ON l.id = r.lead_id
      JOIN stage_keys s ON s.key = l.stage
      WHERE r.organization_id = p_organization_id
        AND r.source_kind = 'pipeline' AND NOT r.archived
        AND platform_private.staff_can_access(
          p_organization_id, actor.membership_id, 'sales.register.read', 'sales_register', r.id)
    ) ELSE NULL END
  INTO stages, lead_count, handed_off_count, sales_count;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'lead_count', lead_count::TEXT,
    'stages', stages,
    'handed_off', handed_off_count::TEXT,
    'sales', jsonb_build_object(
      'status', CASE WHEN can_read_report THEN 'available' ELSE 'denied' END,
      'count', sales_count::TEXT));
END
$$;

-- ---------------------------------------------------------------------------
-- e) platform.staff_sales_count_v1: the one «Продажи» count
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_sales_count_v1(p_organization_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  first_month DATE;
  sales_count BIGINT;
  undated_count BIGINT;
  other_count BIGINT;
  elsewhere_count BIGINT;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id AND a.membership_id IS NOT NULL
    AND a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'sales.register.read');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_count_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to
    OR p_from < DATE '1900-01-01' OR p_to > DATE '2100-12-31' OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'sales_count_invalid' USING ERRCODE = '22023';
  END IF;
  first_month := date_trunc('month', p_from)::DATE;

  -- The same record visibility as read_sales_register_v2 (216). A sale date
  -- is the record's own «Дата продажи»; nothing falls back to report_month.
  WITH visible AS MATERIALIZED (
    SELECT r.report_month, NULLIF(r.fields->>'signing_date', '')::DATE AS sale_date
    FROM platform_private.sales_register r
    WHERE r.organization_id = p_organization_id AND NOT r.archived
      AND platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'sales.register.read', 'sales_register', r.id)
  )
  SELECT
    count(*) FILTER (WHERE v.sale_date BETWEEN p_from AND p_to),
    count(*) FILTER (WHERE v.sale_date IS NULL AND v.report_month BETWEEN first_month AND p_to),
    count(*) FILTER (WHERE v.sale_date IS NOT NULL AND v.sale_date NOT BETWEEN p_from AND p_to
      AND v.report_month BETWEEN first_month AND p_to),
    count(*) FILTER (WHERE v.sale_date BETWEEN p_from AND p_to
      AND v.report_month NOT BETWEEN first_month AND p_to)
  INTO sales_count, undated_count, other_count, elsewhere_count
  FROM visible v;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id, 'from', p_from, 'to', p_to,
    'sales', sales_count::TEXT,
    'undated', undated_count::TEXT,
    'other_sale_date', other_count::TEXT,
    'filed_elsewhere', elsewhere_count::TEXT);
END
$$;

-- ---------------------------------------------------------------------------
-- f) platform.staff_lead_handoff_strip_v1: Lead 360 «Передача»
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_lead_handoff_strip_v1(p_organization_id UUID, p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  lead_row RECORD;
  handoff RECORD;
  gate RECORD;
  sale RECORD;
  report JSONB;
  curator JSONB := NULL;
  acceptance JSONB := NULL;
  case_row RECORD;
  assignment RECORD;
  response RECORD;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id AND a.membership_id IS NOT NULL
    AND a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read');
  IF NOT FOUND OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'lead_handoff_strip_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT l.id, l.client_id, l.stage_key, l.lifecycle_state INTO lead_row
  FROM platform.leads l
  WHERE l.organization_id = p_organization_id AND l.id = p_lead_id
    AND platform_private.staff_can_access(p_organization_id, actor.membership_id, 'lead.read', 'lead', l.id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_handoff_strip_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT h.completed_at, h.student_case_id, h.evidence INTO handoff
  FROM platform_private.sales_lead_handoffs(p_organization_id, ARRAY[p_lead_id]) h;

  SELECT g.contract_confirmed, g.contract_confirmed_at, g.first_payment_received_date INTO gate
  FROM platform.lead_admissions_gates g
  WHERE g.organization_id = p_organization_id AND g.lead_id = p_lead_id;

  -- The report record: only for report readers with access to the record.
  IF platform_private.staff_has_permission(p_organization_id, actor.membership_id, 'sales.register.read') THEN
    SELECT r.id, r.report_month, r.archived, NULLIF(r.fields->>'signing_date', '')::DATE AS sale_date INTO sale
    FROM platform_private.sales_register r
    WHERE r.organization_id = p_organization_id AND r.lead_id = p_lead_id
      AND platform_private.staff_can_access(
        p_organization_id, actor.membership_id, 'sales.register.read', 'sales_register', r.id);
    report := jsonb_build_object('status', 'available', 'record', CASE WHEN sale.id IS NULL THEN NULL ELSE
      jsonb_build_object('id', sale.id, 'report_month', sale.report_month, 'sale_date', sale.sale_date,
        'archived', sale.archived) END);
  ELSE
    report := jsonb_build_object('status', 'denied', 'record', NULL);
  END IF;

  -- The handoff's case: its current curator, when that curator was
  -- assigned, and the curator's latest answer to exactly that assignment
  -- (the 130 lookup: a reassignment starts a new answer).
  IF handoff.student_case_id IS NOT NULL THEN
    SELECT c.id, c.current_curator_membership_id INTO case_row
    FROM platform.student_cases c
    WHERE c.organization_id = p_organization_id AND c.id = handoff.student_case_id;
    IF case_row.current_curator_membership_id IS NOT NULL THEN
      SELECT e.id, e.created_at INTO assignment
      FROM platform.student_case_assignment_events e
      WHERE e.organization_id = p_organization_id AND e.student_case_id = case_row.id
        AND e.new_curator_membership_id = case_row.current_curator_membership_id
      ORDER BY e.new_scope_version DESC LIMIT 1;
      SELECT jsonb_build_object('display_name', p.display_name, 'assigned_at', assignment.created_at) INTO curator
      FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_organization_id AND m.id = case_row.current_curator_membership_id;
      IF assignment.id IS NOT NULL THEN
        SELECT a.decision, a.created_at INTO response
        FROM platform.student_case_handoff_acknowledgements a
        WHERE a.organization_id = p_organization_id AND a.student_case_id = case_row.id
          AND a.assignment_event_id = assignment.id
          AND a.curator_membership_id = case_row.current_curator_membership_id
        ORDER BY a.revision DESC LIMIT 1;
        IF response.decision IS NOT NULL THEN
          acceptance := jsonb_build_object('decision', response.decision, 'at', response.created_at);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'lead_id', p_lead_id,
    'stage', platform_private.sales_lead_stage(lead_row.lifecycle_state, lead_row.stage_key,
      handoff.completed_at IS NOT NULL),
    'handoff', CASE WHEN handoff.completed_at IS NULL THEN NULL ELSE
      jsonb_build_object('completed_at', handoff.completed_at, 'evidence', handoff.evidence) END,
    'contract', jsonb_build_object('confirmed', COALESCE(gate.contract_confirmed, FALSE),
      'confirmed_at', CASE WHEN gate.contract_confirmed IS TRUE THEN gate.contract_confirmed_at END),
    'first_payment', jsonb_build_object('received_date', gate.first_payment_received_date),
    'report', report,
    'curator', curator,
    'acceptance', acceptance);
END
$$;

REVOKE ALL ON FUNCTION platform.staff_sales_count_v1(UUID, DATE, DATE),
  platform.staff_lead_handoff_strip_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_sales_count_v1(UUID, DATE, DATE),
  platform.staff_lead_handoff_strip_v1(UUID, UUID)
  TO authenticated;

-- Every function of this migration stays SECURITY DEFINER with the empty
-- search_path; the private helpers are not callable by any client role; the
-- replaced reads keep their 210/212 grants; the funnel no longer counts a raw
-- stage_key and the facts read uses the one handoff definition.
DO $a247_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.prosrc, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN (
      'platform_private.sales_lead_handoffs(uuid,uuid[])'::regprocedure,
      'platform_private.sales_lead_stage(platform.lead_lifecycle_state,text,boolean)'::regprocedure,
      'platform.staff_sales_handoff_facts(uuid,uuid[])'::regprocedure,
      'platform.current_sales_funnel(uuid)'::regprocedure,
      'platform.staff_sales_count_v1(uuid,date,date)'::regprocedure,
      'platform.staff_lead_handoff_strip_v1(uuid,uuid)'::regprocedure)
  LOOP
    IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR has_function_privilege('anon', routine.signature, 'EXECUTE')
      OR (routine.signature::TEXT LIKE 'platform_private.%'
        AND (has_function_privilege('authenticated', routine.signature, 'EXECUTE')
          OR has_function_privilege('service_role', routine.signature, 'EXECUTE')))
      OR (routine.signature::TEXT LIKE 'platform.%'
        AND NOT has_function_privilege('authenticated', routine.signature, 'EXECUTE'))
    THEN
      RAISE EXCEPTION 'a247_sales_one_truth_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
  IF strpos(pg_get_functiondef('platform.current_sales_funnel(uuid)'::regprocedure),
      'platform_private.sales_lead_stage(') = 0
    OR strpos(pg_get_functiondef('platform.staff_sales_handoff_facts(uuid,uuid[])'::regprocedure),
      'platform_private.sales_lead_handoffs(') = 0
    OR strpos(pg_get_functiondef('platform.staff_sales_handoff_facts(uuid,uuid[])'::regprocedure),
      'sales_report_handoff_requests') <> 0
  THEN
    RAISE EXCEPTION 'a247_sales_one_truth_verification_failed: replaced reads must use the one definition';
  END IF;
END
$a247_verify$;

COMMENT ON FUNCTION platform_private.sales_lead_handoffs(UUID, UUID[]) IS
  'The one completed-handoff definition (247): a completed 088 handoff row or a 208 report record with its create receipt; earliest evidence per lead with its case. No lifecycle filter, no access check: callers decide.';
COMMENT ON FUNCTION platform_private.sales_lead_stage(platform.lead_lifecycle_state, TEXT, BOOLEAN) IS
  'The one sales stage resolver (247): not open -> closed; completed handoff -> handed_off («Переданы»); else stage_key. TS mirror: src/lib/v3/sales-stage.ts.';
COMMENT ON FUNCTION platform.current_sales_funnel(UUID) IS
  'Working sales stages by the board resolver (247): six stages, lead_count = working leads, handed_off = leads in «Переданы»; sales = non-archived pipeline records of working leads.';
COMMENT ON FUNCTION platform.staff_sales_count_v1(UUID, DATE, DATE) IS
  'The one «Продажи» count (247): non-archived sales register records readable by the actor with a sale date in [from, to]; plus undated / other sale date / filed elsewhere counts for the report months the period touches.';
COMMENT ON FUNCTION platform.staff_lead_handoff_strip_v1(UUID, UUID) IS
  'Lead 360 «Передача» (247): resolved stage, handoff date and evidence, contract and first payment confirmations, the report record (report readers only), the handoff case curator and answer.';

COMMIT;
