\set ON_ERROR_STOP on

\set owner_id 00000000-0000-0000-0000-000000000001
\set admin_id 00000000-0000-0000-0000-000000000002
\set agent_id 00000000-0000-0000-0000-000000000003
\set outsider_id 00000000-0000-0000-0000-000000000004
\set cross_contact_id 10000000-0000-0000-0000-000000000001
\set derived_contact_id 10000000-0000-0000-0000-000000000002

-- Real auth.users inserts exercise the production signup trigger. The fixture
-- is then arranged as one owner/admin/agent account plus an unrelated account.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'owner_id', 'owner@example.test', '{"full_name":"Owner"}'),
  (:'admin_id', 'admin@example.test', '{"full_name":"Admin"}'),
  (:'agent_id', 'agent@example.test', '{"full_name":"Agent"}'),
  (:'outsider_id', 'outsider@example.test', '{"full_name":"Outsider"}');

SELECT id AS account_one_id
FROM public.accounts
WHERE owner_user_id = :'owner_id'
\gset

SELECT id AS admin_personal_account_id
FROM public.accounts
WHERE owner_user_id = :'admin_id'
\gset

SELECT id AS agent_personal_account_id
FROM public.accounts
WHERE owner_user_id = :'agent_id'
\gset

SELECT id AS account_two_id
FROM public.accounts
WHERE owner_user_id = :'outsider_id'
\gset

UPDATE public.profiles
SET account_id = :'account_one_id',
    account_role = 'admin'
WHERE user_id = :'admin_id';

UPDATE public.profiles
SET account_id = :'account_one_id',
    account_role = 'agent'
WHERE user_id = :'agent_id';

DELETE FROM public.accounts
WHERE id IN (:'admin_personal_account_id', :'agent_personal_account_id');

INSERT INTO public.contacts (
  id,
  user_id,
  account_id,
  phone,
  name
)
VALUES (
  :'cross_contact_id',
  :'outsider_id',
  :'account_two_id',
  '996555000004',
  'Other account'
);

-- K2 knowledge audiences are enforced by RLS and SECURITY INVOKER retrieval,
-- not merely by route code. Seed both audiences as the database owner, then
-- exercise the exact authenticated roles used by the application.
INSERT INTO public.ai_knowledge_documents (
  id, account_id, created_by, audience, title, content
)
VALUES
  ('20000000-0000-0000-0000-000000000001', :'account_one_id', :'owner_id', 'client', 'Client knowledge', 'clienttoken'),
  ('20000000-0000-0000-0000-000000000002', :'account_one_id', :'owner_id', 'internal', 'Internal knowledge', 'internaltoken'),
  ('20000000-0000-0000-0000-000000000003', :'account_two_id', :'outsider_id', 'client', 'Other account knowledge', 'othertoken');

INSERT INTO public.ai_knowledge_chunks (
  id, document_id, account_id, audience, chunk_index, content
)
VALUES
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', :'account_one_id', 'client', 0, 'clienttoken'),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', :'account_one_id', 'internal', 0, 'internaltoken'),
  ('21000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', :'account_two_id', 'client', 0, 'othertoken');

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}',
  false
);

SELECT (
  SELECT count(*) = 2 FROM public.ai_knowledge_documents
) AND (
  SELECT count(*) = 2 FROM public.ai_knowledge_chunks
) AS expected \gset
\if :expected
\else
  \echo 'FAIL: same-account agent cannot read both knowledge audiences or can read another account'
  SELECT 1 / 0;
\endif

SELECT (
  SELECT count(*) = 1
  FROM public.match_ai_knowledge_fts(:'account_one_id', 'client', 'clienttoken', 5)
) AND (
  SELECT count(*) = 0
  FROM public.match_ai_knowledge_fts(:'account_one_id', 'client', 'internaltoken', 5)
) AND (
  SELECT count(*) = 0
  FROM public.match_ai_knowledge_fts(:'account_two_id', 'client', 'othertoken', 5)
) AND (
  SELECT count(*) = 0
  FROM public.match_ai_knowledge_fts(:'account_one_id', 'invalid', 'clienttoken', 5)
) AS expected \gset
\if :expected
\else
  \echo 'FAIL: knowledge retrieval crossed audience/account boundaries'
  SELECT 1 / 0;
\endif

