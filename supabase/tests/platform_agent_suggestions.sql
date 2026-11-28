\set ON_ERROR_STOP on
-- Boundary suite for migration 383 «Предложение агента, которое принимает человек» (propose_next_step, agent_suggestion_*_v1,
-- case_handoff_note_v1). Runs on the real chain right after 383 inside one transaction that is rolled back. Synthetic data only;
-- no provider, no real person, no production action.
--
-- Proves:
--  1. propose_next_step: a pending suggestion; a repeat with the same data returns the first answer; a new proposal replaces the
--     old one (the old one becomes `expired`, exactly one `pending` per (case, kind));
--  2. a closed case is refused (conflict), a case of another organization is not found, a disabled agent is refused;
--  3. forbidden wording (a guarantee of a visa or admission, amounts of money) is `text_invalid`; wrong arguments are 22023;
--  4. «Принять» writes the step through set_case_next_action_v1 with the staff member's own version and right: a stale version is
--     a conflict (PT409) and the suggestion stays pending; a good one changes the step, the due date and the version, marks the
--     suggestion accepted, writes both journal rows, and a repeat of the same request replays the receipt without a second write;
--  5. «Не то»: dismissed with a short reason; an accepted or dismissed suggestion cannot be decided again; a member without the
--     route right and a member of another organization are refused (42501); a case closed after the proposal refuses «Принять»
--     and the suggestion stays pending;
--  6. the staff read shows only a pending suggestion that has not expired; the handoff note is the latest «Передача дела» note
--     of the case, other notes are ignored, another organization is refused;
--  7. the table itself is closed to authenticated and service_role.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A383_AGENT_SUGGESTIONS_SUITE_START

CREATE FUNCTION pg_temp.a383_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('38300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a383_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A383: %', message; END IF;
END
$$;
-- SQLSTATE:message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.a383_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The agent tool, called as the service role; the answer or {error, message}.
CREATE FUNCTION pg_temp.a383_propose(p_args JSONB, p_org INTEGER DEFAULT 1, p_agent TEXT DEFAULT 'curator-my') RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT; v_claims TEXT := current_setting('request.jwt.claims', TRUE);
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  SET LOCAL ROLE service_role;
  BEGIN
    result := platform.ai_agent_tool_propose_next_step_v1(pg_temp.a383_id(p_org), p_agent, p_args);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    result := jsonb_build_object('error', v_state, 'message', v_message);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), TRUE);
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.a383_args(p_case INTEGER, p_text TEXT, p_reason TEXT DEFAULT 'В деле нет скана загранпаспорта', p_due DATE DEFAULT NULL) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('case_id', pg_temp.a383_id(700 + p_case), 'text', p_text, 'reason', p_reason, 'due_on', p_due))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a383_id(INTEGER), pg_temp.a383_assert(BOOLEAN, TEXT), pg_temp.a383_error(TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixture. Org 1: 1 Admin, 2 Curator A (route right), 3 Curator B (read only), 4 Sales. Org 2: 5 Admin.
-- Cases (org 1): 701 active without a step (curator A), 702 closed, 703 active, 704 active (closed later), 705 active (second decline).
-- Case 706 belongs to org 2.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a383_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN, claims TEXT);
INSERT INTO a383_actors(n, org, coarse, sysadmin) VALUES (1, 1, 'admin', TRUE), (2, 1, 'curator', FALSE), (3, 1, 'curator', FALSE),
  (4, 1, 'sales', FALSE), (5, 2, 'admin', TRUE);
GRANT SELECT ON a383_actors TO authenticated;
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a383_id(1), 'A383 Fictional organization', 'active'), (pg_temp.a383_id(2), 'A383 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a383_id(100 + n), 'a383-' || n || '@example.invalid', '{}'::JSONB FROM a383_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a383_id(200 + n), pg_temp.a383_id(100 + n), 'A383 Actor ' || n, 'active', 1 FROM a383_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a383_id(300 + a.n), pg_temp.a383_id(a.org), pg_temp.a383_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1), a.sysadmin
  FROM a383_actors a;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a383_id(401), pg_temp.a383_id(1), 'organization', pg_temp.a383_id(1), 1),
  (pg_temp.a383_id(402), pg_temp.a383_id(2), 'organization', pg_temp.a383_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a383_id(1), pg_temp.a383_id(301), pg_temp.a383_id(401), 1, 1, TRUE, 'system', 'A383 synthetic organization scope', pg_temp.a383_id(601)),
  (pg_temp.a383_id(2), pg_temp.a383_id(305), pg_temp.a383_id(402), 1, 1, TRUE, 'system', 'A383 synthetic organization scope', pg_temp.a383_id(602));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a383_id(420 + k), pg_temp.a383_id(CASE WHEN k = 6 THEN 2 ELSE 1 END), 'student_case', pg_temp.a383_id(700 + k), 1
  FROM generate_series(1, 6) AS k;

