\set ON_ERROR_STOP on
-- Boundary suite for migration 328 «Вернуть документ без кабинета» (docs/PLAN_CHANGES.md «2026-11-02 · Куратор Малайзии:
-- договор, возврат документа, этап подачи»). Runs on the real chain right after 328 inside one transaction that is rolled
-- back. No Storage object, real person, provider or production action.
--
-- Proves:
--  1. the function keeps its signature, definer, empty search_path and grants;
--  2. a case without a student and a case whose student has no activated portal: "return" and "reject" save the decision,
--     the reason and the slot status, with no student notification, whether publication is on or off;
--  3. the reason is still required: an empty reason is refused and saves nothing;
--  4. a case with an activated portal is unchanged: publication off refuses and saves nothing, on saves and notifies once;
--     a suspended student refuses, so a student who may read later is never silently skipped;
--  5. a staff member without the case is refused, so the shortcut adds no authority.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A328_DOCUMENT_REVIEW_WITHOUT_PORTAL_SUITE_START

CREATE FUNCTION pg_temp.a328_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('32800000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a328_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A328: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a328_claims(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a328_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a328_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
-- The review command as the actor: the result, or {"error": SQLSTATE, "message": ...}. A failed command rolls back with
-- its subtransaction, as PostgREST does for the request.
CREATE FUNCTION pg_temp.a328_review(p_claims TEXT, p_version INTEGER, p_decision TEXT, p_reason TEXT, p_request INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
  v_sql TEXT := format('SELECT platform.review_document_version_with_portal_notification_v1(%L, %L, %L::platform.document_review_decision, %L, %L)',
    pg_temp.a328_id(1), pg_temp.a328_id(p_version), p_decision, p_reason, pg_temp.a328_id(p_request));
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE v_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    result := jsonb_build_object('error', v_state, 'message', v_message);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END
$$;
-- A student-document notification for the slot of a version (the only kind 328 could have changed).
CREATE FUNCTION pg_temp.a328_notifications(p_case INTEGER) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.notifications n WHERE n.organization_id = pg_temp.a328_id(1) AND n.student_case_id = pg_temp.a328_id(p_case)
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 Admin (system admin, organization scope), 2 staff without a case, 3 Student with an activated portal,
-- 4 Student invited but not activated, 5 suspended Student with an activated portal.
-- Cases: 701 no student; 702 not activated; 703 activated; 704 suspended. One submitted version per case and decision.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a328_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, sysadmin BOOLEAN, mstatus platform.membership_status);
INSERT INTO a328_actors VALUES (1, 'admin', TRUE, 'active'), (2, NULL, FALSE, 'active'), (3, 'student', FALSE, 'active'),
  (4, 'student', FALSE, 'active'), (5, 'student', FALSE, 'active');
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a328_id(1), 'A328 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a328_id(100 + n), 'a328-' || n || '@example.invalid', '{}'::JSONB FROM a328_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a328_id(200 + n), pg_temp.a328_id(100 + n), 'A328 Actor ' || n, 'active', 1 FROM a328_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a328_id(300 + a.n), pg_temp.a328_id(1), pg_temp.a328_id(200 + a.n), a.mstatus, a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END, a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a328_actors a;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a328_id(401), pg_temp.a328_id(1), 'organization', pg_temp.a328_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a328_id(1), pg_temp.a328_id(301), pg_temp.a328_id(401), 1, 1, TRUE, 'system', 'A328 synthetic scope', pg_temp.a328_id(451));

SELECT pg_temp.a328_claims(1) AS a328_admin \gset
SELECT pg_temp.a328_claims(2) AS a328_stranger \gset

-- Seeded rows (owner, triggers off), as the other document suites do.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a328_id(410 + c), pg_temp.a328_id(1), 'student_case', pg_temp.a328_id(700 + c), 1 FROM generate_series(1, 4) c;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a328_id(1), pg_temp.a328_id(303), pg_temp.a328_id(413), 1, 1, TRUE, 'system', 'A328 synthetic scope', pg_temp.a328_id(453)),
  (pg_temp.a328_id(1), pg_temp.a328_id(305), pg_temp.a328_id(414), 1, 1, TRUE, 'system', 'A328 synthetic scope', pg_temp.a328_id(454));
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, portal_activated_at, created_at, updated_at)
SELECT pg_temp.a328_id(700 + c.n), pg_temp.a328_id(1), c.member, pg_temp.a328_id(301), pg_temp.a328_id(301), 'a328-case-' || c.n,
  'A328 Студент ' || c.n, 'Malaysia', 'bachelor', 'MY', 'documents', 'active', clock_timestamp(), pg_temp.a328_id(410 + c.n), 1, 'MY', 'documents',
  c.activated, clock_timestamp(), clock_timestamp()
FROM (VALUES (1, NULL::UUID, NULL::TIMESTAMPTZ), (2, pg_temp.a328_id(304), NULL), (3, pg_temp.a328_id(303), clock_timestamp()), (4, pg_temp.a328_id(305), clock_timestamp())) AS c(n, member, activated);
-- Custom slots: 1000 + case * 10 + i, versions: 2000 + case * 10 + i.
INSERT INTO platform.document_slots (id, organization_id, student_case_id, requirement_id, status, deadline, current_version_id,
  current_version_no, created_by_membership_id, created_at, updated_at, intent_kind, display_label, group_label)
SELECT pg_temp.a328_id(1000 + c * 10 + i), pg_temp.a328_id(1), pg_temp.a328_id(700 + c), NULL, 'submitted', NULL,
  pg_temp.a328_id(2000 + c * 10 + i), 1, pg_temp.a328_id(301), clock_timestamp(), clock_timestamp(), 'custom', 'Паспорт ' || i, 'Прочее'
