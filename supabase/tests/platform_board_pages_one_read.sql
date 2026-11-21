-- Boundary suite for migration 372 («Главная»: лиды и задачи одним чтением вместо страниц подряд).
--  1. platform.staff_sales_lead_pages_v1 отдаёт ровно то же, что склейка страниц прежней platform.staff_sales_lead_page,
--     которую код читал страница за страницей (page_size + 1 строк, курсор — последняя строка страницы): для каждого
--     участника (Admin, два менеджера продаж, руководитель и куратор поступления, студент, без членства, аноним), фильтра
--     (назначение, этап, срок, ответственный, связь, поиск) и пределов страниц выдача (jsonb) и ошибки (SQLSTATE и текст) равны.
--  2. platform.staff_task_list_pages_v1 так же равна склейке страниц platform.staff_task_list для каждого участника, вида и
--     статуса.
--  3. Независимая проверка без цикла: прямое чтение прежней функции одной большой страницей (её порядок проверяется строго
--     убывающим по ключу курсора), новое чтение — ровно её первые page_size * max_pages строк, обрезка — только если строк больше.
--  Сравнение не пустое: у части участников несколько страниц и обрезка на последней; ключи сортировки повторяются, поэтому
--  границы страниц проходят и внутри равных значений. Вход вне пределов — 22023; функции SECURITY INVOKER; EXECUTE только у
--  authenticated.
-- Изолированные синтетические данные; транзакция заканчивается ROLLBACK.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $t372_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t372_auth_role$;

CREATE FUNCTION pg_temp.t372_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('37200000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t372_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T372: %', message; END IF;
END
$$;
-- SQLSTATE of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.t372_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.t372_message(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.t372_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(pg_temp.t372_id(x) ORDER BY pg_temp.t372_id(x)), ARRAY[]::UUID[]) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t372_id(INTEGER), pg_temp.t372_assert(BOOLEAN, TEXT),
  pg_temp.t372_error(TEXT), pg_temp.t372_message(TEXT), pg_temp.t372_ids(INTEGER[])
  TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager A (sales department A), 3 Admissions Manager, 4 Admissions A
-- (the curator), 7 Sales Manager B (sales department B); 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t372_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO t372_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (7, NULL);
GRANT SELECT ON t372_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.t372_id(1), 'T372 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t372_id(100 + n), 't372-' || n || '@example.invalid', '{}'::JSONB FROM t372_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.t372_id(199), 't372-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t372_id(200 + n), pg_temp.t372_id(100 + n), 'T372 Actor ' || n, 'active', 1 FROM t372_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t372_id(300 + n), pg_temp.t372_id(1), pg_temp.t372_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t372_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.t372_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.t372_id(401), pg_temp.t372_id(1), 'organization', pg_temp.t372_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.t372_id(1), pg_temp.t372_id(301), pg_temp.t372_id(401), 1, 1, TRUE, 'system',
    'T372 synthetic organization scope', pg_temp.t372_id(601));

INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.t372_id(901), pg_temp.t372_id(1), 'T372 Sales A'),
  (pg_temp.t372_id(902), pg_temp.t372_id(1), 'T372 Admissions'),
  (pg_temp.t372_id(903), pg_temp.t372_id(1), 'T372 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.t372_id(1), pg_temp.t372_id(302), pg_temp.t372_id(901)),
  (pg_temp.t372_id(1), pg_temp.t372_id(303), pg_temp.t372_id(902)),
  (pg_temp.t372_id(1), pg_temp.t372_id(304), pg_temp.t372_id(902)),
  (pg_temp.t372_id(1), pg_temp.t372_id(307), pg_temp.t372_id(903));


-- Leads for paging (pages of 1-3 rows below), all on the stage «Новый» like every open lead on production on 21.11: Sales A
-- owns 7 open leads, Sales B owns 2, 6 open leads have no owner, one is closed. Update times repeat in threes, so pages also
-- break inside equal sort keys. No next step: the sales-ledger check (368) refuses a «Новый» lead with one but no receipt.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name)
  SELECT pg_temp.t372_id(3000 + k), pg_temp.t372_id(1), 'T372 Client ' || k, platform_private.normalize_person_name('T372 Client ' || k)
  FROM generate_series(1, 16) AS k;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  lifecycle_state, created_at, updated_at)
