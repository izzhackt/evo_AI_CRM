-- ============================================================
-- 062_platform_waha_private_media.sql
--
-- P5D: archive media for already-projected P5B/P5C evo-inbox messages into
-- one fixed private Supabase Storage bucket. Provider identity and object
-- names remain backend-only. Browser principals receive bounded safe
-- descriptors and may request one audited, short-lived backend signing grant.
--
-- This migration performs no WAHA call, message send, read-mark, session
-- mutation, amoCRM operation or production action. A binding is not proof of
-- bytes; only a successful service finish with a matching Storage object may
-- mark media archived.
-- ============================================================

BEGIN;

CREATE TYPE platform.communication_media_kind AS ENUM (
  'image',
  'audio',
  'video',
  'pdf',
  'file'
);

CREATE TYPE platform.communication_media_archival_status AS ENUM (
  'pending',
  'processing',
  'archived',
  'retryable_error',
  'terminal_error'
);

-- Public rows intentionally contain no WAHA identity, media URL, Storage
-- bucket/object name, signing token or checksum. They are safe operator-facing
-- descriptors only.
CREATE TABLE platform.communication_message_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  communication_message_id UUID NOT NULL,
  ordinal SMALLINT NOT NULL DEFAULT 0 CHECK (ordinal BETWEEN 0 AND 15),
  media_kind platform.communication_media_kind NOT NULL DEFAULT 'file',
  mime_type TEXT CHECK (
    mime_type IS NULL
    OR mime_type IN (
      'application/octet-stream',
      'application/pdf',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
      'video/mp4'
    )
  ),
  file_name TEXT CHECK (
    file_name IS NULL
    OR (
      btrim(file_name) <> ''
      AND char_length(file_name) <= 255
      AND octet_length(file_name) <= 1024
      AND file_name !~ '[[:cntrl:]/\\]'
    )
  ),
  file_size_bytes BIGINT CHECK (
    file_size_bytes IS NULL
    OR file_size_bytes BETWEEN 1 AND 52428800
  ),
  archival_status platform.communication_media_archival_status NOT NULL
    DEFAULT 'pending',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT communication_message_media_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT communication_message_media_message_ordinal_key
    UNIQUE (organization_id, communication_message_id, ordinal),
  CONSTRAINT communication_message_media_parent_fkey
    FOREIGN KEY (
      organization_id,
      communication_message_id,
      conversation_id
    )
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT communication_message_media_archived_shape_check CHECK (
    (
      archival_status = 'archived'
      AND mime_type IS NOT NULL
      AND file_name IS NOT NULL
      AND file_size_bytes IS NOT NULL
      AND archived_at IS NOT NULL
      AND (
        (media_kind = 'image' AND mime_type IN (
          'image/gif', 'image/jpeg', 'image/png', 'image/webp'
        ))
        OR (media_kind = 'video' AND mime_type = 'video/mp4')
        OR (media_kind = 'audio' AND mime_type IN (
          'audio/mpeg', 'audio/ogg', 'audio/wav'
        ))
        OR (media_kind = 'pdf' AND mime_type = 'application/pdf')
        OR (media_kind = 'file' AND mime_type = 'application/octet-stream')
      )
    )
    OR (
      archival_status <> 'archived'
      AND media_kind = 'file'
      AND mime_type IS NULL
      AND file_name IS NULL
      AND file_size_bytes IS NULL
      AND archived_at IS NULL
    )
  )
);

CREATE INDEX communication_message_media_conversation_idx
  ON platform.communication_message_media (
    organization_id,
    conversation_id,
    created_at,
    id
  );

CREATE INDEX communication_message_media_message_idx
  ON platform.communication_message_media (
    organization_id,
    communication_message_id
  );

