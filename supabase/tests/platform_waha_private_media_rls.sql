\set ON_ERROR_STOP on

-- P5D acceptance is entirely synthetic in the disposable authorization DB.
-- It performs no provider call, send, read-mark, session mutation or amoCRM
-- operation. P5B/P5C tests run first and provide real projected evidence rows.
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
    RAISE EXCEPTION 'P5D assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

SELECT
  membership.organization_id AS org_a_id,
  membership.id AS sales_a_membership_id,
  profile.id AS sales_a_profile_id,
  profile.access_version AS sales_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '4b500000-0000-4000-8000-000000000003'
\gset

SELECT membership.organization_id AS org_b_id
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000007'
\gset

SELECT jsonb_build_object(
  'role', 'authenticated',
  'sub', '4b500000-0000-4000-8000-000000000003',
  'platform_role', 'sales',
  'platform_access_version', :'sales_a_access_version'
)::TEXT AS sales_a_claims
\gset

SELECT pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'platform.claim_waha_media_archive(uuid,text,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.claim_waha_media_archive(uuid,text,integer,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.finish_waha_media_archive(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.finish_waha_media_archive(uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.grant_communication_media_download(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.grant_communication_media_download(uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.consume_communication_media_download_grant(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.consume_communication_media_download_grant(uuid,uuid)',
    'EXECUTE'
  ),
  'P5D RPC privileges are not least-privilege'
);

SELECT pg_temp.assert_true(
  platform_private.is_bound_waha_media_candidate(
    :'org_a_id',
    (
      SELECT binding.communication_message_id
      FROM platform_private.waha_message_bindings AS binding
      WHERE binding.organization_id = :'org_a_id'
        AND binding.raw_message_id = 'p5b-message-media'
    )
  )
  AND platform_private.is_bound_waha_media_candidate(
    :'org_a_id',
    (
      SELECT binding.communication_message_id
      FROM platform_private.waha_message_bindings AS binding
      WHERE binding.organization_id = :'org_a_id'
        AND binding.raw_message_id = 'p5c-history-media-1'
    )
  )
  AND NOT platform_private.is_bound_waha_media_candidate(
    :'org_a_id',
    (
      SELECT binding.communication_message_id
      FROM platform_private.waha_message_bindings AS binding
      WHERE binding.organization_id = :'org_a_id'
        AND binding.raw_message_id = 'p5c-history-outbound-1'
    )
  ),
  'candidate discovery did not require exact P5B/P5C media evidence'
);

-- Add one exact outbound P5C media fixture so direction is proven rather than
-- inferred. It reuses the completed synthetic P5C run and its direct chat.
SELECT
  observation.run_id AS outbound_run_id,
  observation.normalized_chat_id AS outbound_chat_id,
  message.conversation_id AS outbound_conversation_id,
  message.sender_participant_id AS outbound_sender_id,
  message.language::TEXT AS outbound_language
FROM platform_private.waha_history_message_observations AS observation
JOIN platform.communication_messages AS message
  ON message.organization_id = observation.organization_id
  AND message.id = observation.communication_message_id
WHERE observation.organization_id = :'org_a_id'
  AND observation.raw_message_id = 'p5c-history-outbound-1'
\gset

SELECT jsonb_build_object(
  'provenance', 'api_history',
  'read_only', TRUE,
  'session', 'evo-inbox',
  'chat_id', :'outbound_chat_id',
  'message', jsonb_build_object(
    'raw_message_id', 'p5d-history-outbound-media',
    'direction', 'outbound',
    'occurred_at', '2026-08-10T09:00:00+06:00',
    'body_text', '',
    'has_media', TRUE
  )
)::TEXT AS outbound_raw_envelope
\gset

SELECT encode(
  sha256(convert_to(:'outbound_raw_envelope'::JSONB::TEXT, 'UTF8')),
  'hex'
) AS outbound_payload_sha256
\gset

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256,
  request_id
) VALUES (
  '46200000-0000-4000-8000-000000000001', :'org_a_id', 'waha',
  'waha:evo-inbox', NULL, NULL, 'api-history:p5d-outbound-media',
  'evo-inbox', 'p5d-history-outbound-media', 'history.message',
  '2026-08-10T09:00:00+06:00', 'missing',
  :'outbound_raw_envelope'::JSONB,
  '{"provenance":"api_history","webhook_verified":false,"read_only":true}',
  'api-history-read:p5d-test', :'outbound_payload_sha256',
  '46200000-0000-4000-8000-000000000002'
);