SELECT platform_private.ai_agents_ensure_rows(pg_temp.a383_id(1));
SELECT platform_private.ai_agents_ensure_rows(pg_temp.a383_id(2));
UPDATE platform_private.ai_agents SET enabled = TRUE WHERE organization_id IN (pg_temp.a383_id(1), pg_temp.a383_id(2)) AND key = 'curator-my';
-- 'curator-eu' stays disabled.

SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id, source_key,
  student_display_name, target_country, target_degree, operational_stage, state, handoff_at, closed_at, current_scope_id,
  current_scope_version, admissions_direction, pipeline_stage, next_action, next_action_due_on)
SELECT pg_temp.a383_id(700 + f.k), pg_temp.a383_id(CASE WHEN f.k = 6 THEN 2 ELSE 1 END), pg_temp.a383_id(304),
  pg_temp.a383_id(CASE WHEN f.k = 6 THEN 305 ELSE 302 END), 'synthetic:a383:' || f.k, 'A383 Student ' || (700 + f.k), 'MY', 'Bachelor',
  'contract_confirmed', f.state::platform.student_case_state, clock_timestamp(),
  CASE WHEN f.state = 'closed' THEN clock_timestamp() END, pg_temp.a383_id(420 + f.k), 1, 'MY', 'new', f.step, NULL
FROM (VALUES (1, 'active', NULL), (2, 'closed', NULL), (3, 'active', 'Прежний шаг 703'), (4, 'active', NULL), (5, 'active', NULL),
  (6, 'active', NULL)) AS f(k, state, step);
SET LOCAL session_replication_role = origin;

-- Curator A: reads, routes and appends in its own scope (the cases it curates); curator B only reads. Roles through the installed commands.
CREATE TEMP TABLE a383_roles(role_id UUID, membership_id UUID, keys JSONB, request_base INTEGER);
INSERT INTO a383_roles VALUES
  (pg_temp.a383_id(801), pg_temp.a383_id(302), '["case.read.full","case.route.manage","case.update.append"]', 810),
  (pg_temp.a383_id(802), pg_temp.a383_id(303), '["case.read.full"]', 820);