SELECT pg_temp.t372_id(3100 + k), pg_temp.t372_id(1), pg_temp.t372_id(3000 + k),
  CASE WHEN k <= 7 THEN pg_temp.t372_id(302) WHEN k <= 9 THEN pg_temp.t372_id(307) END,
  'new',
  CASE WHEN k % 2 = 0 THEN 'website' ELSE 'whatsapp' END,
  (CASE WHEN k = 16 THEN 'disqualified' ELSE 'open' END)::platform.lead_lifecycle_state,
  TIMESTAMPTZ '2026-09-01 10:00+06' + (k / 3) * INTERVAL '1 hour',
  TIMESTAMPTZ '2026-09-01 10:00+06' + (k / 3) * INTERVAL '1 hour'
FROM generate_series(1, 16) AS k;
-- Staff tasks: Sales A is the assignee of 9 tasks (4 created by the Admin, 2 of them done or cancelled), Admissions A of 2,
-- Sales B of 1. Update times repeat in pairs; three open tasks are overdue.
INSERT INTO platform.staff_tasks(id, organization_id, creator_membership_id, assignee_membership_id, title, status, priority,
  due_on, created_at, updated_at)
SELECT pg_temp.t372_id(3200 + k), pg_temp.t372_id(1),
  CASE WHEN k <= 4 THEN pg_temp.t372_id(301) ELSE pg_temp.t372_id(302) END,
  CASE WHEN k <= 9 THEN pg_temp.t372_id(302) WHEN k <= 11 THEN pg_temp.t372_id(304) ELSE pg_temp.t372_id(307) END,
  'T372 task ' || k,
  (CASE WHEN k = 3 THEN 'done' WHEN k = 8 THEN 'cancelled' ELSE 'open' END)::platform.case_task_status,
  'normal',
  CASE WHEN k IN (1, 2, 5) THEN DATE '2026-09-01' END,
  TIMESTAMPTZ '2026-09-02 10:00+06' + (k / 2) * INTERVAL '1 hour',
  TIMESTAMPTZ '2026-09-02 10:00+06' + (k / 2) * INTERVAL '1 hour'
FROM generate_series(1, 12) AS k;
SET LOCAL session_replication_role = origin;

-- Roles with the production permission keys (26.09 read-only audit, as in 244's suite).
CREATE TEMP TABLE t372_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO t372_roles VALUES
 (pg_temp.t372_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.t372_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.t372_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.t372_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.t372_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE t372_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO t372_grants VALUES
 (302, pg_temp.t372_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.t372_id(901), 'resourceKind', NULL)),
 (302, pg_temp.t372_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.t372_id(1), 'resourceKind', NULL)),
 (303, pg_temp.t372_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.t372_id(902), 'resourceKind', NULL)),
 (303, pg_temp.t372_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.t372_id(1), 'resourceKind', NULL)),
 (304, pg_temp.t372_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.t372_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.t372_id(1), 'resourceKind', NULL)),
 (307, pg_temp.t372_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.t372_id(903), 'resourceKind', NULL)),
 (307, pg_temp.t372_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.t372_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE t372_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.t372_id(1);
GRANT SELECT ON t372_roles, t372_grants, t372_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t372_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t372_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t372_admin_setup \gset
SET LOCAL request.jwt.claims TO :'t372_admin_setup';
SET LOCAL ROLE authenticated;
DO $t372_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM t372_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.t372_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'T372 ' || r.label, 'description', 'Migration 372 synthetic role',
        'permissionKeys', r.keys), 'T372 create role', pg_temp.t372_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.t372_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.t372_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'T372 publish role', pg_temp.t372_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM t372_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM t372_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.t372_id(1), pg_temp.t372_id(m),
      (SELECT access_version FROM t372_versions WHERE membership_id = pg_temp.t372_id(m)), items, bindings,
      'T372 grant roles', pg_temp.t372_id(2000 + m));
  END LOOP;
END
$t372_roles$;
RESET ROLE;

