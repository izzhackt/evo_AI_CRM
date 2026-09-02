\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- Migration 103 proof. All values are synthetic and the transaction rolls
-- back. No amoCRM account or other external provider is contacted.
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
    RAISE EXCEPTION 'amoCRM discovery v2 assertion failed: %', p_message;
  END IF;
END
$$;

SELECT organization.id AS discovery_v2_org
FROM platform.organizations AS organization
WHERE organization.status = 'active'
ORDER BY organization.id
LIMIT 1
\gset

SELECT statement_timestamp() AS discovery_v2_now
\gset

SELECT jsonb_build_object(
  'schema_version', 2,
  'account', jsonb_build_object(
    'id', '103001',
    'domain', 'synthetic-v2.amocrm.ru',
    'subdomain', 'synthetic-v2',
    'name', 'Synthetic EVO account',
    'timezone', 'Asia/Bishkek',
    'country', 'KG'
  ),
  'pipelines', jsonb_build_array(
    jsonb_build_object(
      'id', '103101',
      'name', 'Synthetic Sales',
      'is_main', true,
      'is_archive', false,
      'statuses', jsonb_build_array(
        jsonb_build_object(
          'id', '103111',
          'name', 'Qualified',
          'sort', 10,
          'type', 0,
          'is_editable', true
        )
      )
    )
  ),
  'lead_tags', jsonb_build_array(
    jsonb_build_object('id', '103201', 'name', 'EVO V2 Sales'),
    jsonb_build_object('id', '103202', 'name', 'EVO V2 Admissions')
  ),
  'users', jsonb_build_array(
    jsonb_build_object(
      'id', '103301',
      'name', 'Synthetic operator',
      'is_active', true
    )
  ),
  'lead_custom_fields', jsonb_build_array(
    jsonb_build_object(
      'id', '103401',
      'name', 'Program',
      'code', null,
      'type', 'text',
      'enums', jsonb_build_array()
    )
  ),
  'contact_custom_fields', jsonb_build_array(
    jsonb_build_object(
      'id', '103501',
      'name', 'Phone',
      'code', 'PHONE',
      'type', 'multitext',
      'enums', jsonb_build_array()
    ),
    jsonb_build_object(
      'id', '103502',
      'name', 'Email',
      'code', 'EMAIL',
      'type', 'multitext',
      'enums', jsonb_build_array()
    )
  )
)::TEXT AS discovery_v2_snapshot
\gset

SELECT pg_temp.assert_true(
  platform_private.amocrm_mapping_snapshot_is_valid(
    :'discovery_v2_snapshot'::JSONB,
    103001,
    'synthetic-v2.amocrm.ru',
    'synthetic-v2'
  ),
  'complete schema v2 snapshot must validate'
);

