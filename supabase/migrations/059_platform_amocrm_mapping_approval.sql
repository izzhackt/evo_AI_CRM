-- ============================================================
-- 059_platform_amocrm_mapping_approval.sql
--
-- P4B: append-only, Admin-reviewed amoCRM mapping approval for the
-- existing Platform messaging seam.
--
-- This migration does not call amoCRM, store OAuth material, synchronize
-- provider identity, enqueue work or authorize canonical provider writes.
-- An approved row is local configuration evidence only.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION
  platform_private.amocrm_mapping_selected_bindings_is_well_formed(
    p_selected_bindings JSONB
  )
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  root_keys TEXT[];
  entry_keys TEXT[];
  binding_entry RECORD;
  seen_binding_keys TEXT[] := ARRAY[]::TEXT[];
  binding_key TEXT;
  field_id TEXT;
BEGIN
  IF p_selected_bindings IS NULL
    OR pg_catalog.pg_column_size(p_selected_bindings) > 65536
    OR pg_catalog.jsonb_typeof(p_selected_bindings) <> 'object'
  THEN
    RETURN FALSE;
  END IF;

  SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
  INTO root_keys
  FROM pg_catalog.jsonb_object_keys(p_selected_bindings) AS key_name;

  IF root_keys IS DISTINCT FROM ARRAY[
    'contact_custom_fields',
    'lead_custom_fields',
    'pipeline_id',
    'responsible_user_source',
    'signed_contract_status_id'
  ]::TEXT[]
    OR pg_catalog.jsonb_typeof(p_selected_bindings -> 'pipeline_id')
      <> 'string'
    OR p_selected_bindings ->> 'pipeline_id' !~ '^[1-9][0-9]*$'
    OR (p_selected_bindings ->> 'pipeline_id')::NUMERIC
      > 9223372036854775807
    OR pg_catalog.jsonb_typeof(
      p_selected_bindings -> 'signed_contract_status_id'
    ) <> 'string'
    OR p_selected_bindings ->> 'signed_contract_status_id'
      !~ '^[1-9][0-9]*$'
    OR (p_selected_bindings ->> 'signed_contract_status_id')::NUMERIC
      > 9223372036854775807
    OR p_selected_bindings ->> 'responsible_user_source'
      IS DISTINCT FROM 'lead.responsible_user_id'
    OR pg_catalog.jsonb_typeof(
      p_selected_bindings -> 'lead_custom_fields'
    ) <> 'array'
    OR pg_catalog.jsonb_typeof(
      p_selected_bindings -> 'contact_custom_fields'
    ) <> 'array'
    OR pg_catalog.jsonb_array_length(
      p_selected_bindings -> 'lead_custom_fields'
    ) NOT BETWEEN 1 AND 100
    OR pg_catalog.jsonb_array_length(
      p_selected_bindings -> 'contact_custom_fields'
    ) NOT BETWEEN 1 AND 100
  THEN
    RETURN FALSE;
  END IF;

  FOR binding_entry IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(
      p_selected_bindings -> 'lead_custom_fields'
    ) AS element(value)
    UNION ALL
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(
      p_selected_bindings -> 'contact_custom_fields'
    ) AS element(value)
  LOOP
    IF pg_catalog.jsonb_typeof(binding_entry.value) <> 'object' THEN
      RETURN FALSE;
    END IF;

    SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
    INTO entry_keys
    FROM pg_catalog.jsonb_object_keys(binding_entry.value) AS key_name;

    binding_key := binding_entry.value ->> 'binding_key';
    field_id := binding_entry.value ->> 'field_id';

    IF entry_keys IS DISTINCT FROM ARRAY[
      'binding_key',
      'field_id'
    ]::TEXT[]
      OR pg_catalog.jsonb_typeof(binding_entry.value -> 'binding_key')
        <> 'string'
      OR binding_key !~ '^[a-z][a-z0-9_.-]{0,63}$'
      OR pg_catalog.jsonb_typeof(binding_entry.value -> 'field_id')
        <> 'string'
      OR field_id !~ '^[1-9][0-9]*$'
      OR field_id::NUMERIC > 9223372036854775807
      OR binding_key = ANY (seen_binding_keys)
    THEN
      RETURN FALSE;
    END IF;

    seen_binding_keys := pg_catalog.array_append(
      seen_binding_keys,
      binding_key
    );
  END LOOP;

  RETURN platform_private.amocrm_mapping_json_is_safe(
    p_selected_bindings
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN FALSE;
END
$$;

CREATE OR REPLACE FUNCTION
  platform_private.normalize_amocrm_mapping_selected_bindings(
    p_selected_bindings JSONB
  )
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'pipeline_id', p_selected_bindings ->> 'pipeline_id',
    'signed_contract_status_id',
      p_selected_bindings ->> 'signed_contract_status_id',
    'responsible_user_source', 'lead.responsible_user_id',
    'lead_custom_fields', (
      SELECT pg_catalog.jsonb_agg(
        element.value ORDER BY element.value ->> 'binding_key'
      )
      FROM pg_catalog.jsonb_array_elements(
        p_selected_bindings -> 'lead_custom_fields'
      ) AS element(value)
    ),
    'contact_custom_fields', (
      SELECT pg_catalog.jsonb_agg(
        element.value ORDER BY element.value ->> 'binding_key'
      )
      FROM pg_catalog.jsonb_array_elements(
        p_selected_bindings -> 'contact_custom_fields'
      ) AS element(value)
    )
  )
