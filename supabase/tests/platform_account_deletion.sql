\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 279 «Удаление аккаунта по
-- запросу» (docs/PLAN_CHANGES.md 2026-10-07 and the addendum 2026-10-08
-- «упрощение для 1.0»: automatic processing only for a SIMPLE account, the
-- rest is manual, docs/runbooks/account-deletion.md). Runs at the 279
-- checkpoint against the full schema and whatever earlier suites left in it.
-- Accounts come through the REAL анкета path (submit/decide
-- student_application_v1) and the real member provisioning
-- (provision_member_authorized_e1); what a person produces elsewhere is
-- seeded directly (replica mode only for fixtures, never for the erasure).
-- Every row rolls back at the end.
--
-- The OWN SET of an account is stated here independently of the migration
-- (p279_closure): every row reachable by foreign key from its Auth user
-- (rows whose foreign key points at a reached row, to a fixpoint, through
-- every table of every schema), the journal entries whose resource_id is a
-- reached row, and the Supabase Auth journal entries keyed by its user id.
--
-- Proven here:
--   (a) processing a simple account changes NO row outside its own set: a
--       md5 snapshot of every other row of every table of platform,
--       platform_private, private, public, auth and storage, compared row by
--       row, no masks; the deletion request row itself may change only in
--       its status columns;
--   (b) every row of the own set is gone after processing, the simulated
--       auth.admin.deleteUser and completion; no own table can hold a
--       Storage key, and storage.objects is part of the snapshot of (a);
--   (c) every non-simple kind is refused by process_account_deletion_v1
--       with account_deletion_not_simple and its reason codes, changing
--       nothing: a case and a converted анкета, a lead and its client, a
--       payment, a contract file, a WhatsApp conversation, any other
--       reachable record (other_records);
--   (d) only the system Admin (account.deletion.process) reads the queue
--       and the detail, processes, completes, marks a manual request done
--       and records the email; Sales, Curator, a student, an applicant, anon
--       and service_role are refused; a person requests only for itself
--       (staff and anon refused); every step is idempotent; the manual
--       «Отметить выполненным» needs a note and a login that no longer
--       works, refuses a simple account, changes nothing but the request,
--       and is journaled with the note; the guard bypass exists only inside
--       the erasure transaction;
--   (e) on a synthetic volume, the detail and the processing of a simple
--       applicant and of a simple student membership finish far below the
--       8 s statement_timeout.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- The lightweight Auth bootstrap of the harness (126/185/193 convention):
-- managed Supabase Auth owns these columns, its journal, its PKCE flows and
-- auth.role(); add them transaction-locally where missing, ROLLBACK discards
-- the DDL. deleted_at is what auth.admin.deleteUser(id, true) sets.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
DO $p279_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = ''
    AS $fn$ SELECT NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role' $fn$;
  END IF;
END
$p279_auth_role$;
CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
  instance_id UUID, id UUID PRIMARY KEY, payload JSON, created_at TIMESTAMPTZ, ip_address VARCHAR(64)
);
CREATE TABLE IF NOT EXISTS auth.flow_state (id UUID PRIMARY KEY, user_id UUID, auth_code TEXT);

CREATE FUNCTION pg_temp.p279_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;

CREATE FUNCTION pg_temp.p279_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 279 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.p279_claims(p_auth_user_id UUID) RETURNS TEXT
LANGUAGE SQL AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', p_auth_user_id,
    'claims', jsonb_build_object('sub', p_auth_user_id, 'role', 'authenticated'))) -> 'claims')::TEXT
$$;

-- Runs one RPC expression as somebody: a user id (its real access-token
-- claims, role authenticated), 'anon' or 'service_role'. Returns
-- {"ok": result} or {"error": sqlstate, "message": ..., "detail": ...}.
CREATE FUNCTION pg_temp.p279_call(p_who TEXT, p_sql TEXT) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT; v_detail TEXT;
BEGIN
  BEGIN
    IF p_who IN ('anon', 'service_role') THEN
      PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_who)::TEXT, TRUE);
      EXECUTE format('SET LOCAL ROLE %I', p_who);
    ELSE
      PERFORM set_config('request.jwt.claims', pg_temp.p279_claims(p_who::UUID), TRUE);
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE 'SELECT to_jsonb((' || p_sql || '))' INTO result;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', TRUE);
    RETURN jsonb_build_object('ok', result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    RETURN jsonb_build_object('error', v_state, 'message', v_message, 'detail', NULLIF(v_detail, ''));
  END;
END
$$;

CREATE FUNCTION pg_temp.p279_questionnaire(p_request UUID, p_first TEXT, p_last TEXT, p_phone TEXT)
RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1, 'requestId', p_request::TEXT,
    'firstName', p_first, 'lastName', p_last, 'phone', p_phone,
    'destinationCountries', jsonb_build_array('CN'), 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5',
    'studyFields', jsonb_build_array('Инженерия'), 'studyLevels', jsonb_build_array('bachelor'),
    'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
    'tuitionBudget', 'under_5000', 'fundingSource', 'family',
    'consent', TRUE, 'consentVersion', '2026-09-18')
$$;

