-- ============================================================
-- 044_platform_communications_contracts.sql
--
-- P2F: tenant-isolated unified communication, provider-event and draft-only
-- AI data contracts. This migration performs no provider call, message send,
-- Queue operation, auto-reply, unattended outbound or production mutation.
--
-- Provider observations are evidence records, not delivery claims. Raw
-- payloads and reconciliation details stay in platform_private. Only an
-- explicitly reviewed human authorization may be linked to an outbound
-- message observation.
-- ============================================================

BEGIN;

CREATE TYPE platform.communication_queue AS ENUM (
  'sales',
  'curator'
);

CREATE TYPE platform.communication_status AS ENUM (
  'open',
  'closed'
);

CREATE TYPE platform.conversation_participant_kind AS ENUM (
  'customer',
  'sales',
  'curator',
  'admin'
);

CREATE TYPE platform.communication_direction AS ENUM (
  'inbound',
  'outbound'
);

CREATE TYPE platform.communication_message_language AS ENUM (
  'ru',
  'en',
  'undetermined'
);

CREATE TYPE platform.communication_provider AS ENUM (
  'waha',
  'kommo',
  'amocrm'
);

CREATE TYPE platform.webhook_verification_status AS ENUM (
  'verified',
  'rejected',
  'stale',
  'missing'
);

CREATE TYPE platform.provider_observation_kind AS ENUM (
  'message_observed',
  'ack_observed',
  'link_resolved',
  'conflict',
  'unknown_result'
);

CREATE TYPE platform.waha_ack_state AS ENUM (
  'error',
  'pending',
  'server',
  'device',
  'read',
  'played',
  'unknown'
);

CREATE TYPE platform.knowledge_version_status AS ENUM (
  'approved',
  'retired'
);

CREATE TYPE platform.ai_language_detection_status AS ENUM (
  'confident',
  'uncertain'
);

CREATE TYPE platform.ai_draft_language AS ENUM (
  'ru',
  'en'
);

CREATE TYPE platform.ai_draft_state AS ENUM (
  'awaiting_language_selection',
  'language_selected',
  'review_required',
  'rework_requested',
  'ready_for_manual_send',
  'manual_send_authorized',
  'handed_off'
);

CREATE TYPE platform.ai_draft_review_decision AS ENUM (
  'approved',
  'rework',
  'handoff'
);

CREATE TYPE platform.ai_draft_event_type AS ENUM (
  'created',
  'language_selected',
  'generation_completed',
  'reviewed',
  'manual_send_authorized',
  'handed_off'
);

-- Raw payloads are intentionally outside the Data API schema. A row can be
-- persisted even when verification fails, but no processing RPC accepts it
-- unless verification_status is exactly verified.
CREATE TABLE platform_private.provider_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  provider platform.communication_provider NOT NULL,
  provider_account_ref TEXT NOT NULL CHECK (
    btrim(provider_account_ref) <> ''
  ),
  provider_conversation_ref TEXT,
  provider_event_variant_ref TEXT CHECK (
    provider_event_variant_ref IS NULL
    OR btrim(provider_event_variant_ref) <> ''
  ),
  provider_request_id TEXT NOT NULL CHECK (
    btrim(provider_request_id) <> ''
  ),
  waha_session_name TEXT,
  payload_id TEXT NOT NULL CHECK (btrim(payload_id) <> ''),
  event_type TEXT NOT NULL CHECK (btrim(event_type) <> ''),
  provider_occurred_at TIMESTAMPTZ NOT NULL,
  verification_status platform.webhook_verification_status NOT NULL,
  raw_payload JSONB NOT NULL,
  verification_headers JSONB NOT NULL,
  verification_evidence_ref TEXT NOT NULL CHECK (
    btrim(verification_evidence_ref) <> ''
  ),
  payload_sha256 TEXT NOT NULL CHECK (
    lower(btrim(payload_sha256)) ~ '^[0-9a-f]{64}$'
  ),
  received_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  request_id UUID NOT NULL UNIQUE,
  CONSTRAINT provider_webhook_events_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT provider_webhook_events_provider_request_key
    UNIQUE (
      organization_id,
      provider,
      provider_account_ref,
      provider_request_id
    ),
  CONSTRAINT provider_webhook_events_waha_shape_check CHECK (
    (
      provider = 'waha'
      AND waha_session_name IS NOT NULL
      AND btrim(waha_session_name) <> ''
      AND provider_conversation_ref IS NULL
    )
    OR (
      provider = 'kommo'
      AND waha_session_name IS NULL
      AND provider_conversation_ref IS NOT NULL
      AND btrim(provider_conversation_ref) <> ''
    )
    OR (
      provider = 'amocrm'
      AND waha_session_name IS NULL
      AND provider_conversation_ref IS NULL
    )
  ),
  CONSTRAINT provider_webhook_events_variant_shape_check CHECK (
    (
      provider = 'waha'
      AND event_type = 'message.ack'
      AND provider_event_variant_ref IS NOT NULL
      AND btrim(provider_event_variant_ref) <> ''
    )
    OR (
      provider = 'waha'
      AND event_type = 'message.any'
      AND provider_event_variant_ref IS NULL
    )
    OR (
      provider = 'waha'
      AND event_type NOT IN ('message.ack', 'message.any')
    )
    OR provider IN ('kommo', 'amocrm')
  )
);

CREATE UNIQUE INDEX provider_webhook_events_waha_business_key
  ON platform_private.provider_webhook_events (
    organization_id,
    provider_account_ref,
    waha_session_name,
    event_type,
    payload_id,
    COALESCE(provider_event_variant_ref, '')
  )
  WHERE provider = 'waha';

CREATE INDEX provider_webhook_events_received_idx
  ON platform_private.provider_webhook_events (
    organization_id,
    provider,
    received_at DESC
  );

