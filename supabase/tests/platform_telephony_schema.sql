\set ON_ERROR_STOP on
-- Boundary suite for migration 287 «Телефония Beeline KG» срез T1a (схема и
-- RLS; docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.2, §6, §7.1, §9.1, §11;
-- ADR 0033, решения 3–5). Runs on the real chain right after 287 inside one
-- transaction that is rolled back, with its own synthetic organizations,
-- members, clients, leads and tasks: no provider, no real person, no real
-- phone, no recording, no production action. There are no telephony
-- functions yet (T1b): rows are written as the table owner, which is how the
-- SECURITY DEFINER functions of the next slices will write them.
--
-- Proves:
--  1. catalog: exactly eleven telephony_* tables in platform_private, empty,
--     owned by postgres, ENABLE and FORCE ROW LEVEL SECURITY, no policy, no
--     table or column privilege for PUBLIC, anon, authenticated,
--     service_role, supabase_auth_admin and the AI agent role; the five
--     check helpers exist only in platform_private, immutable, with an empty
--     search_path and no EXECUTE for any client role; nothing else named
--     telephony_* exists in platform, public or private (no intake yet);
--  2. deny-all by behaviour: for each of the four client roles and each of
--     the eleven tables SELECT, INSERT, UPDATE, DELETE and TRUNCATE fail
--     with 42501;
--  3. the recording link is a secret in one place: the only column of the
--     eleven tables that can hold a link is telephony_call_legs.recording_link,
--     evidence and the work queue carry only has_link; the evidence fields
--     refuse crm_token, link, record and the like, nested values, oversized
--     keys and values; the chronology keeps a soft (non-FK) evidence
--     reference so the 12-month purge of evidence (T11) cannot block it;
--  4. every flag ships OFF and the shipped defaults are exactly the plan's
--     (working hours, callback term, prefixes, dial limits, ceilings,
--     cadence); every hard bound and cross-field rule refuses what it must;
--  5. append-only: UPDATE, DELETE and TRUNCATE of the evidence and the
--     chronology are refused (55000), even for the owner;
--  6. evidence: dedup key unique per organization (rejected forms carry none
--     and repeat), request id unique, state/shape rules (ok, incomplete,
--     rejected), token slot, hash shapes, cross-organization reference refused;
--  7. work queue: one work row per evidence, lease and state shapes, attempts
--     within max, dead letters carry a code;
--  8. calls and legs: unique call id per organization, state/outcome rules
--     (ringing without outcome, answered means outcome answered, ended has an
--     outcome and an end), pull-only no_answer_unknown, client/lead match
--     rules, result rules, dial rules, the leg key (call, user, start), the
--     link-state pairing (a link exists exactly when the recording is
--     available or temporarily unavailable), the not-found pair, lower-case
--     status words, cross-organization references refused, RESTRICT (a call
--     with legs, a lead with calls cannot be deleted);
--  9. dial requests: idempotency per organization, member and request id (a
--     different member may reuse an id), refusal needs a code and only a
--     refusal has one, a sent request has the PBX call id, a non-refusal has
--     phone, user and a client or lead;
-- 10. extensions: one active PBX user per member (a deactivated one may
--     repeat), no ivr/fax/blank logins, unique login per organization;
-- 11. grants and task links: term and use counters, one open task per
--     (kind, subject) with subject = lead, else client, else call, closed
--     links free the slot, one link per task.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- The agent role is granted to the harness user inside this transaction only.
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

\echo T287_TELEPHONY_SCHEMA_SUITE_START

CREATE FUNCTION pg_temp.t287_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('28700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t287_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T287: %', message; END IF;
END
$$;
-- SQLSTATE of a failing statement, 'ok' when it succeeds (current role).
CREATE FUNCTION pg_temp.t287_state(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;
-- The same as a client role.
CREATE FUNCTION pg_temp.t287_as(p_role TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE result TEXT;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
    result := 'ok';
  EXCEPTION WHEN OTHERS THEN
    result := SQLSTATE;
  END;
  RESET ROLE;
  RETURN result;
END
$$;
-- A random 64-character lower-case hex string.
CREATE FUNCTION pg_temp.t287_hex() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT encode(sha256(gen_random_uuid()::TEXT::BYTEA), 'hex')
$$;
-- Insert one row built from a JSON map of column values over the table's base
-- row; the column list comes from the map, everything else takes the table's
-- defaults. Returns 'ok' or the SQLSTATE.
CREATE FUNCTION pg_temp.t287_base(p_table TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN CASE p_table
    WHEN 'telephony_settings' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1))
    WHEN 'telephony_runtime_state' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1))
    WHEN 'telephony_extensions' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1),
      'pbx_user', 'u-' || left(gen_random_uuid()::TEXT, 8))
    WHEN 'telephony_pbx_events' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1),
      'request_id', gen_random_uuid(), 'cmd', 'event', 'event_type', 'INCOMING',
      'pbx_callid', 'c-' || left(gen_random_uuid()::TEXT, 8), 'dedup_key', pg_temp.t287_hex(),
      'body_sha256', pg_temp.t287_hex(), 'token_slot', 'current', 'validation_state', 'ok',
      'fields', jsonb_build_object('cmd', 'event', 'type', 'INCOMING', 'direction', 'in'))
    WHEN 'telephony_event_work' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1))
    WHEN 'telephony_dial_requests' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1),
      'request_id', gen_random_uuid(), 'membership_id', pg_temp.t287_id(301), 'client_id', pg_temp.t287_id(701),
      'lead_id', pg_temp.t287_id(702), 'pbx_user', 'u-dial', 'client_phone', '+996555000111',
      'status', 'requested')
    WHEN 'telephony_calls' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1),
      'pbx_callid', 'c-' || left(gen_random_uuid()::TEXT, 8), 'direction', 'in',
      'started_at', '2031-01-07T09:00:00Z', 'created_via', 'webhook')
    WHEN 'telephony_call_legs' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1),
      'leg_started_at', '2031-01-07T09:00:01Z', 'leg_start_source', 'event')
    WHEN 'telephony_call_events' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1),
      'source', 'webhook', 'event_type', 'incoming', 'occurred_at', '2031-01-07T09:00:02Z',
      'pbx_event_id', gen_random_uuid())
    WHEN 'telephony_recording_grants' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1),
      'membership_id', pg_temp.t287_id(301), 'granted_at', '2031-01-07T09:00:00Z',
      'expires_at', '2031-01-07T09:15:00Z')
    WHEN 'telephony_task_links' THEN jsonb_build_object('organization_id', pg_temp.t287_id(1),
      'kind', 'missed_callback', 'lead_id', pg_temp.t287_id(702), 'scope_id', pg_temp.t287_id(702))
  END;
END
$$;
CREATE FUNCTION pg_temp.t287_ins(p_table TEXT, p_over JSONB) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_row JSONB := pg_temp.t287_base(p_table) || p_over;
  v_cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(k), ', ' ORDER BY k) INTO v_cols FROM jsonb_object_keys(v_row) AS k;
  EXECUTE format(
    'INSERT INTO platform_private.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::platform_private.%I, %L::JSONB)',
    p_table, v_cols, v_cols, p_table, v_row);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

CREATE TEMP TABLE t287_tables(name TEXT);
INSERT INTO t287_tables VALUES ('telephony_settings'), ('telephony_runtime_state'), ('telephony_extensions'),
  ('telephony_pbx_events'), ('telephony_event_work'), ('telephony_dial_requests'), ('telephony_calls'),
  ('telephony_call_legs'), ('telephony_call_events'), ('telephony_recording_grants'), ('telephony_task_links');
CREATE TEMP TABLE t287_roles(name TEXT);
INSERT INTO t287_roles VALUES ('anon'), ('authenticated'), ('service_role'), ('evo_ai_agent');

-- ---------------------------------------------------------------------------
-- 1. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert((SELECT array_agg(c.relname::TEXT ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'platform_private' AND c.relname LIKE 'telephony\_%' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f'))
  = (SELECT array_agg(t.name ORDER BY t.name) FROM t287_tables t),
  'exactly the eleven telephony tables exist in platform_private (no view, sequence or extra table)');
SELECT pg_temp.t287_assert((SELECT bool_and(c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
      AND pg_get_userbyid(c.relowner) = 'postgres'
      AND NOT EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0)
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'platform_private' AND p.tablename = c.relname))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'platform_private' AND c.relname IN (SELECT name FROM t287_tables)),
  'every telephony table: ordinary table, owner postgres, ENABLE and FORCE RLS, no policy, no grant to PUBLIC');
