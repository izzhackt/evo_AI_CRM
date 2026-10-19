\set ON_ERROR_STOP on
-- Boundary suite for migration 310 («права актора один раз на запрос»; docs/PLAN_CHANGES.md,
-- запись 2026-10-19). Это граница безопасности: новое множество видимости и девять заменённых
-- тел обязаны давать ровно ту выдачу, что давала прежняя построчная проверка. Прежние тела
-- (выпущенные до 310) лежат в platform_permission_once_old_bodies.sql под именами
-- platform_private.pw310_old_*; их md5 сверяется с якорями миграции. Участники смоделированы
-- как в production после 155 и 244: приглашённые сотрудники с грубой ролью NULL, права только
-- из назначений с production-ключами; только системный Admin несёт грубую роль. Каждая смена
-- личности идёт через pg_temp.pw_as / pw_json (клеймы и роль локальны транзакции).
--
-- Что доказывается:
--  0. посture: четыре новые функции закрыты для клиентов (EXECUTE только у владельца), STABLE,
--     SECURITY DEFINER, пустой search_path; пара (право, вид), которой нет в списке, это 22023;
--     прежние тела девяти функций совпадают с якорями (md5 prosrc); у заменённых функций
--     прежние подписи, владелец, права, STABLE, SECURITY DEFINER и search_path;
--  1. МНОЖЕСТВО: для каждого участника (Admin, Sales Manager отдела, Sales «свои», Admissions
--     Manager отдела, Admissions «свои», сотрудник с направлением, запись-область,
--     организационная область, смешанные области, студент, чужая организация, без роли)
--     и каждой из четырёх пар (право, вид) множество staff_visible_ids_v1 равно множеству id,
--     для которых прежняя построчная platform_private.staff_can_access даёт TRUE, на всех
--     ресурсах (включая чужую организацию и несуществующие id) и при only_ids (подмножество,
--     пустой массив, NULL); то же для _for_actor и для чтения дела (private.platform_can_read_
--     student_case, включая ветку «дело ждёт куратора»);
--  2. ВЫДАЧА: для каждого участника и каждой из девяти заменённых функций (по несколько
--     наборов параметров, страницы и курсоры) выдача новой версии и прежней копии на одних
--     данных равна по строкам, порядку и всем полям (jsonb построчно), а ошибки равны по
--     SQLSTATE и тексту; доказано, что выдача разная у разных участников (не пустая проверка);
--  3. кромки: переписка без лида, лид без дела, закрытое дело, архивный и конвертированный
--     лиды, дело «ждёт куратора» (обе ветки), handoff, waha_history_binding, студент,
--     чужая организация, приостановленное членство, заблокированный профиль, отозванное
--     назначение, аноним, удалённая роль;
--  4. отзыв и приостановка действуют на следующем же вызове, внутри одной транзакции: после
--     приостановки членства, блокировки профиля, отзыва назначения и архивации роли множество
--     и выдача сразу пусты или отказ, как у прежней версии.
-- Изолированные синтетические данные; транзакция заканчивается ROLLBACK.
-- Если набор падает на ПОСЛЕДНЕЙ цепочке (второй запуск раннера, pw_sets_only) из-за поздней миграции:
--  * permission_once_mirror_drift: эталонная функция изменилась, обновите примитивы (миграция 310 и её
--    наследник), якоря ниже и добавьте сценарий в фикстуру;
--  * падение фикстуры («function ... does not exist», «System Admin is required»): починить ФИКСТУРУ под
--    новую команду, не ослаблять проверки;
--  * pw oracle: чтение, которое набор проверял, перестало совпадать с построчной правдой, это дефект
--    чтения, а не набора.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $pw_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$pw_auth_role$;

CREATE FUNCTION pg_temp.pw_id(n BIGINT) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('310e0000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE TEMP TABLE pw_checks(n INTEGER);
CREATE FUNCTION pg_temp.pw_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'PW310: %', message; END IF;
  INSERT INTO pw_checks VALUES (1);
END
$$;
-- The statement as another identity: claims and role are local to the transaction, role reset.
-- pw_run answers a stable text: the md5 and count of the result rows, or 'SQLSTATE:message'.
CREATE FUNCTION pg_temp.pw_run(p_claims TEXT, p_role TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  IF p_role IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', p_role); END IF;
  BEGIN
    EXECUTE p_sql INTO answer;
  EXCEPTION WHEN OTHERS THEN answer := 'ERR ' || SQLSTATE || ':' || SQLERRM;
  END;
  RESET ROLE;
  RETURN answer;
END
$$;
CREATE FUNCTION pg_temp.pw_error(p_claims TEXT, p_role TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  IF p_role IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', p_role); END IF;
  BEGIN
    EXECUTE p_sql; answer := 'ok';
  EXCEPTION WHEN OTHERS THEN answer := SQLSTATE || ':' || SQLERRM;
  END;
  RESET ROLE;
  RETURN answer;
END
$$;
-- The grantees of EXECUTE other than the owner ('PUBLIC' for the pseudo-role).
CREATE FUNCTION pg_temp.pw_grantees(p_fn REGPROCEDURE) RETURNS TEXT[] LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::REGROLE::TEXT END
      ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::REGROLE::TEXT END), ARRAY[]::TEXT[])
  FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE p.oid = p_fn AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner
$$;
GRANT EXECUTE ON FUNCTION pg_temp.pw_id(BIGINT), pg_temp.pw_assert(BOOLEAN, TEXT) TO authenticated, anon, service_role;

SELECT 'PW310_PERMISSION_ONCE_SUITE_START' AS pw_suite_marker;

-- ---------------------------------------------------------------------------
-- Mirror guard. platform_private.staff_visible_ids_v1 / staff_readable_case_ids_v1 re-express, as a
-- set, what the functions below decide row by row. Their bodies are pinned here (md5 of prosrc, the
-- same values migration 310 pins at application time). If a LATER migration changes any of them, this
-- suite fails on the latest chain until the primitives, the anchors in 310's successor and these values
-- are updated together: the nine hot reads would otherwise keep deciding by the old rule.
-- ---------------------------------------------------------------------------
SELECT pg_temp.pw_assert(md5(p.prosrc) = e.expected,
  'permission_once_mirror_drift: ' || e.fn || ' changed after migration 310; update platform_private.staff_visible_ids_v1 / staff_readable_case_ids_v1 and the anchors in supabase/tests/platform_permission_once.sql together')
FROM (VALUES
  ('platform_private.staff_context_can_access(uuid,uuid,text,text,uuid,uuid,uuid,text)', 'f354be0f66ddcc6953bc89dabe286315'),
  ('platform_private.staff_resource_context(uuid,text,text,uuid)', '1567b2501a0762432a80d93c49be5c01'),
  ('platform_private.staff_has_permission(uuid,uuid,text)', '2184ba936ea0fa1489cb4b182fcbd96e'),
  ('platform_private.staff_membership_identity(uuid,uuid)', '50bcf36620d2806d48387c5896513ff1'),
  ('platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)', '89536bd904e1631fda1b264dc053c505'),
  ('platform_private.staff_can_access(uuid,uuid,text,text,uuid)', 'a4a97f1fc1bbc1979dd22ee287768fc7'),
  ('platform_private.staff_can_access_for_actor(uuid,text,text,uuid)', 'b938af689a78e6e5f9fff08c0b98db65'),
  ('platform.current_actor_authority()', 'cf589e34b195b1a9d7bc47c8f838a773'),
  ('platform_private.student_actor_pre_scoped_roles()', '4b30f3ef64fe79ac7e5cac2b0769fe7c'),
  ('platform_private.staff_can_take_needs_curator_case(uuid,uuid,uuid)', '8fb42c2c60235befcb8d75a18d444e49'),
  ('platform_private.needs_curator_case_last_curator(uuid,uuid)', '4a100c80480fba92f7648ed3e922a145'),
  ('platform_private.staff_can_take_direct_needs_curator_case(uuid,uuid,uuid)', 'd7811c9ff41583d2137b10bb4570ed16'),
  ('platform_private.direct_needs_curator_case_author(uuid,uuid)', 'd7c0965e6db13d062b7fd379a09d7858'),
  ('private.platform_can_read_student_case(uuid,uuid)', 'a567284eb05c0865152d913062775292'),
  ('private.platform_can_read_communication_full(uuid,uuid)', '67d85fbcd6a07266a957f1b3bdc310a9'),
  ('private.platform_can_read_canonical_lead(uuid,uuid)', '720b525f1c565ea8399d87b64d82efb7')
) AS e(fn, expected) JOIN pg_proc p ON p.oid = e.fn::REGPROCEDURE;
SELECT pg_temp.pw_assert(p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND p.provolatile = 's',
  'permission_once_mirror_drift: ' || p.oid::REGPROCEDURE::TEXT || ' lost SECURITY DEFINER, the empty search_path or STABLE')
FROM pg_proc p WHERE p.oid = ANY (ARRAY[
  'platform_private.staff_context_can_access(uuid,uuid,text,text,uuid,uuid,uuid,text)'::REGPROCEDURE,
  'platform_private.staff_resource_context(uuid,text,text,uuid)'::REGPROCEDURE,
  'platform_private.staff_has_permission(uuid,uuid,text)'::REGPROCEDURE,
  'platform_private.staff_membership_identity(uuid,uuid)'::REGPROCEDURE,
  'platform_private.staff_access_evaluate(uuid,uuid,text,text,uuid,boolean)'::REGPROCEDURE,
  'platform_private.staff_can_access(uuid,uuid,text,text,uuid)'::REGPROCEDURE,
  'platform_private.staff_can_access_for_actor(uuid,text,text,uuid)'::REGPROCEDURE,
  'platform.current_actor_authority()'::REGPROCEDURE,
  'platform_private.staff_can_take_needs_curator_case(uuid,uuid,uuid)'::REGPROCEDURE,
  'platform_private.needs_curator_case_last_curator(uuid,uuid)'::REGPROCEDURE,
  'platform_private.staff_can_take_direct_needs_curator_case(uuid,uuid,uuid)'::REGPROCEDURE,
  'platform_private.direct_needs_curator_case_author(uuid,uuid)'::REGPROCEDURE,
  'private.platform_can_read_student_case(uuid,uuid)'::REGPROCEDURE,
  'private.platform_can_read_communication_full(uuid,uuid)'::REGPROCEDURE,
  'private.platform_can_read_canonical_lead(uuid,uuid)'::REGPROCEDURE]);

-- ---------------------------------------------------------------------------
-- Fixture, part 1. Organization 1: 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager (department A), 3 Sales Manager (department B), 4 Sales (own scope, in
-- department A), 5 Admissions Manager (department «Admissions»), 6 Admissions (own scope),
-- 7 Admissions (direction CN), 8 record scopes (one case, one lead, one conversation),
-- 9 organization-wide reader, 11 Sales Manager A (suspended later), 12 Admissions (blocked
-- profile later), 13 Admissions (assignment revoked later), 14 staff without any role,
-- 15 mixed (Admissions own + Sales Manager department A + register reader organization),
-- 16 Admissions Manager department + Sales own (two roles), 17 a lead reader whose only assignment is a
-- record scope on a CASE (an assignment the command refuses to make but the evaluator still reads);
-- 18 a register reader by RECORD scope who also holds two broad assignments that must not count (a role
-- whose current bundle is no longer the bundle of the assignment, and a role whose bundle is retired),
-- 19 a member with the coarse role «admin» who is not a system Admin (Sales Manager, own scope),
-- 22 a member with the coarse role «sales» (Sales, own scope); 10 Student. Organization 2:
-- 20 Admin, 21 Sales Manager (own). 99 is an Auth user with no membership.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE pw_actors(n INTEGER, org INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO pw_actors(n, org, coarse) VALUES
  (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, NULL), (5, 1, NULL), (6, 1, NULL), (7, 1, NULL),
  (8, 1, NULL), (9, 1, NULL), (10, 1, 'student'), (11, 1, NULL), (12, 1, NULL), (13, 1, NULL),
  (14, 1, NULL), (15, 1, NULL), (16, 1, NULL), (17, 1, NULL), (18, 1, NULL), (19, 1, 'admin'), (22, 1, 'sales'),
  (20, 2, 'admin'), (21, 2, NULL);
GRANT SELECT ON pw_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.pw_id(1), 'PW Fictional organization'),
  (pg_temp.pw_id(2), 'PW Second organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.pw_id(100 + n), 'pw-' || n || '@example.invalid', '{}'::JSONB FROM pw_actors
  UNION ALL SELECT pg_temp.pw_id(199), 'pw-none@example.invalid', '{}'::JSONB;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.pw_id(200 + n), pg_temp.pw_id(100 + n), 'PW Actor ' || n, 'active', 1 FROM pw_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.pw_id(300 + a.n), pg_temp.pw_id(a.org), pg_temp.pw_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM pw_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.pw_id(301), pg_temp.pw_id(320));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.pw_id(401), pg_temp.pw_id(1), 'organization', pg_temp.pw_id(1), 1),
  (pg_temp.pw_id(402), pg_temp.pw_id(2), 'organization', pg_temp.pw_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.pw_id(1), pg_temp.pw_id(301), pg_temp.pw_id(401), 1, 1, TRUE, 'system', 'PW synthetic organization scope', pg_temp.pw_id(601)),
  (pg_temp.pw_id(2), pg_temp.pw_id(320), pg_temp.pw_id(402), 1, 1, TRUE, 'system', 'PW synthetic organization scope', pg_temp.pw_id(602)),
  -- The Student's cabinet: the organization scope that makes the Student a live actor row.
  (pg_temp.pw_id(1), pg_temp.pw_id(310), pg_temp.pw_id(401), 1, 1, TRUE, 'system', 'PW synthetic student scope', pg_temp.pw_id(603));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.pw_id(901), pg_temp.pw_id(1), 'PW Sales A'),
  (pg_temp.pw_id(902), pg_temp.pw_id(1), 'PW Admissions'),
  (pg_temp.pw_id(903), pg_temp.pw_id(1), 'PW Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.pw_id(1), pg_temp.pw_id(302), pg_temp.pw_id(901)),
  (pg_temp.pw_id(1), pg_temp.pw_id(311), pg_temp.pw_id(901)),
  (pg_temp.pw_id(1), pg_temp.pw_id(304), pg_temp.pw_id(901)),
  (pg_temp.pw_id(1), pg_temp.pw_id(315), pg_temp.pw_id(901)),
  (pg_temp.pw_id(1), pg_temp.pw_id(303), pg_temp.pw_id(903)),
  (pg_temp.pw_id(1), pg_temp.pw_id(305), pg_temp.pw_id(902)),
  (pg_temp.pw_id(1), pg_temp.pw_id(306), pg_temp.pw_id(902)),
  (pg_temp.pw_id(1), pg_temp.pw_id(307), pg_temp.pw_id(902)),
  (pg_temp.pw_id(1), pg_temp.pw_id(312), pg_temp.pw_id(902)),
  (pg_temp.pw_id(1), pg_temp.pw_id(313), pg_temp.pw_id(902)),
  (pg_temp.pw_id(1), pg_temp.pw_id(316), pg_temp.pw_id(902));

-- Roles with the production permission keys (as in 247's, 307's and 309's suites).
CREATE TEMP TABLE pw_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO pw_roles VALUES
 (pg_temp.pw_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.pw_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.pw_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.pw_id(1105), 'Sales', '["case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","finance.read.summary","lead.read","lead.sales.workflow.manage","sales.register.read","staff.task.read","task.create"]', 1150),
 (pg_temp.pw_id(1107), 'Register reader', '["sales.register.read"]', 1170),
 (pg_temp.pw_id(1109), 'Organization reader', '["case.read.full","client.read","communication.read.full","lead.read","sales.register.read"]', 1190),
 (pg_temp.pw_id(1111), 'Conversation only', '["communication.read.full"]', 1210),
 (pg_temp.pw_id(1113), 'Lead only', '["lead.read"]', 1230),
 (pg_temp.pw_id(1115), 'Register own', '["sales.register.read"]', 1250),
 (pg_temp.pw_id(1121), 'Stale wide', '["case.read.full","communication.read.full","lead.read","sales.register.read"]', 1310),
 (pg_temp.pw_id(1123), 'Retired wide', '["case.read.full","communication.read.full","lead.read","sales.register.read"]', 1330),
 (pg_temp.pw_id(1117), 'Case only', '["case.read.full"]', 1270),
 (pg_temp.pw_id(1119), 'Direction reader', '["case.read.full","communication.read.full","lead.read"]', 1290),
 (pg_temp.pw_id(1301), 'Fuzz case and conversation', '["case.read.full","communication.read.full"]', 1350),
 (pg_temp.pw_id(1303), 'Fuzz lead and register', '["lead.read","sales.register.read"]', 1370),
 (pg_temp.pw_id(1305), 'Fuzz all', '["lead.read","communication.read.full","case.read.full","sales.register.read","case.curator.assign"]', 1390);
CREATE TEMP TABLE pw_grants(membership INTEGER, role_id UUID, scope JSONB);
GRANT SELECT ON pw_roles, pw_grants TO authenticated;

-- Roles are created and published by the real commands as the system Admin of organization 1.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.pw_id(101),
  'claims', jsonb_build_object('sub', pg_temp.pw_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS pw_admin_setup \gset
SET LOCAL request.jwt.claims TO :'pw_admin_setup';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE pw_bundles(role_id UUID, bundle_id UUID);
GRANT SELECT, INSERT ON pw_bundles TO authenticated;
DO $pw_roles$
DECLARE r RECORD; published JSONB;
BEGIN
  FOR r IN SELECT * FROM pw_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.pw_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'PW ' || r.label, 'description', 'Migration 310 synthetic role',
        'permissionKeys', r.keys), 'PW create role', pg_temp.pw_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.pw_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.pw_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'PW publish role', pg_temp.pw_id(r.request_base + 2));
    INSERT INTO pw_bundles VALUES (r.role_id, (published ->> 'bundleId')::UUID);
  END LOOP;
END
$pw_roles$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Fixture, part 2: the data (replica mode skips the business triggers; every CHECK and FK
-- still applies). Leads 1-36 (36 and 35 have no case), cases 1-30 (27-30 have no lead),
-- conversations of four kinds, messages, register records, journal rows.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, created_at, updated_at)
SELECT pg_temp.pw_id(2000 + i), pg_temp.pw_id(1), 'PW Client ' || i,
  platform_private.normalize_person_name('PW Client ' || i),
  TIMESTAMPTZ '2026-09-01 00:00:00+00' + make_interval(hours => i),
  TIMESTAMPTZ '2026-09-01 00:00:00+00' + make_interval(hours => i)
