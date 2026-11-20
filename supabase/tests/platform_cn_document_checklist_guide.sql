\set ON_ERROR_STOP on
-- Boundary suite for migration 364 «Список документов Китая по руководству куратора». Runs on the real chain right after
-- 364 inside one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
-- Cases that got the 338 China list are built here with the 338 ids (the migration's own one-time pass ran on an empty
-- chain), then the suite calls the same extension function the migration called.
--
-- Proves:
--  1. the lists: China is the 14 items of the guide in order with their groups; Malaysia is the 338 list unchanged;
--  2. a new China case gets the 14 items when the portal goes on (the 338 trigger, unchanged), Malaysia its 4;
--  3. a case with the 338 China list gets only the guide items it never had, after the 338 items (numbers 11+), as
--     ordinary case items (custom, required, curator or student as author), with one system audit event:
--     - an item with the same label, active or removed, is not added again;
--     - the language certificate is not added while the 338 certificate item lives (renamed or not);
--     - existing items keep their labels, groups, status, version and removal;
--     - Malaysia, a closed case, a case without a portal, a case that never got the 338 list, a case whose country is
--       no longer China and a case seeded with the new list get nothing; a repeated call adds nothing;
--  4. the student sees the extended list in the portal in order: the 338 items, then the added ones;
--  5. posture: the list keeps its volatility and posture; the new function is SECURITY DEFINER, search_path '', closed to
--     all roles; the 338 trigger is still deferred to commit.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A364_CN_DOCUMENT_CHECKLIST_GUIDE_SUITE_START

