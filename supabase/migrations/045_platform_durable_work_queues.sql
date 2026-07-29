-- ============================================================
-- 045_platform_durable_work_queues.sql
--
-- P2G: durable, bounded and retryable Platform work over real PGMQ.
-- Queue bodies are pointer-only. Browser/API roles receive no queue or
-- private-ledger access. An unknown send result is terminal and opens an
-- Admin review; it is never retried or copied to the dead-letter queue.
-- This migration performs no provider call, message send or production action.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgmq;

DO $$
DECLARE
  required_signature TEXT;
BEGIN
  FOREACH required_signature IN ARRAY ARRAY[
    'pgmq.create(text)',
    'pgmq.read(text,integer,integer,jsonb)',
    'pgmq.send(text,jsonb,integer)',
    'pgmq.set_vt(text,bigint,integer)',
    'pgmq.archive(text,bigint)'
  ]
  LOOP
    IF to_regprocedure(required_signature) IS NULL THEN
      RAISE EXCEPTION
        'Required PGMQ signature % is unavailable',
        required_signature
        USING ERRCODE = '0A000';
    END IF;
  END LOOP;
END
$$;

SELECT pgmq.create('platform_work_v1');
SELECT pgmq.create('platform_dead_letter_v1');

REVOKE ALL ON SCHEMA pgmq
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON ALL TABLES IN SCHEMA pgmq
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgmq
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA pgmq
  REVOKE ALL PRIVILEGES ON TABLES
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA pgmq
  REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA pgmq
  REVOKE ALL PRIVILEGES ON FUNCTIONS
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- P2B preserved pre-existing pgmq_public compatibility grants. P2G now owns
-- the fixed service wrappers, so contain that optional legacy schema without
-- creating it on installations where it is absent.
DO $$
BEGIN
  IF to_regnamespace('pgmq_public') IS NOT NULL THEN
    EXECUTE
      'REVOKE ALL ON SCHEMA pgmq_public '
      || 'FROM PUBLIC, anon, authenticated, service_role, '
      || 'supabase_auth_admin';
    EXECUTE
      'REVOKE ALL ON ALL TABLES IN SCHEMA pgmq_public '
      || 'FROM PUBLIC, anon, authenticated, service_role, '
      || 'supabase_auth_admin';
    EXECUTE
      'REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq_public '
      || 'FROM PUBLIC, anon, authenticated, service_role, '
      || 'supabase_auth_admin';
    EXECUTE
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgmq_public '
      || 'FROM PUBLIC, anon, authenticated, service_role, '
      || 'supabase_auth_admin';
    EXECUTE
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres '
      || 'IN SCHEMA pgmq_public REVOKE ALL PRIVILEGES ON TABLES '
      || 'FROM PUBLIC, anon, authenticated, service_role, '
      || 'supabase_auth_admin';
    EXECUTE
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres '
      || 'IN SCHEMA pgmq_public REVOKE ALL PRIVILEGES ON SEQUENCES '
      || 'FROM PUBLIC, anon, authenticated, service_role, '
      || 'supabase_auth_admin';
    EXECUTE
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres '
      || 'IN SCHEMA pgmq_public REVOKE ALL PRIVILEGES ON FUNCTIONS '
      || 'FROM PUBLIC, anon, authenticated, service_role, '
      || 'supabase_auth_admin';
  END IF;
END
$$;

CREATE TYPE platform.durable_work_kind AS ENUM (
  'provider_webhook_process',
  'ai_draft_generate',
  'manual_whatsapp_send'
);

CREATE TYPE platform.durable_work_state AS ENUM (
  'queued',
  'leased',
  'retry_wait',
  'succeeded',
  'dead_lettered',
  'unknown_manual_review',
  'conflict_manual_review'
);

CREATE TYPE platform.durable_work_finish_outcome AS ENUM (
  'succeeded',
  'retryable_error',
  'terminal_error',
  'unknown_result',
  'conflict'
);

CREATE TYPE platform.durable_work_attempt_outcome AS ENUM (
  'succeeded',
  'retryable_error',
  'terminal_error',
  'unknown_result',
  'conflict',
  'lease_expired'
);

CREATE TYPE platform.durable_work_event_type AS ENUM (
  'enqueued',
  'deduplicated',
  'claimed',
  'lease_expired',
  'lease_extended',
  'retry_scheduled',
  'succeeded',
  'dead_lettered',
  'unknown_manual_review',
  'conflict_manual_review',
  'review_resolved'
);

CREATE TYPE platform.durable_work_operation AS ENUM (
  'enqueue_verified_webhook',
  'enqueue_ai_draft',
  'enqueue_manual_whatsapp_send',
  'claim',
  'extend_lease',
  'finish'
);

CREATE TYPE platform.work_review_kind AS ENUM (
  'unknown_delivery',
  'provider_conflict'
);

CREATE TYPE platform.work_review_status AS ENUM (
  'open',
  'resolved'
);

CREATE TYPE platform.work_review_resolution AS ENUM (
  'confirmed_no_send',
  'new_manual_authorization_required',
  'duplicate_suppressed',
  'conflict_acknowledged'
);

CREATE TYPE platform.work_review_event_type AS ENUM (
  'opened',
  'resolved'
);