FROM generate_series(1, 40) AS i;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name)
  VALUES (pg_temp.pw_id(2900), pg_temp.pw_id(2), 'PW Foreign Client', platform_private.normalize_person_name('PW Foreign Client'));

-- Leads: owner cycles through the actors and NULL; every seventh is archived, every ninth converted.
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  lifecycle_state, created_at, updated_at)
SELECT pg_temp.pw_id(3000 + i), pg_temp.pw_id(1), pg_temp.pw_id(2000 + i),
  CASE i % 10 WHEN 0 THEN pg_temp.pw_id(301) WHEN 1 THEN pg_temp.pw_id(302) WHEN 2 THEN pg_temp.pw_id(303)
    WHEN 3 THEN pg_temp.pw_id(304) WHEN 4 THEN pg_temp.pw_id(305) WHEN 5 THEN pg_temp.pw_id(306)
    WHEN 6 THEN pg_temp.pw_id(315) WHEN 7 THEN NULL WHEN 8 THEN pg_temp.pw_id(316) ELSE pg_temp.pw_id(311) END,
  (ARRAY['new', 'contacting', 'qualified', 'meeting_scheduled', 'meeting_completed', 'potential'])[i % 6 + 1],
  'pw',
  CASE WHEN i % 9 = 0 THEN 'converted'::platform.lead_lifecycle_state
    WHEN i % 7 = 0 THEN 'archived'::platform.lead_lifecycle_state ELSE 'open'::platform.lead_lifecycle_state END,
  TIMESTAMPTZ '2026-09-01 00:00:00+00' + make_interval(hours => i),
  TIMESTAMPTZ '2026-09-10 00:00:00+00' + make_interval(hours => i)
FROM generate_series(1, 36) AS i;
INSERT INTO platform.leads(id, organization_id, client_id, stage_key, source_key)
  VALUES (pg_temp.pw_id(3900), pg_temp.pw_id(2), pg_temp.pw_id(2900), 'new', 'pw');

-- Cases: state cycles pending / active / closed; curator, responsible sales and direction cycle.
INSERT INTO platform.student_cases(id, organization_id, canonical_lead_id, canonical_client_id,
  responsible_sales_membership_id, current_curator_membership_id, source_key, student_display_name,
  target_country, target_degree, state, handoff_at, closed_at, admissions_direction,
  current_scope_id, current_scope_version, created_at, updated_at)
SELECT pg_temp.pw_id(4000 + j), pg_temp.pw_id(1),
  CASE WHEN j <= 26 THEN pg_temp.pw_id(3000 + j) END, CASE WHEN j <= 26 THEN pg_temp.pw_id(2000 + j) END,
  (ARRAY[pg_temp.pw_id(302), pg_temp.pw_id(303), pg_temp.pw_id(304), pg_temp.pw_id(315)])[j % 4 + 1],
  CASE WHEN j % 3 = 1 THEN NULL WHEN j = 3 THEN pg_temp.pw_id(315) ELSE
    (ARRAY[pg_temp.pw_id(305), pg_temp.pw_id(306), pg_temp.pw_id(307), pg_temp.pw_id(316), pg_temp.pw_id(301),
      pg_temp.pw_id(312), pg_temp.pw_id(313), pg_temp.pw_id(308)])[j % 8 + 1] END,
  CASE WHEN j = 7 THEN 'admissions-direct:' || pg_temp.pw_id(3000 + j)::TEXT ELSE 'pw:case:' || j END,
  'PW Student ' || j, 'China', 'Bachelor',
  (CASE j % 3 WHEN 1 THEN 'pending' WHEN 2 THEN 'active' ELSE 'closed' END)::platform.student_case_state,
  CASE WHEN j % 3 = 1 THEN NULL ELSE TIMESTAMPTZ '2026-09-15 00:00:00+00' + make_interval(hours => j) END,
  CASE WHEN j % 3 = 0 THEN TIMESTAMPTZ '2026-10-01 00:00:00+00' + make_interval(hours => j) END,
  (ARRAY['CN', 'MY', 'EUROPE', 'AE', 'TR', NULL])[j % 6 + 1],
  pg_temp.pw_id(401), 1,
  TIMESTAMPTZ '2026-09-02 00:00:00+00' + make_interval(hours => j),
  TIMESTAMPTZ '2026-10-02 00:00:00+00' + make_interval(hours => j)
FROM generate_series(1, 30) AS j;

-- The «ждёт куратора» branches. Case 1: the last curator declined it and a sale stands behind the
-- lead (route 1: a register row with that lead); case 4: declined, no sale evidence (not
-- takeable); case 7: a direct-admissions case waiting for a curator (route 2: the receipt).
INSERT INTO platform.student_case_lifecycle_events(organization_id, student_case_id, event_type, previous_state,
  new_state, actor_membership_id, reason, request_id) VALUES
  (pg_temp.pw_id(1), pg_temp.pw_id(4001), 'declined', 'active', 'pending', pg_temp.pw_id(305), 'PW declined', pg_temp.pw_id(7001)),
  (pg_temp.pw_id(1), pg_temp.pw_id(4004), 'declined', 'active', 'pending', pg_temp.pw_id(305), 'PW declined', pg_temp.pw_id(7002));
INSERT INTO platform_private.admissions_direct_case_receipts(request_id, organization_id, actor_membership_id, fingerprint,
  student_case_id, client_id, lead_id, receipt) VALUES
  (pg_temp.pw_id(7003), pg_temp.pw_id(1), pg_temp.pw_id(301), repeat('c', 32), pg_temp.pw_id(4007),
   pg_temp.pw_id(2007), pg_temp.pw_id(3007), '{}'::JSONB);

-- Webhook events: one for creation, one verified inbound per bound lead chat, two history ones.
CREATE FUNCTION pg_temp.pw_event(p_n INTEGER, p_kind TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_kind = 'verified' THEN
    INSERT INTO platform_private.provider_webhook_events(id, organization_id, provider, provider_account_ref, provider_request_id,
      payload_id, event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
      verification_evidence_ref, payload_sha256, request_id, waha_session_name)
    VALUES (pg_temp.pw_id(8000 + p_n), pg_temp.pw_id(1), 'waha', 'waha:pw-session', 'pw-req-' || p_n, 'pw-payload-' || p_n,
      'message', TIMESTAMPTZ '2026-09-20 00:00:00+00', 'verified',
      '{"payload":{"fromMe":false,"source":"app"}}'::JSONB, '{"hmac_verified":true}'::JSONB, 'pw:ev:' || p_n,
      repeat('a', 64), pg_temp.pw_id(8500 + p_n), 'pw-session');
  ELSIF p_kind = 'history' THEN
    INSERT INTO platform_private.provider_webhook_events(id, organization_id, provider, provider_account_ref, provider_request_id,
      payload_id, event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
      verification_evidence_ref, payload_sha256, request_id, waha_session_name)
    VALUES (pg_temp.pw_id(8000 + p_n), pg_temp.pw_id(1), 'waha', 'waha:crm_primary', 'pw-req-' || p_n, 'pw-payload-' || p_n,
      'history.message', TIMESTAMPTZ '2026-09-20 00:00:00+00', 'missing',
      '{"payload":{"fromMe":false}}'::JSONB,
      '{"provenance":"api_history","webhook_verified":false,"read_only":true}'::JSONB, 'pw:ev:' || p_n,
      repeat('b', 64), pg_temp.pw_id(8500 + p_n), 'crm_primary');
  ELSE
    INSERT INTO platform_private.provider_webhook_events(id, organization_id, provider, provider_account_ref, provider_request_id,
      payload_id, event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
      verification_evidence_ref, payload_sha256, request_id, waha_session_name)
    VALUES (pg_temp.pw_id(8000 + p_n), pg_temp.pw_id(1), 'waha', 'waha:pw-session', 'pw-req-' || p_n, 'pw-payload-' || p_n,
      'message.any', TIMESTAMPTZ '2026-09-20 00:00:00+00', 'verified',
      '{"payload":{"fromMe":false}}'::JSONB, '{"hmac_verified":true}'::JSONB, 'pw:ev:' || p_n,
      repeat('c', 64), pg_temp.pw_id(8500 + p_n), 'pw-session');
  END IF;
END $$;
SELECT pg_temp.pw_event(0, 'plain');
SELECT pg_temp.pw_event(i, 'verified') FROM generate_series(1, 10) AS i;
SELECT pg_temp.pw_event(i, 'history') FROM generate_series(11, 12) AS i;

-- Conversations. Kind A (ids 5001-5015): the lead's own sales chat, platform_intake (leads 1-15);
-- 1-10 are bound by a verified WhatsApp message, 11-12 by a read-only history import, 13-14 are
-- unbound, 15 has another client than its lead. Kind B (5101-5130): the curator chat of a case in
-- work. Kind C: the sales chat of a pending case. Kind D (5301-5304): no case and no lead.
INSERT INTO platform.communication_conversations(id, organization_id, responsible_sales_membership_id,
  current_curator_membership_id, queue, status, subject, waha_session_name, current_scope_id, current_scope_version,
  created_from_webhook_event_id, sales_authority_source, canonical_client_id, canonical_lead_id, student_case_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id, created_at, updated_at)
SELECT pg_temp.pw_id(5000 + i), pg_temp.pw_id(1),
  COALESCE(l.current_owner_membership_id, pg_temp.pw_id(302)), NULL, 'sales', 'open', 'PW lead chat ' || i,
  CASE WHEN i IN (11, 12) THEN 'crm_primary' ELSE 'pw-session' END, pg_temp.pw_id(401), 1, pg_temp.pw_id(8000),
  'platform_intake', CASE WHEN i = 15 THEN pg_temp.pw_id(2040) ELSE l.client_id END, l.id, NULL,
  NULL, NULL, NULL, TIMESTAMPTZ '2026-09-20 00:00:00+00' + make_interval(hours => i),
  TIMESTAMPTZ '2026-09-20 00:00:00+00' + make_interval(hours => i)
FROM generate_series(1, 15) AS i JOIN platform.leads AS l ON l.id = pg_temp.pw_id(3000 + i);
INSERT INTO platform_private.waha_direct_chat_bindings(organization_id, waha_session_name, normalized_chat_id,
  conversation_id, source_webhook_event_id)
SELECT pg_temp.pw_id(1), CASE WHEN i IN (11, 12) THEN 'crm_primary' ELSE 'pw-session' END, '1555000' || i || '@c.us',
  pg_temp.pw_id(5000 + i), pg_temp.pw_id(8000 + i)
FROM generate_series(1, 12) AS i;

INSERT INTO platform.communication_conversations(id, organization_id, responsible_sales_membership_id,
  current_curator_membership_id, queue, status, subject, waha_session_name, current_scope_id, current_scope_version,
  created_from_webhook_event_id, sales_authority_source, student_case_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id, created_at, updated_at)
SELECT pg_temp.pw_id(5100 + c.j), pg_temp.pw_id(1), c.responsible_sales_membership_id,
  CASE WHEN c.state <> 'pending' THEN c.current_curator_membership_id END,
  CASE WHEN c.state <> 'pending' THEN 'curator'::platform.communication_queue ELSE 'sales'::platform.communication_queue END,
  'open', 'PW case chat ' || c.j, 'pw-session', pg_temp.pw_id(401), 1, pg_temp.pw_id(8000), 'provider_linked',
  c.id, 1, 9000 + c.j, 9500 + c.j,
  TIMESTAMPTZ '2026-09-21 00:00:00+00' + make_interval(hours => c.j),
  TIMESTAMPTZ '2026-09-21 00:00:00+00' + make_interval(hours => c.j)
FROM (SELECT substring(id::TEXT FROM 33)::INTEGER - 4000 AS j, * FROM platform.student_cases) AS c
WHERE c.organization_id = pg_temp.pw_id(1);
INSERT INTO platform.communication_conversations(id, organization_id, responsible_sales_membership_id,
  queue, status, subject, waha_session_name, current_scope_id, current_scope_version,
  created_from_webhook_event_id, sales_authority_source, amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  created_at, updated_at)
SELECT pg_temp.pw_id(5300 + k), pg_temp.pw_id(1), (ARRAY[pg_temp.pw_id(302), pg_temp.pw_id(304), pg_temp.pw_id(315), pg_temp.pw_id(303)])[k],
  'sales', 'open', 'PW loose chat ' || k, 'pw-session', pg_temp.pw_id(401), 1, pg_temp.pw_id(8000), 'provider_linked',
  1, 9800 + k, 9900 + k, TIMESTAMPTZ '2026-09-22 00:00:00+00' + make_interval(hours => k),
  TIMESTAMPTZ '2026-09-22 00:00:00+00' + make_interval(hours => k)
FROM generate_series(1, 4) AS k;
-- Chats in unusual places: the SALES queue on an active case (2), the CURATOR queue on a pending case (1).
INSERT INTO platform.communication_conversations(id, organization_id, responsible_sales_membership_id,
  current_curator_membership_id, queue, status, subject, waha_session_name, current_scope_id, current_scope_version,
  created_from_webhook_event_id, sales_authority_source, student_case_id, amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  created_at, updated_at)
SELECT pg_temp.pw_id(5400 + x.j), pg_temp.pw_id(1), c.responsible_sales_membership_id,
  CASE x.q WHEN 'curator' THEN pg_temp.pw_id(306) END, x.q::platform.communication_queue, 'open', 'PW odd chat ' || x.j,
  'pw-session', pg_temp.pw_id(401), 1, pg_temp.pw_id(8000), 'provider_linked', c.id, 1, 9700 + x.j, 9750 + x.j,
  TIMESTAMPTZ '2026-09-23 00:00:00+00' + make_interval(hours => x.j), TIMESTAMPTZ '2026-09-23 00:00:00+00' + make_interval(hours => x.j)
FROM (VALUES (2, 'sales'), (1, 'curator')) AS x(j, q) JOIN platform.student_cases c ON c.id = pg_temp.pw_id(4000 + x.j);

-- Organization 2 has its own event and conversation (isolation).
INSERT INTO platform_private.provider_webhook_events(id, organization_id, provider, provider_account_ref, provider_request_id,
  payload_id, event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
  verification_evidence_ref, payload_sha256, request_id, waha_session_name)
VALUES (pg_temp.pw_id(8900), pg_temp.pw_id(2), 'waha', 'waha:pw-session', 'pw-req-foreign', 'pw-payload-foreign',
  'message.any', TIMESTAMPTZ '2026-09-20 00:00:00+00', 'verified', '{"payload":{"fromMe":false}}'::JSONB,
  '{"hmac_verified":true}'::JSONB, 'pw:ev:foreign', repeat('d', 64), pg_temp.pw_id(8990), 'pw-session');
INSERT INTO platform.communication_conversations(id, organization_id, responsible_sales_membership_id,
  queue, status, subject, waha_session_name, current_scope_id, current_scope_version,
  created_from_webhook_event_id, sales_authority_source, amocrm_account_id, amocrm_lead_id, amocrm_contact_id)
VALUES (pg_temp.pw_id(5900), pg_temp.pw_id(2), pg_temp.pw_id(321), 'sales', 'open', 'PW foreign chat', 'pw-session',
  pg_temp.pw_id(402), 1, pg_temp.pw_id(8900), 'provider_linked', 7, 7001, 7002);
-- ... and its own case with the case chat of its curator.
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, state, handoff_at, admissions_direction,
  current_scope_id, current_scope_version)
VALUES (pg_temp.pw_id(4900), pg_temp.pw_id(2), pg_temp.pw_id(321), pg_temp.pw_id(320), 'pw:foreign-case', 'PW Foreign Student',
  'China', 'Bachelor', 'active', TIMESTAMPTZ '2026-09-16 00:00:00+00', 'CN', pg_temp.pw_id(402), 1);
INSERT INTO platform.communication_conversations(id, organization_id, responsible_sales_membership_id,
  current_curator_membership_id, queue, status, subject, waha_session_name, current_scope_id, current_scope_version,
  created_from_webhook_event_id, sales_authority_source, student_case_id, amocrm_account_id, amocrm_lead_id, amocrm_contact_id)
VALUES (pg_temp.pw_id(5901), pg_temp.pw_id(2), pg_temp.pw_id(321), pg_temp.pw_id(320), 'curator', 'open', 'PW foreign case chat',
  'pw-session', pg_temp.pw_id(402), 1, pg_temp.pw_id(8900), 'provider_linked', pg_temp.pw_id(4900), 7, 7011, 7012);

-- Participants and messages. Conversation number rn gets (rn % 5) messages, alternating inbound /
-- outbound from the inbound side, so some chats wait for an answer (the last message is inbound)
-- and some do not, and some have none.
CREATE TEMP TABLE pw_conv_order AS
  SELECT c.id, row_number() OVER (ORDER BY c.id) AS rn FROM platform.communication_conversations AS c
  WHERE c.organization_id = pg_temp.pw_id(1);
INSERT INTO platform.conversation_participants(id, organization_id, conversation_id, participant_kind, membership_id,
  external_subject_ref, source_webhook_event_id)
SELECT pg_temp.pw_id(6000 + o.rn * 2 + s.k), pg_temp.pw_id(1), o.id,
  CASE s.k WHEN 0 THEN 'customer'::platform.conversation_participant_kind ELSE 'sales'::platform.conversation_participant_kind END,
  CASE s.k WHEN 0 THEN NULL ELSE pg_temp.pw_id(302) END,
  CASE s.k WHEN 0 THEN 'pw-customer-' || o.rn END,
  pg_temp.pw_id(8000)
FROM pw_conv_order AS o CROSS JOIN (VALUES (0), (1)) AS s(k);
INSERT INTO platform.communication_messages(id, organization_id, conversation_id, sender_participant_id, direction, body_text,
  language, source_webhook_event_id, created_at, message_identity_source, waha_message_id, waha_session_name)