GRANT SELECT ON a383_roles TO authenticated;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a383_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a383_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a383_admin_setup \gset
SET LOCAL request.jwt.claims TO :'a383_admin_setup';
SET LOCAL ROLE authenticated;
DO $a383_roles$
DECLARE r RECORD; published JSONB;
BEGIN
  FOR r IN SELECT * FROM a383_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.a383_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'A383 role ' || r.request_base, 'description', 'Migration 383 synthetic role', 'permissionKeys', r.keys),
      'A383 create role', pg_temp.a383_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.a383_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.a383_id(1), r.role_id, 1) ->> 'impactFingerprint', 'A383 publish role', pg_temp.a383_id(r.request_base + 2));
    PERFORM platform.staff_role_assignments_save(pg_temp.a383_id(1), r.membership_id, 1,
      jsonb_build_array(jsonb_build_object('roleId', r.role_id, 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
      jsonb_build_array(jsonb_build_object('roleId', r.role_id, 'roleVersion', 2, 'bundleId', (published ->> 'bundleId')::UUID, 'bundleVersion', 1)),
      'A383 grant role', pg_temp.a383_id(r.request_base + 3));
  END LOOP;
END
$a383_roles$;
RESET ROLE;
UPDATE a383_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a383_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.a383_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS a383_admin FROM a383_actors WHERE n = 1 \gset
SELECT claims AS a383_curator_a FROM a383_actors WHERE n = 2 \gset
SELECT claims AS a383_curator_b FROM a383_actors WHERE n = 3 \gset
SELECT claims AS a383_sales FROM a383_actors WHERE n = 4 \gset
SELECT claims AS a383_other_admin FROM a383_actors WHERE n = 5 \gset
SELECT pg_temp.a383_assert((SELECT count(*) = 5 FROM a383_actors WHERE claims::JSONB ->> 'platform_membership_id' = pg_temp.a383_id(300 + n)::TEXT),
  'staff claims resolve to their memberships');

-- ---------------------------------------------------------------------------
-- The wording filter itself.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Мы гарантируем визу', TRUE), 'guarantee is forbidden');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Студент точно поступит', TRUE), 'a sure admission is forbidden');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Попросить оплатить 500 USD', TRUE), 'an amount with a currency is forbidden');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Доплатить $500', TRUE), 'a currency sign is forbidden');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Внести 3 тыс сом', TRUE), 'thousands of som are forbidden');
SELECT pg_temp.a383_assert(NOT platform_private.agent_suggestion_text_forbidden('Запросить скан загранпаспорта и 3 фотографии', TRUE), 'an ordinary step passes');
SELECT pg_temp.a383_assert(NOT platform_private.agent_suggestion_text_forbidden('Подать 2 заявки до 5 декабря, сомнений нет', TRUE), 'numbers and Russian words do not trip the filter');
SELECT pg_temp.a383_assert(NOT platform_private.agent_suggestion_text_forbidden('Студент оплатил 500 USD', FALSE), 'a reason may mention money, only the text may not');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Гарантия визы', FALSE), 'a reason may not guarantee');
-- Promises in every form of the root, amounts in words, and no false alarms on short currency roots.
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Пообещать студенту место', TRUE), 'a promise (пообещать) is forbidden');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Мы обещаем помощь', FALSE), 'a promise (обещаем) is forbidden in a reason too');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Доплатить пять тысяч долларов', TRUE), 'thousands of dollars in words are forbidden');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Внести 2 миллиона сомов', TRUE), 'millions of som are forbidden');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Оплатить 50 рублей', TRUE), 'rubles are forbidden');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Заплатить 100 сом', TRUE), 'som are forbidden');
SELECT pg_temp.a383_assert(NOT platform_private.agent_suggestion_text_forbidden('Выбрать 3 европейских вуза', TRUE), '3 европейских вуза passes');
SELECT pg_temp.a383_assert(NOT platform_private.agent_suggestion_text_forbidden('Снять 2 сомнения студента', TRUE), '2 сомнения passes');
SELECT pg_temp.a383_assert(NOT platform_private.agent_suggestion_text_forbidden('Пройти 3 рубежа подготовки', TRUE), '3 рубежа passes');
SELECT pg_temp.a383_assert(NOT platform_private.agent_suggestion_text_forbidden('Подготовить 4 лирических текста', TRUE), '4 лирических passes');
SELECT pg_temp.a383_assert(NOT platform_private.agent_suggestion_text_forbidden('Позвонить в тысячелетний сомнительный рубеж', TRUE), 'a thousand-word followed by an ordinary word does not trip');
SELECT pg_temp.a383_assert(NOT platform_private.agent_suggestion_text_forbidden('Собрать миллион европейских справок', TRUE), 'миллион европейских passes');
SELECT pg_temp.a383_assert(NOT platform_private.agent_suggestion_text_forbidden('Заказать тысячу рубежных копий', TRUE), 'тысячу рубежных passes');
SELECT pg_temp.a383_assert(platform_private.agent_suggestion_text_forbidden('Доплатить тысяч сомов', TRUE), 'тысяч сомов is forbidden');

-- ---------------------------------------------------------------------------
-- 1. propose, repeat, replace.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a383_runs(label TEXT PRIMARY KEY, answer JSONB);
GRANT SELECT, INSERT ON a383_runs TO authenticated, service_role;
INSERT INTO a383_runs VALUES ('first', pg_temp.a383_propose(pg_temp.a383_args(1, 'Запросить у студента скан загранпаспорта', 'В деле нет паспорта', CURRENT_DATE + 3)));
SELECT pg_temp.a383_assert((SELECT answer ->> 'status' = 'pending' AND answer ->> 'suggestion_id' IS NOT NULL FROM a383_runs WHERE label = 'first'),
  'propose answers a pending suggestion: ' || (SELECT answer::TEXT FROM a383_runs WHERE label = 'first'));
SELECT pg_temp.a383_assert((SELECT count(*) = 1 FROM platform_private.agent_suggestions WHERE case_id = pg_temp.a383_id(701) AND status = 'pending'),
  'one pending suggestion');
SELECT pg_temp.a383_assert((SELECT s.text = 'Запросить у студента скан загранпаспорта' AND s.reason = 'В деле нет паспорта' AND s.agent_key = 'curator-my'
    AND s.kind = 'next_step' AND s.due_on = CURRENT_DATE + 3 AND s.expires_at > clock_timestamp() + INTERVAL '6 days 23 hours'
    AND s.expires_at < clock_timestamp() + INTERVAL '7 days 1 hour' AND s.decided_by_membership_id IS NULL
  FROM platform_private.agent_suggestions s WHERE s.id = (SELECT (answer ->> 'suggestion_id')::UUID FROM a383_runs WHERE label = 'first')),
  'the stored suggestion carries the text, the reason, the due date and a 7-day life');
