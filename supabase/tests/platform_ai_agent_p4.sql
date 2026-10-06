\set ON_ERROR_STOP on
-- Boundary suite for migrations 275–277 («ИИ-агент» P4: ночной автоответчик,
-- docs/EVO_AI_AGENT_PLAN_2026-10-06.md §11 правила 1–13 и таблица «Где
-- проверяется», §15 P4, §18 Q5–Q9, Q11; ADR 0031). Runs on the real chain
-- right after 277 inside one transaction that is rolled back, with its own
-- synthetic organizations; no provider, Gemini call, real person, real phone
-- or production action — the "provider" is a synthetic message id handed to
-- the real finish. Members are modelled like production (invited staff have
-- coarse role NULL; rights come from scoped role assignments; the «общие
-- разделы» role receives ai.agent.use/manage from the 268 grant); every
-- client message comes from the REAL WAHA projection chain; every send goes
-- through the REAL canonical chain (authorize → authority triggers → exact
-- claim → finish). Decisions the agent makes are the agent role's real RPC
-- calls; rows of past nights and a few «scheduled» rows for authorize-only
-- refusals are seeded as the owner.
--
-- Proves:
--  1. catalog: five FORCE-RLS tables without policies or grants; ships off
--     (enabled false, shadow true, delay 30–90, limits 4/8/30 that can be
--     lowered, never raised); 39 staff and 42 agent functions, hardened; the
--     only platform.ai_autosend_* functions are authorize and record, for
--     service_role only; the agent cannot call them; the canonical send path
--     (request, claim ×2, finish, enqueue, attempt states, reconciliation,
--     authority triggers) is byte-for-byte the pre-P4 source;
--  2. helpers: the final phrase (Fri 21:00 and the night before an «on»
--     Friday → «В понедельник»; Mon 01:00 → «Завтра»; Tue 07:00 → «Сегодня»;
--     a date beyond 6 days; KY/EN marked for review), the window (overnight
--     spans, «on» days merged, «off» days cut), every stop-word stem and link
--     pattern, markers, 1001 characters, numbers («1 500»/«1500», a percent
--     only matches a percent);
--  3. off: the agent functions refuse (42501) or journal a skip while the
--     autoresponder is off, without consent, paused or outside the interval;
--     enabling needs consent (PT412) and the actor's manual-send right
--     (42501); the first enable forces shadow; the enabler is responsible;
--  4. the commit column, rule by rule, on agent RPCs: 1 (curator chat, no
--     binding, outbound source), 2 (not latest, aged, outside), 3 (staff
--     after the client, an AI ticket, a queued manual send, exclusion,
--     media only, 4/8/30 on seeded rows, handed off after a final phrase),
--     4 (internal / not allowed / not offered), 5 (numbers), 6 (open review
--     item), 7/13 (stop word, link, length), 8 (one row per message), 11
--     (shadow row, phrase_unconfirmed in live test); search returns only
--     allowed client chunks; the disclosure line on the first row;
--  5. the authorize column: the live-test chat goes authorize → exact claim
--     → finish → record, the author is the responsible member, the text is
--     the stored one, one work item even on a double authorize; transcript
--     origin «autoreply» and the attempt kind only on autoresponder rows;
--     refusals journalled for every rule (1–4, 6, 7/13, 11 each state, the
--     responsible member suspended or without the right, provider down →
--     pause); the agent and authenticated get 42501; the insert guard
--     refuses a tampered text or a missing GUC; the one-source CHECK;
--     record: sent needs the provider binding, 463/475 and three failures
--     pause; three Gemini errors pause; only a human resumes;
--  6. summaries and tasks: per ended interval once; a «Позвонить клиенту»
--     task only for a live sent final phrase (creator = assignee = the
--     responsible member, 10:00 Bishkek of the call date, high, events,
--     receipt, lead link, system audit), none in shadow; live needs three
--     shadow nights, a confirmed RU disclosure and no pause (PT412);
--     qualification put guards; staff readers hide text and qualification
--     from members who cannot read the chat;
--  7. manual sends are unchanged (exact 18-key result, kind manual, origin
--     crm, the 15 attempt keys) and maintenance expires stale rows;
--  8. review fixes: an authorize replay of a work item nobody claimed yet
--     re-checks every rule (staff reply, newer client message, older than
--     60 s, provider down) and takes the item off the queue (dead letter,
--     decision cancelled, the exact claim gets nothing); pause, disable,
--     exclusion, the shadow switch and maintenance take such items off too;
--     a claimed item replays as already_claimed; the off switch applies even
--     when cleanup cannot dead-letter an item; the live-test list and
--     live_test mode need three shadow nights; a night counts only with a
--     shadow answer and within 30 days; shadow rows do not suppress the
--     disclosure line of the first live reply; links (any label.tld,
--     look-alike dots, shorteners) and payment words (with Latin look-alikes)
--     stop; numbers in any digit script need a source; islands longer than
--     a day are cut at noon; a «Позвонить клиенту» task also for an unknown
--     final phrase, with a notification; rule 2 (newest), closed chat,
--     history message and rule 4 (ready, not superseded) at due, commit and
--     authorize; the insert guard refuses a decision that is not scheduled.
BEGIN;

DO $p4_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$p4_auth_role$;

