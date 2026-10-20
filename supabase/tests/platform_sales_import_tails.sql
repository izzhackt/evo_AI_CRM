\set ON_ERROR_STOP on
-- Boundary suite for migration 313 (хвосты переноса отчёта продаж и склейки клиентов 17-18.10.2026;
-- docs/PLAN_CHANGES.md «2026-10-21 · Хвосты переноса отчёта продаж…»). Runs on the real chain right
-- after 313 inside one transaction that is rolled back, with its own synthetic organizations and members.
-- Members are modelled like production after 155 and 244: only the system Admin carries the coarse role
-- plus is_system_admin and an organization scope; the service calls are made as the service path makes
-- them (service_role, no user JWT, the Admin as the actor); the staff reads use the real
-- custom_access_token_hook claims. No WAHA, no provider, no real person, no production action: every
-- WhatsApp message goes through the REAL projection chain the webhook uses (enqueue, exact claim,
-- project, finish) on synthetic events. Proves:
--  0. catalog and posture of everything the migration adds or replaces;
--  A. the erasure of the sales-report import receipts (platform.sales_report_erase_person_v1):
--     the service boundary and the actor, strict parameters, dry run (counts and report-row ids,
--     nothing written), the effect by client (with a client merged into it), by lead and by report row,
--     the empty receipt left on every key (a repeated import is refused, nobody is recreated), the
--     bystander's receipts and the other organization untouched, replay and conflict, the erasure
--     receipt without a name or phone, the lock (UPDATE / DELETE / TRUNCATE still refused, a forged or
--     finished marker refused), the report rows themselves untouched;
--  B. the WhatsApp intake for a person who is already an admissions student: the first chat joins the
--     client and the lead of the direct case (no new client, no new lead, provenance left), the next
--     message and a second chat of the same number follow, the conversation is visible to the Admin;
--     an unknown number, a closed case, a case that came through sales, a number shared by two people
--     and a chat without a number take the old path unchanged;
--  C. the journal: client.duplicate.merge and the object type client are allowlisted, the old lists
--     intact, a real merge is read through search_audit_events() as Staff with the ten safe keys;
--  D. the call feed: the calls without a lead of a merged client (one merge and a chain of two) show in
--     the survivor lead's feed, in its recordings list, and can have their result set; a stranger's
--     call, another client's call and another organization stay out.
-- Isolated synthetic SQL fixtures only.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $t313_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t313_auth_role$;

CREATE FUNCTION pg_temp.t313_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('31300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t313_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T313: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement ('42501:message'), or 'ok'.
CREATE FUNCTION pg_temp.t313_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The statement as another identity: claims and role are local to the transaction, the role is always
-- reset. t313_as answers 'ok' or 'SQLSTATE:message'; t313_json answers the one value (a SELECT yielding
-- JSONB) and lets an error through.
CREATE FUNCTION pg_temp.t313_as(p_claims TEXT, p_role TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT; saved TEXT := current_setting('request.jwt.claims', TRUE);
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql; answer := 'ok';
  EXCEPTION WHEN OTHERS THEN answer := SQLSTATE || ':' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN answer;
END
$$;
CREATE FUNCTION pg_temp.t313_json(p_claims TEXT, p_role TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE answer JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE);
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO answer;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN answer;
END
$$;
-- A staff read as an authenticated session that gets either the answer or {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.t313_call(p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE answer JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE);
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE p_sql INTO answer;
  EXCEPTION WHEN OTHERS THEN
    answer := jsonb_build_object('error', SQLSTATE || ':' || SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN COALESCE(answer, 'null'::JSONB);
END
$$;
CREATE FUNCTION pg_temp.t313_svc(p_sql TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.t313_as('{"role":"service_role"}', 'service_role', p_sql)
$$;
CREATE FUNCTION pg_temp.t313_svc_json(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t313_json('{"role":"service_role"}', 'service_role', p_sql)
$$;
-- The grantees of EXECUTE other than the owner ('PUBLIC' for the pseudo-role).
CREATE FUNCTION pg_temp.t313_grantees(p_fn REGPROCEDURE) RETURNS TEXT[] LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::REGROLE::TEXT END
      ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::REGROLE::TEXT END), ARRAY[]::TEXT[])
  FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE p.oid = p_fn AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t313_id(INTEGER), pg_temp.t313_assert(BOOLEAN, TEXT), pg_temp.t313_error(TEXT)
  TO authenticated, anon, service_role;

SELECT 'T313_SALES_IMPORT_TAILS_SUITE_START' AS t313_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1: 1 system Admin, 2 Sales member (the WhatsApp intake owner), 3 invited staff,
-- 4 a second system Admin, 5 a Student. Organization 2: Admin 10.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t313_actors(n INTEGER, coarse platform.business_role);
INSERT INTO t313_actors(n, coarse) VALUES (1, 'admin'), (2, 'sales'), (3, NULL), (4, 'admin'), (5, 'student');
GRANT SELECT ON t313_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.t313_id(1), 'T313 Fictional organization'),
  (pg_temp.t313_id(2), 'T313 Second organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t313_id(100 + n), 't313-' || n || '@example.invalid', '{}'::JSONB FROM t313_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.t313_id(110), 't313-org2-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t313_id(200 + n), pg_temp.t313_id(100 + n), 'T313 Actor ' || n, 'active', 1 FROM t313_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.t313_id(210), pg_temp.t313_id(110), 'T313 Org2 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t313_id(300 + n), pg_temp.t313_id(1), pg_temp.t313_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t313_actors a;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.t313_id(310), pg_temp.t313_id(2), pg_temp.t313_id(210), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.t313_id(301), pg_temp.t313_id(304), pg_temp.t313_id(310));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t313_id(401), pg_temp.t313_id(1), 'organization', pg_temp.t313_id(1), 1),
  (pg_temp.t313_id(402), pg_temp.t313_id(2), 'organization', pg_temp.t313_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t313_id(1), pg_temp.t313_id(301), pg_temp.t313_id(401), 1, 1, TRUE, 'system', 'T313 synthetic scope', pg_temp.t313_id(601)),
  (pg_temp.t313_id(1), pg_temp.t313_id(304), pg_temp.t313_id(401), 1, 1, TRUE, 'system', 'T313 synthetic scope', pg_temp.t313_id(603)),
  (pg_temp.t313_id(2), pg_temp.t313_id(310), pg_temp.t313_id(402), 1, 1, TRUE, 'system', 'T313 synthetic scope', pg_temp.t313_id(602));
SELECT pg_temp.t313_assert(
  (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.t313_id(1), pg_temp.t313_id(301))) = 'admin'
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.t313_id(1), pg_temp.t313_id(304))) = 'admin'
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.t313_id(2), pg_temp.t313_id(310))) = 'admin'
  AND (SELECT system_role FROM platform_private.staff_membership_identity(pg_temp.t313_id(1), pg_temp.t313_id(302))) IS DISTINCT FROM 'admin',
  'fixture: the system Admins are system Admins, the Sales member is not');
