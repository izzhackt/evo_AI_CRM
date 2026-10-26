\set ON_ERROR_STOP on
-- Boundary suite for migration 321: «ИИ-агенты», расход агента за сутки по Бишкеку для дневного лимита на WhatsApp
-- (docs/PLAN_CHANGES.md «2026-10-26 · ИИ-агенты: дневной лимит $10 на запуски по WhatsApp (миграция 321)»).
-- Runs on the real chain right after 321 inside one transaction that is rolled back, with its own synthetic
-- organizations. No provider, no Claude / Anthropic call, no real person, no production action.
--
-- Proves:
--  1. posture: platform.ai_agent_runtime_daily_spend_v1 is definer with an empty search_path, executable by
--     service_role only; anon, authenticated (with or without a membership) are refused (42501); the number of
--     functions of the AI-agents families is as after 318 plus this one;
--  2. input: an unknown agent key or a NULL organization -> ai_agent_not_found (P0002); a NULL moment means the
--     database clock; the open-run window is clamped to 1..1440 minutes;
--  3. the day is the Bishkek calendar day: runs at 23:59:59.999 Bishkek and at 00:00:00 Bishkek fall on different
--     days, a moment one millisecond before 00:00 Bishkek (17:59:59.999 UTC) is still the old day, `dayStart` is
--     the exact 00:00 Bishkek instant, and only that day's runs are added up (yesterday's and tomorrow's are not);
--  4. what is added up: every status and every trigger kind of the asked agent; another agent and another
--     organization do not leak in; a run with zero cost adds zero;
--  5. the open list: only starting / running runs of the asked agent inside the window (with their recorded cost),
--     ordered by start, at most 50; finished, needs_attention, older and foreign runs are absent;
--  6. read-only: the call writes no run row and no audit event;
--  7. the "daily limit reached" record with the existing run path: reserve with the daily key and update to
--     budget_reached with the code and the Russian text gives ONE visible row (the same JSON the staff list
--     reads); the second reserve under the same key is `duplicate` and adds nothing; the next Bishkek day gets
--     its own row; that row costs nothing and does not count as a run in work.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A321_AI_AGENTS_DAILY_SPEND_SUITE_START

CREATE FUNCTION pg_temp.a321_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('32100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a321_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A321: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a321_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE); v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', COALESCE(p_claims, ''), TRUE);
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
CREATE FUNCTION pg_temp.a321_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a321_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a321_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a321_id(INTEGER) TO authenticated, service_role, anon;
-- The asked function as the service: organization number, agent key, moment (text, NULL = database clock), window.
CREATE FUNCTION pg_temp.a321_spend(p_org INTEGER, p_key TEXT, p_now TEXT, p_minutes TEXT DEFAULT 'NULL') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a321_svc(format('SELECT platform.ai_agent_runtime_daily_spend_v1(%L, %L, %s, %s)',
    pg_temp.a321_id(p_org), p_key, CASE WHEN p_now IS NULL THEN 'NULL' ELSE quote_literal(p_now) || '::timestamptz' END, p_minutes))
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organizations 1 and 2 (active); the seven agents exist for both.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a321_id(1), 'A321 Fictional organization', 'active'),
  (pg_temp.a321_id(2), 'A321 Other fictional organization', 'active');
SELECT platform_private.ai_agents_ensure_rows(pg_temp.a321_id(1));
SELECT platform_private.ai_agents_ensure_rows(pg_temp.a321_id(2));

