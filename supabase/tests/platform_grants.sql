\set ON_ERROR_STOP on

-- P2B creates namespace and authorization boundaries only. It must not create
-- Platform domain tables, roles, memberships, or signup side effects.
DO $$
DECLARE
  platform_relation_count INTEGER;
  platform_owner NAME;
  platform_private_owner NAME;
BEGIN
  IF to_regnamespace('platform') IS NULL THEN
    RAISE EXCEPTION 'platform schema is missing';
  END IF;
  IF to_regnamespace('platform_private') IS NULL THEN
    RAISE EXCEPTION 'platform_private schema is missing';
  END IF;

  SELECT pg_get_userbyid(nspowner)
  INTO platform_owner
  FROM pg_namespace
  WHERE nspname = 'platform';

  SELECT pg_get_userbyid(nspowner)
  INTO platform_private_owner
  FROM pg_namespace
  WHERE nspname = 'platform_private';

  IF platform_owner <> 'postgres'
    OR platform_private_owner <> 'postgres'
  THEN
    RAISE EXCEPTION
      'Platform schemas must converge to postgres ownership; found platform=%, platform_private=%',
      platform_owner,
      platform_private_owner;
  END IF;

  SELECT count(*)
  INTO platform_relation_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('platform', 'platform_private');

  IF platform_relation_count <> 0 THEN
    RAISE EXCEPTION
      'P2B must not create Platform relations; found %',
      platform_relation_count;
  END IF;

  IF pg_get_functiondef('public.handle_new_user()'::regprocedure)
    ~* 'platform(_private)?\.'
  THEN
    RAISE EXCEPTION
      'legacy signup trigger must not create Platform identities or memberships';
  END IF;
END
$$;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '00000000-0000-0000-0000-000000000040',
  'p2b-signup-probe@example.test',
  '{"full_name":"P2B Signup Probe"}'::jsonb
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('platform', 'platform_private')
  ) THEN
    RAISE EXCEPTION
      'legacy signup created a Platform relation or membership side effect';
  END IF;
END
$$;

-- Schema access is explicit: platform is visible only to authenticated clients
-- and service_role, while platform_private and pgmq_public are backend-only.
DO $$
BEGIN
  IF has_schema_privilege('anon', 'platform', 'USAGE')
  THEN
    RAISE EXCEPTION 'anonymous clients must not access platform';
  END IF;

  IF NOT has_schema_privilege('authenticated', 'platform', 'USAGE') THEN
    RAISE EXCEPTION 'authenticated clients must be able to resolve platform';
  END IF;

  IF has_schema_privilege('anon', 'platform', 'CREATE')
    OR has_schema_privilege('authenticated', 'platform', 'CREATE')
  THEN
    RAISE EXCEPTION 'browser roles must not create objects in platform';
  END IF;

  IF has_schema_privilege('anon', 'platform_private', 'USAGE')
    OR has_schema_privilege('authenticated', 'platform_private', 'USAGE')
    OR has_schema_privilege('anon', 'platform_private', 'CREATE')
    OR has_schema_privilege('authenticated', 'platform_private', 'CREATE')
  THEN
    RAISE EXCEPTION 'browser roles must not access platform_private';
  END IF;

  IF NOT has_schema_privilege('service_role', 'platform', 'USAGE')
    OR NOT has_schema_privilege('service_role', 'platform_private', 'USAGE')
  THEN
    RAISE EXCEPTION 'service_role must retain Platform schema usage';
  END IF;

  IF has_schema_privilege('service_role', 'platform', 'CREATE')
    OR has_schema_privilege('service_role', 'platform_private', 'CREATE')
  THEN
    RAISE EXCEPTION 'service_role must not create Platform schema objects';
  END IF;

  IF has_schema_privilege('anon', 'pgmq_public', 'USAGE')
    OR has_schema_privilege('authenticated', 'pgmq_public', 'USAGE')
  THEN
    RAISE EXCEPTION 'browser roles must not access pgmq_public';
  END IF;

  IF NOT has_schema_privilege('service_role', 'pgmq_public', 'USAGE')
    OR NOT has_table_privilege(
      'service_role',
      'pgmq_public.queue_probe',
      'SELECT'
    )
    OR NOT has_function_privilege(
      'service_role',
      'pgmq_public.queue_probe()',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'P2B must preserve provider service_role queue access';
  END IF;

  IF has_table_privilege('anon', 'pgmq_public.queue_probe', 'SELECT')
    OR has_table_privilege(
      'authenticated',
      'pgmq_public.queue_probe',
      'SELECT'
    )
    OR has_function_privilege(
      'anon',
      'pgmq_public.queue_probe()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'pgmq_public.queue_probe()',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'P2B must contain provider queue API objects';
  END IF;
END
$$;

-- Every legacy secret-bearing table is service-only at both the object and RLS
-- layers. This prevents an accidental future table grant from reviving the old
-- full-row browser policies.
DO $$
DECLARE
  table_name TEXT;
  privilege_name TEXT;
  excess_privilege_name TEXT;
  unexpected_policy_count INTEGER;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'whatsapp_config',
    'ai_configs',
    'webhook_endpoints',
    'api_keys',
    'integration_secrets'
  ]
  LOOP
    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE'
    ]
    LOOP
      IF has_table_privilege(
        'anon',
        format('public.%I', table_name),
        privilege_name
      ) THEN
        RAISE EXCEPTION
          'anon unexpectedly has % on public.%',
          privilege_name,
          table_name;
      END IF;

      IF has_table_privilege(
        'authenticated',
        format('public.%I', table_name),
        privilege_name
      ) THEN
        RAISE EXCEPTION
          'authenticated unexpectedly has % on public.%',
          privilege_name,
          table_name;
      END IF;

      IF NOT has_table_privilege(
        'service_role',
        format('public.%I', table_name),
        privilege_name
      ) THEN
        RAISE EXCEPTION
          'service_role is missing % on public.%',
          privilege_name,
          table_name;
      END IF;
    END LOOP;

    FOREACH excess_privilege_name IN ARRAY ARRAY[
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    LOOP
      IF has_table_privilege(
        'service_role',
        format('public.%I', table_name),
        excess_privilege_name
      ) THEN
        RAISE EXCEPTION
          'service_role unexpectedly has % on public.%',
          excess_privilege_name,
          table_name;
      END IF;
    END LOOP;
  END LOOP;

  SELECT count(*)
  INTO unexpected_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'whatsapp_config',
      'ai_configs',
      'webhook_endpoints',
      'api_keys',
      'integration_secrets'
    ]);

  IF unexpected_policy_count <> 0 THEN
    RAISE EXCEPTION
      'secret-bearing tables retain % browser RLS policies',
      unexpected_policy_count;
  END IF;
