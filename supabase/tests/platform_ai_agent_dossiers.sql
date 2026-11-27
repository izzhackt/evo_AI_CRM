\set ON_ERROR_STOP on
-- Boundary suite for migration 382 «Досье лида и дела одним вызовом для ИИ-агентов». Runs on the real chain right after 382 inside
-- one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. get_lead_dossier: the stage in WORDS (the raw key only in `keys`), the channel «откуда узнал» apart from the technical
--     source_key, masked contacts, the sale conditions labelled «до договора», the next action, tasks <= 5, notes <= 3, the last
--     15 WhatsApp messages oldest first, calls of 14 days without a recording, the link to the case;
--  2. a student who declined AI: no conversation (`ai_consent_missing`), not one word of the chat; the rest of the dossier stays;
--  3. get_case_dossier: process stage and board column as separate labelled fields with words; an empty next step is null; the
--     mismatch flag (true / false / null for a custom or closed stage); the timeline step is null with the keys the app needs;
--  4. money in three blocks that are never added: the lead's budget and the contract tranche each carry their label and currency,
--     the archived tranche is not summed, currencies are separate, the catalog block says «не долг клиента»;
--  5. applications: an intake with a stable id and a manual one, marked `intake_identity: missing`;
--  6. documents: no file, path, mime or version; the questionnaire is «со слов студента» without the phone;
--  7. the portal chat: 10 messages with consent, nothing without it;
--  8. another organization is not_found; a disabled agent is refused; wrong arguments are 22023; every read is audited;
--  9. the size ceiling on a huge lead and a huge case: the output stays under the ceiling, `truncated` is true, `omitted` names
--     what was dropped, `counts` keeps the full numbers.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A382_AI_AGENT_DOSSIERS_SUITE_START

CREATE FUNCTION pg_temp.a382_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('38100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a382_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A382: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a382_call(p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  SET LOCAL ROLE service_role;
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    result := jsonb_build_object('error', v_state, 'message', v_message);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.a382_lead(p_lead INTEGER, p_org INTEGER DEFAULT 1, p_agent TEXT DEFAULT 'sales') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a382_call(format('SELECT platform.ai_agent_tool_get_lead_dossier_v1(%L, %L, %L::jsonb)', pg_temp.a382_id(p_org), p_agent,
    format('{"lead_id":"%s"}', pg_temp.a382_id(p_lead))))
$$;
CREATE FUNCTION pg_temp.a382_case(p_case INTEGER, p_org INTEGER DEFAULT 1, p_agent TEXT DEFAULT 'curator-my') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a382_call(format('SELECT platform.ai_agent_tool_get_case_dossier_v1(%L, %L, %L::jsonb)', pg_temp.a382_id(p_org), p_agent,
    format('{"case_id":"%s"}', pg_temp.a382_id(p_case))))
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Org 1 (actors 1 Admin, 2 Curator, 3 Sales, 4 Student A with portal and consent, 5 Student B with portal and declined),
-- org 2 (actor 6 Admin).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a382_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a382_actors VALUES (1, 1, 'admin', TRUE), (2, 1, 'curator', FALSE), (3, 1, 'sales', FALSE), (4, 1, 'student', FALSE),
  (5, 1, 'student', FALSE), (6, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a382_id(1), 'A382 Fictional organization', 'active'), (pg_temp.a382_id(2), 'A382 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a382_id(100 + n), 'a382-' || n || '@example.invalid', '{}'::JSONB FROM a382_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a382_id(200 + n), pg_temp.a382_id(100 + n), 'A382 Actor ' || n, 'active', 1 FROM a382_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a382_id(300 + a.n), pg_temp.a382_id(a.org), pg_temp.a382_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1), a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a382_actors a;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a382_id(401), pg_temp.a382_id(1), 'organization', pg_temp.a382_id(1), 1),
  (pg_temp.a382_id(402), pg_temp.a382_id(2), 'organization', pg_temp.a382_id(2), 1);

SELECT platform_private.ai_agents_ensure_rows(pg_temp.a382_id(1));
SELECT platform_private.ai_agents_ensure_rows(pg_temp.a382_id(2));
UPDATE platform_private.ai_agents SET enabled = TRUE WHERE organization_id IN (pg_temp.a382_id(1), pg_temp.a382_id(2))
  AND key IN ('sales', 'curator-my');
-- 'curator-eu' stays disabled.

SET LOCAL session_replication_role = replica;

INSERT INTO platform_private.student_ai_consents (organization_id, auth_user_id, status, policy_version, source) VALUES
  (pg_temp.a382_id(1), pg_temp.a382_id(104), 'granted', platform_private.student_ai_consent_policy_version(), 'portal_web'),
  (pg_temp.a382_id(1), pg_temp.a382_id(105), 'declined', platform_private.student_ai_consent_policy_version(), 'portal_web');

INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, phone, email) VALUES
  (pg_temp.a382_id(501), pg_temp.a382_id(1), 'А382 Тестов Клиент', 'а382 тестов клиент', '+996 700 000 056', 'a382-client@example.invalid'),
  (pg_temp.a382_id(502), pg_temp.a382_id(1), 'А382 Отказавшая Студентка', 'а382 отказавшая студентка', '+996 700 000 057', NULL),
  (pg_temp.a382_id(503), pg_temp.a382_id(1), 'А382 Большой Клиент', 'а382 большой клиент', '+996 700 000 058', NULL),
  (pg_temp.a382_id(504), pg_temp.a382_id(1), 'А382 Без Чата', 'а382 без чата', NULL, NULL),
  (pg_temp.a382_id(505), pg_temp.a382_id(2), 'А382 Чужой Клиент', 'а382 чужой клиент', NULL, NULL);

INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state, created_at, updated_at,
  next_action_text, next_action_due_date, interest_direction) VALUES
  (pg_temp.a382_id(601), pg_temp.a382_id(1), pg_temp.a382_id(501), pg_temp.a382_id(303), 'qualified', 'whatsapp', 'open',
    TIMESTAMPTZ '2026-11-01 10:00:00+00', TIMESTAMPTZ '2026-11-20 10:00:00+00', 'Перезвонить вечером', DATE '2026-12-01', 'MY'),
  (pg_temp.a382_id(602), pg_temp.a382_id(1), pg_temp.a382_id(502), pg_temp.a382_id(303), 'contacting', 'whatsapp', 'open',
    TIMESTAMPTZ '2026-11-02 10:00:00+00', TIMESTAMPTZ '2026-11-20 10:00:00+00', NULL, NULL, 'CN'),
  (pg_temp.a382_id(603), pg_temp.a382_id(1), pg_temp.a382_id(503), pg_temp.a382_id(303), 'new', 'website', 'open',
    TIMESTAMPTZ '2026-11-03 10:00:00+00', TIMESTAMPTZ '2026-11-20 10:00:00+00', rtrim(repeat('Очень длинное следующее действие. ', 14)), DATE '2026-12-05', 'EU'),
  (pg_temp.a382_id(604), pg_temp.a382_id(1), pg_temp.a382_id(504), NULL, 'new', 'manual', 'disqualified',
    TIMESTAMPTZ '2026-11-04 10:00:00+00', TIMESTAMPTZ '2026-11-20 10:00:00+00', NULL, NULL, NULL),
  (pg_temp.a382_id(605), pg_temp.a382_id(2), pg_temp.a382_id(505), NULL, 'new', 'whatsapp', 'open',
    TIMESTAMPTZ '2026-11-05 10:00:00+00', TIMESTAMPTZ '2026-11-20 10:00:00+00', NULL, NULL, 'MY');

-- The channel of lead 601: a tagged paid Instagram visit (the word, the basis «по метке»; the technical source_key stays «whatsapp»).
INSERT INTO platform_private.lead_attribution_touches (organization_id, lead_id, touch_kind, evidence, utm_source, utm_medium, request_id)
VALUES (pg_temp.a382_id(1), pg_temp.a382_id(601), 'website_form', 'utm_tagged', 'instagram', 'cpc', pg_temp.a382_id(1601));

-- Sale conditions of lead 601: the client's budget (a wish) and the planned service cost, both in USD but with different numbers.
INSERT INTO platform_private.lead_sale_conditions (lead_id, organization_id, fields, updated_by_membership_id) VALUES
  (pg_temp.a382_id(601), pg_temp.a382_id(1), jsonb_build_object('service_label', 'Пакет сопровождения', 'service_cost_minor', 120000,
    'service_cost_currency', 'USD', 'conditions_budget_minor', 500000, 'conditions_budget_currency', 'USD', 'conditions_budget_period', 'year',
    'wishes_countries', 'Малайзия, Китай', 'wishes_intake_season', 'осень', 'wishes_intake_year', '2027', 'signing_date', '2026-11-10'),
    pg_temp.a382_id(303));

-- Notes, tasks and calls of lead 601.
INSERT INTO platform.case_notes (organization_id, lead_id, body, created_by_membership_id, created_at)
  SELECT pg_temp.a382_id(1), pg_temp.a382_id(601), 'Заметка лида ' || n || ' ' || rtrim(repeat('текст ', 80)), pg_temp.a382_id(303),
    TIMESTAMPTZ '2026-11-10 10:00:00+00' + n * INTERVAL '1 day' FROM generate_series(1, 5) n;
