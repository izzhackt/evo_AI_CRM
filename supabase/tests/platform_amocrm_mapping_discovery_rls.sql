\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- P4A stateful authorization, replay and sanitization proof. All rows are
-- synthetic, contain no personal/customer data, and are rolled back. No
-- provider, Docker service or production system is contacted.
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
    RAISE EXCEPTION 'P4A assertion failed: %', p_message;
  END IF;
END
$$;

SELECT
  membership.organization_id AS p4a_org_a,
  membership.id AS p4a_admin_a_membership,
  profile.auth_user_id AS p4a_admin_a_user,
  profile.access_version AS p4a_admin_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.organization_id AS p4a_org_b,
  membership.id AS p4a_admin_b_membership,
  profile.auth_user_id AS p4a_admin_b_user,
  profile.access_version AS p4a_admin_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  membership.id AS p4a_sales_a_membership,
  profile.auth_user_id AS p4a_sales_a_user,
  profile.access_version AS p4a_sales_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'p4a_org_a'
  AND profile.auth_user_id = '10000000-0000-4000-8000-000000000002'
\gset

SELECT
  membership.id AS p4a_inactive_membership,
  membership."current_role"::TEXT AS p4a_inactive_role,
  profile.auth_user_id AS p4a_inactive_user,
  profile.access_version AS p4a_inactive_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'p4a_org_a'
  AND profile.auth_user_id = '10000000-0000-4000-8000-000000000006'
\gset

SELECT jsonb_build_object(
  'sub', :'p4a_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p4a_admin_a_access_version'::BIGINT
)::TEXT AS p4a_admin_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p4a_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p4a_admin_b_access_version'::BIGINT
)::TEXT AS p4a_admin_b_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p4a_sales_a_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'p4a_sales_a_access_version'::BIGINT
)::TEXT AS p4a_sales_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p4a_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version',
    GREATEST(1, :'p4a_admin_a_access_version'::BIGINT - 1)
)::TEXT AS p4a_stale_admin_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p4a_inactive_user',
  'role', 'authenticated',
  'platform_role', :'p4a_inactive_role',
  'platform_access_version', :'p4a_inactive_access_version'::BIGINT
)::TEXT AS p4a_inactive_claims
\gset
\set p4a_service_claims '{"role":"service_role"}'

SELECT jsonb_build_object(
  'schema_version', 1,
  'account', jsonb_build_object(
    'id', '580001',
    'domain', 'synthetic-mapping.amocrm.ru',
    'subdomain', 'synthetic-mapping'
  ),
  'pipelines', jsonb_build_array(
    jsonb_build_object(
      'id', 580101,
      'name', 'Synthetic Admissions Pipeline',
      'statuses', jsonb_build_array(
        jsonb_build_object('id', 580111, 'name', 'Synthetic Intake')
      )
    )
  ),
  'users', jsonb_build_array(
    jsonb_build_object('id', 580201, 'name', 'Synthetic Operator')
  ),
  'lead_custom_fields', jsonb_build_array(
    jsonb_build_object(
      'id', 580301,
      'name', 'Synthetic Program Direction',
      'type', 'text'
    )
  ),
  'contact_custom_fields', jsonb_build_array(
    jsonb_build_object(
      'id', 580401,
      'name', 'Synthetic Locale',
      'type', 'select'
    )
  )
)::TEXT AS p4a_snapshot
\gset

-- Service ingest normalizes the account host, computes the hash in Postgres,
-- and returns the complete safe stored row.
SET request.jwt.claims TO :'p4a_service_claims';
SET ROLE service_role;
SELECT to_jsonb(discovery)::TEXT AS p4a_first_result
FROM platform.persist_amocrm_mapping_discovery(
  :'p4a_org_a',
  580001,
  'SYNTHETIC-MAPPING.AMOCRM.RU',
  'SYNTHETIC-MAPPING',
  :'p4a_snapshot'::JSONB,
  'local_non_provider',
  'local:test:p4a:580001:v1',
  TIMESTAMPTZ '2026-08-01 12:00:00+00',
  '58000000-0000-4000-8000-000000000001'
) AS discovery
\gset

SELECT to_jsonb(discovery)::TEXT AS p4a_replay_result
FROM platform.persist_amocrm_mapping_discovery(
  :'p4a_org_a',
  580001,
  'SYNTHETIC-MAPPING.AMOCRM.RU',
  'SYNTHETIC-MAPPING',
  :'p4a_snapshot'::JSONB,
  'local_non_provider',
  'local:test:p4a:580001:v1',
  TIMESTAMPTZ '2026-08-01 12:00:00+00',
  '58000000-0000-4000-8000-000000000001'
) AS discovery
\gset

