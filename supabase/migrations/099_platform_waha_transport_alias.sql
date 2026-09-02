-- 099_platform_waha_transport_alias.sql
-- Cut the active Supabase communications runtime over from the frozen V1 CRM
-- transport alias to the single EVO Inbox WAHA service and session.

BEGIN;

LOCK TABLE platform_private.manual_send_waha_runtime_bindings
  IN ACCESS EXCLUSIVE MODE;

DO $migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM platform_private.manual_send_waha_runtime_bindings AS binding
    WHERE binding.waha_session_name <> 'evo-inbox'
      OR binding.waha_base_url NOT IN (
        'http://evo-crm-waha:3000',
        'http://evo-inbox-waha:3000'
      )
  ) THEN
    RAISE EXCEPTION
      'Manual-send WAHA runtime binding contains an unexpected transport; reconcile it before migration 099'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.manual_send_waha_runtime_bindings AS binding
    WHERE binding.waha_base_url = 'http://evo-crm-waha:3000'
      AND binding.binding_version >= 9007199254740991
  ) THEN
    RAISE EXCEPTION
      'Manual-send WAHA binding version is exhausted before transport cutover'
      USING ERRCODE = '22003';
  END IF;
END
$migration_guard$;

ALTER TABLE platform_private.manual_send_waha_runtime_bindings
  DROP CONSTRAINT manual_send_waha_runtime_bindings_waha_base_url_check;

UPDATE platform_private.manual_send_waha_runtime_bindings AS binding
SET
  waha_base_url = 'http://evo-inbox-waha:3000',
  binding_version = binding.binding_version + 1,
  updated_at = pg_catalog.statement_timestamp()
WHERE binding.waha_base_url = 'http://evo-crm-waha:3000';

ALTER TABLE platform_private.manual_send_waha_runtime_bindings
  ALTER COLUMN waha_base_url
    SET DEFAULT 'http://evo-inbox-waha:3000',
  ADD CONSTRAINT manual_send_waha_runtime_bindings_waha_base_url_check
    CHECK (waha_base_url = 'http://evo-inbox-waha:3000');