END
$$;

-- Exercise real permission errors, not only catalog predicates.
\set ON_ERROR_STOP off
SET ROLE anon;
SELECT count(*) FROM public.whatsapp_config;
\set anon_denial_sqlstate :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

SELECT :'anon_denial_sqlstate' = '42501' AS anon_denied \gset
\if :anon_denied
\else
  \echo 'anon SELECT on whatsapp_config did not fail with insufficient_privilege'
  \quit 1
\endif

\set ON_ERROR_STOP off
SET ROLE authenticated;
SELECT access_token FROM public.whatsapp_config LIMIT 1;
\set whatsapp_secret_denial_sqlstate :SQLSTATE
SELECT api_key, embeddings_api_key FROM public.ai_configs LIMIT 1;
\set ai_secret_denial_sqlstate :SQLSTATE
SELECT secret FROM public.webhook_endpoints LIMIT 1;
\set webhook_secret_denial_sqlstate :SQLSTATE
SELECT key_hash FROM public.api_keys LIMIT 1;
\set api_key_hash_denial_sqlstate :SQLSTATE
SELECT encrypted_value FROM public.integration_secrets LIMIT 1;
\set integration_secret_denial_sqlstate :SQLSTATE
INSERT INTO public.integration_secrets DEFAULT VALUES;
\set integration_secret_write_denial_sqlstate :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

SELECT :'whatsapp_secret_denial_sqlstate' = '42501' AS expected \gset
\if :expected
\else
  \echo 'authenticated access_token SELECT did not fail with insufficient_privilege'
  \quit 1
\endif

SELECT :'ai_secret_denial_sqlstate' = '42501' AS expected \gset
\if :expected
\else
  \echo 'authenticated AI secret SELECT did not fail with insufficient_privilege'
  \quit 1
\endif

SELECT :'webhook_secret_denial_sqlstate' = '42501' AS expected \gset
\if :expected
\else
  \echo 'authenticated webhook secret SELECT did not fail with insufficient_privilege'
  \quit 1
\endif

SELECT :'api_key_hash_denial_sqlstate' = '42501' AS expected \gset
\if :expected
\else
  \echo 'authenticated API key hash SELECT did not fail with insufficient_privilege'
  \quit 1
\endif

SELECT :'integration_secret_denial_sqlstate' = '42501' AS expected \gset
\if :expected
\else
  \echo 'authenticated integration secret SELECT did not fail with insufficient_privilege'
  \quit 1
\endif

SELECT :'integration_secret_write_denial_sqlstate' = '42501' AS expected \gset
\if :expected
\else
  \echo 'authenticated integration secret INSERT did not fail with insufficient_privilege'
  \quit 1
\endif

SET ROLE service_role;
SELECT count(*) FROM public.whatsapp_config;
SELECT count(*) FROM public.ai_configs;
SELECT count(*) FROM public.webhook_endpoints;
SELECT count(*) FROM public.api_keys;
SELECT count(*) FROM public.integration_secrets;
RESET ROLE;