-- A real анкета submitted by the account itself.
CREATE FUNCTION pg_temp.p279_submit(p_auth_user_id UUID, p_request UUID, p_first TEXT, p_last TEXT, p_phone TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.p279_call(p_auth_user_id::TEXT, format('platform.submit_student_application_v1(%L::UUID, %L::JSONB, 0)',
    p_request, pg_temp.p279_questionnaire(p_request, p_first, p_last, p_phone)));
  PERFORM pg_temp.p279_assert(r ? 'ok', 'анкета submit failed: ' || r::TEXT);
  RETURN (r #>> '{ok,id}')::UUID;
END
$$;

-- ---------------------------------------------------------------------------
-- The own set, stated independently of the migration (see the header).
-- p279_reach keeps each row by its ctid: the suite is one transaction, so a
-- deleted row's ctid is never reused before ROLLBACK.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p279_reach (tag TEXT NOT NULL, tbl TEXT NOT NULL, tid TID NOT NULL,
  PRIMARY KEY (tag, tbl, tid));

CREATE FUNCTION pg_temp.p279_closure(p_tag TEXT, p_auth_user_id UUID, p_org UUID) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE rec RECORD; added BIGINT; m BIGINT; v_round INTEGER := 0;
BEGIN
  DELETE FROM p279_reach WHERE tag = p_tag;
  CREATE TEMP TABLE IF NOT EXISTS p279_round (tbl TEXT, tid TID, rnd INTEGER);
  DELETE FROM p279_round;
  INSERT INTO p279_reach SELECT p_tag, 'auth.users', u.ctid FROM auth.users u WHERE u.id = p_auth_user_id;
  INSERT INTO p279_round SELECT 'auth.users', u.ctid, 0 FROM auth.users u WHERE u.id = p_auth_user_id;
  INSERT INTO p279_reach SELECT p_tag, 'auth.audit_log_entries', e.ctid FROM auth.audit_log_entries e
  WHERE e.payload ->> 'actor_id' = p_auth_user_id::TEXT OR e.payload -> 'traits' ->> 'user_id' = p_auth_user_id::TEXT;
  INSERT INTO p279_reach SELECT p_tag, 'auth.flow_state', f.ctid FROM auth.flow_state f WHERE f.user_id = p_auth_user_id;
  LOOP
    added := 0;
    -- Rows whose foreign key points at a row reached in the last round.
    FOR rec IN
      SELECT format('%I.%I', cn.nspname, cc.relname) AS child, format('%I.%I', pn.nspname, pc.relname) AS parent,
        (SELECT string_agg(format('c.%I', a.attname), ', ' ORDER BY k.i) FROM unnest(con.conkey) WITH ORDINALITY k(n, i)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n) AS ccols,
        (SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY k.i) FROM unnest(con.confkey) WITH ORDINALITY k(n, i)
          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n) AS pcols
      FROM pg_constraint con
      JOIN pg_class cc ON cc.oid = con.conrelid JOIN pg_namespace cn ON cn.oid = cc.relnamespace
      JOIN pg_class pc ON pc.oid = con.confrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
      WHERE con.contype = 'f'
        AND format('%I.%I', pn.nspname, pc.relname) IN (SELECT r.tbl FROM p279_round r WHERE r.rnd = v_round)
        AND format('%I.%I', cn.nspname, cc.relname) <> 'platform_private.account_deletion_requests'
    LOOP
      EXECUTE format('INSERT INTO p279_round SELECT %L, c.ctid, $2 + 1 FROM %s c
        WHERE (%s) IN (SELECT %s FROM %s p WHERE p.ctid = ANY (ARRAY(SELECT r.tid FROM p279_round r
          WHERE r.tbl = %L AND r.rnd = $2)))
          AND NOT EXISTS (SELECT 1 FROM p279_reach z WHERE z.tag = $1 AND z.tbl = %L AND z.tid = c.ctid)',
        rec.child, rec.child, rec.ccols, rec.pcols, rec.parent, rec.parent, rec.child) USING p_tag, v_round;
    END LOOP;
    -- Journal entries about a row reached in the last round.
    FOR rec IN SELECT DISTINCT r.tbl FROM p279_round r WHERE r.rnd = v_round
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = r.tbl::REGCLASS AND a.attname = 'id'
        AND a.atttypid = 'uuid'::REGTYPE AND NOT a.attisdropped)
    LOOP
      EXECUTE format('INSERT INTO p279_round SELECT ''platform.audit_events'', e.ctid, $2 + 1
        FROM platform.audit_events e WHERE e.organization_id = $3 AND e.resource_id IN (SELECT x.id FROM %s x
          WHERE x.ctid = ANY (ARRAY(SELECT r.tid FROM p279_round r WHERE r.tbl = %L AND r.rnd = $2)))
          AND NOT EXISTS (SELECT 1 FROM p279_reach z WHERE z.tag = $1 AND z.tbl = ''platform.audit_events''
            AND z.tid = e.ctid)', rec.tbl, rec.tbl) USING p_tag, v_round, p_org;
    END LOOP;
    INSERT INTO p279_reach SELECT DISTINCT p_tag, r.tbl, r.tid FROM p279_round r WHERE r.rnd = v_round + 1
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS added = ROW_COUNT;
    EXIT WHEN added = 0;
    v_round := v_round + 1;
  END LOOP;
  SELECT count(*) INTO m FROM p279_reach WHERE tag = p_tag;
  RETURN m;
END
$$;

-- md5 of EVERY row of every base table of the six schemas except the own set
-- of the tag and the subject's deletion request rows (compared separately).
CREATE TEMP TABLE p279_snap (tag TEXT NOT NULL, tbl TEXT NOT NULL, h TEXT NOT NULL);
CREATE INDEX ON p279_snap (tag, tbl);

CREATE FUNCTION pg_temp.p279_snapshot(p_tag TEXT, p_auth_user_id UUID) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT := 0; m BIGINT;
BEGIN
  DELETE FROM p279_snap WHERE tag = p_tag;
  FOR r IN SELECT format('%I.%I', table_schema, table_name) AS q FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema IN ('platform', 'platform_private', 'private', 'public', 'auth', 'storage')
    ORDER BY 1
  LOOP
    EXECUTE format('INSERT INTO p279_snap (tag, tbl, h) SELECT $1, %L, md5(x::TEXT) FROM %s x
      WHERE NOT EXISTS (SELECT 1 FROM p279_reach z WHERE z.tag = $1 AND z.tbl = %L AND z.tid = x.ctid)%s',
      r.q, r.q, r.q,
      CASE WHEN r.q = 'platform_private.account_deletion_requests'
        THEN ' AND x.subject_auth_user_id IS DISTINCT FROM $2' ELSE '' END) USING p_tag, p_auth_user_id;
    GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  END LOOP;
  RETURN n;
END
$$;

-- Tables where a row of the snapshot is gone or changed ('' = none). New
-- rows (the journal of the deletion steps) are additions, not changes.
CREATE FUNCTION pg_temp.p279_changed(p_tag TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT; found TEXT := '';
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM p279_snap WHERE tag = p_tag ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM (SELECT h FROM p279_snap WHERE tag = $1 AND tbl = $2
      EXCEPT ALL SELECT md5(x::TEXT) FROM %s x) q', r.tbl) INTO n USING p_tag, r.tbl;
    IF n > 0 THEN found := found || r.tbl || '=' || n || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;

-- Tables where a row of the own set is still there ('' = none).
CREATE FUNCTION pg_temp.p279_left(p_tag TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE r RECORD; n BIGINT; found TEXT := '';
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM p279_reach WHERE tag = p_tag ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM %s x WHERE x.ctid = ANY (ARRAY(SELECT z.tid FROM p279_reach z
      WHERE z.tag = $1 AND z.tbl = %L))', r.tbl, r.tbl) INTO n USING p_tag;
    IF n > 0 THEN found := found || r.tbl || '=' || n || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;

-- The tables of the own set ('a,b,c').
CREATE FUNCTION pg_temp.p279_tables(p_tag TEXT) RETURNS TEXT
LANGUAGE SQL AS $$
  SELECT string_agg(DISTINCT tbl COLLATE "C", ',' ORDER BY tbl COLLATE "C") FROM p279_reach WHERE tag = p_tag
$$;

-- The subject's request row without the columns processing may change.
CREATE FUNCTION pg_temp.p279_request_fixed(p_request UUID) RETURNS JSONB
LANGUAGE SQL AS $$
  SELECT to_jsonb(r) - ARRAY['status', 'processing_started_at', 'processing_started_by_membership_id',
    'last_processed_at', 'completed_at', 'completed_by_membership_id', 'completion_mode', 'manual_note',
    'erasure_transaction_id', 'confirmation_email', 'confirmation_email_status', 'summary', 'membership_id']
  FROM platform_private.account_deletion_requests r WHERE r.id = p_request
$$;

-- ---------------------------------------------------------------------------
-- Seed: organization, staff (system Admin, Sales, Curator), the анкета
-- configuration WITHOUT an intake owner first (an анкета then links no lead:
-- the simple applicant), an intake owner later (the анкета links a lead and
-- a client at submit: not simple).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name) VALUES (pg_temp.p279_id(1), 'Migration 279 synthetic organization');
INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p279_id(2), pg_temp.p279_id(1), 'organization', pg_temp.p279_id(1), 1);

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
SELECT pg_temp.p279_id(100 + n), 'p279-' || k || '@example.invalid', '{}'::JSONB, statement_timestamp()
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'aigerim'), (5, 'bakyt'), (6, 'bare'),
  (7, 'medina'), (8, 'timur'), (9, 'zarina'), (10, 'ermek'), (11, 'aigerim-namesake'), (12, 'aigerim2'),
  (13, 'medina2')) AS a(n, k);

INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version)
VALUES
  (pg_temp.p279_id(201), pg_temp.p279_id(101), 'P279 Admin', 'active', 1),
  (pg_temp.p279_id(202), pg_temp.p279_id(102), 'P279 Sales', 'active', 1),
  (pg_temp.p279_id(203), pg_temp.p279_id(103), 'P279 Curator', 'active', 1);
INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
)
SELECT pg_temp.p279_id(300 + a.n), pg_temp.p279_id(1), pg_temp.p279_id(200 + a.n), 'active',
  a.role::platform.business_role,
  (SELECT id FROM platform.role_bundle_versions WHERE role = a.role::platform.business_role
     AND status = 'published' ORDER BY version DESC LIMIT 1),
  a.role = 'admin'
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator')) AS a(n, role);
INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id
)
SELECT pg_temp.p279_id(1), pg_temp.p279_id(300 + n), pg_temp.p279_id(2), 1, 1, TRUE, 'system',
  'P279 synthetic organization scope', pg_temp.p279_id(600 + n)
FROM generate_series(1, 3) AS n;

INSERT INTO platform.staff_departments (id, organization_id, name)
VALUES (pg_temp.p279_id(930), pg_temp.p279_id(1), 'Отдел сопровождения');
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration
  (singleton, organization_id, review_department_id, enabled, intake_owner_membership_id)
VALUES (TRUE, pg_temp.p279_id(1), pg_temp.p279_id(930), TRUE, NULL);