CREATE OR REPLACE FUNCTION platform.resolve_manual_send_waha_runtime(
  p_organization_id UUID
)
RETURNS TABLE (
  waha_session_name TEXT,
  waha_base_url TEXT,
  waha_api_key TEXT,
  binding_version BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization id is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    binding.waha_session_name,
    binding.waha_base_url,
    secret.decrypted_secret,
    binding.binding_version
  FROM platform_private.manual_send_waha_runtime_bindings AS binding
  JOIN platform.organizations AS organization
    ON organization.id = binding.organization_id
   AND organization.status = 'active'
  JOIN vault.decrypted_secrets AS secret
    ON secret.id = binding.api_key_secret_id
  WHERE binding.organization_id = p_organization_id
    AND binding.enabled
    AND binding.waha_session_name = 'evo-inbox'
    AND binding.waha_base_url = 'http://evo-inbox-waha:3000'
    AND secret.decrypted_secret IS NOT NULL
    AND secret.decrypted_secret = pg_catalog.btrim(secret.decrypted_secret)
    AND pg_catalog.octet_length(secret.decrypted_secret) BETWEEN 16 AND 4096
    AND pg_catalog.strpos(
      secret.decrypted_secret,
      pg_catalog.chr(10)
    ) = 0
    AND pg_catalog.strpos(
      secret.decrypted_secret,
      pg_catalog.chr(13)
    ) = 0;
END
$$;

CREATE OR REPLACE FUNCTION platform.manual_send_waha_runtime_configuration(
  p_organization_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  ready BOOLEAN,
  reason_code TEXT,
  waha_session_name TEXT,
  base_url TEXT,
  binding_version BIGINT,
  api_key_sha256 TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  binding_row RECORD;
  resolved_reason_code TEXT;
  resolved_ready BOOLEAN;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_organization_id = '00000000-0000-0000-0000-000000000000'::UUID
  THEN
    RAISE EXCEPTION 'A non-zero organization id is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organizations AS organization
    WHERE organization.id = p_organization_id
      AND organization.status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active organization is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    binding.organization_id,
    binding.waha_session_name,
    binding.waha_base_url,
    binding.enabled,
    binding.binding_version,
    binding.api_key_sha256,
    binding.updated_at,
    secret.id AS decrypted_secret_id,
    secret.decrypted_secret
  INTO binding_row
  FROM platform_private.manual_send_waha_runtime_bindings AS binding
  LEFT JOIN vault.decrypted_secrets AS secret
    ON secret.id = binding.api_key_secret_id
  WHERE binding.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      p_organization_id,
      FALSE,
      'missing_binding'::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::BIGINT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  resolved_reason_code := CASE
    WHEN NOT binding_row.enabled
      THEN 'binding_disabled'
    WHEN binding_row.waha_session_name <> 'evo-inbox'
      OR binding_row.waha_base_url <> 'http://evo-inbox-waha:3000'
      OR binding_row.binding_version NOT BETWEEN 1 AND 9007199254740991
      OR binding_row.api_key_sha256 !~ '^[0-9a-f]{64}$'
      THEN 'binding_contract_invalid'
    WHEN binding_row.decrypted_secret_id IS NULL
      OR binding_row.decrypted_secret IS NULL
      THEN 'secret_missing'
    WHEN binding_row.decrypted_secret <> pg_catalog.btrim(
        binding_row.decrypted_secret,
        E' \t\n\r\f\v'
      )
      OR pg_catalog.octet_length(binding_row.decrypted_secret)
        NOT BETWEEN 16 AND 4096
      OR pg_catalog.strpos(
        binding_row.decrypted_secret,
        pg_catalog.chr(10)
      ) <> 0
      OR pg_catalog.strpos(
        binding_row.decrypted_secret,
        pg_catalog.chr(13)
      ) <> 0
      THEN 'secret_invalid'
    WHEN pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(binding_row.decrypted_secret, 'UTF8')
      ),
      'hex'
    ) <> binding_row.api_key_sha256
      THEN 'secret_hash_mismatch'
    ELSE 'ready'
  END;
  resolved_ready := resolved_reason_code = 'ready';

  RETURN QUERY
  SELECT
    binding_row.organization_id::UUID,
    resolved_ready,
    resolved_reason_code,
    binding_row.waha_session_name::TEXT,
    binding_row.waha_base_url::TEXT,
    binding_row.binding_version::BIGINT,
    binding_row.api_key_sha256::TEXT,
    binding_row.updated_at::TIMESTAMPTZ;
END
$$;