-- Real session claims of the two Admins.
CREATE TEMP TABLE t313_claims(n INTEGER PRIMARY KEY, claims TEXT NOT NULL);
INSERT INTO t313_claims
  SELECT n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t313_id(100 + n),
    'claims', jsonb_build_object('sub', pg_temp.t313_id(100 + n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM generate_series(1, 5) n;
GRANT SELECT ON t313_claims TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- B. The WhatsApp intake for a person who is already an admissions student.
-- ---------------------------------------------------------------------------
-- One verified WAHA event row (what persist_provider_webhook_event stores) and its trip through the real
-- chain; p_n makes every id unique.
CREATE FUNCTION pg_temp.t313_event(p_n INTEGER, p_payload JSONB) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE event_id CONSTANT UUID := pg_temp.t313_id(1000 + p_n);
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, pg_temp.t313_id(1), 'waha', 'waha:crm_primary', NULL, NULL, 't313-' || p_n, 'crm_primary',
    p_payload ->> 'id', 'message.any', TIMESTAMPTZ '2026-10-21 07:00:00+00' + p_n * INTERVAL '1 second',
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:t313:' || p_n, lpad(to_hex(p_n), 64, '0'), pg_temp.t313_id(1500 + p_n));
  RETURN event_id;
END
$$;
CREATE FUNCTION pg_temp.t313_work(p_n INTEGER, p_event_id UUID, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.t313_id(1);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, p_event_id,
    encode(sha256(convert_to('t313-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.t313_id(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 't313', pg_temp.t313_id(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.t313_id(301), pg_temp.t313_id(2000 + p_n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.t313_id(2000 + p_n * 10 + 4));
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state', 'work_item_id', work);
END
$$;
-- One customer message from a chat id through the real chain.
CREATE FUNCTION pg_temp.t313_in(p_n INTEGER, p_from TEXT, p_extra JSONB DEFAULT '{}') RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE payload JSONB := jsonb_build_object('id', 'false_' || p_from || '_T' || p_n, 'timestamp', 1788343200,
  'from', p_from, 'fromMe', false, 'source', 'app', 'body', 'T313 message ' || p_n) || p_extra;
BEGIN
  RETURN pg_temp.t313_work(p_n, pg_temp.t313_event(p_n, payload), payload);
END
$$;
CREATE FUNCTION pg_temp.t313_conv(p_chat TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT b.conversation_id FROM platform_private.waha_direct_chat_bindings b
  WHERE b.organization_id = pg_temp.t313_id(1) AND b.normalized_chat_id = p_chat
$$;

-- ---------------------------------------------------------------------------
-- 0. Catalog and posture of everything the migration adds or replaces.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t313_assert(f.config = ARRAY['search_path=""'] AND f.secdef AND pg_temp.t313_grantees(f.fn) = f.grantees,
  f.fn::TEXT || ': definer, search_path and grantees as intended (grantees ' || pg_temp.t313_grantees(f.fn)::TEXT || ')')
FROM (
  SELECT x.fn, p.proconfig AS config, p.prosecdef AS secdef, x.grantees
  FROM (VALUES
    ('platform.sales_report_erase_person_v1(uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::REGPROCEDURE, ARRAY['service_role']),
    ('platform_private.sales_report_erasure_bypass(uuid)'::REGPROCEDURE, ARRAY[]::TEXT[]),
    ('platform_private.acquire_waha_canonical_identity(uuid,uuid,uuid,uuid)'::REGPROCEDURE, ARRAY[]::TEXT[]),
    ('platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)'::REGPROCEDURE, ARRAY['authenticated']),
    ('platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])'::REGPROCEDURE, ARRAY['authenticated']),
    ('platform.telephony_set_result_v1(uuid,uuid,text,date)'::REGPROCEDURE, ARRAY['authenticated']),
    ('platform_private.p7a_safe_audit_actions()'::REGPROCEDURE, ARRAY[]::TEXT[]),
    ('platform_private.p7a_safe_audit_resource_types()'::REGPROCEDURE, ARRAY[]::TEXT[]),
    ('platform_private.p7a_safe_audit_actions_pre_sales_import_tails()'::REGPROCEDURE, ARRAY[]::TEXT[]),
    ('platform_private.p7a_safe_audit_resource_types_pre_sales_import_tails()'::REGPROCEDURE, ARRAY[]::TEXT[])
  ) AS x(fn, grantees) JOIN pg_proc p ON p.oid = x.fn
) AS f;
-- The invoker-rights helpers: nobody may call them, and their search_path is empty.
SELECT pg_temp.t313_assert(f.config = ARRAY['search_path=""'] AND pg_temp.t313_grantees(f.fn) = ARRAY[]::TEXT[],
  f.fn::TEXT || ': empty search_path, callable by nobody')
FROM (
  SELECT x.fn, p.proconfig AS config
  FROM (VALUES
    ('platform_private.sales_report_receipts_block_mutation()'::REGPROCEDURE),
    ('platform_private.sales_report_erasure_scope(uuid,uuid,uuid,uuid)'::REGPROCEDURE),
    ('platform_private.sales_report_erasure_counts(uuid,bigint[])'::REGPROCEDURE),
    ('platform_private.client_merged_ids(uuid,uuid)'::REGPROCEDURE)
  ) AS x(fn) JOIN pg_proc p ON p.oid = x.fn
) AS f;
-- The erasure receipts are closed.
SELECT pg_temp.t313_assert(c.relrowsecurity AND c.relforcerowsecurity
    AND NOT has_table_privilege('authenticated', c.oid, 'SELECT') AND NOT has_table_privilege('anon', c.oid, 'SELECT')
    AND NOT has_table_privilege('service_role', c.oid, 'SELECT') AND NOT has_table_privilege('service_role', c.oid, 'INSERT')
    AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = c.oid),
  'the erasure receipts: forced RLS, no policy, no client privilege')
FROM pg_class c WHERE c.oid = 'platform_private.sales_report_erasure_requests'::regclass;
-- The import receipts: still closed, the row trigger is the new lock, TRUNCATE stays on the general one.
SELECT pg_temp.t313_assert(c.relrowsecurity AND c.relforcerowsecurity
    AND NOT has_table_privilege('service_role', c.oid, 'SELECT') AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
    AND (SELECT count(*) = 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
      AND t.tgfoid = 'platform_private.sales_report_receipts_block_mutation()'::regprocedure
      AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 8) = 8 AND (t.tgtype & 16) = 16)
    AND (SELECT count(*) = 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
      AND t.tgfoid = 'platform_private.block_append_only_mutation()'::regprocedure AND (t.tgtype & 32) = 32),
  'the import receipts: still closed; one BEFORE UPDATE/DELETE row trigger on the new lock, TRUNCATE on the general lock')
FROM pg_class c WHERE c.oid = 'platform_private.sales_report_import_receipts'::regclass;
-- The lock keeps 280's account-deletion bypass and the general lock's message.
SELECT pg_temp.t313_assert(strpos(prosrc, 'account_erasure_bypass') > 0 AND strpos(prosrc, 'is append-only; % is forbidden') > 0
    AND strpos(prosrc, 'sales_report_import_receipts') > 0,
  'the new lock keeps the account-deletion bypass and the general message')
FROM pg_proc WHERE oid = 'platform_private.sales_report_receipts_block_mutation()'::regprocedure;
-- The general lock and every other table's triggers are not changed by this migration.
SELECT pg_temp.t313_assert(strpos(prosrc, 'sales_report') = 0 AND strpos(prosrc, 'account_erasure_bypass') > 0,
  'the general append-only lock is untouched')
FROM pg_proc WHERE oid = 'platform_private.block_append_only_mutation()'::regprocedure;

-- ---------------------------------------------------------------------------
-- A. The erasure of the sales-report import receipts.
-- ---------------------------------------------------------------------------
-- A row of the report as the loader sends it (the 304 suite's shape). p_sha is one hex digit.
CREATE FUNCTION pg_temp.t313_row(p_key TEXT, p_sha TEXT DEFAULT 'a', p_mode TEXT DEFAULT 'insert',
  p_name TEXT DEFAULT 'T313 Applicant', p_paid BIGINT DEFAULT 100000, p_phone TEXT DEFAULT '0555 313 900') RETURNS JSONB
LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('mode', p_mode, 'source_key', p_key, 'source_sheet', 'T313 Sheet', 'source_row', 7,
    'source_sha256', repeat(p_sha, 64), 'report_month', '2026-09-01',
    'source_snapshot', jsonb_build_object('applicant_name', p_name, 'phone', p_phone, 'status_raw', 'Оплачено',
      'review_flags', '[]'::JSONB, 'signing_date_raw', '2026-09-15', 'signing_date_type', 'date',
      'service_cost_raw', '1000 $', 'paid_raw', '1000 $', 'status_column_present', TRUE,
      'source_period_year_inferred', FALSE),
    'fields', jsonb_build_object('signing_date', '2026-09-15', 'applicant_name', p_name, 'phone', p_phone,
      'country', 'Китай', 'university', 'T313 University', 'program', 'T313 Program', 'direction', 'CN',
      'intake', '2027', 'contract_number', 'T313-1', 'manager_label', 'T313 Manager', 'status_raw', 'Оплачено',
      'service_cost_raw', '1000 $', 'service_cost_minor', 100000, 'service_cost_currency', 'USD',
      'paid_raw', '1000 $', 'paid_minor', p_paid, 'paid_currency', 'USD', 'needs_review', FALSE, 'notes', NULL))
$$;
CREATE FUNCTION pg_temp.t313_pay(p_row JSONB, p_person JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('row', p_row) || CASE WHEN p_person IS NULL THEN '{}'::JSONB ELSE jsonb_build_object('person', p_person) END
$$;
CREATE FUNCTION pg_temp.t313_create(p_name TEXT, p_phone TEXT, p_email TEXT DEFAULT NULL,
  p_direction TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('mode', 'create_lead',
    'client', jsonb_strip_nulls(jsonb_build_object('name', p_name, 'phone', p_phone, 'email', p_email)),
    'interest_direction', p_direction, 'note', p_note)
$$;
CREATE FUNCTION pg_temp.t313_imp_sql(p_ref TEXT, p_payload JSONB, p_actor INTEGER DEFAULT 301, p_org INTEGER DEFAULT 1) RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.import_sales_report_row_v1(%L::UUID, %L::UUID, %L, %L, %L::JSONB, %L)',
    pg_temp.t313_id(p_org), pg_temp.t313_id(p_actor), 't313-report', p_ref, p_payload::TEXT, 'T313 синтетический перенос отчёта')
$$;
CREATE FUNCTION pg_temp.t313_imp(p_ref TEXT, p_payload JSONB, p_actor INTEGER DEFAULT 301, p_org INTEGER DEFAULT 1) RETURNS JSONB
LANGUAGE SQL AS $$
  SELECT pg_temp.t313_svc_json(pg_temp.t313_imp_sql(p_ref, p_payload, p_actor, p_org))
$$;
-- The erasure command (run through t313_svc / t313_svc_json). Request number n gives the request id.
CREATE FUNCTION pg_temp.t313_erase_sql(p_req INTEGER, p_client UUID DEFAULT NULL, p_lead UUID DEFAULT NULL,
  p_register UUID DEFAULT NULL, p_dry BOOLEAN DEFAULT FALSE, p_actor INTEGER DEFAULT 301, p_org INTEGER DEFAULT 1) RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform.sales_report_erase_person_v1(%L::UUID, %L::UUID, %L::UUID, %L::UUID, %L::UUID, %L::UUID, %L::BOOLEAN)',
    pg_temp.t313_id(p_org), pg_temp.t313_id(8000 + p_req), pg_temp.t313_id(p_actor), p_client, p_lead, p_register, p_dry)
$$;
-- A fingerprint of everything the import and the erasure may write.
CREATE FUNCTION pg_temp.t313_state() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT concat_ws('/',
    (SELECT count(*) FROM platform_private.sales_register),
    (SELECT md5(COALESCE(string_agg(r.id::TEXT || r.version::TEXT || r.fields::TEXT || COALESCE(r.linked_lead_id::TEXT, '')
      || r.archived::TEXT, '|' ORDER BY r.id), '')) FROM platform_private.sales_register r),
    (SELECT md5(COALESCE(string_agg(to_jsonb(x)::TEXT, '|' ORDER BY x.receipt_seq), '')) FROM platform_private.sales_report_import_receipts x),
    (SELECT count(*) FROM platform_private.sales_report_erasure_requests),
    (SELECT count(*) FROM platform.clients),
    (SELECT count(*) FROM platform.leads))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t313_row(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT), pg_temp.t313_pay(JSONB, JSONB),
  pg_temp.t313_create(TEXT, TEXT, TEXT, TEXT, TEXT), pg_temp.t313_imp_sql(TEXT, JSONB, INTEGER, INTEGER),
  pg_temp.t313_erase_sql(INTEGER, UUID, UUID, UUID, BOOLEAN, INTEGER, INTEGER)
  TO authenticated, anon, service_role;

-- Persons of organization 1 (each: a row of the report, a client and a lead made by the import):
--   alpha   row 1: inserted with a lead and a note, then refreshed (the refresh keeps the previous values)
--   beta    row 2: the same shape; the bystander whose receipts must survive
--   gamma   row 3: erased by lead
--   delta   row 4: a row without a person; erased by report row
--   epsilon row 5: a lead and a note, later merged away by the Admin; erased by the merged client's id
-- Organization 2: eta, the other tenant's receipts.
SELECT pg_temp.t313_imp('ax-ins', pg_temp.t313_pay(pg_temp.t313_row('T313:S:1', 'a', 'insert', 'T313 Erase Alpha', 100000, '0555 313 101'),
  pg_temp.t313_create('T313 Erase Alpha', '+996 555 313 101', 't313-alpha@example.invalid', 'CN', 'T313 secret note alpha'))) AS t313_ax1 \gset
SELECT pg_temp.t313_imp('ax-ref', pg_temp.t313_pay(pg_temp.t313_row('T313:S:1', 'b', 'refresh', 'T313 Erase Alpha', 150000, '0555 313 101'))) AS t313_ax2 \gset
SELECT pg_temp.t313_imp('ay-ins', pg_temp.t313_pay(pg_temp.t313_row('T313:S:2', 'a', 'insert', 'T313 Keep Beta', 100000, '0555 313 102'),
  pg_temp.t313_create('T313 Keep Beta', '+996 555 313 102', 't313-beta@example.invalid', 'CN', 'T313 note beta'))) AS t313_ay1 \gset
SELECT pg_temp.t313_imp('ay-ref', pg_temp.t313_pay(pg_temp.t313_row('T313:S:2', 'b', 'refresh', 'T313 Keep Beta', 150000, '0555 313 102'))) AS t313_ay2 \gset
SELECT pg_temp.t313_imp('az-ins', pg_temp.t313_pay(pg_temp.t313_row('T313:S:3', 'a', 'insert', 'T313 Lead Gamma', 100000, '0555 313 103'),
  pg_temp.t313_create('T313 Lead Gamma', '+996 555 313 103', NULL, 'MY', 'T313 note gamma'))) AS t313_az1 \gset
SELECT pg_temp.t313_imp('aw-ins', pg_temp.t313_pay(pg_temp.t313_row('T313:S:4', 'a', 'insert', 'T313 Row Delta', 100000, '0555 313 104'))) AS t313_aw1 \gset
SELECT pg_temp.t313_imp('aw-ref', pg_temp.t313_pay(pg_temp.t313_row('T313:S:4', 'b', 'refresh', 'T313 Row Delta', 120000, '0555 313 104'))) AS t313_aw2 \gset
SELECT pg_temp.t313_imp('am-ins', pg_temp.t313_pay(pg_temp.t313_row('T313:S:5', 'a', 'insert', 'T313 Merge Epsilon', 100000, '0555 313 105'),
  pg_temp.t313_create('T313 Merge Epsilon', '+996 555 313 105', 't313-epsilon@example.invalid', 'CN', 'T313 note epsilon'))) AS t313_am1 \gset
SELECT pg_temp.t313_imp('bo-ins', pg_temp.t313_pay(pg_temp.t313_row('T313:S:9', 'a', 'insert', 'T313 Other Org Eta', 100000, '0555 313 109'),
  pg_temp.t313_create('T313 Other Org Eta', '+996 555 313 109', NULL, 'CN', 'T313 note eta')), 310, 2) AS t313_bo1 \gset
SELECT pg_temp.t313_assert(:'t313_ax1'::JSONB ->> 'status' = 'lead_created' AND :'t313_ax2'::JSONB ->> 'status' = 'refreshed'
  AND :'t313_ay1'::JSONB ->> 'status' = 'lead_created' AND :'t313_ay2'::JSONB ->> 'status' = 'refreshed'
  AND :'t313_az1'::JSONB ->> 'status' = 'lead_created' AND :'t313_aw1'::JSONB ->> 'status' = 'inserted'
  AND :'t313_aw2'::JSONB ->> 'status' = 'refreshed' AND :'t313_am1'::JSONB ->> 'status' = 'lead_created'
  AND :'t313_bo1'::JSONB ->> 'status' = 'lead_created',
  'fixture: the real import made the rows, the people and the receipts');
SELECT :'t313_ax1'::JSONB ->> 'client_id' AS t313_ax_client, :'t313_ax1'::JSONB ->> 'lead_id' AS t313_ax_lead,
  :'t313_ax1'::JSONB ->> 'register_id' AS t313_ax_reg,
  :'t313_ay1'::JSONB ->> 'client_id' AS t313_ay_client, :'t313_ay1'::JSONB ->> 'lead_id' AS t313_ay_lead,
  :'t313_ay1'::JSONB ->> 'register_id' AS t313_ay_reg,
  :'t313_az1'::JSONB ->> 'client_id' AS t313_az_client, :'t313_az1'::JSONB ->> 'lead_id' AS t313_az_lead,
  :'t313_az1'::JSONB ->> 'register_id' AS t313_az_reg,
  :'t313_aw1'::JSONB ->> 'register_id' AS t313_aw_reg,
  :'t313_am1'::JSONB ->> 'client_id' AS t313_am_client, :'t313_am1'::JSONB ->> 'lead_id' AS t313_am_lead,
  :'t313_am1'::JSONB ->> 'register_id' AS t313_am_reg,
  :'t313_bo1'::JSONB ->> 'client_id' AS t313_bo_client, :'t313_bo1'::JSONB ->> 'register_id' AS t313_bo_reg \gset
SELECT pg_temp.t313_assert(
  (SELECT count(*) = 9 FROM platform_private.sales_report_import_receipts)
  AND (SELECT count(*) = 3 FROM platform_private.sales_report_import_receipts WHERE before_state <> '{}'::JSONB)
  AND (SELECT count(*) = 5 FROM platform_private.sales_report_import_receipts WHERE lead_note IS NOT NULL)
  AND (SELECT before_state -> 'register' -> 'fields' ->> 'applicant_name' FROM platform_private.sales_report_import_receipts
        WHERE external_ref = 'ax-ref') = 'T313 Erase Alpha',
  'fixture: the receipts hold the previous values of the refreshed rows (name, phone) and the notes — the data the erasure is for');

-- A second system Admin, a member of staff and a Student are not a way around the service boundary.
-- A1. The service boundary and the actor.
SELECT pg_temp.t313_state() AS t313_s0 \gset
SET LOCAL request.jwt.claims TO '{"role":"authenticated","sub":"31300000-0000-4000-8000-000000000101"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t313_assert(pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID))
  LIKE '42501:permission denied for function sales_report_erase_person_v1',
  'authenticated, even the Admin, cannot execute the erasure');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.t313_assert(pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID)) LIKE '42501:permission denied for %',
  'anon cannot execute the erasure');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role","sub":"31300000-0000-4000-8000-000000000101"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.t313_assert(pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID)) = '42501:Service role is required',
  'the service role carrying a user identity (a sub) is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"authenticated"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.t313_assert(pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID)) = '42501:Service role is required',
  'an authenticated role claim without a sub is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE service_role;
SELECT pg_temp.t313_assert(pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID)) = '42501:Service role is required',
  'a service role without claims is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.t313_assert(ARRAY[
    pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID, NULL, NULL, FALSE, 302)),
    pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID, NULL, NULL, FALSE, 303)),
    pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID, NULL, NULL, FALSE, 305)),
    pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID, NULL, NULL, FALSE, 999)),
    pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID, NULL, NULL, FALSE, 310, 1)),
    pg_temp.t313_error(pg_temp.t313_erase_sql(1, :'t313_ax_client'::UUID, NULL, NULL, FALSE, 301, 2))
  ] = ARRAY(SELECT '42501:sales_report_erasure_forbidden' FROM generate_series(1, 6)),
  'a Sales member, invited staff, a Student, an unknown membership and a foreign Admin cannot be the actor');
