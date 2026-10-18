\set ON_ERROR_STOP on
-- Boundary suite for migration 307 («Отчёт продаж»: «Убрать» продажу с отметкой отказа, чтение v5 и
-- три служебные правки данных; слова владельца 18.10.2026). Members are modelled like production after
-- 155 and 244 (as in platform_sales_record_lead_link.sql): invited staff have coarse role NULL, the
-- permissions come only from scoped role assignments with the production keys, the department Sales
-- Manager role is bound to the 208 workflow key `sales_manager`; only the system Admin carries the
-- coarse role. The service calls are made as the service path makes them (service_role, no user JWT,
-- the owner's Admin as the actor), as in platform_sales_report_import.sql. Every identity switch goes
-- through pg_temp.swt_as / swt_json (claims and role local to the transaction, role always reset).
-- Dates: July 2026 is the reading period (records R1-R12), August the marketing leads, September the
-- service records (S1-S6) and the cases. Proves:
--  0. catalog and posture: every new function has the empty search_path, the callable ones and the two
--     private workers are SECURITY DEFINER (row v3 is not, like row v2), exactly the grants intended
--     (authenticated: v5 and set; service_role: the three service calls; nobody: the helpers); the
--     receipts table is closed (forced RLS, no policy, no client privilege, append-only); the new
--     columns; the released reads and commands are byte-identical and the four edited bodies
--     (staff_sales_count_v1, current_sales_funnel, marketing_cohort, marketing_overview_v1) differ from
--     their released text only by the added refusal condition;
--  1. baseline before any mark: v5 equals v4 plus `withdrawal: null` on every row and `withdrawn`;
--  2. set_sales_register_withdrawal_v1: «Убрать» partial and unpaid, the change of kind and note,
--     «Вернуть», the version at every step, the stored columns, every refusal (the system Admin without
--     the Sales Manager role, another department, no scope over the record, a register reader, a Sales
--     Manager whose read role is wider than his manage scope, the Student, no membership, anon, a
--     foreign organization), the optimistic version, the request-id
--     replay and conflict (and the replay after the ownership changed), an archived record, a missing
--     or unchanged mark, invalid kind / note, a journal without free text, the money untouched, an
--     ordinary edit that keeps the mark, archive and restore that keep it;
--  3. read_sales_register_v5 after marks: exact key sets, the `withdrawal` object, refused rows listed
--     but out of the totals and the unresolved counts, `withdrawn` (count and paid per currency, a
--     cross-currency «оплачено в валюте договора» record included), the sale slices, the archive view,
--     visibility as in v4, and v1-v4 untouched (the old shape, refused rows still in their totals);
--  4. counting: staff_sales_count_v1 and its slices and the funnel's «Продажи» (current_sales_funnel)
--     drop a refused record and take it back after «Вернуть»; marketing_overview_v1 keeps
--     `sales.reconciliation.matches` and the cohort drops the refused lead's contract;
--  5. mark_sales_report_row_withdrawn_v1 and archive_sales_report_row_v1: the service-only boundary
--     and the actor, the strict parameters (every refusal names its key), set / change / clear /
--     unchanged, an archived row, a missing row, replay and conflicts, the receipts (the previous mark
--     is kept), a refused call writes nothing, organizations are isolated;
--  6. create_sales_report_student_case_v1: a case on a lead the report sold (made by 304's import),
--     with and without a curator, no new client or lead and the client row untouched, the профиль
--     fields, the money, the receipt with its import source and client_reused, case_exists, every
--     refusal (a lead that is not from the report or whose client is not active, the fingerprint that
--     holds the lead, the receipt key shared with 281's imports); the contact and client advisory
--     locks, the locked lead row and the organization limit of the existing-case search; and that
--     287's update accepts and closes such a case while the lead stays a converted report lead;
--  7. the whole journal (existing actions, request ids per receipt, no names, phones, notes or keys),
--     the receipts (append-only, their constraints) and the register's constraints on the mark.
-- Isolated synthetic SQL fixtures only.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $swt_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$swt_auth_role$;

CREATE FUNCTION pg_temp.swt_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('307e0000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.swt_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'SWT: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement ('42501:message'), or 'ok'.
CREATE FUNCTION pg_temp.swt_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The statement as another identity: the claims and the role are local to the transaction and the
-- role is always reset. swt_as answers 'ok' or 'SQLSTATE:message'; swt_json answers the one value
-- (a SELECT yielding JSONB) and lets an error through.
CREATE FUNCTION pg_temp.swt_as(p_claims TEXT, p_role TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql; answer := 'ok';
  EXCEPTION WHEN OTHERS THEN answer := SQLSTATE || ':' || SQLERRM;
  END;
  RESET ROLE;
  RETURN answer;
END
$$;
CREATE FUNCTION pg_temp.swt_json(p_claims TEXT, p_role TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE answer JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO answer;
  RESET ROLE;
  RETURN answer;
END
$$;
-- The sorted keys of a JSON object; the row of one record in a read.
CREATE FUNCTION pg_temp.swt_keys(j JSONB) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(k ORDER BY k COLLATE "C"), ARRAY[]::TEXT[]) FROM jsonb_object_keys(j) AS k
$$;
CREATE FUNCTION pg_temp.swt_row(p_read JSONB, p_id UUID) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT r FROM jsonb_array_elements(p_read -> 'rows') r WHERE (r ->> 'id')::UUID = p_id
$$;
-- The grantees of EXECUTE other than the owner ('PUBLIC' for the pseudo-role).
CREATE FUNCTION pg_temp.swt_grantees(p_fn REGPROCEDURE) RETURNS TEXT[] LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::REGROLE::TEXT END
      ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::REGROLE::TEXT END), ARRAY[]::TEXT[])
  FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE p.oid = p_fn AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner
$$;
-- The command strings (run through swt_as / swt_json).
CREATE FUNCTION pg_temp.swt_set(p_record UUID, p_version BIGINT, p_kind TEXT, p_note TEXT, p_request UUID,
  p_org INTEGER DEFAULT 1) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.set_sales_register_withdrawal_v1(%L::UUID, %L::UUID, %L::BIGINT, %L::TEXT, %L::TEXT, %L::UUID)',
    pg_temp.swt_id(p_org), p_record, p_version, p_kind, p_note, p_request)
$$;
CREATE FUNCTION pg_temp.swt_read(p_version INTEGER, p_month INTEGER, p_args TEXT DEFAULT '', p_year INTEGER DEFAULT 2026,
  p_org INTEGER DEFAULT 1) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.read_sales_register_v%s(%L::UUID, %s, %s%s)', p_version, pg_temp.swt_id(p_org), p_year,
    COALESCE(p_month::TEXT, 'NULL'), CASE WHEN p_args = '' THEN '' ELSE ', ' || p_args END)
$$;
-- The service calls with the owner's Admin (301) of organization 1 as the default actor.
CREATE FUNCTION pg_temp.swt_mark(p_ref TEXT, p_key TEXT, p_kind TEXT, p_note TEXT DEFAULT NULL, p_actor INTEGER DEFAULT 301,
  p_org INTEGER DEFAULT 1, p_source TEXT DEFAULT 'swt-withdraw', p_reason TEXT DEFAULT 'SWT синтетический отказ')
  RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.mark_sales_report_row_withdrawn_v1(%L::UUID, %L::UUID, %L, %L, %L, %L, %L, %L)',
    pg_temp.swt_id(p_org), pg_temp.swt_id(p_actor), p_source, p_ref, p_key, p_kind, p_note, p_reason)
$$;
CREATE FUNCTION pg_temp.swt_archive(p_ref TEXT, p_key TEXT, p_actor INTEGER DEFAULT 301, p_org INTEGER DEFAULT 1,
  p_source TEXT DEFAULT 'swt-withdraw', p_reason TEXT DEFAULT 'SWT синтетический архив') RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.archive_sales_report_row_v1(%L::UUID, %L::UUID, %L, %L, %L, %L)',
    pg_temp.swt_id(p_org), pg_temp.swt_id(p_actor), p_source, p_ref, p_key, p_reason)
$$;
CREATE FUNCTION pg_temp.swt_case(p_ref TEXT, p_lead UUID, p_payload JSONB, p_actor INTEGER DEFAULT 301, p_org INTEGER DEFAULT 1,
  p_source TEXT DEFAULT 'swt-case', p_reason TEXT DEFAULT 'SWT синтетическое дело') RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.create_sales_report_student_case_v1(%L::UUID, %L::UUID, %L, %L, %L::UUID, %L::JSONB, %L)',
    pg_temp.swt_id(p_org), pg_temp.swt_id(p_actor), p_source, p_ref, p_lead, p_payload::TEXT, p_reason)
$$;
-- The request ids of one service call: the base from the receipt key and the event's suffix.
CREATE FUNCTION pg_temp.swt_base(p_ref TEXT, p_source TEXT DEFAULT 'swt-withdraw', p_org INTEGER DEFAULT 1)
  RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT public.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::UUID,
    'evo:sales-withdrawal:' || pg_temp.swt_id(p_org)::TEXT || ':' || p_source || ':' || p_ref)
$$;
CREATE FUNCTION pg_temp.swt_op(p_ref TEXT, p_op TEXT, p_source TEXT DEFAULT 'swt-withdraw', p_org INTEGER DEFAULT 1)
  RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT public.uuid_generate_v5(pg_temp.swt_base(p_ref, p_source, p_org), 'sales-withdrawal:' || p_op)
$$;
-- The report row's fields as the import and the interface store them.
CREATE FUNCTION pg_temp.swt_fields(p_name TEXT, p_signing DATE, p_cost BIGINT, p_cost_currency TEXT, p_paid BIGINT,
  p_paid_currency TEXT, p_review BOOLEAN DEFAULT FALSE, p_manager TEXT DEFAULT 'SWT Manager') RETURNS JSONB
  LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('applicant_name', p_name, 'phone', '', 'signing_date', p_signing, 'manager_label', p_manager,
    'status_raw', '', 'service_cost_minor', p_cost, 'service_cost_currency', p_cost_currency, 'paid_minor', p_paid,
    'paid_currency', p_paid_currency, 'needs_review', p_review)
$$;
-- A fingerprint of everything the withdrawal commands may write; read as the test owner only.
CREATE FUNCTION pg_temp.swt_state() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT concat_ws('/',
    (SELECT md5(COALESCE(string_agg(r.id::TEXT || ':' || r.version || ':' || r.archived || ':' || COALESCE(r.withdrawal_kind, '-')
      || ':' || COALESCE(r.withdrawn_at::TEXT, '-') || ':' || COALESCE(r.withdrawn_by_membership_id::TEXT, '-') || ':'
      || COALESCE(r.withdrawal_note, '-') || ':' || md5(r.fields::TEXT) || ':' || COALESCE(r.paid_contract_minor::TEXT, '-'),
      '|' ORDER BY r.id), '')) FROM platform_private.sales_register r),
    (SELECT count(*) FROM platform_private.sales_register),
    (SELECT count(*) FROM platform_private.sales_register_requests),
    (SELECT count(*) FROM platform_private.sales_withdrawal_service_receipts),
    (SELECT count(*) FROM platform.audit_events),
    (SELECT count(*) FROM platform_private.admissions_direct_case_receipts),
    (SELECT count(*) FROM platform.student_cases),
    (SELECT count(*) FROM platform.clients),
    (SELECT count(*) FROM platform.leads))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.swt_id(INTEGER), pg_temp.swt_assert(BOOLEAN, TEXT), pg_temp.swt_error(TEXT),
  pg_temp.swt_keys(JSONB), pg_temp.swt_row(JSONB, UUID)
  TO authenticated, anon, service_role;

SELECT 'SWT_SALES_REPORT_WITHDRAWAL_SUITE_START' AS swt_suite_marker;

-- ---------------------------------------------------------------------------
-- 0. Catalog, posture and the released functions (rollback proof).
-- ---------------------------------------------------------------------------
-- Every new function: the empty search_path; definer for everything callable and for the two private
-- workers; exactly the intended grantees (nobody else, not even PUBLIC).
SELECT pg_temp.swt_assert(f.config = ARRAY['search_path=""'] AND f.secdef = f.want_definer AND pg_temp.swt_grantees(f.fn) = f.grantees,
  f.fn::TEXT || ': search_path, definer and grantees as intended (grantees ' || pg_temp.swt_grantees(f.fn)::TEXT || ')')
FROM (
  SELECT x.fn, p.proconfig AS config, p.prosecdef AS secdef, x.want_definer, x.grantees
  FROM (VALUES
    ('platform.read_sales_register_v5(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::REGPROCEDURE, TRUE, ARRAY['authenticated']),
    ('platform.set_sales_register_withdrawal_v1(uuid,uuid,bigint,text,text,uuid)'::REGPROCEDURE, TRUE, ARRAY['authenticated']),
    ('platform.mark_sales_report_row_withdrawn_v1(uuid,uuid,text,text,text,text,text,text)'::REGPROCEDURE, TRUE, ARRAY['service_role']),
    ('platform.archive_sales_report_row_v1(uuid,uuid,text,text,text,text)'::REGPROCEDURE, TRUE, ARRAY['service_role']),
    ('platform.create_sales_report_student_case_v1(uuid,uuid,text,text,uuid,jsonb,text)'::REGPROCEDURE, TRUE, ARRAY['service_role']),
    ('platform_private.create_sales_report_student_case(uuid,uuid,uuid,uuid,jsonb,text,text,text)'::REGPROCEDURE, TRUE, ARRAY[]::TEXT[]),
    ('platform_private.sales_withdrawal_service_actor(uuid,uuid)'::REGPROCEDURE, TRUE, ARRAY[]::TEXT[]),
    ('platform_private.sales_register_row_v3(platform_private.sales_register)'::REGPROCEDURE, FALSE, ARRAY[]::TEXT[])
  ) AS x(fn, want_definer, grantees) JOIN pg_proc p ON p.oid = x.fn) AS f;
-- The receipts table: closed to every client role, forced RLS without a policy, append-only.
SELECT pg_temp.swt_assert((SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c
      WHERE c.oid = 'platform_private.sales_withdrawal_service_receipts'::REGCLASS)
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'platform_private' AND tablename = 'sales_withdrawal_service_receipts')
  AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) AS r(role_name)
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
      WHERE has_table_privilege(r.role_name, 'platform_private.sales_withdrawal_service_receipts', p.privilege)),
  'receipts: forced RLS, no policy, no client privilege of any kind');
SELECT pg_temp.swt_assert(pg_temp.swt_as('{"role":"service_role"}', 'service_role',
      'SELECT count(*) FROM platform_private.sales_withdrawal_service_receipts') LIKE '42501:permission denied for %'
  AND pg_temp.swt_as('{"role":"authenticated"}', 'authenticated',
      'SELECT count(*) FROM platform_private.sales_withdrawal_service_receipts') LIKE '42501:permission denied for %'
  AND pg_temp.swt_as('', 'anon', 'SELECT count(*) FROM platform_private.sales_withdrawal_service_receipts') LIKE '42501:permission denied for %',
  'receipts: service_role, authenticated and anon cannot read them');
SELECT pg_temp.swt_assert(
  (SELECT count(*) = 2 AND bool_and(t.tgfoid = 'platform_private.block_append_only_mutation()'::REGPROCEDURE) FROM pg_trigger t
    WHERE t.tgrelid = 'platform_private.sales_withdrawal_service_receipts'::REGCLASS AND NOT t.tgisinternal)
  AND (SELECT count(*) = 1 FROM pg_trigger t WHERE t.tgrelid = 'platform_private.sales_withdrawal_service_receipts'::REGCLASS
      AND NOT t.tgisinternal AND (t.tgtype & 1) = 1 AND (t.tgtype & 8) = 8 AND (t.tgtype & 16) = 16)
  AND (SELECT count(*) = 1 FROM pg_trigger t WHERE t.tgrelid = 'platform_private.sales_withdrawal_service_receipts'::REGCLASS
      AND NOT t.tgisinternal AND (t.tgtype & 1) = 0 AND (t.tgtype & 32) = 32),
  'receipts: one row trigger (UPDATE, DELETE) and one statement trigger (TRUNCATE), both the append-only guard');
SELECT pg_temp.swt_assert(
  (SELECT array_agg(a.attname::TEXT ORDER BY a.attnum) FROM pg_attribute a
    WHERE a.attrelid = 'platform_private.sales_withdrawal_service_receipts'::REGCLASS AND a.attnum > 0 AND NOT a.attisdropped)
    = ARRAY['organization_id', 'operation', 'import_source', 'external_ref', 'actor_membership_id', 'payload_md5', 'register_id',
      'result', 'before_state', 'created_at', 'receipt_seq']
  AND (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'platform_private.sales_withdrawal_service_receipts'::REGCLASS
      AND c.contype = 'p') = 'PRIMARY KEY (organization_id, import_source, external_ref)'
  AND (SELECT count(*) = 3 FROM pg_constraint c WHERE c.conrelid = 'platform_private.sales_withdrawal_service_receipts'::REGCLASS AND c.contype = 'f'),
  'receipts: the columns, the key (organization, import source, external reference) and the three foreign keys');

-- The new columns of the register and their constraints.
SELECT pg_temp.swt_assert(
  (SELECT jsonb_object_agg(c.column_name, c.data_type) FROM information_schema.columns c
    WHERE c.table_schema = 'platform_private' AND c.table_name = 'sales_register'
      AND c.column_name IN ('withdrawal_kind', 'withdrawn_at', 'withdrawn_by_membership_id', 'withdrawal_note'))
    = '{"withdrawal_kind":"text","withdrawn_at":"timestamp with time zone","withdrawn_by_membership_id":"uuid","withdrawal_note":"text"}'::JSONB
  AND (SELECT count(*) = 3 FROM pg_constraint c WHERE c.conrelid = 'platform_private.sales_register'::REGCLASS
      AND c.conname IN ('sales_register_withdrawal_kind', 'sales_register_withdrawal_shape', 'sales_register_withdrawn_by_fkey')),
  'sales_register: the four new columns and their three constraints');

-- The released reads and commands are the pre-307 definitions (rollback proof).
SELECT pg_temp.swt_assert(md5(p.prosrc) = r.expected, r.fn::TEXT || ' is byte-identical to its released text')
FROM (VALUES
  ('platform.read_sales_register_v1(uuid,integer,integer,integer,uuid,boolean,text,text,boolean)'::REGPROCEDURE, 'ebf3347d765e3392a4ea167d9eb6b73a'),
  ('platform.read_sales_register_v2(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text)'::REGPROCEDURE, '9ee3e65d924531326fa3da7c51a9307f'),
  ('platform.read_sales_register_v3(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::REGPROCEDURE, '1439fa99ea98aebe86e0a2673ae7e2a5'),
  ('platform.read_sales_register_v4(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::REGPROCEDURE, 'ea3f0a2000c65d8aed60cf2be3ec78a8'),
  ('platform.manage_sales_register_v1(uuid,text,uuid,bigint,jsonb,text,uuid)'::REGPROCEDURE, '9e544ace68c9eb43e55ce63ef2d5db4c'),
  ('platform.manage_sales_register_v2(uuid,text,uuid,bigint,jsonb,bigint,text,text,uuid)'::REGPROCEDURE, '1ae50564608769f594cf76c13e52eb9b'),
  ('platform.link_sales_record_lead_v1(uuid,uuid,bigint,uuid,uuid)'::REGPROCEDURE, '65d87280f3f7f9c3c2ea7d5f96be5305'),
  ('platform.staff_lead_handoff_strip_v1(uuid,uuid)'::REGPROCEDURE, '7089320d801256478819c3c9f6abdf95'),
  ('platform.staff_lead_handoff_strip_v2(uuid,uuid)'::REGPROCEDURE, 'a31620b07c5d5f5da0022ff626f27243'),
  ('platform.import_sales_report_row_v1(uuid,uuid,text,text,jsonb,text)'::REGPROCEDURE, '1532294fca45f6800401d3a75b5a525c'),
  ('platform.create_admissions_student_case_v1(uuid,uuid,jsonb)'::REGPROCEDURE, 'e5896bf5c0c6539b35a4aa04f3b5b741'),
  ('platform.import_admissions_student_case_v1(uuid,uuid,text,text,jsonb,text)'::REGPROCEDURE, '9787ef991d49fb01d0a08d174794d79b'),
  ('platform.update_admissions_direct_case_v1(uuid,uuid,uuid,text,text,jsonb,text)'::REGPROCEDURE, '55874aeb4772211962c3f0d352221e41'),
  ('platform_private.create_admissions_student_case(uuid,uuid,uuid,jsonb,text,text,text)'::REGPROCEDURE, 'ea380e1de7ed66695fb775d30e729888'),
  ('platform_private.sales_register_row(platform_private.sales_register)'::REGPROCEDURE, '17df8ac76544087f7f93410c26e734cc'),
  ('platform_private.sales_register_row_v2(platform_private.sales_register)'::REGPROCEDURE, 'be1745aa63531ddad26480ba8c2b2361'),
  ('platform_private.sales_register_fields(jsonb,boolean)'::REGPROCEDURE, '3afe9eec0198bd830ef7b6ca9af2878b')
) AS r(fn, expected) JOIN pg_proc p ON p.oid = r.fn;
-- The four edited bodies: taking the added condition out gives back the released text, byte for byte
-- (and the condition stands exactly where expected: once in each body, twice in the cohort).
CREATE FUNCTION pg_temp.swt_condition_count(p_fn REGPROCEDURE) RETURNS INTEGER LANGUAGE SQL STABLE AS $$
  SELECT (length(prosrc) - length(replace(prosrc, 'r.withdrawal_kind IS NULL', ''))) / length('r.withdrawal_kind IS NULL')
  FROM pg_proc WHERE oid = p_fn
$$;
SELECT pg_temp.swt_assert(
  md5(replace(p.prosrc, ' AND r.withdrawal_kind IS NULL', '')) = e.released AND md5(p.prosrc) <> e.released
    AND pg_temp.swt_condition_count(e.fn) = e.occurrences,
  e.fn::TEXT || ' differs from the released text only by the added refusal condition (' || e.occurrences || 'x)')
FROM (VALUES
  ('platform.staff_sales_count_v1(uuid,date,date)'::REGPROCEDURE, '337764b28cf8ed13103c04847726f827', 1),
  ('platform.current_sales_funnel(uuid)'::REGPROCEDURE, 'a6bccb0ed01aa7df78c3e73883a15d14', 1),
  ('platform_private.marketing_cohort(uuid,date,date)'::REGPROCEDURE, '2d1ffe23dc5f15ffc2563fef6ea1c192', 2),
  ('platform.marketing_overview_v1(date,date)'::REGPROCEDURE, '3c83f3ebb1020d086424f44d298fa817', 1)
) AS e(fn, released, occurrences) JOIN pg_proc p ON p.oid = e.fn;
-- Their posture is unchanged by the in-place replacement.
SELECT pg_temp.swt_assert(p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_temp.swt_grantees(e.fn) = e.grantees,
  e.fn::TEXT || ' keeps its definer, search_path and grants')
FROM (VALUES
  ('platform.staff_sales_count_v1(uuid,date,date)'::REGPROCEDURE, ARRAY['authenticated']),
  ('platform.current_sales_funnel(uuid)'::REGPROCEDURE, ARRAY['authenticated']),
  ('platform.marketing_overview_v1(date,date)'::REGPROCEDURE, ARRAY['authenticated']),
  ('platform_private.marketing_cohort(uuid,date,date)'::REGPROCEDURE, ARRAY[]::TEXT[])
) AS e(fn, grantees) JOIN pg_proc p ON p.oid = e.fn;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1: 1 Admin (system); invited staff with coarse role NULL: 2 Sales Manager A
-- (department A), 3 Sales Manager B (department B), 4 Sales Manager with own scope (department C),
-- 6 register reader (sales.register.read only), 8 curator (Admissions, own scope), 9 staff without
-- any role, 11 Sales Manager of department A who ALSO reads the whole register (a read role at
-- organization scope next to the department manage scope); 5 Student, 7 coarse Sales member,
-- 10 a second Admin. Organization 2: Admin 20.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE swt_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO swt_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL), (7, 'sales'),
  (8, NULL), (9, NULL), (10, 'admin'), (11, NULL);
GRANT SELECT ON swt_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.swt_id(1), 'SWT Fictional organization'),
  (pg_temp.swt_id(2), 'SWT Second organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.swt_id(100 + n), 'swt-' || n || '@example.invalid', '{}'::JSONB FROM swt_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.swt_id(199), 'swt-none@example.invalid', '{}'::JSONB),
  (pg_temp.swt_id(120), 'swt-org2-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.swt_id(200 + n), pg_temp.swt_id(100 + n), 'SWT Actor ' || n, 'active', 1 FROM swt_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.swt_id(220), pg_temp.swt_id(120), 'SWT Org2 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.swt_id(300 + n), pg_temp.swt_id(1), pg_temp.swt_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM swt_actors a;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.swt_id(320), pg_temp.swt_id(2), pg_temp.swt_id(220), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.swt_id(301), pg_temp.swt_id(310), pg_temp.swt_id(320));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.swt_id(401), pg_temp.swt_id(1), 'organization', pg_temp.swt_id(1), 1),
  (pg_temp.swt_id(402), pg_temp.swt_id(2), 'organization', pg_temp.swt_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.swt_id(1), pg_temp.swt_id(301), pg_temp.swt_id(401), 1, 1, TRUE, 'system', 'SWT synthetic organization scope', pg_temp.swt_id(601)),
  (pg_temp.swt_id(1), pg_temp.swt_id(310), pg_temp.swt_id(401), 1, 1, TRUE, 'system', 'SWT synthetic organization scope', pg_temp.swt_id(603)),
  (pg_temp.swt_id(2), pg_temp.swt_id(320), pg_temp.swt_id(402), 1, 1, TRUE, 'system', 'SWT synthetic organization scope', pg_temp.swt_id(602));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.swt_id(901), pg_temp.swt_id(1), 'SWT Sales A'),
  (pg_temp.swt_id(902), pg_temp.swt_id(1), 'SWT Admissions'),
  (pg_temp.swt_id(903), pg_temp.swt_id(1), 'SWT Sales B'),
  (pg_temp.swt_id(904), pg_temp.swt_id(1), 'SWT Sales C');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.swt_id(1), pg_temp.swt_id(302), pg_temp.swt_id(901)),
  (pg_temp.swt_id(1), pg_temp.swt_id(311), pg_temp.swt_id(901)),
  (pg_temp.swt_id(1), pg_temp.swt_id(303), pg_temp.swt_id(903)),
  (pg_temp.swt_id(1), pg_temp.swt_id(304), pg_temp.swt_id(904)),
  (pg_temp.swt_id(1), pg_temp.swt_id(308), pg_temp.swt_id(902));

-- Roles with the production permission keys (as in 247's, 253's and 287's suites). Only one role per
-- organization carries workflow_key = 'sales_manager' (208): 1103 is bound to it below.
CREATE TEMP TABLE swt_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO swt_roles VALUES
 (pg_temp.swt_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.swt_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.swt_id(1107), 'Register reader', '["sales.register.read"]', 1170);
CREATE TEMP TABLE swt_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO swt_grants VALUES
 (302, pg_temp.swt_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.swt_id(901), 'resourceKind', NULL)),
 (303, pg_temp.swt_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.swt_id(903), 'resourceKind', NULL)),
 (304, pg_temp.swt_id(1103), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.swt_id(1107), jsonb_build_object('kind', 'organization', 'key', pg_temp.swt_id(1), 'resourceKind', NULL)),
 (311, pg_temp.swt_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.swt_id(901), 'resourceKind', NULL)),
 (311, pg_temp.swt_id(1107), jsonb_build_object('kind', 'organization', 'key', pg_temp.swt_id(1), 'resourceKind', NULL)),
 (308, pg_temp.swt_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL));