SELECT pg_temp.p279_id(101)::TEXT AS p279_admin, pg_temp.p279_id(102)::TEXT AS p279_sales,
  pg_temp.p279_id(103)::TEXT AS p279_curator, pg_temp.p279_id(104)::TEXT AS p279_aigerim,
  pg_temp.p279_id(105)::TEXT AS p279_bakyt, pg_temp.p279_id(106)::TEXT AS p279_bare,
  pg_temp.p279_id(107)::TEXT AS p279_medina, pg_temp.p279_id(108)::TEXT AS p279_timur,
  pg_temp.p279_id(109)::TEXT AS p279_zarina, pg_temp.p279_id(110)::TEXT AS p279_ermek,
  pg_temp.p279_id(111)::TEXT AS p279_namesake \gset

-- ---------------------------------------------------------------------------
-- Simple accounts (no intake owner yet):
--  * Айгерим: a pending анкета; Supabase Auth journal and a PKCE flow of her
--    own; her namesake (same name and phone, another account) and a staff
--    journal entry about another record that quotes her email stay.
--  * Бакыт: an анкета the Admin rejected (the staff decision receipt is
--    about his анкета, so it is his).
--  * Bare: signed up, no анкета.
--  * Медина: a student membership without any case (real provisioning), with
--    a favourite, a consultation request a curator handled, a test attempt
--    and its receipt, a lesson attempt and its receipt, a notification
--    consent with its event, journal entries she wrote and one a curator
--    wrote about her consultation request.
--  * Эрмек: a pending анкета, but a legacy V1 contact of his own (public
--    schema) points at his Auth user: not an own table, so he is manual
--    (other_records) although nothing else is there.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p279_submit(:'p279_aigerim', pg_temp.p279_id(701), 'Айгерим', 'Удалова', '+996 700 279 104') AS p279_aigerim_app \gset
SELECT pg_temp.p279_submit(:'p279_namesake', pg_temp.p279_id(702), 'Айгерим', 'Удалова', '+996 700 279 104') AS p279_namesake_app \gset
SELECT pg_temp.p279_submit(:'p279_bakyt', pg_temp.p279_id(703), 'Бакыт', 'Отказов', '+996 700 279 105') AS p279_bakyt_app \gset
SELECT pg_temp.p279_submit(:'p279_ermek', pg_temp.p279_id(704), 'Эрмек', 'Легаси', '+996 700 279 110') AS p279_ermek_app \gset

SELECT pg_temp.p279_assert(
  (SELECT r ? 'ok' FROM pg_temp.p279_call(:'p279_admin', format(
    'platform.decide_student_application_v1(%L::UUID, 1, ''reject'', ''P279 отказ'', %L::UUID)',
    :'p279_bakyt_app', pg_temp.p279_id(711))) r),
  'the Admin could not reject Бакыт''s анкета');
SELECT pg_temp.p279_assert(
  (SELECT count(*) FROM platform_private.student_applications a
   WHERE a.id IN (:'p279_aigerim_app', :'p279_bakyt_app', :'p279_ermek_app') AND a.canonical_lead_id IS NULL) = 3
  AND (SELECT a.status FROM platform_private.student_applications a WHERE a.id = :'p279_bakyt_app') = 'rejected',
  'without an intake owner the анкеты must link no lead');

INSERT INTO auth.audit_log_entries (instance_id, id, payload, created_at, ip_address)
VALUES
  (NULL, pg_temp.p279_id(951), json_build_object('action', 'login', 'actor_id', :'p279_aigerim',
    'actor_username', 'p279-aigerim@example.invalid'), statement_timestamp(), '10.2.7.9'),
  (NULL, pg_temp.p279_id(952), json_build_object('action', 'login', 'actor_id', :'p279_namesake',
    'actor_username', 'p279-aigerim-namesake@example.invalid'), statement_timestamp(), '10.2.7.10');
INSERT INTO auth.flow_state (id, user_id, auth_code) VALUES
  (pg_temp.p279_id(953), :'p279_aigerim', 'p279-flow'), (pg_temp.p279_id(954), :'p279_namesake', 'p279-flow-2');
-- A staff journal entry about ANOTHER record that quotes Айгерим's email and
-- name: no foreign key and no resource of hers, so it never changes.
INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_profile_id, actor_membership_id,
  actor_principal, action, resource_type, resource_id, after_state, reason, request_id)
VALUES (pg_temp.p279_id(955), pg_temp.p279_id(1), 'user', pg_temp.p279_id(202), pg_temp.p279_id(302),
  'auth:' || :'p279_sales', 'lead.note.add', 'lead', pg_temp.p279_id(956),
  jsonb_build_object('note', 'Айгерим Удалова, p279-aigerim@example.invalid, +996 700 279 104'),
  'P279 упоминание в чужой записи', pg_temp.p279_id(957));

-- Медина: a real student membership without any case.
SELECT platform_private.provision_member_authorized_e1(pg_temp.p279_id(1), :'p279_medina', 'Медина Порталова',
  'student', 'P279 student without a case', pg_temp.p279_id(721), pg_temp.p279_id(201), :'p279_admin') ->> 'membership_id'
  AS p279_medina_member \gset
SELECT platform_private.assign_organization_scope_authorized_e1(pg_temp.p279_id(1), :'p279_medina_member',
  'P279 student without a case', pg_temp.p279_id(722), pg_temp.p279_id(201), :'p279_admin') IS NOT NULL AS p279_ok \gset
SELECT m.profile_id AS p279_medina_profile FROM platform.organization_memberships m WHERE m.id = :'p279_medina_member' \gset
SELECT pg_temp.p279_assert(NOT EXISTS (SELECT 1 FROM platform.student_cases sc
  WHERE sc.student_membership_id = :'p279_medina_member'), 'Медина must have no case');

SET LOCAL session_replication_role = replica;
INSERT INTO platform_private.university_favorites (organization_id, membership_id, institution_id)
VALUES (pg_temp.p279_id(1), :'p279_medina_member', pg_temp.p279_id(863));
INSERT INTO platform_private.portal_consultation_requests (id, organization_id, membership_id, request_id, note,
  status, handled_at, handled_by_membership_id)
VALUES (pg_temp.p279_id(861), pg_temp.p279_id(1), :'p279_medina_member', pg_temp.p279_id(862),
  'Хочу обсудить стипендию', 'handled', statement_timestamp(), pg_temp.p279_id(303));
INSERT INTO platform.student_assessment_attempts (id, organization_id, student_membership_id, instrument_key,
  version_id, status, revision, answers)
VALUES (pg_temp.p279_id(851), pg_temp.p279_id(1), :'p279_medina_member', 'english36', pg_temp.p279_id(852),
  'draft', 1, '{"grammar-01": "b"}'::JSONB);
INSERT INTO platform_private.student_assessment_requests (organization_id, student_membership_id, request_id,
  operation, input_hash, attempt_id, receipt)
VALUES (pg_temp.p279_id(1), :'p279_medina_member', pg_temp.p279_id(853), 'start', repeat('a', 64),
  pg_temp.p279_id(851), '{}'::JSONB);
INSERT INTO platform.learning_lesson_attempts (id, organization_id, student_membership_id, lesson_id, status,
  revision, answers)
VALUES (pg_temp.p279_id(854), pg_temp.p279_id(1), :'p279_medina_member', pg_temp.p279_id(855), 'draft', 1, '{}'::JSONB);
INSERT INTO platform_private.learning_requests (organization_id, student_membership_id, request_id, operation,
  input_hash, attempt_id, receipt)
VALUES (pg_temp.p279_id(1), :'p279_medina_member', pg_temp.p279_id(856), 'start', repeat('b', 64),
  pg_temp.p279_id(854), '{}'::JSONB);
INSERT INTO platform.notification_consents (id, organization_id, membership_id, channel, status, policy_ref,
  evidence_ref, granted_at)
VALUES (pg_temp.p279_id(857), pg_temp.p279_id(1), :'p279_medina_member', 'individual_whatsapp', 'granted', 'p279-policy',
  'p279-evidence', statement_timestamp());
INSERT INTO platform.notification_consent_events (id, organization_id, membership_id, notification_consent_id,
  previous_status, new_status, policy_ref, evidence_ref, actor_membership_id, request_id)
