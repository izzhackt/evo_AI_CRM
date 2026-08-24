-- ============================================================
-- 086_platform_sales_workflow.sql
--
-- U4: bounded Sales qualification, owner and next-action workflow for the
-- canonical EVO lead. This migration does not send provider messages, write
-- amoCRM, create contract evidence, or activate a managed environment.
-- ============================================================

BEGIN;

-- Abort before changing canonical truth if a stage exists that U4 cannot
-- explain. The only legacy normalization owned by this slice is U3's
-- new_inbound value.
DO $$
DECLARE
  unexpected_stage_keys TEXT;
BEGIN
  SELECT pg_catalog.string_agg(stage.stage_key, ', ' ORDER BY stage.stage_key)
  INTO unexpected_stage_keys
  FROM (
    SELECT DISTINCT lead.stage_key
    FROM platform.leads AS lead
    WHERE lead.stage_key NOT IN (
      'new',
      'contacting',
      'qualified',
      'meeting_scheduled',
      'meeting_completed',
      'potential',
      'new_inbound'
    )
  ) AS stage;

  IF unexpected_stage_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'U4 stage preflight failed; unsupported stage_key values: %',
      unexpected_stage_keys
      USING ERRCODE = '23514';
  END IF;
END
$$;

ALTER TABLE platform.leads
  ADD COLUMN next_action_text TEXT,
  ADD COLUMN next_action_due_date DATE,
  ADD COLUMN workflow_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE platform.leads
  ADD CONSTRAINT leads_workflow_version_positive_check
    CHECK (workflow_version > 0),
  ADD CONSTRAINT leads_next_action_pair_check
    CHECK (
      (next_action_text IS NULL AND next_action_due_date IS NULL)
      OR (
        next_action_text IS NOT NULL
        AND next_action_due_date IS NOT NULL
      )
    ),
  ADD CONSTRAINT leads_next_action_text_check
    CHECK (
      next_action_text IS NULL
      OR (
        next_action_text = pg_catalog.btrim(next_action_text)
        AND pg_catalog.length(next_action_text) BETWEEN 1 AND 500
      )
    );

ALTER TABLE platform.audit_events
  ADD COLUMN actor_membership_id UUID,
  ADD COLUMN resulting_version BIGINT,
  ADD CONSTRAINT audit_events_actor_membership_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT audit_events_actor_membership_kind_check
    CHECK (actor_membership_id IS NULL OR actor_kind = 'user'),
  ADD CONSTRAINT audit_events_resulting_version_check
    CHECK (resulting_version IS NULL OR resulting_version > 0);

CREATE INDEX audit_events_actor_membership_idx
  ON platform.audit_events (
    organization_id,
    actor_membership_id,
    created_at DESC
  )
  WHERE actor_membership_id IS NOT NULL;

CREATE TEMPORARY TABLE u4_stage_normalizations
ON COMMIT DROP
AS
SELECT
  lead.organization_id,
  lead.id AS lead_id,
  lead.stage_key AS previous_stage_key,
  lead.workflow_version AS previous_workflow_version,
  pg_catalog.gen_random_uuid() AS request_id
FROM platform.leads AS lead
WHERE lead.stage_key = 'new_inbound';

UPDATE platform.leads AS lead
SET
  stage_key = 'new',
  workflow_version = lead.workflow_version + 1
FROM u4_stage_normalizations AS normalization
WHERE lead.organization_id = normalization.organization_id
  AND lead.id = normalization.lead_id;

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
  request_id,
  resulting_version
)
SELECT
  normalization.organization_id,
  'system',
  NULL,
  'migration:086_platform_sales_workflow',
  'lead.sales.stage.normalized',
  'lead',
  normalization.lead_id,
  pg_catalog.jsonb_build_object(
    'stage_key', normalization.previous_stage_key,
    'workflow_version', normalization.previous_workflow_version
  ),
  pg_catalog.jsonb_build_object(
    'stage_key', lead.stage_key,
    'workflow_version', lead.workflow_version
  ),
  'U4 normalizes the sole U3 legacy Sales stage',
  normalization.request_id,
  lead.workflow_version
FROM u4_stage_normalizations AS normalization
JOIN platform.leads AS lead
  ON lead.organization_id = normalization.organization_id
  AND lead.id = normalization.lead_id;

ALTER TABLE platform.leads
  ADD CONSTRAINT leads_u4_stage_key_check CHECK (
    stage_key IN (
      'new',
      'contacting',
      'qualified',
      'meeting_scheduled',
      'meeting_completed',
      'potential'
    )
  );

CREATE INDEX leads_sales_due_page_idx
  ON platform.leads (
    organization_id,
    next_action_due_date,
    updated_at DESC,
    id DESC
  )
  WHERE next_action_due_date IS NOT NULL;

CREATE INDEX leads_sales_unassigned_page_idx
  ON platform.leads (organization_id, updated_at DESC, id DESC)
  WHERE current_owner_membership_id IS NULL;