INSERT INTO platform.staff_tasks (id, organization_id, creator_membership_id, assignee_membership_id, title, status, priority, due_on, created_at)
  SELECT pg_temp.a382_id(1000 + n), pg_temp.a382_id(1), pg_temp.a382_id(303), pg_temp.a382_id(303), 'Задача лида ' || n,
    CASE WHEN n = 8 THEN 'done' ELSE 'open' END::platform.case_task_status, 'normal', DATE '2026-12-03',
    TIMESTAMPTZ '2026-11-12 10:00:00+00' + n * INTERVAL '1 hour' FROM generate_series(1, 8) n;
INSERT INTO platform_private.staff_lead_task_links (request_id, organization_id, actor_membership_id, staff_task_id, lead_id, input, result)
  SELECT pg_temp.a382_id(1100 + n), pg_temp.a382_id(1), pg_temp.a382_id(303), pg_temp.a382_id(1000 + n), pg_temp.a382_id(601), '{}'::JSONB, '{}'::JSONB
  FROM generate_series(1, 8) n;
INSERT INTO platform_private.telephony_calls (id, organization_id, pbx_callid, direction, started_at, created_via, lead_id, client_id, match_state)
  SELECT pg_temp.a382_id(1200 + n), pg_temp.a382_id(1), 'a382-call-' || n, 'in', clock_timestamp() - n * INTERVAL '3 days', 'webhook',
    pg_temp.a382_id(601), pg_temp.a382_id(501), 'matched' FROM generate_series(1, 6) n;
-- 3 days, 6, 9, 12 are inside 14 days; 15 and 18 are outside: count = 4.

-- Conversations: 901 of lead 601 (20 messages), 902 of lead 602 (the student declined), 903 of lead 603 (huge).
INSERT INTO platform.communication_conversations (id, organization_id, responsible_sales_membership_id, queue, subject, current_scope_id,
  current_scope_version, created_from_webhook_event_id, canonical_lead_id, canonical_client_id, created_at, sales_authority_source, waha_session_name) VALUES
  (pg_temp.a382_id(901), pg_temp.a382_id(1), pg_temp.a382_id(303), 'sales', 'A382 chat 1', pg_temp.a382_id(401), 1, pg_temp.a382_id(1901),
    pg_temp.a382_id(601), pg_temp.a382_id(501), TIMESTAMPTZ '2026-11-01 10:00:00+00', 'platform_intake', 'crm_primary'),
  (pg_temp.a382_id(902), pg_temp.a382_id(1), pg_temp.a382_id(303), 'sales', 'A382 chat 2', pg_temp.a382_id(401), 1, pg_temp.a382_id(1902),
    pg_temp.a382_id(602), pg_temp.a382_id(502), TIMESTAMPTZ '2026-11-02 10:00:00+00', 'platform_intake', 'crm_primary'),
  (pg_temp.a382_id(903), pg_temp.a382_id(1), pg_temp.a382_id(303), 'sales', 'A382 chat 3', pg_temp.a382_id(401), 1, pg_temp.a382_id(1903),
    pg_temp.a382_id(603), pg_temp.a382_id(503), TIMESTAMPTZ '2026-11-03 10:00:00+00', 'platform_intake', 'crm_primary');
INSERT INTO platform.communication_messages (id, organization_id, conversation_id, sender_participant_id, direction, body_text, language,
  source_webhook_event_id, created_at, message_identity_source)
  SELECT pg_temp.a382_id(2000 + n), pg_temp.a382_id(1), pg_temp.a382_id(901), pg_temp.a382_id(1950),
    CASE WHEN n % 2 = 1 THEN 'inbound' ELSE 'outbound' END::platform.communication_direction,
    'Сообщение номер ' || n, 'ru', pg_temp.a382_id(1901), TIMESTAMPTZ '2026-11-15 10:00:00+00' + n * INTERVAL '1 minute', 'private_waha_history_binding'
  FROM generate_series(1, 20) n;
INSERT INTO platform.communication_messages (id, organization_id, conversation_id, sender_participant_id, direction, body_text, language,
  source_webhook_event_id, created_at, message_identity_source) VALUES
  (pg_temp.a382_id(2100), pg_temp.a382_id(1), pg_temp.a382_id(902), pg_temp.a382_id(1950), 'inbound', 'секретная фраза декларации', 'ru',
    pg_temp.a382_id(1902), TIMESTAMPTZ '2026-11-15 11:00:00+00', 'private_waha_history_binding');
INSERT INTO platform.communication_messages (id, organization_id, conversation_id, sender_participant_id, direction, body_text, language,
  source_webhook_event_id, created_at, message_identity_source)
  SELECT pg_temp.a382_id(2200 + n), pg_temp.a382_id(1), pg_temp.a382_id(903), pg_temp.a382_id(1950), 'inbound',
    'Большое сообщение ' || n || ' ' || rtrim(repeat('слово ', 300)), 'ru', pg_temp.a382_id(1903), TIMESTAMPTZ '2026-11-15 12:00:00+00' + n * INTERVAL '1 minute', 'private_waha_history_binding'
  FROM generate_series(1, 40) n;

-- The huge lead 603: long notes and tasks.
INSERT INTO platform.case_notes (organization_id, lead_id, body, created_by_membership_id, created_at)
  SELECT pg_temp.a382_id(1), pg_temp.a382_id(603), 'Большая заметка ' || n || ' ' || rtrim(repeat('слово ', 600)), pg_temp.a382_id(303),
    TIMESTAMPTZ '2026-11-10 10:00:00+00' + n * INTERVAL '1 day' FROM generate_series(1, 8) n;
INSERT INTO platform.staff_tasks (id, organization_id, creator_membership_id, assignee_membership_id, title, status, priority, due_on, created_at)
  SELECT pg_temp.a382_id(3000 + n), pg_temp.a382_id(1), pg_temp.a382_id(303), pg_temp.a382_id(303), 'Большая задача ' || n || ' ' || rtrim(repeat('слово ', 90)),
    'open', 'normal', DATE '2026-12-03', TIMESTAMPTZ '2026-11-12 10:00:00+00' + n * INTERVAL '1 hour' FROM generate_series(1, 9) n;
INSERT INTO platform_private.staff_lead_task_links (request_id, organization_id, actor_membership_id, staff_task_id, lead_id, input, result)
  SELECT pg_temp.a382_id(3100 + n), pg_temp.a382_id(1), pg_temp.a382_id(303), pg_temp.a382_id(3000 + n), pg_temp.a382_id(603), '{}'::JSONB, '{}'::JSONB
  FROM generate_series(1, 9) n;
INSERT INTO platform_private.lead_sale_conditions (lead_id, organization_id, fields, updated_by_membership_id) VALUES
  (pg_temp.a382_id(603), pg_temp.a382_id(1), jsonb_build_object('service_label', rtrim(repeat('Услуга ', 60)), 'wishes_countries', rtrim(repeat('Страна ', 60)),
    'wishes_study_fields', rtrim(repeat('Поле ', 80)), 'wishes_universities', rtrim(repeat('Вуз ', 400)), 'payment_note', rtrim(repeat('Заметка ', 80))),
    pg_temp.a382_id(303));

-- Student cases (org 1): 701 documents/documents (a portal student with consent; the lead 601's case), 702 documents/ready_to_submit
-- (mismatch, no portal), 703 custom process stage, 704 the student who declined (lead 602), 705 the huge case, 706 closed process, org 2: 707.
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at, intake,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, portal_activated_at, public_application_id, next_action,
  next_action_due_on, canonical_client_id, canonical_lead_id, created_at, updated_at)