CREATE OR REPLACE FUNCTION platform.provision_manual_send_waha_runtime(
  p_organization_id UUID,
  p_waha_api_key TEXT,
  p_request_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  ready BOOLEAN,
  reason_code TEXT,
  waha_session_name TEXT,
  base_url TEXT,
  binding_version BIGINT,
  api_key_sha256 TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  key_sha256 TEXT;
  vault_secret_name TEXT;
  vault_secret_description CONSTANT TEXT :=
    'EVO Platform manual-send WAHA API key';
  existing_binding
    platform_private.manual_send_waha_runtime_bindings%ROWTYPE;
  current_decrypted_secret TEXT;
  current_secret_sha256 TEXT;
  created_secret_id UUID;
  prior_audit platform.audit_events%ROWTYPE;
  configuration_row RECORD;
  safe_before_state JSONB;
  safe_after_state JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_organization_id = '00000000-0000-0000-0000-000000000000'::UUID
    OR p_request_id IS NULL
    OR p_request_id = '00000000-0000-0000-0000-000000000000'::UUID
  THEN
    RAISE EXCEPTION 'Non-zero organization and request ids are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_waha_api_key IS NULL
    OR p_waha_api_key <> pg_catalog.btrim(
      p_waha_api_key,
      E' \t\n\r\f\v'
    )
    OR pg_catalog.octet_length(p_waha_api_key) NOT BETWEEN 16 AND 4096
    OR pg_catalog.strpos(p_waha_api_key, pg_catalog.chr(10)) <> 0
    OR pg_catalog.strpos(p_waha_api_key, pg_catalog.chr(13)) <> 0
  THEN
    RAISE EXCEPTION
      'WAHA API key must be trimmed, 16-4096 bytes and contain no CR/LF'
      USING ERRCODE = '22023';
  END IF;

  key_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_waha_api_key, 'UTF8')),
    'hex'
  );

  -- Serialize a request replay globally, then serialize all configuration
  -- mutations for the organization in a consistent lock order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p8r5:manual-send-waha:request:' || p_request_id::TEXT,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p8r5:manual-send-waha:organization:' || p_organization_id::TEXT,
      0
    )
  );

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organizations AS organization
    WHERE organization.id = p_organization_id
      AND organization.status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active organization is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT audit_event.*
  INTO prior_audit
  FROM platform.audit_events AS audit_event
  WHERE audit_event.request_id = p_request_id;

  IF FOUND THEN
    IF prior_audit.organization_id <> p_organization_id
      OR prior_audit.actor_kind <> 'service'
      OR prior_audit.action <> 'configuration.waha.provision'
      OR prior_audit.resource_type <> 'manual_send_waha_runtime'
      OR prior_audit.resource_id <> p_organization_id
      OR prior_audit.after_state ->> 'api_key_sha256'
        IS DISTINCT FROM key_sha256
    THEN
      RAISE EXCEPTION
        'request_id % was already used with different provisioning input',
        p_request_id
        USING ERRCODE = '22023';
    END IF;

    SELECT configuration.*
    INTO configuration_row
    FROM platform.manual_send_waha_runtime_configuration(
      p_organization_id
    ) AS configuration;

    IF configuration_row.ready IS DISTINCT FROM TRUE
      OR configuration_row.reason_code IS DISTINCT FROM 'ready'
      OR configuration_row.waha_session_name IS DISTINCT FROM
        (prior_audit.after_state ->> 'waha_session_name')
      OR configuration_row.base_url IS DISTINCT FROM
        (prior_audit.after_state ->> 'base_url')
      OR configuration_row.binding_version IS DISTINCT FROM
        (prior_audit.after_state ->> 'binding_version')::BIGINT
      OR configuration_row.api_key_sha256 IS DISTINCT FROM
        (prior_audit.after_state ->> 'api_key_sha256')
      OR configuration_row.updated_at IS DISTINCT FROM
        (prior_audit.after_state ->> 'updated_at')::TIMESTAMPTZ
    THEN
      RAISE EXCEPTION
        'request_id % refers to an obsolete manual-send WAHA binding',
        p_request_id
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY
    SELECT
      (prior_audit.after_state ->> 'organization_id')::UUID,
      (prior_audit.after_state ->> 'ready')::BOOLEAN,
      prior_audit.after_state ->> 'reason_code',
      prior_audit.after_state ->> 'waha_session_name',
      prior_audit.after_state ->> 'base_url',
      (prior_audit.after_state ->> 'binding_version')::BIGINT,
      prior_audit.after_state ->> 'api_key_sha256',
      (prior_audit.after_state ->> 'updated_at')::TIMESTAMPTZ;
    RETURN;
  END IF;
  SELECT binding.*
  INTO existing_binding
  FROM platform_private.manual_send_waha_runtime_bindings AS binding
  WHERE binding.organization_id = p_organization_id
  FOR UPDATE;

  vault_secret_name :=
    'evo-manual-send-waha-api-key-' || p_organization_id::TEXT;

  IF FOUND THEN
    SELECT configuration.*
    INTO configuration_row
    FROM platform.manual_send_waha_runtime_configuration(
      p_organization_id
    ) AS configuration;

    safe_before_state := pg_catalog.jsonb_build_object(
      'organization_id', configuration_row.organization_id,
      'ready', configuration_row.ready,
      'reason_code', configuration_row.reason_code,
      'waha_session_name', configuration_row.waha_session_name,
      'base_url', configuration_row.base_url,
      'binding_version', configuration_row.binding_version,
      'api_key_sha256', configuration_row.api_key_sha256,
      'updated_at', configuration_row.updated_at
    );

    SELECT secret.decrypted_secret
    INTO current_decrypted_secret
    FROM vault.decrypted_secrets AS secret
    WHERE secret.id = existing_binding.api_key_secret_id;

    IF current_decrypted_secret IS NOT NULL
      AND current_decrypted_secret = pg_catalog.btrim(
        current_decrypted_secret,
        E' \t\n\r\f\v'
      )
      AND pg_catalog.octet_length(current_decrypted_secret)
        BETWEEN 16 AND 4096
      AND pg_catalog.strpos(
        current_decrypted_secret,
        pg_catalog.chr(10)
      ) = 0
      AND pg_catalog.strpos(
        current_decrypted_secret,
        pg_catalog.chr(13)
      ) = 0
    THEN
      current_secret_sha256 := pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(current_decrypted_secret, 'UTF8')
        ),
        'hex'
      );
    END IF;

    IF NOT existing_binding.enabled
      OR existing_binding.waha_session_name <> 'evo-inbox'
      OR existing_binding.waha_base_url <> 'http://evo-inbox-waha:3000'
      OR existing_binding.api_key_sha256 <> key_sha256
      OR current_secret_sha256 IS DISTINCT FROM key_sha256
    THEN
      IF existing_binding.binding_version >= 9007199254740991 THEN
        RAISE EXCEPTION 'Manual-send WAHA binding version is exhausted'
          USING ERRCODE = '22003';
      END IF;

      PERFORM vault.update_secret(
        existing_binding.api_key_secret_id,
        p_waha_api_key,
        vault_secret_name,
        vault_secret_description
      );

      UPDATE platform_private.manual_send_waha_runtime_bindings AS binding
      SET
        waha_session_name = 'evo-inbox',
        waha_base_url = 'http://evo-inbox-waha:3000',
        enabled = TRUE,
        binding_version = binding.binding_version + 1,
        api_key_sha256 = key_sha256,
        updated_at = pg_catalog.statement_timestamp()
      WHERE binding.organization_id = p_organization_id;
    END IF;
  ELSE
    created_secret_id := vault.create_secret(
      p_waha_api_key,
      vault_secret_name,
      vault_secret_description
    );

    INSERT INTO platform_private.manual_send_waha_runtime_bindings (
      organization_id,
      waha_session_name,
      waha_base_url,
      api_key_secret_id,
      enabled,
      binding_version,
      api_key_sha256
    ) VALUES (
      p_organization_id,
      'evo-inbox',
      'http://evo-inbox-waha:3000',
      created_secret_id,
      TRUE,
      1,
      key_sha256
    );
  END IF;

  SELECT configuration.*
  INTO configuration_row
  FROM platform.manual_send_waha_runtime_configuration(
    p_organization_id
  ) AS configuration;

  IF configuration_row.ready IS DISTINCT FROM TRUE
    OR configuration_row.reason_code <> 'ready'
  THEN
    RAISE EXCEPTION
      'Provisioned manual-send WAHA binding did not pass configuration validation'
      USING ERRCODE = '55000';
  END IF;

  safe_after_state := pg_catalog.jsonb_build_object(
    'organization_id', configuration_row.organization_id,
    'ready', configuration_row.ready,
    'reason_code', configuration_row.reason_code,
    'waha_session_name', configuration_row.waha_session_name,
    'base_url', configuration_row.base_url,
    'binding_version', configuration_row.binding_version,
    'api_key_sha256', configuration_row.api_key_sha256,
    'updated_at', configuration_row.updated_at
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
    'service:manual-send-waha-provisioner',
    'configuration.waha.provision',
    'manual_send_waha_runtime',
    p_organization_id,
    safe_before_state,
    safe_after_state,
    'Provision or rotate the Supabase-owned manual-send WAHA binding',
    p_request_id
  );

  RETURN QUERY
  SELECT
    configuration_row.organization_id::UUID,
    configuration_row.ready::BOOLEAN,
    configuration_row.reason_code::TEXT,
    configuration_row.waha_session_name::TEXT,
    configuration_row.base_url::TEXT,
    configuration_row.binding_version::BIGINT,
    configuration_row.api_key_sha256::TEXT,
    configuration_row.updated_at::TIMESTAMPTZ;
END
$$;

-- Preserve the exact service-only boundary after replacing all three routines.
REVOKE ALL ON FUNCTION platform.resolve_manual_send_waha_runtime(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  platform.manual_send_waha_runtime_configuration(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  platform.provision_manual_send_waha_runtime(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION platform.resolve_manual_send_waha_runtime(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  platform.manual_send_waha_runtime_configuration(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  platform.provision_manual_send_waha_runtime(UUID, TEXT, UUID)
  TO service_role;

COMMIT;
