\set ON_ERROR_STOP on
-- Boundary suite for migration 380: «Сторож сроков» (docs/PLAN_CHANGES.md, 28.11.2026). Runs on the real chain right after
-- 380 inside one transaction that is rolled back, with synthetic organizations, staff and cases (invented names, no real
-- person). No Claude, no provider, no message, no production action.
--
-- Proves, on a fixed day (2026-12-01, Asia/Bishkek):
--  1. posture: the run function is definer with an empty search_path and executable by service_role only; the two helpers
--     and the repeat-key table are closed to every API role; staff, anon and an organization member without the service role
--     are refused (42501); bad arguments are refused with codes only;
--  2. the rules, row by row: a slot due yesterday, in 3 days and exactly in 7 days gives a row; in 8 and in 10 days, an empty
--     deadline, an approved slot, a removed slot, a slot of a retired requirement and a closed case give none; the next step
--     of a past day gives a row, of today none; a live unpaid tranche of a past day gives a row, a paid one, an archived one
--     and one of a closed case none; two documents of one day are one row «… и ещё 1»;
--  3. the dry run (the default) writes nothing: no task, no event, no key, no audit row; it lists the rows;
--  4. the real run: one task per row for the case curator, or for the responsible administrator when the curator cannot take a
--     task; the exact Russian title, the priority, the day, no student visibility, the task event, the audit row, the key row;
--  5. the ceiling and repeats: the same run, the next day and the day after a closed task create nothing; a new due date is a new key.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A380_CASE_DEADLINE_WATCH_SUITE_START

