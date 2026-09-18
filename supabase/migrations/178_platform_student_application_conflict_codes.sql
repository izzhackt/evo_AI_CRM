BEGIN;

-- Domain conflicts are final HTTP 409 responses, not retryable serialization
-- failures. Preserve the reviewed functions and their security/transaction guards.
DO $student_application_conflicts$
DECLARE
  signature TEXT;
  definition TEXT;
  old_code CONSTANT TEXT := 'ERRCODE=''40001''';
  new_code CONSTANT TEXT := 'ERRCODE=''PT409''';
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'platform.submit_student_application_v1(uuid,jsonb,bigint)',
    'platform.decide_student_application_v1(uuid,bigint,text,text,uuid,text,uuid)'
  ] LOOP
    definition := pg_get_functiondef(signature::regprocedure);
    IF (length(definition)-length(replace(definition,old_code,'')))/length(old_code) <> 4 THEN
      RAISE EXCEPTION 'student_application_conflict_patch_mismatch';
    END IF;
    EXECUTE replace(definition,old_code,new_code);
  END LOOP;
END $student_application_conflicts$;

COMMIT;
