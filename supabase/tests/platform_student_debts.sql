\set ON_ERROR_STOP on
-- Boundary suite for migration 332 «Долги студентов» (вкладка страницы «Финансы», решение владельца 06.11.2026).
-- Runs on the real chain right after 332 inside one transaction that is rolled back, with its own synthetic organizations,
-- members and roles (the roles are made and assigned through the REAL platform.staff_role_command / staff_role_publish /
-- staff_role_assignments_save; sessions are the real custom_access_token_hook claims). No real person, no real amount.
--
-- Proves:
--  1. catalog and grants: platform.student_debts_v1 is SECURITY DEFINER with an empty search_path, STABLE, EXECUTE for
--     authenticated only (not PUBLIC, anon, service_role, supabase_auth_admin, evo_ai_agent);
--  2. who reads: the system Admin and a holder of finance.read.full over the WHOLE organization; the same right with the
--     scope own, a reader of the sales report without finance, a Student, a member without a role, another organization's
--     Admin (asking for this organization), a NULL organization, anon, service_role and a session without claims are refused
--     with 42501;
--  3. the numbers: cost = sum of payment_obligations.amount_minor per case and currency, paid = payments - refunds from
--     payment_events, debt = cost - paid; only debt > 0; a fully paid case and a refund-adjusted case are right; a case with
--     debts in two currencies gives two rows and the currencies are never added; a case with no payments owes its whole cost;
--     rows go by debt descending; the curator is the display name (NULL without a curator); another organization's debts never
--     appear; totals per currency count every case;
--  4. read only: no row in the three tables changes and the function is STABLE;
--  5. the limit: 500 rows at most, `truncated` true with the true case count, totals over all cases.
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;
DO $t332_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t332_auth_role$;

\echo T332_STUDENT_DEBTS_SUITE_START