CREATE TEMP TABLE swt_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.swt_id(1);
GRANT SELECT ON swt_roles, swt_grants, swt_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.swt_id(101),
  'claims', jsonb_build_object('sub', pg_temp.swt_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS swt_admin_setup \gset
SET LOCAL request.jwt.claims TO :'swt_admin_setup';
SET LOCAL ROLE authenticated;
DO $swt_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM swt_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.swt_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'SWT ' || r.label, 'description', 'Migration 307 synthetic role',
        'permissionKeys', r.keys), 'SWT create role', pg_temp.swt_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.swt_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.swt_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'SWT publish role', pg_temp.swt_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM swt_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM swt_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.swt_id(1), pg_temp.swt_id(m),
      (SELECT access_version FROM swt_versions WHERE membership_id = pg_temp.swt_id(m)), items, bindings,
      'SWT grant roles', pg_temp.swt_id(2000 + m));
  END LOOP;
END
$swt_roles$;
RESET ROLE;
-- The department Sales Manager role is the 208 workflow role, as bound in production.
UPDATE platform.staff_role_definitions SET workflow_key = 'sales_manager' WHERE id = pg_temp.swt_id(1103);
-- 281's publication of case.create.direct into the roles that may curate.
SELECT platform_private.admissions_direct_grant_curator_roles('SWT publication') AS swt_grant \gset

UPDATE swt_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.swt_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.swt_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
CREATE TEMP TABLE swt_claims AS SELECT n, claims FROM swt_actors;
INSERT INTO swt_claims VALUES
  (99, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.swt_id(199),
    'claims', jsonb_build_object('sub', pg_temp.swt_id(199), 'role', 'authenticated'))) -> 'claims')::TEXT),
  (20, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.swt_id(120),
    'claims', jsonb_build_object('sub', pg_temp.swt_id(120), 'role', 'authenticated'))) -> 'claims')::TEXT);
-- The identity helpers: an actor as a signed-in user, the service role, anon.
CREATE FUNCTION pg_temp.swt_user(p_n INTEGER, p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.swt_as((SELECT claims FROM swt_claims WHERE n = p_n), 'authenticated', p_sql)
$$;
CREATE FUNCTION pg_temp.swt_user_json(p_n INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.swt_json((SELECT claims FROM swt_claims WHERE n = p_n), 'authenticated', p_sql)
$$;
CREATE FUNCTION pg_temp.swt_svc(p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.swt_as('{"role":"service_role"}', 'service_role', p_sql)
$$;
CREATE FUNCTION pg_temp.swt_svc_json(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.swt_json('{"role":"service_role"}', 'service_role', p_sql)
$$;
CREATE FUNCTION pg_temp.swt_anon(p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.swt_as('', 'anon', p_sql)
$$;

SELECT pg_temp.swt_assert(platform_private.staff_is_sales_manager(pg_temp.swt_id(1), pg_temp.swt_id(302))
  AND platform_private.staff_is_sales_manager(pg_temp.swt_id(1), pg_temp.swt_id(303))
  AND platform_private.staff_is_sales_manager(pg_temp.swt_id(1), pg_temp.swt_id(304))
  AND NOT platform_private.staff_is_sales_manager(pg_temp.swt_id(1), pg_temp.swt_id(301))
  AND NOT platform_private.staff_is_sales_manager(pg_temp.swt_id(1), pg_temp.swt_id(306))
  AND NOT platform_private.staff_is_sales_manager(pg_temp.swt_id(1), pg_temp.swt_id(308)),
  'fixture: the three department / own Sales Managers are 208 Sales Managers; the system Admin, the reader and the curator are not');
SELECT pg_temp.swt_assert(platform_private.staff_has_permission(pg_temp.swt_id(1), pg_temp.swt_id(306), 'sales.register.read')
  AND NOT platform_private.staff_has_permission(pg_temp.swt_id(1), pg_temp.swt_id(306), 'sales.register.manage')
  AND platform_private.staff_has_permission(pg_temp.swt_id(1), pg_temp.swt_id(301), 'sales.register.manage')
  AND platform_private.staff_has_permission(pg_temp.swt_id(1), pg_temp.swt_id(310), 'sales.register.manage')
  AND platform_private.staff_has_permission(pg_temp.swt_id(2), pg_temp.swt_id(320), 'sales.register.manage')
  AND platform_private.staff_has_permission(pg_temp.swt_id(1), pg_temp.swt_id(301), 'case.create.direct')
  AND platform_private.staff_has_permission(pg_temp.swt_id(1), pg_temp.swt_id(308), 'case.create.direct')
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.swt_id(1), pg_temp.swt_id(301))) = 'admin'
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.swt_id(1), pg_temp.swt_id(310))) = 'admin'
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.swt_id(1), pg_temp.swt_id(302))) = 'staff',
  'fixture: both Admins hold sales.register.manage and case.create.direct, the reader only reads, the Sales Manager is staff');
-- Actor 11 reads the whole register but manages only department A: the record gate must tell read from manage.
SELECT pg_temp.swt_assert(platform_private.staff_is_sales_manager(pg_temp.swt_id(1), pg_temp.swt_id(311))
  AND platform_private.staff_has_permission(pg_temp.swt_id(1), pg_temp.swt_id(311), 'sales.register.manage')
  AND platform_private.staff_has_permission(pg_temp.swt_id(1), pg_temp.swt_id(311), 'sales.register.read'),
  'fixture: member 311 is a Sales Manager of department A with a second, organization-wide read role');

-- Records. July 2026 is the reading period (R1-R12, owner 302 unless said otherwise); September holds the
-- service rows (S1-S6), August the marketing leads. Money in minor units. A row is import unless said.
--   R1  sale 10.07  cost 1000 USD  paid 1000 USD       R2  sale 12.07  cost 2000 USD  paid  500 USD
--   R3  sale 13.07  cost 1500 EUR  paid 135 000 KGS, «в валюте договора» 1200 EUR
--   R4  no sale date (undated)     R5  sale 05.05 (another sale date)    R6  report month JUNE, sale 20.07
--   R7  department B's (303)       R8  own scope's (304, department C)   R9  manual
--   R10 archived                   R11 sale 19.07, no cost, no paid      R12 sale 21.07  cost 250 USD  paid 50 USD
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields,
  source_key, source_sha256, source_sheet, source_row, source_snapshot, source_fingerprint, archived, paid_contract_minor,
  paid_contract_currency)
SELECT pg_temp.swt_id(6000 + f.k), pg_temp.swt_id(1), f.month::DATE, pg_temp.swt_id(f.owner), 'import', f.fields,
  'swt:sheet:' || f.k, repeat('ab', 32), 'SWT synthetic sheet', f.k, '{"review_flags":[]}'::JSONB, 'swt-fingerprint-' || f.k,
  f.archived, f.paid_contract, CASE WHEN f.paid_contract IS NULL THEN NULL ELSE 'EUR' END
FROM (VALUES
  (1, '2026-07-01', 302, pg_temp.swt_fields('SWT R1', DATE '2026-07-10', 100000, 'USD', 100000, 'USD'), FALSE, NULL::BIGINT),
  (2, '2026-07-01', 302, pg_temp.swt_fields('SWT R2', DATE '2026-07-12', 200000, 'USD', 50000, 'USD'), FALSE, NULL),
  (3, '2026-07-01', 302, pg_temp.swt_fields('SWT R3', DATE '2026-07-13', 150000, 'EUR', 13500000, 'KGS'), FALSE, 120000),
  (4, '2026-07-01', 302, pg_temp.swt_fields('SWT R4', NULL, 80000, 'USD', 80000, 'USD'), FALSE, NULL),
  (5, '2026-07-01', 302, pg_temp.swt_fields('SWT R5', DATE '2026-05-05', 90000, 'USD', 90000, 'USD'), FALSE, NULL),
  (6, '2026-06-01', 302, pg_temp.swt_fields('SWT R6', DATE '2026-07-20', 70000, 'USD', 70000, 'USD'), FALSE, NULL),
  (7, '2026-07-01', 303, pg_temp.swt_fields('SWT R7', DATE '2026-07-15', 40000, 'USD', 40000, 'USD'), FALSE, NULL),
  (8, '2026-07-01', 304, pg_temp.swt_fields('SWT R8', DATE '2026-07-16', 60000, 'USD', 60000, 'USD'), FALSE, NULL),
  (10, '2026-07-01', 302, pg_temp.swt_fields('SWT R10', DATE '2026-07-18', 30000, 'USD', 30000, 'USD'), TRUE, NULL),
  (11, '2026-07-01', 302, pg_temp.swt_fields('SWT R11', DATE '2026-07-19', NULL, NULL, NULL, NULL, TRUE), FALSE, NULL),
  (12, '2026-07-01', 302, pg_temp.swt_fields('SWT R12', DATE '2026-07-21', 25000, 'USD', 5000, 'USD'), FALSE, NULL),
  -- The service rows of September.
  (21, '2026-09-01', 302, pg_temp.swt_fields('SWT S1', DATE '2026-09-11', 100000, 'USD', 70000, 'USD'), FALSE, NULL),
  (22, '2026-09-01', 302, pg_temp.swt_fields('SWT S2', DATE '2026-09-12', 100000, 'USD', 100000, 'USD'), FALSE, NULL),
  (23, '2026-09-01', 302, pg_temp.swt_fields('SWT S3', DATE '2026-09-13', 100000, 'USD', 100000, 'USD'), TRUE, NULL),
  (24, '2026-09-01', 302, pg_temp.swt_fields('SWT S4', DATE '2026-09-14', 100000, 'USD', 20000, 'USD'), FALSE, NULL),
  (25, '2026-09-01', 302, pg_temp.swt_fields('SWT S5', DATE '2026-09-15', 100000, 'USD', 100000, 'USD'), FALSE, NULL),
  (26, '2026-09-01', 302, pg_temp.swt_fields('SWT S6', DATE '2026-09-16', 100000, 'USD', 100000, 'USD'), FALSE, NULL)
) AS f(k, month, owner, fields, archived, paid_contract);
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields)
  VALUES (pg_temp.swt_id(6009), pg_temp.swt_id(1), '2026-07-01', pg_temp.swt_id(302), 'manual',
    pg_temp.swt_fields('SWT R9', DATE '2026-07-17', 50000, 'USD', 50000, 'USD'));
-- Organization 2 holds a row under the same source key as S1: organizations are isolated.
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields,
  source_key, source_sha256, source_sheet, source_row, source_snapshot, source_fingerprint)
  VALUES (pg_temp.swt_id(6031), pg_temp.swt_id(2), '2026-09-01', NULL, 'import',
    pg_temp.swt_fields('SWT Foreign S1', DATE '2026-09-11', 100000, 'USD', 70000, 'USD'),
    'swt:sheet:21', repeat('ab', 32), 'SWT synthetic sheet', 21, '{"review_flags":[]}'::JSONB, 'swt-fingerprint-f21');
SELECT pg_temp.swt_assert((SELECT count(*) = 18 FROM platform_private.sales_register WHERE organization_id = pg_temp.swt_id(1)
      AND withdrawal_kind IS NULL AND withdrawn_at IS NULL AND withdrawn_by_membership_id IS NULL AND withdrawal_note IS NULL),
  'fixture: eighteen records of organization 1, none of them marked');

-- Two more helpers on the fixture: the mark of one record, and its version.
CREATE FUNCTION pg_temp.swt_reg(p_n INTEGER) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object('kind', r.withdrawal_kind, 'note', r.withdrawal_note, 'by', r.withdrawn_by_membership_id,
    'at', r.withdrawn_at IS NOT NULL, 'version', r.version, 'archived', r.archived)
  FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(p_n)
$$;
CREATE FUNCTION pg_temp.swt_ver(p_n INTEGER) RETURNS BIGINT LANGUAGE SQL STABLE AS $$
  SELECT r.version FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(p_n)
$$;
-- What the money of a record is: its fields and its «в валюте договора» amount.
CREATE FUNCTION pg_temp.swt_money(p_n INTEGER) RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT md5(r.fields::TEXT) || ':' || COALESCE(r.paid_contract_minor::TEXT, '-') || ':' || COALESCE(r.paid_contract_currency, '-')
  FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(p_n)
$$;
CREATE TEMP TABLE swt_money_before AS
  SELECT n, pg_temp.swt_money(n) AS money FROM unnest(ARRAY[6001, 6002, 6003, 6004, 6005, 6006, 6007, 6008, 6009, 6011, 6012, 6021, 6022, 6024, 6025, 6026]) AS n;