-- The step of the case is not touched by a proposal.
SELECT pg_temp.a383_assert((SELECT next_action IS NULL AND admissions_version = 0 FROM platform.student_cases WHERE id = pg_temp.a383_id(701)),
  'a proposal does not change the case');
-- A repeat of the same data returns the first answer and no second row.
INSERT INTO a383_runs VALUES ('repeat', pg_temp.a383_propose(pg_temp.a383_args(1, 'Запросить у студента скан загранпаспорта', 'В деле нет паспорта', CURRENT_DATE + 3)));
SELECT pg_temp.a383_assert((SELECT a.answer = b.answer FROM a383_runs a, a383_runs b WHERE a.label = 'first' AND b.label = 'repeat'), 'a repeat returns the first answer');
SELECT pg_temp.a383_assert((SELECT count(*) = 1 FROM platform_private.agent_suggestions WHERE case_id = pg_temp.a383_id(701)), 'a repeat makes no second row');
-- A different proposal replaces the pending one.
INSERT INTO a383_runs VALUES ('second', pg_temp.a383_propose(pg_temp.a383_args(1, 'Записать студента на подготовку к экзамену', 'Нет даты экзамена')));
SELECT pg_temp.a383_assert((SELECT answer ->> 'status' = 'pending' FROM a383_runs WHERE label = 'second'), 'the second proposal is pending');
SELECT pg_temp.a383_assert((SELECT count(*) FILTER (WHERE status = 'pending') = 1 AND count(*) FILTER (WHERE status = 'expired') = 1 AND count(*) = 2
  FROM platform_private.agent_suggestions WHERE case_id = pg_temp.a383_id(701)), 'the new proposal expires the old one: one pending, one expired');
SELECT pg_temp.a383_assert((SELECT s.status = 'expired' FROM platform_private.agent_suggestions s
  WHERE s.id = (SELECT (answer ->> 'suggestion_id')::UUID FROM a383_runs WHERE label = 'first')), 'the first one is the expired one');
SELECT pg_temp.a383_assert((SELECT count(*) = 2 FROM platform.audit_events WHERE action = 'ai.agent.tool.write' AND resource_type = 'student_case'
  AND resource_id = pg_temp.a383_id(701) AND after_state ->> 'tool' = 'propose_next_step' AND actor_principal = 'ai-agent:curator-my'),
  'each new proposal is journaled once, the repeat is not');

-- ---------------------------------------------------------------------------
-- 2. refusals of the tool.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(2, 'Проверить документы'), 1) ->> 'message' = 'conflict', 'a closed case is refused (conflict)');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(6, 'Проверить документы'), 1) ->> 'error' = 'P0002', 'a case of another organization is not found');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(1, 'Проверить документы'), 2) ->> 'error' = 'P0002', 'the other organization cannot propose for our case');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(1, 'Проверить документы'), 1, 'curator-eu') ->> 'message' = 'agent_disabled', 'a disabled agent is refused');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(1, 'Проверить документы'), 1, 'no-such-agent') ->> 'error' = 'P0002', 'an unknown agent is not found');
SELECT pg_temp.a383_assert((SELECT count(*) = 0 FROM platform_private.agent_suggestions WHERE case_id IN (pg_temp.a383_id(702), pg_temp.a383_id(706))), 'refusals write nothing');

