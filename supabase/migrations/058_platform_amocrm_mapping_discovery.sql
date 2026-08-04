-- ============================================================
-- 058_platform_amocrm_mapping_discovery.sql
--
-- P4A: private, append-only amoCRM mapping-discovery evidence.
--
-- This is a disabled/fail-closed adapter boundary. It stores only a bounded,
-- sanitized mapping snapshot supplied by a trusted service caller. It does not
-- call amoCRM, store OAuth material or raw provider bodies, publish a current
-- mapping pointer, enqueue work, or claim provider verification.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform_private.amocrm_mapping_json_is_safe(
  p_value JSONB
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
  object_entry RECORD;
  array_entry RECORD;
  forbidden_keys CONSTANT TEXT[] := ARRAY[
    'accesstoken',
    'refreshtoken',
    'clientsecret',
    'authorization',
    'password',
    'email',
    'phone',
    'phonenumber',
    'raw',
    'payload',
    'customer',
    'message'
  ];
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) = 'object' THEN
    FOR object_entry IN
      SELECT entry.key, entry.value
      FROM pg_catalog.jsonb_each(p_value) AS entry(key, value)
    LOOP
      IF pg_catalog.regexp_replace(
        pg_catalog.lower(object_entry.key),
        '[^a-z0-9]',
        '',
        'g'
      ) = ANY (forbidden_keys)
        OR pg_catalog.char_length(object_entry.key) NOT BETWEEN 1 AND 64
        OR object_entry.key ~ '[[:cntrl:]]'
      THEN
        RETURN FALSE;
      END IF;

      IF NOT platform_private.amocrm_mapping_json_is_safe(
        object_entry.value
      ) THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  ELSIF pg_catalog.jsonb_typeof(p_value) = 'array' THEN
    IF pg_catalog.jsonb_array_length(p_value) > 10000 THEN
      RETURN FALSE;
    END IF;

    FOR array_entry IN
      SELECT entry.value
      FROM pg_catalog.jsonb_array_elements(p_value) AS entry(value)
    LOOP
      IF NOT platform_private.amocrm_mapping_json_is_safe(
        array_entry.value
      ) THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  ELSIF pg_catalog.jsonb_typeof(p_value) = 'string' THEN
    IF pg_catalog.char_length(p_value #>> '{}') > 1000
      OR (p_value #>> '{}') ~ '[[:cntrl:]]'
    THEN
      RETURN FALSE;
    END IF;
  END IF;

  RETURN TRUE;
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
  account JSONB;
  pipeline_entry RECORD;
  status_entry RECORD;
  user_entry RECORD;
  custom_field_entry RECORD;
  enum_entry RECORD;
  root_keys TEXT[];
  account_keys TEXT[];
  nested_keys TEXT[];
BEGIN
  IF p_snapshot IS NULL
    OR p_amocrm_account_id IS NULL
    OR p_amocrm_account_id <= 0
    OR p_account_domain IS NULL
    OR p_account_subdomain IS NULL
    OR pg_catalog.pg_column_size(p_snapshot) > 1048576
    OR pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
  THEN
    RETURN FALSE;
  END IF;

  SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
  INTO root_keys
  FROM pg_catalog.jsonb_object_keys(p_snapshot) AS key_name;

  IF root_keys IS DISTINCT FROM ARRAY[
    'account',
    'contact_custom_fields',
    'lead_custom_fields',
    'pipelines',
    'schema_version',
    'users'
  ]::TEXT[] THEN
    RETURN FALSE;
  END IF;

  IF pg_catalog.jsonb_typeof(p_snapshot -> 'schema_version') <> 'number'
    OR (p_snapshot ->> 'schema_version') !~ '^[0-9]+$'
    OR (p_snapshot ->> 'schema_version')::INTEGER <> 1
    OR pg_catalog.jsonb_typeof(p_snapshot -> 'account') <> 'object'
  THEN
    RETURN FALSE;
  END IF;

  account := p_snapshot -> 'account';
  SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
  INTO account_keys
  FROM pg_catalog.jsonb_object_keys(account) AS key_name;

  IF account_keys IS DISTINCT FROM ARRAY[
    'domain',
    'id',
    'subdomain'
  ]::TEXT[]
    OR pg_catalog.jsonb_typeof(account -> 'id') <> 'string'
    OR (account ->> 'id') !~ '^[1-9][0-9]*$'
    OR (account ->> 'id')::BIGINT <> p_amocrm_account_id
    OR pg_catalog.jsonb_typeof(account -> 'domain') <> 'string'
    OR account ->> 'domain' <> p_account_domain
    OR pg_catalog.jsonb_typeof(account -> 'subdomain') <> 'string'
    OR account ->> 'subdomain' <> p_account_subdomain
  THEN
    RETURN FALSE;
  END IF;

  IF pg_catalog.jsonb_typeof(p_snapshot -> 'pipelines') <> 'array'
    OR pg_catalog.jsonb_typeof(p_snapshot -> 'users') <> 'array'
    OR pg_catalog.jsonb_typeof(p_snapshot -> 'lead_custom_fields') <> 'array'
    OR pg_catalog.jsonb_typeof(
      p_snapshot -> 'contact_custom_fields'
    ) <> 'array'
    OR pg_catalog.jsonb_array_length(p_snapshot -> 'pipelines') > 10000
    OR pg_catalog.jsonb_array_length(p_snapshot -> 'users') > 10000
    OR pg_catalog.jsonb_array_length(
      p_snapshot -> 'lead_custom_fields'
    ) > 10000
    OR pg_catalog.jsonb_array_length(
      p_snapshot -> 'contact_custom_fields'
    ) > 10000
    OR pg_catalog.jsonb_array_length(p_snapshot -> 'pipelines') = 0
    OR pg_catalog.jsonb_array_length(p_snapshot -> 'users') = 0
  THEN
    RETURN FALSE;
  END IF;

  FOR pipeline_entry IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(
      p_snapshot -> 'pipelines'
    ) AS element(value)
  LOOP
    IF pg_catalog.jsonb_typeof(pipeline_entry.value) <> 'object' THEN
      RETURN FALSE;
    END IF;

    SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
    INTO nested_keys
    FROM pg_catalog.jsonb_object_keys(pipeline_entry.value) AS key_name;

    IF nested_keys IS DISTINCT FROM ARRAY[
      'id',
      'is_archive',
      'is_main',
      'name',
      'statuses'
    ]::TEXT[]
      OR pg_catalog.jsonb_typeof(pipeline_entry.value -> 'id') <> 'string'
      OR pipeline_entry.value ->> 'id' !~ '^[1-9][0-9]*$'
      OR (pipeline_entry.value ->> 'id')::NUMERIC > 9223372036854775807
      OR pg_catalog.jsonb_typeof(pipeline_entry.value -> 'name') <> 'string'
      OR pg_catalog.btrim(pipeline_entry.value ->> 'name')
        <> pipeline_entry.value ->> 'name'
      OR pg_catalog.char_length(pipeline_entry.value ->> 'name')
        NOT BETWEEN 1 AND 512
      OR pg_catalog.jsonb_typeof(pipeline_entry.value -> 'is_main')
        <> 'boolean'
      OR pg_catalog.jsonb_typeof(pipeline_entry.value -> 'is_archive')
        <> 'boolean'
      OR pg_catalog.jsonb_typeof(pipeline_entry.value -> 'statuses')
        <> 'array'
      OR pg_catalog.jsonb_array_length(
        pipeline_entry.value -> 'statuses'
      ) NOT BETWEEN 1 AND 10000
    THEN
      RETURN FALSE;
    END IF;

    FOR status_entry IN
      SELECT element.value
      FROM pg_catalog.jsonb_array_elements(
        pipeline_entry.value -> 'statuses'
      ) AS element(value)
    LOOP
      IF pg_catalog.jsonb_typeof(status_entry.value) <> 'object' THEN
        RETURN FALSE;
      END IF;

      SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
      INTO nested_keys
      FROM pg_catalog.jsonb_object_keys(status_entry.value) AS key_name;

      IF nested_keys IS DISTINCT FROM ARRAY[
        'id',
        'is_editable',
        'name',
        'sort',
        'type'
      ]::TEXT[]
        OR pg_catalog.jsonb_typeof(status_entry.value -> 'id') <> 'string'
        OR status_entry.value ->> 'id' !~ '^[1-9][0-9]*$'
        OR (status_entry.value ->> 'id')::NUMERIC > 9223372036854775807
        OR pg_catalog.jsonb_typeof(status_entry.value -> 'name') <> 'string'
        OR pg_catalog.btrim(status_entry.value ->> 'name')
          <> status_entry.value ->> 'name'
        OR pg_catalog.char_length(status_entry.value ->> 'name')
          NOT BETWEEN 1 AND 512
        OR pg_catalog.jsonb_typeof(status_entry.value -> 'sort') <> 'number'
        OR status_entry.value ->> 'sort' !~ '^[0-9]+$'
        OR (status_entry.value ->> 'sort')::NUMERIC > 9007199254740991
        OR pg_catalog.jsonb_typeof(status_entry.value -> 'is_editable')
          NOT IN ('boolean', 'null')
        OR pg_catalog.jsonb_typeof(status_entry.value -> 'type')
          NOT IN ('number', 'null')
        OR (
          pg_catalog.jsonb_typeof(status_entry.value -> 'type') = 'number'
          AND (
            status_entry.value ->> 'type' !~ '^[0-9]+$'
            OR (status_entry.value ->> 'type')::NUMERIC > 9007199254740991
          )
        )
      THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  END LOOP;

  FOR user_entry IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(
      p_snapshot -> 'users'
    ) AS element(value)
  LOOP
    IF pg_catalog.jsonb_typeof(user_entry.value) <> 'object' THEN
      RETURN FALSE;
    END IF;

    SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
    INTO nested_keys
    FROM pg_catalog.jsonb_object_keys(user_entry.value) AS key_name;

    IF nested_keys IS DISTINCT FROM ARRAY[
      'id',
      'is_active',
      'name'
    ]::TEXT[]
      OR pg_catalog.jsonb_typeof(user_entry.value -> 'id') <> 'string'
      OR user_entry.value ->> 'id' !~ '^[1-9][0-9]*$'
      OR (user_entry.value ->> 'id')::NUMERIC > 9223372036854775807
      OR pg_catalog.jsonb_typeof(user_entry.value -> 'name') <> 'string'
      OR pg_catalog.btrim(user_entry.value ->> 'name')
        <> user_entry.value ->> 'name'
      OR pg_catalog.char_length(user_entry.value ->> 'name')
        NOT BETWEEN 1 AND 512
      OR pg_catalog.jsonb_typeof(user_entry.value -> 'is_active')
        <> 'boolean'
    THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  FOR custom_field_entry IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(
      p_snapshot -> 'lead_custom_fields'
    ) AS element(value)
    UNION ALL
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(
      p_snapshot -> 'contact_custom_fields'
    ) AS element(value)
  LOOP
    IF pg_catalog.jsonb_typeof(custom_field_entry.value) <> 'object' THEN
      RETURN FALSE;
    END IF;

    SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
    INTO nested_keys
    FROM pg_catalog.jsonb_object_keys(custom_field_entry.value) AS key_name;

    IF nested_keys IS DISTINCT FROM ARRAY[
      'code',
      'enums',
      'id',
      'name',
      'type'
    ]::TEXT[]
      OR pg_catalog.jsonb_typeof(custom_field_entry.value -> 'id') <> 'string'
      OR custom_field_entry.value ->> 'id' !~ '^[1-9][0-9]*$'
      OR (custom_field_entry.value ->> 'id')::NUMERIC > 9223372036854775807
      OR pg_catalog.jsonb_typeof(custom_field_entry.value -> 'name') <> 'string'
      OR pg_catalog.btrim(custom_field_entry.value ->> 'name')
        <> custom_field_entry.value ->> 'name'
      OR pg_catalog.char_length(custom_field_entry.value ->> 'name')
        NOT BETWEEN 1 AND 512
      OR pg_catalog.jsonb_typeof(custom_field_entry.value -> 'code')
        NOT IN ('string', 'null')
      OR (
        pg_catalog.jsonb_typeof(custom_field_entry.value -> 'code') = 'string'
        AND (
          custom_field_entry.value ->> 'code' !~ '^[A-Z0-9_]+$'
          OR pg_catalog.char_length(custom_field_entry.value ->> 'code') > 128
        )
      )
      OR pg_catalog.jsonb_typeof(custom_field_entry.value -> 'type') <> 'string'
      OR pg_catalog.btrim(custom_field_entry.value ->> 'type')
        <> custom_field_entry.value ->> 'type'
      OR pg_catalog.char_length(custom_field_entry.value ->> 'type')
        NOT BETWEEN 1 AND 128
      OR pg_catalog.jsonb_typeof(custom_field_entry.value -> 'enums') <> 'array'
      OR pg_catalog.jsonb_array_length(
        custom_field_entry.value -> 'enums'
      ) > 10000
    THEN
      RETURN FALSE;
    END IF;

    FOR enum_entry IN
      SELECT element.value
      FROM pg_catalog.jsonb_array_elements(
        custom_field_entry.value -> 'enums'
      ) AS element(value)
    LOOP
      IF pg_catalog.jsonb_typeof(enum_entry.value) <> 'object' THEN
        RETURN FALSE;
      END IF;

      SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
      INTO nested_keys
      FROM pg_catalog.jsonb_object_keys(enum_entry.value) AS key_name;

      IF nested_keys IS DISTINCT FROM ARRAY[
        'id',
        'sort',
        'value'
      ]::TEXT[]
        OR pg_catalog.jsonb_typeof(enum_entry.value -> 'id') <> 'string'
        OR enum_entry.value ->> 'id' !~ '^[1-9][0-9]*$'
        OR (enum_entry.value ->> 'id')::NUMERIC > 9223372036854775807
        OR pg_catalog.jsonb_typeof(enum_entry.value -> 'value') <> 'string'
        OR pg_catalog.btrim(enum_entry.value ->> 'value')
          <> enum_entry.value ->> 'value'
        OR pg_catalog.char_length(enum_entry.value ->> 'value')
          NOT BETWEEN 1 AND 512
        OR pg_catalog.jsonb_typeof(enum_entry.value -> 'sort') <> 'number'
        OR enum_entry.value ->> 'sort' !~ '^[0-9]+$'
        OR (enum_entry.value ->> 'sort')::NUMERIC > 9007199254740991
      THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  END LOOP;

  RETURN platform_private.amocrm_mapping_json_is_safe(p_snapshot);
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN FALSE;
END
$$;

CREATE TABLE platform_private.amocrm_mapping_discovery_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  amocrm_account_id BIGINT NOT NULL CHECK (amocrm_account_id > 0),
  account_domain TEXT NOT NULL,
  account_subdomain TEXT NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  snapshot_schema_version INTEGER NOT NULL DEFAULT 1
    CHECK (snapshot_schema_version = 1),
  sanitized_snapshot JSONB NOT NULL,
  snapshot_sha256 TEXT NOT NULL CHECK (
    snapshot_sha256 ~ '^[0-9a-f]{64}$'
  ),
  evidence_kind TEXT NOT NULL CHECK (
    evidence_kind IN ('local_non_provider', 'provider_observed')
  ),
  evidence_ref TEXT NOT NULL CHECK (
    pg_catalog.btrim(evidence_ref) = evidence_ref
    AND pg_catalog.char_length(evidence_ref) BETWEEN 1 AND 512
    AND evidence_ref !~ '[[:cntrl:]]'
  ),
  request_id UUID NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL CHECK (
    discovered_at >= TIMESTAMPTZ '2020-01-01 00:00:00+00'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT amocrm_mapping_discovery_versions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT amocrm_mapping_discovery_versions_org_account_version_key
    UNIQUE (organization_id, amocrm_account_id, version),
  CONSTRAINT amocrm_mapping_discovery_versions_request_id_key
    UNIQUE (request_id),
  CONSTRAINT amocrm_mapping_discovery_versions_account_host_check CHECK (
    pg_catalog.btrim(account_domain) = account_domain
    AND pg_catalog.btrim(account_subdomain) = account_subdomain
    AND account_domain = pg_catalog.lower(account_domain)
    AND account_subdomain = pg_catalog.lower(account_subdomain)
    AND pg_catalog.char_length(account_domain) <= 255
    AND pg_catalog.char_length(account_subdomain) <= 63
    AND account_subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    AND (
      account_domain = account_subdomain || '.amocrm.ru'
      OR account_domain = account_subdomain || '.kommo.com'
    )
  ),
  CONSTRAINT amocrm_mapping_discovery_versions_snapshot_check CHECK (
    platform_private.amocrm_mapping_snapshot_is_valid(
      sanitized_snapshot,
      amocrm_account_id,
      account_domain,
      account_subdomain
    )
  )
);

ALTER TABLE platform_private.amocrm_mapping_discovery_versions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.amocrm_mapping_discovery_versions
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER amocrm_mapping_discovery_versions_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.amocrm_mapping_discovery_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER amocrm_mapping_discovery_versions_no_truncate
  BEFORE TRUNCATE
  ON platform_private.amocrm_mapping_discovery_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

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
  THEN
    RAISE EXCEPTION 'Complete bounded amoCRM mapping evidence is required'
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

  -- The request lock makes request-id replay deterministic even when a bad
  -- caller attempts to reuse one request across different tenant/account keys.
  PERFORM pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p4a:amocrm-mapping-request:' || p_request_id::TEXT,
      0
    )
  );

  -- Version allocation is serialized only within one tenant/account stream.
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
      OR stored.snapshot_schema_version IS DISTINCT FROM 1
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

  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'request_id is already owned by another operation'
      USING ERRCODE = '22023';
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
    1,
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

