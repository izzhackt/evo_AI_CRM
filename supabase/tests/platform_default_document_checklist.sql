\set ON_ERROR_STOP on
-- Boundary suite for migration 338 «Список документов по умолчанию». Runs on the real chain right after 338 inside one
-- transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
-- The trigger is deferred to commit; the suite fires it with SET CONSTRAINTS ALL IMMEDIATE.
--
-- Proves:
--  1. a China case gets its 10 items once the student's portal is on, in the approved order, as ordinary case items
--     (custom, required, the curator as author), with one system audit event;
--  2. Malaysia gets its 4 items when the country is only in target_country, and when it is only in the student's анкета;
--     with no curator the student is the author;
--  3. nothing is added to a case that has or had any item (a removed one counts), to a case without a portal, a closed
--     case, or another country; a repeated change adds nothing;
--  4. the student sees the items in the portal in the same order;
--  5. posture: the trigger is deferred to commit; the functions are SECURITY DEFINER, search_path '', closed to all roles.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A338_DEFAULT_DOCUMENT_CHECKLIST_SUITE_START

CREATE FUNCTION pg_temp.a338_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('33800000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a338_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A338: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a338_labels(p_case INTEGER) RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT string_agg(s.display_label, ' | ' ORDER BY s.id) FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a338_id(p_case)
$$;
CREATE FUNCTION pg_temp.a338_count(p_case INTEGER) RETURNS BIGINT LANGUAGE SQL STABLE AS $$
  SELECT count(*) FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a338_id(p_case)
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 Admin, 2 Curator, 3..9 Students. Cases 701..709, each with its own Student; the portal is off.
--   701 CN (direction), curator 2      702 MY (target_country only), no curator   703 MY (анкета only), no curator
--   704 MY, has a removed item          705 MY, never gets a portal                706 CN, closed
--   707 TR                              708 CN, gets its list, then another change  709 MY, active, read in the portal
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a338_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a338_actors VALUES (1, 'admin', TRUE), (2, 'curator', FALSE), (3, 'student', FALSE), (4, 'student', FALSE),
  (5, 'student', FALSE), (6, 'student', FALSE), (7, 'student', FALSE), (8, 'student', FALSE), (9, 'student', FALSE),
  (10, 'student', FALSE), (11, 'student', FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a338_id(1), 'A338 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a338_id(100 + n), 'a338-' || n || '@example.invalid', '{}'::JSONB FROM a338_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a338_id(200 + n), pg_temp.a338_id(100 + n), 'A338 Actor ' || n, 'active', 1 FROM a338_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a338_id(300 + a.n), pg_temp.a338_id(1), pg_temp.a338_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1), a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a338_actors a;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a338_id(401), pg_temp.a338_id(1), 'organization', pg_temp.a338_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a338_id(1), pg_temp.a338_id(300 + n), pg_temp.a338_id(401), 1, 1, TRUE, 'system', 'A338 synthetic organization scope', pg_temp.a338_id(460 + n) FROM a338_actors;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a338_id(410 + c), pg_temp.a338_id(1), 'student_case', pg_temp.a338_id(700 + c), 1 FROM generate_series(1, 9) c;
-- The portal reads a case only through the student's own case scope (platform_can_read_student_portal_case).
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
VALUES (pg_temp.a338_id(1), pg_temp.a338_id(311), pg_temp.a338_id(419), 1, 1, TRUE, 'system', 'A338 synthetic case scope', pg_temp.a338_id(479));
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, portal_activated_at, created_at, updated_at)
SELECT pg_temp.a338_id(700 + c.n), pg_temp.a338_id(1), pg_temp.a338_id(302 + c.n), pg_temp.a338_id(301), c.curator, 'a338-case-' || c.n,
  'A338 Студент ' || c.n, c.country, 'Бакалавриат', 'Информационные технологии', 'documents', c.state::platform.student_case_state,
  CASE WHEN c.state = 'pending' THEN NULL ELSE clock_timestamp() END, CASE WHEN c.state = 'closed' THEN clock_timestamp() END,
  pg_temp.a338_id(410 + c.n), 1, c.direction, 'documents', NULL, clock_timestamp(), clock_timestamp()
FROM (VALUES
  (1, 'CN', 'CN', 'active', pg_temp.a338_id(302)),
  (2, 'MY', NULL, 'pending', NULL::UUID),
  (3, NULL, NULL, 'pending', NULL::UUID),
  (4, 'MY', 'MY', 'active', pg_temp.a338_id(302)),
  (5, 'MY', 'MY', 'active', pg_temp.a338_id(302)),
  (6, 'CN', 'CN', 'closed', pg_temp.a338_id(302)),
  (7, 'TR', 'TR', 'active', pg_temp.a338_id(302)),
  (8, 'CN', 'CN', 'active', pg_temp.a338_id(302)),
  (9, 'MY', 'MY', 'active', pg_temp.a338_id(302))
) AS c(n, country, direction, state, curator);
INSERT INTO platform_private.student_applications (id, organization_id, auth_user_id, normalized_email, questionnaire, status, revision,
  submitted_at, decided_at, decided_by_membership_id, decision_reason, student_case_id, invited_case_id, admissions_direction)
VALUES (pg_temp.a338_id(803), pg_temp.a338_id(1), pg_temp.a338_id(105), 'a338-5@example.invalid',
  jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.a338_id(903), 'firstName', 'Анкетная', 'lastName', 'Тестова',
    'phone', '+996 700 000 000', 'destinationCountries', jsonb_build_array('MY'), 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5', 'studyFields', jsonb_build_array('Информационные технологии'),
    'studyLevels', jsonb_build_array('bachelor'), 'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'intermediate'),
    'tuitionBudget', '5000_10000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', '2026-09-18'),
  'approved', 2, TIMESTAMPTZ '2026-10-01 10:00:00+00', TIMESTAMPTZ '2026-10-02 10:00:00+00', pg_temp.a338_id(301),
  'A338 synthetic approval', pg_temp.a338_id(703), NULL, 'MY');
