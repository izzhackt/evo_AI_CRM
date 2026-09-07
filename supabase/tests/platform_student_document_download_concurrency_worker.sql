\set ON_ERROR_STOP on

BEGIN;

\if :e5c_hold_lock
-- Change only the mutable slot pointer and keep that row locked. Deliberately do
-- not lock the case or original version: the consume RPC must reach its slot
-- NOWAIT check instead of blocking earlier in the canonical lock order.
DO $$
DECLARE
  changed_rows INTEGER;
BEGIN
  UPDATE platform.document_slots AS slot
  SET
    status = 'submitted',
    current_version_id = replacement.id,
    current_version_no = replacement.version_no
  FROM platform_private.document_download_grants AS grant_row
  JOIN platform.document_versions AS replacement
    ON replacement.organization_id = grant_row.organization_id
    AND replacement.student_case_id = grant_row.student_case_id
    AND replacement.document_slot_id = grant_row.document_slot_id
    AND replacement.id = '58012890-0000-4000-8000-000000000004'
  WHERE grant_row.request_id =
      '58012890-0000-4000-8000-000000000003'
    AND slot.organization_id = grant_row.organization_id
    AND slot.student_case_id = grant_row.student_case_id
    AND slot.id = grant_row.document_slot_id
    AND slot.current_version_id = grant_row.document_version_id;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION
      'E5C lock worker expected one current slot, changed %', changed_rows;
  END IF;
END
$$;

\echo E5C_SLOT_LOCK_HELD=1
SELECT pg_sleep(:'e5c_hold_seconds'::DOUBLE PRECISION);
\else
CREATE OR REPLACE FUNCTION pg_temp.e5c_capture_student_consume(
  p_document_download_grant_id UUID,
  p_request_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.consume_student_portal_document_download_grant(
    p_document_download_grant_id,
    p_request_id
  );
  RETURN '00000';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

REVOKE ALL ON FUNCTION pg_temp.e5c_capture_student_consume(UUID, UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.e5c_capture_student_consume(UUID, UUID)
  TO service_role;

SELECT grant_row.id AS e5c_grant_id
FROM platform_private.document_download_grants AS grant_row
WHERE grant_row.request_id = '58012890-0000-4000-8000-000000000003'
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.e5c_capture_student_consume(
  :'e5c_grant_id',
  '58012890-0000-4000-8000-000000000005'
) AS e5c_outcome
\gset
RESET ROLE;
RESET request.jwt.claims;
\endif

COMMIT;

\if :e5c_hold_lock
\echo E5C_WRITER=ok
\else
\echo E5C_OUTCOME=:e5c_outcome
\endif
