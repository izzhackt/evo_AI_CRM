\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 081. All identifiers and secrets
-- are synthetic and transaction-local. No WAHA, amoCRM, AI, managed Supabase
-- project or other provider is contacted.
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
    RAISE EXCEPTION 'P8R5 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;

DO $$
DECLARE
  provision_routine CONSTANT REGPROCEDURE :=
    'platform.provision_manual_send_waha_runtime(uuid,text,uuid)'::REGPROCEDURE;
  configuration_routine CONSTANT REGPROCEDURE :=
    'platform.manual_send_waha_runtime_configuration(uuid)'::REGPROCEDURE;
  expected_result CONSTANT TEXT :=
    'TABLE(organization_id uuid, ready boolean, reason_code text, waha_session_name text, base_url text, binding_version bigint, api_key_sha256 text, updated_at timestamp with time zone)';
  forbidden_role TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid =
      'platform_private.manual_send_waha_runtime_bindings'::REGCLASS
      AND attribute.attname = 'api_key_sha256'
      AND attribute.atttypid = 'text'::REGTYPE
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'api_key_sha256 metadata is absent or nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'platform_private.manual_send_waha_runtime_bindings'::REGCLASS
      AND constraint_row.conname =
        'manual_send_waha_runtime_bindings_api_key_sha256_check'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid)
        LIKE '%^[0-9a-f]{64}$%'
  ) THEN
    RAISE EXCEPTION 'api_key_sha256 is not constrained to lowercase SHA-256';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = provision_routine::OID
      AND routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.proretset
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND routine.proargnames = ARRAY[
        'p_organization_id',
        'p_waha_api_key',
        'p_request_id',
        'organization_id',
        'ready',
        'reason_code',
        'waha_session_name',
        'base_url',
        'binding_version',
        'api_key_sha256',
        'updated_at'
      ]::TEXT[]
      AND pg_catalog.pg_get_function_result(routine.oid) = expected_result
  ) THEN
    RAISE EXCEPTION 'Provision RPC signature or hardened posture drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = configuration_routine::OID
      AND routine.prosecdef
      AND routine.provolatile = 's'
      AND routine.proretset
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND routine.proargnames = ARRAY[
        'p_organization_id',
        'organization_id',
        'ready',
        'reason_code',
        'waha_session_name',
        'base_url',
        'binding_version',
        'api_key_sha256',
        'updated_at'
      ]::TEXT[]
      AND pg_catalog.pg_get_function_result(routine.oid) = expected_result
  ) THEN
    RAISE EXCEPTION 'Configuration RPC signature or hardened posture drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role', provision_routine, 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', configuration_routine, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role lacks a P8R5 RPC grant';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role, provision_routine, 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      forbidden_role, configuration_routine, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute a P8R5 service RPC', forbidden_role;
    END IF;
  END LOOP;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon',
    'authenticated',
    'service_role'
  ] LOOP
    IF pg_catalog.has_table_privilege(
      forbidden_role,
      'platform_private.manual_send_waha_runtime_bindings',
      'SELECT,INSERT,UPDATE,DELETE'
    ) THEN
      RAISE EXCEPTION '% has direct runtime-binding table access', forbidden_role;
    END IF;
  END LOOP;
END
$$;

INSERT INTO platform.organizations (name, status)
VALUES ('P8R5 disposable organization', 'active')
RETURNING id::TEXT AS p8r5_org_id
\gset

SELECT pg_catalog.gen_random_uuid()::TEXT AS p8r5_create_request_id,
  pg_catalog.gen_random_uuid()::TEXT AS p8r5_rotate_request_id,
  pg_catalog.gen_random_uuid()::TEXT AS p8r5_invalid_request_id
\gset

SELECT pg_catalog.set_config('p8r5.organization_id', :'p8r5_org_id', true);
SELECT pg_catalog.set_config(
  'p8r5.create_request_id',
  :'p8r5_create_request_id',
  true
);
SELECT pg_catalog.set_config(
  'p8r5.invalid_request_id',
  :'p8r5_invalid_request_id',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

SET LOCAL ROLE service_role;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(NOT configuration.ready)
      AND pg_catalog.bool_and(
        configuration.reason_code = 'missing_binding'
      )
      AND pg_catalog.bool_and(
        configuration.organization_id = :'p8r5_org_id'::UUID
      )
      AND pg_catalog.bool_and(configuration.waha_session_name IS NULL)
      AND pg_catalog.bool_and(configuration.base_url IS NULL)
      AND pg_catalog.bool_and(configuration.binding_version IS NULL)
      AND pg_catalog.bool_and(configuration.api_key_sha256 IS NULL)
      AND pg_catalog.bool_and(configuration.updated_at IS NULL)
    FROM platform.manual_send_waha_runtime_configuration(
      :'p8r5_org_id'::UUID
    ) AS configuration
  ),
  'A missing binding does not return one bounded missing status row'
);