SELECT pg_temp.pw_id(60000 + o.rn * 10 + m.k), pg_temp.pw_id(1), o.id,
  pg_temp.pw_id(6000 + o.rn * 2 + CASE WHEN m.k % 2 = 0 THEN 0 ELSE 1 END),
  CASE WHEN m.k % 2 = 0 THEN 'inbound'::platform.communication_direction ELSE 'outbound'::platform.communication_direction END,
  'PW message ' || o.rn || '/' || m.k, 'en', pg_temp.pw_id(8000),
  TIMESTAMPTZ '2026-09-25 00:00:00+00' + make_interval(hours => o.rn::INTEGER, mins => m.k::INTEGER),
  CASE WHEN m.k % 2 = 0 THEN 'public_provider_id' ELSE 'private_waha_phone_binding' END,
  CASE WHEN m.k % 2 = 0 THEN 'pw-msg-' || o.rn || '-' || m.k END,
  CASE WHEN m.k % 2 = 0 THEN 'pw-session' END
FROM pw_conv_order AS o CROSS JOIN generate_series(0, 3) AS m(k)
WHERE m.k < (o.rn % 5);

-- Sales register: manual records, owners cycle through the actors and NULL; two archived; one
-- record carries the lead that stands behind case 1 (the sale evidence of the «ждёт куратора» branch).
CREATE FUNCTION pg_temp.pw_fields(p_name TEXT, p_signing DATE, p_cost BIGINT, p_manager TEXT) RETURNS JSONB
  LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('applicant_name', p_name, 'phone', '', 'signing_date', p_signing, 'manager_label', p_manager,
    'status_raw', '', 'service_cost_minor', p_cost, 'service_cost_currency', 'USD', 'paid_minor', p_cost,
    'paid_currency', 'USD', 'needs_review', FALSE)
$$;
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields, archived)
SELECT pg_temp.pw_id(9000 + i), pg_temp.pw_id(1), (DATE '2026-07-01' + make_interval(months => i % 3))::DATE,
  CASE i % 8 WHEN 0 THEN pg_temp.pw_id(301) WHEN 1 THEN pg_temp.pw_id(302) WHEN 2 THEN pg_temp.pw_id(303)
    WHEN 3 THEN pg_temp.pw_id(304) WHEN 4 THEN pg_temp.pw_id(315) WHEN 5 THEN pg_temp.pw_id(311)
    WHEN 6 THEN NULL ELSE pg_temp.pw_id(316) END,
  'manual', pg_temp.pw_fields('PW Sale ' || i, (DATE '2026-07-05' + make_interval(days => i * 2, months => i % 3))::DATE,
    100000 + i * 1000, 'PW Manager ' || (i % 3)),
  i IN (5, 17)
FROM generate_series(1, 24) AS i;
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields,
  lead_id, client_id, source_snapshot)
VALUES (pg_temp.pw_id(9100), pg_temp.pw_id(1), DATE '2026-09-01', pg_temp.pw_id(302), 'pipeline',
  pg_temp.pw_fields('PW Sale lead 1', DATE '2026-09-03', 50000, 'PW Manager 0'), pg_temp.pw_id(3001), pg_temp.pw_id(2001),
  '{"review_flags":[]}'::JSONB);
INSERT INTO platform_private.sales_register(id, organization_id, report_month, owner_membership_id, source_kind, fields)
VALUES (pg_temp.pw_id(9200), pg_temp.pw_id(2), DATE '2026-07-01', pg_temp.pw_id(321), 'manual',
  pg_temp.pw_fields('PW Foreign Sale', DATE '2026-07-04', 70000, 'PW Foreign Manager'));

-- Case tasks and journal rows for the history of cases 2, 3, 5 and 8 (tasks, conversation link,
-- recorded messages; the other messages stay without a journal row on purpose).
INSERT INTO platform.case_tasks(id, organization_id, student_case_id, task_type, title, assignee_membership_id, created_by_membership_id)
SELECT pg_temp.pw_id(9300 + j), pg_temp.pw_id(1), pg_temp.pw_id(4000 + j), 'follow_up', 'PW task ' || j,
  pg_temp.pw_id(306), pg_temp.pw_id(301)
FROM unnest(ARRAY[2, 3, 5, 8]) AS j;
INSERT INTO platform.payment_obligations(id, organization_id, student_case_id, label, category, amount_minor, currency, created_by_membership_id)
SELECT pg_temp.pw_id(9500 + j), pg_temp.pw_id(1), pg_temp.pw_id(4000 + j), 'PW obligation ' || j, 'evo_service_fee', 100000, 'USD', pg_temp.pw_id(301)
FROM unnest(ARRAY[2, 3, 5, 8]) AS j;
INSERT INTO platform.audit_events(id, organization_id, actor_kind, actor_principal, action, resource_type, resource_id,
  before_state, after_state, reason, request_id, created_at)
SELECT pg_temp.pw_id(9400 + j * 10 + e.k), pg_temp.pw_id(1), 'system', 'pw:fixture', e.action, e.rtype,
  CASE e.rtype WHEN 'student_case' THEN pg_temp.pw_id(4000 + j) WHEN 'case_task' THEN pg_temp.pw_id(9300 + j)
    WHEN 'communication_conversation' THEN pg_temp.pw_id(5100 + j) WHEN 'payment_obligation' THEN pg_temp.pw_id(9500 + j)
    ELSE pg_temp.pw_id(60000 + (SELECT o.rn FROM pw_conv_order o WHERE o.id = pg_temp.pw_id(5100 + j)) * 10) END,
  CASE WHEN e.action = 'task.change' THEN '{"status":"open"}'::JSONB END,
  CASE WHEN e.action = 'task.change' THEN '{"status":"done"}'::JSONB ELSE '{}'::JSONB END,
  'PW fixture', pg_temp.pw_id(9600 + j * 10 + e.k),
  TIMESTAMPTZ '2026-10-03 00:00:00+00' + make_interval(hours => j * 10 + e.k)
FROM unnest(ARRAY[2, 3, 5, 8]) AS j
CROSS JOIN (VALUES (0, 'case.create', 'student_case'), (1, 'task.create', 'case_task'), (2, 'task.change', 'case_task'),
  (3, 'communication.conversation.create', 'communication_conversation'),
  (4, 'communication.message.record', 'communication_message'),
  (5, 'finance.obligation.create', 'payment_obligation')) AS e(k, action, rtype);

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Fixture, part 3: assignments by the real command, then tokens from the real hook.
-- ---------------------------------------------------------------------------
INSERT INTO pw_grants VALUES
 (302, pg_temp.pw_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.pw_id(901), 'resourceKind', NULL)),
 (303, pg_temp.pw_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.pw_id(903), 'resourceKind', NULL)),
 (304, pg_temp.pw_id(1105), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (305, pg_temp.pw_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.pw_id(902), 'resourceKind', NULL)),
 (306, pg_temp.pw_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (307, pg_temp.pw_id(1119), jsonb_build_object('kind', 'direction', 'key', 'CN', 'resourceKind', NULL)),
 (308, pg_temp.pw_id(1117), jsonb_build_object('kind', 'record', 'key', pg_temp.pw_id(4003), 'resourceKind', 'student_case')),
 (308, pg_temp.pw_id(1113), jsonb_build_object('kind', 'record', 'key', pg_temp.pw_id(3005), 'resourceKind', 'lead')),
 (308, pg_temp.pw_id(1111), jsonb_build_object('kind', 'record', 'key', pg_temp.pw_id(5107), 'resourceKind', 'conversation')),
 (308, pg_temp.pw_id(1111), jsonb_build_object('kind', 'record', 'key', pg_temp.pw_id(4010), 'resourceKind', 'student_case')),
 (318, pg_temp.pw_id(1115), jsonb_build_object('kind', 'record', 'key', pg_temp.pw_id(9003), 'resourceKind', 'sales_register')),
 (319, pg_temp.pw_id(1103), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (322, pg_temp.pw_id(1105), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (309, pg_temp.pw_id(1109), jsonb_build_object('kind', 'organization', 'key', pg_temp.pw_id(1), 'resourceKind', NULL)),
 (311, pg_temp.pw_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.pw_id(901), 'resourceKind', NULL)),
 (312, pg_temp.pw_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (313, pg_temp.pw_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (315, pg_temp.pw_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (315, pg_temp.pw_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.pw_id(901), 'resourceKind', NULL)),
 (315, pg_temp.pw_id(1107), jsonb_build_object('kind', 'organization', 'key', pg_temp.pw_id(1), 'resourceKind', NULL)),
 (316, pg_temp.pw_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.pw_id(902), 'resourceKind', NULL)),
 (316, pg_temp.pw_id(1105), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL));
CREATE TEMP TABLE pw_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.pw_id(1);
GRANT SELECT ON pw_versions TO authenticated;
SET LOCAL request.jwt.claims TO :'pw_admin_setup';
SET LOCAL ROLE authenticated;
-- First an ORGANIZATION-wide assignment for four members; the real grant below replaces it, so the
-- wide assignment stays in the table as a REVOKED row beside the live narrow one (as in production,
-- where revoked organization-scope rows sit next to live ones): a revoked row must never widen anything.
DO $pw_wide$
DECLARE m INTEGER; r UUID;
BEGIN
  FOR m, r IN SELECT * FROM (VALUES (306, pg_temp.pw_id(1101)), (302, pg_temp.pw_id(1103)), (304, pg_temp.pw_id(1105)), (316, pg_temp.pw_id(1102))) AS t(m, r) LOOP
    PERFORM platform.staff_role_assignments_save(pg_temp.pw_id(1), pg_temp.pw_id(m),
      (SELECT p.access_version FROM platform.profiles p JOIN platform.organization_memberships mm ON mm.profile_id = p.id WHERE mm.id = pg_temp.pw_id(m)),
      jsonb_build_array(jsonb_build_object('roleId', r, 'scope', jsonb_build_object('kind', 'organization', 'key', pg_temp.pw_id(1), 'resourceKind', NULL))),
      jsonb_build_array(jsonb_build_object('roleId', r, 'roleVersion', 2,
        'bundleId', (SELECT b.bundle_id FROM pw_bundles b WHERE b.role_id = r), 'bundleVersion', 1)),
      'PW wide first', pg_temp.pw_id(2500 + m));
  END LOOP;
END
$pw_wide$;
DO $pw_grant$
DECLARE m INTEGER; items JSONB; bindings JSONB;
BEGIN
  FOR m IN SELECT DISTINCT membership FROM pw_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id, g.scope::TEXT),
      jsonb_agg(DISTINCT jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (SELECT b.bundle_id FROM pw_bundles b WHERE b.role_id = g.role_id), 'bundleVersion', 1))
      INTO items, bindings FROM pw_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.pw_id(1), pg_temp.pw_id(m),
      (SELECT p.access_version FROM platform.profiles p JOIN platform.organization_memberships mm ON mm.profile_id = p.id WHERE mm.id = pg_temp.pw_id(m)),
      items, bindings, 'PW grant roles', pg_temp.pw_id(2000 + m));
  END LOOP;
END
$pw_grant$;
RESET ROLE;
-- Actor 17: the evaluator also reads a record scope on a CASE for a lead reader, which the command
-- refuses (a role with lead.read has no student_case record kind). Written straight into the table.
INSERT INTO platform.staff_role_assignments(organization_id, membership_id, role_id, bundle_id, scope_kind, scope_key, resource_kind)
SELECT pg_temp.pw_id(1), pg_temp.pw_id(317), pg_temp.pw_id(1113), b.bundle_id, 'record', pg_temp.pw_id(4005)::TEXT, 'student_case'
FROM pw_bundles b WHERE b.role_id = pg_temp.pw_id(1113);

-- Actor 18: two BROAD (organization) assignments that must count for nothing: one on a role whose
-- current bundle is no longer the bundle of the assignment (the role was republished), one on a role whose
-- bundle is retired. Both stay live rows, as stale rows do in production; the narrow record assignment of
-- 18 is what grants the register permission, so only the aggregate (not the gate) can let them in.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.staff_role_assignments(organization_id, membership_id, role_id, bundle_id, scope_kind, scope_key)
SELECT pg_temp.pw_id(1), pg_temp.pw_id(318), b.role_id, b.bundle_id, 'organization', pg_temp.pw_id(1)::TEXT
FROM pw_bundles b WHERE b.role_id IN (pg_temp.pw_id(1121), pg_temp.pw_id(1123));
UPDATE platform.staff_role_definitions SET current_bundle_id = (SELECT bundle_id FROM pw_bundles WHERE role_id = pg_temp.pw_id(1113))
  WHERE id = pg_temp.pw_id(1121);
UPDATE platform.role_bundle_versions SET status = 'retired'
  WHERE id = (SELECT bundle_id FROM pw_bundles WHERE role_id = pg_temp.pw_id(1123));
SET LOCAL session_replication_role = origin;

UPDATE pw_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.pw_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.pw_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
CREATE TEMP TABLE pw_claims AS SELECT n, claims FROM pw_actors;
INSERT INTO pw_claims VALUES
  (99, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.pw_id(199),
    'claims', jsonb_build_object('sub', pg_temp.pw_id(199), 'role', 'authenticated'))) -> 'claims')::TEXT);