CREATE FUNCTION pg_temp.w380_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('38000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.w380_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A380: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.w380_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE w380_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON w380_claims TO authenticated;
CREATE FUNCTION pg_temp.w380_staff(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.w380_call('authenticated', (SELECT claims FROM w380_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.w380_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.w380_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.w380_anon(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.w380_call('anon', '{"role":"anon"}', p_sql)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.w380_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1: 1 Admin (system admin, the responsible one), 2 Student, 3 Curator (a role with the task rights, coarse role NULL like production),
-- 5 a blocked former curator. Organization 2: 4 Admin.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE w380_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN,
  status platform.membership_status);
INSERT INTO w380_actors VALUES (1, 1, 'admin', TRUE, 'active'), (2, 1, 'student', FALSE, 'active'),
  (3, 1, NULL, FALSE, 'active'), (4, 2, 'admin', TRUE, 'active'), (5, 1, NULL, FALSE, 'active');
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.w380_id(1), 'W380 Fictional organization', 'active'),
  (pg_temp.w380_id(2), 'W380 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.w380_id(100 + n), 'w380-' || n || '@example.invalid', '{}'::JSONB FROM w380_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.w380_id(200 + n), pg_temp.w380_id(100 + n), 'W380 Actor ' || n, 'active', 1 FROM w380_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.w380_id(300 + a.n), pg_temp.w380_id(a.org), pg_temp.w380_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM w380_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.w380_id(300 + n) FROM w380_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.w380_id(401), pg_temp.w380_id(1), 'organization', pg_temp.w380_id(1), 1),
  (pg_temp.w380_id(402), pg_temp.w380_id(2), 'organization', pg_temp.w380_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.w380_id(1), pg_temp.w380_id(301), pg_temp.w380_id(401), 1, 1, TRUE, 'system', 'W380 synthetic scope', pg_temp.w380_id(601)),
  (pg_temp.w380_id(1), pg_temp.w380_id(303), pg_temp.w380_id(401), 1, 1, TRUE, 'system', 'W380 synthetic scope', pg_temp.w380_id(603)),
  (pg_temp.w380_id(1), pg_temp.w380_id(305), pg_temp.w380_id(401), 1, 1, TRUE, 'system', 'W380 synthetic scope', pg_temp.w380_id(605)),
  (pg_temp.w380_id(2), pg_temp.w380_id(304), pg_temp.w380_id(402), 1, 1, TRUE, 'system', 'W380 synthetic scope', pg_temp.w380_id(604));

CREATE FUNCTION pg_temp.w380_claims_for(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.w380_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.w380_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
INSERT INTO w380_claims(actor, claims) SELECT a.n, pg_temp.w380_claims_for(a.n) FROM w380_actors a WHERE a.n IN (1, 3, 4);
SELECT pg_temp.w380_assert((SELECT count(*) = 3 AND bool_and(claims IS NOT NULL) FROM w380_claims), 'fixture: real hook claims');

-- The curators (3 and 5) take their rights from one published role, as in production.
CREATE TEMP TABLE w380_bundle(bundle_id UUID);
GRANT SELECT, INSERT ON w380_bundle TO authenticated;
CREATE FUNCTION pg_temp.w380_roles_phase() RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE published JSONB; m INTEGER; items JSONB; bindings JSONB;
BEGIN
  PERFORM platform.staff_role_command(pg_temp.w380_id(1), pg_temp.w380_id(1103), 0, 'create',
    jsonb_build_object('label', 'W380 Tasks', 'description', 'Migration 380 synthetic role',
      'permissionKeys', '["staff.task.complete","staff.task.edit","staff.task.read"]'::JSONB), 'W380 create role', pg_temp.w380_id(1141));
  published := platform.staff_role_publish(pg_temp.w380_id(1), pg_temp.w380_id(1103), 1,
    platform.staff_role_impact(pg_temp.w380_id(1), pg_temp.w380_id(1103), 1) ->> 'impactFingerprint', 'W380 publish role', pg_temp.w380_id(1142));
  INSERT INTO w380_bundle VALUES ((published ->> 'bundleId')::UUID);
  FOREACH m IN ARRAY ARRAY[3, 5] LOOP
    items := jsonb_build_array(jsonb_build_object('roleId', pg_temp.w380_id(1103),
      'scope', jsonb_build_object('kind', 'organization', 'key', pg_temp.w380_id(1), 'resourceKind', NULL)));
    bindings := jsonb_build_array(jsonb_build_object('roleId', pg_temp.w380_id(1103), 'roleVersion', 2,
      'bundleId', (SELECT bundle_id FROM w380_bundle), 'bundleVersion', 1));
    PERFORM platform.staff_role_assignments_save(pg_temp.w380_id(1), pg_temp.w380_id(300 + m),
      (SELECT p.access_version FROM platform.organization_memberships om JOIN platform.profiles p ON p.id = om.profile_id
        WHERE om.id = pg_temp.w380_id(300 + m)), items, bindings, 'W380 grant role', pg_temp.w380_id(1200 + m));
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.w380_roles_phase() TO authenticated;
SELECT claims AS w380_admin_claims FROM w380_claims WHERE actor = 1 \gset
SET LOCAL request.jwt.claims TO :'w380_admin_claims';
SET LOCAL ROLE authenticated;
SELECT pg_temp.w380_roles_phase();
RESET ROLE;
UPDATE w380_claims c SET claims = pg_temp.w380_claims_for(c.actor);
SELECT pg_temp.w380_assert(
  platform_private.ai_agent_staff_assignable(pg_temp.w380_id(1), pg_temp.w380_id(303))
  AND platform_private.ai_agent_staff_assignable(pg_temp.w380_id(1), pg_temp.w380_id(305))
  AND platform_private.ai_agent_staff_assignable(pg_temp.w380_id(1), pg_temp.w380_id(301)), 'fixture: the curators can take tasks');
-- Actor 5 loses the right to take tasks: blocked, as a curator who left (set after the claims were issued).
UPDATE platform.organization_memberships SET status = 'blocked' WHERE id = pg_temp.w380_id(305);

-- Cases (owner, triggers off). The day of the run is 2026-12-01.
--   701 slot yesterday            702 slot in 3 days          703 slot in 10 days        704 slot without a deadline
--   705 closed: all three rules   706 approved slot, past     707 next step past         708 next step today
--   709 archived tranche, past    710 paid tranche, past      711 live partly paid, past 712 curator blocked, step past
--   713 removed slot, past        714 two slots of one day    715 slot in exactly 7 days 716 slot in 8 days
--   717 slot of a retired requirement, past                   718 custom slot (own label), past
--   719 tranche paid and fully refunded, past                 720 three slots of three days (one row, the earliest)
--   721 two live tranches of two past days (one row, the earliest)
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, intake, operational_stage, state, handoff_at, closed_at,
  portal_activated_at, current_scope_id, current_scope_version, admissions_direction, pipeline_stage, next_action, next_action_due_on,
  created_at, updated_at)
SELECT pg_temp.w380_id(c.n), pg_temp.w380_id(1), pg_temp.w380_id(302), pg_temp.w380_id(301),
  CASE WHEN c.n = 712 THEN pg_temp.w380_id(305) ELSE pg_temp.w380_id(303) END,
  'w380-case-' || c.n, 'W380 Студент ' || c.n, 'China', 'bachelor', 'CN', '2027-09', 'intake',
  CASE WHEN c.n = 705 THEN 'closed' ELSE 'active' END::platform.student_case_state,
  clock_timestamp() - INTERVAL '30 days', CASE WHEN c.n = 705 THEN clock_timestamp() - INTERVAL '2 days' END,
  clock_timestamp() - INTERVAL '29 days', pg_temp.w380_id(401), 1, 'CN', 'documents',
  CASE WHEN c.step IS NOT NULL THEN 'Позвонить студенту' END, c.step,
  clock_timestamp() - INTERVAL '31 days', clock_timestamp() - INTERVAL '1 hour'
FROM (VALUES
  (701, NULL::DATE), (702, NULL), (703, NULL), (704, NULL), (705, DATE '2026-11-20'), (706, NULL), (707, DATE '2026-11-25'),
  (708, DATE '2026-12-01'), (709, NULL), (710, NULL), (711, NULL), (712, DATE '2026-11-26'), (713, NULL), (714, NULL), (715, NULL),
  (716, NULL), (717, NULL), (718, NULL), (719, NULL), (720, NULL), (721, NULL)) AS c(n, step);

INSERT INTO platform.document_requirements (id, organization_id, target_country, target_degree, program_direction, checklist_version,
  requirement_key, label, instructions, status, retired_at, created_by_membership_id) VALUES
  (pg_temp.w380_id(801), pg_temp.w380_id(1), 'China', 'bachelor', 'CN', 1, 'passport', 'Паспорт', 'Скан разворота', 'active', NULL, pg_temp.w380_id(301)),
  (pg_temp.w380_id(802), pg_temp.w380_id(1), 'China', 'bachelor', 'CN', 1, 'certificate', 'Аттестат', 'Скан аттестата', 'active', NULL, pg_temp.w380_id(301)),
  (pg_temp.w380_id(803), pg_temp.w380_id(1), 'China', 'bachelor', 'CN', 1, 'diploma', 'Диплом', 'Скан диплома', 'retired',
    clock_timestamp() - INTERVAL '1 day', pg_temp.w380_id(301));
CREATE FUNCTION pg_temp.w380_slot(p_slot INTEGER, p_case INTEGER, p_requirement INTEGER, p_status TEXT, p_deadline TIMESTAMPTZ,
  p_removed BOOLEAN DEFAULT FALSE, p_label TEXT DEFAULT NULL) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO platform.document_slots (id, organization_id, student_case_id, requirement_id, status, deadline, current_version_id,
    current_version_no, created_by_membership_id, created_at, updated_at, intent_kind, display_label, group_label,
    removed_at, removed_by_membership_id, removal_reason)
  VALUES (pg_temp.w380_id(p_slot), pg_temp.w380_id(1), pg_temp.w380_id(p_case),
    CASE WHEN p_label IS NULL THEN pg_temp.w380_id(p_requirement) END, p_status::platform.document_slot_status, p_deadline,
    CASE WHEN p_status <> 'required' THEN pg_temp.w380_id(p_slot + 5000) END, CASE WHEN p_status <> 'required' THEN 1 END,
    pg_temp.w380_id(301), clock_timestamp() - INTERVAL '20 days', clock_timestamp() - INTERVAL '1 day',
    CASE WHEN p_label IS NULL THEN 'baseline' ELSE 'custom' END::platform.document_slot_intent_kind, p_label,
    CASE WHEN p_label IS NOT NULL THEN 'Прочее' END,
    CASE WHEN p_removed THEN clock_timestamp() END, CASE WHEN p_removed THEN pg_temp.w380_id(301) END,
    CASE WHEN p_removed THEN 'W380 removed' END)
$$;
SELECT pg_temp.w380_slot(1701, 701, 801, 'required', TIMESTAMPTZ '2026-11-30 12:00+06');
SELECT pg_temp.w380_slot(1702, 702, 801, 'required', TIMESTAMPTZ '2026-12-04 12:00+06');
SELECT pg_temp.w380_slot(1703, 703, 801, 'required', TIMESTAMPTZ '2026-12-11 12:00+06');
SELECT pg_temp.w380_slot(1704, 704, 801, 'required', NULL);
SELECT pg_temp.w380_slot(1705, 705, 801, 'required', TIMESTAMPTZ '2026-11-25 12:00+06');
SELECT pg_temp.w380_slot(1706, 706, 801, 'approved', TIMESTAMPTZ '2026-11-25 12:00+06');
SELECT pg_temp.w380_slot(1713, 713, 801, 'required', TIMESTAMPTZ '2026-11-25 12:00+06', TRUE);
SELECT pg_temp.w380_slot(1714, 714, 801, 'required', TIMESTAMPTZ '2026-12-02 09:00+06');
SELECT pg_temp.w380_slot(1724, 714, 802, 'correction_required', TIMESTAMPTZ '2026-12-02 18:00+06');
SELECT pg_temp.w380_slot(1715, 715, 801, 'submitted', TIMESTAMPTZ '2026-12-08 23:30+06');
SELECT pg_temp.w380_slot(1716, 716, 801, 'required', TIMESTAMPTZ '2026-12-09 00:30+06');
SELECT pg_temp.w380_slot(1717, 717, 803, 'required', TIMESTAMPTZ '2026-11-25 12:00+06');
SELECT pg_temp.w380_slot(1718, 718, NULL, 'required', TIMESTAMPTZ '2026-11-27 12:00+06', FALSE, 'Справка из банка');
SELECT pg_temp.w380_slot(1720, 720, 801, 'required', TIMESTAMPTZ '2026-11-28 12:00+06');
SELECT pg_temp.w380_slot(1730, 720, 802, 'required', TIMESTAMPTZ '2026-11-30 12:00+06');
SELECT pg_temp.w380_slot(1740, 720, NULL, 'required', TIMESTAMPTZ '2026-12-05 12:00+06', FALSE, 'Справка');

CREATE FUNCTION pg_temp.w380_tranche(p_n INTEGER, p_case INTEGER, p_paid BIGINT, p_due TIMESTAMPTZ, p_archived BOOLEAN DEFAULT FALSE,
  p_refunded BIGINT DEFAULT 0, p_label TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO platform.payment_obligations(id, organization_id, student_case_id, label, category, amount_minor, currency, due_at, next_action,
    total_paid_minor, total_refunded_minor, created_by_membership_id, archived_at)
  VALUES (pg_temp.w380_id(p_n), pg_temp.w380_id(1), pg_temp.w380_id(p_case), COALESCE(p_label, 'Взнос ' || p_case), 'evo_service_fee', 100000, 'USD', p_due,
    'Собрать взнос', p_paid, p_refunded, pg_temp.w380_id(301), CASE WHEN p_archived THEN clock_timestamp() END)
$$;
SELECT pg_temp.w380_tranche(1805, 705, 0, TIMESTAMPTZ '2026-11-20 10:00+06');
SELECT pg_temp.w380_tranche(1809, 709, 0, TIMESTAMPTZ '2026-11-20 10:00+06', TRUE);
SELECT pg_temp.w380_tranche(1810, 710, 100000, TIMESTAMPTZ '2026-11-20 10:00+06');
SELECT pg_temp.w380_tranche(1811, 711, 40000, TIMESTAMPTZ '2026-11-20 10:00+06');
SELECT pg_temp.w380_tranche(1812, 703, 0, TIMESTAMPTZ '2026-12-01 10:00+06');
SELECT pg_temp.w380_tranche(1819, 719, 100000, TIMESTAMPTZ '2026-11-20 10:00+06', FALSE, 100000);
SELECT pg_temp.w380_tranche(1821, 721, 0, TIMESTAMPTZ '2026-11-18 10:00+06');
SELECT pg_temp.w380_tranche(1822, 721, 0, TIMESTAMPTZ '2026-11-25 10:00+06', FALSE, 0, 'Взнос 721 б');
SET LOCAL session_replication_role = origin;

SELECT pg_temp.w380_assert(
  (SELECT count(*) = 0 FROM platform_private.case_deadline_watch_rows(pg_temp.w380_id(2), DATE '2026-12-01')),
  'another organization sees none of these rows');

-- ---------------------------------------------------------------------------
-- 1. Posture and refusals.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w380_assert(
  (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
   FROM pg_proc p WHERE p.oid = 'platform.case_deadline_watch_run_v1(uuid,date,boolean,integer)'::REGPROCEDURE)
  AND (SELECT count(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('case_deadline_watch_rows', 'case_deadline_watch_title')
      AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND NOT has_table_privilege('service_role', 'platform_private.case_deadline_watch_log', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform_private.case_deadline_watch_log', 'INSERT')
  AND (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'platform_private.case_deadline_watch_log'::REGCLASS),
  'posture: the run is definer, empty search_path, service_role only; helpers and the key table closed, row security forced');

SELECT pg_temp.w380_assert(
  (pg_temp.w380_staff(1, format('SELECT platform.case_deadline_watch_run_v1(%L)', pg_temp.w380_id(1))) ->> 'error') = '42501'
  AND (pg_temp.w380_staff(3, format('SELECT platform.case_deadline_watch_run_v1(%L, NULL, FALSE)', pg_temp.w380_id(1))) ->> 'error') = '42501'
  AND (pg_temp.w380_anon(format('SELECT platform.case_deadline_watch_run_v1(%L)', pg_temp.w380_id(1))) ->> 'error') = '42501'
  AND (pg_temp.w380_call('service_role', '{"role":"authenticated"}', format('SELECT platform.case_deadline_watch_run_v1(%L)', pg_temp.w380_id(1))) ->> 'error') = '42501',
  'a staff member (the administrator and a curator), anon and a non-service session are refused with 42501');
SELECT pg_temp.w380_assert(
  (pg_temp.w380_svc('SELECT platform.case_deadline_watch_run_v1(NULL)') ->> 'error') = '22023'
  AND (pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, NULL, NULL)', pg_temp.w380_id(1))) ->> 'error') = '22023'
  AND (pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L)', pg_temp.w380_id(999))) ->> 'error') = 'P0002',
  'a missing organization or dry-run flag is 22023, an unknown organization is P0002');
SELECT pg_temp.w380_assert((SELECT count(*) = 0 FROM platform.case_tasks WHERE task_type = 'deadline_watch')
  AND (SELECT count(*) = 0 FROM platform_private.case_deadline_watch_log), 'refused calls wrote nothing');

-- ---------------------------------------------------------------------------
-- 2. The rules, row by row (the read function, as the owner).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE w380_rows AS
  SELECT right(r.case_id::TEXT, 3) AS c, r.reason_code, r.due_date, r.detail
  FROM platform_private.case_deadline_watch_rows(pg_temp.w380_id(1), DATE '2026-12-01') r;
SELECT pg_temp.w380_assert((SELECT count(*) = 11 FROM w380_rows), 'eleven rows in all, got ' || (SELECT count(*)::TEXT FROM w380_rows));
SELECT pg_temp.w380_assert(
  EXISTS (SELECT 1 FROM w380_rows WHERE c = '701' AND reason_code = 'slot_due' AND due_date = DATE '2026-11-30' AND detail = '«Паспорт»')
  AND EXISTS (SELECT 1 FROM w380_rows WHERE c = '702' AND reason_code = 'slot_due' AND due_date = DATE '2026-12-04')
  AND EXISTS (SELECT 1 FROM w380_rows WHERE c = '715' AND reason_code = 'slot_due' AND due_date = DATE '2026-12-08')
  AND EXISTS (SELECT 1 FROM w380_rows WHERE c = '718' AND reason_code = 'slot_due' AND detail = '«Справка из банка»'),
  'slot due: yesterday, in 3 days, in exactly 7 days (a submitted slot still counts, the day is the Bishkek day) and a custom slot');
SELECT pg_temp.w380_assert(
  NOT EXISTS (SELECT 1 FROM w380_rows WHERE c IN ('703', '704', '705', '706', '713', '716', '717', '708', '709', '710')),
  'none: 10 and 8 days ahead, no deadline, closed case, approved, removed, retired requirement, step today, archived and paid tranche');
SELECT pg_temp.w380_assert(
  EXISTS (SELECT 1 FROM w380_rows WHERE c = '707' AND reason_code = 'next_step_overdue' AND due_date = DATE '2026-11-25' AND detail IS NULL)
  AND EXISTS (SELECT 1 FROM w380_rows WHERE c = '712' AND reason_code = 'next_step_overdue' AND due_date = DATE '2026-11-26')
  AND EXISTS (SELECT 1 FROM w380_rows WHERE c = '711' AND reason_code = 'tranche_overdue' AND due_date = DATE '2026-11-20' AND detail = '«Взнос 711»')
  AND (SELECT count(*) = 1 FROM w380_rows WHERE c = '714' AND reason_code = 'slot_due' AND due_date = DATE '2026-12-02'
    AND detail = '«Аттестат» и ещё 1'),
  'next step of a past day, a live partly paid tranche, and two documents of one day as one row');
SELECT pg_temp.w380_assert(
  EXISTS (SELECT 1 FROM w380_rows WHERE c = '719' AND reason_code = 'tranche_overdue' AND due_date = DATE '2026-11-20')
  AND NOT EXISTS (SELECT 1 FROM w380_rows WHERE c = '710'),
  'a tranche paid and then fully refunded is unpaid again (paid minus refunded below the amount); a paid one is not');
SELECT pg_temp.w380_assert(
  (SELECT count(*) = 1 FROM w380_rows WHERE c = '720') AND EXISTS (SELECT 1 FROM w380_rows WHERE c = '720'
    AND reason_code = 'slot_due' AND due_date = DATE '2026-11-28' AND detail = '«Паспорт» и ещё 2')
  AND (SELECT count(*) = 1 FROM w380_rows WHERE c = '721') AND EXISTS (SELECT 1 FROM w380_rows WHERE c = '721'
    AND reason_code = 'tranche_overdue' AND due_date = DATE '2026-11-18' AND detail = '«Взнос 721» и ещё 1'),
  'one row per case and reason: the earliest date, the others counted in «и ещё N»');
SELECT pg_temp.w380_assert(
  (SELECT count(*) = 11 FROM platform_private.case_deadline_watch_rows(pg_temp.w380_id(1), DATE '2026-12-01') x
    WHERE x.reason_code IN ('slot_due', 'next_step_overdue', 'tranche_overdue')),
  'only the three reason codes exist (intake_without_id is not computable in SQL and is not here)');
-- The tranche of a case that is not in work does not count, and neither does the paid one: seen above (705, 710).

-- ---------------------------------------------------------------------------
-- 3. The dry run (the default) writes nothing.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-01'')', pg_temp.w380_id(1))) AS w380_dry \gset
SELECT pg_temp.w380_assert(
  (:'w380_dry'::JSONB ->> 'dry_run') = 'true' AND (:'w380_dry'::JSONB ->> 'found') = '11' AND (:'w380_dry'::JSONB ->> 'would_create') = '11'
  AND (:'w380_dry'::JSONB ->> 'capped') = '0' AND (:'w380_dry'::JSONB ->> 'max_tasks') = '50'
  AND (:'w380_dry'::JSONB ->> 'created') = '0' AND (:'w380_dry'::JSONB ->> 'skipped') = '0' AND (:'w380_dry'::JSONB ->> 'no_assignee') = '0'
  AND (:'w380_dry'::JSONB #>> '{by_reason,slot_due,found}') = '6' AND (:'w380_dry'::JSONB #>> '{by_reason,next_step_overdue,found}') = '2'
  AND (:'w380_dry'::JSONB #>> '{by_reason,tranche_overdue,found}') = '3'
  AND jsonb_array_length(:'w380_dry'::JSONB -> 'items') = 11 AND (:'w380_dry'::JSONB ->> 'items_truncated') = 'false',
  'the dry run counts and lists eleven rows by reason: ' || :'w380_dry');
SELECT pg_temp.w380_assert(
  (SELECT count(*) = 0 FROM platform.case_tasks WHERE task_type = 'deadline_watch')
  AND (SELECT count(*) = 0 FROM platform_private.case_deadline_watch_log)
  AND (SELECT count(*) = 0 FROM platform.audit_events WHERE actor_principal = 'ai-agent:case-deadline-watch'),
  'the dry run wrote no task, no key and no audit row');
SELECT pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-01'', TRUE)', pg_temp.w380_id(1))) AS w380_dry2 \gset
SELECT pg_temp.w380_assert((:'w380_dry2'::JSONB -> 'by_reason') = (:'w380_dry'::JSONB -> 'by_reason')
  AND (SELECT count(*) = 0 FROM platform_private.case_deadline_watch_log), 'a second dry run gives the same answer and still writes nothing');

-- ---------------------------------------------------------------------------
-- 4. The ceiling per run: the most overdue first, the rest counted as capped.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-01'', TRUE, 3)', pg_temp.w380_id(1))) AS w380_capdry \gset
SELECT pg_temp.w380_assert(
  (:'w380_capdry'::JSONB ->> 'would_create') = '3' AND (:'w380_capdry'::JSONB ->> 'capped') = '8' AND (:'w380_capdry'::JSONB ->> 'found') = '11'
  AND (SELECT count(*) = 3 FROM jsonb_array_elements(:'w380_capdry'::JSONB -> 'items') i WHERE i ->> 'outcome' = 'would_create'
    AND right(i ->> 'case_id', 3) IN ('721', '711', '719'))
  AND (SELECT count(*) = 8 FROM jsonb_array_elements(:'w380_capdry'::JSONB -> 'items') i WHERE i ->> 'outcome' = 'capped'),
  'the dry run with a ceiling of 3 plans the three oldest dates (721, 711, 719) and caps eight: ' || :'w380_capdry');
SELECT pg_temp.w380_assert(
  (pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-01'', TRUE, 0)', pg_temp.w380_id(1))) ->> 'error') = '22023'
  AND (pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-01'', TRUE, 1001)', pg_temp.w380_id(1))) ->> 'error') = '22023'
  AND (pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-01'', TRUE, NULL)', pg_temp.w380_id(1))) ->> 'error') = '22023'
  AND (SELECT count(*) = 0 FROM platform.case_tasks WHERE task_type = 'deadline_watch'),
  'a ceiling below 1, above 1000 or empty is 22023 and writes nothing');
SELECT pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-01'', FALSE, 3)', pg_temp.w380_id(1))) AS w380_cap \gset
SELECT pg_temp.w380_assert(
  (:'w380_cap'::JSONB ->> 'created') = '3' AND (:'w380_cap'::JSONB ->> 'capped') = '8'
  AND (SELECT count(*) = 3 FROM platform.case_tasks WHERE task_type = 'deadline_watch'
    AND student_case_id IN (pg_temp.w380_id(721), pg_temp.w380_id(711), pg_temp.w380_id(719))),
  'the real run with a ceiling of 3 makes the three most overdue tasks and no other: ' || :'w380_cap');

-- ---------------------------------------------------------------------------
-- 5. The real run (default ceiling 50): the capped rows are picked up, the three done are skipped.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-01'', FALSE)', pg_temp.w380_id(1))) AS w380_run \gset
SELECT pg_temp.w380_assert(
  (:'w380_run'::JSONB ->> 'dry_run') = 'false' AND (:'w380_run'::JSONB ->> 'created') = '8' AND (:'w380_run'::JSONB ->> 'skipped') = '3' AND (:'w380_run'::JSONB ->> 'capped') = '0'
  AND (:'w380_run'::JSONB ->> 'would_create') = '0' AND NOT (:'w380_run'::JSONB ? 'items'),
  'the real run creates the remaining eight tasks and returns counters only: ' || :'w380_run');
SELECT pg_temp.w380_assert(
  (SELECT count(*) = 11 FROM platform.case_tasks WHERE task_type = 'deadline_watch')
  AND (SELECT count(*) = 11 FROM platform_private.case_deadline_watch_log)
  AND (SELECT count(*) = 11 FROM platform.case_tasks t JOIN platform_private.case_deadline_watch_log l ON l.case_task_id = t.id
    WHERE t.task_type = 'deadline_watch' AND t.status = 'open' AND NOT t.student_visible AND t.due_on = DATE '2026-12-01'
      AND t.created_by_membership_id = pg_temp.w380_id(301)),
  'eleven open tasks, each with its key, none visible to the student, due the day of the run, made by the responsible administrator');
SELECT pg_temp.w380_assert(
  (SELECT t.title FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(701))
    = 'Срок документа — «Паспорт»: 30.11.2026'
  AND (SELECT t.title FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(707))
    = 'Следующий шаг просрочен: срок был 25.11.2026'
  AND (SELECT t.title FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(711))
    = 'Платёж просрочен — «Взнос 711»: срок был 20.11.2026'
  AND (SELECT t.title FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(714))
    = 'Срок документа — «Аттестат» и ещё 1: 02.12.2026'
  AND (SELECT t.title FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(718))
    = 'Срок документа — «Справка из банка»: 27.11.2026'
  AND (SELECT t.title FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(720))
    = 'Срок документа — «Паспорт» и ещё 2: 28.11.2026'
  AND (SELECT t.title FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(721))
    = 'Платёж просрочен — «Взнос 721» и ещё 1: срок был 18.11.2026',
  'the titles are the exact Russian words of the screen');
SELECT pg_temp.w380_assert(
  (SELECT t.priority = 'high' FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(701))
  AND (SELECT t.priority = 'normal' FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(702))
  AND (SELECT t.priority = 'normal' FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(715)),
  'a past date is high, a coming date is normal');
SELECT pg_temp.w380_assert(
  (SELECT t.assignee_membership_id = pg_temp.w380_id(303) FROM platform.case_tasks t
    WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(701))
  AND (SELECT t.assignee_membership_id = pg_temp.w380_id(301) FROM platform.case_tasks t
    WHERE t.task_type = 'deadline_watch' AND t.student_case_id = pg_temp.w380_id(712)),
  'the task goes to the case curator; a curator who cannot take tasks sends it to the responsible administrator');
SELECT pg_temp.w380_assert(
  (SELECT count(*) = 11 FROM platform.case_task_events e JOIN platform.case_tasks t ON t.id = e.case_task_id
    WHERE t.task_type = 'deadline_watch' AND e.new_status = 'open' AND e.previous_status IS NULL)
  AND (SELECT count(*) = 11 FROM platform.audit_events a WHERE a.actor_principal = 'ai-agent:case-deadline-watch'
    AND a.actor_kind = 'service' AND a.resource_type = 'case_task' AND a.action = 'ai.agent.tool.write'
    AND a.resource_id IN (SELECT id FROM platform.case_tasks WHERE task_type = 'deadline_watch')),
  'one task event and one audit row per task');
SELECT pg_temp.w380_assert(EXISTS (SELECT 1 FROM platform_private.case_deadline_watch_log
  WHERE watch_key = 'watch:' || pg_temp.w380_id(701)::TEXT || ':slot_due:2026-11-30'), 'the key of a task is watch:<case>:<reason>:<date>');
SELECT pg_temp.w380_assert((SELECT count(*) = 11 FROM platform_private.case_deadline_watch_log l
  JOIN platform.case_tasks t ON t.id = l.case_task_id
  WHERE l.watch_key = 'watch:' || t.student_case_id::TEXT || ':'
    || CASE WHEN t.title LIKE 'Срок документа%' THEN 'slot_due' WHEN t.title LIKE 'Следующий шаг%' THEN 'next_step_overdue' ELSE 'tranche_overdue' END
    || ':' || to_char(to_date(substring(t.title FROM '(\d{2}\.\d{2}\.\d{4})'), 'DD.MM.YYYY'), 'YYYY-MM-DD')),
  'every key matches the reason and the date of its task title');

-- ---------------------------------------------------------------------------
-- 6. Repeats.
-- ---------------------------------------------------------------------------
SELECT pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-01'', FALSE)', pg_temp.w380_id(1))) AS w380_again \gset
SELECT pg_temp.w380_assert((:'w380_again'::JSONB ->> 'created') = '0' AND (:'w380_again'::JSONB ->> 'skipped') = '11'
  AND (SELECT count(*) = 11 FROM platform.case_tasks WHERE task_type = 'deadline_watch'), 'the same run again makes no duplicate: ' || :'w380_again');
-- The next day: the old rows keep their keys; three things are new: the slot that has just come within 7 days (716), the step
-- of 708 that was due «today» yesterday, and the tranche of 703 that was due «today» yesterday.
SELECT pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-02'', FALSE)', pg_temp.w380_id(1))) AS w380_next \gset
SELECT pg_temp.w380_assert((:'w380_next'::JSONB ->> 'created') = '3' AND (:'w380_next'::JSONB ->> 'skipped') = '11'
  AND (SELECT count(*) = 3 FROM platform.case_tasks t WHERE t.task_type = 'deadline_watch'
    AND t.student_case_id IN (pg_temp.w380_id(716), pg_temp.w380_id(708), pg_temp.w380_id(703)))
  AND (SELECT count(*) = 14 FROM platform.case_tasks WHERE task_type = 'deadline_watch'),
  'the next day only the three newly due rows are new: ' || :'w380_next');
-- Tasks closed by the curator: not recreated, while the key stands.
UPDATE platform.case_tasks SET status = 'done' WHERE task_type = 'deadline_watch';
SELECT pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-03'', FALSE)', pg_temp.w380_id(1))) AS w380_closed \gset
SELECT pg_temp.w380_assert((:'w380_closed'::JSONB ->> 'created') = '0' AND (:'w380_closed'::JSONB ->> 'skipped') = '14'
  AND (SELECT count(*) = 14 FROM platform.case_tasks WHERE task_type = 'deadline_watch' AND status = 'done'),
  'closed tasks are not recreated by the next run: ' || :'w380_closed');
-- A moved due date is a new key and a new task.
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET next_action_due_on = DATE '2026-11-28' WHERE id = pg_temp.w380_id(707);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L, DATE ''2026-12-03'', FALSE)', pg_temp.w380_id(1))) AS w380_moved \gset
SELECT pg_temp.w380_assert((:'w380_moved'::JSONB ->> 'created') = '1'
  AND (SELECT count(*) = 2 FROM platform.case_tasks WHERE task_type = 'deadline_watch' AND student_case_id = pg_temp.w380_id(707)),
  'a moved due date makes one new task: ' || :'w380_moved');
-- The day defaults to the Bishkek day of the call when it is not given.
SELECT pg_temp.w380_assert(
  ((pg_temp.w380_svc(format('SELECT platform.case_deadline_watch_run_v1(%L)', pg_temp.w380_id(1))) ->> 'today')::DATE)
    = (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE, 'without a day the Bishkek day of the call is used');

\echo A380_CASE_DEADLINE_WATCH_SUITE_PASSED
ROLLBACK;