SELECT pg_temp.t287_assert((SELECT NOT EXISTS (
      SELECT 1 FROM t287_tables t CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'),
        ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
      WHERE has_table_privilege(r.role, ('platform_private.' || t.name)::REGCLASS,
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        OR has_any_column_privilege(r.role, ('platform_private.' || t.name)::REGCLASS, 'SELECT, INSERT, UPDATE, REFERENCES'))),
  'no table or column privilege for anon, authenticated, service_role, supabase_auth_admin or the AI agent');
SELECT pg_temp.t287_assert((SELECT NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid IN (SELECT ('platform_private.' || t.name)::REGCLASS FROM t287_tables t)
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)),
  'no column carries its own ACL');
SELECT pg_temp.t287_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname LIKE 'telephony\_%')
  = ARRAY['telephony_cadence_ok', 'telephony_cadence_step_ok', 'telephony_fields_ok', 'telephony_form_shape_ok',
    'telephony_prefixes_ok'],
  'the only telephony_* functions are the five check helpers (no intake, projection or reader yet)');
SELECT pg_temp.t287_assert((SELECT bool_and(n.nspname = 'platform_private' AND p.provolatile = 'i'
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[] AND NOT p.prosecdef
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname LIKE 'telephony\_%'),
  'the check helpers: platform_private, immutable, empty search_path, no EXECUTE for any client role');
DO $t287_empty$
DECLARE t TEXT; n BIGINT;
BEGIN
  FOR t IN SELECT name FROM t287_tables LOOP
    EXECUTE format('SELECT count(*) FROM platform_private.%I', t) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'T287: the migration shipped % rows into %', n, t; END IF;
  END LOOP;
END
$t287_empty$;

-- ---------------------------------------------------------------------------
-- 2. Deny-all by behaviour for every client role and statement.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert((SELECT count(*) = 220 AND bool_and(pg_temp.t287_as(r.name, format(s.stmt, t.name)) = '42501')
    FROM t287_tables t CROSS JOIN t287_roles r
    CROSS JOIN (VALUES ('SELECT count(*) FROM platform_private.%s'),
      ('INSERT INTO platform_private.%s DEFAULT VALUES'),
      ('UPDATE platform_private.%s SET organization_id = organization_id'),
      ('DELETE FROM platform_private.%s'),
      ('TRUNCATE platform_private.%s')) s(stmt)),
  '4 client roles x 11 tables x 5 statements = 220 attempts, each refused with 42501');

-- ---------------------------------------------------------------------------
-- Fixture: organization 1 (members 301 and 302, clients 701/703, leads
-- 702/704, tasks 801/802) and organization 2 (member 305, client 707, lead
-- 708, task 803).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.t287_id(1), 'T287 Fictional organization'),
  (pg_temp.t287_id(2), 'T287 Other fictional organization');
CREATE TEMP TABLE t287_actors(n INTEGER, org INTEGER);
INSERT INTO t287_actors VALUES (1, 1), (2, 1), (5, 2);
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t287_id(100 + n), 't287-' || n || '@example.invalid', '{}'::JSONB FROM t287_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t287_id(200 + n), pg_temp.t287_id(100 + n), 'T287 Actor ' || n, 'active', 1 FROM t287_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t287_id(300 + n), pg_temp.t287_id(org), pg_temp.t287_id(200 + n), 'active', NULL, NULL FROM t287_actors;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name) VALUES
  (pg_temp.t287_id(701), pg_temp.t287_id(1), 'T287 Client A', platform_private.normalize_person_name('T287 Client A')),
  (pg_temp.t287_id(703), pg_temp.t287_id(1), 'T287 Client B', platform_private.normalize_person_name('T287 Client B')),
  (pg_temp.t287_id(707), pg_temp.t287_id(2), 'T287 Client C', platform_private.normalize_person_name('T287 Client C'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key) VALUES
  (pg_temp.t287_id(702), pg_temp.t287_id(1), pg_temp.t287_id(701), pg_temp.t287_id(301), 'new', 'website'),
  (pg_temp.t287_id(704), pg_temp.t287_id(1), pg_temp.t287_id(703), pg_temp.t287_id(301), 'new', 'website'),
  (pg_temp.t287_id(708), pg_temp.t287_id(2), pg_temp.t287_id(707), pg_temp.t287_id(305), 'new', 'website');
INSERT INTO platform.staff_tasks(id, organization_id, creator_membership_id, assignee_membership_id, title) VALUES
  (pg_temp.t287_id(801), pg_temp.t287_id(1), pg_temp.t287_id(301), pg_temp.t287_id(301), 'T287 task 1'),
  (pg_temp.t287_id(802), pg_temp.t287_id(1), pg_temp.t287_id(301), pg_temp.t287_id(302), 'T287 task 2'),
  (pg_temp.t287_id(803), pg_temp.t287_id(2), pg_temp.t287_id(305), pg_temp.t287_id(305), 'T287 task 3');

-- ---------------------------------------------------------------------------
-- 4. Settings: shipped defaults and every bound.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_settings', '{}') = 'ok', 'a settings row takes all defaults');
SELECT pg_temp.t287_assert((SELECT NOT ui_enabled AND NOT dial_enabled AND NOT projection_enabled
      AND NOT missed_task_enabled AND NOT unknown_lead_enabled AND NOT outbound_paused
      AND timezone = 'Asia/Bishkek' AND working_days = '{1,2,3,4,5,6}' AND work_from = '10:00' AND work_to = '20:00'
      AND callback_work_minutes = 15 AND escalation_membership_id IS NULL AND dial_prefixes = '{+996}'
      AND limit_user_day = 150 AND limit_user_gap_seconds = 5 AND limit_org_hour = 60 AND limit_org_day = 400
      AND ceiling_leads_hour = 10 AND ceiling_leads_day = 40 AND ceiling_tasks_hour = 30 AND ceiling_tasks_day = 120
      AND no_answer_cadence = '[{"unit":"work_hours","n":2},{"unit":"next_work_day_at","at":"11:00"},{"unit":"work_days","n":2}]'::JSONB
      AND reached_default_step_days IS NULL AND version = 1 AND updated_by_membership_id IS NULL
    FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t287_id(1)),
  'defaults: every flag OFF, Mon-Sat 10:00-20:00 Bishkek, 15 work minutes, +996, 150/5s/60/400, ceilings 10/40/30/120, cadence 2h/next day 11:00/2 days');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_settings', '{}') = '23505', 'one settings row per organization');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_settings', jsonb_build_object('organization_id', pg_temp.t287_id(2),
    'escalation_membership_id', pg_temp.t287_id(301))) = '23503',
  'the escalation member must belong to the same organization');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_settings', jsonb_build_object('organization_id', pg_temp.t287_id(2),
    'updated_by_membership_id', pg_temp.t287_id(301))) = '23503',
  'the updating member must belong to the same organization');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_settings', jsonb_build_object('organization_id', pg_temp.t287_id(2),
    'escalation_membership_id', pg_temp.t287_id(305), 'updated_by_membership_id', pg_temp.t287_id(305),
    'ui_enabled', true, 'dial_prefixes', '["+996","+7","+90"]'::JSONB, 'working_days', '[1,2,3,4,5]'::JSONB,
    'work_from', '09:00', 'work_to', '18:30', 'callback_work_minutes', 30, 'reached_default_step_days', 7,
    'limit_user_day', 1000, 'limit_org_hour', 5000 - 4900, 'limit_org_day', 5000,
    'ceiling_leads_hour', 100, 'ceiling_leads_day', 400, 'ceiling_tasks_hour', 300, 'ceiling_tasks_day', 1200,
    'no_answer_cadence', '[{"unit":"work_hours","n":24},{"unit":"work_days","n":30}]'::JSONB)) = 'ok',
  'another organization''s row with its own member, extra prefixes, other hours and the extreme allowed values');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_state(format('UPDATE platform_private.telephony_settings SET %s WHERE organization_id = %L',
      s.assignment, pg_temp.t287_id(1))) = '23514'),
  'settings refuse: another time zone, bad working days, inverted hours, out-of-range term, limits and ceilings outside their hard bounds, hour above day, bad version, bad reached-step days')
  FROM (VALUES
    ('timezone = ''UTC'''), ('working_days = ''{}'''), ('working_days = ''{0}'''), ('working_days = ''{8}'''),
    ('working_days = ARRAY[1, NULL]::SMALLINT[]'), ('work_from = ''20:00'''), ('work_to = ''10:00'''),
    ('work_from = ''10:00'', work_to = ''10:00'''), ('callback_work_minutes = 0'), ('callback_work_minutes = 481'),
    ('limit_user_day = 0'), ('limit_user_day = 1001'), ('limit_user_gap_seconds = 0'), ('limit_user_gap_seconds = 3601'),
    ('limit_org_hour = 0'), ('limit_org_hour = 401'), ('limit_org_day = 5001'),
    ('ceiling_leads_hour = 0'), ('ceiling_leads_hour = 101'), ('ceiling_leads_day = 401'),
    ('ceiling_leads_hour = 41'), ('ceiling_tasks_hour = 301'), ('ceiling_tasks_day = 1201'), ('ceiling_tasks_hour = 121'),
    ('reached_default_step_days = 0'), ('reached_default_step_days = 31'), ('version = 0'),
    ('dial_prefixes = ''{}'''), ('dial_prefixes = ''{996}'''), ('dial_prefixes = ''{+996,+996}'''),
    ('dial_prefixes = ''{+0996}'''), ('dial_prefixes = ''{+99999}'''), ('dial_prefixes = ''{+}'''),
    ('dial_prefixes = ARRAY[''+996'', NULL]'), ('dial_prefixes = ''{" +996"}'''),
    ('dial_prefixes = (SELECT array_agg(''+'' || g) FROM generate_series(1, 21) g)'),
    ('no_answer_cadence = ''[]'''), ('no_answer_cadence = ''{}'''), ('no_answer_cadence = ''null'''),
    ('no_answer_cadence = ''[1]'''), ('no_answer_cadence = ''[{"unit":"minutes","n":5}]'''),
    ('no_answer_cadence = ''[{"unit":"work_hours","n":0}]'''), ('no_answer_cadence = ''[{"unit":"work_hours","n":25}]'''),
    ('no_answer_cadence = ''[{"unit":"work_days","n":31}]'''), ('no_answer_cadence = ''[{"unit":"work_days","n":"2"}]'''),
    ('no_answer_cadence = ''[{"unit":"work_days","n":2,"x":1}]'''), ('no_answer_cadence = ''[{"unit":"work_days"}]'''),
    ('no_answer_cadence = ''[{"unit":"next_work_day_at","at":"24:00"}]'''),
    ('no_answer_cadence = ''[{"unit":"next_work_day_at","at":"9:00"}]'''),
    ('no_answer_cadence = ''[{"unit":"next_work_day_at","at":11}]'''),
    ('no_answer_cadence = ''[{"unit":"next_work_day_at","at":"11:00","n":1}]'''),
    ('no_answer_cadence = (SELECT jsonb_agg(''{"unit":"work_hours","n":1}''::JSONB) FROM generate_series(1, 9))')
  ) s(assignment);
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_state(format('UPDATE platform_private.telephony_settings SET %s = NULL WHERE organization_id = %L',
      c, pg_temp.t287_id(1))) = '23502'),
  'no flag or setting can be NULL')
  FROM unnest(ARRAY['ui_enabled', 'dial_enabled', 'projection_enabled', 'missed_task_enabled', 'unknown_lead_enabled',
    'outbound_paused', 'timezone', 'working_days', 'work_from', 'work_to', 'callback_work_minutes', 'dial_prefixes',
    'limit_user_day', 'limit_user_gap_seconds', 'limit_org_hour', 'limit_org_day', 'ceiling_leads_hour',
    'ceiling_leads_day', 'ceiling_tasks_hour', 'ceiling_tasks_day', 'no_answer_cadence', 'version']) c;