CREATE FUNCTION pg_temp.a364_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('36400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a364_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A364: %', message; END IF;
END
$$;
-- The id 338 gives an item: the item number in the first byte, then md5 of the case and the label.
CREATE FUNCTION pg_temp.a364_slot_id(p_case INTEGER, p_position INTEGER, p_label TEXT) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT (lpad(to_hex(p_position), 2, '0') || substr(h.hash, 3, 10) || '4' || substr(h.hash, 14, 3) || '8' || substr(h.hash, 18, 15))::UUID
  FROM (SELECT md5(pg_temp.a364_id(800 + p_case)::TEXT || ':' || p_label) AS hash) AS h
$$;
CREATE FUNCTION pg_temp.a364_labels(p_case INTEGER) RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT string_agg(s.display_label, ' | ' ORDER BY s.id) FROM platform.document_slots s
  WHERE s.student_case_id = pg_temp.a364_id(800 + p_case) AND s.removed_at IS NULL
$$;
CREATE FUNCTION pg_temp.a364_count(p_case INTEGER) RETURNS BIGINT LANGUAGE SQL STABLE AS $$
  SELECT count(*) FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a364_id(800 + p_case)
$$;
CREATE FUNCTION pg_temp.a364_extend(p_case INTEGER) RETURNS INTEGER LANGUAGE SQL VOLATILE AS $$
  SELECT platform_private.extend_default_document_checklist_cn_guide(pg_temp.a364_id(1), pg_temp.a364_id(800 + p_case))
$$;

-- The China list 338 wrote, and the Malaysian one.
CREATE TEMP TABLE a364_old_cn(item_position INTEGER, label TEXT, group_label TEXT);
INSERT INTO a364_old_cn VALUES
  (1, 'Загранпаспорт', 'Обязательные документы'), (2, 'Фото', 'Обязательные документы'),
  (3, 'Аттестат или транскрипт', 'Обязательные документы'), (4, 'Справка с места учёбы', 'Обязательные документы'),
  (5, 'Справка о несудимости', 'Обязательные документы'), (6, 'Медицинская справка', 'Обязательные документы'),
  (7, 'Справка из банка', 'Обязательные документы'), (8, 'Мотивационное письмо', 'Обязательные документы'),
  (9, 'Рекомендательные письма', 'Обязательные документы'), (10, 'Сертификат по языку (IELTS, TOEFL), если есть', 'Если есть');
CREATE TEMP TABLE a364_old_my(item_position INTEGER, label TEXT, group_label TEXT);
INSERT INTO a364_old_my VALUES
  (1, 'Загранпаспорт', 'Обязательные документы'), (2, 'Фото', 'Обязательные документы'),
  (3, 'Аттестат или транскрипт', 'Обязательные документы'), (4, 'Сертификат по языку (IELTS, TOEFL)', 'Обязательные документы');

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 Admin, 2 Curator, 3..14 Students (case c belongs to actor c + 2). Cases 801..812:
--   801 CN, portal off, new                      802 MY, portal off, new, no curator
--   803 CN, 338 list, read in the portal          804 CN, 338 list + an active «Результаты CSCA» added by the curator
--   805 CN, 338 list + a removed «Свидетельство о рождении»
--   806 MY, 338 Malaysian list                   807 CN, 338 list: certificate renamed, passport renamed, one removed
--   808 CN, 338 list, closed                     809 CN, only items the curator added (never got the 338 list)
--   810 CN by target_country only, 338 list, no curator
--   811 CN, 338 list, no portal                  812 MY now, 338 China list from before
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a364_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a364_actors VALUES (1, 'admin', TRUE), (2, 'curator', FALSE);
INSERT INTO a364_actors SELECT n, 'student', FALSE FROM generate_series(3, 14) n;
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a364_id(1), 'A364 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a364_id(100 + n), 'a364-' || n || '@example.invalid', '{}'::JSONB FROM a364_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a364_id(200 + n), pg_temp.a364_id(100 + n), 'A364 Actor ' || n, 'active', 1 FROM a364_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a364_id(300 + a.n), pg_temp.a364_id(1), pg_temp.a364_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1), a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a364_actors a;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a364_id(401), pg_temp.a364_id(1), 'organization', pg_temp.a364_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a364_id(1), pg_temp.a364_id(300 + n), pg_temp.a364_id(401), 1, 1, TRUE, 'system', 'A364 synthetic organization scope', pg_temp.a364_id(460 + n) FROM a364_actors;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a364_id(410 + c), pg_temp.a364_id(1), 'student_case', pg_temp.a364_id(800 + c), 1 FROM generate_series(1, 12) c;
-- The portal reads a case only through the student's own case scope (platform_can_read_student_portal_case).
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
VALUES (pg_temp.a364_id(1), pg_temp.a364_id(305), pg_temp.a364_id(413), 1, 1, TRUE, 'system', 'A364 synthetic case scope', pg_temp.a364_id(483));
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, portal_activated_at, created_at, updated_at)
SELECT pg_temp.a364_id(800 + c.n), pg_temp.a364_id(1), pg_temp.a364_id(302 + c.n), pg_temp.a364_id(301), c.curator, 'a364-case-' || c.n,
  'A364 Студент ' || c.n, c.country, 'Бакалавриат', 'Информационные технологии', 'documents', c.state::platform.student_case_state,
  CASE WHEN c.state = 'pending' THEN NULL ELSE clock_timestamp() END, CASE WHEN c.state = 'closed' THEN clock_timestamp() END,
  pg_temp.a364_id(410 + c.n), 1, c.direction, 'documents', CASE WHEN c.portal THEN clock_timestamp() END, clock_timestamp(), clock_timestamp()