-- ---------------------------------------------------------------------------
-- 1. Before any mark: v5 is v4 plus `withdrawal: null` on every row and `withdrawn: {0, []}`.
-- ---------------------------------------------------------------------------
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(4, 7))::TEXT AS swt_a_v4_before \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7))::TEXT AS swt_a_v5_before \gset
SELECT pg_temp.swt_user_json(1, pg_temp.swt_read(4, 7))::TEXT AS swt_admin_v4_before \gset
SELECT pg_temp.swt_user_json(1, pg_temp.swt_read(5, 7))::TEXT AS swt_admin_v5_before \gset
SELECT pg_temp.swt_user_json(1, 'SELECT platform.staff_sales_count_v1(''' || pg_temp.swt_id(1) || ''', DATE ''2026-07-01'', DATE ''2026-07-31'')')::TEXT AS swt_admin_count_before \gset
SELECT pg_temp.swt_user_json(2, 'SELECT platform.staff_sales_count_v1(''' || pg_temp.swt_id(1) || ''', DATE ''2026-07-01'', DATE ''2026-07-31'')')::TEXT AS swt_a_count_before \gset
SELECT pg_temp.swt_assert(pg_temp.swt_keys(:'swt_a_v4_before'::JSONB) = ARRAY['has_more', 'manager_key', 'manager_options', 'month', 'offset',
      'organization_id', 'owner_options', 'query', 'rows', 'selected', 'targets', 'total_count', 'totals', 'unresolved_cost_count',
      'unresolved_paid_count', 'year']
  AND pg_temp.swt_keys(:'swt_a_v5_before'::JSONB) = ARRAY['has_more', 'manager_key', 'manager_options', 'month', 'offset',
      'organization_id', 'owner_options', 'query', 'rows', 'selected', 'targets', 'total_count', 'totals', 'unresolved_cost_count',
      'unresolved_paid_count', 'withdrawn', 'year'],
  'v5 answers exactly v4''s keys plus `withdrawn`: ' || (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(:'swt_a_v5_before'::JSONB) k));
SELECT pg_temp.swt_assert(
  (SELECT bool_and(pg_temp.swt_keys(v5) = (SELECT array_agg(k ORDER BY k COLLATE "C") FROM (
        SELECT jsonb_object_keys(pg_temp.swt_row(:'swt_a_v4_before'::JSONB, (v5 ->> 'id')::UUID)) UNION ALL SELECT 'withdrawal') AS keys(k))
      AND v5 -> 'withdrawal' = 'null'::JSONB AND v5 ? 'withdrawal')
    FROM jsonb_array_elements(:'swt_a_v5_before'::JSONB -> 'rows') v5)
  AND jsonb_array_length(:'swt_a_v5_before'::JSONB -> 'rows') = 8,
  'every v5 row is its v4 row plus a `withdrawal` key, null while nothing is marked');
SELECT pg_temp.swt_assert(
  (:'swt_a_v5_before'::JSONB - 'withdrawn') || jsonb_build_object('rows', (SELECT jsonb_agg(r - 'withdrawal' ORDER BY o)
      FROM jsonb_array_elements(:'swt_a_v5_before'::JSONB -> 'rows') WITH ORDINALITY AS e(r, o))) = :'swt_a_v4_before'::JSONB
  AND (:'swt_admin_v5_before'::JSONB - 'withdrawn') || jsonb_build_object('rows', (SELECT jsonb_agg(r - 'withdrawal' ORDER BY o)
      FROM jsonb_array_elements(:'swt_admin_v5_before'::JSONB -> 'rows') WITH ORDINALITY AS e(r, o))) = :'swt_admin_v4_before'::JSONB
  AND :'swt_a_v5_before'::JSONB -> 'withdrawn' = '{"count":0,"paid":[]}'::JSONB
  AND :'swt_admin_v5_before'::JSONB -> 'withdrawn' = '{"count":0,"paid":[]}'::JSONB,
  'with nothing marked v5 equals v4 in every other byte (rows, totals, counts, options), for a Sales Manager and for the Admin');
SELECT pg_temp.swt_assert((:'swt_a_v5_before'::JSONB ->> 'total_count') = '8'
  AND :'swt_a_v5_before'::JSONB -> 'totals' = '[{"currency":"EUR","cost_minor":"150000","paid_minor":"120000"},
      {"currency":"USD","cost_minor":"545000","paid_minor":"375000"}]'::JSONB
  AND (:'swt_a_v5_before'::JSONB ->> 'unresolved_cost_count') = '1' AND (:'swt_a_v5_before'::JSONB ->> 'unresolved_paid_count') = '1'
  AND (:'swt_admin_v5_before'::JSONB ->> 'total_count') = '10',
  'baseline: Sales Manager A reads 8 July records (EUR 1500 / 1200 paid in the contract currency; USD 5450 / 3750), the Admin all 10: '
    || (:'swt_a_v5_before'::JSONB -> 'totals')::TEXT);
SELECT pg_temp.swt_assert(:'swt_a_count_before'::JSONB = jsonb_build_object('organization_id', pg_temp.swt_id(1), 'from', '2026-07-01',
      'to', '2026-07-31', 'sales', '7', 'undated', '1', 'other_sale_date', '1', 'filed_elsewhere', '1')
  AND :'swt_admin_count_before'::JSONB = jsonb_build_object('organization_id', pg_temp.swt_id(1), 'from', '2026-07-01',
      'to', '2026-07-31', 'sales', '9', 'undated', '1', 'other_sale_date', '1', 'filed_elsewhere', '1'),
  'baseline of «Продажи» for July: 7 for Sales Manager A, 9 for the Admin (records of departments B and C included)');

-- ---------------------------------------------------------------------------
-- 2. set_sales_register_withdrawal_v1: the refusals first (R12, R7, R8 stay untouched).
-- ---------------------------------------------------------------------------
SELECT pg_temp.swt_state() AS swt_state_s2 \gset
SELECT pg_temp.swt_assert(r.answer = '42501:sales_register_forbidden', r.who || ' cannot mark: ' || r.answer)
FROM (VALUES
  ('the system Admin (not a Sales Manager)', pg_temp.swt_user(1, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', 'SWT must not exist', pg_temp.swt_id(7101)))),
  ('the second system Admin', pg_temp.swt_user(10, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7102)))),
  ('Sales Manager B (another department)', pg_temp.swt_user(3, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7103)))),
  ('the own-scope Sales Manager (no scope over a record of another owner)', pg_temp.swt_user(4, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7104)))),
  ('Sales Manager A on department B''s record', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6007), 1, 'partial', NULL, pg_temp.swt_id(7105)))),
  ('Sales Manager A on the own-scope manager''s record', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6008), 1, 'partial', NULL, pg_temp.swt_id(7106)))),
  ('the register reader (sales.register.read only)', pg_temp.swt_user(6, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7107)))),
  ('the Student', pg_temp.swt_user(5, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7108)))),
  ('staff without any role', pg_temp.swt_user(9, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7109)))),
  ('the curator', pg_temp.swt_user(8, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7110)))),
  ('the coarse Sales member', pg_temp.swt_user(7, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7111)))),
  ('a caller with no membership', pg_temp.swt_user(99, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7112)))),
  ('the Admin of another organization', pg_temp.swt_user(20, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7113)))),
  ('the Admin of another organization on its own organization''s id with a foreign record', pg_temp.swt_user(20, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7114), 2))),
  ('Sales Manager A naming the other organization', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7115), 2))),
  ('Sales Manager A on a record that does not exist', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6999), 1, 'partial', NULL, pg_temp.swt_id(7116))))
) AS r(who, answer);
SELECT pg_temp.swt_assert(pg_temp.swt_anon(pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7117))) LIKE '42501:permission denied%'
  AND pg_temp.swt_svc(pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, pg_temp.swt_id(7118))) LIKE '42501:permission denied%',
  'anon and the service role cannot execute the interface command at all');
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_s2', 'refused marks change nothing (records, requests, journal)');
-- The record gate asks for sales.register.MANAGE on the record, not for read: member 311 reads department B''s
-- record R7 (v5 shows it) and is still refused; on his own department''s record the same call passes the gate
-- (it is judged stale, with a version that is not the record''s, so nothing is written).
SELECT pg_temp.swt_user_json(11, pg_temp.swt_read(5, 7))::TEXT AS swt_w_v5 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_row(:'swt_w_v5'::JSONB, pg_temp.swt_id(6007)) IS NOT NULL
  AND (:'swt_w_v5'::JSONB ->> 'total_count') = '10'
  AND pg_temp.swt_user(11, pg_temp.swt_set(pg_temp.swt_id(6007), 1, 'partial', NULL, pg_temp.swt_id(7120))) = '42501:sales_register_forbidden'
  AND pg_temp.swt_user(11, pg_temp.swt_set(pg_temp.swt_id(6007), 1, NULL, NULL, pg_temp.swt_id(7121))) = '42501:sales_register_forbidden'
  AND pg_temp.swt_user(11, pg_temp.swt_set(pg_temp.swt_id(6012), 9, 'partial', NULL, pg_temp.swt_id(7122))) = 'PT409:sales_register_stale'
  AND pg_temp.swt_state() = :'swt_state_s2',
  'a Sales Manager who reads the whole register is refused on a record he may not manage (read is not manage), and passes the gate on his own');

-- Invalid commands, from a real Sales Manager: every one is 22023 and writes nothing.
SELECT pg_temp.swt_assert(r.answer = '22023:sales_register_invalid_command', r.what || ' is refused: ' || r.answer)
FROM (VALUES
  ('an unknown kind', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'refused', NULL, pg_temp.swt_id(7201)))),
  ('a kind in the wrong case', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'Partial', NULL, pg_temp.swt_id(7202)))),
  ('a note of 501 characters', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', repeat('n', 501), pg_temp.swt_id(7203)))),
  ('a note with a control character', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', 'SWT' || chr(1) || 'note', pg_temp.swt_id(7204)))),
  ('a note with a line break inside', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', E'two\nlines', pg_temp.swt_id(7205)))),
  ('a note without a kind', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, NULL, 'SWT note alone', pg_temp.swt_id(7206)))),
  ('version 0', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 0, 'partial', NULL, pg_temp.swt_id(7207)))),
  ('a version beyond the safe integer', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 9007199254740992, 'partial', NULL, pg_temp.swt_id(7208)))),
  ('no version', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), NULL, 'partial', NULL, pg_temp.swt_id(7209)))),
  ('no request id', pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', NULL, NULL))),
  ('no record', pg_temp.swt_user(2, pg_temp.swt_set(NULL, 1, 'partial', NULL, pg_temp.swt_id(7210))))
) AS r(what, answer);
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_s2', 'invalid commands change nothing');
-- Order of the gates: the identity is judged before the content (a Student with a bad kind is still forbidden).
SELECT pg_temp.swt_assert(pg_temp.swt_user(5, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'refused', NULL, pg_temp.swt_id(7211))) = '42501:sales_register_forbidden'
  AND pg_temp.swt_user(1, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'refused', NULL, pg_temp.swt_id(7212))) = '42501:sales_register_forbidden',
  'the gate comes first: a Student or the Admin with an invalid kind is forbidden, not told the kind is invalid');
-- A stale version and an archived record.
SELECT pg_temp.swt_assert(pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 2, 'partial', NULL, pg_temp.swt_id(7213))) = 'PT409:sales_register_stale'
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 7, NULL, NULL, pg_temp.swt_id(7214))) = 'PT409:sales_register_stale',
  'a stale version is PT409 sales_register_stale (marking and clearing alike)');
SELECT pg_temp.swt_assert(pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6010), 1, 'partial', NULL, pg_temp.swt_id(7215))) = '22023:sales_register_archived'
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6010), 1, NULL, NULL, pg_temp.swt_id(7216))) = '22023:sales_register_archived'
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6010), 5, 'partial', NULL, pg_temp.swt_id(7217))) = 'PT409:sales_register_stale',
  'an archived record is refused (22023 sales_register_archived) for a mark and for «Вернуть»; the version is judged before the archive');
-- «Вернуть» on a record with no mark.
SELECT pg_temp.swt_assert(pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, NULL, NULL, pg_temp.swt_id(7218))) = '22023:sales_register_withdrawal_missing'
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, NULL, '   ', pg_temp.swt_id(7219))) = '22023:sales_register_withdrawal_missing',
  '«Вернуть» without a mark is 22023 sales_register_withdrawal_missing (a blank note is no note)');
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_s2', 'every refusal above left the database as it was');

-- ---------------------------------------------------------------------------
-- R1: «Убрать» partial, the change of kind and note, «Вернуть»; the version at every step.
-- ---------------------------------------------------------------------------
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6001), 1, 'partial', E'  SWT padded note \t', pg_temp.swt_id(7301)))::TEXT AS swt_r1_a \gset
SELECT pg_temp.swt_assert(:'swt_r1_a'::JSONB = jsonb_build_object('organization_id', pg_temp.swt_id(1), 'record_id', pg_temp.swt_id(6001),
      'version', '2', 'operation', 'withdraw', 'request_id', pg_temp.swt_id(7301))
  AND pg_temp.swt_keys(:'swt_r1_a'::JSONB) = ARRAY['operation', 'organization_id', 'record_id', 'request_id', 'version'],
  'R1 partial: the receipt has exactly organization_id, record_id, version (text), operation withdraw, request_id: ' || :'swt_r1_a');
SELECT pg_temp.swt_assert(pg_temp.swt_reg(6001) = jsonb_build_object('kind', 'partial', 'note', 'SWT padded note', 'by', pg_temp.swt_id(302),
      'at', TRUE, 'version', 2, 'archived', FALSE)
  AND (SELECT r.withdrawn_at BETWEEN now() - INTERVAL '1 hour' AND clock_timestamp() + INTERVAL '1 second'
    FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6001)),
  'R1 partial: kind, trimmed note, the marker (Sales Manager A), the time and version 2 are stored');
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6001), 2, 'unpaid', repeat('n', 500), pg_temp.swt_id(7302)))::TEXT AS swt_r1_b \gset
SELECT pg_temp.swt_assert(:'swt_r1_b'::JSONB ->> 'version' = '3' AND :'swt_r1_b'::JSONB ->> 'operation' = 'withdraw'
  AND (SELECT r.withdrawal_kind = 'unpaid' AND char_length(r.withdrawal_note) = 500 AND r.version = 3
    FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6001)),
  'R1 change to unpaid with a note of exactly 500 characters: version 3');
SELECT pg_temp.swt_assert(pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6001), 3, 'unpaid', repeat('n', 500), pg_temp.swt_id(7303)))
    = '22023:sales_register_withdrawal_unchanged'
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6001), 3, 'unpaid', '  ' || repeat('n', 500) || E'\n', pg_temp.swt_id(7304)))
    = '22023:sales_register_withdrawal_unchanged',
  'the same kind and note again is 22023 sales_register_withdrawal_unchanged (outer whitespace is not a difference)');
SELECT pg_temp.swt_assert(pg_temp.swt_reg(6001) ->> 'version' = '3', 'the refused identical mark left version 3');
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6001), 3, 'unpaid', 'SWT second note', pg_temp.swt_id(7305)))::TEXT AS swt_r1_c \gset
SELECT pg_temp.swt_assert(:'swt_r1_c'::JSONB ->> 'version' = '4' AND pg_temp.swt_reg(6001) ->> 'note' = 'SWT second note'
  AND pg_temp.swt_reg(6001) ->> 'kind' = 'unpaid',
  'the same kind with another note is a change (version 4)');
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6001), 4, NULL, NULL, pg_temp.swt_id(7306)))::TEXT AS swt_r1_d \gset
SELECT pg_temp.swt_assert(:'swt_r1_d'::JSONB = jsonb_build_object('organization_id', pg_temp.swt_id(1), 'record_id', pg_temp.swt_id(6001),
      'version', '5', 'operation', 'withdraw_undo', 'request_id', pg_temp.swt_id(7306))
  AND pg_temp.swt_reg(6001) = jsonb_build_object('kind', NULL, 'note', NULL, 'by', NULL, 'at', FALSE, 'version', 5, 'archived', FALSE),
  '«Вернуть»: operation withdraw_undo, version 5, the whole mark (kind, time, marker, note) is gone');
SELECT pg_temp.swt_assert(pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6001), 5, NULL, NULL, pg_temp.swt_id(7307)))
    = '22023:sales_register_withdrawal_missing'
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6001), 1, 'partial', NULL, pg_temp.swt_id(7308))) = 'PT409:sales_register_stale',
  'a second «Вернуть» is 22023 sales_register_withdrawal_missing; an old version is stale');
SELECT pg_temp.swt_assert(pg_temp.swt_money(6001) = (SELECT money FROM swt_money_before WHERE n = 6001),
  'R1: the money (fields, paid in the contract currency) is the same after five commands');
-- The journal of R1: four events, the existing action, no free text, the same request ids.
SELECT pg_temp.swt_assert((SELECT count(*) = 4 AND bool_and(a.action = 'sales.register.update' AND a.resource_type = 'sales_register'
      AND a.actor_kind = 'user' AND a.actor_profile_id = pg_temp.swt_id(202)
      AND a.actor_principal = 'auth:' || pg_temp.swt_id(102)::TEXT AND a.reason = 'Sales register withdrawal'
      AND pg_temp.swt_keys(a.before_state) = ARRAY['archived', 'version', 'withdrawal_kind']
      AND pg_temp.swt_keys(a.after_state) = ARRAY['archived', 'version', 'withdrawal_kind'])
    FROM platform.audit_events a WHERE a.resource_id = pg_temp.swt_id(6001) AND a.action LIKE 'sales.register.%')
  AND (SELECT jsonb_agg(jsonb_build_array(a.before_state, a.after_state) ORDER BY (a.after_state ->> 'version')::INT)
      FROM platform.audit_events a WHERE a.resource_id = pg_temp.swt_id(6001))
    = '[[{"archived":false,"version":"1","withdrawal_kind":null},{"archived":false,"version":"2","withdrawal_kind":"partial"}],
        [{"archived":false,"version":"2","withdrawal_kind":"partial"},{"archived":false,"version":"3","withdrawal_kind":"unpaid"}],
        [{"archived":false,"version":"3","withdrawal_kind":"unpaid"},{"archived":false,"version":"4","withdrawal_kind":"unpaid"}],
        [{"archived":false,"version":"4","withdrawal_kind":"unpaid"},{"archived":false,"version":"5","withdrawal_kind":null}]]'::JSONB
  AND (SELECT array_agg(a.request_id ORDER BY (a.after_state ->> 'version')::INT) FROM platform.audit_events a WHERE a.resource_id = pg_temp.swt_id(6001))
    = ARRAY[pg_temp.swt_id(7301), pg_temp.swt_id(7302), pg_temp.swt_id(7305), pg_temp.swt_id(7306)],
  'the journal of R1: sales.register.update, versions and the kind only, the request ids of the four commands');
SELECT pg_temp.swt_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.organization_id = pg_temp.swt_id(1)
      AND concat_ws(' ', a.before_state::TEXT, a.after_state::TEXT, a.reason) ~* '(SWT padded|SWT second|nnnnn|SWT must not|SWT R[0-9]|SWT Actor|example\.invalid)'),
  'no note, name or e-mail is in any journal row');
SELECT pg_temp.swt_assert((SELECT r.reason FROM platform_private.sales_register_requests r WHERE r.request_id = pg_temp.swt_id(7301)) = 'SWT padded note'
  AND (SELECT r.reason FROM platform_private.sales_register_requests r WHERE r.request_id = pg_temp.swt_id(7306)) = 'Sales register withdrawal',
  'the note is kept privately with the request (the interface''s explanation), never in the journal');

-- ---------------------------------------------------------------------------
-- R2: replay, conflict and the replay after the ownership changed.
-- ---------------------------------------------------------------------------
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6002), 1, 'partial', 'SWT note R2', pg_temp.swt_id(7401)))::TEXT AS swt_r2_a \gset
SELECT pg_temp.swt_state() AS swt_state_r2 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6002), 1, 'partial', 'SWT note R2', pg_temp.swt_id(7401)))::TEXT AS swt_r2_replay \gset
SELECT pg_temp.swt_assert(:'swt_r2_replay'::JSONB = :'swt_r2_a'::JSONB AND :'swt_r2_a'::JSONB ->> 'version' = '2'
  AND pg_temp.swt_state() = :'swt_state_r2'
  AND (SELECT count(*) = 1 FROM platform.audit_events WHERE request_id = pg_temp.swt_id(7401))
  AND (SELECT count(*) = 1 FROM platform_private.sales_register_requests WHERE request_id = pg_temp.swt_id(7401)),
  'replay: the same request id and body returns the same receipt and writes nothing (one journal row, one request)');
SELECT pg_temp.swt_assert(pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6002), 1, 'unpaid', 'SWT note R2', pg_temp.swt_id(7401)))
    = '22023:sales_register_request_id_conflict'
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6002), 1, 'partial', 'SWT another', pg_temp.swt_id(7401)))
    = '22023:sales_register_request_id_conflict'
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6002), 2, 'partial', 'SWT note R2', pg_temp.swt_id(7401)))
    = '22023:sales_register_request_id_conflict'
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', 'SWT note R2', pg_temp.swt_id(7401)))
    = '22023:sales_register_request_id_conflict'
  AND pg_temp.swt_user(3, pg_temp.swt_set(pg_temp.swt_id(6002), 1, 'partial', 'SWT note R2', pg_temp.swt_id(7401)))
    = '22023:sales_register_request_id_conflict',
  'conflict: the same request id with another kind, note, version, record or actor is 22023 sales_register_request_id_conflict');
SELECT pg_temp.swt_assert(pg_temp.swt_user(1, pg_temp.swt_set(pg_temp.swt_id(6002), 1, 'partial', 'SWT note R2', pg_temp.swt_id(7401)))
    = '42501:sales_register_forbidden'
  AND pg_temp.swt_state() = :'swt_state_r2',
  'a replay by a caller who is not a Sales Manager is forbidden, and the conflicts wrote nothing');
-- The record changes hands to department B: the earlier receipt is not shown to Sales Manager A any more.
UPDATE platform_private.sales_register SET owner_membership_id = pg_temp.swt_id(303) WHERE id = pg_temp.swt_id(6002);
SELECT pg_temp.swt_assert(pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6002), 1, 'partial', 'SWT note R2', pg_temp.swt_id(7401)))
    = '42501:sales_register_forbidden',
  'a replay is not served after the ownership changed away from the caller''s scope');
UPDATE platform_private.sales_register SET owner_membership_id = pg_temp.swt_id(302) WHERE id = pg_temp.swt_id(6002);
SELECT pg_temp.swt_assert(pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6002), 1, 'partial', 'SWT note R2', pg_temp.swt_id(7401))) = :'swt_r2_a'::JSONB
  AND pg_temp.swt_reg(6002) = jsonb_build_object('kind', 'partial', 'note', 'SWT note R2', 'by', pg_temp.swt_id(302), 'at', TRUE,
      'version', 2, 'archived', FALSE),
  'the owner back in scope: the replay is served again; R2 stays partial at version 2');

-- ---------------------------------------------------------------------------
-- R3 (paid in another currency), R11 (no money), R7 (Sales Manager B), R8 (own scope), R9 (manual).
-- ---------------------------------------------------------------------------
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6003), 1, 'unpaid', NULL, pg_temp.swt_id(7501)))::TEXT AS swt_r3 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6011), 1, 'unpaid', NULL, pg_temp.swt_id(7502)))::TEXT AS swt_r11 \gset
SELECT pg_temp.swt_user_json(3, pg_temp.swt_set(pg_temp.swt_id(6007), 1, 'partial', NULL, pg_temp.swt_id(7503)))::TEXT AS swt_r7 \gset
SELECT pg_temp.swt_user_json(4, pg_temp.swt_set(pg_temp.swt_id(6008), 1, 'unpaid', NULL, pg_temp.swt_id(7504)))::TEXT AS swt_r8 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6009), 1, 'unpaid', 'SWT manual refusal', pg_temp.swt_id(7505)))::TEXT AS swt_r9 \gset
SELECT pg_temp.swt_assert((:'swt_r3'::JSONB ->> 'version') = '2' AND (:'swt_r11'::JSONB ->> 'version') = '2' AND (:'swt_r7'::JSONB ->> 'version') = '2'
  AND (:'swt_r8'::JSONB ->> 'version') = '2' AND (:'swt_r9'::JSONB ->> 'version') = '2'
  AND pg_temp.swt_reg(6003) ->> 'kind' = 'unpaid' AND pg_temp.swt_reg(6011) ->> 'kind' = 'unpaid'
  AND pg_temp.swt_reg(6007) = jsonb_build_object('kind', 'partial', 'note', NULL, 'by', pg_temp.swt_id(303), 'at', TRUE, 'version', 2, 'archived', FALSE)
  AND pg_temp.swt_reg(6008) = jsonb_build_object('kind', 'unpaid', 'note', NULL, 'by', pg_temp.swt_id(304), 'at', TRUE, 'version', 2, 'archived', FALSE)
  AND pg_temp.swt_reg(6009) = jsonb_build_object('kind', 'unpaid', 'note', 'SWT manual refusal', 'by', pg_temp.swt_id(302), 'at', TRUE,
      'version', 2, 'archived', FALSE),
  'each Sales Manager marks the records in their own scope (department, department B, own scope; a manual record too), the marker is recorded');
SELECT pg_temp.swt_assert(pg_temp.swt_money(6003) = (SELECT money FROM swt_money_before WHERE n = 6003)
  AND pg_temp.swt_money(6011) = (SELECT money FROM swt_money_before WHERE n = 6011)
  AND pg_temp.swt_money(6007) = (SELECT money FROM swt_money_before WHERE n = 6007)
  AND pg_temp.swt_money(6008) = (SELECT money FROM swt_money_before WHERE n = 6008)
  AND pg_temp.swt_money(6009) = (SELECT money FROM swt_money_before WHERE n = 6009)
  AND pg_temp.swt_money(6002) = (SELECT money FROM swt_money_before WHERE n = 6002)
  AND (SELECT r.paid_contract_minor = 120000 AND r.paid_contract_currency = 'EUR' AND r.fields ->> 'paid_minor' = '13500000'
    FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6003)),
  'marking changes no money: paid_minor / paid_currency in fields and the paid-in-contract-currency amount are as they were');
-- A Sales Manager of another scope still cannot take the mark away.
SELECT pg_temp.swt_assert(pg_temp.swt_user(3, pg_temp.swt_set(pg_temp.swt_id(6003), 2, NULL, NULL, pg_temp.swt_id(7506))) = '42501:sales_register_forbidden'
  AND pg_temp.swt_user(4, pg_temp.swt_set(pg_temp.swt_id(6007), 2, NULL, NULL, pg_temp.swt_id(7507))) = '42501:sales_register_forbidden'
  AND pg_temp.swt_user(1, pg_temp.swt_set(pg_temp.swt_id(6003), 2, NULL, NULL, pg_temp.swt_id(7508))) = '42501:sales_register_forbidden'
  AND pg_temp.swt_reg(6003) ->> 'kind' = 'unpaid',
  '«Вернуть» takes the same gates as «Убрать»: another department, another scope and the Admin cannot');

-- ---------------------------------------------------------------------------
-- R9: archive and restore keep the mark; an archived record takes no mark change.
-- ---------------------------------------------------------------------------
SELECT pg_temp.swt_user_json(2, format('SELECT platform.manage_sales_register_v2(%L::UUID, ''archive'', %L::UUID, 2, ''{}''::JSONB, NULL, NULL, ''SWT archive'', %L::UUID)',
  pg_temp.swt_id(1), pg_temp.swt_id(6009), pg_temp.swt_id(7601)))::TEXT AS swt_r9_archive \gset
SELECT pg_temp.swt_assert(pg_temp.swt_reg(6009) = jsonb_build_object('kind', 'unpaid', 'note', 'SWT manual refusal', 'by', pg_temp.swt_id(302),
      'at', TRUE, 'version', 3, 'archived', TRUE)
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6009), 3, 'partial', NULL, pg_temp.swt_id(7602))) = '22023:sales_register_archived'
  AND pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6009), 3, NULL, NULL, pg_temp.swt_id(7603))) = '22023:sales_register_archived',
  'archiving keeps the mark; while archived neither «Убрать» nor «Вернуть» is accepted (restore it first)');
SELECT pg_temp.swt_user_json(2, format('SELECT platform.manage_sales_register_v2(%L::UUID, ''restore'', %L::UUID, 3, ''{}''::JSONB, NULL, NULL, ''SWT restore'', %L::UUID)',
  pg_temp.swt_id(1), pg_temp.swt_id(6009), pg_temp.swt_id(7604)))::TEXT AS swt_r9_restore \gset
SELECT pg_temp.swt_assert(pg_temp.swt_reg(6009) = jsonb_build_object('kind', 'unpaid', 'note', 'SWT manual refusal', 'by', pg_temp.swt_id(302),
      'at', TRUE, 'version', 4, 'archived', FALSE)
  AND (SELECT r.withdrawn_at = (SELECT a.withdrawn_at FROM platform_private.sales_register a WHERE a.id = pg_temp.swt_id(6009))
    FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6009))
  AND pg_temp.swt_money(6009) = (SELECT money FROM swt_money_before WHERE n = 6009),
  'after restore the record is back with the same mark and the same money (version 4)');

-- ---------------------------------------------------------------------------
-- R12: an ordinary edit through manage_sales_register_v2 does not clear the mark.
-- ---------------------------------------------------------------------------
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6012), 1, 'partial', 'SWT note R12', pg_temp.swt_id(7701)))::TEXT AS swt_r12_mark \gset
SELECT (SELECT withdrawn_at::TEXT FROM platform_private.sales_register WHERE id = pg_temp.swt_id(6012)) AS swt_r12_at \gset
SELECT jsonb_build_object('report_month', r.report_month::TEXT, 'owner_membership_id', r.owner_membership_id::TEXT)
  || (r.fields - 'needs_review') || jsonb_build_object('needs_review', FALSE, 'phone', '+996700000012') AS swt_r12_fields
  FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6012) \gset
SELECT pg_temp.swt_user_json(2, format('SELECT platform.manage_sales_register_v2(%L::UUID, ''update'', %L::UUID, 2, %L::JSONB, NULL, NULL, ''SWT edit'', %L::UUID)',
  pg_temp.swt_id(1), pg_temp.swt_id(6012), :'swt_r12_fields', pg_temp.swt_id(7702)))::TEXT AS swt_r12_edit \gset
SELECT pg_temp.swt_assert(:'swt_r12_edit'::JSONB ->> 'version' = '3'
  AND (SELECT r.fields ->> 'phone' = '+996700000012' AND r.withdrawal_kind = 'partial' AND r.withdrawal_note = 'SWT note R12'
      AND r.withdrawn_by_membership_id = pg_temp.swt_id(302) AND r.withdrawn_at::TEXT = :'swt_r12_at'
    FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6012)),
  'an ordinary edit changed the field and moved the version, and left the whole mark in place');
SELECT pg_temp.swt_assert(pg_temp.swt_user(2, pg_temp.swt_set(pg_temp.swt_id(6012), 2, NULL, NULL, pg_temp.swt_id(7703))) = 'PT409:sales_register_stale',
  'the edit moved the version: the old one is stale for «Вернуть» too');
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6012), 3, NULL, NULL, pg_temp.swt_id(7704)))::TEXT AS swt_r12_undo \gset
SELECT pg_temp.swt_assert(pg_temp.swt_reg(6012) = jsonb_build_object('kind', NULL, 'note', NULL, 'by', NULL, 'at', FALSE, 'version', 4, 'archived', FALSE)
  AND (SELECT r.fields ->> 'phone' = '+996700000012' FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6012)),
  'R12 «Вернуть» at version 3: unmarked at version 4, with the edit kept');

-- ---------------------------------------------------------------------------
-- The journal and the money after all of it.
-- ---------------------------------------------------------------------------
SELECT pg_temp.swt_assert((SELECT bool_and(a.action = 'sales.register.update'
        AND pg_temp.swt_keys(a.before_state) = ARRAY['archived', 'version', 'withdrawal_kind']
        AND pg_temp.swt_keys(a.after_state) = ARRAY['archived', 'version', 'withdrawal_kind'])
      FROM platform.audit_events a WHERE a.request_id IN (
        pg_temp.swt_id(7301), pg_temp.swt_id(7302), pg_temp.swt_id(7305), pg_temp.swt_id(7306), pg_temp.swt_id(7401), pg_temp.swt_id(7501),
        pg_temp.swt_id(7502), pg_temp.swt_id(7503), pg_temp.swt_id(7504), pg_temp.swt_id(7505), pg_temp.swt_id(7701), pg_temp.swt_id(7704))),
  'every withdrawal command wrote one sales.register.update row with versions, the archive flag and the kind only');
SELECT pg_temp.swt_assert((SELECT count(*) = 12 FROM platform.audit_events a WHERE a.request_id IN (
        pg_temp.swt_id(7301), pg_temp.swt_id(7302), pg_temp.swt_id(7305), pg_temp.swt_id(7306), pg_temp.swt_id(7401), pg_temp.swt_id(7501),
        pg_temp.swt_id(7502), pg_temp.swt_id(7503), pg_temp.swt_id(7504), pg_temp.swt_id(7505), pg_temp.swt_id(7701), pg_temp.swt_id(7704))),
  'twelve accepted commands, twelve journal rows (no row for a replay, a refusal or a conflict)');
SELECT pg_temp.swt_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.organization_id = pg_temp.swt_id(1)
      AND concat_ws(' ', a.before_state::TEXT, a.after_state::TEXT, a.reason)
        ~* '(SWT padded|SWT second|SWT note|SWT manual|nnnnn|SWT must not|SWT R[0-9]|SWT Actor|example\.invalid)'),
  'no note, name or e-mail is in any journal row of the organization');
SELECT pg_temp.swt_assert(pg_temp.swt_money(n) = m.money, 'record ' || n || ': the money is as before every command')
FROM swt_money_before m WHERE n IN (6001, 6002, 6003, 6004, 6005, 6006, 6007, 6008, 6009, 6011);

-- ---------------------------------------------------------------------------
-- 3. read_sales_register_v5 after the marks: R2, R3, R9, R11 are refused for Sales Manager A.
-- ---------------------------------------------------------------------------
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7))::TEXT AS swt_a_v5 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(4, 7))::TEXT AS swt_a_v4 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(3, 7))::TEXT AS swt_a_v3 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(2, 7))::TEXT AS swt_a_v2 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(1, 7))::TEXT AS swt_a_v1 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_keys(:'swt_a_v5'::JSONB) = ARRAY['has_more', 'manager_key', 'manager_options', 'month', 'offset',
      'organization_id', 'owner_options', 'query', 'rows', 'selected', 'targets', 'total_count', 'totals', 'unresolved_cost_count',
      'unresolved_paid_count', 'withdrawn', 'year']
  AND (SELECT bool_and(pg_temp.swt_keys(v5) = (SELECT array_agg(k ORDER BY k COLLATE "C") FROM (
        SELECT jsonb_object_keys(pg_temp.swt_row(:'swt_a_v4'::JSONB, (v5 ->> 'id')::UUID)) UNION ALL SELECT 'withdrawal') AS keys(k)))
    FROM jsonb_array_elements(:'swt_a_v5'::JSONB -> 'rows') v5),
  'the key sets stay exact once rows are marked: v4''s keys plus `withdrawn`; every row v4''s keys plus `withdrawal`');
-- The `withdrawal` object: exactly kind, at, by, note; `by` is the marker's display name.
SELECT pg_temp.swt_assert(w.kind IS NOT DISTINCT FROM (pg_temp.swt_row(:'swt_a_v5'::JSONB, pg_temp.swt_id(w.n)) -> 'withdrawal' ->> 'kind')
  AND pg_temp.swt_keys(pg_temp.swt_row(:'swt_a_v5'::JSONB, pg_temp.swt_id(w.n)) -> 'withdrawal') = ARRAY['at', 'by', 'kind', 'note']
  AND (pg_temp.swt_row(:'swt_a_v5'::JSONB, pg_temp.swt_id(w.n)) -> 'withdrawal' ->> 'by') = 'SWT Actor 2'
  AND (pg_temp.swt_row(:'swt_a_v5'::JSONB, pg_temp.swt_id(w.n)) -> 'withdrawal' -> 'note') IS NOT DISTINCT FROM
    CASE WHEN w.note IS NULL THEN 'null'::JSONB ELSE to_jsonb(w.note) END
  AND (pg_temp.swt_row(:'swt_a_v5'::JSONB, pg_temp.swt_id(w.n)) -> 'withdrawal' -> 'at') = to_jsonb(
    (SELECT r.withdrawn_at FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(w.n))),
  'record ' || w.n || ' carries withdrawal ' || (pg_temp.swt_row(:'swt_a_v5'::JSONB, pg_temp.swt_id(w.n)) -> 'withdrawal')::TEXT)
FROM (VALUES (6002, 'partial', 'SWT note R2'), (6003, 'unpaid', NULL), (6009, 'unpaid', 'SWT manual refusal'), (6011, 'unpaid', NULL))
  AS w(n, kind, note);
SELECT pg_temp.swt_assert(pg_temp.swt_row(:'swt_a_v5'::JSONB, pg_temp.swt_id(n)) -> 'withdrawal' = 'null'::JSONB,
  'record ' || n || ' is not marked: withdrawal is null')
FROM unnest(ARRAY[6001, 6004, 6005, 6012]) AS n;
-- Refused rows are listed (rows, total_count) but are out of the totals and the unresolved counts.
SELECT pg_temp.swt_assert((:'swt_a_v5'::JSONB ->> 'total_count') = '8' AND jsonb_array_length(:'swt_a_v5'::JSONB -> 'rows') = 8
  AND (SELECT array_agg((r ->> 'id')::UUID ORDER BY r ->> 'id') FROM jsonb_array_elements(:'swt_a_v5'::JSONB -> 'rows') r)
    = (SELECT array_agg((r ->> 'id')::UUID ORDER BY r ->> 'id') FROM jsonb_array_elements(:'swt_a_v4'::JSONB -> 'rows') r),
  'the refused records are still listed: v5 lists the 8 records v4 lists');
SELECT pg_temp.swt_assert(:'swt_a_v5'::JSONB -> 'totals' = '[{"currency":"USD","cost_minor":"295000","paid_minor":"275000"}]'::JSONB
  AND (:'swt_a_v5'::JSONB ->> 'unresolved_cost_count') = '0' AND (:'swt_a_v5'::JSONB ->> 'unresolved_paid_count') = '0',
  'totals count only R1, R4, R5, R12 (USD 2950 / 2750); the refused EUR record and the unresolved R11 are out: ' || (:'swt_a_v5'::JSONB -> 'totals')::TEXT);
SELECT pg_temp.swt_assert(:'swt_a_v5'::JSONB -> 'withdrawn' = '{"count":4,"paid":[{"currency":"EUR","paid_minor":"120000"},
    {"currency":"USD","paid_minor":"100000"}]}'::JSONB
  AND pg_temp.swt_keys(:'swt_a_v5'::JSONB -> 'withdrawn') = ARRAY['count', 'paid'],
  'withdrawn: 4 records, paid per currency (the paid-in-contract-currency 1200 EUR of R3; 500 + 500 USD of R2 and R9; R11 paid nothing): '
    || (:'swt_a_v5'::JSONB -> 'withdrawn')::TEXT);
SELECT pg_temp.swt_assert((SELECT bool_and(jsonb_typeof(p -> 'paid_minor') = 'string') FROM jsonb_array_elements(:'swt_a_v5'::JSONB -> 'withdrawn' -> 'paid') p)
  AND jsonb_typeof(:'swt_a_v5'::JSONB -> 'withdrawn' -> 'count') = 'number',
  'the amounts of `withdrawn.paid` are text (like totals), the count a number');
SELECT pg_temp.swt_assert(:'swt_a_v5'::JSONB -> 'manager_options' = '[{"key":"swt manager","name":"SWT Manager","count":8}]'::JSONB,
  'the manager options count what choosing the manager shows (refused records included)');
-- v4 and the older reads on the same data: the old shape, refused records still in their totals.
SELECT pg_temp.swt_assert(NOT (:'swt_a_v4'::JSONB ? 'withdrawn')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'swt_a_v4'::JSONB -> 'rows') r WHERE r ? 'withdrawal')
  AND :'swt_a_v4'::JSONB -> 'totals' = '[{"currency":"EUR","cost_minor":"150000","paid_minor":"120000"},
      {"currency":"USD","cost_minor":"545000","paid_minor":"375000"}]'::JSONB
  AND (:'swt_a_v4'::JSONB ->> 'unresolved_cost_count') = '1' AND (:'swt_a_v4'::JSONB ->> 'unresolved_paid_count') = '1'
  AND (:'swt_a_v4'::JSONB ->> 'total_count') = '8'
  AND :'swt_a_v4'::JSONB - 'rows' = :'swt_a_v4_before'::JSONB - 'rows',
  'v4 is untouched: no `withdrawal`, no `withdrawn`, the refused records are in its totals and counts as before');
SELECT pg_temp.swt_assert((SELECT bool_and((v5 - 'withdrawal') = pg_temp.swt_row(:'swt_a_v4'::JSONB, (v5 ->> 'id')::UUID))
    FROM jsonb_array_elements(:'swt_a_v5'::JSONB -> 'rows') v5),
  'every v5 row minus `withdrawal` is the v4 row byte for byte (the new version and time of the marked records included)');
SELECT pg_temp.swt_assert(strpos(:'swt_a_v3', 'withdraw') = 0 AND strpos(:'swt_a_v2', 'withdraw') = 0 AND strpos(:'swt_a_v1', 'withdraw') = 0
  AND (:'swt_a_v3'::JSONB ->> 'total_count') = '8' AND (:'swt_a_v2'::JSONB ->> 'total_count') = '8' AND (:'swt_a_v1'::JSONB ->> 'total_count') = '8'
  AND :'swt_a_v3'::JSONB -> 'totals' @> '[{"currency":"USD","cost_minor":"545000","paid_minor":"375000"}]'::JSONB
  AND (:'swt_a_v3'::JSONB ->> 'unresolved_cost_count') = '1',
  'v1, v2 and v3 know nothing of the mark and still count the refused records');
-- The selected record.
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7, 'p_record_id => ''' || pg_temp.swt_id(6002) || '''::UUID'))::TEXT AS swt_a_sel5 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(4, 7, 'p_record_id => ''' || pg_temp.swt_id(6002) || '''::UUID'))::TEXT AS swt_a_sel4 \gset
SELECT pg_temp.swt_assert(:'swt_a_sel5'::JSONB -> 'selected' = pg_temp.swt_row(:'swt_a_v5'::JSONB, pg_temp.swt_id(6002))
  AND :'swt_a_sel5'::JSONB -> 'selected' -> 'withdrawal' ->> 'kind' = 'partial'
  AND NOT (:'swt_a_sel4'::JSONB -> 'selected' ? 'withdrawal')
  AND pg_temp.swt_user(2, pg_temp.swt_read(5, 7, 'p_record_id => ''' || pg_temp.swt_id(6007) || '''::UUID')) = '42501:sales_register_forbidden',
  'the selected record has its `withdrawal` in v5 (not in v4); a record out of scope is still forbidden');
-- Filters are refused as in v4.
SELECT pg_temp.swt_assert(pg_temp.swt_user(2, pg_temp.swt_read(5, 7, 'p_sale_slice => ''elsewhere''')) = '22023:sales_register_invalid_filter'
  AND pg_temp.swt_user(2, pg_temp.swt_read(5, 7, 'p_archived => TRUE, p_sale_slice => ''undated''')) = '22023:sales_register_invalid_filter'
  AND pg_temp.swt_user(2, pg_temp.swt_read(5, 7, 'p_manager_key => '' . ''')) = '22023:sales_register_invalid_filter'
  AND pg_temp.swt_user(2, pg_temp.swt_read(5, 13)) = '22023:sales_register_invalid_filter',
  'v5 refuses the same filters v4 refuses');

