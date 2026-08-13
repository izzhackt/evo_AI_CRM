-- ============================================================
-- 071_platform_audit_search_export.sql
--
-- P7A: actor-derived Admin-only audit search/export. Browser roles lose raw
-- audit table access; the public RPCs return only a fixed safe projection.
-- Export replay stores immutable identifiers and hashes, never exported row
-- content, provider payloads, object keys, principals, or free-text reasons.
-- ============================================================

BEGIN;

-- The base audit row is private evidence. SECURITY DEFINER RPCs below apply
-- the live actor boundary and safe projection explicitly.
DROP POLICY IF EXISTS audit_events_read ON platform.audit_events;
REVOKE ALL ON TABLE platform.audit_events
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Descending keyset scans always bind organization first. Equality-filtered
-- variants put the exact filter before the immutable (created_at,id) order.
CREATE INDEX audit_events_org_created_id_idx
  ON platform.audit_events (organization_id, created_at DESC, id DESC);
CREATE INDEX audit_events_org_action_created_id_idx
  ON platform.audit_events (
    organization_id,
    action,
    created_at DESC,
    id DESC
  );
CREATE INDEX audit_events_org_type_created_id_idx
  ON platform.audit_events (
    organization_id,
    resource_type,
    created_at DESC,
    id DESC
  );
CREATE INDEX audit_events_org_resource_created_id_idx
  ON platform.audit_events (
    organization_id,
    resource_id,
    created_at DESC,
    id DESC
  );

CREATE TABLE platform_private.audit_export_replays (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  actor_profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL,
  canonical_request JSONB NOT NULL
    CHECK (jsonb_typeof(canonical_request) = 'object'),
  filters JSONB NOT NULL CHECK (jsonb_typeof(filters) = 'object'),
  requested_snapshot_created_at TIMESTAMPTZ,
  requested_snapshot_id UUID,
  snapshot_created_at TIMESTAMPTZ,
  snapshot_id UUID
    REFERENCES platform.audit_events(id) ON DELETE RESTRICT,
  audit_event_ids UUID[] NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 5000),
  row_set_sha256 TEXT NOT NULL CHECK (row_set_sha256 ~ '^[0-9a-f]{64}$'),
  export_audit_event_id UUID NOT NULL UNIQUE
    REFERENCES platform.audit_events(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT audit_export_replays_actor_membership_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT audit_export_replays_requested_snapshot_pair CHECK (
    (requested_snapshot_created_at IS NULL) =
      (requested_snapshot_id IS NULL)
  ),
  CONSTRAINT audit_export_replays_snapshot_pair CHECK (
    (snapshot_created_at IS NULL) = (snapshot_id IS NULL)
  ),
  CONSTRAINT audit_export_replays_row_ids_count CHECK (
    cardinality(audit_event_ids) = row_count
  )
);

CREATE INDEX audit_export_replays_org_membership_idx
  ON platform_private.audit_export_replays (
    organization_id,
    actor_membership_id
  );
CREATE INDEX audit_export_replays_actor_profile_idx
  ON platform_private.audit_export_replays (actor_profile_id);
CREATE INDEX audit_export_replays_snapshot_idx
  ON platform_private.audit_export_replays (snapshot_id)
  WHERE snapshot_id IS NOT NULL;