FROM (VALUES
  (1, 'CN', 'CN', 'active', FALSE, pg_temp.a364_id(302)),
  (2, 'MY', 'MY', 'pending', FALSE, NULL::UUID),
  (3, 'CN', 'CN', 'active', TRUE, pg_temp.a364_id(302)),
  (4, 'CN', 'CN', 'active', TRUE, pg_temp.a364_id(302)),
  (5, 'CN', 'CN', 'active', TRUE, pg_temp.a364_id(302)),
  (6, 'MY', 'MY', 'active', TRUE, pg_temp.a364_id(302)),
  (7, 'CN', 'CN', 'active', TRUE, pg_temp.a364_id(302)),
  (8, 'CN', 'CN', 'closed', TRUE, pg_temp.a364_id(302)),
  (9, 'CN', 'CN', 'active', TRUE, pg_temp.a364_id(302)),
  (10, 'CN', NULL, 'pending', TRUE, NULL::UUID),
  (11, 'CN', 'CN', 'active', FALSE, pg_temp.a364_id(302)),
  (12, 'MY', 'MY', 'active', TRUE, pg_temp.a364_id(302))
) AS c(n, country, direction, state, portal, curator);
-- What 338 gave: its China list (and its Malaysian list to 806), with the 338 ids, author the curator (or the student).
INSERT INTO platform.document_slots (id, organization_id, student_case_id, requirement_id, intent_kind, display_label, group_label, status,
  version, created_by_membership_id)
SELECT pg_temp.a364_slot_id(c.n, o.item_position, o.label), pg_temp.a364_id(1), pg_temp.a364_id(800 + c.n), NULL::UUID,
  'custom'::platform.document_slot_intent_kind, o.label, o.group_label, 'required'::platform.document_slot_status, 1,
  CASE WHEN c.n = 10 THEN pg_temp.a364_id(312) ELSE pg_temp.a364_id(302) END
FROM a364_old_cn o CROSS JOIN (VALUES (3), (4), (5), (7), (8), (10), (11), (12)) AS c(n)
UNION ALL
SELECT pg_temp.a364_slot_id(6, o.item_position, o.label), pg_temp.a364_id(1), pg_temp.a364_id(806), NULL::UUID,
  'custom'::platform.document_slot_intent_kind, o.label, o.group_label, 'required'::platform.document_slot_status, 1, pg_temp.a364_id(302)
FROM a364_old_my o;
-- What curators did since.
INSERT INTO platform.document_slots (id, organization_id, student_case_id, requirement_id, intent_kind, display_label, group_label, status,
  version, created_by_membership_id, removed_at, removed_by_membership_id, removal_reason)
VALUES
  (pg_temp.a364_id(904), pg_temp.a364_id(1), pg_temp.a364_id(804), NULL, 'custom', 'Результаты CSCA', 'Экзамены', 'required',
    1, pg_temp.a364_id(302), NULL, NULL, NULL),
  (pg_temp.a364_id(905), pg_temp.a364_id(1), pg_temp.a364_id(805), NULL, 'custom', 'Свидетельство о рождении', 'Прочее', 'required',
    1, pg_temp.a364_id(302), clock_timestamp(), pg_temp.a364_id(302), 'A364 synthetic removal'),
  (pg_temp.a364_id(909), pg_temp.a364_id(1), pg_temp.a364_id(809), NULL, 'custom', 'Загранпаспорт', 'Обязательные документы', 'required',
    1, pg_temp.a364_id(302), NULL, NULL, NULL);
UPDATE platform.document_slots SET display_label = 'IELTS 6.5', group_label = 'Экзамены', version = 2
WHERE id = pg_temp.a364_slot_id(7, 10, 'Сертификат по языку (IELTS, TOEFL), если есть');
UPDATE platform.document_slots SET display_label = 'Паспорт (скан)', version = 2 WHERE id = pg_temp.a364_slot_id(7, 1, 'Загранпаспорт');
UPDATE platform.document_slots SET removed_at = clock_timestamp(), removed_by_membership_id = pg_temp.a364_id(302),
  removal_reason = 'A364 synthetic removal', version = 2