$$;

ALTER TABLE platform_private.amocrm_mapping_discovery_versions
  ADD CONSTRAINT
    amocrm_mapping_discovery_versions_org_account_id_key
  UNIQUE (organization_id, amocrm_account_id, id);

CREATE TABLE platform_private.amocrm_mapping_approval_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  amocrm_account_id BIGINT NOT NULL CHECK (amocrm_account_id > 0),
  mapping_use TEXT NOT NULL DEFAULT 'messaging' CHECK (
    mapping_use = 'messaging'
  ),
  event_version BIGINT NOT NULL CHECK (event_version > 0),
  event_kind TEXT NOT NULL CHECK (
    event_kind IN ('approved', 'revoked')
  ),
  discovery_version_id UUID NOT NULL,
  selected_bindings JSONB NOT NULL CHECK (
    platform_private.amocrm_mapping_selected_bindings_is_well_formed(
      selected_bindings
    )
  ),
  prior_event_id UUID,
  decision_conversation_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    pg_catalog.btrim(reason) = reason
    AND pg_catalog.char_length(reason) BETWEEN 1 AND 1000
    AND reason !~ '[[:cntrl:]]'
  ),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT amocrm_mapping_approval_events_org_account_use_version_key
    UNIQUE (
      organization_id,
      amocrm_account_id,
      mapping_use,
      event_version
    ),
  CONSTRAINT amocrm_mapping_approval_events_org_account_use_id_key
    UNIQUE (
      organization_id,
      amocrm_account_id,
      mapping_use,
      id
    ),
  CONSTRAINT amocrm_mapping_approval_events_request_id_key
    UNIQUE (request_id),
  CONSTRAINT amocrm_mapping_approval_events_discovery_fkey
    FOREIGN KEY (
      organization_id,
      amocrm_account_id,
      discovery_version_id
    )
    REFERENCES platform_private.amocrm_mapping_discovery_versions(
      organization_id,
      amocrm_account_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_mapping_approval_events_prior_fkey
    FOREIGN KEY (
      organization_id,
      amocrm_account_id,
      mapping_use,
      prior_event_id
    )
    REFERENCES platform_private.amocrm_mapping_approval_events(
      organization_id,
      amocrm_account_id,
      mapping_use,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_mapping_approval_events_conversation_fkey
    FOREIGN KEY (organization_id, decision_conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_mapping_approval_events_actor_membership_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_mapping_approval_events_prior_shape_check CHECK (
    (event_version = 1 AND prior_event_id IS NULL)
    OR (event_version > 1 AND prior_event_id IS NOT NULL)
  )
);

CREATE INDEX amocrm_mapping_approval_events_discovery_idx
  ON platform_private.amocrm_mapping_approval_events (
    organization_id,
    amocrm_account_id,
    discovery_version_id
  );
CREATE INDEX amocrm_mapping_approval_events_prior_idx
  ON platform_private.amocrm_mapping_approval_events (
    organization_id,
    amocrm_account_id,
    mapping_use,
    prior_event_id
  )
  WHERE prior_event_id IS NOT NULL;
CREATE INDEX amocrm_mapping_approval_events_conversation_idx
  ON platform_private.amocrm_mapping_approval_events (
    organization_id,
    decision_conversation_id
  );
CREATE INDEX amocrm_mapping_approval_events_actor_profile_idx
  ON platform_private.amocrm_mapping_approval_events (actor_profile_id);
CREATE INDEX amocrm_mapping_approval_events_actor_membership_idx
  ON platform_private.amocrm_mapping_approval_events (
    organization_id,
    actor_membership_id
  );

ALTER TABLE platform_private.amocrm_mapping_approval_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.amocrm_mapping_approval_events
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER amocrm_mapping_approval_events_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.amocrm_mapping_approval_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER amocrm_mapping_approval_events_no_truncate
  BEFORE TRUNCATE
  ON platform_private.amocrm_mapping_approval_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- The inner query selects the latest event first. The outer predicate then
-- retains it only when it is approved. Filtering approved events before the
-- latest-event choice would incorrectly resurrect an approval after revoke.
CREATE VIEW platform_private.current_amocrm_mapping_selections AS
SELECT latest.*
FROM (
  SELECT DISTINCT ON (
    event.organization_id,
    event.amocrm_account_id,
    event.mapping_use
  )
    event.id AS approval_event_id,
    event.organization_id,
    event.amocrm_account_id,
    event.mapping_use,
    event.event_version,
    event.event_kind,
    event.discovery_version_id,
    event.selected_bindings,
    event.prior_event_id,
    event.decision_conversation_id,
    event.actor_profile_id,
    event.actor_membership_id,
    event.reason,
    event.request_id,
    event.created_at
  FROM platform_private.amocrm_mapping_approval_events AS event
  ORDER BY
    event.organization_id,
    event.amocrm_account_id,
    event.mapping_use,
    event.event_version DESC,
    event.id DESC
) AS latest
WHERE latest.event_kind = 'approved';

CREATE OR REPLACE FUNCTION
  platform_private.require_p4b_admin_conversation_actor(
    p_organization_id UUID,
    p_conversation_id UUID
  )
RETURNS TABLE (
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID,
  actor_role platform.business_role,
  amocrm_account_id BIGINT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  -- Keep authorization live for the whole decision transaction without
  -- serializing two Admin decisions behind FOR UPDATE. Shared row locks are
  -- compatible with another approval/revocation check, but still conflict
  -- with role, membership, organization, bundle or conversation mutation.
  SELECT
    profile.id AS actor_profile_id,
    membership.id AS actor_membership_id,
    profile.auth_user_id AS actor_auth_user_id,
    membership."current_role" AS actor_role,
    conversation.amocrm_account_id
  INTO actor
  FROM platform.profiles AS profile
  JOIN platform.organization_memberships AS membership
    ON membership.profile_id = profile.id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  JOIN platform.role_bundle_permissions AS bundle_permission
    ON bundle_permission.bundle_id = bundle.id
    AND bundle_permission.bundle_role = bundle.role
  JOIN platform.communication_conversations AS conversation
    ON conversation.organization_id = membership.organization_id
    AND conversation.id = p_conversation_id
  WHERE profile.auth_user_id = (SELECT auth.uid())
    AND profile.status = 'active'
    AND membership.organization_id = p_organization_id
    AND membership.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
    AND bundle_permission.permission_key = 'audit.read'
    AND membership."current_role" = 'admin'
    AND membership."current_role"::TEXT =
      (SELECT auth.jwt() ->> 'platform_role')
    AND profile.access_version::TEXT =
      (SELECT auth.jwt() ->> 'platform_access_version')
    AND platform_private.membership_has_active_scope(
      p_organization_id,
      membership.id,
      'organization',
      p_organization_id
    )
  FOR SHARE OF profile, membership, organization, bundle, conversation;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active organization Admin authority is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role,
    actor.amocrm_account_id;
END
$$;

CREATE OR REPLACE FUNCTION platform.amocrm_mapping_state_for_conversation(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  conversation_id UUID,
  mapping_use TEXT,
  mapping_state TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation_row platform.communication_conversations%ROWTYPE;
  latest_event platform_private.amocrm_mapping_approval_events%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Organization and conversation are required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT private.platform_can_read_communication_full(
    p_organization_id,
    p_conversation_id
  ) THEN
    RAISE EXCEPTION 'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT conversation.*
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id;

  SELECT event.*
  INTO latest_event
  FROM platform_private.amocrm_mapping_approval_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.amocrm_account_id = conversation_row.amocrm_account_id
    AND event.mapping_use = 'messaging'
  ORDER BY event.event_version DESC, event.id DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    p_organization_id,
    p_conversation_id,
    'messaging'::TEXT,
    CASE
      WHEN latest_event.event_kind = 'approved'
        THEN 'approved_configured_unverified'
      ELSE 'not_approved'
    END;
END
$$;

CREATE OR REPLACE FUNCTION
  platform.admin_amocrm_mapping_approval_workspace(
    p_organization_id UUID,
    p_conversation_id UUID,
    p_discovery_version_id UUID DEFAULT NULL
  )
RETURNS TABLE (
  organization_id UUID,
  conversation_id UUID,
  amocrm_account_id BIGINT,
  mapping_use TEXT,
  mapping_state TEXT,
  review_discovery_version_id UUID,
  review_discovery_version BIGINT,
  review_account_domain TEXT,
  review_account_subdomain TEXT,
  review_sanitized_snapshot JSONB,
  review_snapshot_sha256 TEXT,
  review_evidence_kind TEXT,
  review_evidence_ref TEXT,
  review_discovered_at TIMESTAMPTZ,
  current_event_id UUID,
  current_event_kind TEXT,
  current_discovery_version_id UUID,
  current_discovery_version BIGINT,
  current_selected_bindings JSONB,
  current_reason TEXT,
  current_actor_profile_id UUID,
  current_request_id UUID,
  current_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  conversation_row platform.communication_conversations%ROWTYPE;
  review_discovery
    platform_private.amocrm_mapping_discovery_versions%ROWTYPE;
  latest_event platform_private.amocrm_mapping_approval_events%ROWTYPE;
  latest_discovery_version BIGINT;
BEGIN
  IF p_organization_id IS NULL OR p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Organization and conversation are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'audit.read'
  ) AS authority;

  IF actor.actor_role IS DISTINCT FROM 'admin'
    OR NOT platform_private.membership_has_active_scope(
      p_organization_id,
      actor.actor_membership_id,
      'organization',
      p_organization_id
    )
  THEN
    RAISE EXCEPTION 'Active organization Admin authority is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT conversation.*
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT discovery.*
  INTO review_discovery
  FROM platform_private.amocrm_mapping_discovery_versions AS discovery
  WHERE discovery.organization_id = p_organization_id
    AND discovery.amocrm_account_id = conversation_row.amocrm_account_id
    AND (
      p_discovery_version_id IS NULL
      OR discovery.id = p_discovery_version_id
    )
  ORDER BY discovery.version DESC
  LIMIT 1;

  SELECT event.*
  INTO latest_event
  FROM platform_private.amocrm_mapping_approval_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.amocrm_account_id = conversation_row.amocrm_account_id
    AND event.mapping_use = 'messaging'
  ORDER BY event.event_version DESC, event.id DESC
  LIMIT 1;

  IF latest_event.id IS NOT NULL THEN
    SELECT discovery.version
    INTO latest_discovery_version
    FROM platform_private.amocrm_mapping_discovery_versions AS discovery
    WHERE discovery.organization_id = p_organization_id
      AND discovery.amocrm_account_id = conversation_row.amocrm_account_id
      AND discovery.id = latest_event.discovery_version_id;
  END IF;

  RETURN QUERY
  SELECT
    p_organization_id,
    p_conversation_id,
    conversation_row.amocrm_account_id,
    'messaging'::TEXT,
    CASE
      WHEN latest_event.event_kind = 'approved'
        THEN 'approved_configured_unverified'
      ELSE 'not_approved'
    END,
    review_discovery.id,
    review_discovery.version,
    review_discovery.account_domain,
    review_discovery.account_subdomain,
    review_discovery.sanitized_snapshot,
    review_discovery.snapshot_sha256,
    review_discovery.evidence_kind,
    review_discovery.evidence_ref,
    review_discovery.discovered_at,
    latest_event.id,
    latest_event.event_kind,
    latest_event.discovery_version_id,
    latest_discovery_version,
    latest_event.selected_bindings,
    latest_event.reason,
    latest_event.actor_profile_id,
    latest_event.request_id,
    latest_event.created_at;
END
$$;

CREATE OR REPLACE FUNCTION platform.approve_amocrm_mapping_selection(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_discovery_version_id UUID,
  p_selected_bindings JSONB,
  p_expected_prior_event_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS TABLE (
  approval_event_id UUID,
  organization_id UUID,
  amocrm_account_id BIGINT,
  mapping_use TEXT,
  event_version BIGINT,
  event_kind TEXT,
  discovery_version_id UUID,
  discovery_version BIGINT,
  selected_bindings JSONB,
  prior_event_id UUID,
  actor_profile_id UUID,
  reason TEXT,
  request_id UUID,
  created_at TIMESTAMPTZ,
  mapping_state TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_reason TEXT := pg_catalog.btrim(p_reason);
  normalized_bindings JSONB;
  discovery platform_private.amocrm_mapping_discovery_versions%ROWTYPE;
  existing_event platform_private.amocrm_mapping_approval_events%ROWTYPE;
  latest_event platform_private.amocrm_mapping_approval_events%ROWTYPE;
  stored_event platform_private.amocrm_mapping_approval_events%ROWTYPE;
  next_event_version BIGINT;
BEGIN
  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_discovery_version_id IS NULL
    OR p_request_id IS NULL
    OR normalized_reason IS NULL
    OR pg_catalog.char_length(normalized_reason) NOT BETWEEN 1 AND 1000
    OR normalized_reason ~ '[[:cntrl:]]'
    OR NOT platform_private.amocrm_mapping_selected_bindings_is_well_formed(
      p_selected_bindings
    )
  THEN
    RAISE EXCEPTION 'Complete bounded amoCRM mapping approval is required'
      USING ERRCODE = '22023';
  END IF;

  normalized_bindings :=
    platform_private.normalize_amocrm_mapping_selected_bindings(
      p_selected_bindings
    );

  -- Request-id is the first lock taken by every audited mutation in this
  -- database. Taking authority/member row locks first would invert the shared
  -- order used by other workflow RPCs and could deadlock on UUID reuse.
  PERFORM pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p4b:amocrm-mapping-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT authority.*
  INTO actor
  FROM platform_private.require_p4b_admin_conversation_actor(
    p_organization_id,
    p_conversation_id
  ) AS authority;

  -- Check global request ownership only after live authority succeeds; an
  -- unauthorized caller must not be able to probe whether an audit UUID
  -- already exists.
  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id = p_request_id
  ) AND NOT EXISTS (
    SELECT 1
    FROM platform_private.amocrm_mapping_approval_events AS event
    WHERE event.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'request_id is already owned by another operation'
      USING ERRCODE = '22023';
  END IF;

  -- The account-scoped tuple lock follows the request and live-authority
  -- locks. Approve and revoke use the exact same order. Fail fast instead of
  -- waiting behind an in-flight decision long enough for the API gateway to
  -- time out: the caller must refresh the latest projection before retrying.
  -- PT409 gives PostgREST an explicit conflict response instead of the 40*
  -- transaction-rollback class, which is transport-ambiguous for this RPC.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p4b:amocrm-mapping-tuple:'
        || p_organization_id::TEXT
        || ':'
        || actor.amocrm_account_id::TEXT
        || ':messaging',
      0
    )
  ) THEN
    RAISE EXCEPTION
      'amoCRM mapping approval state is being updated; refresh and retry'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT event.*
  INTO existing_event
  FROM platform_private.amocrm_mapping_approval_events AS event
  WHERE event.request_id = p_request_id;

  IF FOUND THEN
    IF existing_event.organization_id IS DISTINCT FROM p_organization_id
      OR existing_event.amocrm_account_id IS DISTINCT FROM
        actor.amocrm_account_id
      OR existing_event.mapping_use IS DISTINCT FROM 'messaging'
      OR existing_event.event_kind IS DISTINCT FROM 'approved'
      OR existing_event.discovery_version_id IS DISTINCT FROM
        p_discovery_version_id
      OR existing_event.selected_bindings IS DISTINCT FROM
        normalized_bindings
      OR existing_event.prior_event_id IS DISTINCT FROM
        p_expected_prior_event_id
      OR existing_event.decision_conversation_id IS DISTINCT FROM
        p_conversation_id
      OR existing_event.actor_profile_id IS DISTINCT FROM
        actor.actor_profile_id
      OR existing_event.actor_membership_id IS DISTINCT FROM
        actor.actor_membership_id
      OR existing_event.reason IS DISTINCT FROM normalized_reason
    THEN
      RAISE EXCEPTION 'request_id was already used with different input'
        USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
      existing_event.id,
      existing_event.organization_id,
      existing_event.amocrm_account_id,
      existing_event.mapping_use,
      existing_event.event_version,
      existing_event.event_kind,
      existing_event.discovery_version_id,
      replay_discovery.version,
      existing_event.selected_bindings,
      existing_event.prior_event_id,
      existing_event.actor_profile_id,
      existing_event.reason,
      existing_event.request_id,
      existing_event.created_at,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM platform_private.current_amocrm_mapping_selections AS current
          WHERE current.organization_id = existing_event.organization_id
            AND current.amocrm_account_id = existing_event.amocrm_account_id
            AND current.mapping_use = existing_event.mapping_use
        ) THEN 'approved_configured_unverified'::TEXT
        ELSE 'not_approved'::TEXT
      END
    FROM platform_private.amocrm_mapping_discovery_versions AS replay_discovery
    WHERE replay_discovery.organization_id = existing_event.organization_id
      AND replay_discovery.amocrm_account_id =
        existing_event.amocrm_account_id
      AND replay_discovery.id = existing_event.discovery_version_id;
    RETURN;
  END IF;

  SELECT event.*
  INTO latest_event
  FROM platform_private.amocrm_mapping_approval_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.amocrm_account_id = actor.amocrm_account_id
    AND event.mapping_use = 'messaging'
  ORDER BY event.event_version DESC, event.id DESC
  LIMIT 1;

  IF (latest_event.id IS NULL AND p_expected_prior_event_id IS NOT NULL)
    OR (
      latest_event.id IS NOT NULL
      AND latest_event.id IS DISTINCT FROM p_expected_prior_event_id
    )
  THEN
    RAISE EXCEPTION
      'amoCRM mapping approval state changed; refresh and retry'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT candidate.*
  INTO discovery
  FROM platform_private.amocrm_mapping_discovery_versions AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.amocrm_account_id = actor.amocrm_account_id
    AND candidate.id = p_discovery_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Discovery version is unavailable for this account'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      discovery.sanitized_snapshot -> 'pipelines'
    ) AS pipeline(value)
    WHERE pipeline.value ->> 'id' = normalized_bindings ->> 'pipeline_id'
      AND (pipeline.value ->> 'is_archive')::BOOLEAN IS FALSE
  ) THEN
    RAISE EXCEPTION 'Selected sales pipeline is unavailable'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      discovery.sanitized_snapshot -> 'pipelines'
    ) AS pipeline(value)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      pipeline.value -> 'statuses'
    ) AS status(value)
    WHERE pipeline.value ->> 'id' = normalized_bindings ->> 'pipeline_id'
      AND status.value ->> 'id' =
        normalized_bindings ->> 'signed_contract_status_id'
  ) THEN
    RAISE EXCEPTION
      'Signed-contract status is unavailable in the selected pipeline'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      normalized_bindings -> 'lead_custom_fields'
    ) AS binding(value)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(
        discovery.sanitized_snapshot -> 'lead_custom_fields'
      ) AS field(value)
      WHERE field.value ->> 'id' = binding.value ->> 'field_id'
    )
  ) THEN
    RAISE EXCEPTION 'Lead custom-field binding is unavailable'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      normalized_bindings -> 'contact_custom_fields'
    ) AS binding(value)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(
        discovery.sanitized_snapshot -> 'contact_custom_fields'
      ) AS field(value)
      WHERE field.value ->> 'id' = binding.value ->> 'field_id'
    )
  ) THEN
    RAISE EXCEPTION 'Contact custom-field binding is unavailable'
      USING ERRCODE = '22023';
  END IF;

  next_event_version := COALESCE(latest_event.event_version, 0) + 1;

  INSERT INTO platform_private.amocrm_mapping_approval_events (
    organization_id,
    amocrm_account_id,
    mapping_use,
    event_version,
    event_kind,
    discovery_version_id,
    selected_bindings,
    prior_event_id,
    decision_conversation_id,
    actor_profile_id,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    actor.amocrm_account_id,
    'messaging',
    next_event_version,
    'approved',
    discovery.id,
    normalized_bindings,
    latest_event.id,
    p_conversation_id,
    actor.actor_profile_id,
    actor.actor_membership_id,
    normalized_reason,
    p_request_id
  )
  RETURNING * INTO stored_event;

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
    stored_event.organization_id,
    'user',
    stored_event.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'integration.amocrm.mapping.approve',
    'amocrm_mapping_approval_event',
    stored_event.id,
    CASE
      WHEN latest_event.id IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object(
        'event_id', latest_event.id,
        'event_kind', latest_event.event_kind,
        'event_version', latest_event.event_version,
        'discovery_version_id', latest_event.discovery_version_id,
        'selected_bindings', latest_event.selected_bindings
      )
    END,
    pg_catalog.jsonb_build_object(
      'event_id', stored_event.id,
      'event_kind', stored_event.event_kind,
      'event_version', stored_event.event_version,
      'discovery_version_id', stored_event.discovery_version_id,
      'discovery_version', discovery.version,
      'selected_bindings', stored_event.selected_bindings,
      'mapping_state', 'approved_configured_unverified',
      'provider_proof', false
    ),
    stored_event.reason,
    stored_event.request_id
  );

  RETURN QUERY
  SELECT
    stored_event.id,
    stored_event.organization_id,
    stored_event.amocrm_account_id,
    stored_event.mapping_use,
    stored_event.event_version,
    stored_event.event_kind,
    stored_event.discovery_version_id,
    discovery.version,
    stored_event.selected_bindings,
    stored_event.prior_event_id,
    stored_event.actor_profile_id,
    stored_event.reason,
    stored_event.request_id,
    stored_event.created_at,
    'approved_configured_unverified'::TEXT;
