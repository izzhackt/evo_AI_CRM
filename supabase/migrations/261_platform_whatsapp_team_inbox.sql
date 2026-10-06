-- 261_platform_whatsapp_team_inbox.sql
--
-- Owner decision 2026-10-06 («нет, все могут»): every staff member who may work
-- with WhatsApp can see the sales WhatsApp conversations and answer them from
-- the CRM, not only the member who owns them. Since the direct WAHA -> CRM
-- ingress (migration 259) every new chat is owned by the intake member (the
-- head of sales, a system Admin), so an Admissions or Sales member holding
-- communication.read.full / communication.manual.send at the `own` scope saw
-- nothing and could send nothing: the scoped evaluator (155) matches `own` and
-- `department` against the conversation owner.
--
-- One additive change in the one place that decides it,
-- platform_private.staff_access_evaluate: for a conversation of the SALES queue
-- and exactly the two permissions communication.read.full and
-- communication.manual.send the evaluator gets one more context row whose owner
-- is the asking member (the same row shape its own `receiving assignment`
-- branch already adds), so `own` and `department` match as they do for the
-- member's own records. Nothing else moves:
--   * the permission must still be held through a published bundle of an active
--     role with an active assignment (staff_has_permission, unchanged);
--   * the membership must be active and not a Student (staff_membership_identity,
--     unchanged); the organization is part of the row lookup, so another
--     organization's conversation never matches;
--   * the extra row only ADDS a way to pass; the owner context, `organization`,
--     `direction` and `record` scopes are evaluated exactly as before, so no
--     member loses access;
--   * `queue = 'curator'` conversations (handed-off chats of a student case,
--     owner = the curator) keep their owner-only evaluation: a sales queue row
--     has no curator and a curator row always carries a case (044 shape check);
--   * every other permission on a conversation (communication.read.summary,
--     ai.draft.request, ai.draft.review, decision.*) and every other resource
--     kind (lead, student_case, ...) are untouched, as are the Student portal
--     chat, «Переписка» and the case data, which do not read these conversations.
-- Every reader, RLS policy, the manual-send request and its authority trigger,
-- the exact claim, the sender participant and the reconcile path already decide
-- through this evaluator (156), so the sender recorded for a reply stays the
-- member who authorized it.
--
-- Self-verifying like 173's evo173_replace: the installed source must be
-- byte-identical to migration 155's (md5 below) and the fragment must occur
-- exactly once, otherwise the migration fails closed instead of guessing.
-- CREATE OR REPLACE keeps the owner, SECURITY DEFINER, empty search_path and the
-- ACL (no client role may execute the evaluator). No function, table or grant is
-- added. This migration does not depend on 260.
--
-- Docs: https://www.postgresql.org/docs/current/sql-createfunction.html
--       https://supabase.com/docs/guides/database/postgres/row-level-security

BEGIN;

DO $n261$
DECLARE
  routine CONSTANT REGPROCEDURE :=
    'platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)'::REGPROCEDURE;
  expected_md5 CONSTANT TEXT := '8723a6a5efb7ec0436da12f2c02e2462';
  old_fragment CONSTANT TEXT :=
    $old$p_resource_kind IN ('lead','staff_task','sales_register')$old$;
  new_fragment CONSTANT TEXT :=
    $new$p_resource_kind IN ('lead','staff_task','sales_register')
  UNION ALL SELECT p_membership_id,NULL::UUID,NULL::TEXT WHERE NOT p_receiving_assignment
   AND p_resource_kind='conversation'
   AND p_permission_key IN ('communication.read.full','communication.manual.send')
   AND EXISTS(SELECT 1 FROM platform.communication_conversations team_inbox
    WHERE team_inbox.organization_id=p_organization_id AND team_inbox.id=p_resource_id
    AND team_inbox.queue='sales')$new$;
  installed_source TEXT;
  definition TEXT;
  matches INTEGER;
BEGIN
  SELECT routine_row.prosrc INTO STRICT installed_source
  FROM pg_catalog.pg_proc AS routine_row WHERE routine_row.oid = routine;
  IF pg_catalog.md5(installed_source) IS DISTINCT FROM expected_md5 THEN
    RAISE EXCEPTION 'whatsapp_team_inbox_source_drift: staff_access_evaluate is not the migration 155 definition'
      USING ERRCODE = '55000';
  END IF;

  definition := pg_catalog.pg_get_functiondef(routine);
  matches := (pg_catalog.length(definition)
    - pg_catalog.length(pg_catalog.replace(definition, old_fragment, '')))
    / pg_catalog.length(old_fragment);
  IF matches IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'whatsapp_team_inbox_source_drift: expected 1 fragment, found %', matches
      USING ERRCODE = '55000';
  END IF;
  EXECUTE pg_catalog.replace(definition, old_fragment, new_fragment);

  -- The patched function is still a hardened definer.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine_row
    WHERE routine_row.oid = routine
      AND routine_row.prosecdef
      AND routine_row.provolatile = 's'
      AND routine_row.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND routine_row.prosrc LIKE '%team_inbox.queue=''sales''%'
  ) THEN
    RAISE EXCEPTION 'whatsapp_team_inbox_patch_not_applied' USING ERRCODE = '55000';
  END IF;
END
$n261$;

COMMIT;
