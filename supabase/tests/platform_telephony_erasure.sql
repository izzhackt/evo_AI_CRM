\set ON_ERROR_STOP on
-- Boundary suite for the T11a migration «Телефония Beeline KG» срез T11a (стирание
-- телефонии по человеку и очистка доказательств по сроку;
-- docs/EVO_TELEPHONY_PLAN_2026-10-16.md §13, §16; ADR 0033; PLAN_CHANGES
-- «Телефония T11a»). Runs on the real chain right after that migration inside one
-- transaction that is rolled back, with its own synthetic organizations,
-- members, clients, leads, PBX users and messages (the calls come through the
-- real intake, platform.telephony_receive_v1): no provider, no real person, no
-- real phone, no recording, no production action. The public functions are
-- called through the same request.jwt.claims role gate the service path uses.
--
-- Proves:
--  1. catalog and grants: exactly eleven platform.telephony_*_v1 functions (the
--     four of T1b, the five of T4a and the two of T11a), SECURITY DEFINER, empty
--     search_path, owner postgres, EXECUTE only for service_role; the private
--     helpers closed to PUBLIC and the five client roles (the earlier
--     twenty-nine of T1a, T1b, T2 and T4a and the six of T11a); anon, authenticated,
--     supabase_auth_admin, the AI agent role and a service_role without the
--     service claim are refused with 42501 on both new functions; the receipt
--     table is FORCE RLS with no policy and no grant, and the five client roles
--     are refused on it;
--  2. the key column: telephony_pbx_events.phone_match_keys is a STORED generated
--     column filled for every stored row (the intake is unchanged); the same
--     number in every spelling the client match knows gives the same keys, an
--     extension, an unreadable number, a rejected form and NULL give none, the
--     key function never raises, and a GIN index serves the search;
--  3. the lock: UPDATE and DELETE of the evidence and the chronology stay refused
--     (55000, the text of the shared guard), TRUNCATE stays on the shared guard;
--     migration 280's account-erasure bypass still opens (row DELETE only); a
--     forged, malformed, foreign-organization, finished or wrong-kind telephony
--     receipt does not open the lock, and each of those cases has a positive
--     control (the same receipt deletes the rows it may); the marker is closed
--     again after every call;
--  4. erasure by person, with an md5 snapshot of EVERY row of every table of
--     the six schemas (the pattern of migration 280's suite): by phone, client
--     and lead together, by phone alone, by client alone, by lead alone and by
--     a number nobody owns; each call removes exactly the rows of its person
--     (calls, legs, chronology, grants, task links, dial requests, evidence and
--     work) and changes no other row, including the bystander of the same
--     organization and the same number in another organization; the counts of
--     the answer equal the rows really gone and hand back the ids of the
--     platform tasks tied to the erased calls (the tasks themselves stay);
--     dry_run counts and changes nothing; a call that points at an erased call
--     loses only that link; what a lead or a number alone cannot reach is shown;
--  5. who may erase: only a named active system Admin of that organization; a
--     member of another organization, an inactive Admin, a staff member, a
--     Student and an unknown member are refused (42501) and change nothing;
--     argument errors (22023); the receipt holds the last four digits and
--     counts, never the number;
--  6. idempotency: the same request id replays the first answer and removes
--     nothing again; another shape under the same id, and a retention id used as
--     a person id (and back), are refused;
--  7. retention: evidence older than twelve months is purged in batches
--     (oldest first, has_more), evidence younger than twelve months and evidence
--     whose work is queued, leased or retrying is kept, other organizations,
--     calls, legs and the chronology are untouched; dry_run counts and changes
--     nothing; the request id replays; limits are bounded.
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

\echo T11A_TELEPHONY_ERASURE_SUITE_START

CREATE FUNCTION pg_temp.t11a_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('11a00000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t11a_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T11A: %', message; END IF;
END
$$;
-- SQLSTATE or 'ok' of one statement.
CREATE FUNCTION pg_temp.t11a_state(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;
-- SQLSTATE and message of one statement, 'ok' when it passes.
CREATE FUNCTION pg_temp.t11a_err(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The statement as a role with the given JWT claims; SQLSTATE or 'ok'.
CREATE FUNCTION pg_temp.t11a_as(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE result TEXT; saved TEXT := current_setting('request.jwt.claims', TRUE);
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
    result := 'ok';
  EXCEPTION WHEN OTHERS THEN
    result := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.t11a_hex() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT encode(sha256(gen_random_uuid()::TEXT::BYTEA), 'hex')
$$;

-- The service path: the JWT role claim the public functions check.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

-- Message builders (the real intake). Missing parts are NULL and omitted.
CREATE FUNCTION pg_temp.t11a_recv(p_cmd TEXT, p_fields JSONB, p_link TEXT DEFAULT NULL, p_org INTEGER DEFAULT 1)
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.telephony_receive_v1(pg_temp.t11a_id(p_org), gen_random_uuid(), p_cmd, 'current', pg_temp.t11a_hex(),
    jsonb_strip_nulls(p_fields), p_link, NULL)
$$;
CREATE FUNCTION pg_temp.t11a_e(p_type TEXT, p_callid TEXT, p_user TEXT, p_phone TEXT, p_dir TEXT DEFAULT 'in',
  p_extra JSONB DEFAULT '{}', p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t11a_recv('event', jsonb_build_object('cmd', 'event', 'type', p_type, 'callid', p_callid,
    'user', p_user, 'phone', p_phone, 'direction', p_dir) || p_extra, NULL, p_org)
$$;
CREATE FUNCTION pg_temp.t11a_h(p_callid TEXT, p_user TEXT, p_phone TEXT, p_type TEXT, p_status TEXT, p_start TEXT,
  p_dur INTEGER, p_wait INTEGER DEFAULT 5, p_link TEXT DEFAULT NULL, p_org INTEGER DEFAULT 1)
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t11a_recv('history', jsonb_build_object('cmd', 'history', 'type', p_type, 'callid', p_callid,
    'user', p_user, 'phone', p_phone, 'status', p_status, 'start', p_start, 'duration', p_dur, 'wait', p_wait,
    'diversion', '996312000000'), p_link, p_org)
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1: Admin (actor 1), staff with the PBX user u701
-- (actor 2), a second Admin (actor 3), an Admin made inactive (actor 6), a
-- Student (actor 7). Organization 2: Admin (actor 4), staff with u701 (actor 5).
-- People of organization 1: p1, p2, p3 (client + lead each), u (a number with no
-- client), q (a bystander); organization 2: tw, which holds p1's number.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.t11a_id(1), 'T11A Fictional organization'),
  (pg_temp.t11a_id(2), 'T11A Other fictional organization');
CREATE TEMP TABLE t11a_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO t11a_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, 'admin', TRUE), (4, 2, 'admin', TRUE),
  (5, 2, NULL, FALSE), (6, 1, 'admin', TRUE), (7, 1, 'student', FALSE);
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t11a_id(100 + n), 't11a-' || n || '@example.invalid', '{}'::JSONB FROM t11a_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t11a_id(200 + n), pg_temp.t11a_id(100 + n), 'T11A Actor ' || n, 'active', 1 FROM t11a_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t11a_id(300 + a.n), pg_temp.t11a_id(a.org), pg_temp.t11a_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t11a_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t11a_id(300 + n) FROM t11a_actors WHERE sysadmin);
UPDATE platform.organization_memberships SET status = 'inactive' WHERE id = pg_temp.t11a_id(306);
INSERT INTO platform_private.telephony_extensions(organization_id, pbx_user, extension, pbx_display_name, membership_id) VALUES
  (pg_temp.t11a_id(1), 'u701', '701', 'T11A PBX user 1', pg_temp.t11a_id(302)),
  (pg_temp.t11a_id(1), 'u702', '702', 'T11A PBX user 2', NULL),
  (pg_temp.t11a_id(2), 'u701', '701', 'T11A PBX user 1 (other organization)', pg_temp.t11a_id(305));
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled)
  VALUES (pg_temp.t11a_id(1), TRUE), (pg_temp.t11a_id(2), TRUE);

INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state) VALUES
  (pg_temp.t11a_id(711), pg_temp.t11a_id(1), 'T11A Client P1', platform_private.normalize_person_name('T11A Client P1'),
    '+996555291001', platform_private.normalize_person_phone('+996555291001'), 'active'),
  (pg_temp.t11a_id(721), pg_temp.t11a_id(1), 'T11A Client P2', platform_private.normalize_person_name('T11A Client P2'),
    '+996555291002', platform_private.normalize_person_phone('+996555291002'), 'active'),
  (pg_temp.t11a_id(731), pg_temp.t11a_id(1), 'T11A Client P3', platform_private.normalize_person_name('T11A Client P3'),
    '+996555291003', platform_private.normalize_person_phone('+996555291003'), 'active'),
  (pg_temp.t11a_id(791), pg_temp.t11a_id(1), 'T11A Client Q', platform_private.normalize_person_name('T11A Client Q'),
    '+996555291099', platform_private.normalize_person_phone('+996555291099'), 'active'),
  (pg_temp.t11a_id(811), pg_temp.t11a_id(2), 'T11A Client TW', platform_private.normalize_person_name('T11A Client TW'),
    '+996555291001', platform_private.normalize_person_phone('+996555291001'), 'active');
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state, updated_at) VALUES
  (pg_temp.t11a_id(712), pg_temp.t11a_id(1), pg_temp.t11a_id(711), pg_temp.t11a_id(302), 'new', 'website', 'open', '2031-01-01 10:00:00+00'),
  (pg_temp.t11a_id(722), pg_temp.t11a_id(1), pg_temp.t11a_id(721), pg_temp.t11a_id(302), 'new', 'website', 'open', '2031-01-01 10:00:00+00'),
  (pg_temp.t11a_id(732), pg_temp.t11a_id(1), pg_temp.t11a_id(731), pg_temp.t11a_id(302), 'new', 'website', 'open', '2031-01-01 10:00:00+00'),
  (pg_temp.t11a_id(792), pg_temp.t11a_id(1), pg_temp.t11a_id(791), pg_temp.t11a_id(302), 'new', 'website', 'open', '2031-01-01 10:00:00+00'),
  (pg_temp.t11a_id(812), pg_temp.t11a_id(2), pg_temp.t11a_id(811), pg_temp.t11a_id(305), 'new', 'website', 'open', '2031-01-01 10:00:00+00');

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t11a_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%')
  = ARRAY['telephony_claim_work_v1', 'telephony_erase_person_v1', 'telephony_integration_health_v1',
    'telephony_maintenance_plan_v1', 'telephony_project_work_v1', 'telephony_purge_evidence_v1',
    'telephony_receive_v1', 'telephony_reconcile_apply_v1', 'telephony_runtime_mark_v1', 'telephony_settle_calls_v1',
    'telephony_sync_extensions_v1'],
  'exactly eleven public telephony functions exist in platform: the four of T1b, the five of T4a and the two of T11a');
SELECT pg_temp.t11a_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 'v'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%'),
  'the public functions: SECURITY DEFINER, empty search_path, owner postgres, EXECUTE for service_role only');
SELECT pg_temp.t11a_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%')
  = ARRAY['telephony_block_mutation', 'telephony_cadence_ok', 'telephony_cadence_step_ok', 'telephony_chain_answered',
    'telephony_clean_text', 'telephony_erasure_bypass', 'telephony_erasure_counts', 'telephony_erasure_scope',
    'telephony_erasure_task_ids',
    'telephony_error_code', 'telephony_facts_ok', 'telephony_fields_ok', 'telephony_form_shape_of', 'telephony_form_shape_ok',
    'telephony_leg_state_merge', 'telephony_leg_state_rank', 'telephony_match_phone', 'telephony_names_ok',
    'telephony_parse_ts', 'telephony_phone_e164', 'telephony_phone_keys', 'telephony_place_leg', 'telephony_prefixes_ok',
    'telephony_project_event', 'telephony_projection_enabled', 'telephony_recompute_call', 'telephony_reconcile_row',
    'telephony_resolve_user', 'telephony_rights_provision', 'telephony_rights_verify',
    'telephony_status_word', 'telephony_store_rejected', 'telephony_summary_ok', 'telephony_to_int',
    'telephony_working_days_ok'],
  'the private telephony helpers are exactly the earlier twenty-nine (T1a, T1b, T2, T4a) and the six of T11a');