INSERT INTO platform.communication_messages (
  id, organization_id, conversation_id, student_case_id,
  sender_participant_id, direction, body_text, language, student_visible,
  message_identity_source, waha_session_name, waha_message_id,
  kommo_account_id, kommo_conversation_id, kommo_message_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  source_webhook_event_id, manual_send_authorization_id, created_at
)
SELECT
  '46200000-0000-4000-8000-000000000003',
  original.organization_id,
  original.conversation_id,
  original.student_case_id,
  original.sender_participant_id,
  'outbound',
  '[Historical media requires review]',
  original.language,
  FALSE,
  'private_waha_history_binding',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '46200000-0000-4000-8000-000000000001',
  NULL,
  '2026-08-10T09:00:00+06:00'
FROM platform_private.waha_history_message_observations AS observation
JOIN platform.communication_messages AS original
  ON original.organization_id = observation.organization_id
  AND original.id = observation.communication_message_id
WHERE observation.organization_id = :'org_a_id'
  AND observation.raw_message_id = 'p5c-history-outbound-1';

INSERT INTO platform_private.waha_message_bindings (
  organization_id, waha_session_name, raw_message_id,
  communication_message_id, source_webhook_event_id
) VALUES (
  :'org_a_id', 'evo-inbox', 'p5d-history-outbound-media',
  '46200000-0000-4000-8000-000000000003',
  '46200000-0000-4000-8000-000000000001'
);

INSERT INTO platform_private.waha_history_message_observations (
  organization_id, run_id, waha_session_name, normalized_chat_id,
  raw_message_id, direction, provider_occurred_at, source_event_id,
  communication_message_id, payload_sha256, page_request_id
) VALUES (
  :'org_a_id', :'outbound_run_id', 'evo-inbox', :'outbound_chat_id',
  'p5d-history-outbound-media', 'outbound',
  '2026-08-10T09:00:00+06:00',
  '46200000-0000-4000-8000-000000000001',
  '46200000-0000-4000-8000-000000000003',
  :'outbound_payload_sha256',
  '46200000-0000-4000-8000-000000000004'
);

INSERT INTO platform_private.waha_history_projection_effects (
  organization_id, run_id, source_event_id, communication_message_id,
  disposition, payload_sha256, page_request_id
) VALUES (
  :'org_a_id', :'outbound_run_id',
  '46200000-0000-4000-8000-000000000001',
  '46200000-0000-4000-8000-000000000003', 'projected',
  :'outbound_payload_sha256',
  '46200000-0000-4000-8000-000000000004'
);

SELECT pg_temp.assert_true(
  platform_private.is_bound_waha_media_candidate(
    :'org_a_id',
    '46200000-0000-4000-8000-000000000003'
  ),
  'outbound P5C media projection was not admitted'
);

SET request.jwt.claims = '{"role":"authenticated","sub":"4b500000-0000-4000-8000-000000000003"}';
SET ROLE authenticated;
SAVEPOINT expect_browser_claim_denied;
\set ON_ERROR_STOP off
SELECT platform.claim_waha_media_archive(
  :'org_a_id', 'browser', 60,
  '46200000-0000-4000-8000-000000000010'
);
\set browser_claim_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_browser_claim_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_browser_claim_denied;
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  :'browser_claim_state' = '42501',
  'authenticated browser could claim service media work'
);

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.claim_waha_media_archive(
  :'org_a_id', 'p5d-test-worker', 120,
  '46200000-0000-4000-8000-000000000011'
)::TEXT AS first_claim
\gset
SELECT platform.claim_waha_media_archive(
  :'org_a_id', 'p5d-test-worker', 120,
  '46200000-0000-4000-8000-000000000011'
)::TEXT AS first_claim_replay
\gset

SAVEPOINT expect_claim_request_conflict;
\set ON_ERROR_STOP off
SELECT platform.claim_waha_media_archive(
  :'org_a_id', 'different-worker', 120,
  '46200000-0000-4000-8000-000000000011'
);
\set claim_request_conflict_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_claim_request_conflict;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_claim_request_conflict;
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  :'first_claim'::JSONB = :'first_claim_replay'::JSONB
  AND (:'first_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND (:'first_claim'::JSONB ->> 'direction') = 'inbound'
  AND (:'first_claim'::JSONB ->> 'raw_chat_id') ~ '^[0-9]+@c[.]us$'
  AND (:'first_claim'::JSONB ->> 'object_name') ~
    '^[0-9a-f]{2}/[0-9a-f]{62}$'
  AND :'claim_request_conflict_state' = '23505',
  'claim direction, opaque target or replay contract drifted'
);