-- ---------------------------------------------------------------------------
-- 3. forbidden wording and wrong arguments.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(3, 'Гарантировать студенту визу')) ->> 'message' = 'text_invalid', 'a visa guarantee is text_invalid');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(3, 'Студент точно поступит, отправить письмо')) ->> 'message' = 'text_invalid', 'a sure admission is text_invalid');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(3, 'Попросить доплатить 500 USD')) ->> 'message' = 'text_invalid', 'an amount of money is text_invalid');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(3, 'Попросить доплатить $500')) ->> 'message' = 'text_invalid', 'a dollar sign is text_invalid');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(3, 'Позвонить студенту', 'Гарантия набора сорвана')) ->> 'message' = 'text_invalid', 'a guarantee in the reason is text_invalid');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(jsonb_build_object('case_id', pg_temp.a383_id(703), 'text', 'Позвонить студенту')) ->> 'error' = '22023', 'no reason is invalid_arguments');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(3, repeat('ы', 301))) ->> 'error' = '22023', '301 characters are invalid_arguments');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(3, 'Позвонить студенту') || '{"extra":1}') ->> 'error' = '22023', 'an unknown field is invalid_arguments');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(3, 'Позвонить студенту', 'Причина', CURRENT_DATE - 1)) ->> 'error' = '22023', 'a due date in the past is invalid_arguments');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(3, 'Позвонить студенту') || jsonb_build_object('assignee_id', pg_temp.a383_id(399))) ->> 'error' = 'P0002', 'an unknown assignee is not found');
SELECT pg_temp.a383_assert(pg_temp.a383_propose(pg_temp.a383_args(3, 'Позвонить студенту') || jsonb_build_object('assignee_id', pg_temp.a383_id(305))) ->> 'error' = 'P0002', 'a member of another organization cannot be the assignee');
SELECT pg_temp.a383_assert((SELECT count(*) = 0 FROM platform_private.agent_suggestions WHERE case_id = pg_temp.a383_id(703)), 'rejected proposals write nothing');
-- A multi-line text is one line.
INSERT INTO a383_runs VALUES ('multiline', pg_temp.a383_propose(pg_temp.a383_args(3, E'Позвонить студенту\nи уточнить дату')));
SELECT pg_temp.a383_assert((SELECT text = 'Позвонить студенту и уточнить дату' FROM platform_private.agent_suggestions
  WHERE id = (SELECT (answer ->> 'suggestion_id')::UUID FROM a383_runs WHERE label = 'multiline')), 'a multi-line step is stored as one line');

-- ---------------------------------------------------------------------------
-- 4. the table is closed.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error('SELECT count(*) FROM platform_private.agent_suggestions') LIKE '42501:%', 'authenticated cannot read the table');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.a383_assert(pg_temp.a383_error('SELECT count(*) FROM platform_private.agent_suggestions') LIKE '42501:%', 'service_role cannot read the table');
SELECT pg_temp.a383_assert(pg_temp.a383_error($q$SELECT platform.agent_suggestion_read_v1('38300000-0000-4000-8000-000000000001', '38300000-0000-4000-8000-000000000701')$q$) LIKE '42501:%',
  'service_role cannot call the staff read');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4b. the case as the server reads it for the agent buttons: the step-write right is required.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert((SELECT platform.agent_case_target_v1(pg_temp.a383_id(1), pg_temp.a383_id(701)) ->> 'target_country') = 'MY'
  AND (SELECT platform.agent_case_target_v1(pg_temp.a383_id(1), pg_temp.a383_id(701)) ->> 'state') = 'active'
  AND (SELECT platform.agent_case_target_v1(pg_temp.a383_id(1), pg_temp.a383_id(702)) ->> 'state') = 'closed', 'the target answers country, direction and state');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'a383_curator_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_case_target_v1(%L, %L)', pg_temp.a383_id(1), pg_temp.a383_id(701))) LIKE '42501:%',
  'a reader without the step-write right cannot start the agent');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'a383_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_case_target_v1(%L, %L)', pg_temp.a383_id(2), pg_temp.a383_id(701))) LIKE '42501:%',
  'another organization cannot read our case target');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. the staff read.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert((SELECT platform.agent_suggestion_read_v1(pg_temp.a383_id(1), pg_temp.a383_id(701)) ->> 'text') = 'Записать студента на подготовку к экзамену',
  'the staff read shows the pending suggestion, not the expired one');
SELECT pg_temp.a383_assert((SELECT platform.agent_suggestion_read_v1(pg_temp.a383_id(1), pg_temp.a383_id(701)) ->> 'agent_key') = 'curator-my'
  AND (SELECT platform.agent_suggestion_read_v1(pg_temp.a383_id(1), pg_temp.a383_id(701)) ->> 'agent_title') IS NOT NULL, 'the read names the agent');
SELECT pg_temp.a383_assert(platform.agent_suggestion_read_v1(pg_temp.a383_id(1), pg_temp.a383_id(704)) IS NULL, 'no suggestion is NULL');
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_read_v1(%L, %L)', pg_temp.a383_id(2), pg_temp.a383_id(701))) LIKE '42501:%',
  'the read refuses a foreign organization id');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'a383_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_read_v1(%L, %L)', pg_temp.a383_id(2), pg_temp.a383_id(701))) LIKE '42501:%',
  'another organization cannot read our case suggestion');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'a383_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_read_v1(%L, %L)', pg_temp.a383_id(1), pg_temp.a383_id(701))) LIKE '42501:%',
  'sales without the case right cannot read it');
