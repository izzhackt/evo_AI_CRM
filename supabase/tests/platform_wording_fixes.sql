\set ON_ERROR_STOP on
-- Boundary suite for migration 347 «Две мелочи с боевого». Runs on the real chain right after 347 inside one transaction
-- that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. both handoff functions name the task in Russian and no function keeps the English word; no task keeps the old
--     title; the functions keep SECURITY DEFINER and an empty search_path;
--  2. the deletion queue the Admin reads names a cabinet made by the Admin (service address, 342) by its login, and an
--     account with a real address by that address; the queue row keeps SECURITY DEFINER and an empty search_path.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $a347_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a347_auth_role$;

\echo A347_WORDING_FIXES_SUITE_START

CREATE FUNCTION pg_temp.a347_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('34700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a347_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A347: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a347_count(p_signature TEXT, p_text TEXT) RETURNS INTEGER LANGUAGE SQL STABLE AS $$
  SELECT (length(d) - length(replace(d, p_text, ''))) / length(p_text)
  FROM (SELECT pg_get_functiondef(p_signature::regprocedure) AS d) f
$$;
-- A signed-in account or a bare role: {"ok": result} or {"error": SQLSTATE, "message": text}.
CREATE FUNCTION pg_temp.a347_call(p_who INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    IF p_who IS NULL THEN
      PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::TEXT, TRUE);
      SET LOCAL ROLE service_role;
    ELSE
      PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
        'user_id', pg_temp.a347_id(p_who), 'claims', jsonb_build_object('sub', pg_temp.a347_id(p_who), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE 'SELECT to_jsonb((' || p_sql || '))' INTO result;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', TRUE);
    RETURN jsonb_build_object('ok', result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('error', v_state, 'message', v_message);
  END;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a347_id(INTEGER) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The task after a handoff is named in Russian.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a347_assert(
    pg_temp.a347_count('platform_private.handoff_lead_to_admissions(uuid,bigint,uuid,text,text,uuid)',
      $t$'Проверить данные от отдела продаж'$t$) = 3
    AND pg_temp.a347_count('platform_private.record_pending_case_sales_handoff(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,timestamp with time zone,uuid)',
      $t$'Проверить данные от отдела продаж'$t$) = 1,
  'both handoff functions name the task and the next step in Russian');
SELECT pg_temp.a347_assert(NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.pronamespace IN ('platform'::regnamespace, 'platform_private'::regnamespace)
      AND p.prosrc LIKE '%Проверить унаследованный контекст Sales%')
    AND NOT EXISTS (SELECT 1 FROM platform.case_tasks t WHERE t.title = 'Проверить унаследованный контекст Sales'),
  'no function and no task keeps the old title');
SELECT pg_temp.a347_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']) FROM pg_proc p
    WHERE p.oid IN ('platform_private.handoff_lead_to_admissions(uuid,bigint,uuid,text,text,uuid)'::regprocedure,
      'platform_private.record_pending_case_sales_handoff(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,timestamp with time zone,uuid)'::regprocedure,
      'platform_private.account_deletion_queue_row(platform_private.account_deletion_requests)'::regprocedure)),
  'the three functions keep SECURITY DEFINER and an empty search_path');

-- ---------------------------------------------------------------------------
-- 2. The deletion queue names an Admin-made cabinet by its login.
-- ---------------------------------------------------------------------------
-- Fixture: 101 the system Admin; 111 a cabinet the Admin made (service address, no name yet); 113 the same with a name
-- in its profile; 112 an account with a real address.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a347_id(1), 'A347 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  (pg_temp.a347_id(101), 'a347-1@example.invalid', '{}'::JSONB),
  (pg_temp.a347_id(111), 'student-a347@students.evoadmissions.invalid', '{}'::JSONB),
  (pg_temp.a347_id(112), 'a347-12@example.invalid', '{}'::JSONB),
  (pg_temp.a347_id(113), 'student-a347-13@students.evoadmissions.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.a347_id(201), pg_temp.a347_id(101), 'A347 Admin', 'active', 1),
    (pg_temp.a347_id(213), pg_temp.a347_id(113), 'A347 Бермет Асанова', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  VALUES (pg_temp.a347_id(301), pg_temp.a347_id(1), pg_temp.a347_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1), TRUE);

SELECT pg_temp.a347_call(101, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
  pg_temp.a347_id(1), pg_temp.a347_id(901))) #>> '{ok,provisioning_id}' AS a347_permission \gset
SELECT pg_temp.a347_call(NULL, format('platform.complete_student_account_v1(%L::UUID, %L::UUID, %L)',
  :'a347_permission', pg_temp.a347_id(111), 'aidai.chynarova')) AS a347_cabinet \gset
SELECT pg_temp.a347_call(101, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
  pg_temp.a347_id(1), pg_temp.a347_id(903))) #>> '{ok,provisioning_id}' AS a347_permission_named \gset
SELECT pg_temp.a347_call(NULL, format('platform.complete_student_account_v1(%L::UUID, %L::UUID, %L)',
  :'a347_permission_named', pg_temp.a347_id(113), 'bermet.asanova')) AS a347_cabinet_named \gset
SELECT pg_temp.a347_assert(:'a347_cabinet'::JSONB #>> '{ok,login}' = 'aidai.chynarova'
    AND :'a347_cabinet_named'::JSONB #>> '{ok,login}' = 'bermet.asanova',
  'fixture: the Admin made two cabinets with logins: ' || :'a347_cabinet' || ' ' || :'a347_cabinet_named');

INSERT INTO platform_private.account_deletion_requests(id, organization_id, request_id, subject_auth_user_id, subject_kind, due_at)
  VALUES (pg_temp.a347_id(501), pg_temp.a347_id(1), pg_temp.a347_id(601), pg_temp.a347_id(111), 'applicant', statement_timestamp() + INTERVAL '30 days'),
    (pg_temp.a347_id(502), pg_temp.a347_id(1), pg_temp.a347_id(602), pg_temp.a347_id(112), 'applicant', statement_timestamp() + INTERVAL '30 days'),
    (pg_temp.a347_id(503), pg_temp.a347_id(1), pg_temp.a347_id(603), pg_temp.a347_id(113), 'applicant', statement_timestamp() + INTERVAL '30 days');

SELECT pg_temp.a347_call(101, 'platform.staff_account_deletion_queue_v1()') AS a347_queue \gset
CREATE TEMP TABLE a347_rows ON COMMIT DROP AS
  SELECT (row ->> 'id')::UUID AS id, row ->> 'displayName' AS name, row ->> 'email' AS email
  FROM jsonb_array_elements(:'a347_queue'::JSONB -> 'ok') AS row;
SELECT pg_temp.a347_assert(
    (SELECT name = 'aidai.chynarova' AND email IS NULL FROM a347_rows WHERE id = pg_temp.a347_id(501))
    AND (SELECT name = 'A347 Бермет Асанова' AND email = 'bermet.asanova' FROM a347_rows WHERE id = pg_temp.a347_id(503))
    AND (SELECT email = 'a347-12@example.invalid' FROM a347_rows WHERE id = pg_temp.a347_id(502))
    AND strpos(:'a347_queue', 'students.evoadmissions.invalid') = 0,
  'a cabinet without a name is named by its login once, a named one shows its login, a real address stays, the service one never shows: '
    || :'a347_queue');

\echo A347_WORDING_FIXES_SUITE_PASSED

ROLLBACK;