WHERE id = pg_temp.a364_slot_id(7, 4, 'Справка с места учёбы');
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 1. The lists.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a364_assert((SELECT string_agg(l.item_position || ':' || l.label || ':' || l.group_label, ' | ' ORDER BY l.item_position)
    FROM platform_private.default_document_checklist('CN') l)
  = '1:Загранпаспорт:Обязательные документы | 2:Фото:Обязательные документы | 3:Аттестат или транскрипт:Обязательные документы | '
    || '4:Сертификат по языку (HSK, IELTS или TOEFL):Обязательные документы | 5:Результаты CSCA, для бакалавриата:Для бакалавриата | '
    || '6:Справка о несудимости:Обязательные документы | 7:Медицинская справка:Обязательные документы | '
    || '8:Справка из банка:Обязательные документы | 9:Мотивационное письмо:Обязательные документы | '
    || '10:Рекомендательные письма:Обязательные документы | 11:Паспорта и данные родителей:Обязательные документы | '
    || '12:Справка с места учёбы, если сейчас учитесь:Если сейчас учитесь | '
    || '13:Нотариальное согласие родителей на выезд, если вам нет 18 лет:Если вам нет 18 лет | '
    || '14:Свидетельство о рождении, если вам нет 18 лет:Если вам нет 18 лет',
  'China is the 14 items of the guide, in order, with their groups');
SELECT pg_temp.a364_assert((SELECT array_agg((l.item_position, l.label, l.group_label)::TEXT ORDER BY l.item_position)
    FROM platform_private.default_document_checklist('MY') l)
  = (SELECT array_agg((o.item_position, o.label, o.group_label)::TEXT ORDER BY o.item_position) FROM a364_old_my o),
  'Malaysia is the 338 list unchanged');
SELECT pg_temp.a364_assert(NOT EXISTS (SELECT 1 FROM platform_private.default_document_checklist('TR')), 'another country has no list');

-- ---------------------------------------------------------------------------
-- 2. New cases: the 338 trigger puts the new lists.
-- ---------------------------------------------------------------------------
UPDATE platform.student_cases SET portal_activated_at = clock_timestamp() WHERE id IN (pg_temp.a364_id(801), pg_temp.a364_id(802));
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.a364_assert(pg_temp.a364_labels(1) = (SELECT string_agg(l.label, ' | ' ORDER BY l.item_position)
    FROM platform_private.default_document_checklist('CN') l),
  'a new China case gets the 14 items in order');
SELECT pg_temp.a364_assert((SELECT string_agg(s.group_label, ' | ' ORDER BY s.id) FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a364_id(801))
    = (SELECT string_agg(l.group_label, ' | ' ORDER BY l.item_position) FROM platform_private.default_document_checklist('CN') l),
  'with the groups of the guide');
SELECT pg_temp.a364_assert((SELECT bool_and(s.intent_kind = 'custom' AND s.status = 'required' AND s.created_by_membership_id = pg_temp.a364_id(302))
    FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a364_id(801)),
  'as ordinary required items written by the curator');
SELECT pg_temp.a364_assert((SELECT count(*) = 1 AND bool_and(e.after_state ->> 'seeded_count' = '14')
    FROM platform.audit_events e WHERE e.resource_id = pg_temp.a364_id(801) AND e.action = 'document.checklist.baseline.seed'),
  'one audit event records the 14 items');
SELECT pg_temp.a364_assert(pg_temp.a364_labels(2) = 'Загранпаспорт | Фото | Аттестат или транскрипт | Сертификат по языку (IELTS, TOEFL)',
  'a new Malaysian case gets the same 4 items as before');

-- ---------------------------------------------------------------------------
-- 3. Cases with the 338 China list get only what they never had.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a364_before AS
SELECT s.id, s.display_label, s.group_label, s.status, s.version, s.removed_at, s.created_by_membership_id, s.updated_at
FROM platform.document_slots s WHERE s.organization_id = pg_temp.a364_id(1);
CREATE TEMP TABLE a364_result AS SELECT c.n, pg_temp.a364_extend(c.n) AS created FROM generate_series(1, 12) AS c(n);
SELECT pg_temp.a364_assert((SELECT string_agg(r.n || '=' || r.created, ' ' ORDER BY r.n) FROM a364_result r)
    = '1=0 2=0 3=4 4=3 5=3 6=0 7=4 8=0 9=0 10=4 11=0 12=0',
  'only the cases with the 338 China list get items, and only the missing ones');