SELECT pg_temp.t313_assert(
  pg_temp.t313_error(format('SELECT platform.sales_report_erase_person_v1(NULL, %L, %L, %L, NULL, NULL, FALSE)',
    pg_temp.t313_id(8001), pg_temp.t313_id(301), :'t313_ax_client')) = '22023:sales_report_erasure_invalid'
  AND pg_temp.t313_error(format('SELECT platform.sales_report_erase_person_v1(%L, NULL, %L, %L, NULL, NULL, FALSE)',
    pg_temp.t313_id(1), pg_temp.t313_id(301), :'t313_ax_client')) = '22023:sales_report_erasure_invalid'
  AND pg_temp.t313_error(format('SELECT platform.sales_report_erase_person_v1(%L, %L, NULL, %L, NULL, NULL, FALSE)',
    pg_temp.t313_id(1), pg_temp.t313_id(8001), :'t313_ax_client')) = '22023:sales_report_erasure_invalid'
  AND pg_temp.t313_error(format('SELECT platform.sales_report_erase_person_v1(%L, %L, %L, NULL, NULL, NULL, FALSE)',
    pg_temp.t313_id(1), pg_temp.t313_id(8001), pg_temp.t313_id(301))) = '22023:sales_report_erasure_invalid'
  AND pg_temp.t313_error(format('SELECT platform.sales_report_erase_person_v1(%L, %L, %L, %L, NULL, NULL, NULL)',
    pg_temp.t313_id(1), pg_temp.t313_id(8001), pg_temp.t313_id(301), :'t313_ax_client')) = '22023:sales_report_erasure_invalid'
  AND pg_temp.t313_error(format('SELECT platform.sales_report_erase_person_v1(%L, %L, %L, %L, NULL, NULL, FALSE)',
    pg_temp.t313_id(77), pg_temp.t313_id(8001), pg_temp.t313_id(301), :'t313_ax_client')) = '22023:sales_report_erasure_unknown_organization',
  'a missing organization, request or actor, no selector at all, a NULL dry-run flag and an unknown organization are refused by name');
RESET ROLE;
SELECT pg_temp.t313_assert(pg_temp.t313_state() = :'t313_s0', 'every refused call wrote nothing');

-- A2. Dry run: the counts and the report rows, nothing written.
SELECT pg_temp.t313_svc_json(pg_temp.t313_erase_sql(2, :'t313_ax_client'::UUID, NULL, NULL, TRUE)) AS t313_dry \gset
SELECT pg_temp.t313_assert(:'t313_dry'::JSONB ->> 'status' = 'dry_run'
  AND :'t313_dry'::JSONB -> 'counts' = '{"receipts": 2, "with_lead_note": 1, "with_before_state": 1}'::JSONB
  AND :'t313_dry'::JSONB -> 'register_ids' = jsonb_build_array(:'t313_ax_reg')
  AND pg_temp.t313_state() = :'t313_s0',
  'dry run by client: two receipts (one with the previous values, one with the note), the one report row, and nothing written');
-- The same person by lead, by report row, and by the id of the client merged away later (below) give the same scope.
SELECT pg_temp.t313_assert(
  pg_temp.t313_svc_json(pg_temp.t313_erase_sql(2, NULL, :'t313_ax_lead'::UUID, NULL, TRUE)) -> 'counts'
    = pg_temp.t313_svc_json(pg_temp.t313_erase_sql(2, NULL, NULL, :'t313_ax_reg'::UUID, TRUE)) -> 'counts'
  AND pg_temp.t313_svc_json(pg_temp.t313_erase_sql(2, NULL, NULL, :'t313_ax_reg'::UUID, TRUE)) -> 'counts'
    = '{"receipts": 2, "with_lead_note": 1, "with_before_state": 1}'::JSONB
  AND pg_temp.t313_state() = :'t313_s0',
  'dry run by lead and by report row finds the same receipts');
-- A client of no receipts and a foreign organization's ids find nothing.
SELECT pg_temp.t313_assert(
  pg_temp.t313_svc_json(pg_temp.t313_erase_sql(2, :'t313_bo_client'::UUID, NULL, NULL, TRUE)) -> 'counts'
    = '{"receipts": 0, "with_lead_note": 0, "with_before_state": 0}'::JSONB
  AND pg_temp.t313_svc_json(pg_temp.t313_erase_sql(2, NULL, NULL, :'t313_bo_reg'::UUID, TRUE)) -> 'counts'
    = '{"receipts": 0, "with_lead_note": 0, "with_before_state": 0}'::JSONB
  AND pg_temp.t313_state() = :'t313_s0',
  'the other organization''s client and report row find nothing here');