DO $$
DECLARE
  organization_id CONSTANT UUID :=
    pg_catalog.current_setting('p8r5.organization_id')::UUID;
  request_id CONSTANT UUID :=
    pg_catalog.current_setting('p8r5.invalid_request_id')::UUID;
BEGIN
  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id, NULL, request_id
    );
    RAISE EXCEPTION 'Provisioning accepted a NULL key';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id, 'too-short', request_id
    );
    RAISE EXCEPTION 'Provisioning accepted a short key';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id, ' p8r5-synthetic-waha-key-invalid ', request_id
    );
    RAISE EXCEPTION 'Provisioning accepted an untrimmed key';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id,
      pg_catalog.chr(9) || 'p8r5-synthetic-waha-key-invalid',
      request_id
    );
    RAISE EXCEPTION 'Provisioning accepted leading whitespace';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id,
      'p8r5-synthetic-key' || pg_catalog.chr(10) || 'invalid',
      request_id
    );
    RAISE EXCEPTION 'Provisioning accepted LF in a key';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id,
      'p8r5-synthetic-key' || pg_catalog.chr(13) || 'invalid',
      request_id
    );
    RAISE EXCEPTION 'Provisioning accepted CR in a key';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id, pg_catalog.repeat('x', 4097), request_id
    );
    RAISE EXCEPTION 'Provisioning accepted a key over 4096 bytes';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id, 'p8r5-synthetic-waha-key-invalid-request', NULL
    );
    RAISE EXCEPTION 'Provisioning accepted a NULL request id';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END
$$;

SELECT * FROM platform.provision_manual_send_waha_runtime(
  :'p8r5_org_id'::UUID,
  'p8r5-synthetic-waha-key-alpha-0001',
  :'p8r5_create_request_id'::UUID
)
\gset p8r5_created_

SELECT pg_temp.assert_true(
  :'p8r5_created_organization_id'::UUID = :'p8r5_org_id'::UUID
    AND :'p8r5_created_ready'::BOOLEAN
    AND :'p8r5_created_reason_code' = 'ready'
    AND :'p8r5_created_waha_session_name' = 'evo-inbox'
    AND :'p8r5_created_base_url' = 'http://evo-crm-waha:3000'
    AND :'p8r5_created_binding_version'::BIGINT = 1
    AND :'p8r5_created_api_key_sha256' =
      '8062f694489d86f9c3add53fcfbe46238ccfcfbb6a4d45755cbc6d74dbfbc923'
    AND :'p8r5_created_updated_at'::TIMESTAMPTZ IS NOT NULL,
  'Provisioning did not return the exact safe create result'
);

SELECT * FROM platform.manual_send_waha_runtime_configuration(
  :'p8r5_org_id'::UUID
)
\gset p8r5_status_

SELECT pg_temp.assert_true(
  :'p8r5_status_ready'::BOOLEAN
    AND :'p8r5_status_reason_code' = 'ready'
    AND :'p8r5_status_waha_session_name' = 'evo-inbox'
    AND :'p8r5_status_base_url' = 'http://evo-crm-waha:3000'
    AND :'p8r5_status_binding_version'::BIGINT = 1
    AND :'p8r5_status_api_key_sha256' = :'p8r5_created_api_key_sha256'
    AND :'p8r5_status_updated_at'::TIMESTAMPTZ =
      :'p8r5_created_updated_at'::TIMESTAMPTZ,
  'Configuration status does not match the created binding'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(runtime.waha_session_name = 'evo-inbox')
      AND pg_catalog.bool_and(
        runtime.waha_base_url = 'http://evo-crm-waha:3000'
      )
      AND pg_catalog.bool_and(
        runtime.waha_api_key = 'p8r5-synthetic-waha-key-alpha-0001'
      )
      AND pg_catalog.bool_and(runtime.binding_version = 1)
    FROM platform.resolve_manual_send_waha_runtime(
      :'p8r5_org_id'::UUID
    ) AS runtime
  ),
  'Migration 080 runtime resolver is incompatible with provisioned state'
);

SELECT * FROM platform.provision_manual_send_waha_runtime(
  :'p8r5_org_id'::UUID,
  'p8r5-synthetic-waha-key-alpha-0001',
  :'p8r5_create_request_id'::UUID
)
\gset p8r5_replay_