-- Visibility as in v4: every reader sees only the records of their scope, with the marks of their scope.
SELECT pg_temp.swt_user_json(3, pg_temp.swt_read(5, 7))::TEXT AS swt_b_v5 \gset
SELECT pg_temp.swt_user_json(4, pg_temp.swt_read(5, 7))::TEXT AS swt_own_v5 \gset
SELECT pg_temp.swt_user_json(1, pg_temp.swt_read(5, 7))::TEXT AS swt_admin_v5 \gset
SELECT pg_temp.swt_user_json(6, pg_temp.swt_read(5, 7))::TEXT AS swt_reader_v5 \gset
SELECT pg_temp.swt_assert((:'swt_b_v5'::JSONB ->> 'total_count') = '1'
  AND (:'swt_b_v5'::JSONB -> 'rows' -> 0 ->> 'id') = pg_temp.swt_id(6007)::TEXT
  AND (:'swt_b_v5'::JSONB -> 'rows' -> 0 -> 'withdrawal' ->> 'by') = 'SWT Actor 3'
  AND (:'swt_b_v5'::JSONB -> 'rows' -> 0 -> 'withdrawal' ->> 'kind') = 'partial'
  AND :'swt_b_v5'::JSONB -> 'totals' = '[]'::JSONB
  AND :'swt_b_v5'::JSONB -> 'withdrawn' = '{"count":1,"paid":[{"currency":"USD","paid_minor":"40000"}]}'::JSONB,
  'Sales Manager B sees only R7: refused, so no totals, and a withdrawn block of 400 USD');
SELECT pg_temp.swt_assert((:'swt_own_v5'::JSONB ->> 'total_count') = '1'
  AND (:'swt_own_v5'::JSONB -> 'rows' -> 0 ->> 'id') = pg_temp.swt_id(6008)::TEXT
  AND (:'swt_own_v5'::JSONB -> 'rows' -> 0 -> 'withdrawal' ->> 'by') = 'SWT Actor 4'
  AND :'swt_own_v5'::JSONB -> 'totals' = '[]'::JSONB
  AND :'swt_own_v5'::JSONB -> 'withdrawn' = '{"count":1,"paid":[{"currency":"USD","paid_minor":"60000"}]}'::JSONB,
  'the own-scope Sales Manager sees only R8 and its mark');
SELECT pg_temp.swt_assert((:'swt_admin_v5'::JSONB ->> 'total_count') = '10' AND (:'swt_reader_v5'::JSONB ->> 'total_count') = '10'
  AND :'swt_admin_v5'::JSONB -> 'totals' = '[{"currency":"USD","cost_minor":"295000","paid_minor":"275000"}]'::JSONB
  AND :'swt_admin_v5'::JSONB -> 'withdrawn' = '{"count":6,"paid":[{"currency":"EUR","paid_minor":"120000"},
      {"currency":"USD","paid_minor":"200000"}]}'::JSONB
  AND :'swt_reader_v5'::JSONB -> 'withdrawn' = :'swt_admin_v5'::JSONB -> 'withdrawn'
  AND :'swt_reader_v5'::JSONB -> 'rows' = :'swt_admin_v5'::JSONB -> 'rows',
  'the Admin and the register reader see all 10 July records and the 6 marks (the reader reads the mark; only the command is gated)');
SELECT pg_temp.swt_assert(pg_temp.swt_user(5, pg_temp.swt_read(5, 7)) = '42501:sales_register_forbidden'
  AND pg_temp.swt_user(99, pg_temp.swt_read(5, 7)) = '42501:sales_register_forbidden'
  AND pg_temp.swt_user(20, pg_temp.swt_read(5, 7)) = '42501:sales_register_forbidden'
  AND pg_temp.swt_anon(pg_temp.swt_read(5, 7)) LIKE '42501:permission denied%'
  AND pg_temp.swt_svc(pg_temp.swt_read(5, 7)) LIKE '42501:permission denied%',
  'v5 is refused to the Student, a caller without membership, another organization''s Admin, anon and the service role');

-- The archive view: an archived marked record is listed with its mark; no refusal count there.
SELECT pg_temp.swt_user_json(2, format('SELECT platform.manage_sales_register_v2(%L::UUID, ''archive'', %L::UUID, %s, ''{}''::JSONB, NULL, NULL, ''SWT archive R2'', %L::UUID)',
  pg_temp.swt_id(1), pg_temp.swt_id(6002), pg_temp.swt_ver(6002), pg_temp.swt_id(7801)))::TEXT AS swt_r2_archive \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7, 'p_archived => TRUE'))::TEXT AS swt_a_arch5 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7))::TEXT AS swt_a_live5 \gset
SELECT pg_temp.swt_assert((SELECT array_agg((r ->> 'id')::UUID ORDER BY r ->> 'id') FROM jsonb_array_elements(:'swt_a_arch5'::JSONB -> 'rows') r)
    = ARRAY[pg_temp.swt_id(6002), pg_temp.swt_id(6010)]
  AND pg_temp.swt_row(:'swt_a_arch5'::JSONB, pg_temp.swt_id(6002)) -> 'withdrawal' ->> 'kind' = 'partial'
  AND pg_temp.swt_row(:'swt_a_arch5'::JSONB, pg_temp.swt_id(6010)) -> 'withdrawal' = 'null'::JSONB
  AND :'swt_a_arch5'::JSONB -> 'totals' = '[]'::JSONB
  AND :'swt_a_arch5'::JSONB -> 'withdrawn' = '{"count":0,"paid":[]}'::JSONB
  AND (:'swt_a_arch5'::JSONB ->> 'unresolved_cost_count') = '0' AND (:'swt_a_arch5'::JSONB ->> 'unresolved_paid_count') = '0',
  'the archive view lists R2 (with its mark) and R10, has no totals and withdrawn = {0, []}');
SELECT pg_temp.swt_assert((:'swt_a_live5'::JSONB ->> 'total_count') = '7'
  AND :'swt_a_live5'::JSONB -> 'withdrawn' = '{"count":3,"paid":[{"currency":"EUR","paid_minor":"120000"},{"currency":"USD","paid_minor":"50000"}]}'::JSONB,
  'while R2 is archived the live view has 7 records and a withdrawn block without it');
SELECT pg_temp.swt_user_json(2, format('SELECT platform.manage_sales_register_v2(%L::UUID, ''restore'', %L::UUID, %s, ''{}''::JSONB, NULL, NULL, ''SWT restore R2'', %L::UUID)',
  pg_temp.swt_id(1), pg_temp.swt_id(6002), pg_temp.swt_ver(6002), pg_temp.swt_id(7802)))::TEXT AS swt_r2_restore \gset
SELECT pg_temp.swt_assert(pg_temp.swt_reg(6002) ->> 'kind' = 'partial' AND (pg_temp.swt_reg(6002) ->> 'archived') = 'false'
  AND pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7)) -> 'withdrawn' = :'swt_a_v5'::JSONB -> 'withdrawn',
  'R2 restored: marked as before, and the withdrawn block is the one of 4 records again');

-- The sale slices: a refused record is not in the slice that explains «Продажи».
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7, 'p_sale_slice => ''undated'''))::TEXT AS swt_sl_undated0 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7, 'p_sale_slice => ''other_sale_date'''))::TEXT AS swt_sl_other0 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7, 'p_sale_slice => ''filed_elsewhere'''))::TEXT AS swt_sl_else0 \gset
SELECT pg_temp.swt_assert((SELECT array_agg(r ->> 'id') FROM jsonb_array_elements(:'swt_sl_undated0'::JSONB -> 'rows') r) = ARRAY[pg_temp.swt_id(6004)::TEXT]
  AND (SELECT array_agg(r ->> 'id') FROM jsonb_array_elements(:'swt_sl_other0'::JSONB -> 'rows') r) = ARRAY[pg_temp.swt_id(6005)::TEXT]
  AND (SELECT array_agg(r ->> 'id') FROM jsonb_array_elements(:'swt_sl_else0'::JSONB -> 'rows') r) = ARRAY[pg_temp.swt_id(6006)::TEXT]
  AND (:'swt_sl_undated0'::JSONB ->> 'total_count') = '1' AND (:'swt_sl_other0'::JSONB ->> 'total_count') = '1' AND (:'swt_sl_else0'::JSONB ->> 'total_count') = '1',
  'unmarked: the three slices hold R4 (undated), R5 (another sale date) and R6 (filed in June)');
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6004), 1, 'partial', NULL, pg_temp.swt_id(7901)))::TEXT AS swt_r4_mark \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6005), 1, 'unpaid', NULL, pg_temp.swt_id(7902)))::TEXT AS swt_r5_mark \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6006), 1, 'partial', NULL, pg_temp.swt_id(7903)))::TEXT AS swt_r6_mark \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7, 'p_sale_slice => ''undated'''))::TEXT AS swt_sl_undated1 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7, 'p_sale_slice => ''other_sale_date'''))::TEXT AS swt_sl_other1 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7, 'p_sale_slice => ''filed_elsewhere'''))::TEXT AS swt_sl_else1 \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(4, 7, 'p_sale_slice => ''undated'''))::TEXT AS swt_sl_undated_v4 \gset
SELECT pg_temp.swt_assert(r.slice ->> 'total_count' = '0' AND r.slice -> 'rows' = '[]'::JSONB AND r.slice -> 'totals' = '[]'::JSONB
  AND r.slice -> 'withdrawn' = '{"count":0,"paid":[]}'::JSONB,
  r.what || ' no longer holds the refused record (and has no refusal block)')
FROM (VALUES ('the undated slice', :'swt_sl_undated1'::JSONB), ('the other-sale-date slice', :'swt_sl_other1'::JSONB),
  ('the filed-elsewhere slice', :'swt_sl_else1'::JSONB)) AS r(what, slice);
SELECT pg_temp.swt_assert((:'swt_sl_undated_v4'::JSONB ->> 'total_count') = '1'
  AND (SELECT array_agg(r ->> 'id') FROM jsonb_array_elements(:'swt_sl_undated_v4'::JSONB -> 'rows') r) = ARRAY[pg_temp.swt_id(6004)::TEXT],
  'v4 still holds the refused R4 in its undated slice');
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7))::TEXT AS swt_a_v5_late \gset
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 6))::TEXT AS swt_a_v5_june \gset
SELECT pg_temp.swt_assert(pg_temp.swt_row(:'swt_a_v5_late'::JSONB, pg_temp.swt_id(6004)) -> 'withdrawal' ->> 'kind' = 'partial'
  AND pg_temp.swt_row(:'swt_a_v5_late'::JSONB, pg_temp.swt_id(6005)) -> 'withdrawal' ->> 'kind' = 'unpaid'
  AND pg_temp.swt_row(:'swt_a_v5_june'::JSONB, pg_temp.swt_id(6006)) -> 'withdrawal' ->> 'kind' = 'partial'
  AND (:'swt_a_v5_late'::JSONB ->> 'total_count') = '8' AND (:'swt_a_v5_june'::JSONB ->> 'total_count') = '1'
  AND :'swt_a_v5_late'::JSONB -> 'withdrawn' ->> 'count' = '6'
  AND :'swt_a_v5_late'::JSONB -> 'totals' = '[{"currency":"USD","cost_minor":"125000","paid_minor":"105000"}]'::JSONB
  AND :'swt_a_v5_june'::JSONB -> 'totals' = '[]'::JSONB,
  'the same records unsliced: R4 and R5 are listed with their marks (July, 6 refused, totals R1 + R12 only), R6 in June');

-- ---------------------------------------------------------------------------
-- 4. «Продажи»: staff_sales_count_v1 and its slices drop a refused record and take it back after «Вернуть».
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.swt_count(p_n INTEGER, p_from DATE, p_to DATE) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.swt_user_json(p_n, format('SELECT platform.staff_sales_count_v1(%L::UUID, %L::DATE, %L::DATE)',
    pg_temp.swt_id(1), p_from, p_to))
$$;
CREATE FUNCTION pg_temp.swt_unmark(p_n INTEGER, p_request INTEGER, p_actor INTEGER DEFAULT 2) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.swt_user_json(p_actor, pg_temp.swt_set(pg_temp.swt_id(p_n), pg_temp.swt_ver(p_n), NULL, NULL, pg_temp.swt_id(p_request)))
$$;
-- With R2, R3, R4, R5, R6, R9, R11 refused (and R7, R8 of the other scopes) only R1 and R12 are sales of July.
SELECT pg_temp.swt_assert(pg_temp.swt_count(2, DATE '2026-07-01', DATE '2026-07-31')
    = jsonb_build_object('organization_id', pg_temp.swt_id(1), 'from', '2026-07-01', 'to', '2026-07-31', 'sales', '2', 'undated', '0',
      'other_sale_date', '0', 'filed_elsewhere', '0')
  AND pg_temp.swt_count(1, DATE '2026-07-01', DATE '2026-07-31')
    = jsonb_build_object('organization_id', pg_temp.swt_id(1), 'from', '2026-07-01', 'to', '2026-07-31', 'sales', '2', 'undated', '0',
      'other_sale_date', '0', 'filed_elsewhere', '0'),
  'refused records are not «Продажи»: 2 for Sales Manager A and for the Admin (7 and 9 before), and none of the three slices');
-- «Вернуть» one by one: each takes its record back into its count.
SELECT pg_temp.swt_unmark(6004, 8001)::TEXT AS swt_u4 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_count(2, DATE '2026-07-01', DATE '2026-07-31') ->> 'undated' = '1'
  AND pg_temp.swt_count(2, DATE '2026-07-01', DATE '2026-07-31') ->> 'sales' = '2'
  AND pg_temp.swt_reg(6004) ->> 'kind' IS NULL,
  '«Вернуть» R4: the undated count is 1 again (it has no sale date, so «Продажи» does not move)');
SELECT pg_temp.swt_unmark(6005, 8002)::TEXT AS swt_u5 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_count(2, DATE '2026-07-01', DATE '2026-07-31') ->> 'other_sale_date' = '1',
  '«Вернуть» R5: the other-sale-date count is 1 again');
SELECT pg_temp.swt_unmark(6006, 8003)::TEXT AS swt_u6 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_count(2, DATE '2026-07-01', DATE '2026-07-31') ->> 'filed_elsewhere' = '1'
  AND pg_temp.swt_count(2, DATE '2026-07-01', DATE '2026-07-31') ->> 'sales' = '3',
  '«Вернуть» R6: filed-elsewhere is 1 again and it is a sale of July again (3)');
SELECT pg_temp.swt_unmark(6002, 8004)::TEXT AS swt_u2 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_count(2, DATE '2026-07-01', DATE '2026-07-31') ->> 'sales' = '4',
  '«Вернуть» R2: 4 sales');
SELECT pg_temp.swt_unmark(6003, 8005)::TEXT AS swt_u3 \gset
SELECT pg_temp.swt_unmark(6009, 8006)::TEXT AS swt_u9 \gset
SELECT pg_temp.swt_unmark(6011, 8007)::TEXT AS swt_u11 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_count(2, DATE '2026-07-01', DATE '2026-07-31') = :'swt_a_count_before'::JSONB,
  'every record of Sales Manager A given back: the count is the baseline again (7 sales, 1 / 1 / 1)');
SELECT pg_temp.swt_assert(pg_temp.swt_count(1, DATE '2026-07-01', DATE '2026-07-31') ->> 'sales' = '7',
  'the Admin''s count is 7 while R7 (department B) and R8 (own scope) are still refused');
SELECT pg_temp.swt_unmark(6007, 8008, 3)::TEXT AS swt_u7 \gset
SELECT pg_temp.swt_unmark(6008, 8009, 4)::TEXT AS swt_u8 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_count(1, DATE '2026-07-01', DATE '2026-07-31') = :'swt_admin_count_before'::JSONB,
  'every record given back: the Admin''s count is the baseline again (9)');
SELECT pg_temp.swt_assert(NOT EXISTS (SELECT 1 FROM platform_private.sales_register r WHERE r.organization_id = pg_temp.swt_id(1)
      AND (r.withdrawal_kind IS NOT NULL OR r.withdrawn_at IS NOT NULL OR r.withdrawn_by_membership_id IS NOT NULL OR r.withdrawal_note IS NOT NULL)),
  'no record of the organization carries a mark any more');
-- Back to the unmarked data, v5 agrees: the totals of the baseline and an empty withdrawn block.
SELECT pg_temp.swt_user_json(2, pg_temp.swt_read(5, 7))::TEXT AS swt_a_v5_back \gset
SELECT pg_temp.swt_assert(:'swt_a_v5_back'::JSONB -> 'totals' = :'swt_a_v5_before'::JSONB -> 'totals'
  AND :'swt_a_v5_back'::JSONB -> 'withdrawn' = '{"count":0,"paid":[]}'::JSONB
  AND (:'swt_a_v5_back'::JSONB ->> 'unresolved_cost_count') = '1' AND (:'swt_a_v5_back'::JSONB ->> 'unresolved_paid_count') = '1'
  AND (SELECT bool_and(r -> 'withdrawal' = 'null'::JSONB) FROM jsonb_array_elements(:'swt_a_v5_back'::JSONB -> 'rows') r),
  'after «Вернуть» v5 shows the baseline totals, the unresolved records again and `withdrawal: null` on every row');

-- ---------------------------------------------------------------------------
-- 4b. Marketing: the reconciliation with «Продажи» holds when a sale is refused, and the cohort drops the contract.
--   Leads L1 (website), L2 (website), L3 (office), created in August 2026; the August sales:
--   M1 the pipeline record of L1 (sale 10.08, 2000 USD); M2 an import record only LINKED to L2 (12.08, 1500 EUR);
--   M3 a manual record without a lead (14.08, 1000 USD).
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone)
SELECT pg_temp.swt_id(800 + k), pg_temp.swt_id(1), 'SWT Marketing Client ' || k,
  platform_private.normalize_person_name('SWT Marketing Client ' || k), '+99670000' || lpad(k::TEXT, 4, '0'),
  platform_private.normalize_person_phone('+99670000' || lpad(k::TEXT, 4, '0'))
FROM generate_series(1, 3) AS k;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state,
  created_at, updated_at)
SELECT pg_temp.swt_id(800 + f.k), pg_temp.swt_id(1), pg_temp.swt_id(800 + f.k), pg_temp.swt_id(302), 'new', f.source,
  'open'::platform.lead_lifecycle_state, f.created::TIMESTAMPTZ, f.created::TIMESTAMPTZ
FROM (VALUES (1, 'website', '2026-08-03 10:00+06'), (2, 'website', '2026-08-04 10:00+06'), (3, 'office', '2026-08-05 10:00+06'))
  AS f(k, source, created);
INSERT INTO platform.lead_admissions_gates(organization_id, lead_id, gate_state)
  SELECT pg_temp.swt_id(1), pg_temp.swt_id(800 + k), 'blocked' FROM generate_series(1, 3) AS k;
SET LOCAL session_replication_role = origin;
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, lead_id, client_id,
  fields, source_snapshot)
  VALUES (pg_temp.swt_id(6101), pg_temp.swt_id(1), DATE '2026-08-01', pg_temp.swt_id(302), 'pipeline', pg_temp.swt_id(801), pg_temp.swt_id(801),
    pg_temp.swt_fields('SWT M1', DATE '2026-08-10', 200000, 'USD', NULL, NULL), '{"handoff":"synthetic"}'::JSONB);
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields,
  source_key, source_sha256, source_sheet, source_row, source_snapshot, source_fingerprint, linked_lead_id)
  VALUES (pg_temp.swt_id(6102), pg_temp.swt_id(1), DATE '2026-08-01', pg_temp.swt_id(302), 'import',
    pg_temp.swt_fields('SWT M2', DATE '2026-08-12', 150000, 'EUR', NULL, NULL), 'swt:sheet:62', repeat('ab', 32), 'SWT synthetic sheet', 62,
    '{"review_flags":[]}'::JSONB, 'swt-fingerprint-62', pg_temp.swt_id(802));
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields)
  VALUES (pg_temp.swt_id(6103), pg_temp.swt_id(1), DATE '2026-08-01', pg_temp.swt_id(302), 'manual',
    pg_temp.swt_fields('SWT M3', DATE '2026-08-14', 100000, 'USD', NULL, NULL));