RESET ROLE;
-- An expired-by-time suggestion is not shown.
UPDATE platform_private.agent_suggestions SET expires_at = clock_timestamp() - INTERVAL '1 minute'
  WHERE id = (SELECT (answer ->> 'suggestion_id')::UUID FROM a383_runs WHERE label = 'multiline');
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(platform.agent_suggestion_read_v1(pg_temp.a383_id(1), pg_temp.a383_id(703)) IS NULL, 'a suggestion past its 7 days is not shown');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6. «Принять»: stale version, good version, repeat, second decision.
-- ---------------------------------------------------------------------------
SELECT (answer ->> 'suggestion_id')::UUID AS a383_s1 FROM a383_runs WHERE label = 'second' \gset
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''accept'', 5, NULL, %L)',
  pg_temp.a383_id(1), :'a383_s1', pg_temp.a383_id(901))) LIKE 'PT409:%', 'a stale version is a conflict');
RESET ROLE;
SELECT pg_temp.a383_assert((SELECT status = 'pending' FROM platform_private.agent_suggestions WHERE id = :'a383_s1'), 'the suggestion stays pending after a conflict');
SELECT pg_temp.a383_assert((SELECT next_action IS NULL AND admissions_version = 0 FROM platform.student_cases WHERE id = pg_temp.a383_id(701)), 'the step is not written after a conflict');
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE a383_decisions(label TEXT PRIMARY KEY, answer JSONB);
GRANT SELECT, INSERT ON a383_decisions TO authenticated;
INSERT INTO a383_decisions VALUES ('accept', platform.agent_suggestion_decide_v1(pg_temp.a383_id(1), :'a383_s1', 'accept', 0, NULL, pg_temp.a383_id(902)));
RESET ROLE;
SELECT pg_temp.a383_assert((SELECT answer ->> 'status' = 'accepted' AND answer -> 'receipt' ->> 'admissions_version' = '1'
  AND answer -> 'receipt' ->> 'next_action' = 'Записать студента на подготовку к экзамену' AND answer ->> 'replayed' = 'false'
  FROM a383_decisions WHERE label = 'accept'), 'accept answers the receipt of the step write');
SELECT pg_temp.a383_assert((SELECT next_action = 'Записать студента на подготовку к экзамену' AND admissions_version = 1 AND next_action_due_on IS NULL
  FROM platform.student_cases WHERE id = pg_temp.a383_id(701)), 'accept wrote the step and bumped the case version');
SELECT pg_temp.a383_assert((SELECT status = 'accepted' AND decided_by_membership_id = pg_temp.a383_id(302) AND decided_at IS NOT NULL
  FROM platform_private.agent_suggestions WHERE id = :'a383_s1'), 'the suggestion is accepted by the curator');
SELECT pg_temp.a383_assert((SELECT count(*) = 1 FROM platform.audit_events WHERE action = 'case.next.action.change' AND resource_id = pg_temp.a383_id(701)
  AND actor_membership_id = pg_temp.a383_id(302)), 'the step write is journaled as the staff member');
SELECT pg_temp.a383_assert((SELECT count(*) = 1 FROM platform.audit_events WHERE action = 'ai.agent.draft.decide' AND resource_id = pg_temp.a383_id(701)
  AND actor_membership_id = pg_temp.a383_id(302) AND after_state ->> 'decision' = 'accept'), 'the decision is journaled as the staff member');
-- The same request again replays the receipt: no second write.
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
INSERT INTO a383_decisions VALUES ('replay', platform.agent_suggestion_decide_v1(pg_temp.a383_id(1), :'a383_s1', 'accept', 0, NULL, pg_temp.a383_id(902)));
RESET ROLE;
SELECT pg_temp.a383_assert((SELECT answer ->> 'replayed' = 'true' AND answer -> 'receipt' ->> 'admissions_version' = '1' FROM a383_decisions WHERE label = 'replay'), 'a repeat replays the receipt');
SELECT pg_temp.a383_assert((SELECT admissions_version = 1 FROM platform.student_cases WHERE id = pg_temp.a383_id(701)), 'a repeat does not write the step again');
-- Another request id on an accepted suggestion is refused and writes nothing; the stored request and receipt are kept.
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''accept'', 0, NULL, %L)',
  pg_temp.a383_id(1), :'a383_s1', pg_temp.a383_id(920))) LIKE '55000:agent_suggestion_not_pending', 'another request id on an accepted suggestion is not_pending');
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''accept'', 1, NULL, %L)',
  pg_temp.a383_id(1), :'a383_s1', pg_temp.a383_id(921))) LIKE '55000:agent_suggestion_not_pending', 'nor with the current version');
RESET ROLE;
SELECT pg_temp.a383_assert((SELECT admissions_version = 1 AND (SELECT count(*) FROM platform.audit_events WHERE action = 'case.next.action.change' AND resource_id = pg_temp.a383_id(701)) = 1
  FROM platform.student_cases WHERE id = pg_temp.a383_id(701)), 'no second step write');