SELECT to_jsonb(discovery)::TEXT AS p4a_second_result
FROM platform.persist_amocrm_mapping_discovery(
  :'p4a_org_a',
  580001,
  'synthetic-mapping.amocrm.ru',
  'synthetic-mapping',
  :'p4a_snapshot'::JSONB,
  'local_non_provider',
  'local:test:p4a:580001:v2',
  TIMESTAMPTZ '2026-08-01 12:05:00+00',
  '58000000-0000-4000-8000-000000000002'
) AS discovery
\gset

\set ON_ERROR_STOP off
SELECT *
FROM platform.persist_amocrm_mapping_discovery(
  :'p4a_org_a',
  580001,
  'synthetic-mapping.amocrm.ru',
  'synthetic-mapping',
  jsonb_set(
    :'p4a_snapshot'::JSONB,
    '{pipelines,0,name}',
    '"Changed Synthetic Pipeline"'::JSONB
  ),
  'local_non_provider',
  'local:test:p4a:580001:v1',
  TIMESTAMPTZ '2026-08-01 12:00:00+00',
  '58000000-0000-4000-8000-000000000001'
);
\set p4a_changed_replay_state :SQLSTATE

SELECT *
FROM platform.persist_amocrm_mapping_discovery(
  :'p4a_org_a',
  580001,
  'synthetic-mapping.amocrm.ru',
  'synthetic-mapping',
  jsonb_set(
    :'p4a_snapshot'::JSONB,
    '{users,0,AuThOrIzAtIoN}',
    '"synthetic-denied-value"'::JSONB
  ),
  'local_non_provider',
  'local:test:p4a:580001:forbidden',
  TIMESTAMPTZ '2026-08-01 12:10:00+00',
  '58000000-0000-4000-8000-000000000003'
);
\set p4a_forbidden_key_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p4a_first_result'::JSONB = :'p4a_replay_result'::JSONB
  AND (:'p4a_first_result'::JSONB ->> 'version')::BIGINT = 1
  AND (:'p4a_second_result'::JSONB ->> 'version')::BIGINT = 2
  AND :'p4a_first_result'::JSONB ->> 'snapshot_sha256' =
    :'p4a_second_result'::JSONB ->> 'snapshot_sha256'
  AND :'p4a_changed_replay_state' = '22023'
  AND :'p4a_forbidden_key_state' = '22023',
  'service ingest, stable replay, versioning or sanitization drifted'
);

-- No API role, including BYPASSRLS service_role, receives direct table ACL.
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT count(*)
FROM platform_private.amocrm_mapping_discovery_versions;
\set p4a_authenticated_direct_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET ROLE anon;
\set ON_ERROR_STOP off
SELECT count(*)
FROM platform_private.amocrm_mapping_discovery_versions;
\set p4a_anon_direct_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT count(*)
FROM platform_private.amocrm_mapping_discovery_versions;
\set p4a_service_direct_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p4a_authenticated_direct_state' = '42501'
  AND :'p4a_anon_direct_state' = '42501'
  AND :'p4a_service_direct_state' = '42501',
  'private mapping table direct ACL drifted'
);

-- A same-organization live Admin can read latest or one exact version only.
SET request.jwt.claims TO :'p4a_admin_a_claims';
SET ROLE authenticated;
SELECT to_jsonb(discovery)::TEXT AS p4a_admin_latest
FROM platform.admin_amocrm_mapping_discovery_versions(
  :'p4a_org_a',
  580001
) AS discovery
\gset
SELECT to_jsonb(discovery)::TEXT AS p4a_admin_exact_v1
FROM platform.admin_amocrm_mapping_discovery_versions(
  :'p4a_org_a',
  580001,
  1
) AS discovery
\gset
SELECT count(*) AS p4a_admin_missing_exact_count
FROM platform.admin_amocrm_mapping_discovery_versions(
  :'p4a_org_a',
  580001,
  999
)
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (:'p4a_admin_latest'::JSONB ->> 'version')::BIGINT = 2
  AND (:'p4a_admin_exact_v1'::JSONB ->> 'version')::BIGINT = 1
  AND :'p4a_admin_latest'::JSONB ->> 'organization_id' = :'p4a_org_a'
  AND (:'p4a_admin_latest'::JSONB ->> 'amocrm_account_id')::BIGINT =
    580001
  AND :'p4a_admin_missing_exact_count'::BIGINT = 0,
  'Admin latest/exact read behavior drifted'
);

