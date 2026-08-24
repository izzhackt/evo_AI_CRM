\set ON_ERROR_STOP on

-- This fixture tests canonical identity serialization, not organization
-- provisioning. Bypass the pre-existing live-Admin invariant only while the
-- otherwise valid parent organization row is created; workers and all U2
-- uniqueness/provenance behavior run with normal triggers and constraints.
SET session_replication_role = replica;
INSERT INTO platform.organizations (id, name)
VALUES (
  '84000000-0000-4000-8000-000000009001',
  'U2 concurrency organization'
);
SET session_replication_role = origin;

SELECT 'platform migration 084 concurrency fixture ready' AS result;