UPDATE t372_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.t372_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.t372_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS t372_admin FROM t372_actors WHERE n = 1 \gset
SELECT claims AS t372_sales_a FROM t372_actors WHERE n = 2 \gset
SELECT claims AS t372_admissions_manager FROM t372_actors WHERE n = 3 \gset
SELECT claims AS t372_admissions_a FROM t372_actors WHERE n = 4 \gset
SELECT claims AS t372_student FROM t372_actors WHERE n = 5 \gset
SELECT claims AS t372_sales_b FROM t372_actors WHERE n = 7 \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t372_id(199),
  'claims', jsonb_build_object('sub', pg_temp.t372_id(199), 'role', 'authenticated'))) -> 'claims')::TEXT AS t372_none \gset
SELECT pg_temp.t372_assert((SELECT count(*) = 4 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.t372_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.t372_ids(302, 303, 304, 307))), 'invited members have coarse role and bundle NULL');


-- The statement as another identity (claims and role are local to the transaction); a stable text answer:
-- the statement's value, or 'ERR SQLSTATE:message'.
CREATE FUNCTION pg_temp.t372_run(p_claims TEXT, p_role TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
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

-- The participants: name, claims, membership number (NULL = no membership).
CREATE TEMP TABLE t372_who(label TEXT, claims TEXT, n INTEGER);
INSERT INTO t372_who
  SELECT 'admin', :'t372_admin', 1 UNION ALL SELECT 'sales A', :'t372_sales_a', 2 UNION ALL
  SELECT 'admissions manager', :'t372_admissions_manager', 3 UNION ALL SELECT 'admissions A', :'t372_admissions_a', 4 UNION ALL
  SELECT 'student', :'t372_student', 5 UNION ALL SELECT 'sales B', :'t372_sales_b', 7 UNION ALL
  SELECT 'no membership', :'t372_none', NULL;

INSERT INTO t372_who SELECT 'anon', '{"role":"anon"}', NULL;

-- The old way: what the code did, one page at a time (page_size + 1 rows; the next page starts after the page's last row).
CREATE FUNCTION pg_temp.t372_old_lead_pages(p_size INTEGER, p_max INTEGER, p_connection TEXT, p_stage TEXT,
  p_assignment TEXT, p_owner UUID, p_due TEXT, p_query TEXT) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE page JSONB; collected JSONB := '[]'::JSONB; c_at TIMESTAMPTZ; c_id UUID; n INTEGER := 0;
BEGIN
  LOOP
    n := n + 1;
    SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'ordinality' ORDER BY r.ordinality), '[]'::JSONB) INTO page
      FROM platform.staff_sales_lead_page(p_size + 1, c_at, c_id, p_connection, p_stage, p_assignment, p_owner, p_due, p_query)
        WITH ORDINALITY AS r;
    IF jsonb_array_length(page) <= p_size THEN RETURN jsonb_build_object('rows', collected || page, 'truncated', FALSE); END IF;
    collected := collected || (page - p_size);
    IF n >= p_max THEN RETURN jsonb_build_object('rows', collected, 'truncated', TRUE); END IF;
    c_at := (page -> (p_size - 1) ->> 'sort_at')::TIMESTAMPTZ;
    c_id := (page -> (p_size - 1) ->> 'lead_id')::UUID;
  END LOOP;
END
$$;
CREATE FUNCTION pg_temp.t372_old_task_pages(p_org UUID, p_view TEXT, p_status TEXT, p_size INTEGER, p_max INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE page JSONB; collected JSONB := '[]'::JSONB; c_at TIMESTAMPTZ; c_id UUID; n INTEGER := 0;
BEGIN
  LOOP
    n := n + 1;
    SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'ordinality' ORDER BY r.ordinality), '[]'::JSONB) INTO page
      FROM platform.staff_task_list(p_org, p_view, p_status, c_at, c_id, NULL, p_size + 1) WITH ORDINALITY AS r;
    IF jsonb_array_length(page) <= p_size THEN RETURN jsonb_build_object('rows', collected || page, 'truncated', FALSE); END IF;
    collected := collected || (page - p_size);
    IF n >= p_max THEN RETURN jsonb_build_object('rows', collected, 'truncated', TRUE); END IF;
    c_at := (page -> (p_size - 1) ->> 'updated_at')::TIMESTAMPTZ;
    c_id := (page -> (p_size - 1) ->> 'id')::UUID;
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t372_old_lead_pages(INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT),
  pg_temp.t372_old_task_pages(UUID, TEXT, TEXT, INTEGER, INTEGER), pg_temp.t372_run(TEXT, TEXT, TEXT)
  TO authenticated, anon, service_role;