CREATE FUNCTION pg_temp.swt_overview() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.swt_user_json(1, 'SELECT platform.marketing_overview_v1(DATE ''2026-08-01'', DATE ''2026-08-31'')')
$$;
SELECT pg_temp.swt_overview()::TEXT AS swt_mk0 \gset
SELECT pg_temp.swt_assert((:'swt_mk0'::JSONB #>> '{sales,total}') = '3'
  AND :'swt_mk0'::JSONB #> '{sales,reconciliation}' = '{"matches":true,"difference":0,"report_sales":3,"by_channel_plus_without_lead":3}'::JSONB
  AND (:'swt_mk0'::JSONB #>> '{cohort,total}') = '3'
  AND (:'swt_mk0'::JSONB #>> '{cohort,totals,contract}') = '2' AND (:'swt_mk0'::JSONB #>> '{cohort,totals,contract_linked}') = '1'
  AND pg_temp.swt_count(1, DATE '2026-08-01', DATE '2026-08-31') ->> 'sales' = '3',
  'baseline of August: 3 sales, the reconciliation matches, 2 cohort contracts (1 only linked): ' || (:'swt_mk0'::JSONB #> '{sales,reconciliation}')::TEXT);
-- The funnel's number «Продажи» (247 d): pipeline records of the working leads, here L1's only.
CREATE FUNCTION pg_temp.swt_funnel_sales() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.swt_user_json(1, format('SELECT platform.current_sales_funnel(%L::UUID)', pg_temp.swt_id(1))) #>> '{sales,count}'
$$;
SELECT pg_temp.swt_funnel_sales() AS swt_fn0 \gset
SELECT pg_temp.swt_assert(:'swt_fn0' = '1', 'baseline of the funnel: one pipeline sale of a working lead: ' || :'swt_fn0');
-- The funnel's number «Продажи» (current_sales_funnel) counts the pipeline records of the funnel's leads: L1's.
CREATE FUNCTION pg_temp.swt_funnel() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.swt_user_json(2, format('SELECT platform.current_sales_funnel(%L::UUID)', pg_temp.swt_id(1))) -> 'sales'
$$;
SELECT pg_temp.swt_assert(pg_temp.swt_funnel() = '{"count":"1","status":"available"}'::JSONB,
  'funnel baseline: one pipeline sale (the record of L1): ' || pg_temp.swt_funnel()::TEXT);
-- Sales Manager A refuses the pipeline record of L1: one sale less on both sides, the contract of L1 leaves the cohort.
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6101), 1, 'partial', NULL, pg_temp.swt_id(8101)))::TEXT AS swt_mk_r1 \gset
SELECT pg_temp.swt_overview()::TEXT AS swt_mk1 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_funnel() = '{"count":"0","status":"available"}'::JSONB,
  'the funnel''s «Продажи» does not count the refused pipeline record of L1: ' || pg_temp.swt_funnel()::TEXT);
SELECT pg_temp.swt_assert((:'swt_mk1'::JSONB #>> '{sales,total}') = '2'
  AND :'swt_mk1'::JSONB #> '{sales,reconciliation}' = '{"matches":true,"difference":0,"report_sales":2,"by_channel_plus_without_lead":2}'::JSONB
  AND (:'swt_mk1'::JSONB #>> '{cohort,totals,contract}') = '1' AND (:'swt_mk1'::JSONB #>> '{cohort,totals,contract_linked}') = '1'
  AND (:'swt_mk1'::JSONB #>> '{cohort,total}') = '3'
  AND NOT EXISTS (SELECT 1 FROM platform_private.marketing_cohort(pg_temp.swt_id(1), DATE '2026-08-01', DATE '2026-08-31') c
    WHERE c.lead_id = pg_temp.swt_id(801) AND c.contract_signed_on IS NOT NULL)
  AND EXISTS (SELECT 1 FROM platform_private.marketing_cohort(pg_temp.swt_id(1), DATE '2026-08-01', DATE '2026-08-31') c
    WHERE c.lead_id = pg_temp.swt_id(802) AND c.contract_signed_on = DATE '2026-08-12' AND c.contract_linked),
  'L1''s pipeline record refused: 2 sales on both sides of the reconciliation, the cohort keeps 1 contract (L2''s, linked), L1 has none');
SELECT pg_temp.swt_funnel_sales() AS swt_fn1 \gset
SELECT pg_temp.swt_assert(:'swt_fn1' = '0', 'the refused pipeline record is no sale in the funnel either: ' || :'swt_fn1');
-- And the linked import record of L2.
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6102), 1, 'unpaid', NULL, pg_temp.swt_id(8102)))::TEXT AS swt_mk_r2 \gset
SELECT pg_temp.swt_overview()::TEXT AS swt_mk2 \gset
SELECT pg_temp.swt_assert((:'swt_mk2'::JSONB #>> '{sales,total}') = '1'
  AND :'swt_mk2'::JSONB #> '{sales,reconciliation}' = '{"matches":true,"difference":0,"report_sales":1,"by_channel_plus_without_lead":1}'::JSONB
  AND (:'swt_mk2'::JSONB #>> '{cohort,totals,contract}') = '0' AND (:'swt_mk2'::JSONB #>> '{cohort,totals,contract_linked}') = '0'
  AND NOT EXISTS (SELECT 1 FROM platform_private.marketing_cohort(pg_temp.swt_id(1), DATE '2026-08-01', DATE '2026-08-31') c
    WHERE c.contract_signed_on IS NOT NULL),
  'L2''s linked record refused too: 1 sale left (the lead-less manual one), no cohort contract at all, still reconciled');
SELECT pg_temp.swt_user_json(2, pg_temp.swt_set(pg_temp.swt_id(6103), 1, 'partial', NULL, pg_temp.swt_id(8103)))::TEXT AS swt_mk_r3 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_overview() #> '{sales,reconciliation}' = '{"matches":true,"difference":0,"report_sales":0,"by_channel_plus_without_lead":0}'::JSONB
  AND (pg_temp.swt_overview() #>> '{sales,total}') = '0',
  'all three refused: no sale in the period and the reconciliation still matches (0 = 0)');
SELECT pg_temp.swt_unmark(6101, 8111)::TEXT AS swt_mk_u1 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_funnel_sales() = '1', '«Вернуть» puts the pipeline sale back into the funnel');
SELECT pg_temp.swt_unmark(6102, 8112)::TEXT AS swt_mk_u2 \gset
SELECT pg_temp.swt_unmark(6103, 8113)::TEXT AS swt_mk_u3 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_overview() -> 'sales' = :'swt_mk0'::JSONB -> 'sales'
  AND pg_temp.swt_overview() #> '{cohort,totals}' = :'swt_mk0'::JSONB #> '{cohort,totals}'
  AND pg_temp.swt_overview() #> '{cohort,channels}' = :'swt_mk0'::JSONB #> '{cohort,channels}',
  '«Вернуть» on the three: the marketing answer (sales, cohort totals and channels) is the baseline again');
SELECT pg_temp.swt_assert(pg_temp.swt_funnel() = '{"count":"1","status":"available"}'::JSONB,
  '«Вернуть» on the record of L1: the funnel counts it again');
-- The marketing answer is the Admin's; a Sales Manager still cannot read it.
SELECT pg_temp.swt_assert(pg_temp.swt_user(2, 'SELECT platform.marketing_overview_v1(DATE ''2026-08-01'', DATE ''2026-08-31'')') = '42501:marketing_forbidden',
  'marketing_overview_v1 is still the Admin''s alone');

-- ---------------------------------------------------------------------------
-- 5. The service calls (a) mark_sales_report_row_withdrawn_v1 and (b) archive_sales_report_row_v1.
-- ---------------------------------------------------------------------------
SELECT pg_temp.swt_count(1, DATE '2026-09-01', DATE '2026-09-30')::TEXT AS swt_sept0 \gset
SELECT pg_temp.swt_assert(:'swt_sept0'::JSONB ->> 'sales' = '5' AND :'swt_sept0'::JSONB ->> 'undated' = '0',
  'baseline of September: S1, S2, S4, S5, S6 are sales (S3 is archived)');
SELECT pg_temp.swt_state() AS swt_state_g0 \gset

-- 5.1 The boundary: no user identity reaches it, and only the Admin of the organization may be the actor.
SELECT pg_temp.swt_assert(pg_temp.swt_user(1, pg_temp.swt_mark('g1', 'swt:sheet:21', 'partial')) = '42501:permission denied for function mark_sales_report_row_withdrawn_v1'
  AND pg_temp.swt_user(1, pg_temp.swt_archive('g2', 'swt:sheet:21')) = '42501:permission denied for function archive_sales_report_row_v1'
  AND pg_temp.swt_user(2, pg_temp.swt_mark('g3', 'swt:sheet:21', 'partial')) = '42501:permission denied for function mark_sales_report_row_withdrawn_v1'
  AND pg_temp.swt_anon(pg_temp.swt_mark('g4', 'swt:sheet:21', 'partial')) LIKE '42501:permission denied%'
  AND pg_temp.swt_anon(pg_temp.swt_archive('g5', 'swt:sheet:21')) LIKE '42501:permission denied%',
  'authenticated, even the Admin, and anon cannot execute the service calls');
SELECT pg_temp.swt_assert(r.answer = '42501:sales_withdrawal_service_forbidden', r.what || ' is refused: ' || r.answer)
FROM (VALUES
  ('the service role carrying a user JWT (a sub), mark', pg_temp.swt_as('{"role":"service_role","sub":"' || pg_temp.swt_id(101) || '"}', 'service_role', pg_temp.swt_mark('g10', 'swt:sheet:21', 'partial'))),
  ('the service role carrying a user JWT (a sub), archive', pg_temp.swt_as('{"role":"service_role","sub":"' || pg_temp.swt_id(101) || '"}', 'service_role', pg_temp.swt_archive('g11', 'swt:sheet:21'))),
  ('an authenticated role claim without a sub', pg_temp.swt_as('{"role":"authenticated"}', 'service_role', pg_temp.swt_mark('g12', 'swt:sheet:21', 'partial'))),
  ('an anon role claim without a sub', pg_temp.swt_as('{"role":"anon"}', 'service_role', pg_temp.swt_archive('g13', 'swt:sheet:21'))),
  ('a Sales Manager as the actor', pg_temp.swt_svc(pg_temp.swt_mark('g14', 'swt:sheet:21', 'partial', NULL, 302))),
  ('the coarse Sales member as the actor', pg_temp.swt_svc(pg_temp.swt_mark('g15', 'swt:sheet:21', 'partial', NULL, 307))),
  ('invited staff without roles as the actor', pg_temp.swt_svc(pg_temp.swt_archive('g16', 'swt:sheet:21', 309))),
  ('the register reader as the actor', pg_temp.swt_svc(pg_temp.swt_mark('g17', 'swt:sheet:21', 'partial', NULL, 306))),
  ('the curator as the actor', pg_temp.swt_svc(pg_temp.swt_archive('g18', 'swt:sheet:21', 308))),
  ('a Student as the actor', pg_temp.swt_svc(pg_temp.swt_mark('g19', 'swt:sheet:21', 'partial', NULL, 305))),
  ('an unknown membership as the actor', pg_temp.swt_svc(pg_temp.swt_archive('g20', 'swt:sheet:21', 999))),
  ('the Admin of another organization as the actor', pg_temp.swt_svc(pg_temp.swt_mark('g21', 'swt:sheet:21', 'partial', NULL, 320))),
  ('the organization''s Admin acting in the other organization', pg_temp.swt_svc(pg_temp.swt_archive('g22', 'swt:sheet:21', 301, 2))),
  ('no organization', pg_temp.swt_svc(format('SELECT platform.mark_sales_report_row_withdrawn_v1(NULL, %L::UUID, %L, %L, %L, %L, NULL, %L)',
    pg_temp.swt_id(301), 'swt-withdraw', 'g23', 'swt:sheet:21', 'partial', 'SWT'))),
  ('no actor', pg_temp.swt_svc(format('SELECT platform.archive_sales_report_row_v1(%L::UUID, NULL, %L, %L, %L, %L)',
    pg_temp.swt_id(1), 'swt-withdraw', 'g24', 'swt:sheet:21', 'SWT')))
) AS r(what, answer);
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_g0', 'every refused boundary call wrote nothing');

-- 5.2 Strict parameters: every refusal names its key; nothing is written. (The actor is the organization's Admin.)
SELECT pg_temp.swt_assert(r.answer = '22023:sales_withdrawal_invalid:' || r.key, r.what || ' names ' || r.key || ': ' || r.answer)
FROM (VALUES
  ('no import source (mark)', 'importSource', pg_temp.swt_svc(pg_temp.swt_mark('h1', 'swt:sheet:21', 'partial', NULL, 301, 1, NULL))),
  ('an import source in capitals (mark)', 'importSource', pg_temp.swt_svc(pg_temp.swt_mark('h2', 'swt:sheet:21', 'partial', NULL, 301, 1, 'Bad Source'))),
  ('an import source starting with a digit (archive)', 'importSource', pg_temp.swt_svc(pg_temp.swt_archive('h3', 'swt:sheet:21', 301, 1, '1abc'))),
  ('a one-character import source (archive)', 'importSource', pg_temp.swt_svc(pg_temp.swt_archive('h4', 'swt:sheet:21', 301, 1, 'x'))),
  ('an import source of 65 characters (mark)', 'importSource', pg_temp.swt_svc(pg_temp.swt_mark('h5', 'swt:sheet:21', 'partial', NULL, 301, 1, 'a' || repeat('b', 64)))),
  ('no external reference (mark)', 'externalRef', pg_temp.swt_svc(pg_temp.swt_mark(NULL, 'swt:sheet:21', 'partial'))),
  ('a blank external reference (mark)', 'externalRef', pg_temp.swt_svc(pg_temp.swt_mark('   ', 'swt:sheet:21', 'partial'))),
  ('an external reference of 201 characters (archive)', 'externalRef', pg_temp.swt_svc(pg_temp.swt_archive(repeat('r', 201), 'swt:sheet:21'))),
  ('an external reference with a line break (mark)', 'externalRef', pg_temp.swt_svc(pg_temp.swt_mark(E'h\n9', 'swt:sheet:21', 'partial'))),
  ('an external reference with a control character (archive)', 'externalRef', pg_temp.swt_svc(pg_temp.swt_archive('h' || chr(1), 'swt:sheet:21'))),
  ('no reason (mark)', 'reason', pg_temp.swt_svc(pg_temp.swt_mark('h11', 'swt:sheet:21', 'partial', NULL, 301, 1, 'swt-withdraw', NULL))),
  ('a blank reason (archive)', 'reason', pg_temp.swt_svc(pg_temp.swt_archive('h12', 'swt:sheet:21', 301, 1, 'swt-withdraw', ' '))),
  ('a reason of 501 characters (mark)', 'reason', pg_temp.swt_svc(pg_temp.swt_mark('h13', 'swt:sheet:21', 'partial', NULL, 301, 1, 'swt-withdraw', repeat('r', 501)))),
  ('a reason with a control character (archive)', 'reason', pg_temp.swt_svc(pg_temp.swt_archive('h14', 'swt:sheet:21', 301, 1, 'swt-withdraw', 'SWT' || chr(7)))),
  ('no source key (mark)', 'sourceKey', pg_temp.swt_svc(pg_temp.swt_mark('h15', NULL, 'partial'))),
  ('an empty source key (archive)', 'sourceKey', pg_temp.swt_svc(pg_temp.swt_archive('h16', ''))),
  ('a source key of 401 characters (mark)', 'sourceKey', pg_temp.swt_svc(pg_temp.swt_mark('h17', repeat('k', 401), 'partial'))),
  ('a source key with a control character (archive)', 'sourceKey', pg_temp.swt_svc(pg_temp.swt_archive('h18', E'swt:sheet:\n21'))),
  ('an unknown kind', 'kind', pg_temp.swt_svc(pg_temp.swt_mark('h19', 'swt:sheet:21', 'refused'))),
  ('a kind in capitals', 'kind', pg_temp.swt_svc(pg_temp.swt_mark('h20', 'swt:sheet:21', 'PARTIAL'))),
  ('a note without a kind', 'note', pg_temp.swt_svc(pg_temp.swt_mark('h21', 'swt:sheet:21', NULL, 'SWT note alone'))),
  ('a note of 501 characters', 'note', pg_temp.swt_svc(pg_temp.swt_mark('h22', 'swt:sheet:21', 'unpaid', repeat('n', 501)))),
  ('a note with a control character', 'note', pg_temp.swt_svc(pg_temp.swt_mark('h23', 'swt:sheet:21', 'unpaid', 'SWT' || chr(2) || 'note')))
) AS r(what, key, answer);
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_g0', 'the refused parameters wrote nothing (no row, receipt or journal row)');
-- A missing row is judged only after the parameters, and writes nothing either.
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_mark('h30', 'swt:sheet:999', 'partial')) = 'PT404:sales_report_row_missing'
  AND pg_temp.swt_svc(pg_temp.swt_mark('h31', 'swt:sheet:999', NULL)) = 'PT404:sales_report_row_missing'
  AND pg_temp.swt_svc(pg_temp.swt_archive('h32', 'swt:sheet:999')) = 'PT404:sales_report_row_missing'
  AND pg_temp.swt_svc(pg_temp.swt_mark('h33', 'swt:sheet:9', 'partial')) = 'PT404:sales_report_row_missing'
  AND pg_temp.swt_state() = :'swt_state_g0',
  'a source key that is not in the register is PT404 sales_report_row_missing (a manual record has no key); nothing is written, no receipt');

-- 5.3 (a) set, change, clear, unchanged on S1 (sale 11.09, 700 USD paid).
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('a1', 'swt:sheet:21', 'partial', 'SWT service note'))::TEXT AS swt_a1 \gset
SELECT pg_temp.swt_assert(:'swt_a1'::JSONB = jsonb_build_object('organization_id', pg_temp.swt_id(1), 'operation', 'withdraw', 'status', 'withdrawn',
      'register_id', pg_temp.swt_id(6021), 'register_version', '2', 'withdrawal_kind', 'partial', 'import_source', 'swt-withdraw',
      'external_ref', 'a1', 'replayed', FALSE)
  AND pg_temp.swt_keys(:'swt_a1'::JSONB) = ARRAY['external_ref', 'import_source', 'operation', 'organization_id', 'register_id',
      'register_version', 'replayed', 'status', 'withdrawal_kind'],
  'a1: withdrawn, version 2, the answer has exactly its nine keys: ' || :'swt_a1');
SELECT pg_temp.swt_assert(pg_temp.swt_reg(6021) = jsonb_build_object('kind', 'partial', 'note', 'SWT service note', 'by', pg_temp.swt_id(301),
      'at', TRUE, 'version', 2, 'archived', FALSE)
  AND pg_temp.swt_money(6021) = (SELECT money FROM swt_money_before WHERE n = 6021),
  'a1: the row carries the mark, the Admin as the marker, version 2; its money is untouched');
SELECT pg_temp.swt_assert((SELECT x.operation = 'withdraw' AND x.payload_md5 ~ '^[0-9a-f]{32}$' AND x.register_id = pg_temp.swt_id(6021)
      AND x.actor_membership_id = pg_temp.swt_id(301) AND x.result = (:'swt_a1'::JSONB - 'replayed')
      AND x.before_state = '{"version":"1","withdrawal_kind":null,"withdrawn_at":null,"withdrawal_note":null,"withdrawn_by_membership_id":null}'::JSONB
    FROM platform_private.sales_withdrawal_service_receipts x
    WHERE x.organization_id = pg_temp.swt_id(1) AND x.import_source = 'swt-withdraw' AND x.external_ref = 'a1'),
  'a1: one receipt (operation, payload md5, the record, the Admin, the answer without `replayed`, the state before)');
SELECT pg_temp.swt_assert((SELECT count(*) = 1 AND bool_and(a.action = 'sales.register.update' AND a.actor_principal = 'service:sales-withdrawal'
      AND a.actor_kind = 'user' AND a.actor_profile_id = pg_temp.swt_id(201) AND a.actor_membership_id = pg_temp.swt_id(301)
      AND a.resource_type = 'sales_register' AND a.resource_id = pg_temp.swt_id(6021) AND a.reason = 'SWT синтетический отказ'
      AND a.before_state = '{"version":"1","archived":false,"withdrawal_kind":null}'::JSONB
      AND a.after_state = '{"version":"2","archived":false,"withdrawal_kind":"partial","import_source":"swt-withdraw","external_ref":"a1"}'::JSONB)
    FROM platform.audit_events a WHERE a.request_id = pg_temp.swt_op('a1', 'row')),
  'a1: one journal row of the service principal, with the Admin as the actor, ids / versions / kind only');
-- Replay and the conflicts of the receipt key.
SELECT pg_temp.swt_state() AS swt_state_a1 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('a1', 'swt:sheet:21', 'partial', 'SWT service note'))::TEXT AS swt_a1_replay \gset
SELECT pg_temp.swt_assert(:'swt_a1_replay'::JSONB = (:'swt_a1'::JSONB || '{"replayed":true}'::JSONB) AND pg_temp.swt_state() = :'swt_state_a1',
  'a1 replay: the same answer with replayed = true, nothing written');
SELECT pg_temp.swt_assert(r.answer = 'PT409:sales_withdrawal_request_conflict', 'the key of a1 with ' || r.what || ': ' || r.answer)
FROM (VALUES
  ('another kind', pg_temp.swt_svc(pg_temp.swt_mark('a1', 'swt:sheet:21', 'unpaid', 'SWT service note'))),
  ('another note', pg_temp.swt_svc(pg_temp.swt_mark('a1', 'swt:sheet:21', 'partial', 'SWT other note'))),
  ('no note', pg_temp.swt_svc(pg_temp.swt_mark('a1', 'swt:sheet:21', 'partial'))),
  ('another source key', pg_temp.swt_svc(pg_temp.swt_mark('a1', 'swt:sheet:22', 'partial', 'SWT service note'))),
  ('another reason', pg_temp.swt_svc(pg_temp.swt_mark('a1', 'swt:sheet:21', 'partial', 'SWT service note', 301, 1, 'swt-withdraw', 'SWT другая причина'))),
  ('another actor (the second Admin)', pg_temp.swt_svc(pg_temp.swt_mark('a1', 'swt:sheet:21', 'partial', 'SWT service note', 310))),
  ('the same pair as an archive', pg_temp.swt_svc(pg_temp.swt_archive('a1', 'swt:sheet:21')))
) AS r(what, answer);
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_a1', 'the conflicts wrote nothing');
-- The same reference under another import source is another receipt key.
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('a1', 'swt:sheet:22', 'unpaid', NULL, 301, 1, 'swt-other'))::TEXT AS swt_a1_other \gset
SELECT pg_temp.swt_assert(:'swt_a1_other'::JSONB ->> 'status' = 'withdrawn' AND :'swt_a1_other'::JSONB ->> 'import_source' = 'swt-other'
  AND (SELECT count(*) = 2 FROM platform_private.sales_withdrawal_service_receipts WHERE external_ref = 'a1' AND organization_id = pg_temp.swt_id(1)),
  'the same external reference under another import source is a separate key (S2 marked unpaid)');
-- Change, identical, clear, clear again.
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('a4', 'swt:sheet:21', 'unpaid'))::TEXT AS swt_a4 \gset
SELECT pg_temp.swt_assert(:'swt_a4'::JSONB ->> 'status' = 'withdrawn' AND :'swt_a4'::JSONB ->> 'register_version' = '3'
  AND :'swt_a4'::JSONB ->> 'withdrawal_kind' = 'unpaid' AND pg_temp.swt_reg(6021) ->> 'note' IS NULL
  AND (SELECT x.before_state ->> 'withdrawal_kind' = 'partial' AND x.before_state ->> 'withdrawal_note' = 'SWT service note'
      AND x.before_state ->> 'version' = '2' AND x.before_state ->> 'withdrawn_by_membership_id' = pg_temp.swt_id(301)::TEXT
      AND x.before_state ->> 'withdrawn_at' IS NOT NULL
    FROM platform_private.sales_withdrawal_service_receipts x WHERE x.external_ref = 'a4' AND x.import_source = 'swt-withdraw'),
  'a4: the change to unpaid (version 3, the note dropped) keeps the previous mark in the receipt''s before_state');
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('a5', 'swt:sheet:21', 'unpaid'))::TEXT AS swt_a5 \gset
SELECT pg_temp.swt_assert(:'swt_a5'::JSONB ->> 'status' = 'unchanged' AND :'swt_a5'::JSONB ->> 'register_version' = '3'
  AND :'swt_a5'::JSONB ->> 'withdrawal_kind' = 'unpaid' AND pg_temp.swt_ver(6021) = 3
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.swt_op('a5', 'row'))
  AND (SELECT x.before_state = '{}'::JSONB AND x.result ->> 'status' = 'unchanged'
    FROM platform_private.sales_withdrawal_service_receipts x WHERE x.external_ref = 'a5' AND x.import_source = 'swt-withdraw'),
  'a5: the identical mark is unchanged: no version, no journal row, a receipt with an empty before_state');
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('a6', 'swt:sheet:21', NULL))::TEXT AS swt_a6 \gset
SELECT pg_temp.swt_assert(:'swt_a6'::JSONB ->> 'status' = 'cleared' AND :'swt_a6'::JSONB ->> 'register_version' = '4'
  AND :'swt_a6'::JSONB -> 'withdrawal_kind' = 'null'::JSONB
  AND pg_temp.swt_reg(6021) = jsonb_build_object('kind', NULL, 'note', NULL, 'by', NULL, 'at', FALSE, 'version', 4, 'archived', FALSE)
  AND (SELECT a.before_state = '{"version":"3","archived":false,"withdrawal_kind":"unpaid"}'::JSONB
      AND a.after_state = '{"version":"4","archived":false,"withdrawal_kind":null,"import_source":"swt-withdraw","external_ref":"a6"}'::JSONB
    FROM platform.audit_events a WHERE a.request_id = pg_temp.swt_op('a6', 'row'))
  AND (SELECT x.before_state ->> 'withdrawal_kind' = 'unpaid' FROM platform_private.sales_withdrawal_service_receipts x WHERE x.external_ref = 'a6'),
  'a6: cleared (version 4); the journal and the receipt keep what was cleared');
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('a7', 'swt:sheet:21', NULL))::TEXT AS swt_a7 \gset
SELECT pg_temp.swt_assert(:'swt_a7'::JSONB ->> 'status' = 'unchanged' AND :'swt_a7'::JSONB ->> 'register_version' = '4' AND pg_temp.swt_ver(6021) = 4
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.swt_op('a7', 'row')),
  'a7: clearing a record with no mark is unchanged, not an error');
SELECT pg_temp.swt_assert(pg_temp.swt_count(1, DATE '2026-09-01', DATE '2026-09-30') ->> 'sales' = '4',
  'S1 back to unmarked while S2 is refused: September has 4 sales (5 at the baseline)');
-- A reference is trimmed: the padded reference is the receipt key of the trimmed one.
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('  a12  ', 'swt:sheet:26', 'partial'))::TEXT AS swt_a12 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('a12', 'swt:sheet:26', 'partial'))::TEXT AS swt_a12_replay \gset
SELECT pg_temp.swt_assert(:'swt_a12'::JSONB ->> 'external_ref' = 'a12' AND (:'swt_a12_replay'::JSONB ->> 'replayed')::BOOLEAN
  AND (SELECT count(*) = 1 FROM platform_private.sales_withdrawal_service_receipts WHERE external_ref = 'a12'),
  'the external reference is trimmed: a padded and a plain reference are one receipt key (S6 marked partial)');
-- An archived row: a set is refused (PT409), «Вернуть» is a no-op; a missing mark on S3 writes only a receipt.
SELECT pg_temp.swt_state() AS swt_state_a8 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_mark('a8', 'swt:sheet:23', 'partial')) = 'PT409:sales_report_row_archived'
  AND pg_temp.swt_svc(pg_temp.swt_mark('a8', 'swt:sheet:23', 'unpaid', 'SWT note')) = 'PT409:sales_report_row_archived'
  AND pg_temp.swt_state() = :'swt_state_a8'
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_withdrawal_service_receipts WHERE external_ref = 'a8'),
  'an archived row takes no mark through the service either (PT409 sales_report_row_archived), and a refused call leaves no receipt');
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('a9', 'swt:sheet:23', NULL))::TEXT AS swt_a9 \gset
SELECT pg_temp.swt_assert(:'swt_a9'::JSONB ->> 'status' = 'unchanged' AND pg_temp.swt_ver(6023) = 1
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.swt_op('a9', 'row')),
  'clearing a mark on an archived row with no mark is unchanged');
-- Money and fields are not what the service writes.
SELECT pg_temp.swt_assert(pg_temp.swt_money(n) = m.money, 'record ' || n || ': the money is as before the service calls')
FROM swt_money_before m WHERE n IN (6021, 6022, 6024);
-- Organizations are isolated: the other organization's Admin reaches only its own row under the same key.
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('o1', 'swt:sheet:21', 'unpaid', NULL, 320, 2))::TEXT AS swt_o1 \gset
SELECT pg_temp.swt_assert(:'swt_o1'::JSONB ->> 'register_id' = pg_temp.swt_id(6031)::TEXT AND :'swt_o1'::JSONB ->> 'status' = 'withdrawn'
  AND (SELECT r.withdrawal_kind = 'unpaid' AND r.withdrawn_by_membership_id = pg_temp.swt_id(320) FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6031))
  AND pg_temp.swt_ver(6021) = 4 AND pg_temp.swt_reg(6021) ->> 'kind' IS NULL
  AND pg_temp.swt_svc(pg_temp.swt_mark('o2', 'swt:sheet:22', 'unpaid', NULL, 320, 2)) = 'PT404:sales_report_row_missing'
  AND (SELECT a.organization_id = pg_temp.swt_id(2) AND a.actor_membership_id = pg_temp.swt_id(320)
    FROM platform.audit_events a WHERE a.request_id = pg_temp.swt_op('o1', 'row', 'swt-withdraw', 2)),
  'organizations: the same source key marks the other organization''s own row, journaled for its own Admin; org 1''s row is untouched');
SELECT pg_temp.swt_svc_json(pg_temp.swt_archive('o3', 'swt:sheet:21', 320, 2))::TEXT AS swt_o3 \gset
SELECT pg_temp.swt_assert(:'swt_o3'::JSONB ->> 'status' = 'archived' AND (SELECT r.archived FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6031))
  AND NOT (SELECT r.archived FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6021)),
  'organizations: archiving by the same key archives the other organization''s row only');

-- 5.4 (b) archive_sales_report_row_v1: S5 (sale 15.09, 1000 USD).
SELECT pg_temp.swt_svc_json(pg_temp.swt_archive('b1', 'swt:sheet:25'))::TEXT AS swt_b1 \gset
SELECT pg_temp.swt_assert(:'swt_b1'::JSONB = jsonb_build_object('organization_id', pg_temp.swt_id(1), 'operation', 'archive', 'status', 'archived',
      'register_id', pg_temp.swt_id(6025), 'register_version', '2', 'import_source', 'swt-withdraw', 'external_ref', 'b1', 'replayed', FALSE)
  AND pg_temp.swt_keys(:'swt_b1'::JSONB) = ARRAY['external_ref', 'import_source', 'operation', 'organization_id', 'register_id',
      'register_version', 'replayed', 'status']
  AND (SELECT r.archived AND r.version = 2 AND r.withdrawal_kind IS NULL FROM platform_private.sales_register r WHERE r.id = pg_temp.swt_id(6025))
  AND pg_temp.swt_money(6025) = (SELECT money FROM swt_money_before WHERE n = 6025),
  'b1: archived, version 2, the answer has exactly its eight keys: ' || :'swt_b1');
SELECT pg_temp.swt_assert((SELECT count(*) = 1 AND bool_and(a.action = 'sales.register.archive' AND a.actor_principal = 'service:sales-withdrawal'
      AND a.actor_kind = 'user' AND a.actor_profile_id = pg_temp.swt_id(201) AND a.actor_membership_id = pg_temp.swt_id(301)
      AND a.resource_id = pg_temp.swt_id(6025) AND a.reason = 'SWT синтетический архив'
      AND a.before_state = '{"version":"1","archived":false,"paid_contract_set":false}'::JSONB
      AND a.after_state = '{"version":"2","archived":true,"paid_contract_set":false,"import_source":"swt-withdraw","external_ref":"b1"}'::JSONB)
    FROM platform.audit_events a WHERE a.request_id = pg_temp.swt_op('b1', 'archive'))
  AND (SELECT x.operation = 'archive' AND x.before_state = '{"archived":false,"version":"1"}'::JSONB AND x.result = (:'swt_b1'::JSONB - 'replayed')
    FROM platform_private.sales_withdrawal_service_receipts x WHERE x.external_ref = 'b1' AND x.import_source = 'swt-withdraw'),
  'b1: the journal row has the existing action sales.register.archive; the receipt is an archive receipt with the state before');