INSERT INTO platform.document_slots (id, organization_id, student_case_id, requirement_id, intent_kind, display_label, group_label, status,
  version, created_by_membership_id, removed_at, removed_by_membership_id, removal_reason)
VALUES (pg_temp.a338_id(904), pg_temp.a338_id(1), pg_temp.a338_id(704), NULL, 'custom', 'Старый пункт', 'Обязательные документы', 'required',
  1, pg_temp.a338_id(302), clock_timestamp(), pg_temp.a338_id(302), 'A338 synthetic removal');
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 1. China: the portal goes on, the list appears at commit.
-- ---------------------------------------------------------------------------
UPDATE platform.student_cases SET portal_activated_at = clock_timestamp() WHERE id = pg_temp.a338_id(701);
SELECT pg_temp.a338_assert(pg_temp.a338_count(701) = 0, 'nothing is added before commit (the trigger is deferred)');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.a338_assert(pg_temp.a338_labels(701) = 'Загранпаспорт | Фото | Аттестат или транскрипт | Справка с места учёбы | '
    || 'Справка о несудимости | Медицинская справка | Справка из банка | Мотивационное письмо | Рекомендательные письма | '
    || 'Сертификат по языку (IELTS, TOEFL), если есть',
  'China gets its 10 items in the approved order');
SELECT pg_temp.a338_assert((SELECT bool_and(s.intent_kind = 'custom' AND s.requirement_id IS NULL AND s.status = 'required'
      AND s.version = 1 AND s.removed_at IS NULL AND s.created_by_membership_id = pg_temp.a338_id(302))
    FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a338_id(701)),
  'the items are ordinary required case items written by the curator');
SELECT pg_temp.a338_assert((SELECT count(*) FILTER (WHERE s.group_label = 'Обязательные документы') = 9
      AND count(*) FILTER (WHERE s.group_label = 'Если есть') = 1
    FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a338_id(701)),
  'nine required items and the language certificate under «Если есть»');
SELECT pg_temp.a338_assert((SELECT count(*) = 1 AND bool_and(e.actor_kind = 'system' AND e.actor_profile_id IS NULL
      AND e.after_state ->> 'seeded_count' = '10' AND e.after_state ->> 'admissions_direction' = 'CN')
    FROM platform.audit_events e WHERE e.resource_id = pg_temp.a338_id(701) AND e.action = 'document.checklist.baseline.seed'),
  'one system audit event records the list');