SELECT pg_temp.assert_true(
  :'p8r5_replay_organization_id'::UUID =
      :'p8r5_created_organization_id'::UUID
    AND :'p8r5_replay_ready'::BOOLEAN = :'p8r5_created_ready'::BOOLEAN
    AND :'p8r5_replay_reason_code' = :'p8r5_created_reason_code'
    AND :'p8r5_replay_waha_session_name' =
      :'p8r5_created_waha_session_name'
    AND :'p8r5_replay_base_url' = :'p8r5_created_base_url'
    AND :'p8r5_replay_binding_version'::BIGINT =
      :'p8r5_created_binding_version'::BIGINT
    AND :'p8r5_replay_api_key_sha256' = :'p8r5_created_api_key_sha256'
    AND :'p8r5_replay_updated_at'::TIMESTAMPTZ =
      :'p8r5_created_updated_at'::TIMESTAMPTZ,
  'Same request and key did not replay the exact prior result'
);

DO $$
DECLARE
  organization_id CONSTANT UUID :=
    pg_catalog.current_setting('p8r5.organization_id')::UUID;
  request_id CONSTANT UUID :=
    pg_catalog.current_setting('p8r5.create_request_id')::UUID;
BEGIN
  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id, 'p8r5-synthetic-waha-key-bravo-0002', request_id
    );
    RAISE EXCEPTION 'Provisioning replay accepted a mismatched key';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END
$$;

RESET ROLE;

SELECT binding.api_key_secret_id::TEXT AS p8r5_vault_secret_id
FROM platform_private.manual_send_waha_runtime_bindings AS binding
WHERE binding.organization_id = :'p8r5_org_id'::UUID
\gset

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  organization_id CONSTANT UUID :=
    pg_catalog.current_setting('p8r5.organization_id')::UUID;
  request_id CONSTANT UUID :=
    pg_catalog.current_setting('p8r5.invalid_request_id')::UUID;
BEGIN
  BEGIN
    PERFORM * FROM platform.manual_send_waha_runtime_configuration(
      organization_id
    );
    RAISE EXCEPTION 'authenticated executed configuration status';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id, 'p8r5-synthetic-waha-key-browser-denied', request_id
    );
    RAISE EXCEPTION 'authenticated executed provisioning';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    PERFORM 1 FROM platform_private.manual_send_waha_runtime_bindings;
    RAISE EXCEPTION 'authenticated read the private binding table';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END
$$;

SET LOCAL ROLE anon;

DO $$
DECLARE
  organization_id CONSTANT UUID :=
    pg_catalog.current_setting('p8r5.organization_id')::UUID;
BEGIN
  BEGIN
    PERFORM * FROM platform.manual_send_waha_runtime_configuration(
      organization_id
    );
    RAISE EXCEPTION 'anon executed configuration status';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END
$$;

SET LOCAL ROLE service_role;

SELECT * FROM platform.provision_manual_send_waha_runtime(
  :'p8r5_org_id'::UUID,
  'p8r5-synthetic-waha-key-bravo-0002',
  :'p8r5_rotate_request_id'::UUID
)
\gset p8r5_rotated_

SELECT pg_temp.assert_true(
  :'p8r5_rotated_ready'::BOOLEAN
    AND :'p8r5_rotated_reason_code' = 'ready'
    AND :'p8r5_rotated_waha_session_name' = 'evo-inbox'
    AND :'p8r5_rotated_base_url' = 'http://evo-crm-waha:3000'
    AND :'p8r5_rotated_binding_version'::BIGINT = 2
    AND :'p8r5_rotated_api_key_sha256' =
      '63e5c7b3b4f93c5eb97d222620fd1715fdfa80e969cf709dbe7128f091dad251'
    AND :'p8r5_rotated_updated_at'::TIMESTAMPTZ >=
      :'p8r5_created_updated_at'::TIMESTAMPTZ,
  'Rotation did not replace the hash and bump the safe version'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        runtime.waha_api_key = 'p8r5-synthetic-waha-key-bravo-0002'
      )
      AND pg_catalog.bool_and(runtime.binding_version = 2)
    FROM platform.resolve_manual_send_waha_runtime(
      :'p8r5_org_id'::UUID
    ) AS runtime
  ),
  'Resolver did not observe the rotated Vault key'
);

DO $$
DECLARE
  organization_id CONSTANT UUID :=
    pg_catalog.current_setting('p8r5.organization_id')::UUID;
  old_request_id CONSTANT UUID :=
    pg_catalog.current_setting('p8r5.create_request_id')::UUID;
BEGIN
  BEGIN
    PERFORM * FROM platform.provision_manual_send_waha_runtime(
      organization_id,
      'p8r5-synthetic-waha-key-alpha-0001',
      old_request_id
    );
    RAISE EXCEPTION 'Obsolete replay returned stale ready metadata';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END