SELECT pg_temp.swt_assert(pg_temp.swt_count(1, DATE '2026-09-01', DATE '2026-09-30') ->> 'sales' = '2'
  AND (pg_temp.swt_user_json(1, pg_temp.swt_read(5, 9)) ->> 'total_count') = '4'
  AND (pg_temp.swt_user_json(1, pg_temp.swt_read(5, 9, 'p_archived => TRUE')) ->> 'total_count') = '2'
  AND (SELECT count(*) = 1 FROM platform.audit_events a WHERE a.action = 'sales.register.archive'
    AND a.request_id = pg_temp.swt_op('b1', 'archive')),
  'the archived S5 leaves «Продажи» (S1 and S4 remain, S2 and S6 being refused) and the live register (4 records), and joins the archive view (S3, S5)');
SELECT pg_temp.swt_state() AS swt_state_b1 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_archive('b1', 'swt:sheet:25'))::TEXT AS swt_b1_replay \gset
SELECT pg_temp.swt_assert(:'swt_b1_replay'::JSONB = (:'swt_b1'::JSONB || '{"replayed":true}'::JSONB) AND pg_temp.swt_state() = :'swt_state_b1',
  'b1 replay: the same answer with replayed = true, nothing written');
SELECT pg_temp.swt_assert(r.answer = 'PT409:sales_withdrawal_request_conflict', 'the key of b1 with ' || r.what || ': ' || r.answer)
FROM (VALUES
  ('another source key', pg_temp.swt_svc(pg_temp.swt_archive('b1', 'swt:sheet:24'))),
  ('another reason', pg_temp.swt_svc(pg_temp.swt_archive('b1', 'swt:sheet:25', 301, 1, 'swt-withdraw', 'SWT другая причина'))),
  ('another actor', pg_temp.swt_svc(pg_temp.swt_archive('b1', 'swt:sheet:25', 310))),
  ('the same pair as a mark', pg_temp.swt_svc(pg_temp.swt_mark('b1', 'swt:sheet:25', NULL)))
) AS r(what, answer);
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_b1', 'the archive conflicts wrote nothing');
SELECT pg_temp.swt_svc_json(pg_temp.swt_archive('b2', 'swt:sheet:25'))::TEXT AS swt_b2 \gset
SELECT pg_temp.swt_assert(:'swt_b2'::JSONB ->> 'status' = 'unchanged' AND :'swt_b2'::JSONB ->> 'register_version' = '2' AND pg_temp.swt_ver(6025) = 2
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.swt_op('b2', 'archive'))
  AND (SELECT x.before_state = '{}'::JSONB FROM platform_private.sales_withdrawal_service_receipts x WHERE x.external_ref = 'b2' AND x.import_source = 'swt-withdraw'),
  'b2: the same row under a new reference is unchanged: no version bump, no journal row');
-- A marked row is archived with its mark; the service can still take the mark off the archived row.
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('b3', 'swt:sheet:24', 'unpaid', 'SWT before archive'))::TEXT AS swt_b3 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_archive('b4', 'swt:sheet:24'))::TEXT AS swt_b4 \gset
SELECT pg_temp.swt_assert(:'swt_b4'::JSONB ->> 'register_version' = '3' AND pg_temp.swt_reg(6024) ->> 'kind' = 'unpaid'
  AND (pg_temp.swt_reg(6024) ->> 'archived') = 'true'
  AND pg_temp.swt_svc(pg_temp.swt_mark('b5', 'swt:sheet:24', 'partial')) = 'PT409:sales_report_row_archived',
  'S4 marked and then archived: the mark stays on the archived row, which takes no new mark');
SELECT pg_temp.swt_svc_json(pg_temp.swt_mark('b6', 'swt:sheet:24', NULL))::TEXT AS swt_b6 \gset
SELECT pg_temp.swt_assert(:'swt_b6'::JSONB ->> 'status' = 'cleared' AND :'swt_b6'::JSONB ->> 'register_version' = '4'
  AND pg_temp.swt_reg(6024) = jsonb_build_object('kind', NULL, 'note', NULL, 'by', NULL, 'at', FALSE, 'version', 4, 'archived', TRUE)
  AND (SELECT a.after_state ->> 'archived' = 'true' FROM platform.audit_events a WHERE a.request_id = pg_temp.swt_op('b6', 'row')),
  'the service can take the mark off an archived row (cleared, version 4, still archived)');
-- What the service did reads the same as what the interface does: S1 is the one sale left, S2 and S6 are refused.
SELECT pg_temp.swt_assert(pg_temp.swt_count(1, DATE '2026-09-01', DATE '2026-09-30') ->> 'sales' = '1'
  AND pg_temp.swt_user_json(1, pg_temp.swt_read(5, 9)) -> 'withdrawn' = '{"count":2,"paid":[{"currency":"USD","paid_minor":"200000"}]}'::JSONB
  AND (SELECT r -> 'withdrawal' ->> 'by' FROM jsonb_array_elements(pg_temp.swt_user_json(1, pg_temp.swt_read(5, 9)) -> 'rows') r
    WHERE (r ->> 'id')::UUID = pg_temp.swt_id(6022)) = 'SWT Actor 1',
  'September: one sale left; v5 shows the two refusals made by the service with the Admin as the marker (SWT Actor 1)');

-- ---------------------------------------------------------------------------
-- 6. create_sales_report_student_case_v1: a case on a lead the report already sold.
-- ---------------------------------------------------------------------------
-- The fixtures are made by 304's own import (create_lead): a client and a converted, ownerless sales_report lead each.
CREATE FUNCTION pg_temp.swt_imp_row(p_key TEXT, p_name TEXT, p_phone TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('mode', 'insert', 'source_key', p_key, 'source_sheet', 'SWT Case Sheet', 'source_row', 7,
    'source_sha256', repeat('c', 64), 'report_month', '2026-09-01',
    'source_snapshot', jsonb_build_object('applicant_name', p_name, 'phone', p_phone, 'status_raw', 'Оплачено',
      'review_flags', '[]'::JSONB, 'signing_date_raw', '2026-09-15', 'signing_date_type', 'date',
      'service_cost_raw', '1000 $', 'paid_raw', '1000 $', 'status_column_present', TRUE, 'source_period_year_inferred', FALSE),
    'fields', jsonb_build_object('signing_date', '2026-09-15', 'applicant_name', p_name, 'phone', p_phone,
      'country', 'Китай', 'university', 'SWT University', 'program', 'SWT Program', 'direction', 'CN',
      'intake', '2027', 'contract_number', 'SWT-C', 'manager_label', 'SWT Manager', 'status_raw', 'Оплачено',
      'service_cost_raw', '1000 $', 'service_cost_minor', 100000, 'service_cost_currency', 'USD',
      'paid_raw', '1000 $', 'paid_minor', 100000, 'paid_currency', 'USD', 'needs_review', FALSE, 'notes', NULL))
$$;
CREATE FUNCTION pg_temp.swt_import(p_ref TEXT, p_name TEXT, p_phone TEXT, p_email TEXT DEFAULT NULL) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.import_sales_report_row_v1(%L::UUID, %L::UUID, ''swt-import'', %L, %L::JSONB, ''SWT перенос'')',
    pg_temp.swt_id(1), pg_temp.swt_id(301), p_ref,
    jsonb_build_object('row', pg_temp.swt_imp_row('swt:case:' || p_ref, p_name, p_phone),
      'person', jsonb_build_object('mode', 'create_lead',
        'client', jsonb_strip_nulls(jsonb_build_object('name', p_name, 'phone', p_phone, 'email', p_email)),
        'interest_direction', 'CN'))::TEXT)
$$;
SELECT pg_temp.swt_svc_json(pg_temp.swt_import('c1', 'SWT Case One', '+996 700 000 101', 'swt-case-one@example.invalid'))::TEXT AS swt_imp1 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_import('c2', 'SWT Case Two', '+996 700 000 102'))::TEXT AS swt_imp2 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_import('c3', 'SWT Case Three', '+996 700 000 103', 'swt-case-three@example.invalid'))::TEXT AS swt_imp3 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_import('c4', 'SWT Case Four', '+996 700 000 104'))::TEXT AS swt_imp4 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_import('c5', 'SWT Case Five', '+996 700 000 105', 'swt-case-five@example.invalid'))::TEXT AS swt_imp5 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_import('c6', 'SWT Case Six', '+996 700 000 106', 'swt-case-six@example.invalid'))::TEXT AS swt_imp6 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_import('c9', 'SWT Case Nine', '+996 700 000 109'))::TEXT AS swt_imp9 \gset
SELECT :'swt_imp1'::JSONB ->> 'lead_id' AS swt_lead1, :'swt_imp1'::JSONB ->> 'client_id' AS swt_client1 \gset
SELECT :'swt_imp2'::JSONB ->> 'lead_id' AS swt_lead2, :'swt_imp2'::JSONB ->> 'client_id' AS swt_client2 \gset
SELECT :'swt_imp3'::JSONB ->> 'lead_id' AS swt_lead3, :'swt_imp3'::JSONB ->> 'client_id' AS swt_client3 \gset
SELECT :'swt_imp4'::JSONB ->> 'lead_id' AS swt_lead4, :'swt_imp4'::JSONB ->> 'client_id' AS swt_client4 \gset
SELECT :'swt_imp5'::JSONB ->> 'lead_id' AS swt_lead5, :'swt_imp5'::JSONB ->> 'client_id' AS swt_client5 \gset
SELECT :'swt_imp6'::JSONB ->> 'lead_id' AS swt_lead6 \gset
SELECT :'swt_imp9'::JSONB ->> 'lead_id' AS swt_lead9, :'swt_imp9'::JSONB ->> 'client_id' AS swt_client9 \gset
SELECT pg_temp.swt_assert((SELECT count(*) = 7 AND bool_and(l.source_key = 'sales_report' AND l.lifecycle_state = 'converted'
        AND l.current_owner_membership_id IS NULL)
      FROM platform.leads l WHERE l.id IN (:'swt_lead1'::UUID, :'swt_lead2'::UUID, :'swt_lead3'::UUID, :'swt_lead4'::UUID,
        :'swt_lead5'::UUID, :'swt_lead6'::UUID, :'swt_lead9'::UUID))
  AND NOT EXISTS (SELECT 1 FROM platform.student_cases WHERE organization_id = pg_temp.swt_id(1)),
  'fixture: seven report leads made by 304''s import (converted, ownerless, source sales_report), and no case exists yet');
-- Two report leads that are no longer what the call serves: lead 7 has left the report (source office, still
-- converted, its client active); lead 8 keeps its source and state but its client is no longer active.
SELECT pg_temp.swt_svc_json(pg_temp.swt_import('c7', 'SWT Case Seven', '+996 700 000 107'))::TEXT AS swt_imp7 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_import('c8', 'SWT Case Eight', '+996 700 000 108'))::TEXT AS swt_imp8 \gset
SELECT :'swt_imp7'::JSONB ->> 'lead_id' AS swt_lead7, :'swt_imp7'::JSONB ->> 'client_id' AS swt_client7 \gset
SELECT :'swt_imp8'::JSONB ->> 'lead_id' AS swt_lead8, :'swt_imp8'::JSONB ->> 'client_id' AS swt_client8 \gset
SET LOCAL session_replication_role = replica;
UPDATE platform.leads SET source_key = 'office' WHERE id = :'swt_lead7'::UUID;
UPDATE platform.clients SET lifecycle_state = 'inactive' WHERE id = :'swt_client8'::UUID;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.swt_assert((SELECT l.source_key = 'office' AND l.lifecycle_state = 'converted' AND c.lifecycle_state = 'active'
    FROM platform.leads l JOIN platform.clients c ON c.id = l.client_id WHERE l.id = :'swt_lead7'::UUID)
  AND (SELECT l.source_key = 'sales_report' AND l.lifecycle_state = 'converted' AND c.lifecycle_state = 'inactive'
    FROM platform.leads l JOIN platform.clients c ON c.id = l.client_id WHERE l.id = :'swt_lead8'::UUID),
  'fixture: lead 7 is converted with an active client but its source is not sales_report; lead 8 is a converted report lead of an inactive client');
-- Other leads: an ordinary office lead, a report lead that is still open, a lead of the other organization,
-- a second report lead on the client of lead 3, a client with a direct-import (281) case.
SELECT platform_private.create_or_link_client(pg_temp.swt_id(1), 'SWT Office Person', NULL, '+996 700 000 120',
  'swt-fixture', 'client', 'office-client', 'staff_recorded', statement_timestamp()) AS swt_office_client \gset
SELECT platform_private.create_or_link_lead(pg_temp.swt_id(1), :'swt_office_client'::UUID, NULL, 'new', 'office',
  'swt-fixture', 'lead', 'office-lead', 'staff_recorded', statement_timestamp()) AS swt_office_lead \gset
SELECT platform_private.create_or_link_client(pg_temp.swt_id(1), 'SWT Open Report Person', NULL, '+996 700 000 121',
  'swt-fixture', 'client', 'open-client', 'staff_recorded', statement_timestamp()) AS swt_open_client \gset
SELECT platform_private.create_or_link_lead(pg_temp.swt_id(1), :'swt_open_client'::UUID, NULL, 'new', 'sales_report',
  'swt-fixture', 'lead', 'open-lead', 'staff_recorded', statement_timestamp()) AS swt_open_lead \gset
SELECT platform_private.create_or_link_client(pg_temp.swt_id(2), 'SWT Foreign Person', NULL, '+996 700 000 122',
  'swt-fixture', 'client', 'foreign-client', 'staff_recorded', statement_timestamp()) AS swt_foreign_client \gset
SELECT platform_private.create_or_link_lead(pg_temp.swt_id(2), :'swt_foreign_client'::UUID, NULL, 'new', 'sales_report',
  'swt-fixture', 'lead', 'foreign-lead', 'staff_recorded', statement_timestamp()) AS swt_foreign_lead \gset
SET LOCAL session_replication_role = replica;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state)
  VALUES (pg_temp.swt_id(8201), pg_temp.swt_id(1), :'swt_client3'::UUID, NULL, 'new', 'sales_report', 'converted');
SET LOCAL session_replication_role = origin;
SELECT pg_temp.swt_assert((SELECT count(*) = 2 FROM platform.leads WHERE client_id = :'swt_client3'::UUID)
  AND (SELECT count(*) = 1 FROM platform.leads WHERE client_id = :'swt_client2'::UUID),
  'fixture: the client of lead 3 has a second report lead (8201); the client of lead 2 has only its own');
-- Lead 4 already has its sale conditions.
INSERT INTO platform_private.lead_sale_conditions(lead_id, organization_id, fields, revision, updated_by_membership_id)
  VALUES (:'swt_lead4'::UUID, pg_temp.swt_id(1), platform_private.lead_sale_condition_fields(jsonb_build_object(
    'service_cost_minor', '90000', 'service_cost_currency', 'USD', 'signing_date', '2026-09-02')), 1, pg_temp.swt_id(301));
-- Client 5 has an open direct-import (281) case: the same person, found by the case's client.
SELECT pg_temp.swt_svc_json(format('SELECT platform.import_admissions_student_case_v1(%L::UUID, %L::UUID, ''swt-direct'', ''d5'', %L::JSONB, ''SWT прямой перенос'')',
  pg_temp.swt_id(1), pg_temp.swt_id(301), jsonb_build_object('student', jsonb_build_object('name', 'SWT Direct Person',
    'phone', '+996 700 000 105', 'email', 'swt-case-five@example.invalid'), 'route', jsonb_build_object('country', 'CN'))::TEXT))::TEXT AS swt_direct5 \gset
SELECT pg_temp.swt_assert(:'swt_direct5'::JSONB ->> 'status' = 'created' AND :'swt_direct5'::JSONB ->> 'client_id' = :'swt_client5'
  AND :'swt_direct5'::JSONB ->> 'lead_id' <> :'swt_lead5',
  'fixture: 281 reused the exact client of lead 5 for its own case (and its own lead)');
CREATE FUNCTION pg_temp.swt_people() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.swt_id(1)) || '/'
    || (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.swt_id(1)) || '/'
    || (SELECT count(*) FROM platform.student_cases WHERE organization_id = pg_temp.swt_id(1))
$$;
SELECT pg_temp.swt_state() AS swt_state_h0 \gset

-- 6.1 The boundary: no user identity; only the organization's Admin may be the actor.
SELECT pg_temp.swt_assert(pg_temp.swt_user(1, pg_temp.swt_case('e1', :'swt_lead6'::UUID, '{}'::JSONB))
    = '42501:permission denied for function create_sales_report_student_case_v1'
  AND pg_temp.swt_user(2, pg_temp.swt_case('e2', :'swt_lead6'::UUID, '{}'::JSONB))
    = '42501:permission denied for function create_sales_report_student_case_v1'
  AND pg_temp.swt_anon(pg_temp.swt_case('e3', :'swt_lead6'::UUID, '{}'::JSONB)) LIKE '42501:permission denied%',
  'authenticated, even the Admin, and anon cannot execute the case call');
SELECT pg_temp.swt_assert(r.answer = '42501:sales_report_case_forbidden', r.what || ' is refused: ' || r.answer)
FROM (VALUES
  ('the service role carrying a user JWT (a sub)', pg_temp.swt_as('{"role":"service_role","sub":"' || pg_temp.swt_id(101) || '"}', 'service_role', pg_temp.swt_case('e10', :'swt_lead6'::UUID, '{}'::JSONB))),
  ('an authenticated role claim without a sub', pg_temp.swt_as('{"role":"authenticated"}', 'service_role', pg_temp.swt_case('e11', :'swt_lead6'::UUID, '{}'::JSONB))),
  ('an anon role claim without a sub', pg_temp.swt_as('{"role":"anon"}', 'service_role', pg_temp.swt_case('e12', :'swt_lead6'::UUID, '{}'::JSONB))),
  ('a Sales Manager as the actor', pg_temp.swt_svc(pg_temp.swt_case('e13', :'swt_lead6'::UUID, '{}'::JSONB, 302))),
  ('the coarse Sales member as the actor', pg_temp.swt_svc(pg_temp.swt_case('e14', :'swt_lead6'::UUID, '{}'::JSONB, 307))),
  ('invited staff without roles as the actor', pg_temp.swt_svc(pg_temp.swt_case('e15', :'swt_lead6'::UUID, '{}'::JSONB, 309))),
  ('the register reader as the actor', pg_temp.swt_svc(pg_temp.swt_case('e16', :'swt_lead6'::UUID, '{}'::JSONB, 306))),
  ('the curator (holds case.create.direct, but is not the Admin) as the actor', pg_temp.swt_svc(pg_temp.swt_case('e17', :'swt_lead6'::UUID, '{}'::JSONB, 308))),
  ('a Student as the actor', pg_temp.swt_svc(pg_temp.swt_case('e18', :'swt_lead6'::UUID, '{}'::JSONB, 305))),
  ('an unknown membership as the actor', pg_temp.swt_svc(pg_temp.swt_case('e19', :'swt_lead6'::UUID, '{}'::JSONB, 999))),
  ('the Admin of another organization as the actor', pg_temp.swt_svc(pg_temp.swt_case('e20', :'swt_lead6'::UUID, '{}'::JSONB, 320))),
  ('the organization''s Admin acting in the other organization', pg_temp.swt_svc(pg_temp.swt_case('e21', :'swt_lead6'::UUID, '{}'::JSONB, 301, 2))),
  ('no organization', pg_temp.swt_svc(format('SELECT platform.create_sales_report_student_case_v1(NULL, %L::UUID, ''swt-case'', ''e22'', %L::UUID, ''{}''::JSONB, ''SWT'')',
    pg_temp.swt_id(301), :'swt_lead6'))),
  ('no actor', pg_temp.swt_svc(format('SELECT platform.create_sales_report_student_case_v1(%L::UUID, NULL, ''swt-case'', ''e23'', %L::UUID, ''{}''::JSONB, ''SWT'')',
    pg_temp.swt_id(1), :'swt_lead6'))),
  ('no lead', pg_temp.swt_svc(format('SELECT platform.create_sales_report_student_case_v1(%L::UUID, %L::UUID, ''swt-case'', ''e24'', NULL, ''{}''::JSONB, ''SWT'')',
    pg_temp.swt_id(1), pg_temp.swt_id(301))))
) AS r(what, answer);
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_h0', 'every refused boundary call wrote nothing');

-- 6.2 The strict call and payload: every refusal names its key; nothing is written (lead 6 never gets a case here).
SELECT pg_temp.swt_assert(r.answer = '22023:' || r.key, r.what || ' is ' || r.key || ': ' || r.answer)
FROM (VALUES
  ('a bad import source', 'sales_report_case_invalid:importSource', pg_temp.swt_svc(pg_temp.swt_case('f1', :'swt_lead6'::UUID, '{}'::JSONB, 301, 1, 'Bad Source'))),
  ('no import source', 'sales_report_case_invalid:importSource', pg_temp.swt_svc(pg_temp.swt_case('f2', :'swt_lead6'::UUID, '{}'::JSONB, 301, 1, NULL))),
  ('a blank external reference', 'sales_report_case_invalid:externalRef', pg_temp.swt_svc(pg_temp.swt_case('  ', :'swt_lead6'::UUID, '{}'::JSONB))),
  ('an external reference of 201 characters', 'sales_report_case_invalid:externalRef', pg_temp.swt_svc(pg_temp.swt_case(repeat('r', 201), :'swt_lead6'::UUID, '{}'::JSONB))),
  ('a blank reason', 'sales_report_case_invalid:reason', pg_temp.swt_svc(pg_temp.swt_case('f5', :'swt_lead6'::UUID, '{}'::JSONB, 301, 1, 'swt-case', ' '))),
  ('a reason of 501 characters', 'sales_report_case_invalid:reason', pg_temp.swt_svc(pg_temp.swt_case('f6', :'swt_lead6'::UUID, '{}'::JSONB, 301, 1, 'swt-case', repeat('r', 501)))),
  ('a reason with a control character', 'sales_report_case_invalid:reason', pg_temp.swt_svc(pg_temp.swt_case('f7', :'swt_lead6'::UUID, '{}'::JSONB, 301, 1, 'swt-case', 'SWT' || chr(7)))),
  ('a payload that is an array', 'sales_report_case_invalid:payload', pg_temp.swt_svc(pg_temp.swt_case('f8', :'swt_lead6'::UUID, '[]'::JSONB))),
  ('no payload', 'sales_report_case_invalid:payload', pg_temp.swt_svc(format('SELECT platform.create_sales_report_student_case_v1(%L::UUID, %L::UUID, ''swt-case'', ''f9'', %L::UUID, NULL, ''SWT'')',
    pg_temp.swt_id(1), pg_temp.swt_id(301), :'swt_lead6'))),
  ('a key the payload does not have', 'admissions_direct_invalid:payload', pg_temp.swt_svc(pg_temp.swt_case('f10', :'swt_lead6'::UUID, '{"foo":1}'::JSONB))),
  ('a student that is not an object', 'admissions_direct_invalid:student', pg_temp.swt_svc(pg_temp.swt_case('f11', :'swt_lead6'::UUID, '{"student":"x"}'::JSONB))),
  ('an extra student key', 'admissions_direct_invalid:student', pg_temp.swt_svc(pg_temp.swt_case('f12', :'swt_lead6'::UUID, '{"student":{"zzz":1}}'::JSONB))),
  ('a bad student phone', 'sales_report_case_invalid:phone', pg_temp.swt_svc(pg_temp.swt_case('f13', :'swt_lead6'::UUID, '{"student":{"phone":"12ab"}}'::JSONB))),
  ('a bad student e-mail', 'sales_report_case_invalid:email', pg_temp.swt_svc(pg_temp.swt_case('f14', :'swt_lead6'::UUID, '{"student":{"email":"nope"}}'::JSONB))),
  ('a birth date in the future', 'admissions_direct_invalid:birthDate', pg_temp.swt_svc(pg_temp.swt_case('f15', :'swt_lead6'::UUID, '{"student":{"birthDate":"2999-01-01"}}'::JSONB))),
  ('an age below 5', 'sales_report_case_invalid:age', pg_temp.swt_svc(pg_temp.swt_case('f16', :'swt_lead6'::UUID, '{"student":{"age":"3"}}'::JSONB))),
  ('a parent without a relation', 'sales_report_case_invalid:relation', pg_temp.swt_svc(pg_temp.swt_case('f17', :'swt_lead6'::UUID, '{"parent":{"firstName":"X"}}'::JSONB))),
  ('a bad parent phone', 'sales_report_case_invalid:parentPhone', pg_temp.swt_svc(pg_temp.swt_case('f18', :'swt_lead6'::UUID, '{"parent":{"relation":"mother","phone":"x1"}}'::JSONB))),
  ('a country in lower case', 'sales_report_case_invalid:country', pg_temp.swt_svc(pg_temp.swt_case('f19', :'swt_lead6'::UUID, '{"route":{"country":"cn"}}'::JSONB))),
  ('an extra route key', 'admissions_direct_invalid:route', pg_temp.swt_svc(pg_temp.swt_case('f20', :'swt_lead6'::UUID, '{"route":{"city":"x"}}'::JSONB))),
  ('an extra education key', 'admissions_direct_invalid:education', pg_temp.swt_svc(pg_temp.swt_case('f21', :'swt_lead6'::UUID, '{"education":{"zzz":"x"}}'::JSONB))),
  ('an unknown board stage', 'sales_report_case_invalid:pipelineStage', pg_temp.swt_svc(pg_temp.swt_case('f22', :'swt_lead6'::UUID, '{"pipelineStage":"won"}'::JSONB))),
  ('a curator that is not a UUID', 'sales_report_case_invalid:curator', pg_temp.swt_svc(pg_temp.swt_case('f23', :'swt_lead6'::UUID, '{"curatorMembershipId":"abc"}'::JSONB))),
  ('a curator that is no member', 'sales_report_case_invalid:curator', pg_temp.swt_svc(pg_temp.swt_case('f24', :'swt_lead6'::UUID,
    jsonb_build_object('curatorMembershipId', pg_temp.swt_id(999))))),
  ('a curator who is a Sales Manager (not eligible)', 'sales_report_case_invalid:curator', pg_temp.swt_svc(pg_temp.swt_case('f25', :'swt_lead6'::UUID,
    jsonb_build_object('curatorMembershipId', pg_temp.swt_id(302))))),
  ('a curator who is a Student', 'sales_report_case_invalid:curator', pg_temp.swt_svc(pg_temp.swt_case('f26', :'swt_lead6'::UUID,
    jsonb_build_object('curatorMembershipId', pg_temp.swt_id(305))))),
  ('a note of 3501 characters', 'admissions_direct_invalid:note', pg_temp.swt_svc(pg_temp.swt_case('f27', :'swt_lead6'::UUID, jsonb_build_object('note', repeat('n', 3501))))),
  ('money that is not an object', 'admissions_direct_invalid:money', pg_temp.swt_svc(pg_temp.swt_case('f28', :'swt_lead6'::UUID, '{"money":5}'::JSONB))),
  ('a cost in a currency the product does not use', 'sales_report_case_invalid:costCurrency', pg_temp.swt_svc(pg_temp.swt_case('f29', :'swt_lead6'::UUID,
    '{"money":{"cost":{"amountMinor":100,"currency":"GBP"}}}'::JSONB))),
  ('a negative cost', 'admissions_direct_invalid:cost', pg_temp.swt_svc(pg_temp.swt_case('f30', :'swt_lead6'::UUID,
    '{"money":{"cost":{"amountMinor":-1,"currency":"USD"}}}'::JSONB))),
  ('a signing day in the future', 'admissions_direct_invalid:signedOn', pg_temp.swt_svc(pg_temp.swt_case('f31', :'swt_lead6'::UUID,
    '{"money":{"signedOn":"2999-01-01"}}'::JSONB))),
  ('payments that are not a list', 'sales_report_case_invalid:payments', pg_temp.swt_svc(pg_temp.swt_case('f32', :'swt_lead6'::UUID,
    '{"money":{"payments":5}}'::JSONB))),
  ('a payment without its day', 'sales_report_case_invalid:payment', pg_temp.swt_svc(pg_temp.swt_case('f33', :'swt_lead6'::UUID,
    '{"money":{"payments":[{"amountMinor":1,"currency":"USD"}]}}'::JSONB))),
  ('a payment in the future', 'admissions_direct_invalid:paidOn', pg_temp.swt_svc(pg_temp.swt_case('f34', :'swt_lead6'::UUID,
    '{"money":{"payments":[{"amountMinor":1,"currency":"USD","paidOn":"2999-01-01"}]}}'::JSONB))),
  ('payments above the cost', 'sales_report_case_invalid:paymentsExceedCost', pg_temp.swt_svc(pg_temp.swt_case('f35', :'swt_lead6'::UUID,
    '{"money":{"cost":{"amountMinor":100,"currency":"USD"},"payments":[{"amountMinor":101,"currency":"USD","paidOn":"2026-09-01"}]}}'::JSONB))),
  ('more than 20 payments', 'sales_report_case_invalid:payments', pg_temp.swt_svc(pg_temp.swt_case('f36', :'swt_lead6'::UUID,
    jsonb_build_object('money', jsonb_build_object('payments', (SELECT jsonb_agg(jsonb_build_object('amountMinor', 1, 'currency', 'USD',
      'paidOn', '2026-09-01')) FROM generate_series(1, 21)))))))
) AS r(what, key, answer);
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_h0', 'the refused calls wrote nothing (no case, receipt, row, person or journal row)');

