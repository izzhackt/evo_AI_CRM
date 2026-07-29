\set ON_ERROR_STOP on

DO $bootstrap_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN;
  END IF;
END
$bootstrap_roles$;

-- The pinned Supabase Postgres image creates these cluster roles before this
-- clean test database exists. Fail closed if their security attributes drift.
DO $validate_bootstrap_roles$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'anon',
    'authenticated',
    'service_role'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = role_name
        AND NOT rolcanlogin
    ) THEN
      RAISE EXCEPTION 'Required Supabase role % is missing or can log in', role_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'supabase_auth_admin'
  ) THEN
    RAISE EXCEPTION 'Required Supabase role supabase_auth_admin is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'service_role'
      AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'Required Supabase service_role must bypass RLS';
  END IF;

  IF NOT pg_has_role('postgres', 'supabase_admin', 'SET') THEN
    RAISE EXCEPTION 'Disposable migration actor cannot administer provider-owned extensions';
  END IF;
END
$validate_bootstrap_roles$;

DO $validate_bootstrap_memberships$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'anon',
    'authenticated',
    'service_role',
    'supabase_auth_admin'
  ]
  LOOP
    IF NOT pg_has_role('postgres', role_name, 'SET') THEN
      RAISE EXCEPTION 'postgres cannot SET ROLE % in the authorization harness', role_name;
    END IF;
  END LOOP;
END
$validate_bootstrap_memberships$;

-- Adversarial drift fixture for migration 040: IF NOT EXISTS alone would keep
-- authenticated as schema owner, allowing that role to re-grant itself CREATE.
-- The migration must converge both namespaces back to the trusted owner.
CREATE SCHEMA platform AUTHORIZATION authenticated;
CREATE SCHEMA platform_private AUTHORIZATION authenticated;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  raw_user_meta_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE SQL
STABLE
SET search_path = ''
AS $$
  SELECT (
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::UUID
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS JSONB
LANGUAGE SQL
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::JSONB,
    '{}'::JSONB
  )
$$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT FALSE,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[]
);
CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL REFERENCES storage.buckets(id),
  name TEXT NOT NULL
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SET search_path = ''
AS $$
  SELECT (string_to_array(name, '/'))[
    1:GREATEST(array_length(string_to_array(name, '/'), 1) - 1, 0)
  ]
$$;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE PUBLICATION supabase_realtime;

GRANT USAGE ON SCHEMA public, auth, storage
  TO anon, authenticated, service_role, supabase_auth_admin;

-- Model a provider-owned Supabase Queues API surface that exists before the
-- application migrations run. Migration 040 must remove browser access without
-- taking service_role access away from provider workers.
CREATE SCHEMA pgmq_public;
CREATE TABLE pgmq_public.queue_probe (
  id BIGINT PRIMARY KEY
);
CREATE SEQUENCE pgmq_public.queue_probe_sequence;
CREATE FUNCTION pgmq_public.queue_probe()
RETURNS INTEGER
LANGUAGE SQL
AS $$
  SELECT 1
$$;
GRANT USAGE ON SCHEMA pgmq_public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pgmq_public.queue_probe
  TO anon, authenticated, service_role;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE pgmq_public.queue_probe_sequence
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pgmq_public.queue_probe()
  TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
GRANT SELECT ON storage.objects TO anon;
