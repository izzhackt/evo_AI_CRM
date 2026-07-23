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
    );

  IF unexpected_authenticated_rpc IS NOT NULL THEN
    RAISE EXCEPTION
      'authenticated can execute unreviewed public functions: %',
      unexpected_authenticated_rpc;
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.match_ai_knowledge_fts(uuid,text,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.match_ai_knowledge_semantic(uuid,text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Cross-account knowledge RPCs remain client executable';
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

\echo 'PASS: real PostgreSQL role/RLS authorization policy suite'