CREATE TABLE platform.communication_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  student_case_id UUID,
  responsible_sales_membership_id UUID NOT NULL,
  current_curator_membership_id UUID,
  queue platform.communication_queue NOT NULL,
  status platform.communication_status NOT NULL DEFAULT 'open',
  subject TEXT NOT NULL CHECK (btrim(subject) <> ''),
  waha_session_name TEXT NOT NULL CHECK (
    btrim(waha_session_name) <> ''
  ),
  kommo_account_id BIGINT NOT NULL CHECK (kommo_account_id > 0),
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT NOT NULL CHECK (amocrm_account_id > 0),
  amocrm_lead_id BIGINT NOT NULL CHECK (amocrm_lead_id > 0),
  amocrm_contact_id BIGINT NOT NULL CHECK (amocrm_contact_id > 0),
  current_scope_id UUID NOT NULL,
  current_scope_version BIGINT NOT NULL CHECK (
    current_scope_version > 0
  ),
  created_from_webhook_event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT communication_conversations_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT communication_conversations_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT communication_conversations_sales_fkey
    FOREIGN KEY (organization_id, responsible_sales_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT communication_conversations_curator_fkey
    FOREIGN KEY (organization_id, current_curator_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT communication_conversations_scope_fkey
    FOREIGN KEY (
      organization_id,
      current_scope_id,
      current_scope_version
    )
    REFERENCES platform.record_scopes(
      organization_id,
      id,
      scope_version
    )
    ON DELETE RESTRICT,
  CONSTRAINT communication_conversations_source_event_fkey
    FOREIGN KEY (
      organization_id,
      created_from_webhook_event_id
    )
    REFERENCES platform_private.provider_webhook_events(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT communication_conversations_queue_shape_check CHECK (
    (
      queue = 'sales'
      AND current_curator_membership_id IS NULL
    )
    OR (
      queue = 'curator'
      AND student_case_id IS NOT NULL
      AND current_curator_membership_id IS NOT NULL
    )
  ),
  CONSTRAINT communication_conversations_kommo_id_check CHECK (
    kommo_conversation_id IS NULL
    OR btrim(kommo_conversation_id) <> ''
  )
);

CREATE UNIQUE INDEX communication_conversations_kommo_key
  ON platform.communication_conversations (
    organization_id,
    kommo_account_id,
    kommo_conversation_id
  )
  WHERE kommo_conversation_id IS NOT NULL;

CREATE UNIQUE INDEX communication_conversations_amocrm_lead_key
  ON platform.communication_conversations (
    organization_id,
    amocrm_account_id,
    amocrm_lead_id
  );

CREATE INDEX communication_conversations_case_queue_idx
  ON platform.communication_conversations (
    organization_id,
    student_case_id,
    queue,
    status
  )
  WHERE student_case_id IS NOT NULL;

CREATE INDEX communication_conversations_sales_queue_idx
  ON platform.communication_conversations (
    organization_id,
    responsible_sales_membership_id,
    status
  )
  WHERE queue = 'sales';

CREATE INDEX communication_conversations_curator_queue_idx
  ON platform.communication_conversations (
    organization_id,
    current_curator_membership_id,
    status
  )
  WHERE queue = 'curator';

CREATE INDEX communication_conversations_scope_idx
  ON platform.communication_conversations (
    organization_id,
    current_scope_id,
    current_scope_version
  );

CREATE INDEX communication_conversations_source_event_idx
  ON platform.communication_conversations (
    organization_id,
    created_from_webhook_event_id
  );

ALTER TABLE platform.student_case_assignment_events
  ADD CONSTRAINT student_case_assignment_events_organization_id_id_key
  UNIQUE (organization_id, id);

CREATE TABLE platform.conversation_handoff_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  previous_student_case_id UUID,
  new_student_case_id UUID,
  previous_queue platform.communication_queue,
  new_queue platform.communication_queue NOT NULL,
  previous_owner_membership_id UUID,
  new_owner_membership_id UUID NOT NULL,
  source_webhook_event_id UUID,
  student_case_assignment_event_id UUID,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT conversation_handoff_events_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_handoff_events_previous_case_fkey
    FOREIGN KEY (organization_id, previous_student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_handoff_events_new_case_fkey
    FOREIGN KEY (organization_id, new_student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_handoff_events_previous_owner_fkey
    FOREIGN KEY (organization_id, previous_owner_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_handoff_events_new_owner_fkey
    FOREIGN KEY (organization_id, new_owner_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_handoff_events_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT conversation_handoff_events_assignment_event_fkey
    FOREIGN KEY (
      organization_id,
      student_case_assignment_event_id
    )
    REFERENCES platform.student_case_assignment_events(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT conversation_handoff_events_transition_check CHECK (
    (
      previous_queue IS NULL
      AND previous_owner_membership_id IS NULL
    )
    OR (
      previous_queue IS NOT NULL
      AND previous_owner_membership_id IS NOT NULL
    )
  ),
  CONSTRAINT conversation_handoff_events_authority_check CHECK (
    (
      source_webhook_event_id IS NOT NULL
      AND student_case_assignment_event_id IS NULL
    )
    OR (
      source_webhook_event_id IS NULL
      AND student_case_assignment_event_id IS NOT NULL
    )
  )
);

CREATE INDEX conversation_handoff_events_conversation_idx
  ON platform.conversation_handoff_events (
    organization_id,
    conversation_id,
    created_at
  );

CREATE INDEX conversation_handoff_events_previous_case_idx
  ON platform.conversation_handoff_events (
    organization_id,
    previous_student_case_id
  )
  WHERE previous_student_case_id IS NOT NULL;

CREATE INDEX conversation_handoff_events_new_case_idx
  ON platform.conversation_handoff_events (
    organization_id,
    new_student_case_id
  )
  WHERE new_student_case_id IS NOT NULL;

CREATE INDEX conversation_handoff_events_previous_owner_idx
  ON platform.conversation_handoff_events (
    organization_id,
    previous_owner_membership_id
  )
  WHERE previous_owner_membership_id IS NOT NULL;

CREATE INDEX conversation_handoff_events_new_owner_idx
  ON platform.conversation_handoff_events (
    organization_id,
    new_owner_membership_id
  );

CREATE INDEX conversation_handoff_events_assignment_event_idx
  ON platform.conversation_handoff_events (
    organization_id,
    student_case_assignment_event_id
  )
  WHERE student_case_assignment_event_id IS NOT NULL;

CREATE INDEX conversation_handoff_events_source_idx
  ON platform.conversation_handoff_events (
    organization_id,
    source_webhook_event_id
  );

CREATE TABLE platform.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  participant_kind platform.conversation_participant_kind NOT NULL,
  membership_id UUID,
  external_subject_ref TEXT,
  source_webhook_event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT conversation_participants_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT conversation_participants_parent_identity_key
    UNIQUE (organization_id, id, conversation_id),
  CONSTRAINT conversation_participants_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_participants_membership_fkey
    FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_participants_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT conversation_participants_subject_shape_check CHECK (
    (
      participant_kind = 'customer'
      AND external_subject_ref IS NOT NULL
      AND btrim(external_subject_ref) <> ''
    )
    OR (
      participant_kind IN ('sales', 'curator', 'admin')
      AND membership_id IS NOT NULL
      AND external_subject_ref IS NULL
    )
  )
);

CREATE UNIQUE INDEX conversation_participants_membership_key
  ON platform.conversation_participants (
    organization_id,
    conversation_id,
    participant_kind,
    membership_id
  )
  WHERE membership_id IS NOT NULL;

CREATE UNIQUE INDEX conversation_participants_external_key
  ON platform.conversation_participants (
    organization_id,
    conversation_id,
    participant_kind,
    external_subject_ref
  )
  WHERE external_subject_ref IS NOT NULL;

CREATE INDEX conversation_participants_source_idx
  ON platform.conversation_participants (
    organization_id,
    source_webhook_event_id
  );

CREATE TABLE platform.communication_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  student_case_id UUID,
  sender_participant_id UUID NOT NULL,
  direction platform.communication_direction NOT NULL,
  body_text TEXT NOT NULL CHECK (btrim(body_text) <> ''),
  language platform.communication_message_language NOT NULL,
  student_visible BOOLEAN NOT NULL DEFAULT FALSE,
  waha_session_name TEXT,
  waha_message_id TEXT,
  kommo_account_id BIGINT NOT NULL CHECK (kommo_account_id > 0),
  kommo_conversation_id TEXT,
  kommo_message_id TEXT,
  amocrm_account_id BIGINT NOT NULL CHECK (amocrm_account_id > 0),
  amocrm_lead_id BIGINT NOT NULL CHECK (amocrm_lead_id > 0),
  amocrm_contact_id BIGINT NOT NULL CHECK (amocrm_contact_id > 0),
  source_webhook_event_id UUID NOT NULL,
  manual_send_authorization_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT communication_messages_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT communication_messages_parent_identity_key
    UNIQUE (organization_id, id, conversation_id),
  CONSTRAINT communication_messages_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT communication_messages_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT communication_messages_sender_fkey
    FOREIGN KEY (
      organization_id,
      sender_participant_id,
      conversation_id
    )
    REFERENCES platform.conversation_participants(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT communication_messages_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT communication_messages_direction_shape_check CHECK (
    (
      direction = 'inbound'
      AND manual_send_authorization_id IS NULL
    )
    OR (
      direction = 'outbound'
      AND manual_send_authorization_id IS NOT NULL
    )
  ),
  CONSTRAINT communication_messages_waha_shape_check CHECK (
    (
      waha_message_id IS NULL
      AND waha_session_name IS NULL
    )
    OR (
      waha_message_id IS NOT NULL
      AND btrim(waha_message_id) <> ''
      AND waha_session_name IS NOT NULL
      AND btrim(waha_session_name) <> ''
    )
  ),
  CONSTRAINT communication_messages_kommo_shape_check CHECK (
    (
      kommo_message_id IS NULL
      AND kommo_conversation_id IS NULL
    )
    OR (
      kommo_message_id IS NOT NULL
      AND btrim(kommo_message_id) <> ''
      AND kommo_conversation_id IS NOT NULL
      AND btrim(kommo_conversation_id) <> ''
    )
  ),
  CONSTRAINT communication_messages_provider_identity_check CHECK (
    waha_message_id IS NOT NULL
    OR kommo_message_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX communication_messages_waha_key
  ON platform.communication_messages (
    organization_id,
    waha_session_name,
    waha_message_id
  )
  WHERE waha_message_id IS NOT NULL;

CREATE UNIQUE INDEX communication_messages_kommo_key
  ON platform.communication_messages (
    organization_id,
    kommo_account_id,
    kommo_conversation_id,
    kommo_message_id
  )
  WHERE kommo_message_id IS NOT NULL;

CREATE INDEX communication_messages_conversation_created_idx
  ON platform.communication_messages (
    organization_id,
    conversation_id,
    created_at,
    id
  );

CREATE INDEX communication_messages_case_created_idx
  ON platform.communication_messages (
    organization_id,
    student_case_id,
    created_at,
    id
  )
  WHERE student_case_id IS NOT NULL;

CREATE INDEX communication_messages_sender_idx
  ON platform.communication_messages (
    organization_id,
    sender_participant_id,
    conversation_id
  );

CREATE INDEX communication_messages_source_idx
  ON platform.communication_messages (
    organization_id,
    source_webhook_event_id
  );

CREATE TABLE platform.approved_knowledge_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  knowledge_key TEXT NOT NULL CHECK (
    knowledge_key ~ '^[a-z][a-z0-9_.-]*$'
  ),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  version BIGINT NOT NULL CHECK (version > 0),
  status platform.knowledge_version_status NOT NULL DEFAULT 'approved',
  content_text TEXT NOT NULL CHECK (btrim(content_text) <> ''),
  content_sha256 TEXT NOT NULL CHECK (
    lower(btrim(content_sha256)) ~ '^[0-9a-f]{64}$'
  ),
  provenance_ref TEXT NOT NULL CHECK (btrim(provenance_ref) <> ''),
  approved_by_membership_id UUID NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  retired_by_membership_id UUID,
  retired_at TIMESTAMPTZ,
  retirement_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT approved_knowledge_versions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT approved_knowledge_versions_key_version_key
    UNIQUE (organization_id, knowledge_key, version),
  CONSTRAINT approved_knowledge_versions_approver_fkey
    FOREIGN KEY (organization_id, approved_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT approved_knowledge_versions_retirer_fkey
    FOREIGN KEY (organization_id, retired_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT approved_knowledge_versions_status_shape_check CHECK (
    (
      status = 'approved'
      AND retired_by_membership_id IS NULL
      AND retired_at IS NULL
      AND retirement_reason IS NULL
    )
    OR (
      status = 'retired'
      AND retired_by_membership_id IS NOT NULL
      AND retired_at IS NOT NULL
      AND retirement_reason IS NOT NULL
      AND btrim(retirement_reason) <> ''
    )
  )
);

CREATE INDEX approved_knowledge_versions_status_key_idx
  ON platform.approved_knowledge_versions (
    organization_id,
    status,
    knowledge_key,
    version DESC
  );

CREATE INDEX approved_knowledge_versions_approver_idx
  ON platform.approved_knowledge_versions (
    organization_id,
    approved_by_membership_id
  );

CREATE INDEX approved_knowledge_versions_retirer_idx
  ON platform.approved_knowledge_versions (
    organization_id,
    retired_by_membership_id
  )
  WHERE retired_by_membership_id IS NOT NULL;

CREATE TABLE platform.ai_draft_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  student_case_id UUID,
  source_message_id UUID NOT NULL,
  requested_language platform.ai_draft_language,
  requested_by_profile_id UUID NOT NULL,
  requested_by_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL UNIQUE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_draft_requests_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT ai_draft_requests_parent_identity_key
    UNIQUE (
      organization_id,
      id,
      conversation_id,
      source_message_id
    ),
  CONSTRAINT ai_draft_requests_source_key
    UNIQUE (organization_id, source_message_id),
  CONSTRAINT ai_draft_requests_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_requests_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_requests_message_fkey
    FOREIGN KEY (
      organization_id,
      source_message_id,
      conversation_id
    )
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_requests_profile_fkey
    FOREIGN KEY (requested_by_profile_id)
    REFERENCES platform.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_requests_membership_fkey
    FOREIGN KEY (organization_id, requested_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX ai_draft_requests_conversation_idx
  ON platform.ai_draft_requests (
    organization_id,
    conversation_id,
    requested_at DESC
  );

CREATE INDEX ai_draft_requests_case_idx
  ON platform.ai_draft_requests (
    organization_id,
    student_case_id
  )
  WHERE student_case_id IS NOT NULL;

CREATE INDEX ai_draft_requests_requester_idx
  ON platform.ai_draft_requests (
    organization_id,
    requested_by_membership_id,
    requested_at DESC
  );

CREATE TABLE platform.ai_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  student_case_id UUID,
  source_message_id UUID NOT NULL,
  ai_draft_request_id UUID NOT NULL,
  supersedes_ai_draft_id UUID,
  detection_status platform.ai_language_detection_status NOT NULL,
  selected_language platform.ai_draft_language,
  knowledge_version_id UUID,
  provider_ref TEXT,
  model_ref TEXT,
  prompt_policy_version TEXT,
  source_context JSONB NOT NULL,
  source_context_sha256 TEXT NOT NULL CHECK (
    lower(btrim(source_context_sha256)) ~ '^[0-9a-f]{64}$'
  ),
  generated_text TEXT,
  generated_text_sha256 TEXT CHECK (
    generated_text_sha256 IS NULL
    OR lower(btrim(generated_text_sha256)) ~ '^[0-9a-f]{64}$'
  ),
  failure_outcome TEXT,
  state platform.ai_draft_state NOT NULL,
  reviewed_text TEXT,
  reviewed_text_sha256 TEXT CHECK (
    reviewed_text_sha256 IS NULL
    OR lower(btrim(reviewed_text_sha256)) ~ '^[0-9a-f]{64}$'
  ),
  reviewed_by_membership_id UUID,
  reviewed_at TIMESTAMPTZ,
  review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_drafts_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT ai_drafts_parent_identity_key
    UNIQUE (organization_id, id, conversation_id),
  CONSTRAINT ai_drafts_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_drafts_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_drafts_source_message_fkey
    FOREIGN KEY (
      organization_id,
      source_message_id,
      conversation_id
    )
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_drafts_request_fkey
    FOREIGN KEY (
      organization_id,
      ai_draft_request_id,
      conversation_id,
      source_message_id
    )
    REFERENCES platform.ai_draft_requests(
      organization_id,
      id,
      conversation_id,
      source_message_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_drafts_supersedes_fkey
    FOREIGN KEY (
      organization_id,
      supersedes_ai_draft_id,
      conversation_id
    )
    REFERENCES platform.ai_drafts(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_drafts_knowledge_fkey
    FOREIGN KEY (organization_id, knowledge_version_id)
    REFERENCES platform.approved_knowledge_versions(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_drafts_reviewer_fkey
    FOREIGN KEY (organization_id, reviewed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_drafts_language_shape_check CHECK (
    (
      detection_status = 'uncertain'
      AND state = 'awaiting_language_selection'
      AND selected_language IS NULL
      AND knowledge_version_id IS NULL
      AND provider_ref IS NULL
      AND model_ref IS NULL
      AND prompt_policy_version IS NULL
      AND generated_text IS NULL
      AND generated_text_sha256 IS NULL
      AND failure_outcome IS NOT NULL
      AND btrim(failure_outcome) <> ''
      AND reviewed_text IS NULL
      AND reviewed_text_sha256 IS NULL
      AND reviewed_by_membership_id IS NULL
      AND reviewed_at IS NULL
      AND review_reason IS NULL
    )
    OR (
      state = 'language_selected'
      AND selected_language IS NOT NULL
      AND knowledge_version_id IS NULL
      AND provider_ref IS NULL
      AND model_ref IS NULL
      AND prompt_policy_version IS NULL
      AND generated_text IS NULL
      AND generated_text_sha256 IS NULL
      AND reviewed_text IS NULL
      AND reviewed_text_sha256 IS NULL
      AND reviewed_by_membership_id IS NULL
      AND reviewed_at IS NULL
      AND review_reason IS NULL
    )
    OR (
      state = 'review_required'
      AND selected_language IS NOT NULL
      AND knowledge_version_id IS NOT NULL
      AND provider_ref IS NOT NULL
      AND btrim(provider_ref) <> ''
      AND model_ref IS NOT NULL
      AND btrim(model_ref) <> ''
      AND prompt_policy_version IS NOT NULL
      AND btrim(prompt_policy_version) <> ''
      AND generated_text IS NOT NULL
      AND btrim(generated_text) <> ''
      AND generated_text_sha256 IS NOT NULL
      AND failure_outcome IS NULL
      AND reviewed_text IS NULL
      AND reviewed_text_sha256 IS NULL
      AND reviewed_by_membership_id IS NULL
      AND reviewed_at IS NULL
      AND review_reason IS NULL
    )
    OR (
      state = 'rework_requested'
      AND selected_language IS NOT NULL
      AND knowledge_version_id IS NOT NULL
      AND provider_ref IS NOT NULL
      AND btrim(provider_ref) <> ''
      AND model_ref IS NOT NULL
      AND btrim(model_ref) <> ''
      AND prompt_policy_version IS NOT NULL
      AND btrim(prompt_policy_version) <> ''
      AND generated_text IS NOT NULL
      AND btrim(generated_text) <> ''
      AND generated_text_sha256 IS NOT NULL
      AND reviewed_text IS NULL
      AND reviewed_text_sha256 IS NULL
      AND reviewed_by_membership_id IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND review_reason IS NOT NULL
      AND btrim(review_reason) <> ''
    )
    OR (
      state IN ('ready_for_manual_send', 'manual_send_authorized')
      AND selected_language IS NOT NULL
      AND knowledge_version_id IS NOT NULL
      AND provider_ref IS NOT NULL
      AND btrim(provider_ref) <> ''
      AND model_ref IS NOT NULL
      AND btrim(model_ref) <> ''
      AND prompt_policy_version IS NOT NULL
      AND btrim(prompt_policy_version) <> ''
      AND generated_text IS NOT NULL
      AND btrim(generated_text) <> ''
      AND generated_text_sha256 IS NOT NULL
      AND failure_outcome IS NULL
      AND reviewed_text IS NOT NULL
      AND btrim(reviewed_text) <> ''
      AND reviewed_text_sha256 IS NOT NULL
      AND reviewed_by_membership_id IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND review_reason IS NOT NULL
      AND btrim(review_reason) <> ''
    )
    OR (
      state = 'handed_off'
      AND review_reason IS NOT NULL
      AND btrim(review_reason) <> ''
    )
  ),
  CONSTRAINT ai_drafts_confident_shape_check CHECK (
    detection_status <> 'confident'
    OR (
      selected_language IS NOT NULL
      AND state NOT IN (
        'awaiting_language_selection',
        'language_selected'
      )
    )
  )
);

CREATE UNIQUE INDEX ai_drafts_source_open_key
  ON platform.ai_drafts (
    organization_id,
    source_message_id
  )
  WHERE state NOT IN ('handed_off', 'rework_requested');

CREATE UNIQUE INDEX ai_drafts_supersedes_key
  ON platform.ai_drafts (
    organization_id,
    supersedes_ai_draft_id
  )
  WHERE supersedes_ai_draft_id IS NOT NULL;

CREATE INDEX ai_drafts_conversation_state_idx
  ON platform.ai_drafts (
    organization_id,
    conversation_id,
    state,
    created_at DESC
  );

CREATE INDEX ai_drafts_case_idx
  ON platform.ai_drafts (
    organization_id,
    student_case_id
  )
  WHERE student_case_id IS NOT NULL;

CREATE INDEX ai_drafts_knowledge_idx
  ON platform.ai_drafts (
    organization_id,
    knowledge_version_id
  )
  WHERE knowledge_version_id IS NOT NULL;

CREATE INDEX ai_drafts_reviewer_idx
  ON platform.ai_drafts (
    organization_id,
    reviewed_by_membership_id
  )
  WHERE reviewed_by_membership_id IS NOT NULL;

CREATE TABLE platform.ai_draft_knowledge_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  ai_draft_id UUID NOT NULL,
  knowledge_version_id UUID NOT NULL,
  citation_order BIGINT NOT NULL CHECK (citation_order > 0),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_draft_knowledge_citations_draft_fkey
    FOREIGN KEY (
      organization_id,
      ai_draft_id,
      conversation_id
    )
    REFERENCES platform.ai_drafts(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_knowledge_citations_knowledge_fkey
    FOREIGN KEY (organization_id, knowledge_version_id)
    REFERENCES platform.approved_knowledge_versions(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_knowledge_citations_draft_order_key
    UNIQUE (organization_id, ai_draft_id, citation_order),
  CONSTRAINT ai_draft_knowledge_citations_draft_knowledge_key
    UNIQUE (organization_id, ai_draft_id, knowledge_version_id)
);

CREATE INDEX ai_draft_knowledge_citations_knowledge_idx
  ON platform.ai_draft_knowledge_citations (
    organization_id,
    knowledge_version_id,
    ai_draft_id
  );

CREATE TABLE platform.ai_draft_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  ai_draft_id UUID NOT NULL,
  event_type platform.ai_draft_event_type NOT NULL,
  previous_state platform.ai_draft_state,
  new_state platform.ai_draft_state NOT NULL,
  selected_language platform.ai_draft_language,
  knowledge_version_id UUID,
  review_decision platform.ai_draft_review_decision,
  content_text TEXT,
  actor_kind platform.audit_actor_kind NOT NULL,
  actor_profile_id UUID,
  actor_membership_id UUID,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_draft_events_draft_fkey
    FOREIGN KEY (
      organization_id,
      ai_draft_id,
      conversation_id
    )
    REFERENCES platform.ai_drafts(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_events_knowledge_fkey
    FOREIGN KEY (organization_id, knowledge_version_id)
    REFERENCES platform.approved_knowledge_versions(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_events_actor_profile_fkey
    FOREIGN KEY (actor_profile_id)
    REFERENCES platform.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_events_actor_membership_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_events_actor_shape_check CHECK (
    (
      actor_kind = 'user'
      AND actor_profile_id IS NOT NULL
      AND actor_membership_id IS NOT NULL
    )
    OR (
      actor_kind <> 'user'
      AND actor_profile_id IS NULL
      AND actor_membership_id IS NULL
    )
  ),
  CONSTRAINT ai_draft_events_state_change_check CHECK (
    previous_state IS NULL OR previous_state <> new_state
  ),
  CONSTRAINT ai_draft_events_content_check CHECK (
    content_text IS NULL OR btrim(content_text) <> ''
  )
);

CREATE INDEX ai_draft_events_draft_idx
  ON platform.ai_draft_events (
    organization_id,
    ai_draft_id,
    created_at
  );

CREATE INDEX ai_draft_events_knowledge_idx
  ON platform.ai_draft_events (
    organization_id,
    knowledge_version_id
  )
  WHERE knowledge_version_id IS NOT NULL;

CREATE INDEX ai_draft_events_actor_idx
  ON platform.ai_draft_events (
    organization_id,
    actor_membership_id
  )
  WHERE actor_membership_id IS NOT NULL;

CREATE TABLE platform.manual_send_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  ai_draft_id UUID NOT NULL,
  final_text TEXT NOT NULL CHECK (btrim(final_text) <> ''),
  final_text_sha256 TEXT NOT NULL CHECK (
    lower(btrim(final_text_sha256)) ~ '^[0-9a-f]{64}$'
  ),
  authorized_by_profile_id UUID NOT NULL,
  authorized_by_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL UNIQUE,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT manual_send_authorizations_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT manual_send_authorizations_parent_identity_key
    UNIQUE (organization_id, id, conversation_id),
  CONSTRAINT manual_send_authorizations_draft_key
    UNIQUE (organization_id, ai_draft_id),
  CONSTRAINT manual_send_authorizations_draft_fkey
    FOREIGN KEY (
      organization_id,
      ai_draft_id,
      conversation_id
    )
    REFERENCES platform.ai_drafts(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT manual_send_authorizations_profile_fkey
    FOREIGN KEY (authorized_by_profile_id)
    REFERENCES platform.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_send_authorizations_membership_fkey
    FOREIGN KEY (organization_id, authorized_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX manual_send_authorizations_actor_idx
  ON platform.manual_send_authorizations (
    organization_id,
    authorized_by_membership_id,
    authorized_at DESC
  );

ALTER TABLE platform.communication_messages
  ADD CONSTRAINT communication_messages_manual_authorization_fkey
  FOREIGN KEY (
    organization_id,
    manual_send_authorization_id,
    conversation_id
  )
  REFERENCES platform.manual_send_authorizations(
    organization_id,
    id,
    conversation_id
  )
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX communication_messages_manual_authorization_key
  ON platform.communication_messages (
    organization_id,
    manual_send_authorization_id
  )
  WHERE manual_send_authorization_id IS NOT NULL;

CREATE TABLE platform_private.provider_reconciliation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  source_webhook_event_id UUID,
  conversation_id UUID,
  communication_message_id UUID,
  manual_send_authorization_id UUID,
  observation_kind platform.provider_observation_kind NOT NULL,
  ack_state platform.waha_ack_state,
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  requires_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
  request_id UUID NOT NULL UNIQUE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT provider_reconciliation_events_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT provider_reconciliation_events_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT provider_reconciliation_events_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT provider_reconciliation_events_message_fkey
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
  CONSTRAINT provider_reconciliation_events_manual_authorization_fkey
    FOREIGN KEY (
      organization_id,
      manual_send_authorization_id,
      conversation_id
    )
    REFERENCES platform.manual_send_authorizations(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT provider_reconciliation_events_shape_check CHECK (
    (
      observation_kind = 'ack_observed'
      AND source_webhook_event_id IS NOT NULL
      AND communication_message_id IS NOT NULL
      AND manual_send_authorization_id IS NULL
      AND conversation_id IS NOT NULL
      AND ack_state IS NOT NULL
      AND ack_state <> 'unknown'
      AND NOT requires_manual_review
    )
    OR (
      observation_kind = 'unknown_result'
      AND source_webhook_event_id IS NULL
      AND conversation_id IS NOT NULL
      AND manual_send_authorization_id IS NOT NULL
      AND ack_state = 'unknown'
      AND requires_manual_review
    )
    OR (
      observation_kind IN (
        'message_observed',
        'link_resolved',
        'conflict'
      )
      AND source_webhook_event_id IS NOT NULL
      AND ack_state IS NULL
      AND manual_send_authorization_id IS NULL
      AND (
        observation_kind = 'conflict'
        OR NOT requires_manual_review
      )
    )
  )
);

CREATE INDEX provider_reconciliation_events_source_idx
  ON platform_private.provider_reconciliation_events (
    organization_id,
    source_webhook_event_id,
    observed_at
  )
  WHERE source_webhook_event_id IS NOT NULL;

CREATE INDEX provider_reconciliation_events_conversation_idx
  ON platform_private.provider_reconciliation_events (
    organization_id,
    conversation_id,
    observed_at
  )
  WHERE conversation_id IS NOT NULL;

CREATE INDEX provider_reconciliation_events_message_idx
  ON platform_private.provider_reconciliation_events (
    organization_id,
    communication_message_id,
    observed_at
  )
  WHERE communication_message_id IS NOT NULL;

CREATE INDEX provider_reconciliation_events_manual_authorization_idx
  ON platform_private.provider_reconciliation_events (
    organization_id,
    manual_send_authorization_id,
    observed_at
  )
  WHERE manual_send_authorization_id IS NOT NULL;

CREATE UNIQUE INDEX provider_reconciliation_events_source_effect_key
  ON platform_private.provider_reconciliation_events (
    organization_id,
    source_webhook_event_id,
    observation_kind,
    conversation_id,
    communication_message_id,
    ack_state
  )
  NULLS NOT DISTINCT
  WHERE source_webhook_event_id IS NOT NULL;

CREATE UNIQUE INDEX provider_reconciliation_events_unknown_authorization_key
  ON platform_private.provider_reconciliation_events (
    organization_id,
    manual_send_authorization_id
  )
  WHERE observation_kind = 'unknown_result';

-- All P2F relations fail closed, including the two non-exposed private
-- evidence tables. Owner-level routines execute as postgres; browser and
-- service roles receive no direct private or mutation grant.
ALTER TABLE platform_private.provider_webhook_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.provider_webhook_events
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_conversations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_conversations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.conversation_handoff_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.conversation_handoff_events
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.conversation_participants
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.conversation_participants
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_messages
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_messages
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.approved_knowledge_versions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.approved_knowledge_versions
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_draft_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_draft_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_draft_knowledge_citations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_draft_knowledge_citations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_draft_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_draft_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.manual_send_authorizations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.manual_send_authorizations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.provider_reconciliation_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.provider_reconciliation_events
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER communication_conversations_identity_immutable
  BEFORE UPDATE ON platform.communication_conversations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'responsible_sales_membership_id',
    'subject',
    'waha_session_name',
    'kommo_account_id',
    'kommo_conversation_id',
    'amocrm_account_id',
    'amocrm_lead_id',
    'amocrm_contact_id',
    'created_from_webhook_event_id',
    'created_at'
  );

CREATE TRIGGER approved_knowledge_versions_identity_immutable
  BEFORE UPDATE ON platform.approved_knowledge_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'knowledge_key',
    'title',
    'version',
    'content_text',
    'content_sha256',
    'provenance_ref',
    'approved_by_membership_id',
    'approved_at',
    'created_at'
  );

CREATE TRIGGER ai_drafts_identity_immutable
  BEFORE UPDATE ON platform.ai_drafts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'conversation_id',
    'student_case_id',
    'source_message_id',
    'ai_draft_request_id',
    'supersedes_ai_draft_id',
    'detection_status',
    'source_context',
    'source_context_sha256',
    'created_at'
  );

CREATE TRIGGER communication_conversations_set_updated_at
  BEFORE UPDATE ON platform.communication_conversations
  FOR EACH ROW EXECUTE FUNCTION platform_private.set_updated_at();

CREATE TRIGGER approved_knowledge_versions_set_updated_at
  BEFORE UPDATE ON platform.approved_knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION platform_private.set_updated_at();

CREATE TRIGGER ai_drafts_set_updated_at
  BEFORE UPDATE ON platform.ai_drafts
  FOR EACH ROW EXECUTE FUNCTION platform_private.set_updated_at();

CREATE OR REPLACE FUNCTION platform_private.guard_p2f_parent_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'communication_conversations' THEN
    IF OLD.student_case_id IS NOT NULL
      AND NEW.student_case_id IS DISTINCT FROM OLD.student_case_id
    THEN
      RAISE EXCEPTION
        'A linked conversation cannot be moved to another case'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.queue = 'curator'
      AND NEW.queue IS DISTINCT FROM OLD.queue
    THEN
      RAISE EXCEPTION
        'A Curator conversation cannot return to the Sales queue'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'closed'
      AND NEW.status IS DISTINCT FROM OLD.status
    THEN
      RAISE EXCEPTION
        'A closed communication conversation cannot be reopened'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.student_case_id IS NOT DISTINCT FROM OLD.student_case_id
      AND NEW.queue IS NOT DISTINCT FROM OLD.queue
      AND NEW.current_curator_membership_id IS NOT DISTINCT FROM
        OLD.current_curator_membership_id
      AND NEW.current_scope_id IS NOT DISTINCT FROM OLD.current_scope_id
      AND NEW.current_scope_version IS NOT DISTINCT FROM
        OLD.current_scope_version
      AND NEW.status IS NOT DISTINCT FROM OLD.status
    THEN
      RAISE EXCEPTION
        'Conversation update requires a reviewed link, handoff or close change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'approved_knowledge_versions' THEN
    IF OLD.status <> 'approved' OR NEW.status <> 'retired' THEN
      RAISE EXCEPTION
        'Approved knowledge may transition only to retired'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'ai_drafts' THEN
    IF (
      OLD.selected_language IS NOT NULL
      AND NEW.selected_language IS DISTINCT FROM OLD.selected_language
    )
      OR (
        OLD.knowledge_version_id IS NOT NULL
        AND NEW.knowledge_version_id IS DISTINCT FROM
          OLD.knowledge_version_id
      )
      OR (
        OLD.provider_ref IS NOT NULL
        AND NEW.provider_ref IS DISTINCT FROM OLD.provider_ref
      )
      OR (
        OLD.model_ref IS NOT NULL
        AND NEW.model_ref IS DISTINCT FROM OLD.model_ref
      )
      OR (
        OLD.prompt_policy_version IS NOT NULL
        AND NEW.prompt_policy_version IS DISTINCT FROM
          OLD.prompt_policy_version
      )
      OR (
        OLD.source_context IS DISTINCT FROM NEW.source_context
      )
      OR (
        OLD.source_context_sha256 IS DISTINCT FROM
          NEW.source_context_sha256
      )
      OR (
        OLD.generated_text IS NOT NULL
        AND NEW.generated_text IS DISTINCT FROM OLD.generated_text
      )
      OR (
        OLD.generated_text_sha256 IS NOT NULL
        AND NEW.generated_text_sha256 IS DISTINCT FROM
          OLD.generated_text_sha256
      )
    THEN
      RAISE EXCEPTION
        'Original AI generation evidence is immutable once recorded'
        USING ERRCODE = '55000';
    END IF;

    IF NOT (
      (
        OLD.state = 'awaiting_language_selection'
        AND NEW.state IN ('language_selected', 'handed_off')
      )
      OR (
        OLD.state = 'language_selected'
        AND NEW.state IN ('review_required', 'handed_off')
      )
      OR (
        OLD.state = 'review_required'
        AND NEW.state IN (
          'rework_requested',
          'ready_for_manual_send',
          'handed_off'
        )
      )
      OR (
        OLD.state = 'ready_for_manual_send'
        AND NEW.state IN ('manual_send_authorized', 'handed_off')
      )
    ) THEN
      RAISE EXCEPTION
        'AI draft transition is not allowed'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION
      'Unexpected P2F guarded table %',
      TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.sync_case_assignment_conversations()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation_row platform.communication_conversations%ROWTYPE;
  previous_owner UUID;
BEGIN
  FOR conversation_row IN
    SELECT conversation.*
    FROM platform.communication_conversations AS conversation
    WHERE conversation.organization_id = NEW.organization_id
      AND conversation.student_case_id = NEW.student_case_id
      AND (
        conversation.queue <> 'curator'
        OR conversation.current_curator_membership_id IS DISTINCT FROM
          NEW.new_curator_membership_id
        OR conversation.current_scope_id IS DISTINCT FROM
          NEW.new_scope_id
        OR conversation.current_scope_version IS DISTINCT FROM
          NEW.new_scope_version
      )
    ORDER BY conversation.id
    FOR UPDATE
  LOOP
    previous_owner := CASE
      WHEN conversation_row.queue = 'sales'
        THEN conversation_row.responsible_sales_membership_id
      ELSE conversation_row.current_curator_membership_id
    END;

    UPDATE platform.communication_conversations
    SET
      queue = 'curator',
      current_curator_membership_id =
        NEW.new_curator_membership_id,
      current_scope_id = NEW.new_scope_id,
      current_scope_version = NEW.new_scope_version
    WHERE organization_id = conversation_row.organization_id
      AND id = conversation_row.id;

    INSERT INTO platform.conversation_handoff_events (
      organization_id,
      conversation_id,
      previous_student_case_id,
      new_student_case_id,
      previous_queue,
      new_queue,
      previous_owner_membership_id,
      new_owner_membership_id,
      source_webhook_event_id,
      student_case_assignment_event_id,
      reason,
      request_id
    )
    VALUES (
      NEW.organization_id,
      conversation_row.id,
      NEW.student_case_id,
      NEW.student_case_id,
      conversation_row.queue,
      'curator',
      previous_owner,
      NEW.new_curator_membership_id,
      NULL,
      NEW.id,
      NEW.reason,
      gen_random_uuid()
    );
  END LOOP;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.sync_case_assignment_conversations()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER student_case_assignment_sync_communications
  AFTER INSERT ON platform.student_case_assignment_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.sync_case_assignment_conversations();

CREATE OR REPLACE FUNCTION platform.create_communication_conversation(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_responsible_sales_membership_id UUID,
  p_subject TEXT,
  p_waha_session_name TEXT,
  p_kommo_account_id BIGINT,
  p_kommo_conversation_id TEXT,
  p_amocrm_account_id BIGINT,
  p_amocrm_lead_id BIGINT,
  p_amocrm_contact_id BIGINT,
  p_source_webhook_event_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_event platform_private.provider_webhook_events%ROWTYPE;
  case_row platform.student_cases%ROWTYPE;
  created_conversation_id UUID := gen_random_uuid();
  created_scope_id UUID;
  target_queue platform.communication_queue;
  target_curator UUID;
  target_owner UUID;
  target_scope_id UUID;
  target_scope_version BIGINT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Create unified communication conversation from verified provider evidence';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_responsible_sales_membership_id IS NULL
    OR p_subject IS NULL
    OR btrim(p_subject) = ''
    OR p_waha_session_name IS NULL
    OR btrim(p_waha_session_name) = ''
    OR p_kommo_account_id IS NULL
    OR p_kommo_account_id <= 0
    OR (
      p_kommo_conversation_id IS NOT NULL
      AND btrim(p_kommo_conversation_id) = ''
    )
    OR p_amocrm_account_id IS NULL
    OR p_amocrm_account_id <= 0
    OR p_amocrm_lead_id IS NULL
    OR p_amocrm_lead_id <= 0
    OR p_amocrm_contact_id IS NULL
    OR p_amocrm_contact_id <= 0
    OR p_source_webhook_event_id IS NULL
  THEN
    RAISE EXCEPTION
      'Complete conversation identity and provider context are required'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'communication.conversation.create',
    'communication_conversation',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'responsible_sales_membership_id',
        p_responsible_sales_membership_id,
      'subject', btrim(p_subject),
      'waha_session_name', btrim(p_waha_session_name),
      'kommo_account_id', p_kommo_account_id,
      'kommo_conversation_id',
        NULLIF(btrim(p_kommo_conversation_id), ''),
      'amocrm_account_id', p_amocrm_account_id,
      'amocrm_lead_id', p_amocrm_lead_id,
      'amocrm_contact_id', p_amocrm_contact_id,
      'source_webhook_event_id', p_source_webhook_event_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_source_webhook_event_id;

  IF source_event.id IS NULL
    OR source_event.verification_status <> 'verified'
    OR NOT (
      (
        source_event.provider = 'waha'
        AND source_event.waha_session_name =
          btrim(p_waha_session_name)
      )
      OR (
        source_event.provider = 'kommo'
        AND source_event.provider_account_ref =
          p_kommo_account_id::TEXT
        AND source_event.provider_conversation_ref IS NOT DISTINCT FROM
          NULLIF(btrim(p_kommo_conversation_id), '')
      )
      OR (
        source_event.provider = 'amocrm'
        AND source_event.provider_account_ref =
          p_amocrm_account_id::TEXT
        AND source_event.payload_id IN (
          p_amocrm_lead_id::TEXT,
          p_amocrm_contact_id::TEXT
        )
      )
    )
  THEN
    RAISE EXCEPTION
      'A verified, tenant-matched raw provider event is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
     AND bundle.role = membership."current_role"
     AND bundle.status = 'published'
    WHERE membership.organization_id = p_organization_id
      AND membership.id = p_responsible_sales_membership_id
      AND membership.status = 'active'
      AND membership."current_role" = 'sales'
  ) THEN
    RAISE EXCEPTION
      'An active Sales membership is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_student_case_id IS NOT NULL THEN
    SELECT *
    INTO case_row
    FROM platform.student_cases AS target_case
    WHERE target_case.organization_id = p_organization_id
      AND target_case.id = p_student_case_id
    FOR UPDATE;

    IF case_row.id IS NULL
      OR case_row.responsible_sales_membership_id <>
        p_responsible_sales_membership_id
    THEN
      RAISE EXCEPTION
        'Conversation case and responsible Sales do not match'
        USING ERRCODE = '42501';
    END IF;

    IF case_row.state = 'pending' THEN
      target_queue := 'sales';
      target_curator := NULL;
      target_owner := p_responsible_sales_membership_id;
    ELSIF case_row.state IN ('active', 'closed')
      AND case_row.current_curator_membership_id IS NOT NULL
    THEN
      target_queue := 'curator';
      target_curator := case_row.current_curator_membership_id;
      target_owner := case_row.current_curator_membership_id;
    ELSE
      RAISE EXCEPTION
        'Student case is not in a communication-ready state'
        USING ERRCODE = '55000';
    END IF;

    target_scope_id := case_row.current_scope_id;
    target_scope_version := case_row.current_scope_version;
  ELSE
    target_queue := 'sales';
    target_owner := p_responsible_sales_membership_id;
    created_scope_id := gen_random_uuid();
    target_scope_id := created_scope_id;
    target_scope_version := 1;

    INSERT INTO platform.record_scopes (
      id,
      organization_id,
      scope_kind,
      scope_key,
      scope_version,
      is_active
    )
    VALUES (
      created_scope_id,
      p_organization_id,
      'conversation',
      created_conversation_id,
      1,
      TRUE
    );

    INSERT INTO platform.membership_scope_assignments (
      organization_id,
      membership_id,
      scope_id,
      scope_version,
      assignment_version,
      granted,
      actor_kind,
      actor_profile_id,
      reason,
      request_id
    )
    VALUES (
      p_organization_id,
      p_responsible_sales_membership_id,
      created_scope_id,
      1,
      1,
      TRUE,
      'service',
      NULL,
      fixed_reason,
      p_request_id
    );

    UPDATE platform.profiles AS profile
    SET access_version = profile.access_version + 1
    FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.id = p_responsible_sales_membership_id
      AND profile.id = membership.profile_id;
  END IF;

  INSERT INTO platform.communication_conversations (
    id,
    organization_id,
    student_case_id,
    responsible_sales_membership_id,
    current_curator_membership_id,
    queue,
    status,
    subject,
    waha_session_name,
    kommo_account_id,
    kommo_conversation_id,
    amocrm_account_id,
    amocrm_lead_id,
    amocrm_contact_id,
    current_scope_id,
    current_scope_version,
    created_from_webhook_event_id
  )
  VALUES (
    created_conversation_id,
    p_organization_id,
    p_student_case_id,
    p_responsible_sales_membership_id,
    target_curator,
    target_queue,
    'open',
    btrim(p_subject),
    btrim(p_waha_session_name),
    p_kommo_account_id,
    NULLIF(btrim(p_kommo_conversation_id), ''),
    p_amocrm_account_id,
    p_amocrm_lead_id,
    p_amocrm_contact_id,
    target_scope_id,
    target_scope_version,
    p_source_webhook_event_id
  );

  INSERT INTO platform.conversation_handoff_events (
    organization_id,
    conversation_id,
    previous_student_case_id,
    new_student_case_id,
    previous_queue,
    new_queue,
    previous_owner_membership_id,
    new_owner_membership_id,
    source_webhook_event_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    created_conversation_id,
    NULL,
    p_student_case_id,
    NULL,
    target_queue,
    NULL,
    target_owner,
    p_source_webhook_event_id,
    fixed_reason,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'communication_conversation_id', created_conversation_id,
    'student_case_id', p_student_case_id,
    'responsible_sales_membership_id',
      p_responsible_sales_membership_id,
    'queue', target_queue,
    'current_owner_membership_id', target_owner,
    'subject', btrim(p_subject),
    'waha_session_name', btrim(p_waha_session_name),
    'kommo_account_id', p_kommo_account_id,
    'kommo_conversation_id',
      NULLIF(btrim(p_kommo_conversation_id), ''),
    'amocrm_account_id', p_amocrm_account_id,
    'amocrm_lead_id', p_amocrm_lead_id,
    'amocrm_contact_id', p_amocrm_contact_id,
    'source_webhook_event_id', p_source_webhook_event_id
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
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-communications',
    'communication.conversation.create',
    'communication_conversation',
    created_conversation_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.record_communication_message(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_direction platform.communication_direction,
  p_body_text TEXT,
  p_language platform.communication_message_language,
  p_student_visible BOOLEAN,
  p_waha_session_name TEXT,
  p_waha_message_id TEXT,
  p_kommo_account_id BIGINT,
  p_kommo_conversation_id TEXT,
  p_kommo_message_id TEXT,
  p_amocrm_account_id BIGINT,
  p_amocrm_lead_id BIGINT,
  p_amocrm_contact_id BIGINT,
  p_source_webhook_event_id UUID,
  p_manual_send_authorization_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation_row platform.communication_conversations%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  authorization_row platform.manual_send_authorizations%ROWTYPE;
  sender_participant platform.conversation_participants%ROWTYPE;
  waha_match platform.communication_messages%ROWTYPE;
  kommo_match platform.communication_messages%ROWTYPE;
  existing_message platform.communication_messages%ROWTYPE;
  created_message_id UUID := gen_random_uuid();
  body_hash TEXT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Record one provider-observed communication message without delivery claim';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_direction IS NULL
    OR p_body_text IS NULL
    OR btrim(p_body_text) = ''
    OR p_language IS NULL
    OR p_student_visible IS NULL
    OR p_kommo_account_id IS NULL
    OR p_kommo_account_id <= 0
    OR p_amocrm_account_id IS NULL
    OR p_amocrm_account_id <= 0
    OR p_amocrm_lead_id IS NULL
    OR p_amocrm_lead_id <= 0
    OR p_amocrm_contact_id IS NULL
    OR p_amocrm_contact_id <= 0
    OR p_source_webhook_event_id IS NULL
    OR (
      p_waha_message_id IS NULL
      AND p_kommo_message_id IS NULL
    )
    OR (
      p_waha_message_id IS NOT NULL
      AND (
        btrim(p_waha_message_id) = ''
        OR p_waha_session_name IS NULL
        OR btrim(p_waha_session_name) = ''
      )
    )
    OR (
      p_waha_message_id IS NULL
      AND p_waha_session_name IS NOT NULL
    )
    OR (
      p_kommo_message_id IS NOT NULL
      AND (
        btrim(p_kommo_message_id) = ''
        OR p_kommo_conversation_id IS NULL
        OR btrim(p_kommo_conversation_id) = ''
      )
    )
    OR (
      p_kommo_message_id IS NULL
      AND p_kommo_conversation_id IS NOT NULL
    )
    OR (
      p_direction = 'inbound'
      AND p_manual_send_authorization_id IS NOT NULL
    )
    OR (
      p_direction = 'outbound'
      AND (
        p_manual_send_authorization_id IS NULL
        OR p_language = 'undetermined'
      )
    )
  THEN
    RAISE EXCEPTION
      'Complete, direction-safe message evidence is required'
      USING ERRCODE = '22023';
  END IF;

  body_hash := encode(
    sha256(convert_to(btrim(p_body_text), 'UTF8')),
    'hex'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'communication.message.record',
    'communication_message',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'communication_conversation_id', p_conversation_id,
      'direction', p_direction,
      'body_text_sha256', body_hash,
      'language', p_language,
      'student_visible', p_student_visible,
      'waha_session_name',
        NULLIF(btrim(p_waha_session_name), ''),
      'waha_message_id', NULLIF(btrim(p_waha_message_id), ''),
      'kommo_account_id', p_kommo_account_id,
      'kommo_conversation_id',
        NULLIF(btrim(p_kommo_conversation_id), ''),
      'kommo_message_id', NULLIF(btrim(p_kommo_message_id), ''),
      'amocrm_account_id', p_amocrm_account_id,
      'amocrm_lead_id', p_amocrm_lead_id,
      'amocrm_contact_id', p_amocrm_contact_id,
      'observed_source_webhook_event_id',
        p_source_webhook_event_id,
      'manual_send_authorization_id',
        p_manual_send_authorization_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF p_waha_message_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'evo:p2f:message:waha:'
          || p_organization_id::TEXT
          || ':'
          || btrim(p_waha_session_name)
          || ':'
          || btrim(p_waha_message_id),
        0
      )
    );
  END IF;
  IF p_kommo_message_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'evo:p2f:message:kommo:'
          || p_organization_id::TEXT
          || ':'
          || p_kommo_account_id::TEXT
          || ':'
          || btrim(p_kommo_conversation_id)
          || ':'
          || btrim(p_kommo_message_id),
        0
      )
    );
  END IF;

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id
  FOR UPDATE;

  SELECT *
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_source_webhook_event_id;

  IF conversation_row.id IS NULL
    OR source_event.id IS NULL
    OR source_event.verification_status <> 'verified'
    OR NOT (
      (
        source_event.provider = 'waha'
        AND p_waha_message_id IS NOT NULL
        AND source_event.waha_session_name =
          btrim(p_waha_session_name)
        AND source_event.payload_id = btrim(p_waha_message_id)
      )
      OR (
        source_event.provider = 'kommo'
        AND p_kommo_message_id IS NOT NULL
        AND source_event.provider_account_ref =
          p_kommo_account_id::TEXT
        AND source_event.provider_conversation_ref =
          btrim(p_kommo_conversation_id)
        AND source_event.payload_id = btrim(p_kommo_message_id)
      )
    )
    OR conversation_row.waha_session_name <>
      COALESCE(
        NULLIF(btrim(p_waha_session_name), ''),
        conversation_row.waha_session_name
      )
    OR conversation_row.kommo_account_id <> p_kommo_account_id
    OR conversation_row.kommo_conversation_id IS DISTINCT FROM
      NULLIF(btrim(p_kommo_conversation_id), '')
    OR conversation_row.amocrm_account_id <> p_amocrm_account_id
    OR conversation_row.amocrm_lead_id <> p_amocrm_lead_id
    OR conversation_row.amocrm_contact_id <> p_amocrm_contact_id
    OR (
      p_student_visible
      AND (
        conversation_row.student_case_id IS NULL
        OR conversation_row.queue <> 'curator'
      )
    )
  THEN
    RAISE EXCEPTION
      'Message provider identity or conversation scope does not match'
      USING ERRCODE = '42501';
  END IF;

  IF p_direction = 'inbound' THEN
    SELECT *
    INTO sender_participant
    FROM platform.conversation_participants AS participant
    WHERE participant.organization_id = p_organization_id
      AND participant.conversation_id = p_conversation_id
      AND participant.participant_kind = 'customer'
    ORDER BY participant.created_at, participant.id
    LIMIT 1;
  ELSE
    SELECT *
    INTO authorization_row
    FROM platform.manual_send_authorizations AS authz
    WHERE authz.organization_id = p_organization_id
      AND authz.id = p_manual_send_authorization_id
      AND authz.conversation_id = p_conversation_id;

    IF authorization_row.id IS NULL
      OR authorization_row.final_text <> btrim(p_body_text)
      OR authorization_row.final_text_sha256 <>
        encode(sha256(convert_to(btrim(p_body_text), 'UTF8')), 'hex')
    THEN
      RAISE EXCEPTION
        'Exact reviewed manual-send authorization is required'
        USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO sender_participant
    FROM platform.conversation_participants AS participant
    WHERE participant.organization_id = p_organization_id
      AND participant.conversation_id = p_conversation_id
      AND participant.membership_id =
        authorization_row.authorized_by_membership_id
      AND participant.participant_kind IN ('sales', 'curator', 'admin')
    ORDER BY participant.created_at, participant.id
    LIMIT 1;
  END IF;

  IF sender_participant.id IS NULL THEN
    RAISE EXCEPTION
      'A recorded sender participant is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_waha_message_id IS NOT NULL THEN
    SELECT *
    INTO waha_match
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.waha_session_name = btrim(p_waha_session_name)
      AND message.waha_message_id = btrim(p_waha_message_id)
    FOR UPDATE;
  END IF;
  IF p_kommo_message_id IS NOT NULL THEN
    SELECT *
    INTO kommo_match
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.kommo_account_id = p_kommo_account_id
      AND message.kommo_conversation_id =
        btrim(p_kommo_conversation_id)
      AND message.kommo_message_id = btrim(p_kommo_message_id)
    FOR UPDATE;
  END IF;

  IF waha_match.id IS NOT NULL
    AND kommo_match.id IS NOT NULL
    AND waha_match.id <> kommo_match.id
  THEN
    RAISE EXCEPTION
      'WAHA and Kommo message identities resolve to different messages'
      USING ERRCODE = '23505';
  END IF;

  IF waha_match.id IS NOT NULL THEN
    existing_message := waha_match;
  ELSE
    existing_message := kommo_match;
  END IF;

  IF existing_message.id IS NOT NULL THEN
    IF existing_message.conversation_id <> p_conversation_id
      OR existing_message.sender_participant_id <>
        sender_participant.id
      OR existing_message.direction <> p_direction
      OR existing_message.body_text <> btrim(p_body_text)
      OR existing_message.language <> p_language
      OR existing_message.student_visible <> p_student_visible
      OR existing_message.waha_session_name IS DISTINCT FROM
        NULLIF(btrim(p_waha_session_name), '')
      OR existing_message.waha_message_id IS DISTINCT FROM
        NULLIF(btrim(p_waha_message_id), '')
      OR existing_message.kommo_account_id <> p_kommo_account_id
      OR existing_message.kommo_conversation_id IS DISTINCT FROM
        NULLIF(btrim(p_kommo_conversation_id), '')
      OR existing_message.kommo_message_id IS DISTINCT FROM
        NULLIF(btrim(p_kommo_message_id), '')
      OR existing_message.amocrm_account_id <> p_amocrm_account_id
      OR existing_message.amocrm_lead_id <> p_amocrm_lead_id
      OR existing_message.amocrm_contact_id <> p_amocrm_contact_id
      OR existing_message.manual_send_authorization_id IS DISTINCT FROM
        p_manual_send_authorization_id
    THEN
      RAISE EXCEPTION
        'Provider message identity was reused for different evidence'
        USING ERRCODE = '22023';
    END IF;

    result := jsonb_build_object(
      'organization_id', p_organization_id,
      'communication_message_id', existing_message.id,
      'communication_conversation_id', p_conversation_id,
      'direction', existing_message.direction,
      'body_text_sha256', body_hash,
      'language', existing_message.language,
      'student_visible', existing_message.student_visible,
      'waha_session_name', existing_message.waha_session_name,
      'waha_message_id', existing_message.waha_message_id,
      'kommo_account_id', existing_message.kommo_account_id,
      'kommo_conversation_id',
        existing_message.kommo_conversation_id,
      'kommo_message_id', existing_message.kommo_message_id,
      'amocrm_account_id', existing_message.amocrm_account_id,
      'amocrm_lead_id', existing_message.amocrm_lead_id,
      'amocrm_contact_id', existing_message.amocrm_contact_id,
      'source_webhook_event_id',
        existing_message.source_webhook_event_id,
      'observed_source_webhook_event_id',
        p_source_webhook_event_id,
      'manual_send_authorization_id',
        existing_message.manual_send_authorization_id,
      'deduplicated', TRUE
    );
  ELSE
    INSERT INTO platform.communication_messages (
      id,
      organization_id,
      conversation_id,
      student_case_id,
      sender_participant_id,
      direction,
      body_text,
      language,
      student_visible,
      waha_session_name,
      waha_message_id,
      kommo_account_id,
      kommo_conversation_id,
      kommo_message_id,
      amocrm_account_id,
      amocrm_lead_id,
      amocrm_contact_id,
      source_webhook_event_id,
      manual_send_authorization_id
    )
    VALUES (
      created_message_id,
      p_organization_id,
      p_conversation_id,
      conversation_row.student_case_id,
      sender_participant.id,
      p_direction,
      btrim(p_body_text),
      p_language,
      p_student_visible,
      NULLIF(btrim(p_waha_session_name), ''),
      NULLIF(btrim(p_waha_message_id), ''),
      p_kommo_account_id,
      NULLIF(btrim(p_kommo_conversation_id), ''),
      NULLIF(btrim(p_kommo_message_id), ''),
      p_amocrm_account_id,
      p_amocrm_lead_id,
      p_amocrm_contact_id,
      p_source_webhook_event_id,
      p_manual_send_authorization_id
    );

    result := jsonb_build_object(
      'organization_id', p_organization_id,
      'communication_message_id', created_message_id,
      'communication_conversation_id', p_conversation_id,
      'direction', p_direction,
      'body_text_sha256', body_hash,
      'language', p_language,
      'student_visible', p_student_visible,
      'waha_session_name',
        NULLIF(btrim(p_waha_session_name), ''),
      'waha_message_id', NULLIF(btrim(p_waha_message_id), ''),
      'kommo_account_id', p_kommo_account_id,
      'kommo_conversation_id',
        NULLIF(btrim(p_kommo_conversation_id), ''),
      'kommo_message_id',
        NULLIF(btrim(p_kommo_message_id), ''),
      'amocrm_account_id', p_amocrm_account_id,
      'amocrm_lead_id', p_amocrm_lead_id,
      'amocrm_contact_id', p_amocrm_contact_id,
      'source_webhook_event_id', p_source_webhook_event_id,
      'observed_source_webhook_event_id',
        p_source_webhook_event_id,
      'manual_send_authorization_id',
        p_manual_send_authorization_id,
      'deduplicated', FALSE
    );
  END IF;

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
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-communications',
    'communication.message.record',
    'communication_message',
    (result ->> 'communication_message_id')::UUID,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.append_provider_reconciliation_event(
  p_organization_id UUID,
  p_source_webhook_event_id UUID,
  p_conversation_id UUID,
  p_communication_message_id UUID,
  p_manual_send_authorization_id UUID,
  p_observation_kind platform.provider_observation_kind,
  p_ack_state platform.waha_ack_state,
  p_evidence_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_event platform_private.provider_webhook_events%ROWTYPE;
  message_row platform.communication_messages%ROWTYPE;
  existing_event platform_private.provider_reconciliation_events%ROWTYPE;
  created_event_id UUID := gen_random_uuid();
  manual_review BOOLEAN;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Append provider observation for reconciliation without delivery proof';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);

  manual_review := p_observation_kind IN ('unknown_result', 'conflict');

  IF p_organization_id IS NULL
    OR p_observation_kind IS NULL
    OR p_evidence_ref IS NULL
    OR btrim(p_evidence_ref) = ''
    OR (
      p_observation_kind = 'ack_observed'
      AND (
        p_source_webhook_event_id IS NULL
        OR
        p_conversation_id IS NULL
        OR p_communication_message_id IS NULL
        OR p_manual_send_authorization_id IS NOT NULL
        OR p_ack_state IS NULL
        OR p_ack_state = 'unknown'
      )
    )
    OR (
      p_observation_kind = 'unknown_result'
      AND (
        p_source_webhook_event_id IS NOT NULL
        OR p_conversation_id IS NULL
        OR p_manual_send_authorization_id IS NULL
        OR p_ack_state IS DISTINCT FROM 'unknown'
      )
    )
    OR (
      p_observation_kind IN (
        'message_observed',
        'link_resolved',
        'conflict'
      )
      AND (
        p_source_webhook_event_id IS NULL
        OR p_ack_state IS NOT NULL
        OR p_manual_send_authorization_id IS NOT NULL
      )
    )
  THEN
    RAISE EXCEPTION
      'Observation kind, ACK state and evidence shape do not match'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'communication.provider.observe',
    'provider_reconciliation_event',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'source_webhook_event_id', p_source_webhook_event_id,
      'communication_conversation_id', p_conversation_id,
      'communication_message_id', p_communication_message_id,
      'manual_send_authorization_id',
        p_manual_send_authorization_id,
      'observation_kind', p_observation_kind,
      'ack_state', p_ack_state,
      'evidence_ref', btrim(p_evidence_ref),
      'requires_manual_review', manual_review
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF p_source_webhook_event_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'evo:p2f:provider-observation:source:'
          || p_organization_id::TEXT
          || ':'
          || p_source_webhook_event_id::TEXT
          || ':'
          || p_observation_kind::TEXT
          || ':'
          || COALESCE(p_conversation_id::TEXT, '-')
          || ':'
          || COALESCE(p_communication_message_id::TEXT, '-')
          || ':'
          || COALESCE(p_ack_state::TEXT, '-'),
        0
      )
    );
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'evo:p2f:provider-observation:unknown:'
          || p_organization_id::TEXT
          || ':'
          || p_manual_send_authorization_id::TEXT,
        0
      )
    );
  END IF;

  IF p_source_webhook_event_id IS NOT NULL THEN
    SELECT *
    INTO source_event
    FROM platform_private.provider_webhook_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.id = p_source_webhook_event_id;

    IF source_event.id IS NULL
      OR (
        p_observation_kind <> 'conflict'
        AND source_event.verification_status <> 'verified'
      )
    THEN
      RAISE EXCEPTION
        'Tenant-matched raw evidence is required; processing needs verification'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_communication_message_id IS NOT NULL THEN
    SELECT *
    INTO message_row
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.id = p_communication_message_id
      AND message.conversation_id = p_conversation_id;

    IF message_row.id IS NULL THEN
      RAISE EXCEPTION
        'Reconciliation message and conversation do not match'
        USING ERRCODE = '42501';
    END IF;

    IF p_observation_kind = 'ack_observed'
      AND (
        source_event.provider <> 'waha'
        OR source_event.event_type <> 'message.ack'
        OR message_row.waha_session_name IS NULL
        OR message_row.waha_message_id IS NULL
        OR source_event.waha_session_name IS DISTINCT FROM
          message_row.waha_session_name
        OR source_event.payload_id <> message_row.waha_message_id
        OR source_event.provider_event_variant_ref IS DISTINCT FROM
          p_ack_state::TEXT
      )
    THEN
      RAISE EXCEPTION
        'WAHA ACK evidence and communication message identity do not match'
        USING ERRCODE = '42501';
    END IF;

    IF p_observation_kind = 'message_observed'
      AND NOT (
        (
          source_event.provider = 'waha'
          AND message_row.waha_session_name IS NOT NULL
          AND message_row.waha_message_id IS NOT NULL
          AND source_event.waha_session_name =
            message_row.waha_session_name
          AND source_event.payload_id = message_row.waha_message_id
        )
        OR (
          source_event.provider = 'kommo'
          AND message_row.kommo_message_id IS NOT NULL
          AND source_event.provider_account_ref =
            message_row.kommo_account_id::TEXT
          AND source_event.provider_conversation_ref =
            message_row.kommo_conversation_id
          AND source_event.payload_id = message_row.kommo_message_id
        )
      )
    THEN
      RAISE EXCEPTION
        'Provider message observation and normalized identity do not match'
        USING ERRCODE = '42501';
    END IF;

    IF p_observation_kind = 'unknown_result'
      AND message_row.manual_send_authorization_id IS DISTINCT FROM
        p_manual_send_authorization_id
    THEN
      RAISE EXCEPTION
        'Unknown result message and manual authorization do not match'
        USING ERRCODE = '42501';
    END IF;
  ELSIF p_conversation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM platform.communication_conversations AS conversation
      WHERE conversation.organization_id = p_organization_id
        AND conversation.id = p_conversation_id
    )
  THEN
    RAISE EXCEPTION
      'Reconciliation conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF p_manual_send_authorization_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM platform.manual_send_authorizations AS authz
      WHERE authz.organization_id = p_organization_id
        AND authz.id = p_manual_send_authorization_id
        AND authz.conversation_id = p_conversation_id
    )
  THEN
    RAISE EXCEPTION
      'Unknown send result requires its exact manual authorization'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_webhook_event_id IS NOT NULL THEN
    SELECT *
    INTO existing_event
    FROM platform_private.provider_reconciliation_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.source_webhook_event_id =
        p_source_webhook_event_id
      AND event.observation_kind = p_observation_kind
      AND event.conversation_id IS NOT DISTINCT FROM
        p_conversation_id
      AND event.communication_message_id IS NOT DISTINCT FROM
        p_communication_message_id
      AND event.ack_state IS NOT DISTINCT FROM p_ack_state
    FOR UPDATE;
  ELSE
    SELECT *
    INTO existing_event
    FROM platform_private.provider_reconciliation_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.observation_kind = 'unknown_result'
      AND event.manual_send_authorization_id =
        p_manual_send_authorization_id
    FOR UPDATE;
  END IF;

  IF existing_event.id IS NOT NULL THEN
    IF existing_event.organization_id <> p_organization_id
      OR existing_event.source_webhook_event_id IS DISTINCT FROM
        p_source_webhook_event_id
      OR existing_event.conversation_id IS DISTINCT FROM
        p_conversation_id
      OR existing_event.communication_message_id IS DISTINCT FROM
        p_communication_message_id
      OR existing_event.manual_send_authorization_id IS DISTINCT FROM
        p_manual_send_authorization_id
      OR existing_event.observation_kind <> p_observation_kind
      OR existing_event.ack_state IS DISTINCT FROM p_ack_state
      OR existing_event.evidence_ref <> btrim(p_evidence_ref)
      OR existing_event.requires_manual_review <> manual_review
    THEN
      RAISE EXCEPTION
        'Provider observation business key was reused for different evidence'
        USING ERRCODE = '22023';
    END IF;

    result := jsonb_build_object(
      'organization_id', existing_event.organization_id,
      'provider_reconciliation_event_id', existing_event.id,
      'source_webhook_event_id',
        existing_event.source_webhook_event_id,
      'communication_conversation_id',
        existing_event.conversation_id,
      'communication_message_id',
        existing_event.communication_message_id,
      'manual_send_authorization_id',
        existing_event.manual_send_authorization_id,
      'observation_kind', existing_event.observation_kind,
      'ack_state', existing_event.ack_state,
      'evidence_ref', existing_event.evidence_ref,
      'requires_manual_review',
        existing_event.requires_manual_review,
      'deduplicated', TRUE
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
    )
    VALUES (
      p_organization_id,
      'service',
      NULL,
      'service:platform-provider-observation',
      'communication.provider.observe',
      'provider_reconciliation_event',
      existing_event.id,
      NULL,
      result,
      fixed_reason,
      p_request_id
    );

    RETURN result;
  END IF;

  INSERT INTO platform_private.provider_reconciliation_events (
    id,
    organization_id,
    source_webhook_event_id,
    conversation_id,
    communication_message_id,
    manual_send_authorization_id,
    observation_kind,
    ack_state,
    evidence_ref,
    requires_manual_review,
    request_id
  )
  VALUES (
    created_event_id,
    p_organization_id,
    p_source_webhook_event_id,
    p_conversation_id,
    p_communication_message_id,
    p_manual_send_authorization_id,
    p_observation_kind,
    p_ack_state,
    btrim(p_evidence_ref),
    manual_review,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'provider_reconciliation_event_id', created_event_id,
    'source_webhook_event_id', p_source_webhook_event_id,
    'communication_conversation_id', p_conversation_id,
    'communication_message_id', p_communication_message_id,
    'manual_send_authorization_id',
      p_manual_send_authorization_id,
    'observation_kind', p_observation_kind,
    'ack_state', p_ack_state,
    'evidence_ref', btrim(p_evidence_ref),
    'requires_manual_review', manual_review,
    'deduplicated', FALSE
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
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-provider-observation',
    'communication.provider.observe',
    'provider_reconciliation_event',
    created_event_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.link_communication_conversation_case(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_student_case_id UUID,
  p_source_webhook_event_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation_row platform.communication_conversations%ROWTYPE;
  case_row platform.student_cases%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  target_queue platform.communication_queue;
  target_curator UUID;
  target_owner UUID;
  revoke_version BIGINT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Link verified communication to canonical student case and handoff state';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);

  replayed := platform_private.replay_audit(
    p_request_id,
    'communication.conversation.link',
    'communication_conversation',
    p_conversation_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'communication_conversation_id', p_conversation_id,
      'student_case_id', p_student_case_id,
      'source_webhook_event_id', p_source_webhook_event_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id
  FOR UPDATE;

  SELECT *
  INTO case_row
  FROM platform.student_cases AS target_case
  WHERE target_case.organization_id = p_organization_id
    AND target_case.id = p_student_case_id
  FOR UPDATE;

  SELECT *
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_source_webhook_event_id;

  IF conversation_row.id IS NULL
    OR conversation_row.student_case_id IS NOT NULL
    OR case_row.id IS NULL
    OR source_event.id IS NULL
    OR source_event.verification_status <> 'verified'
    OR case_row.responsible_sales_membership_id <>
      conversation_row.responsible_sales_membership_id
  THEN
    RAISE EXCEPTION
      'Verified unlinked conversation and matching case are required'
      USING ERRCODE = '42501';
  END IF;

  IF case_row.state = 'pending' THEN
    target_queue := 'sales';
    target_curator := NULL;
    target_owner := conversation_row.responsible_sales_membership_id;
  ELSIF case_row.state IN ('active', 'closed')
    AND case_row.current_curator_membership_id IS NOT NULL
  THEN
    target_queue := 'curator';
    target_curator := case_row.current_curator_membership_id;
    target_owner := case_row.current_curator_membership_id;
  ELSE
    RAISE EXCEPTION
      'Student case is not in a communication-ready state'
      USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(MAX(assignment.assignment_version), 0) + 1
  INTO revoke_version
  FROM platform.membership_scope_assignments AS assignment
  WHERE assignment.organization_id = p_organization_id
    AND assignment.membership_id =
      conversation_row.responsible_sales_membership_id
    AND assignment.scope_id = conversation_row.current_scope_id;

  INSERT INTO platform.membership_scope_assignments (
    organization_id,
    membership_id,
    scope_id,
    scope_version,
    assignment_version,
    granted,
    actor_kind,
    actor_profile_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    conversation_row.responsible_sales_membership_id,
    conversation_row.current_scope_id,
    conversation_row.current_scope_version,
    revoke_version,
    FALSE,
    'service',
    NULL,
    fixed_reason,
    p_request_id
  );

  UPDATE platform.profiles AS profile
  SET access_version = profile.access_version + 1
  FROM platform.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.id =
      conversation_row.responsible_sales_membership_id
    AND profile.id = membership.profile_id;

  UPDATE platform.communication_conversations
  SET
    student_case_id = case_row.id,
    current_curator_membership_id = target_curator,
    queue = target_queue,
    current_scope_id = case_row.current_scope_id,
    current_scope_version = case_row.current_scope_version
  WHERE organization_id = p_organization_id
    AND id = p_conversation_id;

  INSERT INTO platform.conversation_handoff_events (
    organization_id,
    conversation_id,
    previous_student_case_id,
    new_student_case_id,
    previous_queue,
    new_queue,
    previous_owner_membership_id,
    new_owner_membership_id,
    source_webhook_event_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    NULL,
    case_row.id,
    conversation_row.queue,
    target_queue,
    conversation_row.responsible_sales_membership_id,
    target_owner,
    p_source_webhook_event_id,
    fixed_reason,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'communication_conversation_id', p_conversation_id,
    'student_case_id', case_row.id,
    'queue', target_queue,
    'current_owner_membership_id', target_owner,
    'source_webhook_event_id', p_source_webhook_event_id
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
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-communications',
    'communication.conversation.link',
    'communication_conversation',
    p_conversation_id,
    jsonb_build_object(
      'student_case_id', NULL,
      'queue', conversation_row.queue,
      'current_owner_membership_id',
        conversation_row.responsible_sales_membership_id
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.record_conversation_participant(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_participant_kind platform.conversation_participant_kind,
  p_membership_id UUID,
  p_external_subject_ref TEXT,
  p_source_webhook_event_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation_row platform.communication_conversations%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  existing_participant platform.conversation_participants%ROWTYPE;
  created_participant_id UUID := gen_random_uuid();
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Record a participant observed in verified communication evidence';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);

  replayed := platform_private.replay_audit(
    p_request_id,
    'communication.participant.record',
    'conversation_participant',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'communication_conversation_id', p_conversation_id,
      'participant_kind', p_participant_kind,
      'membership_id', p_membership_id,
      'external_subject_ref',
        NULLIF(btrim(p_external_subject_ref), ''),
      'observed_source_webhook_event_id',
        p_source_webhook_event_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id;

  SELECT *
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_source_webhook_event_id;

  IF conversation_row.id IS NULL
    OR source_event.id IS NULL
    OR source_event.verification_status <> 'verified'
    OR p_participant_kind IS NULL
  THEN
    RAISE EXCEPTION
      'Verified conversation evidence and participant kind are required'
      USING ERRCODE = '42501';
  END IF;

  IF p_participant_kind = 'customer' THEN
    IF p_external_subject_ref IS NULL
      OR btrim(p_external_subject_ref) = ''
      OR (
        p_membership_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM platform.student_cases AS target_case
          WHERE target_case.organization_id = p_organization_id
            AND target_case.id = conversation_row.student_case_id
            AND target_case.student_membership_id = p_membership_id
        )
      )
    THEN
      RAISE EXCEPTION
        'Customer participant requires an external reference and matching student'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_participant_kind = 'sales' THEN
    IF p_membership_id IS DISTINCT FROM
        conversation_row.responsible_sales_membership_id
      OR p_external_subject_ref IS NOT NULL
    THEN
      RAISE EXCEPTION
        'Sales participant must be the responsible Sales membership'
        USING ERRCODE = '42501';
    END IF;
  ELSIF p_participant_kind = 'curator' THEN
    IF conversation_row.queue <> 'curator'
      OR p_membership_id IS DISTINCT FROM
        conversation_row.current_curator_membership_id
      OR p_external_subject_ref IS NOT NULL
    THEN
      RAISE EXCEPTION
        'Curator participant must be the current Curator membership'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF p_membership_id IS NULL
      OR p_external_subject_ref IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM platform.organization_memberships AS membership
        JOIN platform.profiles AS profile
          ON profile.id = membership.profile_id
        JOIN platform.organizations AS organization
          ON organization.id = membership.organization_id
        JOIN platform.role_bundle_versions AS bundle
          ON bundle.id = membership.current_bundle_id
          AND bundle.role = membership."current_role"
        WHERE membership.organization_id = p_organization_id
          AND membership.id = p_membership_id
          AND membership.status = 'active'
          AND membership."current_role" = 'admin'
          AND profile.status = 'active'
          AND organization.status = 'active'
          AND bundle.status = 'published'
      )
    THEN
      RAISE EXCEPTION
        'Admin participant must be an active same-organization Admin membership'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_membership_id IS NOT NULL THEN
    SELECT *
    INTO existing_participant
    FROM platform.conversation_participants AS participant
    WHERE participant.organization_id = p_organization_id
      AND participant.conversation_id = p_conversation_id
      AND participant.participant_kind = p_participant_kind
      AND participant.membership_id = p_membership_id;
  ELSE
    SELECT *
    INTO existing_participant
    FROM platform.conversation_participants AS participant
    WHERE participant.organization_id = p_organization_id
      AND participant.conversation_id = p_conversation_id
      AND participant.participant_kind = p_participant_kind
      AND participant.external_subject_ref = btrim(p_external_subject_ref);
  END IF;

  IF existing_participant.id IS NOT NULL THEN
    IF existing_participant.membership_id IS DISTINCT FROM p_membership_id
      OR existing_participant.external_subject_ref IS DISTINCT FROM
        NULLIF(btrim(p_external_subject_ref), '')
    THEN
      RAISE EXCEPTION
        'Participant identity was reused for a different provider subject'
        USING ERRCODE = '22023';
    END IF;

    result := jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_participant_id', existing_participant.id,
      'communication_conversation_id', p_conversation_id,
      'participant_kind', existing_participant.participant_kind,
      'membership_id', existing_participant.membership_id,
      'external_subject_ref', existing_participant.external_subject_ref,
      'source_webhook_event_id',
        existing_participant.source_webhook_event_id,
      'observed_source_webhook_event_id',
        p_source_webhook_event_id,
      'deduplicated', TRUE
    );
  ELSE
    INSERT INTO platform.conversation_participants (
      id,
      organization_id,
      conversation_id,
      participant_kind,
      membership_id,
      external_subject_ref,
      source_webhook_event_id
    )
    VALUES (
      created_participant_id,
      p_organization_id,
      p_conversation_id,
      p_participant_kind,
      p_membership_id,
      NULLIF(btrim(p_external_subject_ref), ''),
      p_source_webhook_event_id
    );

    result := jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_participant_id', created_participant_id,
      'communication_conversation_id', p_conversation_id,
      'participant_kind', p_participant_kind,
      'membership_id', p_membership_id,
      'external_subject_ref',
        NULLIF(btrim(p_external_subject_ref), ''),
      'source_webhook_event_id', p_source_webhook_event_id,
      'observed_source_webhook_event_id',
        p_source_webhook_event_id,
      'deduplicated', FALSE
    );
  END IF;

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
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-communications',
    'communication.participant.record',
    'conversation_participant',
    (result ->> 'conversation_participant_id')::UUID,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform_private.guard_p2f_parent_transition()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER communication_conversations_transition_guard
  BEFORE UPDATE ON platform.communication_conversations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p2f_parent_transition();

CREATE TRIGGER approved_knowledge_versions_transition_guard
  BEFORE UPDATE ON platform.approved_knowledge_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p2f_parent_transition();

CREATE TRIGGER ai_drafts_transition_guard
  BEFORE UPDATE ON platform.ai_drafts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p2f_parent_transition();

CREATE TRIGGER communication_conversations_no_delete
  BEFORE DELETE ON platform.communication_conversations
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER communication_conversations_no_truncate
  BEFORE TRUNCATE ON platform.communication_conversations
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_domain_delete();

CREATE TRIGGER approved_knowledge_versions_no_delete
  BEFORE DELETE ON platform.approved_knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER approved_knowledge_versions_no_truncate
  BEFORE TRUNCATE ON platform.approved_knowledge_versions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_domain_delete();

CREATE TRIGGER ai_drafts_no_delete
  BEFORE DELETE ON platform.ai_drafts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_domain_delete();
CREATE TRIGGER ai_drafts_no_truncate
  BEFORE TRUNCATE ON platform.ai_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_domain_delete();

CREATE TRIGGER provider_webhook_events_append_only
  BEFORE UPDATE OR DELETE ON platform_private.provider_webhook_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER provider_webhook_events_no_truncate
  BEFORE TRUNCATE ON platform_private.provider_webhook_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER conversation_handoff_events_append_only
  BEFORE UPDATE OR DELETE ON platform.conversation_handoff_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER conversation_handoff_events_no_truncate
  BEFORE TRUNCATE ON platform.conversation_handoff_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER conversation_participants_append_only
  BEFORE UPDATE OR DELETE ON platform.conversation_participants
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER conversation_participants_no_truncate
  BEFORE TRUNCATE ON platform.conversation_participants
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER communication_messages_append_only
  BEFORE UPDATE OR DELETE ON platform.communication_messages
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER communication_messages_no_truncate
  BEFORE TRUNCATE ON platform.communication_messages
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER ai_draft_requests_append_only
  BEFORE UPDATE OR DELETE ON platform.ai_draft_requests
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER ai_draft_requests_no_truncate
  BEFORE TRUNCATE ON platform.ai_draft_requests
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER ai_draft_knowledge_citations_append_only
  BEFORE UPDATE OR DELETE ON platform.ai_draft_knowledge_citations
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER ai_draft_knowledge_citations_no_truncate
  BEFORE TRUNCATE ON platform.ai_draft_knowledge_citations
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER ai_draft_events_append_only
  BEFORE UPDATE OR DELETE ON platform.ai_draft_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER ai_draft_events_no_truncate
  BEFORE TRUNCATE ON platform.ai_draft_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER manual_send_authorizations_append_only
  BEFORE UPDATE OR DELETE ON platform.manual_send_authorizations
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER manual_send_authorizations_no_truncate
  BEFORE TRUNCATE ON platform.manual_send_authorizations
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER provider_reconciliation_events_append_only
  BEFORE UPDATE OR DELETE ON platform_private.provider_reconciliation_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER provider_reconciliation_events_no_truncate
  BEFORE TRUNCATE ON platform_private.provider_reconciliation_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- P2F clones immutable v3 bundles and adds only communication, approved
-- knowledge and human draft-review capabilities. It preserves all older
-- bundles as historical evidence.
INSERT INTO platform.permission_definitions (
  permission_key,
  description
)
VALUES
  ('communication.read.full', 'Read an assigned full communication history'),
  ('communication.read.summary', 'Read fixed former-Sales handoff summaries'),
  ('communication.read.self', 'Read fixed self-only Portal message history'),
  ('knowledge.read.approved', 'Read approved versioned knowledge'),
  ('knowledge.manage', 'Publish and retire approved knowledge versions'),
  ('ai.draft.request', 'Request one scoped draft for an inbound message'),
  ('ai.draft.review', 'Select language and review an assigned AI draft'),
  (
    'communication.manual.send',
    'Authorize one reviewed message for human-initiated manual send'
  );

INSERT INTO platform.role_bundle_versions (
  id,
  role,
  version,
  status,
  label
)
VALUES
  (
    '00000000-0000-4000-8000-000000000301',
    'admin',
    4,
    'draft',
    'Admin v4 communications contracts'
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    'sales',
    4,
    'draft',
    'Sales v4 communications contracts'
  ),
  (
    '00000000-0000-4000-8000-000000000303',
    'curator',
    4,
    'draft',
    'Curator v4 communications contracts'
  ),
  (
    '00000000-0000-4000-8000-000000000304',
    'finance',
    4,
    'draft',
    'Finance v4 communications contracts'
  ),
  (
    '00000000-0000-4000-8000-000000000305',
    'student',
    4,
    'draft',
    'Student v4 communications contracts'
  );

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT
  v4.id,
  v4.role,
  v3_permission.permission_key
FROM platform.role_bundle_versions AS v4
JOIN platform.role_bundle_versions AS v3
  ON v3.role = v4.role
  AND v3.version = 3
  AND v3.status = 'published'
JOIN platform.role_bundle_permissions AS v3_permission
  ON v3_permission.bundle_id = v3.id
  AND v3_permission.bundle_role = v3.role
WHERE v4.version = 4;

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT
  bundle.id,
  bundle.role,
  permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 4
  AND (
    bundle.role = 'admin'
    OR (
      bundle.role = 'sales'
      AND permission.permission_key IN (
        'communication.read.full',
        'communication.read.summary',
        'knowledge.read.approved',
        'ai.draft.request',
        'ai.draft.review',
        'communication.manual.send'
      )
    )
    OR (
      bundle.role = 'curator'
      AND permission.permission_key IN (
        'communication.read.full',
        'knowledge.read.approved',
        'ai.draft.request',
        'ai.draft.review',
        'communication.manual.send'
      )
    )
    OR (
      bundle.role = 'student'
      AND permission.permission_key = 'communication.read.self'
    )
  )
  AND permission.permission_key IN (
    'communication.read.full',
    'communication.read.summary',
    'communication.read.self',
    'knowledge.read.approved',
    'knowledge.manage',
    'ai.draft.request',
    'ai.draft.review',
    'communication.manual.send'
  );

UPDATE platform.role_bundle_versions
SET
  status = 'published',
  published_at = statement_timestamp()
WHERE version = 4;

CREATE TEMPORARY TABLE p2f_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v4.id AS new_bundle_id,
  profile.access_version AS previous_access_version,
  COALESCE(
    (
      SELECT MAX(history.role_version)
      FROM platform.membership_role_history AS history
      WHERE history.organization_id = membership.organization_id
        AND history.membership_id = membership.id
    ),
    0
  ) + 1 AS next_role_version,
  gen_random_uuid() AS request_id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS v3
  ON v3.id = membership.current_bundle_id
  AND v3.role = membership."current_role"
  AND v3.version = 3
  AND v3.status = 'published'
JOIN platform.role_bundle_versions AS v4
  ON v4.role = membership."current_role"
  AND v4.version = 4
  AND v4.status = 'published'
WHERE membership."current_role" IS NOT NULL
  AND membership.current_bundle_id IS NOT NULL;

INSERT INTO platform.membership_role_history (
  organization_id,
  membership_id,
  profile_id,
  role_version,
  previous_role,
  new_role,
  previous_bundle_id,
  new_bundle_id,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
)
SELECT
  upgrade.organization_id,
  upgrade.membership_id,
  upgrade.profile_id,
  upgrade.next_role_version,
  upgrade.business_role,
  upgrade.business_role,
  upgrade.previous_bundle_id,
  upgrade.new_bundle_id,
  'system',
  NULL,
  'P2F immutable RBAC bundle upgrade',
  upgrade.request_id
FROM p2f_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM p2f_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM p2f_membership_bundle_upgrades AS upgrade
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
)
SELECT
  upgrade.organization_id,
  'system',
  NULL,
  'migration:044_platform_communications_contracts',
  'rbac.bundle.upgrade',
  'organization_membership',
  upgrade.membership_id,
  jsonb_build_object(
    'role', upgrade.business_role,
    'bundle_id', upgrade.previous_bundle_id,
    'access_version', upgrade.previous_access_version
  ),
  jsonb_build_object(
    'role', upgrade.business_role,
    'bundle_id', upgrade.new_bundle_id,
    'access_version', profile.access_version
  ),
  'P2F immutable RBAC bundle upgrade',
  upgrade.request_id
FROM p2f_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile
  ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION platform_private.lock_p2f_request(
  p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION
      'request_id is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2f:request:' || p_request_id::TEXT,
      0
    )
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.lock_p2f_request(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION private.platform_can_read_communication_full(
  p_organization_id UUID,
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
      AND profile.auth_user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND membership.status = 'active'
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND private.platform_has_permission(
        p_organization_id,
        'communication.read.full'
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
          AND conversation.responsible_sales_membership_id =
            membership.id
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
              AND student_case.responsible_sales_membership_id =
                membership.id
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
          AND conversation.current_curator_membership_id =
            membership.id
          AND student_case.state IN ('active', 'closed')
          AND student_case.current_curator_membership_id =
            membership.id
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

REVOKE ALL ON FUNCTION private.platform_can_read_communication_full(
  UUID,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION private.platform_can_read_communication_full(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.platform_can_read_approved_knowledge(
  p_organization_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE membership.organization_id = p_organization_id
      AND profile.auth_user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND membership.status = 'active'
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role" IN ('admin', 'sales', 'curator')
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND private.platform_has_permission(
        p_organization_id,
        'knowledge.read.approved'
      )
      AND (
        membership."current_role" <> 'admin'
        OR platform_private.membership_has_active_scope(
          p_organization_id,
          membership.id,
          'organization',
          p_organization_id
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.platform_can_read_approved_knowledge(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION private.platform_can_read_approved_knowledge(UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION platform_private.require_p2f_admin_actor(
  p_organization_id UUID,
  p_permission_key TEXT
)
RETURNS TABLE (
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID,
  actor_role platform.business_role
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    p_permission_key
  );

  IF actor.actor_role <> 'admin'
    OR NOT platform_private.membership_has_active_scope(
      p_organization_id,
      actor.actor_membership_id,
      'organization',
      p_organization_id
    )
  THEN
    RAISE EXCEPTION
      'Active organization-scoped Admin permission is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_p2f_admin_actor(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.require_communication_actor(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_permission_key TEXT
)
RETURNS TABLE (
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID,
  actor_role platform.business_role
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  conversation_row platform.communication_conversations%ROWTYPE;
  student_case platform.student_cases%ROWTYPE;
BEGIN
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    p_permission_key
  );

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF conversation_row.student_case_id IS NOT NULL THEN
    SELECT *
    INTO student_case
    FROM platform.student_cases AS target_case
    WHERE target_case.organization_id = p_organization_id
      AND target_case.id = conversation_row.student_case_id;
  END IF;

  IF NOT (
    (
      actor.actor_role = 'admin'
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'organization',
        p_organization_id
      )
    )
    OR (
      actor.actor_role = 'sales'
      AND conversation_row.queue = 'sales'
      AND conversation_row.responsible_sales_membership_id =
        actor.actor_membership_id
      AND (
        (
          conversation_row.student_case_id IS NULL
          AND platform_private.membership_has_active_scope(
            p_organization_id,
            actor.actor_membership_id,
            'conversation',
            conversation_row.id
          )
        )
        OR (
          conversation_row.student_case_id IS NOT NULL
          AND student_case.state = 'pending'
          AND student_case.responsible_sales_membership_id =
            actor.actor_membership_id
          AND platform_private.membership_has_active_scope(
            p_organization_id,
            actor.actor_membership_id,
            'student_case',
            student_case.id
          )
        )
      )
    )
    OR (
      actor.actor_role = 'curator'
      AND conversation_row.queue = 'curator'
      AND conversation_row.student_case_id IS NOT NULL
      AND conversation_row.current_curator_membership_id =
        actor.actor_membership_id
      AND student_case.state IN ('active', 'closed')
      AND student_case.current_curator_membership_id =
        actor.actor_membership_id
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        actor.actor_membership_id,
        'student_case',
        student_case.id
      )
    )
  ) THEN
    RAISE EXCEPTION
      'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_communication_actor(
  UUID,
  UUID,
  TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE POLICY communication_conversations_full_read
  ON platform.communication_conversations
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      id
    ))
  );

CREATE POLICY conversation_handoff_events_full_read
  ON platform.conversation_handoff_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

CREATE POLICY conversation_participants_full_read
  ON platform.conversation_participants
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

CREATE POLICY communication_messages_full_read
  ON platform.communication_messages
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

CREATE POLICY approved_knowledge_versions_read
  ON platform.approved_knowledge_versions
  FOR SELECT
  TO authenticated
  USING (
    status = 'approved'
    AND (SELECT private.platform_can_read_approved_knowledge(
      organization_id
    ))
  );

CREATE POLICY ai_draft_requests_full_read
  ON platform.ai_draft_requests
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

CREATE POLICY ai_drafts_full_read
  ON platform.ai_drafts
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

CREATE POLICY ai_draft_knowledge_citations_full_read
  ON platform.ai_draft_knowledge_citations
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

CREATE POLICY ai_draft_events_full_read
  ON platform.ai_draft_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

CREATE POLICY manual_send_authorizations_full_read
  ON platform.manual_send_authorizations
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

CREATE OR REPLACE FUNCTION platform.persist_provider_webhook_event(
  p_organization_id UUID,
  p_provider platform.communication_provider,
  p_provider_account_ref TEXT,
  p_provider_conversation_ref TEXT,
  p_provider_event_variant_ref TEXT,
  p_provider_request_id TEXT,
  p_waha_session_name TEXT,
  p_payload_id TEXT,
  p_event_type TEXT,
  p_provider_occurred_at TIMESTAMPTZ,
  p_verification_status platform.webhook_verification_status,
  p_raw_payload JSONB,
  p_verification_headers JSONB,
  p_verification_evidence_ref TEXT,
  p_payload_sha256 TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_match platform_private.provider_webhook_events%ROWTYPE;
  business_match platform_private.provider_webhook_events%ROWTYPE;
  existing_event platform_private.provider_webhook_events%ROWTYPE;
  replayed JSONB;
  created_event_id UUID := gen_random_uuid();
  normalized_event_variant_ref TEXT;
  fixed_reason CONSTANT TEXT :=
    'Persist private provider webhook evidence before processing';
  result JSONB;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'Service role is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_provider IS NULL
    OR p_provider_account_ref IS NULL
    OR btrim(p_provider_account_ref) = ''
    OR p_provider_request_id IS NULL
    OR btrim(p_provider_request_id) = ''
    OR p_payload_id IS NULL
    OR btrim(p_payload_id) = ''
    OR p_event_type IS NULL
    OR btrim(p_event_type) = ''
    OR p_provider_occurred_at IS NULL
    OR p_verification_status IS NULL
    OR p_raw_payload IS NULL
    OR p_verification_headers IS NULL
    OR p_verification_evidence_ref IS NULL
    OR btrim(p_verification_evidence_ref) = ''
    OR lower(btrim(p_payload_sha256)) !~ '^[0-9a-f]{64}$'
    OR (
      p_provider_event_variant_ref IS NOT NULL
      AND btrim(p_provider_event_variant_ref) = ''
    )
    OR (
      p_provider = 'waha'
      AND (
        p_waha_session_name IS NULL
        OR btrim(p_waha_session_name) = ''
        OR p_provider_conversation_ref IS NOT NULL
        OR (
          btrim(p_event_type) = 'message.ack'
          AND p_provider_event_variant_ref IS NULL
        )
        OR (
          btrim(p_event_type) = 'message.any'
          AND p_provider_event_variant_ref IS NOT NULL
        )
      )
    )
    OR (
      p_provider = 'kommo'
      AND (
        p_waha_session_name IS NOT NULL
        OR p_provider_conversation_ref IS NULL
        OR btrim(p_provider_conversation_ref) = ''
      )
    )
    OR (
      p_provider = 'amocrm'
      AND (
        p_waha_session_name IS NOT NULL
        OR p_provider_conversation_ref IS NOT NULL
      )
    )
  THEN
    RAISE EXCEPTION
      'Complete private provider webhook evidence is required'
      USING ERRCODE = '22023';
  END IF;

  normalized_event_variant_ref := CASE
    WHEN p_provider = 'waha'
      AND btrim(p_event_type) = 'message.ack'
      AND lower(btrim(p_provider_event_variant_ref)) IN (
        'error',
        'pending',
        'server',
        'device',
        'read',
        'played',
        'unknown'
      )
    THEN lower(btrim(p_provider_event_variant_ref))
    ELSE NULLIF(btrim(p_provider_event_variant_ref), '')
  END;

  replayed := platform_private.replay_audit(
    p_request_id,
    'communication.webhook.persist',
    'provider_webhook_event',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'provider', p_provider,
      'provider_account_ref', btrim(p_provider_account_ref),
      'provider_conversation_ref',
        NULLIF(btrim(p_provider_conversation_ref), ''),
      'provider_event_variant_ref',
        normalized_event_variant_ref,
      'observed_provider_request_id', btrim(p_provider_request_id),
      'waha_session_name', NULLIF(btrim(p_waha_session_name), ''),
      'payload_id', btrim(p_payload_id),
      'event_type', btrim(p_event_type),
      'provider_occurred_at', p_provider_occurred_at,
      'verification_status', p_verification_status,
      'verification_evidence_ref',
        btrim(p_verification_evidence_ref),
      'payload_sha256', lower(btrim(p_payload_sha256))
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  -- Serialize both independent dedupe domains. A provider can redeliver the
  -- same business event with a fresh transport request id, while a reused
  -- transport request id must never point at a different business event.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2f:webhook-request:'
        || p_organization_id::TEXT
        || ':'
        || p_provider::TEXT
        || ':'
        || btrim(p_provider_account_ref)
        || ':'
        || btrim(p_provider_request_id),
      0
    )
  );
  IF p_provider = 'waha' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'evo:p2f:webhook-business:'
          || p_organization_id::TEXT
          || ':'
          || btrim(p_provider_account_ref)
          || ':'
          || btrim(p_waha_session_name)
          || ':'
          || btrim(p_event_type)
          || ':'
          || btrim(p_payload_id)
          || ':'
          || COALESCE(normalized_event_variant_ref, ''),
        0
      )
    );
  END IF;

  SELECT *
  INTO request_match
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.provider = p_provider
    AND event.provider_account_ref = btrim(p_provider_account_ref)
    AND event.provider_request_id = btrim(p_provider_request_id)
  FOR UPDATE;

  IF p_provider = 'waha' THEN
    SELECT *
    INTO business_match
    FROM platform_private.provider_webhook_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.provider = 'waha'
      AND event.provider_account_ref = btrim(p_provider_account_ref)
      AND event.waha_session_name = btrim(p_waha_session_name)
      AND event.event_type = btrim(p_event_type)
      AND event.payload_id = btrim(p_payload_id)
      AND event.provider_event_variant_ref IS NOT DISTINCT FROM
        normalized_event_variant_ref
    FOR UPDATE;
  END IF;

  IF request_match.id IS NOT NULL
    AND business_match.id IS NOT NULL
    AND request_match.id <> business_match.id
  THEN
    RAISE EXCEPTION
      'Provider request and business keys resolve to different events'
      USING ERRCODE = '23505';
  END IF;

  IF request_match.id IS NOT NULL THEN
    existing_event := request_match;
  ELSE
    existing_event := business_match;
  END IF;

  IF existing_event.id IS NOT NULL THEN
    IF existing_event.provider <> p_provider
      OR existing_event.provider_account_ref <>
        btrim(p_provider_account_ref)
      OR existing_event.provider_conversation_ref IS DISTINCT FROM
        NULLIF(btrim(p_provider_conversation_ref), '')
      OR existing_event.provider_event_variant_ref IS DISTINCT FROM
        normalized_event_variant_ref
      OR existing_event.waha_session_name IS DISTINCT FROM
        NULLIF(btrim(p_waha_session_name), '')
      OR existing_event.payload_id <> btrim(p_payload_id)
      OR existing_event.event_type <> btrim(p_event_type)
      OR existing_event.provider_occurred_at <>
        p_provider_occurred_at
      OR existing_event.verification_status <>
        p_verification_status
      OR existing_event.raw_payload <> p_raw_payload
      OR existing_event.verification_headers <>
        p_verification_headers
      OR existing_event.verification_evidence_ref <>
        btrim(p_verification_evidence_ref)
      OR existing_event.payload_sha256 <>
        lower(btrim(p_payload_sha256))
    THEN
      RAISE EXCEPTION
        'Provider webhook dedupe key was reused for different evidence'
        USING ERRCODE = '22023';
    END IF;

    result := jsonb_build_object(
      'organization_id', p_organization_id,
      'provider_webhook_event_id', existing_event.id,
      'provider', p_provider,
      'provider_account_ref', existing_event.provider_account_ref,
      'provider_conversation_ref',
        existing_event.provider_conversation_ref,
      'provider_event_variant_ref',
        existing_event.provider_event_variant_ref,
      'provider_request_id', existing_event.provider_request_id,
      'observed_provider_request_id', btrim(p_provider_request_id),
      'waha_session_name', existing_event.waha_session_name,
      'payload_id', existing_event.payload_id,
      'event_type', existing_event.event_type,
      'provider_occurred_at', existing_event.provider_occurred_at,
      'verification_status', existing_event.verification_status,
      'verification_evidence_ref',
        existing_event.verification_evidence_ref,
      'payload_sha256', existing_event.payload_sha256,
      'deduplicated', TRUE,
      'persisted_before_processing', TRUE
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
    )
    VALUES (
      p_organization_id,
      'service',
      NULL,
      'service:platform-provider-webhook',
      'communication.webhook.persist',
      'provider_webhook_event',
      existing_event.id,
      NULL,
      result,
      fixed_reason,
      p_request_id
    );

    RETURN result;
  END IF;

  INSERT INTO platform_private.provider_webhook_events (
    id,
    organization_id,
    provider,
    provider_account_ref,
    provider_conversation_ref,
    provider_event_variant_ref,
    provider_request_id,
    waha_session_name,
    payload_id,
    event_type,
    provider_occurred_at,
    verification_status,
    raw_payload,
    verification_headers,
    verification_evidence_ref,
    payload_sha256,
    request_id
  )
  VALUES (
    created_event_id,
    p_organization_id,
    p_provider,
    btrim(p_provider_account_ref),
    NULLIF(btrim(p_provider_conversation_ref), ''),
    normalized_event_variant_ref,
    btrim(p_provider_request_id),
    NULLIF(btrim(p_waha_session_name), ''),
    btrim(p_payload_id),
    btrim(p_event_type),
    p_provider_occurred_at,
    p_verification_status,
    p_raw_payload,
    p_verification_headers,
    btrim(p_verification_evidence_ref),
    lower(btrim(p_payload_sha256)),
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'provider_webhook_event_id', created_event_id,
    'provider', p_provider,
    'provider_account_ref', btrim(p_provider_account_ref),
    'provider_conversation_ref',
      NULLIF(btrim(p_provider_conversation_ref), ''),
    'provider_event_variant_ref',
      normalized_event_variant_ref,
    'provider_request_id', btrim(p_provider_request_id),
    'observed_provider_request_id', btrim(p_provider_request_id),
    'waha_session_name', NULLIF(btrim(p_waha_session_name), ''),
    'payload_id', btrim(p_payload_id),
    'event_type', btrim(p_event_type),
    'provider_occurred_at', p_provider_occurred_at,
    'verification_status', p_verification_status,
    'verification_evidence_ref', btrim(p_verification_evidence_ref),
    'payload_sha256', lower(btrim(p_payload_sha256)),
    'deduplicated', FALSE,
    'persisted_before_processing', TRUE
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
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-provider-webhook',
    'communication.webhook.persist',
    'provider_webhook_event',
    created_event_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.publish_approved_knowledge_version(
  p_organization_id UUID,
  p_knowledge_key TEXT,
  p_title TEXT,
  p_version BIGINT,
  p_content_text TEXT,
  p_content_sha256 TEXT,
  p_provenance_ref TEXT,
  p_reason TEXT,
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
  created_knowledge_id UUID := gen_random_uuid();
  expected_version BIGINT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_knowledge_key IS NULL
    OR p_knowledge_key !~ '^[a-z][a-z0-9_.-]*$'
    OR p_title IS NULL
    OR btrim(p_title) = ''
    OR p_version IS NULL
    OR p_version <= 0
    OR p_content_text IS NULL
    OR btrim(p_content_text) = ''
    OR lower(btrim(p_content_sha256)) !~ '^[0-9a-f]{64}$'
    OR lower(btrim(p_content_sha256)) <>
      encode(sha256(convert_to(p_content_text, 'UTF8')), 'hex')
    OR p_provenance_ref IS NULL
    OR btrim(p_provenance_ref) = ''
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
  THEN
    RAISE EXCEPTION
      'Complete, integrity-checked knowledge evidence is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_p2f_admin_actor(
    p_organization_id,
    'knowledge.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'knowledge.version.publish',
    'approved_knowledge_version',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'approved_knowledge_version_id', NULL,
      'knowledge_key', p_knowledge_key,
      'title', btrim(p_title),
      'version', p_version,
      'status', 'approved',
      'content_sha256', lower(btrim(p_content_sha256)),
      'provenance_ref', btrim(p_provenance_ref),
      'approved_by_membership_id', actor.actor_membership_id
    ) - 'approved_knowledge_version_id'
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2f:knowledge:'
        || p_organization_id::TEXT
        || ':'
        || p_knowledge_key,
      0
    )
  );

  SELECT COALESCE(MAX(knowledge.version), 0) + 1
  INTO expected_version
  FROM platform.approved_knowledge_versions AS knowledge
  WHERE knowledge.organization_id = p_organization_id
    AND knowledge.knowledge_key = p_knowledge_key;

  IF p_version <> expected_version THEN
    RAISE EXCEPTION
      'Knowledge version must be the next immutable version: expected %',
      expected_version
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.approved_knowledge_versions (
    id,
    organization_id,
    knowledge_key,
    title,
    version,
    status,
    content_text,
    content_sha256,
    provenance_ref,
    approved_by_membership_id
  )
  VALUES (
    created_knowledge_id,
    p_organization_id,
    p_knowledge_key,
    btrim(p_title),
    p_version,
    'approved',
    p_content_text,
    lower(btrim(p_content_sha256)),
    btrim(p_provenance_ref),
    actor.actor_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'approved_knowledge_version_id', created_knowledge_id,
    'knowledge_key', p_knowledge_key,
    'title', btrim(p_title),
    'version', p_version,
    'status', 'approved',
    'content_sha256', lower(btrim(p_content_sha256)),
    'provenance_ref', btrim(p_provenance_ref),
    'approved_by_membership_id', actor.actor_membership_id
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
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'knowledge.version.publish',
    'approved_knowledge_version',
    created_knowledge_id,
    NULL,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.retire_approved_knowledge_version(
  p_organization_id UUID,
  p_knowledge_version_id UUID,
  p_reason TEXT,
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
  knowledge_row platform.approved_knowledge_versions%ROWTYPE;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_knowledge_version_id IS NULL
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
  THEN
    RAISE EXCEPTION
      'Knowledge version and retirement reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_p2f_admin_actor(
    p_organization_id,
    'knowledge.manage'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'knowledge.version.retire',
    'approved_knowledge_version',
    p_knowledge_version_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'approved_knowledge_version_id', p_knowledge_version_id,
      'status', 'retired',
      'retired_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO knowledge_row
  FROM platform.approved_knowledge_versions AS knowledge
  WHERE knowledge.organization_id = p_organization_id
    AND knowledge.id = p_knowledge_version_id
  FOR UPDATE;

  IF knowledge_row.id IS NULL OR knowledge_row.status <> 'approved' THEN
    RAISE EXCEPTION
      'Only an approved tenant knowledge version can be retired'
      USING ERRCODE = '55000';
  END IF;

  UPDATE platform.approved_knowledge_versions
  SET
    status = 'retired',
    retired_by_membership_id = actor.actor_membership_id,
    retired_at = statement_timestamp(),
    retirement_reason = btrim(p_reason)
  WHERE organization_id = p_organization_id
    AND id = p_knowledge_version_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'approved_knowledge_version_id', p_knowledge_version_id,
    'knowledge_key', knowledge_row.knowledge_key,
    'version', knowledge_row.version,
    'status', 'retired',
    'retired_by_membership_id', actor.actor_membership_id
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
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'knowledge.version.retire',
    'approved_knowledge_version',
    p_knowledge_version_id,
    jsonb_build_object(
      'status', knowledge_row.status,
      'retired_by_membership_id',
        knowledge_row.retired_by_membership_id
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.request_ai_draft(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_source_message_id UUID,
  p_requested_language platform.ai_draft_language,
  p_reason TEXT,
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
  conversation_row platform.communication_conversations%ROWTYPE;
  message_row platform.communication_messages%ROWTYPE;
  created_request_id UUID := gen_random_uuid();
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_source_message_id IS NULL
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
  THEN
    RAISE EXCEPTION
      'Source message and explicit staff request reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.request'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.draft.request',
    'ai_draft_request',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'communication_conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'requested_language', p_requested_language,
      'requested_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id
    AND conversation.status = 'open'
  FOR UPDATE;

  SELECT *
  INTO message_row
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.id = p_source_message_id
    AND message.conversation_id = p_conversation_id
    AND message.direction = 'inbound';

  IF conversation_row.id IS NULL
    OR message_row.id IS NULL
    OR EXISTS (
      SELECT 1
      FROM platform.communication_messages AS later_message
      WHERE later_message.organization_id = p_organization_id
        AND later_message.conversation_id = p_conversation_id
        AND later_message.direction = 'inbound'
        AND (
          later_message.created_at,
          later_message.id
        ) > (
          message_row.created_at,
          message_row.id
        )
    )
  THEN
    RAISE EXCEPTION
      'AI draft source must be the latest inbound message in an open conversation'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.ai_draft_requests (
    id,
    organization_id,
    conversation_id,
    student_case_id,
    source_message_id,
    requested_language,
    requested_by_profile_id,
    requested_by_membership_id,
    reason,
    request_id
  )
  VALUES (
    created_request_id,
    p_organization_id,
    p_conversation_id,
    conversation_row.student_case_id,
    p_source_message_id,
    p_requested_language,
    actor.actor_profile_id,
    actor.actor_membership_id,
    btrim(p_reason),
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'ai_draft_request_id', created_request_id,
    'communication_conversation_id', p_conversation_id,
    'source_message_id', p_source_message_id,
    'requested_language', p_requested_language,
    'requested_by_membership_id', actor.actor_membership_id
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
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'ai.draft.request',
    'ai_draft_request',
    created_request_id,
    NULL,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.record_ai_draft(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_source_message_id UUID,
  p_detection_status platform.ai_language_detection_status,
  p_selected_language platform.ai_draft_language,
  p_knowledge_version_id UUID,
  p_generated_text TEXT,
  p_provider_ref TEXT,
  p_model_ref TEXT,
  p_prompt_policy_version TEXT,
  p_source_context JSONB,
  p_source_context_sha256 TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  draft_request platform.ai_draft_requests%ROWTYPE;
  source_message platform.communication_messages%ROWTYPE;
  previous_draft platform.ai_drafts%ROWTYPE;
  knowledge_row platform.approved_knowledge_versions%ROWTYPE;
  created_draft_id UUID := gen_random_uuid();
  target_state platform.ai_draft_state;
  failure_outcome TEXT;
  generated_hash TEXT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Record draft-only AI evidence after explicit staff request';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_detection_status IS NULL
    OR p_source_context IS NULL
    OR lower(btrim(p_source_context_sha256)) !~ '^[0-9a-f]{64}$'
    OR lower(btrim(p_source_context_sha256)) <>
      encode(
        sha256(convert_to(p_source_context::TEXT, 'UTF8')),
        'hex'
      )
  THEN
    RAISE EXCEPTION
      'Immutable source context and valid detection status are required'
      USING ERRCODE = '22023';
  END IF;

  generated_hash := CASE
    WHEN p_generated_text IS NULL THEN NULL
    ELSE encode(
      sha256(convert_to(p_generated_text, 'UTF8')),
      'hex'
    )
  END;

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.draft.record',
    'ai_draft',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'communication_conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'detection_status', p_detection_status,
      'selected_language', p_selected_language,
      'knowledge_version_id', p_knowledge_version_id,
      'provider_ref', NULLIF(btrim(p_provider_ref), ''),
      'model_ref', NULLIF(btrim(p_model_ref), ''),
      'prompt_policy_version',
        NULLIF(btrim(p_prompt_policy_version), ''),
      'source_context_sha256',
        lower(btrim(p_source_context_sha256)),
      'generated_text_sha256', generated_hash
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2f:ai-draft-source:'
        || p_organization_id::TEXT
        || ':'
        || p_source_message_id::TEXT,
      0
    )
  );

  SELECT *
  INTO draft_request
  FROM platform.ai_draft_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.conversation_id = p_conversation_id
    AND request.source_message_id = p_source_message_id
  FOR UPDATE;

  SELECT *
  INTO source_message
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.id = p_source_message_id
    AND message.conversation_id = p_conversation_id
    AND message.direction = 'inbound';

  IF draft_request.id IS NULL
    OR source_message.id IS NULL
    OR EXISTS (
      SELECT 1
      FROM platform.communication_messages AS later_message
      WHERE later_message.organization_id = p_organization_id
        AND later_message.conversation_id = p_conversation_id
        AND later_message.direction = 'inbound'
        AND (
          later_message.created_at,
          later_message.id
        ) > (
          source_message.created_at,
          source_message.id
        )
    )
  THEN
    RAISE EXCEPTION
      'A current explicit draft request for the latest inbound message is required'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO previous_draft
  FROM platform.ai_drafts AS prior_draft
  WHERE prior_draft.organization_id = p_organization_id
    AND prior_draft.source_message_id = p_source_message_id
  ORDER BY prior_draft.created_at DESC, prior_draft.id DESC
  LIMIT 1
  FOR UPDATE;

  IF previous_draft.id IS NOT NULL
    AND previous_draft.state <> 'rework_requested'
  THEN
    RAISE EXCEPTION
      'A successor draft requires a terminal rework request'
      USING ERRCODE = '55000';
  END IF;

  IF p_detection_status = 'uncertain' THEN
    IF source_message.language <> 'undetermined'
      OR p_selected_language IS NOT NULL
      OR p_knowledge_version_id IS NOT NULL
      OR p_generated_text IS NOT NULL
      OR p_provider_ref IS NOT NULL
      OR p_model_ref IS NOT NULL
      OR p_prompt_policy_version IS NOT NULL
    THEN
      RAISE EXCEPTION
        'Uncertain language must fail closed before provider generation'
        USING ERRCODE = '22023';
    END IF;

    target_state := 'awaiting_language_selection';
    failure_outcome := 'language_uncertain';
    generated_hash := NULL;
  ELSE
    IF source_message.language = 'undetermined'
      OR p_selected_language IS NULL
      OR p_selected_language::TEXT <> source_message.language::TEXT
      OR (
        draft_request.requested_language IS NOT NULL
        AND draft_request.requested_language <> p_selected_language
      )
      OR p_knowledge_version_id IS NULL
      OR p_generated_text IS NULL
      OR btrim(p_generated_text) = ''
      OR p_provider_ref IS NULL
      OR btrim(p_provider_ref) = ''
      OR p_model_ref IS NULL
      OR btrim(p_model_ref) = ''
      OR p_prompt_policy_version IS NULL
      OR btrim(p_prompt_policy_version) = ''
    THEN
      RAISE EXCEPTION
        'Confident draft requires RU/EN source, provider metadata and content'
        USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO knowledge_row
    FROM platform.approved_knowledge_versions AS knowledge
    WHERE knowledge.organization_id = p_organization_id
      AND knowledge.id = p_knowledge_version_id
      AND knowledge.status = 'approved';

    IF knowledge_row.id IS NULL THEN
      RAISE EXCEPTION
        'Draft generation requires an approved knowledge version'
        USING ERRCODE = '42501';
    END IF;

    target_state := 'review_required';
    failure_outcome := NULL;
  END IF;

  INSERT INTO platform.ai_drafts (
    id,
    organization_id,
    conversation_id,
    student_case_id,
    source_message_id,
    ai_draft_request_id,
    supersedes_ai_draft_id,
    detection_status,
    selected_language,
    knowledge_version_id,
    provider_ref,
    model_ref,
    prompt_policy_version,
    source_context,
    source_context_sha256,
    generated_text,
    generated_text_sha256,
    failure_outcome,
    state
  )
  VALUES (
    created_draft_id,
    p_organization_id,
    p_conversation_id,
    source_message.student_case_id,
    p_source_message_id,
    draft_request.id,
    previous_draft.id,
    p_detection_status,
    p_selected_language,
    p_knowledge_version_id,
    NULLIF(btrim(p_provider_ref), ''),
    NULLIF(btrim(p_model_ref), ''),
    NULLIF(btrim(p_prompt_policy_version), ''),
    p_source_context,
    lower(btrim(p_source_context_sha256)),
    p_generated_text,
    generated_hash,
    failure_outcome,
    target_state
  );

  IF p_knowledge_version_id IS NOT NULL THEN
    INSERT INTO platform.ai_draft_knowledge_citations (
      organization_id,
      conversation_id,
      ai_draft_id,
      knowledge_version_id,
      citation_order,
      request_id
    )
    VALUES (
      p_organization_id,
      p_conversation_id,
      created_draft_id,
      p_knowledge_version_id,
      1,
      p_request_id
    );
  END IF;

  INSERT INTO platform.ai_draft_events (
    organization_id,
    conversation_id,
    ai_draft_id,
    event_type,
    previous_state,
    new_state,
    selected_language,
    knowledge_version_id,
    review_decision,
    content_text,
    actor_kind,
    actor_profile_id,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    created_draft_id,
    'created',
    NULL,
    target_state,
    p_selected_language,
    p_knowledge_version_id,
    NULL,
    p_generated_text,
    'service',
    NULL,
    NULL,
    fixed_reason,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'ai_draft_id', created_draft_id,
    'ai_draft_request_id', draft_request.id,
    'supersedes_ai_draft_id', previous_draft.id,
    'communication_conversation_id', p_conversation_id,
    'source_message_id', p_source_message_id,
    'detection_status', p_detection_status,
    'selected_language', p_selected_language,
    'knowledge_version_id', p_knowledge_version_id,
    'provider_ref', NULLIF(btrim(p_provider_ref), ''),
    'model_ref', NULLIF(btrim(p_model_ref), ''),
    'prompt_policy_version',
      NULLIF(btrim(p_prompt_policy_version), ''),
    'source_context_sha256',
      lower(btrim(p_source_context_sha256)),
    'generated_text_sha256', generated_hash,
    'failure_outcome', failure_outcome,
    'state', target_state
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
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-draft-worker',
    'ai.draft.record',
    'ai_draft',
    created_draft_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.complete_ai_draft_generation(
  p_organization_id UUID,
  p_ai_draft_id UUID,
  p_knowledge_version_id UUID,
  p_generated_text TEXT,
  p_provider_ref TEXT,
  p_model_ref TEXT,
  p_prompt_policy_version TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  draft_row platform.ai_drafts%ROWTYPE;
  knowledge_row platform.approved_knowledge_versions%ROWTYPE;
  generated_hash TEXT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Complete generation only after explicit human RU or EN selection';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_knowledge_version_id IS NULL
    OR p_generated_text IS NULL
    OR btrim(p_generated_text) = ''
    OR p_provider_ref IS NULL
    OR btrim(p_provider_ref) = ''
    OR p_model_ref IS NULL
    OR btrim(p_model_ref) = ''
    OR p_prompt_policy_version IS NULL
    OR btrim(p_prompt_policy_version) = ''
  THEN
    RAISE EXCEPTION
      'Approved knowledge, provider metadata and generated text are required'
      USING ERRCODE = '22023';
  END IF;

  generated_hash :=
    encode(sha256(convert_to(p_generated_text, 'UTF8')), 'hex');

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.draft.generate',
    'ai_draft',
    p_ai_draft_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'ai_draft_id', p_ai_draft_id,
      'knowledge_version_id', p_knowledge_version_id,
      'provider_ref', btrim(p_provider_ref),
      'model_ref', btrim(p_model_ref),
      'prompt_policy_version', btrim(p_prompt_policy_version),
      'generated_text_sha256', generated_hash,
      'state', 'review_required'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO draft_row
  FROM platform.ai_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.id = p_ai_draft_id
  FOR UPDATE;

  SELECT *
  INTO knowledge_row
  FROM platform.approved_knowledge_versions AS knowledge
  WHERE knowledge.organization_id = p_organization_id
    AND knowledge.id = p_knowledge_version_id
    AND knowledge.status = 'approved';

  IF draft_row.id IS NULL
    OR draft_row.state <> 'language_selected'
    OR draft_row.detection_status <> 'uncertain'
    OR draft_row.selected_language IS NULL
    OR knowledge_row.id IS NULL
  THEN
    RAISE EXCEPTION
      'Human-selected draft and approved knowledge are required'
      USING ERRCODE = '55000';
  END IF;

  UPDATE platform.ai_drafts
  SET
    knowledge_version_id = p_knowledge_version_id,
    provider_ref = btrim(p_provider_ref),
    model_ref = btrim(p_model_ref),
    prompt_policy_version = btrim(p_prompt_policy_version),
    generated_text = p_generated_text,
    generated_text_sha256 = generated_hash,
    failure_outcome = NULL,
    state = 'review_required'
  WHERE organization_id = p_organization_id
    AND id = p_ai_draft_id;

  INSERT INTO platform.ai_draft_knowledge_citations (
    organization_id,
    conversation_id,
    ai_draft_id,
    knowledge_version_id,
    citation_order,
    request_id
  )
  VALUES (
    p_organization_id,
    draft_row.conversation_id,
    p_ai_draft_id,
    p_knowledge_version_id,
    1,
    p_request_id
  );

  INSERT INTO platform.ai_draft_events (
    organization_id,
    conversation_id,
    ai_draft_id,
    event_type,
    previous_state,
    new_state,
    selected_language,
    knowledge_version_id,
    review_decision,
    content_text,
    actor_kind,
    actor_profile_id,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    draft_row.conversation_id,
    p_ai_draft_id,
    'generation_completed',
    draft_row.state,
    'review_required',
    draft_row.selected_language,
    p_knowledge_version_id,
    NULL,
    p_generated_text,
    'service',
    NULL,
    NULL,
    fixed_reason,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'ai_draft_id', p_ai_draft_id,
    'knowledge_version_id', p_knowledge_version_id,
    'provider_ref', btrim(p_provider_ref),
    'model_ref', btrim(p_model_ref),
    'prompt_policy_version', btrim(p_prompt_policy_version),
    'generated_text_sha256', generated_hash,
    'state', 'review_required'
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
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-draft-worker',
    'ai.draft.generate',
    'ai_draft',
    p_ai_draft_id,
    jsonb_build_object(
      'state', draft_row.state,
      'failure_outcome', draft_row.failure_outcome
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.resolve_ai_draft_language(
  p_organization_id UUID,
  p_ai_draft_id UUID,
  p_selected_language platform.ai_draft_language,
  p_handoff BOOLEAN,
  p_reason TEXT,
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
  draft_row platform.ai_drafts%ROWTYPE;
  target_state platform.ai_draft_state;
  target_event platform.ai_draft_event_type;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_ai_draft_id IS NULL
    OR p_handoff IS NULL
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
    OR (p_handoff AND p_selected_language IS NOT NULL)
    OR (NOT p_handoff AND p_selected_language IS NULL)
  THEN
    RAISE EXCEPTION
      'Choose RU/EN or explicitly hand off with a reason'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO draft_row
  FROM platform.ai_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.id = p_ai_draft_id
  FOR UPDATE;

  IF draft_row.id IS NULL THEN
    RAISE EXCEPTION
      'AI draft is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    draft_row.conversation_id,
    'ai.draft.review'
  );

  target_state := CASE
    WHEN p_handoff THEN 'handed_off'
    ELSE 'language_selected'
  END;
  target_event := CASE
    WHEN p_handoff THEN 'handed_off'
    ELSE 'language_selected'
  END;

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.draft.language.resolve',
    'ai_draft',
    p_ai_draft_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'ai_draft_id', p_ai_draft_id,
      'selected_language', p_selected_language,
      'state', target_state,
      'resolved_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF draft_row.state <> 'awaiting_language_selection'
    OR draft_row.detection_status <> 'uncertain'
  THEN
    RAISE EXCEPTION
      'Only an uncertain draft awaiting human language selection can change'
      USING ERRCODE = '55000';
  END IF;

  IF p_handoff THEN
    UPDATE platform.ai_drafts
    SET
      state = 'handed_off',
      reviewed_by_membership_id = actor.actor_membership_id,
      reviewed_at = statement_timestamp(),
      review_reason = btrim(p_reason)
    WHERE organization_id = p_organization_id
      AND id = p_ai_draft_id;
  ELSE
    UPDATE platform.ai_drafts
    SET
      selected_language = p_selected_language,
      state = 'language_selected'
    WHERE organization_id = p_organization_id
      AND id = p_ai_draft_id;
  END IF;

  INSERT INTO platform.ai_draft_events (
    organization_id,
    conversation_id,
    ai_draft_id,
    event_type,
    previous_state,
    new_state,
    selected_language,
    knowledge_version_id,
    review_decision,
    content_text,
    actor_kind,
    actor_profile_id,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    draft_row.conversation_id,
    p_ai_draft_id,
    target_event,
    draft_row.state,
    target_state,
    p_selected_language,
    NULL,
    CASE
      WHEN p_handoff
        THEN 'handoff'::platform.ai_draft_review_decision
      ELSE NULL::platform.ai_draft_review_decision
    END,
    NULL,
    'user',
    actor.actor_profile_id,
    actor.actor_membership_id,
    btrim(p_reason),
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'ai_draft_id', p_ai_draft_id,
    'selected_language', p_selected_language,
    'state', target_state,
    'resolved_by_membership_id', actor.actor_membership_id
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
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'ai.draft.language.resolve',
    'ai_draft',
    p_ai_draft_id,
    jsonb_build_object(
      'selected_language', draft_row.selected_language,
      'state', draft_row.state
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.review_ai_draft(
  p_organization_id UUID,
  p_ai_draft_id UUID,
  p_decision platform.ai_draft_review_decision,
  p_reviewed_text TEXT,
  p_reason TEXT,
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
  draft_row platform.ai_drafts%ROWTYPE;
  target_state platform.ai_draft_state;
  reviewed_hash TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_decision IS NULL
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
    OR (
      p_decision = 'approved'
      AND (
        p_reviewed_text IS NULL
        OR btrim(p_reviewed_text) = ''
      )
    )
    OR (
      p_decision IN ('rework', 'handoff')
      AND p_reviewed_text IS NOT NULL
    )
  THEN
    RAISE EXCEPTION
      'Review decision, matching content shape and reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO draft_row
  FROM platform.ai_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.id = p_ai_draft_id
  FOR UPDATE;

  IF draft_row.id IS NULL THEN
    RAISE EXCEPTION
      'AI draft is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    draft_row.conversation_id,
    'ai.draft.review'
  );

  target_state := CASE p_decision
    WHEN 'approved' THEN 'ready_for_manual_send'
    WHEN 'handoff' THEN 'handed_off'
    ELSE 'rework_requested'
  END;
  reviewed_hash := CASE
    WHEN p_reviewed_text IS NULL THEN NULL
    ELSE encode(
      sha256(convert_to(btrim(p_reviewed_text), 'UTF8')),
      'hex'
    )
  END;

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.draft.review',
    'ai_draft',
    p_ai_draft_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'ai_draft_id', p_ai_draft_id,
      'review_decision', p_decision,
      'reviewed_text_sha256', reviewed_hash,
      'state', target_state,
      'reviewed_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF draft_row.state <> 'review_required' THEN
    RAISE EXCEPTION
      'Only a generated draft awaiting review can be reviewed'
      USING ERRCODE = '55000';
  END IF;

  IF p_decision = 'approved' THEN
    UPDATE platform.ai_drafts
    SET
      state = 'ready_for_manual_send',
      reviewed_text = btrim(p_reviewed_text),
      reviewed_text_sha256 = reviewed_hash,
      reviewed_by_membership_id = actor.actor_membership_id,
      reviewed_at = statement_timestamp(),
      review_reason = btrim(p_reason)
    WHERE organization_id = p_organization_id
      AND id = p_ai_draft_id;
  ELSIF p_decision = 'handoff' THEN
    UPDATE platform.ai_drafts
    SET
      state = 'handed_off',
      reviewed_by_membership_id = actor.actor_membership_id,
      reviewed_at = statement_timestamp(),
      review_reason = btrim(p_reason)
    WHERE organization_id = p_organization_id
      AND id = p_ai_draft_id;
  ELSE
    UPDATE platform.ai_drafts
    SET
      state = 'rework_requested',
      reviewed_by_membership_id = actor.actor_membership_id,
      reviewed_at = statement_timestamp(),
      review_reason = btrim(p_reason)
    WHERE organization_id = p_organization_id
      AND id = p_ai_draft_id;
  END IF;

  INSERT INTO platform.ai_draft_events (
    organization_id,
    conversation_id,
    ai_draft_id,
    event_type,
    previous_state,
    new_state,
    selected_language,
    knowledge_version_id,
    review_decision,
    content_text,
    actor_kind,
    actor_profile_id,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    draft_row.conversation_id,
    p_ai_draft_id,
    CASE
      WHEN p_decision = 'handoff'
        THEN 'handed_off'::platform.ai_draft_event_type
      ELSE 'reviewed'::platform.ai_draft_event_type
    END,
    draft_row.state,
    target_state,
    draft_row.selected_language,
    draft_row.knowledge_version_id,
    p_decision,
    p_reviewed_text,
    'user',
    actor.actor_profile_id,
    actor.actor_membership_id,
    btrim(p_reason),
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'ai_draft_id', p_ai_draft_id,
    'review_decision', p_decision,
    'reviewed_text_sha256', reviewed_hash,
    'state', target_state,
    'reviewed_by_membership_id', actor.actor_membership_id
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
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'ai.draft.review',
    'ai_draft',
    p_ai_draft_id,
    jsonb_build_object('state', draft_row.state),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.authorize_manual_send(
  p_organization_id UUID,
  p_ai_draft_id UUID,
  p_final_text TEXT,
  p_reason TEXT,
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
  draft_row platform.ai_drafts%ROWTYPE;
  created_authorization_id UUID := gen_random_uuid();
  final_hash TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_final_text IS NULL
    OR btrim(p_final_text) = ''
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
  THEN
    RAISE EXCEPTION
      'Exact final text and manual-send reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO draft_row
  FROM platform.ai_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.id = p_ai_draft_id
  FOR UPDATE;

  IF draft_row.id IS NULL THEN
    RAISE EXCEPTION
      'AI draft is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    draft_row.conversation_id,
    'communication.manual.send'
  );

  final_hash :=
    encode(sha256(convert_to(btrim(p_final_text), 'UTF8')), 'hex');

  replayed := platform_private.replay_audit(
    p_request_id,
    'communication.manual.authorize',
    'manual_send_authorization',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'ai_draft_id', p_ai_draft_id,
      'communication_conversation_id', draft_row.conversation_id,
      'final_text_sha256', final_hash,
      'authorized_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF draft_row.state <> 'ready_for_manual_send'
    OR draft_row.selected_language IS NULL
    OR draft_row.reviewed_text IS NULL
  THEN
    RAISE EXCEPTION
      'Only a human-reviewed RU/EN draft can be authorized'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.manual_send_authorizations (
    id,
    organization_id,
    conversation_id,
    ai_draft_id,
    final_text,
    final_text_sha256,
    authorized_by_profile_id,
    authorized_by_membership_id,
    reason,
    request_id
  )
  VALUES (
    created_authorization_id,
    p_organization_id,
    draft_row.conversation_id,
    p_ai_draft_id,
    btrim(p_final_text),
    final_hash,
    actor.actor_profile_id,
    actor.actor_membership_id,
    btrim(p_reason),
    p_request_id
  );

  UPDATE platform.ai_drafts
  SET state = 'manual_send_authorized'
  WHERE organization_id = p_organization_id
    AND id = p_ai_draft_id;

  INSERT INTO platform.ai_draft_events (
    organization_id,
    conversation_id,
    ai_draft_id,
    event_type,
    previous_state,
    new_state,
    selected_language,
    knowledge_version_id,
    review_decision,
    content_text,
    actor_kind,
    actor_profile_id,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    draft_row.conversation_id,
    p_ai_draft_id,
    'manual_send_authorized',
    draft_row.state,
    'manual_send_authorized',
    draft_row.selected_language,
    draft_row.knowledge_version_id,
    'approved',
    p_final_text,
    'user',
    actor.actor_profile_id,
    actor.actor_membership_id,
    btrim(p_reason),
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'manual_send_authorization_id', created_authorization_id,
    'ai_draft_id', p_ai_draft_id,
    'communication_conversation_id', draft_row.conversation_id,
    'final_text_sha256', final_hash,
    'authorized_by_membership_id', actor.actor_membership_id,
    'state', 'manual_send_authorized'
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
  )
  VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'communication.manual.authorize',
    'manual_send_authorization',
    created_authorization_id,
    jsonb_build_object('ai_draft_state', draft_row.state),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_communication_queue(
  p_organization_id UUID
)
RETURNS TABLE (
  conversation_id UUID,
  student_case_id UUID,
  queue platform.communication_queue,
  status platform.communication_status,
  subject TEXT,
  waha_session_name TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'communication.read.full'
  );

  RETURN QUERY
  SELECT
    conversation.id,
    conversation.student_case_id,
    conversation.queue,
    conversation.status,
    conversation.subject,
    conversation.waha_session_name,
    conversation.kommo_account_id,
    conversation.kommo_conversation_id,
    conversation.amocrm_account_id,
    conversation.amocrm_lead_id,
    conversation.amocrm_contact_id,
    conversation.created_at
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND private.platform_can_read_communication_full(
      conversation.organization_id,
      conversation.id
    )
  ORDER BY conversation.updated_at DESC, conversation.id;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_conversation_messages(
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
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'communication.read.full'
  );

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
    message.created_at
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.conversation_id = p_conversation_id
  ORDER BY message.created_at, message.id;
END
$$;

CREATE OR REPLACE FUNCTION platform.former_sales_case_summaries(
  p_organization_id UUID
)
RETURNS TABLE (
  student_case_id UUID,
  student_display_name TEXT,
  case_state platform.student_case_state,
  target_country TEXT,
  target_degree TEXT,
  assigned_curator_display_name TEXT,
  handoff_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'communication.read.summary'
  );

  IF actor.actor_role <> 'sales' THEN
    RAISE EXCEPTION
      'Former-Sales summaries are available only to Sales'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    target_case.id,
    target_case.student_display_name,
    target_case.state,
    target_case.target_country,
    target_case.target_degree,
    curator_profile.display_name,
    target_case.handoff_at
  FROM platform.student_cases AS target_case
  JOIN platform.organization_memberships AS curator_membership
    ON curator_membership.organization_id = target_case.organization_id
   AND curator_membership.id =
     target_case.current_curator_membership_id
  JOIN platform.profiles AS curator_profile
    ON curator_profile.id = curator_membership.profile_id
  WHERE target_case.organization_id = p_organization_id
    AND target_case.responsible_sales_membership_id =
      actor.actor_membership_id
    AND target_case.state IN ('active', 'closed')
    AND target_case.current_curator_membership_id IS NOT NULL
    AND target_case.handoff_at IS NOT NULL
  ORDER BY target_case.handoff_at DESC, target_case.id;
END
$$;

CREATE OR REPLACE FUNCTION platform.student_portal_messages(
  p_organization_id UUID
)
RETURNS TABLE (
  message_id UUID,
  student_case_id UUID,
  direction platform.communication_direction,
  body_text TEXT,
  language platform.communication_message_language,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'communication.read.self'
  );

  IF actor.actor_role <> 'student' THEN
    RAISE EXCEPTION
      'Portal communication projection is student self-only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    message.id,
    target_case.id,
    message.direction,
    message.body_text,
    message.language,
    message.created_at
  FROM platform.student_cases AS target_case
  JOIN platform.communication_messages AS message
    ON message.organization_id = target_case.organization_id
   AND message.student_case_id = target_case.id
  WHERE target_case.organization_id = p_organization_id
    AND target_case.student_membership_id = actor.actor_membership_id
    AND target_case.state IN ('active', 'closed')
    AND target_case.portal_activated_at IS NOT NULL
    AND message.student_visible
  ORDER BY message.created_at, message.id;
END
$$;

CREATE OR REPLACE FUNCTION platform.approved_knowledge_catalog(
  p_organization_id UUID
)
RETURNS TABLE (
  knowledge_version_id UUID,
  knowledge_key TEXT,
  title TEXT,
  version BIGINT,
  content_text TEXT,
  content_sha256 TEXT,
  provenance_ref TEXT,
  approved_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.platform_can_read_approved_knowledge(
    p_organization_id
  ) THEN
    RAISE EXCEPTION
      'Approved knowledge is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    knowledge.id,
    knowledge.knowledge_key,
    knowledge.title,
    knowledge.version,
    knowledge.content_text,
    knowledge.content_sha256,
    knowledge.provenance_ref,
    knowledge.approved_at
  FROM platform.approved_knowledge_versions AS knowledge
  WHERE knowledge.organization_id = p_organization_id
    AND knowledge.status = 'approved'
  ORDER BY knowledge.knowledge_key, knowledge.version DESC;
END
$$;

REVOKE ALL ON TABLE
  platform.communication_conversations,
  platform.conversation_handoff_events,
  platform.conversation_participants,
  platform.communication_messages,
  platform.approved_knowledge_versions,
  platform.ai_draft_requests,
  platform.ai_drafts,
  platform.ai_draft_knowledge_citations,
  platform.ai_draft_events,
  platform.manual_send_authorizations
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON TABLE
  platform.communication_conversations,
  platform.conversation_handoff_events,
  platform.conversation_participants,
  platform.communication_messages,
  platform.approved_knowledge_versions,
  platform.ai_draft_requests,
  platform.ai_drafts,
  platform.ai_draft_knowledge_citations,
  platform.ai_draft_events,
  platform.manual_send_authorizations
TO authenticated;

REVOKE ALL ON TABLE
  platform_private.provider_webhook_events,
  platform_private.provider_reconciliation_events
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform.persist_provider_webhook_event(
    UUID,
    platform.communication_provider,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TIMESTAMPTZ,
    platform.webhook_verification_status,
    JSONB,
    JSONB,
    TEXT,
    TEXT,
    UUID
  ),
  platform.create_communication_conversation(
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    BIGINT,
    TEXT,
    BIGINT,
    BIGINT,
    BIGINT,
    UUID,
    UUID
  ),
  platform.link_communication_conversation_case(
    UUID,
    UUID,
    UUID,
    UUID,
    UUID
  ),
  platform.record_conversation_participant(
    UUID,
    UUID,
    platform.conversation_participant_kind,
    UUID,
    TEXT,
    UUID,
    UUID
  ),
  platform.record_communication_message(
    UUID,
    UUID,
    platform.communication_direction,
    TEXT,
    platform.communication_message_language,
    BOOLEAN,
    TEXT,
    TEXT,
    BIGINT,
    TEXT,
    TEXT,
    BIGINT,
    BIGINT,
    BIGINT,
    UUID,
    UUID,
    UUID
  ),
  platform.append_provider_reconciliation_event(
    UUID,
    UUID,
    UUID,
    UUID,
    UUID,
    platform.provider_observation_kind,
    platform.waha_ack_state,
    TEXT,
    UUID
  ),
  platform.record_ai_draft(
    UUID,
    UUID,
    UUID,
    platform.ai_language_detection_status,
    platform.ai_draft_language,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    JSONB,
    TEXT,
    UUID
  ),
  platform.complete_ai_draft_generation(
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    UUID
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.persist_provider_webhook_event(
    UUID,
    platform.communication_provider,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TIMESTAMPTZ,
    platform.webhook_verification_status,
    JSONB,
    JSONB,
    TEXT,
    TEXT,
    UUID
  ),
  platform.create_communication_conversation(
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    BIGINT,
    TEXT,
    BIGINT,
    BIGINT,
    BIGINT,
    UUID,
    UUID
  ),
  platform.link_communication_conversation_case(
    UUID,
    UUID,
    UUID,
    UUID,
    UUID
  ),
  platform.record_conversation_participant(
    UUID,
    UUID,
    platform.conversation_participant_kind,
    UUID,
    TEXT,
    UUID,
    UUID
  ),
  platform.record_communication_message(
    UUID,
    UUID,
    platform.communication_direction,
    TEXT,
    platform.communication_message_language,
    BOOLEAN,
    TEXT,
    TEXT,
    BIGINT,
    TEXT,
    TEXT,
    BIGINT,
    BIGINT,
    BIGINT,
    UUID,
    UUID,
    UUID
  ),
  platform.append_provider_reconciliation_event(
    UUID,
    UUID,
    UUID,
    UUID,
    UUID,
    platform.provider_observation_kind,
    platform.waha_ack_state,
    TEXT,
    UUID
  ),
  platform.record_ai_draft(
    UUID,
    UUID,
    UUID,
    platform.ai_language_detection_status,
    platform.ai_draft_language,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    JSONB,
    TEXT,
    UUID
  ),
  platform.complete_ai_draft_generation(
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    UUID
  )
TO service_role;

REVOKE ALL ON FUNCTION
  platform.publish_approved_knowledge_version(
    UUID,
    TEXT,
    TEXT,
    BIGINT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.retire_approved_knowledge_version(UUID, UUID, TEXT, UUID),
  platform.request_ai_draft(
    UUID,
    UUID,
    UUID,
    platform.ai_draft_language,
    TEXT,
    UUID
  ),
  platform.resolve_ai_draft_language(
    UUID,
    UUID,
    platform.ai_draft_language,
    BOOLEAN,
    TEXT,
    UUID
  ),
  platform.review_ai_draft(
    UUID,
    UUID,
    platform.ai_draft_review_decision,
    TEXT,
    TEXT,
    UUID
  ),
  platform.authorize_manual_send(UUID, UUID, TEXT, TEXT, UUID),
  platform.staff_communication_queue(UUID),
  platform.staff_conversation_messages(UUID, UUID),
  platform.former_sales_case_summaries(UUID),
  platform.student_portal_messages(UUID),
  platform.approved_knowledge_catalog(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.publish_approved_knowledge_version(
    UUID,
    TEXT,
    TEXT,
    BIGINT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.retire_approved_knowledge_version(UUID, UUID, TEXT, UUID),
  platform.request_ai_draft(
    UUID,
    UUID,
    UUID,
    platform.ai_draft_language,
    TEXT,
    UUID
  ),
  platform.resolve_ai_draft_language(
    UUID,
    UUID,
    platform.ai_draft_language,
    BOOLEAN,
    TEXT,
    UUID
  ),
  platform.review_ai_draft(
    UUID,
    UUID,
    platform.ai_draft_review_decision,
    TEXT,
    TEXT,
    UUID
  ),
  platform.authorize_manual_send(UUID, UUID, TEXT, TEXT, UUID),
  platform.staff_communication_queue(UUID),
  platform.staff_conversation_messages(UUID, UUID),
  platform.former_sales_case_summaries(UUID),
  platform.student_portal_messages(UUID),
  platform.approved_knowledge_catalog(UUID)
TO authenticated;

COMMENT ON TABLE platform_private.provider_webhook_events IS
  'Private append-only raw provider evidence, persisted before processing.';
COMMENT ON TABLE platform_private.provider_reconciliation_events IS
  'Private append-only provider observations; never a delivery proof.';
COMMENT ON TABLE platform.communication_messages IS
  'Unified immutable messages with distinct WAHA, Kommo and amoCRM identity.';
COMMENT ON TABLE platform.ai_drafts IS
  'Draft-only immutable generation evidence; no unattended outbound path.';
COMMENT ON TABLE platform.manual_send_authorizations IS
  'Single-use exact human authorization for a reviewed outbound text.';

COMMIT;