-- Active Sales, a different tenant's Admin, stale authority and an inactive
-- membership all fail closed through live authorization checks.
SET request.jwt.claims TO :'p4a_sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT *
FROM platform.admin_amocrm_mapping_discovery_versions(
  :'p4a_org_a', 580001
);
\set p4a_sales_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'p4a_admin_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT *
FROM platform.admin_amocrm_mapping_discovery_versions(
  :'p4a_org_a', 580001
);
\set p4a_cross_org_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'p4a_stale_admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT *
FROM platform.admin_amocrm_mapping_discovery_versions(
  :'p4a_org_a', 580001
);
\set p4a_stale_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'p4a_inactive_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT *
FROM platform.admin_amocrm_mapping_discovery_versions(
  :'p4a_org_a', 580001
);
\set p4a_inactive_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p4a_sales_read_state' = '42501'
  AND :'p4a_cross_org_read_state' = '42501'
  AND :'p4a_stale_read_state' = '42501'
  AND :'p4a_inactive_read_state' = '42501',
  'role, tenant, stale or inactive Admin-read denial drifted'
);

-- The two distinct requests may store the same DB-computed content hash. The
-- audit rows expose only bounded metadata/counts, never the snapshot body.
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(version ORDER BY version)
    FROM platform_private.amocrm_mapping_discovery_versions
    WHERE organization_id = :'p4a_org_a'
      AND amocrm_account_id = 580001
  ) = ARRAY[1, 2]::BIGINT[]
  AND (
    SELECT count(DISTINCT snapshot_sha256)
    FROM platform_private.amocrm_mapping_discovery_versions
    WHERE organization_id = :'p4a_org_a'
      AND amocrm_account_id = 580001
  ) = 1
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.amocrm_mapping_discovery_versions AS discovery
    WHERE discovery.organization_id = :'p4a_org_a'
      AND discovery.amocrm_account_id = 580001
      AND discovery.snapshot_sha256 IS DISTINCT FROM pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(discovery.sanitized_snapshot::TEXT, 'UTF8')
        ),
        'hex'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.amocrm_mapping_discovery_versions AS discovery
    WHERE discovery.organization_id = :'p4a_org_a'
      AND discovery.amocrm_account_id = 580001
      AND (
        discovery.account_domain <> 'synthetic-mapping.amocrm.ru'
        OR discovery.account_subdomain <> 'synthetic-mapping'
        OR discovery.snapshot_schema_version <> 1
        OR NOT platform_private.amocrm_mapping_snapshot_is_valid(
          discovery.sanitized_snapshot,
          discovery.amocrm_account_id,
          discovery.account_domain,
          discovery.account_subdomain
        )
      )
  ),
  'version stream, duplicate hash, DB hash or safe snapshot drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*)
    FROM platform.audit_events AS audit
    WHERE audit.request_id IN (
      '58000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000002'
    )
      AND audit.organization_id = :'p4a_org_a'
      AND audit.actor_kind = 'service'
      AND audit.actor_profile_id IS NULL
      AND audit.actor_principal =
        'service_role:amocrm_mapping_discovery'
      AND audit.action = 'integration.amocrm.mapping.discovery.persist'
      AND audit.resource_type = 'amocrm_mapping_discovery_version'
      AND audit.before_state IS NULL
      AND audit.after_state ->> 'snapshot_sha256' ~ '^[0-9a-f]{64}$'
      AND audit.after_state ->> 'evidence_kind' = 'local_non_provider'
      AND audit.after_state -> 'counts' = jsonb_build_object(
        'pipelines', 1,
        'users', 1,
        'lead_custom_fields', 1,
        'contact_custom_fields', 1
      )
      AND NOT (audit.after_state ? 'sanitized_snapshot')
      AND audit.after_state::TEXT NOT LIKE '%Synthetic Admissions Pipeline%'
      AND audit.after_state::TEXT NOT LIKE '%Synthetic Program Direction%'
  ) = 2
  AND NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id =
      '58000000-0000-4000-8000-000000000003'
  )
  AND (
    SELECT count(*)
    FROM platform.audit_events AS audit
    WHERE audit.request_id =
      '58000000-0000-4000-8000-000000000001'
  ) = 1,
  'safe append-only audit evidence drifted or included snapshot body'
);

-- Owners cannot silently rewrite or remove evidence: FORCE RLS is paired with
-- explicit append-only guards for every destructive operation.
\set ON_ERROR_STOP off
UPDATE platform_private.amocrm_mapping_discovery_versions
SET evidence_ref = 'local:test:p4a:mutated'
WHERE request_id = '58000000-0000-4000-8000-000000000001';
\set p4a_update_state :SQLSTATE
DELETE FROM platform_private.amocrm_mapping_discovery_versions
WHERE request_id = '58000000-0000-4000-8000-000000000001';
\set p4a_delete_state :SQLSTATE
TRUNCATE TABLE platform_private.amocrm_mapping_discovery_versions;
\set p4a_truncate_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p4a_update_state' = '55000'
  AND :'p4a_delete_state' = '55000'
  AND :'p4a_truncate_state' = '55000',
  'append-only runtime guard drifted'
);

ROLLBACK;
\set ON_ERROR_ROLLBACK off

SELECT 'platform amoCRM mapping discovery RLS passed' AS result;