GRANT SELECT ON pw_claims TO authenticated, anon, service_role;
-- An actor as a signed-in user.
CREATE FUNCTION pg_temp.pw_user(p_n INTEGER, p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.pw_run((SELECT claims FROM pw_claims WHERE n = p_n), 'authenticated', p_sql)
$$;
CREATE FUNCTION pg_temp.pw_user_error(p_n INTEGER, p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.pw_error((SELECT claims FROM pw_claims WHERE n = p_n), 'authenticated', p_sql)
$$;
-- The same actor, but the statement runs as the owner (for the private primitives): the identity
-- still comes from the claims (auth.uid(), auth.jwt()).
CREATE FUNCTION pg_temp.pw_owner(p_n INTEGER, p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.pw_run((SELECT claims FROM pw_claims WHERE n = p_n), NULL, p_sql)
$$;
-- A query as one comparable text: the count and the md5 of its rows in the order it returned them.
CREATE FUNCTION pg_temp.pw_q(p_query TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT count(*)::TEXT || '':'' || md5(COALESCE(jsonb_agg(to_jsonb(t))::TEXT, '''')) FROM (%s) AS t', p_query)
$$;
CREATE TEMP TABLE pw_results(label TEXT, n INTEGER, answer TEXT);
CREATE TEMP TABLE pw_lap_state(t TIMESTAMPTZ);
INSERT INTO pw_lap_state VALUES (clock_timestamp());
CREATE FUNCTION pg_temp.pw_lap(p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE previous TIMESTAMPTZ;
BEGIN
  SELECT t INTO previous FROM pw_lap_state;
  UPDATE pw_lap_state SET t = clock_timestamp();
  RAISE NOTICE 'PW310 lap % : % ms', p_label, round(extract(epoch FROM clock_timestamp() - previous) * 1000);
END $$;
-- Same answer from the new function and from the copy of the old body, for one actor.
CREATE FUNCTION pg_temp.pw_same(p_n INTEGER, p_label TEXT, p_new TEXT, p_old TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE a TEXT; b TEXT;
BEGIN
  a := pg_temp.pw_user(p_n, pg_temp.pw_q(p_new));
  b := pg_temp.pw_user(p_n, pg_temp.pw_q(p_old));
  IF a IS DISTINCT FROM b THEN
    RAISE EXCEPTION 'PW310: % for actor %: new % <> old %', p_label, p_n, a, b;
  END IF;
  INSERT INTO pw_results VALUES (p_label, p_n, a);
END $$;

-- The fixture is what the suite says it is.
SELECT pg_temp.pw_assert((SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.pw_id(1)) = 36
  AND (SELECT count(*) FROM platform.student_cases WHERE organization_id = pg_temp.pw_id(1)) = 30
  AND (SELECT count(*) FROM platform.communication_conversations WHERE organization_id = pg_temp.pw_id(1)) = 51
  AND (SELECT count(*) FROM platform_private.sales_register WHERE organization_id = pg_temp.pw_id(1)) = 25
  AND (SELECT count(*) FROM platform.staff_role_assignments WHERE organization_id = pg_temp.pw_id(1) AND revoked_at IS NULL) = 25
  AND (SELECT count(*) FROM platform.staff_role_assignments WHERE organization_id = pg_temp.pw_id(1) AND revoked_at IS NOT NULL) = 4,
  'fixture: 36 leads, 30 cases, 51 conversations, 25 register records, 25 live and 4 revoked assignments');
SELECT pg_temp.pw_assert(platform_private.staff_has_permission(pg_temp.pw_id(1), pg_temp.pw_id(302), 'lead.read')
  AND NOT platform_private.staff_has_permission(pg_temp.pw_id(1), pg_temp.pw_id(314), 'lead.read')
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.pw_id(1), pg_temp.pw_id(301))) = 'admin'
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.pw_id(1), pg_temp.pw_id(302))) = 'staff'
  AND NOT EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(pg_temp.pw_id(1), pg_temp.pw_id(310))),
  'fixture: the Admin is an admin, invited staff are staff, the Student is no staff, the role-less member has no permission');

-- pw_sets_only (the run at the end of the chain, see the runner) skips everything that needs the
-- released bodies: the sets and the mirror guard are compared with the LIVE per-row functions.
\if :{?pw_sets_only}
\else
-- ---------------------------------------------------------------------------
-- The previous bodies (released before 310) under temporary names, and their anchors.
-- ---------------------------------------------------------------------------
\ir platform_permission_once_old_bodies.sql
SELECT pg_temp.pw_assert(md5(p.prosrc) = e.released, e.fn::TEXT || ' (old copy) is byte-identical to the released body')
FROM (VALUES
  ('private.pw310_old_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)'::REGPROCEDURE, '28c57359ada9847b82871ee180efd9aa'),
  ('private.pw310_old_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)'::REGPROCEDURE, 'ff590e3efe088da4fc1fae75feea336f'),
  ('private.pw310_old_sales_count(uuid,date,date)'::REGPROCEDURE, '81917c338c53e020fbbaf5ce5b4fbbc8'),
  ('private.pw310_old_register_v5(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::REGPROCEDURE, 'bd2886ff43337b097166d3e44e195dee'),
  ('private.pw310_old_stage_entry_cohort(date,date,integer,timestamp with time zone,uuid)'::REGPROCEDURE, 'ac1446cdcc1c622161d78b86f1a0f979'),
  ('private.pw310_old_sales_links(uuid,uuid[])'::REGPROCEDURE, 'f832121c1ad26479bb003a360876898b'),
  ('private.pw310_old_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)'::REGPROCEDURE, 'f203fed7163d69e63fd5fec96f11d458'),
  ('private.pw310_old_case_activity(uuid,integer,timestamp with time zone,uuid)'::REGPROCEDURE, '417aad6afe19aa0cb63f9ac139437ef4'),
  ('private.pw310_old_queue_v1(text,integer,text,text,text,uuid,text,text)'::REGPROCEDURE, '0e1e79c26d1fb129917fa94f823c71e6')
) AS e(fn, released) JOIN pg_proc p ON p.oid = e.fn;
-- And the nine new bodies are NOT the old ones (the migration replaced them).
SELECT pg_temp.pw_assert(md5(p.prosrc) <> e.released, e.fn::TEXT || ' differs from the released body')
FROM (VALUES
  ('private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)'::REGPROCEDURE, '28c57359ada9847b82871ee180efd9aa'),
  ('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)'::REGPROCEDURE, 'ff590e3efe088da4fc1fae75feea336f'),
  ('platform.staff_sales_count_v1(uuid,date,date)'::REGPROCEDURE, '81917c338c53e020fbbaf5ce5b4fbbc8'),
  ('platform.read_sales_register_v5(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::REGPROCEDURE, 'bd2886ff43337b097166d3e44e195dee'),
  ('platform.staff_sales_stage_entry_cohort(date,date,integer,timestamp with time zone,uuid)'::REGPROCEDURE, 'ac1446cdcc1c622161d78b86f1a0f979'),
  ('platform.staff_student_case_sales_links(uuid,uuid[])'::REGPROCEDURE, 'f832121c1ad26479bb003a360876898b'),
  ('platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)'::REGPROCEDURE, 'f203fed7163d69e63fd5fec96f11d458'),
  ('private.staff_student_case_activity(uuid,integer,timestamp with time zone,uuid)'::REGPROCEDURE, '417aad6afe19aa0cb63f9ac139437ef4'),
  ('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::REGPROCEDURE, '0e1e79c26d1fb129917fa94f823c71e6')
) AS e(fn, released) JOIN pg_proc p ON p.oid = e.fn;

\endif

-- ---------------------------------------------------------------------------
-- 0. Posture of the new functions and of the replaced ones.
-- ---------------------------------------------------------------------------
SELECT pg_temp.pw_assert(p.provolatile = 's' AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND pg_temp.pw_grantees(f.fn) = ARRAY[]::TEXT[] AND p.proowner = 'postgres'::REGROLE,
  f.fn::TEXT || ': STABLE, SECURITY DEFINER, empty search_path, no EXECUTE for anyone but the owner')
FROM (VALUES
  ('platform_private.staff_visible_ids_v1(uuid,uuid,text,text,uuid[])'::REGPROCEDURE),
  ('platform_private.staff_visible_ids_for_actor_v1(uuid,text,text,uuid[])'::REGPROCEDURE),
  ('platform_private.staff_readable_case_ids_v1(uuid,uuid,uuid[])'::REGPROCEDURE),
  ('platform_private.staff_readable_case_ids_for_actor_v1(uuid,uuid[])'::REGPROCEDURE)
) AS f(fn) JOIN pg_proc p ON p.oid = f.fn;
-- The replaced functions keep their signature, owner, volatility, definer flag, search_path and grants.
SELECT pg_temp.pw_assert(p.provolatile = 's' AND p.prosecdef = e.definer AND p.proconfig = ARRAY['search_path=""']
    AND pg_temp.pw_grantees(e.fn) = ARRAY['authenticated'] AND p.proowner = 'postgres'::REGROLE,
  e.fn::TEXT || ' keeps volatility, definer flag, search_path, owner and grants')
FROM (VALUES
  ('private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)'::REGPROCEDURE, TRUE),
  ('private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)'::REGPROCEDURE, TRUE),
  ('platform.staff_sales_count_v1(uuid,date,date)'::REGPROCEDURE, TRUE),
  ('platform.read_sales_register_v5(uuid,integer,integer,integer,uuid,boolean,text,text,boolean,text,text)'::REGPROCEDURE, TRUE),
  ('platform.staff_sales_stage_entry_cohort(date,date,integer,timestamp with time zone,uuid)'::REGPROCEDURE, TRUE),
  ('platform.staff_student_case_sales_links(uuid,uuid[])'::REGPROCEDURE, TRUE),
  ('platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)'::REGPROCEDURE, TRUE),
  ('private.staff_student_case_activity(uuid,integer,timestamp with time zone,uuid)'::REGPROCEDURE, TRUE),
  ('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::REGPROCEDURE, TRUE)
) AS e(fn, definer) JOIN pg_proc p ON p.oid = e.fn;
-- No client role can call a primitive (the schema is closed, the function too).
SELECT pg_temp.pw_assert(pg_temp.pw_user_error(1, $$SELECT count(*) FROM platform_private.staff_visible_ids_v1(
    '$$ || pg_temp.pw_id(1) || $$'::UUID, '$$ || pg_temp.pw_id(301) || $$'::UUID, 'lead.read', 'lead')$$) LIKE '42501:%',
  'an authenticated session cannot call staff_visible_ids_v1');
SELECT pg_temp.pw_assert(pg_temp.pw_error('{"role":"service_role"}', 'service_role', $$SELECT count(*) FROM platform_private.staff_visible_ids_v1(
    '$$ || pg_temp.pw_id(1) || $$'::UUID, '$$ || pg_temp.pw_id(301) || $$'::UUID, 'lead.read', 'lead')$$) LIKE '42501:%',
  'service_role cannot call staff_visible_ids_v1');
SELECT pg_temp.pw_assert(pg_temp.pw_error('', 'anon', $$SELECT count(*) FROM platform_private.staff_visible_ids_v1(
    '$$ || pg_temp.pw_id(1) || $$'::UUID, '$$ || pg_temp.pw_id(301) || $$'::UUID, 'lead.read', 'lead')$$) LIKE '42501:%',
  'anon cannot call staff_visible_ids_v1');
-- Only the four mirrored pairs are supported: anything else is 22023 with a constant message.
SELECT pg_temp.pw_assert(pg_temp.pw_error(NULL, NULL, format($$SELECT count(*) FROM platform_private.staff_visible_ids_v1(
    %L::UUID, %L::UUID, %L, %L)$$, pg_temp.pw_id(1), pg_temp.pw_id(301), k.perm, k.kind)) = '22023:staff_visible_ids_unsupported',
  'staff_visible_ids_v1 refuses the unsupported pair ' || k.perm || '/' || k.kind)
FROM (VALUES ('lead.read', 'client'), ('case.read.summary', 'student_case'), ('communication.read.summary', 'conversation'),
  ('finance.read.summary', 'student_case'), ('document.read.full', 'student_case'), ('sales.register.manage', 'sales_register'),
  ('lead.read', 'student_case'), ('', ''), ('lead.read', 'conversation')) AS k(perm, kind);

-- ---------------------------------------------------------------------------
-- Stage changes by the real command as the Admin (receipts and journal rows in the exact pairs
-- the funnel's integrity check wants): stage_entered_at and the cohort have data. Every lead that
-- is open moves to the next stage; every third moves once more.
-- ---------------------------------------------------------------------------
DO $pw_flow$
DECLARE l RECORD; answer TEXT; owner_id UUID;
BEGIN
  FOR l IN SELECT * FROM platform.leads WHERE organization_id = pg_temp.pw_id(1) AND lifecycle_state = 'open'
    AND id <= pg_temp.pw_id(3030) ORDER BY id LOOP
    owner_id := CASE WHEN platform_private.is_eligible_sales_owner(l.organization_id, l.current_owner_membership_id)
      THEN l.current_owner_membership_id END;
    answer := pg_temp.pw_user(1, format($q$SELECT platform.mutate_sales_lead_workflow(%L::UUID, %s, %L::UUID, %L, %L::UUID,
      'PW next step', DATE '2026-10-20', FALSE, 'PW fixture')::TEXT$q$, l.id, l.workflow_version,
      pg_temp.pw_id(11000 + substr(l.id::TEXT, 33)::INTEGER - 3000),
      CASE l.stage_key WHEN 'new' THEN 'contacting' WHEN 'contacting' THEN 'qualified' WHEN 'qualified' THEN 'meeting_scheduled'
        WHEN 'meeting_scheduled' THEN 'meeting_completed' WHEN 'meeting_completed' THEN 'potential' ELSE 'new' END,
      owner_id));
    IF answer LIKE 'ERR %' THEN RAISE EXCEPTION 'PW310 fixture: workflow step failed for %: %', l.id, answer; END IF;
    IF (substr(l.id::TEXT, 33)::INTEGER - 3000) % 3 = 0 THEN
      answer := pg_temp.pw_user(1, format($q$SELECT platform.mutate_sales_lead_workflow(%L::UUID, %s, %L::UUID, 'potential', %L::UUID,
        NULL, NULL, TRUE, 'PW fixture again')::TEXT$q$, l.id, l.workflow_version + 1,
        pg_temp.pw_id(12000 + substr(l.id::TEXT, 33)::INTEGER - 3000), owner_id));
      IF answer LIKE 'ERR %' THEN RAISE EXCEPTION 'PW310 fixture: second workflow step failed for %: %', l.id, answer; END IF;
    END IF;
  END LOOP;
END
$pw_flow$;
SELECT pg_temp.pw_assert((SELECT count(*) FROM platform_private.sales_lead_workflow_receipts) >= 25,
  'fixture: the real workflow command left receipts');

-- ---------------------------------------------------------------------------
-- 1. The SET equals the per-row answer of the released functions, for every actor, every pair
--    of (permission, kind), both organizations, all resources and subsets (only_ids).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE pw_universe AS
  SELECT 'lead'::TEXT AS kind, 'lead.read'::TEXT AS perm, id, organization_id FROM platform.leads
    WHERE organization_id IN (pg_temp.pw_id(1), pg_temp.pw_id(2))
  UNION ALL SELECT 'conversation', 'communication.read.full', id, organization_id FROM platform.communication_conversations
    WHERE organization_id IN (pg_temp.pw_id(1), pg_temp.pw_id(2))
  UNION ALL SELECT 'student_case', 'case.read.full', id, organization_id FROM platform.student_cases
    WHERE organization_id IN (pg_temp.pw_id(1), pg_temp.pw_id(2))
  UNION ALL SELECT 'sales_register', 'sales.register.read', id, organization_id FROM platform_private.sales_register
    WHERE organization_id IN (pg_temp.pw_id(1), pg_temp.pw_id(2))
  -- ids that exist nowhere (and the organization ids themselves) are never visible
  UNION ALL SELECT k.kind, k.perm, pg_temp.pw_id(70000 + g), pg_temp.pw_id(1)
    FROM (VALUES ('lead', 'lead.read'), ('conversation', 'communication.read.full'),
      ('student_case', 'case.read.full'), ('sales_register', 'sales.register.read')) AS k(kind, perm),
      generate_series(1, 3) AS g;
-- For a set of ids and an actor: the ids the released per-row function says yes to.
CREATE FUNCTION pg_temp.pw_old_set(p_org INTEGER, p_membership UUID, p_kind TEXT, p_perm TEXT, p_only UUID[]) RETURNS UUID[]
LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(array_agg(u.id ORDER BY u.id), ARRAY[]::UUID[]) FROM pw_universe u
  WHERE u.kind = p_kind AND (p_only IS NULL OR u.id = ANY (p_only))
    AND platform_private.staff_can_access(pg_temp.pw_id(p_org), p_membership, p_perm, p_kind, u.id)
$$;
CREATE FUNCTION pg_temp.pw_new_set(p_org INTEGER, p_membership UUID, p_kind TEXT, p_perm TEXT, p_only UUID[]) RETURNS UUID[]
LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(array_agg(v.id ORDER BY v.id), ARRAY[]::UUID[])
  FROM platform_private.staff_visible_ids_v1(pg_temp.pw_id(p_org), p_membership, p_perm, p_kind, p_only) AS v(id)
$$;
CREATE TEMP TABLE pw_set_sizes(n INTEGER, org INTEGER, kind TEXT, size INTEGER);
CREATE FUNCTION pg_temp.pw_check_sets_by_membership() RETURNS VOID LANGUAGE plpgsql AS $pw_sets$
DECLARE a RECORD; k RECORD; org INTEGER; old_set UUID[]; new_set UUID[]; only_some UUID[]; only_dup UUID[];
BEGIN
  FOR a IN SELECT n FROM pw_actors ORDER BY n LOOP
    FOR k IN SELECT DISTINCT kind, perm FROM pw_universe LOOP
      FOR org IN 1..2 LOOP
        old_set := pg_temp.pw_old_set(org, pg_temp.pw_id(300 + a.n), k.kind, k.perm, NULL);
        new_set := pg_temp.pw_new_set(org, pg_temp.pw_id(300 + a.n), k.kind, k.perm, NULL);
        IF old_set IS DISTINCT FROM new_set THEN
          RAISE EXCEPTION 'PW310: staff_visible_ids_v1 differs for actor %, org %, %: old % new %; only old: %; only new: % DEBUG %', a.n, org, k.kind,
            cardinality(old_set), cardinality(new_set),
            (SELECT string_agg(right(x::TEXT, 5), ',') FROM (SELECT unnest(old_set) EXCEPT SELECT unnest(new_set)) t(x)),
            (SELECT string_agg(right(x::TEXT, 5), ',') FROM (SELECT unnest(new_set) EXCEPT SELECT unnest(old_set)) t(x)),
            COALESCE((SELECT string_agg(format('[%s: ctx=%s]', right(x::TEXT, 5),
                (SELECT string_agg(format('%s/%s/%s', right(c.owner_membership_id::TEXT, 4), right(c.student_case_id::TEXT, 4), c.direction), ';')
                 FROM platform_private.staff_resource_context(pg_temp.pw_id(org), k.perm, k.kind, x) c)), ' ')
              FROM (SELECT unnest(old_set) EXCEPT SELECT unnest(new_set) LIMIT 3) t(x)), '');
        END IF;
        INSERT INTO pw_set_sizes VALUES (a.n, org, k.kind, cardinality(new_set));
        -- a subset: every third id of the universe, plus ids that exist nowhere, with a duplicate
        SELECT array_agg(x.id) INTO only_some FROM (SELECT u.id, row_number() OVER (ORDER BY u.id) rn FROM pw_universe u
          WHERE u.kind = k.kind) x WHERE x.rn % 3 = 0 OR x.rn > 100;
        only_dup := only_some || only_some[1:2];
        IF pg_temp.pw_old_set(org, pg_temp.pw_id(300 + a.n), k.kind, k.perm, only_dup)
          IS DISTINCT FROM pg_temp.pw_new_set(org, pg_temp.pw_id(300 + a.n), k.kind, k.perm, only_dup) THEN
          RAISE EXCEPTION 'PW310: staff_visible_ids_v1(only_ids) differs for actor %, org %, %', a.n, org, k.kind;
        END IF;
        -- the empty array is «nothing», NULL is «everything»
        IF cardinality(pg_temp.pw_new_set(org, pg_temp.pw_id(300 + a.n), k.kind, k.perm, ARRAY[]::UUID[])) <> 0 THEN
          RAISE EXCEPTION 'PW310: an empty only_ids must give nothing (actor %, %)', a.n, k.kind;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$pw_sets$;
SELECT pg_temp.pw_check_sets_by_membership();
CREATE FUNCTION pg_temp.pw_check_sets() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.pw_check_sets_by_membership();
  PERFORM pg_temp.pw_check_actor_sets();
  PERFORM pg_temp.pw_check_readable_sets();
END $$;
-- Not a vacuous proof: who sees how many (organization 1) is exactly what the roles say.
SELECT pg_temp.pw_assert(
  (SELECT size FROM pw_set_sizes WHERE n = 1 AND org = 1 AND kind = 'lead') = 36
  AND (SELECT size FROM pw_set_sizes WHERE n = 1 AND org = 1 AND kind = 'conversation') = 51
  AND (SELECT size FROM pw_set_sizes WHERE n = 1 AND org = 1 AND kind = 'student_case') = 30
  AND (SELECT size FROM pw_set_sizes WHERE n = 1 AND org = 1 AND kind = 'sales_register') = 25
  AND (SELECT size FROM pw_set_sizes WHERE n = 9 AND org = 1 AND kind = 'lead') = 36
  AND (SELECT size FROM pw_set_sizes WHERE n = 9 AND org = 1 AND kind = 'conversation') = 51
  AND (SELECT size FROM pw_set_sizes WHERE n = 14 AND org = 1 AND kind = 'lead') = 0
  AND (SELECT size FROM pw_set_sizes WHERE n = 10 AND org = 1 AND kind = 'lead') = 0
  AND (SELECT size FROM pw_set_sizes WHERE n = 20 AND org = 1 AND kind = 'lead') = 0
  AND (SELECT size FROM pw_set_sizes WHERE n = 20 AND org = 2 AND kind = 'lead') = 1
  AND (SELECT size FROM pw_set_sizes WHERE n = 1 AND org = 2 AND kind = 'lead') = 0,
  'the Admin and the organization reader see everything of their organization, the Student, the role-less staff and the other organization nothing, an Admin of organization 2 sees only its own');
SELECT pg_temp.pw_assert(
  (SELECT count(DISTINCT size) FROM pw_set_sizes WHERE org = 1 AND kind = 'lead') >= 6
  AND (SELECT count(DISTINCT size) FROM pw_set_sizes WHERE org = 1 AND kind = 'conversation') >= 6
  AND (SELECT count(DISTINCT size) FROM pw_set_sizes WHERE org = 1 AND kind = 'student_case') >= 5
  AND (SELECT count(DISTINCT size) FROM pw_set_sizes WHERE org = 1 AND kind = 'sales_register') >= 4,
  'the scopes really differ: at least six different lead / conversation sets, five case sets, four register sets');

-- 1b. The same for the actor of the request (claims decide): the _for_actor set equals the released
--     staff_can_access_for_actor, private.platform_can_read_canonical_lead / _communication_full and
--     private.platform_can_read_student_case (which adds the «ждёт куратора» branch), row by row.
CREATE FUNCTION pg_temp.pw_check_actor_sets() RETURNS VOID LANGUAGE plpgsql AS $pw_actor_sets$
DECLARE a RECORD; k RECORD; org INTEGER; old_text TEXT; new_text TEXT;
BEGIN
  FOR a IN SELECT n FROM pw_claims ORDER BY n LOOP
    FOR k IN SELECT * FROM (VALUES
      ('lead', 'lead.read', 'platform_private.staff_can_access_for_actor(%L::UUID, ''lead.read'', ''lead'', u.id)'),
      ('lead', 'lead.read', 'private.platform_can_read_canonical_lead(%L::UUID, u.id)'),
      ('conversation', 'communication.read.full', 'platform_private.staff_can_access_for_actor(%L::UUID, ''communication.read.full'', ''conversation'', u.id)'),
      ('conversation', 'communication.read.full', 'private.platform_can_read_communication_full(%L::UUID, u.id)'),
      ('sales_register', 'sales.register.read', 'platform_private.staff_can_access_for_actor(%L::UUID, ''sales.register.read'', ''sales_register'', u.id)'),
      ('student_case', 'case.read.full', 'platform_private.staff_can_access_for_actor(%L::UUID, ''case.read.full'', ''student_case'', u.id)'),
      ('student_case', 'readable', 'private.platform_can_read_student_case(%L::UUID, u.id)')) AS t(kind, perm, predicate)
    LOOP
      FOR org IN 1..2 LOOP
        old_text := pg_temp.pw_owner(a.n, format($q$SELECT COALESCE(string_agg(u.id::TEXT, ',' ORDER BY u.id), '') FROM pw_universe u
          WHERE u.kind = %L AND $q$ || k.predicate, k.kind, pg_temp.pw_id(org)));
        new_text := pg_temp.pw_owner(a.n, CASE WHEN k.perm = 'readable'
          THEN format($q$SELECT COALESCE(string_agg(v.id::TEXT, ',' ORDER BY v.id), '') FROM platform_private.staff_readable_case_ids_for_actor_v1(%L::UUID) AS v(id)$q$, pg_temp.pw_id(org))
          ELSE format($q$SELECT COALESCE(string_agg(v.id::TEXT, ',' ORDER BY v.id), '') FROM platform_private.staff_visible_ids_for_actor_v1(%L::UUID, %L, %L) AS v(id)$q$,
            pg_temp.pw_id(org), k.perm, k.kind) END);
        IF old_text IS DISTINCT FROM new_text THEN
          RAISE EXCEPTION 'PW310: the actor set differs for actor %, org %, %/%: old [%] new [%]', a.n, org, k.kind, k.perm,
            left(old_text, 120), left(new_text, 120);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$pw_actor_sets$;
SELECT pg_temp.pw_check_actor_sets();
-- And by membership: the readable set equals the released predicate for every staff member.
CREATE FUNCTION pg_temp.pw_check_readable_sets() RETURNS VOID LANGUAGE plpgsql AS $pw_readable$
DECLARE a RECORD; old_set UUID[]; new_set UUID[]; org INTEGER;
BEGIN
  FOR a IN SELECT n FROM pw_actors ORDER BY n LOOP
    FOR org IN 1..2 LOOP
      new_set := ARRAY(SELECT v.id FROM platform_private.staff_readable_case_ids_v1(pg_temp.pw_id(org), pg_temp.pw_id(300 + a.n)) AS v(id) ORDER BY v.id);
      old_set := ARRAY(SELECT u.id FROM pw_universe u WHERE u.kind = 'student_case'
        AND (platform_private.staff_can_access(pg_temp.pw_id(org), pg_temp.pw_id(300 + a.n), 'case.read.full', 'student_case', u.id)
          OR platform_private.staff_can_take_needs_curator_case(pg_temp.pw_id(org), pg_temp.pw_id(300 + a.n), u.id))
        ORDER BY u.id);
      IF old_set IS DISTINCT FROM new_set THEN
        RAISE EXCEPTION 'PW310: staff_readable_case_ids_v1 differs for actor %, org %: old % new %', a.n, org, cardinality(old_set), cardinality(new_set);
      END IF;
    END LOOP;
  END LOOP;
END
$pw_readable$;
SELECT pg_temp.pw_check_readable_sets();
-- The «ждёт куратора» branches are really exercised: the department Admissions Manager (316), who
-- is not the last curator, reads the declined case 1 (sale evidence) and the direct case 7 through
-- them and not through case.read.full; case 4 (declined, no sale evidence) stays unreadable for him.
SELECT pg_temp.pw_assert(
  pg_temp.pw_id(4001) = ANY (ARRAY(SELECT v.id FROM platform_private.staff_readable_case_ids_v1(pg_temp.pw_id(1), pg_temp.pw_id(316)) AS v(id)))
  AND NOT pg_temp.pw_id(4001) = ANY (ARRAY(SELECT v.id FROM platform_private.staff_visible_ids_v1(pg_temp.pw_id(1), pg_temp.pw_id(316), 'case.read.full', 'student_case') AS v(id)))
  AND pg_temp.pw_id(4007) = ANY (ARRAY(SELECT v.id FROM platform_private.staff_readable_case_ids_v1(pg_temp.pw_id(1), pg_temp.pw_id(316)) AS v(id)))
  AND NOT pg_temp.pw_id(4007) = ANY (ARRAY(SELECT v.id FROM platform_private.staff_visible_ids_v1(pg_temp.pw_id(1), pg_temp.pw_id(316), 'case.read.full', 'student_case') AS v(id)))
  AND NOT pg_temp.pw_id(4004) = ANY (ARRAY(SELECT v.id FROM platform_private.staff_readable_case_ids_v1(pg_temp.pw_id(1), pg_temp.pw_id(316)) AS v(id))),
  'the needs-curator branches: case 1 and case 7 are readable through them, case 4 is not');

\if :{?pw_sets_only}
\else
-- ---------------------------------------------------------------------------
-- 2. The ANSWER of every replaced function equals the answer of its released body, for every
--    actor and several parameter sets (rows, order, every field, and the errors with their
--    SQLSTATE and text). Actors: the 18 of the fixture and the user with no membership (99).
-- ---------------------------------------------------------------------------
-- The actors of the comparisons: one per distinct profile (12 and 13 repeat 6 and the suspension /
-- block / revocation tests of section 4, 11 repeats 2, 21 repeats 14). A psql variable pw_quick
-- narrows the loop for local iteration; the migration gate never sets it.
CREATE TEMP TABLE pw_loop_actors(n INTEGER);
INSERT INTO pw_loop_actors SELECT n FROM pw_claims WHERE n IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16, 17, 20, 99);
-- The deep actors run every parameter set; the others run the first sets of each function (the
-- released bodies are slow by design, which is the point of 310): the Admin, a department
-- manager, an own-scope member, the direction member, the organization reader (who reads every
-- case but holds no finance permission), the mixed members, the Student and the user with no membership.
CREATE TEMP TABLE pw_deep_actors(n INTEGER);
INSERT INTO pw_deep_actors SELECT n FROM pw_loop_actors WHERE n IN (1, 2, 6, 7, 9, 15, 17, 10, 99);
\if :{?pw_quick}
DELETE FROM pw_loop_actors WHERE n NOT IN (1, 2, 6, 10);
DELETE FROM pw_deep_actors WHERE n NOT IN (1, 2, 6, 10);
\endif

-- 2.1 WhatsApp page.
DO $pw_comm$
DECLARE a RECORD; v RECORD; is_deep BOOLEAN;
  o1 TEXT := quote_literal(pg_temp.pw_id(1)::TEXT) || '::UUID'; o2 TEXT := quote_literal(pg_temp.pw_id(2)::TEXT) || '::UUID';
BEGIN
  FOR a IN SELECT n FROM pw_loop_actors ORDER BY n LOOP
    is_deep := EXISTS (SELECT 1 FROM pw_deep_actors d WHERE d.n = a.n);
    FOR v IN SELECT * FROM (VALUES
      ('all', o1 || ', 101', FALSE),
      ('limit 5', o1 || ', 5', TRUE),
      ('cursor', o1 || ', 7, TIMESTAMPTZ ''2026-09-30 00:00:00+00'', ' || quote_literal(pg_temp.pw_id(5120)::TEXT) || '::UUID', TRUE),
      ('queue sales', o1 || ', 51, NULL, NULL, ''sales''::platform.communication_queue', FALSE),
      ('queue curator', o1 || ', 51, NULL, NULL, ''curator''::platform.communication_queue', TRUE),
      ('status open', o1 || ', 51, NULL, NULL, NULL, ''open''::platform.communication_status', TRUE),
      ('one conversation', o1 || ', 51, NULL, NULL, NULL, NULL, ' || quote_literal(pg_temp.pw_id(5103)::TEXT) || '::UUID', TRUE),
      ('query client', o1 || ', 51, NULL, NULL, NULL, NULL, NULL, ''pw client 1''', TRUE),
      ('waiting only', o1 || ', 51, NULL, NULL, NULL, NULL, NULL, NULL, TRUE', TRUE),
      ('unanswered first', o1 || ', 9, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, TRUE, NULL', FALSE),
      ('unanswered cursor', o1 || ', 9, TIMESTAMPTZ ''2026-09-25 12:00:00+00'', ' || quote_literal(pg_temp.pw_id(5110)::TEXT) || '::UUID, NULL, NULL, NULL, NULL, FALSE, TRUE, TRUE', TRUE),
      ('other organization', o2 || ', 51', FALSE),
      ('invalid limit', o1 || ', 0', FALSE),
      ('half cursor', o1 || ', 5, TIMESTAMPTZ ''2026-09-30 00:00:00+00''', FALSE)) AS t(label, args, deep)
    LOOP
      CONTINUE WHEN v.deep AND NOT is_deep;
      PERFORM pg_temp.pw_same(a.n, 'communication page / ' || v.label,
        'SELECT * FROM platform.staff_communication_page(' || v.args || ')',
        'SELECT * FROM private.pw310_old_communication_page(' || v.args || ')');
    END LOOP;
  END LOOP;
END
$pw_comm$;
SELECT pg_temp.pw_lap('pw_comm');

-- 2.2 Sales funnel page (the wrapper with the latest note against the released chain).
DO $pw_lead$
DECLARE a RECORD; v RECORD; is_deep BOOLEAN;
BEGIN
  FOR a IN SELECT n FROM pw_loop_actors ORDER BY n LOOP
    is_deep := EXISTS (SELECT 1 FROM pw_deep_actors d WHERE d.n = a.n);
    FOR v IN SELECT * FROM (VALUES
      ('all', '101', FALSE),
      ('limit 7', '7', TRUE),
      ('cursor', '7, TIMESTAMPTZ ''2026-09-10 12:00:00+00'', ' || quote_literal(pg_temp.pw_id(3015)::TEXT) || '::UUID', TRUE),
      ('cursor late', '7, TIMESTAMPTZ ''2026-10-20 00:00:00+00'', ' || quote_literal(pg_temp.pw_id(3999)::TEXT) || '::UUID', TRUE),
      ('connected', '101, NULL, NULL, ''connected''', FALSE),
      ('unconnected', '101, NULL, NULL, ''unconnected''', TRUE),
      ('stage', '101, NULL, NULL, ''all'', ''potential''', TRUE),
      ('mine', '101, NULL, NULL, ''all'', NULL, ''mine''', FALSE),
      ('unassigned', '101, NULL, NULL, ''all'', NULL, ''unassigned''', TRUE),
      ('owner', '101, NULL, NULL, ''all'', NULL, ''all'', ' || quote_literal(pg_temp.pw_id(302)::TEXT) || '::UUID', TRUE),
      ('due scheduled', '101, NULL, NULL, ''all'', NULL, ''all'', NULL, ''scheduled''', TRUE),
      ('query', '101, NULL, NULL, ''all'', NULL, ''all'', NULL, ''all'', ''pw client 1''', TRUE),
      ('bad filter', '101, NULL, NULL, ''bogus''', FALSE),
      ('bad owner', '101, NULL, NULL, ''all'', NULL, ''all'', ' || quote_literal(pg_temp.pw_id(314)::TEXT) || '::UUID', FALSE)) AS t(label, args, deep)
    LOOP
      CONTINUE WHEN v.deep AND NOT is_deep;
      PERFORM pg_temp.pw_same(a.n, 'sales lead page / ' || v.label,
        'SELECT * FROM platform.staff_sales_lead_page(' || v.args || ')',
        'SELECT * FROM private.pw310_old_sales_lead_page_note(' || v.args || ')');
    END LOOP;
  END LOOP;
END
$pw_lead$;
SELECT pg_temp.pw_lap('pw_lead');

-- 2.3 «Продажи» count, 2.4 sales register v5, 2.5 stage-entry cohort.
DO $pw_sales$
DECLARE a RECORD; v RECORD; r RECORD; is_deep BOOLEAN;
  o1 TEXT := quote_literal(pg_temp.pw_id(1)::TEXT) || '::UUID'; o2 TEXT := quote_literal(pg_temp.pw_id(2)::TEXT) || '::UUID';
BEGIN
  FOR a IN SELECT n FROM pw_loop_actors ORDER BY n LOOP
    is_deep := EXISTS (SELECT 1 FROM pw_deep_actors d WHERE d.n = a.n);
    FOR v IN SELECT * FROM (VALUES
      ('july', o1 || ', DATE ''2026-07-01'', DATE ''2026-07-31'''),
      ('quarter', o1 || ', DATE ''2026-07-01'', DATE ''2026-09-30'''),
      ('september', o1 || ', DATE ''2026-09-01'', DATE ''2026-09-30'''),
      ('invalid range', o1 || ', DATE ''2026-09-30'', DATE ''2026-09-01'''),
      ('other organization', o2 || ', DATE ''2026-07-01'', DATE ''2026-07-31''')) AS t(label, args)
    LOOP
      PERFORM pg_temp.pw_same(a.n, 'sales count / ' || v.label,
        'SELECT platform.staff_sales_count_v1(' || v.args || ') AS r', 'SELECT private.pw310_old_sales_count(' || v.args || ') AS r');
    END LOOP;
    FOR v IN SELECT * FROM (VALUES
      ('year', o1 || ', 2026', FALSE),
      ('july', o1 || ', 2026, 7', FALSE),
      ('august', o1 || ', 2026, 8', TRUE),
      ('september', o1 || ', 2026, 9', TRUE),
      ('page 2', o1 || ', 2026, NULL, 10', TRUE),
      ('archived', o1 || ', 2026, NULL, 0, NULL, TRUE', FALSE),
      ('manager', o1 || ', 2026, NULL, 0, NULL, FALSE, ''PW Manager 1''', TRUE),
      ('direction', o1 || ', 2026, NULL, 0, NULL, FALSE, NULL, ''none''', TRUE),
      ('needs review', o1 || ', 2026, NULL, 0, NULL, FALSE, NULL, NULL, FALSE', TRUE),
      ('query', o1 || ', 2026, NULL, 0, NULL, FALSE, NULL, NULL, NULL, ''PW Sale 1''', TRUE),
      ('slice undated', o1 || ', 2026, 7, 0, NULL, FALSE, NULL, NULL, NULL, NULL, ''undated''', TRUE),
      ('slice elsewhere', o1 || ', 2026, 8, 0, NULL, FALSE, NULL, NULL, NULL, NULL, ''filed_elsewhere''', TRUE),
      ('other organization', o2 || ', 2026', FALSE),
      ('invalid year', o1 || ', 1800', FALSE)) AS t(label, args, deep)
    LOOP
      CONTINUE WHEN v.deep AND NOT is_deep;
      PERFORM pg_temp.pw_same(a.n, 'register v5 / ' || v.label,
        'SELECT platform.read_sales_register_v5(' || v.args || ') AS r', 'SELECT private.pw310_old_register_v5(' || v.args || ') AS r');
    END LOOP;
    -- records asked for by id: visible, not visible, archived, the pipeline one, another organization's
    FOR r IN SELECT id FROM platform_private.sales_register
      WHERE id IN (SELECT pg_temp.pw_id(9000 + j) FROM unnest(ARRAY[1, 2, 3, 4, 5, 6, 7, 17, 24]) AS j)
        OR id IN (pg_temp.pw_id(9100), pg_temp.pw_id(9200)) ORDER BY id LOOP
      CONTINUE WHEN NOT is_deep AND r.id NOT IN (pg_temp.pw_id(9001), pg_temp.pw_id(9005), pg_temp.pw_id(9100), pg_temp.pw_id(9200));
      PERFORM pg_temp.pw_same(a.n, 'register v5 / record',
        format('SELECT platform.read_sales_register_v5(%s, 2026, NULL, 0, %L::UUID, (SELECT archived FROM platform_private.sales_register WHERE id = %L::UUID)) AS r', o1, r.id, r.id),
        format('SELECT private.pw310_old_register_v5(%s, 2026, NULL, 0, %L::UUID, (SELECT archived FROM platform_private.sales_register WHERE id = %L::UUID)) AS r', o1, r.id, r.id));
    END LOOP;
    FOR v IN SELECT * FROM (VALUES
      ('window', 'DATE ''2026-09-01'', DATE ''2026-10-31'', 101'),
      ('narrow', 'DATE ''2026-09-01'', DATE ''2026-09-02'', 101'),
      ('limit 3', 'DATE ''2026-09-01'', DATE ''2026-10-31'', 3'),
      ('cursor', 'DATE ''2026-09-01'', DATE ''2026-10-31'', 101, TIMESTAMPTZ ''2026-10-01 00:00:00+00'', ' || quote_literal(pg_temp.pw_id(12345)::TEXT) || '::UUID'),
      ('bad range', 'DATE ''2026-09-30'', DATE ''2026-09-01'', 101'),
      ('bad limit', 'DATE ''2026-09-01'', DATE ''2026-09-30'', 0')) AS t(label, args)
    LOOP
      PERFORM pg_temp.pw_same(a.n, 'stage entry cohort / ' || v.label,
        'SELECT * FROM platform.staff_sales_stage_entry_cohort(' || v.args || ')',
        'SELECT * FROM private.pw310_old_stage_entry_cohort(' || v.args || ')');
    END LOOP;
  END LOOP;
END
$pw_sales$;
SELECT pg_temp.pw_lap('pw_sales');

-- 2.6 Links of cases with sales, 2.7 the case page, 2.8 the snapshot of one case.
DO $pw_case$
DECLARE a RECORD; v RECORD; c RECORD; is_deep BOOLEAN;
  o1 TEXT := quote_literal(pg_temp.pw_id(1)::TEXT) || '::UUID'; o2 TEXT := quote_literal(pg_temp.pw_id(2)::TEXT) || '::UUID';
  all_cases TEXT := 'ARRAY(SELECT id FROM platform.student_cases WHERE organization_id = ' || quote_literal(pg_temp.pw_id(1)::TEXT) || '::UUID ORDER BY id)';
BEGIN
  FOR a IN SELECT n FROM pw_loop_actors ORDER BY n LOOP
    is_deep := EXISTS (SELECT 1 FROM pw_deep_actors d WHERE d.n = a.n);
    FOR v IN SELECT * FROM (VALUES
      ('all cases', o1 || ', ' || all_cases, FALSE),
      ('one case', o1 || ', ARRAY[' || quote_literal(pg_temp.pw_id(4003)::TEXT) || '::UUID]', TRUE),
      ('cases without lead', o1 || ', ARRAY[' || quote_literal(pg_temp.pw_id(4027)::TEXT) || '::UUID, ' || quote_literal(pg_temp.pw_id(4030)::TEXT) || '::UUID]', TRUE),
      ('unknown ids', o1 || ', ARRAY[' || quote_literal(pg_temp.pw_id(4999)::TEXT) || '::UUID, ' || quote_literal(pg_temp.pw_id(4001)::TEXT) || '::UUID]', TRUE),
      ('other organization', o2 || ', ' || all_cases, FALSE),
      ('empty', o1 || ', ARRAY[]::UUID[]', FALSE),
      ('null element', o1 || ', ARRAY[NULL, ' || quote_literal(pg_temp.pw_id(4001)::TEXT) || '::UUID]::UUID[]', FALSE),
      ('duplicates', o1 || ', ARRAY[' || quote_literal(pg_temp.pw_id(4001)::TEXT) || '::UUID, ' || quote_literal(pg_temp.pw_id(4001)::TEXT) || '::UUID]', FALSE),
      ('null array', o1 || ', NULL::UUID[]', FALSE)) AS t(label, args, deep)
    LOOP
      CONTINUE WHEN v.deep AND NOT is_deep;
      PERFORM pg_temp.pw_same(a.n, 'case sales links / ' || v.label,
        'SELECT * FROM platform.staff_student_case_sales_links(' || v.args || ')',
        'SELECT * FROM private.pw310_old_sales_links(' || v.args || ')');
    END LOOP;
    FOR v IN SELECT * FROM (VALUES
      ('all', '101', FALSE),
      ('limit 7', '7', TRUE),
      ('cursor', '7, TIMESTAMPTZ ''2026-10-05 00:00:00+00'', ' || quote_literal(pg_temp.pw_id(4020)::TEXT) || '::UUID', TRUE),
      ('state', '101, NULL, NULL, ''active''::platform.student_case_state', TRUE),
      ('direction', '101, NULL, NULL, NULL, NULL, NULL, ''CN''', TRUE),
      ('curator', '101, NULL, NULL, NULL, NULL, NULL, NULL, ' || quote_literal(pg_temp.pw_id(305)::TEXT) || '::UUID', TRUE),
      ('attention', '101, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ''needs_curator''', TRUE),
      ('bad filter', '101, NULL, NULL, NULL, NULL, NULL, ''bogus''', FALSE),
      ('bad limit', '0', FALSE)) AS t(label, args, deep)
    LOOP
      CONTINUE WHEN v.deep AND NOT is_deep;
      PERFORM pg_temp.pw_same(a.n, 'case page / ' || v.label,
        'SELECT * FROM platform.staff_student_case_page(' || v.args || ')',
        'SELECT * FROM private.pw310_old_case_page(' || v.args || ')');
    END LOOP;
    -- the cases that matter, as the card of a case asks for them: pending with each needs-curator
    -- route (1, 7) and without (4), the record-scope case (3), active, closed, no lead (27), an id
    -- that does not exist and an id of another kind
    FOR c IN SELECT pg_temp.pw_id(4000 + j) AS id FROM unnest(ARRAY[1, 2, 3, 4, 6, 7, 27]) AS j
      UNION ALL SELECT pg_temp.pw_id(4990) UNION ALL SELECT pg_temp.pw_id(3001) ORDER BY 1 LOOP
      CONTINUE WHEN NOT is_deep AND c.id NOT IN (pg_temp.pw_id(4001), pg_temp.pw_id(4003), pg_temp.pw_id(4007));
      PERFORM pg_temp.pw_same(a.n, 'case snapshot',
        format('SELECT * FROM platform.staff_student_case_read_snapshot(%L::UUID)', c.id),
        format('SELECT * FROM private.pw310_old_read_snapshot(%L::UUID)', c.id));
    END LOOP;
    PERFORM pg_temp.pw_same(a.n, 'case snapshot / null', 'SELECT * FROM platform.staff_student_case_read_snapshot(NULL)',
      'SELECT * FROM private.pw310_old_read_snapshot(NULL)');
  END LOOP;
END
$pw_case$;
SELECT pg_temp.pw_lap('pw_case');

-- 2.9 The history of a case, 2.10 the queue of cases.
DO $pw_activity$
DECLARE a RECORD; v RECORD; c RECORD; cursor_text TEXT; is_deep BOOLEAN;
BEGIN
  FOR a IN SELECT n FROM pw_loop_actors ORDER BY n LOOP
    is_deep := EXISTS (SELECT 1 FROM pw_deep_actors d WHERE d.n = a.n);
    FOR c IN SELECT x.id FROM (SELECT pg_temp.pw_id(4000 + j) AS id FROM unnest(ARRAY[1, 2, 3, 5, 7, 8, 13, 26, 27]) AS j
      UNION ALL SELECT pg_temp.pw_id(4990)) AS x ORDER BY x.id LOOP
      CONTINUE WHEN NOT is_deep AND c.id NOT IN (pg_temp.pw_id(4002), pg_temp.pw_id(4003), pg_temp.pw_id(4990));
      PERFORM pg_temp.pw_same(a.n, 'case activity',
        format('SELECT platform.staff_student_case_activity(%L::UUID) AS r', c.id),
        format('SELECT private.pw310_old_case_activity(%L::UUID) AS r', c.id));
    END LOOP;
    FOR v IN SELECT * FROM (VALUES
      ('limit 2', quote_literal(pg_temp.pw_id(4002)::TEXT) || '::UUID, 2'),
      ('cursor', quote_literal(pg_temp.pw_id(4002)::TEXT) || '::UUID, 50, TIMESTAMPTZ ''2026-10-04 00:00:00+00'', ' || quote_literal(pg_temp.pw_id(99999)::TEXT) || '::UUID'),
      ('bad limit', quote_literal(pg_temp.pw_id(4002)::TEXT) || '::UUID, 0'),
      ('half cursor', quote_literal(pg_temp.pw_id(4002)::TEXT) || '::UUID, 50, TIMESTAMPTZ ''2026-10-04 00:00:00+00''')) AS t(label, args)
    LOOP
      PERFORM pg_temp.pw_same(a.n, 'case activity / ' || v.label,
        'SELECT platform.staff_student_case_activity(' || v.args || ') AS r', 'SELECT private.pw310_old_case_activity(' || v.args || ') AS r');
    END LOOP;
    PERFORM pg_temp.pw_same(a.n, 'case activity / null case', 'SELECT platform.staff_student_case_activity(NULL) AS r',
      'SELECT private.pw310_old_case_activity(NULL) AS r');

    FOR v IN SELECT * FROM (VALUES
      ('mine', '''mine'', 25', TRUE), ('needs_action', '''needs_action'', 25', TRUE), ('active', '''active'', 25', FALSE),
      ('needs_curator', '''needs_curator'', 25', FALSE), ('closed', '''closed'', 25', TRUE), ('pending', '''pending'', 25', TRUE),
      ('active updated', '''active'', 4, ''updated''', TRUE), ('direction', '''active'', 25, ''due'', NULL, ''CN''', TRUE),
      ('curator', '''active'', 25, ''due'', NULL, NULL, ' || quote_literal(pg_temp.pw_id(305)::TEXT) || '::UUID', TRUE),
      ('stage', '''active'', 25, ''due'', NULL, NULL, NULL, ''new''', TRUE),
      ('query', '''active'', 25, ''due'', NULL, NULL, NULL, NULL, ''pw student 1''', TRUE),
      ('bad view', '''bogus'', 25', FALSE), ('bad limit', '''active'', 0', FALSE)) AS t(label, args, deep)
    LOOP
      CONTINUE WHEN v.deep AND NOT is_deep;
      PERFORM pg_temp.pw_same(a.n, 'case queue / ' || v.label,
        'SELECT platform.staff_student_case_queue_v1(' || v.args || ') AS r', 'SELECT private.pw310_old_queue_v1(' || v.args || ') AS r');
    END LOOP;
    -- the second page, by the cursor the first one returned (both sorts)
    IF is_deep THEN
      FOR v IN SELECT * FROM (VALUES ('due'), ('updated')) AS t(sort) LOOP
        cursor_text := pg_temp.pw_user(a.n, format($q$SELECT platform.staff_student_case_queue_v1('active', 3, %L)->>'next_cursor'$q$, v.sort));
        IF cursor_text IS NOT NULL AND cursor_text NOT LIKE 'ERR %' THEN
          PERFORM pg_temp.pw_same(a.n, 'case queue / second page ' || v.sort,
            format('SELECT platform.staff_student_case_queue_v1(%L, 3, %L, %L) AS r', 'active', v.sort, cursor_text),
            format('SELECT private.pw310_old_queue_v1(%L, 3, %L, %L) AS r', 'active', v.sort, cursor_text));
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$pw_activity$;
SELECT pg_temp.pw_lap('pw_activity');

-- 2.11 The answers are not empty: the proof above is not a proof about nothing.
SELECT pg_temp.pw_assert(
  (SELECT count(*) FROM pw_results) > (SELECT count(*) * 25 FROM pw_loop_actors)
  AND (SELECT count(*) FROM pw_results WHERE answer LIKE 'ERR %') > (SELECT count(*) * 2 FROM pw_loop_actors)
  AND (SELECT count(*) FROM pw_results WHERE answer NOT LIKE 'ERR %' AND answer NOT LIKE '0:%') > (SELECT count(*) * 8 FROM pw_loop_actors),
  format('the comparison ran %s times (%s errors, %s non-empty answers) for %s actors', (SELECT count(*) FROM pw_results),
    (SELECT count(*) FROM pw_results WHERE answer LIKE 'ERR %'),
    (SELECT count(*) FROM pw_results WHERE answer NOT LIKE 'ERR %' AND answer NOT LIKE '0:%'), (SELECT count(*) FROM pw_loop_actors)));
SELECT pg_temp.pw_assert(
  (SELECT count(DISTINCT answer) FROM pw_results WHERE label = 'communication page / all') >= LEAST(6, (SELECT count(*) FROM pw_loop_actors) - 1)
  AND (SELECT count(DISTINCT answer) FROM pw_results WHERE label = 'sales lead page / all') >= LEAST(6, (SELECT count(*) FROM pw_loop_actors) - 1)
  AND (SELECT count(DISTINCT answer) FROM pw_results WHERE label = 'sales lead page / connected') >= LEAST(4, (SELECT count(*) FROM pw_loop_actors) - 1)
  AND (SELECT count(DISTINCT answer) FROM pw_results WHERE label = 'register v5 / year') >= LEAST(4, (SELECT count(*) FROM pw_loop_actors) - 1)
  AND (SELECT count(DISTINCT answer) FROM pw_results WHERE label = 'case page / all') >= LEAST(5, (SELECT count(*) FROM pw_loop_actors) - 1)
  AND (SELECT count(DISTINCT answer) FROM pw_results WHERE label = 'case queue / active') >= LEAST(4, (SELECT count(*) FROM pw_loop_actors) - 1)
  AND (SELECT count(DISTINCT answer) FROM pw_results WHERE label = 'case sales links / all cases') >= LEAST(4, (SELECT count(*) FROM pw_loop_actors) - 1),
  'visibility really differs between the actors in every function: ' || (SELECT string_agg(label || '=' || d, ', ' ORDER BY label)
    FROM (SELECT label, count(DISTINCT answer)::TEXT AS d FROM pw_results WHERE label IN ('communication page / all', 'sales lead page / all',
      'sales lead page / connected', 'register v5 / year', 'case page / all', 'case queue / active', 'case sales links / all cases') GROUP BY label) x));
-- The Admin reads everything the fixture has; the Student, the member with no role, the user without a
-- membership and the Admin of the other organization get an error or nothing from every one of them.
SELECT pg_temp.pw_assert(
  (SELECT split_part(answer, ':', 1)::INTEGER FROM pw_results WHERE label = 'communication page / all' AND n = 1)
    = (SELECT count(*) FROM platform.communication_conversations WHERE organization_id = pg_temp.pw_id(1))
  AND (SELECT split_part(answer, ':', 1)::INTEGER FROM pw_results WHERE label = 'sales lead page / all' AND n = 1)
    = (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.pw_id(1) AND lifecycle_state = 'open')
  AND (SELECT split_part(answer, ':', 1)::INTEGER FROM pw_results WHERE label = 'case page / all' AND n = 1)
    = (SELECT count(*) FROM platform.student_cases WHERE organization_id = pg_temp.pw_id(1)),
  'the Admin reads every conversation, every open lead and every case of the fixture');
SELECT pg_temp.pw_assert(
  (SELECT count(*) FROM pw_results WHERE n IN (10, 14, 99)
     AND label IN ('communication page / all', 'sales lead page / all', 'case page / all', 'case queue / active', 'case sales links / all cases'))
    = 5 * (SELECT count(*) FROM pw_loop_actors WHERE n IN (10, 14, 99))
  AND (SELECT bool_and(answer LIKE 'ERR %' OR answer LIKE '0:%') FROM pw_results WHERE n IN (10, 14, 99)
     AND label IN ('communication page / all', 'sales lead page / all', 'case page / all', 'case queue / active', 'case sales links / all cases'))
  AND COALESCE((SELECT bool_and(answer LIKE 'ERR 42501:%') FROM pw_results WHERE label = 'communication page / all' AND n = 20), TRUE),
  'the Student, the member with no role and the user without a membership get an error or nothing; the Admin of another organization is refused the first one');

\endif

-- ---------------------------------------------------------------------------
-- 2b. The replaced reads against the per-row TRUTH. No released body is needed, so this section also runs
--     at the end of the chain (pw_sets_only): what a page returns must be exactly (or, for views that
--     filter further, a subset of) what the live per-row functions say the actor may read. A later edit
--     that takes one of the nine bodies back to a version that lost its filter fails here. An error of a
--     read counts as «nothing returned» (a Student, a member without the permission).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.pw_truth(p_n INTEGER, p_kind TEXT, p_perm TEXT) RETURNS UUID[] LANGUAGE SQL STABLE AS $$
  SELECT pg_temp.pw_old_set(1, pg_temp.pw_id(300 + p_n), p_kind, p_perm, NULL)
$$;
-- The released predicate of the case reader (full read, or the needs-curator rule), per case.
CREATE FUNCTION pg_temp.pw_truth_readable(p_n INTEGER) RETURNS UUID[] LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(array_agg(u.id ORDER BY u.id), ARRAY[]::UUID[]) FROM pw_universe u
  WHERE u.kind = 'student_case' AND u.organization_id = pg_temp.pw_id(1)
    AND (platform_private.staff_can_access(pg_temp.pw_id(1), pg_temp.pw_id(300 + p_n), 'case.read.full', 'student_case', u.id)
      OR platform_private.staff_can_take_needs_curator_case(pg_temp.pw_id(1), pg_temp.pw_id(300 + p_n), u.id))
$$;
-- The ids a query returns for an actor, as a sorted array (an error is an empty answer).
CREATE FUNCTION pg_temp.pw_ids(p_n INTEGER, p_query TEXT) RETURNS UUID[] LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  answer := pg_temp.pw_user(p_n, format($q$SELECT COALESCE(string_agg(x::TEXT, ',' ORDER BY x), '') FROM (%s) AS q(x)$q$, p_query));
  IF answer IS NULL OR answer LIKE 'ERR %' OR answer = '' THEN RETURN ARRAY[]::UUID[]; END IF;
  RETURN string_to_array(answer, ',')::UUID[];
END $$;
CREATE FUNCTION pg_temp.pw_same_ids(p_label TEXT, p_n INTEGER, p_got UUID[], p_truth UUID[], p_exact BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF (p_exact AND p_got IS DISTINCT FROM p_truth) OR (NOT p_exact AND NOT (p_got <@ p_truth)) THEN
    RAISE EXCEPTION 'PW310 oracle: % for actor %: the read returned % ids, the per-row truth allows % (%)', p_label, p_n,
      cardinality(p_got), cardinality(p_truth), CASE WHEN p_exact THEN 'exact' ELSE 'subset' END;
  END IF;
  INSERT INTO pw_checks VALUES (1);
END $$;
CREATE FUNCTION pg_temp.pw_oracle(p_n INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  o1 TEXT := quote_literal(pg_temp.pw_id(1)::TEXT) || '::UUID';
  t_conv UUID[] := pg_temp.pw_truth(p_n, 'conversation', 'communication.read.full');
  t_lead UUID[] := pg_temp.pw_truth(p_n, 'lead', 'lead.read');
  t_case_full UUID[] := pg_temp.pw_truth(p_n, 'student_case', 'case.read.full');
  t_read UUID[] := pg_temp.pw_truth_readable(p_n);
  t_reg UUID[] := pg_temp.pw_truth(p_n, 'sales_register', 'sales.register.read');
  all_cases TEXT := (SELECT quote_literal(array_agg(id)::TEXT) || '::UUID[]' FROM pw_universe WHERE kind = 'student_case' AND organization_id = pg_temp.pw_id(1));
  v TEXT; c UUID; got TEXT; truth_count BIGINT;
BEGIN
  -- the WhatsApp page: exactly the conversations the actor may read
  PERFORM pg_temp.pw_same_ids('communication page', p_n,
    pg_temp.pw_ids(p_n, format('SELECT conversation_id FROM platform.staff_communication_page(%s, 101)', o1)), t_conv, TRUE);
  -- the funnel page: exactly the open leads the actor may read
  PERFORM pg_temp.pw_same_ids('sales lead page', p_n,
    pg_temp.pw_ids(p_n, 'SELECT lead_id FROM platform.staff_sales_lead_page(101)'),
    COALESCE((SELECT array_agg(l.id ORDER BY l.id) FROM platform.leads l WHERE l.id = ANY (t_lead) AND l.lifecycle_state = 'open'), ARRAY[]::UUID[]), TRUE);
  -- the case page (and the card): exactly the cases the actor may read in full
  PERFORM pg_temp.pw_same_ids('case page', p_n,
    pg_temp.pw_ids(p_n, $q$SELECT student_case_id FROM platform.staff_student_case_page(101) WHERE access_mode = 'full'$q$), t_read, TRUE);
  IF pg_temp.pw_ids(p_n, $q$SELECT student_case_id FROM platform.staff_student_case_page(101) WHERE access_mode = 'sales_summary'$q$) && t_read THEN
    RAISE EXCEPTION 'PW310 oracle: the case page of actor % shows a summary row beside a case the actor reads in full', p_n;
  END IF;
  PERFORM pg_temp.pw_same_ids('case snapshot', p_n,
    pg_temp.pw_ids(p_n, format($q$SELECT s.student_case_id FROM unnest(%s) AS u(id), LATERAL platform.staff_student_case_read_snapshot(u.id) AS s WHERE s.access_mode = 'full'$q$, all_cases)),
    t_read, TRUE);
  -- the register: exactly the visible, not archived records of the year
  PERFORM pg_temp.pw_same_ids('register v5', p_n,
    pg_temp.pw_ids(p_n, format($q$SELECT (r ->> 'id')::UUID FROM jsonb_array_elements(platform.read_sales_register_v5(%s, 2026) -> 'rows') AS r$q$, o1)),
    COALESCE((SELECT array_agg(r.id ORDER BY r.id) FROM platform_private.sales_register r
      WHERE r.id = ANY (t_reg) AND NOT r.archived AND r.report_month BETWEEN DATE '2026-01-01' AND DATE '2026-12-01'), ARRAY[]::UUID[]), TRUE);
  -- «Продажи»: the count equals the visible, not archived, not refused records dated in the year
  got := pg_temp.pw_user(p_n, format($q$SELECT platform.staff_sales_count_v1(%s, DATE '2026-01-01', DATE '2026-12-31') ->> 'sales'$q$, o1));
  SELECT count(*) INTO truth_count FROM platform_private.sales_register r
    WHERE r.id = ANY (t_reg) AND NOT r.archived AND r.withdrawal_kind IS NULL
      AND NULLIF(r.fields ->> 'signing_date', '')::DATE BETWEEN DATE '2026-01-01' AND DATE '2026-12-31';
  IF COALESCE(CASE WHEN got LIKE 'ERR %' THEN '0' ELSE got END, '0')::BIGINT IS DISTINCT FROM truth_count THEN
    RAISE EXCEPTION 'PW310 oracle: sales count for actor %: the read says %, the per-row truth %', p_n, got, truth_count;
  END IF;
  INSERT INTO pw_checks VALUES (1);
  -- the queue: every case of every view is a case the actor may read
  FOREACH v IN ARRAY ARRAY['mine', 'needs_action', 'active', 'needs_curator', 'closed', 'pending'] LOOP
    PERFORM pg_temp.pw_same_ids('case queue ' || v, p_n,
      pg_temp.pw_ids(p_n, format($q$SELECT (r ->> 'student_case_id')::UUID FROM jsonb_array_elements(platform.staff_student_case_queue_v1(%L, 100) -> 'rows') AS r$q$, v)),
      t_read, FALSE);
  END LOOP;
  -- links with sales: a case the actor may read and a lead the actor may read
  PERFORM pg_temp.pw_same_ids('case sales links (cases)', p_n,
    pg_temp.pw_ids(p_n, format('SELECT student_case_id FROM platform.staff_student_case_sales_links(%s, %s)', o1, all_cases)), t_read, FALSE);
  PERFORM pg_temp.pw_same_ids('case sales links (leads)', p_n,
    pg_temp.pw_ids(p_n, format('SELECT lead_id FROM platform.staff_student_case_sales_links(%s, %s)', o1, all_cases)), t_lead, FALSE);
  -- the stage-entry cohort: leads the actor may read
  PERFORM pg_temp.pw_same_ids('stage entry cohort', p_n,
    pg_temp.pw_ids(p_n, $q$SELECT lead_id FROM platform.staff_sales_stage_entry_cohort(DATE '2026-09-01', DATE '2026-10-31', 101)$q$), t_lead, FALSE);
  -- the history of a case opens exactly for the cases the actor may read in full
  FOREACH c IN ARRAY (SELECT array_agg(id ORDER BY id) FROM pw_universe WHERE kind = 'student_case' AND organization_id = pg_temp.pw_id(1)) LOOP
    IF (pg_temp.pw_user_error(p_n, format('SELECT platform.staff_student_case_activity(%L::UUID)', c)) = 'ok') IS DISTINCT FROM (c = ANY (t_case_full)) THEN
      RAISE EXCEPTION 'PW310 oracle: case history for actor %, case %: opens %, the per-row truth says %', p_n, right(c::TEXT, 5),
        pg_temp.pw_user_error(p_n, format('SELECT platform.staff_student_case_activity(%L::UUID)', c)), c = ANY (t_case_full);
    END IF;
  END LOOP;
  INSERT INTO pw_checks VALUES (1);
END $$;
DO $pw_oracle_run$
DECLARE n INTEGER;
BEGIN
  FOR n IN SELECT a.n FROM pw_actors a WHERE a.org = 1 AND a.n <> 10 ORDER BY a.n LOOP
    PERFORM pg_temp.pw_oracle(n);
  END LOOP;
  -- the Student and the Admin of the other organization read nothing at all
  PERFORM pg_temp.pw_oracle(10);
END
$pw_oracle_run$;
SELECT pg_temp.pw_lap('pw_oracle');

-- ---------------------------------------------------------------------------
-- 3. Revocation and suspension act on the very NEXT call: there is no cache between calls and no
--    value that outlives the statement. One transaction, every change a plain UPDATE as the owner;
--    after each change the view of the changed actor moves exactly as the released bodies say
--    (empty when the access is gone), the view of an unrelated actor does not move, and the
--    answers of the new functions are still those of the released bodies.
-- ---------------------------------------------------------------------------
-- What an actor sees: the four sets of the primitives and four of the replaced reads.
CREATE FUNCTION pg_temp.pw_view(p_n INTEGER) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE o1 TEXT := quote_literal(pg_temp.pw_id(1)::TEXT) || '::UUID';
BEGIN
  RETURN concat_ws('|',
    pg_temp.pw_owner(p_n, format('SELECT count(*)::TEXT FROM platform_private.staff_visible_ids_for_actor_v1(%s, ''communication.read.full'', ''conversation'')', o1)),
    pg_temp.pw_owner(p_n, format('SELECT count(*)::TEXT FROM platform_private.staff_visible_ids_for_actor_v1(%s, ''lead.read'', ''lead'')', o1)),
    pg_temp.pw_owner(p_n, format('SELECT count(*)::TEXT FROM platform_private.staff_readable_case_ids_for_actor_v1(%s)', o1)),
    pg_temp.pw_owner(p_n, format('SELECT count(*)::TEXT FROM platform_private.staff_visible_ids_for_actor_v1(%s, ''sales.register.read'', ''sales_register'')', o1)),
    pg_temp.pw_user(p_n, pg_temp.pw_q(format('SELECT * FROM platform.staff_communication_page(%s, 101)', o1))),
    pg_temp.pw_user(p_n, pg_temp.pw_q('SELECT * FROM platform.staff_sales_lead_page(101)')),
    pg_temp.pw_user(p_n, pg_temp.pw_q('SELECT * FROM platform.staff_student_case_page(101)')),
    pg_temp.pw_user(p_n, pg_temp.pw_q(format('SELECT platform.staff_sales_count_v1(%s, DATE ''2026-07-01'', DATE ''2026-09-30'') AS r', o1))));
END $$;
-- A view with nothing in it: every set empty, every read an error or no rows.
CREATE FUNCTION pg_temp.pw_view_is_empty(p_view TEXT) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT bool_and(part = '0' OR part LIKE 'ERR %' OR part LIKE '0:%') FROM unnest(string_to_array(p_view, '|')) AS part
$$;
-- The released bodies and the new ones agree on the changed state, for the changed actor.
CREATE FUNCTION pg_temp.pw_battery(p_n INTEGER, p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE o1 TEXT := quote_literal(pg_temp.pw_id(1)::TEXT) || '::UUID';
BEGIN
  -- without the released bodies (the sets-only run) the sets themselves are what is proven
  IF to_regproc('private.pw310_old_queue_v1') IS NULL THEN RETURN; END IF;
  PERFORM pg_temp.pw_same(p_n, p_label || ' / communication page', format('SELECT * FROM platform.staff_communication_page(%s, 101)', o1),
    format('SELECT * FROM private.pw310_old_communication_page(%s, 101)', o1));
  PERFORM pg_temp.pw_same(p_n, p_label || ' / sales lead page', 'SELECT * FROM platform.staff_sales_lead_page(101)',
    'SELECT * FROM private.pw310_old_sales_lead_page_note(101)');
  PERFORM pg_temp.pw_same(p_n, p_label || ' / case page', 'SELECT * FROM platform.staff_student_case_page(101)',
    'SELECT * FROM private.pw310_old_case_page(101)');
  PERFORM pg_temp.pw_same(p_n, p_label || ' / sales count', format('SELECT platform.staff_sales_count_v1(%s, DATE ''2026-07-01'', DATE ''2026-09-30'') AS r', o1),
    format('SELECT private.pw310_old_sales_count(%s, DATE ''2026-07-01'', DATE ''2026-09-30'') AS r', o1));
  PERFORM pg_temp.pw_same(p_n, p_label || ' / register', format('SELECT platform.read_sales_register_v5(%s, 2026) AS r', o1),
    format('SELECT private.pw310_old_register_v5(%s, 2026) AS r', o1));
  PERFORM pg_temp.pw_same(p_n, p_label || ' / queue', 'SELECT platform.staff_student_case_queue_v1(''active'', 25) AS r',
    'SELECT private.pw310_old_queue_v1(''active'', 25) AS r');
  PERFORM pg_temp.pw_same(p_n, p_label || ' / snapshot', format('SELECT * FROM platform.staff_student_case_read_snapshot(%L::UUID)', pg_temp.pw_id(4003)),
    format('SELECT * FROM private.pw310_old_read_snapshot(%L::UUID)', pg_temp.pw_id(4003)));
  PERFORM pg_temp.pw_same(p_n, p_label || ' / sales links',
    format('SELECT * FROM platform.staff_student_case_sales_links(%s, ARRAY(SELECT id FROM platform.student_cases WHERE organization_id = %s))', o1, o1),
    format('SELECT * FROM private.pw310_old_sales_links(%s, ARRAY(SELECT id FROM platform.student_cases WHERE organization_id = %s))', o1, o1));
END $$;
-- One member against the per-row truth after a change: the four sets (both organizations) and the readable cases.
CREATE FUNCTION pg_temp.pw_check_member(p_n INTEGER, p_step TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE k RECORD; org INTEGER; mem UUID := pg_temp.pw_id(300 + p_n);
BEGIN
  FOR org IN 1..2 LOOP
    FOR k IN SELECT DISTINCT kind, perm FROM pw_universe LOOP
      IF pg_temp.pw_old_set(org, mem, k.kind, k.perm, NULL) IS DISTINCT FROM pg_temp.pw_new_set(org, mem, k.kind, k.perm, NULL) THEN
        RAISE EXCEPTION 'PW310: after "%" the set of actor % differs from the per-row truth (org %, %)', p_step, p_n, org, k.kind;
      END IF;
    END LOOP;
  END LOOP;
  IF pg_temp.pw_truth_readable(p_n) IS DISTINCT FROM ARRAY(SELECT v.id FROM platform_private.staff_readable_case_ids_v1(pg_temp.pw_id(1), mem) AS v(id) ORDER BY v.id) THEN
    RAISE EXCEPTION 'PW310: after "%" the readable cases of actor % differ from the per-row truth', p_step, p_n;
  END IF;
  INSERT INTO pw_checks VALUES (1);
END $$;
CREATE TEMP TABLE pw_views(step TEXT, n INTEGER, view TEXT);
-- Views of two bystanders before any change: the Admin and the organization reader.
INSERT INTO pw_views SELECT 'start', n, pg_temp.pw_view(n) FROM unnest(ARRAY[1, 9, 2, 3, 4, 6, 11, 12, 13, 16]) AS n;
SELECT pg_temp.pw_assert((SELECT bool_and(NOT pg_temp.pw_view_is_empty(view)) FROM pw_views WHERE step = 'start'),
  'every actor of the revocation steps starts with a non-empty view');

-- 3.1 A suspended membership: the very next call is empty / refused; reactivated, it is back.
UPDATE platform.organization_memberships SET status = 'suspended' WHERE id = pg_temp.pw_id(311);
SELECT pg_temp.pw_assert(pg_temp.pw_view_is_empty(pg_temp.pw_view(11)), 'a suspended membership sees nothing on the next call');
SELECT pg_temp.pw_battery(11, 'suspended membership');
SELECT pg_temp.pw_check_member(11, 'suspended membership');
UPDATE platform.organization_memberships SET status = 'active' WHERE id = pg_temp.pw_id(311);
SELECT pg_temp.pw_check_member(11, 'reactivated membership');
SELECT pg_temp.pw_assert(pg_temp.pw_view(11) = (SELECT view FROM pw_views WHERE step = 'start' AND n = 11), 'a reactivated membership is back at once');

-- 3.2 A blocked profile.
UPDATE platform.profiles SET status = 'blocked' WHERE id = pg_temp.pw_id(212);
SELECT pg_temp.pw_assert(pg_temp.pw_view_is_empty(pg_temp.pw_view(12)), 'a blocked profile sees nothing on the next call');
SELECT pg_temp.pw_battery(12, 'blocked profile');
SELECT pg_temp.pw_check_member(12, 'blocked profile');
UPDATE platform.profiles SET status = 'active' WHERE id = pg_temp.pw_id(212);

-- 3.3 A revoked assignment.
UPDATE platform.staff_role_assignments SET revoked_at = clock_timestamp()
  WHERE membership_id = pg_temp.pw_id(313) AND revoked_at IS NULL;
SELECT pg_temp.pw_assert(pg_temp.pw_view_is_empty(pg_temp.pw_view(13)), 'a revoked assignment leaves nothing on the next call');
SELECT pg_temp.pw_battery(13, 'revoked assignment');
SELECT pg_temp.pw_check_member(13, 'revoked assignment');

-- 3.4 An archived role: the member who has only that role loses everything, the member with a
--     second role keeps what the second role gives.
UPDATE platform.staff_role_definitions SET status = 'archived' WHERE id = pg_temp.pw_id(1105);
SELECT pg_temp.pw_assert(pg_temp.pw_view_is_empty(pg_temp.pw_view(4)), 'the only role archived: nothing on the next call');
SELECT pg_temp.pw_assert(NOT pg_temp.pw_view_is_empty(pg_temp.pw_view(16)) AND pg_temp.pw_view(16) <> (SELECT view FROM pw_views WHERE step = 'start' AND n = 16),
  'one of two roles archived: the view shrinks to what the other role gives');
SELECT pg_temp.pw_battery(4, 'archived only role');
SELECT pg_temp.pw_battery(16, 'archived one of two roles');
SELECT pg_temp.pw_check_member(4, 'archived only role');
SELECT pg_temp.pw_check_member(16, 'archived one of two roles');
SELECT pg_temp.pw_check_member(15, 'archived roles (mixed member)');
UPDATE platform.staff_role_definitions SET status = 'active' WHERE id = pg_temp.pw_id(1105);

-- 3.5 A department changed: the manager of department A loses the records of the member who moved,
--     the manager of department B gets them, at once.
UPDATE platform.staff_organizational_details SET department_id = pg_temp.pw_id(903) WHERE membership_id = pg_temp.pw_id(304);
SELECT pg_temp.pw_assert(pg_temp.pw_view(2) <> (SELECT view FROM pw_views WHERE step = 'start' AND n = 2)
  AND pg_temp.pw_view(3) <> (SELECT view FROM pw_views WHERE step = 'start' AND n = 3),
  'a member moved to another department moves his records between the two department managers on the next call');
SELECT pg_temp.pw_battery(2, 'department A after the move');
SELECT pg_temp.pw_battery(3, 'department B after the move');
SELECT pg_temp.pw_check_member(2, 'member moved to department B');
SELECT pg_temp.pw_check_member(3, 'member moved to department B');
SELECT pg_temp.pw_check_member(4, 'member moved to department B');
UPDATE platform.staff_organizational_details SET department_id = pg_temp.pw_id(901) WHERE membership_id = pg_temp.pw_id(304);

-- 3.5b An archived department: its manager keeps the role, but the department no longer counts.
UPDATE platform.staff_departments SET status = 'archived' WHERE id = pg_temp.pw_id(901);
SELECT pg_temp.pw_assert((string_to_array(pg_temp.pw_view(2), '|'))[1:4] = ARRAY['0', '0', '0', '0'],
  'an archived department: its manager sees none of the four sets on the next call');
SELECT pg_temp.pw_battery(2, 'archived department A');
SELECT pg_temp.pw_battery(15, 'archived department A (mixed member)');
SELECT pg_temp.pw_check_member(2, 'archived department A');
SELECT pg_temp.pw_check_member(15, 'archived department A');
SELECT pg_temp.pw_check_member(4, 'archived department A');
UPDATE platform.staff_departments SET status = 'active' WHERE id = pg_temp.pw_id(901);

-- 3.6 A new owner: a lead given to another member appears for him at once and leaves the previous owner.
UPDATE platform.leads SET current_owner_membership_id = pg_temp.pw_id(306) WHERE id = pg_temp.pw_id(3002);
SELECT pg_temp.pw_assert(pg_temp.pw_view(6) <> (SELECT view FROM pw_views WHERE step = 'start' AND n = 6),
  'a lead given to a member is in his view on the next call');
SELECT pg_temp.pw_battery(6, 'lead given to the Admissions member');
SELECT pg_temp.pw_battery(3, 'lead taken from department B');
SELECT pg_temp.pw_check_member(6, 'lead given to the Admissions member');
SELECT pg_temp.pw_check_member(3, 'lead taken from department B');

-- 3.7 Nobody else moved: the bystanders' views are the ones they started with, and the sets still
--     equal the released per-row answer for every actor after all these changes.
-- (the sizes of the four sets: the pages themselves legitimately show the new owner of lead 3002)
SELECT pg_temp.pw_assert(
  (string_to_array(pg_temp.pw_view(1), '|'))[1:4] = (string_to_array((SELECT view FROM pw_views WHERE step = 'start' AND n = 1), '|'))[1:4]
  AND (string_to_array(pg_temp.pw_view(9), '|'))[1:4] = (string_to_array((SELECT view FROM pw_views WHERE step = 'start' AND n = 9), '|'))[1:4],
  'the Admin and the organization reader see the same sets after all the changes of others');
SELECT pg_temp.pw_check_sets();
SELECT pg_temp.pw_lap('pw_revocation');

-- ---------------------------------------------------------------------------
-- 4. Seeded differential fuzz (the shape of this section follows the independent security review of
--    PR 1269). Random assignments of every role to every member in every scope (also the ones the
--    command refuses: a record scope of a foreign kind, a missing department, a role republished or
--    retired under its assignments), random topology (departments, archived department / role,
--    suspended member, blocked profile) and random data (owners, curators, directions), then for many
--    members the new sets against the released per-row answer, the readable-case set against the released
--    predicate and, when the released bodies are loaded, two pages against their released bodies. The seed
--    is fixed, so a failure repeats. Runs last: it rewrites the fixture state.
-- ---------------------------------------------------------------------------
\if :{?pw_quick}
\set pw_fz_rounds 2
\else
\set pw_fz_rounds 24
\endif
SELECT set_config('pw.fz_rounds', :'pw_fz_rounds', TRUE);
CREATE TEMP TABLE fz_stats(label TEXT, n BIGINT);
-- One member, one organization: every (permission, kind) set and the readable case set, new vs released per row.
CREATE FUNCTION pg_temp.fz_compare(p_n INTEGER, p_org INTEGER, p_it INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE k RECORD; old_set UUID[]; new_set UUID[]; mem UUID := pg_temp.pw_id(300 + p_n);
BEGIN
  FOR k IN SELECT DISTINCT kind, perm FROM pw_universe LOOP
    old_set := pg_temp.pw_old_set(p_org, mem, k.kind, k.perm, NULL);
    new_set := pg_temp.pw_new_set(p_org, mem, k.kind, k.perm, NULL);
    IF old_set IS DISTINCT FROM new_set THEN
      RAISE EXCEPTION 'PW310 fuzz: round % member % org % %/%: only released [%] only new [%]; live assignments: %', p_it, p_n, p_org, k.kind, k.perm,
        (SELECT string_agg(right(x::TEXT, 5), ',') FROM (SELECT unnest(old_set) EXCEPT SELECT unnest(new_set)) t(x)),
        (SELECT string_agg(right(x::TEXT, 5), ',') FROM (SELECT unnest(new_set) EXCEPT SELECT unnest(old_set)) t(x)),
        (SELECT string_agg(format('%s/%s/%s/%s', right(a.role_id::TEXT, 4), a.scope_kind, right(COALESCE(a.scope_key, '-'), 5), COALESCE(a.resource_kind, '-')), '; ')
           FROM platform.staff_role_assignments a WHERE a.membership_id = mem AND a.revoked_at IS NULL);
    END IF;
    INSERT INTO fz_stats VALUES ('set ' || k.kind, cardinality(new_set));
  END LOOP;
  new_set := ARRAY(SELECT v.id FROM platform_private.staff_readable_case_ids_v1(pg_temp.pw_id(p_org), mem) AS v(id) ORDER BY v.id);
  old_set := ARRAY(SELECT u.id FROM pw_universe u WHERE u.kind = 'student_case'
    AND (platform_private.staff_can_access(pg_temp.pw_id(p_org), mem, 'case.read.full', 'student_case', u.id)
      OR platform_private.staff_can_take_needs_curator_case(pg_temp.pw_id(p_org), mem, u.id)) ORDER BY u.id);
  IF old_set IS DISTINCT FROM new_set THEN
    RAISE EXCEPTION 'PW310 fuzz: round % member % org % readable cases: released % new %', p_it, p_n, p_org, cardinality(old_set), cardinality(new_set);
  END IF;
  INSERT INTO fz_stats VALUES ('readable', cardinality(new_set));
END $$;
-- Two replaced pages against the released bodies (only when the released bodies are loaded).
CREATE FUNCTION pg_temp.fz_pages(p_n INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE o1 TEXT := quote_literal(pg_temp.pw_id(1)::TEXT) || '::UUID';
BEGIN
  IF to_regproc('private.pw310_old_queue_v1') IS NULL THEN RETURN; END IF;
  PERFORM pg_temp.pw_same(p_n, 'fuzz communication page', format('SELECT * FROM platform.staff_communication_page(%s, 101)', o1),
    format('SELECT * FROM private.pw310_old_communication_page(%s, 101)', o1));
  PERFORM pg_temp.pw_same(p_n, 'fuzz sales lead page', 'SELECT * FROM platform.staff_sales_lead_page(101)', 'SELECT * FROM private.pw310_old_sales_lead_page_note(101)');
  PERFORM pg_temp.pw_same(p_n, 'fuzz register', format('SELECT platform.read_sales_register_v5(%s, 2026) AS r', o1), format('SELECT private.pw310_old_register_v5(%s, 2026) AS r', o1));
  PERFORM pg_temp.pw_same(p_n, 'fuzz queue', 'SELECT platform.staff_student_case_queue_v1(''needs_curator'', 25) AS r', 'SELECT private.pw310_old_queue_v1(''needs_curator'', 25) AS r');
  PERFORM pg_temp.pw_same(p_n, 'fuzz snapshot', format('SELECT * FROM platform.staff_student_case_read_snapshot(%L::UUID)', pg_temp.pw_id(4001)),
    format('SELECT * FROM private.pw310_old_read_snapshot(%L::UUID)', pg_temp.pw_id(4001)));
END $$;

SET LOCAL session_replication_role = replica;
DO $fz$
DECLARE
  it INTEGER; m INTEGER; j INTEGER; n_assign INTEGER; r UUID; sk TEXT; skey TEXT; rkind TEXT; roles UUID[]; tmp UUID; pick_n INTEGER; undo TEXT[];
  depts UUID[] := ARRAY[pg_temp.pw_id(901), pg_temp.pw_id(902), pg_temp.pw_id(903)];
  dirs TEXT[] := ARRAY['CN', 'MY', 'EUROPE', 'AE', 'TR'];
  kinds TEXT[] := ARRAY['lead', 'student_case', 'conversation', 'sales_register', 'client'];
  fuzz_members INTEGER[] := ARRAY[2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 22];
  org1 UUID := pg_temp.pw_id(1);
  rounds INTEGER := current_setting('pw.fz_rounds')::INTEGER;
  page_actors INTEGER[] := ARRAY[2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 11, 12, 13];
BEGIN
  PERFORM setseed(0.271828);
  SELECT array_agg(role_id) INTO roles FROM pw_roles;
  FOR it IN 1..rounds LOOP
    undo := ARRAY[]::TEXT[];
    -- 1. fresh random assignments for the fuzz members (the old ones are revoked, as a real replacement does)
    UPDATE platform.staff_role_assignments SET revoked_at = clock_timestamp()
      WHERE organization_id = org1 AND revoked_at IS NULL
        AND membership_id IN (SELECT pg_temp.pw_id(300 + x) FROM unnest(fuzz_members) AS x);
    FOREACH m IN ARRAY fuzz_members LOOP
      n_assign := 1 + floor(random() * 4)::INTEGER;
      FOR j IN 1..n_assign LOOP
        r := roles[1 + floor(random() * cardinality(roles))::INTEGER];
        sk := (ARRAY['own', 'organization', 'department', 'direction', 'record', 'record', 'department'])[1 + floor(random() * 7)::INTEGER];
        skey := NULL; rkind := NULL;
        IF sk = 'organization' THEN skey := org1::TEXT;
        ELSIF sk = 'department' THEN skey := (depts || pg_temp.pw_id(999))[1 + floor(random() * 4)::INTEGER]::TEXT;
        ELSIF sk = 'direction' THEN skey := dirs[1 + floor(random() * 5)::INTEGER];
        ELSIF sk = 'record' THEN
          rkind := kinds[1 + floor(random() * 5)::INTEGER];
          SELECT u.id INTO tmp FROM pw_universe u
            WHERE u.kind = CASE WHEN random() < 0.8 AND rkind <> 'client' THEN rkind ELSE kinds[1 + floor(random() * 4)::INTEGER] END
              AND u.organization_id = org1 ORDER BY random() LIMIT 1;
          skey := COALESCE(tmp, pg_temp.pw_id(3001))::TEXT;
        END IF;
        INSERT INTO platform.staff_role_assignments(organization_id, membership_id, role_id, bundle_id, scope_kind, scope_key, resource_kind)
        SELECT org1, pg_temp.pw_id(300 + m), r, b.bundle_id, sk, skey, rkind FROM pw_bundles b WHERE b.role_id = r;
      END LOOP;
    END LOOP;
    -- 2. topology, transient for this round: members move between departments, an archived department,
    --    a suspended member, a blocked profile, an archived role, a republished role, a retired bundle
    FOREACH m IN ARRAY fuzz_members LOOP
      IF random() < 0.3 THEN
        UPDATE platform.staff_organizational_details SET department_id = (depts || NULL::UUID)[1 + floor(random() * 4)::INTEGER]
          WHERE organization_id = org1 AND membership_id = pg_temp.pw_id(300 + m);
        IF NOT FOUND AND random() < 0.5 THEN
          INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id)
          VALUES (org1, pg_temp.pw_id(300 + m), depts[1 + floor(random() * 3)::INTEGER]);
        END IF;
      END IF;
    END LOOP;
    IF random() < 0.25 THEN
      tmp := depts[1 + floor(random() * 3)::INTEGER];
      UPDATE platform.staff_departments SET status = 'archived' WHERE id = tmp;
      undo := undo || format('UPDATE platform.staff_departments SET status = ''active'' WHERE id = %L', tmp);
    END IF;
    IF random() < 0.2 THEN
      pick_n := fuzz_members[1 + floor(random() * cardinality(fuzz_members))::INTEGER];
      UPDATE platform.organization_memberships SET status = 'suspended' WHERE id = pg_temp.pw_id(300 + pick_n);
      undo := undo || format('UPDATE platform.organization_memberships SET status = ''active'' WHERE id = %L', pg_temp.pw_id(300 + pick_n));
    END IF;
    IF random() < 0.2 THEN
      pick_n := fuzz_members[1 + floor(random() * cardinality(fuzz_members))::INTEGER];
      UPDATE platform.profiles SET status = 'blocked' WHERE id = pg_temp.pw_id(200 + pick_n);
      undo := undo || format('UPDATE platform.profiles SET status = ''active'' WHERE id = %L', pg_temp.pw_id(200 + pick_n));
    END IF;
    IF random() < 0.2 THEN
      tmp := roles[1 + floor(random() * cardinality(roles))::INTEGER];
      UPDATE platform.staff_role_definitions SET status = 'archived' WHERE id = tmp;
      undo := undo || format('UPDATE platform.staff_role_definitions SET status = ''active'' WHERE id = %L', tmp);
    END IF;
    IF random() < 0.3 THEN
      tmp := roles[1 + floor(random() * cardinality(roles))::INTEGER];
      UPDATE platform.staff_role_definitions SET current_bundle_id = (SELECT b.bundle_id FROM pw_bundles b WHERE b.role_id <> tmp ORDER BY random() LIMIT 1) WHERE id = tmp;
      undo := undo || format('UPDATE platform.staff_role_definitions SET current_bundle_id = %L WHERE id = %L',
        (SELECT b.bundle_id FROM pw_bundles b WHERE b.role_id = tmp), tmp);
    END IF;
    IF random() < 0.25 THEN
      tmp := (SELECT b.bundle_id FROM pw_bundles b ORDER BY random() LIMIT 1);
      UPDATE platform.role_bundle_versions SET status = 'retired' WHERE id = tmp;
      undo := undo || format('UPDATE platform.role_bundle_versions SET status = ''published'' WHERE id = %L', tmp);
    END IF;
    -- 3. data (cumulative): owners, responsible sales, curators, directions; pending cases keep no curator,
    --    so the needs-curator rule stays in play
    UPDATE platform.leads SET current_owner_membership_id = CASE WHEN random() < 0.15 THEN NULL
      ELSE pg_temp.pw_id(300 + (fuzz_members || 1)[1 + floor(random() * 19)::INTEGER]) END
      WHERE organization_id = org1 AND random() < 0.3;
    UPDATE platform.student_cases SET responsible_sales_membership_id = pg_temp.pw_id(300 + (ARRAY[2, 3, 4, 15, 1, 11])[1 + floor(random() * 6)::INTEGER])
      WHERE organization_id = org1 AND random() < 0.3;
    UPDATE platform.student_cases SET current_curator_membership_id = pg_temp.pw_id(300 + fuzz_members[1 + floor(random() * 18)::INTEGER])
      WHERE organization_id = org1 AND state <> 'pending' AND random() < 0.3;
    UPDATE platform.student_cases SET admissions_direction = (ARRAY['CN', 'MY', 'EUROPE', 'AE', 'TR', NULL])[1 + floor(random() * 6)::INTEGER]
      WHERE organization_id = org1 AND random() < 0.3;
    UPDATE platform.communication_conversations SET responsible_sales_membership_id = pg_temp.pw_id(300 + (ARRAY[2, 4, 15, 3, 1, 11])[1 + floor(random() * 6)::INTEGER])
      WHERE organization_id = org1 AND queue = 'sales' AND random() < 0.3;
    UPDATE platform.communication_conversations SET current_curator_membership_id = pg_temp.pw_id(300 + fuzz_members[1 + floor(random() * 18)::INTEGER])
      WHERE organization_id = org1 AND queue = 'curator' AND random() < 0.3;
    UPDATE platform_private.sales_register SET owner_membership_id = CASE WHEN random() < 0.15 THEN NULL
      ELSE pg_temp.pw_id(300 + (fuzz_members || 1)[1 + floor(random() * 19)::INTEGER]) END
      WHERE organization_id = org1 AND random() < 0.3;
    -- 4. compare eight random members (and always the Admin, the Student and the other organization's Admin)
    FOR m IN SELECT x FROM unnest(fuzz_members) AS x ORDER BY random() LIMIT 8 LOOP
      PERFORM pg_temp.fz_compare(m, 1, it);
    END LOOP;
    PERFORM pg_temp.fz_compare(1, 1, it);
    PERFORM pg_temp.fz_compare(10, 1, it);
    PERFORM pg_temp.fz_compare(20, 2, it);
    PERFORM pg_temp.fz_compare(2, 2, it);
    -- 5. two pages against the released bodies
    PERFORM pg_temp.fz_pages(page_actors[1 + floor(random() * cardinality(page_actors))::INTEGER]);
    -- 6. undo the transient state
    FOR j IN 1..COALESCE(cardinality(undo), 0) LOOP EXECUTE undo[j]; END LOOP;
  END LOOP;
END
$fz$;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.pw_assert((SELECT count(*) FROM fz_stats WHERE label = 'set conversation') >= 8 * (current_setting('pw.fz_rounds')::INTEGER)
  AND (SELECT count(DISTINCT n) FROM fz_stats WHERE label = 'set conversation') >= LEAST(5, 1 + current_setting('pw.fz_rounds')::INTEGER)
  AND (SELECT count(DISTINCT n) FROM fz_stats WHERE label = 'set lead') >= LEAST(5, 1 + current_setting('pw.fz_rounds')::INTEGER)
  AND (SELECT count(*) FROM fz_stats WHERE label = 'readable' AND n > 0) > 0,
  'the fuzz really compared many different sets: ' || (SELECT string_agg(label || ' runs=' || c || ' distinct=' || d, ', ' ORDER BY label)
    FROM (SELECT label, count(*) c, count(DISTINCT n) d FROM fz_stats GROUP BY label) x));
SELECT pg_temp.pw_lap('pw_fuzz');
SELECT label, count(*) AS runs, min(n) AS min_size, max(n) AS max_size, count(DISTINCT n) AS distinct_sizes FROM fz_stats GROUP BY label ORDER BY label;

SELECT pg_temp.pw_assert((SELECT count(*) FROM pw_checks) > 40, 'the suite made its assertions');
SELECT 'PW310_PERMISSION_ONCE_SUITE_PASSED' AS pw_suite_result, (SELECT count(*) FROM pw_checks) AS assertions,
  (SELECT count(*) FROM pw_results) AS comparisons;
ROLLBACK;