-- 6.3 The lead must be this organization's, from the sales report, converted.
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_case('l1', pg_temp.swt_id(5555), '{}'::JSONB)) = 'PT404:sales_report_case_lead_missing'
  AND pg_temp.swt_svc(pg_temp.swt_case('l2', :'swt_foreign_lead'::UUID, '{}'::JSONB)) = 'PT404:sales_report_case_lead_missing'
  AND pg_temp.swt_svc(pg_temp.swt_case('l3', :'swt_lead1'::UUID, '{}'::JSONB, 320, 2)) = 'PT404:sales_report_case_lead_missing',
  'an unknown lead and a lead of another organization are PT404 sales_report_case_lead_missing');
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_case('l4', :'swt_office_lead'::UUID, '{}'::JSONB)) = '22023:sales_report_case_invalid_lead'
  AND pg_temp.swt_svc(pg_temp.swt_case('l5', :'swt_open_lead'::UUID, '{}'::JSONB)) = '22023:sales_report_case_invalid_lead',
  'an ordinary office lead, and a report lead that is not converted, are 22023 sales_report_case_invalid_lead');
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_h0', 'the lead refusals wrote nothing');
-- Converted and active is not enough: the lead must come from the report (source) and its client must be active.
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_case('l6', :'swt_lead7'::UUID, '{}'::JSONB)) = '22023:sales_report_case_invalid_lead'
  AND pg_temp.swt_state() = :'swt_state_h0',
  'a converted lead of an active client whose source is not sales_report is 22023 sales_report_case_invalid_lead; nothing is written');
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_case('l7', :'swt_lead8'::UUID, '{}'::JSONB)) = '22023:sales_report_case_invalid_lead'
  AND pg_temp.swt_state() = :'swt_state_h0',
  'a converted report lead whose client is not active is 22023 sales_report_case_invalid_lead; nothing is written');
-- The receipt key is shared with 281's imports: a pair 281 already used is a conflict, not a raw unique violation.
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_case('d5', :'swt_lead6'::UUID, '{}'::JSONB, 301, 1, 'swt-direct')) = 'PT409:sales_report_case_conflict'
  AND pg_temp.swt_state() = :'swt_state_h0'
  AND (SELECT count(*) = 1 FROM platform_private.admissions_direct_case_receipts
    WHERE organization_id = pg_temp.swt_id(1) AND import_source = 'swt-direct' AND external_ref = 'd5'),
  'the import source and reference 281 used (swt-direct / d5) are PT409 sales_report_case_conflict for this call; nothing is written');

-- 6.4 The success: lead 1, no curator, everything in the payload (the case waits for a curator).
CREATE FUNCTION pg_temp.swt_case_req(p_ref TEXT, p_source TEXT DEFAULT 'swt-case') RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT public.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::UUID,
    'evo:sales-report-case:' || pg_temp.swt_id(1)::TEXT || ':' || p_source || ':' || p_ref)
$$;
CREATE FUNCTION pg_temp.swt_row_md5(p_table TEXT, p_id UUID) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE answer TEXT;
BEGIN
  EXECUTE format('SELECT md5(t::TEXT) FROM %s t WHERE t.id = %L', p_table, p_id) INTO answer;
  RETURN answer;
END
$$;
SELECT pg_temp.swt_row_md5('platform.clients', :'swt_client1'::UUID) AS swt_client1_md5, pg_temp.swt_row_md5('platform.leads', :'swt_lead1'::UUID) AS swt_lead1_md5,
  pg_temp.swt_people() AS swt_people0, (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.swt_id(1) AND lifecycle_state = 'open') AS swt_open0 \gset
SELECT jsonb_build_object(
  'student', jsonb_build_object('name', 'SWT Case Student', 'phone', '+996 700 000 111', 'email', 'swt-student@example.invalid', 'birthDate', '2008-05-05'),
  'parent', jsonb_build_object('relation', 'mother', 'firstName', 'SWTMother', 'lastName', 'Parent', 'phone', '+996 700 000 112'),
  'route', jsonb_build_object('country', 'CN', 'degree', 'Бакалавриат', 'program', 'Computer Science', 'intake', 'сентябрь 2027'),
  'education', jsonb_build_object('current', '11 класс', 'english', 'IELTS 6.0', 'chinese', 'HSK 3'),
  'pipelineStage', 'new',
  'money', jsonb_build_object('cost', jsonb_build_object('amountMinor', 150000, 'currency', 'USD'), 'signedOn', '2026-09-01',
    'payments', jsonb_build_array(jsonb_build_object('amountMinor', 50000, 'currency', 'USD', 'paidOn', '2026-09-05'),
      jsonb_build_object('amountMinor', 30000, 'currency', 'EUR', 'paidOn', '2026-09-06'))),
  'note', 'SWT case note')::TEXT AS swt_k1_payload \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('k1', :'swt_lead1'::UUID, :'swt_k1_payload'::JSONB))::TEXT AS swt_k1 \gset
SELECT :'swt_k1'::JSONB ->> 'student_case_id' AS swt_case1 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_keys(:'swt_k1'::JSONB) = ARRAY['client_id', 'client_reused', 'curator_membership_id', 'lead_id', 'organization_id',
      'payment_event_ids', 'payment_obligation_ids', 'pipeline_stage', 'replayed', 'state', 'status', 'student_case_id']
  AND :'swt_k1'::JSONB ->> 'status' = 'created' AND :'swt_k1'::JSONB ->> 'state' = 'pending'
  AND :'swt_k1'::JSONB ->> 'lead_id' = :'swt_lead1' AND :'swt_k1'::JSONB ->> 'client_id' = :'swt_client1'
  AND (:'swt_k1'::JSONB -> 'client_reused') = 'false'::JSONB AND (:'swt_k1'::JSONB -> 'replayed') = 'false'::JSONB
  AND :'swt_k1'::JSONB -> 'curator_membership_id' = 'null'::JSONB AND :'swt_k1'::JSONB ->> 'pipeline_stage' = 'new'
  AND jsonb_array_length(:'swt_k1'::JSONB -> 'payment_obligation_ids') = 2 AND jsonb_array_length(:'swt_k1'::JSONB -> 'payment_event_ids') = 2,
  'k1: created, pending (no curator), the ids of the existing lead and client, two tranches and two payments: ' || :'swt_k1');
-- Nothing was created for the person, and nothing of theirs was touched.
SELECT pg_temp.swt_assert(pg_temp.swt_people() = (split_part(:'swt_people0', '/', 1) || '/' || split_part(:'swt_people0', '/', 2) || '/'
      || (split_part(:'swt_people0', '/', 3)::INTEGER + 1))
  AND pg_temp.swt_row_md5('platform.clients', :'swt_client1'::UUID) = :'swt_client1_md5'
  AND pg_temp.swt_row_md5('platform.leads', :'swt_lead1'::UUID) = :'swt_lead1_md5'
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.swt_id(1) AND lifecycle_state = 'open') = :swt_open0
  AND (SELECT l.lifecycle_state = 'converted' AND l.source_key = 'sales_report' AND l.current_owner_membership_id IS NULL
    FROM platform.leads l WHERE l.id = :'swt_lead1'::UUID),
  'k1: one case more, no client and no lead more; the client row and the lead row are byte for byte what they were (name, phone, e-mail not overwritten)');
SELECT pg_temp.swt_assert((SELECT c.source_key = 'admissions-direct:' || :'swt_lead1' AND c.canonical_lead_id = :'swt_lead1'::UUID
      AND c.canonical_client_id = :'swt_client1'::UUID AND c.state = 'pending' AND c.operational_stage = 'intake'
      AND c.student_display_name = 'SWT Case Student' AND c.target_country = 'CN' AND c.target_degree = 'Бакалавриат'
      AND c.program_direction = 'Computer Science' AND c.intake = 'сентябрь 2027' AND c.language_assumption = 'IELTS 6.0; HSK 3'
      AND c.pipeline_stage = 'new' AND c.current_curator_membership_id IS NULL AND c.admissions_direction = 'CN'
    FROM platform.student_cases c WHERE c.id = :'swt_case1'::UUID AND c.organization_id = pg_temp.swt_id(1)),
  'k1: the case sits on the existing lead and client, with the payload''s name, route and education (the student block names the case, not the client)');
SELECT pg_temp.swt_assert((SELECT p.preferred_display_name = 'SWT Case Student' AND p.date_of_birth = DATE '2008-05-05'
      AND p.current_education_summary = '11 класс' AND p.language_summary = 'IELTS 6.0; HSK 3' AND p.consent_status = 'not_recorded'
      AND p.created_by_membership_id = pg_temp.swt_id(301)
    FROM platform.student_profiles p WHERE p.student_case_id = :'swt_case1'::UUID)
  AND (SELECT array_agg(f.field_key ORDER BY f.field_key) FROM platform.student_profile_fields f WHERE f.student_case_id = :'swt_case1'::UUID)
    = ARRAY['chinese_level_hsk', 'current_study_status', 'date_of_birth', 'english_level', 'field_major', 'mobile_phone', 'mother_first_name',
      'mother_last_name', 'mother_mobile_phone', 'program_level', 'student_email']
  AND (SELECT bool_and(f.review_state = 'needs_review') FROM platform.student_profile_fields f WHERE f.student_case_id = :'swt_case1'::UUID)
  AND (SELECT f.value FROM platform.student_profile_fields f WHERE f.student_case_id = :'swt_case1'::UUID AND f.field_key = 'mobile_phone') = '+996700000111'
  AND (SELECT f.value FROM platform.student_profile_fields f WHERE f.student_case_id = :'swt_case1'::UUID AND f.field_key = 'mother_mobile_phone') = '+996700000112'
  AND (SELECT f.value FROM platform.student_profile_fields f WHERE f.student_case_id = :'swt_case1'::UUID AND f.field_key = 'student_email') = 'swt-student@example.invalid'
  AND (SELECT f.value FROM platform.student_profile_fields f WHERE f.student_case_id = :'swt_case1'::UUID AND f.field_key = 'date_of_birth') IS NULL
  AND (SELECT count(*) = 1 AND bool_and(n.body = 'SWT case note' AND n.created_by_membership_id = pg_temp.swt_id(301))
    FROM platform.case_notes n WHERE n.student_case_id = :'swt_case1'::UUID),
  'k1: the профиль, its eleven анкета fields (all needs_review, phones in E.164, the birth date in its canonical column) and the first note');
-- Money: the contract conditions of the lead, one tranche per currency, the payments received.
SELECT pg_temp.swt_assert((SELECT c.fields ->> 'service_cost_minor' = '150000' AND c.fields ->> 'service_cost_currency' = 'USD'
      AND c.fields ->> 'signing_date' = '2026-09-01' AND c.revision = 1 AND c.updated_by_membership_id = pg_temp.swt_id(301)
    FROM platform_private.lead_sale_conditions c WHERE c.lead_id = :'swt_lead1'::UUID)
  AND (SELECT jsonb_agg(jsonb_build_array(o.label, o.amount_minor, o.currency, o.total_paid_minor, o.category) ORDER BY o.currency)
      FROM platform.payment_obligations o WHERE o.student_case_id = :'swt_case1'::UUID)
    = '[["Получено в EUR",30000,"EUR",30000,"evo_service_fee"],["Оплата по договору",150000,"USD",50000,"evo_service_fee"]]'::JSONB
  AND (SELECT jsonb_agg(jsonb_build_array(e.event_type, e.amount_minor, e.currency, e.source_key,
        (e.occurred_at AT TIME ZONE 'Asia/Bishkek')::DATE) ORDER BY e.currency)
      FROM platform.payment_events e WHERE e.student_case_id = :'swt_case1'::UUID)
    = '[["payment",30000,"EUR","admissions_direct","2026-09-06"],["payment",50000,"USD","admissions_direct","2026-09-05"]]'::JSONB
  AND (SELECT count(*) = 2 FROM platform.payment_evidence v WHERE v.student_case_id = :'swt_case1'::UUID)
  AND (SELECT array_agg(o.id ORDER BY o.id) FROM platform.payment_obligations o WHERE o.student_case_id = :'swt_case1'::UUID)
    = (SELECT array_agg(x::UUID ORDER BY x::UUID) FROM jsonb_array_elements_text(:'swt_k1'::JSONB -> 'payment_obligation_ids') x),
  'k1: the lead''s sale conditions (1500 USD, signed 01.09), a tranche of 1500 USD with 500 paid and a tranche of 300 EUR paid in full, two payment events with evidence');
-- The receipt of 281's table carries the import source, so 287 can complete the case.
SELECT pg_temp.swt_assert((SELECT r.import_source = 'swt-case' AND r.external_ref = 'k1' AND r.student_case_id = :'swt_case1'::UUID
      AND r.client_id = :'swt_client1'::UUID AND r.lead_id = :'swt_lead1'::UUID AND r.actor_membership_id = pg_temp.swt_id(301)
      AND r.receipt = :'swt_k1'::JSONB AND r.fingerprint ~ '^[0-9a-f]{32}$' AND (r.receipt ->> 'client_reused')::BOOLEAN = FALSE
    FROM platform_private.admissions_direct_case_receipts r WHERE r.request_id = pg_temp.swt_case_req('k1')),
  'k1: the receipt in admissions_direct_case_receipts has the import source and the external reference, the case, client and lead, and the answer');
-- The journal: the case and its money, from the service principal, without a name, a phone, an e-mail or the note.
SELECT pg_temp.swt_assert((SELECT a.action = 'case.create' AND a.resource_type = 'student_case' AND a.resource_id = :'swt_case1'::UUID
      AND a.actor_principal = 'service:sales-report-case' AND a.actor_membership_id = pg_temp.swt_id(301) AND a.actor_profile_id = pg_temp.swt_id(201)
      AND a.after_state ->> 'origin' = 'sales_report' AND a.after_state ->> 'import_source' = 'swt-case' AND a.after_state ->> 'external_ref' = 'k1'
      AND a.after_state ->> 'status' = 'created' AND a.reason = 'SWT синтетическое дело'
    FROM platform.audit_events a WHERE a.request_id = pg_temp.swt_case_req('k1'))
  AND (SELECT count(*) FILTER (WHERE a.action = 'case.tranche.save') = 2 AND count(*) FILTER (WHERE a.action = 'finance.payment.record') = 2
      AND bool_and(a.actor_principal = 'service:sales-report-case')
    FROM platform.audit_events a WHERE a.organization_id = pg_temp.swt_id(1) AND a.actor_principal = 'service:sales-report-case'
      AND a.action IN ('case.tranche.save', 'finance.payment.record')),
  'k1: case.create with its origin and source, two case.tranche.save and two finance.payment.record, all of the service principal');
-- Replay, conflicts, the same lead again.
SELECT pg_temp.swt_state() AS swt_state_k1 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('k1', :'swt_lead1'::UUID, :'swt_k1_payload'::JSONB))::TEXT AS swt_k1_replay \gset
SELECT pg_temp.swt_assert(:'swt_k1_replay'::JSONB = (:'swt_k1'::JSONB || '{"replayed":true}'::JSONB) AND pg_temp.swt_state() = :'swt_state_k1',
  'k1 replay: the same answer with replayed = true, nothing written');
SELECT pg_temp.swt_assert(r.answer = 'PT409:sales_report_case_conflict', 'the key of k1 with ' || r.what || ': ' || r.answer)
FROM (VALUES
  ('another payload', pg_temp.swt_svc(pg_temp.swt_case('k1', :'swt_lead1'::UUID, '{"note":"SWT another"}'::JSONB))),
  ('another lead', pg_temp.swt_svc(pg_temp.swt_case('k1', :'swt_lead2'::UUID, '{"note":"SWT case note"}'::JSONB))),
  ('another actor (the second Admin)', pg_temp.swt_svc(pg_temp.swt_case('k1', :'swt_lead1'::UUID, '{"note":"SWT case note"}'::JSONB, 310))),
  ('another reason', pg_temp.swt_svc(pg_temp.swt_case('k1', :'swt_lead1'::UUID, '{"note":"SWT case note"}'::JSONB, 301, 1, 'swt-case', 'SWT другая причина')))
) AS r(what, answer);
SELECT pg_temp.swt_assert(pg_temp.swt_state() = :'swt_state_k1', 'the conflicts wrote nothing');
-- Only the lead differs (same source, reference, payload, reason and actor): the fingerprint holds the lead.
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_case('k1', :'swt_lead2'::UUID, :'swt_k1_payload'::JSONB)) = 'PT409:sales_report_case_conflict'
  AND pg_temp.swt_svc(pg_temp.swt_case('k1', :'swt_lead6'::UUID, :'swt_k1_payload'::JSONB)) = 'PT409:sales_report_case_conflict'
  AND pg_temp.swt_state() = :'swt_state_k1',
  'k1 sent for another lead with the very same source, reference, payload and reason is PT409 sales_report_case_conflict, not a replay of lead 1''s receipt');
-- The lead has its case now: a new reference, or another import source, only reports it.
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('k1b', :'swt_lead1'::UUID, '{"note":"SWT again"}'::JSONB))::TEXT AS swt_k1b \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('k1', :'swt_lead1'::UUID, '{"note":"SWT again"}'::JSONB, 301, 1, 'swt-other'))::TEXT AS swt_k1c \gset
SELECT pg_temp.swt_assert(:'swt_k1b'::JSONB = jsonb_build_object('organization_id', pg_temp.swt_id(1), 'status', 'case_exists',
      'student_case_id', :'swt_case1', 'lead_id', :'swt_lead1', 'client_id', :'swt_client1', 'import_source', 'swt-case',
      'external_ref', 'k1b', 'replayed', FALSE)
  AND pg_temp.swt_keys(:'swt_k1b'::JSONB) = ARRAY['client_id', 'external_ref', 'import_source', 'lead_id', 'organization_id', 'replayed', 'status', 'student_case_id']
  AND :'swt_k1c'::JSONB ->> 'status' = 'case_exists' AND :'swt_k1c'::JSONB ->> 'student_case_id' = :'swt_case1'
  AND pg_temp.swt_state() = :'swt_state_k1',
  'a lead that has its case: case_exists with the case, nothing created, no receipt');
-- A malformed payload is refused even for a lead that already has its case (the payload is read first).
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_case('k1d', :'swt_lead1'::UUID, '{"bogus":1}'::JSONB))
    = '22023:admissions_direct_invalid:payload'
  AND pg_temp.swt_svc(pg_temp.swt_case('k1e', :'swt_lead1'::UUID, '{"route":{"country":"Narnia"}}'::JSONB))
    = '22023:admissions_direct_invalid:country'
  AND pg_temp.swt_state() = :'swt_state_k1',
  'a malformed payload on a lead with a case is refused by name, not answered with case_exists; nothing written');

-- 6.5 Lead 2: a curator and a board stage, no student block (the name is the client's), no money.
SELECT pg_temp.swt_row_md5('platform.clients', :'swt_client2'::UUID) AS swt_client2_md5 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('k2', :'swt_lead2'::UUID, jsonb_build_object('curatorMembershipId', pg_temp.swt_id(308),
  'pipelineStage', 'documents', 'route', jsonb_build_object('country', 'CN'))))::TEXT AS swt_k2 \gset
SELECT :'swt_k2'::JSONB ->> 'student_case_id' AS swt_case2 \gset
SELECT pg_temp.swt_assert(:'swt_k2'::JSONB ->> 'status' = 'created' AND :'swt_k2'::JSONB ->> 'state' = 'active'
  AND :'swt_k2'::JSONB ->> 'curator_membership_id' = pg_temp.swt_id(308)::TEXT AND :'swt_k2'::JSONB ->> 'pipeline_stage' = 'documents'
  AND (:'swt_k2'::JSONB -> 'client_reused') = 'false'::JSONB AND :'swt_k2'::JSONB -> 'payment_obligation_ids' = '[]'::JSONB
  AND (SELECT c.state = 'active' AND c.current_curator_membership_id = pg_temp.swt_id(308) AND c.student_display_name = 'SWT Case Two'
      AND c.pipeline_stage = 'documents' AND c.canonical_lead_id = :'swt_lead2'::UUID
    FROM platform.student_cases c WHERE c.id = :'swt_case2'::UUID)
  AND (SELECT p.preferred_display_name = 'SWT Case Two' FROM platform.student_profiles p WHERE p.student_case_id = :'swt_case2'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform_private.lead_sale_conditions WHERE lead_id = :'swt_lead2'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform.payment_obligations WHERE student_case_id = :'swt_case2'::UUID)
  AND pg_temp.swt_row_md5('platform.clients', :'swt_client2'::UUID) = :'swt_client2_md5',
  'k2: with an eligible curator the case is active at the chosen stage, named after the client, with no money and no conditions row');

-- 6.6 Lead 3: its client has another report lead (client_reused); the payload's contacts never reach the client row.
SELECT pg_temp.swt_row_md5('platform.clients', :'swt_client3'::UUID) AS swt_client3_md5, pg_temp.swt_row_md5('platform.leads', :'swt_lead3'::UUID) AS swt_lead3_md5 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('k3', :'swt_lead3'::UUID, jsonb_build_object(
  'student', jsonb_build_object('name', 'SWT Student Three', 'phone', '+996 700 000 133', 'email', 'swt-student-three@example.invalid', 'age', 14),
  'parent', jsonb_build_object('relation', 'father', 'firstName', 'SWTFather', 'phone', '+996 700 000 134'))))::TEXT AS swt_k3 \gset
SELECT :'swt_k3'::JSONB ->> 'student_case_id' AS swt_case3 \gset
SELECT pg_temp.swt_assert(:'swt_k3'::JSONB ->> 'status' = 'created' AND (:'swt_k3'::JSONB -> 'client_reused') = 'true'::JSONB
  AND pg_temp.swt_row_md5('platform.clients', :'swt_client3'::UUID) = :'swt_client3_md5'
  AND pg_temp.swt_row_md5('platform.leads', :'swt_lead3'::UUID) = :'swt_lead3_md5'
  AND (SELECT cl.display_name = 'SWT Case Three' AND cl.phone = '+996700000103' AND cl.normalized_email = 'swt-case-three@example.invalid'
    FROM platform.clients cl WHERE cl.id = :'swt_client3'::UUID)
  AND (SELECT c.student_display_name = 'SWT Student Three' FROM platform.student_cases c WHERE c.id = :'swt_case3'::UUID)
  AND (SELECT f.value FROM platform.student_profile_fields f WHERE f.student_case_id = :'swt_case3'::UUID AND f.field_key = 'mobile_phone') = '+996700000133'
  AND (SELECT f.value FROM platform.student_profile_fields f WHERE f.student_case_id = :'swt_case3'::UUID AND f.field_key = 'father_mobile_phone') = '+996700000134'
  AND (SELECT n.body LIKE 'Возраст: 14 (на %)' FROM platform.case_notes n WHERE n.student_case_id = :'swt_case3'::UUID)
  AND (SELECT r.receipt ->> 'client_reused' = 'true' FROM platform_private.admissions_direct_case_receipts r WHERE r.request_id = pg_temp.swt_case_req('k3')),
  'k3: client_reused is true because the client has another lead; the client and the lead are untouched whatever the payload carries; the age goes to the first note');
-- A person with an open case behind another lead of the same client is reported, not duplicated.
SELECT pg_temp.swt_state() AS swt_state_k3 \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('k3b', pg_temp.swt_id(8201), '{"note":"SWT other lead"}'::JSONB))::TEXT AS swt_k3b \gset
SELECT pg_temp.swt_assert(:'swt_k3b'::JSONB ->> 'status' = 'case_exists' AND :'swt_k3b'::JSONB ->> 'student_case_id' = :'swt_case3'
  AND :'swt_k3b'::JSONB ->> 'lead_id' = pg_temp.swt_id(8201)::TEXT AND :'swt_k3b'::JSONB ->> 'client_id' = :'swt_client3'
  AND pg_temp.swt_state() = :'swt_state_k3',
  'k3b: the second report lead of a client with an open case gets case_exists with that case and creates nothing');
-- A person with an open direct-import case (281) is reported too.
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('k5', :'swt_lead5'::UUID, '{"note":"SWT five"}'::JSONB))::TEXT AS swt_k5 \gset
SELECT pg_temp.swt_assert(:'swt_k5'::JSONB ->> 'status' = 'case_exists' AND :'swt_k5'::JSONB ->> 'student_case_id' = :'swt_direct5'::JSONB ->> 'student_case_id'
  AND :'swt_k5'::JSONB ->> 'lead_id' = :'swt_lead5' AND :'swt_k5'::JSONB ->> 'client_id' = :'swt_client5'
  AND pg_temp.swt_state() = :'swt_state_k3',
  'k5: a person who already has a case of the direct import is case_exists with that case; nothing is created');

-- 6.7 Lead 4 already has its sale conditions: the payload may not carry money.
SELECT (SELECT md5(c::TEXT) FROM platform_private.lead_sale_conditions c WHERE c.lead_id = :'swt_lead4'::UUID) AS swt_cond4_md5 \gset
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_case('k4a', :'swt_lead4'::UUID, '{"money":{"cost":{"amountMinor":90000,"currency":"USD"}}}'::JSONB))
    = '22023:sales_report_case_invalid:conditionsExist'
  AND pg_temp.swt_svc(pg_temp.swt_case('k4b', :'swt_lead4'::UUID, '{"money":{"signedOn":"2026-09-02"}}'::JSONB)) = '22023:sales_report_case_invalid:conditionsExist'
  AND pg_temp.swt_state() = :'swt_state_k3',
  'k4: a lead with sale conditions and money in the payload is 22023 conditionsExist, and the whole call is rolled back (no case, no receipt)');
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('k4c', :'swt_lead4'::UUID, '{"note":"SWT four"}'::JSONB))::TEXT AS swt_k4 \gset
SELECT pg_temp.swt_assert(:'swt_k4'::JSONB ->> 'status' = 'created'
  AND (SELECT md5(c::TEXT) = :'swt_cond4_md5' FROM platform_private.lead_sale_conditions c WHERE c.lead_id = :'swt_lead4'::UUID)
  AND (SELECT count(*) = 1 FROM platform_private.lead_sale_conditions c WHERE c.lead_id = :'swt_lead4'::UUID),
  'k4c: without money the case is created and the lead''s own conditions are left alone');

