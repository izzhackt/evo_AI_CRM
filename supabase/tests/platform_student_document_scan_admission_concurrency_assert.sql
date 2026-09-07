\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.e5ac_assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'E5AC assertion failed: %', p_message;
  END IF;
END
$$;

SELECT pg_temp.e5ac_assert_true(
  (
    SELECT count(*) = 2
      AND count(*) FILTER (
        WHERE request_id = '58012891-0000-4000-8000-000000000002'
          AND scan_claimed_at IS NOT NULL
          AND scan_lease_expires_at > statement_timestamp()
      ) = 1
      AND count(*) FILTER (
        WHERE request_id = '58012891-0000-4000-8000-000000000003'
          AND scan_claimed_at IS NULL
          AND scan_lease_expires_at IS NULL
      ) = 1
      AND bool_and(
        attempt_no = 1
        AND document_slot_id =
          '58012891-0000-4000-8000-000000000001'
        AND released_at IS NULL
        AND lease_expires_at > statement_timestamp()
      )
    FROM platform_private.student_document_scan_admissions
    WHERE request_id IN (
      '58012891-0000-4000-8000-000000000002',
      '58012891-0000-4000-8000-000000000003'
    )
  ),
  'serialized slot race must retain two admissions and only the first claim'
);

ROLLBACK;

SELECT 'platform migration 128 service scan claim concurrency serialized'
  AS result;