-- A run row with a chosen start, status, trigger and cost (the owner writes it directly, as the other suites do).
CREATE FUNCTION pg_temp.a321_run(p_org INTEGER, p_key TEXT, p_status TEXT, p_trigger TEXT, p_cost INTEGER, p_started TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO platform_private.ai_agent_runs(organization_id, agent_key, trigger_kind, status, cost_cents, started_at, ended_at)
  VALUES (pg_temp.a321_id(p_org), p_key, p_trigger, p_status, p_cost, p_started::timestamptz,
    CASE WHEN p_status IN ('starting', 'running') THEN NULL ELSE p_started::timestamptz + INTERVAL '2 minutes' END)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a321_assert((SELECT count(*) = 1 AND bool_and(p.prosecdef) AND bool_and(p.proconfig = ARRAY['search_path=""']::TEXT[])
    AND bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE') OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
  FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'ai_agent_runtime_daily_spend_v1'),
  'posture: definer, empty search_path, service_role only (one function, no overload)');
SELECT pg_temp.a321_assert(
  (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_runtime\_%') = 17
  AND (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agents\_%\_v1') = 9
  AND (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_mcp\_%') = 3
  AND (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_tool\_%') = 24,
  'posture: 17 runtime functions (16 + this one), 9 staff, 3 MCP, 24 tool functions');
SELECT pg_temp.a321_assert(
  pg_temp.a321_err(pg_temp.a321_call('anon', '{"role":"anon"}', format('SELECT platform.ai_agent_runtime_daily_spend_v1(%L, ''sales'')', pg_temp.a321_id(1)))) = '42501'
  AND pg_temp.a321_err(pg_temp.a321_call('authenticated', '{"role":"authenticated"}', format('SELECT platform.ai_agent_runtime_daily_spend_v1(%L, ''sales'')', pg_temp.a321_id(1)))) = '42501',
  'anon and authenticated cannot execute it (42501)');

-- ---------------------------------------------------------------------------
-- 2. Input.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a321_assert(
  pg_temp.a321_err(pg_temp.a321_spend(1, 'nope', '2026-10-26 12:00:00+06')) = 'P0002'
  AND pg_temp.a321_err(pg_temp.a321_svc('SELECT platform.ai_agent_runtime_daily_spend_v1(NULL, ''sales'')')) = 'P0002'
  AND pg_temp.a321_err(pg_temp.a321_svc(format('SELECT platform.ai_agent_runtime_daily_spend_v1(%L, NULL)', pg_temp.a321_id(1)))) = 'P0002',
  'an unknown agent key, a NULL key or a NULL organization is ai_agent_not_found (P0002)');
-- Without a moment: the database clock decides the day (the same day the SQL computes itself).
SELECT pg_temp.a321_assert(
  (pg_temp.a321_svc(format('SELECT platform.ai_agent_runtime_daily_spend_v1(%L, ''sales'')', pg_temp.a321_id(1))) ->> 'day')
    = to_char((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE, 'YYYY-MM-DD'),
  'no moment given -> the database clock, Bishkek day');

-- ---------------------------------------------------------------------------
-- 3-4. Which day, and what is added up. "Today" is 2026-10-26 in Bishkek (UTC+6): [2026-10-25 18:00Z; 2026-10-26 18:00Z).
-- ---------------------------------------------------------------------------
SELECT pg_temp.a321_run(1, 'sales', 'completed', 'whatsapp_inbound', 150, '2026-10-26 10:00:00+06');
SELECT pg_temp.a321_run(1, 'sales', 'failed', 'website_lead', 250, '2026-10-26 11:00:00+06');
SELECT pg_temp.a321_run(1, 'sales', 'budget_reached', 'command', 100, '2026-10-26 09:00:00+06');
SELECT pg_temp.a321_run(1, 'sales', 'interrupted', 'schedule', 0, '2026-10-26 08:00:00+06');
SELECT pg_temp.a321_run(1, 'sales', 'needs_attention', 'whatsapp_inbound', 7, '2026-10-26 07:00:00+06');
-- The edges of the day: 23:59:59.999 Bishkek the day before (yesterday), 00:00:00 Bishkek (today's first instant),
-- 23:59:59.999 Bishkek today (today's last instant), 00:00:00 Bishkek tomorrow (tomorrow).
SELECT pg_temp.a321_run(1, 'sales', 'completed', 'whatsapp_inbound', 900, '2026-10-25 23:59:59.999+06');
SELECT pg_temp.a321_run(1, 'sales', 'completed', 'whatsapp_inbound', 1000, '2026-10-26 00:00:00+06');
SELECT pg_temp.a321_run(1, 'sales', 'completed', 'whatsapp_inbound', 20000, '2026-10-26 23:59:59.999+06');
SELECT pg_temp.a321_run(1, 'sales', 'completed', 'whatsapp_inbound', 700, '2026-10-27 00:00:00+06');
-- Another agent of the same organization and the same agent of another organization.
SELECT pg_temp.a321_run(1, 'curator-cn', 'completed', 'whatsapp_inbound', 999, '2026-10-26 10:00:00+06');
SELECT pg_temp.a321_run(2, 'sales', 'completed', 'whatsapp_inbound', 888, '2026-10-26 10:00:00+06');

-- Today: 150 + 250 + 100 + 0 + 7 + 1000 + 20000 = 21507 (all statuses, all trigger kinds; 900 and 700 are other days).
SELECT pg_temp.a321_spend(1, 'sales', '2026-10-26 12:00:00+06') AS a321_today \gset
SELECT pg_temp.a321_assert((:'a321_today'::JSONB ->> 'spentCents')::INTEGER = 21507
  AND (:'a321_today'::JSONB ->> 'day') = '2026-10-26'
  AND (:'a321_today'::JSONB ->> 'dayStart')::TIMESTAMPTZ = TIMESTAMPTZ '2026-10-26 00:00:00+06',
  'today adds up every status and trigger of the agent, from 00:00:00 to 23:59:59.999 Bishkek, and dayStart is 00:00 Bishkek');
-- The same day from the first and the last instant, and from a UTC moment that is already Bishkek's next day.
SELECT pg_temp.a321_assert(
  (pg_temp.a321_spend(1, 'sales', '2026-10-26 00:00:00+06') ->> 'spentCents')::INTEGER = 21507
  AND (pg_temp.a321_spend(1, 'sales', '2026-10-26 23:59:59.999+06') ->> 'spentCents')::INTEGER = 21507
  AND (pg_temp.a321_spend(1, 'sales', '2026-10-26 17:59:59.999+00') ->> 'day') = '2026-10-26'
  AND (pg_temp.a321_spend(1, 'sales', '2026-10-25 17:59:59.999+00') ->> 'day') = '2026-10-25',
  'one millisecond before 00:00 Bishkek (17:59:59.999 UTC) is still the old day');
SELECT pg_temp.a321_assert(
  (pg_temp.a321_spend(1, 'sales', '2026-10-26 18:00:00+00') ->> 'day') = '2026-10-27'
  AND (pg_temp.a321_spend(1, 'sales', '2026-10-26 18:00:00+00') ->> 'spentCents')::INTEGER = 700
  AND (pg_temp.a321_spend(1, 'sales', '2026-10-26 18:00:00+00') ->> 'dayStart')::TIMESTAMPTZ = TIMESTAMPTZ '2026-10-26 18:00:00+00',
  '00:00:00 Bishkek (18:00:00 UTC) starts the next day: the 700-cent run counts there and the 20000-cent run does not');
SELECT pg_temp.a321_assert((pg_temp.a321_spend(1, 'sales', '2026-10-25 12:00:00+06') ->> 'spentCents')::INTEGER = 900,
  'yesterday is its own day: only the run of 23:59:59.999 the evening before counts');
-- Another agent / another organization are separate; a day with no runs is zero, not null.
SELECT pg_temp.a321_assert(
  (pg_temp.a321_spend(1, 'curator-cn', '2026-10-26 12:00:00+06') ->> 'spentCents')::INTEGER = 999
  AND (pg_temp.a321_spend(2, 'sales', '2026-10-26 12:00:00+06') ->> 'spentCents')::INTEGER = 888
  AND (pg_temp.a321_spend(1, 'director', '2026-10-26 12:00:00+06') ->> 'spentCents')::INTEGER = 0
  AND (pg_temp.a321_spend(1, 'sales', '2026-01-01 12:00:00+06') ->> 'spentCents')::INTEGER = 0,
  'another agent and another organization do not leak in; an empty day is 0');

-- ---------------------------------------------------------------------------
-- 5. The open list. Moment 2026-10-26 14:00:00+06; the window is counted back from it.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a321_run(1, 'sales', 'running', 'whatsapp_inbound', 20, '2026-10-26 13:50:00+06');
SELECT pg_temp.a321_run(1, 'sales', 'starting', 'website_lead', 0, '2026-10-26 13:01:00+06');
SELECT pg_temp.a321_run(1, 'sales', 'running', 'command', 5, '2026-10-26 12:59:00+06');
SELECT pg_temp.a321_run(1, 'sales', 'completed', 'whatsapp_inbound', 40, '2026-10-26 13:55:00+06');
SELECT pg_temp.a321_run(1, 'sales', 'needs_attention', 'command', 3, '2026-10-26 13:56:00+06');
SELECT pg_temp.a321_run(1, 'curator-cn', 'running', 'command', 11, '2026-10-26 13:58:00+06');
SELECT pg_temp.a321_run(2, 'sales', 'running', 'command', 12, '2026-10-26 13:58:00+06');
SELECT pg_temp.a321_spend(1, 'sales', '2026-10-26 14:00:00+06') AS a321_open \gset
-- Default window 60 minutes: 13:50 (20 cents) and 13:01 (0 cents) are inside; 12:59 is one minute outside; finished
-- runs, another agent and another organization are absent. Ordered by start.
SELECT pg_temp.a321_assert(jsonb_array_length(:'a321_open'::JSONB -> 'open') = 2
  AND (:'a321_open'::JSONB -> 'open' -> 0 ->> 'costCents') = '0' AND (:'a321_open'::JSONB -> 'open' -> 1 ->> 'costCents') = '20'
  AND (:'a321_open'::JSONB -> 'open' -> 0 ->> 'startedAt')::TIMESTAMPTZ = TIMESTAMPTZ '2026-10-26 13:01:00+06'
  AND (:'a321_open'::JSONB -> 'open' -> 1 ->> 'startedAt')::TIMESTAMPTZ = TIMESTAMPTZ '2026-10-26 13:50:00+06',
  'the open list: starting / running of this agent inside 60 minutes, ordered by start, with the recorded cost');
-- The recorded cost of an open run started today is also in spentCents (everything started today is).
SELECT pg_temp.a321_assert((:'a321_open'::JSONB ->> 'spentCents')::INTEGER = 21507 + 20 + 0 + 5 + 40 + 3,
  'spentCents includes the recorded cost of the open and the just-finished runs of today');
-- The window is the caller's: 5 minutes sees only the 13:50 run; 1 is the minimum (0 and negative clamp to 1);
-- an absurd value clamps to 1440 minutes (all three open runs, 12:59 included).
SELECT pg_temp.a321_assert(
  jsonb_array_length(pg_temp.a321_spend(1, 'sales', '2026-10-26 14:00:00+06', '15') -> 'open') = 1
  AND jsonb_array_length(pg_temp.a321_spend(1, 'sales', '2026-10-26 14:00:00+06', '5') -> 'open') = 0
  AND jsonb_array_length(pg_temp.a321_spend(1, 'sales', '2026-10-26 13:50:30+06', '0') -> 'open') = 1
  AND jsonb_array_length(pg_temp.a321_spend(1, 'sales', '2026-10-26 14:00:00+06', '-7') -> 'open') = 0
  AND jsonb_array_length(pg_temp.a321_spend(1, 'sales', '2026-10-26 14:00:00+06', '99999') -> 'open') = 3
  AND jsonb_array_length(pg_temp.a321_spend(1, 'sales', '2026-10-26 14:00:00+06', 'NULL') -> 'open') = 2,
  'the window: 15 -> 1 run, 5 -> 0, 0 and -7 clamp to 1 minute, 99999 clamps to 1440 (3 runs), NULL -> 60');
-- At most 50 are listed, oldest first.
INSERT INTO platform_private.ai_agent_runs(organization_id, agent_key, trigger_kind, status, cost_cents, started_at)
SELECT pg_temp.a321_id(1), 'director', 'command', 'running', n, TIMESTAMPTZ '2026-10-26 13:00:00+06' + n * INTERVAL '10 seconds'
FROM generate_series(1, 55) n;
SELECT pg_temp.a321_assert(jsonb_array_length(pg_temp.a321_spend(1, 'director', '2026-10-26 14:00:00+06') -> 'open') = 50
  AND (pg_temp.a321_spend(1, 'director', '2026-10-26 14:00:00+06') -> 'open' -> 0 ->> 'costCents') = '1'
  AND (pg_temp.a321_spend(1, 'director', '2026-10-26 14:00:00+06') -> 'open' -> 49 ->> 'costCents') = '50',
  'the open list is capped at 50, oldest first');

-- ---------------------------------------------------------------------------
-- 6. Read-only.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a321_before AS SELECT
  (SELECT count(*) FROM platform_private.ai_agent_runs) AS runs, (SELECT count(*) FROM platform.audit_events) AS audits;
SELECT pg_temp.a321_spend(1, 'sales', '2026-10-26 14:00:00+06');
SELECT pg_temp.a321_spend(2, 'sales', NULL);
SELECT pg_temp.a321_assert((SELECT runs = (SELECT count(*) FROM platform_private.ai_agent_runs) AND audits = (SELECT count(*) FROM platform.audit_events)
  FROM a321_before), 'the read writes no run row and no audit event');

-- ---------------------------------------------------------------------------
-- 7. The "daily limit reached" record through the existing run path (what src/lib/server/ai-agents/daily-cap.ts does).
-- ---------------------------------------------------------------------------
SELECT pg_temp.a321_svc(format($q$SELECT platform.ai_agent_runtime_run_reserve_v1(%L, 'curator-tr', 'whatsapp_inbound', 'wacap:2026-10-26',
  NULL, NULL, 'Новое сообщение в WhatsApp', 'claude-sonnet-5-5', 3)$q$, pg_temp.a321_id(1))) AS a321_res1 \gset
SELECT pg_temp.a321_assert((:'a321_res1'::JSONB ->> 'reserved') = 'true', 'the daily record row is reserved');
SELECT pg_temp.a321_svc(format($q$SELECT platform.ai_agent_runtime_run_update_v1(%L, %L, %L::jsonb)$q$, pg_temp.a321_id(1),
  (:'a321_res1'::JSONB ->> 'runId'),
  '{"status":"budget_reached","endedAt":"2026-10-26T08:00:00Z","errorCode":"daily_budget_reached","errorMessage":"Дневной лимит $10 на WhatsApp исчерпан — до завтра агент не запускается"}')) AS a321_upd \gset
SELECT pg_temp.a321_assert((:'a321_upd'::JSONB ->> 'ok') = 'true', 'starting -> budget_reached is an allowed transition');
SELECT pg_temp.a321_svc(format('SELECT platform.ai_agent_runtime_run_get_v1(%L, %L)', pg_temp.a321_id(1), (:'a321_res1'::JSONB ->> 'runId'))) AS a321_row \gset
SELECT pg_temp.a321_assert((:'a321_row'::JSONB ->> 'status') = 'budget_reached'
  AND (:'a321_row'::JSONB ->> 'triggerKind') = 'whatsapp_inbound'
  AND (:'a321_row'::JSONB ->> 'errorCode') = 'daily_budget_reached'
  AND (:'a321_row'::JSONB ->> 'errorMessage') = 'Дневной лимит $10 на WhatsApp исчерпан — до завтра агент не запускается'
  AND (:'a321_row'::JSONB ->> 'promptPreview') = 'Новое сообщение в WhatsApp'
  AND (:'a321_row'::JSONB ->> 'costCents')::INTEGER = 0 AND (:'a321_row'::JSONB ->> 'sessionId') IS NULL,
  'the record reads back as a stopped run with the code, the Russian text and no cost or session');
-- Same key the same day: duplicate, nothing added. The next Bishkek day: its own row.
SELECT pg_temp.a321_svc(format($q$SELECT platform.ai_agent_runtime_run_reserve_v1(%L, 'curator-tr', 'whatsapp_inbound', 'wacap:2026-10-26',
  NULL, NULL, 'Новое сообщение в WhatsApp', NULL, NULL)$q$, pg_temp.a321_id(1))) AS a321_res2 \gset
SELECT pg_temp.a321_svc(format($q$SELECT platform.ai_agent_runtime_run_reserve_v1(%L, 'curator-tr', 'whatsapp_inbound', 'wacap:2026-10-27',
  NULL, NULL, 'Новое сообщение в WhatsApp', NULL, NULL)$q$, pg_temp.a321_id(1))) AS a321_res3 \gset
SELECT pg_temp.a321_assert((:'a321_res2'::JSONB ->> 'reserved') = 'false' AND (:'a321_res2'::JSONB ->> 'reason') = 'duplicate'
  AND (:'a321_res2'::JSONB ->> 'existingRunId') = (:'a321_res1'::JSONB ->> 'runId')
  AND (:'a321_res3'::JSONB ->> 'reserved') = 'true'
  AND (SELECT count(*) FROM platform_private.ai_agent_runs WHERE agent_key = 'curator-tr' AND dedupe_key LIKE 'wacap:%') = 2,
  'one record per agent and day: the second reserve under the same key is duplicate, the next day has its own');
SELECT pg_temp.a321_svc(format('SELECT platform.ai_agent_runtime_run_update_v1(%L, %L, %L::jsonb)', pg_temp.a321_id(1),
  (:'a321_res3'::JSONB ->> 'runId'),
  '{"status":"budget_reached","errorCode":"daily_budget_reached","errorMessage":"x"}'));
-- The finished record is not a run in work, costs nothing and the spend of the agent is unchanged by it.
SELECT pg_temp.a321_assert(
  jsonb_array_length(pg_temp.a321_spend(1, 'curator-tr', '2026-10-26 12:00:00+06') -> 'open') = 0
  AND (pg_temp.a321_spend(1, 'curator-tr', '2026-10-26 12:00:00+06') ->> 'spentCents')::INTEGER = 0,
  'the daily record is not in the open list and adds no spend');

\echo A321_AI_AGENTS_DAILY_SPEND_SUITE_PASSED
ROLLBACK;