-- Archived finish fails without complete exact Storage attestation.
SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SAVEPOINT expect_missing_storage_object;
\set ON_ERROR_STOP off
SELECT platform.finish_waha_media_archive(
  :'org_a_id',
  (:'first_claim'::JSONB ->> 'work_id')::UUID,
  (:'first_claim'::JSONB ->> 'attempt_id')::UUID,
  'archived', NULL, 'image', 'image/jpeg', 'photo.jpg', 4,
  repeat('a', 64), '46200000-0000-4000-8000-000000000012'
);
\set missing_object_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_missing_storage_object;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_missing_storage_object;
RESET ROLE;
RESET request.jwt.claims;

INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) VALUES (
  'platform-whatsapp-media', 'platform-whatsapp-media', FALSE, 52428800,
  ARRAY[
    'application/octet-stream', 'application/pdf', 'image/gif',
    'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/ogg',
    'audio/wav', 'video/mp4'
  ]
) ON CONFLICT (id) DO NOTHING;

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    WHERE bucket.id = 'platform-whatsapp-media'
      AND bucket.name = 'platform-whatsapp-media'
      AND bucket.public IS FALSE
      AND bucket.file_size_limit = 52428800
      AND bucket.allowed_mime_types @> ARRAY[
        'application/octet-stream', 'application/pdf', 'image/gif',
        'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/ogg',
        'audio/wav', 'video/mp4'
      ]::TEXT[]
      AND cardinality(bucket.allowed_mime_types) = 10
  ),
  'fixed private media bucket contract drifted'
);

INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES (
  'platform-whatsapp-media',
  :'first_claim'::JSONB ->> 'object_name',
  jsonb_build_object(
    'size', 5,
    'mimetype', 'image/jpeg',
    'metadata', jsonb_build_object('sha256', repeat('a', 64))
  )
);

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SAVEPOINT expect_wrong_storage_size;
\set ON_ERROR_STOP off
SELECT platform.finish_waha_media_archive(
  :'org_a_id',
  (:'first_claim'::JSONB ->> 'work_id')::UUID,
  (:'first_claim'::JSONB ->> 'attempt_id')::UUID,
  'archived', NULL, 'image', 'image/jpeg', 'photo.jpg', 4,
  repeat('a', 64), '46200000-0000-4000-8000-000000000032'
);
\set wrong_size_attestation_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_wrong_storage_size;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_wrong_storage_size;
RESET ROLE;
RESET request.jwt.claims;

UPDATE storage.objects
SET metadata = jsonb_build_object(
  'size', 4,
  'mimetype', 'image/png',
  'metadata', jsonb_build_object('sha256', repeat('a', 64))
)
WHERE bucket_id = 'platform-whatsapp-media'
  AND name = (:'first_claim'::JSONB ->> 'object_name');

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SAVEPOINT expect_wrong_storage_mime;
\set ON_ERROR_STOP off
SELECT platform.finish_waha_media_archive(
  :'org_a_id',
  (:'first_claim'::JSONB ->> 'work_id')::UUID,
  (:'first_claim'::JSONB ->> 'attempt_id')::UUID,
  'archived', NULL, 'image', 'image/jpeg', 'photo.jpg', 4,
  repeat('a', 64), '46200000-0000-4000-8000-000000000030'
);
\set wrong_mime_attestation_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_wrong_storage_mime;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_wrong_storage_mime;
RESET ROLE;
RESET request.jwt.claims;

UPDATE storage.objects
SET metadata = jsonb_build_object('size', 4, 'mimetype', 'image/jpeg')
WHERE bucket_id = 'platform-whatsapp-media'
  AND name = (:'first_claim'::JSONB ->> 'object_name');

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SAVEPOINT expect_missing_storage_sha;
\set ON_ERROR_STOP off
SELECT platform.finish_waha_media_archive(
  :'org_a_id',
  (:'first_claim'::JSONB ->> 'work_id')::UUID,
  (:'first_claim'::JSONB ->> 'attempt_id')::UUID,
  'archived', NULL, 'image', 'image/jpeg', 'photo.jpg', 4,
  repeat('a', 64), '46200000-0000-4000-8000-000000000031'
);
\set missing_sha_attestation_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_missing_storage_sha;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_missing_storage_sha;
RESET ROLE;
RESET request.jwt.claims;

