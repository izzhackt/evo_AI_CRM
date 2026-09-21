-- Every authorized actor must explain an effective case-task deadline/priority change.
-- Preserve the existing canonical command, scope/coverage locks and replay order.
-- Source contract: current post156 body; fail on drift instead of rewriting another revision.

BEGIN;

DO $migration$
DECLARE
  signature CONSTANT text := 'platform_private.coverage_change_task_body(uuid,uuid,platform.case_task_status,uuid,platform.case_task_priority,timestamp with time zone,date,boolean,bigint,uuid,text)';
  old_anchor CONSTANT text := $old$  -- Temporary old-Admin rollback window; remove after owner acceptance (#687).
  IF p_reason IS NULL AND NOT EXISTS(SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id,actor.actor_membership_id) i
    WHERE i.system_role='admin') AND ($old$;
  new_anchor CONSTANT text := $new$  -- Deadline/priority changes require a reason for every authorized actor.
  IF p_reason IS NULL AND ($new$;
  target_oid oid;
  old_source text;
  new_source text;
  definition text;
  old_attributes jsonb;
  new_attributes jsonb;
BEGIN
  target_oid := signature::pg_catalog.regprocedure;
  SELECT p.prosrc, pg_catalog.to_jsonb(p) - 'prosrc'
    INTO STRICT old_source, old_attributes
    FROM pg_catalog.pg_proc p WHERE p.oid = target_oid;
  IF pg_catalog.md5(old_source) <> 'adf134e0faddd76e58e820100701caec' THEN
    RAISE EXCEPTION 'Unexpected canonical case-task body before reason guard';
  END IF;
  definition := pg_catalog.pg_get_functiondef(target_oid);
  IF (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, old_anchor, '')))
       / pg_catalog.length(old_anchor) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one canonical case-task reason guard';
  END IF;
  EXECUTE pg_catalog.replace(definition, old_anchor, new_anchor);
  SELECT p.prosrc, pg_catalog.to_jsonb(p) - 'prosrc'
    INTO STRICT new_source, new_attributes
    FROM pg_catalog.pg_proc p WHERE p.oid = target_oid;
  IF new_source IS DISTINCT FROM pg_catalog.replace(old_source, old_anchor, new_anchor)
    OR pg_catalog.md5(new_source) <> 'b5069fbe19b46e75605a71a1c79eddd2'
    OR new_attributes IS DISTINCT FROM old_attributes THEN
    RAISE EXCEPTION 'Canonical case-task reason replacement changed unexpected definition or attributes';
  END IF;
END
$migration$;

COMMIT;