CREATE OR REPLACE FUNCTION platform.admin_amocrm_mapping_discovery_versions(
  p_organization_id UUID,
  p_amocrm_account_id BIGINT,
  p_version BIGINT DEFAULT NULL
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
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_organization_id IS NULL
    OR p_amocrm_account_id IS NULL
    OR p_amocrm_account_id <= 0
    OR (p_version IS NOT NULL AND p_version <= 0)
  THEN
    RAISE EXCEPTION 'Organization, account and positive version are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'audit.read'
  ) AS authority;

  IF actor.actor_role IS DISTINCT FROM 'admin'
    OR NOT private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    )
  THEN
    RAISE EXCEPTION 'Active organization Admin authority is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    candidate.id,
    candidate.organization_id,
    candidate.amocrm_account_id,
    candidate.account_domain,
    candidate.account_subdomain,
    candidate.version,
    candidate.snapshot_schema_version,
    candidate.sanitized_snapshot,
    candidate.snapshot_sha256,
    candidate.evidence_kind,
    candidate.evidence_ref,
    candidate.request_id,
    candidate.discovered_at,
    candidate.created_at
  FROM platform_private.amocrm_mapping_discovery_versions AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.amocrm_account_id = p_amocrm_account_id
    AND (p_version IS NULL OR candidate.version = p_version)
  ORDER BY candidate.version DESC
  LIMIT 1;