-- A3. The effect by client (alpha): the receipts of the person are gone, an empty one is left on each key.
SELECT pg_temp.t313_svc_json(pg_temp.t313_erase_sql(3, :'t313_ax_client'::UUID)) AS t313_er1 \gset
SELECT pg_temp.t313_assert(:'t313_er1'::JSONB ->> 'status' = 'erased'
  AND :'t313_er1'::JSONB -> 'counts' = '{"receipts": 2, "with_lead_note": 1, "with_before_state": 1, "erased_empty_receipts": 2}'::JSONB
  AND :'t313_er1'::JSONB -> 'register_ids' = jsonb_build_array(:'t313_ax_reg')
  AND (:'t313_er1'::JSONB ->> 'receipt_id') IS NOT NULL,
  'erasure by client: two receipts erased, two empty ones left, the report row named for the next step');
SELECT pg_temp.t313_assert(
  (SELECT count(*) = 2 FROM platform_private.sales_report_import_receipts WHERE external_ref IN ('ax-ins', 'ax-ref'))
  AND (SELECT bool_and(r.before_state = '{}'::JSONB AND r.lead_note IS NULL AND r.register_id IS NULL AND r.register_version IS NULL
        AND r.result = jsonb_build_object('status', 'erased', 'import_source', r.import_source, 'external_ref', r.external_ref)
        AND r.actor_membership_id = pg_temp.t313_id(301) AND r.payload_md5 = md5('sales-report-erased:' || r.import_source || ':' || r.external_ref))
      FROM platform_private.sales_report_import_receipts r WHERE r.external_ref IN ('ax-ins', 'ax-ref')),
  'each erased key holds an empty receipt: no previous values, note, report row or version; the answer is only «erased»');
SELECT pg_temp.t313_assert(
  NOT EXISTS (SELECT 1 FROM platform_private.sales_report_import_receipts r
    WHERE to_jsonb(r)::TEXT LIKE '%Erase Alpha%' OR to_jsonb(r)::TEXT LIKE '%313 101%' OR to_jsonb(r)::TEXT LIKE '%secret note alpha%'
      OR to_jsonb(r)::TEXT LIKE '%alpha@example%')
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_report_erasure_requests e
    WHERE to_jsonb(e)::TEXT LIKE '%Erase Alpha%' OR to_jsonb(e)::TEXT LIKE '%313 101%' OR to_jsonb(e)::TEXT LIKE '%secret note alpha%'),
  'no receipt and no erasure record holds the name, the phone, the e-mail or the note of the erased person');
-- The bystander and the other organization are untouched; the report rows themselves are not touched.
SELECT pg_temp.t313_assert(
  (SELECT count(*) = 2 FROM platform_private.sales_report_import_receipts WHERE external_ref IN ('ay-ins', 'ay-ref'))
  AND (SELECT before_state -> 'register' -> 'fields' ->> 'applicant_name' FROM platform_private.sales_report_import_receipts
        WHERE external_ref = 'ay-ref') = 'T313 Keep Beta'
  AND (SELECT lead_note FROM platform_private.sales_report_import_receipts WHERE external_ref = 'ay-ins') = 'T313 note beta'
  AND (SELECT count(*) = 1 FROM platform_private.sales_report_import_receipts
        WHERE organization_id = pg_temp.t313_id(2) AND external_ref = 'bo-ins' AND lead_note = 'T313 note eta')
  AND (SELECT count(*) = 9 FROM platform_private.sales_report_import_receipts)
  AND (SELECT fields ->> 'applicant_name' FROM platform_private.sales_register WHERE id = :'t313_ax_reg'::UUID) = 'T313 Erase Alpha'
  AND (SELECT count(*) = 5 FROM platform_private.sales_register WHERE organization_id = pg_temp.t313_id(1))
  AND (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.t313_id(1)) = 4
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.t313_id(1)) = 4,
  'the bystander''s receipts and the other organization''s stay whole; the report rows, clients and leads are not touched');
-- The erasure receipt: who, what was searched by, the numbers; closed marker.
SELECT pg_temp.t313_assert(
  (SELECT count(*) = 1 FROM platform_private.sales_report_erasure_requests e
    WHERE e.id = (:'t313_er1'::JSONB ->> 'receipt_id')::UUID AND e.organization_id = pg_temp.t313_id(1)
      AND e.request_id = pg_temp.t313_id(8003) AND e.actor_membership_id = pg_temp.t313_id(301)
      AND e.by_client AND NOT e.by_lead AND NOT e.by_register AND e.erasure_transaction_id IS NULL AND e.completed_at IS NOT NULL
      AND e.summary -> 'counts' = :'t313_er1'::JSONB -> 'counts' AND e.summary -> 'register_ids' = :'t313_er1'::JSONB -> 'register_ids')
  AND (SELECT count(*) = 1 FROM platform_private.sales_report_erasure_requests),
  'one erasure receipt: the Admin, the search by client, the numbers and the report row ids; the marker is cleared');
-- A repeated import call of the erased row is refused, the person is not made again.
SELECT pg_temp.t313_state() AS t313_s1 \gset
SELECT pg_temp.t313_assert(
  pg_temp.t313_error(pg_temp.t313_imp_sql('ax-ins', pg_temp.t313_pay(pg_temp.t313_row('T313:S:1', 'a', 'insert', 'T313 Erase Alpha', 100000, '0555 313 101'),
    pg_temp.t313_create('T313 Erase Alpha', '+996 555 313 101', 't313-alpha@example.invalid', 'CN', 'T313 secret note alpha'))))
    = 'PT409:sales_report_import_request_conflict'
  AND pg_temp.t313_error(pg_temp.t313_imp_sql('ax-ref', pg_temp.t313_pay(pg_temp.t313_row('T313:S:1', 'b', 'refresh', 'T313 Erase Alpha', 150000, '0555 313 101'))))
    = 'PT409:sales_report_import_request_conflict'
  AND pg_temp.t313_state() = :'t313_s1',
  'repeating the erased import calls is PT409: the key still answers, nobody is recreated, nothing is written');
-- Replay and conflict.
SELECT pg_temp.t313_svc_json(pg_temp.t313_erase_sql(3, :'t313_ax_client'::UUID)) AS t313_er1b \gset
SELECT pg_temp.t313_assert(:'t313_er1b'::JSONB ->> 'status' = 'replayed' AND :'t313_er1b'::JSONB ->> 'receipt_id' = :'t313_er1'::JSONB ->> 'receipt_id'
  AND :'t313_er1b'::JSONB -> 'counts' = :'t313_er1'::JSONB -> 'counts' AND :'t313_er1b'::JSONB -> 'register_ids' = :'t313_er1'::JSONB -> 'register_ids'
  AND pg_temp.t313_state() = :'t313_s1',
  'the same request again is a replay with the same answer; nothing is erased or written twice');
SELECT pg_temp.t313_assert(
  pg_temp.t313_error(pg_temp.t313_erase_sql(3, :'t313_ay_client'::UUID)) = '22023:sales_report_erasure_request_conflict'
  AND pg_temp.t313_error(pg_temp.t313_erase_sql(3, NULL, :'t313_ax_lead'::UUID)) = '22023:sales_report_erasure_request_conflict'
  AND pg_temp.t313_error(pg_temp.t313_erase_sql(3, :'t313_ax_client'::UUID, NULL, NULL, FALSE, 304)) = '22023:sales_report_erasure_request_conflict'
  AND pg_temp.t313_state() = :'t313_s1',
  'the same request id with another client, another search or another Admin is refused (22023), not answered with the old result');
-- Erasing again under a new request finds the empty receipts only: nothing real is left; no new empty ones.
SELECT pg_temp.t313_svc_json(pg_temp.t313_erase_sql(4, :'t313_ax_client'::UUID)) AS t313_er1c \gset
SELECT pg_temp.t313_assert(:'t313_er1c'::JSONB ->> 'status' = 'erased'
  AND :'t313_er1c'::JSONB -> 'counts' = '{"receipts": 0, "with_lead_note": 0, "with_before_state": 0, "erased_empty_receipts": 0}'::JSONB
  AND (SELECT count(*) = 9 FROM platform_private.sales_report_import_receipts),
  'a second erasure of the same person finds no real receipt and leaves the empty ones as they are');

-- A4. By lead (gamma) and by report row (delta).
SELECT pg_temp.t313_svc_json(pg_temp.t313_erase_sql(5, NULL, :'t313_az_lead'::UUID)) AS t313_er2 \gset
SELECT pg_temp.t313_assert(:'t313_er2'::JSONB ->> 'status' = 'erased'
  AND :'t313_er2'::JSONB -> 'counts' = '{"receipts": 1, "with_lead_note": 1, "with_before_state": 0, "erased_empty_receipts": 1}'::JSONB
  AND (SELECT lead_note IS NULL AND before_state = '{}'::JSONB AND register_id IS NULL
        FROM platform_private.sales_report_import_receipts WHERE external_ref = 'az-ins')
  AND (SELECT by_lead AND NOT by_client AND NOT by_register FROM platform_private.sales_report_erasure_requests WHERE request_id = pg_temp.t313_id(8005)),
  'erasure by lead: the gamma receipt, with its note, is emptied');
SELECT pg_temp.t313_svc_json(pg_temp.t313_erase_sql(6, NULL, NULL, :'t313_aw_reg'::UUID)) AS t313_er3 \gset
SELECT pg_temp.t313_assert(:'t313_er3'::JSONB ->> 'status' = 'erased'
  AND :'t313_er3'::JSONB -> 'counts' = '{"receipts": 2, "with_lead_note": 0, "with_before_state": 1, "erased_empty_receipts": 2}'::JSONB
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_report_import_receipts r WHERE to_jsonb(r)::TEXT LIKE '%Row Delta%' OR to_jsonb(r)::TEXT LIKE '%313 104%')
  AND (SELECT by_register AND NOT by_client AND NOT by_lead FROM platform_private.sales_report_erasure_requests WHERE request_id = pg_temp.t313_id(8006)),
  'erasure by report row: a row without a person, its insert and refresh receipts are emptied');

-- A5. A client merged away: the search starts from the client it became and takes the clients merged into it.
SELECT platform_private.create_or_link_client(pg_temp.t313_id(1), 'T313 Survivor Epsilon', NULL, '+996 555 313 115',
  't313-fixture', 'client', 'client-eps2', 'staff_recorded', statement_timestamp()) AS t313_eps_other \gset
SELECT platform_private.create_or_link_lead(pg_temp.t313_id(1), :'t313_eps_other'::UUID, NULL, 'new', 'office',
  't313-fixture', 'lead', 'lead-eps2', 'staff_recorded', statement_timestamp()) AS t313_eps_other_lead \gset
-- The kept client is the one the report row is tied to (308: the lead of a report sale stays with the survivor).
SELECT pg_temp.t313_svc_json(format(
  'SELECT platform.merge_clients_owner_confirmed_v1(%L::UUID, %L::UUID, %L, %L, %L::UUID, %L::UUID, %L)',
  pg_temp.t313_id(1), pg_temp.t313_id(301), 't313-merge', 'a5-merge', :'t313_am_client', :'t313_eps_other', 'T313 synthetic merge')) AS t313_m1 \gset