VALUES (pg_temp.p279_id(858), pg_temp.p279_id(1), :'p279_medina_member', pg_temp.p279_id(857), NULL, 'granted',
  'p279-policy', 'p279-evidence', :'p279_medina_member', pg_temp.p279_id(859));
INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_profile_id, actor_membership_id,
  actor_principal, action, resource_type, resource_id, after_state, reason, request_id)
VALUES
  (pg_temp.p279_id(864), pg_temp.p279_id(1), 'user', :'p279_medina_profile', :'p279_medina_member',
   'auth:' || :'p279_medina', 'portal.favorite.add', 'institution', pg_temp.p279_id(863), '{}'::JSONB,
   'P279 избранное', pg_temp.p279_id(865)),
  (pg_temp.p279_id(866), pg_temp.p279_id(1), 'user', pg_temp.p279_id(203), pg_temp.p279_id(303),
   'auth:' || :'p279_curator', 'portal.consultation.handle', 'portal_consultation_request', pg_temp.p279_id(861),
   '{"note": "Позвонили Медине"}'::JSONB, 'P279 консультация', pg_temp.p279_id(867));
SET LOCAL session_replication_role = origin;

-- Эрмек's legacy V1 contact row (public schema, user_id → auth.users).
SET LOCAL session_replication_role = replica;
INSERT INTO public.contacts (id, account_id, user_id, phone, name)
SELECT pg_temp.p279_id(868), a.id, :'p279_ermek', '+996700279110', 'Эрмек'
FROM public.accounts a WHERE a.owner_user_id = :'p279_ermek';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p279_assert((SELECT count(*) FROM public.contacts WHERE id = pg_temp.p279_id(868)) = 1,
  'the legacy V1 contact of Эрмек is missing');