FROM generate_series(1, 4) c, generate_series(1, 4) i;
INSERT INTO platform.document_versions (id, organization_id, student_case_id, document_slot_id, version_no, original_filename, declared_mime_type,
  byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id, integrity_status, malware_status, malware_scan_attestation_id, created_at)
SELECT pg_temp.a328_id(2000 + c * 10 + i), pg_temp.a328_id(1), pg_temp.a328_id(700 + c), pg_temp.a328_id(1000 + c * 10 + i), 1, 'passport.pdf', 'application/pdf', 12345,
  repeat('a', 64), 'ev:' || c || i, pg_temp.a328_id(301), 'verified', 'clean', pg_temp.a328_id(3000 + c * 10 + i), clock_timestamp() - INTERVAL '1 hour'
FROM generate_series(1, 4) c, generate_series(1, 4) i;
SET LOCAL session_replication_role = origin;
DELETE FROM platform_private.student_portal_notification_runtime_controls WHERE organization_id = pg_temp.a328_id(1);

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a328_assert((SELECT count(*) = 1 AND bool_and(p.prosecdef) AND bool_and(p.proconfig = ARRAY['search_path=""']::TEXT[])
    AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'))
  FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'review_document_version_with_portal_notification_v1'),
  'posture: one function, definer, empty search_path, authenticated only');

-- ---------------------------------------------------------------------------
-- 2. No portal: publication is off here, and the decision is still saved.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a328_review(:'a328_admin', 2011, 'correction_required', 'Нужен весь буклет одним файлом', 5011) AS a328_r1 \gset
SELECT pg_temp.a328_assert((:'a328_r1'::JSONB) ->> 'slot_status' = 'correction_required' AND NOT (:'a328_r1'::JSONB) ? 'error',
  'no student: «вернуть» is saved: ' || :'a328_r1');
SELECT pg_temp.a328_assert((SELECT s.status::TEXT = 'correction_required' FROM platform.document_slots s WHERE s.id = pg_temp.a328_id(1011))
  AND (SELECT r.reason = 'Нужен весь буклет одним файлом' FROM platform.document_reviews r WHERE r.document_version_id = pg_temp.a328_id(2011)),
  'no student: the slot status and the reason are durable');
SELECT pg_temp.a328_review(:'a328_admin', 2012, 'rejected', 'Не тот документ', 5012) AS a328_r2 \gset
SELECT pg_temp.a328_assert((:'a328_r2'::JSONB) ->> 'slot_status' = 'rejected', 'no student: «отклонить» is saved: ' || :'a328_r2');
SELECT pg_temp.a328_review(:'a328_admin', 2021, 'correction_required', 'Нужен весь буклет одним файлом', 5021) AS a328_r3 \gset
SELECT pg_temp.a328_assert((:'a328_r3'::JSONB) ->> 'slot_status' = 'correction_required', 'invited, not activated: saved: ' || :'a328_r3');
SELECT pg_temp.a328_assert(pg_temp.a328_notifications(701) = 0 AND pg_temp.a328_notifications(702) = 0, 'no portal: nobody is notified');

-- ---------------------------------------------------------------------------
-- 3. The reason is still required.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a328_assert(pg_temp.a328_review(:'a328_admin', 2013, 'correction_required', NULL, 5013) ? 'error'
  AND (SELECT s.status::TEXT = 'submitted' FROM platform.document_slots s WHERE s.id = pg_temp.a328_id(1013)),
  'no portal: an empty reason is refused and saves nothing');

-- ---------------------------------------------------------------------------
-- 5. No new authority.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a328_assert(pg_temp.a328_review(:'a328_stranger', 2014, 'correction_required', 'Причина', 5014) ->> 'error' = '42501'
  AND (SELECT s.status::TEXT = 'submitted' FROM platform.document_slots s WHERE s.id = pg_temp.a328_id(1014)),
  'staff without the case are refused and nothing is saved');

-- ---------------------------------------------------------------------------
-- 4. With a portal nothing changed.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a328_review(:'a328_admin', 2031, 'correction_required', 'Причина', 5031) AS a328_off \gset
SELECT pg_temp.a328_assert((:'a328_off'::JSONB) ->> 'error' = '55000' AND (:'a328_off'::JSONB) ->> 'message' = 'Student Portal notification publication is disabled'
  AND (SELECT s.status::TEXT = 'submitted' FROM platform.document_slots s WHERE s.id = pg_temp.a328_id(1031)),
  'portal, publication off: refused as before and nothing is saved: ' || :'a328_off');
INSERT INTO platform_private.student_portal_notification_runtime_controls (organization_id, enabled) VALUES (pg_temp.a328_id(1), TRUE);
SELECT pg_temp.a328_review(:'a328_admin', 2032, 'correction_required', 'Причина', 5032) AS a328_on \gset
SELECT pg_temp.a328_assert((:'a328_on'::JSONB) ->> 'slot_status' = 'correction_required' AND pg_temp.a328_notifications(703) = 1,
  'portal, publication on: saved and notified once: ' || :'a328_on');
UPDATE platform.organization_memberships SET status = 'suspended' WHERE id = pg_temp.a328_id(305);
SELECT pg_temp.a328_review(:'a328_admin', 2041, 'correction_required', 'Причина', 5041) AS a328_susp \gset
SELECT pg_temp.a328_assert((:'a328_susp'::JSONB) ->> 'error' = '55000' AND (:'a328_susp'::JSONB) ->> 'message' = 'Negative document review requires one live Student Portal recipient',
  'a suspended student with a portal is refused as before: ' || :'a328_susp');

\echo A328_DOCUMENT_REVIEW_WITHOUT_PORTAL_SUITE_PASSED
ROLLBACK;