CREATE TABLE platform_private.durable_work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  kind platform.durable_work_kind NOT NULL,
  state platform.durable_work_state NOT NULL DEFAULT 'queued',
  source_webhook_event_id UUID,
  ai_draft_request_id UUID,
  manual_send_authorization_id UUID,
  business_key_sha256 TEXT NOT NULL CHECK (
    lower(btrim(business_key_sha256)) ~ '^[0-9a-f]{64}$'
  ),
  queue_message_id BIGINT NOT NULL UNIQUE CHECK (queue_message_id > 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  available_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  leased_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT durable_work_items_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT durable_work_items_business_key
    UNIQUE (organization_id, business_key_sha256),
  CONSTRAINT durable_work_items_webhook_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT durable_work_items_ai_request_fkey
    FOREIGN KEY (organization_id, ai_draft_request_id)
    REFERENCES platform.ai_draft_requests(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT durable_work_items_manual_authorization_fkey
    FOREIGN KEY (organization_id, manual_send_authorization_id)
    REFERENCES platform.manual_send_authorizations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT durable_work_items_source_shape_check CHECK (
    (
      kind = 'provider_webhook_process'
      AND source_webhook_event_id IS NOT NULL
      AND ai_draft_request_id IS NULL
      AND manual_send_authorization_id IS NULL
    )
    OR (
      kind = 'ai_draft_generate'
      AND source_webhook_event_id IS NULL
      AND ai_draft_request_id IS NOT NULL
      AND manual_send_authorization_id IS NULL
    )
    OR (
      kind = 'manual_whatsapp_send'
      AND source_webhook_event_id IS NULL
      AND ai_draft_request_id IS NULL
      AND manual_send_authorization_id IS NOT NULL
    )
  ),
  CONSTRAINT durable_work_items_state_shape_check CHECK (
    (
      state IN ('queued', 'retry_wait')
      AND leased_until IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'leased'
      AND leased_until IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      state IN (
        'succeeded',
        'dead_lettered',
        'unknown_manual_review',
        'conflict_manual_review'
      )
      AND leased_until IS NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX durable_work_items_webhook_source_key
  ON platform_private.durable_work_items (
    organization_id,
    source_webhook_event_id
  )
  WHERE source_webhook_event_id IS NOT NULL;

CREATE UNIQUE INDEX durable_work_items_ai_request_source_key
  ON platform_private.durable_work_items (
    organization_id,
    ai_draft_request_id
  )
  WHERE ai_draft_request_id IS NOT NULL;

CREATE UNIQUE INDEX durable_work_items_manual_authorization_key
  ON platform_private.durable_work_items (
    organization_id,
    manual_send_authorization_id
  )
  WHERE manual_send_authorization_id IS NOT NULL;

CREATE INDEX durable_work_items_state_available_idx
  ON platform_private.durable_work_items (
    state,
    available_at,
    created_at
  )
  WHERE state IN ('queued', 'retry_wait');

CREATE TABLE platform_private.durable_work_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  queue_message_id BIGINT NOT NULL CHECK (queue_message_id > 0),
  queue_read_count INTEGER NOT NULL CHECK (queue_read_count > 0),
  worker_ref TEXT NOT NULL CHECK (
    btrim(worker_ref) <> '' AND char_length(worker_ref) <= 200
  ),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  outcome platform.durable_work_attempt_outcome,
  error_code TEXT CHECK (
    error_code IS NULL
    OR error_code ~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
  ),
  evidence_ref TEXT CHECK (
    evidence_ref IS NULL OR btrim(evidence_ref) <> ''
  ),
  finish_request_id UUID UNIQUE,
  CONSTRAINT durable_work_attempts_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT durable_work_attempts_item_attempt_key
    UNIQUE (organization_id, work_item_id, attempt_number),
  CONSTRAINT durable_work_attempts_item_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT durable_work_attempts_finish_shape_check CHECK (
    (
      finished_at IS NULL
      AND outcome IS NULL
      AND error_code IS NULL
      AND evidence_ref IS NULL
      AND finish_request_id IS NULL
    )
    OR (
      finished_at IS NOT NULL
      AND outcome IS NOT NULL
      AND evidence_ref IS NOT NULL
      AND finish_request_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX durable_work_attempts_one_open_key
  ON platform_private.durable_work_attempts (
    organization_id,
    work_item_id
  )
  WHERE finished_at IS NULL;

CREATE INDEX durable_work_attempts_lease_idx
  ON platform_private.durable_work_attempts (
    lease_expires_at,
    organization_id,
    work_item_id
  )
  WHERE finished_at IS NULL;

CREATE TABLE platform_private.durable_work_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  attempt_id UUID,
  event_type platform.durable_work_event_type NOT NULL,
  previous_state platform.durable_work_state,
  new_state platform.durable_work_state NOT NULL,
  queue_message_id BIGINT NOT NULL CHECK (queue_message_id > 0),
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT durable_work_events_item_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT durable_work_events_attempt_fkey
    FOREIGN KEY (organization_id, attempt_id)
    REFERENCES platform_private.durable_work_attempts(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX durable_work_events_item_created_idx
  ON platform_private.durable_work_events (
    organization_id,
    work_item_id,
    created_at
  );

CREATE TABLE platform_private.durable_work_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  attempt_id UUID,
  active_queue_message_id BIGINT NOT NULL
    CHECK (active_queue_message_id > 0),
  dead_letter_queue_message_id BIGINT NOT NULL UNIQUE
    CHECK (dead_letter_queue_message_id > 0),
  reason_code TEXT NOT NULL CHECK (
    reason_code ~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
  ),
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT durable_work_dead_letters_item_key
    UNIQUE (organization_id, work_item_id),
  CONSTRAINT durable_work_dead_letters_item_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT durable_work_dead_letters_attempt_fkey
    FOREIGN KEY (organization_id, attempt_id)
    REFERENCES platform_private.durable_work_attempts(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.durable_work_idempotency (
  request_id UUID PRIMARY KEY,
  operation platform.durable_work_operation NOT NULL,
  input_sha256 TEXT NOT NULL CHECK (
    input_sha256 ~ '^[0-9a-f]{64}$'
  ),
  business_key_sha256 TEXT CHECK (
    business_key_sha256 IS NULL
    OR business_key_sha256 ~ '^[0-9a-f]{64}$'
  ),
  organization_id UUID
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  work_item_id UUID,
  attempt_id UUID,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT durable_work_idempotency_item_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT durable_work_idempotency_attempt_fkey
    FOREIGN KEY (organization_id, attempt_id)
    REFERENCES platform_private.durable_work_attempts(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT durable_work_idempotency_reference_shape_check CHECK (
    (organization_id IS NULL AND work_item_id IS NULL AND attempt_id IS NULL)
    OR (organization_id IS NOT NULL AND work_item_id IS NOT NULL)
  )
);

CREATE TABLE platform.work_review_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  work_item_id UUID NOT NULL,
  review_kind platform.work_review_kind NOT NULL,
  status platform.work_review_status NOT NULL DEFAULT 'open',
  provider_reconciliation_event_id UUID NOT NULL,
  conversation_id UUID,
  manual_send_authorization_id UUID,
  resolution platform.work_review_resolution,
  resolution_reason TEXT,
  resolved_by_profile_id UUID,
  resolved_by_membership_id UUID,
  opened_request_id UUID NOT NULL UNIQUE,
  resolved_request_id UUID UNIQUE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT work_review_cases_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT work_review_cases_work_item_key
    UNIQUE (organization_id, work_item_id),
  CONSTRAINT work_review_cases_work_item_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_review_cases_reconciliation_fkey
    FOREIGN KEY (organization_id, provider_reconciliation_event_id)
    REFERENCES platform_private.provider_reconciliation_events(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT work_review_cases_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_review_cases_manual_authorization_fkey
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
  CONSTRAINT work_review_cases_resolver_profile_fkey
    FOREIGN KEY (resolved_by_profile_id)
    REFERENCES platform.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT work_review_cases_resolver_membership_fkey
    FOREIGN KEY (organization_id, resolved_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_review_cases_kind_shape_check CHECK (
    (
      review_kind = 'unknown_delivery'
      AND conversation_id IS NOT NULL
      AND manual_send_authorization_id IS NOT NULL
    )
    OR (
      review_kind = 'provider_conflict'
      AND manual_send_authorization_id IS NULL
    )
  ),
  CONSTRAINT work_review_cases_resolution_shape_check CHECK (
    (
      status = 'open'
      AND resolution IS NULL
      AND resolution_reason IS NULL
      AND resolved_by_profile_id IS NULL
      AND resolved_by_membership_id IS NULL
      AND resolved_request_id IS NULL
      AND resolved_at IS NULL
    )
    OR (
      status = 'resolved'
      AND resolution IS NOT NULL
      AND resolution_reason IS NOT NULL
      AND btrim(resolution_reason) <> ''
      AND resolved_by_profile_id IS NOT NULL
      AND resolved_by_membership_id IS NOT NULL
      AND resolved_request_id IS NOT NULL
      AND resolved_at IS NOT NULL
    )
  )
);

CREATE INDEX work_review_cases_open_idx
  ON platform.work_review_cases (
    organization_id,
    review_kind,
    opened_at
  )
  WHERE status = 'open';

CREATE TABLE platform.work_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  work_review_case_id UUID NOT NULL,
  event_type platform.work_review_event_type NOT NULL,
  actor_kind platform.audit_actor_kind NOT NULL,
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_principal TEXT NOT NULL CHECK (btrim(actor_principal) <> ''),
  before_state JSONB,
  after_state JSONB NOT NULL,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT work_review_events_case_fkey
    FOREIGN KEY (organization_id, work_review_case_id)
    REFERENCES platform.work_review_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_review_events_actor_profile_fkey
    FOREIGN KEY (actor_profile_id)
    REFERENCES platform.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT work_review_events_actor_membership_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT work_review_events_actor_shape_check CHECK (
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
  )
);

CREATE INDEX work_review_events_case_created_idx
  ON platform.work_review_events (
    organization_id,
    work_review_case_id,
    created_at
  );

ALTER TABLE platform_private.durable_work_items
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.durable_work_items
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.durable_work_attempts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.durable_work_attempts
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.durable_work_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.durable_work_events
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.durable_work_dead_letters
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.durable_work_dead_letters
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.durable_work_idempotency
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.durable_work_idempotency
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.work_review_cases
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.work_review_cases
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.work_review_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.work_review_events
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER durable_work_items_set_updated_at
  BEFORE UPDATE ON platform_private.durable_work_items
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

CREATE TRIGGER work_review_cases_set_updated_at
  BEFORE UPDATE ON platform.work_review_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

CREATE TRIGGER durable_work_events_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.durable_work_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER durable_work_events_no_truncate
  BEFORE TRUNCATE ON platform_private.durable_work_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER durable_work_dead_letters_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.durable_work_dead_letters
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER durable_work_dead_letters_no_truncate
  BEFORE TRUNCATE ON platform_private.durable_work_dead_letters
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER durable_work_idempotency_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.durable_work_idempotency
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER durable_work_idempotency_no_truncate
  BEFORE TRUNCATE ON platform_private.durable_work_idempotency
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER work_review_events_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.work_review_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER work_review_events_no_truncate
  BEFORE TRUNCATE ON platform.work_review_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Immutable v5 bundles clone all published v4 permissions and add only the
-- Admin review projection/action permissions. Exactly five roles remain.
INSERT INTO platform.permission_definitions (
  permission_key,
  description
)
VALUES
  (
    'workreview.read',
    'Read safe durable-work reconciliation and manual-review projections'
  ),
  (
    'workreview.resolve',
    'Resolve durable-work reconciliation and manual-review cases'
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
    '00000000-0000-4000-8000-000000000401',
    'admin',
    5,
    'draft',
    'Admin v5 durable work review'
  ),
  (
    '00000000-0000-4000-8000-000000000402',
    'sales',
    5,
    'draft',
    'Sales v5 durable work review'
  ),
  (
    '00000000-0000-4000-8000-000000000403',
    'curator',
    5,
    'draft',
    'Curator v5 durable work review'
  ),
  (
    '00000000-0000-4000-8000-000000000404',
    'finance',
    5,
    'draft',
    'Finance v5 durable work review'
  ),
  (
    '00000000-0000-4000-8000-000000000405',
    'student',
    5,
    'draft',
    'Student v5 durable work review'
  );

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT
  v5.id,
  v5.role,
  v4_permission.permission_key
FROM platform.role_bundle_versions AS v5
JOIN platform.role_bundle_versions AS v4
  ON v4.role = v5.role
  AND v4.version = 4
  AND v4.status = 'published'
JOIN platform.role_bundle_permissions AS v4_permission
  ON v4_permission.bundle_id = v4.id
  AND v4_permission.bundle_role = v4.role
WHERE v5.version = 5;

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
WHERE bundle.version = 5
  AND bundle.role = 'admin'
  AND permission.permission_key IN (
    'workreview.read',
    'workreview.resolve'
  );

UPDATE platform.role_bundle_versions
SET
  status = 'published',
  published_at = statement_timestamp()
WHERE version = 5;

CREATE TEMPORARY TABLE p2g_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v5.id AS new_bundle_id,
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
JOIN platform.role_bundle_versions AS v4
  ON v4.id = membership.current_bundle_id
  AND v4.role = membership."current_role"
  AND v4.version = 4
  AND v4.status = 'published'
JOIN platform.role_bundle_versions AS v5
  ON v5.role = membership."current_role"
  AND v5.version = 5
  AND v5.status = 'published'
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
  'P2G immutable RBAC bundle upgrade',
  upgrade.request_id
FROM p2g_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM p2g_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM p2g_membership_bundle_upgrades AS upgrade
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
  'migration:045_platform_durable_work_queues',
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
  'P2G immutable RBAC bundle upgrade',
  upgrade.request_id
FROM p2g_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile
  ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION platform_private.lock_p2g_request(
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
      'evo:p2g:request:' || p_request_id::TEXT,
      0
    )
  );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_p2g_service()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'Service role is required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.p2g_replay_request(
  p_request_id UUID,
  p_operation platform.durable_work_operation,
  p_input_sha256 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prior platform_private.durable_work_idempotency%ROWTYPE;
BEGIN
  SELECT *
  INTO prior
  FROM platform_private.durable_work_idempotency AS idempotency
  WHERE idempotency.request_id = p_request_id;

  IF FOUND THEN
    IF prior.operation <> p_operation
      OR prior.input_sha256 <> p_input_sha256
    THEN
      RAISE EXCEPTION
        'request_id % was already used for another durable-work operation',
        p_request_id
        USING ERRCODE = '22023';
    END IF;

    RETURN prior.response;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit_event
    WHERE audit_event.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION
      'request_id % was already used for another audited mutation',
      p_request_id
      USING ERRCODE = '22023';
  END IF;

  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.p2g_store_result(
  p_request_id UUID,
  p_operation platform.durable_work_operation,
  p_input_sha256 TEXT,
  p_organization_id UUID,
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_response JSONB
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO platform_private.durable_work_idempotency (
    request_id,
    operation,
    input_sha256,
    business_key_sha256,
    organization_id,
    work_item_id,
    attempt_id,
    response
  )
  VALUES (
    p_request_id,
    p_operation,
    p_input_sha256,
    CASE
      WHEN p_work_item_id IS NULL THEN NULL
      ELSE (
        SELECT item.business_key_sha256
        FROM platform_private.durable_work_items AS item
        WHERE item.id = p_work_item_id
      )
    END,
    p_organization_id,
    p_work_item_id,
    p_attempt_id,
    p_response
  );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.p2g_dead_letter_work(
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_reason_code TEXT,
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
  work_item platform_private.durable_work_items%ROWTYPE;
  archived BOOLEAN;
  dead_letter_message_id BIGINT;
  dead_letter_id UUID := gen_random_uuid();
  result JSONB;
BEGIN
  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.id = p_work_item_id
  FOR UPDATE;

  IF NOT FOUND
    OR p_reason_code IS NULL
    OR p_reason_code !~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
    OR p_evidence_ref IS NULL
    OR btrim(p_evidence_ref) = ''
  THEN
    RAISE EXCEPTION
      'Valid work item, reason code and evidence reference are required'
      USING ERRCODE = '22023';
  END IF;

  IF work_item.state NOT IN ('leased', 'queued', 'retry_wait') THEN
    RAISE EXCEPTION
      'Only active work can enter the dead-letter ledger'
      USING ERRCODE = '55000';
  END IF;

  SELECT pgmq.archive(
    'platform_work_v1',
    work_item.queue_message_id
  )
  INTO archived;

  IF archived IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'Active PGMQ row % could not be archived',
      work_item.queue_message_id
      USING ERRCODE = '55000';
  END IF;

  SELECT pgmq.send(
    'platform_dead_letter_v1',
    jsonb_build_object(
      'v', 1,
      'work_item_id', work_item.id,
      'kind', work_item.kind
    ),
    0
  )
  INTO dead_letter_message_id;

  UPDATE platform_private.durable_work_items
  SET
    state = 'dead_lettered',
    leased_until = NULL,
    completed_at = statement_timestamp()
  WHERE id = work_item.id;

  INSERT INTO platform_private.durable_work_dead_letters (
    id,
    organization_id,
    work_item_id,
    attempt_id,
    active_queue_message_id,
    dead_letter_queue_message_id,
    reason_code,
    evidence_ref,
    request_id
  )
  VALUES (
    dead_letter_id,
    work_item.organization_id,
    work_item.id,
    p_attempt_id,
    work_item.queue_message_id,
    dead_letter_message_id,
    p_reason_code,
    btrim(p_evidence_ref),
    p_request_id
  );

  INSERT INTO platform_private.durable_work_events (
    organization_id,
    work_item_id,
    attempt_id,
    event_type,
    previous_state,
    new_state,
    queue_message_id,
    evidence_ref,
    request_id
  )
  VALUES (
    work_item.organization_id,
    work_item.id,
    p_attempt_id,
    'dead_lettered',
    work_item.state,
    'dead_lettered',
    work_item.queue_message_id,
    btrim(p_evidence_ref),
    p_request_id
  );

  result := jsonb_build_object(
    'work_item_id', work_item.id,
    'kind', work_item.kind,
    'state', 'dead_lettered',
    'active_queue_message_id', work_item.queue_message_id,
    'active_message_archived', TRUE,
    'dead_letter_id', dead_letter_id,
    'dead_letter_queue_message_id', dead_letter_message_id,
    'reason_code', p_reason_code
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.p2g_open_unknown_review(
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_error_code TEXT,
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
  work_item platform_private.durable_work_items%ROWTYPE;
  attempt platform_private.durable_work_attempts%ROWTYPE;
  authorization_row platform.manual_send_authorizations%ROWTYPE;
  archived BOOLEAN;
  reconciliation_event_id UUID := gen_random_uuid();
  review_case_id UUID := gen_random_uuid();
  result JSONB;
BEGIN
  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.id = p_work_item_id
  FOR UPDATE;

  SELECT *
  INTO attempt
  FROM platform_private.durable_work_attempts AS candidate
  WHERE candidate.id = p_attempt_id
    AND candidate.work_item_id = p_work_item_id
  FOR UPDATE;

  IF work_item.id IS NULL
    OR attempt.id IS NULL
    OR work_item.organization_id <> attempt.organization_id
    OR work_item.kind <> 'manual_whatsapp_send'
    OR work_item.state <> 'leased'
    OR attempt.finished_at IS NOT NULL
    OR p_error_code IS NULL
    OR p_error_code !~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
    OR p_evidence_ref IS NULL
    OR btrim(p_evidence_ref) = ''
  THEN
    RAISE EXCEPTION
      'Unknown review requires one active manually authorized send attempt'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO authorization_row
  FROM platform.manual_send_authorizations AS manual_authorization
  WHERE manual_authorization.organization_id = work_item.organization_id
    AND manual_authorization.id = work_item.manual_send_authorization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Manual authorization disappeared before unknown-result recording'
      USING ERRCODE = '55000';
  END IF;

  SELECT pgmq.archive(
    'platform_work_v1',
    work_item.queue_message_id
  )
  INTO archived;

  IF archived IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'Active PGMQ row % could not be archived',
      work_item.queue_message_id
      USING ERRCODE = '55000';
  END IF;

  UPDATE platform_private.durable_work_attempts
  SET
    finished_at = statement_timestamp(),
    outcome = 'unknown_result',
    error_code = p_error_code,
    evidence_ref = btrim(p_evidence_ref),
    finish_request_id = p_request_id
  WHERE id = attempt.id;

  UPDATE platform_private.durable_work_items
  SET
    state = 'unknown_manual_review',
    leased_until = NULL,
    completed_at = statement_timestamp()
  WHERE id = work_item.id;

  INSERT INTO platform_private.provider_reconciliation_events (
    id,
    organization_id,
    conversation_id,
    manual_send_authorization_id,
    observation_kind,
    ack_state,
    evidence_ref,
    requires_manual_review,
    request_id
  )
  VALUES (
    reconciliation_event_id,
    work_item.organization_id,
    authorization_row.conversation_id,
    authorization_row.id,
    'unknown_result',
    'unknown',
    btrim(p_evidence_ref),
    TRUE,
    p_request_id
  );

  INSERT INTO platform.work_review_cases (
    id,
    organization_id,
    work_item_id,
    review_kind,
    provider_reconciliation_event_id,
    conversation_id,
    manual_send_authorization_id,
    opened_request_id
  )
  VALUES (
    review_case_id,
    work_item.organization_id,
    work_item.id,
    'unknown_delivery',
    reconciliation_event_id,
    authorization_row.conversation_id,
    authorization_row.id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', work_item.organization_id,
    'work_item_id', work_item.id,
    'attempt_id', attempt.id,
    'kind', work_item.kind,
    'state', 'unknown_manual_review',
    'outcome', 'unknown_result',
    'error_code', p_error_code,
    'queue_message_id', work_item.queue_message_id,
    'active_message_archived', TRUE,
    'dead_lettered', FALSE,
    'automatic_retry_allowed', FALSE,
    'manual_send_authorization_id', authorization_row.id,
    'manual_authorization_consumed', TRUE,
    'fresh_authorization_required_for_later_send', TRUE,
    'provider_reconciliation_event_id', reconciliation_event_id,
    'work_review_case_id', review_case_id
  );

  INSERT INTO platform.work_review_events (
    organization_id,
    work_review_case_id,
    event_type,
    actor_kind,
    actor_principal,
    after_state,
    reason,
    request_id
  )
  VALUES (
    work_item.organization_id,
    review_case_id,
    'opened',
    'service',
    'service:platform-durable-work',
    result,
    'Unknown delivery outcome requires Admin review',
    p_request_id
  );

  INSERT INTO platform_private.durable_work_events (
    organization_id,
    work_item_id,
    attempt_id,
    event_type,
    previous_state,
    new_state,
    queue_message_id,
    evidence_ref,
    request_id
  )
  VALUES (
    work_item.organization_id,
    work_item.id,
    attempt.id,
    'unknown_manual_review',
    work_item.state,
    'unknown_manual_review',
    work_item.queue_message_id,
    btrim(p_evidence_ref),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_work_review(
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
      AND membership."current_role" = 'admin'
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND private.platform_has_permission(
        p_organization_id,
        'workreview.read'
      )
      AND platform_private.membership_has_active_scope(
        p_organization_id,
        membership.id,
        'organization',
        p_organization_id
      )
  )
$$;

CREATE POLICY work_review_cases_admin_read
  ON platform.work_review_cases
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_work_review(organization_id))
  );

CREATE POLICY work_review_events_admin_read
  ON platform.work_review_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_work_review(organization_id))
  );

CREATE OR REPLACE FUNCTION platform_private.p2g_enqueue_work(
  p_organization_id UUID,
  p_kind platform.durable_work_kind,
  p_source_webhook_event_id UUID,
  p_ai_draft_request_id UUID,
  p_manual_send_authorization_id UUID,
  p_business_key_sha256 TEXT,
  p_max_attempts INTEGER,
  p_request_id UUID,
  p_operation platform.durable_work_operation
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_match platform_private.durable_work_items%ROWTYPE;
  business_match platform_private.durable_work_items%ROWTYPE;
  existing_item platform_private.durable_work_items%ROWTYPE;
  verification_status platform.webhook_verification_status;
  draft_request_exists BOOLEAN;
  manual_authorization_exists BOOLEAN;
  normalized_business_key TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  created_work_item_id UUID := gen_random_uuid();
  queue_message_id BIGINT;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Enqueue one validated pointer-only durable work item';
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  normalized_business_key := lower(btrim(p_business_key_sha256));

  IF p_organization_id IS NULL
    OR p_kind IS NULL
    OR normalized_business_key !~ '^[0-9a-f]{64}$'
    OR p_max_attempts NOT BETWEEN 1 AND 20
    OR (
      p_kind = 'provider_webhook_process'
      AND (
        p_source_webhook_event_id IS NULL
        OR p_ai_draft_request_id IS NOT NULL
        OR p_manual_send_authorization_id IS NOT NULL
        OR p_operation <> 'enqueue_verified_webhook'
      )
    )
    OR (
      p_kind = 'ai_draft_generate'
      AND (
        p_source_webhook_event_id IS NOT NULL
        OR p_ai_draft_request_id IS NULL
        OR p_manual_send_authorization_id IS NOT NULL
        OR p_operation <> 'enqueue_ai_draft'
      )
    )
    OR (
      p_kind = 'manual_whatsapp_send'
      AND (
        p_source_webhook_event_id IS NOT NULL
        OR p_ai_draft_request_id IS NOT NULL
        OR p_manual_send_authorization_id IS NULL
        OR p_max_attempts <> 1
        OR p_operation <> 'enqueue_manual_whatsapp_send'
      )
    )
  THEN
    RAISE EXCEPTION
      'Valid organization, source, business-key hash and retry budget are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'kind', p_kind,
          'source_webhook_event_id', p_source_webhook_event_id,
          'ai_draft_request_id', p_ai_draft_request_id,
          'manual_send_authorization_id', p_manual_send_authorization_id,
          'business_key_sha256', normalized_business_key,
          'max_attempts', p_max_attempts
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.p2g_replay_request(
    p_request_id,
    p_operation,
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  -- Serialize the semantic key, not only the request id. The database unique
  -- constraints remain the final protection against concurrent duplicates.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2g:business:'
        || p_organization_id::TEXT
        || ':'
        || normalized_business_key,
      0
    )
  );

  IF p_kind = 'provider_webhook_process' THEN
    SELECT event.verification_status
    INTO verification_status
    FROM platform_private.provider_webhook_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.id = p_source_webhook_event_id;

    IF verification_status IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION
        'Only a verified persisted webhook event can be enqueued'
        USING ERRCODE = '55000';
    END IF;
  ELSIF p_kind = 'ai_draft_generate' THEN
    SELECT EXISTS (
      SELECT 1
      FROM platform.ai_draft_requests AS request
      WHERE request.organization_id = p_organization_id
        AND request.id = p_ai_draft_request_id
        AND NOT EXISTS (
          SELECT 1
          FROM platform.ai_drafts AS draft
          WHERE draft.organization_id = request.organization_id
            AND draft.ai_draft_request_id = request.id
        )
    )
    INTO draft_request_exists;

    IF NOT draft_request_exists THEN
      RAISE EXCEPTION
        'AI work requires an existing request with no recorded draft'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM platform.manual_send_authorizations AS manual_auth
      JOIN platform.ai_drafts AS draft
        ON draft.organization_id = manual_auth.organization_id
        AND draft.id = manual_auth.ai_draft_id
        AND draft.conversation_id = manual_auth.conversation_id
      JOIN platform.communication_conversations AS conversation
        ON conversation.organization_id = manual_auth.organization_id
        AND conversation.id = manual_auth.conversation_id
      WHERE manual_auth.organization_id = p_organization_id
        AND manual_auth.id = p_manual_send_authorization_id
        AND draft.state = 'manual_send_authorized'
        AND conversation.status = 'open'
    )
    INTO manual_authorization_exists;

    IF NOT manual_authorization_exists THEN
      RAISE EXCEPTION
        'Manual WhatsApp work requires one live reviewed authorization'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT *
  INTO source_match
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND (
      (
        p_kind = 'provider_webhook_process'
        AND item.source_webhook_event_id = p_source_webhook_event_id
      )
      OR (
        p_kind = 'ai_draft_generate'
        AND item.ai_draft_request_id = p_ai_draft_request_id
      )
      OR (
        p_kind = 'manual_whatsapp_send'
        AND item.manual_send_authorization_id =
          p_manual_send_authorization_id
      )
    )
  FOR UPDATE;

  SELECT *
  INTO business_match
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.business_key_sha256 = normalized_business_key
  FOR UPDATE;

  IF source_match.id IS NOT NULL
    AND business_match.id IS NOT NULL
    AND source_match.id <> business_match.id
  THEN
    RAISE EXCEPTION
      'Source and business key already identify different work items'
      USING ERRCODE = '22023';
  END IF;

  IF source_match.id IS NOT NULL THEN
    existing_item := source_match;
  ELSE
    existing_item := business_match;
  END IF;

  IF existing_item.id IS NOT NULL THEN
    IF existing_item.kind <> p_kind
      OR existing_item.source_webhook_event_id IS DISTINCT FROM
        p_source_webhook_event_id
      OR existing_item.ai_draft_request_id IS DISTINCT FROM
        p_ai_draft_request_id
      OR existing_item.manual_send_authorization_id IS DISTINCT FROM
        p_manual_send_authorization_id
      OR existing_item.business_key_sha256 <> normalized_business_key
      OR existing_item.max_attempts <> p_max_attempts
    THEN
      RAISE EXCEPTION
        'Source or business key cannot be rebound to different work'
        USING ERRCODE = '22023';
    END IF;

    result := jsonb_build_object(
      'organization_id', existing_item.organization_id,
      'work_item_id', existing_item.id,
      'kind', existing_item.kind,
      'state', existing_item.state,
      'queue_message_id', existing_item.queue_message_id,
      'source_webhook_event_id', existing_item.source_webhook_event_id,
      'ai_draft_request_id', existing_item.ai_draft_request_id,
      'manual_send_authorization_id',
        existing_item.manual_send_authorization_id,
      'business_key_sha256', existing_item.business_key_sha256,
      'max_attempts', existing_item.max_attempts,
      'deduplicated', TRUE,
      'queue_payload_is_pointer_only', TRUE
    );

    INSERT INTO platform_private.durable_work_events (
      organization_id,
      work_item_id,
      event_type,
      previous_state,
      new_state,
      queue_message_id,
      evidence_ref,
      request_id
    )
    VALUES (
      existing_item.organization_id,
      existing_item.id,
      'deduplicated',
      existing_item.state,
      existing_item.state,
      existing_item.queue_message_id,
      'business-key:' || normalized_business_key,
      p_request_id
    );

    PERFORM platform_private.p2g_store_result(
      p_request_id,
      p_operation,
      input_sha256,
      existing_item.organization_id,
      existing_item.id,
      NULL,
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
    )
    VALUES (
      existing_item.organization_id,
      'service',
      NULL,
      'service:platform-durable-work',
      'work.enqueue.deduplicate',
      'durable_work_item',
      existing_item.id,
      jsonb_build_object('state', existing_item.state),
      result,
      fixed_reason,
      p_request_id
    );

    RETURN result;
  END IF;

  SELECT pgmq.send(
    'platform_work_v1',
    jsonb_build_object(
      'v', 1,
      'work_item_id', created_work_item_id,
      'kind', p_kind
    ),
    0
  )
  INTO queue_message_id;

  INSERT INTO platform_private.durable_work_items (
    id,
    organization_id,
    kind,
    source_webhook_event_id,
    ai_draft_request_id,
    manual_send_authorization_id,
    business_key_sha256,
    queue_message_id,
    max_attempts,
    request_id
  )
  VALUES (
    created_work_item_id,
    p_organization_id,
    p_kind,
    p_source_webhook_event_id,
    p_ai_draft_request_id,
    p_manual_send_authorization_id,
    normalized_business_key,
    queue_message_id,
    p_max_attempts,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'work_item_id', created_work_item_id,
    'kind', p_kind,
    'state', 'queued',
    'queue_message_id', queue_message_id,
    'source_webhook_event_id', p_source_webhook_event_id,
    'ai_draft_request_id', p_ai_draft_request_id,
    'manual_send_authorization_id', p_manual_send_authorization_id,
    'business_key_sha256', normalized_business_key,
    'max_attempts', p_max_attempts,
    'deduplicated', FALSE,
    'queue_payload_is_pointer_only', TRUE
  );

  INSERT INTO platform_private.durable_work_events (
    organization_id,
    work_item_id,
    event_type,
    previous_state,
    new_state,
    queue_message_id,
    evidence_ref,
    request_id
  )
  VALUES (
    p_organization_id,
    created_work_item_id,
    'enqueued',
    NULL,
    'queued',
    queue_message_id,
    'business-key:' || normalized_business_key,
    p_request_id
  );

  PERFORM platform_private.p2g_store_result(
    p_request_id,
    p_operation,
    input_sha256,
    p_organization_id,
    created_work_item_id,
    NULL,
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
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-durable-work',
    'work.enqueue',
    'durable_work_item',
    created_work_item_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.enqueue_verified_webhook_work(
  p_organization_id UUID,
  p_source_webhook_event_id UUID,
  p_business_key_sha256 TEXT,
  p_max_attempts INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.p2g_enqueue_work(
    p_organization_id,
    'provider_webhook_process',
    p_source_webhook_event_id,
    NULL,
    NULL,
    p_business_key_sha256,
    p_max_attempts,
    p_request_id,
    'enqueue_verified_webhook'
  )
$$;

CREATE OR REPLACE FUNCTION platform.enqueue_ai_draft_work(
  p_organization_id UUID,
  p_ai_draft_request_id UUID,
  p_business_key_sha256 TEXT,
  p_max_attempts INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.p2g_enqueue_work(
    p_organization_id,
    'ai_draft_generate',
    NULL,
    p_ai_draft_request_id,
    NULL,
    p_business_key_sha256,
    p_max_attempts,
    p_request_id,
    'enqueue_ai_draft'
  )
$$;

CREATE OR REPLACE FUNCTION platform.enqueue_manual_whatsapp_send(
  p_organization_id UUID,
  p_manual_send_authorization_id UUID,
  p_business_key_sha256 TEXT,
  p_max_attempts INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.p2g_enqueue_work(
    p_organization_id,
    'manual_whatsapp_send',
    NULL,
    NULL,
    p_manual_send_authorization_id,
    p_business_key_sha256,
    p_max_attempts,
    p_request_id,
    'enqueue_manual_whatsapp_send'
  )
$$;

CREATE OR REPLACE FUNCTION platform.claim_durable_work(
  p_visibility_timeout_seconds INTEGER,
  p_worker_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  queue_message RECORD;
  work_item platform_private.durable_work_items%ROWTYPE;
  prior_attempt platform_private.durable_work_attempts%ROWTYPE;
  created_attempt_id UUID := gen_random_uuid();
  expiry_request_id UUID;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_visibility_timeout_seconds NOT BETWEEN 1 AND 3600
    OR p_worker_ref IS NULL
    OR btrim(p_worker_ref) = ''
    OR char_length(btrim(p_worker_ref)) > 200
  THEN
    RAISE EXCEPTION
      'Visibility timeout and worker reference are invalid'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'visibility_timeout_seconds', p_visibility_timeout_seconds,
          'worker_ref', btrim(p_worker_ref)
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.p2g_replay_request(
    p_request_id,
    'claim',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO queue_message
  FROM pgmq.read(
    'platform_work_v1',
    p_visibility_timeout_seconds,
    1,
    '{}'::JSONB
  );

  IF NOT FOUND THEN
    result := jsonb_build_object(
      'claimed', FALSE,
      'queue', 'platform_work_v1'
    );

    PERFORM platform_private.p2g_store_result(
      p_request_id,
      'claim',
      input_sha256,
      NULL,
      NULL,
      NULL,
      result
    );

    RETURN result;
  END IF;

  IF jsonb_typeof(queue_message.message) <> 'object'
    OR NOT (queue_message.message ? 'v')
    OR NOT (queue_message.message ? 'work_item_id')
    OR NOT (queue_message.message ? 'kind')
    OR queue_message.message
      - ARRAY['v', 'work_item_id', 'kind'] <> '{}'::JSONB
    OR queue_message.message->>'v' <> '1'
    OR queue_message.message->>'work_item_id'
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR queue_message.message->>'kind' NOT IN (
      'provider_webhook_process',
      'ai_draft_generate',
      'manual_whatsapp_send'
    )
  THEN
    RAISE EXCEPTION
      'PGMQ work payload violates the pointer-only contract'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.id = (queue_message.message->>'work_item_id')::UUID
    AND item.queue_message_id = queue_message.msg_id
  FOR UPDATE;

  IF NOT FOUND
    OR work_item.kind::TEXT <> queue_message.message->>'kind'
    OR work_item.state NOT IN ('queued', 'leased', 'retry_wait')
  THEN
    RAISE EXCEPTION
      'PGMQ pointer does not identify eligible durable work'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO prior_attempt
  FROM platform_private.durable_work_attempts AS attempt
  WHERE attempt.organization_id = work_item.organization_id
    AND attempt.work_item_id = work_item.id
    AND attempt.finished_at IS NULL
  FOR UPDATE;

  IF prior_attempt.id IS NOT NULL THEN
    IF prior_attempt.lease_expires_at > clock_timestamp() THEN
      RAISE EXCEPTION
        'PGMQ returned work whose recorded lease is still active'
        USING ERRCODE = '55000';
    END IF;

    IF work_item.kind = 'manual_whatsapp_send' THEN
      result := platform_private.p2g_open_unknown_review(
        work_item.id,
        prior_attempt.id,
        'worker_lease_expired_before_result',
        'worker_lease_expired_before_result',
        p_request_id
      ) || jsonb_build_object(
        'claimed', FALSE,
        'lease_expired_without_result', TRUE
      );

      PERFORM platform_private.p2g_store_result(
        p_request_id,
        'claim',
        input_sha256,
        work_item.organization_id,
        work_item.id,
        prior_attempt.id,
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
      )
      VALUES (
        work_item.organization_id,
        'service',
        NULL,
        'service:platform-durable-work',
        'work.unknown.review',
        'durable_work_item',
        work_item.id,
        jsonb_build_object(
          'state', work_item.state,
          'attempt_id', prior_attempt.id,
          'lease_expires_at', prior_attempt.lease_expires_at
        ),
        result,
        'Manual-send worker lease expired before a result was recorded',
        p_request_id
      );

      RETURN result;
    END IF;

    expiry_request_id := gen_random_uuid();

    UPDATE platform_private.durable_work_attempts
    SET
      finished_at = statement_timestamp(),
      outcome = 'lease_expired',
      error_code = 'lease_expired',
      evidence_ref = 'pgmq-visibility-timeout',
      finish_request_id = expiry_request_id
    WHERE id = prior_attempt.id;

    INSERT INTO platform_private.durable_work_events (
      organization_id,
      work_item_id,
      attempt_id,
      event_type,
      previous_state,
      new_state,
      queue_message_id,
      evidence_ref,
      request_id
    )
    VALUES (
      work_item.organization_id,
      work_item.id,
      prior_attempt.id,
      'lease_expired',
      work_item.state,
      work_item.state,
      work_item.queue_message_id,
      'pgmq-visibility-timeout',
      expiry_request_id
    );
  END IF;

  IF work_item.attempt_count >= work_item.max_attempts THEN
    result := platform_private.p2g_dead_letter_work(
      work_item.id,
      prior_attempt.id,
      'retry_budget_exhausted',
      'pgmq-visibility-timeout',
      p_request_id
    ) || jsonb_build_object(
      'claimed', FALSE,
      'retry_budget_exhausted', TRUE
    );

    PERFORM platform_private.p2g_store_result(
      p_request_id,
      'claim',
      input_sha256,
      work_item.organization_id,
      work_item.id,
      prior_attempt.id,
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
    )
    VALUES (
      work_item.organization_id,
      'service',
      NULL,
      'service:platform-durable-work',
      'work.dead.letter',
      'durable_work_item',
      work_item.id,
      jsonb_build_object(
        'state', work_item.state,
        'attempt_count', work_item.attempt_count
      ),
      result,
      'Retry budget exhausted after a visibility timeout',
      p_request_id
    );

    RETURN result;
  END IF;

  INSERT INTO platform_private.durable_work_attempts (
    id,
    organization_id,
    work_item_id,
    attempt_number,
    queue_message_id,
    queue_read_count,
    worker_ref,
    lease_expires_at
  )
  VALUES (
    created_attempt_id,
    work_item.organization_id,
    work_item.id,
    work_item.attempt_count + 1,
    work_item.queue_message_id,
    queue_message.read_ct,
    btrim(p_worker_ref),
    queue_message.vt
  );

  UPDATE platform_private.durable_work_items
  SET
    state = 'leased',
    attempt_count = work_item.attempt_count + 1,
    available_at = queue_message.vt,
    leased_until = queue_message.vt
  WHERE id = work_item.id;

  result := jsonb_build_object(
    'claimed', TRUE,
    'organization_id', work_item.organization_id,
    'work_item_id', work_item.id,
    'attempt_id', created_attempt_id,
    'kind', work_item.kind,
    'queue', 'platform_work_v1',
    'queue_message_id', work_item.queue_message_id,
    'queue_read_count', queue_message.read_ct,
    'attempt_number', work_item.attempt_count + 1,
    'max_attempts', work_item.max_attempts,
    'lease_expires_at', queue_message.vt,
    'source_webhook_event_id', work_item.source_webhook_event_id,
    'ai_draft_request_id', work_item.ai_draft_request_id,
    'manual_send_authorization_id',
      work_item.manual_send_authorization_id,
    'queue_payload_is_pointer_only', TRUE
  );

  INSERT INTO platform_private.durable_work_events (
    organization_id,
    work_item_id,
    attempt_id,
    event_type,
    previous_state,
    new_state,
    queue_message_id,
    evidence_ref,
    request_id
  )
  VALUES (
    work_item.organization_id,
    work_item.id,
    created_attempt_id,
    'claimed',
    work_item.state,
    'leased',
    work_item.queue_message_id,
    'worker:' || btrim(p_worker_ref),
    p_request_id
  );

  PERFORM platform_private.p2g_store_result(
    p_request_id,
    'claim',
    input_sha256,
    work_item.organization_id,
    work_item.id,
    created_attempt_id,
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
  )
  VALUES (
    work_item.organization_id,
    'service',
    NULL,
    'service:platform-durable-work',
    'work.claim',
    'durable_work_item',
    work_item.id,
    jsonb_build_object(
      'state', work_item.state,
      'attempt_count', work_item.attempt_count
    ),
    result,
    'Claim via PGMQ visibility timeout',
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.extend_durable_work_lease(
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_extension_seconds INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  work_item platform_private.durable_work_items%ROWTYPE;
  attempt platform_private.durable_work_attempts%ROWTYPE;
  queue_message RECORD;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_work_item_id IS NULL
    OR p_attempt_id IS NULL
    OR p_extension_seconds NOT BETWEEN 1 AND 3600
  THEN
    RAISE EXCEPTION
      'Work item, attempt and extension seconds are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'work_item_id', p_work_item_id,
          'attempt_id', p_attempt_id,
          'extension_seconds', p_extension_seconds
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.p2g_replay_request(
    p_request_id,
    'extend_lease',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.id = p_work_item_id
  FOR UPDATE;

  SELECT *
  INTO attempt
  FROM platform_private.durable_work_attempts AS candidate
  WHERE candidate.id = p_attempt_id
    AND candidate.work_item_id = p_work_item_id
  FOR UPDATE;

  IF work_item.id IS NULL
    OR attempt.id IS NULL
    OR work_item.organization_id <> attempt.organization_id
    OR work_item.state <> 'leased'
    OR attempt.finished_at IS NOT NULL
    OR attempt.lease_expires_at <= clock_timestamp()
    OR work_item.leased_until <= clock_timestamp()
  THEN
    RAISE EXCEPTION
      'Only the current non-expired claim can extend its lease'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO queue_message
  FROM pgmq.set_vt(
    'platform_work_v1',
    work_item.queue_message_id,
    p_extension_seconds
  );

  IF NOT FOUND
    OR queue_message.msg_id <> work_item.queue_message_id
  THEN
    RAISE EXCEPTION
      'PGMQ lease extension failed'
      USING ERRCODE = '55000';
  END IF;

  UPDATE platform_private.durable_work_attempts
  SET lease_expires_at = queue_message.vt
  WHERE id = attempt.id;

  UPDATE platform_private.durable_work_items
  SET
    available_at = queue_message.vt,
    leased_until = queue_message.vt
  WHERE id = work_item.id;

  result := jsonb_build_object(
    'organization_id', work_item.organization_id,
    'work_item_id', work_item.id,
    'attempt_id', attempt.id,
    'kind', work_item.kind,
    'state', 'leased',
    'queue_message_id', work_item.queue_message_id,
    'lease_expires_at', queue_message.vt,
    'extension_seconds', p_extension_seconds
  );

  INSERT INTO platform_private.durable_work_events (
    organization_id,
    work_item_id,
    attempt_id,
    event_type,
    previous_state,
    new_state,
    queue_message_id,
    evidence_ref,
    request_id
  )
  VALUES (
    work_item.organization_id,
    work_item.id,
    attempt.id,
    'lease_extended',
    'leased',
    'leased',
    work_item.queue_message_id,
    'lease-extension-seconds:' || p_extension_seconds::TEXT,
    p_request_id
  );

  PERFORM platform_private.p2g_store_result(
    p_request_id,
    'extend_lease',
    input_sha256,
    work_item.organization_id,
    work_item.id,
    attempt.id,
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
  )
  VALUES (
    work_item.organization_id,
    'service',
    NULL,
    'service:platform-durable-work',
    'work.lease.extend',
    'durable_work_item',
    work_item.id,
    jsonb_build_object(
      'state', work_item.state,
      'lease_expires_at', work_item.leased_until
    ),
    result,
    'Explicit worker lease extension',
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.finish_durable_work(
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_outcome platform.durable_work_finish_outcome,
  p_error_code TEXT,
  p_evidence_ref TEXT,
  p_retry_delay_seconds INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  work_item platform_private.durable_work_items%ROWTYPE;
  attempt platform_private.durable_work_attempts%ROWTYPE;
  queue_message RECORD;
  archived BOOLEAN;
  input_sha256 TEXT;
  replayed JSONB;
  reconciliation_event_id UUID;
  review_case_id UUID;
  result JSONB;
  audit_action TEXT;
  audit_reason TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_work_item_id IS NULL
    OR p_attempt_id IS NULL
    OR p_outcome IS NULL
    OR p_evidence_ref IS NULL
    OR btrim(p_evidence_ref) = ''
    OR char_length(btrim(p_evidence_ref)) > 500
    OR (
      p_outcome = 'succeeded'
      AND (
        p_error_code IS NOT NULL
        OR p_retry_delay_seconds IS NOT NULL
      )
    )
    OR (
      p_outcome = 'retryable_error'
      AND (
        p_error_code IS NULL
        OR p_error_code !~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
        OR p_retry_delay_seconds NOT BETWEEN 1 AND 86400
      )
    )
    OR (
      p_outcome IN ('terminal_error', 'unknown_result', 'conflict')
      AND (
        p_error_code IS NULL
        OR p_error_code !~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
        OR p_retry_delay_seconds IS NOT NULL
      )
    )
  THEN
    RAISE EXCEPTION
      'Finish outcome, error, evidence and retry delay are inconsistent'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'work_item_id', p_work_item_id,
          'attempt_id', p_attempt_id,
          'outcome', p_outcome,
          'error_code', p_error_code,
          'evidence_ref', btrim(p_evidence_ref),
          'retry_delay_seconds', p_retry_delay_seconds
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.p2g_replay_request(
    p_request_id,
    'finish',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.id = p_work_item_id
  FOR UPDATE;

  SELECT *
  INTO attempt
  FROM platform_private.durable_work_attempts AS candidate
  WHERE candidate.id = p_attempt_id
    AND candidate.work_item_id = p_work_item_id
  FOR UPDATE;

  IF work_item.id IS NULL
    OR attempt.id IS NULL
    OR work_item.organization_id <> attempt.organization_id
    OR work_item.state <> 'leased'
    OR attempt.finished_at IS NOT NULL
    OR attempt.lease_expires_at <= clock_timestamp()
    OR work_item.leased_until <= clock_timestamp()
  THEN
    RAISE EXCEPTION
      'Only the current non-expired claim can finish work'
      USING ERRCODE = '55000';
  END IF;

  IF p_outcome = 'unknown_result'
    AND work_item.kind <> 'manual_whatsapp_send'
  THEN
    RAISE EXCEPTION
      'Unknown delivery is valid only for manually authorized WhatsApp work'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'conflict'
    AND work_item.kind <> 'provider_webhook_process'
  THEN
    RAISE EXCEPTION
      'Provider conflict is valid only for verified webhook work'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'unknown_result' THEN
    result := platform_private.p2g_open_unknown_review(
      work_item.id,
      attempt.id,
      p_error_code,
      btrim(p_evidence_ref),
      p_request_id
    );

    audit_action := 'work.unknown.review';
    audit_reason :=
      'Unknown delivery is terminal and requires a fresh authorization';
  ELSIF p_outcome = 'retryable_error'
    AND work_item.attempt_count < work_item.max_attempts
  THEN
    SELECT *
    INTO queue_message
    FROM pgmq.set_vt(
      'platform_work_v1',
      work_item.queue_message_id,
      p_retry_delay_seconds
    );

    IF NOT FOUND
      OR queue_message.msg_id <> work_item.queue_message_id
    THEN
      RAISE EXCEPTION
        'PGMQ retry scheduling failed'
        USING ERRCODE = '55000';
    END IF;

    UPDATE platform_private.durable_work_attempts
    SET
      finished_at = statement_timestamp(),
      outcome = 'retryable_error',
      error_code = p_error_code,
      evidence_ref = btrim(p_evidence_ref),
      finish_request_id = p_request_id
    WHERE id = attempt.id;

    UPDATE platform_private.durable_work_items
    SET
      state = 'retry_wait',
      available_at = queue_message.vt,
      leased_until = NULL
    WHERE id = work_item.id;

    result := jsonb_build_object(
      'organization_id', work_item.organization_id,
      'work_item_id', work_item.id,
      'attempt_id', attempt.id,
      'kind', work_item.kind,
      'state', 'retry_wait',
      'outcome', p_outcome,
      'queue_message_id', work_item.queue_message_id,
      'same_queue_message_retained', TRUE,
      'retry_at', queue_message.vt,
      'attempt_number', attempt.attempt_number,
      'max_attempts', work_item.max_attempts,
      'automatic_retry_allowed', TRUE
    );

    INSERT INTO platform_private.durable_work_events (
      organization_id,
      work_item_id,
      attempt_id,
      event_type,
      previous_state,
      new_state,
      queue_message_id,
      evidence_ref,
      request_id
    )
    VALUES (
      work_item.organization_id,
      work_item.id,
      attempt.id,
      'retry_scheduled',
      work_item.state,
      'retry_wait',
      work_item.queue_message_id,
      btrim(p_evidence_ref),
      p_request_id
    );

    audit_action := 'work.retry.schedule';
    audit_reason := 'Explicit retryable failure within the retry budget';
  ELSIF p_outcome IN ('retryable_error', 'terminal_error') THEN
    UPDATE platform_private.durable_work_attempts
    SET
      finished_at = statement_timestamp(),
      outcome = CASE
        WHEN p_outcome = 'retryable_error'
          THEN 'retryable_error'::platform.durable_work_attempt_outcome
        ELSE 'terminal_error'::platform.durable_work_attempt_outcome
      END,
      error_code = p_error_code,
      evidence_ref = btrim(p_evidence_ref),
      finish_request_id = p_request_id
    WHERE id = attempt.id;

    result := platform_private.p2g_dead_letter_work(
      work_item.id,
      attempt.id,
      CASE
        WHEN p_outcome = 'retryable_error'
          THEN 'retry_budget_exhausted'
        ELSE p_error_code
      END,
      btrim(p_evidence_ref),
      p_request_id
    ) || jsonb_build_object(
      'attempt_id', attempt.id,
      'outcome', p_outcome,
      'attempt_number', attempt.attempt_number,
      'max_attempts', work_item.max_attempts,
      'automatic_retry_allowed', FALSE
    );

    audit_action := 'work.dead.letter';
    audit_reason := CASE
      WHEN p_outcome = 'retryable_error'
        THEN 'Retry budget exhausted'
      ELSE 'Terminal work failure'
    END;
  ELSE
    SELECT pgmq.archive(
      'platform_work_v1',
      work_item.queue_message_id
    )
    INTO archived;

    IF archived IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION
        'Active PGMQ row % could not be archived',
        work_item.queue_message_id
        USING ERRCODE = '55000';
    END IF;

    UPDATE platform_private.durable_work_attempts
    SET
      finished_at = statement_timestamp(),
      outcome = p_outcome::TEXT::platform.durable_work_attempt_outcome,
      error_code = p_error_code,
      evidence_ref = btrim(p_evidence_ref),
      finish_request_id = p_request_id
    WHERE id = attempt.id;

    IF p_outcome = 'succeeded' THEN
      UPDATE platform_private.durable_work_items
      SET
        state = 'succeeded',
        leased_until = NULL,
        completed_at = statement_timestamp()
      WHERE id = work_item.id;

      result := jsonb_build_object(
        'organization_id', work_item.organization_id,
        'work_item_id', work_item.id,
        'attempt_id', attempt.id,
        'kind', work_item.kind,
        'state', 'succeeded',
        'outcome', p_outcome,
        'queue_message_id', work_item.queue_message_id,
        'active_message_archived', TRUE,
        'automatic_retry_allowed', FALSE
      );

      INSERT INTO platform_private.durable_work_events (
        organization_id,
        work_item_id,
        attempt_id,
        event_type,
        previous_state,
        new_state,
        queue_message_id,
        evidence_ref,
        request_id
      )
      VALUES (
        work_item.organization_id,
        work_item.id,
        attempt.id,
        'succeeded',
        work_item.state,
        'succeeded',
        work_item.queue_message_id,
        btrim(p_evidence_ref),
        p_request_id
      );

      audit_action := 'work.succeed';
      audit_reason := 'Worker reported a successful effect';
    ELSE
      UPDATE platform_private.durable_work_items
      SET
        state = 'conflict_manual_review',
        leased_until = NULL,
        completed_at = statement_timestamp()
      WHERE id = work_item.id;

      reconciliation_event_id := gen_random_uuid();
      review_case_id := gen_random_uuid();

      INSERT INTO platform_private.provider_reconciliation_events (
        id,
        organization_id,
        source_webhook_event_id,
        observation_kind,
        evidence_ref,
        requires_manual_review,
        request_id
      )
      VALUES (
        reconciliation_event_id,
        work_item.organization_id,
        work_item.source_webhook_event_id,
        'conflict',
        btrim(p_evidence_ref),
        TRUE,
        p_request_id
      );

      INSERT INTO platform.work_review_cases (
        id,
        organization_id,
        work_item_id,
        review_kind,
        provider_reconciliation_event_id,
        opened_request_id
      )
      VALUES (
        review_case_id,
        work_item.organization_id,
        work_item.id,
        'provider_conflict',
        reconciliation_event_id,
        p_request_id
      );

      result := jsonb_build_object(
        'organization_id', work_item.organization_id,
        'work_item_id', work_item.id,
        'attempt_id', attempt.id,
        'kind', work_item.kind,
        'state', 'conflict_manual_review',
        'outcome', p_outcome,
        'queue_message_id', work_item.queue_message_id,
        'active_message_archived', TRUE,
        'dead_lettered', FALSE,
        'automatic_retry_allowed', FALSE,
        'source_webhook_event_id', work_item.source_webhook_event_id,
        'provider_reconciliation_event_id', reconciliation_event_id,
        'work_review_case_id', review_case_id
      );

      INSERT INTO platform.work_review_events (
        organization_id,
        work_review_case_id,
        event_type,
        actor_kind,
        actor_principal,
        after_state,
        reason,
        request_id
      )
      VALUES (
        work_item.organization_id,
        review_case_id,
        'opened',
        'service',
        'service:platform-durable-work',
        result,
        'Provider conflict requires Admin reconciliation',
        p_request_id
      );

      INSERT INTO platform_private.durable_work_events (
        organization_id,
        work_item_id,
        attempt_id,
        event_type,
        previous_state,
        new_state,
        queue_message_id,
        evidence_ref,
        request_id
      )
      VALUES (
        work_item.organization_id,
        work_item.id,
        attempt.id,
        'conflict_manual_review',
        work_item.state,
        'conflict_manual_review',
        work_item.queue_message_id,
        btrim(p_evidence_ref),
        p_request_id
      );

      audit_action := 'work.conflict.review';
      audit_reason := 'Provider conflict requires Admin reconciliation';
    END IF;
  END IF;

  PERFORM platform_private.p2g_store_result(
    p_request_id,
    'finish',
    input_sha256,
    work_item.organization_id,
    work_item.id,
    attempt.id,
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
  )
  VALUES (
    work_item.organization_id,
    'service',
    NULL,
    'service:platform-durable-work',
    audit_action,
    'durable_work_item',
    work_item.id,
    jsonb_build_object(
      'state', work_item.state,
      'attempt_count', work_item.attempt_count,
      'lease_expires_at', work_item.leased_until
    ),
    result,
    audit_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.admin_work_review_cases(
  p_organization_id UUID
)
RETURNS TABLE (
  work_review_case_id UUID,
  review_kind platform.work_review_kind,
  review_status platform.work_review_status,
  work_item_id UUID,
  work_kind platform.durable_work_kind,
  work_state platform.durable_work_state,
  conversation_id UUID,
  manual_send_authorization_id UUID,
  provider_reconciliation_event_id UUID,
  opened_at TIMESTAMPTZ,
  resolution platform.work_review_resolution,
  resolution_reason TEXT,
  resolved_at TIMESTAMPTZ
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
  FROM platform_private.require_p2f_admin_actor(
    p_organization_id,
    'workreview.read'
  );

  RETURN QUERY
  SELECT
    review_case.id,
    review_case.review_kind,
    review_case.status,
    work_item.id,
    work_item.kind,
    work_item.state,
    review_case.conversation_id,
    review_case.manual_send_authorization_id,
    review_case.provider_reconciliation_event_id,
    review_case.opened_at,
    review_case.resolution,
    review_case.resolution_reason,
    review_case.resolved_at
  FROM platform.work_review_cases AS review_case
  JOIN platform_private.durable_work_items AS work_item
    ON work_item.organization_id = review_case.organization_id
    AND work_item.id = review_case.work_item_id
  WHERE review_case.organization_id = p_organization_id
  ORDER BY
    (review_case.status = 'open') DESC,
    review_case.opened_at,
    review_case.id;
END
$$;

CREATE OR REPLACE FUNCTION platform.resolve_work_review_case(
  p_organization_id UUID,
  p_work_review_case_id UUID,
  p_resolution platform.work_review_resolution,
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
  review_case platform.work_review_cases%ROWTYPE;
  work_item platform_private.durable_work_items%ROWTYPE;
  replayed JSONB;
  before_state JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_work_review_case_id IS NULL
    OR p_resolution IS NULL
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
  THEN
    RAISE EXCEPTION
      'Review case, resolution and explicit reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_p2f_admin_actor(
    p_organization_id,
    'workreview.resolve'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'work.review.resolve',
    'work_review_case',
    p_work_review_case_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'work_review_case_id', p_work_review_case_id,
      'resolution', p_resolution,
      'resolved_by_membership_id', actor.actor_membership_id,
      'work_requeued', FALSE,
      'send_triggered', FALSE
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO review_case
  FROM platform.work_review_cases AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_work_review_case_id
  FOR UPDATE;

  IF NOT FOUND OR review_case.status <> 'open' THEN
    RAISE EXCEPTION
      'Only an open work review case can be resolved'
      USING ERRCODE = '55000';
  END IF;

  IF (
    review_case.review_kind = 'unknown_delivery'
    AND p_resolution NOT IN (
      'confirmed_no_send',
      'new_manual_authorization_required'
    )
  )
  OR (
    review_case.review_kind = 'provider_conflict'
    AND p_resolution NOT IN (
      'duplicate_suppressed',
      'conflict_acknowledged'
    )
  ) THEN
    RAISE EXCEPTION
      'Resolution is invalid for this review kind'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.id = review_case.work_item_id
  FOR UPDATE;

  IF work_item.id IS NULL
    OR work_item.state NOT IN (
      'unknown_manual_review',
      'conflict_manual_review'
    )
  THEN
    RAISE EXCEPTION
      'Review case no longer points at terminal manual-review work'
      USING ERRCODE = '55000';
  END IF;

  before_state := jsonb_build_object(
    'work_review_case_id', review_case.id,
    'review_kind', review_case.review_kind,
    'status', review_case.status,
    'resolution', review_case.resolution,
    'work_item_id', work_item.id,
    'work_state', work_item.state
  );

  UPDATE platform.work_review_cases
  SET
    status = 'resolved',
    resolution = p_resolution,
    resolution_reason = btrim(p_reason),
    resolved_by_profile_id = actor.actor_profile_id,
    resolved_by_membership_id = actor.actor_membership_id,
    resolved_request_id = p_request_id,
    resolved_at = statement_timestamp()
  WHERE organization_id = p_organization_id
    AND id = review_case.id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'work_review_case_id', review_case.id,
    'review_kind', review_case.review_kind,
    'status', 'resolved',
    'resolution', p_resolution,
    'work_item_id', work_item.id,
    'work_state', work_item.state,
    'manual_send_authorization_id',
      review_case.manual_send_authorization_id,
    'resolved_by_membership_id', actor.actor_membership_id,
    'work_requeued', FALSE,
    'send_triggered', FALSE,
    'authorization_reused', FALSE
  );

  INSERT INTO platform.work_review_events (
    organization_id,
    work_review_case_id,
    event_type,
    actor_kind,
    actor_profile_id,
    actor_membership_id,
    actor_principal,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    review_case.id,
    'resolved',
    'user',
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id::TEXT,
    before_state,
    result,
    btrim(p_reason),
    p_request_id
  );

  INSERT INTO platform_private.durable_work_events (
    organization_id,
    work_item_id,
    event_type,
    previous_state,
    new_state,
    queue_message_id,
    evidence_ref,
    request_id
  )
  VALUES (
    p_organization_id,
    work_item.id,
    'review_resolved',
    work_item.state,
    work_item.state,
    work_item.queue_message_id,
    'admin-resolution:' || p_resolution::TEXT,
    p_request_id
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
    'work.review.resolve',
    'work_review_case',
    review_case.id,
    before_state,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON TABLE
  platform_private.durable_work_items,
  platform_private.durable_work_attempts,
  platform_private.durable_work_events,
  platform_private.durable_work_dead_letters,
  platform_private.durable_work_idempotency
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON TABLE
  platform.work_review_cases,
  platform.work_review_events
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON TABLE
  platform.work_review_cases,
  platform.work_review_events
TO authenticated;

REVOKE ALL PRIVILEGES ON TYPE
  platform.durable_work_kind,
  platform.durable_work_state,
  platform.durable_work_finish_outcome,
  platform.durable_work_attempt_outcome,
  platform.durable_work_event_type,
  platform.durable_work_operation,
  platform.work_review_kind,
  platform.work_review_status,
  platform.work_review_resolution,
  platform.work_review_event_type
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT USAGE ON TYPE
  platform.durable_work_kind,
  platform.durable_work_state,
  platform.work_review_kind,
  platform.work_review_status,
  platform.work_review_resolution
TO authenticated;

GRANT USAGE ON TYPE
  platform.durable_work_finish_outcome
TO service_role;

REVOKE ALL ON FUNCTION
  platform_private.lock_p2g_request(UUID),
  platform_private.require_p2g_service(),
  platform_private.p2g_replay_request(
    UUID,
    platform.durable_work_operation,
    TEXT
  ),
  platform_private.p2g_store_result(
    UUID,
    platform.durable_work_operation,
    TEXT,
    UUID,
    UUID,
    UUID,
    JSONB
  ),
  platform_private.p2g_dead_letter_work(UUID, UUID, TEXT, TEXT, UUID),
  platform_private.p2g_open_unknown_review(UUID, UUID, TEXT, TEXT, UUID),
  platform_private.p2g_enqueue_work(
    UUID,
    platform.durable_work_kind,
    UUID,
    UUID,
    UUID,
    TEXT,
    INTEGER,
    UUID,
    platform.durable_work_operation
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  private.platform_can_read_work_review(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  private.platform_can_read_work_review(UUID)
TO authenticated;

REVOKE ALL ON FUNCTION
  platform.enqueue_verified_webhook_work(UUID, UUID, TEXT, INTEGER, UUID),
  platform.enqueue_ai_draft_work(UUID, UUID, TEXT, INTEGER, UUID),
  platform.enqueue_manual_whatsapp_send(UUID, UUID, TEXT, INTEGER, UUID),
  platform.claim_durable_work(INTEGER, TEXT, UUID),
  platform.extend_durable_work_lease(UUID, UUID, INTEGER, UUID),
  platform.finish_durable_work(
    UUID,
    UUID,
    platform.durable_work_finish_outcome,
    TEXT,
    TEXT,
    INTEGER,
    UUID
  ),
  platform.admin_work_review_cases(UUID),
  platform.resolve_work_review_case(
    UUID,
    UUID,
    platform.work_review_resolution,
    TEXT,
    UUID
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.enqueue_verified_webhook_work(UUID, UUID, TEXT, INTEGER, UUID),
  platform.enqueue_ai_draft_work(UUID, UUID, TEXT, INTEGER, UUID),
  platform.enqueue_manual_whatsapp_send(UUID, UUID, TEXT, INTEGER, UUID),
  platform.claim_durable_work(INTEGER, TEXT, UUID),
  platform.extend_durable_work_lease(UUID, UUID, INTEGER, UUID),
  platform.finish_durable_work(
    UUID,
    UUID,
    platform.durable_work_finish_outcome,
    TEXT,
    TEXT,
    INTEGER,
    UUID
  )
TO service_role;

GRANT EXECUTE ON FUNCTION
  platform.admin_work_review_cases(UUID),
  platform.resolve_work_review_case(
    UUID,
    UUID,
    platform.work_review_resolution,
    TEXT,
    UUID
  )
TO authenticated;

COMMENT ON TABLE platform_private.durable_work_items IS
  'Private outbox aggregate pointing at one validated P2F source row.';
COMMENT ON TABLE platform_private.durable_work_attempts IS
  'Private claim/lease attempts over the same retryable PGMQ message.';
COMMENT ON TABLE platform_private.durable_work_events IS
  'Private append-only durable-work transition evidence.';
COMMENT ON TABLE platform_private.durable_work_dead_letters IS
  'Private append-only exhausted/terminal work evidence with pointer-only DLQ.';
COMMENT ON TABLE platform_private.durable_work_idempotency IS
  'Private append-only replay ledger for service durable-work RPCs.';
COMMENT ON TABLE platform.work_review_cases IS
  'Admin-only safe projection of unknown delivery and provider conflicts.';
COMMENT ON TABLE platform.work_review_events IS
  'Append-only Admin review history; resolutions never send or requeue work.';
COMMENT ON FUNCTION platform.finish_durable_work(
  UUID,
  UUID,
  platform.durable_work_finish_outcome,
  TEXT,
  TEXT,
  INTEGER,
  UUID
) IS
  'Finishes one live claim; unknown/conflict are terminal manual-review states.';
COMMENT ON FUNCTION platform.resolve_work_review_case(
  UUID,
  UUID,
  platform.work_review_resolution,
  TEXT,
  UUID
) IS
  'Records an Admin resolution without requeue, send or authorization reuse.';

COMMIT;
