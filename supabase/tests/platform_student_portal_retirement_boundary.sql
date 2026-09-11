\set ON_ERROR_STOP on

-- Actual post-152 catalog and missing-session checks. No actors/business data.
BEGIN;
CREATE FUNCTION pg_temp.p152_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Portal retirement assertion failed: %', p_message;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.p152_assert(BOOLEAN, TEXT) TO authenticated;

DO $catalog_contract$
DECLARE
  routine_oid OID := pg_catalog.to_regprocedure('platform.student_portal_overview_v2()');
  routine pg_catalog.pg_proc%ROWTYPE;
  forbidden_role TEXT;
BEGIN
  PERFORM pg_temp.p152_assert(NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname = 'student_portal_overview_v1'
  ), 'the retired v1 name still has a callable overload');

  PERFORM pg_temp.p152_assert(routine_oid IS NOT NULL, 'v2 overview is missing');
  SELECT * INTO STRICT routine FROM pg_catalog.pg_proc WHERE oid = routine_oid;
  PERFORM pg_temp.p152_assert(
    routine.prokind = 'f' AND routine.prosecdef AND routine.provolatile = 's'
    AND routine.proretset AND routine.pronargs = 0 AND routine.pronargdefaults = 0
    AND routine.proconfig @> ARRAY['search_path=""']::TEXT[],
    'v2 security, stability or zero-argument contract changed');
  PERFORM pg_temp.p152_assert(routine.proargnames = ARRAY[
    'operational_stage', 'student_action_kind', 'student_action_label',
    'student_action_due_at', 'student_action_document_slot_id',
    'evo_action_task_id', 'evo_action_title', 'evo_action_status',
    'evo_action_due_at', 'evo_action_due_on', 'curator_display_name'
  ]::TEXT[] AND routine.proallargtypes = ARRAY[
    'text'::REGTYPE::OID, 'text'::REGTYPE::OID, 'text'::REGTYPE::OID,
    'timestamptz'::REGTYPE::OID, 'uuid'::REGTYPE::OID, 'uuid'::REGTYPE::OID,
    'text'::REGTYPE::OID, 'platform.case_task_status'::REGTYPE::OID,
    'timestamptz'::REGTYPE::OID, 'date'::REGTYPE::OID, 'text'::REGTYPE::OID
  ], 'v2 output columns or types changed');

  PERFORM pg_temp.p152_assert(
    pg_catalog.has_function_privilege('authenticated', routine_oid, 'EXECUTE'),
    'authenticated lost the v2 grant');
  FOREACH forbidden_role IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin'] LOOP
    PERFORM pg_temp.p152_assert(
      NOT pg_catalog.has_function_privilege(forbidden_role, routine_oid, 'EXECUTE'),
      forbidden_role || ' unexpectedly gained the v2 grant');
  END LOOP;
  PERFORM pg_temp.p152_assert(NOT EXISTS (
    SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
      routine.proacl, pg_catalog.acldefault('f', routine.proowner)
    )) AS acl WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ), 'PUBLIC unexpectedly gained the v2 grant');
END
$catalog_contract$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', '{}', TRUE);
SELECT pg_temp.p152_assert(
  NOT EXISTS (SELECT 1 FROM platform.student_portal_overview_v2()),
  'a session without authenticated claims entered the v2 overview'
);
ROLLBACK;