SELECT 'A372_BOARD_PAGES_ONE_READ_SUITE_START' AS a372_suite_marker;

-- 1. Board pages: the new read equals the old page-by-page read for every participant, filter and page limit.
DO $t372_leads$
DECLARE
  w RECORD; f RECORD; s RECORD; new_answer TEXT; old_answer TEXT; args TEXT;
  compared INTEGER := 0; with_rows INTEGER := 0; multi_page INTEGER := 0; truncated INTEGER := 0; refused INTEGER := 0;
BEGIN
  FOR w IN SELECT * FROM t372_who ORDER BY label LOOP
    FOR f IN SELECT * FROM (VALUES
      ('all', 'all', 'all', NULL::UUID, 'all', NULL::TEXT),
      ('all', 'all', 'mine', NULL, 'all', NULL),
      ('all', 'all', 'unassigned', NULL, 'all', NULL),
      ('all', 'new', 'all', NULL, 'all', NULL),
      ('all', 'new', 'unassigned', NULL, 'all', NULL),
      ('all', 'all', 'all', pg_temp.t372_id(302), 'all', NULL),
      ('all', 'all', 'all', NULL, 'scheduled', NULL),
      ('all', 'all', 'all', NULL, 'unscheduled', NULL),
      ('all', 'all', 'all', NULL, 'overdue', NULL),
      ('unconnected', 'all', 'all', NULL, 'all', NULL),
      ('all', 'all', 'all', NULL, 'all', 'T372 Client 1')) AS v(connection, stage, assignment, owner, due, query)
    LOOP
      FOR s IN SELECT * FROM (VALUES (1, 1), (2, 1), (2, 2), (2, 3), (3, 2), (2, 40), (100, 40)) AS v(size, maxp) LOOP
        args := format('%s, %s, %L, %L, %L, %L::UUID, %L, %L', s.size, s.maxp, f.connection, f.stage, f.assignment, f.owner, f.due, f.query);
        new_answer := pg_temp.t372_run(w.claims, CASE WHEN w.label = 'anon' THEN 'anon' ELSE 'authenticated' END,
          format('SELECT platform.staff_sales_lead_pages_v1(%s)::TEXT', args));
        old_answer := pg_temp.t372_run(w.claims, CASE WHEN w.label = 'anon' THEN 'anon' ELSE 'authenticated' END,
          format('SELECT pg_temp.t372_old_lead_pages(%s)::TEXT', args));
        compared := compared + 1;
        IF w.label = 'anon' THEN
          -- The anonymous caller has no EXECUTE on either new function: refused before any read.
          PERFORM pg_temp.t372_assert(new_answer LIKE 'ERR 42501:%', format('anon may not call the new lead read: %s', new_answer));
          CONTINUE;
        END IF;
        PERFORM pg_temp.t372_assert(new_answer IS NOT DISTINCT FROM old_answer,
          format('lead pages differ for %s / %s: new=%s old=%s', w.label, args, left(new_answer, 300), left(old_answer, 300)));
        IF new_answer LIKE 'ERR %' THEN refused := refused + 1; CONTINUE; END IF;
        IF jsonb_array_length(new_answer::JSONB -> 'rows') > 0 THEN with_rows := with_rows + 1; END IF;
        IF jsonb_array_length(new_answer::JSONB -> 'rows') > s.size THEN multi_page := multi_page + 1; END IF;
        IF (new_answer::JSONB ->> 'truncated')::BOOLEAN THEN truncated := truncated + 1; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.t372_assert(with_rows >= 40 AND multi_page >= 20 AND truncated >= 10 AND refused >= 7,
    format('the lead comparison is not vacuous: %s compared, %s with rows, %s over several pages, %s truncated, %s refused',
      compared, with_rows, multi_page, truncated, refused));
  RAISE NOTICE 'T372 leads: % compared, % with rows, % over several pages, % truncated, % refused',
    compared, with_rows, multi_page, truncated, refused;
END
$t372_leads$;

-- 2. Staff task pages: the new read equals the old page-by-page read for every participant, view, status and limit.
DO $t372_tasks$
DECLARE
  w RECORD; v TEXT; st TEXT; s RECORD; new_answer TEXT; old_answer TEXT; args TEXT;
  compared INTEGER := 0; with_rows INTEGER := 0; multi_page INTEGER := 0; truncated INTEGER := 0; refused INTEGER := 0;
