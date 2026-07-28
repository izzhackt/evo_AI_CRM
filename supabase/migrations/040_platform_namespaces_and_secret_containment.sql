-- ============================================================
-- 040_platform_namespaces_and_secret_containment.sql
--
-- Establishes the Platform schema boundary without creating any Platform
-- domain tables or memberships. `platform` is eligible for Data API exposure,
-- while `platform_private` remains backend-only.
--
-- Existing Inbox tables that contain encrypted credentials, hashes, or other
-- secret-bearing values become service-role-only. Application routes must
-- authorize the human actor first, then perform these reads and writes through
-- a server-side service-role client.
--
-- Idempotent: schemas use IF NOT EXISTS and converge to the trusted migration
-- owner; grants, revokes, default privileges, and policy drops may be applied
-- repeatedly.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION postgres;
CREATE SCHEMA IF NOT EXISTS platform_private AUTHORIZATION postgres;

-- Refuse to silently adopt objects created under an unexpected owner. Later
-- Platform migrations run as postgres, so a non-postgres-owned relation,
-- routine, or type here is drift that must be inspected before continuing.
DO $$
DECLARE
  unexpected_object TEXT;
BEGIN
  SELECT string_agg(
    format('%I.%I (%s, owner=%I)', schema_name, object_name, object_kind, owner_name),
    ', '
    ORDER BY schema_name, object_kind, object_name
  )
  INTO unexpected_object
  FROM (
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS object_name,
      'relation'::TEXT AS object_kind,
      pg_get_userbyid(relation.relowner) AS owner_name
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('platform', 'platform_private')

    UNION ALL

    SELECT
      namespace.nspname,
      routine.proname,
      'routine'::TEXT,
      pg_get_userbyid(routine.proowner)
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname IN ('platform', 'platform_private')

    UNION ALL

    SELECT
      namespace.nspname,
      type_entry.typname,
      'type'::TEXT,
      pg_get_userbyid(type_entry.typowner)
    FROM pg_type AS type_entry
    JOIN pg_namespace AS namespace
      ON namespace.oid = type_entry.typnamespace
    WHERE namespace.nspname IN ('platform', 'platform_private')
  ) AS schema_object
  WHERE owner_name <> 'postgres';

  IF unexpected_object IS NOT NULL THEN
    RAISE EXCEPTION
      'Platform schema owner drift contains non-postgres objects: %',
      unexpected_object;
  END IF;
END
$$;

-- IF NOT EXISTS preserves the owner of a pre-existing schema. Normalize both
-- owners before granting anything so a browser role cannot retain schema-owner
-- authority and later re-grant itself CREATE after the explicit REVOKEs below.
ALTER SCHEMA platform OWNER TO postgres;
ALTER SCHEMA platform_private OWNER TO postgres;

-- PostgreSQL's built-in defaults grant EXECUTE on new functions and USAGE on
-- new types to PUBLIC. A per-schema default ACL cannot subtract a global
-- default, so remove those implicit postgres-owner defaults globally. Later
-- migrations must grant every public routine/type deliberately.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE USAGE ON TYPES FROM PUBLIC;

-- Exposing a schema through PostgREST does not itself grant object access.
-- Authenticated clients may resolve `platform`, but cannot create objects there
-- and receive no blanket table, sequence, or function privileges. Anonymous
-- access is not required by the current product contract.
REVOKE ALL PRIVILEGES ON SCHEMA platform
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA platform
  TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA platform
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA platform
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA platform
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA platform TO service_role;
GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA platform TO service_role;
GRANT EXECUTE
  ON ALL FUNCTIONS IN SCHEMA platform TO service_role;

-- New postgres-owned objects remain fail-closed for browser roles. A later
-- migration must grant each reviewed browser operation explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  REVOKE ALL PRIVILEGES ON TABLES
  FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  REVOKE ALL PRIVILEGES ON FUNCTIONS
  FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  REVOKE ALL PRIVILEGES ON TYPES
  FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  GRANT USAGE ON TYPES TO service_role;

-- The private namespace is not a browser API surface. Only the migration owner
-- can create objects; service_role may use reviewed current and future objects.
REVOKE ALL PRIVILEGES ON SCHEMA platform_private
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA platform_private TO service_role;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA platform_private
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA platform_private
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA platform_private
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA platform_private TO service_role;
GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA platform_private TO service_role;
GRANT EXECUTE
  ON ALL FUNCTIONS IN SCHEMA platform_private TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  REVOKE ALL PRIVILEGES ON TABLES
  FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  REVOKE ALL PRIVILEGES ON FUNCTIONS
  FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  REVOKE ALL PRIVILEGES ON TYPES
  FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  GRANT USAGE ON TYPES TO service_role;

-- Supabase Queues may create pgmq_public before this migration. Contain any
-- provider-supplied API objects without assuming that the extension is present
-- in every disposable test or development database.
DO $$
BEGIN
  IF to_regnamespace('pgmq_public') IS NOT NULL THEN
    EXECUTE
      'REVOKE ALL PRIVILEGES ON SCHEMA pgmq_public FROM PUBLIC, anon, authenticated';
    EXECUTE
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA pgmq_public FROM PUBLIC, anon, authenticated';
    EXECUTE
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pgmq_public FROM PUBLIC, anon, authenticated';
    EXECUTE
      'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA pgmq_public FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;

-- These legacy tables contain ciphertext, provider secrets, or credential
-- verification hashes. RLS is retained as defense in depth, but no browser role
-- has object privileges and no permissive browser policy remains.
REVOKE ALL PRIVILEGES ON TABLE
  public.whatsapp_config,
  public.ai_configs,
  public.webhook_endpoints,
  public.api_keys,
  public.integration_secrets
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.whatsapp_config,
  public.ai_configs,
  public.webhook_endpoints,
  public.api_keys,
  public.integration_secrets
TO service_role;

DROP POLICY IF EXISTS "Users can manage own config"
  ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_select
  ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_insert
  ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_update
  ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_delete
  ON public.whatsapp_config;

DROP POLICY IF EXISTS ai_configs_select
  ON public.ai_configs;
DROP POLICY IF EXISTS ai_configs_insert
  ON public.ai_configs;
DROP POLICY IF EXISTS ai_configs_update
  ON public.ai_configs;
DROP POLICY IF EXISTS ai_configs_delete
  ON public.ai_configs;

DROP POLICY IF EXISTS webhook_endpoints_select
  ON public.webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_insert
  ON public.webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_update
  ON public.webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_delete
  ON public.webhook_endpoints;

DROP POLICY IF EXISTS api_keys_select
  ON public.api_keys;
DROP POLICY IF EXISTS api_keys_insert
  ON public.api_keys;
DROP POLICY IF EXISTS api_keys_update
  ON public.api_keys;
DROP POLICY IF EXISTS api_keys_delete
  ON public.api_keys;

DROP POLICY IF EXISTS integration_secrets_insert
  ON public.integration_secrets;
DROP POLICY IF EXISTS integration_secrets_update
  ON public.integration_secrets;
DROP POLICY IF EXISTS integration_secrets_delete
  ON public.integration_secrets;