END
$$;

CREATE OR REPLACE FUNCTION platform.revoke_amocrm_mapping_selection(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_expected_prior_event_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS TABLE (
  approval_event_id UUID,
  organization_id UUID,
  amocrm_account_id BIGINT,
  mapping_use TEXT,
  event_version BIGINT,
  event_kind TEXT,
  discovery_version_id UUID,
  discovery_version BIGINT,
  selected_bindings JSONB,
  prior_event_id UUID,
  actor_profile_id UUID,
  reason TEXT,
  request_id UUID,
  created_at TIMESTAMPTZ,
  mapping_state TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_reason TEXT := pg_catalog.btrim(p_reason);
  existing_event platform_private.amocrm_mapping_approval_events%ROWTYPE;
  latest_event platform_private.amocrm_mapping_approval_events%ROWTYPE;
  stored_event platform_private.amocrm_mapping_approval_events%ROWTYPE;
  resolved_discovery_version BIGINT;
BEGIN
  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_expected_prior_event_id IS NULL
    OR p_request_id IS NULL
    OR normalized_reason IS NULL
    OR pg_catalog.char_length(normalized_reason) NOT BETWEEN 1 AND 1000
    OR normalized_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Complete bounded amoCRM mapping revocation is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p4b:amocrm-mapping-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT authority.*
  INTO actor
  FROM platform_private.require_p4b_admin_conversation_actor(
    p_organization_id,
    p_conversation_id
  ) AS authority;

  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id = p_request_id
  ) AND NOT EXISTS (
    SELECT 1
    FROM platform_private.amocrm_mapping_approval_events AS event
    WHERE event.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'request_id is already owned by another operation'
      USING ERRCODE = '22023';
  END IF;

  -- Mirror approval's fail-fast tuple lock. A concurrent decision is a stale
  -- client state, not an unknown send-style operation that should wait or be
  -- retried automatically.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p4b:amocrm-mapping-tuple:'
        || p_organization_id::TEXT
        || ':'
        || actor.amocrm_account_id::TEXT
        || ':messaging',
      0
    )
  ) THEN
    RAISE EXCEPTION
      'amoCRM mapping approval state is being updated; refresh and retry'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT event.*
  INTO existing_event
  FROM platform_private.amocrm_mapping_approval_events AS event
  WHERE event.request_id = p_request_id;

  IF FOUND THEN
    IF existing_event.organization_id IS DISTINCT FROM p_organization_id
      OR existing_event.amocrm_account_id IS DISTINCT FROM
        actor.amocrm_account_id
      OR existing_event.mapping_use IS DISTINCT FROM 'messaging'
      OR existing_event.event_kind IS DISTINCT FROM 'revoked'
      OR existing_event.prior_event_id IS DISTINCT FROM
        p_expected_prior_event_id
      OR existing_event.decision_conversation_id IS DISTINCT FROM
        p_conversation_id
      OR existing_event.actor_profile_id IS DISTINCT FROM
        actor.actor_profile_id
      OR existing_event.actor_membership_id IS DISTINCT FROM
        actor.actor_membership_id
      OR existing_event.reason IS DISTINCT FROM normalized_reason
    THEN
      RAISE EXCEPTION 'request_id was already used with different input'
        USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
      existing_event.id,
      existing_event.organization_id,
      existing_event.amocrm_account_id,
      existing_event.mapping_use,
      existing_event.event_version,
      existing_event.event_kind,
      existing_event.discovery_version_id,
      replay_discovery.version,
      existing_event.selected_bindings,
      existing_event.prior_event_id,
      existing_event.actor_profile_id,
      existing_event.reason,
      existing_event.request_id,
      existing_event.created_at,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM platform_private.current_amocrm_mapping_selections AS current
          WHERE current.organization_id = existing_event.organization_id
            AND current.amocrm_account_id = existing_event.amocrm_account_id
            AND current.mapping_use = existing_event.mapping_use
        ) THEN 'approved_configured_unverified'::TEXT
        ELSE 'not_approved'::TEXT
      END
    FROM platform_private.amocrm_mapping_discovery_versions AS replay_discovery
    WHERE replay_discovery.organization_id = existing_event.organization_id
      AND replay_discovery.amocrm_account_id =
        existing_event.amocrm_account_id
      AND replay_discovery.id = existing_event.discovery_version_id;
    RETURN;
  END IF;

  SELECT event.*
  INTO latest_event
  FROM platform_private.amocrm_mapping_approval_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.amocrm_account_id = actor.amocrm_account_id
    AND event.mapping_use = 'messaging'
  ORDER BY event.event_version DESC, event.id DESC
  LIMIT 1;

  IF latest_event.id IS NULL
    OR latest_event.event_kind IS DISTINCT FROM 'approved'
    OR latest_event.id IS DISTINCT FROM p_expected_prior_event_id
  THEN
    RAISE EXCEPTION
      'amoCRM mapping approval state changed; refresh and retry'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT discovery.version
  INTO resolved_discovery_version
  FROM platform_private.amocrm_mapping_discovery_versions AS discovery
  WHERE discovery.organization_id = p_organization_id
    AND discovery.amocrm_account_id = actor.amocrm_account_id
    AND discovery.id = latest_event.discovery_version_id;

  INSERT INTO platform_private.amocrm_mapping_approval_events (
    organization_id,
    amocrm_account_id,
    mapping_use,
    event_version,
    event_kind,
    discovery_version_id,
    selected_bindings,
    prior_event_id,
    decision_conversation_id,
    actor_profile_id,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    actor.amocrm_account_id,
    'messaging',
    latest_event.event_version + 1,
    'revoked',
    latest_event.discovery_version_id,
    latest_event.selected_bindings,
    latest_event.id,
    p_conversation_id,
    actor.actor_profile_id,
    actor.actor_membership_id,
    normalized_reason,
    p_request_id
  )
  RETURNING * INTO stored_event;

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
    stored_event.organization_id,
    'user',
    stored_event.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'integration.amocrm.mapping.revoke',
    'amocrm_mapping_approval_event',
    stored_event.id,
    pg_catalog.jsonb_build_object(
      'event_id', latest_event.id,
      'event_kind', latest_event.event_kind,
      'event_version', latest_event.event_version,
      'discovery_version_id', latest_event.discovery_version_id,
      'selected_bindings', latest_event.selected_bindings,
      'mapping_state', 'approved_configured_unverified'
    ),
    pg_catalog.jsonb_build_object(
      'event_id', stored_event.id,
      'event_kind', stored_event.event_kind,
      'event_version', stored_event.event_version,
      'discovery_version_id', stored_event.discovery_version_id,
      'selected_bindings', stored_event.selected_bindings,
      'mapping_state', 'not_approved',
      'provider_proof', false
    ),
    stored_event.reason,
    stored_event.request_id
  );

  RETURN QUERY
  SELECT
    stored_event.id,
    stored_event.organization_id,
    stored_event.amocrm_account_id,
    stored_event.mapping_use,
    stored_event.event_version,
    stored_event.event_kind,
    stored_event.discovery_version_id,
    resolved_discovery_version,
    stored_event.selected_bindings,
    stored_event.prior_event_id,
    stored_event.actor_profile_id,
    stored_event.reason,
    stored_event.request_id,
    stored_event.created_at,
    'not_approved'::TEXT;
