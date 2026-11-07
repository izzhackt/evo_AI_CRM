\set ON_ERROR_STOP on
-- Boundary suite for migration 341 «Регистрация по ссылке». Runs on the real chain right after 341 inside one transaction
-- that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves (real staff command, real service checks, real submit and approval):
--  1. a staff member who runs the lead makes a link: the row keeps only the hash, the expiry is 7 days, one audit row
--     lead.registration.link.create; a staff member without the lead and a malformed hash are refused;
--  2. the service checks a link: valid with the client's name, unknown, used, expired; browser roles cannot check;
--  3. the service uses a link once: the same account again is fine, another account gets «used», an expired link
--     stays unused; browser roles cannot use it;
--  4. the анкета of the account that used the link belongs to the link's lead, and the approval opens the case at that
--     lead with its client (one card per person); a person who already has a case gets no new link;
--  5. catalog: the three functions keep SECURITY DEFINER and empty search_path; making a link is for staff, checking and
--     using it only for the server; the journal allows lead.registration.link.create.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
DO $a341_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a341_auth_role$;

\echo A341_STUDENT_REGISTRATION_LINKS_SUITE_START

CREATE FUNCTION pg_temp.a341_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('34100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a341_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A341: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a341_hash(token TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(token, 'UTF8')), 'hex')
$$;
-- A signed-in account: {"ok": result} or {"error": SQLSTATE, "message": text}.
CREATE FUNCTION pg_temp.a341_call(p_who INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
      'user_id', pg_temp.a341_id(p_who), 'claims', jsonb_build_object('sub', pg_temp.a341_id(p_who), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
    SET LOCAL ROLE authenticated;
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
-- A call as a bare role (service_role, anon, authenticated without a profile).
CREATE FUNCTION pg_temp.a341_as(p_role TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_role)::TEXT, TRUE);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
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
GRANT EXECUTE ON FUNCTION pg_temp.a341_id(INTEGER), pg_temp.a341_hash(TEXT) TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixture: 101 system Admin, 102 a curator (coarse role, no sales rights), applicants 111, 112, 113 with confirmed email;
-- client 601 «A341 Студент Ссылка» with the open lead 621 (no owner).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a341_id(1), 'A341 Fictional organization');
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a341_id(2), pg_temp.a341_id(1), 'organization', pg_temp.a341_id(1), 1);
INSERT INTO auth.users(id, email, raw_user_meta_data, email_confirmed_at)
  SELECT pg_temp.a341_id(100 + n), 'a341-' || n || '@example.invalid', '{}'::JSONB, statement_timestamp()
  FROM unnest(ARRAY[1, 2, 11, 12, 13]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a341_id(200 + n), pg_temp.a341_id(100 + n), 'A341 Staff ' || n, 'active', 1 FROM unnest(ARRAY[1, 2]) AS n;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a341_id(300 + n), pg_temp.a341_id(1), pg_temp.a341_id(200 + n), 'active', r.role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = r.role AND status = 'published' ORDER BY version DESC LIMIT 1), n = 1
  FROM (VALUES (1, 'admin'::platform.business_role), (2, 'curator'::platform.business_role)) AS r(n, role);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.a341_id(1), pg_temp.a341_id(301), pg_temp.a341_id(2), 1, 1, TRUE, 'system', 'A341 synthetic organization scope',
    pg_temp.a341_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES (pg_temp.a341_id(930), pg_temp.a341_id(1), 'Отдел сопровождения');
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration (singleton, organization_id, review_department_id, enabled,
  intake_owner_membership_id)
  VALUES (TRUE, pg_temp.a341_id(1), pg_temp.a341_id(930), TRUE, NULL);
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, lifecycle_state)
  VALUES (pg_temp.a341_id(601), pg_temp.a341_id(1), 'A341 Студент Ссылка', platform_private.normalize_person_name('A341 Студент Ссылка'), 'active');
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state)
  VALUES (pg_temp.a341_id(621), pg_temp.a341_id(1), pg_temp.a341_id(601), NULL, 'potential', 'other', 'open');

-- ---------------------------------------------------------------------------
-- 1. Staff makes a link.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a341_call(101, format('platform.create_student_registration_link_v1(%L::UUID, %L::UUID, %L)',
  pg_temp.a341_id(1), pg_temp.a341_id(621), pg_temp.a341_hash('a341-token-one'))) AS a341_made \gset