END
$$;

REVOKE ALL PRIVILEGES ON TABLE
  platform_private.amocrm_mapping_discovery_versions
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.amocrm_mapping_json_is_safe(JSONB),
  platform_private.amocrm_mapping_snapshot_is_valid(
    JSONB,
    BIGINT,
    TEXT,
    TEXT
  ),
  platform.persist_amocrm_mapping_discovery(
    UUID,
    BIGINT,
    TEXT,
    TEXT,
    JSONB,
    TEXT,
    TEXT,
    TIMESTAMPTZ,
    UUID
  ),
  platform.admin_amocrm_mapping_discovery_versions(UUID, BIGINT, BIGINT)
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

GRANT EXECUTE ON FUNCTION
  platform.admin_amocrm_mapping_discovery_versions(UUID, BIGINT, BIGINT)
TO authenticated;

COMMENT ON TABLE
  platform_private.amocrm_mapping_discovery_versions IS
  'Private immutable sanitized amoCRM mapping-discovery snapshots; no credentials, raw provider bodies or customer records.';
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
  'Service-only append of one sanitized amoCRM mapping snapshot. It performs no provider call and provider_observed remains caller-supplied evidence classification.';
COMMENT ON FUNCTION
  platform.admin_amocrm_mapping_discovery_versions(UUID, BIGINT, BIGINT) IS
  'Live-authority Admin read of the latest or one exact sanitized mapping-discovery version for one organization/account.';

COMMIT;