SELECT pg_temp.a383_assert((SELECT accept_request_id = pg_temp.a383_id(902) AND accept_receipt ->> 'admissions_version' = '1' FROM platform_private.agent_suggestions WHERE id = :'a383_s1'),
  'the accept request id and the receipt are stored');
-- An accepted suggestion cannot be decided again (another request id, dismiss).
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''dismiss'', NULL, NULL, %L)',
  pg_temp.a383_id(1), :'a383_s1', pg_temp.a383_id(903))) LIKE '55000:agent_suggestion_not_pending', 'an accepted suggestion cannot be dismissed');
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''accept'', 1, NULL, %L)',
  pg_temp.a383_id(1), (SELECT (answer ->> 'suggestion_id')::UUID FROM a383_runs WHERE label = 'first'), pg_temp.a383_id(904))) LIKE '55000:agent_suggestion_not_pending',
  'an expired (replaced) suggestion cannot be accepted');
SELECT pg_temp.a383_assert(platform.agent_suggestion_read_v1(pg_temp.a383_id(1), pg_temp.a383_id(701)) IS NULL, 'after accepting there is no pending suggestion to show');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7. «Не то», rights.
-- ---------------------------------------------------------------------------
INSERT INTO a383_runs VALUES ('dismiss', pg_temp.a383_propose(pg_temp.a383_args(4, 'Проверить договор студента', 'Договор подписан неделю назад')));
SELECT (answer ->> 'suggestion_id')::UUID AS a383_s2 FROM a383_runs WHERE label = 'dismiss' \gset
-- Curator B reads but has no route right: refused, nothing changes.
SET LOCAL request.jwt.claims TO :'a383_curator_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''dismiss'', NULL, NULL, %L)',
  pg_temp.a383_id(1), :'a383_s2', pg_temp.a383_id(905))) LIKE '42501:%', 'a member without the route right cannot dismiss');
RESET ROLE;
SELECT pg_temp.a383_assert((SELECT status = 'pending' FROM platform_private.agent_suggestions WHERE id = :'a383_s2'), 'a refused dismiss changes nothing');
-- The other organization's admin is refused with the same code.
SET LOCAL request.jwt.claims TO :'a383_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''dismiss'', NULL, NULL, %L)',
  pg_temp.a383_id(2), :'a383_s2', pg_temp.a383_id(906))) LIKE '42501:%', 'another organization cannot dismiss');
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''dismiss'', NULL, NULL, %L)',
  pg_temp.a383_id(1), :'a383_s2', pg_temp.a383_id(907))) LIKE '42501:%', 'another organization cannot dismiss through our organization id either');
RESET ROLE;
-- Bad arguments.
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''maybe'', NULL, NULL, %L)',
  pg_temp.a383_id(1), :'a383_s2', pg_temp.a383_id(908))) LIKE '22023:%', 'an unknown decision is invalid');
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''accept'', NULL, NULL, %L)',
  pg_temp.a383_id(1), :'a383_s2', pg_temp.a383_id(909))) LIKE '22023:%', 'accept needs the case version');
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''dismiss'', NULL, %L, %L)',
  pg_temp.a383_id(1), :'a383_s2', repeat('я', 301), pg_temp.a383_id(910))) LIKE '22023:%', 'a reason over 300 characters is invalid');
-- Curator A dismisses with a reason.
INSERT INTO a383_decisions VALUES ('dismiss', platform.agent_suggestion_decide_v1(pg_temp.a383_id(1), :'a383_s2', 'dismiss', NULL, 'Уже сделано вчера', pg_temp.a383_id(911)));
SELECT pg_temp.a383_assert(platform.agent_suggestion_read_v1(pg_temp.a383_id(1), pg_temp.a383_id(704)) IS NULL, 'a dismissed suggestion is not shown');
RESET ROLE;
SELECT pg_temp.a383_assert((SELECT answer ->> 'status' = 'dismissed' AND answer -> 'receipt' IS NULL OR answer -> 'receipt' = 'null'::JSONB FROM a383_decisions WHERE label = 'dismiss'), 'dismiss answers dismissed');
SELECT pg_temp.a383_assert((SELECT status = 'dismissed' AND dismiss_reason = 'Уже сделано вчера' AND decided_by_membership_id = pg_temp.a383_id(302)
  FROM platform_private.agent_suggestions WHERE id = :'a383_s2'), 'the dismissed suggestion keeps the short reason');
