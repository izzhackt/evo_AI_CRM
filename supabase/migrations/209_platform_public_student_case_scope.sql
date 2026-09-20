-- Ordinary public approval creates a pending cabinet without a curator.
-- Give its new Student the exact case scope that the portal already requires.
-- The former curator-assignment path supplied this grant before migration180.
-- Existing approved cases and their grant/revoke histories are not repaired.
-- Contract: docs/design/portal/public-approval-case-scope-2026-09-20.md.

BEGIN;

DO $migration$
DECLARE
  body TEXT;
  anchor TEXT := $before$   scope_id,1,app.id,lead_id);
  UPDATE platform.student_cases SET portal_activated_at=statement_timestamp()
  WHERE organization_id=org AND id=new_case AND portal_activated_at IS NULL AND closed_at IS NULL;$before$;
  replacement TEXT := $after$   scope_id,1,app.id,lead_id);
  PERFORM platform_private.append_scope_event(
   org,member_id,scope_id,1,TRUE,'user',actor.profile_id,
   'Approved public Student application: exact case scope',
   platform_private.student_portal_child_request_id(p_request_id,'public_student_case_scope'));
  UPDATE platform.student_cases SET portal_activated_at=statement_timestamp()
  WHERE organization_id=org AND id=new_case AND portal_activated_at IS NULL AND closed_at IS NULL;$after$;
  occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(
    'platform.decide_student_application_v1(uuid,bigint,text,text,uuid)'::regprocedure
  ) INTO body;
  occurrences := (length(body) - length(replace(body, anchor, ''))) / length(anchor);
  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'evo_p209_public_case_scope_anchor_mismatch (% occurrences)', occurrences;
  END IF;
  -- CREATE OR REPLACE preserves the existing ACL, fixed search_path, request
  -- replay, locks, final access-version bump and the separate invited branch.
  EXECUTE replace(body, anchor, replacement);
END
$migration$;

COMMIT;
