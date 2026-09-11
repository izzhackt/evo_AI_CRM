-- The owner accepted the new portal. Retire only its temporary v1 overview
-- rollback API; keep v2, all business data and the separate task-reason policy.
-- DROP RESTRICT: https://www.postgresql.org/docs/current/sql-dropfunction.html
BEGIN;

DO $current_portal_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = pg_catalog.to_regprocedure('platform.student_portal_overview_v2()')
      AND routine.prokind = 'f'
      AND routine.prosecdef
      AND routine.provolatile = 's'
      AND routine.proretset
      AND routine.pronargs = 0
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND routine.proargnames = ARRAY[
        'operational_stage', 'student_action_kind', 'student_action_label',
        'student_action_due_at', 'student_action_document_slot_id',
        'evo_action_task_id', 'evo_action_title', 'evo_action_status',
        'evo_action_due_at', 'evo_action_due_on', 'curator_display_name'
      ]::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Current Student Portal v2 contract is unavailable; v1 retirement stopped'
      USING ERRCODE = '55000';
  END IF;
END
$current_portal_guard$;

DROP FUNCTION platform.student_portal_overview_v1() RESTRICT;

NOTIFY pgrst, 'reload schema';
COMMIT;
