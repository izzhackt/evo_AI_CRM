\set ON_ERROR_STOP on

\set u6c_org '88100000-0000-4000-8000-000000000001'
\set u6c_lead '88100000-0000-4000-8000-000000000501'

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.u6c_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, FALSE) THEN
    RAISE EXCEPTION 'U6 concurrency assertion failed: %', p_message;
  END IF;
END
$$;

SELECT
  count(*) AS u6c_receipt_count,
  count(DISTINCT receipt.result ->> 'case_id') AS u6c_case_id_count,
  min(receipt.result ->> 'case_id') AS u6c_case_id
FROM platform_private.sales_admissions_handoff_receipts AS receipt
WHERE receipt.organization_id = :'u6c_org'
  AND receipt.request_id IN (
    :'u6c_request_id_a'::UUID,
    :'u6c_request_id_b'::UUID
  )
\gset

SELECT pg_temp.u6c_assert(
  :'u6c_receipt_count'::BIGINT = 2,
  'expected exactly two receipts'
);

SELECT pg_temp.u6c_assert(
  :'u6c_case_id_count'::BIGINT = 1,
  'concurrent requests returned different case ids'
);

SELECT pg_temp.u6c_assert(
  (
    SELECT count(*)
    FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = :'u6c_org'
      AND student_case.canonical_lead_id = :'u6c_lead'::UUID
      AND student_case.state = 'active'
  ) = 1,
  'expected one active canonical case'
);

SELECT pg_temp.u6c_assert(
  (
    SELECT count(*)
    FROM platform.sales_admissions_handoffs AS handoff
    WHERE handoff.organization_id = :'u6c_org'
      AND handoff.lead_id = :'u6c_lead'::UUID
      AND handoff.student_case_id = :'u6c_case_id'::UUID
  ) = 1,
  'expected one handoff row'
);

SELECT pg_temp.u6c_assert(
  (
    SELECT count(*)
    FROM platform.case_tasks AS task
    WHERE task.organization_id = :'u6c_org'
      AND task.student_case_id = :'u6c_case_id'::UUID
      AND task.source_key LIKE 'u6.%'
  ) = 3,
  'expected three starter tasks'
);

SELECT pg_temp.u6c_assert(
  (
    SELECT count(*)
    FROM platform.student_case_lifecycle_events AS event
    WHERE event.organization_id = :'u6c_org'
      AND event.student_case_id = :'u6c_case_id'::UUID
      AND event.event_type = 'activated'
  ) = 1,
  'expected one activation event'
);

SELECT pg_temp.u6c_assert(
  (
    SELECT count(*)
    FROM platform.student_case_assignment_events AS event
    WHERE event.organization_id = :'u6c_org'
      AND event.student_case_id = :'u6c_case_id'::UUID
  ) = 1,
  'expected one assignment event'
);

ROLLBACK;

SELECT 'platform migration 088 U6 concurrency converged' AS result;