-- ---------------------------------------------------------------------------
-- Not simple (intake owner configured: the анкета links a lead and client):
--  * Тимур: a pending анкета with its lead and client, and a WhatsApp
--    conversation on that lead.
--  * Зарина: an approved анкета (case, converted), a payment obligation and
--    event, a contract file with its Storage object.
-- ---------------------------------------------------------------------------
UPDATE platform_private.student_application_configuration SET intake_owner_membership_id = pg_temp.p279_id(301);
SELECT pg_temp.p279_submit(:'p279_timur', pg_temp.p279_id(731), 'Тимур', 'Лидов', '+996 700 279 108') AS p279_timur_app \gset
SELECT pg_temp.p279_submit(:'p279_zarina', pg_temp.p279_id(732), 'Зарина', 'Делова', '+996 700 279 109') AS p279_zarina_app \gset
SELECT (r #>> '{ok,student_case_id}') AS p279_zarina_case
FROM pg_temp.p279_call(:'p279_admin', format(
  'platform.decide_student_application_v1(%L::UUID, 1, ''approve'', ''P279 одобрение'', %L::UUID)',
  :'p279_zarina_app', pg_temp.p279_id(733))) r \gset
SELECT a.canonical_lead_id AS p279_timur_lead, l.client_id AS p279_timur_client
FROM platform_private.student_applications a JOIN platform.leads l ON l.id = a.canonical_lead_id
WHERE a.id = :'p279_timur_app' \gset
SELECT sc.student_membership_id AS p279_zarina_member FROM platform.student_cases sc WHERE sc.id = :'p279_zarina_case' \gset
SELECT pg_temp.p279_assert(:'p279_zarina_case' <> '' AND :'p279_zarina_member' <> '' AND :'p279_timur_client' <> '',
  'the анкета path did not create the case, the membership, the lead and the client');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('platform-documents', 'platform-documents', FALSE, 26214400, ARRAY['application/pdf', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.payment_obligations (id, organization_id, student_case_id, label, category, amount_minor,
  currency, total_paid_minor, total_refunded_minor, created_by_membership_id)
VALUES (pg_temp.p279_id(871), pg_temp.p279_id(1), :'p279_zarina_case', 'Услуги EVO, 1-й платёж',
  'evo_service_fee', 150000, 'USD', 150000, 0, pg_temp.p279_id(302));
INSERT INTO platform.payment_events (id, organization_id, student_case_id, payment_obligation_id, event_type,
  amount_minor, currency, occurred_at, source_key, actor_membership_id, request_id)
VALUES (pg_temp.p279_id(872), pg_temp.p279_id(1), :'p279_zarina_case', pg_temp.p279_id(871), 'payment',
  150000, 'USD', statement_timestamp(), 'case_agreement', pg_temp.p279_id(302), pg_temp.p279_id(873));
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES ('platform-documents', 'contracts/' || pg_temp.p279_id(820)::TEXT, '{}'::JSONB);
INSERT INTO platform.case_contract_files (id, organization_id, student_case_id, original_filename,
  declared_mime_type, byte_size, sha256_hex, storage_object_name, uploaded_by_membership_id)
VALUES (pg_temp.p279_id(820), pg_temp.p279_id(1), :'p279_zarina_case', 'Договор Зарина Делова.pdf',
  'application/pdf', 2000, repeat('c', 64), 'contracts/' || pg_temp.p279_id(820)::TEXT, pg_temp.p279_id(302));
INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
  provider_request_id, waha_session_name, payload_id, event_type, provider_occurred_at, verification_status,
  raw_payload, verification_headers, verification_evidence_ref, payload_sha256, request_id)
VALUES (pg_temp.p279_id(880), pg_temp.p279_id(1), 'waha', 'waha:p279', 'p279-event', 'p279-session', 'p279-payload',
  'message.any', statement_timestamp(), 'verified', '{}'::JSONB, '{}'::JSONB, 'synthetic:p279', repeat('a', 64),
  pg_temp.p279_id(881));
INSERT INTO platform.communication_conversations (id, organization_id, responsible_sales_membership_id, queue,
  subject, waha_session_name, current_scope_id, current_scope_version, created_from_webhook_event_id,
  sales_authority_source, canonical_client_id, canonical_lead_id)
VALUES (pg_temp.p279_id(882), pg_temp.p279_id(1), pg_temp.p279_id(302), 'sales', 'WhatsApp Тимур', 'p279-session',
  pg_temp.p279_id(2), 1, pg_temp.p279_id(880), 'platform_intake', :'p279_timur_client', :'p279_timur_lead');
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (d) Who may ask: each account for itself; staff and anon are refused.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p279_req (who TEXT PRIMARY KEY, auth_user_id UUID, request_id UUID, row_id UUID);
INSERT INTO p279_req (who, auth_user_id, request_id)
VALUES ('aigerim', :'p279_aigerim', pg_temp.p279_id(1001)), ('bakyt', :'p279_bakyt', pg_temp.p279_id(1002)),
  ('bare', :'p279_bare', pg_temp.p279_id(1003)), ('medina', :'p279_medina', pg_temp.p279_id(1004)),
  ('ermek', :'p279_ermek', pg_temp.p279_id(1005)), ('timur', :'p279_timur', pg_temp.p279_id(1006)),
  ('zarina', :'p279_zarina', pg_temp.p279_id(1007));

DO $p279_requests$
DECLARE x RECORD; r JSONB; again JSONB; other JSONB;
BEGIN
  FOR x IN SELECT * FROM p279_req ORDER BY who LOOP
    r := pg_temp.p279_call(x.auth_user_id::TEXT, format('platform.request_account_deletion_v2(%L::UUID)', x.request_id));
    PERFORM pg_temp.p279_assert(r ? 'ok' AND r #>> '{ok,requestId}' = x.request_id::TEXT
      AND r #>> '{ok,status}' = 'requested'
      AND (r #>> '{ok,dueAt}')::TIMESTAMPTZ = (r #>> '{ok,requestedAt}')::TIMESTAMPTZ + INTERVAL '30 days',
      x.who || ' could not request deletion: ' || r::TEXT);
    -- The same request id again, and another one while it is open: the same row.
    again := pg_temp.p279_call(x.auth_user_id::TEXT, format('platform.request_account_deletion_v2(%L::UUID)', x.request_id));
    other := pg_temp.p279_call(x.auth_user_id::TEXT, format('platform.request_account_deletion_v2(%L::UUID)', gen_random_uuid()));
    PERFORM pg_temp.p279_assert(again -> 'ok' = r -> 'ok' AND other -> 'ok' = r -> 'ok',
      x.who || ': a repeated request must return the same open request');
    PERFORM pg_temp.p279_assert(pg_temp.p279_call(x.auth_user_id::TEXT, 'platform.own_account_deletion_request_v1()') -> 'ok'
      = r -> 'ok', x.who || ' does not see the own request');
    UPDATE p279_req SET row_id = (SELECT d.id FROM platform_private.account_deletion_requests d
      WHERE d.subject_auth_user_id = x.auth_user_id) WHERE who = x.who;
  END LOOP;
  PERFORM pg_temp.p279_assert((SELECT count(*) FROM platform_private.account_deletion_requests d
      JOIN p279_req q ON q.auth_user_id = d.subject_auth_user_id) = 7
    AND (SELECT bool_and(d.confirmation_email = 'p279-' || q.who || '@example.invalid'
        AND d.subject_kind = CASE WHEN q.who IN ('medina', 'zarina') THEN 'student' ELSE 'applicant' END)
      FROM platform_private.account_deletion_requests d JOIN p279_req q ON q.auth_user_id = d.subject_auth_user_id),
    'one request per account, with its kind and confirmation address');
  -- Only for itself: the namesake (no request) sees none; Айгерим's request
  -- is not hers.
  PERFORM pg_temp.p279_assert(pg_temp.p279_call(pg_temp.p279_id(111)::TEXT,
    'platform.own_account_deletion_request_v1()') -> 'ok' = 'null'::JSONB, 'the namesake sees a request');
  -- Staff and anon are refused.
  FOR x IN SELECT unnest(ARRAY[pg_temp.p279_id(101)::TEXT, pg_temp.p279_id(102)::TEXT, pg_temp.p279_id(103)::TEXT,
      'anon']) AS who LOOP
    r := pg_temp.p279_call(x.who, format('platform.request_account_deletion_v2(%L::UUID)', gen_random_uuid()));
    PERFORM pg_temp.p279_assert(r ->> 'error' = '42501', x.who || ' may not request deletion: ' || r::TEXT);
    r := pg_temp.p279_call(x.who, 'platform.own_account_deletion_request_v1()');
    PERFORM pg_temp.p279_assert(r ->> 'error' = '42501', x.who || ' may not read an own deletion request');
  END LOOP;
  PERFORM pg_temp.p279_assert(NOT EXISTS (SELECT 1 FROM platform_private.account_deletion_requests d
    WHERE d.subject_auth_user_id IN (pg_temp.p279_id(101), pg_temp.p279_id(102), pg_temp.p279_id(103))),
    'staff requests were written');
  -- The journal names the account by its Auth id only: no profile foreign key.
  PERFORM pg_temp.p279_assert((SELECT count(*) FROM platform.audit_events e JOIN p279_req q ON q.row_id = e.resource_id
    WHERE e.action = 'account.deletion.request' AND e.actor_kind = 'system' AND e.actor_profile_id IS NULL
      AND e.actor_membership_id IS NULL AND e.actor_principal = 'auth:' || q.auth_user_id) = 7,
    'every request is journaled once, without a profile key');
END
$p279_requests$;

-- The released request_account_deletion_v1 (196) keeps working for a
-- student and its row gets the subject, the kind and the deadline.
SELECT pg_temp.p279_assert((SELECT r -> 'ok' ->> 'status' = 'requested'
    FROM pg_temp.p279_call(:'p279_zarina', format('platform.request_account_deletion_v1(%L::UUID)',
      pg_temp.p279_id(1007))) r), 'the released v1 request does not return Зарина''s open request');

SELECT q.row_id AS p279_aigerim_req FROM p279_req q WHERE q.who = 'aigerim' \gset
SELECT q.row_id AS p279_bakyt_req FROM p279_req q WHERE q.who = 'bakyt' \gset
SELECT q.row_id AS p279_bare_req FROM p279_req q WHERE q.who = 'bare' \gset
SELECT q.row_id AS p279_medina_req FROM p279_req q WHERE q.who = 'medina' \gset
SELECT q.row_id AS p279_ermek_req FROM p279_req q WHERE q.who = 'ermek' \gset
SELECT q.row_id AS p279_timur_req FROM p279_req q WHERE q.who = 'timur' \gset
SELECT q.row_id AS p279_zarina_req FROM p279_req q WHERE q.who = 'zarina' \gset

-- ---------------------------------------------------------------------------
-- (d) Who may read and act: only the system Admin.
-- ---------------------------------------------------------------------------
DO $p279_staff_gate$
DECLARE who TEXT; call TEXT; r JSONB;
BEGIN
  FOREACH who IN ARRAY ARRAY[pg_temp.p279_id(102)::TEXT, pg_temp.p279_id(103)::TEXT, pg_temp.p279_id(109)::TEXT,
      pg_temp.p279_id(104)::TEXT, 'anon', 'service_role'] LOOP
    FOREACH call IN ARRAY ARRAY[
      'platform.staff_account_deletion_queue_v1()',
      format('platform.staff_account_deletion_detail_v1(%L::UUID)', pg_temp.p279_id(1)),
      format('platform.process_account_deletion_v1(%L::UUID)', (SELECT row_id FROM p279_req WHERE p279_req.who = 'aigerim')),
      format('platform.complete_account_deletion_v1(%L::UUID)', (SELECT row_id FROM p279_req WHERE p279_req.who = 'aigerim')),
      format('platform.mark_account_deletion_done_v1(%L::UUID, %L)', (SELECT row_id FROM p279_req WHERE p279_req.who = 'zarina'),
        'Всё удалено вручную по списку'),
      format('platform.record_account_deletion_email_v1(%L::UUID, ''sent'')', (SELECT row_id FROM p279_req WHERE p279_req.who = 'aigerim'))]
    LOOP
      r := pg_temp.p279_call(who, call);
      PERFORM pg_temp.p279_assert(r ->> 'error' = '42501', who || ' may not call ' || call || ': ' || r::TEXT);
    END LOOP;
  END LOOP;
  PERFORM pg_temp.p279_assert(NOT EXISTS (SELECT 1 FROM platform_private.account_deletion_requests d
    WHERE d.status <> 'requested' AND d.subject_auth_user_id IN (SELECT auth_user_id FROM p279_req)),
    'a refused caller changed a request');
END
$p279_staff_gate$;

-- ---------------------------------------------------------------------------
-- Queue and detail (the Admin): mode and reasons per account.
-- ---------------------------------------------------------------------------
DO $p279_plan$
DECLARE queue JSONB; d JSONB; x RECORD;
BEGIN
  queue := pg_temp.p279_call(pg_temp.p279_id(101)::TEXT, 'platform.staff_account_deletion_queue_v1()') -> 'ok';
  PERFORM pg_temp.p279_assert(jsonb_typeof(queue) = 'array', 'the Admin cannot read the queue');
  FOR x IN SELECT q.who, q.row_id, e.mode, e.reasons FROM p279_req q JOIN (VALUES
      ('aigerim', 'automatic', '[]'::JSONB), ('bakyt', 'automatic', '[]'), ('bare', 'automatic', '[]'),
      ('medina', 'automatic', '[]'), ('ermek', 'manual', '["other_records"]'),
      ('timur', 'manual', '["lead", "client", "whatsapp"]'),
      ('zarina', 'manual', '["case", "application_converted", "lead", "client", "payment", "contract_file"]')
    ) AS e(who, mode, reasons) ON e.who = q.who
  LOOP
    PERFORM pg_temp.p279_assert((SELECT count(*) FROM jsonb_array_elements(queue) z
      WHERE z ->> 'id' = x.row_id::TEXT AND z ->> 'mode' = x.mode AND z ->> 'status' = 'requested') = 1,
      x.who || ' is not in the queue as ' || x.mode);
    d := pg_temp.p279_call(pg_temp.p279_id(101)::TEXT, format('platform.staff_account_deletion_detail_v1(%L::UUID)', x.row_id)) -> 'ok';
    PERFORM pg_temp.p279_assert(d ->> 'mode' = x.mode AND d -> 'reasons' = x.reasons AND d ->> 'login' = 'active',
      x.who || ': wrong plan ' || d::TEXT);
  END LOOP;
  d := pg_temp.p279_call(pg_temp.p279_id(101)::TEXT, format('platform.staff_account_deletion_detail_v1(%L::UUID)',
    (SELECT row_id FROM p279_req WHERE who = 'ermek'))) -> 'ok';
  PERFORM pg_temp.p279_assert(d -> 'otherTables' = '["public.contacts"]'::JSONB, 'Эрмек: the other table is not named');
  d := pg_temp.p279_call(pg_temp.p279_id(101)::TEXT, format('platform.staff_account_deletion_detail_v1(%L::UUID)',
    (SELECT row_id FROM p279_req WHERE who = 'medina'))) -> 'ok';
  PERFORM pg_temp.p279_assert((d -> 'counts' ->> 'favourites')::INT = 1 AND (d -> 'counts' ->> 'consultations')::INT = 1
      AND (d -> 'counts' ->> 'tests')::INT = 4 AND (d -> 'counts' ->> 'profile')::INT > 0
      AND (d -> 'counts' ->> 'journal')::INT > 0 AND (d -> 'counts' ->> 'application')::INT = 0,
    'Медина: wrong counts ' || (d -> 'counts')::TEXT);
  -- No personal value of another person in the detail of a request.
  PERFORM pg_temp.p279_assert(d::TEXT !~ 'Удалова|Делова|Лидов', 'the detail shows another person''s data');
END
$p279_plan$;

-- ---------------------------------------------------------------------------
-- (c) Every non-simple kind is refused and nothing changes.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p279_snapshot('refusals', NULL) > 0 AS p279_ok \gset
DO $p279_refusals$
DECLARE x RECORD; r JSONB;
BEGIN
  FOR x IN SELECT q.who, q.row_id, e.codes FROM p279_req q JOIN (VALUES
      ('ermek', ARRAY['other_records']),
      ('timur', ARRAY['lead', 'client', 'whatsapp']),
      ('zarina', ARRAY['case', 'application_converted', 'lead', 'client', 'payment', 'contract_file'])
    ) AS e(who, codes) ON e.who = q.who
  LOOP
    r := pg_temp.p279_call(pg_temp.p279_id(101)::TEXT, format('platform.process_account_deletion_v1(%L::UUID)', x.row_id));
    PERFORM pg_temp.p279_assert(r ->> 'error' = '55000' AND r ->> 'message' = 'account_deletion_not_simple'
      AND string_to_array(r ->> 'detail', ',') = x.codes, x.who || ' was not refused as not simple: ' || r::TEXT);
    -- The automatic completion refuses an unprocessed request too.
    r := pg_temp.p279_call(pg_temp.p279_id(101)::TEXT, format('platform.complete_account_deletion_v1(%L::UUID)', x.row_id));
    PERFORM pg_temp.p279_assert(r ->> 'message' = 'account_deletion_not_processed', x.who || ': completion without processing');
  END LOOP;
END
$p279_refusals$;
SELECT pg_temp.p279_assert(pg_temp.p279_changed('refusals') = '',
  'a refused processing changed rows: ' || pg_temp.p279_changed('refusals'));
SELECT pg_temp.p279_assert((SELECT bool_and(d.status = 'requested') FROM platform_private.account_deletion_requests d
  JOIN p279_req q ON q.row_id = d.id), 'a refused processing changed a request');

-- ---------------------------------------------------------------------------
-- (d) Manual: «Отметить выполненным». A simple account is refused (use the
-- automatic path); a note is required; the login must no longer work.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p279_assert((SELECT r ->> 'message' = 'account_deletion_automatic_available'
    FROM pg_temp.p279_call(:'p279_admin', format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
      :'p279_aigerim_req', 'Всё удалено вручную по списку')) r), 'a simple account was marked done manually');
SELECT pg_temp.p279_assert((SELECT r ->> 'message' = 'account_deletion_invalid'
    FROM pg_temp.p279_call(:'p279_admin', format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
      :'p279_zarina_req', 'готово')) r), 'a manual completion without a real note');
SELECT pg_temp.p279_assert((SELECT r ->> 'message' = 'account_deletion_login_active'
    FROM pg_temp.p279_call(:'p279_admin', format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
      :'p279_zarina_req', 'Дело, лид, клиент, файлы и чат удалены; договор и оплаты обезличены')) r),
  'a manual completion while the login still works');

