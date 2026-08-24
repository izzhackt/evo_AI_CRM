\set ON_ERROR_STOP on

DO $assert$
DECLARE
  resolved_client_id UUID;
BEGIN
  SELECT client.id
  INTO STRICT resolved_client_id
  FROM platform.clients AS client
  WHERE client.organization_id =
      '84000000-0000-4000-8000-000000009001'
    AND client.normalized_email = 'concurrent@example.invalid'
    AND client.normalized_phone = '+996700123456'
    AND client.lifecycle_state = 'active';

  IF (
    SELECT count(*)
    FROM platform.clients AS client
    WHERE client.organization_id =
        '84000000-0000-4000-8000-000000009001'
      AND client.normalized_email = 'concurrent@example.invalid'
      AND client.normalized_phone = '+996700123456'
  ) <> 1 THEN
    RAISE EXCEPTION 'Concurrent client requests created multiple clients';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.external_identifiers AS external
    WHERE external.organization_id =
        '84000000-0000-4000-8000-000000009001'
      AND external.source_system = 'evo'
      AND external.external_object_type = 'client'
      AND external.external_identifier = 'u2-concurrent-client'
      AND external.client_id = resolved_client_id
  ) <> 1 THEN
    RAISE EXCEPTION 'Concurrent external identity did not converge once';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.subject_provenance AS evidence
    WHERE evidence.organization_id =
        '84000000-0000-4000-8000-000000009001'
      AND evidence.client_id = resolved_client_id
      AND evidence.source_system = 'evo'
      AND evidence.evidence_type = 'concurrency_observation'
      AND evidence.source_ref IN ('worker-a', 'worker-b')
  ) <> 2 THEN
    RAISE EXCEPTION 'Concurrent client requests lost provenance evidence';
  END IF;
END
$assert$;

SELECT 'platform migration 084 concurrency converged' AS result;