-- 6.8 No person is created and no lead leaves the report: the cases are not sales leads.
SELECT pg_temp.swt_assert((SELECT count(*) = 7 AND bool_and(l.source_key = 'sales_report' AND l.lifecycle_state = 'converted'
        AND l.current_owner_membership_id IS NULL)
      FROM platform.leads l WHERE l.id IN (:'swt_lead1'::UUID, :'swt_lead2'::UUID, :'swt_lead3'::UUID, :'swt_lead4'::UUID,
        :'swt_lead5'::UUID, :'swt_lead6'::UUID, :'swt_lead9'::UUID))
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.swt_id(1) AND lifecycle_state = 'open') = :swt_open0
  AND (SELECT count(*) FROM platform.student_cases WHERE organization_id = pg_temp.swt_id(1)) = 5
  AND NOT EXISTS (SELECT 1 FROM platform_private.marketing_cohort(pg_temp.swt_id(1), DATE '2000-01-01', DATE '2100-12-31') c
      WHERE c.lead_id IN (:'swt_lead1'::UUID, :'swt_lead2'::UUID, :'swt_lead3'::UUID, :'swt_lead4'::UUID))
  AND NOT EXISTS (SELECT 1 FROM platform.sales_admissions_handoffs h WHERE h.lead_id IN (:'swt_lead1'::UUID, :'swt_lead2'::UUID, :'swt_lead3'::UUID, :'swt_lead4'::UUID)),
  'the leads stay converted report leads without an owner (not open sales leads, not in the marketing cohort, no handoff); five cases in the organization');

-- 6.9 Compatibility with migration 287: platform.update_admissions_direct_case_v1 accepts these cases and closes them.
CREATE FUNCTION pg_temp.swt_update(p_case UUID, p_ref TEXT, p_payload JSONB, p_actor INTEGER DEFAULT 301) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.update_admissions_direct_case_v1(%L::UUID, %L::UUID, %L::UUID, ''swt-update'', %L, %L::JSONB, ''SWT дополнение дела'')',
    pg_temp.swt_id(1), pg_temp.swt_id(p_actor), p_case, p_ref, p_payload::TEXT)
$$;
-- Case 1 waits for a curator: 287 sets the curator and closes it in one call.
SELECT pg_temp.swt_svc_json(pg_temp.swt_update(:'swt_case1'::UUID, 'u1', jsonb_build_object('curatorMembershipId', pg_temp.swt_id(308),
  'close', jsonb_build_object('outcome', 'enrolled'))))::TEXT AS swt_u1 \gset
SELECT pg_temp.swt_assert(:'swt_u1'::JSONB ->> 'status' = 'updated' AND :'swt_u1'::JSONB -> 'changed' = '["curatorMembershipId","close"]'::JSONB
  AND (:'swt_u1'::JSONB -> 'closed') = 'true'::JSONB AND :'swt_u1'::JSONB ->> 'state' = 'closed'
  AND (SELECT c.state = 'closed' AND c.closed_at IS NOT NULL AND c.current_curator_membership_id = pg_temp.swt_id(308)
      AND c.canonical_lead_id = :'swt_lead1'::UUID
    FROM platform.student_cases c WHERE c.id = :'swt_case1'::UUID)
  AND (SELECT a.after_state ->> 'outcome' = 'enrolled' FROM platform.audit_events a
    WHERE a.resource_id = :'swt_case1'::UUID AND a.action = 'case.lifecycle.change' AND a.request_id IS NOT NULL ORDER BY a.created_at DESC LIMIT 1),
  'u1: 287 accepts the case (its receipt has an import source), sets the curator and closes it as enrolled');
-- Case 2 is active: closed as declined.
SELECT pg_temp.swt_svc_json(pg_temp.swt_update(:'swt_case2'::UUID, 'u2', '{"close":{"outcome":"declined"}}'::JSONB))::TEXT AS swt_u2 \gset
SELECT pg_temp.swt_assert(:'swt_u2'::JSONB -> 'changed' = '["close"]'::JSONB AND :'swt_u2'::JSONB ->> 'state' = 'closed'
  AND (SELECT c.state = 'closed' FROM platform.student_cases c WHERE c.id = :'swt_case2'::UUID),
  'u2: an active report case is closed as declined');
-- Case 3 shares its client with another report lead: 287 leaves the client's contacts alone and says so.
SELECT pg_temp.swt_svc_json(pg_temp.swt_update(:'swt_case3'::UUID, 'u3', '{"student":{"name":"SWT Renamed Three","phone":"+996 700 000 135"},"note":"SWT upd"}'::JSONB))::TEXT AS swt_u3 \gset
SELECT pg_temp.swt_assert(:'swt_u3'::JSONB ->> 'status' = 'updated'
  AND :'swt_u3'::JSONB -> 'contact_conflict' = '[{"field":"name","reason":"client_reused"},{"field":"phone","reason":"client_reused"}]'::JSONB
  AND pg_temp.swt_row_md5('platform.clients', :'swt_client3'::UUID) = :'swt_client3_md5'
  AND (SELECT c.state = 'pending' FROM platform.student_cases c WHERE c.id = :'swt_case3'::UUID),
  'u3: client_reused = true in the receipt makes 287 report the name and phone as client_reused and leave the client row alone');
-- Case 9 on a client with only this lead: 287 may rewrite the client's name and phone, then close the case.
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('k9', :'swt_lead9'::UUID, jsonb_build_object('curatorMembershipId', pg_temp.swt_id(308),
  'pipelineStage', 'documents')))::TEXT AS swt_k9 \gset
SELECT :'swt_k9'::JSONB ->> 'student_case_id' AS swt_case9 \gset
SELECT pg_temp.swt_assert((:'swt_k9'::JSONB -> 'client_reused') = 'false'::JSONB AND :'swt_k9'::JSONB ->> 'state' = 'active',
  'k9: a client with only this lead is not shared (client_reused = false)');
SELECT pg_temp.swt_svc_json(pg_temp.swt_update(:'swt_case9'::UUID, 'u9',
  '{"student":{"name":"SWT Renamed Nine","phone":"+996 700 000 139"},"close":{"outcome":"enrolled"}}'::JSONB))::TEXT AS swt_u9 \gset
SELECT pg_temp.swt_assert(:'swt_u9'::JSONB -> 'changed' = '["student","close"]'::JSONB AND NOT (:'swt_u9'::JSONB ? 'contact_conflict')
  AND :'swt_u9'::JSONB ->> 'state' = 'closed'
  AND (SELECT cl.display_name = 'SWT Renamed Nine' AND cl.phone = '+996700000139' FROM platform.clients cl WHERE cl.id = :'swt_client9'::UUID)
  AND (SELECT c.state = 'closed' AND c.student_display_name = 'SWT Renamed Nine' FROM platform.student_cases c WHERE c.id = :'swt_case9'::UUID),
  'u9: for an unshared client 287 applies the name and phone to the client and the case, then closes it');
-- The leads stay what they were, whatever 287 did with the cases.
SELECT pg_temp.swt_assert((SELECT count(*) = 7 AND bool_and(l.source_key = 'sales_report' AND l.lifecycle_state = 'converted'
        AND l.current_owner_membership_id IS NULL)
      FROM platform.leads l WHERE l.id IN (:'swt_lead1'::UUID, :'swt_lead2'::UUID, :'swt_lead3'::UUID, :'swt_lead4'::UUID,
        :'swt_lead5'::UUID, :'swt_lead6'::UUID, :'swt_lead9'::UUID))
  AND pg_temp.swt_row_md5('platform.leads', :'swt_lead1'::UUID) = :'swt_lead1_md5'
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.swt_id(1) AND lifecycle_state = 'open') = :swt_open0
  AND NOT EXISTS (SELECT 1 FROM platform.sales_admissions_handoffs h WHERE h.lead_id IN (:'swt_lead1'::UUID, :'swt_lead2'::UUID, :'swt_lead3'::UUID, :'swt_lead9'::UUID)),
  'after 287''s completion the leads are still converted report leads (no owner, none open), with no handoff: the case does not turn a report lead into a sales lead');
-- 287 still refuses a case that did not come through an import receipt and a non-Admin actor.
SELECT pg_temp.swt_assert(pg_temp.swt_svc(pg_temp.swt_update(:'swt_case3'::UUID, 'u3x', '{"note":"SWT x"}'::JSONB, 308)) = '42501:admissions_direct_forbidden'
  AND pg_temp.swt_svc(pg_temp.swt_update(pg_temp.swt_id(777), 'u3y', '{"note":"SWT x"}'::JSONB)) = '42501:admissions_direct_update_not_imported_case',
  '287 keeps its own gates: a non-Admin actor and a case without an import receipt are refused');

-- 6.10 The locks the call takes, the lead row it locks, and the organization it searches in.
-- Advisory locks of a transaction live until it ends, so a call's locks can be read from pg_locks right after it
-- (the key of a bigint advisory lock is split into classid = high 32 bits and objid = low 32 bits).
CREATE FUNCTION pg_temp.swt_holds(p_key TEXT) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_locks l
    WHERE l.locktype = 'advisory' AND l.pid = pg_catalog.pg_backend_pid() AND l.granted AND l.objsubid = 1
      AND l.classid::BIGINT = ((hashtextextended(p_key, 0) >> 32) & 4294967295)
      AND l.objid::BIGINT = (hashtextextended(p_key, 0) & 4294967295))
$$;
-- A person nobody has locked in this transaction (made by direct insert, so no import took the contact locks).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, email, normalized_email, phone, normalized_phone)
  VALUES (pg_temp.swt_id(8301), pg_temp.swt_id(1), 'SWT Lock Person', platform_private.normalize_person_name('SWT Lock Person'),
    'swt-lock@example.invalid', platform_private.normalize_person_email('swt-lock@example.invalid'),
    '+996 700 000 140', platform_private.normalize_person_phone('+996 700 000 140'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state)
  VALUES (pg_temp.swt_id(8302), pg_temp.swt_id(1), pg_temp.swt_id(8301), NULL, 'new', 'sales_report', 'converted');
SET LOCAL session_replication_role = origin;
SELECT (SELECT array_agg(DISTINCT v ORDER BY v) FROM unnest(platform_private.person_phone_match_keys(c.normalized_phone) || ARRAY[c.normalized_email]) v
    WHERE v IS NOT NULL) AS swt_lock_keys
  FROM platform.clients c WHERE c.id = pg_temp.swt_id(8301) \gset
SELECT pg_temp.swt_assert(cardinality(:'swt_lock_keys'::TEXT[]) >= 3 AND :'swt_lock_keys'::TEXT[] @> ARRAY['swt-lock@example.invalid']
  AND NOT EXISTS (SELECT 1 FROM unnest(:'swt_lock_keys'::TEXT[]) k
    WHERE pg_temp.swt_holds('manual-lead-contact:' || pg_temp.swt_id(1)::TEXT || ':' || k))
  AND NOT pg_temp.swt_holds('sales-report-case-client:' || pg_temp.swt_id(1)::TEXT || ':' || pg_temp.swt_id(8301)::TEXT),
  'before the call: the person''s contact keys (every spelling of the number and the e-mail) and the client lock are not held: ' || :'swt_lock_keys');
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('lk1', pg_temp.swt_id(8302), '{}'::JSONB))::TEXT AS swt_lk1 \gset
SELECT pg_temp.swt_assert(:'swt_lk1'::JSONB ->> 'status' = 'created'
  AND (SELECT bool_and(pg_temp.swt_holds('manual-lead-contact:' || pg_temp.swt_id(1)::TEXT || ':' || k)) FROM unnest(:'swt_lock_keys'::TEXT[]) k),
  'after the call: it holds the contact locks of 143 / 281 / 287 / 304 for every key of the client''s number and e-mail');
SELECT pg_temp.swt_assert(pg_temp.swt_holds('sales-report-case-client:' || pg_temp.swt_id(1)::TEXT || ':' || pg_temp.swt_id(8301)::TEXT),
  'after the call: it holds its own client lock (it covers a client without any contact)');
-- The lead row is locked (FOR UPDATE) before anything is judged: lead 8202 is a second report lead of client 3, whose case is
-- open, so the call answers case_exists and writes nothing; the row''s xmax is nobody''s before and this transaction''s after
-- (no insert of the call takes a lock on it on the way).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state)
  VALUES (pg_temp.swt_id(8202), pg_temp.swt_id(1), :'swt_client3'::UUID, NULL, 'new', 'sales_report', 'converted');
SET LOCAL session_replication_role = origin;
SELECT (SELECT l.xmax::TEXT::BIGINT FROM platform.leads l WHERE l.id = pg_temp.swt_id(8202)) AS swt_xmax_before \gset
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('lk2', pg_temp.swt_id(8202), '{}'::JSONB))::TEXT AS swt_lk2 \gset
SELECT pg_temp.swt_assert(:swt_xmax_before = 0
  AND :'swt_lk2'::JSONB ->> 'status' = 'case_exists' AND :'swt_lk2'::JSONB ->> 'student_case_id' = :'swt_case3'
  AND (SELECT l.xmax::TEXT::BIGINT = (txid_current() & 4294967295) FROM platform.leads l WHERE l.id = pg_temp.swt_id(8202)),
  'the lead row is locked by the call even when it only reports case_exists (xmax was 0, is this transaction''s now)');
-- The existing-case search is limited to the organization: a case of ANOTHER organization that points at this lead and client
-- (written with the foreign keys switched off, as no command can) is not this person''s open case.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone)
  VALUES (pg_temp.swt_id(8311), pg_temp.swt_id(1), 'SWT Org Filter Person', platform_private.normalize_person_name('SWT Org Filter Person'),
    '+996 700 000 141', platform_private.normalize_person_phone('+996 700 000 141'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state)
  VALUES (pg_temp.swt_id(8312), pg_temp.swt_id(1), pg_temp.swt_id(8311), NULL, 'new', 'sales_report', 'converted');
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.swt_id(8321), pg_temp.swt_id(2), 'student_case', pg_temp.swt_id(8320), 1);
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, source_key, student_display_name,
  target_country, target_degree, operational_stage, state, current_scope_id, current_scope_version, canonical_client_id, canonical_lead_id)
  VALUES (pg_temp.swt_id(8320), pg_temp.swt_id(2), pg_temp.swt_id(320), 'synthetic:swt:foreign', 'SWT Foreign Case', 'CN', 'Bachelor',
    'intake', 'pending', pg_temp.swt_id(8321), 1, pg_temp.swt_id(8311), pg_temp.swt_id(8312));
SET LOCAL session_replication_role = origin;
SELECT pg_temp.swt_svc_json(pg_temp.swt_case('of1', pg_temp.swt_id(8312), '{}'::JSONB))::TEXT AS swt_of1 \gset
SELECT pg_temp.swt_assert(:'swt_of1'::JSONB ->> 'status' = 'created' AND :'swt_of1'::JSONB ->> 'student_case_id' <> pg_temp.swt_id(8320)::TEXT
  AND (SELECT c.organization_id = pg_temp.swt_id(1) AND c.canonical_lead_id = pg_temp.swt_id(8312)
    FROM platform.student_cases c WHERE c.id = (:'swt_of1'::JSONB ->> 'student_case_id')::UUID)
  AND (SELECT c.organization_id = pg_temp.swt_id(2) AND c.state = 'pending' FROM platform.student_cases c WHERE c.id = pg_temp.swt_id(8320)),
  'a pending case of another organization that names this lead and client does not make it case_exists: the case is created in this organization');

-- ---------------------------------------------------------------------------
-- 7. The whole journal and the receipts after all the calls.
-- ---------------------------------------------------------------------------
-- The withdrawal principal: existing actions, a request id per receipt, no name, phone, note or source key.
SELECT pg_temp.swt_assert((SELECT count(*) >= 10 AND bool_and(a.actor_kind = 'user' AND a.action IN ('sales.register.update', 'sales.register.archive')
        AND a.resource_type = 'sales_register' AND a.actor_membership_id IN (pg_temp.swt_id(301), pg_temp.swt_id(320))
        AND EXISTS (SELECT 1 FROM platform.organization_memberships m
          WHERE m.id = a.actor_membership_id AND m.profile_id = a.actor_profile_id AND m.organization_id = a.organization_id))
    FROM platform.audit_events a WHERE a.actor_principal = 'service:sales-withdrawal')
  AND (SELECT count(*) = count(DISTINCT a.request_id) FROM platform.audit_events a WHERE a.actor_principal = 'service:sales-withdrawal'),
  'journal: every service row is a user-kind event of the Admin with an existing action, and no request id is used twice');
SELECT pg_temp.swt_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a
    WHERE a.actor_principal = 'service:sales-withdrawal'
      AND NOT EXISTS (SELECT 1 FROM platform_private.sales_withdrawal_service_receipts r
        CROSS JOIN (VALUES ('row'), ('archive')) v(op)
        WHERE r.organization_id = a.organization_id AND pg_temp.swt_op(r.external_ref, v.op, r.import_source, CASE WHEN r.organization_id = pg_temp.swt_id(2) THEN 2 ELSE 1 END) = a.request_id
          AND r.register_id = a.resource_id)),
  'journal: every request id is derived from a receipt key (uuid v5 by event name) and names the receipt''s record');
SELECT pg_temp.swt_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a
    WHERE a.actor_principal IN ('service:sales-withdrawal', 'service:sales-report-case')
      AND concat_ws(' ', a.before_state::TEXT, a.after_state::TEXT)
        ~* '(SWT S[0-9]|SWT service note|SWT before archive|SWT Case|SWT Student|SWT Mother|SWT ?Father|SWT Renamed|SWT case note|SWT Direct|SWT Foreign|swt:sheet|swt:case|example\.invalid|\+?996 ?7?00 ?000|SWT Actor)'),
  'journal: no name, phone, e-mail, note or source key in any row of the withdrawal or the case principal');
SELECT pg_temp.swt_assert(EXISTS (SELECT 1 FROM platform_private.sales_register r WHERE r.fields ->> 'applicant_name' = 'SWT S1')
  AND EXISTS (SELECT 1 FROM platform.clients c WHERE c.display_name = 'SWT Case One')
  AND EXISTS (SELECT 1 FROM platform_private.sales_register_requests q WHERE q.reason = 'SWT note R2')
  AND EXISTS (SELECT 1 FROM platform.case_notes n WHERE n.body = 'SWT case note'),
  'the markers do exist in the private tables (so the journal scan above can fail)');
SELECT pg_temp.swt_assert((SELECT count(*) = 3 AND array_agg(DISTINCT a.action ORDER BY a.action) = ARRAY['case.create', 'case.tranche.save', 'finance.payment.record']
      FROM (SELECT DISTINCT action FROM platform.audit_events WHERE actor_principal = 'service:sales-report-case') a),
  'journal: the case principal writes case.create, case.tranche.save and finance.payment.record only');
-- The receipts of the withdrawal calls.
SELECT pg_temp.swt_assert((SELECT count(*) = 15 AND bool_and(r.operation IN ('withdraw', 'archive') AND r.payload_md5 ~ '^[0-9a-f]{32}$'
        AND jsonb_typeof(r.result) = 'object' AND NOT (r.result ? 'replayed') AND jsonb_typeof(r.before_state) = 'object'
        AND r.result ->> 'operation' = r.operation AND r.result ->> 'register_id' = r.register_id::TEXT
        AND r.result ->> 'external_ref' = r.external_ref AND r.result ->> 'import_source' = r.import_source
        AND r.result ->> 'organization_id' = r.organization_id::TEXT AND r.receipt_seq IS NOT NULL
        AND EXISTS (SELECT 1 FROM platform_private.sales_register g WHERE g.id = r.register_id AND g.organization_id = r.organization_id))
    FROM platform_private.sales_withdrawal_service_receipts r)
  AND (SELECT count(*) = count(DISTINCT receipt_seq) FROM platform_private.sales_withdrawal_service_receipts)
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_withdrawal_service_receipts r WHERE r.result::TEXT ~ '(SWT |example\.invalid|swt:sheet)'),
  'receipts: operation, md5, record, ids and statuses only (no name, note or key in the stored answer), one sequence number each');
SELECT pg_temp.swt_assert((SELECT count(*) FROM platform_private.sales_withdrawal_service_receipts WHERE organization_id = pg_temp.swt_id(2)) = 2
  AND (SELECT count(*) FROM platform_private.sales_withdrawal_service_receipts WHERE organization_id = pg_temp.swt_id(1)) = 13
  AND (SELECT count(*) FROM platform_private.sales_withdrawal_service_receipts WHERE organization_id = pg_temp.swt_id(1) AND operation = 'archive') = 3
  AND (SELECT count(*) FROM platform_private.sales_withdrawal_service_receipts WHERE organization_id = pg_temp.swt_id(1)
      AND result ->> 'status' = 'unchanged') = 4
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_withdrawal_service_receipts r WHERE r.external_ref IN ('a8', 'b5', 'o2', 'g1', 'h1', 'h30')),
  'receipts: 13 in organization 1 (3 archives, 4 of them unchanged) and the other organization''s own 2; no refused call left one');
-- Append-only, and the shape the table insists on.
SELECT pg_temp.swt_assert(pg_temp.swt_error('UPDATE platform_private.sales_withdrawal_service_receipts SET external_ref = ''forged''') LIKE '55000:%append-only%'
  AND pg_temp.swt_error('DELETE FROM platform_private.sales_withdrawal_service_receipts') LIKE '55000:%append-only%'
  AND pg_temp.swt_error('TRUNCATE platform_private.sales_withdrawal_service_receipts') LIKE '55000:%append-only%',
  'receipts are append-only: UPDATE, DELETE and TRUNCATE are refused even to the owner');
SELECT pg_temp.swt_assert(NOT EXISTS (SELECT 1 FROM platform_private.sales_withdrawal_service_receipts WHERE external_ref = 'forged')
  AND (SELECT count(*) = 15 FROM platform_private.sales_withdrawal_service_receipts),
  'the refused rewrites left the receipts as they were');
CREATE FUNCTION pg_temp.swt_ins(p_operation TEXT, p_source TEXT, p_ref TEXT, p_actor INTEGER, p_md5 TEXT, p_register INTEGER, p_result TEXT,
  p_before TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.swt_error(format('INSERT INTO platform_private.sales_withdrawal_service_receipts (organization_id, operation, import_source, external_ref,
    actor_membership_id, payload_md5, register_id, result, before_state) VALUES (%L, %L, %L, %L, %L, %L, %L, %L::JSONB, %L::JSONB)',
    pg_temp.swt_id(1), p_operation, p_source, p_ref, pg_temp.swt_id(p_actor), p_md5, pg_temp.swt_id(p_register), p_result, p_before))
$$;
SELECT pg_temp.swt_assert(r.answer LIKE r.expected, 'receipts: ' || r.what || ' -> ' || r.answer)
FROM (VALUES
  ('a missing before_state', '23502:%', pg_temp.swt_ins('withdraw', 'swt-x', 'x1', 301, repeat('a', 32), 6001, '{}', NULL)),
  ('the key of a1 again', '23505:%', pg_temp.swt_ins('withdraw', 'swt-withdraw', 'a1', 301, repeat('a', 32), 6001, '{}', '{}')),
  ('an unknown operation', '23514:%', pg_temp.swt_ins('delete', 'swt-x', 'x2', 301, repeat('a', 32), 6001, '{}', '{}')),
  ('an md5 in capitals', '23514:%', pg_temp.swt_ins('withdraw', 'swt-x', 'x3', 301, repeat('A', 32), 6001, '{}', '{}')),
  ('an import source in capitals', '23514:%', pg_temp.swt_ins('withdraw', 'Swt-X', 'x4', 301, repeat('a', 32), 6001, '{}', '{}')),
  ('a result that is not an object', '23514:%', pg_temp.swt_ins('withdraw', 'swt-x', 'x5', 301, repeat('a', 32), 6001, '[]', '{}')),
  ('an actor of another organization', '23503:%', pg_temp.swt_ins('withdraw', 'swt-x', 'x6', 320, repeat('a', 32), 6001, '{}', '{}')),
  ('a record of another organization', '23503:%', pg_temp.swt_ins('withdraw', 'swt-x', 'x7', 301, repeat('a', 32), 6031, '{}', '{}'))
) AS r(what, expected, answer);
-- The register's own constraints on the mark (written by hand, as the owner, to prove the table refuses nonsense).
CREATE FUNCTION pg_temp.swt_mark_row(p_kind TEXT, p_at TIMESTAMPTZ, p_by INTEGER, p_note TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.swt_error(format('UPDATE platform_private.sales_register SET withdrawal_kind = %L, withdrawn_at = %L, withdrawn_by_membership_id = %L,
    withdrawal_note = %L WHERE id = %L', p_kind, p_at, CASE WHEN p_by IS NULL THEN NULL ELSE pg_temp.swt_id(p_by) END, p_note, pg_temp.swt_id(6004)))
$$;
SELECT pg_temp.swt_assert(r.answer LIKE r.expected, 'sales_register: ' || r.what || ' -> ' || r.answer)
FROM (VALUES
  ('a kind that is not partial or unpaid', '23514:%sales_register_withdrawal_kind%', pg_temp.swt_mark_row('refused', now(), 301, NULL)),
  ('a kind without its time and marker', '23514:%sales_register_withdrawal_shape%', pg_temp.swt_mark_row('partial', NULL, NULL, NULL)),
  ('a time without a kind', '23514:%sales_register_withdrawal_shape%', pg_temp.swt_mark_row(NULL, now(), NULL, NULL)),
  ('a marker without a kind', '23514:%sales_register_withdrawal_shape%', pg_temp.swt_mark_row(NULL, NULL, 301, NULL)),
  ('a note without a kind', '23514:%sales_register_withdrawal_shape%', pg_temp.swt_mark_row(NULL, NULL, NULL, 'SWT note')),
  ('an empty note on a mark', '23514:%sales_register_withdrawal_shape%', pg_temp.swt_mark_row('partial', now(), 301, '')),
  ('a note of 501 characters', '23514:%sales_register_withdrawal_shape%', pg_temp.swt_mark_row('partial', now(), 301, repeat('n', 501))),
  ('a note with a control character', '23514:%sales_register_withdrawal_shape%', pg_temp.swt_mark_row('partial', now(), 301, 'SWT' || chr(1))),
  ('a marker who belongs to another organization', '23503:%sales_register_withdrawn_by_fkey%', pg_temp.swt_mark_row('partial', now(), 320, NULL)),
  ('a whole mark is accepted', 'ok', pg_temp.swt_mark_row('unpaid', now(), 301, 'SWT ok'))
) AS r(what, expected, answer);
UPDATE platform_private.sales_register SET withdrawal_kind = NULL, withdrawn_at = NULL, withdrawn_by_membership_id = NULL, withdrawal_note = NULL WHERE id = pg_temp.swt_id(6004);

SELECT 'SWT_SALES_REPORT_WITHDRAWAL_SUITE_PASSED' AS swt_suite_marker;
ROLLBACK;