-- The technical administrator soft-deletes the login (auth.admin.deleteUser(id,
-- true) sets deleted_at; the row stays because Зарина's records reference it).
UPDATE auth.users SET deleted_at = statement_timestamp() WHERE id = :'p279_zarina';
SELECT pg_temp.p279_snapshot('manual', :'p279_zarina') > 0 AS p279_ok \gset
SELECT pg_temp.p279_request_fixed(:'p279_zarina_req')::TEXT AS p279_zarina_fixed \gset
SELECT (r -> 'ok') AS p279_manual
FROM pg_temp.p279_call(:'p279_admin', format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
  :'p279_zarina_req', '  Дело, лид, клиент, файлы и чат удалены; договор и оплаты обезличены  ')) r \gset
SELECT pg_temp.p279_assert((:'p279_manual'::JSONB) ->> 'status' = 'completed'
    AND (:'p279_manual'::JSONB) ->> 'mode' = 'manual'
    AND (:'p279_manual'::JSONB) ->> 'email' = 'p279-zarina@example.invalid',
  'the manual completion failed: ' || :'p279_manual');
-- Nothing but the request changed: not a row of Зарина's records either
-- (the snapshot holds every row of the database but her request).
SELECT pg_temp.p279_assert(pg_temp.p279_changed('manual') = '',
  'the manual completion changed rows: ' || pg_temp.p279_changed('manual'));
SELECT pg_temp.p279_assert(pg_temp.p279_request_fixed(:'p279_zarina_req')::TEXT = :'p279_zarina_fixed'
    AND (SELECT d.manual_note = 'Дело, лид, клиент, файлы и чат удалены; договор и оплаты обезличены'
      AND d.completion_mode = 'manual' AND d.completed_by_membership_id = pg_temp.p279_id(301)
      AND d.processing_started_at IS NULL
      FROM platform_private.account_deletion_requests d WHERE d.id = :'p279_zarina_req')
    AND (SELECT count(*) FROM platform.audit_events e WHERE e.resource_id = :'p279_zarina_req'
      AND e.action = 'account.deletion.manual.complete' AND e.actor_membership_id = pg_temp.p279_id(301)
      AND e.reason = 'Дело, лид, клиент, файлы и чат удалены; договор и оплаты обезличены'
      AND e.after_state -> 'reasons' = '["case", "application_converted", "lead", "client", "payment", "contract_file"]'::JSONB) = 1,
  'the manual completion is not recorded and journaled as expected');
-- Idempotent: again, the automatic processing and the email (one call per
-- statement: the order of side effects inside one expression is not fixed).
SELECT (r -> 'ok' ->> 'status') AS p279_again
FROM pg_temp.p279_call(:'p279_admin', format('platform.mark_account_deletion_done_v1(%L::UUID, %L)',
  :'p279_zarina_req', 'Другая заметка при повторе')) r \gset
SELECT (r -> 'ok' ->> 'status') AS p279_again_process
FROM pg_temp.p279_call(:'p279_admin', format('platform.process_account_deletion_v1(%L::UUID)', :'p279_zarina_req')) r \gset
SELECT pg_temp.p279_assert(:'p279_again' = 'completed' AND :'p279_again_process' = 'completed'
  AND (SELECT d.manual_note FROM platform_private.account_deletion_requests d WHERE d.id = :'p279_zarina_req')
    = 'Дело, лид, клиент, файлы и чат удалены; договор и оплаты обезличены',
  'a repeated manual completion changed the request');
SELECT (r -> 'ok')::TEXT AS p279_email_1
FROM pg_temp.p279_call(:'p279_admin', format('platform.record_account_deletion_email_v1(%L::UUID, ''sent'')',
  :'p279_zarina_req')) r \gset
SELECT (r -> 'ok')::TEXT AS p279_email_2
FROM pg_temp.p279_call(:'p279_admin', format('platform.record_account_deletion_email_v1(%L::UUID, ''failed'')',
  :'p279_zarina_req')) r \gset