SELECT pg_temp.a364_assert((SELECT count(*) = (SELECT count(*) FROM a364_before) FROM a364_before b JOIN platform.document_slots s ON s.id = b.id
      AND s.display_label IS NOT DISTINCT FROM b.display_label AND s.group_label IS NOT DISTINCT FROM b.group_label
      AND s.status = b.status AND s.version = b.version AND s.removed_at IS NOT DISTINCT FROM b.removed_at
      AND s.created_by_membership_id = b.created_by_membership_id AND s.updated_at = b.updated_at),
  'no existing item is renamed, regrouped, removed or touched');
SELECT pg_temp.a364_assert((SELECT string_agg(substr(s.id::TEXT, 1, 2) || ' ' || s.display_label || ' / ' || s.group_label, ' | ' ORDER BY s.id)
    FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a364_id(803) AND s.id NOT IN (SELECT b.id FROM a364_before b))
  = '0b Результаты CSCA, для бакалавриата / Для бакалавриата | 0c Паспорта и данные родителей / Обязательные документы | '
    || '0d Нотариальное согласие родителей на выезд, если вам нет 18 лет / Если вам нет 18 лет | '
    || '0e Свидетельство о рождении, если вам нет 18 лет / Если вам нет 18 лет',
  'the added items follow the 338 ones (numbers 11-14), in the order and groups of the guide; no second certificate');
SELECT pg_temp.a364_assert((SELECT bool_and(s.intent_kind = 'custom' AND s.requirement_id IS NULL AND s.status = 'required' AND s.version = 1
      AND s.removed_at IS NULL AND s.created_by_membership_id = pg_temp.a364_id(302))
    FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a364_id(803) AND s.id NOT IN (SELECT b.id FROM a364_before b)),
  'the added items are ordinary required case items written by the curator');
SELECT pg_temp.a364_assert((SELECT count(*) = 1 AND bool_and(e.actor_kind = 'system' AND e.actor_profile_id IS NULL
      AND e.actor_principal = 'system:default-document-checklist' AND e.after_state ->> 'seeded_count' = '4'
      AND e.after_state ->> 'admissions_direction' = 'CN'
      AND e.request_id = public.uuid_generate_v5(pg_temp.a364_id(803), 'default-document-checklist-cn-guide'))
    FROM platform.audit_events e WHERE e.resource_id = pg_temp.a364_id(803) AND e.action = 'document.checklist.baseline.seed'),
  'one system audit event records the extension');
SELECT pg_temp.a364_assert((SELECT count(*) FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a364_id(804)
      AND s.display_label = 'Результаты CSCA') = 1
    AND pg_temp.a364_count(4) = 14,
  'an active item with the same label is not added again');
SELECT pg_temp.a364_assert((SELECT count(*) FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a364_id(805)
      AND s.display_label = 'Свидетельство о рождении') = 1
    AND pg_temp.a364_count(5) = 14,
  'a removed item with the same label is not added again');
SELECT pg_temp.a364_assert(NOT EXISTS (SELECT 1 FROM platform.document_slots s WHERE s.organization_id = pg_temp.a364_id(1)
      AND s.display_label = 'Справка с места учёбы, если сейчас учитесь' AND s.student_case_id <> pg_temp.a364_id(801)),
  'the 338 study certificate (active, or removed as in case 7) counts as the same document: no second one with the condition');
SELECT pg_temp.a364_assert(pg_temp.a364_count(7) = 14
    AND NOT EXISTS (SELECT 1 FROM platform.document_slots s WHERE s.student_case_id = pg_temp.a364_id(807)
      AND s.display_label LIKE 'Сертификат по языку%'),
  'a renamed 338 certificate still counts as the certificate: no second one');