-- Real Supabase Storage keeps upload metadata in storage.objects.user_metadata.
-- The lightweight PostgreSQL authorization bootstrap predates that column, so
-- exercise the real shape when it exists and the bootstrap-compatible nested
-- shape otherwise. finish_waha_media_archive deliberately supports both.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'objects'
      AND column_name = 'user_metadata'
  ) THEN
    EXECUTE $update$
      UPDATE storage.objects
      SET
        metadata = jsonb_build_object(
          'size', 4,
          'mimetype', 'image/jpeg'
        ),
        user_metadata = jsonb_build_object('sha256', repeat('a', 64))
      WHERE bucket_id = 'platform-whatsapp-media'
    $update$;
  ELSE
    UPDATE storage.objects
    SET metadata = jsonb_build_object(
      'size', 4,
      'mimetype', 'image/jpeg',
      'metadata', jsonb_build_object('sha256', repeat('a', 64))
    )
    WHERE bucket_id = 'platform-whatsapp-media';
  END IF;
END
$$;

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.finish_waha_media_archive(
  :'org_a_id',
  (:'first_claim'::JSONB ->> 'work_id')::UUID,
  (:'first_claim'::JSONB ->> 'attempt_id')::UUID,
  'archived', NULL, 'image', 'image/jpeg', 'photo.jpg', 4,
  repeat('a', 64), '46200000-0000-4000-8000-000000000013'
)::TEXT AS archived_finish
\gset
SELECT platform.finish_waha_media_archive(
  :'org_a_id',
  (:'first_claim'::JSONB ->> 'work_id')::UUID,
  (:'first_claim'::JSONB ->> 'attempt_id')::UUID,
  'archived', NULL, 'image', 'image/jpeg', 'photo.jpg', 4,
  repeat('a', 64), '46200000-0000-4000-8000-000000000013'
)::TEXT AS archived_finish_replay
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  :'missing_object_state' = '55000'
  AND :'wrong_size_attestation_state' = '55000'
  AND :'wrong_mime_attestation_state' = '55000'
  AND :'missing_sha_attestation_state' = '55000'
  AND :'archived_finish'::JSONB = :'archived_finish_replay'::JSONB
  AND (:'archived_finish'::JSONB ->> 'state') = 'archived',
  'Storage object attestation or finish replay did not fail closed'
);

-- Staff sees only bounded safe descriptors; raw/object/checksum data remains
-- absent. Other tenants cannot see the public row and no browser can list the
-- private bucket through Storage RLS.
SELECT (:'first_claim'::JSONB ->> 'communication_message_id')::UUID
  AS first_message_id,
  (:'first_claim'::JSONB ->> 'media_id')::UUID AS first_media_id
\gset
SELECT conversation_id AS first_conversation_id
FROM platform.communication_messages
WHERE organization_id = :'org_a_id'
  AND id = :'first_message_id'
\gset

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT COALESCE(jsonb_agg(row_to_json(message_row)), '[]'::JSONB)::TEXT
  AS staff_messages
FROM platform.staff_conversation_messages(
  :'org_a_id', :'first_conversation_id'
) AS message_row
\gset
SELECT count(*)::TEXT AS browser_storage_count
FROM storage.objects
WHERE bucket_id = 'platform-whatsapp-media'
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  :'browser_storage_count'::INTEGER = 0
  AND position('platform-whatsapp-media' IN :'staff_messages') = 0
  AND position((:'first_claim'::JSONB ->> 'object_name') IN :'staff_messages') = 0
  AND position((:'first_claim'::JSONB ->> 'raw_chat_id') IN :'staff_messages') = 0
  AND position((:'first_claim'::JSONB ->> 'raw_message_id') IN :'staff_messages') = 0
  AND position(repeat('a', 64) IN :'staff_messages') = 0
  AND position('"media_kind": "image"' IN :'staff_messages') > 0
  AND position('"archival_status": "archived"' IN :'staff_messages') > 0,
  'staff media RPC leaked private provider or Storage identity'
);

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT platform.grant_communication_media_download(
  :'org_a_id', :'first_media_id',
  '46200000-0000-4000-8000-000000000014'
)::TEXT AS media_grant
\gset
SELECT platform.grant_communication_media_download(
  :'org_a_id', :'first_media_id',
  '46200000-0000-4000-8000-000000000014'
)::TEXT AS media_grant_replay
\gset
SAVEPOINT expect_cross_org_grant_denied;
\set ON_ERROR_STOP off
SELECT platform.grant_communication_media_download(
  :'org_b_id', :'first_media_id',
  '46200000-0000-4000-8000-000000000015'
);
\set cross_org_grant_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_cross_org_grant_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_cross_org_grant_denied;
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  :'media_grant'::JSONB = :'media_grant_replay'::JSONB
  AND (:'media_grant'::JSONB -> 'signed_url') = 'null'::JSONB
  AND (:'media_grant'::JSONB ->>
    'storage_api_service_sign_required')::BOOLEAN
  AND position('object_name' IN :'media_grant') = 0
  AND :'cross_org_grant_state' = '42501',
  'download grant exposed object identity or crossed tenant authority'
);

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.consume_communication_media_download_grant(
  (:'media_grant'::JSONB ->> 'media_download_grant_id')::UUID,
  '46200000-0000-4000-8000-000000000016'
)::TEXT AS media_consumption
\gset
SAVEPOINT expect_same_request_consumption_denied;
\set ON_ERROR_STOP off
SELECT platform.consume_communication_media_download_grant(
  (:'media_grant'::JSONB ->> 'media_download_grant_id')::UUID,
  '46200000-0000-4000-8000-000000000016'
)::TEXT;
\set same_request_consumption_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_same_request_consumption_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_same_request_consumption_denied;
SAVEPOINT expect_second_consumption_denied;
\set ON_ERROR_STOP off
SELECT platform.consume_communication_media_download_grant(
  (:'media_grant'::JSONB ->> 'media_download_grant_id')::UUID,
  '46200000-0000-4000-8000-000000000017'
);
\set second_consumption_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_second_consumption_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_second_consumption_denied;
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  (:'media_consumption'::JSONB ->> 'bucket_id') =
    'platform-whatsapp-media'
  AND (:'media_consumption'::JSONB ->> 'object_name') =
    (:'first_claim'::JSONB ->> 'object_name')
  AND (:'media_consumption'::JSONB ->>
    'max_signed_url_expires_in_seconds')::INTEGER BETWEEN 1 AND 60
  AND (:'media_consumption'::JSONB -> 'signed_url') = 'null'::JSONB
  AND :'same_request_consumption_state' = '42501'
  AND :'second_consumption_state' = '42501',
  'one-time service consumption replay or 60-second ceiling drifted'
);