ALTER TABLE platform_private.audit_export_replays ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.audit_export_replays FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.audit_export_replays
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER audit_export_replays_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.audit_export_replays
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER audit_export_replays_append_only_truncate
  BEFORE TRUNCATE ON platform_private.audit_export_replays
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ARRAY[
    'ai.control.set',
    'ai.draft.generate',
    'ai.draft.language.resolve',
    'ai.draft.record',
    'ai.draft.request',
    'ai.draft.request.knowledge',
    'ai.draft.review',
    'ai.fact.record',
    'ai.memory.record',
    'ai.qualification.record',
    'ai.retrieval.preview',
    'application.create',
    'application.status.change',
    'audit.export',
    'autonomous.reply.control.set',
    'case.create',
    'case.curator.set',
    'case.handoff.create',
    'case.lifecycle.change',
    'case.route.change',
    'case.update.append',
    'catalog.import.batch.create',
    'catalog.import.batch.review',
    'catalog.import.batch.validate',
    'catalog.import.candidate.stage',
    'communication.conversation.create',
    'communication.conversation.link',
    'communication.manual.authorize',
    'communication.manual.send',
    'communication.manual.send.request',
    'communication.message.record',
    'communication.participant.record',
    'communication.provider.observe',
    'communication.waha.history.begin',
    'communication.waha.history.complete',
    'communication.waha.history.pause',
    'communication.waha.history.project',
    'communication.waha.project',
    'communication.waha.project.retry',
    'contract.draft.generate',
    'contract.draft.review',
    'contract.template.version.approve',
    'contract.template.version.create',
    'contract.template.version.retire',
    'country.requirement.apply',
    'country.requirement.source.link',
    'country.requirement.version.approve',
    'country.requirement.version.create',
    'country.requirement.version.retire',
    'decision.backlog.create',
    'decision.backlog.transition',
    'document.download.grant',
    'document.download.sign.authorize',
    'document.requirement.create',
    'document.requirement.retire',
    'document.slot.create',
    'document.upload.finalize',
    'document.upload.reserve',
    'document.validation.attest',
    'document.version.record',
    'document.version.review',
    'finance.obligation.create',
    'finance.payment.record',
    'finance.stop.create',
    'finance.stop.resolve',
    'knowledge.chunkset.publish',
    'knowledge.version.publish',
    'knowledge.version.retire',
    'membership.provision',
    'membership.role.change',
    'membership.scope.organization.assign',
    'membership.scope.organization.revoke',
    'membership.status.change',
    'messaging.integration.health.record',
    'notification.consent.set',
    'notification.create',
    'notification.read',
    'organization.bootstrap',
    'post.contract.item.update',
    'post.contract.items.seed',
    'post.contract.report.generate',
    'post.contract.report.review',
    'rbac.bundle.upgrade',
    'student.profile.upsert',
    'task.change',
    'task.create',
    'visa.create',
    'visa.status.change',
    'workflow.contract.create',
    'workflow.source.link',
    'workflow.source.register',
    'workflow.source.retire',
    'workflow.source.review',
    'workflow.version.approve',
    'workflow.version.create',
    'workflow.version.retire'
  ]::TEXT[]
$$;

CREATE OR REPLACE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ARRAY[
    'ai_draft',
    'ai_draft_request',
    'ai_draft_request_knowledge_selection',
    'ai_retrieval_request',
    'approved_knowledge_chunk_set',
    'approved_knowledge_version',
    'audit_export',
    'case_task',
    'catalog_import_batch',
    'catalog_import_candidate',
    'communication_conversation',
    'communication_message',
    'contract_template_version',
    'conversation_ai_control',
    'conversation_ai_fact',
    'conversation_ai_memory',
    'conversation_ai_qualification',
    'conversation_participant',
    'country_requirement_version',
    'country_requirement_version_source',
    'decision_backlog',
    'document_requirement',
    'document_slot',
    'document_version',
    'durable_work_item',
    'manual_send_authorization',
    'messaging_integration_health_event',
    'notification',
    'notification_consent',
    'organization',
    'organization_membership',
    'payment_event',
    'payment_obligation',
    'post_contract_item',
    'post_contract_item_set',
    'post_contract_report',
    'provider_reconciliation_event',
    'source_registry',
    'stop_factor',
    'student_case',
    'student_case_contract_draft',
    'student_case_update',
    'student_profile',
    'university_application',
    'visa_case',
    'waha_history_reconciliation_run',
    'workflow_contract',
    'workflow_contract_version',
    'workflow_contract_version_source'
  ]::TEXT[]
$$;