SELECT pg_temp.t287_assert(pg_temp.t287_state(format('UPDATE platform_private.telephony_settings SET reached_default_step_days = 5, escalation_membership_id = %L, updated_by_membership_id = %L, dial_prefixes = ''{+996,+7}'' WHERE organization_id = %L',
    pg_temp.t287_id(302), pg_temp.t287_id(302), pg_temp.t287_id(1))) = 'ok',
  'a valid update (own-organization members, two prefixes, reached step) passes');

-- Runtime state.
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_runtime_state', '{}') = 'ok', 'a runtime row takes all defaults');
SELECT pg_temp.t287_assert((SELECT internal_calls_total = 0 AND automation_stopped_at IS NULL AND reconcile_cursor_at IS NULL
      AND backfill_cursor_at IS NULL AND last_event_at IS NULL
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t287_id(1)),
  'runtime state: counter 0, no cursor, no stop');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_runtime_state', '{}') = '23505', 'one runtime row per organization');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_state(format('UPDATE platform_private.telephony_runtime_state SET %s WHERE organization_id = %L',
      s.assignment, pg_temp.t287_id(1))) = '23514'),
  'runtime state refuses: an error time without a code (and back), a stop time without a code (and back), an unknown stop code, a negative counter, a free-text error code')
  FROM (VALUES ('last_pbx_error_at = now()'), ('last_pbx_error_code = ''boom'''),
    ('automation_stopped_at = now()'), ('automation_stop_code = ''tasks_day'''),
    ('automation_stopped_at = now(), automation_stop_code = ''lunch'''),
    ('internal_calls_total = -1'),
    ('last_pbx_error_at = now(), last_pbx_error_code = ''Boom Now''')) s(assignment);
SELECT pg_temp.t287_assert(pg_temp.t287_state(format('UPDATE platform_private.telephony_runtime_state SET last_pbx_error_at = now(), last_pbx_error_code = ''invalid_token'', automation_stopped_at = now(), automation_stop_code = ''leads_hour'', internal_calls_total = 3 WHERE organization_id = %L',
    pg_temp.t287_id(1))) = 'ok',
  'a valid error mark and a valid stop pass');

-- ---------------------------------------------------------------------------
-- 10. Extensions.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_extensions', jsonb_build_object('id', pg_temp.t287_id(901),
    'pbx_user', 'manager1', 'extension', '702', 'pbx_display_name', 'T287 Manager 1', 'membership_id', pg_temp.t287_id(301)))
  = 'ok' AND pg_temp.t287_ins('telephony_extensions', jsonb_build_object('pbx_user', 'unmapped')) = 'ok'
  AND pg_temp.t287_ins('telephony_extensions', jsonb_build_object('pbx_user', 'unmapped-2')) = 'ok',
  'a mapped user and several unmapped users (membership_id empty) are fine');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_extensions', jsonb_build_object('pbx_user', 'manager1')) = '23505',
  'a PBX login is unique within the organization');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_extensions', jsonb_build_object('organization_id', pg_temp.t287_id(2),
    'pbx_user', 'manager1', 'membership_id', pg_temp.t287_id(305))) = 'ok',
  'the same login may exist in another organization');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_extensions', jsonb_build_object('pbx_user', 'manager1-b',
    'membership_id', pg_temp.t287_id(301))) = '23505',
  'one member cannot hold two active PBX users');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_extensions', jsonb_build_object('pbx_user', 'manager1-old',
    'membership_id', pg_temp.t287_id(301), 'active', false)) = 'ok'
  AND pg_temp.t287_ins('telephony_extensions', jsonb_build_object('pbx_user', 'manager1-old2',
    'membership_id', pg_temp.t287_id(301), 'active', false)) = 'ok',
  'deactivated users of the same member may repeat (a renamed PBX login)');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_extensions', jsonb_build_object('pbx_user', 'x-cross',
    'membership_id', pg_temp.t287_id(305))) = '23503',
  'a PBX user cannot be mapped to another organization''s member');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_extensions', jsonb_build_object('pbx_user', s.val)) = '23514'),
  'a blank, padded, control-character, ivr/fax or 129-character login is refused')
  FROM (VALUES (''), (' manager'), ('manager '), (E'man\nager'), ('ivr'), ('IVR'), ('Fax'), (repeat('x', 129))) s(val);
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_extensions', jsonb_build_object('pbx_user', 'ext-' || s.n,
      s.col, s.val)) = '23514'),
  'an empty or 33-character extension and a 201-character display name are refused')
  FROM (VALUES (1, 'extension', ''), (2, 'extension', repeat('7', 33)), (3, 'pbx_display_name', repeat('n', 201))) s(n, col, val);