-- Create disposable objects as the same postgres owner used by migrations.
-- Their effective privileges prove the default ACLs fail closed for browser
-- roles and remain usable by service_role.
CREATE TABLE platform.p2b_default_table_probe (
  id INTEGER PRIMARY KEY
);
CREATE SEQUENCE platform.p2b_default_sequence_probe;
CREATE FUNCTION platform.p2b_default_function_probe()
RETURNS INTEGER
LANGUAGE SQL
AS $$
  SELECT 1
$$;
CREATE TYPE platform.p2b_default_type_probe AS ENUM ('ok');

CREATE TABLE platform_private.p2b_default_table_probe (
  id INTEGER PRIMARY KEY
);
CREATE SEQUENCE platform_private.p2b_default_sequence_probe;
CREATE FUNCTION platform_private.p2b_default_function_probe()
RETURNS INTEGER
LANGUAGE SQL
AS $$
  SELECT 1
$$;
CREATE TYPE platform_private.p2b_default_type_probe AS ENUM ('ok');

DO $$
DECLARE
  schema_name TEXT;
  role_name TEXT;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY['platform', 'platform_private']
  LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF has_table_privilege(
        role_name,
        format('%I.p2b_default_table_probe', schema_name),
        'SELECT'
      ) THEN
        RAISE EXCEPTION
          '% received a default table privilege in %',
          role_name,
          schema_name;
      END IF;

      IF has_sequence_privilege(
          role_name,
          format('%I.p2b_default_sequence_probe', schema_name),
          'USAGE'
        ) THEN
        RAISE EXCEPTION
          '% received a default sequence privilege in %',
          role_name,
          schema_name;
      END IF;

      IF has_function_privilege(
          role_name,
          format('%I.p2b_default_function_probe()', schema_name),
          'EXECUTE'
        ) THEN
        RAISE EXCEPTION
          '% received a default function privilege in %',
          role_name,
          schema_name;
      END IF;

      IF has_type_privilege(
          role_name,
          format('%I.p2b_default_type_probe', schema_name),
          'USAGE'
        ) THEN
        RAISE EXCEPTION
          '% received a default type privilege in %',
          role_name,
          schema_name;
      END IF;
    END LOOP;

    IF NOT has_table_privilege(
      'service_role',
      format('%I.p2b_default_table_probe', schema_name),
      'SELECT'
    )
      OR NOT has_sequence_privilege(
        'service_role',
        format('%I.p2b_default_sequence_probe', schema_name),
        'USAGE'
      )
      OR NOT has_function_privilege(
        'service_role',
        format('%I.p2b_default_function_probe()', schema_name),
        'EXECUTE'
      )
      OR NOT has_type_privilege(
        'service_role',
        format('%I.p2b_default_type_probe', schema_name),
        'USAGE'
      )
    THEN
      RAISE EXCEPTION
        'service_role is missing a default object privilege in %',
        schema_name;
    END IF;

    IF has_table_privilege(
      'service_role',
      format('%I.p2b_default_table_probe', schema_name),
      'TRUNCATE'
    )
      OR has_table_privilege(
        'service_role',
        format('%I.p2b_default_table_probe', schema_name),
        'REFERENCES'
      )
      OR has_table_privilege(
        'service_role',
        format('%I.p2b_default_table_probe', schema_name),
        'TRIGGER'
      )
    THEN
      RAISE EXCEPTION
        'service_role received excessive default table privileges in %',
        schema_name;
    END IF;
  END LOOP;
END
$$;

DROP FUNCTION platform.p2b_default_function_probe();
DROP SEQUENCE platform.p2b_default_sequence_probe;
DROP TABLE platform.p2b_default_table_probe;
DROP TYPE platform.p2b_default_type_probe;

DROP FUNCTION platform_private.p2b_default_function_probe();
DROP SEQUENCE platform_private.p2b_default_sequence_probe;
DROP TABLE platform_private.p2b_default_table_probe;
DROP TYPE platform_private.p2b_default_type_probe;

-- Targeted 038/039 regressions: private helper exposure remains narrow, the
-- chat-media bucket remains private, and media-audit writes remain server-only.
DO $$
DECLARE
  chat_media_public BOOLEAN;
BEGIN
  IF has_schema_privilege('authenticated', 'private', 'CREATE') THEN
    RAISE EXCEPTION 'migration 038 private schema CREATE containment regressed';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'private.is_account_member(uuid,public.account_role_enum)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'migration 038 membership helper grant regressed';
  END IF;

  SELECT public
  INTO chat_media_public
  FROM storage.buckets
  WHERE id = 'chat-media';

  IF chat_media_public IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'migration 039 chat-media bucket privacy regressed';
  END IF;

  IF has_table_privilege(
    'authenticated',
    'public.media_audit_events',
    'INSERT'
  )
    OR NOT has_table_privilege(
      'service_role',
      'public.media_audit_events',
      'INSERT'
    )
  THEN
    RAISE EXCEPTION 'migration 039 media audit grant containment regressed';
  END IF;
END
$$;