-- ---------------------------------------------------------------------------
-- 2. Malaysia through target_country only, and through the анкета only; no curator: the student is the author.
-- ---------------------------------------------------------------------------
UPDATE platform.student_cases SET portal_activated_at = clock_timestamp() WHERE id IN (pg_temp.a338_id(702), pg_temp.a338_id(703));
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.a338_assert(pg_temp.a338_labels(702) = 'Загранпаспорт | Фото | Аттестат или транскрипт | Сертификат по языку (IELTS, TOEFL)',
  'Malaysia from target_country gets its 4 items in order');
SELECT pg_temp.a338_assert(pg_temp.a338_labels(703) = pg_temp.a338_labels(702), 'Malaysia from the анкета gets the same 4 items');
SELECT pg_temp.a338_assert((SELECT bool_and(s.created_by_membership_id = pg_temp.a338_id(304)) FROM platform.document_slots s
    WHERE s.student_case_id = pg_temp.a338_id(702)), 'with no curator the student is the author');

-- ---------------------------------------------------------------------------
-- 3. Untouched: a case that had an item, no portal, closed, another country; a repeated change adds nothing.
-- ---------------------------------------------------------------------------
UPDATE platform.student_cases SET portal_activated_at = clock_timestamp()
WHERE id IN (pg_temp.a338_id(704), pg_temp.a338_id(706), pg_temp.a338_id(707), pg_temp.a338_id(708));
UPDATE platform.student_cases SET admissions_direction = 'MY' WHERE id = pg_temp.a338_id(705);
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.a338_assert(pg_temp.a338_count(704) = 1, 'a case that had an item (removed) gets nothing more');
SELECT pg_temp.a338_assert(pg_temp.a338_count(705) = 0, 'a case without a portal gets nothing');
SELECT pg_temp.a338_assert(pg_temp.a338_count(706) = 0, 'a closed case gets nothing');
SELECT pg_temp.a338_assert(pg_temp.a338_count(707) = 0, 'another country gets nothing');
SELECT pg_temp.a338_assert(pg_temp.a338_count(708) = 10, 'the China case got its list');
UPDATE platform.student_cases SET target_country = 'CN', admissions_direction = 'CN' WHERE id = pg_temp.a338_id(708);
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.a338_assert(pg_temp.a338_count(708) = 10, 'a repeated change adds nothing');
SELECT pg_temp.a338_assert(platform_private.seed_default_document_checklist(pg_temp.a338_id(1), pg_temp.a338_id(708)) = 0,
  'a direct second call adds nothing');

-- ---------------------------------------------------------------------------
-- 4. The student sees the items in the portal, in the same order.
-- ---------------------------------------------------------------------------
UPDATE platform.student_cases SET portal_activated_at = clock_timestamp() WHERE id = pg_temp.a338_id(709);
SET CONSTRAINTS ALL IMMEDIATE;
SELECT set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a338_id(111),
  'claims', jsonb_build_object('sub', pg_temp.a338_id(111), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE a338_portal AS SELECT row_number() OVER () AS n, d.* FROM platform.student_portal_documents() d;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', TRUE);
SELECT pg_temp.a338_assert((SELECT string_agg(p.requirement_label, ' | ' ORDER BY p.n) FROM a338_portal p)
    = 'Загранпаспорт | Фото | Аттестат или транскрипт | Сертификат по языку (IELTS, TOEFL)',
  'the student sees the 4 items in the portal in order');
SELECT pg_temp.a338_assert((SELECT bool_and(p.case_id = pg_temp.a338_id(709) AND p.slot_status = 'required') FROM a338_portal p),
  'only the student''s own case, all still to upload');

-- ---------------------------------------------------------------------------
-- 5. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a338_assert((SELECT t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint <> 0
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'platform.student_cases'::REGCLASS
      AND t.tgname = 'student_cases_default_document_checklist'),
  'the trigger is a constraint trigger deferred to commit');
SELECT pg_temp.a338_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
    FROM pg_catalog.pg_proc p WHERE p.oid IN (
      to_regprocedure('platform_private.default_document_checklist(text)'),
      to_regprocedure('platform_private.seed_default_document_checklist(uuid,uuid)'),
      to_regprocedure('platform_private.student_case_default_document_checklist()'))),
  'SECURITY DEFINER, empty search_path, closed to authenticated, anon and service_role');

\echo A338_DEFAULT_DOCUMENT_CHECKLIST_SUITE_PASSED
ROLLBACK;
