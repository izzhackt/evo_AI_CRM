-- EVO Docs «Документы дела»: сколько ждёт проверки (Э8.5, решения владельца
-- 28.09.2026). docs/PLAN_CHANGES.md «2026-09-28 — Э8: срезы по итоговой
-- критике», срез Э8.5 «Одна проверка документов — в EVO Docs».
--
-- Why: EVO Docs orders the case-document review tab «сначала самые старые»
-- and says «ждёт N дн» from the latest upload. The case queue row (241
-- platform.staff_student_case_queue_v1) carries only the checklist counts and
-- the case updated_at, so the wait cannot be told from it.
--
-- What: one additive key in each page row's `documents` object —
-- 'oldest_submitted_at': min(document_versions.created_at) over the case's
-- checklist slots with status 'submitted' (not removed), through each slot's
-- current_version_id (the latest upload of that slot; 043's slot shape check
-- guarantees a current version for every non-'required' slot, and its
-- current-version foreign key keeps that version inside the same slot and
-- case). NULL when nothing waits. A scalar subquery, so the counts query and
-- its numbers stay exactly as they are.
--
-- Deploy-safe in either order: the running client decodes the `documents`
-- object key by key (src/lib/platform-student-case-queue-contract.ts
-- `checklist`, not key-exact), so an app release before this migration sees
-- no new key and one after it ignores nothing it needs.
--
-- Forward-only, on the LATEST definition (241 + 242 + 244 + 245 left the
-- `documents` expression as 241 wrote it): self-verifying anchor replace, the
-- 182/241/242/244/245 pattern — exactly one old anchor before, exactly one
-- new after. No signature, owner, grant, gate, visibility or error-code
-- change: the key sits inside the existing `can_read_documents` branch
-- (private.platform_can_read_document_full), SECURITY DEFINER with
-- search_path = '' as before. The counts read is not touched.
--
-- Release: apply through evo-schema-ledger.yml before or with the release
-- that ships the code reading 'oldest_submitted_at'.
BEGIN;

DO $a252_read$
DECLARE
  signature CONSTANT TEXT := 'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)';
  anchor CONSTANT TEXT := $q$'missing', count(*) FILTER (WHERE slot.status = 'required'))$q$;
  replacement CONSTANT TEXT := $q$'missing', count(*) FILTER (WHERE slot.status = 'required'),
          'oldest_submitted_at', (
            SELECT min(waiting_version.created_at)
            FROM platform.document_slots AS waiting_slot
            JOIN platform.document_versions AS waiting_version
              ON waiting_version.organization_id = waiting_slot.organization_id
             AND waiting_version.id = waiting_slot.current_version_id
            WHERE waiting_slot.organization_id = shown.organization_id
              AND waiting_slot.student_case_id = shown.id
              AND waiting_slot.removed_at IS NULL
              AND waiting_slot.status = 'submitted'))$q$;
  body TEXT;
BEGIN
  body := pg_get_functiondef(signature::regprocedure);
  IF (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1
    OR strpos(body, 'oldest_submitted_at') <> 0
  THEN
    RAISE EXCEPTION 'student_case_queue_document_wait_anchor_drift: before';
  END IF;
  body := replace(body, anchor, replacement);
  IF (length(body) - length(replace(body, replacement, ''))) / length(replacement) <> 1 THEN
    RAISE EXCEPTION 'student_case_queue_document_wait_anchor_drift: after';
  END IF;
  EXECUTE body;
END
$a252_read$;

-- Grants restated (CREATE OR REPLACE keeps them); self-check.
REVOKE ALL ON FUNCTION platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT)
  TO authenticated;

DO $a252_verify$
DECLARE
  routine RECORD;
  definition TEXT := pg_get_functiondef('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::regprocedure);
BEGIN
  SELECT p.oid::REGPROCEDURE AS signature, p.prosecdef, p.proconfig INTO STRICT routine
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = 'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::regprocedure;
  IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    OR has_function_privilege('anon', routine.signature, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', routine.signature, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a252_case_queue_document_wait_verification_failed: %', routine.signature;
  END IF;
  -- The documents object stays behind the full document read; 245's row keys stay.
  IF strpos(definition, 'WHEN shown.can_read_documents THEN (') = 0
    OR strpos(definition, 'private.platform_can_read_document_full(c.organization_id, c.id) AS can_read_documents') = 0
    OR strpos(definition, 'platform_private.admissions_attention_flags(c.id) AS flags') = 0
    OR strpos(definition, '''needs_reply'', platform_private.case_needs_reply(shown.organization_id, shown.id)') = 0
  THEN
    RAISE EXCEPTION 'a252_case_queue_document_wait_verification_failed: gate or row keys drifted';
  END IF;
END
$a252_verify$;

COMMENT ON FUNCTION platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) IS
  '«Студенты» work queue page: views mine/needs_action/active/needs_curator/closed/pending (needs_action also no step and chat waiting for staff since 245), due or updated keyset order, pipeline_stage, checklist document counts with the oldest upload waiting for review (252) and needs_reply per row; visibility = private.platform_can_read_student_case.';

COMMIT;