-- A grant snapshots the caller only for audit. Consumption must re-check the
-- current access_version and assignment rather than trusting that snapshot.
SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT platform.grant_communication_media_download(
  :'org_a_id', :'first_media_id',
  '46200000-0000-4000-8000-000000000021'
)::TEXT AS stale_media_grant
\gset
RESET ROLE;
RESET request.jwt.claims;

UPDATE platform.profiles
SET access_version = access_version + 1
WHERE id = :'sales_a_profile_id';

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SAVEPOINT expect_stale_authority_denied;
\set ON_ERROR_STOP off
SELECT platform.consume_communication_media_download_grant(
  (:'stale_media_grant'::JSONB ->> 'media_download_grant_id')::UUID,
  '46200000-0000-4000-8000-000000000022'
);
\set stale_authority_consume_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_stale_authority_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_stale_authority_denied;
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  :'stale_authority_consume_state' = '42501',
  'download consumption trusted a stale authorization snapshot'
);

-- Clear the remaining inbound candidate, then prove outbound history direction
-- is returned and terminal finish contains no archived metadata.
SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.claim_waha_media_archive(
  :'org_a_id', 'p5d-test-worker', 120,
  '46200000-0000-4000-8000-000000000018'
)::TEXT AS second_claim
\gset
SELECT platform.finish_waha_media_archive(
  :'org_a_id',
  (:'second_claim'::JSONB ->> 'work_id')::UUID,
  (:'second_claim'::JSONB ->> 'attempt_id')::UUID,
  'terminal_error', 'synthetic_terminal', NULL, NULL, NULL, NULL, NULL,
  '46200000-0000-4000-8000-000000000019'
);
SELECT platform.claim_waha_media_archive(
  :'org_a_id', 'p5d-test-worker', 120,
  '46200000-0000-4000-8000-000000000020'
)::TEXT AS outbound_claim
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  (:'outbound_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND (:'outbound_claim'::JSONB ->> 'direction') = 'outbound'
  AND (:'outbound_claim'::JSONB ->> 'raw_message_id') =
    'p5d-history-outbound-media',
  'outbound P5C media claim lost immutable direction'
);

-- Browser/private table denial and append-only evidence mutation guard.
SAVEPOINT expect_append_only_guard;
\set ON_ERROR_STOP off
UPDATE platform_private.waha_media_archive_effects
SET error_code = 'tampered'
WHERE request_id = '46200000-0000-4000-8000-000000000013';
\set append_only_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_append_only_guard;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_append_only_guard;

SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    'authenticated',
    'platform_private.waha_media_object_bindings',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.waha_media_object_bindings',
    'SELECT'
  )
  AND :'append_only_state' = '55000',
  'private binding RLS or append-only effect guard failed'
);

ROLLBACK;

SELECT 'platform WAHA private media RLS checks passed' AS result;
