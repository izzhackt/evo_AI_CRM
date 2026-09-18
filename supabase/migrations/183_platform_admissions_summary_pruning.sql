-- Unified-workflow pivot, slice S4 «Admissions без обязательного маршрута»
-- (plan §8, §11, §12, §13).
-- docs/EVO_UNIFIED_WORKFLOW_PLAN_2026-09-18.md §8/§11/§12/§13 +
-- docs/PLAN_CHANGES.md «unified workflow: план-контракт реализации», S1, S2,
-- S3 (2026-09-18).
--
-- Plan §12: «Сводка по направлениям: показываем только сведения, которые
-- реально ведём. Убираем показатели движения по визам и поступлению, если
-- эти процессы больше не отслеживаются.» The mandatory route/playbook UI
-- (AdmissionsRoutePanel, its stage editor, message templates) and the
-- visa-case CRUD form are retired from the CRM in this same slice, on the
-- TypeScript side — this migration narrows the one SQL read that surfaced
-- stage/submission/decision/visa/arrival counters in aggregate:
-- `platform.admissions_direction_summary_v1` (137, unchanged since —
-- confirmed by grep across 145/149/156/176/177/178/180/181/182).
--
-- Section:
--  a) `platform.admissions_direction_summary_v1` is replaced whole (same
--     4-argument signature — `CREATE OR REPLACE`, no DROP/re-grant needed,
--     the same pattern 145/182 already used for
--     `platform_private.admissions_attention_flags`'s own in-place body
--     rewrites). `stock` keeps only `active`/`overdue`/`awaiting_ack`
--     (unchanged meaning) plus the new `needs_curator` (182's own
--     `admissions_attention_flags` flag, already computed per case — this
--     migration only changes how the direction summary AGGREGATES the
--     existing flag set, not the flag computation itself). Dropped:
--     `awaiting_partner`, `submitted`, `decisions`, `visas`, `arrivals`,
--     `cancelled`, `arrived` and the whole `periodArrivals` CTE (a "closed,
--     confirmed-arrived-this-month" business metric for a tracker this slice
--     retires). `admissions_attention_flags` itself is UNTOUCHED — the
--     per-case attention filter chips on «Студенты» (`p_attention` on
--     `staff_student_case_page`, ADMISSIONS_ATTENTION in
--     platform-admissions-playbook-contract.ts) still return the full flag
--     set; only this ONE aggregate reader narrows what it reports.
--     `p_period_from`/`p_period_to` stay accepted (signature stability —
--     changing it would need DROP FUNCTION + re-grant for zero benefit) and
--     still validated, but are no longer reflected in the JSON result: no
--     `periodFrom`/`periodTo`/`periodArrivals` keys. The TS side
--     (`readAdmissionsSummary` in src/lib/v3/admissions-source.ts) stops
--     sending them at all — SQL defaults both to NULL.
--
-- No portal changes (S5 owns that). No migration is applied by this task —
-- no Supabase credentials in this environment, matching every prior slice.

BEGIN;

CREATE OR REPLACE FUNCTION platform.admissions_direction_summary_v1(p_direction TEXT DEFAULT NULL,p_curator_membership_id UUID DEFAULT NULL,p_period_from DATE DEFAULT NULL,p_period_to DATE DEFAULT NULL)
 RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; result JSONB;
BEGIN
 SELECT * INTO a FROM platform.current_actor_authority();
 IF a.membership_id IS NULL OR a.platform_role NOT IN ('admin','curator') OR NOT private.platform_has_permission(a.organization_id,'case.read.full') THEN RAISE EXCEPTION 'Staff admissions authority required' USING ERRCODE='42501'; END IF;
 IF p_direction IS NOT NULL AND p_direction NOT IN ('CN','MY','EUROPE','AE','TR','unknown') OR (p_period_from IS NULL)<>(p_period_to IS NULL) OR p_period_to<p_period_from THEN RAISE EXCEPTION 'Invalid admissions summary filters' USING ERRCODE='22023'; END IF;
 WITH visible AS MATERIALIZED (
  SELECT c.*,COALESCE(c.admissions_direction,'unknown') AS direction_key,platform_private.admissions_attention_flags(c.id) AS flags
  FROM platform.student_cases c WHERE c.organization_id=a.organization_id AND private.platform_can_read_student_case(c.organization_id,c.id)
   AND (p_direction IS NULL OR COALESCE(c.admissions_direction,'unknown')=p_direction)
   AND (p_curator_membership_id IS NULL OR c.current_curator_membership_id=p_curator_membership_id)
 ), stock AS (
  SELECT direction_key,jsonb_build_object('direction',direction_key,'active',count(*) FILTER(WHERE state='active'),'overdue',count(*) FILTER(WHERE 'overdue'=ANY(flags)),
   'awaiting_ack',count(*) FILTER(WHERE 'awaiting_ack'=ANY(flags)),'needs_curator',count(*) FILTER(WHERE 'needs_curator'=ANY(flags))) AS row
  FROM visible GROUP BY direction_key
 ) SELECT jsonb_build_object('stock',COALESCE((SELECT jsonb_agg(row ORDER BY direction_key) FROM stock),'[]'::JSONB)) INTO result;
 RETURN result;
END $$;

COMMIT;