SELECT pg_temp.a364_assert(NOT EXISTS (SELECT 1 FROM platform.document_slots s WHERE s.organization_id = pg_temp.a364_id(1)
      AND s.display_label = 'Сертификат по языку (HSK, IELTS или TOEFL)' AND s.student_case_id <> pg_temp.a364_id(801)),
  'no case with the 338 list gets the new certificate (each still has the 338 one)');
SELECT pg_temp.a364_assert((SELECT bool_and(s.created_by_membership_id = pg_temp.a364_id(312)) FROM platform.document_slots s
    WHERE s.student_case_id = pg_temp.a364_id(810) AND s.id NOT IN (SELECT b.id FROM a364_before b))
    AND pg_temp.a364_count(10) = 14,
  'China from target_country only is extended; with no curator the student is the author');
SELECT pg_temp.a364_assert(pg_temp.a364_count(6) = 4 AND pg_temp.a364_count(8) = 10 AND pg_temp.a364_count(9) = 1
    AND pg_temp.a364_count(11) = 10 AND pg_temp.a364_count(12) = 10 AND pg_temp.a364_count(1) = 14 AND pg_temp.a364_count(2) = 4,
  'Malaysia, a closed case, a case without the 338 list, without a portal, no longer China, or with the new list: nothing');
SELECT pg_temp.a364_assert(pg_temp.a364_extend(3) = 0 AND pg_temp.a364_extend(4) = 0 AND pg_temp.a364_count(3) = 14,
  'a repeated call adds nothing');
SELECT pg_temp.a364_assert((SELECT count(*) FROM platform.audit_events e WHERE e.resource_id = pg_temp.a364_id(803)
    AND e.action = 'document.checklist.baseline.seed') = 1,
  'and writes no second audit event');

-- ---------------------------------------------------------------------------
-- 4. The student sees the extended list in the portal: the 338 items, then the added ones.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a364_id(105),
  'claims', jsonb_build_object('sub', pg_temp.a364_id(105), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE a364_portal AS SELECT row_number() OVER () AS n, d.* FROM platform.student_portal_documents() d;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', TRUE);
SELECT pg_temp.a364_assert((SELECT string_agg(p.requirement_label, ' | ' ORDER BY p.n) FROM a364_portal p)
    = 'Загранпаспорт | Фото | Аттестат или транскрипт | Справка с места учёбы | Справка о несудимости | Медицинская справка | '
    || 'Справка из банка | Мотивационное письмо | Рекомендательные письма | Сертификат по языку (IELTS, TOEFL), если есть | '
    || 'Результаты CSCA, для бакалавриата | Паспорта и данные родителей | '
    || 'Нотариальное согласие родителей на выезд, если вам нет 18 лет | Свидетельство о рождении, если вам нет 18 лет',
  'the student sees the 338 items, then the added ones, in order');
SELECT pg_temp.a364_assert((SELECT bool_and(p.case_id = pg_temp.a364_id(803) AND p.slot_status = 'required') FROM a364_portal p),
  'only the student''s own case, all still to upload');

-- ---------------------------------------------------------------------------
-- 5. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a364_assert((SELECT p.provolatile = 'i' FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('platform_private.default_document_checklist(text)')),
  'the list stays IMMUTABLE');
SELECT pg_temp.a364_assert((SELECT count(*) = 2 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
    FROM pg_catalog.pg_proc p WHERE p.oid IN (
      to_regprocedure('platform_private.default_document_checklist(text)'),
      to_regprocedure('platform_private.extend_default_document_checklist_cn_guide(uuid,uuid)'))),
  'SECURITY DEFINER, empty search_path, closed to authenticated, anon and service_role');
SELECT pg_temp.a364_assert((SELECT t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint <> 0
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'platform.student_cases'::REGCLASS
      AND t.tgname = 'student_cases_default_document_checklist'),
  'the 338 trigger is still a constraint trigger deferred to commit');

\echo A364_CN_DOCUMENT_CHECKLIST_GUIDE_SUITE_PASSED
ROLLBACK;