SELECT pg_temp.assert_true(
  platform_private.amocrm_mapping_snapshot_is_valid(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        :'discovery_v2_snapshot'::JSONB - 'lead_tags',
        '{account}',
        (:'discovery_v2_snapshot'::JSONB -> 'account')
          - 'country' - 'name' - 'timezone',
        false
      ),
      '{schema_version}',
      '1'::JSONB,
      false
    ),
    103001,
    'synthetic-v2.amocrm.ru',
    'synthetic-v2'
  ),
  'historical schema v1 snapshot must remain constraint-valid'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated"}',
  true
);
\set ON_ERROR_STOP off
SELECT *
FROM platform.persist_amocrm_mapping_discovery(
  :'discovery_v2_org',
  103001,
  'synthetic-v2.amocrm.ru',
  'synthetic-v2',
  :'discovery_v2_snapshot'::JSONB,
  'provider_observed',
  'provider:amocrm:api-v4:routing-v2:authenticated-denied',
  :'discovery_v2_now'::TIMESTAMPTZ,
  '10300000-0000-4000-8000-000000000001'
);
\set discovery_v2_authenticated_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SELECT pg_temp.assert_true(
  :'discovery_v2_authenticated_state' = '42501',
  'authenticated caller must not persist provider discovery'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
\set ON_ERROR_STOP off
SELECT *
FROM platform.persist_amocrm_mapping_discovery(
  :'discovery_v2_org',
  103001,
  'synthetic-v2.amocrm.ru',
  'synthetic-v2',
  :'discovery_v2_snapshot'::JSONB,
  'provider_observed',
  'provider:amocrm:api-v4:routing-v2:anon-denied',
  :'discovery_v2_now'::TIMESTAMPTZ,
  '10300000-0000-4000-8000-000000000002'
);
\set discovery_v2_anon_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SELECT pg_temp.assert_true(
  :'discovery_v2_anon_state' = '42501',
  'anonymous caller must not persist provider discovery'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT to_jsonb(discovery)::TEXT AS discovery_v2_first_result
FROM platform.persist_amocrm_mapping_discovery(
  :'discovery_v2_org',
  103001,
  'synthetic-v2.amocrm.ru',
  'synthetic-v2',
  :'discovery_v2_snapshot'::JSONB,
  'provider_observed',
  'provider:amocrm:api-v4:routing-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  :'discovery_v2_now'::TIMESTAMPTZ,
  '10300000-0000-4000-8000-000000000003'
) AS discovery
\gset

SELECT to_jsonb(discovery)::TEXT AS discovery_v2_replay_result
FROM platform.persist_amocrm_mapping_discovery(
  :'discovery_v2_org',
  103001,
  'SYNTHETIC-V2.AMOCRM.RU',
  'SYNTHETIC-V2',
  :'discovery_v2_snapshot'::JSONB,
  'PROVIDER_OBSERVED',
  'provider:amocrm:api-v4:routing-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  :'discovery_v2_now'::TIMESTAMPTZ,
  '10300000-0000-4000-8000-000000000003'
) AS discovery
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'discovery_v2_first_result'::JSONB
    = :'discovery_v2_replay_result'::JSONB,
  'exact request replay must return the same immutable row'
);
SELECT pg_temp.assert_true(
  (:'discovery_v2_first_result'::JSONB ->> 'snapshot_schema_version')::INTEGER
    = 2,
  'new provider evidence must store schema version 2'
);
SELECT pg_temp.assert_true(
  :'discovery_v2_first_result'::JSONB -> 'sanitized_snapshot' -> 'lead_tags'
    = :'discovery_v2_snapshot'::JSONB -> 'lead_tags',
  'stored evidence must retain the exact lead-tag catalog'
);
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM platform_private.amocrm_mapping_discovery_versions AS version
    WHERE version.request_id = '10300000-0000-4000-8000-000000000003'
      AND version.snapshot_schema_version = 2
  ),
  'exact replay must not append a duplicate row'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set ON_ERROR_STOP off
SELECT *
FROM platform.persist_amocrm_mapping_discovery(
  :'discovery_v2_org',
  103001,
  'synthetic-v2.amocrm.ru',
  'synthetic-v2',
  pg_catalog.jsonb_set(
    :'discovery_v2_snapshot'::JSONB,
    '{lead_tags,0,name}',
    '"Changed Sales tag"'::JSONB
  ),
  'provider_observed',
  'provider:amocrm:api-v4:routing-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  :'discovery_v2_now'::TIMESTAMPTZ,
  '10300000-0000-4000-8000-000000000003'
);
\set discovery_v2_reused_request_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SELECT pg_temp.assert_true(
  :'discovery_v2_reused_request_state' = '22023',
  'same request with different lead-tag evidence must fail closed'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set ON_ERROR_STOP off
SELECT *
FROM platform.persist_amocrm_mapping_discovery(
  :'discovery_v2_org',
  103001,
  'synthetic-v2.amocrm.ru',
  'synthetic-v2',
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      :'discovery_v2_snapshot'::JSONB - 'lead_tags',
      '{account}',
      (:'discovery_v2_snapshot'::JSONB -> 'account')
        - 'country' - 'name' - 'timezone',
      false
    ),
    '{schema_version}',
    '1'::JSONB,
    false
  ),
  'provider_observed',
  'provider:amocrm:api-v4:routing-v1:forbidden-new-write',
  :'discovery_v2_now'::TIMESTAMPTZ,
  '10300000-0000-4000-8000-000000000004'
);
\set discovery_v2_new_v1_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SELECT pg_temp.assert_true(
  :'discovery_v2_new_v1_state' = '22023',
  'active persist RPC must reject new schema-v1 evidence'
);

SELECT pg_temp.assert_true(
  pg_catalog.to_regprocedure(
    'platform_private.persist_amocrm_mapping_discovery_v2_impl(uuid,bigint,text,text,jsonb,text,text,timestamp with time zone,uuid)'
  ) IS NULL,
  'migration must not retain a callable compatibility implementation'
);

SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'service_role',
    'platform.persist_amocrm_mapping_discovery(uuid,bigint,text,text,jsonb,text,text,timestamp with time zone,uuid)',
    'EXECUTE'
  ),
  'service role must retain the single public persist path'
);

ROLLBACK;

SELECT 'platform amoCRM mapping discovery v2 passed' AS result;
