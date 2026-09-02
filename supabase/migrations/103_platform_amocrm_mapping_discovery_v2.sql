-- ============================================================
-- 103_platform_amocrm_mapping_discovery_v2.sql
--
-- Production-successor amoCRM discovery evidence. New writes use one schema
-- v2 shape that includes the exact lead-tag catalog used for role routing.
-- Existing schema-v1 rows remain valid and readable as immutable history.
-- ============================================================

BEGIN;

ALTER FUNCTION platform_private.amocrm_mapping_snapshot_is_valid(
  JSONB,
  BIGINT,
  TEXT,
  TEXT
) RENAME TO amocrm_mapping_snapshot_v1_is_valid;

CREATE OR REPLACE FUNCTION platform_private.amocrm_mapping_lead_tags_are_valid(
  p_lead_tags JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  tag_entry RECORD;
  tag_keys TEXT[];
BEGIN
  IF pg_catalog.jsonb_typeof(p_lead_tags) <> 'array'
    OR pg_catalog.jsonb_array_length(p_lead_tags) > 10000
  THEN
    RETURN FALSE;
  END IF;

  FOR tag_entry IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(p_lead_tags) AS element(value)
  LOOP
    IF pg_catalog.jsonb_typeof(tag_entry.value) <> 'object' THEN
      RETURN FALSE;
    END IF;

    SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
    INTO tag_keys
    FROM pg_catalog.jsonb_object_keys(tag_entry.value) AS key_name;

    IF tag_keys IS DISTINCT FROM ARRAY['id', 'name']::TEXT[]
      OR pg_catalog.jsonb_typeof(tag_entry.value -> 'id') <> 'string'
      OR tag_entry.value ->> 'id' !~ '^[1-9][0-9]*$'
      OR (tag_entry.value ->> 'id')::NUMERIC > 9223372036854775807
      OR pg_catalog.jsonb_typeof(tag_entry.value -> 'name') <> 'string'
      OR pg_catalog.btrim(tag_entry.value ->> 'name')
        <> tag_entry.value ->> 'name'
      OR pg_catalog.char_length(tag_entry.value ->> 'name')
        NOT BETWEEN 1 AND 512
      OR tag_entry.value ->> 'name' ~ '[[:cntrl:]]'
    THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN platform_private.amocrm_mapping_json_is_safe(p_lead_tags);
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN FALSE;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.amocrm_mapping_snapshot_is_valid(
  p_snapshot JSONB,
  p_amocrm_account_id BIGINT,
  p_account_domain TEXT,
  p_account_subdomain TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  schema_version INTEGER;
  account JSONB;
  root_keys TEXT[];
  account_keys TEXT[];
  legacy_snapshot JSONB;
BEGIN
  IF p_snapshot IS NULL
    OR pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
    OR pg_catalog.jsonb_typeof(p_snapshot -> 'schema_version') <> 'number'
    OR p_snapshot ->> 'schema_version' !~ '^[0-9]+$'
  THEN
    RETURN FALSE;
  END IF;

  schema_version := (p_snapshot ->> 'schema_version')::INTEGER;
  IF schema_version = 1 THEN
    RETURN platform_private.amocrm_mapping_snapshot_v1_is_valid(
      p_snapshot,
      p_amocrm_account_id,
      p_account_domain,
      p_account_subdomain
    );
  END IF;
  IF schema_version <> 2 THEN
    RETURN FALSE;
  END IF;

  SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
  INTO root_keys
  FROM pg_catalog.jsonb_object_keys(p_snapshot) AS key_name;
  IF root_keys IS DISTINCT FROM ARRAY[
    'account',
    'contact_custom_fields',
    'lead_custom_fields',
    'lead_tags',
    'pipelines',
    'schema_version',
    'users'
  ]::TEXT[]
    OR pg_catalog.jsonb_typeof(p_snapshot -> 'account') <> 'object'
  THEN
    RETURN FALSE;
  END IF;

  account := p_snapshot -> 'account';
  SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
  INTO account_keys
  FROM pg_catalog.jsonb_object_keys(account) AS key_name;
  IF account_keys IS DISTINCT FROM ARRAY[
    'country',
    'domain',
    'id',
    'name',
    'subdomain',
    'timezone'
  ]::TEXT[]
    OR pg_catalog.jsonb_typeof(account -> 'name') <> 'string'
    OR pg_catalog.btrim(account ->> 'name') <> account ->> 'name'
    OR pg_catalog.char_length(account ->> 'name') NOT BETWEEN 1 AND 512
    OR account ->> 'name' ~ '[[:cntrl:]]'
    OR pg_catalog.jsonb_typeof(account -> 'timezone') <> 'string'
    OR pg_catalog.btrim(account ->> 'timezone') <> account ->> 'timezone'
    OR pg_catalog.char_length(account ->> 'timezone') NOT BETWEEN 1 AND 128
    OR account ->> 'timezone' ~ '[[:cntrl:]]'
    OR pg_catalog.jsonb_typeof(account -> 'country') NOT IN ('string', 'null')
    OR (
      pg_catalog.jsonb_typeof(account -> 'country') = 'string'
      AND (
        pg_catalog.btrim(account ->> 'country') <> account ->> 'country'
        OR pg_catalog.char_length(account ->> 'country') NOT BETWEEN 1 AND 16
        OR account ->> 'country' ~ '[[:cntrl:]]'
      )
    )
  THEN
    RETURN FALSE;
  END IF;

  legacy_snapshot := p_snapshot - 'lead_tags';
  legacy_snapshot := pg_catalog.jsonb_set(
    legacy_snapshot,
    '{account}',
    account - 'country' - 'name' - 'timezone',
    FALSE
  );
  legacy_snapshot := pg_catalog.jsonb_set(
    legacy_snapshot,
    '{schema_version}',
    '1'::JSONB,
    FALSE
  );

  RETURN platform_private.amocrm_mapping_snapshot_v1_is_valid(
      legacy_snapshot,
      p_amocrm_account_id,
      p_account_domain,
      p_account_subdomain
    )
    AND platform_private.amocrm_mapping_lead_tags_are_valid(
      p_snapshot -> 'lead_tags'
    )
    AND platform_private.amocrm_mapping_json_is_safe(p_snapshot);
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN FALSE;
END
$$;

ALTER TABLE platform_private.amocrm_mapping_discovery_versions
  DROP CONSTRAINT
    amocrm_mapping_discovery_versions_snapshot_schema_version_check,
  DROP CONSTRAINT amocrm_mapping_discovery_versions_snapshot_check;

ALTER TABLE platform_private.amocrm_mapping_discovery_versions
  ADD CONSTRAINT
    amocrm_mapping_discovery_versions_snapshot_schema_version_check
    CHECK (snapshot_schema_version IN (1, 2)),
  ADD CONSTRAINT amocrm_mapping_discovery_versions_snapshot_check CHECK (
    platform_private.amocrm_mapping_snapshot_is_valid(
      sanitized_snapshot,
      amocrm_account_id,
      account_domain,
      account_subdomain
    )
  );

CREATE OR REPLACE FUNCTION platform.persist_amocrm_mapping_discovery(
  p_organization_id UUID,
  p_amocrm_account_id BIGINT,
  p_account_domain TEXT,
  p_account_subdomain TEXT,
  p_sanitized_snapshot JSONB,
  p_evidence_kind TEXT,
  p_evidence_ref TEXT,
  p_discovered_at TIMESTAMPTZ,
  p_request_id UUID
)
RETURNS TABLE (
  discovery_version_id UUID,
  organization_id UUID,
  amocrm_account_id BIGINT,
  account_domain TEXT,
  account_subdomain TEXT,
  version BIGINT,
  snapshot_schema_version INTEGER,
  sanitized_snapshot JSONB,
  snapshot_sha256 TEXT,
  evidence_kind TEXT,
  evidence_ref TEXT,
  request_id UUID,
  discovered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_domain TEXT := pg_catalog.lower(
    pg_catalog.btrim(p_account_domain)
  );
  normalized_subdomain TEXT := pg_catalog.lower(
    pg_catalog.btrim(p_account_subdomain)
  );
  normalized_evidence_kind TEXT := pg_catalog.lower(
    pg_catalog.btrim(p_evidence_kind)
  );
  normalized_evidence_ref TEXT := pg_catalog.btrim(p_evidence_ref);
  snapshot_hash TEXT;
  next_version BIGINT;
  stored platform_private.amocrm_mapping_discovery_versions%ROWTYPE;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL
    OR p_amocrm_account_id IS NULL
    OR p_amocrm_account_id <= 0
    OR p_request_id IS NULL
    OR p_discovered_at IS NULL
    OR p_discovered_at < TIMESTAMPTZ '2020-01-01 00:00:00+00'
    OR p_discovered_at > statement_timestamp() + INTERVAL '5 minutes'
    OR normalized_domain IS NULL
    OR normalized_subdomain IS NULL
    OR normalized_evidence_kind IS NULL
    OR normalized_evidence_ref IS NULL
    OR normalized_evidence_kind NOT IN (
      'local_non_provider',
      'provider_observed'
    )
    OR pg_catalog.char_length(normalized_evidence_ref) NOT BETWEEN 1 AND 512
    OR normalized_evidence_ref ~ '[[:cntrl:]]'
    OR pg_catalog.jsonb_typeof(p_sanitized_snapshot -> 'schema_version')
      <> 'number'
    OR p_sanitized_snapshot ->> 'schema_version' <> '2'
  THEN
    RAISE EXCEPTION 'Complete bounded schema-v2 amoCRM mapping evidence is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT platform_private.amocrm_mapping_snapshot_is_valid(
    p_sanitized_snapshot,
    p_amocrm_account_id,
    normalized_domain,
    normalized_subdomain
  ) THEN
    RAISE EXCEPTION 'Sanitized amoCRM mapping snapshot is invalid'
      USING ERRCODE = '22023';
  END IF;

  snapshot_hash := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(p_sanitized_snapshot::TEXT, 'UTF8')
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p4a:amocrm-mapping-request:' || p_request_id::TEXT,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p4a:amocrm-mapping-account:'
        || p_organization_id::TEXT
        || ':'
        || p_amocrm_account_id::TEXT,
      0
    )
  );

  SELECT candidate.*
  INTO stored
  FROM platform_private.amocrm_mapping_discovery_versions AS candidate
  WHERE candidate.request_id = p_request_id;

  IF FOUND THEN
    IF stored.organization_id IS DISTINCT FROM p_organization_id
      OR stored.amocrm_account_id IS DISTINCT FROM p_amocrm_account_id
      OR stored.account_domain IS DISTINCT FROM normalized_domain
      OR stored.account_subdomain IS DISTINCT FROM normalized_subdomain
      OR stored.snapshot_schema_version IS DISTINCT FROM 2
      OR stored.sanitized_snapshot IS DISTINCT FROM p_sanitized_snapshot
      OR stored.snapshot_sha256 IS DISTINCT FROM snapshot_hash
      OR stored.evidence_kind IS DISTINCT FROM normalized_evidence_kind
      OR stored.evidence_ref IS DISTINCT FROM normalized_evidence_ref
      OR stored.discovered_at IS DISTINCT FROM p_discovered_at
    THEN
      RAISE EXCEPTION 'request_id was already used with different input'
        USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
      stored.id,
      stored.organization_id,
      stored.amocrm_account_id,
      stored.account_domain,
      stored.account_subdomain,
      stored.version,
      stored.snapshot_schema_version,
      stored.sanitized_snapshot,
      stored.snapshot_sha256,
      stored.evidence_kind,
      stored.evidence_ref,
      stored.request_id,
      stored.discovered_at,
      stored.created_at;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organizations AS organization
    WHERE organization.id = p_organization_id
      AND organization.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active Platform organization is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(candidate.version), 0) + 1
  INTO next_version
  FROM platform_private.amocrm_mapping_discovery_versions AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.amocrm_account_id = p_amocrm_account_id;

  INSERT INTO platform_private.amocrm_mapping_discovery_versions (
    organization_id,
    amocrm_account_id,
    account_domain,
    account_subdomain,
    version,
    snapshot_schema_version,
    sanitized_snapshot,
    snapshot_sha256,
    evidence_kind,
    evidence_ref,
    request_id,
    discovered_at
  )
  VALUES (
    p_organization_id,
    p_amocrm_account_id,
    normalized_domain,
    normalized_subdomain,
    next_version,
    2,
    p_sanitized_snapshot,
    snapshot_hash,
    normalized_evidence_kind,
    normalized_evidence_ref,
    p_request_id,
    p_discovered_at
  )
  RETURNING * INTO stored;

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
    stored.organization_id,
    'service',
    NULL,
    'service_role:amocrm_mapping_discovery',
    'integration.amocrm.mapping.discovery.persist',
    'amocrm_mapping_discovery_version',
    stored.id,
    NULL,
    pg_catalog.jsonb_build_object(
      'organization_id', stored.organization_id,
      'amocrm_account_id', stored.amocrm_account_id,
      'account_domain', stored.account_domain,
      'account_subdomain', stored.account_subdomain,
      'version', stored.version,
      'snapshot_schema_version', stored.snapshot_schema_version,
      'snapshot_sha256', stored.snapshot_sha256,
      'evidence_kind', stored.evidence_kind,
      'evidence_ref', stored.evidence_ref,
      'discovered_at', stored.discovered_at,
      'counts', pg_catalog.jsonb_build_object(
        'pipelines', pg_catalog.jsonb_array_length(
          stored.sanitized_snapshot -> 'pipelines'
        ),
        'lead_tags', pg_catalog.jsonb_array_length(
          stored.sanitized_snapshot -> 'lead_tags'
        ),
        'users', pg_catalog.jsonb_array_length(
          stored.sanitized_snapshot -> 'users'
        ),
        'lead_custom_fields', pg_catalog.jsonb_array_length(
          stored.sanitized_snapshot -> 'lead_custom_fields'
        ),
        'contact_custom_fields', pg_catalog.jsonb_array_length(
          stored.sanitized_snapshot -> 'contact_custom_fields'
        )
      )
    ),
    'Persist sanitized amoCRM mapping discovery evidence ('
      || stored.evidence_kind
      || '): '
      || stored.evidence_ref,
    stored.request_id
  );

  RETURN QUERY
  SELECT
    stored.id,
    stored.organization_id,
    stored.amocrm_account_id,
    stored.account_domain,
    stored.account_subdomain,
    stored.version,
    stored.snapshot_schema_version,
    stored.sanitized_snapshot,
    stored.snapshot_sha256,
    stored.evidence_kind,
    stored.evidence_ref,
    stored.request_id,
    stored.discovered_at,
    stored.created_at;
END
$$;

REVOKE ALL ON FUNCTION platform.persist_amocrm_mapping_discovery(
  UUID,
  BIGINT,
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.amocrm_mapping_lead_tags_are_valid(JSONB),
  platform_private.amocrm_mapping_snapshot_is_valid(
    JSONB,
    BIGINT,
    TEXT,
    TEXT
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.persist_amocrm_mapping_discovery(
  UUID,
  BIGINT,
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  UUID
) TO service_role;

COMMENT ON FUNCTION platform.persist_amocrm_mapping_discovery(
  UUID,
  BIGINT,
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  UUID
) IS
  'Service-only append/replay of one complete sanitized provider-observed amoCRM schema-v2 mapping snapshot, including lead tags; schema-v1 rows remain immutable readable history.';

COMMIT;