-- Stable opaque object identity is reserved before upload and is reused on a
-- retry. upsert is never authorized: a service must prove that a pre-existing
-- exact object matches before treating crash recovery as success.
CREATE TABLE platform_private.waha_media_object_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  media_id UUID NOT NULL,
  communication_message_id UUID NOT NULL,
  source_webhook_event_id UUID NOT NULL,
  waha_session_name TEXT NOT NULL CHECK (waha_session_name = 'evo-inbox'),
  raw_chat_id TEXT NOT NULL CHECK (
    raw_chat_id ~ '^[0-9]+@c[.]us$'
  ),
  raw_message_id TEXT NOT NULL CHECK (
    btrim(raw_message_id) <> ''
    AND char_length(raw_message_id) <= 1000
  ),
  bucket_id TEXT NOT NULL DEFAULT 'platform-whatsapp-media'
    CHECK (bucket_id = 'platform-whatsapp-media'),
  object_name TEXT NOT NULL CHECK (
    object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_media_object_bindings_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_media_object_bindings_media_key
    UNIQUE (organization_id, media_id),
  CONSTRAINT waha_media_object_bindings_message_key
    UNIQUE (organization_id, communication_message_id),
  CONSTRAINT waha_media_object_bindings_provider_key
    UNIQUE (
      organization_id,
      waha_session_name,
      raw_chat_id,
      raw_message_id
    ),
  CONSTRAINT waha_media_object_bindings_object_key
    UNIQUE (bucket_id, object_name),
  CONSTRAINT waha_media_object_bindings_media_fkey
    FOREIGN KEY (organization_id, media_id)
    REFERENCES platform.communication_message_media(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_media_object_bindings_message_fkey
    FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_media_object_bindings_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX waha_media_object_bindings_source_idx
  ON platform_private.waha_media_object_bindings (
    organization_id,
    source_webhook_event_id
  );

-- This is the only mutable private P5D table. Every claim completion/expiry is
-- also recorded in the append-only effects table below.
CREATE TABLE platform_private.waha_media_archive_work (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  media_id UUID NOT NULL,
  object_binding_id UUID NOT NULL,
  state platform.communication_media_archival_status NOT NULL
    DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 4 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  current_attempt_id UUID,
  worker_ref TEXT CHECK (
    worker_ref IS NULL
    OR (
      btrim(worker_ref) <> ''
      AND char_length(worker_ref) <= 200
      AND octet_length(worker_ref) <= 800
    )
  ),
  leased_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (
    last_error_code IS NULL
    OR last_error_code ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_media_archive_work_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_media_archive_work_media_key
    UNIQUE (organization_id, media_id),
  CONSTRAINT waha_media_archive_work_attempt_key
    UNIQUE (organization_id, current_attempt_id),
  CONSTRAINT waha_media_archive_work_media_fkey
    FOREIGN KEY (organization_id, media_id)
    REFERENCES platform.communication_message_media(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_media_archive_work_binding_fkey
    FOREIGN KEY (organization_id, object_binding_id)
    REFERENCES platform_private.waha_media_object_bindings(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT waha_media_archive_work_state_shape_check CHECK (
    (
      state = 'processing'
      AND current_attempt_id IS NOT NULL
      AND worker_ref IS NOT NULL
      AND leased_at IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > leased_at
    )
    OR (
      state <> 'processing'
      AND current_attempt_id IS NULL
      AND worker_ref IS NULL
      AND leased_at IS NULL
      AND lease_expires_at IS NULL
    )
  )
);

CREATE INDEX waha_media_archive_work_eligible_idx
  ON platform_private.waha_media_archive_work (
    organization_id,
    available_at,
    created_at,
    id
  )
  WHERE state IN ('pending', 'retryable_error');

CREATE INDEX waha_media_archive_work_expired_idx
  ON platform_private.waha_media_archive_work (
    organization_id,
    lease_expires_at,
    id
  )
  WHERE state = 'processing';

CREATE TABLE platform_private.waha_media_archive_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  work_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('archived', 'retryable_error', 'terminal_error')
  ),
  error_code TEXT CHECK (
    error_code IS NULL
    OR error_code ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  ),
  media_kind platform.communication_media_kind,
  mime_type TEXT,
  file_name TEXT,
  file_size_bytes BIGINT,
  sha256_hex TEXT CHECK (
    sha256_hex IS NULL OR sha256_hex ~ '^[0-9a-f]{64}$'
  ),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_media_archive_effects_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_media_archive_effects_attempt_key
    UNIQUE (organization_id, work_id, attempt_id),
  CONSTRAINT waha_media_archive_effects_work_fkey
    FOREIGN KEY (organization_id, work_id)
    REFERENCES platform_private.waha_media_archive_work(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_media_archive_effects_shape_check CHECK (
    (
      outcome = 'archived'
      AND error_code IS NULL
      AND media_kind IS NOT NULL
      AND mime_type IS NOT NULL
      AND file_name IS NOT NULL
      AND file_size_bytes BETWEEN 1 AND 52428800
      AND sha256_hex IS NOT NULL
    )
    OR (
      outcome IN ('retryable_error', 'terminal_error')
      AND error_code IS NOT NULL
      AND media_kind IS NULL
      AND mime_type IS NULL
      AND file_name IS NULL
      AND file_size_bytes IS NULL
      AND sha256_hex IS NULL
    )
  )
);

CREATE INDEX waha_media_archive_effects_work_idx
  ON platform_private.waha_media_archive_effects (
    organization_id,
    work_id,
    created_at DESC
  );

CREATE TABLE platform_private.waha_media_claim_requests (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE platform_private.communication_media_download_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  organization_id UUID NOT NULL,
  media_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  grantee_profile_id UUID NOT NULL,
  grantee_membership_id UUID NOT NULL,
  grantee_auth_user_id UUID NOT NULL,
  grantee_role platform.business_role NOT NULL,
  grantee_access_version BIGINT NOT NULL CHECK (grantee_access_version > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT communication_media_download_grants_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT communication_media_download_grants_media_fkey
    FOREIGN KEY (organization_id, media_id)
    REFERENCES platform.communication_message_media(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT communication_media_download_grants_membership_fkey
    FOREIGN KEY (organization_id, grantee_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT communication_media_download_grants_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + INTERVAL '5 minutes'
  )
);

CREATE INDEX communication_media_download_grants_actor_idx
  ON platform_private.communication_media_download_grants (
    organization_id,
    grantee_auth_user_id,
    created_at DESC
  );

CREATE TABLE platform_private.communication_media_download_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  organization_id UUID NOT NULL,
  media_download_grant_id UUID NOT NULL,
  media_id UUID NOT NULL,
  object_binding_id UUID NOT NULL,
  bucket_id TEXT NOT NULL CHECK (bucket_id = 'platform-whatsapp-media'),
  object_name TEXT NOT NULL CHECK (
    object_name ~ '^[0-9a-f]{2}/[0-9a-f]{62}$'
  ),
  max_signed_url_expires_in_seconds INTEGER NOT NULL
    CHECK (max_signed_url_expires_in_seconds BETWEEN 1 AND 60),
  grant_expires_at TIMESTAMPTZ NOT NULL,
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT media_download_consumptions_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT communication_media_download_consumptions_grant_key
    UNIQUE (organization_id, media_download_grant_id),
  CONSTRAINT communication_media_download_consumptions_grant_fkey
    FOREIGN KEY (organization_id, media_download_grant_id)
    REFERENCES platform_private.communication_media_download_grants(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT communication_media_download_consumptions_media_fkey
    FOREIGN KEY (organization_id, media_id)
    REFERENCES platform.communication_message_media(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT communication_media_download_consumptions_binding_fkey
    FOREIGN KEY (organization_id, object_binding_id)
    REFERENCES platform_private.waha_media_object_bindings(
      organization_id,
      id
    )
    ON DELETE RESTRICT
);

CREATE INDEX communication_media_download_consumptions_media_idx
  ON platform_private.communication_media_download_consumptions (
    organization_id,
    media_id,
    consumed_at DESC
  );

ALTER TABLE platform.communication_message_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_message_media FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_media_object_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_media_object_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_media_archive_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_media_archive_work FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_media_archive_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_media_archive_effects FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_media_claim_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_media_claim_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.communication_media_download_grants
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.communication_media_download_grants
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.communication_media_download_consumptions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.communication_media_download_consumptions
  FORCE ROW LEVEL SECURITY;

CREATE POLICY communication_message_media_staff_select
  ON platform.communication_message_media
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

CREATE TRIGGER communication_message_media_set_updated_at
  BEFORE UPDATE ON platform.communication_message_media
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

CREATE TRIGGER waha_media_archive_work_set_updated_at
  BEFORE UPDATE ON platform_private.waha_media_archive_work
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

-- Immutable private evidence cannot be rewritten or truncated.
CREATE TRIGGER waha_media_object_bindings_append_only
  BEFORE UPDATE OR DELETE ON platform_private.waha_media_object_bindings
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_media_object_bindings_no_truncate
  BEFORE TRUNCATE ON platform_private.waha_media_object_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_media_archive_effects_append_only
  BEFORE UPDATE OR DELETE ON platform_private.waha_media_archive_effects
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_media_archive_effects_no_truncate
  BEFORE TRUNCATE ON platform_private.waha_media_archive_effects
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_media_claim_requests_append_only
  BEFORE UPDATE OR DELETE ON platform_private.waha_media_claim_requests
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_media_claim_requests_no_truncate
  BEFORE TRUNCATE ON platform_private.waha_media_claim_requests
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER communication_media_download_grants_append_only
  BEFORE UPDATE OR DELETE ON platform_private.communication_media_download_grants
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER communication_media_download_grants_no_truncate
  BEFORE TRUNCATE ON platform_private.communication_media_download_grants
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER communication_media_download_consumptions_append_only
  BEFORE UPDATE OR DELETE ON platform_private.communication_media_download_consumptions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER communication_media_download_consumptions_no_truncate
  BEFORE TRUNCATE ON platform_private.communication_media_download_consumptions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- A candidate must already have the immutable P5B/P5C public projection,
-- private message binding and exact direct evo-inbox chat binding. This helper
-- accepts either a verified inbound webhook observation or an explicit
-- read-only P5C history observation (inbound or outbound), and nothing else.
CREATE OR REPLACE FUNCTION platform_private.is_bound_waha_media_candidate(
  p_organization_id UUID,
  p_communication_message_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.communication_messages AS message
    JOIN platform_private.waha_message_bindings AS message_binding
      ON message_binding.organization_id = message.organization_id
      AND message_binding.communication_message_id = message.id
      AND message_binding.source_webhook_event_id =
        message.source_webhook_event_id
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = message_binding.organization_id
      AND source_event.id = message_binding.source_webhook_event_id
    JOIN platform_private.waha_direct_chat_bindings AS chat_binding
      ON chat_binding.organization_id = message.organization_id
      AND chat_binding.conversation_id = message.conversation_id
      AND chat_binding.waha_session_name = message_binding.waha_session_name
    WHERE message.organization_id = p_organization_id
      AND message.id = p_communication_message_id
      AND message_binding.waha_session_name = 'evo-inbox'
      AND source_event.provider = 'waha'
      AND source_event.provider_account_ref = 'waha:evo-inbox'
      AND source_event.waha_session_name = 'evo-inbox'
      AND (
        (
          message.message_identity_source = 'private_waha_binding'
          AND message.direction = 'inbound'
          AND source_event.verification_status = 'verified'
          AND source_event.event_type IN ('message', 'message.any')
          AND source_event.raw_payload ->> 'event' = source_event.event_type
          AND source_event.raw_payload ->> 'session' = 'evo-inbox'
          AND source_event.raw_payload #>> '{payload,id}' =
            message_binding.raw_message_id
          AND source_event.raw_payload #> '{payload,fromMe}' = 'false'::JSONB
          AND source_event.raw_payload #> '{payload,hasMedia}' = 'true'::JSONB
          AND lower(COALESCE(
            btrim(source_event.raw_payload #>> '{payload,source}'),
            ''
          )) <> 'api'
          AND EXISTS (
            SELECT 1
            FROM platform_private.waha_work_projection_effects AS effect
            WHERE effect.organization_id = message.organization_id
              AND effect.source_webhook_event_id = source_event.id
              AND effect.disposition = 'succeeded'
              AND effect.result ->> 'communication_message_id' =
                message.id::TEXT
          )
          AND EXISTS (
            SELECT 1
            FROM unnest(ARRAY[
              NULLIF(btrim(source_event.raw_payload #>> '{payload,from}'), ''),
              NULLIF(btrim(source_event.raw_payload #>> '{payload,chatId}'), ''),
              NULLIF(btrim(source_event.raw_payload #>> '{payload,_data,from}'), ''),
              NULLIF(
                btrim(source_event.raw_payload #>> '{payload,_data,id,remote}'),
                ''
              )
            ]) AS candidate(raw_chat_id)
            WHERE candidate.raw_chat_id IS NOT NULL
              AND platform_private.normalize_waha_direct_chat_id(
                candidate.raw_chat_id
              ) = chat_binding.normalized_chat_id
          )
        )
        OR (
          message.message_identity_source = 'private_waha_history_binding'
          AND message.direction IN ('inbound', 'outbound')
          AND source_event.verification_status = 'missing'
          AND source_event.event_type = 'history.message'
          AND source_event.verification_headers ->> 'provenance' =
            'api_history'
          AND source_event.verification_headers -> 'webhook_verified'
            = 'false'::JSONB
          AND source_event.verification_headers -> 'read_only' = 'true'::JSONB
          AND source_event.raw_payload ->> 'provenance' = 'api_history'
          AND source_event.raw_payload -> 'read_only' = 'true'::JSONB
          AND source_event.raw_payload ->> 'session' = 'evo-inbox'
          AND source_event.raw_payload ->> 'chat_id' =
            chat_binding.normalized_chat_id
          AND source_event.raw_payload #>> '{message,raw_message_id}' =
            message_binding.raw_message_id
          AND source_event.raw_payload #> '{message,has_media}' = 'true'::JSONB
          AND source_event.raw_payload #>> '{message,direction}' =
            message.direction::TEXT
          AND EXISTS (
            SELECT 1
            FROM platform_private.waha_history_projection_effects AS effect
            WHERE effect.organization_id = message.organization_id
              AND effect.source_event_id = source_event.id
              AND effect.communication_message_id = message.id
              AND effect.disposition IN ('projected', 'reconciled_existing')
          )
          AND EXISTS (
            SELECT 1
            FROM platform_private.waha_history_message_observations AS observation
            WHERE observation.organization_id = message.organization_id
              AND observation.source_event_id = source_event.id
              AND observation.communication_message_id = message.id
              AND observation.waha_session_name = 'evo-inbox'
              AND observation.normalized_chat_id =
                chat_binding.normalized_chat_id
              AND observation.raw_message_id = message_binding.raw_message_id
              AND observation.direction = message.direction
          )
        )
      )
  )
$$;

-- Service consumption cannot use auth.uid() for the original human caller.
-- Re-evaluate the same live membership, permission and assignment/scope rules
-- with the immutable grant's membership snapshot.
CREATE OR REPLACE FUNCTION platform_private.membership_can_read_communication(
  p_organization_id UUID,
  p_membership_id UUID,
  p_conversation_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.communication_conversations AS conversation
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = conversation.organization_id
      AND membership.id = p_membership_id
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    LEFT JOIN platform.student_cases AS student_case
      ON student_case.organization_id = conversation.organization_id
      AND student_case.id = conversation.student_case_id
    WHERE conversation.organization_id = p_organization_id
      AND conversation.id = p_conversation_id
      AND profile.status = 'active'
      AND membership.status = 'active'
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND EXISTS (
        SELECT 1
        FROM platform.role_bundle_permissions AS permission
        WHERE permission.bundle_id = bundle.id
          AND permission.bundle_role = bundle.role
          AND permission.permission_key = 'communication.read.full'
      )
      AND (
        (
          membership."current_role" = 'admin'
          AND platform_private.membership_has_active_scope(
            p_organization_id,
            membership.id,
            'organization',
            p_organization_id
          )
        )
        OR (
          membership."current_role" = 'sales'
          AND conversation.queue = 'sales'
          AND conversation.responsible_sales_membership_id = membership.id
          AND (
            (
              conversation.student_case_id IS NULL
              AND platform_private.membership_has_active_scope(
                p_organization_id,
                membership.id,
                'conversation',
                conversation.id
              )
            )
            OR (
              conversation.student_case_id IS NOT NULL
              AND student_case.state = 'pending'
              AND student_case.responsible_sales_membership_id = membership.id
              AND platform_private.membership_has_active_scope(
                p_organization_id,
                membership.id,
                'student_case',
                student_case.id
              )
            )
          )
        )
        OR (
          membership."current_role" = 'curator'
          AND conversation.queue = 'curator'
          AND conversation.student_case_id IS NOT NULL
          AND conversation.current_curator_membership_id = membership.id
          AND student_case.state IN ('active', 'closed')
          AND student_case.current_curator_membership_id = membership.id
          AND platform_private.membership_has_active_scope(
            p_organization_id,
            membership.id,
            'student_case',
            student_case.id
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION
  platform_private.is_bound_waha_media_candidate(UUID, UUID),
  platform_private.membership_can_read_communication(UUID, UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.claim_waha_media_archive(
  p_organization_id UUID,
  p_worker_ref TEXT,
  p_visibility_timeout_seconds INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prior_request platform_private.waha_media_claim_requests%ROWTYPE;
  expired_work RECORD;
  selected_work RECORD;
  candidate RECORD;
  object_binding_id UUID;
  created_media_id UUID;
  created_work_id UUID;
  attempt_id UUID := gen_random_uuid();
  opaque_hash TEXT;
  object_name_value TEXT;
  input_sha256 TEXT;
  expiry_effect_request_id UUID;
  expiry_outcome TEXT;
  expiry_response JSONB;
  lease_expires_at_value TIMESTAMPTZ;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_worker_ref IS NULL
    OR btrim(p_worker_ref) = ''
    OR char_length(btrim(p_worker_ref)) > 200
    OR octet_length(btrim(p_worker_ref)) > 800
    OR p_visibility_timeout_seconds IS NULL
    OR p_visibility_timeout_seconds NOT BETWEEN 1 AND 900
  THEN
    RAISE EXCEPTION
      'Valid tenant, worker and media visibility timeout are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(convert_to(jsonb_build_object(
      'organization_id', p_organization_id,
      'worker_ref', btrim(p_worker_ref),
      'visibility_timeout_seconds', p_visibility_timeout_seconds,
      'queue', 'platform_waha_media_v1'
    )::TEXT, 'UTF8')),
    'hex'
  );

  SELECT *
  INTO prior_request
  FROM platform_private.waha_media_claim_requests AS request
  WHERE request.request_id = p_request_id;

  IF FOUND THEN
    IF prior_request.input_sha256 <> input_sha256
      OR prior_request.organization_id <> p_organization_id
    THEN
      RAISE EXCEPTION
        'request_id was already used with different media claim inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN prior_request.response;
  END IF;

  -- Close at most one expired lease before claiming. The append-only effect
  -- preserves the expired attempt; a final expired attempt fails terminally.
  SELECT
    work.id,
    work.media_id,
    work.current_attempt_id,
    work.attempt_count,
    work.max_attempts,
    work.state
  INTO expired_work
  FROM platform_private.waha_media_archive_work AS work
  WHERE work.organization_id = p_organization_id
    AND work.state = 'processing'
    AND work.lease_expires_at <= clock_timestamp()
  ORDER BY work.lease_expires_at, work.id
  FOR UPDATE OF work SKIP LOCKED
  LIMIT 1;

  IF FOUND THEN
    expiry_effect_request_id := gen_random_uuid();
    expiry_outcome := CASE
      WHEN expired_work.attempt_count >= expired_work.max_attempts
        THEN 'terminal_error'
      ELSE 'retryable_error'
    END;
    expiry_response := jsonb_build_object(
      'organization_id', p_organization_id,
      'work_id', expired_work.id,
      'attempt_id', expired_work.current_attempt_id,
      'media_id', expired_work.media_id,
      'state', expiry_outcome,
      'outcome', expiry_outcome
    );

    INSERT INTO platform_private.waha_media_archive_effects (
      organization_id,
      work_id,
      attempt_id,
      outcome,
      error_code,
      input_sha256,
      response,
      request_id
    ) VALUES (
      p_organization_id,
      expired_work.id,
      expired_work.current_attempt_id,
      expiry_outcome,
      'lease_expired',
      encode(sha256(convert_to(expiry_response::TEXT, 'UTF8')), 'hex'),
      expiry_response,
      expiry_effect_request_id
    );

    UPDATE platform_private.waha_media_archive_work
    SET
      state = expiry_outcome::platform.communication_media_archival_status,
      available_at = CASE
        WHEN expiry_outcome = 'retryable_error'
          THEN statement_timestamp()
        ELSE available_at
      END,
      current_attempt_id = NULL,
      worker_ref = NULL,
      leased_at = NULL,
      lease_expires_at = NULL,
      last_error_code = 'lease_expired'
    WHERE organization_id = p_organization_id
      AND id = expired_work.id;

    UPDATE platform.communication_message_media
    SET archival_status =
      expiry_outcome::platform.communication_media_archival_status
    WHERE organization_id = p_organization_id
      AND id = expired_work.media_id;
  END IF;

  SELECT
    work.id AS work_id,
    work.media_id,
    work.object_binding_id,
    work.attempt_count,
    work.max_attempts,
    binding.communication_message_id,
    binding.raw_chat_id,
    binding.raw_message_id,
    binding.object_name,
    message.direction
  INTO selected_work
  FROM platform_private.waha_media_archive_work AS work
  JOIN platform_private.waha_media_object_bindings AS binding
    ON binding.organization_id = work.organization_id
    AND binding.id = work.object_binding_id
    AND binding.media_id = work.media_id
  JOIN platform.communication_messages AS message
    ON message.organization_id = binding.organization_id
    AND message.id = binding.communication_message_id
  WHERE work.organization_id = p_organization_id
    AND work.state IN ('pending', 'retryable_error')
    AND work.available_at <= clock_timestamp()
    AND work.attempt_count < work.max_attempts
    AND platform_private.is_bound_waha_media_candidate(
      work.organization_id,
      binding.communication_message_id
    )
  ORDER BY work.available_at, work.created_at, work.id
  FOR UPDATE OF work SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT
      message_binding.organization_id,
      message_binding.communication_message_id,
      message_binding.source_webhook_event_id,
      message_binding.raw_message_id,
      chat_binding.normalized_chat_id AS raw_chat_id,
      message.conversation_id,
      message.direction
    INTO candidate
    FROM platform_private.waha_message_bindings AS message_binding
    JOIN platform.communication_messages AS message
      ON message.organization_id = message_binding.organization_id
      AND message.id = message_binding.communication_message_id
      AND message.source_webhook_event_id =
        message_binding.source_webhook_event_id
    JOIN platform_private.waha_direct_chat_bindings AS chat_binding
      ON chat_binding.organization_id = message.organization_id
      AND chat_binding.conversation_id = message.conversation_id
      AND chat_binding.waha_session_name = message_binding.waha_session_name
    WHERE message_binding.organization_id = p_organization_id
      AND message_binding.waha_session_name = 'evo-inbox'
      AND platform_private.is_bound_waha_media_candidate(
        message_binding.organization_id,
        message_binding.communication_message_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.waha_media_object_bindings AS existing
        WHERE existing.organization_id = message_binding.organization_id
          AND existing.communication_message_id =
            message_binding.communication_message_id
      )
    ORDER BY message_binding.created_at, message_binding.id
    FOR UPDATE OF message_binding SKIP LOCKED
    LIMIT 1;

    IF FOUND THEN
      created_media_id := gen_random_uuid();
      created_work_id := gen_random_uuid();
      opaque_hash := encode(
        sha256(convert_to(
          gen_random_uuid()::TEXT || ':' || created_media_id::TEXT,
          'UTF8'
        )),
        'hex'
      );
      object_name_value := substr(opaque_hash, 1, 2)
        || '/' || substr(opaque_hash, 3);

      INSERT INTO platform.communication_message_media (
        id,
        organization_id,
        conversation_id,
        communication_message_id,
        ordinal,
        media_kind,
        archival_status
      ) VALUES (
        created_media_id,
        candidate.organization_id,
        candidate.conversation_id,
        candidate.communication_message_id,
        0,
        'file',
        'pending'
      );

      INSERT INTO platform_private.waha_media_object_bindings (
        organization_id,
        media_id,
        communication_message_id,
        source_webhook_event_id,
        waha_session_name,
        raw_chat_id,
        raw_message_id,
        bucket_id,
        object_name
      ) VALUES (
        candidate.organization_id,
        created_media_id,
        candidate.communication_message_id,
        candidate.source_webhook_event_id,
        'evo-inbox',
        candidate.raw_chat_id,
        candidate.raw_message_id,
        'platform-whatsapp-media',
        object_name_value
      )
      RETURNING id INTO object_binding_id;

      INSERT INTO platform_private.waha_media_archive_work (
        id,
        organization_id,
        media_id,
        object_binding_id,
        state
      ) VALUES (
        created_work_id,
        candidate.organization_id,
        created_media_id,
        object_binding_id,
        'pending'
      );

      SELECT
        created_work_id AS work_id,
        created_media_id AS media_id,
        object_binding_id AS object_binding_id,
        0 AS attempt_count,
        4 AS max_attempts,
        candidate.communication_message_id AS communication_message_id,
        candidate.raw_chat_id AS raw_chat_id,
        candidate.raw_message_id AS raw_message_id,
        object_name_value AS object_name,
        candidate.direction AS direction
      INTO selected_work;
    END IF;
  END IF;

  IF selected_work.work_id IS NULL THEN
    result := jsonb_build_object(
      'claimed', FALSE,
      'queue', 'platform_waha_media_v1'
    );
    INSERT INTO platform_private.waha_media_claim_requests (
      request_id,
      organization_id,
      input_sha256,
      response
    ) VALUES (
      p_request_id,
      p_organization_id,
      input_sha256,
      result
    );
    RETURN result;
  END IF;

  lease_expires_at_value := statement_timestamp()
    + make_interval(secs => p_visibility_timeout_seconds);

  UPDATE platform_private.waha_media_archive_work
  SET
    state = 'processing',
    attempt_count = attempt_count + 1,
    current_attempt_id = attempt_id,
    worker_ref = btrim(p_worker_ref),
    leased_at = statement_timestamp(),
    lease_expires_at = lease_expires_at_value,
    last_error_code = NULL
  WHERE organization_id = p_organization_id
    AND id = selected_work.work_id;

  UPDATE platform.communication_message_media
  SET archival_status = 'processing'
  WHERE organization_id = p_organization_id
    AND id = selected_work.media_id;

  result := jsonb_build_object(
    'claimed', TRUE,
    'organization_id', p_organization_id,
    'work_id', selected_work.work_id,
    'attempt_id', attempt_id,
    'media_id', selected_work.media_id,
    'communication_message_id', selected_work.communication_message_id,
    'raw_chat_id', selected_work.raw_chat_id,
    'raw_message_id', selected_work.raw_message_id,
    'direction', selected_work.direction::TEXT,
    'object_name', selected_work.object_name,
    'attempt_number', selected_work.attempt_count + 1,
    'max_attempts', selected_work.max_attempts,
    'lease_expires_at', lease_expires_at_value
  );

  INSERT INTO platform_private.waha_media_claim_requests (
    request_id,
    organization_id,
    input_sha256,
    response
  ) VALUES (
    p_request_id,
    p_organization_id,
    input_sha256,
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
    'service:platform-waha-media',
    'media.archive.claim',
    'communication_media',
    selected_work.media_id,
    jsonb_build_object('state', 'pending'),
    result,
    'Leased one exact bound evo-inbox media archive item',
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.finish_waha_media_archive(
  p_organization_id UUID,
  p_work_id UUID,
  p_attempt_id UUID,
  p_outcome TEXT,
  p_error_code TEXT,
  p_media_kind TEXT,
  p_mime_type TEXT,
  p_file_name TEXT,
  p_size_bytes BIGINT,
  p_sha256 TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prior_effect platform_private.waha_media_archive_effects%ROWTYPE;
  work_row RECORD;
  storage_object RECORD;
  storage_reported_size TEXT;
  storage_reported_mime_type TEXT;
  storage_user_sha256 TEXT;
  storage_nested_sha256 TEXT;
  storage_flat_sha256 TEXT;
  input_sha256 TEXT;
  normalized_error_code TEXT := NULLIF(lower(btrim(p_error_code)), '');
  normalized_media_kind TEXT := NULLIF(lower(btrim(p_media_kind)), '');
  normalized_mime_type TEXT := NULLIF(lower(btrim(p_mime_type)), '');
  normalized_file_name TEXT := NULLIF(btrim(p_file_name), '');
  normalized_sha256 TEXT := NULLIF(lower(btrim(p_sha256)), '');
  resolved_outcome TEXT;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_work_id IS NULL
    OR p_attempt_id IS NULL
    OR p_outcome NOT IN ('archived', 'retryable_error', 'terminal_error')
  THEN
    RAISE EXCEPTION
      'Valid media finish identity and outcome are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'archived' THEN
    IF normalized_error_code IS NOT NULL
      OR normalized_media_kind NOT IN ('image', 'audio', 'video', 'pdf', 'file')
      OR normalized_mime_type NOT IN (
        'application/octet-stream',
        'application/pdf',
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp',
        'audio/mpeg',
        'audio/ogg',
        'audio/wav',
        'video/mp4'
      )
      OR normalized_file_name IS NULL
      OR char_length(normalized_file_name) > 255
      OR octet_length(normalized_file_name) > 1024
      OR normalized_file_name ~ '[[:cntrl:]/\\]'
      OR p_size_bytes IS NULL
      OR p_size_bytes NOT BETWEEN 1 AND 52428800
      OR normalized_sha256 IS NULL
      OR normalized_sha256 !~ '^[0-9a-f]{64}$'
      OR NOT (
        (normalized_media_kind = 'image' AND normalized_mime_type IN (
          'image/gif', 'image/jpeg', 'image/png', 'image/webp'
        ))
        OR (
          normalized_media_kind = 'video'
          AND normalized_mime_type = 'video/mp4'
        )
        OR (normalized_media_kind = 'audio' AND normalized_mime_type IN (
          'audio/mpeg', 'audio/ogg', 'audio/wav'
        ))
        OR (
          normalized_media_kind = 'pdf'
          AND normalized_mime_type = 'application/pdf'
        )
        OR (
          normalized_media_kind = 'file'
          AND normalized_mime_type = 'application/octet-stream'
        )
      )
    THEN
      RAISE EXCEPTION
        'Archived media requires one safe, internally consistent descriptor'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF normalized_error_code IS NULL
      OR normalized_error_code !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
      OR normalized_media_kind IS NOT NULL
      OR normalized_mime_type IS NOT NULL
      OR normalized_file_name IS NOT NULL
      OR p_size_bytes IS NOT NULL
      OR normalized_sha256 IS NOT NULL
    THEN
      RAISE EXCEPTION
        'Failed media finish requires only one bounded safe error code'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  input_sha256 := encode(
    sha256(convert_to(jsonb_build_object(
      'organization_id', p_organization_id,
      'work_id', p_work_id,
      'attempt_id', p_attempt_id,
      'outcome', p_outcome,
      'error_code', normalized_error_code,
      'media_kind', normalized_media_kind,
      'mime_type', normalized_mime_type,
      'file_name', normalized_file_name,
      'size_bytes', p_size_bytes,
      'sha256', normalized_sha256
    )::TEXT, 'UTF8')),
    'hex'
  );

  SELECT *
  INTO prior_effect
  FROM platform_private.waha_media_archive_effects AS effect
  WHERE effect.request_id = p_request_id;

  IF FOUND THEN
    IF prior_effect.input_sha256 <> input_sha256
      OR prior_effect.organization_id <> p_organization_id
      OR prior_effect.work_id <> p_work_id
      OR prior_effect.attempt_id <> p_attempt_id
    THEN
      RAISE EXCEPTION
        'request_id was already used with different media finish inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN prior_effect.response;
  END IF;

  SELECT
    work.id,
    work.media_id,
    work.object_binding_id,
    work.state,
    work.attempt_count,
    work.max_attempts,
    work.current_attempt_id,
    work.lease_expires_at,
    binding.communication_message_id,
    binding.bucket_id,
    binding.object_name
  INTO work_row
  FROM platform_private.waha_media_archive_work AS work
  JOIN platform_private.waha_media_object_bindings AS binding
    ON binding.organization_id = work.organization_id
    AND binding.id = work.object_binding_id
    AND binding.media_id = work.media_id
  WHERE work.organization_id = p_organization_id
    AND work.id = p_work_id
  FOR UPDATE OF work;

  IF NOT FOUND
    OR work_row.state <> 'processing'
    OR work_row.current_attempt_id <> p_attempt_id
    OR work_row.lease_expires_at <= clock_timestamp()
    OR NOT platform_private.is_bound_waha_media_candidate(
      p_organization_id,
      work_row.communication_message_id
    )
  THEN
    RAISE EXCEPTION
      'Media work lease is unavailable or no longer valid'
      USING ERRCODE = '55000';
  END IF;

  resolved_outcome := CASE
    WHEN p_outcome = 'retryable_error'
      AND work_row.attempt_count >= work_row.max_attempts
      THEN 'terminal_error'
    ELSE p_outcome
  END;

  IF resolved_outcome = 'archived' THEN
    SELECT
      object.metadata,
      to_jsonb(object) AS object_row
    INTO storage_object
    FROM storage.objects AS object
    WHERE object.bucket_id = work_row.bucket_id
      AND object.name = work_row.object_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Exact private media Storage object is missing'
        USING ERRCODE = '55000';
    END IF;

    storage_reported_size := storage_object.metadata ->> 'size';
    storage_reported_mime_type :=
      storage_object.metadata ->> 'mimetype';
    storage_user_sha256 :=
      storage_object.object_row #>> '{user_metadata,sha256}';
    storage_nested_sha256 :=
      storage_object.metadata #>> '{metadata,sha256}';
    storage_flat_sha256 := storage_object.metadata ->> 'sha256';

    IF storage_reported_size IS NULL
      OR storage_reported_size !~ '^[0-9]+$'
      OR storage_reported_size::BIGINT <> p_size_bytes
    THEN
      RAISE EXCEPTION
        'Exact private media Storage object size attestation is unavailable'
        USING ERRCODE = '55000';
    END IF;

    IF storage_reported_mime_type IS NULL
      OR lower(storage_reported_mime_type) <> normalized_mime_type
    THEN
      RAISE EXCEPTION
        'Exact private media Storage object MIME attestation is unavailable'
        USING ERRCODE = '55000';
    END IF;

    IF COALESCE(
      storage_user_sha256,
      storage_nested_sha256,
      storage_flat_sha256
    ) IS NULL
      OR (
        storage_user_sha256 IS NOT NULL
        AND lower(storage_user_sha256) <> normalized_sha256
      )
      OR (
        storage_nested_sha256 IS NOT NULL
        AND lower(storage_nested_sha256) <> normalized_sha256
      )
      OR (
        storage_flat_sha256 IS NOT NULL
        AND lower(storage_flat_sha256) <> normalized_sha256
      )
    THEN
      RAISE EXCEPTION
        'Exact private media Storage object checksum attestation is unavailable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'work_id', p_work_id,
    'attempt_id', p_attempt_id,
    'media_id', work_row.media_id,
    'state', resolved_outcome,
    'outcome', resolved_outcome
  );

  INSERT INTO platform_private.waha_media_archive_effects (
    organization_id,
    work_id,
    attempt_id,
    outcome,
    error_code,
    media_kind,
    mime_type,
    file_name,
    file_size_bytes,
    sha256_hex,
    input_sha256,
    response,
    request_id
  ) VALUES (
    p_organization_id,
    p_work_id,
    p_attempt_id,
    resolved_outcome,
    normalized_error_code,
    CASE WHEN resolved_outcome = 'archived'
      THEN normalized_media_kind::platform.communication_media_kind END,
    CASE WHEN resolved_outcome = 'archived' THEN normalized_mime_type END,
    CASE WHEN resolved_outcome = 'archived' THEN normalized_file_name END,
    CASE WHEN resolved_outcome = 'archived' THEN p_size_bytes END,
    CASE WHEN resolved_outcome = 'archived' THEN normalized_sha256 END,
    input_sha256,
    result,
    p_request_id
  );

  UPDATE platform_private.waha_media_archive_work
  SET
    state = resolved_outcome::platform.communication_media_archival_status,
    available_at = CASE
      WHEN resolved_outcome = 'retryable_error'
        THEN statement_timestamp() + make_interval(
          secs => LEAST(300, 15 * work_row.attempt_count)
        )
      ELSE available_at
    END,
    current_attempt_id = NULL,
    worker_ref = NULL,
    leased_at = NULL,
    lease_expires_at = NULL,
    last_error_code = normalized_error_code
  WHERE organization_id = p_organization_id
    AND id = p_work_id;

  UPDATE platform.communication_message_media
  SET
    media_kind = CASE
      WHEN resolved_outcome = 'archived'
        THEN normalized_media_kind::platform.communication_media_kind
      ELSE 'file'::platform.communication_media_kind
    END,
    mime_type = CASE
      WHEN resolved_outcome = 'archived' THEN normalized_mime_type
      ELSE NULL
    END,
    file_name = CASE
      WHEN resolved_outcome = 'archived' THEN normalized_file_name
      ELSE NULL
    END,
    file_size_bytes = CASE
      WHEN resolved_outcome = 'archived' THEN p_size_bytes
      ELSE NULL
    END,
    archival_status =
      resolved_outcome::platform.communication_media_archival_status,
    archived_at = CASE
      WHEN resolved_outcome = 'archived' THEN statement_timestamp()
      ELSE NULL
    END
  WHERE organization_id = p_organization_id
    AND id = work_row.media_id;

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
    'service:platform-waha-media',
    'media.archive.finish',
    'communication_media',
    work_row.media_id,
    jsonb_build_object('state', 'processing'),
    result,
    'Finished one exact leased private WAHA media archive attempt',
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.grant_communication_media_download(
  p_organization_id UUID,
  p_media_id UUID,
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
  media_row RECORD;
  prior_grant platform_private.communication_media_download_grants%ROWTYPE;
  actor_access_version BIGINT;
  grant_id UUID := gen_random_uuid();
  expires_at_value TIMESTAMPTZ := statement_timestamp() + INTERVAL '5 minutes';
  input_sha256 TEXT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_organization_id IS NULL OR p_media_id IS NULL THEN
    RAISE EXCEPTION
      'Organization and communication media are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  SELECT profile.access_version
  INTO actor_access_version
  FROM platform.profiles AS profile
  WHERE profile.id = actor.actor_profile_id
    AND profile.auth_user_id = actor.actor_auth_user_id
    AND profile.status = 'active';

  IF actor_access_version IS NULL THEN
    RAISE EXCEPTION
      'Communication media is unavailable'
      USING ERRCODE = '42501';
  END IF;

  input_sha256 := encode(
    sha256(convert_to(jsonb_build_object(
      'organization_id', p_organization_id,
      'media_id', p_media_id,
      'grantee_auth_user_id', actor.actor_auth_user_id
    )::TEXT, 'UTF8')),
    'hex'
  );

  SELECT *
  INTO prior_grant
  FROM platform_private.communication_media_download_grants AS download_grant
  WHERE download_grant.request_id = p_request_id;

  IF FOUND THEN
    IF prior_grant.input_sha256 <> input_sha256
      OR prior_grant.organization_id <> p_organization_id
      OR prior_grant.media_id <> p_media_id
      OR prior_grant.grantee_auth_user_id <> actor.actor_auth_user_id
    THEN
      RAISE EXCEPTION
        'request_id was already used with different media grant inputs'
        USING ERRCODE = '23505';
    END IF;
    RETURN prior_grant.response;
  END IF;

  SELECT
    media.id,
    media.conversation_id,
    media.archival_status,
    binding.id AS object_binding_id,
    binding.bucket_id,
    binding.object_name
  INTO media_row
  FROM platform.communication_message_media AS media
  JOIN platform_private.waha_media_object_bindings AS binding
    ON binding.organization_id = media.organization_id
    AND binding.media_id = media.id
  JOIN storage.objects AS object
    ON object.bucket_id = binding.bucket_id
    AND object.name = binding.object_name
  WHERE media.organization_id = p_organization_id
    AND media.id = p_media_id
    AND media.archival_status = 'archived'
    AND private.platform_can_read_communication_full(
      media.organization_id,
      media.conversation_id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Communication media is unavailable'
      USING ERRCODE = '42501';
  END IF;

  result := jsonb_build_object(
    'media_download_grant_id', grant_id,
    'expires_at', expires_at_value,
    'signed_url', NULL,
    'storage_api_service_sign_required', TRUE
  );

  INSERT INTO platform_private.communication_media_download_grants (
    id,
    request_id,
    input_sha256,
    organization_id,
    media_id,
    conversation_id,
    grantee_profile_id,
    grantee_membership_id,
    grantee_auth_user_id,
    grantee_role,
    grantee_access_version,
    expires_at,
    response
  ) VALUES (
    grant_id,
    p_request_id,
    input_sha256,
    p_organization_id,
    p_media_id,
    media_row.conversation_id,
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role,
    actor_access_version,
    expires_at_value,
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
    'media.download.grant',
    'communication_media',
    p_media_id,
    NULL,
    result,
    'Created one audited backend-sign-required private media grant',
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.consume_communication_media_download_grant(
  p_media_download_grant_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prior_consumption
    platform_private.communication_media_download_consumptions%ROWTYPE;
  grant_row RECORD;
  input_sha256 TEXT;
  remaining_seconds INTEGER;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_media_download_grant_id IS NULL THEN
    RAISE EXCEPTION
      'Communication media download grant is required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(convert_to(jsonb_build_object(
      'media_download_grant_id', p_media_download_grant_id,
      'operation', 'consume_communication_media_download_grant'
    )::TEXT, 'UTF8')),
    'hex'
  );

  SELECT *
  INTO prior_consumption
  FROM platform_private.communication_media_download_consumptions AS consumption
  WHERE consumption.request_id = p_request_id;

  IF FOUND THEN
    IF prior_consumption.input_sha256 <> input_sha256
      OR prior_consumption.media_download_grant_id <>
        p_media_download_grant_id
    THEN
      RAISE EXCEPTION
        'request_id was already used with a different media consumption input'
        USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION
      'Communication media download grant was already consumed'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    download_grant.id,
    download_grant.organization_id,
    download_grant.media_id,
    download_grant.conversation_id,
    download_grant.grantee_profile_id,
    download_grant.grantee_membership_id,
    download_grant.grantee_auth_user_id,
    download_grant.grantee_role,
    download_grant.grantee_access_version,
    download_grant.expires_at,
    media.media_kind,
    media.mime_type,
    media.file_name,
    media.archival_status,
    binding.id AS object_binding_id,
    binding.bucket_id,
    binding.object_name
  INTO grant_row
  FROM platform_private.communication_media_download_grants AS download_grant
  JOIN platform.communication_message_media AS media
    ON media.organization_id = download_grant.organization_id
    AND media.id = download_grant.media_id
  JOIN platform_private.waha_media_object_bindings AS binding
    ON binding.organization_id = media.organization_id
    AND binding.media_id = media.id
  JOIN storage.objects AS object
    ON object.bucket_id = binding.bucket_id
    AND object.name = binding.object_name
  WHERE download_grant.id = p_media_download_grant_id
  FOR UPDATE OF download_grant;

  IF NOT FOUND
    OR grant_row.expires_at <= clock_timestamp()
    OR grant_row.archival_status <> 'archived'
    OR EXISTS (
      SELECT 1
      FROM platform_private.communication_media_download_consumptions AS used
      WHERE used.organization_id = grant_row.organization_id
        AND used.media_download_grant_id = grant_row.id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM platform.profiles AS profile
      JOIN platform.organization_memberships AS membership
        ON membership.profile_id = profile.id
        AND membership.organization_id = grant_row.organization_id
      WHERE profile.id = grant_row.grantee_profile_id
        AND profile.auth_user_id = grant_row.grantee_auth_user_id
        AND profile.status = 'active'
        AND profile.access_version = grant_row.grantee_access_version
        AND membership.id = grant_row.grantee_membership_id
        AND membership.status = 'active'
        AND membership."current_role" = grant_row.grantee_role
    )
    OR NOT platform_private.membership_can_read_communication(
      grant_row.organization_id,
      grant_row.grantee_membership_id,
      grant_row.conversation_id
    )
  THEN
    RAISE EXCEPTION
      'Communication media download grant is unavailable'
      USING ERRCODE = '42501';
  END IF;

  remaining_seconds := LEAST(
    60,
    floor(extract(epoch FROM (
      grant_row.expires_at - clock_timestamp()
    )))::INTEGER
  );

  IF remaining_seconds < 1 THEN
    RAISE EXCEPTION
      'Communication media download grant is unavailable'
      USING ERRCODE = '42501';
  END IF;

  result := jsonb_build_object(
    'organization_id', grant_row.organization_id,
    'media_download_grant_id', grant_row.id,
    'media_id', grant_row.media_id,
    'bucket_id', grant_row.bucket_id,
    'object_name', grant_row.object_name,
    'max_signed_url_expires_in_seconds', remaining_seconds,
    'mime_type', grant_row.mime_type,
    'file_name', grant_row.file_name,
    'signed_url', NULL
  );

  INSERT INTO platform_private.communication_media_download_consumptions (
    request_id,
    input_sha256,
    organization_id,
    media_download_grant_id,
    media_id,
    object_binding_id,
    bucket_id,
    object_name,
    max_signed_url_expires_in_seconds,
    grant_expires_at,
    response
  ) VALUES (
    p_request_id,
    input_sha256,
    grant_row.organization_id,
    grant_row.id,
    grant_row.media_id,
    grant_row.object_binding_id,
    grant_row.bucket_id,
    grant_row.object_name,
    remaining_seconds,
    grant_row.expires_at,
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
    grant_row.organization_id,
    'service',
    NULL,
    'service:platform-media-signer',
    'media.download.consume',
    'communication_media',
    grant_row.media_id,
    jsonb_build_object('grant_id', grant_row.id),
    result,
    'Consumed one grant for a bounded backend Storage signature',
    p_request_id
  );

  RETURN result;
END
$$;

-- Add one bounded safe media array to the accepted staff message RPC. The
-- existing columns and authority semantics remain unchanged.
DROP FUNCTION platform.staff_conversation_messages(UUID, UUID);

CREATE FUNCTION platform.staff_conversation_messages(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  message_id UUID,
  conversation_id UUID,
  direction platform.communication_direction,
  body_text TEXT,
  language platform.communication_message_language,
  student_visible BOOLEAN,
  waha_session_name TEXT,
  waha_message_id TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  kommo_message_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ,
  media JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  ) THEN
    RAISE EXCEPTION
      'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    message.id,
    message.conversation_id,
    message.direction,
    message.body_text,
    message.language,
    message.student_visible,
    message.waha_session_name,
    message.waha_message_id,
    message.kommo_account_id,
    message.kommo_conversation_id,
    message.kommo_message_id,
    message.amocrm_account_id,
    message.amocrm_lead_id,
    message.amocrm_contact_id,
    message.created_at,
    COALESCE(media_rows.media, '[]'::JSONB)
  FROM platform.communication_messages AS message
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', bounded_media.id,
        'ordinal', bounded_media.ordinal,
        'media_kind', bounded_media.media_kind,
        'mime_type', bounded_media.mime_type,
        'file_name', bounded_media.file_name,
        'file_size_bytes', bounded_media.file_size_bytes,
        'archival_status', bounded_media.archival_status,
        'created_at', bounded_media.created_at,
        'archived_at', bounded_media.archived_at
      )
      ORDER BY bounded_media.ordinal, bounded_media.id
    ) AS media
    FROM (
      SELECT media_row.*
      FROM platform.communication_message_media AS media_row
      WHERE media_row.organization_id = message.organization_id
        AND media_row.communication_message_id = message.id
      ORDER BY media_row.ordinal, media_row.id
      LIMIT 16
    ) AS bounded_media
  ) AS media_rows ON TRUE
  WHERE message.organization_id = p_organization_id
    AND message.conversation_id = p_conversation_id
  ORDER BY message.created_at, message.id;
END
$$;

REVOKE ALL ON TABLE platform.communication_message_media
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON TABLE platform.communication_message_media TO authenticated;

REVOKE ALL ON TABLE
  platform_private.waha_media_object_bindings,
  platform_private.waha_media_archive_work,
  platform_private.waha_media_archive_effects,
  platform_private.waha_media_claim_requests,
  platform_private.communication_media_download_grants,
  platform_private.communication_media_download_consumptions
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform.claim_waha_media_archive(UUID, TEXT, INTEGER, UUID),
  platform.finish_waha_media_archive(
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    BIGINT,
    TEXT,
    UUID
  ),
  platform.grant_communication_media_download(UUID, UUID, UUID),
  platform.consume_communication_media_download_grant(UUID, UUID),
  platform.staff_conversation_messages(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.claim_waha_media_archive(UUID, TEXT, INTEGER, UUID),
  platform.finish_waha_media_archive(
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    BIGINT,
    TEXT,
    UUID
  ),
  platform.consume_communication_media_download_grant(UUID, UUID)
TO service_role;

GRANT EXECUTE ON FUNCTION
  platform.grant_communication_media_download(UUID, UUID, UUID),
  platform.staff_conversation_messages(UUID, UUID)
TO authenticated;

COMMENT ON TABLE platform.communication_message_media IS
  'Tenant-isolated safe media descriptors for already-projected communication messages; no provider or Storage object identity is exposed.';
COMMENT ON TABLE platform_private.waha_media_object_bindings IS
  'Append-only exact evo-inbox message-to-private-object reservation; a row is not proof that object bytes exist.';
COMMENT ON TABLE platform_private.waha_media_archive_work IS
  'Service-only leased P5D media archival state with stable object identity and bounded retry budget.';
COMMENT ON TABLE platform_private.waha_media_archive_effects IS
  'Append-only result evidence for every finished or expired P5D media lease.';
COMMENT ON TABLE platform_private.communication_media_download_grants IS
  'Append-only audited human authorization for one short-lived backend media signature.';
COMMENT ON TABLE platform_private.communication_media_download_consumptions IS
  'Append-only one-time service signing authorization; stores no URL or bearer token.';
COMMENT ON FUNCTION platform.claim_waha_media_archive(UUID, TEXT, INTEGER, UUID) IS
  'Claims only already-projected P5B/P5C evo-inbox media with immutable inbound/outbound direction and private provider identity.';
COMMENT ON FUNCTION platform.finish_waha_media_archive(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, UUID
) IS
  'Finishes one exact unexpired P5D lease; archived success requires a safe descriptor and an existing exact private Storage object.';
COMMENT ON FUNCTION platform.grant_communication_media_download(
  UUID, UUID, UUID
) IS
  'Creates an audited five-minute grant only for a live full-read communication actor; it returns no object identity or URL.';
COMMENT ON FUNCTION platform.consume_communication_media_download_grant(
  UUID, UUID
) IS
  'Consumes an authorized grant once and returns a backend-only object target with a signed URL ceiling of at most sixty seconds.';

COMMIT;
