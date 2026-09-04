\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p113c_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 113 concurrency assertion failed: %', p_message;
  END IF;
END
$$;

SELECT pg_temp.p113c_assert(
  (
    SELECT slot.version = 2
    FROM platform.document_slots AS slot
    WHERE slot.organization_id = '59911399-0000-4000-8000-000000000001'
      AND slot.id = '59911399-0000-4000-8000-000000000402'
  ),
  'the slot aggregate must advance exactly once'
);

SELECT pg_temp.p113c_assert(
  (
    SELECT count(*) = 1
      AND bool_and(
        link.university_application_id
          = '59911399-0000-4000-8000-000000000501'::UUID
      )
    FROM platform.document_slot_case_links AS link
    WHERE link.organization_id = '59911399-0000-4000-8000-000000000001'
      AND link.student_case_id = '59911399-0000-4000-8000-000000000002'
      AND link.document_slot_id = '59911399-0000-4000-8000-000000000402'
  ),
  'only the lock-owning application link may persist'
);

SELECT pg_temp.p113c_assert(
  (
    SELECT count(*) = 1
      AND bool_and(
        event.request_id = '59911399-0000-4000-8000-000000000801'::UUID
      )
    FROM platform.audit_events AS event
    WHERE event.organization_id = '59911399-0000-4000-8000-000000000001'
      AND event.resource_type = 'document_slot'
      AND event.resource_id = '59911399-0000-4000-8000-000000000402'
      AND event.action = 'document.slot.application.link'
  ),
  'only the successful command may append an audit event'
);

ROLLBACK;

SELECT 'platform migration 113 same-version concurrency converged' AS result;