SELECT pg_temp.a383_assert((SELECT next_action IS NULL AND admissions_version = 0 FROM platform.student_cases WHERE id = pg_temp.a383_id(704)), 'dismiss does not touch the case');
SELECT pg_temp.a383_assert((SELECT count(*) = 1 FROM platform.audit_events WHERE action = 'ai.agent.draft.decide' AND resource_id = pg_temp.a383_id(704)
  AND after_state ->> 'decision' = 'dismiss'), 'the dismissal is journaled');
-- A dismissal without a reason is fine, and a case closed after the proposal refuses «Принять».
INSERT INTO a383_runs VALUES ('closed_later', pg_temp.a383_propose(pg_temp.a383_args(5, 'Связаться с семьёй студента', 'Нет контакта родителей')));
SELECT (answer ->> 'suggestion_id')::UUID AS a383_s3 FROM a383_runs WHERE label = 'closed_later' \gset
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET state = 'closed', closed_at = clock_timestamp() WHERE id = pg_temp.a383_id(705);
SET LOCAL session_replication_role = origin;
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.agent_suggestion_decide_v1(%L, %L, ''accept'', 0, NULL, %L)',
  pg_temp.a383_id(1), :'a383_s3', pg_temp.a383_id(912))) LIKE '22023:case_next_action_case_not_active', 'a closed case refuses «Принять»');
RESET ROLE;
SELECT pg_temp.a383_assert((SELECT status = 'pending' FROM platform_private.agent_suggestions WHERE id = :'a383_s3'), 'the suggestion stays pending after a refusal');
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(platform.agent_suggestion_decide_v1(pg_temp.a383_id(1), :'a383_s3', 'dismiss', NULL, NULL, pg_temp.a383_id(913)) ->> 'status' = 'dismissed',
  'a dismissal without a reason works');
RESET ROLE;
SELECT pg_temp.a383_assert((SELECT dismiss_reason IS NULL FROM platform_private.agent_suggestions WHERE id = :'a383_s3'), 'no reason is stored as NULL');

-- ---------------------------------------------------------------------------
-- 8. the handoff note.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO platform.case_notes(organization_id, student_case_id, body, created_by_membership_id, created_at) VALUES
  (pg_temp.a383_id(1), pg_temp.a383_id(701), E'[ИИ «Куратор Малайзия»] Передача дела\nСтудент: Старый.', pg_temp.a383_id(301), clock_timestamp() - INTERVAL '2 hours'),
  (pg_temp.a383_id(1), pg_temp.a383_id(701), E'[ИИ «Куратор Малайзия»] Передача дела\nСтудент: Новый.\nДеньги: не сказано.', pg_temp.a383_id(301), clock_timestamp() - INTERVAL '1 hour'),
  (pg_temp.a383_id(1), pg_temp.a383_id(701), 'Обычная заметка куратора, не передача', pg_temp.a383_id(302), clock_timestamp()),
  (pg_temp.a383_id(1), pg_temp.a383_id(701), '[ИИ «Куратор Малайзия»] Передача дела сорвалась, записка про другое', pg_temp.a383_id(301), clock_timestamp()),
  (pg_temp.a383_id(1), pg_temp.a383_id(703), 'Заметка без передачи', pg_temp.a383_id(302), clock_timestamp());
SET LOCAL session_replication_role = origin;
SET LOCAL request.jwt.claims TO :'a383_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert((SELECT platform.case_handoff_note_v1(pg_temp.a383_id(1), pg_temp.a383_id(701)) ->> 'body') LIKE E'%Студент: Новый.%',
  'the handoff note is the latest «Передача дела» note');
SELECT pg_temp.a383_assert(platform.case_handoff_note_v1(pg_temp.a383_id(1), pg_temp.a383_id(703)) IS NULL, 'no handoff note is NULL');
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.case_handoff_note_v1(%L, %L)', pg_temp.a383_id(2), pg_temp.a383_id(701))) LIKE '42501:%',
  'the handoff note refuses a foreign organization id');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'a383_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.case_handoff_note_v1(%L, %L)', pg_temp.a383_id(2), pg_temp.a383_id(701))) LIKE '42501:%',
  'another organization cannot read our handoff note');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'a383_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a383_assert(pg_temp.a383_error(format('SELECT platform.case_handoff_note_v1(%L, %L)', pg_temp.a383_id(1), pg_temp.a383_id(701))) LIKE '42501:%',
  'sales without the case right cannot read the handoff note');
RESET ROLE;

SELECT 'A383_AGENT_SUGGESTIONS_SUITE_PASSED' AS a383_suite_marker;
ROLLBACK;