SELECT pg_temp.t313_assert(:'t313_m1'::JSONB ->> 'status' = 'merged' AND EXISTS (SELECT 1 FROM platform_private.client_aliases
    WHERE superseded_client_id = :'t313_eps_other'::UUID AND canonical_client_id = :'t313_am_client'::UUID),
  'fixture: the Admin merged the second epsilon client into the one the report tied');
SELECT pg_temp.t313_assert(
  pg_temp.t313_svc_json(pg_temp.t313_erase_sql(7, :'t313_eps_other'::UUID, NULL, NULL, TRUE)) -> 'counts'
    = '{"receipts": 1, "with_lead_note": 1, "with_before_state": 0}'::JSONB
  AND pg_temp.t313_svc_json(pg_temp.t313_erase_sql(7, :'t313_am_client'::UUID, NULL, NULL, TRUE)) -> 'counts'
    = '{"receipts": 1, "with_lead_note": 1, "with_before_state": 0}'::JSONB
  AND pg_temp.t313_svc_json(pg_temp.t313_erase_sql(7, :'t313_eps_other'::UUID, NULL, NULL, TRUE)) -> 'register_ids' = jsonb_build_array(:'t313_am_reg'),
  'dry run by the merged-away client and by the survivor find the same receipt and the same report row');
SELECT pg_temp.t313_svc_json(pg_temp.t313_erase_sql(7, :'t313_eps_other'::UUID)) AS t313_er4 \gset
SELECT pg_temp.t313_assert(:'t313_er4'::JSONB ->> 'status' = 'erased'
  AND (SELECT lead_note IS NULL AND before_state = '{}'::JSONB FROM platform_private.sales_report_import_receipts WHERE external_ref = 'am-ins')
  AND NOT EXISTS (SELECT 1 FROM platform_private.sales_report_import_receipts r WHERE to_jsonb(r)::TEXT LIKE '%note epsilon%'),
  'erasure by the id of the merged-away client reaches the survivor''s receipts');

-- A6. The other organization: org 2's Admin erases in org 2 only, and org 1's ids do nothing there.
SELECT pg_temp.t313_assert(
  pg_temp.t313_svc_json(pg_temp.t313_erase_sql(8, :'t313_ay_client'::UUID, NULL, NULL, FALSE, 310, 2)) -> 'counts'
    = '{"receipts": 0, "with_lead_note": 0, "with_before_state": 0, "erased_empty_receipts": 0}'::JSONB
  AND (SELECT lead_note FROM platform_private.sales_report_import_receipts WHERE external_ref = 'ay-ins') = 'T313 note beta'
  AND (SELECT lead_note FROM platform_private.sales_report_import_receipts WHERE organization_id = pg_temp.t313_id(2) AND external_ref = 'bo-ins') = 'T313 note eta',
  'org 2''s Admin with org 1''s ids erases nothing and org 1''s receipts are whole');
SELECT pg_temp.t313_svc_json(pg_temp.t313_erase_sql(9, :'t313_bo_client'::UUID, NULL, NULL, FALSE, 310, 2)) AS t313_er5 \gset
SELECT pg_temp.t313_assert(:'t313_er5'::JSONB -> 'counts' = '{"receipts": 1, "with_lead_note": 1, "with_before_state": 0, "erased_empty_receipts": 1}'::JSONB
  AND (SELECT lead_note IS NULL FROM platform_private.sales_report_import_receipts WHERE organization_id = pg_temp.t313_id(2) AND external_ref = 'bo-ins')
  AND (SELECT lead_note FROM platform_private.sales_report_import_receipts WHERE external_ref = 'ay-ins') = 'T313 note beta',
  'org 2''s Admin erases org 2''s person; the bystander of org 1 is still whole');
-- The same request id in two organizations are two different requests.
SELECT pg_temp.t313_assert(
  (SELECT count(*) = 2 FROM platform_private.sales_report_erasure_requests WHERE request_id IN (pg_temp.t313_id(8008), pg_temp.t313_id(8009)) AND organization_id = pg_temp.t313_id(2)),
  'org 2''s requests are stored under org 2');

-- A7. The lock: still append-only for everyone, the marker is not forgeable.
SELECT pg_temp.t313_state() AS t313_s2 \gset
SELECT pg_temp.t313_assert(
  pg_temp.t313_error('UPDATE platform_private.sales_report_import_receipts SET external_ref = ''forged''') = '55000:platform.sales_report_import_receipts is append-only; UPDATE is forbidden'
  AND pg_temp.t313_error('DELETE FROM platform_private.sales_report_import_receipts') = '55000:platform.sales_report_import_receipts is append-only; DELETE is forbidden'
  AND pg_temp.t313_error('TRUNCATE platform_private.sales_report_import_receipts') = '55000:platform.sales_report_import_receipts is append-only; TRUNCATE is forbidden'
  AND pg_temp.t313_state() = :'t313_s2',
  'the receipts stay append-only even for the owner: UPDATE, DELETE and TRUNCATE are refused with the general lock''s words');
SELECT set_config('platform.sales_report_erasure_request_id', pg_temp.t313_id(999)::TEXT, TRUE);
SELECT pg_temp.t313_assert(pg_temp.t313_error('DELETE FROM platform_private.sales_report_import_receipts WHERE external_ref = ''ay-ins''') LIKE '55000:%'
  AND pg_temp.t313_error('UPDATE platform_private.sales_report_import_receipts SET lead_note = NULL WHERE external_ref = ''ay-ins''') LIKE '55000:%',
  'a marker naming no erasure receipt lets nothing through');
SELECT set_config('platform.sales_report_erasure_request_id', (:'t313_er1'::JSONB ->> 'receipt_id'), TRUE);
SELECT pg_temp.t313_assert(pg_temp.t313_error('DELETE FROM platform_private.sales_report_import_receipts WHERE external_ref = ''ay-ins''') LIKE '55000:%',
  'the marker of a finished erasure lets nothing through');
SELECT set_config('platform.sales_report_erasure_request_id', 'not-a-uuid', TRUE);
SELECT pg_temp.t313_assert(pg_temp.t313_error('DELETE FROM platform_private.sales_report_import_receipts WHERE external_ref = ''ay-ins''') LIKE '55000:%',
  'a marker that is not a uuid lets nothing through');
-- An erasure running in this transaction for ANOTHER organization lets that organization''s rows go, and only those.
INSERT INTO platform_private.sales_report_erasure_requests(id, organization_id, request_id, actor_membership_id, by_client, params_md5, erasure_transaction_id)
  VALUES (pg_temp.t313_id(998), pg_temp.t313_id(2), pg_temp.t313_id(8998), pg_temp.t313_id(310), TRUE, md5('t313'), pg_current_xact_id());
SELECT set_config('platform.sales_report_erasure_request_id', pg_temp.t313_id(998)::TEXT, TRUE);
SELECT pg_temp.t313_assert(pg_temp.t313_error('DELETE FROM platform_private.sales_report_import_receipts WHERE external_ref = ''ay-ins''') LIKE '55000:%'
  AND pg_temp.t313_error('UPDATE platform_private.sales_report_import_receipts SET lead_note = NULL WHERE organization_id = ''' || pg_temp.t313_id(2) || '''') LIKE '55000:%'
  AND pg_temp.t313_error('TRUNCATE platform_private.sales_report_import_receipts') LIKE '55000:%'
  AND pg_temp.t313_error('DELETE FROM platform_private.sales_report_import_receipts WHERE organization_id = ''' || pg_temp.t313_id(2) || '''') = 'ok',
  'a running erasure of organization 2 deletes organization 2''s rows only; another organization''s rows, UPDATE and TRUNCATE stay refused');
SELECT set_config('platform.sales_report_erasure_request_id', '', TRUE);
SELECT pg_temp.t313_assert(pg_temp.t313_error('DELETE FROM platform_private.sales_report_import_receipts WHERE external_ref = ''ay-ins''') LIKE '55000:%'
  AND (SELECT count(*) = 1 FROM platform_private.sales_report_import_receipts WHERE external_ref = 'ay-ins'),
  'with the marker cleared the lock is whole again');


-- ---------------------------------------------------------------------------
-- B. The WhatsApp intake for a person who is already an admissions student.
-- ---------------------------------------------------------------------------
-- Clear the shared queue of earlier suites' leftovers so only this fixture is claimed.
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();

-- A student case made by 281's own import (the «add a student» path / the amoCRM import): the person of the join.
CREATE FUNCTION pg_temp.t313_student(p_ref TEXT, p_name TEXT, p_phone TEXT, p_email TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t313_svc_json(format('SELECT platform.import_admissions_student_case_v1(%L::UUID, %L::UUID, %L, %L, %L::JSONB, %L)',
    pg_temp.t313_id(1), pg_temp.t313_id(301), 't313-direct', p_ref,
    jsonb_build_object('student', jsonb_build_object('name', p_name, 'phone', p_phone, 'email', p_email),
      'route', jsonb_build_object('country', 'CN'))::TEXT, 'T313 fixture case'))
$$;
CREATE FUNCTION pg_temp.t313_counts() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.t313_id(1)) || '/'
    || (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.t313_id(1))
