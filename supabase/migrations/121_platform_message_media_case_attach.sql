-- ============================================================
-- 121_platform_message_media_case_attach.sql
--
-- Bridge one archived WhatsApp message media object into the canonical case
-- document pipeline. The browser never sees bytes, object names or URLs:
-- a staff actor records an audited attach intent, and the trusted server
-- copies the exact private object through the existing migration 116
-- reserve-after-ingress-scan / finalize-with-scan path. This migration adds
-- only the intent/completion ledger and its two RPC guards; storage, scanning
-- and publication authority stay exactly where migrations 062/108/115/116
-- put them.
-- ============================================================

BEGIN;

-- Append-only staff authorization to copy one archived message media object
-- into one active case document slot. A row is an intent, not proof of a
-- copied document; completion evidence lives in the companion table below.
CREATE TABLE platform_private.message_media_attachment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  communication_media_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
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
  actor_profile_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  actor_auth_user_id UUID NOT NULL,
  actor_role platform.business_role NOT NULL,
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

-- Append-only service evidence that one intent produced one published,
-- scan-proofed document version whose bytes match the archived media object.
CREATE TABLE platform_private.message_media_attachment_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  organization_id UUID NOT NULL,
  attachment_intent_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
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
  CONSTRAINT message_media_attachment_completions_version_fkey
    FOREIGN KEY (organization_id, document_version_id)
    REFERENCES platform.document_versions(organization_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE platform_private.message_media_attachment_intents
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.message_media_attachment_intents
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.message_media_attachment_completions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.message_media_attachment_completions
  FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON platform_private.message_media_attachment_intents
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
CREATE TRIGGER message_media_attachment_completions_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.message_media_attachment_completions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER message_media_attachment_completions_no_truncate
  BEFORE TRUNCATE
  ON platform_private.message_media_attachment_completions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Keep the Admin audit journal allowlist synchronized by composing with the
-- accumulated list instead of copying it (migration 112 pattern).
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

-- Staff command: authorize copying one archived message media object into one
-- active case document slot. The media must belong to the named conversation,
-- the conversation must be bound to this exact case (directly or through the
-- case's canonical lead/client), and the actor must both operate the case and
-- hold full read on the conversation. Nothing is copied here: the returned
-- receipt only entitles the trusted server to run the existing document
-- upload pipeline on the actor's behalf.
CREATE FUNCTION platform.reserve_message_media_attachment(
  p_organization_id UUID,
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
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  media_row RECORD;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  input_sha256 TEXT;
  created_intent_id UUID := gen_random_uuid();
  fixed_reason CONSTANT TEXT :=
    'WhatsApp message media attachment reserved for a case document slot';
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_communication_media_id IS NULL
    OR p_student_case_id IS NULL
    OR p_document_slot_id IS NULL
  THEN
    RAISE EXCEPTION
      'Conversation, media, case and document slot are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'document.manage'
  );

  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'conversation_id', p_conversation_id,
    'communication_media_id', p_communication_media_id,
    'student_case_id', p_student_case_id,
    'document_slot_id', p_document_slot_id,
    'request_id', p_request_id
  );

  -- Replay precedes all mutable resource checks so a durable retry still
  -- returns its original receipt after the slot is later removed.
  replayed := platform_private.replay_audit(
    p_request_id,
    'document.media.attach.reserve',
    'document_slot',
    p_document_slot_id,
    fixed_reason,
    replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT student_case.* INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND OR target_case.state <> 'active' THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT slot.* INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = p_organization_id
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
    media.file_size_bytes
  INTO media_row
  FROM platform.communication_message_media AS media
  JOIN platform.communication_conversations AS conversation
    ON conversation.organization_id = media.organization_id
    AND conversation.id = media.conversation_id
  WHERE media.organization_id = p_organization_id
    AND media.id = p_communication_media_id
    AND media.conversation_id = p_conversation_id
    AND media.archival_status = 'archived'
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

  IF media_row.mime_type NOT IN (
      'application/pdf', 'image/jpeg', 'image/png'
    )
    OR media_row.file_name IS NULL
    OR media_row.file_size_bytes IS NULL
    OR media_row.file_size_bytes NOT BETWEEN 1 AND 26214400
  THEN
    RAISE EXCEPTION
      'Message media cannot be attached as a case document'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(convert_to(
      (replay_shape || jsonb_build_object(
        'actor_membership_id', actor.actor_membership_id
      ))::TEXT,
      'UTF8'
    )),
    'hex'
  );

  result := replay_shape || jsonb_build_object(
    'attachment_intent_id', created_intent_id,
    'media_mime_type', media_row.mime_type,
    'media_file_name', media_row.file_name,
    'media_file_size_bytes', media_row.file_size_bytes::TEXT,
    'slot_status', slot_row.status
  );

  INSERT INTO platform_private.message_media_attachment_intents (
    id,
    request_id,
    input_sha256,
    organization_id,
    conversation_id,
    communication_media_id,
    student_case_id,
    document_slot_id,
    media_mime_type,
    media_file_name,
    media_file_size_bytes,
    actor_profile_id,
    actor_membership_id,
    actor_auth_user_id,
    actor_role,
    response
  ) VALUES (
    created_intent_id,
    p_request_id,
    input_sha256,
    p_organization_id,
    p_conversation_id,
    p_communication_media_id,
    p_student_case_id,
    p_document_slot_id,
    media_row.mime_type,
    media_row.file_name,
    media_row.file_size_bytes,
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role,
    result
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  ) VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'document.media.attach.reserve',
    'document_slot',
    p_document_slot_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

-- Service command: record that one attach intent produced one published
-- document version. It never bypasses migration 115/116 gates: the version
-- must already carry an exact finalized object with a durable clean ClamAV
-- proof, and its content hash must equal the archived media object's hash.
CREATE FUNCTION platform.complete_message_media_attachment(
  p_organization_id UUID,
  p_attachment_intent_id UUID,
  p_document_version_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prior_completion
    platform_private.message_media_attachment_completions%ROWTYPE;
  intent_row platform_private.message_media_attachment_intents%ROWTYPE;
  version_row platform.document_versions%ROWTYPE;
  archived_media_sha256 TEXT;
  input_sha256 TEXT;
  result JSONB;
  completion_id UUID := gen_random_uuid();
  completed_at TIMESTAMPTZ := statement_timestamp();
  fixed_reason CONSTANT TEXT :=
    'WhatsApp message media attachment completed as a case document version';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'service_role is required to complete a media attachment'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_attachment_intent_id IS NULL
    OR p_document_version_id IS NULL
  THEN
    RAISE EXCEPTION
      'Organization, attachment intent and document version are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(convert_to(jsonb_build_object(
      'organization_id', p_organization_id,
      'attachment_intent_id', p_attachment_intent_id,
      'document_version_id', p_document_version_id,
      'operation', 'complete_message_media_attachment'
    )::TEXT, 'UTF8')),
    'hex'
  );

  SELECT * INTO prior_completion
  FROM platform_private.message_media_attachment_completions AS completion
  WHERE completion.request_id = p_request_id;

  IF FOUND THEN
    IF prior_completion.input_sha256 <> input_sha256
      OR prior_completion.organization_id <> p_organization_id
      OR prior_completion.attachment_intent_id <> p_attachment_intent_id
      OR prior_completion.document_version_id <> p_document_version_id
    THEN
      RAISE EXCEPTION
        'request_id was already used with different completion inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN prior_completion.response;
  END IF;

  SELECT * INTO intent_row
  FROM platform_private.message_media_attachment_intents AS intent
  WHERE intent.organization_id = p_organization_id
    AND intent.id = p_attachment_intent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message media attachment intent is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.message_media_attachment_completions AS completion
    WHERE completion.organization_id = p_organization_id
      AND completion.attachment_intent_id = p_attachment_intent_id
  ) THEN
    RAISE EXCEPTION
      'Message media attachment intent was already completed'
      USING ERRCODE = '23505';
  END IF;

  SELECT version.* INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id
    AND version.student_case_id = intent_row.student_case_id
    AND version.document_slot_id = intent_row.document_slot_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document version is unavailable for this attachment'
      USING ERRCODE = '42501';
  END IF;

  SELECT effect.sha256_hex INTO archived_media_sha256
  FROM platform_private.waha_media_archive_work AS work
  JOIN platform_private.waha_media_archive_effects AS effect
    ON effect.organization_id = work.organization_id
    AND effect.work_id = work.id
    AND effect.outcome = 'archived'
  WHERE work.organization_id = p_organization_id
    AND work.media_id = intent_row.communication_media_id
  ORDER BY effect.created_at DESC, effect.id DESC
  LIMIT 1;

  IF archived_media_sha256 IS NULL
    OR version_row.sha256_hex IS DISTINCT FROM archived_media_sha256
  THEN
    RAISE EXCEPTION
      'Copied document bytes do not match the archived message media'
      USING ERRCODE = '22000';
  END IF;

  IF NOT platform_private.student_document_has_scan_proof(
    p_organization_id,
    p_document_version_id
  ) THEN
    RAISE EXCEPTION
      'A verified clean scan proof is required before attachment completion'
      USING ERRCODE = '55000';
  END IF;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'attachment_intent_id', p_attachment_intent_id,
    'attachment_completion_id', completion_id,
    'conversation_id', intent_row.conversation_id,
    'communication_media_id', intent_row.communication_media_id,
    'student_case_id', intent_row.student_case_id,
    'document_slot_id', intent_row.document_slot_id,
    'document_version_id', p_document_version_id,
    'sha256_hex', version_row.sha256_hex,
    'completed_at', completed_at,
    'request_id', p_request_id
  );

  INSERT INTO platform_private.message_media_attachment_completions (
    id,
    request_id,
    input_sha256,
    organization_id,
    attachment_intent_id,
    document_version_id,
    response
  ) VALUES (
    completion_id,
    p_request_id,
    input_sha256,
    p_organization_id,
    p_attachment_intent_id,
    p_document_version_id,
    result
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  ) VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-media-attach',
    'document.media.attach.complete',
    'document_version',
    p_document_version_id,
    jsonb_build_object(
      'attachment_intent_id', p_attachment_intent_id,
      'communication_media_id', intent_row.communication_media_id,
      'document_slot_id', intent_row.document_slot_id
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.reserve_message_media_attachment(
  UUID, UUID, UUID, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.reserve_message_media_attachment(
  UUID, UUID, UUID, UUID, UUID, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.complete_message_media_attachment(
  UUID, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.complete_message_media_attachment(
  UUID, UUID, UUID, UUID
) TO service_role;

COMMENT ON TABLE platform_private.message_media_attachment_intents IS
  'Append-only audited staff authorization to copy one archived WhatsApp media object into one active case document slot; not proof of a copied document.';
COMMENT ON TABLE platform_private.message_media_attachment_completions IS
  'Append-only service evidence that one attach intent produced one published, scan-proofed document version with the exact archived media content hash.';
COMMENT ON FUNCTION platform.reserve_message_media_attachment(
  UUID, UUID, UUID, UUID, UUID, UUID
) IS
  'Case-operator command reserving one archived, case-linked, attachable message media object for the trusted server-side copy into the document pipeline; returns no object identity or URL.';
COMMENT ON FUNCTION platform.complete_message_media_attachment(
  UUID, UUID, UUID, UUID
) IS
  'Service-only completion record for one attach intent; requires the published version to carry a durable clean scan proof and the archived media content hash.';

COMMIT;