-- ---------------------------------------------------------------------------
-- 3 and 6. Evidence.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('id', pg_temp.t287_id(1001),
    'dedup_key', repeat('a', 64), 'request_id', pg_temp.t287_id(1101))) = 'ok'
  AND pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('id', pg_temp.t287_id(1002), 'cmd', 'history',
    'event_type', 'out', 'request_id', pg_temp.t287_id(1102), 'token_slot', 'next', 'has_link', true,
    'fields', '{"cmd":"history","type":"out","status":"Success","duration":12,"wait":3}'::JSONB)) = 'ok',
  'an event and a history with a link flag are stored (cleaned fields, no link)');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('dedup_key', repeat('a', 64))) = '23505',
  'the dedup key is unique within the organization');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('organization_id', pg_temp.t287_id(2),
    'dedup_key', repeat('a', 64))) = 'ok',
  'the same dedup key may exist in another organization');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('request_id', pg_temp.t287_id(1101))) = '23505',
  'the request id is unique');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('validation_state', 'incomplete',
    'missing_fields', '["user","callid"]'::JSONB, 'pbx_callid', NULL, 'event_type', NULL)) = 'ok'
  AND pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('validation_state', 'rejected', 'cmd', 'balance',
    'fields', NULL, 'form_shape', '{"cmd":7,"crm_token":0,"phone":12}'::JSONB, 'dedup_key', NULL, 'pbx_callid', NULL,
    'event_type', NULL)) = 'ok'
  AND pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('validation_state', 'rejected', 'cmd', '',
    'fields', NULL, 'form_shape', '{}'::JSONB, 'dedup_key', NULL, 'pbx_callid', NULL, 'event_type', NULL)) = 'ok'
  AND pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('validation_state', 'rejected', 'cmd', 'balance',
    'fields', NULL, 'form_shape', '{"cmd":7}'::JSONB, 'dedup_key', NULL, 'pbx_callid', NULL, 'event_type', NULL)) = 'ok',
  'an incomplete message names its missing fields; rejected forms keep names and lengths only and repeat freely');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_pbx_events', s.over) = '23514'),
  'evidence state/shape rules: ok with missing fields, incomplete without, rejected with fields / without a shape / with a dedup key / with a known cmd, ok with a form shape / without a dedup key / with an unknown cmd, 17 missing names')
  FROM (VALUES
    ('{"missing_fields":["user"]}'::JSONB),
    ('{"validation_state":"incomplete"}'::JSONB),
    ('{"validation_state":"rejected","cmd":"x","form_shape":{"a":1},"dedup_key":null}'::JSONB),
    ('{"validation_state":"rejected","cmd":"x","fields":null,"form_shape":null,"dedup_key":null}'::JSONB),
    ('{"validation_state":"rejected","cmd":"x","fields":null,"form_shape":{"a":1}}'::JSONB),
    ('{"validation_state":"rejected","cmd":"event","fields":null,"form_shape":{"a":1},"dedup_key":null}'::JSONB),
    ('{"form_shape":{"a":1}}'::JSONB),
    ('{"dedup_key":null}'::JSONB),
    ('{"cmd":"balance"}'::JSONB),
    ('{"validation_state":"incomplete","missing_fields":["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q"]}'::JSONB)
  ) s(over);
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_pbx_events', s.over) = '23514'),
  'evidence shapes: unknown validation state or token slot, bad hash, unsafe cmd, bad event type, control characters in the call id')
  FROM (VALUES
    ('{"validation_state":"maybe"}'::JSONB), ('{"token_slot":"old"}'::JSONB),
    ('{"body_sha256":"ABCDEF"}'::JSONB), ('{"dedup_key":"short"}'::JSONB),
    (jsonb_build_object('body_sha256', upper(repeat('a', 64)))), ('{"cmd":"bad cmd"}'::JSONB),
    (jsonb_build_object('cmd', repeat('c', 33))), ('{"event_type":"in coming"}'::JSONB), ('{"event_type":"1x"}'::JSONB),
    (jsonb_build_object('pbx_callid', repeat('i', 201))), (jsonb_build_object('pbx_callid', E'a\nb')), ('{"pbx_callid":""}'::JSONB)
  ) s(over);
-- The token and the recording link never enter the evidence fields (last lock).
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('fields', s.fields)) = '23514'),
  'evidence fields refuse crm_token, token, link, record, recording_link, X-API-KEY, api_key, password and secret in any case; nested objects and arrays; oversized keys and values; more than 32 keys; a non-object')
  FROM (VALUES
    ('{"crm_token":"x"}'::JSONB), ('{"CRM_TOKEN":"x"}'::JSONB), ('{"token":"x"}'::JSONB), ('{"link":"https://x/y.mp3"}'::JSONB),
    ('{"Link":"x"}'::JSONB), ('{"record":"x"}'::JSONB), ('{"recording_link":"x"}'::JSONB), ('{"X-API-KEY":"x"}'::JSONB),
    ('{"api_key":"x"}'::JSONB), ('{"apikey":"x"}'::JSONB), ('{"password":"x"}'::JSONB), ('{"secret":"x"}'::JSONB),
    ('{"nested":{"a":1}}'::JSONB), ('{"list":[1]}'::JSONB), (jsonb_build_object(repeat('k', 65), 1)),
    (jsonb_build_object('phone', repeat('9', 2049))), ('[]'::JSONB), ('"x"'::JSONB), ('1'::JSONB),
    ((SELECT jsonb_object_agg('f' || g, g) FROM generate_series(1, 33) g))
  ) s(fields);
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('fields',
    '{"cmd":"event","phone":"996555000111","user":"manager1","ext":"702","start":"20310107T090000Z","duration":12,"flag":true,"none":null}'::JSONB)) = 'ok'
  AND pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('fields', (SELECT jsonb_object_agg('f' || g, g) FROM generate_series(1, 32) g))) = 'ok'
  AND pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('fields', jsonb_build_object('phone', repeat('9', 2048)))) = 'ok',
  'documented scalar fields, 32 keys and a 2 048-character value are accepted');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('validation_state', 'rejected',
      'cmd', 'x', 'fields', NULL, 'dedup_key', NULL, 'pbx_callid', NULL, 'event_type', NULL, 'form_shape', s.shape)) = '23514'),
  'the rejected-form shape refuses values (strings), nested objects, negative or oversized lengths, 65 names, an oversized name, a control character in a name and a non-object')
  FROM (VALUES
    ('{"cmd":"abc"}'::JSONB), ('{"cmd":{"a":1}}'::JSONB), ('{"cmd":-1}'::JSONB), ('{"cmd":100000}'::JSONB),
    ('{"cmd":1.5}'::JSONB), (jsonb_build_object(repeat('k', 65), 1)), (jsonb_build_object(E'a\nb', 1)),
    ((SELECT jsonb_object_agg('f' || g, g) FROM generate_series(1, 65) g)), ('[]'::JSONB), ('"x"'::JSONB)
  ) s(shape);
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_pbx_events', jsonb_build_object('organization_id', pg_temp.t287_id(9))) = '23503',
  'evidence needs an existing organization');

-- 5. Append-only: the evidence and the chronology.
SELECT pg_temp.t287_assert(pg_temp.t287_state(format('UPDATE platform_private.telephony_pbx_events SET has_link = NOT has_link WHERE id = %L', pg_temp.t287_id(1001))) = '55000'
  AND pg_temp.t287_state(format('DELETE FROM platform_private.telephony_pbx_events WHERE id = %L', pg_temp.t287_id(1001))) = '55000'
  AND pg_temp.t287_state('TRUNCATE platform_private.telephony_pbx_events') IN ('0A000', '55000')
  AND pg_temp.t287_state('TRUNCATE platform_private.telephony_pbx_events CASCADE') = '55000',
  'evidence is append-only: UPDATE and DELETE are refused (55000), TRUNCATE is refused (the work queue references it, so plain TRUNCATE stops at 0A000; CASCADE reaches the trigger, 55000), even for the owner');

-- ---------------------------------------------------------------------------
-- 7. Work queue.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_event_work', jsonb_build_object('id', pg_temp.t287_id(1201),
    'event_id', pg_temp.t287_id(1001))) = 'ok', 'a work row for stored evidence is accepted');
SELECT pg_temp.t287_assert((SELECT state = 'queued' AND attempt_count = 0 AND max_attempts = 8 AND NOT has_link AND lease_owner IS NULL
    FROM platform_private.telephony_event_work WHERE id = pg_temp.t287_id(1201)),
  'a work row starts queued with 0 attempts, 8 allowed, no lease');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_event_work', jsonb_build_object('event_id', pg_temp.t287_id(1001))) = '23505',
  'one work row per evidence');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_event_work', jsonb_build_object('event_id', pg_temp.t287_id(9999))) = '23503'
  AND pg_temp.t287_ins('telephony_event_work', jsonb_build_object('organization_id', pg_temp.t287_id(2),
    'event_id', pg_temp.t287_id(1002))) = '23503',
  'work needs existing evidence of the same organization');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_event_work', jsonb_build_object('event_id', pg_temp.t287_id(1002),
    'state', 'leased', 'lease_owner', 'worker-1', 'lease_expires_at', '2031-01-07T09:05:00Z', 'attempt_count', 1,
    'has_link', true)) = 'ok',
  'a leased row carries its owner and expiry');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_state(format('UPDATE platform_private.telephony_event_work SET %s WHERE id = %L',
      s.assignment, pg_temp.t287_id(1201))) = '23514'),
  'work state rules: leased without owner, queued with a lease, owner without expiry (and back), succeeded without completion, completion while queued, retry_wait with no attempt, dead letter without a code, attempts above the maximum, maximum 0 or 21, unknown state, free-text error')
  FROM (VALUES
    ('state = ''leased'''), ('lease_owner = ''w'', lease_expires_at = now()'), ('lease_owner = ''w'''),
    ('lease_expires_at = now()'), ('state = ''succeeded'''), ('completed_at = now()'),
    ('state = ''retry_wait'''), ('state = ''dead_lettered'', completed_at = now()'),
    ('attempt_count = 9'), ('max_attempts = 0'), ('max_attempts = 21'), ('state = ''done'''),
    ('last_error_code = ''Not A Code''')) s(assignment);