BEGIN
  FOR w IN SELECT * FROM t372_who ORDER BY label LOOP
    FOREACH v IN ARRAY ARRAY['mine', 'created', 'all'] LOOP
      FOREACH st IN ARRAY ARRAY['active', 'overdue', 'completed', 'all'] LOOP
        FOR s IN SELECT * FROM (VALUES (1, 1), (2, 1), (2, 2), (2, 3), (3, 2), (2, 10), (50, 4)) AS x(size, maxp) LOOP
          args := format('%L::UUID, %L, %L, %s, %s', pg_temp.t372_id(1), v, st, s.size, s.maxp);
          new_answer := pg_temp.t372_run(w.claims, CASE WHEN w.label = 'anon' THEN 'anon' ELSE 'authenticated' END,
            format('SELECT platform.staff_task_list_pages_v1(%s)::TEXT', args));
          old_answer := pg_temp.t372_run(w.claims, CASE WHEN w.label = 'anon' THEN 'anon' ELSE 'authenticated' END,
            format('SELECT pg_temp.t372_old_task_pages(%s)::TEXT', args));
          compared := compared + 1;
          IF w.label = 'anon' THEN
            PERFORM pg_temp.t372_assert(new_answer LIKE 'ERR 42501:%', format('anon may not call the new task read: %s', new_answer));
            CONTINUE;
          END IF;
          PERFORM pg_temp.t372_assert(new_answer IS NOT DISTINCT FROM old_answer,
            format('task pages differ for %s / %s: new=%s old=%s', w.label, args, left(new_answer, 300), left(old_answer, 300)));
          IF new_answer LIKE 'ERR %' THEN refused := refused + 1; CONTINUE; END IF;
          IF jsonb_array_length(new_answer::JSONB -> 'rows') > 0 THEN with_rows := with_rows + 1; END IF;
          IF jsonb_array_length(new_answer::JSONB -> 'rows') > s.size THEN multi_page := multi_page + 1; END IF;
          IF (new_answer::JSONB ->> 'truncated')::BOOLEAN THEN truncated := truncated + 1; END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.t372_assert(with_rows >= 40 AND multi_page >= 20 AND truncated >= 10 AND refused >= 7,
    format('the task comparison is not vacuous: %s compared, %s with rows, %s over several pages, %s truncated, %s refused',
      compared, with_rows, multi_page, truncated, refused));
  RAISE NOTICE 'T372 tasks: % compared, % with rows, % over several pages, % truncated, % refused',
    compared, with_rows, multi_page, truncated, refused;
END
$t372_tasks$;

-- 2b. Ground truth independent of any loop: one direct read of the old function, large enough for every row of the
--     fixture, taken as PostgREST took it (to_jsonb of each row, scan order). Its order is checked to be strictly descending
--     by the cursor key; the paged read must then be exactly its first page_size * max_pages rows, truncated iff more exist.
DO $t372_truth$
DECLARE
  w RECORD; a TEXT; v TEXT; st TEXT; s RECORD; direct TEXT; paged TEXT; d JSONB; pj JSONB; n INTEGER; lim INTEGER;
  leads_checked INTEGER := 0; tasks_checked INTEGER := 0; leads_cut INTEGER := 0; tasks_cut INTEGER := 0;
