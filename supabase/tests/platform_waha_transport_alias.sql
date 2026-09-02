\set ON_ERROR_STOP on

-- Migration-099 acceptance. All rows, identifiers and Vault values are
-- synthetic and transaction-local; no WAHA endpoint is contacted.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P5B transport-alias assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;

DO $$
DECLARE
  binding_relation CONSTANT REGCLASS :=
    'platform_private.manual_send_waha_runtime_bindings'::REGCLASS;
  resolve_routine CONSTANT REGPROCEDURE :=
    'platform.resolve_manual_send_waha_runtime(uuid)'::REGPROCEDURE;
  configuration_routine CONSTANT REGPROCEDURE :=
    'platform.manual_send_waha_runtime_configuration(uuid)'::REGPROCEDURE;
  provision_routine CONSTANT REGPROCEDURE :=
    'platform.provision_manual_send_waha_runtime(uuid,text,uuid)'::REGPROCEDURE;
  default_expression TEXT;
  forbidden_role TEXT;
BEGIN
  SELECT pg_catalog.pg_get_expr(
    attribute_default.adbin,
    attribute_default.adrelid
  )
  INTO default_expression
  FROM pg_catalog.pg_attribute AS attribute
  JOIN pg_catalog.pg_attrdef AS attribute_default
    ON attribute_default.adrelid = attribute.attrelid
   AND attribute_default.adnum = attribute.attnum
  WHERE attribute.attrelid = binding_relation
    AND attribute.attname = 'waha_base_url'
    AND NOT attribute.attisdropped;

  IF default_expression IS DISTINCT FROM
    '''http://evo-inbox-waha:3000''::text'
  THEN
    RAISE EXCEPTION
      'WAHA base-url default is not the EVO Inbox transport: %',
      default_expression;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = binding_relation
      AND constraint_row.conname =
        'manual_send_waha_runtime_bindings_waha_base_url_check'
      AND constraint_row.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) =
        'CHECK ((waha_base_url = ''http://evo-inbox-waha:3000''::text))'
  ) THEN
    RAISE EXCEPTION
      'WAHA base-url constraint is absent, unvalidated or not exact';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = binding_relation
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'vault.secrets'::REGCLASS
  ) THEN
    RAISE EXCEPTION 'WAHA Vault secret reference was not preserved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid IN (
      resolve_routine::OID,
      configuration_routine::OID,
      provision_routine::OID
    )
      AND (
        pg_catalog.strpos(
          routine.prosrc,
          'http://evo-crm-waha:3000'
        ) <> 0
        OR pg_catalog.strpos(
          routine.prosrc,
          'http://evo-inbox-waha:3000'
        ) = 0
        OR NOT routine.prosecdef
        OR NOT (
          routine.proconfig @> ARRAY['search_path=""']::TEXT[]
        )
      )
  ) THEN
    RAISE EXCEPTION
      'A service routine retained the old alias or lost its fail-closed boundary';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role', resolve_routine, 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', configuration_routine, 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', provision_routine, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role lost a required WAHA runtime RPC';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role, resolve_routine, 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      forbidden_role, configuration_routine, 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      forbidden_role, provision_routine, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute a WAHA runtime RPC', forbidden_role;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role_row
    WHERE role_row.rolname = 'supabase_auth_admin'
      AND (
        pg_catalog.has_function_privilege(
          role_row.rolname, resolve_routine, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          role_row.rolname, configuration_routine, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          role_row.rolname, provision_routine, 'EXECUTE'
        )
      )
  ) THEN
    RAISE EXCEPTION 'supabase_auth_admin can execute a WAHA runtime RPC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.manual_send_waha_runtime_bindings AS binding
    WHERE binding.waha_session_name <> 'evo-inbox'
      OR binding.waha_base_url <> 'http://evo-inbox-waha:3000'
  ) THEN
    RAISE EXCEPTION 'An existing binding did not move to the exact transport';
  END IF;
END
$$;

INSERT INTO platform.organizations (name, status)
VALUES ('P5B transport-alias disposable organization', 'active')
RETURNING id::TEXT AS p5b_alias_org_id
\gset

SELECT pg_catalog.gen_random_uuid()::TEXT AS p5b_alias_create_request_id,
  pg_catalog.gen_random_uuid()::TEXT AS p5b_alias_rotate_request_id
\gset

SELECT pg_catalog.set_config(
  'p5b.alias_organization_id',
  :'p5b_alias_org_id',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

SET LOCAL ROLE service_role;

SELECT * FROM platform.provision_manual_send_waha_runtime(
  :'p5b_alias_org_id'::UUID,
  'p5b-alias-synthetic-waha-key-alpha',
  :'p5b_alias_create_request_id'::UUID
)
\gset p5b_alias_created_

SELECT pg_temp.assert_true(
  :'p5b_alias_created_ready'::BOOLEAN
    AND :'p5b_alias_created_reason_code' = 'ready'
    AND :'p5b_alias_created_waha_session_name' = 'evo-inbox'
    AND :'p5b_alias_created_base_url' =
      'http://evo-inbox-waha:3000'
    AND :'p5b_alias_created_binding_version'::BIGINT = 1,
  'Provisioning did not create the exact EVO Inbox transport'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        runtime.waha_session_name = 'evo-inbox'
      )
      AND pg_catalog.bool_and(
        runtime.waha_base_url = 'http://evo-inbox-waha:3000'
      )
      AND pg_catalog.bool_and(
        runtime.waha_api_key = 'p5b-alias-synthetic-waha-key-alpha'
      )
      AND pg_catalog.bool_and(runtime.binding_version = 1)
    FROM platform.resolve_manual_send_waha_runtime(
      :'p5b_alias_org_id'::UUID
    ) AS runtime
  ),
  'Runtime resolution did not return the exact transport and Vault value'
);

RESET ROLE;

SELECT binding.api_key_secret_id::TEXT AS p5b_alias_secret_id
FROM platform_private.manual_send_waha_runtime_bindings AS binding
WHERE binding.organization_id = :'p5b_alias_org_id'::UUID
\gset

DO $$
BEGIN
  BEGIN
    UPDATE platform_private.manual_send_waha_runtime_bindings
    SET waha_base_url = 'http://evo-crm-waha:3000'
    WHERE organization_id =
      pg_catalog.current_setting('p5b.alias_organization_id')::UUID;
    RAISE EXCEPTION 'Frozen V1 transport alias passed the current constraint';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
END
$$;

SET LOCAL ROLE service_role;

SELECT * FROM platform.provision_manual_send_waha_runtime(
  :'p5b_alias_org_id'::UUID,
  'p5b-alias-synthetic-waha-key-bravo',
  :'p5b_alias_rotate_request_id'::UUID
)
\gset p5b_alias_rotated_

SELECT pg_temp.assert_true(
  :'p5b_alias_rotated_ready'::BOOLEAN
    AND :'p5b_alias_rotated_waha_session_name' = 'evo-inbox'
    AND :'p5b_alias_rotated_base_url' =
      'http://evo-inbox-waha:3000'
    AND :'p5b_alias_rotated_binding_version'::BIGINT = 2,
  'Key rotation did not preserve the exact transport'
);

RESET ROLE;

SELECT pg_temp.assert_true(
  (
    SELECT binding.api_key_secret_id = :'p5b_alias_secret_id'::UUID
      AND binding.waha_session_name = 'evo-inbox'
      AND binding.waha_base_url = 'http://evo-inbox-waha:3000'
      AND binding.binding_version = 2
    FROM platform_private.manual_send_waha_runtime_bindings AS binding
    WHERE binding.organization_id = :'p5b_alias_org_id'::UUID
  ),
  'Transport cutover or rotation replaced the Vault secret reference'
);

ROLLBACK;