SELECT pg_temp.t11a_assert((SELECT bool_and(NOT has_function_privilege(r.role, p.oid, 'EXECUTE'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%')
  AND (SELECT bool_and(p.proconfig = ARRAY['search_path=""']::TEXT[] AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%'),
  'no private telephony helper is executable by PUBLIC or any client role, and each has an empty search_path');
SELECT pg_temp.t11a_assert((SELECT bool_and(pg_temp.t11a_as(r.role, c.claims, format(
        'SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''+996555291500'', NULL, NULL, TRUE)',
        pg_temp.t11a_id(1), pg_temp.t11a_id(9001), pg_temp.t11a_id(301))) = '42501'
      AND pg_temp.t11a_as(r.role, c.claims, format('SELECT platform.telephony_purge_evidence_v1(%L, %L, 10, TRUE)',
        pg_temp.t11a_id(1), pg_temp.t11a_id(9002))) = '42501')
    FROM (VALUES ('anon'), ('authenticated'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    CROSS JOIN (VALUES ('{"role":"anon"}'), ('{"role":"authenticated"}'), ('{"role":"service_role"}'), ('')) c(claims)),
  'anon, authenticated, supabase_auth_admin and the AI agent are refused on both new functions, whatever claim they carry');
SELECT pg_temp.t11a_assert(pg_temp.t11a_as('service_role', '{"role":"authenticated"}', format(
      'SELECT platform.telephony_purge_evidence_v1(%L, %L, 10, TRUE)', pg_temp.t11a_id(1), pg_temp.t11a_id(9002))) = '42501'
  AND pg_temp.t11a_as('service_role', '', format(
      'SELECT platform.telephony_purge_evidence_v1(%L, %L, 10, TRUE)', pg_temp.t11a_id(1), pg_temp.t11a_id(9002))) = '42501'
  AND pg_temp.t11a_as('service_role', '{"role":"service_role"}', format(
      'SELECT platform.telephony_purge_evidence_v1(%L, %L, 10, TRUE)', pg_temp.t11a_id(1), pg_temp.t11a_id(9002))) = 'ok'
  AND pg_temp.t11a_as('service_role', '{"role":"service_role"}', format(
      'SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''+996555291500'', NULL, NULL, TRUE)',
      pg_temp.t11a_id(1), pg_temp.t11a_id(9001), pg_temp.t11a_id(301))) = 'ok',
  'through the database role service_role only the service claim passes, and then both functions work');

-- The receipt table: FORCE RLS, no policy, no grant for any client role.
SELECT pg_temp.t11a_assert((SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c
      WHERE c.oid = 'platform_private.telephony_erasure_requests'::REGCLASS)
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'platform_private' AND tablename = 'telephony_erasure_requests')
  AND (SELECT bool_and(NOT has_table_privilege(r.role, 'platform_private.telephony_erasure_requests', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role))
  AND (SELECT bool_and(pg_temp.t11a_as(r.role, '{"role":"service_role"}', format('%s platform_private.telephony_erasure_requests %s', s.verb, s.tail)) = '42501')
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    CROSS JOIN (VALUES ('SELECT * FROM', ''), ('DELETE FROM', ''),
      ('UPDATE', 'SET summary = ''{}''::JSONB'), ('TRUNCATE', '')) s(verb, tail)),
  'the receipt table is FORCE RLS with no policy; the five client roles hold no privilege and are refused on SELECT, UPDATE, DELETE and TRUNCATE');
SELECT pg_temp.t11a_assert(pg_temp.t11a_as('authenticated', '{"role":"authenticated"}',
      'INSERT INTO platform_private.telephony_erasure_requests(organization_id, request_id, kind, retention_cutoff) SELECT id, gen_random_uuid(), ''retention'', now() FROM platform.organizations') = '42501'
  AND pg_temp.t11a_as('service_role', '{"role":"service_role"}',
      'INSERT INTO platform_private.telephony_erasure_requests(organization_id, request_id, kind, retention_cutoff) SELECT id, gen_random_uuid(), ''retention'', now() FROM platform.organizations') = '42501',
  'a client role cannot write a receipt');
-- The tables keep their lock posture: the trigger layout of the two guarded tables.
SELECT pg_temp.t11a_assert((SELECT count(*) FROM pg_trigger t
      WHERE t.tgrelid IN ('platform_private.telephony_pbx_events'::REGCLASS, 'platform_private.telephony_call_events'::REGCLASS)
        AND NOT t.tgisinternal AND t.tgfoid = 'platform_private.telephony_block_mutation()'::REGPROCEDURE
        AND (t.tgtype & 1) = 1 AND (t.tgtype & 8) = 8 AND (t.tgtype & 16) = 16 AND (t.tgtype & 2) = 2) = 2
  AND (SELECT count(*) FROM pg_trigger t
      WHERE t.tgrelid IN ('platform_private.telephony_pbx_events'::REGCLASS, 'platform_private.telephony_call_events'::REGCLASS)
        AND NOT t.tgisinternal AND t.tgfoid = 'platform_private.block_append_only_mutation()'::REGPROCEDURE
        AND (t.tgtype & 1) = 0 AND (t.tgtype & 32) = 32) = 2
  AND (SELECT count(*) FROM pg_trigger t
      WHERE t.tgrelid IN ('platform_private.telephony_pbx_events'::REGCLASS, 'platform_private.telephony_call_events'::REGCLASS)
        AND NOT t.tgisinternal) = 4,
  'each guarded table has exactly one BEFORE UPDATE OR DELETE row trigger on the telephony guard and one TRUNCATE trigger on the shared guard');

-- ---------------------------------------------------------------------------
-- 2. Phone keys and the generated column.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t11a_assert((SELECT a.attgenerated = 's' FROM pg_attribute a
      WHERE a.attrelid = 'platform_private.telephony_pbx_events'::REGCLASS AND a.attname = 'phone_match_keys' AND NOT a.attisdropped)
  AND (SELECT pg_get_expr(d.adbin, d.adrelid) LIKE '%telephony_phone_keys%' FROM pg_attrdef d
      WHERE d.adrelid = 'platform_private.telephony_pbx_events'::REGCLASS
        AND d.adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = d.adrelid AND attname = 'phone_match_keys'))
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'platform_private' AND tablename = 'telephony_pbx_events'
      AND indexname = 'telephony_pbx_events_phone_keys_idx' AND indexdef LIKE '%USING gin (phone_match_keys)%')
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'platform_private' AND tablename = 'telephony_dial_requests'
      AND indexname = 'telephony_dial_requests_phone_idx'),
  'phone_match_keys is a STORED generated column over fields.phone, served by a GIN index; dial requests are indexed by number');
SELECT pg_temp.t11a_assert(platform_private.telephony_phone_keys('996555291001') = platform_private.telephony_phone_keys('+996555291001')
  AND platform_private.telephony_phone_keys('+996 (555) 291-001') = platform_private.telephony_phone_keys('0555291001')
  AND platform_private.telephony_phone_keys('00996555291001') = platform_private.telephony_phone_keys('996555291001')
  AND platform_private.telephony_phone_keys('996555291001') @> ARRAY['+996555291001', '996555291001', '00996555291001',
    '0555291001', '+9960555291001', '9960555291001', '555291001']
  AND platform_private.telephony_phone_keys('+996555291001') <@ platform_private.telephony_phone_keys('996555291001'),
  'every spelling of one Kyrgyz number gives the keys of the client match (E.164, digits, 00, national 0, +996 0, 996 0, nine digits)');
SELECT pg_temp.t11a_assert(platform_private.telephony_phone_keys('12025550142') @> ARRAY['+12025550142', '12025550142', '0012025550142']
  AND NOT (platform_private.telephony_phone_keys('12025550142') && platform_private.telephony_phone_keys('996555291001'))
  AND NOT (platform_private.telephony_phone_keys('996555291001') && platform_private.telephony_phone_keys('996555291002')),
  'a foreign number gets its own keys and different numbers share none');
SELECT pg_temp.t11a_assert(platform_private.telephony_phone_keys(NULL) = ARRAY[]::TEXT[]
  AND platform_private.telephony_phone_keys('') = ARRAY[]::TEXT[]
  AND platform_private.telephony_phone_keys('701') = ARRAY[]::TEXT[]
  AND platform_private.telephony_phone_keys('anonymous') = ARRAY[]::TEXT[]
  AND platform_private.telephony_phone_keys('+7 701 123 45 67 ext 2') = ARRAY[]::TEXT[]
  AND platform_private.telephony_phone_keys(repeat('9', 5000)) = ARRAY[]::TEXT[]
  AND platform_private.telephony_phone_keys(E'99655529\x01') = ARRAY[]::TEXT[]
  AND platform_private.telephony_phone_keys(repeat('(', 100000)) = ARRAY[]::TEXT[],
  'NULL, empty, an extension, a word, a number with a tail, an over-long string and control characters give no keys and never raise');
SELECT pg_temp.t11a_assert(platform_private.telephony_phone_keys('996555291001') = (SELECT array_agg(DISTINCT k ORDER BY k)
      FROM unnest(platform_private.telephony_phone_keys('996555291001')) k),
  'the keys are distinct and sorted');

-- ---------------------------------------------------------------------------
-- Calls through the real intake. For one person: an answered incoming call with
-- a recording link, a missed one, a transferred pair (the second call answers its
-- own messages), an outgoing call from a dial request, a refused dial request, a
-- recording grant, two task links and one evidence row that carries only the
-- number.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t11a_dials(label TEXT NOT NULL, id UUID NOT NULL, refused BOOLEAN NOT NULL);
CREATE TEMP TABLE t11a_extra_ev(label TEXT NOT NULL, id UUID NOT NULL);
CREATE TEMP TABLE t11a_tasks(label TEXT NOT NULL, id UUID NOT NULL);
CREATE FUNCTION pg_temp.t11a_build(p_org INTEGER, p_label TEXT, p_digits TEXT, p_user TEXT, p_member INTEGER,
  p_client INTEGER, p_lead INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_link TEXT := 'https://records.example.invalid/t11a-' || p_label || '-a.mp3';
  v_dial UUID; v_refused UUID; v_task1 UUID := gen_random_uuid(); v_task2 UUID := gen_random_uuid(); v_ev UUID;
  v_client UUID := CASE WHEN p_client IS NULL THEN NULL ELSE pg_temp.t11a_id(p_client) END;
  v_lead UUID := CASE WHEN p_lead IS NULL THEN NULL ELSE pg_temp.t11a_id(p_lead) END;
  v_org UUID := pg_temp.t11a_id(p_org);
  v_mem UUID := pg_temp.t11a_id(p_member);
BEGIN
  -- Answered incoming call, with the recording link.
  PERFORM pg_temp.t11a_e('INCOMING', p_label || '-a', p_user, p_digits, 'in', '{}', p_org);
  PERFORM pg_temp.t11a_e('ACCEPTED', p_label || '-a', p_user, p_digits, 'in', '{}', p_org);
  PERFORM pg_temp.t11a_e('COMPLETED', p_label || '-a', p_user, p_digits, 'in', '{}', p_org);
  PERFORM pg_temp.t11a_h(p_label || '-a', p_user, p_digits, 'in', 'Success', '20200107T090000Z', 95, 12, v_link, p_org);
  -- Missed incoming call.
  PERFORM pg_temp.t11a_e('INCOMING', p_label || '-m', 'u702', p_digits, 'in', '{}', p_org);
  PERFORM pg_temp.t11a_h(p_label || '-m', 'u702', p_digits, 'in', 'missed', '20200107T100000Z', 30, 30, NULL, p_org);
  -- Transfer: the first call links to the second.
  PERFORM pg_temp.t11a_e('INCOMING', p_label || '-t', p_user, p_digits, 'in', '{}', p_org);
  PERFORM pg_temp.t11a_e('ACCEPTED', p_label || '-t', p_user, p_digits, 'in', '{}', p_org);
  PERFORM pg_temp.t11a_e('TRANSFERRED', p_label || '-t', p_user, p_digits, 'in',
    jsonb_build_object('second_callid', p_label || '-t2'), p_org);
  PERFORM pg_temp.t11a_e('INCOMING', p_label || '-t2', 'u702', p_digits, 'in', '{}', p_org);
  PERFORM pg_temp.t11a_e('CANCELLED', p_label || '-t2', 'u702', p_digits, 'in', '{}', p_org);
  PERFORM pg_temp.t11a_h(p_label || '-t2', 'u702', p_digits, 'in', 'missed', '20200107T110000Z', 20, 20, NULL, p_org);
  -- Outgoing call.
  PERFORM pg_temp.t11a_e('OUTGOING', p_label || '-o', p_user, p_digits, 'out', '{}', p_org);
  PERFORM pg_temp.t11a_e('ACCEPTED', p_label || '-o', p_user, p_digits, 'out', '{}', p_org);
  PERFORM pg_temp.t11a_h(p_label || '-o', p_user, p_digits, 'out', 'Success', '20200107T120000Z', 40, 2, NULL, p_org);

  IF v_client IS NOT NULL THEN
    -- The dial request the outgoing call came from, and a refused one (client only, no number).
    INSERT INTO platform_private.telephony_dial_requests(organization_id, request_id, membership_id, client_id, lead_id,
      pbx_user, client_phone, status, pbx_callid)
    VALUES (v_org, gen_random_uuid(), v_mem, v_client, v_lead, p_user, '+' || p_digits, 'sent', p_label || '-o')
    RETURNING id INTO v_dial;
    INSERT INTO t11a_dials VALUES (p_label, v_dial, FALSE);
    UPDATE platform_private.telephony_calls SET dial_request_id = v_dial
    WHERE organization_id = v_org AND pbx_callid = p_label || '-o';
    INSERT INTO platform_private.telephony_dial_requests(organization_id, request_id, membership_id, client_id, lead_id,
      status, refusal_code)
    VALUES (v_org, gen_random_uuid(), v_mem, v_client, v_lead, 'refused', 'no_phone')
    RETURNING id INTO v_refused;
    INSERT INTO t11a_dials VALUES (p_label, v_refused, TRUE);
  END IF;

  -- A recording grant on the answered leg.
  INSERT INTO platform_private.telephony_recording_grants(organization_id, membership_id, leg_id, expires_at)
  SELECT v_org, v_mem, l.id, clock_timestamp() + INTERVAL '15 minutes'
  FROM platform_private.telephony_call_legs l
  JOIN platform_private.telephony_calls c ON c.organization_id = l.organization_id AND c.id = l.call_id
  WHERE c.organization_id = v_org AND c.pbx_callid = p_label || '-a';

  -- Two task links: an open one on the missed call and a closed one that names the answered call.
  INSERT INTO platform.staff_tasks(id, organization_id, creator_membership_id, assignee_membership_id, title)
  VALUES (v_task1, v_org, v_mem, v_mem, 'T11A task 1 ' || p_label), (v_task2, v_org, v_mem, v_mem, 'T11A task 2 ' || p_label);
  INSERT INTO t11a_tasks VALUES (p_label, v_task1), (p_label, v_task2);
  INSERT INTO platform_private.telephony_task_links(organization_id, kind, task_id, call_id, client_id, lead_id, scope_id)
  SELECT v_org, 'missed_callback', v_task1, c.id, c.client_id, c.lead_id, COALESCE(c.lead_id, c.client_id, c.id)
  FROM platform_private.telephony_calls c WHERE c.organization_id = v_org AND c.pbx_callid = p_label || '-m';
  INSERT INTO platform_private.telephony_task_links(organization_id, kind, task_id, call_id, client_id, lead_id, scope_id,
    closed_at, closed_reason, closed_call_id)
  SELECT v_org, 'result_callback', v_task2, c.id, c.client_id, c.lead_id, COALESCE(c.lead_id, c.client_id, c.id),
    clock_timestamp(), 'answered_call', (SELECT a.id FROM platform_private.telephony_calls a
      WHERE a.organization_id = v_org AND a.pbx_callid = p_label || '-a')
  FROM platform_private.telephony_calls c WHERE c.organization_id = v_org AND c.pbx_callid = p_label || '-m';

  -- One evidence row that carries only the number (no call id): found by the number or not at all.
  INSERT INTO platform_private.telephony_pbx_events(organization_id, request_id, cmd, event_type, dedup_key, body_sha256,
    token_slot, validation_state, missing_fields, fields)
  VALUES (v_org, gen_random_uuid(), 'event', 'INCOMING', encode(sha256(('t11a-extra-' || p_label)::BYTEA), 'hex'),
    encode(sha256(('t11a-extra-body-' || p_label)::BYTEA), 'hex'), 'current', 'incomplete', ARRAY['callid'],
    jsonb_build_object('cmd', 'event', 'type', 'INCOMING', 'phone', p_digits))
  RETURNING id INTO v_ev;
  INSERT INTO platform_private.telephony_event_work(organization_id, event_id, state, attempt_count, completed_at)
  VALUES (v_org, v_ev, 'succeeded', 1, clock_timestamp());
  INSERT INTO t11a_extra_ev VALUES (p_label, v_ev);
END
$$;

SELECT pg_temp.t11a_build(1, 'p1', '996555291001', 'u701', 302, 711, 712);
SELECT pg_temp.t11a_build(1, 'p2', '996555291002', 'u701', 302, 721, 722);
SELECT pg_temp.t11a_build(1, 'p3', '996555291003', 'u701', 302, 731, 732);
SELECT pg_temp.t11a_build(1, 'u', '996555291004', 'u701', 302, NULL, NULL);
SELECT pg_temp.t11a_build(1, 'q', '996555291099', 'u701', 302, 791, 792);
SELECT pg_temp.t11a_build(2, 'tw', '996555291001', 'u701', 305, 811, 812);

SELECT pg_temp.t11a_assert((SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid ~ '^(p1|p2|p3|u|q|tw)-') = 30
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid ~ '^(p1|p2|p3|q|tw)-' AND client_id IS NOT NULL
      AND lead_id IS NOT NULL) = 25
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid LIKE 'u-%' AND client_id IS NULL
      AND client_phone = '+996555291004' AND match_state = 'unmatched') = 5
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid LIKE 'p1-%' AND client_phone = '+996555291001') = 5
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE linked_call_id IS NOT NULL AND pbx_callid ~ '-t$') = 6
  AND (SELECT count(*) FROM platform_private.telephony_call_legs WHERE recording_link IS NOT NULL) = 6
  AND (SELECT count(*) FROM platform_private.telephony_dial_requests) = 10
  AND (SELECT count(*) FROM platform_private.telephony_recording_grants) = 6
  AND (SELECT count(*) FROM platform_private.telephony_task_links) = 12
  AND (SELECT count(*) FROM t11a_extra_ev) = 6,
  'the fixture: five calls for each of six people (matched to client and lead, or unmatched), links, legs, dial requests, grants and task links');

-- The key column is filled by the database for every stored row, with no change of the intake.
SELECT pg_temp.t11a_assert((SELECT count(*) FROM platform_private.telephony_pbx_events e
      WHERE e.fields ->> 'phone' IS NOT NULL AND e.phone_match_keys <> platform_private.telephony_phone_keys(e.fields ->> 'phone')) = 0
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events e
      WHERE e.fields ->> 'phone' = '996555291001' AND e.organization_id = pg_temp.t11a_id(1)
        AND e.phone_match_keys @> ARRAY['+996555291001', '0555291001']) = (SELECT count(*) FROM platform_private.telephony_pbx_events e
      WHERE e.fields ->> 'phone' = '996555291001' AND e.organization_id = pg_temp.t11a_id(1))
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events e WHERE e.fields ->> 'phone' = '996555291001') > 20,
  'every evidence row with a number carries its keys; the intake needed no change');