BEGIN
  FOR w IN SELECT * FROM t372_who WHERE label <> 'anon' ORDER BY label LOOP
    FOREACH a IN ARRAY ARRAY['all', 'mine', 'unassigned'] LOOP
      direct := pg_temp.t372_run(w.claims, 'authenticated', format(
        'SELECT COALESCE(jsonb_agg(to_jsonb(r)), ''[]'')::TEXT FROM platform.staff_sales_lead_page(101, NULL, NULL, ''all'', ''all'', %L, NULL, ''all'', NULL) AS r', a));
      CONTINUE WHEN direct LIKE 'ERR %';
      d := direct::JSONB; n := jsonb_array_length(d);
      PERFORM pg_temp.t372_assert(n <= 100, format('one direct page holds every lead of %s / %s', w.label, a));
      PERFORM pg_temp.t372_assert(NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(d) WITH ORDINALITY AS x(e, i) JOIN jsonb_array_elements(d) WITH ORDINALITY AS y(e, i) ON y.i = x.i + 1
        WHERE ((x.e ->> 'sort_at')::TIMESTAMPTZ, (x.e ->> 'lead_id')::UUID) <= ((y.e ->> 'sort_at')::TIMESTAMPTZ, (y.e ->> 'lead_id')::UUID)),
        format('direct leads strictly descend by (sort_at, lead_id) for %s / %s', w.label, a));
      FOR s IN SELECT * FROM (VALUES (1, 1), (2, 1), (2, 2), (2, 3), (3, 2), (4, 2), (5, 3), (2, 40), (100, 40)) AS x(size, maxp) LOOP
        paged := pg_temp.t372_run(w.claims, 'authenticated', format(
          'SELECT platform.staff_sales_lead_pages_v1(%s, %s, ''all'', ''all'', %L, NULL, ''all'', NULL)::TEXT', s.size, s.maxp, a));
        pj := paged::JSONB; lim := s.size * s.maxp;
        PERFORM pg_temp.t372_assert(pj -> 'rows' = (SELECT COALESCE(jsonb_agg(x.e ORDER BY x.i), '[]'::JSONB)
            FROM jsonb_array_elements(d) WITH ORDINALITY AS x(e, i) WHERE x.i <= lim),
          format('paged leads are the first %s direct rows for %s / %s', lim, w.label, a));
        PERFORM pg_temp.t372_assert((pj ->> 'truncated')::BOOLEAN = (n > lim),
          format('leads truncated iff more than %s rows for %s / %s', lim, w.label, a));
        leads_checked := leads_checked + 1;
        IF n > lim THEN leads_cut := leads_cut + 1; END IF;
      END LOOP;
    END LOOP;
    FOREACH v IN ARRAY ARRAY['mine', 'created', 'all'] LOOP
      FOREACH st IN ARRAY ARRAY['active', 'completed', 'all'] LOOP
        direct := pg_temp.t372_run(w.claims, 'authenticated', format(
          'SELECT COALESCE(jsonb_agg(to_jsonb(r)), ''[]'')::TEXT FROM platform.staff_task_list(%L::UUID, %L, %L, NULL, NULL, NULL, 101) AS r',
          pg_temp.t372_id(1), v, st));
        CONTINUE WHEN direct LIKE 'ERR %';
        d := direct::JSONB; n := jsonb_array_length(d);
        PERFORM pg_temp.t372_assert(n <= 100, format('one direct page holds every task of %s / %s / %s', w.label, v, st));
        PERFORM pg_temp.t372_assert(NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(d) WITH ORDINALITY AS x(e, i) JOIN jsonb_array_elements(d) WITH ORDINALITY AS y(e, i) ON y.i = x.i + 1
          WHERE ((x.e ->> 'updated_at')::TIMESTAMPTZ, (x.e ->> 'id')::UUID) <= ((y.e ->> 'updated_at')::TIMESTAMPTZ, (y.e ->> 'id')::UUID)),
          format('direct tasks strictly descend by (updated_at, id) for %s / %s / %s', w.label, v, st));
        FOR s IN SELECT * FROM (VALUES (1, 1), (2, 1), (2, 2), (2, 3), (3, 2), (4, 2), (5, 3), (2, 10), (50, 4)) AS x(size, maxp) LOOP
          paged := pg_temp.t372_run(w.claims, 'authenticated', format(
            'SELECT platform.staff_task_list_pages_v1(%L::UUID, %L, %L, %s, %s)::TEXT', pg_temp.t372_id(1), v, st, s.size, s.maxp));
          pj := paged::JSONB; lim := s.size * s.maxp;
          PERFORM pg_temp.t372_assert(pj -> 'rows' = (SELECT COALESCE(jsonb_agg(x.e ORDER BY x.i), '[]'::JSONB)
              FROM jsonb_array_elements(d) WITH ORDINALITY AS x(e, i) WHERE x.i <= lim),
            format('paged tasks are the first %s direct rows for %s / %s / %s', lim, w.label, v, st));
          PERFORM pg_temp.t372_assert((pj ->> 'truncated')::BOOLEAN = (n > lim),
            format('tasks truncated iff more than %s rows for %s / %s / %s', lim, w.label, v, st));
          tasks_checked := tasks_checked + 1;
          IF n > lim THEN tasks_cut := tasks_cut + 1; END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.t372_assert(leads_checked >= 60 AND leads_cut >= 20 AND tasks_checked >= 100 AND tasks_cut >= 30,
    format('the ground truth is not vacuous: leads %s (%s cut), tasks %s (%s cut)', leads_checked, leads_cut, tasks_checked, tasks_cut));
  RAISE NOTICE 'T372 ground truth: leads % (% cut), tasks % (% cut)', leads_checked, leads_cut, tasks_checked, tasks_cut;