VALUES
  (pg_temp.a382_id(701), pg_temp.a382_id(1), pg_temp.a382_id(304), pg_temp.a382_id(303), pg_temp.a382_id(302), 'a382-case-701', 'А382 Студент Один',
    'Malaysia', 'bachelor', 'MY', 'documents', 'active', clock_timestamp(), 'Осень 2027', pg_temp.a382_id(401), 1, 'MY', 'documents', clock_timestamp(),
    pg_temp.a382_id(801), NULL, NULL, pg_temp.a382_id(501), pg_temp.a382_id(601), clock_timestamp(), clock_timestamp()),
  (pg_temp.a382_id(702), pg_temp.a382_id(1), NULL, pg_temp.a382_id(303), pg_temp.a382_id(302), 'a382-case-702', 'А382 Студент Два',
    'CN', 'master', 'CN', 'documents', 'active', clock_timestamp(), NULL, pg_temp.a382_id(401), 1, 'CN', 'ready_to_submit', NULL,
    NULL, 'Запросить справку', DATE '2026-12-10', NULL, NULL, clock_timestamp(), clock_timestamp()),
  (pg_temp.a382_id(703), pg_temp.a382_id(1), NULL, pg_temp.a382_id(303), pg_temp.a382_id(302), 'a382-case-703', 'А382 Студент Три',
    'Atlantis', 'bachelor', 'MY', 'my_special_stage', 'active', clock_timestamp(), NULL, pg_temp.a382_id(401), 1, 'MY', 'new', NULL,
    NULL, NULL, NULL, NULL, NULL, clock_timestamp(), clock_timestamp()),
  (pg_temp.a382_id(704), pg_temp.a382_id(1), pg_temp.a382_id(305), pg_temp.a382_id(303), pg_temp.a382_id(302), 'a382-case-704', 'А382 Студентка Отказ',
    'China', 'bachelor', 'CN', 'documents', 'active', clock_timestamp(), NULL, pg_temp.a382_id(401), 1, 'CN', 'documents', clock_timestamp(),
    NULL, NULL, NULL, pg_temp.a382_id(502), pg_temp.a382_id(602), clock_timestamp(), clock_timestamp()),
  (pg_temp.a382_id(705), pg_temp.a382_id(1), NULL, pg_temp.a382_id(303), pg_temp.a382_id(302), 'a382-case-705', 'А382 Студент Огромный',
    'MY', 'bachelor', 'MY', 'applications', 'active', clock_timestamp(), NULL, pg_temp.a382_id(401), 1, 'MY', 'ready_to_submit', NULL,
    NULL, rtrim(repeat('Длинный следующий шаг. ', 30)), DATE '2026-12-12', NULL, NULL, clock_timestamp(), clock_timestamp()),
  (pg_temp.a382_id(706), pg_temp.a382_id(1), NULL, pg_temp.a382_id(303), pg_temp.a382_id(302), 'a382-case-706', 'А382 Студент Закрыт',
    'MY', 'bachelor', 'MY', 'closed', 'active', clock_timestamp(), NULL, pg_temp.a382_id(401), 1, 'MY', 'documents', NULL,
    NULL, NULL, NULL, NULL, NULL, clock_timestamp(), clock_timestamp()),
  (pg_temp.a382_id(707), pg_temp.a382_id(2), NULL, pg_temp.a382_id(306), pg_temp.a382_id(306), 'a382-case-707', 'А382 Чужой Студент',
    'MY', 'bachelor', 'MY', 'documents', 'active', clock_timestamp(), NULL, pg_temp.a382_id(402), 1, 'MY', 'documents', NULL,
    NULL, NULL, NULL, NULL, NULL, clock_timestamp(), clock_timestamp());

-- Questionnaire of case 701 with a phone that must never reach the agent.
INSERT INTO platform_private.student_applications (id, organization_id, auth_user_id, normalized_email, questionnaire, status, revision,
  submitted_at, decided_at, decided_by_membership_id, decision_reason, student_case_id) VALUES
  (pg_temp.a382_id(801), pg_temp.a382_id(1), pg_temp.a382_id(104), 'a382-4@example.invalid', jsonb_build_object('schemaVersion', 1,
    'requestId', pg_temp.a382_id(802), 'firstName', 'Тест', 'lastName', 'Тестова', 'nationality', 'KG', 'studyLevels', jsonb_build_array('bachelor'), 'phone', '+996 700 000 111', 'destinationCountries', jsonb_build_array('MY'),
    'intakeSeason', 'autumn', 'intakeYear', 2027, 'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5',
    'studyFields', jsonb_build_array('Информационные технологии'), 'english', jsonb_build_object('mode', 'self', 'level', 'intermediate'),
    'tuitionBudget', '5000_10000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', '2026-09-18'),
    'approved', 2, TIMESTAMPTZ '2026-10-01 10:00:00+00', TIMESTAMPTZ '2026-10-02 10:00:00+00', pg_temp.a382_id(301),
    'A382 synthetic approval', pg_temp.a382_id(701));

-- Documents of case 701 (custom slots; a file version id only where the status needs one).
INSERT INTO platform.document_slots (id, organization_id, student_case_id, status, created_by_membership_id, display_label, group_label,
  intent_kind, deadline, current_version_id, current_version_no, created_at)
VALUES
  (pg_temp.a382_id(1301), pg_temp.a382_id(1), pg_temp.a382_id(701), 'approved', pg_temp.a382_id(302), 'Паспорт', 'Личные', 'custom', NULL,
    pg_temp.a382_id(1401), 1, TIMESTAMPTZ '2026-11-01 10:00:00+00'),
  (pg_temp.a382_id(1302), pg_temp.a382_id(1), pg_temp.a382_id(701), 'correction_required', pg_temp.a382_id(302), 'Аттестат', 'Учёба', 'custom',
    TIMESTAMPTZ '2026-12-20 00:00:00+00', pg_temp.a382_id(1402), 1, TIMESTAMPTZ '2026-11-02 10:00:00+00'),
  (pg_temp.a382_id(1303), pg_temp.a382_id(1), pg_temp.a382_id(701), 'required', pg_temp.a382_id(302), 'Фото', 'Личные', 'custom', NULL,
    NULL, NULL, TIMESTAMPTZ '2026-11-03 10:00:00+00'),
  (pg_temp.a382_id(1304), pg_temp.a382_id(1), pg_temp.a382_id(701), 'submitted', pg_temp.a382_id(302), 'Справка', 'Учёба', 'custom', NULL,
    pg_temp.a382_id(1404), 1, TIMESTAMPTZ '2026-11-04 10:00:00+00');

-- Applications of case 701: two manual ones (intake without an id) and one bound to a catalog intake with a stable id.
-- The catalogue content validator is not under test here: it is dropped for this rolled-back transaction only, so a minimal
-- publication with one program and one intake id can stand in for the real one.
ALTER TABLE platform_private.university_catalog_publications DROP CONSTRAINT university_catalog_publications_content_check;
INSERT INTO platform_private.university_catalog_publications (id, organization_id, institution_id, base_version, version, content, source_registry_id,
  status, reason, created_by_membership_id, reviewed_at, reviewed_by_membership_id) VALUES
  (pg_temp.a382_id(1500), pg_temp.a382_id(1), pg_temp.a382_id(1501), 0, 1, jsonb_build_object('name', 'A382 University', 'country', 'MY',
    'programs', jsonb_build_array(jsonb_build_object('id', 'cs-bsc', 'title', 'A382 Computer Science', 'level', 'bachelor',
      'intakes', jsonb_build_array(jsonb_build_object('id', pg_temp.a382_id(1502)::TEXT, 'label', 'Осень 2027'))))),
    pg_temp.a382_id(1503), 'published', 'A382 synthetic publication', pg_temp.a382_id(301), clock_timestamp(), pg_temp.a382_id(301));
INSERT INTO platform.university_applications (id, organization_id, student_case_id, institution_name, program_name, status, created_by_membership_id,
  is_primary, university_deadline_on, created_at) VALUES
  (pg_temp.a382_id(1601), pg_temp.a382_id(1), pg_temp.a382_id(701), 'A382 University', 'A382 Computer Science', 'preparation', pg_temp.a382_id(302),
    TRUE, DATE '2027-03-01', TIMESTAMPTZ '2026-11-05 10:00:00+00'),
  (pg_temp.a382_id(1602), pg_temp.a382_id(1), pg_temp.a382_id(701), 'A382 Manual University', 'A382 Manual Programme', 'ready', pg_temp.a382_id(302),
    FALSE, NULL, TIMESTAMPTZ '2026-11-06 10:00:00+00');
INSERT INTO platform_private.catalog_preparation_bindings (organization_id, student_case_id, application_id, institution_id, publication_id,
  program_id, intake_id, selected_at, deadline_state_at_selection) VALUES
  (pg_temp.a382_id(1), pg_temp.a382_id(701), pg_temp.a382_id(1601), pg_temp.a382_id(1501), pg_temp.a382_id(1500), 'cs-bsc',
    pg_temp.a382_id(1502), TIMESTAMPTZ '2026-11-05 10:00:00+00', 'confirmed');

-- Money of case 701 (contract block): O1 1000.00 USD overdue, 400.00 paid; O2 50000.00 KGS in the future; O3 777.00 USD ARCHIVED (never summed).
INSERT INTO platform.payment_obligations (id, organization_id, student_case_id, label, category, amount_minor, currency, due_at, next_action,
  total_paid_minor, total_refunded_minor, created_by_membership_id, archived_at, created_at) VALUES
  (pg_temp.a382_id(1701), pg_temp.a382_id(1), pg_temp.a382_id(701), 'Первый транш', 'evo_service_fee', 100000, 'USD',
    clock_timestamp() - INTERVAL '10 days', 'Напомнить', 40000, 0, pg_temp.a382_id(302), NULL, TIMESTAMPTZ '2026-11-05 10:00:00+00'),
  (pg_temp.a382_id(1702), pg_temp.a382_id(1), pg_temp.a382_id(701), 'Второй транш', 'evo_service_fee', 5000000, 'KGS',
    clock_timestamp() + INTERVAL '20 days', 'Ждать', 0, 0, pg_temp.a382_id(302), NULL, TIMESTAMPTZ '2026-11-06 10:00:00+00'),
  (pg_temp.a382_id(1703), pg_temp.a382_id(1), pg_temp.a382_id(701), 'Ошибочный транш', 'evo_service_fee', 77700, 'USD',
    clock_timestamp() - INTERVAL '5 days', 'Нет', 0, 0, pg_temp.a382_id(302), clock_timestamp() - INTERVAL '1 day', TIMESTAMPTZ '2026-11-07 10:00:00+00');
