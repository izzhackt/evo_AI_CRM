\set ON_ERROR_STOP on

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

GRANT anon, authenticated, service_role TO postgres;

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

GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;

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