RESET ROLE;
UPDATE public.profiles
SET account_role = 'viewer'
WHERE user_id = :'agent_id';

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}',
  false
);
SELECT (
  SELECT count(*) = 0 FROM public.ai_knowledge_documents
) AND (
  SELECT count(*) = 0
  FROM public.match_ai_knowledge_fts(:'account_one_id', 'client', 'clienttoken', 5)
) AS expected \gset
\if :expected
\else
  \echo 'FAIL: viewer read staff-only knowledge'
  SELECT 1 / 0;
\endif

RESET ROLE;
UPDATE public.profiles
SET account_role = 'agent'
WHERE user_id = :'agent_id';

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  false
);

\set ON_ERROR_STOP off
INSERT INTO public.ai_knowledge_documents (
  account_id, created_by, audience, title, content
) VALUES (
  :'account_one_id', :'admin_id', 'client', 'Forbidden client write', 'blocked'
);
\set client_insert_state :SQLSTATE
UPDATE public.ai_knowledge_documents
SET content = 'blocked update'
WHERE id = '20000000-0000-0000-0000-000000000001';
\set client_update_state :SQLSTATE
DELETE FROM public.ai_knowledge_documents
WHERE id = '20000000-0000-0000-0000-000000000001';
\set client_delete_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT :'client_insert_state' = '42501'
  AND :'client_update_state' = '00000'
  AND :'client_delete_state' = '00000'
  AND EXISTS (
    SELECT 1 FROM public.ai_knowledge_documents
    WHERE id = '20000000-0000-0000-0000-000000000001'
      AND content = 'clienttoken'
  ) AS expected \gset
\if :expected
\else
  \echo 'FAIL: authenticated admin mutated client-managed knowledge'
  SELECT 1 / 0;
\endif

INSERT INTO public.ai_knowledge_documents (
  account_id, created_by, audience, title, content
) VALUES (
  :'account_one_id', :'admin_id', 'internal', 'Allowed internal write', 'allowed'
);

RESET ROLE;

-- Catalog inventory and hardening assertions. These query the migrated
-- database, not SQL source text.
DO $$
DECLARE
  missing_rls TEXT;
  unsafe_definer TEXT;
  unexpected_authenticated_rpc TEXT;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY 1)
  INTO missing_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity;

  IF missing_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Exposed tables without RLS: %', missing_rls;
  END IF;

  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'storage.objects'::regclass
  ) THEN
    RAISE EXCEPTION 'storage.objects must have RLS enabled';
  END IF;

  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'API roles retain CREATE on exposed public schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND (
        has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE')
      )
  ) THEN
    RAISE EXCEPTION 'anon retains DML on an exposed relation';
  END IF;

  SELECT string_agg(p.oid::regprocedure::TEXT, ', ' ORDER BY p.oid::regprocedure::TEXT)
  INTO unsafe_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND acl.grantee = 0
    AND acl.privilege_type = 'EXECUTE';

  IF unsafe_definer IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLIC can execute SECURITY DEFINER functions: %', unsafe_definer;
  END IF;

  SELECT string_agg(p.oid::regprocedure::TEXT, ', ' ORDER BY p.oid::regprocedure::TEXT)
  INTO unexpected_authenticated_rpc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.proname NOT IN (
      'filter_contacts_by_tags',
      'peek_invitation',
      'redeem_invitation',
      'remove_account_member',
      'set_member_role',
      'touch_presence',
      'transfer_account_ownership'
    )
    AND p.oid::regprocedure::TEXT NOT IN (
      'match_ai_knowledge_fts(uuid,text,text,integer)',
      'match_ai_knowledge_semantic(uuid,text,text,integer)'
    );

  IF unexpected_authenticated_rpc IS NOT NULL THEN
    RAISE EXCEPTION
      'authenticated can execute unreviewed public functions: %',
      unexpected_authenticated_rpc;
  END IF;

  IF to_regprocedure('public.match_ai_knowledge_fts(uuid,text,integer)') IS NOT NULL
     OR to_regprocedure('public.match_ai_knowledge_semantic(uuid,text,integer)') IS NOT NULL
     OR NOT has_function_privilege(
       'authenticated',
       'public.match_ai_knowledge_fts(uuid,text,text,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.match_ai_knowledge_semantic(uuid,text,text,integer)',
       'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_proc
       WHERE oid IN (
         'public.match_ai_knowledge_fts(uuid,text,text,integer)'::regprocedure,
         'public.match_ai_knowledge_semantic(uuid,text,text,integer)'::regprocedure
       )
         AND prosecdef
     ) THEN
    RAISE EXCEPTION 'Knowledge retrieval RPC signatures/grants are unsafe';
  END IF;

  IF to_regprocedure(
    'public.is_account_member(uuid,account_role_enum)'
  ) IS NOT NULL
     OR to_regprocedure(
       'private.is_account_member(uuid,public.account_role_enum)'
     ) IS NULL
     OR NOT has_function_privilege(
       'authenticated',
       'private.is_account_member(uuid,public.account_role_enum)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'private.is_account_member(uuid,public.account_role_enum)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Membership policy helper is not private and policy-executable';
  END IF;
END;
$$;

-- Ordinary staff cannot self-promote, move their membership, manufacture a
-- profile, mutate account ownership, call privileged RPCs, or affect another
-- account. Each expected failure is executed as the real authenticated role
-- with PostgREST-compatible JWT claims.
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}',
  false
);