INSERT INTO platform.payment_events (id, organization_id, student_case_id, payment_obligation_id, event_type, amount_minor, currency, occurred_at,
  source_key, actor_membership_id, request_id) VALUES
  (pg_temp.a382_id(1801), pg_temp.a382_id(1), pg_temp.a382_id(701), pg_temp.a382_id(1701), 'payment', 40000, 'USD',
    TIMESTAMPTZ '2026-11-20 10:00:00+00', 'a382', pg_temp.a382_id(302), pg_temp.a382_id(1802));

-- Tasks, notes and the portal chat of case 701.
INSERT INTO platform.case_tasks (id, organization_id, student_case_id, task_type, title, assignee_membership_id, created_by_membership_id, status,
  priority, due_on, created_at) VALUES
  (pg_temp.a382_id(1901), pg_temp.a382_id(1), pg_temp.a382_id(701), 'manual', 'Проверить аттестат', pg_temp.a382_id(302), pg_temp.a382_id(302),
    'open', 'normal', DATE '2026-11-01', TIMESTAMPTZ '2026-11-10 10:00:00+00'),
  (pg_temp.a382_id(1902), pg_temp.a382_id(1), pg_temp.a382_id(701), 'manual', 'Позвонить родителям', pg_temp.a382_id(302), pg_temp.a382_id(302),
    'in_progress', 'high', DATE '2027-01-15', TIMESTAMPTZ '2026-11-11 10:00:00+00'),
  (pg_temp.a382_id(1903), pg_temp.a382_id(1), pg_temp.a382_id(701), 'manual', 'Закрытая задача', pg_temp.a382_id(302), pg_temp.a382_id(302),
    'done', 'low', NULL, TIMESTAMPTZ '2026-11-12 10:00:00+00');
INSERT INTO platform.case_notes (organization_id, student_case_id, body, created_by_membership_id, created_at)
  SELECT pg_temp.a382_id(1), pg_temp.a382_id(701), 'Заметка дела ' || n || ' ' || rtrim(repeat('текст ', 80)), pg_temp.a382_id(302),
    TIMESTAMPTZ '2026-11-10 10:00:00+00' + n * INTERVAL '1 day' FROM generate_series(1, 5) n;
INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, author_membership_id, body, created_at)
  SELECT pg_temp.a382_id(2300 + n), pg_temp.a382_id(1), pg_temp.a382_id(701), CASE WHEN n % 2 = 1 THEN pg_temp.a382_id(304) ELSE pg_temp.a382_id(302) END,
    'Реплика чата ' || n, TIMESTAMPTZ '2026-11-15 10:00:00+00' + n * INTERVAL '1 minute' FROM generate_series(1, 12) n;
-- Chat of the student who declined.
INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, author_membership_id, body, created_at) VALUES
  (pg_temp.a382_id(2400), pg_temp.a382_id(1), pg_temp.a382_id(704), pg_temp.a382_id(305), 'тайная реплика кабинета', TIMESTAMPTZ '2026-11-15 10:00:00+00');

-- The huge case 705.
INSERT INTO platform.document_slots (id, organization_id, student_case_id, status, created_by_membership_id, display_label, group_label, intent_kind,
  deadline, created_at)
  SELECT pg_temp.a382_id(4000 + n), pg_temp.a382_id(1), pg_temp.a382_id(705), 'required', pg_temp.a382_id(302),
    'Документ ' || n || ' ' || rtrim(repeat('название ', 40)), 'Группа', 'custom', TIMESTAMPTZ '2026-12-20 00:00:00+00' + n * INTERVAL '1 day',
    TIMESTAMPTZ '2026-11-01 10:00:00+00' + n * INTERVAL '1 minute' FROM generate_series(1, 120) n;
INSERT INTO platform.university_applications (id, organization_id, student_case_id, institution_name, program_name, status, created_by_membership_id,
  is_primary, created_at)
  SELECT pg_temp.a382_id(4200 + n), pg_temp.a382_id(1), pg_temp.a382_id(705), 'Университет ' || n || ' ' || rtrim(repeat('имя ', 40)),
    'Программа ' || n || ' ' || rtrim(repeat('название ', 40)), 'preparation', pg_temp.a382_id(302), FALSE,
    TIMESTAMPTZ '2026-11-01 10:00:00+00' + n * INTERVAL '1 minute' FROM generate_series(1, 40) n;
INSERT INTO platform.case_tasks (id, organization_id, student_case_id, task_type, title, assignee_membership_id, created_by_membership_id, status,
  priority, due_on, created_at)
  SELECT pg_temp.a382_id(4300 + n), pg_temp.a382_id(1), pg_temp.a382_id(705), 'manual', 'Задача ' || n || ' ' || rtrim(repeat('слово ', 80)),
    pg_temp.a382_id(302), pg_temp.a382_id(302), 'open', 'normal', DATE '2026-12-01' + n, TIMESTAMPTZ '2026-11-10 10:00:00+00' + n * INTERVAL '1 minute'
  FROM generate_series(1, 60) n;
INSERT INTO platform.case_notes (organization_id, student_case_id, body, created_by_membership_id, created_at)
  SELECT pg_temp.a382_id(1), pg_temp.a382_id(705), 'Большая заметка ' || n || ' ' || rtrim(repeat('слово ', 500)), pg_temp.a382_id(302),
    TIMESTAMPTZ '2026-11-10 10:00:00+00' + n * INTERVAL '1 day' FROM generate_series(1, 10) n;
INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, author_membership_id, body, created_at)
  SELECT pg_temp.a382_id(4400 + n), pg_temp.a382_id(1), pg_temp.a382_id(705), pg_temp.a382_id(302), 'Большая реплика ' || n || ' ' || rtrim(repeat('слово ', 250)),
    TIMESTAMPTZ '2026-11-15 10:00:00+00' + n * INTERVAL '1 minute' FROM generate_series(1, 40) n;
INSERT INTO platform.payment_obligations (id, organization_id, student_case_id, label, category, amount_minor, currency, due_at, next_action,
  total_paid_minor, total_refunded_minor, created_by_membership_id, created_at)
  SELECT pg_temp.a382_id(4500 + n), pg_temp.a382_id(1), pg_temp.a382_id(705), 'Транш ' || n || ' ' || rtrim(repeat('имя ', 40)), 'evo_service_fee',
    100000 + n, CASE WHEN n % 2 = 0 THEN 'USD' ELSE 'KGS' END, clock_timestamp() + n * INTERVAL '1 day', 'Ждать', 0, 0, pg_temp.a382_id(302),
    TIMESTAMPTZ '2026-11-10 10:00:00+00' + n * INTERVAL '1 minute' FROM generate_series(1, 14) n;

-- Wazzup rules of 325: message 17 of chat 901 was deleted by the client; the chat 904 of lead 606 has an undetermined client.
INSERT INTO platform_private.wazzup_message_bindings (organization_id, channel_id, wazzup_message_id, communication_message_id,
  source_webhook_event_id, kind, sender_deleted_at) VALUES
  (pg_temp.a382_id(1), pg_temp.a382_id(1960), 'a382-wazzup-17', pg_temp.a382_id(2017), pg_temp.a382_id(1901), 'inbound', clock_timestamp());
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name) VALUES
  (pg_temp.a382_id(506), pg_temp.a382_id(1), 'А382 Неразрешённый Клиент', 'а382 неразрешённый клиент');
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state, created_at, updated_at)
  VALUES (pg_temp.a382_id(606), pg_temp.a382_id(1), pg_temp.a382_id(506), pg_temp.a382_id(303), 'new', 'whatsapp', 'open',
    TIMESTAMPTZ '2026-11-06 10:00:00+00', TIMESTAMPTZ '2026-11-20 10:00:00+00');
INSERT INTO platform.communication_conversations (id, organization_id, responsible_sales_membership_id, queue, subject, current_scope_id,
  current_scope_version, created_from_webhook_event_id, canonical_lead_id, canonical_client_id, created_at, sales_authority_source, waha_session_name)
  VALUES (pg_temp.a382_id(904), pg_temp.a382_id(1), pg_temp.a382_id(303), 'sales', 'A382 chat 4', pg_temp.a382_id(401), 1, pg_temp.a382_id(1904),
    pg_temp.a382_id(606), pg_temp.a382_id(506), TIMESTAMPTZ '2026-11-06 10:00:00+00', 'platform_intake', 'crm_primary');
INSERT INTO platform.communication_messages (id, organization_id, conversation_id, sender_participant_id, direction, body_text, language,
  source_webhook_event_id, created_at, message_identity_source) VALUES
  (pg_temp.a382_id(2500), pg_temp.a382_id(1), pg_temp.a382_id(904), pg_temp.a382_id(1950), 'inbound', 'тайна неразрешённой беседы', 'ru',
    pg_temp.a382_id(1904), TIMESTAMPTZ '2026-11-15 13:00:00+00', 'private_waha_history_binding');
