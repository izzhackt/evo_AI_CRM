-- Student 360 «Документы»: the baseline checklist options read works in a
-- read-only transaction (track A2 «честное состояние», production audit
-- 26.09, UXADMISSIONS). docs/PLAN_CHANGES.md «2026-09-26 — Трек A2,
-- дополнение: миграция 243 — базовые чек-листы без блокировок».
--
-- Why: platform.staff_case_baseline_checklist_options (179) is STABLE, and
-- PostgREST runs every GET, and every POST to a STABLE or IMMUTABLE function,
-- in a READ ONLY transaction. Its gate platform_private.require_case_operator
-- (173, VOLATILE) calls platform_private.require_domain_actor (155), which
-- takes SELECT ... FOR UPDATE on the organization, profile and membership
-- rows. Every read therefore failed with 25006 «cannot execute SELECT FOR
-- UPDATE in a read-only transaction», and every case showed the red «Не
-- удалось загрузить базовые чек-листы…».
--
-- Forward-only. Only the gate of this one read changes, by a self-verifying
-- anchor replace (exactly one old gate before, exactly one new gate after):
-- platform_private.require_domain_actor_read(p_organization_id,
-- 'document.manage') plus platform_private.staff_can_access(...,
-- 'document.manage', 'student_case', p_student_case_id), otherwise 42501.
-- For 'document.manage' this is the authorization require_case_operator
-- already applied: the same permission check (require_domain_actor ends in
-- require_domain_actor_read) and the same case scope check
-- (staff_can_access); its extra checks cover only the contract, finance and
-- handoff keys. Only the row locks go away, which a read never needed. The
-- write platform.seed_case_baseline_checklist is untouched and keeps
-- require_case_operator with its locks and post-lock re-check. The function
-- stays STABLE SECURITY DEFINER; signature, return type, owner, grants and
-- comment are unchanged (CREATE OR REPLACE of the same header keeps them).
BEGIN;

DO $a243_gate$
DECLARE
  target CONSTANT REGPROCEDURE :=
    'platform.staff_case_baseline_checklist_options(uuid,uuid)'::REGPROCEDURE;
  original TEXT;
  body TEXT;
  old_gate CONSTANT TEXT := $q$  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );$q$;
  new_gate CONSTANT TEXT := $q$  -- 243: the same 'document.manage' permission and case scope as the 179
  -- gate, without its row locks, so the read works in the READ ONLY
  -- transaction PostgREST uses for a STABLE function.
  SELECT * INTO actor
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'document.manage'
  );

  IF NOT platform_private.staff_can_access(
    p_organization_id,
    actor.actor_membership_id,
    'document.manage',
    'student_case',
    p_student_case_id
  ) THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;$q$;
BEGIN
  original := pg_get_functiondef(target);
  body := replace(original, old_gate, new_gate);
  IF (length(original) - length(replace(original, old_gate, ''))) / length(old_gate) <> 1
    OR (length(body) - length(replace(body, new_gate, ''))) / length(new_gate) <> 1
  THEN
    RAISE EXCEPTION 'case_baseline_options_gate_anchor_drift';
  END IF;
  EXECUTE body;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = target
      AND proc.provolatile = 's'
      AND proc.prosecdef
      AND strpos(proc.prosrc, 'require_case_operator') = 0
      AND strpos(upper(proc.prosrc), 'FOR UPDATE') = 0
      AND strpos(proc.prosrc, 'platform_private.require_domain_actor_read(') > 0
      AND strpos(proc.prosrc, 'platform_private.staff_can_access(') > 0
  ) THEN
    RAISE EXCEPTION 'case_baseline_options_gate_not_read_safe';
  END IF;
END
$a243_gate$;

COMMIT;