\set ON_ERROR_STOP off
UPDATE public.profiles
SET account_role = 'owner'
WHERE user_id = :'agent_id';
\set profile_role_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'profile_role_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: ordinary staff changed profile.account_role'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
UPDATE public.profiles
SET account_id = :'account_two_id'
WHERE user_id = :'agent_id';
\set profile_account_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'profile_account_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: ordinary staff changed profile.account_id'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
VALUES (
  '00000000-0000-0000-0000-000000000099',
  'Forged',
  'forged@example.test',
  :'account_one_id',
  'owner'
);
\set profile_insert_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'profile_insert_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: ordinary staff inserted a profile'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
UPDATE public.accounts
SET owner_user_id = :'agent_id'
WHERE id = :'account_one_id';
\set account_owner_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'account_owner_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: ordinary staff changed account owner'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
SELECT public.set_member_role(:'admin_id', 'viewer');
\set agent_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'agent_rpc_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: ordinary staff called privileged role RPC'
  SELECT 1 / 0;
\endif

-- Hostile ownership values are not trusted on insert: the trigger derives the
-- current user's real account_id and user_id.
INSERT INTO public.contacts (
  id,
  user_id,
  account_id,
  phone,
  name
)
VALUES (
  :'derived_contact_id',
  :'outsider_id',
  :'account_two_id',
  '996555000003',
  'Derived tenancy'
);

SELECT (
  user_id = :'agent_id'::UUID
  AND account_id = :'account_one_id'::UUID
) AS expected
FROM public.contacts
WHERE id = :'derived_contact_id'
\gset
\if :expected
\else
  \echo 'FAIL: authenticated insert retained hostile ownership values'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
UPDATE public.contacts
SET account_id = :'account_two_id'
WHERE id = :'derived_contact_id';
\set contact_move_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'contact_move_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: ordinary staff moved a contact across accounts'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
UPDATE public.contacts
SET amo_contact_id = 'forged-provider-id'
WHERE id = :'derived_contact_id';
\set provider_field_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'provider_field_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: ordinary staff changed a provider-owned field'
  SELECT 1 / 0;
\endif

\set cross_storage_name 'account-' :account_two_id '/forged.pdf'
\set ON_ERROR_STOP off
INSERT INTO storage.objects (bucket_id, name)
VALUES ('chat-media', :'cross_storage_name');
\set cross_storage_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'cross_storage_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: ordinary staff wrote into another account storage path'
  SELECT 1 / 0;
\endif

DELETE FROM public.contacts WHERE id = :'cross_contact_id';
RESET ROLE;

SELECT NOT EXISTS (
  SELECT 1 FROM public.contacts WHERE id = :'cross_contact_id'
) AS expected
\gset
\if :expected
  \echo 'FAIL: RLS exposed a cross-account contact to ordinary staff'
  SELECT 1 / 0;
\endif

-- Privileged staff still cannot directly self-promote or change ownership.
-- The reviewed RPC succeeds for an in-account target and rejects a target from
-- another account.
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  false
);

\set ON_ERROR_STOP off
UPDATE public.profiles
SET account_role = 'owner'
WHERE user_id = :'admin_id';
\set admin_self_promote_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'admin_self_promote_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: admin directly self-promoted'
  SELECT 1 / 0;
\endif

SELECT public.set_member_role(:'agent_id', 'viewer');