SELECT pg_temp.t287_assert(pg_temp.t287_state(format('UPDATE platform_private.telephony_event_work SET state = ''retry_wait'', attempt_count = 2, last_error_code = ''projection_failed'' WHERE id = %L', pg_temp.t287_id(1201))) = 'ok'
  AND pg_temp.t287_state(format('UPDATE platform_private.telephony_event_work SET state = ''dead_lettered'', attempt_count = 8, last_error_code = ''projection_failed'', completed_at = now() WHERE id = %L', pg_temp.t287_id(1201))) = 'ok',
  'retry_wait with an attempt and a dead letter with a code and a completion time pass');
SELECT pg_temp.t287_assert(pg_temp.t287_state(format('DELETE FROM platform_private.telephony_pbx_events WHERE id = %L', pg_temp.t287_id(1001))) = '55000',
  'evidence referenced by work cannot be removed (append-only and RESTRICT)');

-- ---------------------------------------------------------------------------
-- 8. Calls.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', jsonb_build_object('id', pg_temp.t287_id(2001),
    'pbx_callid', 'call-1')) = 'ok', 'a call takes its defaults');
SELECT pg_temp.t287_assert((SELECT state = 'ringing' AND outcome IS NULL AND outcome_source IS NULL AND match_state = 'unmatched'
      AND recording_state = 'none' AND NOT needs_review AND client_id IS NULL AND settled_at IS NULL
    FROM platform_private.telephony_calls WHERE id = pg_temp.t287_id(2001)),
  'a new call is ringing, unmatched, without outcome, without recording');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', jsonb_build_object('pbx_callid', 'call-1')) = '23505'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('organization_id', pg_temp.t287_id(2), 'pbx_callid', 'call-1')) = 'ok',
  'the PBX call id is unique within an organization only');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_calls', s.over) = '23514'),
  'call state/outcome rules: ringing with an outcome, answered with another outcome or none, ended without an outcome or an end time, outcome without source (and back), no_answer_unknown from a webhook, unknown direction/outcome/state/source/created_via')
  FROM (VALUES
    ('{"state":"ringing","outcome":"missed","outcome_source":"webhook"}'::JSONB),
    ('{"state":"answered","outcome":"missed","outcome_source":"webhook","ended_at":"2031-01-07T09:01:00Z"}'::JSONB),
    ('{"state":"answered"}'::JSONB),
    ('{"state":"ended","ended_at":"2031-01-07T09:01:00Z"}'::JSONB),
    ('{"state":"ended","outcome":"missed","outcome_source":"webhook"}'::JSONB),
    ('{"state":"ended","outcome":"missed","ended_at":"2031-01-07T09:01:00Z"}'::JSONB),
    ('{"state":"ended","outcome_source":"webhook","ended_at":"2031-01-07T09:01:00Z"}'::JSONB),
    ('{"state":"ended","outcome":"no_answer_unknown","outcome_source":"webhook","ended_at":"2031-01-07T09:01:00Z"}'::JSONB),
    ('{"direction":"sideways"}'::JSONB), ('{"state":"ended","outcome":"lost","outcome_source":"webhook","ended_at":"2031-01-07T09:01:00Z"}'::JSONB),
    ('{"state":"paused"}'::JSONB), ('{"state":"ended","outcome":"missed","outcome_source":"push","ended_at":"2031-01-07T09:01:00Z"}'::JSONB),
    ('{"created_via":"import"}'::JSONB)
  ) s(over);
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', '{"state":"ended","outcome":"no_answer_unknown","outcome_source":"pull","direction":"out","created_via":"reconcile","ended_at":"2031-01-07T09:01:00Z"}') = 'ok'
  AND pg_temp.t287_ins('telephony_calls', '{"state":"answered","outcome":"answered","outcome_source":"webhook","answered_at":"2031-01-07T09:00:05Z"}') = 'ok'
  AND pg_temp.t287_ins('telephony_calls', '{"state":"ended","outcome":"answered","outcome_source":"pull","ended_at":"2031-01-07T09:01:00Z","created_via":"backfill"}') = 'ok'
  AND pg_temp.t287_ins('telephony_calls', '{"state":"ended","outcome":"busy","outcome_source":"webhook","direction":"out","ended_at":"2031-01-07T09:01:00Z"}') = 'ok',
  'valid states: pull-only no_answer_unknown, answered, answered by reconciliation, busy outgoing');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', jsonb_build_object('started_at', NULL)) = '23502'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('direction', NULL)) = '23502'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('created_via', NULL)) = '23502'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('pbx_callid', NULL)) = '23502',
  'start time, direction, origin and the call id are mandatory');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_calls', s.over) = '23514'),
  'call shapes: padded or control-character call id, malformed phone (no plus, leading zero, short, long, letters), negative seconds, missed status 0 or 5, free-text destination, empty company number, unknown recording state')
  FROM (VALUES
    ('{"pbx_callid":" x"}'::JSONB), ('{"pbx_callid":"x "}'::JSONB), (jsonb_build_object('pbx_callid', E'x\ty')), ('{"pbx_callid":""}'::JSONB),
    ('{"client_phone":"996555000111"}'::JSONB), ('{"client_phone":"+0555000111"}'::JSONB), ('{"client_phone":"+99655"}'::JSONB),
    ('{"client_phone":"+9965550001112345"}'::JSONB), ('{"client_phone":"+99655500011a"}'::JSONB),
    ('{"webhook_total_seconds":-1}'::JSONB), ('{"wait_seconds":-1}'::JSONB), ('{"talk_seconds":-1}'::JSONB),
    ('{"pbx_missed_status":0}'::JSONB), ('{"pbx_missed_status":5}'::JSONB), ('{"pbx_destination":"Hello World"}'::JSONB),
    ('{"company_number":""}'::JSONB), ('{"recording_state":"gone"}'::JSONB), ('{"match_state":"guess"}'::JSONB)
  ) s(over);
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', '{"client_phone":"+996555000111","webhook_total_seconds":95,"wait_seconds":4,"talk_seconds":80,"pbx_destination":"hello","pbx_missed_status":3,"company_number":"996312000000","company_number_name":"Main line"}') = 'ok'
  AND pg_temp.t287_ins('telephony_calls', '{"pbx_destination":"someday_new_value"}') = 'ok',
  'a full call row and an undocumented destination word (tolerated) are accepted');
-- Match rules.
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_calls', s.over) = '23514'),
  'match rules: matched or created without a client, unmatched or ambiguous with a client, a lead without a client, created without a lead')
  FROM (VALUES
    ('{"match_state":"matched"}'::JSONB), ('{"match_state":"created"}'::JSONB),
    (jsonb_build_object('match_state', 'unmatched', 'client_id', pg_temp.t287_id(701))),
    (jsonb_build_object('match_state', 'ambiguous', 'client_id', pg_temp.t287_id(701))),
    (jsonb_build_object('match_state', 'unmatched', 'lead_id', pg_temp.t287_id(702))),
    (jsonb_build_object('match_state', 'matched', 'lead_id', pg_temp.t287_id(702))),
    (jsonb_build_object('match_state', 'created', 'client_id', pg_temp.t287_id(701)))
  ) s(over);
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', jsonb_build_object('id', pg_temp.t287_id(2002), 'pbx_callid', 'call-m',
    'match_state', 'matched', 'client_id', pg_temp.t287_id(701), 'lead_id', pg_temp.t287_id(702),
    'membership_id', pg_temp.t287_id(301), 'client_phone', '+996555000111')) = 'ok'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('match_state', 'matched', 'client_id', pg_temp.t287_id(703))) = 'ok'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('match_state', 'created', 'client_id', pg_temp.t287_id(703),
    'lead_id', pg_temp.t287_id(704))) = 'ok'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('match_state', 'ambiguous')) = 'ok',
  'matched with and without a lead, created with client and lead, ambiguous without a client');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', jsonb_build_object('match_state', 'matched', 'client_id', pg_temp.t287_id(707))) = '23503'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('match_state', 'matched', 'client_id', pg_temp.t287_id(701),
    'lead_id', pg_temp.t287_id(708))) = '23503'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('membership_id', pg_temp.t287_id(305))) = '23503'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('organization_id', pg_temp.t287_id(9))) = '23503',
  'a call cannot reference another organization''s client, lead or member, or a missing organization');