SELECT pg_temp.t11a_e('INCOMING', 'int-1', 'u701', '702', 'out'), pg_temp.t11a_e('INCOMING', 'anon-1', 'u701', 'anonymous');
SELECT pg_temp.t11a_recv('rating', jsonb_build_object('cmd', 'rating', 'callid', 'rate-1', 'user', 'u701', 'phone', '996555291777'));
SELECT pg_temp.t11a_recv('contact', jsonb_build_object('cmd', 'contact', 'callid', 'rej-1', 'phone', '996555291777'));
SELECT pg_temp.t11a_assert((SELECT bool_and(cardinality(e.phone_match_keys) = 0) FROM platform_private.telephony_pbx_events e
      WHERE e.pbx_callid IN ('int-1', 'anon-1'))
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events e WHERE e.validation_state = 'rejected') >= 1
  AND (SELECT bool_and(cardinality(e.phone_match_keys) = 0) FROM platform_private.telephony_pbx_events e WHERE e.validation_state = 'rejected')
  AND (SELECT cardinality(e.phone_match_keys) > 0 FROM platform_private.telephony_pbx_events e WHERE e.pbx_callid = 'rate-1'),
  'an extension and an unreadable caller id give no keys, a rejected form has none, a rating message with a number has them');

-- ---------------------------------------------------------------------------
-- The md5 snapshot machinery (the pattern of migration 280's suite): the rows a
-- person owns are marked from the fixture by label (not by the function under
-- test); a snapshot hashes EVERY other row of the six schemas.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t11a_reach (tag TEXT NOT NULL, tbl TEXT NOT NULL, tid TID NOT NULL);
CREATE INDEX ON t11a_reach (tag, tbl);
CREATE TEMP TABLE t11a_snap (tag TEXT NOT NULL, tbl TEXT NOT NULL, h TEXT NOT NULL);
CREATE INDEX ON t11a_snap (tag, tbl);

-- Mark the rows of one label. p_mode: 'all' (every row of the person), 'phone' (the person's rows
-- reachable by the number: not the refused dial request, which carries a client and a lead only),
-- 'lead' (the rows reachable by the lead: not the evidence row that carries only the number),
-- 'client_rest' (what an erasure by client leaves after an erasure by phone: the refused dial request).
CREATE FUNCTION pg_temp.t11a_mark(p_tag TEXT, p_org INTEGER, p_label TEXT, p_digits TEXT, p_mode TEXT DEFAULT 'all')
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_org UUID := pg_temp.t11a_id(p_org);
  v_calls UUID[]; v_events UUID[];
BEGIN
  IF p_mode = 'client_rest' THEN
    INSERT INTO t11a_reach SELECT p_tag, 'platform_private.telephony_dial_requests', d.ctid
    FROM platform_private.telephony_dial_requests d JOIN t11a_dials x ON x.id = d.id AND x.label = p_label AND x.refused;
    RETURN;
  END IF;
  SELECT COALESCE(array_agg(c.id), ARRAY[]::UUID[]) INTO v_calls FROM platform_private.telephony_calls c
  WHERE c.organization_id = v_org AND c.pbx_callid LIKE p_label || '-%';
  SELECT COALESCE(array_agg(e.id), ARRAY[]::UUID[]) INTO v_events FROM platform_private.telephony_pbx_events e
  WHERE e.organization_id = v_org AND (e.pbx_callid LIKE p_label || '-%'
    OR (p_mode <> 'lead' AND e.fields ->> 'phone' = p_digits)
    OR (p_mode <> 'lead' AND e.id IN (SELECT x.id FROM t11a_extra_ev x WHERE x.label = p_label)));
  INSERT INTO t11a_reach SELECT p_tag, 'platform_private.telephony_calls', c.ctid
    FROM platform_private.telephony_calls c WHERE c.organization_id = v_org AND c.id = ANY (v_calls);
  INSERT INTO t11a_reach SELECT p_tag, 'platform_private.telephony_call_legs', l.ctid
    FROM platform_private.telephony_call_legs l WHERE l.organization_id = v_org AND l.call_id = ANY (v_calls);
  INSERT INTO t11a_reach SELECT p_tag, 'platform_private.telephony_call_events', e.ctid
    FROM platform_private.telephony_call_events e WHERE e.organization_id = v_org AND e.call_id = ANY (v_calls);
  INSERT INTO t11a_reach SELECT p_tag, 'platform_private.telephony_recording_grants', g.ctid
    FROM platform_private.telephony_recording_grants g WHERE g.organization_id = v_org
      AND g.leg_id IN (SELECT l.id FROM platform_private.telephony_call_legs l WHERE l.call_id = ANY (v_calls));
  INSERT INTO t11a_reach SELECT p_tag, 'platform_private.telephony_task_links', t.ctid
    FROM platform_private.telephony_task_links t WHERE t.organization_id = v_org AND t.call_id = ANY (v_calls);
  INSERT INTO t11a_reach SELECT p_tag, 'platform_private.telephony_dial_requests', d.ctid
    FROM platform_private.telephony_dial_requests d JOIN t11a_dials x ON x.id = d.id AND x.label = p_label
    WHERE p_mode <> 'phone' OR NOT x.refused;
  INSERT INTO t11a_reach SELECT p_tag, 'platform_private.telephony_event_work', w.ctid
    FROM platform_private.telephony_event_work w WHERE w.organization_id = v_org AND w.event_id = ANY (v_events);
  INSERT INTO t11a_reach SELECT p_tag, 'platform_private.telephony_pbx_events', e.ctid
    FROM platform_private.telephony_pbx_events e WHERE e.organization_id = v_org AND e.id = ANY (v_events);
END
$$;

-- The expected counts of an erasure, from the marks (the eight keys of the answer).
CREATE FUNCTION pg_temp.t11a_expected(p_tag TEXT, p_unlinked INTEGER DEFAULT 0) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object(
    'task_links', (SELECT count(*) FROM t11a_reach WHERE tag = p_tag AND tbl = 'platform_private.telephony_task_links'),
    'recording_grants', (SELECT count(*) FROM t11a_reach WHERE tag = p_tag AND tbl = 'platform_private.telephony_recording_grants'),
    'call_events', (SELECT count(*) FROM t11a_reach WHERE tag = p_tag AND tbl = 'platform_private.telephony_call_events'),
    'call_legs', (SELECT count(*) FROM t11a_reach WHERE tag = p_tag AND tbl = 'platform_private.telephony_call_legs'),
    'calls', (SELECT count(*) FROM t11a_reach WHERE tag = p_tag AND tbl = 'platform_private.telephony_calls'),
    'dial_requests', (SELECT count(*) FROM t11a_reach WHERE tag = p_tag AND tbl = 'platform_private.telephony_dial_requests'),
    'event_work', (SELECT count(*) FROM t11a_reach WHERE tag = p_tag AND tbl = 'platform_private.telephony_event_work'),
    'pbx_events', (SELECT count(*) FROM t11a_reach WHERE tag = p_tag AND tbl = 'platform_private.telephony_pbx_events'),
    'unlinked_calls', p_unlinked)
$$;

-- The task ids a person's erasure must hand back (sorted), from the fixture.
CREATE FUNCTION pg_temp.t11a_task_ids(p_label TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT COALESCE(to_jsonb(array_agg(id ORDER BY id)), '[]'::JSONB) FROM t11a_tasks WHERE label = p_label
$$;

CREATE FUNCTION pg_temp.t11a_snapshot(p_tag TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT := 0; m BIGINT;
BEGIN
  DELETE FROM t11a_snap WHERE tag = p_tag;
  FOR r IN SELECT format('%I.%I', table_schema, table_name) AS q FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema IN ('platform', 'platform_private', 'private', 'public', 'auth', 'storage')
    ORDER BY 1
  LOOP
    EXECUTE format('INSERT INTO t11a_snap (tag, tbl, h) SELECT $1, %L, md5(x::TEXT) FROM %s x
      WHERE NOT EXISTS (SELECT 1 FROM t11a_reach z WHERE z.tag = $1 AND z.tbl = %L AND z.tid = x.ctid)',
      r.q, r.q, r.q) USING p_tag;
    GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  END LOOP;
  RETURN n;
END
$$;
-- Tables where a row of the snapshot is gone or changed ('' = none). New rows (the receipt) are additions.
CREATE FUNCTION pg_temp.t11a_changed(p_tag TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT; found TEXT := '';
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM t11a_snap WHERE tag = p_tag ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM (SELECT h FROM t11a_snap WHERE tag = $1 AND tbl = $2
      EXCEPT ALL SELECT md5(x::TEXT) FROM %s x) q', r.tbl) INTO n USING p_tag, r.tbl;
    IF n > 0 THEN found := found || r.tbl || '=' || n || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;
-- Tables where a marked row is still there ('' = none).
CREATE FUNCTION pg_temp.t11a_left(p_tag TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT; found TEXT := '';
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM t11a_reach WHERE tag = p_tag ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM %s x WHERE x.ctid = ANY (ARRAY(SELECT z.tid FROM t11a_reach z
      WHERE z.tag = $1 AND z.tbl = %L))', r.tbl, r.tbl) INTO n USING p_tag;
    IF n > 0 THEN found := found || r.tbl || '=' || n || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;
-- The row counts of the telephony tables, one string.
CREATE FUNCTION pg_temp.t11a_sizes() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE t TEXT; n BIGINT; found TEXT := '';
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
    WHERE s.nspname = 'platform_private' AND c.relkind = 'r' AND c.relname LIKE 'telephony\_%' ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM platform_private.%I', t) INTO n;
    found := found || t || '=' || n || ' ';
  END LOOP;
  RETURN btrim(found);
END
$$;
CREATE FUNCTION pg_temp.t11a_marker() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT COALESCE(current_setting('platform.telephony_erasure_request_id', TRUE), '')
$$;

-- ---------------------------------------------------------------------------
-- 3. The lock before any erasure.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t11a_assert(pg_temp.t11a_marker() = '', 'no marker is set before any erasure');
SELECT pg_temp.t11a_assert(
  pg_temp.t11a_err('DELETE FROM platform_private.telephony_pbx_events') = '55000:platform.telephony_pbx_events is append-only; DELETE is forbidden'
  AND pg_temp.t11a_err('UPDATE platform_private.telephony_pbx_events SET has_link = NOT has_link') = '55000:platform.telephony_pbx_events is append-only; UPDATE is forbidden'
  AND pg_temp.t11a_err('DELETE FROM platform_private.telephony_call_events') = '55000:platform.telephony_call_events is append-only; DELETE is forbidden'
  AND pg_temp.t11a_err('UPDATE platform_private.telephony_call_events SET event_type = ''x''') = '55000:platform.telephony_call_events is append-only; UPDATE is forbidden'
  AND pg_temp.t11a_state('TRUNCATE platform_private.telephony_call_events') = '55000'
  AND pg_temp.t11a_state('TRUNCATE platform_private.telephony_pbx_events CASCADE') = '55000',
  'UPDATE and DELETE are refused with the shared guard''s text and SQLSTATE even for the owner; TRUNCATE stays on the shared guard');

-- A marker that names no receipt, a malformed marker and a marker of a receipt that is not erasing here do not open the lock.
SELECT set_config('platform.telephony_erasure_request_id', pg_temp.t11a_id(9999)::TEXT, TRUE);
SELECT pg_temp.t11a_assert(pg_temp.t11a_state('DELETE FROM platform_private.telephony_pbx_events') = '55000'
  AND pg_temp.t11a_state('DELETE FROM platform_private.telephony_call_events') = '55000',
  'a marker that names no receipt does not open the lock');
SELECT set_config('platform.telephony_erasure_request_id', 'not-a-uuid', TRUE);
SELECT pg_temp.t11a_assert(pg_temp.t11a_state('DELETE FROM platform_private.telephony_pbx_events') = '55000',
  'a malformed marker does not open the lock');
SELECT set_config('platform.telephony_erasure_request_id', '', TRUE);

-- Forged receipts. The owner can write a receipt (nothing else can); the lock reads the receipt's kind, the table, the
-- organization and the transaction it is erasing in. Rows for these tests carry no work, so a refusal can only be the lock.
INSERT INTO platform_private.telephony_pbx_events(id, organization_id, request_id, cmd, dedup_key, body_sha256, token_slot,
  validation_state, fields) VALUES
  (pg_temp.t11a_id(9301), pg_temp.t11a_id(1), pg_temp.t11a_id(9301), 'event', repeat('a', 64), repeat('b', 64), 'current', 'ok',
    '{"cmd":"event","type":"INCOMING","phone":"996555291400"}'::JSONB),
  (pg_temp.t11a_id(9302), pg_temp.t11a_id(2), pg_temp.t11a_id(9302), 'event', repeat('e', 64), repeat('f', 64), 'current', 'ok',
    '{"cmd":"event","type":"INCOMING","phone":"996555291401"}'::JSONB);
INSERT INTO platform_private.telephony_call_events(id, organization_id, call_id, source, event_type, occurred_at, pbx_event_id)
  SELECT pg_temp.t11a_id(9303), c.organization_id, c.id, 'webhook', 'incoming', clock_timestamp(), pg_temp.t11a_id(9301)
  FROM platform_private.telephony_calls c WHERE c.pbx_callid = 'q-a'
  UNION ALL
  SELECT pg_temp.t11a_id(9304), c.organization_id, c.id, 'webhook', 'incoming', clock_timestamp(), pg_temp.t11a_id(9302)
  FROM platform_private.telephony_calls c WHERE c.pbx_callid = 'tw-a';
-- A. A finished receipt (no transaction mark) opens nothing.
INSERT INTO platform_private.telephony_erasure_requests(id, organization_id, request_id, kind, retention_cutoff, completed_at)
  VALUES (pg_temp.t11a_id(9101), pg_temp.t11a_id(1), pg_temp.t11a_id(9101), 'retention', clock_timestamp() - INTERVAL '12 months',
    clock_timestamp());
SELECT set_config('platform.telephony_erasure_request_id', pg_temp.t11a_id(9101)::TEXT, TRUE);
SELECT pg_temp.t11a_assert(pg_temp.t11a_state(format('DELETE FROM platform_private.telephony_pbx_events WHERE id = %L', pg_temp.t11a_id(9301))) = '55000'
  AND pg_temp.t11a_state(format('DELETE FROM platform_private.telephony_call_events WHERE id = %L', pg_temp.t11a_id(9303))) = '55000',
  'a finished receipt (no transaction mark) does not open the lock');
SELECT set_config('platform.telephony_erasure_request_id', '', TRUE);
DELETE FROM platform_private.telephony_erasure_requests WHERE id = pg_temp.t11a_id(9101);
-- B. A retention receipt of organization 2 that is erasing in this transaction: its own evidence only.
INSERT INTO platform_private.telephony_erasure_requests(id, organization_id, request_id, kind, retention_cutoff, erasure_transaction_id)
  VALUES (pg_temp.t11a_id(9102), pg_temp.t11a_id(2), pg_temp.t11a_id(9102), 'retention', clock_timestamp() - INTERVAL '12 months',
    pg_current_xact_id());
SELECT set_config('platform.telephony_erasure_request_id', pg_temp.t11a_id(9102)::TEXT, TRUE);
SELECT pg_temp.t11a_assert(pg_temp.t11a_state(format('DELETE FROM platform_private.telephony_pbx_events WHERE id = %L', pg_temp.t11a_id(9301))) = '55000'
  AND pg_temp.t11a_state(format('DELETE FROM platform_private.telephony_call_events WHERE id = %L', pg_temp.t11a_id(9304))) = '55000'
  AND pg_temp.t11a_state(format('UPDATE platform_private.telephony_pbx_events SET has_link = NOT has_link WHERE id = %L', pg_temp.t11a_id(9302))) = '55000'
  AND pg_temp.t11a_state('TRUNCATE platform_private.telephony_pbx_events CASCADE') = '55000',
  'a retention receipt of organization 2 cannot delete organization 1 evidence or any chronology, update, or truncate');
SELECT pg_temp.t11a_state(format('DELETE FROM platform_private.telephony_pbx_events WHERE id = %L', pg_temp.t11a_id(9302))) AS t11a_del \gset
SELECT pg_temp.t11a_assert(:'t11a_del' = 'ok' AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_pbx_events WHERE id = pg_temp.t11a_id(9302)),
  'the same receipt deletes the evidence row of its own organization (the positive control)');
SELECT set_config('platform.telephony_erasure_request_id', '', TRUE);
UPDATE platform_private.telephony_erasure_requests SET completed_at = clock_timestamp(), erasure_transaction_id = NULL
  WHERE id = pg_temp.t11a_id(9102);
DELETE FROM platform_private.telephony_erasure_requests WHERE id = pg_temp.t11a_id(9102);
-- C. A person receipt of organization 1 that is erasing in this transaction: its evidence and its chronology, not organization 2.
INSERT INTO platform_private.telephony_erasure_requests(id, organization_id, request_id, kind, actor_membership_id, by_client,
  erasure_transaction_id) VALUES (pg_temp.t11a_id(9103), pg_temp.t11a_id(1), pg_temp.t11a_id(9103), 'person', pg_temp.t11a_id(301),
  TRUE, pg_current_xact_id());
SELECT set_config('platform.telephony_erasure_request_id', pg_temp.t11a_id(9103)::TEXT, TRUE);
SELECT pg_temp.t11a_assert(pg_temp.t11a_state(format('DELETE FROM platform_private.telephony_call_events WHERE id = %L', pg_temp.t11a_id(9304))) = '55000'
  AND pg_temp.t11a_state(format('UPDATE platform_private.telephony_call_events SET event_type = ''x'' WHERE id = %L', pg_temp.t11a_id(9303))) = '55000'
  AND pg_temp.t11a_state('TRUNCATE platform_private.telephony_call_events') = '55000',
  'a person receipt of organization 1 cannot delete the chronology of organization 2, update, or truncate');
SELECT pg_temp.t11a_state(format('DELETE FROM platform_private.telephony_call_events WHERE id = %L', pg_temp.t11a_id(9303))) AS t11a_del1,
  pg_temp.t11a_state(format('DELETE FROM platform_private.telephony_pbx_events WHERE id = %L', pg_temp.t11a_id(9301))) AS t11a_del2 \gset
SELECT pg_temp.t11a_assert(:'t11a_del1' = 'ok' AND :'t11a_del2' = 'ok'
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_call_events WHERE id = pg_temp.t11a_id(9303))
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_pbx_events WHERE id = pg_temp.t11a_id(9301)),
  'the same receipt deletes the chronology and the evidence of its own organization (the positive control)');
SELECT set_config('platform.telephony_erasure_request_id', '', TRUE);
UPDATE platform_private.telephony_erasure_requests SET completed_at = clock_timestamp(), erasure_transaction_id = NULL
  WHERE id = pg_temp.t11a_id(9103);
DELETE FROM platform_private.telephony_erasure_requests WHERE id = pg_temp.t11a_id(9103);
SELECT pg_temp.t11a_assert(pg_temp.t11a_state(format('DELETE FROM platform_private.telephony_call_events WHERE id = %L', pg_temp.t11a_id(9304))) = '55000'
  AND pg_temp.t11a_marker() = '',
  'with the marker cleared the lock is closed again');

-- Migration 280's account-erasure bypass still opens the two tables (row DELETE only).
INSERT INTO platform_private.telephony_pbx_events(id, organization_id, request_id, cmd, dedup_key, body_sha256, token_slot,
  validation_state, fields)
  VALUES (pg_temp.t11a_id(9201), pg_temp.t11a_id(1), pg_temp.t11a_id(9201), 'event', repeat('c', 64), repeat('d', 64), 'current', 'ok',
    '{"cmd":"event","type":"INCOMING","phone":"996555291400"}'::JSONB);
INSERT INTO platform_private.telephony_call_events(id, organization_id, call_id, source, event_type, occurred_at, pbx_event_id)
  SELECT pg_temp.t11a_id(9202), c.organization_id, c.id, 'webhook', 'incoming', clock_timestamp(), pg_temp.t11a_id(9201)
  FROM platform_private.telephony_calls c WHERE c.pbx_callid = 'q-a';
INSERT INTO platform_private.account_deletion_requests(id, organization_id, membership_id, request_id, subject_auth_user_id, subject_kind)
  VALUES (pg_temp.t11a_id(9210), pg_temp.t11a_id(1), pg_temp.t11a_id(307), pg_temp.t11a_id(9211), pg_temp.t11a_id(107), 'student');
DO $t11a_account$
DECLARE v_rows BIGINT;
BEGIN
  PERFORM set_config('platform.account_erasure_request_id', pg_temp.t11a_id(9210)::TEXT, TRUE);
  PERFORM pg_temp.t11a_assert(pg_temp.t11a_state(format('DELETE FROM platform_private.telephony_call_events WHERE id = %L', pg_temp.t11a_id(9202))) = '55000',
    'a request that is not erasing in this transaction opened the lock');
  UPDATE platform_private.account_deletion_requests SET erasure_transaction_id = pg_catalog.pg_current_xact_id()
  WHERE id = pg_temp.t11a_id(9210);
  PERFORM pg_temp.t11a_assert(pg_temp.t11a_state('UPDATE platform_private.telephony_call_events SET event_type = ''x''') = '55000'
    AND pg_temp.t11a_state('TRUNCATE platform_private.telephony_call_events') = '55000',
    'inside the account erasure UPDATE and TRUNCATE stay refused');
  DELETE FROM platform_private.telephony_call_events WHERE id = pg_temp.t11a_id(9202);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.t11a_assert(v_rows = 1, 'the account erasure could not delete a chronology row');
  DELETE FROM platform_private.telephony_pbx_events WHERE id = pg_temp.t11a_id(9201);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.t11a_assert(v_rows = 1, 'the account erasure could not delete an evidence row');
  PERFORM set_config('platform.account_erasure_request_id', '', TRUE);
  UPDATE platform_private.account_deletion_requests SET erasure_transaction_id = NULL WHERE id = pg_temp.t11a_id(9210);
END
$t11a_account$;
SELECT pg_temp.t11a_assert(NOT EXISTS (SELECT 1 FROM platform_private.telephony_pbx_events WHERE id = pg_temp.t11a_id(9201))
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_call_events WHERE id = pg_temp.t11a_id(9202))
  AND pg_temp.t11a_state('DELETE FROM platform_private.telephony_pbx_events') = '55000',
  'migration 280''s account erasure still deletes exactly the rows it may and the lock is closed again');
SELECT pg_temp.t11a_assert((SELECT count(*) FROM platform_private.telephony_erasure_requests) = 0,
  'the lock tests left no receipt');

-- ---------------------------------------------------------------------------
-- 4. Who may erase, and the argument errors. Nothing changes.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('refusals') > 0, 'the refusals snapshot is not empty');
SELECT pg_temp.t11a_assert(
  -- a staff member who is not a system Admin, a Student, an Admin made inactive, an unknown member
  pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(302))) = '42501'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(307))) = '42501'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(306))) = '42501'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(9999))) = '42501'
  -- an Admin of another organization, in both directions
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(304))) = '42501'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'')',
    pg_temp.t11a_id(2), pg_temp.t11a_id(9301), pg_temp.t11a_id(301))) = '42501'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, NULL, %L)',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(302), pg_temp.t11a_id(711))) = '42501',
  'a staff member, a Student, an inactive Admin, an unknown member and an Admin of another organization are refused (42501)');