$$;
CREATE FUNCTION pg_temp.t313_messages(p_conversation UUID) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.communication_messages m WHERE m.conversation_id = p_conversation
$$;
-- The Admin's inbox list: the conversation ids it returns.
CREATE FUNCTION pg_temp.t313_inbox() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t313_call((SELECT claims FROM t313_claims WHERE n = 1), format(
    'SELECT COALESCE(jsonb_agg(conversation_id), ''[]''::JSONB) FROM platform.staff_communication_page(p_organization_id => %L::UUID, p_limit => 50)',
    pg_temp.t313_id(1)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t313_counts() TO authenticated, anon, service_role;

SELECT pg_temp.t313_student('case-1', 'T313 Case Student One', '+996 555 313 201', 't313-s1@example.invalid') AS t313_s1 \gset
SELECT pg_temp.t313_student('case-2', 'T313 Case Student Two', '+996 555 313 202', 't313-s2@example.invalid') AS t313_s2 \gset
SELECT pg_temp.t313_student('case-3', 'T313 Case Student Three', '+996 555 313 203', 't313-s3@example.invalid') AS t313_s3 \gset
SELECT pg_temp.t313_student('case-4', 'T313 Case Student Four', '+996 555 313 204', 't313-s4@example.invalid') AS t313_s4 \gset
SELECT pg_temp.t313_student('case-5', 'T313 Case Student Five', '+996 555 313 205', 't313-s5@example.invalid') AS t313_s5 \gset
SELECT pg_temp.t313_assert(:'t313_s1'::JSONB ->> 'status' = 'created' AND :'t313_s2'::JSONB ->> 'status' = 'created'
  AND :'t313_s3'::JSONB ->> 'status' = 'created' AND :'t313_s4'::JSONB ->> 'status' = 'created' AND :'t313_s5'::JSONB ->> 'status' = 'created',
  'fixture: 281 created five student cases');
SELECT :'t313_s1'::JSONB ->> 'student_case_id' AS t313_s1_case, :'t313_s1'::JSONB ->> 'lead_id' AS t313_s1_lead, :'t313_s1'::JSONB ->> 'client_id' AS t313_s1_client,
  :'t313_s2'::JSONB ->> 'student_case_id' AS t313_s2_case, :'t313_s2'::JSONB ->> 'client_id' AS t313_s2_client,
  :'t313_s3'::JSONB ->> 'student_case_id' AS t313_s3_case, :'t313_s3'::JSONB ->> 'client_id' AS t313_s3_client,
  :'t313_s4'::JSONB ->> 'client_id' AS t313_s4_client, :'t313_s5'::JSONB ->> 'client_id' AS t313_s5_client \gset
-- Case 2 is closed, case 3 came through sales (a sales owner, a sales source key), and
-- student 5 holds the same number as student 4 (two people on one number).
-- (the closing function of 287 closes only an `active` case; a fresh one is `pending`, so the fixture closes it directly)
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET state = 'closed', closed_at = statement_timestamp(), handoff_at = statement_timestamp(),
  current_curator_membership_id = pg_temp.t313_id(304) WHERE id = :'t313_s2_case'::UUID;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.t313_assert((SELECT state::TEXT FROM platform.student_cases WHERE id = :'t313_s2_case'::UUID) = 'closed',
  'fixture: case 2 is closed');
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET source_key = 'sales-handoff:t313', responsible_sales_membership_id = pg_temp.t313_id(302)
  WHERE id = :'t313_s3_case'::UUID;
UPDATE platform.clients SET phone = (SELECT c.phone FROM platform.clients c WHERE c.id = :'t313_s4_client'::UUID),
  normalized_phone = (SELECT c.normalized_phone FROM platform.clients c WHERE c.id = :'t313_s4_client'::UUID)
  WHERE id = :'t313_s5_client'::UUID;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.t313_assert((SELECT source_key FROM platform.student_cases WHERE id = :'t313_s3_case'::UUID) = 'sales-handoff:t313'
  AND (SELECT count(DISTINCT normalized_phone) = 1 FROM platform.clients WHERE id IN (:'t313_s4_client'::UUID, :'t313_s5_client'::UUID)),
  'fixture: case 3 is a sales case, students 4 and 5 share a number');
SELECT count(*) AS t313_cand0 FROM platform_private.client_duplicate_candidates \gset

-- B1. The first chat of the number of student 1 joins student 1's client and the lead of the case.
SELECT pg_temp.t313_counts() AS t313_c0 \gset
SELECT pg_temp.t313_in(1, '996555313201@c.us') AS t313_b1 \gset
SELECT pg_temp.t313_conv('996555313201@c.us') AS t313_b1_conv \gset
SELECT pg_temp.t313_assert(:'t313_b1'::JSONB ->> 'finish_state' = 'succeeded' AND :'t313_b1'::JSONB ->> 'disposition' = 'succeeded'
  AND :'t313_b1_conv' IS NOT NULL AND pg_temp.t313_counts() = :'t313_c0',
  'B1: the message projects and no client and no lead is added');
SELECT pg_temp.t313_assert(
  (SELECT c.canonical_client_id = :'t313_s1_client'::UUID AND c.canonical_lead_id = :'t313_s1_lead'::UUID AND c.queue::TEXT = 'sales'
   FROM platform.communication_conversations c WHERE c.id = :'t313_b1_conv'::UUID)
  AND pg_temp.t313_messages(:'t313_b1_conv'::UUID) = 1,
  'B1: the conversation points to the student''s client and to the lead of the case, in the sales queue, with its message');
SELECT pg_temp.t313_assert(
  (SELECT count(*) = 1 FROM platform.subject_provenance p WHERE p.organization_id = pg_temp.t313_id(1) AND p.client_id = :'t313_s1_client'::UUID
    AND p.source_system = 'waha' AND p.evidence_type = 'webhook_verified' AND p.source_ref = 'waha-event:' || pg_temp.t313_id(1001)::TEXT)
  AND (SELECT count(*) = 1 FROM platform.subject_provenance p WHERE p.organization_id = pg_temp.t313_id(1) AND p.lead_id = :'t313_s1_lead'::UUID
    AND p.source_system = 'waha' AND p.evidence_type = 'webhook_verified' AND p.source_ref = 'waha-event:' || pg_temp.t313_id(1001)::TEXT),
  'B1: the client and the lead keep one provenance row each naming the WhatsApp event');
SELECT pg_temp.t313_assert(
  NOT EXISTS (SELECT 1 FROM platform.external_identifiers e WHERE e.organization_id = pg_temp.t313_id(1)
    AND e.external_object_type IN ('direct_chat', 'sales_intake') AND e.external_identifier LIKE 'crm_primary:996555313201%')
  AND (SELECT count(*) FROM platform_private.client_duplicate_candidates) = :t313_cand0,
  'B1: no WhatsApp identity is registered and no duplicate candidate is raised');
SELECT pg_temp.t313_assert(pg_temp.t313_inbox() ? :'t313_b1_conv',
  'B1: the Admin still finds the conversation in the inbox list');

-- B2. The next message of the same chat, and a second chat of the same number (a LID that names the phone).
SELECT pg_temp.t313_in(2, '996555313201@c.us') AS t313_b2 \gset
SELECT pg_temp.t313_assert(:'t313_b2'::JSONB ->> 'finish_state' = 'succeeded' AND pg_temp.t313_conv('996555313201@c.us') = :'t313_b1_conv'::UUID
  AND pg_temp.t313_messages(:'t313_b1_conv'::UUID) = 2 AND pg_temp.t313_counts() = :'t313_c0',
  'B2: the next message goes to the same conversation; still no client or lead added');
-- A LID event that names the phone of the already bound chat goes to that chat's conversation (259's rule, unchanged).
SELECT pg_temp.t313_in(3, '523456789012345@lid', jsonb_build_object('_data', jsonb_build_object('Info',
  jsonb_build_object('SenderAlt', '996555313201:7@s.whatsapp.net', 'PushName', 'Ignored')))) AS t313_b3 \gset
SELECT pg_temp.t313_assert(:'t313_b3'::JSONB ->> 'finish_state' = 'succeeded' AND pg_temp.t313_messages(:'t313_b1_conv'::UUID) = 3
  AND pg_temp.t313_counts() = :'t313_c0',
  'B3: a LID event naming the phone of the bound chat joins that conversation (its third message); nothing is added');
-- A LID chat that comes FIRST (student 6), then the same person''s phone chat: both join the one client and lead.
SELECT pg_temp.t313_student('case-6', 'T313 Case Student Six', '+996 555 313 206', 't313-s6@example.invalid') AS t313_s6 \gset
SELECT :'t313_s6'::JSONB ->> 'lead_id' AS t313_s6_lead, :'t313_s6'::JSONB ->> 'client_id' AS t313_s6_client \gset
SELECT pg_temp.t313_counts() AS t313_c3b \gset
SELECT pg_temp.t313_in(9, '723456789012345@lid', jsonb_build_object('_data', jsonb_build_object('Info',
  jsonb_build_object('SenderAlt', '996555313206:7@s.whatsapp.net', 'PushName', 'Ignored')))) AS t313_b3b \gset
SELECT pg_temp.t313_in(10, '996555313206@c.us') AS t313_b3c \gset
SELECT pg_temp.t313_conv('723456789012345@lid') AS t313_b3b_lid \gset
SELECT pg_temp.t313_conv('996555313206@c.us') AS t313_b3b_cus \gset
SELECT pg_temp.t313_assert(:'t313_b3b'::JSONB ->> 'finish_state' = 'succeeded' AND :'t313_b3c'::JSONB ->> 'finish_state' = 'succeeded'
  AND :'t313_b3b_lid' IS NOT NULL AND :'t313_b3b_cus' IS NOT NULL AND :'t313_b3b_lid' <> :'t313_b3b_cus'
  AND pg_temp.t313_counts() = :'t313_c3b'
  AND (SELECT count(*) = 2 AND count(DISTINCT canonical_client_id) = 1 AND count(DISTINCT canonical_lead_id) = 1
         AND min(canonical_client_id::TEXT) = :'t313_s6_client' AND min(canonical_lead_id::TEXT) = :'t313_s6_lead'
       FROM platform.communication_conversations c WHERE c.id IN (:'t313_b3b_lid'::UUID, :'t313_b3b_cus'::UUID)),
  'B3: a LID chat first and the phone chat after each have their own conversation and both join the student''s client and lead; nothing is added');

-- B4. An unknown number takes the old path: a new client, a new lead, the chat''s own identity.
SELECT pg_temp.t313_counts() AS t313_c4 \gset
SELECT pg_temp.t313_in(4, '996555313299@c.us') AS t313_b4 \gset
SELECT pg_temp.t313_conv('996555313299@c.us') AS t313_b4_conv \gset
SELECT pg_temp.t313_assert(:'t313_b4'::JSONB ->> 'finish_state' = 'succeeded'
  AND pg_temp.t313_counts() = ((split_part(:'t313_c4', '/', 1))::INTEGER + 1) || '/' || ((split_part(:'t313_c4', '/', 2))::INTEGER + 1)
  AND (SELECT c.canonical_client_id IS NOT NULL AND c.canonical_lead_id IS NOT NULL
       AND c.canonical_client_id NOT IN (SELECT (x ->> 'client_id')::UUID FROM (VALUES (:'t313_s1'::JSONB), (:'t313_s2'::JSONB), (:'t313_s3'::JSONB), (:'t313_s4'::JSONB), (:'t313_s5'::JSONB)) v(x))
       FROM platform.communication_conversations c WHERE c.id = :'t313_b4_conv'::UUID)
  AND EXISTS (SELECT 1 FROM platform.external_identifiers e WHERE e.organization_id = pg_temp.t313_id(1)
    AND e.external_object_type = 'direct_chat' AND e.external_identifier = 'crm_primary:996555313299@c.us'),
  'B4: an unknown number gets a new client and a new lead and registers its WhatsApp identity, as before');

-- B5. A closed case, a case that came through sales and a number held by two people: the old path.
SELECT pg_temp.t313_counts() AS t313_c5 \gset
SELECT pg_temp.t313_in(5, '996555313202@c.us') AS t313_b5 \gset
SELECT pg_temp.t313_assert(:'t313_b5'::JSONB ->> 'finish_state' = 'succeeded'
  AND pg_temp.t313_counts() = ((split_part(:'t313_c5', '/', 1))::INTEGER + 1) || '/' || ((split_part(:'t313_c5', '/', 2))::INTEGER + 1)
  AND (SELECT c.canonical_client_id <> :'t313_s2_client'::UUID FROM platform.communication_conversations c
       WHERE c.id = pg_temp.t313_conv('996555313202@c.us')),
  'B5: the number of a student whose case is closed opens a new client and lead, as before');
SELECT pg_temp.t313_counts() AS t313_c6 \gset
SELECT pg_temp.t313_in(6, '996555313203@c.us') AS t313_b6 \gset
SELECT pg_temp.t313_assert(:'t313_b6'::JSONB ->> 'finish_state' = 'succeeded'
  AND pg_temp.t313_counts() = ((split_part(:'t313_c6', '/', 1))::INTEGER + 1) || '/' || ((split_part(:'t313_c6', '/', 2))::INTEGER + 1)
  AND (SELECT c.canonical_client_id <> :'t313_s3_client'::UUID FROM platform.communication_conversations c
       WHERE c.id = pg_temp.t313_conv('996555313203@c.us')),
  'B6: the number of a student whose case came through sales opens a new client and lead, as before');
SELECT pg_temp.t313_counts() AS t313_c7 \gset
SELECT pg_temp.t313_in(7, '996555313204@c.us') AS t313_b7 \gset
SELECT pg_temp.t313_assert(:'t313_b7'::JSONB ->> 'finish_state' = 'succeeded'
  AND pg_temp.t313_counts() = ((split_part(:'t313_c7', '/', 1))::INTEGER + 1) || '/' || ((split_part(:'t313_c7', '/', 2))::INTEGER + 1)
  AND (SELECT c.canonical_client_id NOT IN (:'t313_s4_client'::UUID, :'t313_s5_client'::UUID) FROM platform.communication_conversations c
       WHERE c.id = pg_temp.t313_conv('996555313204@c.us')),
  'B7: a number held by two people with cases is not guessed: a new client and lead, as before');

-- B6. A chat without a number (a LID that names none) takes the old path too.
SELECT pg_temp.t313_counts() AS t313_c8 \gset
SELECT pg_temp.t313_in(8, '623456789012345@lid') AS t313_b8 \gset
SELECT pg_temp.t313_assert(:'t313_b8'::JSONB ->> 'finish_state' = 'succeeded'
  AND pg_temp.t313_counts() = ((split_part(:'t313_c8', '/', 1))::INTEGER + 1) || '/' || ((split_part(:'t313_c8', '/', 2))::INTEGER + 1)
  AND (SELECT cl.phone IS NULL FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
       WHERE c.id = pg_temp.t313_conv('623456789012345@lid')),
  'B8: a LID chat without a phone gets a new client without a phone and a new lead, as before');

-- ---------------------------------------------------------------------------
-- D. The calls of merged clients in the lead''s feed.
-- ---------------------------------------------------------------------------
-- Clients: P (the survivor of the end), Q (merged into P), R (merged into Q first), S (a stranger with a lead of his
-- own), C (a client with no lead at all); T belongs to organization 2.
CREATE FUNCTION pg_temp.t313_person(p_org INTEGER, p_n INTEGER, p_lead BOOLEAN DEFAULT TRUE) RETURNS UUID[] LANGUAGE plpgsql AS $$
DECLARE c UUID; l UUID;
BEGIN
  c := platform_private.create_or_link_client(pg_temp.t313_id(p_org), 'T313 Feed Person ' || p_n, NULL, '+996 555 313 3' || lpad(p_n::TEXT, 2, '0'),
    't313-fixture', 'client', 'feed-client-' || p_n, 'staff_recorded', statement_timestamp());
  IF p_lead THEN
    l := platform_private.create_or_link_lead(pg_temp.t313_id(p_org), c, NULL, 'new', 'office',
      't313-fixture', 'lead', 'feed-lead-' || p_n, 'staff_recorded', statement_timestamp());
  END IF;
  RETURN ARRAY[c, l];
END
$$;
SELECT pg_temp.t313_person(1, 1) AS t313_p \gset
SELECT pg_temp.t313_person(1, 2) AS t313_q \gset
SELECT pg_temp.t313_person(1, 3, FALSE) AS t313_r \gset
SELECT pg_temp.t313_person(1, 4) AS t313_s \gset
SELECT pg_temp.t313_person(1, 5, FALSE) AS t313_c \gset
SELECT pg_temp.t313_person(2, 6) AS t313_t \gset
SELECT (:'t313_p'::UUID[])[1] AS t313_pc, (:'t313_p'::UUID[])[2] AS t313_pl, (:'t313_q'::UUID[])[1] AS t313_qc, (:'t313_q'::UUID[])[2] AS t313_ql,
  (:'t313_r'::UUID[])[1] AS t313_rc, (:'t313_s'::UUID[])[1] AS t313_sc, (:'t313_s'::UUID[])[2] AS t313_sl,
  (:'t313_c'::UUID[])[1] AS t313_cc, (:'t313_t'::UUID[])[1] AS t313_tc, (:'t313_t'::UUID[])[2] AS t313_tl \gset

-- The telephony UI is on for organization 1 (the feed and the result are closed by the flags).
INSERT INTO platform_private.telephony_settings(organization_id) VALUES (pg_temp.t313_id(1)), (pg_temp.t313_id(2));
UPDATE platform_private.telephony_settings SET ui_enabled = TRUE, dial_enabled = TRUE;
-- An answered, ended call (webhook origin) of a client; the lead may be NULL (a call before the lead existed).
CREATE FUNCTION pg_temp.t313_mk(p_k INTEGER, p_client UUID, p_lead UUID, p_org INTEGER DEFAULT 1) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_start TIMESTAMPTZ := clock_timestamp() - INTERVAL '2 hours' - p_k * INTERVAL '1 minute';
BEGIN
  INSERT INTO platform_private.telephony_calls(id, organization_id, pbx_callid, direction, state, outcome, outcome_source,
    started_at, answered_at, ended_at, settled_at, talk_seconds, client_phone, membership_id, client_id, lead_id,
    match_state, created_via)
  VALUES (pg_temp.t313_id(7000 + p_k), pg_temp.t313_id(p_org), 't313-call-' || p_k, 'out', 'ended', 'answered', 'webhook',
    v_start, v_start + INTERVAL '5 seconds', v_start + INTERVAL '3 minutes', v_start + INTERVAL '4 minutes', 60, '+996555313900',
    CASE WHEN p_org = 1 THEN pg_temp.t313_id(301) ELSE pg_temp.t313_id(310) END,
    p_client, p_lead, 'matched', 'webhook');
END
$$;
-- 1 P no lead, 2 P lead, 3 Q no lead, 4 Q lead, 5 R no lead, 6 S no lead, 7 C no lead, 8 T (organization 2) no lead.
SELECT pg_temp.t313_mk(1, :'t313_pc'::UUID, NULL);
SELECT pg_temp.t313_mk(2, :'t313_pc'::UUID, :'t313_pl'::UUID);
SELECT pg_temp.t313_mk(3, :'t313_qc'::UUID, NULL);
SELECT pg_temp.t313_mk(4, :'t313_qc'::UUID, :'t313_ql'::UUID);
SELECT pg_temp.t313_mk(5, :'t313_rc'::UUID, NULL);
SELECT pg_temp.t313_mk(6, :'t313_sc'::UUID, NULL);
SELECT pg_temp.t313_mk(7, :'t313_cc'::UUID, NULL);
SELECT pg_temp.t313_mk(8, :'t313_tc'::UUID, NULL, 2);
-- Recordings: calls 3 (Q) and 5 (R) and 6 (S) each have one available leg.
INSERT INTO platform_private.telephony_call_legs(organization_id, call_id, pbx_user, membership_id, state, status,
  leg_started_at, leg_start_source, accepted_at, webhook_total_seconds, talk_seconds, recording_link, recording_state)
SELECT c.organization_id, c.id, 'u3' || (c.pbx_callid = 't313-call-3')::INTEGER || (c.pbx_callid = 't313-call-5')::INTEGER || (c.pbx_callid = 't313-call-6')::INTEGER,
  pg_temp.t313_id(301), 'completed', 'success', c.started_at, 'history', c.started_at + INTERVAL '5 seconds', 65, 60,
  'https://example.invalid/t313-secret-recording-' || c.pbx_callid || '.mp3', 'available'
FROM platform_private.telephony_calls c WHERE c.pbx_callid IN ('t313-call-3', 't313-call-5', 't313-call-6');
UPDATE platform_private.telephony_calls SET recording_state = 'available' WHERE pbx_callid IN ('t313-call-3', 't313-call-5', 't313-call-6');

CREATE FUNCTION pg_temp.t313_feed(p_lead UUID, p_actor INTEGER DEFAULT 1, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t313_call((SELECT claims FROM t313_claims WHERE n = p_actor),
    format('SELECT platform.telephony_lead_calls_v1(%L::UUID, %L::UUID)', pg_temp.t313_id(p_org), p_lead))
$$;
-- The call numbers of a feed answer, in order.
CREATE FUNCTION pg_temp.t313_nums(p_feed JSONB) RETURNS INTEGER[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((substr(c ->> 'callId', 25)::INTEGER - 7000) ORDER BY substr(c ->> 'callId', 25)::INTEGER), ARRAY[]::INTEGER[])
  FROM jsonb_array_elements(p_feed -> 'calls') c
$$;
CREATE FUNCTION pg_temp.t313_recordings(p_lead UUID, p_calls INTEGER[]) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t313_call((SELECT claims FROM t313_claims WHERE n = 1),
    format('SELECT platform.telephony_lead_recordings_v1(%L::UUID, %L::UUID, %L::UUID[])', pg_temp.t313_id(1), p_lead,
      (SELECT array_agg(pg_temp.t313_id(7000 + k)) FROM unnest(p_calls) k))) 
$$;
CREATE FUNCTION pg_temp.t313_result(p_call INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t313_call((SELECT claims FROM t313_claims WHERE n = 1),
    format('SELECT platform.telephony_set_result_v1(%L::UUID, %L::UUID, ''reached'', NULL)', pg_temp.t313_id(1), pg_temp.t313_id(7000 + p_call)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t313_nums(JSONB) TO authenticated;

-- D1. Before any merge: each lead shows its own client's calls.
SELECT pg_temp.t313_assert(pg_temp.t313_nums(pg_temp.t313_feed(:'t313_pl'::UUID)) = ARRAY[1, 2]
  AND pg_temp.t313_nums(pg_temp.t313_feed(:'t313_ql'::UUID)) = ARRAY[3, 4]
  AND pg_temp.t313_nums(pg_temp.t313_feed(:'t313_sl'::UUID)) = ARRAY[6]
  AND (pg_temp.t313_feed(:'t313_pl'::UUID) ->> 'enabled')::BOOLEAN,
  'D1: before the merge each lead''s feed holds the calls of its own client (the lead''s, and the client''s without a lead)');

-- D2. R is merged into Q, then Q into P (a chain): the survivor''s feed takes the calls of both.
SELECT pg_temp.t313_svc_json(format('SELECT platform.merge_clients_owner_confirmed_v1(%L::UUID, %L::UUID, %L, %L, %L::UUID, %L::UUID, %L)',
  pg_temp.t313_id(1), pg_temp.t313_id(301), 't313-merge', 'd2-merge-1', :'t313_qc', :'t313_rc', 'T313 synthetic merge')) AS t313_dm1 \gset
SELECT pg_temp.t313_assert(:'t313_dm1'::JSONB ->> 'status' = 'merged'
  AND pg_temp.t313_nums(pg_temp.t313_feed(:'t313_ql'::UUID)) = ARRAY[3, 4, 5]
  AND pg_temp.t313_nums(pg_temp.t313_feed(:'t313_pl'::UUID)) = ARRAY[1, 2],
  'D2: after R is merged into Q, Q''s lead shows the call of R that had no lead; P''s feed is unchanged');
SELECT pg_temp.t313_svc_json(format('SELECT platform.merge_clients_owner_confirmed_v1(%L::UUID, %L::UUID, %L, %L, %L::UUID, %L::UUID, %L)',
  pg_temp.t313_id(1), pg_temp.t313_id(301), 't313-merge', 'd2-merge-2', :'t313_pc', :'t313_qc', 'T313 synthetic merge')) AS t313_dm2 \gset
SELECT pg_temp.t313_assert(:'t313_dm2'::JSONB ->> 'status' = 'merged'
  AND (SELECT client_id FROM platform.leads WHERE id = :'t313_ql'::UUID) = :'t313_pc'::UUID
  AND pg_temp.t313_nums(pg_temp.t313_feed(:'t313_pl'::UUID)) = ARRAY[1, 2, 3, 5]
  AND pg_temp.t313_nums(pg_temp.t313_feed(:'t313_ql'::UUID)) = ARRAY[1, 3, 4, 5],
  'D2: after Q is merged into P the survivor''s lead shows its own call and the calls of P, Q and R that had no lead; the lead that moved keeps its own call 4 and shows the same client-level calls; call 4 stays off the other lead');
SELECT pg_temp.t313_assert(
  NOT (pg_temp.t313_nums(pg_temp.t313_feed(:'t313_pl'::UUID)) && ARRAY[6, 7, 8])
  AND pg_temp.t313_nums(pg_temp.t313_feed(:'t313_sl'::UUID)) = ARRAY[6]
  AND pg_temp.t313_nums(pg_temp.t313_feed(:'t313_tl'::UUID, 1, 1)) = ARRAY[]::INTEGER[],
  'D2: the stranger''s call, the client without a lead and the other organization''s call stay out of the feed');
-- The feed row of a merged client''s call carries the same shape as any other (the number masked, no link).
SELECT pg_temp.t313_feed(:'t313_pl'::UUID) AS t313_feed_p \gset
SELECT pg_temp.t313_assert(
  (SELECT bool_and(c ->> 'phone' IS NOT NULL AND c ->> 'phone' NOT LIKE '%555313900%' AND NOT (c ? 'recordingLink')) FROM jsonb_array_elements(:'t313_feed_p'::JSONB -> 'calls') c)
  AND :'t313_feed_p'::TEXT NOT LIKE '%t313-secret%',
  'D2: the numbers stay masked and no recording link reaches the feed');
-- Another organization''s Admin gets nothing for these leads, a non-reader of leads gets nothing either.
SELECT pg_temp.t313_assert(
  pg_temp.t313_feed(:'t313_pl'::UUID, 4, 2) ->> 'error' LIKE '42501:%'
  AND pg_temp.t313_feed(:'t313_pl'::UUID, 5) ->> 'error' LIKE '42501:%',
  'D2: a foreign organization''s request and a Student are refused as before');

-- D3. The recordings list follows the same rule; the stranger''s recording is not offered.
SELECT pg_temp.t313_recordings(:'t313_pl'::UUID, ARRAY[3, 5, 6]) AS t313_rec \gset
SELECT pg_temp.t313_assert(:'t313_rec'::JSONB ->> 'enabled' = 'true'
  AND (SELECT array_agg((substr(c ->> 'callId', 25)::INTEGER - 7000) ORDER BY substr(c ->> 'callId', 25)::INTEGER)
       FROM jsonb_array_elements(:'t313_rec'::JSONB -> 'calls') c) = ARRAY[3, 5]
  AND :'t313_rec'::TEXT NOT LIKE '%t313-secret%',
  'D3: the recordings of the merged clients'' calls are listed for the survivor''s lead (calls 3 and 5), the stranger''s call 6 is not, no link');

-- D4. The result can be set on a merged client''s call that the feed shows; a call of nobody''s lead stays unavailable.
SELECT pg_temp.t313_result(3) AS t313_res3 \gset
SELECT pg_temp.t313_result(5) AS t313_res5 \gset
SELECT pg_temp.t313_result(7) AS t313_res7 \gset
SELECT pg_temp.t313_assert(:'t313_res3'::JSONB ->> 'status' = 'saved' AND :'t313_res3'::JSONB ->> 'resultCode' = 'reached'
  AND :'t313_res5'::JSONB ->> 'status' = 'saved'
  AND :'t313_res7'::JSONB ->> 'error' LIKE 'P0002:telephony_call_unavailable%'
  AND (SELECT result_code FROM platform_private.telephony_calls WHERE id = pg_temp.t313_id(7003)) = 'reached'
  AND (SELECT result_code IS NULL FROM platform_private.telephony_calls WHERE id = pg_temp.t313_id(7007)),
  'D4: the result is set on the calls of the merged clients (one merge and a chain of two); a call of a client with no lead stays unavailable (P0002)');
SELECT pg_temp.t313_assert(
  (pg_temp.t313_feed(:'t313_pl'::UUID) -> 'calls' -> 0) IS NOT NULL
  AND (SELECT (c ->> 'resultCode') = 'reached' FROM jsonb_array_elements(pg_temp.t313_feed(:'t313_pl'::UUID) -> 'calls') c
       WHERE c ->> 'callId' = pg_temp.t313_id(7003)::TEXT),
  'D4: the feed shows the result just set on the merged client''s call');

-- ---------------------------------------------------------------------------
-- C. The journal: the merge is read through search_audit_events().
-- ---------------------------------------------------------------------------
SELECT pg_temp.t313_assert(
  'client.duplicate.merge' = ANY (platform_private.p7a_safe_audit_actions())
  AND NOT ('client.duplicate.merge' = ANY (platform_private.p7a_safe_audit_actions_pre_sales_import_tails()))
  AND 'client' = ANY (platform_private.p7a_safe_audit_resource_types())
  AND NOT ('client' = ANY (platform_private.p7a_safe_audit_resource_types_pre_sales_import_tails()))
  AND cardinality(platform_private.p7a_safe_audit_actions()) = cardinality(platform_private.p7a_safe_audit_actions_pre_sales_import_tails()) + 1
  AND cardinality(platform_private.p7a_safe_audit_resource_types()) = cardinality(platform_private.p7a_safe_audit_resource_types_pre_sales_import_tails()) + 1
  AND NOT EXISTS (SELECT 1 FROM unnest(platform_private.p7a_safe_audit_actions_pre_sales_import_tails()) a
    WHERE NOT (a = ANY (platform_private.p7a_safe_audit_actions())))
  AND NOT EXISTS (SELECT 1 FROM unnest(platform_private.p7a_safe_audit_resource_types_pre_sales_import_tails()) a
    WHERE NOT (a = ANY (platform_private.p7a_safe_audit_resource_types())))
  AND 'whatsapp.connect.qr' = ANY (platform_private.p7a_safe_audit_actions())
  AND platform_private.p7a_changed_field_codes('client.duplicate.merge') = ARRAY['record_status']::TEXT[],
  'C: the allowlist gains exactly client.duplicate.merge and the object type client and keeps every earlier entry; the field codes take the default');
SELECT pg_temp.t313_call((SELECT claims FROM t313_claims WHERE n = 1),
  $q$SELECT platform.search_audit_events(NULL, NULL, ARRAY['client.duplicate.merge'], NULL, NULL, 50)$q$) AS t313_page \gset
SELECT pg_temp.t313_assert(:'t313_page'::JSONB ->> 'error' IS NULL
    AND jsonb_array_length(:'t313_page'::JSONB -> 'rows') = 3
    AND (SELECT bool_and(r ->> 'action' = 'client.duplicate.merge' AND r ->> 'resource_type' = 'client' AND r ->> 'actor_display_label' = 'Staff'
          AND r ->> 'actor_kind' = 'user' AND r ->> 'reason_code' = 'restricted' AND r -> 'changed_field_codes' = '["record_status"]'::JSONB
          AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k) = ARRAY['action', 'actor_display_label',
            'actor_kind', 'audit_event_id', 'changed_field_codes', 'created_at', 'reason_code', 'request_id',
            'resource_id', 'resource_type'])
        FROM jsonb_array_elements(:'t313_page'::JSONB -> 'rows') r)
    AND (SELECT count(*) = 3 FROM jsonb_array_elements(:'t313_page'::JSONB -> 'rows') r
         WHERE (r ->> 'resource_id')::UUID IN (:'t313_am_client'::UUID, :'t313_qc'::UUID, :'t313_pc'::UUID))
    AND :'t313_page'::TEXT NOT LIKE '%T313 synthetic%' AND :'t313_page'::TEXT NOT LIKE '%T313 Feed%',
  'C: the Admin reads the three merges through search_audit_events() as Staff with only the ten safe keys; the object is the kept client, no reason text, no name');
SELECT pg_temp.t313_call((SELECT claims FROM t313_claims WHERE n = 4),
  $q$SELECT platform.search_audit_events(NULL, NULL, ARRAY['client.duplicate.merge'], NULL, NULL, 50)$q$) AS t313_page_b \gset
SELECT pg_temp.t313_assert(jsonb_array_length(:'t313_page_b'::JSONB -> 'rows') = 3,
  'C: the second system Admin of the same organization reads the same three rows');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.t313_id(120), 't313-org2-claims@example.invalid', '{}'::JSONB)
  ON CONFLICT DO NOTHING;
SELECT pg_temp.t313_call((platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t313_id(110),
  'claims', jsonb_build_object('sub', pg_temp.t313_id(110), 'role', 'authenticated'))) -> 'claims')::TEXT,
  $q$SELECT platform.search_audit_events(NULL, NULL, ARRAY['client.duplicate.merge'], NULL, NULL, 50)$q$) AS t313_page_o \gset
SELECT pg_temp.t313_assert(jsonb_array_length(:'t313_page_o'::JSONB -> 'rows') = 0,
  'C: the other organization''s Admin sees none of these rows');

SELECT 'T313_SALES_IMPORT_TAILS_SUITE_PASSED' AS t313_suite_marker;
ROLLBACK;