END
$$;

REVOKE ALL PRIVILEGES ON TABLE
  platform_private.amocrm_mapping_approval_events
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL PRIVILEGES ON TABLE
  platform_private.current_amocrm_mapping_selections
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.amocrm_mapping_selected_bindings_is_well_formed(JSONB),
  platform_private.normalize_amocrm_mapping_selected_bindings(JSONB),
  platform_private.require_p4b_admin_conversation_actor(UUID, UUID),
  platform.amocrm_mapping_state_for_conversation(UUID, UUID),
  platform.admin_amocrm_mapping_approval_workspace(UUID, UUID, UUID),
  platform.approve_amocrm_mapping_selection(
    UUID,
    UUID,
    UUID,
    JSONB,
    UUID,
    TEXT,
    UUID
  ),
  platform.revoke_amocrm_mapping_selection(
    UUID,
    UUID,
    UUID,
    TEXT,
    UUID
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.amocrm_mapping_state_for_conversation(UUID, UUID)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  platform.admin_amocrm_mapping_approval_workspace(UUID, UUID, UUID)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  platform.approve_amocrm_mapping_selection(
    UUID,
    UUID,
    UUID,
    JSONB,
    UUID,
    TEXT,
    UUID
  )
TO authenticated;
GRANT EXECUTE ON FUNCTION
  platform.revoke_amocrm_mapping_selection(
    UUID,
    UUID,
    UUID,
    TEXT,
    UUID
  )
TO authenticated;

COMMENT ON TABLE platform_private.amocrm_mapping_approval_events IS
  'Private immutable P4B approval/revocation event ledger. Local configuration evidence only; never provider proof.';
COMMENT ON VIEW platform_private.current_amocrm_mapping_selections IS
  'Current approved mapping projection. It chooses the latest tuple event before filtering approved, so revoke cannot resurrect history.';
COMMENT ON FUNCTION
  platform.amocrm_mapping_state_for_conversation(UUID, UUID) IS
  'Conversation-scoped, live-authority mapping state for authorized Admin/Sales/Curator staff; no selected bindings are exposed.';
COMMENT ON FUNCTION
  platform.admin_amocrm_mapping_approval_workspace(UUID, UUID, UUID) IS
  'Current same-organization Admin review workspace for one conversation account and one exact/latest sanitized discovery version.';
COMMENT ON FUNCTION platform.approve_amocrm_mapping_selection(
  UUID,
  UUID,
  UUID,
  JSONB,
  UUID,
  TEXT,
  UUID
) IS
  'Append one current Admin-approved messaging mapping after exact discovery, binding and expected-prior validation. No provider call or proof.';
COMMENT ON FUNCTION platform.revoke_amocrm_mapping_selection(
  UUID,
  UUID,
  UUID,
  TEXT,
  UUID
) IS
  'Append one Admin revocation of the exact current messaging mapping while retaining immutable selection and audit history.';

COMMIT;
