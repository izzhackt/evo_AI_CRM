\set ON_ERROR_STOP on

\set u6c_org '88100000-0000-4000-8000-000000000001'
\set u6c_sales_membership '88100000-0000-4000-8000-000000000302'
\set u6c_curator_membership '88100000-0000-4000-8000-000000000303'
\set u6c_lead '88100000-0000-4000-8000-000000000501'
\set u6c_sales_user '88100000-0000-4000-8000-000000000102'

BEGIN;

SELECT jsonb_build_object(
  'sub', :'u6c_sales_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u6c_org',
  'platform_membership_id', :'u6c_sales_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001302',
  'platform_bundle_version', 13
)::TEXT AS u6c_sales_claims
\gset

SET request.jwt.claims TO :'u6c_sales_claims';
SET ROLE authenticated;

\if :u6c_hold_lock
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    :'u6c_org' || ':u6:' || :'u6c_lead',
    0
  )
);
\echo U6C_LOCK_HELD=1
SELECT pg_sleep(:'u6c_hold_seconds'::DOUBLE PRECISION);
\endif

SELECT platform.handoff_lead_to_admissions(
  :'u6c_lead',
  2,
  :'u6c_curator_membership',
  'normal',
  'Concurrent handoff proof',
  :'u6c_request_id'
) AS u6c_result
\gset

SELECT (:'u6c_result'::JSONB ->> 'case_id') AS u6c_case_id
\gset

\echo U6C_CASE_ID=:u6c_case_id
\echo U6C_REQUEST_ID=:u6c_request_id
\echo U6C_WORKER_REF=:u6c_worker_ref

COMMIT;
