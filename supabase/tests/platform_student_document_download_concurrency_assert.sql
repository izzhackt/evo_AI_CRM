\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.e5c_assert_true(
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
    RAISE EXCEPTION 'E5C assertion failed: %', p_message;
  END IF;
END
$$;

SELECT pg_temp.e5c_assert_true(
  EXISTS (
    SELECT 1
    FROM platform_private.document_download_grants AS grant_row
    JOIN platform.document_slots AS slot
      ON slot.organization_id = grant_row.organization_id
      AND slot.student_case_id = grant_row.student_case_id
      AND slot.id = grant_row.document_slot_id
    JOIN platform.document_versions AS replacement
      ON replacement.organization_id = slot.organization_id
      AND replacement.student_case_id = slot.student_case_id
      AND replacement.document_slot_id = slot.id
      AND replacement.id = slot.current_version_id
      AND replacement.version_no = slot.current_version_no
    WHERE grant_row.request_id =
        '58012890-0000-4000-8000-000000000003'
      AND grant_row.document_version_id <>
        '58012890-0000-4000-8000-000000000004'
      AND grant_row.grantee_role = 'student'
      AND grant_row.access_purpose = 'student_document_download'
      AND slot.current_version_id =
        '58012890-0000-4000-8000-000000000004'
      AND slot.status = 'submitted'
      AND replacement.integrity_status = 'pending'
      AND replacement.malware_status = 'pending'
  ),
  'the committed slot replacement and original-version Student grant must remain'
);

SELECT pg_temp.e5c_assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform_private.document_download_consumptions AS consumption
    WHERE consumption.request_id =
        '58012890-0000-4000-8000-000000000005'
      OR consumption.document_download_grant_id = (
        SELECT grant_row.id
        FROM platform_private.document_download_grants AS grant_row
        WHERE grant_row.request_id =
          '58012890-0000-4000-8000-000000000003'
      )
  ),
  'the lock-not-available consume attempt must not burn the Student grant'
);

SELECT pg_temp.e5c_assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id = '58012890-0000-4000-8000-000000000005'
      AND event.action = 'document.download.sign.authorize'
  ),
  'the failed consume attempt must not retain signing authorization audit'
);

ROLLBACK;

SELECT 'platform migration 128 NOWAIT concurrency failed closed' AS result;
