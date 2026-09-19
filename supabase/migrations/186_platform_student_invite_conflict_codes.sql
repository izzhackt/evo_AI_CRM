BEGIN;

-- Expected invite identity/acceptance conflicts must finish as HTTP 409.
-- SQLSTATE 40001 denotes serialization failure and PostgREST 14 retries it;
-- a missing receipt cannot become a match by retrying the same transaction.
-- Patch only these two reviewed bodies, including the acceptance helper
-- reached when p_mark_accepted is true. Keep their guards and grants intact.
-- https://github.com/orgs/supabase/discussions/50151
DO $student_invite_conflicts$
DECLARE
  target RECORD;
  definition TEXT;
  old_code CONSTANT TEXT := 'ERRCODE = ''40001''';
  new_code CONSTANT TEXT := 'ERRCODE = ''PT409''';
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('platform.resolve_student_portal_invite_identity(uuid,text,boolean)', 3),
      ('platform_private.accept_student_portal_invite_e1(uuid,timestamptz)', 2)
    ) AS functions(signature, expected_conflicts)
  LOOP
    definition := pg_get_functiondef(target.signature::regprocedure);
    IF (length(definition) - length(replace(definition, old_code, '')))
      / length(old_code) <> target.expected_conflicts
    THEN
      RAISE EXCEPTION 'student_invite_conflict_patch_mismatch';
    END IF;
    EXECUTE replace(definition, old_code, new_code);
  END LOOP;
END $student_invite_conflicts$;

COMMIT;