-- Result rules.
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_calls', s.over) = '23514'),
  'result rules: a result without time, a time without a result, a human result without an author, an automatic no_answer with an author, an author without a result, an unknown code')
  FROM (VALUES
    ('{"result_code":"reached","result_by":"28700000-0000-4000-8000-000000000301"}'::JSONB),
    ('{"result_at":"2031-01-07T10:00:00Z"}'::JSONB),
    ('{"result_code":"reached","result_at":"2031-01-07T10:00:00Z"}'::JSONB),
    ('{"result_code":"callback","result_at":"2031-01-07T10:00:00Z"}'::JSONB),
    ('{"result_code":"not_interested","result_at":"2031-01-07T10:00:00Z"}'::JSONB),
    ('{"result_code":"no_answer","result_at":"2031-01-07T10:00:00Z","result_by":"28700000-0000-4000-8000-000000000301"}'::JSONB),
    ('{"result_by":"28700000-0000-4000-8000-000000000301"}'::JSONB),
    ('{"result_code":"great","result_at":"2031-01-07T10:00:00Z","result_by":"28700000-0000-4000-8000-000000000301"}'::JSONB)
  ) s(over);
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', '{"result_code":"reached","result_at":"2031-01-07T10:00:00Z","result_by":"28700000-0000-4000-8000-000000000301"}') = 'ok'
  AND pg_temp.t287_ins('telephony_calls', '{"direction":"out","result_code":"no_answer","result_at":"2031-01-07T10:00:00Z"}') = 'ok'
  AND pg_temp.t287_ins('telephony_calls', '{"result_code":"callback","result_at":"2031-01-07T10:00:00Z","result_by":"28700000-0000-4000-8000-000000000302"}') = 'ok',
  'valid results: a human one with its author, the automatic no_answer without');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', jsonb_build_object('result_code', 'reached', 'result_at', '2031-01-07T10:00:00Z',
    'result_by', pg_temp.t287_id(305))) = '23503',
  'a result author from another organization is refused');
-- Linked calls.
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', jsonb_build_object('id', pg_temp.t287_id(2003), 'pbx_callid', 'call-t',
    'linked_call_id', pg_temp.t287_id(2001))) = 'ok'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('id', pg_temp.t287_id(2004), 'pbx_callid', 'call-s',
    'linked_call_id', pg_temp.t287_id(2004))) = '23514'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('linked_call_id', pg_temp.t287_id(9999))) = '23503'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('organization_id', pg_temp.t287_id(2),
    'linked_call_id', pg_temp.t287_id(2001))) = '23503',
  'a transferred call links to another call of the same organization, never to itself or to a foreign call');

-- 9. Dial requests (before the calls that reference them).
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('id', pg_temp.t287_id(1301),
    'request_id', pg_temp.t287_id(1401))) = 'ok'
  AND pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('id', pg_temp.t287_id(1302), 'request_id', pg_temp.t287_id(1402),
    'status', 'sent', 'pbx_callid', 'call-d', 'pbx_http_status', 200)) = 'ok'
  AND pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('request_id', pg_temp.t287_id(1403), 'status', 'unconfirmed',
    'pbx_http_status', 200)) = 'ok'
  AND pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('request_id', pg_temp.t287_id(1404), 'status', 'failed',
    'pbx_http_status', 503, 'pbx_error_code', 'pbx_unavailable')) = 'ok'
  AND pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('request_id', pg_temp.t287_id(1405), 'status', 'refused',
    'refusal_code', 'no_phone', 'client_id', NULL, 'lead_id', NULL, 'pbx_user', NULL, 'client_phone', NULL)) = 'ok'
  AND pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('request_id', pg_temp.t287_id(1406), 'status', 'refused',
    'refusal_code', 'prefix_not_allowed')) = 'ok',
  'a requested, sent, unconfirmed, failed and two refused dial requests (one with nothing known) are accepted');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('request_id', pg_temp.t287_id(1401))) = '23505'
  AND pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('request_id', pg_temp.t287_id(1401),
    'membership_id', pg_temp.t287_id(302))) = 'ok',
  'a request id is unique per organization and member; another member may reuse it without seeing the first');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_dial_requests', s.over) = '23514'),
  'dial rules: refused without a code, a code on a non-refusal, sent without a call id, a call id on an unconfirmed one, a non-refusal without phone / user / client and lead, malformed phone, status outside the HTTP range, unknown status, free-text codes')
  FROM (VALUES
    ('{"status":"refused"}'::JSONB), ('{"refusal_code":"x_y"}'::JSONB), ('{"status":"sent"}'::JSONB),
    ('{"status":"unconfirmed","pbx_callid":"call-x"}'::JSONB), ('{"client_phone":null}'::JSONB), ('{"pbx_user":null}'::JSONB),
    ('{"client_id":null,"lead_id":null}'::JSONB), ('{"client_phone":"0555000111"}'::JSONB),
    ('{"pbx_http_status":99}'::JSONB), ('{"pbx_http_status":600}'::JSONB), ('{"status":"queued"}'::JSONB),
    ('{"status":"refused","refusal_code":"Too Many"}'::JSONB), ('{"pbx_error_code":"Not A Code"}'::JSONB)
  ) s(over);
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('membership_id', pg_temp.t287_id(305))) = '23503'
  AND pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('client_id', pg_temp.t287_id(707))) = '23503'
  AND pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('lead_id', pg_temp.t287_id(708))) = '23503',
  'a dial request cannot name another organization''s member, client or lead');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('membership_id', NULL)) = '23502'
  AND pg_temp.t287_ins('telephony_dial_requests', jsonb_build_object('request_id', NULL)) = '23502',
  'a dial request always has a member and a request id');

-- Calls from dial requests.
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', jsonb_build_object('id', pg_temp.t287_id(2005), 'pbx_callid', 'call-d',
    'direction', 'out', 'created_via', 'dial', 'dial_request_id', pg_temp.t287_id(1302))) = 'ok'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('direction', 'out', 'created_via', 'dial',
    'dial_request_id', pg_temp.t287_id(1302))) = '23505'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('direction', 'out', 'created_via', 'reconcile',
    'dial_request_id', pg_temp.t287_id(1301))) = 'ok',
  'one call per dial request; reconciliation may attach an outgoing call to a dial request');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_calls', jsonb_build_object('direction', 'in', 'created_via', 'dial')) = '23514'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('direction', 'in', 'dial_request_id', pg_temp.t287_id(1403))) = '23514'
  AND pg_temp.t287_ins('telephony_calls', jsonb_build_object('direction', 'out', 'created_via', 'dial',
    'dial_request_id', pg_temp.t287_id(9998))) = '23503',
  'a dialed call is outgoing; a dial request cannot sit on an incoming call; a dial request must exist');

-- ---------------------------------------------------------------------------
-- Legs.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('id', pg_temp.t287_id(3001),
    'call_id', pg_temp.t287_id(2001), 'pbx_user', 'manager1', 'extension', '702', 'membership_id', pg_temp.t287_id(301))) = 'ok',
  'a leg of a call is accepted');
SELECT pg_temp.t287_assert((SELECT state = 'ringing' AND recording_state = 'none' AND recording_link IS NULL AND not_found_count = 0
    FROM platform_private.telephony_call_legs WHERE id = pg_temp.t287_id(3001)),
  'a leg starts ringing without a recording');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', pg_temp.t287_id(2001),
    'pbx_user', 'manager1')) = '23505'
  AND pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', pg_temp.t287_id(2001), 'pbx_user', 'manager1',
    'leg_started_at', '2031-01-07T09:00:09Z', 'leg_start_source', 'history')) = 'ok'
  AND pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', pg_temp.t287_id(2001), 'pbx_user', 'manager2')) = 'ok',
  'the leg key is (call, user, start): the same user at another start or another user is a new leg');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', pg_temp.t287_id(2001), 'group_name', 'Sales',
    'state', 'missed')) = 'ok', 'a group-only leg is accepted');
