-- ============================================================
-- 125_platform_message_media_exact_case_guard.sql
--
-- Close migration 121's same-canonical-identity attachment bypass. The
-- authenticated RPC must reject media unless its conversation carries the
-- exact non-null student case chosen by the caller.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION private.reserve_message_media_attachment(
  p_conversation_id UUID,
  p_communication_media_id UUID,
  p_student_case_id UUID,
  p_document_slot_id UUID,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  authority RECORD;
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  media_row RECORD;
  prior_intent platform_private.message_media_attachment_intents%ROWTYPE;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  input_sha256 TEXT;
  created_intent_id UUID := pg_catalog.gen_random_uuid();
  fixed_reason CONSTANT TEXT :=
    'WhatsApp message media attachment reserved for a case document slot';
BEGIN
  IF p_conversation_id IS NULL
    OR p_communication_media_id IS NULL
    OR p_student_case_id IS NULL
    OR p_document_slot_id IS NULL
    OR p_expected_version IS NULL
    OR p_expected_version < 1
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'Conversation, media, case, document slot and request are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO authority
  FROM platform.current_actor_authority();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Platform staff authority is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    authority.organization_id,
    p_student_case_id,
    'document.manage'
  );
  IF actor.actor_profile_id IS DISTINCT FROM authority.profile_id
    OR actor.actor_membership_id IS DISTINCT FROM authority.membership_id
    OR actor.actor_auth_user_id IS DISTINCT FROM authority.auth_user_id
    OR actor.actor_role IS DISTINCT FROM authority.platform_role
    OR actor.actor_role NOT IN ('admin', 'curator')
  THEN
    RAISE EXCEPTION 'Active case document authority is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2e_request(p_request_id);

  input_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'organization_id', authority.organization_id,
      'conversation_id', p_conversation_id,
      'communication_media_id', p_communication_media_id,
      'student_case_id', p_student_case_id,
      'document_slot_id', p_document_slot_id,
      'expected_version', p_expected_version::TEXT,
      'actor_profile_id', authority.profile_id,
      'actor_membership_id', authority.membership_id,
      'actor_auth_user_id', authority.auth_user_id,
      'actor_role', authority.platform_role,
      'actor_access_version', authority.platform_access_version,
      'operation', 'reserve_message_media_attachment'
    )::TEXT, 'UTF8')),
    'hex'
  );

  SELECT * INTO prior_intent
  FROM platform_private.message_media_attachment_intents AS intent
  WHERE intent.request_id = p_request_id;
  IF FOUND THEN
    IF prior_intent.input_sha256 IS DISTINCT FROM input_sha256
      OR prior_intent.organization_id IS DISTINCT FROM authority.organization_id
      OR prior_intent.actor_profile_id IS DISTINCT FROM authority.profile_id
      OR prior_intent.actor_membership_id IS DISTINCT FROM authority.membership_id
      OR prior_intent.actor_auth_user_id IS DISTINCT FROM authority.auth_user_id
      OR prior_intent.actor_access_version IS DISTINCT FROM authority.platform_access_version
    THEN
      RAISE EXCEPTION
        'request_id was already used with different attachment inputs or actor'
        USING ERRCODE = '23505';
    END IF;
    RETURN prior_intent.response;
  END IF;

  replay_shape := pg_catalog.jsonb_build_object(
    'organization_id', authority.organization_id,
    'conversation_id', p_conversation_id,
    'communication_media_id', p_communication_media_id,
    'student_case_id', p_student_case_id,
    'document_slot_id', p_document_slot_id,
    'expected_version', p_expected_version::TEXT,
    'actor_profile_id', authority.profile_id,
    'actor_membership_id', authority.membership_id,
    'actor_auth_user_id', authority.auth_user_id,
    'actor_access_version', authority.platform_access_version
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'document.media.attach.reserve',
    'document_slot',
    p_document_slot_id,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RAISE EXCEPTION 'Attachment audit exists without its durable intent'
      USING ERRCODE = '55000';
  END IF;

  SELECT student_case.* INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = authority.organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND OR target_case.state <> 'active' THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT slot.* INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = authority.organization_id
    AND slot.student_case_id = p_student_case_id
    AND slot.id = p_document_slot_id
    AND slot.removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR slot_row.status = 'approved' THEN
    RAISE EXCEPTION 'Document slot is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF slot_row.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'document_slot_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT
    media.id,
    media.mime_type,
    media.file_name,
    media.file_size_bytes,
    source_binding.id AS source_object_binding_id,
    source_binding.bucket_id AS source_bucket_id,
    source_binding.object_name AS source_object_name,
    archive_work.id AS source_archive_work_id,
    archive_effect.id AS source_archive_effect_id,
    archive_effect.sha256_hex
  INTO media_row
  FROM platform.communication_message_media AS media
  JOIN platform.communication_conversations AS conversation
    ON conversation.organization_id = media.organization_id
    AND conversation.id = media.conversation_id
  JOIN platform_private.waha_media_archive_work AS archive_work
    ON archive_work.organization_id = media.organization_id
    AND archive_work.media_id = media.id
    AND archive_work.state = 'archived'
  JOIN platform_private.waha_media_object_bindings AS source_binding
    ON source_binding.organization_id = archive_work.organization_id
    AND source_binding.id = archive_work.object_binding_id
    AND source_binding.media_id = media.id
  JOIN LATERAL (
    SELECT effect.*
    FROM platform_private.waha_media_archive_effects AS effect
    WHERE effect.organization_id = archive_work.organization_id
      AND effect.work_id = archive_work.id
      AND effect.outcome = 'archived'
    ORDER BY effect.created_at DESC, effect.id DESC
    LIMIT 1
  ) AS archive_effect ON TRUE
  WHERE media.organization_id = authority.organization_id
    AND media.id = p_communication_media_id
    AND media.conversation_id = p_conversation_id
    AND media.archival_status = 'archived'
    AND source_binding.bucket_id = 'platform-whatsapp-media'
    AND archive_effect.mime_type = media.mime_type
    AND archive_effect.file_name = media.file_name
    AND archive_effect.file_size_bytes = media.file_size_bytes
    AND archive_effect.sha256_hex IS NOT NULL
    AND conversation.student_case_id IS NOT NULL
    AND conversation.student_case_id = p_student_case_id
    AND COALESCE(
      private.platform_can_read_communication_full(
        media.organization_id,
        media.conversation_id
      ),
      FALSE
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message media is unavailable for this case'
      USING ERRCODE = '42501';
  END IF;

  IF media_row.mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png')
    OR media_row.file_name IS NULL
    OR pg_catalog.btrim(media_row.file_name) = ''
    OR pg_catalog.char_length(media_row.file_name) > 255
    OR pg_catalog.octet_length(media_row.file_name) > 1024
    OR media_row.file_name ~ '[[:cntrl:]/\\]'
    OR media_row.file_size_bytes IS NULL
    OR media_row.file_size_bytes NOT BETWEEN 1 AND 26214400
    OR media_row.sha256_hex !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'Message media type, name or size cannot be attached'
      USING ERRCODE = '22023';
  END IF;

  result := pg_catalog.jsonb_build_object(
    'organization_id', authority.organization_id,
    'conversation_id', p_conversation_id,
    'communication_media_id', p_communication_media_id,
    'student_case_id', p_student_case_id,
    'document_slot_id', p_document_slot_id,
    'slot_expected_version', p_expected_version::TEXT,
    'request_id', p_request_id,
    'attachment_intent_id', created_intent_id,
    'media_mime_type', media_row.mime_type,
    'media_file_name', media_row.file_name,
    'media_file_size_bytes', media_row.file_size_bytes,
    'media_sha256_hex', media_row.sha256_hex,
    'slot_status', slot_row.status
  );

  INSERT INTO platform_private.message_media_attachment_intents (
    id, request_id, input_sha256, organization_id, conversation_id,
    communication_media_id, student_case_id, document_slot_id,
    slot_expected_version,
    source_object_binding_id, source_archive_work_id, source_archive_effect_id,
    source_bucket_id, source_object_name, media_mime_type, media_file_name,
    media_file_size_bytes, media_sha256_hex, actor_profile_id,
    actor_membership_id, actor_auth_user_id, actor_role,
    actor_access_version, upload_reservation_request_id,
    upload_finalization_request_id, completion_request_id, response
  ) VALUES (
    created_intent_id, p_request_id, input_sha256,
    authority.organization_id, p_conversation_id, p_communication_media_id,
    p_student_case_id, p_document_slot_id, p_expected_version,
    media_row.source_object_binding_id, media_row.source_archive_work_id,
    media_row.source_archive_effect_id, media_row.source_bucket_id,
    media_row.source_object_name, media_row.mime_type, media_row.file_name,
    media_row.file_size_bytes, media_row.sha256_hex, authority.profile_id,
    authority.membership_id, authority.auth_user_id, authority.platform_role,
    authority.platform_access_version, pg_catalog.gen_random_uuid(),
    pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), result
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    authority.organization_id, 'user', authority.profile_id,
    'auth:' || authority.auth_user_id::TEXT,
    'document.media.attach.reserve', 'document_slot', p_document_slot_id,
    NULL,
    result || pg_catalog.jsonb_build_object(
      'actor_profile_id', authority.profile_id,
      'actor_membership_id', authority.membership_id,
      'actor_auth_user_id', authority.auth_user_id,
      'actor_access_version', authority.platform_access_version
    ),
    fixed_reason, p_request_id
  );

  RETURN result;
END
$$;

ALTER TABLE platform.communication_conversations
  ADD CONSTRAINT communication_conversations_exact_case_key
  UNIQUE (organization_id, id, student_case_id);

ALTER TABLE platform_private.message_media_attachment_intents
  ADD CONSTRAINT message_media_attachment_intents_exact_case_fkey
  FOREIGN KEY (organization_id, conversation_id, student_case_id)
  REFERENCES platform.communication_conversations(
    organization_id,
    id,
    student_case_id
  )
  ON UPDATE RESTRICT
  ON DELETE RESTRICT;

COMMENT ON CONSTRAINT message_media_attachment_intents_exact_case_fkey
  ON platform_private.message_media_attachment_intents IS
  'Preserves the exact non-null conversation student-case binding for every message-media attachment intent.';

COMMENT ON FUNCTION platform.reserve_message_media_attachment(
  UUID, UUID, UUID, UUID, BIGINT, UUID
) IS
  'SECURITY INVOKER staff entrypoint requiring the exact non-null conversation student case before creating an actor-bound media attachment intent.';

COMMIT;