SELECT pg_temp.t11a_assert(
  pg_temp.t11a_err(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(302))) LIKE '42501:telephony_erasure_forbidden%'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(NULL, %L, %L, ''996555291001'')',
    pg_temp.t11a_id(9301), pg_temp.t11a_id(301))) = '22023'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, NULL, %L, ''996555291001'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(301))) = '22023'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, %L, NULL, ''996555291001'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301))) = '22023'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L)',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(301))) = '22023'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'', NULL, NULL, NULL)',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(301))) = '22023'
  AND pg_temp.t11a_err(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''701'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(301))) = '22023:telephony_erasure_phone_invalid'
  AND pg_temp.t11a_err(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''anonymous'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(301))) = '22023:telephony_erasure_phone_invalid'
  AND pg_temp.t11a_err(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, '''')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9301), pg_temp.t11a_id(301))) = '22023:telephony_erasure_phone_invalid'
  AND pg_temp.t11a_err(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'')',
    pg_temp.t11a_id(99), pg_temp.t11a_id(9301), pg_temp.t11a_id(301))) = '22023:telephony_unknown_organization',
  'NULL arguments, no selector, a phone that reads as nothing and an unknown organization are argument errors (22023)');
SELECT pg_temp.t11a_assert(pg_temp.t11a_changed('refusals') = '' AND (SELECT count(*) FROM platform_private.telephony_erasure_requests) = 0
  AND pg_temp.t11a_marker() = '',
  'every refusal changed no row, left no receipt and no marker');

-- ---------------------------------------------------------------------------
-- 5. Person p1 (organization 1): dry run, then the real erasure by number, client and lead.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t11a_mark('p1', 1, 'p1', '996555291001', 'all');
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('p1') > 0, 'the p1 snapshot is not empty');
SELECT pg_temp.t11a_assert(pg_temp.t11a_expected('p1')->>'calls' = '5' AND pg_temp.t11a_expected('p1')->>'dial_requests' = '2'
    AND pg_temp.t11a_expected('p1')->>'recording_grants' = '1' AND pg_temp.t11a_expected('p1')->>'task_links' = '2'
    AND (pg_temp.t11a_expected('p1')->>'call_legs')::INT >= 5 AND (pg_temp.t11a_expected('p1')->>'call_events')::INT >= 15
    AND (pg_temp.t11a_expected('p1')->>'pbx_events')::INT > 15
    AND pg_temp.t11a_expected('p1')->>'pbx_events' = pg_temp.t11a_expected('p1')->>'event_work',
  'the fixture of p1: five calls, their legs and chronology, a grant, two task links, two dial requests, evidence with one work row each');

SELECT pg_temp.t11a_sizes() AS t11a_sizes_before \gset
SELECT platform.telephony_erase_person_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9401), pg_temp.t11a_id(301),
  '+996 555 291-001', pg_temp.t11a_id(711), pg_temp.t11a_id(712), TRUE)::TEXT AS t11a_dry \gset
SELECT pg_temp.t11a_assert((:'t11a_dry'::JSONB)->>'status' = 'dry_run' AND (:'t11a_dry'::JSONB)->'counts' = pg_temp.t11a_expected('p1')
    AND (:'t11a_dry'::JSONB)->'task_ids' = pg_temp.t11a_task_ids('p1'),
  'dry run answers the counts that the erasure will remove and the ids of the platform tasks tied to the calls');
SELECT pg_temp.t11a_assert(pg_temp.t11a_sizes() = :'t11a_sizes_before' AND pg_temp.t11a_marker() = ''
    AND (SELECT count(*) FROM platform_private.telephony_erasure_requests) = 0,
  'dry run changed no table, wrote no receipt and set no marker');

SELECT platform.telephony_erase_person_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9402), pg_temp.t11a_id(301),
  '+996 555 291-001', pg_temp.t11a_id(711), pg_temp.t11a_id(712))::TEXT AS t11a_p1 \gset
SELECT pg_temp.t11a_assert((:'t11a_p1'::JSONB)->>'status' = 'erased' AND (:'t11a_p1'::JSONB)->'counts' = pg_temp.t11a_expected('p1')
    AND (:'t11a_p1'::JSONB)->>'request_id' = pg_temp.t11a_id(9402)::TEXT AND (:'t11a_p1'::JSONB)->'task_ids' = pg_temp.t11a_task_ids('p1'),
  'the answer names the rows removed, equal to the rows marked for p1, and hands back the two task ids (the tasks themselves are platform data and stay)');
SELECT pg_temp.t11a_assert((SELECT count(*) FROM platform.staff_tasks WHERE id IN (SELECT id FROM t11a_tasks WHERE label = 'p1')) = 2
  AND (SELECT count(*) FROM platform_private.telephony_task_links WHERE task_id IN (SELECT id FROM t11a_tasks)) = 10,
  'the platform tasks of p1 are still there; the links of the others are untouched');
SELECT pg_temp.t11a_assert(pg_temp.t11a_left('p1') = '', 'a row of p1 is still there: ' || pg_temp.t11a_left('p1'));
SELECT pg_temp.t11a_assert(pg_temp.t11a_changed('p1') = '', 'a row outside p1 changed: ' || pg_temp.t11a_changed('p1'));
SELECT pg_temp.t11a_assert(pg_temp.t11a_marker() = '', 'the marker is cleared after the erasure');
SELECT pg_temp.t11a_assert(
  NOT EXISTS (SELECT 1 FROM platform_private.telephony_pbx_events WHERE organization_id = pg_temp.t11a_id(1) AND fields ->> 'phone' = '996555291001')
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_calls WHERE organization_id = pg_temp.t11a_id(1) AND (client_id = pg_temp.t11a_id(711)
      OR lead_id = pg_temp.t11a_id(712) OR client_phone = '+996555291001'))
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_dial_requests WHERE client_id = pg_temp.t11a_id(711))
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links WHERE client_id = pg_temp.t11a_id(711))
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_call_legs WHERE recording_link LIKE '%t11a-p1-%'),
  'no row of p1 is reachable by number, client, lead or recording link');
-- The bystander and the same number in the other organization keep everything.
SELECT pg_temp.t11a_assert((SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid LIKE 'q-%') = 5
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid LIKE 'tw-%') = 5
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE organization_id = pg_temp.t11a_id(2)
      AND fields ->> 'phone' = '996555291001') > 10
  AND (SELECT count(*) FROM platform_private.telephony_call_legs WHERE recording_link LIKE '%t11a-tw-%') = 1
  AND (SELECT count(*) FROM platform_private.telephony_call_legs WHERE recording_link LIKE '%t11a-q-%') = 1,
  'the bystander of the organization and the same number in the other organization keep all their rows');
-- The receipt.
SELECT pg_temp.t11a_assert((SELECT r.kind = 'person' AND r.actor_membership_id = pg_temp.t11a_id(301) AND r.by_phone AND r.by_client
      AND r.by_lead AND r.phone_last4 = '1001' AND r.retention_cutoff IS NULL AND r.erasure_transaction_id IS NULL
      AND r.completed_at IS NOT NULL AND r.summary = pg_temp.t11a_expected('p1') AND r.organization_id = pg_temp.t11a_id(1)
    FROM platform_private.telephony_erasure_requests r WHERE r.request_id = pg_temp.t11a_id(9402))
  AND (SELECT count(*) FROM platform_private.telephony_erasure_requests) = 1
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_erasure_requests r WHERE to_jsonb(r)::TEXT ~ '555291|\+996'),
  'the receipt names the Admin, the selectors, the last four digits and the counts, and holds no number');

-- Replay, and the same id with another shape.
SELECT pg_temp.t11a_sizes() AS t11a_sizes_before \gset
SELECT platform.telephony_erase_person_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9402), pg_temp.t11a_id(301),
  '996555291001', pg_temp.t11a_id(711), pg_temp.t11a_id(712))::TEXT AS t11a_replay \gset
SELECT pg_temp.t11a_assert((:'t11a_replay'::JSONB)->>'status' = 'replayed' AND (:'t11a_replay'::JSONB)->'counts' = pg_temp.t11a_expected('p1')
    AND (:'t11a_replay'::JSONB)->>'receipt_id' = (:'t11a_p1'::JSONB)->>'receipt_id'
    AND pg_temp.t11a_sizes() = :'t11a_sizes_before',
  'the same request id replays the first answer (another spelling of the number is the same request) and removes nothing again');
SELECT pg_temp.t11a_assert(
  pg_temp.t11a_err(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291002'', %L, %L)',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9402), pg_temp.t11a_id(301), pg_temp.t11a_id(711), pg_temp.t11a_id(712))) = '22023:telephony_erasure_request_conflict'
  AND pg_temp.t11a_err(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'', %L)',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9402), pg_temp.t11a_id(301), pg_temp.t11a_id(711))) = '22023:telephony_erasure_request_conflict'
  AND pg_temp.t11a_err(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291001'', %L, %L)',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9402), pg_temp.t11a_id(303), pg_temp.t11a_id(711), pg_temp.t11a_id(712))) = '22023:telephony_erasure_request_conflict'
  AND pg_temp.t11a_err(format('SELECT platform.telephony_purge_evidence_v1(%L, %L)', pg_temp.t11a_id(1), pg_temp.t11a_id(9402)))
    = '22023:telephony_purge_request_conflict',
  'the same id with another number, another selector or another Admin is refused, and a person id cannot be used as a retention id');
SELECT pg_temp.t11a_assert((SELECT count(*) FROM platform_private.telephony_erasure_requests) = 1, 'conflicts wrote no receipt');
-- A second request for p1 finds nothing: it removes nothing and says so.
SELECT platform.telephony_erase_person_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9403), pg_temp.t11a_id(303),
  '996555291001', pg_temp.t11a_id(711), pg_temp.t11a_id(712))::TEXT AS t11a_again \gset
SELECT pg_temp.t11a_assert((:'t11a_again'::JSONB)->>'status' = 'erased'
    AND (SELECT bool_and(v::INT = 0) FROM jsonb_each_text((:'t11a_again'::JSONB)->'counts') x(k, v)),
  'a new request for an erased person (a second Admin) removes nothing');

-- ---------------------------------------------------------------------------
-- 6. Person p2: by number alone, then by client for what the number could not reach.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t11a_mark('p2a', 1, 'p2', '996555291002', 'phone');
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('p2a') > 0, 'the p2a snapshot is not empty');
SELECT platform.telephony_erase_person_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9411), pg_temp.t11a_id(301),
  '0555291002')::TEXT AS t11a_p2a \gset
SELECT pg_temp.t11a_assert((:'t11a_p2a'::JSONB)->>'status' = 'erased' AND (:'t11a_p2a'::JSONB)->'counts' = pg_temp.t11a_expected('p2a')
    AND (:'t11a_p2a'::JSONB)->'task_ids' = pg_temp.t11a_task_ids('p2')
    AND pg_temp.t11a_left('p2a') = '' AND pg_temp.t11a_changed('p2a') = '',
  'erasure by the number alone (national spelling) removes the calls, legs, chronology, grants, task links, dial requests and evidence that carry it');
SELECT pg_temp.t11a_assert((SELECT count(*) FROM platform_private.telephony_dial_requests d JOIN t11a_dials x ON x.id = d.id
      WHERE x.label = 'p2' AND x.refused) = 1
  AND (SELECT r.by_phone AND NOT r.by_client AND NOT r.by_lead AND r.phone_last4 = '1002'
    FROM platform_private.telephony_erasure_requests r WHERE r.request_id = pg_temp.t11a_id(9411)),
  'the number alone cannot reach a refused dial request that holds only a client and a lead; the receipt says "by number"');
SELECT pg_temp.t11a_mark('p2b', 1, 'p2', '996555291002', 'client_rest');
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('p2b') > 0, 'the p2b snapshot is not empty');
SELECT platform.telephony_erase_person_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9412), pg_temp.t11a_id(301),
  NULL, pg_temp.t11a_id(721))::TEXT AS t11a_p2b \gset
SELECT pg_temp.t11a_assert((:'t11a_p2b'::JSONB)->>'status' = 'erased' AND (:'t11a_p2b'::JSONB)->'counts' = pg_temp.t11a_expected('p2b')
    AND pg_temp.t11a_left('p2b') = '' AND pg_temp.t11a_changed('p2b') = ''
    AND (:'t11a_p2b'::JSONB)->'counts'->>'dial_requests' = '1' AND (:'t11a_p2b'::JSONB)->'task_ids' = '[]'::JSONB,
  'erasure by the client alone removes the refused dial request and changes nothing else');
SELECT pg_temp.t11a_assert((SELECT NOT r.by_phone AND r.by_client AND NOT r.by_lead AND r.phone_last4 IS NULL
    FROM platform_private.telephony_erasure_requests r WHERE r.request_id = pg_temp.t11a_id(9412)),
  'a receipt without a number holds no digits');

-- ---------------------------------------------------------------------------
-- 7. Person p3: by lead alone. A call of nobody that points at an erased call loses only that link.
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.telephony_calls(id, organization_id, pbx_callid, direction, started_at, created_via, linked_call_id)
  SELECT pg_temp.t11a_id(9501), c.organization_id, 'orphan-1', 'in', clock_timestamp(), 'webhook', c.id
  FROM platform_private.telephony_calls c WHERE c.pbx_callid = 'p3-a';
SELECT pg_temp.t11a_mark('p3', 1, 'p3', '996555291003', 'lead');
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('p3') > 0, 'the p3 snapshot is not empty');
SELECT md5((to_jsonb(c) - 'linked_call_id')::TEXT) AS t11a_orphan_before FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t11a_id(9501) \gset
SELECT platform.telephony_erase_person_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9421), pg_temp.t11a_id(301),
  NULL, NULL, pg_temp.t11a_id(732))::TEXT AS t11a_p3 \gset
SELECT pg_temp.t11a_assert((:'t11a_p3'::JSONB)->>'status' = 'erased' AND (:'t11a_p3'::JSONB)->'counts' = pg_temp.t11a_expected('p3', 1)
    AND (:'t11a_p3'::JSONB)->'task_ids' = pg_temp.t11a_task_ids('p3') AND pg_temp.t11a_left('p3') = '',
  'erasure by the lead alone removes the calls of that lead, their legs, chronology, grants, links and the evidence of their call ids');
SELECT pg_temp.t11a_assert(pg_temp.t11a_changed('p3') = 'platform_private.telephony_calls=1'
  AND (SELECT c.linked_call_id IS NULL AND c.pbx_callid = 'orphan-1' FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t11a_id(9501))
  AND (SELECT md5((to_jsonb(c) - 'linked_call_id')::TEXT) = :'t11a_orphan_before'
    FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t11a_id(9501)),
  'the one row outside p3 that changed is the call that pointed at an erased call, and only its link');
SELECT pg_temp.t11a_assert(EXISTS (SELECT 1 FROM platform_private.telephony_pbx_events WHERE organization_id = pg_temp.t11a_id(1)
      AND fields ->> 'phone' = '996555291003' AND pbx_callid IS NULL)
  AND (SELECT r.by_lead AND NOT r.by_phone AND NOT r.by_client FROM platform_private.telephony_erasure_requests r
      WHERE r.request_id = pg_temp.t11a_id(9421)),
  'by the lead alone, the evidence row that carries only the number is not reachable (the runbook asks for the number as well)');
-- The number completes it.
SELECT pg_temp.t11a_mark('p3b', 1, 'p3', '996555291003', 'all');
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('p3b') > 0, 'the p3b snapshot is not empty');
SELECT platform.telephony_erase_person_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9422), pg_temp.t11a_id(301),
  '996555291003')::TEXT AS t11a_p3b \gset
SELECT pg_temp.t11a_assert((:'t11a_p3b'::JSONB)->'counts' = pg_temp.t11a_expected('p3b') AND pg_temp.t11a_left('p3b') = ''
    AND pg_temp.t11a_changed('p3b') = '' AND (:'t11a_p3b'::JSONB)->'counts'->>'pbx_events' = '1',
  'the number then removes the remaining evidence row, and nothing else');

-- ---------------------------------------------------------------------------
-- 8. A number nobody owns (no client): found by the number alone.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t11a_mark('u', 1, 'u', '996555291004', 'all');
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('u') > 0, 'the u snapshot is not empty');
SELECT platform.telephony_erase_person_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9431), pg_temp.t11a_id(303),
  '+996555291004')::TEXT AS t11a_u \gset
SELECT pg_temp.t11a_assert((:'t11a_u'::JSONB)->>'status' = 'erased' AND (:'t11a_u'::JSONB)->'counts' = pg_temp.t11a_expected('u')
    AND (:'t11a_u'::JSONB)->'task_ids' = pg_temp.t11a_task_ids('u')
    AND pg_temp.t11a_left('u') = '' AND pg_temp.t11a_changed('u') = '' AND (:'t11a_u'::JSONB)->'counts'->>'calls' = '5'
    AND (:'t11a_u'::JSONB)->'counts'->>'dial_requests' = '0',
  'a caller with no client is erased by the number alone: calls, legs, chronology, grants, links and evidence');

-- Everything that was never asked about is exactly as built.
SELECT pg_temp.t11a_assert((SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid ~ '^(q|tw)-') = 10
  AND (SELECT count(*) FROM platform_private.telephony_dial_requests) = 4
  AND (SELECT count(*) FROM platform_private.telephony_recording_grants) = 2
  AND (SELECT count(*) FROM platform_private.telephony_task_links) = 4
  AND (SELECT count(*) FROM platform_private.telephony_call_legs WHERE recording_link IS NOT NULL) = 2
  AND (SELECT count(*) FROM platform_private.telephony_erasure_requests) = 7,
  'only the bystander and the other organization remain, with their links, grants, task links and dial requests; seven person receipts');
SELECT pg_temp.t11a_assert(pg_temp.t11a_marker() = ''
  AND pg_temp.t11a_state('DELETE FROM platform_private.telephony_pbx_events') = '55000'
  AND pg_temp.t11a_state('DELETE FROM platform_private.telephony_call_events') = '55000'
  AND pg_temp.t11a_state('UPDATE platform_private.telephony_pbx_events SET has_link = NOT has_link') = '55000'
  AND pg_temp.t11a_state('TRUNCATE platform_private.telephony_call_events') = '55000',
  'after the erasures the evidence and the chronology are append-only again');
-- The completed receipts and the transaction mark cannot reopen the lock.
SELECT set_config('platform.telephony_erasure_request_id', (SELECT id::TEXT FROM platform_private.telephony_erasure_requests
  WHERE request_id = pg_temp.t11a_id(9402)), TRUE);
SELECT pg_temp.t11a_assert(pg_temp.t11a_state('DELETE FROM platform_private.telephony_pbx_events') = '55000'
  AND pg_temp.t11a_state('DELETE FROM platform_private.telephony_call_events') = '55000',
  'the marker of a finished erasure does not open the lock');
SELECT set_config('platform.telephony_erasure_request_id', '', TRUE);
SELECT pg_temp.t11a_assert(NOT EXISTS (SELECT 1 FROM platform_private.telephony_erasure_requests r WHERE r.erasure_transaction_id IS NOT NULL
      OR r.completed_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_erasure_requests r WHERE to_jsonb(r)::TEXT ~ '555291|\+996'),
  'every receipt is complete, holds no transaction mark and no number');

-- ---------------------------------------------------------------------------
-- 9. Retention: evidence older than twelve months, in batches.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t11a_ev(p_n INTEGER, p_org INTEGER, p_age INTERVAL, p_work TEXT, p_rejected BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := pg_temp.t11a_id(5000 + p_n); v_org UUID := pg_temp.t11a_id(p_org);
BEGIN
  IF p_rejected THEN
    INSERT INTO platform_private.telephony_pbx_events(id, organization_id, received_at, request_id, cmd, body_sha256, token_slot,
      validation_state, form_shape)
    VALUES (v_id, v_org, clock_timestamp() - p_age, v_id, 'bad_event', encode(sha256(('t11a-ret-body-' || p_n)::BYTEA), 'hex'),
      'current', 'rejected', '{"callid":3,"phone":12}'::JSONB);
  ELSE
    INSERT INTO platform_private.telephony_pbx_events(id, organization_id, received_at, request_id, cmd, event_type, pbx_callid,
      dedup_key, body_sha256, token_slot, validation_state, fields)
    VALUES (v_id, v_org, clock_timestamp() - p_age, v_id, 'event', 'INCOMING', 'ret-' || p_n,
      encode(sha256(('t11a-ret-' || p_n)::BYTEA), 'hex'), encode(sha256(('t11a-ret-body-' || p_n)::BYTEA), 'hex'), 'current', 'ok',
      jsonb_build_object('cmd', 'event', 'type', 'INCOMING', 'callid', 'ret-' || p_n, 'phone', '996555291050'));
  END IF;
  IF p_work = 'succeeded' THEN
    INSERT INTO platform_private.telephony_event_work(organization_id, event_id, state, attempt_count, completed_at)
    VALUES (v_org, v_id, 'succeeded', 1, clock_timestamp());
  ELSIF p_work = 'dead_lettered' THEN
    INSERT INTO platform_private.telephony_event_work(organization_id, event_id, state, attempt_count, last_error_code, completed_at)
    VALUES (v_org, v_id, 'dead_lettered', 8, 'projection_failed', clock_timestamp());
  ELSIF p_work = 'queued' THEN
    INSERT INTO platform_private.telephony_event_work(organization_id, event_id) VALUES (v_org, v_id);
  ELSIF p_work = 'leased' THEN
    INSERT INTO platform_private.telephony_event_work(organization_id, event_id, state, attempt_count, lease_owner, lease_expires_at)
    VALUES (v_org, v_id, 'leased', 1, 'w', clock_timestamp() + INTERVAL '1 minute');
  ELSIF p_work = 'retry_wait' THEN
    INSERT INTO platform_private.telephony_event_work(organization_id, event_id, state, attempt_count, last_error_code)
    VALUES (v_org, v_id, 'retry_wait', 1, 'projection_failed');
  END IF;
END
$$;
-- Purgeable in organization 1: 1 (20 months, no work), 2 (19, succeeded), 3 (18, dead letter), 9 (17, rejected), 11 (12 months
-- and one hour). Kept: 4, 5, 6 (13 months, work still open), 7 (11 months), 8 (new), 12 (11 months 29 days), 10 (organization 2).
SELECT pg_temp.t11a_ev(1, 1, INTERVAL '20 months', NULL);
SELECT pg_temp.t11a_ev(2, 1, INTERVAL '19 months', 'succeeded');
SELECT pg_temp.t11a_ev(3, 1, INTERVAL '18 months', 'dead_lettered');
SELECT pg_temp.t11a_ev(4, 1, INTERVAL '13 months', 'queued');
SELECT pg_temp.t11a_ev(5, 1, INTERVAL '13 months', 'leased');
SELECT pg_temp.t11a_ev(6, 1, INTERVAL '13 months', 'retry_wait');
SELECT pg_temp.t11a_ev(7, 1, INTERVAL '11 months', 'succeeded');
SELECT pg_temp.t11a_ev(8, 1, INTERVAL '0 seconds', 'succeeded');
SELECT pg_temp.t11a_ev(9, 1, INTERVAL '17 months', NULL, TRUE);
SELECT pg_temp.t11a_ev(10, 2, INTERVAL '13 months', 'succeeded');
SELECT pg_temp.t11a_ev(11, 1, INTERVAL '12 months 1 hour', NULL);
SELECT pg_temp.t11a_ev(12, 1, INTERVAL '11 months 29 days', 'succeeded');
SELECT pg_temp.t11a_assert((SELECT cardinality(phone_match_keys) > 0 FROM platform_private.telephony_pbx_events WHERE id = pg_temp.t11a_id(5001))
  AND (SELECT cardinality(phone_match_keys) = 0 FROM platform_private.telephony_pbx_events WHERE id = pg_temp.t11a_id(5009)),
  'the retention fixture: aged evidence carries keys, the aged rejected form has none');

INSERT INTO t11a_reach SELECT 'ret1', 'platform_private.telephony_pbx_events', e.ctid FROM platform_private.telephony_pbx_events e
  WHERE e.id IN (pg_temp.t11a_id(5001), pg_temp.t11a_id(5002));
INSERT INTO t11a_reach SELECT 'ret1', 'platform_private.telephony_event_work', w.ctid FROM platform_private.telephony_event_work w
  WHERE w.event_id IN (pg_temp.t11a_id(5001), pg_temp.t11a_id(5002));
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('ret1') > 0, 'the ret1 snapshot is not empty');
SELECT pg_temp.t11a_sizes() AS t11a_sizes_before \gset
SELECT platform.telephony_purge_evidence_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9501), 2, TRUE)::TEXT AS t11a_rdry \gset
SELECT pg_temp.t11a_assert((:'t11a_rdry'::JSONB)->>'status' = 'dry_run' AND (:'t11a_rdry'::JSONB)->>'has_more' = 'true'
    AND (:'t11a_rdry'::JSONB)->>'blocked_by_work' = '3'
    AND (:'t11a_rdry'::JSONB)->'counts' = '{"pbx_events":2,"event_work":1}'::JSONB
    AND pg_temp.t11a_sizes() = :'t11a_sizes_before' AND pg_temp.t11a_marker() = ''
    AND (SELECT count(*) FROM platform_private.telephony_erasure_requests) = 7,
  'retention dry run: two of five in the batch, three blocked by open work, nothing changed, no receipt');
SELECT platform.telephony_purge_evidence_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9502), 2)::TEXT AS t11a_r1 \gset
SELECT pg_temp.t11a_assert((:'t11a_r1'::JSONB)->>'status' = 'purged' AND (:'t11a_r1'::JSONB)->>'has_more' = 'true'
    AND (:'t11a_r1'::JSONB)->'counts' = '{"pbx_events":2,"event_work":1}'::JSONB
    AND pg_temp.t11a_left('ret1') = '' AND pg_temp.t11a_changed('ret1') = '' AND pg_temp.t11a_marker() = '',
  'the first batch removes the two oldest evidence rows and the finished work of one of them, and nothing else');
SELECT pg_temp.t11a_assert((SELECT r.kind = 'retention' AND r.actor_membership_id IS NULL AND NOT r.by_phone AND NOT r.by_client
      AND NOT r.by_lead AND r.phone_last4 IS NULL AND r.erasure_transaction_id IS NULL AND r.completed_at IS NOT NULL
      AND r.summary = '{"pbx_events":2,"event_work":1}'::JSONB
      AND r.retention_cutoff BETWEEN clock_timestamp() - INTERVAL '367 days' AND clock_timestamp() - INTERVAL '364 days'
    FROM platform_private.telephony_erasure_requests r WHERE r.request_id = pg_temp.t11a_id(9502)),
  'the retention receipt: no Admin, no selector, no number, the cutoff twelve months back, the counts');
SELECT pg_temp.t11a_sizes() AS t11a_sizes_before \gset
SELECT platform.telephony_purge_evidence_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9502), 2)::TEXT AS t11a_rreplay \gset
SELECT pg_temp.t11a_assert((:'t11a_rreplay'::JSONB)->>'status' = 'replayed' AND (:'t11a_rreplay'::JSONB)->'counts' = '{"pbx_events":2,"event_work":1}'::JSONB
    AND pg_temp.t11a_sizes() = :'t11a_sizes_before',
  'the same retention id replays and removes nothing');
INSERT INTO t11a_reach SELECT 'ret2', 'platform_private.telephony_pbx_events', e.ctid FROM platform_private.telephony_pbx_events e
  WHERE e.id IN (pg_temp.t11a_id(5003), pg_temp.t11a_id(5009), pg_temp.t11a_id(5011));
INSERT INTO t11a_reach SELECT 'ret2', 'platform_private.telephony_event_work', w.ctid FROM platform_private.telephony_event_work w
  WHERE w.event_id IN (pg_temp.t11a_id(5003), pg_temp.t11a_id(5009), pg_temp.t11a_id(5011));
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('ret2') > 0, 'the ret2 snapshot is not empty');
SELECT platform.telephony_purge_evidence_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9503), 100)::TEXT AS t11a_r2 \gset
SELECT pg_temp.t11a_assert((:'t11a_r2'::JSONB)->>'status' = 'purged' AND (:'t11a_r2'::JSONB)->>'has_more' = 'false'
    AND (:'t11a_r2'::JSONB)->'counts' = '{"pbx_events":3,"event_work":1}'::JSONB AND (:'t11a_r2'::JSONB)->>'blocked_by_work' = '3'
    AND pg_temp.t11a_left('ret2') = '' AND pg_temp.t11a_changed('ret2') = '',
  'the second batch removes the rest: a dead letter, a rejected form and evidence just over twelve months; open work keeps its evidence');
SELECT pg_temp.t11a_assert((SELECT count(*) FROM platform_private.telephony_pbx_events e WHERE e.id IN (pg_temp.t11a_id(5004), pg_temp.t11a_id(5005),
      pg_temp.t11a_id(5006), pg_temp.t11a_id(5007), pg_temp.t11a_id(5008), pg_temp.t11a_id(5010), pg_temp.t11a_id(5012))) = 7
  AND (SELECT count(*) FROM platform_private.telephony_event_work w WHERE w.event_id IN (pg_temp.t11a_id(5004), pg_temp.t11a_id(5005),
      pg_temp.t11a_id(5006), pg_temp.t11a_id(5007), pg_temp.t11a_id(5008), pg_temp.t11a_id(5010), pg_temp.t11a_id(5012))) = 7,
  'kept: queued, leased and retrying work (13 months), evidence of 11 months and 11 months 29 days, new evidence, the other organization');
SELECT platform.telephony_purge_evidence_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9504), 100)::TEXT AS t11a_r3 \gset
SELECT pg_temp.t11a_assert((:'t11a_r3'::JSONB)->>'status' = 'nothing' AND (:'t11a_r3'::JSONB)->>'blocked_by_work' = '3'
    AND (SELECT count(*) FROM platform_private.telephony_erasure_requests) = 9
    AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_erasure_requests r WHERE r.request_id = pg_temp.t11a_id(9504)),
  'with nothing left to purge the answer is "nothing" and no receipt is written');
-- Work that finishes unlocks its evidence; another organization is purged on its own request.
UPDATE platform_private.telephony_event_work SET state = 'succeeded', attempt_count = 1, completed_at = clock_timestamp(),
  lease_owner = NULL, lease_expires_at = NULL WHERE event_id = pg_temp.t11a_id(5005);
INSERT INTO t11a_reach SELECT 'ret3', 'platform_private.telephony_pbx_events', e.ctid FROM platform_private.telephony_pbx_events e
  WHERE e.id = pg_temp.t11a_id(5005);
INSERT INTO t11a_reach SELECT 'ret3', 'platform_private.telephony_event_work', w.ctid FROM platform_private.telephony_event_work w
  WHERE w.event_id = pg_temp.t11a_id(5005);
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('ret3') > 0, 'the ret3 snapshot is not empty');
SELECT platform.telephony_purge_evidence_v1(pg_temp.t11a_id(1), pg_temp.t11a_id(9505))::TEXT AS t11a_r4 \gset
SELECT pg_temp.t11a_assert((:'t11a_r4'::JSONB)->'counts' = '{"pbx_events":1,"event_work":1}'::JSONB AND (:'t11a_r4'::JSONB)->>'blocked_by_work' = '2'
    AND pg_temp.t11a_left('ret3') = '' AND pg_temp.t11a_changed('ret3') = '',
  'evidence whose work has finished becomes purgeable; the rest stays blocked');
INSERT INTO t11a_reach SELECT 'ret4', 'platform_private.telephony_pbx_events', e.ctid FROM platform_private.telephony_pbx_events e
  WHERE e.id = pg_temp.t11a_id(5010);
INSERT INTO t11a_reach SELECT 'ret4', 'platform_private.telephony_event_work', w.ctid FROM platform_private.telephony_event_work w
  WHERE w.event_id = pg_temp.t11a_id(5010);
SELECT pg_temp.t11a_assert(pg_temp.t11a_snapshot('ret4') > 0, 'the ret4 snapshot is not empty');
SELECT platform.telephony_purge_evidence_v1(pg_temp.t11a_id(2), pg_temp.t11a_id(9506))::TEXT AS t11a_r5 \gset
SELECT pg_temp.t11a_assert((:'t11a_r5'::JSONB)->'counts' = '{"pbx_events":1,"event_work":1}'::JSONB
    AND pg_temp.t11a_left('ret4') = '' AND pg_temp.t11a_changed('ret4') = ''
    AND (SELECT r.organization_id = pg_temp.t11a_id(2) FROM platform_private.telephony_erasure_requests r WHERE r.request_id = pg_temp.t11a_id(9506)),
  'organization 2 is purged on its own request and its receipt belongs to it');
-- The request id is per organization: organization 2 may use an id organization 1 used.
SELECT pg_temp.t11a_assert(pg_temp.t11a_state(format('SELECT platform.telephony_purge_evidence_v1(%L, %L)',
      pg_temp.t11a_id(2), pg_temp.t11a_id(9502))) = 'ok'
  AND (SELECT count(*) FROM platform_private.telephony_erasure_requests WHERE request_id = pg_temp.t11a_id(9502)) = 1,
  'a retention id used by organization 1 is free for organization 2 (nothing to purge there, so no receipt)');
SELECT pg_temp.t11a_assert(pg_temp.t11a_err(format('SELECT platform.telephony_erase_person_v1(%L, %L, %L, ''996555291999'')',
    pg_temp.t11a_id(1), pg_temp.t11a_id(9503), pg_temp.t11a_id(301))) = '22023:telephony_erasure_request_conflict',
  'a retention id cannot be used as a person id');
-- Arguments.
SELECT pg_temp.t11a_assert(
  pg_temp.t11a_state(format('SELECT platform.telephony_purge_evidence_v1(%L, %L, 0)', pg_temp.t11a_id(1), pg_temp.t11a_id(9601))) = '22023'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_purge_evidence_v1(%L, %L, 50001)', pg_temp.t11a_id(1), pg_temp.t11a_id(9601))) = '22023'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_purge_evidence_v1(%L, %L, NULL)', pg_temp.t11a_id(1), pg_temp.t11a_id(9601))) = '22023'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_purge_evidence_v1(%L, %L, 10, NULL)', pg_temp.t11a_id(1), pg_temp.t11a_id(9601))) = '22023'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_purge_evidence_v1(NULL, %L)', pg_temp.t11a_id(9601))) = '22023'
  AND pg_temp.t11a_state('SELECT platform.telephony_purge_evidence_v1(' || quote_literal(pg_temp.t11a_id(1)) || ', NULL)') = '22023'
  AND pg_temp.t11a_err(format('SELECT platform.telephony_purge_evidence_v1(%L, %L)', pg_temp.t11a_id(99), pg_temp.t11a_id(9601)))
    = '22023:telephony_unknown_organization'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_purge_evidence_v1(%L, %L, 50000, TRUE)', pg_temp.t11a_id(1), pg_temp.t11a_id(9601))) = 'ok'
  AND pg_temp.t11a_state(format('SELECT platform.telephony_purge_evidence_v1(%L, %L, 1, TRUE)', pg_temp.t11a_id(1), pg_temp.t11a_id(9601))) = 'ok',
  'the batch size is 1 to 50000; NULL arguments and an unknown organization are argument errors');

-- ---------------------------------------------------------------------------
-- 10. Final posture: the lock is closed, the retention touched neither calls nor chronology, the bystanders are intact.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t11a_assert(pg_temp.t11a_marker() = ''
  AND pg_temp.t11a_state('DELETE FROM platform_private.telephony_pbx_events') = '55000'
  AND pg_temp.t11a_state('DELETE FROM platform_private.telephony_call_events') = '55000'
  AND pg_temp.t11a_state('UPDATE platform_private.telephony_pbx_events SET has_link = NOT has_link') = '55000'
  AND pg_temp.t11a_state('UPDATE platform_private.telephony_call_events SET event_type = ''x''') = '55000'
  AND pg_temp.t11a_state('TRUNCATE platform_private.telephony_pbx_events CASCADE') = '55000'
  AND pg_temp.t11a_state('TRUNCATE platform_private.telephony_call_events') = '55000',
  'the evidence and the chronology are append-only after every function');
SELECT pg_temp.t11a_assert((SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid ~ '^(q|tw)-') = 10
  AND (SELECT count(*) FROM platform_private.telephony_call_legs l JOIN platform_private.telephony_calls c
      ON c.organization_id = l.organization_id AND c.id = l.call_id WHERE c.pbx_callid ~ '^(q|tw)-') = 10
  AND (SELECT count(*) FROM platform_private.telephony_call_events e JOIN platform_private.telephony_calls c
      ON c.organization_id = e.organization_id AND c.id = e.call_id WHERE c.pbx_callid ~ '^(q|tw)-') > 20
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE pbx_callid ~ '^(q|tw)-') > 20,
  'the bystander and the other organization still hold every call, leg, chronology row and evidence row');
SELECT pg_temp.t11a_assert(NOT EXISTS (SELECT 1 FROM platform_private.telephony_erasure_requests r WHERE to_jsonb(r)::TEXT ~ '555291|\+996|https?://')
  AND (SELECT count(*) FROM platform_private.telephony_erasure_requests WHERE kind = 'person') = 7
  AND (SELECT count(*) FROM platform_private.telephony_erasure_requests WHERE kind = 'retention') = 4,
  'the receipts hold no number and no link: seven person receipts, four retention receipts');

\echo T11A_TELEPHONY_ERASURE_SUITE_END
SELECT 'T11A_TELEPHONY_ERASURE_SUITE_PASSED' AS t11a_suite_marker;
ROLLBACK;