SELECT pg_temp.t287_assert((SELECT pbx_user = '' FROM platform_private.telephony_call_legs WHERE group_name = 'Sales' AND call_id = pg_temp.t287_id(2001))
  AND pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', pg_temp.t287_id(2001), 'group_name', 'Support',
    'leg_started_at', '2031-01-07T09:00:30Z')) = 'ok',
  'a group-only leg has an empty user; two group legs differ by their start');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', pg_temp.t287_id(9997))) = '23503'
  AND pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('organization_id', pg_temp.t287_id(2), 'call_id', pg_temp.t287_id(2001))) = '23503'
  AND pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', pg_temp.t287_id(2001), 'pbx_user', 'x-cross',
    'membership_id', pg_temp.t287_id(305))) = '23503'
  AND pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', NULL)) = '23502',
  'a leg needs its call in the same organization; its member must be of that organization');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', pg_temp.t287_id(2001),
      'pbx_user', 'chk-' || s.n) || s.over) = '23514'),
  'leg rules: link without a state that allows it (none, expired), available or unavailable without a link, link of 0 or 1 025 characters, not_found_count without a first time (and back), capitalized or free-text status, unknown state/source/recording state, negative seconds, padded user, empty extension')
  FROM (VALUES
    (1, '{"recording_link":"https://example.invalid/r/1.mp3"}'::JSONB),
    (2, '{"recording_state":"expired","recording_link":"https://example.invalid/r/1.mp3"}'::JSONB),
    (3, '{"recording_state":"available"}'::JSONB), (4, '{"recording_state":"unavailable"}'::JSONB),
    (5, '{"recording_state":"available","recording_link":""}'::JSONB),
    (6, jsonb_build_object('recording_state', 'available', 'recording_link', 'https://example.invalid/' || repeat('x', 1010))),
    (7, '{"not_found_count":1}'::JSONB), (8, '{"first_not_found_at":"2031-01-07T10:00:00Z"}'::JSONB),
    (9, '{"status":"Success"}'::JSONB), (10, '{"status":"no answer"}'::JSONB), (11, '{"state":"done"}'::JSONB),
    (12, '{"leg_start_source":"guess"}'::JSONB), (13, '{"recording_state":"lost"}'::JSONB), (14, '{"talk_seconds":-1}'::JSONB),
    (15, '{"webhook_total_seconds":-1}'::JSONB), (16, '{"wait_seconds":-1}'::JSONB), (17, '{"extension":""}'::JSONB),
    (18, jsonb_build_object('pbx_user', E'a\nb'))
  ) s(n, over);
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('id', pg_temp.t287_id(3002), 'call_id', pg_temp.t287_id(2002),
    'pbx_user', 'manager1', 'state', 'completed', 'status', 'success', 'recording_state', 'available',
    'recording_link', 'https://example.invalid/r/2.mp3', 'accepted_at', '2031-01-07T09:00:05Z', 'ended_at', '2031-01-07T09:01:35Z',
    'webhook_total_seconds', 95, 'wait_seconds', 4, 'talk_seconds', 80)) = 'ok'
  AND pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('id', pg_temp.t287_id(3003), 'call_id', pg_temp.t287_id(2002),
    'pbx_user', 'manager2', 'recording_state', 'unavailable', 'recording_link', 'https://example.invalid/r/3.mp3',
    'not_found_count', 3, 'first_not_found_at', '2031-01-07T10:00:00Z', 'recording_next_check_at', '2031-01-08T10:00:00Z')) = 'ok'
  AND pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', pg_temp.t287_id(2002), 'pbx_user', 'manager3',
    'recording_state', 'expired')) = 'ok'
  AND pg_temp.t287_ins('telephony_call_legs', jsonb_build_object('call_id', pg_temp.t287_id(2002), 'pbx_user', 'manager4',
    'status', 'notavailable', 'state', 'cancelled')) = 'ok',
  'an available leg with its link and counters, a temporarily unavailable one with a not-found history, an expired one without a link, a lowercase status word');
SELECT pg_temp.t287_assert(pg_temp.t287_state(format('UPDATE platform_private.telephony_call_legs SET recording_state = ''expired'' WHERE id = %L',
    pg_temp.t287_id(3002))) = '23514'
  AND pg_temp.t287_state(format('UPDATE platform_private.telephony_call_legs SET recording_state = ''expired'', recording_link = NULL WHERE id = %L',
    pg_temp.t287_id(3002))) = 'ok',
  'expiry must clear the link in the same update (the link goes with the state)');

-- 3. The link is a secret in one place.
SELECT pg_temp.t287_assert((SELECT array_agg(c.table_name || '.' || c.column_name ORDER BY c.table_name, c.column_name)
    FROM information_schema.columns c
    WHERE c.table_schema = 'platform_private' AND c.table_name IN (SELECT name FROM t287_tables)
      AND (c.column_name ~ '(^|_)(link|url|uri|href|record|recording)(_|$)'
        AND c.column_name NOT IN ('recording_state', 'recording_next_check_at', 'recording_check_run_at')))
  = ARRAY['telephony_call_legs.recording_link', 'telephony_event_work.has_link', 'telephony_pbx_events.has_link'],
  'the only link-like columns: the leg''s recording_link (the secret) and the two has_link flags (evidence, work queue)');
SELECT pg_temp.t287_assert((SELECT NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform_private' AND c.table_name IN (SELECT name FROM t287_tables)
        AND c.table_name <> 'telephony_call_legs' AND c.column_name = 'recording_link')),
  'recording_link exists in no other table');
SELECT pg_temp.t287_assert((SELECT NOT EXISTS (
      SELECT 1 FROM pg_constraint k
      WHERE k.contype = 'f' AND k.conrelid = 'platform_private.telephony_call_events'::REGCLASS
        AND k.confrelid = 'platform_private.telephony_pbx_events'::REGCLASS)),
  'the chronology holds no foreign key to the evidence (the 12-month evidence purge cannot be blocked by it)');

-- ---------------------------------------------------------------------------
-- Chronology (append-only).
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_call_events', jsonb_build_object('id', pg_temp.t287_id(4001),
    'call_id', pg_temp.t287_id(2001), 'leg_id', pg_temp.t287_id(3001))) = 'ok'
  AND pg_temp.t287_ins('telephony_call_events', jsonb_build_object('call_id', pg_temp.t287_id(2001), 'source', 'pull',
    'event_type', 'reconcile', 'pbx_event_id', NULL)) = 'ok'
  AND pg_temp.t287_ins('telephony_call_events', jsonb_build_object('call_id', pg_temp.t287_id(2001),
    'pbx_event_id', pg_temp.t287_id(9996))) = 'ok',
  'a webhook event with its evidence id (not a foreign key), a reconciliation event without one');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_call_events', jsonb_build_object('call_id', pg_temp.t287_id(2001),
    'source', 'pull', 'event_type', 'reconcile')) = '23514'
  AND pg_temp.t287_ins('telephony_call_events', jsonb_build_object('call_id', pg_temp.t287_id(2001), 'pbx_event_id', NULL)) = '23514'
  AND pg_temp.t287_ins('telephony_call_events', jsonb_build_object('call_id', pg_temp.t287_id(2001), 'event_type', 'INCOMING')) = '23514'
  AND pg_temp.t287_ins('telephony_call_events', jsonb_build_object('call_id', pg_temp.t287_id(2001), 'source', 'email')) = '23514'
  AND pg_temp.t287_ins('telephony_call_events', jsonb_build_object('call_id', pg_temp.t287_id(9995))) = '23503'
  AND pg_temp.t287_ins('telephony_call_events', jsonb_build_object('call_id', pg_temp.t287_id(2001), 'leg_id', pg_temp.t287_id(9994))) = '23503'
  AND pg_temp.t287_ins('telephony_call_events', jsonb_build_object('organization_id', pg_temp.t287_id(2), 'call_id', pg_temp.t287_id(2001))) = '23503',
  'chronology rules: a pull event with an evidence id, a webhook event without one, upper-case type, unknown source, missing call or leg, another organization''s call');
SELECT pg_temp.t287_assert(pg_temp.t287_state(format('UPDATE platform_private.telephony_call_events SET event_type = ''completed'' WHERE id = %L', pg_temp.t287_id(4001))) = '55000'
  AND pg_temp.t287_state(format('DELETE FROM platform_private.telephony_call_events WHERE id = %L', pg_temp.t287_id(4001))) = '55000'
  AND pg_temp.t287_state('TRUNCATE platform_private.telephony_call_events') = '55000',
  'the chronology is append-only: UPDATE, DELETE and TRUNCATE are refused even for the owner');

-- ---------------------------------------------------------------------------
-- RESTRICT: referenced rows cannot disappear silently.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert((SELECT count(*) = 34 AND bool_and(k.confdeltype = 'r')
    FROM pg_constraint k
    WHERE k.contype = 'f' AND k.conrelid IN (SELECT ('platform_private.' || t.name)::REGCLASS FROM t287_tables t)),
  'all 34 foreign keys of the eleven tables are ON DELETE RESTRICT (no silent cascade, no SET NULL on append-only rows)');
