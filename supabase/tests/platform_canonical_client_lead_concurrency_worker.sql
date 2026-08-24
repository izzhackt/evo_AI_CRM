\set ON_ERROR_STOP on

BEGIN;

\if :u2_hold_lock
SELECT pg_advisory_xact_lock(840084001);
\endif

SELECT platform_private.create_or_link_client(
  '84000000-0000-4000-8000-000000009001',
  'Concurrent Canonical Client',
  'concurrent@example.invalid',
  '+996700123456',
  'evo',
  'client',
  'u2-concurrent-client',
  'concurrency_observation',
  statement_timestamp(),
  NULL,
  :'u2_worker_ref'
) AS u2_concurrent_client_id
\gset

\echo U2_CONCURRENT_CLIENT=:u2_concurrent_client_id

SELECT pg_sleep(:'u2_hold_seconds'::DOUBLE PRECISION);

COMMIT;
