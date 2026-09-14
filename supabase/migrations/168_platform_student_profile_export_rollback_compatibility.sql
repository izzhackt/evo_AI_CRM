BEGIN;

-- Forward-only deployment compatibility for the accepted05585020 app and its
-- retained rollback image. Migration164 retired these161 transient RPC grants
-- before the accepted app stopped calling them. Restore only their exact
-- service EXECUTE privileges; do not change the functions or their live
-- actor/case/permission/revision/replay fences.
-- Generation remains a separate161 audit outcome, never a stored164/167 ready
-- artifact or a delivery receipt. New app code continues to use164/167 only.
-- Remove these grants in a reviewed forward migration once both the accepted
-- current app and retained rollback image no longer call161.
-- https://www.postgresql.org/docs/current/sql-grant.html
REVOKE ALL ON FUNCTION platform.begin_student_profile_export(UUID,UUID,UUID,UUID,BIGINT,TEXT,TEXT,UUID),
  platform.complete_student_profile_export(UUID,TEXT,TEXT,INTEGER,TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.begin_student_profile_export(UUID,UUID,UUID,UUID,BIGINT,TEXT,TEXT,UUID),
  platform.complete_student_profile_export(UUID,TEXT,TEXT,INTEGER,TEXT)
  TO service_role;

COMMIT;