SELECT account_role = 'viewer' AS expected
FROM public.profiles
WHERE user_id = :'agent_id'
\gset
\if :expected
\else
  \echo 'FAIL: reviewed admin role RPC did not update in-account member'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
SELECT public.set_member_role(:'outsider_id', 'agent');
\set cross_account_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'cross_account_rpc_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: admin role RPC crossed account boundary'
  SELECT 1 / 0;
\endif

RESET ROLE;

-- Anonymous callers have neither table DML nor privileged RPC execution.
SET ROLE anon;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"anon"}',
  false
);

\set ON_ERROR_STOP off
INSERT INTO public.contacts (user_id, account_id, phone)
VALUES (:'outsider_id', :'account_two_id', '996555000099');
\set anon_insert_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'anon_insert_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: anon inserted into an exposed table'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
SELECT public.set_member_role(:'agent_id', 'owner');
\set anon_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'anon_rpc_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: anon executed a privileged RPC'
  SELECT 1 / 0;
\endif

RESET ROLE;

-- service_role is intentionally server-only and BYPASSRLS. It can update
-- protected values across accounts; this positive case proves the test did not
-- accidentally run every assertion as the table owner or authenticated role.
SET ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"service_role"}',
  false
);

UPDATE public.contacts
SET account_id = :'account_two_id',
    user_id = :'outsider_id',
    amo_contact_id = 'server-provider-id'
WHERE id = :'derived_contact_id';

UPDATE public.profiles
SET account_role = 'agent'
WHERE user_id = :'admin_id';

RESET ROLE;

SELECT EXISTS (
  SELECT 1
  FROM public.contacts
  WHERE id = :'derived_contact_id'
    AND account_id = :'account_two_id'
    AND user_id = :'outsider_id'
    AND amo_contact_id = 'server-provider-id'
) AS expected
\gset
\if :expected
\else
  \echo 'FAIL: service_role server-owned update was not applied'
  SELECT 1 / 0;
\endif

SELECT EXISTS (
  SELECT 1
  FROM public.profiles
  WHERE user_id = :'admin_id'
    AND account_role = 'agent'
) AS expected
\gset
\if :expected
\else
  \echo 'FAIL: service_role membership update was not applied'
  SELECT 1 / 0;
\endif

-- Block C: the bucket is private, members can access only their account path,
-- and browser roles cannot forge content-free media audit evidence.
SELECT public = FALSE AS expected
FROM storage.buckets
WHERE id = 'chat-media'
\gset
\if :expected
\else
  \echo 'FAIL: chat-media bucket is public'
  SELECT 1 / 0;
\endif

INSERT INTO storage.objects (bucket_id, name)
VALUES ('chat-media', 'account-' || :'account_two_id' || '/message/foreign.pdf');

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  false
);

INSERT INTO storage.objects (bucket_id, name)
VALUES ('chat-media', 'account-' || :'account_one_id' || '/message/own.pdf');

SELECT EXISTS (
  SELECT 1
  FROM storage.objects
  WHERE bucket_id = 'chat-media'
    AND name = 'account-' || :'account_one_id' || '/message/own.pdf'
) AS expected
\gset
\if :expected
\else
  \echo 'FAIL: account member cannot read own private media metadata'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
INSERT INTO storage.objects (bucket_id, name)
VALUES ('chat-media', 'account-' || :'account_two_id' || '/message/forged.pdf');
\set cross_media_insert_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'cross_media_insert_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: account member inserted cross-account private media'
  SELECT 1 / 0;
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM storage.objects
  WHERE bucket_id = 'chat-media'
    AND name = 'account-' || :'account_two_id' || '/message/foreign.pdf'
) AS expected
\gset
\if :expected
\else
  \echo 'FAIL: account member read cross-account private media metadata'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
INSERT INTO public.media_audit_events (
  account_id, event_type, object_key_sha256
) VALUES (
  :'account_one_id', 'access_grant', repeat('a', 64)
);
\set forged_media_audit_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT :'forged_media_audit_state' = '42501' AS expected \gset
\if :expected
\else
  \echo 'FAIL: authenticated user forged media audit evidence'
  SELECT 1 / 0;
\endif

RESET ROLE;