INSERT INTO platform_private.wazzup_chat_bindings (organization_id, channel_id, chat_digits, conversation_id, source_webhook_event_id, identity_state)
  VALUES (pg_temp.a382_id(1), pg_temp.a382_id(1960), '996700000099', pg_temp.a382_id(904), pg_temp.a382_id(1904), 'ambiguous');

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 1. The lead dossier.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a382_lead(601) AS a382_l1 \gset
SELECT pg_temp.a382_assert(NOT (:'a382_l1'::JSONB ? 'error'), 'the lead dossier is returned: ' || :'a382_l1');
SELECT pg_temp.a382_assert(:'a382_l1'::JSONB #>> '{lead,sales_stage}' = 'Квалифицирован' AND :'a382_l1'::JSONB #>> '{keys,sales_stage}' = 'qualified',
  'the stage is a word; the key lives only in keys');
SELECT pg_temp.a382_assert(NOT ((:'a382_l1'::JSONB - 'keys')::TEXT LIKE '%"qualified"%') AND NOT ((:'a382_l1'::JSONB - 'keys')::TEXT LIKE '%"whatsapp"%'),
  'raw keys (stage, source) are absent outside keys');
SELECT pg_temp.a382_assert(:'a382_l1'::JSONB #>> '{channel,channel}' = 'Instagram — реклама' AND :'a382_l1'::JSONB #>> '{channel,basis}' = 'по метке'
    AND :'a382_l1'::JSONB #>> '{keys,source_key}' = 'whatsapp', 'the channel «откуда узнал» is apart from the technical source_key');
SELECT pg_temp.a382_assert(:'a382_l1'::JSONB #>> '{lead,name}' = 'А382 Тестов Клиент' AND :'a382_l1'::JSONB #>> '{lead,phone_masked}' LIKE '+996%**%56'
    AND :'a382_l1'::JSONB #>> '{lead,email_masked}' LIKE 'a***@%', 'the contact is masked: ' || (:'a382_l1'::JSONB #>> '{lead,phone_masked}'));
SELECT pg_temp.a382_assert(NOT (:'a382_l1'::TEXT LIKE '%700000056%') AND NOT (:'a382_l1'::TEXT LIKE '%700 000 056%') AND NOT (:'a382_l1'::TEXT LIKE '%a382-client@%'), 'no full phone or e-mail');
SELECT pg_temp.a382_assert(:'a382_l1'::JSONB #>> '{sale_conditions,label}' LIKE 'До договора%'
    AND :'a382_l1'::JSONB #>> '{sale_conditions,client_budget,amount}' = '5000.00' AND :'a382_l1'::JSONB #>> '{sale_conditions,client_budget,currency}' = 'USD'
    AND :'a382_l1'::JSONB #>> '{sale_conditions,client_budget,per}' = 'год'
    AND :'a382_l1'::JSONB #>> '{sale_conditions,planned_service_cost,amount}' = '1200.00',
  'the sale conditions are labelled «до договора», the budget and the planned cost are separate with their currency');
SELECT pg_temp.a382_assert(:'a382_l1'::JSONB #>> '{next_action,text}' = 'Перезвонить вечером' AND :'a382_l1'::JSONB #>> '{next_action,due_on}' = '2026-12-01',
  'the next action and its date');
SELECT pg_temp.a382_assert(jsonb_array_length(:'a382_l1'::JSONB -> 'open_tasks') = 5 AND (:'a382_l1'::JSONB #>> '{counts,open_tasks}')::INTEGER = 7
    AND (:'a382_l1'::JSONB #>> '{omitted,open_tasks}')::INTEGER = 2 AND (:'a382_l1'::JSONB ->> 'truncated')::BOOLEAN,
  'open tasks: at most 5 shown, the full count 7, 2 omitted, truncated says so');
SELECT pg_temp.a382_assert(jsonb_array_length(:'a382_l1'::JSONB -> 'notes') = 3 AND (:'a382_l1'::JSONB #>> '{counts,notes}')::INTEGER = 5
    AND char_length(:'a382_l1'::JSONB #>> '{notes,0,text}') = 303 AND :'a382_l1'::JSONB #>> '{notes,0,text}' LIKE '%[…]', 'notes: 3 shown, cut with the mark');
SELECT pg_temp.a382_assert(:'a382_l1'::JSONB #>> '{conversation,messages,0,text}' = 'Сообщение номер 6'
    AND :'a382_l1'::JSONB #>> '{conversation,messages,14,text}' = 'Сообщение номер 20' AND (:'a382_l1'::JSONB #>> '{conversation,messages_total}')::INTEGER = 20
    AND jsonb_array_length(:'a382_l1'::JSONB #> '{conversation,messages}') = 15, 'messages 6..20 in time order: ' || (:'a382_l1'::JSONB #>> '{conversation,messages,0,text}'));
SELECT pg_temp.a382_assert((:'a382_l1'::JSONB #>> '{calls,count}')::INTEGER = 4 AND NOT (:'a382_l1'::JSONB -> 'calls' ? 'recording_state'),
  'calls of 14 days: 4, no recording: ' || (:'a382_l1'::JSONB ->> 'calls'));
SELECT pg_temp.a382_assert(:'a382_l1'::JSONB #>> '{case,case_id}' = pg_temp.a382_id(701)::TEXT AND :'a382_l1'::JSONB #>> '{case,process_stage}' = 'сбор документов',
  'the link to the case with its stage in words');
SELECT pg_temp.a382_assert(char_length(:'a382_l1'::TEXT) <= 6000, 'the lead dossier is within the ceiling: ' || char_length(:'a382_l1'::TEXT));

-- 2. A student who declined: no conversation, not one word of the chat; the rest stays.
SELECT pg_temp.a382_lead(602) AS a382_l2 \gset
SELECT pg_temp.a382_assert(NOT (:'a382_l2'::JSONB ? 'error') AND (:'a382_l2'::JSONB #>> '{conversation,available}')::BOOLEAN = FALSE
    AND :'a382_l2'::JSONB #>> '{conversation,reason}' = 'ai_consent_missing' AND NOT (:'a382_l2'::JSONB -> 'conversation' ? 'messages')
    AND NOT (:'a382_l2'::TEXT LIKE '%секретная фраза%') AND NOT (:'a382_l2'::TEXT LIKE '%' || pg_temp.a382_id(902)::TEXT || '%'),
  'consent declined: no conversation, no text, no chat id');
SELECT pg_temp.a382_assert(:'a382_l2'::JSONB #>> '{lead,sales_stage}' = 'Связались' AND :'a382_l2'::JSONB #>> '{channel,channel}' = 'Не известно'
    AND :'a382_l2'::JSONB -> 'sale_conditions' ->> 'filled' = 'false' AND :'a382_l2'::JSONB -> 'next_action' = 'null'::JSONB,
  'the rest of the dossier is still there (stage word, unknown channel, no conditions, no next action)');
-- Without a chat at all, and a closed lead.
SELECT pg_temp.a382_lead(604) AS a382_l4 \gset
SELECT pg_temp.a382_assert(:'a382_l4'::JSONB #>> '{conversation,reason}' = 'no_conversation' AND :'a382_l4'::JSONB #>> '{lead,sales_stage}' = 'Закрыт'
    AND :'a382_l4'::JSONB #>> '{keys,lifecycle}' = 'disqualified' AND NOT (:'a382_l4'::JSONB -> 'lead' ? 'outcome') AND :'a382_l4'::JSONB #>> '{calls,count}' = '0', 'no chat: no_conversation; a closed lead says «Закрыт»');

-- ---------------------------------------------------------------------------
-- 3. The case dossier: three stages.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a382_case(701) AS a382_k1 \gset
SELECT pg_temp.a382_assert(NOT (:'a382_k1'::JSONB ? 'error'), 'the case dossier is returned: ' || :'a382_k1');
SELECT pg_temp.a382_assert(:'a382_k1'::JSONB #>> '{process_stage,word}' = 'сбор документов' AND :'a382_k1'::JSONB #>> '{board_column,word}' = 'Документы'
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'a382_k1'::JSONB -> 'process_stage') k) = ARRAY['label', 'word']
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'a382_k1'::JSONB -> 'board_column') k) = ARRAY['label', 'word']
    AND :'a382_k1'::JSONB #>> '{process_stage,label}' <> :'a382_k1'::JSONB #>> '{board_column,label}',
  'process stage and board column are two separate labelled fields with words');
SELECT pg_temp.a382_assert(:'a382_k1'::JSONB ? 'timeline_step' AND :'a382_k1'::JSONB -> 'timeline_step' = 'null'::JSONB
    AND :'a382_k1'::JSONB #>> '{keys,country_code}' = 'MY' AND :'a382_k1'::JSONB #>> '{keys,operational_stage}' = 'documents'
    AND :'a382_k1'::JSONB #>> '{keys,pipeline_stage}' = 'documents', 'the timeline step is null in SQL (the app fills it) and the keys it needs are there');
SELECT pg_temp.a382_assert((:'a382_k1'::JSONB ->> 'stage_mismatch')::BOOLEAN = FALSE AND :'a382_k1'::JSONB -> 'stage_mismatch_note' = 'null'::JSONB,
  'a consistent pair: stage_mismatch false');
SELECT pg_temp.a382_assert(:'a382_k1'::JSONB -> 'next_step' = 'null'::JSONB, 'no next action is null');
SELECT pg_temp.a382_assert(:'a382_k1'::JSONB #>> '{case,country,name}' = 'Малайзия' AND :'a382_k1'::JSONB #>> '{case,curator_name}' = 'A382 Actor 2'
    AND :'a382_k1'::JSONB #>> '{case,direction}' = 'Малайзия' AND :'a382_k1'::JSONB #>> '{case,state}' = 'в работе'
    AND :'a382_k1'::JSONB #>> '{case,degree}' = 'Бакалавриат', 'country, curator, direction, degree, state in words');
SELECT pg_temp.a382_case(702) AS a382_k2 \gset
SELECT pg_temp.a382_assert((:'a382_k2'::JSONB ->> 'stage_mismatch')::BOOLEAN AND :'a382_k2'::JSONB ->> 'stage_mismatch_note' LIKE '%сбор документов%Готовы к подаче%'
    AND :'a382_k2'::JSONB #>> '{next_step,text}' = 'Запросить справку' AND :'a382_k2'::JSONB #>> '{next_step,due_on}' = '2026-12-10'
    AND :'a382_k2'::JSONB #>> '{keys,country_code}' = 'CN', 'documents vs «Готовы к подаче»: stage_mismatch true with the note; the next step with its date');
SELECT pg_temp.a382_assert((:'a382_k2'::JSONB #>> '{portal_chat,available}')::BOOLEAN,
  'a student without a portal account is not blocked (320)');
SELECT pg_temp.a382_case(703) AS a382_k3 \gset
SELECT pg_temp.a382_assert(:'a382_k3'::JSONB #>> '{process_stage,word}' = 'индивидуальный этап сопровождения' AND :'a382_k3'::JSONB -> 'stage_mismatch' = 'null'::JSONB
    AND :'a382_k3'::JSONB #> '{keys,country_code}' = 'null'::JSONB AND :'a382_k3'::JSONB #>> '{case,country,name}' = 'Atlantis',
  'a custom stage and a country outside the six: the neutral word, no comparison, no country code');
SELECT pg_temp.a382_case(706) AS a382_k6 \gset
SELECT pg_temp.a382_assert(:'a382_k6'::JSONB -> 'stage_mismatch' = 'null'::JSONB AND :'a382_k6'::JSONB #>> '{process_stage,word}' = 'дело закрыто',
  'a closed process is not compared');

-- 4. Money in three blocks that are never added.
SELECT pg_temp.a382_assert(:'a382_k1'::JSONB #>> '{money,sale_conditions,client_budget,amount}' = '5000.00'
    AND :'a382_k1'::JSONB #>> '{money,sale_conditions,label}' LIKE 'До договора%'
    AND :'a382_k1'::JSONB #>> '{money,sale_conditions,planned_service_cost,amount}' = '1200.00', 'money.sale_conditions: the budget and the plan, labelled');
SELECT pg_temp.a382_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(:'a382_k1'::JSONB #> '{money,contract,totals_by_currency}') t
      WHERE t ->> 'currency' = 'USD' AND t ->> 'planned' = '1000.00' AND t ->> 'paid_net' = '400.00' AND t ->> 'open' = '600.00' AND t ->> 'overdue' = '600.00')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'a382_k1'::JSONB #> '{money,contract,totals_by_currency}') t
      WHERE t ->> 'currency' = 'KGS' AND t ->> 'planned' = '50000.00' AND t ->> 'overdue' = '0.00')
    AND jsonb_array_length(:'a382_k1'::JSONB #> '{money,contract,totals_by_currency}') = 2,
  'money.contract: a total per currency, the archived 777.00 USD is not in the USD planned total: ' || (:'a382_k1'::JSONB #>> '{money,contract,totals_by_currency}'));
SELECT pg_temp.a382_assert((:'a382_k1'::JSONB #>> '{money,contract,archived_excluded}')::INTEGER = 1 AND (:'a382_k1'::JSONB #>> '{money,contract,obligations_total}')::INTEGER = 2
    AND NOT (:'a382_k1'::JSONB #>> '{money,contract,obligations}' LIKE '%Ошибочный транш%') AND (:'a382_k1'::JSONB #>> '{money,contract,overdue_count}')::INTEGER = 1,
  'the archived tranche is counted as excluded and never listed');
SELECT pg_temp.a382_assert(:'a382_k1'::JSONB #>> '{money,contract,obligations,0,status}' = 'просрочено' AND :'a382_k1'::JSONB #>> '{money,contract,last_payments,0,amount}' = '400.00'
    AND :'a382_k1'::JSONB #>> '{money,contract,last_payments,0,kind}' = 'Оплачено', 'the overdue tranche first; the last payment (words of the schedule)');
SELECT pg_temp.a382_assert(:'a382_k1'::JSONB #>> '{money,catalog,note}' = 'не долг клиента' AND NOT (:'a382_k1'::JSONB -> 'money' ? 'total')
    AND NOT (:'a382_k1'::JSONB -> 'money' ? 'sum') AND :'a382_k1'::JSONB #>> '{money,rule}' LIKE 'Три блока не складывать%', 'the catalog block and no grand total');

-- 5. Applications.
SELECT pg_temp.a382_assert(jsonb_array_length(:'a382_k1'::JSONB -> 'applications') = 2
    AND (SELECT a ->> 'intake_identity' FROM jsonb_array_elements(:'a382_k1'::JSONB -> 'applications') a WHERE a ->> 'university' = 'A382 University') = 'stable'
    AND (SELECT a ->> 'intake_label' FROM jsonb_array_elements(:'a382_k1'::JSONB -> 'applications') a WHERE a ->> 'university' = 'A382 University') = 'Осень 2027'
    AND (SELECT a ->> 'intake_identity' FROM jsonb_array_elements(:'a382_k1'::JSONB -> 'applications') a WHERE a ->> 'university' = 'A382 Manual University') = 'missing'
    AND (SELECT a ->> 'intake_label' FROM jsonb_array_elements(:'a382_k1'::JSONB -> 'applications') a WHERE a ->> 'university' = 'A382 Manual University') = 'Осень 2027'
    AND (SELECT a ->> 'status' FROM jsonb_array_elements(:'a382_k1'::JSONB -> 'applications') a WHERE a ->> 'university' = 'A382 Manual University') = 'готова к подаче',
  'an intake with a stable id and a manual one marked missing (the case text as its label)');

-- 6. Documents and the questionnaire.
SELECT pg_temp.a382_assert(jsonb_array_length(:'a382_k1'::JSONB #> '{documents,slots}') = 4
    AND :'a382_k1'::JSONB #>> '{documents,slots,0,name}' = 'Аттестат' AND :'a382_k1'::JSONB #>> '{documents,slots,0,status}' = 'Нужно исправить'
    AND :'a382_k1'::JSONB #>> '{documents,slots,0,deadline}' = '2026-12-20' AND :'a382_k1'::JSONB #>> '{documents,slots,3,status}' = 'Принят'
    AND (:'a382_k1'::JSONB #>> '{documents,counts,approved}')::INTEGER = 1 AND (:'a382_k1'::JSONB #>> '{documents,counts,not_uploaded}')::INTEGER = 1
    AND :'a382_k1'::JSONB #>> '{documents,slots,0,slot_id}' = pg_temp.a382_id(1302)::TEXT,
  'document slots: what needs action first, words for statuses, ids for the next write');
SELECT pg_temp.a382_assert(NOT (:'a382_k1'::TEXT ~* '(storage|bucket|mime|byte_size|version_id|latest_version|object_name)')
    AND NOT (:'a382_k1'::TEXT LIKE '%' || pg_temp.a382_id(1402)::TEXT || '%'), 'no file path, mime, size or version in the dossier');
SELECT pg_temp.a382_assert(:'a382_k1'::JSONB #>> '{questionnaire,self_reported}' = 'true' AND :'a382_k1'::JSONB #>> '{questionnaire,source}' LIKE 'со слов студента%'
    AND :'a382_k1'::JSONB #>> '{questionnaire,answers,intake_year}' = '2027' AND :'a382_k1'::JSONB #>> '{questionnaire,answers,intake_season}' = 'Осень'
    AND :'a382_k1'::JSONB #>> '{questionnaire,answers,funding_source}' = 'Семья' AND :'a382_k1'::JSONB #>> '{questionnaire,answers,study_levels,0}' = 'Бакалавриат'
    AND :'a382_k1'::JSONB #>> '{questionnaire,answers,destination_countries,0}' = 'Малайзия' AND NOT (:'a382_k1'::TEXT LIKE '%700 000 111%')
    AND NOT (:'a382_k1'::JSONB -> 'questionnaire' -> 'answers' ?| ARRAY['phone', 'requestId', 'consent', 'firstName']),
  'the questionnaire is «со слов студента», selected answers only, no phone');

-- 7. The portal chat and the consent.
SELECT pg_temp.a382_assert((:'a382_k1'::JSONB #>> '{portal_chat,available}')::BOOLEAN AND jsonb_array_length(:'a382_k1'::JSONB #> '{portal_chat,messages}') = 10
    AND (:'a382_k1'::JSONB #>> '{portal_chat,messages_total}')::INTEGER = 12 AND :'a382_k1'::JSONB #>> '{portal_chat,messages,0,text}' = 'Реплика чата 3'
    AND :'a382_k1'::JSONB #>> '{portal_chat,messages,9,text}' = 'Реплика чата 12' AND :'a382_k1'::JSONB #>> '{portal_chat,messages,0,author}' = 'student',
  'the last 10 cabinet chat messages with consent, oldest first');
SELECT pg_temp.a382_case(704) AS a382_k4 \gset
SELECT pg_temp.a382_assert(NOT (:'a382_k4'::JSONB ? 'error') AND (:'a382_k4'::JSONB #>> '{portal_chat,available}')::BOOLEAN = FALSE
    AND :'a382_k4'::JSONB #>> '{portal_chat,reason}' = 'ai_consent_missing' AND NOT (:'a382_k4'::TEXT LIKE '%тайная реплика%'),
  'consent declined: no cabinet chat, the rest of the case dossier is returned');
SELECT pg_temp.a382_assert(:'a382_k4'::JSONB #>> '{lead,lead_id}' = pg_temp.a382_id(602)::TEXT AND :'a382_k4'::JSONB #>> '{lead,channel}' = 'Не известно',
  'the short lead source of the case');
SELECT pg_temp.a382_assert(:'a382_k1'::JSONB #>> '{lead,lead_id}' = pg_temp.a382_id(601)::TEXT AND :'a382_k1'::JSONB #>> '{lead,channel}' = 'Instagram — реклама'
    AND :'a382_k1'::JSONB #>> '{lead,sales_stage}' = 'Квалифицирован', 'the short lead source of case 701');

-- Tasks and notes.
SELECT pg_temp.a382_assert(jsonb_array_length(:'a382_k1'::JSONB -> 'open_tasks') = 2 AND :'a382_k1'::JSONB #>> '{open_tasks,0,title}' = 'Проверить аттестат'
    AND (:'a382_k1'::JSONB #>> '{open_tasks,0,overdue}')::BOOLEAN AND NOT (:'a382_k1'::JSONB #>> '{open_tasks,1,overdue}')::BOOLEAN
    AND (:'a382_k1'::JSONB #>> '{open_tasks,1,important}')::BOOLEAN AND NOT (:'a382_k1'::JSONB #>> '{open_tasks,0,important}')::BOOLEAN
    AND jsonb_array_length(:'a382_k1'::JSONB -> 'notes') = 3 AND (:'a382_k1'::JSONB #>> '{counts,notes}')::INTEGER = 5
    AND char_length(:'a382_k1'::JSONB #>> '{notes,0,text}') = 243, 'open tasks (the done one is absent, overdue marked) and 3 notes cut');

-- 8. Foreign organization, disabled agent, wrong arguments, audit, ceiling of normal dossiers.
SELECT pg_temp.a382_assert(pg_temp.a382_lead(601, 2) ->> 'error' = 'P0002' AND pg_temp.a382_case(701, 2) ->> 'error' = 'P0002'
    AND pg_temp.a382_lead(605, 1) ->> 'error' = 'P0002' AND pg_temp.a382_case(707, 1) ->> 'error' = 'P0002',
  'another organization: not_found both ways');
SELECT pg_temp.a382_assert(pg_temp.a382_lead(601, 1, 'curator-eu') ->> 'error' = '55000' AND pg_temp.a382_case(701, 1, 'curator-eu') ->> 'error' = '55000',
  'a disabled agent is refused');
SELECT pg_temp.a382_assert(pg_temp.a382_call(format('SELECT platform.ai_agent_tool_get_lead_dossier_v1(%L, %L, %L::jsonb)', pg_temp.a382_id(1), 'sales', '{}'))
      ->> 'error' = '22023'
    AND pg_temp.a382_call(format('SELECT platform.ai_agent_tool_get_case_dossier_v1(%L, %L, %L::jsonb)', pg_temp.a382_id(1), 'curator-my',
      '{"case_id":"not-a-uuid"}')) ->> 'error' = '22023'
    AND pg_temp.a382_call(format('SELECT platform.ai_agent_tool_get_case_dossier_v1(%L, %L, %L::jsonb)', pg_temp.a382_id(1), 'curator-my',
      format('{"case_id":"%s","surprise":1}', pg_temp.a382_id(701)))) ->> 'error' = '22023', 'wrong arguments are 22023');
SELECT pg_temp.a382_assert((SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.a382_id(1) AND e.resource_type = 'lead'
      AND e.resource_id = pg_temp.a382_id(601) AND e.action = 'ai.agent.tool.read') >= 1
    AND (SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.a382_id(1) AND e.resource_type = 'student_case'
      AND e.resource_id = pg_temp.a382_id(701) AND e.action = 'ai.agent.tool.read') >= 1, 'every dossier read is audited');
SELECT pg_temp.a382_assert((SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.a382_id(1)
      AND e.resource_id = pg_temp.a382_id(707)) = 0 AND (SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.a382_id(2)) = 0,
  'a refused read writes no audit row');
SELECT pg_temp.a382_assert(char_length(:'a382_k1'::TEXT) <= 11500, 'a normal case fits the ceiling: ' || char_length(:'a382_k1'::TEXT));

-- 9. The ceiling on a huge lead and a huge case.
SELECT pg_temp.a382_lead(603) AS a382_l3 \gset
SELECT pg_temp.a382_assert(NOT (:'a382_l3'::JSONB ? 'error') AND char_length(:'a382_l3'::TEXT) <= 6000 AND (:'a382_l3'::JSONB ->> 'truncated')::BOOLEAN
    AND (:'a382_l3'::JSONB #>> '{counts,notes}')::INTEGER = 8 AND (:'a382_l3'::JSONB #>> '{counts,open_tasks}')::INTEGER = 9
    AND (:'a382_l3'::JSONB #>> '{conversation,messages_total}')::INTEGER = 40 AND (:'a382_l3'::JSONB -> 'omitted' ? 'messages'),
  'a huge lead: under 6000 characters (' || char_length(:'a382_l3'::TEXT) || '), truncated, the full counts, the omitted messages named');
SELECT pg_temp.a382_case(705) AS a382_k5 \gset
SELECT pg_temp.a382_assert(NOT (:'a382_k5'::JSONB ? 'error') AND char_length(:'a382_k5'::TEXT) <= 11500 AND (:'a382_k5'::JSONB ->> 'truncated')::BOOLEAN
    AND (:'a382_k5'::JSONB #>> '{counts,documents}')::INTEGER = 120 AND (:'a382_k5'::JSONB #>> '{counts,applications}')::INTEGER = 40
    AND (:'a382_k5'::JSONB #>> '{omitted,documents}')::INTEGER > 0 AND (:'a382_k5'::JSONB #>> '{counts,open_tasks}')::INTEGER = 60
    AND (:'a382_k5'::JSONB #>> '{counts,notes}')::INTEGER = 10,
  'a huge case: under 11500 characters (' || char_length(:'a382_k5'::TEXT) || '), truncated, the full counts, the omitted named');
SELECT pg_temp.a382_assert(:'a382_k5'::JSONB #>> '{process_stage,word}' = 'подача заявок в университеты' AND :'a382_k5'::JSONB #>> '{board_column,word}' = 'Готовы к подаче'
    AND (:'a382_k5'::JSONB ->> 'stage_mismatch')::BOOLEAN = FALSE AND :'a382_k5'::JSONB #>> '{money,catalog,note}' = 'не долг клиента'
    AND jsonb_array_length(:'a382_k5'::JSONB #> '{money,contract,totals_by_currency}') = 2, 'a trimmed dossier keeps the stages and the three money blocks');


-- ---------------------------------------------------------------------------
-- 10. The rules of 325 in the lead's chat; honest `truncated`; one dictionary for money; priority without a word; the emergency form.
-- ---------------------------------------------------------------------------
-- A message the client deleted: no text, no media, `deleted: true`; the others are intact; the answer never holds the deleted text.
SELECT pg_temp.a382_assert((SELECT m ->> 'deleted' = 'true' AND NOT (m ? 'text') AND NOT (m ? 'media')
      FROM jsonb_array_elements(:'a382_l1'::JSONB #> '{conversation,messages}') m WHERE m ->> 'at' = '2026-11-15T10:17:00+00:00')
    AND (SELECT count(*) FROM jsonb_array_elements(:'a382_l1'::JSONB #> '{conversation,messages}') m WHERE m ? 'deleted') = 1
    AND NOT (:'a382_l1'::TEXT LIKE '%Сообщение номер 17%') AND :'a382_l1'::JSONB #>> '{conversation,messages,13,text}' = 'Сообщение номер 19',
  'a message deleted by the client is only a mark');
-- The conversation with an undetermined client is closed as a whole (before the consent check).
SELECT pg_temp.a382_lead(606) AS a382_l6 \gset
SELECT pg_temp.a382_assert(NOT (:'a382_l6'::JSONB ? 'error') AND (:'a382_l6'::JSONB #>> '{conversation,available}')::BOOLEAN = FALSE
    AND :'a382_l6'::JSONB #>> '{conversation,reason}' = 'identity_unresolved' AND NOT (:'a382_l6'::TEXT LIKE '%тайна неразрешённой%')
    AND NOT (:'a382_l6'::TEXT LIKE '%' || pg_temp.a382_id(904)::TEXT || '%') AND :'a382_l6'::JSONB #>> '{lead,sales_stage}' = 'Новый',
  'an unresolved Wazzup chat: identity_unresolved, no text, no chat id; the rest of the dossier stays');

-- truncated is honest: cut text is marked and counted; a section skipped at a squeezed level is named.
SELECT pg_temp.a382_assert((:'a382_l1'::JSONB ->> 'truncated')::BOOLEAN AND (:'a382_l1'::JSONB #>> '{omitted,text_cut}')::INTEGER = 3
    AND (SELECT count(*) FROM regexp_matches(:'a382_l1'::TEXT, '\[…\]"', 'g')) = 3,
  'lead 601: the three cut notes are counted as text_cut: ' || (:'a382_l1'::JSONB ->> 'omitted'));
SELECT pg_temp.a382_assert(:'a382_k1'::JSONB #>> '{omitted,text_cut}' = '3' AND (:'a382_k1'::JSONB ->> 'truncated')::BOOLEAN,
  'case 701: three cut notes, truncated: ' || (:'a382_k1'::JSONB ->> 'omitted'));
SELECT pg_temp.a382_assert(:'a382_k2'::JSONB ->> 'truncated' = 'false' AND :'a382_k2'::JSONB -> 'omitted' = '{}'::JSONB
    AND :'a382_k4'::JSONB ->> 'truncated' = 'false', 'nothing cut and nothing omitted: truncated is false');
-- Levels 3 and 4 are the squeeze the caps make unreachable on real data; the builder is called with the level directly.
SELECT platform_private.ai_agent_lead_dossier_build(pg_temp.a382_id(1), pg_temp.a382_id(603), 3) AS a382_l3_deep \gset
SELECT pg_temp.a382_assert((:'a382_l3_deep'::JSONB -> 'omitted' ? 'wishes') AND NOT (:'a382_l3_deep'::JSONB -> 'sale_conditions' ? 'wishes')
    AND (:'a382_l3_deep'::JSONB ->> 'truncated')::BOOLEAN AND (:'a382_l3_deep'::JSONB -> 'omitted' ? 'text_cut'),
  'a squeezed lead names the skipped wishes: ' || (:'a382_l3_deep'::JSONB ->> 'omitted'));
SELECT pg_temp.a382_assert(NOT (platform_private.ai_agent_lead_dossier_build(pg_temp.a382_id(1), pg_temp.a382_id(601), 3) -> 'omitted' ? 'wishes')
    OR (SELECT count(*) FROM jsonb_each_text((SELECT fields FROM platform_private.lead_sale_conditions WHERE lead_id = pg_temp.a382_id(601))) e
      WHERE e.key LIKE 'wishes\_%' AND e.value <> '') > 0, 'wishes are named only when there were some');
SELECT pg_temp.a382_assert((:'a382_k5'::JSONB -> 'omitted' ? 'text_cut') AND (:'a382_k5'::JSONB ->> 'truncated')::BOOLEAN,
  'a huge case counts its cut texts: ' || (:'a382_k5'::JSONB ->> 'omitted'));
-- A questionnaire skipped on a squeezed level is named: give the huge case an application and read again.
SET LOCAL session_replication_role = replica;
INSERT INTO platform_private.student_applications (id, organization_id, auth_user_id, normalized_email, questionnaire, status, revision,
  submitted_at, decided_at, decided_by_membership_id, decision_reason, student_case_id)
  SELECT pg_temp.a382_id(811), pg_temp.a382_id(1), pg_temp.a382_id(103), 'a382-3b@example.invalid', questionnaire, 'approved', 2, submitted_at,
    decided_at, decided_by_membership_id, decision_reason, pg_temp.a382_id(705)
  FROM platform_private.student_applications WHERE id = pg_temp.a382_id(801);
SET LOCAL session_replication_role = origin;
SELECT platform_private.ai_agent_case_dossier_build(pg_temp.a382_id(1), pg_temp.a382_id(705), 3) AS a382_k5b \gset
SELECT pg_temp.a382_assert(:'a382_k5b'::JSONB -> 'omitted' ? 'questionnaire' AND :'a382_k5b'::JSONB -> 'questionnaire' = 'null'::JSONB
    AND NOT (platform_private.ai_agent_case_dossier_build(pg_temp.a382_id(1), pg_temp.a382_id(702), 3) -> 'omitted' ? 'questionnaire'),
  'a skipped questionnaire is named in omitted (and a case without one names nothing): ' || (:'a382_k5b'::JSONB ->> 'omitted'));

-- One dictionary for money: statuses, categories, payment events come from the table of words.
SELECT pg_temp.a382_assert(platform_private.ai_agent_dossier_word('obligation_status', 'overdue') = 'просрочено'
    AND platform_private.ai_agent_dossier_word('obligation_category', 'third_party_cost') = 'сторонние расходы'
    AND platform_private.ai_agent_dossier_word('payment_event', 'refund') = 'Возврат'
    AND platform_private.ai_agent_dossier_word('sales_stage', 'closed') = 'Закрыт'
    AND :'a382_k1'::JSONB #>> '{money,contract,obligations,0,kind}' = 'услуги EVO', 'money words come from the table');
-- Priority: a word only where the dictionary has one (urgent); otherwise the field is absent, not null.
SELECT pg_temp.a382_assert(NOT (:'a382_k1'::JSONB #> '{open_tasks,0}' ? 'priority') AND NOT (:'a382_k1'::JSONB #> '{open_tasks,1}' ? 'priority')
    AND NOT (:'a382_l1'::JSONB #> '{open_tasks,0}' ? 'priority'), 'no priority word: no priority field');
-- The cut helper marks only what it cut.
SELECT pg_temp.a382_assert(char_length(platform_private.ai_agent_dossier_cut(repeat('я', 500), 200)) = 203
    AND platform_private.ai_agent_dossier_cut('коротко', 200) = 'коротко' AND platform_private.ai_agent_dossier_cut(NULL, 200) IS NULL,
  'the cut helper marks only what it cut');
-- The emergency form: card, stages, keys and numbers stay; the omission is named; it is far below any ceiling.
SELECT pg_temp.a382_assert(platform_private.ai_agent_dossier_minimal(:'a382_k5'::JSONB, 'case') -> 'omitted' ? 'size_ceiling'
    AND (platform_private.ai_agent_dossier_minimal(:'a382_k5'::JSONB, 'case') ->> 'truncated')::BOOLEAN
    AND platform_private.ai_agent_dossier_minimal(:'a382_k5'::JSONB, 'case') ? 'timeline_step'
    AND platform_private.ai_agent_dossier_minimal(:'a382_k5'::JSONB, 'case') #>> '{process_stage,word}' = 'подача заявок в университеты'
    AND NOT (platform_private.ai_agent_dossier_minimal(:'a382_k5'::JSONB, 'case') ? 'money')
    AND char_length(platform_private.ai_agent_dossier_minimal(:'a382_k5'::JSONB, 'case')::TEXT) < 3000
    AND platform_private.ai_agent_dossier_minimal(:'a382_l3'::JSONB, 'lead') #>> '{lead,sales_stage}' = 'Новый'
    AND platform_private.ai_agent_dossier_minimal(:'a382_l3'::JSONB, 'lead') -> 'omitted' ? 'size_ceiling'
    AND char_length(platform_private.ai_agent_dossier_minimal(:'a382_l3'::JSONB, 'lead')::TEXT) < 2000,
  'the emergency minimal form of a case and of a lead');

-- Posture: the two tools are closed to every API role except the service; the helpers to all.
SELECT pg_temp.a382_assert(
  has_function_privilege('service_role', 'platform.ai_agent_tool_get_lead_dossier_v1(uuid,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.ai_agent_tool_get_case_dossier_v1(uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.ai_agent_tool_get_case_dossier_v1(uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.ai_agent_tool_get_lead_dossier_v1(uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.ai_agent_case_dossier_build(uuid,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform_private.ai_agent_dossier_word(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.ai_agent_dossier_answer(jsonb)', 'EXECUTE')
  AND (SELECT count(*) FROM platform_private.ai_agent_tool_schemas WHERE tool IN ('get_lead_dossier', 'get_case_dossier')) = 2, 'grants and the two tool rows');

\echo A382_AI_AGENT_DOSSIERS_SUITE_PASSED
ROLLBACK;