-- The receipt is the durable idempotency identity for one committed U4
-- mutation. It is private, forced-RLS and append-only; browser callers have no
-- direct table privilege or policy.
CREATE TABLE platform_private.sales_lead_workflow_receipts (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  expected_workflow_version BIGINT NOT NULL
    CHECK (expected_workflow_version > 0),
  desired_stage_key TEXT NOT NULL CHECK (
    desired_stage_key IN (
      'new',
      'contacting',
      'qualified',
      'meeting_scheduled',
      'meeting_completed',
      'potential'
    )
  ),
  desired_owner_membership_id UUID,
  desired_next_action_text TEXT,
  desired_next_action_due_date DATE,
  clear_next_action BOOLEAN NOT NULL,
  requested_reason TEXT CHECK (
    requested_reason IS NULL
    OR (
      requested_reason = pg_catalog.btrim(requested_reason)
      AND pg_catalog.length(requested_reason) BETWEEN 1 AND 500
    )
  ),
  resulting_workflow_version BIGINT NOT NULL
    CHECK (resulting_workflow_version > 0),
  result JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT sales_lead_workflow_receipts_actor_fkey
    FOREIGN KEY (
      organization_id,
      actor_membership_id,
      actor_profile_id
    )
    REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT sales_lead_workflow_receipts_lead_fkey
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_lead_workflow_receipts_owner_fkey
    FOREIGN KEY (organization_id, desired_owner_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_lead_workflow_receipts_action_pair_check CHECK (
    (
      clear_next_action
      AND desired_next_action_text IS NULL
      AND desired_next_action_due_date IS NULL
    )
    OR (
      NOT clear_next_action
      AND desired_next_action_text IS NOT NULL
      AND desired_next_action_due_date IS NOT NULL
    )
  ),
  CONSTRAINT sales_lead_workflow_receipts_action_text_check CHECK (
    desired_next_action_text IS NULL
    OR (
      desired_next_action_text = pg_catalog.btrim(desired_next_action_text)
      AND pg_catalog.length(desired_next_action_text) BETWEEN 1 AND 500
    )
  )
);

CREATE INDEX sales_lead_workflow_receipts_lead_created_idx
  ON platform_private.sales_lead_workflow_receipts (
    organization_id,
    lead_id,
    created_at DESC
  );

CREATE INDEX sales_lead_workflow_receipts_actor_created_idx
  ON platform_private.sales_lead_workflow_receipts (
    organization_id,
    actor_membership_id,
    created_at DESC
  );

ALTER TABLE platform_private.sales_lead_workflow_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.sales_lead_workflow_receipts
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER sales_lead_workflow_receipts_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.sales_lead_workflow_receipts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER sales_lead_workflow_receipts_no_truncate
  BEFORE TRUNCATE
  ON platform_private.sales_lead_workflow_receipts
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

REVOKE ALL ON TABLE platform_private.sales_lead_workflow_receipts
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Immutable v13 bundles clone the complete published v12 catalog, then add
-- only the U4 command permissions.
INSERT INTO platform.permission_definitions (permission_key, description)
VALUES
  (
    'lead.sales.workflow.manage',
    'Read and change the bounded U4 Sales workflow on visible canonical leads'
  ),
  (
    'lead.sales.owner.assign',
    'Assign, reassign or unassign an eligible Sales owner as an active Admin'
  );

INSERT INTO platform.role_bundle_versions (id, role, version, status, label)
VALUES
  (
    '00000000-0000-4000-8000-000000001301',
    'admin', 13, 'draft', 'Admin v13 Sales workflow'
  ),
  (
    '00000000-0000-4000-8000-000000001302',
    'sales', 13, 'draft', 'Sales v13 bounded workflow'
  ),
  (
    '00000000-0000-4000-8000-000000001303',
    'curator', 13, 'draft', 'Curator v13 unchanged'
  ),
  (
    '00000000-0000-4000-8000-000000001304',
    'finance', 13, 'draft', 'Finance v13 unchanged'
  ),
  (
    '00000000-0000-4000-8000-000000001305',
    'student', 13, 'draft', 'Student v13 unchanged'
  );

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT v13.id, v13.role, v12_permission.permission_key
FROM platform.role_bundle_versions AS v13
JOIN platform.role_bundle_versions AS v12
  ON v12.role = v13.role
  AND v12.version = 12
  AND v12.status = 'published'
JOIN platform.role_bundle_permissions AS v12_permission
  ON v12_permission.bundle_id = v12.id
  AND v12_permission.bundle_role = v12.role
WHERE v13.version = 13;

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT bundle.id, bundle.role, permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 13
  AND (
    (
      bundle.role IN ('admin', 'sales')
      AND permission.permission_key = 'lead.sales.workflow.manage'
    )
    OR (
      bundle.role = 'admin'
      AND permission.permission_key = 'lead.sales.owner.assign'
    )
  );

UPDATE platform.role_bundle_versions
SET status = 'published', published_at = pg_catalog.statement_timestamp()
WHERE version = 13;

CREATE TEMPORARY TABLE u4_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v13.id AS new_bundle_id,
  profile.access_version AS previous_access_version,
  COALESCE((
    SELECT MAX(history.role_version)
    FROM platform.membership_role_history AS history
    WHERE history.organization_id = membership.organization_id
      AND history.membership_id = membership.id
  ), 0) + 1 AS next_role_version,
  pg_catalog.gen_random_uuid() AS request_id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS v12
  ON v12.id = membership.current_bundle_id
  AND v12.role = membership."current_role"
  AND v12.version = 12
  AND v12.status = 'published'
JOIN platform.role_bundle_versions AS v13
  ON v13.role = membership."current_role"
  AND v13.version = 13
  AND v13.status = 'published'
WHERE membership.status = 'active'
  AND membership."current_role" IS NOT NULL
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
  'U4 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM u4_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM u4_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM u4_membership_bundle_upgrades AS upgrade
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
  'migration:086_platform_sales_workflow',
  'rbac.bundle.upgrade',
  'organization_membership',
  upgrade.membership_id,
  pg_catalog.jsonb_build_object(
    'role', upgrade.business_role,
    'bundle_id', upgrade.previous_bundle_id,
    'access_version', upgrade.previous_access_version
  ),
  pg_catalog.jsonb_build_object(
    'role', upgrade.business_role,
    'bundle_id', upgrade.new_bundle_id,
    'access_version', profile.access_version
  ),
  'U4 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM u4_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile
  ON profile.id = upgrade.profile_id;

-- Keep the verified receive-only U3 binding unchanged except for the new
-- canonical stage vocabulary. No provider-facing behavior is added here.
CREATE OR REPLACE FUNCTION platform_private.bind_waha_chat_to_canonical(
  p_organization_id UUID,
  p_binding_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  conversation platform.communication_conversations%ROWTYPE;
  payload JSONB;
  payload_chat_id TEXT;
  phone_digits TEXT;
  external_identity TEXT;
  source_ref TEXT;
  resolved_client_id UUID;
  resolved_lead_id UUID;
BEGIN
  IF p_organization_id IS NULL OR p_binding_id IS NULL THEN
    RAISE EXCEPTION 'WAHA canonical binding identity is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT candidate.*
  INTO binding
  FROM platform_private.waha_direct_chat_bindings AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_binding_id;

  IF binding.id IS NULL THEN
    RAISE EXCEPTION 'WAHA direct-chat binding is unavailable'
      USING ERRCODE = '23503';
  END IF;

  SELECT event.*
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = binding.organization_id
    AND event.id = binding.source_webhook_event_id;

  SELECT candidate.*
  INTO conversation
  FROM platform.communication_conversations AS candidate
  WHERE candidate.organization_id = binding.organization_id
    AND candidate.id = binding.conversation_id
  FOR UPDATE;

  payload := source_event.raw_payload -> 'payload';
  IF source_event.id IS NULL OR conversation.id IS NULL THEN
    RAISE EXCEPTION 'WAHA canonical source or conversation is unavailable'
      USING ERRCODE = '23503';
  END IF;

  IF source_event.provider <> 'waha'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type NOT IN ('message', 'message.any')
    OR pg_catalog.jsonb_typeof(payload) IS DISTINCT FROM 'object'
    OR payload -> 'fromMe' IS DISTINCT FROM 'false'::JSONB
    OR pg_catalog.lower(
      COALESCE(pg_catalog.btrim(payload ->> 'source'), '')
    ) = 'api'
  THEN
    RETURN;
  END IF;

  payload_chat_id := platform_private.normalize_waha_direct_chat_id(
    COALESCE(
      NULLIF(pg_catalog.btrim(payload ->> 'from'), ''),
      NULLIF(pg_catalog.btrim(payload ->> 'chatId'), ''),
      NULLIF(pg_catalog.btrim(payload #>> '{_data,from}'), ''),
      NULLIF(pg_catalog.btrim(payload #>> '{_data,id,remote}'), '')
    )
  );

  IF source_event.waha_session_name <> binding.waha_session_name
    OR payload_chat_id IS NULL
    OR payload_chat_id <> binding.normalized_chat_id
    OR conversation.waha_session_name <> binding.waha_session_name
  THEN
    RAISE EXCEPTION
      'Only one verified direct inbound WAHA intake may acquire canonical identity'
      USING ERRCODE = '23514';
  END IF;

  IF conversation.sales_authority_source <> 'platform_intake'
    OR conversation.queue <> 'sales'
    OR conversation.responsible_sales_membership_id IS NULL
  THEN
    RETURN;
  END IF;

  phone_digits := pg_catalog.regexp_replace(
    pg_catalog.split_part(binding.normalized_chat_id, '@', 1),
    '[^0-9]',
    '',
    'g'
  );
  IF phone_digits !~ '^[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'WAHA direct-chat phone identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  external_identity :=
    binding.waha_session_name || ':' || binding.normalized_chat_id;
  source_ref := 'waha-event:' || source_event.id::TEXT;

  resolved_client_id := platform_private.create_or_link_client(
    binding.organization_id,
    'WhatsApp ••••' || pg_catalog.right(phone_digits, 4),
    NULL,
    '+' || phone_digits,
    'waha',
    'direct_chat',
    external_identity,
    'webhook_verified',
    source_event.provider_occurred_at,
    NULL,
    source_ref
  );

  resolved_lead_id := platform_private.create_or_link_lead(
    binding.organization_id,
    resolved_client_id,
    conversation.responsible_sales_membership_id,
    'new',
    'whatsapp',
    'waha',
    'sales_intake',
    external_identity,
    'webhook_verified',
    source_event.provider_occurred_at,
    NULL,
    source_ref
  );

  IF (
    conversation.canonical_client_id IS NOT NULL
    AND conversation.canonical_client_id <> resolved_client_id
  ) OR (
    conversation.canonical_lead_id IS NOT NULL
    AND conversation.canonical_lead_id <> resolved_lead_id
  ) THEN
    RAISE EXCEPTION
      'Existing canonical conversation identity conflicts with exact WAHA identity'
      USING ERRCODE = '23514';
  END IF;

  UPDATE platform.communication_conversations AS target
  SET
    canonical_client_id = resolved_client_id,
    canonical_lead_id = resolved_lead_id
  WHERE target.organization_id = binding.organization_id
    AND target.id = binding.conversation_id
    AND (
      target.canonical_client_id IS DISTINCT FROM resolved_client_id
      OR target.canonical_lead_id IS DISTINCT FROM resolved_lead_id
    );
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.bind_waha_chat_to_canonical(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.is_eligible_sales_owner(
  p_organization_id UUID,
  p_membership_id UUID
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
      AND membership.id = p_membership_id
      AND membership.status = 'active'
      AND membership."current_role" = 'sales'
      AND profile.status = 'active'
      AND organization.status = 'active'
      AND bundle.status = 'published'
  )
$$;

REVOKE ALL ON FUNCTION
  platform_private.is_eligible_sales_owner(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.staff_sales_lead_detail(p_lead_id uuid)
 RETURNS TABLE(organization_id uuid, lead_id uuid, client_id uuid, client_display_name text, client_email text, client_phone text, current_owner_membership_id uuid, current_owner_display_name text, stage_key text, source_key text, lifecycle_state platform.lead_lifecycle_state, next_action_text text, next_action_due_date date, workflow_version bigint, is_connected boolean, open_duplicate_candidate_count bigint, linked_student_case_count bigint, linked_conversation_count bigint, created_at timestamp with time zone, updated_at timestamp with time zone, external_identifiers jsonb, provenance jsonb, linked_student_cases jsonb, linked_conversations jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor RECORD;
BEGIN
  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_workflow_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    lead.organization_id,
    lead.id,
    client.id,
    client.display_name,
    client.email,
    client.phone,
    lead.current_owner_membership_id,
    owner_profile.display_name,
    lead.stage_key,
    lead.source_key,
    lead.lifecycle_state,
    lead.next_action_text,
    lead.next_action_due_date,
    lead.workflow_version,
    EXISTS (
      SELECT 1
      FROM platform.communication_conversations AS direct_conversation
      WHERE direct_conversation.organization_id = lead.organization_id
        AND direct_conversation.canonical_lead_id = lead.id
    ),
    CASE
      WHEN client.id IS NULL THEN 0::BIGINT
      ELSE (
        SELECT pg_catalog.count(*)
        FROM platform_private.client_duplicate_candidates AS candidate
        WHERE candidate.organization_id = lead.organization_id
          AND candidate.status = 'open'
          AND client.id IN (
            candidate.left_client_id,
            candidate.right_client_id
          )
      )
    END,
    (
      SELECT pg_catalog.count(*)
      FROM platform.student_cases AS student_case
      WHERE student_case.organization_id = lead.organization_id
        AND (
          student_case.canonical_lead_id = lead.id
          OR (
            lead.client_id IS NOT NULL
            AND student_case.canonical_client_id = lead.client_id
          )
        )
        AND private.platform_can_read_student_case(
          student_case.organization_id,
          student_case.id
        )
    ),
    (
      SELECT pg_catalog.count(*)
      FROM platform.communication_conversations AS conversation
      WHERE conversation.organization_id = lead.organization_id
        AND (
          conversation.canonical_lead_id = lead.id
          OR (
            lead.client_id IS NOT NULL
            AND conversation.canonical_client_id = lead.client_id
          )
        )
        AND private.platform_can_read_communication_full(
          conversation.organization_id,
          conversation.id
        )
    ),
    lead.created_at,
    lead.updated_at,
    COALESCE(legacy.external_identifiers, '[]'::JSONB),
    COALESCE(legacy.provenance, '[]'::JSONB),
    COALESCE(legacy.linked_student_cases, '[]'::JSONB),
    COALESCE(legacy.linked_conversations, '[]'::JSONB)
  FROM platform.leads AS lead
  LEFT JOIN platform.clients AS client
    ON client.organization_id = lead.organization_id
    AND client.id = lead.client_id
  LEFT JOIN platform.organization_memberships AS owner_membership
    ON owner_membership.organization_id = lead.organization_id
    AND owner_membership.id = lead.current_owner_membership_id
  LEFT JOIN platform.profiles AS owner_profile
    ON owner_profile.id = owner_membership.profile_id
  LEFT JOIN LATERAL (
    SELECT
      detail.external_identifiers,
      detail.provenance,
      detail.linked_student_cases,
      detail.linked_conversations
    FROM platform.staff_canonical_lead_detail(lead.id) AS detail
    LIMIT 1
  ) AS legacy ON TRUE
  WHERE lead.organization_id = actor.organization_id
    AND lead.id = p_lead_id
    AND lead.lifecycle_state = 'open'
    AND (
      actor.platform_role = 'admin'
      OR lead.current_owner_membership_id = actor.membership_id
      OR lead.current_owner_membership_id IS NULL
    )
  LIMIT 1;
END
$function$;


CREATE OR REPLACE FUNCTION platform.staff_sales_owner_options(
  p_limit INTEGER,
  p_cursor_label TEXT DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_query TEXT DEFAULT NULL
)
 RETURNS TABLE(sort_label text, membership_id uuid, display_label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor RECORD;
  normalized_cursor_label TEXT;
  normalized_query TEXT;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'sales_workflow_invalid_limit'
      USING ERRCODE = '22023';
  END IF;

  IF (p_cursor_label IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'sales_workflow_incomplete_owner_cursor'
      USING ERRCODE = '22023';
  END IF;

  IF p_cursor_label IS NOT NULL
    AND pg_catalog.btrim(p_cursor_label) = ''
  THEN
    RAISE EXCEPTION 'sales_workflow_incomplete_owner_cursor'
      USING ERRCODE = '22023';
  END IF;

  IF p_query IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(p_query)) > 200
  THEN
    RAISE EXCEPTION 'sales_workflow_query_too_long'
      USING ERRCODE = '22023';
  END IF;

  normalized_cursor_label := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(p_cursor_label)),
    ''
  );
  normalized_query := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(p_query)),
    ''
  );

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_workflow_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    pg_catalog.lower(pg_catalog.btrim(profile.display_name)),
    membership.id,
    profile.display_name
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  WHERE membership.organization_id = actor.organization_id
    AND platform_private.is_eligible_sales_owner(
      membership.organization_id,
      membership.id
    )
    AND (
      actor.platform_role = 'admin'
      OR membership.id = actor.membership_id
    )
    AND (
      normalized_query IS NULL
      OR pg_catalog.strpos(
        pg_catalog.lower(profile.display_name),
        normalized_query
      ) > 0
      OR membership.id::TEXT = normalized_query
    )
    AND (
      normalized_cursor_label IS NULL
      OR (
        pg_catalog.lower(pg_catalog.btrim(profile.display_name)),
        membership.id
      ) > (normalized_cursor_label, p_cursor_id)
    )
  ORDER BY
    pg_catalog.lower(pg_catalog.btrim(profile.display_name)) ASC,
    membership.id ASC
  LIMIT p_limit;
END
$function$;


CREATE OR REPLACE FUNCTION platform.staff_sales_lead_page(
  p_limit INTEGER,
  p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_connection_filter TEXT DEFAULT 'all',
  p_stage_filter TEXT DEFAULT NULL,
  p_assignment_filter TEXT DEFAULT 'all',
  p_owner_membership_id UUID DEFAULT NULL,
  p_due_filter TEXT DEFAULT 'all',
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  lead_id UUID,
  client_id UUID,
  client_display_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  current_owner_membership_id UUID,
  current_owner_display_name TEXT,
  stage_key TEXT,
  source_key TEXT,
  lifecycle_state platform.lead_lifecycle_state,
  next_action_text TEXT,
  next_action_due_date DATE,
  workflow_version BIGINT,
  is_connected BOOLEAN,
  open_duplicate_candidate_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_connection_filter TEXT;
  normalized_stage_filter TEXT;
  normalized_assignment_filter TEXT;
  normalized_due_filter TEXT;
  normalized_query TEXT;
  bishkek_today DATE;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'sales_workflow_invalid_limit'
      USING ERRCODE = '22023';
  END IF;

  IF (p_cursor_updated_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'sales_workflow_incomplete_cursor'
      USING ERRCODE = '22023';
  END IF;

  IF p_query IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(p_query)) > 200
  THEN
    RAISE EXCEPTION 'sales_workflow_query_too_long'
      USING ERRCODE = '22023';
  END IF;

  normalized_connection_filter := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_connection_filter)), ''),
    'all'
  );
  normalized_stage_filter := COALESCE(
    NULLIF(pg_catalog.btrim(p_stage_filter), ''),
    'all'
  );
  normalized_assignment_filter := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_assignment_filter)), ''),
    'all'
  );
  normalized_due_filter := COALESCE(
    NULLIF(pg_catalog.lower(pg_catalog.btrim(p_due_filter)), ''),
    'all'
  );
  normalized_query := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(p_query)),
    ''
  );

  IF normalized_connection_filter NOT IN (
    'all', 'connected', 'unconnected'
  ) THEN
    RAISE EXCEPTION 'sales_workflow_invalid_connection_filter'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_stage_filter <> 'all'
    AND normalized_stage_filter NOT IN (
      'new',
      'contacting',
      'qualified',
      'meeting_scheduled',
      'meeting_completed',
      'potential'
    )
  THEN
    RAISE EXCEPTION 'sales_workflow_invalid_stage_filter'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_assignment_filter NOT IN ('all', 'mine', 'unassigned') THEN
    RAISE EXCEPTION 'sales_workflow_invalid_assignment_filter'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_due_filter NOT IN (
    'all', 'scheduled', 'unscheduled', 'due_today', 'overdue'
  ) THEN
    RAISE EXCEPTION 'sales_workflow_invalid_due_filter'
      USING ERRCODE = '22023';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_workflow_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_membership_id IS NOT NULL
    AND (
      actor.platform_role <> 'admin'
      OR NOT platform_private.is_eligible_sales_owner(
        actor.organization_id,
        p_owner_membership_id
      )
    )
  THEN
    RAISE EXCEPTION 'sales_workflow_invalid_owner_filter'
      USING ERRCODE = '22023';
  END IF;

  bishkek_today := pg_catalog.timezone(
    'Asia/Bishkek',
    pg_catalog.statement_timestamp()
  )::DATE;

  RETURN QUERY
  WITH visible AS MATERIALIZED (
    SELECT
      lead.updated_at AS sort_at,
      lead.organization_id,
      lead.id AS lead_id,
      client.id AS client_id,
      client.display_name AS client_display_name,
      client.email AS client_email,
      client.phone AS client_phone,
      lead.current_owner_membership_id,
      owner_profile.display_name AS current_owner_display_name,
      lead.stage_key,
      lead.source_key,
      lead.lifecycle_state,
      lead.next_action_text,
      lead.next_action_due_date,
      lead.workflow_version,
      EXISTS (
        SELECT 1
        FROM platform.communication_conversations AS direct_conversation
        WHERE direct_conversation.organization_id = lead.organization_id
          AND direct_conversation.canonical_lead_id = lead.id
      ) AS is_connected,
      CASE
        WHEN client.id IS NULL THEN 0::BIGINT
        ELSE (
          SELECT pg_catalog.count(*)
          FROM platform_private.client_duplicate_candidates AS candidate
          WHERE candidate.organization_id = lead.organization_id
            AND candidate.status = 'open'
            AND client.id IN (
              candidate.left_client_id,
              candidate.right_client_id
            )
        )
      END AS open_duplicate_candidate_count,
      (
        SELECT pg_catalog.count(*)
        FROM platform.student_cases AS student_case
        WHERE student_case.organization_id = lead.organization_id
          AND (
            student_case.canonical_lead_id = lead.id
            OR (
              lead.client_id IS NOT NULL
              AND student_case.canonical_client_id = lead.client_id
            )
          )
          AND private.platform_can_read_student_case(
            student_case.organization_id,
            student_case.id
          )
      ) AS linked_student_case_count,
      (
        SELECT pg_catalog.count(*)
        FROM platform.communication_conversations AS conversation
        WHERE conversation.organization_id = lead.organization_id
          AND (
            conversation.canonical_lead_id = lead.id
            OR (
              lead.client_id IS NOT NULL
              AND conversation.canonical_client_id = lead.client_id
            )
          )
          AND private.platform_can_read_communication_full(
            conversation.organization_id,
            conversation.id
          )
      ) AS linked_conversation_count,
      lead.created_at,
      lead.updated_at
    FROM platform.leads AS lead
    LEFT JOIN platform.clients AS client
      ON client.organization_id = lead.organization_id
      AND client.id = lead.client_id
    LEFT JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = lead.organization_id
      AND owner_membership.id = lead.current_owner_membership_id
    LEFT JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
    WHERE lead.organization_id = actor.organization_id
      AND lead.lifecycle_state = 'open'
      AND (
        actor.platform_role = 'admin'
        OR lead.current_owner_membership_id = actor.membership_id
        OR lead.current_owner_membership_id IS NULL
      )
      AND (
        normalized_stage_filter = 'all'
        OR lead.stage_key = normalized_stage_filter
      )
      AND (
        normalized_assignment_filter = 'all'
        OR (
          normalized_assignment_filter = 'mine'
          AND lead.current_owner_membership_id = actor.membership_id
        )
        OR (
          normalized_assignment_filter = 'unassigned'
          AND lead.current_owner_membership_id IS NULL
        )
      )
      AND (
        p_owner_membership_id IS NULL
        OR lead.current_owner_membership_id = p_owner_membership_id
      )
      AND (
        normalized_due_filter = 'all'
        OR (
          normalized_due_filter = 'scheduled'
          AND lead.next_action_due_date IS NOT NULL
        )
        OR (
          normalized_due_filter = 'unscheduled'
          AND lead.next_action_due_date IS NULL
        )
        OR (
          normalized_due_filter = 'due_today'
          AND lead.next_action_due_date = bishkek_today
        )
        OR (
          normalized_due_filter = 'overdue'
          AND lead.next_action_due_date < bishkek_today
        )
      )
      AND (
        normalized_query IS NULL
        OR pg_catalog.strpos(
          pg_catalog.lower(
            pg_catalog.concat_ws(
              ' ',
              client.display_name,
              client.email,
              client.phone,
              owner_profile.display_name,
              lead.id::TEXT,
              lead.stage_key,
              lead.source_key,
              lead.next_action_text
            )
          ),
          normalized_query
        ) > 0
      )
  )
  SELECT
    visible.sort_at,
    visible.organization_id,
    visible.lead_id,
    visible.client_id,
    visible.client_display_name,
    visible.client_email,
    visible.client_phone,
    visible.current_owner_membership_id,
    visible.current_owner_display_name,
    visible.stage_key,
    visible.source_key,
    visible.lifecycle_state,
    visible.next_action_text,
    visible.next_action_due_date,
    visible.workflow_version,
    visible.is_connected,
    visible.open_duplicate_candidate_count,
    visible.linked_student_case_count,
    visible.linked_conversation_count,
    visible.created_at,
    visible.updated_at
  FROM visible
  WHERE (
      normalized_connection_filter = 'all'
      OR (
        normalized_connection_filter = 'connected'
        AND visible.is_connected
      )
      OR (
        normalized_connection_filter = 'unconnected'
        AND NOT visible.is_connected
      )
    )
    AND (
      p_cursor_updated_at IS NULL
      OR (visible.sort_at, visible.lead_id)
        < (p_cursor_updated_at, p_cursor_id)
    )
  ORDER BY visible.sort_at DESC, visible.lead_id DESC
  LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION platform.mutate_sales_lead_workflow(p_lead_id uuid, p_expected_workflow_version bigint, p_request_id uuid, p_stage_key text, p_owner_membership_id uuid, p_next_action_text text, p_next_action_due_date date, p_clear_next_action boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor RECORD;
  lead_record RECORD;
  prior_receipt RECORD;
  normalized_next_action_text TEXT;
  normalized_reason TEXT;
  effective_reason TEXT;
  owner_changed BOOLEAN;
  stage_changed BOOLEAN;
  next_action_changed BOOLEAN;
  action_removed BOOLEAN;
  changed_at TIMESTAMPTZ;
  next_workflow_version BIGINT;
  before_state JSONB;
  after_state JSONB;
  result JSONB;
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'workflow_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id_conflict'
      USING ERRCODE = '23505';
  END IF;

  IF p_expected_workflow_version IS NULL
    OR p_expected_workflow_version < 1
  THEN
    RAISE EXCEPTION 'workflow_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  IF p_stage_key IS NULL OR p_stage_key NOT IN (
    'new',
    'contacting',
    'qualified',
    'meeting_scheduled',
    'meeting_completed',
    'potential'
  ) THEN
    RAISE EXCEPTION 'workflow_invalid_stage'
      USING ERRCODE = '22023';
  END IF;

  IF p_clear_next_action IS NULL THEN
    RAISE EXCEPTION 'workflow_invalid_next_action'
      USING ERRCODE = '22023';
  END IF;

  normalized_next_action_text := NULLIF(
    pg_catalog.btrim(p_next_action_text),
    ''
  );
  normalized_reason := NULLIF(pg_catalog.btrim(p_reason), '');

  IF p_reason IS NOT NULL
    AND pg_catalog.length(pg_catalog.btrim(p_reason)) > 500
  THEN
    RAISE EXCEPTION 'workflow_reason_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_clear_next_action THEN
    IF p_next_action_text IS NOT NULL OR p_next_action_due_date IS NOT NULL THEN
      RAISE EXCEPTION 'workflow_invalid_next_action'
        USING ERRCODE = '22023';
    END IF;
    normalized_next_action_text := NULL;
  ELSE
    IF normalized_next_action_text IS NULL
      OR p_next_action_due_date IS NULL
      OR pg_catalog.length(normalized_next_action_text) > 500
    THEN
      RAISE EXCEPTION 'workflow_invalid_next_action'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'sales')
    AND private.platform_has_permission(
      authority.organization_id,
      'lead.sales.workflow.manage'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'u4:sales-lead-workflow:' || p_request_id::TEXT,
      0
    )
  );

  SELECT receipt.*
  INTO prior_receipt
  FROM platform_private.sales_lead_workflow_receipts AS receipt
  WHERE receipt.request_id = p_request_id;

  IF FOUND THEN
    IF prior_receipt.organization_id IS DISTINCT FROM actor.organization_id
      OR prior_receipt.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR prior_receipt.actor_profile_id IS DISTINCT FROM actor.profile_id
      OR prior_receipt.lead_id IS DISTINCT FROM p_lead_id
      OR prior_receipt.expected_workflow_version IS DISTINCT FROM
        p_expected_workflow_version
      OR prior_receipt.desired_stage_key IS DISTINCT FROM p_stage_key
      OR prior_receipt.desired_owner_membership_id IS DISTINCT FROM
        p_owner_membership_id
      OR prior_receipt.desired_next_action_text IS DISTINCT FROM
        normalized_next_action_text
      OR prior_receipt.desired_next_action_due_date IS DISTINCT FROM
        p_next_action_due_date
      OR prior_receipt.clear_next_action IS DISTINCT FROM p_clear_next_action
      OR prior_receipt.requested_reason IS DISTINCT FROM normalized_reason
    THEN
      RAISE EXCEPTION 'request_id_conflict'
        USING ERRCODE = '23505';
    END IF;

    RETURN prior_receipt.result;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'request_id_conflict'
      USING ERRCODE = '23505';
  END IF;

  SELECT candidate.*
  INTO lead_record
  FROM platform.leads AS candidate
  WHERE candidate.organization_id = actor.organization_id
    AND candidate.id = p_lead_id
    AND (
      actor.platform_role = 'admin'
      OR candidate.current_owner_membership_id = actor.membership_id
      OR candidate.current_owner_membership_id IS NULL
    )
  FOR UPDATE;

  IF NOT FOUND OR lead_record.lifecycle_state <> 'open' THEN
    RAISE EXCEPTION 'workflow_not_found_or_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF lead_record.workflow_version <> p_expected_workflow_version THEN
    RAISE EXCEPTION 'workflow_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;

  owner_changed := lead_record.current_owner_membership_id IS DISTINCT FROM
    p_owner_membership_id;
  stage_changed := lead_record.stage_key IS DISTINCT FROM p_stage_key;
  next_action_changed :=
    lead_record.next_action_text IS DISTINCT FROM normalized_next_action_text
    OR lead_record.next_action_due_date IS DISTINCT FROM
      p_next_action_due_date;

  IF actor.platform_role = 'sales' THEN
    IF (
      lead_record.current_owner_membership_id IS NULL
      AND p_owner_membership_id IS DISTINCT FROM actor.membership_id
    ) OR (
      lead_record.current_owner_membership_id = actor.membership_id
      AND p_owner_membership_id IS DISTINCT FROM actor.membership_id
    ) THEN
      RAISE EXCEPTION 'workflow_invalid_owner'
        USING ERRCODE = '22023';
    END IF;
  ELSIF owner_changed THEN
    IF NOT private.platform_has_permission(
      actor.organization_id,
      'lead.sales.owner.assign'
    ) OR (
      p_owner_membership_id IS NOT NULL
      AND NOT platform_private.is_eligible_sales_owner(
        actor.organization_id,
        p_owner_membership_id
      )
    ) THEN
      RAISE EXCEPTION 'workflow_invalid_owner'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NOT owner_changed AND NOT stage_changed AND NOT next_action_changed THEN
    RAISE EXCEPTION 'workflow_no_change'
      USING ERRCODE = '22000';
  END IF;

  action_removed := lead_record.next_action_text IS NOT NULL
    AND normalized_next_action_text IS NULL;

  IF (
    actor.platform_role = 'admin'
    AND owner_changed
    AND lead_record.current_owner_membership_id IS NOT NULL
    AND normalized_reason IS NULL
  ) OR (
    action_removed
    AND normalized_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'workflow_reason_required'
      USING ERRCODE = '22023';
  END IF;

  effective_reason := COALESCE(
    normalized_reason,
    'sales_workflow_update'
  );

  before_state := pg_catalog.jsonb_build_object(
    'stage_key', lead_record.stage_key,
    'current_owner_membership_id',
      lead_record.current_owner_membership_id,
    'next_action_text', lead_record.next_action_text,
    'next_action_due_date', lead_record.next_action_due_date,
    'workflow_version', lead_record.workflow_version
  );

  UPDATE platform.leads AS target
  SET
    stage_key = p_stage_key,
    current_owner_membership_id = p_owner_membership_id,
    next_action_text = normalized_next_action_text,
    next_action_due_date = p_next_action_due_date,
    workflow_version = target.workflow_version + 1
  WHERE target.organization_id = actor.organization_id
    AND target.id = lead_record.id
  RETURNING target.workflow_version, target.updated_at
  INTO next_workflow_version, changed_at;

  result := pg_catalog.jsonb_build_object(
    'request_id', p_request_id,
    'organization_id', actor.organization_id,
    'lead_id', lead_record.id,
    'stage_key', p_stage_key,
    'current_owner_membership_id', p_owner_membership_id,
    'next_action_text', normalized_next_action_text,
    'next_action_due_date', p_next_action_due_date,
    'workflow_version', next_workflow_version,
    'changed_at', changed_at
  );

  after_state := pg_catalog.jsonb_build_object(
    'stage_key', p_stage_key,
    'current_owner_membership_id', p_owner_membership_id,
    'next_action_text', normalized_next_action_text,
    'next_action_due_date', p_next_action_due_date,
    'workflow_version', next_workflow_version
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
    request_id,
    created_at,
    actor_membership_id,
    resulting_version
  ) VALUES (
    actor.organization_id,
    'user',
    actor.profile_id,
    'auth:' || actor.auth_user_id::TEXT,
    'lead.sales.workflow.changed',
    'lead',
    lead_record.id,
    before_state,
    after_state,
    effective_reason,
    p_request_id,
    changed_at,
    actor.membership_id,
    next_workflow_version
  );

  INSERT INTO platform_private.sales_lead_workflow_receipts (
    request_id,
    organization_id,
    actor_membership_id,
    actor_profile_id,
    lead_id,
    expected_workflow_version,
    desired_stage_key,
    desired_owner_membership_id,
    desired_next_action_text,
    desired_next_action_due_date,
    clear_next_action,
    requested_reason,
    resulting_workflow_version,
    result,
    created_at
  ) VALUES (
    p_request_id,
    actor.organization_id,
    actor.membership_id,
    actor.profile_id,
    lead_record.id,
    p_expected_workflow_version,
    p_stage_key,
    p_owner_membership_id,
    normalized_next_action_text,
    p_next_action_due_date,
    p_clear_next_action,
    normalized_reason,
    next_workflow_version,
    result,
    changed_at
  );

  RETURN result;
END
$function$;


REVOKE ALL ON FUNCTION
  platform.staff_sales_lead_page(
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    UUID,
    TEXT,
    TEXT
  ),
  platform.staff_sales_lead_detail(UUID),
  platform.staff_sales_owner_options(INTEGER, TEXT, UUID, TEXT),
  platform.mutate_sales_lead_workflow(
    UUID,
    BIGINT,
    UUID,
    TEXT,
    UUID,
    TEXT,
    DATE,
    BOOLEAN,
    TEXT
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.staff_sales_lead_page(
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    UUID,
    TEXT,
    TEXT
  ),
  platform.staff_sales_lead_detail(UUID),
  platform.staff_sales_owner_options(INTEGER, TEXT, UUID, TEXT),
  platform.mutate_sales_lead_workflow(
    UUID,
    BIGINT,
    UUID,
    TEXT,
    UUID,
    TEXT,
    DATE,
    BOOLEAN,
    TEXT
  )
TO authenticated;

COMMENT ON TABLE platform_private.sales_lead_workflow_receipts IS
  'Private append-only U4 idempotency receipts; no provider secrets or raw identifiers are stored.';
COMMENT ON FUNCTION platform.staff_sales_lead_page(
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT
) IS
  'Bounded role-scoped U4 Sales queue with pre-limit connected, stage, assignment, due and query filters.';
COMMENT ON FUNCTION platform.staff_sales_lead_detail(UUID) IS
  'One role-scoped canonical U4 Sales lead with workflow state and existing safe detail context.';
COMMENT ON FUNCTION platform.staff_sales_owner_options(
  INTEGER,
  TEXT,
  UUID,
  TEXT
) IS
  'Bounded active Sales-membership owner options; Sales sees self and Admin sees eligible organization Sales members.';
COMMENT ON FUNCTION platform.mutate_sales_lead_workflow(
  UUID,
  BIGINT,
  UUID,
  TEXT,
  UUID,
  TEXT,
  DATE,
  BOOLEAN,
  TEXT
) IS
  'Atomic version-checked U4 workflow mutation with exact receipt replay and one durable audit event.';

COMMENT ON FUNCTION platform_private.bind_waha_chat_to_canonical(UUID, UUID) IS
  'Atomically links one verified direct inbound WAHA binding to canonical EVO identity and seeds the U4 stage new.';

COMMIT;