-- K3 managed-bundle mutation is service-role-only and commits as one RPC.
DO $$
BEGIN
  IF has_function_privilege(
       'authenticated',
       'public.sync_ai_knowledge_bundle(uuid,text,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.sync_ai_knowledge_bundle(uuid,text,text,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.sync_ai_knowledge_bundle(uuid,text,text,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Managed knowledge sync RPC grants are unsafe';
  END IF;
END
$$;

SET ROLE service_role;
SELECT public.sync_ai_knowledge_bundle(
  :'account_one_id',
  'client',
  repeat('b', 64),
  jsonb_build_object(
    'version', 1,
    'documents', jsonb_build_array(jsonb_build_object(
      'source_path', 'Услуги/Проверка.md',
      'source_sha256', encode(sha256(convert_to('Проверенное содержание', 'UTF8')), 'hex'),
      'title', 'Проверка',
      'content', 'Проверенное содержание',
      'chunks', jsonb_build_array(jsonb_build_object(
        'chunk_index', 0,
        'content', 'Проверенное содержание',
        'content_sha256', encode(sha256(convert_to('Проверенное содержание', 'UTF8')), 'hex'),
        'embedding', (SELECT jsonb_agg(0.0) FROM generate_series(1, 1536))
      ))
    ))
  )
);
RESET ROLE;

SELECT count(*) = 1 AS expected
FROM public.ai_knowledge_documents
WHERE account_id = :'account_one_id'
  AND audience = 'client'
  AND managed_by = 'evo_obsidian_sync'
  AND source_path = 'Услуги/Проверка.md'
\gset
\if :expected
\else
  \echo 'FAIL: atomic managed knowledge sync did not publish its document'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
SET ROLE service_role;
SELECT public.sync_ai_knowledge_bundle(
  :'account_one_id',
  'client',
  repeat('c', 64),
  jsonb_build_object(
    'version', 1,
    'documents', jsonb_build_array(jsonb_build_object(
      'source_path', 'Услуги/Не должно сохраниться.md',
      'source_sha256', repeat('0', 64),
      'title', 'Отклонить',
      'content', 'Несовпадающий SHA',
      'chunks', jsonb_build_array(jsonb_build_object(
        'chunk_index', 0,
        'content', 'Несовпадающий SHA',
        'content_sha256', repeat('0', 64),
        'embedding', (SELECT jsonb_agg(0.0) FROM generate_series(1, 1536))
      ))
    ))
  )
);
\set failed_bundle_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on
SELECT :'failed_bundle_state' <> '00000'
  AND NOT EXISTS (
    SELECT 1
    FROM public.ai_knowledge_documents
    WHERE account_id = :'account_one_id'
      AND source_path = 'Услуги/Не должно сохраниться.md'
  ) AS expected
\gset
\if :expected
\else
  \echo 'FAIL: rejected managed bundle left partial state'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
SET ROLE service_role;
SELECT public.sync_ai_knowledge_bundle(
  :'account_one_id',
  'client',
  repeat('d', 64),
  jsonb_build_object(
    'version', 1,
    'documents', jsonb_build_array(jsonb_build_object(
      'source_path', 'Сырой архив ЭВО/Запрещено.md',
      'source_sha256', encode(sha256(convert_to('Корректный SHA', 'UTF8')), 'hex'),
      'title', 'Запрещено',
      'content', 'Корректный SHA',
      'chunks', jsonb_build_array(jsonb_build_object(
        'chunk_index', 0,
        'content', 'Корректный SHA',
        'content_sha256', encode(sha256(convert_to('Корректный SHA', 'UTF8')), 'hex'),
        'embedding', (SELECT jsonb_agg(0.0) FROM generate_series(1, 1536))
      ))
    ))
  )
);
\set forbidden_bundle_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on
SELECT :'forbidden_bundle_state' <> '00000'
  AND NOT EXISTS (
    SELECT 1 FROM public.ai_knowledge_documents
    WHERE account_id = :'account_one_id'
      AND source_path = 'Сырой архив ЭВО/Запрещено.md'
  ) AS expected
\gset
\if :expected
\else
  \echo 'FAIL: forbidden raw-root managed path reached runtime storage'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
SET ROLE service_role;
SELECT public.sync_ai_knowledge_bundle(
  :'account_one_id',
  'client',
  repeat('e', 64),
  jsonb_build_object(
    'version', 1,
    'documents', jsonb_build_array(jsonb_build_object(
      'source_path', U&'Страны/Китаи\0306.md',
      'source_sha256', encode(sha256(convert_to('Корректный SHA', 'UTF8')), 'hex'),
      'title', 'Не NFC',
      'content', 'Корректный SHA',
      'chunks', jsonb_build_array(jsonb_build_object(
        'chunk_index', 0,
        'content', 'Корректный SHA',
        'content_sha256', encode(sha256(convert_to('Корректный SHA', 'UTF8')), 'hex'),
        'embedding', (SELECT jsonb_agg(0.0) FROM generate_series(1, 1536))
      ))
    ))
  )
);
\set non_nfc_bundle_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on
SELECT :'non_nfc_bundle_state' <> '00000' AS expected
\gset
\if :expected
\else
  \echo 'FAIL: non-NFC managed path reached runtime storage'
  SELECT 1 / 0;
\endif

SET ROLE service_role;
INSERT INTO public.ai_assistant_audits (
  id, account_id, audience, evaluation_case_id, provider, model,
  knowledge_sources, response_sha256, handoff, success, actor_user_id
)
SELECT
  '22000000-0000-4000-8000-000000000001',
  :'account_one_id',
  'client',
  'client_china_documents',
  'gemini',
  'gemini-3.5-flash',
  jsonb_build_array(jsonb_build_object(
    'chunk_id', chunk.id,
    'source_path', document.source_path
  )),
  repeat('f', 64),
  false,
  true,
  :'admin_id'
FROM public.ai_knowledge_documents AS document
JOIN public.ai_knowledge_chunks AS chunk ON chunk.document_id = document.id
WHERE document.account_id = :'account_one_id'
  AND document.audience = 'client'
  AND document.source_path = 'Услуги/Проверка.md'
LIMIT 1;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  false
);
SELECT count(*) = 1 AS expected
FROM public.ai_assistant_audits
WHERE account_id = :'account_one_id'
\gset
\if :expected
\else
  \echo 'FAIL: account agent cannot read body-free assistant audit'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