SELECT pg_temp.t287_assert(pg_temp.t287_state(format('DELETE FROM platform_private.telephony_calls WHERE id = %L', pg_temp.t287_id(2001))) = '23503'
  AND pg_temp.t287_state(format('DELETE FROM platform_private.telephony_call_legs WHERE id = %L', pg_temp.t287_id(3001))) = '23503'
  AND pg_temp.t287_state(format('DELETE FROM platform_private.telephony_dial_requests WHERE id = %L', pg_temp.t287_id(1302))) = '23503'
  AND pg_temp.t287_state(format('DELETE FROM platform_private.telephony_extensions WHERE id = %L', pg_temp.t287_id(901))) = 'ok',
  'a call with legs and events, a leg with events, a dial request with a call cannot be deleted; a mapping nobody references can');

-- ---------------------------------------------------------------------------
-- 11. Grants and task links.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_recording_grants', jsonb_build_object('id', pg_temp.t287_id(5001),
    'leg_id', pg_temp.t287_id(3002))) = 'ok', 'a grant for an existing leg is accepted');
SELECT pg_temp.t287_assert((SELECT max_uses = 40 AND use_count = 0 AND last_used_at IS NULL
    FROM platform_private.telephony_recording_grants WHERE id = pg_temp.t287_id(5001)),
  'a grant allows 40 uses by default and starts unused');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_recording_grants', jsonb_build_object('leg_id', pg_temp.t287_id(3002)) || s.over) = '23514'),
  'grant rules: expiry not after the grant, more uses than allowed, a use without a time (and back), 0 or 101 allowed uses, negative uses')
  FROM (VALUES
    ('{"expires_at":"2031-01-07T09:00:00Z"}'::JSONB), ('{"expires_at":"2031-01-07T08:00:00Z"}'::JSONB),
    ('{"use_count":41,"last_used_at":"2031-01-07T09:01:00Z"}'::JSONB), ('{"use_count":1}'::JSONB),
    ('{"last_used_at":"2031-01-07T09:01:00Z"}'::JSONB), ('{"max_uses":0}'::JSONB), ('{"max_uses":101}'::JSONB),
    ('{"use_count":-1}'::JSONB)
  ) s(over);
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_recording_grants', jsonb_build_object('leg_id', pg_temp.t287_id(3002),
    'use_count', 40, 'last_used_at', '2031-01-07T09:01:00Z')) = 'ok'
  AND pg_temp.t287_ins('telephony_recording_grants', jsonb_build_object('leg_id', pg_temp.t287_id(3002), 'membership_id', pg_temp.t287_id(305))) = '23503'
  AND pg_temp.t287_ins('telephony_recording_grants', jsonb_build_object('organization_id', pg_temp.t287_id(2), 'membership_id', pg_temp.t287_id(305),
    'leg_id', pg_temp.t287_id(3002))) = '23503'
  AND pg_temp.t287_ins('telephony_recording_grants', jsonb_build_object('leg_id', pg_temp.t287_id(9993))) = '23503',
  'a fully used grant is valid; a grant cannot cross organizations or name a missing leg');

SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_task_links', jsonb_build_object('id', pg_temp.t287_id(6001),
    'task_id', pg_temp.t287_id(801), 'call_id', pg_temp.t287_id(2001), 'client_id', pg_temp.t287_id(701))) = 'ok',
  'a missed-call task link on a lead');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_task_links', jsonb_build_object('task_id', pg_temp.t287_id(802),
    'call_id', pg_temp.t287_id(2003), 'client_id', pg_temp.t287_id(701))) = '23505',
  'a second OPEN task of the same kind for the same lead is refused');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_task_links', jsonb_build_object('task_id', pg_temp.t287_id(801),
    'call_id', pg_temp.t287_id(2003), 'kind', 'no_answer_callback')) = '23505',
  'one link per task');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_task_links', jsonb_build_object('task_id', pg_temp.t287_id(802),
    'call_id', pg_temp.t287_id(2003), 'kind', 'no_answer_callback', 'client_id', pg_temp.t287_id(701))) = 'ok',
  'another kind for the same lead is allowed');
SELECT pg_temp.t287_assert(pg_temp.t287_state(format('UPDATE platform_private.telephony_task_links SET closed_at = now(), closed_reason = ''task_done'' WHERE id = %L',
    pg_temp.t287_id(6001))) = 'ok',
  'a task link can be closed');
INSERT INTO platform.staff_tasks(id, organization_id, creator_membership_id, assignee_membership_id, title)
  SELECT pg_temp.t287_id(800 + g), pg_temp.t287_id(1), pg_temp.t287_id(301), pg_temp.t287_id(301), 'T287 task ' || g
  FROM generate_series(4, 12) g;
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_task_links', jsonb_build_object('task_id', pg_temp.t287_id(804),
    'call_id', pg_temp.t287_id(2003), 'client_id', pg_temp.t287_id(701))) = 'ok',
  'after the first link is closed a new open one for the same lead and kind is allowed');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_task_links', jsonb_build_object('task_id', pg_temp.t287_id(805),
    'call_id', pg_temp.t287_id(2003), 'kind', 'result_callback', 'lead_id', NULL, 'client_id', pg_temp.t287_id(703),
    'scope_id', pg_temp.t287_id(703))) = 'ok'
  AND pg_temp.t287_ins('telephony_task_links', jsonb_build_object('task_id', pg_temp.t287_id(806),
    'call_id', pg_temp.t287_id(2003), 'kind', 'result_callback', 'lead_id', NULL, 'client_id', pg_temp.t287_id(703),
    'scope_id', pg_temp.t287_id(703))) = '23505',
  'without a lead the subject is the client: one open task per client and kind');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_task_links', jsonb_build_object('task_id', pg_temp.t287_id(807),
    'call_id', pg_temp.t287_id(2003), 'kind', 'verify_call', 'lead_id', NULL, 'client_id', NULL,
    'scope_id', pg_temp.t287_id(2003))) = 'ok'
  AND pg_temp.t287_ins('telephony_task_links', jsonb_build_object('task_id', pg_temp.t287_id(808),
    'call_id', pg_temp.t287_id(2003), 'kind', 'verify_call', 'lead_id', NULL, 'client_id', NULL,
    'scope_id', pg_temp.t287_id(2003))) = '23505',
  'with neither lead nor client (an ambiguous number) the subject is the call itself');
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_task_links', jsonb_build_object('task_id', NULL,
    'call_id', pg_temp.t287_id(2003))) = '23502',
  'a link always names its task');
SELECT pg_temp.t287_assert(bool_and(pg_temp.t287_ins('telephony_task_links', jsonb_build_object('task_id', pg_temp.t287_id(809),
      'call_id', pg_temp.t287_id(2003)) || s.over) = '23514'),
  'link rules: a subject that is not lead-else-client-else-call, a close time without a reason (and back), an unknown reason or kind')
  FROM (VALUES
    ('{"scope_id":"28700000-0000-4000-8000-000000000999"}'::JSONB),
    (jsonb_build_object('lead_id', pg_temp.t287_id(702), 'scope_id', pg_temp.t287_id(2003))),
    ('{"lead_id":null,"scope_id":"28700000-0000-4000-8000-000000000702"}'::JSONB),
    ('{"closed_at":"2031-01-07T10:00:00Z"}'::JSONB), ('{"closed_reason":"task_done"}'::JSONB),
    ('{"closed_at":"2031-01-07T10:00:00Z","closed_reason":"gone"}'::JSONB), ('{"kind":"follow_up"}'::JSONB)
  ) s(over);
SELECT pg_temp.t287_assert(pg_temp.t287_ins('telephony_task_links', jsonb_build_object('organization_id', pg_temp.t287_id(2),
    'kind', 'reached_followup', 'task_id', pg_temp.t287_id(810), 'call_id', pg_temp.t287_id(2001), 'lead_id', pg_temp.t287_id(708),
    'scope_id', pg_temp.t287_id(708))) = '23503'
  AND pg_temp.t287_ins('telephony_task_links', jsonb_build_object('kind', 'reached_followup', 'task_id', pg_temp.t287_id(803),
    'call_id', pg_temp.t287_id(2003))) = '23503'
  AND pg_temp.t287_ins('telephony_task_links', jsonb_build_object('kind', 'reached_followup', 'task_id', pg_temp.t287_id(811),
    'call_id', pg_temp.t287_id(2003), 'lead_id', pg_temp.t287_id(708), 'scope_id', pg_temp.t287_id(708))) = '23503'
  AND pg_temp.t287_ins('telephony_task_links', jsonb_build_object('kind', 'reached_followup', 'task_id', pg_temp.t287_id(812),
    'call_id', pg_temp.t287_id(9992))) = '23503',
  'a link cannot cross organizations (task, call, lead) or name a missing call');

SELECT 'T287_TELEPHONY_SCHEMA_SUITE_PASSED' AS t287_suite_marker;
ROLLBACK;