END
$t372_truth$;

-- 3. Limits: outside the bounds the new reads refuse with 22023 before reading anything.
SELECT pg_temp.t372_assert(pg_temp.t372_run(:'t372_admin', 'authenticated', format(
  'SELECT platform.staff_sales_lead_pages_v1(%s, %s)::TEXT', x.size, x.maxp)) LIKE 'ERR 22023:sales_workflow_invalid_limit',
  format('lead read refuses page_size %s / max_pages %s', x.size, x.maxp))
FROM (VALUES ('0', '1'), ('101', '1'), ('NULL', '1'), ('1', '0'), ('1', '41'), ('1', 'NULL'), ('-1', '5')) AS x(size, maxp);
SELECT pg_temp.t372_assert(pg_temp.t372_run(:'t372_admin', 'authenticated', format(
  'SELECT platform.staff_task_list_pages_v1(%L::UUID, ''mine'', ''active'', %s, %s)::TEXT', pg_temp.t372_id(1), x.size, x.maxp))
  LIKE 'ERR 22023:staff_task_invalid_limit',
  format('task read refuses page_size %s / max_pages %s', x.size, x.maxp))
FROM (VALUES ('0', '1'), ('101', '1'), ('NULL', '1'), ('1', '0'), ('1', '11'), ('1', 'NULL')) AS x(size, maxp);
-- The largest allowed limits read like the old way.
SELECT pg_temp.t372_assert(
  pg_temp.t372_run(:'t372_sales_a', 'authenticated', 'SELECT platform.staff_sales_lead_pages_v1(100, 40)::TEXT')
    = pg_temp.t372_run(:'t372_sales_a', 'authenticated',
      'SELECT pg_temp.t372_old_lead_pages(100, 40, ''all'', NULL, ''all'', NULL, ''all'', NULL)::TEXT'),
  'default filters read like the old way');
SELECT pg_temp.t372_assert(
  pg_temp.t372_run(:'t372_sales_a', 'authenticated', format(
    'SELECT platform.staff_task_list_pages_v1(%L::UUID, ''all'', ''all'', 100, 10)::TEXT', pg_temp.t372_id(1)))
    = pg_temp.t372_run(:'t372_sales_a', 'authenticated', format(
    'SELECT pg_temp.t372_old_task_pages(%L::UUID, ''all'', ''all'', 100, 10)::TEXT', pg_temp.t372_id(1))),
  'the largest task limits read like the old way');

-- 4. Definition: SECURITY INVOKER, STABLE, empty search_path; EXECUTE only for authenticated.
SELECT pg_temp.t372_assert(NOT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""'],
  format('%s is a stable invoker function with an empty search_path', p.oid::regprocedure))
FROM pg_proc AS p
WHERE p.oid IN ('platform.staff_sales_lead_pages_v1(integer,integer,text,text,text,uuid,text,text)'::regprocedure,
  'platform.staff_task_list_pages_v1(uuid,text,text,integer,integer)'::regprocedure);
SELECT pg_temp.t372_assert(
  has_function_privilege('authenticated', f.oid, 'EXECUTE')
  AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
  AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid = f.oid), '{}')) AS a WHERE a.grantee = 0),
  format('only authenticated may execute %s', f.oid::regprocedure))
FROM (VALUES ('platform.staff_sales_lead_pages_v1(integer,integer,text,text,text,uuid,text,text)'::regprocedure),
  ('platform.staff_task_list_pages_v1(uuid,text,text,integer,integer)'::regprocedure)) AS f(oid);

SELECT 'A372_BOARD_PAGES_ONE_READ_SUITE_PASSED' AS a372_suite_marker;
ROLLBACK;