SELECT pg_temp.a341_assert(:'a341_made'::JSONB ? 'ok'
    AND (:'a341_made'::JSONB #>> '{ok,lead_id}')::UUID = pg_temp.a341_id(621)
    AND (:'a341_made'::JSONB #>> '{ok,expires_at}')::TIMESTAMPTZ BETWEEN statement_timestamp() + INTERVAL '6 days 23 hours'
      AND statement_timestamp() + INTERVAL '7 days 1 minute',
  'the Admin makes a 7-day link for the lead: ' || :'a341_made');
SELECT pg_temp.a341_assert((SELECT count(*) = 1 AND bool_and(l.token_hash = pg_temp.a341_hash('a341-token-one')
    AND l.used_at IS NULL AND l.created_by_membership_id = pg_temp.a341_id(301))
  FROM platform_private.student_registration_links l WHERE l.lead_id = pg_temp.a341_id(621))
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action = 'lead.registration.link.create'
    AND e.resource_id = pg_temp.a341_id(621) AND NOT (e.after_state::TEXT LIKE '%a341-token-one%')),
  'only the hash is kept; one audit row without the link');
SELECT pg_temp.a341_assert(pg_temp.a341_call(102, format('platform.create_student_registration_link_v1(%L::UUID, %L::UUID, %L)',
    pg_temp.a341_id(1), pg_temp.a341_id(621), pg_temp.a341_hash('a341-token-curator'))) ->> 'error' = '42501',
  'a curator without the sales rights to the lead is refused');
SELECT pg_temp.a341_assert(pg_temp.a341_call(101, format('platform.create_student_registration_link_v1(%L::UUID, %L::UUID, %L)',
    pg_temp.a341_id(1), pg_temp.a341_id(621), 'not-a-hash')) ->> 'error' = '22023',
  'a malformed hash is refused');

-- ---------------------------------------------------------------------------
-- 2. The service checks a link.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a341_assert(pg_temp.a341_as('service_role', format('platform.check_student_registration_link_v1(%L)',
    pg_temp.a341_hash('a341-token-one'))) -> 'ok' = '{"status": "valid", "display_name": "A341 Студент Ссылка"}'::JSONB,
  'a fresh link is valid and names the client');
SELECT pg_temp.a341_assert(pg_temp.a341_as('service_role', format('platform.check_student_registration_link_v1(%L)',
    pg_temp.a341_hash('a341-token-unknown'))) #>> '{ok,status}' = 'unknown', 'an unknown link is unknown');
SELECT pg_temp.a341_assert(pg_temp.a341_as('authenticated', format('platform.check_student_registration_link_v1(%L)',
    pg_temp.a341_hash('a341-token-one'))) ->> 'error' = '42501'
  AND pg_temp.a341_as('anon', format('platform.check_student_registration_link_v1(%L)',
    pg_temp.a341_hash('a341-token-one'))) ->> 'error' = '42501',
  'browser roles cannot check a link');

-- ---------------------------------------------------------------------------
-- 3. The service uses a link once.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a341_assert(pg_temp.a341_as('anon', format('platform.consume_student_registration_link_v1(%L, %L::UUID)',
    pg_temp.a341_hash('a341-token-one'), pg_temp.a341_id(111))) ->> 'error' = '42501'
  AND pg_temp.a341_as('authenticated', format('platform.consume_student_registration_link_v1(%L, %L::UUID)',
    pg_temp.a341_hash('a341-token-one'), pg_temp.a341_id(111))) ->> 'error' = '42501',
  'browser roles cannot use a link');
SELECT pg_temp.a341_assert(pg_temp.a341_as('service_role', format('platform.consume_student_registration_link_v1(%L, %L::UUID)',
    pg_temp.a341_hash('a341-token-one'), pg_temp.a341_id(111))) ->> 'ok' = 'consumed'
  AND pg_temp.a341_as('service_role', format('platform.consume_student_registration_link_v1(%L, %L::UUID)',
    pg_temp.a341_hash('a341-token-one'), pg_temp.a341_id(111))) ->> 'ok' = 'consumed'
  AND pg_temp.a341_as('service_role', format('platform.consume_student_registration_link_v1(%L, %L::UUID)',
    pg_temp.a341_hash('a341-token-one'), pg_temp.a341_id(112))) ->> 'ok' = 'used'
  AND pg_temp.a341_as('service_role', format('platform.check_student_registration_link_v1(%L)',
    pg_temp.a341_hash('a341-token-one'))) #>> '{ok,status}' = 'used',
  'the first account uses the link (again is fine), another account gets used, the check says used');
-- An expired link: made, then aged by hand.
SELECT pg_temp.a341_call(101, format('platform.create_student_registration_link_v1(%L::UUID, %L::UUID, %L)',
  pg_temp.a341_id(1), pg_temp.a341_id(621), pg_temp.a341_hash('a341-token-old'))) AS a341_old \gset
UPDATE platform_private.student_registration_links SET created_at = statement_timestamp() - INTERVAL '9 days',
  expires_at = statement_timestamp() - INTERVAL '2 days' WHERE token_hash = pg_temp.a341_hash('a341-token-old');
SELECT pg_temp.a341_assert(pg_temp.a341_as('service_role', format('platform.check_student_registration_link_v1(%L)',
    pg_temp.a341_hash('a341-token-old'))) #>> '{ok,status}' = 'expired'
  AND pg_temp.a341_as('service_role', format('platform.consume_student_registration_link_v1(%L, %L::UUID)',
    pg_temp.a341_hash('a341-token-old'), pg_temp.a341_id(112))) ->> 'ok' = 'expired'
  AND (SELECT used_at IS NULL FROM platform_private.student_registration_links WHERE token_hash = pg_temp.a341_hash('a341-token-old')),
  'an expired link is expired and stays unused');

-- ---------------------------------------------------------------------------
-- 4. The анкета of the link's account belongs to the link's lead; the approval opens the case there.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a341_call(111, format('platform.submit_student_application_v1(%L::UUID, %L::JSONB, 0)',
  pg_temp.a341_id(711), jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.a341_id(711)::TEXT,
    'firstName', 'A341', 'lastName', 'Студент', 'phone', '+996555341001', 'destinationCountries', '["CN"]'::JSONB,
    'intakeSeason', 'autumn', 'intakeYear', 2027, 'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5',
    'studyFields', '["Инженерия"]'::JSONB, 'studyLevels', '["bachelor"]'::JSONB, 'nationality', 'KG',
    'english', jsonb_build_object('mode', 'self', 'level', 'beginner'), 'tuitionBudget', 'under_5000', 'fundingSource', 'family',
    'consent', TRUE, 'consentVersion', '2026-09-18'))) AS a341_submitted \gset
SELECT pg_temp.a341_assert(:'a341_submitted'::JSONB ? 'ok'
    AND (SELECT a.canonical_lead_id = pg_temp.a341_id(621) FROM platform_private.student_applications a
      WHERE a.id = (:'a341_submitted'::JSONB #>> '{ok,id}')::UUID),
  'the анкета of the account that used the link belongs to the link''s lead: ' || :'a341_submitted');
SELECT pg_temp.a341_call(101, format(
  'platform.decide_student_application_v1(%L::UUID, 1, ''approve'', ''A341 synthetic decision'', %L::UUID)',
  :'a341_submitted'::JSONB #>> '{ok,id}', pg_temp.a341_id(721))) AS a341_approved \gset
SELECT pg_temp.a341_assert(:'a341_approved'::JSONB #>> '{ok,status}' = 'approved'
    AND (SELECT c.canonical_lead_id = pg_temp.a341_id(621) AND c.canonical_client_id = pg_temp.a341_id(601) AND c.state = 'pending'
      FROM platform.student_cases c WHERE c.id = (:'a341_approved'::JSONB #>> '{ok,student_case_id}')::UUID)
    AND (SELECT count(*) = 1 FROM platform.leads l WHERE l.organization_id = pg_temp.a341_id(1)),
  'the approval opens the case at the link''s lead with its client; no second lead: ' || :'a341_approved');
SELECT pg_temp.a341_assert(pg_temp.a341_call(101, format('platform.create_student_registration_link_v1(%L::UUID, %L::UUID, %L)',
    pg_temp.a341_id(1), pg_temp.a341_id(621), pg_temp.a341_hash('a341-token-two'))) ->> 'error' = 'PT409',
  'a person who already has a case gets no new link');

-- ---------------------------------------------------------------------------
-- 5. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a341_assert(bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner) = 'postgres')
    AND count(*) = 3, 'the three functions are SECURITY DEFINER with an empty search_path, owner postgres')
FROM pg_proc p WHERE p.oid IN ('platform.create_student_registration_link_v1(uuid,uuid,text)'::REGPROCEDURE,
  'platform.check_student_registration_link_v1(text)'::REGPROCEDURE,
  'platform.consume_student_registration_link_v1(text,uuid)'::REGPROCEDURE);
SELECT pg_temp.a341_assert(
  has_function_privilege('authenticated', 'platform.create_student_registration_link_v1(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.create_student_registration_link_v1(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform.create_student_registration_link_v1(uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.check_student_registration_link_v1(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.check_student_registration_link_v1(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.check_student_registration_link_v1(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.consume_student_registration_link_v1(text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.consume_student_registration_link_v1(text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.consume_student_registration_link_v1(text,uuid)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'platform_private.student_registration_links', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.student_registration_links', 'SELECT'),
  'making a link is for staff; checking and using it only for the server; the table is closed');
SELECT pg_temp.a341_assert('lead.registration.link.create' = ANY (platform_private.p7a_safe_audit_actions()),
  'the journal allows lead.registration.link.create');

\echo A341_STUDENT_REGISTRATION_LINKS_SUITE_PASSED
ROLLBACK;