CREATE OR REPLACE FUNCTION platform_private.p7a_normalize_audit_filter(
  p_values TEXT[],
  p_allowlist TEXT[],
  p_label TEXT
)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized TEXT[];
BEGIN
  IF p_values IS NULL THEN
    RETURN NULL;
  END IF;

  IF cardinality(p_values) NOT BETWEEN 1 AND 32
    OR EXISTS (
      SELECT 1
      FROM unnest(p_values) AS supplied(value)
      WHERE supplied.value IS NULL
        OR supplied.value = ''
        OR char_length(supplied.value) > 64
        OR supplied.value ~ '[[:cntrl:]]'
        OR NOT (supplied.value = ANY (p_allowlist))
    )
  THEN
    RAISE EXCEPTION 'Invalid or out-of-scope audit % filter', p_label
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(deduplicated.value ORDER BY deduplicated.value)
  INTO normalized
  FROM (
    SELECT DISTINCT supplied.value
    FROM unnest(p_values) AS supplied(value)
  ) AS deduplicated;

  RETURN normalized;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.p7a_utc_timestamp(
  p_value TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    ELSE to_char(
      p_value AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  END
$$;

CREATE OR REPLACE FUNCTION platform_private.p7a_changed_field_codes(
  p_action TEXT
)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_action = 'audit.export' THEN
      ARRAY[
        'export_filters',
        'export_row_count',
        'export_row_set_sha256'
      ]::TEXT[]
    WHEN p_action = 'organization.bootstrap' THEN
      ARRAY['record_status', 'actor_role', 'assignment']::TEXT[]
    WHEN p_action = 'membership.provision' THEN
      ARRAY['record_status', 'actor_role', 'assignment']::TEXT[]
    WHEN p_action = 'membership.role.change' THEN
      ARRAY['access_version', 'actor_role']::TEXT[]
    WHEN p_action = 'membership.status.change' THEN
      ARRAY['access_version', 'record_status']::TEXT[]
    WHEN p_action IN (
      'membership.scope.organization.assign',
      'membership.scope.organization.revoke'
    ) THEN ARRAY['assignment']::TEXT[]
    WHEN p_action = 'rbac.bundle.upgrade' THEN
      ARRAY['access_version', 'actor_role']::TEXT[]
    WHEN p_action = 'case.curator.set'
      OR p_action = 'case.handoff.create'
    THEN ARRAY['case_assignment']::TEXT[]
    WHEN p_action = 'case.lifecycle.change' THEN
      ARRAY['case_lifecycle', 'case_status']::TEXT[]
    WHEN p_action = 'case.route.change' THEN
      ARRAY['case_route']::TEXT[]
    WHEN p_action IN ('case.create', 'application.status.change', 'visa.status.change')
    THEN ARRAY['case_status']::TEXT[]
    WHEN p_action IN (
      'case.update.append',
      'application.create',
      'student.profile.upsert',
      'visa.create'
    ) THEN ARRAY['record_status']::TEXT[]
    WHEN p_action IN ('task.create', 'task.change') THEN
      ARRAY['work_status']::TEXT[]
    WHEN p_action LIKE 'document.%' THEN
      CASE
        WHEN p_action IN ('document.validation.attest', 'document.version.review')
        THEN ARRAY['document_status', 'review_status']::TEXT[]
        ELSE ARRAY['document_status']::TEXT[]
      END
    WHEN p_action LIKE 'finance.%' THEN ARRAY['finance_status']::TEXT[]
    WHEN p_action = 'notification.consent.set' THEN
      ARRAY['consent_status']::TEXT[]
    WHEN p_action LIKE 'notification.%' THEN
      ARRAY['notification_status']::TEXT[]
    WHEN p_action IN ('ai.control.set', 'autonomous.reply.control.set') THEN
      ARRAY['ai_control']::TEXT[]
    WHEN p_action LIKE 'ai.%' THEN
      CASE
        WHEN p_action = 'ai.draft.review'
        THEN ARRAY['ai_status', 'review_status']::TEXT[]
        ELSE ARRAY['ai_status']::TEXT[]
      END
    WHEN p_action LIKE 'communication.%'
      OR p_action = 'messaging.integration.health.record'
    THEN ARRAY['communication_status']::TEXT[]
    ELSE ARRAY['record_status']::TEXT[]
  END
$$;

CREATE OR REPLACE FUNCTION platform_private.p7a_safe_audit_row(
  p_event platform.audit_events
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (
    p_event.action = ANY (platform_private.p7a_safe_audit_actions())
    AND p_event.resource_type = ANY (
      platform_private.p7a_safe_audit_resource_types()
    )
  ) THEN
    RAISE EXCEPTION 'Unsafe audit row reached the P7A projection'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'audit_event_id', p_event.id,
    'created_at', platform_private.p7a_utc_timestamp(p_event.created_at),
    'action', p_event.action,
    'resource_type', p_event.resource_type,
    'resource_id', p_event.resource_id,
    'actor_kind', p_event.actor_kind::TEXT,
    'actor_display_label', CASE p_event.actor_kind
      WHEN 'user'::platform.audit_actor_kind THEN 'Staff'
      WHEN 'service'::platform.audit_actor_kind THEN 'Service'
      ELSE 'System'
    END,
    'request_id', p_event.request_id,
    'reason_code', CASE
      WHEN p_event.action = 'audit.export' THEN 'audit_export_requested'
      ELSE 'restricted'
    END,
    'changed_field_codes',
      platform_private.p7a_changed_field_codes(p_event.action)
  );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.p7a_require_audit_admin()
RETURNS TABLE (
  auth_user_id UUID,
  profile_id UUID,
  membership_id UUID,
  organization_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    authority.auth_user_id,
    authority.profile_id,
    authority.membership_id,
    authority.organization_id
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role = 'admin'::platform.business_role
    AND private.platform_has_permission(
      authority.organization_id,
      'audit.read'
    )
    AND private.platform_has_scope(
      authority.organization_id,
      'organization'::platform.scope_kind,
      authority.organization_id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Platform Admin audit authority is required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform.search_audit_events(
  p_start_at TIMESTAMPTZ DEFAULT NULL,
  p_end_at TIMESTAMPTZ DEFAULT NULL,
  p_actions TEXT[] DEFAULT NULL,
  p_resource_types TEXT[] DEFAULT NULL,
  p_resource_id UUID DEFAULT NULL,
  p_page_size INTEGER DEFAULT 50,
  p_snapshot_created_at TIMESTAMPTZ DEFAULT NULL,
  p_snapshot_id UUID DEFAULT NULL,
  p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_actions TEXT[];
  normalized_resource_types TEXT[];
  canonical_filters JSONB;
  resolved_snapshot_created_at TIMESTAMPTZ;
  resolved_snapshot_id UUID;
  rows_payload JSONB := '[]'::JSONB;
  has_more BOOLEAN := FALSE;
  next_cursor_created_at TIMESTAMPTZ;
  next_cursor_id UUID;
BEGIN
  SELECT * INTO actor
  FROM platform_private.p7a_require_audit_admin();

  IF p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100
    OR (p_start_at IS NOT NULL AND p_end_at IS NOT NULL
      AND p_start_at >= p_end_at)
    OR ((p_snapshot_created_at IS NULL) <> (p_snapshot_id IS NULL))
    OR ((p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL))
    OR (p_cursor_id IS NOT NULL AND p_snapshot_id IS NULL)
  THEN
    RAISE EXCEPTION 'Malformed audit search boundary or page size'
      USING ERRCODE = '22023';
  END IF;

  normalized_actions := platform_private.p7a_normalize_audit_filter(
    p_actions,
    platform_private.p7a_safe_audit_actions(),
    'action'
  );
  normalized_resource_types := platform_private.p7a_normalize_audit_filter(
    p_resource_types,
    platform_private.p7a_safe_audit_resource_types(),
    'resource type'
  );
  canonical_filters := jsonb_build_object(
    'start_at', platform_private.p7a_utc_timestamp(p_start_at),
    'end_at', platform_private.p7a_utc_timestamp(p_end_at),
    'actions', normalized_actions,
    'resource_types', normalized_resource_types,
    'resource_id', p_resource_id
  );

  IF p_snapshot_id IS NOT NULL THEN
    SELECT event.created_at, event.id
    INTO resolved_snapshot_created_at, resolved_snapshot_id
    FROM platform.audit_events AS event
    WHERE event.organization_id = actor.organization_id
      AND event.id = p_snapshot_id
      AND event.created_at = p_snapshot_created_at
      AND event.action = ANY (platform_private.p7a_safe_audit_actions())
      AND event.resource_type = ANY (
        platform_private.p7a_safe_audit_resource_types()
      )
      AND (p_start_at IS NULL OR event.created_at >= p_start_at)
      AND (p_end_at IS NULL OR event.created_at < p_end_at)
      AND (normalized_actions IS NULL
        OR event.action = ANY (normalized_actions))
      AND (normalized_resource_types IS NULL
        OR event.resource_type = ANY (normalized_resource_types))
      AND (p_resource_id IS NULL OR event.resource_id = p_resource_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Audit snapshot is not an eligible organization row'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT event.created_at, event.id
    INTO resolved_snapshot_created_at, resolved_snapshot_id
    FROM platform.audit_events AS event
    WHERE event.organization_id = actor.organization_id
      AND event.action = ANY (platform_private.p7a_safe_audit_actions())
      AND event.resource_type = ANY (
        platform_private.p7a_safe_audit_resource_types()
      )
      AND (p_start_at IS NULL OR event.created_at >= p_start_at)
      AND (p_end_at IS NULL OR event.created_at < p_end_at)
      AND (normalized_actions IS NULL
        OR event.action = ANY (normalized_actions))
      AND (normalized_resource_types IS NULL
        OR event.resource_type = ANY (normalized_resource_types))
      AND (p_resource_id IS NULL OR event.resource_id = p_resource_id)
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT 1;
  END IF;

  IF p_cursor_id IS NOT NULL THEN
    IF resolved_snapshot_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM platform.audit_events AS event
      WHERE event.organization_id = actor.organization_id
        AND event.id = p_cursor_id
        AND event.created_at = p_cursor_created_at
        AND event.action = ANY (platform_private.p7a_safe_audit_actions())
        AND event.resource_type = ANY (
          platform_private.p7a_safe_audit_resource_types()
        )
        AND (event.created_at, event.id) <=
          (resolved_snapshot_created_at, resolved_snapshot_id)
        AND (p_start_at IS NULL OR event.created_at >= p_start_at)
        AND (p_end_at IS NULL OR event.created_at < p_end_at)
        AND (normalized_actions IS NULL
          OR event.action = ANY (normalized_actions))
        AND (normalized_resource_types IS NULL
          OR event.resource_type = ANY (normalized_resource_types))
        AND (p_resource_id IS NULL OR event.resource_id = p_resource_id)
    ) THEN
      RAISE EXCEPTION 'Audit cursor is not a valid organization position'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF resolved_snapshot_id IS NOT NULL THEN
    WITH candidates AS MATERIALIZED (
      SELECT event.*
      FROM platform.audit_events AS event
      WHERE event.organization_id = actor.organization_id
        AND event.action = ANY (platform_private.p7a_safe_audit_actions())
        AND event.resource_type = ANY (
          platform_private.p7a_safe_audit_resource_types()
        )
        AND (event.created_at, event.id) <=
          (resolved_snapshot_created_at, resolved_snapshot_id)
        AND (p_start_at IS NULL OR event.created_at >= p_start_at)
        AND (p_end_at IS NULL OR event.created_at < p_end_at)
        AND (normalized_actions IS NULL
          OR event.action = ANY (normalized_actions))
        AND (normalized_resource_types IS NULL
          OR event.resource_type = ANY (normalized_resource_types))
        AND (p_resource_id IS NULL OR event.resource_id = p_resource_id)
        AND (p_cursor_id IS NULL OR (event.created_at, event.id) <
          (p_cursor_created_at, p_cursor_id))
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT p_page_size + 1
    ),
    page_rows AS MATERIALIZED (
      SELECT candidate.*
      FROM candidates AS candidate
      ORDER BY candidate.created_at DESC, candidate.id DESC
      LIMIT p_page_size
    )
    SELECT
      COALESCE(
        jsonb_agg(
          platform_private.p7a_safe_audit_row(page_row)
          ORDER BY page_row.created_at DESC, page_row.id DESC
        ),
        '[]'::JSONB
      ),
      (SELECT count(*) > p_page_size FROM candidates)
    INTO rows_payload, has_more
    FROM page_rows AS page_row;

    IF has_more THEN
      SELECT event.created_at, event.id
      INTO next_cursor_created_at, next_cursor_id
      FROM platform.audit_events AS event
      WHERE event.organization_id = actor.organization_id
        AND event.id = (
          rows_payload -> (jsonb_array_length(rows_payload) - 1)
            ->> 'audit_event_id'
        )::UUID;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'filters', canonical_filters,
    'snapshot_created_at',
      platform_private.p7a_utc_timestamp(resolved_snapshot_created_at),
    'snapshot_id', resolved_snapshot_id,
    'next_cursor_created_at',
      platform_private.p7a_utc_timestamp(next_cursor_created_at),
    'next_cursor_id', next_cursor_id,
    'has_more', has_more,
    'rows', rows_payload
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.export_audit_events(
  p_request_id UUID,
  p_start_at TIMESTAMPTZ,
  p_end_at TIMESTAMPTZ,
  p_actions TEXT[] DEFAULT NULL,
  p_resource_types TEXT[] DEFAULT NULL,
  p_resource_id UUID DEFAULT NULL,
  p_snapshot_created_at TIMESTAMPTZ DEFAULT NULL,
  p_snapshot_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_actions TEXT[];
  normalized_resource_types TEXT[];
  canonical_filters JSONB;
  canonical_request JSONB;
  replay platform_private.audit_export_replays%ROWTYPE;
  resolved_snapshot_created_at TIMESTAMPTZ;
  resolved_snapshot_id UUID;
  exported_event_ids UUID[] := ARRAY[]::UUID[];
  rows_payload JSONB := '[]'::JSONB;
  exported_row_count INTEGER := 0;
  exported_row_set_sha256 TEXT;
  export_audit_event_id UUID := gen_random_uuid();
BEGIN
  SELECT * INTO actor
  FROM platform_private.p7a_require_audit_admin();

  IF p_request_id IS NULL
    OR p_start_at IS NULL
    OR p_end_at IS NULL
    OR p_start_at >= p_end_at
    OR p_end_at - p_start_at > INTERVAL '31 days'
    OR ((p_snapshot_created_at IS NULL) <> (p_snapshot_id IS NULL))
  THEN
    RAISE EXCEPTION 'Malformed audit export request or time window'
      USING ERRCODE = '22023';
  END IF;

  normalized_actions := platform_private.p7a_normalize_audit_filter(
    p_actions,
    platform_private.p7a_safe_audit_actions(),
    'action'
  );
  normalized_resource_types := platform_private.p7a_normalize_audit_filter(
    p_resource_types,
    platform_private.p7a_safe_audit_resource_types(),
    'resource type'
  );
  canonical_filters := jsonb_build_object(
    'start_at', platform_private.p7a_utc_timestamp(p_start_at),
    'end_at', platform_private.p7a_utc_timestamp(p_end_at),
    'actions', normalized_actions,
    'resource_types', normalized_resource_types,
    'resource_id', p_resource_id
  );
  canonical_request := jsonb_build_object(
    'filters', canonical_filters,
    'requested_snapshot_created_at',
      platform_private.p7a_utc_timestamp(p_snapshot_created_at),
    'requested_snapshot_id', p_snapshot_id
  );

  -- Existing Platform mutation RPCs use this same request-id lock key. It
  -- serializes identical exports and request-id collisions across seams.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT * INTO replay
  FROM platform_private.audit_export_replays AS prior
  WHERE prior.request_id = p_request_id;

  IF FOUND THEN
    IF replay.organization_id <> actor.organization_id
      OR replay.actor_profile_id <> actor.profile_id
      OR replay.actor_membership_id <> actor.membership_id
      OR replay.canonical_request IS DISTINCT FROM canonical_request
    THEN
      RAISE EXCEPTION 'Conflicting audit export request replay'
        USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(
      jsonb_agg(
        platform_private.p7a_safe_audit_row(event)
        ORDER BY ordered.ordinality
      ),
      '[]'::JSONB
    )
    INTO rows_payload
    FROM unnest(replay.audit_event_ids)
      WITH ORDINALITY AS ordered(audit_event_id, ordinality)
    JOIN platform.audit_events AS event
      ON event.id = ordered.audit_event_id
      AND event.organization_id = replay.organization_id
      AND event.action = ANY (platform_private.p7a_safe_audit_actions())
      AND event.resource_type = ANY (
        platform_private.p7a_safe_audit_resource_types()
      );

    exported_row_set_sha256 := encode(
      sha256(convert_to(rows_payload::TEXT, 'UTF8')),
      'hex'
    );
    IF jsonb_array_length(rows_payload) <> replay.row_count
      OR exported_row_set_sha256 <> replay.row_set_sha256
    THEN
      RAISE EXCEPTION 'Immutable audit export replay integrity failed'
        USING ERRCODE = '55000';
    END IF;

    RETURN jsonb_build_object(
      'request_id', replay.request_id,
      'filters', replay.filters,
      'snapshot_created_at',
        platform_private.p7a_utc_timestamp(replay.snapshot_created_at),
      'snapshot_id', replay.snapshot_id,
      'row_count', replay.row_count,
      'row_set_sha256', replay.row_set_sha256,
      'rows', rows_payload
    );
  END IF;

  -- A request UUID belongs to one immutable mutation contract globally. Turn
  -- any pre-existing non-export event into the documented safe conflict.
  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'Audit export request UUID is already in use'
      USING ERRCODE = '22023';
  END IF;

  -- Export consumes the boundary returned by search. A null pair is the
  -- immutable empty snapshot; never re-resolve it after a later append.
  IF p_snapshot_id IS NOT NULL THEN
    SELECT event.created_at, event.id
    INTO resolved_snapshot_created_at, resolved_snapshot_id
    FROM platform.audit_events AS event
    WHERE event.organization_id = actor.organization_id
      AND event.id = p_snapshot_id
      AND event.created_at = p_snapshot_created_at
      AND event.action = ANY (platform_private.p7a_safe_audit_actions())
      AND event.resource_type = ANY (
        platform_private.p7a_safe_audit_resource_types()
      )
      AND event.created_at >= p_start_at
      AND event.created_at < p_end_at
      AND (normalized_actions IS NULL
        OR event.action = ANY (normalized_actions))
      AND (normalized_resource_types IS NULL
        OR event.resource_type = ANY (normalized_resource_types))
      AND (p_resource_id IS NULL OR event.resource_id = p_resource_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Audit export snapshot is not an eligible organization row'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF resolved_snapshot_id IS NOT NULL THEN
    WITH eligible AS MATERIALIZED (
      SELECT event.*
      FROM platform.audit_events AS event
      WHERE event.organization_id = actor.organization_id
        AND event.action = ANY (platform_private.p7a_safe_audit_actions())
        AND event.resource_type = ANY (
          platform_private.p7a_safe_audit_resource_types()
        )
        AND event.created_at >= p_start_at
        AND event.created_at < p_end_at
        AND (event.created_at, event.id) <=
          (resolved_snapshot_created_at, resolved_snapshot_id)
        AND (normalized_actions IS NULL
          OR event.action = ANY (normalized_actions))
        AND (normalized_resource_types IS NULL
          OR event.resource_type = ANY (normalized_resource_types))
        AND (p_resource_id IS NULL OR event.resource_id = p_resource_id)
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT 5001
    )
    SELECT
      count(*)::INTEGER,
      COALESCE(
        array_agg(eligible.id ORDER BY eligible.created_at DESC, eligible.id DESC),
        ARRAY[]::UUID[]
      ),
      COALESCE(
        jsonb_agg(
          platform_private.p7a_safe_audit_row(eligible)
          ORDER BY eligible.created_at DESC, eligible.id DESC
        ),
        '[]'::JSONB
      )
    INTO exported_row_count, exported_event_ids, rows_payload
    FROM eligible;
  END IF;

  IF exported_row_count > 5000 THEN
    RAISE EXCEPTION 'Audit export exceeds the 5000 row limit'
      USING ERRCODE = '54000';
  END IF;

  exported_row_set_sha256 := encode(
    sha256(convert_to(rows_payload::TEXT, 'UTF8')),
    'hex'
  );

  BEGIN
    INSERT INTO platform.audit_events (
      id,
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
      export_audit_event_id,
      actor.organization_id,
      'user',
      actor.profile_id,
      'auth:' || actor.auth_user_id::TEXT,
      'audit.export',
      'audit_export',
      p_request_id,
      NULL,
      jsonb_build_object(
        'filters', canonical_filters,
        'row_count', exported_row_count,
        'row_set_sha256', exported_row_set_sha256
      ),
      'P7A audit export requested',
      p_request_id
    );
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Audit export request UUID is already in use'
        USING ERRCODE = '22023';
  END;

  INSERT INTO platform_private.audit_export_replays (
    request_id,
    organization_id,
    actor_profile_id,
    actor_membership_id,
    canonical_request,
    filters,
    requested_snapshot_created_at,
    requested_snapshot_id,
    snapshot_created_at,
    snapshot_id,
    audit_event_ids,
    row_count,
    row_set_sha256,
    export_audit_event_id
  )
  VALUES (
    p_request_id,
    actor.organization_id,
    actor.profile_id,
    actor.membership_id,
    canonical_request,
    canonical_filters,
    p_snapshot_created_at,
    p_snapshot_id,
    resolved_snapshot_created_at,
    resolved_snapshot_id,
    exported_event_ids,
    exported_row_count,
    exported_row_set_sha256,
    export_audit_event_id
  );

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'filters', canonical_filters,
    'snapshot_created_at',
      platform_private.p7a_utc_timestamp(resolved_snapshot_created_at),
    'snapshot_id', resolved_snapshot_id,
    'row_count', exported_row_count,
    'row_set_sha256', exported_row_set_sha256,
    'rows', rows_payload
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_normalize_audit_filter(
  TEXT[], TEXT[], TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_utc_timestamp(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_changed_field_codes(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_row(
  platform.audit_events
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_require_audit_admin()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION platform.search_audit_events(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT[],
  TEXT[],
  UUID,
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  TIMESTAMPTZ,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.search_audit_events(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT[],
  TEXT[],
  UUID,
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  TIMESTAMPTZ,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.export_audit_events(
  UUID,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT[],
  TEXT[],
  UUID,
  TIMESTAMPTZ,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.export_audit_events(
  UUID,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT[],
  TEXT[],
  UUID,
  TIMESTAMPTZ,
  UUID
) TO authenticated;

COMMENT ON TABLE platform_private.audit_export_replays IS
  'Private append-only P7A export replay receipt and ordered audit UUID ledger; stores no exported row content.';
COMMENT ON FUNCTION platform.search_audit_events(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT[],
  TEXT[],
  UUID,
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  TIMESTAMPTZ,
  UUID
) IS
  'Actor-derived Admin-only immutable-snapshot Platform audit search with a fixed safe DTO.';
COMMENT ON FUNCTION platform.export_audit_events(
  UUID,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT[],
  TEXT[],
  UUID,
  TIMESTAMPTZ,
  UUID
) IS
  'Actor-derived Admin-only capped audit export with exact private replay and one audit.export event.';

COMMIT;