CREATE FUNCTION pg_temp.p4_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p4_wid(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27700000-0000-4000-9000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p4_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P4: %', message; END IF;
END
$$;
-- 'ok' or SQLSTATE:message of a failing statement (current role).
CREATE FUNCTION pg_temp.p4_err(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
CREATE TEMP TABLE p4_actors(n INTEGER, org INTEGER, coarse platform.business_role, claims TEXT);
-- The JSONB result of a call as the agent role, or {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.p4_agent(sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', '', TRUE);
  SET LOCAL ROLE evo_ai_agent;
  BEGIN
    EXECUTE sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    result := jsonb_build_object('error', SQLSTATE || ':' || SQLERRM);
  END;
  RESET ROLE;
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
-- The same as the service role (the CRM server).
CREATE FUNCTION pg_temp.p4_service(sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  SET LOCAL ROLE service_role;
  BEGIN
    EXECUTE sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    result := jsonb_build_object('error', SQLSTATE || ':' || SQLERRM);
  END;
  RESET ROLE;
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
-- The same as a staff member (actor n) with their JWT claims; n = 0 — anon.
CREATE FUNCTION pg_temp.p4_staff(p_n INTEGER, sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  IF p_n = 0 THEN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', TRUE);
    SET LOCAL ROLE anon;
  ELSE
    PERFORM set_config('request.jwt.claims', (SELECT a.claims FROM p4_actors a WHERE a.n = p_n), TRUE);
    SET LOCAL ROLE authenticated;
  END IF;
  BEGIN
    EXECUTE sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    result := jsonb_build_object('error', SQLSTATE || ':' || SQLERRM);
  END;
  RESET ROLE;
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
CREATE FUNCTION pg_temp.p4_code(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT split_part(p_result ->> 'error', ':', 1)
$$;
GRANT SELECT ON p4_actors TO authenticated, anon, service_role, evo_ai_agent;
GRANT EXECUTE ON FUNCTION pg_temp.p4_id(INTEGER), pg_temp.p4_wid(INTEGER), pg_temp.p4_assert(BOOLEAN, TEXT),
  pg_temp.p4_err(TEXT), pg_temp.p4_agent(TEXT), pg_temp.p4_service(TEXT), pg_temp.p4_staff(INTEGER, TEXT),
  pg_temp.p4_code(JSONB)
  TO authenticated, anon, service_role, evo_ai_agent;
-- The suite acts as the agent role (as Supavisor would log it in).
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

SELECT 'AI277_AI_AGENT_P4_SUITE_START' AS ai277_suite_marker;

-- ---------------------------------------------------------------------------
-- 1. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p4_assert((SELECT count(*) = 5 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
    AND NOT has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    AND NOT has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    AND NOT has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    AND NOT has_table_privilege('evo_ai_agent', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    AND NOT has_any_column_privilege('evo_ai_agent', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'platform_private' AND p.tablename = c.relname))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'platform_private' AND c.relname IN ('ai_autosend_settings', 'ai_autosend_log',
    'ai_autosend_exclusions', 'ai_autosend_summaries', 'ai_autosend_call_tasks')),
  'the five autoresponder tables: FORCE RLS, no policy, no grant to an API role or the agent');
SELECT pg_temp.p4_assert((SELECT string_agg(a.attname || '=' || pg_get_expr(d.adbin, d.adrelid), ',' ORDER BY a.attname)
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'platform_private.ai_autosend_settings'::regclass AND a.attname IN ('enabled', 'shadow_mode',
      'delay_min_s', 'delay_max_s', 'limit_chat_hour', 'limit_chat_night', 'limit_number_hour', 'disclosure_enabled'))
  = 'delay_max_s=90,delay_min_s=30,disclosure_enabled=true,enabled=false,limit_chat_hour=4,limit_chat_night=8,limit_number_hour=30,shadow_mode=true',
  'ships off: disabled, shadow, delay 30–90 s, limits 4/8/30, disclosure on');
SELECT pg_temp.p4_assert((SELECT array_agg(p.proname ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND has_schema_privilege('evo_ai_agent', n.oid, 'USAGE')
      AND has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
  = ARRAY['answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1', 'autosend_commit_v1', 'autosend_context_v1',
    'autosend_due_v1', 'autosend_pause_v1', 'autosend_search_v1', 'autosend_summary_context_v1',
    'autosend_summary_due_v1', 'autosend_summary_put_v1', 'budget_release_v1', 'budget_reserve_v1',
    'conversation_context_v1', 'document_claim_v1', 'document_content_put_v1', 'document_index_v1',
    'document_pages_put_v1', 'document_reindex_claim_v1', 'document_reindex_v1', 'document_stage_v1',
    'inbound_since_v1', 'lab_apply_prepare_v1', 'lab_apply_v1', 'lab_documents_v1', 'lab_proposal_put_v1',
    'lab_session_get_v1', 'lab_session_put_v1', 'maintenance_v1', 'memory_context_v1', 'memory_due_v1',
    'memory_put_v1', 'rate_take_v1', 'ready_v1', 'redeem_ticket_v1', 'review_items_put_v1', 'search_v1',
    'settings_v1', 'usage_record_v1', 'work_claim_v1', 'work_extend_v1', 'work_finish_v1']::NAME[],
  'the only definer functions evo_ai_agent can execute are the 42 platform_ai_agent functions');
SELECT pg_temp.p4_assert(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform_ai_agent' AND (has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
    OR NOT p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=""'])),
  'agent functions: hardened definers no API role executes');
SELECT pg_temp.p4_assert((SELECT count(*) = 38 AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
    AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'])
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%' AND p.proname <> 'ai_agent_storage_authorize_v1'),
  'the 38 staff functions (29 of P3 + 9 autoresponder) are hardened definers executable by authenticated only');
SELECT pg_temp.p4_assert((SELECT array_agg(p.oid::regprocedure::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_autosend\_%'
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
  = ARRAY['platform.ai_autosend_authorize_v1(uuid,uuid,text,uuid)',
    'platform.ai_autosend_record_v1(uuid,uuid,text,text,uuid)'],
  'rule 9: authorize and record are the only platform.ai_autosend_* functions, for service_role only');
SELECT pg_temp.p4_assert(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform_private' AND (p.proname LIKE 'ai\_autosend\_%' OR p.proname = 'guard_ai_autosend_authorization')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE') OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))),
  'the autoresponder helpers and the insert guard are executable by no API role and not by the agent');
SELECT pg_temp.p4_assert((SELECT bool_and(md5(p.prosrc) = x.md5) AND count(*) = 12
  FROM (VALUES
    ('platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)', '5a2689b4b1e7e61a6a8b5c155c5fe6a9'),
    ('platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)', '53f27c1f3f33cbc36b554f7f01986736'),
    ('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid,uuid)', '2c30f5bbc507db484643357921f2ca7d'),
    ('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)', '95d095c0c2023a910ff09ea5de98420a'),
    ('platform.finish_manual_whatsapp_send(uuid,uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,timestamp with time zone,uuid)', '360648359239d08ee8f0cb6b8da9f690'),
    ('platform_private.p3c_enqueue_authenticated_work(uuid,platform.durable_work_kind,uuid,uuid,text,integer,uuid,platform.durable_work_operation,uuid,uuid,text)', 'abadeb64bdccc941f80de5b3c5c3856b'),
    ('platform_private.manual_whatsapp_send_attempt_states(uuid,uuid)', 'd7c460b4fc128f6e7d78de015e215721'),
    ('platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text)', '2e86f7f7109c40bfad1d25100248f697'),
    ('platform_private.capture_manual_send_authority()', 'debe84f79fb2e518e2067535c57fedd5'),
    ('platform_private.guard_p3c_current_inbound_cycle()', '9518087f0a8d8d6e2f3b1d59f5f702a5'),
    ('platform.staff_conversation_message_page(uuid,uuid,integer,timestamp with time zone,uuid)', '511747ace33be04003f6b270fe3a2446'),
    ('platform.staff_latest_manual_whatsapp_send_attempt(uuid,uuid)', '6973acf4529c5d00907b6221d1ef0b97')
  ) AS x(sig, md5) JOIN pg_proc p ON p.oid = x.sig::regprocedure),
  'the canonical send path (request, both claims, finish, enqueue, attempt states, reconciliation, the authority triggers, the v1 page, the latest-attempt reader) is the pre-P4 source');
SELECT pg_temp.p4_assert((SELECT count(*) = 5 FROM pg_trigger t WHERE t.tgrelid = 'platform.manual_send_authorizations'::regclass
    AND NOT t.tgisinternal)
  AND (SELECT pg_get_expr(d.adbin, d.adrelid) = '''manual''::text' FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'platform.manual_send_authorizations'::regclass AND a.attname = 'kind'),
  'authorizations: the four existing triggers plus the autoresponder guard; kind defaults to manual');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p4_assert(pg_temp.p4_err('SELECT count(*) FROM platform_private.ai_autosend_log') LIKE '42501:%'
  AND pg_temp.p4_err('SELECT count(*) FROM platform_private.ai_autosend_settings') LIKE '42501:%'
  AND pg_temp.p4_err('SELECT platform.ai_autosend_authorize_v1(NULL, NULL, NULL, NULL)') LIKE '42501:%'
  AND pg_temp.p4_err('SELECT platform.ai_autosend_record_v1(NULL, NULL, NULL, NULL, NULL)') LIKE '42501:%'
  AND pg_temp.p4_err('SELECT platform_private.ai_autosend_check(NULL, NULL, NULL, NULL)') LIKE '42501:%'
  AND pg_temp.p4_err('SELECT platform.ai_agent_autosend_v1(NULL)') LIKE '42501:%',
  'rule 9: the agent reads no autoresponder row and cannot call authorize, record, the check or a staff function');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Helpers (owner).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.p4_id(1), 'P4 Fictional organization'),
  (pg_temp.p4_id(2), 'P4 Other fictional organization');
CREATE FUNCTION pg_temp.p4_phrase(p_lang TEXT, p_at TIMESTAMPTZ, p_overrides JSONB DEFAULT '[]'::JSONB)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE s platform_private.ai_autosend_settings;
BEGIN
  s := platform_private.ai_autosend_settings_row(pg_temp.p4_id(1));
  s.date_overrides := p_overrides;
  RETURN platform_private.ai_autosend_final_phrase(s, p_lang, p_at);
END
$$;
CREATE FUNCTION pg_temp.p4_window(p_at TIMESTAMPTZ, p_overrides JSONB DEFAULT '[]'::JSONB, p_schedule JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE s platform_private.ai_autosend_settings;
BEGIN
  s := platform_private.ai_autosend_settings_row(pg_temp.p4_id(1));
  s.date_overrides := p_overrides;
  s.schedule := COALESCE(p_schedule, s.schedule);
  RETURN platform_private.ai_autosend_window(s, p_at);
END
$$;
-- 2026-10-09 is a Friday.
SELECT pg_temp.p4_assert(pg_temp.p4_phrase('ru', '2026-10-09 21:00+06') ->> 'text'
    = 'В понедельник в рабочее время вам позвонит наш руководитель.'
  AND pg_temp.p4_phrase('ru', '2026-10-09 21:00+06') ->> 'callDate' = '2026-10-12'
  AND pg_temp.p4_phrase('ru', '2026-10-08 21:00+06', '[{"from":"2026-10-09","to":"2026-10-09","mode":"on"}]') ->> 'text'
    = 'В понедельник в рабочее время вам позвонит наш руководитель.'
  AND pg_temp.p4_phrase('ru', '2026-10-12 01:00+06') ->> 'text' = 'Завтра в рабочее время вам позвонит наш руководитель.'
  AND pg_temp.p4_phrase('ru', '2026-10-12 01:00+06') ->> 'callDate' = '2026-10-12'
  AND pg_temp.p4_phrase('ru', '2026-10-13 07:00+06') ->> 'text' = 'Сегодня в рабочее время вам позвонит наш руководитель.'
  AND pg_temp.p4_phrase('ru', '2026-10-14 21:00+06') ->> 'text' = 'Завтра в рабочее время вам позвонит наш руководитель.'
  AND pg_temp.p4_phrase('ru', '2026-10-08 21:00+06', '[{"from":"2026-10-09","to":"2026-10-21","mode":"on"}]') ->> 'text'
    = '22 октября в рабочее время вам позвонит наш руководитель.'
  AND (pg_temp.p4_phrase('ru', '2026-10-12 01:00+06') ->> 'confirmed')::BOOLEAN,
  'final phrase: Fri 21:00 and the night before an «on» Friday → Monday; Mon 01:00 → tomorrow; Tue 07:00 → today; a long holiday → a date; RU confirmed');
SELECT pg_temp.p4_assert(pg_temp.p4_phrase('ky', '2026-10-09 21:00+06') ->> 'text'
    = 'Дүйшөмбү күнү иш убактысында биздин жетекчи сизге чалат.'
  AND (pg_temp.p4_phrase('ky', '2026-10-09 21:00+06') ->> 'dayWordsReview')::BOOLEAN
  AND NOT (pg_temp.p4_phrase('ky', '2026-10-09 21:00+06') ->> 'confirmed')::BOOLEAN
  AND pg_temp.p4_phrase('en', '2026-10-09 21:00+06') ->> 'text' = 'Our manager will call you on Monday during business hours.'
  AND pg_temp.p4_phrase('en', '2026-10-12 01:00+06') ->> 'text' = 'Our manager will call you tomorrow during business hours.'
  AND NOT (pg_temp.p4_phrase('en', '2026-10-12 01:00+06') ->> 'dayWordsReview')::BOOLEAN,
  'KY/EN drafts: unconfirmed, day words marked for review');
SELECT pg_temp.p4_assert(pg_temp.p4_window('2026-10-09 21:00+06')
    = '{"inside": true, "intervalStart": "2026-10-09T14:00:00+00:00", "intervalEnd": "2026-10-10T03:00:00+00:00", "nextStart": "2026-10-10T14:00:00+00:00"}'::JSONB
  AND NOT (pg_temp.p4_window('2026-10-10 12:00+06') ->> 'inside')::BOOLEAN
  AND pg_temp.p4_window('2026-10-09 11:00+06', '[{"from":"2026-10-09","to":"2026-10-09","mode":"on"}]') ->> 'intervalStart'
    = '2026-10-08T14:00:00+00:00'
  AND pg_temp.p4_window('2026-10-09 11:00+06', '[{"from":"2026-10-09","to":"2026-10-09","mode":"on"}]') ->> 'intervalEnd'
    = '2026-10-09T06:00:00+00:00'
  AND pg_temp.p4_window('2026-10-09 12:00+06', '[{"from":"2026-10-09","to":"2026-10-09","mode":"on"}]') ->> 'intervalStart'
    = '2026-10-09T06:00:00+00:00'
  AND pg_temp.p4_window('2026-10-09 12:00+06', '[{"from":"2026-10-09","to":"2026-10-09","mode":"on"}]') ->> 'intervalEnd'
    = '2026-10-10T03:00:00+00:00'
  AND NOT (pg_temp.p4_window('2026-10-09 21:00+06', '[{"from":"2026-10-09","to":"2026-10-09","mode":"off"}]') ->> 'inside')::BOOLEAN
  AND pg_temp.p4_window('2026-10-10 02:00+06', '[{"from":"2026-10-09","to":"2026-10-09","mode":"off"}]') ->> 'intervalStart'
    = '2026-10-09T18:00:00+00:00',
  'window: 20:00–09:00 owned by the start day; an «on» Friday merges Thursday night to Saturday morning, cut at Friday noon (longer than a day); an «off» day is cut out');
-- An island longer than the ±14-day clip (two «on» months, or 24 h every day)
-- has the same interval five minutes apart: noon to noon.
SELECT pg_temp.p4_assert(pg_temp.p4_window('2026-10-20 06:00+06',
    '[{"from":"2026-10-01","to":"2026-10-31","mode":"on"},{"from":"2026-11-01","to":"2026-11-30","mode":"on"}]')
    = pg_temp.p4_window('2026-10-20 06:05+06',
    '[{"from":"2026-10-01","to":"2026-10-31","mode":"on"},{"from":"2026-11-01","to":"2026-11-30","mode":"on"}]')
  AND pg_temp.p4_window('2026-10-20 06:00+06',
    '[{"from":"2026-10-01","to":"2026-10-31","mode":"on"},{"from":"2026-11-01","to":"2026-11-30","mode":"on"}]')
    = '{"inside": true, "intervalStart": "2026-10-19T06:00:00+00:00", "intervalEnd": "2026-10-20T06:00:00+00:00", "nextStart": "2026-10-20T06:00:00+00:00"}'::JSONB
  AND pg_temp.p4_window('2026-10-20 13:00+06', '[]', (SELECT jsonb_object_agg(d, '[{"from":"00:00","to":"00:00"}]'::JSONB)
    FROM unnest(ARRAY['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) d)) ->> 'intervalStart' = '2026-10-20T06:00:00+00:00'
  AND pg_temp.p4_window('2026-10-20 13:05+06', '[]', (SELECT jsonb_object_agg(d, '[{"from":"00:00","to":"00:00"}]'::JSONB)
    FROM unnest(ARRAY['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) d)) ->> 'intervalStart' = '2026-10-20T06:00:00+00:00',
  'window: an island longer than a day is cut at every Bishkek noon, so its interval does not move with now');
SELECT pg_temp.p4_assert(bool_and(COALESCE(platform_private.ai_autosend_text_reason(w), 'none') = 'stop_word'),
  'rule 7: every stem stops, in any case (and with Latin look-alike letters)')
FROM unnest(ARRAY['Мы гарантируем место', 'обещаем ответ', 'Скидка до мая', 'АКЦИЯ', 'это бесплатно', 'промокод EVO',
  'возврат денег', 'оплата', 'Предоплата', 'реквизиты', 'счёт', 'счет', 'карта', 'карту', 'картой', 'на карте', 'карты',
  'карточка', 'перевод', 'Переведите', 'Kaspi', 'MBank', 'элсом', 'кепилдик', 'арзандатуу', 'акысыз', 'төлөңүз',
  'We guarantee', 'a discount', 'free', 'refund', 'pay now', 'invoice', 'card', 'transfer', 'IBAN',
  'Заплатите', 'заплатить', 'Платёж', 'Плата за обучение', 'Доплата', 'Перечислите', 'Переведи', 'Скиньте деньги',
  'Элкарт', 'Visa/Mastercard', 'О!Деньги', 'oплатите', 'ОПЛATA', 'наличными', 'в кассу', 'взнос', 'аванс', 'залог',
  'tuition fee', 'cash', 'money', 'Western Union', 'Золотая корона', 'акча', 'Можно заплатить наличными в офисе или перечислить на Элкарт.']) w;
SELECT pg_temp.p4_assert(bool_and(COALESCE(platform_private.ai_autosend_text_reason(w), 'none') = 'link'),
  'rule 13: every link pattern stops (any label.tld, shorteners, look-alike dots and letters)')
FROM unnest(ARRAY['http://x.example', 'https://y.example', 'www.y', 'wa.me/996', 't.me/evo', 'evo.kg', 'site.com', 'a.ru',
  'b.org', 'c.net', 'd.io', 'e.me', 'bit.ly/evo', 'goo.gl/x', 'evoadmissions.kz', 'uni.edu.my', 'evo.co', 'evo.info', 'эво.рф',
  'evo .kg', 'evo[.]kg', 'evo．kg', 'evo。kg', 'evo dot kg', 'wa me/996', 'еvо.kg', 'ｗｗｗ.evo', 'Подробнее на evoadmissions.kz или bit.ly/evo']) w;
SELECT pg_temp.p4_assert(platform_private.ai_autosend_text_reason(repeat('а', 1001)) = 'too_long'
  AND platform_private.ai_autosend_text_reason(repeat('а', 1000)) IS NULL
  AND platform_private.ai_autosend_text_reason('Учёба в Малайзии [1]') = 'marker'
  AND platform_private.ai_autosend_text_reason('Какая страна и уровень обучения вас интересуют?') IS NULL
  AND platform_private.ai_autosend_text_reason('картина и картофель') IS NULL
  AND platform_private.ai_autosend_text_reason('Учёба на онлайн-платформе, второй раунд набора.') IS NULL
  AND platform_private.ai_autosend_text_reason('Перечисленные документы нужны для визы; student visa and permit.') IS NULL
  AND platform_private.ai_autosend_text_reason('Офис в г.Бишкек. Учёба 1.5 года, т.е. три семестра.') IS NULL
  AND (SELECT jsonb_array_length(platform_private.ai_autosend_patterns() -> 'stems')) = 64
  AND platform_private.ai_autosend_patterns() ->> 'maxLength' = '1000',
  'rules 7/13: 1001 characters, [n] markers; a question and look-alike words pass; one pattern source');
SELECT pg_temp.p4_assert((SELECT array_agg(t.token || CASE WHEN t.pct THEN '%' ELSE '' END ORDER BY t.token)
    FROM platform_private.ai_autosend_number_tokens('Стоимость 1 500 $, налог 2,5 %, в 2026 году. 12 000 сом, 1, 3, 6 месяцев') t)
  = ARRAY['1', '12000', '1500', '2.5%', '2026', '3', '6'],
  'rule 5: «1 500» → 1500, «2,5 %» → 2.5%, lists stay separate');
SELECT pg_temp.p4_assert((SELECT array_agg(t.token ORDER BY t.token)
    FROM platform_private.ai_autosend_number_tokens('Стоимость １５００ долларов, ٥٠٠ или ۴۰۰, ½ суммы, ²') t)
  = ARRAY['1', '1500', '2', '2', '400', '500'],
  'rule 5: fullwidth, Arabic-Indic and Eastern Arabic-Indic digits, ½ and ² are numbers too');

-- ---------------------------------------------------------------------------
-- 3. Fixture. Organization 1: 1 Admin (system); invited staff (coarse NULL):
--    2 sales (WhatsApp at organization scope, tasks, «общие разделы» →
--    ai.agent.use/manage), 3 ai.agent.use only (no chat), 4 ai.agent.use +
--    manage and chat read without manual send; 5 Student. Organization 2:
--    6 Admin.
-- ---------------------------------------------------------------------------
INSERT INTO p4_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, NULL),
  (5, 1, 'student'), (6, 2, 'admin');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.p4_id(100 + n), 'p4-' || n || '@example.invalid', '{}'::JSONB FROM p4_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.p4_id(200 + n), pg_temp.p4_id(100 + n), 'P4 Actor ' || n, 'active', 1 FROM p4_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.p4_id(300 + a.n), pg_temp.p4_id(a.org), pg_temp.p4_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM p4_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id IN (pg_temp.p4_id(301), pg_temp.p4_id(306));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.p4_id(401), pg_temp.p4_id(1), 'organization', pg_temp.p4_id(1), 1),
  (pg_temp.p4_id(402), pg_temp.p4_id(2), 'organization', pg_temp.p4_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.p4_id(1), pg_temp.p4_id(301), pg_temp.p4_id(401), 1, 1, TRUE, 'system', 'P4 synthetic scope', pg_temp.p4_id(601)),
  (pg_temp.p4_id(2), pg_temp.p4_id(306), pg_temp.p4_id(402), 1, 1, TRUE, 'system', 'P4 synthetic scope', pg_temp.p4_id(602));

CREATE TEMP TABLE p4_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER, phase INTEGER);
INSERT INTO p4_roles VALUES
 (pg_temp.p4_id(1101), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1110, 1),
 (pg_temp.p4_id(1102), 'WhatsApp', '["communication.manual.send","communication.read.full"]', 1120, 1),
 (pg_temp.p4_id(1103), 'Tasks', '["staff.task.complete","staff.task.edit","staff.task.read"]', 1130, 1),
 (pg_temp.p4_id(1105), 'AI viewer', '["ai.agent.use","organization.read"]', 1150, 2),
 (pg_temp.p4_id(1106), 'AI manager', '["ai.agent.manage","ai.agent.use","organization.read"]', 1160, 2),
 (pg_temp.p4_id(1107), 'WhatsApp read', '["communication.read.full"]', 1170, 2);
CREATE TEMP TABLE p4_grants(membership INTEGER, role_id UUID, scope JSONB, phase INTEGER);
INSERT INTO p4_grants VALUES
 (302, pg_temp.p4_id(1101), jsonb_build_object('kind', 'organization', 'key', pg_temp.p4_id(1), 'resourceKind', NULL), 1),
 (302, pg_temp.p4_id(1102), jsonb_build_object('kind', 'organization', 'key', pg_temp.p4_id(1), 'resourceKind', NULL), 1),
 (302, pg_temp.p4_id(1103), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL), 1),
 (303, pg_temp.p4_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.p4_id(1), 'resourceKind', NULL), 2),
 (304, pg_temp.p4_id(1106), jsonb_build_object('kind', 'organization', 'key', pg_temp.p4_id(1), 'resourceKind', NULL), 2),
 (304, pg_temp.p4_id(1107), jsonb_build_object('kind', 'organization', 'key', pg_temp.p4_id(1), 'resourceKind', NULL), 2);
CREATE TEMP TABLE p4_bundles(role_id UUID, bundle_id UUID);
GRANT SELECT ON p4_roles, p4_grants TO authenticated;
GRANT SELECT, INSERT ON p4_bundles TO authenticated;
CREATE FUNCTION pg_temp.p4_claims(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p4_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.p4_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
-- Saves one member's role assignments (the given phase-1/2 roles) as the Admin.
CREATE FUNCTION pg_temp.p4_assign(p_membership INTEGER, p_roles UUID[], p_request INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE items JSONB; bindings JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id), '[]'::JSONB),
    COALESCE(jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2, 'bundleId', b.bundle_id,
      'bundleVersion', 1) ORDER BY g.role_id), '[]'::JSONB)
  INTO items, bindings FROM p4_grants g JOIN p4_bundles b ON b.role_id = g.role_id
  WHERE g.membership = p_membership AND g.role_id = ANY (p_roles);
  RETURN platform.staff_role_assignments_save(pg_temp.p4_id(1), pg_temp.p4_id(p_membership),
    (SELECT p.access_version FROM platform.organization_memberships om JOIN platform.profiles p ON p.id = om.profile_id
      WHERE om.id = pg_temp.p4_id(p_membership)), items, bindings, 'P4 grant roles', pg_temp.p4_id(p_request));
END
$$;
CREATE FUNCTION pg_temp.p4_roles_phase(p_phase INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD; m INTEGER; published JSONB;
BEGIN
  FOR r IN SELECT * FROM p4_roles WHERE phase = p_phase ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.p4_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'P4 ' || r.label, 'description', 'Migration 277 synthetic role',
        'permissionKeys', r.keys), 'P4 create role', pg_temp.p4_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.p4_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.p4_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'P4 publish role', pg_temp.p4_id(r.request_base + 2));
    INSERT INTO p4_bundles VALUES (r.role_id, (published ->> 'bundleId')::UUID);
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM p4_grants WHERE phase = p_phase ORDER BY 1 LOOP
    PERFORM pg_temp.p4_assign(m, ARRAY(SELECT g.role_id FROM p4_grants g WHERE g.membership = m AND g.phase = p_phase),
      2000 + m + p_phase * 10);
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p4_roles_phase(INTEGER), pg_temp.p4_assign(INTEGER, UUID[], INTEGER) TO authenticated;

SELECT pg_temp.p4_claims(1) AS p4_admin_setup \gset
SET LOCAL request.jwt.claims TO :'p4_admin_setup';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p4_roles_phase(1);
RESET ROLE;
SELECT pg_temp.p4_assert((SELECT count(*) >= 1 FROM jsonb_array_elements(
    platform_private.ai_agent_grant_common_roles('P4 grant') -> 'roles') e
  WHERE e ->> 'roleId' = pg_temp.p4_id(1101)::TEXT), 'the 268 grant publishes the AI rights into the common role');
SELECT pg_temp.p4_claims(1) AS p4_admin_setup \gset
SET LOCAL request.jwt.claims TO :'p4_admin_setup';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p4_roles_phase(2);
RESET ROLE;
UPDATE p4_actors a SET claims = pg_temp.p4_claims(a.n);
SELECT pg_temp.p4_assert(platform_private.staff_has_permission(pg_temp.p4_id(1), pg_temp.p4_id(302), 'ai.agent.manage')
  AND platform_private.staff_has_permission(pg_temp.p4_id(1), pg_temp.p4_id(302), 'communication.manual.send')
  AND platform_private.staff_has_permission(pg_temp.p4_id(1), pg_temp.p4_id(303), 'ai.agent.use')
  AND NOT platform_private.staff_has_permission(pg_temp.p4_id(1), pg_temp.p4_id(303), 'communication.read.full')
  AND platform_private.staff_has_permission(pg_temp.p4_id(1), pg_temp.p4_id(304), 'ai.agent.manage')
  AND platform_private.staff_has_permission(pg_temp.p4_id(1), pg_temp.p4_id(304), 'communication.read.full')
  AND NOT platform_private.staff_has_permission(pg_temp.p4_id(1), pg_temp.p4_id(304), 'communication.manual.send'),
  'fixture: 2 sends and manages, 3 uses without the chat, 4 manages and reads without manual send');

-- Conversations through the REAL WAHA projection chain (the intake owner is
-- the Admin). Event times are given in seconds before now.
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();
DELETE FROM pgmq.q_ai_agent_work_v1;
CREATE TEMP TABLE p4_clock AS SELECT date_trunc('second', clock_timestamp()) AS t0;
CREATE FUNCTION pg_temp.p4_ago(p_seconds INTEGER) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE AS $$
  SELECT t0 - p_seconds * INTERVAL '1 second' FROM p4_clock
$$;
CREATE SEQUENCE pg_temp.p4_seq;
CREATE FUNCTION pg_temp.p4_run(p_payload JSONB, p_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.p4_id(1);
  n CONSTANT INTEGER := nextval('pg_temp.p4_seq')::INTEGER;
  event_id CONSTANT UUID := pg_temp.p4_wid(1000 + n);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'ai277-' || n, 'crm_primary',
    p_payload ->> 'id', 'message.any', p_at,
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:ai277:' || n, lpad(to_hex(2770000 + n), 64, '0'), pg_temp.p4_wid(5000 + n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('ai277-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8,
    pg_temp.p4_wid(10000 + n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'ai277', pg_temp.p4_wid(10000 + n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.p4_id(301), pg_temp.p4_wid(10000 + n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.p4_wid(10000 + n * 10 + 4));
  IF proj ->> 'disposition' IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'P4: projection failed: %', proj;
  END IF;
  RETURN proj;
END
$$;
-- One client message (or a phone-sent one) of chat «7996770NNNN@c.us»; returns its id.
CREATE FUNCTION pg_temp.p4_in(p_chat INTEGER, p_body TEXT, p_seconds_ago INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE chat TEXT := '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'; at TIMESTAMPTZ := pg_temp.p4_ago(p_seconds_ago);
  wid TEXT := 'false_' || chat || '_AI277' || lpad(nextval('pg_temp.p4_seq')::TEXT, 15, '0');
BEGIN
  PERFORM pg_temp.p4_run(jsonb_build_object('id', wid, 'timestamp', extract(epoch FROM at)::BIGINT, 'from', chat,
    'fromMe', false, 'source', 'app', 'body', p_body), at);
  RETURN (SELECT m.id FROM platform.communication_messages m JOIN platform_private.waha_message_bindings b
    ON b.organization_id = m.organization_id AND b.communication_message_id = m.id WHERE b.raw_message_id = wid);
END
$$;
CREATE FUNCTION pg_temp.p4_out(p_chat INTEGER, p_body TEXT, p_seconds_ago INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE chat TEXT := '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'; at TIMESTAMPTZ := pg_temp.p4_ago(p_seconds_ago);
BEGIN
  PERFORM pg_temp.p4_run(jsonb_build_object('id', 'true_' || chat || '_AI277' || lpad(nextval('pg_temp.p4_seq')::TEXT, 15, '0'),
    'timestamp', extract(epoch FROM at)::BIGINT, 'from', '79967700000@c.us', 'to', chat, 'fromMe', true, 'source', 'app',
    'body', p_body), at);
END
$$;
CREATE FUNCTION pg_temp.p4_media(p_chat INTEGER, p_seconds_ago INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE chat TEXT := '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'; at TIMESTAMPTZ := pg_temp.p4_ago(p_seconds_ago);
  wid TEXT := 'false_' || chat || '_AI277' || lpad(nextval('pg_temp.p4_seq')::TEXT, 15, '0');
BEGIN
  PERFORM pg_temp.p4_run(jsonb_build_object('id', wid, 'timestamp', extract(epoch FROM at)::BIGINT, 'from', chat,
    'fromMe', false, 'source', 'app', 'hasMedia', true, 'media', jsonb_build_object('mimetype', 'image/jpeg')), at);
  RETURN (SELECT m.id FROM platform.communication_messages m JOIN platform_private.waha_message_bindings b
    ON b.organization_id = m.organization_id AND b.communication_message_id = m.id WHERE b.raw_message_id = wid);
END
$$;
CREATE FUNCTION pg_temp.p4_conv(p_chat INTEGER) RETURNS UUID LANGUAGE SQL AS $$
  SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
  WHERE binding.organization_id = pg_temp.p4_id(1) AND binding.normalized_chat_id = '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'
$$;
CREATE TEMP TABLE p4_m(label TEXT PRIMARY KEY, id UUID);
GRANT SELECT ON p4_m, p4_clock TO authenticated, service_role, evo_ai_agent;

-- Old messages (two hours ago, inside the test interval that starts 3 h back).
INSERT INTO p4_m SELECT 'p' || g, pg_temp.p4_in(20, 'P4 клиент, прошлая ночь ' || g, 7200 - g) FROM generate_series(1, 3) g;
INSERT INTO p4_m SELECT 'q' || g, pg_temp.p4_in(21, 'P4 клиент Q ' || g, 7200 - g) FROM generate_series(1, 3) g;
INSERT INTO p4_m SELECT 'x' || g, pg_temp.p4_in(22, 'P4 клиент X ' || g, 7000 - g) FROM generate_series(1, 31) g;
INSERT INTO p4_m SELECT 'h' || g, pg_temp.p4_in(23, 'P4 клиент H ' || g, 7000 - g) FROM generate_series(1, 4) g;
INSERT INTO p4_m SELECT 'g' || g, pg_temp.p4_in(24, 'P4 клиент G ' || g, 7000 - g) FROM generate_series(1, 8) g;
SELECT pg_temp.p4_conv(20) AS c_p, pg_temp.p4_conv(21) AS c_q, pg_temp.p4_conv(22) AS c_x, pg_temp.p4_conv(23) AS c_h,
  pg_temp.p4_conv(24) AS c_g \gset

-- Company materials (seeded like an indexed document): A client + allowed,
-- B client not allowed, C internal, D client + allowed with an open «Лист
-- сверки» item on page 1, E client + allowed, clean.
INSERT INTO platform_private.ai_documents(id, organization_id, title, kind, audience, autosend_allowed, status, source,
  page_count) VALUES
  (pg_temp.p4_id(801), pg_temp.p4_id(1), 'P4 Цены Малайзия', 'text', 'client', TRUE, 'ready', 'upload', 1),
  (pg_temp.p4_id(802), pg_temp.p4_id(1), 'P4 Цены без автоответчика', 'text', 'client', FALSE, 'ready', 'upload', 1),
  (pg_temp.p4_id(803), pg_temp.p4_id(1), 'P4 Внутренние условия', 'text', 'internal', FALSE, 'ready', 'upload', 1),
  (pg_temp.p4_id(804), pg_temp.p4_id(1), 'P4 Сроки (сверка)', 'text', 'client', TRUE, 'ready', 'upload', 1),
  (pg_temp.p4_id(805), pg_temp.p4_id(1), 'P4 Общежитие', 'text', 'client', TRUE, 'ready', 'upload', 1),
  (pg_temp.p4_id(806), pg_temp.p4_id(1), 'P4 Цены (на проверке)', 'text', 'client', TRUE, 'review', 'upload', 1),
  (pg_temp.p4_id(807), pg_temp.p4_id(1), 'P4 Цены (заменён)', 'text', 'client', TRUE, 'ready', 'upload', 1);
UPDATE platform_private.ai_documents SET superseded_by_id = pg_temp.p4_id(801) WHERE id = pg_temp.p4_id(807);
INSERT INTO platform_private.ai_chunks(organization_id, document_id, position, section_path, content, page_from, page_to)
VALUES
  (pg_temp.p4_id(1), pg_temp.p4_id(801), 0, 'Малайзия › Стоимость',
    'Стоимость обучения в Малайзии — 1500 $ за семестр. Сбор за визу 2,5% от суммы.', 1, 1),
  (pg_temp.p4_id(1), pg_temp.p4_id(802), 0, 'Малайзия › Стоимость (черновик)',
    'Стоимость обучения в Малайзии — 1700 $ за семестр.', 1, 1),
  (pg_temp.p4_id(1), pg_temp.p4_id(803), 0, 'Внутреннее › Малайзия',
    'Себестоимость обучения в Малайзии — 900 $ за семестр.', 1, 1),
  (pg_temp.p4_id(1), pg_temp.p4_id(804), 0, 'Малайзия › Сроки',
    'Приём документов в Малайзии до 15 мая.', 1, 1),
  (pg_temp.p4_id(1), pg_temp.p4_id(805), 0, 'Малайзия › Общежитие',
    'Общежитие в Малайзии — 300 $ в месяц.', 1, 1),
  (pg_temp.p4_id(1), pg_temp.p4_id(806), 0, 'Малайзия › Стоимость (на проверке)',
    'Стоимость обучения в Малайзии — 1600 $ за семестр.', 1, 1),
  (pg_temp.p4_id(1), pg_temp.p4_id(807), 0, 'Малайзия › Стоимость (старая)',
    'Стоимость обучения в Малайзии — 1400 $ за семестр.', 1, 1);
SELECT (SELECT id FROM platform_private.ai_chunks WHERE document_id = pg_temp.p4_id(801)) AS k_ok,
  (SELECT id FROM platform_private.ai_chunks WHERE document_id = pg_temp.p4_id(802)) AS k_noauto,
  (SELECT id FROM platform_private.ai_chunks WHERE document_id = pg_temp.p4_id(803)) AS k_internal,
  (SELECT id FROM platform_private.ai_chunks WHERE document_id = pg_temp.p4_id(804)) AS k_review,
  (SELECT id FROM platform_private.ai_chunks WHERE document_id = pg_temp.p4_id(805)) AS k_clean,
  (SELECT id FROM platform_private.ai_chunks WHERE document_id = pg_temp.p4_id(806)) AS k_notready,
  (SELECT id FROM platform_private.ai_chunks WHERE document_id = pg_temp.p4_id(807)) AS k_superseded \gset
INSERT INTO platform_private.ai_review_items(organization_id, document_id, page_no, kind, proposed, status)
VALUES (pg_temp.p4_id(1), pg_temp.p4_id(804), 1, 'number', '15', 'open');

-- Fresh WAHA readiness for the manual sends of the suite (the autoresponder probes
-- the session live instead).
INSERT INTO platform_private.messaging_integration_health_events (organization_id, target, readiness, evidence_kind,
  reason, evidence_ref, request_id, observed_at)
VALUES (pg_temp.p4_id(1), 'waha', 'ready', 'provider_observed', 'P4 synthetic fresh WAHA readiness',
  'synthetic:ai277:waha-ready', pg_temp.p4_id(3060), statement_timestamp());

SELECT 'AI277_FIXTURE_READY' AS ai277_marker;

-- ---------------------------------------------------------------------------
-- 4. Off: the agent functions refuse; enabling needs consent and the right
--    to send; the first enable forces shadow.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p4_in(30, 'P4 клиент A: здравствуйте', 40) AS a1 \gset
SELECT pg_temp.p4_conv(30) AS c_a \gset
CREATE FUNCTION pg_temp.p4_items(p_conv UUID, p_msg UUID) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform_ai_agent.autosend_due_v1(%L)',
    jsonb_build_array(jsonb_build_object('conversationId', p_conv, 'messageId', p_msg)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p4_items(UUID, UUID) TO evo_ai_agent;
SELECT pg_temp.p4_assert(pg_temp.p4_code(pg_temp.p4_agent(pg_temp.p4_items(:'c_a', :'a1'))) = '42501'
  AND pg_temp.p4_agent(pg_temp.p4_items(:'c_a', :'a1')) ->> 'error' LIKE '%ai_autosend_disabled%'
  AND pg_temp.p4_agent('SELECT platform_ai_agent.inbound_since_v1(NULL, NULL, 50)') ->> 'error' LIKE '42501:ai_background_disabled%'
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_log WHERE organization_id = pg_temp.p4_id(1)),
  'off: due and the inbound poll refuse 42501, nothing is journalled');
SELECT (pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_v1(%L)', pg_temp.p4_id(1))) ->> 'version')::BIGINT AS v0 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_enable_v1(%L, TRUE, %s, %L)',
    pg_temp.p4_id(1), :v0, pg_temp.p4_id(3001))) ->> 'error' LIKE 'PT412:ai_consent_required%',
  'enabling without the Gemini consent: PT412');
SELECT pg_temp.p4_assert((pg_temp.p4_staff(1, format('SELECT platform.ai_agent_consent_record_v1(%L, %L, %L, %L)',
    pg_temp.p4_id(1), 'grant', 'gemini-v1-2026-10-06', pg_temp.p4_id(3002))) ->> 'status') = 'granted',
  'the Admin records the consent (Q12)');
-- Pretend a stale «live» flag before the first enable: the enable still forces shadow.
UPDATE platform_private.ai_autosend_settings SET shadow_mode = FALSE WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_assert(pg_temp.p4_staff(4, format('SELECT platform.ai_agent_autosend_enable_v1(%L, TRUE, %s, %L)',
    pg_temp.p4_id(1), :v0, pg_temp.p4_id(3003))) ->> 'error' LIKE '42501:ai_autosend_sender_required%'
  AND pg_temp.p4_staff(3, format('SELECT platform.ai_agent_autosend_enable_v1(%L, TRUE, %s, %L)',
    pg_temp.p4_id(1), :v0, pg_temp.p4_id(3004))) ->> 'error' LIKE '42501:ai_agent_forbidden%'
  AND pg_temp.p4_staff(5, format('SELECT platform.ai_agent_autosend_v1(%L)', pg_temp.p4_id(1))) ->> 'error' LIKE '42501:%'
  AND pg_temp.p4_staff(6, format('SELECT platform.ai_agent_autosend_v1(%L)', pg_temp.p4_id(1))) ->> 'error' LIKE '42501:%'
  AND pg_temp.p4_staff(0, format('SELECT platform.ai_agent_autosend_v1(%L)', pg_temp.p4_id(1))) ->> 'error' LIKE '42501:%'
  AND pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_enable_v1(%L, TRUE, %s, %L)',
    pg_temp.p4_id(1), :v0 + 7, pg_temp.p4_id(3005))) ->> 'error' LIKE 'PT409:%',
  'enable: a manager without manual send 42501, a viewer, the Student, another organization and anon 42501, a stale version PT409');
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_enable_v1(%L, TRUE, %s, %L)',
  pg_temp.p4_id(1), :v0, pg_temp.p4_id(3006))) AS en1 \gset
SELECT pg_temp.p4_assert((:'en1'::JSONB ->> 'enabled')::BOOLEAN AND (:'en1'::JSONB ->> 'shadowMode')::BOOLEAN
  AND (:'en1'::JSONB ->> 'responsibleMembershipId')::UUID = pg_temp.p4_id(302)
  AND pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_enable_v1(%L, TRUE, %s, %L)',
    pg_temp.p4_id(1), :v0, pg_temp.p4_id(3006))) = :'en1'::JSONB || '{"replayed": true}'
  AND EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.request_id = pg_temp.p4_id(3006)
    AND e.action = 'ai.agent.autosend.enable' AND e.actor_kind = 'user'),
  'the first enable forces shadow; the enabler is responsible; a replay returns the receipt; audited');

-- The test schedule: every day from 3 h ago to 2 h ahead (Bishkek).
CREATE FUNCTION pg_temp.p4_schedule(p_from INTERVAL, p_to INTERVAL) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_object_agg(d, jsonb_build_array(jsonb_build_object(
    'from', to_char((clock_timestamp() AT TIME ZONE 'Asia/Bishkek') + p_from, 'HH24:MI'),
    'to', to_char((clock_timestamp() AT TIME ZONE 'Asia/Bishkek') + p_to, 'HH24:MI'))))
  FROM unnest(ARRAY['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) d
$$;
CREATE FUNCTION pg_temp.p4_version() RETURNS BIGINT LANGUAGE SQL VOLATILE AS $$
  SELECT version FROM platform_private.ai_autosend_settings WHERE organization_id = pg_temp.p4_id(1)
$$;
CREATE FUNCTION pg_temp.p4_save(p_patch JSONB, p_request INTEGER, p_n INTEGER DEFAULT 2) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p4_staff(p_n, format('SELECT platform.ai_agent_autosend_save_v1(%L, %s, %L, %L)', pg_temp.p4_id(1),
    pg_temp.p4_version(), p_patch, pg_temp.p4_id(p_request)))
$$;
-- Outside the interval: due and the poll refuse.
SELECT pg_temp.p4_assert(pg_temp.p4_save(jsonb_build_object('schedule',
    pg_temp.p4_schedule(INTERVAL '2 hours', INTERVAL '3 hours')), 3010) ->> 'status' = 'saved'
  AND pg_temp.p4_agent(pg_temp.p4_items(:'c_a', :'a1')) ->> 'error' LIKE '42501:ai_autosend_disabled%'
  AND pg_temp.p4_agent('SELECT platform_ai_agent.inbound_since_v1(NULL, NULL, 50)') ->> 'error' LIKE '42501:%',
  'outside the interval: due and the inbound poll refuse 42501');
SELECT pg_temp.p4_schedule(INTERVAL '-3 hours', INTERVAL '2 hours') AS sched_cover \gset
SELECT pg_temp.p4_assert(pg_temp.p4_save(jsonb_build_object('schedule', :'sched_cover'::JSONB), 3011) ->> 'status' = 'saved',
  'the test schedule covers now');
SELECT (platform_private.ai_autosend_window(platform_private.ai_autosend_settings_row(pg_temp.p4_id(1)), clock_timestamp())
  ->> 'intervalStart') AS i_start, (platform_private.ai_autosend_window(
  platform_private.ai_autosend_settings_row(pg_temp.p4_id(1)), clock_timestamp()) ->> 'intervalEnd') AS i_end \gset

-- ---------------------------------------------------------------------------
-- 5. The commit column on the agent's RPCs (shadow mode).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.p4_due(p_conv UUID, p_msg UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p4_agent(pg_temp.p4_items(p_conv, p_msg)) -> 'items' -> 0
$$;
CREATE FUNCTION pg_temp.p4_ctx(p_decision UUID, p_worker TEXT DEFAULT 'p4-worker') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_context_v1(%L, %L, 120)', p_decision, p_worker))
$$;
CREATE FUNCTION pg_temp.p4_search(p_decision UUID, p_text TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_search_v1(%L, %L, %L, %L, 8)', p_decision, 'p4-worker',
    '[]'::JSONB, jsonb_build_array(p_text)))
$$;
CREATE FUNCTION pg_temp.p4_commit(p_decision UUID, p_kind TEXT, p_lang TEXT, p_body TEXT, p_cited BIGINT[],
  p_reason TEXT DEFAULT NULL, p_qualification JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_commit_v1(%L, %L, %L, %L, %L, %L, %L, %L, %L)',
    p_decision, 'p4-worker', p_kind, p_lang, p_body, p_cited, p_reason, p_qualification, 'gemini-3.8-flash'))
$$;
-- A decision ready for commit: due, then context (decide) by p4-worker.
CREATE FUNCTION pg_temp.p4_decide(p_conv UUID, p_msg UUID) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE d JSONB; c JSONB;
BEGIN
  d := pg_temp.p4_due(p_conv, p_msg);
  IF d ->> 'status' <> 'considering' THEN RAISE EXCEPTION 'P4: due did not consider: %', d; END IF;
  c := pg_temp.p4_ctx((d ->> 'decisionId')::UUID);
  IF c ->> 'action' <> 'decide' THEN RAISE EXCEPTION 'P4: context did not decide: %', c; END IF;
  RETURN (d ->> 'decisionId')::UUID;
END
$$;
CREATE FUNCTION pg_temp.p4_row(p_decision UUID) RETURNS platform_private.ai_autosend_log LANGUAGE SQL AS $$
  SELECT * FROM platform_private.ai_autosend_log WHERE id = p_decision
$$;

-- Shadow happy path (chat A).
SELECT pg_temp.p4_agent('SELECT platform_ai_agent.inbound_since_v1(NULL, NULL, 200)') AS poll \gset
SELECT pg_temp.p4_assert((:'poll'::JSONB -> 'orgs') = jsonb_build_array(jsonb_build_object('organizationId', pg_temp.p4_id(1),
    'memory', FALSE, 'autosend', TRUE))
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'poll'::JSONB -> 'items') e WHERE e ->> 'messageId' = :'a1')
  AND NOT (:'poll'::TEXT LIKE '%P4 клиент%'),
  'the inbound poll serves the autoresponder gate: orgs says memory off, autosend on; pointers only');
SELECT pg_temp.p4_due(:'c_a', :'a1') AS due_a1 \gset
SELECT pg_temp.p4_assert(:'due_a1'::JSONB ->> 'status' = 'considering' AND (:'due_a1'::JSONB ->> 'enqueued')::BOOLEAN
  AND pg_temp.p4_due(:'c_a', :'a1') ->> 'decisionId' = :'due_a1'::JSONB ->> 'decisionId'
  AND (pg_temp.p4_due(:'c_a', :'a1') ->> 'existing')::BOOLEAN
  AND (SELECT count(*) = 1 FROM platform_private.ai_autosend_log WHERE client_message_id = :'a1')
  AND (SELECT count(*) = 1 FROM pgmq.q_ai_agent_work_v1 q WHERE q.message = jsonb_build_object('v', 1, 'kind', 'autosend',
    'ref_id', :'due_a1'::JSONB ->> 'decisionId')),
  'rule 8: a second due returns the same decision; one row, one pointer {v, kind, ref_id}');
SELECT (:'due_a1'::JSONB ->> 'decisionId') AS d_a1 \gset
SELECT pg_temp.p4_ctx(:'d_a1') AS ctx_a1 \gset
SELECT pg_temp.p4_assert(:'ctx_a1'::JSONB ->> 'action' = 'decide' AND :'ctx_a1'::JSONB ->> 'mode' = 'shadow'
  AND jsonb_array_length(:'ctx_a1'::JSONB -> 'messages') = 1
  AND :'ctx_a1'::JSONB -> 'messages' -> 0 ->> 'origin' = 'client'
  AND :'ctx_a1'::JSONB -> 'finalPhrase' ->> 'ru' LIKE '%в рабочее время вам позвонит наш руководитель.'
  AND (:'ctx_a1'::JSONB -> 'disclosure' ->> 'prefix')::BOOLEAN
  AND :'ctx_a1'::JSONB -> 'patterns' = platform_private.ai_autosend_patterns()
  AND (:'ctx_a1'::JSONB -> 'limitsLeft') = '{"chatHour": 4, "chatNight": 8, "numberHour": 30}'::JSONB
  AND pg_temp.p4_ctx(:'d_a1', 'p4-other') ->> 'action' = 'busy',
  'context: 20 messages with origin, final phrases, disclosure prefix, the pattern source, limits left; another worker is busy');
SELECT pg_temp.p4_search(:'d_a1', 'стоимость обучения Малайзия') AS s_a1 \gset
SELECT pg_temp.p4_assert((SELECT array_agg((e ->> 'chunkId')::BIGINT ORDER BY (e ->> 'chunkId')::BIGINT)
    FROM jsonb_array_elements(:'s_a1'::JSONB -> 'chunks') e) @> ARRAY[:k_ok]::BIGINT[]
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'s_a1'::JSONB -> 'chunks') e
    WHERE (e ->> 'chunkId')::BIGINT IN (:k_noauto, :k_internal))
  AND (pg_temp.p4_row(:'d_a1')).offered_chunk_ids @> ARRAY[:k_ok]::BIGINT[]
  AND pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_search_v1(%L, %L, %L, %L, 8)', :'d_a1', 'p4-other',
    '[]', '["Малайзия"]')) ->> 'error' LIKE '42501:ai_autosend_not_leased%',
  'rule 4 (search): only client chunks allowed for the autoresponder; offered ids grow; another worker 42501');
SELECT pg_temp.p4_commit(:'d_a1', 'answer', 'ru', 'Обучение в Малайзии стоит 1 500 $ за семестр. Какой уровень обучения вас интересует?',
  ARRAY[:k_ok]::BIGINT[], NULL, '{"country":"Малайзия"}') AS c_a1 \gset
SELECT pg_temp.p4_assert(:'c_a1'::JSONB ->> 'status' = 'shadow' AND (:'c_a1'::JSONB ->> 'disclosed')::BOOLEAN
  AND (pg_temp.p4_row(:'d_a1')).text = 'Пишет автоматический помощник EVO — менеджеры сейчас не на связи.' || E'\n'
    || 'Обучение в Малайзии стоит 1 500 $ за семестр. Какой уровень обучения вас интересует?'
  AND (pg_temp.p4_row(:'d_a1')).text_sha256 = encode(sha256(convert_to((pg_temp.p4_row(:'d_a1')).text, 'UTF8')), 'hex')
  AND (pg_temp.p4_row(:'d_a1')).delay_s BETWEEN 30 AND 90
  AND (pg_temp.p4_row(:'d_a1')).manual_send_authorization_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM platform.manual_send_authorizations WHERE conversation_id = :'c_a')
  AND NOT EXISTS (SELECT 1 FROM pgmq.q_ai_agent_work_v1 q WHERE q.message ->> 'ref_id' = :'d_a1' AND q.vt > clock_timestamp()),
  'rule 11 (commit): shadow journals the text with the disclosure line and its SHA-256, sends and schedules nothing');
-- The final phrase, then silence (handed off) for the rest of the interval.
SELECT pg_temp.p4_in(30, 'P4 клиент A: бакалавриат, хочу оплатить', 30) AS a2 \gset
SELECT pg_temp.p4_decide(:'c_a', :'a2') AS d_a2 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_a2', 'final_phrase', 'ru', 'Позвоним завтра.', NULL) ->> 'reasonCode' = 'phrase_mismatch',
  'a final phrase must be the computed one');
SELECT pg_temp.p4_in(30, 'P4 клиент A: когда позвоните?', 25) AS a3 \gset
SELECT pg_temp.p4_decide(:'c_a', :'a3') AS d_a3 \gset
SELECT pg_temp.p4_commit(:'d_a3', 'final_phrase', 'ru',
  platform_private.ai_autosend_final_phrase(platform_private.ai_autosend_settings_row(pg_temp.p4_id(1)), 'ru', clock_timestamp()) ->> 'text',
  NULL, NULL, '{"level":"бакалавриат","call_time":"после обеда"}') AS c_a3 \gset
SELECT pg_temp.p4_assert(:'c_a3'::JSONB ->> 'status' = 'shadow' AND NOT (:'c_a3'::JSONB ->> 'disclosed')::BOOLEAN
  AND (pg_temp.p4_row(:'d_a3')).call_date IS NOT NULL AND (pg_temp.p4_row(:'d_a3')).kind = 'final_phrase',
  'the final phrase (no second disclosure line) records the call date');
SELECT pg_temp.p4_in(30, 'P4 клиент A: ещё вопрос', 20) AS a4 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_due(:'c_a', :'a4') ->> 'reasonCode' = 'handed_off'
  AND (pg_temp.p4_row((pg_temp.p4_due(:'c_a', :'a4') ->> 'decisionId')::UUID)).reason_ru
    = 'Финальная фраза уже сказана в этом интервале',
  'rule 3: after the final phrase the chat is silent for the interval (handed_off, journalled in Russian)');

-- Rule 1: a curator chat, a chat without a direct binding, an outbound source.
SELECT pg_temp.p4_in(31, 'P4 клиент куратора', 30) AS cur1 \gset
SELECT pg_temp.p4_conv(31) AS c_cur \gset
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.p4_id(421), pg_temp.p4_id(1), 'student_case', pg_temp.p4_id(501), 1);
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage)
VALUES (pg_temp.p4_id(501), pg_temp.p4_id(1), pg_temp.p4_id(301), pg_temp.p4_id(302),
  'synthetic:ai277:1', 'P4 Student 501', 'MY', 'Bachelor', 'contract_confirmed', 'active', clock_timestamp(),
  pg_temp.p4_id(421), 1, 'new');
UPDATE platform.communication_conversations SET student_case_id = pg_temp.p4_id(501), queue = 'curator',
  current_curator_membership_id = pg_temp.p4_id(302), current_scope_id = pg_temp.p4_id(421), current_scope_version = 1,
  sales_authority_source = 'provider_linked', amocrm_account_id = 277, amocrm_lead_id = 277, amocrm_contact_id = 277
  WHERE id = :'c_cur';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p4_in(32, 'P4 клиент без привязки', 30) AS nb1 \gset
SELECT pg_temp.p4_conv(32) AS c_nb \gset
SET LOCAL session_replication_role = replica;
DELETE FROM platform_private.waha_direct_chat_bindings WHERE conversation_id = :'c_nb';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p4_assert(pg_temp.p4_due(:'c_cur', :'cur1') = jsonb_build_object('conversationId', :'c_cur',
    'messageId', :'cur1', 'status', 'refused', 'reasonCode', 'not_sales')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_log WHERE conversation_id = :'c_cur')
  AND pg_temp.p4_due(:'c_nb', :'nb1') ->> 'reasonCode' = 'not_direct',
  'rule 1: a curator chat is refused without a row; a chat without a direct binding is skipped');

-- Rule 2: not the latest, aged.
SELECT pg_temp.p4_in(33, 'P4 клиент N: первое', 50) AS n1 \gset
SELECT pg_temp.p4_in(33, 'P4 клиент N: второе', 45) AS n2 \gset
SELECT pg_temp.p4_conv(33) AS c_n \gset
SELECT pg_temp.p4_in(34, 'P4 клиент O: давнее', 360) AS o1 \gset
SELECT pg_temp.p4_conv(34) AS c_o \gset
SELECT pg_temp.p4_assert(pg_temp.p4_due(:'c_n', :'n1') ->> 'reasonCode' = 'not_latest'
  AND pg_temp.p4_due(:'c_o', :'o1') ->> 'reasonCode' = 'too_old',
  'rule 2: only the newest client message, at most 5 minutes old');

-- Rule 3: staff after the client, an AI ticket, a queued manual send, exclusion, media only.
SELECT pg_temp.p4_in(35, 'P4 клиент S', 60) AS s1 \gset
SELECT pg_temp.p4_out(35, 'P4 ответ с телефона', 50);
SELECT pg_temp.p4_conv(35) AS c_s \gset
SELECT m.id AS s_out FROM platform.communication_messages m WHERE m.conversation_id = :'c_s' AND m.direction = 'outbound' \gset
SELECT pg_temp.p4_in(36, 'P4 клиент T', 40) AS t1 \gset
SELECT pg_temp.p4_conv(36) AS c_t \gset
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_ticket_v1(%L, %L, %L)', pg_temp.p4_id(1), 'answer', :'c_t')) AS tkt \gset
SELECT pg_temp.p4_in(37, 'P4 клиент E', 40) AS e1 \gset
SELECT pg_temp.p4_conv(37) AS c_e \gset
SELECT pg_temp.p4_media(38, 40) AS md1 \gset
SELECT pg_temp.p4_conv(38) AS c_md \gset
SELECT pg_temp.p4_assert((pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_exclusion_v1(%L, %L, TRUE, %L)',
    pg_temp.p4_id(1), :'c_e', pg_temp.p4_id(3020))) ->> 'excluded')::BOOLEAN
  AND pg_temp.p4_staff(3, format('SELECT platform.ai_agent_autosend_exclusion_v1(%L, %L, FALSE, %L)',
    pg_temp.p4_id(1), :'c_e', pg_temp.p4_id(3021))) ->> 'error' LIKE '42501:ai_conversation_unavailable%',
  'the per-chat switch: a member who reads the chat excludes it; a member who cannot read it 42501');
SELECT pg_temp.p4_assert(pg_temp.p4_due(:'c_s', :'s1') ->> 'reasonCode' = 'staff_active'
  AND :'tkt'::JSONB ? 'ticket' AND pg_temp.p4_due(:'c_t', :'t1') ->> 'reasonCode' = 'staff_active'
  AND pg_temp.p4_due(:'c_e', :'e1') ->> 'reasonCode' = 'excluded'
  AND pg_temp.p4_due(:'c_md', :'md1') ->> 'reasonCode' = 'media_only',
  'rule 3: a phone reply after the client, an AI-window ticket in the last 15 minutes, an excluded chat, media only');

-- Rule 3 limits on seeded rows: 4 in the chat this hour, 8 this night, 30 on the number this hour.
CREATE FUNCTION pg_temp.p4_seed(p_conv UUID, p_msg UUID, p_status TEXT, p_mode TEXT, p_kind TEXT, p_text TEXT,
  p_committed TIMESTAMPTZ, p_interval_start TIMESTAMPTZ, p_interval_end TIMESTAMPTZ, p_call DATE DEFAULT NULL,
  p_cited BIGINT[] DEFAULT '{}') RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO platform_private.ai_autosend_log(id, organization_id, conversation_id, client_message_id, source_at,
    interval_start, interval_end, status, mode, kind, language, body, text, text_sha256, offered_chunk_ids,
    cited_chunk_ids, call_date, send_at, delay_s, committed_at, manual_send_authorization_id, work_item_id,
    authorized_at, reason_code, reason_ru)
  SELECT v_id, m.organization_id, p_conv, p_msg, m.created_at, p_interval_start, p_interval_end, p_status, p_mode,
    p_kind, 'ru', p_text, p_text, encode(sha256(convert_to(p_text, 'UTF8')), 'hex'), p_cited, p_cited,
    CASE WHEN p_kind = 'final_phrase' THEN COALESCE(p_call, current_date) END,
    p_committed + INTERVAL '30 seconds', 30, p_committed,
    CASE WHEN p_status IN ('authorized', 'sent', 'failed', 'unknown') THEN gen_random_uuid() END,
    CASE WHEN p_status IN ('authorized', 'sent', 'failed', 'unknown') THEN gen_random_uuid() END,
    CASE WHEN p_status IN ('authorized', 'sent', 'failed', 'unknown') THEN p_committed END,
    CASE WHEN p_status IN ('skipped', 'cancelled') THEN 'paused' END,
    CASE WHEN p_status IN ('skipped', 'cancelled') THEN 'Автоответчик на паузе' END
  FROM platform.communication_messages m WHERE m.id = p_msg;
  RETURN v_id;
END
$$;
SELECT pg_temp.p4_seed(:'c_h', (SELECT id FROM p4_m WHERE label = 'h' || g), 'shadow', 'shadow', 'answer',
  'P4 посеянный ответ', clock_timestamp() - INTERVAL '10 minutes', :'i_start', :'i_end') FROM generate_series(1, 4) g;
SELECT pg_temp.p4_seed(:'c_g', (SELECT id FROM p4_m WHERE label = 'g' || g), 'shadow', 'shadow', 'answer',
  'P4 посеянный ответ', clock_timestamp() - INTERVAL '2 hours', :'i_start', :'i_end') FROM generate_series(1, 8) g;
SELECT pg_temp.p4_in(23, 'P4 клиент H: пятое', 30) AS h5 \gset
SELECT pg_temp.p4_in(24, 'P4 клиент G: девятое', 30) AS g9 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_due(:'c_h', :'h5') ->> 'reasonCode' = 'limit_chat_hour'
  AND pg_temp.p4_due(:'c_g', :'g9') ->> 'reasonCode' = 'limit_chat_night',
  'rule 3: 4 answers in the chat this hour, 8 in the chat this night');
SELECT 30 - count(*) AS n_seed FROM platform_private.ai_autosend_log WHERE organization_id = pg_temp.p4_id(1)
  AND status IN ('scheduled', 'authorized', 'sent', 'unknown', 'shadow') AND committed_at > clock_timestamp() - INTERVAL '1 hour' \gset
CREATE TEMP TABLE p4_number_seed AS SELECT pg_temp.p4_seed(:'c_x', (SELECT id FROM p4_m WHERE label = 'x' || g), 'shadow',
  'shadow', 'answer', 'P4 посеянный ответ', clock_timestamp() - INTERVAL '20 minutes', :'i_start', :'i_end') AS id
  FROM generate_series(1, :n_seed) g;
SELECT pg_temp.p4_in(39, 'P4 клиент R', 30) AS r1 \gset
SELECT pg_temp.p4_conv(39) AS c_r \gset
SELECT pg_temp.p4_assert(pg_temp.p4_due(:'c_r', :'r1') ->> 'reasonCode' = 'limit_number_hour'
  AND (SELECT count(*) FROM platform_private.ai_autosend_log WHERE organization_id = pg_temp.p4_id(1)
    AND status IN ('scheduled', 'authorized', 'sent', 'unknown', 'shadow') AND committed_at > clock_timestamp() - INTERVAL '1 hour') = 30,
  'rule 3: 30 answers on the number this hour');
DELETE FROM platform_private.ai_autosend_log WHERE id IN (SELECT id FROM p4_number_seed);
-- Limits can be lowered, never raised.
SELECT pg_temp.p4_assert(pg_temp.p4_save('{"limitChatHour": 5}', 3030) ->> 'error' LIKE '22023:%'
  AND pg_temp.p4_save('{"delayMinSeconds": 20}', 3031) ->> 'error' LIKE '22023:%'
  AND pg_temp.p4_save('{"limitNumberHour": 31}', 3032) ->> 'error' LIKE '22023:%'
  AND pg_temp.p4_save('{"unknown": 1}', 3033) ->> 'error' LIKE '22023:%'
  AND pg_temp.p4_save(jsonb_build_object('phrases', jsonb_set(
    (platform_private.ai_autosend_settings_row(pg_temp.p4_id(1))).phrases, '{ru,day,text}', '"Позвоним в 10:00."')), 3034)
    ->> 'error' LIKE '22023:%'
  AND pg_temp.p4_save(jsonb_build_object('phrases', jsonb_set(
    (platform_private.ai_autosend_settings_row(pg_temp.p4_id(1))).phrases, '{ru,day,text}', '"Позвоним скоро."')), 3035)
    ->> 'error' LIKE '22023:%'
  AND pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_save_v1(%L, %s, %L, %L)', pg_temp.p4_id(1),
    pg_temp.p4_version() - 1, '{"limitChatHour": 3}', pg_temp.p4_id(3036))) ->> 'error' LIKE 'PT409:%'
  AND (pg_temp.p4_save('{"limitChatHour": 3, "delayMaxSeconds": 60}', 3037) -> 'settings' ->> 'limitChatHour') = '3'
  AND (pg_temp.p4_save('{"limitChatHour": 4, "delayMaxSeconds": 90}', 3038) -> 'settings' ->> 'limitChatHour') = '4',
  'settings: limits and delays only lower, phrases without digits and with one {day}, PT409 on a stale version');
SELECT pg_temp.p4_assert(EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.request_id = pg_temp.p4_id(3037)
    AND e.action = 'ai.agent.autosend.save' AND e.before_state -> 'settings' ->> 'limitChatHour' = '4'
    AND e.after_state -> 'settings' ->> 'limitChatHour' = '3'),
  'settings changes are audited before/after');

-- Rules 4, 5, 6, 7 at commit (chat C, one decision each).
SELECT pg_temp.p4_in(40, 'P4 клиент C: сколько стоит?', 50) AS k1 \gset
SELECT pg_temp.p4_conv(40) AS c_c \gset
SELECT pg_temp.p4_decide(:'c_c', :'k1') AS d_k1 \gset
SELECT pg_temp.p4_search(:'d_k1', 'Малайзия стоимость сроки общежитие') AS s_k1 \gset
SELECT pg_temp.p4_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(:'s_k1'::JSONB -> 'review') r
    WHERE (r ->> 'documentId')::UUID = pg_temp.p4_id(804) AND r ->> 'status' = 'open'),
  'search returns the open «Лист сверки» items of the pages it found');
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k1', 'answer', 'ru', 'Стоимость 900 $ за семестр.', ARRAY[:k_internal]::BIGINT[])
    ->> 'reasonCode' = 'source_not_allowed',
  'rule 4 (commit): an internal chunk is not a source');
SELECT pg_temp.p4_in(40, 'P4 клиент C: а точнее?', 45) AS k2 \gset
SELECT pg_temp.p4_decide(:'c_c', :'k2') AS d_k2 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k2', 'answer', 'ru', 'Стоимость 1700 $ за семестр.', ARRAY[:k_noauto]::BIGINT[])
    ->> 'reasonCode' = 'source_not_allowed'
  AND (pg_temp.p4_row(:'d_k2')).cited_chunk_ids = '{}',
  'rule 4 (commit): a client chunk not allowed for the autoresponder is not a source');
SELECT pg_temp.p4_in(40, 'P4 клиент C: сроки?', 40) AS k3 \gset
SELECT pg_temp.p4_decide(:'c_c', :'k3') AS d_k3 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k3', 'answer', 'ru', 'Стоимость 1500 $ за семестр.', ARRAY[:k_ok]::BIGINT[])
    ->> 'reasonCode' = 'citation_not_offered',
  'citations must come from the chunks search offered to this decision');
SELECT pg_temp.p4_in(40, 'P4 клиент C: сроки приёма?', 35) AS k4 \gset
SELECT pg_temp.p4_decide(:'c_c', :'k4') AS d_k4 \gset
SELECT pg_temp.p4_search(:'d_k4', 'Малайзия сроки приём') AS s_k4 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k4', 'answer', 'ru', 'Документы принимают до 15 мая.', ARRAY[:k_review]::BIGINT[])
    ->> 'reasonCode' = 'open_review',
  'rule 6 (commit): an open «Лист сверки» item on the cited page');
SELECT pg_temp.p4_in(40, 'P4 клиент C: цена?', 30) AS k5 \gset
SELECT pg_temp.p4_decide(:'c_c', :'k5') AS d_k5 \gset
SELECT pg_temp.p4_search(:'d_k5', 'Малайзия стоимость') AS s_k5 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k5', 'answer', 'ru', 'Стоимость 3000 $ за семестр.', ARRAY[:k_ok]::BIGINT[])
    ->> 'reasonCode' = 'number_unsupported',
  'rule 5 (commit): a number that is not in the cited chunk');
SELECT pg_temp.p4_in(40, 'P4 клиент C: виза?', 25) AS k6 \gset
SELECT pg_temp.p4_decide(:'c_c', :'k6') AS d_k6 \gset
SELECT pg_temp.p4_search(:'d_k6', 'Малайзия стоимость виза') AS s_k6 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k6', 'answer', 'ru', 'Сбор за визу 15% от суммы.', ARRAY[:k_ok]::BIGINT[])
    ->> 'reasonCode' = 'number_unsupported',
  'rule 5 (commit): a percent must match a percent in the source');
SELECT pg_temp.p4_in(40, 'P4 клиент C: скидки есть?', 20) AS k7 \gset
SELECT pg_temp.p4_decide(:'c_c', :'k7') AS d_k7 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k7', 'answer', 'ru', 'Да, у нас есть скидка для отличников.', NULL)
    ->> 'reasonCode' = 'stop_word',
  'rule 7 (commit): a stop word');
SELECT pg_temp.p4_in(40, 'P4 клиент C: сайт?', 15) AS k8 \gset
SELECT pg_temp.p4_decide(:'c_c', :'k8') AS d_k8 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k8', 'answer', 'ru', 'Подробнее на evo.kg', NULL) ->> 'reasonCode' = 'link'
  AND pg_temp.p4_commit(:'d_k8', 'answer', 'ru', 'ещё раз', NULL) ->> 'replayed' = 'true',
  'rule 13 (commit): a link; a second commit only reads the decision back');
-- Review probes at commit: any label.tld and a shortener, payment words, a
-- fullwidth number without a source.
SELECT pg_temp.p4_in(40, 'P4 клиент C: где почитать?', 12) AS k9 \gset
SELECT pg_temp.p4_decide(:'c_c', :'k9') AS d_k9 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k9', 'answer', 'ru', 'Подробнее на evoadmissions.kz или bit.ly/evo', NULL)
    ->> 'reasonCode' = 'link',
  'rule 13 (commit): a .kz domain and a link shortener');
SELECT pg_temp.p4_in(40, 'P4 клиент C: как заплатить?', 10) AS k10 \gset
SELECT pg_temp.p4_decide(:'c_c', :'k10') AS d_k10 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k10', 'answer', 'ru',
    'Можно заплатить наличными в офисе или перечислить на Элкарт.', NULL) ->> 'reasonCode' = 'stop_word',
  'rule 7 (commit): payment words (заплатить, наличными, перечислить, Элкарт)');
SELECT pg_temp.p4_in(40, 'P4 клиент C: сколько за семестр?', 8) AS k11 \gset
SELECT pg_temp.p4_decide(:'c_c', :'k11') AS d_k11 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_k11', 'answer', 'ru', 'Стоимость １５００ долларов за семестр.', NULL)
    ->> 'reasonCode' = 'number_unsupported',
  'rule 5 (commit): a fullwidth number needs a source too');
-- Numbers that are in the source pass, in either spelling.
SELECT pg_temp.p4_in(41, 'P4 клиент F: стоимость?', 30) AS f1 \gset
SELECT pg_temp.p4_conv(41) AS c_f \gset
SELECT pg_temp.p4_decide(:'c_f', :'f1') AS d_f1 \gset
SELECT pg_temp.p4_search(:'d_f1', 'стоимость обучения Малайзия') AS s_f1 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_f1', 'answer', 'ru',
    'Обучение стоит 1500 $ за семестр, сбор за визу 2,5 %.', ARRAY[:k_ok]::BIGINT[]) ->> 'status' = 'shadow',
  'rule 5: «1500» and «2,5 %» from the source pass');

-- Rules 1–3 re-checked at commit: the chat went to a curator, an outbound
-- source, an aged message, a schedule that no longer covers now, a manual send
-- after the client.
CREATE FUNCTION pg_temp.p4_consider(p_conv UUID, p_msg UUID) RETURNS UUID LANGUAGE SQL AS $$
  INSERT INTO platform_private.ai_autosend_log(organization_id, conversation_id, client_message_id, source_at,
    interval_start, interval_end, mode, lease_owner, lease_expires_at)
  SELECT pg_temp.p4_id(1), p_conv, p_msg, m.created_at, (w ->> 'intervalStart')::TIMESTAMPTZ,
    (w ->> 'intervalEnd')::TIMESTAMPTZ, 'shadow', 'p4-worker', clock_timestamp() + INTERVAL '2 minutes'
  FROM platform.communication_messages m,
    platform_private.ai_autosend_window(platform_private.ai_autosend_settings_row(pg_temp.p4_id(1)), clock_timestamp()) w
  WHERE m.id = p_msg
  RETURNING id
$$;
SELECT pg_temp.p4_in(46, 'P4 клиент: передадим куратору', 30) AS cu1 \gset
SELECT pg_temp.p4_conv(46) AS c_cu \gset
SELECT pg_temp.p4_decide(:'c_cu', :'cu1') AS d_cu1 \gset
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.p4_id(422), pg_temp.p4_id(1), 'student_case', pg_temp.p4_id(502), 1);
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage)
VALUES (pg_temp.p4_id(502), pg_temp.p4_id(1), pg_temp.p4_id(301), pg_temp.p4_id(302),
  'synthetic:ai277:2', 'P4 Student 502', 'MY', 'Bachelor', 'contract_confirmed', 'active', clock_timestamp(),
  pg_temp.p4_id(422), 1, 'new');
UPDATE platform.communication_conversations SET student_case_id = pg_temp.p4_id(502), queue = 'curator',
  current_curator_membership_id = pg_temp.p4_id(302), current_scope_id = pg_temp.p4_id(422), current_scope_version = 1,
  sales_authority_source = 'provider_linked', amocrm_account_id = 278, amocrm_lead_id = 278, amocrm_contact_id = 278
  WHERE id = :'c_cu';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p4_in(47, 'P4 клиент: давнее для commit', 330) AS ag1 \gset
SELECT pg_temp.p4_in(48, 'P4 клиент: ответят вручную', 30) AS mn1 \gset
SELECT pg_temp.p4_in(49, 'P4 клиент: вне расписания', 30) AS sc1 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(48), :'mn1') AS d_mn1 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(49), :'sc1') AS d_sc1 \gset
SELECT pg_temp.p4_staff(2, format($q$SELECT platform.request_manual_whatsapp_send_with_authorization(%L, %L, %L, NULL,
  'Отвечаю сам', 'staff_chat_reply', %L, %L)$q$, pg_temp.p4_id(1), pg_temp.p4_conv(48), :'mn1',
  encode(sha256(convert_to(array_to_json(ARRAY['evo-platform-work-v2', 'manual_whatsapp_send', pg_temp.p4_id(1)::TEXT,
    pg_temp.p4_conv(48)::TEXT, :'mn1'::TEXT, 'staff-authored', pg_temp.p4_wid(7101)::TEXT])::TEXT, 'UTF8')), 'hex'),
  pg_temp.p4_wid(7101))) ->> 'work_item_id' AS mn_work \gset
SELECT pg_temp.p4_assert(:'mn_work' IS NOT NULL
  AND pg_temp.p4_commit(:'d_cu1', 'answer', 'ru', 'Какая страна вас интересует?', NULL) ->> 'reasonCode' = 'not_sales'
  AND pg_temp.p4_commit(pg_temp.p4_consider(:'c_s', :'s_out'), 'answer', 'ru', 'Какая страна вас интересует?', NULL)
    ->> 'reasonCode' = 'not_inbound'
  AND pg_temp.p4_commit(pg_temp.p4_consider(pg_temp.p4_conv(47), :'ag1'), 'answer', 'ru', 'Какая страна вас интересует?', NULL)
    ->> 'reasonCode' = 'too_old'
  AND pg_temp.p4_commit(:'d_mn1', 'answer', 'ru', 'Какая страна вас интересует?', NULL) ->> 'reasonCode' = 'staff_active',
  'rules 1–3 (commit): a chat handed to a curator, an outbound source, an aged message, a manual send after the client');
SELECT pg_temp.p4_assert(pg_temp.p4_save(jsonb_build_object('schedule',
    pg_temp.p4_schedule(INTERVAL '2 hours', INTERVAL '3 hours')), 3039) ->> 'status' = 'saved'
  AND pg_temp.p4_commit(:'d_sc1', 'answer', 'ru', 'Какая страна вас интересует?', NULL) ->> 'reasonCode' = 'outside_interval'
  AND pg_temp.p4_save(jsonb_build_object('schedule', :'sched_cover'::JSONB), 3041) ->> 'status' = 'saved',
  'rule 2 (commit): the schedule no longer covers now');
-- Rule 2 (the newest client message), a closed chat and a history message at
-- due and at commit; rule 4 (ready, not superseded) at commit.
SELECT pg_temp.p4_in(70, 'P4 клиент: первое', 30) AS nl1 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(70), :'nl1') AS d_nl1 \gset
SELECT pg_temp.p4_in(70, 'P4 клиент: второе', 25) AS nl2 \gset
SELECT pg_temp.p4_in(71, 'P4 клиент: чат закроют', 30) AS cl1 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(71), :'cl1') AS d_cl1 \gset
SELECT pg_temp.p4_in(72, 'P4 клиент: станет историей', 30) AS hs1 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(72), :'hs1') AS d_hs1 \gset
SELECT pg_temp.p4_in(73, 'P4 клиент: закрытый чат', 30) AS cl2 \gset
SELECT pg_temp.p4_in(74, 'P4 клиент: из истории', 30) AS hs2 \gset
SET LOCAL session_replication_role = replica;
UPDATE platform.communication_conversations SET status = 'closed' WHERE id IN (pg_temp.p4_conv(71), pg_temp.p4_conv(73));
UPDATE platform.communication_messages SET message_identity_source = 'private_waha_history_binding'
  WHERE id IN (:'hs1', :'hs2');
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p4_assert(
  pg_temp.p4_commit(:'d_nl1', 'answer', 'ru', 'Какая страна вас интересует?', NULL) ->> 'reasonCode' = 'not_latest'
  AND pg_temp.p4_commit(:'d_cl1', 'answer', 'ru', 'Какая страна вас интересует?', NULL) ->> 'reasonCode' = 'conversation_closed'
  AND pg_temp.p4_commit(:'d_hs1', 'answer', 'ru', 'Какая страна вас интересует?', NULL) ->> 'reasonCode' = 'history_message'
  AND pg_temp.p4_due(pg_temp.p4_conv(73), :'cl2') ->> 'reasonCode' = 'conversation_closed'
  AND pg_temp.p4_due(pg_temp.p4_conv(74), :'hs2') ->> 'reasonCode' = 'history_message',
  'rules 1–2 at due and commit: a newer client message, a closed chat, a message from the history import');
SELECT pg_temp.p4_in(75, 'P4 клиент: цена?', 30) AS rd1 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(75), :'rd1') AS d_rd1 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_rd1', 'answer', 'ru', 'Стоимость 1600 $ за семестр.',
    ARRAY[:k_notready]::BIGINT[]) ->> 'reasonCode' = 'source_not_allowed',
  'rule 4 (commit): a client document allowed for the autoresponder but not ready');
SELECT pg_temp.p4_in(75, 'P4 клиент: а раньше?', 25) AS rd2 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(75), :'rd2') AS d_rd2 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_rd2', 'answer', 'ru', 'Стоимость 1400 $ за семестр.',
    ARRAY[:k_superseded]::BIGINT[]) ->> 'reasonCode' = 'source_not_allowed',
  'rule 4 (commit): a ready, allowed client document that was superseded');

-- Gemini errors: three skips in a row pause; only a human resumes.
SELECT pg_temp.p4_in(42, 'P4 клиент G1', 30) AS ge1 \gset
SELECT pg_temp.p4_in(43, 'P4 клиент G2', 30) AS ge2 \gset
SELECT pg_temp.p4_in(44, 'P4 клиент G3', 30) AS ge3 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(42), :'ge1') AS d_ge1 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(43), :'ge2') AS d_ge2 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(44), :'ge3') AS d_ge3 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_ge1', 'skip', NULL, NULL, NULL, 'gemini_error') ->> 'status' = 'skipped'
  AND NOT (pg_temp.p4_commit(:'d_ge2', 'skip', NULL, NULL, NULL, 'gemini_error') ->> 'paused')::BOOLEAN
  AND (pg_temp.p4_commit(:'d_ge3', 'skip', NULL, NULL, NULL, 'gemini_error') ->> 'paused')::BOOLEAN
  AND (platform_private.ai_autosend_settings_row(pg_temp.p4_id(1))).pause_code = 'gemini_error'
  AND (platform_private.ai_autosend_settings_row(pg_temp.p4_id(1))).pause_by_kind = 'agent'
  AND pg_temp.p4_agent(pg_temp.p4_items(:'c_a', :'a4')) ->> 'error' LIKE '42501:ai_autosend_disabled%'
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_ai_agent' AND p.proname ~ 'resume|unpause'),
  'three Gemini errors in a row pause the autoresponder (agent), due refuses while paused, the agent has no resume');
SELECT pg_temp.p4_assert(pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_pause_v1(%L, %L, %s, %L)',
    pg_temp.p4_id(1), 'resume', pg_temp.p4_version(), pg_temp.p4_id(3040))) ->> 'pauseCode' IS NULL
  AND (platform_private.ai_autosend_settings_row(pg_temp.p4_id(1))).gemini_error_streak = 0,
  'a human resumes; the streaks are cleared');

-- Off mid-decision: search refuses, commit journals the skip; context never serves text.
SELECT pg_temp.p4_in(45, 'P4 клиент W', 30) AS w1 \gset
SELECT pg_temp.p4_decide(pg_temp.p4_conv(45), :'w1') AS d_w1 \gset
UPDATE platform_private.ai_autosend_settings SET enabled = FALSE WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_assert(pg_temp.p4_search(:'d_w1', 'Малайзия') ->> 'error' LIKE '42501:ai_autosend_disabled%'
  AND pg_temp.p4_commit(:'d_w1', 'answer', 'ru', 'Какая страна вас интересует?', NULL) ->> 'reasonCode' = 'disabled',
  'off mid-decision: search 42501, commit journals disabled');
SELECT pg_temp.p4_in(45, 'P4 клиент W: снова', 25) AS w2 \gset
INSERT INTO platform_private.ai_autosend_log(organization_id, conversation_id, client_message_id, source_at, interval_start,
  interval_end, mode) SELECT pg_temp.p4_id(1), pg_temp.p4_conv(45), :'w2', clock_timestamp(), :'i_start', :'i_end', 'shadow'
  RETURNING id AS d_w2 \gset
SELECT pg_temp.p4_ctx(:'d_w2') AS ctx_w2 \gset
SELECT pg_temp.p4_assert(:'ctx_w2'::JSONB ->> 'action' = 'skip' AND :'ctx_w2'::JSONB ->> 'reasonCode' = 'disabled'
  AND NOT :'ctx_w2'::JSONB ? 'messages',
  'off: context journals the skip and serves no message');
UPDATE platform_private.ai_autosend_settings SET enabled = TRUE WHERE organization_id = pg_temp.p4_id(1);

-- ---------------------------------------------------------------------------
-- 6. The authorize column: the live-test chat L, end to end.
-- ---------------------------------------------------------------------------
-- Chat L answers in shadow first (the first reply carries the disclosure line).
SELECT pg_temp.p4_in(50, 'P4 клиент L: здравствуйте', 45) AS l0 \gset
SELECT pg_temp.p4_conv(50) AS c_l \gset
SELECT pg_temp.p4_decide(:'c_l', :'l0') AS d_l0 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_l0', 'answer', 'ru', 'Какая страна вас интересует?', NULL) ->> 'status' = 'shadow'
  AND (pg_temp.p4_row(:'d_l0')).text LIKE 'Пишет автоматический помощник EVO%',
  'chat L: a shadow answer with the disclosure line before the live test');
-- The live-test list needs three shadow nights first (§11: shadow, then the
-- live test, then live). Three synthetic summaries of earlier nights stand
-- in for them until section 7 builds real ones.
SELECT pg_temp.p4_assert(pg_temp.p4_save(jsonb_build_object('liveTestConversationIds', jsonb_build_array(:'c_l')), 3100)
    ->> 'error' LIKE 'PT412:ai_autosend_shadow_nights_required%',
  'the live-test list is refused before three shadow nights');
INSERT INTO platform_private.ai_autosend_summaries(organization_id, interval_start, interval_end, shadow_night, counts, items,
  status)
SELECT pg_temp.p4_id(1), clock_timestamp() - (20 + g) * INTERVAL '1 day',
  clock_timestamp() - (20 + g) * INTERVAL '1 day' + INTERVAL '13 hours', TRUE, '{"considered": 1, "shadow": 1}', '[]', 'ready'
FROM generate_series(1, 3) g;
SELECT pg_temp.p4_in(50, 'P4 клиент L: сколько стоит Малайзия?', 40) AS l1 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_save(jsonb_build_object('liveTestConversationIds', jsonb_build_array(:'c_l')), 3050)
    ->> 'status' = 'saved'
  AND pg_temp.p4_save(jsonb_build_object('liveTestConversationIds', jsonb_build_array(:'c_cur')), 3051) ->> 'error'
    LIKE '42501:ai_conversation_unavailable%'
  AND pg_temp.p4_save(jsonb_build_object('liveTestConversationIds', jsonb_build_array(:'c_l')), 3053, 4) ->> 'error'
    LIKE '42501:ai_autosend_sender_required%',
  'the live-test list takes sales chats the member reads (not the curator chat), set only by a member who may send');
SELECT pg_temp.p4_decide(:'c_l', :'l1') AS d_l1 \gset
SELECT pg_temp.p4_search(:'d_l1', 'стоимость обучения Малайзия') AS s_l1 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_l1', 'answer', 'ru', 'Обучение стоит 1500 $ за семестр.', ARRAY[:k_ok]::BIGINT[])
    ->> 'reasonCode' = 'phrase_unconfirmed'
  AND (pg_temp.p4_row(:'d_l1')).mode = 'live_test',
  'rule 11 (commit): the live-test chat answers for real, but not while the RU disclosure line is unconfirmed');
SELECT pg_temp.p4_assert(pg_temp.p4_save(jsonb_build_object('disclosure', jsonb_set(
    (platform_private.ai_autosend_settings_row(pg_temp.p4_id(1))).disclosure, '{ru,confirmed}', 'true')), 3052) ->> 'status' = 'saved',
  'the owner confirms the RU disclosure line');
SELECT pg_temp.p4_in(50, 'P4 клиент L: а за семестр?', 30) AS l2 \gset
SELECT pg_temp.p4_decide(:'c_l', :'l2') AS d_l2 \gset
SELECT pg_temp.p4_search(:'d_l2', 'стоимость обучения Малайзия') AS s_l2 \gset
SELECT pg_temp.p4_commit(:'d_l2', 'answer', 'ru', 'Обучение стоит 1500 $ за семестр.', ARRAY[:k_ok]::BIGINT[]) AS c_l2 \gset
SELECT pg_temp.p4_assert(:'c_l2'::JSONB ->> 'status' = 'scheduled' AND :'c_l2'::JSONB ->> 'mode' = 'live_test'
  AND (pg_temp.p4_row(:'d_l2')).text LIKE 'Пишет автоматический помощник EVO%Обучение стоит 1500 $ за семестр.'
  AND EXISTS (SELECT 1 FROM pgmq.q_ai_agent_work_v1 q WHERE q.message = jsonb_build_object('v', 1, 'kind', 'autosend',
    'ref_id', :'d_l2') AND q.vt > clock_timestamp() + INTERVAL '25 seconds')
  AND pg_temp.p4_ctx(:'d_l2') ->> 'action' = 'none',
  'live test: scheduled with the disclosure line (the shadow answer before it did not count) and a delayed pointer; context before send_at is none');
CREATE FUNCTION pg_temp.p4_authorize(p_decision UUID, p_status TEXT DEFAULT 'WORKING', p_request INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p4_service(format('SELECT platform.ai_autosend_authorize_v1(%L, %L, %L, %L)', pg_temp.p4_id(1),
    p_decision, p_status, COALESCE(pg_temp.p4_wid(p_request), gen_random_uuid())))
$$;
SELECT pg_temp.p4_assert(pg_temp.p4_authorize(:'d_l2') ->> 'reason' = 'not_due'
  AND (pg_temp.p4_row(:'d_l2')).status = 'scheduled',
  'authorize before send_at: not_due, the decision stays scheduled');
-- The delay passes.
UPDATE platform_private.ai_autosend_log SET send_at = clock_timestamp() - INTERVAL '1 second' WHERE id = :'d_l2';
SELECT pg_temp.p4_assert(pg_temp.p4_staff(2, format('SELECT platform.ai_autosend_authorize_v1(%L, %L, %L, %L)', pg_temp.p4_id(1),
    :'d_l2', 'WORKING', gen_random_uuid())) ->> 'error' LIKE '42501:%'
  AND pg_temp.p4_agent(format('SELECT platform.ai_autosend_authorize_v1(%L, %L, %L, %L)', pg_temp.p4_id(1),
    :'d_l2', 'WORKING', gen_random_uuid())) ->> 'error' LIKE '42501:%'
  AND pg_temp.p4_err(format('SET LOCAL ROLE service_role; SELECT set_config(''request.jwt.claims'', ''{"role":"authenticated"}'', TRUE); SELECT platform.ai_autosend_authorize_v1(%L, %L, %L, %L)',
    pg_temp.p4_id(1), :'d_l2', 'WORKING', gen_random_uuid())) LIKE '42501:%',
  'rule 9: authenticated, the agent and a service_role session without the service JWT get 42501');
RESET ROLE;
SELECT pg_temp.p4_authorize(:'d_l2', 'WORKING', 6001) AS au_l2 \gset
SELECT (:'au_l2'::JSONB ->> 'manual_send_authorization_id') AS az_l2, (:'au_l2'::JSONB ->> 'work_item_id') AS wi_l2 \gset
SELECT pg_temp.p4_assert((:'au_l2'::JSONB ->> 'authorized')::BOOLEAN
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'au_l2'::JSONB - ARRAY['authorized', 'replayed',
    'ai_autosend_decision_id']) k) = (SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY['organization_id',
    'manual_send_authorization_id', 'communication_conversation_id', 'source_message_id', 'ai_draft_id', 'final_text',
    'final_text_sha256', 'authorized_by_membership_id', 'state', 'requested_by_membership_id', 'work_item_id', 'work_state',
    'queue_message_id', 'business_key_sha256', 'waha_readiness', 'waha_readiness_evidence_kind', 'waha_readiness_fresh',
    'waha_readiness_observed_at']) k)
  AND (SELECT a.kind = 'ai_autosend' AND a.ai_autosend_decision_id = :'d_l2'::UUID AND a.ai_draft_id IS NULL
      AND a.final_text = (pg_temp.p4_row(:'d_l2')).text AND a.final_text_sha256 = (pg_temp.p4_row(:'d_l2')).text_sha256
      AND a.authorized_by_membership_id = pg_temp.p4_id(302) AND a.authorized_by_profile_id = pg_temp.p4_id(202)
      AND a.source_message_id = :'l2'::UUID AND a.authorized_access_version IS NOT NULL
    FROM platform.manual_send_authorizations a WHERE a.id = :'az_l2'::UUID)
  AND (SELECT i.kind = 'manual_whatsapp_send' AND i.max_attempts = 1 AND i.state = 'queued'
    FROM platform_private.durable_work_items i WHERE i.id = :'wi_l2'::UUID)
  AND (pg_temp.p4_row(:'d_l2')).status = 'authorized'
  AND EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.request_id = pg_temp.p4_wid(6001)
    AND e.action = 'ai.agent.autosend.authorize' AND e.actor_kind = 'service' AND e.actor_profile_id IS NULL
    AND NOT e.after_state::TEXT LIKE '%Обучение%'),
  'rule 9: the stored text authored as the responsible member, kind ai_autosend, one single-attempt work item, audited without text');
SELECT pg_temp.p4_assert(pg_temp.p4_authorize(:'d_l2') ->> 'work_item_id' = :'wi_l2'
  AND (pg_temp.p4_authorize(:'d_l2') ->> 'replayed')::BOOLEAN
  AND (SELECT count(*) = 1 FROM platform.manual_send_authorizations WHERE ai_autosend_decision_id = :'d_l2'::UUID)
  AND (SELECT count(*) = 1 FROM platform_private.durable_work_items WHERE manual_send_authorization_id = :'az_l2'::UUID),
  'rule 8: a double authorize returns the same work item; one authorization, one work item');
SELECT pg_temp.p4_staff(2, format('SELECT row_to_json(s)::JSONB FROM platform.staff_whatsapp_chat_state(%L, %L, 50) s',
  pg_temp.p4_id(1), :'c_l')) AS st_l \gset
SELECT pg_temp.p4_assert(jsonb_array_length(:'st_l'::JSONB -> 'attempts') = 1
  AND :'st_l'::JSONB -> 'attempts' -> 0 ->> 'kind' = 'ai_autosend'
  AND :'st_l'::JSONB -> 'attempts' -> 0 ->> 'status' = 'queued',
  'the chat state marks the pending autoresponder attempt with kind');
-- The CRM's exact claim and finish (the provider is synthetic).
SELECT pg_temp.p4_service(format('SELECT platform.claim_manual_whatsapp_send_item(%L, %L, 60, %L, %L)', pg_temp.p4_id(1),
  :'wi_l2', 'ai-autosend', pg_temp.p4_wid(6010))) AS cl_l2 \gset
SELECT pg_temp.p4_assert((:'cl_l2'::JSONB ->> 'claimed')::BOOLEAN
  AND :'cl_l2'::JSONB ->> 'final_text' = (pg_temp.p4_row(:'d_l2')).text,
  'the exact claim of the canonical path hands out the stored text');
SELECT pg_temp.p4_assert(pg_temp.p4_authorize(:'d_l2') = jsonb_build_object('authorized', FALSE, 'reason', 'already_claimed',
    'decisionId', :'d_l2', 'status', 'authorized'),
  'an authorize replay of a claimed item: already_claimed (the claimer sends)');
SELECT pg_temp.p4_assert(pg_temp.p4_service(format('SELECT platform.ai_autosend_record_v1(%L, %L, %L, NULL, %L)',
    pg_temp.p4_id(1), :'d_l2', 'sent', gen_random_uuid())) ->> 'error' LIKE '55000:ai_autosend_not_sent%',
  'record: sent needs the provider binding of the finish');
SELECT pg_temp.p4_service(format('SELECT platform.finish_manual_whatsapp_send(%L, %L, %L, %L, %L, NULL, %L, %L, %L)',
  pg_temp.p4_id(1), :'wi_l2', :'cl_l2'::JSONB ->> 'attempt_id', :'az_l2', 'succeeded',
  'true_79967700050@c.us_AI277SENT000000000001', clock_timestamp(), pg_temp.p4_wid(6011))) AS fin_l2 \gset
SELECT pg_temp.p4_service(format('SELECT platform.ai_autosend_record_v1(%L, %L, %L, NULL, %L)',
  pg_temp.p4_id(1), :'d_l2', 'sent', pg_temp.p4_wid(6012))) AS rec_l2 \gset
SELECT pg_temp.p4_assert(:'fin_l2'::JSONB ->> 'state' = 'succeeded' AND :'rec_l2'::JSONB ->> 'status' = 'sent'
  AND (pg_temp.p4_row(:'d_l2')).status = 'sent'
  AND (pg_temp.p4_service(format('SELECT platform.ai_autosend_record_v1(%L, %L, %L, NULL, %L)',
    pg_temp.p4_id(1), :'d_l2', 'sent', gen_random_uuid())) ->> 'replayed')::BOOLEAN,
  'finish and record: the decision is sent; a second record replays');
SELECT pg_temp.p4_assert((pg_temp.p4_authorize(:'d_l2') ->> 'replayed')::BOOLEAN
  AND pg_temp.p4_authorize(:'d_l2') ->> 'decision_status' = 'sent',
  'an authorize replay of a sent decision reads it back (the route stops: finished)');
SELECT pg_temp.p4_staff(2, format('SELECT jsonb_agg(row_to_json(p)::JSONB ORDER BY p.created_at) FROM platform.staff_whatsapp_message_page(%L, %L, 50) p',
  pg_temp.p4_id(1), :'c_l')) AS page_l \gset
SELECT pg_temp.p4_assert((SELECT e ->> 'origin' = 'autoreply' AND (e ->> 'sender_membership_id')::UUID = pg_temp.p4_id(302)
    AND e ->> 'sender_name' = 'P4 Actor 2' AND e ->> 'body_text' = (pg_temp.p4_row(:'d_l2')).text
  FROM jsonb_array_elements(:'page_l'::JSONB) e WHERE e ->> 'direction' = 'outbound')
  AND (SELECT count(*) = 3 FROM jsonb_array_elements(:'page_l'::JSONB) e WHERE e ->> 'origin' = 'client'),
  'transcript: the autoresponder message is «autoreply», sent in the name of the responsible member');

-- The autoresponder's own message is not staff activity: the chat answers again.
SELECT pg_temp.p4_in(50, 'P4 клиент L: спасибо, а общежитие?', 20) AS l3 \gset
SELECT pg_temp.p4_decide(:'c_l', :'l3') AS d_l3 \gset
SELECT pg_temp.p4_search(:'d_l3', 'общежитие стоимость Малайзия') AS s_l3 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_l3', 'answer', 'ru', 'Обучение стоит 1500 $ за семестр.', ARRAY[:k_ok]::BIGINT[])
    ->> 'status' = 'scheduled'
  AND NOT (pg_temp.p4_row(:'d_l3')).text LIKE 'Пишет автоматический помощник%',
  'the autoresponder''s own reply is not staff activity; the disclosure line only on the first reply of the interval');
UPDATE platform_private.ai_autosend_log SET send_at = clock_timestamp() - INTERVAL '1 second' WHERE id = :'d_l3';
-- Rule 4 at authorize: the document loses its autoresponder permission between commit and send.
SELECT pg_temp.p4_assert(pg_temp.p4_staff(2, format('SELECT platform.ai_agent_document_update_v1(%L, %L, %s, %L, %L)',
    pg_temp.p4_id(1), pg_temp.p4_id(801), (SELECT row_version FROM platform_private.ai_documents WHERE id = pg_temp.p4_id(801)),
    '{"autosendAllowed": false}', pg_temp.p4_id(3061))) ->> 'error' IS NULL
  AND pg_temp.p4_authorize(:'d_l3') ->> 'reason' = 'source_not_allowed'
  AND (pg_temp.p4_row(:'d_l3')).status = 'skipped'
  AND NOT EXISTS (SELECT 1 FROM platform.manual_send_authorizations WHERE ai_autosend_decision_id = :'d_l3'::UUID),
  'rule 4 (authorize): a flag flipped between commit and send refuses and journals');
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_document_update_v1(%L, %L, %s, %L, %L)',
  pg_temp.p4_id(1), pg_temp.p4_id(801), (SELECT row_version FROM platform_private.ai_documents WHERE id = pg_temp.p4_id(801)),
  '{"autosendAllowed": true}', pg_temp.p4_id(3062)));
-- Rule 6 at authorize: a «Лист сверки» item opened after commit.
SELECT pg_temp.p4_in(50, 'P4 клиент L: общежитие?', 15) AS l4 \gset
SELECT pg_temp.p4_decide(:'c_l', :'l4') AS d_l4 \gset
SELECT pg_temp.p4_search(:'d_l4', 'общежитие Малайзия месяц') AS s_l4 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_commit(:'d_l4', 'answer', 'ru', 'Общежитие стоит 300 $ в месяц.', ARRAY[:k_clean]::BIGINT[])
    ->> 'status' = 'scheduled', 'a clean source commits');
UPDATE platform_private.ai_autosend_log SET send_at = clock_timestamp() - INTERVAL '1 second' WHERE id = :'d_l4';
INSERT INTO platform_private.ai_review_items(organization_id, document_id, page_no, kind, proposed, status)
VALUES (pg_temp.p4_id(1), pg_temp.p4_id(805), 1, 'number', '300', 'open');
SELECT pg_temp.p4_assert(pg_temp.p4_authorize(:'d_l4') ->> 'reason' = 'open_review',
  'rule 6 (authorize): an item opened after commit refuses');

-- Authorize refusals for the other rules, on seeded «scheduled» rows (live mode for
-- the rule checks; the shadow check toggles it back on).
UPDATE platform_private.ai_autosend_settings SET shadow_mode = FALSE WHERE organization_id = pg_temp.p4_id(1);
CREATE FUNCTION pg_temp.p4_sched(p_conv UUID, p_msg UUID, p_mode TEXT DEFAULT 'live', p_text TEXT DEFAULT 'Какая страна вас интересует?',
  p_interval_start TIMESTAMPTZ DEFAULT NULL) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_start TIMESTAMPTZ; v_end TIMESTAMPTZ;
BEGIN
  SELECT (w ->> 'intervalStart')::TIMESTAMPTZ, (w ->> 'intervalEnd')::TIMESTAMPTZ INTO v_start, v_end
  FROM platform_private.ai_autosend_window(platform_private.ai_autosend_settings_row(pg_temp.p4_id(1)), clock_timestamp()) w;
  RETURN pg_temp.p4_seed(p_conv, p_msg, 'scheduled', p_mode, 'answer', p_text, clock_timestamp() - INTERVAL '40 seconds',
    COALESCE(p_interval_start, v_start), v_end);
END
$$;
SELECT pg_temp.p4_in(51, 'P4 клиент U1', 30) AS u1 \gset
SELECT pg_temp.p4_in(52, 'P4 клиент U2', 30) AS u2 \gset
SELECT pg_temp.p4_in(53, 'P4 клиент U3', 30) AS u3 \gset
SELECT pg_temp.p4_in(54, 'P4 клиент U4', 400) AS u4 \gset
SELECT pg_temp.p4_in(55, 'P4 клиент U5', 30) AS u5 \gset
SELECT pg_temp.p4_in(56, 'P4 клиент U6', 30) AS u6 \gset
SELECT pg_temp.p4_in(23, 'P4 клиент H: шестое', 25) AS h6 \gset
SELECT pg_temp.p4_in(30, 'P4 клиент A: пятое', 15) AS a5 \gset
DELETE FROM platform_private.ai_autosend_log WHERE client_message_id = :'nb1';
SELECT pg_temp.p4_in(35, 'P4 клиент S: снова', 15) AS s2 \gset
SELECT pg_temp.p4_out(35, 'P4 ещё ответ с телефона', 10);
SELECT m.id AS s_out2 FROM platform.communication_messages m WHERE m.conversation_id = :'c_s'
  AND m.direction = 'outbound' AND m.body_text = 'P4 ещё ответ с телефона' \gset
SELECT pg_temp.p4_in(37, 'P4 клиент E: снова', 15) AS e2 \gset
SELECT pg_temp.p4_media(38, 15) AS md2 \gset
SELECT pg_temp.p4_assert(
  pg_temp.p4_authorize(pg_temp.p4_sched(:'c_cur', :'cur1')) ->> 'reason' = 'not_sales'
  AND pg_temp.p4_authorize(pg_temp.p4_sched(:'c_nb', :'nb1')) ->> 'reason' = 'not_direct'
  AND pg_temp.p4_authorize(pg_temp.p4_sched(:'c_s', :'s_out2')) ->> 'reason' = 'not_inbound',
  'rule 1 (authorize): a curator chat, no direct binding, an outbound source');
SELECT pg_temp.p4_assert(
  pg_temp.p4_authorize(pg_temp.p4_sched(pg_temp.p4_conv(54), :'u4')) ->> 'reason' = 'too_old'
  AND pg_temp.p4_authorize(pg_temp.p4_sched(pg_temp.p4_conv(51), :'u1', 'live', 'Какая страна вас интересует?',
    clock_timestamp() - INTERVAL '2 days')) ->> 'reason' = 'outside_interval',
  'rule 2 (authorize): older than 5 minutes plus the delay; another interval');
SELECT pg_temp.p4_assert(
  pg_temp.p4_authorize(pg_temp.p4_sched(:'c_s', :'s2')) ->> 'reason' = 'staff_active'
  AND pg_temp.p4_authorize(pg_temp.p4_sched(:'c_e', :'e2')) ->> 'reason' = 'excluded'
  AND pg_temp.p4_authorize(pg_temp.p4_sched(:'c_md', :'md2')) ->> 'reason' = 'media_only'
  AND pg_temp.p4_authorize(pg_temp.p4_sched(:'c_h', :'h6')) ->> 'reason' = 'limit_chat_hour'
  AND pg_temp.p4_authorize(pg_temp.p4_sched(:'c_a', :'a5')) ->> 'reason' = 'handed_off',
  'rule 3 (authorize): staff after the client, exclusion, media only, the chat-hour limit, handed off');
SELECT pg_temp.p4_assert(
  pg_temp.p4_authorize(pg_temp.p4_sched(pg_temp.p4_conv(52), :'u2', 'live', 'Подробнее: wa.me/996000')) ->> 'reason' = 'link'
  AND pg_temp.p4_authorize(pg_temp.p4_sched(pg_temp.p4_conv(53), :'u3', 'live', 'Оплатите картой')) ->> 'reason' = 'stop_word',
  'rules 7/13 (authorize): a link, a stop word in the stored text');
-- Rule 2 (the newest), a closed chat, a history message and rule 4 (ready,
-- not superseded) at authorize.
CREATE FUNCTION pg_temp.p4_sched_cited(p_conv UUID, p_msg UUID, p_cited BIGINT) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_start TIMESTAMPTZ; v_end TIMESTAMPTZ;
BEGIN
  SELECT (w ->> 'intervalStart')::TIMESTAMPTZ, (w ->> 'intervalEnd')::TIMESTAMPTZ INTO v_start, v_end
  FROM platform_private.ai_autosend_window(platform_private.ai_autosend_settings_row(pg_temp.p4_id(1)), clock_timestamp()) w;
  RETURN pg_temp.p4_seed(p_conv, p_msg, 'scheduled', 'live', 'answer', 'Какая страна вас интересует?',
    clock_timestamp() - INTERVAL '40 seconds', v_start, v_end, NULL, ARRAY[p_cited]);
END
$$;
SELECT pg_temp.p4_in(76, 'P4 клиент: документ на проверке', 30) AS az1 \gset
SELECT pg_temp.p4_in(77, 'P4 клиент: документ заменён', 30) AS az2 \gset
SELECT pg_temp.p4_in(78, 'P4 клиент: первое для authorize', 30) AS az3 \gset
SELECT pg_temp.p4_in(79, 'P4 клиент: чат закроют до отправки', 30) AS az4 \gset
SELECT pg_temp.p4_in(88, 'P4 клиент: станет историей до отправки', 30) AS az5 \gset
SELECT pg_temp.p4_sched_cited(pg_temp.p4_conv(76), :'az1', :k_notready) AS d_az1 \gset
SELECT pg_temp.p4_sched_cited(pg_temp.p4_conv(77), :'az2', :k_superseded) AS d_az2 \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(78), :'az3') AS d_az3 \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(79), :'az4') AS d_az4 \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(88), :'az5') AS d_az5 \gset
SELECT pg_temp.p4_in(78, 'P4 клиент: второе для authorize', 20) AS az3b \gset
SET LOCAL session_replication_role = replica;
UPDATE platform.communication_conversations SET status = 'closed' WHERE id = pg_temp.p4_conv(79);
UPDATE platform.communication_messages SET message_identity_source = 'private_waha_history_binding' WHERE id = :'az5';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p4_assert(pg_temp.p4_authorize(:'d_az1') ->> 'reason' = 'source_not_allowed'
  AND pg_temp.p4_authorize(:'d_az2') ->> 'reason' = 'source_not_allowed'
  AND pg_temp.p4_authorize(:'d_az3') ->> 'reason' = 'not_latest'
  AND pg_temp.p4_authorize(:'d_az4') ->> 'reason' = 'conversation_closed'
  AND pg_temp.p4_authorize(:'d_az5') ->> 'reason' = 'history_message'
  AND NOT EXISTS (SELECT 1 FROM platform.manual_send_authorizations a
    WHERE a.ai_autosend_decision_id IN (:'d_az1', :'d_az2', :'d_az3', :'d_az4', :'d_az5')),
  'authorize: a source not ready, a superseded source, a newer client message, a closed chat, a history message');

-- An authorize replay of an item nobody has claimed yet re-checks every rule;
-- pause, disable, exclusion and the shadow switch take such an item off the
-- queue at once (dead letter, decision cancelled, the exact claim gets
-- nothing, the chat shows no attempt for it).
CREATE FUNCTION pg_temp.p4_live(p_chat INTEGER, p_label TEXT, p_request INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_msg UUID; v_decision UUID; v_result JSONB;
BEGIN
  v_msg := pg_temp.p4_in(p_chat, 'P4 клиент ' || p_label, 30);
  v_decision := pg_temp.p4_sched(pg_temp.p4_conv(p_chat), v_msg);
  v_result := pg_temp.p4_authorize(v_decision, 'WORKING', p_request);
  IF NOT COALESCE((v_result ->> 'authorized')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'P4: % was not authorized: %', p_label, v_result;
  END IF;
  RETURN v_decision;
END
$$;
CREATE FUNCTION pg_temp.p4_taken_off(p_decision UUID, p_reason TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE r platform_private.ai_autosend_log := pg_temp.p4_row(p_decision); v_claim JSONB; v_state JSONB;
BEGIN
  v_claim := pg_temp.p4_service(format('SELECT platform.claim_manual_whatsapp_send_item(%L, %L, 60, %L, %L)',
    pg_temp.p4_id(1), r.work_item_id, 'ai-autosend', gen_random_uuid()));
  v_state := pg_temp.p4_staff(2, format('SELECT row_to_json(s)::JSONB FROM platform.staff_whatsapp_chat_state(%L, %L, 50) s',
    pg_temp.p4_id(1), r.conversation_id));
  RETURN r.status = 'cancelled' AND r.reason_code = p_reason AND r.manual_send_authorization_id IS NOT NULL
    AND (SELECT i.state = 'dead_lettered' FROM platform_private.durable_work_items i WHERE i.id = r.work_item_id)
    AND EXISTS (SELECT 1 FROM platform_private.durable_work_dead_letters d
      WHERE d.work_item_id = r.work_item_id AND d.reason_code = 'ai_autosend_cancelled' AND d.attempt_id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM pgmq.q_platform_work_v1 q JOIN platform_private.durable_work_items i
      ON i.queue_message_id = q.msg_id WHERE i.id = r.work_item_id)
    AND NOT COALESCE((v_claim ->> 'claimed')::BOOLEAN, FALSE)
    AND NOT EXISTS (SELECT 1 FROM platform_private.durable_work_attempts a WHERE a.work_item_id = r.work_item_id)
    AND v_state ? 'attempts'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_state -> 'attempts') e
      WHERE e ->> 'work_item_id' = r.work_item_id::TEXT);
END
$$;
SELECT pg_temp.p4_live(81, 'R2', 6102) AS d_r2 \gset
SELECT pg_temp.p4_out(81, 'P4 ответ с телефона R2', 5);
SELECT pg_temp.p4_live(82, 'R3', 6103) AS d_r3 \gset
SELECT pg_temp.p4_in(82, 'P4 клиент R3: ещё', 4) AS r3b \gset
SELECT pg_temp.p4_live(83, 'R4', 6104) AS d_r4 \gset
UPDATE platform_private.ai_autosend_log SET authorized_at = clock_timestamp() - INTERVAL '61 seconds' WHERE id = :'d_r4';
SELECT pg_temp.p4_live(89, 'R8', 6108) AS d_r8 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_authorize(:'d_r2') ->> 'reason' = 'staff_active' AND pg_temp.p4_taken_off(:'d_r2', 'staff_active')
  AND pg_temp.p4_authorize(:'d_r3') ->> 'reason' = 'not_latest' AND pg_temp.p4_taken_off(:'d_r3', 'not_latest')
  AND pg_temp.p4_authorize(:'d_r4') ->> 'reason' = 'send_expired' AND pg_temp.p4_taken_off(:'d_r4', 'send_expired')
  AND (pg_temp.p4_authorize(:'d_r8') ->> 'replayed')::BOOLEAN AND (pg_temp.p4_row(:'d_r8')).status = 'authorized'
  AND pg_temp.p4_authorize(:'d_r2') = jsonb_build_object('authorized', FALSE, 'reason', 'not_scheduled',
    'decisionId', :'d_r2', 'status', 'cancelled'),
  'replay of an unclaimed item: a phone reply, a newer client message, older than 60 s — refused and taken off the queue; a clean replay within 60 s stays authorized');
SELECT pg_temp.p4_assert(EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'ai.agent.autosend.cancel'
    AND e.actor_kind = 'service' AND e.after_state ->> 'decisionId' = :'d_r2' AND e.after_state ->> 'reasonCode' = 'staff_active'
    AND NOT e.after_state::TEXT LIKE '%страна%'),
  'a refused replay is audited (service, without text)');
SELECT pg_temp.p4_assert(pg_temp.p4_authorize(:'d_r8', 'STOPPED') ->> 'reason' = 'provider_down'
  AND pg_temp.p4_taken_off(:'d_r8', 'provider_down')
  AND (platform_private.ai_autosend_settings_row(pg_temp.p4_id(1))).pause_code = 'provider_down',
  'replay with the session not WORKING: taken off and the autoresponder pauses');
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_pause_v1(%L, %L, %s, %L)',
  pg_temp.p4_id(1), 'resume', pg_temp.p4_version(), pg_temp.p4_id(3101)));
SELECT pg_temp.p4_live(80, 'R1', 6101) AS d_r1 \gset
SELECT pg_temp.p4_live(84, 'R5', 6105) AS d_r5 \gset
SELECT pg_temp.p4_live(85, 'R6', 6106) AS d_r6 \gset
SELECT pg_temp.p4_live(86, 'R7', 6107) AS d_r7 \gset
SELECT pg_temp.p4_assert((pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_exclusion_v1(%L, %L, TRUE, %L)',
    pg_temp.p4_id(1), pg_temp.p4_conv(80), pg_temp.p4_id(3102))) ->> 'cancelled')::INTEGER = 1
  AND pg_temp.p4_taken_off(:'d_r1', 'excluded') AND (pg_temp.p4_row(:'d_r5')).status = 'authorized'
  AND pg_temp.p4_authorize(:'d_r1') ->> 'reason' = 'not_scheduled',
  'excluding the chat takes its unclaimed autoresponse off the queue at once (other chats keep theirs)');
SELECT pg_temp.p4_assert((pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_pause_v1(%L, %L, %s, %L)',
    pg_temp.p4_id(1), 'pause', pg_temp.p4_version(), pg_temp.p4_id(3103))) ->> 'cancelled')::INTEGER = 3
  AND pg_temp.p4_taken_off(:'d_r5', 'paused') AND pg_temp.p4_taken_off(:'d_r6', 'paused')
  AND pg_temp.p4_taken_off(:'d_r7', 'paused'),
  'a pause takes every unclaimed autoresponse off the queue at once');
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_pause_v1(%L, %L, %s, %L)',
  pg_temp.p4_id(1), 'resume', pg_temp.p4_version(), pg_temp.p4_id(3104)));
SELECT pg_temp.p4_in(84, 'P4 клиент R5: снова', 3) AS r5b \gset
SELECT pg_temp.p4_assert(pg_temp.p4_due(pg_temp.p4_conv(84), :'r5b') ->> 'status' = 'considering',
  'a cancelled autoresponse leaves no pending attempt behind: the chat is not «staff active»');
SELECT pg_temp.p4_live(87, 'R9', 6109) AS d_r9 \gset
SELECT pg_temp.p4_live(90, 'R10', 6110) AS d_r10 \gset
SELECT pg_temp.p4_assert((pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_enable_v1(%L, FALSE, %s, %L)',
    pg_temp.p4_id(1), pg_temp.p4_version(), pg_temp.p4_id(3105))) ->> 'cancelled')::INTEGER = 2
  AND pg_temp.p4_taken_off(:'d_r9', 'disabled') AND pg_temp.p4_taken_off(:'d_r10', 'disabled')
  AND (pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_enable_v1(%L, TRUE, %s, %L)',
    pg_temp.p4_id(1), pg_temp.p4_version(), pg_temp.p4_id(3106))) ->> 'enabled')::BOOLEAN,
  'disabling takes unclaimed autoresponses off the queue at once');
SELECT pg_temp.p4_live(91, 'R11', 6111) AS d_r11 \gset
SELECT pg_temp.p4_assert((pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_shadow_v1(%L, TRUE, %s, %L)',
    pg_temp.p4_id(1), pg_temp.p4_version(), pg_temp.p4_id(3107))) ->> 'cancelled')::INTEGER = 1
  AND pg_temp.p4_taken_off(:'d_r11', 'shadow_mode'),
  'back to shadow takes unclaimed live autoresponses off the queue at once');
UPDATE platform_private.ai_autosend_settings SET shadow_mode = FALSE WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_live(92, 'R12', 6112) AS d_r12 \gset
UPDATE platform_private.ai_autosend_log SET authorized_at = clock_timestamp() - INTERVAL '3 minutes' WHERE id = :'d_r12';
SELECT pg_temp.p4_agent('SELECT platform_ai_agent.maintenance_v1()') AS mnt_r12 \gset
SELECT pg_temp.p4_assert((:'mnt_r12'::JSONB ->> 'autosendUnclaimedCancelled')::INTEGER = 1
  AND pg_temp.p4_taken_off(:'d_r12', 'send_expired'),
  'maintenance takes an autoresponse nobody claimed within 2 minutes off the queue');
-- The off switch never fails on cleanup: a work item whose PGMQ message is
-- gone cannot be dead-lettered, yet the pause applies and the decision is
-- cancelled (a replay refuses it, so nobody claims the item).
SELECT pg_temp.p4_live(93, 'R13', 6113) AS d_r13 \gset
DELETE FROM pgmq.q_platform_work_v1 q USING platform_private.durable_work_items i
  WHERE i.id = (pg_temp.p4_row(:'d_r13')).work_item_id AND q.msg_id = i.queue_message_id;
SELECT pg_temp.p4_assert((pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_pause_v1(%L, %L, %s, %L)',
    pg_temp.p4_id(1), 'pause', pg_temp.p4_version(), pg_temp.p4_id(3108))) ->> 'pauseCode') = 'manual'
  AND (pg_temp.p4_row(:'d_r13')).status = 'cancelled' AND (pg_temp.p4_row(:'d_r13')).reason_code = 'paused'
  AND pg_temp.p4_authorize(:'d_r13') ->> 'reason' = 'not_scheduled',
  'a pause applies even when an unclaimed item cannot be dead-lettered; the decision is cancelled');
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_pause_v1(%L, %L, %s, %L)',
  pg_temp.p4_id(1), 'resume', pg_temp.p4_version(), pg_temp.p4_id(3109)));
SELECT pg_temp.p4_sched(pg_temp.p4_conv(55), :'u5') AS d_u5 \gset
UPDATE platform_private.ai_autosend_settings SET shadow_mode = TRUE WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_assert(pg_temp.p4_authorize(:'d_u5') ->> 'reason' = 'shadow_mode',
  'rule 11 (authorize): a chat outside the live-test list while in shadow');
UPDATE platform_private.ai_autosend_settings SET shadow_mode = FALSE WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_sched(pg_temp.p4_conv(56), :'u6') AS d_u6 \gset
UPDATE platform_private.ai_autosend_settings SET pause_code = 'manual', pause_by_kind = 'user', paused_at = clock_timestamp(),
  paused_by = pg_temp.p4_id(302) WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_authorize(:'d_u6') ->> 'reason' AS r_paused \gset
UPDATE platform_private.ai_autosend_settings SET pause_code = NULL, pause_by_kind = NULL, paused_at = NULL, paused_by = NULL
  WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_in(56, 'P4 клиент U6: снова', 10) AS u7 \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(56), :'u7') AS d_u7 \gset
UPDATE platform_private.ai_autosend_settings SET enabled = FALSE WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_authorize(:'d_u7') ->> 'reason' AS r_disabled \gset
UPDATE platform_private.ai_autosend_settings SET enabled = TRUE WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_in(56, 'P4 клиент U6: третье', 8) AS u8 \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(56), :'u8') AS d_u8 \gset
UPDATE platform_private.ai_settings SET gemini_consent_at = NULL, gemini_consent_by = NULL, gemini_consent_text_version = NULL
  WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_authorize(:'d_u8') ->> 'reason' AS r_consent \gset
UPDATE platform_private.ai_settings SET gemini_consent_at = clock_timestamp(), gemini_consent_by = pg_temp.p4_id(301),
  gemini_consent_text_version = 'gemini-v1-2026-10-06' WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_assert(:'r_paused' = 'paused' AND :'r_disabled' = 'disabled' AND :'r_consent' = 'no_consent',
  'rule 11 (authorize): each state refuses — paused, off, no consent');
-- The responsible member suspended, then without the right to send.
SELECT pg_temp.p4_in(56, 'P4 клиент U6: четвёртое', 6) AS u9 \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(56), :'u9') AS d_u9 \gset
UPDATE platform.organization_memberships SET status = 'suspended' WHERE id = pg_temp.p4_id(302);
SELECT pg_temp.p4_authorize(:'d_u9') ->> 'reason' AS r_suspended \gset
UPDATE platform.organization_memberships SET status = 'active' WHERE id = pg_temp.p4_id(302);
SELECT pg_temp.p4_assert(:'r_suspended' = 'responsible_unavailable',
  'the responsible member suspended: responsible_unavailable');
SELECT pg_temp.p4_in(56, 'P4 клиент U6: пятое', 5) AS u10 \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(56), :'u10') AS d_u10 \gset
UPDATE platform_private.ai_autosend_settings SET responsible_membership_id = pg_temp.p4_id(304)
  WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_authorize(:'d_u10') ->> 'reason' AS r_noright \gset
UPDATE platform_private.ai_autosend_settings SET responsible_membership_id = pg_temp.p4_id(302)
  WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_assert(:'r_noright' = 'responsible_unavailable',
  'the responsible member without communication.manual.send in this chat: responsible_unavailable');
-- Provider down: skipped and the autoresponder pauses (scheduled sends cancelled).
SELECT pg_temp.p4_in(57, 'P4 клиент V1', 20) AS v1m \gset
SELECT pg_temp.p4_in(58, 'P4 клиент V2', 20) AS v2m \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(57), :'v1m') AS d_v1 \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(58), :'v2m') AS d_v2 \gset
SELECT pg_temp.p4_authorize(:'d_v1', 'STOPPED') AS au_v1 \gset
SELECT pg_temp.p4_assert(:'au_v1'::JSONB ->> 'reason' = 'provider_down' AND (pg_temp.p4_row(:'d_v1')).status = 'skipped'
  AND (pg_temp.p4_row(:'d_v2')).status = 'cancelled'
  AND (platform_private.ai_autosend_settings_row(pg_temp.p4_id(1))).pause_code = 'provider_down'
  AND EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.organization_id = pg_temp.p4_id(1)
    AND e.action = 'ai.agent.autosend.pause' AND e.after_state ->> 'pauseCode' = 'provider_down'),
  'rule 11: a session not WORKING pauses, cancels scheduled sends, audited');
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_pause_v1(%L, %L, %s, %L)',
  pg_temp.p4_id(1), 'resume', pg_temp.p4_version(), pg_temp.p4_id(3070)));
UPDATE platform_private.ai_autosend_settings SET shadow_mode = TRUE WHERE organization_id = pg_temp.p4_id(1);
-- Without three recent shadow nights the live-test chat is a shadow chat
-- again (the synthetic nights go; section 7 builds real ones).
DELETE FROM platform_private.ai_autosend_summaries WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_in(50, 'P4 клиент L: ещё вопрос', 5) AS l5 \gset
SELECT pg_temp.p4_sched(:'c_l', :'l5', 'live_test') AS d_l5 \gset
SELECT pg_temp.p4_assert(pg_temp.p4_authorize(:'d_l5') ->> 'reason' = 'shadow_mode'
  AND pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_conversation_v1(%L, %L)', pg_temp.p4_id(1), :'c_l'))
    ->> 'mode' = 'shadow',
  'rule 11 (authorize): a live-test chat answers for real only while three shadow nights are on record');

-- The insert guard and the one-source CHECK.
SELECT pg_temp.p4_in(59, 'P4 клиент Z', 20) AS z1 \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(59), :'z1') AS d_z1 \gset
CREATE FUNCTION pg_temp.p4_insert_authz(p_decision UUID, p_text TEXT, p_kind TEXT, p_guc TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r platform_private.ai_autosend_log := pg_temp.p4_row(p_decision);
BEGIN
  PERFORM set_config('evo.ai_autosend_authorize', p_guc, TRUE);
  BEGIN
    INSERT INTO platform.manual_send_authorizations(organization_id, conversation_id, source_message_id, final_text,
      final_text_sha256, authorized_by_profile_id, authorized_by_membership_id, reason, request_id, kind,
      ai_autosend_decision_id)
    VALUES (r.organization_id, r.conversation_id, r.client_message_id, p_text,
      encode(sha256(convert_to(p_text, 'UTF8')), 'hex'), pg_temp.p4_id(202), pg_temp.p4_id(302), 'ai_autosend',
      gen_random_uuid(), p_kind, CASE WHEN p_kind = 'ai_autosend' THEN p_decision END);
    PERFORM set_config('evo.ai_autosend_authorize', '', TRUE);
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('evo.ai_autosend_authorize', '', TRUE);
    RETURN SQLSTATE || ':' || SQLERRM;
  END;
END
$$;
SELECT pg_temp.p4_assert(pg_temp.p4_insert_authz(:'d_z1', 'Другой текст', 'ai_autosend', 'on') LIKE '42501:ai_autosend_authorization_forbidden%'
  AND pg_temp.p4_insert_authz(:'d_z1', (pg_temp.p4_row(:'d_z1')).text, 'ai_autosend', '') LIKE '42501:ai_autosend_authorization_forbidden%'
  AND pg_temp.p4_insert_authz(:'d_a1', (pg_temp.p4_row(:'d_a1')).text, 'ai_autosend', 'on') LIKE '42501:ai_autosend_authorization_forbidden%'
  AND pg_temp.p4_err(format('UPDATE platform_private.ai_autosend_log SET text = %L WHERE id = %L', 'Подменённый текст', :'d_z1'))
    LIKE '23514:%',
  'rule 9: a tampered text, a missing GUC or a decision that is not scheduled (a shadow row) is refused by the insert guard; the stored text cannot drift from its SHA-256');
SET LOCAL session_replication_role = replica;
SELECT pg_temp.p4_assert(pg_temp.p4_err(format($q$INSERT INTO platform.manual_send_authorizations(organization_id, conversation_id,
    source_message_id, final_text, final_text_sha256, authorized_by_profile_id, authorized_by_membership_id, reason, request_id,
    kind, ai_autosend_decision_id) VALUES (%L, %L, %L, 'x', %L, %L, %L, 'r', gen_random_uuid(), 'manual', %L)$q$,
    pg_temp.p4_id(1), pg_temp.p4_conv(59), :'z1', encode(sha256(convert_to('x', 'UTF8')), 'hex'), pg_temp.p4_id(202),
    pg_temp.p4_id(302), :'d_z1')) LIKE '23514:%one_source%'
  AND pg_temp.p4_err(format($q$INSERT INTO platform.manual_send_authorizations(organization_id, conversation_id,
    source_message_id, final_text, final_text_sha256, authorized_by_profile_id, authorized_by_membership_id, reason, request_id,
    kind) VALUES (%L, %L, %L, 'x', %L, %L, %L, 'r', gen_random_uuid(), 'ai_autosend')$q$,
    pg_temp.p4_id(1), pg_temp.p4_conv(59), :'z1', encode(sha256(convert_to('x', 'UTF8')), 'hex'), pg_temp.p4_id(202),
    pg_temp.p4_id(302))) LIKE '23514:%one_source%'
  AND pg_temp.p4_err(format($q$INSERT INTO platform.manual_send_authorizations(organization_id, conversation_id,
    source_message_id, ai_draft_id, final_text, final_text_sha256, authorized_by_profile_id, authorized_by_membership_id, reason,
    request_id, kind, ai_autosend_decision_id) VALUES (%L, %L, %L, gen_random_uuid(), 'x', %L, %L, %L, 'r', gen_random_uuid(),
    'ai_autosend', %L)$q$, pg_temp.p4_id(1), pg_temp.p4_conv(59), :'z1', encode(sha256(convert_to('x', 'UTF8')), 'hex'),
    pg_temp.p4_id(202), pg_temp.p4_id(302), :'d_z1')) LIKE '23514:%one_source%'
  AND pg_temp.p4_err(format($q$INSERT INTO platform.manual_send_authorizations(organization_id, conversation_id,
    source_message_id, final_text, final_text_sha256, authorized_by_profile_id, authorized_by_membership_id, reason, request_id,
    kind) VALUES (%L, %L, %L, 'x', %L, %L, %L, 'r', gen_random_uuid(), 'robot')$q$,
    pg_temp.p4_id(1), pg_temp.p4_conv(59), :'z1', encode(sha256(convert_to('x', 'UTF8')), 'hex'), pg_temp.p4_id(202),
    pg_temp.p4_id(302))) LIKE '23514:%',
  'one source: a manual row cannot carry a decision; an autoresponder row needs one and no AI draft; only two kinds');
SET LOCAL session_replication_role = origin;

-- record: failures and 463/475 pause.
CREATE FUNCTION pg_temp.p4_authorized(p_conv UUID, p_msg UUID) RETURNS UUID LANGUAGE SQL AS $$
  SELECT pg_temp.p4_seed(p_conv, p_msg, 'authorized', 'live', 'answer', 'Какая страна вас интересует?',
    clock_timestamp() - INTERVAL '40 seconds', (SELECT (w ->> 'intervalStart')::TIMESTAMPTZ FROM platform_private.ai_autosend_window(
      platform_private.ai_autosend_settings_row(pg_temp.p4_id(1)), clock_timestamp()) w),
    (SELECT (w ->> 'intervalEnd')::TIMESTAMPTZ FROM platform_private.ai_autosend_window(
      platform_private.ai_autosend_settings_row(pg_temp.p4_id(1)), clock_timestamp()) w))
$$;
CREATE FUNCTION pg_temp.p4_record(p_decision UUID, p_outcome TEXT, p_code TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.p4_service(format('SELECT platform.ai_autosend_record_v1(%L, %L, %L, %L, %L)', pg_temp.p4_id(1),
    p_decision, p_outcome, p_code, gen_random_uuid()))
$$;
SELECT pg_temp.p4_in(60, 'P4 клиент Y1', 20) AS y1 \gset
SELECT pg_temp.p4_in(61, 'P4 клиент Y2', 20) AS y2 \gset
SELECT pg_temp.p4_in(62, 'P4 клиент Y3', 20) AS y3 \gset
SELECT pg_temp.p4_in(63, 'P4 клиент Y4', 20) AS y4 \gset
SELECT pg_temp.p4_assert(NOT (pg_temp.p4_record(pg_temp.p4_authorized(pg_temp.p4_conv(60), :'y1'), 'failed', 'message_rejected') ->> 'paused')::BOOLEAN
  AND NOT (pg_temp.p4_record(pg_temp.p4_authorized(pg_temp.p4_conv(61), :'y2'), 'unknown', 'provider_timeout') ->> 'paused')::BOOLEAN
  AND (pg_temp.p4_record(pg_temp.p4_authorized(pg_temp.p4_conv(62), :'y3'), 'failed', 'message_rejected') ->> 'pauseCode') = 'send_errors',
  'record: three send failures in a row pause (send_errors)');
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_pause_v1(%L, %L, %s, %L)',
  pg_temp.p4_id(1), 'resume', pg_temp.p4_version(), pg_temp.p4_id(3071)));
SELECT pg_temp.p4_assert((pg_temp.p4_record(pg_temp.p4_authorized(pg_temp.p4_conv(63), :'y4'), 'failed', 'provider_restricted') ->> 'pauseCode')
    = 'provider_restricted'
  AND (platform_private.ai_autosend_settings_row(pg_temp.p4_id(1))).send_error_streak = 1,
  'record: 463/475 (provider_restricted) pause at once');
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_pause_v1(%L, %L, %s, %L)',
  pg_temp.p4_id(1), 'resume', pg_temp.p4_version(), pg_temp.p4_id(3072)));
SELECT pg_temp.p4_assert(pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_pause_v1(%L, %L, %L)', pg_temp.p4_id(1),
    'server_switch_off', pg_temp.p4_wid(6020))) ->> 'pauseCode' = 'server_switch_off'
  AND (pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_pause_v1(%L, %L, %L)', pg_temp.p4_id(1),
    'server_switch_off', pg_temp.p4_wid(6020))) ->> 'replayed')::BOOLEAN
  AND pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_pause_v1(%L, %L, %L)', pg_temp.p4_id(1),
    'manual', pg_temp.p4_wid(6021))) ->> 'error' LIKE '22023:%',
  'the agent pauses (server_switch_off after a 503), idempotently; it cannot use the human pause code');
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_pause_v1(%L, %L, %s, %L)',
  pg_temp.p4_id(1), 'resume', pg_temp.p4_version(), pg_temp.p4_id(3073)));

-- ---------------------------------------------------------------------------
-- 7. Summaries, tasks and the three shadow nights.
-- ---------------------------------------------------------------------------
-- A canonical lead for chat P (the task links to it).
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name) VALUES
  (pg_temp.p4_id(701), pg_temp.p4_id(1), 'Синтетия Тестова', platform_private.normalize_person_name('Синтетия Тестова'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, interest_direction)
  VALUES (pg_temp.p4_id(702), pg_temp.p4_id(1), pg_temp.p4_id(701), pg_temp.p4_id(301), 'new', 'website', 'MY');
UPDATE platform.communication_conversations SET canonical_client_id = pg_temp.p4_id(701), canonical_lead_id = pg_temp.p4_id(702)
  WHERE id = :'c_p';
SET LOCAL session_replication_role = origin;
-- A live night (two days ago): P answered and got the final phrase (sent), Q only skipped.
SELECT clock_timestamp() - INTERVAL '2 days 1 hour' AS n1s, clock_timestamp() - INTERVAL '1 day 12 hours' AS n1e,
  clock_timestamp() - INTERVAL '5 days 1 hour' AS n2s, clock_timestamp() - INTERVAL '4 days 12 hours' AS n2e,
  clock_timestamp() - INTERVAL '4 days 1 hour' AS n3s, clock_timestamp() - INTERVAL '3 days 12 hours' AS n3e,
  clock_timestamp() - INTERVAL '3 days 1 hour' AS n4s, clock_timestamp() - INTERVAL '2 days 12 hours' AS n4e \gset
SELECT pg_temp.p4_seed(:'c_p', (SELECT id FROM p4_m WHERE label = 'p1'), 'sent', 'live', 'answer', 'P4 ответ',
  :'n1s'::TIMESTAMPTZ + INTERVAL '10 minutes', :'n1s', :'n1e');
SELECT pg_temp.p4_seed(:'c_p', (SELECT id FROM p4_m WHERE label = 'p2'), 'sent', 'live', 'final_phrase',
  'Завтра в рабочее время вам позвонит наш руководитель.', :'n1s'::TIMESTAMPTZ + INTERVAL '20 minutes', :'n1s', :'n1e',
  DATE '2026-10-12');
UPDATE platform_private.ai_autosend_log SET qualification = '{"country":"Малайзия","budget":"до 2000 $ в семестр"}'
  WHERE client_message_id = (SELECT id FROM p4_m WHERE label = 'p2');
SELECT pg_temp.p4_seed(:'c_q', (SELECT id FROM p4_m WHERE label = 'q1'), 'skipped', 'live', NULL, 'P4 пропуск',
  :'n1s'::TIMESTAMPTZ + INTERVAL '30 minutes', :'n1s', :'n1e');
-- X got the final phrase too, but its send outcome is unknown: it may have
-- reached the client, so a call task as well.
SELECT pg_temp.p4_seed(:'c_x', (SELECT id FROM p4_m WHERE label = 'x3'), 'unknown', 'live', 'final_phrase',
  'Завтра в рабочее время вам позвонит наш руководитель.', :'n1s'::TIMESTAMPTZ + INTERVAL '40 minutes', :'n1s', :'n1e',
  DATE '2026-10-12');
-- Three shadow nights (5, 4 and 3 days ago); one with a shadow final phrase.
SELECT pg_temp.p4_seed(:'c_q', (SELECT id FROM p4_m WHERE label = 'q2'), 'shadow', 'shadow', 'final_phrase',
  'Завтра в рабочее время вам позвонит наш руководитель.', :'n2s'::TIMESTAMPTZ + INTERVAL '10 minutes', :'n2s', :'n2e');
SELECT pg_temp.p4_seed(:'c_q', (SELECT id FROM p4_m WHERE label = 'q3'), 'shadow', 'shadow', 'answer', 'P4 ответ',
  :'n3s'::TIMESTAMPTZ + INTERVAL '10 minutes', :'n3s', :'n3e');
SELECT pg_temp.p4_seed(:'c_p', (SELECT id FROM p4_m WHERE label = 'p3'), 'skipped', 'shadow', NULL, 'P4 пропуск',
  :'n4s'::TIMESTAMPTZ + INTERVAL '10 minutes', :'n4s', :'n4e');
-- n4 above has only a skip: not a night to review. A third real shadow night
-- a week ago, and an old one (40 days) that no longer counts.
SELECT clock_timestamp() - INTERVAL '7 days 1 hour' AS n6s, clock_timestamp() - INTERVAL '6 days 12 hours' AS n6e,
  clock_timestamp() - INTERVAL '40 days 1 hour' AS n7s, clock_timestamp() - INTERVAL '39 days 12 hours' AS n7e \gset
SELECT pg_temp.p4_seed(:'c_x', (SELECT id FROM p4_m WHERE label = 'x1'), 'shadow', 'shadow', 'answer', 'P4 ответ',
  :'n6s'::TIMESTAMPTZ + INTERVAL '10 minutes', :'n6s', :'n6e');
SELECT pg_temp.p4_seed(:'c_x', (SELECT id FROM p4_m WHERE label = 'x2'), 'shadow', 'shadow', 'answer', 'P4 ответ',
  :'n7s'::TIMESTAMPTZ + INTERVAL '10 minutes', :'n7s', :'n7e');
SELECT pg_temp.p4_assert(pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_shadow_v1(%L, FALSE, %s, %L)',
    pg_temp.p4_id(1), pg_temp.p4_version(), pg_temp.p4_id(3080))) ->> 'error' LIKE 'PT412:ai_autosend_shadow_nights_required%',
  'live needs three shadow nights (none summarized yet)');
SELECT pg_temp.p4_agent('SELECT platform_ai_agent.autosend_summary_due_v1()') AS sum1 \gset
SELECT pg_temp.p4_assert((:'sum1'::JSONB ->> 'created')::INTEGER = 6
  AND (SELECT count(*) = 6 FROM platform_private.ai_autosend_summaries WHERE organization_id = pg_temp.p4_id(1))
  AND (SELECT count(*) = 5 FROM platform_private.ai_autosend_summaries WHERE organization_id = pg_temp.p4_id(1) AND shadow_night)
  AND platform_private.ai_autosend_shadow_nights(pg_temp.p4_id(1)) = 3
  AND (SELECT count(*) = 2 FROM platform_private.ai_autosend_call_tasks WHERE organization_id = pg_temp.p4_id(1))
  AND EXISTS (SELECT 1 FROM platform_private.ai_autosend_call_tasks WHERE conversation_id = :'c_x' AND staff_task_id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_summaries s WHERE s.organization_id = pg_temp.p4_id(1)
    AND s.items::TEXT ~ '(P4 клиент|P4 ответ|Завтра в рабочее)'),
  'summaries: six ended intervals; three shadow nights count (a night with only skips and a night 40 days ago do not); tasks for the live final phrases sent or unknown; no text');
SELECT t.staff_task_id AS task_p FROM platform_private.ai_autosend_call_tasks t WHERE t.conversation_id = :'c_p' \gset
SELECT pg_temp.p4_assert((SELECT t.title = 'Позвонить клиенту' AND t.creator_membership_id = pg_temp.p4_id(302)
    AND t.assignee_membership_id = pg_temp.p4_id(302) AND t.priority = 'high' AND t.status = 'open'
    AND t.due_at = TIMESTAMPTZ '2026-10-12 10:00:00+06'
  FROM platform.staff_tasks t WHERE t.id = :'task_p')
  AND EXISTS (SELECT 1 FROM platform.staff_task_events e WHERE e.staff_task_id = :'task_p' AND e.action = 'create'
    AND e.actor_membership_id = pg_temp.p4_id(302))
  AND EXISTS (SELECT 1 FROM platform_private.staff_task_receipts r WHERE r.staff_task_id = :'task_p')
  AND EXISTS (SELECT 1 FROM platform_private.staff_lead_task_links l WHERE l.staff_task_id = :'task_p'
    AND l.lead_id = pg_temp.p4_id(702))
  AND EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.resource_id = :'task_p' AND e.action = 'staff.task.create'
    AND e.actor_kind = 'system')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_call_tasks WHERE conversation_id = :'c_q')
  AND EXISTS (SELECT 1 FROM platform.staff_notifications n WHERE n.staff_task_id = :'task_p'
    AND n.recipient_membership_id = pg_temp.p4_id(302) AND n.kind = 'task_assigned' AND n.read_at IS NULL),
  'the task: «Позвонить клиенту», creator = assignee = the responsible member, 10:00 Bishkek of the call date, high; events, receipt, lead link, a «task assigned» notification, system audit; none for the shadow final phrase');
SELECT pg_temp.p4_assert((pg_temp.p4_agent('SELECT platform_ai_agent.autosend_summary_due_v1()') ->> 'created')::INTEGER = 0
  AND (SELECT count(*) = 2 FROM platform.staff_tasks WHERE title = 'Позвонить клиенту' AND organization_id = pg_temp.p4_id(1)),
  'tasks: once — a second run creates nothing');
-- The responsible member cannot receive tasks: the summary records taskSkipped.
SELECT clock_timestamp() - INTERVAL '6 days 1 hour' AS n5s, clock_timestamp() - INTERVAL '5 days 12 hours' AS n5e \gset
SELECT pg_temp.p4_in(67, 'P4 клиент прошлой живой ночи', 7100) AS ts1 \gset
SELECT pg_temp.p4_seed(pg_temp.p4_conv(67), :'ts1', 'sent', 'live', 'final_phrase',
  'Завтра в рабочее время вам позвонит наш руководитель.', :'n5s'::TIMESTAMPTZ + INTERVAL '10 minutes', :'n5s', :'n5e',
  DATE '2026-10-12');
UPDATE platform_private.ai_autosend_settings SET responsible_membership_id = pg_temp.p4_id(303)
  WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_agent('SELECT platform_ai_agent.autosend_summary_due_v1()') ->> 'created' AS sum_skip_created \gset
UPDATE platform_private.ai_autosend_settings SET responsible_membership_id = pg_temp.p4_id(302)
  WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_assert(:'sum_skip_created' = '1'
  AND (SELECT t.staff_task_id IS NULL AND t.skipped_reason = 'assignee_unavailable'
    FROM platform_private.ai_autosend_call_tasks t WHERE t.conversation_id = pg_temp.p4_conv(67))
  AND (SELECT (e ->> 'taskSkipped')::BOOLEAN FROM platform_private.ai_autosend_summaries s
    CROSS JOIN LATERAL jsonb_array_elements(s.items) e WHERE e ->> 'conversationId' = pg_temp.p4_conv(67)::TEXT),
  'a responsible member who cannot receive tasks: taskSkipped, no task');

-- Qualification of the live night.
SELECT s.id AS sum_live FROM platform_private.ai_autosend_summaries s WHERE s.organization_id = pg_temp.p4_id(1)
  AND s.interval_start = :'n1s'::TIMESTAMPTZ \gset
SELECT pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_summary_context_v1(%L, %L, 120)', :'sum_live', 'p4-summary')) AS sctx \gset
SELECT pg_temp.p4_assert(:'sctx'::JSONB ->> 'status' = 'claimed' AND jsonb_array_length(:'sctx'::JSONB -> 'chats') = 3
  AND pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_summary_put_v1(%L, %L, %L)', :'sum_live', 'p4-summary',
    jsonb_build_array(jsonb_build_object('conversationId', :'c_p', 'qualification', '{"city":"+996 555 123 456"}'::JSONB)))) ->> 'error'
    LIKE '22023:%'
  AND pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_summary_put_v1(%L, %L, %L)', :'sum_live', 'p4-summary',
    jsonb_build_array(jsonb_build_object('conversationId', pg_temp.p4_conv(30), 'qualification', '{"city":"Ош"}'::JSONB)))) ->> 'error'
    LIKE '22023:%'
  AND pg_temp.p4_agent(format('SELECT platform_ai_agent.autosend_summary_put_v1(%L, %L, %L)', :'sum_live', 'p4-summary',
    jsonb_build_array(jsonb_build_object('conversationId', :'c_p', 'qualification', '{"city":"Бишкек","grade_or_age":"11 класс"}'::JSONB))))
    ->> 'status' = 'saved',
  'summary qualification: claimed with the night''s chats; a phone or a foreign chat 22023; saved');
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_summary_v1(%L, %L)', pg_temp.p4_id(1), :'sum_live')) AS sv2 \gset
SELECT pg_temp.p4_staff(3, format('SELECT platform.ai_agent_autosend_summary_v1(%L, %L)', pg_temp.p4_id(1), :'sum_live')) AS sv3 \gset
SELECT pg_temp.p4_assert(:'sv2'::JSONB -> 'summary' ->> 'status' = 'ready'
  AND (SELECT e -> 'qualification' ->> 'city' = 'Бишкек' AND e -> 'qualification' ->> 'country' = 'Малайзия'
    AND (e ->> 'taskId')::UUID = :'task_p'::UUID
    FROM jsonb_array_elements(:'sv2'::JSONB -> 'summary' -> 'items') e WHERE e ->> 'conversationId' = :'c_p')
  AND (SELECT bool_and((e ->> 'hidden')::BOOLEAN AND NOT e ? 'qualification' AND NOT e ? 'conversationId')
    FROM jsonb_array_elements(:'sv3'::JSONB -> 'summary' -> 'items') e)
  AND (:'sv3'::JSONB ->> 'shadowNights')::INTEGER = 3,
  'staff summary: a reader of the chat sees qualification and the task; a member who cannot read it sees counts only');
SELECT pg_temp.p4_staff(3, format('SELECT platform.ai_agent_autosend_log_v1(%L, %L)', pg_temp.p4_id(1),
  jsonb_build_object('conversationId', :'c_l'))) AS log3 \gset
SELECT pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_log_v1(%L, %L)', pg_temp.p4_id(1),
  jsonb_build_object('conversationId', :'c_l', 'status', 'sent'))) AS log2 \gset
SELECT pg_temp.p4_assert(jsonb_array_length(:'log3'::JSONB -> 'items') >= 4
  AND (SELECT bool_and((e ->> 'textHidden')::BOOLEAN AND e ->> 'text' IS NULL AND e -> 'qualification' = 'null'::JSONB)
    FROM jsonb_array_elements(:'log3'::JSONB -> 'items') e)
  AND jsonb_array_length(:'log2'::JSONB -> 'items') = 1
  AND :'log2'::JSONB -> 'items' -> 0 ->> 'text' LIKE 'Пишет автоматический помощник EVO%'
  AND :'log2'::JSONB -> 'items' -> 0 ->> 'reasonRu' IS NULL,
  'journal: text only for members who read the chat; filters');
SELECT pg_temp.p4_assert(pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_conversation_v1(%L, %L)',
    pg_temp.p4_id(1), :'c_a')) ->> 'handedOff' = 'true'
  AND pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_conversation_v1(%L, %L)',
    pg_temp.p4_id(1), :'c_e')) ->> 'excluded' = 'true'
  AND pg_temp.p4_staff(3, format('SELECT platform.ai_agent_autosend_conversation_v1(%L, %L)',
    pg_temp.p4_id(1), :'c_a')) ->> 'error' LIKE '42501:%',
  'the AI-window switch reads its chat: handed off, excluded; refused without chat access');
-- Live: three nights are there; still PT412 while paused or with an unconfirmed disclosure.
UPDATE platform_private.ai_autosend_settings SET pause_code = 'manual', pause_by_kind = 'user', paused_at = clock_timestamp(),
  paused_by = pg_temp.p4_id(302) WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_assert(pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_shadow_v1(%L, FALSE, %s, %L)',
    pg_temp.p4_id(1), pg_temp.p4_version(), pg_temp.p4_id(3081))) ->> 'error' LIKE 'PT412:ai_autosend_paused%',
  'live is refused while paused');
UPDATE platform_private.ai_autosend_settings SET pause_code = NULL, pause_by_kind = NULL, paused_at = NULL, paused_by = NULL,
  disclosure = jsonb_set(disclosure, '{ru,confirmed}', 'false') WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_assert(pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_shadow_v1(%L, FALSE, %s, %L)',
    pg_temp.p4_id(1), pg_temp.p4_version(), pg_temp.p4_id(3082))) ->> 'error' LIKE 'PT412:ai_autosend_disclosure_unconfirmed%'
  AND pg_temp.p4_staff(4, format('SELECT platform.ai_agent_autosend_shadow_v1(%L, FALSE, %s, %L)',
    pg_temp.p4_id(1), pg_temp.p4_version(), pg_temp.p4_id(3083))) ->> 'error' LIKE '42501:ai_autosend_sender_required%',
  'live needs a confirmed RU disclosure line and a member who may send');
UPDATE platform_private.ai_autosend_settings SET disclosure = jsonb_set(disclosure, '{ru,confirmed}', 'true')
  WHERE organization_id = pg_temp.p4_id(1);
SELECT pg_temp.p4_assert(pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_shadow_v1(%L, FALSE, %s, %L)',
    pg_temp.p4_id(1), pg_temp.p4_version(), pg_temp.p4_id(3084))) ->> 'shadowMode' = 'false'
  AND (pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_v1(%L)', pg_temp.p4_id(1))) -> 'state' ->> 'shadowNights')::INTEGER = 3,
  'three shadow nights, confirmed RU texts, no pause: the autoresponder may answer for real');
-- Disabling cancels scheduled sends.
SELECT pg_temp.p4_in(64, 'P4 клиент K', 20) AS kk \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(64), :'kk') AS d_kk \gset
SELECT pg_temp.p4_assert((pg_temp.p4_staff(2, format('SELECT platform.ai_agent_autosend_enable_v1(%L, FALSE, %s, %L)',
    pg_temp.p4_id(1), pg_temp.p4_version(), pg_temp.p4_id(3090))) ->> 'cancelled')::INTEGER >= 1
  AND (pg_temp.p4_row(:'d_kk')).status = 'cancelled' AND (pg_temp.p4_row(:'d_kk')).reason_code = 'disabled',
  'disabling cancels the scheduled sends');

-- ---------------------------------------------------------------------------
-- 8. Manual sends are unchanged; maintenance.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p4_in(65, 'P4 клиент M: ручной ответ', 20) AS mm \gset
SELECT pg_temp.p4_staff(2, format($q$SELECT platform.request_manual_whatsapp_send_with_authorization(%L, %L, %L, NULL,
  'Ручной ответ сотрудника', 'staff_chat_reply', %L, %L)$q$, pg_temp.p4_id(1), pg_temp.p4_conv(65), :'mm',
  encode(sha256(convert_to(array_to_json(ARRAY['evo-platform-work-v2', 'manual_whatsapp_send', pg_temp.p4_id(1)::TEXT,
    pg_temp.p4_conv(65)::TEXT, :'mm'::TEXT, 'staff-authored', pg_temp.p4_wid(7001)::TEXT])::TEXT, 'UTF8')), 'hex'),
  pg_temp.p4_wid(7001))) AS man \gset
SELECT pg_temp.p4_staff(2, format('SELECT row_to_json(s)::JSONB FROM platform.staff_whatsapp_chat_state(%L, %L, 50) s',
  pg_temp.p4_id(1), pg_temp.p4_conv(65))) AS st_m \gset
SELECT pg_temp.p4_assert((SELECT count(*) = 18 FROM jsonb_object_keys(:'man'::JSONB))
  AND (SELECT a.kind = 'manual' AND a.ai_autosend_decision_id IS NULL FROM platform.manual_send_authorizations a
    WHERE a.id = (:'man'::JSONB ->> 'manual_send_authorization_id')::UUID)
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'st_m'::JSONB -> 'attempts' -> 0) k)
    = ARRAY['attempt_id', 'authorized_at', 'authorized_by_membership_id', 'authorized_by_name', 'claimed_at', 'failure_code',
      'final_text', 'last_reconciled_at', 'latest_reconciliation_outcome', 'readback_settled', 'reconciliation_required',
      'request_id', 'source_message_id', 'status', 'work_item_id'],
  'manual sends unchanged: the 18-key result, kind manual, the 15 attempt keys (no kind key)');
SELECT pg_temp.p4_service(format('SELECT platform.claim_manual_whatsapp_send_item(%L, %L, 60, %L, %L)', pg_temp.p4_id(1),
  :'man'::JSONB ->> 'work_item_id', 'n-worker', pg_temp.p4_wid(7002))) AS cl_m \gset
SELECT pg_temp.p4_service(format('SELECT platform.finish_manual_whatsapp_send(%L, %L, %L, %L, %L, NULL, %L, %L, %L)',
  pg_temp.p4_id(1), :'man'::JSONB ->> 'work_item_id', :'cl_m'::JSONB ->> 'attempt_id',
  :'man'::JSONB ->> 'manual_send_authorization_id', 'succeeded', 'true_79967700065@c.us_AI277MANUAL00000001',
  clock_timestamp(), pg_temp.p4_wid(7003))) AS fin_m \gset
SELECT pg_temp.p4_staff(2, format('SELECT jsonb_agg(row_to_json(p)::JSONB) FROM platform.staff_whatsapp_message_page(%L, %L, 50) p',
  pg_temp.p4_id(1), pg_temp.p4_conv(65))) AS page_m \gset
SELECT pg_temp.p4_assert(:'fin_m'::JSONB ->> 'state' = 'succeeded'
  AND (SELECT e ->> 'origin' = 'crm' AND (e ->> 'sender_membership_id')::UUID = pg_temp.p4_id(302)
    FROM jsonb_array_elements(:'page_m'::JSONB) e WHERE e ->> 'direction' = 'outbound'),
  'a manual send still claims, finishes and reads back as «crm» with its author');
-- Maintenance: a scheduled send past send_at + 10 minutes and an abandoned considering row.
SELECT pg_temp.p4_in(66, 'P4 клиент J', 20) AS jj \gset
SELECT pg_temp.p4_sched(pg_temp.p4_conv(66), :'jj') AS d_jj \gset
UPDATE platform_private.ai_autosend_log SET send_at = clock_timestamp() - INTERVAL '11 minutes' WHERE id = :'d_jj';
UPDATE platform_private.ai_autosend_log SET created_at = clock_timestamp() - INTERVAL '11 minutes', lease_owner = NULL,
  lease_expires_at = NULL WHERE id = :'d_w2';
SELECT pg_temp.p4_agent('SELECT platform_ai_agent.maintenance_v1()') AS mnt \gset
SELECT pg_temp.p4_assert((:'mnt'::JSONB ->> 'autosendSendExpired')::INTEGER >= 1
  AND (pg_temp.p4_row(:'d_jj')).status = 'cancelled' AND (pg_temp.p4_row(:'d_jj')).reason_code = 'send_expired',
  'maintenance cancels sends never authorized within 10 minutes of send_at');

SELECT 'AI277_AI_AGENT_P4_SUITE_PASSED' AS ai277_suite_result;

ROLLBACK;