SELECT pg_temp.p279_assert((:'p279_email_1'::JSONB) ->> 'emailStatus' = 'sent'
    AND (:'p279_email_1'::JSONB) -> 'email' = 'null'::JSONB
    AND (:'p279_email_2'::JSONB) ->> 'emailStatus' = 'sent'
    AND (SELECT d.confirmation_email IS NULL AND d.confirmation_email_status = 'sent'
      FROM platform_private.account_deletion_requests d WHERE d.id = :'p279_zarina_req'),
  'the email status is not recorded once with the address dropped');
SELECT pg_temp.p279_assert((SELECT r -> 'ok' ->> 'status' = 'completed' AND r -> 'ok' ->> 'displayName' ~ '^Удалённый пользователь · '
    AND r -> 'ok' -> 'email' = 'null'::JSONB AND r -> 'ok' ->> 'manualNote' IS NOT NULL
    FROM pg_temp.p279_call(:'p279_admin', format('platform.staff_account_deletion_detail_v1(%L::UUID)', :'p279_zarina_req')) r),
  'a completed manual request shows the label and the note');

-- ---------------------------------------------------------------------------
-- (a) and (b): the automatic processing of each simple account.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.p279_automatic(p_who TEXT, p_expect_tables TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE q RECORD; org UUID := pg_temp.p279_id(1); admin TEXT := pg_temp.p279_id(101)::TEXT;
  r JSONB; fixed JSONB; changed TEXT; again JSONB;
BEGIN
  SELECT * INTO q FROM p279_req WHERE who = p_who;
  PERFORM pg_temp.p279_closure(p_who, q.auth_user_id, org);
  PERFORM pg_temp.p279_assert(pg_temp.p279_tables(p_who) = p_expect_tables,
    p_who || ': the own set is ' || pg_temp.p279_tables(p_who));
  PERFORM pg_temp.p279_snapshot(p_who, q.auth_user_id);
  fixed := pg_temp.p279_request_fixed(q.row_id);

  r := pg_temp.p279_call(admin, format('platform.process_account_deletion_v1(%L::UUID)', q.row_id));
  PERFORM pg_temp.p279_assert(r #>> '{ok,status}' = 'processing' AND r #>> '{ok,authUserId}' = q.auth_user_id::TEXT
    AND r #>> '{ok,email}' = 'p279-' || p_who || '@example.invalid',
    p_who || ': processing failed ' || r::TEXT);
  -- (a) nothing outside the own set changed.
  changed := pg_temp.p279_changed(p_who);
  PERFORM pg_temp.p279_assert(changed = '', p_who || ': rows outside the own set changed: ' || changed);
  PERFORM pg_temp.p279_assert(pg_temp.p279_request_fixed(q.row_id) = fixed, p_who || ': the request changed beyond its status');
  -- Every own row is gone except the Auth user, which the server deletes.
  PERFORM pg_temp.p279_assert(pg_temp.p279_left(p_who) = 'auth.users=1', p_who || ': left ' || pg_temp.p279_left(p_who));
  -- The bypass does not outlive the erasure.
  PERFORM pg_temp.p279_assert(current_setting('platform.account_erasure_request_id', TRUE) IS NOT DISTINCT FROM ''
      AND (SELECT d.erasure_transaction_id IS NULL FROM platform_private.account_deletion_requests d WHERE d.id = q.row_id),
    p_who || ': the erasure marker outlived processing');
  -- Completion waits for the Auth user.
  r := pg_temp.p279_call(admin, format('platform.complete_account_deletion_v1(%L::UUID)', q.row_id));
  PERFORM pg_temp.p279_assert(r ->> 'message' = 'account_deletion_auth_user_exists', p_who || ': completed with the Auth user');
  -- A repeat is safe and changes nothing more.
  again := pg_temp.p279_call(admin, format('platform.process_account_deletion_v1(%L::UUID)', q.row_id));
  PERFORM pg_temp.p279_assert(again #>> '{ok,status}' = 'processing', p_who || ': repeated processing failed ' || again::TEXT);
  PERFORM pg_temp.p279_assert(pg_temp.p279_changed(p_who) = '', p_who || ': the repeat changed rows');

  -- auth.admin.deleteUser (the server, service role): nothing may still
  -- reference the user, or this DELETE fails.
  DELETE FROM auth.users WHERE id = q.auth_user_id;
  r := pg_temp.p279_call(admin, format('platform.complete_account_deletion_v1(%L::UUID)', q.row_id));
  PERFORM pg_temp.p279_assert(r #>> '{ok,status}' = 'completed' AND r #>> '{ok,mode}' = 'automatic'
    AND r #>> '{ok,email}' = 'p279-' || p_who || '@example.invalid', p_who || ': completion failed ' || r::TEXT);
  PERFORM pg_temp.p279_assert((pg_temp.p279_call(admin, format('platform.complete_account_deletion_v1(%L::UUID)', q.row_id))
    #>> '{ok,status}') = 'completed', p_who || ': a repeated completion failed');
  r := pg_temp.p279_call(admin, format('platform.record_account_deletion_email_v1(%L::UUID, ''not_configured'')', q.row_id));
  PERFORM pg_temp.p279_assert(r #>> '{ok,emailStatus}' = 'not_configured', p_who || ': email status not recorded');
  -- (b) the whole own set is gone; (a) still nothing else changed.
  PERFORM pg_temp.p279_assert(pg_temp.p279_left(p_who) = '', p_who || ': left after completion ' || pg_temp.p279_left(p_who));
  changed := pg_temp.p279_changed(p_who);
  PERFORM pg_temp.p279_assert(changed = '', p_who || ': rows outside the own set changed: ' || changed);
  PERFORM pg_temp.p279_assert((SELECT d.status = 'completed' AND d.completion_mode = 'automatic'
      AND d.confirmation_email IS NULL AND d.membership_id IS NULL AND d.summary ? 'counts'
      FROM platform_private.account_deletion_requests d WHERE d.id = q.row_id)
    AND (SELECT count(*) FROM platform.audit_events e WHERE e.resource_id = q.row_id
      AND e.action IN ('account.deletion.request', 'account.deletion.process', 'account.deletion.complete',
        'account.deletion.email')) = 5,
    p_who || ': the request evidence is not kept');
END
$$;

SELECT pg_temp.p279_automatic('aigerim',
  'auth.audit_log_entries,auth.flow_state,auth.users,platform_private.student_application_receipts,'
  || 'platform_private.student_applications,public.accounts,public.profiles');
SELECT pg_temp.p279_automatic('bakyt',
  'auth.users,platform.audit_events,platform_private.student_application_receipts,'
  || 'platform_private.student_applications,public.accounts,public.profiles');
SELECT pg_temp.p279_automatic('bare', 'auth.users,public.accounts,public.profiles');
SELECT pg_temp.p279_automatic('medina',
  'auth.users,platform.audit_events,platform.learning_lesson_attempts,platform.membership_role_history,'
  || 'platform.membership_scope_assignments,platform.notification_consent_events,platform.notification_consents,'
  || 'platform.organization_memberships,platform.profiles,platform.student_assessment_attempts,'
  || 'platform_private.learning_requests,platform_private.portal_consultation_requests,'
  || 'platform_private.student_assessment_requests,platform_private.university_favorites,'
  || 'public.accounts,public.profiles');

-- The staff decision on Бакыт's анкета (receipt) and the curator's journal
-- entry on Медина's consultation request went with them; the namesake, her
-- Auth journal entry and flow, and the staff entry quoting Айгерим stayed
-- (they were in every snapshot, checked above); the Storage objects too.
SELECT pg_temp.p279_assert(
  NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE id = pg_temp.p279_id(866))
    AND EXISTS (SELECT 1 FROM platform.audit_events WHERE id = pg_temp.p279_id(955))
    AND EXISTS (SELECT 1 FROM platform_private.student_applications WHERE id = :'p279_namesake_app')
    AND EXISTS (SELECT 1 FROM auth.audit_log_entries WHERE id = pg_temp.p279_id(952))
    AND EXISTS (SELECT 1 FROM auth.flow_state WHERE id = pg_temp.p279_id(954))
    AND EXISTS (SELECT 1 FROM storage.objects WHERE name = 'contracts/' || pg_temp.p279_id(820)::TEXT),
  'the wrong rows went or stayed');
-- No own table can hold a Storage key: a document, contract, chat or export
-- row is never own (it makes the account manual), so a simple account owns
-- no Storage object.
SELECT pg_temp.p279_assert(NOT EXISTS (SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema || '.' || c.table_name = ANY (ARRAY['platform.profiles', 'platform.organization_memberships',
      'platform.membership_role_history', 'platform.membership_permission_events',
      'platform.membership_scope_assignments', 'platform_private.student_applications',
      'platform_private.student_application_receipts', 'public.accounts', 'public.profiles',
      'platform.notification_consents', 'platform.notification_consent_events',
      'platform_private.portal_consultation_requests', 'platform_private.university_favorites',
      'platform.student_assessment_attempts', 'platform_private.student_assessment_requests',
      'platform.learning_lesson_attempts', 'platform_private.learning_requests', 'platform.audit_events'])
      AND (c.column_name ~ '(bucket|object_name|storage)')),
  'an own table holds a Storage key');

-- The bypass works only inside the erasure: the marker alone opens nothing.
DO $p279_bypass$
DECLARE refused BOOLEAN := FALSE;
BEGIN
  PERFORM set_config('platform.account_erasure_request_id', (SELECT row_id FROM p279_req WHERE who = 'timur')::TEXT, TRUE);
  BEGIN
    DELETE FROM platform.audit_events WHERE id = pg_temp.p279_id(955);
  EXCEPTION WHEN OTHERS THEN refused := SQLSTATE = '55000';
  END;
  PERFORM set_config('platform.account_erasure_request_id', '', TRUE);
  PERFORM pg_temp.p279_assert(refused, 'the erasure marker alone let an append-only DELETE through');
  refused := FALSE;
  BEGIN
    UPDATE platform.audit_events SET reason = 'x' WHERE id = pg_temp.p279_id(955);
  EXCEPTION WHEN OTHERS THEN refused := SQLSTATE = '55000';
  END;
  PERFORM pg_temp.p279_assert(refused, 'the append-only guard is gone');
END
$p279_bypass$;

-- The queue after all of it: completed rows carry the neutral label and no
-- address; the manual ones are still manual.
DO $p279_queue_after$
DECLARE queue JSONB := pg_temp.p279_call(pg_temp.p279_id(101)::TEXT, 'platform.staff_account_deletion_queue_v1()') -> 'ok';
BEGIN
  PERFORM pg_temp.p279_assert((SELECT count(*) FROM jsonb_array_elements(queue) z JOIN p279_req q ON q.row_id::TEXT = z ->> 'id'
      WHERE z ->> 'status' = 'completed' AND z ->> 'displayName' ~ '^Удалённый пользователь · [0-9a-f]{8}$'
        AND z -> 'email' = 'null'::JSONB) = 5
    AND (SELECT count(*) FROM jsonb_array_elements(queue) z JOIN p279_req q ON q.row_id::TEXT = z ->> 'id'
      WHERE z ->> 'status' = 'requested' AND z ->> 'mode' = 'manual') = 2,
    'the queue after processing is wrong: ' || queue::TEXT);
END
$p279_queue_after$;

-- ---------------------------------------------------------------------------
-- (e) Timing on a synthetic volume: a fresh simple applicant (Айгерим 2) and
-- a fresh simple student membership (Медина 2), as the Admin with the
-- production statement_timeout of 8 s.
-- ---------------------------------------------------------------------------
UPDATE platform_private.student_application_configuration SET intake_owner_membership_id = NULL;
SELECT pg_temp.p279_submit(pg_temp.p279_id(112), pg_temp.p279_id(741), 'Айгерим', 'Вторая', '+996 700 279 112') IS NOT NULL AS p279_ok \gset
SELECT platform_private.provision_member_authorized_e1(pg_temp.p279_id(1), pg_temp.p279_id(113), 'Медина Вторая',
  'student', 'P279 volume', pg_temp.p279_id(742), pg_temp.p279_id(201), pg_temp.p279_id(101)) IS NOT NULL AS p279_ok \gset
INSERT INTO p279_req (who, auth_user_id, request_id)
VALUES ('aigerim2', pg_temp.p279_id(112), pg_temp.p279_id(1012)), ('medina2', pg_temp.p279_id(113), pg_temp.p279_id(1013));
SELECT pg_temp.p279_assert(bool_and(pg_temp.p279_call(auth_user_id::TEXT,
  format('platform.request_account_deletion_v2(%L::UUID)', request_id)) ? 'ok'), 'volume requests failed')
FROM p279_req WHERE who IN ('aigerim2', 'medina2');
UPDATE p279_req q SET row_id = d.id FROM platform_private.account_deletion_requests d
WHERE d.subject_auth_user_id = q.auth_user_id AND q.who IN ('aigerim2', 'medina2');

-- Volume: 200 000 journal entries of other people over five months and
-- 3 000 consultation requests of other memberships.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_membership_id,
  actor_principal, action, resource_type, resource_id, after_state, reason, request_id, created_at)
SELECT pg_temp.p279_id(1), 'user', pg_temp.p279_id(202), pg_temp.p279_id(302), 'auth:volume', 'lead.note.add', 'lead',
  gen_random_uuid(), jsonb_build_object('n', g), 'P279 volume', gen_random_uuid(),
  statement_timestamp() - (g || ' minutes')::INTERVAL
FROM generate_series(1, 200000) g;
INSERT INTO platform_private.portal_consultation_requests (organization_id, membership_id, request_id, note,
  status, handled_at, handled_by_membership_id)
SELECT pg_temp.p279_id(1), pg_temp.p279_id(302), gen_random_uuid(), 'P279 volume', 'handled', statement_timestamp(),
  pg_temp.p279_id(303)
FROM generate_series(1, 3000);
SET LOCAL session_replication_role = origin;
ANALYZE platform.audit_events;
ANALYZE platform_private.portal_consultation_requests;

-- The whole block (two details, two processings, two queues) must finish
-- within one production statement_timeout; each call within 2 s.
SET LOCAL statement_timeout = '8s';
DO $p279_timing$
DECLARE x RECORD; t0 TIMESTAMPTZ; r JSONB; spent INTERVAL; report TEXT := '';
BEGIN
  FOR x IN SELECT * FROM p279_req WHERE who IN ('aigerim2', 'medina2') ORDER BY who LOOP
    t0 := clock_timestamp();
    r := pg_temp.p279_call(pg_temp.p279_id(101)::TEXT, format('platform.staff_account_deletion_detail_v1(%L::UUID)', x.row_id));
    spent := clock_timestamp() - t0;
    report := report || x.who || ' detail ' || round(extract(epoch FROM spent)::NUMERIC, 3) || ' s; ';
    PERFORM pg_temp.p279_assert(r #>> '{ok,mode}' = 'automatic' AND spent < INTERVAL '2 seconds',
      x.who || ': detail too slow or wrong ' || spent::TEXT || ' ' || r::TEXT);
    t0 := clock_timestamp();
    r := pg_temp.p279_call(pg_temp.p279_id(101)::TEXT, format('platform.process_account_deletion_v1(%L::UUID)', x.row_id));
    spent := clock_timestamp() - t0;
    report := report || x.who || ' process ' || round(extract(epoch FROM spent)::NUMERIC, 3) || ' s; ';
    PERFORM pg_temp.p279_assert(r #>> '{ok,status}' = 'processing' AND spent < INTERVAL '2 seconds',
      x.who || ': processing too slow or wrong ' || spent::TEXT || ' ' || r::TEXT);
    t0 := clock_timestamp();
    r := pg_temp.p279_call(pg_temp.p279_id(101)::TEXT, 'platform.staff_account_deletion_queue_v1()');
    spent := clock_timestamp() - t0;
    PERFORM pg_temp.p279_assert(r ? 'ok' AND spent < INTERVAL '2 seconds', 'the queue is too slow ' || spent::TEXT);
  END LOOP;
  RAISE NOTICE 'P279 timing on the synthetic volume: %', report;
END
$p279_timing$;
RESET statement_timeout;

ROLLBACK;

\echo P279_ACCOUNT_DELETION_SUITE_PASSED
