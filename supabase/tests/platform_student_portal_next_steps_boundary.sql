\set ON_ERROR_STOP on

-- Migration 131 catalog/no-session boundary. This creates no actors or cases:
-- v1 must remain the unchanged rollback contract while v2 is the only expanded
-- next-step contract used by the new application.
BEGIN;

CREATE FUNCTION pg_temp.p131_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 131 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p131_assert(BOOLEAN, TEXT)
  TO authenticated;

DO $catalog_contract$
DECLARE
  contract RECORD;
  routine_oid OID;
  routine_row pg_catalog.pg_proc%ROWTYPE;
  output_columns TEXT[];
  forbidden_role TEXT;
  routine_definition TEXT;
BEGIN
  FOR contract IN
    SELECT * FROM (
      VALUES
        (
          'platform.student_portal_overview_v1()',
          ARRAY[
            'operational_stage',
            'next_action',
            'next_action_due_at',
            'next_action_due_on',
            'curator_display_name'
          ]::TEXT[],
          FALSE
        ),
        (
          'platform.student_portal_overview_v2()',
          ARRAY[
            'operational_stage',
            'student_action_kind',
            'student_action_label',
            'student_action_due_at',
            'student_action_document_slot_id',
            'evo_action_task_id',
            'evo_action_title',
            'evo_action_status',
            'evo_action_due_at',
            'evo_action_due_on',
            'curator_display_name'
          ]::TEXT[],
          TRUE
        )
    ) AS expected(signature, columns, expanded)
  LOOP
    routine_oid := pg_catalog.to_regprocedure(contract.signature);
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION 'Migration 131 routine is missing: %', contract.signature;
    END IF;

    SELECT * INTO STRICT routine_row
    FROM pg_catalog.pg_proc
    WHERE oid = routine_oid;

    IF NOT routine_row.prosecdef
      OR routine_row.provolatile <> 's'
      OR routine_row.prokind <> 'f'
      OR NOT routine_row.proretset
      OR routine_row.pronargdefaults <> 0
      OR NOT (routine_row.proconfig @> ARRAY['search_path=""']::TEXT[])
    THEN
      RAISE EXCEPTION 'Migration 131 routine contract drifted: %',
        contract.signature;
    END IF;

    SELECT COALESCE(
      pg_catalog.array_agg(
        parameter.parameter_name::TEXT
        ORDER BY parameter.ordinal_position
      ),
      ARRAY[]::TEXT[]
    )
    INTO output_columns
    FROM information_schema.parameters AS parameter
    WHERE parameter.specific_schema = 'platform'
      AND parameter.specific_name =
        routine_row.proname || '_' || routine_oid::TEXT
      AND parameter.parameter_mode = 'OUT';

    IF output_columns IS DISTINCT FROM contract.columns THEN
      RAISE EXCEPTION 'Migration 131 OUT columns drifted for %: %',
        contract.signature,
        output_columns;
    END IF;

    IF NOT pg_catalog.has_function_privilege(
      'authenticated', routine_oid, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'authenticated lacks EXECUTE on %', contract.signature;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon',
      'service_role',
      'supabase_auth_admin'
    ]
    LOOP
      IF pg_catalog.has_function_privilege(
        forbidden_role, routine_oid, 'EXECUTE'
      ) THEN
        RAISE EXCEPTION '% unexpectedly has EXECUTE on %',
          forbidden_role,
          contract.signature;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine,
        LATERAL pg_catalog.aclexplode(
          COALESCE(
            routine.proacl,
            pg_catalog.acldefault('f', routine.proowner)
          )
        ) AS acl
      WHERE routine.oid = routine_oid
        AND acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PUBLIC unexpectedly has EXECUTE on %',
        contract.signature;
    END IF;

    routine_definition := pg_catalog.pg_get_functiondef(routine_oid);
    IF routine_definition NOT LIKE '%student_membership.status = ''active''%'
      OR routine_definition NOT LIKE '%student_profile.status = ''active''%'
      OR routine_definition NOT LIKE '%organization.status = ''active''%'
      OR routine_definition NOT LIKE '%bundle.status = ''published''%'
      OR routine_definition NOT LIKE '%student_case.portal_activated_at IS NOT NULL%'
      OR routine_definition NOT LIKE '%platform_can_read_student_portal_case%'
      OR routine_definition NOT LIKE '%''portal.read.self''%'
      OR routine_definition NOT LIKE '%''organization''::platform.scope_kind%'
      OR routine_definition NOT LIKE '%''student_case''::platform.scope_kind%'
    THEN
      RAISE EXCEPTION 'Migration 131 Student-self checks drifted: %',
        contract.signature;
    END IF;

    IF contract.expanded THEN
      IF routine_definition NOT LIKE '%slot.status IN (''required'', ''correction_required'', ''rejected'')%'
        OR routine_definition NOT LIKE '%assignee_membership."current_role" IN (''admin'', ''sales'', ''curator'')%'
        OR routine_definition LIKE '%student_case.next_action%'
      THEN
        RAISE EXCEPTION 'Migration 131 v2 ownership contract drifted';
      END IF;
    ELSIF routine_definition NOT LIKE '%COALESCE(next_task.title, student_case.next_action)%'
      OR routine_definition LIKE '%student_action_kind%'
      OR routine_definition LIKE '%evo_action_task_id%'
    THEN
      RAISE EXCEPTION 'Migration 131 changed the rollback v1 contract';
    END IF;
  END LOOP;
END
$catalog_contract$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', '{}', TRUE);
SELECT pg_temp.p131_assert(
  NOT EXISTS (SELECT 1 FROM platform.student_portal_overview_v1())
    AND NOT EXISTS (SELECT 1 FROM platform.student_portal_overview_v2()),
  'an unauthenticated session entered an overview projection'
);
ROLLBACK;