$$;

RESET ROLE;

SELECT pg_temp.assert_true(
  (
    SELECT binding.api_key_secret_id = :'p8r5_vault_secret_id'::UUID
      AND binding.binding_version = 2
      AND binding.api_key_sha256 =
        '63e5c7b3b4f93c5eb97d222620fd1715fdfa80e969cf709dbe7128f091dad251'
      AND binding.enabled
      AND binding.waha_session_name = 'evo-inbox'
      AND binding.waha_base_url = 'http://evo-crm-waha:3000'
    FROM platform_private.manual_send_waha_runtime_bindings AS binding
    WHERE binding.organization_id = :'p8r5_org_id'::UUID
  ),
  'Rotation created a second binding or drifted the provider contract'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.bool_and(audit_event.actor_kind = 'service')
      AND pg_catalog.bool_and(audit_event.actor_profile_id IS NULL)
      AND pg_catalog.bool_and(
        audit_event.action = 'configuration.waha.provision'
      )
      AND pg_catalog.bool_and(
        audit_event.resource_type = 'manual_send_waha_runtime'
      )
      AND pg_catalog.bool_and(
        audit_event.resource_id = :'p8r5_org_id'::UUID
      )
      AND pg_catalog.bool_and(
        audit_event.after_state ?& ARRAY[
          'organization_id', 'ready', 'reason_code', 'waha_session_name',
          'base_url', 'binding_version', 'api_key_sha256', 'updated_at'
        ]
      )
      AND pg_catalog.bool_and(NOT (audit_event.after_state ? 'waha_api_key'))
      AND pg_catalog.bool_and(
        NOT (audit_event.after_state ? 'api_key_secret_id')
      )
      AND pg_catalog.bool_and(
        COALESCE(audit_event.before_state::TEXT, '')
          NOT LIKE '%p8r5-synthetic-waha-key-alpha-0001%'
      )
      AND pg_catalog.bool_and(
        COALESCE(audit_event.before_state::TEXT, '')
          NOT LIKE '%p8r5-synthetic-waha-key-bravo-0002%'
      )
      AND pg_catalog.bool_and(
        audit_event.after_state::TEXT
          NOT LIKE '%p8r5-synthetic-waha-key-alpha-0001%'
      )
      AND pg_catalog.bool_and(
        audit_event.after_state::TEXT
          NOT LIKE '%p8r5-synthetic-waha-key-bravo-0002%'
      )
      AND pg_catalog.bool_and(
        audit_event.reason NOT LIKE '%p8r5-synthetic-waha-key%'
      )
      AND pg_catalog.bool_and(
        audit_event.actor_principal NOT LIKE '%p8r5-synthetic-waha-key%'
      )
    FROM platform.audit_events AS audit_event
    WHERE audit_event.organization_id = :'p8r5_org_id'::UUID
      AND audit_event.request_id IN (
        :'p8r5_create_request_id'::UUID,
        :'p8r5_rotate_request_id'::UUID
      )
  ),
  'Provisioning audit is missing, duplicated by replay or contains plaintext'
);

-- Rotate only the transaction-local Vault value out of band to prove that
-- status decrypts and validates the secret instead of merely reporting safe
-- binding metadata.
SELECT vault.update_secret(
  :'p8r5_vault_secret_id'::UUID,
  'p8r5-synthetic-waha-key-charlie-0003'
);

SET LOCAL ROLE service_role;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(NOT configuration.ready)
      AND pg_catalog.bool_and(
        configuration.reason_code = 'secret_hash_mismatch'
      )
      AND pg_catalog.bool_and(configuration.waha_session_name = 'evo-inbox')
      AND pg_catalog.bool_and(
        configuration.base_url = 'http://evo-crm-waha:3000'
      )
      AND pg_catalog.bool_and(configuration.binding_version = 2)
      AND pg_catalog.bool_and(
        configuration.api_key_sha256 =
          '63e5c7b3b4f93c5eb97d222620fd1715fdfa80e969cf709dbe7128f091dad251'
      )
      AND pg_catalog.bool_and(configuration.updated_at IS NOT NULL)
    FROM platform.manual_send_waha_runtime_configuration(
      :'p8r5_org_id'::UUID
    ) AS configuration
  ),
  'Configuration status did not fail closed on a Vault/hash mismatch'
);

RESET ROLE;

SELECT vault.update_secret(
  :'p8r5_vault_secret_id'::UUID,
  'p8r5-synthetic-waha-key-bravo-0002'
);

ROLLBACK;