INSERT INTO public.ai_assistant_audits (
  account_id, audience, provider, model, knowledge_sources,
  response_sha256, handoff, success, actor_user_id
) SELECT
  :'account_one_id', 'client', 'gemini', 'gemini-3.5-flash',
  knowledge_sources, repeat('a', 64), false, true, :'admin_id'
FROM public.ai_assistant_audits LIMIT 1;
\set authenticated_audit_insert_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SELECT :'authenticated_audit_insert_state' = '42501' AS expected
\gset
\if :expected
\else
  \echo 'FAIL: authenticated caller inserted assistant audit'
  SELECT 1 / 0;
\endif

\set ON_ERROR_STOP off
SET ROLE service_role;
UPDATE public.ai_assistant_audits
SET success = false
WHERE id = '22000000-0000-4000-8000-000000000001';
\set immutable_audit_update_state :SQLSTATE
DELETE FROM public.ai_assistant_audits
WHERE id = '22000000-0000-4000-8000-000000000001';
\set premature_audit_delete_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on
SELECT :'immutable_audit_update_state' <> '00000'
  AND :'premature_audit_delete_state' <> '00000'
  AND EXISTS (
    SELECT 1 FROM public.ai_assistant_audits
    WHERE id = '22000000-0000-4000-8000-000000000001'
      AND success
  ) AS expected
\gset
\if :expected
\else
  \echo 'FAIL: assistant audit is mutable or deletable before expiry'
  SELECT 1 / 0;
\endif

SET ROLE service_role;
INSERT INTO public.ai_assistant_audits (
  id, account_id, audience, provider, model, knowledge_sources,
  response_sha256, handoff, success, actor_user_id, created_at
) SELECT
  '22000000-0000-4000-8000-000000000002', account_id, audience,
  provider, model, knowledge_sources, repeat('b', 64), false, true,
  :'admin_id', now() - interval '91 days'
FROM public.ai_assistant_audits
WHERE id = '22000000-0000-4000-8000-000000000001';
SELECT public.purge_expired_ai_assistant_audits() = 1 AS expected
\gset
RESET ROLE;
\if :expected
\else
  \echo 'FAIL: service-only assistant audit expiry purge is incorrect'
  SELECT 1 / 0;
\endif

SELECT count(*) = 1 AS expected
FROM public.ai_assistant_audits
WHERE account_id = :'account_one_id'
\gset
\if :expected
\else
  \echo 'FAIL: audit purge removed unexpired evidence or retained expired evidence'
  SELECT 1 / 0;
\endif

\echo 'PASS: real PostgreSQL role/RLS authorization policy suite'
