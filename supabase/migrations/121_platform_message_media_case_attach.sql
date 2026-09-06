-- ============================================================
-- 121_platform_message_media_case_attach.sql
--
-- Copy one archived WhatsApp message-media object into the canonical private
-- case-document pipeline. The browser authorizes only an intent. The trusted
-- server then reserves and finalizes the exact upload through migration 116;
-- bytes, private object names and service credentials never cross the browser.
-- ============================================================

BEGIN;

CREATE TABLE platform_private.message_media_attachment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  communication_media_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  source_object_binding_id UUID NOT NULL,
  source_archive_work_id UUID NOT NULL,
  source_archive_effect_id UUID NOT NULL,
  source_bucket_id TEXT NOT NULL CHECK (
    source_bucket_id = 'platform-whatsapp-media'
  ),
  source_object_name TEXT NOT NULL CHECK (
    source_object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
  ),
  media_mime_type TEXT NOT NULL CHECK (
    media_mime_type IN ('application/pdf', 'image/jpeg', 'image/png')
  ),
  media_file_name TEXT NOT NULL CHECK (
    btrim(media_file_name) <> ''
    AND char_length(media_file_name) <= 255
    AND octet_length(media_file_name) <= 1024
    AND media_file_name !~ '[[:cntrl:]/\\]'
  ),
  media_file_size_bytes BIGINT NOT NULL CHECK (
    media_file_size_bytes BETWEEN 1 AND 26214400
  ),
  media_sha256_hex TEXT NOT NULL CHECK (
    media_sha256_hex ~ '^[0-9a-f]{64}$'
  ),
  actor_profile_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  actor_auth_user_id UUID NOT NULL,
  actor_role platform.business_role NOT NULL CHECK (
    actor_role IN ('admin', 'curator')
  ),
  actor_access_version BIGINT NOT NULL CHECK (actor_access_version > 0),
  upload_reservation_request_id UUID NOT NULL UNIQUE,
  upload_finalization_request_id UUID NOT NULL UNIQUE,
  completion_request_id UUID NOT NULL UNIQUE,
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT message_media_attachment_intents_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT message_media_attachment_intents_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_intents_media_fkey
    FOREIGN KEY (organization_id, communication_media_id)
    REFERENCES platform.communication_message_media(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_intents_slot_fkey
    FOREIGN KEY (organization_id, document_slot_id, student_case_id)
    REFERENCES platform.document_slots(organization_id, id, student_case_id)
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_intents_source_binding_fkey
    FOREIGN KEY (organization_id, source_object_binding_id)
    REFERENCES platform_private.waha_media_object_bindings(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_intents_source_work_fkey
    FOREIGN KEY (organization_id, source_archive_work_id)
    REFERENCES platform_private.waha_media_archive_work(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_intents_source_effect_fkey
    FOREIGN KEY (organization_id, source_archive_effect_id)
    REFERENCES platform_private.waha_media_archive_effects(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_intents_profile_fkey
    FOREIGN KEY (actor_profile_id)
    REFERENCES platform.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_intents_membership_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX message_media_attachment_intents_slot_idx
  ON platform_private.message_media_attachment_intents (
    organization_id,
    student_case_id,
    document_slot_id,
    created_at DESC
  );

CREATE INDEX message_media_attachment_intents_media_idx
  ON platform_private.message_media_attachment_intents (
    organization_id,
    communication_media_id,
    created_at DESC
  );

-- This append-only row is the causal edge that a hash comparison cannot
-- provide. A document reservation/version may satisfy exactly one intent.
CREATE TABLE platform_private.message_media_attachment_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  organization_id UUID NOT NULL,
  attachment_intent_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  upload_reservation_id UUID NOT NULL UNIQUE,
  storage_binding_id UUID NOT NULL UNIQUE,
  bucket_id TEXT NOT NULL CHECK (bucket_id = 'platform-documents'),
  object_name TEXT NOT NULL CHECK (
    object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
  ),
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT message_media_attachment_uploads_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT message_media_attachment_uploads_intent_key
    UNIQUE (organization_id, attachment_intent_id),
  CONSTRAINT message_media_attachment_uploads_version_key
    UNIQUE (organization_id, document_version_id),
  CONSTRAINT message_media_attachment_uploads_intent_fkey
    FOREIGN KEY (organization_id, attachment_intent_id)
    REFERENCES platform_private.message_media_attachment_intents(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_uploads_reservation_fkey
    FOREIGN KEY (
      organization_id,
      upload_reservation_id,
      document_version_id,
      bucket_id,
      object_name
    )
    REFERENCES platform_private.document_upload_reservations(
      organization_id,
      id,
      document_version_id,
      bucket_id,
      object_name
    )
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_uploads_binding_fkey
    FOREIGN KEY (storage_binding_id)
    REFERENCES platform_private.document_storage_bindings(id)
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.message_media_attachment_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  organization_id UUID NOT NULL,
  attachment_intent_id UUID NOT NULL,
  attachment_upload_id UUID NOT NULL UNIQUE,
  document_version_id UUID NOT NULL,
  upload_reservation_id UUID NOT NULL UNIQUE,
  upload_finalization_id UUID NOT NULL UNIQUE,
  malware_scan_attestation_id UUID NOT NULL UNIQUE,
  sha256_hex TEXT NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT message_media_attachment_completions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT message_media_attachment_completions_intent_key
    UNIQUE (organization_id, attachment_intent_id),
  CONSTRAINT message_media_attachment_completions_version_key
    UNIQUE (organization_id, document_version_id),
  CONSTRAINT message_media_attachment_completions_intent_fkey
    FOREIGN KEY (organization_id, attachment_intent_id)
    REFERENCES platform_private.message_media_attachment_intents(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_completions_upload_fkey
    FOREIGN KEY (organization_id, attachment_upload_id)
    REFERENCES platform_private.message_media_attachment_uploads(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_completions_reservation_fkey
    FOREIGN KEY (upload_reservation_id)
    REFERENCES platform_private.document_upload_reservations(id)
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_completions_finalization_fkey
    FOREIGN KEY (upload_finalization_id)
    REFERENCES platform_private.document_upload_finalizations(id)
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_completions_scan_fkey
    FOREIGN KEY (malware_scan_attestation_id)
    REFERENCES platform_private.document_malware_scan_attestations(id)
    ON DELETE RESTRICT,
  CONSTRAINT message_media_attachment_completions_version_fkey
    FOREIGN KEY (organization_id, document_version_id, sha256_hex)
    REFERENCES platform.document_versions(organization_id, id, sha256_hex)
    ON DELETE RESTRICT
);

ALTER TABLE platform_private.message_media_attachment_intents
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.message_media_attachment_intents
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.message_media_attachment_uploads
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.message_media_attachment_uploads
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.message_media_attachment_completions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.message_media_attachment_completions
  FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON platform_private.message_media_attachment_intents
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES
  ON platform_private.message_media_attachment_uploads
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES
  ON platform_private.message_media_attachment_completions
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER message_media_attachment_intents_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.message_media_attachment_intents
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER message_media_attachment_intents_no_truncate
  BEFORE TRUNCATE
  ON platform_private.message_media_attachment_intents
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER message_media_attachment_uploads_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.message_media_attachment_uploads
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER message_media_attachment_uploads_no_truncate
  BEFORE TRUNCATE
  ON platform_private.message_media_attachment_uploads
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER message_media_attachment_completions_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.message_media_attachment_completions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER message_media_attachment_completions_no_truncate
  BEFORE TRUNCATE
  ON platform_private.message_media_attachment_completions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_message_media_attach;

CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_message_media_attach()
      || ARRAY[
        'document.media.attach.reserve',
        'document.media.attach.complete'
      ]::TEXT[]
  ) AS allowed(action)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_message_media_attach()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Service stages revalidate the exact actor captured by the authenticated
-- intent. This intentionally does not trust service-call actor parameters.
CREATE FUNCTION private.message_media_attachment_actor_is_current(
  p_attachment_intent_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_private.message_media_attachment_intents AS intent
    JOIN platform.profiles AS profile
      ON profile.id = intent.actor_profile_id
      AND profile.auth_user_id = intent.actor_auth_user_id
      AND profile.access_version = intent.actor_access_version
      AND profile.status = 'active'
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = intent.organization_id
      AND membership.id = intent.actor_membership_id
      AND membership.profile_id = profile.id
      AND membership."current_role" = intent.actor_role
      AND membership.status = 'active'
    JOIN platform.organizations AS organization
      ON organization.id = intent.organization_id
      AND organization.status = 'active'
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
      AND bundle.status = 'published'
    JOIN platform.student_cases AS student_case
      ON student_case.organization_id = intent.organization_id
      AND student_case.id = intent.student_case_id
      AND student_case.state = 'active'
    WHERE intent.id = p_attachment_intent_id
      AND intent.actor_role IN ('admin', 'curator')
      AND EXISTS (
        SELECT 1
        FROM platform.role_bundle_permissions AS permission
        WHERE permission.bundle_id = bundle.id
          AND permission.bundle_role = bundle.role
          AND permission.permission_key = 'document.manage'
      )
      AND EXISTS (
        SELECT 1
        FROM platform.role_bundle_permissions AS permission
        WHERE permission.bundle_id = bundle.id
          AND permission.bundle_role = bundle.role
          AND permission.permission_key = 'communication.read.full'
      )
      AND (
        (
          intent.actor_role = 'admin'
          AND EXISTS (
            SELECT 1
            FROM platform.record_scopes AS scope
            JOIN platform.membership_scope_assignments AS assignment
              ON assignment.organization_id = scope.organization_id
              AND assignment.membership_id = intent.actor_membership_id
              AND assignment.scope_id = scope.id
              AND assignment.scope_version = scope.scope_version
            WHERE scope.organization_id = intent.organization_id
              AND scope.scope_kind = 'organization'
              AND scope.scope_key = intent.organization_id
              AND scope.is_active
              AND assignment.granted
              AND NOT EXISTS (
                SELECT 1
                FROM platform.membership_scope_assignments AS later_assignment
                WHERE later_assignment.organization_id = assignment.organization_id
                  AND later_assignment.membership_id = assignment.membership_id
                  AND later_assignment.scope_id = assignment.scope_id
                  AND later_assignment.assignment_version > assignment.assignment_version
              )
          )
        )
        OR (
          intent.actor_role = 'curator'
          AND student_case.current_curator_membership_id = intent.actor_membership_id
          AND EXISTS (
            SELECT 1
            FROM platform.record_scopes AS scope
            JOIN platform.membership_scope_assignments AS assignment
              ON assignment.organization_id = scope.organization_id
              AND assignment.membership_id = intent.actor_membership_id
              AND assignment.scope_id = scope.id
              AND assignment.scope_version = scope.scope_version
            WHERE scope.organization_id = intent.organization_id
              AND scope.scope_kind = 'student_case'
              AND scope.scope_key = intent.student_case_id
              AND scope.is_active
              AND assignment.granted
              AND NOT EXISTS (
                SELECT 1
                FROM platform.membership_scope_assignments AS later_assignment
                WHERE later_assignment.organization_id = assignment.organization_id
                  AND later_assignment.membership_id = assignment.membership_id
                  AND later_assignment.scope_id = assignment.scope_id
                  AND later_assignment.assignment_version > assignment.assignment_version
              )
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.message_media_attachment_actor_is_current(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Authenticated staff body. Organization and actor identity come only from the
-- verified current authority; the exposed wrapper has no authority parameter.
CREATE FUNCTION private.reserve_message_media_attachment(
  p_conversation_id UUID,
  p_communication_media_id UUID,
  p_student_case_id UUID,
  p_document_slot_id UUID,
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
    AND (
      conversation.student_case_id = p_student_case_id
      OR (
        conversation.canonical_lead_id IS NOT NULL
        AND conversation.canonical_lead_id = target_case.canonical_lead_id
      )
      OR (
        conversation.canonical_client_id IS NOT NULL
        AND conversation.canonical_client_id = target_case.canonical_client_id
      )
    )
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
    source_object_binding_id, source_archive_work_id, source_archive_effect_id,
    source_bucket_id, source_object_name, media_mime_type, media_file_name,
    media_file_size_bytes, media_sha256_hex, actor_profile_id,
    actor_membership_id, actor_auth_user_id, actor_role,
    actor_access_version, upload_reservation_request_id,
    upload_finalization_request_id, completion_request_id, response
  ) VALUES (
    created_intent_id, p_request_id, input_sha256,
    authority.organization_id, p_conversation_id, p_communication_media_id,
    p_student_case_id, p_document_slot_id,
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

-- Service-only body. It derives organization, actor, filename, slot, hash and
-- the idempotency request from the immutable intent, then calls migration 116
-- and records the exact reservation/version edge in the same transaction.
CREATE FUNCTION private.reserve_message_media_attachment_upload(
  p_attachment_intent_id UUID,
  p_scan_result TEXT,
  p_scanner_engine TEXT,
  p_scanner_engine_version TEXT,
  p_scanner_signature_version TEXT,
  p_scanner_protocol TEXT,
  p_scanned_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  intent_row platform_private.message_media_attachment_intents%ROWTYPE;
  prior_upload platform_private.message_media_attachment_uploads%ROWTYPE;
  reservation_row RECORD;
  ignored_receipt JSONB;
  result JSONB;
  input_sha256 TEXT;
  created_upload_id UUID := pg_catalog.gen_random_uuid();
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role is required to reserve attachment upload'
      USING ERRCODE = '42501';
  END IF;
  IF p_attachment_intent_id IS NULL OR p_scanned_at IS NULL THEN
    RAISE EXCEPTION 'Attachment intent and scan time are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO intent_row
  FROM platform_private.message_media_attachment_intents AS intent
  WHERE intent.id = p_attachment_intent_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message media attachment intent is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF p_scan_result IS DISTINCT FROM 'clean' THEN
    RAISE EXCEPTION 'A clean ingress scan is required for the attachment'
      USING ERRCODE = '22000';
  END IF;
  -- A retry rescans the same immutable archive bytes. Validate every fresh
  -- proof, but keep idempotency anchored to the intent rather than ephemeral
  -- scanner versions or timestamps. Migration 116 follows the same rule.
  PERFORM platform_private.assert_clamd_scan_facts(
    p_scanner_engine,
    p_scanner_engine_version,
    p_scanner_signature_version,
    p_scanner_protocol,
    intent_row.media_sha256_hex,
    p_scanned_at
  );

  input_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'attachment_intent_id', p_attachment_intent_id,
      'operation', 'reserve_message_media_attachment_upload'
    )::TEXT, 'UTF8')),
    'hex'
  );

  IF NOT private.message_media_attachment_actor_is_current(intent_row.id) THEN
    RAISE EXCEPTION 'The attachment actor no longer has current case authority'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM platform_private.waha_media_object_bindings AS source_binding
    JOIN platform_private.waha_media_archive_work AS archive_work
      ON archive_work.organization_id = source_binding.organization_id
      AND archive_work.id = intent_row.source_archive_work_id
      AND archive_work.object_binding_id = source_binding.id
      AND archive_work.media_id = intent_row.communication_media_id
      AND archive_work.state = 'archived'
    JOIN platform_private.waha_media_archive_effects AS archive_effect
      ON archive_effect.organization_id = archive_work.organization_id
      AND archive_effect.id = intent_row.source_archive_effect_id
      AND archive_effect.work_id = archive_work.id
      AND archive_effect.outcome = 'archived'
    WHERE source_binding.organization_id = intent_row.organization_id
      AND source_binding.id = intent_row.source_object_binding_id
      AND source_binding.media_id = intent_row.communication_media_id
      AND source_binding.bucket_id = intent_row.source_bucket_id
      AND source_binding.object_name = intent_row.source_object_name
      AND archive_effect.mime_type = intent_row.media_mime_type
      AND archive_effect.file_name = intent_row.media_file_name
      AND archive_effect.file_size_bytes = intent_row.media_file_size_bytes
      AND archive_effect.sha256_hex = intent_row.media_sha256_hex
  ) THEN
    RAISE EXCEPTION 'Archived media provenance no longer matches the intent'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO prior_upload
  FROM platform_private.message_media_attachment_uploads AS attachment_upload
  WHERE attachment_upload.organization_id = intent_row.organization_id
    AND attachment_upload.attachment_intent_id = intent_row.id;
  IF FOUND THEN
    IF prior_upload.request_id IS DISTINCT FROM intent_row.upload_reservation_request_id
      OR prior_upload.input_sha256 IS DISTINCT FROM input_sha256
    THEN
      RAISE EXCEPTION 'Attachment intent was already used with different upload inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN prior_upload.response;
  END IF;

  ignored_receipt := platform.reserve_document_upload_after_ingress_scan(
    intent_row.organization_id,
    intent_row.actor_auth_user_id,
    intent_row.document_slot_id,
    intent_row.media_file_name,
    intent_row.media_mime_type,
    intent_row.media_file_size_bytes,
    intent_row.media_sha256_hex,
    p_scan_result,
    p_scanner_engine,
    p_scanner_engine_version,
    p_scanner_signature_version,
    p_scanner_protocol,
    p_scanned_at,
    intent_row.upload_reservation_request_id
  );

  IF NOT private.message_media_attachment_actor_is_current(intent_row.id) THEN
    RAISE EXCEPTION 'The attachment actor changed during upload reservation'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    reservation.*,
    storage_binding.id AS exact_storage_binding_id,
    version.version_no AS exact_version_no
  INTO reservation_row
  FROM platform_private.document_upload_reservations AS reservation
  JOIN platform_private.document_storage_bindings AS storage_binding
    ON storage_binding.organization_id = reservation.organization_id
    AND storage_binding.upload_reservation_id = reservation.id
    AND storage_binding.document_version_id = reservation.document_version_id
    AND storage_binding.student_case_id = reservation.student_case_id
    AND storage_binding.document_slot_id = reservation.document_slot_id
    AND storage_binding.bucket_id = reservation.bucket_id
    AND storage_binding.object_name = reservation.object_name
  JOIN platform.document_versions AS version
    ON version.organization_id = reservation.organization_id
    AND version.id = reservation.document_version_id
    AND version.student_case_id = reservation.student_case_id
    AND version.document_slot_id = reservation.document_slot_id
  WHERE reservation.request_id = intent_row.upload_reservation_request_id
    AND reservation.organization_id = intent_row.organization_id
    AND reservation.student_case_id = intent_row.student_case_id
    AND reservation.document_slot_id = intent_row.document_slot_id
    AND reservation.uploader_profile_id = intent_row.actor_profile_id
    AND reservation.uploader_membership_id = intent_row.actor_membership_id
    AND reservation.uploader_auth_user_id = intent_row.actor_auth_user_id
    AND reservation.declared_mime_type = intent_row.media_mime_type
    AND reservation.byte_size = intent_row.media_file_size_bytes
    AND reservation.sha256_hex = intent_row.media_sha256_hex
    AND reservation.ingress_scan_required
    AND reservation.ingress_scan_result = p_scan_result
    AND reservation.ingress_scanner_engine = p_scanner_engine
    AND reservation.ingress_scanner_engine_version = p_scanner_engine_version
    AND reservation.ingress_scanner_signature_version = p_scanner_signature_version
    AND reservation.ingress_scanner_protocol = p_scanner_protocol
    AND reservation.ingress_scanned_at = p_scanned_at
    AND version.original_filename = intent_row.media_file_name
    AND version.declared_mime_type = intent_row.media_mime_type
    AND version.byte_size = intent_row.media_file_size_bytes
    AND version.sha256_hex = intent_row.media_sha256_hex
    AND version.ingest_evidence_ref =
      'storage-reservation:' || reservation.id::TEXT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document upload reservation does not match the attachment intent'
      USING ERRCODE = '55000';
  END IF;

  result := pg_catalog.jsonb_build_object(
    'attachment_intent_id', intent_row.id,
    'organization_id', reservation_row.organization_id,
    'student_case_id', reservation_row.student_case_id,
    'document_slot_id', reservation_row.document_slot_id,
    'document_version_id', reservation_row.document_version_id,
    'version_number', reservation_row.exact_version_no,
    'upload_reservation_id', reservation_row.id,
    'storage_binding_id', reservation_row.exact_storage_binding_id,
    'bucket_id', reservation_row.bucket_id,
    'object_name', reservation_row.object_name,
    'expires_at', reservation_row.expires_at,
    'declared_mime_type', reservation_row.declared_mime_type,
    'byte_size', reservation_row.byte_size,
    'sha256_hex', reservation_row.sha256_hex,
    'storage_object_present', EXISTS (
      SELECT 1
      FROM storage.objects AS object
      WHERE object.bucket_id = reservation_row.bucket_id
        AND object.name = reservation_row.object_name
    ),
    'document_slot_published', FALSE
  );

  INSERT INTO platform_private.message_media_attachment_uploads (
    id, request_id, input_sha256, organization_id, attachment_intent_id,
    student_case_id, document_slot_id, document_version_id,
    upload_reservation_id, storage_binding_id, bucket_id, object_name, response
  ) VALUES (
    created_upload_id, intent_row.upload_reservation_request_id, input_sha256,
    intent_row.organization_id, intent_row.id, intent_row.student_case_id,
    intent_row.document_slot_id, reservation_row.document_version_id,
    reservation_row.id, reservation_row.exact_storage_binding_id,
    reservation_row.bucket_id, reservation_row.object_name, result
  );

  RETURN result;
END
$$;

-- Service-only completion owns the finalizer call and the attachment ledger
-- insert in one PostgreSQL statement. A crash therefore cannot publish a
-- version without its intent-bound completion evidence.
CREATE FUNCTION private.complete_message_media_attachment(
  p_attachment_intent_id UUID,
  p_upload_reservation_id UUID,
  p_scanner_engine TEXT,
  p_scanner_engine_version TEXT,
  p_scanner_signature_version TEXT,
  p_scanner_protocol TEXT,
  p_scanned_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  intent_row platform_private.message_media_attachment_intents%ROWTYPE;
  attachment_upload platform_private.message_media_attachment_uploads%ROWTYPE;
  prior_completion platform_private.message_media_attachment_completions%ROWTYPE;
  proof_row RECORD;
  ignored_receipt JSONB;
  result JSONB;
  input_sha256 TEXT;
  completion_id UUID := pg_catalog.gen_random_uuid();
  completed_at TIMESTAMPTZ := pg_catalog.statement_timestamp();
  fixed_reason CONSTANT TEXT :=
    'WhatsApp message media attachment completed as a case document version';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role is required to complete a media attachment'
      USING ERRCODE = '42501';
  END IF;
  IF p_attachment_intent_id IS NULL
    OR p_upload_reservation_id IS NULL
    OR p_scanned_at IS NULL
  THEN
    RAISE EXCEPTION 'Attachment intent, reservation and scan time are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO intent_row
  FROM platform_private.message_media_attachment_intents AS intent
  WHERE intent.id = p_attachment_intent_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message media attachment intent is unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- Completion retries also carry a newly observed scan time. Validate the
  -- rescan, while replay identity remains the immutable intent/reservation
  -- pair so a lost committed response can recover deterministically.
  PERFORM platform_private.assert_clamd_scan_facts(
    p_scanner_engine,
    p_scanner_engine_version,
    p_scanner_signature_version,
    p_scanner_protocol,
    intent_row.media_sha256_hex,
    p_scanned_at
  );

  PERFORM platform_private.lock_p2e_request(intent_row.completion_request_id);

  input_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'attachment_intent_id', p_attachment_intent_id,
      'upload_reservation_id', p_upload_reservation_id,
      'operation', 'complete_message_media_attachment'
    )::TEXT, 'UTF8')),
    'hex'
  );

  SELECT * INTO prior_completion
  FROM platform_private.message_media_attachment_completions AS completion
  WHERE completion.organization_id = intent_row.organization_id
    AND completion.attachment_intent_id = intent_row.id;
  IF FOUND THEN
    IF prior_completion.request_id IS DISTINCT FROM intent_row.completion_request_id
      OR prior_completion.input_sha256 IS DISTINCT FROM input_sha256
      OR prior_completion.upload_reservation_id IS DISTINCT FROM p_upload_reservation_id
    THEN
      RAISE EXCEPTION 'Attachment intent was already completed with different inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN prior_completion.response;
  END IF;

  SELECT * INTO attachment_upload
  FROM platform_private.message_media_attachment_uploads AS candidate
  WHERE candidate.organization_id = intent_row.organization_id
    AND candidate.attachment_intent_id = intent_row.id
    AND candidate.upload_reservation_id = p_upload_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exact intent-bound upload reservation is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.message_media_attachment_actor_is_current(intent_row.id) THEN
    RAISE EXCEPTION 'The attachment actor no longer has current case authority'
      USING ERRCODE = '42501';
  END IF;

  -- The finalizer verifies the exact Storage object/window and commits its
  -- clean ClamAV attestation. This call and our completion insert are atomic.
  ignored_receipt := platform.finalize_document_upload_with_scan(
    intent_row.organization_id,
    attachment_upload.upload_reservation_id,
    p_scanner_engine,
    p_scanner_engine_version,
    p_scanner_signature_version,
    p_scanner_protocol,
    intent_row.media_sha256_hex,
    p_scanned_at,
    intent_row.upload_finalization_request_id
  );

  IF NOT private.message_media_attachment_actor_is_current(intent_row.id) THEN
    RAISE EXCEPTION 'The attachment actor changed during finalization'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    reservation.id AS exact_reservation_id,
    version.id AS exact_version_id,
    version.version_no AS exact_version_no,
    finalization.id AS exact_finalization_id,
    scan_proof.id AS exact_scan_proof_id
  INTO proof_row
  FROM platform_private.document_upload_reservations AS reservation
  JOIN platform_private.document_storage_bindings AS storage_binding
    ON storage_binding.id = attachment_upload.storage_binding_id
    AND storage_binding.organization_id = reservation.organization_id
    AND storage_binding.upload_reservation_id = reservation.id
    AND storage_binding.document_version_id = reservation.document_version_id
    AND storage_binding.student_case_id = reservation.student_case_id
    AND storage_binding.document_slot_id = reservation.document_slot_id
    AND storage_binding.bucket_id = reservation.bucket_id
    AND storage_binding.object_name = reservation.object_name
  JOIN platform.document_versions AS version
    ON version.organization_id = reservation.organization_id
    AND version.id = reservation.document_version_id
    AND version.student_case_id = reservation.student_case_id
    AND version.document_slot_id = reservation.document_slot_id
  JOIN platform.document_slots AS slot
    ON slot.organization_id = version.organization_id
    AND slot.id = version.document_slot_id
    AND slot.student_case_id = version.student_case_id
    AND slot.current_version_id = version.id
    AND slot.current_version_no = version.version_no
  JOIN platform_private.document_upload_finalizations AS finalization
    ON finalization.organization_id = reservation.organization_id
    AND finalization.request_id = intent_row.upload_finalization_request_id
    AND finalization.upload_reservation_id = reservation.id
    AND finalization.document_version_id = reservation.document_version_id
    AND finalization.student_case_id = reservation.student_case_id
    AND finalization.document_slot_id = reservation.document_slot_id
    AND finalization.bucket_id = reservation.bucket_id
    AND finalization.object_name = reservation.object_name
    AND finalization.published_version_no = version.version_no
  JOIN platform_private.document_malware_scan_attestations AS scan_proof
    ON scan_proof.organization_id = finalization.organization_id
    AND scan_proof.upload_finalization_id = finalization.id
    AND scan_proof.document_version_id = finalization.document_version_id
    AND scan_proof.student_case_id = finalization.student_case_id
    AND scan_proof.document_slot_id = finalization.document_slot_id
    AND scan_proof.scanned_sha256_hex = intent_row.media_sha256_hex
    AND scan_proof.scanner_engine = p_scanner_engine
    AND scan_proof.scanner_engine_version = p_scanner_engine_version
    AND scan_proof.scanner_signature_version = p_scanner_signature_version
    AND scan_proof.scanner_protocol = p_scanner_protocol
    AND scan_proof.scanned_at = p_scanned_at
  WHERE reservation.organization_id = intent_row.organization_id
    AND reservation.id = attachment_upload.upload_reservation_id
    AND reservation.request_id = intent_row.upload_reservation_request_id
    AND reservation.document_version_id = attachment_upload.document_version_id
    AND reservation.student_case_id = intent_row.student_case_id
    AND reservation.document_slot_id = intent_row.document_slot_id
    AND reservation.uploader_profile_id = intent_row.actor_profile_id
    AND reservation.uploader_membership_id = intent_row.actor_membership_id
    AND reservation.uploader_auth_user_id = intent_row.actor_auth_user_id
    AND reservation.bucket_id = attachment_upload.bucket_id
    AND reservation.object_name = attachment_upload.object_name
    AND reservation.declared_mime_type = intent_row.media_mime_type
    AND reservation.byte_size = intent_row.media_file_size_bytes
    AND reservation.sha256_hex = intent_row.media_sha256_hex
    AND version.original_filename = intent_row.media_file_name
    AND version.declared_mime_type = intent_row.media_mime_type
    AND version.byte_size = intent_row.media_file_size_bytes
    AND version.sha256_hex = intent_row.media_sha256_hex
    AND version.malware_scan_attestation_id = scan_proof.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finalized document proof does not match the attachment chain'
      USING ERRCODE = '55000';
  END IF;

  result := pg_catalog.jsonb_build_object(
    'organization_id', intent_row.organization_id,
    'attachment_intent_id', intent_row.id,
    'attachment_completion_id', completion_id,
    'conversation_id', intent_row.conversation_id,
    'communication_media_id', intent_row.communication_media_id,
    'student_case_id', intent_row.student_case_id,
    'document_slot_id', intent_row.document_slot_id,
    'document_version_id', proof_row.exact_version_id,
    'version_number', proof_row.exact_version_no,
    'upload_reservation_id', proof_row.exact_reservation_id,
    'upload_finalization_id', proof_row.exact_finalization_id,
    'malware_scan_attestation_id', proof_row.exact_scan_proof_id,
    'sha256_hex', intent_row.media_sha256_hex,
    'completed_at', completed_at,
    'request_id', intent_row.completion_request_id
  );

  INSERT INTO platform_private.message_media_attachment_completions (
    id, request_id, input_sha256, organization_id, attachment_intent_id,
    attachment_upload_id, document_version_id, upload_reservation_id,
    upload_finalization_id, malware_scan_attestation_id, sha256_hex, response
  ) VALUES (
    completion_id, intent_row.completion_request_id, input_sha256,
    intent_row.organization_id, intent_row.id, attachment_upload.id,
    proof_row.exact_version_id, proof_row.exact_reservation_id,
    proof_row.exact_finalization_id, proof_row.exact_scan_proof_id,
    intent_row.media_sha256_hex, result
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    intent_row.organization_id, 'service', NULL,
    'service:platform-media-attach',
    'document.media.attach.complete', 'document_version',
    proof_row.exact_version_id,
    pg_catalog.jsonb_build_object(
      'attachment_intent_id', intent_row.id,
      'upload_reservation_id', proof_row.exact_reservation_id,
      'document_slot_id', intent_row.document_slot_id
    ),
    result, fixed_reason, intent_row.completion_request_id
  );

  RETURN result;
END
$$;

-- Exposed Data API functions are deliberately privilege-free invoker shims.
CREATE FUNCTION platform.reserve_message_media_attachment(
  p_conversation_id UUID,
  p_communication_media_id UUID,
  p_student_case_id UUID,
  p_document_slot_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.reserve_message_media_attachment($1, $2, $3, $4, $5)
$$;

CREATE FUNCTION platform.reserve_message_media_attachment_upload(
  p_attachment_intent_id UUID,
  p_scan_result TEXT,
  p_scanner_engine TEXT,
  p_scanner_engine_version TEXT,
  p_scanner_signature_version TEXT,
  p_scanner_protocol TEXT,
  p_scanned_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.reserve_message_media_attachment_upload(
    $1, $2, $3, $4, $5, $6, $7
  )
$$;

CREATE FUNCTION platform.complete_message_media_attachment(
  p_attachment_intent_id UUID,
  p_upload_reservation_id UUID,
  p_scanner_engine TEXT,
  p_scanner_engine_version TEXT,
  p_scanner_signature_version TEXT,
  p_scanner_protocol TEXT,
  p_scanned_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.complete_message_media_attachment(
    $1, $2, $3, $4, $5, $6, $7
  )
$$;

REVOKE ALL ON FUNCTION private.reserve_message_media_attachment(
  UUID, UUID, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.reserve_message_media_attachment(
  UUID, UUID, UUID, UUID, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.reserve_message_media_attachment(
  UUID, UUID, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.reserve_message_media_attachment(
  UUID, UUID, UUID, UUID, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION private.reserve_message_media_attachment_upload(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.reserve_message_media_attachment_upload(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION platform.reserve_message_media_attachment_upload(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.reserve_message_media_attachment_upload(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION private.complete_message_media_attachment(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.complete_message_media_attachment(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION platform.complete_message_media_attachment(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.complete_message_media_attachment(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

COMMENT ON TABLE platform_private.message_media_attachment_intents IS
  'Append-only actor- and archive-proof-bound authorization to copy one private WhatsApp media object into one case document slot.';
COMMENT ON TABLE platform_private.message_media_attachment_uploads IS
  'Append-only causal edge from one message-media attachment intent to its exact document reservation, storage binding and version.';
COMMENT ON TABLE platform_private.message_media_attachment_completions IS
  'Append-only service proof binding an attachment intent to its exact reservation, finalization, clean scan attestation and published version.';
COMMENT ON FUNCTION platform.reserve_message_media_attachment(
  UUID, UUID, UUID, UUID, UUID
) IS
  'SECURITY INVOKER staff entrypoint that derives organization and actor from current verified authority and creates no Storage grant.';
COMMENT ON FUNCTION platform.reserve_message_media_attachment_upload(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS
  'SECURITY INVOKER service entrypoint that reserves the exact intent-bound document upload after a clean ingress scan.';
COMMENT ON FUNCTION platform.complete_message_media_attachment(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS
  'SECURITY INVOKER service entrypoint that atomically finalizes and records the exact intent-bound document upload and scan proof.';

COMMIT;