CREATE FUNCTION pg_temp.t332_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('33200000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t332_id(INTEGER) TO authenticated;
CREATE FUNCTION pg_temp.t332_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T332: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.t332_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE); v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    result := jsonb_build_object('error', v_state, 'message', v_message);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
CREATE FUNCTION pg_temp.t332_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT p_result ->> 'error' $$;
CREATE TEMP TABLE t332_claims(actor INTEGER PRIMARY KEY, claims TEXT);
-- A read: actor, organization number (0 = NULL organization).
CREATE FUNCTION pg_temp.t332_read(p_actor INTEGER, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t332_call('authenticated', (SELECT claims FROM t332_claims WHERE actor = p_actor),
    format('SELECT platform.student_debts_v1(%L)', CASE WHEN p_org = 0 THEN NULL ELSE pg_temp.t332_id(p_org) END))
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 and 2.
--   actor 1 org 1 Admin (system admin)      actor 2 org 1 accountant: finance.read.full, scope organization
--   actor 3 org 1 finance.read.full, scope own   actor 4 org 1 sales report reader (lead.read, sales.register.read)
--   actor 5 org 1 Student                   actor 6 org 1 member without a role (also the curator of the cases)
--   actor 7 org 2 Admin (system admin)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t332_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO t332_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, NULL, FALSE), (4, 1, NULL, FALSE),
  (5, 1, 'student', FALSE), (6, 1, NULL, FALSE), (7, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t332_id(1), 'T332 Fictional organization', 'active'), (pg_temp.t332_id(2), 'T332 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t332_id(100 + n), 't332-' || n || '@example.invalid', '{}'::JSONB FROM t332_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t332_id(200 + n), pg_temp.t332_id(100 + n), 'T332 Actor ' || n, 'active', 1 FROM t332_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t332_id(300 + a.n), pg_temp.t332_id(a.org), pg_temp.t332_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t332_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t332_id(300 + n) FROM t332_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t332_id(401), pg_temp.t332_id(1), 'organization', pg_temp.t332_id(1), 1),
  (pg_temp.t332_id(402), pg_temp.t332_id(2), 'organization', pg_temp.t332_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t332_id(1), pg_temp.t332_id(301), pg_temp.t332_id(401), 1, 1, TRUE, 'system', 'T332 synthetic scope', pg_temp.t332_id(601)),
  (pg_temp.t332_id(2), pg_temp.t332_id(307), pg_temp.t332_id(402), 1, 1, TRUE, 'system', 'T332 synthetic scope', pg_temp.t332_id(602));

CREATE TEMP TABLE t332_roles(role_id UUID PRIMARY KEY, org INTEGER, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO t332_roles VALUES
  (pg_temp.t332_id(1101), 1, 'Full finance', '["finance.read.full"]', 1110),
  (pg_temp.t332_id(1102), 1, 'Sales report', '["lead.read", "sales.register.read"]', 1120);
CREATE TEMP TABLE t332_grants(org INTEGER, actor INTEGER, role_id UUID, scope JSONB);
INSERT INTO t332_grants VALUES
  (1, 2, pg_temp.t332_id(1101), jsonb_build_object('kind', 'organization', 'key', pg_temp.t332_id(1)::TEXT, 'resourceKind', NULL)),
  (1, 3, pg_temp.t332_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
  (1, 4, pg_temp.t332_id(1102), jsonb_build_object('kind', 'organization', 'key', pg_temp.t332_id(1)::TEXT, 'resourceKind', NULL));
CREATE TEMP TABLE t332_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id IN (pg_temp.t332_id(1), pg_temp.t332_id(2));
GRANT SELECT ON t332_roles, t332_grants, t332_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t332_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t332_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t332_admin1_setup \gset
SELECT set_config('t332.admin1', :'t332_admin1_setup', TRUE) IS NOT NULL AS t332_cfg \gset
DO $t332_roles$
DECLARE r RECORD; g RECORD; published JSONB; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB; saved TEXT;
BEGIN
  saved := current_setting('request.jwt.claims', TRUE);
  FOR r IN SELECT * FROM t332_roles ORDER BY request_base LOOP
    PERFORM set_config('request.jwt.claims', current_setting('t332.admin1', TRUE), TRUE);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM platform.staff_role_command(pg_temp.t332_id(r.org), r.role_id, 0, 'create',
      jsonb_build_object('label', 'T332 ' || r.label, 'description', 'Migration 332 synthetic role', 'permissionKeys', r.keys),
      'T332 create role', pg_temp.t332_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.t332_id(r.org), r.role_id, 1,
      platform.staff_role_impact(pg_temp.t332_id(r.org), r.role_id, 1) ->> 'impactFingerprint',
      'T332 publish role', pg_temp.t332_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
    EXECUTE 'RESET ROLE';
  END LOOP;
  FOR g IN SELECT DISTINCT org, actor FROM t332_grants ORDER BY org, actor LOOP
    PERFORM set_config('request.jwt.claims', current_setting('t332.admin1', TRUE), TRUE);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT jsonb_agg(jsonb_build_object('roleId', x.role_id, 'scope', x.scope) ORDER BY x.role_id),
      jsonb_agg(jsonb_build_object('roleId', x.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> x.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY x.role_id)
      INTO items, bindings FROM t332_grants x WHERE x.org = g.org AND x.actor = g.actor;
    PERFORM platform.staff_role_assignments_save(pg_temp.t332_id(g.org), pg_temp.t332_id(300 + g.actor),
      (SELECT access_version FROM t332_versions WHERE membership_id = pg_temp.t332_id(300 + g.actor)), items, bindings,
      'T332 grant role', pg_temp.t332_id(2000 + g.actor));
    EXECUTE 'RESET ROLE';
  END LOOP;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
END
$t332_roles$;
INSERT INTO t332_claims(actor, claims)
  SELECT a.n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t332_id(100 + a.n),
    'claims', jsonb_build_object('sub', pg_temp.t332_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM t332_actors a;

-- Student cases, obligations and payments (direct rows: the suite proves the read, not the write path; triggers are off for these inserts).
SET LOCAL session_replication_role = replica;
CREATE FUNCTION pg_temp.t332_case(p_n INTEGER, p_org INTEGER, p_name TEXT, p_country TEXT, p_direction TEXT, p_curator INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
    VALUES (pg_temp.t332_id(500000 + p_n), pg_temp.t332_id(p_org), 'student_case', pg_temp.t332_id(p_n), 1);
  INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
    source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at,
    current_scope_id, current_scope_version)
  VALUES (pg_temp.t332_id(p_n), pg_temp.t332_id(p_org), pg_temp.t332_id(CASE WHEN p_org = 1 THEN 302 ELSE 307 END),
    CASE WHEN p_curator IS NULL THEN NULL ELSE pg_temp.t332_id(300 + p_curator) END,
    'synthetic:t332:' || p_n, p_name, p_country, 'Bachelor', p_direction, 'contract_confirmed',
    CASE WHEN p_curator IS NULL THEN 'pending' ELSE 'active' END::platform.student_case_state,
    CASE WHEN p_curator IS NULL THEN NULL ELSE TIMESTAMPTZ '2026-09-11 11:00+06' END,
    pg_temp.t332_id(500000 + p_n), 1);
END
$$;
CREATE FUNCTION pg_temp.t332_obligation(p_n INTEGER, p_case INTEGER, p_org INTEGER, p_amount BIGINT, p_currency TEXT, p_paid BIGINT, p_refunded BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO platform.payment_obligations(id, organization_id, student_case_id, label, category, amount_minor, currency, due_at, next_action,
    total_paid_minor, total_refunded_minor, created_by_membership_id)
  VALUES (pg_temp.t332_id(600000 + p_n), pg_temp.t332_id(p_org), pg_temp.t332_id(p_case), 'T332 contract', 'evo_service_fee', p_amount, p_currency,
    '2026-09-12 10:00+06', 'T332 collect', p_paid, p_refunded, pg_temp.t332_id(CASE WHEN p_org = 1 THEN 302 ELSE 307 END));
END
$$;
CREATE FUNCTION pg_temp.t332_event(p_n INTEGER, p_obligation INTEGER, p_case INTEGER, p_org INTEGER, p_type TEXT, p_amount BIGINT, p_currency TEXT, p_ref INTEGER DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO platform.payment_events(id, organization_id, student_case_id, payment_obligation_id, event_type, referenced_payment_event_id, amount_minor, currency, occurred_at,
    source_key, actor_membership_id, request_id)
  VALUES (pg_temp.t332_id(700000 + p_n), pg_temp.t332_id(p_org), pg_temp.t332_id(p_case), pg_temp.t332_id(600000 + p_obligation), p_type::platform.payment_event_type,
    CASE WHEN p_ref IS NULL THEN NULL ELSE pg_temp.t332_id(700000 + p_ref) END, p_amount, p_currency, '2026-09-12 12:00+06', 't332-synthetic', pg_temp.t332_id(CASE WHEN p_org = 1 THEN 302 ELSE 307 END), pg_temp.t332_id(800000 + p_n));
END
$$;
-- C1 owes 3000.00 USD (cost 5000.00, paid 2000.00); C2: USD fully paid, KGS owes 600.00; C3: refund brings 200.00 USD of debt back;
-- C4 fully paid; C5 (no curator) owes its whole 1000.00 USD; C6: other organization owes 9999.00 USD.
SELECT pg_temp.t332_case(1, 1, 'T332 Student One', 'CN', 'Engineering', 6);
SELECT pg_temp.t332_case(2, 1, 'T332 Student Two', 'MY', 'Medicine', 6);
SELECT pg_temp.t332_case(3, 1, 'T332 Student Three', 'CN', NULL, 6);
SELECT pg_temp.t332_case(4, 1, 'T332 Student Four', 'CN', 'Law', 6);
SELECT pg_temp.t332_case(5, 1, 'T332 Student Five', 'KG', 'Arts', NULL);
SELECT pg_temp.t332_case(6, 2, 'T332 Other Org Student', 'CN', 'Law', NULL);
SELECT pg_temp.t332_obligation(1, 1, 1, 500000, 'USD', 200000, 0);
SELECT pg_temp.t332_event(1, 1, 1, 1, 'payment', 200000, 'USD');
SELECT pg_temp.t332_obligation(2, 2, 1, 100000, 'USD', 100000, 0);
SELECT pg_temp.t332_event(2, 2, 2, 1, 'payment', 100000, 'USD');
SELECT pg_temp.t332_obligation(3, 2, 1, 90000, 'KGS', 30000, 0);
SELECT pg_temp.t332_event(3, 3, 2, 1, 'payment', 30000, 'KGS');
SELECT pg_temp.t332_obligation(4, 3, 1, 100000, 'USD', 100000, 20000);
SELECT pg_temp.t332_event(4, 4, 3, 1, 'payment', 100000, 'USD');
SELECT pg_temp.t332_event(5, 4, 3, 1, 'refund', 20000, 'USD', 4);
SELECT pg_temp.t332_obligation(5, 4, 1, 50000, 'USD', 50000, 0);
SELECT pg_temp.t332_event(6, 5, 4, 1, 'payment', 50000, 'USD');
SELECT pg_temp.t332_obligation(6, 5, 1, 100000, 'USD', 0, 0);
SELECT pg_temp.t332_obligation(7, 6, 2, 999900, 'USD', 0, 0);
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t332_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND p.provolatile = 's'
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    FROM pg_proc p WHERE p.oid = 'platform.student_debts_v1(uuid)'::regprocedure),
  'the function: SECURITY DEFINER, STABLE, empty search_path, owner postgres, EXECUTE for authenticated only');
SELECT pg_temp.t332_assert((SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname = 'student_debts_v1'),
  'one active signature');

-- ---------------------------------------------------------------------------
-- 2. Who reads.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t332_assert(pg_temp.t332_err(pg_temp.t332_read(1)) IS NULL AND pg_temp.t332_err(pg_temp.t332_read(2)) IS NULL,
  'the Admin and the accountant (finance.read.full over the whole organization) read');
SELECT pg_temp.t332_assert(
  pg_temp.t332_err(pg_temp.t332_read(3)) = '42501' AND pg_temp.t332_err(pg_temp.t332_read(4)) = '42501'
  AND pg_temp.t332_err(pg_temp.t332_read(5)) = '42501' AND pg_temp.t332_err(pg_temp.t332_read(6)) = '42501',
  'finance.read.full with the scope own, a sales report reader, a Student and a member without a role are refused (42501)');
SELECT pg_temp.t332_assert(pg_temp.t332_err(pg_temp.t332_read(7, 1)) = '42501' AND pg_temp.t332_err(pg_temp.t332_read(1, 2)) = '42501'
  AND pg_temp.t332_err(pg_temp.t332_read(1, 0)) = '42501' AND pg_temp.t332_err(pg_temp.t332_read(2, 2)) = '42501',
  'a foreign or NULL organization is refused even for an Admin of the other organization');
SELECT pg_temp.t332_assert(
  pg_temp.t332_err(pg_temp.t332_call('anon', '{"role":"anon"}', format('SELECT platform.student_debts_v1(%L)', pg_temp.t332_id(1)))) IS NOT NULL
  AND pg_temp.t332_err(pg_temp.t332_call('service_role', '{"role":"service_role"}', format('SELECT platform.student_debts_v1(%L)', pg_temp.t332_id(1)))) IS NOT NULL
  AND pg_temp.t332_err(pg_temp.t332_call('authenticated', '', format('SELECT platform.student_debts_v1(%L)', pg_temp.t332_id(1)))) IS NOT NULL,
  'anon, service_role and a session without claims cannot read');

-- ---------------------------------------------------------------------------
-- 3. The numbers.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t332_before AS SELECT
  (SELECT count(*) FROM platform.student_cases) cases, (SELECT count(*) FROM platform.payment_obligations) obligations,
  (SELECT count(*) FROM platform.payment_events) events, (SELECT coalesce(sum(total_paid_minor), 0) FROM platform.payment_obligations) paid;
SELECT pg_temp.t332_read(2)::TEXT AS t332_debts \gset
SELECT pg_temp.t332_assert((:'t332_debts'::JSONB ->> 'schema_version') = '1' AND (:'t332_debts'::JSONB ->> 'organization_id') = pg_temp.t332_id(1)::TEXT
  AND (:'t332_debts'::JSONB ->> 'truncated') = 'false' AND (:'t332_debts'::JSONB ->> 'case_row_count') = '4'
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'t332_debts'::JSONB) k) = ARRAY['case_row_count', 'organization_id', 'rows', 'schema_version', 'totals', 'truncated'],
  'the answer has exactly the six documented keys and four debt rows (C1 USD, C2 KGS, C3 USD, C5 USD)');
SELECT pg_temp.t332_assert((SELECT jsonb_agg(jsonb_build_array(r ->> 'student_name', r ->> 'currency', (r ->> 'debt_minor')::BIGINT) ORDER BY ord)
    FROM jsonb_array_elements(:'t332_debts'::JSONB -> 'rows') WITH ORDINALITY x(r, ord))
  = '[["T332 Student One", "USD", 300000], ["T332 Student Five", "USD", 100000], ["T332 Student Two", "KGS", 60000], ["T332 Student Three", "USD", 20000]]'::JSONB,
  'rows go by debt descending; a fully paid case (C4) and the USD part of C2 are not there; the refund of C3 brings 200.00 back; C5 owes its whole cost; the other organization is absent');
SELECT pg_temp.t332_assert((SELECT r ->> 'curator' FROM jsonb_array_elements(:'t332_debts'::JSONB -> 'rows') r WHERE r ->> 'student_name' = 'T332 Student One') = 'T332 Actor 6'
  AND (SELECT r -> 'curator' FROM jsonb_array_elements(:'t332_debts'::JSONB -> 'rows') r WHERE r ->> 'student_name' = 'T332 Student Five') = 'null'::JSONB
  AND (SELECT r -> 'direction' FROM jsonb_array_elements(:'t332_debts'::JSONB -> 'rows') r WHERE r ->> 'student_name' = 'T332 Student Three') = 'null'::JSONB
  AND (SELECT r ->> 'country' FROM jsonb_array_elements(:'t332_debts'::JSONB -> 'rows') r WHERE r ->> 'student_name' = 'T332 Student Two') = 'MY'
  AND (SELECT r ->> 'case_id' FROM jsonb_array_elements(:'t332_debts'::JSONB -> 'rows') r WHERE r ->> 'student_name' = 'T332 Student One') = pg_temp.t332_id(1)::TEXT,
  'the curator is the display name (null without one), direction may be null, country and the case id are carried');
SELECT pg_temp.t332_assert((SELECT jsonb_agg(jsonb_build_array(r ->> 'currency', (r ->> 'cost_minor')::BIGINT, (r ->> 'paid_minor')::BIGINT, (r ->> 'debt_minor')::BIGINT) ORDER BY r ->> 'student_name', r ->> 'currency')
    FROM jsonb_array_elements(:'t332_debts'::JSONB -> 'rows') r)
  = '[["USD", 100000, 0, 100000], ["USD", 500000, 200000, 300000], ["USD", 100000, 80000, 20000], ["KGS", 90000, 30000, 60000]]'::JSONB
  AND (SELECT bool_and((r ->> 'cost_minor')::BIGINT - (r ->> 'paid_minor')::BIGINT = (r ->> 'debt_minor')::BIGINT AND (r ->> 'debt_minor')::BIGINT > 0) FROM jsonb_array_elements(:'t332_debts'::JSONB -> 'rows') r),
  'cost - paid = debt > 0 on every row; paid is payments minus refunds');
SELECT pg_temp.t332_assert(:'t332_debts'::JSONB -> 'totals'
  = '[{"currency":"KGS","cost_minor":90000,"paid_minor":30000,"debt_minor":60000,"case_count":1},{"currency":"USD","cost_minor":700000,"paid_minor":280000,"debt_minor":420000,"case_count":3}]'::JSONB,
  'totals per currency, never added across currencies, over every case with a debt');
SELECT pg_temp.t332_assert(:'t332_debts'::TEXT = pg_temp.t332_read(1)::TEXT, 'the Admin and the accountant see the same answer');

-- ---------------------------------------------------------------------------
-- 4. Read only.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t332_assert((SELECT cases = (SELECT count(*) FROM platform.student_cases) AND obligations = (SELECT count(*) FROM platform.payment_obligations)
    AND events = (SELECT count(*) FROM platform.payment_events) AND paid = (SELECT coalesce(sum(total_paid_minor), 0) FROM platform.payment_obligations) FROM t332_before),
  'the read changed no case, obligation or payment');
SELECT pg_temp.t332_assert(pg_temp.t332_read(1, 2) ->> 'error' = '42501', 'the other organization''s numbers are not reachable from this one and vice versa');
SELECT pg_temp.t332_assert(pg_temp.t332_read(7, 2) ->> 'case_row_count' = '1' AND pg_temp.t332_read(7, 2) -> 'totals' -> 0 = '{"currency": "USD", "cost_minor": 999900, "paid_minor": 0, "debt_minor": 999900, "case_count": 1}'::JSONB,
  'the other organization''s Admin reads only its own debt');

-- ---------------------------------------------------------------------------
-- 5. The limit: 505 more cases with a debt - 500 rows, truncated, the true count, totals over all.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.t332_id(510000 + g), pg_temp.t332_id(1), 'student_case', pg_temp.t332_id(10000 + g), 1 FROM generate_series(1, 505) g;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, source_key, student_display_name, target_country, target_degree,
  operational_stage, state, handoff_at, current_scope_id, current_scope_version)
  SELECT pg_temp.t332_id(10000 + g), pg_temp.t332_id(1), pg_temp.t332_id(302), 'synthetic:t332:bulk:' || g, 'T332 Bulk ' || g, 'CN', 'Bachelor',
    'contract_confirmed', 'pending', NULL, pg_temp.t332_id(510000 + g), 1 FROM generate_series(1, 505) g;
INSERT INTO platform.payment_obligations(id, organization_id, student_case_id, label, category, amount_minor, currency, due_at, next_action, total_paid_minor, created_by_membership_id)
  SELECT pg_temp.t332_id(620000 + g), pg_temp.t332_id(1), pg_temp.t332_id(10000 + g), 'T332 bulk', 'evo_service_fee', 1000 + g, 'EUR', '2026-09-12 10:00+06', 'T332 collect', 0, pg_temp.t332_id(302)
  FROM generate_series(1, 505) g;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.t332_read(1)::TEXT AS t332_big \gset
SELECT pg_temp.t332_assert(jsonb_array_length(:'t332_big'::JSONB -> 'rows') = 500 AND (:'t332_big'::JSONB ->> 'truncated') = 'true' AND (:'t332_big'::JSONB ->> 'case_row_count') = '509'
  AND (SELECT (t ->> 'case_count')::INTEGER = 505 AND (t ->> 'debt_minor')::BIGINT = (SELECT sum(1000 + g) FROM generate_series(1, 505) g)
      FROM jsonb_array_elements(:'t332_big'::JSONB -> 'totals') t WHERE t ->> 'currency' = 'EUR')
  AND (:'t332_big'::JSONB -> 'rows' -> 0 ->> 'student_name') = 'T332 Student One'
  AND (SELECT bool_and((x.r ->> 'debt_minor')::BIGINT >= (y.r ->> 'debt_minor')::BIGINT)
      FROM jsonb_array_elements(:'t332_big'::JSONB -> 'rows') WITH ORDINALITY x(r, i) JOIN jsonb_array_elements(:'t332_big'::JSONB -> 'rows') WITH ORDINALITY y(r, i) ON y.i = x.i + 1),
  'at most 500 rows, truncated true, the true case count 509 (4 + 505), totals count every case, still ordered by debt');

\echo A332_STUDENT_DEBTS_SUITE_PASSED
ROLLBACK;
